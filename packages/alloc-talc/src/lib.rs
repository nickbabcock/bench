use wasm_bindgen::prelude::*;

/// SAFETY: The runtime environment is single-threaded WASM.
#[global_allocator]
static ALLOCATOR: talc::TalckWasm = unsafe { talc::TalckWasm::new_global() };

#[wasm_bindgen]
pub fn talc_allocation(corpus: &str, iterations: usize) -> usize {
    let mut data = Vec::new();

    for _ in 0..iterations {
        let mut new_data = Vec::new();
        for _ in 0..5 {
            new_data.push(String::from(corpus).into_boxed_str());
        }
        data.push(new_data);
    }

    data.len()
}
