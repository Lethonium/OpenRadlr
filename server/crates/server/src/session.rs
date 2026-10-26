//! Per-connection protocol state machine.
//!
//! [`Session`] is pure: it gets each text frame plus the current time in
//! seconds and decides what to do (`AwaitingHello -> AwaitingJoin -> Joined`).
//! It also enforces the per-connection limits from [`ConnectionLimits`].
//! [`crate::connection::serve`] wires it to a real WebSocket.

use crate::guard::{ConnectionLimits, TokenBucket};
use crate::protocol::{ClientMessage, DeviceKind, Exercise, InputAction, ResumePoint, ServerMessage, PROTOCOL_VERSION};
use crate::studio::STUDIO_ID;
use crate::ServerInfo;
use openradlr_sim::RiderId;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    AwaitingHello,
    AwaitingJoin,
    Joined(RiderId),
}

/// What the connection should do in response to a client message.
#[derive(Debug, PartialEq)]
pub enum Action {
    /// Nothing to do (e.g. a message dropped by the rate limit).
    Ignore,
    Reply(ServerMessage),
    /// Send the message, then close the connection.
    ReplyAndClose(ServerMessage),
    Join {
        name: String,
        weight_kg: f64,
        /// `None` joins the server's default route.
        route_id: Option<String>,
        ftp_w: Option<f64>,
        level_w: Option<f64>,
        device: DeviceKind,
        /// The vehicle to board right away; its world replaces `route_id`.
        vehicle_code: Option<String>,
        /// The token of an earlier `joined`: reattach that rider if the server still holds them.
        resume_token: Option<String>,
        /// Place the rider where the ride left off; ignored with a vehicle code.
        resume: Option<ResumePoint>,
    },
    /// Leave the game; the rider is removed and the connection is closed.
    Leave,
    Forward(PlayerCommand),
}

/// A game command without the transport-specific parts.
#[derive(Debug, Clone, PartialEq)]
pub enum PlayerCommand {
    Telemetry {
        power: f64,
        cadence: Option<f64>,
    },
    Input(InputAction),
    StartRace {
        laps: u32,
    },
    JoinRace,
    LeaveRace,
    JoinEvent {
        event_id: String,
    },
    LeaveEvent,
    Turn {
        edge: Option<String>,
    },
    Chat {
        text: String,
    },
    CreateVehicle {
        kind: String,
        seats: u8,
        bots: bool,
    },
    BoardVehicle {
        code: String,
    },
    LeaveVehicle,
    /// Pause (`on`) or resume the ride (#89).
    Pause {
        on: bool,
    },
    /// The exercise a workout rider does now (`None`: rest, #77).
    Workout {
        exercise: Option<Exercise>,
    },
}

pub struct Session {
    phase: Phase,
    info: Arc<ServerInfo>,
    limits: ConnectionLimits,
    messages: TokenBucket,
    chat: TokenBucket,
    vehicles: TokenBucket,
    dropped: u32,
    opened_s: f64,
    last_message_s: f64,
}

impl Session {
    pub fn new(info: Arc<ServerInfo>, limits: ConnectionLimits, now_s: f64) -> Self {
        Self {
            phase: Phase::AwaitingHello,
            info,
            limits,
            messages: TokenBucket::new(limits.message_burst, limits.messages_per_second),
            chat: TokenBucket::new(limits.chat_burst, 1.0 / limits.chat_interval_s.max(0.001)),
            vehicles: TokenBucket::new(limits.vehicle_burst, 1.0 / limits.vehicle_interval_s.max(0.001)),
            dropped: 0,
            opened_s: now_s,
            last_message_s: now_s,
        }
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn joined(&mut self, rider_id: RiderId) {
        self.phase = Phase::Joined(rider_id);
    }

    /// Why the connection should be closed at `now_s`, if it should.
    pub fn expired(&self, now_s: f64) -> Option<ServerMessage> {
        match self.phase {
            Phase::Joined(_) if now_s - self.last_message_s > self.limits.idle_timeout_s => {
                Some(ServerMessage::error("idle_timeout", "no messages for too long"))
            }
            Phase::AwaitingHello | Phase::AwaitingJoin if now_s - self.opened_s > self.limits.handshake_timeout_s => {
                Some(ServerMessage::error(
                    "handshake_timeout",
                    "send hello and join right after connecting",
                ))
            }
            _ => None,
        }
    }

    pub fn on_text(&mut self, text: &str, now_s: f64) -> Action {
        self.last_message_s = now_s;
        if !self.messages.allow(now_s) {
            self.dropped += 1;
            if self.dropped > self.limits.max_dropped {
                return Action::ReplyAndClose(ServerMessage::error("rate_limited", "too many messages"));
            }
            return Action::Ignore;
        }

        let message = match ClientMessage::parse(text) {
            Ok(message) => message,
            Err(e) => return Action::Reply(ServerMessage::error("bad_message", e.to_string())),
        };

        match (self.phase, message) {
            (Phase::AwaitingHello, ClientMessage::Hello { protocol_version, .. }) => {
                if protocol_version != PROTOCOL_VERSION {
                    return Action::ReplyAndClose(ServerMessage::error(
                        "protocol_mismatch",
                        format!("server speaks protocol {PROTOCOL_VERSION}, client sent {protocol_version}"),
                    ));
                }
                self.phase = Phase::AwaitingJoin;
                Action::Reply(ServerMessage::Welcome {
                    protocol_version: PROTOCOL_VERSION,
                    server_name: self.info.name.clone(),
                    server_version: self.info.version.clone(),
                    auth_mode: self.info.auth_mode.clone(),
                    route_id: self.info.route_id.clone(),
                    grace_s: self.info.grace_s,
                })
            }
            (Phase::AwaitingHello, _) => Action::Reply(ServerMessage::error("hello_required", "send hello first")),
            (
                Phase::AwaitingJoin,
                ClientMessage::Join {
                    name,
                    weight_kg,
                    route_id,
                    ftp_w,
                    level_w,
                    device,
                    vehicle_code,
                    resume_token,
                    resume,
                    ..
                },
            ) => match device {
                DeviceKind::Sim if !self.info.allow_simulated_trainer => Action::Reply(ServerMessage::error(
                    "device_not_allowed",
                    "this server only accepts real trainers",
                )),
                DeviceKind::Paddle if !self.info.allow_paddle_mode => Action::Reply(ServerMessage::error(
                    "device_not_allowed",
                    "this server doesn't allow phone paddles",
                )),
                // A workout stays at the start café: no studio, no vehicle, no resume point.
                DeviceKind::Workout if route_id.as_deref() == Some(STUDIO_ID) => Action::Reply(ServerMessage::error(
                    "unknown_route",
                    "workouts can't join the spin studio",
                )),
                DeviceKind::Workout => Action::Join {
                    name,
                    weight_kg,
                    route_id,
                    ftp_w,
                    level_w,
                    device,
                    vehicle_code: None,
                    resume_token,
                    resume: None,
                },
                _ => Action::Join {
                    name,
                    weight_kg,
                    route_id,
                    ftp_w,
                    level_w,
                    device,
                    vehicle_code,
                    resume_token,
                    resume,
                },
            },
            (Phase::AwaitingJoin, _) => Action::Reply(ServerMessage::error("join_required", "send join first")),
            (Phase::Joined(_), ClientMessage::Hello { .. } | ClientMessage::Join { .. }) => Action::Reply(
                ServerMessage::error("already_joined", "this connection has already joined"),
            ),
            (Phase::Joined(_), ClientMessage::Telemetry { power, cadence }) => {
                Action::Forward(PlayerCommand::Telemetry { power, cadence })
            }
            (Phase::Joined(_), ClientMessage::Input { action }) => Action::Forward(PlayerCommand::Input(action)),
            (Phase::Joined(_), ClientMessage::StartRace { laps }) => Action::Forward(PlayerCommand::StartRace { laps }),
            (Phase::Joined(_), ClientMessage::JoinRace) => Action::Forward(PlayerCommand::JoinRace),
            (Phase::Joined(_), ClientMessage::LeaveRace) => Action::Forward(PlayerCommand::LeaveRace),
            (Phase::Joined(_), ClientMessage::JoinEvent { event_id }) => {
                Action::Forward(PlayerCommand::JoinEvent { event_id })
            }
            (Phase::Joined(_), ClientMessage::LeaveEvent) => Action::Forward(PlayerCommand::LeaveEvent),
            (Phase::Joined(_), ClientMessage::Turn { edge }) => Action::Forward(PlayerCommand::Turn { edge }),
            (Phase::Joined(_), ClientMessage::CreateVehicle { .. } | ClientMessage::BoardVehicle { .. })
                if !self.vehicles.allow(now_s) =>
            {
                Action::Reply(ServerMessage::error(
                    "vehicle_rate_limited",
                    "wait a moment before trying again",
                ))
            }
            (Phase::Joined(_), ClientMessage::CreateVehicle { kind, seats, bots }) => {
                Action::Forward(PlayerCommand::CreateVehicle { kind, seats, bots })
            }
            (Phase::Joined(_), ClientMessage::BoardVehicle { code }) => {
                Action::Forward(PlayerCommand::BoardVehicle { code })
            }
            (Phase::Joined(_), ClientMessage::LeaveVehicle) => Action::Forward(PlayerCommand::LeaveVehicle),
            (Phase::Joined(_), ClientMessage::Pause) => Action::Forward(PlayerCommand::Pause { on: true }),
            (Phase::Joined(_), ClientMessage::Resume) => Action::Forward(PlayerCommand::Pause { on: false }),
            (Phase::Joined(_), ClientMessage::Workout { exercise }) => match exercise {
                None => Action::Forward(PlayerCommand::Workout { exercise: None }),
                Some(id) => match Exercise::from_id(&id) {
                    Some(exercise) => Action::Forward(PlayerCommand::Workout {
                        exercise: Some(exercise),
                    }),
                    None => Action::Reply(ServerMessage::error("unknown_exercise", "no such exercise")),
                },
            },
            (Phase::Joined(_), ClientMessage::Leave) => Action::Leave,
            (Phase::Joined(_), ClientMessage::Chat { text }) => {
                if self.chat.allow(now_s) {
                    Action::Forward(PlayerCommand::Chat { text })
                } else {
                    Action::Reply(ServerMessage::error("chat_rate_limited", "slow down a little"))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        session_with(ConnectionLimits::default())
    }

    fn session_with(limits: ConnectionLimits) -> Session {
        Session::new(
            Arc::new(ServerInfo {
                name: "Test".into(),
                version: "0.0.0".into(),
                build: crate::BuildInfo::new(None, None),
                auth_mode: "open".into(),
                route_id: "loop".into(),
                allow_simulated_trainer: true,
                allow_paddle_mode: true,
                analytics: None,
                privacy_url: None,
                grace_s: 60.0,
            }),
            limits,
            0.0,
        )
    }

    const HELLO: &str = r#"{"type":"hello","protocol_version":2}"#;
    const JOIN: &str = r#"{"type":"join","name":"Anna","weight_kg":70}"#;

    fn is_error(action: &Action, wanted: &str) -> bool {
        matches!(action, Action::Reply(ServerMessage::Error { code, .. }) | Action::ReplyAndClose(ServerMessage::Error { code, .. }) if code == wanted)
    }

    #[test]
    fn json_handshake_then_join() {
        let mut s = session();
        assert!(matches!(
            s.on_text(HELLO, 0.0),
            Action::Reply(ServerMessage::Welcome { grace_s, .. }) if grace_s == 60.0
        ));
        assert_eq!(s.phase(), Phase::AwaitingJoin);
        assert_eq!(
            s.on_text(JOIN, 0.1),
            Action::Join {
                name: "Anna".into(),
                weight_kg: 70.0,
                route_id: None,
                ftp_w: None,
                level_w: None,
                device: DeviceKind::Trainer,
                vehicle_code: None,
                resume_token: None,
                resume: None,
            }
        );
        s.joined(5);
        assert_eq!(
            s.on_text(r#"{"type":"input","action":"lane_right"}"#, 0.2),
            Action::Forward(PlayerCommand::Input(InputAction::LaneRight))
        );
    }

    #[test]
    fn join_tells_what_the_power_comes_from() {
        let mut s = session();
        s.on_text(HELLO, 0.0);
        assert!(matches!(
            s.on_text(r#"{"type":"join","name":"Anna","weight_kg":70,"device":"paddle"}"#, 0.1),
            Action::Join {
                device: DeviceKind::Paddle,
                ..
            }
        ));
    }

    #[test]
    fn servers_can_refuse_the_simulated_trainer_and_phone_paddles() {
        for (device, sim, paddle) in [("sim", false, true), ("paddle", true, false)] {
            let mut s = Session::new(
                Arc::new(ServerInfo {
                    name: "Test".into(),
                    version: "0.0.0".into(),
                    build: crate::BuildInfo::new(None, None),
                    auth_mode: "open".into(),
                    route_id: "loop".into(),
                    allow_simulated_trainer: sim,
                    allow_paddle_mode: paddle,
                    analytics: None,
                    privacy_url: None,
                    grace_s: 60.0,
                }),
                ConnectionLimits::default(),
                0.0,
            );
            s.on_text(HELLO, 0.0);
            let join = format!(r#"{{"type":"join","name":"Anna","weight_kg":70,"device":"{device}"}}"#);
            assert!(is_error(&s.on_text(&join, 0.1), "device_not_allowed"), "{device}");
            // A real trainer still gets in.
            assert!(matches!(
                s.on_text(JOIN, 0.2),
                Action::Join {
                    device: DeviceKind::Trainer,
                    ..
                }
            ));
        }
    }

    #[test]
    fn join_can_pick_a_route_and_send_an_ftp() {
        let mut s = session();
        s.on_text(HELLO, 0.0);
        assert_eq!(
            s.on_text(
                r#"{"type":"join","name":"Anna","weight_kg":70,"route_id":"spin-studio","ftp_w":240}"#,
                0.1
            ),
            Action::Join {
                name: "Anna".into(),
                weight_kg: 70.0,
                route_id: Some("spin-studio".into()),
                ftp_w: Some(240.0),
                level_w: None,
                device: DeviceKind::Trainer,
                vehicle_code: None,
                resume_token: None,
                resume: None,
            }
        );
    }

    #[test]
    fn leave_after_join_is_an_action() {
        let mut s = session();
        assert!(is_error(&s.on_text(r#"{"type":"leave"}"#, 0.0), "hello_required"));
        s.on_text(HELLO, 0.1);
        assert!(is_error(&s.on_text(r#"{"type":"leave"}"#, 0.2), "join_required"));
        s.on_text(JOIN, 0.3);
        s.joined(5);
        assert_eq!(s.on_text(r#"{"type":"leave"}"#, 0.4), Action::Leave);
    }

    #[test]
    fn join_can_carry_a_vehicle_code() {
        let mut s = session();
        s.on_text(HELLO, 0.0);
        assert!(matches!(
            s.on_text(
                r#"{"type":"join","name":"Anna","weight_kg":70,"vehicle_code":"abc234"}"#,
                0.1
            ),
            Action::Join { vehicle_code: Some(code), .. } if code == "abc234"
        ));
    }

    #[test]
    fn json_wrong_protocol_version_closes_the_connection() {
        let mut s = session();
        let action = s.on_text(r#"{"type":"hello","protocol_version":99}"#, 0.0);
        assert!(
            matches!(action, Action::ReplyAndClose(ServerMessage::Error { ref code, .. }) if code == "protocol_mismatch")
        );
    }

    #[test]
    fn json_messages_out_of_order_are_rejected() {
        let mut s = session();
        assert!(is_error(&s.on_text(JOIN, 0.0), "hello_required"));
        s.on_text(HELLO, 0.0);
        assert!(is_error(
            &s.on_text(r#"{"type":"telemetry","power":200}"#, 0.0),
            "join_required"
        ));
        s.joined(1);
        assert!(is_error(&s.on_text(HELLO, 0.0), "already_joined"));
    }

    #[test]
    fn json_garbage_is_answered_with_an_error() {
        let mut s = session();
        assert!(is_error(&s.on_text("{nope", 0.0), "bad_message"));
    }

    #[test]
    fn flooding_drops_messages_then_closes() {
        let mut s = session_with(ConnectionLimits {
            messages_per_second: 1.0,
            message_burst: 2.0,
            max_dropped: 3,
            ..ConnectionLimits::default()
        });
        s.on_text(HELLO, 0.0);
        s.on_text(JOIN, 0.0);
        s.joined(1);
        let telemetry = r#"{"type":"telemetry","power":200}"#;
        for _ in 0..3 {
            assert_eq!(s.on_text(telemetry, 0.0), Action::Ignore);
        }
        assert!(is_error(&s.on_text(telemetry, 0.0), "rate_limited"));
    }

    #[test]
    fn a_steady_telemetry_stream_is_never_limited() {
        let mut s = session();
        s.on_text(HELLO, 0.0);
        s.on_text(JOIN, 0.0);
        s.joined(1);
        for i in 0..10_000 {
            let action = s.on_text(r#"{"type":"telemetry","power":200}"#, 1.0 + f64::from(i) * 0.1);
            assert!(matches!(action, Action::Forward(_)), "message {i} was limited");
        }
    }

    #[test]
    fn chat_has_its_own_slower_limit() {
        let mut s = session_with(ConnectionLimits {
            chat_burst: 2.0,
            chat_interval_s: 5.0,
            ..ConnectionLimits::default()
        });
        s.on_text(HELLO, 0.0);
        s.on_text(JOIN, 0.0);
        s.joined(1);
        let chat = r#"{"type":"chat","text":"hi"}"#;
        assert!(matches!(s.on_text(chat, 1.0), Action::Forward(_)));
        assert!(matches!(s.on_text(chat, 1.0), Action::Forward(_)));
        assert!(is_error(&s.on_text(chat, 1.0), "chat_rate_limited"));
        assert!(matches!(s.on_text(chat, 6.5), Action::Forward(_)));
    }

    #[test]
    fn creating_and_boarding_vehicles_share_a_slow_limit() {
        // Against create/leave loops flooding the route and guessing boarding codes (#75).
        let mut s = session_with(ConnectionLimits {
            vehicle_burst: 2.0,
            vehicle_interval_s: 5.0,
            ..ConnectionLimits::default()
        });
        s.on_text(HELLO, 0.0);
        s.on_text(JOIN, 0.0);
        s.joined(1);
        let create = r#"{"type":"create_vehicle","kind":"tandem"}"#;
        let board = r#"{"type":"board_vehicle","code":"ABC234"}"#;
        assert!(matches!(s.on_text(create, 1.0), Action::Forward(_)));
        assert!(matches!(s.on_text(board, 1.0), Action::Forward(_)));
        assert!(is_error(&s.on_text(board, 1.0), "vehicle_rate_limited"));
        assert!(is_error(&s.on_text(create, 1.0), "vehicle_rate_limited"));
        assert!(matches!(s.on_text(board, 6.5), Action::Forward(_)));
    }

    #[test]
    fn leaving_a_vehicle_is_never_limited() {
        let mut s = joined_session();
        let leave = r#"{"type":"leave_vehicle"}"#;
        for _ in 0..20 {
            assert!(matches!(s.on_text(leave, 1.0), Action::Forward(_)));
        }
    }

    fn joined_session() -> Session {
        let mut s = session();
        s.on_text(HELLO, 0.0);
        s.on_text(JOIN, 0.1);
        s.joined(1);
        s
    }

    #[test]
    fn a_workout_join_drops_vehicle_codes_and_resume_points() {
        let mut s = session();
        s.on_text(HELLO, 0.0);
        let join = r#"{"type":"join","name":"Anna","weight_kg":70,"device":"workout","vehicle_code":"ABC","resume":{"route_id":"loop","distance_m":500}}"#;
        assert!(matches!(
            s.on_text(join, 0.1),
            Action::Join {
                device: DeviceKind::Workout,
                vehicle_code: None,
                resume: None,
                ..
            }
        ));
    }

    #[test]
    fn a_workout_join_to_the_studio_is_refused() {
        let mut s = session();
        s.on_text(HELLO, 0.0);
        let join = r#"{"type":"join","name":"Anna","weight_kg":70,"device":"workout","route_id":"spin-studio"}"#;
        assert!(is_error(&s.on_text(join, 0.1), "unknown_route"));
    }

    #[test]
    fn an_unknown_exercise_is_refused() {
        let mut s = joined_session();
        assert!(is_error(
            &s.on_text(r#"{"type":"workout","exercise":"pullups"}"#, 0.2),
            "unknown_exercise"
        ));
    }

    #[test]
    fn a_known_exercise_and_null_are_forwarded() {
        let mut s = joined_session();
        assert_eq!(
            s.on_text(r#"{"type":"workout","exercise":"jumping_jacks"}"#, 0.2),
            Action::Forward(PlayerCommand::Workout {
                exercise: Some(Exercise::JumpingJacks)
            })
        );
        assert_eq!(
            s.on_text(r#"{"type":"workout","exercise":null}"#, 0.3),
            Action::Forward(PlayerCommand::Workout { exercise: None })
        );
        assert_eq!(
            s.on_text(r#"{"type":"workout"}"#, 0.4),
            Action::Forward(PlayerCommand::Workout { exercise: None })
        );
    }

    #[test]
    fn slow_handshakes_and_idle_connections_expire() {
        let limits = ConnectionLimits {
            handshake_timeout_s: 10.0,
            idle_timeout_s: 30.0,
            ..ConnectionLimits::default()
        };
        let s = session_with(limits);
        assert_eq!(s.expired(5.0), None);
        assert!(matches!(s.expired(11.0), Some(ServerMessage::Error { ref code, .. }) if code == "handshake_timeout"));

        let mut s = session_with(limits);
        s.on_text(HELLO, 1.0);
        s.on_text(JOIN, 2.0);
        s.joined(1);
        assert_eq!(s.expired(31.0), None, "joined connections only expire when idle");
        s.on_text(r#"{"type":"telemetry","power":0}"#, 40.0);
        assert_eq!(s.expired(69.0), None);
        assert!(matches!(s.expired(71.0), Some(ServerMessage::Error { ref code, .. }) if code == "idle_timeout"));
    }
}
