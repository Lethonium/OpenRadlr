//! The game core: owns the [`World`] of one map (all its routes, #14), knows
//! which clients are connected and decides which messages go to whom: state
//! of the riders around them, events of their route.
//!
//! It is synchronous and transport-agnostic. Clients are represented by a
//! [`MessageSink`], so tests can plug in an in-memory sink while production
//! plugs in a channel to the WebSocket writer (see [`crate::runtime`]).

use crate::protocol::{
    event_info, event_message, event_notice_message, event_state, state_message, DeviceKind, EventInfoWire, EventState,
    Exercise, InputAction, RiderTags, ServerMessage,
};
use crate::resume::{Attachments, JoinedRider, ResumeTokens};
use crate::runtime::Game;
use crate::stats::DistanceStats;
use crate::vehicle_codes::VehicleCodes;
use openradlr_sim::bot::human_level_wkg;
use openradlr_sim::events::Events;
use openradlr_sim::vehicle::VehicleKind;
use openradlr_sim::world::{VehicleChange, WorldError};
use openradlr_sim::{RiderId, RouteIndex, World, WorldEvent};
use std::collections::HashMap;
use std::fmt;

/// The client is gone and should be removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SinkClosed;

/// Where messages for one client go.
pub trait MessageSink: Send {
    /// Delivers a message. Implementations may drop messages when the client
    /// is slow; they must return `Err(SinkClosed)` once the client is gone.
    fn deliver(&self, message: ServerMessage) -> Result<(), SinkClosed>;
}

/// Where a detached rider's messages go: nowhere, until they reattach.
pub struct NullSink;

impl MessageSink for NullSink {
    fn deliver(&self, _message: ServerMessage) -> Result<(), SinkClosed> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GameSettings {
    pub tick_hz: u32,
    pub broadcast_hz: u32,
    pub max_players: usize,
    /// Minimum grade change in percent before new resistance is sent.
    pub resistance_step_percent: f64,
    /// State messages carry at most this many riders (humans first, then the
    /// nearest bots); the viewer, their vehicle and race entrants always.
    pub max_visible_riders: usize,
    /// Seconds a rider lingers (coasting at 0 W) after their socket dies
    /// before being removed; `0` removes at once (the old behaviour).
    pub grace_s: f64,
}

impl GameSettings {
    pub fn tick_seconds(&self) -> f64 {
        1.0 / f64::from(self.tick_hz.max(1))
    }

    pub(crate) fn broadcast_every(&self) -> u64 {
        u64::from((self.tick_hz / self.broadcast_hz.max(1)).max(1))
    }
}

impl Default for GameSettings {
    fn default() -> Self {
        Self {
            tick_hz: 20,
            broadcast_hz: 4,
            max_players: 50,
            resistance_step_percent: 0.1,
            max_visible_riders: 200,
            // Long enough for a phone to unlock and redial before the ride is gone.
            grace_s: 60.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinError {
    ServerFull,
    InvalidName,
    InvalidWeight,
    UnknownRoute,
    /// No vehicle has the code (never had, or it was dissolved meanwhile).
    UnknownVehicle,
    VehicleFull,
    /// The vehicle can't take the rider for another reason.
    InvalidVehicle,
}

impl JoinError {
    pub fn code(self) -> &'static str {
        match self {
            JoinError::ServerFull => "server_full",
            JoinError::InvalidName => "invalid_name",
            JoinError::InvalidWeight => "invalid_weight",
            JoinError::UnknownRoute => "unknown_route",
            JoinError::UnknownVehicle => "unknown_vehicle",
            JoinError::VehicleFull => "vehicle_full",
            JoinError::InvalidVehicle => "invalid_vehicle",
        }
    }
}

impl fmt::Display for JoinError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JoinError::ServerFull => write!(f, "the server is full"),
            JoinError::InvalidName => write!(f, "names must be 1 to 24 printable characters"),
            JoinError::InvalidWeight => write!(f, "weight must be between 30 and 200 kg"),
            JoinError::UnknownRoute => write!(f, "this server has no such route"),
            JoinError::UnknownVehicle => write!(f, "no vehicle has this code"),
            JoinError::VehicleFull => write!(f, "this vehicle has no free seat"),
            JoinError::InvalidVehicle => write!(f, "this vehicle cannot take you"),
        }
    }
}

impl std::error::Error for JoinError {}

pub const MAX_NAME_CHARS: usize = 24;
pub const MAX_CHAT_CHARS: usize = 200;

/// Characters that are invisible or flip the text direction: with them a name
/// can pass for another one, or turn the rest of a line around. The zero-width
/// joiner (U+200D) is not among them: emoji sequences need it.
fn is_invisible(c: char) -> bool {
    matches!(c,
        '\u{00AD}'                  // soft hyphen
        | '\u{061C}'                // Arabic letter mark
        | '\u{180E}'                // Mongolian vowel separator
        | '\u{200B}'..='\u{200C}'   // zero-width space, non-joiner
        | '\u{200E}'..='\u{200F}'   // left-to-right and right-to-left marks
        | '\u{202A}'..='\u{202E}'   // direction embeddings and overrides
        | '\u{2060}'..='\u{2064}'   // word joiner, invisible operators
        | '\u{2066}'..='\u{2069}'   // direction isolates
        | '\u{FEFF}' // zero-width no-break space
    )
}

pub(crate) fn sanitise_name(name: &str) -> Option<String> {
    let name: String = name.chars().filter(|c| !is_invisible(*c)).collect();
    let name = name.trim();
    let valid = !name.is_empty() && name.chars().count() <= MAX_NAME_CHARS && !name.chars().any(char::is_control);
    valid.then(|| name.to_owned())
}

pub(crate) fn valid_weight(weight_kg: f64) -> bool {
    weight_kg.is_finite() && (30.0..=200.0).contains(&weight_kg)
}

/// Trims chat text and drops control characters; `None` if nothing is left.
pub(crate) fn sanitise_chat(text: &str) -> Option<String> {
    let text: String = text
        .trim()
        .chars()
        .filter(|c| !c.is_control() && !is_invisible(*c))
        .take(MAX_CHAT_CHARS)
        .collect();
    (!text.is_empty()).then_some(text)
}

struct Client {
    sink: Box<dyn MessageSink>,
    last_grade: Option<f64>,
    device: DeviceKind,
    /// What a workout rider does now (#77).
    exercise: Option<Exercise>,
    /// The part of the rider's odometer already added to the community totals.
    counted_m: f64,
}

pub struct GameCore {
    world: World,
    settings: GameSettings,
    clients: HashMap<RiderId, Client>,
    tick: u64,
    /// Scheduled events and the wall clock (Unix seconds) they run on.
    events: Option<(Events, fn() -> f64)>,
    /// Community totals (#65): what humans ride here, by device.
    stats: DistanceStats,
    /// Boarding codes of all worlds (private and empty unless shared).
    codes: VehicleCodes,
    /// What this world is called in `codes` (a route id the client can rejoin with).
    world_id: String,
    /// Names of riders who left since the last tick, for events about them.
    departed: HashMap<RiderId, String>,
    /// Resume tokens and who is detached (#73).
    attachments: Attachments,
}

/// The wire code of a vehicle refusal.
fn vehicle_error_code(error: &WorldError) -> &'static str {
    match error {
        WorldError::NoSuchVehicle => "unknown_vehicle",
        WorldError::VehicleFull => "vehicle_full",
        WorldError::NotCaptain => "not_captain",
        WorldError::InEvent => "in_event",
        WorldError::AlreadyAboard => "already_aboard",
        // Not vehicle errors; the vehicle calls can't really produce them.
        WorldError::UnknownRider(_)
        | WorldError::UnknownRoute(_)
        | WorldError::NotHuman(_)
        | WorldError::Race(_)
        | WorldError::NoSuchTurn
        | WorldError::Racing
        | WorldError::OffRoute
        | WorldError::EventScheduled
        | WorldError::BadSeatCount
        | WorldError::PauseRejected => "invalid_vehicle",
    }
}

impl GameCore {
    pub fn new(world: World, settings: GameSettings) -> Self {
        let world_id = world.routes().first().map(|r| r.id().to_owned()).unwrap_or_default();
        Self {
            world,
            settings,
            clients: HashMap::new(),
            tick: 0,
            events: None,
            stats: DistanceStats::default(),
            codes: VehicleCodes::new(),
            attachments: Attachments::new(settings.grace_s, ResumeTokens::new(), world_id.clone()),
            world_id,
            departed: HashMap::new(),
        }
    }

    /// Shares the resume `tokens` with the other games, under this world's id
    /// (set it with [`GameCore::with_vehicle_codes`] first).
    pub fn with_resume_tokens(mut self, tokens: ResumeTokens) -> Self {
        self.attachments.set_registry(tokens, self.world_id.clone());
        self
    }

    /// Game time in seconds, which the grace period runs on.
    fn clock_s(&self) -> f64 {
        self.tick as f64 * self.settings.tick_seconds()
    }

    /// Shares the boarding `codes` with the other games; `world_id` is what
    /// this world is called there (a route id clients can rejoin with).
    pub fn with_vehicle_codes(mut self, codes: VehicleCodes, world_id: String) -> Self {
        self.codes = codes;
        self.world_id = world_id;
        self
    }

    /// Adds what riders cover to `stats` (shared with the other games of the server).
    pub fn with_stats(mut self, stats: DistanceStats) -> Self {
        self.stats = stats;
        self
    }

    /// Runs scheduled `events` on `wall_clock` (Unix seconds).
    pub fn with_events(mut self, events: Events, wall_clock: fn() -> f64) -> Self {
        self.events = Some((events, wall_clock));
        self
    }

    /// The event of the rider's route, as their state message carries it.
    fn event_state_for(&self, rider_id: RiderId) -> Option<Box<EventState>> {
        let (events, clock) = self.events.as_ref()?;
        events
            .view_for(&self.world, rider_id, clock())
            .map(|view| Box::new(event_state(&self.world, view)))
    }

    /// The scheduled events of this game, for `/api/info`.
    pub fn event_infos(&self) -> Vec<EventInfoWire> {
        let Some((events, clock)) = &self.events else {
            return Vec::new();
        };
        let routes: Vec<String> = self.world.routes().iter().map(|r| r.id().to_owned()).collect();
        events
            .infos(clock())
            .into_iter()
            .map(|info| event_info(&routes, info))
            .collect()
    }

    pub fn settings(&self) -> &GameSettings {
        &self.settings
    }

    pub fn world(&self) -> &World {
        &self.world
    }

    pub fn player_count(&self) -> usize {
        self.clients.len()
    }

    /// Humans on each route of the world, in route order.
    pub fn players_per_route(&self) -> Vec<usize> {
        let mut counts = vec![0; self.world.routes().len()];
        for rider in self.clients.keys().filter_map(|id| self.world.rider(*id)) {
            counts[rider.route] += 1;
        }
        counts
    }

    /// Humans riding with phone paddles on each route of the world, in route order.
    pub fn phones_per_route(&self) -> Vec<usize> {
        let mut counts = vec![0; self.world.routes().len()];
        for (id, client) in &self.clients {
            if client.device == DeviceKind::Paddle {
                if let Some(rider) = self.world.rider(*id) {
                    counts[rider.route] += 1;
                }
            }
        }
        counts
    }

    /// Joins route `route_id` (the world's first route for `None`), or, with
    /// a `vehicle_code`, straight onto that vehicle (wherever it rides). If
    /// boarding fails the rider is removed again and nothing is left behind.
    #[allow(clippy::too_many_arguments)]
    pub fn join(
        &mut self,
        name: &str,
        weight_kg: f64,
        ftp_w: Option<f64>,
        level_w: Option<f64>,
        route_id: Option<&str>,
        vehicle_code: Option<&str>,
        sink: Box<dyn MessageSink>,
    ) -> Result<RiderId, JoinError> {
        self.join_at(name, weight_kg, ftp_w, level_w, route_id, vehicle_code, None, sink)
            .map(|joined| joined.rider_id)
    }

    /// [`GameCore::join`], starting `start_m` metres along the route (a ride
    /// continued after the grace period, #73). A vehicle code ignores it: the
    /// rider sits where the vehicle is.
    #[allow(clippy::too_many_arguments)]
    pub fn join_at(
        &mut self,
        name: &str,
        weight_kg: f64,
        ftp_w: Option<f64>,
        level_w: Option<f64>,
        route_id: Option<&str>,
        vehicle_code: Option<&str>,
        start_m: Option<f64>,
        sink: Box<dyn MessageSink>,
    ) -> Result<JoinedRider, JoinError> {
        // Detached riders hold no place: their seat went with their connection.
        if self.clients.len() - self.attachments.detached_count() >= self.settings.max_players {
            return Err(JoinError::ServerFull);
        }
        let name = sanitise_name(name).ok_or(JoinError::InvalidName)?;
        if !valid_weight(weight_kg) {
            return Err(JoinError::InvalidWeight);
        }
        let route = match route_id {
            None => 0,
            Some(id) => self.world.route_index(id).ok_or(JoinError::UnknownRoute)?,
        };

        let rider_id = self
            .world
            .join_human_on(route, &name, weight_kg)
            .map_err(|_| JoinError::UnknownRoute)?;
        let _ = self
            .world
            .set_level(rider_id, human_level_wkg(level_w, ftp_w, weight_kg));
        if let Some(code) = vehicle_code {
            if let Err(error) = self.board_new_rider(rider_id, code) {
                self.world.leave(rider_id);
                return Err(error);
            }
        } else if let Some(start_m) = start_m {
            let length = self.world.routes()[route].length();
            let start_m = if start_m.is_finite() {
                start_m.clamp(0.0, length)
            } else {
                0.0
            };
            self.world.place_at(rider_id, start_m);
        }
        let (resume_token, epoch) = self.attachments.attach(rider_id);
        // A failed delivery here is cleaned up on the next tick.
        let _ = sink.deliver(ServerMessage::Joined { rider_id, resume_token });
        let event = self.event_state_for(rider_id);
        if let Some(state) = state_message(
            &self.world,
            self.tick,
            rider_id,
            self.settings.max_visible_riders,
            event,
            &|id| self.tags_of(id),
        ) {
            let _ = sink.deliver(state);
        }
        self.clients.insert(
            rider_id,
            Client {
                sink,
                last_grade: None,
                device: DeviceKind::Trainer,
                exercise: None,
                counted_m: self.world.rider(rider_id).map_or(0.0, |r| r.odometer),
            },
        );
        Ok(JoinedRider { rider_id, epoch })
    }

    /// The rider's connection dropped: they coast at 0 W, keep their race,
    /// event and seat, and are removed only after the grace period (#73).
    pub fn detach(&mut self, rider_id: RiderId) {
        if self.settings.grace_s <= 0.0 {
            return self.leave(rider_id);
        }
        let Some(client) = self.clients.get_mut(&rider_id) else {
            return;
        };
        client.sink = Box::new(NullSink);
        let _ = self.world.set_telemetry(rider_id, 0.0, None);
        let now_s = self.clock_s();
        self.attachments.detach(rider_id, now_s);
    }

    /// Hands the rider of `token` to a new connection: `joined` with the same
    /// id and token, then a fresh state. `None` if the token is unknown or expired.
    pub fn reattach(&mut self, token: &str, sink: Box<dyn MessageSink>) -> Option<JoinedRider> {
        let joined = self.attachments.reattach(token)?;
        let rider_id = joined.rider_id;
        let client = self.clients.get_mut(&rider_id)?;
        let _ = sink.deliver(ServerMessage::Joined {
            rider_id,
            resume_token: token.to_owned(),
        });
        client.sink = sink;
        // The new connection's trainer needs the grade again.
        client.last_grade = None;
        self.send_state(rider_id);
        Some(joined)
    }

    /// Whether `epoch` is the rider's current connection.
    pub fn is_attached(&self, rider_id: RiderId, epoch: u64) -> bool {
        self.attachments.is_current(rider_id, epoch)
    }

    /// Seats the just-joined rider (not yet a client) on the vehicle with `code`.
    fn board_new_rider(&mut self, rider_id: RiderId, code: &str) -> Result<(), JoinError> {
        let code = code.trim().to_ascii_uppercase();
        let vehicle = self.world.vehicle_by_code(&code).ok_or(JoinError::UnknownVehicle)?;
        self.world.board(vehicle, rider_id).map(|_| ()).map_err(|e| match e {
            WorldError::NoSuchVehicle => JoinError::UnknownVehicle,
            WorldError::VehicleFull => JoinError::VehicleFull,
            _ => JoinError::InvalidVehicle,
        })
    }

    /// Trainer for bots and unknown riders.
    pub fn device_of(&self, rider_id: RiderId) -> DeviceKind {
        self.clients
            .get(&rider_id)
            .map(|client| client.device)
            .unwrap_or_default()
    }

    /// Device and exercise of a client; the defaults for bots and unknown riders.
    fn tags_of(&self, rider_id: RiderId) -> RiderTags {
        self.clients
            .get(&rider_id)
            .map_or_else(RiderTags::default, |client| RiderTags {
                device: client.device,
                exercise: client.exercise,
            })
    }

    pub fn set_device(&mut self, rider_id: RiderId, device: DeviceKind) {
        if let Some(client) = self.clients.get_mut(&rider_id) {
            client.device = device;
            if device == DeviceKind::Workout {
                // Flags the rider and parks them for good; they just joined, so it can't be refused.
                let _ = self.world.start_workout(rider_id);
            }
        }
    }

    /// Whether the rider is a client doing a workout.
    fn in_workout(&self, rider_id: RiderId) -> bool {
        self.clients.contains_key(&rider_id) && self.world.rider(rider_id).is_some_and(|r| r.workout)
    }

    /// Answers a riding message of a workout rider; `true` if it was one.
    fn refuse_in_workout(&self, rider_id: RiderId) -> bool {
        let workout = self.in_workout(rider_id);
        if workout {
            self.reply_error(rider_id, "in_workout", "you are doing a workout");
        }
        workout
    }

    /// The exercise a workout rider does now; others get `not_in_workout`.
    pub fn workout(&mut self, rider_id: RiderId, exercise: Option<Exercise>) {
        if !self.clients.contains_key(&rider_id) {
            return;
        }
        if !self.in_workout(rider_id) {
            self.reply_error(rider_id, "not_in_workout", "you did not join as a workout");
            return;
        }
        if let Some(client) = self.clients.get_mut(&rider_id) {
            client.exercise = exercise;
        }
    }

    pub fn leave(&mut self, rider_id: RiderId) {
        if self.clients.remove(&rider_id).is_some() {
            self.attachments.forget(rider_id);
            if let Some(rider) = self.world.rider(rider_id) {
                self.departed.insert(rider_id, rider.name.clone());
            }
            if let Some((events, _)) = &mut self.events {
                events.rider_gone(&mut self.world, rider_id);
            }
            self.world.leave(rider_id);
        }
    }

    pub fn telemetry(&mut self, rider_id: RiderId, power: f64, cadence: Option<f64>) {
        // A workout rider has no power meter; ignored silently.
        if self.clients.contains_key(&rider_id) && !self.in_workout(rider_id) {
            let _ = self.world.set_telemetry(rider_id, power, cadence);
        }
    }

    pub fn input(&mut self, rider_id: RiderId, action: InputAction) {
        if !self.clients.contains_key(&rider_id) || self.refuse_in_workout(rider_id) {
            return;
        }
        let delta = match action {
            InputAction::LaneLeft => -1,
            InputAction::LaneRight => 1,
        };
        // Seated non-captains get `NotCaptain`: ignored silently.
        let _ = self.world.shift_lane(rider_id, delta);
    }

    fn reply_error(&self, rider_id: RiderId, code: &str, message: impl Into<String>) {
        if let Some(client) = self.clients.get(&rider_id) {
            let _ = client.sink.deliver(ServerMessage::error(code, message));
        }
    }

    /// Starts a vehicle with the rider as captain.
    pub fn create_vehicle(&mut self, rider_id: RiderId, kind: &str, seats: u8, bots: bool) {
        if !self.clients.contains_key(&rider_id) || self.refuse_in_workout(rider_id) {
            return;
        }
        let Some(kind) = VehicleKind::new(kind, seats) else {
            self.reply_error(
                rider_id,
                "invalid_vehicle",
                "no such kind of vehicle or number of seats",
            );
            return;
        };
        let codes = self.codes.clone();
        match self
            .world
            .create_vehicle(rider_id, kind, bots, &|code| !codes.try_reserve(code, &self.world_id))
        {
            Ok(id) => {
                if let Some(vehicle) = self.world.vehicle(id) {
                    self.codes.insert(&vehicle.code, &self.world_id);
                }
                self.send_state(rider_id);
            }
            Err(e) => self.reply_error(rider_id, vehicle_error_code(&e), e.to_string()),
        }
    }

    /// Boards the vehicle with `code`; a code of another world points there.
    pub fn board_vehicle(&mut self, rider_id: RiderId, code: &str) {
        if !self.clients.contains_key(&rider_id) || self.refuse_in_workout(rider_id) {
            return;
        }
        let code = code.trim().to_ascii_uppercase();
        let Some(vehicle) = self.world.vehicle_by_code(&code) else {
            match self.codes.world_of(&code) {
                Some(world) if world != self.world_id => {
                    self.reply_error(rider_id, "vehicle_elsewhere", format!("route:{world}"));
                }
                _ => self.reply_error(rider_id, "unknown_vehicle", "no vehicle has this code"),
            }
            return;
        };
        match self.world.board(vehicle, rider_id) {
            Ok(_) => self.send_state(rider_id),
            Err(e) => self.reply_error(rider_id, vehicle_error_code(&e), e.to_string()),
        }
    }

    pub fn leave_vehicle(&mut self, rider_id: RiderId) {
        if self.clients.contains_key(&rider_id) {
            self.world.leave_vehicle(rider_id);
            self.send_state(rider_id);
        }
    }

    /// Parks or unparks a rider for a pause (#89).
    pub fn pause(&mut self, rider_id: RiderId, on: bool) {
        if !self.clients.contains_key(&rider_id) || self.refuse_in_workout(rider_id) {
            return;
        }
        let result = if on {
            self.world.park(rider_id)
        } else {
            self.world.unpark(rider_id)
        };
        if let Err(WorldError::PauseRejected) = result {
            self.reply_error(
                rider_id,
                "pause_rejected",
                "you can't pause in a race, event or vehicle",
            );
        }
    }

    /// Sends the rider a fresh state now (after their vehicle changed).
    fn send_state(&self, rider_id: RiderId) {
        let Some(client) = self.clients.get(&rider_id) else {
            return;
        };
        let event = self.event_state_for(rider_id);
        if let Some(state) = state_message(
            &self.world,
            self.tick,
            rider_id,
            self.settings.max_visible_riders,
            event,
            &|id| self.tags_of(id),
        ) {
            let _ = client.sink.deliver(state);
        }
    }

    pub fn start_race(&mut self, rider_id: RiderId, laps: u32) {
        if !self.clients.contains_key(&rider_id) || self.refuse_in_workout(rider_id) {
            return;
        }
        let Some(client) = self.clients.get(&rider_id) else {
            return;
        };
        if let Err(e) = self.world.start_race(laps, Some(rider_id)) {
            let _ = client
                .sink
                .deliver(ServerMessage::error("race_rejected", e.to_string()));
        }
    }

    /// Enters the rider in the race that is counting down.
    pub fn join_race(&mut self, rider_id: RiderId) {
        if !self.clients.contains_key(&rider_id) || self.refuse_in_workout(rider_id) {
            return;
        }
        let Some(client) = self.clients.get(&rider_id) else {
            return;
        };
        if let Err(e) = self.world.join_race(rider_id) {
            let _ = client
                .sink
                .deliver(ServerMessage::error("race_rejected", e.to_string()));
        }
    }

    pub fn leave_race(&mut self, rider_id: RiderId) {
        if self.clients.contains_key(&rider_id) {
            self.world.leave_race(rider_id);
        }
    }

    /// Enters the rider in the scheduled event `event_id`.
    pub fn join_event(&mut self, rider_id: RiderId, event_id: &str) {
        if !self.clients.contains_key(&rider_id) || self.refuse_in_workout(rider_id) {
            return;
        }
        let Some(client) = self.clients.get(&rider_id) else {
            return;
        };
        let result = match &mut self.events {
            Some((events, clock)) => events.join(&mut self.world, rider_id, event_id, clock()),
            None => Err(openradlr_sim::events::EventError::Unknown),
        };
        if let Err(e) = result {
            let _ = client.sink.deliver(ServerMessage::error(e.code(), e.to_string()));
        }
    }

    pub fn leave_event(&mut self, rider_id: RiderId) {
        if self.clients.contains_key(&rider_id) {
            if let Some((events, _)) = &mut self.events {
                events.leave(&mut self.world, rider_id);
            }
        }
    }

    /// Picks the road for the next junction; a refusal (no such road, in a
    /// race) is answered with `turn_rejected`.
    pub fn turn(&mut self, rider_id: RiderId, edge: Option<&str>) {
        if !self.clients.contains_key(&rider_id) || self.refuse_in_workout(rider_id) {
            return;
        }
        let Some(client) = self.clients.get(&rider_id) else {
            return;
        };
        match self.world.choose_turn(rider_id, edge) {
            Err(WorldError::NotCaptain) => {}
            Err(e) => {
                let _ = client
                    .sink
                    .deliver(ServerMessage::error("turn_rejected", e.to_string()));
            }
            Ok(()) => {}
        }
    }

    pub fn chat(&mut self, rider_id: RiderId, text: &str) {
        let Some(name) = self.world.rider(rider_id).map(|r| r.name.clone()) else {
            return;
        };
        if !self.clients.contains_key(&rider_id) {
            return;
        }
        let Some(text) = sanitise_chat(text) else {
            return;
        };
        self.broadcast(&ServerMessage::Chat { rider_id, name, text });
    }

    /// Advances the simulation by one tick and sends out events, state and
    /// resistance updates.
    pub fn tick(&mut self) {
        let dt = self.settings.tick_seconds();
        self.world.tick(dt);
        // Bots are not clients, so only humans count.
        for (&rider_id, client) in &mut self.clients {
            if let Some(rider) = self.world.rider(rider_id) {
                self.stats.add(client.device, rider.odometer - client.counted_m);
                client.counted_m = rider.odometer;
            }
        }
        if let Some((events, clock)) = &mut self.events {
            events.sync(&mut self.world, clock(), dt);
        }
        self.tick += 1;
        // Riders whose connection stayed gone past the grace period leave now.
        for rider_id in self.attachments.expired(self.clock_s()) {
            self.leave(rider_id);
        }

        for event in self.world.drain_events() {
            self.track_code(&event);
            if let Some((route, message)) = event_message(&self.world, &self.departed, &event) {
                self.send_to_route(route, &message);
            }
        }
        self.departed.clear();
        let notices = self.events.as_mut().map(|(events, _)| events.drain_notices());
        for notice in notices.into_iter().flatten() {
            if let Some((route, message)) = event_notice_message(notice) {
                self.send_to_route(route, &message);
            }
        }

        let mut closed = Vec::new();
        if self.tick.is_multiple_of(self.settings.broadcast_every()) {
            // Everyone gets their own view: the riders around them.
            for (&rider_id, client) in &self.clients {
                let event = self.event_state_for(rider_id);
                let Some(state) = state_message(
                    &self.world,
                    self.tick,
                    rider_id,
                    self.settings.max_visible_riders,
                    event,
                    &|id| self.tags_of(id),
                ) else {
                    continue;
                };
                if client.sink.deliver(state).is_err() {
                    closed.push(rider_id);
                }
            }
        }

        for (&rider_id, client) in &mut self.clients {
            let Some(grade) = self.world.grade_for(rider_id) else {
                continue;
            };
            let changed = client
                .last_grade
                .is_none_or(|last| (grade - last).abs() >= self.settings.resistance_step_percent);
            if changed {
                client.last_grade = Some(grade);
                let message = ServerMessage::Resistance {
                    grade_percent: (grade * 10.0).round() / 10.0,
                };
                if client.sink.deliver(message).is_err() {
                    closed.push(rider_id);
                }
            }
        }
        for rider_id in closed {
            self.detach(rider_id);
        }
    }

    /// Keeps the code registry in step with the world's vehicles.
    fn track_code(&self, event: &WorldEvent) {
        match event {
            WorldEvent::Vehicle {
                id,
                change: VehicleChange::Created,
                ..
            } => {
                if let Some(vehicle) = self.world.vehicle(*id) {
                    self.codes.insert(&vehicle.code, &self.world_id);
                }
            }
            WorldEvent::Vehicle {
                change: VehicleChange::Dissolved { code },
                ..
            } => self.codes.remove(code, &self.world_id),
            _ => {}
        }
    }

    /// Sends `message` to the riders of route `route`.
    fn send_to_route(&mut self, route: RouteIndex, message: &ServerMessage) {
        let world = &self.world;
        let closed: Vec<RiderId> = self
            .clients
            .iter()
            .filter(|(id, _)| world.rider(**id).is_some_and(|r| r.route == route))
            .filter(|(_, client)| client.sink.deliver(message.clone()).is_err())
            .map(|(&id, _)| id)
            .collect();
        for rider_id in closed {
            self.detach(rider_id);
        }
    }

    fn broadcast(&mut self, message: &ServerMessage) {
        let closed: Vec<RiderId> = self
            .clients
            .iter()
            .filter(|(_, client)| client.sink.deliver(message.clone()).is_err())
            .map(|(&id, _)| id)
            .collect();
        for rider_id in closed {
            self.detach(rider_id);
        }
    }
}

impl Game for GameCore {
    fn tick_seconds(&self) -> f64 {
        self.settings.tick_seconds()
    }

    fn player_count(&self) -> usize {
        GameCore::player_count(self)
    }

    fn route_ids(&self) -> Vec<String> {
        self.world.routes().iter().map(|r| r.id().to_owned()).collect()
    }

    fn players_per_route(&self) -> Vec<usize> {
        GameCore::players_per_route(self)
    }

    fn phones_per_route(&self) -> Vec<usize> {
        GameCore::phones_per_route(self)
    }

    fn join(
        &mut self,
        name: &str,
        weight_kg: f64,
        ftp_w: Option<f64>,
        level_w: Option<f64>,
        route_id: Option<&str>,
        vehicle_code: Option<&str>,
        start_m: Option<f64>,
        sink: Box<dyn MessageSink>,
    ) -> Result<JoinedRider, JoinError> {
        GameCore::join_at(
            self,
            name,
            weight_kg,
            ftp_w,
            level_w,
            route_id,
            vehicle_code,
            start_m,
            sink,
        )
    }

    fn leave(&mut self, rider_id: RiderId) {
        GameCore::leave(self, rider_id);
    }

    fn is_attached(&self, rider_id: RiderId, epoch: u64) -> bool {
        GameCore::is_attached(self, rider_id, epoch)
    }

    fn detach(&mut self, rider_id: RiderId) {
        GameCore::detach(self, rider_id);
    }

    fn reattach(&mut self, token: &str, sink: Box<dyn MessageSink>) -> Option<JoinedRider> {
        GameCore::reattach(self, token, sink)
    }

    fn set_device(&mut self, rider_id: RiderId, device: DeviceKind) {
        GameCore::set_device(self, rider_id, device);
    }

    fn telemetry(&mut self, rider_id: RiderId, power: f64, cadence: Option<f64>) {
        GameCore::telemetry(self, rider_id, power, cadence);
    }

    fn workout(&mut self, rider_id: RiderId, exercise: Option<Exercise>) {
        GameCore::workout(self, rider_id, exercise);
    }

    fn input(&mut self, rider_id: RiderId, action: InputAction) {
        GameCore::input(self, rider_id, action);
    }

    fn start_race(&mut self, rider_id: RiderId, laps: u32) {
        GameCore::start_race(self, rider_id, laps);
    }

    fn join_race(&mut self, rider_id: RiderId) {
        GameCore::join_race(self, rider_id);
    }

    fn leave_race(&mut self, rider_id: RiderId) {
        GameCore::leave_race(self, rider_id);
    }

    fn join_event(&mut self, rider_id: RiderId, event_id: &str) {
        GameCore::join_event(self, rider_id, event_id);
    }

    fn leave_event(&mut self, rider_id: RiderId) {
        GameCore::leave_event(self, rider_id);
    }

    fn event_infos(&self) -> Vec<EventInfoWire> {
        GameCore::event_infos(self)
    }

    fn turn(&mut self, rider_id: RiderId, edge: Option<&str>) {
        GameCore::turn(self, rider_id, edge);
    }

    fn create_vehicle(&mut self, rider_id: RiderId, kind: &str, seats: u8, bots: bool) {
        GameCore::create_vehicle(self, rider_id, kind, seats, bots);
    }

    fn board_vehicle(&mut self, rider_id: RiderId, code: &str) {
        GameCore::board_vehicle(self, rider_id, code);
    }

    fn leave_vehicle(&mut self, rider_id: RiderId) {
        GameCore::leave_vehicle(self, rider_id);
    }

    fn pause(&mut self, rider_id: RiderId, on: bool) {
        GameCore::pause(self, rider_id, on);
    }

    fn chat(&mut self, rider_id: RiderId, text: &str) {
        GameCore::chat(self, rider_id, text);
    }

    fn tick(&mut self) {
        GameCore::tick(self);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{Exercise, GameEvent, RaceState, RouteRiders};
    use openradlr_sim::rng::SplitMix64;
    use openradlr_sim::route::{Point, Route, RouteSpec};
    use openradlr_sim::SimConfig;
    use std::sync::{Arc, Mutex};

    /// In-memory sink that records messages and can simulate a disconnect.
    #[derive(Clone, Default)]
    struct RecordingSink {
        messages: Arc<Mutex<Vec<ServerMessage>>>,
        closed: Arc<Mutex<bool>>,
    }

    impl RecordingSink {
        fn take(&self) -> Vec<ServerMessage> {
            std::mem::take(&mut *self.messages.lock().unwrap())
        }

        fn close(&self) {
            *self.closed.lock().unwrap() = true;
        }
    }

    impl MessageSink for RecordingSink {
        fn deliver(&self, message: ServerMessage) -> Result<(), SinkClosed> {
            if *self.closed.lock().unwrap() {
                return Err(SinkClosed);
            }
            self.messages.lock().unwrap().push(message);
            Ok(())
        }
    }

    fn hilly_route() -> Route {
        Route::new(RouteSpec {
            id: "test".into(),
            name: "Test".into(),
            lanes: 4,
            seed: 1,
            points: vec![
                Point::new(0.0, 0.0, 0.0),
                Point::new(500.0, 0.0, 0.0),
                Point::new(500.0, 500.0, 25.0),
                Point::new(0.0, 500.0, 25.0),
            ],
            markers: vec![],
            walk: vec![],
        })
        .unwrap()
    }

    fn game(target_riders: usize, max_players: usize) -> GameCore {
        let world = World::new(
            hilly_route(),
            SimConfig {
                target_riders,
                race_countdown_s: 0.5,
                ..SimConfig::default()
            },
            Box::new(SplitMix64::new(1)),
        );
        GameCore::new(
            world,
            GameSettings {
                max_players,
                ..GameSettings::default()
            },
        )
    }

    fn join(game: &mut GameCore, name: &str) -> (RiderId, RecordingSink) {
        let sink = RecordingSink::default();
        let id = game
            .join(name, 70.0, None, None, None, None, Box::new(sink.clone()))
            .unwrap();
        (id, sink)
    }

    fn count<F: Fn(&ServerMessage) -> bool>(messages: &[ServerMessage], predicate: F) -> usize {
        messages.iter().filter(|m| predicate(m)).count()
    }

    #[test]
    fn joining_confirms_and_sends_an_immediate_snapshot() {
        let mut game = game(4, 10);
        let (id, sink) = join(&mut game, "Anna");
        let messages = sink.take();
        assert!(matches!(
            &messages[0],
            ServerMessage::Joined { rider_id, resume_token } if *rider_id == id && resume_token.len() == 64
        ));
        match &messages[1] {
            ServerMessage::State { riders, .. } => {
                assert!(riders.iter().any(|r| r.id == id && !r.is_bot));
                assert!(riders.iter().any(|r| r.is_bot));
            }
            other => panic!("expected state, got {other:?}"),
        }
    }

    #[test]
    fn others_see_what_a_rider_rides_with() {
        let mut game = game(0, 10);
        let (anna, _) = join(&mut game, "Anna");
        let (ben, ben_sink) = join(&mut game, "Ben");
        game.set_device(anna, DeviceKind::Paddle);
        for _ in 0..game.settings().broadcast_every() {
            game.tick();
        }
        let messages = ben_sink.take();
        let Some(ServerMessage::State { riders, .. }) =
            messages.iter().rev().find(|m| matches!(m, ServerMessage::State { .. }))
        else {
            panic!("expected a state message");
        };
        let device = |id| riders.iter().find(|r| r.id == id).map(|r| r.device);
        assert_eq!(device(anna), Some(DeviceKind::Paddle));
        assert_eq!(device(ben), Some(DeviceKind::Trainer));
        // Trainers stay off the wire; paddlers are marked.
        let json = messages.last().unwrap().to_json();
        assert_eq!(json.matches(r#""device":"paddle""#).count(), 1);
        assert!(!json.contains(r#""device":"trainer""#));
    }

    /// Pedals every tick for `seconds`.
    fn ride(game: &mut GameCore, riders: &[RiderId], watts: f64, seconds: u32) {
        for _ in 0..seconds * game.settings().tick_hz {
            for &id in riders {
                game.telemetry(id, watts, Some(90.0));
            }
            game.tick();
        }
    }

    #[test]
    fn distance_is_counted_per_device_and_ignores_bots_and_sim() {
        let stats = DistanceStats::default();
        let mut game = game(6, 10).with_stats(stats.clone());
        let (trainer, _) = join(&mut game, "Anna");
        let (paddle, _) = join(&mut game, "Ben");
        let (sim, _) = join(&mut game, "Cleo");
        game.set_device(paddle, DeviceKind::Paddle);
        game.set_device(sim, DeviceKind::Sim);
        ride(&mut game, &[trainer, paddle, sim], 200.0, 20);

        let odometer = |id| game.world().rider(id).unwrap().odometer;
        assert!(odometer(trainer) > 50.0);
        let total = stats.snapshot();
        assert!((total.trainer_m - odometer(trainer)).abs() < 1e-6);
        assert!((total.paddle_m - odometer(paddle)).abs() < 1e-6);
        // Bots rode too, and so did the sim rider; none of it is in the totals.
        assert!(game.world().riders().filter(|r| r.is_bot()).any(|r| r.odometer > 50.0));
        assert!(odometer(sim) > 50.0);
    }

    #[test]
    fn distance_ridden_before_leaving_stays_counted() {
        let stats = DistanceStats::default();
        let mut game = game(0, 10).with_stats(stats.clone());
        let (anna, _) = join(&mut game, "Anna");
        ride(&mut game, &[anna], 200.0, 10);
        let before = stats.snapshot().trainer_m;
        game.leave(anna);
        ride(&mut game, &[], 0.0, 5);
        assert!(before > 20.0);
        assert_eq!(stats.snapshot().trainer_m, before);
    }

    #[test]
    fn invalid_joins_are_rejected() {
        let mut game = game(0, 1);
        let sink = || Box::new(RecordingSink::default());
        assert_eq!(
            game.join("   ", 70.0, None, None, None, None, sink()),
            Err(JoinError::InvalidName)
        );
        assert_eq!(
            game.join(
                "A name that is far too long to show",
                70.0,
                None,
                None,
                None,
                None,
                sink()
            ),
            Err(JoinError::InvalidName)
        );
        assert_eq!(
            game.join("Anna", 10.0, None, None, None, None, sink()),
            Err(JoinError::InvalidWeight)
        );
        assert_eq!(
            game.join("Anna", f64::NAN, None, None, None, None, sink()),
            Err(JoinError::InvalidWeight)
        );
        assert_eq!(
            game.join("Anna", 70.0, None, None, Some("nowhere"), None, sink()),
            Err(JoinError::UnknownRoute)
        );
        game.join("Anna", 70.0, None, None, None, None, sink()).unwrap();
        assert_eq!(
            game.join("Ben", 70.0, None, None, None, None, sink()),
            Err(JoinError::ServerFull)
        );
    }

    #[test]
    fn state_is_broadcast_at_the_configured_rate() {
        let mut game = game(2, 10);
        let (_, sink) = join(&mut game, "Anna");
        sink.take();
        for _ in 0..20 {
            game.tick();
        }
        let states = count(&sink.take(), |m| matches!(m, ServerMessage::State { .. }));
        assert_eq!(states, 4, "20 ticks at 20 Hz with 4 Hz broadcasts");
    }

    #[test]
    fn resistance_is_sent_on_join_and_when_the_grade_changes() {
        let mut game = game(0, 10);
        let (id, sink) = join(&mut game, "Anna");
        game.tick();
        assert_eq!(
            count(&sink.take(), |m| matches!(m, ServerMessage::Resistance { .. })),
            1,
            "initial resistance"
        );

        for _ in 0..10 {
            game.tick();
        }
        assert_eq!(
            count(&sink.take(), |m| matches!(m, ServerMessage::Resistance { .. })),
            0,
            "flat stays flat"
        );

        for _ in 0..(120 * 20) {
            game.telemetry(id, 400.0, Some(90.0));
            game.tick();
        }
        let grades: Vec<f64> = sink
            .take()
            .into_iter()
            .filter_map(|m| match m {
                ServerMessage::Resistance { grade_percent } => Some(grade_percent),
                _ => None,
            })
            .collect();
        assert!(grades.contains(&5.0), "climb should be reported, got {grades:?}");
    }

    #[test]
    fn lane_input_moves_the_rider() {
        let mut game = game(0, 10);
        let (id, _) = join(&mut game, "Anna");
        let before = game.world().rider(id).unwrap().target_lane;
        game.input(id, InputAction::LaneRight);
        assert_eq!(game.world().rider(id).unwrap().target_lane, before + 1);
    }

    #[test]
    fn names_lose_invisible_and_direction_changing_characters() {
        // A right-to-left override makes "Anna\u{202E}nib" read "Annabin"; zero-width
        // spaces make look-alike names. Both go; an emoji's zero-width joiner stays.
        assert_eq!(sanitise_name("Anna\u{202E}nib").as_deref(), Some("Annanib"));
        assert_eq!(sanitise_name("B\u{200B}en\u{2066}").as_deref(), Some("Ben"));
        assert_eq!(sanitise_name("\u{FEFF}\u{200B}"), None);
        let family = "\u{1F468}\u{200D}\u{1F467}";
        assert_eq!(sanitise_name(family).as_deref(), Some(family));
    }

    #[test]
    fn chat_loses_invisible_and_direction_changing_characters() {
        assert_eq!(sanitise_chat("hi\u{202E} there\u{200F}").as_deref(), Some("hi there"));
    }

    #[test]
    fn chat_is_broadcast_and_sanitised() {
        let mut game = game(0, 10);
        let (anna, anna_sink) = join(&mut game, "Anna");
        let (_, ben_sink) = join(&mut game, "Ben");
        game.chat(anna, "  hello\u{7}  ");
        game.chat(anna, "   ");
        let expected = ServerMessage::Chat {
            rider_id: anna,
            name: "Anna".into(),
            text: "hello".into(),
        };
        assert!(anna_sink.take().contains(&expected));
        let ben = ben_sink.take();
        assert_eq!(count(&ben, |m| matches!(m, ServerMessage::Chat { .. })), 1);
    }

    #[test]
    fn invalid_race_requests_get_an_error() {
        let mut game = game(0, 10);
        let (id, sink) = join(&mut game, "Anna");
        sink.take();
        game.start_race(id, 0);
        assert!(matches!(&sink.take()[..], [ServerMessage::Error { code, .. }] if code == "race_rejected"));
    }

    #[test]
    fn race_events_reach_every_client() {
        let mut game = game(0, 10);
        let (id, sink) = join(&mut game, "Anna");
        game.start_race(id, 1);
        for _ in 0..20 {
            game.tick();
        }
        let messages = sink.take();
        assert!(messages.contains(&ServerMessage::Event {
            event: GameEvent::RaceCountdown { laps: 1, seconds: 0.5 }
        }));
        assert!(messages.contains(&ServerMessage::Event {
            event: GameEvent::RaceStarted { laps: 1 }
        }));
        assert!(messages.iter().any(|m| matches!(
            m,
            ServerMessage::State {
                race: RaceState::Running { .. },
                ..
            }
        )));
    }

    #[test]
    fn races_are_opt_in() {
        let mut game = game(0, 10);
        let (anna, anna_sink) = join(&mut game, "Anna");
        let (ben, ben_sink) = join(&mut game, "Ben");
        let (cara, _) = join(&mut game, "Cara");
        game.join_race(ben);
        assert!(matches!(&ben_sink.take().last(), Some(ServerMessage::Error { code, .. }) if code == "race_rejected"));

        game.start_race(anna, 1);
        game.join_race(ben);
        game.join_race(cara);
        game.leave_race(cara);
        // The countdown (0.5 s) outlasts one broadcast interval (5 ticks).
        for _ in 0..5 {
            game.tick();
        }
        let countdown = anna_sink.take().into_iter().find_map(|m| match m {
            ServerMessage::State {
                race: RaceState::Countdown { entrants, .. },
                ..
            } => Some(entrants),
            _ => None,
        });
        let mut entrants = countdown.expect("a state during the countdown");
        entrants.sort_unstable();
        assert_eq!(entrants, vec![anna, ben]);
        assert!(game.world().is_entered(anna) && !game.world().is_entered(cara));
    }

    #[test]
    fn disconnected_clients_are_removed_and_replaced_by_bots() {
        let mut game = game(3, 10);
        // Without a grace period; with one see `failed_delivery_detaches_instead_of_leaving`.
        game.settings.grace_s = 0.0;
        let (id, sink) = join(&mut game, "Anna");
        sink.close();
        game.tick();
        assert_eq!(game.player_count(), 0);
        assert!(game.world().rider(id).is_none());
        assert_eq!(game.world().bot_count(), 3);
    }

    #[test]
    fn explicit_leave_removes_the_rider() {
        let mut game = game(0, 10);
        let (id, _) = join(&mut game, "Anna");
        game.leave(id);
        assert_eq!(game.player_count(), 0);
        assert!(game.world().rider(id).is_none());
        game.telemetry(id, 200.0, None);
        game.input(id, InputAction::LaneLeft);
    }

    // --- one world per map (#14) ------------------------------------------

    /// Two 2 km loops side by side, 1 km apart (`east` starts at x = 1000).
    fn map_game() -> GameCore {
        let route = |id: &str, x: f64| {
            Route::new(RouteSpec {
                id: id.into(),
                name: id.into(),
                lanes: 4,
                seed: 1,
                points: vec![
                    Point::new(x, 0.0, 0.0),
                    Point::new(x, 500.0, 0.0),
                    Point::new(x + 500.0, 500.0, 0.0),
                    Point::new(x + 500.0, 0.0, 0.0),
                ],
                markers: vec![],
                walk: vec![],
            })
            .unwrap()
        };
        let world = World::with_routes(
            vec![route("west", -2000.0), route("east", 1000.0)],
            SimConfig {
                target_riders: 0,
                race_countdown_s: 0.5,
                ..SimConfig::default()
            },
            Box::new(SplitMix64::new(1)),
        );
        GameCore::new(world, GameSettings::default())
    }

    fn join_on(game: &mut GameCore, name: &str, route: &str) -> (RiderId, RecordingSink) {
        let sink = RecordingSink::default();
        let id = game
            .join(name, 70.0, None, None, Some(route), None, Box::new(sink.clone()))
            .unwrap();
        (id, sink)
    }

    fn last_state(sink: &RecordingSink) -> (Vec<RiderId>, RaceState, RouteRiders) {
        sink.take()
            .into_iter()
            .rev()
            .find_map(|m| match m {
                ServerMessage::State {
                    riders,
                    race,
                    route_riders,
                    ..
                } => Some((riders.iter().map(|r| r.id).collect(), race, route_riders)),
                _ => None,
            })
            .expect("a state message")
    }

    #[test]
    fn riders_join_the_route_they_ask_for() {
        let mut game = map_game();
        let (west, _) = join_on(&mut game, "West", "west");
        let (east, _) = join_on(&mut game, "East", "east");
        let (default, _) = join(&mut game, "Default");
        assert_eq!(game.world().rider(west).unwrap().route, 0);
        assert_eq!(game.world().rider(east).unwrap().route, 1);
        assert_eq!(game.world().rider(default).unwrap().route, 0);
        assert_eq!(game.players_per_route(), vec![2, 1]);
        assert_eq!(Game::route_ids(&game), vec!["west".to_owned(), "east".to_owned()]);
    }

    #[test]
    fn state_carries_riders_of_every_route_however_far() {
        let mut game = map_game();
        let (west, west_sink) = join_on(&mut game, "West", "west");
        let (east, east_sink) = join_on(&mut game, "East", "east");
        let (near, _) = join_on(&mut game, "Near", "east");
        for _ in 0..5 {
            game.tick();
        }
        let (mut seen, _, route_riders) = last_state(&west_sink);
        seen.sort_unstable();
        assert_eq!(seen, vec![west, east, near], "the east loop is 3 km away, still listed");
        assert_eq!(route_riders, RouteRiders { humans: 1, bots: 0 });
        let (mut seen, _, route_riders) = last_state(&east_sink);
        seen.sort_unstable();
        assert_eq!(seen, vec![west, east, near]);
        assert_eq!(route_riders, RouteRiders { humans: 2, bots: 0 });
    }

    #[test]
    fn phone_riders_are_counted_per_route() {
        let mut game = map_game();
        let (west, _) = join_on(&mut game, "West", "west");
        join_on(&mut game, "East", "east");
        assert_eq!(game.phones_per_route(), vec![0, 0]);
        game.set_device(west, DeviceKind::Paddle);
        assert_eq!(game.phones_per_route(), vec![1, 0]);
    }

    #[test]
    fn the_rider_cap_keeps_humans_over_bots() {
        let mut game = game(8, 10);
        game.settings.max_visible_riders = 3;
        let (anna, sink) = join(&mut game, "Anna");
        let (ben, _) = join(&mut game, "Ben");
        for _ in 0..5 {
            game.tick();
        }
        let riders = sink
            .take()
            .into_iter()
            .rev()
            .find_map(|m| match m {
                ServerMessage::State { riders, .. } => Some(riders),
                _ => None,
            })
            .expect("a state message");
        assert_eq!(riders.len(), 3);
        let humans: Vec<RiderId> = riders.iter().filter(|r| !r.is_bot).map(|r| r.id).collect();
        assert!(
            humans.contains(&anna) && humans.contains(&ben),
            "both humans, then one bot"
        );
    }

    #[test]
    fn race_entrants_stay_in_view_and_race_news_stays_on_the_route() {
        let mut game = map_game();
        // Out of sight of everybody, however close.
        game.settings.max_visible_riders = 0;
        let (east, east_sink) = join_on(&mut game, "East", "east");
        let (rival, _) = join_on(&mut game, "Rival", "east");
        let (tourist, _) = join_on(&mut game, "Tourist", "east");
        let (west_id, west_sink) = join_on(&mut game, "West", "west");
        game.start_race(east, 1);
        game.join_race(rival);
        for _ in 0..5 {
            game.tick();
        }
        let (mut seen, race, _) = last_state(&east_sink);
        seen.sort_unstable();
        assert_eq!(seen, vec![east, rival], "entrants, not the tourist {tourist}");
        assert!(matches!(race, RaceState::Countdown { .. }));
        let west = west_sink.take();
        let news = |m: &ServerMessage| match m {
            ServerMessage::Event {
                event: GameEvent::RiderJoined { rider_id, .. },
            } => *rider_id != west_id,
            ServerMessage::Event { .. } => true,
            _ => false,
        };
        assert_eq!(
            count(&west, news),
            0,
            "nothing about the east loop's race or riders: {west:?}"
        );
        assert!(west.iter().any(|m| matches!(
            m,
            ServerMessage::State {
                race: RaceState::Idle,
                ..
            }
        )));
    }

    // --- scheduled events ---------------------------------------------------

    thread_local! {
        static CLOCK_S: std::cell::Cell<f64> = const { std::cell::Cell::new(0.0) };
    }

    fn fake_clock() -> f64 {
        CLOCK_S.with(std::cell::Cell::get)
    }

    fn set_clock(seconds: f64) {
        CLOCK_S.with(|c| c.set(seconds));
    }

    fn event_game() -> GameCore {
        use openradlr_sim::events::{EventDef, EventKind, EventLength, Events};
        use openradlr_sim::schedule::Schedule;
        let def = EventDef {
            id: "ride".into(),
            name: "Test ride".into(),
            kind: EventKind::GroupRide,
            route: 0,
            length: EventLength::Distance(3000.0),
            schedule: Schedule::Once {
                starts_at_s: 100.0,
                lobby_s: 50.0,
                duration_s: 1500.0,
            },
        };
        game(0, 10).with_events(Events::new(vec![def]), fake_clock)
    }

    fn tick_n(game: &mut GameCore, n: usize) {
        for _ in 0..n {
            game.tick();
        }
    }

    #[test]
    fn joining_an_event_in_its_lobby_shows_in_state_and_the_start_is_announced() {
        let mut game = event_game();
        let (id, sink) = join(&mut game, "Anna");
        set_clock(60.0);
        tick_n(&mut game, 5);
        let messages = sink.take();
        assert!(messages.iter().any(|m| matches!(
            m,
            ServerMessage::Event { event: GameEvent::EventLobby { event_id, .. } } if event_id == "ride"
        )));
        let event = messages
            .iter()
            .rev()
            .find_map(|m| match m {
                ServerMessage::State { event, .. } => Some(event.clone()),
                _ => None,
            })
            .unwrap()
            .expect("an event in state");
        assert!(!event.entered);
        assert_eq!(event.phase, "lobby");

        game.join_event(id, "ride");
        tick_n(&mut game, 5);
        let event = sink
            .take()
            .into_iter()
            .rev()
            .find_map(|m| match m {
                ServerMessage::State { event, .. } => event,
                _ => None,
            })
            .unwrap();
        assert!(event.entered);
        assert_eq!(event.entrants.len(), 1);

        set_clock(100.0);
        tick_n(&mut game, 5);
        assert!(sink.take().iter().any(|m| matches!(
            m,
            ServerMessage::Event { event: GameEvent::EventStarted { event_id, event_kind } }
                if event_id == "ride" && event_kind == "group_ride"
        )));
    }

    fn race_game() -> GameCore {
        use openradlr_sim::events::{EventDef, EventKind, EventLength, Events};
        use openradlr_sim::schedule::Schedule;
        let def = EventDef {
            id: "race".into(),
            name: "Test race".into(),
            kind: EventKind::Race,
            route: 0,
            length: EventLength::Laps(1),
            schedule: Schedule::Once {
                starts_at_s: 100.0,
                lobby_s: 50.0,
                duration_s: 300.0,
            },
        };
        game(0, 10).with_events(Events::new(vec![def]), fake_clock)
    }

    /// Runs the game with the fake clock from 60 s to `until_s`, riders pedalling at
    /// `powers`; returns every `event_finished` each rider's sink received.
    fn run_events(
        game: &mut GameCore,
        until_s: f64,
        powers: &[(RiderId, f64)],
        sinks: &[&RecordingSink],
    ) -> Vec<Vec<(String, Vec<crate::protocol::EventResultState>)>> {
        let dt = game.settings().tick_seconds();
        let mut finished = vec![Vec::new(); sinks.len()];
        let mut now = 60.0;
        while now < until_s {
            set_clock(now);
            for &(id, power) in powers {
                game.telemetry(id, power, Some(90.0));
            }
            game.tick();
            now += dt;
            for (sink, out) in sinks.iter().zip(&mut finished) {
                for m in sink.take() {
                    if let ServerMessage::Event {
                        event:
                            GameEvent::EventFinished {
                                event_kind, results, ..
                            },
                    } = m
                    {
                        out.push((event_kind, results));
                    }
                }
            }
        }
        finished
    }

    #[test]
    fn a_race_past_its_end_sends_results_with_places_only_for_finishers() {
        let mut game = race_game();
        let (strong, strong_sink) = join(&mut game, "Strong");
        let (stuck, stuck_sink) = join(&mut game, "Stuck");
        set_clock(60.0);
        tick_n(&mut game, 5);
        game.join_event(strong, "race");
        game.join_event(stuck, "race");
        let finished = run_events(
            &mut game,
            1400.0,
            &[(strong, 600.0), (stuck, 0.0)],
            &[&strong_sink, &stuck_sink],
        );
        assert_eq!(finished[0].len(), 1, "one event_finished to the strong rider");
        assert_eq!(finished[1].len(), 1, "and to the stuck one");
        let (kind, results) = &finished[0][0];
        assert_eq!(kind, "race");
        let mine = results.iter().find(|r| r.rider_id == strong).unwrap();
        let theirs = results.iter().find(|r| r.rider_id == stuck).unwrap();
        assert!(mine.place.is_some() && mine.time_s.is_some());
        assert!(theirs.place.is_none() && theirs.time_s.is_none());
        assert!(results.iter().any(|r| r.is_bot));
    }

    #[test]
    fn a_bots_only_event_finishes_quietly() {
        let mut game = race_game();
        let (_, onlooker) = join(&mut game, "Onlooker");
        set_clock(60.0);
        tick_n(&mut game, 5);
        let finished = run_events(&mut game, 1400.0, &[], &[&onlooker]);
        assert!(finished[0].is_empty(), "{:?}", finished[0]);
    }

    #[test]
    fn joining_an_unknown_event_is_an_error() {
        let mut game = event_game();
        let (id, sink) = join(&mut game, "Anna");
        sink.take();
        game.join_event(id, "nope");
        assert!(sink.take().iter().any(|m| matches!(
            m,
            ServerMessage::Error { code, .. } if code == "unknown_event"
        )));
    }

    fn latest_state(messages: &[ServerMessage]) -> &ServerMessage {
        messages
            .iter()
            .rev()
            .find(|m| matches!(m, ServerMessage::State { .. }))
            .expect("a state message")
    }

    fn vehicle_of_state(message: &ServerMessage) -> Option<&crate::protocol::VehicleState> {
        match message {
            ServerMessage::State { vehicle, .. } => vehicle.as_ref(),
            other => panic!("expected state, got {other:?}"),
        }
    }

    fn error_of(messages: &[ServerMessage]) -> Option<(&str, &str)> {
        messages.iter().find_map(|m| match m {
            ServerMessage::Error { code, message } => Some((code.as_str(), message.as_str())),
            _ => None,
        })
    }

    fn vehicle_game() -> (GameCore, VehicleCodes) {
        let codes = VehicleCodes::new();
        (game(0, 10).with_vehicle_codes(codes.clone(), "test".into()), codes)
    }

    #[test]
    fn creating_a_vehicle_sends_its_state() {
        let (mut game, codes) = vehicle_game();
        let (anna, sink) = join(&mut game, "Anna");
        sink.take();
        game.create_vehicle(anna, "beer_bike", 7, true);
        let messages = sink.take();
        let vehicle = vehicle_of_state(latest_state(&messages)).expect("a vehicle");
        assert_eq!(vehicle.code.len(), 6);
        assert_eq!(vehicle.kind, "beer_bike");
        assert_eq!(vehicle.captain, anna);
        assert_eq!(vehicle.seats.len(), 7);
        assert!(vehicle.seats.iter().all(Option::is_some));
        assert_eq!(codes.world_of(&vehicle.code).as_deref(), Some("test"));
    }

    #[test]
    fn boarding_by_code() {
        let (mut game, _) = vehicle_game();
        let (anna, anna_sink) = join(&mut game, "Anna");
        let (ben, ben_sink) = join(&mut game, "Ben");
        game.create_vehicle(anna, "tandem", 0, false);
        let code = vehicle_of_state(latest_state(&anna_sink.take())).unwrap().code.clone();
        ben_sink.take();
        game.board_vehicle(ben, &code);
        for sink in [&anna_sink, &ben_sink] {
            for _ in 0..game.settings().broadcast_every() {
                game.tick();
            }
            let messages = sink.take();
            let vehicle = vehicle_of_state(latest_state(&messages)).expect("a vehicle");
            let humans = vehicle.seats.iter().flatten().filter(|s| !s.is_bot).count();
            assert_eq!(humans, 2);
        }
    }

    #[test]
    fn unknown_codes_are_refused() {
        let (mut game, _) = vehicle_game();
        let (anna, sink) = join(&mut game, "Anna");
        sink.take();
        game.board_vehicle(anna, "ZZZZZZ");
        assert_eq!(error_of(&sink.take()).map(|e| e.0), Some("unknown_vehicle"));
    }

    #[test]
    fn codes_of_other_worlds_point_there() {
        let (mut game, codes) = vehicle_game();
        codes.insert("FAR234", "other-route");
        let (anna, sink) = join(&mut game, "Anna");
        sink.take();
        game.board_vehicle(anna, "FAR234");
        assert_eq!(error_of(&sink.take()), Some(("vehicle_elsewhere", "route:other-route")));
    }

    #[test]
    fn invalid_kinds_are_refused() {
        let (mut game, _) = vehicle_game();
        let (anna, sink) = join(&mut game, "Anna");
        sink.take();
        game.create_vehicle(anna, "beer_bike", 6, true);
        assert_eq!(error_of(&sink.take()).map(|e| e.0), Some("invalid_vehicle"));
        game.create_vehicle(anna, "unicycle", 1, true);
        assert_eq!(error_of(&sink.take()).map(|e| e.0), Some("invalid_vehicle"));
    }

    #[test]
    fn racers_get_in_event() {
        let (mut game, _) = vehicle_game();
        let (anna, sink) = join(&mut game, "Anna");
        game.start_race(anna, 1);
        sink.take();
        game.create_vehicle(anna, "tandem", 0, true);
        assert_eq!(error_of(&sink.take()).map(|e| e.0), Some("in_event"));
    }

    #[test]
    fn working_without_a_shared_registry() {
        let mut game = game(0, 10);
        let (anna, sink) = join(&mut game, "Anna");
        sink.take();
        game.create_vehicle(anna, "tandem", 0, true);
        assert!(vehicle_of_state(latest_state(&sink.take())).is_some());
    }

    #[test]
    fn non_captain_lane_input_is_ignored() {
        let (mut game, _) = vehicle_game();
        let (anna, anna_sink) = join(&mut game, "Anna");
        let (ben, ben_sink) = join(&mut game, "Ben");
        game.create_vehicle(anna, "tandem", 0, false);
        let code = vehicle_of_state(latest_state(&anna_sink.take())).unwrap().code.clone();
        game.board_vehicle(ben, &code);
        ben_sink.take();
        let lane = game.world().rider(ben).unwrap().target_lane;
        game.input(ben, InputAction::LaneLeft);
        game.input(ben, InputAction::LaneRight);
        game.turn(ben, Some("anywhere"));
        assert_eq!(game.world().rider(ben).unwrap().target_lane, lane);
        assert!(error_of(&ben_sink.take()).is_none());
    }

    #[test]
    fn seated_riders_carry_their_seat_and_cadence() {
        let (mut game, _) = vehicle_game();
        let (anna, sink) = join(&mut game, "Anna");
        game.create_vehicle(anna, "tandem", 0, true);
        game.telemetry(anna, 200.0, Some(92.0));
        sink.take();
        for _ in 0..game.settings().broadcast_every() {
            game.tick();
        }
        let messages = sink.take();
        let ServerMessage::State { riders, .. } = latest_state(&messages) else {
            unreachable!()
        };
        let me = riders.iter().find(|r| r.id == anna).unwrap();
        assert_eq!(
            me.vehicle.as_ref().map(|v| (v.seat, v.seats, v.kind)),
            Some((0, 2, "tandem"))
        );
        assert_eq!(me.cadence, Some(92.0));
    }

    #[test]
    fn boarding_events_reach_the_route() {
        let (mut game, _) = vehicle_game();
        let (anna, anna_sink) = join(&mut game, "Anna");
        let (ben, ben_sink) = join(&mut game, "Ben");
        game.create_vehicle(anna, "tandem", 0, false);
        let code = vehicle_of_state(latest_state(&anna_sink.take())).unwrap().code.clone();
        game.board_vehicle(ben, &code);
        game.tick();
        let boarded = |messages: Vec<ServerMessage>| {
            messages.into_iter().any(|m| {
                matches!(m, ServerMessage::Event { event: GameEvent::VehicleBoarded { rider_id, name, .. } } if rider_id == ben && name == "Ben")
            })
        };
        assert!(boarded(anna_sink.take()));
        assert!(boarded(ben_sink.take()));
    }

    #[test]
    fn a_dissolved_vehicle_frees_its_code() {
        let (mut game, codes) = vehicle_game();
        let (anna, sink) = join(&mut game, "Anna");
        game.create_vehicle(anna, "tandem", 0, true);
        let code = vehicle_of_state(latest_state(&sink.take())).unwrap().code.clone();
        assert!(codes.is_taken(&code));
        game.leave_vehicle(anna);
        game.tick();
        assert_eq!(codes.world_of(&code), None);
        assert!(game.world().vehicle_by_code(&code).is_none());
    }

    #[test]
    fn boarding_while_seated_says_already_aboard() {
        let (mut game, _) = vehicle_game();
        let (anna, sink) = join(&mut game, "Anna");
        game.create_vehicle(anna, "tandem", 0, true);
        let code = vehicle_of_state(latest_state(&sink.take())).unwrap().code.clone();
        game.board_vehicle(anna, &code);
        assert_eq!(error_of(&sink.take()).map(|e| e.0), Some("already_aboard"));
    }

    #[test]
    fn a_disconnecting_rider_is_named_in_vehicle_left() {
        let (mut game, codes) = vehicle_game();
        let (anna, anna_sink) = join(&mut game, "Anna");
        let (ben, ben_sink) = join(&mut game, "Ben");
        game.create_vehicle(anna, "tandem", 0, false);
        let code = vehicle_of_state(latest_state(&anna_sink.take())).unwrap().code.clone();
        game.board_vehicle(ben, &code);
        game.tick();
        anna_sink.take();
        ben_sink.take();
        game.leave(anna);
        game.tick();
        let left = ben_sink.take().into_iter().any(|m| {
            matches!(m, ServerMessage::Event { event: GameEvent::VehicleLeft { rider_id, name, .. } } if rider_id == anna && name == "Anna")
        });
        assert!(left);
        // Ben stays aboard, so the code lives until he leaves too.
        assert!(codes.is_taken(&code));
        game.leave(ben);
        game.tick();
        assert_eq!(codes.world_of(&code), None);
    }

    fn seat_captains(message: &ServerMessage) -> Vec<(RiderId, bool)> {
        match message {
            ServerMessage::State { riders, .. } => riders
                .iter()
                .filter_map(|r| r.vehicle.as_ref().map(|v| (r.id, v.captain)))
                .collect(),
            other => panic!("expected state, got {other:?}"),
        }
    }

    #[test]
    fn the_captain_flag_follows_a_hand_over() {
        let (mut game, _) = vehicle_game();
        let (anna, anna_sink) = join(&mut game, "Anna");
        let (ben, ben_sink) = join(&mut game, "Ben");
        game.create_vehicle(anna, "tandem", 0, false);
        let code = vehicle_of_state(latest_state(&anna_sink.take())).unwrap().code.clone();
        game.board_vehicle(ben, &code);
        game.tick();
        let seated = seat_captains(latest_state(&ben_sink.take()));
        assert_eq!(seated.len(), 2);
        assert!(seated.contains(&(anna, true)) && seated.contains(&(ben, false)));
        game.leave_vehicle(anna);
        let mut messages = Vec::new();
        for _ in 0..10 {
            game.tick();
            messages.extend(ben_sink.take());
        }
        let seated = seat_captains(latest_state(&messages));
        assert_eq!(seated, vec![(ben, true)]);
    }

    fn join_with_code(game: &mut GameCore, name: &str, code: &str) -> (Result<RiderId, JoinError>, RecordingSink) {
        let sink = RecordingSink::default();
        let result = game.join(name, 70.0, None, None, None, Some(code), Box::new(sink.clone()));
        (result, sink)
    }

    fn vehicle_with_captain(game: &mut GameCore) -> (RiderId, String) {
        let (anna, sink) = join(game, "Anna");
        game.create_vehicle(anna, "tandem", 0, false);
        let code = vehicle_of_state(latest_state(&sink.take())).unwrap().code.clone();
        (anna, code)
    }

    #[test]
    fn joining_with_a_code_boards() {
        let (mut game, _) = vehicle_game();
        let (anna, code) = vehicle_with_captain(&mut game);
        // Codes are typed by hand: case and spaces don't matter.
        let (ben, sink) = join_with_code(&mut game, "Ben", &format!(" {} ", code.to_lowercase()));
        let ben = ben.unwrap();
        let messages = sink.take();
        assert!(matches!(
            &messages[0],
            ServerMessage::Joined { rider_id, resume_token } if *rider_id == ben && resume_token.len() == 64
        ));
        let vehicle = vehicle_of_state(&messages[1]).expect("a vehicle in the first state");
        assert_eq!(vehicle.code, code);
        assert_eq!(vehicle.captain, anna);
        let (a, b) = (game.world().rider(anna).unwrap(), game.world().rider(ben).unwrap());
        assert_eq!((b.route, b.position, b.lane), (a.route, a.position, a.lane));
    }

    #[test]
    fn joining_with_a_stale_code_leaves_nothing_behind() {
        let (mut game, codes) = vehicle_game();
        let (anna, code) = vehicle_with_captain(&mut game);
        game.leave_vehicle(anna);
        game.tick();
        assert_eq!(codes.world_of(&code), None);
        let players = game.player_count();
        let (result, sink) = join_with_code(&mut game, "Ben", &code);
        assert_eq!(result, Err(JoinError::UnknownVehicle));
        assert_eq!(JoinError::UnknownVehicle.code(), "unknown_vehicle");
        assert_eq!(game.player_count(), players);
        assert!(game.world().riders().all(|r| r.name != "Ben"));
        assert!(sink.take().is_empty());
    }

    #[test]
    fn joining_a_full_vehicle_fails() {
        let (mut game, _) = vehicle_game();
        let (_, code) = vehicle_with_captain(&mut game);
        join_with_code(&mut game, "Ben", &code).0.unwrap();
        let players = game.player_count();
        let (result, sink) = join_with_code(&mut game, "Cara", &code);
        assert_eq!(result, Err(JoinError::VehicleFull));
        assert_eq!(JoinError::VehicleFull.code(), "vehicle_full");
        assert_eq!(game.player_count(), players);
        assert!(game.world().riders().all(|r| r.name != "Cara"));
        assert!(sink.take().is_empty());
    }

    // ----------------------------------------------------- reconnecting (#73) ---

    fn game_with_grace(grace_s: f64) -> GameCore {
        let mut game = game(0, 10);
        game.settings.grace_s = grace_s;
        game.attachments = Attachments::new(grace_s, ResumeTokens::new(), "test".into());
        game
    }

    fn token_of(messages: &[ServerMessage]) -> String {
        messages
            .iter()
            .find_map(|m| match m {
                ServerMessage::Joined { resume_token, .. } => Some(resume_token.clone()),
                _ => None,
            })
            .expect("a joined message")
    }

    fn ticks(game: &mut GameCore, seconds: f64) {
        for _ in 0..(seconds * f64::from(game.settings.tick_hz)).round() as usize {
            game.tick();
        }
    }

    #[test]
    fn detached_riders_coast_and_keep_their_place() {
        let mut game = game_with_grace(60.0);
        let (anna, _sink) = join(&mut game, "Anna");
        game.telemetry(anna, 250.0, Some(90.0));
        ticks(&mut game, 10.0);
        let speed = game.world().rider(anna).unwrap().speed;
        game.detach(anna);
        ticks(&mut game, 10.0);
        let rider = game.world().rider(anna).expect("still in the world");
        assert!(rider.speed < speed, "coasting: {} < {speed}", rider.speed);
        assert_eq!(game.player_count(), 1);
    }

    #[test]
    fn reattach_returns_the_same_rider_and_a_fresh_state() {
        let mut game = game_with_grace(60.0);
        let (anna, sink) = join(&mut game, "Anna");
        let token = token_of(&sink.take());
        assert_eq!(token.len(), 64);
        game.detach(anna);
        ticks(&mut game, 1.0);
        let fresh = RecordingSink::default();
        let joined = game.reattach(&token, Box::new(fresh.clone())).expect("reattached");
        assert_eq!(joined.rider_id, anna);
        let messages = fresh.take();
        assert_eq!(
            messages[0],
            ServerMessage::Joined {
                rider_id: anna,
                resume_token: token
            }
        );
        assert!(matches!(messages[1], ServerMessage::State { .. }));
    }

    #[test]
    fn grace_expiry_runs_leave() {
        let mut game = game_with_grace(1.0);
        let (anna, sink) = join(&mut game, "Anna");
        let token = token_of(&sink.take());
        game.detach(anna);
        ticks(&mut game, 1.5);
        assert!(game.world().rider(anna).is_none());
        assert_eq!(game.player_count(), 0);
        assert_eq!(game.reattach(&token, Box::new(RecordingSink::default())), None);
    }

    #[test]
    fn detached_rider_keeps_their_seat() {
        let mut game = game_with_grace(60.0).with_vehicle_codes(VehicleCodes::new(), "test".into());
        let (anna, anna_sink) = join(&mut game, "Anna");
        let (ben, ben_sink) = join(&mut game, "Ben");
        let token = token_of(&ben_sink.take());
        game.create_vehicle(anna, "tandem", 0, false);
        let code = vehicle_of_state(latest_state(&anna_sink.take())).unwrap().code.clone();
        game.board_vehicle(ben, &code);
        let vehicle = game.world().vehicle_of(ben).expect("aboard").id;
        game.detach(ben);
        ticks(&mut game, 5.0);
        assert_eq!(game.world().vehicle_of(ben).map(|v| v.id), Some(vehicle));
        game.reattach(&token, Box::new(RecordingSink::default()))
            .expect("reattached");
        assert_eq!(game.world().vehicle_of(ben).map(|v| v.id), Some(vehicle));
    }

    #[test]
    fn failed_delivery_detaches_instead_of_leaving() {
        let mut game = game_with_grace(1.0);
        let (anna, sink) = join(&mut game, "Anna");
        sink.close();
        ticks(&mut game, 0.5);
        assert!(game.world().rider(anna).is_some(), "kept for the grace period");
        ticks(&mut game, 1.0);
        assert!(game.world().rider(anna).is_none());
    }

    #[test]
    fn stale_epoch_detach_and_leave_are_ignored() {
        use crate::runtime::{apply, Command};
        let mut game = game_with_grace(60.0);
        let sink = RecordingSink::default();
        let first = game
            .join_at("Anna", 70.0, None, None, None, None, None, Box::new(sink.clone()))
            .unwrap();
        let token = token_of(&sink.take());
        let second = game.reattach(&token, Box::new(RecordingSink::default())).unwrap();
        let anna = first.rider_id;
        // The first connection finally notices its socket is gone.
        apply(
            &mut game,
            Command::Detach {
                rider_id: anna,
                epoch: first.epoch,
            },
        );
        apply(
            &mut game,
            Command::Leave {
                rider_id: anna,
                epoch: first.epoch,
            },
        );
        assert!(game.world().rider(anna).is_some());
        assert!(!game.attachments.is_detached(anna));
        apply(
            &mut game,
            Command::Leave {
                rider_id: anna,
                epoch: second.epoch,
            },
        );
        assert!(game.world().rider(anna).is_none());
    }

    #[test]
    fn grace_zero_leaves_at_once() {
        let mut game = game_with_grace(0.0);
        let (anna, _sink) = join(&mut game, "Anna");
        game.detach(anna);
        assert!(game.world().rider(anna).is_none());
    }

    #[test]
    fn join_at_places_the_rider() {
        let mut game = game(0, 10);
        let length = game.world().routes()[0].length();
        let place = |game: &mut GameCore, start_m: f64| {
            let joined = game
                .join_at(
                    "Anna",
                    70.0,
                    None,
                    None,
                    None,
                    None,
                    Some(start_m),
                    Box::new(RecordingSink::default()),
                )
                .unwrap();
            game.world().rider(joined.rider_id).unwrap().position
        };
        assert!((place(&mut game, 300.0) - 300.0).abs() < 1e-9);
        assert!(
            place(&mut game, length + 50.0).abs() < 1e-9,
            "clamped to the end, which is the start"
        );
        assert!(place(&mut game, -5.0).abs() < 1e-9);
        assert!(place(&mut game, f64::NAN).abs() < 1e-9);
    }

    #[test]
    fn join_at_ignores_the_position_with_a_vehicle_code() {
        let (mut game, _) = vehicle_game();
        let (anna, sink) = join(&mut game, "Anna");
        game.create_vehicle(anna, "tandem", 0, false);
        let code = vehicle_of_state(latest_state(&sink.take())).unwrap().code.clone();
        let anna_at = game.world().rider(anna).unwrap().position;
        let ben = game
            .join_at(
                "Ben",
                70.0,
                None,
                None,
                None,
                Some(&code),
                Some(300.0),
                Box::new(RecordingSink::default()),
            )
            .unwrap();
        assert!((game.world().rider(ben.rider_id).unwrap().position - anna_at).abs() < 1.0);
    }

    // ------------------------------------------------------- workouts (#77) ---

    fn join_workout(game: &mut GameCore, name: &str) -> (RiderId, RecordingSink) {
        let (id, sink) = join(game, name);
        game.set_device(id, DeviceKind::Workout);
        (id, sink)
    }

    fn error_codes(messages: &[ServerMessage]) -> Vec<String> {
        messages
            .iter()
            .filter_map(|m| match m {
                ServerMessage::Error { code, .. } => Some(code.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_workout_rider_spawns_parked() {
        let mut game = game(0, 10);
        let (anna, _) = join_workout(&mut game, "Anna");
        ticks_of(&mut game, 5);
        let rider = game.world().rider(anna).unwrap();
        assert!(rider.workout);
        assert!(rider.parked);
        assert_eq!(game.device_of(anna), DeviceKind::Workout);
    }

    /// Ticks until a state has been sent.
    fn broadcast(game: &mut GameCore) {
        let n = game.settings().broadcast_every();
        ticks_of(game, n as usize);
    }

    fn ticks_of(game: &mut GameCore, n: usize) {
        for _ in 0..n {
            game.tick();
        }
    }

    #[test]
    fn riding_messages_get_in_workout() {
        let mut game = game(0, 10);
        let (anna, sink) = join_workout(&mut game, "Anna");
        sink.take();
        game.input(anna, InputAction::LaneLeft);
        game.start_race(anna, 1);
        game.join_race(anna);
        game.join_event(anna, "any");
        game.turn(anna, None);
        game.create_vehicle(anna, "tandem", 2, true);
        game.board_vehicle(anna, "ABC");
        game.pause(anna, false);
        game.pause(anna, true);
        let codes = error_codes(&sink.take());
        assert_eq!(codes, vec!["in_workout"; 9]);
        let rider = game.world().rider(anna).unwrap();
        assert!(rider.parked && rider.workout);
        assert!(game.world().vehicle_of(anna).is_none());
    }

    #[test]
    fn telemetry_from_a_workout_rider_is_ignored_silently() {
        let mut game = game(0, 10);
        let (anna, sink) = join_workout(&mut game, "Anna");
        sink.take();
        game.telemetry(anna, 300.0, Some(90.0));
        ticks_of(&mut game, 5);
        assert_eq!(error_codes(&sink.take()), Vec::<String>::new());
        assert_eq!(game.world().rider(anna).unwrap().power, 0.0);
    }

    #[test]
    fn workout_from_a_rider_gets_not_in_workout() {
        let mut game = game(0, 10);
        let (anna, sink) = join(&mut game, "Anna");
        sink.take();
        game.workout(anna, Some(Exercise::Squats));
        assert_eq!(error_codes(&sink.take()), vec!["not_in_workout"]);
    }

    fn exercise_json(sink: &RecordingSink) -> String {
        sink.take()
            .iter()
            .rev()
            .find(|m| matches!(m, ServerMessage::State { .. }))
            .expect("a state message")
            .to_json()
    }

    #[test]
    fn the_exercise_shows_in_riders() {
        let mut game = game(0, 10);
        let (anna, _) = join_workout(&mut game, "Anna");
        let (_, ben_sink) = join(&mut game, "Ben");
        game.workout(anna, Some(Exercise::Burpees));
        broadcast(&mut game);
        assert!(exercise_json(&ben_sink).contains(r#""exercise":"burpees""#));
        game.workout(anna, None);
        broadcast(&mut game);
        assert!(!exercise_json(&ben_sink).contains(r#""exercise""#));
    }

    #[test]
    fn a_workout_rider_is_not_in_route_riders_humans() {
        let mut game = game(0, 10);
        let (_, sink) = join_workout(&mut game, "Anna");
        let (_, _) = join(&mut game, "Ben");
        broadcast(&mut game);
        let messages = sink.take();
        let Some(ServerMessage::State { route_riders, .. }) =
            messages.iter().rev().find(|m| matches!(m, ServerMessage::State { .. }))
        else {
            panic!("expected a state message");
        };
        assert_eq!(route_riders.humans, 1);
    }

    #[test]
    fn a_reattached_workout_rider_keeps_its_flag_and_exercise() {
        let mut game = game_with_grace(60.0);
        let (anna, sink) = join_workout(&mut game, "Anna");
        let token = token_of(&sink.take());
        game.workout(anna, Some(Exercise::Plank));
        game.detach(anna);
        ticks_of(&mut game, 5);
        let fresh = RecordingSink::default();
        game.reattach(&token, Box::new(fresh.clone())).expect("reattached");
        let rider = game.world().rider(anna).unwrap();
        assert!(rider.workout && rider.parked);
        assert_eq!(game.device_of(anna), DeviceKind::Workout);
        assert!(exercise_json(&fresh).contains(r#""exercise":"plank""#));
    }
}
