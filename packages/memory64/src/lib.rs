//! Benchmarks compiled for both `wasm32-unknown-unknown` and
//! `wasm64-unknown-unknown` (memory64) to measure the cost of 64-bit linear
//! memory. All inputs are generated from a fixed seed, so both builds do
//! identical work and must return identical checksums.
//!
//! Each workload is a class: the constructor takes its parameters (untimed)
//! and `run` performs one timed iteration.

use wasm_bindgen::prelude::*;

pub mod ecs;
pub mod rng;

const SEED: u64 = 0x5EED_0F3A_5A00;

/// Pointer width of this build, in bits (32 for wasm32, 64 for wasm64).
#[wasm_bindgen]
pub fn pointer_width() -> u32 {
    usize::BITS
}

/// bevy_ecs arena skirmish simulation.
#[wasm_bindgen]
pub struct EcsSimulation {
    units: u32,
    ticks: u32,
}

#[wasm_bindgen]
impl EcsSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new(units: u32, ticks: u32) -> EcsSimulation {
        EcsSimulation { units, ticks }
    }

    /// Spawn a fresh world, run every tick, and return a checksum of the
    /// final world state.
    pub fn run(&self) -> f64 {
        ecs::simulate(self.units, self.ticks, SEED)
    }
}
