# Rider look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riders customise their rider in the Profile dialog with a live preview; fun pieces unlock through achievements; others see the look.

**Architecture:** A pure catalogue and codec (`profile/riderLook.js`) turns a saved choice into `RiderLook` fields and a
short code. The rig and painter grow the fun pieces. The views take an optional look per rider entry. The server
relays the code untouched.

**Tech Stack:** plain ES modules, Three.js r170 (vendored), node:test; Rust (tokio, serde) on the server.

**Spec:** `docs/superpowers/specs/2026-11-27-rider-look-design.md`

## Global Constraints

- No physics or ride effect from any look piece.
- Skin tones and hair colours are never locked.
- `lookOf(id)` keeps every existing field's value for every id (new draws come after the old ones).
- Protocol change is additive (`look` message, `riders[].look`), no version bump; `docs/protocol.md` updated.
- UI text in `i18n/en.js` and `de.js`; no duplicate CSS rules.

## Review Focus

- A stored look naming a piece that is no longer unlocked (achievement lost with a reset): it falls back to the free default for that slot.
- A code from a newer client (unknown version or index): decoded field by field, unknowns rolled.
- A rider changing their look mid-ride: others' views rebuild that cyclist (pool key includes the look).
- Switching rider profiles: the look page and the sent look follow the active rider.
- No WebGL 2: the look page works without a preview.

---

### Task 1: Look pieces on the rig and painter

**Files:** `client/public/js/view3d/assets/riders/{look.js,rider.js,kitPainter.js,cyclist.js,bicycle.js}`, tests `riderRig.test.js`, `riderLook.test.js`.

New `RiderLook` fields (rolled at the end of `lookOf`): `sockHeight` (`low|crew|tall|knee`), `hairStyle` (`short|long|ponytail`),
`moustache` (bool), `helmetStyle` (`road|aero|cap|lemon`); pattern `rainbow`; frame colour `gold` is a plain colour.
Tests: socks paint up to the chosen height; ponytail and moustache meshes exist only when chosen; aero helmet reaches
further back; cap has a brim in front; lemon helmet is yellow; the rainbow paints five bands; old fields of `lookOf`
unchanged for ids 1..50 (snapshot of `{kit, pattern, primary, bike, frame}`).

### Task 2: Catalogue, unlocks and codec

**Files:** create `client/public/js/profile/riderLook.js`, test `riderLookChoice.test.js`.

`LOOK_SLOTS` (slot → options, each `{id, unlock?: achievementId}`), `unlockedOptions(earned)`, `sanitizeLook(choice, earned)`,
`rolledChoice(seed)`, `lookFromChoice(choice, base)`, `encodeLook(choice)` / `decodeLook(code)` (version char `1`, one
base-36 char per slot, height as two), `randomChoice(earned, rng)`, `loadLook(storage)` / `saveLook(storage, choice)`.

### Task 3: Server relays the look

**Files:** `server/crates/server/src/{protocol.rs,session.rs,connection.rs,runtime.rs,game.rs}`, `docs/protocol.md`, client `net/protocol.js`.

`ClientMessage::Look {look}` checked in the session (1–48 chars of `[0-9a-z]`, else `invalid_look`), `PlayerCommand::Look`,
`Command::Look`, `GameCore::set_look`, `RiderTags.look`, `RiderState.look` (left out when none). Tests in session and
game (another client's `state` carries it).

### Task 4: Views draw the look

**Files:** `view3d/scene/riderLayer.js`, `view3d/view3d.js`, `view3d/studioScene.js`, `main.js`, tests `riderLayer.test.js`, `view3d.test.js`.

Rider entries carry `look` (decoded); `ownKits` decides whether its primary beats the tint; classic comes from the look's
style; pool key includes the code. `View3D.setLooks({mine, ownKits})`. Setting `openradlr.kitColours` (`own|code`).

### Task 5: Look page with preview

**Files:** `index.html`, `styles.css`, `i18n/en.js`, `de.js`, create `view/lookPage.js` (pure: groups, chips, locked state),
create `view3d/lookPreview.js`, `main.js` (wire, save, send, migrate classic setting, remove the checkbox), tests
`lookPage.test.js`, `i18n` tests.

### Task 6: Docs and shots

README feature line, `docs/protocol.md` done in task 3, PR description shots (preview page, a pack in own kits).
