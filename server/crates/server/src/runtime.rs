//! Async runtime around a [`Game`] (a route's [`crate::game::GameCore`] or the
//! [`crate::studio::StudioCore`]): a single task owns the game and is driven
//! by a fixed-rate timer and a command channel. Connections never touch the
//! game directly; they send [`Command`]s through a [`GameHandle`].

use crate::game::{JoinError, MessageSink, SinkClosed};
use crate::protocol::{DeviceKind, EventInfoWire, Exercise, InputAction, ServerMessage};
use crate::resume::JoinedRider;
use openradlr_sim::RiderId;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::{mpsc, oneshot};
use tokio::time::MissedTickBehavior;

/// Sink that forwards messages to a connection's writer task.
pub struct ChannelSink(pub mpsc::Sender<ServerMessage>);

impl MessageSink for ChannelSink {
    fn deliver(&self, message: ServerMessage) -> Result<(), SinkClosed> {
        match self.0.try_send(message) {
            // A full buffer means a slow client; dropping a message is fine
            // because the next state broadcast supersedes it.
            Ok(()) | Err(TrySendError::Full(_)) => Ok(()),
            Err(TrySendError::Closed(_)) => Err(SinkClosed),
        }
    }
}

/// What the game loop needs from a world. Commands a world doesn't support
/// (races and lanes in the studio) are ignored by default.
pub trait Game: Send + 'static {
    fn tick_seconds(&self) -> f64;
    fn player_count(&self) -> usize;
    /// The routes this game rides, in order (none for the studio).
    fn route_ids(&self) -> Vec<String> {
        Vec::new()
    }
    /// Humans on each route of [`Game::route_ids`].
    fn players_per_route(&self) -> Vec<usize> {
        Vec::new()
    }
    /// Of those, the humans riding with phone paddles.
    fn phones_per_route(&self) -> Vec<usize> {
        Vec::new()
    }
    /// `ftp_w` is the rider's FTP and `level_w` their riding level, if the
    /// client sent them; `route_id` the
    /// route to ride (the game's first if `None`; the studio ignores it);
    /// `vehicle_code` the vehicle to board right away (the studio ignores it);
    /// `start_m` how far along the route to start (a continued ride; ignored
    /// with a vehicle code and in the studio).
    #[allow(clippy::too_many_arguments)]
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
    ) -> Result<JoinedRider, JoinError>;
    fn leave(&mut self, rider_id: RiderId);
    /// Whether `epoch` is the rider's current connection; a connection that
    /// was taken over must not detach or remove the rider (#73).
    fn is_attached(&self, _rider_id: RiderId, _epoch: u64) -> bool {
        true
    }
    /// The rider's connection dropped; games without a grace period remove them.
    fn detach(&mut self, rider_id: RiderId) {
        self.leave(rider_id);
    }
    /// Hands the rider of a resume `token` to a new connection.
    fn reattach(&mut self, _token: &str, _sink: Box<dyn MessageSink>) -> Option<JoinedRider> {
        None
    }
    fn telemetry(&mut self, rider_id: RiderId, power: f64, cadence: Option<f64>);
    fn input(&mut self, _rider_id: RiderId, _action: InputAction) {}
    fn start_race(&mut self, _rider_id: RiderId, _laps: u32) {}
    fn join_race(&mut self, _rider_id: RiderId) {}
    fn leave_race(&mut self, _rider_id: RiderId) {}
    fn join_event(&mut self, _rider_id: RiderId, _event_id: &str) {}
    fn leave_event(&mut self, _rider_id: RiderId) {}
    /// The scheduled events of this game, for `/api/info`.
    fn event_infos(&self) -> Vec<EventInfoWire> {
        Vec::new()
    }
    /// The road to take at the next junction (`None`: the default).
    fn turn(&mut self, _rider_id: RiderId, _edge: Option<&str>) {}
    /// What the rider's power comes from (shown to others where it matters).
    fn set_device(&mut self, _rider_id: RiderId, _device: DeviceKind) {}
    /// Starts a shared vehicle with the rider as captain.
    fn create_vehicle(&mut self, _rider_id: RiderId, _kind: &str, _seats: u8, _bots: bool) {}
    fn board_vehicle(&mut self, _rider_id: RiderId, _code: &str) {}
    fn leave_vehicle(&mut self, _rider_id: RiderId) {}
    /// Parks (`on`) or unparks the rider (a pause, #89); the studio ignores it.
    fn pause(&mut self, _rider_id: RiderId, _on: bool) {}
    /// The exercise a workout rider does now (`None`: rest); the studio ignores it.
    fn workout(&mut self, _rider_id: RiderId, _exercise: Option<Exercise>) {}
    fn chat(&mut self, rider_id: RiderId, text: &str);
    fn tick(&mut self);
}

pub enum Command {
    Join {
        name: String,
        weight_kg: f64,
        ftp_w: Option<f64>,
        level_w: Option<f64>,
        route_id: Option<String>,
        vehicle_code: Option<String>,
        start_m: Option<f64>,
        sink: Box<dyn MessageSink>,
        reply: oneshot::Sender<Result<JoinedRider, JoinError>>,
    },
    /// The client left on purpose; ignored unless `epoch` is still current.
    Leave {
        rider_id: RiderId,
        epoch: u64,
    },
    /// The connection dropped; ignored unless `epoch` is still current.
    Detach {
        rider_id: RiderId,
        epoch: u64,
    },
    Reattach {
        token: String,
        sink: Box<dyn MessageSink>,
        reply: oneshot::Sender<Option<JoinedRider>>,
    },
    SetDevice {
        rider_id: RiderId,
        device: DeviceKind,
    },
    Telemetry {
        rider_id: RiderId,
        power: f64,
        cadence: Option<f64>,
    },
    Input {
        rider_id: RiderId,
        action: InputAction,
    },
    StartRace {
        rider_id: RiderId,
        laps: u32,
    },
    JoinRace {
        rider_id: RiderId,
    },
    LeaveRace {
        rider_id: RiderId,
    },
    JoinEvent {
        rider_id: RiderId,
        event_id: String,
    },
    LeaveEvent {
        rider_id: RiderId,
    },
    Turn {
        rider_id: RiderId,
        edge: Option<String>,
    },
    Chat {
        rider_id: RiderId,
        text: String,
    },
    CreateVehicle {
        rider_id: RiderId,
        kind: String,
        seats: u8,
        bots: bool,
    },
    BoardVehicle {
        rider_id: RiderId,
        code: String,
    },
    LeaveVehicle {
        rider_id: RiderId,
    },
    Pause {
        rider_id: RiderId,
        on: bool,
    },
    Workout {
        rider_id: RiderId,
        exercise: Option<Exercise>,
    },
}

/// Cheap, cloneable handle to the running game.
#[derive(Clone)]
pub struct GameHandle {
    commands: mpsc::Sender<Command>,
    players: Arc<AtomicUsize>,
    /// The game's routes, the humans on each and, of those, the phone riders.
    routes: Arc<[RouteCount]>,
    /// The game's scheduled events, refreshed about once a second.
    events: Arc<Mutex<Vec<EventInfoWire>>>,
}

/// Route id, humans on it, phone riders among them.
type RouteCount = (String, AtomicUsize, AtomicUsize);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GameStopped;

impl GameHandle {
    #[allow(clippy::too_many_arguments)]
    pub async fn join(
        &self,
        name: String,
        weight_kg: f64,
        ftp_w: Option<f64>,
        level_w: Option<f64>,
        route_id: Option<String>,
        vehicle_code: Option<String>,
        start_m: Option<f64>,
        sink: Box<dyn MessageSink>,
    ) -> Result<Result<JoinedRider, JoinError>, GameStopped> {
        let (reply, response) = oneshot::channel();
        self.send(Command::Join {
            name,
            weight_kg,
            ftp_w,
            level_w,
            route_id,
            vehicle_code,
            start_m,
            sink,
            reply,
        })
        .await?;
        response.await.map_err(|_| GameStopped)
    }

    /// Hands the rider of `token` to a new connection; `None` if the game
    /// doesn't hold them (any more).
    pub async fn reattach(
        &self,
        token: String,
        sink: Box<dyn MessageSink>,
    ) -> Result<Option<JoinedRider>, GameStopped> {
        let (reply, response) = oneshot::channel();
        self.send(Command::Reattach { token, sink, reply }).await?;
        response.await.map_err(|_| GameStopped)
    }

    pub async fn send(&self, command: Command) -> Result<(), GameStopped> {
        self.commands.send(command).await.map_err(|_| GameStopped)
    }

    pub fn player_count(&self) -> usize {
        self.players.load(Ordering::Relaxed)
    }

    /// The game's scheduled events (as of the last refresh).
    pub fn events(&self) -> Vec<EventInfoWire> {
        self.events.lock().map(|events| events.clone()).unwrap_or_default()
    }

    /// Whether both handles belong to the same game.
    pub fn same_game(&self, other: &GameHandle) -> bool {
        Arc::ptr_eq(&self.players, &other.players)
    }

    /// Humans riding route `route_id` in this game.
    pub fn players_on(&self, route_id: &str) -> usize {
        self.routes
            .iter()
            .find(|(id, ..)| id == route_id)
            .map_or(0, |(_, players, _)| players.load(Ordering::Relaxed))
    }

    /// Humans on route `route_id` who ride with phone paddles.
    pub fn phones_on(&self, route_id: &str) -> usize {
        self.routes
            .iter()
            .find(|(id, ..)| id == route_id)
            .map_or(0, |(_, _, phones)| phones.load(Ordering::Relaxed))
    }
}

/// Starts the game loop on the current Tokio runtime.
pub fn spawn_game(core: impl Game) -> GameHandle {
    let (commands, receiver) = mpsc::channel(1024);
    let players = Arc::new(AtomicUsize::new(0));
    let routes: Arc<[RouteCount]> = core
        .route_ids()
        .into_iter()
        .map(|id| (id, AtomicUsize::new(0), AtomicUsize::new(0)))
        .collect();
    let events = Arc::new(Mutex::new(core.event_infos()));
    tokio::spawn(run(
        core,
        receiver,
        Arc::clone(&players),
        Arc::clone(&routes),
        Arc::clone(&events),
    ));
    GameHandle {
        commands,
        players,
        routes,
        events,
    }
}

async fn run<G: Game>(
    mut core: G,
    mut commands: mpsc::Receiver<Command>,
    players: Arc<AtomicUsize>,
    routes: Arc<[RouteCount]>,
    events: Arc<Mutex<Vec<EventInfoWire>>>,
) {
    let mut since_refresh_s = 0.0;
    let mut interval = tokio::time::interval(Duration::from_secs_f64(core.tick_seconds()));
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = interval.tick() => {
                core.tick();
                since_refresh_s += core.tick_seconds();
                if since_refresh_s >= 1.0 {
                    since_refresh_s = 0.0;
                    if let Ok(mut snapshot) = events.lock() {
                        *snapshot = core.event_infos();
                    }
                }
            }
            command = commands.recv() => match command {
                Some(command) => apply(&mut core, command),
                None => break,
            },
        }
        players.store(core.player_count(), Ordering::Relaxed);
        if !routes.is_empty() {
            let phones = core.phones_per_route();
            for (i, ((_, slot, phone_slot), count)) in routes.iter().zip(core.players_per_route()).enumerate() {
                slot.store(count, Ordering::Relaxed);
                phone_slot.store(phones.get(i).copied().unwrap_or(0), Ordering::Relaxed);
            }
        }
    }
    tracing::info!("game loop stopped");
}

pub(crate) fn apply<G: Game>(core: &mut G, command: Command) {
    match command {
        Command::Join {
            name,
            weight_kg,
            ftp_w,
            level_w,
            route_id,
            vehicle_code,
            start_m,
            sink,
            reply,
        } => {
            let result = core.join(
                &name,
                weight_kg,
                ftp_w,
                level_w,
                route_id.as_deref(),
                vehicle_code.as_deref(),
                start_m,
                sink,
            );
            if let Ok(joined) = result {
                tracing::info!(rider_id = joined.rider_id, name = %name, "rider joined");
            }
            let _ = reply.send(result);
        }
        Command::Leave { rider_id, epoch } => {
            if core.is_attached(rider_id, epoch) {
                core.leave(rider_id);
                tracing::info!(rider_id, "rider left");
            }
        }
        Command::Detach { rider_id, epoch } => {
            if core.is_attached(rider_id, epoch) {
                core.detach(rider_id);
                tracing::info!(rider_id, "rider detached");
            }
        }
        Command::Reattach { token, sink, reply } => {
            let joined = core.reattach(&token, sink);
            if let Some(joined) = joined {
                tracing::info!(rider_id = joined.rider_id, "rider reattached");
            }
            let _ = reply.send(joined);
        }
        Command::SetDevice { rider_id, device } => core.set_device(rider_id, device),
        Command::Telemetry {
            rider_id,
            power,
            cadence,
        } => core.telemetry(rider_id, power, cadence),
        Command::Input { rider_id, action } => core.input(rider_id, action),
        Command::StartRace { rider_id, laps } => core.start_race(rider_id, laps),
        Command::JoinRace { rider_id } => core.join_race(rider_id),
        Command::LeaveRace { rider_id } => core.leave_race(rider_id),
        Command::JoinEvent { rider_id, event_id } => core.join_event(rider_id, &event_id),
        Command::LeaveEvent { rider_id } => core.leave_event(rider_id),
        Command::Turn { rider_id, edge } => core.turn(rider_id, edge.as_deref()),
        Command::Chat { rider_id, text } => core.chat(rider_id, &text),
        Command::CreateVehicle {
            rider_id,
            kind,
            seats,
            bots,
        } => core.create_vehicle(rider_id, &kind, seats, bots),
        Command::BoardVehicle { rider_id, code } => core.board_vehicle(rider_id, &code),
        Command::LeaveVehicle { rider_id } => core.leave_vehicle(rider_id),
        Command::Pause { rider_id, on } => core.pause(rider_id, on),
        Command::Workout { rider_id, exercise } => core.workout(rider_id, exercise),
    }
}
