//! `openradlr-server healthcheck` — a tiny HTTP probe for Docker's
//! `HEALTHCHECK`, so the runtime image needs no curl or wget.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// Returns `true` if `GET /healthz` on `addr` answers with status 200.
pub fn check(addr: SocketAddr) -> bool {
    get(addr, "/healthz").is_some()
}

/// `GET path` on `addr`; the response body if the status is 200.
pub fn get(addr: SocketAddr, path: &str) -> Option<String> {
    let timeout = Duration::from_secs(2);
    let mut stream = TcpStream::connect_timeout(&addr, timeout).ok()?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    if !is_ok_status(&response) {
        return None;
    }
    response.split_once("\r\n\r\n").map(|(_, body)| body.to_string())
}

/// Parses the status line of a raw HTTP response.
pub fn is_ok_status(response: &str) -> bool {
    response.lines().next().and_then(|line| line.split_whitespace().nth(1)) == Some("200")
}

/// Address to probe: the configured bind address, with an unspecified IP
/// (`0.0.0.0`) replaced by loopback.
pub fn probe_addr(bind: SocketAddr) -> SocketAddr {
    if bind.ip().is_unspecified() {
        SocketAddr::from(([127, 0, 0, 1], bind.port()))
    } else {
        bind
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_ok_responses() {
        assert!(is_ok_status("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok"));
        assert!(is_ok_status("HTTP/1.0 200 OK\r\n\r\n"));
        assert!(!is_ok_status("HTTP/1.1 503 Service Unavailable\r\n\r\n"));
        assert!(!is_ok_status(""));
    }

    #[test]
    fn probes_loopback_for_wildcard_binds() {
        assert_eq!(
            probe_addr("0.0.0.0:8080".parse().unwrap()),
            "127.0.0.1:8080".parse().unwrap()
        );
        assert_eq!(
            probe_addr("10.0.0.5:9000".parse().unwrap()),
            "10.0.0.5:9000".parse().unwrap()
        );
    }

    #[test]
    fn unreachable_servers_are_unhealthy() {
        // Port 9 (discard) is essentially never open on loopback in CI.
        assert!(!check("127.0.0.1:9".parse().unwrap()));
    }
}
