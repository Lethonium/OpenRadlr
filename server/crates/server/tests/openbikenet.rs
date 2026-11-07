//! End-to-end tests of the OpenBikeNet link against a fake OpenBikeNet server.

use futures_util::{SinkExt, StreamExt};
use openradlr_server::app;
use openradlr_server::config::{Config, EventsSetting};
use serde_json::Value;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, connect_async, MaybeTlsStream, WebSocketStream};

type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;
type Fake = WebSocketStream<TcpStream>;

const ROUTES_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../routes");
const WAIT: Duration = Duration::from_secs(10);

/// A listening fake OpenBikeNet server and the `ws://` URL that reaches it.
async fn fake_server() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/v0", listener.local_addr().unwrap());
    (listener, url)
}

async fn accept(listener: &TcpListener) -> Fake {
    tokio::time::timeout(WAIT, async {
        let (stream, _) = listener.accept().await.unwrap();
        accept_async(stream).await.unwrap()
    })
    .await
    .expect("the app connects to OpenBikeNet")
}

/// The next JSON message the app sends to the fake server.
async fn recv(fake: &mut Fake) -> Value {
    tokio::time::timeout(WAIT, async {
        loop {
            match fake.next().await.expect("socket open").expect("valid frame") {
                Message::Text(text) => return serde_json::from_str(text.as_str()).unwrap(),
                _ => continue,
            }
        }
    })
    .await
    .expect("the app sends a message")
}

/// Reads messages until one of the given type arrives.
async fn recv_type(fake: &mut Fake, wanted: &str) -> Value {
    loop {
        let message = recv(fake).await;
        if message["type"] == wanted {
            return message;
        }
    }
}

async fn serve(config: Config) -> SocketAddr {
    let router = app::build(&config).expect("app builds");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    addr
}

fn velodrome_config(obn_url: Option<String>) -> Config {
    Config {
        route_file: PathBuf::from(ROUTES_DIR).join("velodrome.json"),
        events: EventsSetting::Off,
        bot_seed: Some(1),
        obn_url,
        obn_backoff_unit: Duration::from_millis(10),
        ..Config::default()
    }
}

async fn connect(addr: SocketAddr) -> Client {
    let (socket, _) = connect_async(format!("ws://{addr}/ws")).await.unwrap();
    socket
}

async fn send(socket: &mut Client, json: &str) {
    socket.send(Message::text(json)).await.unwrap();
}

async fn expect_type(socket: &mut Client, wanted: &str) -> Value {
    tokio::time::timeout(WAIT, async {
        loop {
            let message = socket.next().await.expect("socket open").expect("valid frame");
            let Message::Text(text) = message else { continue };
            let value: Value = serde_json::from_str(text.as_str()).unwrap();
            if value["type"] == wanted {
                return value;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("no {wanted} message within {WAIT:?}"))
}

/// Joins Anna on the velodrome and returns her socket.
async fn anna_joins(addr: SocketAddr) -> Client {
    let mut socket = connect(addr).await;
    send(&mut socket, r#"{"type":"hello","protocol_version":2}"#).await;
    expect_type(&mut socket, "welcome").await;
    send(&mut socket, r#"{"type":"join","name":"Anna","weight_kg":70}"#).await;
    expect_type(&mut socket, "joined").await;
    socket
}

async fn http_get(addr: SocketAddr, path: &str) -> String {
    let mut stream = TcpStream::connect(addr).await.unwrap();
    let request = format!("GET {path} HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    response
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_owned())
        .unwrap_or_default()
}

async fn expect_hello_and_subscribe(fake: &mut Fake) {
    let hello = recv(fake).await;
    assert_eq!(hello["type"], "hello");
    assert_eq!(hello["app"]["id"], "openradlr");
    let subscribe = recv(fake).await;
    assert_eq!(subscribe["type"], "subscribe");
    assert_eq!(subscribe["route"], "velodrome-250");
    assert_eq!(subscribe["room"], "public");
}

#[tokio::test]
async fn hello_subscribe_and_join() {
    let (listener, url) = fake_server().await;
    let addr = serve(velodrome_config(Some(url))).await;
    let mut fake = accept(&listener).await;
    expect_hello_and_subscribe(&mut fake).await;

    let _anna = anna_joins(addr).await;
    let join = recv_type(&mut fake, "join").await;
    assert_eq!(join["name"], "Anna");
    assert_eq!(join["route"], "velodrome-250");
    assert_eq!(join["room"], "public");
    recv_type(&mut fake, "update").await;
}

#[tokio::test]
async fn remote_rider_reaches_the_client() {
    let (listener, url) = fake_server().await;
    let addr = serve(velodrome_config(Some(url))).await;
    let mut fake = accept(&listener).await;
    expect_hello_and_subscribe(&mut fake).await;
    fake.send(Message::text(r#"{"type":"welcome"}"#)).await.unwrap();
    fake.send(Message::text(
        r#"{"type":"joined","route":"velodrome-250","room":"public","rider":
            {"id":"ben-1","app":"incyclist","name":"Ben","lap":0,"distance":10.0,"speed":0.0,"power":180}}"#,
    ))
    .await
    .unwrap();

    let mut anna = anna_joins(addr).await;
    let ben = tokio::time::timeout(WAIT, async {
        loop {
            let state = expect_type(&mut anna, "state").await;
            let found = state["riders"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["name"] == "Ben")
                .cloned();
            if let Some(ben) = found {
                return ben;
            }
        }
    })
    .await
    .expect("Ben appears in a state message");
    assert_eq!(ben["app"], "incyclist");
}

#[tokio::test]
async fn reconnects_and_joins_again() {
    let (listener, url) = fake_server().await;
    let addr = serve(velodrome_config(Some(url))).await;
    let mut fake = accept(&listener).await;
    expect_hello_and_subscribe(&mut fake).await;
    let _anna = anna_joins(addr).await;
    recv_type(&mut fake, "join").await;

    drop(fake);
    let mut second = accept(&listener).await;
    expect_hello_and_subscribe(&mut second).await;
    let join = recv_type(&mut second, "join").await;
    assert_eq!(join["name"], "Anna");
}

#[tokio::test]
async fn api_info_marks_the_route_shared() {
    let (_listener, url) = fake_server().await;
    let config = |obn_url| Config {
        route_file: PathBuf::from(ROUTES_DIR).join("rolling-hills.json"),
        routes_dir: Some(PathBuf::from(ROUTES_DIR)),
        ..velodrome_config(obn_url)
    };

    let linked = serve(config(Some(url))).await;
    let info: Value = serde_json::from_str(&http_get(linked, "/api/info").await).unwrap();
    for route in info["routes"].as_array().unwrap() {
        if route["id"] == "velodrome" {
            assert_eq!(route["shared"], true);
        } else {
            assert!(route.get("shared").is_none(), "only the velodrome is shared: {route}");
        }
    }

    let alone = serve(config(None)).await;
    let info: Value = serde_json::from_str(&http_get(alone, "/api/info").await).unwrap();
    assert!(info["routes"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r.get("shared").is_none()));
}
