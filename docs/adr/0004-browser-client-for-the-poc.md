# 4. Browser client for the proof of concept

Date: 2026-10-10 · Status: accepted

## Context

Native apps give the most reliable Bluetooth on every platform but are slow to
build. The POC must validate gameplay, networking and trainer control first.

## Decision

The POC client is a static web page using Web Bluetooth, served by the game
server. It uses plain ES modules without a build step. The view is 2D first;
low-poly 3D follows without protocol changes.

## Consequences

- Works in Chrome and Edge on Windows, macOS, Android and ChromeOS; not on iOS.
- Needs a secure context: `localhost` or HTTPS (Caddy profile in Compose).
- A browser cannot host a server, so LAN hosting waits for native clients.
