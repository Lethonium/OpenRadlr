//! Wire protocol between clients and the server (JSON over WebSocket).
//!
//! Every message is a JSON object with a `type` field. See `docs/protocol.md`
//! for the full description. Bump [`PROTOCOL_VERSION`] on breaking changes.

use openradlr_sim::events::{EventInfo, EventKind, EventLength, EventNotice, EventResult, EventView};
use openradlr_sim::race::{RaceEvent, RacePhase, RaceResult};
use openradlr_sim::schedule::Phase;
use openradlr_sim::sharing::Flow;
use openradlr_sim::studio::{Studio, StudioEvent};
use openradlr_sim::vehicle::Vehicle;
use openradlr_sim::vehicle::{shares, VehicleId};
use openradlr_sim::world::Rider;
use openradlr_sim::world::VehicleChange;
use openradlr_sim::{RiderId, RouteIndex, World, WorldEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 2: one world per map (#14): riders carry their route and road, state is
/// culled to the riders around you.
pub const PROTOCOL_VERSION: u32 = 2;

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

/// Where the ride left off: the road to sit back on and how far along it.
/// Applied only to a plain join; a vehicle code ignores it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ResumePoint {
    pub route_id: String,
    pub distance_m: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Hello {
        protocol_version: u32,
        #[serde(default)]
        client_version: String,
    },
    Join {
        name: String,
        weight_kg: f64,
        /// Reserved for signed profiles; ignored while the server runs in open mode.
        #[serde(default)]
        public_key: Option<String>,
        /// Which world to join (see `/api/info`); the default route if omitted.
        #[serde(default)]
        route_id: Option<String>,
        /// The rider's FTP in watts; the spin studio sets targets from it.
        #[serde(default)]
        ftp_w: Option<f64>,
        /// The rider's riding level in watts; bots are matched to it.
        #[serde(default)]
        level_w: Option<f64>,
        /// What the power comes from; older clients send nothing (a trainer).
        #[serde(default)]
        device: DeviceKind,
        /// Board this vehicle on joining (the server picks the world from it).
        #[serde(default)]
        vehicle_code: Option<String>,
        /// A token an earlier `joined` gave out; reattach that rider if the
        /// server still holds it.
        #[serde(default)]
        resume_token: Option<String>,
        /// Where the ride left off; the server places the rider there.
        #[serde(default)]
        resume: Option<ResumePoint>,
    },
    Telemetry {
        power: f64,
        #[serde(default)]
        cadence: Option<f64>,
    },
    Input {
        action: InputAction,
    },
    StartRace {
        laps: u32,
    },
    /// Enter the race whose countdown is running.
    JoinRace,
    /// Withdraw from the announced or running race.
    LeaveRace,
    /// Enter the scheduled event whose lobby is open.
    JoinEvent {
        event_id: String,
    },
    /// Withdraw from the scheduled event.
    LeaveEvent,
    /// The road to take at the next junction (#15); `null` or no `edge`:
    /// the default (stay on the route, straight on off it).
    Turn {
        #[serde(default)]
        edge: Option<String>,
    },
    Chat {
        text: String,
    },
    /// Start a shared vehicle with the sender as captain. A tandem ignores
    /// `seats`; a beer bike takes 5, 7 or 9.
    CreateVehicle {
        kind: String,
        #[serde(default)]
        seats: u8,
        /// Seat bots fill the empty seats.
        #[serde(default = "default_true")]
        bots: bool,
    },
    BoardVehicle {
        code: String,
    },
    LeaveVehicle,
    /// Pause (#89): the rider brakes to a stop and pulls over. Refused with
    /// `pause_rejected` in a race, an event or a vehicle.
    Pause,
    /// Ride on after a pause.
    Resume,
    /// The exercise a `workout` rider does now (#77); `null` or none is rest.
    /// The session checks the id.
    Workout {
        #[serde(default)]
        exercise: Option<String>,
    },
    /// Leave the game now; the server removes the rider and closes the
    /// connection.
    Leave,
}

fn default_true() -> bool {
    true
}

/// What a rider's power comes from, as the client declares it. Shown to
/// others (phone paddlers get a badge); the server can't check it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceKind {
    #[default]
    Trainer,
    /// The simulated trainer: power from the keyboard.
    Sim,
    /// Phone paddles: power from tapping left and right.
    Paddle,
    /// No bike: a bodyweight workout at the start café (#77).
    Workout,
}

impl DeviceKind {
    pub fn is_trainer(&self) -> bool {
        *self == DeviceKind::Trainer
    }
}

/// What a workout rider is doing, shown to others so their avatar can do it (#77).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Exercise {
    Squats,
    Situps,
    Pushups,
    JumpingJacks,
    Plank,
    Burpees,
}

impl Exercise {
    /// The exercise with this wire id.
    pub fn from_id(id: &str) -> Option<Exercise> {
        serde_json::from_value(serde_json::Value::String(id.to_owned())).ok()
    }
}

/// What others are told about a rider besides the sim's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RiderTags {
    pub device: DeviceKind,
    pub exercise: Option<Exercise>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputAction {
    LaneLeft,
    LaneRight,
}

impl ClientMessage {
    pub fn parse(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Welcome {
        protocol_version: u32,
        server_name: String,
        server_version: String,
        auth_mode: String,
        route_id: String,
        /// Seconds a rider lingers after their socket dies before being
        /// removed; `0` removes at once.
        grace_s: f64,
    },
    Joined {
        rider_id: RiderId,
        /// Send it in a later `join` to come back as the same rider (#73).
        resume_token: String,
    },
    /// The riders around you (and everyone in your route's race), and your
    /// route's race.
    State {
        tick: u64,
        riders: Vec<RiderState>,
        race: RaceState,
        /// Everybody on your route, also those too far away to be in `riders`.
        route_riders: RouteRiders,
        /// The scheduled event of your route, while its lobby is open or it runs.
        #[serde(skip_serializing_if = "Option::is_none")]
        event: Option<Box<EventState>>,
        /// The viewer's own vehicle, while they sit in one.
        #[serde(skip_serializing_if = "Option::is_none")]
        vehicle: Option<VehicleState>,
    },
    /// The spin studio's counterpart of `State`, for the rider's room only.
    StudioState {
        tick: u64,
        /// The rider's room (0-based) and how many rooms ride this class.
        room: usize,
        rooms: usize,
        class: ClassState,
        riders: Vec<SeatState>,
    },
    Resistance {
        grade_percent: f64,
    },
    Event {
        event: GameEvent,
    },
    Chat {
        rider_id: RiderId,
        name: String,
        text: String,
    },
    Error {
        code: String,
        message: String,
    },
}

impl ServerMessage {
    pub fn error(code: &str, message: impl Into<String>) -> Self {
        ServerMessage::Error {
            code: code.to_owned(),
            message: message.into(),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("server messages always serialise")
    }
}

/// The viewer's vehicle with every seat (`None`: empty seat).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VehicleState {
    pub id: VehicleId,
    pub code: String,
    pub kind: &'static str,
    pub captain: RiderId,
    pub bots: bool,
    pub seats: Vec<Option<VehicleSeatState>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VehicleSeatState {
    pub rider_id: RiderId,
    pub name: String,
    pub is_bot: bool,
    pub power: f64,
    /// Share of the vehicle's total power, rounded to 0.01.
    pub share: f64,
}

/// Where a rider sits, on the rider's own state.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SeatRef {
    pub id: VehicleId,
    pub kind: &'static str,
    pub seat: usize,
    pub seats: usize,
    /// True for the vehicle's current captain, who is not always seat 0.
    pub captain: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct RouteRiders {
    pub humans: usize,
    pub bots: usize,
}

/// The scheduled event of the viewer's route (lobby or running).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EventState {
    pub id: String,
    pub name: String,
    /// `race` or `group_ride`.
    pub kind: String,
    /// `lobby` or `running`.
    pub phase: String,
    /// Seconds until the start; negative once running.
    pub starts_in_s: f64,
    pub laps: Option<u32>,
    pub distance_m: Option<f64>,
    pub entrants: Vec<EntrantState>,
    /// Whether the viewer is entered.
    pub entered: bool,
    pub sharing: Option<SharingState>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EntrantState {
    pub rider_id: RiderId,
    pub name: String,
}

/// Power given and received in a group ride (watts, whole numbers).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SharingState {
    pub gap_s: f64,
    pub given_w: f64,
    pub to: Vec<String>,
    pub received_w: f64,
    pub from: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EventResultState {
    pub rider_id: RiderId,
    pub name: String,
    pub is_bot: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_s: Option<f64>,
    pub distance_m: f64,
    pub avg_wkg: f64,
    pub given_kj: f64,
    pub received_kj: f64,
}

/// A scheduled event in `/api/info`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EventInfoWire {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub route_id: String,
    pub lobby_opens_at_s: f64,
    pub starts_at_s: f64,
    /// `upcoming`, `lobby` or `running`.
    pub phase: String,
    pub entrants: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RiderState {
    pub id: RiderId,
    pub name: String,
    pub is_bot: bool,
    /// The id of the route the rider rides; `None` off every route (#15).
    pub route: Option<String>,
    /// Position on the lap of the rider's route in metres (off-route: metres
    /// since leaving it).
    pub distance: f64,
    /// The road under the rider, where the route lies on a road network.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub road: Option<RoadState>,
    /// Current lap in a race (1-based), `None` outside a race.
    pub lap: Option<u32>,
    /// Continuous lane position, 0 = leftmost lane.
    pub lane: f64,
    /// Speed in m/s.
    pub speed: f64,
    pub power: f64,
    /// Left out for trainers (and bots).
    #[serde(skip_serializing_if = "DeviceKind::is_trainer")]
    pub device: DeviceKind,
    /// The vehicle the rider sits in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle: Option<SeatRef>,
    /// Pedalling rate of a seated rider, so each seat turns at its own pace.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cadence: Option<f64>,
    /// Pulled over for a pause (#89); left out otherwise.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub parked: bool,
    /// The exercise a workout rider does now (#77); left out at rest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exercise: Option<Exercise>,
}

/// A position on the road network (ADR 0010): the road, the riding
/// direction (1 along its points, -1 back) and metres along it from where
/// the rider entered it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RoadState {
    pub edge: String,
    pub dir: i8,
    pub offset: f64,
    /// The road the rider takes at the next junction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next: Option<NextRoad>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NextRoad {
    pub edge: String,
    pub dir: i8,
}

/// The class of the current slot (see `/api/studio` for its segments).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ClassState {
    pub id: String,
    pub name: String,
    /// Unix time in seconds when the class starts.
    pub starts_at_s: f64,
    /// Seconds since the class started; negative during the lobby.
    pub elapsed_s: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SeatState {
    pub id: RiderId,
    pub name: String,
    pub is_bot: bool,
    /// 0–7 front row, 8–15 back row.
    pub seat: usize,
    pub power: f64,
    pub cadence: Option<f64>,
    /// Flat-road speed in m/s and distance in metres, for the ride record.
    pub speed: f64,
    pub distance: f64,
    /// Share of the class ridden within 10 % of the target, in percent.
    pub on_target_pct: Option<f64>,
    /// Work during the class in kJ.
    pub class_kj: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum RaceState {
    Idle,
    Countdown {
        laps: u32,
        remaining_s: f64,
        /// Riders entered so far (more may join until the start).
        entrants: Vec<RiderId>,
    },
    Running {
        laps: u32,
        elapsed_s: f64,
        results: Vec<RaceResultState>,
    },
    Finished {
        laps: u32,
        results: Vec<RaceResultState>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RaceResultState {
    pub rider_id: RiderId,
    pub name: String,
    pub is_bot: bool,
    pub time_s: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GameEvent {
    RiderJoined {
        rider_id: RiderId,
        name: String,
        is_bot: bool,
    },
    RiderLeft {
        rider_id: RiderId,
        name: String,
    },
    RaceCountdown {
        laps: u32,
        seconds: f64,
    },
    RaceStarted {
        laps: u32,
    },
    RiderFinished {
        rider_id: RiderId,
        name: String,
        is_bot: bool,
        position: usize,
        time_s: f64,
    },
    RaceFinished,
    EventLobby {
        event_id: String,
        name: String,
        event_kind: String,
        starts_in_s: f64,
    },
    EventStarted {
        event_id: String,
        event_kind: String,
    },
    EventFinished {
        event_id: String,
        event_kind: String,
        results: Vec<EventResultState>,
    },
    VehicleBoarded {
        vehicle_id: VehicleId,
        rider_id: RiderId,
        name: String,
    },
    VehicleLeft {
        vehicle_id: VehicleId,
        rider_id: RiderId,
        name: String,
    },
    CaptainChanged {
        vehicle_id: VehicleId,
        rider_id: RiderId,
        name: String,
    },
}

// ---------------------------------------------------------------------------
// Mapping from the simulation
// ---------------------------------------------------------------------------

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

fn kind_str(kind: EventKind) -> String {
    match kind {
        EventKind::Race => "race",
        EventKind::GroupRide => "group_ride",
    }
    .to_owned()
}

fn phase_str(phase: Phase) -> String {
    match phase {
        Phase::Upcoming => "upcoming",
        Phase::Lobby => "lobby",
        Phase::Running => "running",
    }
    .to_owned()
}

fn event_results(results: &[EventResult]) -> Vec<EventResultState> {
    results
        .iter()
        .map(|r| EventResultState {
            rider_id: r.rider_id,
            name: r.name.clone(),
            is_bot: r.is_bot,
            place: r.place,
            time_s: r.time_s.map(round2),
            distance_m: r.distance_m.round(),
            avg_wkg: round1(r.avg_wkg),
            given_kj: round1(r.given_kj),
            received_kj: round1(r.received_kj),
        })
        .collect()
}

/// The wire form of an event as `viewer` sees it; `world` names the sharing partners.
pub fn event_state(world: &World, view: EventView) -> EventState {
    let names = |riders: &[(RiderId, f64)]| -> Vec<String> {
        riders
            .iter()
            .filter_map(|(id, _)| world.rider(*id).map(|r| r.name.clone()))
            .collect()
    };
    let (laps, distance_m) = match view.length {
        EventLength::Laps(laps) => (Some(laps), None),
        EventLength::Distance(m) => (None, Some(m)),
    };
    EventState {
        id: view.id,
        name: view.name,
        kind: kind_str(view.kind),
        phase: phase_str(view.phase),
        starts_in_s: round2(view.starts_in_s),
        laps,
        distance_m,
        entrants: view
            .entrants
            .into_iter()
            .map(|(rider_id, name)| EntrantState { rider_id, name })
            .collect(),
        entered: view.entered,
        sharing: view.sharing.map(|flow: Flow| SharingState {
            gap_s: round1(flow.gap_s),
            given_w: flow.given_w.round(),
            to: names(&flow.to),
            received_w: flow.received_w.round(),
            from: names(&flow.from),
        }),
    }
}

pub fn event_info(world_route_ids: &[String], info: EventInfo) -> EventInfoWire {
    EventInfoWire {
        id: info.id,
        name: info.name,
        kind: kind_str(info.kind),
        route_id: world_route_ids.get(info.route).cloned().unwrap_or_default(),
        lobby_opens_at_s: info.lobby_opens_at_s,
        starts_at_s: info.starts_at_s,
        phase: phase_str(info.phase),
        entrants: info.entrants,
    }
}

/// A scheduled-event notice and the route whose riders it concerns; `None`
/// for a quiet finish (nobody to announce it to).
pub fn event_notice_message(notice: EventNotice) -> Option<(RouteIndex, ServerMessage)> {
    let (route, event) = match notice {
        EventNotice::Lobby {
            route,
            id,
            name,
            kind,
            starts_in_s,
        } => (
            route,
            GameEvent::EventLobby {
                event_id: id,
                name,
                event_kind: kind_str(kind),
                starts_in_s: round2(starts_in_s),
            },
        ),
        EventNotice::Started { route, id, kind } => (
            route,
            GameEvent::EventStarted {
                event_id: id,
                event_kind: kind_str(kind),
            },
        ),
        EventNotice::Finished {
            route,
            id,
            kind,
            results,
            announce,
        } => {
            if !announce {
                return None;
            }
            (
                route,
                GameEvent::EventFinished {
                    event_id: id,
                    event_kind: kind_str(kind),
                    results: event_results(&results),
                },
            )
        }
    };
    Some((route, ServerMessage::Event { event }))
}

fn results(results: &[RaceResult]) -> Vec<RaceResultState> {
    results
        .iter()
        .map(|r| RaceResultState {
            rider_id: r.rider_id,
            name: r.name.clone(),
            is_bot: r.is_bot,
            time_s: round2(r.time_s),
        })
        .collect()
}

/// The race of route `route`.
pub fn race_state(world: &World, route: RouteIndex) -> RaceState {
    let race = world.race(route);
    match *race.phase() {
        RacePhase::Idle => RaceState::Idle,
        RacePhase::Countdown { laps, remaining_s } => RaceState::Countdown {
            laps,
            remaining_s: round2(remaining_s.max(0.0)),
            entrants: world.entrants(route).collect(),
        },
        RacePhase::Running { laps, elapsed_s } => RaceState::Running {
            laps,
            elapsed_s: round2(elapsed_s),
            results: results(race.results()),
        },
        RacePhase::Finished { laps } => RaceState::Finished {
            laps,
            results: results(race.results()),
        },
    }
}

fn rider_state(world: &World, r: &Rider, tags: RiderTags) -> RiderState {
    let route = world.route(r.route);
    let lap = match (world.race(r.route).running_laps(), r.race_distance()) {
        (Some(laps), Some(done)) => Some(((done / route.length()).floor() as u32 + 1).min(laps)),
        _ => None,
    };
    let seat = world.vehicle_of(r.id).and_then(|v| {
        let seat = v.seats.iter().position(|s| *s == Some(r.id))?;
        Some((v, seat))
    });
    RiderState {
        id: r.id,
        name: r.name.clone(),
        is_bot: r.is_bot(),
        route: r.off_route.is_none().then(|| route.id().to_owned()),
        distance: round2(r.position),
        road: world.road_of(r).map(|road| RoadState {
            edge: road.edge.to_owned(),
            dir: road.dir,
            offset: round2(road.offset),
            next: world.next_road_of(r).map(|(edge, dir)| NextRoad {
                edge: edge.to_owned(),
                dir,
            }),
        }),
        lap,
        lane: round2(r.lane),
        speed: round2(r.speed),
        power: r.power.round(),
        device: tags.device,
        vehicle: seat.map(|(vehicle, seat)| SeatRef {
            id: vehicle.id,
            kind: vehicle.kind.wire_name(),
            seat,
            seats: vehicle.seats.len(),
            captain: vehicle.captain == r.id,
        }),
        // The sim tracks a cadence per rider; fall back to a plausible one.
        cadence: seat.map(|_| r.cadence.unwrap_or(if r.power > 0.0 { 85.0 } else { 0.0 }).round()),
        parked: r.parked,
        exercise: tags.exercise,
    }
}

/// State as `viewer` sees it: at most `max_visible` riders, whatever their
/// route or distance. The viewer, their vehicle's seats and everyone in the
/// race of their route are always in; the rest fill up with humans (nearest
/// first) and then bots (nearest first). Nothing for an unknown viewer.
/// `tags_of` tells what each rider rides with and which exercise they do.
pub fn state_message(
    world: &World,
    tick: u64,
    viewer: RiderId,
    max_visible: usize,
    event: Option<Box<EventState>>,
    tags_of: &dyn Fn(RiderId) -> RiderTags,
) -> Option<ServerMessage> {
    let me = world.rider(viewer)?;
    let (x, y) = world.rider_xy(me);
    let own_vehicle = world.vehicle_of(viewer);
    let (mut always, mut others): (Vec<_>, Vec<_>) = world.riders().partition(|r| {
        r.id == viewer
            || own_vehicle.is_some_and(|v| v.seats.contains(&Some(r.id)))
            || (r.route == me.route && world.is_entered(r.id))
    });
    // Humans before bots, then nearest first; the rest of the list is cut off.
    let distance = |r: &Rider| {
        let (rx, ry) = world.rider_xy(r);
        (rx - x).hypot(ry - y)
    };
    others.sort_by(|a, b| a.is_bot().cmp(&b.is_bot()).then(distance(a).total_cmp(&distance(b))));
    others.truncate(max_visible.saturating_sub(always.len()));
    always.extend(others);
    let riders = always
        .into_iter()
        .map(|r| rider_state(world, r, tags_of(r.id)))
        .collect();
    let (humans, bots) = world.count_on(me.route);
    Some(ServerMessage::State {
        tick,
        riders,
        race: race_state(world, me.route),
        route_riders: RouteRiders { humans, bots },
        event,
        vehicle: own_vehicle.map(|v| vehicle_state(world, v)),
    })
}

fn vehicle_state(world: &World, v: &Vehicle) -> VehicleState {
    let powers: Vec<f64> = v
        .seats
        .iter()
        .map(|s| s.and_then(|id| world.rider(id)).map_or(0.0, |r| r.power))
        .collect();
    let shares = shares(&powers);
    VehicleState {
        id: v.id,
        code: v.code.clone(),
        kind: v.kind.wire_name(),
        captain: v.captain,
        bots: v.bots_fill,
        seats: v
            .seats
            .iter()
            .enumerate()
            .map(|(i, seat)| {
                let rider = world.rider((*seat)?)?;
                Some(VehicleSeatState {
                    rider_id: rider.id,
                    name: rider.name.clone(),
                    is_bot: rider.is_bot(),
                    power: rider.power.round(),
                    share: round2(shares[i]),
                })
            })
            .collect(),
    }
}

/// State of one studio room.
pub fn studio_state_message(studio: &Studio, room: usize, tick: u64) -> ServerMessage {
    let clock = studio.clock();
    let class = studio.timetable().class(&clock);
    let riders = studio.rooms()[room]
        .riders()
        .map(|(seat, r)| SeatState {
            id: r.id,
            name: r.name.clone(),
            is_bot: r.is_bot(),
            seat,
            power: r.power.round(),
            cadence: r.cadence.map(f64::round),
            speed: round2(r.speed),
            distance: round2(r.distance),
            on_target_pct: r.on_target_share().map(|share| (share * 100.0).round()),
            class_kj: (r.class_joules / 1000.0).round(),
        })
        .collect();
    ServerMessage::StudioState {
        tick,
        room,
        rooms: studio.rooms().len(),
        class: ClassState {
            id: class.id.clone(),
            name: class.name.clone(),
            starts_at_s: clock.starts_at_s,
            elapsed_s: round2(clock.elapsed_s),
        },
        riders,
    }
}

/// A studio event and the room it concerns.
pub fn studio_event_message(event: &StudioEvent) -> (usize, ServerMessage) {
    let (room, event) = match event.clone() {
        StudioEvent::RiderJoined {
            room,
            rider_id,
            name,
            is_bot,
        } => (room, GameEvent::RiderJoined { rider_id, name, is_bot }),
        StudioEvent::RiderLeft { room, rider_id, name } => (room, GameEvent::RiderLeft { rider_id, name }),
    };
    (room, ServerMessage::Event { event })
}

/// A world event and the route whose riders it concerns.
/// `None` for events clients don't hear about (a vehicle appearing or
/// dissolving is for the game's code registry). `world` names the riders,
/// `departed` those who already left it.
pub fn event_message(
    world: &World,
    departed: &HashMap<RiderId, String>,
    event: &WorldEvent,
) -> Option<(RouteIndex, ServerMessage)> {
    let name_of = |id: RiderId| {
        world
            .rider(id)
            .map(|r| r.name.clone())
            .or_else(|| departed.get(&id).cloned())
            .unwrap_or_default()
    };
    let (route, event) = match event.clone() {
        WorldEvent::Vehicle { id, route, change } => (
            route,
            match change {
                VehicleChange::Created | VehicleChange::Dissolved { .. } => return None,
                VehicleChange::Boarded(rider_id) => GameEvent::VehicleBoarded {
                    vehicle_id: id,
                    rider_id,
                    name: name_of(rider_id),
                },
                VehicleChange::Left(rider_id) => GameEvent::VehicleLeft {
                    vehicle_id: id,
                    rider_id,
                    name: name_of(rider_id),
                },
                VehicleChange::CaptainChanged(rider_id) => GameEvent::CaptainChanged {
                    vehicle_id: id,
                    rider_id,
                    name: name_of(rider_id),
                },
            },
        ),
        WorldEvent::RiderJoined {
            rider_id,
            name,
            is_bot,
            route,
        } => (route, GameEvent::RiderJoined { rider_id, name, is_bot }),
        WorldEvent::RiderLeft { rider_id, name, route } => (route, GameEvent::RiderLeft { rider_id, name }),
        WorldEvent::Race { route, event } => (
            route,
            match event {
                RaceEvent::CountdownStarted { laps, seconds } => GameEvent::RaceCountdown { laps, seconds },
                RaceEvent::Started { laps } => GameEvent::RaceStarted { laps },
                RaceEvent::RiderFinished {
                    rider_id,
                    name,
                    is_bot,
                    position,
                    time_s,
                } => GameEvent::RiderFinished {
                    rider_id,
                    name,
                    is_bot,
                    position,
                    time_s: round2(time_s),
                },
                RaceEvent::Finished => GameEvent::RaceFinished,
            },
        ),
    };
    Some((route, ServerMessage::Event { event }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_parses_client_messages() {
        assert_eq!(
            ClientMessage::parse(r#"{"type":"hello","protocol_version":2,"client_version":"web-0.1"}"#).unwrap(),
            ClientMessage::Hello {
                protocol_version: 2,
                client_version: "web-0.1".into()
            }
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"telemetry","power":231.5}"#).unwrap(),
            ClientMessage::Telemetry {
                power: 231.5,
                cadence: None
            }
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"input","action":"lane_left"}"#).unwrap(),
            ClientMessage::Input {
                action: InputAction::LaneLeft
            }
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"turn","edge":"hill-road"}"#).unwrap(),
            ClientMessage::Turn {
                edge: Some("hill-road".into())
            }
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"turn","edge":null}"#).unwrap(),
            ClientMessage::Turn { edge: None }
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"start_race","laps":2}"#).unwrap(),
            ClientMessage::StartRace { laps: 2 }
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"join","name":"Anna","weight_kg":70,"route_id":"alpine"}"#).unwrap(),
            ClientMessage::Join {
                name: "Anna".into(),
                weight_kg: 70.0,
                public_key: None,
                route_id: Some("alpine".into()),
                ftp_w: None,
                level_w: None,
                device: DeviceKind::Trainer,
                vehicle_code: None,
                resume_token: None,
                resume: None,
            }
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"join","name":"Anna","weight_kg":70,"level_w":245}"#).unwrap(),
            ClientMessage::Join {
                name: "Anna".into(),
                weight_kg: 70.0,
                public_key: None,
                route_id: None,
                ftp_w: None,
                level_w: Some(245.0),
                device: DeviceKind::Trainer,
                vehicle_code: None,
                resume_token: None,
                resume: None,
            }
        );
        let paddler =
            ClientMessage::parse(r#"{"type":"join","name":"Anna","weight_kg":70,"device":"paddle"}"#).unwrap();
        assert!(matches!(
            paddler,
            ClientMessage::Join {
                device: DeviceKind::Paddle,
                ..
            }
        ));
        assert!(ClientMessage::parse(r#"{"type":"join","name":"Anna","weight_kg":70,"device":"jetpack"}"#).is_err());
    }

    #[test]
    fn create_vehicle_parses() {
        assert_eq!(
            ClientMessage::parse(r#"{"type":"create_vehicle","kind":"beer_bike","seats":7}"#).unwrap(),
            ClientMessage::CreateVehicle {
                kind: "beer_bike".into(),
                seats: 7,
                bots: true
            }
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"create_vehicle","kind":"tandem","bots":false}"#).unwrap(),
            ClientMessage::CreateVehicle {
                kind: "tandem".into(),
                seats: 0,
                bots: false
            }
        );
    }

    #[test]
    fn board_vehicle_parses() {
        assert_eq!(
            ClientMessage::parse(r#"{"type":"board_vehicle","code":"ABC234"}"#).unwrap(),
            ClientMessage::BoardVehicle { code: "ABC234".into() }
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"leave_vehicle"}"#).unwrap(),
            ClientMessage::LeaveVehicle
        );
    }

    #[test]
    fn join_takes_a_vehicle_code() {
        let joined =
            ClientMessage::parse(r#"{"type":"join","name":"Anna","weight_kg":70,"vehicle_code":"ABC234"}"#).unwrap();
        assert!(matches!(joined, ClientMessage::Join { vehicle_code: Some(c), .. } if c == "ABC234"));
        let plain = ClientMessage::parse(r#"{"type":"join","name":"Anna","weight_kg":70}"#).unwrap();
        assert!(matches!(plain, ClientMessage::Join { vehicle_code: None, .. }));
    }

    #[test]
    fn join_parses_resume_fields() {
        let resume = ClientMessage::parse(
            r#"{"type":"join","name":"A","weight_kg":70,"resume_token":"ab","resume":{"route_id":"r","distance_m":1234.5}}"#,
        )
        .unwrap();
        assert!(matches!(&resume, ClientMessage::Join { resume_token, .. } if resume_token.as_deref() == Some("ab")));
        assert!(matches!(
            &resume,
            ClientMessage::Join { resume, .. }
                if resume.as_ref()
                    == Some(&ResumePoint {
                        route_id: "r".into(),
                        distance_m: 1234.5
                    })
        ));
        // Older joins without the fields parse with both `None`.
        let plain = ClientMessage::parse(r#"{"type":"join","name":"A","weight_kg":70}"#).unwrap();
        assert!(
            matches!(plain, ClientMessage::Join { resume_token, resume, .. } if resume_token.is_none() && resume.is_none())
        );
    }

    #[test]
    fn leave_parses() {
        assert_eq!(
            ClientMessage::parse(r#"{"type":"leave"}"#).unwrap(),
            ClientMessage::Leave
        );
    }

    fn rider_json(vehicle: Option<SeatRef>, cadence: Option<f64>) -> RiderState {
        RiderState {
            id: 1,
            name: "Anna".into(),
            is_bot: false,
            route: Some("loop".into()),
            distance: 0.0,
            road: None,
            lap: None,
            lane: 0.0,
            speed: 0.0,
            power: 0.0,
            device: DeviceKind::Trainer,
            vehicle,
            cadence,
            parked: false,
            exercise: None,
        }
    }

    #[test]
    fn the_workout_device_and_exercises_parse() {
        assert!(matches!(
            ClientMessage::parse(r#"{"type":"join","name":"Anna","weight_kg":70,"device":"workout"}"#).unwrap(),
            ClientMessage::Join {
                device: DeviceKind::Workout,
                ..
            }
        ));
        let ids = ["squats", "situps", "pushups", "jumping_jacks", "plank", "burpees"];
        for id in ids {
            let exercise = Exercise::from_id(id).unwrap_or_else(|| panic!("{id} parses"));
            assert_eq!(serde_json::to_string(&exercise).unwrap(), format!("\"{id}\""));
        }
        assert_eq!(Exercise::from_id("pullups"), None);
    }

    #[test]
    fn pause_and_resume_parse() {
        assert_eq!(
            ClientMessage::parse(r#"{"type":"pause"}"#).unwrap(),
            ClientMessage::Pause
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"resume"}"#).unwrap(),
            ClientMessage::Resume
        );
    }

    #[test]
    fn parked_is_only_serialised_when_true() {
        let mut rider = rider_json(None, None);
        assert!(!serde_json::to_string(&rider).unwrap().contains("parked"));
        rider.parked = true;
        assert!(serde_json::to_string(&rider).unwrap().contains(r#""parked":true"#));
    }

    #[test]
    fn state_with_a_vehicle_serialises() {
        let json = ServerMessage::State {
            tick: 1,
            riders: vec![rider_json(
                Some(SeatRef {
                    id: 3,
                    kind: "tandem",
                    seat: 1,
                    seats: 2,
                    captain: false,
                }),
                Some(85.0),
            )],
            race: RaceState::Idle,
            route_riders: RouteRiders { humans: 1, bots: 0 },
            event: None,
            vehicle: Some(VehicleState {
                id: 3,
                code: "ABC234".into(),
                kind: "tandem",
                captain: 1,
                bots: true,
                seats: vec![
                    Some(VehicleSeatState {
                        rider_id: 1,
                        name: "Anna".into(),
                        is_bot: false,
                        power: 200.0,
                        share: 0.5,
                    }),
                    None,
                ],
            }),
        }
        .to_json();
        assert!(json.contains(r#""vehicle":{"id":3,"code":"ABC234","kind":"tandem","captain":1,"bots":true,"seats":[{"rider_id":1,"name":"Anna","is_bot":false,"power":200.0,"share":0.5},null]}"#));
        assert!(json.contains(r#""vehicle":{"id":3,"kind":"tandem","seat":1,"seats":2,"captain":false}"#));
        assert!(json.contains(r#""cadence":85.0"#));
    }

    #[test]
    fn solo_riders_have_no_vehicle_field() {
        let json = ServerMessage::State {
            tick: 1,
            riders: vec![rider_json(None, None)],
            race: RaceState::Idle,
            route_riders: RouteRiders { humans: 1, bots: 0 },
            event: None,
            vehicle: None,
        }
        .to_json();
        assert!(!json.contains("vehicle"));
        assert!(!json.contains("cadence"));
    }

    #[test]
    fn joined_and_welcome_carry_the_new_fields() {
        let json = ServerMessage::Joined {
            rider_id: 3,
            resume_token: "t".into(),
        }
        .to_json();
        assert!(json.contains(r#""resume_token":"t""#));
        let json = ServerMessage::Welcome {
            protocol_version: PROTOCOL_VERSION,
            server_name: "Club".into(),
            server_version: "1.0.0".into(),
            auth_mode: "open".into(),
            route_id: "loop".into(),
            grace_s: 60.0,
        }
        .to_json();
        assert!(json.contains(r#""grace_s":60.0"#));
    }

    #[test]
    fn json_rejects_unknown_messages() {
        assert!(ClientMessage::parse(r#"{"type":"teleport"}"#).is_err());
        assert!(ClientMessage::parse(r#"{"type":"input","action":"fly"}"#).is_err());
        assert!(ClientMessage::parse("not json").is_err());
    }

    #[test]
    fn json_serialises_server_messages_with_type_tags() {
        let json = ServerMessage::Resistance { grade_percent: 4.5 }.to_json();
        assert_eq!(json, r#"{"type":"resistance","grade_percent":4.5}"#);

        let json = ServerMessage::Event {
            event: GameEvent::RaceStarted { laps: 3 },
        }
        .to_json();
        assert_eq!(json, r#"{"type":"event","event":{"kind":"race_started","laps":3}}"#);

        let json = ServerMessage::State {
            tick: 1,
            riders: vec![],
            race: RaceState::Idle,
            route_riders: RouteRiders { humans: 1, bots: 2 },
            event: None,
            vehicle: None,
        }
        .to_json();
        assert_eq!(
            json,
            r#"{"type":"state","tick":1,"riders":[],"race":{"phase":"idle"},"route_riders":{"humans":1,"bots":2}}"#
        );
    }

    #[test]
    fn json_parses_event_messages_and_serialises_event_news() {
        assert_eq!(
            ClientMessage::parse(r#"{"type":"join_event","event_id":"x"}"#).unwrap(),
            ClientMessage::JoinEvent { event_id: "x".into() }
        );
        assert_eq!(
            ClientMessage::parse(r#"{"type":"leave_event"}"#).unwrap(),
            ClientMessage::LeaveEvent
        );
        let json = ServerMessage::Event {
            event: GameEvent::EventFinished {
                event_id: "x".into(),
                event_kind: "race".into(),
                results: vec![],
            },
        }
        .to_json();
        assert_eq!(
            json,
            r#"{"type":"event","event":{"kind":"event_finished","event_id":"x","event_kind":"race","results":[]}}"#
        );
    }

    #[test]
    fn event_started_carries_the_event_kind() {
        let json = ServerMessage::Event {
            event: GameEvent::EventStarted {
                event_id: "x".into(),
                event_kind: "race".into(),
            },
        }
        .to_json();
        assert_eq!(
            json,
            r#"{"type":"event","event":{"kind":"event_started","event_id":"x","event_kind":"race"}}"#
        );
    }

    #[test]
    fn state_without_an_event_has_no_event_key() {
        let json = ServerMessage::State {
            tick: 1,
            riders: vec![],
            race: RaceState::Idle,
            route_riders: RouteRiders { humans: 0, bots: 0 },
            event: None,
            vehicle: None,
        }
        .to_json();
        assert!(!json.contains("event"));
    }
}
