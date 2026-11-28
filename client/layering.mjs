/**
 * The layer rule of the new 3D world, checked by test/layering.test.js:
 * world (pure) -> view3d/assets -> view3d/scene -> view3d/engine -> View3D.
 * A module may import only layers to its left. Dev script, no runtime role.
 */
import { posix } from "node:path";

// Same static-import pattern as preload.mjs.
const IMPORT = /^(?:import|export)\b[^;]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']|^import\s*["'](\.{1,2}\/[^"']+)["']/gm;

const THREE = (target) => target === "js/three.js" || target.startsWith("vendor/three/");

/** Per layer folder: what a module in it may import. */
const RULES = Object.freeze([
  {
    folder: "js/world/",
    allows: (target) => target.startsWith("js/world/"),
  },
  {
    folder: "js/view3d/assets/",
    allows: (target) => target.startsWith("js/world/") || target.startsWith("js/view3d/assets/") || THREE(target),
  },
  {
    folder: "js/view3d/scene/",
    allows: (target) => !target.startsWith("js/view3d/engine/"),
  },
  {
    // The 2D views: Three.js only in the sprite baker, which renders the 3D assets into sprites.
    folder: "js/view2d/",
    allows: (target, file) => !target.startsWith("js/view3d/engine/") && (!THREE(target) || file === "js/view2d/sprites/baker.js"),
  },
]);

/**
 * Imports that run against the layer arrows.
 * @param {string[]} files paths relative to client/public, e.g. "js/world/a.js"
 * @param {(path: string) => string} read source of a file
 * @returns {string[]} one message per violation, naming both files
 */
export function layerViolations(files, read) {
  const violations = [];
  for (const file of files) {
    const rule = RULES.find((candidate) => file.startsWith(candidate.folder));
    if (!rule) continue;
    for (const match of read(file).matchAll(IMPORT)) {
      const target = posix.normalize(posix.join(posix.dirname(file), match[1] ?? match[2]));
      if (!rule.allows(target, file)) violations.push(`${file} imports ${target}`);
    }
  }
  return violations;
}
