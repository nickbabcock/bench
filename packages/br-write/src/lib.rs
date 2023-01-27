use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn compress(mut data: &[u8], quality: i32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut params = brotli::enc::BrotliEncoderParams::default();
    params.lgwin = 22;
    params.quality = quality;
    brotli::BrotliCompress(&mut data, &mut out, &params).unwrap();
    out
}
