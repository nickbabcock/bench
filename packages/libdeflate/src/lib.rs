// use std::io::Read;
// use flate2::Compression;
use wasm_bindgen::prelude::*;
use libdeflater::{Compressor, CompressionLvl, Decompressor};

static mut ORIGINAL_SIZE: usize = 0;

#[wasm_bindgen]
pub fn decompress(data: &[u8]) -> Vec<u8> {
    let mut decompressor = Decompressor::new();
    let mut out_buf = unsafe { Vec::with_capacity(ORIGINAL_SIZE) };
    unsafe { out_buf.set_len(ORIGINAL_SIZE) }
    decompressor.gzip_decompress(&data, &mut out_buf).unwrap();
    out_buf
}

#[wasm_bindgen]
pub fn compress(data: &[u8], level: u8) -> Vec<u8> {
    unsafe { ORIGINAL_SIZE = data.len() };

    let mut compressor = Compressor::new(CompressionLvl::new(level as i32).unwrap());
    let max_sz = compressor.gzip_compress_bound(data.len());
    let mut compressed_data = Vec::new();
    compressed_data.resize(max_sz, 0);
    let actual_sz = compressor.gzip_compress(&data, &mut compressed_data).unwrap();
    compressed_data.resize(actual_sz, 0);
    compressed_data
}
