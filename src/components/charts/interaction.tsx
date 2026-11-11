import { clsx } from "clsx";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useHighlight } from "@/components/highlight";

/**
 * Something in a chart a reader can inspect: a point, or one row in one
 * facet. `key` links it to every other view of the same configuration
 * (see HighlightScope); `id` is unique within the chart.
 */
export type Target = {
  id: string;
  key: string;
  /** Anchor for the tooltip, px from the chart container's top-left. */
  x: number;
  y: number;
  /** Keyboard order: Up/Down move between rows, Left/Right between columns. */
  row: number;
  col: number;
  /** Read aloud when the target gets keyboard focus. */
  describe: string;
  tip: React.ReactNode;
};

/**
 * Pointer, touch and keyboard inspection shared by every chart.
 *
 * - Pointer hover marks a target (and its linked table row).
 * - Click or tap pins it; the tooltip stays until unpinned, Escape, or
 *   another pin.
 * - Escape clears the tooltip, whether hovered, focused or pinned, until
 *   the next arrow key, hover or pin.
 * - The chart is one tab stop; arrow keys move between targets, Home and
 *   End jump to the ends, Enter or Space pins, Escape unpins.
 */
export function useChartNav(targets: Target[]) {
  const chartId = useId();
  const hl = useHighlight();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [pinId, setPinId] = useState<string | null>(null);
  // Escape hides every tooltip (hover, focus and pin) until the next move, hover or pin.
  const [dismissed, setDismissed] = useState(false);
  const byId = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);

  const pinnedHere = hl.pinnedBy === chartId && hl.pinned !== null;
  const pinTarget = pinnedHere ? (byId.get(pinId ?? "") ?? targets.find((t) => t.key === hl.pinned)) : undefined;
  const tipTarget = dismissed ? undefined : (byId.get(hoverId ?? "") ?? (focused ? byId.get(focusId ?? "") : undefined) ?? pinTarget);

  // A hover tooltip must be dismissable without moving the pointer (WCAG 1.4.13), and the chart may not have focus.
  const showing = tipTarget !== undefined;
  useEffect(() => {
    if (!showing) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDismissed(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showing]);

  const hover = useCallback(
    (id: string | null) => {
      setHoverId(id);
      if (id !== null) {
        setDismissed(false);
      }
      hl.hover(id === null ? null : (byId.get(id)?.key ?? null));
    },
    [byId, hl],
  );

  const pin = useCallback(
    (id: string | null) => {
      const t = id === null ? undefined : byId.get(id);
      setDismissed(false);
      if (!t) {
        hl.pin(null);
        setPinId(null);
        return;
      }
      const unpinning = hl.pinned === t.key && hl.pinnedBy === chartId && pinId === t.id;
      hl.pin(unpinning ? null : t.key, chartId);
      setPinId(unpinning ? null : t.id);
    },
    [byId, chartId, hl, pinId],
  );

  const move = (dRow: number, dCol: number, to?: "first" | "last") => {
    if (targets.length === 0) {
      return;
    }
    const cur = byId.get(focusId ?? "");
    let next: Target | undefined;
    if (to === "first") {
      next = targets[0];
    } else if (to === "last") {
      next = targets[targets.length - 1];
    } else if (!cur) {
      next = targets[0];
    } else if (dCol !== 0) {
      const cols = targets.filter((t) => t.row === cur.row).sort((a, b) => a.col - b.col);
      const i = cols.indexOf(cur);
      next = cols[i + dCol];
      // One column (a scatter): Left/Right walk the order like Up/Down.
      if (!next && cols.length === 1) {
        next = targets[targets.indexOf(cur) + dCol];
      }
    } else {
      const rows = [...new Set(targets.map((t) => t.row))].sort((a, b) => a - b);
      const r = rows[rows.indexOf(cur.row) + dRow];
      const inRow = targets.filter((t) => t.row === r);
      next = inRow.find((t) => t.col === cur.col) ?? inRow[0];
    }
    if (next) {
      setDismissed(false);
      setFocusId(next.id);
      hl.hover(next.key);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1, 0),
      ArrowUp: () => move(-1, 0),
      ArrowRight: () => move(0, 1),
      ArrowLeft: () => move(0, -1),
      Home: () => move(0, 0, "first"),
      End: () => move(0, 0, "last"),
      Enter: () => focusId && pin(focusId),
      " ": () => focusId && pin(focusId),
      Escape: () => {
        pin(null);
        setHoverId(null);
        hl.hover(null);
        setDismissed(true);
      },
    };
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  };

  const containerProps = {
    tabIndex: 0,
    onKeyDown,
    onFocus: (e: React.FocusEvent) => {
      if (e.target === e.currentTarget) {
        setFocused(true);
        const first = byId.get(focusId ?? "") ?? targets[0];
        if (first) {
          setFocusId(first.id);
          hl.hover(first.key);
        }
      }
    },
    onBlur: () => {
      setFocused(false);
      hl.hover(null);
    },
  };

  const live = focused ? (byId.get(focusId ?? "")?.describe ?? "") : "";

  return {
    /** Mark this key: hovered or pinned anywhere in the scope. */
    active: hl.active,
    hoverId,
    focusId: focused ? focusId : null,
    pinId: pinnedHere ? (pinTarget?.id ?? null) : null,
    tipTarget,
    hover,
    pin,
    containerProps,
    live,
  };
}

/**
 * The tooltip: values first and strong, the name after. Placed beside its
 * anchor, flipped and clamped to stay inside the chart.
 */
export const Tooltip = ({ target, width }: { target: Target | undefined; width: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !target) {
      setPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = target.x + 14;
    if (left + w > width) {
      left = target.x - 14 - w;
    }
    left = Math.max(0, Math.min(left, width - w));
    setPos({ left, top: Math.max(0, target.y - h / 2) });
  }, [target, width]);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={clsx(
        "pointer-events-none absolute z-10 max-w-[18rem] border border-rule bg-bg px-2.5 py-1.5 text-cap shadow-[0_2px_8px_rgb(0_0_0/0.12)] transition-[opacity,translate] duration-150 ease-out",
        target && pos ? "translate-y-0 opacity-100" : "translate-y-0.5 opacity-0",
      )}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0 }}
    >
      {target?.tip}
    </div>
  );
};

/** A tooltip body: one strong value line, then quieter lines. */
export const Tip = ({ value, lines }: { value: React.ReactNode; lines?: React.ReactNode[] }) => (
  <>
    <span className="block text-sm font-bold text-ink">{value}</span>
    {lines?.map((l, i) => (
      <span key={i} className="block text-ink-2">
        {l}
      </span>
    ))}
  </>
);

/** Keyboard help for a chart, referenced by aria-describedby. */
export const KEY_HINT =
  "Arrow keys move between points; Enter pins one so its values stay shown; Escape clears.";
