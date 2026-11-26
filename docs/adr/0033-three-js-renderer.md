# 0033 — Three.js as the 3D renderer, vendored

Date: 2026-11-23 · Status: accepted · Supersedes [0005](0005-own-webgl-renderer.md)

## Context

The own WebGL renderer (ADR 0005) has no shadows, textures or post effects, and two attempts at a
richer world stayed inside it without landing the look (#49, #117). The client has no build step,
must work offline from the game server (LAN, Android app bundling `www`) and serves with
`script-src 'self'`, so a CDN and a bare-specifier import map are both out.

## Decision

Three.js (MIT, pinned at `three@0.170.0`) replaces the own renderer. It is vendored into
`client/public/vendor/three/` by `npm run vendor` (`client/vendor.mjs`), committed, with its licence.
App code imports it only through `client/public/js/three.js`, which re-exports the vendored module by
relative path; the browser and the node tests resolve the same specifier without an import map, so the
CSP and offline use stay as they are.

Addons are copied the same way; `vendor.mjs` rewrites their `from 'three'` to a relative path, so no
import map is needed for them either.

During the sweep (`feat/polished-world`) a `ThreeRenderer` implements the old `Renderer` interface on
a Three.js `WebGLRenderer`, so `View3D` and `StudioView3D` change in one step and the look stays the
baseline's. Steps 3 and 4 replace those adapter calls with a real scene graph.

Dependabot (or a person) bumps `three` in `client/package.json`, `npm run vendor` refreshes the copy,
and `client/test/vendorThree.test.js` fails until both agree: `REVISION` is `"170"` and
`dependencies.three` is `"0.170.0"`.

## Consequences

- Shadows, post effects, instancing, skinning and a scene graph come from Three.js instead of being
  written here.
- Payload: 691 KB minified, about 171 KB gzipped, plus only the addons imported.
- Geometry, cameras and posing stay pure functions and keep their node tests; only `WebGLRenderer`
  and the post chain need a browser.
- The vendored copy is a generated artefact in the repo. A Three.js update is a `package.json` bump
  plus `npm run vendor`, and the test keeps the two together.
- A browser without WebGL 2 keeps using the 2D view; that fallback is unchanged.
