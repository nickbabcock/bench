/** Measurement order (the harness loads and rotates in this order); keep it. Display order is by class. */
export const allocators = ["dlmalloc", "bumpalo", "bump-scope", "talc"] as const;
export type Allocator = (typeof allocators)[number];

/** Rust's default on wasm32, and the general-purpose class's baseline. */
export const BASELINE: Allocator = "dlmalloc";

/**
 * Two kinds of allocator that do different jobs, so they are compared
 * within a class; what an arena buys over the default is reported apart,
 * as a trade-off.
 */
export type AllocatorClass = "general" | "arena";

export const classInfo: Record<AllocatorClass, { name: string; baseline: Allocator }> = {
  general: { name: "General-purpose", baseline: "dlmalloc" },
  arena: { name: "Arena", baseline: "bumpalo" },
};

type AllocatorInfo = {
  name: string;
  class: AllocatorClass;
  /** A few words, for a figure label's second line. */
  short: string;
};

export const allocatorInfo: Record<Allocator, AllocatorInfo> = {
  dlmalloc: { name: "dlmalloc", class: "general", short: "Rust's default" },
  talc: { name: "talc", class: "general", short: "global allocator" },
  bumpalo: { name: "bumpalo", class: "arena", short: "bump arena" },
  "bump-scope": { name: "bump-scope", class: "arena", short: "scoped bump arena" },
};

export const classOf = (a: Allocator) => allocatorInfo[a].class;
/** The allocator each one is compared against: its class's baseline (itself for a baseline). */
export const baselineOf = (a: Allocator) => classInfo[classOf(a)].baseline;
/** Figures and the table: by class, each class's baseline first. */
export const displayOrder: readonly Allocator[] = ["dlmalloc", "talc", "bumpalo", "bump-scope"];
export const membersOf = (c: AllocatorClass) => displayOrder.filter((a) => classOf(a) === c);
