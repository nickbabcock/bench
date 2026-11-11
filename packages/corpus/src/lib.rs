//! Reads the benchmark corpus archive (`public/corpus/silesia.zip`, written
//! by `xtask corpus`) from just the byte ranges the page fetched: the tail
//! holding the central directory, then the one entry it wants.

use rawzip::{
    CompressionMethod, RECOMMENDED_BUFFER_SIZE, ReaderAt, ZipArchive, ZipArchiveEntryWayfinder,
    ZipLocator,
};
use ruzstd::decoding::StreamingDecoder;
use std::io::{self, Read};
use wasm_bindgen::prelude::*;

/// No corpus entry comes close; caps what a corrupt size hint can reserve.
const MAX_ENTRY_SIZE: u64 = 256 << 20;

/// The archive bytes fetched so far: its tail, and at most one entry.
struct Fetched {
    tail_start: u64,
    tail: Vec<u8>,
    entry_start: u64,
    entry: Vec<u8>,
}

impl ReaderAt for Fetched {
    fn read_at(&self, buf: &mut [u8], offset: u64) -> io::Result<usize> {
        for (start, bytes) in [
            (self.tail_start, &self.tail),
            (self.entry_start, &self.entry),
        ] {
            let len = bytes.len() as u64;
            if offset >= start && offset - start < len {
                let from = (offset - start) as usize;
                let n = buf.len().min(bytes.len() - from);
                buf[..n].copy_from_slice(&bytes[from..from + n]);
                return Ok(n);
            }
        }
        Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            format!("archive byte {offset} was not fetched"),
        ))
    }
}

struct Located {
    wayfinder: ZipArchiveEntryWayfinder,
    method: CompressionMethod,
    size: u64,
    start: u64,
    end: u64,
}

#[wasm_bindgen]
pub struct Archive {
    zip: ZipArchive<Fetched>,
    buffer: Vec<u8>,
}

#[wasm_bindgen]
impl Archive {
    /// Open an archive `size` bytes long from its last bytes, `tail`, which
    /// must include the whole central directory. Passing the entire archive
    /// works too.
    #[wasm_bindgen(constructor)]
    pub fn new(tail: Vec<u8>, size: f64) -> Result<Archive, JsError> {
        let size = size as u64;
        let len = tail.len() as u64;
        let tail_start = size
            .checked_sub(len)
            .ok_or_else(|| JsError::new("tail is longer than the archive"))?;
        let fetched = Fetched {
            tail_start,
            tail,
            entry_start: 0,
            entry: Vec::new(),
        };
        let mut buffer = vec![0u8; RECOMMENDED_BUFFER_SIZE];
        let zip = ZipLocator::new()
            .max_search_space(len)
            .locate_in_reader(fetched, &mut buffer, size)
            .map_err(|(_, e)| e)?;
        if zip.directory_offset() < tail_start {
            return Err(JsError::new("tail does not cover the central directory"));
        }
        Ok(Archive { zip, buffer })
    }

    /// Entry names, in archive order.
    pub fn names(&mut self) -> Result<Vec<String>, JsError> {
        let mut names = Vec::new();
        let mut entries = self.zip.entries(&mut self.buffer);
        while let Some(entry) = entries.next_entry()? {
            names.push(String::from_utf8_lossy(entry.file_path().as_ref()).into_owned());
        }
        Ok(names)
    }

    /// `[start, end)`: the archive bytes that `extract` needs for `name`:
    /// its local header, compressed data and data descriptor.
    #[wasm_bindgen(js_name = entryRange)]
    pub fn entry_range(&mut self, name: &str) -> Result<Vec<f64>, JsError> {
        let found = self.locate(name)?;
        Ok(vec![found.start as f64, found.end as f64])
    }

    /// Decompress `name` from `bytes`, the archive's bytes over its
    /// `entryRange`. Checks the zip's CRC-32 and uncompressed size.
    pub fn extract(&mut self, name: &str, bytes: Vec<u8>) -> Result<Vec<u8>, JsError> {
        let found = self.locate(name)?;
        if bytes.len() as u64 != found.end - found.start {
            return Err(JsError::new(&format!(
                "{name}: got {} bytes, its range is {}",
                bytes.len(),
                found.end - found.start
            )));
        }
        if found.method != CompressionMethod::ZSTD {
            return Err(JsError::new(&format!("{name} is not zstd-compressed")));
        }

        let fetched = self.zip.get_mut();
        fetched.entry_start = found.start;
        fetched.entry = bytes;
        let result = self.decompress(&found);
        // Keep only the tail between calls.
        self.zip.get_mut().entry = Vec::new();
        result
    }
}

impl Archive {
    fn locate(&mut self, name: &str) -> Result<Located, JsError> {
        let directory = self.zip.directory_offset();
        let mut found = None;
        let mut offsets = Vec::new();
        let mut entries = self.zip.entries(&mut self.buffer);
        while let Some(entry) = entries.next_entry()? {
            offsets.push(entry.local_header_offset());
            if entry.file_path().as_ref() == name.as_bytes() {
                found = Some((
                    entry.wayfinder(),
                    entry.compression_method(),
                    entry.uncompressed_size_hint(),
                    entry.local_header_offset(),
                ));
            }
        }
        let (wayfinder, method, size, start) =
            found.ok_or_else(|| JsError::new(&format!("{name} is not in the archive")))?;
        // An entry runs until the next one starts, or the central directory.
        let end = offsets
            .into_iter()
            .filter(|&o| o > start)
            .min()
            .unwrap_or(directory)
            .min(directory);
        Ok(Located {
            wayfinder,
            method,
            size,
            start,
            end,
        })
    }

    fn decompress(&self, found: &Located) -> Result<Vec<u8>, JsError> {
        let entry = self.zip.get_entry(found.wayfinder)?;
        let decoder =
            StreamingDecoder::new(entry.reader()).map_err(|e| JsError::new(&e.to_string()))?;
        let mut out = Vec::with_capacity(found.size.min(MAX_ENTRY_SIZE) as usize);
        entry.verifying_reader(decoder).read_to_end(&mut out)?;
        Ok(out)
    }
}
