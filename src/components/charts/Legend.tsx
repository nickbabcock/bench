import { clsx } from "clsx";

export type LegendMark = { kind: "dot" | "whisker"; tone: "accent" | "mine" | "grey" } | { kind: "faint" } | { kind: "band" };

export type LegendItem = { mark: LegendMark; label: React.ReactNode };

const fillOf = { accent: "fill-accent", mine: "fill-mine", grey: "fill-dot" } as const;
const strokeOf = { accent: "stroke-accent", mine: "stroke-mine", grey: "stroke-dot" } as const;

/** The legend's mark, drawn like the figure draws it. */
export const LegendSwatch = ({ mark }: { mark: LegendMark }) => (
  <svg width={mark.kind === "dot" ? 12 : 20} height={12} aria-hidden="true" className="shrink-0">
    {mark.kind === "dot" ? <circle cx={6} cy={6} r={4.5} className={fillOf[mark.tone]} /> : null}
    {mark.kind === "whisker" ? <line x1={2} x2={18} y1={6} y2={6} strokeWidth={2} strokeLinecap="round" className={strokeOf[mark.tone]} /> : null}
    {mark.kind === "faint" ? <line x1={1} x2={19} y1={6} y2={6} strokeWidth={1} className="stroke-dot-soft" /> : null}
    {mark.kind === "band" ? <rect x={4} y={0} width={12} height={12} className="fill-band" /> : null}
  </svg>
);

/**
 * A figure's key, in one row above the plot: the marks as drawn, then
 * their meaning in text tokens (never in the series colour).
 */
export const Legend = ({ items, className }: { items: LegendItem[]; className?: string }) => (
  <ul className={clsx("mb-2 flex flex-wrap gap-x-5 gap-y-1 text-cap text-ink-2", className)}>
    {items.map((it, i) => (
      <li key={i} className="flex items-center gap-1.5">
        <LegendSwatch mark={it.mark} />
        <span>{it.label}</span>
      </li>
    ))}
  </ul>
);
