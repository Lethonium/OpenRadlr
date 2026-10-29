//! Scheduled events on route worlds: a lobby, then a race or a group ride, then results.
//!
//! [`Events`] sits next to a [`World`]: call [`Events::sync`] after every
//! `world.tick(dt)`. It reserves the route for the lobby, fills the field with
//! bots matched to the entrants at the start, shares power in group rides and
//! decides when the event is over. Time comes in as `now_s` (Unix seconds).

use crate::bot::{pack_levels, DEFAULT_LEVEL_WKG};
use crate::race::RacePhase;
use crate::schedule::{Occurrence, Phase, Schedule};
use crate::sharing::{Flow, Member, Sharing};
use crate::world::{RiderId, RouteIndex, World};
use std::collections::{BTreeMap, HashMap};

/// Power sharing is recomputed once this many seconds have accumulated.
const SHARE_INTERVAL_S: f64 = 1.0;
/// A race that has not ended this long after its schedule ends is stopped.
const RACE_GRACE_S: f64 = 600.0;
/// A late joiner of a group ride starts this far behind the last member.
const LATE_JOIN_GAP_M: f64 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Race,
    GroupRide,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EventLength {
    Laps(u32),
    Distance(f64),
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventDef {
    pub id: String,
    pub name: String,
    pub kind: EventKind,
    pub route: RouteIndex,
    pub length: EventLength,
    pub schedule: Schedule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventError {
    Unknown,
    NotOpen,
    Closed,
    NotOnRoute,
    /// Seated in a vehicle.
    InVehicle,
}

impl EventError {
    /// The code the protocol carries.
    pub fn code(self) -> &'static str {
        match self {
            Self::Unknown => "unknown_event",
            Self::NotOpen => "event_not_open",
            Self::Closed => "event_closed",
            Self::NotOnRoute => "not_on_route",
            Self::InVehicle => "in_vehicle",
        }
    }
}

impl std::fmt::Display for EventError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Unknown => "no such event",
            Self::NotOpen => "the event's lobby is not open yet",
            Self::Closed => "the event has started and takes no more entrants",
            Self::NotOnRoute => "the event is on another route",
            Self::InVehicle => "riders in a vehicle can't join events",
        })
    }
}

impl std::error::Error for EventError {}

/// The next occurrence of an event, for the menu.
#[derive(Debug, Clone, PartialEq)]
pub struct EventInfo {
    pub id: String,
    pub name: String,
    pub kind: EventKind,
    pub route: RouteIndex,
    pub lobby_opens_at_s: f64,
    pub starts_at_s: f64,
    pub phase: Phase,
    /// Human entrants so far.
    pub entrants: usize,
}

/// The event in its lobby or running on a rider's route, as that rider sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct EventView {
    pub id: String,
    pub name: String,
    pub kind: EventKind,
    pub phase: Phase,
    /// Seconds to the start; negative once running.
    pub starts_in_s: f64,
    pub length: EventLength,
    /// Human entrants.
    pub entrants: Vec<(RiderId, String)>,
    pub entered: bool,
    /// The rider's power sharing (group rides).
    pub sharing: Option<Flow>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventResult {
    pub rider_id: RiderId,
    pub name: String,
    pub is_bot: bool,
    /// Finishing place (races); `None` for a DNF and in group rides.
    pub place: Option<usize>,
    /// Race time, or the time a group ride member covered the length; `None` if not finished.
    pub time_s: Option<f64>,
    pub distance_m: f64,
    pub avg_wkg: f64,
    pub given_kj: f64,
    pub received_kj: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum EventNotice {
    Lobby {
        route: RouteIndex,
        id: String,
        name: String,
        kind: EventKind,
        starts_in_s: f64,
    },
    Started {
        route: RouteIndex,
        id: String,
        kind: EventKind,
    },
    Finished {
        route: RouteIndex,
        id: String,
        kind: EventKind,
        results: Vec<EventResult>,
        /// Whether any human took part (bots-only events finish quietly).
        announce: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Lobby,
    Running,
}

/// One rider of the event being handled.
#[derive(Debug)]
struct Entrant {
    id: RiderId,
    name: String,
    is_bot: bool,
    mass_kg: f64,
    start_odometer: f64,
    distance_m: f64,
    energy_j: f64,
    time_s: f64,
    given_j: f64,
    received_j: f64,
    /// Event time at which a group ride member covered the length.
    covered_at_s: Option<f64>,
    /// Done riding for the tallies: finished the race or covered the length.
    frozen: bool,
    /// Disconnected: a DNF, and no longer part of the sharing.
    gone: bool,
}

/// The occurrence of one definition that is in its lobby or running.
#[derive(Debug)]
struct Active {
    index: u64,
    stage: Stage,
    starts_at_s: f64,
    ends_at_s: f64,
    elapsed_s: f64,
    entrants: Vec<Entrant>,
    sharing: Sharing,
    share_acc_s: f64,
    flows: HashMap<RiderId, Flow>,
}

#[derive(Debug)]
pub struct Events {
    defs: Vec<EventDef>,
    /// Per definition: the occurrence in its lobby or running.
    active: Vec<Option<Active>>,
    /// Per definition: the last occurrence that finished.
    done: Vec<Option<u64>>,
    /// Per definition: the occurrence already running when the server booted.
    /// A group ride of it starts when the first rider joins.
    booted_over: Vec<Option<u64>>,
    notices: Vec<EventNotice>,
    /// Whether `sync` has run: occurrences already running at the first call are skipped.
    synced: bool,
}

impl Entrant {
    fn of(world: &World, id: RiderId) -> Option<Self> {
        let rider = world.rider(id)?;
        Some(Self {
            id,
            name: rider.name.clone(),
            is_bot: rider.is_bot(),
            mass_kg: rider.mass_kg,
            start_odometer: rider.odometer,
            distance_m: 0.0,
            energy_j: 0.0,
            time_s: 0.0,
            given_j: 0.0,
            received_j: 0.0,
            covered_at_s: None,
            frozen: false,
            gone: false,
        })
    }

    fn avg_wkg(&self) -> f64 {
        if self.time_s > 0.0 && self.mass_kg > 0.0 {
            self.energy_j / self.time_s / self.mass_kg
        } else {
            0.0
        }
    }

    fn result(&self, place: Option<usize>, time_s: Option<f64>) -> EventResult {
        EventResult {
            rider_id: self.id,
            name: self.name.clone(),
            is_bot: self.is_bot,
            place,
            time_s,
            distance_m: self.distance_m,
            avg_wkg: self.avg_wkg(),
            given_kj: self.given_j / 1000.0,
            received_kj: self.received_j / 1000.0,
        }
    }
}

impl Active {
    fn new(occurrence: &Occurrence) -> Self {
        Self {
            index: occurrence.index,
            stage: Stage::Lobby,
            starts_at_s: occurrence.starts_at_s,
            ends_at_s: occurrence.ends_at_s,
            elapsed_s: 0.0,
            entrants: Vec::new(),
            sharing: Sharing::default(),
            share_acc_s: 0.0,
            flows: HashMap::new(),
        }
    }

    fn humans(&self) -> impl Iterator<Item = &Entrant> {
        self.entrants.iter().filter(|e| !e.is_bot && !e.gone)
    }

    fn has(&self, id: RiderId) -> bool {
        self.entrants.iter().any(|e| e.id == id && !e.gone)
    }

    fn remove(&mut self, id: RiderId) {
        self.entrants.retain(|e| e.id != id);
    }

    /// Forgets the power shared so far (someone left): everybody rides on their own again.
    fn reset_sharing(&mut self, world: &mut World) {
        self.sharing = Sharing::default();
        self.share_acc_s = 0.0;
        self.flows.clear();
        for e in &self.entrants {
            world.set_power_adjust(e.id, 0.0);
        }
    }

    /// Distance of the event so far, per living member, for the sharing.
    fn members(&self, world: &World) -> Vec<Member> {
        self.entrants
            .iter()
            .filter(|e| !e.gone)
            .filter_map(|e| {
                let rider = world.rider(e.id)?;
                Some(Member {
                    id: e.id,
                    distance_m: rider.odometer - e.start_odometer,
                    speed: rider.speed,
                    power: rider.power,
                })
            })
            .collect()
    }

    /// Adds `dt` of riding to everybody's tallies and notes who is done.
    fn accumulate(&mut self, world: &World, def: &EventDef, length_m: f64, dt: f64) {
        self.elapsed_s += dt;
        for e in self.entrants.iter_mut().filter(|e| !e.gone && !e.frozen) {
            let Some(rider) = world.rider(e.id) else {
                continue;
            };
            e.distance_m = rider.odometer - e.start_odometer;
            e.energy_j += rider.power * dt;
            e.time_s += dt;
            match def.kind {
                EventKind::Race => e.frozen = rider.race_finished,
                EventKind::GroupRide if e.distance_m >= length_m => {
                    e.covered_at_s = Some(self.elapsed_s);
                    e.frozen = true;
                }
                EventKind::GroupRide => {}
            }
        }
    }

    fn share(&mut self, world: &mut World, tuning: &crate::sharing::SharingTuning, dt: f64) {
        self.share_acc_s += dt;
        if self.share_acc_s < SHARE_INTERVAL_S {
            return;
        }
        let interval = std::mem::take(&mut self.share_acc_s);
        let members = self.members(world);
        let flows = self.sharing.update(&members, tuning, interval);
        self.flows.clear();
        for flow in flows {
            world.set_power_adjust(flow.id, flow.received_w - flow.given_w);
            if let Some(e) = self.entrants.iter_mut().find(|e| e.id == flow.id) {
                e.given_j += flow.given_w * interval;
                e.received_j += flow.received_w * interval;
            }
            self.flows.insert(flow.id, flow);
        }
    }
}

impl Events {
    pub fn new(defs: Vec<EventDef>) -> Self {
        let n = defs.len();
        Self {
            defs,
            active: (0..n).map(|_| None).collect(),
            done: vec![None; n],
            booted_over: vec![None; n],
            notices: Vec::new(),
            synced: false,
        }
    }

    /// Advances the events to `now_s`; call it after every `world.tick(dt)`.
    pub fn sync(&mut self, world: &mut World, now_s: f64, dt: f64) {
        if !std::mem::replace(&mut self.synced, true) {
            // A server that boots mid-event does not start it with a bots-only field.
            for (i, def) in self.defs.iter().enumerate() {
                if let Some(occurrence) = def.schedule.at(now_s).filter(|o| o.phase == Phase::Running) {
                    self.done[i] = Some(occurrence.index);
                    self.booted_over[i] = Some(occurrence.index);
                }
            }
        }
        for i in 0..self.defs.len() {
            if self.defs[i].route >= world.routes().len() {
                continue;
            }
            if self.active[i].is_none() {
                let Some(occurrence) = self.defs[i].schedule.at(now_s) else {
                    continue;
                };
                if occurrence.phase == Phase::Upcoming || self.done[i].is_some_and(|done| done >= occurrence.index) {
                    continue;
                }
                self.open_lobby(i, world, &occurrence, now_s);
            }
            let Some(active) = self.active[i].as_ref() else {
                continue;
            };
            if active.stage == Stage::Lobby && now_s >= active.starts_at_s {
                self.start(i, world);
            }
            if self.active[i].as_ref().is_some_and(|a| a.stage == Stage::Running) {
                self.step(i, world, now_s, dt);
            }
        }
    }

    fn open_lobby(&mut self, i: usize, world: &mut World, occurrence: &Occurrence, now_s: f64) {
        // A race of the same route still in its grace period ends now, results out.
        let route = self.defs[i].route;
        for j in 0..self.defs.len() {
            let running = self.active[j].as_ref().is_some_and(|a| a.stage == Stage::Running);
            if j != i && running && self.defs[j].route == route && self.defs[j].kind == EventKind::Race {
                world.complete_race(route);
                self.finish(j, world);
            }
        }
        let def = &self.defs[i];
        world.reserve_route(def.route, true);
        self.notices.push(EventNotice::Lobby {
            route: def.route,
            id: def.id.clone(),
            name: def.name.clone(),
            kind: def.kind,
            starts_in_s: occurrence.starts_at_s - now_s,
        });
        self.active[i] = Some(Active::new(occurrence));
    }

    fn length_m(&self, i: usize, world: &World) -> f64 {
        let def = &self.defs[i];
        match def.length {
            EventLength::Laps(laps) => f64::from(laps) * world.route(def.route).length(),
            EventLength::Distance(m) => m,
        }
    }

    fn start(&mut self, i: usize, world: &mut World) {
        let route = self.defs[i].route;
        let Some(mut active) = self.active[i].take() else {
            return;
        };
        active.entrants.retain(|e| world.rider(e.id).is_some());
        let levels: Vec<f64> = active
            .humans()
            .map(|e| world.rider(e.id).and_then(|r| r.level_wkg).unwrap_or(DEFAULT_LEVEL_WKG))
            .collect();
        let humans = levels.len();
        let (count, levels) = if humans == 0 {
            (world.config().max_event_bots / 2, Vec::new())
        } else {
            (
                (world.config().bots_per_entrant * humans).min(world.config().max_event_bots),
                pack_levels(&levels),
            )
        };
        for id in world.spawn_event_bots(route, count, &levels) {
            active.entrants.extend(Entrant::of(world, id));
        }

        let ids: Vec<RiderId> = active.entrants.iter().map(|e| e.id).collect();
        // How far behind the line each entrant stands (a race keeps it in its odometer).
        let mut behind = BTreeMap::new();
        let ok = match self.defs[i].kind {
            EventKind::Race => {
                let laps = match self.defs[i].length {
                    EventLength::Laps(laps) => laps,
                    EventLength::Distance(m) => (m / world.route(route).length()).round() as u32,
                };
                let laps = laps.clamp(1, world.config().max_race_laps.max(1));
                world.start_scheduled_race(route, laps, &ids).is_ok()
            }
            EventKind::GroupRide => {
                // A manual race still running on the route stops for the ride.
                world.complete_race(route);
                behind = world.line_up(route, &ids);
                for &id in &ids {
                    world.set_group_ride(id, true);
                }
                true
            }
        };
        for &id in &ids {
            world.lock_turns(id, true);
        }
        // Distances count from the start line, wherever the odometers stood
        // and also for the rows behind it.
        for e in &mut active.entrants {
            if let Some(rider) = world.rider(e.id) {
                e.start_odometer = rider
                    .race_start_odometer
                    .unwrap_or(rider.odometer + behind.get(&e.id).copied().unwrap_or(0.0));
            }
        }
        active.stage = Stage::Running;
        self.notices.push(EventNotice::Started {
            route,
            id: self.defs[i].id.clone(),
            kind: self.defs[i].kind,
        });
        self.active[i] = Some(active);
        if !ok {
            self.finish(i, world);
        }
    }

    fn step(&mut self, i: usize, world: &mut World, now_s: f64, dt: f64) {
        let length_m = self.length_m(i, world);
        let route = self.defs[i].route;
        let kind = self.defs[i].kind;
        let tuning = world.config().sharing;
        let Some(active) = self.active[i].as_mut() else {
            return;
        };
        active.accumulate(world, &self.defs[i], length_m, dt);
        let over = match kind {
            EventKind::Race => {
                let ended = matches!(world.race(route).phase(), RacePhase::Finished { .. } | RacePhase::Idle);
                if !ended && now_s >= active.ends_at_s + RACE_GRACE_S {
                    world.complete_race(route);
                    true
                } else {
                    ended
                }
            }
            EventKind::GroupRide => {
                active.share(world, &tuning, dt);
                let mut humans = active.humans().peekable();
                let all_covered = humans.peek().is_some() && humans.all(|e| e.covered_at_s.is_some());
                all_covered || now_s >= active.ends_at_s
            }
        };
        if over {
            self.finish(i, world);
        }
    }

    fn finish(&mut self, i: usize, world: &mut World) {
        let def = &self.defs[i];
        let Some(active) = self.active[i].take() else {
            return;
        };
        let mut results = Vec::new();
        match def.kind {
            EventKind::Race => {
                let finished = world.race(def.route).results();
                for e in active
                    .entrants
                    .iter()
                    .filter(|e| !e.is_bot || world.rider(e.id).is_some())
                {
                    let position = finished.iter().position(|r| r.rider_id == e.id);
                    results.push((
                        position,
                        e.result(position.map(|p| p + 1), position.map(|p| finished[p].time_s)),
                    ));
                }
                results.sort_by(|a, b| match (a.0, b.0) {
                    (Some(x), Some(y)) => x.cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => b.1.distance_m.total_cmp(&a.1.distance_m),
                });
            }
            EventKind::GroupRide => {
                for e in active
                    .entrants
                    .iter()
                    .filter(|e| !e.is_bot || world.rider(e.id).is_some())
                {
                    results.push((None, e.result(None, e.covered_at_s)));
                }
                results.sort_by(|a, b| match (a.1.time_s, b.1.time_s) {
                    (Some(x), Some(y)) => x.total_cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => b.1.distance_m.total_cmp(&a.1.distance_m),
                });
            }
        }
        let announce = active.entrants.iter().any(|e| !e.is_bot);
        for e in &active.entrants {
            world.set_group_ride(e.id, false);
            world.set_power_adjust(e.id, 0.0);
            world.lock_turns(e.id, false);
        }
        let route_busy = self
            .defs
            .iter()
            .zip(&self.active)
            .any(|(d, a)| a.is_some() && d.route == def.route);
        if !route_busy {
            world.reserve_route(def.route, false);
        }
        self.notices.push(EventNotice::Finished {
            route: def.route,
            id: def.id.clone(),
            kind: def.kind,
            results: results.into_iter().map(|(_, r)| r).collect(),
            announce,
        });
        self.done[i] = Some(active.index);
    }

    /// Enters a rider in the event `id`: in its lobby, or late in a running group ride.
    pub fn join(&mut self, world: &mut World, rider: RiderId, id: &str, now_s: f64) -> Result<(), EventError> {
        let i = self.defs.iter().position(|d| d.id == id).ok_or(EventError::Unknown)?;
        if world.is_seated(rider) {
            return Err(EventError::InVehicle);
        }
        let (def_route, kind) = (self.defs[i].route, self.defs[i].kind);
        let route = world.rider(rider).map(|r| r.route);
        if route != Some(def_route) || world.rider(rider).is_some_and(|r| r.off_route.is_some()) {
            return Err(EventError::NotOnRoute);
        }
        let mut start_now = false;
        // A ride that was already running when the server booted starts with its first rider.
        if self.active[i].is_none() && kind == EventKind::GroupRide {
            let booted = self.booted_over[i];
            let occurrence = self.defs[i]
                .schedule
                .at(now_s)
                .filter(|o| o.phase == Phase::Running && Some(o.index) == booted);
            if let Some(occurrence) = occurrence {
                self.booted_over[i] = None;
                self.open_lobby(i, world, &occurrence, now_s);
                start_now = true;
            }
        }
        let Some(active) = self.active[i].as_mut() else {
            return Err(EventError::NotOpen);
        };
        if active.has(rider) {
            return Ok(());
        }
        let Some(mut entrant) = Entrant::of(world, rider) else {
            return Err(EventError::NotOnRoute);
        };
        match (active.stage, kind) {
            (Stage::Lobby, _) => {}
            (Stage::Running, EventKind::Race) => return Err(EventError::Closed),
            (Stage::Running, EventKind::GroupRide) => {
                let last = active
                    .members(world)
                    .into_iter()
                    .min_by(|a, b| a.distance_m.total_cmp(&b.distance_m));
                if let Some(last) = last {
                    let position = world.rider(last.id).map_or(0.0, |r| r.position);
                    world.place_at(rider, position - LATE_JOIN_GAP_M);
                    let odometer = world.rider(rider).map_or(0.0, |r| r.odometer);
                    entrant.start_odometer = odometer - last.distance_m;
                    entrant.distance_m = last.distance_m;
                }
                world.set_group_ride(rider, true);
            }
        }
        world.lock_turns(rider, true);
        active.entrants.retain(|e| e.id != rider);
        active.entrants.push(entrant);
        if start_now {
            self.start(i, world);
        }
        Ok(())
    }

    /// Withdraws a rider from the event they entered (no result).
    pub fn leave(&mut self, world: &mut World, rider: RiderId) {
        for (i, slot) in self.active.iter_mut().enumerate() {
            let Some(active) = slot.as_mut().filter(|a| a.has(rider)) else {
                continue;
            };
            active.remove(rider);
            world.lock_turns(rider, false);
            if active.stage == Stage::Running {
                match self.defs[i].kind {
                    EventKind::Race => world.leave_race(rider),
                    EventKind::GroupRide => {
                        world.set_group_ride(rider, false);
                        active.reset_sharing(world);
                    }
                }
            }
        }
    }

    /// A rider disconnects: a DNF in a running race. Call before `world.leave`.
    pub fn rider_gone(&mut self, world: &mut World, rider: RiderId) {
        for slot in &mut self.active {
            let Some(active) = slot.as_mut().filter(|a| a.has(rider)) else {
                continue;
            };
            if active.stage == Stage::Lobby {
                active.remove(rider);
                continue;
            }
            if let Some(e) = active.entrants.iter_mut().find(|e| e.id == rider) {
                e.gone = true;
            }
            active.reset_sharing(world);
        }
    }

    /// The event in its lobby or running on the rider's route.
    pub fn view_for(&self, world: &World, rider: RiderId, now_s: f64) -> Option<EventView> {
        let route = world.rider(rider)?.route;
        let (def, active) = self
            .defs
            .iter()
            .zip(&self.active)
            .find_map(|(def, active)| active.as_ref().filter(|_| def.route == route).map(|a| (def, a)))?;
        Some(EventView {
            id: def.id.clone(),
            name: def.name.clone(),
            kind: def.kind,
            phase: match active.stage {
                Stage::Lobby => Phase::Lobby,
                Stage::Running => Phase::Running,
            },
            starts_in_s: active.starts_at_s - now_s,
            length: def.length,
            entrants: active.humans().map(|e| (e.id, e.name.clone())).collect(),
            entered: active.has(rider),
            sharing: active.flows.get(&rider).cloned(),
        })
    }

    /// The next occurrence of each event.
    pub fn infos(&self, now_s: f64) -> Vec<EventInfo> {
        self.defs
            .iter()
            .zip(&self.active)
            .filter_map(|(def, active)| {
                let occurrence = def.schedule.at(now_s)?;
                let entrants = active
                    .as_ref()
                    .filter(|a| a.index == occurrence.index)
                    .map_or(0, |a| a.humans().count());
                Some(EventInfo {
                    id: def.id.clone(),
                    name: def.name.clone(),
                    kind: def.kind,
                    route: def.route,
                    lobby_opens_at_s: occurrence.lobby_opens_at_s,
                    starts_at_s: occurrence.starts_at_s,
                    phase: occurrence.phase,
                    entrants,
                })
            })
            .collect()
    }

    pub fn drain_notices(&mut self) -> Vec<EventNotice> {
        std::mem::take(&mut self.notices)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::SplitMix64;
    use crate::route::tests::flat_loop;
    use crate::world::{Controller, SimConfig, WorldError};

    const DT: f64 = 0.05;
    /// A 2 km loop.
    const LAP_M: f64 = 2000.0;

    struct Rig {
        world: World,
        events: Events,
        now: f64,
        notices: Vec<EventNotice>,
    }

    impl Rig {
        fn new(defs: Vec<EventDef>) -> Self {
            let config = SimConfig {
                target_riders: 0,
                ..SimConfig::default()
            };
            Self {
                world: World::new(flat_loop(LAP_M), config, Box::new(SplitMix64::new(77))),
                events: Events::new(defs),
                now: 0.0,
                notices: Vec::new(),
            }
        }

        fn human(&mut self, name: &str, level: f64) -> RiderId {
            let id = self.world.join_human_on(0, name, 70.0).unwrap();
            self.world.set_level(id, level).unwrap();
            id
        }

        fn tick(&mut self, powers: &[(RiderId, f64)]) {
            for &(id, power) in powers {
                self.world.set_telemetry(id, power, Some(90.0)).unwrap();
            }
            self.world.tick(DT);
            self.now += DT;
            self.events.sync(&mut self.world, self.now, DT);
            self.notices.extend(self.events.drain_notices());
        }

        fn run_to(&mut self, until: f64, powers: &[(RiderId, f64)]) {
            while self.now < until {
                self.tick(powers);
            }
        }

        fn finished(&self) -> Option<&EventNotice> {
            self.notices.iter().find(|n| matches!(n, EventNotice::Finished { .. }))
        }

        fn remove_bots(&mut self) {
            let bots: Vec<RiderId> = self.world.riders().filter(|r| r.is_bot()).map(|r| r.id).collect();
            for id in bots {
                self.world.leave(id);
            }
        }
    }

    fn race_def() -> EventDef {
        EventDef {
            id: "race".into(),
            name: "Test race".into(),
            kind: EventKind::Race,
            route: 0,
            length: EventLength::Laps(1),
            schedule: Schedule::Every {
                every_s: 600.0,
                offset_s: 300.0,
                lobby_s: 120.0,
                duration_s: 300.0,
            },
        }
    }

    fn ride_def() -> EventDef {
        EventDef {
            id: "ride".into(),
            name: "Test ride".into(),
            kind: EventKind::GroupRide,
            route: 0,
            length: EventLength::Distance(3000.0),
            schedule: Schedule::Once {
                starts_at_s: 300.0,
                lobby_s: 120.0,
                duration_s: 1500.0,
            },
        }
    }

    fn bot_levels(world: &World) -> Vec<f64> {
        world
            .riders()
            .filter_map(|r| match &r.controller {
                Controller::Bot(brain) => Some(brain.profile().ftp_wkg),
                Controller::Human { .. } => None,
            })
            .collect()
    }

    fn sharing_balance(rig: &Rig) -> (f64, f64) {
        let flows = rig.events.active[0].as_ref().map(|a| &a.flows);
        flows.map_or((0.0, 0.0), |f| {
            (
                f.values().map(|f| f.given_w).sum(),
                f.values().map(|f| f.received_w).sum(),
            )
        })
    }

    #[test]
    fn lobby_then_race_with_matched_bots() {
        let mut rig = Rig::new(vec![race_def()]);
        let me = rig.human("Anna", 3.0);
        rig.run_to(200.0, &[(me, 250.0)]);
        assert!(matches!(
            rig.notices.as_slice(),
            [EventNotice::Lobby { id, starts_in_s, kind: EventKind::Race, .. }] if id == "race" && (*starts_in_s - 120.0).abs() < 0.1
        ));
        assert_eq!(rig.events.join(&mut rig.world, me, "race", rig.now), Ok(()));
        rig.run_to(301.0, &[(me, 250.0)]);
        assert!(rig
            .notices
            .iter()
            .any(|n| matches!(n, EventNotice::Started { id, .. } if id == "race")));
        let levels = bot_levels(&rig.world);
        assert_eq!(levels.len(), 4);
        assert!(levels.iter().all(|l| (2.0..=4.5).contains(l)), "{levels:?}");
        assert!(rig.world.rider(me).unwrap().position < 20.0);

        while rig.finished().is_none() && rig.now < 1500.0 {
            rig.tick(&[(me, 250.0)]);
        }
        let Some(EventNotice::Finished {
            results,
            announce,
            kind,
            ..
        }) = rig.finished()
        else {
            panic!("no finish")
        };
        assert!(*announce);
        assert_eq!(*kind, EventKind::Race);
        let mine = results.iter().find(|r| r.rider_id == me).unwrap();
        assert!(mine.place.is_some() && mine.time_s.is_some());
        assert!((mine.avg_wkg - 250.0 / 70.0).abs() < 0.05, "{}", mine.avg_wkg);
        assert!(mine.distance_m >= LAP_M);
        assert!(results.iter().any(|r| r.is_bot));
        assert!(!rig.world.rider(me).unwrap().turns_locked);
    }

    #[test]
    fn race_is_closed_once_running() {
        let mut rig = Rig::new(vec![race_def()]);
        let (a, b) = (rig.human("Anna", 3.0), rig.human("Ben", 3.0));
        rig.run_to(100.0, &[]);
        assert_eq!(
            rig.events.join(&mut rig.world, a, "race", rig.now),
            Err(EventError::NotOpen)
        );
        rig.run_to(200.0, &[]);
        rig.events.join(&mut rig.world, a, "race", rig.now).unwrap();
        rig.run_to(310.0, &[(a, 200.0), (b, 200.0)]);
        assert_eq!(
            rig.events.join(&mut rig.world, b, "race", rig.now),
            Err(EventError::Closed)
        );
        assert_eq!(
            rig.events.join(&mut rig.world, b, "nope", rig.now),
            Err(EventError::Unknown)
        );
    }

    #[test]
    fn stuck_race_is_force_finished() {
        let mut rig = Rig::new(vec![race_def()]);
        let me = rig.human("Anna", 3.0);
        rig.run_to(200.0, &[(me, 0.0)]);
        rig.events.join(&mut rig.world, me, "race", rig.now).unwrap();
        rig.run_to(301.0, &[(me, 0.0)]);
        rig.remove_bots();
        rig.run_to(1199.0, &[(me, 0.0)]);
        assert!(rig.finished().is_none());
        rig.run_to(1201.0, &[(me, 0.0)]);
        let Some(EventNotice::Finished { results, .. }) = rig.finished() else {
            panic!("not force-finished")
        };
        let mine = results.iter().find(|r| r.rider_id == me).unwrap();
        assert_eq!((mine.place, mine.time_s), (None, None));
        assert!(rig.world.rider(me).is_some());
    }

    #[test]
    fn group_ride_distances_count_from_the_start_line_also_for_the_back_rows() {
        let mut rig = Rig::new(vec![ride_def()]);
        let (a, b) = (rig.human("A", 3.0), rig.human("B", 3.0));
        let powers = [(a, 200.0), (b, 200.0)];
        rig.run_to(200.0, &powers);
        rig.events.join(&mut rig.world, a, "ride", rig.now).unwrap();
        rig.events.join(&mut rig.world, b, "ride", rig.now).unwrap();
        rig.run_to(300.0 + DT, &powers);

        let active = rig.events.active[0].as_ref().expect("running");
        let route = rig.world.route(0);
        for e in &active.entrants {
            // Metres still to ride to the line: negative ridden distance.
            let to_line = route.forward_gap(rig.world.rider(e.id).unwrap().position, 0.0) % route.length();
            let to_line = if to_line > route.length() / 2.0 {
                to_line - route.length()
            } else {
                to_line
            };
            assert!(
                (e.distance_m + to_line).abs() < 0.5,
                "{}: {} vs {to_line}",
                e.name,
                e.distance_m
            );
        }
        assert!(
            active.entrants.iter().any(|e| e.distance_m < -2.0),
            "a back row starts behind the line"
        );
    }

    #[test]
    fn group_ride_shares_and_finishes() {
        let mut rig = Rig::new(vec![ride_def()]);
        let (strong, weak) = (rig.human("Strong", 5.0), rig.human("Weak", 1.8));
        let powers = [(strong, 400.0), (weak, 120.0)];
        rig.run_to(200.0, &powers);
        rig.events.join(&mut rig.world, strong, "ride", rig.now).unwrap();
        rig.events.join(&mut rig.world, weak, "ride", rig.now).unwrap();
        rig.run_to(301.0, &powers);
        assert!(rig.world.rider(strong).unwrap().in_group_ride);
        let (mut gave, mut got) = (false, false);
        while rig.finished().is_none() && rig.now < 1800.0 {
            rig.tick(&powers);
            let (given, received) = sharing_balance(&rig);
            assert!((given - received).abs() < 1e-6, "{given} vs {received}");
            gave |= rig
                .events
                .view_for(&rig.world, strong, rig.now)
                .and_then(|v| v.sharing)
                .is_some_and(|f| f.given_w > 0.0);
            got |= rig
                .events
                .view_for(&rig.world, weak, rig.now)
                .and_then(|v| v.sharing)
                .is_some_and(|f| f.received_w > 0.0);
        }
        assert!(gave && got);
        let Some(EventNotice::Finished { results, kind, .. }) = rig.finished() else {
            panic!("no finish")
        };
        assert_eq!(*kind, EventKind::GroupRide);
        let find = |id| results.iter().find(|r| r.rider_id == id).unwrap();
        assert!(find(strong).given_kj > 0.0);
        assert!(find(weak).received_kj > 0.0);
        assert!(find(strong).time_s.is_some() && find(weak).time_s.is_some());
        assert_eq!(rig.world.rider(weak).unwrap().power_adjust, 0.0);
        assert!(!rig.world.rider(weak).unwrap().in_group_ride);
    }

    #[test]
    fn late_joiner_starts_at_the_back() {
        let mut rig = Rig::new(vec![ride_def()]);
        let (a, b, c) = (rig.human("A", 3.0), rig.human("B", 3.0), rig.human("C", 3.0));
        let powers = [(a, 250.0), (b, 220.0), (c, 200.0)];
        rig.run_to(200.0, &powers);
        rig.events.join(&mut rig.world, a, "ride", rig.now).unwrap();
        rig.events.join(&mut rig.world, b, "ride", rig.now).unwrap();
        rig.run_to(360.0, &powers);
        let last = rig
            .world
            .riders()
            .filter(|r| r.in_group_ride)
            .min_by(|x, y| x.odometer.total_cmp(&y.odometer))
            .unwrap();
        let last_position = last.position;
        assert_eq!(rig.events.join(&mut rig.world, c, "ride", rig.now), Ok(()));
        let joiner = rig.world.rider(c).unwrap();
        assert!((joiner.position - (last_position - 5.0).rem_euclid(LAP_M)).abs() < 1e-9);
        assert!(joiner.in_group_ride && joiner.turns_locked);
        let view = rig.events.view_for(&rig.world, c, rig.now).unwrap();
        assert!(view.entered);
        assert_eq!(view.entrants.len(), 3);
        rig.run_to(362.0, &powers);
        let gap = rig
            .events
            .view_for(&rig.world, c, rig.now)
            .unwrap()
            .sharing
            .unwrap()
            .gap_s;
        assert!(gap.abs() < 15.0);
    }

    #[test]
    fn disconnect_clears_sharing() {
        let mut rig = Rig::new(vec![ride_def()]);
        let (strong, weak, mid) = (rig.human("Strong", 5.0), rig.human("Weak", 1.8), rig.human("Mid", 3.5));
        let powers = [(strong, 400.0), (weak, 120.0), (mid, 250.0)];
        rig.run_to(200.0, &powers);
        for id in [strong, weak, mid] {
            rig.events.join(&mut rig.world, id, "ride", rig.now).unwrap();
        }
        rig.run_to(301.0, &powers);
        rig.remove_bots();
        let receiving = |rig: &Rig| {
            let view = rig.events.view_for(&rig.world, weak, rig.now);
            view.and_then(|v| v.sharing).is_some_and(|f| f.received_w > 0.0)
        };
        while rig.now < 700.0 && !receiving(&rig) {
            rig.tick(&powers);
        }
        assert!(
            rig.world.rider(strong).unwrap().power_adjust < 0.0,
            "sharing never started"
        );
        rig.events.rider_gone(&mut rig.world, weak);
        rig.world.leave(weak);
        let powers = [(strong, 400.0), (mid, 250.0)];
        rig.tick(&powers);
        assert_eq!(rig.world.rider(strong).unwrap().power_adjust, 0.0);
        assert_eq!(rig.world.rider(mid).unwrap().power_adjust, 0.0);
        let view = rig.events.view_for(&rig.world, strong, rig.now).unwrap();
        assert_eq!(view.entrants.len(), 2);
    }

    #[test]
    fn gaps_use_event_distance() {
        let mut rig = Rig::new(vec![ride_def()]);
        let (a, b) = (rig.human("A", 3.0), rig.human("B", 3.0));
        let powers = [(a, 200.0), (b, 200.0)];
        rig.run_to(200.0, &powers);
        rig.events.join(&mut rig.world, a, "ride", rig.now).unwrap();
        rig.events.join(&mut rig.world, b, "ride", rig.now).unwrap();
        rig.run_to(310.0, &powers);
        // Either side of the start/finish line of the lap: 20 m apart on the road.
        rig.world.place_at(a, LAP_M - 10.0);
        rig.world.place_at(b, 10.0);
        rig.run_to(313.0, &powers);
        for id in [a, b] {
            let flow = rig.events.view_for(&rig.world, id, rig.now).unwrap().sharing.unwrap();
            assert!(flow.gap_s.abs() < 15.0, "{flow:?}");
            assert_eq!((flow.given_w, flow.received_w), (0.0, 0.0));
        }
    }

    #[test]
    fn entrants_cannot_turn() {
        let mut rig = Rig::new(vec![ride_def()]);
        let me = rig.human("Anna", 3.0);
        rig.run_to(200.0, &[(me, 200.0)]);
        // No junctions on this route: a free rider gets "no such turn", an entrant "racing".
        assert_eq!(rig.world.choose_turn(me, None), Err(WorldError::NoSuchTurn));
        rig.events.join(&mut rig.world, me, "ride", rig.now).unwrap();
        assert_eq!(rig.world.choose_turn(me, None), Err(WorldError::Racing));
        rig.events.leave(&mut rig.world, me);
        assert_eq!(rig.world.choose_turn(me, None), Err(WorldError::NoSuchTurn));
        assert!(rig.events.view_for(&rig.world, me, rig.now).is_some_and(|v| !v.entered));
    }

    #[test]
    fn bots_only_event_runs_quietly() {
        let mut rig = Rig::new(vec![race_def()]);
        rig.run_to(301.0, &[]);
        assert_eq!(rig.world.bot_count(), 12);
        while rig.finished().is_none() && rig.now < 1500.0 {
            rig.tick(&[]);
        }
        let Some(EventNotice::Finished { announce, results, .. }) = rig.finished() else {
            panic!("no finish")
        };
        assert!(!announce);
        assert!(results.iter().all(|r| r.is_bot));
    }

    fn late_ride_def(starts_at_s: f64) -> EventDef {
        let mut def = ride_def();
        def.schedule = Schedule::Once {
            starts_at_s,
            lobby_s: 120.0,
            duration_s: 1500.0,
        };
        def
    }

    #[test]
    fn race_in_grace_is_finished_when_a_ride_lobby_opens_and_route_stays_reserved() {
        let mut rig = Rig::new(vec![race_def(), late_ride_def(1000.0)]);
        let me = rig.human("Anna", 3.0);
        rig.run_to(200.0, &[(me, 0.0)]);
        rig.events.join(&mut rig.world, me, "race", rig.now).unwrap();
        rig.run_to(301.0, &[(me, 0.0)]);
        rig.remove_bots();
        rig.run_to(870.0, &[(me, 0.0)]);
        assert!(rig.finished().is_none());
        assert_eq!(rig.world.start_race(1, Some(me)), Err(WorldError::EventScheduled));
        rig.run_to(890.0, &[(me, 0.0)]);
        assert!(
            rig.notices
                .iter()
                .any(|n| matches!(n, EventNotice::Finished { id, .. } if id == "race")),
            "race not finished when the ride lobby opened"
        );
        // Past the race's old grace end the ride's lobby and ride keep the route reserved.
        for until in [1100.0, 1300.0] {
            rig.run_to(until, &[(me, 0.0)]);
            assert_eq!(
                rig.world.start_race(1, Some(me)),
                Err(WorldError::EventScheduled),
                "t={until}"
            );
        }
    }

    #[test]
    fn group_ride_start_stops_a_manual_race() {
        let mut rig = Rig::new(vec![ride_def()]);
        let me = rig.human("Anna", 3.0);
        rig.world.start_race(20, Some(me)).unwrap();
        rig.run_to(200.0, &[(me, 200.0)]);
        assert!(
            rig.world.race(0).running_laps().is_some(),
            "{:?}",
            rig.world.race(0).phase()
        );
        rig.events.join(&mut rig.world, me, "ride", rig.now).unwrap();
        rig.run_to(301.0, &[(me, 200.0)]);
        assert!(
            rig.world.race(0).running_laps().is_none(),
            "{:?}",
            rig.world.race(0).phase()
        );
        assert!(rig.world.rider(me).unwrap().in_group_ride);
    }

    #[test]
    fn off_route_riders_cannot_join() {
        let mut rig = Rig::new(vec![ride_def()]);
        let me = rig.human("Anna", 3.0);
        rig.run_to(200.0, &[(me, 200.0)]);
        rig.world.force_off_route(me);
        assert_eq!(
            rig.events.join(&mut rig.world, me, "ride", rig.now),
            Err(EventError::NotOnRoute)
        );
    }

    #[test]
    fn seated_riders_cannot_join() {
        let mut rig = Rig::new(vec![ride_def()]);
        let me = rig.human("Anna", 3.0);
        rig.world
            .create_vehicle(me, crate::vehicle::VehicleKind::Tandem, false, &|_| false)
            .unwrap();
        rig.run_to(200.0, &[(me, 200.0)]);
        assert_eq!(
            rig.events.join(&mut rig.world, me, "ride", rig.now),
            Err(EventError::InVehicle)
        );
    }

    #[test]
    fn an_event_running_at_boot_waits_for_its_next_slot() {
        let mut rig = Rig::new(vec![race_def()]);
        rig.now = 400.0;
        rig.run_to(401.0, &[]);
        assert!(rig.notices.is_empty(), "{:?}", rig.notices);
        assert_eq!(rig.world.bot_count(), 0);
        let me = rig.human("Anna", 3.0);
        assert_eq!(rig.world.start_race(1, Some(me)), Ok(()), "route was reserved");
    }

    #[test]
    fn a_group_ride_running_at_boot_can_be_joined() {
        let mut rig = Rig::new(vec![ride_def()]);
        rig.now = 400.0;
        rig.run_to(401.0, &[]);
        assert!(rig.notices.is_empty(), "{:?}", rig.notices);
        let infos = rig.events.infos(rig.now);
        assert_eq!(infos[0].phase, Phase::Running);
        let me = rig.human("Anna", 3.0);
        assert_eq!(rig.events.join(&mut rig.world, me, "ride", rig.now), Ok(()));
        rig.run_to(402.0, &[(me, 200.0)]);
        assert!(rig.world.rider(me).unwrap().in_group_ride);
        assert_eq!(rig.events.infos(rig.now)[0].entrants, 1);
        // Leaving and a second join work on the same, already running ride.
        rig.events.leave(&mut rig.world, me);
        assert_eq!(rig.events.join(&mut rig.world, me, "ride", rig.now), Ok(()));
    }

    #[test]
    fn the_occurrence_after_a_boot_mid_run_works() {
        let mut rig = Rig::new(vec![race_def()]);
        rig.now = 400.0;
        rig.run_to(800.0, &[]);
        assert!(matches!(rig.notices.as_slice(), [EventNotice::Lobby { .. }]));
        rig.run_to(901.0, &[]);
        assert!(rig.notices.iter().any(|n| matches!(n, EventNotice::Started { .. })));
    }

    #[test]
    fn a_zero_lobby_event_still_opens_after_boot() {
        let mut def = race_def();
        def.schedule = Schedule::Every {
            every_s: 600.0,
            offset_s: 300.0,
            lobby_s: 0.0,
            duration_s: 300.0,
        };
        let mut rig = Rig::new(vec![def]);
        rig.run_to(301.0, &[]);
        assert!(rig.notices.iter().any(|n| matches!(n, EventNotice::Started { .. })));
    }

    #[test]
    fn infos_show_the_next_occurrence() {
        let rig = Rig::new(vec![race_def()]);
        let infos = rig.events.infos(0.0);
        assert_eq!(infos.len(), 1);
        assert_eq!((infos[0].starts_at_s, infos[0].lobby_opens_at_s), (300.0, 180.0));
        assert_eq!((infos[0].phase, infos[0].entrants), (Phase::Upcoming, 0));
    }
}
