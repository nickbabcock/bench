/**
 * Colours for the bandwidth maps (Figures 1 and 2): one hue per codec,
 * stepped by level, so a run of zstd 9 → 3 → 1 reads as one blue getting
 * lighter and a brotli exception stands out in another hue.
 *
 * - zstd: the site's accent blue, four steps (levels 1, 3, 9, 15).
 * - brotli: ochre, three steps.
 * - every other codec (Deflate libraries, lz4): rose, three steps.
 * - no compression: neutral ink.
 * - about the same: a pale grey, never labelled.
 *
 * Higher levels sit further from the ground (darker in light, brighter in
 * dark). Validated with the dataviz validator: the three hues pass the
 * all-pairs categorical checks in both themes (rose against blue in light
 * is in the CVD warn band, so every segment that fits carries its name,
 * and the legend and tooltips name the rest), and each ramp passes the
 * ordinal checks against its ground.
 */
import { type Family, familyInfo } from "./codecs";
import { UNCOMPRESSED } from "./transfer";

type Hue = "zstd" | "brotli" | "other";

const RAMPS: Record<Hue, { light: string[]; dark: string[] }> = {
  // Lowest level first.
  zstd: { light: ["#7cb4d3", "#3a8fb7", "#056c92", "#0a4a66"], dark: ["#1f5e75", "#2a87a6", "#4cb3d3", "#8fd0ea"] },
  brotli: { light: ["#d19a4a", "#a3650a", "#7a4a05"], dark: ["#6e5218", "#b8862a", "#e2b866"] },
  other: { light: ["#d77fa2", "#b23a6a", "#8a2a52"], dark: ["#7a3552", "#cf5f8a", "#eaa0bd"] },
};
const NONE = { light: "#3d3d3d", dark: "#d0d6d8" };
/** About the same: grey, a step off the ground. */
const SAME = { light: "#e2e2e2", dark: "#2b3337" };

const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
/** White or near-black, whichever has more contrast on the fill. */
const textOn = (hex: string) => {
  const l = luminance(hex);
  return (1.05 / (l + 0.05) >= (l + 0.05) / 0.06 ? "#ffffff" : "#111111");
};

/** A configuration id ("zstd-15", "lz4", "uncompressed") as family and level. */
function parse(id: string): { family: Family; level: number | null } | undefined {
  const m = /^([a-z0-9]+)(?:-(\d+))?$/.exec(id);
  if (!m || !(m[1] in familyInfo)) {
    return undefined;
  }
  return { family: m[1] as Family, level: m[2] === undefined ? null : Number(m[2]) };
}

/** The colour slot of a winner: hue and step, "none" for no compression. */
function slot(id: string): string {
  if (id === UNCOMPRESSED) {
    return "none";
  }
  const c = parse(id);
  if (!c) {
    return "other-1";
  }
  const format = familyInfo[c.family].format;
  const hue: Hue = format === "zstd" ? "zstd" : format === "brotli" ? "brotli" : "other";
  const steps = RAMPS[hue].light.length;
  const levels = familyInfo[c.family].levels.filter((l): l is number => l !== null).sort((a, b) => a - b);
  const i = c.level === null ? -1 : levels.indexOf(c.level);
  const step = i < 0 || levels.length < 2 ? Math.floor((steps - 1) / 2) : Math.round((i * (steps - 1)) / (levels.length - 1));
  return `${hue}-${step}`;
}

/** Class names for a winner's fill and the text set inside it. */
export const winnerClass = (id: string) => ({ fill: `cmap-${slot(id)}`, text: `cmap-${slot(id)}-t` });
export const SAME_CLASS = "cmap-same";

/** Order for the legend: zstd, brotli, the rest, no compression; within each, highest level first. */
export const legendOrder = (id: string) => {
  const s = slot(id);
  const [hue, step] = s.split("-");
  return ["zstd", "brotli", "other", "none"].indexOf(hue) * 10 - Number(step ?? 0);
};

function rules(mode: "light" | "dark"): string {
  const out: string[] = [];
  for (const hue of Object.keys(RAMPS) as Hue[]) {
    RAMPS[hue][mode].forEach((hex, i) => {
      out.push(`.cmap-${hue}-${i}{fill:${hex};background:${hex}}`, `.cmap-${hue}-${i}-t{fill:${textOn(hex)}}`);
    });
  }
  out.push(`.cmap-none{fill:${NONE[mode]};background:${NONE[mode]}}`, `.cmap-none-t{fill:${textOn(NONE[mode])}}`);
  out.push(`.cmap-same{fill:${SAME[mode]};background:${SAME[mode]}}`);
  return out.join("");
}

const scoped = (css: string, prefix: string) =>
  css
    .split("}")
    .filter(Boolean)
    .map((r) => `${prefix} ${r}}`)
    .join("");

/** The stylesheet: light by default, dark under the site's two dark scopes (the theme switch, or the system unless light was chosen). */
export const MAP_STYLE = [
  rules("light"),
  scoped(rules("dark"), ':where([data-theme="dark"])'),
  `@media (prefers-color-scheme: dark){${scoped(rules("dark"), ':root:not([data-theme="light"])')}}`,
].join("");
