//! Spin studio: stationary group classes (see ADR 11).
//!
//! Riders sit on bikes in rooms of [`SEATS_PER_ROOM`] seats and ride the same
//! class at the same time. Classes follow a rolling [`Timetable`] derived from
//! wall time: a slot every 30 minutes, 5 minutes of lobby, then the class.
//! Targets are fractions of each rider's FTP. Bots fill free seats and give
//! way to humans; when every room is full of humans, another room opens.

use crate::names;
use crate::physics::{step_speed, Body, PhysicsParams, StepInput};
use crate::rng::RandomSource;
use crate::schedule::Schedule;
use crate::RiderId;

/// A class starts every this many seconds (on the half hour).
pub const SLOT_S: u32 = 1800;
/// Free spinning and countdown before each class.
pub const LOBBY_S: u32 = 300;
/// The longest a class may be: the rest of the slot.
pub const CLASS_S: u32 = SLOT_S - LOBBY_S;
pub const SEATS_PER_ROOM: usize = 16;
/// Power within this share of the target counts as "on target".
pub const ON_TARGET_TOLERANCE: f64 = 0.10;
/// Target (fraction of FTP) for bots outside a class.
const LOBBY_INTENSITY: f64 = 0.5;

/// Humans take the best free seats first: front row from the middle out,
/// then the back row. Seats 0–7 are the front row, 8–15 the back row.
const SEAT_PREFERENCE: [usize; SEATS_PER_ROOM] = [3, 4, 2, 5, 1, 6, 0, 7, 11, 12, 10, 13, 9, 14, 8, 15];

/// One block of a class. Power ramps linearly from `from` to `to` (fractions
/// of FTP); `cadence` is the rpm range the instructor asks for.
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub duration_s: u32,
    pub from: f64,
    pub to: f64,
    pub cadence: Option<(u32, u32)>,
    pub cue: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClassPlan {
    pub id: String,
    pub name: String,
    pub description: String,
    pub segments: Vec<Segment>,
}

impl ClassPlan {
    pub fn duration_s(&self) -> u32 {
        self.segments.iter().map(|s| s.duration_s).sum()
    }

    /// The segment index and target (fraction of FTP) `elapsed_s` into the
    /// class, `None` before the start and after the end.
    pub fn target_at(&self, elapsed_s: f64) -> Option<(usize, f64)> {
        if elapsed_s < 0.0 {
            return None;
        }
        let mut start = 0.0;
        for (index, segment) in self.segments.iter().enumerate() {
            let duration = f64::from(segment.duration_s);
            if elapsed_s < start + duration {
                let t = (elapsed_s - start) / duration;
                return Some((index, segment.from + (segment.to - segment.from) * t));
            }
            start += duration;
        }
        None
    }
}

/// Where the timetable stands at one moment.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Clock {
    /// Slot number since the Unix epoch; changes when a new lobby opens.
    pub slot: u64,
    /// Index into the timetable's classes.
    pub class_index: usize,
    /// Unix time in seconds when the class starts (after the lobby).
    pub starts_at_s: f64,
    /// Seconds since the class started; negative during the lobby.
    pub elapsed_s: f64,
}

pub struct Timetable {
    classes: Vec<ClassPlan>,
    schedule: Schedule,
}

impl Timetable {
    /// # Panics
    /// If `classes` is empty or a class doesn't fit into a slot.
    pub fn new(classes: Vec<ClassPlan>) -> Self {
        assert!(!classes.is_empty(), "a timetable needs at least one class");
        for class in &classes {
            assert!(
                class.duration_s() > 0 && class.duration_s() <= CLASS_S,
                "class {} must last between 1 and {CLASS_S} s",
                class.id
            );
        }
        let schedule = Schedule::Every {
            every_s: f64::from(SLOT_S),
            offset_s: f64::from(LOBBY_S),
            lobby_s: f64::from(LOBBY_S),
            duration_s: f64::from(CLASS_S),
        };
        Self { classes, schedule }
    }

    pub fn classes(&self) -> &[ClassPlan] {
        &self.classes
    }

    pub fn at(&self, unix_s: f64) -> Clock {
        let occurrence = self
            .schedule
            .at(unix_s)
            .expect("a repeating schedule always has an occurrence");
        Clock {
            slot: occurrence.index,
            class_index: (occurrence.index % self.classes.len() as u64) as usize,
            starts_at_s: occurrence.starts_at_s,
            elapsed_s: unix_s - occurrence.starts_at_s,
        }
    }

    pub fn class(&self, clock: &Clock) -> &ClassPlan {
        &self.classes[clock.class_index]
    }

    /// The target (fraction of FTP) at `clock`, `None` outside the class.
    pub fn target(&self, clock: &Clock) -> Option<f64> {
        self.class(clock).target_at(clock.elapsed_s).map(|(_, target)| target)
    }
}

fn segment(duration_s: u32, from: f64, to: f64, cadence: (u32, u32), cue: &str) -> Segment {
    Segment {
        duration_s,
        from,
        to,
        cadence: Some(cadence),
        cue: cue.to_owned(),
    }
}

fn steady(duration_s: u32, power: f64, cadence: (u32, u32), cue: &str) -> Segment {
    segment(duration_s, power, power, cadence, cue)
}

fn intervals(repeat: u32, on: (u32, f64, (u32, u32)), off: (u32, f64, (u32, u32))) -> Vec<Segment> {
    (1..=repeat)
        .flat_map(|i| {
            [
                steady(on.0, on.1, on.2, &format!("Go! Interval {i} of {repeat}")),
                steady(off.0, off.1, off.2, "Easy, breathe"),
            ]
        })
        .collect()
}

fn class(id: &str, name: &str, description: &str, segments: Vec<Segment>) -> ClassPlan {
    ClassPlan {
        id: id.to_owned(),
        name: name.to_owned(),
        description: description.to_owned(),
        segments,
    }
}

/// The classes every studio rotates through, 25 minutes each.
pub fn builtin_classes() -> Vec<ClassPlan> {
    let warm_up = || segment(300, 0.5, 0.75, (85, 95), "Warm up and find your rhythm");
    let recover = |duration_s| steady(duration_s, 0.55, (90, 100), "Recover, spin it out");
    let cool_down = |duration_s| segment(duration_s, 0.6, 0.45, (80, 90), "Cool down, well done!");
    vec![
        class(
            "tempo",
            "Tempo Ride",
            "Steady tempo blocks with two seated climbs.",
            vec![
                warm_up(),
                steady(240, 0.80, (85, 95), "Settle into tempo"),
                steady(120, 0.90, (75, 85), "Add resistance: seated climb"),
                recover(60),
                steady(240, 0.85, (85, 95), "Tempo, block two"),
                steady(120, 0.95, (70, 80), "Heavy climb, stay seated"),
                recover(60),
                steady(180, 0.88, (90, 100), "Last tempo block, keep the cadence high"),
                cool_down(180),
            ],
        ),
        class(
            "hiit",
            "HIIT 30/30",
            "Two sets of 30-second all-outs. Short, hard, done.",
            [
                vec![warm_up(), steady(60, 0.6, (90, 100), "Get ready for the first set")],
                intervals(8, (30, 1.2, (95, 110)), (30, 0.5, (80, 90))),
                vec![steady(180, 0.55, (85, 95), "Recover and shake out your legs")],
                intervals(6, (30, 1.25, (95, 110)), (30, 0.5, (80, 90))),
                vec![cool_down(120)],
            ]
            .concat(),
        ),
        class(
            "climb-pyramid",
            "Climb Pyramid",
            "Three climbs up, two back down: low cadence, high torque.",
            vec![
                warm_up(),
                steady(120, 0.80, (75, 85), "Climb one: seated, steady"),
                recover(60),
                steady(180, 0.88, (70, 80), "Climb two: it gets steeper"),
                recover(60),
                steady(240, 0.95, (60, 75), "The summit: stand up for the last minute"),
                recover(90),
                steady(180, 0.88, (70, 80), "Back down the pyramid: climb two"),
                recover(60),
                steady(120, 0.80, (75, 85), "Last climb, you've got this"),
                cool_down(90),
            ],
        ),
        class(
            "sweet-spot",
            "Sweet Spot",
            "Two long blocks just below threshold. Builds the engine.",
            vec![
                warm_up(),
                steady(480, 0.90, (85, 95), "Sweet spot: eight minutes, find your groove"),
                recover(120),
                steady(480, 0.92, (85, 95), "Block two: hold it, smooth pedalling"),
                cool_down(120),
            ],
        ),
    ]
}

#[derive(Debug, Clone, PartialEq)]
pub struct StudioConfig {
    /// Humans plus bots each room tries to seat (at most [`SEATS_PER_ROOM`]).
    pub target_riders: usize,
    pub physics: PhysicsParams,
    /// Without telemetry for this long, a human stops pedalling.
    pub telemetry_timeout_s: f64,
    pub max_power_watts: f64,
}

impl Default for StudioConfig {
    fn default() -> Self {
        Self {
            target_riders: 12,
            physics: PhysicsParams::default(),
            telemetry_timeout_s: 3.0,
            max_power_watts: 2500.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Occupant {
    Human {
        seconds_since_telemetry: f64,
    },
    /// `effort` scales the target (some bots slack, some overdo it);
    /// `variance` is the relative noise on their power.
    Bot {
        effort: f64,
        variance: f64,
    },
}

/// A rider on a bike. Speed and distance come from flat-road physics so a
/// studio ride records like any other.
#[derive(Debug, Clone, PartialEq)]
pub struct SeatedRider {
    pub id: RiderId,
    pub name: String,
    pub occupant: Occupant,
    pub weight_kg: f64,
    pub ftp_watts: f64,
    pub power: f64,
    pub cadence: Option<f64>,
    pub speed: f64,
    pub distance: f64,
    /// Work during the current class, in joules.
    pub class_joules: f64,
    /// Seconds of the current class ridden, and of those on target.
    pub class_seconds: f64,
    pub on_target_seconds: f64,
}

impl SeatedRider {
    pub fn is_bot(&self) -> bool {
        matches!(self.occupant, Occupant::Bot { .. })
    }

    /// Share of the class ridden on target, 0–1; `None` before any class time.
    pub fn on_target_share(&self) -> Option<f64> {
        (self.class_seconds > 0.0).then(|| self.on_target_seconds / self.class_seconds)
    }

    fn reset_class(&mut self) {
        self.class_joules = 0.0;
        self.class_seconds = 0.0;
        self.on_target_seconds = 0.0;
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Room {
    /// Index = seat number, see [`SEAT_PREFERENCE`].
    pub seats: Vec<Option<SeatedRider>>,
}

impl Room {
    fn new() -> Self {
        Self {
            seats: vec![None; SEATS_PER_ROOM],
        }
    }

    pub fn riders(&self) -> impl Iterator<Item = (usize, &SeatedRider)> {
        self.seats
            .iter()
            .enumerate()
            .filter_map(|(seat, rider)| rider.as_ref().map(|r| (seat, r)))
    }

    pub fn human_count(&self) -> usize {
        self.riders().filter(|(_, r)| !r.is_bot()).count()
    }

    fn bot_seats(&self) -> Vec<usize> {
        self.riders()
            .filter(|(_, r)| r.is_bot())
            .map(|(seat, _)| seat)
            .collect()
    }

    fn free_seats(&self) -> Vec<usize> {
        (0..SEATS_PER_ROOM).filter(|&seat| self.seats[seat].is_none()).collect()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum StudioEvent {
    RiderJoined {
        room: usize,
        rider_id: RiderId,
        name: String,
        is_bot: bool,
    },
    RiderLeft {
        room: usize,
        rider_id: RiderId,
        name: String,
    },
}

pub struct Studio {
    timetable: Timetable,
    config: StudioConfig,
    rng: Box<dyn RandomSource>,
    rooms: Vec<Room>,
    now_s: f64,
    slot: u64,
    next_id: RiderId,
    events: Vec<StudioEvent>,
}

impl Studio {
    /// A studio whose clock starts at `now_s` (Unix seconds).
    pub fn new(timetable: Timetable, config: StudioConfig, rng: Box<dyn RandomSource>, now_s: f64) -> Self {
        let slot = timetable.at(now_s).slot;
        let mut studio = Self {
            timetable,
            config,
            rng,
            rooms: vec![Room::new()],
            now_s,
            slot,
            next_id: 1,
            events: Vec::new(),
        };
        studio.balance_bots();
        studio
    }

    pub fn timetable(&self) -> &Timetable {
        &self.timetable
    }

    pub fn clock(&self) -> Clock {
        self.timetable.at(self.now_s)
    }

    pub fn rooms(&self) -> &[Room] {
        &self.rooms
    }

    pub fn human_count(&self) -> usize {
        self.rooms.iter().map(Room::human_count).sum()
    }

    /// Room and seat of a rider.
    pub fn seat_of(&self, id: RiderId) -> Option<(usize, usize)> {
        self.rooms.iter().enumerate().find_map(|(room_index, room)| {
            room.riders()
                .find(|(_, r)| r.id == id)
                .map(|(seat, _)| (room_index, seat))
        })
    }

    pub fn rider(&self, id: RiderId) -> Option<&SeatedRider> {
        let (room, seat) = self.seat_of(id)?;
        self.rooms[room].seats[seat].as_ref()
    }

    pub fn drain_events(&mut self) -> Vec<StudioEvent> {
        std::mem::take(&mut self.events)
    }

    /// Seats a human in the first room that isn't full of humans, opening a
    /// new room if all are.
    pub fn join_human(&mut self, name: &str, weight_kg: f64, ftp_watts: f64) -> RiderId {
        let room_index = match self.rooms.iter().position(|room| room.human_count() < SEATS_PER_ROOM) {
            Some(index) => index,
            None => {
                self.rooms.push(Room::new());
                self.rooms.len() - 1
            }
        };
        // The best seat no human sits on; a bot there moves out (one bot
        // leaves for every human anyway once the room is at its target).
        let room = &self.rooms[room_index];
        let seat = SEAT_PREFERENCE
            .iter()
            .copied()
            .find(|&seat| room.seats[seat].as_ref().is_none_or(SeatedRider::is_bot))
            .expect("a room with fewer than 16 humans has a free or bot seat");
        self.vacate(room_index, seat);

        let id = self.allocate_id();
        self.rooms[room_index].seats[seat] = Some(SeatedRider {
            id,
            name: name.to_owned(),
            occupant: Occupant::Human {
                seconds_since_telemetry: 0.0,
            },
            weight_kg,
            ftp_watts,
            power: 0.0,
            cadence: None,
            speed: 0.0,
            distance: 0.0,
            class_joules: 0.0,
            class_seconds: 0.0,
            on_target_seconds: 0.0,
        });
        self.events.push(StudioEvent::RiderJoined {
            room: room_index,
            rider_id: id,
            name: name.to_owned(),
            is_bot: false,
        });
        self.balance_bots();
        id
    }

    /// Removes a rider. Returns `false` if the rider did not exist.
    pub fn leave(&mut self, id: RiderId) -> bool {
        let Some((room, seat)) = self.seat_of(id) else {
            return false;
        };
        self.vacate(room, seat);
        self.balance_bots();
        true
    }

    /// Latest power and cadence from a human's trainer.
    pub fn set_telemetry(&mut self, id: RiderId, power: f64, cadence: Option<f64>) -> bool {
        let max_power = self.config.max_power_watts;
        let Some((room, seat)) = self.seat_of(id) else {
            return false;
        };
        let Some(rider) = self.rooms[room].seats[seat].as_mut() else {
            return false;
        };
        let Occupant::Human {
            seconds_since_telemetry,
        } = &mut rider.occupant
        else {
            return false;
        };
        *seconds_since_telemetry = 0.0;
        rider.power = if power.is_finite() {
            power.clamp(0.0, max_power)
        } else {
            0.0
        };
        rider.cadence = cadence.filter(|c| c.is_finite() && *c >= 0.0).map(|c| c.min(250.0));
        true
    }

    /// Sets the clock to wall time (Unix seconds). Ticks advance it too, but
    /// a game loop that skips late ticks would slowly fall behind.
    pub fn sync_clock(&mut self, now_s: f64) {
        self.now_s = now_s;
    }

    pub fn tick(&mut self, dt: f64) {
        self.now_s += dt;
        let clock = self.timetable.at(self.now_s);
        if clock.slot != self.slot {
            self.slot = clock.slot;
            for room in &mut self.rooms {
                for rider in room.seats.iter_mut().flatten() {
                    rider.reset_class();
                }
            }
        }
        let target = self.timetable.target(&clock);
        let cadence_cue = self
            .timetable
            .class(&clock)
            .target_at(clock.elapsed_s)
            .and_then(|(index, _)| self.timetable.class(&clock).segments[index].cadence);

        let config = &self.config;
        let rng = &mut self.rng;
        for room in &mut self.rooms {
            for rider in room.seats.iter_mut().flatten() {
                match &mut rider.occupant {
                    Occupant::Human {
                        seconds_since_telemetry,
                    } => {
                        *seconds_since_telemetry += dt;
                        if *seconds_since_telemetry > config.telemetry_timeout_s {
                            rider.power = 0.0;
                            rider.cadence = None;
                        }
                    }
                    Occupant::Bot { effort, variance } => {
                        let wanted = rider.ftp_watts * target.map_or(LOBBY_INTENSITY, |t| t * *effort);
                        let noisy = wanted * (1.0 + *variance * rng.standard_normal());
                        // Bots ease into a new target over a couple of seconds.
                        rider.power += (noisy - rider.power) * (dt / 2.0).min(1.0);
                        rider.power = rider.power.max(0.0);
                        let (lo, hi) = cadence_cue.unwrap_or((80, 90));
                        rider.cadence = Some(rng.range_f64(f64::from(lo), f64::from(hi)).round());
                    }
                }
                rider.speed = step_speed(
                    &config.physics,
                    &StepInput {
                        rider_mass_kg: rider.weight_kg,
                        body: Body::bike(&config.physics),
                        speed: rider.speed,
                        power_watts: rider.power,
                        grade_percent: 0.0,
                        cda_factor: 1.0,
                    },
                    dt,
                );
                rider.distance += rider.speed * dt;
                if let Some(target) = target {
                    let target_watts = rider.ftp_watts * target;
                    rider.class_seconds += dt;
                    rider.class_joules += rider.power * dt;
                    if (rider.power - target_watts).abs() <= ON_TARGET_TOLERANCE * target_watts {
                        rider.on_target_seconds += dt;
                    }
                }
            }
        }
    }

    fn allocate_id(&mut self) -> RiderId {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn vacate(&mut self, room: usize, seat: usize) {
        if let Some(rider) = self.rooms[room].seats[seat].take() {
            self.events.push(StudioEvent::RiderLeft {
                room,
                rider_id: rider.id,
                name: rider.name,
            });
        }
    }

    /// Closes extra rooms without humans and tops every room up with bots to
    /// the target (or thins them out as humans arrive).
    fn balance_bots(&mut self) {
        let mut index = self.rooms.len();
        while index > 1 {
            index -= 1;
            if self.rooms[index].human_count() == 0 {
                self.rooms.remove(index);
            }
        }
        let target = self.config.target_riders.min(SEATS_PER_ROOM);
        for room_index in 0..self.rooms.len() {
            loop {
                let room = &self.rooms[room_index];
                let total = room.riders().count();
                if total > target && !room.bot_seats().is_empty() {
                    let bots = room.bot_seats();
                    let seat = bots[self.rng.index(bots.len())];
                    self.vacate(room_index, seat);
                } else if total < target && !room.free_seats().is_empty() {
                    let free = room.free_seats();
                    let seat = free[self.rng.index(free.len())];
                    self.seat_bot(room_index, seat);
                } else {
                    break;
                }
            }
        }
    }

    fn seat_bot(&mut self, room: usize, seat: usize) {
        let taken: Vec<String> = self.rooms[room].riders().map(|(_, r)| r.name.clone()).collect();
        let taken: Vec<&str> = taken.iter().map(String::as_str).collect();
        let name = names::generate_unique(self.rng.as_mut(), &taken);
        let weight_kg = self.rng.range_f64(55.0, 95.0);
        let ftp_watts = self.rng.range_f64(2.0, 4.5) * weight_kg;
        let effort = self.rng.range_f64(0.85, 1.05);
        let variance = self.rng.range_f64(0.02, 0.06);
        let id = self.allocate_id();
        self.rooms[room].seats[seat] = Some(SeatedRider {
            id,
            name: name.clone(),
            occupant: Occupant::Bot { effort, variance },
            weight_kg,
            ftp_watts,
            power: 0.0,
            cadence: None,
            speed: 0.0,
            distance: 0.0,
            class_joules: 0.0,
            class_seconds: 0.0,
            on_target_seconds: 0.0,
        });
        self.events.push(StudioEvent::RiderJoined {
            room,
            rider_id: id,
            name,
            is_bot: true,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::SplitMix64;

    /// 2026-10-09 14:00:00 UTC, the start of a slot (a lobby opens) whose class is "tempo".
    const SLOT_START: f64 = 1_791_554_400.0;

    fn studio(target_riders: usize, now_s: f64) -> Studio {
        Studio::new(
            Timetable::new(builtin_classes()),
            StudioConfig {
                target_riders,
                ..StudioConfig::default()
            },
            Box::new(SplitMix64::new(7)),
            now_s,
        )
    }

    fn run(studio: &mut Studio, seconds: f64, feed: impl Fn(&mut Studio)) {
        let dt = 0.05;
        for _ in 0..(seconds / dt).round() as usize {
            feed(studio);
            studio.tick(dt);
        }
    }

    #[test]
    fn a_slot_is_a_five_minute_lobby_followed_by_the_class() {
        let timetable = Timetable::new(builtin_classes());
        assert_eq!(SLOT_START % f64::from(SLOT_S), 0.0);
        let lobby = timetable.at(SLOT_START);
        assert_eq!(lobby.elapsed_s, -300.0);
        assert_eq!(lobby.starts_at_s, SLOT_START + 300.0);
        assert_eq!(timetable.target(&lobby), None);
        let start = timetable.at(SLOT_START + 300.0);
        assert_eq!((start.slot, start.elapsed_s), (lobby.slot, 0.0));
        assert_eq!(timetable.target(&start), Some(0.5), "warm-ups start at 50 % FTP");
    }

    #[test]
    fn slots_rotate_through_the_classes() {
        let timetable = Timetable::new(builtin_classes());
        let ids: Vec<&str> = (0..5)
            .map(|n| {
                timetable
                    .class(&timetable.at(SLOT_START + f64::from(n * SLOT_S)))
                    .id
                    .as_str()
            })
            .collect();
        assert_eq!(ids[0], ids[4], "four classes, then the rotation repeats");
        assert_ne!(ids[0], ids[1]);
    }

    #[test]
    fn builtin_classes_fill_the_class_time_with_sane_targets() {
        for class in builtin_classes() {
            assert_eq!(class.duration_s(), CLASS_S, "{}", class.id);
            for segment in &class.segments {
                assert!((0.3..=1.5).contains(&segment.from) && (0.3..=1.5).contains(&segment.to));
                let (lo, hi) = segment.cadence.unwrap();
                assert!(lo < hi && (50..=120).contains(&lo) && hi <= 120, "{}", segment.cue);
            }
        }
    }

    #[test]
    fn targets_ramp_within_a_segment_and_stop_after_the_class() {
        let class = &builtin_classes()[0];
        assert_eq!(
            class.target_at(150.0),
            Some((0, 0.625)),
            "half-way up the 0.5 → 0.75 warm-up"
        );
        assert_eq!(class.target_at(300.0), Some((1, 0.80)));
        assert_eq!(class.target_at(f64::from(CLASS_S)), None);
        assert_eq!(class.target_at(-1.0), None);
    }

    #[test]
    fn bots_fill_a_room_and_give_their_seat_to_humans() {
        let mut studio = studio(12, SLOT_START);
        assert_eq!(studio.rooms().len(), 1);
        assert_eq!(studio.rooms()[0].riders().count(), 12);
        let anna = studio.join_human("Anna", 70.0, 250.0);
        assert_eq!(studio.seat_of(anna), Some((0, 3)), "best seat: front row, middle");
        assert_eq!(studio.rooms()[0].riders().count(), 12, "one bot made room");
        assert_eq!(studio.human_count(), 1);
    }

    #[test]
    fn the_seventeenth_human_opens_a_second_room_which_closes_when_empty() {
        let mut studio = studio(12, SLOT_START);
        let ids: Vec<RiderId> = (0..17)
            .map(|i| studio.join_human(&format!("R{i}"), 70.0, 250.0))
            .collect();
        assert_eq!(studio.rooms().len(), 2);
        assert_eq!(studio.rooms()[0].human_count(), 16);
        assert_eq!(studio.rooms()[0].riders().count(), 16, "no bots left in a full room");
        assert_eq!(studio.seat_of(ids[16]).map(|(room, _)| room), Some(1));
        assert_eq!(studio.rooms()[1].riders().count(), 12, "bots keep the new room company");
        studio.leave(ids[16]);
        assert_eq!(studio.rooms().len(), 1);
    }

    #[test]
    fn bots_ride_the_class_on_target_most_of_the_time() {
        let mut studio = studio(12, SLOT_START + 300.0);
        // Skip the warm-up ramp: from 5 min the tempo class holds 80 % FTP for 4 min.
        run(&mut studio, 300.0, |_| {});
        let before: Vec<f64> = studio.rooms()[0].riders().map(|(_, r)| r.on_target_seconds).collect();
        run(&mut studio, 200.0, |_| {});
        let room = &studio.rooms()[0];
        let gained: f64 = room
            .riders()
            .zip(before)
            .map(|((_, r), b)| r.on_target_seconds - b)
            .sum::<f64>()
            / room.riders().count() as f64;
        assert!(gained > 100.0, "average {gained} s of 200 s on target");
        assert!(room
            .riders()
            .all(|(_, r)| r.cadence.is_some_and(|c| (85.0..=95.0).contains(&c))));
    }

    #[test]
    fn humans_are_scored_against_their_own_ftp() {
        let mut studio = studio(0, SLOT_START + 600.0);
        let strong = studio.join_human("Strong", 70.0, 300.0);
        let weak = studio.join_human("Weak", 70.0, 150.0);
        // 10 min into "tempo": 80 % FTP block. Both ride 240 W.
        run(&mut studio, 60.0, |s| {
            s.set_telemetry(strong, 240.0, Some(90.0));
            s.set_telemetry(weak, 240.0, Some(90.0));
        });
        let share = |id| studio.rider(id).unwrap().on_target_share().unwrap();
        assert!(share(strong) > 0.99, "240 W is 80 % of 300 W");
        assert!(share(weak) < 0.01, "240 W is 160 % of 150 W");
        assert!((studio.rider(strong).unwrap().class_joules - 240.0 * 60.0).abs() < 100.0);
    }

    #[test]
    fn class_scores_reset_when_the_next_slot_begins() {
        let mut studio = studio(0, SLOT_START + f64::from(SLOT_S) - 10.0);
        let anna = studio.join_human("Anna", 70.0, 250.0);
        run(&mut studio, 9.0, |s| {
            s.set_telemetry(anna, 100.0, None);
        });
        assert!(studio.rider(anna).unwrap().class_seconds > 8.0);
        run(&mut studio, 2.0, |s| {
            s.set_telemetry(anna, 100.0, None);
        });
        assert_eq!(
            studio.rider(anna).unwrap().class_seconds,
            0.0,
            "the new slot starts with its lobby"
        );
    }

    #[test]
    fn humans_without_telemetry_stop_pedalling_but_keep_rolling_to_a_stop() {
        let mut studio = studio(0, SLOT_START);
        let anna = studio.join_human("Anna", 70.0, 250.0);
        run(&mut studio, 20.0, |s| {
            s.set_telemetry(anna, 250.0, Some(90.0));
        });
        let rider = studio.rider(anna).unwrap();
        assert!(rider.speed > 8.0 && rider.distance > 100.0);
        run(&mut studio, 5.0, |_| {});
        assert_eq!(studio.rider(anna).unwrap().power, 0.0);
        assert_eq!(studio.rider(anna).unwrap().cadence, None);
    }

    #[test]
    fn leaving_and_events() {
        let mut studio = studio(2, SLOT_START);
        studio.drain_events();
        let anna = studio.join_human("Anna", 70.0, 250.0);
        let events = studio.drain_events();
        assert!(events.contains(&StudioEvent::RiderJoined {
            room: 0,
            rider_id: anna,
            name: "Anna".into(),
            is_bot: false
        }));
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(e, StudioEvent::RiderLeft { .. }))
                .count(),
            1
        );
        assert!(studio.leave(anna));
        assert!(!studio.leave(anna));
        assert!(!studio.set_telemetry(anna, 100.0, None));
        assert_eq!(studio.rooms()[0].riders().count(), 2);
    }
}
