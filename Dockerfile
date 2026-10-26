# syntax=docker/dockerfile:1.7
#
# OpenRadlr server image: the Rust game server plus the static browser client.

# --- Build -------------------------------------------------------------------
FROM rust:1-slim-bookworm AS builder
WORKDIR /build

# Cargo.lock is optional until it is committed; the glob keeps the build working either way.
COPY server/Cargo.toml server/Cargo.lock* server/rustfmt.toml ./
COPY server/crates ./crates

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --release --bin openradlr-server \
    && cp target/release/openradlr-server /usr/local/bin/openradlr-server

# --- Runtime -----------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

# Which build this is (git commit and date), passed by `make up` / `make update` and CI.
ARG OPENRADLR_BUILD_SHA=dev
ARG OPENRADLR_BUILD_DATE=

RUN groupadd --system --gid 10001 openradlr \
    && useradd --system --uid 10001 --gid openradlr --no-create-home --shell /usr/sbin/nologin openradlr

COPY --from=builder /usr/local/bin/openradlr-server /usr/local/bin/openradlr-server
COPY client/public /app/client
# The client reports its own build, so a rider's cached copy can be told from the server's.
RUN printf 'export const BUILD = { sha: "%s", date: "%s" };\n' "${OPENRADLR_BUILD_SHA}" "${OPENRADLR_BUILD_DATE}" > /app/client/js/build.js
COPY routes /app/routes

ENV OPENRADLR_BIND=0.0.0.0:8080 \
    OPENRADLR_STATIC_DIR=/app/client \
    OPENRADLR_ROUTE_FILE=/app/routes/rolling-hills.json \
    OPENRADLR_ROUTES_DIR=/app/routes \
    OPENRADLR_DATA_DIR=/app/data \
    OPENRADLR_BUILD_SHA=${OPENRADLR_BUILD_SHA} \
    OPENRADLR_BUILD_DATE=${OPENRADLR_BUILD_DATE} \
    RUST_LOG=info

# Strava logins live here (a volume in docker-compose.yml); owned by the server's user.
RUN mkdir -p /app/data && chown openradlr:openradlr /app/data

USER openradlr
WORKDIR /app
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD ["openradlr-server", "healthcheck"]

ENTRYPOINT ["openradlr-server"]
