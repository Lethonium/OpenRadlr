//! What the account endpoints do, apart from HTTP: sign-in by code or passkey,
//! sessions, linking rider keys and storing their backups.

use crate::deps::{code, token, Clock, Entropy};
use crate::email::{code_mac, code_matches, normalize};
use crate::limits::RateLimit;
use crate::mail::{render, Message};
use crate::mailer::{Language, Mailer};
use crate::rider_key;
use crate::store::{Account, PasskeyInfo, RiderInfo, Store, StoreError};
use crate::webauthn::{self, Expected};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex, MutexGuard};

/// How long an emailed code works.
pub const CODE_SECONDS: i64 = 10 * 60;
/// Wrong codes before the code is thrown away.
pub const CODE_ATTEMPTS: u32 = 5;
/// How long a sign-in lasts.
pub const SESSION_SECONDS: i64 = 180 * 24 * 3600;
/// How long a passkey or link challenge can be answered.
pub const CHALLENGE_SECONDS: i64 = 5 * 60;
/// Open passkey sign-in challenges held at once; the oldest gives way beyond this.
const MAX_OPEN_CHALLENGES: usize = 10_000;
/// Challenges one signed-in account holds at once (passkey registration, rider links).
const MAX_ACCOUNT_CHALLENGES: usize = 8;
/// Passkeys per account.
pub const MAX_PASSKEYS: usize = 20;
/// Riders per account.
pub const MAX_RIDERS: usize = 32;
/// Rides kept per rider.
pub const MAX_RIDES: u32 = 20_000;
/// What one account's backups may take in all (a ride is a few KB, so this is thousands of rides).
pub const ACCOUNT_QUOTA_BYTES: u64 = 50 * 1024 * 1024;
/// The longest rider name or passkey label.
const MAX_LABEL: usize = 64;

/// How the service is reached.
#[derive(Clone)]
pub struct Settings {
    /// The page's origin, e.g. `https://app.openradlr.com`: passkeys are bound to it and
    /// every state-changing request must come from it.
    pub origin: String,
    /// The origin's host (the WebAuthn RP ID).
    pub rp_id: String,
    /// The name passkey dialogs show.
    pub rp_name: String,
    /// Keys the code HMACs (`OPENRADLR_SECRET_KEY`).
    pub secret: Vec<u8>,
    /// Set `Secure` on the cookie (the origin is https).
    pub secure_cookies: bool,
    /// What one account's backups may take ([`ACCOUNT_QUOTA_BYTES`]).
    pub quota_bytes: u64,
}

impl Settings {
    /// Settings for `origin` (scheme, host and optional port), or `None` if it isn't one.
    pub fn for_origin(origin: &str, secret: Vec<u8>) -> Option<Self> {
        let origin = origin.trim_end_matches('/');
        let (scheme, rest) = origin.split_once("://")?;
        if !matches!(scheme, "http" | "https") || rest.is_empty() || rest.contains('/') {
            return None;
        }
        let host = match rest.rsplit_once(':') {
            Some((host, port)) if port.bytes().all(|b| b.is_ascii_digit()) => host,
            _ => rest,
        };
        Some(Self {
            origin: origin.to_owned(),
            rp_id: host.to_ascii_lowercase(),
            rp_name: "OpenRadlr".into(),
            secret,
            secure_cookies: scheme == "https",
            quota_bytes: ACCOUNT_QUOTA_BYTES,
        })
    }
}

/// Why a request failed; the HTTP layer maps each to a status and a code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdError {
    /// The request is malformed or not allowed; the code says what.
    BadRequest(&'static str),
    /// Not signed in, or the sign-in failed.
    Unauthorized(&'static str),
    NotFound,
    TooManyRequests,
    /// Over a limit of what one account may store.
    Full(&'static str),
    /// The code mail couldn't be sent.
    MailFailed,
    Internal,
}

impl From<StoreError> for IdError {
    fn from(error: StoreError) -> Self {
        tracing::error!(%error, "account store failed");
        Self::Internal
    }
}

pub type Result<T> = std::result::Result<T, IdError>;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Purpose {
    Register,
    Login,
    Link,
}

struct Pending {
    purpose: Purpose,
    account: Option<String>,
    expires_s: i64,
    /// Order of making: the oldest gives way when a budget is full.
    seq: u64,
}

struct Limits {
    codes_per_email: RateLimit,
    codes_per_ip: RateLimit,
    sign_ins_per_ip: RateLimit,
    login_options_per_ip: RateLimit,
}

/// A new sign-in: the account and the session id for the cookie.
#[derive(Debug)]
pub struct SignedIn {
    pub account: Account,
    pub session: String,
    /// The account was made by this sign-in.
    pub created: bool,
}

pub struct IdService {
    store: Store,
    settings: Settings,
    mailer: Arc<dyn Mailer>,
    clock: Clock,
    entropy: Entropy,
    limits: Mutex<Limits>,
    challenges: Mutex<HashMap<String, Pending>>,
    challenge_seq: std::sync::atomic::AtomicU64,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// A label as stored: trimmed, without control characters, at most [`MAX_LABEL`] characters.
fn label(text: &str, fallback: &str) -> String {
    let clean: String = text
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_LABEL)
        .collect();
    if clean.is_empty() {
        fallback.to_owned()
    } else {
        clean
    }
}

/// A ride id as the client makes them (a start time); nothing that could be a path.
pub fn valid_ride_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
        && id != "."
        && id != ".."
}

impl IdService {
    pub fn new(store: Store, settings: Settings, mailer: Arc<dyn Mailer>, clock: Clock, entropy: Entropy) -> Self {
        Self {
            store,
            settings,
            mailer,
            clock,
            entropy,
            limits: Mutex::new(Limits {
                codes_per_email: RateLimit::new(5, 3600),
                codes_per_ip: RateLimit::new(20, 3600),
                sign_ins_per_ip: RateLimit::new(60, 3600),
                login_options_per_ip: RateLimit::new(120, 3600),
            }),
            challenges: Mutex::new(HashMap::new()),
            challenge_seq: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    fn now(&self) -> i64 {
        (self.clock)()
    }

    fn ip_key(ip: Option<IpAddr>) -> String {
        ip.map_or_else(|| "unknown".to_owned(), |ip| ip.to_string())
    }

    fn allow_sign_in(&self, ip: Option<IpAddr>) -> Result<()> {
        let now = self.now();
        if lock(&self.limits).sign_ins_per_ip.allow(&Self::ip_key(ip), now) {
            Ok(())
        } else {
            Err(IdError::TooManyRequests)
        }
    }

    fn start_session(&self, account: Account, created: bool) -> Result<SignedIn> {
        let session = token(&self.entropy);
        self.store
            .create_session(&session, &account.id, self.now() + SESSION_SECONDS)?;
        Ok(SignedIn {
            account,
            session,
            created,
        })
    }

    // --- email codes ---

    /// Mails a code to `email`. Answers the same whether or not the address has an
    /// account, so nobody learns who rides here.
    pub async fn start_email(&self, email: &str, language: Language, ip: Option<IpAddr>) -> Result<()> {
        let email = normalize(email).ok_or(IdError::BadRequest("bad_email"))?;
        let now = self.now();
        {
            let mut limits = lock(&self.limits);
            if !limits.codes_per_ip.allow(&Self::ip_key(ip), now) || !limits.codes_per_email.allow(&email, now) {
                return Err(IdError::TooManyRequests);
            }
        }
        let code = code(&self.entropy);
        self.store.prune(now)?;
        self.store.put_code(
            &email,
            &code_mac(&self.settings.secret, &email, &code),
            now + CODE_SECONDS,
        )?;
        // Only the address's owner reads the mail, so it may say whether an account exists.
        let new_account = self.store.account_by_email(&email)?.is_none();
        let mail = render(
            &Message::SignInCode { code, new_account },
            language,
            &self.settings.origin,
        );
        self.mailer.send(&email, &mail).await.map_err(|error| {
            tracing::warn!(%error, "sign-in code mail failed");
            IdError::MailFailed
        })
    }

    /// A notice to the account's address; a failure is logged, never the request's.
    async fn notify(&self, email: &str, message: Message, language: Language) {
        let mail = render(&message, language, &self.settings.origin);
        if let Err(error) = self.mailer.send(email, &mail).await {
            tracing::warn!(%error, "account notice mail failed");
        }
    }

    /// Signs in with an emailed code, making the account on first use.
    pub fn verify_email(&self, email: &str, code: &str, ip: Option<IpAddr>) -> Result<SignedIn> {
        self.allow_sign_in(ip)?;
        let wrong = IdError::Unauthorized("wrong_code");
        let email = normalize(email).ok_or(wrong.clone())?;
        let now = self.now();
        let stored = self.store.codes(&email)?;
        if stored.is_empty() {
            return Err(wrong);
        }
        let live: Vec<_> = stored.iter().filter(|c| c.expires_s > now).collect();
        if live.is_empty() {
            self.store.delete_codes(&email)?;
            return Err(IdError::Unauthorized("code_expired"));
        }
        // Any of the address's live codes signs in: a stranger asking for codes voids none.
        if !live
            .iter()
            .any(|c| code_matches(&self.settings.secret, &email, code, &c.code_mac))
        {
            self.store.count_failed_code(&email, CODE_ATTEMPTS)?;
            return Err(wrong);
        }
        self.store.delete_codes(&email)?;
        match self.store.account_by_email(&email)? {
            Some(account) => self.start_session(account, false),
            None => {
                let account = self
                    .store
                    .create_account(&token(&self.entropy)[..32], &email, self.now())?;
                self.start_session(account, true)
            }
        }
    }

    // --- sessions ---

    pub fn account(&self, session: Option<&str>) -> Result<Account> {
        let session = session.ok_or(IdError::Unauthorized("signed_out"))?;
        self.store
            .session_account(session, self.now())?
            .ok_or(IdError::Unauthorized("signed_out"))
    }

    pub fn sign_out(&self, session: Option<&str>) -> Result<()> {
        if let Some(session) = session {
            self.store.delete_session(session)?;
        }
        Ok(())
    }

    /// Deletes the account, then confirms it to its address.
    pub async fn delete_account(&self, account: &Account, language: Language) -> Result<()> {
        self.store.delete_account(&account.id)?;
        tracing::info!("account deleted");
        self.notify(&account.email, Message::AccountDeleted, language).await;
        Ok(())
    }

    pub fn me(&self, account: &Account) -> Result<Value> {
        let passkeys: Vec<Value> = self
            .store
            .passkeys(&account.id)?
            .into_iter()
            .map(|PasskeyInfo { id, name, created_s }| json!({"id": id, "name": name, "created_s": created_s}))
            .collect();
        let riders: Vec<Value> = self
            .store
            .riders(&account.id)?
            .into_iter()
            .map(|r: RiderInfo| {
                json!({"rider_id": r.rider_id, "name": r.name, "linked_s": r.linked_s, "rides": r.rides, "snapshot_s": r.snapshot_s})
            })
            .collect();
        Ok(json!({
            "email": account.email,
            "created_s": account.created_s,
            "passkeys": passkeys,
            "riders": riders,
        }))
    }

    // --- challenges ---

    /// A fresh challenge. Open ones (passkey sign-in) and each account's are budgeted apart, and a
    /// full budget drops its oldest: a stranger can't crowd out a rider's ceremony.
    fn new_challenge(&self, purpose: Purpose, account: Option<String>) -> String {
        let mut bytes = [0u8; 32];
        (self.entropy)(&mut bytes);
        let challenge = URL_SAFE_NO_PAD.encode(bytes);
        let now = self.now();
        let mut challenges = lock(&self.challenges);
        challenges.retain(|_, pending| pending.expires_s > now);
        let budget = if account.is_some() {
            MAX_ACCOUNT_CHALLENGES
        } else {
            MAX_OPEN_CHALLENGES
        };
        let same = |pending: &Pending| pending.account == account;
        if challenges.values().filter(|pending| same(pending)).count() >= budget {
            let oldest = challenges
                .iter()
                .filter(|(_, pending)| same(pending))
                .min_by_key(|(_, pending)| pending.seq)
                .map(|(key, _)| key.clone());
            if let Some(oldest) = oldest {
                challenges.remove(&oldest);
            }
        }
        let seq = self.challenge_seq.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        challenges.insert(
            challenge.clone(),
            Pending {
                purpose,
                account,
                expires_s: now + CHALLENGE_SECONDS,
                seq,
            },
        );
        challenge
    }

    /// Takes a challenge out (each works once) if it was made for `purpose` and `account`.
    fn take_challenge(&self, challenge: &str, purpose: Purpose, account: Option<&str>) -> Result<()> {
        let pending = lock(&self.challenges)
            .remove(challenge)
            .ok_or(IdError::BadRequest("unknown_challenge"))?;
        let right =
            pending.purpose == purpose && pending.account.as_deref() == account && pending.expires_s > self.now();
        right.then_some(()).ok_or(IdError::BadRequest("unknown_challenge"))
    }

    fn expected<'a>(&'a self, challenge: &'a str) -> Expected<'a> {
        Expected {
            challenge,
            origin: &self.settings.origin,
            rp_id: &self.settings.rp_id,
        }
    }

    // --- passkeys ---

    /// The options for `navigator.credentials.create`, as JSON the client turns into buffers.
    pub fn passkey_register_options(&self, account: &Account) -> Result<Value> {
        let exclude: Vec<Value> = self
            .store
            .passkeys(&account.id)?
            .into_iter()
            .map(|p| json!({"type": "public-key", "id": p.id}))
            .collect();
        let challenge = self.new_challenge(Purpose::Register, Some(account.id.clone()));
        Ok(json!({
            "challenge": challenge,
            "rp": {"id": self.settings.rp_id, "name": self.settings.rp_name},
            "user": {"id": URL_SAFE_NO_PAD.encode(account.id.as_bytes()), "name": account.email, "displayName": account.email},
            "pubKeyCredParams": [{"type": "public-key", "alg": -7}],
            "authenticatorSelection": {"residentKey": "required", "userVerification": "required"},
            "attestation": "none",
            "excludeCredentials": exclude,
            "timeout": CHALLENGE_SECONDS * 1000,
        }))
    }

    /// Adds a passkey and tells the account's address, so a passkey added by someone else shows.
    #[allow(clippy::too_many_arguments)]
    pub async fn passkey_register(
        &self,
        account: &Account,
        challenge: &str,
        credential_id: &str,
        client_data_json: &str,
        authenticator_data: &str,
        public_key: &str,
        name: &str,
        language: Language,
    ) -> Result<()> {
        self.take_challenge(challenge, Purpose::Register, Some(&account.id))?;
        if self.store.passkeys(&account.id)?.len() >= MAX_PASSKEYS {
            return Err(IdError::Full("too_many_passkeys"));
        }
        let credential = webauthn::register(
            &self.expected(challenge),
            credential_id,
            client_data_json,
            authenticator_data,
            public_key,
        )
        .map_err(|_| IdError::BadRequest("bad_passkey"))?;
        if self.store.passkey(&credential.id)?.is_some() {
            return Err(IdError::BadRequest("passkey_exists"));
        }
        let name = label(name, "Passkey");
        let now = self.now();
        self.store.add_passkey(&account.id, &credential, &name, now)?;
        self.notify(&account.email, Message::PasskeyAdded { name, added_s: now }, language)
            .await;
        Ok(())
    }

    /// The options for `navigator.credentials.get`: any passkey of this site may answer.
    /// Open to anyone, so limited per client address like the sign-ins themselves.
    pub fn passkey_login_options(&self, ip: Option<IpAddr>) -> Result<Value> {
        let now = self.now();
        if !lock(&self.limits).login_options_per_ip.allow(&Self::ip_key(ip), now) {
            return Err(IdError::TooManyRequests);
        }
        let challenge = self.new_challenge(Purpose::Login, None);
        Ok(json!({
            "challenge": challenge,
            "rpId": self.settings.rp_id,
            "userVerification": "required",
            "timeout": CHALLENGE_SECONDS * 1000,
        }))
    }

    pub fn passkey_login(
        &self,
        challenge: &str,
        credential_id: &str,
        client_data_json: &str,
        authenticator_data: &str,
        signature: &str,
        ip: Option<IpAddr>,
    ) -> Result<SignedIn> {
        self.allow_sign_in(ip)?;
        self.take_challenge(challenge, Purpose::Login, None)?;
        let refused = IdError::Unauthorized("passkey_refused");
        let (account_id, credential) = self.store.passkey(credential_id)?.ok_or(refused.clone())?;
        let count = webauthn::authenticate(
            &self.expected(challenge),
            &credential,
            client_data_json,
            authenticator_data,
            signature,
        )
        .map_err(|_| refused.clone())?;
        self.store.set_sign_count(&credential.id, count)?;
        let account = self.store.account(&account_id)?.ok_or(refused)?;
        self.start_session(account, false)
    }

    pub fn delete_passkey(&self, account: &Account, credential_id: &str) -> Result<()> {
        if self.store.delete_passkey(&account.id, credential_id)? {
            Ok(())
        } else {
            Err(IdError::NotFound)
        }
    }

    // --- riders ---

    pub fn rider_challenge(&self, account: &Account) -> String {
        self.new_challenge(Purpose::Link, Some(account.id.clone()))
    }

    /// Links the rider key the client proved to hold; returns the rider's id.
    pub fn link_rider(
        &self,
        account: &Account,
        public_key: &str,
        challenge: &str,
        signature: &str,
        name: &str,
    ) -> Result<String> {
        self.take_challenge(challenge, Purpose::Link, Some(&account.id))?;
        rider_key::verify(public_key, &rider_key::link_message(challenge), signature)
            .map_err(|_| IdError::BadRequest("bad_signature"))?;
        let rider_id = rider_key::rider_id(public_key).ok_or(IdError::BadRequest("bad_signature"))?;
        let riders = self.store.riders(&account.id)?;
        let already_here = riders.iter().any(|r| r.rider_id == rider_id);
        if riders.len() >= MAX_RIDERS && !already_here {
            return Err(IdError::Full("too_many_riders"));
        }
        // A rider moving in from another account brings its backups: they must fit too.
        if !already_here
            && self.store.account_bytes(&account.id)? + self.store.rider_bytes(&rider_id)? > self.settings.quota_bytes
        {
            return Err(IdError::Full("quota_exceeded"));
        }
        self.store
            .link_rider(&account.id, &rider_id, public_key, &label(name, "Rider"), self.now())?;
        Ok(rider_id)
    }

    fn own_rider(&self, account: &Account, rider_id: &str) -> Result<()> {
        if self.store.rider_belongs_to(&account.id, rider_id)? {
            Ok(())
        } else {
            Err(IdError::NotFound)
        }
    }

    pub fn put_snapshot(&self, account: &Account, rider_id: &str, body: &Value) -> Result<()> {
        self.own_rider(account, rider_id)?;
        if !body.is_object() {
            return Err(IdError::BadRequest("not_an_object"));
        }
        let quota = self.settings.quota_bytes;
        if !self
            .store
            .put_snapshot_within(&account.id, rider_id, &body.to_string(), self.now(), quota)?
        {
            return Err(IdError::Full("quota_exceeded"));
        }
        Ok(())
    }

    pub fn snapshot(&self, account: &Account, rider_id: &str) -> Result<String> {
        self.own_rider(account, rider_id)?;
        self.store.snapshot(rider_id)?.ok_or(IdError::NotFound)
    }

    pub fn ride_ids(&self, account: &Account, rider_id: &str) -> Result<Vec<String>> {
        self.own_rider(account, rider_id)?;
        Ok(self.store.ride_ids(rider_id)?)
    }

    pub fn put_ride(&self, account: &Account, rider_id: &str, ride_id: &str, body: &Value) -> Result<()> {
        self.own_rider(account, rider_id)?;
        if !valid_ride_id(ride_id) {
            return Err(IdError::BadRequest("bad_ride_id"));
        }
        if !body.is_object() {
            return Err(IdError::BadRequest("not_an_object"));
        }
        if self.store.ride(rider_id, ride_id)?.is_none() && self.store.ride_count(rider_id)? >= MAX_RIDES {
            return Err(IdError::Full("too_many_rides"));
        }
        let quota = self.settings.quota_bytes;
        if !self
            .store
            .put_ride_within(&account.id, rider_id, ride_id, &body.to_string(), self.now(), quota)?
        {
            return Err(IdError::Full("quota_exceeded"));
        }
        Ok(())
    }

    pub fn ride(&self, account: &Account, rider_id: &str, ride_id: &str) -> Result<String> {
        self.own_rider(account, rider_id)?;
        self.store.ride(rider_id, ride_id)?.ok_or(IdError::NotFound)
    }
}

#[cfg(test)]
pub(crate) mod testing {
    //! A service on an in-memory store, a settable clock and a mailer that keeps the codes.

    use super::*;
    use crate::mailer::MailFuture;
    use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};

    pub const ORIGIN: &str = "https://app.openradlr.com";

    #[derive(Default)]
    pub struct Inbox {
        pub mails: Mutex<Vec<(String, crate::mail::Rendered)>>,
        pub fail: std::sync::atomic::AtomicBool,
    }

    impl Inbox {
        pub fn last_code(&self) -> String {
            lock(&self.mails)
                .iter()
                .rev()
                .find_map(|(_, mail)| mail.code.clone())
                .expect("a code was mailed")
        }
    }

    pub struct InboxMailer(pub Arc<Inbox>);

    impl Mailer for InboxMailer {
        fn send<'a>(&'a self, to: &'a str, mail: &'a crate::mail::Rendered) -> MailFuture<'a> {
            Box::pin(async move {
                if self.0.fail.load(Ordering::Relaxed) {
                    return Err("down".into());
                }
                lock(&self.0.mails).push((to.to_owned(), mail.clone()));
                Ok(())
            })
        }
    }

    pub struct Fixture {
        pub service: Arc<IdService>,
        pub inbox: Arc<Inbox>,
        pub now: Arc<AtomicI64>,
    }

    pub fn fixture() -> Fixture {
        fixture_with_quota(crate::service::ACCOUNT_QUOTA_BYTES)
    }

    pub fn fixture_with_quota(quota_bytes: u64) -> Fixture {
        let inbox = Arc::new(Inbox::default());
        let now = Arc::new(AtomicI64::new(1_000_000));
        let clock_now = Arc::clone(&now);
        let counter = AtomicU64::new(1);
        let entropy: Entropy = Arc::new(move |out: &mut [u8]| {
            // Distinct, deterministic bytes: a counter spread over the buffer.
            // A counter in the first bytes keeps every buffer distinct; a pattern fills the rest.
            let n = counter.fetch_add(1, Ordering::Relaxed);
            for (i, b) in out.iter_mut().enumerate() {
                *b = (n.wrapping_mul(31).wrapping_add(i as u64) % 251) as u8;
            }
            for (b, c) in out.iter_mut().zip(n.to_le_bytes()) {
                *b ^= c;
            }
        });
        let service = IdService::new(
            Store::in_memory().unwrap(),
            Settings {
                quota_bytes,
                ..Settings::for_origin(ORIGIN, b"test secret".to_vec()).unwrap()
            },
            Arc::new(InboxMailer(Arc::clone(&inbox))),
            Arc::new(move || clock_now.load(Ordering::Relaxed)),
            entropy,
        );
        Fixture {
            service: Arc::new(service),
            inbox,
            now,
        }
    }

    impl Fixture {
        pub async fn sign_in(&self, email: &str) -> SignedIn {
            self.service.start_email(email, Language::English, None).await.unwrap();
            self.service.verify_email(email, &self.inbox.last_code(), None).unwrap()
        }

        pub fn advance(&self, seconds: i64) {
            self.now.fetch_add(seconds, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::{fixture, ORIGIN};
    use super::*;
    use crate::webauthn::soft::Authenticator;
    use base64::engine::general_purpose::STANDARD;
    use p256::ecdsa::signature::Signer as _;
    use p256::pkcs8::EncodePublicKey as _;

    #[test]
    fn settings_take_the_rp_id_from_the_origin() {
        let settings = Settings::for_origin("http://localhost:8080/", vec![]).unwrap();
        assert_eq!(
            (settings.origin.as_str(), settings.rp_id.as_str()),
            ("http://localhost:8080", "localhost")
        );
        assert!(!settings.secure_cookies);
        assert!(
            Settings::for_origin("https://app.openradlr.com", vec![])
                .unwrap()
                .secure_cookies
        );
        assert!(Settings::for_origin("app.openradlr.com", vec![]).is_none());
        assert!(Settings::for_origin("https://a.org/path", vec![]).is_none());
    }

    #[tokio::test]
    async fn the_first_code_makes_the_account_and_the_next_signs_in_to_it() {
        let f = fixture();
        let first = f.sign_in("Anna@Example.org").await;
        assert!(first.created);
        assert_eq!(first.account.email, "anna@example.org");
        let again = f.sign_in("anna@example.org").await;
        assert!(!again.created);
        assert_eq!(again.account.id, first.account.id);
        assert_ne!(again.session, first.session);
    }

    #[tokio::test]
    async fn the_code_mail_goes_to_the_normalized_address_in_the_riders_language() {
        let f = fixture();
        f.service
            .start_email(" Anna@Example.org", Language::German, None)
            .await
            .unwrap();
        let mails = f.inbox.mails.lock().unwrap();
        assert_eq!(mails[0].0, "anna@example.org");
        assert!(mails[0].1.subject.contains("ist dein OpenRadlr-Code"));
        assert_eq!(mails[0].1.code.as_ref().map(String::len), Some(6));
    }

    #[tokio::test]
    async fn the_first_code_welcomes_and_later_ones_sign_in() {
        let f = fixture();
        f.sign_in("anna@example.org").await;
        f.service
            .start_email("anna@example.org", Language::English, None)
            .await
            .unwrap();
        let mails = f.inbox.mails.lock().unwrap();
        assert!(mails[0].1.text.starts_with("Welcome to OpenRadlr"));
        assert!(mails[1].1.text.starts_with("Sign in to OpenRadlr"));
    }

    #[tokio::test]
    async fn adding_a_passkey_and_deleting_the_account_are_mailed() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        register_passkey(&f, &anna, &Authenticator::new(5)).await.unwrap();
        f.service.delete_account(&anna, Language::English).await.unwrap();
        let mails = f.inbox.mails.lock().unwrap();
        let subjects: Vec<&str> = mails.iter().map(|(_, mail)| mail.subject.as_str()).collect();
        assert_eq!(
            subjects[1..],
            [
                "A passkey was added to your OpenRadlr account",
                "Your OpenRadlr account was deleted"
            ]
        );
        assert!(mails.iter().all(|(to, _)| to == "anna@example.org"));
    }

    #[tokio::test]
    async fn a_failed_notice_does_not_fail_the_change() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        f.inbox.fail.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(register_passkey(&f, &anna, &Authenticator::new(5)).await.is_ok());
    }

    #[tokio::test]
    async fn a_code_works_once() {
        let f = fixture();
        f.service
            .start_email("anna@example.org", Language::English, None)
            .await
            .unwrap();
        let code = f.inbox.last_code();
        f.service.verify_email("anna@example.org", &code, None).unwrap();
        assert_eq!(
            f.service.verify_email("anna@example.org", &code, None).unwrap_err(),
            IdError::Unauthorized("wrong_code")
        );
    }

    #[tokio::test]
    async fn a_code_expires_after_ten_minutes() {
        let f = fixture();
        f.service
            .start_email("anna@example.org", Language::English, None)
            .await
            .unwrap();
        f.advance(CODE_SECONDS);
        let result = f.service.verify_email("anna@example.org", &f.inbox.last_code(), None);
        assert_eq!(result.unwrap_err(), IdError::Unauthorized("code_expired"));
    }

    #[tokio::test]
    async fn five_wrong_codes_burn_the_code() {
        let f = fixture();
        f.service
            .start_email("anna@example.org", Language::English, None)
            .await
            .unwrap();
        let code = f.inbox.last_code();
        let wrong = if code == "000000" { "000001" } else { "000000" };
        for _ in 0..CODE_ATTEMPTS {
            assert!(f.service.verify_email("anna@example.org", wrong, None).is_err());
        }
        assert!(f.service.verify_email("anna@example.org", &code, None).is_err());
    }

    #[tokio::test]
    async fn asking_for_another_code_leaves_the_first_one_valid() {
        let f = fixture();
        f.service
            .start_email("anna@example.org", Language::English, None)
            .await
            .unwrap();
        let first = f.inbox.last_code();
        f.service
            .start_email("anna@example.org", Language::English, None)
            .await
            .unwrap();
        assert!(f.service.verify_email("anna@example.org", &first, None).is_ok());
    }

    #[tokio::test]
    async fn a_flood_of_sign_in_challenges_does_not_void_an_accounts_challenge() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        let authenticator = Authenticator::new(5);
        let options = f.service.passkey_register_options(&anna).unwrap();
        let challenge = options["challenge"].as_str().unwrap().to_owned();
        for _ in 0..MAX_OPEN_CHALLENGES + 5 {
            f.service.new_challenge(Purpose::Login, None);
        }
        let r = authenticator.register(&challenge, ORIGIN, "app.openradlr.com");
        let result = f
            .service
            .passkey_register(
                &anna,
                &challenge,
                &r.credential_id,
                &r.client_data_json,
                &r.authenticator_data,
                &r.public_key,
                "",
                Language::English,
            )
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn a_full_open_budget_drops_its_oldest_and_keeps_the_newest() {
        let f = fixture();
        let first = f.service.new_challenge(Purpose::Login, None);
        for _ in 0..MAX_OPEN_CHALLENGES {
            f.service.new_challenge(Purpose::Login, None);
        }
        let newest = f.service.new_challenge(Purpose::Login, None);
        assert!(f.service.take_challenge(&first, Purpose::Login, None).is_err());
        assert!(f.service.take_challenge(&newest, Purpose::Login, None).is_ok());
    }

    #[tokio::test]
    async fn passkey_sign_in_options_are_rate_limited_per_address() {
        let f = fixture();
        let ip: IpAddr = "192.0.2.1".parse().unwrap();
        for _ in 0..120 {
            f.service.passkey_login_options(Some(ip)).unwrap();
        }
        assert_eq!(
            f.service.passkey_login_options(Some(ip)).unwrap_err(),
            IdError::TooManyRequests
        );
    }

    #[tokio::test]
    async fn a_rider_that_would_overfill_the_account_it_moves_to_stays_put() {
        let f = testing::fixture_with_quota(300);
        let anna = f.sign_in("anna@example.org").await.account;
        let bert = f.sign_in("bert@example.org").await.account;
        let annas = link(&f, &anna, &rider_key_pair(9)).unwrap();
        f.service
            .put_ride(&anna, &annas, "1", &json!({"pad": "x".repeat(200)}))
            .unwrap();
        let berts = link(&f, &bert, &rider_key_pair(8)).unwrap();
        f.service
            .put_ride(&bert, &berts, "1", &json!({"pad": "x".repeat(200)}))
            .unwrap();
        assert_eq!(
            link(&f, &bert, &rider_key_pair(9)).unwrap_err(),
            IdError::Full("quota_exceeded")
        );
    }

    #[tokio::test]
    async fn a_code_for_another_address_does_not_sign_in() {
        let f = fixture();
        f.service
            .start_email("anna@example.org", Language::English, None)
            .await
            .unwrap();
        f.service
            .start_email("bert@example.org", Language::English, None)
            .await
            .unwrap();
        let bert_code = f.inbox.last_code();
        assert!(f.service.verify_email("anna@example.org", &bert_code, None).is_err());
    }

    #[tokio::test]
    async fn codes_are_rate_limited_per_address() {
        let f = fixture();
        for _ in 0..5 {
            f.service
                .start_email("anna@example.org", Language::English, None)
                .await
                .unwrap();
        }
        let sixth = f.service.start_email("anna@example.org", Language::English, None).await;
        assert_eq!(sixth.unwrap_err(), IdError::TooManyRequests);
    }

    #[tokio::test]
    async fn a_failed_mail_is_reported() {
        let f = fixture();
        f.inbox.fail.store(true, std::sync::atomic::Ordering::Relaxed);
        let result = f.service.start_email("anna@example.org", Language::English, None).await;
        assert_eq!(result.unwrap_err(), IdError::MailFailed);
    }

    #[tokio::test]
    async fn a_session_ends_when_signed_out() {
        let f = fixture();
        let signed_in = f.sign_in("anna@example.org").await;
        assert!(f.service.account(Some(&signed_in.session)).is_ok());
        f.service.sign_out(Some(&signed_in.session)).unwrap();
        assert_eq!(
            f.service.account(Some(&signed_in.session)).unwrap_err(),
            IdError::Unauthorized("signed_out")
        );
    }

    async fn register_passkey(f: &testing::Fixture, account: &Account, authenticator: &Authenticator) -> Result<()> {
        let options = f.service.passkey_register_options(account).unwrap();
        let challenge = options["challenge"].as_str().unwrap();
        let r = authenticator.register(challenge, ORIGIN, "app.openradlr.com");
        f.service
            .passkey_register(
                account,
                challenge,
                &r.credential_id,
                &r.client_data_json,
                &r.authenticator_data,
                &r.public_key,
                "Laptop",
                Language::English,
            )
            .await
    }

    fn passkey_sign_in(f: &testing::Fixture, authenticator: &Authenticator) -> Result<SignedIn> {
        let options = f.service.passkey_login_options(None).unwrap();
        let challenge = options["challenge"].as_str().unwrap();
        let a = authenticator.assert(challenge, ORIGIN, "app.openradlr.com");
        f.service.passkey_login(
            challenge,
            &a.credential_id,
            &a.client_data_json,
            &a.authenticator_data,
            &a.signature,
            None,
        )
    }

    #[tokio::test]
    async fn a_passkey_added_to_an_account_signs_in_to_it() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        let authenticator = Authenticator::new(5);
        register_passkey(&f, &anna, &authenticator).await.unwrap();
        assert_eq!(passkey_sign_in(&f, &authenticator).unwrap().account.id, anna.id);
        assert_eq!(f.service.me(&anna).unwrap()["passkeys"][0]["name"], "Laptop");
    }

    #[tokio::test]
    async fn an_unknown_passkey_does_not_sign_in() {
        let f = fixture();
        let result = passkey_sign_in(&f, &Authenticator::new(5));
        assert_eq!(result.unwrap_err(), IdError::Unauthorized("passkey_refused"));
    }

    #[tokio::test]
    async fn a_register_challenge_of_another_account_is_refused() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        let bert = f.sign_in("bert@example.org").await.account;
        let options = f.service.passkey_register_options(&anna).unwrap();
        let challenge = options["challenge"].as_str().unwrap();
        let r = Authenticator::new(5).register(challenge, ORIGIN, "app.openradlr.com");
        let result = f
            .service
            .passkey_register(
                &bert,
                challenge,
                &r.credential_id,
                &r.client_data_json,
                &r.authenticator_data,
                &r.public_key,
                "",
                Language::English,
            )
            .await;
        assert_eq!(result.unwrap_err(), IdError::BadRequest("unknown_challenge"));
    }

    #[tokio::test]
    async fn a_login_challenge_works_once() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        let authenticator = Authenticator::new(5);
        register_passkey(&f, &anna, &authenticator).await.unwrap();
        let options = f.service.passkey_login_options(None).unwrap();
        let challenge = options["challenge"].as_str().unwrap();
        let a = authenticator.assert(challenge, ORIGIN, "app.openradlr.com");
        let login = || {
            f.service.passkey_login(
                challenge,
                &a.credential_id,
                &a.client_data_json,
                &a.authenticator_data,
                &a.signature,
                None,
            )
        };
        assert!(login().is_ok());
        assert_eq!(login().unwrap_err(), IdError::BadRequest("unknown_challenge"));
    }

    #[tokio::test]
    async fn a_deleted_passkey_no_longer_signs_in() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        let authenticator = Authenticator::new(5);
        register_passkey(&f, &anna, &authenticator).await.unwrap();
        let id = f.service.me(&anna).unwrap()["passkeys"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        f.service.delete_passkey(&anna, &id).unwrap();
        assert!(passkey_sign_in(&f, &authenticator).is_err());
    }

    struct RiderKeyPair {
        key: p256::ecdsa::SigningKey,
        public: String,
    }

    fn rider_key_pair(seed: u8) -> RiderKeyPair {
        let key = p256::ecdsa::SigningKey::from_slice(&[seed; 32]).unwrap();
        let public = STANDARD.encode(key.verifying_key().to_public_key_der().unwrap().as_bytes());
        RiderKeyPair { key, public }
    }

    fn link(f: &testing::Fixture, account: &Account, rider: &RiderKeyPair) -> Result<String> {
        let challenge = f.service.rider_challenge(account);
        let signature: p256::ecdsa::Signature = rider.key.sign(rider_key::link_message(&challenge).as_bytes());
        f.service.link_rider(
            account,
            &rider.public,
            &challenge,
            &STANDARD.encode(signature.to_bytes()),
            "Anna",
        )
    }

    #[tokio::test]
    async fn a_rider_that_proves_its_key_is_linked() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        let rider_id = link(&f, &anna, &rider_key_pair(9)).unwrap();
        assert_eq!(rider_id, rider_key::rider_id(&rider_key_pair(9).public).unwrap());
        assert_eq!(f.service.me(&anna).unwrap()["riders"][0]["rider_id"], rider_id.as_str());
    }

    #[tokio::test]
    async fn a_rider_signature_by_another_key_is_refused() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        let challenge = f.service.rider_challenge(&anna);
        let signature: p256::ecdsa::Signature = rider_key_pair(8)
            .key
            .sign(rider_key::link_message(&challenge).as_bytes());
        let result = f.service.link_rider(
            &anna,
            &rider_key_pair(9).public,
            &challenge,
            &STANDARD.encode(signature.to_bytes()),
            "Anna",
        );
        assert_eq!(result.unwrap_err(), IdError::BadRequest("bad_signature"));
    }

    #[tokio::test]
    async fn a_linked_rider_is_backed_up() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        let rider = link(&f, &anna, &rider_key_pair(9)).unwrap();
        f.service
            .put_snapshot(&anna, &rider, &json!({"profile": {"ftp": 250}}))
            .unwrap();
        f.service
            .put_ride(&anna, &rider, "1700000000000", &json!({"km": 20}))
            .unwrap();
        assert_eq!(
            f.service.ride_ids(&anna, &rider).unwrap(),
            vec!["1700000000000".to_owned()]
        );
        assert!(f.service.snapshot(&anna, &rider).unwrap().contains("250"));
        assert!(f.service.ride(&anna, &rider, "1700000000000").unwrap().contains("20"));
    }

    #[tokio::test]
    async fn another_accounts_rider_is_not_found() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        let bert = f.sign_in("bert@example.org").await.account;
        let rider = link(&f, &anna, &rider_key_pair(9)).unwrap();
        assert_eq!(f.service.ride_ids(&bert, &rider).unwrap_err(), IdError::NotFound);
        assert_eq!(
            f.service.put_snapshot(&bert, &rider, &json!({})).unwrap_err(),
            IdError::NotFound
        );
    }

    #[tokio::test]
    async fn a_ride_that_would_overfill_the_account_is_refused_and_a_smaller_one_still_fits() {
        let f = testing::fixture_with_quota(300);
        let anna = f.sign_in("anna@example.org").await.account;
        let rider = link(&f, &anna, &rider_key_pair(9)).unwrap();
        f.service
            .put_ride(&anna, &rider, "1", &json!({"pad": "x".repeat(200)}))
            .unwrap();
        assert_eq!(
            f.service
                .put_ride(&anna, &rider, "2", &json!({"pad": "x".repeat(200)}))
                .unwrap_err(),
            IdError::Full("quota_exceeded")
        );
        f.service
            .put_ride(&anna, &rider, "3", &json!({"pad": "x".repeat(20)}))
            .unwrap();
    }

    #[tokio::test]
    async fn replacing_a_ride_counts_only_the_difference() {
        let f = testing::fixture_with_quota(300);
        let anna = f.sign_in("anna@example.org").await.account;
        let rider = link(&f, &anna, &rider_key_pair(9)).unwrap();
        f.service
            .put_ride(&anna, &rider, "1", &json!({"pad": "x".repeat(200)}))
            .unwrap();
        f.service
            .put_ride(&anna, &rider, "1", &json!({"pad": "y".repeat(250)}))
            .unwrap();
    }

    #[tokio::test]
    async fn ride_ids_that_could_be_paths_are_refused() {
        let f = fixture();
        let anna = f.sign_in("anna@example.org").await.account;
        let rider = link(&f, &anna, &rider_key_pair(9)).unwrap();
        for bad in ["", "..", "a/b", &"9".repeat(65)] {
            assert_eq!(
                f.service.put_ride(&anna, &rider, bad, &json!({})).unwrap_err(),
                IdError::BadRequest("bad_ride_id"),
                "{bad:?}"
            );
        }
    }

    #[tokio::test]
    async fn a_deleted_account_signs_in_as_a_new_one() {
        let f = fixture();
        let first = f.sign_in("anna@example.org").await;
        f.service
            .delete_account(&first.account, Language::English)
            .await
            .unwrap();
        assert!(f.service.account(Some(&first.session)).is_err());
        assert!(f.sign_in("anna@example.org").await.created);
    }
}
