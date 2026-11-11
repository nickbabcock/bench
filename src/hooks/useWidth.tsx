import { useCallback, useRef, useState } from "react";

/**
 * An element's content width, kept current with a ResizeObserver. Returns
 * a callback ref, so the observer follows the element even when it mounts
 * after the component (a placeholder that later becomes a chart).
 */
export function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) {
      return;
    }
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [ref, width] as const;
}
