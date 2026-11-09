# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Living: a third view choice beside 2D and 3D that makes the island look lived in. From the drone the noise pattern is gone: road-aligned fields of wheat, rapeseed, hay and pasture, woods, moors and beaches, painted into one generated ground map. Riders pass hedges, stone walls, orchards, fences and farm props, and huts, parasols, a jetty and boats on the coast. Birds, boats, tractors, villagers, grazing animals and balloons move around (still for riders who prefer reduced motion), and a few surprises are hidden around the island: a lighthouse, a giant bicycle mown into a field, a sheep on a tower of hay, an escaped penguin. On by default on desktops and laptops, off on phones and low-memory devices; plain 3D is unchanged. Winter and very large maps show plain 3D for now. See ADR 0021 (#48).
- A velodrome: a flat 250 m oval with no bots. With `OPENRADLR_OBN_URL` set it is shared with riders of other apps (Incyclist, VeloPopuli, ...) through an OpenBikeNet server: the start menu marks it *Shared* and says what is sent (name, position, speed, power and cadence; never heart rate). Riders from other apps get their own tint, a label with their app, and a badge in the rider list. Without the variable nothing leaves the server. A switch to stop sharing power and cadence follows in #36. See ADR 0020.
- OpenBikeControl controllers (and apps such as BikeControl that act as one) connect with *Connect controller*, next to Zwift's: shift, change lane, navigate menus, adjust power or the ERG target, change the camera and take photos. A press that sends several actions at once (e.g. shift up, harder and select) acts once: it shifts while riding, changes the ERG target in ERG, and selects in a menu. See docs/devices.md.
- A rider who sits at 0 W for 30 minutes gets a "Still riding?" warning with Stay and Leave now, two minutes to answer. Stay gives three more reminders 10 minutes apart, then a final one with Leave now only; no answer removes the rider, so an idle rider no longer holds a seat. Pedalling resets the clock, and workouts are exempt. `OPENRADLR_AFK_TIMEOUT_S=0` turns it off. Outcomes are counted in `openradlr_afk_events_total`.
- Seasons: a rider can pick how the world looks (Settings, or the Season picker in the ride menu) without changing the road, the café, the gym or where anything stands. Temperate and Winter are available; trees, road, buildings and terrain change shape, never place. Winter re-dresses its world: posts become snowmen (yellow-scarfed every kilometre), farm animals become caribou, polar bears and walruses, hay bales become firewood stacks, village lamps become wooden lanterns, roadside spectators become clapping penguins in winter coats, event barriers change colour, the sky and light turn pale and cold with a lower, broader cloud ceiling and falling snow, the river freezes into opaque ice with wind-blown snow patches, and ploughed snow banks open up where roads meet instead of crossing them. The season pickers preview each season with colour swatches. A season changed at any time — also while a world is still building, or in the start menu just before a ride — carries into the ride; the last pick wins. The pick is remembered per browser, and `?biome=<id>` previews one. See ADR 0018.
- In winter, workout figures become penguins: the rider training on the gym mat and the statues of the workout's exercises are penguins on the same exercise skeleton, so they still squat, push up and plank. The bike still waits at the rack; temperate keeps the human figures. See ADR 0018.
- German translation and a language selector (start menu and Rider panel). The language follows the browser by default and the choice is remembered. Server content such as route names stays as the server sends it.
- The in-game menu is a dialog centred over the dimmed ride: a page list (Overview, View, Vehicle, Race, Events, Training, Settings) next to the open page, full screen with the list first on a phone. Photo and Finish ride stay pinned at its foot (#19).
- The menu's Overview shows the ride so far: power over the last 10 minutes, weighted power, load and best efforts, with a live power, speed and grade strip on top (#19).
- A View button in the top bar opens a small popover for camera, layout, 2D/3D and time of day; it replaces the separate camera and layout buttons (#19).
- Workouts at their own café gym with statues of their figures, and workout cards with a block strip (#26)

### Changed

- Riding speeds are calibrated: 200 W on the flat is about 31 km/h for 75 kg, descents are slower, and heavier riders have more air drag (#22).
- Climb feel no longer applies with virtual shifting; the gears do it (#22).

### Fixed
- Workouts: the statue plinths no longer flicker, the camera frames your own rider below the timer instead of the mat's centre, joining a workout no longer shows a black screen while the gym's world is built again, and the start menu no longer shows an empty map box on the Workout and Studio tabs (#26).
- Name labels no longer float over houses and hills: a rider out of sight (the GPU checks each one) has no label, with a short delay so labels don't flicker at an edge. Labels point at their rider with a small tail and get smaller and fainter with distance (#15).
- A finished ride is no longer stored twice in the ride history when it was finished, continued and finished again (#19).
- Shifting with a two-piece Zwift Click (v2) keeps working past the first minute. Zwift's firmware locks the left half's plain button messages about a minute after connecting unless the Zwift app unlocked it; OpenRadlr now notices the lock and restarts that half, and while it restarts, B on the right half shifts down. The right half never locks, so with it alone + shifts up and B shifts down.
- Both Click halves can be connected, whichever comes first: their presses are merged into one stream, so a press that one half relays for the other shifts once, and quick + then − is two shifts.
- A Click that falls asleep is found again within seconds (it advertises only briefly when woken), and a reconnect attempt that hangs gives up after 15 s instead of ending all reconnects.
- A menu opened with the mouse during a ride no longer turns the Click's shifters into menu navigation; a menu opened with the Click (+ and − together) is still navigated with it.
- Controller navigation in the start menu goes on from where the focus is (e.g. the button just clicked to pair), and skips the build label and privacy link.
- The device report traces each controller press to its result ("Zwift Click → shiftDown (riding)", "Gear 12 → 11", or why a shift was ignored), notes window and tab switches, and with `?debug=controller` keeps every controller packet.

### Fixed
- A trainer held by another app (Zwift, its own app) is shown as "resistance blocked" with what to do, instead of looking connected while resistance never follows the road; OpenRadlr asks for control again every 10 s.
- Connecting no longer hangs on "Connecting…": every attempt gives up after 15 s, and Chrome's often failing first connect is retried.
- Connect errors say what to try ("Is it awake, and free of other apps?") instead of the browser's message.
- The trainer's live check says whether data arrives ("Connected · pedal to check", "✓ 182 W · 88 rpm", "No data for 7 s").
- The reconnect line shows the remembered trainer's name instead of squeezing it to "N…"; the gear fields only show with a trainer that can shift.
- The start menu's panel is solid (it could render see-through in Chrome).
- Device lines have one main action (Reconnect a remembered device, else connect, change or add another) and no longer wrap; the controller check names the button pressed ("✓ Zwift Click: shift up (+)").
- Virtual shifting no longer goes missing for a whole ride when the trainer gives control a few seconds after Ride was pressed: rides plan gears and ERG on what the trainer can do once it has control, and the HUD says "Resistance blocked" while it hasn't.
- A two-piece Zwift Click pairs like a pair: after one half the button reads "Add other half", each half is named by its side ("Zwift Click − 70 % · + 68 %"), the check confirms + and − one by one, and picking the half that's already connected says to pick the other one.
- Virtual shifting's gear is one line ("Chain on 34 × 14 teeth"); the device report counts a controller's idle messages, so it shows whether a controller sends anything at all.

### Changed
- "Trainer difficulty" is now "Climb feel", explained, in Settings and the ride menu.
- Finishing a ride is final: Finish ride asks first, then shows the summary with its chart; there is no "Keep riding" any more, and the ride can't be continued from the start menu afterwards (#19).

### Changed
- Start screen: tabs for Ride, Studio, Workout and Events; the picked route is described once, above compact route cards.
- Start screen: "How are you riding?" picks a smart trainer, phone paddles or the simulator; the choice is remembered. Heart rate and controllers are optional add-ons on their own lines.
- Start screen: the Ride button is always in reach, at the bottom of the panel on wide screens and in a bar along the bottom on tablets and phones. Splits, auto-pause and units are folded into Settings.
- Start screen opening: placeholders while the server answers, "Loading the island…" while it builds, then the island fades in and the camera descends from high above onto the picked route before the map docks in its corner.
- Start screen: Strava is one line in the Rider section (connect, or who you're connected as); where a server requires Strava, the Ride button connects it. Boarding a friend's vehicle is a code field under Ride: a valid code turns Ride into Board.
- `make dev` reads an optional `.env.dev` (see `.env.dev.example`), e.g. for all routes or to try Strava locally.
- Name, weight, FTP and settings are kept in the browser as soon as they change, not only when a ride starts.

### Fixed
- The picked route's band no longer flickers orange and white where routes share a road (it lay at the same height as the other routes' bands).
- The drone camera behind the start menu glides: it takes the road's bends in smooth arcs, flights ease in and out without a jolt, and a new world is swapped in only once the camera has landed.
- The start menu no longer flickers: no live blur over the moving island, and route cards and tabs are only redrawn when they change.
- "Weight (kg)" no longer breaks over three lines.
- The start screen no longer widens past the screen on narrow phones (320 px).
