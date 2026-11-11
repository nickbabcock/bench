/**
 * The Compression page's main points for a whole reference edition: every
 * input, every browser and every machine at once, so they don't change
 * when a switch does (the switches drive the figures and their titles).
 *
 * Each point is built cell by cell from claims that hold in every capture
 * of that cell (the same gates the figure findings use: `cellBands` for
 * time against bandwidth, `reproducedIn` for decoder tiers), and says
 * where cells disagree ("on 3 of 4 inputs") instead of averaging. Every
 * range comes from the cells that hold the claim.
 */
import { archLabel, type Cell, engineScope, inputScope, listText, reproducedIn, scopeOf, withinBudget } from "@/lib/findings";
import { type Family, familyInfo, type FormatId, formatInfo } from "./codecs";
import { cellBands, choiceName, type CompressionCell, rangeText, tierKey } from "./findings";
import { type Band, BANDWIDTH, bandwidthText, GRID, rankAt, type Scenario, timeAt, transferLines, UNCOMPRESSED } from "./transfer";

/** One input in one engine on one machine: its shown capture and the replicates that gate it. */
export type EditionCell = { cell: CompressionCell; replicates: readonly CompressionCell[] };

/** A main point and the figure it cites. */
export type EditionPoint = { figure: number; key: string; text: string };

const cellsOf = (cs: readonly EditionCell[]) => cs.map((c) => c.cell);

/**
 * What one cell is, in words, for counts: "input–browser pairs" with
 * several inputs and browsers, "inputs" with one browser, and so on.
 */
export function cellNoun(all: readonly Cell[]): string {
  const dims = [
    new Set(all.map((c) => c.input)).size > 1 ? "input" : "",
    new Set(all.map((c) => c.engine)).size > 1 ? "browser" : "",
    new Set(all.map((c) => c.machine.id)).size > 1 ? "machine" : "",
  ].filter(Boolean);
  if (dims.length === 0) {
    return "runs";
  }
  return dims.length === 1 ? `${dims[0]}s` : `${dims.join("–")} ${dims.length === 2 ? "pairs" : "settings"}`;
}

/** "in 5 of 12 input–browser pairs", "in all 12 input–browser pairs". */
export const countScope = (held: readonly Cell[], all: readonly Cell[]) =>
  held.length === all.length ? `in all ${all.length} ${cellNoun(all)}` : `in ${held.length} of ${all.length} ${cellNoun(all)}`;

/**
 * Where a claim holds, as briefly as it can be said: "on 3 of 4 inputs, in
 * all 3 browsers" when the held cells form a grid, else a count ("in 11 of
 * 12 input–browser pairs").
 */
export function whereText(held: readonly Cell[], all: readonly Cell[]): string {
  const s = scopeOf(held, all);
  return s && !s.includes(";") ? s : countScope(held, all);
}

// ---------------------------------------------------------------------------
// Figures 1 and 2: which configuration is fastest, at which bandwidths
// ---------------------------------------------------------------------------

type Claimed = { band: Band; name: string };

/** A cell's gated winners, lowest bandwidth first: the same winner in every capture, by the 3% rule. */
function claimedIn(c: EditionCell, scenario: Scenario): Claimed[] {
  const bands = cellBands(
    c.cell,
    scenario,
    c.replicates.map((r) => [r]),
  );
  return bands.filter((b) => b.winner).map((band) => ({ band, name: choiceName(c.cell, band.winner!) }));
}

/** The stretch every band holds over: the highest lower edge to the lowest upper edge (`null` is the end of the range). */
function common(bands: readonly Pick<Band, "lo" | "hi">[]): { lo: number | null; hi: number | null } | undefined {
  const los = bands.flatMap((b) => (b.lo === null ? [] : [b.lo]));
  const his = bands.flatMap((b) => (b.hi === null ? [] : [b.hi]));
  const lo = los.length ? Math.max(...los) : null;
  const hi = his.length ? Math.min(...his) : null;
  return lo !== null && hi !== null && lo >= hi ? undefined : { lo, hi };
}

/**
 * The stretch every held cell's band covers, in words: "from ≈100 to 300
 * Mbps", "above ≈50 Mbps", "below ≈20 Mbps", "at every bandwidth from
 * 1 Mbps to 1 Gbps". Each cell's band may reach further.
 */
function commonText(bands: readonly Pick<Band, "lo" | "hi">[]): string {
  const c = common(bands);
  if (!c) {
    return "over bandwidths that differed by setting";
  }
  return c.lo === null && c.hi === null ? "at every bandwidth from 1 Mbps to 1 Gbps" : rangeText(c);
}

const past: Record<Scenario, string> = { download: "downloaded", upload: "uploaded" };

/**
 * One configuration's fastest stretch over the cells where it holds: the
 * configuration claimed in the most cells, over the stretch every one of
 * them holds: "Of the levels tested, zstd 15 downloaded fastest from ≈100
 * to 300 Mbps on 3 of 4 inputs, in all 3 browsers (Figure 1)."
 */
function oneWinner(cells: readonly EditionCell[], scenario: Scenario, figure: number, per: readonly Claimed[][]): EditionPoint | undefined {
  const names = [...new Set(per.flat().map((x) => x.name))];
  const count = (n: string) => per.filter((cs) => cs.some((x) => x.name === n)).length;
  const best = names.sort((a, b) => count(b) - count(a))[0];
  if (best === undefined) {
    return undefined;
  }
  const heldIdx = per.flatMap((cs, i) => (cs.some((x) => x.name === best) ? [i] : []));
  const held = heldIdx.map((i) => cells[i].cell);
  const bands = heldIdx.map((i) => per[i].find((x) => x.name === best)!.band);
  const where = commonText(bands);
  const all = cellsOf(cells);
  const cite = `(Figure ${figure})`;
  const tested = "Of the levels tested";
  const text = withinBudget([
    `${tested}, ${best} ${past[scenario]} fastest ${where} ${scopeOf(held, all) || countScope(held, all)} ${cite}.`,
    `${tested}, ${best} ${past[scenario]} fastest ${where} ${countScope(held, all)} ${cite}.`,
  ]);
  return { figure, key: `compression.edition.${scenario}:${best}`, text };
}

/** "zstd 9, zstd 3 then zstd 1"; with `compact`, one codec's levels share its name: "zstd 9, 3 then 1". */
function sequenceText(names: readonly string[], compact: boolean): string {
  const parsed = names.map((n) => /^(.*) (\d+)$/.exec(n));
  const shared = compact && parsed.every((m) => m && m[1] === parsed[0]![1]);
  const shown = shared ? names.map((n, i) => (i === 0 ? n : parsed[i]![2])) : names;
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} then ${shown.at(-1)}`;
}

/** "≈20", "≈10–100": a span of stated bandwidths, unit left to the caller. */
function spanNumber(lo: number, hi: number): string {
  const n = (x: number) => `${+x.toPrecision(3)}`;
  return lo === hi ? `≈${n(lo)}` : `≈${n(lo)}–${n(hi)}`;
}

/** "≈10–100 and ≈150–500 Mbps", "≈20 Mbps–1 Gbps": the crossover spans, one unit at the end where they share it. */
function spansText(spans: readonly [number, number][]): string {
  const mega = spans.every(([, hi]) => hi < 1000);
  if (mega) {
    return `${listText(spans.map(([lo, hi]) => spanNumber(lo, hi)))} Mbps`;
  }
  return listText(spans.map(([lo, hi]) => (lo === hi ? `≈${bandwidthText(lo)}` : `≈${bandwidthText(lo)}–${bandwidthText(hi)}`)));
}

/**
 * A sequence of winners as bandwidth rises, with where each hands over to
 * the next across the cells that share the sequence: "For uploads, zstd
 * 9, 3 then 1 led as bandwidth rose, switching at ≈10–100 and ≈150–500
 * Mbps, in 11 of 12 input–browser pairs (Figure 2)."
 */
function winnerSequence(cells: readonly EditionCell[], scenario: Scenario, figure: number, per: readonly Claimed[][]): EditionPoint | undefined {
  const keyOf = (cs: readonly Claimed[]) => cs.map((x) => x.name).join(">");
  const keys = per.map(keyOf).filter(Boolean);
  const freq = new Map<string, number>();
  for (const k of keys) {
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const top = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (top === undefined) {
    return undefined;
  }
  const heldIdx = per.flatMap((cs, i) => (keyOf(cs) === top ? [i] : []));
  const seq = per[heldIdx[0]].map((x) => x.name);
  if (seq.length < 2) {
    return oneWinner(cells, scenario, figure, per);
  }
  // Where each winner hands over: between its stated upper edge and the next one's stated lower edge, in each cell.
  const spans = seq.slice(1).map((_, k): [number, number] => {
    const his = heldIdx.map((i) => per[i][k].band.hi ?? BANDWIDTH.hi);
    const los = heldIdx.map((i) => per[i][k + 1].band.lo ?? BANDWIDTH.lo);
    return [Math.min(...his), Math.max(...los)];
  });
  const held = heldIdx.map((i) => cells[i].cell);
  const all = cellsOf(cells);
  const where = held.length === all.length ? whereText(held, all) : countScope(held, all);
  const cite = `(Figure ${figure})`;
  const to = `For ${scenario}s`;
  const switching = `switching at ${spansText(spans)}`;
  // The figure shows where each winner hands over, so the point names the
  // agreement and its exceptions rather than restating bandwidth ranges.
  const others = per.flatMap((cs, i) => (keyOf(cs) === top ? [] : [i]));
  const named = others.length > 0 && others.length <= 2 ? others.map((i) => exceptionText(cells[i].cell, per[i].map((x) => x.name), seq, cells)) : undefined;
  const but = others.length === 0 ? "in every input and browser" : named ? `except for ${listText(named)}` : undefined;
  const text = withinBudget([
    ...(but
      ? [false, true].flatMap((compact) => [
          `${to}, of the levels tested, ${sequenceText(seq, compact)} led as bandwidth rose, ${but} ${cite}.`,
          `${to}, ${sequenceText(seq, compact)} led as bandwidth rose, ${but} ${cite}.`,
        ])
      : []),
    ...[false, true].flatMap((compact) => [
      `${to}, of the levels tested, ${sequenceText(seq, compact)} led as bandwidth rose, ${switching}, ${where} ${cite}.`,
      `${to}, ${sequenceText(seq, compact)} led as bandwidth rose, ${switching}, ${where} ${cite}.`,
    ]),
  ]);
  return { figure, key: `compression.edition.${scenario}:${top}`, text };
}

/**
 * One cell that departs from the common sequence of winners, in words:
 * "xml in Chrome, which starts with brotli 9" when it only adds winners at
 * the low end, "x-ray in Safari, with no clear winner" when nothing was
 * claimed, else "samba in Firefox, which differs". The machine is named
 * only when the edition has more than one.
 */
function exceptionText(cell: Cell, names: readonly string[], seq: readonly string[], cells: readonly EditionCell[]): string {
  const machines = new Set(cells.map((c) => c.cell.machine.id));
  const label = `${cell.input ?? "this input"} in ${cell.engine}${machines.size > 1 ? ` on ${archLabel(cell.machine.arch)}` : ""}`;
  if (names.length === 0) {
    return `${label}, with no clear winner`;
  }
  const extra = names.length - seq.length;
  if (extra > 0 && names.slice(extra).join(">") === seq.join(">")) {
    return `${label}, which starts with ${listText(names.slice(0, extra))}`;
  }
  return `${label}, which differs`;
}

/**
 * The configuration that was the fastest, or close to it, at every
 * bandwidth in every cell and capture: the one whose largest shortfall
 * against the fastest (its time ÷ the fastest's − 1) is smallest. Only
 * when that shortfall is under the 3% gate, so it never contradicts a
 * claim. `pct` is that shortfall in whole percent, rounded up.
 */
export function nearEverywhere(cells: readonly EditionCell[], scenario: Scenario, grid: readonly number[] = GRID): { id: string; name: string; pct: number } | undefined {
  const captures = cells.flatMap((c) => [c.cell, ...c.replicates].map((x) => transferLines(x.rows, scenario)));
  if (captures.length === 0 || captures.some((ls) => ls.length < 2)) {
    return undefined;
  }
  const ids = captures[0].map((l) => l.id).filter((id) => id !== UNCOMPRESSED && captures.every((ls) => ls.some((l) => l.id === id)));
  const worst = ids.map((id) => ({
    id,
    short: Math.max(
      ...captures.flatMap((ls) => {
        const line = ls.find((l) => l.id === id)!;
        return grid.map((b) => timeAt(line, b) / rankAt(ls, b)[0].ms - 1);
      }),
    ),
  }));
  const best = worst.sort((a, b) => a.short - b.short)[0];
  if (!best || best.short >= 0.03) {
    return undefined;
  }
  return { id: best.id, name: choiceName(cells[0].cell, best.id), pct: Math.max(1, Math.ceil(best.short * 100 - 1e-9)) };
}

/**
 * Where a claim holds, briefly, when it doesn't hold everywhere: "except on
 * x-ray" when it holds in every browser on all but one or two inputs, else
 * a count ("in 11 of 12 input–browser pairs").
 */
function exceptText(held: readonly Cell[], all: readonly Cell[]): string {
  if (held.length === all.length) {
    return "";
  }
  const inputs = [...new Set(all.flatMap((c) => (c.input === null ? [] : [c.input])))];
  const full = inputs.filter((i) => all.filter((c) => c.input === i).every((c) => held.includes(c)));
  const missing = inputs.filter((i) => !full.includes(i));
  const grid = held.every((c) => c.input !== null && full.includes(c.input));
  return grid && missing.length > 0 && missing.length <= 2 ? `except on ${listText(missing)}` : countScope(held, all);
}

/**
 * Figure 1: the configuration that was fastest or within a few percent of
 * it everywhere, and where it was clearly fastest: "Of the levels tested,
 * zstd 15 downloaded fastest or within 1% everywhere; clearly fastest
 * from ≈100 to 200 Mbps except on x-ray (Figure 1)." Without one,
 * the configuration claimed in the most cells.
 */
function downloadPoint(cells: readonly EditionCell[], figure: number, per: readonly Claimed[][]): EditionPoint | undefined {
  const near = nearEverywhere(cells, "download");
  if (!near) {
    return oneWinner(cells, "download", figure, per);
  }
  const heldIdx = per.flatMap((cs, i) => (cs.some((x) => x.band.winner === near.id) ? [i] : []));
  const held = heldIdx.map((i) => cells[i].cell);
  const all = cellsOf(cells);
  const bands = heldIdx.map((i) => per[i].find((x) => x.band.winner === near.id)!.band);
  const c = bands.length ? common(bands) : undefined;
  const lead = (ofIt: boolean) => `Of the levels tested, ${near.name} downloaded fastest or within ${near.pct}%${ofIt ? " of the fastest" : ""} everywhere`;
  const cite = `(Figure ${figure})`;
  const clearly = c ? `clearly fastest ${commonText(bands)}` : "";
  const where = exceptText(held, all);
  const text = withinBudget([
    ...(clearly ? [true, false].map((ofIt) => `${lead(ofIt)}; ${clearly}${where ? ` ${where}` : ""} ${cite}.`) : []),
    `${lead(true)} ${cite}.`,
  ]);
  return { figure, key: `compression.edition.download-near:${near.id}`, text };
}

/** Figure 1 (download) or 2 (upload), over the edition. */
export function transferPoint(cells: readonly EditionCell[], scenario: Scenario, figure: number): EditionPoint | undefined {
  if (cells.length === 0) {
    return undefined;
  }
  const per = cells.map((c) => claimedIn(c, scenario));
  return scenario === "download" ? downloadPoint(cells, figure, per) : winnerSequence(cells, scenario, figure, per);
}

// ---------------------------------------------------------------------------
// The fastest decoders
// ---------------------------------------------------------------------------

/** A cell's fastest decoder tier, where it stands clear and every replicate agrees on its members. */
export function gatedTier(c: EditionCell, format: FormatId): Family[] | undefined {
  const key = reproducedIn(
    c.replicates.length ? c.replicates.map((r) => [r]) : undefined,
    (x: CompressionCell) => tierKey(x.rows, format),
  )(c.cell);
  return key ? (key.split("+") as Family[]) : undefined;
}

/**
 * The decoders that were in the clearly fastest group wherever one was:
 * "libdeflate, zlib-rs and zune-inflate were among the fastest Deflate
 * decoders wherever a group led clearly: 5 of 12 pairs (Figure 7,
 * per input and browser)."
 */
export function decoderPoint(cells: readonly EditionCell[], format: FormatId, figure: number): EditionPoint | undefined {
  const tiers = cells.map((c) => gatedTier(c, format));
  const clear = tiers.flatMap((t) => (t ? [t] : []));
  if (clear.length === 0) {
    return undefined;
  }
  const members = clear[0].filter((f) => clear.every((t) => t.includes(f)));
  if (members.length === 0) {
    return undefined;
  }
  const names = listText(members.map((f) => familyInfo[f].name).sort((a, b) => a.localeCompare(b)));
  const all = cellsOf(cells);
  const held = cells.flatMap((c, i) => (tiers[i] ? [c.cell] : []));
  const F = formatInfo[format].name;
  // The figure sits in the details section and follows the switches, so the
  // citation says so: this point covers the edition, the figure one pair.
  const cite = `(Figure ${figure}, per input and browser)`;
  // "The fastest" only where it led alone in every cell; else one of a group that may hold a faster decoder.
  const one = members.length === 1 && clear.every((t) => t.length === 1);
  const among = one ? `was the fastest ${F} decoder` : `${members.length === 1 ? "was" : "were"} among the fastest ${F} decoders`;
  const text = withinBudget(
    held.length === all.length
      ? [`${names} ${among} in every input and browser ${cite}.`]
      : [
          `${names} ${among} wherever a group led clearly: ${held.length} of ${all.length} input–browser pairs ${cite}.`,
          `${names} ${among} wherever a group led clearly: ${held.length} of ${all.length} pairs ${cite}.`,
        ],
  );
  return { figure, key: `compression.edition.${format}-decode-tier:${members.sort().join("+")}`, text };
}

// ---------------------------------------------------------------------------
// Browser dependence: wasm codecs against the browser's own and JavaScript
// ---------------------------------------------------------------------------

/** One input on one machine: every capture of the base engine and of each other engine, out-of-date rows left out on both sides. */
export type EngineGroup = {
  input: string | null;
  machine: string;
  base: { engine: string; captures: readonly CompressionCell[] };
  others: readonly { engine: string; captures: readonly CompressionCell[] }[];
};

type Runtime = (typeof familyInfo)[Family]["runtime"];
type Metric = "decode" | "encode";
const metrics: readonly Metric[] = ["decode", "encode"];

/** One configuration's speed in another engine ÷ in the base engine, for one capture (capture i with capture i). */
export type EngineRatio = { engine: string; input: string | null; family: Family; metric: Metric; ratio: number };

/** Other ÷ base speed for every configuration, metric and capture (capture i with capture i), by family. */
function speedRatios(g: EngineGroup, other: EngineGroup["others"][number], formats: readonly FormatId[]) {
  const out: { family: Family; metric: Metric; ratio: number }[] = [];
  const n = Math.min(g.base.captures.length, other.captures.length);
  for (let i = 0; i < n; i++) {
    const ob = new Map(other.captures[i].rows.map((r) => [r.id, r]));
    for (const r of g.base.captures[i].rows) {
      const o = ob.get(r.id);
      if (!o || r.roundTrip === false || o.roundTrip === false || !formats.includes(familyInfo[r.family].format)) {
        continue;
      }
      for (const m of metrics) {
        const [a, b] = [r[m]?.median, o[m]?.median];
        if (a && b) {
          out.push({ family: r.family, metric: m, ratio: b / a });
        }
      }
    }
  }
  return out;
}

/** Every speed ratio against the base engine, over every group (input), engine, capture and level. */
export const engineRatios = (groups: readonly EngineGroup[], formats: readonly FormatId[]): EngineRatio[] =>
  groups.flatMap((g) => g.others.flatMap((o) => speedRatios(g, o, formats).map((x) => ({ ...x, engine: o.engine, input: g.input }))));

/**
 * How far each runtime strayed from the base engine in one group and
 * capture: the largest |other ÷ base − 1| over its configurations, in any
 * other engine, capture by capture.
 */
function spreads(g: EngineGroup, formats: readonly FormatId[]): Partial<Record<Runtime, number>>[] {
  const n = Math.min(g.base.captures.length, ...g.others.map((o) => o.captures.length));
  return Array.from({ length: n }, (_, i) => {
    const out: Partial<Record<Runtime, number>> = {};
    for (const o of g.others) {
      const one = { ...g, base: { ...g.base, captures: [g.base.captures[i]] } };
      for (const x of speedRatios(one, { ...o, captures: [o.captures[i]] }, formats)) {
        const rt = familyInfo[x.family].runtime;
        out[rt] = Math.max(out[rt] ?? 0, Math.abs(x.ratio - 1));
      }
    }
    return out;
  });
}

const runtimeLabel: Record<Exclude<Runtime, "Wasm">, string> = { Browser: "built-in gzip", JS: "the JavaScript libraries" };

/** "0.73–1.23×": a range of speed ratios, widened outward to two decimals so it covers every value. */
export function ratioRange(xs: readonly number[]): string {
  const lo = Math.floor(Math.min(...xs) * 100 + 1e-9) / 100;
  const hi = Math.ceil(Math.max(...xs) * 100 - 1e-9) / 100;
  return lo === hi ? `${lo.toFixed(2)}×` : `${lo.toFixed(2)}–${hi.toFixed(2)}×`;
}

/**
 * How much the browser mattered: the wasm codecs' speed in the other
 * engines against the base engine's, and the range of the runtimes that
 * strayed further. A runtime is named only where, in every group (input
 * and machine) and every capture, it strayed beyond the wasm codecs'
 * furthest move.
 * "In Firefox and Safari, the wasm Deflate codecs ran at 0.73–1.23×
 * Chrome's speed; built-in gzip and the JavaScript libraries at
 * 0.32–2.55× (Figure 3)."
 */
export function browserPoint(groups: readonly EngineGroup[], formats: readonly FormatId[], figure: number): EditionPoint | undefined {
  const used = groups.filter((g) => g.others.length > 0 && g.base.captures.length > 0);
  const ss = used.flatMap((g) => spreads(g, formats));
  if (ss.length === 0 || ss.some((s) => s.Wasm === undefined)) {
    return undefined;
  }
  const bound = Math.max(...ss.map((s) => s.Wasm!));
  const strayed = (["Browser", "JS"] as const).filter((rt) => ss.every((s) => s[rt] !== undefined && s[rt]! > bound));
  if (strayed.length === 0) {
    return undefined;
  }
  const ratios = engineRatios(used, formats);
  const of = (rts: readonly Runtime[]) => ratios.filter((x) => rts.includes(familyInfo[x.family].runtime)).map((x) => x.ratio);
  const baseName = used[0].base.engine;
  const engines = [...new Set(used.flatMap((g) => g.others.map((o) => o.engine)))];
  const inputs = [...new Set(groups.map((g) => g.input).filter((x): x is string => x !== null))];
  const heldInputs = [...new Set(used.map((g) => g.input).filter((x): x is string => x !== null))];
  const on = heldInputs.length < inputs.length ? ` ${inputScope(heldInputs, inputs)}` : "";
  const what = formats.length === 1 ? `${formatInfo[formats[0]].name} ` : "";
  const where = engineScope(engines, engines).replace(/^in/, "In");
  const text = `${where}${on}, the wasm ${what}codecs ran at ${ratioRange(of(["Wasm"]))} ${baseName}'s speed; ${listText(strayed.map((rt) => runtimeLabel[rt]))} at ${ratioRange(of(strayed))} (Figure ${figure}).`;
  return { figure, key: `compression.edition.engines:${strayed.join("+")}`, text };
}

/** Every main point of the edition, in figure order: download, upload, how much the browser mattered, then the fastest decoders. */
export function editionPoints(
  cells: readonly EditionCell[],
  groups: readonly EngineGroup[],
  plan: { downloadMap: number; uploadMap: number; browsers?: number; impl: readonly { format: FormatId; decode: number }[] },
): EditionPoint[] {
  const impl = plan.impl[0];
  const points = [
    transferPoint(cells, "download", plan.downloadMap),
    transferPoint(cells, "upload", plan.uploadMap),
    impl && plan.browsers !== undefined ? browserPoint(groups, [impl.format], plan.browsers) : undefined,
    impl ? decoderPoint(cells, impl.format, impl.decode) : undefined,
  ];
  return points.filter((p): p is EditionPoint => p !== undefined).slice(0, 4);
}
