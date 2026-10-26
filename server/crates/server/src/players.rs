//! `openradlr-server players` — who is riding right now, for the Makefile's
//! guard before `update`, `restart` and `down`. Probes `/api/info` like
//! `healthcheck` does, so the runtime image still needs no curl.

use serde_json::Value;

/// Reads the rider counts from an `/api/info` body.
///
/// Output: the total on the first line, then one `count<TAB>place` line per
/// route or studio with riders on it. `None` if the body is not an info reply.
pub fn summary(info: &str) -> Option<String> {
    let info: Value = serde_json::from_str(info).ok()?;
    let total = info.get("players")?.as_u64()?;
    let mut out = format!("{total}\n");
    let routes = info.get("routes").and_then(Value::as_array).into_iter().flatten();
    let studio = info.get("studio").filter(|studio| studio.is_object());
    for place in routes.chain(studio) {
        let count = place.get("players").and_then(Value::as_u64).unwrap_or(0);
        let name = place
            .get("id")
            .or_else(|| place.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("?");
        if count > 0 {
            out.push_str(&format!("{count}\t{name}\n"));
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_riders_per_place() {
        let info = r#"{"players":3,"routes":[{"id":"rolling-hills","players":2},{"id":"alps","players":0}],
            "studio":{"id":"studio","players":1}}"#;
        assert_eq!(summary(info).unwrap(), "3\n2\trolling-hills\n1\tstudio\n");
    }

    #[test]
    fn empty_server_is_just_zero() {
        assert_eq!(summary(r#"{"players":0,"routes":[],"studio":null}"#).unwrap(), "0\n");
    }

    #[test]
    fn rejects_other_replies() {
        assert!(summary("not json").is_none());
        assert!(summary(r#"{"name":"x"}"#).is_none());
    }
}
