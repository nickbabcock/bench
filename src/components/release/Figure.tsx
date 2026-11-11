import { clsx } from "clsx";
import { nbNode } from "./nb";

/** The anchor id of Figure n, which MainPoints links to. */
export const figureId = (n: number) => `figure-${n}`;

export type FigureProps = {
  /** Figure number, cited by main points as "(Figure n)". */
  n: number;
  /**
   * The answer to the figure's fixed question, from the finding generator
   * (src/lib/findings.ts), or its neutral fallback title when nothing is
   * claimed ("Ratio against decompression speed").
   */
  title: React.ReactNode;
  /** What is plotted, with units and scale, plus the one "how to read" clause. */
  subtitle?: React.ReactNode;
  /** A key above the plot (<Legend>), when the chart doesn't draw its own. */
  legend?: React.ReactNode;
  /** The chart. */
  children: React.ReactNode;
  /**
   * Where this figure's data comes from, only when that differs from the
   * page's provenance (the release header and the Measurement notes line,
   * which name the edition, machine, OS build, browser and samples once).
   * Omit it for a figure of the page's own data. Pass it for code sizes
   * "measured at build time", a this-machine comparison with a reference
   * edition, or a browser other than the page's.
   */
  source?: React.ReactNode;
  /**
   * Only what is specific to this figure, at most two short lines.
   * Boilerplate (pairing, threshold, timer, edition) belongs on Method and
   * in the Measurement notes.
   */
  notes?: React.ReactNode;
  className?: string;
};

/**
 * A release figure: numbered finding-title, subtitle, chart, then a
 * hairline and the Source and Notes lines, each only when given.
 */
export const Figure = ({ n, title, subtitle, legend, children, source, notes, className }: FigureProps) => {
  const id = figureId(n);
  return (
    <figure id={id} aria-labelledby={`${id}-t`} className={clsx("mt-7 scroll-mt-4 first:mt-0 [&+&]:mt-[52px]", className)}>
      <h3 id={`${id}-t`} className="max-w-[62ch] text-fig font-bold text-ink">
        <span className="text-ink-2">Figure {n}. </span>
        {nbNode(title)}
      </h3>
      {subtitle ? <p className="mt-1 mb-3 max-w-[80ch] text-sm text-ink-2">{subtitle}</p> : <div className="mb-3" />}
      {legend}
      <div className="min-w-0">{children}</div>
      {source || notes ? (
        <figcaption className="prose-links mt-2.5 border-t border-rule pt-2 text-cap text-ink-2 [&>p]:max-w-[110ch] [&>p+p]:mt-1">
          {source ? (
            <p>
              <b className="font-semibold text-ink">Source: </b>
              {source}
            </p>
          ) : null}
          {notes ? (
            <p>
              <b className="font-semibold text-ink">Notes: </b>
              {notes}
            </p>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
};
