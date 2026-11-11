import { clsx } from "clsx";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRightIcon } from "@/components/icons";
import { useHighlight } from "@/components/highlight";

export type Column<R> = {
  id: string;
  header: React.ReactNode;
  /** Cell content. `first` is true on the first row of a group. */
  render: (row: R, at: { first: boolean; last: boolean; index: number }) => React.ReactNode;
  /** Numbers align right. */
  align?: "left" | "right";
  /** A quiet secondary column (a range beside its median): smaller, tertiary ink. */
  quiet?: boolean;
  className?: string;
};

export type DataTableProps<R> = {
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  /** Key shared with charts in the same HighlightScope (default: rowKey). */
  linkKey?: (row: R) => string;
  /** Consecutive rows with the same group share a rule above the group. */
  group?: (row: R) => string;
  /**
   * With `group`: a full-width heading row above each group
   * (`<th scope="rowgroup">`), so a group's name never sits inside its
   * first row's cell.
   */
  groupHeading?: (row: R) => React.ReactNode;
  /** A row that failed its round trip or checksum: marked in danger. */
  failed?: (row: R) => boolean;
  /** What the table shows; also its accessible name. */
  caption: React.ReactNode;
  /** The visible caption, where it differs from the accessible one (null shows none); defaults to `caption`. */
  shownCaption?: React.ReactNode;
  /** Footnotes under the table (export links, symbols). */
  footnote?: React.ReactNode;
  /** Anchor id, for a chart's tableId. */
  id?: string;
  /** Pinned-row marker colour. */
  tone?: "accent" | "mine";
  className?: string;
};

/** Whether the scroller hides content on either side. */
function useOverflow() {
  const [state, setState] = useState({ left: false, right: false });
  const el = useRef<HTMLDivElement | null>(null);
  const update = useCallback(() => {
    const e = el.current;
    if (!e) {
      return;
    }
    const left = e.scrollLeft > 1;
    const right = e.scrollLeft + e.clientWidth < e.scrollWidth - 1;
    setState((s) => (s.left === left && s.right === right ? s : { left, right }));
  }, []);
  useEffect(() => {
    const e = el.current;
    if (!e) {
      return;
    }
    update();
    const ro = new ResizeObserver(update);
    ro.observe(e);
    if (e.firstElementChild) {
      ro.observe(e.firstElementChild);
    }
    return () => ro.disconnect();
  }, [update]);
  return [el, state, update] as const;
}

/**
 * The full table: hairline rules, numbers right-aligned in tabular
 * figures, the name column pinned while the rest scrolls sideways (with a
 * visible fade and a "scroll for more" cue when it overflows). Rows link
 * to charts by key: hover or focus marks the row's points, click or
 * Enter pins it. Arrow keys move between rows (one tab stop).
 */
export function DataTable<R>({ columns, rows, rowKey, linkKey, group, groupHeading, failed, caption, shownCaption = caption, footnote, id, tone = "accent", className }: DataTableProps<R>) {
  const hl = useHighlight();
  const tableId = useId();
  const by = `table:${tableId}`;
  const [scroller, ov, onScroll] = useOverflow();
  const body = useRef<HTMLTableSectionElement>(null);
  const [focusRow, setFocusRow] = useState(0);
  const keyOf = linkKey ?? rowKey;
  // The one Tab stop, kept on a row that exists when the rows shrink (another input, say).
  const tabRow = Math.min(focusRow, rows.length - 1);

  const focusAt = (i: number) => {
    const n = Math.max(0, Math.min(rows.length - 1, i));
    setFocusRow(n);
    body.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]")[n]?.focus();
  };

  return (
    <div className={clsx("mt-3.5", className)} id={id}>
      {/* The caption, outside the scroller so it wraps to the column; the table's own <caption> carries it for assistive tech. */}
      {shownCaption !== null || ov.right || ov.left ? (
        <p aria-hidden="true" className="max-w-[80ch] pb-2 text-cap text-ink-2">
          {shownCaption}
          {ov.right || ov.left ? (
            <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap text-ink-3", shownCaption !== null && "ml-2")}>
              Scroll for more columns <ArrowRightIcon className="size-3" />
            </span>
          ) : null}
        </p>
      ) : null}
      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
          tabIndex={ov.left || ov.right ? 0 : undefined}
          role={ov.left || ov.right ? "region" : undefined}
          aria-label={ov.left || ov.right ? "Table, scrolls sideways" : undefined}
          className="overflow-x-auto overscroll-x-contain"
        >
          <table className="w-full border-collapse text-sm leading-[1.35]">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th
                    key={c.id}
                    scope="col"
                    className={clsx(
                      "border-b border-ink-3 py-1.5 pr-2.5 align-bottom text-cap font-semibold whitespace-nowrap text-ink",
                      c.align === "right" ? "text-right" : "text-left",
                      c.quiet && "pl-0.5 font-normal text-ink-3",
                      i === 0 && "sticky left-0 z-[1] bg-bg",
                      i === 0 && ov.left && "shadow-[1px_0_0_var(--c-rule)]",
                      c.className,
                    )}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={body}>
              {rows.map((r, index) => {
                const g = group?.(r);
                const first = !group || index === 0 || group(rows[index - 1]) !== g;
                const last = !group || index === rows.length - 1 || group(rows[index + 1]) !== g;
                const key = keyOf(r);
                const on = hl.active === key;
                const pinned = hl.pinned === key;
                const bad = failed?.(r) ?? false;
                const heading =
                  group && groupHeading && first ? (
                    <tr key={`${rowKey(r)}:group`}>
                      <th
                        scope="rowgroup"
                        colSpan={columns.length}
                        className={clsx("pt-3 pb-1 text-left align-bottom font-normal", index > 0 && "border-t border-rule")}
                      >
                        <span className="sticky left-0">{groupHeading(r)}</span>
                      </th>
                    </tr>
                  ) : null;
                const row = (
                  <tr
                    key={rowKey(r)}
                    data-row
                    tabIndex={index === tabRow ? 0 : -1}
                    data-pinned={pinned || undefined}
                    onPointerEnter={(e) => e.pointerType === "mouse" && hl.hover(key)}
                    onPointerLeave={(e) => e.pointerType === "mouse" && hl.hover(null)}
                    onFocus={() => {
                      setFocusRow(index);
                      hl.hover(key);
                    }}
                    onBlur={() => hl.hover(null)}
                    onClick={() => hl.pin(pinned ? null : key, by)}
                    onKeyDown={(e) => {
                      const k: Record<string, () => void> = {
                        ArrowDown: () => focusAt(index + 1),
                        ArrowUp: () => focusAt(index - 1),
                        Home: () => focusAt(0),
                        End: () => focusAt(rows.length - 1),
                        Enter: () => hl.pin(pinned ? null : key, by),
                        " ": () => hl.pin(pinned ? null : key, by),
                        Escape: () => hl.pin(null),
                      };
                      if (k[e.key]) {
                        e.preventDefault();
                        k[e.key]();
                      }
                    }}
                    className="group/row cursor-default outline-none"
                  >
                    {columns.map((c, i) => (
                      <td
                        key={c.id}
                        className={clsx(
                          "py-[5px] pr-2.5 align-baseline whitespace-nowrap",
                          first && index > 0 && group && !groupHeading && "border-t border-rule pt-2",
                          last && group && "pb-2",
                          c.align === "right" && "text-right",
                          c.quiet && "pl-0.5 text-cap text-ink-3",
                          on ? "bg-hl" : i === 0 ? "bg-bg" : undefined,
                          i === 0 && "sticky left-0 z-[1]",
                          i === 0 && ov.left && "shadow-[1px_0_0_var(--c-rule)]",
                          i === 0 && pinned && (tone === "mine" ? "shadow-[inset_3px_0_0_var(--c-mine)]" : "shadow-[inset_3px_0_0_var(--c-accent)]"),
                          i === 0 && "group-focus-visible/row:outline-2 group-focus-visible/row:-outline-offset-2 group-focus-visible/row:outline-accent",
                          bad && "text-danger",
                          c.className,
                        )}
                      >
                        {c.render(r, { first, last, index })}
                      </td>
                    ))}
                  </tr>
                );
                return heading ? [heading, row] : row;
              })}
            </tbody>
          </table>
        </div>
        {/* Fade where columns are hidden: the visible scroll cue. */}
        <div
          aria-hidden="true"
          className={clsx(
            "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg to-transparent transition-opacity duration-200",
            ov.right ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
      {footnote ? <div className="prose-links mt-2.5 max-w-[80ch] text-cap text-ink-2">{footnote}</div> : null}
    </div>
  );
}
