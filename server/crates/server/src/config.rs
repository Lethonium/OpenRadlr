//! Server configuration, read from `OPENRADLR_*` environment variables.
//!
//! Parsing goes through [`Config::from_lookup`], which takes the variable
//! lookup as a function. Production passes `std::env::var`, tests pass a map.

use crate::guard::ConnectionLimits;
use crate::strava::StravaConfig;
use openradlr_sim::SimConfig;
use std::fmt;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMode {
    /// Anyone with a local profile may join.
    Open,
}

impl AuthMode {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthMode::Open => "open",
        }
    }
}

/// Where scheduled events come from (`OPENRADLR_EVENTS`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventsSetting {
    /// The built-in timetable on every world.
    Default,
    /// No scheduled events.
    Off,
    /// A JSON events file.
    File(PathBuf),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub bind_addr: SocketAddr,
    /// The default route; it is always loaded and listed first.
    pub route_file: PathBuf,
    /// Every `*.json` route in this directory becomes a world riders can pick.
    pub routes_dir: Option<PathBuf>,
    /// Directory with the browser client. `None` disables static hosting.
    pub static_dir: Option<PathBuf>,
    pub server_name: String,
    pub tick_hz: u32,
    pub broadcast_hz: u32,
    pub max_players: usize,
    /// Seats for riders on phone paddles, apart from `max_players`.
    pub max_paddle_players: usize,
    /// Most riders in one `state` message (humans first, then bots).
    pub max_visible_riders: usize,
    pub target_riders: usize,
    /// Fixed seed for reproducible bots. `None` picks a random seed at start.
    pub bot_seed: Option<u64>,
    pub race_countdown_s: f64,
    pub max_race_laps: u32,
    pub auth_mode: AuthMode,
    /// Take client IPs from `X-Forwarded-For` (only behind a reverse proxy).
    pub trust_proxy: bool,
    pub max_connections_per_ip: usize,
    pub messages_per_second: f64,
    /// Seconds a rider lingers (coasting) after their socket dies before
    /// being removed; `0` removes at once.
    pub grace_s: f64,
    /// WebSocket origins allowed to connect; empty allows all.
    pub allowed_origins: Vec<String>,
    /// The address riders use, e.g. `https://ride.example.com` (needed for Strava).
    pub public_url: Option<String>,
    /// "Connect with Strava", if a Strava API app is configured.
    pub strava: Option<StravaConfig>,
    /// Where Strava logins are kept so they survive restarts (`OPENRADLR_DATA_DIR`, with the key).
    pub data_dir: Option<std::path::PathBuf>,
    /// Encrypts the stored Strava refresh tokens (`OPENRADLR_SECRET_KEY`).
    pub secret_key: Option<String>,
    /// Where the community distance totals are kept (`OPENRADLR_STATS_FILE`,
    /// else `stats.json` in the data dir); `None` keeps them in memory only.
    pub stats_file: Option<std::path::PathBuf>,
    /// Only riders with a connected Strava account may join.
    pub require_strava: bool,
    /// Offer the simulated trainer (keyboard power) on the start screen.
    pub allow_simulated_trainer: bool,
    /// Offer phone paddles (power from tapping) on the start screen.
    pub allow_paddle_mode: bool,
    /// Host the spin studio next to the routes.
    pub studio: bool,
    /// Scheduled events: built-in, off, or from a file.
    pub events: EventsSetting,
    /// Seconds before an event's start that its lobby opens (default for entries).
    pub event_lobby_s: f64,
    /// Plausible-style page analytics for the browser client; `None` (default) = none.
    pub analytics: Option<Analytics>,
    /// The operator's privacy policy, linked from the start menu (`OPENRADLR_PRIVACY_URL`).
    pub privacy_url: Option<String>,
}

/// A Plausible-compatible analytics script the client loads on request of the operator.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Analytics {
    /// The site the visits are reported under (`data-domain`).
    pub domain: String,
    /// URL of the tracking script (https).
    pub script: String,
}

const DEFAULT_ANALYTICS_SCRIPT: &str = "https://plausible.io/js/script.js";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    pub key: &'static str,
    pub value: String,
    pub reason: String,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid value {:?} for {}: {}", self.value, self.key, self.reason)
    }
}

impl std::error::Error for ConfigError {}

impl Default for Config {
    fn default() -> Self {
        Self::from_lookup(|_| None).expect("defaults are valid")
    }
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let reader = Reader { lookup: &lookup };

        let tick_hz: u32 = reader.parse("OPENRADLR_TICK_HZ", 20)?;
        reader.check(
            "OPENRADLR_TICK_HZ",
            tick_hz,
            (1..=120).contains(&tick_hz),
            "must be between 1 and 120",
        )?;

        let broadcast_hz: u32 = reader.parse("OPENRADLR_BROADCAST_HZ", 4)?;
        reader.check(
            "OPENRADLR_BROADCAST_HZ",
            broadcast_hz,
            (1..=tick_hz).contains(&broadcast_hz),
            "must be between 1 and OPENRADLR_TICK_HZ",
        )?;

        let max_players: usize = reader.parse("OPENRADLR_MAX_PLAYERS", 50)?;
        reader.check(
            "OPENRADLR_MAX_PLAYERS",
            max_players,
            max_players >= 1,
            "must be at least 1",
        )?;

        let max_paddle_players: usize = reader.parse("OPENRADLR_MAX_PADDLE_PLAYERS", 20)?;

        let max_visible_riders: usize = reader.parse("OPENRADLR_MAX_VISIBLE_RIDERS", 200)?;
        reader.check(
            "OPENRADLR_MAX_VISIBLE_RIDERS",
            max_visible_riders,
            max_visible_riders >= 1,
            "must be at least 1",
        )?;

        let target_riders: usize = reader.parse("OPENRADLR_TARGET_RIDERS", 12)?;
        reader.check(
            "OPENRADLR_TARGET_RIDERS",
            target_riders,
            target_riders <= 200,
            "must be at most 200",
        )?;

        // Long enough for others to see the announcement and join.
        let race_countdown_s: f64 = reader.parse("OPENRADLR_RACE_COUNTDOWN_S", 30.0)?;
        reader.check(
            "OPENRADLR_RACE_COUNTDOWN_S",
            race_countdown_s,
            (0.0..=300.0).contains(&race_countdown_s),
            "must be between 0 and 300",
        )?;

        let max_race_laps: u32 = reader.parse("OPENRADLR_MAX_RACE_LAPS", 20)?;
        reader.check(
            "OPENRADLR_MAX_RACE_LAPS",
            max_race_laps,
            (1..=100).contains(&max_race_laps),
            "must be between 1 and 100",
        )?;

        let auth_mode = match reader.raw("OPENRADLR_AUTH_MODE").as_deref() {
            None | Some("open") => AuthMode::Open,
            Some(other) => {
                return Err(ConfigError {
                    key: "OPENRADLR_AUTH_MODE",
                    value: other.to_owned(),
                    reason: "only \"open\" is supported in the proof of concept".into(),
                })
            }
        };

        let max_connections_per_ip: usize = reader.parse("OPENRADLR_MAX_CONNECTIONS_PER_IP", 4)?;
        reader.check(
            "OPENRADLR_MAX_CONNECTIONS_PER_IP",
            max_connections_per_ip,
            (1..=1000).contains(&max_connections_per_ip),
            "must be between 1 and 1000",
        )?;

        let messages_per_second: f64 = reader.parse("OPENRADLR_MESSAGES_PER_SECOND", 20.0)?;
        reader.check(
            "OPENRADLR_MESSAGES_PER_SECOND",
            messages_per_second,
            (5.0..=1000.0).contains(&messages_per_second),
            "must be between 5 and 1000",
        )?;

        let grace_s: f64 = reader.parse("OPENRADLR_GRACE_S", 60.0)?;
        reader.check(
            "OPENRADLR_GRACE_S",
            grace_s,
            grace_s.is_finite() && grace_s >= 0.0,
            "must be a finite number of seconds (0 or more)",
        )?;

        let allowed_origins: Vec<String> = reader
            .raw("OPENRADLR_ALLOWED_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(|origin| origin.trim().trim_end_matches('/').to_owned())
            .filter(|origin| !origin.is_empty())
            .collect();

        let public_url = reader
            .raw("OPENRADLR_PUBLIC_URL")
            .filter(|url| !url.is_empty())
            .map(|url| url.trim_end_matches('/').to_owned());
        if let Some(url) = &public_url {
            reader.check(
                "OPENRADLR_PUBLIC_URL",
                url,
                url.starts_with("https://") || url.starts_with("http://"),
                "must start with https:// (or http:// for local tests)",
            )?;
        }

        let client_id = reader.raw("OPENRADLR_STRAVA_CLIENT_ID").filter(|v| !v.is_empty());
        let client_secret = reader.raw("OPENRADLR_STRAVA_CLIENT_SECRET").filter(|v| !v.is_empty());
        let strava = match (client_id, client_secret) {
            (None, None) => None,
            (Some(client_id), Some(client_secret)) => {
                let Some(url) = &public_url else {
                    return Err(ConfigError {
                        key: "OPENRADLR_PUBLIC_URL",
                        value: String::new(),
                        reason: "is required for Strava (it is the address Strava sends riders back to)".into(),
                    });
                };
                Some(StravaConfig {
                    client_id,
                    client_secret,
                    redirect_uri: format!("{url}/auth/strava/callback"),
                    public_url: url.clone(),
                })
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err(ConfigError {
                    key: "OPENRADLR_STRAVA_CLIENT_SECRET",
                    value: String::new(),
                    reason: "set both OPENRADLR_STRAVA_CLIENT_ID and OPENRADLR_STRAVA_CLIENT_SECRET, or neither".into(),
                })
            }
        };
        let data_dir = reader
            .raw("OPENRADLR_DATA_DIR")
            .filter(|v| !v.is_empty())
            .map(std::path::PathBuf::from);
        let stats_file = reader
            .raw("OPENRADLR_STATS_FILE")
            .filter(|v| !v.is_empty())
            .map(std::path::PathBuf::from)
            .or_else(|| data_dir.as_ref().map(|dir| dir.join("stats.json")));
        let secret_key = reader.raw("OPENRADLR_SECRET_KEY").filter(|v| !v.is_empty());
        if let Some(key) = &secret_key {
            reader.check(
                "OPENRADLR_SECRET_KEY",
                "(hidden)",
                key.len() >= 16,
                "must be at least 16 characters (try `openssl rand -hex 32`)",
            )?;
        }
        let require_strava = reader.flag("OPENRADLR_REQUIRE_STRAVA", false)?;
        if require_strava && strava.is_none() {
            return Err(ConfigError {
                key: "OPENRADLR_REQUIRE_STRAVA",
                value: "true".into(),
                reason: "needs OPENRADLR_STRAVA_CLIENT_ID and OPENRADLR_STRAVA_CLIENT_SECRET".into(),
            });
        }

        let server_name = reader
            .raw("OPENRADLR_SERVER_NAME")
            .unwrap_or_else(|| "OpenRadlr".into());
        reader.check(
            "OPENRADLR_SERVER_NAME",
            &server_name,
            !server_name.trim().is_empty() && server_name.chars().count() <= 64,
            "must be 1 to 64 characters",
        )?;

        let events = match reader.raw("OPENRADLR_EVENTS").as_deref() {
            None | Some("" | "default") => EventsSetting::Default,
            Some("off") => EventsSetting::Off,
            Some(path) => EventsSetting::File(PathBuf::from(path)),
        };
        let event_lobby_s: f64 = reader.parse("OPENRADLR_EVENT_LOBBY_S", 600.0)?;
        reader.check(
            "OPENRADLR_EVENT_LOBBY_S",
            event_lobby_s,
            (0.0..=3600.0).contains(&event_lobby_s),
            "must be between 0 and 3600",
        )?;

        let analytics = match reader
            .raw("OPENRADLR_ANALYTICS_DOMAIN")
            .filter(|d| !d.trim().is_empty())
        {
            None => None,
            Some(domain) => {
                let script = reader
                    .raw("OPENRADLR_ANALYTICS_SCRIPT")
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| DEFAULT_ANALYTICS_SCRIPT.to_owned());
                reader.check(
                    "OPENRADLR_ANALYTICS_SCRIPT",
                    &script,
                    script.starts_with("https://"),
                    "must be an https:// URL",
                )?;
                Some(Analytics {
                    domain: domain.trim().to_owned(),
                    script,
                })
            }
        };

        let privacy_url = reader
            .raw("OPENRADLR_PRIVACY_URL")
            .map(|url| url.trim().to_owned())
            .filter(|url| !url.is_empty());
        if let Some(url) = &privacy_url {
            reader.check(
                "OPENRADLR_PRIVACY_URL",
                url,
                url.starts_with("https://") || url.starts_with("http://"),
                "must be an http:// or https:// URL",
            )?;
        }

        Ok(Self {
            bind_addr: reader.parse("OPENRADLR_BIND", SocketAddr::from(([0, 0, 0, 0], 8080)))?,
            route_file: reader
                .raw("OPENRADLR_ROUTE_FILE")
                .map_or_else(|| PathBuf::from("routes/rolling-hills.json"), PathBuf::from),
            routes_dir: reader
                .raw("OPENRADLR_ROUTES_DIR")
                .filter(|s| !s.is_empty())
                .map(PathBuf::from),
            static_dir: reader
                .raw("OPENRADLR_STATIC_DIR")
                .filter(|s| !s.is_empty())
                .map(PathBuf::from),
            server_name,
            tick_hz,
            broadcast_hz,
            max_players,
            max_paddle_players,
            max_visible_riders,
            target_riders,
            bot_seed: reader.parse_optional("OPENRADLR_BOT_SEED")?,
            race_countdown_s,
            max_race_laps,
            auth_mode,
            trust_proxy: reader.flag("OPENRADLR_TRUST_PROXY", false)?,
            max_connections_per_ip,
            messages_per_second,
            grace_s,
            allowed_origins,
            public_url,
            strava,
            data_dir,
            secret_key,
            stats_file,
            require_strava,
            allow_simulated_trainer: reader.flag("OPENRADLR_ALLOW_SIMULATED_TRAINER", true)?,
            allow_paddle_mode: reader.flag("OPENRADLR_ALLOW_PADDLE_MODE", true)?,
            studio: reader.flag("OPENRADLR_STUDIO", true)?,
            events,
            event_lobby_s,
            analytics,
            privacy_url,
        })
    }

    /// Per-connection limits derived from this configuration.
    pub fn connection_limits(&self) -> ConnectionLimits {
        ConnectionLimits {
            messages_per_second: self.messages_per_second,
            message_burst: self.messages_per_second * 2.0,
            ..ConnectionLimits::default()
        }
    }

    /// Simulation settings derived from this configuration.
    pub fn sim_config(&self) -> SimConfig {
        SimConfig {
            target_riders: self.target_riders,
            race_countdown_s: self.race_countdown_s,
            max_race_laps: self.max_race_laps,
            ..SimConfig::default()
        }
    }
}

struct Reader<'a> {
    lookup: &'a dyn Fn(&str) -> Option<String>,
}

impl Reader<'_> {
    fn raw(&self, key: &str) -> Option<String> {
        (self.lookup)(key).map(|v| v.trim().to_owned())
    }

    fn parse<T: FromStr>(&self, key: &'static str, default: T) -> Result<T, ConfigError> {
        Ok(self.parse_optional(key)?.unwrap_or(default))
    }

    fn parse_optional<T: FromStr>(&self, key: &'static str) -> Result<Option<T>, ConfigError> {
        match self.raw(key) {
            None => Ok(None),
            Some(value) if value.is_empty() => Ok(None),
            Some(value) => value.parse().map(Some).map_err(|_| ConfigError {
                key,
                value,
                reason: "could not be parsed".into(),
            }),
        }
    }

    fn flag(&self, key: &'static str, default: bool) -> Result<bool, ConfigError> {
        match self.raw(key).map(|v| v.to_ascii_lowercase()).as_deref() {
            None | Some("") => Ok(default),
            Some("1" | "true" | "yes" | "on") => Ok(true),
            Some("0" | "false" | "no" | "off") => Ok(false),
            Some(other) => Err(ConfigError {
                key,
                value: other.to_owned(),
                reason: "must be true or false".into(),
            }),
        }
    }

    fn check<T: fmt::Debug>(&self, key: &'static str, value: T, ok: bool, reason: &str) -> Result<(), ConfigError> {
        if ok {
            Ok(())
        } else {
            Err(ConfigError {
                key,
                value: format!("{value:?}"),
                reason: reason.into(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let map: HashMap<String, String> = vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        Config::from_lookup(|key| map.get(key).cloned())
    }

    #[test]
    fn defaults_are_sensible() {
        let c = config(&[]).unwrap();
        assert_eq!(c.bind_addr.port(), 8080);
        assert_eq!(c.tick_hz, 20);
        assert_eq!(c.broadcast_hz, 4);
        assert_eq!(c.target_riders, 12);
        assert_eq!(c.auth_mode, AuthMode::Open);
        assert_eq!(c.static_dir, None);
        assert_eq!(c.bot_seed, None);
    }

    #[test]
    fn values_are_read_from_the_environment() {
        let c = config(&[
            ("OPENRADLR_BIND", "127.0.0.1:9000"),
            ("OPENRADLR_TARGET_RIDERS", "5"),
            ("OPENRADLR_BOT_SEED", "42"),
            ("OPENRADLR_STATIC_DIR", "/srv/client"),
            ("OPENRADLR_SERVER_NAME", "  Club Server  "),
        ])
        .unwrap();
        assert_eq!(c.bind_addr, "127.0.0.1:9000".parse().unwrap());
        assert_eq!(c.target_riders, 5);
        assert_eq!(c.bot_seed, Some(42));
        assert_eq!(c.static_dir, Some(PathBuf::from("/srv/client")));
        assert_eq!(c.server_name, "Club Server");
        assert_eq!(c.sim_config().target_riders, 5);
    }

    #[test]
    fn the_stats_file_is_explicit_or_in_the_data_dir_or_off() {
        assert_eq!(config(&[]).unwrap().stats_file, None);
        let in_data_dir = config(&[("OPENRADLR_DATA_DIR", "/data")]).unwrap();
        assert_eq!(in_data_dir.stats_file, Some(PathBuf::from("/data/stats.json")));
        let explicit = config(&[
            ("OPENRADLR_DATA_DIR", "/data"),
            ("OPENRADLR_STATS_FILE", "/var/km.json"),
        ])
        .unwrap();
        assert_eq!(explicit.stats_file, Some(PathBuf::from("/var/km.json")));
    }

    #[test]
    fn empty_values_fall_back_to_defaults() {
        let c = config(&[("OPENRADLR_BOT_SEED", ""), ("OPENRADLR_STATIC_DIR", "")]).unwrap();
        assert_eq!(c.bot_seed, None);
        assert_eq!(c.static_dir, None);
    }

    #[test]
    fn unparsable_values_name_the_variable() {
        let err = config(&[("OPENRADLR_TICK_HZ", "fast")]).unwrap_err();
        assert_eq!(err.key, "OPENRADLR_TICK_HZ");
    }

    #[test]
    fn grace_defaults_to_60_and_can_be_changed() {
        assert_eq!(config(&[]).unwrap().grace_s, 60.0);
        assert_eq!(config(&[("OPENRADLR_GRACE_S", "0")]).unwrap().grace_s, 0.0);
        assert_eq!(
            config(&[("OPENRADLR_GRACE_S", "-1")]).unwrap_err().key,
            "OPENRADLR_GRACE_S"
        );
        assert_eq!(
            config(&[("OPENRADLR_GRACE_S", "abc")]).unwrap_err().key,
            "OPENRADLR_GRACE_S"
        );
    }

    #[test]
    fn out_of_range_values_are_rejected() {
        assert_eq!(
            config(&[("OPENRADLR_TICK_HZ", "0")]).unwrap_err().key,
            "OPENRADLR_TICK_HZ"
        );
        assert_eq!(
            config(&[("OPENRADLR_TICK_HZ", "10"), ("OPENRADLR_BROADCAST_HZ", "20")])
                .unwrap_err()
                .key,
            "OPENRADLR_BROADCAST_HZ"
        );
        assert_eq!(
            config(&[("OPENRADLR_MAX_PLAYERS", "0")]).unwrap_err().key,
            "OPENRADLR_MAX_PLAYERS"
        );
    }

    #[test]
    fn protection_settings_have_safe_defaults_and_can_be_changed() {
        let c = config(&[]).unwrap();
        assert!(!c.trust_proxy);
        assert_eq!(c.max_connections_per_ip, 4);
        assert!(c.allowed_origins.is_empty());
        assert_eq!(c.routes_dir, None);
        assert!(c.allow_simulated_trainer);
        assert_eq!(c.connection_limits().messages_per_second, 20.0);
        assert!(
            !config(&[("OPENRADLR_ALLOW_SIMULATED_TRAINER", "false")])
                .unwrap()
                .allow_simulated_trainer
        );
        assert!(c.allow_paddle_mode);
        assert!(
            !config(&[("OPENRADLR_ALLOW_PADDLE_MODE", "false")])
                .unwrap()
                .allow_paddle_mode
        );
        assert!(config(&[]).unwrap().studio);
        assert!(!config(&[("OPENRADLR_STUDIO", "false")]).unwrap().studio);
    }

    #[test]
    fn privacy_url_is_optional_and_must_be_a_web_address() {
        assert_eq!(config(&[]).unwrap().privacy_url, None);
        assert_eq!(config(&[("OPENRADLR_PRIVACY_URL", "")]).unwrap().privacy_url, None);
        let c = config(&[("OPENRADLR_PRIVACY_URL", "https://example.org/privacy/")]).unwrap();
        assert_eq!(c.privacy_url.as_deref(), Some("https://example.org/privacy/"));
        let err = config(&[("OPENRADLR_PRIVACY_URL", "javascript:alert(1)")]).unwrap_err();
        assert_eq!(err.key, "OPENRADLR_PRIVACY_URL");
    }

    #[test]
    fn analytics_is_off_unless_a_domain_is_set() {
        assert_eq!(config(&[]).unwrap().analytics, None);
        assert_eq!(config(&[("OPENRADLR_ANALYTICS_DOMAIN", "")]).unwrap().analytics, None);
        // A script URL alone does not switch anything on.
        let script = ("OPENRADLR_ANALYTICS_SCRIPT", "https://stats.example.org/js/script.js");
        assert_eq!(config(&[script]).unwrap().analytics, None);
    }

    #[test]
    fn analytics_defaults_to_plausible_cloud() {
        let c = config(&[("OPENRADLR_ANALYTICS_DOMAIN", "ride.example.org")]).unwrap();
        assert_eq!(
            c.analytics,
            Some(Analytics {
                domain: "ride.example.org".into(),
                script: "https://plausible.io/js/script.js".into(),
            })
        );
    }

    #[test]
    fn analytics_script_can_point_at_a_self_hosted_plausible() {
        let c = config(&[
            ("OPENRADLR_ANALYTICS_DOMAIN", "ride.example.org"),
            ("OPENRADLR_ANALYTICS_SCRIPT", "https://stats.example.org/js/script.js"),
        ])
        .unwrap();
        assert_eq!(c.analytics.unwrap().script, "https://stats.example.org/js/script.js");
    }

    #[test]
    fn analytics_script_must_be_an_https_url() {
        let err = config(&[
            ("OPENRADLR_ANALYTICS_DOMAIN", "ride.example.org"),
            ("OPENRADLR_ANALYTICS_SCRIPT", "javascript:alert(1)"),
        ])
        .unwrap_err();
        assert_eq!(err.key, "OPENRADLR_ANALYTICS_SCRIPT");
    }

    #[test]
    fn protection_and_proxy_settings_are_read() {
        let c = config(&[
            ("OPENRADLR_TRUST_PROXY", "yes"),
            ("OPENRADLR_MAX_CONNECTIONS_PER_IP", "10"),
            ("OPENRADLR_MESSAGES_PER_SECOND", "40"),
            (
                "OPENRADLR_ALLOWED_ORIGINS",
                "https://ride.example.com/, http://localhost:8080 ,",
            ),
            ("OPENRADLR_ROUTES_DIR", "/app/routes"),
        ])
        .unwrap();
        assert!(c.trust_proxy);
        assert_eq!(c.max_connections_per_ip, 10);
        assert_eq!(c.connection_limits().message_burst, 80.0);
        assert_eq!(
            c.allowed_origins,
            vec![
                "https://ride.example.com".to_owned(),
                "http://localhost:8080".to_owned()
            ]
        );
        assert_eq!(c.routes_dir, Some(PathBuf::from("/app/routes")));

        assert_eq!(
            config(&[("OPENRADLR_TRUST_PROXY", "maybe")]).unwrap_err().key,
            "OPENRADLR_TRUST_PROXY"
        );
        assert_eq!(
            config(&[("OPENRADLR_MAX_CONNECTIONS_PER_IP", "0")]).unwrap_err().key,
            "OPENRADLR_MAX_CONNECTIONS_PER_IP"
        );
    }

    #[test]
    fn strava_needs_both_secrets_and_a_public_url() {
        assert_eq!(config(&[]).unwrap().strava, None);
        let c = config(&[
            ("OPENRADLR_STRAVA_CLIENT_ID", "123"),
            ("OPENRADLR_STRAVA_CLIENT_SECRET", "abc"),
            ("OPENRADLR_PUBLIC_URL", "https://ride.example.com/"),
            ("OPENRADLR_REQUIRE_STRAVA", "true"),
        ])
        .unwrap();
        let strava = c.strava.unwrap();
        assert_eq!(strava.redirect_uri, "https://ride.example.com/auth/strava/callback");
        assert!(c.require_strava);
        assert_eq!(c.public_url.as_deref(), Some("https://ride.example.com"));

        let key = |vars: &[(&str, &str)]| config(vars).unwrap_err().key;
        assert_eq!(
            key(&[("OPENRADLR_STRAVA_CLIENT_ID", "123")]),
            "OPENRADLR_STRAVA_CLIENT_SECRET"
        );
        assert_eq!(
            key(&[
                ("OPENRADLR_STRAVA_CLIENT_ID", "1"),
                ("OPENRADLR_STRAVA_CLIENT_SECRET", "2")
            ]),
            "OPENRADLR_PUBLIC_URL"
        );
        assert_eq!(key(&[("OPENRADLR_REQUIRE_STRAVA", "true")]), "OPENRADLR_REQUIRE_STRAVA");
        assert_eq!(
            key(&[("OPENRADLR_PUBLIC_URL", "ride.example.com")]),
            "OPENRADLR_PUBLIC_URL"
        );
    }

    #[test]
    fn events_setting_and_lobby() {
        let c = config(&[]).unwrap();
        assert_eq!(c.events, EventsSetting::Default);
        assert_eq!(c.event_lobby_s, 600.0);
        assert_eq!(
            config(&[("OPENRADLR_EVENTS", "default")]).unwrap().events,
            EventsSetting::Default
        );
        assert_eq!(
            config(&[("OPENRADLR_EVENTS", "off")]).unwrap().events,
            EventsSetting::Off
        );
        let c = config(&[
            ("OPENRADLR_EVENTS", "/etc/events.json"),
            ("OPENRADLR_EVENT_LOBBY_S", "30"),
        ])
        .unwrap();
        assert_eq!(c.events, EventsSetting::File(PathBuf::from("/etc/events.json")));
        assert_eq!(c.event_lobby_s, 30.0);
        assert_eq!(
            config(&[("OPENRADLR_EVENT_LOBBY_S", "-1")]).unwrap_err().key,
            "OPENRADLR_EVENT_LOBBY_S"
        );
    }

    #[test]
    fn verified_auth_is_not_available_yet() {
        let err = config(&[("OPENRADLR_AUTH_MODE", "verified")]).unwrap_err();
        assert_eq!(err.key, "OPENRADLR_AUTH_MODE");
    }
}
