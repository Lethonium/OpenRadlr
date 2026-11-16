//! Aggregate request counts by app platform and release; no request or rider records.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

// User agents are untrusted: a client must not create unbounded metric labels.
const MAX_RELEASES: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Release {
    client: &'static str,
    version: String,
    build: String,
}

impl Release {
    fn browser() -> Self {
        Self {
            client: "browser",
            version: String::new(),
            build: String::new(),
        }
    }

    fn parse(agent: &str) -> Option<Self> {
        let (prefix, suffix) = agent.split_once("OpenRadlr/")?;
        if !prefix.is_empty() && !prefix.ends_with(char::is_whitespace) {
            return None;
        }
        let (version, suffix) = suffix.split_once(" (")?;
        let (platform, build) = suffix.trim_end().strip_suffix(')')?.split_once("; build/")?;
        let client = match platform {
            "android" => "android",
            "ios" => "ios",
            _ => return None,
        };
        if version.is_empty()
            || !version.as_bytes()[0].is_ascii_digit()
            || version.len() > 32
            || !version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
            || build.is_empty()
            || build.len() > 10
            || !build.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        Some(Self {
            client,
            version: version.into(),
            build: build.into(),
        })
    }
}

/// Shared only inside one server process; counts requests, not people or devices.
#[derive(Clone, Default)]
pub struct ClientRequests(Arc<Mutex<BTreeMap<Release, u64>>>);

impl ClientRequests {
    pub fn record(&self, user_agent: Option<&str>) {
        let mut release = user_agent.and_then(Release::parse).unwrap_or_else(Release::browser);
        let mut counts = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if release.client != "browser"
            && !counts.contains_key(&release)
            && counts
                .keys()
                .filter(|r| r.client != "browser" && r.version != "other")
                .count()
                >= MAX_RELEASES
        {
            release.version = "other".into();
            release.build = "other".into();
        }
        let count = counts.entry(release).or_default();
        *count = count.saturating_add(1);
    }

    pub fn metrics(&self) -> String {
        use std::fmt::Write;
        let counts = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let mut output = String::from("# HELP openradlr_client_requests_total HTTP requests by client platform and app release since server start, excluding health and metrics probes.\n# TYPE openradlr_client_requests_total counter\n");
        for (release, count) in counts.iter() {
            // The parser permits only label-safe ASCII; the full user agent is never kept.
            writeln!(
                output,
                "openradlr_client_requests_total{{client=\"{}\",app_version=\"{}\",app_build=\"{}\"}} {}",
                release.client, release.version, release.build, count
            )
            .expect("write to String");
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::ClientRequests;

    #[test]
    fn requests_from_the_same_app_release_share_one_counter() {
        let stats = ClientRequests::default();
        stats.record(Some("Mozilla/5.0 OpenRadlr/0.1.0 (android; build/3)"));
        stats.record(Some("A different WebView OpenRadlr/0.1.0 (android; build/3)"));
        assert!(stats
            .metrics()
            .contains("client=\"android\",app_version=\"0.1.0\",app_build=\"3\"} 2\n"));
    }

    #[test]
    fn ios_and_android_are_separate_release_counters() {
        let stats = ClientRequests::default();
        stats.record(Some("Mozilla/5.0 OpenRadlr/1.0 (ios; build/1)"));
        stats.record(Some("Mozilla/5.0 OpenRadlr/1.0 (android; build/1)"));
        assert!(stats
            .metrics()
            .contains("client=\"ios\",app_version=\"1.0\",app_build=\"1\"} 1\n"));
        assert!(stats
            .metrics()
            .contains("client=\"android\",app_version=\"1.0\",app_build=\"1\"} 1\n"));
    }

    #[test]
    fn unmarked_and_malformed_requests_do_not_create_app_labels() {
        let stats = ClientRequests::default();
        for agent in [
            None,
            Some("Mozilla/5.0 (Android; wv)"),
            Some("NotOpenRadlr/0.1.0 (android; build/3)"),
            Some("OpenRadlr/evil\"label (android; build/3)"),
            Some("OpenRadlr/0.1.0 (android; build/not-a-number)"),
            Some("OpenRadlr/other (android; build/1)"),
        ] {
            stats.record(agent);
        }
        assert!(stats
            .metrics()
            .contains("client=\"browser\",app_version=\"\",app_build=\"\"} 6\n"));
        assert!(!stats.metrics().contains("evil"));
        assert!(!stats.metrics().contains("Mozilla"));
    }

    #[test]
    fn release_cardinality_is_bounded_even_for_valid_forged_versions() {
        let stats = ClientRequests::default();
        for build in 1..=1000 {
            stats.record(Some(&format!("OpenRadlr/0.1.0 (android; build/{build})")));
        }
        let metrics = stats.metrics();
        let rows: Vec<_> = metrics.lines().filter(|line| !line.starts_with('#')).collect();
        assert_eq!(rows.len(), 33);
        assert!(metrics.contains("client=\"android\",app_version=\"other\",app_build=\"other\"} 968\n"));
    }
}
