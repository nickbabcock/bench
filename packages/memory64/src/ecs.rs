//! A bevy_ecs "arena skirmish" simulation.
//!
//! Units from several teams wander an arena, acquire the nearest enemy through
//! a uniform spatial grid, chase it, and fire homing projectiles. Projectiles
//! are short-lived entities, some of which set their target on fire (a sparse
//! set component that is frequently inserted and removed). Dead units are
//! despawned and immediately replaced so the population is stable and every
//! tick does a comparable amount of work.
//!
//! The workload mixes the operations that dominate real ECS frames: dense
//! query iteration across several archetypes, random access by `Entity`,
//! change detection, command buffers, spawning/despawning (with entity id
//! recycling), and archetype moves.

use crate::rng::{Checksum, Rng};
use bevy_ecs::prelude::*;
use std::ops::{Add, Mul, Sub};

const TEAMS: u8 = 4;
/// Sensing radius, also used as the spatial grid's cell size.
const SENSE_RADIUS: f32 = 12.0;
/// Arena area per unit: keeps density constant as the unit count scales.
const AREA_PER_UNIT: f32 = 40.0;
const UNIT_SPEED: f32 = 0.6;
const PROJECTILE_SPEED: f32 = 2.0;
const BURN_TICKS: u16 = 30;
const BURN_DPS: f32 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq, Default)]
struct Vec2 {
    x: f32,
    y: f32,
}

impl Vec2 {
    const ZERO: Vec2 = Vec2 { x: 0.0, y: 0.0 };

    fn new(x: f32, y: f32) -> Self {
        Vec2 { x, y }
    }

    fn length_squared(self) -> f32 {
        self.x * self.x + self.y * self.y
    }

    fn length(self) -> f32 {
        self.length_squared().sqrt()
    }

    fn clamp_length(self, max: f32) -> Self {
        let len = self.length();
        if len > max {
            self * (max / len)
        } else {
            self
        }
    }
}

impl Add for Vec2 {
    type Output = Vec2;
    fn add(self, rhs: Vec2) -> Vec2 {
        Vec2::new(self.x + rhs.x, self.y + rhs.y)
    }
}

impl Sub for Vec2 {
    type Output = Vec2;
    fn sub(self, rhs: Vec2) -> Vec2 {
        Vec2::new(self.x - rhs.x, self.y - rhs.y)
    }
}

impl Mul<f32> for Vec2 {
    type Output = Vec2;
    fn mul(self, rhs: f32) -> Vec2 {
        Vec2::new(self.x * rhs, self.y * rhs)
    }
}

#[derive(Component, Clone, Copy)]
struct Position(Vec2);

#[derive(Component, Clone, Copy)]
struct Velocity(Vec2);

#[derive(Component)]
struct Health(f32);

#[derive(Component, Clone, Copy)]
struct Team(u8);

#[derive(Component)]
struct Weapon {
    cooldown: u16,
    reload: u16,
    range: f32,
    damage: f32,
}

#[derive(Component, PartialEq)]
struct Target(Option<Entity>);

/// Fraction of incoming damage absorbed.
#[derive(Component)]
struct Armor(f32);

/// Marker: this unit's projectiles may ignite their target.
#[derive(Component)]
struct Incendiary;

#[derive(Component)]
struct Projectile {
    target: Entity,
    damage: f32,
    incendiary: bool,
}

#[derive(Component)]
struct Lifetime(u16);

/// Damage over time. Frequently added and removed, so stored in a sparse set,
/// as Bevy recommends for this access pattern.
#[derive(Component)]
#[component(storage = "SparseSet")]
struct Burning {
    ticks: u16,
    dps: f32,
}

#[derive(Resource)]
struct Arena {
    size: f32,
}

#[derive(Resource)]
struct SimRng(Rng);

#[derive(Resource, Default)]
struct Stats {
    shots: u64,
    hits: u64,
    kills: u64,
    ignitions: u64,
}

#[derive(Clone, Copy)]
struct GridEntry {
    entity: Entity,
    position: Vec2,
    team: u8,
}

#[derive(Resource)]
struct SpatialGrid {
    dim: usize,
    cells: Vec<Vec<GridEntry>>,
}

impl SpatialGrid {
    fn new(arena_size: f32) -> Self {
        let dim = ((arena_size / SENSE_RADIUS).ceil() as usize).max(1);
        SpatialGrid {
            dim,
            cells: vec![Vec::new(); dim * dim],
        }
    }

    fn cell_coords(&self, p: Vec2) -> (usize, usize) {
        let max = self.dim - 1;
        let x = ((p.x / SENSE_RADIUS) as usize).min(max);
        let y = ((p.y / SENSE_RADIUS) as usize).min(max);
        (x, y)
    }
}

fn spawn_unit(commands: &mut Commands, rng: &mut Rng, arena_size: f32, team: u8) {
    let position = Position(Vec2::new(rng.f32() * arena_size, rng.f32() * arena_size));
    let velocity = Velocity(Vec2::new(rng.f32_signed(), rng.f32_signed()).clamp_length(UNIT_SPEED));
    let base = (position, velocity, Team(team), Target(None));
    let cooldown = rng.below(30) as u16;
    match rng.below(100) {
        // Rifleman
        0..55 => {
            commands.spawn((
                base,
                Health(100.0),
                Weapon {
                    cooldown,
                    reload: 20,
                    range: 6.0,
                    damage: 8.0,
                },
            ));
        }
        // Sniper
        55..70 => {
            commands.spawn((
                base,
                Health(60.0),
                Weapon {
                    cooldown,
                    reload: 60,
                    range: 11.0,
                    damage: 25.0,
                },
            ));
        }
        // Heavy
        70..90 => {
            commands.spawn((
                base,
                Health(200.0),
                Armor(0.5),
                Weapon {
                    cooldown,
                    reload: 30,
                    range: 4.0,
                    damage: 12.0,
                },
            ));
        }
        // Pyro
        _ => {
            commands.spawn((
                base,
                Health(90.0),
                Incendiary,
                Weapon {
                    cooldown,
                    reload: 10,
                    range: 5.0,
                    damage: 3.0,
                },
            ));
        }
    }
}

fn rebuild_grid(
    mut grid: ResMut<SpatialGrid>,
    units: Query<(Entity, &Position, &Team), With<Health>>,
) {
    for cell in &mut grid.cells {
        cell.clear();
    }

    for (entity, position, team) in &units {
        let (x, y) = grid.cell_coords(position.0);
        let dim = grid.dim;
        grid.cells[y * dim + x].push(GridEntry {
            entity,
            position: position.0,
            team: team.0,
        });
    }
}

fn acquire_targets(grid: Res<SpatialGrid>, mut units: Query<(&Position, &Team, &mut Target)>) {
    let dim = grid.dim;
    for (position, team, mut target) in &mut units {
        let (cx, cy) = grid.cell_coords(position.0);
        let mut best = None;
        let mut best_d2 = SENSE_RADIUS * SENSE_RADIUS;
        for y in cy.saturating_sub(1)..=(cy + 1).min(dim - 1) {
            for x in cx.saturating_sub(1)..=(cx + 1).min(dim - 1) {
                for entry in &grid.cells[y * dim + x] {
                    if entry.team == team.0 {
                        continue;
                    }
                    let d2 = (entry.position - position.0).length_squared();
                    if d2 < best_d2 {
                        best_d2 = d2;
                        best = Some(entry.entity);
                    }
                }
            }
        }
        target.set_if_neq(Target(best));
    }
}

fn steer(
    mut rng: ResMut<SimRng>,
    mut units: Query<(&Position, &mut Velocity, &Target, &Weapon)>,
    positions: Query<&Position>,
) {
    for (position, mut velocity, target, weapon) in &mut units {
        match target.0.and_then(|t| positions.get(t).ok()) {
            Some(target_position) => {
                let delta = target_position.0 - position.0;
                let dist = delta.length();
                velocity.0 = if dist > weapon.range * 0.8 {
                    delta * (UNIT_SPEED / dist)
                } else {
                    Vec2::ZERO
                };
            }
            None => {
                let jitter = Vec2::new(rng.0.f32_signed(), rng.0.f32_signed()) * 0.2;
                velocity.0 = (velocity.0 + jitter).clamp_length(UNIT_SPEED);
            }
        }
    }
}

fn fire(
    mut commands: Commands,
    mut stats: ResMut<Stats>,
    mut units: Query<(&Position, &mut Weapon, &Target, Has<Incendiary>)>,
    positions: Query<&Position>,
) {
    for (position, mut weapon, target, incendiary) in &mut units {
        if weapon.cooldown > 0 {
            weapon.cooldown -= 1;
            continue;
        }

        let Some(target) = target.0 else {
            continue;
        };

        let Ok(target_position) = positions.get(target) else {
            continue;
        };

        let delta = target_position.0 - position.0;
        if delta.length_squared() > weapon.range * weapon.range {
            continue;
        }

        weapon.cooldown = weapon.reload;
        stats.shots += 1;
        let lifetime = (weapon.range / PROJECTILE_SPEED) as u16 * 2 + 4;
        commands.spawn((
            Position(position.0),
            Projectile {
                target,
                damage: weapon.damage,
                incendiary,
            },
            Lifetime(lifetime),
        ));
    }
}

fn projectiles(
    mut commands: Commands,
    mut stats: ResMut<Stats>,
    mut rng: ResMut<SimRng>,
    mut projectiles: Query<(Entity, &mut Position, &Projectile, &mut Lifetime)>,
    mut targets: Query<(&Position, &mut Health, Option<&Armor>), Without<Projectile>>,
) {
    for (entity, mut position, projectile, mut lifetime) in &mut projectiles {
        let Ok((target_position, mut health, armor)) = targets.get_mut(projectile.target) else {
            // Target already despawned: the projectile fizzles.
            commands.entity(entity).despawn();
            continue;
        };

        let delta = target_position.0 - position.0;
        let dist2 = delta.length_squared();
        if dist2 <= PROJECTILE_SPEED * PROJECTILE_SPEED {
            let absorbed = armor.map_or(0.0, |a| a.0);
            health.0 -= projectile.damage * (1.0 - absorbed);
            stats.hits += 1;
            if projectile.incendiary && rng.0.chance(0.5) {
                stats.ignitions += 1;
                commands.entity(projectile.target).try_insert(Burning {
                    ticks: BURN_TICKS,
                    dps: BURN_DPS,
                });
            }
            commands.entity(entity).despawn();
            continue;
        }

        lifetime.0 -= 1;
        if lifetime.0 == 0 {
            commands.entity(entity).despawn();
            continue;
        }

        position.0 = position.0 + delta * (PROJECTILE_SPEED / dist2.sqrt());
    }
}

fn burn(mut commands: Commands, mut burning: Query<(Entity, &mut Health, &mut Burning)>) {
    for (entity, mut health, mut burning) in &mut burning {
        health.0 -= burning.dps;
        burning.ticks -= 1;
        if burning.ticks == 0 {
            commands.entity(entity).try_remove::<Burning>();
        }
    }
}

fn movement(arena: Res<Arena>, mut units: Query<(&mut Position, &mut Velocity)>) {
    let max = arena.size;
    for (mut position, mut velocity) in &mut units {
        if velocity.0 == Vec2::ZERO {
            continue;
        }

        let mut next = position.0 + velocity.0;
        if !(0.0..max).contains(&next.x) {
            velocity.0.x = -velocity.0.x;
            next.x = next.x.clamp(0.0, max.next_down());
        }
        if !(0.0..max).contains(&next.y) {
            velocity.0.y = -velocity.0.y;
            next.y = next.y.clamp(0.0, max.next_down());
        }
        position.0 = next;
    }
}

fn reap(
    mut commands: Commands,
    mut rng: ResMut<SimRng>,
    mut stats: ResMut<Stats>,
    arena: Res<Arena>,
    units: Query<(Entity, &Health, &Team)>,
) {
    for (entity, health, team) in &units {
        if health.0 <= 0.0 {
            stats.kills += 1;
            commands.entity(entity).despawn();
            spawn_unit(&mut commands, &mut rng.0, arena.size, team.0);
        }
    }
}

pub struct Simulation {
    world: World,
    schedule: Schedule,
}

impl Simulation {
    pub fn new(units: u32, seed: u64) -> Self {
        let arena_size = (units.max(1) as f32 * AREA_PER_UNIT).sqrt();
        let mut world = World::new();
        world.insert_resource(Arena { size: arena_size });
        world.insert_resource(SpatialGrid::new(arena_size));
        world.insert_resource(Stats::default());

        let mut rng = Rng::new(seed);
        {
            let mut commands = world.commands();
            for i in 0..units {
                spawn_unit(
                    &mut commands,
                    &mut rng,
                    arena_size,
                    (i % u32::from(TEAMS)) as u8,
                );
            }
        }
        world.flush();
        world.insert_resource(SimRng(rng));

        let mut schedule = Schedule::default();
        schedule.add_systems(
            (
                rebuild_grid,
                acquire_targets,
                steer,
                fire,
                projectiles,
                burn,
                movement,
                reap,
            )
                .chain(),
        );

        Simulation { world, schedule }
    }

    pub fn tick(&mut self) {
        self.schedule.run(&mut self.world);
    }

    pub fn checksum(&mut self) -> f64 {
        let mut sum = Checksum::new();
        let stats = self.world.resource::<Stats>();
        sum.write_u64(stats.shots);
        sum.write_u64(stats.hits);
        sum.write_u64(stats.kills);
        sum.write_u64(stats.ignitions);

        let mut units = self.world.query::<(&Position, &Health, &Team)>();
        for (position, health, team) in units.iter(&self.world) {
            sum.write_f32(position.0.x);
            sum.write_f32(position.0.y);
            sum.write_f32(health.0);
            sum.write_u64(u64::from(team.0));
        }

        let mut projectiles = self.world.query::<(&Position, &Lifetime)>();
        for (position, lifetime) in projectiles.iter(&self.world) {
            sum.write_f32(position.0.x);
            sum.write_f32(position.0.y);
            sum.write_u64(u64::from(lifetime.0));
        }

        sum.finish()
    }

    #[cfg(test)]
    fn stats(&self) -> (u64, u64, u64, u64) {
        let s = self.world.resource::<Stats>();
        (s.shots, s.hits, s.kills, s.ignitions)
    }

    #[cfg(test)]
    fn counts(&mut self) -> (usize, usize, usize) {
        let units = self.world.query::<&Health>().iter(&self.world).count();
        let projectiles = self.world.query::<&Projectile>().iter(&self.world).count();
        let burning = self.world.query::<&Burning>().iter(&self.world).count();
        (units, projectiles, burning)
    }
}

/// Build a world with `units` units, advance it `ticks` times, and return a
/// checksum of the final state.
pub fn simulate(units: u32, ticks: u32, seed: u64) -> f64 {
    let mut sim = Simulation::new(units, seed);
    for _ in 0..ticks {
        sim.tick();
    }
    sim.checksum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn population_is_stable_and_combat_happens() {
        let mut sim = Simulation::new(2_000, 1);
        for _ in 0..300 {
            sim.tick();
        }
        let (shots, hits, kills, ignitions) = sim.stats();
        let (units, projectiles, burning) = sim.counts();
        assert_eq!(units, 2_000);
        assert!(shots > 1_000, "shots: {shots}");
        assert!(hits > 500, "hits: {hits}");
        assert!(kills > 50, "kills: {kills}");
        assert!(ignitions > 10, "ignitions: {ignitions}");
        assert!(projectiles > 0);
        assert!(burning > 0);
    }

    #[test]
    fn deterministic() {
        assert_eq!(simulate(500, 100, 7), simulate(500, 100, 7));
        assert_ne!(simulate(500, 100, 7), simulate(500, 100, 8));
    }
}
