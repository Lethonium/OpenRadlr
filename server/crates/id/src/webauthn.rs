//! Passkeys: the two WebAuthn checks the service needs, ES256 only.
//!
//! The client sends what the browser returned, base64url: `clientDataJSON`,
//! the authenticator data and, on registration, the public key as SPKI from
//! `AuthenticatorAttestationResponse.getPublicKey()`, so no CBOR is parsed.
//! Attestation is `none`: the service trusts no authenticator vendor, it only
//! checks that the same key signs later.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use p256::ecdsa::signature::Verifier as _;
use p256::ecdsa::{Signature, VerifyingKey};
use p256::pkcs8::DecodePublicKey as _;
use serde::Deserialize;
use sha2::{Digest as _, Sha256};

/// User present.
const FLAG_UP: u8 = 0x01;
/// User verified (PIN, fingerprint, face).
const FLAG_UV: u8 = 0x04;
/// Attested credential data follows (registration).
const FLAG_AT: u8 = 0x40;
/// rpIdHash (32) + flags (1) + signCount (4).
const AUTH_DATA_MIN: usize = 37;
/// The longest credential id WebAuthn allows.
const MAX_CREDENTIAL_ID: usize = 1023;

/// What the relying party expects of every ceremony.
pub struct Expected<'a> {
    pub challenge: &'a str,
    /// The page's origin, e.g. `https://app.openradlr.com`.
    pub origin: &'a str,
    /// The RP ID, the origin's host, e.g. `app.openradlr.com`.
    pub rp_id: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasskeyError {
    /// Not base64url, not JSON, too short or otherwise malformed.
    Malformed,
    /// The wrong ceremony, challenge, origin or RP.
    WrongContext,
    /// The user was not present or not verified.
    NotVerified,
    /// Not an ES256 key, or a key the credential id doesn't name.
    BadKey,
    /// The signature doesn't verify.
    BadSignature,
    /// The signature counter went backwards: possibly a cloned authenticator.
    CounterRegressed,
}

/// A passkey as the service stores it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credential {
    /// base64url, as the browser reports it.
    pub id: String,
    /// SPKI DER of the P-256 public key.
    pub public_key: Vec<u8>,
    pub sign_count: u32,
}

#[derive(Deserialize)]
struct ClientData {
    #[serde(rename = "type")]
    kind: String,
    challenge: String,
    origin: String,
}

pub fn decode(value: &str) -> Result<Vec<u8>, PasskeyError> {
    URL_SAFE_NO_PAD
        .decode(value.trim_end_matches('='))
        .map_err(|_| PasskeyError::Malformed)
}

fn check_client_data(client_data_json: &[u8], kind: &str, expected: &Expected) -> Result<(), PasskeyError> {
    let data: ClientData = serde_json::from_slice(client_data_json).map_err(|_| PasskeyError::Malformed)?;
    let right = data.kind == kind
        && data.challenge.trim_end_matches('=') == expected.challenge
        && data.origin == expected.origin;
    right.then_some(()).ok_or(PasskeyError::WrongContext)
}

/// Checks the RP and flags of authenticator data and returns its sign counter.
fn check_auth_data(auth_data: &[u8], expected: &Expected, extra_flag: u8) -> Result<u32, PasskeyError> {
    if auth_data.len() < AUTH_DATA_MIN {
        return Err(PasskeyError::Malformed);
    }
    if auth_data[..32] != Sha256::digest(expected.rp_id.as_bytes())[..] {
        return Err(PasskeyError::WrongContext);
    }
    let flags = auth_data[32];
    if flags & (FLAG_UP | FLAG_UV) != FLAG_UP | FLAG_UV {
        return Err(PasskeyError::NotVerified);
    }
    if flags & extra_flag != extra_flag {
        return Err(PasskeyError::Malformed);
    }
    Ok(u32::from_be_bytes([
        auth_data[33],
        auth_data[34],
        auth_data[35],
        auth_data[36],
    ]))
}

/// Checks a registration (`navigator.credentials.create`) and returns the new credential.
pub fn register(
    expected: &Expected,
    credential_id: &str,
    client_data_json: &str,
    authenticator_data: &str,
    public_key: &str,
) -> Result<Credential, PasskeyError> {
    let id = decode(credential_id)?;
    if id.is_empty() || id.len() > MAX_CREDENTIAL_ID {
        return Err(PasskeyError::Malformed);
    }
    check_client_data(&decode(client_data_json)?, "webauthn.create", expected)?;
    let auth_data = decode(authenticator_data)?;
    let sign_count = check_auth_data(&auth_data, expected, FLAG_AT)?;
    // Attested credential data: AAGUID (16), id length (2), id.
    let id_at = AUTH_DATA_MIN + 16;
    let length = auth_data
        .get(id_at..id_at + 2)
        .map(|b| usize::from(u16::from_be_bytes([b[0], b[1]])))
        .ok_or(PasskeyError::Malformed)?;
    if auth_data.get(id_at + 2..id_at + 2 + length) != Some(&id[..]) {
        return Err(PasskeyError::BadKey);
    }
    let public_key = decode(public_key)?;
    VerifyingKey::from_public_key_der(&public_key).map_err(|_| PasskeyError::BadKey)?;
    Ok(Credential {
        id: URL_SAFE_NO_PAD.encode(&id),
        public_key,
        sign_count,
    })
}

/// Checks a sign-in (`navigator.credentials.get`) with `credential` and returns its new counter.
pub fn authenticate(
    expected: &Expected,
    credential: &Credential,
    client_data_json: &str,
    authenticator_data: &str,
    signature: &str,
) -> Result<u32, PasskeyError> {
    let client_data = decode(client_data_json)?;
    check_client_data(&client_data, "webauthn.get", expected)?;
    let auth_data = decode(authenticator_data)?;
    let sign_count = check_auth_data(&auth_data, expected, 0)?;
    let key = VerifyingKey::from_public_key_der(&credential.public_key).map_err(|_| PasskeyError::BadKey)?;
    let signature = Signature::from_der(&decode(signature)?).map_err(|_| PasskeyError::BadSignature)?;
    let mut signed = auth_data;
    signed.extend_from_slice(&Sha256::digest(&client_data));
    key.verify(&signed, &signature)
        .map_err(|_| PasskeyError::BadSignature)?;
    // Authenticators that keep no counter (most synced passkeys) always send 0.
    if (sign_count != 0 || credential.sign_count != 0) && sign_count <= credential.sign_count {
        return Err(PasskeyError::CounterRegressed);
    }
    Ok(sign_count)
}

#[cfg(test)]
pub(crate) mod soft {
    //! A software authenticator for tests: what a browser and a passkey would send.

    use super::*;
    use p256::ecdsa::signature::Signer as _;
    use p256::ecdsa::SigningKey;
    use p256::pkcs8::EncodePublicKey as _;

    pub struct Authenticator {
        pub key: SigningKey,
        pub id: Vec<u8>,
        pub counter: u32,
        pub flags: u8,
    }

    pub struct Registration {
        pub credential_id: String,
        pub client_data_json: String,
        pub authenticator_data: String,
        pub public_key: String,
    }

    pub struct Assertion {
        pub credential_id: String,
        pub client_data_json: String,
        pub authenticator_data: String,
        pub signature: String,
    }

    pub fn b64(bytes: &[u8]) -> String {
        URL_SAFE_NO_PAD.encode(bytes)
    }

    impl Authenticator {
        pub fn new(seed: u8) -> Self {
            Self {
                key: SigningKey::from_slice(&[seed; 32]).unwrap(),
                id: vec![seed; 16],
                counter: 0,
                flags: FLAG_UP | FLAG_UV,
            }
        }

        fn client_data(kind: &str, challenge: &str, origin: &str) -> Vec<u8> {
            serde_json::json!({"type": kind, "challenge": challenge, "origin": origin, "crossOrigin": false})
                .to_string()
                .into_bytes()
        }

        fn auth_data(&self, rp_id: &str, extra: u8) -> Vec<u8> {
            let mut data = Sha256::digest(rp_id.as_bytes()).to_vec();
            data.push(self.flags | extra);
            data.extend_from_slice(&self.counter.to_be_bytes());
            data
        }

        pub fn register(&self, challenge: &str, origin: &str, rp_id: &str) -> Registration {
            let mut auth_data = self.auth_data(rp_id, FLAG_AT);
            auth_data.extend_from_slice(&[0u8; 16]);
            auth_data.extend_from_slice(&u16::try_from(self.id.len()).unwrap().to_be_bytes());
            auth_data.extend_from_slice(&self.id);
            auth_data.extend_from_slice(b"(COSE key, not parsed)");
            let spki = self.key.verifying_key().to_public_key_der().unwrap();
            Registration {
                credential_id: b64(&self.id),
                client_data_json: b64(&Self::client_data("webauthn.create", challenge, origin)),
                authenticator_data: b64(&auth_data),
                public_key: b64(spki.as_bytes()),
            }
        }

        pub fn assert(&self, challenge: &str, origin: &str, rp_id: &str) -> Assertion {
            let client_data = Self::client_data("webauthn.get", challenge, origin);
            let auth_data = self.auth_data(rp_id, 0);
            let mut signed = auth_data.clone();
            signed.extend_from_slice(&Sha256::digest(&client_data));
            let signature: Signature = self.key.sign(&signed);
            Assertion {
                credential_id: b64(&self.id),
                client_data_json: b64(&client_data),
                authenticator_data: b64(&auth_data),
                signature: b64(signature.to_der().as_bytes()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::soft::{b64, Authenticator};
    use super::*;

    const ORIGIN: &str = "https://app.openradlr.com";
    const RP: &str = "app.openradlr.com";

    fn expected(challenge: &str) -> Expected<'_> {
        Expected {
            challenge,
            origin: ORIGIN,
            rp_id: RP,
        }
    }

    fn registered(authenticator: &Authenticator) -> Credential {
        let r = authenticator.register("c1", ORIGIN, RP);
        register(
            &expected("c1"),
            &r.credential_id,
            &r.client_data_json,
            &r.authenticator_data,
            &r.public_key,
        )
        .unwrap()
    }

    fn sign_in(authenticator: &Authenticator, credential: &Credential, challenge: &str) -> Result<u32, PasskeyError> {
        let a = authenticator.assert(challenge, ORIGIN, RP);
        authenticate(
            &expected("c2"),
            credential,
            &a.client_data_json,
            &a.authenticator_data,
            &a.signature,
        )
    }

    #[test]
    fn a_registered_passkey_signs_in() {
        let authenticator = Authenticator::new(3);
        let credential = registered(&authenticator);
        assert_eq!(credential.id, b64(&[3; 16]));
        assert_eq!(sign_in(&authenticator, &credential, "c2"), Ok(0));
    }

    #[test]
    fn a_registration_for_another_challenge_is_refused() {
        let r = Authenticator::new(3).register("other", ORIGIN, RP);
        let result = register(
            &expected("c1"),
            &r.credential_id,
            &r.client_data_json,
            &r.authenticator_data,
            &r.public_key,
        );
        assert_eq!(result, Err(PasskeyError::WrongContext));
    }

    #[test]
    fn a_registration_from_another_origin_is_refused() {
        let r = Authenticator::new(3).register("c1", "https://evil.example", RP);
        let result = register(
            &expected("c1"),
            &r.credential_id,
            &r.client_data_json,
            &r.authenticator_data,
            &r.public_key,
        );
        assert_eq!(result, Err(PasskeyError::WrongContext));
    }

    #[test]
    fn a_registration_for_another_rp_is_refused() {
        let r = Authenticator::new(3).register("c1", ORIGIN, "evil.example");
        let result = register(
            &expected("c1"),
            &r.credential_id,
            &r.client_data_json,
            &r.authenticator_data,
            &r.public_key,
        );
        assert_eq!(result, Err(PasskeyError::WrongContext));
    }

    #[test]
    fn a_registration_without_user_verification_is_refused() {
        let mut authenticator = Authenticator::new(3);
        authenticator.flags = FLAG_UP;
        let r = authenticator.register("c1", ORIGIN, RP);
        let result = register(
            &expected("c1"),
            &r.credential_id,
            &r.client_data_json,
            &r.authenticator_data,
            &r.public_key,
        );
        assert_eq!(result, Err(PasskeyError::NotVerified));
    }

    #[test]
    fn a_registration_naming_another_credential_is_refused() {
        let r = Authenticator::new(3).register("c1", ORIGIN, RP);
        let result = register(
            &expected("c1"),
            &b64(&[9; 16]),
            &r.client_data_json,
            &r.authenticator_data,
            &r.public_key,
        );
        assert_eq!(result, Err(PasskeyError::BadKey));
    }

    #[test]
    fn a_get_response_does_not_register() {
        let a = Authenticator::new(3).assert("c1", ORIGIN, RP);
        let r = Authenticator::new(3).register("c1", ORIGIN, RP);
        let result = register(
            &expected("c1"),
            &r.credential_id,
            &a.client_data_json,
            &r.authenticator_data,
            &r.public_key,
        );
        assert_eq!(result, Err(PasskeyError::WrongContext));
    }

    #[test]
    fn another_authenticators_signature_is_refused() {
        let credential = registered(&Authenticator::new(3));
        assert_eq!(
            sign_in(&Authenticator::new(4), &credential, "c2"),
            Err(PasskeyError::BadSignature)
        );
    }

    #[test]
    fn a_sign_in_for_an_old_challenge_is_refused() {
        let authenticator = Authenticator::new(3);
        let credential = registered(&authenticator);
        assert_eq!(
            sign_in(&authenticator, &credential, "c1"),
            Err(PasskeyError::WrongContext)
        );
    }

    #[test]
    fn a_counter_has_to_go_up_once_the_authenticator_keeps_one() {
        let mut authenticator = Authenticator::new(3);
        let mut credential = registered(&authenticator);
        authenticator.counter = 5;
        assert_eq!(sign_in(&authenticator, &credential, "c2"), Ok(5));
        credential.sign_count = 5;
        assert_eq!(
            sign_in(&authenticator, &credential, "c2"),
            Err(PasskeyError::CounterRegressed)
        );
    }

    #[test]
    fn garbage_is_malformed() {
        let result = register(&expected("c1"), "!!", "!!", "!!", "!!");
        assert_eq!(result, Err(PasskeyError::Malformed));
    }
}
