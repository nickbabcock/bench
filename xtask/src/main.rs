//! Build tasks that run on the host rather than in the browser.
//!
//! `corpus`: download the Silesia corpus, check it against pinned hashes, and
//! repack a subset as one zip of zstd-compressed (method 93) entries for the
//! compression benchmark to fetch with HTTP range requests.

use rawzip::{CompressionMethod, ZipArchive, ZipArchiveWriter};
use sha2::{Digest, Sha256};
use std::error::Error;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

const SILESIA_URL: &str = "https://sun.aei.polsl.pl/~sdeor/corpus/silesia.zip";
const SILESIA_SHA256: &str = "0626e25f45c0ffb5dc801f13b7c82a3b75743ba07e3a71835a41e3d9f63c77af";

/// The subset served to the browser: name, uncompressed size, SHA-256. Keep
/// in sync with `src/features/compression/corpora.ts`.
const SUBSET: &[(&str, u64, &str)] = &[
    (
        "dickens",
        10_192_446,
        "b24c37886142e11d0ee687db6ab06f936207aa7f2ea1fd1d9a36763c7a507e6a",
    ),
    (
        "xml",
        5_345_280,
        "0e82e54e695c1938e4193448022543845b33020c8be6bf3bf3ead2224903e08c",
    ),
    (
        "x-ray",
        8_474_240,
        "7de9fce1405dc44ae5e6813ed21cd5751e761bd4265655a005d39b9685d1c9ad",
    ),
    (
        "samba",
        21_606_400,
        "93ba07bc44d8267789c1d911992f40b089ffa2140b4a160fac11ccae9a40e7b2",
    ),
];

/// Storage level for the served archive: smaller downloads, decoded once.
const ZSTD_LEVEL: i32 = 19;

/// Release date of the corpus, so rebuilt archives are byte-identical.
const MODIFIED_UNIX: i64 = 1_071_920_550;

fn main() -> Result<()> {
    let task = std::env::args().nth(1);
    match task.as_deref() {
        Some("corpus") => corpus(),
        _ => Err("usage: xtask corpus".into()),
    }
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf()
}

fn corpus() -> Result<()> {
    let root = root();
    let download = root.join(".cache/corpus/silesia.zip");
    let out = root.join("public/corpus/silesia.zip");

    if out.exists() {
        match verify(&out) {
            Ok(()) => {
                println!("{} is up to date", out.display());
                return report(&out);
            }
            Err(e) => println!("rebuilding {}: {e}", out.display()),
        }
    }

    fetch(&download)?;
    let source = fs::read(&download)?;
    let archive = ZipArchive::from_slice(&source)?;

    // Extract and check each file against its pinned hash.
    let mut files = Vec::new();
    for &(name, size, sha) in SUBSET {
        let mut entries = archive.entries();
        let entry = loop {
            match entries.next_entry()? {
                Some(e) if e.file_path().as_ref() == name.as_bytes() => break e,
                Some(_) => continue,
                None => return Err(format!("{name} is missing from silesia.zip").into()),
            };
        };
        let local = archive.get_entry(entry.wayfinder())?;
        let mut data = Vec::with_capacity(size as usize);
        match entry.compression_method() {
            CompressionMethod::STORE => local
                .verifying_reader(local.data())
                .read_to_end(&mut data)?,
            CompressionMethod::DEFLATE => {
                let inflate = flate2::bufread::DeflateDecoder::new(local.data());
                local.verifying_reader(inflate).read_to_end(&mut data)?
            }
            m => return Err(format!("{name}: unexpected compression method {m:?}").into()),
        };
        check(name, &data, size, sha)?;
        files.push((name, data));
    }

    // Compress each file on its own thread; single-threaded zstd keeps the
    // output deterministic.
    let start = Instant::now();
    let compressed = std::thread::scope(|s| {
        let jobs: Vec<_> = files
            .iter()
            .map(|(_, data)| s.spawn(move || zstd::bulk::compress(data, ZSTD_LEVEL)))
            .collect();
        jobs.into_iter()
            .map(|j| j.join().expect("zstd thread panicked"))
            .collect::<io::Result<Vec<_>>>()
    })?;
    println!(
        "compressed at zstd level {ZSTD_LEVEL} in {:.1?}",
        start.elapsed()
    );

    let mut zip = Vec::new();
    let mut writer = ZipArchiveWriter::new(&mut zip);
    for ((name, data), packed) in files.iter().zip(&compressed) {
        let (mut entry, _) = writer
            .new_file(name)
            .compression_method(CompressionMethod::ZSTD)
            .last_modified(rawzip::time::UtcDateTime::from_unix(MODIFIED_UNIX))
            .unix_permissions(0o644)
            .start()?;
        entry.write_all(packed)?;
        let descriptor = rawzip::DataDescriptorOutput::new(rawzip::crc32(data), data.len() as u64);
        entry.finish(descriptor)?;
    }
    writer.finish()?;

    fs::create_dir_all(out.parent().unwrap())?;
    let tmp = out.with_extension("zip.tmp");
    fs::write(&tmp, &zip)?;
    verify(&tmp)?;
    fs::rename(&tmp, &out)?;
    println!("wrote {}", out.display());
    report(&out)
}

/// Download silesia.zip into the cache unless a verified copy is there.
fn fetch(path: &Path) -> Result<()> {
    if path.exists() && sha256(&fs::read(path)?) == SILESIA_SHA256 {
        return Ok(());
    }
    println!("downloading {SILESIA_URL}");
    fs::create_dir_all(path.parent().unwrap())?;
    let response = ureq::get(SILESIA_URL).call()?;
    let mut data = Vec::new();
    response.into_body().into_reader().read_to_end(&mut data)?;
    let actual = sha256(&data);
    if actual != SILESIA_SHA256 {
        return Err(format!("silesia.zip SHA-256 {actual}, expected {SILESIA_SHA256}").into());
    }
    let tmp = path.with_extension("zip.tmp");
    fs::write(&tmp, &data)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// The archive holds exactly the subset, each entry once and zstd-compressed,
/// passing zip's CRC and size checks and matching its pinned SHA-256.
fn verify(path: &Path) -> Result<()> {
    let bytes = fs::read(path)?;
    let archive = ZipArchive::from_slice(&bytes)?;
    let mut entries = archive.entries();
    let mut seen = std::collections::BTreeSet::new();
    while let Some(entry) = entries.next_entry()? {
        let name = std::str::from_utf8(entry.file_path().as_ref())?.to_string();
        if seen.contains(&name) {
            return Err(format!("duplicate entry {name}").into());
        }
        let &(_, size, sha) = SUBSET
            .iter()
            .find(|(n, _, _)| *n == name)
            .ok_or_else(|| format!("unexpected entry {name}"))?;
        if entry.compression_method() != CompressionMethod::ZSTD {
            return Err(format!("{name} is not zstd-compressed").into());
        }
        let local = archive.get_entry(entry.wayfinder())?;
        let decoder = zstd::stream::read::Decoder::with_buffer(local.data())?;
        let mut data = Vec::with_capacity(size as usize);
        local.verifying_reader(decoder).read_to_end(&mut data)?;
        check(&name, &data, size, sha)?;
        seen.insert(name);
    }
    let missing: Vec<&str> = SUBSET
        .iter()
        .map(|(n, _, _)| *n)
        .filter(|n| !seen.contains(*n))
        .collect();
    if !missing.is_empty() {
        return Err(format!("missing entries: {}", missing.join(", ")).into());
    }
    Ok(())
}

fn check(name: &str, data: &[u8], size: u64, sha: &str) -> Result<()> {
    if data.len() as u64 != size {
        return Err(format!("{name}: {} bytes, expected {size}", data.len()).into());
    }
    let actual = sha256(data);
    if actual != sha {
        return Err(format!("{name}: SHA-256 {actual}, expected {sha}").into());
    }
    Ok(())
}

fn report(path: &Path) -> Result<()> {
    let bytes = fs::read(path)?;
    let archive = ZipArchive::from_slice(&bytes)?;
    let mut entries = archive.entries();
    println!(
        "{:<10} {:>12} {:>12} {:>7}",
        "entry", "uncompressed", "compressed", "ratio"
    );
    while let Some(e) = entries.next_entry()? {
        let (u, c) = (e.uncompressed_size_hint(), e.compressed_size_hint());
        let name = String::from_utf8_lossy(e.file_path().as_ref()).into_owned();
        println!("{name:<10} {u:>12} {c:>12} {:>7.2}", u as f64 / c as f64);
    }
    println!("{:<10} {:>12} {:>12}", "archive", "", bytes.len());
    Ok(())
}

fn sha256(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
