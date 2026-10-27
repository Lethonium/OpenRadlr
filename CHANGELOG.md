# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- A trainer held by another app (Zwift, its own app) is shown as "resistance blocked" with what to do, instead of looking connected while resistance never follows the road; OpenRadlr asks for control again every 10 s.
- Connecting no longer hangs on "Connecting…": every attempt gives up after 15 s, and Chrome's often failing first connect is retried.
- Connect errors say what to try ("Is it awake, and free of other apps?") instead of the browser's message.
- The trainer's live check says whether data arrives ("Connected · pedal to check", "✓ 182 W · 88 rpm", "No data for 7 s").
- The reconnect line shows the remembered trainer's name instead of squeezing it to "N…"; the gear fields only show with a trainer that can shift.
- The start menu's panel is solid (it could render see-through in Chrome).

### Changed
- "Trainer difficulty" is now "Climb feel", explained, in Settings and the ride menu.

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
