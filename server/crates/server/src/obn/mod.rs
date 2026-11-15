//! OpenBikeNet: shared presence of riders on other apps' routes.
//!
//! [`wire`] holds the JSON messages of protocol v0 (spec in the OpenBikeNet repository),
//! [`outbox`] turns this server's riders into the messages an app sends.

pub mod link;
pub mod outbox;
pub mod remote;
pub mod wire;

/// The room every rider joins (spec 6.2).
pub const OBN_ROOM: &str = "public";

/// A route shared through OpenBikeNet and the local route it is drawn onto.
#[derive(Debug, Clone, PartialEq)]
pub struct SharedRoute {
    /// The OpenBikeNet route id, e.g. `velodrome-250`.
    pub id: String,
    /// Its length as OpenBikeNet publishes it, in metres.
    pub length_m: f64,
    /// The length of the local route, in metres.
    pub local_length_m: f64,
}

impl SharedRoute {
    pub fn new(id: impl Into<String>, length_m: f64, local_length_m: f64) -> Self {
        Self {
            id: id.into(),
            length_m,
            local_length_m,
        }
    }

    /// A local position scaled onto the shared route, kept below its length (spec 6.4).
    pub fn shared_distance(&self, position: f64) -> f64 {
        let position = if position.is_finite() { position } else { 0.0 };
        (position * self.length_m / self.local_length_m).clamp(0.0, self.length_m - 0.01)
    }

    /// Metres on the shared route to metres on the local one.
    pub fn local_distance(&self, distance: f64) -> f64 {
        distance * self.local_length_m / self.length_m
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions_scale_to_the_shared_length_and_stay_below_it() {
        let herne_hill = SharedRoute::new("herne-hill-450", 450.0, 450.006);
        assert!((herne_hill.shared_distance(225.003) - 225.0).abs() < 0.001);
        assert!((herne_hill.shared_distance(450.006) - 449.99).abs() < 0.001);
        assert!((herne_hill.shared_distance(460.0) - 449.99).abs() < 0.001);
        assert_eq!(herne_hill.shared_distance(f64::NAN), 0.0);
        assert!((herne_hill.local_distance(225.0) - 225.003).abs() < 0.001);
    }
}
