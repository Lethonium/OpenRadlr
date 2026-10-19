//! HTTP handlers for "Connect with Strava" and ride uploads.
//!
//! | Route                          | Purpose                                       |
//! |--------------------------------|-----------------------------------------------|
//! | `GET /auth/strava`             | Start the OAuth flow (redirect to Strava)     |
//! | `GET /auth/strava/callback`    | Back from Strava: create the session cookie   |
//! | `POST /auth/strava/app`        | The app starts a login (see [`AppLogins`])    |
//! | `POST /auth/strava/app/claim`  | The app's web view takes the new session      |
//! | `POST /auth/logout`            | Forget the session                            |
//! | `GET /api/me`                  | The connected account, or 401                 |
//! | `POST /api/strava/upload`      | Upload a TCX ride (body), `?name=` optional   |
//! | `GET /api/strava/upload/{id}`  | Whether Strava finished processing it         |

use crate::guard::Slots;
use crate::http::AppState;
use crate::session_store::SessionStore;
use crate::strava::{
    authorize_url, cookie, cookie_value, login_result_url, scope_allows_upload, Account, Accounts, AppLogins,
    StravaConfig, APP_ID_COOKIE, APP_LOGIN_COOKIE, SESSION_COOKIE, SESSION_SECONDS, STATE_COOKIE, STATE_SECONDS,
};
use crate::strava_api;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{AppendHeaders, IntoResponse, Redirect, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Everything the Strava routes need, present only if Strava is configured.
pub struct Strava {
    pub config: StravaConfig,
    pub accounts: Accounts,
    pub http: reqwest::Client,
    pub required: bool,
    /// Send cookies with `Secure` (the public URL is https).
    pub secure_cookies: bool,
    /// One live connection per Strava athlete.
    pub riders: Slots<u64>,
    /// Logins from the app's system sign-in sheet.
    pub app_logins: AppLogins,
}

impl Strava {
    pub fn new(
        config: StravaConfig,
        required: bool,
        secure_cookies: bool,
        store: Option<SessionStore>,
    ) -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("OpenRadlr/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            config,
            accounts: store.map_or_else(Accounts::default, |store| Accounts::with_store(store, now_s())),
            http,
            required,
            secure_cookies,
            riders: Slots::new(1),
            app_logins: AppLogins::default(),
        })
    }

    /// The account behind the request's session cookie.
    pub fn account(&self, headers: &HeaderMap) -> Option<(String, Account)> {
        let cookies = headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok());
        let session = cookie_value(cookies, SESSION_COOKIE)?.to_owned();
        let account = self.accounts.get(&session, now_s())?;
        Some((session, account))
    }

    /// A valid access token, refreshed first if it is about to expire.
    async fn access_token(&self, account: &Account) -> Result<String, strava_api::StravaError> {
        if !account.needs_refresh(now_s()) {
            return Ok(account.access_token.clone());
        }
        let token = strava_api::refresh(&self.http, &self.config, &account.refresh_token).await?;
        self.accounts.update_tokens(account.athlete_id, &token);
        Ok(token.access_token)
    }
}

pub fn now_s() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
}

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (status, Json(serde_json::json!({ "code": code, "message": message }))).into_response()
}

fn not_configured() -> Response {
    error(
        StatusCode::NOT_FOUND,
        "strava_disabled",
        "this server has no Strava connection",
    )
}

#[derive(Debug, Deserialize)]
pub struct LoginQuery {
    /// An app login's id: the login ends in the app (see [`AppLogins`]).
    pub app: Option<String>,
}

pub async fn login(State(state): State<AppState>, Query(query): Query<LoginQuery>) -> Response {
    let Some(strava) = state.strava.as_deref() else {
        return not_configured();
    };
    let oauth_state = strava.accounts.new_state(now_s());
    let secure = strava.secure_cookies;
    let app_id = query.app.filter(|id| strava.app_logins.is_pending(id, now_s()));
    (
        AppendHeaders([
            (
                header::SET_COOKIE,
                cookie(STATE_COOKIE, &oauth_state, "/auth/strava", STATE_SECONDS, secure),
            ),
            // Always written, so a browser login after an app login ends in the browser.
            (
                header::SET_COOKIE,
                match &app_id {
                    Some(id) => cookie(APP_ID_COOKIE, id, "/auth/strava", STATE_SECONDS, secure),
                    None => cookie(APP_ID_COOKIE, "", "/auth/strava", 0, secure),
                },
            ),
        ]),
        Redirect::to(&authorize_url(&strava.config, &oauth_state)),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub scope: Option<String>,
    pub error: Option<String>,
}

pub async fn callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CallbackQuery>,
) -> Response {
    let Some(strava) = state.strava.as_deref() else {
        return not_configured();
    };
    let cookie_of = |name| {
        let cookies = headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok());
        cookie_value(cookies, name).map(str::to_owned)
    };
    let app_id = cookie_of(APP_ID_COOKIE).filter(|id| !id.is_empty());
    let back = |result: &str| Redirect::to(&login_result_url(app_id.is_some(), result, None)).into_response();
    // The rider pressed "Cancel" on Strava.
    if query.error.is_some() {
        return back("denied");
    }
    let (Some(code), Some(oauth_state)) = (query.code, query.state) else {
        return error(StatusCode::BAD_REQUEST, "bad_callback", "missing code or state");
    };
    let same_browser = cookie_of(STATE_COOKIE).as_deref() == Some(oauth_state.as_str());
    if !same_browser || !strava.accounts.take_state(&oauth_state, now_s()) {
        return back("expired");
    }

    let token = match strava_api::exchange_code(&strava.http, &strava.config, &code).await {
        Ok(token) => token,
        Err(e) => {
            tracing::warn!(error = %e, "strava token exchange failed");
            return back("failed");
        }
    };
    let Some(account) = Account::from_token(token, scope_allows_upload(query.scope.as_deref())) else {
        tracing::warn!("strava token response without athlete");
        return back("failed");
    };
    tracing::info!(
        athlete_id = account.athlete_id,
        app = app_id.is_some(),
        "strava account connected"
    );
    let session = strava.accounts.insert(account, now_s());
    let secure = strava.secure_cookies;
    let clear_state = cookie(STATE_COOKIE, "", "/auth/strava", 0, secure);
    if let Some(id) = &app_id {
        // The sign-in sheet has its own cookies: the app's web view claims the session.
        let Some(ticket) = strava.app_logins.complete(id, session.clone(), now_s()) else {
            strava.accounts.remove(&session);
            return back("expired");
        };
        let clear_app = cookie(APP_ID_COOKIE, "", "/auth/strava", 0, secure);
        return (
            AppendHeaders([(header::SET_COOKIE, clear_state), (header::SET_COOKIE, clear_app)]),
            Redirect::to(&login_result_url(true, "connected", Some(&ticket))),
        )
            .into_response();
    }
    // Two Set-Cookie headers: a plain header array would keep only the last one.
    (
        AppendHeaders([
            (
                header::SET_COOKIE,
                cookie(SESSION_COOKIE, &session, "/", SESSION_SECONDS, secure),
            ),
            (header::SET_COOKIE, clear_state),
        ]),
        back("connected"),
    )
        .into_response()
}

#[derive(Debug, Serialize)]
pub struct AppLoginResponse {
    /// Open this in the system sign-in sheet.
    pub url: String,
}

/// The app starts a login: the secret stays in its web view, the id goes to the sign-in sheet.
pub async fn app_login(State(state): State<AppState>) -> Response {
    let Some(strava) = state.strava.as_deref() else {
        return not_configured();
    };
    let (id, secret) = strava.app_logins.start(now_s());
    (
        [(
            header::SET_COOKIE,
            cookie(
                APP_LOGIN_COOKIE,
                &secret,
                "/auth/strava/app",
                STATE_SECONDS,
                strava.secure_cookies,
            ),
        )],
        Json(AppLoginResponse {
            url: format!("/auth/strava?app={id}"),
        }),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct ClaimRequest {
    /// From the `openradlr://` URL the sign-in sheet ended on.
    pub ticket: String,
}

/// Back in the app: the web view trades its secret and the ticket for the session cookie.
pub async fn app_claim(State(state): State<AppState>, headers: HeaderMap, Json(claim): Json<ClaimRequest>) -> Response {
    let Some(strava) = state.strava.as_deref() else {
        return not_configured();
    };
    let cookies = headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok());
    let session = cookie_value(cookies, APP_LOGIN_COOKIE)
        .and_then(|secret| strava.app_logins.claim(secret, &claim.ticket, now_s()));
    let Some(session) = session else {
        return error(StatusCode::NOT_FOUND, "no_login", "no finished Strava login to claim");
    };
    let secure = strava.secure_cookies;
    (
        StatusCode::NO_CONTENT,
        AppendHeaders([
            (
                header::SET_COOKIE,
                cookie(SESSION_COOKIE, &session, "/", SESSION_SECONDS, secure),
            ),
            (
                header::SET_COOKIE,
                cookie(APP_LOGIN_COOKIE, "", "/auth/strava/app", 0, secure),
            ),
        ]),
    )
        .into_response()
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(strava) = state.strava.as_deref() else {
        return not_configured();
    };
    if let Some((session, _)) = strava.account(&headers) {
        strava.accounts.remove(&session);
    }
    (
        StatusCode::NO_CONTENT,
        [(
            header::SET_COOKIE,
            cookie(SESSION_COOKIE, "", "/", 0, strava.secure_cookies),
        )],
    )
        .into_response()
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub athlete_id: u64,
    pub name: String,
    pub can_upload: bool,
}

pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(strava) = state.strava.as_deref() else {
        return not_configured();
    };
    match strava.account(&headers) {
        Some((_, account)) => Json(MeResponse {
            athlete_id: account.athlete_id,
            name: account.name,
            can_upload: account.can_upload,
        })
        .into_response(),
        None => error(
            StatusCode::UNAUTHORIZED,
            "not_connected",
            "connect your Strava account first",
        ),
    }
}

#[derive(Debug, Deserialize)]
pub struct UploadQuery {
    pub name: Option<String>,
}

pub async fn upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<UploadQuery>,
    body: axum::body::Bytes,
) -> Response {
    let Some(strava) = state.strava.as_deref() else {
        return not_configured();
    };
    let Some((_, account)) = strava.account(&headers) else {
        return error(
            StatusCode::UNAUTHORIZED,
            "not_connected",
            "connect your Strava account first",
        );
    };
    if !account.can_upload {
        return error(
            StatusCode::FORBIDDEN,
            "upload_not_allowed",
            "allow \"upload activities\" when connecting Strava",
        );
    }
    let Some(ride) = strava_api::RideFile::detect(&body) else {
        return error(
            StatusCode::BAD_REQUEST,
            "not_a_ride",
            "the ride must be a FIT or TCX file",
        );
    };
    let name: String = query
        .name
        .unwrap_or_else(|| "OpenRadlr".into())
        .chars()
        .filter(|c| !c.is_control())
        .take(100)
        .collect();
    let access_token = match strava.access_token(&account).await {
        Ok(token) => token,
        Err(e) => {
            tracing::warn!(error = %e, "strava token refresh failed");
            return error(
                StatusCode::BAD_GATEWAY,
                "strava_unavailable",
                "could not reach Strava, try again",
            );
        }
    };
    let external_id = format!("openradlr-{}-{}", account.athlete_id, now_s());
    match strava_api::upload(
        &strava.http,
        &access_token,
        ride,
        &name,
        &strava_api::description(&strava.config.public_url),
        &external_id,
    )
    .await
    {
        Ok(status) => Json(status).into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "strava upload failed");
            error(
                StatusCode::BAD_GATEWAY,
                "upload_failed",
                "Strava didn't accept the upload, try again later",
            )
        }
    }
}

pub async fn upload_status(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<u64>) -> Response {
    let Some(strava) = state.strava.as_deref() else {
        return not_configured();
    };
    let Some((_, account)) = strava.account(&headers) else {
        return error(
            StatusCode::UNAUTHORIZED,
            "not_connected",
            "connect your Strava account first",
        );
    };
    let access_token = match strava.access_token(&account).await {
        Ok(token) => token,
        Err(_) => return error(StatusCode::BAD_GATEWAY, "strava_unavailable", "could not reach Strava"),
    };
    match strava_api::upload_status(&strava.http, &access_token, id).await {
        Ok(status) => {
            // The client stops polling once the activity exists, so this runs
            // about once per upload; the update is idempotent anyway.
            if let Some(activity_id) = status.activity_id {
                if let Err(e) = strava_api::mark_virtual_ride(&strava.http, &access_token, activity_id).await {
                    tracing::warn!(error = %e, activity_id, "marking strava activity as virtual ride failed");
                }
            }
            Json(status).into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "strava upload status failed");
            error(
                StatusCode::BAD_GATEWAY,
                "status_failed",
                "could not ask Strava about the upload",
            )
        }
    }
}
