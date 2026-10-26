//! Shared vehicles: tandems and beer bikes.
//!
//! A vehicle is one physical body with several seats; each seat is an ordinary
//! rider. This module holds the pure model: kinds, per-kind physics and the
//! power-sharing helpers. The world owns the lifecycle.

use crate::drafting::DraftParams;
use crate::physics::Body;
use crate::rng::RandomSource;
use crate::world::RiderId;

pub type VehicleId = u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VehicleKind {
    Tandem,
    BeerBike { seats: u8 },
}

impl VehicleKind {
    /// Parses a wire kind. A tandem always has 2 seats (`seats` is ignored);
    /// a beer bike needs 5, 7 or 9 (a captain and an even number of riders).
    pub fn new(kind: &str, seats: u8) -> Option<VehicleKind> {
        match kind {
            "tandem" => Some(VehicleKind::Tandem),
            "beer_bike" if matches!(seats, 5 | 7 | 9) => Some(VehicleKind::BeerBike { seats }),
            _ => None,
        }
    }

    pub fn seats(&self) -> usize {
        match self {
            VehicleKind::Tandem => 2,
            VehicleKind::BeerBike { seats } => usize::from(*seats),
        }
    }

    pub fn wire_name(&self) -> &'static str {
        match self {
            VehicleKind::Tandem => "tandem",
            VehicleKind::BeerBike { .. } => "beer_bike",
        }
    }
}

/// Physical constants of the vehicle kinds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VehicleParams {
    pub tandem: Body,
    /// Beer bike frame without seats.
    pub beer_bike_base: Body,
    pub beer_bike_kg_per_seat: f64,
    pub beer_bike_draft: DraftParams,
    /// Lanes a beer bike blocks to each side of its centre.
    pub beer_bike_lane_half_width: f64,
}

impl Default for VehicleParams {
    fn default() -> Self {
        Self {
            tandem: Body {
                frame_mass_kg: 18.0,
                cda: 0.43,
                crr: 0.004,
            },
            beer_bike_base: Body {
                frame_mass_kg: 250.0,
                cda: 2.5,
                crr: 0.012,
            },
            beer_bike_kg_per_seat: 40.0,
            beer_bike_draft: DraftParams {
                max_reduction: 0.5,
                ..DraftParams::default()
            },
            beer_bike_lane_half_width: 1.0,
        }
    }
}

impl VehicleParams {
    pub fn body(&self, kind: VehicleKind) -> Body {
        match kind {
            VehicleKind::Tandem => self.tandem,
            VehicleKind::BeerBike { seats } => Body {
                frame_mass_kg: self.beer_bike_base.frame_mass_kg + self.beer_bike_kg_per_seat * f64::from(seats),
                ..self.beer_bike_base
            },
        }
    }

    /// Draft parameters for riders behind this kind of vehicle.
    pub fn draft(&self, kind: VehicleKind, normal: &DraftParams) -> DraftParams {
        match kind {
            VehicleKind::Tandem => *normal,
            VehicleKind::BeerBike { .. } => DraftParams {
                max_reduction: self.beer_bike_draft.max_reduction,
                ..*normal
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct Vehicle {
    pub id: VehicleId,
    pub kind: VehicleKind,
    pub code: String,
    pub seats: Vec<Option<RiderId>>,
    pub captain: RiderId,
    pub bots_fill: bool,
}

pub fn summed_power(powers: &[f64]) -> f64 {
    powers.iter().sum()
}

/// Each seat's share of the total power; all zero when nobody pedals.
pub fn shares(powers: &[f64]) -> Vec<f64> {
    let sum = summed_power(powers);
    if sum <= 0.0 {
        return vec![0.0; powers.len()];
    }
    powers.iter().map(|p| p / sum).collect()
}

/// Characters of a boarding code (no 0/O/1/I).
pub const CODE_ALPHABET: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH: usize = 6;

pub fn draw_code(rng: &mut dyn RandomSource) -> String {
    let alphabet = CODE_ALPHABET.as_bytes();
    (0..CODE_LENGTH)
        .map(|_| char::from(alphabet[rng.index(alphabet.len())]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::SplitMix64;

    #[test]
    fn kinds_validate() {
        assert_eq!(VehicleKind::new("tandem", 0), Some(VehicleKind::Tandem));
        assert_eq!(VehicleKind::new("tandem", 0).unwrap().seats(), 2);
        assert_eq!(VehicleKind::new("beer_bike", 7).unwrap().seats(), 7);
        assert_eq!(VehicleKind::new("beer_bike", 6), None);
        assert_eq!(VehicleKind::new("beer_bike", 8), None);
        assert_eq!(VehicleKind::new("beer_bike", 10), None);
        assert_eq!(VehicleKind::new("bus", 5), None);
    }

    #[test]
    fn beer_bike_mass_grows_with_seats() {
        let params = VehicleParams::default();
        assert_eq!(params.body(VehicleKind::BeerBike { seats: 9 }).frame_mass_kg, 610.0);
        assert_eq!(params.body(VehicleKind::BeerBike { seats: 5 }).frame_mass_kg, 450.0);
    }

    #[test]
    fn shares_add_up() {
        assert_eq!(shares(&[300.0, 100.0]), vec![0.75, 0.25]);
        assert_eq!(shares(&[0.0, 0.0]), vec![0.0, 0.0]);
    }

    #[test]
    fn codes_use_the_alphabet() {
        let mut rng = SplitMix64::new(7);
        for _ in 0..100 {
            let code = draw_code(&mut rng);
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| CODE_ALPHABET.contains(c)), "{code}");
        }
    }
}
