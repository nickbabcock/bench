/**
 * Chart primitives: hand-built SVG, themed by CSS tokens (accent, mine,
 * dot, grid …), no chart library. Every primitive is one tab stop with
 * arrow-key inspection, a ≥24px hit target, tooltips, tap-to-pin, and
 * links to tables through HighlightScope (src/components/highlight.tsx).
 * Pass `tableId` so the chart points screen readers at its text
 * equivalent.
 */
export { DotRange, type DotRangeCell, type DotRangeFacet, type DotRangeProps, type DotRangeRow } from "./DotRange";
export { EffectPlot, type EffectCell, type EffectPlotProps, type EffectRow } from "./EffectPlot";
export { Legend, LegendSwatch, type LegendItem, type LegendMark } from "./Legend";
export { RowChart, type Panel, type RowAxis, type RowBase, type RowChartProps } from "./RowChart";
export { Tip } from "./interaction";
export { linearScale, logScale, ratioPercent, ratioScale, ratioTick, type AxisKind, type Scale } from "./scale";
