use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress(mut data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    brotli_decompressor::BrotliDecompress(&mut data, &mut out).unwrap();
    out
}
