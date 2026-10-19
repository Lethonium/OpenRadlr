//! HTTP routes.
//!
//! | Route              | Purpose                                              |
//! |--------------------|------------------------------------------------------|
//! | `/healthz`         | Liveness probe for Docker and load balancers         |
//! | `/api/info`        | Server name, version, players, the routes to pick    |
//! | `/api/route?id=…`  | A full route file (the default route without `id`)   |
//! | `/api/map?id=…`    | A shared map's road network file, unchanged          |
//! | `/api/studio`      | Spin studio classes and the upcoming timetable       |
//! | `/ws`              | WebSocket game protocol                              |
//! | `/auth/*`, `/api/me`, `/api/strava/*` | Strava account and uploads (see [`crate::auth`]) |
//! | `/*`               | Browser client (only if a static dir is set)         |

use crate::app::unix_now_s;
use crate::auth::{self, Strava};
use crate::connection;
use crate::guard::{client_ip, origin_allowed, ConnectionLimits, Slots};
use crate::map_file::Maps;
use crate::protocol::{DeviceKind, EventInfoWire, PROTOCOL_VERSION};
use crate::route_file::RouteFile;
use crate::stats::DistanceStats;
use crate::studio::{STUDIO_ID, STUDIO_NAME};
use crate::worlds::{StudioEntry, WorldEntry, Worlds};
use crate::ServerInfo;
use axum::extract::connect_info::ConnectInfo;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{DefaultBodyLimit, Query, State};
use axum::http::{header, Extensions, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use openradlr_sim::studio::{ClassPlan, Timetable, LOBBY_S, SEATS_PER_ROOM, SLOT_S};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::Arc;
use tower_http::services::ServeDir;
use tower_http::set_header::{SetResponseHeader, SetResponseHeaderLayer};
use tower_http::trace::TraceLayer;

/// Largest WebSocket message a client may send.
const MAX_MESSAGE_BYTES: usize = 16 * 1024;
/// Largest ride file for uploads (a 4-hour ride is about 3 MB of TCX).
const MAX_UPLOAD_BYTES: usize = 16 * 1024 * 1024;

/// Shared limits that protect the server from floods and scripts.
pub struct Protection {
    /// One seat per joined rider, across all worlds (`OPENRADLR_MAX_PLAYERS`).
    pub seats: Slots<()>,
    /// The same for riders on phone paddles (`OPENRADLR_MAX_PADDLE_PLAYERS`): they never take a trainer rider's seat.
    pub paddle_seats: Slots<()>,
    /// Open WebSocket connections per client IP.
    pub per_ip: Slots<IpAddr>,
    pub trust_proxy: bool,
    pub allowed_origins: Vec<String>,
    pub limits: ConnectionLimits,
}

impl Protection {
    /// The seat pool a rider on this device takes from.
    pub fn seats_for(&self, device: DeviceKind) -> &Slots<()> {
        match device {
            DeviceKind::Paddle => &self.paddle_seats,
            _ => &self.seats,
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub worlds: Arc<Worlds>,
    /// Road network files by map id (ADR 0010).
    pub maps: Arc<Maps>,
    pub info: Arc<ServerInfo>,
    /// Seats for trainer riders; phone riders have `max_paddle_players` of their own.
    pub max_players: usize,
    pub max_paddle_players: usize,
    pub protection: Arc<Protection>,
    /// `None` when the server has no Strava API app configured.
    pub strava: Option<Arc<Strava>>,
    pub allow_simulated_trainer: bool,
    pub allow_paddle_mode: bool,
    /// Community distance totals (#65).
    pub stats: DistanceStats,
}

#[derive(Debug, Serialize)]
pub struct InfoResponse {
    pub name: String,
    pub version: String,
    /// Git commit and date of this server's build, so a client can tell it is out of date.
    pub build: crate::BuildInfo,
    pub protocol_version: u32,
    pub auth_mode: String,
    pub players: usize,
    /// Of those, the riders on phone paddles (not in the studio).
    pub phone_players: usize,
    /// Seats for trainer (and simulated) riders.
    pub max_players: usize,
    /// Seats for riders on phone paddles, apart from `max_players`.
    pub max_phone_players: usize,
    /// The default route (kept for older clients).
    pub route: RouteSummary,
    pub routes: Vec<RouteSummary>,
    pub strava: StravaInfo,
    /// Server clock (Unix seconds), to read `events` against.
    pub now_s: f64,
    /// Scheduled events of all worlds, soonest start first.
    pub events: Vec<EventInfoWire>,
    /// The spin studio, if this server hosts one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub studio: Option<StudioSummary>,
    /// Whether the start screen offers the simulated trainer. Only a UI
    /// switch: a script can always send made-up power.
    pub simulated_trainer: bool,
    /// Whether riders may join with phone paddles (tapping for power).
    pub paddle_mode: bool,
    /// Analytics script the client loads; absent unless the operator enabled it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analytics: Option<crate::config::Analytics>,
    /// The operator's privacy policy; absent unless set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_url: Option<String>,
    /// Metres ridden on this server since the counters began, by device (#65).
    /// The device is the client's own claim, so this is a vanity counter.
    pub distance_m: DistanceInfo,
}

#[derive(Debug, Serialize)]
pub struct DistanceInfo {
    pub trainer: f64,
    pub paddle: f64,
}

#[derive(Debug, Serialize)]
pub struct StravaInfo {
    pub enabled: bool,
    /// Joining needs a connected Strava account.
    pub required: bool,
}

#[derive(Debug, Serialize)]
pub struct RouteSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub length_m: f64,
    pub elevation_gain_m: f64,
    pub players: usize,
    /// Of those, the riders on phone paddles.
    pub phone_players: usize,
}

impl RouteSummary {
    fn of(entry: &WorldEntry) -> Self {
        Self {
            id: entry.file.id.clone(),
            name: entry.file.name.clone(),
            description: entry.file.description.clone(),
            length_m: entry.length_m.round(),
            elevation_gain_m: entry.elevation_gain_m.round(),
            players: entry.game.players_on(&entry.file.id),
            phone_players: entry.game.phones_on(&entry.file.id),
        }
    }
}

/// A class in the timetable.
#[derive(Debug, Serialize)]
pub struct SlotSummary {
    pub class_id: String,
    pub name: String,
    /// Unix time in seconds when the class starts (the lobby opens 5 min earlier).
    pub starts_at_s: f64,
}

impl SlotSummary {
    /// The class of the slot that is `ahead` slots after the one at `now_s`.
    fn at(timetable: &Timetable, now_s: f64, ahead: u32) -> Self {
        let clock = timetable.at(now_s + f64::from(ahead * SLOT_S));
        let class = timetable.class(&clock);
        Self {
            class_id: class.id.clone(),
            name: class.name.clone(),
            starts_at_s: clock.starts_at_s,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StudioSummary {
    pub id: &'static str,
    pub name: &'static str,
    pub players: usize,
    /// The class of the current slot (in its lobby while `starts_at_s` lies ahead).
    pub class: SlotSummary,
    pub next: SlotSummary,
}

impl StudioSummary {
    fn of(entry: &StudioEntry, now_s: f64) -> Self {
        Self {
            id: STUDIO_ID,
            name: STUDIO_NAME,
            players: entry.game.player_count(),
            class: SlotSummary::at(&entry.timetable, now_s, 0),
            next: SlotSummary::at(&entry.timetable, now_s, 1),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SegmentInfo {
    pub duration_s: u32,
    /// Power as a fraction of FTP, ramping from `from` to `to`.
    pub from: f64,
    pub to: f64,
    /// Cadence range in rpm the instructor asks for.
    pub cadence: Option<[u32; 2]>,
    pub cue: String,
}

#[derive(Debug, Serialize)]
pub struct ClassInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub duration_s: u32,
    pub segments: Vec<SegmentInfo>,
}

impl ClassInfo {
    fn of(class: &ClassPlan) -> Self {
        Self {
            id: class.id.clone(),
            name: class.name.clone(),
            description: class.description.clone(),
            duration_s: class.duration_s(),
            segments: class
                .segments
                .iter()
                .map(|s| SegmentInfo {
                    duration_s: s.duration_s,
                    from: s.from,
                    to: s.to,
                    cadence: s.cadence.map(|(lo, hi)| [lo, hi]),
                    cue: s.cue.clone(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StudioResponse {
    pub id: &'static str,
    pub name: &'static str,
    pub slot_s: u32,
    pub lobby_s: u32,
    pub seats_per_room: usize,
    pub classes: Vec<ClassInfo>,
    /// The current slot and the next few.
    pub schedule: Vec<SlotSummary>,
}

#[derive(Debug, Deserialize)]
pub struct RouteQuery {
    pub id: Option<String>,
}

/// `headers` (see [`crate::headers`]) go on every response that doesn't set them itself.
pub fn router(state: AppState, static_dir: Option<&Path>, headers: &[(header::HeaderName, String)]) -> Router {
    let router = Router::new()
        .route("/healthz", get(healthz))
        .route("/internal/metrics", get(metrics))
        .route("/api/info", get(info))
        .route("/api/route", get(route))
        .route("/api/map", get(map))
        .route("/api/studio", get(studio))
        .route("/ws", get(websocket))
        .route("/auth/strava", get(auth::login))
        .route("/auth/strava/callback", get(auth::callback))
        .route("/auth/strava/app", post(auth::app_login))
        .route("/auth/strava/app/claim", post(auth::app_claim))
        .route("/auth/logout", post(auth::logout))
        .route("/api/me", get(auth::me))
        .route(
            "/api/strava/upload",
            post(auth::upload).layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES)),
        )
        .route("/api/strava/upload/{id}", get(auth::upload_status))
        .with_state(state);

    let router = match static_dir {
        // Revalidate on every load (cheap: 304 when unchanged), so a deploy never
        // pairs new HTML with a stylesheet the browser cached heuristically.
        Some(dir) => router.fallback_service(SetResponseHeader::overriding(
            ServeDir::new(dir),
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        )),
        None => router,
    };
    let router = headers.iter().fold(router, |router, (name, value)| {
        let value = HeaderValue::from_str(value).expect("security headers are plain ASCII");
        router.layer(SetResponseHeaderLayer::if_not_present(name.clone(), value))
    });
    router.layer(TraceLayer::new_for_http())
}

async fn healthz() -> &'static str {
    "ok"
}

// This endpoint is intended for the host's private Prometheus network. It only
// exports aggregate counters already exposed by /api/info; never rider data,
// names, IDs, credentials, or request details.
async fn metrics(State(state): State<AppState>) -> ([(header::HeaderName, &'static str); 1], String) {
    let distance = state.stats.snapshot();
    let body = metrics_body(
        state.worlds.player_count(),
        state.worlds.phone_count(),
        state.max_players,
        state.max_paddle_players,
        distance.trainer_m,
        distance.paddle_m,
    );
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        body,
    )
}

fn metrics_body(
    players: usize,
    phone_players: usize,
    player_capacity: usize,
    phone_capacity: usize,
    trainer_m: f64,
    paddle_m: f64,
) -> String {
    format!(
        "# HELP openradlr_players Current connected riders, including bots.\n# TYPE openradlr_players gauge\nopenradlr_players {}\n\
         # HELP openradlr_phone_players Current riders using phone paddles.\n# TYPE openradlr_phone_players gauge\nopenradlr_phone_players {}\n\
         # HELP openradlr_player_capacity Configured capacity for trainer riders.\n# TYPE openradlr_player_capacity gauge\nopenradlr_player_capacity {}\n\
         # HELP openradlr_phone_player_capacity Configured capacity for phone riders.\n# TYPE openradlr_phone_player_capacity gauge\nopenradlr_phone_player_capacity {}\n\
         # HELP openradlr_distance_metres_total Community distance recorded by device.\n# TYPE openradlr_distance_metres_total counter\nopenradlr_distance_metres_total{{device=\"trainer\"}} {}\nopenradlr_distance_metres_total{{device=\"paddle\"}} {}\n\
         ",
        players,
        phone_players,
        player_capacity,
        phone_capacity,
        trainer_m,
        paddle_m,
    )
}

#[cfg(test)]
mod metrics_tests {
    use super::metrics_body;

    #[test]
    fn metrics_export_only_aggregate_operational_stats() {
        let output = metrics_body(4, 1, 50, 20, 12_500.0, 750.0);

        assert!(output.contains("openradlr_players 4\n"));
        assert!(output.contains("openradlr_phone_players 1\n"));
        assert!(output.contains("openradlr_distance_metres_total{device=\"trainer\"} 12500\n"));
        assert!(output.contains("openradlr_distance_metres_total{device=\"paddle\"} 750\n"));
        assert!(!output.contains("name="));
        assert!(!output.contains("token"));
    }
}

async fn info(State(state): State<AppState>) -> Json<InfoResponse> {
    let now_s = unix_now_s();
    let mut events: Vec<EventInfoWire> = state
        .worlds
        .games()
        .into_iter()
        .flat_map(|game| game.events())
        .collect();
    events.sort_by(|a, b| a.starts_at_s.total_cmp(&b.starts_at_s));
    Json(InfoResponse {
        name: state.info.name.clone(),
        version: state.info.version.clone(),
        build: state.info.build.clone(),
        protocol_version: PROTOCOL_VERSION,
        auth_mode: state.info.auth_mode.clone(),
        players: state.worlds.player_count(),
        phone_players: state.worlds.phone_count(),
        max_players: state.max_players,
        max_phone_players: state.max_paddle_players,
        route: RouteSummary::of(state.worlds.default_world()),
        routes: state.worlds.iter().map(RouteSummary::of).collect(),
        strava: StravaInfo {
            enabled: state.strava.is_some(),
            required: state.strava.as_ref().is_some_and(|s| s.required),
        },
        now_s,
        events,
        studio: state.worlds.studio().map(|entry| StudioSummary::of(entry, now_s)),
        simulated_trainer: state.allow_simulated_trainer,
        paddle_mode: state.allow_paddle_mode,
        analytics: state.info.analytics.clone(),
        privacy_url: state.info.privacy_url.clone(),
        distance_m: {
            let totals = state.stats.snapshot();
            // Whole metres: the exact fraction is noise.
            DistanceInfo {
                trainer: totals.trainer_m.round(),
                paddle: totals.paddle_m.round(),
            }
        },
    })
}

async fn studio(State(state): State<AppState>) -> Result<Json<StudioResponse>, StatusCode> {
    let entry = state.worlds.studio().ok_or(StatusCode::NOT_FOUND)?;
    let now_s = unix_now_s();
    Ok(Json(StudioResponse {
        id: STUDIO_ID,
        name: STUDIO_NAME,
        slot_s: SLOT_S,
        lobby_s: LOBBY_S,
        seats_per_room: SEATS_PER_ROOM,
        classes: entry.timetable.classes().iter().map(ClassInfo::of).collect(),
        schedule: (0..6)
            .map(|ahead| SlotSummary::at(&entry.timetable, now_s, ahead))
            .collect(),
    }))
}

async fn route(State(state): State<AppState>, Query(query): Query<RouteQuery>) -> Result<Json<RouteFile>, StatusCode> {
    let entry = state.worlds.get(query.id.as_deref()).ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json((*entry.file).clone()))
}

#[derive(Debug, Deserialize)]
pub struct MapQuery {
    pub id: String,
}

async fn map(State(state): State<AppState>, Query(query): Query<MapQuery>) -> Result<Response, StatusCode> {
    let json = state.maps.get(&query.id).ok_or(StatusCode::NOT_FOUND)?;
    Ok(([(header::CONTENT_TYPE, "application/json")], json.to_string()).into_response())
}

async fn websocket(
    upgrade: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    extensions: Extensions,
) -> Response {
    let protection = Arc::clone(&state.protection);
    let origin = headers.get(header::ORIGIN).and_then(|value| value.to_str().ok());
    if !origin_allowed(origin, &protection.allowed_origins) {
        tracing::warn!(
            origin = origin.unwrap_or("-"),
            "websocket from a foreign origin rejected"
        );
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }

    // Without connection info (e.g. in tests) or a usable address, no per-IP limit applies.
    let peer = extensions.get::<ConnectInfo<SocketAddr>>().map(|info| info.0);
    let forwarded_for = headers.get("x-forwarded-for").and_then(|value| value.to_str().ok());
    let ip_permit = match client_ip(peer, forwarded_for, protection.trust_proxy) {
        Some(ip) => match protection.per_ip.try_acquire(ip) {
            Some(permit) => Some(permit),
            None => {
                tracing::warn!(%ip, "too many connections from one address");
                return (StatusCode::TOO_MANY_REQUESTS, "too many connections from your address").into_response();
            }
        },
        None => None,
    };

    // Strava as the account: one connection per athlete.
    let mut athlete_permit = None;
    if let Some(strava) = state.strava.as_deref().filter(|s| s.required) {
        let Some((_, account)) = strava.account(&headers) else {
            return (StatusCode::UNAUTHORIZED, "connect your Strava account first").into_response();
        };
        match strava.riders.try_acquire(account.athlete_id) {
            Some(permit) => athlete_permit = Some(permit),
            None => return (StatusCode::CONFLICT, "this Strava account is already riding").into_response(),
        }
    }

    upgrade
        .max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| async move {
            connection::serve(socket, state).await;
            drop(ip_permit);
            drop(athlete_permit);
        })
}
