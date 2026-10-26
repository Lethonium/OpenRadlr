//! Wall-clock schedules: a lobby, then a run, repeating or once.
//!
//! Pure functions of `now_s` (Unix seconds); no clocks, no I/O. The studio
//! timetable and scheduled events both sit on top of this.

/// When something happens: a lobby opens `lobby_s` before the start and the
/// occurrence lasts `duration_s` from the start.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Schedule {
    /// Occurrence `k` starts at `k * every_s + offset_s`.
    Every {
        every_s: f64,
        offset_s: f64,
        lobby_s: f64,
        duration_s: f64,
    },
    Once {
        starts_at_s: f64,
        lobby_s: f64,
        duration_s: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Upcoming,
    Lobby,
    Running,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Occurrence {
    pub index: u64,
    pub lobby_opens_at_s: f64,
    pub starts_at_s: f64,
    pub ends_at_s: f64,
    pub phase: Phase,
}

/// Overlaps of repeating schedules are checked over this many seconds from Unix 0.
const WEEK_S: f64 = 7.0 * 86_400.0;

impl Occurrence {
    fn phase_at(mut self, now_s: f64) -> Self {
        self.phase = if now_s < self.lobby_opens_at_s {
            Phase::Upcoming
        } else if now_s < self.starts_at_s {
            Phase::Lobby
        } else {
            Phase::Running
        };
        self
    }
}

impl Schedule {
    /// The occurrence whose window `[lobby opens, end)` contains `now_s`,
    /// else the next one. `None` for a `Once` after its end, or for a repeating
    /// schedule whose interval is not a positive number.
    pub fn at(&self, now_s: f64) -> Option<Occurrence> {
        match *self {
            Self::Every {
                every_s,
                offset_s,
                lobby_s,
                ..
            } => {
                let current = ((now_s - offset_s + lobby_s) / every_s).floor().max(0.0) as u64;
                let occurrence = self.occurrence(current)?;
                let index = if now_s >= occurrence.ends_at_s {
                    current + 1
                } else {
                    current
                };
                Some(self.occurrence(index)?.phase_at(now_s))
            }
            Self::Once { .. } => {
                let occurrence = self.occurrence(0)?;
                (now_s < occurrence.ends_at_s).then(|| occurrence.phase_at(now_s))
            }
        }
    }

    /// Occurrence `index` (`Once` has only 0), `Upcoming` relative to its own start.
    pub fn occurrence(&self, index: u64) -> Option<Occurrence> {
        let (starts_at_s, lobby_s, duration_s) = match *self {
            Self::Every {
                every_s,
                offset_s,
                lobby_s,
                duration_s,
            } => (index as f64 * every_s + offset_s, lobby_s, duration_s),
            Self::Once {
                starts_at_s,
                lobby_s,
                duration_s,
            } => (starts_at_s, lobby_s, duration_s),
        };
        match self {
            Self::Once { .. } if index != 0 => return None,
            Self::Every { every_s, .. } if !(every_s.is_finite() && *every_s > 0.0) => return None,
            _ => {}
        }
        Some(Occurrence {
            index,
            lobby_opens_at_s: starts_at_s - lobby_s,
            starts_at_s,
            ends_at_s: starts_at_s + duration_s,
            phase: Phase::Upcoming,
        })
    }

    /// Whether the windows `[lobby opens, end)` of the two schedules intersect.
    /// Two repeating schedules are compared within one week from Unix 0; a
    /// `Once` is compared at its own time, wherever that is.
    pub fn overlaps(&self, other: &Schedule) -> bool {
        let range = [self, other]
            .into_iter()
            .find_map(|schedule| match schedule {
                Self::Once { .. } => schedule.occurrence(0).map(|o| (o.lobby_opens_at_s, o.ends_at_s)),
                Self::Every { .. } => None,
            })
            .unwrap_or((0.0, WEEK_S));
        let others = other.windows(range);
        self.windows(range)
            .iter()
            .any(|a| others.iter().any(|b| a.0 < b.1 && b.0 < a.1))
    }

    /// Windows that may intersect `range`; a repeating schedule with a
    /// non-positive or non-finite interval has none.
    fn windows(&self, range: (f64, f64)) -> Vec<(f64, f64)> {
        let Self::Every {
            every_s,
            offset_s,
            lobby_s,
            duration_s,
        } = *self
        else {
            return self
                .occurrence(0)
                .map(|o| (o.lobby_opens_at_s, o.ends_at_s))
                .into_iter()
                .collect();
        };
        if !(every_s.is_finite() && every_s > 0.0) {
            return Vec::new();
        }
        let first = ((range.0 - offset_s - duration_s) / every_s).floor().max(0.0) as u64;
        let last = ((range.1 - offset_s + lobby_s) / every_s).ceil().max(0.0) as u64;
        (first..=last)
            .filter_map(|index| self.occurrence(index))
            .map(|o| (o.lobby_opens_at_s, o.ends_at_s))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOURLY: Schedule = Schedule::Every {
        every_s: 3600.0,
        offset_s: 0.0,
        lobby_s: 600.0,
        duration_s: 2700.0,
    };

    #[test]
    fn every_reports_lobby_running_and_next() {
        let lobby = HOURLY.at(3000.0).unwrap();
        assert_eq!((lobby.index, lobby.phase, lobby.starts_at_s), (1, Phase::Lobby, 3600.0));
        assert_eq!(HOURLY.at(3600.0).unwrap().phase, Phase::Running);
        assert_eq!(HOURLY.at(6299.0).unwrap().phase, Phase::Running);
        let next = HOURLY.at(6300.0).unwrap();
        assert_eq!(
            (next.index, next.phase, next.lobby_opens_at_s),
            (2, Phase::Upcoming, 6600.0)
        );
    }

    #[test]
    fn offset_moves_the_start() {
        let schedule = Schedule::Every {
            every_s: 3600.0,
            offset_s: 1800.0,
            lobby_s: 600.0,
            duration_s: 2700.0,
        };
        let first = schedule.at(0.0).unwrap();
        assert_eq!(
            (first.index, first.phase, first.starts_at_s),
            (0, Phase::Upcoming, 1800.0)
        );
        assert_eq!(schedule.at(1300.0).unwrap().phase, Phase::Lobby);
    }

    #[test]
    fn once_ends() {
        let schedule = Schedule::Once {
            starts_at_s: 1000.0,
            lobby_s: 100.0,
            duration_s: 50.0,
        };
        assert_eq!(schedule.at(0.0).unwrap().phase, Phase::Upcoming);
        assert_eq!(schedule.at(950.0).unwrap().phase, Phase::Lobby);
        assert_eq!(schedule.at(1049.0).unwrap().phase, Phase::Running);
        assert_eq!(schedule.at(1050.0), None);
        assert_eq!(schedule.occurrence(1), None);
    }

    #[test]
    fn overlap_detection() {
        let every = |every_s, offset_s, duration_s| Schedule::Every {
            every_s,
            offset_s,
            lobby_s: 600.0,
            duration_s,
        };
        let even_hours = every(7200.0, 0.0, 2700.0);
        assert!(HOURLY.overlaps(&every(7200.0, 1800.0, 1500.0)));
        assert!(!even_hours.overlaps(&every(7200.0, 3600.0, 2700.0)));
        let once = Schedule::Once {
            starts_at_s: 3700.0,
            lobby_s: 100.0,
            duration_s: 50.0,
        };
        assert!(HOURLY.overlaps(&once));
        assert!(!even_hours.overlaps(&once));
    }

    #[test]
    fn a_once_at_a_real_unix_time_overlaps_the_repeating_schedule_there() {
        // 1_700_002_800 = 472_223 h exactly: an hour start of HOURLY.
        let hour = 1_700_002_800.0;
        let once = |starts_at_s| Schedule::Once {
            starts_at_s,
            lobby_s: 100.0,
            duration_s: 50.0,
        };
        assert!(HOURLY.overlaps(&once(hour + 100.0)), "inside the running window");
        assert!(once(hour + 100.0).overlaps(&HOURLY));
        assert!(
            !HOURLY.overlaps(&once(hour + 2900.0)),
            "in the gap before the next lobby"
        );
    }

    #[test]
    fn a_non_positive_or_non_finite_interval_has_no_occurrences() {
        for every_s in [0.0, -3600.0, f64::NAN, f64::INFINITY] {
            let broken = Schedule::Every {
                every_s,
                offset_s: 0.0,
                lobby_s: 600.0,
                duration_s: 2700.0,
            };
            assert_eq!(broken.at(1000.0), None);
            assert!(!broken.overlaps(&HOURLY) && !HOURLY.overlaps(&broken));
        }
    }
}
