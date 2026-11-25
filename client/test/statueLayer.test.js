/** Statue layer: figures baked from the rigged rider rest on their plinths, lying ones fit, glow, materials, penguins, no leaks. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { bakeStatue } from "../public/js/view3d/assets/riders/statue.js";
import { CLIPS, STATUE_MOMENT } from "../public/js/view3d/clips.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { poseAt } from "../public/js/view3d/riderPose.js";
import { createStatueLayer } from "../public/js/view3d/scene/statueLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { PLINTHS, STATUE_MATERIALS, statueSlots } from "../public/js/view3d/statues.js";

const make = () => {
  const tracker = createTracker();
  const layer = createStatueLayer({ settings: qualitySettings("high"), uniforms: createSharedUniforms(), track: tracker.track });
  return { layer, tracker };
};
const gymAt = () => ({ statueRow: { position: [10, 2, -5], yaw: 0.5 } });
const row = (gym, figures, material = "marble", figure = "rider") => ({ gym, figures, material, figure });
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test("each figure rests on its plinth", () => {
  const { layer } = make();
  const gym = gymAt();
  layer.setRows([row(gym, ["squats", "pushups", "situps"])]);
  const figures = layer.figuresOf(gym);
  assert.equal(figures.length, 3);
  for (const { exercise, box, top } of figures) {
    near(top, PLINTHS[STATUE_MOMENT[exercise].plinth][1], 1e-9, `${exercise} plinth top`);
    near(box.min.y, top, 0.01, `${exercise} bottom`);
  }
  assert.equal(figures[0].top, 1.0);
  assert.equal(figures[1].top, 0.6);
});

test("a lying figure fits its plinth", () => {
  const { layer } = make();
  const gym = gymAt();
  layer.setRows([row(gym, ["downward_dog", "low_lunge"])]);
  for (const { box, x } of layer.figuresOf(gym)) {
    assert.ok(box.max.x - box.min.x <= PLINTHS.lying[0] + 0.001, `length ${box.max.x - box.min.x}`);
    near((box.min.x + box.max.x) / 2, x, 0.01, "centred");
  }
});

test("the glow lights one plinth", () => {
  const { layer } = make();
  const gym = gymAt();
  const other = gymAt();
  layer.setRows([row(gym, ["squats", "plank", "cobra"]), row(other, ["squats"])]);
  layer.setGlow(gym, 1);
  const lit = layer.ringsOf(gym).filter((ring) => ring.visible);
  assert.equal(lit.length, 1);
  near(lit[0].position.x, statueSlots(3)[1].x, 1e-9, "ring x");
  assert.equal(layer.ringsOf(other).filter((ring) => ring.visible).length, 0);
  layer.update({ statueGlow: null });
  assert.equal(layer.ringsOf(gym).filter((ring) => ring.visible).length, 0);
});

test("materials colour the figures", () => {
  const pose = poseAt(CLIPS.squats, STATUE_MOMENT.squats.t);
  const { figure, accent } = STATUE_MATERIALS.bronze;
  const { geometry, box } = bakeStatue({ pose, material: STATUE_MATERIALS.bronze, uniforms: createSharedUniforms() });
  const colours = geometry.attributes.color;
  const positions = geometry.attributes.position;
  const patinaTop = box.min.y + 0.15 * (box.max.y - box.min.y);
  const same = (i, c) => [0, 1, 2].every((k) => Math.abs(colours.array[i * 3 + k] - c[k]) < 1e-6);
  let bodies = 0;
  let patinas = 0;
  for (let i = 0; i < colours.count; i += 1) {
    const low = positions.getY(i) < patinaTop;
    if (low) assert.ok(same(i, accent), `low vertex ${i} is patina`);
    else assert.ok(same(i, figure), `vertex ${i} is bronze`);
    if (low) patinas += 1;
    else bodies += 1;
  }
  assert.ok(bodies > 0 && patinas > 0);
});

test("penguin statues stand on their plinths", () => {
  const { layer } = make();
  const gym = gymAt();
  layer.setRows([row(gym, ["squats", "plank"], "granite", "penguin")]);
  const [squat, plank] = layer.figuresOf(gym);
  near(squat.box.min.y, 1.0, 0.01, "squat");
  near(plank.box.min.y, 0.6, 0.01, "plank");
  const rider = make();
  const other = gymAt();
  rider.layer.setRows([row(other, ["squats"], "granite")]);
  assert.ok(squat.box.max.y - squat.box.min.y < rider.layer.figuresOf(other)[0].box.max.y - 1.0, "a penguin is smaller");
});

test("rows replace rows without leaking", () => {
  const { layer, tracker } = make();
  const gym = gymAt();
  layer.setRows([row(gym, ["squats", "plank"])]);
  const baseline = tracker.live();
  for (let i = 0; i < 5; i += 1) layer.setRows([row(gym, ["squats", "plank"])]);
  assert.equal(tracker.live(), baseline);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});

test("a row of one sits in the middle", () => {
  const { layer } = make();
  const gym = gymAt();
  layer.setRows([row(gym, ["squats"])]);
  const [only] = layer.figuresOf(gym);
  assert.equal(only.x, 0);
  near((only.box.min.x + only.box.max.x) / 2, 0, 0.5, "figure centre");
  near(layer.meshOf(gym).parent.position.x, 10, 1e-9, "row placed at the gym");
});

test("an unknown material throws", () => {
  const { layer } = make();
  assert.throws(() => layer.setRows([row(gymAt(), ["squats"], "jade")]), /material/i);
});
