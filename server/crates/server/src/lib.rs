//! # openradlr-server
//!
//! Network adapter around the `openradlr-sim` core. Layers, from the outside in:
//!
//! * [`http`] — axum router: health check, info, routes, WebSocket, static client
//! * [`connection`] — drives one WebSocket with a [`session::Session`]
//! * [`session`] — per-connection protocol state machine and limits
//! * [`guard`] — rate limits, connection caps, client IPs behind a proxy
//! * [`worlds`] — one world (and game loop) per route, plus the spin studio
//! * [`map_file`] — road network files of shared maps, served to clients
//! * [`auth`], [`strava`], [`strava_api`] — optional Strava account and uploads
//! * [`stats`] — community distance counters, kept across restarts
//! * [`runtime`] — async game loop task and its command channel
//! * [`game`] — synchronous game core: clients, broadcasts, resistance
//! * [`studio`] — the spin studio's game core: rooms, class state
//! * [`vehicle_codes`] — registry of boarding codes across worlds
//! * [`protocol`] — JSON message types and mapping from the simulation
//!
//! [`app::build`] composes everything; it is the composition root used by
//! `main.rs` and by the integration tests.

pub mod app;
pub mod auth;
pub mod config;
pub mod connection;
pub mod events_file;
pub mod game;
pub mod guard;
pub mod headers;
pub mod healthcheck;
pub mod http;
pub mod map_file;
pub mod players;
pub mod protocol;
pub mod resume;
pub mod route_file;
pub mod runtime;
pub mod secure_random;
pub mod session;
pub mod session_store;
pub mod stats;
pub mod strava;
pub mod strava_api;
pub mod studio;
pub mod vehicle_codes;
pub mod worlds;

/// Which build is running: set by the Docker build (`OPENRADLR_BUILD_SHA`, `OPENRADLR_BUILD_DATE`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct BuildInfo {
    pub sha: String,
    pub date: String,
}

impl BuildInfo {
    pub fn new(sha: Option<String>, date: Option<String>) -> Self {
        let clean = |v: Option<String>, fallback: &str| {
            v.map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| fallback.to_owned())
        };
        Self {
            sha: clean(sha, "dev"),
            date: clean(date, ""),
        }
    }

    pub fn from_env() -> Self {
        Self::new(
            std::env::var("OPENRADLR_BUILD_SHA").ok(),
            std::env::var("OPENRADLR_BUILD_DATE").ok(),
        )
    }
}

/// Static facts about this server, shown to clients.
#[derive(Debug, Clone, PartialEq)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
    /// Git commit and build date of this server (`dev` when built outside Docker).
    pub build: BuildInfo,
    pub auth_mode: String,
    /// The default route, joined when a client doesn't pick one.
    pub route_id: String,
    /// Riders may join with the simulated trainer / with phone paddles.
    pub allow_simulated_trainer: bool,
    pub allow_paddle_mode: bool,
    /// Analytics the client should load, if the operator set one up.
    pub analytics: Option<config::Analytics>,
    /// The operator's privacy policy, if they set one.
    pub privacy_url: Option<String>,
    /// Seconds a rider lingers after their socket dies before being removed.
    pub grace_s: f64,
}

#[cfg(test)]
mod tests {
    use super::BuildInfo;

    #[test]
    fn build_falls_back_to_dev() {
        let none = BuildInfo::new(None, None);
        assert_eq!((none.sha.as_str(), none.date.as_str()), ("dev", ""));
        let blank = BuildInfo::new(Some("  ".into()), None);
        assert_eq!(blank.sha, "dev");
        let set = BuildInfo::new(Some("3f2a9c1\n".into()), Some("2026-10-16T09:12Z".into()));
        assert_eq!((set.sha.as_str(), set.date.as_str()), ("3f2a9c1", "2026-10-16T09:12Z"));
    }
}
