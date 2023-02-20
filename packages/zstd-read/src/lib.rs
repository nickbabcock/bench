use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress(data: &[u8]) -> Vec<u8> {
    zstd::stream::decode_all(data).unwrap()
}
