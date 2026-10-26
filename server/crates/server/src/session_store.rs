//! Strava logins on disk, so they survive a restart or a deploy (ADR 0008).
//!
//! SQLite in `OPENRADLR_DATA_DIR`. A leaked database must not give out working
//! cookies or Strava access: session ids are stored only as SHA-256 hashes and
//! the refresh tokens are AES-256-GCM encrypted with a key derived from
//! `OPENRADLR_SECRET_KEY`. Access tokens are not stored; a restored session
//! fetches a fresh one with its refresh token on first use.

use crate::secure_random::random_bytes;
use crate::strava::Account;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::path::Path;
use std::sync::Mutex;

const NONCE_LEN: usize = 12;

#[derive(Debug)]
pub struct StoreError(pub String);

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        StoreError(error.to_string())
    }
}

/// A session as saved: the account (without its access token) and its age.
pub struct StoredSession {
    pub id_hash: String,
    pub account: Account,
    pub created_s: i64,
}

pub struct SessionStore {
    conn: Mutex<Connection>,
    cipher: Aes256Gcm,
}

/// Hex SHA-256 of a session id: what the maps and the database are keyed by.
pub fn hash_id(session_id: &str) -> String {
    let digest = Sha256::digest(session_id.as_bytes());
    digest.iter().fold(String::with_capacity(64), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

impl SessionStore {
    /// Opens (and creates) `<data_dir>/openradlr.db`.
    pub fn open(data_dir: &Path, secret_key: &str) -> Result<Self, StoreError> {
        std::fs::create_dir_all(data_dir)
            .map_err(|e| StoreError(format!("cannot create {}: {e}", data_dir.display())))?;
        Self::with_connection(Connection::open(data_dir.join("openradlr.db"))?, secret_key)
    }

    fn with_connection(conn: Connection, secret_key: &str) -> Result<Self, StoreError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS strava_sessions (
                id_hash TEXT PRIMARY KEY,
                athlete_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                can_upload INTEGER NOT NULL,
                refresh_token BLOB NOT NULL,
                created_s INTEGER NOT NULL
            );",
        )?;
        let key = Sha256::digest(format!("openradlr strava sessions\n{secret_key}"));
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| StoreError(e.to_string()))?;
        Ok(Self {
            conn: Mutex::new(conn),
            cipher,
        })
    }

    fn encrypt(&self, text: &str) -> Result<Vec<u8>, StoreError> {
        let mut nonce = [0u8; NONCE_LEN];
        random_bytes(&mut nonce);
        let sealed = self
            .cipher
            .encrypt(&Nonce::from(nonce), text.as_bytes())
            .map_err(|_| StoreError("encryption failed".into()))?;
        Ok([nonce.as_slice(), &sealed].concat())
    }

    fn decrypt(&self, blob: &[u8]) -> Option<String> {
        let (nonce, sealed) = blob.split_at_checked(NONCE_LEN)?;
        let nonce = Nonce::try_from(nonce).ok()?;
        let plain = self.cipher.decrypt(&nonce, sealed).ok()?;
        String::from_utf8(plain).ok()
    }

    /// Inserts or replaces a session.
    pub fn save(&self, id_hash: &str, account: &Account, created_s: i64) -> Result<(), StoreError> {
        let sealed = self.encrypt(&account.refresh_token)?;
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT OR REPLACE INTO strava_sessions (id_hash, athlete_id, name, can_upload, refresh_token, created_s)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id_hash,
                i64::try_from(account.athlete_id).unwrap_or(i64::MAX),
                account.name,
                account.can_upload,
                sealed,
                created_s
            ],
        )?;
        Ok(())
    }

    pub fn remove(&self, id_hash: &str) -> Result<(), StoreError> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM strava_sessions WHERE id_hash = ?1", params![id_hash])?;
        Ok(())
    }

    /// Deletes sessions created before `cutoff_s`.
    pub fn remove_older_than(&self, cutoff_s: i64) -> Result<(), StoreError> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM strava_sessions WHERE created_s < ?1", params![cutoff_s])?;
        Ok(())
    }

    /// Every saved session. Rows that don't decrypt (the key changed) are
    /// dropped: those riders connect again.
    pub fn load(&self) -> Result<Vec<StoredSession>, StoreError> {
        let rows: Vec<(String, i64, String, bool, Vec<u8>, i64)> = {
            let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
            let mut statement = conn.prepare(
                "SELECT id_hash, athlete_id, name, can_upload, refresh_token, created_s FROM strava_sessions",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })?;
            rows.collect::<Result<_, _>>()?
        };
        let mut sessions = Vec::new();
        for (id_hash, athlete_id, name, can_upload, sealed, created_s) in rows {
            match (self.decrypt(&sealed), u64::try_from(athlete_id)) {
                (Some(refresh_token), Ok(athlete_id)) => sessions.push(StoredSession {
                    id_hash,
                    account: Account {
                        athlete_id,
                        name,
                        can_upload,
                        access_token: String::new(),
                        refresh_token,
                        // Already expired: the first use refreshes it.
                        expires_at: 0,
                    },
                    created_s,
                }),
                _ => {
                    let _ = self.remove(&id_hash);
                }
            }
        }
        Ok(sessions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_hashes_are_plain_hex_sha256_so_stored_sessions_survive_upgrades() {
        assert_eq!(
            hash_id("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    fn account() -> Account {
        Account {
            athlete_id: 7,
            name: "Leon F.".into(),
            can_upload: true,
            access_token: "live".into(),
            refresh_token: "refresh-secret".into(),
            expires_at: 9_999_999_999,
        }
    }

    fn store(key: &str) -> SessionStore {
        SessionStore::with_connection(Connection::open_in_memory().unwrap(), key).unwrap()
    }

    #[test]
    fn sessions_round_trip_without_the_access_token() {
        let store = store("k");
        store.save(&hash_id("abc"), &account(), 100).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id_hash, hash_id("abc"));
        assert_eq!(loaded[0].created_s, 100);
        assert_eq!(loaded[0].account.refresh_token, "refresh-secret");
        assert!(loaded[0].account.needs_refresh(0), "restored sessions refresh first");
        assert!(loaded[0].account.access_token.is_empty());
    }

    #[test]
    fn secrets_are_not_stored_in_the_clear() {
        let store = store("k");
        store.save(&hash_id("abc"), &account(), 100).unwrap();
        let conn = store.conn.lock().unwrap();
        let (id, blob): (String, Vec<u8>) = conn
            .query_row("SELECT id_hash, refresh_token FROM strava_sessions", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_ne!(id, "abc");
        assert_eq!(id.len(), 64);
        assert!(!String::from_utf8_lossy(&blob).contains("refresh-secret"));
    }

    #[test]
    fn a_changed_key_drops_the_sessions() {
        let store = store("one");
        store.save(&hash_id("abc"), &account(), 100).unwrap();
        let sealed: Vec<u8> = store
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT refresh_token FROM strava_sessions", [], |r| r.get(0))
            .unwrap();
        let other = SessionStore::with_connection(Connection::open_in_memory().unwrap(), "two").unwrap();
        assert!(other.decrypt(&sealed).is_none());
        assert!(store.decrypt(&sealed).is_some());
    }

    #[test]
    fn removing_and_expiring() {
        let store = store("k");
        store.save("a", &account(), 10).unwrap();
        store.save("b", &account(), 20).unwrap();
        store.remove("a").unwrap();
        assert_eq!(store.load().unwrap().len(), 1);
        store.remove_older_than(30).unwrap();
        assert!(store.load().unwrap().is_empty());
    }
}
