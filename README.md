# Benchmarks

A site for hosting Wasm benchmarks. Originally used many years ago to diagnose a chromium bug[^chromium-bug]

[^chromium-bug]: https://bugs.chromium.org/p/chromium/issues/detail?id=1294262#c11

## Contributing

For convenience there is a Dev Container ([see tutorial](https://code.visualstudio.com/docs/devcontainers/containers#_installation)), otherwise install [mise](https://mise.jdx.dev/) to setup the dev environment:

```bash
mise install
npm ci
mise run build:wasm
mise run build:variants
mise run build:corpus
mise run dev
```

`build:wasm` builds the modules the Compression, Allocation, Memory64 and RefCell vs Mutex pages load into `src/wasm/`.

`build:locks` (part of `build:wasm`) builds `packages/lockbench` three times on the pinned nightly, with std built from source each time: `panic=abort`, `panic=unwind` and `+atomics`. The module comment in `packages/lockbench/src/lib.rs` gives the design rules of the workloads. To capture only this benchmark, without the others: `mise run capture -- --bench locks`.

`build:variants` builds the Build settings page's modules: a few crates rebuilt with SIMD off and on, each with wasm-opt off, `-Os` and `-O3`, into `src/wasm/variants/` with a manifest of sizes and flags per variant.

`build:corpus` builds the compression benchmark's inputs: it downloads the [Silesia corpus](https://sun.aei.polsl.pl/~sdeor/index.php?page=silesia) once (68 MB, checked against a pinned SHA-256 and cached in `.cache/corpus/`), repacks a few of its files into `public/corpus/silesia.zip` as zstd-compressed zip entries, and builds the wasm that reads them in the browser. Rerunning it is quick when the archive is already up to date.

`mise run build` runs all three, then `npm run build`.

Unit tests (statistics, findings, editions) run with `npm test`, and `npm run lint` runs oxlint.

### Reference captures

The figures on each page come from reference captures in `src/data/editions/<bench>/<edition>/<machine>/<browser>[-<input>].json`: one file per benchmark, machine, browser and input, recording the machine, browser, toolchain, commit, a SHA-256 per wasm module and corpus file, the method, and every per-round sample (schema in `src/lib/edition.ts`). `mise run capture` builds the site, serves it cross-origin isolated, and runs every benchmark through the unlinked `/capture` route in real Chrome, Firefox and, on macOS, Safari (enable Safari ▸ Settings ▸ Developer ▸ Allow Remote Automation first). It takes about an hour and a half; close other work first, and stay on AC power.

To capture on another machine (macOS or Linux), from a fresh clone of this branch:

```bash
# Linux only: clang compiles the C codecs; plus Google Chrome and Firefox
sudo apt install clang
# Firefox captures need geckodriver on PATH (or GECKODRIVER=/path/to/it):
# brew install geckodriver, or a release from github.com/mozilla/geckodriver.
# Ubuntu's snap Firefox ships its own, which the script finds.
mise install
npm ci
mise run build
mise run capture -- --machine <id>   # e.g. ryzen9-7950x-x86_64; defaults to the CPU model and arch
```

`--repeat 2` (the default) takes two independent captures, since a headline claim must reproduce in both. Other options (`--browsers`, `--bench`, `--inputs`, `--samples`) are listed in `scripts/capture.mjs`. Commit the new files under `src/data/editions/`.
