//! Composition root: builds the worlds, game loops and router from a [`Config`].

use crate::auth::Strava;
use crate::config::Config;
use crate::events_file::{load_entries, resolve};
use crate::game::{GameCore, GameSettings};
use crate::guard::Slots;
use crate::http::{router, AppState, Protection};
use crate::map_file::load_maps;
use crate::resume::ResumeTokens;
use crate::route_file::{load_routes, RouteFile};
use crate::runtime::spawn_game;
use crate::stats::DistanceStats;
use crate::studio::StudioCore;
use crate::vehicle_codes::VehicleCodes;
use crate::worlds::{StudioEntry, WorldEntry, Worlds};
use crate::ServerInfo;
use axum::Router;
use openradlr_sim::events::Events;
use openradlr_sim::rng::SplitMix64;
use openradlr_sim::studio::{builtin_classes, Studio, StudioConfig, Timetable};
use openradlr_sim::World;
use std::future::Future;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// How often the community totals are written to disk.
const STATS_SAVE_EVERY: Duration = Duration::from_secs(60);

pub type BoxError = Box<dyn std::error::Error + Send + Sync>;

/// Builds the application. Must be called inside a Tokio runtime because it
/// starts one game loop task per route.
pub fn build(config: &Config) -> Result<Router, BoxError> {
    build_with_stats(config).map(|(router, _)| router)
}

/// Like [`build`], and hands back the community totals so the caller can save
/// them on shutdown (they are also saved every minute).
pub fn build_with_stats(config: &Config) -> Result<(Router, DistanceStats), BoxError> {
    let stats = match &config.stats_file {
        Some(path) => {
            let (stats, problem) = DistanceStats::load(path);
            if let Some(problem) = problem {
                tracing::warn!("distance totals start from zero: {problem}");
            }
            let totals = stats.snapshot();
            tracing::info!(
                file = %path.display(),
                trainer_km = (totals.trainer_m / 1000.0).round(),
                paddle_km = (totals.paddle_m / 1000.0).round(),
                "distance totals loaded"
            );
            let (saved, path) = (stats.clone(), path.clone());
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(STATS_SAVE_EVERY);
                loop {
                    interval.tick().await;
                    if let Err(e) = saved.save(&path) {
                        tracing::warn!("cannot save distance totals to {}: {e}", path.display());
                    }
                }
            });
            stats
        }
        None => DistanceStats::default(),
    };
    let (files, warnings) = load_routes(&config.route_file, config.routes_dir.as_deref())?;
    for warning in &warnings {
        tracing::warn!("{warning}");
    }
    // Road networks live in `maps/` next to the route files.
    let maps_dir = config
        .routes_dir
        .clone()
        .or_else(|| config.route_file.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default()
        .join("maps");
    let (maps, warnings) = load_maps(&maps_dir);
    for warning in &warnings {
        tracing::warn!("{warning}");
    }
    if !maps.is_empty() {
        tracing::info!(count = maps.len(), dir = %maps_dir.display(), "road networks loaded");
    }

    let seed = config.bot_seed.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
    });

    // One world per map, shared by its routes (#14); a route without a map is a world of its own.
    let mut groups: Vec<(Option<String>, Vec<RouteFile>)> = Vec::new();
    for file in files {
        let map = file.map.as_ref().map(|m| m.id.clone());
        match groups.iter_mut().find(|(id, _)| map.is_some() && *id == map) {
            Some((_, group)) => group.push(file),
            None => groups.push((map, vec![file])),
        }
    }
    let settings = GameSettings {
        tick_hz: config.tick_hz,
        broadcast_hz: config.broadcast_hz,
        max_players: config.max_players + config.max_paddle_players,
        max_visible_riders: config.max_visible_riders,
        grace_s: config.grace_s,
        ..GameSettings::default()
    };
    // Scheduled events are validated against all routes, then dealt out to the worlds.
    let route_list: Vec<(String, String, f64)> = groups
        .iter()
        .flat_map(|(_, group)| group)
        .map(|file| {
            file.to_route()
                .map(|route| (file.id.clone(), file.name.clone(), route.length()))
        })
        .collect::<Result<_, _>>()?;
    let world_routes: Vec<Vec<String>> = groups
        .iter()
        .map(|(_, group)| group.iter().map(|f| f.id.clone()).collect())
        .collect();
    let event_entries = load_entries(&config.events, &route_list, &world_routes, config.event_lobby_s)?;
    // One registry for all route games: a code typed into the wrong world can point to the right one.
    let vehicle_codes = VehicleCodes::new();
    // One registry for every game: a resume token finds its rider's world (#73).
    let resume_tokens = ResumeTokens::new();
    let mut entries = Vec::new();
    for (index, (map, group)) in groups.into_iter().enumerate() {
        let routes = group.iter().map(RouteFile::to_route).collect::<Result<Vec<_>, _>>()?;
        // Different bots in every world, still reproducible with a fixed seed.
        let world_seed = seed.wrapping_add((index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
        // With the map's road network riders can turn at its junctions (#15).
        let network = map.as_deref().and_then(|id| maps.network(id)).map(|n| (*n).clone());
        let turns = network.is_some();
        let mut world = World::with_network(
            routes.clone(),
            network,
            config.sim_config(),
            Box::new(SplitMix64::new(world_seed)),
        );
        // Boarding codes guard private vehicles: never from the logged, seedable sim RNG.
        world.set_code_source(Box::new(crate::secure_random::OsRandom));
        let route_ids: Vec<String> = group.iter().map(|f| f.id.clone()).collect();
        let defs = resolve(&event_entries, &route_ids, config.event_lobby_s)?;
        let game = spawn_game(
            GameCore::new(world, settings)
                .with_events(Events::new(defs), unix_now_s)
                .with_stats(stats.clone())
                // The map's first route stands for the world: a route id clients can rejoin with.
                .with_vehicle_codes(vehicle_codes.clone(), route_ids[0].clone())
                .with_resume_tokens(resume_tokens.clone()),
        );
        tracing::info!(
            map = map.as_deref().unwrap_or("-"),
            routes = %group.iter().map(|f| f.id.as_str()).collect::<Vec<_>>().join(", "),
            seed = world_seed,
            target_riders = config.target_riders,
            turns,
            "world created"
        );
        for (file, route) in group.into_iter().zip(routes) {
            entries.push(WorldEntry {
                length_m: route.length(),
                elevation_gain_m: file.elevation_gain_m(),
                file: Arc::new(file),
                game: game.clone(),
            });
        }
    }
    // The default route (loaded first) stays first: its map's group comes first.
    let studio = config.studio.then(|| {
        let studio = Studio::new(
            Timetable::new(builtin_classes()),
            StudioConfig {
                target_riders: config.target_riders,
                ..StudioConfig::default()
            },
            Box::new(SplitMix64::new(seed ^ 0x5157_1D10)),
            unix_now_s(),
        );
        let game = spawn_game(
            StudioCore::new(
                studio,
                GameSettings {
                    tick_hz: config.tick_hz,
                    broadcast_hz: config.broadcast_hz,
                    max_players: config.max_players + config.max_paddle_players,
                    max_visible_riders: config.max_visible_riders,
                    grace_s: config.grace_s,
                    ..GameSettings::default()
                },
            )
            .with_wall_clock(unix_now_s)
            .with_stats(stats.clone())
            .with_resume_tokens(resume_tokens.clone()),
        );
        tracing::info!("spin studio opened");
        StudioEntry {
            timetable: Arc::new(Timetable::new(builtin_classes())),
            game,
        }
    });
    let worlds = Worlds::new(entries, studio)
        .with_vehicle_codes(vehicle_codes)
        .with_resume_tokens(resume_tokens);

    let info = Arc::new(ServerInfo {
        name: config.server_name.clone(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        build: crate::BuildInfo::from_env(),
        auth_mode: config.auth_mode.as_str().to_owned(),
        route_id: worlds.default_world().id().to_owned(),
        allow_simulated_trainer: config.allow_simulated_trainer,
        allow_paddle_mode: config.allow_paddle_mode,
        analytics: config.analytics.clone(),
        privacy_url: config.privacy_url.clone(),
        grace_s: config.grace_s,
    });

    let strava = match &config.strava {
        Some(strava_config) => {
            let secure = config
                .public_url
                .as_deref()
                .is_some_and(|url| url.starts_with("https://"));
            tracing::info!(required = config.require_strava, "strava connection enabled");
            if config.require_strava && config.allowed_origins.is_empty() {
                tracing::warn!(
                    "OPENRADLR_REQUIRE_STRAVA without OPENRADLR_ALLOWED_ORIGINS: other sites could open game \
                     connections with a rider's session cookie; set OPENRADLR_ALLOWED_ORIGINS to your public URL"
                );
            }
            let store = match (&config.data_dir, &config.secret_key) {
                (Some(dir), Some(key)) => Some(crate::session_store::SessionStore::open(dir, key)?),
                _ => {
                    tracing::warn!(
                        "OPENRADLR_DATA_DIR and OPENRADLR_SECRET_KEY are not both set: Strava logins are lost when \
                         the server restarts"
                    );
                    None
                }
            };
            Some(Arc::new(Strava::new(
                strava_config.clone(),
                config.require_strava,
                secure,
                store,
            )?))
        }
        None => None,
    };

    let state = AppState {
        worlds: Arc::new(worlds),
        maps: Arc::new(maps),
        info,
        max_players: config.max_players,
        max_paddle_players: config.max_paddle_players,
        protection: Arc::new(Protection {
            seats: Slots::new(config.max_players),
            paddle_seats: Slots::new(config.max_paddle_players),
            per_ip: Slots::new(config.max_connections_per_ip),
            trust_proxy: config.trust_proxy,
            allowed_origins: config.allowed_origins.clone(),
            limits: config.connection_limits(),
        }),
        strava,
        allow_simulated_trainer: config.allow_simulated_trainer,
        allow_paddle_mode: config.allow_paddle_mode,
        stats: stats.clone(),
    };
    let headers = crate::headers::security_headers(config.analytics.as_ref(), config.public_url.as_deref());
    Ok((router(state, config.static_dir.as_deref(), &headers), stats))
}

pub fn unix_now_s() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// Builds the application and serves it until `shutdown` resolves.
pub async fn run(config: Config, shutdown: impl Future<Output = ()> + Send + 'static) -> Result<(), BoxError> {
    let (app, stats) = build_with_stats(&config)?;
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    tracing::info!(
        addr = %listener.local_addr()?,
        max_players = config.max_players,
        max_paddle_players = config.max_paddle_players,
        trust_proxy = config.trust_proxy,
        version = env!("CARGO_PKG_VERSION"),
        build = %crate::BuildInfo::from_env().sha,
        "listening"
    );
    // Connection info gives the client address for the per-IP limit.
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown)
        .await?;
    if let Some(path) = &config.stats_file {
        match stats.save(path) {
            Ok(()) => tracing::info!("distance totals saved"),
            Err(e) => tracing::warn!("cannot save distance totals to {}: {e}", path.display()),
        }
    }
    tracing::info!("server stopped");
    Ok(())
}
