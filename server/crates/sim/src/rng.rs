//! Injectable randomness.
//!
//! The simulation never reaches for a global RNG. Everything random (bot
//! profiles, names, spawn positions, power noise) is drawn from a
//! [`RandomSource`] handed in by the caller, which makes every test and every
//! server run with a fixed seed fully reproducible.

/// Source of pseudo-random numbers used by the simulation.
pub trait RandomSource: Send {
    /// Returns the next 64 random bits.
    fn next_u64(&mut self) -> u64;

    /// Uniform float in `[0, 1)`.
    fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Uniform float in `[lo, hi)`.
    fn range_f64(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.next_f64()
    }

    /// Uniform index in `[0, n)`. Returns 0 for `n == 0`.
    fn index(&mut self, n: usize) -> usize {
        if n == 0 {
            return 0;
        }
        ((self.next_f64() * n as f64) as usize).min(n - 1)
    }

    /// Approximately standard-normal sample (Irwin-Hall with 12 uniforms).
    fn standard_normal(&mut self) -> f64 {
        let mut sum = 0.0;
        for _ in 0..12 {
            sum += self.next_f64();
        }
        sum - 6.0
    }
}

/// Small, fast, seedable generator (SplitMix64). Not cryptographically secure,
/// which is fine for gameplay.
#[derive(Debug, Clone)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }
}

impl RandomSource for SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_produces_same_sequence() {
        let mut a = SplitMix64::new(42);
        let mut b = SplitMix64::new(42);
        for _ in 0..100 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn next_f64_stays_in_unit_interval() {
        let mut rng = SplitMix64::new(7);
        for _ in 0..10_000 {
            let x = rng.next_f64();
            assert!((0.0..1.0).contains(&x));
        }
    }

    #[test]
    fn index_never_exceeds_bound() {
        let mut rng = SplitMix64::new(3);
        for _ in 0..10_000 {
            assert!(rng.index(5) < 5);
        }
        assert_eq!(rng.index(0), 0);
    }

    #[test]
    fn standard_normal_has_roughly_zero_mean() {
        let mut rng = SplitMix64::new(11);
        let n = 20_000;
        let mean: f64 = (0..n).map(|_| rng.standard_normal()).sum::<f64>() / n as f64;
        assert!(mean.abs() < 0.05, "mean was {mean}");
    }
}
