//! Riders of other apps on the shared route.
//!
//! They never enter the simulation: this keeps the last known state of each one,
//! extrapolates it to "now" and hands out [`RemoteRider`]s for the state messages.

use std::collections::HashMap;

use openradlr_sim::RiderId;

use crate::game::clean_foreign_name;

use super::wire::{RemoteUpdate, RemoteView, ServerMessage};
use super::{OBN_LENGTH_M, OBN_ROOM};

/// Remote riders get ids from here upwards, far from the sim's own (which count up from 1).
const FIRST_REMOTE_ID: RiderId = 0xF000_0000;
/// Longest time a position is extrapolated from the last update.
const MAX_EXTRAPOLATION_S: f64 = 2.0;
/// A rider without an update for longer than this is hidden until the next one.
const STALE_AFTER_S: f64 = 10.0;
/// A rider without an update for longer than this is forgotten. Riders normally go
/// with `left` or a reset of the link; this only bounds what a lost `left` leaves behind.
const FORGET_AFTER_S: f64 = 300.0;

/// What happened on the link, as the game sees it.
#[derive(Debug, Clone, PartialEq)]
pub enum RemoteEvent {
    Message(ServerMessage),
    /// The link dropped: nobody can be trusted any more.
    Reset,
}

/// A rider of another app, ready to be shown.
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteRider {
    pub id: RiderId,
    pub app: String,
    pub name: String,
    /// Metres along the local route, extrapolated to now.
    pub distance: f64,
    pub speed: f64,
    pub power: f64,
    pub cadence: Option<f64>,
}

#[derive(Debug)]
struct Known {
    id: RiderId,
    app: String,
    name: String,
    /// Metres along the local route when last heard of.
    distance: f64,
    speed: f64,
    power: f64,
    cadence: Option<f64>,
    heard_at_s: f64,
}

/// The riders of other apps currently on the route.
#[derive(Debug)]
pub struct Remotes {
    /// The shared route subscribed to; messages about any other route or room are ignored.
    route: String,
    route_length_m: f64,
    next_id: RiderId,
    riders: HashMap<String, Known>,
}

impl Remotes {
    /// `route` is the shared route's id, `route_length_m` the length of the local route
    /// it is drawn onto.
    pub fn new(route: impl Into<String>, route_length_m: f64) -> Self {
        Self {
            route: route.into(),
            route_length_m,
            next_id: FIRST_REMOTE_ID,
            riders: HashMap::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.riders.len()
    }

    pub fn is_empty(&self) -> bool {
        self.riders.is_empty()
    }

    pub fn apply(&mut self, event: RemoteEvent, now_s: f64) {
        if let RemoteEvent::Message(message) = &event {
            if !self.subscribed_to(message) {
                return;
            }
        }
        match event {
            RemoteEvent::Reset => self.riders.clear(),
            RemoteEvent::Message(ServerMessage::Snapshot { riders, .. }) => {
                let mut old = std::mem::take(&mut self.riders);
                for view in riders {
                    let id = old.remove(&view.id).map_or_else(|| self.new_id(), |known| known.id);
                    self.insert(id, view, now_s);
                }
            }
            RemoteEvent::Message(ServerMessage::Joined { rider, .. }) => {
                let id = match self.riders.get(&rider.id) {
                    Some(known) => known.id,
                    None => self.new_id(),
                };
                self.insert(id, rider, now_s);
            }
            RemoteEvent::Message(ServerMessage::Updated { riders, .. }) => {
                for update in riders {
                    self.update(update, now_s);
                }
            }
            RemoteEvent::Message(ServerMessage::Left { id, .. }) => {
                self.riders.remove(&id);
            }
            RemoteEvent::Message(ServerMessage::Welcome {} | ServerMessage::Error { .. } | ServerMessage::Pong {}) => {}
        }
    }

    /// Everyone heard of lately, positions extrapolated to `now_s`. A rider silent for
    /// a while is left out but kept, so that an update after a stall brings them back.
    pub fn riders(&mut self, now_s: f64) -> Vec<RemoteRider> {
        self.riders
            .retain(|_, known| now_s - known.heard_at_s <= FORGET_AFTER_S);
        let length = self.route_length_m;
        let mut out: Vec<RemoteRider> = self
            .riders
            .values()
            .filter(|known| now_s - known.heard_at_s <= STALE_AFTER_S)
            .map(|known| {
                let age = (now_s - known.heard_at_s).clamp(0.0, MAX_EXTRAPOLATION_S);
                RemoteRider {
                    id: known.id,
                    app: known.app.clone(),
                    name: known.name.clone(),
                    distance: (known.distance + known.speed * age).rem_euclid(length),
                    speed: known.speed,
                    power: known.power,
                    cadence: known.cadence,
                }
            })
            .collect();
        out.sort_by_key(|r| r.id);
        out
    }

    /// Whether `message` is about the route and room subscribed to. Messages without
    /// either (welcome, error) are.
    fn subscribed_to(&self, message: &ServerMessage) -> bool {
        match message {
            ServerMessage::Snapshot { route, room, .. }
            | ServerMessage::Joined { route, room, .. }
            | ServerMessage::Updated { route, room, .. }
            | ServerMessage::Left { route, room, .. } => *route == self.route && room == OBN_ROOM,
            _ => true,
        }
    }

    fn new_id(&mut self) -> RiderId {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Metres on the shared route to metres on the local one.
    fn local(&self, distance: f64) -> f64 {
        distance * self.route_length_m / OBN_LENGTH_M
    }

    fn insert(&mut self, id: RiderId, view: RemoteView, now_s: f64) {
        // Names and app ids come from strangers: same filter as local names.
        let app = clean_foreign_name(&view.app).unwrap_or_else(|| "?".into());
        let name = clean_foreign_name(&view.name).unwrap_or_else(|| app.clone());
        let known = Known {
            id,
            app,
            name,
            distance: self.local(view.distance),
            speed: view.speed,
            power: view.power.unwrap_or(0.0),
            cadence: view.cadence,
            heard_at_s: now_s,
        };
        self.riders.insert(view.id, known);
    }

    fn update(&mut self, update: RemoteUpdate, now_s: f64) {
        let distance = self.local(update.distance);
        if let Some(known) = self.riders.get_mut(&update.id) {
            known.distance = distance;
            known.speed = update.speed;
            known.power = update.power.unwrap_or(0.0);
            known.cadence = update.cadence;
            known.heard_at_s = now_s;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(id: &str, name: &str, distance: f64, speed: f64) -> RemoteView {
        RemoteView {
            id: id.into(),
            app: "incyclist".into(),
            name: name.into(),
            lap: 0,
            distance,
            speed,
            power: Some(200.0),
            cadence: Some(90.0),
        }
    }

    fn snapshot(riders: Vec<RemoteView>) -> RemoteEvent {
        RemoteEvent::Message(ServerMessage::Snapshot {
            route: "velodrome-250".into(),
            room: "public".into(),
            riders,
        })
    }

    fn joined(rider: RemoteView) -> RemoteEvent {
        RemoteEvent::Message(ServerMessage::Joined {
            route: "velodrome-250".into(),
            room: "public".into(),
            rider,
        })
    }

    fn updated(id: &str, distance: f64, speed: f64) -> RemoteEvent {
        RemoteEvent::Message(ServerMessage::Updated {
            route: "velodrome-250".into(),
            room: "public".into(),
            riders: vec![RemoteUpdate {
                id: id.into(),
                lap: 0,
                distance,
                speed,
                power: None,
                cadence: None,
            }],
        })
    }

    fn left(id: &str) -> RemoteEvent {
        RemoteEvent::Message(ServerMessage::Left {
            route: "velodrome-250".into(),
            room: "public".into(),
            id: id.into(),
        })
    }

    fn remotes() -> Remotes {
        Remotes::new("velodrome-250", 250.0)
    }

    fn named<'a>(riders: &'a [RemoteRider], name: &str) -> &'a RemoteRider {
        riders.iter().find(|r| r.name == name).unwrap()
    }

    #[test]
    fn snapshot_adds_riders_with_new_ids() {
        let mut r = remotes();
        r.apply(
            snapshot(vec![view("a", "Ann", 10.0, 0.0), view("b", "Ben", 20.0, 0.0)]),
            0.0,
        );
        let riders = r.riders(0.0);
        assert_eq!(riders.len(), 2);
        assert_eq!(named(&riders, "Ann").id, 0xF000_0000);
        assert_eq!(named(&riders, "Ben").id, 0xF000_0001);
        assert_eq!(named(&riders, "Ann").app, "incyclist");
        assert_eq!(r.len(), 2);
    }

    #[test]
    fn a_new_snapshot_replaces_the_room() {
        let mut r = remotes();
        r.apply(
            snapshot(vec![view("a", "Ann", 10.0, 0.0), view("b", "Ben", 20.0, 0.0)]),
            0.0,
        );
        let ben = named(&r.riders(0.0), "Ben").id;
        r.apply(
            snapshot(vec![view("b", "Ben", 30.0, 0.0), view("c", "Cleo", 40.0, 0.0)]),
            1.0,
        );
        let riders = r.riders(1.0);
        assert_eq!(riders.len(), 2);
        assert_eq!(named(&riders, "Ben").id, ben);
        assert_eq!(named(&riders, "Ben").distance, 30.0);
        assert_eq!(named(&riders, "Cleo").id, 0xF000_0002);
    }

    #[test]
    fn updated_moves_a_known_rider() {
        let mut r = remotes();
        r.apply(joined(view("a", "Ann", 10.0, 0.0)), 0.0);
        r.apply(updated("a", 50.0, 0.0), 1.0);
        assert_eq!(r.riders(1.0)[0].distance, 50.0);
    }

    #[test]
    fn updated_ignores_unknown_riders() {
        let mut r = remotes();
        r.apply(updated("ghost", 50.0, 0.0), 1.0);
        assert!(r.is_empty());
    }

    #[test]
    fn left_removes() {
        let mut r = remotes();
        r.apply(joined(view("a", "Ann", 10.0, 0.0)), 0.0);
        r.apply(left("a"), 1.0);
        assert!(r.riders(1.0).is_empty());
    }

    #[test]
    fn reset_clears_everyone() {
        let mut r = remotes();
        r.apply(snapshot(vec![view("a", "Ann", 10.0, 0.0)]), 0.0);
        r.apply(RemoteEvent::Reset, 1.0);
        assert_eq!(r.len(), 0);
    }

    #[test]
    fn extrapolates_at_most_two_seconds() {
        let mut r = remotes();
        r.apply(joined(view("a", "Ann", 10.0, 10.0)), 0.0);
        assert_eq!(r.riders(1.0)[0].distance, 20.0);
        assert_eq!(r.riders(5.0)[0].distance, 30.0);
    }

    #[test]
    fn wraps_past_the_line() {
        let mut r = remotes();
        r.apply(joined(view("a", "Ann", 245.0, 10.0)), 0.0);
        assert_eq!(r.riders(1.0)[0].distance, 5.0);
    }

    #[test]
    fn stale_riders_are_hidden() {
        let mut r = remotes();
        r.apply(joined(view("a", "Ann", 10.0, 0.0)), 0.0);
        assert_eq!(r.riders(10.0).len(), 1);
        assert!(r.riders(10.1).is_empty());
    }

    #[test]
    fn an_update_brings_a_stale_rider_back() {
        let mut r = remotes();
        r.apply(joined(view("a", "Ann", 10.0, 0.0)), 0.0);
        let id = r.riders(0.0)[0].id;
        assert!(r.riders(11.0).is_empty());
        r.apply(updated("a", 60.0, 0.0), 12.0);
        let riders = r.riders(12.0);
        assert_eq!(
            (riders[0].id, riders[0].name.as_str(), riders[0].distance),
            (id, "Ann", 60.0)
        );
    }

    #[test]
    fn silent_riders_are_forgotten_after_five_minutes() {
        let mut r = remotes();
        r.apply(joined(view("a", "Ann", 10.0, 0.0)), 0.0);
        r.riders(300.0);
        assert_eq!(r.len(), 1);
        r.riders(300.1);
        assert_eq!(r.len(), 0);
    }

    fn elsewhere(event: RemoteEvent, route: &str, room: &str) -> RemoteEvent {
        let RemoteEvent::Message(mut message) = event else {
            panic!("not a message")
        };
        match &mut message {
            ServerMessage::Snapshot { route: a, room: b, .. }
            | ServerMessage::Joined { route: a, room: b, .. }
            | ServerMessage::Updated { route: a, room: b, .. }
            | ServerMessage::Left { route: a, room: b, .. } => {
                *a = route.into();
                *b = room.into();
            }
            _ => panic!("no route or room"),
        }
        RemoteEvent::Message(message)
    }

    #[test]
    fn a_snapshot_of_another_room_does_not_replace_ours() {
        let mut r = remotes();
        r.apply(snapshot(vec![view("a", "Ann", 10.0, 0.0)]), 0.0);
        r.apply(
            elsewhere(snapshot(vec![view("x", "Xan", 1.0, 0.0)]), "velodrome-250", "club"),
            0.0,
        );
        r.apply(elsewhere(snapshot(vec![]), "hill-climb", "public"), 0.0);
        let riders = r.riders(0.0);
        assert_eq!(riders.len(), 1);
        assert_eq!(riders[0].name, "Ann");
    }

    #[test]
    fn riders_of_another_route_or_room_are_ignored() {
        let mut r = remotes();
        r.apply(joined(view("a", "Ann", 10.0, 0.0)), 0.0);
        r.apply(
            elsewhere(joined(view("x", "Xan", 1.0, 0.0)), "hill-climb", "public"),
            0.0,
        );
        r.apply(elsewhere(updated("a", 99.0, 0.0), "velodrome-250", "club"), 1.0);
        r.apply(elsewhere(left("a"), "hill-climb", "public"), 1.0);
        let riders = r.riders(1.0);
        assert_eq!(riders.len(), 1);
        assert_eq!(riders[0].distance, 10.0);
    }

    #[test]
    fn ids_are_never_reused() {
        let mut r = remotes();
        r.apply(joined(view("a", "Ann", 10.0, 0.0)), 0.0);
        let first = r.riders(0.0)[0].id;
        r.apply(left("a"), 1.0);
        r.apply(joined(view("a", "Ann", 10.0, 0.0)), 2.0);
        assert_ne!(r.riders(2.0)[0].id, first);
    }

    #[test]
    fn distance_is_scaled_to_the_local_length() {
        let mut r = Remotes::new("velodrome-250", 500.0);
        r.apply(joined(view("a", "Ann", 100.0, 0.0)), 0.0);
        assert_eq!(r.riders(0.0)[0].distance, 200.0);
    }

    fn first(r: &mut Remotes) -> RemoteRider {
        r.riders(0.0).remove(0)
    }

    #[test]
    fn names_lose_invisible_and_control_characters() {
        let mut r = remotes();
        r.apply(joined(view("a", "Ben\u{202E}na\u{200B}mow\u{7}\n", 1.0, 0.0)), 0.0);
        assert_eq!(first(&mut r).name, "Bennamow");
    }

    #[test]
    fn names_are_cut_to_24_characters() {
        let mut r = remotes();
        r.apply(joined(view("a", &"x".repeat(32), 1.0, 0.0)), 0.0);
        assert_eq!(first(&mut r).name, "x".repeat(24));
    }

    #[test]
    fn an_empty_name_becomes_the_app_id() {
        let mut r = remotes();
        r.apply(joined(view("a", " \u{200B}\u{202E} ", 1.0, 0.0)), 0.0);
        assert_eq!(first(&mut r).name, "incyclist");
    }

    #[test]
    fn app_ids_are_cleaned_too() {
        let mut r = remotes();
        let mut rider = view("a", "Ann", 1.0, 0.0);
        rider.app = format!("in\u{202E}cy{}", "z".repeat(40));
        r.apply(joined(rider), 0.0);
        let shown = first(&mut r);
        assert_eq!(shown.app.chars().count(), 24);
        assert!(shown.app.starts_with("incyzzz"));
    }

    #[test]
    fn a_name_and_app_that_are_both_empty_show_a_question_mark() {
        let mut r = remotes();
        let mut rider = view("a", "\u{200B}", 1.0, 0.0);
        rider.app = "\u{200B}".into();
        r.apply(joined(rider), 0.0);
        let shown = first(&mut r);
        assert_eq!((shown.name.as_str(), shown.app.as_str()), ("?", "?"));
    }
}
