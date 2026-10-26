//! Drafting (riding in someone's slipstream).
//!
//! A rider who is between `min_gap` and `max_gap` metres behind another rider
//! in the same lane gets a reduced drag area. The reduction is largest close
//! behind the leader and fades linearly to zero at `max_gap`.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DraftParams {
    pub min_gap: f64,
    pub max_gap: f64,
    /// Maximum relative CdA reduction, e.g. `0.3` for 30 %.
    pub max_reduction: f64,
    /// Riders whose lane positions differ by less than this share a lane.
    pub lane_tolerance: f64,
}

impl Default for DraftParams {
    fn default() -> Self {
        Self {
            min_gap: 0.5,
            max_gap: 5.0,
            max_reduction: 0.3,
            lane_tolerance: 0.5,
        }
    }
}

impl DraftParams {
    /// CdA multiplier for a rider `gap` metres behind the next rider ahead.
    pub fn cda_factor(&self, gap: f64) -> f64 {
        if !(self.min_gap..=self.max_gap).contains(&gap) {
            return 1.0;
        }
        let t = (gap - self.min_gap) / (self.max_gap - self.min_gap);
        1.0 - self.max_reduction * (1.0 - t)
    }

    pub fn same_lane(&self, lane_a: f64, lane_b: f64) -> bool {
        (lane_a - lane_b).abs() < self.lane_tolerance
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_reduction_right_behind_the_leader() {
        let p = DraftParams::default();
        assert!((p.cda_factor(0.5) - 0.7).abs() < 1e-9);
    }

    #[test]
    fn reduction_fades_out_linearly() {
        let p = DraftParams::default();
        assert!((p.cda_factor(2.75) - 0.85).abs() < 1e-9);
        assert!((p.cda_factor(5.0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn no_draft_outside_the_window() {
        let p = DraftParams::default();
        assert_eq!(p.cda_factor(0.2), 1.0);
        assert_eq!(p.cda_factor(5.1), 1.0);
        assert_eq!(p.cda_factor(100.0), 1.0);
    }

    #[test]
    fn lanes_match_within_tolerance() {
        let p = DraftParams::default();
        assert!(p.same_lane(1.0, 1.3));
        assert!(!p.same_lane(1.0, 1.6));
    }
}
