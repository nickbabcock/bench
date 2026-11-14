//! RefCell against Mutex on wasm: the cost of interior mutability on a
//! single threaded WebAssembly target.
//!
//! Four groups of workloads (see `WORKLOADS`): `op` calls one kernel for
//! each operation, `loop` has the lock and the loop in one function, `held`
//! takes one guard before the loop, and `app` calls a method through a
//! shared owner.
//!
//! Three design rules keep the numbers meaningful:
//!
//! 1. The containers live on the heap, in one `Containers` value that stays
//!    for the whole run, and every driver gets its container through
//!    `black_box`, as code that shares state does. If a driver makes the
//!    container inside the timed function, the optimizer can prove that no
//!    other code sees it and delete the lock. Then the row shows only that
//!    dead code goes away.
//! 2. The read rows have their own baseline, `op/plain_read`. `op/plain` is
//!    a read-modify-write: when the engine inlines the kernel, each
//!    iteration waits for the store of the iteration before it. A read does
//!    not, so a read row can measure below `op/plain` with no error in the
//!    measurement.
//! 3. There is no sequentially consistent atomic row. Without threads, a
//!    wasm atomic is a plain load and store. With threads, every wasm atomic
//!    is sequentially consistent. Thus a relaxed kernel and a sequentially
//!    consistent kernel are the same instructions in every build that the
//!    page loads.
//!
//! One source is built three times: `panic = "abort"` (the default for
//! wasm), `panic = "unwind"` (which brings back the poison flag), and
//! `+atomics` (which makes `Mutex` a futex lock). See `mise run build:locks`.

use std::cell::{Cell, RefCell};
use std::hint::black_box;
use std::panic::AssertUnwindSafe;
use std::rc::Rc;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering::{self, Relaxed};
use std::sync::{Arc, Mutex, RwLock};

use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Kernels: one operation each. `#[inline(never)]` keeps each kernel a real
// call for LLVM. The engine can still inline it (V8 does).
// ---------------------------------------------------------------------------

#[inline(never)]
pub fn k_plain(c: &mut u64, x: u64) {
    *c += x;
}

#[inline(never)]
pub fn k_plain_read(c: &u64) -> u64 {
    *c
}

#[inline(never)]
pub fn k_cell(c: &Cell<u64>, x: u64) {
    c.set(c.get() + x);
}

#[inline(never)]
pub fn k_atomic_rlx(c: &AtomicU64, x: u64) {
    c.fetch_add(x, Ordering::Relaxed);
}

#[inline(never)]
pub fn k_refcell_write(c: &RefCell<u64>, x: u64) {
    *c.borrow_mut() += x;
}

#[inline(never)]
pub fn k_refcell_read(c: &RefCell<u64>) -> u64 {
    *c.borrow()
}

#[inline(never)]
pub fn k_refcell_try_write(c: &RefCell<u64>, x: u64) {
    if let Ok(mut g) = c.try_borrow_mut() {
        *g += x;
    }
}

#[inline(never)]
pub fn k_mutex_lock(m: &Mutex<u64>, x: u64) {
    *m.lock().unwrap() += x;
}

#[inline(never)]
pub fn k_mutex_trylock(m: &Mutex<u64>, x: u64) {
    if let Ok(mut g) = m.try_lock() {
        *g += x;
    }
}

#[inline(never)]
pub fn k_rwlock_write(l: &RwLock<u64>, x: u64) {
    *l.write().unwrap() += x;
}

#[inline(never)]
pub fn k_rwlock_read(l: &RwLock<u64>) -> u64 {
    *l.read().unwrap()
}

// ---------------------------------------------------------------------------
// Shared state for the `app` group: one counter object with a method that
// reads and writes three fields.
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct State {
    evens: u64,
    odds: u64,
    last: u64,
}

impl State {
    #[inline(never)]
    pub fn record(&mut self, x: u64) {
        if x & 1 == 0 {
            self.evens += 1;
        } else {
            self.odds += 1;
        }
        self.last = x;
    }

    fn digest(&self) -> u64 {
        self.evens ^ self.odds ^ self.last
    }
}

/// Every container, on the heap for the whole run.
pub struct Containers {
    plain: u64,
    cell: Cell<u64>,
    atomic: AtomicU64,
    refcell: RefCell<u64>,
    mutex: Mutex<u64>,
    rwlock: RwLock<u64>,
    rc_refcell: Rc<RefCell<State>>,
    arc_mutex: Arc<Mutex<State>>,
}

impl Containers {
    /// Each container starts at its own non-zero value. A read workload
    /// never writes, so its digest then depends on the value that its
    /// kernel reads, and the check across builds compares something.
    fn new() -> Box<Containers> {
        Box::new(Containers {
            plain: 3,
            cell: Cell::new(5),
            atomic: AtomicU64::new(7),
            refcell: RefCell::new(11),
            mutex: Mutex::new(13),
            rwlock: RwLock::new(17),
            rc_refcell: Rc::new(RefCell::new(State::default())),
            arc_mutex: Arc::new(Mutex::new(State::default())),
        })
    }
}

// ---------------------------------------------------------------------------
// op: one kernel call for each operation. `black_box` on the container in
// each iteration stops LLVM: it can not lift the flag out of the loop.
// ---------------------------------------------------------------------------

#[inline(never)]
fn op_plain(c: &mut Containers, n: u32) -> u64 {
    for i in 0..n {
        k_plain(black_box(&mut c.plain), black_box(i as u64));
    }
    c.plain
}

/// An op driver for a write kernel: `|x| read` names the container `x` and
/// reads its final value.
macro_rules! op_write {
    ($name:ident, $field:ident, $kernel:ident, |$x:ident| $read:expr) => {
        #[inline(never)]
        fn $name(c: &mut Containers, n: u32) -> u64 {
            for i in 0..n {
                $kernel(black_box(&c.$field), black_box(i as u64));
            }
            let $x = &c.$field;
            $read
        }
    };
}

op_write!(op_cell, cell, k_cell, |x| x.get());
op_write!(op_atomic_relaxed, atomic, k_atomic_rlx, |x| x.load(Relaxed));
op_write!(op_refcell_write, refcell, k_refcell_write, |x| *x.borrow());
op_write!(op_refcell_try_write, refcell, k_refcell_try_write, |x| *x
    .borrow());
op_write!(op_mutex, mutex, k_mutex_lock, |x| *x.lock().unwrap());
op_write!(op_mutex_try, mutex, k_mutex_trylock, |x| *x.lock().unwrap());
op_write!(op_rwlock_write, rwlock, k_rwlock_write, |x| *x
    .read()
    .unwrap());

/// An op driver for a read kernel: it sums what each call reads.
macro_rules! op_read {
    ($name:ident, $field:ident, $kernel:ident) => {
        #[inline(never)]
        fn $name(c: &mut Containers, n: u32) -> u64 {
            let mut s = 0u64;
            for _ in 0..n {
                s = s.wrapping_add($kernel(black_box(&c.$field)));
            }
            s
        }
    };
}

op_read!(op_plain_read, plain, k_plain_read);
op_read!(op_refcell_read, refcell, k_refcell_read);
op_read!(op_rwlock_read, rwlock, k_rwlock_read);

// ---------------------------------------------------------------------------
// loop: the lock and the loop in one function, so LLVM sees the lock code.
// The container comes from outside, and each iteration gets its value
// through `black_box`, an opaque step that could touch the container.
// ---------------------------------------------------------------------------

// The baseline keeps the running value in a local and stores it each
// iteration. That is what LLVM makes of loop_cell. For `*p += x` on a
// `&mut u64`, LLVM also loads `*p` again in each iteration, so a row with
// less work than the others would be slower than they are.
#[inline(never)]
fn loop_plain(c: &mut Containers, n: u32) -> u64 {
    let p = black_box(&mut c.plain);
    let mut v = *p;
    for i in 0..n {
        v += black_box(i as u64);
        *p = v;
    }
    v
}

#[inline(never)]
fn loop_cell(c: &mut Containers, n: u32) -> u64 {
    let p = black_box(&c.cell);
    for i in 0..n {
        p.set(p.get() + black_box(i as u64));
    }
    p.get()
}

#[inline(never)]
fn loop_atomic_relaxed(c: &mut Containers, n: u32) -> u64 {
    let p = black_box(&c.atomic);
    for i in 0..n {
        p.fetch_add(black_box(i as u64), Ordering::Relaxed);
    }
    p.load(Ordering::Relaxed)
}

#[inline(never)]
fn loop_refcell_write(c: &mut Containers, n: u32) -> u64 {
    let p = black_box(&c.refcell);
    for i in 0..n {
        *p.borrow_mut() += black_box(i as u64);
    }
    let v = *p.borrow();
    v
}

#[inline(never)]
fn loop_mutex(c: &mut Containers, n: u32) -> u64 {
    let p = black_box(&c.mutex);
    for i in 0..n {
        *p.lock().unwrap() += black_box(i as u64);
    }
    let v = *p.lock().unwrap();
    v
}

#[inline(never)]
fn loop_rwlock_write(c: &mut Containers, n: u32) -> u64 {
    let p = black_box(&c.rwlock);
    for i in 0..n {
        *p.write().unwrap() += black_box(i as u64);
    }
    let v = *p.read().unwrap();
    v
}

// ---------------------------------------------------------------------------
// held: the same loop, with one guard taken before the loop.
// ---------------------------------------------------------------------------

#[inline(never)]
fn held_refcell(c: &mut Containers, n: u32) -> u64 {
    let p = black_box(&c.refcell);
    let mut g = p.borrow_mut();
    for i in 0..n {
        *g += black_box(i as u64);
    }
    *g
}

#[inline(never)]
fn held_mutex(c: &mut Containers, n: u32) -> u64 {
    let p = black_box(&c.mutex);
    let mut g = p.lock().unwrap();
    for i in 0..n {
        *g += black_box(i as u64);
    }
    *g
}

// ---------------------------------------------------------------------------
// app: a shared owner and a method call, the shape of application code.
// ---------------------------------------------------------------------------

#[inline(never)]
fn app_rc_refcell(c: &mut Containers, n: u32) -> u64 {
    let s = black_box(&c.rc_refcell);
    for i in 0..n {
        s.borrow_mut().record(black_box(i as u64));
    }
    let v = s.borrow().digest();
    v
}

#[inline(never)]
fn app_arc_mutex(c: &mut Containers, n: u32) -> u64 {
    let s = black_box(&c.arc_mutex);
    for i in 0..n {
        s.lock().unwrap().record(black_box(i as u64));
    }
    let v = s.lock().unwrap().digest();
    v
}

// ---------------------------------------------------------------------------
// Registry and the JavaScript interface.
// ---------------------------------------------------------------------------

type Driver = fn(&mut Containers, u32) -> u64;

/// Every workload, in page order: the same order as `workloads` in
/// src/features/locks/workloads.ts, which the worker checks.
const WORKLOADS: &[(&str, Driver)] = &[
    ("op/plain", op_plain),
    ("op/cell", op_cell),
    ("op/atomic_relaxed", op_atomic_relaxed),
    ("op/refcell_write", op_refcell_write),
    ("op/refcell_try_write", op_refcell_try_write),
    ("op/mutex", op_mutex),
    ("op/mutex_try", op_mutex_try),
    ("op/rwlock_write", op_rwlock_write),
    ("op/plain_read", op_plain_read),
    ("op/refcell_read", op_refcell_read),
    ("op/rwlock_read", op_rwlock_read),
    ("loop/plain", loop_plain),
    ("loop/cell", loop_cell),
    ("loop/atomic_relaxed", loop_atomic_relaxed),
    ("loop/refcell_write", loop_refcell_write),
    ("loop/mutex", loop_mutex),
    ("loop/rwlock_write", loop_rwlock_write),
    ("held/refcell", held_refcell),
    ("held/mutex", held_mutex),
    ("app/rc_refcell", app_rc_refcell),
    ("app/arc_mutex", app_arc_mutex),
];

/// The workload ids, in page order.
#[wasm_bindgen]
pub fn workloads() -> Vec<String> {
    WORKLOADS.iter().map(|(id, _)| id.to_string()).collect()
}

/// The panic strategy and the thread support that this build has.
#[wasm_bindgen]
pub fn build_flags() -> String {
    let panic = if cfg!(panic = "unwind") {
        "unwind"
    } else {
        "abort"
    };
    let atomics = cfg!(target_feature = "atomics");
    format!("panic={panic} atomics={atomics}")
}

/// Fresh containers and one workload to run against them.
#[wasm_bindgen]
pub struct Bench {
    /// wasm-bindgen catches panics at the boundary in the unwind build, and
    /// that needs `RefUnwindSafe`. A panic ends the run, so no code can see
    /// a broken container.
    containers: AssertUnwindSafe<Box<Containers>>,
    driver: Driver,
}

#[wasm_bindgen]
impl Bench {
    /// Fresh containers for workload `id` (untimed).
    #[wasm_bindgen(constructor)]
    pub fn new(id: &str) -> Result<Bench, JsError> {
        let driver = WORKLOADS
            .iter()
            .find(|(name, _)| *name == id)
            .map(|(_, f)| *f)
            .ok_or_else(|| JsError::new(&format!("unknown workload {id}")))?;
        Ok(Bench {
            containers: AssertUnwindSafe(Containers::new()),
            driver,
        })
    }

    /// Run the workload `reps` times with `n` iterations each, and return a
    /// digest of the results, as a float so that JavaScript can compare it.
    pub fn run(&mut self, n: u32, reps: u32) -> f64 {
        let mut acc = 0u64;
        for _ in 0..reps {
            acc = acc.rotate_left(5) ^ (self.driver)(&mut self.containers.0, black_box(n));
        }
        (acc & ((1 << 53) - 1)) as f64
    }
}
