# Classic rider: the old rider and bike as a reward — Design (short)

Part of the polished world PR (#144), after step 4.

## Intent

The new world replaces the old low-poly rider and bike with a rigged rider on detailed bikes. Riders who rode
before the new design should keep the old look as a reward: an achievement, and a style they can pick. It is the
first piece of the coming avatar customization (owner, 2026-11-26).

## Decided by the owner

- An achievement for riders whose first ride was before the new design; it unlocks the classic rider and bike.
- Until avatar customization exists, unlocking gives an **own switch, on my screen only**: a "Classic rider"
  setting, shown once earned. My rider looks classic on my screen; other riders still see the new look (no
  protocol change).

## Approaches

1. **Own switch, my screen (chosen).** A local setting; the view draws my rider in the classic style.
2. Achievement and asset only; the pick comes with customization. Smaller, nothing to use yet.
3. Visible to everyone: the look goes over the network. Needs protocol and server work; later, with customization.

## Design (calls made for the builder; the owner may overrule)

- **Who earns it:** achievements are worked out on the device from saved ride records (`profile/achievements.js`).
  New records get a stamp `world: 2` (the new world); records without it were made before. The achievement
  `classicRider` is earned by any ride record without the stamp. Every place that creates a ride or workout record
  stamps it, imports included, so an imported or new record never earns it by mistake. Once earned it stays
  (achievements latch).
- **Name:** "Old School" / "Alte Schule", hint "Ride before the new world arrived." / "Fahre vor der neuen Welt.",
  with its own badge drawing in `view/badges.js` (a simple low-poly bike).
- **The look:** `view3d/assets/riders/classicCyclist.js` rebuilds the old rider and bike (the shapes of the deleted
  `riderModel.js`, commit before bca0f2e: frame, wheels, crankset, legs pedalling by `legPose`, torso, head,
  helmet) as vertex-coloured Three.js meshes in the new materials (lit, shadowed, fogged), with the same interface
  as `createCyclist` (`object`, `rider.object`, `ride()`, `setLights()`, `setKit()` tints the jersey), so
  `riderLayer` and `hideBody` work unchanged. Workbench entry `classic-cyclist`.
- **The switch:** setting `openride.classicRider` (bool), a checkbox in Settings shown only when earned. When on,
  my rider entry gets `classic: true` and the rider layer draws it with the classic cyclist (road, vehicles' seats
  excluded, gym athletes excluded: those keep the rig). Studio views too.
- **Not now:** looks for other riders, sending the choice, other old styles.

## Verification

Node tests: the stamp on new records; `classicRider` earned by an unstamped record and not by a stamped one; the
classic cyclist's interface and that it pedals (crank changes with cadence); the rider layer draws a classic
cyclist for `classic: true`. A workbench shot and a ride shot with the switch on.
