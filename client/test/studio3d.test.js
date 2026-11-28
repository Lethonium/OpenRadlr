import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTRUCTOR, ROOM, STUDIO_CAMERAS, StudioView3D, seatPosition, shownInRoom, studioCamera } from "../public/js/view3d/studioScene.js";
import { lookAt } from "../public/js/view3d/math.js";
import { fakeEngine } from "./support/fakeEngine.js";
import { COACH_KIT, coachId } from "../public/js/view3d/studioLayout.js";
import { encodeLook, rolledChoice } from "../public/js/profile/riderLook.js";

test("seats: two rows of eight facing the stage, the back row raised", () => {
  const front = [0, 1, 2, 3, 4, 5, 6, 7].map(seatPosition);
  const back = [8, 9, 10, 11, 12, 13, 14, 15].map(seatPosition);
  assert.ok(front.every((p) => p[2] === front[0][2] && p[1] === 0));
  assert.ok(back.every((p) => p[2] > front[0][2] && p[1] > 0), "behind and on a riser");
  for (let i = 1; i < 8; i += 1) assert.ok(front[i][0] - front[i - 1][0] >= 1.2, "room between bikes");
  assert.ok(Math.abs(front[3][0] + front[4][0]) < 1e-9, "seats 3 and 4 frame the middle");
  assert.ok(INSTRUCTOR.position[2] < front[0][2] - 3, "the instructor rides in front");
  assert.ok([...front, ...back].every((p) => Math.abs(p[0]) < ROOM.halfWidth - 0.8 && p[2] < ROOM.back - 0.8));
});

test("every camera stays inside the room and looks towards its target", () => {
  for (const mode of STUDIO_CAMERAS) {
    for (const seat of [0, 3, 15]) {
      const { eye, target } = studioCamera(mode, seat);
      assert.ok(Math.abs(eye[0]) < ROOM.halfWidth && eye[2] > ROOM.front && eye[2] < ROOM.back, `${mode} eye inside`);
      assert.ok(eye[1] > 0.5 && eye[1] < ROOM.height, `${mode} eye height`);
      assert.notDeepEqual(eye, target);
    }
  }
  const { eye } = studioCamera("seat", 3);
  assert.ok(eye[2] > seatPosition(3)[2], "behind my bike");
});

test("the room-only view keeps my bike in my own point of view", () => {
  const placed = [
    { rider: { id: 7 }, position: seatPosition(3) },
    { rider: { id: 8 }, position: seatPosition(12) },
  ];
  const eye = studioCamera("pov", 3).eye;
  assert.deepEqual(shownInRoom(placed, 7, eye).map(({ rider }) => rider.id), [7, 8]);
});

const COLORS = { me: "#f00", human: "#0f0", bot: "#00f", accent: "#ff0" };
const CANVAS = { clientWidth: 320, clientHeight: 200 };

function frameOf(riders, extra = {}) {
  return { riders, myId: 7, myCadence: 80, coachCadence: 90, timeS: 1, colors: COLORS, ...extra };
}

const rider = (id, seat) => ({ id, name: `R${id}`, is_bot: false, seat, cadence: 80, speed: 5 });

/** Runs `body` with a document that makes label elements, and puts it back. */
function withDocument(body) {
  const realDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ className: "", style: {}, append() {}, remove() {}, hidden: false, textContent: "" }) };
  try {
    return body();
  } finally {
    globalThis.document = realDocument;
  }
}

const studioView = (options = {}, canvas = CANVAS) => new StudioView3D(canvas, { append() {} }, { engine: fakeEngine(), reducedMotion: true, ...options });

test("the room-only view keeps My view still with reduced motion", () => {
  const view = new StudioView3D({}, null, { engine: fakeEngine(), reducedMotion: true });
  view.cameraMode = "pov";
  assert.deepEqual(view.cameraPose(3, 90, 0.17), view.cameraPose(3, 90, 0));
  view.dispose();
});

test("the room-only view bobs My view with cadence otherwise", () => {
  const view = new StudioView3D({}, null, { engine: fakeEngine() });
  view.cameraMode = "pov";
  assert.notDeepEqual(view.cameraPose(3, 90, 0.17), view.cameraPose(3, 90, 0));
  view.dispose();
});

test("a studio frame is drawn by the engine and carries the seat camera's view", () => {
  const engine = fakeEngine();
  const view = studioView({ engine });
  withDocument(() => view.render(frameOf([rider(7, 3)])));
  assert.deepEqual(engine.calls, ["beginFrame", "renderScene", "present"]);
  const { eye, target } = view.cameraPose(3, 80, 1);
  const { camera } = engine.scenes[0];
  assert.deepEqual([...camera.matrixWorldInverse.elements], [...lookAt(eye, target)]);
  assert.equal(engine.presented[0].env.night, 0);
  assert.ok(engine.presented[0].env.exposure > 0);
  view.dispose();
});

test("it draws the room and the riders", () => {
  const engine = fakeEngine();
  const view = studioView({ engine });
  withDocument(() => view.render(frameOf([rider(7, 3), rider(8, 9), rider(9, 12)])));
  const { scene } = engine.scenes[0];
  assert.ok(scene.getObjectByName("studio-room"), "the room is in the scene");
  assert.deepEqual(view.riderLayer.stats(), { full: 4, cheap: 0, ghosts: 0 }, "three riders and the coach");
  view.dispose();
});

test("my own point of view leaves my body out", () => {
  const view = studioView();
  const bodyShown = () => {
    let shown = false;
    view.riderLayer.cyclistOf(7).rider.object.traverse((child) => {
      if (child.isSkinnedMesh && child.visible) shown = true;
    });
    return shown;
  };
  withDocument(() => view.render(frameOf([rider(7, 3), rider(8, 9)])));
  assert.ok(bodyShown(), "seen from behind");
  view.cameraMode = "pov";
  withDocument(() => view.render(frameOf([rider(7, 3), rider(8, 9)], { timeS: 2 })));
  assert.ok(view.riderLayer.cyclistOf(7), "my bike stays");
  assert.ok(!bodyShown(), "in my point of view");
  view.dispose();
});

test("my look (here the classic rider) is mine only, and my point of view still hides its body", () => {
  const view = studioView();
  const entries = [];
  const update = view.riderLayer.update;
  view.riderLayer.update = (frame) => (entries.push(...frame.riders), update(frame));
  view.setMyLook(encodeLook({ ...rolledChoice(1), style: "classic" }));
  view.cameraMode = "pov";
  withDocument(() => view.render(frameOf([rider(7, 3), rider(8, 9)])));
  const mine = entries.find((e) => e.id === 7);
  assert.equal(mine.classic, true);
  assert.equal(mine.hideBody, true);
  assert.ok(!entries.find((e) => e.id === 8).classic);
  assert.ok(!entries.find((e) => e.id === coachId(0)).classic);
  view.setMyLook(null);
  entries.length = 0;
  withDocument(() => view.render(frameOf([rider(7, 3)], { timeS: 2 })));
  assert.ok(!entries.find((e) => e.id === 7).classic);
  view.dispose();
});

test("the coach stays drawn when the camera is on top of them", () => {
  const eye = studioCamera("coach", 3).eye;
  const placed = [
    { rider: { id: -1, coach: true }, position: [eye[0], 0, eye[2]] },
    { rider: { id: 8 }, position: [eye[0], 0, eye[2]] },
  ];
  assert.deepEqual(shownInRoom(placed, 7, eye).map(({ rider }) => rider.id), [-1]);
  const view = studioView();
  view.cameraMode = "coach";
  withDocument(() => view.render(frameOf([rider(7, 3)])));
  assert.ok(view.riderLayer.cyclistOf(coachId(0)), "the coach is drawn");
  view.dispose();
});

test("the coach wears lemon yellow, not the theme's accent", () => {
  const view = studioView();
  const entries = [];
  const update = view.riderLayer.update;
  view.riderLayer.update = (frame) => (entries.push(...frame.riders), update(frame));
  withDocument(() => view.render(frameOf([rider(7, 3)], { colors: { ...COLORS, accent: "#ff7a1a" } })));
  const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const expected = [1, 3, 5].map((i) => linear(Number.parseInt(COACH_KIT.slice(i, i + 2), 16) / 255));
  assert.equal(COACH_KIT, "#f5d000");
  assert.deepEqual(entries.find((entry) => entry.id === coachId(0)).tint, expected);
  view.dispose();
});

test("the room-only view takes every graphics level and ignores unknown ones", () => {
  const engine = fakeEngine();
  const view = studioView({ engine });
  for (const level of ["low", "medium", "high", "ultra"]) {
    view.setQuality(level);
    assert.equal(view.quality, level);
  }
  view.setQuality("potato");
  assert.equal(view.quality, "ultra");
  assert.ok(engine.qualities.length >= 5, "the engine follows the level");
  view.dispose();
});

test("disposing frees the scene but not the engine", () => {
  const engine = fakeEngine();
  engine.dispose = () => assert.fail("the engine is shared");
  const view = studioView({ engine });
  const { tracker } = view;
  withDocument(() => view.render(frameOf([rider(7, 3), rider(8, 9)])));
  assert.ok(tracker.live() > 0);
  view.dispose();
  assert.equal(tracker.live(), 0);
});
