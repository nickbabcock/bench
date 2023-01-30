use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress(data: &[u8]) -> Vec<u8> {
    miniz_oxide::inflate::decompress_to_vec(data).unwrap()
}

#[wasm_bindgen]
pub fn compress(data: &[u8], level: u8) -> Vec<u8> {
    miniz_oxide::deflate::compress_to_vec(data, level)
}

fn twiddle(data: &[u8]) -> u8 {
    data.iter().fold(0xa0, |acc, x| acc ^ x)
}

#[wasm_bindgen]
pub fn twiddle_uncompressed(data: &[u8]) -> u8 {
    twiddle(data)
}

#[wasm_bindgen]
pub fn twiddle_compressed(data: &[u8]) -> u8 {
    let inflated = miniz_oxide::inflate::decompress_to_vec(data).unwrap();
    twiddle(&inflated)
}