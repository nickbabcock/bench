import { clsx } from "clsx";
import { figureId } from "./Figure";
import { keepTogether } from "./nb";

export type MainPoint = {
  /**
   * One short sentence, computed from data (src/lib/findings.ts), never
   * hand-written: at most 25 words, no chained parentheses. A string keeps
   * hyphenated names ("wasm-opt", "-O3") on one line without `nb`, so
   * copied flags paste as typed.
   */
  text: React.ReactNode;
  /** The figure(s) it summarises, cited as "(Figure n)" and linked. */
  figure?: number | number[];
  /** Stable key; defaults to the index. */
  id?: string;
};

export type MainPointsProps = {
  /** At most three, one per figure or decision. */
  points: MainPoint[];
  /** Marker colour: mine when the points describe this machine. */
  tone?: "accent" | "mine";
  /** Shown when there are no points (nothing cleared the threshold). */
  empty?: React.ReactNode;
  className?: string;
};

const cite = (figure: number | number[]) => {
  const ns = Array.isArray(figure) ? figure : [figure];
  return (
    <>
      {" ("}
      {ns.length > 1 ? "Figures " : "Figure "}
      {ns.map((n, i) => (
        <span key={n}>
          {i > 0 ? (i === ns.length - 1 ? " and " : ", ") : null}
          <a href={`#${figureId(n)}`} className="link">
            {n}
          </a>
        </span>
      ))}
      {")"}
    </>
  );
};

/** The release's main points: short plain sentences with square markers, each citing its figure. */
export const MainPoints = ({ points, tone = "accent", empty, className }: MainPointsProps) =>
  points.length === 0 && empty ? (
    <p className={clsx("max-w-measure text-ink-2", className)}>{empty}</p>
  ) : (
    <ul className={clsx("max-w-measure space-y-3", className)}>
      {points.map((p, i) => (
        <li
          key={p.id ?? i}
          className={clsx(
            "relative pl-[22px] before:absolute before:top-[0.62em] before:left-0.5 before:size-[7px] before:rounded-[1px]",
            tone === "mine" ? "before:bg-mine" : "before:bg-accent",
          )}
        >
          {typeof p.text === "string" ? keepTogether(p.text) : p.text}
          {p.figure !== undefined ? cite(p.figure) : null}
        </li>
      ))}
    </ul>
  );
