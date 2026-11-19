import assert from "node:assert/strict";
import test from "node:test";
import { TIME_PRESETS } from "../public/js/view3d/lighting.js";

test("every preset has sunScatter in (0, 1] and saturation in [1, 1.25]", () => {
  for (const [key, preset] of Object.entries(TIME_PRESETS)) {
    assert.ok(preset.sunScatter > 0 && preset.sunScatter <= 1, `${key} sunScatter ${preset.sunScatter}`);
    assert.ok(preset.saturation >= 1 && preset.saturation <= 1.25, `${key} saturation ${preset.saturation}`);
  }
});

test("golden's sun is lower than day's", () => {
  assert.ok(TIME_PRESETS.golden.sun[1] < TIME_PRESETS.day.sun[1]);
});

test("golden's horizon is warmer than its zenith", () => {
  const { horizon, zenith } = TIME_PRESETS.golden;
  assert.ok(horizon[0] - horizon[2] > zenith[0] - zenith[2]);
});
