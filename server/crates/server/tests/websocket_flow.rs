//! End-to-end tests: a real server on a random port, a real WebSocket client.

use futures_util::{SinkExt, StreamExt};
use openradlr_server::config::Config;
use openradlr_server::{app, healthcheck};
use serde_json::Value;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

const ROUTES_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../routes");

fn test_config(target_riders: usize) -> Config {
    Config {
        route_file: PathBuf::from(ROUTES_DIR).join("rolling-hills.json"),
        target_riders,
        bot_seed: Some(1),
        // The built-in timetable follows the wall clock and reserves routes
        // for its lobbies; tests that need events bring their own file.
        events: openradlr_server::config::EventsSetting::Off,
        ..Config::default()
    }
}

async fn start_server(target_riders: usize) -> SocketAddr {
    start_server_with(test_config(target_riders)).await
}

async fn start_server_with(config: Config) -> SocketAddr {
    let router = app::build(&config).expect("app builds");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    addr
}

async fn connect(addr: SocketAddr) -> Socket {
    let (socket, _) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("websocket connects");
    socket
}

async fn send(socket: &mut Socket, json: &str) {
    socket.send(Message::text(json)).await.unwrap();
}

/// Reads messages until one of the given type arrives.
async fn expect_type(socket: &mut Socket, wanted: &str) -> Value {
    let deadline = Duration::from_secs(5);
    tokio::time::timeout(deadline, async {
        loop {
            let message = socket.next().await.expect("socket open").expect("valid frame");
            let Message::Text(text) = message else { continue };
            let value: Value = serde_json::from_str(text.as_str()).expect("server sends JSON");
            if value["type"] == wanted {
                return value;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("no {wanted} message within {deadline:?}"))
}

/// Joins a rider on a fresh server with bot seed 1, starts a tandem and returns its boarding code.
async fn first_tandem_code() -> String {
    let addr = start_server(0).await;
    let mut socket = connect(addr).await;
    hello(&mut socket).await;
    send(&mut socket, r#"{"type":"join","name":"Anna","weight_kg":70}"#).await;
    expect_type(&mut socket, "joined").await;
    send(&mut socket, r#"{"type":"create_vehicle","kind":"tandem","bots":false}"#).await;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let state = expect_type(&mut socket, "state").await;
            if let Some(code) = state
                .pointer("/you/vehicle/code")
                .or_else(|| state.pointer("/vehicle/code"))
                .and_then(Value::as_str)
            {
                return code.to_owned();
            }
        }
    })
    .await
    .expect("the captain sees the code")
}

#[tokio::test]
async fn boarding_codes_are_not_predictable_from_the_bot_seed() {
    // Same seed, same world, same moves: only OS randomness tells the codes apart.
    let first = first_tandem_code().await;
    let second = first_tandem_code().await;
    assert_eq!(first.len(), 6);
    assert_ne!(first, second);
}

#[tokio::test]
async fn health_check_answers() {
    let addr = start_server(0).await;
    let probe = tokio::task::spawn_blocking(move || healthcheck::check(addr));
    assert!(probe.await.unwrap());
}

#[tokio::test]
async fn a_client_joins_and_sees_itself_among_bots() {
    let addr = start_server(5).await;
    let mut socket = connect(addr).await;

    send(
        &mut socket,
        r#"{"type":"hello","protocol_version":2,"client_version":"test"}"#,
    )
    .await;
    let welcome = expect_type(&mut socket, "welcome").await;
    assert_eq!(welcome["route_id"], "rolling-hills");

    send(&mut socket, r#"{"type":"join","name":"Anna","weight_kg":70}"#).await;
    let joined = expect_type(&mut socket, "joined").await;
    let my_id = joined["rider_id"].as_u64().unwrap();

    let state = expect_type(&mut socket, "state").await;
    let riders = state["riders"].as_array().unwrap();
    assert!(riders
        .iter()
        .any(|r| r["id"].as_u64() == Some(my_id) && r["is_bot"] == false));
    assert!(riders.iter().any(|r| r["is_bot"] == true));

    let resistance = expect_type(&mut socket, "resistance").await;
    assert!(resistance["grade_percent"].is_number());
}

#[tokio::test]
async fn telemetry_moves_the_rider() {
    let addr = start_server(0).await;
    let mut socket = connect(addr).await;
    send(&mut socket, r#"{"type":"hello","protocol_version":2}"#).await;
    expect_type(&mut socket, "welcome").await;
    send(&mut socket, r#"{"type":"join","name":"Anna","weight_kg":70}"#).await;
    expect_type(&mut socket, "joined").await;

    for _ in 0..12 {
        send(&mut socket, r#"{"type":"telemetry","power":300,"cadence":90}"#).await;
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    // Older snapshots are still queued; the newest ones must show movement.
    let mut fastest: f64 = 0.0;
    for _ in 0..20 {
        let state = expect_type(&mut socket, "state").await;
        fastest = fastest.max(state["riders"][0]["speed"].as_f64().unwrap());
        if fastest > 1.0 {
            break;
        }
    }
    assert!(fastest > 1.0, "rider should be moving, top speed was {fastest}");
}

#[tokio::test]
async fn a_wrong_protocol_version_is_refused() {
    let addr = start_server(0).await;
    let mut socket = connect(addr).await;
    send(&mut socket, r#"{"type":"hello","protocol_version":999}"#).await;
    let error = expect_type(&mut socket, "error").await;
    assert_eq!(error["code"], "protocol_mismatch");
}

/// Minimal HTTP GET without an extra client dependency; returns the body.
async fn http_get(addr: SocketAddr, path: &str) -> (u16, String) {
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    let request = format!("GET {path} HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    let status = response[9..12].parse().unwrap();
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_owned())
        .unwrap_or_default();
    (status, body)
}

async fn hello(socket: &mut Socket) {
    send(socket, r#"{"type":"hello","protocol_version":2}"#).await;
    expect_type(socket, "welcome").await;
}

#[tokio::test]
async fn info_lists_every_route_with_the_default_first() {
    let addr = start_server_with(Config {
        routes_dir: Some(PathBuf::from(ROUTES_DIR)),
        ..test_config(0)
    })
    .await;
    let (status, body) = http_get(addr, "/api/info").await;
    assert_eq!(status, 200);
    let info: Value = serde_json::from_str(&body).unwrap();
    let routes = info["routes"].as_array().unwrap();
    assert!(routes.len() >= 3, "bundled routes: {routes:?}");
    assert_eq!(routes[0]["id"], "rolling-hills");
    assert_eq!(info["route"]["id"], "rolling-hills");
    assert_eq!(info["players"], 0);
    assert!(routes.iter().all(|r| r["length_m"].as_f64().unwrap() > 3000.0));

    let other = routes[1]["id"].as_str().unwrap();
    let (status, body) = http_get(addr, &format!("/api/route?id={other}")).await;
    assert_eq!(status, 200);
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["id"], other);
    assert_eq!(http_get(addr, "/api/route?id=nope").await.0, 404);
    let (_, body) = http_get(addr, "/api/route").await;
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["id"], "rolling-hills");

    // The routes' shared map: its road network, from `maps/` next to them.
    let (status, body) = http_get(addr, "/api/map?id=valley").await;
    assert_eq!(status, 200);
    let network: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(network["id"], "valley");
    assert!(network["edges"].as_array().unwrap().len() >= 6);
    assert_eq!(http_get(addr, "/api/map?id=nope").await.0, 404);
}

#[tokio::test]
async fn riders_join_the_route_they_pick() {
    let addr = start_server_with(Config {
        routes_dir: Some(PathBuf::from(ROUTES_DIR)),
        ..test_config(0)
    })
    .await;
    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    let other = info["routes"][1]["id"].as_str().unwrap().to_owned();

    let mut anna = connect(addr).await;
    hello(&mut anna).await;
    send(
        &mut anna,
        &format!(r#"{{"type":"join","name":"Anna","weight_kg":70,"route_id":"{other}"}}"#),
    )
    .await;
    let anna_id = expect_type(&mut anna, "joined").await["rider_id"].as_u64().unwrap();

    let mut ben = connect(addr).await;
    hello(&mut ben).await;
    send(&mut ben, r#"{"type":"join","name":"Ben","weight_kg":80}"#).await;
    expect_type(&mut ben, "joined").await;
    // Anna rides another route, far away; if it shares Ben's world she is still listed (with her route).
    let state = expect_type(&mut ben, "state").await;
    let seen = state["riders"].as_array().unwrap().iter().find(|r| r["name"] == "Anna");
    if let Some(anna) = seen {
        assert_eq!(anna["route"], other.as_str());
    }

    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(info["players"], 2);
    assert_eq!(info["routes"][1]["players"], 1);
    assert!(anna_id > 0);

    let mut cara = connect(addr).await;
    hello(&mut cara).await;
    send(
        &mut cara,
        r#"{"type":"join","name":"Cara","weight_kg":60,"route_id":"atlantis"}"#,
    )
    .await;
    assert_eq!(expect_type(&mut cara, "error").await["code"], "unknown_route");
}

#[tokio::test]
async fn the_spin_studio_is_listed_with_its_timetable_and_seats_riders() {
    let addr = start_server(4).await;
    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(info["studio"]["id"], "spin-studio");
    let starts = info["studio"]["class"]["starts_at_s"].as_f64().unwrap();
    let next = info["studio"]["next"]["starts_at_s"].as_f64().unwrap();
    assert_eq!(next - starts, 1800.0, "a class every half hour");

    let (status, body) = http_get(addr, "/api/studio").await;
    assert_eq!(status, 200);
    let studio: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(studio["seats_per_room"], 16);
    let classes = studio["classes"].as_array().unwrap();
    assert!(classes.len() >= 4);
    assert!(classes.iter().all(|c| c["duration_s"] == 1500));
    assert_eq!(studio["schedule"][0]["class_id"], info["studio"]["class"]["class_id"]);

    let mut anna = connect(addr).await;
    hello(&mut anna).await;
    send(
        &mut anna,
        r#"{"type":"join","name":"Anna","weight_kg":70,"route_id":"spin-studio","ftp_w":240}"#,
    )
    .await;
    let anna_id = expect_type(&mut anna, "joined").await["rider_id"].clone();
    send(&mut anna, r#"{"type":"telemetry","power":200,"cadence":90}"#).await;
    let state = expect_type(&mut anna, "studio_state").await;
    assert_eq!(state["room"], 0);
    let riders = state["riders"].as_array().unwrap();
    assert_eq!(riders.len(), 4, "bots fill up to the target");
    assert!(riders.iter().any(|r| r["id"] == anna_id && r["seat"] == 3));

    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(info["studio"]["players"], 1);
    assert_eq!(info["players"], 1);
}

#[tokio::test]
async fn servers_can_close_the_studio() {
    let addr = start_server_with(Config {
        studio: false,
        ..test_config(0)
    })
    .await;
    let (_, body) = http_get(addr, "/api/info").await;
    assert!(serde_json::from_str::<Value>(&body).unwrap().get("studio").is_none());
    assert_eq!(http_get(addr, "/api/studio").await.0, 404);
}

#[tokio::test]
async fn the_player_cap_counts_all_worlds() {
    let addr = start_server_with(Config {
        routes_dir: Some(PathBuf::from(ROUTES_DIR)),
        max_players: 1,
        ..test_config(0)
    })
    .await;
    let (_, body) = http_get(addr, "/api/info").await;
    let other = serde_json::from_str::<Value>(&body).unwrap()["routes"][1]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let mut anna = connect(addr).await;
    hello(&mut anna).await;
    send(&mut anna, r#"{"type":"join","name":"Anna","weight_kg":70}"#).await;
    expect_type(&mut anna, "joined").await;

    let mut ben = connect(addr).await;
    hello(&mut ben).await;
    send(
        &mut ben,
        &format!(r#"{{"type":"join","name":"Ben","weight_kg":80,"route_id":"{other}"}}"#),
    )
    .await;
    assert_eq!(expect_type(&mut ben, "error").await["code"], "server_full");

    // The seat is free again once Anna leaves.
    anna.close(None).await.unwrap();
    drop(anna);
    let mut joined = false;
    for _ in 0..20 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        send(
            &mut ben,
            &format!(r#"{{"type":"join","name":"Ben","weight_kg":80,"route_id":"{other}"}}"#),
        )
        .await;
        let reply = expect_any(&mut ben, &["joined", "error"]).await;
        if reply["type"] == "joined" {
            joined = true;
            break;
        }
    }
    assert!(joined, "Ben should get Anna's seat");
}

#[tokio::test]
async fn phone_riders_have_their_own_seats() {
    let addr = start_server_with(Config {
        max_players: 1,
        max_paddle_players: 1,
        ..test_config(0)
    })
    .await;
    let (_, body) = http_get(addr, "/api/info").await;
    let info = serde_json::from_str::<Value>(&body).unwrap();
    assert_eq!(
        (info["max_players"].as_u64(), info["max_phone_players"].as_u64()),
        (Some(1), Some(1))
    );

    // One phone rider fills the phone seats but leaves the trainer seat free.
    let mut phone = connect(addr).await;
    hello(&mut phone).await;
    send(
        &mut phone,
        r#"{"type":"join","name":"Pia","weight_kg":70,"device":"paddle"}"#,
    )
    .await;
    expect_type(&mut phone, "joined").await;

    let mut second_phone = connect(addr).await;
    hello(&mut second_phone).await;
    send(
        &mut second_phone,
        r#"{"type":"join","name":"Pim","weight_kg":70,"device":"paddle"}"#,
    )
    .await;
    assert_eq!(expect_type(&mut second_phone, "error").await["code"], "server_full");

    let mut trainer = connect(addr).await;
    hello(&mut trainer).await;
    send(&mut trainer, r#"{"type":"join","name":"Tom","weight_kg":80}"#).await;
    expect_type(&mut trainer, "joined").await;
}

#[tokio::test]
async fn foreign_origins_are_refused_when_an_allow_list_is_set() {
    let addr = start_server_with(Config {
        allowed_origins: vec!["https://ride.example.com".into()],
        ..test_config(0)
    })
    .await;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut request = format!("ws://{addr}/ws").into_client_request().unwrap();
    request
        .headers_mut()
        .insert("origin", "https://evil.example".parse().unwrap());
    assert!(connect_async(request).await.is_err());

    let mut request = format!("ws://{addr}/ws").into_client_request().unwrap();
    request
        .headers_mut()
        .insert("origin", "https://ride.example.com".parse().unwrap());
    assert!(connect_async(request).await.is_ok());
}

/// Reads messages until one of the given types arrives.
async fn expect_any(socket: &mut Socket, wanted: &[&str]) -> Value {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let message = socket.next().await.expect("socket open").expect("valid frame");
            let Message::Text(text) = message else { continue };
            let value: Value = serde_json::from_str(text.as_str()).expect("server sends JSON");
            if wanted.iter().any(|w| value["type"] == *w) {
                return value;
            }
        }
    })
    .await
    .expect("expected message")
}

#[tokio::test]
async fn static_files_are_revalidated_on_every_load() {
    let config = Config {
        static_dir: Some(PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../client/public"
        ))),
        ..test_config(0)
    };
    let addr = start_server_with(config).await;
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    let request = "GET /styles.css HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n";
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    let head = response.split_once("\r\n\r\n").unwrap().0.to_ascii_lowercase();
    assert!(head.starts_with("http/1.1 200"), "{head}");
    assert!(head.contains("cache-control: no-cache"), "{head}");
}

#[tokio::test]
async fn every_response_carries_security_headers() {
    let config = Config {
        static_dir: Some(PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../client/public"
        ))),
        analytics: Some(openradlr_server::config::Analytics {
            domain: "ride.example.org".into(),
            script: "https://stats.example.org/js/script.js".into(),
        }),
        ..test_config(0)
    };
    let addr = start_server_with(config).await;
    for path in ["/", "/api/info"] {
        let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        let request = format!("GET {path} HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n");
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        let head = response.split_once("\r\n\r\n").unwrap().0.to_ascii_lowercase();
        assert!(head.contains("x-content-type-options: nosniff"), "{path}: {head}");
        assert!(head.contains("x-frame-options: deny"), "{path}: {head}");
        assert!(
            head.contains("script-src 'self' https://stats.example.org;"),
            "{path}: {head}"
        );
    }
}

#[tokio::test]
async fn routes_of_one_map_share_a_world() {
    let addr = start_server_with(Config {
        routes_dir: Some(PathBuf::from(ROUTES_DIR)),
        ..test_config(0)
    })
    .await;
    // Both routes start at the Valley Café, on the same road.
    let mut flats = connect(addr).await;
    hello(&mut flats).await;
    send(
        &mut flats,
        r#"{"type":"join","name":"Flats","weight_kg":70,"route_id":"riverside-flats"}"#,
    )
    .await;
    let flats_id = expect_type(&mut flats, "joined").await["rider_id"].as_u64();

    let mut col = connect(addr).await;
    hello(&mut col).await;
    send(
        &mut col,
        r#"{"type":"join","name":"Col","weight_kg":70,"route_id":"col-de-la-forge"}"#,
    )
    .await;
    expect_type(&mut col, "joined").await;
    let state = expect_type(&mut col, "state").await;
    let other = state["riders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"].as_u64() == flats_id)
        .cloned()
        .expect("the rider of the other route is in view");
    assert_eq!(other["route"], "riverside-flats");
    assert_eq!(other["road"]["edge"], "valley-east");
    assert_eq!(state["route_riders"]["humans"], 1, "one human on my route");

    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(info["players"], 2);
    let players = |id: &str| {
        info["routes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == id)
            .map(|r| r["players"].clone())
    };
    assert_eq!(players("riverside-flats"), Some(Value::from(1)));
    assert_eq!(players("col-de-la-forge"), Some(Value::from(1)));
    assert_eq!(players("rolling-hills"), Some(Value::from(0)));
}

#[tokio::test]
async fn riders_pick_the_road_at_the_next_junction() {
    let addr = start_server_with(Config {
        routes_dir: Some(PathBuf::from(ROUTES_DIR)),
        ..test_config(0)
    })
    .await;
    let mut socket = connect(addr).await;
    hello(&mut socket).await;
    send(
        &mut socket,
        r#"{"type":"join","name":"Col","weight_kg":70,"route_id":"col-de-la-forge"}"#,
    )
    .await;
    let me = expect_type(&mut socket, "joined").await["rider_id"].as_u64();
    let next_road = |state: &Value| {
        state["riders"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"].as_u64() == me)
            .map(|r| r["road"]["next"]["edge"].clone())
    };
    // The col climbs the hill road from the east fork; the flats follow the river.
    let state = expect_type(&mut socket, "state").await;
    assert_eq!(next_road(&state), Some(Value::from("hill-road")));
    send(&mut socket, r#"{"type":"turn","edge":"river-east"}"#).await;
    let mut picked = None;
    for _ in 0..4 {
        picked = next_road(&expect_type(&mut socket, "state").await);
    }
    assert_eq!(picked, Some(Value::from("river-east")));
    // Only roads at the junction ahead can be picked.
    send(&mut socket, r#"{"type":"turn","edge":"forge-west"}"#).await;
    let error = expect_type(&mut socket, "error").await;
    assert_eq!(error["code"], "turn_rejected");
}

#[tokio::test]
async fn info_lists_scheduled_events() {
    let dir = std::env::temp_dir().join(format!("openradlr-events-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("events.json");
    std::fs::write(
        &file,
        r#"[{"id":"ride","name":"Test ride","kind":"group_ride","route_id":"rolling-hills",
            "distance_m":200,"every_s":60,"lobby_s":30,"duration_s":50}]"#,
    )
    .unwrap();
    let config = Config {
        events: openradlr_server::config::EventsSetting::File(file),
        ..test_config(0)
    };
    let addr = start_server_with(config).await;
    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert!(info["now_s"].as_f64().unwrap() > 1.0e9);
    let events = info["events"].as_array().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["id"], "ride");
    assert_eq!(events[0]["kind"], "group_ride");
    assert_eq!(events[0]["route_id"], "rolling-hills");
    assert!(["upcoming", "lobby", "running"].contains(&events[0]["phase"].as_str().unwrap()));
    assert!(events[0]["starts_at_s"].as_f64().unwrap() > 1.0e9);
}

#[tokio::test]
async fn servers_can_turn_phone_paddles_off() {
    let addr = start_server_with(Config {
        allow_paddle_mode: false,
        ..test_config(0)
    })
    .await;
    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(info["paddle_mode"], false);

    let mut socket = connect(addr).await;
    hello(&mut socket).await;
    send(
        &mut socket,
        r#"{"type":"join","name":"Anna","weight_kg":70,"device":"paddle"}"#,
    )
    .await;
    let error = expect_type(&mut socket, "error").await;
    assert_eq!(error["code"], "device_not_allowed");
}

#[tokio::test]
async fn info_links_the_privacy_policy_when_set() {
    let addr = start_server(0).await;
    let (_, body) = http_get(addr, "/api/info").await;
    assert!(serde_json::from_str::<Value>(&body)
        .unwrap()
        .get("privacy_url")
        .is_none());

    let addr = start_server_with(Config {
        privacy_url: Some("https://example.org/privacy/".into()),
        ..test_config(0)
    })
    .await;
    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(info["privacy_url"], "https://example.org/privacy/");
}

#[tokio::test]
async fn info_has_no_analytics_by_default() {
    let addr = start_server(0).await;
    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert!(info.get("analytics").is_none());
}

#[tokio::test]
async fn info_tells_the_client_which_analytics_to_load() {
    let addr = start_server_with(Config {
        analytics: Some(openradlr_server::config::Analytics {
            domain: "ride.example.org".into(),
            script: "https://plausible.io/js/script.js".into(),
        }),
        ..test_config(0)
    })
    .await;
    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(info["analytics"]["domain"], "ride.example.org");
    assert_eq!(info["analytics"]["script"], "https://plausible.io/js/script.js");
}

#[tokio::test]
async fn phone_paddlers_are_marked_for_everyone() {
    let addr = start_server(0).await;
    let (_, body) = http_get(addr, "/api/info").await;
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["paddle_mode"], true);

    let mut anna = connect(addr).await;
    hello(&mut anna).await;
    send(
        &mut anna,
        r#"{"type":"join","name":"Anna","weight_kg":70,"device":"paddle"}"#,
    )
    .await;
    let anna_id = expect_type(&mut anna, "joined").await["rider_id"].clone();

    let mut ben = connect(addr).await;
    hello(&mut ben).await;
    send(&mut ben, r#"{"type":"join","name":"Ben","weight_kg":70}"#).await;
    expect_type(&mut ben, "joined").await;
    // The first snapshot can predate the device; a later one carries it.
    for _ in 0..10 {
        let state = expect_type(&mut ben, "state").await;
        let riders = state["riders"].as_array().unwrap();
        if let Some(rider) = riders.iter().find(|r| r["id"] == anna_id) {
            if rider["device"] == "paddle" {
                return;
            }
        }
    }
    panic!("Anna never showed up as a paddler");
}

#[tokio::test]
async fn info_reports_distance_ridden_by_trainers_and_paddlers_across_restarts() {
    use openradlr_server::protocol::DeviceKind;
    use openradlr_server::stats::DistanceStats;

    let path = std::env::temp_dir()
        .join(format!("openradlr-stats-flow-{}", std::process::id()))
        .join("stats.json");
    let before = DistanceStats::default();
    before.add(DeviceKind::Trainer, 12_345_678.0);
    before.add(DeviceKind::Paddle, 678_000.0);
    before.save(&path).unwrap();

    let addr = start_server_with(Config {
        stats_file: Some(path),
        ..test_config(3)
    })
    .await;
    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(info["distance_m"]["trainer"], 12_345_678.0);
    assert_eq!(info["distance_m"]["paddle"], 678_000.0);

    // A paddler pedals: only the paddle total grows, the bots add nothing.
    let mut socket = connect(addr).await;
    send(&mut socket, r#"{"type":"hello","protocol_version":2}"#).await;
    expect_type(&mut socket, "welcome").await;
    send(
        &mut socket,
        r#"{"type":"join","name":"Anna","weight_kg":70,"device":"paddle"}"#,
    )
    .await;
    expect_type(&mut socket, "joined").await;
    for _ in 0..12 {
        send(&mut socket, r#"{"type":"telemetry","power":300,"cadence":90}"#).await;
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let (_, body) = http_get(addr, "/api/info").await;
    let info: Value = serde_json::from_str(&body).unwrap();
    assert!(info["distance_m"]["paddle"].as_f64().unwrap() > 678_000.0 + 5.0);
    assert_eq!(info["distance_m"]["trainer"], 12_345_678.0);
}

async fn join_as(socket: &mut Socket, join: &str) -> (u64, String) {
    hello(socket).await;
    send(socket, join).await;
    let joined = expect_type(socket, "joined").await;
    (
        joined["rider_id"].as_u64().unwrap(),
        joined["resume_token"].as_str().unwrap().to_owned(),
    )
}

#[tokio::test]
async fn dropped_socket_resumes_the_same_rider() {
    let addr = start_server(0).await;
    let mut first = connect(addr).await;
    let (rider, token) = join_as(&mut first, r#"{"type":"join","name":"Anna","weight_kg":70}"#).await;
    assert_eq!(token.len(), 64);
    drop(first);

    let mut second = connect(addr).await;
    let join = format!(r#"{{"type":"join","name":"Anna","weight_kg":70,"resume_token":"{token}"}}"#);
    let (again, same_token) = join_as(&mut second, &join).await;
    assert_eq!(again, rider);
    assert_eq!(same_token, token);
    expect_type(&mut second, "state").await;
}

#[tokio::test]
async fn leave_frees_the_rider_at_once() {
    let addr = start_server(0).await;
    let mut first = connect(addr).await;
    let (rider, token) = join_as(&mut first, r#"{"type":"join","name":"Anna","weight_kg":70}"#).await;
    send(&mut first, r#"{"type":"leave"}"#).await;
    // The server closes the connection once the rider has left.
    tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(Ok(message)) = first.next().await {
            if matches!(message, Message::Close(_)) {
                break;
            }
        }
    })
    .await
    .expect("the server closes the connection");

    let mut second = connect(addr).await;
    let join = format!(r#"{{"type":"join","name":"Anna","weight_kg":70,"resume_token":"{token}"}}"#);
    let (again, _) = join_as(&mut second, &join).await;
    assert_ne!(again, rider);
}

#[tokio::test]
async fn resume_position_starts_there() {
    let addr = start_server(0).await;
    let mut socket = connect(addr).await;
    let (rider, _) = join_as(
        &mut socket,
        r#"{"type":"join","name":"Anna","weight_kg":70,"resume":{"route_id":"rolling-hills","distance_m":1500}}"#,
    )
    .await;
    let state = expect_type(&mut socket, "state").await;
    let me = state["riders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"].as_u64() == Some(rider))
        .expect("my rider")
        .clone();
    let distance = me["distance"].as_f64().unwrap();
    assert!((distance - 1500.0).abs() < 1.0, "{distance}");
}

/// Reads states until my rider's `parked` flag matches `wanted`.
async fn wait_for_parked(socket: &mut Socket, my_id: u64, wanted: bool) {
    for _ in 0..60 {
        let state = expect_type(socket, "state").await;
        let me = state["riders"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"].as_u64() == Some(my_id))
            .expect("I am in the state");
        if (me["parked"] == true) == wanted {
            return;
        }
    }
    panic!("parked never became {wanted}");
}

#[tokio::test]
async fn a_rider_pauses_and_resumes() {
    let addr = start_server(0).await;
    let mut socket = connect(addr).await;
    send(&mut socket, r#"{"type":"hello","protocol_version":2}"#).await;
    expect_type(&mut socket, "welcome").await;
    send(&mut socket, r#"{"type":"join","name":"Anna","weight_kg":70}"#).await;
    let my_id = expect_type(&mut socket, "joined").await["rider_id"].as_u64().unwrap();

    send(&mut socket, r#"{"type":"pause"}"#).await;
    wait_for_parked(&mut socket, my_id, true).await;
    send(&mut socket, r#"{"type":"resume"}"#).await;
    wait_for_parked(&mut socket, my_id, false).await;
}

#[tokio::test]
async fn pause_is_rejected_in_a_race() {
    let addr = start_server(0).await;
    let mut socket = connect(addr).await;
    send(&mut socket, r#"{"type":"hello","protocol_version":2}"#).await;
    expect_type(&mut socket, "welcome").await;
    send(&mut socket, r#"{"type":"join","name":"Anna","weight_kg":70}"#).await;
    expect_type(&mut socket, "joined").await;

    send(&mut socket, r#"{"type":"start_race","laps":1}"#).await;
    send(&mut socket, r#"{"type":"pause"}"#).await;
    let error = expect_type(&mut socket, "error").await;
    assert_eq!(error["code"], "pause_rejected");
}

#[tokio::test]
async fn a_workout_is_seen_by_other_riders() {
    let addr = start_server(0).await;
    let mut anna = connect(addr).await;
    hello(&mut anna).await;
    send(
        &mut anna,
        r#"{"type":"join","name":"Anna","weight_kg":70,"device":"workout"}"#,
    )
    .await;
    let anna_id = expect_type(&mut anna, "joined").await["rider_id"].clone();
    send(&mut anna, r#"{"type":"workout","exercise":"squats"}"#).await;

    let mut ben = connect(addr).await;
    hello(&mut ben).await;
    send(&mut ben, r#"{"type":"join","name":"Ben","weight_kg":70}"#).await;
    expect_type(&mut ben, "joined").await;
    // The first snapshots can predate the device and the exercise.
    for _ in 0..30 {
        let state = expect_type(&mut ben, "state").await;
        let riders = state["riders"].as_array().unwrap();
        if let Some(rider) = riders.iter().find(|r| r["id"] == anna_id) {
            if rider["exercise"] == "squats" {
                assert_eq!(rider["parked"], true);
                assert_eq!(rider["device"], "workout");
                return;
            }
        }
    }
    panic!("Anna never showed up doing squats");
}
