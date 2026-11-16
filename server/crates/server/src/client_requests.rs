//! Aggregate start-menu loads by app platform and release; no request or rider records.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub const DEFAULT_RELEASES: &str = "android/0.1.0/3,ios/1.0/1";
const MAX_RELEASES: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Platform {
    Android,
    Ios,
}

impl Platform {
    fn label(self) -> &'static str {
        match self {
            Self::Android => "android",
            Self::Ios => "ios",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Release {
    platform: Platform,
    version: String,
    build: String,
}

impl Release {
    fn new(platform: &str, version: &str, build: &str) -> Option<Self> {
        let platform = match platform {
            "android" => Platform::Android,
            "ios" => Platform::Ios,
            _ => return None,
        };
        if version.is_empty()
            || !version.as_bytes()[0].is_ascii_digit()
            || version.len() > 32
            || !version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
            || build.is_empty()
            || build.len() > 32
            || !build
                .split('.')
                .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
            || (platform == Platform::Android && build.contains('.'))
        {
            return None;
        }
        Some(Self {
            platform,
            version: version.into(),
            build: build.into(),
        })
    }

    fn parse(agent: &str) -> Option<Self> {
        let (prefix, suffix) = agent.split_once("OpenRadlr/")?;
        if !prefix.is_empty() && !prefix.ends_with(char::is_whitespace) {
            return None;
        }
        let (version, suffix) = suffix.split_once(" (")?;
        let (marker, trailing) = suffix.split_once(')')?;
        if !trailing.is_empty() && !trailing.starts_with(char::is_whitespace) {
            return None;
        }
        let (platform, build) = marker.split_once("; build/")?;
        Self::new(platform, version, build)
    }
}

#[derive(Default)]
struct Counters {
    browser: AtomicU64,
    android_other: AtomicU64,
    ios_other: AtomicU64,
    releases: BTreeMap<Release, AtomicU64>,
}

/// Shared only inside one server process; counts menu loads, not people or devices.
#[derive(Clone)]
pub struct ClientRequests(Arc<Counters>);

impl Default for ClientRequests {
    fn default() -> Self {
        Self::with_releases(DEFAULT_RELEASES).expect("built-in app releases are valid")
    }
}

impl ClientRequests {
    /// Only operator-approved releases get labels. User agents never allocate slots.
    pub fn with_releases(releases: &str) -> Result<Self, &'static str> {
        let mut counters = Counters::default();
        for entry in releases.split(',').filter(|s| !s.trim().is_empty()) {
            let parts: Vec<_> = entry.trim().split('/').collect();
            let release = match parts.as_slice() {
                [platform, version, build] => Release::new(platform, version, build),
                _ => None,
            }
            .ok_or("must be comma-separated platform/version/build entries (android or ios)")?;
            counters.releases.entry(release).or_default();
            if counters.releases.len() > MAX_RELEASES {
                return Err("must contain at most 32 distinct app releases");
            }
        }
        Ok(Self(Arc::new(counters)))
    }

    pub fn record(&self, user_agent: Option<&str>) {
        let counter = match user_agent.and_then(Release::parse) {
            None => &self.0.browser,
            Some(release) => self.0.releases.get(&release).unwrap_or(match release.platform {
                Platform::Android => &self.0.android_other,
                Platform::Ios => &self.0.ios_other,
            }),
        };
        counter.fetch_add(1, Ordering::Relaxed);
    }

    pub fn metrics(&self) -> String {
        use std::fmt::Write;
        let mut output = String::from("# HELP openradlr_client_requests_total Successful GET /api/info responses by client platform and app release since server start; not unique users or sessions.\n# TYPE openradlr_client_requests_total counter\n");
        let mut row = |client, version: &str, build: &str, count: &AtomicU64| {
            let count = count.load(Ordering::Relaxed);
            if count > 0 {
                // Only validated label-safe release facts are retained, never the user agent.
                writeln!(output, "openradlr_client_requests_total{{client=\"{client}\",app_version=\"{version}\",app_build=\"{build}\"}} {count}")
                    .expect("write to String");
            }
        };
        row("browser", "", "", &self.0.browser);
        row("android", "other", "other", &self.0.android_other);
        row("ios", "other", "other", &self.0.ios_other);
        for (release, count) in &self.0.releases {
            row(release.platform.label(), &release.version, &release.build, count);
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::ClientRequests;

    #[test]
    fn invalid_or_oversized_release_allowlists_are_rejected() {
        for invalid in [
            "bad",
            "desktop/1/1",
            "ios/1/1..3",
            "android/1/1.2",
            "ios/1/unsafe\"label",
        ] {
            assert!(ClientRequests::with_releases(invalid).is_err(), "{invalid}");
        }
        let too_many = (1..=33).map(|n| format!("android/1/{n}")).collect::<Vec<_>>().join(",");
        assert!(ClientRequests::with_releases(&too_many).is_err());
    }

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
        let stats = ClientRequests::with_releases("ios/1.0/1,android/1.0/1").unwrap();
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
    fn app_marker_can_precede_an_oem_suffix() {
        let stats = ClientRequests::default();
        stats.record(Some("Mozilla/5.0 OpenRadlr/0.1.0 (android; build/3) OEM/42"));
        assert!(stats
            .metrics()
            .contains("client=\"android\",app_version=\"0.1.0\",app_build=\"3\"} 1\n"));
    }

    #[test]
    fn forged_releases_cannot_displace_a_known_release() {
        let stats = ClientRequests::default();
        for build in 10..1000 {
            stats.record(Some(&format!("OpenRadlr/9.9.9 (android; build/{build})")));
        }
        stats.record(Some("OpenRadlr/0.1.0 (android; build/3)"));
        assert!(stats
            .metrics()
            .contains("client=\"android\",app_version=\"0.1.0\",app_build=\"3\"} 1\n"));
    }

    #[test]
    fn dotted_ios_builds_are_classified_as_app_requests() {
        let stats = ClientRequests::with_releases("ios/1.0/1.0.3").unwrap();
        stats.record(Some("OpenRadlr/1.0 (ios; build/1.0.3)"));
        assert!(stats
            .metrics()
            .contains("client=\"ios\",app_version=\"1.0\",app_build=\"1.0.3\"} 1\n"));
        assert!(!stats.metrics().contains("client=\"browser\""));
    }

    #[test]
    fn release_cardinality_is_bounded_even_for_valid_forged_versions() {
        let stats = ClientRequests::default();
        for build in 1..=1000 {
            stats.record(Some(&format!("OpenRadlr/0.1.0 (android; build/{build})")));
        }
        let metrics = stats.metrics();
        let rows: Vec<_> = metrics.lines().filter(|line| !line.starts_with('#')).collect();
        assert_eq!(rows.len(), 2);
        assert!(metrics.contains("client=\"android\",app_version=\"other\",app_build=\"other\"} 999\n"));
    }
}
