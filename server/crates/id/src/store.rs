//! Accounts, sessions, passkeys, linked riders and their backups in SQLite.
//!
//! Session ids are stored as SHA-256 hashes and email codes as HMACs (see
//! [`crate::email`]), so the file holds nothing that signs anyone in. Deleting
//! an account deletes everything stored for it (foreign keys with cascade).

use crate::webauthn::Credential;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest as _, Sha256};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

const SCHEMA: &str = "
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_s INTEGER NOT NULL
);
DROP TABLE IF EXISTS email_codes;
CREATE TABLE IF NOT EXISTS sign_in_codes (
    email TEXT NOT NULL,
    code_mac BLOB NOT NULL,
    expires_s INTEGER NOT NULL,
    attempts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_codes_email ON sign_in_codes (email);
CREATE TABLE IF NOT EXISTS sessions (
    id_hash BLOB PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_s INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
    credential_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    sign_count INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_s INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS riders (
    rider_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    name TEXT NOT NULL,
    linked_s INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
    rider_id TEXT PRIMARY KEY REFERENCES riders(rider_id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    updated_s INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rides (
    rider_id TEXT NOT NULL REFERENCES riders(rider_id) ON DELETE CASCADE,
    ride_id TEXT NOT NULL,
    body TEXT NOT NULL,
    stored_s INTEGER NOT NULL,
    PRIMARY KEY (rider_id, ride_id)
);
";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub created_s: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailCode {
    pub code_mac: Vec<u8>,
    pub expires_s: i64,
    pub attempts: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasskeyInfo {
    pub id: String,
    pub name: String,
    pub created_s: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiderInfo {
    pub rider_id: String,
    pub name: String,
    pub linked_s: i64,
    pub rides: u32,
    /// When the snapshot was last replaced; `None` before the first backup.
    pub snapshot_s: Option<i64>,
}

#[derive(Debug)]
pub struct StoreError(pub rusqlite::Error);

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "account store: {}", self.0)
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self(error)
    }
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// Codes kept per address at once.
pub const MAX_CODES: u32 = 5;

fn account_bytes(db: &Connection, account_id: &str) -> Result<u64> {
    let bytes: i64 = db.query_row(
        "SELECT
           COALESCE((SELECT SUM(length(x.body)) FROM rides x JOIN riders r ON r.rider_id = x.rider_id WHERE r.account_id = ?1), 0)
         + COALESCE((SELECT SUM(length(x.body)) FROM snapshots x JOIN riders r ON r.rider_id = x.rider_id WHERE r.account_id = ?1), 0)",
        [account_id],
        |row| row.get(0),
    )?;
    Ok(u64::try_from(bytes).unwrap_or(0))
}

fn session_hash(session_id: &str) -> Vec<u8> {
    Sha256::digest(session_id.as_bytes()).to_vec()
}

pub struct Store {
    db: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        Self::with(Connection::open(path)?)
    }

    pub fn in_memory() -> Result<Self> {
        Self::with(Connection::open_in_memory()?)
    }

    fn with(db: Connection) -> Result<Self> {
        db.execute_batch(SCHEMA)?;
        Ok(Self { db: Mutex::new(db) })
    }

    fn db(&self) -> MutexGuard<'_, Connection> {
        // A panic while holding the lock leaves SQLite consistent (each call is one statement
        // or one transaction), so the poisoned guard is still safe to use.
        self.db.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    // --- accounts ---

    pub fn account_by_email(&self, email: &str) -> Result<Option<Account>> {
        Ok(self
            .db()
            .query_row(
                "SELECT id, email, created_s FROM accounts WHERE email = ?1",
                [email],
                |row| {
                    Ok(Account {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        created_s: row.get(2)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn account(&self, id: &str) -> Result<Option<Account>> {
        Ok(self
            .db()
            .query_row("SELECT id, email, created_s FROM accounts WHERE id = ?1", [id], |row| {
                Ok(Account {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    created_s: row.get(2)?,
                })
            })
            .optional()?)
    }

    pub fn create_account(&self, id: &str, email: &str, now_s: i64) -> Result<Account> {
        self.db().execute(
            "INSERT INTO accounts (id, email, created_s) VALUES (?1, ?2, ?3)",
            params![id, email, now_s],
        )?;
        Ok(Account {
            id: id.to_owned(),
            email: email.to_owned(),
            created_s: now_s,
        })
    }

    /// Deletes the account with its sessions, passkeys, riders and backups.
    pub fn delete_account(&self, id: &str) -> Result<()> {
        self.db().execute("DELETE FROM accounts WHERE id = ?1", [id])?;
        Ok(())
    }

    // --- email codes ---

    /// Adds a code for `email`. Earlier ones stay valid (a stranger asking for codes can't
    /// void the rider's), but only the newest [`MAX_CODES`] are kept.
    pub fn put_code(&self, email: &str, code_mac: &[u8], expires_s: i64) -> Result<()> {
        let db = self.db();
        db.execute(
            "INSERT INTO sign_in_codes (email, code_mac, expires_s, attempts) VALUES (?1, ?2, ?3, 0)",
            params![email, code_mac, expires_s],
        )?;
        db.execute(
            "DELETE FROM sign_in_codes WHERE email = ?1 AND rowid NOT IN
               (SELECT rowid FROM sign_in_codes WHERE email = ?1 ORDER BY rowid DESC LIMIT ?2)",
            params![email, MAX_CODES],
        )?;
        Ok(())
    }

    /// Every code stored for `email`, expired ones included.
    pub fn codes(&self, email: &str) -> Result<Vec<EmailCode>> {
        let db = self.db();
        let mut statement =
            db.prepare("SELECT code_mac, expires_s, attempts FROM sign_in_codes WHERE email = ?1 ORDER BY rowid")?;
        let rows = statement.query_map([email], |row| {
            Ok(EmailCode {
                code_mac: row.get(0)?,
                expires_s: row.get(1)?,
                attempts: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Counts a wrong code against every code of `email`; codes out of tries are dropped.
    pub fn count_failed_code(&self, email: &str, max_attempts: u32) -> Result<()> {
        let db = self.db();
        db.execute(
            "UPDATE sign_in_codes SET attempts = attempts + 1 WHERE email = ?1",
            [email],
        )?;
        db.execute(
            "DELETE FROM sign_in_codes WHERE email = ?1 AND attempts >= ?2",
            params![email, max_attempts],
        )?;
        Ok(())
    }

    pub fn delete_codes(&self, email: &str) -> Result<()> {
        self.db()
            .execute("DELETE FROM sign_in_codes WHERE email = ?1", [email])?;
        Ok(())
    }

    // --- sessions ---

    pub fn create_session(&self, session_id: &str, account_id: &str, expires_s: i64) -> Result<()> {
        self.db().execute(
            "INSERT INTO sessions (id_hash, account_id, expires_s) VALUES (?1, ?2, ?3)",
            params![session_hash(session_id), account_id, expires_s],
        )?;
        Ok(())
    }

    /// The account a live session belongs to.
    pub fn session_account(&self, session_id: &str, now_s: i64) -> Result<Option<Account>> {
        Ok(self
            .db()
            .query_row(
                "SELECT a.id, a.email, a.created_s FROM sessions s JOIN accounts a ON a.id = s.account_id
                 WHERE s.id_hash = ?1 AND s.expires_s > ?2",
                params![session_hash(session_id), now_s],
                |row| {
                    Ok(Account {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        created_s: row.get(2)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        self.db()
            .execute("DELETE FROM sessions WHERE id_hash = ?1", [session_hash(session_id)])?;
        Ok(())
    }

    /// Drops expired sessions and codes.
    pub fn prune(&self, now_s: i64) -> Result<()> {
        let db = self.db();
        db.execute("DELETE FROM sessions WHERE expires_s <= ?1", [now_s])?;
        db.execute("DELETE FROM sign_in_codes WHERE expires_s <= ?1", [now_s])?;
        Ok(())
    }

    // --- passkeys ---

    pub fn add_passkey(&self, account_id: &str, credential: &Credential, name: &str, now_s: i64) -> Result<()> {
        self.db().execute(
            "INSERT INTO passkeys (credential_id, account_id, public_key, sign_count, name, created_s)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                credential.id,
                account_id,
                credential.public_key,
                credential.sign_count,
                name,
                now_s
            ],
        )?;
        Ok(())
    }

    /// A passkey and the account it signs in to.
    pub fn passkey(&self, credential_id: &str) -> Result<Option<(String, Credential)>> {
        Ok(self
            .db()
            .query_row(
                "SELECT account_id, credential_id, public_key, sign_count FROM passkeys WHERE credential_id = ?1",
                [credential_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        Credential {
                            id: row.get(1)?,
                            public_key: row.get(2)?,
                            sign_count: row.get(3)?,
                        },
                    ))
                },
            )
            .optional()?)
    }

    pub fn set_sign_count(&self, credential_id: &str, sign_count: u32) -> Result<()> {
        self.db().execute(
            "UPDATE passkeys SET sign_count = ?2 WHERE credential_id = ?1",
            params![credential_id, sign_count],
        )?;
        Ok(())
    }

    pub fn passkeys(&self, account_id: &str) -> Result<Vec<PasskeyInfo>> {
        let db = self.db();
        let mut statement =
            db.prepare("SELECT credential_id, name, created_s FROM passkeys WHERE account_id = ?1 ORDER BY created_s")?;
        let rows = statement.query_map([account_id], |row| {
            Ok(PasskeyInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                created_s: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Removes one of the account's passkeys; false if it has no such passkey.
    pub fn delete_passkey(&self, account_id: &str, credential_id: &str) -> Result<bool> {
        Ok(self.db().execute(
            "DELETE FROM passkeys WHERE account_id = ?1 AND credential_id = ?2",
            params![account_id, credential_id],
        )? > 0)
    }

    // --- riders and backups ---

    /// Links a rider key to the account. A key linked to another account moves here
    /// with its backups: whoever holds the key decides where it belongs.
    pub fn link_rider(&self, account_id: &str, rider_id: &str, public_key: &str, name: &str, now_s: i64) -> Result<()> {
        self.db().execute(
            "INSERT INTO riders (rider_id, account_id, public_key, name, linked_s) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (rider_id) DO UPDATE SET account_id = ?2, name = ?4, linked_s = ?5",
            params![rider_id, account_id, public_key, name, now_s],
        )?;
        Ok(())
    }

    pub fn rider_belongs_to(&self, account_id: &str, rider_id: &str) -> Result<bool> {
        Ok(self
            .db()
            .query_row(
                "SELECT 1 FROM riders WHERE rider_id = ?1 AND account_id = ?2",
                params![rider_id, account_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    pub fn riders(&self, account_id: &str) -> Result<Vec<RiderInfo>> {
        let db = self.db();
        let mut statement = db.prepare(
            "SELECT r.rider_id, r.name, r.linked_s,
                    (SELECT COUNT(*) FROM rides WHERE rides.rider_id = r.rider_id),
                    (SELECT updated_s FROM snapshots WHERE snapshots.rider_id = r.rider_id)
             FROM riders r WHERE r.account_id = ?1 ORDER BY r.linked_s",
        )?;
        let rows = statement.query_map([account_id], |row| {
            Ok(RiderInfo {
                rider_id: row.get(0)?,
                name: row.get(1)?,
                linked_s: row.get(2)?,
                rides: row.get(3)?,
                snapshot_s: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn put_snapshot(&self, rider_id: &str, body: &str, now_s: i64) -> Result<()> {
        self.db().execute(
            "INSERT OR REPLACE INTO snapshots (rider_id, body, updated_s) VALUES (?1, ?2, ?3)",
            params![rider_id, body, now_s],
        )?;
        Ok(())
    }

    pub fn snapshot(&self, rider_id: &str) -> Result<Option<String>> {
        Ok(self
            .db()
            .query_row("SELECT body FROM snapshots WHERE rider_id = ?1", [rider_id], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn ride_ids(&self, rider_id: &str) -> Result<Vec<String>> {
        let db = self.db();
        let mut statement = db.prepare("SELECT ride_id FROM rides WHERE rider_id = ?1 ORDER BY ride_id")?;
        let rows = statement.query_map([rider_id], |row| row.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn ride_count(&self, rider_id: &str) -> Result<u32> {
        Ok(self
            .db()
            .query_row("SELECT COUNT(*) FROM rides WHERE rider_id = ?1", [rider_id], |row| {
                row.get(0)
            })?)
    }

    /// Bytes the account's backups take: every snapshot and ride of its riders.
    pub fn account_bytes(&self, account_id: &str) -> Result<u64> {
        account_bytes(&self.db(), account_id)
    }

    /// Bytes a rider's backups take (its snapshot and rides).
    pub fn rider_bytes(&self, rider_id: &str) -> Result<u64> {
        let bytes: i64 = self.db().query_row(
            "SELECT COALESCE((SELECT SUM(length(body)) FROM rides WHERE rider_id = ?1), 0)
                  + COALESCE((SELECT length(body) FROM snapshots WHERE rider_id = ?1), 0)",
            [rider_id],
            |row| row.get(0),
        )?;
        Ok(u64::try_from(bytes).unwrap_or(0))
    }

    /// Stores a ride unless the account would go over `quota` bytes; checked and written under
    /// one lock, so parallel uploads can't both slip under the limit. False when refused.
    pub fn put_ride_within(
        &self,
        account_id: &str,
        rider_id: &str,
        ride_id: &str,
        body: &str,
        now_s: i64,
        quota: u64,
    ) -> Result<bool> {
        let db = self.db();
        let replaced: i64 = db
            .query_row(
                "SELECT length(body) FROM rides WHERE rider_id = ?1 AND ride_id = ?2",
                params![rider_id, ride_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0);
        if account_bytes(&db, account_id)?.saturating_sub(replaced as u64) + body.len() as u64 > quota {
            return Ok(false);
        }
        db.execute(
            "INSERT OR REPLACE INTO rides (rider_id, ride_id, body, stored_s) VALUES (?1, ?2, ?3, ?4)",
            params![rider_id, ride_id, body, now_s],
        )?;
        Ok(true)
    }

    /// Replaces a snapshot unless the account would go over `quota` bytes (see [`Self::put_ride_within`]).
    pub fn put_snapshot_within(
        &self,
        account_id: &str,
        rider_id: &str,
        body: &str,
        now_s: i64,
        quota: u64,
    ) -> Result<bool> {
        let db = self.db();
        let replaced: i64 = db
            .query_row(
                "SELECT length(body) FROM snapshots WHERE rider_id = ?1",
                [rider_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0);
        if account_bytes(&db, account_id)?.saturating_sub(replaced as u64) + body.len() as u64 > quota {
            return Ok(false);
        }
        db.execute(
            "INSERT OR REPLACE INTO snapshots (rider_id, body, updated_s) VALUES (?1, ?2, ?3)",
            params![rider_id, body, now_s],
        )?;
        Ok(true)
    }

    pub fn put_ride(&self, rider_id: &str, ride_id: &str, body: &str, now_s: i64) -> Result<()> {
        self.db().execute(
            "INSERT OR REPLACE INTO rides (rider_id, ride_id, body, stored_s) VALUES (?1, ?2, ?3, ?4)",
            params![rider_id, ride_id, body, now_s],
        )?;
        Ok(())
    }

    pub fn ride(&self, rider_id: &str, ride_id: &str) -> Result<Option<String>> {
        Ok(self
            .db()
            .query_row(
                "SELECT body FROM rides WHERE rider_id = ?1 AND ride_id = ?2",
                params![rider_id, ride_id],
                |row| row.get(0),
            )
            .optional()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_with_anna() -> Store {
        let store = Store::in_memory().unwrap();
        store.create_account("a1", "anna@example.org", 10).unwrap();
        store
    }

    #[test]
    fn an_account_is_found_by_email_and_id() {
        let store = store_with_anna();
        assert_eq!(store.account_by_email("anna@example.org").unwrap().unwrap().id, "a1");
        assert_eq!(store.account("a1").unwrap().unwrap().email, "anna@example.org");
        assert_eq!(store.account_by_email("bert@example.org").unwrap(), None);
    }

    #[test]
    fn an_email_has_one_account() {
        let store = store_with_anna();
        assert!(store.create_account("a2", "anna@example.org", 11).is_err());
    }

    #[test]
    fn a_session_signs_in_until_it_expires() {
        let store = store_with_anna();
        store.create_session("s1", "a1", 100).unwrap();
        assert_eq!(store.session_account("s1", 99).unwrap().unwrap().id, "a1");
        assert_eq!(store.session_account("s1", 100).unwrap(), None);
        assert_eq!(store.session_account("s2", 0).unwrap(), None);
    }

    #[test]
    fn session_ids_are_stored_hashed() {
        let store = store_with_anna();
        store.create_session("s1", "a1", 100).unwrap();
        let stored: Vec<u8> = store
            .db()
            .query_row("SELECT id_hash FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_ne!(stored, b"s1".to_vec());
        assert_eq!(stored.len(), 32);
    }

    #[test]
    fn a_new_code_keeps_the_earlier_ones_up_to_five() {
        let store = Store::in_memory().unwrap();
        for i in 0..7u8 {
            store.put_code("anna@example.org", &[i], 50).unwrap();
        }
        let macs: Vec<Vec<u8>> = store
            .codes("anna@example.org")
            .unwrap()
            .into_iter()
            .map(|c| c.code_mac)
            .collect();
        assert_eq!(macs, vec![vec![2], vec![3], vec![4], vec![5], vec![6]]);
    }

    #[test]
    fn wrong_codes_count_against_every_code_and_spent_ones_go() {
        let store = Store::in_memory().unwrap();
        store.put_code("anna@example.org", b"m1", 50).unwrap();
        store.count_failed_code("anna@example.org", 2).unwrap();
        store.put_code("anna@example.org", b"m2", 60).unwrap();
        store.count_failed_code("anna@example.org", 2).unwrap();
        let codes = store.codes("anna@example.org").unwrap();
        assert_eq!(
            (codes.len(), codes[0].code_mac.clone(), codes[0].attempts),
            (1, b"m2".to_vec(), 1)
        );
    }

    #[test]
    fn a_ride_over_the_quota_is_not_written() {
        let store = store_with_anna();
        store.link_rider("a1", "r1", "pk", "Anna", 20).unwrap();
        assert!(store.put_ride_within("a1", "r1", "1", "12345", 1, 8).unwrap());
        assert!(!store.put_ride_within("a1", "r1", "2", "12345", 1, 8).unwrap());
        assert!(store.put_ride_within("a1", "r1", "1", "1234567", 1, 8).unwrap());
        assert_eq!(store.ride_ids("r1").unwrap(), vec!["1".to_owned()]);
        assert_eq!(store.rider_bytes("r1").unwrap(), 7);
    }

    #[test]
    fn pruning_drops_expired_sessions_and_codes() {
        let store = store_with_anna();
        store.create_session("old", "a1", 5).unwrap();
        store.create_session("new", "a1", 500).unwrap();
        store.put_code("anna@example.org", b"m", 5).unwrap();
        store.prune(10).unwrap();
        assert_eq!(store.session_account("new", 10).unwrap().unwrap().id, "a1");
        assert!(store.codes("anna@example.org").unwrap().is_empty());
        let sessions: u32 = store
            .db()
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(sessions, 1);
    }

    #[test]
    fn a_rider_is_backed_up_and_listed() {
        let store = store_with_anna();
        store.link_rider("a1", "r1", "pk", "Anna", 20).unwrap();
        store.put_snapshot("r1", "{}", 21).unwrap();
        store.put_ride("r1", "100", "{\"km\":1}", 22).unwrap();
        store.put_ride("r1", "100", "{\"km\":2}", 23).unwrap();
        assert_eq!(store.ride_ids("r1").unwrap(), vec!["100".to_owned()]);
        assert_eq!(store.ride("r1", "100").unwrap().as_deref(), Some("{\"km\":2}"));
        let riders = store.riders("a1").unwrap();
        assert_eq!((riders[0].rides, riders[0].snapshot_s), (1, Some(21)));
    }

    #[test]
    fn a_rider_key_moves_to_the_account_that_links_it() {
        let store = store_with_anna();
        store.create_account("a2", "bert@example.org", 10).unwrap();
        store.link_rider("a1", "r1", "pk", "Anna", 20).unwrap();
        store.link_rider("a2", "r1", "pk", "Anna", 30).unwrap();
        assert!(!store.rider_belongs_to("a1", "r1").unwrap());
        assert!(store.rider_belongs_to("a2", "r1").unwrap());
    }

    #[test]
    fn an_accounts_bytes_add_up_over_its_riders_and_no_one_elses() {
        let store = store_with_anna();
        store.create_account("a2", "bert@example.org", 10).unwrap();
        store.link_rider("a1", "r1", "pk1", "Anna", 20).unwrap();
        store.link_rider("a1", "r2", "pk2", "Anna 2", 20).unwrap();
        store.link_rider("a2", "r3", "pk3", "Bert", 20).unwrap();
        store.put_snapshot("r1", "12345", 21).unwrap();
        store.put_ride("r1", "1", "123", 22).unwrap();
        store.put_ride("r2", "1", "12", 22).unwrap();
        store.put_ride("r3", "1", "1234567890", 22).unwrap();
        assert_eq!(store.account_bytes("a1").unwrap(), 10);
        assert_eq!(store.account_bytes("nobody").unwrap(), 0);
        assert_eq!(
            (store.rider_bytes("r1").unwrap(), store.rider_bytes("r2").unwrap()),
            (8, 2)
        );
    }

    #[test]
    fn deleting_an_account_deletes_everything_stored_for_it() {
        let store = store_with_anna();
        store.create_session("s1", "a1", 100).unwrap();
        store.link_rider("a1", "r1", "pk", "Anna", 20).unwrap();
        store.put_snapshot("r1", "{}", 21).unwrap();
        store.put_ride("r1", "100", "{}", 22).unwrap();
        store.delete_account("a1").unwrap();
        assert_eq!(store.session_account("s1", 0).unwrap(), None);
        assert_eq!(store.snapshot("r1").unwrap(), None);
        assert_eq!(store.ride_ids("r1").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn a_passkey_is_found_by_its_id_and_deleted_only_by_its_account() {
        let store = store_with_anna();
        let credential = Credential {
            id: "c1".into(),
            public_key: vec![1, 2],
            sign_count: 0,
        };
        store.add_passkey("a1", &credential, "Laptop", 30).unwrap();
        assert_eq!(store.passkey("c1").unwrap(), Some(("a1".into(), credential)));
        store.set_sign_count("c1", 4).unwrap();
        assert_eq!(store.passkey("c1").unwrap().unwrap().1.sign_count, 4);
        assert!(!store.delete_passkey("other", "c1").unwrap());
        assert!(store.delete_passkey("a1", "c1").unwrap());
        assert!(store.passkeys("a1").unwrap().is_empty());
    }
}
