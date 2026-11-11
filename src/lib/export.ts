export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

type Cell = string | number | boolean | null | undefined;

const csvCell = (v: Cell) => {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) {
    return "";
  }
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCSV = (header: string[], rows: Cell[][]) =>
  [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");

/** A GitHub-flavoured Markdown table, right-aligning numeric columns. */
export function toMarkdown(header: string[], rows: string[][], numeric: boolean[]) {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const line = (cells: string[]) => `| ${cells.map(esc).join(" | ")} |`;
  return [
    line(header),
    `| ${numeric.map((n) => (n ? "---:" : ":---")).join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

/** A run's local calendar date for a file name, "2026-11-08": the visitor's day, not UTC's. */
export const fileDate = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
