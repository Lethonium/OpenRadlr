//! The vehicle lifecycle of the world: create, board, leave and seat bots.
//!
//! Seats stay ordinary riders in the world; `World::seat_of` and the
//! [`Vehicle`] link them. Seated riders are not population: the balancing of
//! bots ignores them.

use super::{Controller, Rider, RiderId, Roads, RouteIndex, VehicleChange, World, WorldError, WorldEvent};
use crate::bot::{BotBrain, BotProfile, DEFAULT_LEVEL_WKG};
use crate::names;
use crate::physics::{self, StepInput};
use crate::vehicle::{draw_code, summed_power, Vehicle, VehicleId, VehicleKind};

impl World {
    pub fn vehicle(&self, id: VehicleId) -> Option<&Vehicle> {
        self.vehicles.get(&id)
    }

    /// The vehicle the rider sits in, if any.
    pub fn vehicle_of(&self, rider: RiderId) -> Option<&Vehicle> {
        self.seat_of.get(&rider).and_then(|id| self.vehicles.get(id))
    }

    pub fn vehicle_by_code(&self, code: &str) -> Option<VehicleId> {
        self.vehicles.values().find(|v| v.code == code).map(|v| v.id)
    }

    pub fn vehicles(&self) -> impl Iterator<Item = &Vehicle> {
        self.vehicles.values()
    }

    /// True if the rider sits in a vehicle (bots included).
    pub fn is_seated(&self, rider: RiderId) -> bool {
        self.seat_of.contains_key(&rider)
    }

    /// Where boarding codes come from. The default is seeded and predictable,
    /// fine for tests; a server must hand in OS randomness, or anyone who can
    /// guess the source can board other people's vehicles.
    pub fn set_code_source(&mut self, source: Box<dyn crate::rng::RandomSource>) {
        self.code_rng = source;
    }

    /// Puts `captain` in seat 0 of a new vehicle; with `bots_fill`, seat bots
    /// take the other seats. The boarding code avoids those `code_taken`
    /// reports (codes of vehicles in other worlds) and this world's own.
    pub fn create_vehicle(
        &mut self,
        captain: RiderId,
        kind: VehicleKind,
        bots_fill: bool,
        code_taken: &dyn Fn(&str) -> bool,
    ) -> Result<VehicleId, WorldError> {
        let valid = match kind {
            VehicleKind::Tandem => kind.seats() == 2,
            VehicleKind::BeerBike { seats } => matches!(seats, 5 | 7 | 9),
        };
        if !valid {
            return Err(WorldError::BadSeatCount);
        }
        let rider = self.riders.get(&captain).ok_or(WorldError::UnknownRider(captain))?;
        if rider.is_bot() {
            return Err(WorldError::NotHuman(captain));
        }
        if self.seat_of.contains_key(&captain) {
            return Err(WorldError::AlreadyAboard);
        }
        if self.in_event(captain) {
            return Err(WorldError::InEvent);
        }
        let route = rider.route;
        let code = loop {
            let code = draw_code(self.code_rng.as_mut());
            if !code_taken(&code) && self.vehicle_by_code(&code).is_none() {
                break code;
            }
        };
        let id = self.next_vehicle_id;
        self.next_vehicle_id = self.next_vehicle_id.wrapping_add(1).max(1);
        let mut seats = vec![None; kind.seats()];
        seats[0] = Some(captain);
        self.vehicles.insert(
            id,
            Vehicle {
                id,
                kind,
                code,
                seats,
                captain,
                bots_fill,
            },
        );
        self.seat_of.insert(captain, id);
        if let Some(rider) = self.riders.get_mut(&captain) {
            rider.parked = false;
        }
        self.events.push(WorldEvent::Vehicle {
            id,
            route,
            change: VehicleChange::Created,
        });
        if bots_fill {
            for seat in 1..kind.seats() {
                self.fill_seat_with_bot(id, seat);
            }
        }
        self.balance_population();
        Ok(id)
    }

    /// Seats a human in the first empty seat, else in place of the first seat
    /// bot, and moves them to the vehicle. Returns the seat index.
    pub fn board(&mut self, vehicle: VehicleId, rider: RiderId) -> Result<usize, WorldError> {
        let v = self.vehicles.get(&vehicle).ok_or(WorldError::NoSuchVehicle)?;
        let r = self.riders.get(&rider).ok_or(WorldError::UnknownRider(rider))?;
        if r.is_bot() {
            return Err(WorldError::NotHuman(rider));
        }
        if self.seat_of.contains_key(&rider) {
            return Err(WorldError::AlreadyAboard);
        }
        if self.in_event(rider) {
            return Err(WorldError::InEvent);
        }
        let is_bot = |seat: &Option<RiderId>| seat.is_some_and(|id| self.riders.get(&id).is_some_and(Rider::is_bot));
        let seat = v
            .seats
            .iter()
            .position(Option::is_none)
            .or_else(|| v.seats.iter().position(is_bot))
            .ok_or(WorldError::VehicleFull)?;
        let replaced = v.seats[seat];
        if let Some(bot) = replaced {
            self.seat_of.remove(&bot);
            self.leave_without_rebalance(bot);
        }
        if let Some(v) = self.vehicles.get_mut(&vehicle) {
            v.seats[seat] = Some(rider);
        }
        self.seat_of.insert(rider, vehicle);
        if let Some(r) = self.riders.get_mut(&rider) {
            r.parked = false;
        }
        self.sync_with_captain(vehicle, rider);
        let route = self.riders.get(&rider).map_or(0, |r| r.route);
        self.events.push(WorldEvent::Vehicle {
            id: vehicle,
            route,
            change: VehicleChange::Boarded(rider),
        });
        self.relevel_seat_bots(vehicle);
        self.balance_population();
        Ok(seat)
    }

    /// Gets a rider out of their vehicle; they ride on solo from the same
    /// spot. Does nothing when not seated.
    pub fn leave_vehicle(&mut self, rider: RiderId) {
        if self.seat_of.contains_key(&rider) {
            self.unseat(rider);
            self.balance_population();
        }
    }

    /// Takes a rider out of their seat (see [`World::leave_vehicle`]) without
    /// rebalancing the population.
    pub(super) fn unseat(&mut self, rider: RiderId) {
        let Some(id) = self.seat_of.remove(&rider) else {
            return;
        };
        let Some(vehicle) = self.vehicles.get_mut(&id) else {
            return;
        };
        let Some(seat) = vehicle.seats.iter().position(|s| *s == Some(rider)) else {
            return;
        };
        vehicle.seats[seat] = None;
        let was_captain = vehicle.captain == rider;
        let route = self.riders.get(&vehicle.captain).map_or(0, |r| r.route);
        let Some(leaver) = self.riders.get_mut(&rider) else {
            return;
        };
        if leaver.is_bot() {
            return;
        }
        leaver.turns_locked = false;
        self.events.push(WorldEvent::Vehicle {
            id,
            route,
            change: VehicleChange::Left(rider),
        });

        let next = self.vehicles[&id]
            .seats
            .iter()
            .flatten()
            .copied()
            .find(|seated| self.riders.get(seated).is_some_and(|r| !r.is_bot()));
        let Some(next) = next else {
            self.dissolve(id, route);
            return;
        };
        if was_captain {
            if let Some(v) = self.vehicles.get_mut(&id) {
                v.captain = next;
            }
            if let Some(r) = self.riders.get_mut(&next) {
                r.turns_locked = false;
            }
            self.events.push(WorldEvent::Vehicle {
                id,
                route,
                change: VehicleChange::CaptainChanged(next),
            });
        }
        if self.vehicles[&id].bots_fill {
            self.fill_seat_with_bot(id, seat);
        }
        self.relevel_seat_bots(id);
    }

    /// Removes a vehicle without humans and its seat bots.
    fn dissolve(&mut self, id: VehicleId, route: RouteIndex) {
        let Some(vehicle) = self.vehicles.remove(&id) else {
            return;
        };
        for bot in vehicle.seats.into_iter().flatten() {
            self.seat_of.remove(&bot);
            self.leave_without_rebalance(bot);
        }
        self.events.push(WorldEvent::Vehicle {
            id,
            route,
            change: VehicleChange::Dissolved { code: vehicle.code },
        });
    }

    /// Entered in a race, riding an event, or holding turns for one.
    fn in_event(&self, rider: RiderId) -> bool {
        self.is_entered(rider)
            || self
                .riders
                .get(&rider)
                .is_some_and(|r| r.in_group_ride || r.turns_locked)
    }

    /// The level seat bots ride at: the humans' average (a default with none).
    fn seat_level(&self, vehicle: VehicleId) -> f64 {
        let levels: Vec<f64> = self.vehicles[&vehicle]
            .seats
            .iter()
            .flatten()
            .filter_map(|id| self.riders.get(id))
            .filter(|r| !r.is_bot())
            .filter_map(|r| r.level_wkg)
            .collect();
        if levels.is_empty() {
            DEFAULT_LEVEL_WKG
        } else {
            levels.iter().sum::<f64>() / levels.len() as f64
        }
    }

    /// Replaces the profiles of the vehicle's seat bots by the current level.
    pub(super) fn relevel_seat_bots(&mut self, vehicle: VehicleId) {
        let level = self.seat_level(vehicle);
        let tuning = self.config.bot_tuning;
        let seated: Vec<RiderId> = self.vehicles[&vehicle].seats.iter().flatten().copied().collect();
        for id in seated {
            if let Some(Rider {
                controller: Controller::Bot(brain),
                ..
            }) = self.riders.get_mut(&id)
            {
                let mut profile = brain.profile().clone();
                profile.ftp_wkg = level;
                **brain = BotBrain::new(profile, tuning);
            }
        }
    }

    fn fill_seat_with_bot(&mut self, vehicle: VehicleId, seat: usize) {
        let route = self.riders.get(&self.vehicles[&vehicle].captain).map_or(0, |r| r.route);
        let bot = self.spawn_seat_bot(route, self.seat_level(vehicle));
        if let Some(v) = self.vehicles.get_mut(&vehicle) {
            v.seats[seat] = Some(bot);
        }
        self.seat_of.insert(bot, vehicle);
        self.sync_with_captain(vehicle, bot);
    }

    /// Copies the captain's place on the road to `rider`; a seated rider
    /// other than the captain can't turn.
    fn sync_with_captain(&mut self, vehicle: VehicleId, rider: RiderId) {
        let captain = self.vehicles[&vehicle].captain;
        let Some(c) = self.riders.get(&captain) else {
            return;
        };
        let (route, position, off_route, lane, target_lane, turn, speed) =
            (c.route, c.position, c.off_route, c.lane, c.target_lane, c.turn, c.speed);
        if let Some(r) = self.riders.get_mut(&rider) {
            r.route = route;
            r.position = position;
            r.off_route = off_route;
            r.lane = lane;
            r.target_lane = target_lane;
            r.turn = turn;
            r.speed = speed;
            r.turns_locked = rider != captain;
        }
    }

    /// One physics step per vehicle: the seats' summed power pushes the
    /// vehicle along its captain's road, and every seat takes the captain's
    /// place. `drafts` holds each vehicle's draft factor.
    pub(super) fn step_vehicles(&mut self, dt: f64, drafts: &[(VehicleId, f64)]) {
        let lane_step = dt / self.config.lane_change_s.max(1e-6);
        let roads = Roads {
            routes: &self.routes,
            steps: &self.steps,
            network: self.network.as_ref(),
        };
        for &(id, cda_factor) in drafts {
            let Some(vehicle) = self.vehicles.get(&id) else {
                continue;
            };
            let seated: Vec<&Rider> = vehicle
                .seats
                .iter()
                .flatten()
                .filter_map(|s| self.riders.get(s))
                .collect();
            let powers: Vec<f64> = seated.iter().map(|r| (r.power + r.power_adjust).max(0.0)).collect();
            let rider_mass_kg: f64 = seated.iter().map(|r| r.mass_kg).sum();
            let power_watts = summed_power(&powers);
            let body = self.config.vehicles.body(vehicle.kind);
            let (captain_id, seat_ids) = (vehicle.captain, seated.iter().map(|r| r.id).collect::<Vec<_>>());
            let Some(captain) = self.riders.get_mut(&captain_id) else {
                continue;
            };

            let grade = roads.grade(captain);
            captain.speed = physics::step_speed(
                &self.config.physics,
                &StepInput {
                    rider_mass_kg,
                    body,
                    speed: captain.speed,
                    power_watts,
                    grade_percent: grade,
                    cda_factor,
                },
                dt,
            );
            let advance = captain.speed * dt;
            roads.advance(captain, advance);
            let target = f64::from(captain.target_lane);
            captain.lane += (target - captain.lane).clamp(-lane_step, lane_step);
            let c = captain.clone();

            for seat in seat_ids {
                let Some(r) = self.riders.get_mut(&seat) else {
                    continue;
                };
                r.speed = c.speed;
                r.route = c.route;
                r.position = c.position;
                r.off_route = c.off_route;
                r.lane = c.lane;
                r.target_lane = c.target_lane;
                r.turn = c.turn;
                r.odometer += advance;
            }
        }
    }

    /// Adds a bot for a vehicle seat at the steady group pace of `level_wkg`.
    fn spawn_seat_bot(&mut self, route: RouteIndex, level_wkg: f64) -> RiderId {
        let id = self.allocate_id();
        let taken: Vec<&str> = self.riders.values().map(|r| r.name.as_str()).collect();
        let name = names::generate_unique(self.rng.as_mut(), &taken);
        let mut profile = BotProfile::random(self.rng.as_mut());
        profile.ftp_wkg = level_wkg;
        let lane = self.routes[route].lanes() / 2;
        let mass_kg = profile.weight_kg;
        self.riders.insert(
            id,
            Rider {
                id,
                name: name.clone(),
                controller: Controller::Bot(Box::new(BotBrain::new(profile, self.config.bot_tuning))),
                mass_kg,
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
                // The steady pace of a group ride; events pick their members
                // from their own lists, so the flag selects nobody else.
                in_group_ride: true,
                power_adjust: 0.0,
                turns_locked: false,
                parked: false,
                workout: false,
                boxed_s: 0.0,
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
}

#[cfg(test)]
mod tests {
    use super::super::tests::{empty_world, junction_world, place, ride, world_with, DT};
    use super::super::*;
    use crate::route::tests::{flat_loop, square_loop};
    use crate::vehicle::{VehicleId, VehicleKind};
    use std::cell::RefCell;

    fn no_codes_taken(_: &str) -> bool {
        false
    }

    fn human(world: &mut World, name: &str, level: f64) -> RiderId {
        let id = world.join_human_on(0, name, 70.0).unwrap();
        world.set_level(id, level).unwrap();
        id
    }

    fn bots_of(world: &World, vehicle: VehicleId) -> Vec<RiderId> {
        world
            .vehicle(vehicle)
            .unwrap()
            .seats
            .iter()
            .flatten()
            .copied()
            .filter(|id| world.rider(*id).unwrap().is_bot())
            .collect()
    }

    #[test]
    fn creating_seats_the_captain_up_front() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        world.drain_events();
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        let vehicle = world.vehicle_of(anna).unwrap();
        assert_eq!(vehicle.kind, VehicleKind::Tandem);
        assert_eq!(vehicle.seats, vec![Some(anna), None]);
        assert_eq!(vehicle.captain, anna);
        assert_eq!(world.vehicle_by_code(&vehicle.code.clone()), Some(id));
        assert!(world.drain_events().contains(&WorldEvent::Vehicle {
            id,
            route: 0,
            change: VehicleChange::Created
        }));
    }

    #[test]
    fn invalid_seat_counts_are_refused() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        for seats in [0, 1, 4, 6, 8, 10] {
            let result = world.create_vehicle(anna, VehicleKind::BeerBike { seats }, true, &no_codes_taken);
            assert_eq!(result, Err(WorldError::BadSeatCount));
        }
        assert!(!world.is_seated(anna));
    }

    #[test]
    fn bots_fill_the_free_seats() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let before = world.riders().count();
        let id = world
            .create_vehicle(anna, VehicleKind::BeerBike { seats: 7 }, true, &no_codes_taken)
            .unwrap();
        assert_eq!(bots_of(&world, id).len(), 6);
        assert_eq!(world.riders().count(), before + 6);
        assert!(world.vehicle(id).unwrap().seats.iter().all(Option::is_some));
    }

    #[test]
    fn seat_bots_match_the_humans() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.5);
        let id = world
            .create_vehicle(anna, VehicleKind::BeerBike { seats: 5 }, true, &no_codes_taken)
            .unwrap();
        let levels = |world: &World| -> Vec<f64> {
            bots_of(world, id)
                .into_iter()
                .map(|b| match &world.rider(b).unwrap().controller {
                    Controller::Bot(brain) => brain.profile().ftp_wkg,
                    Controller::Human { .. } => unreachable!(),
                })
                .collect()
        };
        assert_eq!(levels(&world), vec![3.5; 4]);
        let ben = human(&mut world, "Ben", 2.5);
        world.board(id, ben).unwrap();
        let after = levels(&world);
        assert_eq!(after.len(), 3);
        assert!(after.iter().all(|l| (l - 3.0).abs() < 1e-9), "{after:?}");
    }

    #[test]
    fn boarding_replaces_a_bot() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, true, &no_codes_taken)
            .unwrap();
        let bot = world.vehicle(id).unwrap().seats[1].unwrap();
        let ben = human(&mut world, "Ben", 3.0);
        assert_eq!(world.board(id, ben), Ok(1));
        assert!(world.rider(bot).is_none());
        assert_eq!(world.vehicle(id).unwrap().seats, vec![Some(anna), Some(ben)]);
        assert!(world.rider(ben).unwrap().turns_locked);
        assert!(!world.rider(anna).unwrap().turns_locked);
    }

    #[test]
    fn boarding_moves_the_rider_to_the_vehicle() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        ride(&mut world, 5.0, &[(anna, 250.0)]);
        world.place_at(anna, 500.0);
        world.shift_lane(anna, 1).unwrap();
        ride(&mut world, 1.0, &[(anna, 250.0)]);
        let ben = human(&mut world, "Ben", 3.0);
        assert_eq!(world.rider(ben).unwrap().position, 0.0);
        world.board(id, ben).unwrap();
        let (a, b) = (world.rider(anna).unwrap(), world.rider(ben).unwrap());
        assert!(a.position > 500.0 && a.speed > 1.0);
        assert_eq!(
            (b.route, b.position, b.lane, b.target_lane, b.speed),
            (a.route, a.position, a.lane, a.target_lane, a.speed)
        );
    }

    #[test]
    fn a_full_vehicle_refuses_boarders() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        let ben = human(&mut world, "Ben", 3.0);
        let cleo = human(&mut world, "Cleo", 3.0);
        assert_eq!(world.board(id, ben), Ok(1));
        assert_eq!(world.board(id, cleo), Err(WorldError::VehicleFull));
        assert_eq!(world.board(99, cleo), Err(WorldError::NoSuchVehicle));
    }

    #[test]
    fn boarding_twice_is_refused() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::BeerBike { seats: 5 }, false, &no_codes_taken)
            .unwrap();
        let ben = human(&mut world, "Ben", 3.0);
        world.board(id, ben).unwrap();
        assert_eq!(world.board(id, ben), Err(WorldError::AlreadyAboard));
        assert_eq!(world.board(id, anna), Err(WorldError::AlreadyAboard));
    }

    #[test]
    fn racers_cannot_board_and_seated_cannot_race() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        let racer = human(&mut world, "Rex", 3.0);
        world.start_race(1, Some(racer)).unwrap();
        assert_eq!(world.board(id, racer), Err(WorldError::InEvent));
        assert_eq!(world.join_race(anna), Err(WorldError::InEvent));
        assert!(!world.is_entered(anna));
    }

    #[test]
    fn a_seated_rider_cannot_start_a_race() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        assert_eq!(world.start_race(1, Some(anna)), Err(WorldError::InEvent));
        assert!(!world.is_entered(anna));
        assert_eq!(world.entrants(0).count(), 0);
        assert!(matches!(world.race(0).phase(), RacePhase::Idle));
        assert!(world.start_race(1, None).is_ok());
    }

    #[test]
    fn a_dropout_becomes_a_bot() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, true, &no_codes_taken)
            .unwrap();
        let ben = human(&mut world, "Ben", 3.0);
        world.board(id, ben).unwrap();
        assert!(world.leave(ben));
        let seat = world.vehicle(id).unwrap().seats[1].unwrap();
        assert!(world.rider(seat).unwrap().is_bot());

        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        let ben = human(&mut world, "Ben", 3.0);
        world.board(id, ben).unwrap();
        world.leave(ben);
        assert_eq!(world.vehicle(id).unwrap().seats[1], None);
    }

    #[test]
    fn the_captain_hands_over() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        let ben = human(&mut world, "Ben", 3.0);
        world.board(id, ben).unwrap();
        assert!(world.rider(ben).unwrap().turns_locked);
        world.drain_events();
        world.leave(anna);
        assert_eq!(world.vehicle(id).unwrap().captain, ben);
        assert!(!world.rider(ben).unwrap().turns_locked);
        let events = world.drain_events();
        assert!(events.contains(&WorldEvent::Vehicle {
            id,
            route: 0,
            change: VehicleChange::Left(anna)
        }));
        assert!(events.contains(&WorldEvent::Vehicle {
            id,
            route: 0,
            change: VehicleChange::CaptainChanged(ben)
        }));
    }

    #[test]
    fn the_last_human_dissolves_the_vehicle() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::BeerBike { seats: 5 }, true, &no_codes_taken)
            .unwrap();
        let code = world.vehicle(id).unwrap().code.clone();
        let ben = human(&mut world, "Ben", 3.0);
        world.board(id, ben).unwrap();
        world.drain_events();
        world.leave(anna);
        assert_eq!(world.vehicles().count(), 1);
        world.leave(ben);
        assert_eq!(world.vehicles().count(), 0);
        assert_eq!(world.riders().count(), 0);
        assert!(world.vehicle_by_code(&code).is_none());
        assert!(world.drain_events().contains(&WorldEvent::Vehicle {
            id,
            route: 0,
            change: VehicleChange::Dissolved { code }
        }));
    }

    #[test]
    fn leaving_the_vehicle_rides_on_solo() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        let ben = human(&mut world, "Ben", 3.0);
        world.board(id, ben).unwrap();
        ride(&mut world, 20.0, &[(anna, 200.0), (ben, 200.0)]);
        let before = world.rider(ben).unwrap().clone();
        assert!(before.speed > 4.0);
        world.leave_vehicle(ben);
        let after = world.rider(ben).unwrap();
        assert_eq!(
            (after.position, after.lane, after.speed),
            (before.position, before.lane, before.speed)
        );
        assert!(!after.turns_locked);
        assert!(world.vehicle_of(ben).is_none());
        assert_eq!(world.vehicle(id).unwrap().seats, vec![Some(anna), None]);
        // Not seated: a second call changes nothing.
        world.leave_vehicle(ben);
    }

    #[test]
    fn seat_bots_are_not_population() {
        let mut world = world_with(
            square_loop(),
            SimConfig {
                target_riders: 12,
                ..SimConfig::default()
            },
        );
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::BeerBike { seats: 9 }, true, &no_codes_taken)
            .unwrap();
        let seated = bots_of(&world, id);
        assert_eq!(seated.len(), 8);
        ride(&mut world, 10.0, &[(anna, 150.0)]);
        let free = world.riders().filter(|r| !world.seat_of.contains_key(&r.id)).count();
        assert_eq!(free, 12);
        assert!(seated.iter().all(|b| world.rider(*b).is_some()));
    }

    #[test]
    fn codes_avoid_taken_ones() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let first = RefCell::new(None::<String>);
        let taken = |code: &str| {
            let mut first = first.borrow_mut();
            if first.is_none() {
                *first = Some(code.to_owned());
                return true;
            }
            false
        };
        let id = world.create_vehicle(anna, VehicleKind::Tandem, false, &taken).unwrap();
        let first = first.into_inner().unwrap();
        let code = &world.vehicle(id).unwrap().code;
        assert_ne!(*code, first);
        assert_eq!(world.vehicle_by_code(code), Some(id));
    }

    /// Always the same bits: every code character is the alphabet's first.
    struct Zeros;
    impl crate::rng::RandomSource for Zeros {
        fn next_u64(&mut self) -> u64 {
            0
        }
    }

    #[test]
    fn boarding_codes_come_from_the_code_source_not_the_world_rng() {
        let mut world = empty_world(square_loop());
        world.set_code_source(Box::new(Zeros));
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        assert_eq!(world.vehicle(id).unwrap().code, "AAAAAA");
    }

    /// Boards `n` more humans of 70 kg; returns all of the vehicle's humans.
    fn crew(world: &mut World, vehicle: VehicleId, captain: RiderId, n: usize) -> Vec<RiderId> {
        let mut all = vec![captain];
        for i in 0..n {
            let id = human(world, &format!("Crew{i}"), 3.0);
            world.board(vehicle, id).unwrap();
            all.push(id);
        }
        all
    }

    fn powers(ids: &[RiderId], watts: f64) -> Vec<(RiderId, f64)> {
        ids.iter().map(|&id| (id, watts)).collect()
    }

    #[test]
    fn summed_power_moves_the_vehicle() {
        let mut tandem_world = empty_world(flat_loop(10_000.0));
        let anna = human(&mut tandem_world, "Anna", 3.0);
        let id = tandem_world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        let both = crew(&mut tandem_world, id, anna, 1);
        ride(&mut tandem_world, 60.0, &powers(&both, 150.0));

        let mut solo_world = empty_world(flat_loop(10_000.0));
        let cleo = human(&mut solo_world, "Cleo", 3.0);
        ride(&mut solo_world, 60.0, &[(cleo, 150.0)]);

        let tandem_speed = tandem_world.rider(anna).unwrap().speed;
        let solo_speed = solo_world.rider(cleo).unwrap().speed;
        assert!(tandem_speed > solo_speed + 0.5, "{tandem_speed} vs {solo_speed}");
    }

    #[test]
    fn every_seat_shares_one_place() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::BeerBike { seats: 5 }, true, &no_codes_taken)
            .unwrap();
        let seats: Vec<RiderId> = world.vehicle(id).unwrap().seats.iter().flatten().copied().collect();
        let before: Vec<f64> = seats.iter().map(|s| world.rider(*s).unwrap().odometer).collect();
        ride(&mut world, 30.0, &[(anna, 150.0)]);
        let first = world.rider(seats[0]).unwrap();
        assert!(first.position > 10.0 && first.speed > 1.0);
        let increment = first.odometer - before[0];
        for (seat, start) in seats.iter().zip(&before) {
            let r = world.rider(*seat).unwrap();
            assert_eq!(r.position, first.position);
            assert_eq!(r.lane, first.lane);
            assert_eq!(r.speed, first.speed);
            assert!((r.odometer - start - increment).abs() < 1e-9);
        }
    }

    #[test]
    fn every_seat_feels_the_same_grade() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::BeerBike { seats: 5 }, true, &no_codes_taken)
            .unwrap();
        world.place_at(anna, 300.0);
        ride(&mut world, 3.0, &[(anna, 250.0)]);
        let seats: Vec<RiderId> = world.vehicle(id).unwrap().seats.iter().flatten().copied().collect();
        let grade = world.grade_for(anna).unwrap();
        assert!(grade > 1.0, "on the climb: {grade}");
        for seat in seats {
            assert_eq!(world.grade_for(seat), Some(grade));
        }
    }

    #[test]
    fn seats_do_not_draft_each_other() {
        let mut world = empty_world(flat_loop(10_000.0));
        let anna = human(&mut world, "Anna", 3.0);
        let kind = VehicleKind::BeerBike { seats: 5 };
        let id = world.create_vehicle(anna, kind, false, &no_codes_taken).unwrap();
        let all = crew(&mut world, id, anna, 4);
        ride(&mut world, 30.0, &powers(&all, 200.0));

        let config = SimConfig::default();
        let mut speed = 0.0;
        for _ in 0..(30.0 / DT).round() as usize {
            speed = physics::step_speed(
                &config.physics,
                &StepInput {
                    rider_mass_kg: 5.0 * 70.0,
                    body: config.vehicles.body(kind),
                    speed,
                    power_watts: 1000.0,
                    grade_percent: 0.0,
                    cda_factor: 1.0,
                },
                DT,
            );
        }
        assert!((world.rider(anna).unwrap().speed - speed).abs() < 1e-9);
    }

    /// One tick of a rider at 8 m/s and 200 W, with a beer bike (captain only)
    /// 2 m ahead in lane `bike_lane` if given.
    fn follower_speed(follower_lane: f64, bike_lane: Option<f64>) -> f64 {
        let mut world = empty_world(flat_loop(10_000.0));
        let me = human(&mut world, "Me", 3.0);
        if let Some(lane) = bike_lane {
            let captain = human(&mut world, "Captain", 3.0);
            world
                .create_vehicle(captain, VehicleKind::BeerBike { seats: 5 }, false, &no_codes_taken)
                .unwrap();
            place(&mut world, captain, 103.5, 8.0);
            let c = world.riders.get_mut(&captain).unwrap();
            c.lane = lane;
            c.target_lane = lane as u8;
        }
        place(&mut world, me, 100.0, 8.0);
        let r = world.riders.get_mut(&me).unwrap();
        r.lane = follower_lane;
        r.target_lane = follower_lane as u8;
        ride(&mut world, DT, &[(me, 200.0)]);
        world.rider(me).unwrap().speed
    }

    #[test]
    fn riders_draft_behind_a_beer_bike() {
        // The expected factor comes from the draft curve: 3.5 m behind, between
        // min_gap 2 and max_gap 6.5 -> t = 1/3 -> 1 - 0.5 * (1 - 1/3) = 2/3.
        let config = SimConfig::default();
        let draft = config.vehicles.draft(VehicleKind::BeerBike { seats: 5 }, &config.draft);
        let factor = draft.cda_factor(3.5);
        assert!((factor - 2.0 / 3.0).abs() < 1e-9);
        let expected = physics::step_speed(
            &config.physics,
            &StepInput {
                rider_mass_kg: 70.0,
                body: physics::Body::bike(&config.physics),
                speed: 8.0,
                power_watts: 200.0,
                grade_percent: 0.0,
                cda_factor: factor,
            },
            DT,
        );
        let alone = follower_speed(2.0, None);
        // The bike is wide: the neighbouring lane is "behind" it as well.
        for lane in [2.0, 3.0] {
            let behind = follower_speed(lane, Some(2.0));
            assert!(behind > alone, "{behind} vs {alone}");
            assert!((behind - expected).abs() < 1e-9, "{behind} vs {expected}");
        }
        // Two lanes over is clear air.
        assert!((follower_speed(0.0, Some(2.0)) - alone).abs() < 1e-12);
    }

    #[test]
    fn only_the_captain_steers() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        let both = crew(&mut world, id, anna, 1);
        let ben = both[1];
        let lane = world.rider(anna).unwrap().lane;
        assert_eq!(world.shift_lane(ben, 1), Err(WorldError::NotCaptain));
        assert_eq!(world.rider(ben).unwrap().target_lane, lane as u8);
        ride(&mut world, 1.0, &powers(&both, 150.0));
        assert_eq!(world.rider(anna).unwrap().lane, lane);

        assert_eq!(world.shift_lane(anna, 1), Ok(lane as u8 + 1));
        ride(&mut world, 1.0, &powers(&both, 150.0));
        for seat in both {
            assert!((world.rider(seat).unwrap().lane - lane - 1.0).abs() < 1e-9);
        }
    }

    #[test]
    fn the_vehicle_turns_together() {
        let mut world = junction_world();
        let anna = world.join_human_on(1, "Anna", 70.0).unwrap();
        let diagonal = 1000.0 * 2f64.sqrt();
        place(&mut world, anna, 990.0 + diagonal, 10.0);
        let id = world
            .create_vehicle(anna, VehicleKind::BeerBike { seats: 5 }, true, &no_codes_taken)
            .unwrap();
        let seats: Vec<RiderId> = world.vehicle(id).unwrap().seats.iter().flatten().copied().collect();
        assert_eq!(world.choose_turn(seats[1], Some("cd")), Err(WorldError::NotCaptain));
        assert_eq!(world.rider(seats[1]).unwrap().turn, None);
        world.choose_turn(anna, Some("cd")).unwrap();
        ride(&mut world, 2.0, &[(anna, 250.0)]);
        let captain = world.rider(anna).unwrap().clone();
        let road = captain.off_route.expect("riding c-d, no route's way").road;
        for seat in &seats {
            let r = world.rider(*seat).unwrap();
            assert_eq!(r.off_route.map(|o| o.road), Some(road));
            assert_eq!(r.route, captain.route);
            assert_eq!(r.turn, captain.turn);
        }
    }

    #[test]
    fn boarding_off_route_joins_the_vehicle_there() {
        let mut world = junction_world();
        let anna = world.join_human_on(1, "Anna", 70.0).unwrap();
        let diagonal = 1000.0 * 2f64.sqrt();
        place(&mut world, anna, 990.0 + diagonal, 10.0);
        let id = world
            .create_vehicle(anna, VehicleKind::Tandem, false, &no_codes_taken)
            .unwrap();
        world.choose_turn(anna, Some("cd")).unwrap();
        ride(&mut world, 2.0, &[(anna, 250.0)]);
        let off = world.rider(anna).unwrap().off_route;
        assert!(off.is_some());
        let ben = world.join_human_on(1, "Ben", 70.0).unwrap();
        assert_eq!(world.rider(ben).unwrap().off_route, None);
        world.board(id, ben).unwrap();
        assert_eq!(world.rider(ben).unwrap().off_route, off);
    }

    #[test]
    fn solo_physics_is_unchanged() {
        let mut world = empty_world(square_loop());
        let anna = human(&mut world, "Anna", 3.0);
        ride(&mut world, 60.0, &[(anna, 200.0)]);
        let odometer = world.rider(anna).unwrap().odometer;
        assert!((odometer - SOLO_ODOMETER).abs() < 1e-9, "{odometer:?}");
    }

    /// Recorded on c10a43d, before vehicles had their own physics step.
    const SOLO_ODOMETER: f64 = 417.085_126_413_022_8;

    #[test]
    fn huge_power_is_capped() {
        let mut world = empty_world(flat_loop(10_000.0));
        let anna = human(&mut world, "Anna", 3.0);
        let id = world
            .create_vehicle(anna, VehicleKind::BeerBike { seats: 9 }, false, &no_codes_taken)
            .unwrap();
        let all = crew(&mut world, id, anna, 8);
        ride(&mut world, 60.0, &powers(&all, 2500.0));
        let speed = world.rider(anna).unwrap().speed;
        assert!(speed > 5.0 && speed <= world.config.physics.max_speed, "{speed}");
    }

    #[test]
    fn a_beer_bike_drafts_a_rider_one_lane_over() {
        let config = SimConfig::default();
        let mut world = empty_world(flat_loop(10_000.0));
        let rider = human(&mut world, "Rider", 3.0);
        let captain = human(&mut world, "Captain", 3.0);
        let kind = VehicleKind::BeerBike { seats: 5 };
        let id = world.create_vehicle(captain, kind, false, &no_codes_taken).unwrap();
        let all = crew(&mut world, id, captain, 4);
        place(&mut world, rider, 102.0, 8.0);
        place(&mut world, captain, 100.0, 8.0);
        world.riders.get_mut(&rider).unwrap().lane = 3.0;
        world.riders.get_mut(&rider).unwrap().target_lane = 3;
        for seat in &all {
            let r = world.riders.get_mut(seat).unwrap();
            r.lane = 2.0;
            r.target_lane = 2;
        }
        ride(&mut world, DT, &powers(&all, 200.0));
        let expected = physics::step_speed(
            &config.physics,
            &StepInput {
                rider_mass_kg: 350.0,
                body: config.vehicles.body(kind),
                speed: 8.0,
                power_watts: 1000.0,
                grade_percent: 0.0,
                cda_factor: config.draft.cda_factor(2.0),
            },
            DT,
        );
        assert!((world.rider(captain).unwrap().speed - expected).abs() < 1e-9);
    }

    #[test]
    fn solo_riders_keep_the_strict_lane_rule() {
        // Half a lane apart is not the same lane, exactly or within noise.
        for offset in [0.5, 0.5 + 1e-12, 0.5 - 1e-12] {
            let mut world = empty_world(flat_loop(10_000.0));
            let me = human(&mut world, "Me", 3.0);
            let ahead = human(&mut world, "Ahead", 3.0);
            place(&mut world, me, 100.0, 8.0);
            place(&mut world, ahead, 103.5, 8.0);
            world.riders.get_mut(&ahead).unwrap().lane = 1.0 + offset;
            let drafted = follower_speed(1.0, None);
            ride(&mut world, DT, &[(me, 200.0)]);
            let speed = world.rider(me).unwrap().speed;
            if offset < 0.5 {
                assert!(speed > drafted, "{offset}");
            } else {
                assert_eq!(speed, drafted, "{offset}");
            }
        }
    }
}
