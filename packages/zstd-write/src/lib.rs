use wasm_bindgen::prelude::*;

/// Compress with zstd at `level`. With `ldm`, long-distance matching is on
/// and the window is fixed at 4 MiB (window log 22); without it, every
/// parameter is zstd's default for that level.
#[wasm_bindgen]
pub fn compress(data: &[u8], level: i32, ldm: bool) -> Vec<u8> {
    let mut compressor = zstd::bulk::Compressor::new(level).unwrap();
    if ldm {
        compressor.long_distance_matching(true).unwrap();
        compressor.window_log(22).unwrap();
    }
    compressor.compress(data).unwrap()
}

/// The compression parameters zstd picks for `level` on an input of
/// `src_size` bytes: window log, chain log, hash log, search log, min
/// match, target length and strategy (1 = fast … 9 = btultra2). Reported so
/// a reader can audit why ratios differ by level.
#[wasm_bindgen]
pub fn params(level: i32, src_size: f64) -> Vec<u32> {
    let p = unsafe { zstd_sys::ZSTD_getCParams(level, src_size as u64, 0) };
    vec![
        p.windowLog,
        p.chainLog,
        p.hashLog,
        p.searchLog,
        p.minMatch,
        p.targetLength,
        p.strategy as u32,
    ]
}
