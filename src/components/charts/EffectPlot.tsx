import { clsx } from "clsx";
import { Tip } from "./interaction";
import { type RowBase, RowChart } from "./RowChart";
import { ratioPercent, ratioTick, type Scale } from "./scale";

/** One paired effect: a time ratio (variant ÷ baseline, same round). */
export type EffectCell = {
  median: number;
  /** Order-statistic CI of the median (~95%). */
  ci: readonly [number, number];
  /** Observed min–max of the per-round ratios; drawn faint, never the claim test. */
  range?: readonly [number, number];
  /** Whether the claim rule passed (|median − 1| > threshold and CI excludes 1). Decided by src/lib/stats.ts, not here. */
  claimed: boolean;
  /** Paired rounds behind it. */
  n?: number;
};

export type EffectRow = RowBase & {
  /** Per facet id; a missing cell draws nothing ("not measured"). */
  cells: Record<string, EffectCell | undefined>;
};

export type EffectPlotProps = {
  rows: EffectRow[];
  /** Small multiples sharing the axis, e.g. [{id: "chrome", title: "Chrome 156"}, …]. */
  facets: { id: string; title: React.ReactNode; name?: string }[];
  /** Accessible name. */
  label: string;
  /** Reporting threshold, as a fraction (default 0.03: ±3%). */
  threshold?: number;
  /** Axis title (default: time against the baseline in the same round). */
  axisTitle?: string;
  tone?: "accent" | "mine";
  tableId?: string;
  labelWidth?: number;
  className?: string;
};

/**
 * A faint min–max whisker, clipped to the plot: an end beyond the axis
 * stops at the edge with a small outward caret.
 */
function ClippedRange({ s, lo, hi, cy }: { s: Scale; lo: number; hi: number; cy: number }) {
  const [e0, e1] = s.range;
  const x0 = s(lo);
  const x1 = s(hi);
  const a = Math.max(x0, e0 - 2);
  const b = Math.min(x1, e1 + 2);
  const caret = (x: number, dir: -1 | 1) => <path d={`M${x} ${cy - 3.5}L${x + dir * 4} ${cy}L${x} ${cy + 3.5}Z`} className="fill-dot-soft" />;
  return (
    <>
      <line x1={a} x2={b} y1={cy} y2={cy} strokeWidth={1} className="stroke-dot-soft" />
      {x0 < e0 - 2 ? caret(a, -1) : null}
      {x1 > e1 + 2 ? caret(b, 1) : null}
    </>
  );
}

const labelText = (r: EffectRow) => (typeof r.label === "string" ? r.label : r.id);

/**
 * Paired-effect rows with CI whiskers: a forest plot on a log-ratio axis
 * read as "% less time / % more time", with the ±threshold shaded as a
 * reporting policy ("not claimed"), faint observed min–max behind each
 * CI (clipped with a caret where it runs past the axis, which spans the
 * medians and CIs only), a 1.0 reference line, and engine facets side by
 * side from 700px (one shared label column, values in the tooltip),
 * stacked below, that share one axis. Claimed effects take the
 * accent; the rest are grey. Annotate one row with `note` (and
 * `noteFacet` to keep it under one facet).
 */
export function EffectPlot({
  rows,
  facets,
  label,
  threshold = 0.03,
  axisTitle = "Time against the baseline in the same round (log scale)",
  tone = "accent",
  tableId,
  labelWidth,
  className,
}: EffectPlotProps) {
  const fill = tone === "mine" ? "fill-mine" : "fill-accent";
  const stroke = tone === "mine" ? "stroke-mine" : "stroke-accent";
  // The axis spans medians and CIs only; a min–max beyond it is clipped with a caret at the edge.
  const values = rows.flatMap((r) => Object.values(r.cells).flatMap((c) => (c ? [c.median, ...c.ci] : [])));
  const ciText = (c: EffectCell) => `${ratioTick(c.ci[0])} to ${ratioTick(c.ci[1])}`;
  return (
    <div className={className}>
      <RowChart
        rows={rows}
        label={label}
        tableId={tableId}
        labelWidth={labelWidth}
        valueWidth={92}
        axis={{ kind: "ratio", values, format: ratioTick, title: axisTitle, ends: ["less time", "more time"], reference: 1, threshold }}
        panels={facets.map((f) => {
          const name = f.name ?? (typeof f.title === "string" ? f.title : f.id);
          return {
            id: f.id,
            title: f.title,
            anchor: (r: EffectRow) => r.cells[f.id]?.median,
            renderValue: (r: EffectRow) => {
              const c = r.cells[f.id];
              return c ? <span className={clsx(c.claimed ? "font-semibold text-ink" : "text-ink-3")}>{ratioPercent(c.median)}</span> : <span className="text-ink-3">not measured</span>;
            },
            renderTip: (r: EffectRow) => {
              const c = r.cells[f.id];
              return c ? (
                <Tip
                  value={`${ratioPercent(c.median)}${c.claimed ? "" : " (not claimed)"}`}
                  lines={[
                    `${labelText(r)} · ${name}`,
                    `95% CI ${ciText(c)}${c.n ? ` · ${c.n} rounds` : ""}`,
                    ...(c.range ? [`min–max ${ratioTick(c.range[0])} to ${ratioTick(c.range[1])}`] : []),
                  ]}
                />
              ) : null;
            },
            describe: (r: EffectRow) => {
              const c = r.cells[f.id];
              return c
                ? `${labelText(r)}, ${name}: ${ratioPercent(c.median)}, confidence interval ${ciText(c)}, ${c.claimed ? "claimed" : "not claimed"}.`
                : `${labelText(r)}, ${name}: not measured.`;
            },
            renderMarks: (r: EffectRow, s, h, active) => {
              const c = r.cells[f.id];
              const cy = h / 2;
              if (!c) {
                // Side by side there's no value column to say so.
                return facets.length > 1 ? (
                  <text x={6} y={cy + 4} className="fill-ink-3 text-xs">
                    not measured
                  </text>
                ) : null;
              }
              return (
                <>
                  {c.range ? <ClippedRange s={s} lo={c.range[0]} hi={c.range[1]} cy={cy} /> : null}
                  <line x1={s(c.ci[0])} x2={s(c.ci[1])} y1={cy} y2={cy} strokeWidth={2} strokeLinecap="round" className={c.claimed ? stroke : "stroke-dot"} />
                  {active ? <circle cx={s(c.median)} cy={cy} r={9.5} strokeWidth={1.5} className="fill-none stroke-ink" /> : null}
                  <circle cx={s(c.median)} cy={cy} r={4.5} strokeWidth={2} className={clsx(c.claimed ? fill : "fill-dot", "stroke-bg")} />
                </>
              );
            },
          };
        })}
      />
    </div>
  );
}
