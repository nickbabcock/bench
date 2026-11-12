import { useState } from "react";
import { ChoiceChips, Figure, Prose } from "@/components/release";
import { summarize } from "@/lib/stats";
import { ns, samplesOf } from "./claims";
import type { ResultRow } from "./harness";
import { type Variant, variantInfo, variants, type WorkloadId, workloadById } from "./workloads";

/** Kernel name (`k_mutex_lock`) to its WebAssembly text, per build. */
type Listings = { printer: string; builds: Record<Variant, Record<string, string>> };

/**
 * Written at build time by packages/lockbench/listings.mjs (`mise run
 * build:locks`) from the modules that the page runs. A glob, so a checkout
 * that has not built the modules yet still compiles; the section then is
 * not shown.
 */
const files = import.meta.glob<Listings>("/src/wasm/locks-listings.json", { eager: true, import: "default" });
export const listings: Listings | undefined = Object.values(files)[0];

type Side = { kernel: string; name: string; workload: WorkloadId };
type Pair = { id: string; label: string; refcell: Side; lock: Side };

/** Each RefCell operation next to the lock operation that the page compares with it. */
const pairs: Pair[] = [
  {
    id: "write",
    label: "borrow_mut · Mutex::lock",
    refcell: { kernel: "k_refcell_write", name: "RefCell::borrow_mut", workload: "op/refcell_write" },
    lock: { kernel: "k_mutex_lock", name: "Mutex::lock", workload: "op/mutex" },
  },
  {
    id: "try",
    label: "try_borrow_mut · Mutex::try_lock",
    refcell: { kernel: "k_refcell_try_write", name: "RefCell::try_borrow_mut", workload: "op/refcell_try_write" },
    lock: { kernel: "k_mutex_trylock", name: "Mutex::try_lock", workload: "op/mutex_try" },
  },
  {
    id: "rwlock-write",
    label: "borrow_mut · RwLock::write",
    refcell: { kernel: "k_refcell_write", name: "RefCell::borrow_mut", workload: "op/refcell_write" },
    lock: { kernel: "k_rwlock_write", name: "RwLock::write", workload: "op/rwlock_write" },
  },
  {
    id: "read",
    label: "borrow · RwLock::read",
    refcell: { kernel: "k_refcell_read", name: "RefCell::borrow", workload: "op/refcell_read" },
    lock: { kernel: "k_rwlock_read", name: "RwLock::read", workload: "op/rwlock_read" },
  },
];

/** Instructions in a listing: every line but the header, the locals, `end` and the closing parenthesis. */
export const instructionCount = (text: string) =>
  text
    .split("\n")
    .slice(1)
    .filter((l) => !/^\s*(end\b|\)|\(local\b|$)/.test(l)).length;

/** One kernel: its name, the Rust it runs, its size, its measured time and its text. */
const Panel = ({ side, text, time }: { side: Side; text: string | undefined; time: string }) => (
  <div className="min-w-0">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-rule pb-1">
      <h4 className="text-[0.9375rem] font-semibold text-ink">{side.name}</h4>
      <span className="text-sm text-ink-2 tabular-nums">
        {text ? `${instructionCount(text)} instructions` : "not in this build"} · {time}
      </span>
    </div>
    <p className="mt-1 text-sm text-ink-2">
      <code>{workloadById[side.workload].code}</code>
    </p>
    <pre className="mt-2 overflow-x-auto bg-band px-4 py-3 text-[0.8125rem] leading-[1.45] text-ink">
      <code>{text ?? "—"}</code>
    </pre>
  </div>
);

/**
 * Figure n: the WebAssembly of a RefCell operation next to the lock it is
 * compared with, in one build, with the time each took in `row`.
 */
export const LocksListings = ({ n, row, engine }: { n: number; row: ResultRow; engine: string }) => {
  const [pairId, setPairId] = useState(pairs[0].id);
  const [build, setBuild] = useState<Variant>("abort");
  if (!listings) {
    return null;
  }
  const pair = pairs.find((p) => p.id === pairId) ?? pairs[0];
  const time = (side: Side) => {
    const s = samplesOf(row, build, side.workload);
    return s?.length ? `${ns(summarize(s).median)} in ${engine}` : `not measured in ${engine}`;
  };
  return (
    <>
      <Figure
        n={n}
        title="The WebAssembly of one borrow and one lock"
        subtitle={
          <>
            Each kernel is a Rust function marked <code>#[inline(never)]</code>, as wasm-bindgen ships it. This is what the engine compiles. The time is the
            median of the op row in Figure 1.
          </>
        }
        source={`The modules this page runs, printed by ${listings.printer.replace(/ \(.*\)$/, "")}. Crate hashes are removed.`}
      >
        <div className="mb-4 flex flex-wrap gap-x-8 gap-y-3">
          <ChoiceChips
            label="Operations shown"
            value={pair.id}
            onChange={setPairId}
            options={pairs.map((p) => ({ value: p.id, label: p.label }))}
          />
          <ChoiceChips label="Build shown" value={build} onChange={setBuild} options={variants.map((v) => ({ value: v, label: variantInfo[v].label }))} />
        </div>
        <div className="grid gap-x-6 gap-y-6 lg:grid-cols-2">
          <Panel side={pair.refcell} text={listings.builds[build]?.[pair.refcell.kernel]} time={time(pair.refcell)} />
          <Panel side={pair.lock} text={listings.builds[build]?.[pair.lock.kernel]} time={time(pair.lock)} />
        </div>
      </Figure>
      <Prose className="mt-6">
        <h3 className="text-fig font-bold text-ink">What the listings show</h3>
        <ul>
          <li>
            <b>panic=abort.</b> The RefCell borrow is one load and one branch. LLVM removes the write of the borrow flag and its restore, because no code
            between them can read the flag. The Mutex stores its flag twice and checks it with <code>assert_eq!</code>. The panic call for that check
            takes the address of a local, so the function also moves the stack pointer down and back up.
          </li>
          <li>
            <b>panic=unwind.</b> The RefCell borrow does not change: a RefCell has no poison flag. The Mutex also reads its poison flag, and it reads the
            global panic count twice: once when it locks, and once when it unlocks. If the count is not zero, it calls a slow path.
          </li>
          <li>
            <b>+atomics.</b> The Mutex becomes a futex lock: an atomic compare-exchange to lock and an atomic exchange to unlock. The calls for a contended
            lock are in the code, but they do not run here, because only one thread uses the lock. The RefCell borrow does not change.
          </li>
        </ul>
      </Prose>
    </>
  );
};
