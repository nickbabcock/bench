import { type RowBase, RowChart, Tip } from "@/components/charts";
import { formatInteger } from "@/lib/format";

/** One module: its change in bytes per panel, in percent (−5.5 is 5.5% smaller). */
export type SizeBarRow = RowBase & {
  values: Record<string, { pct: number; from: number; to: number } | undefined>;
};

type SizeBarsProps = {
  rows: SizeBarRow[];
  /** One panel per comparison, side by side on one shared axis from zero. `hollow` draws the bars as outlines (the second series). */
  panels: { id: string; title: string; hollow?: boolean }[];
  label: string;
  tableId?: string;
  labelWidth?: number;
};

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
/** A row's name in text (tooltips and screen readers). */
const rowName = (r: SizeBarRow) => (typeof r.label === "string" ? r.label : r.id);
/**
 * Tick text without "%" (the axis title has the unit): side-by-side panels
 * sit 20px apart, and a panel's end ticks are centred 6px inside it, so
 * "+7.5%" and "−7.5%" would run together across the gap.
 */
const tickFormat = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Number(Math.abs(v).toFixed(1))}`;

/**
 * Exact changes in bytes as labelled bars from zero: one panel per
 * comparison, sharing a linear axis, each bar labelled with its value at
 * its end. Sizes are deterministic, so there is no interval and every bar
 * is drawn in the accent (none is "not claimed").
 */
export function SizeBars({ rows, panels, label, tableId, labelWidth }: SizeBarsProps) {
  const vals = rows.flatMap((r) => panels.flatMap((p) => (r.values[p.id] ? [r.values[p.id]!.pct] : [])));
  // Room past each bar's end for its label.
  const span = Math.max(1, ...vals.map(Math.abs));
  const pad = span * 0.32;
  const values = [0, ...vals.map((v) => (v < 0 ? v - pad : v + pad))];
  return (
    <RowChart
      rows={rows}
      label={label}
      tableId={tableId}
      labelWidth={labelWidth}
      axis={{ kind: "linear", values, format: signed, tickFormat, title: "Change in brotli bytes (%)", reference: 0, ends: ["smaller", "larger"] }}
      panels={panels.map((p) => ({
        id: p.id,
        title: p.title,
        anchor: (r: SizeBarRow) => r.values[p.id]?.pct,
        renderTip: (r: SizeBarRow) => {
          const v = r.values[p.id];
          return v ? (
            <Tip
              value={signed(v.pct)}
              lines={[`${rowName(r)} · ${p.title}`, `${formatInteger(v.from)} → ${formatInteger(v.to)} bytes (brotli)`]}
            />
          ) : null;
        },
        describe: (r: SizeBarRow) => {
          const v = r.values[p.id];
          return v
            ? `${rowName(r)}, ${p.title}: ${signed(v.pct)}, ${formatInteger(v.from)} to ${formatInteger(v.to)} brotli bytes.`
            : `${rowName(r)}, ${p.title}: no data.`;
        },
        renderMarks: (r: SizeBarRow, s, h, active) => {
          const v = r.values[p.id];
          if (!v) {
            return null;
          }
          const x0 = s(0);
          const x1 = s(v.pct);
          const bh = 12;
          const y = h / 2 - bh / 2;
          const left = Math.min(x0, x1);
          const w = Math.max(1, Math.abs(x1 - x0));
          return (
            <>
              <rect
                x={left + (p.hollow ? 0.75 : 0)}
                y={y + (p.hollow ? 0.75 : 0)}
                width={Math.max(1, w - (p.hollow ? 1.5 : 0))}
                height={bh - (p.hollow ? 1.5 : 0)}
                strokeWidth={p.hollow ? 1.5 : 0}
                className={p.hollow ? "fill-bg stroke-accent" : "fill-accent"}
              />
              {active ? <rect x={left - 3} y={y - 3} width={w + 6} height={bh + 6} strokeWidth={1.5} className="fill-none stroke-ink" /> : null}
              <text x={v.pct < 0 ? x1 - 5 : x1 + 5} y={h / 2 + 4} textAnchor={v.pct < 0 ? "end" : "start"} className="fill-ink text-xs font-semibold tabular-nums">
                {signed(v.pct)}
              </text>
            </>
          );
        },
      }))}
    />
  );
}
