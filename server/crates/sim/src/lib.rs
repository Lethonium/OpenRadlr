//! # openradlr-sim
//!
//! The simulation core of OpenRadlr. It is deliberately free of I/O, networking,
//! async runtimes and third-party dependencies so that it can be
//!
//! * unit-tested deterministically (all randomness is injected via [`rng::RandomSource`]),
//! * embedded unchanged in the standalone server and, later, in native clients
//!   that host a LAN game.
//!
//! The server crate is an adapter around this core: it translates network
//! messages into calls on [`world::World`] and world state back into messages.

pub mod bot;
pub mod drafting;
pub mod events;
pub mod names;
pub mod network;
pub mod physics;
pub mod race;
pub mod rng;
pub mod route;
pub mod schedule;
pub mod sharing;
pub mod spacing;
pub mod studio;
pub mod vehicle;
pub mod world;

pub use world::{RiderId, RouteIndex, SimConfig, World, WorldEvent};
