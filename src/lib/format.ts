const sigFormatters = new Map<number, Intl.NumberFormat>();

/** Format `x` to `digits` significant figures, keeping trailing zeros. */
export function formatSig(x: number, digits = 3) {
  if (!Number.isFinite(x)) {
    return "—";
  }
  let formatter = sigFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumSignificantDigits: digits,
      maximumSignificantDigits: digits,
    });
    sigFormatters.set(digits, formatter);
  }
  return formatter.format(x);
}

export type Quantity = { value: string; unit: string };

export const quantity = (q: Quantity) => `${q.value} ${q.unit}`;

/** A duration in milliseconds, three significant figures, in µs, ms or s. */
export function formatDuration(ms: number): Quantity {
  if (ms < 0.0009995) {
    return { value: formatSig(ms * 1e6), unit: "ns" };
  }
  if (ms < 0.9995) {
    return { value: formatSig(ms * 1000), unit: "µs" };
  }
  if (ms < 999.5) {
    return { value: formatSig(ms), unit: "ms" };
  }
  return { value: formatSig(ms / 1000), unit: "s" };
}

/** Decimal file size (1 MB = 10^6 bytes), as file managers report it. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return "—";
  }
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 999.5 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return unit === 0 ? `${bytes} B` : `${formatSig(value)} ${units[unit]}`;
}

/** Binary size for wasm linear memory, which grows in 64 KiB pages. */
export function formatMiB(bytes: number): string {
  return `${formatSig(bytes / 1024 / 1024)} MiB`;
}

export function formatRatio(x: number): string {
  return `${formatSig(x)}×`;
}

const integerFormatter = new Intl.NumberFormat("en-US");

export function formatInteger(x: number): string {
  return Number.isFinite(x) ? integerFormatter.format(x) : "—";
}

/** Unsigned percentage with sensible precision: 0.4%, 7.2%, 48%. */
export function formatPercent(fraction: number): string {
  const pct = Math.abs(fraction * 100);
  if (pct < 0.05) {
    return "0%";
  }
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct).toString()}%`;
}

/** "1 sample", "5 samples"; the count with its noun, pluralised. */
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${Number.isFinite(n) ? formatInteger(n) : "—"}\u00a0${n === 1 ? one : many}`;

const mbFormatter = new Intl.NumberFormat("en-US", { minimumSignificantDigits: 3, maximumSignificantDigits: 3 });

/** Throughput always in MB/s (1 MB = 10^6 bytes), so a column reads in one unit. */
export const formatMBps = (bytesPerSecond: number) =>
  Number.isFinite(bytesPerSecond) ? mbFormatter.format(bytesPerSecond / 1e6) : "—";
