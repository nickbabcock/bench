/**
 * Figure 3: each implementation's speed in Firefox and in Safari relative
 * to Chrome's, on a log axis around 1×. Rows are implementations grouped
 * by runtime (wasm, built into the browser, JavaScript); one facet per
 * browser; a filled dot for decompression and a ring for compression,
 * each at the median ratio with a whisker over every input, level and
 * capture. The wasm rows sit near 1×; the others spread.
 */
import { clsx } from "clsx";
import { useId, useMemo } from "react";
import { KEY_HINT, Tip, type Target, Tooltip, useChartNav } from "@/components/charts/interaction";
import { textWidth, useFontsReady } from "@/components/charts/text";
import { Figure } from "@/components/release";
import { median } from "@/lib/stats";
import { useWidth } from "@/hooks";
import { type Family, familyInfo, type FormatId, formatInfo, implementationsOf } from "./codecs";
import type { EngineRatio } from "./points";

type Metric = "decode" | "encode";
type Mark = { mid: number; lo: number; hi: number };
type Row = { family: Family; group: string; cells: Record<string, Partial<Record<Metric, Mark>>> };

const GROUPS: Record<(typeof familyInfo)[Family]["runtime"], string> = { Wasm: "wasm", Browser: "Built into the browser", JS: "JavaScript" };
const ORDER = ["Wasm", "Browser", "JS"] as const;
const ROW_H = 30;
const GROUP_H = 26;
const HEAD_H = 26;
const AXIS_H = 40;
const TICKS = [1 / 3, 1 / 2, 1, 2, 3];
const tickText = (t: number) => (t === 1 / 3 ? "⅓×" : t === 1 / 2 ? "½×" : `${t}×`);
const ratioText = (r: number) => `${r.toFixed(2)}×`;
const OP: Record<Metric, string> = { decode: "decompress", encode: "compress" };

export function BrowserFigure({ n, format, ratios, base, inputs, source }: { n: number; format: FormatId; ratios: readonly EngineRatio[]; base: string; inputs: number; source?: React.ReactNode }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const fonts = useFontsReady();
  const hintId = useId();
  const engines = useMemo(() => [...new Set(ratios.map((r) => r.engine))], [ratios]);
  const rows = useMemo<Row[]>(
    () =>
      implementationsOf(format)
        .filter((f) => ratios.some((r) => r.family === f))
        .sort((a, b) => ORDER.indexOf(familyInfo[a].runtime) - ORDER.indexOf(familyInfo[b].runtime))
        .map((family) => ({
          family,
          group: GROUPS[familyInfo[family].runtime],
          cells: Object.fromEntries(
            engines.map((e) => [
              e,
              Object.fromEntries(
                (["decode", "encode"] as const).flatMap((m) => {
                  const xs = ratios.filter((r) => r.family === family && r.engine === e && r.metric === m).map((r) => r.ratio);
                  return xs.length ? [[m, { mid: median(xs), lo: Math.min(...xs), hi: Math.max(...xs) }]] : [];
                }),
              ),
            ]),
          ),
        })),
    [format, ratios, engines],
  );

  const layout = useMemo(() => {
    if (!width) {
      return null;
    }
    const side = width >= 700;
    const labelW = Math.ceil(Math.max(...rows.map((r) => textWidth(familyInfo[r.family].name, 14)), 60)) + 16;
    const gap = 28;
    const plotW = side ? Math.floor((width - labelW - gap * (engines.length - 1)) / engines.length) : width - labelW;
    const all = rows.flatMap((r) => Object.values(r.cells).flatMap((c) => Object.values(c).flatMap((m) => [m.lo, m.hi])));
    const d0 = Math.min(1 / 3.2, ...all.map((v) => v / 1.06));
    const d1 = Math.max(3.2, ...all.map((v) => v * 1.06));
    const xs = (v: number) => 8 + (Math.log(v / d0) / Math.log(d1 / d0)) * (plotW - 16);
    let y = 0;
    let prev: string | undefined;
    const lines = rows.map((r) => {
      const head = r.group !== prev;
      if (head) {
        y += GROUP_H;
      }
      prev = r.group;
      const line = { row: r, y, head };
      y += ROW_H;
      return line;
    });
    const blockH = HEAD_H + y + AXIS_H;
    const facets = engines.map((e, i) => ({ engine: e, left: side ? labelW + i * (plotW + gap) : labelW, top: side ? 0 : i * (blockH + 20) }));
    const total = side ? blockH : engines.length * (blockH + 20) - 20;
    return { side, labelW, plotW, xs, lines, blockH, facets, total };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [width, rows, engines, fonts]);

  const targets: Target[] = useMemo(() => {
    if (!layout) {
      return [];
    }
    return layout.facets.flatMap((f, col) =>
      layout.lines.flatMap((l, row) => {
        const c = l.row.cells[f.engine];
        const at = c.decode ?? c.encode;
        if (!at) {
          return [];
        }
        const name = familyInfo[l.row.family].name;
        const part = (m: Metric) => (c[m] ? `${OP[m]} ${ratioText(c[m]!.mid)} (${ratioText(c[m]!.lo)}–${ratioText(c[m]!.hi)})` : undefined);
        const parts = (["decode", "encode"] as const).flatMap((m) => part(m) ?? []);
        return [
          {
            id: `${f.engine}:${l.row.family}`,
            key: `browser:${l.row.family}`,
            x: f.left + layout.xs(at.mid),
            y: f.top + HEAD_H + l.y + ROW_H / 2,
            row,
            col,
            describe: `${name} in ${f.engine}, relative to ${base}: ${parts.join("; ")}.`,
            tip: <Tip value={`${name} in ${f.engine}`} lines={[...parts.map((p) => `${p[0].toUpperCase()}${p.slice(1)}`), `× ${base}'s speed; range over ${inputs} inputs`]} />,
          },
        ];
      }),
    );
  }, [layout, base, inputs]);
  const nav = useChartNav(targets);

  const marks = (m: Mark, metric: Metric, cy: number, xs: (v: number) => number) => (
    <g key={metric}>
      <line x1={xs(m.lo)} x2={xs(m.hi)} y1={cy} y2={cy} strokeWidth={2} strokeLinecap="round" className="stroke-accent" />
      {metric === "decode" ? (
        <circle cx={xs(m.mid)} cy={cy} r={4.5} strokeWidth={2} className="fill-accent stroke-bg" />
      ) : (
        <circle cx={xs(m.mid)} cy={cy} r={3.75} strokeWidth={2} className="fill-bg stroke-accent" />
      )}
    </g>
  );

  return (
    <Figure
      n={n}
      title={`${formatInfo[format].name} speed relative to ${base}`}
      subtitle={`Speed ÷ speed in ${base}, log scale; lines span ${inputs} inputs, every level and capture.`}
      source={source}
      legend={
        <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-cap text-ink-2">
          <li className="flex items-center gap-1.5">
            <svg width={12} height={12} aria-hidden="true">
              <circle cx={6} cy={6} r={4.5} className="fill-accent" />
            </svg>
            decompress
          </li>
          <li className="flex items-center gap-1.5">
            <svg width={12} height={12} aria-hidden="true">
              <circle cx={6} cy={6} r={3.75} strokeWidth={2} className="fill-bg stroke-accent" />
            </svg>
            compress
          </li>
        </ul>
      }
    >
      <div className="relative">
        <div
          ref={ref}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="group"
          aria-roledescription="chart"
          aria-label={`${formatInfo[format].name} implementations' speed in ${engines.join(" and ")} relative to ${base}`}
          aria-describedby={hintId}
          {...nav.containerProps}
          className="relative rounded-[2px] outline-offset-4"
          style={{ height: layout?.total ?? 400 }}
          onPointerLeave={() => nav.hover(null)}
        >
          {layout ? (
            <svg width={width} height={layout.total} aria-hidden="true" className="fig-text block overflow-visible">
              {layout.facets.map((f) => (
                <g key={f.engine} transform={`translate(0 ${f.top})`}>
                  {/* Row labels, once beside facets or per stacked block */}
                  {f === layout.facets[0] || !layout.side
                    ? layout.lines.map((l) => (
                        <g key={`l${l.row.family}`}>
                          {l.head ? (
                            <text x={0} y={HEAD_H + l.y - 8} className="fill-ink text-sm font-semibold">
                              {l.row.group}
                            </text>
                          ) : null}
                          <text x={0} y={HEAD_H + l.y + ROW_H / 2} dy="0.35em" className="fill-ink text-sm">
                            {familyInfo[l.row.family].name}
                          </text>
                        </g>
                      ))
                    : null}
                  <g transform={`translate(${f.left} 0)`}>
                    <text x={0} y={HEAD_H - 9} className="fill-ink text-sm font-semibold">
                      {f.engine}
                    </text>
                    <line x1={0} x2={layout.plotW} y1={HEAD_H - 2} y2={HEAD_H - 2} className="stroke-ink-3" />
                    {TICKS.map((t) => (
                      <line key={`g${t}`} x1={layout.xs(t)} x2={layout.xs(t)} y1={HEAD_H} y2={layout.blockH - AXIS_H} className={t === 1 ? "stroke-ink-2" : "stroke-grid"} />
                    ))}
                    {layout.lines.map((l) => {
                      const c = l.row.cells[f.engine];
                      const cy = HEAD_H + l.y + ROW_H / 2;
                      const on = nav.tipTarget?.id === `${f.engine}:${l.row.family}`;
                      return (
                        <g key={l.row.family}>
                          {on ? <rect x={0} y={cy - ROW_H / 2} width={layout.plotW} height={ROW_H} className="fill-hl" /> : null}
                          {c.decode ? marks(c.decode, "decode", c.encode ? cy - 5 : cy, layout.xs) : null}
                          {c.encode ? marks(c.encode, "encode", c.decode ? cy + 5 : cy, layout.xs) : null}
                          <rect
                            x={0}
                            y={cy - ROW_H / 2}
                            width={layout.plotW}
                            height={ROW_H}
                            fill="transparent"
                            onPointerEnter={(e) => e.pointerType === "mouse" && nav.hover(`${f.engine}:${l.row.family}`)}
                            onClick={() => nav.pin(`${f.engine}:${l.row.family}`)}
                          />
                        </g>
                      );
                    })}
                    <g transform={`translate(0 ${layout.blockH - AXIS_H})`}>
                      <line x1={0} x2={layout.plotW} y1={0.5} y2={0.5} className="stroke-ink-3" />
                      {TICKS.map((t) => (
                        <g key={`t${t}`}>
                          <line x1={layout.xs(t)} x2={layout.xs(t)} y1={0} y2={4} className="stroke-ink-3" />
                          <text x={layout.xs(t)} y={16} textAnchor="middle" className={clsx("text-xs", t === 1 ? "fill-ink-2" : "fill-ink-3")}>
                            {tickText(t)}
                          </text>
                        </g>
                      ))}
                      <text x={0} y={33} className="fill-ink-2 text-xs">
                        ← slower
                      </text>
                      <text x={layout.plotW} y={33} textAnchor="end" className="fill-ink-2 text-xs">
                        faster →
                      </text>
                    </g>
                  </g>
                </g>
              ))}
            </svg>
          ) : null}
          <Tooltip target={nav.tipTarget} width={width} />
        </div>
        <p id={hintId} className="sr-only">
          {KEY_HINT.replace("between points", "between implementations; Left and Right between browsers")}
        </p>
        <p aria-live="polite" className="sr-only">
          {nav.live}
        </p>
      </div>
    </Figure>
  );
}
