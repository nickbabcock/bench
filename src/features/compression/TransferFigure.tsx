/**
 * Time per file against bandwidth for one input and browser, as a
 * multiple of sending the file uncompressed (a flat 1× line). One faint
 * line per configuration; the gated bands (`bandsOf`) drawn on top: each
 * band's winner in the accent, named, with its stated edges marked
 * ("≈20 Mbps") where they are stated, and the about-the-same stretches
 * dashed. A crosshair snaps to round bandwidths; the band table below is
 * the text equivalent.
 */
import { clsx } from "clsx";
import { useId, useMemo, useState } from "react";
import { KEY_HINT, type Target, useChartNav } from "@/components/charts/interaction";
import { textWidth, useFontsReady } from "@/components/charts/text";
import { type Column, DataTable, Figure } from "@/components/release";
import { formatBytes } from "@/lib/format";
import type { Finding } from "@/lib/findings";
import { useWidth } from "@/hooks";
import { approx, bandText } from "./findings";
import type { View } from "./figures";
import {
  type Band,
  BANDWIDTH,
  bandwidthText,
  dollars,
  envelope,
  type Line,
  rankAt,
  S3_STORAGE,
  type Scenario,
  smallestOutput,
  storageOf,
  timeAt,
  timeText,
  transferLines,
  UNCOMPRESSED,
} from "./transfer";

/** Where the crosshair snaps: 1, 1.5, 2, 3, 5 and 7 per decade. */
const STOPS = (() => {
  const out: number[] = [];
  for (let e = 0; 10 ** e <= BANDWIDTH.hi; e++) {
    for (const m of [1, 1.5, 2, 3, 5, 7]) {
      const v = m * 10 ** e;
      if (v >= BANDWIDTH.lo && v <= BANDWIDTH.hi) {
        out.push(v);
      }
    }
  }
  return out;
})();

const T = 30;
const B = 44;
const RM = 12;
const SAMPLES = 72;
const TOP = 5;
/** The y-axis stops here: further above 1×, the choice is plain (don't compress), and the rest is in the tooltip and table. */
const CAP = 5;

type Box = { x: number; y: number; w: number; h: number };
const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 1-2-5 values from below `lo` to above `hi`. */
function niceTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      out.push(+(m * 10 ** e).toPrecision(6));
    }
  }
  const a = out.findLast((v) => v <= lo) ?? out[0];
  const b = out.find((v) => v >= hi) ?? out.at(-1)!;
  return out.filter((v) => v >= a && v <= b);
}

/** "0.2×", "1×", "20×". */
const relText = (r: number) => `${+r.toPrecision(r < 1 ? 1 : 2)}×`;
const relTip = (r: number) => `${+r.toPrecision(2)}×`;

type TransferChartProps = {
  lines: Line[];
  /** The gated bands; empty draws no verdicts (exploratory, or nothing to compare). */
  bands: Band[];
  tone: "accent" | "mine";
  label: string;
  tableId?: string;
};

/** The chart: one tab stop; Left and Right (or Up and Down) move the crosshair. */
function TransferChart({ lines, bands, tone, label, tableId }: TransferChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const fonts = useFontsReady();
  const hintId = useId();
  const narrow = width > 0 && width < 560;
  const H = 280;
  const raw = lines.find((l) => l.id === UNCOMPRESSED);
  const rel = (l: Line, b: number) => timeAt(l, b) / timeAt(raw!, b);
  const [pointerY, setPointerY] = useState<number | null>(null);

  const layout = useMemo(() => {
    if (!width || !raw || lines.length < 2) {
      return null;
    }
    const rLo = Math.min(...lines.map((l) => rel(l, BANDWIDTH.lo)));
    const top = Math.max(1, ...lines.map((l) => rel(l, BANDWIDTH.hi)));
    const capped = top > CAP;
    const rHi = Math.min(top, CAP);
    const all = niceTicks(rLo, rHi);
    const [y0, y1] = [all[0], all.at(-1)!];
    const ys = (r: number) => H - B - (Math.log(r / y0) / Math.log(y1 / y0)) * (H - B - T);
    // 1× always, then outward every 1-2-5 tick at least 20px from the last one kept.
    const up = [1];
    for (const t of all.filter((v) => v > 1)) {
      if (ys(up.at(-1)!) - ys(t) >= 20) {
        up.push(t);
      }
    }
    const down: number[] = [];
    for (const t of all.filter((v) => v < 1).reverse()) {
      if (ys(t) - ys(down.at(-1) ?? 1) >= 20) {
        down.push(t);
      }
    }
    const yTicks = [...down.reverse(), ...up];
    const L = Math.ceil(Math.max(...yTicks.map((t) => textWidth(relText(t), 12)))) + 12;
    const R = width - RM;
    const xs = (mbps: number) => L + (Math.log(mbps / BANDWIDTH.lo) / Math.log(BANDWIDTH.hi / BANDWIDTH.lo)) * (R - L);
    const xTicks = narrow ? [1, 10, 100, 1000] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const path = (l: Line, from: number = BANDWIDTH.lo, to: number = BANDWIDTH.hi) => {
      const n = Math.max(2, Math.ceil((SAMPLES * Math.log(to / from)) / Math.log(BANDWIDTH.hi / BANDWIDTH.lo)));
      return Array.from({ length: n + 1 }, (_, i) => {
        const b = from * (to / from) ** (i / n);
        return `${i ? "L" : "M"}${xs(b).toFixed(1)},${ys(rel(l, b)).toFixed(1)}`;
      }).join("");
    };
    // Gated winners in the accent; about-the-same stretches (or everything, with no bands) as the plain envelope in neutral ink.
    const claimed = bands.filter((b) => b.winner);
    // Everything not claimed is about the same, including a stretch too narrow to have a band of its own.
    const stretches: { from: number; to: number }[] = [];
    let edge: number = BANDWIDTH.lo;
    for (const b of claimed) {
      if (b.from > edge) {
        stretches.push({ from: edge, to: b.from });
      }
      edge = b.to;
    }
    if (edge < BANDWIDTH.hi) {
      stretches.push({ from: edge, to: BANDWIDTH.hi });
    }
    const neutral = stretches.flatMap((s) => envelope(lines, s.from, s.to).map((seg) => path(seg.line, seg.from, seg.to))).join("");
    const byId = new Map(lines.map((l) => [l.id, l]));
    const accent = claimed.map((b) => path(byId.get(b.winner!)!, b.from, b.to)).join("");

    // Labels: stated edges first (just above the axis), then each band's name below its line, else above it.
    const taken: Box[] = [];
    const marks = claimed.flatMap((b) => {
      const l = byId.get(b.winner!)!;
      // At the stated value, which lies inside the band, so the mark and its label agree.
      return [b.lo, b.hi].flatMap((at) => {
        if (at === null) {
          return [];
        }
        const text = approx(at);
        const w = textWidth(text, 12) + 4;
        const box = { x: Math.min(R - w, Math.max(L + 6, xs(at) - w / 2)), y: H - B - 18, w, h: 14 };
        const shown = !taken.some((t) => hits(t, box));
        if (shown) {
          taken.push(box);
        }
        return [{ key: `${b.winner}-${at}`, x: xs(at), y: ys(rel(l, at)), text, box, shown }];
      });
    });
    const names = claimed.flatMap((b) => {
      const best = byId.get(b.winner!)!;
      const text = best.label;
      const w = textWidth(text, 13, 600) + 4;
      if (xs(b.to) - xs(b.from) < w + 8) {
        return [];
      }
      const mid = Math.sqrt(b.from * b.to);
      const cx = Math.min(R - w / 2, Math.max(L + w / 2 + 2, xs(mid)));
      const at = ys(rel(best, mid));
      for (const box of [
        { x: cx - w / 2, y: at + 8, w, h: 15 },
        { x: cx - w / 2, y: at - 23, w, h: 15 },
      ]) {
        if (box.y >= T - 4 && box.y + box.h <= H - B - 2 && !taken.some((t) => hits(t, box))) {
          taken.push(box);
          return [{ key: `n${b.from}`, text, box }];
        }
      }
      return [];
    });
    return { L, R, xs, ys, yTicks, xTicks, path, neutral, accent, marks, names, capped };
    // rel depends only on lines; fonts: re-measure once the real face has loaded.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [width, H, lines, bands, narrow, fonts]);

  const targets: Target[] = useMemo(() => {
    if (!layout) {
      return [];
    }
    return STOPS.map((b, i) => {
      const ranked = rankAt(lines, b);
      const band = bands.find((x) => b >= x.from && b <= x.to);
      const best = ranked[0];
      const rawAt = ranked.find((x) => x.line.id === UNCOMPRESSED);
      return {
        id: `bw-${b}`,
        key: band?.winner ?? best.line.id,
        x: layout.xs(b),
        y: layout.ys(rel(best.line, b)),
        row: i,
        col: 0,
        // With no gated bands (one sample), observed times only: no verdict either way.
        describe: `At ${bandwidthText(b)}: ${
          band?.winner
            ? `${best.line.label} fastest, ${timeText(best.ms)}`
            : `${bands.length ? "about the same: " : ""}${ranked
                .filter((x) => x.line.id !== UNCOMPRESSED)
                .slice(0, bands.length ? 2 : 3)
                .map((x) => `${x.line.label} ${timeText(x.ms)}`)
                .join(", ")}`
        }${rawAt ? `; uncompressed ${timeText(rawAt.ms)}` : ""}.`,
        tip: null,
      };
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, lines, bands]);

  const nav = useChartNav(targets);
  const stroke = tone === "mine" ? "stroke-mine" : "stroke-accent";
  const fill = tone === "mine" ? "fill-mine" : "fill-accent";
  const tip = nav.tipTarget;
  const stop = tip ? Number(tip.id.slice(3)) : undefined;
  // The line nearest the pointer at the crosshair, outlined and marked in the tooltip.
  const match =
    layout && stop !== undefined && pointerY !== null
      ? lines
          .map((l) => ({ l, d: Math.abs(layout.ys(rel(l, stop)) - pointerY) }))
          .sort((a, b) => a.d - b.d)
          .find((x) => x.d <= 12)?.l
      : undefined;
  const linked = nav.active && nav.active !== tip?.key ? lines.find((l) => l.id === nav.active) : undefined;
  const outlined = match ?? linked;

  const nearest = (e: React.MouseEvent<SVGRectElement>) => {
    if (!layout) {
      return undefined;
    }
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    if (mx < layout.L - 8 || mx > layout.R + 8) {
      return undefined;
    }
    setPointerY(e.clientY - r.top);
    return targets.reduce((best, t) => (Math.abs(t.x - mx) < Math.abs(best.x - mx) ? t : best), targets[0]);
  };

  const tipRows =
    stop !== undefined
      ? (() => {
          const ranked = rankAt(lines, stop);
          const top = ranked.filter((x) => x.line.id !== UNCOMPRESSED).slice(0, TOP);
          const extra = ranked.filter((x) => x.line.id === UNCOMPRESSED || (x.line === match && !top.includes(x)));
          return { ranked, rows: [...top, ...extra].sort((a, b) => a.ms - b.ms), band: bands.find((x) => stop >= x.from && stop <= x.to) };
        })()
      : undefined;

  return (
    <div className="relative">
      <div
        ref={ref}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="group"
        aria-roledescription="chart"
        aria-label={label}
        aria-describedby={clsx(hintId, tableId)}
        {...nav.containerProps}
        className="relative rounded-[2px] outline-offset-4"
        style={{ height: H }}
      >
        {layout ? (
          <svg width={width} height={H} aria-hidden="true" className="fig-text block overflow-visible">
            {/* Grid and axes */}
            {layout.yTicks.map((t) => (
              <g key={`y${t}`}>
                <line x1={layout.L} x2={layout.R} y1={layout.ys(t)} y2={layout.ys(t)} className="stroke-grid" />
                <text x={layout.L - 8} y={layout.ys(t)} dy="0.33em" textAnchor="end" className="fill-ink-3 text-xs">
                  {relText(t)}
                </text>
              </g>
            ))}
            {layout.xTicks.map((t, i, all) => {
              const text = bandwidthText(t);
              const tw = textWidth(text, 12);
              const cx = Math.min(width - tw / 2, Math.max(tw / 2, layout.xs(t)));
              return (
                <g key={`x${t}`}>
                  {i > 0 && i < all.length - 1 ? <line x1={layout.xs(t)} x2={layout.xs(t)} y1={T} y2={H - B} className="stroke-grid" /> : null}
                  <line x1={layout.xs(t)} x2={layout.xs(t)} y1={H - B} y2={H - B + 4} className="stroke-ink-3" />
                  <text x={cx} y={H - B + 17} textAnchor="middle" className="fill-ink-3 text-xs">
                    {text}
                  </text>
                </g>
              );
            })}
            <line x1={layout.L} x2={layout.R} y1={H - B} y2={H - B} className="stroke-ink-3" />
            <line x1={layout.L} x2={layout.L} y1={T} y2={H - B} className="stroke-ink-3" />
            <text x={layout.L} y={T - 14} className="fill-ink-2 text-cap">
              {narrow ? "Relative to uncompressed" : "Time relative to sending it uncompressed"}
            </text>
            <text x={layout.R} y={H - 4} textAnchor="end" className="fill-ink-2 text-cap">
              Bandwidth
            </text>

            <clipPath id={`${hintId}-plot`}>
              <rect x={layout.L} y={T} width={layout.R - layout.L} height={H - B - T} />
            </clipPath>
            {layout.capped ? (
              <text x={layout.R} y={T - 14} textAnchor="end" className="fill-ink-3 text-xs">
                {narrow ? `cut off above ${CAP}×` : `Lines above ${CAP}× are cut off`}
              </text>
            ) : null}

            {/* Every configuration, faint; Uncompressed is the flat 1× line */}
            <g clipPath={`url(#${hintId}-plot)`}>
            {lines
              .filter((l) => l.id !== UNCOMPRESSED && l !== outlined)
              .map((l) => (
                <path key={l.id} d={layout.path(l)} fill="none" strokeWidth={1} className="stroke-dot-soft" />
              ))}
            </g>
            <line x1={layout.L} x2={layout.R} y1={layout.ys(1)} y2={layout.ys(1)} strokeWidth={1.5} className="stroke-ink-3" />
            <text x={layout.L + 6} y={layout.ys(1) - 6} className="fig-halo fill-ink-2 text-xs">
              Uncompressed
            </text>

            {/* Stated band edges: hairlines under the lines */}
            {layout.marks.map((m) => (
              <line key={`h${m.key}`} x1={m.x} x2={m.x} y1={m.y + 5} y2={H - B} strokeWidth={1} className={clsx(stroke, "opacity-40")} />
            ))}

            {/* Gated winners and the about-the-same stretches */}
            <path d={layout.neutral} fill="none" clipPath={`url(#${hintId}-plot)`} strokeWidth={6} strokeLinejoin="round" className="stroke-bg" />
            <path d={layout.neutral} fill="none" clipPath={`url(#${hintId}-plot)`} strokeWidth={2} strokeDasharray={bands.length ? "6 4" : undefined} strokeLinejoin="round" className="stroke-ink-3" />
            {layout.accent ? (
              <>
                <path d={layout.accent} clipPath={`url(#${hintId}-plot)`} fill="none" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" className="stroke-bg" />
                <path d={layout.accent} clipPath={`url(#${hintId}-plot)`} fill="none" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className={stroke} />
              </>
            ) : null}
            {outlined && outlined.id !== UNCOMPRESSED ? <path d={layout.path(outlined)} clipPath={`url(#${hintId}-plot)`} fill="none" strokeWidth={1.75} className="stroke-ink" /> : null}
            {layout.marks.map((m) => (
              <circle key={`d${m.key}`} cx={m.x} cy={m.y} r={4} strokeWidth={2} className={clsx("fill-bg", stroke)} />
            ))}

            {/* Labels */}
            {layout.marks
              .filter((m) => m.shown)
              .map((m) => (
                <text key={`t${m.key}`} x={m.box.x + m.box.w / 2} y={m.box.y + 11} textAnchor="middle" className="fig-halo fill-ink-2 text-xs">
                  {m.text}
                </text>
              ))}
            {layout.names.map((s) => (
              <text key={s.key} x={s.box.x + s.box.w / 2} y={s.box.y + 12} textAnchor="middle" className="fig-halo fill-ink text-cap font-semibold">
                {s.text}
              </text>
            ))}

            {/* Crosshair */}
            {tip ? (
              <g className="pointer-events-none">
                <line x1={tip.x} x2={tip.x} y1={T} y2={H - B} strokeWidth={1} className="stroke-ink-2" />
                <circle cx={tip.x} cy={tip.y} r={4.5} strokeWidth={2} className={clsx(fill, "stroke-bg")} />
              </g>
            ) : null}

            {/* Hit layer: the crosshair finds the bandwidth; the pointer's height picks a line to outline */}
            <rect
              x={0}
              y={0}
              width={width}
              height={H}
              fill="transparent"
              className="cursor-crosshair"
              onPointerMove={(e) => {
                if (e.pointerType === "mouse") {
                  nav.hover(nearest(e)?.id ?? null);
                }
              }}
              onPointerLeave={() => {
                nav.hover(null);
                setPointerY(null);
              }}
              onClick={(e) => nav.pin(nearest(e)?.id ?? null)}
            />
          </svg>
        ) : null}
        {/* The tooltip: on the side of the crosshair away from the pointer's half, so it never covers the lines being read */}
        {tip && tipRows && layout ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 w-max max-w-[16rem] border border-rule bg-bg px-2.5 py-1.5 text-cap shadow-[0_2px_8px_rgb(0_0_0/0.12)]"
            style={tip.x > width / 2 ? { left: tip.x - 14, top: T, transform: "translateX(-100%)" } : { left: tip.x + 14, top: T }}
          >
            <span className="block text-sm font-bold text-ink">At {bandwidthText(stop!)}</span>
            <span className="block text-ink-2">
              {tipRows.band?.winner ? `${tipRows.ranked[0].line.label} fastest by over 3%` : bands.length ? "Leaders about the same" : "Observed times"}
            </span>
            <span className="mt-1 grid grid-cols-[auto_auto_auto] gap-x-3 text-xs tabular-nums">
              {tipRows.rows.map((x, k) => (
                <span key={x.line.id} className={clsx("contents", x.line === match ? "font-semibold text-ink" : k === 0 ? "text-ink" : "text-ink-2")}>
                  <span className="whitespace-nowrap">{x.line.label}</span>
                  <span className="text-right whitespace-nowrap">{timeText(x.ms)}</span>
                  <span className="text-right whitespace-nowrap text-ink-3">{relTip(x.ms / tipRows.ranked.find((y) => y.line.id === UNCOMPRESSED)!.ms)}</span>
                </span>
              ))}
            </span>
          </div>
        ) : null}
      </div>
      <p id={hintId} className="sr-only">
        {KEY_HINT.replace("between points", "between bandwidths")}
      </p>
      <p aria-live="polite" className="sr-only">
        {nav.live}
      </p>
    </div>
  );
}

/** One legend entry: the mark as the chart draws it, then its meaning. */
const Key = ({ mark, children }: { mark: React.ReactNode; children: React.ReactNode }) => (
  <li className="flex items-center gap-1.5">
    <svg width={22} height={12} aria-hidden="true" className="shrink-0">
      {mark}
    </svg>
    {children}
  </li>
);

/** "+16%", "−8%", or "about the same size" when it rounds to 0. */
const sizeDelta = (larger: number) => {
  const pct = Math.round(larger * 100);
  return pct === 0 ? "about the same size" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
};

/**
 * One input's time against bandwidth to download or upload: the chart over
 * the shown dataset's lines, then the band table, whose winners hold in
 * every capture (`bands`, from `cellBands`). An exploratory run (one
 * sample) names nothing.
 */
export function TransferFigure({ n, scenario, view, finding, bands, captures }: { n: number; scenario: Scenario; view: View; finding: Finding; bands: Band[]; captures: number }) {
  const lines = useMemo(() => transferLines(view.rows, scenario), [view, scenario]);
  const gated = view.exploratory ? [] : bands;
  const byId = new Map(lines.map((l) => [l.id, l]));
  const name = (id: string) => byId.get(id)?.label ?? id;
  const tableId = `${scenario}-bands`;
  const download = scenario === "download";
  // A band's times at its stated ends: the winner's, or the fastest's where they are about the same.
  const ends = (b: Band) => [b.lo ?? BANDWIDTH.lo, b.hi ?? BANDWIDTH.hi] as const;
  const range = (b: Band, l?: Line) => {
    const [a, z] = ends(b);
    const at = (x: number) => (l ? timeAt(l, x) : rankAt(lines, x)[0].ms);
    return `${timeText(at(a))} → ${timeText(at(z))}`;
  };
  // Every row states its stretch: a stretch whose stated edges meet has no row.
  const rows = gated.filter((b) => b.winner || b.lo === null || b.hi === null || b.lo < b.hi);
  // Upload only: what keeping the output costs per TB of original data, if the server stores it as sent.
  // A winner, or the smallest of the tied options, against the previous (slower-bandwidth) winner.
  const stored = (b: Band) => {
    if (b.winner) {
      return b.winner;
    }
    const tied = b.near.filter((id) => byId.has(id));
    return (smallestOutput(lines, tied) ?? lines.find((l) => tied.includes(l.id)))?.id;
  };
  const previous = (b: Band) => rows.slice(0, rows.indexOf(b)).findLast((x) => x.winner)?.winner;
  const storage = (b: Band) => {
    const id = stored(b);
    return id === undefined ? undefined : storageOf(lines, id, previous(b));
  };
  const columns: Column<Band>[] = [
    // Bandwidth and the fastest in one pinned column, so a row's numbers stay with its codec when the table scrolls.
    {
      id: "bw",
      header: "Bandwidth · fastest",
      render: (b) => (
        // Phones: bandwidth over codec, so the pinned column stays narrow; wider screens: one line.
        <span className="inline-block max-w-[8.5rem] whitespace-normal sm:max-w-none sm:whitespace-nowrap">
          <span className="block whitespace-nowrap text-ink-2 sm:inline">{bandText(b)}</span>
          <span className="hidden text-ink-3 sm:inline"> · </span>
          {b.winner ? <span className="font-semibold whitespace-nowrap text-ink">{name(b.winner)}</span> : <span className="text-ink-2">about the same: {b.near.map(name).join(", ")}</span>}
        </span>
      ),
    },
    { id: "time", header: "Time per file (lower → upper bandwidth)", align: "right", render: (b) => range(b, b.winner ? byId.get(b.winner) : undefined) },
    ...(download
      ? []
      : [
          {
            id: "storage",
            header: "Storage, $/mo per TB",
            align: "right",
            render: (b: Band) => {
              const k = storage(b);
              return k ? dollars(k.cost) : "—";
            },
          } satisfies Column<Band>,
          {
            id: "delta",
            header: "vs previous winner",
            align: "right",
            quiet: true,
            render: (b: Band) => {
              const k = storage(b);
              return k?.vs ? sizeDelta(k.vs.larger) : "—";
            },
          } satisfies Column<Band>,
        ]),
    { id: "raw", header: "Uncompressed", align: "right", quiet: true, render: (b) => range(b, byId.get(UNCOMPRESSED)) },
  ];
  const what = download ? "download, then decompress" : "compress, then upload";
  const storageCaption = (
    <>
      Storage: 1 TB of original data kept compressed for a month in{" "}
      <a className="link" href={S3_STORAGE.url}>
        S3 Standard
      </a>{" "}
      (${S3_STORAGE.perGiBMonth}/GiB-month); a tie shows its smallest option.
    </>
  );
  const stroke = view.mine ? "stroke-mine" : "stroke-accent";
  return (
    <Figure
      n={n}
      title={finding.title}
      subtitle={
        <>
          Time to {what} {view.input}, {formatBytes(view.rows[0]?.bytes ?? NaN)}, relative to sending it uncompressed; log scales.
          {view.exploratory ? " One sample per configuration, so nothing is compared." : null}
        </>
      }
      legend={
        lines.length > 1 ? (
          <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-cap text-ink-2">
            {gated.length ? (
              <>
                <Key mark={<line x1={1} x2={21} y1={6} y2={6} strokeWidth={2.5} strokeLinecap="round" className={stroke} />}>fastest by over 3%{captures > 1 ? " in both captures" : ""}</Key>
                <Key mark={<line x1={1} x2={21} y1={6} y2={6} strokeWidth={2} strokeDasharray="6 4" className="stroke-ink-3" />}>about the same</Key>
              </>
            ) : (
              <Key mark={<line x1={1} x2={21} y1={6} y2={6} strokeWidth={2} className="stroke-ink-3" />}>fastest observed</Key>
            )}
            <Key mark={<line x1={1} x2={21} y1={6} y2={6} strokeWidth={1} className="stroke-dot-soft" />}>other configurations</Key>
          </ul>
        ) : undefined
      }
      notes={
        download ? (
          `Payload only, codecs loaded; Browser gzip is DecompressionStream, not HTTP Content-Encoding.${view.mine ? "" : " Slower devices move crossovers lower."}`
        ) : (
          <>
            Storage counts only if the server keeps the client&apos;s bytes. Validating uploads, egress and recompressing: <a className="link" href="#notes">Measurement notes</a>.
          </>
        )
      }
    >
      {lines.length > 1 ? (
        <>
          <TransferChart
            lines={lines}
            bands={gated}
            tone={view.mine ? "mine" : "accent"}
            label={`Time to ${what} one file relative to sending it uncompressed, against bandwidth, ${lines.length - 1} configurations, ${view.input}`}
            tableId={rows.length ? tableId : undefined}
          />
          {rows.length ? (
            <DataTable
              id={tableId}
              caption={
                download ? (
                  `Fastest by bandwidth, ${view.input}.`
                ) : (
                  <>
                    Fastest by bandwidth, {view.input}. {storageCaption}
                  </>
                )
              }
              shownCaption={download ? null : storageCaption}
              columns={columns}
              rows={rows}
              rowKey={(b) => `${scenario}-${b.from}`}
              linkKey={(b) => b.winner ?? b.near[0]}
              tone={view.mine ? "mine" : "accent"}
            />
          ) : null}
        </>
      ) : (
        <p className="py-10 text-sm text-ink-2">Nothing was measured for this figure.</p>
      )}
    </Figure>
  );
}
