/**
 * The reference data for this page (src/data/editions/reference.ts):
 * every capture of the latest edition, one setting per engine and
 * machine. Captures come from scripts/capture.mjs --bench memory64.
 */
import type { Memory64Edition } from "@/data/editions";
import { memory64Captures } from "@/data/editions/memory64";
import { rawUrlIn, referenceOf, type ReferenceOf, runSetting, type RunSetting } from "@/data/editions/reference";

/** Same-origin URLs of every capture's raw JSON, emitted as static assets. */
const rawUrl = rawUrlIn(import.meta.glob<string>("../../data/editions/memory64/*/*/*.json", { query: "?url&no-inline", import: "default", eager: true }));

export type Setting = RunSetting<Memory64Edition>;
export type Reference = ReferenceOf<Setting>;

const missing = (): never => {
  throw new Error("No memory64 reference capture under src/data/editions/memory64/");
};

let cached: Reference | undefined;
export const reference = (): Reference => (cached ??= referenceOf(memory64Captures(), (e, replicates) => runSetting(e, replicates, rawUrl)) ?? missing());
