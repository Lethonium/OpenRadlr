import { test } from "node:test";
import assert from "node:assert/strict";
import { viewControls } from "../public/js/view/viewControls.js";

const ids = (items) => items.map((item) => item.id);

test("route rides offer four cameras five layouts and 3D/2D", () => {
  const controls = viewControls({ studio: false });
  assert.deepEqual(
    { cameras: ids(controls.cameras), layouts: ids(controls.layouts), modes: ids(controls.modes), showTime: controls.showTime },
    { cameras: ["chase", "close", "drone", "side"], layouts: ["auto", "cockpit", "broadcast", "training", "race"], modes: ["3d", "2d"], showTime: true },
  );
});

test("the studio offers its own cameras and no layouts", () => {
  const controls = viewControls({ studio: true });
  assert.deepEqual(
    { cameras: ids(controls.cameras), layouts: controls.layouts, modes: ids(controls.modes), showTime: controls.showTime },
    { cameras: ["seat", "wide", "coach"], layouts: null, modes: [], showTime: false },
  );
});

test("every option carries a label", () => {
  for (const studio of [false, true]) {
    const { cameras, layouts, modes, times } = viewControls({ studio });
    const all = [...cameras, ...(layouts ?? []), ...modes, ...times];
    assert.deepEqual(all.filter((item) => typeof item.label !== "string" || item.label === ""), []);
  }
});
