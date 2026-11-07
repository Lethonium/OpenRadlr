//! OpenBikeNet: shared presence of riders on other apps' routes.
//!
//! [`wire`] holds the JSON messages of protocol v0 (spec in the OpenBikeNet repository),
//! [`outbox`] turns this server's riders into the messages an app sends.

pub mod link;
pub mod outbox;
pub mod remote;
pub mod wire;

/// Length of the shared route, in metres. The OpenBikeNet route `velodrome-250` is 250 m.
pub const OBN_LENGTH_M: f64 = 250.0;

/// The room every rider joins (spec 6.2).
pub const OBN_ROOM: &str = "public";
