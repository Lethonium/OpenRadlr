//! The spin studio seen from the road: the studio's seats for road riders who
//! ask for them, and the riders near the studio building for the studio.
//! Shared by the studio's game and the valley's game, like `DistanceStats`.

use crate::protocol::RiderState;
use openradlr_sim::RiderId;
use std::sync::{Arc, Mutex};

/// How long, on the reader's clock, seats stay shown without the studio publishing again:
/// after that it stopped (closed or restarted). The cores' clocks are not comparable, so
/// readers count this themselves from when the generation last changed.
pub const SEAT_TTL_S: f64 = 1.0;

/// One rider on one studio bike.
#[derive(Debug, Clone, PartialEq)]
pub struct StudioSeat {
    pub id: RiderId,
    pub name: String,
    pub is_bot: bool,
    pub power: f64,
    pub cadence: Option<f64>,
    pub room: usize,
    pub seat: usize,
}

#[derive(Default)]
struct Shared {
    seats: Vec<StudioSeat>,
    generation: u64,
    road: Vec<RiderState>,
}

/// Cloning shares the registry.
#[derive(Clone, Default)]
pub struct StudioMirror {
    shared: Arc<Mutex<Shared>>,
}

impl StudioMirror {
    fn lock(&self) -> std::sync::MutexGuard<'_, Shared> {
        self.shared.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Replaces the studio's seats and bumps the generation.
    pub fn publish_seats(&self, seats: Vec<StudioSeat>) {
        let mut shared = self.lock();
        shared.seats = seats;
        shared.generation += 1;
    }

    /// The generation of the seats published last, and the seats.
    pub fn seats_snapshot(&self) -> (u64, Vec<StudioSeat>) {
        let shared = self.lock();
        (shared.generation, shared.seats.clone())
    }

    /// Replaces the road riders near the studio building.
    pub fn publish_road(&self, riders: Vec<RiderState>) {
        self.lock().road = riders;
    }

    pub fn road(&self) -> Vec<RiderState> {
        self.lock().road.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seat(id: RiderId) -> StudioSeat {
        StudioSeat {
            id,
            name: "Anna".into(),
            is_bot: false,
            power: 150.0,
            cadence: Some(90.0),
            room: 0,
            seat: 3,
        }
    }

    #[test]
    fn road_is_what_was_published_last() {
        let mirror = StudioMirror::default();
        assert!(mirror.road().is_empty());
        mirror.publish_road(vec![RiderState::studio_seat(&seat(1))]);
        mirror.publish_road(vec![
            RiderState::studio_seat(&seat(2)),
            RiderState::studio_seat(&seat(3)),
        ]);
        let ids: Vec<RiderId> = mirror.road().iter().map(|r| r.id).collect();
        assert_eq!(ids, vec![2, 3]);
    }
}
