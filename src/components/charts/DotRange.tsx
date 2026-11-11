import { clsx } from "clsx";
import { Tip } from "./interaction";
import { type Panel, type RowBase, RowChart } from "./RowChart";
import type { AxisKind } from "./scale";

/** One dot and its whiskers. */
export type DotRangeCell = {
  /** The median (or the ratio, for this machine ÷ reference). */
  value: number;
  /** The main whisker: observed min–max for unpaired data, the CI for paired. */
  range?: readonly [number, number];
  /** A second, faint range behind the main one (min–max behind a CI). */
  faint?: readonly [number, number];
  /** Drawn in the accent (or mine): the row a finding is about, or a moved point. */
  highlight?: boolean;
};

export type DotRangeRow = RowBase &
  DotRangeCell & {
    /**
     * With `facets`: the cell per facet id (a missing one draws "not
     * measured"). The row's own `value` is then unused; pass NaN.
     */
    cells?: Record<string, DotRangeCell | undefined>;
  };

/** A facet: one engine (or machine), with the rows' `cells[id]`. */
export type DotRangeFacet = { id: string; title: React.ReactNode; name?: string };

export type DotRangeProps = {
  rows: DotRangeRow[];
  axis: {
    kind: AxisKind | "ratio";
    /** Axis title, with its unit and scale. */
    title: string;
    format: (v: number) => string;
    /** Tick text, when it should differ from values (fewer decimals). */
    tickFormat?: (v: number) => string;
    /** A reference line: 1.0 for ratios ("same as wasm32"). */
    reference?: number;
    /** Shade ±threshold around `reference` on a ratio axis (the reporting threshold, "not claimed"). */
    threshold?: number;
    ends?: [string, string];
    zero?: boolean;
    /**
     * More values the axis must cover. Two charts that should share one
     * axis (General-purpose | Arena) each pass the other's values here.
     */
    include?: number[];
  };
  /**
   * Engine facets sharing the axis: side by side from 700px (values in the
   * tooltip), stacked below. Each row then supplies `cells`.
   */
  facets?: DotRangeFacet[];
  /** Accessible name: what the figure plots. */
  label: string;
  /** Right-hand text per row; default: the formatted value. With facets, `cell` is the facet's. */
  renderValue?: (row: DotRangeRow, cell: DotRangeCell, facet?: DotRangeFacet) => React.ReactNode;
  /** Tooltip body; default: value and range, then the label (and facet). */
  renderTip?: (row: DotRangeRow, cell: DotRangeCell, facet?: DotRangeFacet) => React.ReactNode;
  /** Screen-reader sentence on focus; default: label, value and range. */
  describe?: (row: DotRangeRow, cell: DotRangeCell, facet?: DotRangeFacet) => string;
  /** Name of the main whisker, for the default tooltip ("observed min–max"). */
  rangeName?: string;
  tone?: "accent" | "mine";
  tableId?: string;
  labelWidth?: number;
  className?: string;
};

const labelText = (r: DotRangeRow) => (typeof r.label === "string" ? r.label : r.id);
const facetName = (f: DotRangeFacet) => f.name ?? (typeof f.title === "string" ? f.title : f.id);

/**
 * Dot-and-whisker rows on one axis: time per call per allocator, the
 * wasm64 ÷ wasm32 ratio, or this machine ÷ reference. One dot per row at
 * the median, its range as a whisker, an optional faint second range,
 * an optional reference line. Highlighted rows take the accent. With
 * `facets`, one panel per engine shares the label column and the axis.
 */
export function DotRange({
  rows,
  axis,
  facets,
  label,
  renderValue,
  renderTip,
  describe,
  rangeName = "observed min–max",
  tone = "accent",
  tableId,
  labelWidth,
  className,
}: DotRangeProps) {
  const fill = tone === "mine" ? "fill-mine" : "fill-accent";
  const stroke = tone === "mine" ? "stroke-mine" : "stroke-accent";
  const fmt = axis.format;
  const rangeText = (c: DotRangeCell) => (c.range ? `${fmt(c.range[0])}–${fmt(c.range[1])}` : "");
  const cellsOf = (r: DotRangeRow): DotRangeCell[] => (facets ? facets.flatMap((f) => (r.cells?.[f.id] ? [r.cells[f.id]!] : [])) : [r]);
  const panel = (f: DotRangeFacet | undefined): Panel<DotRangeRow> => {
    const cellOf = (r: DotRangeRow): DotRangeCell | undefined => (f ? r.cells?.[f.id] : r);
    const where = (r: DotRangeRow) => (f ? `${labelText(r)} · ${facetName(f)}` : labelText(r));
    return {
      id: f?.id ?? "main",
      title: f?.title,
      anchor: (r) => cellOf(r)?.value,
      renderValue: (r) => {
        const c = cellOf(r);
        if (!c) {
          return <span className="text-ink-3">not measured</span>;
        }
        return renderValue ? renderValue(r, c, f) : <span className={clsx(c.highlight && "font-semibold text-ink")}>{fmt(c.value)}</span>;
      },
      renderTip: (r) => {
        const c = cellOf(r);
        return c ? (renderTip?.(r, c, f) ?? <Tip value={fmt(c.value)} lines={[where(r), ...(c.range ? [`${rangeName} ${rangeText(c)}`] : [])]} />) : null;
      },
      describe: (r) => {
        const c = cellOf(r);
        return c ? (describe?.(r, c, f) ?? `${where(r)}: ${fmt(c.value)}${c.range ? `, ${rangeName} ${rangeText(c)}` : ""}.`) : `${where(r)}: not measured.`;
      },
      renderMarks: (r, s, h, active) => {
        const c = cellOf(r);
        const cy = h / 2;
        if (!c) {
          return f ? (
            <text x={6} y={cy + 4} className="fill-ink-3 text-xs">
              not measured
            </text>
          ) : null;
        }
        return (
          <>
            {c.faint ? <line x1={s(c.faint[0])} x2={s(c.faint[1])} y1={cy} y2={cy} strokeWidth={1} className="stroke-dot-soft" /> : null}
            {c.range ? (
              <line x1={s(c.range[0])} x2={s(c.range[1])} y1={cy} y2={cy} strokeWidth={2} strokeLinecap="round" className={c.highlight ? stroke : "stroke-dot"} />
            ) : null}
            {active ? <circle cx={s(c.value)} cy={cy} r={9.5} strokeWidth={1.5} className="fill-none stroke-ink" /> : null}
            <circle cx={s(c.value)} cy={cy} r={4.5} strokeWidth={2} className={clsx(c.highlight ? fill : "fill-dot", "stroke-bg")} />
          </>
        );
      },
    };
  };
  return (
    <RowChart
      rows={rows}
      label={label}
      tableId={tableId}
      labelWidth={labelWidth}
      className={className}
      axis={{
        kind: axis.kind,
        values: [...rows.flatMap((r) => cellsOf(r).flatMap((c) => [c.value, ...(c.range ?? []), ...(c.faint ?? [])])), ...(axis.include ?? [])],
        format: fmt,
        tickFormat: axis.tickFormat,
        title: axis.title,
        reference: axis.reference,
        threshold: axis.threshold,
        ends: axis.ends,
        zero: axis.zero,
      }}
      panels={facets ? facets.map(panel) : [panel(undefined)]}
    />
  );
}
