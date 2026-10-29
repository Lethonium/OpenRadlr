//! Bots: server-side riders that feed generated power into the same physics
//! as humans. They make the world feel alive and are always flagged as bots.

use crate::rng::RandomSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RidingStyle {
    Steady,
    Climber,
    Sprinter,
}

/// Fitness profile of a bot.
#[derive(Debug, Clone, PartialEq)]
pub struct BotProfile {
    /// Sustainable power per kg (functional threshold power).
    pub ftp_wkg: f64,
    pub weight_kg: f64,
    pub style: RidingStyle,
    /// Relative standard deviation of the power noise, e.g. `0.05`.
    pub variance: f64,
}

impl BotProfile {
    pub fn ftp_watts(&self) -> f64 {
        self.ftp_wkg * self.weight_kg
    }

    /// Share of matched bots that ride near a human's level (the rest are field bots).
    const PACK_SHARE: f64 = 0.70;

    /// Draws a profile to ride with humans of the given levels: mostly
    /// pack bots at 0.95-1.10 x one human's level, the rest field bots
    /// spanning at least 2.0..4.5 W/kg, widened to the humans' extremes.
    /// Without levels this is [`BotProfile::random`].
    pub fn matched(levels_wkg: &[f64], rng: &mut dyn RandomSource) -> Self {
        if levels_wkg.is_empty() {
            return Self::random(rng);
        }
        let mut profile = Self::random(rng);
        profile.ftp_wkg = if rng.next_f64() < Self::PACK_SHARE {
            levels_wkg[rng.index(levels_wkg.len())] * rng.range_f64(0.95, 1.10)
        } else {
            let slowest = levels_wkg.iter().copied().fold(f64::INFINITY, f64::min);
            let fastest = levels_wkg.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            rng.range_f64(slowest.min(2.0), fastest.max(4.5))
        };
        profile
    }

    /// Draws a plausible amateur profile.
    pub fn random(rng: &mut dyn RandomSource) -> Self {
        let style = match rng.index(3) {
            0 => RidingStyle::Steady,
            1 => RidingStyle::Climber,
            _ => RidingStyle::Sprinter,
        };
        Self {
            ftp_wkg: rng.range_f64(2.0, 4.5),
            weight_kg: rng.range_f64(55.0, 95.0),
            style,
            variance: rng.range_f64(0.03, 0.10),
        }
    }
}

/// Riding level assumed for a human who gave neither a level nor an FTP.
pub const DEFAULT_LEVEL_WKG: f64 = 2.8;

/// A human's riding level in W/kg: the first positive of `level_w` and
/// `ftp_w`, else [`DEFAULT_LEVEL_WKG`] × weight; divided by the weight and
/// clamped to 1.0..=7.0.
pub fn human_level_wkg(level_w: Option<f64>, ftp_w: Option<f64>, weight_kg: f64) -> f64 {
    let positive = |w: Option<f64>| w.filter(|w| w.is_finite() && *w > 0.0);
    let watts = positive(level_w)
        .or(positive(ftp_w))
        .unwrap_or(DEFAULT_LEVEL_WKG * weight_kg);
    (watts / weight_kg).clamp(1.0, 7.0)
}

/// At most 8 levels pass unchanged; more are sorted into 8 equal-count
/// bands, each represented by its median.
pub fn pack_levels(levels_wkg: &[f64]) -> Vec<f64> {
    const BANDS: usize = 8;
    if levels_wkg.len() <= BANDS {
        return levels_wkg.to_vec();
    }
    let mut sorted = levels_wkg.to_vec();
    sorted.sort_by(f64::total_cmp);
    let n = sorted.len();
    (0..BANDS)
        .map(|band| {
            let band_slice = &sorted[band * n / BANDS..(band + 1) * n / BANDS];
            let mid = band_slice.len() / 2;
            if band_slice.len().is_multiple_of(2) {
                (band_slice[mid - 1] + band_slice[mid]) / 2.0
            } else {
                band_slice[mid]
            }
        })
        .collect()
}

/// What a bot knows about its situation when choosing its power.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BotSituation {
    pub grade_percent: f64,
    pub racing: bool,
    /// Riding in a group ride (a steady pace).
    pub group_ride: bool,
    /// Remaining race distance in metres, `None` outside a race.
    pub distance_to_finish: Option<f64>,
}

/// Gap to the nearest rider ahead in each lane, as seen by one bot.
#[derive(Debug, Clone, PartialEq)]
pub struct LaneView {
    pub current_lane: u8,
    /// Index = lane. `None` if nobody is ahead in that lane within view.
    pub gap_ahead: Vec<Option<f64>>,
}

/// Behaviour tuning for bots.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BotTuning {
    /// Time constant of the power noise in seconds.
    pub noise_time_constant_s: f64,
    /// Gap window in which a bot considers itself in a good draft.
    pub draft_window: (f64, f64),
    /// Gap window in a neighbouring lane that makes a bot switch lanes.
    pub join_window: (f64, f64),
    pub lane_change_cooldown_s: f64,
}

impl Default for BotTuning {
    fn default() -> Self {
        Self {
            noise_time_constant_s: 8.0,
            draft_window: (2.0, 6.5),
            join_window: (2.5, 15.0),
            lane_change_cooldown_s: 5.0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct BotBrain {
    profile: BotProfile,
    tuning: BotTuning,
    noise: f64,
    lane_cooldown_s: f64,
}

impl BotBrain {
    pub fn new(profile: BotProfile, tuning: BotTuning) -> Self {
        Self {
            profile,
            tuning,
            noise: 0.0,
            lane_cooldown_s: 0.0,
        }
    }

    pub fn profile(&self) -> &BotProfile {
        &self.profile
    }

    /// Fraction of FTP the bot aims for in the given situation (no noise).
    pub fn target_intensity(&self, situation: &BotSituation) -> f64 {
        let style = self.profile.style;
        let grade = situation.grade_percent;

        if grade < -2.0 {
            return 0.35;
        }

        let mut intensity: f64 = if situation.racing {
            0.95
        } else if situation.group_ride {
            0.75
        } else {
            match style {
                RidingStyle::Steady => 0.70,
                RidingStyle::Climber => 0.68,
                RidingStyle::Sprinter => 0.70,
            }
        };

        if grade > 2.0 {
            intensity += match style {
                RidingStyle::Climber => 0.20,
                _ => 0.10,
            };
        }

        if let Some(remaining) = situation.distance_to_finish {
            if remaining <= 1000.0 {
                intensity = match style {
                    RidingStyle::Sprinter if remaining <= 300.0 => 1.6,
                    RidingStyle::Sprinter => 1.0,
                    _ => intensity.max(1.05),
                };
            }
        }

        intensity.clamp(0.3, 1.8)
    }

    /// Power in watts for the next `dt` seconds. The noise is a slowly
    /// drifting (AR(1)) process so bots do not ride like clockwork.
    pub fn power(&mut self, situation: &BotSituation, rng: &mut dyn RandomSource, dt: f64) -> f64 {
        let decay = (-dt / self.tuning.noise_time_constant_s).exp();
        self.noise = self.noise * decay + (1.0 - decay * decay).sqrt() * rng.standard_normal();
        let factor = 1.0 + self.profile.variance * self.noise;
        (self.profile.ftp_watts() * self.target_intensity(situation) * factor).max(0.0)
    }

    /// Decides whether to move into a neighbouring lane to catch a draft.
    /// Keeps the lane just picked for a while (after pulling out to pass).
    pub fn hold_lane(&mut self) {
        self.lane_cooldown_s = self.tuning.lane_change_cooldown_s;
    }

    pub fn choose_lane(&mut self, view: &LaneView, dt: f64) -> Option<u8> {
        self.lane_cooldown_s = (self.lane_cooldown_s - dt).max(0.0);
        if self.lane_cooldown_s > 0.0 {
            return None;
        }

        let in_window = |gap: Option<f64>, (lo, hi): (f64, f64)| gap.is_some_and(|g| (lo..=hi).contains(&g));
        let current = view.current_lane as usize;
        if in_window(view.gap_ahead.get(current).copied().flatten(), self.tuning.draft_window) {
            return None;
        }

        let neighbours = [current.checked_sub(1), Some(current + 1)];
        let best = neighbours
            .into_iter()
            .flatten()
            .filter(|&lane| lane < view.gap_ahead.len())
            .filter_map(|lane| view.gap_ahead[lane].map(|gap| (lane, gap)))
            .filter(|&(_, gap)| in_window(Some(gap), self.tuning.join_window))
            .min_by(|a, b| a.1.total_cmp(&b.1));

        best.map(|(lane, _)| {
            self.lane_cooldown_s = self.tuning.lane_change_cooldown_s;
            lane as u8
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::SplitMix64;

    fn brain(style: RidingStyle) -> BotBrain {
        BotBrain::new(
            BotProfile {
                ftp_wkg: 3.0,
                weight_kg: 70.0,
                style,
                variance: 0.05,
            },
            BotTuning::default(),
        )
    }

    const FREE_RIDE_FLAT: BotSituation = BotSituation {
        grade_percent: 0.0,
        racing: false,
        group_ride: false,
        distance_to_finish: None,
    };

    #[test]
    fn random_profiles_stay_in_documented_ranges() {
        let mut rng = SplitMix64::new(9);
        for _ in 0..1000 {
            let p = BotProfile::random(&mut rng);
            assert!((2.0..4.5).contains(&p.ftp_wkg));
            assert!((55.0..95.0).contains(&p.weight_kg));
            assert!((0.03..0.10).contains(&p.variance));
        }
    }

    #[test]
    fn free_ride_is_endurance_pace() {
        let i = brain(RidingStyle::Steady).target_intensity(&FREE_RIDE_FLAT);
        assert!((0.65..=0.75).contains(&i));
    }

    #[test]
    fn climbers_push_harder_uphill_than_others() {
        let uphill = BotSituation {
            grade_percent: 6.0,
            ..FREE_RIDE_FLAT
        };
        let climber = brain(RidingStyle::Climber).target_intensity(&uphill);
        let steady = brain(RidingStyle::Steady).target_intensity(&uphill);
        assert!(climber > steady);
        assert!(steady > brain(RidingStyle::Steady).target_intensity(&FREE_RIDE_FLAT));
    }

    #[test]
    fn everyone_soft_pedals_downhill() {
        let downhill = BotSituation {
            grade_percent: -5.0,
            ..FREE_RIDE_FLAT
        };
        assert_eq!(brain(RidingStyle::Climber).target_intensity(&downhill), 0.35);
    }

    #[test]
    fn races_are_harder_and_sprinters_kick_at_the_end() {
        let race = BotSituation {
            grade_percent: 0.0,
            racing: true,
            group_ride: false,
            distance_to_finish: Some(5000.0),
        };
        let sprint = BotSituation {
            distance_to_finish: Some(200.0),
            ..race
        };
        let sprinter = brain(RidingStyle::Sprinter);
        assert!(sprinter.target_intensity(&race) > sprinter.target_intensity(&FREE_RIDE_FLAT));
        assert!(sprinter.target_intensity(&sprint) >= 1.5);
    }

    #[test]
    fn power_varies_around_the_target() {
        let mut bot = brain(RidingStyle::Steady);
        let mut rng = SplitMix64::new(4);
        let samples: Vec<f64> = (0..2000).map(|_| bot.power(&FREE_RIDE_FLAT, &mut rng, 0.05)).collect();
        let mean = samples.iter().sum::<f64>() / samples.len() as f64;
        let target = 210.0 * 0.70;
        assert!((mean - target).abs() < target * 0.1, "mean {mean}");
        let min = samples.iter().cloned().fold(f64::MAX, f64::min);
        let max = samples.iter().cloned().fold(f64::MIN, f64::max);
        assert!(max > min, "power should not be constant");
    }

    #[test]
    fn bot_stays_in_a_good_draft() {
        let mut bot = brain(RidingStyle::Steady);
        let view = LaneView {
            current_lane: 1,
            gap_ahead: vec![Some(3.0), Some(2.0), None, None],
        };
        assert_eq!(bot.choose_lane(&view, 0.05), None);
    }

    #[test]
    fn bot_moves_over_to_catch_a_wheel_and_then_waits() {
        let mut bot = brain(RidingStyle::Steady);
        let view = LaneView {
            current_lane: 1,
            gap_ahead: vec![None, None, Some(8.0), None],
        };
        assert_eq!(bot.choose_lane(&view, 0.05), Some(2));
        assert_eq!(bot.choose_lane(&view, 0.05), None, "cooldown should prevent jitter");
    }

    #[test]
    fn bot_ignores_far_away_riders() {
        let mut bot = brain(RidingStyle::Steady);
        let view = LaneView {
            current_lane: 0,
            gap_ahead: vec![None, Some(80.0)],
        };
        assert_eq!(bot.choose_lane(&view, 0.05), None);
    }

    #[test]
    fn human_level_prefers_level_then_ftp_then_default() {
        assert_eq!(human_level_wkg(Some(280.0), Some(250.0), 70.0), 4.0);
        assert_eq!(human_level_wkg(None, Some(210.0), 70.0), 3.0);
        assert_eq!(human_level_wkg(None, None, 70.0), 2.8);
        assert_eq!(human_level_wkg(Some(0.0), None, 70.0), 2.8);
    }

    #[test]
    fn pack_levels_bands_above_eight() {
        let eight: Vec<f64> = (1..=8).map(f64::from).collect();
        assert_eq!(pack_levels(&eight), eight);
        let sixteen: Vec<f64> = (1..=16).map(f64::from).collect();
        let expected: Vec<f64> = (0..8).map(|i| 1.5 + 2.0 * f64::from(i)).collect();
        assert_eq!(pack_levels(&sixteen), expected);
    }

    #[test]
    fn matched_mixes_pack_and_field() {
        let mut rng = SplitMix64::new(7);
        let draws: Vec<f64> = (0..2000)
            .map(|_| BotProfile::matched(&[2.5], &mut rng).ftp_wkg)
            .collect();
        let pack = draws.iter().filter(|w| (2.375..=2.75).contains(*w)).count() as f64 / 2000.0;
        assert!((0.68..=0.80).contains(&pack), "pack share {pack}");
        assert!(draws.iter().all(|w| (2.0..=4.5).contains(w)));
    }

    #[test]
    fn matched_field_widens_to_the_humans() {
        let mut rng = SplitMix64::new(7);
        let draws: Vec<f64> = (0..2000)
            .map(|_| BotProfile::matched(&[5.5], &mut rng).ftp_wkg)
            .collect();
        assert!(draws.iter().all(|w| *w <= 6.05));
        assert!(draws.iter().cloned().fold(f64::MIN, f64::max) > 4.5);
    }

    #[test]
    fn group_ride_intensity() {
        let group = BotSituation {
            group_ride: true,
            ..FREE_RIDE_FLAT
        };
        assert_eq!(brain(RidingStyle::Steady).target_intensity(&group), 0.75);
        let racing = BotSituation { racing: true, ..group };
        assert_eq!(brain(RidingStyle::Steady).target_intensity(&racing), 0.95);
    }
}
