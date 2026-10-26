//! Riders whose connection dropped: the token that brings them back, and how
//! long they are kept (#73). A game detaches a rider when the socket dies and
//! removes them only after the grace period, so a quick reconnect resumes the
//! same rider.

use crate::secure_random::random_token;
use openradlr_sim::RiderId;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// The server-wide registry of resume tokens: which world holds the rider a
/// token brings back. Cloning shares the registry.
#[derive(Debug, Clone, Default)]
pub struct ResumeTokens {
    tokens: Arc<Mutex<HashMap<String, String>>>,
}

impl ResumeTokens {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.tokens.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn insert(&self, token: &str, world_id: &str) {
        self.lock().insert(token.to_owned(), world_id.to_owned());
    }

    pub fn remove(&self, token: &str) {
        self.lock().remove(token);
    }

    pub fn world_of(&self, token: &str) -> Option<String> {
        self.lock().get(token).cloned()
    }
}

/// A rider handed to a connection. The `epoch` changes with every attach, so
/// a connection that died after its rider was taken over can't touch them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JoinedRider {
    pub rider_id: RiderId,
    pub epoch: u64,
}

struct Entry {
    token: String,
    epoch: u64,
    /// Game time the connection dropped; `None` while attached.
    detached_at: Option<f64>,
}

/// One game's riders: their tokens, current epochs and who is detached.
pub struct Attachments {
    grace_s: f64,
    registry: ResumeTokens,
    world_id: String,
    riders: HashMap<RiderId, Entry>,
    by_token: HashMap<String, RiderId>,
    last_epoch: u64,
}

impl Attachments {
    pub fn new(grace_s: f64, registry: ResumeTokens, world_id: String) -> Self {
        Self {
            grace_s,
            registry,
            world_id,
            riders: HashMap::new(),
            by_token: HashMap::new(),
            last_epoch: 0,
        }
    }

    /// Shares `registry` with the other games; `world_id` is this game's name there.
    pub fn set_registry(&mut self, registry: ResumeTokens, world_id: String) {
        self.registry = registry;
        self.world_id = world_id;
    }

    pub fn grace_s(&self) -> f64 {
        self.grace_s
    }

    fn next_epoch(&mut self) -> u64 {
        self.last_epoch += 1;
        self.last_epoch
    }

    /// A rider who just joined: a fresh token and epoch.
    pub fn attach(&mut self, rider_id: RiderId) -> (String, u64) {
        let token = random_token();
        let epoch = self.next_epoch();
        self.registry.insert(&token, &self.world_id);
        self.by_token.insert(token.clone(), rider_id);
        self.riders.insert(
            rider_id,
            Entry {
                token: token.clone(),
                epoch,
                detached_at: None,
            },
        );
        (token, epoch)
    }

    /// Hands the rider of `token` to a new connection, detached or not (a
    /// second tab takes over).
    pub fn reattach(&mut self, token: &str) -> Option<JoinedRider> {
        let rider_id = *self.by_token.get(token)?;
        let epoch = self.next_epoch();
        let entry = self.riders.get_mut(&rider_id)?;
        entry.epoch = epoch;
        entry.detached_at = None;
        Some(JoinedRider { rider_id, epoch })
    }

    pub fn is_current(&self, rider_id: RiderId, epoch: u64) -> bool {
        self.riders.get(&rider_id).is_some_and(|entry| entry.epoch == epoch)
    }

    pub fn detach(&mut self, rider_id: RiderId, now_s: f64) {
        if let Some(entry) = self.riders.get_mut(&rider_id) {
            entry.detached_at.get_or_insert(now_s);
        }
    }

    pub fn is_detached(&self, rider_id: RiderId) -> bool {
        self.riders
            .get(&rider_id)
            .is_some_and(|entry| entry.detached_at.is_some())
    }

    /// Riders kept for the grace period; they hold no place under the player cap.
    pub fn detached_count(&self) -> usize {
        self.riders.values().filter(|entry| entry.detached_at.is_some()).count()
    }

    /// Riders detached for longer than the grace period.
    pub fn expired(&self, now_s: f64) -> Vec<RiderId> {
        self.riders
            .iter()
            .filter(|(_, entry)| entry.detached_at.is_some_and(|at| now_s - at > self.grace_s))
            .map(|(&id, _)| id)
            .collect()
    }

    pub fn token_of(&self, rider_id: RiderId) -> Option<&str> {
        self.riders.get(&rider_id).map(|entry| entry.token.as_str())
    }

    /// The rider is gone for good: their token stops working everywhere.
    pub fn forget(&mut self, rider_id: RiderId) {
        if let Some(entry) = self.riders.remove(&rider_id) {
            self.by_token.remove(&entry.token);
            self.registry.remove(&entry.token);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attachments() -> (Attachments, ResumeTokens) {
        let registry = ResumeTokens::new();
        (Attachments::new(60.0, registry.clone(), "w".into()), registry)
    }

    #[test]
    fn attach_registers_the_token() {
        let (mut book, registry) = attachments();
        let (token, _) = book.attach(7);
        assert_eq!(token.len(), 64);
        assert_eq!(registry.world_of(&token).as_deref(), Some("w"));
        assert_eq!(book.token_of(7), Some(token.as_str()));
    }

    #[test]
    fn reattach_returns_the_rider_with_a_new_epoch() {
        let (mut book, _) = attachments();
        let (token, e1) = book.attach(7);
        book.detach(7, 0.0);
        assert!(book.is_detached(7));
        let joined = book.reattach(&token).unwrap();
        assert_eq!(joined.rider_id, 7);
        assert_ne!(joined.epoch, e1);
        assert!(!book.is_current(7, e1));
        assert!(book.is_current(7, joined.epoch));
        assert!(!book.is_detached(7));
    }

    #[test]
    fn unknown_token_is_none() {
        let (mut book, _) = attachments();
        book.attach(7);
        assert_eq!(book.reattach("nope"), None);
    }

    #[test]
    fn expiry_waits_for_the_grace_period() {
        let (mut book, _) = attachments();
        book.attach(7);
        book.attach(8);
        book.detach(7, 10.0);
        assert_eq!(book.detached_count(), 1);
        assert!(book.expired(70.0).is_empty());
        assert_eq!(book.expired(70.1), vec![7]);
    }

    #[test]
    fn forget_frees_the_token() {
        let (mut book, registry) = attachments();
        let (token, _) = book.attach(7);
        book.forget(7);
        assert_eq!(book.reattach(&token), None);
        assert_eq!(registry.world_of(&token), None);
        assert_eq!(book.token_of(7), None);
    }
}
