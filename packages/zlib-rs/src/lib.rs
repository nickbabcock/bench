use std::io::{Read, Write};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress_bench(data: &[u8]) -> Vec<u8> {
    let mut output = Vec::new();
    flate2::bufread::DeflateDecoder::new(data)
        .read_to_end(&mut output)
        .unwrap();
    output
}

#[wasm_bindgen]
pub fn compress_bench(data: &[u8], level: u8) -> Vec<u8> {
    let mut encoder =
        flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::new(u32::from(level)));
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
}
