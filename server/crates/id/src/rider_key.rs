//! Rider keys (ADR 0003, ADR 0032): an ECDSA P-256 key pair made by the client
//! with WebCrypto. The public key travels as base64 SPKI, a signature as base64
//! of WebCrypto's raw `r‖s` (64 bytes) over SHA-256 of the message.
//!
//! Each use signs its own message, so a signature made for one purpose can't be
//! replayed for another: [`join_message`] for a game server's `join`,
//! [`link_message`] for linking the key to an account.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use p256::ecdsa::signature::Verifier as _;
use p256::ecdsa::{Signature, VerifyingKey};
use p256::pkcs8::DecodePublicKey as _;
use sha2::{Digest as _, Sha256};
use std::fmt::Write as _;

/// The longest public key accepted, in base64 characters (a P-256 SPKI is 124).
const MAX_KEY_CHARS: usize = 256;
/// The longest signature accepted, in base64 characters (64 bytes are 88).
const MAX_SIGNATURE_CHARS: usize = 128;

/// What a rider signs to join a game server that sent `challenge` in `welcome`.
pub fn join_message(challenge: &str) -> String {
    format!("openradlr-join\n{challenge}")
}

/// What a rider signs to link their key to the signed-in account.
pub fn link_message(challenge: &str) -> String {
    format!("openradlr-link\n{challenge}")
}

/// Why a rider key or signature was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyError {
    /// Not base64 SPKI of a P-256 public key.
    BadKey,
    /// Not base64 of a 64-byte `r‖s` signature.
    BadSignature,
    /// Well formed, but not made by this key over this message.
    Mismatch,
}

/// Parses a rider's public key (base64 SPKI).
pub fn parse_key(public_key: &str) -> Result<VerifyingKey, KeyError> {
    if public_key.len() > MAX_KEY_CHARS {
        return Err(KeyError::BadKey);
    }
    let der = STANDARD.decode(public_key).map_err(|_| KeyError::BadKey)?;
    VerifyingKey::from_public_key_der(&der).map_err(|_| KeyError::BadKey)
}

/// Checks that `signature` was made by `public_key` over `message`.
pub fn verify(public_key: &str, message: &str, signature: &str) -> Result<(), KeyError> {
    let key = parse_key(public_key)?;
    if signature.len() > MAX_SIGNATURE_CHARS {
        return Err(KeyError::BadSignature);
    }
    let bytes = STANDARD.decode(signature).map_err(|_| KeyError::BadSignature)?;
    let signature = Signature::from_slice(&bytes).map_err(|_| KeyError::BadSignature)?;
    key.verify(message.as_bytes(), &signature)
        .map_err(|_| KeyError::Mismatch)
}

/// A rider's id at the account service: the first 32 hex digits of SHA-256 over
/// the decoded SPKI. `None` if the key doesn't parse.
pub fn rider_id(public_key: &str) -> Option<String> {
    parse_key(public_key).ok()?;
    let der = STANDARD.decode(public_key).ok()?;
    let digest = Sha256::digest(&der);
    Some(digest[..16].iter().fold(String::with_capacity(32), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Made with WebCrypto in node: generateKey(ECDSA P-256), exportKey("spki"),
    // sign(ECDSA SHA-256) over join_message(CHALLENGE).
    const KEY: &str = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2aVICCzovZqdsrfc9Jdz1KhS8saJOLk8J3UkA6Jooo/dagkdURAZWMWmANIuI81NxRQ/G/rOdo1ApRtk/aRkxQ=="; // pragma: allowlist secret (a public test vector)
    const SIGNATURE: &str = "LOqt43v6AZ+yrsvVZ7lqxcz9wLMsccqS5uAZHSEo5BTH5t/wHr8ujzLGjj1PP23hhhOUjHQgo9CPPABi1To8JQ=="; // pragma: allowlist secret (a public test vector)
    const CHALLENGE: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"; // pragma: allowlist secret (a public test vector)

    #[test]
    fn a_webcrypto_signature_over_the_join_message_verifies() {
        assert_eq!(verify(KEY, &join_message(CHALLENGE), SIGNATURE), Ok(()));
    }

    #[test]
    fn a_join_signature_does_not_verify_as_a_link() {
        assert_eq!(
            verify(KEY, &link_message(CHALLENGE), SIGNATURE),
            Err(KeyError::Mismatch)
        );
    }

    #[test]
    fn a_signature_for_another_challenge_does_not_verify() {
        let other = join_message(&CHALLENGE.replace('0', "1"));
        assert_eq!(verify(KEY, &other, SIGNATURE), Err(KeyError::Mismatch));
    }

    #[test]
    fn a_key_that_is_not_spki_is_refused() {
        assert_eq!(verify("bm90IGEga2V5", "x", SIGNATURE), Err(KeyError::BadKey));
    }

    #[test]
    fn a_signature_of_the_wrong_length_is_refused() {
        assert_eq!(verify(KEY, "x", "AAAA"), Err(KeyError::BadSignature));
    }

    #[test]
    fn an_overlong_key_is_refused_before_decoding() {
        assert_eq!(parse_key(&"A".repeat(400)).err(), Some(KeyError::BadKey));
    }

    #[test]
    fn a_rider_id_is_32_hex_digits_and_stable() {
        let id = rider_id(KEY).unwrap();
        assert_eq!(id.len(), 32);
        assert!(id.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(rider_id(KEY), Some(id));
    }

    #[test]
    fn a_bad_key_has_no_rider_id() {
        assert_eq!(rider_id("bm90IGEga2V5"), None);
    }
}
