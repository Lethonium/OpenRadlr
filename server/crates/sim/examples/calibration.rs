//! Prints the physics calibration table: `cargo run -p openradlr-sim --example calibration`.

use openradlr_sim::calibration::{markdown, table, RIDERS};
use openradlr_sim::physics::PhysicsParams;

fn main() {
    print!("{}", markdown(&table(&PhysicsParams::default(), &RIDERS)));
}
