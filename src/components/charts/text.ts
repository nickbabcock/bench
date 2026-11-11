import { useEffect, useState } from "react";

const FAMILY = '"Source Sans 3 Variable", "Source Sans 3", ui-sans-serif, system-ui, sans-serif';

let ctx: CanvasRenderingContext2D | null | undefined;

/**
 * Rendered width of `text` in the page's face, px. Falls back to an
 * average glyph width on the server and before a canvas exists.
 */
export function textWidth(text: string, size = 12, weight = 400): number {
  if (typeof document === "undefined") {
    return text.length * size * 0.52;
  }
  if (ctx === undefined) {
    ctx = document.createElement("canvas").getContext("2d");
  }
  if (!ctx) {
    return text.length * size * 0.52;
  }
  ctx.font = `${weight} ${size}px ${FAMILY}`;
  // Tabular figures are a touch wider than the canvas's default digits.
  return ctx.measureText(text).width * 1.02;
}

let ready = typeof document === "undefined" || document.fonts?.status === "loaded";

/**
 * True once web fonts have loaded, so a chart that measured its labels
 * with a fallback face lays them out again with the real one.
 */
export function useFontsReady() {
  const [ok, setOk] = useState(ready);
  useEffect(() => {
    if (ok || !document.fonts) {
      return;
    }
    let live = true;
    void document.fonts.ready.then(() => {
      ready = true;
      if (live) {
        setOk(true);
      }
    });
    return () => {
      live = false;
    };
  }, [ok]);
  return ok;
}
