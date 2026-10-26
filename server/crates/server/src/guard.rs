//! Minimal abuse protection: rate limits and connection caps.
//!
//! None of this stops a determined attacker, but it keeps scripts and buggy
//! clients from flooding a small community server:
//!
//! * [`TokenBucket`] — per-connection message and chat rate limits
//! * [`Slots`] — counted permits: the global player cap and connections per IP
//! * [`client_ip`] — the client's address, optionally from a trusted reverse proxy
//!
//! Everything here is synchronous and takes time as plain seconds, so it is
//! tested without a clock.

use std::collections::HashMap;
use std::hash::Hash;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};

/// Classic token bucket: `capacity` tokens, refilled at `per_second`.
#[derive(Debug, Clone, PartialEq)]
pub struct TokenBucket {
    capacity: f64,
    per_second: f64,
    tokens: f64,
    last_s: Option<f64>,
}

impl TokenBucket {
    pub fn new(capacity: f64, per_second: f64) -> Self {
        Self {
            capacity,
            per_second,
            tokens: capacity,
            last_s: None,
        }
    }

    /// Takes one token if available. `now_s` must not go backwards.
    pub fn allow(&mut self, now_s: f64) -> bool {
        if let Some(last) = self.last_s {
            let elapsed = (now_s - last).max(0.0);
            self.tokens = (self.tokens + elapsed * self.per_second).min(self.capacity);
        }
        self.last_s = Some(now_s);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Counted permits per key, e.g. connections per IP address. A permit is
/// returned automatically when the [`SlotPermit`] is dropped.
pub struct Slots<K: Eq + Hash + Clone + Send + 'static> {
    limit: usize,
    used: Arc<Mutex<HashMap<K, usize>>>,
}

impl<K: Eq + Hash + Clone + Send + 'static> Clone for Slots<K> {
    fn clone(&self) -> Self {
        Self {
            limit: self.limit,
            used: Arc::clone(&self.used),
        }
    }
}

impl<K: Eq + Hash + Clone + Send + 'static> Slots<K> {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            used: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn limit(&self) -> usize {
        self.limit
    }

    /// A permit for `key`, or `None` if the key already holds `limit` permits.
    pub fn try_acquire(&self, key: K) -> Option<SlotPermit<K>> {
        let mut used = self.used.lock().unwrap_or_else(|e| e.into_inner());
        let count = used.entry(key.clone()).or_insert(0);
        if *count >= self.limit {
            return None;
        }
        *count += 1;
        Some(SlotPermit {
            key,
            used: Arc::clone(&self.used),
        })
    }

    /// Permits currently held for `key`.
    pub fn in_use(&self, key: &K) -> usize {
        let used = self.used.lock().unwrap_or_else(|e| e.into_inner());
        used.get(key).copied().unwrap_or(0)
    }
}

pub struct SlotPermit<K: Eq + Hash + Clone + Send + 'static> {
    key: K,
    used: Arc<Mutex<HashMap<K, usize>>>,
}

impl<K: Eq + Hash + Clone + Send + 'static> Drop for SlotPermit<K> {
    fn drop(&mut self) {
        let mut used = self.used.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(count) = used.get_mut(&self.key) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                used.remove(&self.key);
            }
        }
    }
}

/// The client's IP address.
///
/// Behind a reverse proxy (Caddy, nginx) every connection comes from the
/// proxy, so with `trust_proxy` the last address in `X-Forwarded-For` — the
/// one the nearest proxy added — is used instead. Without a trusted proxy the
/// header is ignored, because clients can send anything in it.
pub fn client_ip(peer: Option<SocketAddr>, forwarded_for: Option<&str>, trust_proxy: bool) -> Option<IpAddr> {
    if trust_proxy {
        let forwarded = forwarded_for
            .and_then(|header| header.rsplit(',').next())
            .and_then(|last| last.trim().parse::<IpAddr>().ok());
        if forwarded.is_some() {
            return forwarded;
        }
    }
    peer.map(|addr| addr.ip())
}

/// True if a WebSocket `Origin` may connect. An empty allow-list allows every
/// origin (the default); otherwise the origin must match one entry exactly,
/// e.g. `https://ride.example.com`.
pub fn origin_allowed(origin: Option<&str>, allowed: &[String]) -> bool {
    if allowed.is_empty() {
        return true;
    }
    origin.is_some_and(|origin| {
        allowed
            .iter()
            .any(|entry| entry.eq_ignore_ascii_case(origin.trim_end_matches('/')))
    })
}

/// Limits for one connection, from the configuration.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ConnectionLimits {
    /// Sustained messages per second (telemetry is about 4/s).
    pub messages_per_second: f64,
    /// Burst on top of the sustained rate.
    pub message_burst: f64,
    /// Messages dropped for being too fast before the connection is closed.
    pub max_dropped: u32,
    /// Chat messages: burst and one new message every `chat_interval_s`.
    pub chat_burst: f64,
    pub chat_interval_s: f64,
    /// Creating and boarding vehicles, together: burst and one more every
    /// `vehicle_interval_s`. Keeps create/leave loops from flooding a route
    /// and boarding codes from being guessed quickly (#75).
    pub vehicle_burst: f64,
    pub vehicle_interval_s: f64,
    /// Time to send `hello` and `join` after connecting.
    pub handshake_timeout_s: f64,
    /// A joined connection that sends nothing for this long is closed.
    pub idle_timeout_s: f64,
}

impl Default for ConnectionLimits {
    fn default() -> Self {
        Self {
            messages_per_second: 20.0,
            message_burst: 40.0,
            max_dropped: 200,
            chat_burst: 5.0,
            chat_interval_s: 2.0,
            vehicle_burst: 3.0,
            vehicle_interval_s: 2.0,
            handshake_timeout_s: 15.0,
            idle_timeout_s: 120.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_allows_a_burst_then_the_sustained_rate() {
        let mut bucket = TokenBucket::new(3.0, 1.0);
        assert!(bucket.allow(0.0));
        assert!(bucket.allow(0.0));
        assert!(bucket.allow(0.0));
        assert!(!bucket.allow(0.0), "burst used up");
        assert!(!bucket.allow(0.5), "half a token is not enough");
        assert!(bucket.allow(1.0), "one second refills one token");
        assert!(!bucket.allow(1.0));
        assert!(bucket.allow(100.0));
        // Refill never exceeds the capacity.
        assert!(bucket.allow(100.0));
        assert!(bucket.allow(100.0));
        assert!(!bucket.allow(100.0));
    }

    #[test]
    fn bucket_ignores_time_going_backwards() {
        let mut bucket = TokenBucket::new(1.0, 1.0);
        assert!(bucket.allow(10.0));
        assert!(!bucket.allow(5.0));
    }

    #[test]
    fn slots_cap_each_key_and_free_on_drop() {
        let slots: Slots<&str> = Slots::new(2);
        let a1 = slots.try_acquire("a").unwrap();
        let _a2 = slots.try_acquire("a").unwrap();
        assert!(slots.try_acquire("a").is_none());
        assert!(slots.try_acquire("b").is_some(), "other keys are independent");
        assert_eq!(slots.in_use(&"a"), 2);
        drop(a1);
        assert_eq!(slots.in_use(&"a"), 1);
        assert!(slots.try_acquire("a").is_some());
    }

    #[test]
    fn slots_are_shared_between_clones() {
        let slots: Slots<()> = Slots::new(1);
        let other = slots.clone();
        let _permit = slots.try_acquire(()).unwrap();
        assert!(other.try_acquire(()).is_none());
        assert_eq!(other.limit(), 1);
    }

    #[test]
    fn client_ip_only_trusts_the_proxy_header_when_told_to() {
        let peer: SocketAddr = "10.0.0.2:5000".parse().unwrap();
        let header = Some("203.0.113.9, 198.51.100.7");
        assert_eq!(client_ip(Some(peer), header, false), Some("10.0.0.2".parse().unwrap()));
        assert_eq!(
            client_ip(Some(peer), header, true),
            Some("198.51.100.7".parse().unwrap())
        );
        assert_eq!(
            client_ip(Some(peer), Some("garbage"), true),
            Some("10.0.0.2".parse().unwrap())
        );
        assert_eq!(client_ip(None, None, true), None);
        assert_eq!(
            client_ip(None, Some("2001:db8::1"), true),
            Some("2001:db8::1".parse().unwrap())
        );
    }

    #[test]
    fn origins_are_checked_only_with_an_allow_list() {
        assert!(origin_allowed(None, &[]));
        let allowed = vec!["https://ride.example.com".to_owned()];
        assert!(origin_allowed(Some("https://ride.example.com"), &allowed));
        assert!(origin_allowed(Some("https://RIDE.example.com/"), &allowed));
        assert!(!origin_allowed(Some("https://evil.example"), &allowed));
        assert!(!origin_allowed(None, &allowed));
    }
}
