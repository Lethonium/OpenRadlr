//! Calibration of the road physics against simulated riders.
//!
//! Solves steady-state speeds with the real [`physics::acceleration`], so a
//! retune of [`PhysicsParams`] shows up as a table of speeds per rider weight.
//! The tests pin the target feel; `cargo run -p openradlr-sim --example
//! calibration` prints the table.

use crate::physics::{self, Body, PhysicsParams, StepInput};

/// Rider weights (kg) of the calibration table.
pub const RIDERS: [f64; 5] = [55.0, 70.0, 75.0, 90.0, 100.0];

/// Cadence (rev/s) and wheel circumference (m) behind [`Row::ratio_200w_90rpm`].
const CADENCE_RPS: f64 = 1.5;
const WHEEL_M: f64 = 2.1;

const BISECTIONS: usize = 60;

/// The solo bike a rider of `rider_mass_kg` rides.
fn body(params: &PhysicsParams, rider_mass_kg: f64) -> Body {
    Body::bike(params, rider_mass_kg)
}

/// Speed (m/s) where [`physics::acceleration`] is zero at `power_watts` on
/// `grade_percent`: bisection between 0 and `max_speed`.
pub fn steady_speed(params: &PhysicsParams, rider_mass_kg: f64, power_watts: f64, grade_percent: f64) -> f64 {
    let (mut low, mut high) = (0.0, params.max_speed);
    for _ in 0..BISECTIONS {
        let speed = (low + high) / 2.0;
        let input = StepInput {
            rider_mass_kg,
            body: body(params, rider_mass_kg),
            speed,
            power_watts,
            grade_percent,
            cda_factor: 1.0,
        };
        if physics::acceleration(params, &input) > 0.0 {
            low = speed;
        } else {
            high = speed;
        }
    }
    (low + high) / 2.0
}

/// One row of the calibration table.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Row {
    pub rider_kg: f64,
    pub cda: f64,
    pub flat_200w_kmh: f64,
    pub flat_2_5wkg_kmh: f64,
    pub climb_4pct_3wkg_kmh: f64,
    pub climb_8pct_3wkg_kmh: f64,
    pub coast_4pct_kmh: f64,
    pub coast_8pct_kmh: f64,
    /// Gear ratio (chainring/cog) that gives the 200 W flat speed at 90 rpm
    /// on a 2.1 m wheel. Informative: it maps to the client's gear table.
    pub ratio_200w_90rpm: f64,
}

/// The table for `riders` (kg), with the given parameters.
pub fn table(params: &PhysicsParams, riders: &[f64]) -> Vec<Row> {
    riders
        .iter()
        .map(|&kg| {
            let kmh = |watts: f64, grade: f64| steady_speed(params, kg, watts, grade) * 3.6;
            let flat_200w = steady_speed(params, kg, 200.0, 0.0);
            Row {
                rider_kg: kg,
                cda: body(params, kg).cda,
                flat_200w_kmh: flat_200w * 3.6,
                flat_2_5wkg_kmh: kmh(2.5 * kg, 0.0),
                climb_4pct_3wkg_kmh: kmh(3.0 * kg, 4.0),
                climb_8pct_3wkg_kmh: kmh(3.0 * kg, 8.0),
                coast_4pct_kmh: kmh(0.0, -4.0),
                coast_8pct_kmh: kmh(0.0, -8.0),
                ratio_200w_90rpm: flat_200w / (CADENCE_RPS * WHEEL_M),
            }
        })
        .collect()
}

/// The table as Markdown, speeds in km/h.
pub fn markdown(rows: &[Row]) -> String {
    let mut out = String::from(
        "| Rider | CdA | 200 W flat | 2.5 W/kg flat | 3 W/kg 4 % | 3 W/kg 8 % | Coast −4 % | Coast −8 % | Ratio 200 W @ 90 rpm |\n\
         | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n",
    );
    for r in rows {
        out.push_str(&format!(
            "| {:.0} kg | {:.3} | {:.1} | {:.1} | {:.1} | {:.1} | {:.1} | {:.1} | {:.2} |\n",
            r.rider_kg,
            r.cda,
            r.flat_200w_kmh,
            r.flat_2_5wkg_kmh,
            r.climb_4pct_3wkg_kmh,
            r.climb_8pct_3wkg_kmh,
            r.coast_4pct_kmh,
            r.coast_8pct_kmh,
            r.ratio_200w_90rpm,
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::{step_speed, PhysicsParams, StepInput};

    #[test]
    fn steady_speed_matches_stepping() {
        let p = PhysicsParams::default();
        let dt = 0.05;
        let mut speed = 0.0;
        for _ in 0..(600.0 / dt) as usize {
            let input = StepInput {
                rider_mass_kg: 75.0,
                body: body(&p, 75.0),
                speed,
                power_watts: 200.0,
                grade_percent: 0.0,
                cda_factor: 1.0,
            };
            speed = step_speed(&p, &input, dt);
        }
        assert!((speed - steady_speed(&p, 75.0, 200.0, 0.0)).abs() < 0.05);
    }

    #[test]
    fn coasting_downhill_has_a_steady_speed() {
        assert!(steady_speed(&PhysicsParams::default(), 75.0, 0.0, -8.0) > 10.0);
    }

    #[test]
    fn no_power_on_the_flat_has_no_speed() {
        assert!(steady_speed(&PhysicsParams::default(), 75.0, 0.0, 0.0) < 0.01);
    }

    #[test]
    fn table_has_a_row_per_rider() {
        let rows = table(&PhysicsParams::default(), &RIDERS);
        let weights: Vec<f64> = rows.iter().map(|r| r.rider_kg).collect();
        assert_eq!(weights, RIDERS.to_vec());
    }

    fn rows() -> Vec<Row> {
        table(&PhysicsParams::default(), &RIDERS)
    }

    fn row(kg: f64) -> Row {
        rows().into_iter().find(|r| r.rider_kg == kg).expect("rider in RIDERS")
    }

    fn strictly_increasing(values: impl Iterator<Item = f64>) -> bool {
        let values: Vec<f64> = values.collect();
        values.windows(2).all(|w| w[0] < w[1])
    }

    #[test]
    fn two_hundred_watts_flat_suits_a_75_kg_rider() {
        let v = row(75.0).flat_200w_kmh;
        assert!((31.0..=32.0).contains(&v), "{v} km/h");
    }

    #[test]
    fn two_hundred_watts_flat_suits_a_90_kg_rider() {
        let v = row(90.0).flat_200w_kmh;
        assert!((29.0..=31.0).contains(&v), "{v} km/h");
    }

    #[test]
    fn heavier_riders_are_slower_at_the_same_watts() {
        assert!(strictly_increasing(rows().iter().map(|r| -r.flat_200w_kmh)));
    }

    #[test]
    fn heavier_riders_are_faster_at_the_same_watts_per_kg() {
        assert!(strictly_increasing(rows().iter().map(|r| r.flat_2_5wkg_kmh)));
    }

    #[test]
    fn three_watts_per_kg_climbs_eight_percent_plausibly() {
        for r in rows() {
            assert!((10.0..=13.0).contains(&r.climb_8pct_3wkg_kmh), "{r:?}");
        }
    }

    #[test]
    fn descents_stay_in_a_sane_band() {
        for r in rows() {
            assert!((54.0..=62.0).contains(&r.coast_8pct_kmh), "{r:?}");
        }
    }

    #[test]
    fn heavier_riders_coast_faster() {
        assert!(strictly_increasing(rows().iter().map(|r| r.coast_8pct_kmh)));
    }
}
