import type { ConfigSpec } from "./codecs";
import type { CodeSize } from "./worker/module";
import type { RunContext } from "@/lib/context";

export type ConfigResult = {
  spec: ConfigSpec;
  /** Compressed size in bytes, once prepared. */
  size?: number;
  /** Gzipped code shipped to decode / encode. */
  code?: CodeSize;
  /** Decoding reproduced the input byte for byte. */
  roundTrip?: boolean;
  /** zstd only: window log, chain log, hash log, search log, min match, target length, strategy. */
  zstdParams?: number[];
  /** Operations per timed encode sample; null for decode-only codecs. */
  encodeReps?: number | null;
  decodeReps?: number;
  /** Milliseconds per operation, one entry per sample. */
  encodeMs: number[];
  decodeMs: number[];
};

export type RunStatus = "running" | "done" | "cancelled" | "error";

export type CompressionRun = {
  id: number;
  filename: string;
  /**
   * A built-in input (a Silesia corpus file) rather than the visitor's own
   * file. Named for the generated inputs it once meant; kept so exports and
   * the captured example stay readable.
   */
  synthetic: boolean;
  bytes: number;
  samples: number;
  startedAt: number;
  /** When it finished, was cancelled or failed. */
  endedAt?: number;
  status: RunStatus;
  error?: string;
  context?: RunContext;
  configs: ConfigResult[];
};

export type Progress = {
  /** Configuration being measured right now. */
  activeId?: string;
  phase: string;
  detail: string;
  done: number;
  total: number;
};
