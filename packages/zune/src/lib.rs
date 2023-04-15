use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress(data: &[u8]) -> Vec<u8> {
    let mut decoder = zune_inflate::DeflateDecoder::new(data);
    decoder.decode_deflate().unwrap()
}
