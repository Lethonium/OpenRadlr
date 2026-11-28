import { test } from "node:test";
import assert from "node:assert/strict";

import { createSpriteStore, DEFAULT_LOOK } from "../public/js/view2d/sprites/spriteStore.js";
import { SpriteBakerUnavailable } from "../public/js/view2d/sprites/baker.js";
import { drawSprite } from "../public/js/view2d/drawSprite.js";
import { riderJob, spriteJobs } from "../public/js/view2d/sprites/catalog.js";
import { lookOf } from "../public/js/view3d/assets/riders/look.js";
import { fakeCanvas } from "./support/fakeCanvas.js";

/** A store on a fake clock: every bake costs `cost` ms and `bytes` bytes. */
function rig({ cost = 2, bytes = 100, budgetMs = 6, maxBytes, fail = () => false } = {}) {
  const clock = { t: 0 };
  const baked = [];
  const bake = (job) => {
    clock.t += cost;
    if (fail(job)) throw new Error("asset broke");
    baked.push(job.key);
    return { frames: [{ id: job.key }], ox: 5, oy: 7, ppm: job.ppm, bytes };
  };
  const store = createSpriteStore({ bake, now: () => clock.t, budgetMs, ...(maxBytes ? { maxBytes } : {}) });
  return { store, baked, clock };
}

const dayJobs = spriteJobs({ view: "side" });

test("spriteStore: pump bakes by priority, lowest first, until the budget is spent", () => {
  const { store, baked } = rig({ cost: 2, budgetMs: 6 });
  store.want(dayJobs[0], 5);
  store.want(dayJobs[1], 1);
  store.want(dayJobs[2], 3);
  store.want(dayJobs[3], 2);
  assert.equal(store.pump(), 3);
  assert.deepEqual(baked, [dayJobs[1].key, dayJobs[3].key, dayJobs[2].key]);
  assert.equal(store.pump(), 1);
  assert.equal(store.pump(), 0);
});

test("spriteStore: a job asked for twice is baked once; get is null until then", () => {
  const { store, baked } = rig();
  const job = dayJobs[0];
  assert.equal(store.get(job.key), null);
  store.want(job, 1);
  store.want(job, 1);
  assert.equal(store.get(job.key), null);
  store.pump();
  store.want(job, 1);
  store.pump();
  assert.deepEqual(baked, [job.key]);
  assert.equal(store.get(job.key).ox, 5);
  assert.equal(store.bytes(), 100);
});

test("spriteStore: asking again with a lower priority moves a job forward", () => {
  const { store, baked } = rig({ budgetMs: 1 });
  store.want(dayJobs[0], 5);
  store.want(dayJobs[1], 4);
  store.want(dayJobs[0], 1);
  store.pump();
  assert.deepEqual(baked, [dayJobs[0].key]);
});

test("spriteStore: a rider not baked yet is drawn with the default look, and its look is asked for", () => {
  const { store, baked } = rig({ budgetMs: 100 });
  const look = lookOf(77);
  assert.equal(store.rider(look, "side"), null);
  store.pump();
  assert.equal(baked[0], riderJob(DEFAULT_LOOK, "side").key);
  assert.equal(baked[1], riderJob(look, "side").key);
  assert.equal(store.rider(look, "side").frames[0].id, riderJob(look, "side").key);
  assert.equal(store.rider(lookOf(78), "side").frames[0].id, riderJob(DEFAULT_LOOK, "side").key);
});

test("spriteStore: 100 looks bake over several pumps, never past the budget", () => {
  const { store, baked, clock } = rig({ cost: 2, budgetMs: 6 });
  let pumps = 0;
  while (true) {
    // The view asks for every rider it draws, each frame.
    for (let id = 1; id <= 100; id++) store.rider(lookOf(id), "side");
    const before = clock.t;
    const count = store.pump();
    if (count === 0) break;
    pumps += 1;
    assert.ok(clock.t - before <= 6 + 2, "one bake past the budget at most");
    assert.ok(count <= 3);
  }
  assert.equal(baked.length, 101);
  assert.equal(new Set(baked).size, 101);
  assert.ok(pumps > 30);
});

test("spriteStore: at night the day sprite shows until the night one is baked", () => {
  const { store, baked } = rig({ budgetMs: 100 });
  const house = dayJobs.find((job) => job.id === "house");
  const plant = dayJobs.find((job) => job.id === "pine");
  store.want(house, 1);
  store.want(plant, 1);
  store.pump();
  store.setNight(true);
  assert.equal(store.get(house.key).frames[0].id, house.key, "day sprite until the night bake");
  assert.equal(store.get(plant.key).frames[0].id, plant.key);
  store.pump();
  const night = spriteJobs({ view: "side", night: true }).find((job) => job.id === "house" && job.options.style === house.options.style && job.yaw === house.yaw);
  assert.ok(baked.includes(night.key));
  assert.equal(store.get(house.key).frames[0].id, night.key);
  assert.equal(store.get(plant.key).frames[0].id, plant.key, "no night variant, still the day sprite");
  assert.equal(baked.filter((key) => key.startsWith("side-night:")).length, 1, "only what was wanted");
  store.setNight(false);
  assert.equal(store.get(house.key).frames[0].id, house.key);
});

test("spriteStore: a job wanted while it is night also asks for its night variant", () => {
  const { store, baked } = rig({ budgetMs: 100 });
  store.setNight(true);
  const lamp = dayJobs.find((job) => job.id === "streetLamp");
  store.want(lamp, 1);
  store.pump();
  assert.equal(baked.length, 2);
  assert.ok(baked.some((key) => key.startsWith("side-night:")));
});

test("spriteStore: setNight(true) again changes nothing, so a frame's call costs no night asks", () => {
  const { store, baked } = rig({ budgetMs: 100, bytes: 100, maxBytes: 150 });
  const house = dayJobs.find((job) => job.id === "house");
  const plant = dayJobs.find((job) => job.id === "pine");
  store.want(house, 1);
  store.pump();
  store.setNight(true);
  store.pump(); // the house's night variant; the cap drops the day house
  store.want(plant, 1);
  store.pump(); // the plant has no night variant; the cap drops the least recently used, the house's night variant
  const count = baked.length;
  store.setNight(true);
  assert.equal(store.pump(), 0, "the dropped night variant is not asked for again");
  assert.equal(baked.length, count);
});

test("spriteStore: past maxBytes the least recently used riders go first, scenery last", () => {
  const { store } = rig({ bytes: 100, budgetMs: 1000, maxBytes: 850 });
  const scenery = dayJobs.slice(0, 2);
  scenery.forEach((job) => store.want(job, 0));
  const looks = [1, 2, 3, 4].map(lookOf);
  looks.forEach((look) => store.rider(look, "side"));
  store.pump();
  assert.equal(store.bytes(), 700);
  store.rider(looks[0], "side"); // touch: look 2 is now the oldest
  store.rider(lookOf(5), "side");
  store.rider(lookOf(6), "side");
  store.pump();
  assert.ok(store.bytes() <= 850);
  assert.equal(store.get(riderJob(looks[1], "side").key), null, "least recently used rider dropped");
  assert.ok(store.get(riderJob(looks[0], "side").key));
  assert.ok(store.get(riderJob(DEFAULT_LOOK, "side").key), "the default look stays");
  scenery.forEach((job) => assert.ok(store.get(job.key)));
});

test("spriteStore: a bake that throws is listed and the rest still bake", () => {
  const { store, baked } = rig({ budgetMs: 100, fail: (job) => job.id === "pine" });
  const pine = dayJobs.find((job) => job.id === "pine");
  const bush = dayJobs.find((job) => job.id === "bush");
  store.want(pine, 1);
  store.want(bush, 2);
  assert.equal(store.pump(), 1);
  assert.deepEqual(store.failed(), [pine.key]);
  assert.deepEqual(baked, [bush.key]);
  assert.equal(store.get(pine.key), null);
  store.want(pine, 1);
  assert.equal(store.pump(), 0, "a failed job is not retried");
});

test("drawSprite: draws the frame with its anchor at x, y, scaled to pixels per metre", () => {
  const { canvas, images } = fakeCanvas();
  const ctx = canvas.getContext("2d");
  const sprite = { frames: [{ n: 0, width: 40, height: 60 }, { n: 1, width: 40, height: 60 }], ox: 10, oy: 20, ppm: 20 };
  drawSprite(ctx, sprite, 100, 200, 10, { frame: 1 });
  assert.equal(images.length, 1);
  assert.equal(images[0].image.n, 1);
  assert.deepEqual(images[0].args, [100 - 5, 200 - 10, 20, 30]);
  drawSprite(ctx, sprite, 100, 200, 20, { frame: 7 });
  assert.equal(images[1].image.n, 1, "the frame wraps");
});

/** A store whose baker steps: each job takes `steps` steps of `cost` ms; records every step and cancel. */
function steppingRig({ steps = 4, cost = 2, budgetMs = 6, lose = () => false } = {}) {
  const clock = { t: 0 };
  const log = [];
  const start = (job) => {
    let done = 0;
    return {
      step() {
        if (lose(job, done)) throw new SpriteBakerUnavailable(new Error("lost"));
        clock.t += cost;
        done += 1;
        log.push(`${job.key}#${done}`);
        return done < steps ? null : { frames: [{ id: job.key }], ox: 0, oy: 0, ppm: job.ppm, bytes: 100 };
      },
      cancel: () => log.push(`${job.key} cancelled`),
    };
  };
  const bake = () => assert.fail("a store with start bakes step by step");
  const store = createSpriteStore({ bake, start, now: () => clock.t, budgetMs });
  return { store, log, clock };
}

test("spriteStore: a job of many frames is baked across pumps, never past the budget in one", () => {
  const { store, log, clock } = steppingRig({ steps: 12, cost: 2, budgetMs: 6 });
  const job = riderJob({ primary: "#e8473f" }, "side");
  let pumps = 0;
  while (!store.get(job.key)) {
    const before = clock.t;
    store.want(job, 0);
    store.pump();
    assert.ok(clock.t - before <= 6, `pump ${pumps} took ${clock.t - before} ms`);
    pumps += 1;
    assert.ok(pumps < 20, "it finishes");
  }
  assert.equal(pumps, 4);
  assert.equal(log.length, 12);
});

test("spriteStore: a rider's look no longer asked for leaves the queue unbaked; scenery stays queued", () => {
  // One bake a pump.
  const { store, log } = steppingRig({ steps: 1, cost: 2, budgetMs: 2 });
  const [near, far] = [riderJob(lookOf(1), "top"), riderJob(lookOf(2), "top")];
  store.want(far, 50);
  store.want(dayJobs[0], 60);
  store.want(near, 0);
  store.pump();
  // From the next frame on only `near` is asked for: `far` rode out of the view.
  for (let frame = 0; frame < 3; frame += 1) {
    store.want(near, 0);
    store.pump();
  }
  assert.deepEqual(log, [`${near.key}#1`, `${dayJobs[0].key}#1`]);
});

test("spriteStore: a rider's look half baked and no longer asked for is cancelled", () => {
  const { store, log } = steppingRig({ steps: 12, cost: 2, budgetMs: 4 });
  const job = riderJob({ primary: "#2f5f9e" }, "side");
  store.want(job, 0);
  store.pump();
  for (let frame = 0; frame < 3; frame += 1) store.pump();
  assert.ok(log.includes(`${job.key} cancelled`), log.join(", "));
  assert.equal(store.get(job.key), null);
});

test("spriteStore: a lost WebGL context stops the pump with SpriteBakerUnavailable and fails no job", () => {
  const { store } = steppingRig({ steps: 2, lose: (job, done) => done === 1 });
  store.want(dayJobs[0], 0);
  assert.throws(() => store.pump(), SpriteBakerUnavailable);
  assert.deepEqual(store.failed(), []);
});
