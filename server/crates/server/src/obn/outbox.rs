//! Turns this server's riders into the OpenBikeNet messages for one route.
//!
//! The outbox remembers which riders have joined and their laps. Each frame it
//! answers with the `join`, `update` and `leave` messages the app should send;
//! the connection decides when to send them.

use std::collections::BTreeMap;

use openradlr_sim::RiderId;

use super::wire::{AppMessage, RiderEntry, RiderState};
use super::{SharedRoute, OBN_ROOM};

/// One of this server's riders, as the game loop sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct LocalRider {
    pub id: RiderId,
    /// The OpenBikeNet id of the shared route the rider is on.
    pub route: String,
    pub name: String,
    /// Metres along the route from its start line.
    pub position: f64,
    pub speed: f64,
    pub power: f64,
    pub cadence: Option<f64>,
}

/// A rider this outbox has joined, on which route, with its lap count since joining.
#[derive(Debug, Clone)]
struct Joined {
    route: String,
    lap: u32,
    last_position: f64,
}

/// Messages for the OpenBikeNet routes of one connection, built frame by frame.
#[derive(Debug)]
pub struct Outbox {
    routes: Vec<SharedRoute>,
    joined: BTreeMap<RiderId, Joined>,
}

impl Outbox {
    pub fn new(routes: Vec<SharedRoute>) -> Self {
        Self {
            routes,
            joined: BTreeMap::new(),
        }
    }

    /// The messages for one frame: leaves for riders that are gone or moved to another
    /// route (rider keys are unique per connection, so the leave goes first), joins for
    /// new riders, and one `update` for the riders that joined earlier, on any route.
    /// Riders on routes this outbox doesn't share are left out. Empty when there is
    /// nothing to say.
    pub fn frame(&mut self, riders: &[LocalRider]) -> Vec<AppMessage> {
        let riders: Vec<(&LocalRider, &SharedRoute)> = riders
            .iter()
            .filter_map(|rider| {
                let route = self.routes.iter().find(|route| route.id == rider.route)?;
                Some((rider, route))
            })
            .collect();

        let mut messages = Vec::new();
        self.joined.retain(|id, joined| {
            let stays = riders
                .iter()
                .any(|(rider, _)| rider.id == *id && rider.route == joined.route);
            if !stays {
                messages.push(AppMessage::Leave { rider: rider_key(*id) });
            }
            stays
        });

        let mut entries = Vec::new();
        for (rider, route) in riders {
            match self.joined.get_mut(&rider.id) {
                Some(joined) => {
                    // Positions wrap at the start line: a big step back is a crossing.
                    if joined.last_position - rider.position > route.local_length_m / 2.0 {
                        joined.lap += 1;
                    }
                    joined.last_position = rider.position;
                    entries.push(RiderEntry {
                        rider: rider_key(rider.id),
                        state: state_of(joined.lap, rider, route),
                    });
                }
                None => {
                    self.joined.insert(
                        rider.id,
                        Joined {
                            route: route.id.clone(),
                            lap: 0,
                            last_position: rider.position,
                        },
                    );
                    // The join carries the starting state; an update in the same
                    // frame would be rate limited (the server counts the join as one).
                    messages.push(AppMessage::Join {
                        rider: rider_key(rider.id),
                        route: route.id.clone(),
                        room: OBN_ROOM.into(),
                        name: rider.name.clone(),
                        state: state_of(0, rider, route),
                    });
                }
            }
        }
        if !entries.is_empty() {
            messages.push(AppMessage::Update { riders: entries });
        }
        messages
    }

    /// Forgets every joined rider. The next frame joins them all again from lap 0.
    pub fn reset(&mut self) {
        self.joined.clear();
    }

    /// The routes this outbox shares, to subscribe to.
    pub fn routes(&self) -> &[SharedRoute] {
        &self.routes
    }
}

/// The app's rider value for one of this server's riders (spec 6.3: `r<id>`).
fn rider_key(id: RiderId) -> String {
    format!("r{id}")
}

fn state_of(lap: u32, rider: &LocalRider, route: &SharedRoute) -> RiderState {
    RiderState {
        lap,
        distance: route.shared_distance(rider.position),
        speed: speed_m_s(rider.speed),
        power: Some(finite_or_zero(rider.power).round().clamp(0.0, 3000.0) as u32),
        cadence: rider
            .cadence
            .map(|cadence| finite_or_zero(cadence).round().clamp(0.0, 250.0) as u32),
    }
}

/// Speed in m/s, rounded to centimetres per second and within 0 to 30 (spec 6.4).
fn speed_m_s(speed: f64) -> f64 {
    (finite_or_zero(speed) * 100.0).round().clamp(0.0, 3000.0) / 100.0
}

/// A value the wire format cannot carry (NaN, infinity) is sent as zero.
fn finite_or_zero(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::obn::wire::AppMessage;

    const LENGTH: f64 = 250.0;

    fn rider(id: RiderId, position: f64) -> LocalRider {
        rider_on(id, "velodrome-250", position)
    }

    fn rider_on(id: RiderId, route: &str, position: f64) -> LocalRider {
        LocalRider {
            id,
            route: route.into(),
            name: format!("rider {id}"),
            position,
            speed: 10.0,
            power: 200.0,
            cadence: Some(90.0),
        }
    }

    fn outbox() -> Outbox {
        Outbox::new(vec![SharedRoute::new("velodrome-250", 250.0, LENGTH)])
    }

    fn two_tracks() -> Outbox {
        Outbox::new(vec![
            SharedRoute::new("velodrome-250", 250.0, 250.0),
            SharedRoute::new("herne-hill-450", 450.0, 450.0),
        ])
    }

    fn kinds(messages: &[AppMessage]) -> Vec<&'static str> {
        messages
            .iter()
            .map(|m| match m {
                AppMessage::Join { .. } => "join",
                AppMessage::Update { .. } => "update",
                AppMessage::Leave { .. } => "leave",
                AppMessage::Hello { .. } | AppMessage::Subscribe { .. } | AppMessage::Ping { .. } => "other",
            })
            .collect()
    }

    fn update_entries(messages: &[AppMessage]) -> Vec<crate::obn::wire::RiderEntry> {
        match messages.last() {
            Some(AppMessage::Update { riders }) => riders.clone(),
            other => panic!("expected an update last, got {other:?}"),
        }
    }

    /// The state of the only rider in a frame, whether it joined or was updated.
    fn state_of_only(messages: &[AppMessage]) -> RiderState {
        match messages.first() {
            Some(AppMessage::Join { state, .. }) => state.clone(),
            Some(AppMessage::Update { riders }) => riders[0].state.clone(),
            other => panic!("expected a join or an update, got {other:?}"),
        }
    }

    #[test]
    fn first_frame_only_joins_then_updates() {
        let mut outbox = outbox();
        let first = outbox.frame(&[rider(7, 10.0)]);
        assert_eq!(kinds(&first), ["join"]);

        let second = outbox.frame(&[rider(7, 20.0)]);
        assert_eq!(kinds(&second), ["update"]);
    }

    #[test]
    fn a_joining_rider_is_not_updated_in_the_same_frame() {
        let mut outbox = outbox();
        outbox.frame(&[rider(7, 10.0)]);
        let frame = outbox.frame(&[rider(7, 20.0), rider(8, 30.0)]);
        assert_eq!(kinds(&frame), ["join", "update"]);
        let updated: Vec<String> = update_entries(&frame).into_iter().map(|e| e.rider).collect();
        assert_eq!(updated, ["r7"]);
        assert!(matches!(&frame[0], AppMessage::Join { rider, .. } if rider == "r8"));
    }

    #[test]
    fn riders_on_two_tracks_join_their_own_and_share_one_update() {
        let mut outbox = two_tracks();
        let first = outbox.frame(&[rider_on(7, "velodrome-250", 10.0), rider_on(8, "herne-hill-450", 400.0)]);
        assert_eq!(kinds(&first), ["join", "join"]);
        let joins: Vec<(&str, f64)> = first
            .iter()
            .map(|m| match m {
                AppMessage::Join { route, state, .. } => (route.as_str(), state.distance),
                other => panic!("expected a join, got {other:?}"),
            })
            .collect();
        assert_eq!(joins, [("velodrome-250", 10.0), ("herne-hill-450", 400.0)]);

        let second = outbox.frame(&[rider_on(7, "velodrome-250", 20.0), rider_on(8, "herne-hill-450", 410.0)]);
        assert_eq!(kinds(&second), ["update"]);
        assert_eq!(update_entries(&second).len(), 2);
    }

    #[test]
    fn a_rider_who_changes_track_leaves_before_joining_the_other() {
        let mut outbox = two_tracks();
        outbox.frame(&[rider_on(7, "velodrome-250", 240.0)]);
        outbox.frame(&[rider_on(7, "velodrome-250", 0.5)]); // lap 1

        let moved = outbox.frame(&[rider_on(7, "herne-hill-450", 5.0)]);
        assert_eq!(kinds(&moved), ["leave", "join"]);
        assert!(
            matches!(&moved[1], AppMessage::Join { route, state, .. } if route == "herne-hill-450" && state.lap == 0)
        );
    }

    #[test]
    fn riders_on_routes_that_are_not_shared_are_left_out() {
        let mut outbox = two_tracks();
        assert!(outbox.frame(&[rider_on(7, "rolling-hills", 10.0)]).is_empty());
    }

    #[test]
    fn missing_rider_leaves() {
        let mut outbox = outbox();
        outbox.frame(&[rider(7, 10.0)]);

        let gone = outbox.frame(&[]);
        assert_eq!(gone, vec![AppMessage::Leave { rider: "r7".into() }]);
        assert!(outbox.frame(&[]).is_empty());
    }

    #[test]
    fn lap_counts_line_crossings() {
        let mut outbox = outbox();
        let positions = [240.0, 249.9, 0.4, 120.0];
        let laps: Vec<u32> = positions
            .iter()
            .map(|&p| state_of_only(&outbox.frame(&[rider(7, p)])).lap)
            .collect();
        assert_eq!(laps, [0, 0, 1, 1]);
    }

    #[test]
    fn a_small_step_back_is_not_a_lap() {
        let mut outbox = outbox();
        let laps: Vec<u32> = [100.0, 99.9]
            .iter()
            .map(|&p| state_of_only(&outbox.frame(&[rider(7, p)])).lap)
            .collect();
        assert_eq!(laps, [0, 0]);
    }

    #[test]
    fn the_lap_threshold_is_half_a_route() {
        let lap_after = |back_to: f64| {
            let mut outbox = outbox();
            outbox.frame(&[rider(7, 200.0)]);
            update_entries(&outbox.frame(&[rider(7, back_to)]))[0].state.lap
        };
        assert_eq!(lap_after(75.1), 0); // 124.9 back: not yet half a lap
        assert_eq!(lap_after(74.9), 1); // 125.1 back: a crossing
    }

    #[test]
    fn distance_stays_below_length() {
        let mut outbox = Outbox::new(vec![SharedRoute::new("velodrome-250", 250.0, 250.004)]);
        outbox.frame(&[rider(7, 1.0)]);
        let at_end = update_entries(&outbox.frame(&[rider(7, 250.004)]));
        assert!(at_end[0].state.distance < 250.0);
        assert!((at_end[0].state.distance - 249.99).abs() < 0.01);

        let beyond = update_entries(&outbox.frame(&[rider(7, 251.0)]));
        assert!(beyond[0].state.distance < 250.0);

        let mut outbox = Outbox::new(vec![SharedRoute::new("velodrome-250", 250.0, 250.004)]);
        outbox.frame(&[rider(7, 1.0)]);
        let halfway = update_entries(&outbox.frame(&[rider(7, 125.002)]));
        assert!((halfway[0].state.distance - 125.0).abs() < 0.01);
    }

    #[test]
    fn values_are_clamped_and_rounded() {
        let mut outbox = outbox();
        let mut sample = |speed: f64, power: f64, cadence: Option<f64>| {
            let local = LocalRider {
                id: 7,
                route: "velodrome-250".into(),
                name: "Anna".into(),
                position: 10.0,
                speed,
                power,
                cadence,
            };
            state_of_only(&outbox.frame(&[local]))
        };

        let high_power = sample(10.0, 3456.7, Some(90.0));
        assert_eq!(high_power.power, Some(3000));

        let negative_power = sample(10.0, -5.0, Some(90.0));
        assert_eq!(negative_power.power, Some(0));

        let rounded_cadence = sample(10.0, 200.0, Some(91.6));
        assert_eq!(rounded_cadence.cadence, Some(92));

        let high_cadence = sample(10.0, 200.0, Some(300.0));
        assert_eq!(high_cadence.cadence, Some(250));

        let rounded_speed = sample(11.876, 200.0, None);
        assert_eq!(rounded_speed.speed, 11.88);

        let high_speed = sample(31.2, 200.0, None);
        assert_eq!(high_speed.speed, 30.0);

        let negative_speed = sample(-0.1, 200.0, None);
        assert_eq!(negative_speed.speed, 0.0);
    }

    #[test]
    fn reset_joins_everyone_again_from_lap_0() {
        let mut outbox = outbox();
        outbox.frame(&[rider(7, 240.0)]);
        outbox.frame(&[rider(7, 0.4)]); // crosses the line: lap 1
        outbox.reset();

        let after_reset = outbox.frame(&[rider(7, 0.5)]);
        assert_eq!(kinds(&after_reset), ["join"]);
        let AppMessage::Join { state, .. } = &after_reset[0] else {
            unreachable!()
        };
        assert_eq!(state.lap, 0);
    }
}
