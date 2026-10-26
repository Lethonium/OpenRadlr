# 6. Virtual shifting over standard FTMS

Date: 2026-10-14 · Status: accepted

## Context

Riders with a Zwift Cog (or any single-speed setup) need virtual gears.
Zwift's virtual shifting uses proprietary trainer firmware and a proprietary
protocol that third parties have only reverse-engineered.

## Decision

Shift in the client: compute the simulated grade that makes the trainer's
resistance match the chosen virtual gear and send it via the standard FTMS
*Set Indoor Bike Simulation Parameters* command. Gears are a client concern;
the server keeps simulating from power only.

## Consequences

- Works with every FTMS trainer in simulation mode, no proprietary protocol.
- Accuracy depends on the trainer's own resistance model; resistance is
  re-sent as the rider's speed changes.
- 2026-10-15: the force first followed a speed worked out from cadence
  (`k · F_road(k · v)`), which grew with the cube of the gear and followed
  every wobble in cadence: too light on descents, then far too hard after a
  shift, often at the 20 % limit. It now follows the rider's speed in the game
  (`k · F_road(v)`, with a floor for descents), and the trainer adds no air
  drag of its own (`cw` 0). See [devices](../devices.md#virtual-shifting-zwift-cog-and-single-gear-setups).
- Shifting input is action-based, so a future Zwift Click adapter plugs in
  without touching ride logic.
