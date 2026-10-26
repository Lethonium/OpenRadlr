//! Scheduled events from configuration: the built-in timetable, an optional
//! events file, and validation. Entries are plain data; [`resolve`] turns the
//! ones on a world's routes into simulation [`EventDef`]s.

use crate::config::{ConfigError, EventsSetting};
use openradlr_sim::events::{EventDef, EventKind, EventLength};
use openradlr_sim::schedule::Schedule;
use serde::Deserialize;

const KEY: &str = "OPENRADLR_EVENTS";
const HOUR_S: f64 = 3600.0;
const GROUP_RIDE_DURATION_S: f64 = 2700.0;
const GROUP_RIDE_DISTANCE_M: f64 = 18_000.0;
const RACE_DURATION_S: f64 = 1500.0;
const RACE_TARGET_M: f64 = 12_000.0;
/// The built-in race starts 20 minutes past the hour.
const RACE_OFFSET_S: f64 = 1200.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    Race,
    GroupRide,
}

/// One repeating event as written in the events file.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventEntry {
    pub id: String,
    pub name: String,
    pub kind: EntryKind,
    pub route_id: String,
    pub laps: Option<u32>,
    pub distance_m: Option<f64>,
    pub every_s: f64,
    #[serde(default)]
    pub offset_s: f64,
    /// Falls back to `OPENRADLR_EVENT_LOBBY_S`.
    pub lobby_s: Option<f64>,
    pub duration_s: f64,
}

fn error(value: impl Into<String>, reason: impl Into<String>) -> ConfigError {
    ConfigError {
        key: KEY,
        value: value.into(),
        reason: reason.into(),
    }
}

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// The default timetable for one world whose routes are `routes` (id, name, length in m):
/// a group ride every hour, and a race every two hours on the next hour's route.
pub fn builtin_events(routes: &[(String, String, f64)], lobby_s: f64) -> Vec<EventEntry> {
    let n = routes.len();
    let group_ride = |i: usize, every_s: f64, offset_s: f64| {
        let (id, name, _) = &routes[i];
        EventEntry {
            id: format!("group-ride-{id}"),
            name: format!("Group ride · {name}"),
            kind: EntryKind::GroupRide,
            route_id: id.clone(),
            laps: None,
            distance_m: Some(GROUP_RIDE_DISTANCE_M),
            every_s,
            offset_s,
            lobby_s: Some(lobby_s),
            duration_s: GROUP_RIDE_DURATION_S,
        }
    };
    let race = |j: usize, every_s: f64, offset_s: f64| {
        let (id, name, length_m) = &routes[j];
        let laps = if *length_m > 0.0 {
            (RACE_TARGET_M / length_m).round().max(1.0) as u32
        } else {
            1
        };
        EventEntry {
            id: format!("race-{id}"),
            name: format!("Race · {name}"),
            kind: EntryKind::Race,
            route_id: id.clone(),
            laps: Some(laps),
            distance_m: None,
            every_s,
            offset_s,
            lobby_s: Some(lobby_s),
            duration_s: RACE_DURATION_S,
        }
    };
    match n {
        0 => Vec::new(),
        1 => vec![group_ride(0, 2.0 * HOUR_S, HOUR_S), race(0, 2.0 * HOUR_S, 0.0)],
        _ => {
            let mut entries: Vec<EventEntry> = (0..n)
                .map(|i| group_ride(i, n as f64 * HOUR_S, i as f64 * HOUR_S))
                .collect();
            let period_h = (n as u64 * 2) / gcd(n as u64, 2);
            for j in 0..n {
                // The first even hour whose next hour's group ride is on route j.
                if let Some(h) = (0..period_h).step_by(2).find(|h| (h + 1) % n as u64 == j as u64) {
                    entries.push(race(j, period_h as f64 * HOUR_S, h as f64 * HOUR_S + RACE_OFFSET_S));
                }
            }
            entries
        }
    }
}

/// Parses the JSON events file: an array of [`EventEntry`].
pub fn parse_entries(text: &str) -> Result<Vec<EventEntry>, ConfigError> {
    serde_json::from_str(text).map_err(|e| {
        error(
            text.chars().take(40).collect::<String>(),
            format!("not a valid events file: {e}"),
        )
    })
}

/// The entries to run: built-ins per world (`Default`), the file's (`File`) or
/// none (`Off`), validated. `routes` lists every route (id, name, length in m)
/// and `worlds` the route ids of each world.
pub fn load_entries(
    setting: &EventsSetting,
    routes: &[(String, String, f64)],
    worlds: &[Vec<String>],
    lobby_s: f64,
) -> Result<Vec<EventEntry>, ConfigError> {
    let entries = match setting {
        EventsSetting::Off => return Ok(Vec::new()),
        EventsSetting::Default => worlds
            .iter()
            .flat_map(|world| {
                let in_world: Vec<(String, String, f64)> = world
                    .iter()
                    .filter_map(|id| routes.iter().find(|r| &r.0 == id).cloned())
                    .collect();
                builtin_events(&in_world, lobby_s)
            })
            .collect(),
        EventsSetting::File(path) => {
            let text = std::fs::read_to_string(path)
                .map_err(|e| error(path.display().to_string(), format!("cannot read the events file: {e}")))?;
            parse_entries(&text).map_err(|mut e| {
                e.value = path.display().to_string();
                e
            })?
        }
    };
    let ids: Vec<String> = routes.iter().map(|r| r.0.clone()).collect();
    validate(&entries, &ids, lobby_s)?;
    Ok(entries)
}

fn schedule_of(entry: &EventEntry, lobby_s: f64) -> Schedule {
    Schedule::Every {
        every_s: entry.every_s,
        offset_s: entry.offset_s,
        lobby_s: entry.lobby_s.unwrap_or(lobby_s),
        duration_s: entry.duration_s,
    }
}

/// Checks the entries against the known routes and each other. `lobby_s` is the
/// default for entries without their own.
pub fn validate(entries: &[EventEntry], all_route_ids: &[String], lobby_s: f64) -> Result<(), ConfigError> {
    for (i, entry) in entries.iter().enumerate() {
        let id = &entry.id;
        if entries[..i].iter().any(|other| other.id == *id) {
            return Err(error(id.clone(), "duplicate event id"));
        }
        if !all_route_ids.contains(&entry.route_id) {
            return Err(error(
                id.clone(),
                format!("event {id:?} is on unknown route {:?}", entry.route_id),
            ));
        }
        match (entry.laps, entry.distance_m) {
            (Some(_), Some(_)) => {
                return Err(error(
                    id.clone(),
                    format!("event {id:?} has both laps and distance_m; give one"),
                ))
            }
            (None, None) => return Err(error(id.clone(), format!("event {id:?} needs laps or distance_m"))),
            (Some(0), None) => return Err(error(id.clone(), format!("event {id:?} has zero laps"))),
            (None, Some(d)) if !(d.is_finite() && d > 0.0) => {
                return Err(error(id.clone(), format!("event {id:?} needs a distance_m above zero")))
            }
            _ => {}
        }
        let positive = |v: f64| v.is_finite() && v > 0.0;
        if !positive(entry.every_s) {
            return Err(error(id.clone(), format!("event {id:?} needs every_s above zero")));
        }
        if !positive(entry.duration_s) {
            return Err(error(id.clone(), format!("event {id:?} needs duration_s above zero")));
        }
        let effective_lobby_s = entry.lobby_s.unwrap_or(lobby_s);
        if entry.kind == EntryKind::Race && effective_lobby_s <= 0.0 {
            return Err(error(
                id.clone(),
                format!("race {id:?} needs a lobby_s above zero (a race cannot be joined once it runs)"),
            ));
        }
        if !entry.offset_s.is_finite() || entry.lobby_s.is_some_and(|l| !(l.is_finite() && l >= 0.0)) {
            return Err(error(
                id.clone(),
                format!("event {id:?} has an invalid offset_s or lobby_s"),
            ));
        }
    }
    for (i, a) in entries.iter().enumerate() {
        for b in &entries[i + 1..] {
            if a.route_id == b.route_id && schedule_of(a, lobby_s).overlaps(&schedule_of(b, lobby_s)) {
                return Err(error(
                    format!("{}, {}", a.id, b.id),
                    format!("events {:?} and {:?} overlap on route {:?}", a.id, b.id, a.route_id),
                ));
            }
        }
    }
    Ok(())
}

/// The definitions of the entries on this world's routes; a route's index in
/// `world_routes` is its [`RouteIndex`](openradlr_sim::world::RouteIndex).
pub fn resolve(entries: &[EventEntry], world_routes: &[String], lobby_s: f64) -> Result<Vec<EventDef>, ConfigError> {
    let mut defs = Vec::new();
    for entry in entries {
        let Some(route) = world_routes.iter().position(|r| *r == entry.route_id) else {
            continue;
        };
        let length = match (entry.laps, entry.distance_m) {
            (Some(laps), None) => EventLength::Laps(laps),
            (None, Some(distance)) => EventLength::Distance(distance),
            _ => {
                return Err(error(
                    entry.id.clone(),
                    format!("event {:?} needs exactly one of laps and distance_m", entry.id),
                ))
            }
        };
        defs.push(EventDef {
            id: entry.id.clone(),
            name: entry.name.clone(),
            kind: match entry.kind {
                EntryKind::Race => EventKind::Race,
                EntryKind::GroupRide => EventKind::GroupRide,
            },
            route,
            length,
            schedule: schedule_of(entry, lobby_s),
        });
    }
    Ok(defs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn routes(n: usize) -> Vec<(String, String, f64)> {
        (0..n)
            .map(|i| (format!("r{i}"), format!("Route {i}"), 4000.0 + i as f64 * 1000.0))
            .collect()
    }

    fn ids(n: usize) -> Vec<String> {
        routes(n).into_iter().map(|r| r.0).collect()
    }

    fn entry(id: &str, route: &str, every_s: f64, offset_s: f64) -> EventEntry {
        EventEntry {
            id: id.into(),
            name: id.into(),
            kind: EntryKind::GroupRide,
            route_id: route.into(),
            laps: None,
            distance_m: Some(1000.0),
            every_s,
            offset_s,
            lobby_s: None,
            duration_s: 600.0,
        }
    }

    /// Start times (seconds) of every occurrence within 12 hours, by entry.
    fn starts(entry: &EventEntry) -> Vec<f64> {
        (0..200)
            .map(|k| k as f64 * entry.every_s + entry.offset_s)
            .filter(|s| *s < 12.0 * HOUR_S)
            .collect()
    }

    #[test]
    fn builtins_never_overlap() {
        for n in 1..=4 {
            let entries = builtin_events(&routes(n), 600.0);
            validate(&entries, &ids(n), 600.0).unwrap_or_else(|e| panic!("n = {n}: {e}"));
            for hour in 0..12 {
                let at_hour = |e: &&EventEntry| starts(e).iter().any(|s| (*s - hour as f64 * HOUR_S).abs() < 1.0);
                let group_rides = entries
                    .iter()
                    .filter(|e| e.kind == EntryKind::GroupRide)
                    .filter(at_hour)
                    .count();
                let races = entries
                    .iter()
                    .filter(|e| e.kind == EntryKind::Race)
                    .filter(at_hour)
                    .count();
                if n == 1 {
                    assert_eq!(group_rides + races, 1, "n = 1, hour {hour}");
                } else {
                    assert_eq!(group_rides, 1, "n = {n}, hour {hour}");
                }
            }
        }
    }

    #[test]
    fn race_avoids_the_group_ride_route() {
        let entries = builtin_events(&routes(3), 600.0);
        for h in (0..12).step_by(2) {
            let at = |kind: EntryKind, offset: f64| {
                entries
                    .iter()
                    .find(|e| {
                        e.kind == kind
                            && starts(e)
                                .iter()
                                .any(|s| (*s - (h as f64 * HOUR_S + offset)).abs() < 1.0)
                    })
                    .map(|e| e.route_id.clone())
            };
            let race = at(EntryKind::Race, RACE_OFFSET_S).unwrap_or_else(|| panic!("no race at hour {h}"));
            let ride = at(EntryKind::GroupRide, 0.0).unwrap();
            assert_ne!(race, ride, "hour {h}");
            // The race is on the route of the next hour's group ride.
            assert_eq!(Some(race), at(EntryKind::GroupRide, HOUR_S), "hour {h}");
        }
    }

    #[test]
    fn builtin_names_ids_and_laps() {
        let entries = builtin_events(&routes(2), 600.0);
        assert!(entries
            .iter()
            .any(|e| e.id == "group-ride-r0" && e.name == "Group ride · Route 0"));
        let race = entries.iter().find(|e| e.id == "race-r1").unwrap();
        assert_eq!(race.name, "Race · Route 1");
        assert_eq!(race.laps, Some(2)); // 12000 / 5000
        assert_eq!(race.offset_s, 1200.0); // h = 0: (0 + 1) mod 2 == 1
                                           // With an even number of routes only every second route gets a race.
        assert!(entries.iter().all(|e| e.id != "race-r0"));
        let entries = builtin_events(&routes(3), 600.0);
        let race0 = entries.iter().find(|e| e.id == "race-r0").unwrap();
        assert_eq!(race0.offset_s, 2.0 * HOUR_S + 1200.0); // h = 2: (2 + 1) mod 3 == 0
        assert_eq!(race0.every_s, 6.0 * HOUR_S);
        assert_eq!(race0.laps, Some(3)); // 12000 / 4000
        assert!(builtin_events(&[], 600.0).is_empty());
    }

    #[test]
    fn file_entries_validate() {
        let valid = |entries: Vec<EventEntry>| validate(&entries, &ids(2), 600.0);
        assert!(valid(vec![entry("a", "r0", 3600.0, 0.0)]).is_ok());

        let err = valid(vec![entry("a", "nowhere", 3600.0, 0.0)]).unwrap_err();
        assert!(err.reason.contains("nowhere") && err.value == "a", "{err}");

        let mut both = entry("both", "r0", 3600.0, 0.0);
        both.laps = Some(2);
        assert!(valid(vec![both]).unwrap_err().reason.contains("both"));

        let mut neither = entry("neither", "r0", 3600.0, 0.0);
        neither.distance_m = None;
        assert!(valid(vec![neither]).is_err());

        let mut zero = entry("zero", "r0", 3600.0, 0.0);
        zero.duration_s = 0.0;
        assert!(valid(vec![zero]).is_err());
        assert!(valid(vec![entry("slow", "r0", 0.0, 0.0)]).is_err());

        let err = valid(vec![entry("a", "r0", 3600.0, 0.0), entry("a", "r1", 3600.0, 0.0)]).unwrap_err();
        assert!(err.reason.contains("duplicate"));

        let err = valid(vec![entry("one", "r0", 3600.0, 0.0), entry("two", "r0", 3600.0, 300.0)]).unwrap_err();
        assert!(err.reason.contains("one") && err.reason.contains("two"), "{err}");
        // The same times on different routes are fine.
        assert!(valid(vec![entry("one", "r0", 3600.0, 0.0), entry("two", "r1", 3600.0, 0.0)]).is_ok());
    }

    #[test]
    fn file_parsing_and_setting() {
        let text = r#"[{"id":"x","name":"X","kind":"race","route_id":"r0","laps":2,"every_s":3600,"duration_s":900}]"#;
        let entries = parse_entries(text).unwrap();
        assert_eq!(entries[0].kind, EntryKind::Race);
        assert_eq!(entries[0].offset_s, 0.0);
        assert!(parse_entries(r#"[{"id":"x","bogus":1}]"#).is_err());

        let dir = std::env::temp_dir().join(format!("openradlr-events-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("events.json");
        std::fs::write(&path, text).unwrap();
        let worlds = vec![ids(2)];
        let loaded = load_entries(&EventsSetting::File(path), &routes(2), &worlds, 600.0).unwrap();
        assert_eq!(loaded.len(), 1);

        let err = load_entries(
            &EventsSetting::File(PathBuf::from("/no/such/events.json")),
            &routes(2),
            &worlds,
            600.0,
        )
        .unwrap_err();
        assert!(err.value.contains("/no/such/events.json"));
        assert!(load_entries(&EventsSetting::Off, &routes(2), &worlds, 600.0)
            .unwrap()
            .is_empty());
        let default = load_entries(&EventsSetting::Default, &routes(2), &worlds, 600.0).unwrap();
        assert_eq!(default.len(), 3); // two group rides, one race
    }

    #[test]
    fn lobby_default_applies() {
        let mut with_own = entry("own", "r0", 3600.0, 0.0);
        with_own.lobby_s = Some(60.0);
        let entries = vec![entry("plain", "r0", 7200.0, 3600.0), with_own];
        let defs = resolve(&entries, &ids(1), 450.0).unwrap();
        let lobby = |d: &EventDef| match d.schedule {
            Schedule::Every { lobby_s, .. } => lobby_s,
            Schedule::Once { lobby_s, .. } => lobby_s,
        };
        assert_eq!(lobby(&defs[0]), 450.0);
        assert_eq!(lobby(&defs[1]), 60.0);
        assert_eq!(defs[0].length, EventLength::Distance(1000.0));
    }

    #[test]
    fn races_need_a_lobby() {
        let mut race = entry("race", "r0", 7200.0, 0.0);
        race.kind = EntryKind::Race;
        race.laps = Some(1);
        race.distance_m = None;
        // The default lobby applies when the entry has none.
        let err = validate(&[race.clone()], &ids(1), 0.0).unwrap_err();
        assert!(err.reason.contains("lobby_s"), "{}", err.reason);
        assert!(validate(&[race.clone()], &ids(1), 600.0).is_ok());
        race.lobby_s = Some(0.0);
        assert!(validate(&[race], &ids(1), 600.0).is_err());
        // Group rides can be joined while running, so a zero lobby is fine.
        let mut ride = entry("ride", "r0", 3600.0, 0.0);
        ride.lobby_s = Some(0.0);
        assert!(validate(&[ride], &ids(1), 600.0).is_ok());
    }

    #[test]
    fn resolve_keeps_only_this_worlds_routes() {
        let entries = vec![entry("a", "r0", 3600.0, 0.0), entry("b", "r2", 3600.0, 0.0)];
        let defs = resolve(&entries, &["r1".to_owned(), "r2".to_owned()], 600.0).unwrap();
        assert_eq!(defs.len(), 1);
        assert_eq!((defs[0].id.as_str(), defs[0].route), ("b", 1));
    }
}
