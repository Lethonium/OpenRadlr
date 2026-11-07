//! Longitudinal cycling physics.
//!
//! ```text
//! m * dv/dt = P / v - m * g * (sin(theta) + Crr * cos(theta)) - 0.5 * rho * CdA * v^2
//! ```
//!
//! All values are SI units. The grade is given in percent.

pub const GRAVITY: f64 = 9.806_65;

/// Tunable physical constants. Defaults are calibrated against the rider table
/// in [`crate::calibration`] (#22); a retune must keep its tests passing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicsParams {
    /// Rolling resistance coefficient.
    pub crr: f64,
    /// Drag area in m² of an undrafted rider weighing `cda_reference_kg`;
    /// other riders scale from it, see [`rider_cda`].
    pub cda: f64,
    /// Rider weight in kg at which the drag area is `cda`.
    pub cda_reference_kg: f64,
    /// Air density in kg/m³.
    pub air_density: f64,
    /// Mass of the bike in kg, added to the rider's mass.
    pub bike_mass_kg: f64,
    /// Lower bound for `v` in `P / v` so that starting from rest stays finite.
    pub min_speed_for_power: f64,
    /// Hard upper speed limit in m/s.
    pub max_speed: f64,
}

impl Default for PhysicsParams {
    fn default() -> Self {
        Self {
            crr: 0.005,
            cda: 0.40,
            cda_reference_kg: 75.0,
            air_density: 1.225,
            bike_mass_kg: 10.0,
            min_speed_for_power: 1.0,
            max_speed: 30.0,
        }
    }
}

/// The frame being pushed: its own mass, drag area and rolling resistance.
/// Riders' mass comes separately via [`StepInput::rider_mass_kg`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Body {
    pub frame_mass_kg: f64,
    pub cda: f64,
    pub crr: f64,
}

impl Body {
    /// An ordinary bike as described by the physics parameters, with the drag
    /// area of a rider weighing `rider_mass_kg`.
    pub fn bike(params: &PhysicsParams, rider_mass_kg: f64) -> Body {
        Body {
            frame_mass_kg: params.bike_mass_kg,
            cda: rider_cda(params, rider_mass_kg),
            crr: params.crr,
        }
    }
}

/// Lightest and heaviest rider weights (kg) the drag area scales between: the
/// weights a join accepts.
const CDA_MASS_RANGE: (f64, f64) = (30.0, 200.0);

/// Drag area of a solo rider: `cda · (m / cda_reference_kg)^(2/3)`.
/// The rider grows alike in every direction: frontal area scales with
/// length², length with mass^(1/3). `m` is clamped to 30–200 kg.
pub fn rider_cda(params: &PhysicsParams, rider_mass_kg: f64) -> f64 {
    let mass = rider_mass_kg.clamp(CDA_MASS_RANGE.0, CDA_MASS_RANGE.1);
    params.cda * (mass / params.cda_reference_kg).powf(2.0 / 3.0)
}

/// The numbers a solo rider is ridden with, as the client needs them for
/// virtual shifting.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RiderPhysics {
    /// Rider plus bike.
    pub mass_kg: f64,
    pub cda_m2: f64,
    pub crr: f64,
    pub air_density: f64,
}

pub fn rider_physics(params: &PhysicsParams, rider_mass_kg: f64) -> RiderPhysics {
    let body = Body::bike(params, rider_mass_kg);
    RiderPhysics {
        mass_kg: rider_mass_kg + body.frame_mass_kg,
        cda_m2: body.cda,
        crr: body.crr,
        air_density: params.air_density,
    }
}

/// Inputs for one physics step of one body (a solo rider or a whole vehicle).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StepInput {
    /// Combined mass of all riders on the body (frame excluded).
    pub rider_mass_kg: f64,
    pub body: Body,
    pub speed: f64,
    pub power_watts: f64,
    pub grade_percent: f64,
    /// Multiplier on CdA, `1.0` without drafting, below `1.0` in a draft.
    pub cda_factor: f64,
}

/// Net acceleration in m/s².
pub fn acceleration(params: &PhysicsParams, input: &StepInput) -> f64 {
    let mass = input.rider_mass_kg + input.body.frame_mass_kg;
    let theta = (input.grade_percent / 100.0).atan();
    let speed = input.speed.max(0.0);

    let propulsion = input.power_watts.max(0.0) / speed.max(params.min_speed_for_power);
    let gravity = mass * GRAVITY * theta.sin();
    let rolling = if speed > 0.0 || propulsion > 0.0 {
        mass * GRAVITY * input.body.crr * theta.cos()
    } else {
        0.0
    };
    let drag = 0.5 * params.air_density * input.body.cda * input.cda_factor * speed * speed;

    (propulsion - gravity - rolling - drag) / mass
}

/// Advances the speed by `dt` seconds using explicit Euler integration.
pub fn step_speed(params: &PhysicsParams, input: &StepInput, dt: f64) -> f64 {
    let next = input.speed + acceleration(params, input) * dt;
    next.clamp(0.0, params.max_speed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ride(power: f64, grade: f64, cda_factor: f64, seconds: f64) -> f64 {
        let params = PhysicsParams::default();
        let dt = 0.05;
        let mut speed = 0.0;
        let steps = (seconds / dt) as usize;
        for _ in 0..steps {
            speed = step_speed(
                &params,
                &StepInput {
                    rider_mass_kg: 75.0,
                    body: Body::bike(&params, 75.0),
                    speed,
                    power_watts: power,
                    grade_percent: grade,
                    cda_factor,
                },
                dt,
            );
        }
        speed
    }

    #[test]
    fn beer_bike_cruises_near_20_kmh() {
        use crate::vehicle::{VehicleKind, VehicleParams};
        let params = PhysicsParams::default();
        let body = VehicleParams::default().body(VehicleKind::BeerBike { seats: 9 });
        let mut speed = 0.0;
        for _ in 0..2400 {
            speed = step_speed(
                &params,
                &StepInput {
                    rider_mass_kg: 600.0,
                    body,
                    speed,
                    power_watts: 1200.0,
                    grade_percent: 0.0,
                    cda_factor: 1.0,
                },
                0.05,
            );
        }
        assert!((5.0..=6.5).contains(&speed), "speed was {speed} m/s");
    }

    fn kmh(v: f64) -> f64 {
        v * 3.6
    }

    #[test]
    fn climbing_is_slower_than_riding_flat() {
        let flat = ride(250.0, 0.0, 1.0, 300.0);
        let climb = ride(250.0, 6.0, 1.0, 300.0);
        assert!(climb < flat * 0.6, "flat {flat} climb {climb}");
        let v = kmh(climb);
        assert!((12.0..20.0).contains(&v), "climb speed was {v} km/h");
    }

    #[test]
    fn drafting_makes_the_same_power_faster() {
        let solo = ride(200.0, 0.0, 1.0, 300.0);
        let drafted = ride(200.0, 0.0, 0.7, 300.0);
        assert!(drafted > solo * 1.05);
    }

    #[test]
    fn no_power_on_the_flat_coasts_to_a_stop_but_never_backwards() {
        let params = PhysicsParams::default();
        let mut speed = 10.0;
        for _ in 0..20_000 {
            speed = step_speed(
                &params,
                &StepInput {
                    rider_mass_kg: 75.0,
                    body: Body::bike(&params, 75.0),
                    speed,
                    power_watts: 0.0,
                    grade_percent: 0.0,
                    cda_factor: 1.0,
                },
                0.05,
            );
        }
        assert_eq!(speed, 0.0);
    }

    #[test]
    fn standing_still_uphill_without_power_stays_at_zero() {
        assert_eq!(ride(0.0, 8.0, 1.0, 10.0), 0.0);
    }

    #[test]
    fn rolling_downhill_without_power_accelerates() {
        assert!(ride(0.0, -6.0, 1.0, 60.0) > 10.0);
    }

    #[test]
    fn speed_is_capped() {
        assert!(ride(5000.0, -20.0, 1.0, 120.0) <= PhysicsParams::default().max_speed);
    }

    #[test]
    fn rider_cda_is_cda_at_the_reference_weight() {
        let p = PhysicsParams::default();
        assert_eq!(rider_cda(&p, 75.0), p.cda);
    }

    #[test]
    fn rider_cda_grows_with_two_thirds_of_mass() {
        let p = PhysicsParams::default();
        assert!((rider_cda(&p, 150.0) - p.cda * 2f64.powf(2.0 / 3.0)).abs() < 1e-12);
    }

    #[test]
    fn rider_cda_clamps_light_riders() {
        let p = PhysicsParams::default();
        assert_eq!(rider_cda(&p, 10.0), rider_cda(&p, 30.0));
    }

    #[test]
    fn rider_cda_clamps_heavy_riders() {
        let p = PhysicsParams::default();
        assert_eq!(rider_cda(&p, 500.0), rider_cda(&p, 200.0));
    }

    #[test]
    fn rider_physics_adds_the_bike() {
        assert_eq!(rider_physics(&PhysicsParams::default(), 90.0).mass_kg, 100.0);
    }

    #[test]
    fn rider_physics_uses_the_rider_cda() {
        let p = PhysicsParams::default();
        assert_eq!(rider_physics(&p, 90.0).cda_m2, rider_cda(&p, 90.0));
    }
}
