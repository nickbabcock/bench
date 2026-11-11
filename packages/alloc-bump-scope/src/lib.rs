//! The document workload in one persistent bump-scope arena, reset between
//! documents. The arena's chunks and the survivor set come from the global
//! allocator, dlmalloc, as in the dlmalloc build. See
//! packages/alloc-workload for the workload itself.
use std::cell::RefCell;

use alloc_workload::{counted, finish, fold, Batch, Counting};
use wasm_bindgen::prelude::*;

struct State {
    batch: Batch,
    arena: bump_scope::Bump,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn with_state<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with_borrow_mut(|s| f(s.as_mut().expect("load_documents first")))
}

/// Take the tar of documents (untimed); returns their sizes in processing order.
#[wasm_bindgen]
pub fn load_documents(input: Vec<u8>) -> Vec<u32> {
    let batch = Batch::load(input);
    let sizes = batch.sizes();
    STATE.set(Some(State { batch, arena: bump_scope::Bump::new() }));
    sizes
}

/// Entries left out because they weren't well-formed XML.
#[wasm_bindgen]
pub fn rejected_documents() -> u32 {
    with_state(|s| s.batch.rejected())
}

/// One batch: every document, parsed, walked and dropped, then the arena
/// reset (dropping first runs the collections' destructors; reset alone
/// wouldn't). Returns its checksum.
#[wasm_bindgen]
pub fn process_documents() -> u32 {
    with_state(|s| {
        let mut acc = 0;
        for i in 0..s.batch.len() {
            acc = fold(acc, s.batch.process(i, &s.arena));
            s.arena.reset();
        }
        finish(acc)
    })
}

/// One batch through a counting wrapper: `[allocs, grows, shrinks, frees, bytes]`.
#[wasm_bindgen]
pub fn allocation_profile() -> Vec<f64> {
    with_state(|s| {
        let ((), counts) = counted(|| {
            for i in 0..s.batch.len() {
                s.batch.process(i, Counting(&s.arena));
                s.arena.reset();
            }
        });
        counts.to_vec()
    })
}
