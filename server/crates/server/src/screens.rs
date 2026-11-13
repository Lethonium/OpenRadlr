//! The relay between a tablet and its paired second screens. The tablet's
//! connection registers as the *host* of a screen key and copies every message
//! it writes to its socket into [`HostGuard::publish`]; phones *watch* the key
//! and get those copies. The game cores know nothing about it.
//!
//! A watcher never slows the host: copies use `try_send` and are dropped when
//! the watcher's outbox is full. A `watch_status` that does not fit is kept
//! instead and sent by the watcher's own connection (see
//! [`WatchGuard::pending_status`]), so a phone never misses the host going live.

use crate::protocol::ServerMessage;
use openradlr_sim::RiderId;
use serde::Deserialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::sync::mpsc;

/// Watchers one screen key serves at most.
pub const MAX_WATCHERS: usize = 4;

/// Revoked keys remembered at most; the oldest are forgotten first.
pub const MAX_REVOKED: usize = 10_000;

/// What a watcher sees of the host's ride.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WatchView {
    /// Only the host's own rider (what a cockpit tile needs).
    #[default]
    Data,
    /// Everything the host gets.
    World,
}

/// The key already has [`MAX_WATCHERS`] watchers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TooManyScreens;

struct Watcher {
    id: u64,
    view: WatchView,
    /// The watching screen's device name, when it gave one.
    device: Option<String>,
    outbox: mpsc::Sender<ServerMessage>,
    /// The latest status, when it did not fit into the outbox.
    pending_status: Option<ServerMessage>,
}

impl Watcher {
    /// Tells the watcher the host's status; a newer status replaces a pending one.
    fn tell(&mut self, status: ServerMessage) {
        self.pending_status = self.outbox.try_send(status).err().map(|e| e.into_inner());
    }
}

struct Host {
    id: u64,
    name: String,
    rider_id: RiderId,
    /// The host connection's outbox, told who watches.
    outbox: Option<mpsc::Sender<ServerMessage>>,
}

#[derive(Default)]
struct Entry {
    host: Option<Host>,
    watchers: Vec<Watcher>,
}

#[derive(Default)]
struct Registry {
    entries: HashMap<String, Entry>,
    next_id: u64,
    revoked: HashSet<String>,
    /// `revoked` in the order the keys were revoked.
    revoked_order: VecDeque<String>,
}

impl Registry {
    fn prune(&mut self, key: &str) {
        if self
            .entries
            .get(key)
            .is_some_and(|e| e.host.is_none() && e.watchers.is_empty())
        {
            self.entries.remove(key);
        }
    }
}

/// Screen key to its host and watchers. Cloning shares the registry.
#[derive(Clone, Default)]
pub struct Screens {
    inner: Arc<Mutex<Registry>>,
}

impl Screens {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, Registry> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Registers the host of `key`, replacing an earlier one, and tells the
    /// watchers the screen is live.
    pub fn host(&self, key: &str, rider_id: RiderId, name: String) -> HostGuard {
        let mut reg = self.lock();
        reg.next_id += 1;
        let id = reg.next_id;
        let entry = reg.entries.entry(key.to_owned()).or_default();
        entry.host = Some(Host {
            id,
            name: name.clone(),
            rider_id,
            outbox: None,
        });
        tell_all(
            &mut entry.watchers,
            &ServerMessage::WatchStatus {
                live: true,
                name,
                rider_id: Some(rider_id),
            },
        );
        HostGuard {
            screens: self.clone(),
            key: key.to_owned(),
            id,
            rider_id,
        }
    }

    /// Adds a watcher to `key` and tells it right away whether the host rides.
    pub fn watch(
        &self,
        key: &str,
        view: WatchView,
        device: Option<String>,
        outbox: mpsc::Sender<ServerMessage>,
    ) -> Result<WatchGuard, TooManyScreens> {
        let mut reg = self.lock();
        reg.next_id += 1;
        let id = reg.next_id;
        let entry = reg.entries.entry(key.to_owned()).or_default();
        if entry.watchers.len() >= MAX_WATCHERS {
            reg.prune(key);
            return Err(TooManyScreens);
        }
        let (live, name, rider_id) = match &entry.host {
            Some(host) => (true, host.name.clone(), Some(host.rider_id)),
            None => (false, String::new(), None),
        };
        let mut watcher = Watcher {
            id,
            view,
            device,
            outbox,
            pending_status: None,
        };
        watcher.tell(ServerMessage::WatchStatus { live, name, rider_id });
        entry.watchers.push(watcher);
        tell_host(entry);
        Ok(WatchGuard {
            screens: self.clone(),
            key: key.to_owned(),
            id,
        })
    }

    /// Ends the pairing of `key` for good: its watchers are dropped (their connections
    /// notice through [`WatchGuard::is_revoked`]) and the key is refused from now on, see
    /// [`Screens::is_revoked`]. Only the most recent [`MAX_REVOKED`] keys are remembered.
    pub fn revoke(&self, key: &str) {
        let mut reg = self.lock();
        if reg.revoked.insert(key.to_owned()) {
            reg.revoked_order.push_back(key.to_owned());
            if reg.revoked_order.len() > MAX_REVOKED {
                if let Some(oldest) = reg.revoked_order.pop_front() {
                    reg.revoked.remove(&oldest);
                }
            }
        }
        if let Some(entry) = reg.entries.get_mut(key) {
            entry.watchers.clear();
            tell_host(entry);
        }
        reg.prune(key);
    }

    /// Whether `key` was revoked (and is not yet forgotten).
    pub fn is_revoked(&self, key: &str) -> bool {
        self.lock().revoked.contains(key)
    }

    /// The device names of the watchers of `key`, in arrival order (empty for an
    /// unknown key). Watchers that gave no name are left out.
    pub fn watching(&self, key: &str) -> Vec<String> {
        self.lock().entries.get(key).map(devices_of).unwrap_or_default()
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().entries.len()
    }
}

fn devices_of(entry: &Entry) -> Vec<String> {
    entry.watchers.iter().filter_map(|w| w.device.clone()).collect()
}

/// Pushes the watcher list to the host's own connection, if it listens.
fn tell_host(entry: &Entry) {
    if let Some(outbox) = entry.host.as_ref().and_then(|h| h.outbox.as_ref()) {
        let _ = outbox.try_send(ServerMessage::ScreensWatching {
            devices: devices_of(entry),
        });
    }
}

fn tell_all(watchers: &mut [Watcher], status: &ServerMessage) {
    for watcher in watchers {
        watcher.tell(status.clone());
    }
}

/// The host's registration; dropping it ends the host's ride for watchers.
pub struct HostGuard {
    screens: Screens,
    key: String,
    id: u64,
    rider_id: RiderId,
}

impl HostGuard {
    /// Copies a message the host received to the watchers, filtered by view.
    pub fn publish(&self, message: &ServerMessage) {
        if matches!(
            message,
            ServerMessage::Welcome { .. }
                | ServerMessage::Joined { .. }
                | ServerMessage::Error { .. }
                | ServerMessage::ScreensWatching { .. }
        ) {
            return;
        }
        let reg = self.screens.lock();
        let Some(entry) = reg.entries.get(&self.key) else {
            return;
        };
        if !entry.host.as_ref().is_some_and(|h| h.id == self.id) {
            return;
        }
        let mut data = None;
        for watcher in &entry.watchers {
            let copy = match watcher.view {
                WatchView::World => message.clone(),
                WatchView::Data => data.get_or_insert_with(|| data_view(message, self.rider_id)).clone(),
            };
            let _ = watcher.outbox.try_send(copy);
        }
    }

    /// Has the watcher list pushed to `outbox` (the host's own connection),
    /// now and whenever a watcher arrives or leaves.
    pub fn notify_to(&self, outbox: mpsc::Sender<ServerMessage>) {
        let mut reg = self.screens.lock();
        let Some(entry) = reg.entries.get_mut(&self.key) else {
            return;
        };
        let Some(host) = entry.host.as_mut().filter(|h| h.id == self.id) else {
            return;
        };
        host.outbox = Some(outbox);
        tell_host(entry);
    }

    /// Sends the host's opaque display data to every watcher.
    pub fn display(&self, data: serde_json::Value) {
        self.publish(&ServerMessage::Display { data });
    }
}

impl Drop for HostGuard {
    fn drop(&mut self) {
        let mut reg = self.screens.lock();
        if let Some(entry) = reg.entries.get_mut(&self.key) {
            if let Some(host) = entry.host.as_ref().filter(|h| h.id == self.id) {
                let name = host.name.clone();
                entry.host = None;
                let status = ServerMessage::WatchStatus {
                    live: false,
                    name,
                    rider_id: None,
                };
                tell_all(&mut entry.watchers, &status);
            }
        }
        reg.prune(&self.key);
    }
}

/// A watcher's registration; dropping it removes the watcher.
pub struct WatchGuard {
    screens: Screens,
    key: String,
    id: u64,
}

impl WatchGuard {
    /// Whether the watcher was dropped by [`Screens::revoke`]; its connection should end.
    pub fn is_revoked(&self) -> bool {
        let reg = self.screens.lock();
        !reg.entries
            .get(&self.key)
            .is_some_and(|e| e.watchers.iter().any(|w| w.id == self.id))
    }

    /// The host's status if it did not fit into the outbox, once. The watcher's
    /// connection sends it with a waiting send.
    pub fn pending_status(&self) -> Option<ServerMessage> {
        let mut reg = self.screens.lock();
        reg.entries
            .get_mut(&self.key)?
            .watchers
            .iter_mut()
            .find(|w| w.id == self.id)?
            .pending_status
            .take()
    }
}

impl Drop for WatchGuard {
    fn drop(&mut self) {
        let mut reg = self.screens.lock();
        if let Some(entry) = reg.entries.get_mut(&self.key) {
            entry.watchers.retain(|w| w.id != self.id);
            tell_host(entry);
        }
        reg.prune(&self.key);
    }
}

/// What the `data` view shows of `message` for the host `rider_id`: only the
/// host's own rider or seat, without the studio's view of the road; everything
/// else unchanged.
pub fn data_view(message: &ServerMessage, rider_id: RiderId) -> ServerMessage {
    let mut copy = message.clone();
    match &mut copy {
        ServerMessage::State { riders, .. } => riders.retain(|r| r.id == rider_id),
        ServerMessage::StudioState {
            riders, road_riders, ..
        } => {
            riders.retain(|r| r.id == rider_id);
            road_riders.clear();
        }
        _ => {}
    }
    copy
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ClassState, RaceState, RiderState, RouteRiders, SeatState};
    use crate::protocol::{DeviceKind, PhysicsWire};

    fn outbox(cap: usize) -> (mpsc::Sender<ServerMessage>, mpsc::Receiver<ServerMessage>) {
        mpsc::channel(cap)
    }

    fn rider(id: RiderId) -> RiderState {
        RiderState {
            id,
            name: format!("r{id}"),
            is_bot: false,
            route: None,
            distance: 0.0,
            road: None,
            lap: None,
            lane: 0.0,
            speed: 0.0,
            power: 100.0,
            device: DeviceKind::default(),
            vehicle: None,
            cadence: None,
            parked: false,
            exercise: None,
            app: None,
            side: None,
            team: None,
            style: None,
            bot_move: None,
            studio: None,
        }
    }

    fn seat(id: RiderId) -> SeatState {
        SeatState {
            id,
            name: format!("r{id}"),
            is_bot: false,
            seat: 0,
            power: 100.0,
            cadence: None,
            speed: 0.0,
            distance: 0.0,
            on_target_pct: None,
            class_kj: 0.0,
        }
    }

    fn state(ids: &[RiderId]) -> ServerMessage {
        ServerMessage::State {
            tick: 1,
            riders: ids.iter().map(|&i| rider(i)).collect(),
            race: RaceState::Idle,
            route_riders: RouteRiders {
                humans: 3,
                bots: 0,
                remote: 0,
            },
            event: None,
            vehicle: None,
        }
    }

    fn studio(ids: &[RiderId]) -> ServerMessage {
        ServerMessage::StudioState {
            tick: 1,
            room: 0,
            rooms: 1,
            class: ClassState {
                id: "c".into(),
                name: "C".into(),
                starts_at_s: 0.0,
                elapsed_s: 0.0,
            },
            riders: ids.iter().map(|&i| seat(i)).collect(),
            road_riders: vec![],
        }
    }

    fn resistance() -> ServerMessage {
        ServerMessage::Resistance { grade_percent: 4.0 }
    }

    fn status(live: bool, name: &str) -> ServerMessage {
        ServerMessage::WatchStatus {
            live,
            name: name.into(),
            rider_id: live.then_some(7),
        }
    }

    fn watcher(screens: &Screens, view: WatchView) -> (WatchGuard, mpsc::Receiver<ServerMessage>) {
        let (tx, rx) = outbox(64);
        let guard = screens.watch("k", view, None, tx).unwrap();
        (guard, rx)
    }

    #[test]
    fn a_watcher_without_a_host_waits() {
        let screens = Screens::new();
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        assert_eq!(rx.try_recv().unwrap(), status(false, ""));
    }

    #[test]
    fn a_host_arriving_tells_its_watchers() {
        let screens = Screens::new();
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        rx.try_recv().unwrap();
        let _host = screens.host("k", 7, "Ana".into());
        assert_eq!(rx.try_recv().unwrap(), status(true, "Ana"));
    }

    #[test]
    fn a_watcher_arriving_at_a_live_host_is_told_so() {
        let screens = Screens::new();
        let _host = screens.host("k", 7, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        assert_eq!(rx.try_recv().unwrap(), status(true, "Ana"));
    }

    #[test]
    fn the_host_stream_reaches_watchers() {
        let screens = Screens::new();
        let host = screens.host("k", 7, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        rx.try_recv().unwrap();
        host.publish(&resistance());
        assert_eq!(rx.try_recv().unwrap(), resistance());
    }

    #[test]
    fn the_host_handshake_and_errors_are_not_copied() {
        let screens = Screens::new();
        let host = screens.host("k", 7, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::World);
        rx.try_recv().unwrap();
        host.publish(&ServerMessage::Welcome {
            protocol_version: 2,
            server_name: "s".into(),
            server_version: "v".into(),
            auth_mode: "none".into(),
            route_id: "r".into(),
            grace_s: 0.0,
        });
        host.publish(&ServerMessage::Joined {
            rider_id: 7,
            resume_token: "t".into(),
            physics: PhysicsWire {
                mass_kg: 80.0,
                cda_m2: 0.4,
                crr: 0.005,
                air_density: 1.2,
            },
        });
        host.publish(&ServerMessage::error("bad", "no"));
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn the_data_view_keeps_only_the_host_rider() {
        let screens = Screens::new();
        let host = screens.host("k", 2, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        rx.try_recv().unwrap();
        host.publish(&state(&[1, 2, 3]));
        assert_eq!(rx.try_recv().unwrap(), state(&[2]));
    }

    #[test]
    fn the_data_view_keeps_only_the_host_seat_in_the_studio() {
        let screens = Screens::new();
        let host = screens.host("k", 2, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        rx.try_recv().unwrap();
        host.publish(&studio(&[1, 2, 3]));
        assert_eq!(rx.try_recv().unwrap(), studio(&[2]));
    }

    #[test]
    fn the_data_view_leaves_out_the_riders_outside_the_studio() {
        let screens = Screens::new();
        let host = screens.host("k", 2, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        rx.try_recv().unwrap();
        let mut with_road = studio(&[2]);
        if let ServerMessage::StudioState { road_riders, .. } = &mut with_road {
            *road_riders = vec![rider(8), rider(9)];
        }
        host.publish(&with_road);
        assert_eq!(rx.try_recv().unwrap(), studio(&[2]));
    }

    #[test]
    fn the_world_view_passes_everything() {
        let screens = Screens::new();
        let host = screens.host("k", 2, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::World);
        rx.try_recv().unwrap();
        host.publish(&state(&[1, 2, 3]));
        assert_eq!(rx.try_recv().unwrap(), state(&[1, 2, 3]));
    }

    #[test]
    fn display_reaches_every_watcher() {
        let screens = Screens::new();
        let host = screens.host("k", 2, "Ana".into());
        let (_g1, mut a) = watcher(&screens, WatchView::Data);
        let (_g2, mut b) = watcher(&screens, WatchView::World);
        a.try_recv().unwrap();
        b.try_recv().unwrap();
        host.display(serde_json::json!({"hr": 140}));
        let expected = ServerMessage::Display {
            data: serde_json::json!({"hr": 140}),
        };
        assert_eq!(a.try_recv().unwrap(), expected);
        assert_eq!(b.try_recv().unwrap(), expected);
    }

    #[test]
    fn revoking_a_key_drops_its_watchers_and_refuses_it_from_then_on() {
        let screens = Screens::new();
        let (guard, _rx) = watcher(&screens, WatchView::Data);
        let (other, _rx2) = {
            let (tx, rx) = outbox(4);
            (screens.watch("other", WatchView::Data, None, tx).unwrap(), rx)
        };
        assert!(!guard.is_revoked());
        assert!(!screens.is_revoked("k"));
        screens.revoke("k");
        assert!(guard.is_revoked());
        assert!(screens.is_revoked("k"));
        assert!(!other.is_revoked());
        assert!(!screens.is_revoked("other"));
        assert!(screens.watching("k").is_empty());
    }

    #[test]
    fn revoking_tells_the_host_nobody_watches() {
        let screens = Screens::new();
        let host = screens.host("k", 1, "Ana".into());
        let (host_tx, mut host_rx) = outbox(8);
        host.notify_to(host_tx);
        let (_g, _rx) = watcher(&screens, WatchView::Data);
        while host_rx.try_recv().is_ok() {}
        screens.revoke("k");
        assert_eq!(
            host_rx.try_recv().unwrap(),
            ServerMessage::ScreensWatching { devices: vec![] }
        );
    }

    #[test]
    fn only_the_latest_revoked_keys_are_remembered() {
        let screens = Screens::new();
        for i in 0..=MAX_REVOKED {
            screens.revoke(&format!("key{i}"));
        }
        assert!(!screens.is_revoked("key0"));
        assert!(screens.is_revoked("key1"));
        assert!(screens.is_revoked(&format!("key{MAX_REVOKED}")));
        screens.revoke("key1");
        assert_eq!(screens.lock().revoked.len(), MAX_REVOKED);
    }

    #[test]
    fn the_fifth_watcher_is_refused() {
        let screens = Screens::new();
        let _guards: Vec<_> = (0..MAX_WATCHERS).map(|_| watcher(&screens, WatchView::Data)).collect();
        let (tx, _rx) = outbox(4);
        assert!(matches!(
            screens.watch("k", WatchView::Data, None, tx),
            Err(TooManyScreens)
        ));
    }

    #[test]
    fn a_newer_host_replaces_the_older() {
        let screens = Screens::new();
        let old = screens.host("k", 1, "Old".into());
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        rx.try_recv().unwrap();
        let _new = screens.host("k", 7, "New".into());
        assert_eq!(rx.try_recv().unwrap(), status(true, "New"));
        drop(old);
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn a_watcher_that_arrives_during_a_ride_is_told_the_hosts_rider_id() {
        let screens = Screens::new();
        let _host = screens.host("k", 12, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        let ServerMessage::WatchStatus { rider_id, .. } = rx.try_recv().unwrap() else {
            panic!("expected a watch_status");
        };
        assert_eq!(rider_id, Some(12));
    }

    #[test]
    fn watchers_are_told_the_rider_id_when_the_host_arrives() {
        let screens = Screens::new();
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        rx.try_recv().unwrap();
        let _host = screens.host("k", 12, "Ana".into());
        let ServerMessage::WatchStatus { rider_id, .. } = rx.try_recv().unwrap() else {
            panic!("expected a watch_status");
        };
        assert_eq!(rider_id, Some(12));
    }

    #[test]
    fn the_rider_id_is_absent_when_the_host_leaves() {
        let screens = Screens::new();
        let host = screens.host("k", 12, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        rx.try_recv().unwrap();
        drop(host);
        let ServerMessage::WatchStatus { rider_id, .. } = rx.try_recv().unwrap() else {
            panic!("expected a watch_status");
        };
        assert_eq!(rider_id, None);
    }

    #[test]
    fn the_host_leaving_tells_its_watchers() {
        let screens = Screens::new();
        let host = screens.host("k", 1, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::Data);
        rx.try_recv().unwrap();
        drop(host);
        assert_eq!(rx.try_recv().unwrap(), status(false, "Ana"));
    }

    #[test]
    fn the_entry_is_gone_when_empty() {
        let screens = Screens::new();
        let host = screens.host("k", 1, "Ana".into());
        let (g, _rx) = watcher(&screens, WatchView::Data);
        assert_eq!(screens.len(), 1);
        drop(host);
        assert_eq!(screens.len(), 1);
        drop(g);
        assert_eq!(screens.len(), 0);
    }

    #[test]
    fn a_status_that_does_not_fit_waits_for_the_connection() {
        let screens = Screens::new();
        let (tx, mut rx) = outbox(1);
        let guard = screens.watch("k", WatchView::Data, None, tx).unwrap();
        // The queue is full with the "waiting" status, so "live" cannot go in.
        let _host = screens.host("k", 7, "Ana".into());
        assert_eq!(rx.try_recv().unwrap(), status(false, ""));
        assert!(rx.try_recv().is_err());
        assert_eq!(guard.pending_status(), Some(status(true, "Ana")));
        assert_eq!(guard.pending_status(), None);
    }

    #[test]
    fn a_delivered_status_is_not_pending() {
        let screens = Screens::new();
        let (guard, mut rx) = watcher(&screens, WatchView::Data);
        let _host = screens.host("k", 7, "Ana".into());
        rx.try_recv().unwrap();
        assert_eq!(rx.try_recv().unwrap(), status(true, "Ana"));
        assert_eq!(guard.pending_status(), None);
    }

    #[test]
    fn a_newer_status_replaces_a_pending_one() {
        let screens = Screens::new();
        let (tx, mut rx) = outbox(1);
        let guard = screens.watch("k", WatchView::Data, None, tx).unwrap();
        let host = screens.host("k", 7, "Ana".into());
        rx.try_recv().unwrap();
        drop(host);
        assert_eq!(rx.try_recv().unwrap(), status(false, "Ana"));
        assert_eq!(guard.pending_status(), None);
    }

    #[test]
    fn a_full_watcher_does_not_block_the_host() {
        let screens = Screens::new();
        let host = screens.host("k", 1, "Ana".into());
        let (slow_tx, _slow_rx) = outbox(1);
        let _slow = screens.watch("k", WatchView::Data, None, slow_tx).unwrap();
        let (_g, mut fast) = watcher(&screens, WatchView::Data);
        fast.try_recv().unwrap();
        for _ in 0..10 {
            host.publish(&resistance());
        }
        for _ in 0..10 {
            assert_eq!(fast.try_recv().unwrap(), resistance());
        }
    }

    fn named_watcher(screens: &Screens, device: &str) -> (WatchGuard, mpsc::Receiver<ServerMessage>) {
        let (tx, rx) = outbox(64);
        let guard = screens.watch("k", WatchView::Data, Some(device.into()), tx).unwrap();
        (guard, rx)
    }

    fn devices(list: &[&str]) -> ServerMessage {
        ServerMessage::ScreensWatching {
            devices: list.iter().map(|d| (*d).to_owned()).collect(),
        }
    }

    #[test]
    fn watching_lists_the_named_watchers() {
        let screens = Screens::new();
        let (_a, _rx_a) = named_watcher(&screens, "Quest 3");
        let (_b, _rx_b) = watcher(&screens, WatchView::Data);
        let (_c, _rx_c) = named_watcher(&screens, "Pixel 8");
        assert_eq!(screens.watching("k"), vec!["Quest 3".to_owned(), "Pixel 8".to_owned()]);
    }

    #[test]
    fn watching_an_unknown_key_is_empty() {
        assert!(Screens::new().watching("nobody").is_empty());
    }

    #[test]
    fn the_host_hears_when_a_watcher_arrives_and_leaves() {
        let screens = Screens::new();
        let host = screens.host("k", 1, "Ana".into());
        let (tx, mut rx) = outbox(8);
        host.notify_to(tx);
        assert_eq!(rx.try_recv().unwrap(), devices(&[]));
        let (guard, _rx) = named_watcher(&screens, "Quest 3");
        assert_eq!(rx.try_recv().unwrap(), devices(&["Quest 3"]));
        drop(guard);
        assert_eq!(rx.try_recv().unwrap(), devices(&[]));
    }

    #[test]
    fn the_hosts_device_list_is_not_relayed() {
        let screens = Screens::new();
        let host = screens.host("k", 1, "Ana".into());
        let (_g, mut rx) = watcher(&screens, WatchView::World);
        rx.try_recv().unwrap();
        host.publish(&devices(&["Quest 3"]));
        assert!(rx.try_recv().is_err());
    }
}
