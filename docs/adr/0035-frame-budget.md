# 0035 — Holding the frame rate: dynamic resolution, shaders compiled ahead, staged rebuilds

Date: 2026-11-28 · Status: accepted · Builds on [0034](0034-three-js-renderer.md)

## Context

The Three.js world (ADR 0034) dropped frames badly on real hardware. Measured with Playwright on an
Apple M4 Pro's Metal GPU (a 1512×900 window at 2× pixels, ride paused at the same spot):

- High drew at 73 ms per frame (p90 147 ms). Most of it was GPU fill: a 3024×1800 HDR target with
  4× MSAA, post effects at full resolution, and the night lights (8 point lights and the headlight's
  spot with its shadow pass) evaluated by every lit fragment all day, at strength 0.
- Joining a ride froze the page for up to 1.9 s and left it at about 12 fps for its first seconds:
  shaders were compiled and linked synchronously on the first frame that drew them, and the first-ride
  quality probe measured those frames and stepped a fast device down, rebuilding the world again.
- A change of level or season rebuilt about 25 layers in the click (1.2 s), then compiled their shaders
  in the next frame (up to 4 s on Ultra). Day to night compiled the lights' shader variants (0.8 s).

## Decision

- **Dynamic resolution.** On top of the per-level pixel cap (`renderPixelRatio`),
  `ResolutionGovernor` (`view3d/engine/resolutionScale.js`, pure) lowers the share of pixels the scene
  is drawn at while frames stay over budget (60 fps), down to the level's `resolutionFloor`, and wins it back while they are fast, backing off when a step up does not hold.
  The canvas keeps its size: only the scene target and the post chain shrink, and the last pass
  stretches them over the canvas, since resizing a canvas waits for the GPU's queued frames. Low,
  which draws straight to the canvas, scales the canvas instead.
- **Night lights only at night.** Lamps and headlight are hidden by day, not only dimmed, so they are
  left out of every shader and the headlight's shadow pass is skipped.
- **Shaders compiled ahead.** `Engine.warm` compiles a scene's materials with `compileAsync` (parallel
  where the browser has `KHR_parallel_shader_compile`), bound to the scene target so the variants match
  the frames, and puts them to first use a few per frame. A new view draws nothing until its shaders are
  ready (the last picture stays); the other half of the day's lighting is compiled in the background.
  Three's per-shader error checks are off (each stalls on first use); `?shaders` turns them on.
- **Staged rebuilds.** `View3D`'s world scene rebuilds a new level's or season's layers a few per frame
  while the old ones are still drawn, warms each one, and swaps them in together.
- **Smaller costs.** The plant layers' world matrices are fixed once (Three otherwise walks their
  ~15 000 objects every frame); sun rays skip the pixels beyond their falloff; the automatic-level probe
  (`QualityProbe`) leaves out the view's first 6 s (`settle`).

## Consequences

High on the M4 Pro draws at about 18–22 ms per frame at the paused spot (from 73), with the scene at
the floor's resolution; joining has no freeze; a level or season change returns at once, and the
world changes when its layers are ready. Single heavy layers (fields, towns) still take 0.2–0.4 s each
to build on the main thread; building them in the world worker is the next step. A scaled scene is
softer than a full-resolution one; the floor per level bounds that.
