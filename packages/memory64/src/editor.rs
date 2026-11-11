//! An interactive editor session (think CAD or a vector design tool).
//!
//! The scene is a document of nested groups and shapes (a `ChildOf`
//! hierarchy up to five levels deep), plus connectors whose geometry is
//! derived from two shapes. A uniform grid indexes the world bounds of every
//! drawable. One session replays a scripted interaction:
//!
//! 1. marquee select: a rectangle query on the grid, mapped up the hierarchy
//!    to top-level groups;
//! 2. drag the selection for [`DRAG_FRAMES`] frames. Each frame moves the
//!    selected groups, propagates world transforms down their subtrees,
//!    recomputes connectors attached to moved shapes, moves changed bounds
//!    between grid cells, and hit-tests the pointer;
//! 3. release, snapping the selection to a grid;
//! 4. undo, then redo, by applying the stored diff of the groups' local
//!    transforms (the authored data) and recomputing what derives from it;
//! 5. revert to the saved document (one more undo plus a grid rebuild), so
//!    every session starts from the same state and does the same work.
//!
//! Unlike a simulation step, almost every access here goes through an
//! `Entity` lookup, a hash map, or a grid cell: scattered loads and stores
//! rather than dense sweeps. Only transcendental-free f32 math (`sqrt`,
//! `abs`, `round`) is used, so results are bit-identical on wasm32 and wasm64.

use crate::rng::{Checksum, Rng};
use bevy_ecs::entity::{EntityHashMap, EntityHashSet};
use bevy_ecs::prelude::*;
use std::ops::{Add, Mul, Sub};

/// Pointer-move frames in the drag.
const DRAG_FRAMES: u32 = 240;
/// Frames in a session: select, drag, release, undo, redo, revert.
pub const FRAMES: u32 = DRAG_FRAMES + 5;
/// Share of the scene's area covered by the marquee.
const SELECT_FRACTION: f32 = 0.2;
/// Spatial grid cell size, in world units.
const CELL: f32 = 6.0;
/// Distance between top-level groups, laid out on a jittered lattice.
const GROUP_SPACING: f32 = 24.0;
/// Rough entities per top-level group, used to size the lattice.
const EST_GROUP_SIZE: f32 = 55.0;
/// Child offset radius by depth (top-level groups are at depth 0).
const RADIUS: [f32; 5] = [0.0, 8.0, 3.5, 1.5, 0.8];
const CONNECTOR_HALF_WIDTH: f32 = 0.1;
const SNAP: f32 = 0.25;
const DRAG_SEED: u64 = 0xD2A6;

#[derive(Debug, Clone, Copy, PartialEq, Default)]
struct Vec2 {
    x: f32,
    y: f32,
}

const fn vec2(x: f32, y: f32) -> Vec2 {
    Vec2 { x, y }
}

impl Vec2 {
    fn length(self) -> f32 {
        (self.x * self.x + self.y * self.y).sqrt()
    }
}

impl Add for Vec2 {
    type Output = Vec2;
    fn add(self, rhs: Vec2) -> Vec2 {
        vec2(self.x + rhs.x, self.y + rhs.y)
    }
}

impl Sub for Vec2 {
    type Output = Vec2;
    fn sub(self, rhs: Vec2) -> Vec2 {
        vec2(self.x - rhs.x, self.y - rhs.y)
    }
}

impl Mul<f32> for Vec2 {
    type Output = Vec2;
    fn mul(self, rhs: f32) -> Vec2 {
        vec2(self.x * rhs, self.y * rhs)
    }
}

/// 2D affine transform: rotation and scale columns plus a translation.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Affine {
    x_axis: Vec2,
    y_axis: Vec2,
    t: Vec2,
}

impl Affine {
    const IDENTITY: Affine = Affine {
        x_axis: vec2(1.0, 0.0),
        y_axis: vec2(0.0, 1.0),
        t: vec2(0.0, 0.0),
    };

    /// `dir` is a unit vector (cos, sin) giving the rotation.
    fn new(dir: Vec2, scale: f32, t: Vec2) -> Self {
        Affine {
            x_axis: dir * scale,
            y_axis: vec2(-dir.y, dir.x) * scale,
            t,
        }
    }

    fn vector(&self, v: Vec2) -> Vec2 {
        self.x_axis * v.x + self.y_axis * v.y
    }

    fn point(&self, p: Vec2) -> Vec2 {
        self.vector(p) + self.t
    }

    fn mul(&self, rhs: &Affine) -> Affine {
        Affine {
            x_axis: self.vector(rhs.x_axis),
            y_axis: self.vector(rhs.y_axis),
            t: self.point(rhs.t),
        }
    }

    fn inverse_point(&self, p: Vec2) -> Vec2 {
        let (x, y, d) = (self.x_axis, self.y_axis, p - self.t);
        let det = x.x * y.y - y.x * x.y;
        vec2((y.y * d.x - y.x * d.y) / det, (x.x * d.y - x.y * d.x) / det)
    }

    /// World bounds of a box with half-size `half` centered on the origin.
    fn bounds(&self, half: Vec2) -> Aabb {
        let (x, y) = (self.x_axis, self.y_axis);
        let ext = vec2(
            x.x.abs() * half.x + y.x.abs() * half.y,
            x.y.abs() * half.x + y.y.abs() * half.y,
        );
        Aabb {
            min: self.t - ext,
            max: self.t + ext,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Aabb {
    min: Vec2,
    max: Vec2,
}

impl Aabb {
    const EMPTY: Aabb = Aabb {
        min: vec2(f32::MAX, f32::MAX),
        max: vec2(f32::MIN, f32::MIN),
    };

    fn union(&self, o: &Aabb) -> Aabb {
        Aabb {
            min: vec2(self.min.x.min(o.min.x), self.min.y.min(o.min.y)),
            max: vec2(self.max.x.max(o.max.x), self.max.y.max(o.max.y)),
        }
    }

    fn intersects(&self, o: &Aabb) -> bool {
        self.min.x <= o.max.x
            && o.min.x <= self.max.x
            && self.min.y <= o.max.y
            && o.min.y <= self.max.y
    }

    fn contains(&self, p: Vec2) -> bool {
        (self.min.x..=self.max.x).contains(&p.x) && (self.min.y..=self.max.y).contains(&p.y)
    }

    fn center(&self) -> Vec2 {
        (self.min + self.max) * 0.5
    }
}

/// Transform relative to the parent group (authored data; groups and shapes).
#[derive(Component, Clone, Copy)]
struct Local(Affine);

/// Cached world transform (groups, shapes and connectors).
#[derive(Component, Clone, Copy)]
struct Global(Affine);

/// Half-size of a drawable in its own space.
#[derive(Component, Clone, Copy)]
struct Extent(Vec2);

/// Cached world-space bounds of a drawable.
#[derive(Component, Clone, Copy)]
struct Bounds(Aabb);

/// The grid cells a drawable is currently registered in.
#[derive(Component, Clone, Copy, PartialEq, Default)]
struct Cells(CellRange);

/// A line between two shapes' origins (think dimension or wire).
#[derive(Component, Clone, Copy)]
struct Connector {
    a: Entity,
    b: Entity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct CellRange {
    x0: u32,
    y0: u32,
    x1: u32,
    y1: u32,
}

/// Uniform grid; each drawable is listed in every cell its bounds overlap.
struct Grid {
    origin: Vec2,
    dim_x: u32,
    dim_y: u32,
    cells: Vec<Vec<Entity>>,
}

impl Grid {
    fn new(scene: Aabb) -> Self {
        let origin = scene.min;
        let dim_x = ((scene.max.x - origin.x) / CELL) as u32 + 1;
        let dim_y = ((scene.max.y - origin.y) / CELL) as u32 + 1;
        let cells = (0..dim_x * dim_y).map(|_| Vec::new()).collect();
        Grid {
            origin,
            dim_x,
            dim_y,
            cells,
        }
    }

    /// Cell coordinates of `p`, clamped to the grid (`as` saturates at 0).
    fn cell(&self, p: Vec2) -> (u32, u32) {
        let x = ((p.x - self.origin.x) / CELL) as u32;
        let y = ((p.y - self.origin.y) / CELL) as u32;
        (x.min(self.dim_x - 1), y.min(self.dim_y - 1))
    }

    fn range(&self, b: &Aabb) -> CellRange {
        let (x0, y0) = self.cell(b.min);
        let (x1, y1) = self.cell(b.max);
        CellRange { x0, y0, x1, y1 }
    }

    fn index(&self, x: u32, y: u32) -> usize {
        (y * self.dim_x + x) as usize
    }

    fn insert(&mut self, e: Entity, r: CellRange) {
        for y in r.y0..=r.y1 {
            for x in r.x0..=r.x1 {
                let i = self.index(x, y);
                self.cells[i].push(e);
            }
        }
    }

    fn remove(&mut self, e: Entity, r: CellRange) {
        for y in r.y0..=r.y1 {
            for x in r.x0..=r.x1 {
                let i = self.index(x, y);
                let cell = &mut self.cells[i];
                let slot = cell.iter().position(|&c| c == e).expect("indexed");
                cell.swap_remove(slot);
            }
        }
    }
}

type NodeQuery = (
    &'static Local,
    &'static mut Global,
    Option<&'static Extent>,
    Option<&'static mut Bounds>,
    Option<&'static Children>,
);

type ConnectorQuery = (
    &'static Connector,
    &'static mut Global,
    &'static mut Extent,
    &'static mut Bounds,
);

pub struct Editor {
    world: World,
    grid: Grid,
    /// Reverse dependency index: shape -> connectors attached to it.
    dependents: EntityHashMap<Vec<Entity>>,
    marquee: Aabb,
    nodes: QueryState<NodeQuery>,
    connectors: QueryState<ConnectorQuery>,
    globals: QueryState<&'static Global>,
    locals: QueryState<&'static mut Local>,
    parents: QueryState<&'static ChildOf>,
    pick: QueryState<(&'static Global, &'static Extent, &'static Bounds)>,
    cells: QueryState<(Entity, &'static Bounds, &'static mut Cells)>,
    // Per-frame scratch, reused across frames.
    selection: Vec<Entity>,
    stack: Vec<(Entity, Affine)>,
    changed: Vec<Entity>,
    seen: EntityHashSet,
    cell_moves: u64,
}

impl Editor {
    /// Build the document (untimed). The scene's size scales with
    /// `entities`; its density does not.
    pub fn new(entities: u32, seed: u64) -> Self {
        let mut world = World::new();
        let mut rng = Rng::new(seed);
        let mut roots = Vec::new();
        let mut dependents: EntityHashMap<Vec<Entity>> = EntityHashMap::default();
        let mut builder = Builder {
            world: &mut world,
            rng: &mut rng,
            spawned: 0,
            limit: entities,
            shapes: Vec::new(),
        };

        // Top-level groups on a serpentine lattice, so consecutive groups
        // (and the connectors between them) are spatial neighbors.
        let cols = ((entities as f32 / EST_GROUP_SIZE).sqrt().ceil() as u32).max(1);
        let mut group = 0;
        while builder.spawned < entities {
            let (row, col) = (group / cols, group % cols);
            let col = if row % 2 == 1 { cols - 1 - col } else { col };
            let jitter = vec2(builder.rng.f32_signed(), builder.rng.f32_signed()) * 0.3;
            let pos = (vec2(col as f32, row as f32) + jitter) * GROUP_SPACING;
            let dir = unit(builder.rng);
            let root = builder.spawn((Local(Affine::new(dir, 1.0, pos)), Global(Affine::IDENTITY)));
            roots.push(root);

            let first = builder.shapes.len();
            builder.children(root, 1);
            let (here, prev) = (first..builder.shapes.len(), first.saturating_sub(64)..first);
            for _ in 0..here.len() / 5 {
                if builder.spawned >= entities {
                    break;
                }
                let a = builder.shapes[here.start + builder.rng.below(here.len() as u32) as usize];
                let others = if prev.is_empty() || builder.rng.chance(0.75) {
                    &here
                } else {
                    &prev
                };
                let b =
                    builder.shapes[others.start + builder.rng.below(others.len() as u32) as usize];
                if a == b {
                    continue;
                }
                let c = builder.spawn((
                    Connector { a, b },
                    Global(Affine::IDENTITY),
                    Extent(vec2(0.0, 0.0)),
                    Bounds(Aabb::EMPTY),
                    Cells::default(),
                ));
                dependents.entry(a).or_default().push(c);
                dependents.entry(b).or_default().push(c);
            }
            group += 1;
        }

        let mut editor = Editor {
            nodes: world.query(),
            connectors: world.query(),
            globals: world.query(),
            locals: world.query(),
            parents: world.query(),
            pick: world.query(),
            cells: world.query(),
            world,
            grid: Grid::new(Aabb::EMPTY),
            dependents,
            marquee: Aabb::EMPTY,
            selection: roots,
            stack: Vec::new(),
            changed: Vec::new(),
            seen: EntityHashSet::default(),
            cell_moves: 0,
        };

        // Compute every derived value by treating the whole document as
        // dirty, then size the grid and the marquee from the scene.
        editor.refresh();
        let scene = editor
            .cells
            .iter(&editor.world)
            .fold(Aabb::EMPTY, |acc, (_, b, _)| acc.union(&b.0));
        editor.grid = Grid::new(scene);
        editor.reindex_all();
        let half = (scene.max - scene.min) * (SELECT_FRACTION.sqrt() * 0.5);
        let center = scene.center();
        editor.marquee = Aabb {
            min: center - half,
            max: center + half,
        };
        editor
    }

    /// Replay one session and return a checksum of the edited document.
    /// The document is reverted afterwards, so every call does the same work.
    pub fn run(&mut self) -> f64 {
        let mut sum = Checksum::new();
        self.cell_moves = 0;

        self.select(self.marquee);
        sum.write_u64(self.selection.len() as u64);
        let before = self.root_locals();

        let mut rng = Rng::new(DRAG_SEED);
        let mut pointer = self.marquee.center();
        for frame in 0..DRAG_FRAMES {
            // Sweep right, left, right, ... in one-second strokes at 60 fps.
            let dir = if (frame / 60) % 2 == 0 { 1.0 } else { -1.0 };
            let delta = vec2(dir * (0.4 + 0.2 * rng.f32()), 0.3 * rng.f32_signed());
            pointer = pointer + delta;
            for &root in &self.selection {
                let mut local = self.locals.get_mut(&mut self.world, root).unwrap();
                local.0.t = local.0.t + delta;
            }
            self.update();
            let hit = self.hover(pointer);
            sum.write_u64(hit.map_or(0, |e| e.to_bits()));
        }

        // Release: snap, and record the edit for undo.
        for &root in &self.selection {
            let mut local = self.locals.get_mut(&mut self.world, root).unwrap();
            let t = local.0.t;
            local.0.t = vec2((t.x / SNAP).round() * SNAP, (t.y / SNAP).round() * SNAP);
        }
        self.update();
        let after = self.root_locals();

        // Undo, then redo, from the stored before/after local transforms.
        self.set_root_locals(&before);
        self.set_root_locals(&after);

        sum.write_u64(self.cell_moves);
        for (e, bounds, _) in self.cells.iter(&self.world) {
            sum.write_u64(e.to_bits());
            for v in [
                bounds.0.min.x,
                bounds.0.min.y,
                bounds.0.max.x,
                bounds.0.max.y,
            ] {
                sum.write_f32(v);
            }
        }

        // Revert to the saved document. Rebuilding the grid also restores
        // the order of entities within cells, which undo alone would not.
        self.set_root_locals(&before);
        self.reindex_all();
        sum.finish()
    }

    /// Marquee select: every top-level group with a drawable touching `rect`.
    fn select(&mut self, rect: Aabb) {
        self.selection.clear();
        self.seen.clear();
        let r = self.grid.range(&rect);
        for y in r.y0..=r.y1 {
            for x in r.x0..=r.x1 {
                for &e in &self.grid.cells[self.grid.index(x, y)] {
                    let (_, _, bounds) = self.pick.get(&self.world, e).unwrap();
                    if !bounds.0.intersects(&rect) {
                        continue;
                    }
                    // Visit each drawable in one cell only: the first that
                    // both its bounds and the query cover.
                    let own = self.grid.range(&bounds.0);
                    if x != own.x0.max(r.x0) || y != own.y0.max(r.y0) {
                        continue;
                    }
                    // Connectors are not part of the hierarchy; skip them.
                    let Ok(mut parent) = self.parents.get(&self.world, e).map(|p| p.parent())
                    else {
                        continue;
                    };
                    while let Ok(p) = self.parents.get(&self.world, parent) {
                        parent = p.parent();
                    }
                    if self.seen.insert(parent) {
                        self.selection.push(parent);
                    }
                }
            }
        }
    }

    /// Topmost drawable under `p`, with an exact test in its local space.
    fn hover(&mut self, p: Vec2) -> Option<Entity> {
        let (x, y) = self.grid.cell(p);
        let mut best: Option<Entity> = None;
        for &e in &self.grid.cells[self.grid.index(x, y)] {
            let (global, extent, bounds) = self.pick.get(&self.world, e).unwrap();
            if !bounds.0.contains(p) {
                continue;
            }
            let l = global.0.inverse_point(p);
            let inside = l.x.abs() <= extent.0.x && l.y.abs() <= extent.0.y;
            if inside && best.is_none_or(|b| e.index_u32() > b.index_u32()) {
                best = Some(e);
            }
        }
        best
    }

    /// Recompute everything derived from the selected groups' local
    /// transforms, then move changed drawables between grid cells.
    fn update(&mut self) {
        self.refresh();
        for &e in &self.changed {
            let (_, bounds, mut cells) = self.cells.get_mut(&mut self.world, e).unwrap();
            let r = self.grid.range(&bounds.0);
            if r != cells.0 {
                self.grid.remove(e, cells.0);
                self.grid.insert(e, r);
                cells.0 = r;
                self.cell_moves += 1;
            }
        }
    }

    /// Propagate world transforms down the selected subtrees and recompute
    /// dependent connectors. Fills `changed` with every drawable touched.
    fn refresh(&mut self) {
        self.changed.clear();
        let roots = self.selection.iter().map(|&e| (e, Affine::IDENTITY));
        self.stack.extend(roots);
        while let Some((e, parent)) = self.stack.pop() {
            let (local, mut global, extent, bounds, children) =
                self.nodes.get_mut(&mut self.world, e).unwrap();
            let world = parent.mul(&local.0);
            global.0 = world;
            if let (Some(extent), Some(mut bounds)) = (extent, bounds) {
                bounds.0 = world.bounds(extent.0);
                self.changed.push(e);
            }
            if let Some(children) = children {
                self.stack.extend(children.iter().map(|c| (c, world)));
            }
        }

        self.seen.clear();
        let moved = self.changed.len();
        for i in 0..moved {
            if let Some(deps) = self.dependents.get(&self.changed[i]) {
                for &c in deps {
                    if self.seen.insert(c) {
                        self.changed.push(c);
                    }
                }
            }
        }

        for &c in &self.changed[moved..] {
            let &Connector { a, b } = self.connectors.get(&self.world, c).unwrap().0;
            let pa = self.globals.get(&self.world, a).unwrap().0.t;
            let pb = self.globals.get(&self.world, b).unwrap().0.t;
            let d = pb - pa;
            let len = d.length();
            let dir = if len > 0.0 {
                d * (1.0 / len)
            } else {
                vec2(1.0, 0.0)
            };
            let (_, mut global, mut extent, mut bounds) =
                self.connectors.get_mut(&mut self.world, c).unwrap();
            global.0 = Affine::new(dir, 1.0, (pa + pb) * 0.5);
            extent.0 = vec2(len * 0.5, CONNECTOR_HALF_WIDTH);
            bounds.0 = global.0.bounds(extent.0);
        }
    }

    fn root_locals(&mut self) -> Vec<Affine> {
        let (locals, world) = (&mut self.locals, &self.world);
        let roots = self.selection.iter();
        roots.map(|&e| locals.get(world, e).unwrap().0).collect()
    }

    /// Apply one side of the undo diff, then recompute what derives from it.
    fn set_root_locals(&mut self, values: &[Affine]) {
        for (&e, &value) in self.selection.iter().zip(values) {
            self.locals.get_mut(&mut self.world, e).unwrap().0 = value;
        }
        self.update();
    }

    fn reindex_all(&mut self) {
        for cell in &mut self.grid.cells {
            cell.clear();
        }
        for (e, bounds, mut cells) in self.cells.iter_mut(&mut self.world) {
            cells.0 = self.grid.range(&bounds.0);
            self.grid.insert(e, cells.0);
        }
    }
}

/// Random unit vector, used as a rotation.
fn unit(rng: &mut Rng) -> Vec2 {
    loop {
        let v = vec2(rng.f32_signed(), rng.f32_signed());
        let len = v.length();
        if (0.1..=1.0).contains(&len) {
            return v * (1.0 / len);
        }
    }
}

struct Builder<'a> {
    world: &'a mut World,
    rng: &'a mut Rng,
    spawned: u32,
    limit: u32,
    shapes: Vec<Entity>,
}

impl Builder<'_> {
    fn spawn(&mut self, bundle: impl Bundle) -> Entity {
        self.spawned += 1;
        self.world.spawn(bundle).id()
    }

    fn children(&mut self, parent: Entity, depth: usize) {
        let group_chance = match depth {
            1 => 0.8,
            2 | 3 => 0.3,
            _ => 0.0,
        };
        for _ in 0..2 + self.rng.below(5) {
            if self.spawned >= self.limit {
                return;
            }
            let offset = vec2(self.rng.f32_signed(), self.rng.f32_signed()) * RADIUS[depth];
            let dir = unit(self.rng);
            if self.rng.chance(group_chance) {
                let local = Local(Affine::new(dir, 1.0, offset));
                let group = self.spawn((local, Global(Affine::IDENTITY), ChildOf(parent)));
                self.children(group, depth + 1);
            } else {
                let local = Local(Affine::new(dir, 0.8 + 0.4 * self.rng.f32(), offset));
                let half = vec2(0.3 + 0.9 * self.rng.f32(), 0.3 + 0.9 * self.rng.f32());
                let shape = self.spawn((
                    local,
                    Global(Affine::IDENTITY),
                    Extent(half),
                    Bounds(Aabb::EMPTY),
                    Cells::default(),
                    ChildOf(parent),
                ));
                self.shapes.push(shape);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_reverts() {
        let mut editor = Editor::new(20_000, 1);
        let first = editor.run();
        assert_eq!(first, editor.run());
        assert_eq!(first, Editor::new(20_000, 1).run());
        assert_ne!(first, Editor::new(20_001, 1).run());
        assert_ne!(first, Editor::new(20_000, 2).run());
    }

    #[test]
    fn session_does_real_work() {
        let mut editor = Editor::new(20_000, 1);
        editor.select(editor.marquee);
        let selected = editor.selection.len();
        editor.update();
        let moved = editor.changed.len();
        let connectors = editor.seen.len();
        assert!(selected > 5, "selected {selected}");
        assert!(moved > 500, "moved {moved}");
        assert!(connectors > 50, "connectors {connectors}");
        let c = editor.marquee.center();
        let hits = (0..100)
            .filter(|&i| editor.hover(c + vec2(i as f32 * 0.5, 0.0)).is_some())
            .count();
        assert!(hits > 10, "hits {hits}");
    }

    #[test]
    fn tiny_documents() {
        for n in [0, 1, 2, 10, 100] {
            let mut editor = Editor::new(n, 1);
            assert_eq!(editor.run(), editor.run());
        }
    }
}
