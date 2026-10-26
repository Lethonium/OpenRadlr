//! Security headers for every response, so a server is hardened without the
//! bundled Caddy too: no MIME sniffing, no framing, no referrer, and a
//! Content-Security-Policy that only allows the server's own scripts (plus
//! the analytics script's origin when the operator enabled analytics).

use crate::config::Analytics;
use axum::http::header::{self, HeaderName};

/// The origin (`scheme://host[:port]`) of an absolute URL.
fn origin_of(url: &str) -> Option<&str> {
    let (scheme, rest) = url.split_once("://")?;
    let host_len = rest.find('/').unwrap_or(rest.len());
    (!scheme.is_empty() && host_len > 0).then(|| &url[..scheme.len() + 3 + host_len])
}

/// The Content-Security-Policy for the browser client.
pub fn content_security_policy(analytics: Option<&Analytics>, public_url: Option<&str>) -> String {
    let analytics_origin = analytics.and_then(|a| origin_of(&a.script));
    let mut script = vec!["'self'"];
    // 'self' covers same-origin WebSockets in current browsers; the public
    // address's ws(s) origin is spelled out for older ones.
    let mut connect = vec!["'self'".to_owned()];
    if let Some(socket) = public_url.and_then(origin_of).and_then(|origin| {
        origin
            .strip_prefix("https://")
            .map(|host| format!("wss://{host}"))
            .or_else(|| origin.strip_prefix("http://").map(|host| format!("ws://{host}")))
    }) {
        connect.push(socket);
    }
    if let Some(origin) = analytics_origin {
        script.push(origin);
        connect.push(origin.to_owned());
    }
    [
        "default-src 'self'".to_owned(),
        format!("script-src {}", script.join(" ")),
        format!("connect-src {}", connect.join(" ")),
        "img-src 'self' data: blob:".to_owned(),
        "style-src 'self'".to_owned(),
        "worker-src 'self'".to_owned(),
        "object-src 'none'".to_owned(),
        "base-uri 'self'".to_owned(),
        "form-action 'self'".to_owned(),
        "frame-ancestors 'none'".to_owned(),
    ]
    .join("; ")
}

/// Headers set on every response (unless a handler set them already).
pub fn security_headers(analytics: Option<&Analytics>, public_url: Option<&str>) -> Vec<(HeaderName, String)> {
    vec![
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
        (header::X_FRAME_OPTIONS, "DENY".to_owned()),
        (header::REFERRER_POLICY, "no-referrer".to_owned()),
        (
            header::CONTENT_SECURITY_POLICY,
            content_security_policy(analytics, public_url),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directive<'a>(csp: &'a str, name: &str) -> &'a str {
        csp.split("; ")
            .find(|d| d.starts_with(&format!("{name} ")))
            .unwrap_or_else(|| panic!("no {name} in {csp}"))
    }

    #[test]
    fn only_own_scripts_without_analytics() {
        let csp = content_security_policy(None, None);
        assert_eq!(directive(&csp, "script-src"), "script-src 'self'");
        assert_eq!(directive(&csp, "connect-src"), "connect-src 'self'");
        assert_eq!(directive(&csp, "frame-ancestors"), "frame-ancestors 'none'");
        assert_eq!(directive(&csp, "object-src"), "object-src 'none'");
    }

    #[test]
    fn analytics_add_their_origin_for_the_script_and_its_events() {
        let analytics = Analytics {
            domain: "ride.example.org".into(),
            script: "https://stats.example.org:8443/js/script.js".into(),
        };
        let csp = content_security_policy(Some(&analytics), None);
        assert_eq!(
            directive(&csp, "script-src"),
            "script-src 'self' https://stats.example.org:8443"
        );
        assert_eq!(
            directive(&csp, "connect-src"),
            "connect-src 'self' https://stats.example.org:8443"
        );
    }

    #[test]
    fn the_public_address_allows_its_websocket() {
        let csp = content_security_policy(None, Some("https://ride.example.org"));
        assert_eq!(
            directive(&csp, "connect-src"),
            "connect-src 'self' wss://ride.example.org"
        );
        let csp = content_security_policy(None, Some("http://192.168.1.5:8080"));
        assert_eq!(
            directive(&csp, "connect-src"),
            "connect-src 'self' ws://192.168.1.5:8080"
        );
    }

    #[test]
    fn every_response_is_hardened() {
        let headers = security_headers(None, None);
        let get = |name: HeaderName| headers.iter().find(|(n, _)| *n == name).map(|(_, v)| v.as_str());
        assert_eq!(get(header::X_CONTENT_TYPE_OPTIONS), Some("nosniff"));
        assert_eq!(get(header::X_FRAME_OPTIONS), Some("DENY"));
        assert_eq!(get(header::REFERRER_POLICY), Some("no-referrer"));
        assert!(get(header::CONTENT_SECURITY_POLICY).is_some());
    }
}
