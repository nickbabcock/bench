use wasm_bindgen::prelude::*;

#[global_allocator]
static ALLOCATOR: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

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
