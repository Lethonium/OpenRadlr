//! The registry of pairing codes: the tablet that owns a screen key shows a
//! short code, a second screen (a phone) claims it and learns the key. A code
//! is valid for five minutes and works once.
//!
//! Codes are shared by all connections, so their expiry is read from one clock
//! owned by the registry, never from a connection's own age.

use crate::protocol::ServerMessage;
use crate::secure_random::random_bytes;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;
use tokio::sync::mpsc;

/// How long a pairing code stays valid, in seconds.
pub const PAIR_CODE_TTL_S: f64 = 300.0;

/// The characters a pairing code is drawn from. No I, L, O, 0 or 1, so a code
/// read aloud or off a screen is unambiguous.
pub const PAIR_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const CODE_LEN: usize = 6;

/// Bytes at or above this are rejected so every alphabet character is equally likely.
const UNBIASED_BYTE_LIMIT: usize = PAIR_ALPHABET.len() * (256 / PAIR_ALPHABET.len());

/// A code waiting to be claimed.
struct Pending {
    key: String,
    name: String,
    expires_at_s: f64,
    /// The offering connection's outbox, told when the code is claimed.
    notify: mpsc::Sender<ServerMessage>,
}

struct State {
    codes: HashMap<String, Pending>,
    /// Source of random bytes; the OS in production, a fake in tests.
    random: Box<dyn FnMut() -> u8 + Send>,
}

impl State {
    fn fresh_code(&mut self) -> String {
        loop {
            let code: String = (0..CODE_LEN).map(|_| self.alphabet_char()).collect();
            if !self.codes.contains_key(&code) {
                return code;
            }
        }
    }

    fn alphabet_char(&mut self) -> char {
        loop {
            let byte = (self.random)() as usize;
            if byte < UNBIASED_BYTE_LIMIT {
                return PAIR_ALPHABET[byte % PAIR_ALPHABET.len()] as char;
            }
        }
    }
}

/// Pairing code to the screen waiting for it. Cloning shares the registry.
#[derive(Clone)]
pub struct PairCodes {
    state: Arc<Mutex<State>>,
    /// Seconds on the registry's own monotonic clock.
    clock: Arc<dyn Fn() -> f64 + Send + Sync>,
}

fn os_random() -> u8 {
    let mut byte = [0u8; 1];
    random_bytes(&mut byte);
    byte[0]
}

impl Default for PairCodes {
    fn default() -> Self {
        Self::new()
    }
}

impl PairCodes {
    /// A registry whose codes come from the operating system's random source,
    /// timed from the moment it is created.
    pub fn new() -> Self {
        let started = Instant::now();
        Self::with(os_random, move || started.elapsed().as_secs_f64())
    }

    fn with(random: impl FnMut() -> u8 + Send + 'static, clock: impl Fn() -> f64 + Send + Sync + 'static) -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                codes: HashMap::new(),
                random: Box::new(random),
            })),
            clock: Arc::new(clock),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Issues a new code for the screen `key`, valid for [`PAIR_CODE_TTL_S`]
    /// from now. `replaces` is the screen's previous code, if any: it is
    /// withdrawn, but only when it belongs to `key`. Expired codes are swept.
    pub fn offer(
        &self,
        key: String,
        name: String,
        notify: mpsc::Sender<ServerMessage>,
        replaces: Option<&str>,
    ) -> String {
        let now_s = (self.clock)();
        let mut state = self.lock();
        if let Some(old) = replaces.map(normalise) {
            if state.codes.get(&old).is_some_and(|pending| pending.key == key) {
                state.codes.remove(&old);
            }
        }
        state.codes.retain(|_, pending| pending.expires_at_s > now_s);
        let code = state.fresh_code();
        state.codes.insert(
            code.clone(),
            Pending {
                key,
                name,
                expires_at_s: now_s + PAIR_CODE_TTL_S,
                notify,
            },
        );
        code
    }

    /// Claims `code` (trimmed, case-insensitive). Returns the screen's `(key, name)`
    /// and removes the code, so it works once. The offering connection is told
    /// with `PairClaimed`. None for an unknown or expired code.
    pub fn claim(&self, code: &str) -> Option<(String, String)> {
        let now_s = (self.clock)();
        let pending = self.lock().codes.remove(&normalise(code))?;
        if pending.expires_at_s <= now_s {
            return None;
        }
        let _ = pending.notify.try_send(ServerMessage::PairClaimed);
        Some((pending.key, pending.name))
    }
}

fn normalise(code: &str) -> String {
    code.trim().to_ascii_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outbox() -> (mpsc::Sender<ServerMessage>, mpsc::Receiver<ServerMessage>) {
        mpsc::channel(8)
    }

    /// A clock the test moves by hand, shared by every connection.
    #[derive(Clone, Default)]
    struct FakeClock(Arc<Mutex<f64>>);

    impl FakeClock {
        fn set(&self, now_s: f64) {
            *self.0.lock().unwrap() = now_s;
        }

        fn reader(&self) -> impl Fn() -> f64 + Send + Sync + 'static {
            let now = Arc::clone(&self.0);
            move || *now.lock().unwrap()
        }
    }

    fn registry() -> (PairCodes, FakeClock) {
        let clock = FakeClock::default();
        let codes = PairCodes::with(os_random, clock.reader());
        (codes, clock)
    }

    #[test]
    fn codes_are_six_characters_from_the_alphabet() {
        let (codes, _) = registry();
        let (tx, _rx) = outbox();
        let code = codes.offer("key".into(), "Tablet".into(), tx, None);
        assert_eq!(code.len(), 6);
        assert!(code.bytes().all(|b| PAIR_ALPHABET.contains(&b)));
    }

    #[test]
    fn a_code_claims_its_key_and_name_once() {
        let (codes, _) = registry();
        let (tx, mut rx) = outbox();
        let code = codes.offer("key".into(), "Tablet".into(), tx, None);
        assert_eq!(codes.claim(&code), Some(("key".to_owned(), "Tablet".to_owned())));
        assert_eq!(codes.claim(&code), None);
        assert!(matches!(rx.try_recv(), Ok(ServerMessage::PairClaimed)));
    }

    #[test]
    fn a_code_expires_after_five_minutes() {
        let (codes, clock) = registry();
        let (tx, _rx) = outbox();
        let early = codes.offer("key".into(), "Tablet".into(), tx.clone(), None);
        clock.set(299.9);
        assert!(codes.claim(&early).is_some());
        clock.set(0.0);
        let late = codes.offer("key".into(), "Tablet".into(), tx, None);
        clock.set(300.0);
        assert_eq!(codes.claim(&late), None);
    }

    #[test]
    fn expiry_follows_the_registry_clock_not_the_connections() {
        // The tablet offers, its connection closes; a phone connecting six
        // minutes later must not get the code, however young its connection is.
        let (codes, clock) = registry();
        let (tx, _rx) = outbox();
        clock.set(1_000.0);
        let code = codes.offer("key".into(), "Tablet".into(), tx.clone(), None);
        clock.set(1_360.0);
        assert_eq!(codes.claim(&code), None);
        // And an offer from a long-lived connection does not sweep a fresh code.
        clock.set(2_000.0);
        let fresh = codes.offer("a".into(), "A".into(), tx.clone(), None);
        clock.set(2_010.0);
        codes.offer("b".into(), "B".into(), tx, None);
        assert!(codes.claim(&fresh).is_some());
    }

    #[test]
    fn a_new_offer_replaces_the_old_code() {
        let (codes, _) = registry();
        let (tx, _rx) = outbox();
        let first = codes.offer("key".into(), "Tablet".into(), tx.clone(), None);
        let second = codes.offer("key".into(), "Tablet".into(), tx, Some(&first));
        assert_eq!(codes.claim(&first), None);
        assert!(codes.claim(&second).is_some());
    }

    #[test]
    fn claims_ignore_case_and_spaces() {
        let (codes, _) = registry();
        let (tx, _rx) = outbox();
        let code = codes.offer("key".into(), "Tablet".into(), tx, None);
        let sloppy = format!("  {}  ", code.to_lowercase());
        assert!(codes.claim(&sloppy).is_some());
    }

    #[test]
    fn codes_do_not_repeat_while_live() {
        // Byte 0 maps to 'A', byte 1 to 'B'. The first six bytes give "AAAAAA";
        // the next six repeat it, so the second offer must fall through to "BBBBBB".
        let mut bytes = std::iter::repeat_n(0u8, 12).chain(std::iter::repeat(1u8));
        let codes = PairCodes::with(move || bytes.next().expect("endless byte stream"), || 0.0);
        let (tx, _rx) = outbox();
        let first = codes.offer("a".into(), "A".into(), tx.clone(), None);
        let second = codes.offer("b".into(), "B".into(), tx, None);
        assert_eq!(first, "AAAAAA");
        assert_eq!(second, "BBBBBB");
    }
}
