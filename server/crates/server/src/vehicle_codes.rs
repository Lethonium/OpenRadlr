//! The server-wide registry of boarding codes: which world a vehicle's code
//! belongs to, so a code typed into another world can point there.

use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Code to world id. Cloning shares the registry.
#[derive(Debug, Clone, Default)]
pub struct VehicleCodes {
    codes: Arc<Mutex<HashMap<String, String>>>,
}

impl VehicleCodes {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.codes.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn insert(&self, code: &str, world_id: &str) {
        self.lock().insert(code.to_owned(), world_id.to_owned());
    }

    /// Claims `code` for `world_id` unless someone holds it already, in one
    /// step. True when this call claimed it.
    pub fn try_reserve(&self, code: &str, world_id: &str) -> bool {
        match self.lock().entry(code.to_owned()) {
            Entry::Occupied(_) => false,
            Entry::Vacant(slot) => {
                slot.insert(world_id.to_owned());
                true
            }
        }
    }

    /// Frees `code`, but only if `world_id` holds it.
    pub fn remove(&self, code: &str, world_id: &str) {
        let mut codes = self.lock();
        if codes.get(code).is_some_and(|owner| owner == world_id) {
            codes.remove(code);
        }
    }

    pub fn world_of(&self, code: &str) -> Option<String> {
        self.lock().get(code).cloned()
    }

    pub fn is_taken(&self, code: &str) -> bool {
        self.lock().contains_key(code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_lookup_remove() {
        let codes = VehicleCodes::new();
        assert_eq!(codes.world_of("ABC234"), None);
        assert!(!codes.is_taken("ABC234"));
        codes.insert("ABC234", "loop");
        assert_eq!(codes.world_of("ABC234").as_deref(), Some("loop"));
        assert!(codes.is_taken("ABC234"));
        // Clones share the registry.
        assert!(codes.clone().is_taken("ABC234"));
        codes.remove("ABC234", "loop");
        assert_eq!(codes.world_of("ABC234"), None);
    }

    #[test]
    fn try_reserve_claims_once() {
        let codes = VehicleCodes::new();
        assert!(codes.try_reserve("ABC234", "loop"));
        assert!(!codes.try_reserve("ABC234", "loop"));
        assert!(!codes.try_reserve("ABC234", "other"));
        assert_eq!(codes.world_of("ABC234").as_deref(), Some("loop"));
        // Inserting the owner's own code again stays idempotent.
        codes.insert("ABC234", "loop");
        assert_eq!(codes.world_of("ABC234").as_deref(), Some("loop"));
    }

    #[test]
    fn only_the_owner_removes() {
        let codes = VehicleCodes::new();
        codes.insert("ABC234", "loop");
        codes.remove("ABC234", "other");
        assert_eq!(codes.world_of("ABC234").as_deref(), Some("loop"));
        codes.remove("ABC234", "loop");
        assert_eq!(codes.world_of("ABC234"), None);
    }
}
