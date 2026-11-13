import { createElement, Fragment } from "react";
import { figureId } from "./Figure";
import { keepTogether } from "./nb";

export type CitedProps = {
  /** A generated sentence citing "(Figure n)", "(Table n)", "(Figure n; table)" or "(Figure n, qualifier)". */
  text: string;
  /** Where "(Table n)" links; without it, Table citations stay plain text. */
  tableHref?: (n: number) => string;
  /** Where the "table" in "(Figure n; table)" links; without it, it stays plain text. */
  tableId?: string;
};

/**
 * A generated sentence for body text or a main point, with every
 * "(Figure n)", "(Table n)" and "(Figure n; table)" in it linked to its
 * anchor. Hyphenated names keep together (`keepTogether`), never `nb`, so
 * copied flags paste as typed. Text in backticks renders as code.
 */
export const Cited = ({ text, tableHref, tableId }: CitedProps) => {
  // A citation may carry "; table" (a linked table) or ", <qualifier>", plain
  // text such as "for any input and browser".
  const parts = text.split(/\((Figure|Table) (\d+)(; table|, [^)]+)?\)/);
  return (
    <>
      {parts.map((part, i) => {
        // Parts never reorder, so their position is a stable key.
        const key = `${i}:${part}`;
        const slot = i % 4;
        if (slot === 0) {
          // Code in backticks ("a `Mutex` lock") renders as <code>.
          const pieces = part.split("`");
          return (
            <Fragment key={key}>
              {pieces.length === 1
                ? keepTogether(part)
                : // Separate children, not a list, so the pieces need no keys.
                  createElement(Fragment, null, ...pieces.map((p, j) => (j % 2 ? createElement("code", null, p) : createElement(Fragment, null, keepTogether(p)))))}
            </Fragment>
          );
        }
        if (slot !== 1) {
          return null;
        }
        const n = Number(parts[i + 1]);
        const href = part === "Figure" ? `#${figureId(n)}` : tableHref?.(n);
        const table = parts[i + 2];
        return (
          <Fragment key={key}>
            (
            {href ? (
              <a href={href} className="link">
                {part} {n}
              </a>
            ) : (
              `${part} ${n}`
            )}
            {table === "; table" ? (
              <>
                ;{" "}
                {tableId ? (
                  <a href={`#${tableId}`} className="link">
                    table
                  </a>
                ) : (
                  "table"
                )}
              </>
            ) : table ? (
              keepTogether(table)
            ) : null}
            )
          </Fragment>
        );
      })}
    </>
  );
};
