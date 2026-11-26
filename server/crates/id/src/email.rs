//! Email addresses and sign-in codes.
//!
//! A code is never stored: only its HMAC under the server's secret, bound to the
//! address, so a leaked database gives no codes and a code works for one address.

use hmac::{KeyInit as _, Mac as _};
use sha2::Sha256;

type HmacSha256 = hmac::Hmac<Sha256>;

/// The longest address accepted (RFC 5321's path limit).
const MAX_EMAIL: usize = 254;

/// The address in the form it is stored and compared: trimmed, lowercase. `None`
/// if it can't be an address (one `@` with text on both sides and a dot in the
/// domain, no spaces or control characters).
pub fn normalize(email: &str) -> Option<String> {
    let email = email.trim().to_lowercase();
    let (local, domain) = email.split_once('@')?;
    let plausible = email.len() <= MAX_EMAIL
        && !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains('@')
        && !email.chars().any(|c| c.is_whitespace() || c.is_control());
    plausible.then_some(email)
}

/// The stored form of `code` for `email`.
pub fn code_mac(secret: &[u8], email: &str, code: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC takes keys of any length");
    mac.update(email.as_bytes());
    mac.update(b"\n");
    mac.update(code.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// Whether `code` matches the stored `expected` for `email`, in constant time.
pub fn code_matches(secret: &[u8], email: &str, code: &str, expected: &[u8]) -> bool {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC takes keys of any length");
    mac.update(email.as_bytes());
    mac.update(b"\n");
    mac.update(code.trim().as_bytes());
    mac.verify_slice(expected).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_are_trimmed_and_lowercased() {
        assert_eq!(normalize("  Anna@Example.ORG "), Some("anna@example.org".into()));
    }

    #[test]
    fn things_that_are_not_addresses_are_refused() {
        for bad in [
            "",
            "anna",
            "@example.org",
            "anna@",
            "anna@example",
            "anna@.org",
            "a b@example.org",
            "a@b@c.org",
        ] {
            assert_eq!(normalize(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn an_overlong_address_is_refused() {
        assert_eq!(normalize(&format!("{}@example.org", "a".repeat(250))), None);
    }

    #[test]
    fn a_code_matches_only_for_its_address() {
        let mac = code_mac(b"secret", "anna@example.org", "123456");
        assert!(code_matches(b"secret", "anna@example.org", "123456", &mac));
        assert!(code_matches(b"secret", "anna@example.org", " 123456 ", &mac));
        assert!(!code_matches(b"secret", "bert@example.org", "123456", &mac));
        assert!(!code_matches(b"secret", "anna@example.org", "123457", &mac));
        assert!(!code_matches(b"other", "anna@example.org", "123456", &mac));
    }
}
