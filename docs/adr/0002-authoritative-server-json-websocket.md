# 2. Authoritative server with JSON over WebSocket

Date: 2026-10-10 · Status: accepted

## Context

Riders on different devices must see a consistent world. The proof of concept
should be easy to debug and to implement in a browser.

## Decision

Clients send raw measurements (power, cadence) and inputs. The server computes
all speeds and positions at 20 Hz and broadcasts state at 4 Hz. Messages are
JSON objects with a `type` tag over a single WebSocket. Positions are a distance
along the route plus a lane, not 3D coordinates.

## Consequences

- Cheating by sending speed is impossible; power can be checked later.
- Messages are human-readable in browser dev tools.
- Switching to a binary encoding (MessagePack) later keeps the same structure.
- Clients must interpolate between snapshots for smooth rendering.
