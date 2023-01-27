use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress(data: &[u8]) -> Vec<u8> {
    miniz_oxide::inflate::decompress_to_vec(data).unwrap()
}

#[wasm_bindgen]
pub fn compress(data: &[u8], level: u8) -> Vec<u8> {
    miniz_oxide::deflate::compress_to_vec(data, level)
}
