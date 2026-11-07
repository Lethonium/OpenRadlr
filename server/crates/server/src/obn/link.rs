//! The connection to an OpenBikeNet server.
//!
//! One task connects, says `hello` and `subscribe`, then forwards what the server
//! sends to the game and what the game reports (frames of local riders) to the
//! server. Whenever the connection drops, the game forgets the remote riders, the
//! outbox forgets the joined ones, and the task reconnects after a growing pause.
//! The game loop never waits for this task: frames go through a bounded channel
//! with `try_send`, commands to the game are the only thing it awaits.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use super::outbox::{LocalRider, Outbox};
use super::remote::RemoteEvent;
use super::wire::{AppInfo, AppMessage, ServerMessage};
use crate::runtime::{Command, GameHandle};

/// Room every rider joins (spec 6.2).
const ROOM: &str = "public";
/// Longest pause between connection attempts, in units.
const MAX_BACKOFF_UNITS: u32 = 60;
/// Longest wait for the TCP and WebSocket handshake.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// The pause before reconnect number `attempt` (0 = first): `unit`, doubling up to 60 `unit`s.
pub fn backoff(attempt: u32, unit: Duration) -> Duration {
    let factor = 1u32 << attempt.min(6);
    unit.saturating_mul(factor.min(MAX_BACKOFF_UNITS))
}

/// Starts the link to `url` for the shared `route`. It ends when the game stops.
pub fn spawn_link(
    url: String,
    route: String,
    route_length_m: f64,
    backoff_unit: Duration,
    mut frames: mpsc::Receiver<Vec<LocalRider>>,
    game: GameHandle,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut outbox = Outbox::new(route.clone(), route_length_m);
        let mut attempt = 0u32;
        loop {
            // Frames queued while disconnected are stale: the next one tells the whole story.
            while frames.try_recv().is_ok() {}
            let end = session(&url, &route, &mut outbox, &mut frames, &game).await;
            if end.stopped {
                return;
            }
            if resets_backoff(&end) {
                attempt = 0;
            }
            if game.send(Command::Remote(RemoteEvent::Reset)).await.is_err() {
                return;
            }
            outbox.reset();
            let pause = backoff(attempt, backoff_unit);
            attempt = attempt.saturating_add(1);
            tracing::info!(pause_ms = pause.as_millis() as u64, "OpenBikeNet: reconnecting");
            tokio::time::sleep(pause).await;
        }
    })
}

/// How one connection ended.
struct End {
    /// The server said `welcome` during it.
    welcomed: bool,
    /// The server ended it with a fatal `error`.
    fatal: bool,
    /// The game or its frame channel is gone: stop for good.
    stopped: bool,
}

/// A server that welcomes us and then fails us at once must not be retried every
/// second: only a session that got a welcome and ended without a fatal error starts the backoff over.
fn resets_backoff(end: &End) -> bool {
    end.welcomed && !end.fatal
}

fn hello() -> AppMessage {
    AppMessage::Hello {
        app: AppInfo {
            id: "openradlr".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            name: Some("OpenRadlr".into()),
            url: Some("https://openradlr.com".into()),
        },
    }
}

fn text(message: &AppMessage) -> Message {
    Message::text(serde_json::to_string(message).expect("app messages serialize"))
}

/// One connection, from connecting to the first failure.
async fn session(
    url: &str,
    route: &str,
    outbox: &mut Outbox,
    frames: &mut mpsc::Receiver<Vec<LocalRider>>,
    game: &GameHandle,
) -> End {
    let mut end = End {
        welcomed: false,
        fatal: false,
        stopped: false,
    };
    let socket = match tokio::time::timeout(CONNECT_TIMEOUT, connect_async(url)).await {
        Ok(Ok((socket, _))) => socket,
        Ok(Err(e)) => {
            tracing::info!("OpenBikeNet: cannot connect: {e}");
            return end;
        }
        Err(_) => {
            tracing::info!("OpenBikeNet: connecting timed out");
            return end;
        }
    };
    tracing::info!("OpenBikeNet: connected");
    let (mut sink, mut stream) = socket.split();
    let subscribe = AppMessage::Subscribe {
        route: route.to_owned(),
        room: ROOM.into(),
    };
    for message in [hello(), subscribe] {
        if sink.send(text(&message)).await.is_err() {
            tracing::info!("OpenBikeNet: connection dropped");
            return end;
        }
    }
    loop {
        tokio::select! {
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(raw))) => {
                    // Messages this version does not know are skipped (spec 3).
                    let message = match serde_json::from_str::<ServerMessage>(raw.as_str()) {
                        Ok(message) => message,
                        Err(e) => {
                            // Neither the text nor the error: both can quote rider names.
                            tracing::debug!(kind = ?e.classify(), "OpenBikeNet: ignoring unreadable message");
                            continue;
                        }
                    };
                    match &message {
                        ServerMessage::Welcome {} => end.welcomed = true,
                        ServerMessage::Error { code, fatal, .. } => {
                            tracing::info!(code = %code, fatal, "OpenBikeNet: error from the server");
                            if *fatal {
                                end.fatal = true;
                                return end;
                            }
                        }
                        _ => {}
                    }
                    if game.send(Command::Remote(RemoteEvent::Message(message))).await.is_err() {
                        end.stopped = true;
                        return end;
                    }
                }
                Some(Ok(Message::Close(_))) | None => {
                    tracing::info!("OpenBikeNet: connection closed");
                    return end;
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => {
                    tracing::info!("OpenBikeNet: connection dropped: {e}");
                    return end;
                }
            },
            frame = frames.recv() => {
                let Some(riders) = frame else {
                    end.stopped = true;
                    return end;
                };
                for message in outbox.frame(&riders) {
                    if sink.send(text(&message)).await.is_err() {
                        tracing::info!("OpenBikeNet: connection dropped");
                        return end;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn backoff_resets_only_after_a_welcome_without_a_fatal_error() {
        let end = |welcomed, fatal| End {
            welcomed,
            fatal,
            stopped: false,
        };
        assert!(resets_backoff(&end(true, false)));
        assert!(!resets_backoff(&end(true, true)), "a fatal-error loop must back off");
        assert!(!resets_backoff(&end(false, false)));
        assert!(!resets_backoff(&end(false, true)));
    }

    #[test]
    fn backoff_doubles_to_a_minute() {
        let secs: Vec<u64> = (0..8).map(|n| backoff(n, Duration::from_secs(1)).as_secs()).collect();
        assert_eq!(secs, [1, 2, 4, 8, 16, 32, 60, 60]);
        let millis: Vec<u128> = (0..8)
            .map(|n| backoff(n, Duration::from_millis(10)).as_millis())
            .collect();
        assert_eq!(millis, [10, 20, 40, 80, 160, 320, 600, 600]);
    }
}
