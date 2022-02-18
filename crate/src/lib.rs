use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn allocation(corpus: &str, iterations: usize) -> usize {
    let mut data = Vec::new();

    for _ in 0..iterations {
        let mut new_data = Vec::new();
        for _ in 0..5 {
            new_data.push(String::from(corpus));
        }
        data.push(new_data);
    }

    data.len()
}
