import { ExportButtons } from "@/components/ExportButtons";
import { MIN_SAMPLE_MS } from "@/lib/bench";
import { fileDate, toCSV, toMarkdown } from "@/lib/export";
import { formatBytes, formatMBps, formatRatio } from "@/lib/format";
import { type Family, familyInfo, formatInfo, libraryKey } from "./codecs";
import { build, buildSummary, hardware } from "@/lib/build";
import { inputName } from "./corpora";
import { rankRows, type Ranked, type Row, samplesCollected } from "./results";
import type { CompressionRun } from "./types";

const mb = (x?: number) => (x === undefined ? undefined : x / 1e6);

export const ResultsExport = ({
  run,
  rows,
  exploratory = false,
}: {
  run: CompressionRun;
  rows: Row[];
  /** One sample per configuration: exports carry no positions or ranges. */
  exploratory?: boolean;
}) => {
  const collected = samplesCollected(rows);
  const version = (family: Family) => {
    const key = libraryKey[family];
    return key ? build.libraries[key] : "browser built-in";
  };
  // Positions as the table shows them; none for one sample.
  const ranks = (m: "decode" | "encode") =>
    new Map<string, Ranked>(exploratory ? [] : rankRows(rows, m).map((r) => [r.row.id, r]));
  const dec = ranks("decode");
  const enc = ranks("encode");
  const rankCells = (r: Ranked | undefined) => [r?.placing.pos, r ? r.placing.tied : undefined];
  const baseName = `compression-${run.filename.replace(/\.[^/.]+$/, "")}-${fileDate(run.startedAt)}`;

  const json = () =>
    JSON.stringify(
      {
        benchmark: "compression",
        filename: run.filename,
        synthetic: run.synthetic,
        fileSizeBytes: run.bytes,
        startedAt: new Date(run.startedAt).toISOString(),
        status: run.status,
        userAgent: navigator.userAgent,
        ...hardware(),
        context: run.context ?? null,
        build,
        scope: "this run",
        exploratory,
        method: {
          samplesPerConfiguration: run.samples,
          minSampleMs: MIN_SAMPLE_MS,
          throughput: "uncompressed bytes per second, both directions",
          statistic: "median of samples; each sample is a calibrated batch",
        },
        results: run.configs.map((c) => ({
          id: c.spec.id,
          library: familyInfo[c.spec.family].name,
          libraryVersion: version(c.spec.family),
          format: formatInfo[familyInfo[c.spec.family].format].name,
          container: familyInfo[c.spec.family].container,
          level: c.spec.level,
          compressedBytes: c.size ?? null,
          ratio: c.size ? run.bytes / c.size : null,
          roundTrip: c.roundTrip ?? null,
          compress:
            c.encodeReps === null
              ? null
              : { callsPerSample: c.encodeReps ?? null, msPerCall: c.encodeMs },
          decompress: { callsPerSample: c.decodeReps ?? null, msPerCall: c.decodeMs },
        })),
      },
      null,
      2,
    );

  const csv = () =>
    toCSV(
      [
        "id",
        "library",
        "library_version",
        "level",
        "format",
        "container",
        "compressed_bytes",
        "ratio",
        "round_trip",
        "compress_median_MBps",
        "compress_min_MBps",
        "compress_max_MBps",
        "decompress_median_MBps",
        "decompress_min_MBps",
        "decompress_max_MBps",
        "samples",
        "exploratory_one_sample",
        "decompress_position",
        "decompress_tied",
        "compress_position",
        "compress_tied",
      ],
      rows.map((r) => [
        r.id,
        r.name,
        version(r.family),
        r.level,
        formatInfo[familyInfo[r.family].format].name,
        familyInfo[r.family].container,
        r.size,
        r.ratio,
        r.roundTrip,
        mb(r.encode?.median),
        mb(r.encode?.min),
        mb(r.encode?.max),
        mb(r.decode?.median),
        mb(r.decode?.min),
        mb(r.decode?.max),
        r.decode?.n,
        exploratory,
        ...rankCells(dec.get(r.id)),
        ...rankCells(enc.get(r.id)),
      ]),
    );

  const markdown = () => {
    const thr = (s?: Row["encode"]) =>
      s ? `${formatMBps(s.median)} MB/s${exploratory ? "" : ` (${formatMBps(s.min)}–${formatMBps(s.max)})`}` : "n/a";
    const table = toMarkdown(
      [...(exploratory ? [] : ["# (decompress)"]), "Configuration", "Version", "Ratio", "Output", "Compress", "Decompress"],
      rows.map((r) => [
        ...(exploratory ? [] : [String(dec.get(r.id)?.placing.pos ?? "")]),
        r.label,
        version(r.family),
        r.ratio === undefined ? "" : `${formatRatio(r.ratio)}${r.decodeOnly ? "†" : ""}`,
        r.size === undefined ? "" : formatBytes(r.size),
        r.decodeOnly ? "n/a" : thr(r.encode),
        thr(r.decode),
      ]),
      [...(exploratory ? [] : [true]), false, false, true, true, true, true],
    );
    const hw = hardware();
    return `**${inputName(run)}**, ${formatBytes(run.bytes)}. ${exploratory ? "One sample per configuration." : `Median (min–max) of ${collected} samples${collected < run.samples ? ` (of ${run.samples} planned)` : ""}.`}\n\n${navigator.userAgent}; ${hw.hardwareConcurrency ?? "?"} logical cores; ${hw.platform ?? "unknown platform"}.\nBuild: ${buildSummary()}.\n\n${table}\n${rows.some((r) => r.decodeOnly) ? "\n† zune-inflate only decodes; its ratio is that of the miniz_oxide level 6 stream it's timed on.\n" : ""}`;
  };

  return <ExportButtons baseName={baseName} csv={csv} json={json} markdown={markdown} />;
};
