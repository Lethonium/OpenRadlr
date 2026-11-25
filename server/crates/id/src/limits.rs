//! Fixed-window rate limits for code requests and sign-in attempts, in memory.

use std::collections::HashMap;

/// At most `max` hits per key in each window of `window_s` seconds.
pub struct RateLimit {
    max: u32,
    window_s: i64,
    hits: HashMap<String, (i64, u32)>,
}

/// Keys kept before stale ones are dropped, so a flood of addresses can't grow the map forever.
const MAX_KEYS: usize = 50_000;

impl RateLimit {
    pub fn new(max: u32, window_s: i64) -> Self {
        Self {
            max,
            window_s,
            hits: HashMap::new(),
        }
    }

    /// Counts a hit for `key` at `now_s`; false if the key is over its limit.
    pub fn allow(&mut self, key: &str, now_s: i64) -> bool {
        if self.hits.len() >= MAX_KEYS {
            let window_s = self.window_s;
            self.hits.retain(|_, (start, _)| now_s - *start < window_s);
        }
        let entry = self.hits.entry(key.to_owned()).or_insert((now_s, 0));
        if now_s - entry.0 >= self.window_s {
            *entry = (now_s, 0);
        }
        if entry.1 >= self.max {
            return false;
        }
        entry.1 += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hits_over_the_limit_are_refused_until_the_window_ends() {
        let mut limit = RateLimit::new(2, 60);
        assert!(limit.allow("a", 0));
        assert!(limit.allow("a", 1));
        assert!(!limit.allow("a", 2));
        assert!(limit.allow("a", 60));
    }

    #[test]
    fn keys_are_counted_apart() {
        let mut limit = RateLimit::new(1, 60);
        assert!(limit.allow("a", 0));
        assert!(limit.allow("b", 0));
    }
}
