//! Strava as an optional account: "Connect with Strava" (OAuth), a session
//! cookie, and uploading finished rides.
//!
//! With `OPENRADLR_REQUIRE_STRAVA=true` only riders with a connected Strava
//! account may join — a simple hurdle for scripted clients, since every
//! rider needs a real account, and one account can ride only once at a time.
//!
//! Sessions live in memory: after a server restart riders press "Connect"
//! again (Strava skips the consent screen the second time).
//!
//! This module is pure (URLs, cookies, the session store) and unit-tested;
//! the HTTP calls to Strava live in [`crate::strava_api`].

use crate::session_store::{hash_id, SessionStore};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::Mutex;

pub const SESSION_COOKIE: &str = "openradlr_session";
pub const STATE_COOKIE: &str = "openradlr_oauth_state";
/// Sessions last this long without a new login.
pub const SESSION_SECONDS: i64 = 30 * 24 * 3600;
/// Time to come back from Strava's consent screen.
pub const STATE_SECONDS: i64 = 600;
/// The app's login (see [`AppLogins`]): its secret, in the app's web view.
pub const APP_LOGIN_COOKIE: &str = "openradlr_app_login";
/// The app's login id, in the system sign-in sheet on its way through Strava.
pub const APP_ID_COOKIE: &str = "openradlr_app_id";
/// Where the sign-in sheet hands back to the app (`openradlr://` opens it).
pub const APP_CALLBACK_URL: &str = "openradlr://strava";
/// Refresh the access token when it expires within this many seconds.
const REFRESH_MARGIN_S: i64 = 300;

const AUTHORIZE_URL: &str = "https://www.strava.com/oauth/authorize";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StravaConfig {
    pub client_id: String,
    pub client_secret: String,
    /// `<public url>/auth/strava/callback`, registered in the Strava API settings.
    pub redirect_uri: String,
    /// The server's own address (`OPENRADLR_PUBLIC_URL`, no trailing slash); linked from uploaded rides.
    pub public_url: String,
}

/// Percent-encodes everything except RFC 3986 unreserved characters.
pub fn url_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

/// Where "Connect with Strava" sends the browser.
pub fn authorize_url(config: &StravaConfig, state: &str) -> String {
    format!(
        "{AUTHORIZE_URL}?client_id={}&response_type=code&redirect_uri={}&approval_prompt=auto&scope={}&state={}",
        url_encode(&config.client_id),
        url_encode(&config.redirect_uri),
        url_encode("read,activity:write"),
        url_encode(state),
    )
}

/// Riders may untick "upload activities" on Strava's consent screen.
pub fn scope_allows_upload(scope: Option<&str>) -> bool {
    scope.is_some_and(|scope| scope.split(',').any(|s| s.trim() == "activity:write"))
}

/// The value of cookie `name` from all `Cookie` header values.
pub fn cookie_value<'a>(cookie_headers: impl IntoIterator<Item = &'a str>, name: &str) -> Option<&'a str> {
    cookie_headers
        .into_iter()
        .flat_map(|header| header.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value)
}

/// `Set-Cookie` value for a session (or, with `max_age = 0`, its removal).
pub fn cookie(name: &str, value: &str, path: &str, max_age: i64, secure: bool) -> String {
    format!(
        "{name}={value}; Path={path}; Max-Age={max_age}; HttpOnly; SameSite=Lax{}",
        if secure { "; Secure" } else { "" }
    )
}

use crate::secure_random::random_token;

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    /// Only in the first exchange, not in refreshes.
    #[serde(default)]
    pub athlete: Option<Athlete>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Athlete {
    pub id: u64,
    #[serde(default)]
    pub firstname: Option<String>,
    #[serde(default)]
    pub lastname: Option<String>,
}

impl Athlete {
    /// "Leon F." — first name and initial, like Strava shows in feeds.
    pub fn display_name(&self) -> String {
        let first = self.firstname.as_deref().unwrap_or("").trim();
        let initial = self.lastname.as_deref().and_then(|l| l.trim().chars().next());
        let name = match (first.is_empty(), initial) {
            (false, Some(initial)) => format!("{first} {initial}."),
            (false, None) => first.to_owned(),
            (true, _) => format!("Athlete {}", self.id),
        };
        name.chars().take(24).collect()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Account {
    pub athlete_id: u64,
    pub name: String,
    pub can_upload: bool,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

impl Account {
    pub fn from_token(token: TokenResponse, can_upload: bool) -> Option<Self> {
        let athlete = token.athlete?;
        Some(Self {
            athlete_id: athlete.id,
            name: athlete.display_name(),
            can_upload,
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_at: token.expires_at,
        })
    }

    pub fn needs_refresh(&self, now_s: i64) -> bool {
        self.expires_at - now_s < REFRESH_MARGIN_S
    }
}

/// A failed save is logged, not fatal: the in-memory session still works.
fn log_store(result: Result<(), crate::session_store::StoreError>) {
    if let Err(error) = result {
        tracing::warn!(%error, "could not save the Strava session");
    }
}

struct Session {
    account: Account,
    created_s: i64,
}

/// Sessions (kept in memory, and saved to the [`SessionStore`] when there is
/// one) and pending OAuth states. Sessions are keyed by the hash of their id.
#[derive(Default)]
pub struct Accounts {
    sessions: Mutex<HashMap<String, Session>>,
    states: Mutex<HashMap<String, i64>>,
    store: Option<SessionStore>,
}

impl Accounts {
    /// Sessions saved by an earlier run are loaded; expired ones are dropped.
    pub fn with_store(store: SessionStore, now_s: i64) -> Self {
        let mut sessions = HashMap::new();
        match store.load() {
            Ok(saved) => {
                for saved in saved {
                    if now_s - saved.created_s <= SESSION_SECONDS {
                        sessions.insert(
                            saved.id_hash,
                            Session {
                                account: saved.account,
                                created_s: saved.created_s,
                            },
                        );
                    }
                }
            }
            Err(error) => tracing::warn!(%error, "could not load saved Strava sessions"),
        }
        log_store(store.remove_older_than(now_s - SESSION_SECONDS));
        tracing::info!(sessions = sessions.len(), "Strava sessions restored");
        Self {
            sessions: Mutex::new(sessions),
            states: Mutex::default(),
            store: Some(store),
        }
    }

    /// A fresh OAuth `state`; expired ones are dropped on the way.
    pub fn new_state(&self, now_s: i64) -> String {
        let mut states = self.states.lock().unwrap_or_else(|e| e.into_inner());
        states.retain(|_, created| now_s - *created <= STATE_SECONDS);
        let state = random_token();
        states.insert(state.clone(), now_s);
        state
    }

    /// Consumes a state: true once, and only within [`STATE_SECONDS`].
    pub fn take_state(&self, state: &str, now_s: i64) -> bool {
        let mut states = self.states.lock().unwrap_or_else(|e| e.into_inner());
        states
            .remove(state)
            .is_some_and(|created| now_s - created <= STATE_SECONDS)
    }

    /// Stores the account and returns its new session id. Older sessions of
    /// the same athlete stay valid (several devices), expired ones are dropped.
    pub fn insert(&self, account: Account, now_s: i64) -> String {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        sessions.retain(|_, s| now_s - s.created_s <= SESSION_SECONDS);
        let id = random_token();
        let key = hash_id(&id);
        if let Some(store) = &self.store {
            log_store(store.remove_older_than(now_s - SESSION_SECONDS));
            log_store(store.save(&key, &account, now_s));
        }
        sessions.insert(
            key,
            Session {
                account,
                created_s: now_s,
            },
        );
        id
    }

    pub fn get(&self, session_id: &str, now_s: i64) -> Option<Account> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        sessions
            .get(&hash_id(session_id))
            .filter(|s| now_s - s.created_s <= SESSION_SECONDS)
            .map(|s| s.account.clone())
    }

    /// Stores refreshed tokens for every session of the athlete.
    pub fn update_tokens(&self, athlete_id: u64, token: &TokenResponse) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        for (key, session) in sessions.iter_mut().filter(|(_, s)| s.account.athlete_id == athlete_id) {
            session.account.access_token.clone_from(&token.access_token);
            session.account.refresh_token.clone_from(&token.refresh_token);
            session.account.expires_at = token.expires_at;
            if let Some(store) = &self.store {
                log_store(store.save(key, &session.account, session.created_s));
            }
        }
    }

    pub fn remove(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let key = hash_id(session_id);
        sessions.remove(&key);
        if let Some(store) = &self.store {
            log_store(store.remove(&key));
        }
    }

    pub fn session_count(&self) -> usize {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}

struct AppLogin {
    secret_hash: String,
    created_s: i64,
    /// Set once Strava said yes: the session and the hash of its ticket.
    done: Option<(String, String)>,
}

/// Logins from the OpenRadlr app (docs/app.md). Its web view can't sign in
/// with every provider, so the app opens Strava in the system's sign-in
/// sheet, which has its own cookies:
///
/// 1. The web view starts a login and keeps its secret as a cookie.
/// 2. The sheet carries only the login's id through Strava.
/// 3. Strava's answer sends the sheet to `openradlr://strava` with a ticket,
///    which reaches the device that signed in.
/// 4. The web view claims the session with secret and ticket.
///
/// Someone who sends a victim their own login link holds the secret but never
/// sees the ticket; an app that grabs the `openradlr://` URL holds the ticket
/// but not the secret.
#[derive(Default)]
pub struct AppLogins {
    logins: Mutex<HashMap<String, AppLogin>>,
}

impl AppLogins {
    /// A new login: its id (for the sheet) and secret (for the web view).
    pub fn start(&self, now_s: i64) -> (String, String) {
        let mut logins = self.logins.lock().unwrap_or_else(|e| e.into_inner());
        logins.retain(|_, login| now_s - login.created_s <= STATE_SECONDS);
        let (id, secret) = (random_token(), random_token());
        logins.insert(
            id.clone(),
            AppLogin {
                secret_hash: hash_id(&secret),
                created_s: now_s,
                done: None,
            },
        );
        (id, secret)
    }

    /// Whether `id` is a login still waiting for Strava.
    pub fn is_pending(&self, id: &str, now_s: i64) -> bool {
        let logins = self.logins.lock().unwrap_or_else(|e| e.into_inner());
        logins
            .get(id)
            .is_some_and(|login| login.done.is_none() && now_s - login.created_s <= STATE_SECONDS)
    }

    /// Strava said yes: the session waits for the web view. Returns the ticket
    /// for the `openradlr://` URL, or None for an unknown or used login.
    pub fn complete(&self, id: &str, session: String, now_s: i64) -> Option<String> {
        let mut logins = self.logins.lock().unwrap_or_else(|e| e.into_inner());
        let login = logins
            .get_mut(id)
            .filter(|login| login.done.is_none() && now_s - login.created_s <= STATE_SECONDS)?;
        let ticket = random_token();
        login.done = Some((session, hash_id(&ticket)));
        Some(ticket)
    }

    /// The session of the login with this secret and ticket, once.
    pub fn claim(&self, secret: &str, ticket: &str, now_s: i64) -> Option<String> {
        let mut logins = self.logins.lock().unwrap_or_else(|e| e.into_inner());
        let (secret_hash, ticket_hash) = (hash_id(secret), hash_id(ticket));
        let id = logins
            .iter()
            .find(|(_, login)| login.secret_hash == secret_hash)
            .map(|(id, _)| id.clone())?;
        if !logins[&id].done.as_ref().is_some_and(|(_, hash)| *hash == ticket_hash) {
            return None;
        }
        let login = logins.remove(&id)?;
        let (session, _) = login.done?;
        (now_s - login.created_s <= STATE_SECONDS).then_some(session)
    }
}

/// Where a login ends: the page for the browser, the app's URL (with the
/// ticket of a finished login) for its sign-in sheet.
pub fn login_result_url(app: bool, result: &str, ticket: Option<&str>) -> String {
    match (app, result) {
        (true, _) => match ticket {
            Some(ticket) => format!("{APP_CALLBACK_URL}?result={result}&ticket={ticket}"),
            None => format!("{APP_CALLBACK_URL}?result={result}"),
        },
        (false, "connected") => "/".to_owned(),
        (false, _) => format!("/?strava={result}"),
    }
}

/// What Strava answers about an upload (passed on to the browser).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UploadStatus {
    pub id: u64,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub activity_id: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> StravaConfig {
        StravaConfig {
            client_id: "12345".into(),
            client_secret: "secret".into(),
            redirect_uri: "https://ride.example.com/auth/strava/callback".into(),
            public_url: "https://ride.example.com".into(),
        }
    }

    fn account(id: u64) -> Account {
        Account {
            athlete_id: id,
            name: "Leon F.".into(),
            can_upload: true,
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at: 1000,
        }
    }

    #[test]
    fn authorize_url_asks_for_read_and_upload() {
        let url = authorize_url(&config(), "abc");
        assert!(url.starts_with("https://www.strava.com/oauth/authorize?client_id=12345&response_type=code"));
        assert!(url.contains("redirect_uri=https%3A%2F%2Fride.example.com%2Fauth%2Fstrava%2Fcallback"));
        assert!(url.contains("scope=read%2Cactivity%3Awrite"));
        assert!(url.ends_with("&state=abc"));
        assert_eq!(url_encode("a b&c~"), "a%20b%26c~");
    }

    #[test]
    fn upload_scope_is_optional() {
        assert!(scope_allows_upload(Some("read,activity:write")));
        assert!(!scope_allows_upload(Some("read")));
        assert!(!scope_allows_upload(None));
    }

    #[test]
    fn cookies_are_found_across_headers() {
        let headers = ["theme=dark; openradlr_session=s1", "other=1"];
        assert_eq!(cookie_value(headers, SESSION_COOKIE), Some("s1"));
        assert_eq!(cookie_value(["x=1"], SESSION_COOKIE), None);
        assert_eq!(
            cookie("a", "b", "/", 60, true),
            "a=b; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure"
        );
        assert!(!cookie("a", "", "/", 0, false).contains("Secure"));
    }

    #[test]
    fn token_responses_parse_with_and_without_athlete() {
        let first: TokenResponse = serde_json::from_str(
            r#"{"token_type":"Bearer","expires_at":1568775134,"expires_in":21600,"refresh_token":"r1","access_token":"a1",
                "athlete":{"id":42,"firstname":"Leon","lastname":"Fasler","profile":"x"}}"#,
        )
        .unwrap();
        let account = Account::from_token(first, true).unwrap();
        assert_eq!(account.athlete_id, 42);
        assert_eq!(account.name, "Leon F.");
        let refreshed: TokenResponse =
            serde_json::from_str(r#"{"access_token":"a2","refresh_token":"r2","expires_at":1600000000}"#).unwrap();
        assert!(Account::from_token(refreshed, true).is_none());
    }

    #[test]
    fn display_names_fall_back_sensibly() {
        let athlete = |first: Option<&str>, last: Option<&str>| Athlete {
            id: 7,
            firstname: first.map(Into::into),
            lastname: last.map(Into::into),
        };
        assert_eq!(athlete(Some("Mara"), None).display_name(), "Mara");
        assert_eq!(athlete(None, Some("K")).display_name(), "Athlete 7");
        assert_eq!(
            athlete(Some("A very long first name indeed"), Some("X"))
                .display_name()
                .chars()
                .count(),
            24
        );
    }

    #[test]
    fn states_are_single_use_and_expire() {
        let accounts = Accounts::default();
        let state = accounts.new_state(0);
        assert!(accounts.take_state(&state, 10));
        assert!(!accounts.take_state(&state, 10), "single use");
        let old = accounts.new_state(0);
        assert!(!accounts.take_state(&old, STATE_SECONDS + 1));
        assert!(!accounts.take_state("forged", 0));
    }

    #[test]
    fn sessions_hold_accounts_until_they_expire() {
        let accounts = Accounts::default();
        let id = accounts.insert(account(1), 0);
        assert_eq!(accounts.get(&id, 100).unwrap().athlete_id, 1);
        assert!(accounts.get("nope", 100).is_none());
        assert!(accounts.get(&id, SESSION_SECONDS + 1).is_none());

        let second = accounts.insert(account(1), 10);
        let token = TokenResponse {
            access_token: "new".into(),
            refresh_token: "r2".into(),
            expires_at: 9999,
            athlete: None,
        };
        accounts.update_tokens(1, &token);
        assert_eq!(accounts.get(&second, 20).unwrap().access_token, "new");
        accounts.remove(&second);
        assert!(accounts.get(&second, 20).is_none());
    }

    #[test]
    fn tokens_are_refreshed_shortly_before_they_expire() {
        let a = account(1);
        assert!(!a.needs_refresh(0));
        assert!(a.needs_refresh(800));
    }

    #[test]
    fn saved_sessions_survive_a_restart() {
        let dir = std::env::temp_dir().join(format!("openradlr-sessions-{}", random_token()));
        let open = || SessionStore::open(&dir, "a-test-secret-key").unwrap();
        let first = Accounts::with_store(open(), 0);
        let kept = first.insert(account(1), 10);
        let gone = first.insert(account(2), 10);
        first.remove(&gone);
        drop(first);

        let second = Accounts::with_store(open(), 100);
        let restored = second.get(&kept, 100).unwrap();
        assert_eq!(restored.athlete_id, 1);
        assert!(restored.needs_refresh(100), "the access token isn't kept");
        assert!(second.get(&gone, 100).is_none(), "logout is permanent");
        assert_eq!(second.session_count(), 1);
        drop(second);

        let expired = Accounts::with_store(open(), SESSION_SECONDS + 20);
        assert!(expired.get(&kept, SESSION_SECONDS + 20).is_none());
        assert_eq!(expired.session_count(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_app_login_is_claimed_once_with_secret_and_ticket() {
        let logins = AppLogins::default();
        let (id, secret) = logins.start(1000);
        assert!(logins.is_pending(&id, 1000));
        let ticket = logins.complete(&id, "session-1".to_owned(), 1010).expect("a ticket");
        assert!(!logins.is_pending(&id, 1010));
        assert_eq!(
            logins.complete(&id, "session-2".to_owned(), 1011),
            None,
            "one session per login"
        );
        assert_eq!(logins.claim(&secret, &id, 1012), None, "the id is no ticket");
        assert_eq!(
            logins.claim(&ticket, &ticket, 1012),
            None,
            "the ticket alone grants nothing"
        );
        assert_eq!(logins.claim(&secret, &ticket, 1012), Some("session-1".to_owned()));
        assert_eq!(logins.claim(&secret, &ticket, 1013), None);
    }

    #[test]
    fn a_login_link_sent_to_someone_else_gives_its_sender_nothing() {
        let logins = AppLogins::default();
        // The sender starts a login and keeps the secret; the victim signs in with the link.
        let (id, secret) = logins.start(1000);
        let _ticket_on_the_victims_phone = logins.complete(&id, "victim".to_owned(), 1010);
        assert_eq!(logins.claim(&secret, "", 1011), None);
        assert_eq!(logins.claim(&secret, &random_token(), 1011), None);
    }

    #[test]
    fn app_logins_expire_like_oauth_states() {
        let logins = AppLogins::default();
        let (id, secret) = logins.start(1000);
        assert!(!logins.is_pending(&id, 1000 + STATE_SECONDS + 1));
        let ticket = logins
            .complete(&id, "s".to_owned(), 1000 + STATE_SECONDS)
            .expect("a ticket");
        assert_eq!(logins.claim(&secret, &ticket, 1000 + STATE_SECONDS + 1), None);
        assert!(!logins.is_pending("unknown", 1000));
    }

    #[test]
    fn logins_end_in_the_browser_or_in_the_app() {
        assert_eq!(login_result_url(false, "connected", None), "/");
        assert_eq!(login_result_url(false, "denied", None), "/?strava=denied");
        assert_eq!(
            login_result_url(true, "connected", Some("t1")),
            "openradlr://strava?result=connected&ticket=t1"
        );
        assert_eq!(
            login_result_url(true, "expired", None),
            "openradlr://strava?result=expired"
        );
    }
}
