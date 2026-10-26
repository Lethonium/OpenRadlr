//! Randomness an attacker must not guess: session ids, OAuth states, resume
//! tokens, nonces and boarding codes. Always from the operating system; the
//! seeded simulation RNG (whose seed is logged and may be fixed) is for
//! gameplay only.

use openradlr_sim::rng::RandomSource;
use std::fmt::Write as _;
use std::io::Read;

/// Fills `bytes` from the system's random source.
///
/// # Panics
/// If `/dev/urandom` can't be read. There is no safe fallback: a predictable
/// token would be worse than a crash.
pub fn random_bytes(bytes: &mut [u8]) {
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(bytes))
        .expect("the system's random source (/dev/urandom) must be readable");
}

/// 32 random bytes as hex, for session ids and OAuth states.
pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    random_bytes(&mut bytes);
    bytes.iter().fold(String::with_capacity(64), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

/// A [`RandomSource`] backed by the operating system, for the sim's boarding codes.
pub struct OsRandom;

impl RandomSource for OsRandom {
    fn next_u64(&mut self) -> u64 {
        let mut bytes = [0u8; 8];
        random_bytes(&mut bytes);
        u64::from_le_bytes(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_tokens_are_long_and_different() {
        let a = random_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, random_token());
    }

    #[test]
    fn os_random_does_not_repeat() {
        let mut rng = OsRandom;
        assert_ne!(rng.next_u64(), rng.next_u64());
    }
}
