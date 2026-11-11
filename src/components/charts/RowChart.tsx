import { clsx } from "clsx";
import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWidth } from "@/hooks";
import { KEY_HINT, type Target, Tooltip, useChartNav } from "./interaction";
import { type AxisKind, linearScale, logScale, ratioScale, type Scale } from "./scale";
import { textWidth, useFontsReady } from "./text";

/** One labelled row of a row chart (a configuration, workload or allocator). */
export type RowBase = {
  id: string;
  /** Links the row to table rows and other figures (default: id). */
  key?: string;
  label: React.ReactNode;
  /** Small second line under the label (a crate, an input). */
  detail?: React.ReactNode;
  /** Rows with the same group sit under one group heading, in order. */
  group?: string;
  /** A short annotation set under the row (one per figure, at most). Plain text, so its wrapped height can be measured. */
  note?: string;
  /**
   * The facet (panel id) the note belongs to. It is drawn under that
   * facet only, and when facets stack (phones) it appears in that facet's
   * block and no other. Omit for a note about the whole row.
   */
  noteFacet?: string;
};

export type RowAxis = {
  /** log, linear, or "ratio": a symmetric log-ratio axis around 1. */
  kind: AxisKind | "ratio";
  /** Every value the axis must cover (marks, whiskers). */
  values: number[];
  /** Tick text. */
  format: (v: number) => string;
  /** Axis title, with its unit, set under the ticks. */
  title: string;
  /** Tick text, when it should differ from values (fewer decimals). */
  tickFormat?: (v: number) => string;
  /** Captions at the axis's two ends, e.g. ["faster", "slower"]. */
  ends?: [string, string];
  /** A labelled reference line, e.g. 1 for "no change" or "same as wasm32". */
  reference?: number;
  /** Shade ±threshold around `reference` (ratio axes): the reporting threshold. */
  threshold?: number;
  zero?: boolean;
};

export type Panel<R extends RowBase> = {
  id: string;
  /** Facet heading (e.g. "Chrome 156"); omit for a single panel. */
  title?: React.ReactNode;
  /** The row's marks, in SVG, given the shared scale and the cell height. */
  renderMarks: (row: R, s: Scale, h: number, active: boolean) => React.ReactNode;
  /** Where the tooltip points, as a data value; undefined skips the row. */
  anchor: (row: R) => number | undefined;
  /** Text at the row's right end (median and range), optional. */
  renderValue?: (row: R) => React.ReactNode;
  renderTip: (row: R) => React.ReactNode;
  describe: (row: R) => string;
};

export type RowChartProps<R extends RowBase> = {
  rows: R[];
  panels: Panel<R>[];
  axis: RowAxis;
  label: string;
  tableId?: string;
  /** Label column width at desktop sizes, px (default 200). */
  labelWidth?: number;
  /** Value column width, px (default 96). */
  valueWidth?: number;
  className?: string;
};

const ROW_H = 30;
/** Rows with a detail line under the label. */
const ROW_H2 = 38;
/** Narrow layout: the label line (label, detail and value) above a full-width plot. */
const LABEL_H = 20;
const PLOT_H = 24;
const GROUP_H = 30;
const NOTE_LINE = 18;
const HEAD_H = 28;
/** Below this width, labels sit on their own line above a full-width plot. */
const NARROW = 600;
/** Facets stack when a side-by-side plot would be narrower than this … */
const MIN_FACET = 220;
/** … and always below this chart width. */
const STACK_BELOW = 700;

type Line =
  | { kind: "group"; label: string; y: number; h: number }
  | { kind: "row"; row: number; y: number; h: number }
  | { kind: "note"; row: number; y: number; h: number; left: number; width: number };

/**
 * The engine under DotRange and EffectPlot: rows of marks on one
 * shared horizontal axis, labels on the left in HTML (so they wrap and
 * select like text), an optional value column, facets side by side (or
 * stacked when they don't fit), and the shared inspection model: each row
 * is its own ≥30px hit target, arrow keys move between rows (and facets),
 * Enter pins, and rows link to the table by key.
 *
 * Facets sit side by side from 700px when each plot gets at least 220px:
 * one shared label column, then one plot column per facet, with values in
 * the tooltip (and the table) rather than a value column per facet.
 * Narrower, they stack, one block per facet, each with its value column.
 *
 * Under 600px each row's label sits on its own line, with the value at its
 * right end, above a plot that spans the full width, so value text never
 * prints over the marks.
 */
export function RowChart<R extends RowBase>({ rows, panels, axis, label, tableId, labelWidth = 200, valueWidth = 96, className }: RowChartProps<R>) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const fonts = useFontsReady();
  const hintId = useId();
  const hasValues = panels.some((p) => p.renderValue);
  const narrow = width > 0 && width < NARROW;
  const labelW = narrow ? 0 : labelWidth;
  const plotWith = (perBlock: number, vw: number) => Math.max(60, Math.floor((width - labelW - perBlock * vw - (perBlock - 1) * 20 - 12) / perBlock));
  // Side by side facets share the label column and drop their value columns.
  const stacked = panels.length > 1 && width > 0 && (narrow || width < STACK_BELOW || plotWith(panels.length, 0) < MIN_FACET);
  const faceted = panels.length > 1 && !stacked;
  const showValues = hasValues && !narrow && !faceted;
  // The value column widens to its longest text, so a value never runs back over the plot.
  const outer = useRef<HTMLDivElement>(null);
  const [valueFit, setValueFit] = useState(0);
  const valueW = showValues ? Math.max(valueWidth, valueFit) : 0;
  useLayoutEffect(() => {
    if (!outer.current || !showValues) {
      return;
    }
    let widest = 0;
    for (const el of outer.current.querySelectorAll<HTMLElement>("[data-row-value]")) {
      widest = Math.max(widest, el.scrollWidth);
    }
    // pl-3 before the text.
    const need = Math.min(240, Math.ceil(widest) + 12);
    const fit = need > valueWidth ? need : 0;
    if (fit !== valueFit) {
      setValueFit(fit);
    }
    // Rows and panels decide the text; fonts change its width.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, panels, showValues, valueWidth, valueFit, fonts, width]);
  const perBlock = stacked ? 1 : panels.length;
  const gap = perBlock > 1 ? 20 : 0;
  const plotW = plotWith(perBlock, valueW);
  const blocks = useMemo(() => (stacked ? panels.map((p) => [p]) : [panels]), [stacked, panels]);

  // Lines within each block: group headings, rows, notes. A note with a
  // facet appears only in the block (and under the column) of that facet.
  const rowH = narrow ? LABEL_H + PLOT_H : rows.some((r) => r.detail) ? ROW_H2 : ROW_H;
  const layouts = useMemo(
    () =>
      blocks.map((block) => {
        const out: Line[] = [];
        let y = 0;
        let group: string | undefined;
        rows.forEach((r, i) => {
          if (r.group && r.group !== group) {
            out.push({ kind: "group", label: r.group, y, h: GROUP_H });
            y += GROUP_H;
          }
          group = r.group;
          out.push({ kind: "row", row: i, y, h: rowH });
          y += rowH;
          const j = r.noteFacet === undefined ? -1 : block.findIndex((p) => p.id === r.noteFacet);
          if (r.note && (r.noteFacet === undefined || j >= 0)) {
            const left = j > 0 ? labelW + j * (plotW + valueW + gap) : labelW;
            const w = r.noteFacet !== undefined && block.length > 1 ? plotW + valueW : Math.max(120, width - left - 8);
            // Measured only once laid out, so the server and first client render agree.
            const h = (width ? Math.ceil(textWidth(r.note, 13) / w) : 1) * NOTE_LINE + 6;
            out.push({ kind: "note", row: i, y, h, left, width: w });
            y += h;
          }
        });
        return { lines: out, height: y };
      }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [blocks, rows, rowH, labelW, plotW, valueW, gap, width, fonts],
  );

  const scale = useMemo(() => {
    const vals = axis.values.filter((v) => Number.isFinite(v) && (axis.kind === "linear" || v > 0));
    const lo = Math.min(...vals, ...(axis.reference !== undefined ? [axis.reference] : []));
    const hi = Math.max(...vals, ...(axis.reference !== undefined ? [axis.reference] : []));
    const measure = (v: number) => textWidth((axis.tickFormat ?? axis.format)(v), 12);
    // Keep a mark at the axis's far end (and its focus ring) clear of the value column.
    const end = plotW - (valueW ? 14 : 6);
    if (axis.kind === "ratio") {
      return ratioScale(lo, hi, 6, end, { measure, threshold: axis.threshold, gap: 6 });
    }
    if (axis.kind === "log") {
      return logScale(lo, hi, 6, end, { measure, gap: 12 });
    }
    return linearScale(lo, hi, 6, end, { measure, gap: 12, zero: axis.zero, include: axis.reference !== undefined ? [axis.reference] : [], maxTicks: 6 });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, plotW, valueW, fonts]);

  // End captions side by side when they fit, else on two lines.
  const endsStacked = !!axis.ends && width > 0 && textWidth(`\u2190 ${axis.ends[0]}`, 12) + textWidth(`${axis.ends[1]} \u2192`, 12) + 16 > plotW;
  const AXIS_H = axis.ends ? (endsStacked ? 54 : 40) : 26;
  const hasHead = panels.some((p) => p.title !== undefined);
  const blockH = (b: number) => (hasHead ? HEAD_H : 0) + layouts[b].height + AXIS_H;
  const blockGap = 28;
  const titleH = 22;
  const blockTop = (b: number) => layouts.slice(0, b).reduce((sum, _, i) => sum + blockH(i) + blockGap, 0);

  const targets: Target[] = useMemo(() => {
    if (!width) {
      return [];
    }
    const out: Target[] = [];
    blocks.forEach((block, b) => {
      const top = blockTop(b) + (hasHead ? HEAD_H : 0);
      block.forEach((p, j) => {
        const col = stacked ? b : j;
        const left = labelW + j * (plotW + valueW + gap);
        for (const l of layouts[b].lines) {
          if (l.kind !== "row") {
            continue;
          }
          const r = rows[l.row];
          const a = p.anchor(r);
          if (a === undefined || !Number.isFinite(a)) {
            continue;
          }
          out.push({
            id: `${p.id}:${r.id}`,
            key: r.key ?? r.id,
            x: left + scale(a),
            y: top + l.y + (narrow ? LABEL_H + PLOT_H / 2 : l.h / 2),
            row: l.row,
            col,
            describe: p.describe(r),
            tip: p.renderTip(r),
          });
        }
      });
    });
    return out;
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [width, blocks, rows, layouts, scale, labelW, plotW, valueW, gap, stacked, hasHead, narrow, AXIS_H]);

  const nav = useChartNav(targets);
  const total = width
    ? blockTop(blocks.length - 1) + blockH(blocks.length - 1) + titleH
    : (hasHead ? HEAD_H : 0) + (layouts[0]?.height ?? 0) + AXIS_H + titleH;

  /** Gridlines, threshold band and reference line behind one cell's marks. */
  const backdrop = (h: number) => (
    <>
      {axis.threshold !== undefined && axis.reference !== undefined ? (
        <rect
          x={scale(axis.reference * (1 - axis.threshold))}
          width={scale(axis.reference * (1 + axis.threshold)) - scale(axis.reference * (1 - axis.threshold))}
          y={0}
          height={h}
          className="fill-band"
        />
      ) : null}
      {scale.ticks.map((t) => (
        <line key={t} x1={scale(t)} x2={scale(t)} y1={0} y2={h} className="stroke-grid" />
      ))}
      {axis.reference !== undefined ? <line x1={scale(axis.reference)} x2={scale(axis.reference)} y1={0} y2={h} className="stroke-ink-2" /> : null}
    </>
  );

  const rowState = (r: R) => (r.key ?? r.id) === nav.active;

  return (
    <div ref={outer} className={clsx("relative", className)}>
      {/* A chart is one tab stop with arrow-key inspection; no native element carries that role. */}
      <div
        ref={ref}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="group"
        aria-roledescription="chart"
        aria-label={label}
        aria-describedby={clsx(hintId, tableId)}
        {...nav.containerProps}
        className="relative rounded-[2px] outline-offset-4"
        style={{ minHeight: total }}
        onPointerLeave={() => nav.hover(null)}
      >
        {width
          ? blocks.map((block, b) => (
              <div
                key={b}
                className="grid"
                style={{
                  gridTemplateColumns: `${labelW}px ${block.map(() => (valueW ? `${plotW}px ${valueW}px` : `${plotW}px`)).join(` ${gap}px `)}`,
                  marginTop: b ? blockGap : 0,
                }}
              >
                {hasHead ? (
                  <>
                    <div style={{ height: HEAD_H }} />
                    {block.map((p, j) => (
                      <Fragment key={p.id}>
                        {j > 0 ? <div /> : null}
                        <div className={clsx(valueW ? "col-span-2" : "col-span-1", "self-end border-b border-ink-3 pb-1 text-sm font-semibold text-ink")}>{p.title}</div>
                      </Fragment>
                    ))}
                  </>
                ) : null}
                {layouts[b].lines.map((l) => {
                  if (l.kind === "group") {
                    return (
                      <div key={`g${l.y}`} className="flex items-end pb-1 text-sm font-semibold text-ink" style={{ gridColumn: "1 / -1", height: l.h }}>
                        {l.label}
                      </div>
                    );
                  }
                  const r = rows[l.row];
                  const on = rowState(r);
                  if (l.kind === "note") {
                    return (
                      <div key={`n${r.id}`} style={{ gridColumn: "1 / -1", height: l.h, paddingLeft: l.left }}>
                        <p className="pt-0.5 text-cap leading-[18px] text-ink-2" style={{ maxWidth: l.width }}>
                          {r.note}
                        </p>
                      </div>
                    );
                  }
                  const cellProps = (p: Panel<R>) => ({
                    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && nav.hover(`${p.id}:${r.id}`),
                    onClick: () => nav.pin(`${p.id}:${r.id}`),
                  });
                  const marksOn = (p: Panel<R>) =>
                    on && (nav.hoverId === null || nav.hoverId === `${p.id}:${r.id}` || nav.focusId === `${p.id}:${r.id}` || nav.pinId === `${p.id}:${r.id}`);
                  if (narrow) {
                    // One panel per block: the label line (label, detail, value) over a full-width plot.
                    const p = block[0];
                    return (
                      <Fragment key={r.id}>
                        <div />
                        <div {...cellProps(p)} className={clsx("cursor-default", on && "bg-hl")} style={{ height: l.h }}>
                          <div className="flex items-baseline gap-2 leading-tight" style={{ height: LABEL_H }}>
                            <span className={clsx("min-w-0 truncate text-sm", on ? "font-semibold text-ink" : "text-ink")}>
                              {r.label}
                              {r.detail ? <span className="text-xs font-normal text-ink-3"> · {r.detail}</span> : null}
                            </span>
                            {p.renderValue ? <span className="ml-auto shrink-0 text-cap whitespace-nowrap text-ink-2">{p.renderValue(r)}</span> : null}
                          </div>
                          <svg width={plotW} height={PLOT_H} aria-hidden="true" className="block overflow-visible">
                            {backdrop(PLOT_H)}
                            {p.renderMarks(r, scale, PLOT_H, marksOn(p))}
                          </svg>
                        </div>
                      </Fragment>
                    );
                  }
                  return (
                    <Fragment key={r.id}>
                      <div
                        {...cellProps(block[0])}
                        className={clsx("flex min-w-0 cursor-default flex-col justify-center pr-3 leading-tight", on && "bg-hl")}
                        style={{ height: l.h }}
                      >
                        <span className={clsx("truncate text-sm", on ? "font-semibold text-ink" : "text-ink")}>{r.label}</span>
                        {r.detail ? <span className="truncate text-xs text-ink-3">{r.detail}</span> : null}
                      </div>
                      {block.map((p, j) => (
                        <Fragment key={p.id}>
                          {j > 0 ? <div className={clsx(on && "bg-hl")} /> : null}
                          <div {...cellProps(p)} className={clsx("cursor-default", on && "bg-hl")} style={{ height: l.h }}>
                            <svg width={plotW} height={l.h} aria-hidden="true" className="block overflow-visible">
                              {backdrop(l.h)}
                              {p.renderMarks(r, scale, l.h, marksOn(p))}
                            </svg>
                          </div>
                          {valueW ? (
                            <div {...cellProps(p)} className={clsx("flex items-center justify-end pl-3 text-right text-cap leading-tight whitespace-nowrap text-ink-2", on && "bg-hl")} style={{ height: l.h }}>
                              <span data-row-value="">{p.renderValue?.(r)}</span>
                            </div>
                          ) : null}
                        </Fragment>
                      ))}
                    </Fragment>
                  );
                })}
                {/* Axis */}
                <div style={{ height: AXIS_H }} />
                {block.map((p, j) => (
                  <Fragment key={`a${p.id}`}>
                    {j > 0 ? <div /> : null}
                    <svg width={plotW} height={AXIS_H} aria-hidden="true" className="fig-text block overflow-visible">
                      <line x1={0} x2={plotW} y1={0.5} y2={0.5} className="stroke-ink-3" />
                      {scale.ticks.map((t) => (
                        <g key={t}>
                          <line x1={scale(t)} x2={scale(t)} y1={0} y2={4} className="stroke-ink-3" />
                          <text x={scale(t)} y={16} textAnchor="middle" className="fill-ink-3 text-xs">
                            {(axis.tickFormat ?? axis.format)(t)}
                          </text>
                        </g>
                      ))}
                      {axis.ends ? (
                        <>
                          <text x={0} y={33} className="fill-ink-2 text-xs">
                            {`← ${axis.ends[0]}`}
                          </text>
                          <text x={plotW} y={endsStacked ? 47 : 33} textAnchor="end" className="fill-ink-2 text-xs">
                            {`${axis.ends[1]} →`}
                          </text>
                        </>
                      ) : null}
                    </svg>
                    {valueW ? <div /> : null}
                  </Fragment>
                ))}
              </div>
            ))
          : null}
        {width ? (
          <p className="text-cap text-ink-2" style={{ paddingLeft: labelW }}>
            {axis.title}
          </p>
        ) : null}
        <Tooltip target={nav.tipTarget} width={width} />
      </div>
      <p id={hintId} className="sr-only">
        {KEY_HINT}
      </p>
      <p aria-live="polite" className="sr-only">
        {nav.live}
      </p>
    </div>
  );
}
