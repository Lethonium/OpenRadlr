# Changelog

Release Please writes this file: each release gets a section made from the
Conventional Commit titles of the pull requests merged since the last one
(see [docs/releases.md](docs/releases.md)). Don't edit it by hand; a clear PR
title is the release note.

## 0.1.0 (2026-11-11)

The first release.

### Fixed

- Phone ride screen: no panel covers the top buttons or another panel any more. In landscape the broadcast stats bar, the workout chip, the studio cue, targets and controls, and the training band each have their own place; upright, the training chip, race row and workout stats sit in rows under the buttons, and the paddle hint wraps. On phones the lane buttons are see-through, and the milestone banner keeps to the free middle.

### Added

- **iOS and Android app (preview):** `app/` wraps the client in a Capacitor
  shell, so iPhones and iPads can connect smart trainers, heart rate straps
  and Zwift controllers. That is impossible in any iOS browser. A polyfill
  (`ble/nativeBluetooth.js`) gives the existing device code the Web
  Bluetooth it expects, backed by native Bluetooth. Inside the app the screen
  stays on and ride files open the share sheet. *Connect with Strava* uses the
  system sign-in sheet, so Google and Apple sign-in work too. On iOS, devices
  stay connected while the app is in the background. Browsers are unaffected
  ([docs/app.md](docs/app.md), ADR 0021).
- **Back button in the Android app:** the back button and gesture go one step
  back, as Esc does: a menu page to the page list, then the menu closes.
  Mid-ride, back opens the menu at *Finish this ride?*; in a café workout it
  pauses and asks *End the workout?*; from a summary it returns to the menu;
  on the start menu the app goes to the background instead of closing. A
  ride never ends on a stray swipe ([docs/app.md](docs/app.md#back-button)).
- Bots with character (#64): every bot is a named rider of a made-up cast ("Gus Tailwind", "Penny Farthing") (and, rarely, Goldie Lemon in lemon yellow) with a riding type (rouleur, climber, sprinter, attacker, tourer) and a team kit, the same everywhere. Bots now race you: they take turns on the front of a group and swing off, attack near the top of a climb, take up the chase when you come past and sprint for the line, as long as their energy (W′) lasts. They ride in groups that spawn out of sight around every rider (mostly a group ahead to chase, sometimes one coming up from behind),; the number of riders per route is still `OPENRADLR_TARGET_RIDERS`. The 3D view shows bots in their team's kit, the rider list names their type, and the ticker calls out moves near you.
- Golden lemons: a few lemons float over the road, each in one lane, and move to new places every day (the same for every rider). Ride through one in its lane to collect it; they grow back every lap. A pickup shows in the ticker with your all-time count, and the finish screen lists the ride's lemons. No counter on the HUD: it's an easter egg.
- Ghost lap: your best lap on a loop route is kept in the browser, and a see-through rider labelled "Best lap" rides it again from the line, lane changes and all. The HUD shows the live gap ("Best lap +4.2 s", red behind, green ahead), and a faster lap becomes the new ghost at once. Hidden in races and events.
- Crowds along the route: spectators line the last 600 m of every climb in loose groups, thicker towards the top, and every sprint line gets a crowd behind barriers. They turn towards a rider coming by and cheer harder (penguins clap faster), and some wave flags. The more riders are online, the more of them come out; bots don't count.
- Banners along the route: the arches carry their names (OPENRADLR, KOM, SPRINT), banners count down the last kilometre of a climb ("1 KM", "500 M") and mark halfway round a loop. A lemon-yellow banner celebrates personal milestones: 100, 250, 500… km (or miles) in all, every Everest climbed in all, and the first time over the top of a climb.
- Four research-backed ERG sessions (Seiler 4×8, Rønnestad 30/15, 40/20, over-unders), each naming its source, and a power-profile preview of the selected session in the workout picker. (#26)
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
- Yoga classes at the Beach Café: Sun Salutation A, a post-ride cool-down and a hip and hamstring flow; poses that switch sides halfway (#26)
- The workout screen guides every pose: step-by-step instructions for the exercise under way or, during rests, the one coming up; the sun salutation marks the breath in progress; sided poses name the leg in front. A side view of your avatar joins the front view, and the timer and stats moved to the corners so the avatar has the middle (#26)

### Changed

- Start menu: the language switch is a compact dropdown (any future language shows up in it), the version and Privacy link sit in a quiet footer, and a new version shows a "Reload / Later" toast instead of a link in the header. On phones the tabs share one row instead of scrolling.
- Installed on a phone or tablet (home screen), OpenRadlr no longer locks itself to landscape: it turns with the device, so the start menu and the ride also work in portrait.
- The start screen is ready in about half the time on a phone connection (2.1 s → 1.0 s on 4G; first visit 1.9 MB → 0.7 MB): the server sends the client and the route data compressed (Brotli or gzip), and the page asks for all its scripts at once instead of in five rounds.
- Start screen: every device (trainer, heart rate, controller) is one line of the same shape: a state dot, its name over what it is doing (live power and cadence, heart rate in bpm, which buttons came through) and its actions. Lines no longer wrap or jump when their state changes; on narrow phones two actions or an error go under the name, and nothing is cut off. The Ride bar leaves room for itself however tall an error makes it.
- Riding speeds are calibrated: 200 W on the flat is about 31 km/h for 75 kg, descents are slower, and heavier riders have more air drag (#22).
- Climb feel no longer applies with virtual shifting; the gears do it (#22).
- "Trainer difficulty" is now "Climb feel", explained, in Settings and the ride menu.
- Finishing a ride is final: Finish ride asks first, then shows the summary with its chart; there is no "Keep riding" any more, and the ride can't be continued from the start menu afterwards (#19).
- Start screen: tabs for Ride, Studio, Workout and Events; the picked route is described once, above compact route cards.
- Start screen: "How are you riding?" picks a smart trainer, phone paddles or the simulator; the choice is remembered. Heart rate and controllers are optional add-ons on their own lines.
- Start screen: the Ride button is always in reach, at the bottom of the panel on wide screens and in a bar along the bottom on tablets and phones. Splits, auto-pause and units are folded into Settings.
- Start screen opening: placeholders while the server answers, "Loading the island…" while it builds, then the island fades in and the camera descends from high above onto the picked route before the map docks in its corner.
- Start screen: Strava is one line in the Rider section (connect, or who you're connected as); where a server requires Strava, the Ride button connects it. Boarding a friend's vehicle is a code field under Ride: a valid code turns Ride into Board.
- `make dev` reads an optional `.env.dev` (see `.env.dev.example`), e.g. for all routes or to try Strava locally.
- Name, weight, FTP and settings are kept in the browser as soon as they change, not only when a ride starts.

### Fixed

- The start menu's elevation profile (and route map) no longer stays an empty box when the route loaded while it was out of view, e.g. on the Events tab or during a ride: both are drawn again once they show.
- Cancelling the device window while trying another strap, trainer or controller no longer shows "Cancelled" over the device that is still connected; each device line now shows what its device really does.
- On phones and tablets the start menu scrolls all the way down again: its last row (Settings) no longer stays hidden behind the Ride bar.
- Strava progress stays inside the upload button with a spinner; success becomes a checked activity link and failures show an inline retry action. Periodic menu refreshes no longer interrupt a recovered upload’s status check (#68).
- Strava uploads keep their status across reloads and let you check an accepted upload without sending it again. Processing delays no longer count as success or remove the recovery copy; finished rides stay available when returning to the menu. Finish and recovery screens now show account/permission guidance, clear progress and an activity link, and downloading a recovered ride keeps its photos available. The finish screen uses a compact account row, collapsed file downloads and an explicit summary-image save action; its footer no longer covers controls on short screens (#68).
- No more trees on the road where a route rounds a sharp corner at a junction off the map's roads (e.g. at the top of Col de la Forge by the Hilltop Café): every route of the map now keeps its asphalt clear, whichever one is ridden.
- On routes that aren't a loop (Lanzarote), the start crowd no longer stands in the middle of the road.
- Workouts: the statue plinths no longer flicker, the camera frames your own rider below the timer instead of the mat's centre, joining a workout no longer shows a black screen while the gym's world is built again, and the start menu no longer shows an empty map box on the Workout and Studio tabs (#26).
- Name labels no longer float over houses and hills: a rider out of sight (the GPU checks each one) has no label, with a short delay so labels don't flicker at an edge. Labels point at their rider with a small tail and get smaller and fainter with distance (#15).
- A finished ride is no longer stored twice in the ride history when it was finished, continued and finished again (#19).
- Riders no longer ride through each other. Closing in on a wheel, a rider (bot or human) slows down to sit on it about a bike length behind, and pulls out into a free lane to pass when strong enough to be faster than that rider even out of its draft (about 8 W of lasting surplus is enough; a surge or jittery trainer power doesn't pull you out of the draft, nor does a group speeding up together); with every lane taken it waits, and after 3 s slips through. Drafting is as strong as before, now measured from that closest spot (full draft from 2 m, fading out at 6.5 m) (#14).
- Race and group ride starts line the riders up in rows behind the line instead of stacking a whole lane on one spot; distances and the race count from the line for every row (#14).
- Shifting with a two-piece Zwift Click (v2) keeps working past the first minute. Zwift's firmware locks the left half's plain button messages about a minute after connecting unless the Zwift app unlocked it; OpenRadlr now notices the lock and restarts that half, and while it restarts, B on the right half shifts down. The right half never locks, so with it alone + shifts up and B shifts down.
- Both Click halves can be connected, whichever comes first: their presses are merged into one stream, so a press that one half relays for the other shifts once, and quick + then − is two shifts.
- A Click that falls asleep is found again within seconds (it advertises only briefly when woken), and a reconnect attempt that hangs gives up after 15 s instead of ending all reconnects.
- A menu opened with the mouse during a ride no longer turns the Click's shifters into menu navigation; a menu opened with the Click (+ and − together) is still navigated with it.
- Controller navigation in the start menu goes on from where the focus is (e.g. the button just clicked to pair), and skips the build label and privacy link.
- The device report traces each controller press to its result ("Zwift Click → shiftDown (riding)", "Gear 12 → 11", or why a shift was ignored), notes window and tab switches, and with `?debug=controller` keeps every controller packet.
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
- The ride's summary card is 4:3, the shape Strava shows photos in, so its sides are no longer cut off there (#66).
- The picked route's band no longer flickers orange and white where routes share a road (it lay at the same height as the other routes' bands).
- The drone camera behind the start menu glides: it takes the road's bends in smooth arcs, flights ease in and out without a jolt, and a new world is swapped in only once the camera has landed.
- The start menu no longer flickers: no live blur over the moving island, and route cards and tabs are only redrawn when they change.
- "Weight (kg)" no longer breaks over three lines.
- The start screen no longer widens past the screen on narrow phones (320 px).
