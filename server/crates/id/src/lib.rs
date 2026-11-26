//! OpenRadlr accounts (ADR 0032): signed rider keys, sign-in by email code or
//! passkey, and rider backups. The game server mounts [`http::router`] at `/id`.

pub mod deps;
pub mod email;
pub mod http;
pub mod limits;
pub mod mail;
pub mod mailer;
pub mod rider_key;
pub mod service;
pub mod store;
pub mod webauthn;
