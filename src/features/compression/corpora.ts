import corpusWasm from "@/wasm/corpus_bg.wasm?url";
import { abortable } from "@/lib/bench";
import { load } from "@/lib/wasm";

/**
 * Built-in inputs: a subset of the Silesia corpus, the files zstd, lz4 and
 * brotli publish results against. `mise run build:corpus` repacks them into
 * one zip of zstd-compressed entries; the page fetches only the archive's
 * central directory and the chosen entry (HTTP range requests), then
 * decompresses it in wasm. Keep in sync with `SUBSET` in xtask/src/main.rs.
 */
export const corpora = [
  {
    id: "dickens",
    name: "dickens",
    label: "dickens",
    description: "collected works of Charles Dickens",
    bytes: 10_192_446,
  },
  {
    id: "xml",
    name: "xml",
    label: "xml",
    description: "a tar of XML files",
    bytes: 5_345_280,
  },
  {
    id: "x-ray",
    name: "x-ray",
    label: "x-ray",
    description: "a medical X-ray image",
    bytes: 8_474_240,
  },
  {
    id: "samba",
    name: "samba",
    label: "samba",
    description: "a tar of the Samba 2.2.3a sources",
    bytes: 21_606_400,
  },
] as const;

export type CorpusId = (typeof corpora)[number]["id"];
export type Corpus = (typeof corpora)[number];

export const corpusInfo = (id: CorpusId): Corpus => corpora.find((c) => c.id === id)!;

/** Whether an input name is one of the built-in corpus files. */
export const isCorpusId = (name: string | null | undefined): name is CorpusId => corpora.some((c) => c.id === name);

/**
 * One name per input everywhere: a corpus file by its label, "(Silesia)";
 * a built-in input not in the corpus list is from an older run on the
 * former synthetic inputs; anything else is the visitor's own file.
 */
export const inputName = (run: { filename: string; synthetic: boolean }) => {
  const corpus = run.synthetic ? corpora.find((c) => c.name === run.filename) : undefined;
  return corpus ? `${corpus.label} (Silesia)` : run.synthetic ? `${run.filename} (synthetic)` : run.filename;
};

/** Served from public/, same origin (the CSP allows nothing else). */
const ARCHIVE_URL = "/corpus/silesia.zip";

/** Enough to hold the central directory of a handful of entries. */
const TAIL_BYTES = 16 * 1024;

const corpusModule = load({ js: () => import("@/wasm/corpus"), wasm: corpusWasm });

type Bytes = Uint8Array<ArrayBuffer>;

/** The archive's bytes over `[start, end)`; `whole` if the server ignored Range. */
async function fetchRange(start: number, end: number, signal?: AbortSignal) {
  const res = await fetch(ARCHIVE_URL, { headers: { Range: `bytes=${start}-${end - 1}` }, signal });
  if (!res.ok) {
    throw new Error(`Couldn't fetch the corpus (${ARCHIVE_URL}): HTTP ${res.status}`);
  }
  const body = new Uint8Array(await res.arrayBuffer());
  if (res.status !== 206) {
    return { bytes: body.subarray(start, end), size: body.length, whole: body };
  }
  // Some servers send more than asked (Vite's reads `bytes=0-0` as the whole
  // file), so take the requested slice of whatever range came back.
  const contentRange = res.headers.get("Content-Range") ?? "";
  const [first, last, size] = (/^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange) ?? []).slice(1).map(Number);
  const stop = Math.min(end, size);
  if (!(first <= start && last + 1 >= stop && body.length === last + 1 - first)) {
    throw new Error(`Unexpected range response for the corpus: ${contentRange}`);
  }
  return { bytes: body.subarray(start - first, stop - first), size, whole: undefined };
}

type Opened = {
  archive: InstanceType<Awaited<ReturnType<typeof corpusModule>>["Archive"]>;
  /** The whole archive, when the server answered a range with all of it. */
  whole?: Bytes;
};

let opened: Promise<Opened> | undefined;

/** Load the reader and the archive's central directory, once per page. */
async function openArchive(): Promise<Opened> {
  const { Archive } = await corpusModule();
  // The first request learns the size (Content-Range); suffix ranges
  // (`bytes=-N`) aren't honoured by every static server, Vite's included,
  // and neither is a range ending at byte 0.
  const probe = await fetchRange(0, 2);
  if (probe.whole) {
    const whole = probe.whole;
    return { archive: new Archive(whole.subarray(Math.max(0, whole.length - TAIL_BYTES)), whole.length), whole };
  }
  const tail = await fetchRange(Math.max(0, probe.size - TAIL_BYTES), probe.size);
  return { archive: new Archive(tail.bytes, probe.size), whole: tail.whole };
}

/**
 * Fetch and decompress one corpus file. The bytes are a fresh copy the
 * caller owns (fine to transfer to a worker). Nothing here is timed by the
 * benchmark: the harness starts measuring only once it has the bytes.
 */
export async function loadCorpus(id: CorpusId, signal?: AbortSignal): Promise<{ name: string; bytes: Bytes }> {
  const corpus = corpusInfo(id);
  opened ??= openArchive().catch((e) => {
    opened = undefined;
    throw e;
  });
  // The archive is opened once and shared, so a cancel stops this wait at
  // once (the open itself carries on, for the next run) instead of
  // holding the run, and its claim on the page, until the fetch ends.
  const archive = await (signal ? abortable(opened, signal) : opened);
  signal?.throwIfAborted();
  const [start, end] = archive.archive.entryRange(corpus.name);
  let packed: Uint8Array;
  if (archive.whole) {
    packed = archive.whole.subarray(start, end);
  } else {
    const res = await fetchRange(start, end, signal);
    archive.whole = res.whole;
    packed = res.bytes;
  }
  const bytes = archive.archive.extract(corpus.name, packed) as Bytes;
  if (bytes.length !== corpus.bytes) {
    throw new Error(`${corpus.name} decompressed to ${bytes.length} bytes, expected ${corpus.bytes}`);
  }
  return { name: corpus.name, bytes };
}
