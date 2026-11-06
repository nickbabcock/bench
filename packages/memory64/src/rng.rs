/// Small deterministic PRNG (SplitMix64).
///
/// Every benchmark derives its inputs from this generator so that the wasm32
/// and wasm64 builds perform identical work and produce identical checksums.
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    pub fn next_u32(&mut self) -> u32 {
        (self.next_u64() >> 32) as u32
    }

    /// Uniform in `[0, n)`.
    pub fn below(&mut self, n: u32) -> u32 {
        ((u64::from(self.next_u32()) * u64::from(n)) >> 32) as u32
    }

    /// Uniform in `[0, 1)`.
    pub fn f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 * (1.0 / (1u32 << 24) as f32)
    }

    /// Uniform in `[-1, 1)`.
    pub fn f32_signed(&mut self) -> f32 {
        self.f32() * 2.0 - 1.0
    }

    pub fn chance(&mut self, p: f32) -> bool {
        self.f32() < p
    }
}

/// Order-sensitive 64-bit hash accumulator used for result checksums.
#[derive(Debug, Clone, Copy)]
pub struct Checksum(u64);

impl Default for Checksum {
    fn default() -> Self {
        Self::new()
    }
}

impl Checksum {
    pub fn new() -> Self {
        Checksum(0xCBF2_9CE4_8422_2325)
    }

    pub fn write_u64(&mut self, value: u64) {
        self.0 = (self.0 ^ value).wrapping_mul(0x0000_0100_0000_01B3);
        self.0 ^= self.0 >> 29;
    }

    pub fn write_f32(&mut self, value: f32) {
        self.write_u64(u64::from(value.to_bits()));
    }

    /// Truncate to 53 bits so the value round-trips through a JS number.
    pub fn finish(self) -> f64 {
        (self.0 >> 11) as f64
    }
}
