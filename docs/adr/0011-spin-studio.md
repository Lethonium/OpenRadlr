# 11. Spin studio: stationary group classes

Date: 2026-10-15 · Status: accepted

## Context

Not everyone wants to ride a road. A spinning class — riders side by side in
a room, an instructor calling the efforts, everyone on the same interval at
the same time — is a different kind of group ride that no open-source app
offers. It needs no route, no drafting and no lanes, but it does need a shared
clock: the point is that everybody suffers through the same interval together.

## Decision

Every server hosts a **spin studio** next to its route worlds: world id
`spin-studio`, joined like a route (`route_id` in `join`), with its own game
loop behind the same `GameHandle`, so connections don't care which kind of
world they talk to.

- **Rolling timetable.** A class starts every 30 minutes on the half hour
  (UTC): 5 minutes of lobby (free spinning, countdown), then a 25-minute class.
  Slots rotate through the built-in classes. The clock is derived from wall
  time, so every rider — and every server — agrees on what runs when.
- **Targets relative to FTP.** A class is a list of segments with power as a
  fraction of FTP (like workouts) plus a cadence cue and an instructor cue.
  Riders send their FTP when joining; the client turns targets into watts and
  either holds them in ERG mode or leaves resistance to the rider (virtual
  gears).
- **Rooms of 16.** A room has 16 seats in two rows facing the instructor.
  Bots fill seats up to the target rider count and give way as humans join;
  the 17th human opens room 2 of the same class. Empty extra rooms close.
- **Bot instructor.** For now the instructor is a bot driven by the class
  plan. The plan travels as data (`/api/studio`), so a human host can later
  pick and lead a class without a protocol break.
- **Room board.** The server keeps per-rider *time on target* (within 10 % of
  the target power) and kJ per class, so the board compares effort, not
  absolute watts.
- Riders still get speed and distance from flat-road physics, so a studio
  ride records and uploads like any other (without GPS positions).

## Consequences

- Additive protocol change (`studio_state` message, optional `ftp_w` in
  `join`); protocol version stays 1. Older clients simply don't list the studio.
- One more game loop per server; cheap (no physics beyond a flat-road speed
  per seat).
- Class plans are compiled in for now; loading them from files (and `.zwo`)
  is a follow-up.
