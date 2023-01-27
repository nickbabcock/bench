use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress(data: &[u8]) -> Vec<u8> {
    zstd::stream::decode_all(data).unwrap()
}

#[wasm_bindgen]
pub fn compress(data: &[u8], level: i32) -> Vec<u8> {
    let mut compressor = zstd::bulk::Compressor::new(level).unwrap();
    compressor.long_distance_matching(true).unwrap();
    compressor.window_log(22).unwrap();
    compressor.compress(data).unwrap()
}
