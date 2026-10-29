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
    /// A rider ahead closer than this (m) makes a stronger rider pull out to pass.
    pub pass_look: f64,
    /// Pull out when the rider would still speed up by this much (m/s²) at the
    /// leader's speed in clear air: at equal power it would not speed up at all.
    pub pass_accel: f64,
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
            pass_look: 8.0,
            pass_accel: 0.03,
            squeeze_after_s: 3.0,
            grid_row: 2.5,
        }
    }
}

impl SpacingParams {
    /// Fastest a rider may ride `gap` metres behind a rider going `ahead_speed`.
    pub fn speed_limit(&self, gap: f64, ahead_speed: f64) -> f64 {
        (ahead_speed + (gap - self.min_gap) / self.close_s.max(1e-6)).max(0.0)
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
    fn a_line_up_fills_rows_across_the_lanes() {
        let p = SpacingParams::default();
        let slots: Vec<(u8, f64)> = (0..6).map(|i| p.grid_slot(i, 4)).collect();
        assert_eq!(slots, vec![(0, 0.0), (1, 0.0), (2, 0.0), (3, 0.0), (0, 2.5), (1, 2.5)]);
    }
}
