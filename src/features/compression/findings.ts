/**
 * The Compression page's fixed questions for one input and browser,
 * answered from measurements:
 *
 * - which configuration makes one file usable soonest at each bandwidth,
 *   downloading or uploading (claims name configurations: "zstd 9");
 * - for each format with two or more implementations, which decoders are
 *   fastest by more than the encoder alone could explain;
 * - how much code each implementation ships.
 *
 * Comparisons are unpaired (each configuration is its own sample), never a
 * confidence interval.
 */
import { type Answer, ask, type Cell, cellKey, engineScope, type FigureQuestion, type Finding, gate, inputScope, listText, POINT_WORDS, reproducedIn, times, wordCount } from "@/lib/findings";
import { formatSig } from "@/lib/format";
import { type Family, familyInfo, type FormatId, formatInfo } from "./codecs";
import type { Row } from "./results";
import { type Band, bandsOf, BANDWIDTH, bandwidthText, type Line, rankAt, roundNice, type Scenario, timeText, transferLines, UNCOMPRESSED } from "./transfer";

/** One capture's rows on one input, in one engine on one machine. */
export type CompressionCell = Cell & { rows: Row[] };

const famName = (f: Family) => familyInfo[f].name;

const inputsOf = (cs: readonly CompressionCell[]) => cs.flatMap((c) => (c.input === null ? [] : [c.input]));

/** "on dickens in Chrome": a claim's scope, the input always named. */
function scopeText(cells: readonly CompressionCell[]): string {
  const engines = [...new Set(cells.map((c) => c.engine))];
  return [inputScope(inputsOf(cells), [...new Set(inputsOf(cells))], "inputs", true), engineScope(engines, engines)].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Choosing a codec and level: time until the data is usable
// ---------------------------------------------------------------------------

const noun: Record<Scenario, string> = { download: "download", upload: "upload" };

/** "zstd 9"; Uncompressed reads as an action: "no compression". */
export const choiceName = (cell: CompressionCell, id: string) => (id === UNCOMPRESSED ? "no compression" : (cell.rows.find((r) => r.id === id)?.label ?? id));

/** A stated band edge, the same in the text, the chart and the table: "≈20 Mbps", "≈1.5 Mbps". */
export const approx = (mbps: number) => `≈${bandwidthText(mbps)}`;

/**
 * Where a band holds, in words, from its stated edges: "below ≈20 Mbps",
 * "from ≈20 to 200 Mbps", "above ≈500 Mbps", "across 1 Mbps–1 Gbps".
 */
export function rangeText(b: Pick<Band, "lo" | "hi">): string {
  if (b.lo === null) {
    return b.hi === null ? "across 1 Mbps–1 Gbps" : `below ${approx(b.hi)}`;
  }
  if (b.hi === null) {
    return `above ${approx(b.lo)}`;
  }
  return `from ≈${b.hi < 1000 ? +b.lo.toPrecision(3) : bandwidthText(b.lo)} to ${bandwidthText(b.hi)}`;
}

/** A band's stated span, for the text, the table and the chart: "≈2–10 Mbps", "below ≈20 Mbps", "1 Mbps–1 Gbps". */
export function bandText(b: Pick<Band, "lo" | "hi">): string {
  if (b.lo === null) {
    return b.hi === null ? "1 Mbps–1 Gbps" : `below ${approx(b.hi)}`;
  }
  if (b.hi === null) {
    return `above ${approx(b.lo)}`;
  }
  return `≈${+b.lo.toPrecision(3)}–${bandwidthText(b.hi)}`;
}

/**
 * Time per file against bandwidth, to download or to upload. The claim names
 * each band's winner where it is fastest by more than 3% over the
 * runner-up (medians) with the same winner in every capture (`bandsOf`),
 * and the same bands in every cell; edges are stated as nice values where
 * the winner is still within 3% of the fastest. Elsewhere the leaders are
 * about the same.
 *
 * Every claim is "of the levels tested": a pre-compressed download pays
 * no compression time, so the highest levels win it, and static assets
 * usually use higher ones (brotli 11, zstd 19+) than this page measures.
 * The download figure always says so; the upload figure where the sentence has room.
 */
export const transferQuestion = (scenario: Scenario, figure: number): FigureQuestion<readonly CompressionCell[]> => ({
  figure,
  question:
    scenario === "download"
      ? "Which codec and level make a downloaded file usable soonest, at each bandwidth?"
      : "Which codec and level finish compressing and uploading a file soonest, at each bandwidth?",
  neutral: scenario === "download" ? "Time to download and decompress one file, by bandwidth" : "Time to compress and upload one file, by bandwidth",
  answer: (cells, replicates) => transferAnswer(cells, scenario, figure, replicates),
});

/** One cell's lines in the primary and in each replicate; empty when a replicate lacks the cell. */
export function cellLines(c: CompressionCell, scenario: Scenario, replicates?: readonly (readonly CompressionCell[])[]): Line[][] {
  const others = (replicates ?? []).map((rs) => rs.find((r) => cellKey(r) === cellKey(c)));
  if (others.some((o) => o === undefined)) {
    return [];
  }
  return [c, ...(others as CompressionCell[])].map((x) => transferLines(x.rows, scenario));
}

/** One cell's bands from its captures: this cell's lines in the primary and in each replicate. */
export const cellBands = (c: CompressionCell, scenario: Scenario, replicates?: readonly (readonly CompressionCell[])[]): Band[] => bandsOf(cellLines(c, scenario, replicates));

function transferAnswer(cells: readonly CompressionCell[], scenario: Scenario, figure: number, replicates: readonly (readonly CompressionCell[])[] | undefined): Answer {
  if (cells.length === 0) {
    return {};
  }
  const per = cells.map((c) => {
    const bands = cellBands(c, scenario, replicates);
    const claimed = bands.filter((b) => b.winner).map((band) => ({ band, name: choiceName(c, band.winner!), where: rangeText(band) }));
    return { c, bands, claimed, text: claimed.map((x) => `${x.name} ${x.where}`).join("|") };
  });
  // The same winners over the same stated bands in every cell, or nothing.
  if (per[0].claimed.length === 0 || per.some((p) => p.text !== per[0].text)) {
    return {};
  }
  const { c, bands, claimed } = per[0];
  const inputs = [...new Set(cells.map((x) => x.input ?? "this file"))];
  const engines = [...new Set(cells.map((x) => x.engine))];
  const subject = `${listText(inputs)} in ${listText(engines)}`;
  const to = `To ${noun[scenario]} ${subject}`;
  const cite = `(Figure ${figure})`;
  const fits = (t: string) => wordCount(t) <= POINT_WORDS;
  // Downloads always qualify their winners; uploads only where the sentence has room.
  const must = scenario === "download";
  const tested = "of the levels tested";
  // Each level of detail with the qualifier, then without it (uploads only), before giving up detail.
  const choose = (qualified: string[], plain: string[]) =>
    qualified.flatMap((q, i) => (must || !plain[i] ? [q] : [q, plain[i]])).find(fits) ?? qualified.at(-1)!;
  const ties = bands.filter((b) => !b.winner);
  let title: string;
  let text: string;
  if (claimed.length === 1) {
    const { band, where, name } = claimed[0];
    const what = band.winner === UNCOMPRESSED ? "Sending it uncompressed" : name;
    // The about-the-same stretch beside the band, if there is one with more than one contender.
    const i = bands.indexOf(band);
    const tie = [bands[i - 1], bands[i + 1]].find((b) => b && !b.winner && b.near.length > 1);
    const tieText = tie ? `; ${tie === bands[i - 1] ? "below" : "above"} that, ${listText(tie.near.slice(0, 3).map((id) => choiceName(c, id)))}${tie.near.length > 3 ? " and others" : ""} were about the same` : "";
    title = `${what} gave the fastest ${noun[scenario]} ${tested}, ${band.lo === null && band.hi === null ? "at every bandwidth from 1 Mbps to 1 Gbps" : where}${tieText}`;
    // One time to stand on: at 100 Mbps if the band holds there, else its stated middle, against not compressing.
    const [a, b] = [band.lo ?? BANDWIDTH.lo, band.hi ?? BANDWIDTH.hi];
    const ref = a <= 100 && b >= 100 ? 100 : roundNice(Math.sqrt(a * b));
    const ranked = rankAt(transferLines(c.rows, scenario), ref);
    const win = ranked.find((x) => x.line.id === band.winner)!;
    const other = band.winner === UNCOMPRESSED ? ranked.find((x) => x.line.id !== UNCOMPRESSED) : ranked.find((x) => x.line.id === UNCOMPRESSED);
    const against = other ? `, against ${timeText(other.ms)} ${band.winner === UNCOMPRESSED ? `with ${other.line.label}` : "uncompressed"}` : "";
    const at = `${timeText(win.ms)} at ${bandwidthText(ref)}`;
    text = choose(
      [`${to}, ${what} was fastest ${tested} ${where}: ${at}${against} ${cite}.`, `${to}, ${what} was fastest ${tested} ${where}: ${at} ${cite}.`, `${to}, ${what} was fastest ${tested} ${where} ${cite}.`],
      [`${to}, use ${name} ${where}: ${at}${against} ${cite}.`, `${to}, use ${name} ${where}: ${at} ${cite}.`],
    );
  } else {
    const [first, last] = [claimed[0], claimed.at(-1)!];
    title = `The fastest ${noun[scenario]} ${tested} went from ${first.name} to ${last.name} as bandwidth rose`;
    const all = listText(claimed.map((x) => `${x.name} ${x.where}`));
    const tieText = ties.length ? "; about the same between" : "";
    // Without room for every range, none: the winners in order, so no band reads as dropped.
    const order = `${claimed.slice(0, -1).map((x) => x.name).join(", ")} then ${last.name} led as bandwidth rose`;
    // Longest first: every band and the about-the-same note, then every band, then the order alone.
    text = choose(
      [`${to}, ${tested}, use ${all}${tieText} ${cite}.`, `${to}, ${tested}, use ${all} ${cite}.`, `${to}, ${tested}, ${order} ${cite}.`],
      [`${to}, use ${all}${tieText} ${cite}.`, `${to}, use ${all} ${cite}.`, `${to}, ${order} ${cite}.`],
    );
  }
  // Storage stays out of the main point: every bandwidth condition comes first, and a band
  // sentence with its about-the-same note leaves no room. The upload figure's table carries it.
  return {
    title,
    claim: {
      key: `compression.${scenario}:${claimed.map((x) => x.band.winner).join(">")}`,
      text,
      scope: `on ${subject}`,
      cells,
    },
  };
}

/**
 * Answer a question whose claim is built from every capture at once
 * (`bandsOf`): each capture is answered with the others as its
 * replicates, so every one makes the same joint claim, and the gate then
 * checks the key and cells as usual.
 */
export const askJoint = <D,>(q: FigureQuestion<D>, primary: D, replicates: readonly D[]): Finding =>
  gate(
    ask(q, primary, replicates),
    replicates.map((r, i) => ask(q, r, [primary, ...replicates.filter((_, k) => k !== i)])),
  );

// ---------------------------------------------------------------------------
// Choosing an implementation
// ---------------------------------------------------------------------------

/**
 * How far apart the encoders' streams alone can set two decoders. Each
 * decoder here reads its own encoder's output, and in a separate test
 * (six decoders on five encoders' streams, dickens and x-ray, Node 26 on
 * an Apple M4 Pro) the stream moved one decoder's speed by up to about
 * 1.2× at level 6. Two decoders each read a different stream, so one can
 * be up to 1.2× slow and the other 1.2× fast: up to 1.2² ≈ 1.44× apart
 * with no difference between the decoders themselves.
 */
export const STREAM_ALLOWANCE = 1.44;

/** A format's decoders as the page compares them: each implementation at the format's typical level, or its one default level. */
export function decoderRows(rows: readonly Row[], format: FormatId): Row[] {
  const level = formatInfo[format].typicalLevel;
  return rows.filter(
    (r) =>
      familyInfo[r.family].format === format &&
      !familyInfo[r.family].variantOf &&
      r.roundTrip !== false &&
      r.decode !== undefined &&
      (r.level === level || (r.level === null && familyInfo[r.family].levels.length === 1)),
  );
}

/**
 * Decoders in anchored tiers, fastest first: a tier starts at its fastest
 * decoder, and a slower one joins it only while it is within
 * STREAM_ALLOWANCE of that anchor. There is no chaining, so every tier
 * spans at most the allowance. A tier boundary on its own claims nothing:
 * the slowest of one tier can still be close to the fastest of the next
 * (`topTier`).
 */
export function decoderTiers(rows: readonly Row[], format: FormatId): Row[][] {
  const sorted = decoderRows(rows, format).sort((a, b) => b.decode!.median - a.decode!.median);
  const tiers: Row[][] = [];
  for (const r of sorted) {
    const tier = tiers.at(-1);
    if (tier && tier[0].decode!.median / r.decode!.median <= STREAM_ALLOWANCE) {
      tier.push(r);
    } else {
      tiers.push([r]);
    }
  }
  return tiers;
}

/** The fastest tier, when it is clearly ahead: its decoders, how far ahead of the next, and its own spread. */
export type TopTier = {
  rows: Row[];
  /** The tier's slowest ÷ the next tier's fastest, as a speed factor (> STREAM_ALLOWANCE). */
  gap: number;
  /** The tier's fastest ÷ its slowest (≤ STREAM_ALLOWANCE): a gap the encoder alone can cause. */
  spread: number;
};

/**
 * The fastest tier, only when even its slowest decoder is more than
 * STREAM_ALLOWANCE faster than the next tier's fastest: then no choice of
 * encoders could close the gap. Otherwise undefined: nothing is claimed.
 */
export function topTier(rows: readonly Row[], format: FormatId): TopTier | undefined {
  const tiers = decoderTiers(rows, format);
  if (tiers.length < 2) {
    return undefined;
  }
  const [top, next] = tiers;
  const gap = top.at(-1)!.decode!.median / next[0].decode!.median;
  return gap > STREAM_ALLOWANCE ? { rows: top, gap, spread: top[0].decode!.median / top.at(-1)!.decode!.median } : undefined;
}

/** A format's fastest tier as a key ("libdeflate+zlibrs"), when it stands clear. */
export const tierKey = (rows: readonly Row[], format: FormatId) =>
  topTier(rows, format)
    ?.rows.map((r) => r.family)
    .sort()
    .join("+");

/** "two", "three", … for "the top three". */
const countName = (n: number) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? String(n);

/**
 * Figure n: one format's decoders. The claim is the fastest tier against
 * the rest, made only where the gap clears the allowance (`topTier`) in
 * every cell, with the same members in every capture of that cell.
 */
export const decodeImplementations = (format: FormatId, figure: number): FigureQuestion<readonly CompressionCell[]> => {
  const F = formatInfo[format].name;
  const topKey = (c: CompressionCell) => tierKey(c.rows, format);
  return {
    figure,
    question: `Which ${F} decoders are fastest, by more than the encoder alone could explain?`,
    neutral: `${F} decoders by decompression speed`,
    answer: (cells, replicates) => {
      const top = reproducedIn(replicates, topKey);
      const keys = cells.map(top);
      if (cells.length === 0 || keys.some((k) => k === undefined || k !== keys[0])) {
        return {};
      }
      const tops = cells.map((c) => topTier(c.rows, format)!);
      const names = tops[0].rows.map((r) => famName(r.family));
      // The smallest gap over every cell, in every capture.
      const again = (replicates ?? []).flatMap((rs) => rs.map((c) => topTier(c.rows, format)?.gap ?? Infinity));
      const gap = Math.min(...tops.map((t) => t.gap), ...again);
      const scope = scopeText(cells);
      const several = names.length > 1;
      return {
        title: `${listText(names)} decoded at least ${times(gap)} faster than the rest`,
        claim: {
          key: `compression.${format}-decode-tier:${keys[0]}`,
          text: several
            ? `For fast ${F} decoding, any of the top ${countName(names.length)} will do: the encoder alone can reorder them, ${scope} (Figure ${figure}).`
            : `For fast ${F} decoding, use ${names[0]}: the encoder alone can't explain its lead, ${scope} (Figure ${figure}).`,
          scope,
          cells,
        },
      };
    },
  };
};

/** "51.2 kB": code sizes, 1 kB = 1000 bytes. */
export const kBText = (bytes: number) => `${formatSig(bytes / 1000)} kB`;

/** The code-size figure's title: what it measures. Code sizes are build facts, so the title states no claim. */
export const CODE_TITLE = "Download size of compression and decompression code";

/**
 * Gzipped decoder code per library, computed at build time (exact: no
 * spread, nothing to reproduce beyond the build). The main point is the
 * range: from nothing (built into the browser) to the largest decoder.
 */
export const codeSize = (figure: number): FigureQuestion<readonly CompressionCell[]> => ({
  figure,
  question: "How much code does each implementation ship to decompress?",
  neutral: CODE_TITLE,
  answer: (cells) => {
    const rows = cells.flatMap((c) => c.rows);
    const sizes = new Map<Row["family"], number>();
    for (const r of rows) {
      if (r.code?.decode && !familyInfo[r.family].variantOf) {
        sizes.set(r.family, r.code.decode);
      }
    }
    const sorted = [...sizes].sort((a, b) => a[1] - b[1]);
    if (sorted.length < 2) {
      return {};
    }
    const [small, smallBytes] = sorted[0];
    const [large, largeBytes] = sorted[sorted.length - 1];
    const builtIn = [...new Set(rows.filter((r) => r.code?.source === "built-in").map((r) => r.name))];
    const what = (f: Row["family"]) => (f === "pako" ? "pako's inflate build" : `${famName(f)}'s`);
    const lead = builtIn.length ? `${listText(builtIn)} ${builtIn.length > 1 ? "need" : "needs"} no download; the` : "The";
    return {
      title: CODE_TITLE,
      claim: {
        key: `compression.code-size:smallest:${small}`,
        text: `${lead} smallest library decoder is ${what(small)} at ${kBText(smallBytes)}, the largest ${what(large)} at ${kBText(largeBytes)} (Figure ${figure}).`,
        scope: "",
        cells,
      },
    };
  },
});

/**
 * Figure numbers for the page. Across inputs and browsers: the fastest
 * download and upload by bandwidth (maps), speed relative to the base
 * browser (for the first multi-implementation format) and code size. Then
 * the details of one input and browser: time against bandwidth to
 * download and to upload, and each multi-implementation format's
 * decoders. Last, this machine against the reference.
 */
export function figurePlan(implFormats: readonly FormatId[]) {
  let n = 1;
  const downloadMap = n++;
  const uploadMap = n++;
  const browsers = implFormats.length ? n++ : undefined;
  const code = n++;
  const download = n++;
  const upload = n++;
  const impl = implFormats.map((format) => ({ format, decode: n++ }));
  const relative = n++;
  return { downloadMap, uploadMap, browsers, code, download, upload, impl, relative };
}

/** Every question the page asks of one input and browser, in figure order. */
export function compressionQuestions(implFormats: readonly FormatId[]) {
  const plan = figurePlan(implFormats);
  return [codeSize(plan.code), transferQuestion("download", plan.download), transferQuestion("upload", plan.upload), ...plan.impl.map((p) => decodeImplementations(p.format, p.decode))];
}

/** This machine's main points, at most three, in this order: download, upload, each format's fastest decoders, then code size. */
export function pointFigures(implFormats: readonly FormatId[]): number[] {
  const plan = figurePlan(implFormats);
  return [plan.download, plan.upload, ...plan.impl.map((p) => p.decode), plan.code];
}
