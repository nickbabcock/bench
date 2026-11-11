import { capturePath, type Edition } from "@/lib/edition";

/**
 * Every compression capture's JSON, emitted by the build as a hashed
 * static asset, so the raw per-round data downloads from the same origin
 * on any static host (Cloudflare Pages included).
 */
const urls = import.meta.glob<string>("/src/data/editions/compression/*/*/*.json", { query: "?url", import: "default", eager: true });

/** Same-origin URL of a capture's raw JSON. */
export const rawHref = (e: Edition) => urls[`/src/data/editions/${capturePath(e)}`];
