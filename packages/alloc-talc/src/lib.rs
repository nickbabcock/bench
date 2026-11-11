//! The document workload on talc, set as the global allocator. See
//! packages/alloc-workload for the workload itself.
use std::cell::RefCell;

use alloc_workload::allocator_api2::alloc::Global;
use alloc_workload::{counted, finish, fold, Batch, Counting};
use wasm_bindgen::prelude::*;

#[global_allocator]
static ALLOCATOR: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

thread_local! {
    static BATCH: RefCell<Option<Batch>> = const { RefCell::new(None) };
}

fn with_batch<R>(f: impl FnOnce(&mut Batch) -> R) -> R {
    BATCH.with_borrow_mut(|b| f(b.as_mut().expect("load_documents first")))
}

/// Take the tar of documents (untimed); returns their sizes in processing order.
#[wasm_bindgen]
pub fn load_documents(input: Vec<u8>) -> Vec<u32> {
    let batch = Batch::load(input);
    let sizes = batch.sizes();
    BATCH.set(Some(batch));
    sizes
}

/// Entries left out because they weren't well-formed XML.
#[wasm_bindgen]
pub fn rejected_documents() -> u32 {
    with_batch(|b| b.rejected())
}

/// One batch: every document, parsed, walked and dropped. Returns its checksum.
#[wasm_bindgen]
pub fn process_documents() -> u32 {
    with_batch(|b| {
        let mut acc = 0;
        for i in 0..b.len() {
            acc = fold(acc, b.process(i, Global));
        }
        finish(acc)
    })
}

/// One batch through a counting wrapper: `[allocs, grows, shrinks, frees, bytes]`.
#[wasm_bindgen]
pub fn allocation_profile() -> Vec<f64> {
    with_batch(|b| {
        let ((), counts) = counted(|| {
            for i in 0..b.len() {
                b.process(i, Counting(Global));
            }
        });
        counts.to_vec()
    })
}
