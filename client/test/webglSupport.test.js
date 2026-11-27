import { test } from "node:test";
import assert from "node:assert/strict";

import { isWebGl2Available } from "../public/js/view3d/view3d.js";

/** A document whose canvases hand out a WebGL 2 context with these extensions (or none). */
function doc(extensions) {
  const context = extensions && { getExtension: (name) => (extensions.includes(name) ? {} : null) };
  return { createElement: () => ({ getContext: (kind) => (kind === "webgl2" ? context : null) }) };
}

test("WebGL 2 with float colour buffers can run the 3D world", () => {
  assert.equal(isWebGl2Available(doc(["EXT_color_buffer_float"])), true);
});

test("WebGL 2 without float colour buffers cannot render the half-float scene target", () => {
  assert.equal(isWebGl2Available(doc([])), false);
});

test("no WebGL 2 context means no 3D", () => {
  assert.equal(isWebGl2Available(doc(null)), false);
});

test("a canvas that throws means no 3D", () => {
  assert.equal(isWebGl2Available({ createElement: () => { throw new Error("blocked"); } }), false);
});
