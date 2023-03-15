use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn compress(mut data: &[u8], quality: i32) -> Vec<u8> {
    let mut out = Vec::new();
    let params = brotli::enc::BrotliEncoderParams {
        lgwin: 22,
        quality,
        ..Default::default()
    };
    brotli::BrotliCompress(&mut data, &mut out, &params).unwrap();
    out
}
