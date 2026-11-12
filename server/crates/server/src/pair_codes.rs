//! The registry of pairing codes: a second screen (a phone) shows a short code,
//! the tablet that owns the screen key claims it, and the phone is paired. A
//! code is valid for five minutes and works once.

use crate::protocol::ServerMessage;
use crate::secure_random::random_bytes;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
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
}

impl Default for PairCodes {
    fn default() -> Self {
        Self::new()
    }
}

impl PairCodes {
    /// A registry whose codes come from the operating system's random source.
    pub fn new() -> Self {
        Self::with_random(|| {
            let mut byte = [0u8; 1];
            random_bytes(&mut byte);
            byte[0]
        })
    }

    fn with_random(random: impl FnMut() -> u8 + Send + 'static) -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                codes: HashMap::new(),
                random: Box::new(random),
            })),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Issues a new code for the screen `key`, valid for [`PAIR_CODE_TTL_S`]
    /// from `now_s`. `replaces` is the screen's previous code, if any: it is
    /// withdrawn, but only when it belongs to `key`. Expired codes are swept.
    pub fn offer(
        &self,
        key: String,
        name: String,
        notify: mpsc::Sender<ServerMessage>,
        replaces: Option<&str>,
        now_s: f64,
    ) -> String {
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
    pub fn claim(&self, code: &str, now_s: f64) -> Option<(String, String)> {
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

    #[test]
    fn codes_are_six_characters_from_the_alphabet() {
        let codes = PairCodes::new();
        let (tx, _rx) = outbox();
        let code = codes.offer("key".into(), "Tablet".into(), tx, None, 0.0);
        assert_eq!(code.len(), 6);
        assert!(code.bytes().all(|b| PAIR_ALPHABET.contains(&b)));
    }

    #[test]
    fn a_code_claims_its_key_and_name_once() {
        let codes = PairCodes::new();
        let (tx, mut rx) = outbox();
        let code = codes.offer("key".into(), "Tablet".into(), tx, None, 0.0);
        assert_eq!(codes.claim(&code, 1.0), Some(("key".to_owned(), "Tablet".to_owned())));
        assert_eq!(codes.claim(&code, 2.0), None);
        assert!(matches!(rx.try_recv(), Ok(ServerMessage::PairClaimed)));
    }

    #[test]
    fn a_code_expires_after_five_minutes() {
        let codes = PairCodes::new();
        let (tx, _rx) = outbox();
        let early = codes.offer("key".into(), "Tablet".into(), tx.clone(), None, 0.0);
        assert!(codes.claim(&early, 299.9).is_some());
        let late = codes.offer("key".into(), "Tablet".into(), tx, None, 0.0);
        assert_eq!(codes.claim(&late, 300.0), None);
    }

    #[test]
    fn a_new_offer_replaces_the_old_code() {
        let codes = PairCodes::new();
        let (tx, _rx) = outbox();
        let first = codes.offer("key".into(), "Tablet".into(), tx.clone(), None, 0.0);
        let second = codes.offer("key".into(), "Tablet".into(), tx, Some(&first), 1.0);
        assert_eq!(codes.claim(&first, 2.0), None);
        assert!(codes.claim(&second, 2.0).is_some());
    }

    #[test]
    fn claims_ignore_case_and_spaces() {
        let codes = PairCodes::new();
        let (tx, _rx) = outbox();
        let code = codes.offer("key".into(), "Tablet".into(), tx, None, 0.0);
        let sloppy = format!("  {}  ", code.to_lowercase());
        assert!(codes.claim(&sloppy, 1.0).is_some());
    }

    #[test]
    fn codes_do_not_repeat_while_live() {
        // Byte 0 maps to 'A', byte 1 to 'B'. The first six bytes give "AAAAAA";
        // the next six repeat it, so the second offer must fall through to "BBBBBB".
        let mut bytes = std::iter::repeat_n(0u8, 12).chain(std::iter::repeat(1u8));
        let codes = PairCodes::with_random(move || bytes.next().expect("endless byte stream"));
        let (tx, _rx) = outbox();
        let first = codes.offer("a".into(), "A".into(), tx.clone(), None, 0.0);
        let second = codes.offer("b".into(), "B".into(), tx, None, 0.0);
        assert_eq!(first, "AAAAAA");
        assert_eq!(second, "BBBBBB");
    }
}
