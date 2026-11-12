# 26. Second screens through a server relay

Date: 2026-11-12 · Status: accepted

## Context

A rider wants the ride's numbers on a second screen: a phone on the handlebar
or a headset. The tablet already holds the data, but the screen is another
device, and it may open the page after the ride has started or after the
server has restarted. The second screen should load no 3D world. The same
path should later carry the ride to a Meta Quest display (#86).

The tablet's data (heart rate, gradient, workout, live statistics) is not in
the game state. The server does not compute it.

## Decision

- **Relay through the server.** The tablet's connection copies each message it
  writes to its own socket into the registry `Screens`, keyed by a screen key.
  Watchers receive those copies. The game cores do not change.
- **Remembered pairing with a shared key.** The tablet makes a random key of
  128 bits and keeps it. Pairing uses a short-lived code: `pair_offer` gives a
  code valid for 300 seconds, and `pair_claim` from the phone links the phone
  to the same key. Codes and keys live in memory only. The server stores
  nothing, so a restart forgets them and both devices meet again on the next
  ride.
- **Opaque `display` frames.** The tablet sends its extra data as `display`
  messages. The server forwards them without reading them. It accepts objects
  of at most 2048 bytes, at most 2 per second. Bigger or faster messages are
  dropped without a reply.
- **Views.** A watcher picks `data` or `world`. `data` cuts the riders list
  to the host's own rider or seat, so a phone does not receive the whole road.
  `world` passes everything through, for the later headset display.
- **Limits.** A key has at most 4 watchers. Watchers can only send `leave`,
  take no seat and are not counted in `players`.
- **One composition root per page.** The cockpit has its own page,
  `cockpit.html`, with its own entry `cockpit/main.js`. That page imports no 3D
  code. Each page has one composition root (`main.js`, `gallery.js`,
  `cockpit/main.js`).

### Privacy note on heart rate

Heart rate used to stay on the device. It now reaches the server too, but only
inside the tablet's `display` data, and the server forwards it only to that
rider's own paired screens. The server does not store or log it. Without a
paired screen the tablet sends no display data at all. The game never
receives heart rate.

## Consequences

- The protocol stays at version 2. Every addition is an optional message or
  field. An older server does not announce `screens` in `/api/info`, so the
  clients hide the second-screen controls. An older client never sends
  `screen_key` and behaves as before ([protocol](../protocol.md#second-screens)).
- The relay adds work per message on the host's connection: a copy into the
  hub. Copies to a watcher use a non-blocking send. A slow or dead watcher loses
  messages; it never slows the host's ride.
- Nothing is persisted, so a second screen that was paired before a restart
  waits for the next ride, and the tablet does not show how many screens are
  paired. It only shows that a pairing happened.
- Heart rate now crosses the network to the rider's own screens. A user who
  pairs a screen accepts that. A user who never pairs sends none.
- A new layer on the server (`Screens`, `PairCodes`) keeps state in memory,
  and must stay out of the simulation crate, which holds no I/O.
