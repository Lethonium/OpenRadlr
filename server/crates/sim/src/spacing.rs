//! Keeping riders apart in a lane.
//!
//! Positions are the middle of a bike, so two riders in one lane closer than
//! a bike length overlap. A rider closing in on the wheel ahead slows down to
//! sit on it (like adaptive cruise control: the closer, the nearer to the
//! leader's speed), and pulls out into a free neighbouring lane to pass when
//! it is strong enough to ride faster than the leader even out of its draft.
//! With every lane taken it waits, and after a few seconds slips through.
//! A start line-up puts the riders in rows instead of on one spot.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpacingParams {
    /// Closest a rider gets to the one ahead in its lane (middle to middle, m):
    /// a bike's length and a little.
    pub min_gap: f64,
    /// Seconds to close the remaining gap down to `min_gap`.
    pub close_s: f64,
    /// Closer than `min_gap`, a rider drops back at most this much slower
    /// than the leader (m/s): room opens gently, and a rider just ridden
    /// through by a faster one is hardly slowed.
    pub drop_back: f64,
    /// Hardest the spacing ever brakes (m/s²), like easing off the pedals:
    /// no jolt when a rider suddenly finds a wheel close ahead.
    pub max_brake: f64,
    /// A rider ahead closer than this (m) makes a stronger rider pull out to pass.
    pub pass_look: f64,
    /// Pull out when, at the leader's speed and in clear air, the rider would
    /// speed up by this much more (m/s²) than the leader actually does. At
    /// equal power that is zero, also while a group speeds up together;
    /// 0.01 m/s² is about 8 W of surplus at 30 km/h.
    pub pass_accel: f64,
    /// That surplus is averaged over about this long (s), so a surge or a
    /// trainer's jittery power doesn't take a rider out of the draft.
    pub pass_smooth_s: f64,
    /// Held behind with no free lane for this long (s), a rider that wants
    /// past slips through: a gap the lanes can't show, and no wall of riders
    /// across the road holds a stronger rider back for good.
    pub squeeze_after_s: f64,
    /// Distance between the rows of a start line-up (m).
    pub grid_row: f64,
}

impl Default for SpacingParams {
    fn default() -> Self {
        Self {
            min_gap: 2.0,
            close_s: 0.5,
            drop_back: 0.5,
            max_brake: 2.0,
            pass_look: 8.0,
            pass_accel: 0.01,
            pass_smooth_s: 5.0,
            squeeze_after_s: 3.0,
            grid_row: 2.5,
        }
    }
}

impl SpacingParams {
    /// Fastest a rider may ride `gap` metres behind a rider going `ahead_speed`.
    pub fn speed_limit(&self, gap: f64, ahead_speed: f64) -> f64 {
        let closing = (gap - self.min_gap) / self.close_s.max(1e-6);
        (ahead_speed + closing.max(-self.drop_back)).max(0.0)
    }

    /// Speed after holding a rider going `speed` (from `before`, one tick of
    /// `dt` ago) to `limit`, braking no harder than `max_brake`.
    pub fn hold(&self, speed: f64, before: f64, limit: f64, dt: f64) -> f64 {
        speed.min(limit.max(before - self.max_brake * dt))
    }

    /// Lane and metres behind the start line of the `index`-th rider of a
    /// line-up: rows of `lanes` riders, the first row on the line.
    pub fn grid_slot(&self, index: usize, lanes: u8) -> (u8, f64) {
        let lanes = usize::from(lanes.max(1));
        ((index % lanes) as u8, (index / lanes) as f64 * self.grid_row)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rider_far_behind_is_not_held_back() {
        let p = SpacingParams::default();
        assert!(p.speed_limit(30.0, 8.0) > 50.0);
    }

    #[test]
    fn at_the_closest_gap_a_rider_rides_at_the_leaders_speed() {
        let p = SpacingParams::default();
        assert!((p.speed_limit(p.min_gap, 8.0) - 8.0).abs() < 1e-9);
    }

    #[test]
    fn closer_than_the_closest_gap_a_rider_drops_back() {
        let p = SpacingParams::default();
        assert!(p.speed_limit(1.5, 8.0) < 8.0);
        assert_eq!(p.speed_limit(0.0, 0.5), 0.0);
    }

    #[test]
    fn far_too_close_a_rider_drops_back_only_a_little_slower_than_the_leader() {
        let p = SpacingParams::default();
        assert!((p.speed_limit(0.2, 8.0) - (8.0 - p.drop_back)).abs() < 1e-9);
    }

    #[test]
    fn holding_back_never_brakes_harder_than_easing_off() {
        let p = SpacingParams::default();
        assert!((p.hold(9.0, 9.0, 5.0, 0.05) - (9.0 - p.max_brake * 0.05)).abs() < 1e-9);
        assert!((p.hold(9.0, 9.0, 8.99, 0.05) - 8.99).abs() < 1e-9);
        assert!(
            (p.hold(7.0, 9.0, 8.0, 0.05) - 7.0).abs() < 1e-9,
            "a climb slows it more anyway"
        );
    }

    #[test]
    fn a_line_up_fills_rows_across_the_lanes() {
        let p = SpacingParams::default();
        let slots: Vec<(u8, f64)> = (0..6).map(|i| p.grid_slot(i, 4)).collect();
        assert_eq!(slots, vec![(0, 0.0), (1, 0.0), (2, 0.0), (3, 0.0), (0, 2.5), (1, 2.5)]);
    }
}
