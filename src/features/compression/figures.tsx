/**
 * The Compression release's figures and table, drawn from one dataset
 * (a reference capture or this machine's run) with the shared chart kit.
 */
import { clsx } from "clsx";
import { useMemo } from "react";
import { DotRange, type DotRangeRow, type Panel, RowChart, type RowBase, Tip } from "@/components/charts";
import { textWidth } from "@/components/charts/text";
import { type Column, DataTable, Figure } from "@/components/release";
import type { Finding, Relative } from "@/lib/findings";
import { formatMBps, plural } from "@/lib/format";
import { type Family, families, familyInfo, type FormatId, formatInfo, formats } from "./codecs";
import { codeGzipLevel } from "./codeSize";
import { decoderRows, kBText, STREAM_ALLOWANCE, topTier } from "./findings";
import type { Row } from "./results";

/** One dataset as the figures draw it. */
export type View = {
  mine: boolean;
  rows: Row[];
  /** "dickens", or the visitor's file name. */
  input: string;
  /** Samples per configuration (the fewest any measured row got). */
  samples: number;
  /** A partial run: how many configurations were measured, of how many planned. */
  partial?: { measured: number; total: number };
  /** One sample per configuration: nothing is highlighted or compared. */
  exploratory: boolean;
};

export const TABLE_ID = "all-configurations";

const tickFormat = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });
const mb = (bps: number) => bps / 1e6;
const formatName = (r: Row) => formatInfo[familyInfo[r.family].format].name;

/** The second line under a library's name in the table. */
const detailOf = (family: Row["family"]) => {
  const info = familyInfo[family];
  if (info.decodesFrom) {
    return `decodes ${familyInfo[info.decodesFrom.family].name} ${info.decodesFrom.level} output`;
  }
  return info.runtime === "Browser" ? "CompressionStream" : info.runtime === "JS" ? "JavaScript" : undefined;
};

const partialNote = (v: View) => (v.partial ? ` Only the ${v.partial.measured} of ${v.partial.total} configurations measured before the run stopped are shown.` : "");

/**
 * A decoder has no level: the level belongs to the stream it reads, which
 * the subtitle states once. A row says where its stream comes from only
 * when that differs from "its own library at the stated level".
 */
const streamText = (r: Row) => {
  const from = familyInfo[r.family].decodesFrom;
  if (from) {
    return `reads ${familyInfo[from.family].name}'s output`;
  }
  return r.level === null ? "reads its own default output" : undefined;
};

/**
 * One format's decoders by decompression speed at the format's typical
 * level, each decoding its own encoder's output. Only when the fastest
 * tier clears the stream allowance (the figure's claim) does it get a
 * heading of its own; otherwise one sorted list, with nothing ranked.
 */
export function DecoderFigure({ n, format, view, finding }: { n: number; format: FormatId; view: View; finding: Finding }) {
  const sorted = useMemo(() => decoderRows(view.rows, format).sort((a, b) => b.decode!.median - a.decode!.median), [view, format]);
  const top = useMemo(() => (finding.claim && !view.exploratory ? topTier(view.rows, format) : undefined), [finding, view, format]);
  const inTop = new Set(top?.rows.map((r) => r.id));
  const rows: DotRangeRow[] = sorted.map((r) => ({
    id: `dec-${r.id}`,
    key: r.id,
    label: r.name,
    detail: streamText(r),
    group: top ? (inTop.has(r.id) ? "Clearly fastest" : "The rest") : undefined,
    value: mb(r.decode!.median),
    range: r.decode!.n > 1 ? ([mb(r.decode!.min), mb(r.decode!.max)] as const) : undefined,
    highlight: inTop.has(r.id),
  }));
  const F = formatInfo[format].name;
  const level = formatInfo[format].typicalLevel;
  const allowance = `${STREAM_ALLOWANCE}×`;
  return (
    <Figure
      n={n}
      title={finding.title}
      subtitle={`${F} decompression speed, MB/s on a log scale, ${view.input}, ${level ? `level-${level}` : "default"} streams; whiskers are the observed min–max.`}
      notes={`The encoder that wrote a decoder's input can alone set two decoders up to ${allowance} apart${top ? "" : ", so none is ranked"}. Each reads its own library's output unless noted.`}
    >
      {rows.length ? (
        <DotRange
          rows={rows}
          axis={{ kind: "log", title: "Decompression, MB/s (log scale)", format: (v) => `${formatMBps(v * 1e6)} MB/s`, tickFormat: (v) => tickFormat.format(v) }}
          renderValue={(r, c) => <span className={c.highlight ? "font-semibold text-ink" : undefined}>{formatMBps(c.value * 1e6)} MB/s</span>}
          tone={view.mine ? "mine" : "accent"}
          labelWidth={170}
          label={`${F} decompression speed per decoder, ${view.input}`}
          tableId={TABLE_ID}
        />
      ) : (
        <p className="py-10 text-sm text-ink-2">No {F} decoder was measured.</p>
      )}
    </Figure>
  );
}

type CodeRow = RowBase & { family: Family; decode: number | null; encode: number | null; shared: boolean; builtIn: boolean; published: boolean };

/**
 * The code each implementation ships: two bar panels, "Code to
 * decompress" | "Code to compress", on one linear kB axis from zero, each
 * bar labelled. Exact quantities, so bars, not dots.
 */
export function CodeFigure({ n, view, finding }: { n: number; view: View; finding: Finding }) {
  const rows = useMemo<CodeRow[]>(() => {
    const byFamily = new Map(view.rows.filter((r) => r.code).map((r) => [r.family, r]));
    return formats.flatMap((format) =>
      families
        .filter((f) => familyInfo[f].format === format && !familyInfo[f].variantOf && byFamily.has(f))
        .map((f) => {
          const r = byFamily.get(f)!;
          const c = r.code!;
          return {
            id: `code-${f}`,
            key: r.id,
            label: r.name,
            group: formatInfo[format].name,
            family: f,
            decode: c.source === "built-in" ? null : c.decode,
            encode: c.source === "built-in" ? null : c.encode,
            shared: c.shared,
            builtIn: c.source === "built-in",
            published: c.source === "published",
          };
        }),
    );
  }, [view]);
  const fill = view.mine ? "fill-mine" : "fill-accent";
  const values = rows.flatMap((r) => [r.decode ?? 0, r.encode ?? 0]).map((b) => b / 1000);
  const panel = (id: "decode" | "encode", title: string): Panel<CodeRow> => {
    const bytes = (r: CodeRow) => r[id];
    const text = (r: CodeRow) => {
      const b = bytes(r);
      if (r.builtIn) {
        return "built in";
      }
      if (b === null) {
        return id === "encode" ? "no encoder" : "—";
      }
      return `${kBText(b)}${id === "encode" && r.shared ? ", same module" : ""}`;
    };
    const what = id === "decode" ? "to decompress" : "to compress";
    return {
      id,
      title,
      anchor: (r) => (bytes(r) === null ? (r.builtIn ? 0 : undefined) : bytes(r)! / 1000),
      // Every bar carries its value (facets side by side have no value column): past the bar's end, or inside it when the end is near the edge.
      renderMarks: (r, s, h) => {
        const b = bytes(r);
        const x0 = s(0);
        const label = text(r);
        const tw = textWidth(label, 12);
        if (b === null) {
          return (
            <text x={x0} y={h / 2 + 4} className="fill-ink-3 text-xs">
              {label}
            </text>
          );
        }
        const x1 = Math.max(x0 + 1, s(b / 1000));
        const bh = Math.min(14, h - 12);
        const inside = x1 + 6 + tw > s.range[1] + 4;
        return (
          <>
            <rect x={x0} y={(h - bh) / 2} width={x1 - x0} height={bh} rx={2} className={fill} />
            <text x={inside ? x1 - 6 : x1 + 6} y={h / 2 + 4} textAnchor={inside ? "end" : "start"} className={clsx("text-xs", inside ? "fill-bg font-semibold" : "fill-ink")}>
              {label}
            </text>
          </>
        );
      },
      renderTip: (r) => (
        <Tip
          value={r.builtIn ? "built in: no download" : bytes(r) === null ? text(r) : `${kBText(bytes(r)!)} gzipped`}
          lines={[
            `${r.label} · code ${what}`,
            ...(id === "encode" && r.shared && !r.builtIn ? ["the same module also decompresses"] : []),
            ...(r.published ? ["published minified JavaScript build"] : []),
          ]}
        />
      ),
      describe: (r) => `${r.label}, code ${what}: ${r.builtIn ? "built into the browser" : text(r)}.`,
    };
  };
  return (
    <Figure
      n={n}
      title={finding.title}
      subtitle={`kB after gzip level ${codeGzipLevel ?? 6}, measured at build time, by format. Browser gzip is built in; “same module” decompresses and compresses.`}
      source="This build's files: the wasm modules as shipped, and pako's and fflate's published minified builds"
      notes="pako has separate inflate and deflate builds; fflate is one bundle, so its decoder size includes its encoder."
    >
      <RowChart
        rows={rows}
        panels={[panel("decode", "Code to decompress"), panel("encode", "Code to compress")]}
        axis={{ kind: "linear", values, zero: true, format: (v) => `${tickFormat.format(v)} kB`, tickFormat: (v) => tickFormat.format(v), title: "kB gzipped" }}
        label="Gzipped code each implementation ships to decompress and to compress"
        tableId={TABLE_ID}
        labelWidth={130}
        valueWidth={120}
      />
    </Figure>
  );
}

const range = (s: Row["decode"]) => (s ? (s.n > 1 ? `${formatMBps(s.min)}–${formatMBps(s.max)}` : "one sample") : "");

/** Aligned columns use fixed decimals: MB/s to one (4.9, 1,780.5), ratios to two (2.86×), kB to one. */
const fixed1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const mbFixed = (bps: number) => (Number.isFinite(bps) ? fixed1.format(bps / 1e6) : "—");
const kBFixed = (bytes: number) => fixed1.format(bytes / 1000);

/** "dec 51.2 · enc 122.0", "26.5 both", "built in". */
const codeText = (r: Row) => {
  const c = r.code;
  if (!c) {
    return "—";
  }
  if (c.source === "built-in") {
    return "built in";
  }
  const star = c.source === "published" ? "*" : "";
  if (c.encode === null) {
    return `dec ${kBFixed(c.decode!)}${star} · no encoder`;
  }
  return c.shared ? `${kBFixed(c.decode!)} both${star}` : `dec ${kBFixed(c.decode!)} · enc ${kBFixed(c.encode)}${star}`;
};

/** Rows in table order: by format, then by library, then by level. */
const tableOrder = (rows: Row[]) =>
  [...rows].sort(
    (a, b) =>
      formats.indexOf(familyInfo[a.family].format) - formats.indexOf(familyInfo[b.family].format) ||
      families.indexOf(a.family) - families.indexOf(b.family) ||
      a.order - b.order,
  );

/** A format's heading row in the table. */
const formatHeading = (r: Row) => <span className="font-semibold text-ink">{formatName(r)}</span>;

/**
 * The full table: a heading row per format, then each configuration
 * (implementation and level, pinned while the rest scrolls), its ratio,
 * both speeds with their observed min–max, code size and checksum.
 */
export function ConfigTable({ view, footnote }: { view: View; footnote?: React.ReactNode }) {
  const rows = useMemo(() => tableOrder(view.rows), [view]);
  const firstOfFamily = (r: Row, index: number) => index === 0 || rows[index - 1].family !== r.family;
  const columns: Column<Row>[] = [
    {
      id: "codec",
      header: "Implementation, level",
      render: (r, { index }) => (
        <span className="block min-w-[118px] sm:min-w-[140px]">
          {r.label}
          {firstOfFamily(r, index) && detailOf(r.family) ? <small className="block text-xs leading-tight text-ink-3">{detailOf(r.family)}</small> : null}
        </span>
      ),
    },
    {
      id: "ratio",
      header: "Ratio",
      align: "right",
      // The dagger hangs past the column so the ratios stay aligned.
      render: (r) =>
        r.ratio === undefined ? (
          "—"
        ) : (
          <span className="relative">
            {r.ratio.toFixed(2)}×{r.decodeOnly ? <span className="absolute left-full">†</span> : null}
          </span>
        ),
    },
    { id: "enc", header: "Compress", align: "right", render: (r) => (r.encode ? mbFixed(r.encode.median) : "—") },
    { id: "encr", header: "MB/s min–max", quiet: true, render: (r) => (r.decodeOnly ? "no encoder" : range(r.encode)) },
    { id: "dec", header: "Decompress", align: "right", render: (r) => (r.decode ? mbFixed(r.decode.median) : "—") },
    { id: "decr", header: "MB/s min–max", quiet: true, render: (r) => range(r.decode) },
    { id: "code", header: "Code, kB gzipped", align: "right", render: (r, { index }) => (firstOfFamily(r, index) ? <span className="whitespace-nowrap">{codeText(r)}</span> : null) },
    { id: "check", header: "Checksum on decode", quiet: true, render: (r, { index }) => (firstOfFamily(r, index) ? familyInfo[r.family].checksum : null) },
  ];
  return (
    <DataTable
      id={TABLE_ID}
      caption={`Median MB/s of uncompressed data, with the observed min–max of ${plural(view.samples, "sample")} beside it, ${view.input}.${partialNote(view)}`}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      group={(r) => familyInfo[r.family].format}
      groupHeading={formatHeading}
      failed={(r) => r.roundTrip === false}
      tone={view.mine ? "mine" : "accent"}
      footnote={footnote}
    />
  );
}

/** This machine only: this machine ÷ reference per configuration, over the overall geometric mean. */
export function RelativeFigure({ n, rel, rows, source }: { n: number; rel: Relative; rows: Row[]; source: React.ReactNode }) {
  const moved = new Set(rel.moved);
  const dots = rows
    .filter((r) => rel.normalized[r.id] !== undefined)
    .map((r) => ({ id: `rel-${r.id}`, key: r.id, label: r.label, value: rel.normalized[r.id], highlight: moved.has(r.id) }));
  return (
    <Figure
      n={n}
      title="This machine against the reference, per configuration"
      subtitle="This machine ÷ reference speed per configuration (geometric mean of both directions), over the overall geometric mean, so 1 means it moved with the rest. Marked points moved more than 3%."
      source={source}
      notes="The reference ran on another machine, so each change mixes the machine, the browser version and run-to-run noise."
    >
      <DotRange
        rows={dots}
        axis={{ kind: "log", title: "Relative standing (log scale)", format: (v) => v.toFixed(2), reference: 1, ends: ["fell behind", "pulled ahead"] }}
        renderValue={(r) => <span className={r.highlight ? "font-semibold text-ink" : undefined}>{r.value.toFixed(2)}×</span>}
        tone="mine"
        labelWidth={150}
        label="This machine against the reference, per configuration"
        tableId={TABLE_ID}
      />
    </Figure>
  );
}
