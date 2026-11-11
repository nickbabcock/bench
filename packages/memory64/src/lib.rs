//! Benchmarks compiled for both `wasm32-unknown-unknown` and
//! `wasm64-unknown-unknown` (memory64) to measure the cost of 64-bit linear
//! memory. All inputs are generated from a fixed seed, so both builds do
//! identical work and must return identical checksums.
//!
//! Each workload is a class: the constructor takes its parameters (untimed)
//! and `run` performs one timed iteration.

use wasm_bindgen::prelude::*;

pub mod editor;
pub mod rng;

use std::cell::RefCell;

const SEED: u64 = 0x5EED_0F3A_5A00;

/// Pointer width of this build, in bits (32 for wasm32, 64 for wasm64).
#[wasm_bindgen]
pub fn pointer_width() -> u32 {
    usize::BITS
}

/// bevy_ecs editor session: marquee select, drag, release, undo and redo
/// over a document of nested groups, shapes and connectors.
#[wasm_bindgen]
pub struct EditorSession {
    editor: RefCell<editor::Editor>,
}

#[wasm_bindgen]
impl EditorSession {
    /// Build the document (untimed).
    #[wasm_bindgen(constructor)]
    pub fn new(entities: u32) -> EditorSession {
        EditorSession {
            editor: RefCell::new(editor::Editor::new(entities, SEED)),
        }
    }

    /// Replay one scripted session and return a checksum of the edited
    /// document. The document is reverted at the end, so every call does
    /// identical work.
    pub fn run(&self) -> f64 {
        self.editor.borrow_mut().run()
    }

    /// Frames in one session.
    pub fn frames() -> u32 {
        editor::FRAMES
    }
}
