//! Race state machine: `Idle -> Countdown -> Running -> Finished`.
//!
//! The race only tracks phase, time and results. Deciding *when* a rider
//! crosses the line is the job of the [`crate::world::World`].

use crate::world::RiderId;
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum RacePhase {
    Idle,
    Countdown { laps: u32, remaining_s: f64 },
    Running { laps: u32, elapsed_s: f64 },
    Finished { laps: u32 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct RaceResult {
    pub rider_id: RiderId,
    pub name: String,
    pub is_bot: bool,
    pub time_s: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RaceEvent {
    CountdownStarted {
        laps: u32,
        seconds: f64,
    },
    Started {
        laps: u32,
    },
    RiderFinished {
        rider_id: RiderId,
        name: String,
        is_bot: bool,
        position: usize,
        time_s: f64,
    },
    Finished,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RaceError {
    AlreadyInProgress,
    InvalidLaps {
        max: u32,
    },
    /// Joining is only possible while the countdown runs.
    NotOpen,
}

impl fmt::Display for RaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RaceError::AlreadyInProgress => write!(f, "a race is already in progress"),
            RaceError::InvalidLaps { max } => write!(f, "laps must be between 1 and {max}"),
            RaceError::NotOpen => write!(f, "you can only join a race during its countdown"),
        }
    }
}

impl std::error::Error for RaceError {}

#[derive(Debug, Clone)]
pub struct Race {
    phase: RacePhase,
    countdown_s: f64,
    max_laps: u32,
    results: Vec<RaceResult>,
}

impl Race {
    pub fn new(countdown_s: f64, max_laps: u32) -> Self {
        Self {
            phase: RacePhase::Idle,
            countdown_s,
            max_laps,
            results: Vec::new(),
        }
    }

    pub fn phase(&self) -> &RacePhase {
        &self.phase
    }

    pub fn results(&self) -> &[RaceResult] {
        &self.results
    }

    /// Number of laps while the race is running.
    pub fn running_laps(&self) -> Option<u32> {
        match self.phase {
            RacePhase::Running { laps, .. } => Some(laps),
            _ => None,
        }
    }

    pub fn request_start(&mut self, laps: u32) -> Result<RaceEvent, RaceError> {
        if matches!(self.phase, RacePhase::Countdown { .. } | RacePhase::Running { .. }) {
            return Err(RaceError::AlreadyInProgress);
        }
        if laps == 0 || laps > self.max_laps {
            return Err(RaceError::InvalidLaps { max: self.max_laps });
        }
        self.results.clear();
        self.phase = RacePhase::Countdown {
            laps,
            remaining_s: self.countdown_s,
        };
        Ok(RaceEvent::CountdownStarted {
            laps,
            seconds: self.countdown_s,
        })
    }

    /// Advances timers by `dt`. Returns `Started` when the countdown ends.
    pub fn advance(&mut self, dt: f64) -> Option<RaceEvent> {
        match &mut self.phase {
            RacePhase::Countdown { laps, remaining_s } => {
                *remaining_s -= dt;
                if *remaining_s <= 0.0 {
                    let laps = *laps;
                    self.phase = RacePhase::Running { laps, elapsed_s: 0.0 };
                    return Some(RaceEvent::Started { laps });
                }
                None
            }
            RacePhase::Running { elapsed_s, .. } => {
                *elapsed_s += dt;
                None
            }
            RacePhase::Idle | RacePhase::Finished { .. } => None,
        }
    }

    pub fn record_finish(&mut self, rider_id: RiderId, name: &str, is_bot: bool) -> Option<RaceEvent> {
        let RacePhase::Running { elapsed_s, .. } = self.phase else {
            return None;
        };
        if self.results.iter().any(|r| r.rider_id == rider_id) {
            return None;
        }
        self.results.push(RaceResult {
            rider_id,
            name: name.to_owned(),
            is_bot,
            time_s: elapsed_s,
        });
        Some(RaceEvent::RiderFinished {
            rider_id,
            name: name.to_owned(),
            is_bot,
            position: self.results.len(),
            time_s: elapsed_s,
        })
    }

    /// Starts a race at once, without a countdown (scheduled events).
    /// Possible from `Idle` or `Finished`; results are cleared.
    pub fn start_now(&mut self, laps: u32) -> Result<RaceEvent, RaceError> {
        if matches!(self.phase, RacePhase::Countdown { .. } | RacePhase::Running { .. }) {
            return Err(RaceError::AlreadyInProgress);
        }
        if laps == 0 || laps > self.max_laps {
            return Err(RaceError::InvalidLaps { max: self.max_laps });
        }
        self.results.clear();
        self.phase = RacePhase::Running { laps, elapsed_s: 0.0 };
        Ok(RaceEvent::Started { laps })
    }

    /// Drops whatever is going on: back to `Idle`, results cleared.
    pub fn abort(&mut self) {
        self.phase = RacePhase::Idle;
        self.results.clear();
    }

    pub fn complete(&mut self) -> Option<RaceEvent> {
        let RacePhase::Running { laps, .. } = self.phase else {
            return None;
        };
        self.phase = RacePhase::Finished { laps };
        Some(RaceEvent::Finished)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_through_all_phases() {
        let mut race = Race::new(10.0, 5);
        assert_eq!(race.phase(), &RacePhase::Idle);

        assert_eq!(
            race.request_start(2),
            Ok(RaceEvent::CountdownStarted { laps: 2, seconds: 10.0 })
        );
        assert_eq!(race.advance(9.0), None);
        assert_eq!(race.advance(1.0), Some(RaceEvent::Started { laps: 2 }));
        assert_eq!(race.running_laps(), Some(2));

        race.advance(30.0);
        let finished = race.record_finish(7, "Anna", false);
        assert!(matches!(finished, Some(RaceEvent::RiderFinished { position: 1, .. })));
        assert_eq!(race.results()[0].time_s, 30.0);

        assert_eq!(race.complete(), Some(RaceEvent::Finished));
        assert_eq!(race.phase(), &RacePhase::Finished { laps: 2 });
    }

    #[test]
    fn start_now_skips_the_countdown_and_abort_resets() {
        let mut race = Race::new(10.0, 5);
        assert_eq!(race.start_now(0), Err(RaceError::InvalidLaps { max: 5 }));
        assert_eq!(race.start_now(2), Ok(RaceEvent::Started { laps: 2 }));
        assert_eq!(race.running_laps(), Some(2));
        assert_eq!(race.start_now(2), Err(RaceError::AlreadyInProgress));
        race.record_finish(1, "A", false);
        race.complete();
        assert_eq!(race.start_now(1), Ok(RaceEvent::Started { laps: 1 }));
        assert!(race.results().is_empty());
        race.record_finish(1, "A", false);
        race.abort();
        assert_eq!(race.phase(), &RacePhase::Idle);
        assert!(race.results().is_empty());
    }

    #[test]
    fn rejects_overlapping_races_and_bad_lap_counts() {
        let mut race = Race::new(10.0, 5);
        assert_eq!(race.request_start(0), Err(RaceError::InvalidLaps { max: 5 }));
        assert_eq!(race.request_start(6), Err(RaceError::InvalidLaps { max: 5 }));
        race.request_start(1).unwrap();
        assert_eq!(race.request_start(1), Err(RaceError::AlreadyInProgress));
    }

    #[test]
    fn a_rider_finishes_only_once_and_only_while_running() {
        let mut race = Race::new(0.0, 5);
        assert_eq!(race.record_finish(1, "A", false), None);
        race.request_start(1).unwrap();
        race.advance(0.0);
        assert!(race.record_finish(1, "A", false).is_some());
        assert_eq!(race.record_finish(1, "A", false), None);
    }

    #[test]
    fn a_finished_race_can_be_restarted_and_clears_results() {
        let mut race = Race::new(0.0, 5);
        race.request_start(1).unwrap();
        race.advance(0.0);
        race.record_finish(1, "A", false);
        race.complete();
        race.request_start(1).unwrap();
        assert!(race.results().is_empty());
    }
}
