import { test } from "node:test";
import assert from "node:assert/strict";

import { createSpriteBaker, SpriteBakerUnavailable } from "../public/js/view2d/sprites/baker.js";
import { riderJob, spriteJobs } from "../public/js/view2d/sprites/catalog.js";
import { fakeRenderer } from "./support/fakeRenderer.js";

/** A canvas that only remembers its size and what was drawn onto it. */
function fakeCanvas() {
  const canvas = { width: 300, height: 150, drawn: [] };
  canvas.getContext = () => ({ drawImage: (...args) => canvas.drawn.push(args) });
  return canvas;
}

function bakerWith(season = "summer") {
  const renderer = fakeRenderer();
  const baker = createSpriteBaker({ season, createRenderer: () => renderer, createCanvas: fakeCanvas });
  return { baker, renderer };
}

const job = (id, view = "side") => spriteJobs({ view }).find((candidate) => candidate.id === id);

test("baker: a plant becomes one frame no larger than 512 with its ground point inside it", () => {
  const { baker } = bakerWith();
  const sprite = baker.bake(job("broadleaf"));
  assert.equal(sprite.frames.length, 1);
  const [frame] = sprite.frames;
  assert.ok(frame.width > 1 && frame.width <= 512 && frame.height > 1 && frame.height <= 512, `${frame.width}x${frame.height}`);
  assert.ok(sprite.ox >= 0 && sprite.ox <= frame.width && sprite.oy >= 0 && sprite.oy <= frame.height, `${sprite.ox},${sprite.oy}`);
  assert.equal(sprite.bytes, frame.width * frame.height * 4);
  baker.dispose();
});

test("baker: a side rider is 12 frames, each drawn from a render", () => {
  const { baker, renderer } = bakerWith();
  const sprite = baker.bake(riderJob({ primary: "#e8473f" }, "side"));
  assert.equal(sprite.frames.length, 12);
  assert.equal(renderer.calls.renders.length, 12);
  assert.equal(sprite.bytes, 12 * sprite.frames[0].width * sprite.frames[0].height * 4);
  baker.dispose();
});

test("baker: a top sprite is shot from above with a shadow catcher in the scene", () => {
  const { baker, renderer } = bakerWith();
  baker.bake(job("cow", "top"));
  const camera = renderer.calls.cameras[0];
  assert.ok(camera.position.y > camera.position.x && camera.position.y > 10);
  baker.bake(job("cow", "side"));
  assert.equal(renderer.calls.scenes[1].getObjectByName("shadowCatcher").visible, false);
  assert.equal(renderer.calls.scenes[0].getObjectByName("shadowCatcher") !== undefined, true);
  baker.dispose();
});

test("baker: the asset is disposed after baking", () => {
  const { baker } = bakerWith();
  const before = baker.liveResources();
  for (const id of ["broadleaf", "farmstead", "cow"]) baker.bake(job(id));
  baker.bake(riderJob({}, "side"));
  assert.equal(baker.liveResources(), before);
  baker.dispose();
  assert.equal(baker.liveResources(), 0);
});

test("baker: a night job is lit as by day (the views' tint darkens it), and day jobs follow it", () => {
  const { baker, renderer } = bakerWith();
  baker.bake(job("house"));
  const day = renderer.toneMappingExposure;
  baker.bake(spriteJobs({ view: "side", night: true }).find((candidate) => candidate.id === "house"));
  assert.equal(renderer.toneMappingExposure, day);
  baker.bake(job("house"));
  assert.equal(renderer.toneMappingExposure, day);
  baker.dispose();
});

test("baker: a renderer that cannot be made is SpriteBakerUnavailable", () => {
  const createRenderer = () => {
    throw new Error("no WebGL2");
  };
  assert.throws(() => createSpriteBaker({ season: "summer", createRenderer, createCanvas: fakeCanvas }), SpriteBakerUnavailable);
});

test("baker: a job for an unknown asset throws an error naming it", () => {
  const { baker } = bakerWith();
  assert.throws(() => baker.bake({ ...job("broadleaf"), id: "no-such-thing" }), /no-such-thing/);
  baker.dispose();
});

test("probe: counts, times and sizes the baked sprites, and names the ones that fail", async () => {
  const { runProbe, describeProbe } = await import("../public/js/view2d/probe.js");
  const baker = {
    bake(job) {
      if (job.id === "cow") throw new Error("boom");
      return { bytes: 1024 * 1024 };
    },
  };
  let t = 0;
  const jobs = [job("broadleaf"), job("cow"), job("pine")];
  const result = runProbe(baker, jobs, () => (t += 10));
  assert.equal(result.count, 2);
  assert.equal(result.megabytes, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /cow.*boom/);
  const text = describeProbe(result, "summer", "UA");
  assert.match(text, /sprites: 2 \(1 failed\)/);
  assert.match(text, /memory: 2\.0 MB/);
  assert.match(text, /userAgent: UA/);
});

test("probe: the job list holds both views, day and night, and six rider looks each", async () => {
  const { probeJobs } = await import("../public/js/view2d/probe.js");
  const jobs = probeJobs();
  assert.equal(new Set(jobs.map((entry) => entry.key)).size, jobs.length);
  assert.equal(jobs.filter((entry) => entry.id === "cyclist").length, 12);
});

test("baker: dispose releases the WebGL context so only one stays live", () => {
  const { baker, renderer } = bakerWith();
  let lost = 0;
  renderer.forceContextLoss = () => (lost += 1);
  baker.dispose();
  assert.equal(lost, 1);
  assert.equal(renderer.calls.disposed, 1);
});

test("baker: dispose works on a renderer without forceContextLoss", () => {
  const { baker, renderer } = bakerWith();
  baker.dispose();
  assert.equal(renderer.calls.disposed, 1);
});

/** Runs a started job step by step; returns the sprite and how many renders each step made. */
function stepThrough(baker, renderer, task) {
  const perStep = [];
  for (;;) {
    const before = renderer.calls.renders.length;
    const sprite = task.step();
    perStep.push(renderer.calls.renders.length - before);
    if (sprite) return { sprite, perStep };
  }
}

test("baker: a started job renders at most one frame per step, so a side rider can wait between its frames", () => {
  const { baker, renderer } = bakerWith();
  const { sprite, perStep } = stepThrough(baker, renderer, baker.start(riderJob({ primary: "#e8473f" }, "side")));
  assert.equal(sprite.frames.length, 12);
  assert.ok(Math.max(...perStep) <= 1, `renders per step: ${perStep}`);
  const whole = baker.bake(riderJob({ primary: "#e8473f" }, "side"));
  const shape = ({ frames, ox, oy, ppm, bytes }) => [frames.length, frames[0].width, frames[0].height, ox, oy, ppm, bytes];
  assert.deepEqual(shape(sprite), shape(whole), "the same sprite as a bake in one go");
  baker.dispose();
});

test("baker: a job cancelled halfway frees its asset", () => {
  const { baker } = bakerWith();
  const before = baker.liveResources();
  const task = baker.start(riderJob({}, "side"));
  task.step();
  task.step();
  task.cancel();
  assert.equal(baker.liveResources(), before);
  baker.dispose();
});

/** A canvas that also takes event listeners, as the browser's does. */
function listeningCanvas() {
  const canvas = fakeCanvas();
  const listeners = {};
  canvas.addEventListener = (type, listener) => ((listeners[type] ??= []).push(listener));
  canvas.dispatch = (type) => listeners[type]?.forEach((listener) => listener({ type, preventDefault() {} }));
  return canvas;
}

test("baker: a context lost after the first sprite makes the next bake SpriteBakerUnavailable, not an empty sprite", () => {
  const renderer = fakeRenderer();
  let lost = false;
  renderer.getContext = () => ({ isContextLost: () => lost });
  const baker = createSpriteBaker({ season: "summer", createRenderer: () => renderer, createCanvas: fakeCanvas });
  assert.equal(baker.bake(job("broadleaf")).frames.length, 1);
  lost = true;
  assert.throws(() => baker.bake(job("pine")), SpriteBakerUnavailable);
  assert.equal(baker.lost(), true);
  baker.dispose();
});

test("baker: a context lost in the middle of a job ends it with SpriteBakerUnavailable", () => {
  const canvases = [];
  const make = () => {
    const canvas = listeningCanvas();
    canvases.push(canvas);
    return canvas;
  };
  const baker = createSpriteBaker({ season: "summer", createRenderer: () => fakeRenderer(), createCanvas: make });
  const task = baker.start(riderJob({}, "side"));
  task.step();
  canvases[0].dispatch("webglcontextlost");
  assert.throws(() => task.step(), SpriteBakerUnavailable);
  baker.dispose();
});

test("probe: with a stepping baker it reports the longest single step, the worst stall a ride sees", async () => {
  const { runProbe, describeProbe } = await import("../public/js/view2d/probe.js");
  let t = 0;
  const costs = { broadleaf: [3, 4], cow: [2, 9, 1] };
  const baker = {
    start(job) {
      const steps = [...costs[job.id]];
      return {
        step() {
          t += steps.shift();
          return steps.length ? null : { bytes: 1 };
        },
      };
    },
  };
  const result = runProbe(baker, [job("broadleaf"), job("cow")], () => t);
  assert.deepEqual(result.worstStep, { key: job("cow").key, ms: 9 });
  assert.equal(result.slowest[0].ms, 12, "a sprite's time is still all its steps");
  assert.match(describeProbe(result, "summer", "UA"), /longest step: 9 ms/);
});
