//! Community distance counters (#65): how far everyone has ridden on this
//! server, split by what the power came from. Only kilometres are kept, no
//! rider names, ids or keys.
//!
//! The totals live in memory, shared by all game loops, and are saved to one
//! small JSON file when a path is configured.

use crate::protocol::DeviceKind;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Metres ridden, per kind of device.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Distance {
    #[serde(default)]
    pub trainer_m: f64,
    #[serde(default)]
    pub paddle_m: f64,
}

impl Distance {
    /// Adds `metres` to the counter of `device`. The simulated trainer (keyboard
    /// power) is no real effort and counts toward neither; nor does a
    /// non-positive or non-finite distance.
    pub fn add(&mut self, device: DeviceKind, metres: f64) {
        if !metres.is_finite() || metres <= 0.0 {
            return;
        }
        match device {
            DeviceKind::Trainer => self.trainer_m += metres,
            DeviceKind::Paddle => self.paddle_m += metres,
            // A sim rider rides on the keyboard, a workout rider not at all.
            DeviceKind::Sim | DeviceKind::Workout => {}
        }
    }
}

/// Cheap, cloneable handle to the server's totals.
#[derive(Debug, Clone, Default)]
pub struct DistanceStats {
    totals: Arc<Mutex<Distance>>,
}

impl DistanceStats {
    pub fn new(start: Distance) -> Self {
        Self {
            totals: Arc::new(Mutex::new(start)),
        }
    }

    pub fn add(&self, device: DeviceKind, metres: f64) {
        self.lock().add(device, metres);
    }

    pub fn snapshot(&self) -> Distance {
        *self.lock()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Distance> {
        self.totals.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Reads the saved totals; a missing or unreadable file starts from zero
    /// (the error is returned for the caller to log).
    pub fn load(path: &Path) -> (Self, Option<String>) {
        match std::fs::read_to_string(path) {
            Ok(text) => match serde_json::from_str::<Distance>(&text) {
                Ok(distance) if distance.trainer_m.is_finite() && distance.paddle_m.is_finite() => {
                    (Self::new(distance), None)
                }
                Ok(_) => (
                    Self::default(),
                    Some(format!("{}: totals are not numbers", path.display())),
                ),
                Err(e) => (Self::default(), Some(format!("{}: {e}", path.display()))),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Self::default(), None),
            Err(e) => (Self::default(), Some(format!("{}: {e}", path.display()))),
        }
    }

    /// Writes the totals to `path` (via a temporary file, so a crash never leaves half a file).
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir)?;
        }
        let text = serde_json::to_string(&self.snapshot()).map_err(std::io::Error::other)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("openradlr-stats-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("stats.json")
    }

    #[test]
    fn trainer_and_paddle_distance_are_counted_separately() {
        let stats = DistanceStats::default();
        stats.add(DeviceKind::Trainer, 1000.0);
        stats.add(DeviceKind::Trainer, 500.0);
        stats.add(DeviceKind::Paddle, 250.0);
        assert_eq!(
            stats.snapshot(),
            Distance {
                trainer_m: 1500.0,
                paddle_m: 250.0
            }
        );
    }

    #[test]
    fn the_simulated_trainer_adds_nothing() {
        let stats = DistanceStats::default();
        stats.add(DeviceKind::Sim, 10_000.0);
        assert_eq!(stats.snapshot(), Distance::default());
    }

    #[test]
    fn nonsense_distances_add_nothing() {
        let stats = DistanceStats::default();
        stats.add(DeviceKind::Trainer, -5.0);
        stats.add(DeviceKind::Trainer, f64::NAN);
        stats.add(DeviceKind::Paddle, f64::INFINITY);
        assert_eq!(stats.snapshot(), Distance::default());
    }

    #[test]
    fn handles_share_one_total() {
        let stats = DistanceStats::default();
        stats.clone().add(DeviceKind::Paddle, 100.0);
        assert_eq!(stats.snapshot().paddle_m, 100.0);
    }

    #[test]
    fn totals_survive_a_save_and_load() {
        let path = temp_path("roundtrip");
        let stats = DistanceStats::default();
        stats.add(DeviceKind::Trainer, 12_345.5);
        stats.add(DeviceKind::Paddle, 678.0);
        stats.save(&path).unwrap();

        let (loaded, problem) = DistanceStats::load(&path);
        assert_eq!(problem, None);
        assert_eq!(loaded.snapshot(), stats.snapshot());
    }

    #[test]
    fn a_missing_file_starts_from_zero_without_complaint() {
        let (stats, problem) = DistanceStats::load(&temp_path("missing"));
        assert_eq!(stats.snapshot(), Distance::default());
        assert_eq!(problem, None);
    }

    #[test]
    fn a_broken_file_starts_from_zero_and_says_why() {
        let path = temp_path("broken");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "not json").unwrap();
        let (stats, problem) = DistanceStats::load(&path);
        assert_eq!(stats.snapshot(), Distance::default());
        assert!(problem.is_some());
    }
}
