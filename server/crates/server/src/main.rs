use openradlr_server::config::Config;
use openradlr_server::{app, healthcheck, players};
use std::process::ExitCode;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("configuration error: {error}");
            return ExitCode::FAILURE;
        }
    };

    if std::env::args().nth(1).as_deref() == Some("healthcheck") {
        let healthy = healthcheck::check(healthcheck::probe_addr(config.bind_addr));
        return if healthy { ExitCode::SUCCESS } else { ExitCode::FAILURE };
    }

    if std::env::args().nth(1).as_deref() == Some("players") {
        let addr = healthcheck::probe_addr(config.bind_addr);
        let summary = healthcheck::get(addr, "/api/info").and_then(|body| players::summary(&body));
        return match summary {
            Some(summary) => {
                print!("{summary}");
                ExitCode::SUCCESS
            }
            None => ExitCode::FAILURE,
        };
    }

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    match app::run(config, shutdown_signal()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "server failed");
            ExitCode::FAILURE
        }
    }
}

/// Resolves on Ctrl+C or SIGTERM (sent by `docker stop`).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown requested");
}
