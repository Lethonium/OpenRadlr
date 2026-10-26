//! The on-disk route format (JSON) and its conversion into a simulation route.
//!
//! The same JSON is served to clients at `/api/route`, so server and clients
//! always work with the identical route.

use openradlr_sim::route::{Marker, MarkerKind, Point, Route, RouteError, RouteSpec, WalkStep};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RouteFile {
    pub id: String,
    pub name: String,
    /// One line for the route picker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Routes are always ridden as loops in the proof of concept.
    #[serde(rename = "loop", default = "default_true")]
    pub is_loop: bool,
    pub lanes: u8,
    pub seed: u64,
    /// `[x, y, elevation]` in metres.
    pub points: Vec<[f64; 3]>,
    #[serde(default)]
    pub markers: Vec<MarkerFile>,
    /// Scenery zones (village, river, forest, …). Pure decoration for clients:
    /// the server passes them through unchanged and never interprets them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub zones: Vec<ZoneFile>,
    /// The shared map this route belongs to: clients draw all routes with the
    /// same map id as one world (ADR 0010, stage 1). Passed through unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map: Option<MapRef>,
    /// Latitude and longitude of the route's (0, 0), for exports. Passed
    /// through unchanged; routes without it use the world origin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geo: Option<Geo>,
    /// The roads of the map's network the route rides, in route distance
    /// (ADR 0010, #14): where riders of different routes share a road.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub walk: Vec<WalkStepFile>,
}

/// One road of the walk: the route's stretch `from`–`to` rides road `edge`
/// (its own `length`) in direction `dir`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WalkStepFile {
    pub edge: String,
    pub dir: i8,
    pub from: f64,
    pub to: f64,
    pub length: f64,
}

/// Membership in a shared map: its id and the seed for the shared terrain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapRef {
    pub id: String,
    pub seed: u64,
}

/// A place on the globe.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Geo {
    pub lat: f64,
    pub lon: f64,
}

/// A stretch or point of the route with a scenery theme. `kind` is a free
/// string so new zone types need no server change; clients ignore unknown ones.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ZoneFile {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MarkerFile {
    #[serde(rename = "type")]
    pub kind: MarkerType,
    pub distance: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<f64>,
    /// Shown by clients next to the marker (a climb's or sprint's name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkerType {
    StartFinish,
    Sprint,
    Climb,
}

fn default_true() -> bool {
    true
}

#[derive(Debug)]
pub enum RouteFileError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Invalid(RouteError),
}

impl fmt::Display for RouteFileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RouteFileError::Io(e) => write!(f, "could not read route file: {e}"),
            RouteFileError::Json(e) => write!(f, "route file is not valid JSON: {e}"),
            RouteFileError::Invalid(e) => write!(f, "route is invalid: {e}"),
        }
    }
}

impl std::error::Error for RouteFileError {}

impl RouteFile {
    pub fn parse(json: &str) -> Result<Self, RouteFileError> {
        serde_json::from_str(json).map_err(RouteFileError::Json)
    }

    pub fn load(path: &Path) -> Result<Self, RouteFileError> {
        let json = std::fs::read_to_string(path).map_err(RouteFileError::Io)?;
        Self::parse(&json)
    }

    /// Total climbing over one lap in metres, including the closing segment.
    pub fn elevation_gain_m(&self) -> f64 {
        let n = self.points.len();
        (0..n)
            .map(|i| self.points[(i + 1) % n][2] - self.points[i][2])
            .filter(|rise| *rise > 0.0)
            .sum()
    }

    pub fn to_route(&self) -> Result<Route, RouteFileError> {
        let points = self
            .points
            .iter()
            .map(|&[x, y, elevation]| Point::new(x, y, elevation))
            .collect();
        let markers = self
            .markers
            .iter()
            .map(|m| Marker {
                distance: m.distance,
                kind: match m.kind {
                    MarkerType::StartFinish => MarkerKind::StartFinish,
                    MarkerType::Sprint => MarkerKind::Sprint {
                        length: m.length.unwrap_or(200.0),
                    },
                    MarkerType::Climb => MarkerKind::Climb {
                        length: m.length.unwrap_or(500.0),
                    },
                },
            })
            .collect();
        Route::new(RouteSpec {
            id: self.id.clone(),
            name: self.name.clone(),
            lanes: self.lanes,
            seed: self.seed,
            points,
            markers,
            walk: self
                .walk
                .iter()
                .map(|w| WalkStep {
                    edge: w.edge.clone(),
                    dir: w.dir,
                    from: w.from,
                    to: w.to,
                    length: w.length,
                })
                .collect(),
        })
        .map_err(RouteFileError::Invalid)
    }
}

/// Loads the default route plus every other `*.json` route in `dir`, sorted
/// by file name. The default route must be valid; broken or duplicate files
/// in the directory are skipped and reported as warnings, so one bad file
/// never takes a server down.
pub fn load_routes(default: &Path, dir: Option<&Path>) -> Result<(Vec<RouteFile>, Vec<String>), RouteFileError> {
    let first = RouteFile::load(default)?;
    first.to_route()?;
    let mut routes = vec![first];
    let mut warnings = Vec::new();

    let Some(dir) = dir else {
        return Ok((routes, warnings));
    };
    let mut paths: Vec<_> = match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("json"))
            .collect(),
        Err(error) => {
            warnings.push(format!("could not list routes in {}: {error}", dir.display()));
            return Ok((routes, warnings));
        }
    };
    paths.sort();
    for path in paths {
        let file = match RouteFile::load(&path).and_then(|file| file.to_route().map(|_| file)) {
            Ok(file) => file,
            Err(error) => {
                warnings.push(format!("skipping {}: {error}", path.display()));
                continue;
            }
        };
        if routes.iter().any(|known| known.id == file.id) {
            // The default route usually lives in the same directory.
            if !path.ends_with(default.file_name().unwrap_or_default()) {
                warnings.push(format!(
                    "skipping {}: route id {:?} is already used",
                    path.display(),
                    file.id
                ));
            }
            continue;
        }
        routes.push(file);
    }
    Ok((routes, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "id": "test",
        "name": "Test Loop",
        "loop": true,
        "lanes": 4,
        "seed": 7,
        "points": [[0, 0, 100], [500, 0, 110], [500, 500, 100]],
        "markers": [{ "type": "start_finish", "distance": 0 }, { "type": "sprint", "distance": 600, "length": 300 }]
    }"#;

    #[test]
    fn json_parses_and_converts_into_a_route() {
        let file = RouteFile::parse(SAMPLE).unwrap();
        assert_eq!(file.markers[1].kind, MarkerType::Sprint);
        let route = file.to_route().unwrap();
        assert_eq!(route.lanes(), 4);
        assert!(route.length() > 1500.0);
        assert_eq!(route.markers()[1].kind, MarkerKind::Sprint { length: 300.0 });
    }

    #[test]
    fn json_zones_are_passed_through_unchanged() {
        let json = r#"{"id":"z","name":"z","lanes":2,"seed":1,"points":[[0,0,0],[100,0,0]],
            "zones":[{"type":"village","from":10,"to":60},{"type":"river","at":80},{"type":"future_thing","at":5}]}"#;
        let file = RouteFile::parse(json).unwrap();
        assert_eq!(file.zones.len(), 3);
        assert_eq!(file.zones[1].kind, "river");
        let out = serde_json::to_string(&file).unwrap();
        assert!(
            out.contains(r#""zones":[{"type":"village","from":10.0,"to":60.0}"#),
            "{out}"
        );
        assert!(out.contains(r#"{"type":"future_thing","at":5.0}"#));
    }

    #[test]
    fn json_geo_and_marker_names_are_passed_through() {
        let json = r#"{"id":"g","name":"g","lanes":2,"seed":1,"points":[[0,0,0],[100,0,0]],
            "geo":{"lat":38.0,"lon":2.6},"markers":[{"type":"climb","distance":10,"length":50,"name":"Femés"}]}"#;
        let file = RouteFile::parse(json).unwrap();
        assert_eq!(file.geo, Some(Geo { lat: 38.0, lon: 2.6 }));
        let out = serde_json::to_string(&file).unwrap();
        assert!(out.contains(r#""geo":{"lat":38.0,"lon":2.6}"#), "{out}");
        assert!(out.contains(r#""name":"Femés""#), "{out}");
    }

    #[test]
    fn json_routes_without_geo_serialise_without_the_key() {
        let file = RouteFile::parse(r#"{"id":"x","name":"x","lanes":2,"seed":1,"points":[[0,0,0],[9,0,0]]}"#).unwrap();
        let out = serde_json::to_string(&file).unwrap();
        assert!(!out.contains("geo"));
    }

    #[test]
    fn json_routes_without_zones_serialise_without_the_key() {
        let file = RouteFile::parse(r#"{"id":"x","name":"x","lanes":2,"seed":1,"points":[[0,0,0],[9,0,0]]}"#).unwrap();
        let out = serde_json::to_string(&file).unwrap();
        assert!(!out.contains("zones"));
        assert!(!out.contains("map"));
    }

    #[test]
    fn json_map_membership_is_passed_through() {
        let json = r#"{"id":"m","name":"m","lanes":2,"seed":1,"points":[[0,0,0],[100,0,0]],"map":{"id":"valley","seed":2026}}"#;
        let file = RouteFile::parse(json).unwrap();
        assert_eq!(
            file.map,
            Some(MapRef {
                id: "valley".into(),
                seed: 2026
            })
        );
        assert!(serde_json::to_string(&file)
            .unwrap()
            .contains(r#""map":{"id":"valley","seed":2026}"#));
    }

    #[test]
    fn json_walks_become_road_positions() {
        let json = r#"{"id":"w","name":"w","lanes":2,"seed":1,"points":[[0,0,0],[100,0,0]],
            "walk":[{"edge":"out","dir":1,"from":0,"to":100,"length":100},{"edge":"out","dir":-1,"from":100,"to":200,"length":100}]}"#;
        let route = RouteFile::parse(json).unwrap().to_route().unwrap();
        assert_eq!(route.walk()[1].dir, -1);
        assert_eq!(route.edge_at(150.0).map(|at| at.step), Some(1));
        let broken = json.replace(r#""from":100,"to":200"#, r#""from":120,"to":200"#);
        assert!(matches!(
            RouteFile::parse(&broken).unwrap().to_route(),
            Err(RouteFileError::Invalid(RouteError::BrokenWalk))
        ));
    }

    #[test]
    fn json_rejects_garbage() {
        assert!(matches!(RouteFile::parse("{"), Err(RouteFileError::Json(_))));
    }

    #[test]
    fn json_rejects_invalid_geometry() {
        let file = RouteFile::parse(r#"{"id":"x","name":"x","lanes":2,"seed":1,"points":[[0,0,0]]}"#).unwrap();
        assert!(matches!(
            file.to_route(),
            Err(RouteFileError::Invalid(RouteError::TooFewPoints))
        ));
    }

    #[test]
    fn json_bundled_routes_are_valid() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../routes");
        let mut ids = Vec::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let file = RouteFile::load(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            let route = file.to_route().unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            assert!(route.length() > 3000.0, "{} is too short", path.display());
            assert!(!ids.contains(&file.id), "duplicate route id {}", file.id);
            ids.push(file.id);
        }
        assert!(ids.contains(&"rolling-hills".to_owned()));
    }

    #[test]
    fn json_bundled_routes_share_one_map_and_start_at_a_cafe() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../routes");
        let network: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(Path::new(dir).join("maps/valley.json")).unwrap()).unwrap();
        let cafes: Vec<[f64; 2]> = network["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|n| n["kind"] == "cafe")
            .map(|n| [n["x"].as_f64().unwrap(), n["y"].as_f64().unwrap()])
            .collect();
        assert!(cafes.len() >= 3, "the map has at least three cafés");
        for id in [
            "rolling-hills",
            "riverside-flats",
            "col-de-la-forge",
            "balcony-road",
            "forge-circuit",
            "island-tour",
            "cape-loop",
        ] {
            let file = RouteFile::load(&Path::new(dir).join(format!("{id}.json"))).unwrap();
            assert_eq!(file.map.as_ref().map(|m| m.id.as_str()), Some("valley"), "{id}");
            let start = [file.points[0][0], file.points[0][1]];
            assert!(cafes.contains(&start), "{id} starts at a café, not at {start:?}");
            let route = file.to_route().unwrap();
            assert!(!route.walk().is_empty(), "{id} knows the roads it rides");
            assert!(route.edge_at(route.length() - 1.0).is_some());
        }
    }

    fn lanzarote() -> RouteFile {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../routes/lanzarote-lava-180.json");
        RouteFile::load(Path::new(path)).unwrap()
    }

    #[test]
    fn lanzarote_route_loads_with_the_course_figures() {
        let file = lanzarote();
        let route = file.to_route().unwrap();
        assert!((178_200.0..=181_800.0).contains(&route.length()), "{}", route.length());
        assert!(
            (2_375.0..=2_625.0).contains(&file.elevation_gain_m()),
            "{}",
            file.elevation_gain_m()
        );
        assert_eq!(file.geo, Some(Geo { lat: 38.0, lon: 2.6 }));
        assert!(file.map.is_none(), "the island is generated around the route");
    }

    #[test]
    fn a_rider_finishes_the_180_km_lanzarote_loop() {
        use openradlr_sim::rng::SplitMix64;
        use openradlr_sim::{SimConfig, World};
        let route = lanzarote().to_route().unwrap();
        let length = route.length();
        let config = SimConfig {
            target_riders: 0,
            race_countdown_s: 0.0,
            ..SimConfig::default()
        };
        let mut world = World::new(route, config, Box::new(SplitMix64::new(7)));
        let id = world.join_human("Rider", 75.0);
        world.start_race(1, Some(id)).unwrap();
        for _ in 0..(12.0 * 3600.0 / 0.05) as usize {
            world.set_telemetry(id, 300.0, Some(90.0)).unwrap();
            world.tick(0.05);
            if matches!(world.race(0).phase(), openradlr_sim::race::RacePhase::Finished { .. }) {
                break;
            }
        }
        assert!(
            matches!(
                world.race(0).phase(),
                openradlr_sim::race::RacePhase::Finished { laps: 1 }
            ),
            "the rider did not finish {length} m: {:?}",
            world.race(0).phase()
        );
        let results = world.race(0).results();
        assert_eq!(results.len(), 1);
        assert!(
            results[0].time_s > 4.0 * 3600.0 && results[0].time_s < 11.0 * 3600.0,
            "{}",
            results[0].time_s
        );
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("openradlr-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn route_json(id: &str) -> String {
        format!(r#"{{"id":"{id}","name":"{id}","lanes":2,"seed":1,"points":[[0,0,0],[100,0,0],[100,100,0]]}}"#)
    }

    #[test]
    fn load_routes_puts_the_default_first_and_skips_bad_files() {
        let dir = temp_dir("routes");
        std::fs::write(dir.join("b-default.json"), route_json("main")).unwrap();
        std::fs::write(dir.join("a-other.json"), route_json("other")).unwrap();
        std::fs::write(dir.join("c-copy.json"), route_json("other")).unwrap();
        std::fs::write(dir.join("d-broken.json"), "{").unwrap();
        std::fs::write(dir.join("notes.txt"), "ignored").unwrap();

        let (routes, warnings) = load_routes(&dir.join("b-default.json"), Some(&dir)).unwrap();
        let ids: Vec<&str> = routes.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["main", "other"]);
        assert_eq!(warnings.len(), 2, "{warnings:?}");
        assert!(warnings.iter().any(|w| w.contains("c-copy.json")));
        assert!(warnings.iter().any(|w| w.contains("d-broken.json")));

        let (routes, warnings) = load_routes(&dir.join("b-default.json"), None).unwrap();
        assert_eq!(routes.len(), 1);
        assert!(warnings.is_empty());

        let (_, warnings) = load_routes(&dir.join("b-default.json"), Some(&dir.join("missing"))).unwrap();
        assert_eq!(warnings.len(), 1);

        assert!(load_routes(&dir.join("d-broken.json"), Some(&dir)).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn elevation_gain_counts_every_rise_including_the_closing_segment() {
        let file = RouteFile::parse(
            r#"{"id":"x","name":"x","lanes":2,"seed":1,"points":[[0,0,10],[9,0,15],[9,9,12],[0,9,20]]}"#,
        )
        .unwrap();
        // +5, −3, +8, then back to 10: −10.
        assert_eq!(file.elevation_gain_m(), 13.0);
        let flat = RouteFile::parse(r#"{"id":"x","name":"x","lanes":2,"seed":1,"points":[[0,0,0],[9,0,0]]}"#).unwrap();
        assert_eq!(flat.elevation_gain_m(), 0.0);
    }
}
