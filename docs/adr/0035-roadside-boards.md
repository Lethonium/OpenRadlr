# 0035 — Roadside boards: shared spots, per-screen posters, uploads stay on the device

Date: 2026-11-27 · Status: accepted

## Context

Billboards beside the road carry motivational posters during a ride: funny defaults, boards on hard climbs and
before the finish, boards for the season goals, and pictures and lines the rider uploads. Boards should belong
to a place on the island, not appear at random. Uploads are personal pictures, and the server, the account
backup (ADR 0032) and other riders must never see them.

## Decision

- The world builder plans fixed board sites per route from the route geometry and seed (`world.boards`), with
  clearings so plants and houses keep off. Every rider sees boards at the same places, on every lap.
- The posters are not part of the world. Each screen chooses and paints its own into one atlas canvas
  (`view3d/posters/`), so the same world can show different posters. The ride view adds the rider's uploads; the
  menu's drone view shows defaults only.
- Goal boards are dynamic, planned at ride start from the season goals and anchored ahead of the rider.
- Uploads live in a per-rider IndexedDB on the device (ADR 0028). They are downscaled and re-encoded there, left
  out of the backup, the data export and every message, and deleted with the rider and with "everything".
  Upload posters carry a red "Your upload" bar, so they cannot pass for OpenRadlr's own content.
- No protocol change.

## Consequences

- Board sites cost a placement pass in the world worker; the posters cost one canvas paint per ride view build
  and again when the graphics level changes the atlas size.
- Only general boards show uploads; climb, last-km and goal boards keep their own wording.
- A rider's uploads exist on one device only. Moving to another device means adding them again.
