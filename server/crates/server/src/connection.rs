//! Runs one WebSocket connection: feeds frames into the [`Session`] state
//! machine (see [`crate::session`]) and carries out what it decides.

use crate::game::JoinError;
use crate::guard::SlotPermit;
use crate::http::AppState;
use crate::protocol::ServerMessage;
use crate::resume::JoinedRider;
use crate::runtime::{ChannelSink, Command, GameHandle};
use crate::session::{Action, Phase, PlayerCommand, Session};
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use openradlr_sim::RiderId;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::time::MissedTickBehavior;

fn to_command(rider_id: RiderId, command: PlayerCommand) -> Command {
    match command {
        PlayerCommand::Telemetry { power, cadence } => Command::Telemetry {
            rider_id,
            power,
            cadence,
        },
        PlayerCommand::Input(action) => Command::Input { rider_id, action },
        PlayerCommand::StartRace { laps } => Command::StartRace { rider_id, laps },
        PlayerCommand::JoinRace => Command::JoinRace { rider_id },
        PlayerCommand::Workout { exercise } => Command::Workout { rider_id, exercise },
        PlayerCommand::LeaveRace => Command::LeaveRace { rider_id },
        PlayerCommand::JoinEvent { event_id } => Command::JoinEvent { rider_id, event_id },
        PlayerCommand::LeaveEvent => Command::LeaveEvent { rider_id },
        PlayerCommand::Turn { edge } => Command::Turn { rider_id, edge },
        PlayerCommand::Chat { text } => Command::Chat { rider_id, text },
        PlayerCommand::CreateVehicle { kind, seats, bots } => Command::CreateVehicle {
            rider_id,
            kind,
            seats,
            bots,
        },
        PlayerCommand::BoardVehicle { code } => Command::BoardVehicle { rider_id, code },
        PlayerCommand::LeaveVehicle => Command::LeaveVehicle { rider_id },
        PlayerCommand::Pause { on } => Command::Pause { rider_id, on },
    }
}

/// Runs one WebSocket connection until the client disconnects, misbehaves
/// or times out.
pub async fn serve(socket: WebSocket, state: AppState) {
    let (mut writer, mut reader) = socket.split();
    let (outbox, mut outgoing) = mpsc::channel::<ServerMessage>(256);

    let mut write_task = tokio::spawn(async move {
        while let Some(message) = outgoing.recv().await {
            if writer.send(Message::Text(message.to_json().into())).await.is_err() {
                break;
            }
        }
        let _ = writer.close().await;
    });

    let started = Instant::now();
    let now = move || started.elapsed().as_secs_f64();
    let mut session = Session::new(Arc::clone(&state.info), state.protection.limits, now());
    // The world this connection joined, and its seat under the player cap.
    let mut game: Option<GameHandle> = None;
    // Which attach of the rider this connection is (#73).
    let mut epoch = 0;
    // The client sent `leave`: remove the rider at once instead of detaching.
    let mut leaving = false;
    let mut _seat: Option<SlotPermit<()>> = None;
    let mut checks = tokio::time::interval(Duration::from_secs(1));
    checks.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut writer_done = false;

    loop {
        tokio::select! {
            incoming = reader.next() => {
                let text = match incoming {
                    Some(Ok(Message::Text(text))) => text,
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => continue,
                };
                match session.on_text(text.as_str(), now()) {
                    Action::Ignore => {}
                    Action::Reply(message) => {
                        if outbox.send(message).await.is_err() {
                            break;
                        }
                    }
                    Action::ReplyAndClose(message) => {
                        let _ = outbox.send(message).await;
                        break;
                    }
                    Action::Join {
                        name,
                        weight_kg,
                        route_id,
                        ftp_w,
                        level_w,
                        device,
                        vehicle_code,
                        resume_token,
                        resume,
                    } => {
                        // A dropped connection coming back: the same rider, wherever they ride (#73).
                        if let Some((token, world)) =
                            resume_token.and_then(|token| state.worlds.resume_game(&token).map(|world| (token, world)))
                        {
                            let Some(seat) = state.protection.seats_for(device).try_acquire(()) else {
                                let _ = outbox.send(join_error(JoinError::ServerFull)).await;
                                continue;
                            };
                            let sink = Box::new(ChannelSink(outbox.clone()));
                            match world.reattach(token, sink).await {
                                Ok(Some(joined)) => {
                                    session.joined(joined.rider_id);
                                    epoch = joined.epoch;
                                    game = Some(world.clone());
                                    _seat = Some(seat);
                                    continue;
                                }
                                // Gone meanwhile: an ordinary join below.
                                Ok(None) => {}
                                Err(_) => break,
                            }
                        }
                        // A vehicle's code decides the world; `route_id` is then ignored.
                        let vehicle_code = vehicle_code.map(|code| normalise_code(&code));
                        // A continued ride starts where it left off, but never on a vehicle.
                        let (route_id, start_m) = match (&vehicle_code, resume) {
                            (None, Some(point)) => (Some(point.route_id), Some(point.distance_m)),
                            _ => (route_id, None),
                        };
                        let target = match &vehicle_code {
                            Some(code) => match state.worlds.vehicle_world(code) {
                                Some(entry) => Some((&entry.game, Some(entry.id()))),
                                None => {
                                    let _ = outbox.send(join_error(JoinError::UnknownVehicle)).await;
                                    continue;
                                }
                            },
                            None => state.worlds.game(route_id.as_deref()),
                        };
                        let Some((world, route)) = target else {
                            let _ = outbox
                                .send(ServerMessage::error("unknown_route", "this server has no such route"))
                                .await;
                            continue;
                        };
                        let Some(seat) = state.protection.seats_for(device).try_acquire(()) else {
                            let _ = outbox.send(join_error(JoinError::ServerFull)).await;
                            continue;
                        };
                        let sink = Box::new(ChannelSink(outbox.clone()));
                        match world.join(name, weight_kg, ftp_w, level_w, route.map(str::to_owned), vehicle_code, start_m, sink).await {
                            Ok(Ok(JoinedRider { rider_id, epoch: joined_epoch })) => {
                                if !device.is_trainer() && world.send(Command::SetDevice { rider_id, device }).await.is_err() {
                                    break;
                                }
                                session.joined(rider_id);
                                epoch = joined_epoch;
                                game = Some(world.clone());
                                _seat = Some(seat);
                            }
                            Ok(Err(error)) => {
                                let _ = outbox.send(join_error(error)).await;
                            }
                            Err(_) => break,
                        }
                    }
                    Action::Forward(command) => {
                        if let (Phase::Joined(rider_id), Some(game)) = (session.phase(), &game) {
                            if game.send(to_command(rider_id, command)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Action::Leave => {
                        leaving = true;
                        break;
                    }
                }
            }
            _ = checks.tick() => {
                if let Some(reason) = session.expired(now()) {
                    let _ = outbox.send(reason).await;
                    break;
                }
            }
            _ = &mut write_task, if !writer_done => {
                writer_done = true;
                break;
            }
        }
    }

    // A rider who said goodbye leaves now; a dropped one is kept for the grace period.
    if let (Phase::Joined(rider_id), Some(game)) = (session.phase(), &game) {
        let command = if leaving {
            Command::Leave { rider_id, epoch }
        } else {
            Command::Detach { rider_id, epoch }
        };
        let _ = game.send(command).await;
    }
    // Let queued messages (e.g. a final error) flush, then stop the writer.
    drop(outbox);
    if !writer_done {
        let _ = tokio::time::timeout(Duration::from_secs(1), &mut write_task).await;
    }
    write_task.abort();
}

/// Codes are typed by hand: trimmed and upper-cased, as boarding does.
fn normalise_code(code: &str) -> String {
    code.trim().to_ascii_uppercase()
}

fn join_error(error: JoinError) -> ServerMessage {
    ServerMessage::error(error.code(), error.to_string())
}
