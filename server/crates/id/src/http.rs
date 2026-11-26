//! The account endpoints (see the crate docs and the design spec), mounted by the
//! game server at `/id`, on the client's own origin.
//!
//! - The session is an HttpOnly cookie, `Path=/id`, `SameSite=Lax`.
//! - Every request that changes something must be `application/json` from the
//!   service's own origin, which stops cross-site forms and scripts.
//! - Answers are never cached.

use crate::mailer::Language;
use crate::service::{IdError, IdService, SignedIn, SESSION_SECONDS};
use axum::extract::{DefaultBodyLimit, FromRequestParts, Path, Request, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::net::IpAddr;
use std::sync::Arc;

pub const COOKIE: &str = "openradlr_id";
/// The largest snapshot (profile, goals, progress, settings, best laps).
pub const MAX_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;
/// The largest ride: a ride's summary, splits and power curve are a few KB.
pub const MAX_RIDE_BYTES: usize = 256 * 1024;
/// Everything else is small.
const MAX_BODY_BYTES: usize = 16 * 1024;

/// The client's address, put into the request's extensions by the server that
/// mounts the router (it knows whether to trust a proxy); `None` if it didn't.
#[derive(Debug, Clone, Copy, Default)]
pub struct ClientIp(pub Option<IpAddr>);

impl<S: Send + Sync> FromRequestParts<S> for ClientIp {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(parts.extensions.get::<ClientIp>().copied().unwrap_or_default())
    }
}

/// The session id from the cookie, if any.
struct Session(Option<String>);

impl<S: Send + Sync> FromRequestParts<S> for Session {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(Session(session_cookie(&parts.headers)))
    }
}

fn session_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == COOKIE)
        .map(|(_, value)| value.to_owned())
        .filter(|value| !value.is_empty() && value.len() <= 128)
}

impl IntoResponse for IdError {
    fn into_response(self) -> Response {
        let (status, code) = match self {
            IdError::BadRequest(code) => (StatusCode::BAD_REQUEST, code),
            IdError::Unauthorized(code) => (StatusCode::UNAUTHORIZED, code),
            IdError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            IdError::TooManyRequests => (StatusCode::TOO_MANY_REQUESTS, "too_many_requests"),
            IdError::Full(code) => (StatusCode::INSUFFICIENT_STORAGE, code),
            IdError::MailFailed => (StatusCode::BAD_GATEWAY, "mail_failed"),
            IdError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        };
        (status, Json(json!({ "error": code }))).into_response()
    }
}

type Answer = Result<Response, IdError>;

fn cookie(service: &IdService, value: &str, max_age: i64) -> HeaderValue {
    let secure = if service.settings().secure_cookies {
        "; Secure"
    } else {
        ""
    };
    HeaderValue::from_str(&format!(
        "{COOKIE}={value}; Path=/id; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"
    ))
    .expect("session ids are hex")
}

fn signed_in(service: &IdService, signed_in: SignedIn) -> Answer {
    let mut body = service.me(&signed_in.account)?;
    body["created"] = signed_in.created.into();
    let mut response = Json(body).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie(service, &signed_in.session, SESSION_SECONDS));
    Ok(response)
}

fn signed_out(service: &IdService) -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie(service, "", 0));
    response
}

/// Refuses changes that don't come as JSON from the service's own origin.
async fn same_origin_json(State(service): State<Arc<IdService>>, request: Request, next: Next) -> Response {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        let headers = request.headers();
        let origin_ok = headers
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|origin| origin.trim_end_matches('/') == service.settings().origin);
        let json = headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().starts_with("application/json"));
        if !origin_ok {
            return IdError::BadRequest("wrong_origin").into_response();
        }
        if !json {
            return IdError::BadRequest("json_required").into_response();
        }
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// The routes, for any outer state (the service brings its own).
pub fn router<S: Clone + Send + Sync + 'static>(service: Arc<IdService>) -> Router<S> {
    Router::new()
        .route("/v1/me", get(me))
        .route("/v1/email/start", post(email_start))
        .route("/v1/email/verify", post(email_verify))
        .route("/v1/logout", post(logout))
        .route("/v1/account", delete(delete_account))
        .route("/v1/passkeys/register/options", post(register_options))
        .route("/v1/passkeys/register", post(register))
        .route("/v1/passkeys/login/options", post(login_options))
        .route("/v1/passkeys/login", post(login))
        .route("/v1/passkeys/{id}", delete(delete_passkey))
        .route("/v1/riders/challenge", post(rider_challenge))
        .route("/v1/riders", post(link_rider))
        .route(
            "/v1/riders/{rider}/snapshot",
            put(put_snapshot)
                .get(get_snapshot)
                .layer(DefaultBodyLimit::max(MAX_SNAPSHOT_BYTES)),
        )
        .route("/v1/riders/{rider}/rides", get(ride_ids))
        .route(
            "/v1/riders/{rider}/rides/{ride}",
            put(put_ride).get(get_ride).layer(DefaultBodyLimit::max(MAX_RIDE_BYTES)),
        )
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::from_fn_with_state(Arc::clone(&service), same_origin_json))
        .with_state(service)
}

fn json_text(body: String) -> Response {
    ([(header::CONTENT_TYPE, "application/json")], body).into_response()
}

async fn me(State(service): State<Arc<IdService>>, Session(session): Session) -> Answer {
    let account = service.account(session.as_deref())?;
    Ok(Json(service.me(&account)?).into_response())
}

#[derive(Deserialize)]
struct EmailStart {
    email: String,
    #[serde(default)]
    lang: Option<String>,
}

async fn email_start(
    State(service): State<Arc<IdService>>,
    ClientIp(ip): ClientIp,
    Json(body): Json<EmailStart>,
) -> Answer {
    service
        .start_email(&body.email, Language::from_tag(body.lang.as_deref()), ip)
        .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
struct EmailVerify {
    email: String,
    code: String,
}

async fn email_verify(
    State(service): State<Arc<IdService>>,
    ClientIp(ip): ClientIp,
    Json(body): Json<EmailVerify>,
) -> Answer {
    let result = service.verify_email(&body.email, &body.code, ip)?;
    signed_in(&service, result)
}

async fn logout(State(service): State<Arc<IdService>>, Session(session): Session) -> Answer {
    service.sign_out(session.as_deref())?;
    Ok(signed_out(&service))
}

/// The language a change's notice mail is written in (`{"lang": "de"}`; English without).
#[derive(Deserialize, Default)]
struct Lang {
    #[serde(default)]
    lang: Option<String>,
}

async fn delete_account(
    State(service): State<Arc<IdService>>,
    Session(session): Session,
    body: axum::body::Bytes,
) -> Answer {
    let account = service.account(session.as_deref())?;
    // An empty body (or one without `lang`) writes the notice in English.
    let lang = serde_json::from_slice::<Lang>(&body).unwrap_or_default().lang;
    service
        .delete_account(&account, Language::from_tag(lang.as_deref()))
        .await?;
    Ok(signed_out(&service))
}

async fn register_options(State(service): State<Arc<IdService>>, Session(session): Session) -> Answer {
    let account = service.account(session.as_deref())?;
    Ok(Json(service.passkey_register_options(&account)?).into_response())
}

#[derive(Deserialize)]
struct Register {
    challenge: String,
    credential_id: String,
    client_data_json: String,
    authenticator_data: String,
    public_key: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    lang: Option<String>,
}

async fn register(
    State(service): State<Arc<IdService>>,
    Session(session): Session,
    Json(body): Json<Register>,
) -> Answer {
    let account = service.account(session.as_deref())?;
    service
        .passkey_register(
            &account,
            &body.challenge,
            &body.credential_id,
            &body.client_data_json,
            &body.authenticator_data,
            &body.public_key,
            &body.name,
            Language::from_tag(body.lang.as_deref()),
        )
        .await?;
    Ok(Json(service.me(&account)?).into_response())
}

async fn login_options(State(service): State<Arc<IdService>>, ClientIp(ip): ClientIp) -> Answer {
    Ok(Json(service.passkey_login_options(ip)?).into_response())
}

#[derive(Deserialize)]
struct Login {
    challenge: String,
    credential_id: String,
    client_data_json: String,
    authenticator_data: String,
    signature: String,
}

async fn login(State(service): State<Arc<IdService>>, ClientIp(ip): ClientIp, Json(body): Json<Login>) -> Answer {
    let result = service.passkey_login(
        &body.challenge,
        &body.credential_id,
        &body.client_data_json,
        &body.authenticator_data,
        &body.signature,
        ip,
    )?;
    signed_in(&service, result)
}

async fn delete_passkey(
    State(service): State<Arc<IdService>>,
    Session(session): Session,
    Path(id): Path<String>,
) -> Answer {
    let account = service.account(session.as_deref())?;
    service.delete_passkey(&account, &id)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn rider_challenge(State(service): State<Arc<IdService>>, Session(session): Session) -> Answer {
    let account = service.account(session.as_deref())?;
    Ok(Json(json!({ "challenge": service.rider_challenge(&account) })).into_response())
}

#[derive(Deserialize)]
struct Link {
    public_key: String,
    challenge: String,
    signature: String,
    #[serde(default)]
    name: String,
}

async fn link_rider(
    State(service): State<Arc<IdService>>,
    Session(session): Session,
    Json(body): Json<Link>,
) -> Answer {
    let account = service.account(session.as_deref())?;
    let rider_id = service.link_rider(&account, &body.public_key, &body.challenge, &body.signature, &body.name)?;
    Ok(Json(json!({ "rider_id": rider_id })).into_response())
}

async fn put_snapshot(
    State(service): State<Arc<IdService>>,
    Session(session): Session,
    Path(rider): Path<String>,
    Json(body): Json<Value>,
) -> Answer {
    let account = service.account(session.as_deref())?;
    service.put_snapshot(&account, &rider, &body)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn get_snapshot(
    State(service): State<Arc<IdService>>,
    Session(session): Session,
    Path(rider): Path<String>,
) -> Answer {
    let account = service.account(session.as_deref())?;
    Ok(json_text(service.snapshot(&account, &rider)?))
}

async fn ride_ids(
    State(service): State<Arc<IdService>>,
    Session(session): Session,
    Path(rider): Path<String>,
) -> Answer {
    let account = service.account(session.as_deref())?;
    Ok(Json(json!({ "ids": service.ride_ids(&account, &rider)? })).into_response())
}

async fn put_ride(
    State(service): State<Arc<IdService>>,
    Session(session): Session,
    Path((rider, ride)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Answer {
    let account = service.account(session.as_deref())?;
    service.put_ride(&account, &rider, &ride, &body)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn get_ride(
    State(service): State<Arc<IdService>>,
    Session(session): Session,
    Path((rider, ride)): Path<(String, String)>,
) -> Answer {
    let account = service.account(session.as_deref())?;
    Ok(json_text(service.ride(&account, &rider, &ride)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::testing::{fixture, Fixture, ORIGIN};
    use axum::body::Body;
    use http_body_util::BodyExt as _;
    use tower::ServiceExt as _;

    struct Reply {
        status: StatusCode,
        headers: HeaderMap,
        body: Value,
    }

    async fn call(app: &Router, method: Method, path: &str, cookie: Option<&str>, body: Option<Value>) -> Reply {
        let mut request = axum::http::Request::builder()
            .method(method)
            .uri(path)
            .header(header::ORIGIN, ORIGIN);
        if let Some(cookie) = cookie {
            request = request.header(header::COOKIE, format!("{COOKIE}={cookie}"));
        }
        let request = match body {
            Some(body) => request
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string())),
            None => request
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::empty()),
        }
        .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        Reply { status, headers, body }
    }

    fn session_from(reply: &Reply) -> String {
        let set = reply.headers[header::SET_COOKIE].to_str().unwrap();
        set.split(';').next().unwrap().split_once('=').unwrap().1.to_owned()
    }

    async fn signed_in_app() -> (Fixture, Router, String) {
        let f = fixture();
        let app: Router = router(Arc::clone(&f.service));
        let start = call(
            &app,
            Method::POST,
            "/v1/email/start",
            None,
            Some(json!({"email": "anna@example.org"})),
        )
        .await;
        assert_eq!(start.status, StatusCode::NO_CONTENT);
        let verify = call(
            &app,
            Method::POST,
            "/v1/email/verify",
            None,
            Some(json!({"email": "anna@example.org", "code": f.inbox.last_code()})),
        )
        .await;
        assert_eq!(verify.status, StatusCode::OK);
        let session = session_from(&verify);
        (f, app, session)
    }

    #[tokio::test]
    async fn signing_in_by_code_sets_an_http_only_cookie_scoped_to_id() {
        let f = fixture();
        let app: Router = router(Arc::clone(&f.service));
        call(
            &app,
            Method::POST,
            "/v1/email/start",
            None,
            Some(json!({"email": "anna@example.org"})),
        )
        .await;
        let reply = call(
            &app,
            Method::POST,
            "/v1/email/verify",
            None,
            Some(json!({"email": "anna@example.org", "code": f.inbox.last_code()})),
        )
        .await;
        let set = reply.headers[header::SET_COOKIE].to_str().unwrap();
        assert!(
            set.contains("HttpOnly")
                && set.contains("Path=/id")
                && set.contains("SameSite=Lax")
                && set.contains("Secure")
        );
        assert_eq!(
            (reply.body["email"].as_str(), reply.body["created"].as_bool()),
            (Some("anna@example.org"), Some(true))
        );
    }

    #[tokio::test]
    async fn me_answers_with_the_account_or_401() {
        let (_f, app, session) = signed_in_app().await;
        let reply = call(&app, Method::GET, "/v1/me", Some(&session), None).await;
        assert_eq!(reply.body["email"], "anna@example.org");
        let signed_out = call(&app, Method::GET, "/v1/me", None, None).await;
        assert_eq!(
            (signed_out.status, signed_out.body["error"].as_str()),
            (StatusCode::UNAUTHORIZED, Some("signed_out"))
        );
    }

    #[tokio::test]
    async fn answers_are_not_cached() {
        let (_f, app, session) = signed_in_app().await;
        let reply = call(&app, Method::GET, "/v1/me", Some(&session), None).await;
        assert_eq!(reply.headers[header::CACHE_CONTROL], "no-store");
    }

    #[tokio::test]
    async fn a_change_from_another_origin_is_refused() {
        let (_f, app, session) = signed_in_app().await;
        let request = axum::http::Request::builder()
            .method(Method::DELETE)
            .uri("/v1/account")
            .header(header::ORIGIN, "https://evil.example")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::COOKIE, format!("{COOKIE}={session}"))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            call(&app, Method::GET, "/v1/me", Some(&session), None).await.status,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn a_form_post_is_refused() {
        let f = fixture();
        let app: Router = router(Arc::clone(&f.service));
        let request = axum::http::Request::builder()
            .method(Method::POST)
            .uri("/v1/email/start")
            .header(header::ORIGIN, ORIGIN)
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(Body::from("email=anna@example.org"))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(f.inbox.mails.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn signing_out_clears_the_cookie_and_ends_the_session() {
        let (_f, app, session) = signed_in_app().await;
        let reply = call(&app, Method::POST, "/v1/logout", Some(&session), Some(json!({}))).await;
        assert!(reply.headers[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .contains("Max-Age=0"));
        assert_eq!(
            call(&app, Method::GET, "/v1/me", Some(&session), None).await.status,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn a_wrong_code_is_401() {
        let f = fixture();
        let app: Router = router(Arc::clone(&f.service));
        call(
            &app,
            Method::POST,
            "/v1/email/start",
            None,
            Some(json!({"email": "anna@example.org"})),
        )
        .await;
        let code = if f.inbox.last_code() == "000000" {
            "000001"
        } else {
            "000000"
        };
        let reply = call(
            &app,
            Method::POST,
            "/v1/email/verify",
            None,
            Some(json!({"email": "anna@example.org", "code": code})),
        )
        .await;
        assert_eq!(
            (reply.status, reply.body["error"].as_str()),
            (StatusCode::UNAUTHORIZED, Some("wrong_code"))
        );
        assert!(!reply.headers.contains_key(header::SET_COOKIE));
    }

    #[tokio::test]
    async fn a_passkey_registered_over_http_signs_in_over_http() {
        use crate::webauthn::soft::Authenticator;
        let (_f, app, session) = signed_in_app().await;
        let authenticator = Authenticator::new(6);
        let options = call(
            &app,
            Method::POST,
            "/v1/passkeys/register/options",
            Some(&session),
            Some(json!({})),
        )
        .await;
        assert_eq!(options.body["rp"]["id"], "app.openradlr.com");
        let challenge = options.body["challenge"].as_str().unwrap().to_owned();
        let r = authenticator.register(&challenge, ORIGIN, "app.openradlr.com");
        let registered = call(
            &app,
            Method::POST,
            "/v1/passkeys/register",
            Some(&session),
            Some(
                json!({"challenge": challenge, "credential_id": r.credential_id, "client_data_json": r.client_data_json,
                        "authenticator_data": r.authenticator_data, "public_key": r.public_key, "name": "Phone"}),
            ),
        )
        .await;
        assert_eq!(registered.body["passkeys"][0]["name"], "Phone");

        let options = call(&app, Method::POST, "/v1/passkeys/login/options", None, Some(json!({}))).await;
        let challenge = options.body["challenge"].as_str().unwrap().to_owned();
        let a = authenticator.assert(&challenge, ORIGIN, "app.openradlr.com");
        let login = call(
            &app,
            Method::POST,
            "/v1/passkeys/login",
            None,
            Some(
                json!({"challenge": challenge, "credential_id": a.credential_id, "client_data_json": a.client_data_json,
                        "authenticator_data": a.authenticator_data, "signature": a.signature}),
            ),
        )
        .await;
        assert_eq!(
            (login.status, login.body["email"].as_str()),
            (StatusCode::OK, Some("anna@example.org"))
        );
        assert!(login.headers.contains_key(header::SET_COOKIE));
    }

    #[tokio::test]
    async fn a_ride_too_large_is_refused() {
        let (_f, app, session) = signed_in_app().await;
        let big = json!({"samples": "x".repeat(MAX_RIDE_BYTES)});
        let reply = call(&app, Method::PUT, "/v1/riders/r1/rides/1", Some(&session), Some(big)).await;
        assert_eq!(reply.status, StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn deleting_the_account_signs_out() {
        let (_f, app, session) = signed_in_app().await;
        let reply = call(&app, Method::DELETE, "/v1/account", Some(&session), None).await;
        assert_eq!(reply.status, StatusCode::NO_CONTENT);
        assert_eq!(
            call(&app, Method::GET, "/v1/me", Some(&session), None).await.status,
            StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn the_session_cookie_is_found_among_others() {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_static("a=1; openradlr_id=abc; b=2"));
        assert_eq!(session_cookie(&headers).as_deref(), Some("abc"));
        headers.insert(header::COOKIE, HeaderValue::from_static("openradlr_idx=abc"));
        assert_eq!(session_cookie(&headers), None);
    }
}
