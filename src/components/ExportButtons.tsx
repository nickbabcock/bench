import { useEffect, useState } from "react";
import { Button } from "./Button";
import { CheckIcon, CopyIcon, DownloadIcon } from "./icons";
import { download } from "@/lib/export";

type ExportButtonsProps = {
  /** File name without extension. */
  baseName: string;
  csv: () => string;
  json: () => string;
  markdown: () => string;
};

/** CSV and JSON downloads plus a Markdown table copied to the clipboard. */
export const ExportButtons = ({ baseName, csv, json, markdown }: ExportButtonsProps) => {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const t = setTimeout(() => setCopied(null), copied === "failed" ? 12000 : 2400);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => download(`${baseName}.csv`, csv(), "text/csv")}
      >
        <DownloadIcon />
        <span className="sr-only">Export </span>CSV
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => download(`${baseName}.json`, json(), "application/json")}
      >
        <DownloadIcon />
        <span className="sr-only">Export </span>JSON
      </Button>
      <Button variant="secondary" size="sm" onClick={copy}>
        {copied === "ok" ? <CheckIcon /> : <CopyIcon />}
        {copied === "ok" ? "Copied" : "Copy Markdown"}
      </Button>
      <output className={copied === "failed" ? "text-sm text-danger" : "sr-only"}>
        {copied === "ok" ? (
          "Markdown table copied."
        ) : copied === "failed" ? (
          <>
            The browser blocked the clipboard.{" "}
            <button
              type="button"
              className="link text-danger"
              onClick={() => download(`${baseName}.md`, markdown(), "text/markdown")}
            >
              Download the .md file instead.
            </button>
          </>
        ) : (
          ""
        )}
      </output>
    </div>
  );
};
