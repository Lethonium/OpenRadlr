import { test } from "node:test";
import assert from "node:assert/strict";

import { compositeFragment } from "../public/js/view3d/engine/shaderChunks.js";

test("sun rays march only where their falloff leaves some light", () => {
  const shader = compositeFragment(24);
  const fall = shader.indexOf("float fall");
  const march = shader.indexOf("for(int i=0;i<RS;i++)");
  assert.ok(fall >= 0 && march >= 0);
  assert.ok(fall < march, "the falloff is known before the march");
  assert.match(shader.slice(fall, march), /if\s*\(\s*fall\s*>\s*0\.0\s*\)/, "a pixel out of reach skips the samples");
});
