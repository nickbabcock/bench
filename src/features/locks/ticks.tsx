import { createElement, Fragment } from "react";

/**
 * Text with code in backticks ("`Arc<Mutex>` is …") as React nodes, the code
 * in `<code>` elements. The parts go in as separate children, so they need
 * no keys.
 */
export const ticks = (text: string): React.ReactNode =>
  createElement(Fragment, null, ...text.split("`").map((part, i) => (i % 2 ? createElement("code", null, part) : part)));
