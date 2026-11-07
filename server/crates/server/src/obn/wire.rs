use serde::{Deserialize, Serialize};

/// Messages this app sends to an OpenBikeNet server.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AppMessage {
    Hello {
        app: AppInfo,
    },
    Subscribe {
        route: String,
        room: String,
    },
    Join {
        rider: String,
        route: String,
        room: String,
        name: String,
        #[serde(flatten)]
        state: RiderState,
    },
    Update {
        riders: Vec<RiderEntry>,
    },
    Leave {
        rider: String,
    },
    /// Asks a quiet server whether it is still there (spec 6.6); it answers with `pong`.
    Ping {
        #[serde(rename = "ref")]
        reference: String,
    },
}

/// The app's identification, sent once in `hello`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AppInfo {
    pub id: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// State of one rider on a route, as sent in `join` and `update`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RiderState {
    pub lap: u32,
    pub distance: f64,
    pub speed: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cadence: Option<u32>,
}

/// One rider inside an `update` message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RiderEntry {
    pub rider: String,
    #[serde(flatten)]
    pub state: RiderState,
}

/// Messages an OpenBikeNet server sends to this app. Unknown fields are ignored.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Welcome {},
    Snapshot {
        route: String,
        room: String,
        riders: Vec<RemoteView>,
    },
    Joined {
        route: String,
        room: String,
        rider: RemoteView,
    },
    Updated {
        route: String,
        room: String,
        riders: Vec<RemoteUpdate>,
    },
    Left {
        route: String,
        room: String,
        id: String,
    },
    Error {
        code: String,
        message: String,
        fatal: bool,
    },
    /// The answer to `ping`.
    Pong {},
}

/// A rider of another app, as seen in `snapshot` and `joined`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct RemoteView {
    pub id: String,
    pub app: String,
    pub name: String,
    pub lap: u32,
    pub distance: f64,
    pub speed: f64,
    #[serde(default)]
    pub power: Option<f64>,
    #[serde(default)]
    pub cadence: Option<f64>,
}

/// A rider of another app, as seen in `updated`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct RemoteUpdate {
    pub id: String,
    pub lap: u32,
    pub distance: f64,
    pub speed: f64,
    #[serde(default)]
    pub power: Option<f64>,
    #[serde(default)]
    pub cadence: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_matches_the_spec_shape() {
        let msg = AppMessage::Hello {
            app: AppInfo {
                id: "openradlr".into(),
                version: "0.3.1".into(),
                name: Some("OpenRadlr".into()),
                url: Some("https://openradlr.com".into()),
            },
        };
        let value = serde_json::to_value(&msg).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "type": "hello",
                "app": {"id": "openradlr", "version": "0.3.1", "name": "OpenRadlr", "url": "https://openradlr.com"}
            })
        );
    }

    #[test]
    fn join_flattens_the_state() {
        let msg = AppMessage::Join {
            rider: "r7".into(),
            route: "velodrome-250".into(),
            room: "public".into(),
            name: "Anna".into(),
            state: RiderState {
                lap: 0,
                distance: 0.0,
                speed: 0.0,
                power: None,
                cadence: None,
            },
        };
        let value = serde_json::to_value(&msg).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "type": "join", "rider": "r7", "route": "velodrome-250", "room": "public", "name": "Anna",
                "lap": 0, "distance": 0.0, "speed": 0.0
            })
        );
        assert!(!value.as_object().unwrap().contains_key("power"));
        assert!(!value.as_object().unwrap().contains_key("cadence"));
    }

    #[test]
    fn parses_spec_examples() {
        let welcome = r#"{"type": "welcome", "protocol": "0.1", "connection": "c9Qe4",
 "limits": {"max_update_hz": 4, "rider_timeout_s": 10, "max_riders": 200, "max_subscriptions": 16, "max_message_bytes": 65536}}"#;
        let snapshot = r#"{"type": "snapshot", "route": "velodrome-250", "room": "public", "riders": [
  {"id": "r7Kx2", "app": "incyclist", "name": "Ben", "lap": 5, "distance": 201.3, "speed": 12.1, "power": 260}
]}"#;
        let joined = r#"{"type": "joined", "route": "velodrome-250", "room": "public",
 "rider": {"id": "r7Kx2", "app": "incyclist", "name": "Ben", "lap": 0, "distance": 0, "speed": 0}}"#;
        let updated = r#"{"type": "updated", "route": "velodrome-250", "room": "public", "riders": [
  {"id": "r7Kx2", "lap": 5, "distance": 213.4, "speed": 12.1, "power": 262}
]}"#;
        let left =
            r#"{"type": "left", "route": "velodrome-250", "room": "public", "id": "r7Kx2", "reason": "timeout"}"#;
        let error = r#"{"type": "error", "code": "invalid_value", "message": "distance must be below 250", "ref": "42", "rider": "u-1842", "fatal": false}"#;

        assert_eq!(
            serde_json::from_str::<ServerMessage>(welcome).unwrap(),
            ServerMessage::Welcome {}
        );
        match serde_json::from_str::<ServerMessage>(snapshot).unwrap() {
            ServerMessage::Snapshot { route, room, riders } => {
                assert_eq!((route.as_str(), room.as_str()), ("velodrome-250", "public"));
                assert_eq!(riders.len(), 1);
                assert_eq!(riders[0].id, "r7Kx2");
                assert_eq!(riders[0].power, Some(260.0));
                assert_eq!(riders[0].cadence, None);
            }
            other => panic!("expected snapshot, got {other:?}"),
        }
        match serde_json::from_str::<ServerMessage>(joined).unwrap() {
            ServerMessage::Joined { rider, .. } => {
                assert_eq!(rider.id, "r7Kx2");
                assert_eq!(rider.app, "incyclist");
                assert_eq!(rider.power, None);
            }
            other => panic!("expected joined, got {other:?}"),
        }
        match serde_json::from_str::<ServerMessage>(updated).unwrap() {
            ServerMessage::Updated { riders, .. } => {
                assert_eq!(riders.len(), 1);
                assert_eq!(riders[0].lap, 5);
                assert_eq!(riders[0].power, Some(262.0));
                assert_eq!(riders[0].cadence, None);
            }
            other => panic!("expected updated, got {other:?}"),
        }
        match serde_json::from_str::<ServerMessage>(left).unwrap() {
            ServerMessage::Left { id, .. } => assert_eq!(id, "r7Kx2"),
            other => panic!("expected left, got {other:?}"),
        }
        match serde_json::from_str::<ServerMessage>(error).unwrap() {
            ServerMessage::Error { code, fatal, .. } => {
                assert_eq!(code, "invalid_value");
                assert!(!fatal);
            }
            other => panic!("expected error, got {other:?}"),
        }
    }

    #[test]
    fn ping_and_pong_match_the_spec() {
        let ping = AppMessage::Ping {
            reference: "hb-17".into(),
        };
        assert_eq!(
            serde_json::to_value(&ping).unwrap(),
            serde_json::json!({"type": "ping", "ref": "hb-17"})
        );
        let pong = serde_json::from_str::<ServerMessage>(r#"{"type": "pong", "ref": "hb-17"}"#).unwrap();
        assert_eq!(pong, ServerMessage::Pong {});
    }

    #[test]
    fn unknown_type_is_an_error() {
        assert!(serde_json::from_str::<ServerMessage>(r#"{"type": "teleport", "route": "x"}"#).is_err());
    }
}
