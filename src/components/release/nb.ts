import { Children, cloneElement, createElement, Fragment, isValidElement } from "react";
import { nb } from "@/lib/findings";

/**
 * `nb` (non-breaking hyphens in names) applied to a title: strings and
 * the string children of plain elements and fragments. Components that
 * build their own text are left alone.
 */
export function nbNode(node: React.ReactNode): React.ReactNode {
  if (typeof node === "string") {
    return nb(node);
  }
  if (Array.isArray(node)) {
    return Children.map(node, nbNode);
  }
  if (isValidElement<{ children?: React.ReactNode }>(node) && (typeof node.type === "string" || node.type === Fragment) && node.props.children !== undefined) {
    return cloneElement(node, undefined, nbNode(node.props.children));
  }
  return node;
}

/**
 * For main points and body text, where `nb` must not be used (a copied
 * "-O3" or "wasm-opt" must paste as typed): each hyphenated token
 * ("wasm-opt", "-O3", "bump-scope") is wrapped in a `white-space: nowrap`
 * span, so it never breaks but keeps its ASCII hyphen. Quantities hold
 * together the same way: a range with its unit ("≈100–300 Mbps",
 * "1.6–2.2×") and a number with its unit ("256 KiB", "1.83 kB").
 */
export function keepTogether(text: string): React.ReactNode {
  const pieces = text.split(QUANTITY);
  if (pieces.length === 1) {
    return hyphenated(text, "");
  }
  // split() with one capture group alternates text and quantities.
  return pieces.map((t, i) => (i % 2 === 1 ? createElement("span", { key: `q${i}`, className: "whitespace-nowrap" }, t) : hyphenated(t, `t${i}`)));
}

function hyphenated(text: string, prefix: string): React.ReactNode {
  const parts = text.split(/(\s+)/);
  if (!parts.some((t) => HYPHENATED.test(t))) {
    return text;
  }
  return parts.map((t, i) => (HYPHENATED.test(t) ? createElement("span", { key: `${prefix}${i}`, className: "whitespace-nowrap" }, t) : t));
}

/** A token with a hyphen between word characters, or a leading flag hyphen. */
const HYPHENATED = /\w-\w|^\(?-\w/;

const UNITS = "Mbps|Gbps|MB/s|kB|KiB|MiB|GiB|MB|ms|s|%|×";
/**
 * A quantity that could break across lines: a number range ("≈10–100",
 * "≈100–300 Mbps", "1.6–2.2×", "≈100 to 300 Mbps") or a number and its
 * unit after a space ("256 KiB", "300 Mbps"). Numbers alone, or glued to their unit ("3.8%"),
 * never break, so they don't match.
 */
const QUANTITY = new RegExp(`((?<![\\w.])[≈−+]?\\d[\\d,.]*(?:–≈?\\d[\\d,.]*(?: ?(?:${UNITS})(?![\\w/]))?| to ≈?\\d[\\d,.]* (?:${UNITS})(?![\\w/])| (?:${UNITS})(?![\\w/])))`, "g");
