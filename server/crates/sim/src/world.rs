//! The world: every rider of a map, advanced in fixed time steps.
//!
//! The world is the single source of truth for positions and speeds. Humans
//! only contribute raw telemetry (power, cadence); bots contribute generated
//! power. Both run through identical physics.
//!
//! A world holds one or more routes (ADR 0010, #14): the routes of one map
//! share its roads. Each rider rides one route; where routes share a road,
//! riders going the same way draft each other whatever their route. Races,
//! markers and laps stay per route.
//!
//! With the map's road network, riders can turn at junctions (#15): onto a
//! road another route rides that way, they ride that route from there;
//! onto any other road they ride off-route, road by road, straight on unless
//! they pick another way.

use crate::bot::{pack_levels, BotBrain, BotProfile, BotSituation, BotTuning, LaneView};
use crate::drafting::DraftParams;
use crate::names;
use crate::network::{Network, RoadKey};
use crate::physics::{self, Body, PhysicsParams, StepInput};
use crate::race::{Race, RaceError, RaceEvent, RacePhase};
use crate::rng::{RandomSource, SplitMix64};
use crate::route::Route;
use crate::sharing::SharingTuning;
use crate::spacing::SpacingParams;
use crate::vehicle::{Vehicle, VehicleId, VehicleKind, VehicleParams};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

mod vehicles;

pub type RiderId = u32;

/// A route of the world, by its place in [`World::routes`].
pub type RouteIndex = usize;

/// Tunables of the simulation. Everything has a sensible default.
#[derive(Debug, Clone, PartialEq)]
pub struct SimConfig {
    /// Humans plus bots the world tries to keep riding on every route.
    pub target_riders: usize,
    pub physics: PhysicsParams,
    pub draft: DraftParams,
    /// How close riders get in a lane, passing, and start line-up rows.
    pub spacing: SpacingParams,
    pub bot_tuning: BotTuning,
    /// Seconds needed to move over by one lane.
    pub lane_change_s: f64,
    /// Without telemetry for this long, a human rider stops pedalling.
    pub telemetry_timeout_s: f64,
    pub race_countdown_s: f64,
    pub max_race_laps: u32,
    /// Surplus bots only leave when no human is closer than this.
    pub bot_despawn_distance_m: f64,
    pub max_power_watts: f64,
    /// Share of bots that enter a race when it is announced (the rest keep free riding).
    pub bot_race_share: f64,
    /// Bots an event adds per human entrant.
    pub bots_per_entrant: usize,
    /// Most bots an event adds (a bots-only event gets half of this).
    pub max_event_bots: usize,
    pub sharing: SharingTuning,
    pub vehicles: VehicleParams,
    /// Deceleration (m/s²) holding a parked rider at a stop, even downhill.
    pub park_brake_mps2: f64,
    /// How far past the rightmost lane (in lanes) a parked rider pulls over.
    pub park_lane_offset: f64,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            target_riders: 12,
            physics: PhysicsParams::default(),
            draft: DraftParams::default(),
            spacing: SpacingParams::default(),
            bot_tuning: BotTuning::default(),
            lane_change_s: 1.0,
            telemetry_timeout_s: 3.0,
            race_countdown_s: 10.0,
            max_race_laps: 20,
            bot_despawn_distance_m: 200.0,
            max_power_watts: 2500.0,
            bot_race_share: 0.6,
            bots_per_entrant: 4,
            max_event_bots: 24,
            sharing: SharingTuning::default(),
            vehicles: VehicleParams::default(),
            park_brake_mps2: 3.0,
            park_lane_offset: 0.7,
        }
    }
}

#[derive(Debug, Clone)]
pub enum Controller {
    Human { seconds_since_telemetry: f64 },
    Bot(Box<BotBrain>),
}

#[derive(Debug, Clone)]
pub struct Rider {
    pub id: RiderId,
    pub name: String,
    pub controller: Controller,
    pub mass_kg: f64,
    /// The route this rider rides.
    pub route: RouteIndex,
    /// Position on the route's lap, in `[0, route length)`.
    pub position: f64,
    /// Total distance ridden since joining.
    pub odometer: f64,
    /// Current, continuous lane position.
    pub lane: f64,
    pub target_lane: u8,
    pub speed: f64,
    pub power: f64,
    pub cadence: Option<f64>,
    /// Odometer reading at the race start, if this rider takes part in the race.
    pub race_start_odometer: Option<f64>,
    pub race_finished: bool,
    /// Riding the network away from any route (`position` then counts the
    /// metres since leaving it).
    pub off_route: Option<OffRoute>,
    /// The road picked for the next junction, if not the default.
    pub turn: Option<RoadKey>,
    /// A human's riding level in W/kg; `None` for bots (and until set).
    pub level_wkg: Option<f64>,
    /// Riding in a group ride (bots then ride a steady pace; no despawning).
    pub in_group_ride: bool,
    /// Watts added to (or taken from) the power the physics sees; `power` stays the real one.
    pub power_adjust: f64,
    /// Turning is locked (an event holds the rider on the route).
    pub turns_locked: bool,
    /// Paused (#89): braked to a stop on the shoulder, power ignored, out of the draft.
    pub parked: bool,
    /// Doing a workout (#77): permanently parked at the start, never entered in a race.
    pub workout: bool,
}

/// A rider off their route: the road they ride and how far into it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OffRoute {
    pub road: RoadKey,
    pub offset: f64,
}

impl Rider {
    pub fn is_bot(&self) -> bool {
        matches!(self.controller, Controller::Bot(_))
    }

    /// Distance ridden in the current race, if participating.
    pub fn race_distance(&self) -> Option<f64> {
        self.race_start_odometer.map(|start| self.odometer - start)
    }
}

/// Where a rider is on the road network: the road, the riding direction
/// (1 along the road's points, -1 back) and the metres along the road from
/// where the rider entered it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoadPosition<'a> {
    pub edge: &'a str,
    pub dir: i8,
    pub offset: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum WorldEvent {
    RiderJoined {
        rider_id: RiderId,
        name: String,
        is_bot: bool,
        route: RouteIndex,
    },
    RiderLeft {
        rider_id: RiderId,
        name: String,
        route: RouteIndex,
    },
    Race {
        route: RouteIndex,
        event: RaceEvent,
    },
    Vehicle {
        id: VehicleId,
        route: RouteIndex,
        change: VehicleChange,
    },
}

/// What happened to a vehicle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VehicleChange {
    Created,
    Boarded(RiderId),
    Left(RiderId),
    CaptainChanged(RiderId),
    Dissolved { code: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorldError {
    UnknownRider(RiderId),
    UnknownRoute(RouteIndex),
    NotHuman(RiderId),
    Race(RaceError),
    /// No such road at the junction ahead (or the world has no network).
    NoSuchTurn,
    /// Race entrants stay on the route.
    Racing,
    /// Races are ridden on a route, not off it.
    OffRoute,
    /// An event is scheduled on the route: no manual races.
    EventScheduled,
    NoSuchVehicle,
    VehicleFull,
    /// Only the captain steers.
    NotCaptain,
    AlreadyAboard,
    /// Entered in a race or event (or seated, when trying to enter one).
    InEvent,
    /// A vehicle kind with a seat count it can't have.
    BadSeatCount,
    /// Pausing isn't possible in a race, an event or a vehicle.
    PauseRejected,
}

impl fmt::Display for WorldError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorldError::UnknownRider(id) => write!(f, "unknown rider {id}"),
            WorldError::UnknownRoute(index) => write!(f, "unknown route {index}"),
            WorldError::NotHuman(id) => write!(f, "rider {id} is not controlled by a human"),
            WorldError::Race(e) => write!(f, "{e}"),
            WorldError::NoSuchTurn => write!(f, "there is no such road at the next junction"),
            WorldError::Racing => write!(f, "race entrants can't turn off their route"),
            WorldError::OffRoute => write!(f, "races are ridden on a route: ride back onto one first"),
            WorldError::EventScheduled => write!(f, "an event is scheduled on this route"),
            WorldError::NoSuchVehicle => write!(f, "there is no such vehicle"),
            WorldError::VehicleFull => write!(f, "the vehicle has no free seat"),
            WorldError::NotCaptain => write!(f, "only the captain steers the vehicle"),
            WorldError::AlreadyAboard => write!(f, "already aboard a vehicle"),
            WorldError::InEvent => write!(f, "riders in a race or event can't use a vehicle"),
            WorldError::BadSeatCount => write!(f, "the vehicle has an invalid number of seats"),
            WorldError::PauseRejected => write!(f, "pausing isn't possible in a race, an event or a vehicle"),
        }
    }
}

impl std::error::Error for WorldError {}

/// A route's walk step as the world needs it for drafting.
#[derive(Debug, Clone, Copy)]
struct Step {
    key: RoadKey,
    length: f64,
}

/// Snapshot of a rider's surroundings, taken before the physics step so that
/// every rider sees the same state regardless of iteration order.
#[derive(Debug, Clone, Copy)]
struct Slot {
    id: RiderId,
    route: RouteIndex,
    on_route: bool,
    position: f64,
    lane: f64,
    speed: f64,
    /// Lanes either side of `lane` that this slot blocks when others test
    /// whether they ride in its lane (`draft.lane_tolerance` for a rider).
    half_width: f64,
    /// A beer bike: lanes exactly `half_width` away count as its lane, both
    /// for riders behind it and for it behind others.
    wide: bool,
    /// The draft curve for riders behind this slot.
    draft: DraftParams,
    /// The road under the rider, how far along it, and the road after it.
    road: Option<(Step, f64, RoadKey)>,
}

/// The race of one route and who is entered in it.
struct RouteRace {
    race: Race,
    /// An event is scheduled: manual races are refused.
    reserved: bool,
    /// Riders entered in the announced or running race. Everybody else keeps free riding.
    entrants: BTreeSet<RiderId>,
}

pub struct World {
    routes: Vec<Route>,
    /// The map's road network; without one nobody can turn.
    network: Option<Network>,
    /// Road names by interned index (the network's roads first, in its order).
    road_names: Vec<String>,
    /// Per route, its walk's steps with interned roads (empty off the network).
    steps: Vec<Vec<Step>>,
    config: SimConfig,
    riders: BTreeMap<RiderId, Rider>,
    next_id: RiderId,
    races: Vec<RouteRace>,
    rng: Box<dyn RandomSource>,
    /// Draws boarding codes. Kept apart from `rng`, whose seed is logged and
    /// may be fixed: a server sets an unpredictable one (`set_code_source`).
    code_rng: Box<dyn RandomSource>,
    events: Vec<WorldEvent>,
    vehicles: BTreeMap<VehicleId, Vehicle>,
    /// The vehicle each seated rider (captain and bots included) sits in.
    seat_of: BTreeMap<RiderId, VehicleId>,
    next_vehicle_id: VehicleId,
}

impl World {
    /// Creates a world on one route and immediately fills it with bots.
    pub fn new(route: Route, config: SimConfig, rng: Box<dyn RandomSource>) -> Self {
        Self::with_routes(vec![route], config, rng)
    }

    /// Creates a world on the routes of one map (they share roads by their
    /// walks' road ids) and fills every route with bots.
    ///
    /// # Panics
    /// If `routes` is empty.
    pub fn with_routes(routes: Vec<Route>, config: SimConfig, rng: Box<dyn RandomSource>) -> Self {
        Self::with_network(routes, None, config, rng)
    }

    /// Like [`World::with_routes`], on the map's road network: riders can
    /// turn at its junctions.
    ///
    /// # Panics
    /// If `routes` is empty.
    pub fn with_network(
        routes: Vec<Route>,
        network: Option<Network>,
        config: SimConfig,
        rng: Box<dyn RandomSource>,
    ) -> Self {
        assert!(!routes.is_empty(), "a world needs at least one route");
        let mut road_names: Vec<String> = network
            .iter()
            .flat_map(|net| (0..net.len() as u32).map(|i| net.edge(i).id().to_owned()))
            .collect();
        let steps = routes
            .iter()
            .map(|route| {
                route
                    .walk()
                    .iter()
                    .map(|step| {
                        let edge = match road_names.iter().position(|name| *name == step.edge) {
                            Some(index) => index as u32,
                            None => {
                                road_names.push(step.edge.clone());
                                road_names.len() as u32 - 1
                            }
                        };
                        Step {
                            key: (edge, step.dir),
                            length: step.length,
                        }
                    })
                    .collect()
            })
            .collect();
        let races = routes
            .iter()
            .map(|_| RouteRace {
                race: Race::new(config.race_countdown_s, config.max_race_laps),
                reserved: false,
                entrants: BTreeSet::new(),
            })
            .collect();
        let mut world = Self {
            routes,
            network,
            road_names,
            steps,
            config,
            riders: BTreeMap::new(),
            next_id: 1,
            races,
            rng,
            code_rng: Box::new(SplitMix64::new(0x0C0D_E5EE_D000_0001)),
            events: Vec::new(),
            vehicles: BTreeMap::new(),
            seat_of: BTreeMap::new(),
            next_vehicle_id: 1,
        };
        world.balance_population();
        world
    }

    pub fn routes(&self) -> &[Route] {
        &self.routes
    }

    /// # Panics
    /// If there is no route `index`.
    pub fn route(&self, index: RouteIndex) -> &Route {
        &self.routes[index]
    }

    /// The index of the route with `id`.
    pub fn route_index(&self, id: &str) -> Option<RouteIndex> {
        self.routes.iter().position(|route| route.id() == id)
    }

    pub fn config(&self) -> &SimConfig {
        &self.config
    }

    /// The race of route `index`.
    ///
    /// # Panics
    /// If there is no route `index`.
    pub fn race(&self, index: RouteIndex) -> &Race {
        &self.races[index].race
    }

    pub fn riders(&self) -> impl Iterator<Item = &Rider> {
        self.riders.values()
    }

    pub fn rider(&self, id: RiderId) -> Option<&Rider> {
        self.riders.get(&id)
    }

    /// Sets a human's riding level in W/kg; new bots are matched to it.
    pub fn set_level(&mut self, id: RiderId, level_wkg: f64) -> Result<(), WorldError> {
        let rider = self.riders.get_mut(&id).ok_or(WorldError::UnknownRider(id))?;
        if rider.is_bot() {
            return Err(WorldError::NotHuman(id));
        }
        rider.level_wkg = Some(level_wkg);
        if let Some(vehicle) = self.seat_of.get(&id).copied() {
            self.relevel_seat_bots(vehicle);
        }
        Ok(())
    }

    /// The riding levels (W/kg) of the humans who have one.
    pub fn human_levels(&self) -> Vec<f64> {
        self.riders.values().filter_map(|r| r.level_wkg).collect()
    }

    pub fn human_count(&self) -> usize {
        self.riders.values().filter(|r| !r.is_bot()).count()
    }

    pub fn bot_count(&self) -> usize {
        self.riders.values().filter(|r| r.is_bot()).count()
    }

    /// Horizontal position of a rider (metres east and north, map coordinates).
    pub fn rider_xy(&self, rider: &Rider) -> (f64, f64) {
        self.roads().xy(rider)
    }

    fn roads(&self) -> Roads<'_> {
        Roads {
            routes: &self.routes,
            steps: &self.steps,
            network: self.network.as_ref(),
        }
    }

    /// The road under a rider, if its route lies on a road network (or the
    /// rider rides off-route).
    pub fn road_of(&self, rider: &Rider) -> Option<RoadPosition<'_>> {
        let (key, offset) = self.roads().current(rider)?;
        Some(RoadPosition {
            edge: &self.road_names[key.0 as usize],
            dir: key.1,
            offset,
        })
    }

    /// The road a rider takes at the next junction: the one they picked, or
    /// their route's (straight on off-route). `None` off the network.
    pub fn next_road_of(&self, rider: &Rider) -> Option<(&str, i8)> {
        let roads = self.roads();
        let (key, _) = roads.current(rider)?;
        let next = rider.turn.or_else(|| roads.default_next(rider, key))?;
        Some((&self.road_names[next.0 as usize], next.1))
    }

    /// Picks the road to take at the next junction (`None`: the default, i.e.
    /// stay on the route or straight on off it). Race entrants can't turn.
    pub fn choose_turn(&mut self, id: RiderId, edge: Option<&str>) -> Result<(), WorldError> {
        let rider = self.riders.get(&id).ok_or(WorldError::UnknownRider(id))?;
        self.require_captain(id)?;
        if rider.turns_locked || self.races[rider.route].entrants.contains(&id) {
            return Err(WorldError::Racing);
        }
        let roads = self.roads();
        let (Some(network), Some((key, _))) = (self.network.as_ref(), roads.current(rider)) else {
            return Err(WorldError::NoSuchTurn);
        };
        let turn = match edge {
            None => None,
            Some(edge) => {
                let index = network.edge_index(edge).ok_or(WorldError::NoSuchTurn)?;
                let next = network
                    .onward(key)
                    .find(|next| next.0 == index)
                    .ok_or(WorldError::NoSuchTurn)?;
                // Picking the default is no pick: the route stays the plan.
                (Some(next) != roads.default_next(rider, key)).then_some(next)
            }
        };
        if let Some(rider) = self.riders.get_mut(&id) {
            rider.turn = turn;
        }
        Ok(())
    }

    /// Grade in percent under the given rider, used for trainer resistance.
    pub fn grade_for(&self, id: RiderId) -> Option<f64> {
        self.riders.get(&id).map(|r| self.roads().grade(r))
    }

    /// Returns and clears all events produced since the last call.
    pub fn drain_events(&mut self) -> Vec<WorldEvent> {
        std::mem::take(&mut self.events)
    }

    /// Adds a human rider at the start line of the first route.
    pub fn join_human(&mut self, name: &str, weight_kg: f64) -> RiderId {
        self.join_human_on(0, name, weight_kg)
            .expect("a world always has a first route")
    }

    /// Adds a human rider at the start line of route `route`, in the middle lane.
    pub fn join_human_on(&mut self, route: RouteIndex, name: &str, weight_kg: f64) -> Result<RiderId, WorldError> {
        let Some(lanes) = self.routes.get(route).map(Route::lanes) else {
            return Err(WorldError::UnknownRoute(route));
        };
        let id = self.allocate_id();
        let lane = lanes / 2;
        self.riders.insert(
            id,
            Rider {
                id,
                name: name.to_owned(),
                controller: Controller::Human {
                    seconds_since_telemetry: 0.0,
                },
                mass_kg: weight_kg,
                route,
                position: 0.0,
                odometer: 0.0,
                lane: f64::from(lane),
                target_lane: lane,
                speed: 0.0,
                power: 0.0,
                cadence: None,
                race_start_odometer: None,
                race_finished: false,
                off_route: None,
                turn: None,
                level_wkg: None,
                in_group_ride: false,
                power_adjust: 0.0,
                turns_locked: false,
                parked: false,
                workout: false,
            },
        );
        self.events.push(WorldEvent::RiderJoined {
            rider_id: id,
            name: name.to_owned(),
            is_bot: false,
            route,
        });
        self.balance_population();
        Ok(id)
    }

    /// Removes a rider. Returns `false` if the rider did not exist.
    pub fn leave(&mut self, id: RiderId) -> bool {
        if !self.riders.contains_key(&id) {
            return false;
        }
        self.unseat(id);
        let Some(rider) = self.riders.remove(&id) else {
            return false;
        };
        self.races[rider.route].entrants.remove(&id);
        self.events.push(WorldEvent::RiderLeft {
            rider_id: id,
            name: rider.name,
            route: rider.route,
        });
        self.balance_population();
        true
    }

    pub fn set_telemetry(&mut self, id: RiderId, power: f64, cadence: Option<f64>) -> Result<(), WorldError> {
        let max_power = self.config.max_power_watts;
        let rider = self.riders.get_mut(&id).ok_or(WorldError::UnknownRider(id))?;
        let Controller::Human {
            seconds_since_telemetry,
        } = &mut rider.controller
        else {
            return Err(WorldError::NotHuman(id));
        };
        *seconds_since_telemetry = 0.0;
        rider.power = if power.is_finite() {
            power.clamp(0.0, max_power)
        } else {
            0.0
        };
        rider.cadence = cadence.filter(|c| c.is_finite()).map(|c| c.clamp(0.0, 250.0));
        Ok(())
    }

    /// Moves the rider's target lane by `delta` (negative = left), clamped to the road.
    pub fn shift_lane(&mut self, id: RiderId, delta: i8) -> Result<u8, WorldError> {
        if !self.riders.contains_key(&id) {
            return Err(WorldError::UnknownRider(id));
        }
        self.require_captain(id)?;
        let rider = self.riders.get_mut(&id).ok_or(WorldError::UnknownRider(id))?;
        let max_lane = i16::from(self.routes[rider.route].lanes()) - 1;
        let target = (i16::from(rider.target_lane) + i16::from(delta)).clamp(0, max_lane);
        rider.target_lane = target as u8;
        Ok(rider.target_lane)
    }

    /// Announces a race on the `starter`'s route (the first route without
    /// one). Only entrants race: the `starter`, riders of that route who join
    /// during the countdown and a share of its bots. Everyone else keeps free
    /// riding and is never moved.
    pub fn start_race(&mut self, laps: u32, starter: Option<RiderId>) -> Result<(), WorldError> {
        let starter_rider = starter.and_then(|id| self.riders.get(&id));
        if starter_rider.is_some_and(|r| r.off_route.is_some()) {
            return Err(WorldError::OffRoute);
        }
        let route = starter_rider.map_or(0, |r| r.route);
        self.start_race_on(route, laps, starter)
    }

    /// Announces a race on route `route`; see [`World::start_race`].
    pub fn start_race_on(&mut self, route: RouteIndex, laps: u32, starter: Option<RiderId>) -> Result<(), WorldError> {
        if starter.is_some_and(|id| self.seat_of.contains_key(&id) || self.is_workout(id)) {
            return Err(WorldError::InEvent);
        }
        let Some(state) = self.races.get_mut(route) else {
            return Err(WorldError::UnknownRoute(route));
        };
        if state.reserved {
            return Err(WorldError::EventScheduled);
        }
        let event = state.race.request_start(laps).map_err(WorldError::Race)?;
        state.entrants.clear();
        if let Some(id) = starter.filter(|id| self.riders.get(id).is_some_and(|r| r.route == route)) {
            state.entrants.insert(id);
            // Entrants ride the route: a picked turn is dropped.
            if let Some(rider) = self.riders.get_mut(&id) {
                rider.turn = None;
                rider.parked = false;
            }
        }
        let bots: Vec<RiderId> = self
            .riders
            .values()
            .filter(|r| r.is_bot() && r.route == route && !self.seat_of.contains_key(&r.id))
            .map(|r| r.id)
            .collect();
        for id in bots {
            if self.rng.next_f64() < self.config.bot_race_share {
                self.races[route].entrants.insert(id);
            }
        }
        self.events.push(WorldEvent::Race { route, event });
        Ok(())
    }

    /// Parks a rider (a pause, #89): it brakes to a stop and pulls over to the
    /// shoulder. Not possible in a race, an event or a vehicle.
    pub fn park(&mut self, id: RiderId) -> Result<(), WorldError> {
        let entered = self.is_entered(id);
        let seated = self.seat_of.contains_key(&id);
        let rider = self.riders.get_mut(&id).ok_or(WorldError::UnknownRider(id))?;
        if entered || seated || rider.turns_locked {
            return Err(WorldError::PauseRejected);
        }
        rider.parked = true;
        // Unparking merges back from the shoulder into the rightmost lane, not across every lane.
        rider.target_lane = self.routes[rider.route].lanes().saturating_sub(1);
        Ok(())
    }

    /// Lets a parked rider ride on again (a no-op when not parked, or for a workout rider).
    pub fn unpark(&mut self, id: RiderId) -> Result<(), WorldError> {
        let rider = self.riders.get_mut(&id).ok_or(WorldError::UnknownRider(id))?;
        if !rider.workout {
            rider.parked = false;
        }
        Ok(())
    }

    /// Starts a workout (#77): the rider is flagged and parked for good (until it leaves).
    /// Not possible in a race, an event or a vehicle.
    pub fn start_workout(&mut self, id: RiderId) -> Result<(), WorldError> {
        self.park(id)?;
        if let Some(rider) = self.riders.get_mut(&id) {
            rider.workout = true;
        }
        Ok(())
    }

    fn is_workout(&self, id: RiderId) -> bool {
        self.riders.get(&id).is_some_and(|r| r.workout)
    }

    /// Enters a rider in the race counting down on its route.
    pub fn join_race(&mut self, id: RiderId) -> Result<(), WorldError> {
        let rider = self.riders.get_mut(&id).ok_or(WorldError::UnknownRider(id))?;
        if self.seat_of.contains_key(&id) || rider.workout {
            return Err(WorldError::InEvent);
        }
        if rider.off_route.is_some() {
            return Err(WorldError::OffRoute);
        }
        let state = &mut self.races[rider.route];
        if !matches!(state.race.phase(), RacePhase::Countdown { .. }) {
            return Err(WorldError::Race(RaceError::NotOpen));
        }
        state.entrants.insert(id);
        rider.turn = None;
        rider.parked = false;
        Ok(())
    }

    /// Withdraws a rider: before the start, or mid-race (no result then).
    pub fn leave_race(&mut self, id: RiderId) {
        let Some(rider) = self.riders.get_mut(&id) else {
            return;
        };
        if !self.races[rider.route].entrants.remove(&id) {
            return;
        }
        if !rider.race_finished {
            rider.race_start_odometer = None;
        }
    }

    /// True if the rider is entered in the announced or running race of its route.
    pub fn is_entered(&self, id: RiderId) -> bool {
        self.riders
            .get(&id)
            .is_some_and(|r| self.races[r.route].entrants.contains(&id))
    }

    /// Riders entered in the race of route `route`.
    pub fn entrants(&self, route: RouteIndex) -> impl Iterator<Item = RiderId> + '_ {
        self.races
            .get(route)
            .into_iter()
            .flat_map(|state| state.entrants.iter().copied())
    }

    /// Humans and bots riding route `route`.
    pub fn count_on(&self, route: RouteIndex) -> (usize, usize) {
        let on = self
            .riders
            .values()
            .filter(|r| r.route == route && r.off_route.is_none());
        // Workout riders stand at the café, not on the road: they are not counted.
        on.filter(|r| !r.workout).fold((0, 0), |(humans, bots), r| {
            if r.is_bot() {
                (humans, bots + 1)
            } else {
                (humans + 1, bots)
            }
        })
    }

    /// Advances the whole world by `dt` seconds.
    pub fn tick(&mut self, dt: f64) {
        for route in 0..self.routes.len() {
            if let Some(event) = self.races[route].race.advance(dt) {
                if matches!(event, RaceEvent::Started { .. }) {
                    self.line_up_for_race(route);
                }
                self.events.push(WorldEvent::Race { route, event });
            }
        }

        let own_slots: Vec<Slot> = self.riders.values().map(|r| self.slot(r)).collect();
        // A vehicle is one slot, at its captain: the other seats have none.
        let slots: Vec<Slot> = own_slots
            .iter()
            .filter(|s| self.seat_of.get(&s.id).is_none_or(|v| self.vehicles[v].captain == s.id))
            // A parked rider is off the road: nobody drafts or is blocked by it.
            .filter(|s| !self.riders.get(&s.id).is_some_and(|r| r.parked))
            .copied()
            .collect();
        let race_laps: Vec<Option<u32>> = self.races.iter().map(|r| r.race.running_laps()).collect();
        let lane_step = dt / self.config.lane_change_s.max(1e-6);
        let roads = Roads {
            routes: &self.routes,
            steps: &self.steps,
            network: self.network.as_ref(),
        };
        let field = Field {
            routes: &self.routes,
            slots: &slots,
        };

        // The draft each vehicle gets from the gap ahead of its captain.
        let vehicle_drafts: Vec<(VehicleId, f64)> = self
            .vehicles
            .values()
            .filter_map(|v| {
                let me = slots.iter().find(|s| s.id == v.captain)?;
                let factor = field
                    .draft_ahead(me, me.lane)
                    .map_or(1.0, |(gap, ahead)| ahead.draft.cda_factor(gap));
                Some((v.id, factor))
            })
            .collect();

        for (rider, me) in self.riders.values_mut().zip(&own_slots) {
            let seated = self.seat_of.contains_key(&rider.id);
            let route = &self.routes[rider.route];
            let grade = roads.grade(rider);
            let race_distance = rider.race_distance();

            // 1. Decide power.
            match &mut rider.controller {
                Controller::Human {
                    seconds_since_telemetry,
                } => {
                    *seconds_since_telemetry += dt;
                    if *seconds_since_telemetry > self.config.telemetry_timeout_s {
                        rider.power = 0.0;
                        rider.cadence = None;
                    }
                }
                Controller::Bot(brain) => {
                    let distance_to_finish = match (race_laps[rider.route], race_distance) {
                        (Some(laps), Some(done)) if !rider.race_finished => {
                            Some(f64::from(laps) * route.length() - done)
                        }
                        _ => None,
                    };
                    let situation = BotSituation {
                        grade_percent: grade,
                        racing: distance_to_finish.is_some(),
                        group_ride: rider.in_group_ride,
                        distance_to_finish,
                    };
                    rider.power = brain.power(&situation, self.rng.as_mut(), dt);
                    rider.cadence = Some(85.0);

                    if !seated {
                        let view = field.lane_view(me);
                        if let Some(lane) = brain.choose_lane(&view, dt) {
                            rider.target_lane = lane;
                        }
                    }
                }
            }
            if seated {
                // Seats move with their vehicle, see `step_vehicles`.
                continue;
            }

            // 2. Physics with drafting.
            let ahead = if rider.parked {
                None
            } else {
                field.draft_ahead(me, me.lane)
            };
            let cda_factor = ahead.map_or(1.0, |(gap, ahead)| ahead.draft.cda_factor(gap));
            let power_watts = if rider.parked {
                0.0
            } else {
                (rider.power + rider.power_adjust).max(0.0)
            };
            let input = StepInput {
                rider_mass_kg: rider.mass_kg,
                body: Body::bike(&self.config.physics),
                speed: rider.speed,
                power_watts,
                grade_percent: grade,
                cda_factor,
            };
            rider.speed = physics::step_speed(&self.config.physics, &input, dt);
            // Keep off the wheel ahead; pull out to pass when strong enough to
            // ride faster than it even out of its draft.
            if let Some((gap, ahead)) = ahead {
                let spacing = &self.config.spacing;
                rider.speed = rider.speed.min(spacing.speed_limit(gap, ahead.speed));
                let settled = (rider.lane - f64::from(rider.target_lane)).abs() < 1e-9;
                let at_their_speed = StepInput {
                    speed: ahead.speed,
                    cda_factor: 1.0,
                    ..input
                };
                if settled
                    && gap < spacing.pass_look
                    && physics::acceleration(&self.config.physics, &at_their_speed) > spacing.pass_accel
                {
                    if let Some(lane) = field.passing_lane(me, spacing) {
                        rider.target_lane = lane;
                        if let Controller::Bot(brain) = &mut rider.controller {
                            brain.hold_lane();
                        }
                    }
                }
            }
            if rider.parked {
                // The brake holds a parked rider at a stop, even on a descent.
                rider.speed = (rider.speed - self.config.park_brake_mps2 * dt).max(0.0);
            }
            let advance = rider.speed * dt;
            roads.advance(rider, advance);
            rider.odometer += advance;

            // 3. Lane movement towards the target lane.
            let target = if rider.parked {
                f64::from(route.lanes().saturating_sub(1)) + self.config.park_lane_offset
            } else {
                f64::from(rider.target_lane)
            };
            let delta = (target - rider.lane).clamp(-lane_step, lane_step);
            rider.lane += delta;
        }

        self.step_vehicles(dt, &vehicle_drafts);

        for route in 0..self.routes.len() {
            self.update_race_progress(route);
        }
        self.balance_population();
    }

    fn slot(&self, rider: &Rider) -> Slot {
        let roads = self.roads();
        let road = roads.current(rider).map(|(key, offset)| {
            let next = rider.turn.or_else(|| roads.default_next(rider, key)).unwrap_or(key);
            let length = roads.length(rider, key);
            (Step { key, length }, offset, next)
        });
        let wide = self
            .vehicle_of(rider.id)
            .is_some_and(|v| v.captain == rider.id && matches!(v.kind, VehicleKind::BeerBike { .. }));
        let (half_width, draft) = match self.vehicle_of(rider.id).filter(|v| v.captain == rider.id) {
            Some(v) => (
                match v.kind {
                    VehicleKind::Tandem => self.config.draft.lane_tolerance,
                    VehicleKind::BeerBike { .. } => self.config.vehicles.beer_bike_lane_half_width,
                },
                self.config.vehicles.draft(v.kind, &self.config.draft),
            ),
            None => (self.config.draft.lane_tolerance, self.config.draft),
        };
        Slot {
            id: rider.id,
            route: rider.route,
            on_route: rider.off_route.is_none(),
            position: rider.position,
            lane: rider.lane,
            speed: rider.speed,
            half_width,
            wide,
            draft,
            road,
        }
    }

    /// `NotCaptain` for a seated rider who isn't their vehicle's captain.
    fn require_captain(&self, id: RiderId) -> Result<(), WorldError> {
        match self.vehicle_of(id) {
            Some(v) if v.captain != id => Err(WorldError::NotCaptain),
            _ => Ok(()),
        }
    }

    /// Puts the route's entrants on its start line; nobody else is moved. The
    /// race counts from the line, also for riders in the rows behind it.
    fn line_up_for_race(&mut self, route: RouteIndex) {
        let ids: Vec<RiderId> = self.races[route].entrants.iter().copied().collect();
        let behind = self.line_up(route, &ids);
        for rider in self.riders.values_mut().filter(|r| ids.contains(&r.id)) {
            rider.race_start_odometer = Some(rider.odometer + behind.get(&rider.id).copied().unwrap_or(0.0));
            rider.race_finished = false;
        }
    }

    /// Puts the given riders of route `route` on its start line, standing, in
    /// rows across the lanes (see [`SpacingParams::grid_slot`]). Others are not
    /// moved. Returns how far behind the line each rider stands.
    pub fn line_up(&mut self, route: RouteIndex, ids: &[RiderId]) -> BTreeMap<RiderId, f64> {
        let Some(route_ref) = self.routes.get(route) else {
            return BTreeMap::new();
        };
        let (lanes, length) = (route_ref.lanes(), route_ref.length());
        let lined_up = ids
            .iter()
            .filter_map(|id| self.riders.get(id).filter(|r| r.route == route).map(|r| r.id))
            .collect::<Vec<_>>();
        let mut behind = BTreeMap::new();
        for (index, id) in lined_up.into_iter().enumerate() {
            let (lane, back) = self.config.spacing.grid_slot(index, lanes);
            if let Some(rider) = self.riders.get_mut(&id) {
                rider.position = (-back).rem_euclid(length);
                rider.speed = 0.0;
                rider.lane = f64::from(lane);
                rider.target_lane = lane;
                behind.insert(id, back);
            }
        }
        behind
    }

    /// Puts a rider at `position` metres on its route's lap (a late joiner at the back).
    pub fn place_at(&mut self, id: RiderId, position: f64) {
        let Some(rider) = self.riders.get_mut(&id) else {
            return;
        };
        let length = self.routes[rider.route].length();
        rider.position = position.rem_euclid(length);
    }

    fn update_race_progress(&mut self, route: RouteIndex) {
        let state = &mut self.races[route];
        let Some(laps) = state.race.running_laps() else {
            return;
        };
        let race_length = f64::from(laps) * self.routes[route].length();

        let mut finishers: Vec<&mut Rider> = self
            .riders
            .values_mut()
            .filter(|r| r.route == route && !r.race_finished && r.race_distance().is_some_and(|d| d >= race_length))
            .collect();
        // Whoever is furthest past the line crossed it first within this tick.
        finishers.sort_by(|a, b| {
            b.race_distance()
                .unwrap_or(0.0)
                .total_cmp(&a.race_distance().unwrap_or(0.0))
        });
        for rider in finishers {
            rider.race_finished = true;
            if let Some(event) = state.race.record_finish(rider.id, &rider.name, rider.is_bot()) {
                self.events.push(WorldEvent::Race { route, event });
            }
        }

        let still_racing = self
            .riders
            .values()
            .any(|r| r.route == route && r.race_start_odometer.is_some() && !r.race_finished);
        if !still_racing {
            self.end_race(route);
        }
    }

    /// Completes the race of `route` (if running) and clears its race state.
    fn end_race(&mut self, route: RouteIndex) {
        let state = &mut self.races[route];
        if let Some(event) = state.race.complete() {
            self.events.push(WorldEvent::Race { route, event });
        }
        for rider in self.riders.values_mut().filter(|r| r.route == route) {
            rider.race_start_odometer = None;
            rider.race_finished = false;
        }
        state.entrants.clear();
    }

    /// Force-finishes the running race of `route`: whoever has not finished gets no result.
    pub fn complete_race(&mut self, route: RouteIndex) {
        if self.races.get(route).is_some_and(|s| s.race.running_laps().is_some()) {
            self.end_race(route);
        }
    }

    /// Puts a rider off their route without a road network (tests only).
    #[cfg(test)]
    pub(crate) fn force_off_route(&mut self, id: RiderId) {
        if let Some(rider) = self.riders.get_mut(&id) {
            rider.off_route = Some(OffRoute {
                road: (0, 1),
                offset: 0.0,
            });
        }
    }

    /// Reserves (or frees) a route for a scheduled event: manual races are refused meanwhile.
    pub fn reserve_route(&mut self, route: RouteIndex, reserved: bool) {
        if let Some(state) = self.races.get_mut(route) {
            state.reserved = reserved;
        }
    }

    /// Starts a race of `laps` laps on `route` at once with exactly `entrants`
    /// (riders of that route), replacing any manual race.
    pub fn start_scheduled_race(
        &mut self,
        route: RouteIndex,
        laps: u32,
        entrants: &[RiderId],
    ) -> Result<(), WorldError> {
        if route >= self.races.len() {
            return Err(WorldError::UnknownRoute(route));
        }
        // Validate before disturbing a manual race.
        let mut probe = self.races[route].race.clone();
        probe.abort();
        probe.start_now(laps).map_err(WorldError::Race)?;

        self.races[route].race.abort();
        self.end_race(route);
        let valid: BTreeSet<RiderId> = entrants
            .iter()
            .copied()
            .filter(|id| {
                self.riders
                    .get(id)
                    .is_some_and(|r| r.route == route && r.off_route.is_none())
            })
            .collect();
        for id in &valid {
            if let Some(rider) = self.riders.get_mut(id) {
                rider.turn = None;
            }
        }
        let state = &mut self.races[route];
        state.entrants = valid;
        let event = state.race.start_now(laps).map_err(WorldError::Race)?;
        self.line_up_for_race(route);
        self.events.push(WorldEvent::Race { route, event });
        Ok(())
    }

    /// Spawns `count` bots on `route` matched to `levels_wkg` (they stay while
    /// entered or in a group ride). Returns their ids.
    pub fn spawn_event_bots(&mut self, route: RouteIndex, count: usize, levels_wkg: &[f64]) -> Vec<RiderId> {
        if route >= self.routes.len() {
            return Vec::new();
        }
        (0..count).map(|_| self.spawn_bot_matched(route, levels_wkg)).collect()
    }

    pub fn set_group_ride(&mut self, id: RiderId, on: bool) {
        if let Some(rider) = self.riders.get_mut(&id) {
            rider.in_group_ride = on;
            if !on {
                rider.power_adjust = 0.0;
            }
        }
    }

    pub fn set_power_adjust(&mut self, id: RiderId, watts: f64) {
        if let Some(rider) = self.riders.get_mut(&id) {
            rider.power_adjust = watts;
        }
    }

    /// Locks or unlocks turning; locking drops a picked turn.
    pub fn lock_turns(&mut self, id: RiderId, locked: bool) {
        if let Some(rider) = self.riders.get_mut(&id) {
            rider.turns_locked = locked;
            if locked {
                rider.turn = None;
                rider.parked = rider.workout;
            }
        }
    }

    /// Keeps humans + bots at the target on every route: spawns bots where
    /// there are too few riders, removes surplus bots once no human is nearby.
    fn balance_population(&mut self) {
        for route in 0..self.routes.len() {
            // Seated riders (a vehicle's captain, humans and bots) are not population.
            let population = |world: &Self| {
                world
                    .riders
                    .values()
                    .filter(|r| r.route == route && !world.seat_of.contains_key(&r.id))
                    .count()
            };
            while population(self) < self.config.target_riders {
                self.spawn_bot(route);
            }
            while population(self) > self.config.target_riders {
                // Humans anywhere on the map: a bot on a shared road can be in someone's view.
                let humans: Vec<(f64, f64)> = self
                    .riders
                    .values()
                    .filter(|r| !r.is_bot())
                    .map(|r| self.rider_xy(r))
                    .collect();
                let entrants = &self.races[route].entrants;
                let candidate = self
                    .riders
                    .values()
                    .filter(|r| {
                        r.route == route
                            && r.is_bot()
                            && !r.in_group_ride
                            && !entrants.contains(&r.id)
                            && !self.seat_of.contains_key(&r.id)
                    })
                    .map(|bot| {
                        let at = self.rider_xy(bot);
                        let nearest = humans.iter().map(|&h| distance(h, at)).fold(f64::INFINITY, f64::min);
                        (bot.id, nearest)
                    })
                    .max_by(|a, b| a.1.total_cmp(&b.1));

                match candidate {
                    Some((id, distance)) if distance >= self.config.bot_despawn_distance_m => {
                        self.leave_without_rebalance(id);
                    }
                    _ => break,
                }
            }
        }
    }

    fn leave_without_rebalance(&mut self, id: RiderId) {
        if let Some(rider) = self.riders.remove(&id) {
            self.events.push(WorldEvent::RiderLeft {
                rider_id: id,
                name: rider.name,
                route: rider.route,
            });
        }
    }

    /// Candidate start points a new bot picks from: the one furthest from
    /// everybody, so bots spread over the map instead of piling up where
    /// routes share a road.
    const SPAWN_CANDIDATES: usize = 6;

    fn spawn_bot(&mut self, route: RouteIndex) {
        let levels = pack_levels(&self.human_levels());
        self.spawn_bot_matched(route, &levels);
    }

    fn spawn_bot_matched(&mut self, route: RouteIndex, levels: &[f64]) -> RiderId {
        let id = self.allocate_id();
        let taken: Vec<&str> = self.riders.values().map(|r| r.name.as_str()).collect();
        let name = names::generate_unique(self.rng.as_mut(), &taken);
        let profile = BotProfile::matched(levels, self.rng.as_mut());
        let lanes = self.routes[route].lanes();
        let lane = self.rng.index(usize::from(lanes)) as u8;
        let length = self.routes[route].length();
        let others: Vec<(f64, f64)> = self.riders.values().map(|r| self.rider_xy(r)).collect();
        let mut position = self.rng.range_f64(0.0, length);
        let mut best = f64::NEG_INFINITY;
        for _ in 0..Self::SPAWN_CANDIDATES {
            let candidate = self.rng.range_f64(0.0, length);
            let at = self.routes[route].position_at(candidate);
            let room = others.iter().map(|&o| distance(o, at)).fold(f64::INFINITY, f64::min);
            if room > best {
                best = room;
                position = candidate;
            }
        }
        let mass_kg = profile.weight_kg;
        let cruising_speed = 8.0;

        self.riders.insert(
            id,
            Rider {
                id,
                name: name.clone(),
                controller: Controller::Bot(Box::new(BotBrain::new(profile, self.config.bot_tuning))),
                mass_kg,
                route,
                position,
                odometer: 0.0,
                lane: f64::from(lane),
                target_lane: lane,
                speed: cruising_speed,
                power: 0.0,
                cadence: None,
                race_start_odometer: None,
                race_finished: false,
                off_route: None,
                turn: None,
                level_wkg: None,
                in_group_ride: false,
                power_adjust: 0.0,
                turns_locked: false,
                parked: false,
                workout: false,
            },
        );
        self.events.push(WorldEvent::RiderJoined {
            rider_id: id,
            name,
            is_bot: true,
            route,
        });
        id
    }

    fn allocate_id(&mut self) -> RiderId {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        id
    }
}

fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

/// The roads riders ride: their routes' walks and the network beneath.
struct Roads<'a> {
    routes: &'a [Route],
    steps: &'a [Vec<Step>],
    network: Option<&'a Network>,
}

impl Roads<'_> {
    /// The road under the rider and the metres into it, if known.
    fn current(&self, rider: &Rider) -> Option<(RoadKey, f64)> {
        if let Some(off) = rider.off_route {
            return Some((off.road, off.offset));
        }
        let at = self.routes[rider.route].edge_at(rider.position)?;
        Some((self.steps[rider.route][at.step].key, at.offset))
    }

    /// The length of road `key` as the rider measures it.
    fn length(&self, rider: &Rider, key: RoadKey) -> f64 {
        match (rider.off_route, self.network) {
            (Some(_), Some(network)) => network.edge(key.0).length(),
            _ => self.routes[rider.route]
                .edge_at(rider.position)
                .map_or(0.0, |at| self.routes[rider.route].walk()[at.step].length),
        }
    }

    /// The road after `key` without a pick: the route's next, straight on off it.
    fn default_next(&self, rider: &Rider, key: RoadKey) -> Option<RoadKey> {
        if rider.off_route.is_some() {
            return self.network.map(|network| network.straight_on(key));
        }
        let steps = &self.steps[rider.route];
        let at = self.routes[rider.route].edge_at(rider.position)?;
        Some(steps[(at.step + 1) % steps.len()].key)
    }

    fn xy(&self, rider: &Rider) -> (f64, f64) {
        match (rider.off_route, self.network) {
            (Some(off), Some(network)) => network.position(off.road, off.offset),
            _ => self.routes[rider.route].position_at(rider.position),
        }
    }

    fn grade(&self, rider: &Rider) -> f64 {
        match (rider.off_route, self.network) {
            (Some(off), Some(network)) => network.grade(off.road, off.offset),
            _ => self.routes[rider.route].grade_at(rider.position),
        }
    }

    /// Moves the rider `advance` metres on, turning at a junction where they
    /// picked another road.
    fn advance(&self, rider: &mut Rider, advance: f64) {
        let Some(network) = self.network else {
            let route = &self.routes[rider.route];
            rider.position = route.wrap(rider.position + advance);
            return;
        };
        if let Some(mut off) = rider.off_route {
            rider.position += advance;
            off.offset += advance;
            rider.off_route = Some(off);
            let length = network.edge(off.road.0).length();
            if off.offset >= length {
                let next = rider.turn.take().unwrap_or_else(|| network.straight_on(off.road));
                self.enter(rider, next, off.offset - length);
            }
            return;
        }
        let route = &self.routes[rider.route];
        let before = route.edge_at(rider.position).map(|at| at.step);
        rider.position = route.wrap(rider.position + advance);
        let Some(after) = route.edge_at(rider.position) else {
            return;
        };
        if before == Some(after.step) {
            return;
        }
        // Over a junction: onto the picked road, if it isn't the route's.
        let picked = rider.turn.take();
        let planned = self.steps[rider.route][after.step].key;
        if let Some(next) = picked.filter(|&next| next != planned && (next.0 as usize) < network.len()) {
            self.enter(rider, next, after.offset);
        }
    }

    /// Puts the rider `offset` metres into road `key`: on a route that rides
    /// it that way (their own first), else off-route.
    fn enter(&self, rider: &mut Rider, key: RoadKey, offset: f64) {
        let candidates = std::iter::once(rider.route).chain(0..self.routes.len());
        for route in candidates {
            let Some(step) = self.steps[route].iter().position(|s| s.key == key) else {
                continue;
            };
            let walk = &self.routes[route].walk()[step];
            rider.route = route;
            rider.position = walk.from + (offset / walk.length).clamp(0.0, 1.0) * (walk.to - walk.from);
            rider.off_route = None;
            return;
        }
        if rider.off_route.is_none() {
            rider.position = offset;
        }
        rider.off_route = Some(OffRoute { road: key, offset });
    }
}

/// Everybody's position before the step, to find who rides ahead of whom.
struct Field<'a> {
    routes: &'a [Route],
    slots: &'a [Slot],
}

/// Whether `s` rides in `lane` as `me` sees it. Plain riders keep the strict
/// rule; only a beer bike's width reaches a whole lane over.
fn in_lane(me: &Slot, s: &Slot, lane: f64) -> bool {
    let offset = (s.lane - lane).abs();
    let reach = s.half_width.max(me.half_width);
    if s.wide || me.wide {
        offset <= reach + 1e-9
    } else {
        offset < reach
    }
}

impl Field<'_> {
    /// Gap to the closest rider ahead of `me` in `lane`, if any: on the same
    /// route along it, or on another route where both ride the same road the
    /// same way (on that road, or on the road `me` turns onto next).
    fn gap_ahead(&self, me: &Slot, lane: f64) -> Option<f64> {
        self.draft_ahead(me, lane).map(|(gap, _)| gap)
    }

    /// The closest rider ahead of `me` in `lane` and the gap to them.
    fn draft_ahead(&self, me: &Slot, lane: f64) -> Option<(f64, &Slot)> {
        self.slots
            .iter()
            .filter(|s| s.id != me.id && in_lane(me, s, lane))
            .filter_map(|s| self.gap_to(me, s).filter(|&gap| gap > 0.0).map(|gap| (gap, s)))
            .min_by(|a, b| a.0.total_cmp(&b.0))
    }

    /// Signed gap from `me` to `s` (negative: `s` is behind): on the same
    /// route along it, or on another route where both ride the same road the
    /// same way (on that road, or on the road `me` turns onto next).
    fn gap_to(&self, me: &Slot, s: &Slot) -> Option<f64> {
        if s.route == me.route && s.on_route && me.on_route {
            let route = &self.routes[me.route];
            let gap = route.forward_gap(me.position, s.position);
            return Some(if gap < route.length() / 2.0 {
                gap
            } else {
                gap - route.length()
            });
        }
        let ((step, offset, next), (theirs, their_offset, _)) = (me.road?, s.road?);
        if theirs.key == step.key {
            Some(their_offset - offset)
        } else if theirs.key == next {
            Some(step.length - offset + their_offset)
        } else {
            None
        }
    }

    /// A neighbouring lane to pull out into, the left one first: nobody in or
    /// moving through it from `min_gap` behind `me` to `pass_look` ahead.
    fn passing_lane(&self, me: &Slot, spacing: &SpacingParams) -> Option<u8> {
        let lanes = f64::from(self.routes[me.route].lanes());
        let current = me.lane.round();
        [current - 1.0, current + 1.0]
            .into_iter()
            .filter(|&lane| (0.0..lanes).contains(&lane))
            .find(|&lane| {
                !self.slots.iter().any(|s| {
                    s.id != me.id
                        && (s.lane - lane).abs() < s.half_width.max(me.half_width) + 0.5
                        && self
                            .gap_to(me, s)
                            .is_some_and(|gap| gap > -spacing.min_gap && gap < spacing.pass_look)
                })
            })
            .map(|lane| lane as u8)
    }

    fn lane_view(&self, me: &Slot) -> LaneView {
        let lanes = self.routes[me.route].lanes();
        LaneView {
            current_lane: me.lane.round().clamp(0.0, f64::from(lanes - 1)) as u8,
            gap_ahead: (0..lanes).map(|l| self.gap_ahead(me, f64::from(l))).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::SplitMix64;
    use crate::route::tests::{flat_loop, square_loop, step};
    use crate::route::{Point, RouteSpec, WalkStep};

    pub(super) const DT: f64 = 0.05;

    pub(super) fn world_with(route: Route, config: SimConfig) -> World {
        World::new(route, config, Box::new(SplitMix64::new(1234)))
    }

    pub(super) fn empty_world(route: Route) -> World {
        world_with(
            route,
            SimConfig {
                target_riders: 0,
                ..SimConfig::default()
            },
        )
    }

    pub(super) fn ride(world: &mut World, seconds: f64, riders: &[(RiderId, f64)]) {
        let steps = (seconds / DT).round() as usize;
        for _ in 0..steps {
            for &(id, power) in riders {
                world.set_telemetry(id, power, Some(90.0)).unwrap();
            }
            world.tick(DT);
        }
    }

    #[test]
    fn a_new_world_is_filled_with_bots() {
        let world = world_with(square_loop(), SimConfig::default());
        assert_eq!(world.riders().count(), 12);
        assert!(world.riders().all(Rider::is_bot));
    }

    fn bot_profiles(world: &World) -> std::collections::BTreeMap<RiderId, f64> {
        world
            .riders()
            .filter_map(|r| match &r.controller {
                Controller::Bot(brain) => Some((r.id, brain.profile().ftp_wkg)),
                Controller::Human { .. } => None,
            })
            .collect()
    }

    fn world_with_leveled_human(level: f64) -> (World, RiderId) {
        let mut world = world_with(square_loop(), SimConfig::default());
        let human = world.join_human_on(0, "Anna", 70.0).unwrap();
        world.set_level(human, level).unwrap();
        (world, human)
    }

    #[test]
    fn new_bots_match_the_humans() {
        let (mut world, _) = world_with_leveled_human(2.0);
        let mut known = bot_profiles(&world);
        let mut spawned = Vec::new();
        for _ in 0..60 {
            let leaving = *known.keys().next().unwrap();
            assert!(world.leave(leaving));
            known.remove(&leaving);
            for (id, ftp) in bot_profiles(&world) {
                if let std::collections::btree_map::Entry::Vacant(e) = known.entry(id) {
                    e.insert(ftp);
                    spawned.push(ftp);
                }
            }
        }
        assert_eq!(spawned.len(), 60);
        let near = spawned.iter().filter(|w| (1.9..=2.2).contains(*w)).count();
        assert!(near as f64 >= 0.6 * 60.0, "{near} of 60 near the human");
    }

    #[test]
    fn existing_bots_keep_their_profile() {
        let mut world = world_with(square_loop(), SimConfig::default());
        let human = world.join_human_on(0, "Anna", 70.0).unwrap();
        let before = bot_profiles(&world);
        world.set_level(human, 6.0).unwrap();
        let after = bot_profiles(&world);
        assert_eq!(before, after);
    }

    #[test]
    fn levels_belong_to_humans() {
        let mut world = world_with(square_loop(), SimConfig::default());
        let bot = world.riders().next().unwrap().id;
        assert_eq!(world.set_level(bot, 3.0), Err(WorldError::NotHuman(bot)));
        assert_eq!(world.set_level(9999, 3.0), Err(WorldError::UnknownRider(9999)));
    }

    #[test]
    fn bot_names_are_unique() {
        let world = world_with(square_loop(), SimConfig::default());
        let mut names: Vec<&str> = world.riders().map(|r| r.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), 12);
    }

    #[test]
    fn bots_ride_on_their_own() {
        let mut world = world_with(square_loop(), SimConfig::default());
        let before: f64 = world.riders().map(|r| r.odometer).sum();
        for _ in 0..200 {
            world.tick(DT);
        }
        let after: f64 = world.riders().map(|r| r.odometer).sum();
        assert!(after > before + 100.0);
    }

    #[test]
    fn joining_humans_replace_far_away_bots() {
        let config = SimConfig {
            target_riders: 3,
            bot_despawn_distance_m: 0.0,
            ..SimConfig::default()
        };
        let mut world = world_with(square_loop(), config);
        let id = world.join_human("Anna", 70.0);
        assert_eq!(world.riders().count(), 3);
        assert_eq!(world.human_count(), 1);
        assert!(!world.rider(id).unwrap().is_bot());
    }

    #[test]
    fn surplus_bots_wait_while_a_human_is_close() {
        let config = SimConfig {
            target_riders: 1,
            bot_despawn_distance_m: 10_000.0,
            ..SimConfig::default()
        };
        let mut world = world_with(square_loop(), config);
        world.join_human("Anna", 70.0);
        assert_eq!(world.riders().count(), 2, "bot is still in sight and stays");
    }

    #[test]
    fn leaving_humans_are_replaced_by_bots() {
        let config = SimConfig {
            target_riders: 2,
            bot_despawn_distance_m: 0.0,
            ..SimConfig::default()
        };
        let mut world = world_with(square_loop(), config);
        let id = world.join_human("Anna", 70.0);
        assert!(world.leave(id));
        assert_eq!(world.bot_count(), 2);
        assert!(!world.leave(id));
    }

    #[test]
    fn join_and_leave_produce_events() {
        let mut world = empty_world(square_loop());
        let id = world.join_human("Anna", 70.0);
        world.leave(id);
        let events = world.drain_events();
        assert_eq!(
            events,
            vec![
                WorldEvent::RiderJoined {
                    rider_id: id,
                    name: "Anna".into(),
                    is_bot: false,
                    route: 0,
                },
                WorldEvent::RiderLeft {
                    rider_id: id,
                    name: "Anna".into(),
                    route: 0,
                },
            ]
        );
        assert!(world.drain_events().is_empty());
    }

    #[test]
    fn human_power_moves_the_rider() {
        let mut world = empty_world(flat_loop(10_000.0));
        let id = world.join_human("Anna", 75.0);
        ride(&mut world, 60.0, &[(id, 200.0)]);
        let rider = world.rider(id).unwrap();
        assert!(rider.speed > 8.0, "speed {}", rider.speed);
        assert!(rider.odometer > 300.0);
    }

    #[test]
    fn telemetry_is_sanitised() {
        let mut world = empty_world(square_loop());
        let id = world.join_human("Anna", 75.0);
        world.set_telemetry(id, -50.0, Some(f64::NAN)).unwrap();
        assert_eq!(world.rider(id).unwrap().power, 0.0);
        assert_eq!(world.rider(id).unwrap().cadence, None);
        world.set_telemetry(id, 99_999.0, None).unwrap();
        assert_eq!(world.rider(id).unwrap().power, 2500.0);
        assert_eq!(
            world.set_telemetry(999, 100.0, None),
            Err(WorldError::UnknownRider(999))
        );
    }

    #[test]
    fn stale_telemetry_stops_pedalling() {
        let mut world = empty_world(flat_loop(10_000.0));
        let id = world.join_human("Anna", 75.0);
        ride(&mut world, 30.0, &[(id, 250.0)]);
        for _ in 0..(5.0 / DT) as usize {
            world.tick(DT);
        }
        assert_eq!(world.rider(id).unwrap().power, 0.0);
    }

    #[test]
    fn drafting_rider_closes_the_gap_at_equal_power() {
        let mut world = empty_world(flat_loop(10_000.0));
        let leader = world.join_human("Leader", 75.0);
        let follower = world.join_human("Follower", 75.0);
        // Get both up to speed side by side, then put the follower 3 m behind.
        world.shift_lane(follower, 1).unwrap();
        ride(&mut world, 60.0, &[(leader, 200.0), (follower, 200.0)]);
        world.riders.get_mut(&follower).unwrap().position = world.rider(leader).unwrap().position - 3.0;
        world.shift_lane(follower, -1).unwrap();
        world.riders.get_mut(&follower).unwrap().lane = world.rider(leader).unwrap().lane;
        ride(&mut world, 10.0, &[(leader, 200.0), (follower, 200.0)]);

        let gap = world.route(0).forward_gap(
            world.rider(follower).unwrap().position,
            world.rider(leader).unwrap().position,
        );
        assert!(gap < 3.0, "gap should shrink in the draft, was {gap}");
    }

    /// Puts a rider in `lane` at `position`, already riding at `speed`.
    fn put(world: &mut World, id: RiderId, position: f64, lane: u8, speed: f64) {
        let rider = world.riders.get_mut(&id).unwrap();
        rider.position = position;
        rider.speed = speed;
        rider.lane = f64::from(lane);
        rider.target_lane = lane;
    }

    /// Signed gap from `from` to `to` along the loop (negative = `to` is behind).
    fn gap_between(world: &World, from: RiderId, to: RiderId) -> f64 {
        let route = world.route(0);
        let gap = route.forward_gap(world.rider(from).unwrap().position, world.rider(to).unwrap().position);
        if gap > route.length() / 2.0 {
            gap - route.length()
        } else {
            gap
        }
    }

    /// Rides like `ride`; returns the smallest distance between the two riders while they share a lane.
    fn closest_in_lane(world: &mut World, seconds: f64, riders: &[(RiderId, f64)], a: RiderId, b: RiderId) -> f64 {
        let mut closest = f64::INFINITY;
        for _ in 0..(seconds / DT).round() as usize {
            for &(id, power) in riders {
                world.set_telemetry(id, power, Some(90.0)).unwrap();
            }
            world.tick(DT);
            if (world.rider(a).unwrap().lane - world.rider(b).unwrap().lane).abs() < 0.5 {
                closest = closest.min(gap_between(world, a, b).abs());
            }
        }
        closest
    }

    #[test]
    fn a_rider_closing_in_sits_on_the_wheel_instead_of_riding_through() {
        let mut world = empty_world(flat_loop(10_000.0));
        let leader = world.join_human("Leader", 75.0);
        let follower = world.join_human("Follower", 75.0);
        put(&mut world, leader, 106.0, 1, 10.0);
        put(&mut world, follower, 100.0, 1, 10.0);

        let riders = [(leader, 200.0), (follower, 200.0)];
        let closest = closest_in_lane(&mut world, 30.0, &riders, follower, leader);

        let gap = gap_between(&world, follower, leader);
        let min_gap = SpacingParams::default().min_gap;
        assert!(
            closest > min_gap - 0.1,
            "never closer than a bike length, came to {closest}"
        );
        assert!(gap < min_gap + 0.5, "closed in on the wheel, gap {gap}");
    }

    #[test]
    fn a_much_stronger_rider_pulls_out_and_passes() {
        let mut world = empty_world(flat_loop(10_000.0));
        let leader = world.join_human("Leader", 75.0);
        let follower = world.join_human("Follower", 75.0);
        put(&mut world, leader, 106.0, 1, 9.0);
        put(&mut world, follower, 100.0, 1, 9.0);

        let riders = [(leader, 150.0), (follower, 400.0)];
        let closest = closest_in_lane(&mut world, 30.0, &riders, follower, leader);

        assert!(
            closest > SpacingParams::default().min_gap - 0.1,
            "passed beside, not through: {closest}"
        );
        assert!(gap_between(&world, leader, follower) > 10.0, "went past");
    }

    #[test]
    fn with_both_neighbouring_lanes_taken_a_stronger_rider_waits_behind() {
        let mut world = empty_world(flat_loop(10_000.0));
        let leader = world.join_human("Leader", 75.0);
        let follower = world.join_human("Follower", 75.0);
        let left = world.join_human("Left", 75.0);
        let right = world.join_human("Right", 75.0);
        put(&mut world, leader, 103.0, 1, 9.0);
        put(&mut world, follower, 100.0, 1, 9.0);
        put(&mut world, left, 100.5, 0, 9.0);
        put(&mut world, right, 100.5, 2, 9.0);

        let riders = [(leader, 150.0), (follower, 400.0), (left, 150.0), (right, 150.0)];
        let closest = closest_in_lane(&mut world, 20.0, &riders, follower, leader);

        assert!(
            closest > SpacingParams::default().min_gap - 0.1,
            "stayed off the wheel ahead: {closest}"
        );
        assert_eq!(world.rider(follower).unwrap().target_lane, 1, "nowhere to pull out to");
        assert!(gap_between(&world, follower, leader) > 0.0, "still behind");
    }

    #[test]
    fn a_line_up_puts_the_riders_in_rows_behind_the_line() {
        let mut world = empty_world(flat_loop(10_000.0));
        let ids: Vec<RiderId> = (0..6).map(|i| world.join_human(&format!("R{i}"), 75.0)).collect();

        let behind = world.line_up(0, &ids);

        let length = world.route(0).length();
        let spots: Vec<(f64, f64, f64)> = ids
            .iter()
            .map(|id| {
                let r = world.rider(*id).unwrap();
                (r.lane, (length - r.position) % length, behind[id])
            })
            .collect();
        assert_eq!(
            spots,
            vec![
                (0.0, 0.0, 0.0),
                (1.0, 0.0, 0.0),
                (2.0, 0.0, 0.0),
                (3.0, 0.0, 0.0),
                (0.0, 2.5, 2.5),
                (1.0, 2.5, 2.5)
            ]
        );
    }

    #[test]
    fn a_race_counts_from_the_line_also_for_the_back_rows() {
        let mut world = empty_world(flat_loop(10_000.0));
        let ids: Vec<RiderId> = (0..6).map(|i| world.join_human(&format!("R{i}"), 75.0)).collect();

        world.start_scheduled_race(0, 1, &ids).unwrap();

        assert_eq!(world.rider(ids[0]).unwrap().race_distance(), Some(0.0));
        assert_eq!(world.rider(ids[5]).unwrap().race_distance(), Some(-2.5));
    }

    #[test]
    fn lane_changes_take_about_a_second() {
        let mut world = empty_world(square_loop());
        let id = world.join_human("Anna", 70.0);
        let start = world.rider(id).unwrap().lane;
        world.shift_lane(id, 1).unwrap();
        world.tick(0.5);
        assert!((world.rider(id).unwrap().lane - (start + 0.5)).abs() < 1e-9);
        world.tick(0.5);
        assert!((world.rider(id).unwrap().lane - (start + 1.0)).abs() < 1e-9);
    }

    #[test]
    fn lanes_are_clamped_to_the_road() {
        let mut world = empty_world(square_loop());
        let id = world.join_human("Anna", 70.0);
        for _ in 0..10 {
            world.shift_lane(id, -1).unwrap();
        }
        assert_eq!(world.rider(id).unwrap().target_lane, 0);
        for _ in 0..10 {
            world.shift_lane(id, 1).unwrap();
        }
        assert_eq!(world.rider(id).unwrap().target_lane, 3);
    }

    /// 100 m on the square loop's descent (-4 %, 750..1000 m), in the rightmost lane.
    fn parked_on_a_descent(speed: f64) -> (World, RiderId) {
        let mut world = empty_world(square_loop());
        let id = world.join_human("Anna", 70.0);
        let rider = world.riders.get_mut(&id).unwrap();
        rider.position = 850.0;
        rider.speed = speed;
        (world, id)
    }

    #[test]
    fn a_parked_rider_brakes_to_a_stop_on_a_descent() {
        let (mut world, id) = parked_on_a_descent(10.0);
        assert!(world.grade_for(id).unwrap() < -1.0);
        world.park(id).unwrap();
        ride(&mut world, 10.0, &[(id, 0.0)]);
        assert_eq!(world.rider(id).unwrap().speed, 0.0);
        let stopped_at = world.rider(id).unwrap().position;
        ride(&mut world, 10.0, &[(id, 0.0)]);
        assert_eq!(world.rider(id).unwrap().speed, 0.0);
        assert_eq!(world.rider(id).unwrap().position, stopped_at);
    }

    #[test]
    fn power_is_ignored_while_parked() {
        let mut world = empty_world(flat_loop(2000.0));
        let id = world.join_human("Anna", 70.0);
        world.park(id).unwrap();
        ride(&mut world, 5.0, &[(id, 300.0)]);
        assert_eq!(world.rider(id).unwrap().speed, 0.0);
        world.unpark(id).unwrap();
        ride(&mut world, 5.0, &[(id, 300.0)]);
        assert!(world.rider(id).unwrap().speed > 1.0);
    }

    #[test]
    fn a_parked_rider_moves_onto_the_shoulder_and_back() {
        let mut world = empty_world(flat_loop(2000.0));
        let id = world.join_human("Anna", 70.0);
        world.park(id).unwrap();
        ride(&mut world, 3.0, &[(id, 0.0)]);
        assert!((world.rider(id).unwrap().lane - 3.7).abs() < 1e-9);
        world.unpark(id).unwrap();
        ride(&mut world, 3.0, &[(id, 0.0)]);
        let rider = world.rider(id).unwrap();
        assert!((rider.lane - f64::from(rider.target_lane)).abs() < 1e-9);
    }

    #[test]
    fn unparking_merges_back_into_the_rightmost_lane() {
        let mut world = empty_world(flat_loop(2000.0));
        let id = world.join_human("Anna", 70.0);
        world.riders.get_mut(&id).unwrap().target_lane = 0;
        world.park(id).unwrap();
        world.unpark(id).unwrap();
        assert_eq!(world.rider(id).unwrap().target_lane, 3);
    }

    #[test]
    fn nobody_drafts_behind_a_parked_rider() {
        let follower_speed = |parked_ahead: bool| {
            let mut world = empty_world(flat_loop(2000.0));
            let follower = world.join_human("Bea", 70.0);
            if parked_ahead {
                let ahead = world.join_human("Anna", 70.0);
                world.place_at(ahead, 2.0);
                world.park(ahead).unwrap();
                // Same lane as the follower, as if just parked.
                world.riders.get_mut(&ahead).unwrap().lane = world.riders[&follower].lane;
            }
            ride(&mut world, 5.0, &[(follower, 250.0)]);
            world.rider(follower).unwrap().speed
        };
        // With a parked rider 2 m ahead the follower rides exactly as if alone.
        assert_eq!(follower_speed(true), follower_speed(false));
    }

    #[test]
    fn park_is_rejected_in_a_race_an_event_and_a_vehicle() {
        let mut world = empty_world(flat_loop(2000.0));
        let racer = world.join_human("Anna", 70.0);
        world.start_race(1, None).unwrap();
        world.join_race(racer).unwrap();
        assert_eq!(world.park(racer), Err(WorldError::PauseRejected));

        let eventer = world.join_human("Bea", 70.0);
        world.lock_turns(eventer, true);
        assert_eq!(world.park(eventer), Err(WorldError::PauseRejected));

        let mut world = empty_world(flat_loop(2000.0));
        let captain = world.join_human("Cy", 70.0);
        world
            .create_vehicle(captain, VehicleKind::Tandem, false, &|_| false)
            .unwrap();
        assert_eq!(world.park(captain), Err(WorldError::PauseRejected));
        assert_eq!(world.park(9999), Err(WorldError::UnknownRider(9999)));
    }

    #[test]
    fn joining_a_race_or_event_unparks() {
        let mut world = empty_world(flat_loop(2000.0));
        let racer = world.join_human("Anna", 70.0);
        world.park(racer).unwrap();
        world.start_race(1, None).unwrap();
        world.join_race(racer).unwrap();
        assert!(!world.rider(racer).unwrap().parked);

        let eventer = world.join_human("Bea", 70.0);
        world.park(eventer).unwrap();
        world.lock_turns(eventer, true);
        assert!(!world.rider(eventer).unwrap().parked);
    }

    #[test]
    fn a_workout_rider_is_parked_and_stays_parked() {
        let mut world = empty_world(flat_loop(2000.0));
        let id = world.join_human("Anna", 70.0);
        let start = world.rider(id).unwrap().position;
        world.start_workout(id).unwrap();
        world.unpark(id).unwrap();
        ride(&mut world, 5.0, &[(id, 300.0)]);
        let rider = world.rider(id).unwrap();
        assert!(rider.parked);
        assert_eq!(rider.speed, 0.0);
        assert_eq!(rider.position, start);
    }

    #[test]
    fn workout_riders_are_not_counted_as_humans() {
        let mut world = empty_world(flat_loop(2000.0));
        world.join_human("Anna", 70.0);
        let ben = world.join_human("Ben", 70.0);
        world.start_workout(ben).unwrap();
        assert_eq!(world.count_on(0).0, 1);
    }

    #[test]
    fn a_race_started_by_another_rider_leaves_a_workout_rider_alone() {
        let mut world = empty_world(flat_loop(2000.0));
        let anna = world.join_human("Anna", 70.0);
        let ben = world.join_human("Ben", 70.0);
        world.start_workout(anna).unwrap();
        world.start_race(1, Some(ben)).unwrap();
        assert!(!world.is_entered(anna));
        assert!(world.rider(anna).unwrap().parked);
        assert_eq!(world.join_race(anna), Err(WorldError::InEvent));
        assert!(!world.is_entered(anna));
        assert!(world.rider(anna).unwrap().parked);
    }

    #[test]
    fn a_workout_rider_cannot_start_a_race_or_be_unparked_by_an_event() {
        let mut world = empty_world(flat_loop(2000.0));
        let anna = world.join_human("Anna", 70.0);
        world.start_workout(anna).unwrap();
        assert_eq!(world.start_race(1, Some(anna)), Err(WorldError::InEvent));
        world.lock_turns(anna, true);
        assert!(world.rider(anna).unwrap().parked);
    }

    #[test]
    fn start_workout_is_rejected_in_a_race() {
        let mut world = empty_world(flat_loop(2000.0));
        let anna = world.join_human("Anna", 70.0);
        world.start_race(1, None).unwrap();
        world.join_race(anna).unwrap();
        assert_eq!(world.start_workout(anna), Err(WorldError::PauseRejected));
        assert!(!world.rider(anna).unwrap().workout);
    }

    #[test]
    fn grade_follows_the_route() {
        let mut world = empty_world(square_loop());
        let id = world.join_human("Anna", 70.0);
        world.riders.get_mut(&id).unwrap().position = 100.0;
        assert_eq!(world.grade_for(id), Some(0.0));
        world.riders.get_mut(&id).unwrap().position = 300.0;
        assert!((world.grade_for(id).unwrap() - 4.0).abs() < 1e-9);
    }

    #[test]
    fn a_full_race_produces_ordered_results() {
        let config = SimConfig {
            target_riders: 0,
            race_countdown_s: 1.0,
            ..SimConfig::default()
        };
        let mut world = world_with(flat_loop(1000.0), config);
        let strong = world.join_human("Strong", 70.0);
        let weak = world.join_human("Weak", 70.0);
        world.riders.get_mut(&strong).unwrap().position = 500.0;
        world.start_race(1, Some(strong)).unwrap();
        world.join_race(weak).unwrap();
        world.drain_events();

        ride(&mut world, 1.0, &[(strong, 300.0), (weak, 150.0)]);
        assert_eq!(
            world.rider(strong).unwrap().position,
            world.rider(strong).unwrap().speed * DT
        );
        assert!(matches!(world.race(0).phase(), RacePhase::Running { .. }));

        ride(&mut world, 300.0, &[(strong, 300.0), (weak, 150.0)]);
        assert!(matches!(world.race(0).phase(), RacePhase::Finished { laps: 1 }));
        let results: Vec<&str> = world.race(0).results().iter().map(|r| r.name.as_str()).collect();
        assert_eq!(results, vec!["Strong", "Weak"]);
        assert!(world.race(0).results()[0].time_s < world.race(0).results()[1].time_s);

        let events = world.drain_events();
        assert!(events.contains(&WorldEvent::Race {
            route: 0,
            event: RaceEvent::Started { laps: 1 }
        }));
        assert!(events.contains(&WorldEvent::Race {
            route: 0,
            event: RaceEvent::Finished
        }));
        assert!(world.riders().all(|r| r.race_start_odometer.is_none()));
    }

    #[test]
    fn bots_race_too_and_are_marked_in_results() {
        let config = SimConfig {
            target_riders: 3,
            race_countdown_s: 0.0,
            bot_race_share: 1.0,
            ..SimConfig::default()
        };
        let mut world = world_with(flat_loop(1000.0), config);
        world.start_race(1, None).unwrap();
        for _ in 0..(400.0 / DT) as usize {
            world.tick(DT);
        }
        assert_eq!(world.race(0).results().len(), 3);
        assert!(world.race(0).results().iter().all(|r| r.is_bot));
    }

    #[test]
    fn riders_joining_mid_race_do_not_take_part() {
        let config = SimConfig {
            target_riders: 0,
            race_countdown_s: 0.0,
            ..SimConfig::default()
        };
        let mut world = world_with(flat_loop(1000.0), config);
        let early = world.join_human("Early", 70.0);
        world.start_race(1, Some(early)).unwrap();
        world.tick(DT);
        let late = world.join_human("Late", 70.0);
        ride(&mut world, 200.0, &[(early, 300.0), (late, 300.0)]);
        let names: Vec<&str> = world.race(0).results().iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["Early"]);
    }

    #[test]
    fn same_seed_gives_the_same_world() {
        let run = || {
            let mut world = world_with(square_loop(), SimConfig::default());
            for _ in 0..500 {
                world.tick(DT);
            }
            world.riders().map(|r| (r.name.clone(), r.position)).collect::<Vec<_>>()
        };
        assert_eq!(run(), run());
    }

    #[test]
    fn only_entrants_race_and_everyone_else_keeps_riding() {
        let config = SimConfig {
            target_riders: 0,
            race_countdown_s: 1.0,
            ..SimConfig::default()
        };
        let mut world = world_with(flat_loop(1000.0), config);
        let racer = world.join_human("Racer", 70.0);
        let tourist = world.join_human("Tourist", 70.0);
        let late = world.join_human("Late", 70.0);
        world.riders.get_mut(&tourist).unwrap().position = 400.0;
        world.start_race(1, Some(racer)).unwrap();
        assert!(world.is_entered(racer));
        assert!(!world.is_entered(tourist));
        world.join_race(late).unwrap();

        ride(&mut world, 1.0, &[(racer, 200.0), (tourist, 200.0), (late, 200.0)]);
        assert!(matches!(world.race(0).phase(), RacePhase::Running { .. }));
        assert!(world.rider(racer).unwrap().race_start_odometer.is_some());
        assert!(world.rider(late).unwrap().race_start_odometer.is_some());
        assert!(
            world.rider(tourist).unwrap().race_start_odometer.is_none(),
            "not dragged into the race"
        );
        assert!(
            world.rider(tourist).unwrap().position > 400.0,
            "not moved to the start line"
        );
        assert_eq!(
            world.join_race(tourist),
            Err(WorldError::Race(RaceError::NotOpen)),
            "the field closes at the start"
        );

        // Withdrawing mid-race: no result; the race ends with the remaining racer.
        world.leave_race(late);
        assert!(world.rider(late).unwrap().race_start_odometer.is_none());
        ride(&mut world, 300.0, &[(racer, 300.0), (tourist, 200.0), (late, 200.0)]);
        let results: Vec<&str> = world.race(0).results().iter().map(|r| r.name.as_str()).collect();
        assert_eq!(results, vec!["Racer"]);
        assert!(matches!(world.race(0).phase(), RacePhase::Finished { .. }));
        assert_eq!(world.entrants(0).count(), 0);
    }

    #[test]
    fn a_share_of_the_bots_enters_and_entered_bots_stay_until_the_finish() {
        let config = SimConfig {
            target_riders: 20,
            race_countdown_s: 5.0,
            ..SimConfig::default()
        };
        let mut world = world_with(flat_loop(1000.0), config);
        world.start_race(1, None).unwrap();
        let entered = world.entrants(0).count();
        assert!((6..=18).contains(&entered), "about 60 % of 20 bots, got {entered}");
        // Humans joining push surplus bots out, but never entered ones.
        let entered_ids: Vec<RiderId> = world.entrants(0).collect();
        for i in 0..10 {
            world.join_human(&format!("Human {i}"), 70.0);
        }
        assert!(entered_ids.iter().all(|id| world.rider(*id).is_some()));
    }

    #[test]
    fn joining_needs_an_open_race_and_a_known_rider() {
        let mut world = world_with(
            flat_loop(1000.0),
            SimConfig {
                target_riders: 0,
                ..SimConfig::default()
            },
        );
        let id = world.join_human("Anna", 70.0);
        assert_eq!(world.join_race(id), Err(WorldError::Race(RaceError::NotOpen)));
        world.start_race(2, None).unwrap();
        assert_eq!(world.join_race(999), Err(WorldError::UnknownRider(999)));
        world.join_race(id).unwrap();
        world.leave_race(id);
        assert!(!world.is_entered(id));
        world.leave(id);
        assert_eq!(world.entrants(0).count(), 0);
    }

    // --- one world, several routes (#14) ------------------------------------

    /// A flat loop that rides the 1000 m road `shared` (west to east, or back
    /// with `dir` -1) and returns on its own road `side` metres to the north
    /// (south when negative).
    fn loop_over_shared(id: &str, dir: i8, side: f64) -> Route {
        let mut points = vec![
            Point::new(0.0, 0.0, 0.0),
            Point::new(1000.0, 0.0, 0.0),
            Point::new(1000.0, side, 0.0),
            Point::new(0.0, side, 0.0),
        ];
        if dir < 0 {
            points = vec![
                Point::new(1000.0, 0.0, 0.0),
                Point::new(0.0, 0.0, 0.0),
                Point::new(0.0, side, 0.0),
                Point::new(1000.0, side, 0.0),
            ];
        }
        let length = 2000.0 + 2.0 * side.abs();
        Route::new(RouteSpec {
            id: id.into(),
            name: id.into(),
            lanes: 4,
            seed: 1,
            points,
            markers: vec![],
            walk: vec![
                step("shared", dir, 0.0, 1000.0, 1000.0),
                step(&format!("{id}-back"), 1, 1000.0, length, length - 1000.0),
            ],
        })
        .unwrap()
    }

    fn map_world(target_riders: usize) -> World {
        World::with_routes(
            vec![
                loop_over_shared("north", 1, 400.0),
                loop_over_shared("south", 1, -400.0),
                loop_over_shared("back", -1, -200.0),
            ],
            SimConfig {
                target_riders,
                race_countdown_s: 0.0,
                ..SimConfig::default()
            },
            Box::new(SplitMix64::new(99)),
        )
    }

    pub(super) fn place(world: &mut World, id: RiderId, position: f64, speed: f64) {
        let rider = world.riders.get_mut(&id).unwrap();
        rider.position = position;
        rider.speed = speed;
        rider.lane = 1.0;
        rider.target_lane = 1;
    }

    fn gap_of(world: &World, id: RiderId) -> Option<f64> {
        let slots: Vec<Slot> = world.riders().map(|r| world.slot(r)).collect();
        let field = Field {
            routes: &world.routes,
            slots: &slots,
        };
        let me = slots.iter().find(|s| s.id == id).unwrap();
        field.gap_ahead(me, me.lane)
    }

    #[test]
    fn every_route_of_a_map_gets_its_bots() {
        let world = map_world(4);
        for route in 0..3 {
            assert_eq!(world.count_on(route), (0, 4));
        }
        assert_eq!(world.route_index("south"), Some(1));
        assert_eq!(world.route_index("nowhere"), None);
    }

    #[test]
    fn bots_spread_out_instead_of_piling_up() {
        let world = map_world(10);
        let at: Vec<(f64, f64)> = world.riders().map(|r| world.rider_xy(r)).collect();
        let closest = at
            .iter()
            .enumerate()
            .flat_map(|(i, &a)| at[i + 1..].iter().map(move |&b| distance(a, b)))
            .fold(f64::INFINITY, f64::min);
        // 30 bots on 7.6 km of road: random starts would put some within a few metres.
        assert!(closest > 25.0, "two bots start {closest:.1} m apart");
    }

    #[test]
    fn riders_of_different_routes_draft_each_other_on_a_shared_road() {
        let mut world = map_world(0);
        let leader = world.join_human_on(0, "Leader", 75.0).unwrap();
        let follower = world.join_human_on(1, "Follower", 75.0).unwrap();
        place(&mut world, leader, 400.0, 9.0);
        place(&mut world, follower, 397.0, 9.0);
        assert_eq!(gap_of(&world, follower), Some(3.0));
        assert_eq!(gap_of(&world, leader), None, "nobody ahead of the leader");
        ride(&mut world, 10.0, &[(leader, 200.0), (follower, 200.0)]);
        let gap = world.rider(leader).unwrap().position - world.rider(follower).unwrap().position;
        assert!(gap < 3.0, "the follower should close up in the draft, gap {gap}");
        let road = world.road_of(world.rider(follower).unwrap()).unwrap();
        assert_eq!((road.edge, road.dir), ("shared", 1));
    }

    #[test]
    fn no_draft_from_riders_going_the_other_way_or_on_another_road() {
        let mut world = map_world(0);
        let me = world.join_human_on(0, "Me", 75.0).unwrap();
        let oncoming = world.join_human_on(2, "Oncoming", 75.0).unwrap();
        let elsewhere = world.join_human_on(1, "Elsewhere", 75.0).unwrap();
        place(&mut world, me, 400.0, 9.0);
        // 597 m along the road from its east end: 3 m east of me, riding west.
        place(&mut world, oncoming, 597.0, 9.0);
        // On the south route's own road, near my position on the map's other side.
        place(&mut world, elsewhere, 1500.0, 9.0);
        assert_eq!(gap_of(&world, me), None);
    }

    #[test]
    fn races_and_their_events_stay_on_their_route() {
        let mut world = map_world(0);
        let north = world.join_human_on(0, "North", 75.0).unwrap();
        let south = world.join_human_on(1, "South", 75.0).unwrap();
        world.start_race(1, Some(south)).unwrap();
        world.tick(DT);
        assert!(matches!(world.race(1).phase(), RacePhase::Running { .. }));
        assert!(matches!(world.race(0).phase(), RacePhase::Idle));
        assert!(world.is_entered(south) && !world.is_entered(north));
        assert_eq!(world.join_race(north), Err(WorldError::Race(RaceError::NotOpen)));
        let events = world.drain_events();
        assert!(events.contains(&WorldEvent::Race {
            route: 1,
            event: RaceEvent::Started { laps: 1 }
        }));
        assert!(events.iter().all(|e| !matches!(e, WorldEvent::Race { route: 0, .. })));
        assert_eq!(world.join_human_on(7, "Lost", 70.0), Err(WorldError::UnknownRoute(7)));
    }

    // --- turning at junctions (#15) -----------------------------------------

    /// A 1 km square a→b→c→d with a diagonal b→d. Route 0 rides the square,
    /// route 1 the triangle a→b→d→a. The diagonal climbs 14 m.
    pub(super) fn junction_world() -> World {
        use crate::network::{EdgeSpec, NodeSpec};
        let node = |id: &str, x: f64, y: f64| NodeSpec { id: id.into(), x, y };
        let edge = |id: &str, from: &str, to: &str, a: (f64, f64, f64), b: (f64, f64, f64)| EdgeSpec {
            id: id.into(),
            from: from.into(),
            to: to.into(),
            points: vec![Point::new(a.0, a.1, a.2), Point::new(b.0, b.1, b.2)],
        };
        let network = Network::new(
            &[
                node("a", 0.0, 0.0),
                node("b", 1000.0, 0.0),
                node("c", 1000.0, 1000.0),
                node("d", 0.0, 1000.0),
            ],
            vec![
                edge("ab", "a", "b", (0.0, 0.0, 0.0), (1000.0, 0.0, 0.0)),
                edge("bc", "b", "c", (1000.0, 0.0, 0.0), (1000.0, 1000.0, 0.0)),
                edge("cd", "c", "d", (1000.0, 1000.0, 0.0), (0.0, 1000.0, 14.0)),
                edge("da", "d", "a", (0.0, 1000.0, 14.0), (0.0, 0.0, 0.0)),
                edge("bd", "b", "d", (1000.0, 0.0, 0.0), (0.0, 1000.0, 14.0)),
            ],
        )
        .unwrap();
        let diagonal = 1000.0 * 2f64.sqrt();
        let route = |id: &str, points: Vec<Point>, walk: Vec<WalkStep>| {
            Route::new(RouteSpec {
                id: id.into(),
                name: id.into(),
                lanes: 4,
                seed: 1,
                points,
                markers: vec![],
                walk,
            })
            .unwrap()
        };
        let square = route(
            "square",
            vec![
                Point::new(0.0, 0.0, 0.0),
                Point::new(1000.0, 0.0, 0.0),
                Point::new(1000.0, 1000.0, 0.0),
                Point::new(0.0, 1000.0, 14.0),
            ],
            vec![
                step("ab", 1, 0.0, 1000.0, 1000.0),
                step("bc", 1, 1000.0, 2000.0, 1000.0),
                step("cd", 1, 2000.0, 3000.0, 1000.0),
                step("da", 1, 3000.0, 4000.0, 1000.0),
            ],
        );
        let triangle = route(
            "triangle",
            vec![
                Point::new(0.0, 0.0, 0.0),
                Point::new(1000.0, 0.0, 0.0),
                Point::new(0.0, 1000.0, 14.0),
            ],
            vec![
                step("ab", 1, 0.0, 1000.0, 1000.0),
                step("bd", 1, 1000.0, 1000.0 + diagonal, diagonal),
                step("da", 1, 1000.0 + diagonal, 2000.0 + diagonal, 1000.0),
            ],
        );
        World::with_network(
            vec![square, triangle],
            Some(network),
            SimConfig {
                target_riders: 0,
                race_countdown_s: 5.0,
                ..SimConfig::default()
            },
            Box::new(SplitMix64::new(5)),
        )
    }

    fn cruise(world: &mut World, id: RiderId, seconds: f64) {
        ride(world, seconds, &[(id, 250.0)]);
    }

    #[test]
    fn a_turn_onto_another_routes_road_rides_that_route_from_there() {
        let mut world = junction_world();
        let me = world.join_human("Me", 75.0);
        place(&mut world, me, 990.0, 10.0);
        assert_eq!(world.next_road_of(world.rider(me).unwrap()), Some(("bc", 1)));
        world.choose_turn(me, Some("bd")).unwrap();
        assert_eq!(world.next_road_of(world.rider(me).unwrap()), Some(("bd", 1)));
        cruise(&mut world, me, 2.0);
        let rider = world.rider(me).unwrap();
        assert_eq!(rider.route, 1, "on the triangle now");
        assert!(rider.off_route.is_none() && rider.turn.is_none());
        assert!(
            (1005.0..1030.0).contains(&rider.position),
            "just past b: {}",
            rider.position
        );
        assert_eq!(world.count_on(1), (1, 0));
        // Once the grade's window lies on it.
        cruise(&mut world, me, 4.0);
        assert!(world.grade_for(me).unwrap() > 0.9, "the diagonal climbs");
    }

    #[test]
    fn without_a_pick_riders_stay_on_their_route() {
        let mut world = junction_world();
        let me = world.join_human("Me", 75.0);
        place(&mut world, me, 990.0, 10.0);
        // Picking the route's own road is no pick.
        world.choose_turn(me, Some("bc")).unwrap();
        assert_eq!(world.rider(me).unwrap().turn, None);
        cruise(&mut world, me, 2.0);
        let rider = world.rider(me).unwrap();
        assert_eq!(rider.route, 0);
        assert_eq!(world.road_of(rider).map(|r| r.edge), Some("bc"));
    }

    #[test]
    fn a_road_no_route_rides_that_way_is_ridden_off_route() {
        let mut world = junction_world();
        let me = world.join_human_on(1, "Me", 75.0).unwrap();
        // On the diagonal, 10 m before d; back along c-d is no route's way.
        let diagonal = 1000.0 * 2f64.sqrt();
        place(&mut world, me, 990.0 + diagonal, 10.0);
        world.choose_turn(me, Some("cd")).unwrap();
        cruise(&mut world, me, 2.0);
        let rider = world.rider(me).unwrap();
        let road = world.road_of(rider).unwrap();
        assert_eq!((road.edge, road.dir), ("cd", -1));
        assert!(rider.off_route.is_some());
        assert!(world.grade_for(me).unwrap() < -1.0, "c-d falls riding back");
        let (x, y) = world.rider_xy(rider);
        assert!(
            x > 0.0 && x < 40.0 && (y - 1000.0).abs() < 1e-6,
            "just east of d: {x}, {y}"
        );
        assert_eq!(world.count_on(1), (0, 0), "off every route");
        // Straight on at c is back down b-c; at b back west towards a.
        assert_eq!(world.next_road_of(rider), Some(("bc", -1)));
        assert_eq!(world.start_race(1, Some(me)), Err(WorldError::OffRoute));
    }

    #[test]
    fn riding_back_onto_a_routes_road_rejoins_it() {
        let mut world = junction_world();
        let me = world.join_human("Me", 75.0);
        // Off-route, back down b-c, 10 m before b.
        let bc = world.network.as_ref().unwrap().edge_index("bc").unwrap();
        {
            let rider = world.riders.get_mut(&me).unwrap();
            rider.off_route = Some(OffRoute {
                road: (bc, -1),
                offset: 990.0,
            });
            rider.position = 5000.0;
            rider.speed = 10.0;
        }
        // At b: on towards d rides the triangle that way.
        world.choose_turn(me, Some("bd")).unwrap();
        cruise(&mut world, me, 2.0);
        let rider = world.rider(me).unwrap();
        assert!(rider.off_route.is_none());
        assert_eq!(rider.route, 1);
        assert!((1005.0..1030.0).contains(&rider.position));
    }

    #[test]
    fn turns_are_checked_and_race_entrants_cannot_turn() {
        let mut world = junction_world();
        let me = world.join_human("Me", 75.0);
        place(&mut world, me, 500.0, 10.0);
        assert_eq!(
            world.choose_turn(me, Some("da")),
            Err(WorldError::NoSuchTurn),
            "da doesn't leave b"
        );
        assert_eq!(
            world.choose_turn(me, Some("ab")),
            Err(WorldError::NoSuchTurn),
            "no turning back"
        );
        assert_eq!(world.choose_turn(me, Some("nowhere")), Err(WorldError::NoSuchTurn));
        world.choose_turn(me, Some("bd")).unwrap();
        world.start_race(1, Some(me)).unwrap();
        assert_eq!(world.rider(me).unwrap().turn, None, "entering drops the pick");
        assert_eq!(world.choose_turn(me, Some("bd")), Err(WorldError::Racing));
        assert_eq!(world.choose_turn(999, None), Err(WorldError::UnknownRider(999)));

        let mut plain = map_world(0);
        let other = plain.join_human("Other", 75.0);
        assert_eq!(
            plain.choose_turn(other, Some("shared")),
            Err(WorldError::NoSuchTurn),
            "no network"
        );
    }

    #[test]
    fn reserved_route_refuses_manual_races() {
        let mut world = empty_world(flat_loop(1000.0));
        let me = world.join_human("Me", 70.0);
        world.reserve_route(0, true);
        assert_eq!(world.start_race(3, Some(me)), Err(WorldError::EventScheduled));
        world.reserve_route(0, false);
        assert_eq!(world.start_race(3, Some(me)), Ok(()));
    }

    #[test]
    fn scheduled_race_aborts_a_manual_one_and_starts_at_once() {
        let mut world = empty_world(flat_loop(1000.0));
        let me = world.join_human("Me", 70.0);
        let other = world.join_human("Other", 70.0);
        world.riders.get_mut(&me).unwrap().position = 400.0;
        world.start_race(1, Some(other)).unwrap();
        world.drain_events();
        world.start_scheduled_race(0, 2, &[me]).unwrap();
        assert!(matches!(world.race(0).phase(), RacePhase::Running { laps: 2, .. }));
        assert_eq!(world.entrants(0).collect::<Vec<_>>(), vec![me]);
        assert_eq!(world.rider(me).unwrap().position, 0.0);
        assert!(world.rider(me).unwrap().race_start_odometer.is_some());
        assert!(world.rider(other).unwrap().race_start_odometer.is_none());
        assert!(world.race(0).results().is_empty());
        assert_eq!(
            world.drain_events(),
            vec![WorldEvent::Race {
                route: 0,
                event: RaceEvent::Started { laps: 2 }
            }]
        );
        assert_eq!(
            world.start_scheduled_race(0, 0, &[me]),
            Err(WorldError::Race(RaceError::InvalidLaps {
                max: world.config().max_race_laps
            }))
        );
        assert!(matches!(world.race(0).phase(), RacePhase::Running { laps: 2, .. }));
    }

    #[test]
    fn complete_race_force_finishes_and_clears() {
        let mut world = empty_world(flat_loop(1000.0));
        let me = world.join_human("Me", 70.0);
        world.start_scheduled_race(0, 1, &[me]).unwrap();
        world.drain_events();
        world.complete_race(0);
        assert!(matches!(world.race(0).phase(), RacePhase::Finished { .. }));
        assert_eq!(world.entrants(0).count(), 0);
        assert!(world.rider(me).unwrap().race_start_odometer.is_none());
        assert_eq!(
            world.drain_events(),
            vec![WorldEvent::Race {
                route: 0,
                event: RaceEvent::Finished
            }]
        );
        world.complete_race(0);
        assert!(world.drain_events().is_empty());
    }

    #[test]
    fn power_adjust_changes_speed_not_power() {
        let mut world = empty_world(flat_loop(5000.0));
        let a = world.join_human("A", 70.0);
        let b = world.join_human("B", 70.0);
        world.riders.get_mut(&a).unwrap().lane = 0.0;
        world.riders.get_mut(&a).unwrap().target_lane = 0;
        world.riders.get_mut(&b).unwrap().lane = 2.0;
        world.riders.get_mut(&b).unwrap().target_lane = 2;
        world.set_power_adjust(b, 100.0);
        ride(&mut world, 30.0, &[(a, 200.0), (b, 200.0)]);
        let (ra, rb) = (world.rider(a).unwrap(), world.rider(b).unwrap());
        assert!(rb.odometer > ra.odometer);
        assert_eq!((ra.power, rb.power), (200.0, 200.0));
    }

    #[test]
    fn event_bots_stay_while_in_the_event() {
        let config = SimConfig {
            target_riders: 2,
            ..SimConfig::default()
        };
        let mut world = world_with(square_loop(), config);
        let bots = world.spawn_event_bots(0, 6, &[3.0]);
        assert_eq!(bots.len(), 6);
        for &id in &bots {
            world.set_group_ride(id, true);
        }
        for _ in 0..1200 {
            world.tick(DT);
        }
        assert!(bots.iter().all(|&id| world.rider(id).is_some()));
        for &id in &bots {
            world.set_group_ride(id, false);
        }
        world.tick(DT);
        assert!(world.bot_count() < 8, "surplus bots may go once the event is over");
    }

    #[test]
    fn locked_riders_cannot_turn() {
        let mut world = junction_world();
        let me = world.join_human("Me", 75.0);
        place(&mut world, me, 500.0, 10.0);
        world.choose_turn(me, Some("bd")).unwrap();
        world.lock_turns(me, true);
        assert_eq!(world.rider(me).unwrap().turn, None);
        assert_eq!(world.choose_turn(me, Some("bd")), Err(WorldError::Racing));
        world.lock_turns(me, false);
        world.choose_turn(me, Some("bd")).unwrap();
    }
}
