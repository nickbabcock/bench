/**
 * RefCell against Mutex: the builds and the workloads, in page order. The
 * ids match `WORKLOADS` in packages/lockbench/src/lib.rs, which the worker
 * checks when it loads each build.
 */

/** One crate built three times; see `mise run build:locks`. */
export type Variant = "abort" | "unwind" | "atomics";
export const variants: readonly Variant[] = ["abort", "unwind", "atomics"];

export const variantInfo: Record<Variant, { label: string; detail: string }> = {
  abort: {
    label: "panic=abort",
    detail: "The default for wasm32-unknown-unknown and the WASI targets. std has no poison flag, and Mutex is one Cell<bool>.",
  },
  unwind: {
    label: "panic=unwind",
    detail: "std rebuilt for unwinding. The poison flag and the panic count checks come back into every lock.",
  },
  atomics: {
    label: "+atomics",
    detail: "std rebuilt with atomics and shared memory. Mutex and RwLock become futex locks; no second thread runs.",
  },
};

export type Group = "op" | "loop" | "held" | "app";

export const groupInfo: Record<Group, { title: string; detail: string }> = {
  op: {
    title: "One call for each operation",
    detail:
      "Each iteration calls a kernel that Rust marks #[inline(never)]. LLVM keeps the call; the engine can still inline it. Write rows compare with op/plain, read rows with op/plain_read.",
  },
  loop: {
    title: "Lock and loop in one function",
    detail:
      "The lock is in the loop body, so LLVM sees all of its code. The container comes from outside the function, as shared state does, so LLVM can not delete the lock.",
  },
  held: {
    title: "Guard held across the loop",
    detail: "The same loop with one guard taken before it: what hoisting the lock out of a hot loop gives.",
  },
  app: {
    title: "Shared owner and a method call",
    detail: "Rc<RefCell<State>> against Arc<Mutex<State>>, with a method that reads and writes three fields: the shape of application code.",
  },
};

export type WorkloadId =
  | "op/plain"
  | "op/cell"
  | "op/atomic_relaxed"
  | "op/refcell_write"
  | "op/plain_read"
  | "op/refcell_read"
  | "op/refcell_try_write"
  | "op/mutex"
  | "op/mutex_try"
  | "op/rwlock_write"
  | "op/rwlock_read"
  | "loop/plain"
  | "loop/cell"
  | "loop/atomic_relaxed"
  | "loop/refcell_write"
  | "loop/mutex"
  | "loop/rwlock_write"
  | "held/refcell"
  | "held/mutex"
  | "app/rc_refcell"
  | "app/arc_mutex";

export type Workload = {
  id: WorkloadId;
  group: Group;
  /** What one operation is, in code. */
  code: string;
  /** The row this one is read against ("vs" in the table); itself for a baseline. */
  baseline: WorkloadId;
};

export const workloads: readonly Workload[] = [
  { id: "op/plain", group: "op", code: "*c += x", baseline: "op/plain" },
  { id: "op/cell", group: "op", code: "c.set(c.get() + x)", baseline: "op/plain" },
  { id: "op/atomic_relaxed", group: "op", code: "c.fetch_add(x, Relaxed)", baseline: "op/plain" },
  { id: "op/refcell_write", group: "op", code: "*c.borrow_mut() += x", baseline: "op/plain" },
  { id: "op/refcell_try_write", group: "op", code: "if let Ok(mut g) = c.try_borrow_mut()", baseline: "op/plain" },
  { id: "op/mutex", group: "op", code: "*m.lock().unwrap() += x", baseline: "op/plain" },
  { id: "op/mutex_try", group: "op", code: "if let Ok(mut g) = m.try_lock()", baseline: "op/plain" },
  { id: "op/rwlock_write", group: "op", code: "*l.write().unwrap() += x", baseline: "op/plain" },
  { id: "op/plain_read", group: "op", code: "*c", baseline: "op/plain_read" },
  { id: "op/refcell_read", group: "op", code: "*c.borrow()", baseline: "op/plain_read" },
  { id: "op/rwlock_read", group: "op", code: "*l.read().unwrap()", baseline: "op/plain_read" },
  { id: "loop/plain", group: "loop", code: "v += x; *p = v", baseline: "loop/plain" },
  { id: "loop/cell", group: "loop", code: "p.set(p.get() + x)", baseline: "loop/plain" },
  { id: "loop/atomic_relaxed", group: "loop", code: "p.fetch_add(x, Relaxed)", baseline: "loop/plain" },
  { id: "loop/refcell_write", group: "loop", code: "*p.borrow_mut() += x", baseline: "loop/plain" },
  { id: "loop/mutex", group: "loop", code: "*p.lock().unwrap() += x", baseline: "loop/plain" },
  { id: "loop/rwlock_write", group: "loop", code: "*p.write().unwrap() += x", baseline: "loop/plain" },
  { id: "held/refcell", group: "held", code: "let mut g = p.borrow_mut(); loop { *g += x }", baseline: "loop/plain" },
  { id: "held/mutex", group: "held", code: "let mut g = p.lock().unwrap(); loop { *g += x }", baseline: "loop/plain" },
  { id: "app/rc_refcell", group: "app", code: "s.borrow_mut().record(x)", baseline: "app/rc_refcell" },
  { id: "app/arc_mutex", group: "app", code: "s.lock().unwrap().record(x)", baseline: "app/rc_refcell" },
];

export const workloadIds: readonly WorkloadId[] = workloads.map((w) => w.id);
export const workloadById = Object.fromEntries(workloads.map((w) => [w.id, w])) as Record<WorkloadId, Workload>;

/** Inner iterations per driver call: ns per operation is a batch's time ÷ (calls × this). */
export const ITERATIONS = 4096;

/**
 * One measured cell, `subject ÷ reference`, paired by round: both cells run
 * in every round, so each round gives one ratio.
 */
export type Comparison = {
  id: string;
  subject: { workload: WorkloadId; variant: Variant };
  reference: { workload: WorkloadId; variant: Variant };
  /** Row label: "Mutex ÷ RefCell, one call". */
  label: string;
};

const pair = (id: string, label: string, subject: [WorkloadId, Variant], reference: [WorkloadId, Variant]): Comparison => ({
  id,
  label,
  subject: { workload: subject[0], variant: subject[1] },
  reference: { workload: reference[0], variant: reference[1] },
});

/** Figure 2: what a Mutex costs against a RefCell, in each build. */
export const lockComparisons = (v: Variant): Comparison[] => [
  pair(`mutex-refcell-op:${v}`, "Mutex ÷ RefCell, one call", ["op/mutex", v], ["op/refcell_write", v]),
  pair(`mutex-refcell-loop:${v}`, "Mutex ÷ RefCell, in a loop", ["loop/mutex", v], ["loop/refcell_write", v]),
  pair(`arc-rc-app:${v}`, "Arc<Mutex> ÷ Rc<RefCell>, method call", ["app/arc_mutex", v], ["app/rc_refcell", v]),
  pair(`try-lock:${v}`, "try_lock ÷ lock", ["op/mutex_try", v], ["op/mutex", v]),
  pair(`held-mutex:${v}`, "Guard held ÷ lock per iteration", ["held/mutex", v], ["loop/mutex", v]),
];

/** Figure 3: what a build costs against the default, for the same workload. */
export const buildComparisons = (v: Exclude<Variant, "abort">): Comparison[] =>
  (["op/refcell_write", "op/mutex", "op/rwlock_write", "loop/mutex", "op/atomic_relaxed", "app/arc_mutex"] as const).map((w) =>
    pair(`build-${w}:${v}`, w, [w, v], [w, "abort"]),
  );

/** A minimal module with a try_table: `WebAssembly.validate` rejects it in engines without exnref. */
const exnrefProbe = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x08, 0x01, 0x06, 0x00, 0x1f,
  0x40, 0x00, 0x0b, 0x0b,
]);

/** Why a build can not load in this browser, or undefined when it can. */
export function unsupported(variant: Variant): string | undefined {
  switch (variant) {
    case "abort":
      return undefined;
    case "unwind":
      try {
        return WebAssembly.validate(exnrefProbe) ? undefined : "needs WebAssembly exception handling with exnref (Chrome 137, Firefox 131, Safari 18.4 or later)";
      } catch {
        return "needs WebAssembly exception handling with exnref";
      }
    case "atomics":
      return globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === "function" ? undefined : "needs shared memory, which only a cross-origin isolated page has";
  }
}
