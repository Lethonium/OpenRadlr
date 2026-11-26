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
