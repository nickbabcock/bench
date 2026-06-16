use std::io::{Read, Write};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress(data: &[u8]) -> Vec<u8> {
    let mut decoder = lz4_flex::frame::FrameDecoder::new(data);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).unwrap();
    out
}

#[wasm_bindgen]
pub fn compress(data: &[u8]) -> Vec<u8> {
    let mut encoder = lz4_flex::frame::FrameEncoder::new(Vec::new());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
}
