/**
 * The reference data for this page (src/data/editions/reference.ts):
 * every capture of the latest edition, one setting per engine and
 * machine. Captures come from scripts/capture.mjs --bench locks. Unlike
 * the other pages, this one can have no capture yet: then it offers only
 * the measurement on this machine.
 */
import type { LocksEdition } from "@/data/editions";
import { locksCaptures } from "@/data/editions/locks";
import { rawUrlIn, referenceOf, type ReferenceOf, runSetting, type RunSetting } from "@/data/editions/reference";

/** Same-origin URLs of every capture's raw JSON, emitted as static assets. */
const rawUrl = rawUrlIn(import.meta.glob<string>("../../data/editions/locks/*/*/*.json", { query: "?url&no-inline", import: "default", eager: true }));

export type Setting = RunSetting<LocksEdition>;
export type Reference = ReferenceOf<Setting>;

let cached: { ref: Reference | undefined } | undefined;
export const reference = (): Reference | undefined => (cached ??= { ref: referenceOf(locksCaptures(), (e, replicates) => runSetting(e, replicates, rawUrl)) }).ref;
