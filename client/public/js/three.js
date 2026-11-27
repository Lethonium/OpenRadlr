/**
 * The one import path for Three.js in the app.
 *
 * Three.js is vendored (`public/vendor/three/`, refreshed by `npm run vendor`)
 * and imported by relative path, so there is no import map, the CSP keeps
 * `script-src 'self'`, and node tests resolve the same module. Import from
 * here, never from `../vendor/…` directly.
 */
export * from "../vendor/three/three.module.min.js";
