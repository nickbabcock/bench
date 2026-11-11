import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Linking between figures and tables. Every chart point and table row
 * that shows the same configuration carries the same key; hovering or
 * focusing one marks all of them, and a click or tap pins one so it stays
 * marked (and its tooltip stays open) until it is unpinned or another is
 * pinned.
 *
 * Wrap a page (or one dataset's figures and table) in <HighlightScope>.
 * Charts and DataTable call useHighlight(); without a scope each falls
 * back to its own private state, so nothing breaks, it just doesn't link.
 */
export type Highlight = {
  /** Under the pointer or keyboard focus, anywhere in the scope. */
  hovered: string | null;
  /** Pinned by a click, tap, Enter or Space. */
  pinned: string | null;
  /** Which component pinned it (a chart's id), so only it shows a tooltip. */
  pinnedBy: string | null;
  /** The key to mark: the hovered one, else the pinned one. */
  active: string | null;
  hover: (key: string | null) => void;
  /** Pin `key` on behalf of `by` (a chart's or table's id); `null` unpins. */
  pin: (key: string | null, by?: string) => void;
};

const Ctx = createContext<Highlight | null>(null);

function useHighlightState(): Highlight {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinState, setPin] = useState<{ key: string | null; by: string | null }>({ key: null, by: null });
  const hover = useCallback((key: string | null) => setHovered(key), []);
  const pin = useCallback(
    (key: string | null, by?: string) => setPin(key === null ? { key: null, by: null } : { key, by: by ?? null }),
    [],
  );
  return useMemo(
    () => ({ hovered, pinned: pinState.key, pinnedBy: pinState.by, active: hovered ?? pinState.key, hover, pin }),
    [hovered, pinState, hover, pin],
  );
}

/** Links every chart and table inside it by key. */
export const HighlightScope = ({ children }: { children: React.ReactNode }) => {
  const value = useHighlightState();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

/** The enclosing scope's highlight, or a private one when there is none. */
export function useHighlight(): Highlight {
  const own = useHighlightState();
  return useContext(Ctx) ?? own;
}
