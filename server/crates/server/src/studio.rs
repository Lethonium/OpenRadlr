//! The spin studio's game core (see ADR 11): wraps the simulation's
//! [`Studio`] the way [`crate::game::GameCore`] wraps a route's world. Every
//! message goes to the riders of one room only.

use crate::game::{sanitise_chat, sanitise_name, valid_weight, GameSettings, JoinError, MessageSink, NullSink};
use crate::protocol::{studio_event_message, studio_state_message, DeviceKind, ServerMessage};
use crate::resume::{Attachments, JoinedRider, ResumeTokens};
use crate::runtime::Game;
use crate::stats::DistanceStats;
use openradlr_sim::studio::Studio;
use openradlr_sim::RiderId;
use std::collections::HashMap;

/// World id of the studio in `join` and `/api/info`.
pub const STUDIO_ID: &str = "spin-studio";
pub const STUDIO_NAME: &str = "Spin Studio";

/// FTP for riders who don't send one: a fit amateur's 2.5 W/kg.
const DEFAULT_FTP_WKG: f64 = 2.5;

/// What the community totals need to know about a rider.
struct Ridden {
    device: DeviceKind,
    /// The part of the rider's distance already added to the totals.
    counted_m: f64,
}

pub struct StudioCore {
    studio: Studio,
    settings: GameSettings,
    clients: HashMap<RiderId, Box<dyn MessageSink>>,
    tick: u64,
    /// Wall time in Unix seconds; `None` in tests, which run on ticks alone.
    wall_clock: Option<fn() -> f64>,
    /// Community totals (#65); studio rides count as the rider's device (trainer unless told otherwise).
    stats: DistanceStats,
    ridden: HashMap<RiderId, Ridden>,
    /// Resume tokens and who is detached (#73).
    attachments: Attachments,
}

impl StudioCore {
    pub fn new(studio: Studio, settings: GameSettings) -> Self {
        Self {
            studio,
            settings,
            clients: HashMap::new(),
            tick: 0,
            wall_clock: None,
            stats: DistanceStats::default(),
            ridden: HashMap::new(),
            attachments: Attachments::new(settings.grace_s, ResumeTokens::new(), STUDIO_ID.into()),
        }
    }

    /// Shares the resume `tokens` with the route games.
    pub fn with_resume_tokens(mut self, tokens: ResumeTokens) -> Self {
        self.attachments.set_registry(tokens, STUDIO_ID.into());
        self
    }

    /// Game time in seconds, which the grace period runs on.
    fn clock_s(&self) -> f64 {
        self.tick as f64 * self.settings.tick_seconds()
    }

    /// Adds what riders cover to `stats` (shared with the other games of the server).
    pub fn with_stats(mut self, stats: DistanceStats) -> Self {
        self.stats = stats;
        self
    }

    /// Keeps the class clock on `wall_clock` (Unix seconds).
    pub fn with_wall_clock(mut self, wall_clock: fn() -> f64) -> Self {
        self.wall_clock = Some(wall_clock);
        self
    }

    pub fn studio(&self) -> &Studio {
        &self.studio
    }

    fn room_of(&self, rider_id: RiderId) -> Option<usize> {
        self.studio.seat_of(rider_id).map(|(room, _)| room)
    }

    /// Sends `message` to every client in `room`; drops clients that are gone.
    fn send_to_room(&mut self, room: usize, message: &ServerMessage) {
        let closed: Vec<RiderId> = self
            .clients
            .iter()
            .filter(|(&id, _)| self.studio.seat_of(id).is_some_and(|(r, _)| r == room))
            .filter(|(_, sink)| sink.deliver(message.clone()).is_err())
            .map(|(&id, _)| id)
            .collect();
        for rider_id in closed {
            Game::detach(self, rider_id);
        }
    }
}

impl Game for StudioCore {
    fn tick_seconds(&self) -> f64 {
        self.settings.tick_seconds()
    }

    fn player_count(&self) -> usize {
        self.clients.len()
    }

    #[allow(clippy::too_many_arguments)]
    fn join(
        &mut self,
        name: &str,
        weight_kg: f64,
        ftp_w: Option<f64>,
        _level_w: Option<f64>,
        _route_id: Option<&str>,
        _vehicle_code: Option<&str>,
        _start_m: Option<f64>,
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
        let ftp_w = ftp_w
            .filter(|ftp| ftp.is_finite() && *ftp > 0.0)
            .unwrap_or(DEFAULT_FTP_WKG * weight_kg)
            .clamp(50.0, 600.0);

        let rider_id = self.studio.join_human(&name, weight_kg, ftp_w);
        let room = self.room_of(rider_id).expect("a rider who just joined has a seat");
        let (resume_token, epoch) = self.attachments.attach(rider_id);
        // A failed delivery here is cleaned up on the next tick.
        let _ = sink.deliver(ServerMessage::Joined { rider_id, resume_token });
        let _ = sink.deliver(studio_state_message(&self.studio, room, self.tick));
        self.clients.insert(rider_id, sink);
        self.ridden.insert(
            rider_id,
            Ridden {
                device: DeviceKind::Trainer,
                counted_m: self.studio.rider(rider_id).map_or(0.0, |r| r.distance),
            },
        );
        Ok(JoinedRider { rider_id, epoch })
    }

    fn leave(&mut self, rider_id: RiderId) {
        if self.clients.remove(&rider_id).is_some() {
            self.attachments.forget(rider_id);
            self.ridden.remove(&rider_id);
            self.studio.leave(rider_id);
        }
    }

    fn is_attached(&self, rider_id: RiderId, epoch: u64) -> bool {
        self.attachments.is_current(rider_id, epoch)
    }

    /// Like the route games: the rider stops pedalling and keeps their seat
    /// for the grace period.
    fn detach(&mut self, rider_id: RiderId) {
        if self.settings.grace_s <= 0.0 {
            return Game::leave(self, rider_id);
        }
        let Some(sink) = self.clients.get_mut(&rider_id) else {
            return;
        };
        *sink = Box::new(NullSink);
        self.studio.set_telemetry(rider_id, 0.0, None);
        let now_s = self.clock_s();
        self.attachments.detach(rider_id, now_s);
    }

    fn reattach(&mut self, token: &str, sink: Box<dyn MessageSink>) -> Option<JoinedRider> {
        let joined = self.attachments.reattach(token)?;
        let rider_id = joined.rider_id;
        let room = self.room_of(rider_id)?;
        let client = self.clients.get_mut(&rider_id)?;
        let _ = sink.deliver(ServerMessage::Joined {
            rider_id,
            resume_token: token.to_owned(),
        });
        let _ = sink.deliver(studio_state_message(&self.studio, room, self.tick));
        *client = sink;
        Some(joined)
    }

    fn set_device(&mut self, rider_id: RiderId, device: DeviceKind) {
        if let Some(ridden) = self.ridden.get_mut(&rider_id) {
            ridden.device = device;
        }
    }

    fn telemetry(&mut self, rider_id: RiderId, power: f64, cadence: Option<f64>) {
        if self.clients.contains_key(&rider_id) {
            self.studio.set_telemetry(rider_id, power, cadence);
        }
    }

    /// Chat stays in the rider's room.
    fn chat(&mut self, rider_id: RiderId, text: &str) {
        if !self.clients.contains_key(&rider_id) {
            return;
        }
        let (Some(room), Some(rider), Some(text)) =
            (self.room_of(rider_id), self.studio.rider(rider_id), sanitise_chat(text))
        else {
            return;
        };
        let message = ServerMessage::Chat {
            rider_id,
            name: rider.name.clone(),
            text,
        };
        self.send_to_room(room, &message);
    }

    fn tick(&mut self) {
        if let Some(wall_clock) = self.wall_clock {
            self.studio.sync_clock(wall_clock() - self.settings.tick_seconds());
        }
        self.studio.tick(self.settings.tick_seconds());
        self.tick += 1;
        for rider_id in self.attachments.expired(self.clock_s()) {
            Game::leave(self, rider_id);
        }
        // Studio bots are not clients, so only humans count.
        for (&rider_id, ridden) in &mut self.ridden {
            if let Some(rider) = self.studio.rider(rider_id) {
                self.stats.add(ridden.device, rider.distance - ridden.counted_m);
                ridden.counted_m = rider.distance;
            }
        }

        for event in self.studio.drain_events() {
            let (room, message) = studio_event_message(&event);
            self.send_to_room(room, &message);
        }

        if self.tick.is_multiple_of(self.settings.broadcast_every()) {
            for room in 0..self.studio.rooms().len() {
                let message = studio_state_message(&self.studio, room, self.tick);
                self.send_to_room(room, &message);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::SinkClosed;
    use openradlr_sim::rng::SplitMix64;
    use openradlr_sim::studio::{builtin_classes, StudioConfig, Timetable, SLOT_S};
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct RecordingSink {
        messages: Arc<Mutex<Vec<ServerMessage>>>,
        closed: Arc<Mutex<bool>>,
    }

    impl RecordingSink {
        fn take(&self) -> Vec<ServerMessage> {
            std::mem::take(&mut self.messages.lock().unwrap())
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

    fn core(target_riders: usize, max_players: usize) -> StudioCore {
        let start = f64::from(SLOT_S) * 1000.0;
        StudioCore::new(
            Studio::new(
                Timetable::new(builtin_classes()),
                StudioConfig {
                    target_riders,
                    ..StudioConfig::default()
                },
                Box::new(SplitMix64::new(3)),
                start,
            ),
            GameSettings {
                tick_hz: 20,
                broadcast_hz: 4,
                max_players,
                ..GameSettings::default()
            },
        )
    }

    fn join(core: &mut StudioCore, name: &str) -> (RiderId, RecordingSink) {
        let sink = RecordingSink::default();
        let id = core
            .join(name, 70.0, Some(250.0), None, None, None, None, Box::new(sink.clone()))
            .unwrap()
            .rider_id;
        (id, sink)
    }

    fn studio_states(messages: &[ServerMessage]) -> Vec<&ServerMessage> {
        messages
            .iter()
            .filter(|m| matches!(m, ServerMessage::StudioState { .. }))
            .collect()
    }

    #[test]
    fn joining_confirms_and_sends_the_room() {
        let mut core = core(8, 50);
        let (id, sink) = join(&mut core, "Anna");
        let messages = sink.take();
        assert!(matches!(
            &messages[0],
            ServerMessage::Joined { rider_id, resume_token } if *rider_id == id && resume_token.len() == 64
        ));
        let ServerMessage::StudioState {
            room,
            rooms,
            class,
            riders,
            ..
        } = &messages[1]
        else {
            panic!("expected studio state, got {:?}", messages[1]);
        };
        assert_eq!((*room, *rooms), (0, 1));
        assert_eq!(class.elapsed_s, -300.0, "a slot opens with the lobby");
        assert_eq!(riders.len(), 8);
        assert!(riders.iter().any(|r| r.id == id && !r.is_bot && r.seat == 3));
    }

    #[test]
    fn invalid_joins_are_rejected_and_odd_ftps_fixed() {
        let mut core = core(0, 1);
        let sink = || Box::new(RecordingSink::default());
        assert_eq!(
            core.join(" ", 70.0, None, None, None, None, None, sink()),
            Err(JoinError::InvalidName)
        );
        assert_eq!(
            core.join("Anna", 5.0, None, None, None, None, None, sink()),
            Err(JoinError::InvalidWeight)
        );
        let anna = core
            .join("Anna", 80.0, Some(f64::NAN), None, None, None, None, sink())
            .unwrap()
            .rider_id;
        assert_eq!(
            core.studio().rider(anna).unwrap().ftp_watts,
            200.0,
            "2.5 W/kg by default"
        );
        assert_eq!(
            core.join("Ben", 70.0, None, None, None, None, None, sink()),
            Err(JoinError::ServerFull)
        );
    }

    #[test]
    fn state_goes_out_per_room_at_the_broadcast_rate() {
        let mut core = core(0, 50);
        let sinks: Vec<(RiderId, RecordingSink)> = (0..17).map(|i| join(&mut core, &format!("R{i}"))).collect();
        for (_, sink) in &sinks {
            sink.take();
        }
        for _ in 0..20 {
            core.tick();
        }
        let first = sinks[0].1.take();
        let last = sinks[16].1.take();
        assert_eq!(studio_states(&first).len(), 4, "4 Hz for one second");
        let ServerMessage::StudioState {
            room, rooms, riders, ..
        } = studio_states(&last)[0]
        else {
            unreachable!()
        };
        assert_eq!((*room, *rooms), (1, 2));
        assert_eq!(riders.len(), 1, "room 2 holds only the 17th rider");
    }

    #[test]
    fn chat_stays_in_the_room() {
        let mut core = core(0, 50);
        let riders: Vec<(RiderId, RecordingSink)> = (0..17).map(|i| join(&mut core, &format!("R{i}"))).collect();
        for (_, sink) in &riders {
            sink.take();
        }
        core.chat(riders[0].0, "  Let's go!  ");
        let chats = |sink: &RecordingSink| {
            sink.take()
                .into_iter()
                .filter(|m| matches!(m, ServerMessage::Chat { .. }))
                .count()
        };
        assert_eq!(chats(&riders[1].1), 1);
        assert_eq!(chats(&riders[16].1), 0);
    }

    #[test]
    fn studio_rides_count_as_trainer_km_unless_the_rider_says_otherwise() {
        let stats = DistanceStats::default();
        let mut core = core(4, 50).with_stats(stats.clone());
        let (anna, _) = join(&mut core, "Anna");
        let (ben, _) = join(&mut core, "Ben");
        let (cleo, _) = join(&mut core, "Cleo");
        core.set_device(ben, DeviceKind::Paddle);
        core.set_device(cleo, DeviceKind::Sim);
        for _ in 0..400 {
            for id in [anna, ben, cleo] {
                core.telemetry(id, 220.0, Some(90.0));
            }
            core.tick();
        }
        let distance = |id| core.studio().rider(id).unwrap().distance;
        assert!(distance(anna) > 50.0 && distance(cleo) > 50.0, "they rode");
        let total = stats.snapshot();
        assert!(
            (total.trainer_m - distance(anna)).abs() < 1e-6,
            "bots and sim are left out"
        );
        assert!((total.paddle_m - distance(ben)).abs() < 1e-6);
    }

    #[test]
    fn telemetry_reaches_the_studio_and_gone_clients_leave() {
        let mut core = core(0, 50);
        // Without a grace period; with one see `studio_riders_reattach_within_grace`.
        core.settings.grace_s = 0.0;
        let (anna, sink) = join(&mut core, "Anna");
        core.telemetry(anna, 210.0, Some(88.0));
        core.tick();
        assert_eq!(core.studio().rider(anna).unwrap().power, 210.0);
        *sink.closed.lock().unwrap() = true;
        for _ in 0..5 {
            core.tick();
        }
        assert_eq!(core.player_count(), 0);
        assert!(core.studio().rider(anna).is_none());
    }

    #[test]
    fn studio_riders_reattach_within_grace() {
        let mut core = core(0, 10);
        let (anna, sink) = join(&mut core, "Anna");
        let token = sink
            .take()
            .into_iter()
            .find_map(|m| match m {
                ServerMessage::Joined { resume_token, .. } => Some(resume_token),
                _ => None,
            })
            .expect("a joined message");
        Game::detach(&mut core, anna);
        assert_eq!(Game::player_count(&core), 1, "kept for the grace period");
        let fresh = RecordingSink::default();
        let joined = Game::reattach(&mut core, &token, Box::new(fresh.clone())).expect("reattached");
        assert_eq!(joined.rider_id, anna);
        assert!(matches!(fresh.take()[0], ServerMessage::Joined { rider_id, .. } if rider_id == anna));

        Game::detach(&mut core, anna);
        for _ in 0..(61 * 20) {
            Game::tick(&mut core);
        }
        assert_eq!(Game::player_count(&core), 0);
        assert!(core.studio().rider(anna).is_none());
        assert!(Game::reattach(&mut core, &token, Box::new(RecordingSink::default())).is_none());
    }
}
