import { clsx } from "clsx";
import { useState } from "react";

type NumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max"
> & {
  value: number;
  onValueChange: (value: number) => void;
  /** Used to size the field; validation lives with the caller. */
  min?: number;
  max?: number;
};

const grouped = new Intl.NumberFormat("en-US");

/**
 * Digits only, so "100,000", "100 000" and "100_000" all parse. Anything
 * else ("abc", "1e309", a number too long to represent) is NaN, never an
 * exception and never Infinity, so callers only ever validate NaN.
 */
const parseNumber = (raw: string) => {
  const cleaned = raw.replace(/[\s,_]/g, "");
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return NaN;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * A whole-number field sized to its content. It shows digit grouping until
 * the first keystroke (focus leaves the text alone, so select-all and
 * replace work), accepts grouped input, and reports NaN when malformed.
 */
export const NumberInput = ({
  value,
  onValueChange,
  className,
  max,
  min: _min,
  ...props
}: NumberInputProps) => {
  const [draft, setDraft] = useState<string | null>(null);
  // A value set from outside (a preset, a reset) replaces any kept draft;
  // the field's own edits always match their draft, NaN included.
  const [seen, setSeen] = useState(value);
  if (!Object.is(value, seen)) {
    setSeen(value);
    if (draft !== null && !Object.is(parseNumber(draft), value)) {
      setDraft(null);
    }
  }
  const shown =
    draft ?? (Number.isFinite(value) ? grouped.format(value) : "");
  // Grouped digits of the largest allowed value, plus room to type.
  const width = (Number.isFinite(max) ? grouped.format(max!) : "9,999").length + 3;
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      {...props}
      className={clsx("field-input field-sizing-content min-w-[9ch]", className)}
      style={{ maxWidth: `${width + 2}ch` }}
      value={shown}
      onChange={(e) => {
        setDraft(e.target.value);
        onValueChange(parseNumber(e.target.value));
      }}
      onBlur={(e) => {
        // Valid text reformats with grouping; malformed text stays, so the
        // field still shows what its error message is about.
        if (!Number.isNaN(parseNumber(e.target.value))) {
          setDraft(null);
        }
        props.onBlur?.(e);
      }}
    />
  );
};

export const integerError = (
  value: number,
  min: number,
  max: number,
  noun = "a whole number",
) => {
  if (Number.isNaN(value)) {
    return `Enter ${noun}.`;
  }
  if (!Number.isInteger(value)) {
    return "Use a whole number.";
  }
  if (value < min || value > max) {
    return `Use a number from ${grouped.format(min)} to ${grouped.format(max)}.`;
  }
  return undefined;
};

/** One width for every numeric setup field, so rows line up. */
export const numberFieldClass = "h-10 !w-32 !max-w-none text-center";
