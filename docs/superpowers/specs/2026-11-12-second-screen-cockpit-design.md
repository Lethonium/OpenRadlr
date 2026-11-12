# Second-screen cockpit — design

Date: 2026-11-12 · Status: agreed in discussion, awaiting spec review · Issue: #87 (builds #86 steps 1 and 2)

## Goal

The tablet rides as usual: trainer over Bluetooth, Strava, recording. A
paired phone becomes a cockpit. It shows the ride's numbers live and in
more detail than the in-ride HUD, in tiles the rider picks and orders. It
loads no 3D world.

The same relay later lets a Meta Quest be a display for the ride (#86). The
cockpit is the first screen to use it.

## Decisions

| Question | Decision |
| --- | --- |
| How the phone gets the data | Server relay: the tablet's connection copies what it receives to its paired screens |
| How long a pairing lasts | Remembered: pair once with a code; both devices keep a shared screen key; the server stores nothing |
| Unpairing | "Unpair all" on the tablet makes a new key; a screen can forget its key on its own |
| Tablet-only data (HR, gradient, workout, stats) | The tablet forwards it as opaque `display` frames; the server doesn't read them |
| Statistics | Forwarded from the tablet's `liveStats`, not recomputed on the phone |
| Controls on the cockpit | Not in this version (read-only) |
| Layout | Tiles chosen, ordered and sized by the rider; saved on the phone (localStorage) |
| Page | Its own entry `cockpit.html` + `js/cockpit/main.js` |
| Protocol | Additive within version 2; no bump |
| Out of scope | The Quest/WebXR display (#86 steps 3–4), cockpit controls, layouts that follow the rider across devices, QR codes |

## Server: pairing and relay

### Screen key and pairing codes

- The **screen key** is 128 random bits (32 hex characters). The tablet
  generates it once and keeps it in localStorage (`openradlr.screenKey`).
  Every screen that pairs gets the same key.
- **Pairing codes:** a new server-wide registry `PairCodes` (`pair_codes.rs`,
  like `vehicle_codes.rs`) maps code → key.
  - Codes are 6 characters from an alphabet without look-alikes
    (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`).
  - A code is valid for 300 s and works once. Expired codes are swept when
    new ones are issued.
  - Codes are held in memory only.
- **Pairing works without a ride.** The tablet has no game connection in
  the menu, so pairing uses a short connection with `hello` and no `join`:
  1. The tablet sends `pair_offer { key, name }` (the rider's name, shown on the phone).
  2. The server replies `pair_code { code, expires_in_s }`. A new offer
     replaces this connection's earlier code.
  3. The phone (a separate connection, also without `join`) sends
     `pair_claim { code }`.
  4. The server replies to the phone `paired { key, name }`, where `name` is
     the name the tablet sent in `pair_offer`. It sends the tablet
     `pair_claimed`. The code is used up.
  5. An unknown or expired code gets `error { code: "pair_code_invalid" }`.

  Wrong claims go through the session's existing message rate limit.

### The relay

- **New server-wide registry `Screens` (`screens.rs`).** It maps key → hub.
  A hub has:
  - the current host (at most one; a newer host replaces the older one);
  - its watchers (at most 4).

  An entry exists while it has a host or watchers.
- **Host:** a `join` with the new optional `screen_key` registers the
  connection as the key's host.
  - Every `ServerMessage` the connection writes to its own socket is copied
    to the hub, at the point in `connection.rs` where the outbox is drained.
    The game cores are unchanged.
  - The host also sends `display { data }`. It is forwarded and never read.
    - `data` is any JSON object, at most 2048 bytes serialised.
    - It is limited to 2 per second (a token bucket).
    - Messages that are too large or too frequent are dropped without a
      reply.
  - When the connection ends, the hub tells its watchers
    `watch_status { live: false, name }`.
- **Watcher:** after `hello`, the screen sends
  `watch { key, view: "data" | "world" }` instead of `join`.
  - It is told `watch_status { live, name }` right away, and again whenever
    a host arrives or leaves.
  - Between those it receives the host's copied stream:
    - `state`, `studio_state`, `resistance`, `event`, `chat`, `afk_warning`;
    - the host's `display` messages.
  - It does not get the host's `welcome` or `joined`, or any of the host's
    `error` messages.
  - A fifth watcher on a key gets `error { code: "too_many_screens" }` and
    is closed.
- **The `data` view** cuts each `state.riders[]` down to the host's own
  rider and `studio_state.riders[]` to the host's seat, and drops
  `road_riders`. `race`, `event` and `vehicle` stay as they are. `world`
  passes everything through; it is for the later Quest display.
- **What a watcher can and can't do:**
  - It can send nothing but `leave` and pings.
  - Telemetry or game commands from it are ignored.
  - It doesn't take a player slot or count in `players`.
  - It counts toward the per-address connection cap.
  - The AFK timeout doesn't apply to it.
- **Privacy:** heart rate now passes through the server, to the rider's own
  paired screens only, and only while one is paired. It is never stored or
  logged. `ride/rideSession.js` says heart rate never reaches the server;
  that comment and the privacy note in the ADR say this instead.
- **Advertising:** `/api/info` gains `screens: true`. Clients show the
  second-screen controls only when it is there.
- **Restarts:** the server forgets all hubs and codes on restart. Both
  devices still have the key and meet again on the next ride.

## Client: the tablet

- **Pairing dialog:** a "Second screen" entry in the start menu (only with
  `info.screens`) opens a dialog:
  - the code in large letters and a countdown;
  - "New code" when it runs out;
  - "Unpair all screens", which makes a new key after asking.

  The tablet marks itself paired after the first `pair_claimed`
  (`openradlr.screenPaired`). It can't count screens, because the server
  stores none, so the dialog says "Paired" rather than a number.
  `net/screenPairing.js` runs the short connection (socket injected).
- **`join`:** carries `screen_key` once the tablet is paired.
- **`display` frames:** `display/displayFrame.js` is pure. It is called
  once a second while riding and its result is sent. Fields, each optional:
  - `hr` (bpm);
  - `grade` (percent, the last `resistance`);
  - `ftp`;
  - `stats`: the `liveStats` result, that is `elapsedS`, `distanceM`,
    `climbedM`, `kJ`, `avgHeartRate`, `avgPower`, `weightedPower`, `load`
    and `efforts`;
  - `zones_s`: seconds in each power zone;
  - `cadence`: rpm, when known.
  - `workout`: `{ id, step, step_elapsed_s, target_w }`.

  The workout plan's step list goes once per workout start as
  `{ workout_plan: { id, name, steps } }`. It doesn't go every second, so
  each frame stays well under 2 KB. A test checks a long workout's plan
  frame against the limit.

## Client: the cockpit (phone)

### Getting there

"Use as cockpit" in the start menu (only with `info.screens`):
- The first time, it asks for the code, sends `pair_claim`, and stores
  `paired.key` and `paired.name` (`openradlr.cockpit`).
- Then, and every time after, it opens `cockpit.html`.

The cockpit page has a "Forget this tablet" item and a link back to the
app. It works in the browser and inside the iOS and Android app, which load
pages from the server.

### The page

- **`cockpit.html` + `js/cockpit/main.js`.** This is the cockpit's
  composition root. It imports no `view3d` code. AGENTS.md's "`main.js` is
  the only composition root" becomes "one composition root per page".
- **`cockpit/cockpitConnection.js`:**
  - connects and sends `hello` and `watch { key, view: "data" }`;
  - reconnects with backoff after a drop (time and socket injected);
  - emits `status`, `state` and `display`.
- **`cockpit/cockpitModel.js`** (pure) keeps:
  - the latest state of the host's rider;
  - the latest display frame;
  - the workout plan;
  - a 20-minute history at 1 Hz of power, heart rate and cadence, for the
    graphs.

  It also derives the 3 s average power.
- **What the screen shows:**
  - "Waiting for <name>'s ride…" while not live.
  - The tiles while live.
  - A "Not live" badge when nothing has arrived for more than 3 s.
- **It keeps the screen awake while live** (`util/wakeLock.js`).

### Tiles

`cockpit/tiles.js` is a catalogue of pure tile descriptions:
`{ id, labelKey, sizes, value(model) }` for number tiles, and
`{ id, labelKey, sizes, draw }` for graph tiles. The sizes are `big`, `half`
and `wide`.

**Default layout** (top to bottom, phone held upright):
1. `power3s` big, coloured by power zone (`powerZone` from `view/hud.js`)
2. `heartRate` big, uncoloured (the profile has no maximum heart rate to
   derive zones from). It's hidden while no HR has arrived.
3. `cadence` half, `speed` half
4. `grade` half, `elapsed` half
5. `workout` wide: the workout graph with the current step and target.
   It's hidden outside a workout.
6. `zones` wide: a bar of time in each power zone
7. `avgPower` half, `np` half
8. `kj` half, `distance` half

**Available to add:** `efforts` (5 s, 1 min, 5 min, 20 min), `load`,
`climbed`, `avgHeartRate`, `powerGraph` (wide), `hrGraph` (wide), `laps`,
`raceGaps`.

### Layout and edit mode

- **`cockpit/layout.js`** is pure. A layout is a list of `{ id, size }`.
  - Operations: `move(from, to)`, `add(id)`, `remove(index)`,
    `resize(index)` (cycles through the tile's sizes) and `reset()`.
  - `load(storage)` and `save(storage)` use the key
    `openradlr.cockpit.layout`. Storage is injected.
  - Unknown ids and invalid sizes are dropped when loading. An empty or
    corrupt layout falls back to the default.
- **Edit mode:**
  - A pencil button switches it on. Each tile then shows a drag handle, a
    ✕ and a size toggle.
  - Tiles are reordered by dragging with pointer events, by touch or
    mouse, with no library.
  - A "+" sheet lists the tiles not shown.
  - "Done" saves the layout. "Reset" restores the default after asking.
  - Outside edit mode, tiles can't be moved.
- **Look:** the app's fonts and colours, a phone held upright first. All
  text is in en and de (`cockpit.*`, `screens.*`).

## Compatibility

All additions are optional messages or fields, and protocol version stays
2:
- Messages: `pair_offer`, `pair_code`, `pair_claim`, `paired`,
  `pair_claimed`, `watch`, `watch_status`, `display`.
- Fields: `join.screen_key`, `info.screens`.

An older server doesn't announce `screens`, so the client hides both menu
entries. An older client never sends `screen_key` and behaves as today.
`docs/protocol.md` documents all of it.

## Testing

Written first; one reason to fail per test; no sleeps.

**Server (`cargo test --workspace`):**
- `PairCodes`:
  - alphabet and length;
  - expiry at 300 s;
  - single use;
  - a new offer replaces the old code.
- `Session`:
  - `pair_offer`, `pair_claim` and `watch` are accepted without `join`;
  - a watcher's telemetry and commands are ignored;
  - `display` is dropped beyond 2048 bytes and beyond 2 per second.
- `Screens`:
  - a host's messages reach its watchers;
  - the `data` view cuts `riders[]` to the host;
  - `watch_status` goes out when a host arrives or leaves;
  - the fifth watcher gets `too_many_screens`;
  - a newer host replaces the older one;
  - the entry is gone when empty.
- End to end (`tests/`):
  1. A tablet pairs and a phone claims the code.
  2. The tablet joins with `screen_key` and rides.
  3. The phone gets `watch_status { live: true }`, then `state` with only
     the tablet's rider, then the tablet's `display`.
  4. The tablet reconnects for a new ride, and the phone gets live again.
  5. `/api/info` has `screens: true`.

**Client (plain node):**
- `displayFrame` from a fake ride, with and without HR or a workout; the
  plan frame under 2 KB.
- `screenPairing`: code shown, claimed, expired, invalid (fake socket).
- `layout`: every operation; load/save round trip; unknown ids dropped;
  corrupt storage gives the default.
- `tiles`: the value of each number tile from a model; hidden rules for
  `heartRate` and `workout`.
- `cockpitModel`: history window, 3 s power, not-live after 3 s
  (injected time).
- `cockpitConnection`: waiting, live, not live, reconnect with backoff.

`make check` passes. Playwright screenshots (1×, cache dir, phone size): the
pairing dialog, the cockpit live during a workout, and edit mode.

## Docs

- `docs/protocol.md`: the new messages and fields, and the relay.
- ADR 0026 "Second screens through a server relay": remembered pairing
  with a shared key, the copy at the connection, the opaque `display`
  frames, the `data` view, one composition root per page.
- AGENTS.md: the composition-root line.
- en and de strings. CHANGELOG.md is left to Release Please.

## Delivery

Branch `feat/cockpit` from `main`, one PR with ordered commits:

1. Server: pairing codes, `Screens` relay, watcher sessions, `display`,
   `info.screens`.
2. Docs: protocol and ADR 0026.
3. Tablet: pairing dialog, `screen_key` in `join`.
4. Tablet: `display` frames.
5. Cockpit page with the default layout.
6. Cockpit: choose, reorder and resize tiles.
