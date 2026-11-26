//! What the service takes from outside: the clock and the random source, so
//! tests run on a fixed time and predictable tokens.

use std::fmt::Write as _;
use std::sync::Arc;

/// Unix seconds now.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// Fills a buffer with unguessable bytes (the operating system's in production).
pub type Entropy = Arc<dyn Fn(&mut [u8]) + Send + Sync>;

/// Lowercase hex of `bytes`.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

/// 32 random bytes as hex: session ids, account ids, challenges.
pub fn token(entropy: &Entropy) -> String {
    let mut bytes = [0u8; 32];
    entropy(&mut bytes);
    hex(&bytes)
}

/// A uniformly random 6-digit code, zero-padded.
pub fn code(entropy: &Entropy) -> String {
    // The largest multiple of 1 000 000 below 2^32: values above it would favour small codes.
    const LIMIT: u32 = 4_294_000_000;
    loop {
        let mut bytes = [0u8; 4];
        entropy(&mut bytes);
        let value = u32::from_le_bytes(bytes);
        if value < LIMIT {
            return format!("{:06}", value % 1_000_000);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU8, Ordering};

    fn counting() -> Entropy {
        let next = AtomicU8::new(0);
        Arc::new(move |out: &mut [u8]| out.iter_mut().for_each(|b| *b = next.fetch_add(1, Ordering::Relaxed)))
    }

    #[test]
    fn a_token_is_64_hex_digits() {
        let token = token(&counting());
        assert_eq!(token.len(), 64);
        assert!(token.starts_with("000102"));
    }

    #[test]
    fn a_code_is_six_digits_with_leading_zeros() {
        let zeros: Entropy = Arc::new(|out: &mut [u8]| out.fill(0));
        assert_eq!(code(&zeros), "000000");
    }

    #[test]
    fn a_code_skips_values_that_would_bias_it() {
        let calls = AtomicU8::new(0);
        let entropy: Entropy = Arc::new(move |out: &mut [u8]| {
            let fill = if calls.fetch_add(1, Ordering::Relaxed) == 0 {
                0xff
            } else {
                0
            };
            out.fill(fill);
        });
        assert_eq!(code(&entropy), "000000");
    }
}
