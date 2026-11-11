import { DownloadIcon } from "@/components/icons";
import { formatBytes } from "@/lib/format";

export type RawDataLinkProps = {
  /** Same-origin URL of the edition's raw per-round JSON. */
  href: string;
  /** Default "Raw per-round data (JSON)". */
  label?: React.ReactNode;
  /** File size, shown after the label. */
  bytes?: number;
};

/** A link to an edition's raw per-round data, for checking every number on the page. */
export const RawDataLink = ({ href, label = "Raw per-round data (JSON)", bytes }: RawDataLinkProps) => (
  <a href={href} className="group inline-flex items-baseline gap-1.5 text-accent">
    <DownloadIcon className="relative top-[2px] size-3.5 shrink-0" />
    <span className="underline decoration-1 underline-offset-[3px] group-hover:decoration-2">{label}</span>
    {bytes !== undefined ? <span className="text-ink-3">{formatBytes(bytes)}</span> : null}
  </a>
);
