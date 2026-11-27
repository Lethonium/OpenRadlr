# Roadside boards

Billboards stand beside the road in the 3D ride view. Design: `docs/superpowers/specs/2026-11-27-roadside-boards-design.md`,
decision: [ADR 0035](adr/0035-roadside-boards.md).

## What riders see

- **General boards**: funny posters (lemon, Radler, the mascot), about one per 7-10 km of route, at least two per
  loop and 3 km apart.
- **Climb boards**: on climbs of 1.5 km or more, one shortly before the top, a second mid-climb from 2.5 km.
- **Last-km board**: 600-900 m before the start/finish line (before the end of a point-to-point route).
- **Goal boards**: up to two at a time, where this week's season-goal step is reached in this ride. None in a
  race or an event.

The board sites are fixed per route. Which poster stands on a general board is picked from the route and the day.
Posters are painted in the rider's language.

## My boards (uploads)

Profile > My boards: a picture (cropped to the 2:1 frame), a line of text, or both. Up to 12 per rider. Uploads show
on the general boards, first ones first; with more uploads than boards a rotation by date picks which show.

Privacy rules, all tested:

- Stored only in the rider's IndexedDB on the device (`openradlr-boards`, per rider).
- Pictures are downscaled to 1024x512 and re-encoded, which drops EXIF and GPS data.
- Never in the account backup, the data export or any WebSocket message.
- Deleted with the rider and with "delete everything"; the data page counts them.
- Only the rider's own ride view shows them. The menu's drone view, other riders and second screens never do.
- Every upload poster has a red bar along the bottom with "Your upload".

## Where things live

- Placement: `client/public/js/view3d/boards.js`; the layer: `view3d/scene/boardLayer.js`.
- Poster pool and copy: `view3d/posters/lines.js` with the texts in `js/i18n/en.js` and `de.js`.
- Choice, painting and the atlas: `view3d/posters/choose.js`, `paint.js`, `plan.js`; wired in `main.js`
  (`paintBoardPosters`, `paintRideBoardPosters`).
- Goal boards: `js/ride/goalBoards.js`. Uploads: `js/profile/myBoards.js`.
