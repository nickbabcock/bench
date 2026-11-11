/**
 * The reference data for this page (src/data/editions/reference.ts):
 * every capture of the latest edition, one setting per engine and
 * machine. Captures come from scripts/capture.mjs --bench allocation.
 */
import type { AllocationEdition } from "@/data/editions";
import { allocationCaptures } from "@/data/editions/allocation";
import { rawUrlIn, referenceOf, type ReferenceOf, runSetting, type RunSetting } from "@/data/editions/reference";

/** Same-origin URLs of every capture's raw JSON, emitted as static assets. */
const rawUrl = rawUrlIn(import.meta.glob<string>("../../data/editions/allocation/*/*/*.json", { query: "?url&no-inline", import: "default", eager: true }));

export type Setting = RunSetting<AllocationEdition>;

export type Reference = ReferenceOf<Setting>;

const missing = (): never => {
  throw new Error("No allocation reference capture under src/data/editions/allocation/");
};

let cached: Reference | undefined;
export const reference = (): Reference =>
  (cached ??=
    referenceOf(allocationCaptures(), (e, replicates): Setting => runSetting(e, replicates, rawUrl)) ?? missing());
