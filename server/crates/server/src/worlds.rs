//! The worlds a server hosts: one simulation (and game loop) per map, shared
//! by all its routes (#14), one per route without a map, plus the spin
//! studio. Riders pick a route on the start screen and join its world.

use crate::resume::ResumeTokens;
use crate::route_file::RouteFile;
use crate::runtime::GameHandle;
use crate::studio::STUDIO_ID;
use crate::vehicle_codes::VehicleCodes;
use openradlr_sim::studio::Timetable;
use std::sync::Arc;

pub struct WorldEntry {
    pub file: Arc<RouteFile>,
    pub length_m: f64,
    pub elevation_gain_m: f64,
    /// The game of the route's map (shared with the map's other routes).
    pub game: GameHandle,
}

impl WorldEntry {
    pub fn id(&self) -> &str {
        &self.file.id
    }
}

pub struct StudioEntry {
    /// The studio's classes and clock, for `/api/info` and `/api/studio`
    /// (the game loop keeps its own copy).
    pub timetable: Arc<Timetable>,
    pub game: GameHandle,
}

pub struct Worlds {
    entries: Vec<WorldEntry>,
    studio: Option<StudioEntry>,
    codes: VehicleCodes,
    resume_tokens: ResumeTokens,
}

impl Worlds {
    /// # Panics
    /// If `entries` is empty: a server always hosts at least its default route.
    pub fn new(entries: Vec<WorldEntry>, studio: Option<StudioEntry>) -> Self {
        assert!(!entries.is_empty(), "a server needs at least one route");
        Self {
            entries,
            studio,
            codes: VehicleCodes::new(),
            resume_tokens: ResumeTokens::new(),
        }
    }

    /// Looks resume tokens up in `tokens`, the registry the games fill (#73).
    pub fn with_resume_tokens(mut self, tokens: ResumeTokens) -> Self {
        self.resume_tokens = tokens;
        self
    }

    /// The game holding the rider a resume `token` brings back.
    pub fn resume_game(&self, token: &str) -> Option<&GameHandle> {
        let world_id = self.resume_tokens.world_of(token)?;
        match (&self.studio, world_id.as_str()) {
            (Some(studio), STUDIO_ID) => Some(&studio.game),
            _ => self.get(Some(&world_id)).map(|entry| &entry.game),
        }
    }

    /// Looks vehicle codes up in `codes`, the registry the route games fill.
    pub fn with_vehicle_codes(mut self, codes: VehicleCodes) -> Self {
        self.codes = codes;
        self
    }

    /// The world whose vehicle has `code` (as registered: trimmed, upper
    /// case). The registry holds the id of a route of the vehicle's map, so
    /// this is that route's entry: its game, and a route to join with.
    pub fn vehicle_world(&self, code: &str) -> Option<&WorldEntry> {
        self.get(Some(&self.codes.world_of(code)?))
    }

    /// The world for `id`, or the default world for `None`.
    pub fn get(&self, id: Option<&str>) -> Option<&WorldEntry> {
        match id {
            None => self.entries.first(),
            Some(id) => self.entries.iter().find(|entry| entry.id() == id),
        }
    }

    /// The game a `join` with this `route_id` goes to, and the route to ride
    /// in it: the studio (no route) or a route's map.
    pub fn game(&self, id: Option<&str>) -> Option<(&GameHandle, Option<&str>)> {
        match (&self.studio, id) {
            (Some(studio), Some(STUDIO_ID)) => Some((&studio.game, None)),
            _ => self.get(id).map(|entry| (&entry.game, Some(entry.id()))),
        }
    }

    pub fn studio(&self) -> Option<&StudioEntry> {
        self.studio.as_ref()
    }

    pub fn default_world(&self) -> &WorldEntry {
        &self.entries[0]
    }

    pub fn iter(&self) -> impl Iterator<Item = &WorldEntry> {
        self.entries.iter()
    }

    /// Each game once, however many routes share it.
    pub fn games(&self) -> Vec<&GameHandle> {
        let mut games: Vec<&GameHandle> = Vec::new();
        for entry in &self.entries {
            if !games.iter().any(|game| game.same_game(&entry.game)) {
                games.push(&entry.game);
            }
        }
        games
    }

    /// Human riders with phone paddles across all worlds (the studio has none).
    pub fn phone_count(&self) -> usize {
        self.entries.iter().map(|entry| entry.game.phones_on(entry.id())).sum()
    }

    /// Human riders across all worlds and the studio.
    pub fn player_count(&self) -> usize {
        let studio = self.studio.as_ref().map_or(0, |studio| studio.game.player_count());
        self.entries
            .iter()
            .map(|entry| entry.game.players_on(entry.id()))
            .sum::<usize>()
            + studio
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::{GameCore, GameSettings};
    use crate::route_file::RouteFile;
    use crate::runtime::spawn_game;
    use openradlr_sim::rng::SplitMix64;
    use openradlr_sim::{SimConfig, World};

    fn route_file(id: &str) -> RouteFile {
        RouteFile::parse(&format!(
            r#"{{"id":"{id}","name":"{id}","lanes":2,"seed":1,
                "points":[[0,0,0],[300,0,0],[300,300,0],[0,300,0]]}}"#
        ))
        .unwrap()
    }

    fn world_of(files: &[&RouteFile]) -> (GameHandle, Vec<WorldEntry>) {
        let routes = files.iter().map(|f| f.to_route().unwrap()).collect();
        let world = World::with_network(routes, None, SimConfig::default(), Box::new(SplitMix64::new(1)));
        let game = spawn_game(GameCore::new(world, GameSettings::default()));
        let entries = files
            .iter()
            .map(|f| WorldEntry {
                file: Arc::new((*f).clone()),
                length_m: 1200.0,
                elevation_gain_m: 0.0,
                game: game.clone(),
            })
            .collect();
        (game, entries)
    }

    #[tokio::test]
    async fn codes_find_their_world() {
        let (a1, a2, b) = (route_file("a1"), route_file("a2"), route_file("b"));
        let (game_a, mut entries) = world_of(&[&a1, &a2]);
        let (game_b, entries_b) = world_of(&[&b]);
        entries.extend(entries_b);
        let codes = VehicleCodes::new();
        codes.insert("AAA222", "a1");
        codes.insert("BBB222", "b");
        let worlds = Worlds::new(entries, None).with_vehicle_codes(codes);

        let found = worlds.vehicle_world("AAA222").unwrap();
        assert_eq!(found.id(), "a1");
        assert!(found.game.same_game(&game_a));
        let found = worlds.vehicle_world("BBB222").unwrap();
        assert!(found.game.same_game(&game_b));
        assert!(worlds.vehicle_world("ZZZ222").is_none());
    }

    #[tokio::test]
    async fn resume_tokens_find_their_world() {
        let (a, b) = (route_file("a"), route_file("b"));
        let (_, mut entries) = world_of(&[&a]);
        let (game_b, entries_b) = world_of(&[&b]);
        entries.extend(entries_b);
        let tokens = ResumeTokens::new();
        tokens.insert("t1", "b");
        let worlds = Worlds::new(entries, None).with_resume_tokens(tokens);

        assert!(worlds.resume_game("t1").unwrap().same_game(&game_b));
        assert!(worlds.resume_game("nope").is_none());
    }
}
