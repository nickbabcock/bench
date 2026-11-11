/**
 * Figures 1 and 2: which configuration is fastest at each bandwidth, for
 * every input and browser at once. One thin strip per setting on a log
 * bandwidth axis, grouped by input with the browsers adjacent; each
 * stretch where a configuration is fastest by more than 3% in every
 * capture is a segment in its codec's colour, named where the name fits;
 * "about the same" is grey and unnamed. Agreement reads down a column of
 * one colour; an exception is a different colour in one strip.
 *
 * Hover, tap or the arrow keys give a segment's band, winner and lead.
 */
import { clsx } from "clsx";
import { useId, useMemo } from "react";
import { KEY_HINT, Tip, type Target, Tooltip, useChartNav } from "@/components/charts/interaction";
import { textWidth, useFontsReady } from "@/components/charts/text";
import { listText } from "@/lib/findings";
import { useWidth } from "@/hooks";
import { rangeText } from "./findings";
import { legendOrder, MAP_STYLE, SAME_CLASS, winnerClass } from "./mapColors";
import type { Strip } from "./release";
import { type Band, bandLead, BANDWIDTH, bandwidthText, type Scenario, UNCOMPRESSED } from "./transfer";

const STRIP = 20;
const PITCH = 24;
const GROUP_GAP = 10;
const AXIS_H = 34;
/** Under this width, each input gets a heading line and the label column holds the browser alone. */
const NARROW = 560;

const pctText = (x: number) => `${x * 100 < 10 ? (x * 100).toFixed(1) : Math.round(x * 100)}%`;
const capital = (t: string) => `${t[0].toUpperCase()}${t.slice(1)}`;

type BandMapProps = {
  strips: Strip[];
  scenario: Scenario;
  /** Accessible name. */
  label: string;
  /** A strip's browser as shown ("Chrome 156"). */
  engineName: (s: Strip) => string;
};

export function BandMap({ strips, scenario, label, engineName }: BandMapProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const fonts = useFontsReady();
  const hintId = useId();
  const narrow = width > 0 && width < NARROW;
  const names = useMemo(() => new Map(strips.flatMap((s) => s.captures[0] ?? []).map((l) => [l.id, l.id === UNCOMPRESSED ? "no compression" : l.label])), [strips]);
  const name = (id: string) => names.get(id) ?? id;
  const single = strips.length === 1;

  const layout = useMemo(() => {
    if (!width) {
      return null;
    }
    const inputW = narrow || single ? 0 : Math.ceil(Math.max(...strips.map((s) => textWidth(s.input, 14, 600)))) + 14;
    const engineW = Math.ceil(Math.max(...strips.map((s) => textWidth(single ? `${s.input} · ${engineName(s)}` : engineName(s), 13)))) + 12;
    const L = inputW + engineW;
    const R = width - 8;
    const xs = (mbps: number) => L + (Math.log(mbps / BANDWIDTH.lo) / Math.log(BANDWIDTH.hi / BANDWIDTH.lo)) * (R - L);
    let y = 0;
    let prev: string | undefined;
    const rows = strips.map((s) => {
      const first = s.input !== prev;
      if (first && prev !== undefined) {
        y += GROUP_GAP;
      }
      if (first && narrow && !single) {
        y += 20;
      }
      prev = s.input;
      const row = { strip: s, y, first };
      y += PITCH;
      return row;
    });
    const xTicks = narrow ? [1, 10, 100, 1000] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    return { L, R, xs, rows, height: y, inputW, xTicks };
    // engineName is a pure label function.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [width, strips, narrow, single, fonts]);

  const targets: Target[] = useMemo(() => {
    if (!layout) {
      return [];
    }
    return layout.rows.flatMap((r, i) =>
      r.strip.bands.map((b, j) => {
        const where = `${r.strip.input}, ${engineName(r.strip)}`;
        const lead = bandLead(r.strip.captures, b);
        const span = capital(rangeText(b));
        const x = (layout.xs(Math.max(b.from, BANDWIDTH.lo)) + layout.xs(Math.min(b.to, BANDWIDTH.hi))) / 2;
        return {
          id: `${r.strip.id}:${j}`,
          key: b.winner ?? `same:${r.strip.id}:${j}`,
          x,
          y: r.y + STRIP / 2,
          row: i,
          col: j,
          describe: b.winner
            ? `${where}: ${name(b.winner)} fastest ${rangeText(b)}${lead ? `, ahead of the next by ${pctText(lead.min)} to ${pctText(lead.max)}` : ""}.`
            : `${where}: about the same ${rangeText(b)}: ${listText(b.near.map(name))}.`,
          tip: b.winner ? (
            <Tip value={`${name(b.winner)} fastest`} lines={[span, ...(lead ? [`ahead of the next by ${pctText(lead.min)}–${pctText(lead.max)}`] : []), where]} />
          ) : (
            <Tip value="About the same" lines={[span, `within 3%: ${listText(b.near.map(name))}`, where]} />
          ),
        };
      }),
    );
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, names]);

  const nav = useChartNav(targets);
  const winners = [...new Set(strips.flatMap((s) => s.bands.flatMap((b) => (b.winner ? [b.winner] : []))))].sort((a, b) => legendOrder(a) - legendOrder(b));
  const anySame = strips.some((s) => s.bands.some((b) => !b.winner));
  const total = layout ? layout.height + AXIS_H : (single ? 1 : strips.length) * PITCH + AXIS_H;

  const segment = (s: Strip, b: Band, j: number, y: number) => {
    if (!layout || !b.winner) {
      return null;
    }
    const x0 = layout.xs(b.from) + (b.from > BANDWIDTH.lo ? 1 : 0);
    const x1 = layout.xs(b.to) - (b.to < BANDWIDTH.hi ? 1 : 0);
    const w = Math.max(1, x1 - x0);
    const c = winnerClass(b.winner);
    const text = name(b.winner);
    const fits = textWidth(text, 12, 600) + 10 <= w;
    return (
      <g key={`${s.id}:${j}`}>
        <rect x={x0} y={y} width={w} height={STRIP} rx={2} className={c.fill} />
        {fits ? (
          <text x={x0 + w / 2} y={y + STRIP / 2} dy="0.35em" textAnchor="middle" className={clsx(c.text, "text-xs font-semibold")}>
            {text}
          </text>
        ) : null}
      </g>
    );
  };

  return (
    <div className="relative">
      <style>{MAP_STYLE}</style>
      {winners.length || anySame ? (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-cap text-ink-2">
          {winners.map((id) => (
            <li key={id} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={clsx("inline-block h-2.5 w-3.5 rounded-[2px]", winnerClass(id).fill)} />
              {name(id)}
            </li>
          ))}
          {anySame ? (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className={clsx("inline-block h-2.5 w-3.5 rounded-[2px]", SAME_CLASS)} />
              about the same (within 3%)
            </li>
          ) : null}
        </ul>
      ) : null}
      <div
        ref={ref}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="group"
        aria-roledescription="chart"
        aria-label={label}
        aria-describedby={hintId}
        {...nav.containerProps}
        className="relative rounded-[2px] outline-offset-4"
        style={{ height: total }}
        onPointerLeave={() => nav.hover(null)}
      >
        {layout ? (
          <svg width={width} height={total} aria-hidden="true" className="fig-text block overflow-visible">
            {/* Gridlines behind the strips, at the axis ticks */}
            {layout.xTicks.map((t) => (
              <line key={`g${t}`} x1={layout.xs(t)} x2={layout.xs(t)} y1={0} y2={layout.height} className="stroke-grid" />
            ))}
            {layout.rows.map((r) => (
              <g key={r.strip.id}>
                {r.first && narrow && !single ? (
                  <text x={0} y={r.y - 6} className="fill-ink text-sm font-semibold">
                    {r.strip.input}
                  </text>
                ) : null}
                {r.first && layout.inputW ? (
                  <text x={0} y={r.y + STRIP / 2} dy="0.35em" className="fill-ink text-sm font-semibold">
                    {r.strip.input}
                  </text>
                ) : null}
                <text x={layout.inputW} y={r.y + STRIP / 2} dy="0.35em" className="fill-ink-2 text-cap">
                  {single ? `${r.strip.input} · ${engineName(r.strip)}` : engineName(r.strip)}
                </text>
                <rect x={layout.L} y={r.y} width={layout.R - layout.L} height={STRIP} rx={2} className={r.strip.bands.length ? SAME_CLASS : "fill-band"} />
                {r.strip.bands.map((b, j) => segment(r.strip, b, j, r.y))}
                {r.strip.bands.length === 0 ? (
                  <text x={(layout.L + layout.R) / 2} y={r.y + STRIP / 2} dy="0.35em" textAnchor="middle" className="fill-ink-3 text-xs">
                    one sample: nothing compared
                  </text>
                ) : null}
              </g>
            ))}
            {/* The focused or hovered segment */}
            {nav.tipTarget
              ? (() => {
                  const [sid, j] = [nav.tipTarget.id.slice(0, nav.tipTarget.id.lastIndexOf(":")), Number(nav.tipTarget.id.slice(nav.tipTarget.id.lastIndexOf(":") + 1))];
                  const r = layout.rows.find((x) => x.strip.id === sid);
                  const b = r?.strip.bands[j];
                  return r && b ? (
                    <rect
                      x={layout.xs(b.from) - 1}
                      y={r.y - 2}
                      width={layout.xs(b.to) - layout.xs(b.from) + 2}
                      height={STRIP + 4}
                      rx={3}
                      strokeWidth={1.75}
                      className="pointer-events-none fill-none stroke-ink"
                    />
                  ) : null;
                })()
              : null}
            {/* Axis */}
            <g transform={`translate(0 ${layout.height + 2})`}>
              {layout.xTicks.map((t) => {
                const text = bandwidthText(t);
                const tw = textWidth(text, 12);
                const cx = Math.min(width - tw / 2, Math.max(layout.L + tw / 2, layout.xs(t)));
                return (
                  <g key={`x${t}`}>
                    <line x1={layout.xs(t)} x2={layout.xs(t)} y1={0} y2={4} className="stroke-ink-3" />
                    <text x={cx} y={17} textAnchor="middle" className="fill-ink-3 text-xs">
                      {text}
                    </text>
                  </g>
                );
              })}
              <text x={layout.R} y={32} textAnchor="end" className="fill-ink-2 text-cap">
                {scenario === "download" ? "Download bandwidth (log scale)" : "Upload bandwidth (log scale)"}
              </text>
            </g>
            {/* Hit layer: each segment's whole row pitch */}
            {layout.rows.flatMap((r) =>
              r.strip.bands.map((b, j) => {
                const id = `${r.strip.id}:${j}`;
                return (
                  <rect
                    key={`h${id}`}
                    x={layout.xs(b.from)}
                    y={r.y - (PITCH - STRIP) / 2}
                    width={Math.max(4, layout.xs(b.to) - layout.xs(b.from))}
                    height={PITCH}
                    fill="transparent"
                    // The segment as data, for checks against the editions.
                    data-strip={r.strip.id}
                    data-from={b.from}
                    data-to={b.to}
                    data-winner={b.winner ?? ""}
                    onPointerEnter={(e) => e.pointerType === "mouse" && nav.hover(id)}
                    onClick={() => nav.pin(id)}
                  />
                );
              }),
            )}
          </svg>
        ) : null}
        <Tooltip target={nav.tipTarget} width={width} />
      </div>
      <p id={hintId} className="sr-only">
        {KEY_HINT.replace("between points", "between bandwidth bands; Up and Down move between inputs and browsers")}
      </p>
      <p aria-live="polite" className="sr-only">
        {nav.live}
      </p>
    </div>
  );
}
