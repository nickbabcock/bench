//! The allocation workload: repeated, independently discardable document
//! jobs. Every allocator crate runs this same code; only the allocator
//! behind the collections differs.
//!
//! The input is a tar of XML documents (Silesia `xml`), handed over once
//! and split into documents untimed. A batch processes every document in a
//! fixed order, largest first, so memory retained from a large document
//! shows when smaller ones follow. Per document:
//!
//! 1. parse it into an owned tree: names, attribute values and text are
//!    copied into `Vec<u8, A>`, and child lists grow by push;
//! 2. walk the tree, creating and freeing temporaries as it goes: a path
//!    string per element, a normalised copy of each attribute value, a
//!    word list per text node; the walk folds into a checksum;
//! 3. record a small summary in a survivor set that lives in the global
//!    allocator in every build (an interned tag table, recent summaries
//!    trimmed now and then), as long-lived application state would;
//! 4. drop the tree. An arena build then resets its arena; reset alone
//!    would not run the collections' destructors.
//!
//! All collections are allocator-api2's, so each build uses the same
//! collection code and growth policy. An earlier workload used each crate's
//! own Vec, whose growth policies differed; see
//! https://github.com/bluurryy/bump-scope/discussions/108.

use std::cell::Cell;
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};
use std::ptr::NonNull;

pub use allocator_api2;
use allocator_api2::alloc::{AllocError, Allocator, Layout};
use allocator_api2::vec::Vec;

// ---------------------------------------------------------------------------
// Documents: the tar split into entries, validated, largest first
// ---------------------------------------------------------------------------

/// The input and its documents, in processing order. Load-time state, in
/// the global allocator.
pub struct Batch {
    input: std::vec::Vec<u8>,
    docs: std::vec::Vec<(usize, usize)>,
    rejected: u32,
    survivors: Survivors,
}

/// The deepest element nesting the validator follows (the corpus reaches 188).
const MAX_DEPTH: usize = 512;

impl Batch {
    /// Split a tar into its regular-file entries, keep those that are
    /// well-formed XML, and order them largest first (ties by tar order).
    pub fn load(input: std::vec::Vec<u8>) -> Batch {
        let mut docs = std::vec::Vec::new();
        let mut rejected = 0;
        let mut at = 0;
        while at + 512 <= input.len() {
            let header = &input[at..at + 512];
            if header.iter().all(|&b| b == 0) {
                break;
            }
            let size = octal(&header[124..136]);
            let kind = header[156];
            let start = at + 512;
            let end = (start + size).min(input.len());
            if (kind == b'0' || kind == 0) && size > 0 {
                if well_formed(&input[start..end]) {
                    docs.push((start, end));
                } else {
                    rejected += 1;
                }
            }
            at = start + size.div_ceil(512) * 512;
        }
        docs.sort_by(|a, b| (b.1 - b.0).cmp(&(a.1 - a.0)).then(a.0.cmp(&b.0)));
        Batch { input, docs, rejected, survivors: Survivors::default() }
    }

    pub fn len(&self) -> usize {
        self.docs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    /// Entries that weren't well-formed XML, left out of the batch.
    pub fn rejected(&self) -> u32 {
        self.rejected
    }

    /// Document sizes in bytes, in processing order.
    pub fn sizes(&self) -> std::vec::Vec<u32> {
        self.docs.iter().map(|(s, e)| (e - s) as u32).collect()
    }

    /// One document job with allocator `a`; the tree is dropped before this
    /// returns. Returns the document's checksum.
    pub fn process<A: Allocator + Copy>(&mut self, i: usize, a: A) -> u64 {
        let (s, e) = self.docs[i];
        let tree = parse(&self.input[s..e], a);
        let h = analyse(&tree, &mut self.survivors, a);
        drop(tree);
        h
    }
}

fn octal(field: &[u8]) -> usize {
    field
        .iter()
        .skip_while(|b| **b == b' ')
        .take_while(|b| (b'0'..=b'7').contains(*b))
        .fold(0, |n, b| n * 8 + (b - b'0') as usize)
}

/// Fold per-document checksums into a batch checksum, order-sensitive.
pub fn fold(acc: u64, h: u64) -> u64 {
    (acc.rotate_left(7) ^ h).wrapping_mul(0x100_0000_01b3)
}

/// A batch checksum as the u32 JavaScript compares.
pub fn finish(acc: u64) -> u32 {
    (acc ^ (acc >> 32)) as u32
}

// ---------------------------------------------------------------------------
// Tokens: a light, non-allocating XML tokenizer
// ---------------------------------------------------------------------------

enum Event<'d> {
    Start { name: &'d [u8], attrs: &'d [u8], empty: bool },
    End { name: &'d [u8] },
    Text(&'d [u8]),
    Malformed,
}

struct Tokens<'d> {
    doc: &'d [u8],
    i: usize,
}

fn find(d: &[u8], from: usize, pat: &[u8]) -> Option<usize> {
    d.get(from..)?.windows(pat.len()).position(|w| w == pat).map(|p| p + from)
}

const fn is_space(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\r' | b'\n')
}

fn trim(s: &[u8]) -> &[u8] {
    let start = s.iter().position(|c| !is_space(*c)).unwrap_or(s.len());
    let end = s.iter().rposition(|c| !is_space(*c)).map_or(start, |p| p + 1);
    &s[start..end]
}

impl<'d> Iterator for Tokens<'d> {
    type Item = Event<'d>;

    fn next(&mut self) -> Option<Event<'d>> {
        let d = self.doc;
        loop {
            let i = self.i;
            if i >= d.len() {
                return None;
            }
            if d[i] != b'<' {
                let end = find(d, i, b"<").unwrap_or(d.len());
                self.i = end;
                let t = trim(&d[i..end]);
                if t.is_empty() {
                    continue;
                }
                return Some(Event::Text(t));
            }
            let rest = &d[i..];
            if rest.starts_with(b"<?") {
                match find(d, i + 2, b"?>") {
                    Some(e) => self.i = e + 2,
                    None => return Some(Event::Malformed),
                }
                continue;
            }
            if rest.starts_with(b"<!--") {
                match find(d, i + 4, b"-->") {
                    Some(e) => self.i = e + 3,
                    None => return Some(Event::Malformed),
                }
                continue;
            }
            if rest.starts_with(b"<![CDATA[") {
                let s = i + 9;
                return match find(d, s, b"]]>") {
                    Some(e) => {
                        self.i = e + 3;
                        Some(Event::Text(&d[s..e]))
                    }
                    None => Some(Event::Malformed),
                };
            }
            if rest.starts_with(b"<!") {
                // A declaration, with an internal subset in [ … ] if any.
                let mut j = i + 2;
                let mut depth = 0i32;
                while j < d.len() {
                    match d[j] {
                        b'[' => depth += 1,
                        b']' => depth -= 1,
                        b'>' if depth == 0 => break,
                        _ => {}
                    }
                    j += 1;
                }
                if j >= d.len() {
                    return Some(Event::Malformed);
                }
                self.i = j + 1;
                continue;
            }
            // A tag: up to the first '>' outside quotes.
            let mut j = i + 1;
            let mut quote = 0u8;
            while j < d.len() {
                let c = d[j];
                if quote != 0 {
                    if c == quote {
                        quote = 0;
                    }
                } else if c == b'"' || c == b'\'' {
                    quote = c;
                } else if c == b'>' {
                    break;
                }
                j += 1;
            }
            if j >= d.len() {
                return Some(Event::Malformed);
            }
            self.i = j + 1;
            let inner = &d[i + 1..j];
            if let Some(name) = inner.strip_prefix(b"/") {
                return Some(Event::End { name: trim(name) });
            }
            let (inner, empty) = match inner.strip_suffix(b"/") {
                Some(s) => (s, true),
                None => (inner, false),
            };
            let n = inner.iter().position(|c| is_space(*c)).unwrap_or(inner.len());
            return Some(Event::Start { name: &inner[..n], attrs: &inner[n..], empty });
        }
    }
}

/// `name="value"` pairs of a start tag; stops at the first malformed one.
struct Attrs<'d> {
    s: &'d [u8],
    i: usize,
}

impl<'d> Iterator for Attrs<'d> {
    type Item = (&'d [u8], &'d [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        let s = self.s;
        let skip = |mut i: usize| {
            while i < s.len() && is_space(s[i]) {
                i += 1;
            }
            i
        };
        let start = skip(self.i);
        let mut i = start;
        while i < s.len() && s[i] != b'=' && !is_space(s[i]) {
            i += 1;
        }
        let name = &s[start..i];
        i = skip(i);
        if name.is_empty() || s.get(i) != Some(&b'=') {
            return None;
        }
        i = skip(i + 1);
        let quote = *s.get(i)?;
        if quote != b'"' && quote != b'\'' {
            return None;
        }
        let end = s[i + 1..].iter().position(|c| *c == quote)? + i + 1;
        self.i = end + 1;
        Some((name, &s[i + 1..end]))
    }
}

/// Whether a document is well-formed enough for the parser: tags balance
/// and nest, one root, no text outside it. Allocates nothing.
fn well_formed(doc: &[u8]) -> bool {
    let mut open: [&[u8]; MAX_DEPTH] = [&[]; MAX_DEPTH];
    let mut depth = 0;
    let mut roots = 0;
    for ev in (Tokens { doc, i: 0 }) {
        match ev {
            Event::Start { name, empty, .. } => {
                if name.is_empty() {
                    return false;
                }
                if depth == 0 {
                    roots += 1;
                }
                if !empty {
                    if depth == MAX_DEPTH {
                        return false;
                    }
                    open[depth] = name;
                    depth += 1;
                }
            }
            Event::End { name } => {
                if depth == 0 || open[depth - 1] != name {
                    return false;
                }
                depth -= 1;
            }
            Event::Text(_) => {
                if depth == 0 {
                    return false;
                }
            }
            Event::Malformed => return false,
        }
    }
    depth == 0 && roots == 1
}

// ---------------------------------------------------------------------------
// The owned tree
// ---------------------------------------------------------------------------

pub struct Element<A: Allocator> {
    name: Vec<u8, A>,
    attrs: Vec<Attr<A>, A>,
    children: Vec<Node<A>, A>,
}

pub struct Attr<A: Allocator> {
    name: Vec<u8, A>,
    value: Vec<u8, A>,
}

pub enum Node<A: Allocator> {
    Element(Element<A>),
    Text(Vec<u8, A>),
}

/// Append bytes with one memcpy (allocator-api2's extend_from_slice copies
/// element by element), growing like push does.
fn push_bytes<A: Allocator>(v: &mut Vec<u8, A>, s: &[u8]) {
    v.reserve(s.len());
    // SAFETY: reserve made room for s.len() more bytes past len; the
    // regions don't overlap; u8 needs no initialisation beyond the copy.
    unsafe {
        std::ptr::copy_nonoverlapping(s.as_ptr(), v.as_mut_ptr().add(v.len()), s.len());
        v.set_len(v.len() + s.len());
    }
}

/// An owned copy at its exact size.
fn copy_in<A: Allocator>(s: &[u8], a: A) -> Vec<u8, A> {
    let mut v = Vec::with_capacity_in(s.len(), a);
    push_bytes(&mut v, s);
    v
}

fn parse<A: Allocator + Copy>(doc: &[u8], a: A) -> Element<A> {
    let mut open: Vec<Element<A>, A> = Vec::new_in(a);
    let mut root = None;
    let attach = |open: &mut Vec<Element<A>, A>, root: &mut Option<Element<A>>, el: Element<A>| match open.last_mut() {
        Some(parent) => parent.children.push(Node::Element(el)),
        None => *root = Some(el),
    };
    for ev in (Tokens { doc, i: 0 }) {
        match ev {
            Event::Start { name, attrs, empty } => {
                let mut el = Element { name: copy_in(name, a), attrs: Vec::new_in(a), children: Vec::new_in(a) };
                for (k, v) in (Attrs { s: attrs, i: 0 }) {
                    el.attrs.push(Attr { name: copy_in(k, a), value: copy_in(v, a) });
                }
                if empty {
                    attach(&mut open, &mut root, el);
                } else {
                    open.push(el);
                }
            }
            Event::End { .. } => {
                let el = open.pop().expect("validated at load");
                attach(&mut open, &mut root, el);
            }
            Event::Text(t) => {
                if let Some(top) = open.last_mut() {
                    top.children.push(Node::Text(copy_in(t, a)));
                }
            }
            Event::Malformed => unreachable!("validated at load"),
        }
    }
    root.expect("validated at load")
}

// ---------------------------------------------------------------------------
// The walk: temporaries created and freed mid-phase, folded into a checksum
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
pub struct Fnv(u64);

impl Default for Fnv {
    fn default() -> Self {
        Fnv(0xcbf2_9ce4_8422_2325)
    }
}

impl Hasher for Fnv {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.0 = (self.0 ^ u64::from(*b)).wrapping_mul(0x100_0000_01b3);
        }
    }

    /// Hash a `usize` as eight bytes, so checksums agree between wasm32 and
    /// wasm64 (and native) builds.
    fn write_usize(&mut self, i: usize) {
        self.write_u64(i as u64);
    }
}

/// Per-document facts kept after the document is gone.
#[derive(Clone, Copy, Default)]
struct Summary {
    elements: u32,
    attributes: u32,
    text_bytes: u32,
    words: u32,
}

/// Long-lived state in the global allocator: interned tag names, and the
/// most recent document summaries, trimmed now and then.
#[derive(Default)]
struct Survivors {
    tags: HashMap<std::vec::Vec<u8>, u32, BuildHasherDefault<Fnv>>,
    recent: std::vec::Vec<Summary>,
}

/// Summaries kept; the list is trimmed back to this when it doubles.
const KEEP: usize = 16;

impl Survivors {
    fn intern(&mut self, name: &[u8]) -> u32 {
        if let Some(&id) = self.tags.get(name) {
            return id;
        }
        let id = self.tags.len() as u32;
        self.tags.insert(name.to_vec(), id);
        id
    }

    fn record(&mut self, s: Summary) {
        self.recent.push(s);
        if self.recent.len() >= 2 * KEEP {
            self.recent.drain(..KEEP);
        }
    }
}

fn analyse<A: Allocator + Copy>(root: &Element<A>, survivors: &mut Survivors, a: A) -> u64 {
    let mut h = Fnv::default();
    let mut summary = Summary::default();
    let mut enter = |el: &Element<A>, path: &[u8], h: &mut Fnv, summary: &mut Summary| {
        h.write(path);
        survivors.intern(&el.name);
        summary.elements += 1;
        for attr in el.attrs.iter() {
            // A normalised copy of the value: lower-case, runs of space collapsed.
            let mut norm = Vec::with_capacity_in(attr.value.len(), a);
            let mut space = false;
            for &c in attr.value.iter() {
                if is_space(c) {
                    space = true;
                    continue;
                }
                if space && !norm.is_empty() {
                    norm.push(b' ');
                }
                space = false;
                norm.push(c.to_ascii_lowercase());
            }
            h.write(&attr.name);
            h.write(&norm);
            summary.attributes += 1;
        }
    };
    let join = |parent: &[u8], name: &[u8]| {
        let mut p = Vec::new_in(a);
        push_bytes(&mut p, parent);
        p.push(b'/');
        push_bytes(&mut p, name);
        p
    };

    let mut stack: Vec<(&Element<A>, usize, Vec<u8, A>), A> = Vec::new_in(a);
    let path = join(&[], &root.name);
    enter(root, &path, &mut h, &mut summary);
    stack.push((root, 0, path));
    while let Some(top) = stack.last_mut() {
        let el = top.0;
        let i = top.1;
        if i >= el.children.len() {
            // Leaving the element frees its path.
            stack.pop();
            continue;
        }
        top.1 += 1;
        match &el.children[i] {
            Node::Element(child) => {
                let path = join(&top.2, &child.name);
                enter(child, &path, &mut h, &mut summary);
                stack.push((child, 0, path));
            }
            Node::Text(text) => {
                // A word list, built and dropped here.
                let mut words: Vec<&[u8], A> = Vec::new_in(a);
                words.extend(text.split(|c| is_space(*c)).filter(|w| !w.is_empty()));
                h.write_u64(words.len() as u64);
                for w in words.iter() {
                    h.write_u64(w.len() as u64);
                }
                summary.text_bytes += text.len() as u32;
                summary.words += words.len() as u32;
            }
        }
    }
    h.write_u32(summary.elements);
    h.write_u32(summary.attributes);
    survivors.record(summary);
    h.finish()
}

// ---------------------------------------------------------------------------
// Counting: how much a batch asks of its allocator (an untimed pass)
// ---------------------------------------------------------------------------

/// Allocator calls and bytes requested.
#[derive(Clone, Copy, Default)]
pub struct Counts {
    pub allocs: u64,
    pub grows: u64,
    pub shrinks: u64,
    pub frees: u64,
    pub bytes: u64,
}

impl Counts {
    const ZERO: Counts = Counts { allocs: 0, grows: 0, shrinks: 0, frees: 0, bytes: 0 };

    /// `[allocs, grows, shrinks, frees, bytes]`, for JavaScript.
    pub fn to_vec(self) -> std::vec::Vec<f64> {
        vec![self.allocs as f64, self.grows as f64, self.shrinks as f64, self.frees as f64, self.bytes as f64]
    }
}

thread_local! {
    /// The counters live outside the wrapper, so `Counting<A>` has the same
    /// size as `A` and every collection holding it has the same layout, and
    /// requests the same bytes, as in the uncounted build.
    static COUNTS: Cell<Counts> = const { Cell::new(Counts::ZERO) };
}

/// Run `f` with the counters reset; returns its result and what every
/// `Counting` allocator received meanwhile.
pub fn counted<R>(f: impl FnOnce() -> R) -> (R, Counts) {
    COUNTS.set(Counts::ZERO);
    let r = f();
    (r, COUNTS.get())
}

/// Wraps an allocator and counts the calls it receives (see [`counted`]).
/// Zero-sized around a zero-sized allocator such as `Global`.
#[derive(Clone, Copy)]
pub struct Counting<A>(pub A);

fn bump(f: impl FnOnce(&mut Counts)) {
    COUNTS.with(|counts| {
        let mut c = counts.get();
        f(&mut c);
        counts.set(c);
    });
}

// SAFETY: every call is forwarded to the inner allocator unchanged; counting has no effect on memory.
unsafe impl<A: Allocator> Allocator for Counting<A> {
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        bump(|c| {
            c.allocs += 1;
            c.bytes += layout.size() as u64;
        });
        self.0.allocate(layout)
    }

    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        bump(|c| c.frees += 1);
        // SAFETY: forwarded unchanged from our caller's contract.
        unsafe { self.0.deallocate(ptr, layout) }
    }

    unsafe fn grow(&self, ptr: NonNull<u8>, old: Layout, new: Layout) -> Result<NonNull<[u8]>, AllocError> {
        bump(|c| {
            c.grows += 1;
            c.bytes += (new.size() - old.size()) as u64;
        });
        // SAFETY: forwarded unchanged from our caller's contract.
        unsafe { self.0.grow(ptr, old, new) }
    }

    unsafe fn shrink(&self, ptr: NonNull<u8>, old: Layout, new: Layout) -> Result<NonNull<[u8]>, AllocError> {
        bump(|c| c.shrinks += 1);
        // SAFETY: forwarded unchanged from our caller's contract.
        unsafe { self.0.shrink(ptr, old, new) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use allocator_api2::alloc::Global;

    fn tar(files: &[(&str, &[u8])]) -> std::vec::Vec<u8> {
        let mut out = std::vec::Vec::new();
        for (name, body) in files {
            let mut h = [0u8; 512];
            h[..name.len()].copy_from_slice(name.as_bytes());
            let size = format!("{:011o}\0", body.len());
            h[124..136].copy_from_slice(size.as_bytes());
            h[156] = b'0';
            out.extend_from_slice(&h);
            out.extend_from_slice(body);
            out.resize(out.len().div_ceil(512) * 512, 0);
        }
        out.extend_from_slice(&[0; 1024]);
        out
    }

    #[test]
    fn splits_validates_and_orders_largest_first() {
        let input = tar(&[
            ("a.xml", b"<a x='1'><b>hi there</b><c/></a>"),
            ("bad.xml", b"<a><b></a>"),
            ("big.xml", b"<?xml version=\"1.0\"?><!DOCTYPE r [<!ELEMENT r ANY>]><r><![CDATA[x < y]]><!-- c --><s k=\"V  W\">t</s></r>"),
        ]);
        let mut batch = Batch::load(input);
        assert_eq!(batch.len(), 2);
        assert_eq!(batch.rejected(), 1);
        assert!(batch.sizes()[0] > batch.sizes()[1]);
        let h1 = batch.process(0, Global);
        let h2 = batch.process(0, Global);
        assert_eq!(h1, h2);
    }

    #[test]
    fn counts_every_call() {
        let input = tar(&[("a.xml", b"<a x='1'><b>hi there</b><c/></a>")]);
        let mut batch = Batch::load(input);
        let plain = batch.process(0, Global);
        let (with_counts, c) = counted(|| batch.process(0, Counting(Global)));
        assert_eq!(plain, with_counts);
        assert!(c.allocs > 5);
        assert_eq!(c.allocs, c.frees);
    }

    #[test]
    fn counting_keeps_the_allocator_size() {
        assert_eq!(std::mem::size_of::<Counting<Global>>(), 0);
        assert_eq!(std::mem::size_of::<Counting<&u8>>(), std::mem::size_of::<&u8>());
        assert_eq!(std::mem::size_of::<Vec<u8, Counting<Global>>>(), std::mem::size_of::<Vec<u8, Global>>());
    }

    /// `ALLOC_XML=path/to/silesia/xml cargo test --release -p alloc-workload --target <host> -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn silesia_xml_profile() {
        let Ok(path) = std::env::var("ALLOC_XML") else { return };
        let mut batch = Batch::load(std::fs::read(path).unwrap());
        println!("documents {} rejected {} sizes {:?}", batch.len(), batch.rejected(), batch.sizes());
        let t = std::time::Instant::now();
        let (acc, c) = counted(|| (0..batch.len()).fold(0, |acc, i| fold(acc, batch.process(i, Counting(Global)))));
        println!("checksum {:08x} in {:?}; allocs {} grows {} shrinks {} frees {} bytes {}", finish(acc), t.elapsed(), c.allocs, c.grows, c.shrinks, c.frees, c.bytes);
        let t = std::time::Instant::now();
        for i in 0..batch.len() {
            batch.process(i, Global);
        }
        println!("uncounted batch {:?}", t.elapsed());
    }
}
