//! AFK watch: notices riders who have stopped pedalling and warns them before removal.
//!
//! Away means every telemetry sample since the last pedalling had `power == 0`
//! (raw power, so a paused trainer counts as away). Any sample with `power > 0`
//! is "back": it restarts the clock and clears the warning count. The rules are
//! in `docs/superpowers/specs/2026-11-05-afk-timeout-design.md`.
//!
//! This module holds only the state machine. The connection loop polls it and
//! turns its [`AfkEvent`]s into messages and removals.

/// Warnings that offer "Stay" before the final, leave-only warning.
pub const AFK_STAYS: u32 = 3;

/// What the connection loop should do after polling the watch.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AfkEvent {
    /// Send an `afk_warning`; `can_stay` is false for the final, leave-only warning.
    Warn { leave_in_s: u32, can_stay: bool },
    /// The open warning went unanswered: remove the rider.
    Expire,
}

/// Per-rider away clock and warning state.
#[derive(Debug, Clone)]
pub struct AfkWatch {
    timeout_s: f64,
    reminder_s: f64,
    answer_s: f64,
    /// When the current away stretch started (or was last extended by a Stay).
    since_s: f64,
    /// Away time after which the next warning opens.
    threshold_s: f64,
    /// Stays accepted since the rider last pedalled.
    stays: u32,
    /// Open warning: when it was sent and whether it offers Stay.
    open: Option<(f64, bool)>,
    inert: bool,
}

impl AfkWatch {
    /// A watch that never warns (`timeout_s <= 0` turns the feature off).
    pub fn new(timeout_s: f64, reminder_s: f64, answer_s: f64, now_s: f64) -> Self {
        Self {
            timeout_s,
            reminder_s,
            answer_s,
            since_s: now_s,
            threshold_s: timeout_s,
            stays: 0,
            open: None,
            inert: timeout_s <= 0.0,
        }
    }

    /// A watch that never warns, for riders who are exempt (workouts) or not yet joined.
    pub fn inert() -> Self {
        Self::new(0.0, 0.0, 0.0, 0.0)
    }

    /// Records a telemetry sample. Any pedalling (`power > 0`) resets the watch.
    pub fn on_power(&mut self, power: f64, now_s: f64) {
        if power > 0.0 {
            self.since_s = now_s;
            self.threshold_s = self.timeout_s;
            self.stays = 0;
            self.open = None;
        }
    }

    /// The rider chose Stay. Accepted only while a Stay-capable warning is open.
    pub fn on_stay(&mut self, now_s: f64) -> bool {
        match self.open {
            Some((_, true)) => {
                self.stays += 1;
                self.since_s = now_s;
                self.threshold_s = self.reminder_s;
                self.open = None;
                true
            }
            _ => false,
        }
    }

    pub fn warning_open(&self) -> bool {
        self.open.is_some()
    }

    /// Advances the clock. Returns a warning when one opens, or `Expire` once
    /// the open warning's answer window has passed.
    pub fn poll(&mut self, now_s: f64) -> Option<AfkEvent> {
        if self.inert {
            return None;
        }
        if let Some((opened_s, _)) = self.open {
            if now_s - opened_s >= self.answer_s {
                self.open = None;
                return Some(AfkEvent::Expire);
            }
            return None;
        }
        if now_s - self.since_s >= self.threshold_s {
            let can_stay = self.stays < AFK_STAYS;
            self.open = Some((now_s, can_stay));
            return Some(AfkEvent::Warn {
                leave_in_s: self.answer_s.round() as u32,
                can_stay,
            });
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watch() -> AfkWatch {
        AfkWatch::new(1800.0, 600.0, 120.0, 0.0)
    }

    fn warn(can_stay: bool) -> Option<AfkEvent> {
        Some(AfkEvent::Warn {
            leave_in_s: 120,
            can_stay,
        })
    }

    #[test]
    fn no_warning_before_the_timeout() {
        let mut w = watch();
        assert_eq!(w.poll(1799.0), None);
    }

    #[test]
    fn warns_after_the_timeout() {
        let mut w = watch();
        assert_eq!(w.poll(1800.0), warn(true));
        assert_eq!(w.poll(1801.0), None);
    }

    #[test]
    fn power_resets_the_clock() {
        let mut w = watch();
        w.on_power(150.0, 1000.0);
        assert_eq!(w.poll(2799.0), None);
        assert_eq!(w.poll(2800.0), warn(true));
    }

    #[test]
    fn zero_power_does_not_reset() {
        let mut w = watch();
        w.on_power(0.0, 1000.0);
        assert_eq!(w.poll(1800.0), warn(true));
    }

    #[test]
    fn unanswered_warning_expires() {
        let mut w = watch();
        assert_eq!(w.poll(1800.0), warn(true));
        assert_eq!(w.poll(1919.0), None);
        assert_eq!(w.poll(1920.0), Some(AfkEvent::Expire));
    }

    #[test]
    fn stay_moves_the_next_warning_by_the_reminder() {
        let mut w = watch();
        assert_eq!(w.poll(1800.0), warn(true));
        assert!(w.on_stay(1850.0));
        assert!(!w.warning_open());
        assert_eq!(w.poll(2449.0), None);
        assert_eq!(w.poll(2450.0), warn(true));
    }

    #[test]
    fn fourth_warning_is_final() {
        let mut w = watch();
        let mut now = 1800.0;
        for _ in 0..AFK_STAYS {
            assert_eq!(w.poll(now), warn(true));
            assert!(w.on_stay(now + 50.0));
            now += 50.0 + 600.0;
        }
        assert_eq!(w.poll(now), warn(false));
        assert!(!w.on_stay(now + 10.0));
        assert_eq!(w.poll(now + 120.0), Some(AfkEvent::Expire));
    }

    #[test]
    fn stay_without_a_warning_is_ignored() {
        let mut w = watch();
        assert!(!w.on_stay(100.0));
        assert_eq!(w.poll(1800.0), warn(true));
    }

    #[test]
    fn power_during_final_warning_resets() {
        let mut w = watch();
        let mut now = 1800.0;
        for _ in 0..AFK_STAYS {
            assert_eq!(w.poll(now), warn(true));
            assert!(w.on_stay(now + 50.0));
            now += 50.0 + 600.0;
        }
        assert_eq!(w.poll(now), warn(false));
        w.on_power(80.0, now);
        assert!(!w.warning_open());
        assert_eq!(w.poll(now + 120.0), None);
        assert_eq!(w.poll(now + 1800.0), warn(true));
    }

    #[test]
    fn zero_timeout_is_inert() {
        assert_eq!(AfkWatch::new(0.0, 600.0, 120.0, 0.0).poll(1e9), None);
        assert_eq!(AfkWatch::inert().poll(1e9), None);
    }
}
