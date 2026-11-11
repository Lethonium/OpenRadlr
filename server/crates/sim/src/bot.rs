//! Bots: server-side riders that feed generated power into the same physics
//! as humans. They make the world feel alive and are always flagged as bots.
//!
//! Each bot is a character of the cast (see `names`): its name fixes its
//! riding type and team. It rides with a W′ energy budget (the critical power
//! model) and makes moves — pulling on the front, attacking near a climb's
//! top, answering a rider who passes, sprinting for a line — that end when the
//! time is up or the tank runs low. See docs/superpowers/specs/2026-11-10-bots-design.md.

use crate::names::name_hash;
use crate::rng::RandomSource;

/// A bot's riding type (archetype). Fixed by its name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RidingStyle {
    /// Steady; takes turns on the front of a group.
    Rouleur,
    /// Light; attacks near the top of a climb.
    Climber,
    /// Heavy; sits in and goes for sprint lines and finishes.
    Sprinter,
    /// Attacks riders near it and answers riders who pass.
    Attacker,
    /// Easy company; never races anybody.
    Tourer,
}

impl RidingStyle {
    pub const ALL: [RidingStyle; 5] = [
        Self::Rouleur,
        Self::Climber,
        Self::Sprinter,
        Self::Attacker,
        Self::Tourer,
    ];

    /// The riding type of the cast member `name`: rouleurs 30%, climbers and
    /// sprinters 20% each, attackers and tourers 15% each.
    pub fn of_name(name: &str) -> Self {
        match name_hash(name) % 100 {
            0..30 => Self::Rouleur,
            30..50 => Self::Climber,
            50..70 => Self::Sprinter,
            70..85 => Self::Attacker,
            _ => Self::Tourer,
        }
    }

    /// Its id on the wire.
    pub fn id(self) -> &'static str {
        match self {
            Self::Rouleur => "rouleur",
            Self::Climber => "climber",
            Self::Sprinter => "sprinter",
            Self::Attacker => "attacker",
            Self::Tourer => "tourer",
        }
    }

    fn weight_kg(self) -> (f64, f64) {
        match self {
            Self::Rouleur => (68.0, 82.0),
            Self::Climber => (52.0, 64.0),
            Self::Sprinter => (72.0, 88.0),
            Self::Attacker => (60.0, 74.0),
            Self::Tourer => (60.0, 95.0),
        }
    }

    /// W′: the work above critical power the bot can do on a full tank.
    fn w_prime_j(self) -> f64 {
        match self {
            Self::Rouleur => 15_000.0,
            Self::Climber => 14_000.0,
            Self::Sprinter => 22_000.0,
            Self::Attacker => 18_000.0,
            Self::Tourer => 10_000.0,
        }
    }

    /// Share of FTP on the flat when free riding, and what it adds uphill.
    fn pace(self) -> (f64, f64) {
        match self {
            Self::Rouleur => (0.72, 0.10),
            Self::Climber => (0.66, 0.22),
            Self::Sprinter => (0.68, 0.06),
            Self::Attacker => (0.70, 0.12),
            Self::Tourer => (0.58, 0.06),
        }
    }
}

/// A bot's team: its kit colour on the clients. Fixed by its name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Team {
    Zitrone,
    Moos,
    Kirsche,
    Lavendel,
    Kreide,
    Schiefer,
    Petrol,
    Rose,
}

impl Team {
    pub const ALL: [Team; 8] = [
        Self::Zitrone,
        Self::Moos,
        Self::Kirsche,
        Self::Lavendel,
        Self::Kreide,
        Self::Schiefer,
        Self::Petrol,
        Self::Rose,
    ];

    /// The team of the cast member `name` (Goldie Lemon rides in lemon yellow).
    pub fn of_name(name: &str) -> Self {
        if name == crate::names::LEMON_NAME {
            return Self::Zitrone;
        }
        Self::ALL[((name_hash(name) >> 32) % Self::ALL.len() as u64) as usize]
    }

    /// Its id on the wire.
    pub fn id(self) -> &'static str {
        match self {
            Self::Zitrone => "zitrone",
            Self::Moos => "moos",
            Self::Kirsche => "kirsche",
            Self::Lavendel => "lavendel",
            Self::Kreide => "kreide",
            Self::Schiefer => "schiefer",
            Self::Petrol => "petrol",
            Self::Rose => "rose",
        }
    }
}

/// Fitness profile of a bot.
#[derive(Debug, Clone, PartialEq)]
pub struct BotProfile {
    /// Sustainable power per kg (functional threshold power, used as critical power).
    pub ftp_wkg: f64,
    pub weight_kg: f64,
    pub style: RidingStyle,
    pub team: Team,
    /// Relative standard deviation of the power noise, e.g. `0.05`.
    pub variance: f64,
}

impl BotProfile {
    pub fn ftp_watts(&self) -> f64 {
        self.ftp_wkg * self.weight_kg
    }

    /// Share of matched bots that ride near a human's level (the rest are field bots).
    const PACK_SHARE: f64 = 0.70;

    /// The profile of cast member `name` to ride with humans of the given
    /// levels: mostly pack bots at 0.95-1.10 x one human's level, the rest
    /// field bots spanning at least 2.0..4.5 W/kg, widened to the humans'
    /// extremes. Without levels this is [`BotProfile::character`].
    pub fn matched(name: &str, levels_wkg: &[f64], rng: &mut dyn RandomSource) -> Self {
        let mut profile = Self::character(name, rng);
        if levels_wkg.is_empty() {
            return profile;
        }
        profile.ftp_wkg = if rng.next_f64() < Self::PACK_SHARE {
            levels_wkg[rng.index(levels_wkg.len())] * rng.range_f64(0.95, 1.10)
        } else {
            let slowest = levels_wkg.iter().copied().fold(f64::INFINITY, f64::min);
            let fastest = levels_wkg.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            rng.range_f64(slowest.min(2.0), fastest.max(4.5))
        };
        profile
    }

    /// The profile of cast member `name` at a plausible amateur level: its
    /// type and team from the name, a weight that suits the type.
    pub fn character(name: &str, rng: &mut dyn RandomSource) -> Self {
        let style = RidingStyle::of_name(name);
        let (light, heavy) = style.weight_kg();
        Self {
            ftp_wkg: rng.range_f64(2.0, 4.5),
            weight_kg: rng.range_f64(light, heavy),
            style,
            team: Team::of_name(name),
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

/// W′ balance (Skiba): riding above critical power spends it, riding below
/// recovers the deficit exponentially, faster the further below.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Energy {
    capacity_j: f64,
    deficit_j: f64,
}

impl Energy {
    pub fn full(capacity_j: f64) -> Self {
        Self {
            capacity_j,
            deficit_j: 0.0,
        }
    }

    /// Accounts `dt` seconds at `power` watts against critical power `cp`.
    pub fn ride(&mut self, power: f64, cp: f64, dt: f64) {
        if power > cp {
            self.deficit_j = (self.deficit_j + (power - cp) * dt).min(self.capacity_j);
        } else {
            let tau = 546.0 * (-0.01 * (cp - power)).exp() + 316.0;
            self.deficit_j *= (-dt / tau).exp();
        }
    }

    /// What is left of W′, from 0 (empty) to 1 (full).
    pub fn fraction(&self) -> f64 {
        1.0 - self.deficit_j / self.capacity_j
    }
}

/// A line a bot can ride for: the end of a sprint, or a climb's top.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Sprint,
    Summit,
}

/// The next line ahead on the bot's route.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LineAhead {
    pub kind: LineKind,
    /// Which marker of the route, so each line is contested once per pass.
    pub index: usize,
    pub distance_m: f64,
}

/// A rider coming past: just ahead (within a few metres) and faster.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Passer {
    pub human: bool,
    /// How much faster than the bot, in m/s.
    pub speed_gain: f64,
    pub lane: u8,
}

/// What a bot knows about its situation when choosing its power.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct BotSituation {
    pub grade_percent: f64,
    pub racing: bool,
    /// Riding in a group ride (a steady pace).
    pub group_ride: bool,
    /// Remaining race distance in metres, `None` outside a race.
    pub distance_to_finish: Option<f64>,
    /// May make moves: on its route, not seated in a vehicle.
    pub free: bool,
    pub line_ahead: Option<LineAhead>,
    pub passer: Option<Passer>,
    /// A rider sits on this bot's wheel (in its lane, a few metres behind).
    pub wheel_behind: bool,
    /// Gap to the rider ahead in this bot's lane, `None` if the road is clear.
    pub gap_ahead_m: Option<f64>,
    /// Distance to the nearest human along the route, either way.
    pub human_m: Option<f64>,
    /// Ahead of the rest of its group: eases off for them.
    pub waiting_for_group: bool,
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

/// What a bot is doing now.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Move {
    Ride,
    /// On the front of a group, pulling the others along.
    Pull,
    /// Moved aside after a pull, letting the group come past.
    SwingOff,
    /// An attack at `intensity` × FTP.
    Attack {
        intensity: f64,
    },
    /// Chasing a rider who just came past.
    Answer,
    /// Going for a line at `intensity` × FTP.
    Sprint {
        intensity: f64,
    },
    /// Easing off after an effort.
    Recover,
}

impl Move {
    /// The move's id on the wire; `None` while riding, swinging off or recovering.
    pub fn id(self) -> Option<&'static str> {
        match self {
            Move::Pull => Some("pull"),
            Move::Attack { .. } => Some("attack"),
            Move::Answer => Some("answer"),
            Move::Sprint { .. } => Some("sprint"),
            Move::Ride | Move::SwingOff | Move::Recover => None,
        }
    }
}

/// When moves start and end.
mod tactics {
    /// A move starts only with more of W′ left than this…
    pub const MIN_ENERGY: f64 = 0.40;
    /// …and an answer with more than this.
    pub const MIN_ENERGY_ANSWER: f64 = 0.50;
    /// Attacks and answers only happen with a human this close (or in a race).
    pub const HUMAN_NEAR_M: f64 = 80.0;
    /// A sprint only starts with a human this close (or in a race).
    pub const SPRINT_AUDIENCE_M: f64 = 150.0;
    /// A rider at least this much faster, just ahead, is coming past.
    pub const PASS_GAIN_MPS: f64 = 0.8;
    /// Seconds a wheel has to sit behind before a pull.
    pub const WHEEL_BEFORE_PULL_S: f64 = 10.0;
    /// Pulls start only with the road ahead clear for this long.
    pub const CLEAR_TO_PULL_M: f64 = 15.0;
    /// An answer ends on the passer's wheel.
    pub const ON_THE_WHEEL_M: f64 = 5.0;
    /// Attacks, answers and sprints look for a lane clear for this long.
    pub const CLEAR_LANE_M: f64 = 10.0;
    /// Once rolled, the next pass is ignored for this long.
    pub const ANSWER_COOLDOWN_S: f64 = 20.0;
    /// An attacker near a human attacks on average once in this many seconds.
    pub const ATTACK_EVERY_S: f64 = 240.0;
    /// A line already contested is forgotten once it is this far ahead again.
    pub const FORGET_LINE_M: f64 = 1500.0;
    pub const RIDE_WAITING: f64 = 0.55;
    pub const PULL: f64 = 0.85;
    pub const SWING_OFF: f64 = 0.60;
    pub const ANSWER: f64 = 1.25;
    pub const RECOVER: f64 = 0.55;
    pub const SWING_OFF_S: f64 = 20.0;
    pub const ANSWER_S: f64 = 25.0;
}

/// A lane the bot wants to be in, decided by a move.
#[derive(Debug, Clone, Copy, PartialEq)]
enum LaneWish {
    /// One lane over, the left one first.
    Aside,
    Lane(u8),
}

#[derive(Debug, Clone)]
pub struct BotBrain {
    profile: BotProfile,
    tuning: BotTuning,
    noise: f64,
    lane_cooldown_s: f64,
    energy: Energy,
    current: Move,
    /// Seconds left of the current move.
    left_s: f64,
    /// Seconds a wheel has sat behind with the road ahead clear.
    wheel_s: f64,
    answer_cooldown_s: f64,
    /// The line last contested (or let go), so each is ridden for once per pass.
    contested: Option<usize>,
    lane_wish: Option<LaneWish>,
    /// The group it was spawned with, while it still rides with them.
    group: Option<u32>,
}

impl BotBrain {
    pub fn new(profile: BotProfile, tuning: BotTuning) -> Self {
        let energy = Energy::full(profile.style.w_prime_j());
        Self {
            profile,
            tuning,
            noise: 0.0,
            lane_cooldown_s: 0.0,
            energy,
            current: Move::Ride,
            left_s: 0.0,
            wheel_s: 0.0,
            answer_cooldown_s: 0.0,
            contested: None,
            lane_wish: None,
            group: None,
        }
    }

    /// The same bot, riding with group `group`.
    pub fn in_group(mut self, group: Option<u32>) -> Self {
        self.group = group;
        self
    }

    pub fn group(&self) -> Option<u32> {
        self.group
    }

    /// Rides on alone: too far from the rest of its group.
    pub fn leave_group(&mut self) {
        self.group = None;
    }

    pub fn profile(&self) -> &BotProfile {
        &self.profile
    }

    /// What the bot is doing now.
    pub fn current_move(&self) -> Move {
        self.current
    }

    /// What is left of its W′, from 0 to 1.
    pub fn energy(&self) -> f64 {
        self.energy.fraction()
    }

    /// Fraction of FTP the bot aims for while riding (no move, no noise).
    pub fn target_intensity(&self, situation: &BotSituation) -> f64 {
        let style = self.profile.style;
        let grade = situation.grade_percent;

        if grade < -2.0 {
            return 0.35;
        }

        let (flat, uphill) = style.pace();
        let mut intensity: f64 = if situation.racing {
            0.95
        } else if situation.group_ride {
            0.75
        } else {
            flat
        };

        if grade > 2.0 {
            intensity += uphill;
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

    /// Fraction of FTP for the current move in `situation`.
    fn intensity(&self, situation: &BotSituation) -> f64 {
        let riding = self.target_intensity(situation);
        if situation.distance_to_finish.is_some_and(|d| d <= 1000.0) {
            // The race finale rides by its own rules.
            return riding;
        }
        match self.current {
            Move::Ride if situation.waiting_for_group => riding.min(tactics::RIDE_WAITING),
            Move::Ride => riding,
            Move::Pull => riding.max(tactics::PULL),
            Move::SwingOff => tactics::SWING_OFF,
            Move::Attack { intensity } | Move::Sprint { intensity } => intensity,
            Move::Answer => tactics::ANSWER,
            Move::Recover => riding.min(tactics::RECOVER),
        }
    }

    /// Power in watts for the next `dt` seconds. The noise is a slowly
    /// drifting (AR(1)) process so bots do not ride like clockwork.
    pub fn power(&mut self, situation: &BotSituation, rng: &mut dyn RandomSource, dt: f64) -> f64 {
        self.decide(situation, rng, dt);
        let decay = (-dt / self.tuning.noise_time_constant_s).exp();
        self.noise = self.noise * decay + (1.0 - decay * decay).sqrt() * rng.standard_normal();
        let factor = 1.0 + self.profile.variance * self.noise;
        let power = (self.profile.ftp_watts() * self.intensity(situation) * factor).max(0.0);
        self.energy.ride(power, self.profile.ftp_watts(), dt);
        power
    }

    fn start(&mut self, next: Move, seconds: f64) {
        self.current = next;
        self.left_s = seconds;
    }

    /// Starts and ends moves.
    fn decide(&mut self, s: &BotSituation, rng: &mut dyn RandomSource, dt: f64) {
        use tactics::*;
        self.left_s -= dt;
        self.answer_cooldown_s = (self.answer_cooldown_s - dt).max(0.0);
        let energy = self.energy.fraction();
        let style = self.profile.style;
        if self.contested.is_some_and(|i| {
            s.line_ahead
                .is_none_or(|l| l.index != i || l.distance_m > FORGET_LINE_M)
        }) {
            self.contested = None;
        }
        if !s.free || s.group_ride {
            self.current = Move::Ride;
            self.wheel_s = 0.0;
            return;
        }
        match self.current {
            Move::Ride => {}
            Move::Pull => {
                if s.gap_ahead_m.is_some_and(|g| g < CLEAR_TO_PULL_M) {
                    self.current = Move::Ride;
                } else if self.left_s <= 0.0 {
                    self.start(Move::SwingOff, SWING_OFF_S);
                    self.lane_wish = Some(LaneWish::Aside);
                }
                return;
            }
            Move::SwingOff => {
                if self.left_s <= 0.0 || s.passer.is_some() {
                    self.current = Move::Ride;
                }
                return;
            }
            Move::Attack { .. } => {
                if self.left_s <= 0.0 || energy < 0.15 {
                    self.start(Move::Recover, rng.range_f64(30.0, 60.0));
                }
                return;
            }
            Move::Answer => {
                if s.gap_ahead_m.is_some_and(|g| g <= ON_THE_WHEEL_M) {
                    self.current = Move::Ride;
                } else if self.left_s <= 0.0 || energy < 0.30 {
                    self.start(Move::Recover, rng.range_f64(30.0, 60.0));
                }
                return;
            }
            Move::Sprint { .. } => {
                if self.left_s <= 0.0 || energy <= 0.02 {
                    self.start(Move::Recover, rng.range_f64(30.0, 60.0));
                }
                return;
            }
            Move::Recover => {
                if self.left_s <= 0.0 || energy > 0.70 {
                    self.current = Move::Ride;
                }
                return;
            }
        }

        // Riding: is there a reason to start something?
        let clear_ahead = s.gap_ahead_m.is_none_or(|g| g > CLEAR_TO_PULL_M);
        self.wheel_s = if s.wheel_behind && clear_ahead {
            self.wheel_s + dt
        } else {
            0.0
        };
        if style == RidingStyle::Tourer {
            return;
        }
        let human_near = s.racing || s.human_m.is_some_and(|d| d <= HUMAN_NEAR_M);

        if let Some(line) = s.line_ahead.filter(|l| self.contested != Some(l.index)) {
            match line.kind {
                LineKind::Sprint => {
                    let reach = if style == RidingStyle::Sprinter { 250.0 } else { 200.0 };
                    let audience = s.racing || s.human_m.is_some_and(|d| d <= SPRINT_AUDIENCE_M);
                    if line.distance_m <= reach && audience {
                        self.contested = Some(line.index);
                        if energy > MIN_ENERGY {
                            let intensity = if style == RidingStyle::Sprinter { 1.9 } else { 1.5 };
                            self.start(Move::Sprint { intensity }, line.distance_m / 10.0 + 3.0);
                            return;
                        }
                    }
                }
                LineKind::Summit => {
                    let (reach, chance, intensity) = match style {
                        RidingStyle::Climber => (600.0, 0.8, 1.30),
                        RidingStyle::Attacker => (300.0, 0.5, 1.45),
                        RidingStyle::Rouleur => (200.0, 0.1, 1.30),
                        _ => (200.0, 0.05, 1.30),
                    };
                    if line.distance_m <= reach && human_near {
                        self.contested = Some(line.index);
                        if energy > MIN_ENERGY && rng.next_f64() < chance {
                            self.start(Move::Attack { intensity }, rng.range_f64(20.0, 45.0));
                            return;
                        }
                    }
                }
            }
        }

        if let Some(passer) = s
            .passer
            .filter(|p| p.speed_gain >= PASS_GAIN_MPS && (p.human || s.racing))
        {
            if self.answer_cooldown_s <= 0.0 && energy > MIN_ENERGY_ANSWER {
                self.answer_cooldown_s = ANSWER_COOLDOWN_S;
                let chance = match style {
                    RidingStyle::Attacker => 0.7,
                    RidingStyle::Climber if s.grade_percent > 2.0 => 0.6,
                    RidingStyle::Sprinter if s.grade_percent.abs() <= 2.0 => 0.3,
                    _ => 0.3,
                };
                if rng.next_f64() < chance {
                    self.start(Move::Answer, ANSWER_S);
                    self.lane_wish = Some(LaneWish::Lane(passer.lane));
                    return;
                }
            }
        }

        if style == RidingStyle::Attacker && human_near && energy > 0.6 && rng.next_f64() < dt / ATTACK_EVERY_S {
            self.start(Move::Attack { intensity: 1.5 }, rng.range_f64(20.0, 45.0));
            return;
        }

        if self.wheel_s >= WHEEL_BEFORE_PULL_S {
            self.wheel_s = 0.0;
            if style == RidingStyle::Rouleur || rng.next_f64() < 0.3 {
                self.start(Move::Pull, rng.range_f64(30.0, 60.0));
            }
        }
    }

    /// Keeps the lane just picked for a while (after pulling out to pass).
    pub fn hold_lane(&mut self) {
        self.lane_cooldown_s = self.tuning.lane_change_cooldown_s;
    }

    /// Decides whether to move into another lane: where a move wants to be,
    /// out of a blocked lane while attacking, or over to catch a draft.
    pub fn choose_lane(&mut self, view: &LaneView, dt: f64) -> Option<u8> {
        self.lane_cooldown_s = (self.lane_cooldown_s - dt).max(0.0);
        let lanes = view.gap_ahead.len();
        let current = view.current_lane as usize;
        if let Some(wish) = self.lane_wish.take() {
            let lane = match wish {
                LaneWish::Aside if current > 0 => current - 1,
                LaneWish::Aside => current + 1,
                LaneWish::Lane(lane) => usize::from(lane),
            };
            if lane < lanes && lane != current {
                self.lane_cooldown_s = self.tuning.lane_change_cooldown_s;
                return Some(lane as u8);
            }
            return None;
        }
        if self.lane_cooldown_s > 0.0 {
            return None;
        }
        let gap = |lane: usize| view.gap_ahead.get(lane).copied().flatten();

        // An answer wants the wheel ahead, not a way past it.
        if matches!(self.current, Move::Attack { .. } | Move::Sprint { .. }) {
            let blocked = |lane: usize| gap(lane).is_some_and(|g| g < tactics::CLEAR_LANE_M);
            if !blocked(current) {
                return None;
            }
            let escape = [current.checked_sub(1), Some(current + 1)]
                .into_iter()
                .flatten()
                .filter(|&lane| lane < lanes && !blocked(lane))
                .max_by(|&a, &b| gap(a).unwrap_or(f64::MAX).total_cmp(&gap(b).unwrap_or(f64::MAX)));
            return escape.map(|lane| {
                self.lane_cooldown_s = self.tuning.lane_change_cooldown_s;
                lane as u8
            });
        }

        let in_window = |gap: Option<f64>, (lo, hi): (f64, f64)| gap.is_some_and(|g| (lo..=hi).contains(&g));
        if in_window(gap(current), self.tuning.draft_window) {
            return None;
        }

        let neighbours = [current.checked_sub(1), Some(current + 1)];
        let best = neighbours
            .into_iter()
            .flatten()
            .filter(|&lane| lane < lanes)
            .filter_map(|lane| gap(lane).map(|gap| (lane, gap)))
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

    fn profile(style: RidingStyle) -> BotProfile {
        BotProfile {
            ftp_wkg: 3.0,
            weight_kg: 70.0,
            style,
            team: Team::Moos,
            variance: 0.05,
        }
    }

    fn brain(style: RidingStyle) -> BotBrain {
        BotBrain::new(profile(style), BotTuning::default())
    }

    const FREE_RIDE_FLAT: BotSituation = BotSituation {
        grade_percent: 0.0,
        racing: false,
        group_ride: false,
        distance_to_finish: None,
        free: true,
        line_ahead: None,
        passer: None,
        wheel_behind: false,
        gap_ahead_m: None,
        human_m: None,
        waiting_for_group: false,
    };

    /// Rides `seconds` in `situation`, returning the moves seen.
    fn ride(bot: &mut BotBrain, situation: &BotSituation, seconds: f64, rng: &mut SplitMix64) -> Vec<Move> {
        let mut seen = Vec::new();
        for _ in 0..(seconds / 0.05).round() as usize {
            bot.power(situation, rng, 0.05);
            let m = bot.current_move();
            if seen
                .last()
                .is_none_or(|last: &Move| std::mem::discriminant(last) != std::mem::discriminant(&m))
            {
                seen.push(m);
            }
        }
        seen
    }

    fn is_attack(m: &Move) -> bool {
        matches!(m, Move::Attack { .. })
    }

    // --- the cast ------------------------------------------------------------------

    #[test]
    fn a_name_always_rides_the_same_type_in_the_same_kit() {
        assert_eq!(
            RidingStyle::of_name("Gus Tailwind"),
            RidingStyle::of_name("Gus Tailwind")
        );
        assert_eq!(Team::of_name("Gus Tailwind"), Team::of_name("Gus Tailwind"));
        let a = BotProfile::character("Gus Tailwind", &mut SplitMix64::new(1));
        let b = BotProfile::character("Gus Tailwind", &mut SplitMix64::new(2));
        assert_eq!((a.style, a.team), (b.style, b.team));
    }

    #[test]
    fn the_cast_has_every_type_and_team_in_about_the_planned_shares() {
        let names = crate::names::all_names();
        let share =
            |style| names.iter().filter(|n| RidingStyle::of_name(n) == style).count() as f64 / names.len() as f64;
        for (style, planned) in [
            (RidingStyle::Rouleur, 0.30),
            (RidingStyle::Climber, 0.20),
            (RidingStyle::Sprinter, 0.20),
            (RidingStyle::Attacker, 0.15),
            (RidingStyle::Tourer, 0.15),
        ] {
            assert!((share(style) - planned).abs() < 0.05, "{style:?}: {}", share(style));
        }
        for team in Team::ALL {
            assert!(names.iter().any(|n| Team::of_name(n) == team), "{team:?}");
        }
    }

    #[test]
    fn character_profiles_stay_in_documented_ranges() {
        let mut rng = SplitMix64::new(9);
        for name in crate::names::all_names().iter().take(500) {
            let p = BotProfile::character(name, &mut rng);
            let (light, heavy) = p.style.weight_kg();
            assert!((2.0..4.5).contains(&p.ftp_wkg));
            assert!((light..heavy).contains(&p.weight_kg));
            assert!((0.03..0.10).contains(&p.variance));
        }
    }

    #[test]
    fn goldie_lemon_rides_for_team_zitrone() {
        assert_eq!(Team::of_name(crate::names::LEMON_NAME), Team::Zitrone);
    }

    #[test]
    fn climbers_are_lighter_than_sprinters() {
        assert!(RidingStyle::Climber.weight_kg().1 < RidingStyle::Sprinter.weight_kg().0);
    }

    // --- pace --------------------------------------------------------------------------

    #[test]
    fn free_ride_is_endurance_pace() {
        let i = brain(RidingStyle::Rouleur).target_intensity(&FREE_RIDE_FLAT);
        assert!((0.65..=0.75).contains(&i));
    }

    #[test]
    fn tourers_ride_easier_than_everyone() {
        let tourer = brain(RidingStyle::Tourer).target_intensity(&FREE_RIDE_FLAT);
        for style in RidingStyle::ALL.into_iter().filter(|s| *s != RidingStyle::Tourer) {
            assert!(tourer < brain(style).target_intensity(&FREE_RIDE_FLAT), "{style:?}");
        }
    }

    #[test]
    fn climbers_push_harder_uphill_than_others() {
        let uphill = BotSituation {
            grade_percent: 6.0,
            ..FREE_RIDE_FLAT
        };
        let climber = brain(RidingStyle::Climber).target_intensity(&uphill);
        let rouleur = brain(RidingStyle::Rouleur).target_intensity(&uphill);
        assert!(climber > rouleur);
        assert!(rouleur > brain(RidingStyle::Rouleur).target_intensity(&FREE_RIDE_FLAT));
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
            racing: true,
            distance_to_finish: Some(5000.0),
            ..FREE_RIDE_FLAT
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
    fn group_ride_intensity() {
        let group = BotSituation {
            group_ride: true,
            ..FREE_RIDE_FLAT
        };
        assert_eq!(brain(RidingStyle::Rouleur).target_intensity(&group), 0.75);
        let racing = BotSituation { racing: true, ..group };
        assert_eq!(brain(RidingStyle::Rouleur).target_intensity(&racing), 0.95);
    }

    #[test]
    fn power_varies_around_the_target() {
        let mut bot = brain(RidingStyle::Rouleur);
        let mut rng = SplitMix64::new(4);
        let samples: Vec<f64> = (0..2000).map(|_| bot.power(&FREE_RIDE_FLAT, &mut rng, 0.05)).collect();
        let mean = samples.iter().sum::<f64>() / samples.len() as f64;
        let target = 210.0 * 0.72;
        assert!((mean - target).abs() < target * 0.1, "mean {mean}");
        let min = samples.iter().cloned().fold(f64::MAX, f64::min);
        let max = samples.iter().cloned().fold(f64::MIN, f64::max);
        assert!(max > min, "power should not be constant");
    }

    #[test]
    fn a_bot_ahead_of_its_group_waits_for_it() {
        let mut bot = brain(RidingStyle::Rouleur);
        let waiting = BotSituation {
            waiting_for_group: true,
            ..FREE_RIDE_FLAT
        };
        assert!(bot.intensity(&waiting) <= 0.55);
        bot.current = Move::Attack { intensity: 1.5 };
        assert_eq!(bot.intensity(&waiting), 1.5, "an attack doesn't wait");
    }

    // --- energy --------------------------------------------------------------------------

    #[test]
    fn riding_above_critical_power_spends_w_prime() {
        let mut e = Energy::full(20_000.0);
        e.ride(300.0, 200.0, 50.0);
        assert!((e.fraction() - 0.75).abs() < 1e-9);
        e.ride(1000.0, 200.0, 1000.0);
        assert_eq!(e.fraction(), 0.0, "never below empty");
    }

    #[test]
    fn w_prime_comes_back_faster_the_easier_the_ride() {
        let drained = || {
            let mut e = Energy::full(20_000.0);
            e.ride(400.0, 200.0, 50.0);
            e
        };
        let (mut easy, mut tempo) = (drained(), drained());
        easy.ride(100.0, 200.0, 120.0);
        tempo.ride(190.0, 200.0, 120.0);
        assert!(easy.fraction() > tempo.fraction());
        assert!(tempo.fraction() > drained().fraction());
        // Skiba's τ at 100 W under CP: 546·e^-1 + 316 ≈ 517 s.
        let tau: f64 = 546.0 * (-1.0f64).exp() + 316.0;
        let expected = 1.0 - 0.5 * (-120.0 / tau).exp();
        assert!((easy.fraction() - expected).abs() < 1e-9);
    }

    // --- moves ---------------------------------------------------------------------------

    fn summit(distance_m: f64) -> Option<LineAhead> {
        Some(LineAhead {
            kind: LineKind::Summit,
            index: 1,
            distance_m,
        })
    }

    fn sprint_line(distance_m: f64) -> Option<LineAhead> {
        Some(LineAhead {
            kind: LineKind::Sprint,
            index: 2,
            distance_m,
        })
    }

    #[test]
    fn a_climber_attacks_near_the_top_with_a_human_close_then_recovers() {
        let near_top = BotSituation {
            grade_percent: 6.0,
            line_ahead: summit(500.0),
            human_m: Some(30.0),
            ..FREE_RIDE_FLAT
        };
        let mut attacks = 0;
        for seed in 0..20 {
            let mut bot = brain(RidingStyle::Climber);
            let moves = ride(&mut bot, &near_top, 120.0, &mut SplitMix64::new(seed));
            if moves.iter().any(is_attack) {
                attacks += 1;
                let attack = moves.iter().position(is_attack).unwrap();
                assert_eq!(moves.get(attack + 1), Some(&Move::Recover), "{moves:?}");
            }
        }
        assert!((12..=19).contains(&attacks), "{attacks} of 20 climbers attacked");
    }

    #[test]
    fn an_attack_pushes_well_over_ftp_and_drains_the_tank() {
        let mut bot = brain(RidingStyle::Climber);
        let mut rng = SplitMix64::new(3);
        bot.start(Move::Attack { intensity: 1.3 }, 30.0);
        let watts: f64 = (0..200)
            .map(|_| bot.power(&FREE_RIDE_FLAT, &mut rng, 0.05))
            .sum::<f64>()
            / 200.0;
        assert!(watts > 1.2 * 210.0, "{watts} W");
        assert!(bot.energy() < 1.0);
    }

    #[test]
    fn nobody_attacks_far_from_the_top_or_with_nobody_watching() {
        for situation in [
            BotSituation {
                line_ahead: summit(900.0),
                human_m: Some(30.0),
                ..FREE_RIDE_FLAT
            },
            BotSituation {
                line_ahead: summit(300.0),
                human_m: Some(500.0),
                ..FREE_RIDE_FLAT
            },
        ] {
            let mut bot = brain(RidingStyle::Climber);
            let moves = ride(&mut bot, &situation, 60.0, &mut SplitMix64::new(1));
            assert_eq!(moves, vec![Move::Ride], "{situation:?}");
        }
    }

    #[test]
    fn a_line_is_contested_once_per_pass() {
        let mut bot = brain(RidingStyle::Climber);
        bot.contested = Some(1);
        let near_top = BotSituation {
            line_ahead: summit(400.0),
            human_m: Some(10.0),
            ..FREE_RIDE_FLAT
        };
        assert_eq!(
            ride(&mut bot, &near_top, 30.0, &mut SplitMix64::new(1)),
            vec![Move::Ride]
        );
        // Next lap: the line is far ahead again and may be ridden for once more.
        let next_lap = BotSituation {
            line_ahead: summit(5000.0),
            ..near_top
        };
        ride(&mut bot, &next_lap, 0.05, &mut SplitMix64::new(1));
        assert_eq!(bot.contested, None);
    }

    #[test]
    fn tourers_never_race_anybody() {
        let everything = BotSituation {
            line_ahead: sprint_line(100.0),
            human_m: Some(5.0),
            passer: Some(Passer {
                human: true,
                speed_gain: 3.0,
                lane: 1,
            }),
            ..FREE_RIDE_FLAT
        };
        let mut bot = brain(RidingStyle::Tourer);
        assert_eq!(
            ride(&mut bot, &everything, 60.0, &mut SplitMix64::new(2)),
            vec![Move::Ride]
        );
    }

    #[test]
    fn a_sprinter_goes_for_the_line_with_a_human_close() {
        let mut bot = brain(RidingStyle::Sprinter);
        let line = BotSituation {
            line_ahead: sprint_line(240.0),
            human_m: Some(120.0),
            ..FREE_RIDE_FLAT
        };
        let moves = ride(&mut bot, &line, 40.0, &mut SplitMix64::new(1));
        assert_eq!(moves[0], Move::Sprint { intensity: 1.9 });
        assert!(moves.contains(&Move::Recover));
        let alone = BotSituation { human_m: None, ..line };
        assert_eq!(
            ride(&mut brain(RidingStyle::Sprinter), &alone, 40.0, &mut SplitMix64::new(1)),
            vec![Move::Ride]
        );
    }

    #[test]
    fn a_tired_bot_lets_the_line_go() {
        let mut bot = brain(RidingStyle::Sprinter);
        bot.energy = Energy {
            capacity_j: 22_000.0,
            deficit_j: 20_000.0,
        };
        let line = BotSituation {
            line_ahead: sprint_line(100.0),
            racing: true,
            ..FREE_RIDE_FLAT
        };
        assert_eq!(ride(&mut bot, &line, 5.0, &mut SplitMix64::new(1)), vec![Move::Ride]);
    }

    #[test]
    fn an_attacker_answers_a_human_who_comes_past_and_moves_into_their_lane() {
        let passed = BotSituation {
            human_m: Some(3.0),
            gap_ahead_m: None,
            passer: Some(Passer {
                human: true,
                speed_gain: 2.0,
                lane: 2,
            }),
            ..FREE_RIDE_FLAT
        };
        let mut answered = 0;
        for seed in 0..40 {
            let mut bot = brain(RidingStyle::Attacker);
            bot.power(&passed, &mut SplitMix64::new(seed), 0.05);
            if bot.current_move() == Move::Answer {
                answered += 1;
                let view = LaneView {
                    current_lane: 1,
                    gap_ahead: vec![None, None, Some(3.0), None],
                };
                assert_eq!(bot.choose_lane(&view, 0.05), Some(2));
            }
        }
        assert!((20..=36).contains(&answered), "{answered} of 40 answered");
    }

    #[test]
    fn an_answering_bot_stays_behind_the_wheel_it_chases() {
        let mut bot = brain(RidingStyle::Attacker);
        bot.current = Move::Answer;
        let view = LaneView {
            current_lane: 1,
            gap_ahead: vec![None, Some(7.0), None, None],
        };
        assert_eq!(bot.choose_lane(&view, 0.05), None);
    }

    #[test]
    fn an_answer_ends_on_the_wheel() {
        let mut bot = brain(RidingStyle::Attacker);
        bot.start(Move::Answer, 25.0);
        let on_wheel = BotSituation {
            gap_ahead_m: Some(3.0),
            ..FREE_RIDE_FLAT
        };
        bot.power(&on_wheel, &mut SplitMix64::new(1), 0.05);
        assert_eq!(bot.current_move(), Move::Ride);
    }

    #[test]
    fn bots_only_answer_humans_outside_races() {
        let bot_passes = BotSituation {
            human_m: Some(3.0),
            passer: Some(Passer {
                human: false,
                speed_gain: 2.0,
                lane: 1,
            }),
            ..FREE_RIDE_FLAT
        };
        for seed in 0..20 {
            let mut bot = brain(RidingStyle::Attacker);
            bot.power(&bot_passes, &mut SplitMix64::new(seed), 0.05);
            assert_ne!(bot.current_move(), Move::Answer);
        }
    }

    #[test]
    fn a_rouleur_with_a_wheel_behind_pulls_then_swings_off_and_lets_them_by() {
        let mut bot = brain(RidingStyle::Rouleur);
        let mut rng = SplitMix64::new(1);
        let leading = BotSituation {
            wheel_behind: true,
            ..FREE_RIDE_FLAT
        };
        let mut moves = vec![bot.current_move()];
        for _ in 0..(90.0 / 0.05) as usize {
            bot.power(&leading, &mut rng, 0.05);
            if moves.last() != Some(&bot.current_move()) {
                moves.push(bot.current_move());
            }
            if bot.current_move() == Move::SwingOff {
                break;
            }
        }
        assert_eq!(moves, [Move::Ride, Move::Pull, Move::SwingOff]);
        let view = LaneView {
            current_lane: 1,
            gap_ahead: vec![None, None, None, None],
        };
        assert_eq!(bot.choose_lane(&view, 0.05), Some(0), "aside to the left");
        let passing = BotSituation {
            passer: Some(Passer {
                human: true,
                speed_gain: 1.0,
                lane: 1,
            }),
            ..FREE_RIDE_FLAT
        };
        bot.power(&passing, &mut rng, 0.05);
        assert_eq!(bot.current_move(), Move::Ride, "back to riding once they come past");
    }

    #[test]
    fn a_pull_ends_when_someone_is_ahead_again() {
        let mut bot = brain(RidingStyle::Rouleur);
        bot.start(Move::Pull, 40.0);
        let caught = BotSituation {
            gap_ahead_m: Some(4.0),
            ..FREE_RIDE_FLAT
        };
        bot.power(&caught, &mut SplitMix64::new(1), 0.05);
        assert_eq!(bot.current_move(), Move::Ride);
    }

    #[test]
    fn an_attacker_near_a_human_attacks_now_and_then() {
        let mut bot = brain(RidingStyle::Attacker);
        let company = BotSituation {
            human_m: Some(20.0),
            ..FREE_RIDE_FLAT
        };
        let moves = ride(&mut bot, &company, 1800.0, &mut SplitMix64::new(5));
        let attacks = moves.iter().filter(|m| is_attack(m)).count();
        assert!((2..=14).contains(&attacks), "{attacks} attacks in 30 min: {moves:?}");
    }

    #[test]
    fn no_moves_in_a_vehicle_or_a_group_ride() {
        let line = BotSituation {
            line_ahead: sprint_line(100.0),
            human_m: Some(5.0),
            wheel_behind: true,
            ..FREE_RIDE_FLAT
        };
        for situation in [
            BotSituation { free: false, ..line },
            BotSituation {
                group_ride: true,
                ..line
            },
        ] {
            let mut bot = brain(RidingStyle::Sprinter);
            bot.start(Move::Attack { intensity: 1.5 }, 30.0);
            assert_eq!(
                ride(&mut bot, &situation, 60.0, &mut SplitMix64::new(1)),
                vec![Move::Ride]
            );
        }
    }

    #[test]
    fn an_attacking_bot_leaves_a_blocked_lane() {
        let mut bot = brain(RidingStyle::Attacker);
        bot.current = Move::Attack { intensity: 1.5 };
        let view = LaneView {
            current_lane: 1,
            gap_ahead: vec![Some(4.0), Some(3.0), None, None],
        };
        assert_eq!(bot.choose_lane(&view, 0.05), Some(2));
    }

    #[test]
    fn only_some_moves_go_on_the_wire() {
        assert_eq!(Move::Ride.id(), None);
        assert_eq!(Move::Recover.id(), None);
        assert_eq!(Move::SwingOff.id(), None);
        assert_eq!(Move::Pull.id(), Some("pull"));
        assert_eq!(Move::Attack { intensity: 1.4 }.id(), Some("attack"));
        assert_eq!(Move::Answer.id(), Some("answer"));
        assert_eq!(Move::Sprint { intensity: 1.9 }.id(), Some("sprint"));
    }

    // --- lanes and levels (unchanged) ------------------------------------------------

    #[test]
    fn bot_stays_in_a_good_draft() {
        let mut bot = brain(RidingStyle::Rouleur);
        let view = LaneView {
            current_lane: 1,
            gap_ahead: vec![Some(3.0), Some(2.0), None, None],
        };
        assert_eq!(bot.choose_lane(&view, 0.05), None);
    }

    #[test]
    fn bot_moves_over_to_catch_a_wheel_and_then_waits() {
        let mut bot = brain(RidingStyle::Rouleur);
        let view = LaneView {
            current_lane: 1,
            gap_ahead: vec![None, None, Some(8.0), None],
        };
        assert_eq!(bot.choose_lane(&view, 0.05), Some(2));
        assert_eq!(bot.choose_lane(&view, 0.05), None, "cooldown should prevent jitter");
    }

    #[test]
    fn bot_ignores_far_away_riders() {
        let mut bot = brain(RidingStyle::Rouleur);
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
            .map(|_| BotProfile::matched("Gus Tailwind", &[2.5], &mut rng).ftp_wkg)
            .collect();
        let pack = draws.iter().filter(|w| (2.375..=2.75).contains(*w)).count() as f64 / 2000.0;
        assert!((0.68..=0.80).contains(&pack), "pack share {pack}");
        assert!(draws.iter().all(|w| (2.0..=4.5).contains(w)));
    }

    #[test]
    fn matched_field_widens_to_the_humans() {
        let mut rng = SplitMix64::new(7);
        let draws: Vec<f64> = (0..2000)
            .map(|_| BotProfile::matched("Gus Tailwind", &[5.5], &mut rng).ftp_wkg)
            .collect();
        assert!(draws.iter().all(|w| *w <= 6.05));
        assert!(draws.iter().cloned().fold(f64::MIN, f64::max) > 4.5);
    }
}
