use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress(data: &[u8]) -> Vec<u8> {
    lz4_flex::decompress_size_prepended(data).unwrap()
}

#[wasm_bindgen]
pub fn compress(data: &[u8]) -> Vec<u8> {
    lz4_flex::compress_prepend_size(data)
}
