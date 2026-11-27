import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BOARDS, MyBoards, UPLOAD_SIZE, prepareImage } from "../public/js/profile/myBoards.js";

function mapStore() {
  const map = new Map();
  return {
    map,
    get: async (key) => map.get(key),
    put: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    keys: async () => [...map.keys()],
  };
}

function boards(options = {}) {
  let time = 1000;
  const store = mapStore();
  return { store, boards: new MyBoards({ store, now: () => (time += 1), ...options }) };
}

const blob = (size = 3) => new Blob([new Uint8Array(size)], { type: "image/jpeg" });

test("MAX_BOARDS and UPLOAD_SIZE", () => {
  assert.equal(MAX_BOARDS, 12);
  assert.deepEqual(UPLOAD_SIZE, { width: 1024, height: 512 });
});

test("add, list (oldest first) and remove round trip", async () => {
  const { boards: mine } = boards();
  const first = await mine.add({ text: "  Ride on  " });
  const second = await mine.add({ blob: blob(), text: "" });
  assert.equal(first.ok, true);
  assert.notEqual(first.id, second.id);
  const list = await mine.list();
  assert.deepEqual(list.map((entry) => entry.id), [first.id, second.id]);
  assert.equal(list[0].text, "Ride on");
  assert.equal(list[0].blob, null);
  assert.ok(list[1].blob instanceof Blob);
  assert.equal(list[1].text, "");
  assert.ok(list[0].addedAt < list[1].addedAt);
  await mine.remove(first.id);
  assert.deepEqual((await mine.list()).map((entry) => entry.id), [second.id]);
});

test("ids look like b-<time>-<counter>", async () => {
  const { boards: mine } = boards();
  const { id } = await mine.add({ text: "a" });
  assert.match(id, /^b-\d+-\d+$/);
});

test("the 13th add is refused as full", async () => {
  const { boards: mine, store } = boards();
  for (let i = 0; i < MAX_BOARDS; i += 1) assert.equal((await mine.add({ text: `t${i}` })).ok, true);
  assert.deepEqual(await mine.add({ text: "one more" }), { ok: false, reason: "full" });
  assert.equal(store.map.size, MAX_BOARDS);
});

test("adds started together still respect the cap", async () => {
  const { boards: mine, store } = boards();
  const results = await Promise.all(Array.from({ length: MAX_BOARDS + 3 }, (_, i) => mine.add({ text: `t${i}` })));
  assert.equal(results.filter((r) => r.ok).length, MAX_BOARDS);
  assert.equal(store.map.size, MAX_BOARDS);
});

test("nothing to show is refused as empty", async () => {
  const { boards: mine, store } = boards();
  assert.deepEqual(await mine.add({}), { ok: false, reason: "empty" });
  assert.deepEqual(await mine.add({ text: "   " }), { ok: false, reason: "empty" });
  assert.equal(store.map.size, 0);
});

test("81 characters are too long, 80 are fine", async () => {
  const { boards: mine } = boards();
  assert.deepEqual(await mine.add({ text: "x".repeat(81) }), { ok: false, reason: "tooLong" });
  assert.equal((await mine.add({ text: "x".repeat(80) })).ok, true);
});

test("a store that refuses gives a reason, not a throw", async () => {
  const store = { ...mapStore(), put: async () => { throw new Error("quota"); } };
  const mine = new MyBoards({ store });
  assert.deepEqual(await mine.add({ text: "a" }), { ok: false, reason: "storage" });
});

function fakeCanvasFactory() {
  const made = [];
  const createCanvas = (width, height) => {
    const draws = [];
    const canvas = {
      width,
      height,
      draws,
      getContext: () => ({ drawImage: (...args) => draws.push(args), fillRect() {}, set fillStyle(_) {} }),
      convertToBlob: async (options) => Object.assign(new Blob(["jpeg"], { type: options.type }), { quality: options.quality }),
    };
    made.push(canvas);
    return canvas;
  };
  return { made, createCanvas };
}

const bitmap = (width, height) => ({ width, height, close() {} });

test("prepareImage draws into 1024x512 and re-encodes as JPEG 0.85", async () => {
  const { made, createCanvas } = fakeCanvasFactory();
  let encoded = null;
  const wrapped = (w, h) => {
    const canvas = createCanvas(w, h);
    const convert = canvas.convertToBlob;
    canvas.convertToBlob = async (options) => ((encoded = options), convert(options));
    return canvas;
  };
  const result = await prepareImage(blob(), { x: 0.5, y: 0.5, scale: 1 }, { decode: async () => bitmap(4000, 3000), createCanvas: wrapped });
  assert.equal(result.ok, true);
  assert.ok(result.blob instanceof Blob);
  assert.deepEqual([made[0].width, made[0].height], [1024, 512]);
  assert.deepEqual(encoded, { type: "image/jpeg", quality: 0.85 });
});

test("rejects an image the browser cannot decode", async () => {
  const { made, createCanvas } = fakeCanvasFactory();
  const result = await prepareImage(blob(), { x: 0, y: 0, scale: 1 }, { decode: async () => { throw new Error("EncodingError"); }, createCanvas });
  assert.deepEqual(result, { ok: false, reason: "unreadable" });
  assert.equal(made.length, 0);
});

test("an image that fails to encode is unreadable too", async () => {
  const createCanvas = (width, height) => ({ width, height, getContext: () => ({ drawImage() {}, fillRect() {} }), convertToBlob: async () => { throw new Error("no"); } });
  const result = await prepareImage(blob(), { x: 0, y: 0, scale: 1 }, { decode: async () => bitmap(100, 100), createCanvas });
  assert.deepEqual(result, { ok: false, reason: "unreadable" });
});

test("a panorama is cropped, not squashed", async () => {
  const { made, createCanvas } = fakeCanvasFactory();
  await prepareImage(blob(), { x: 0.5, y: 0.5, scale: 1 }, { decode: async () => bitmap(10000, 200), createCanvas });
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = made[0].draws[0];
  assert.equal(sw / sh, 2);
  assert.deepEqual([sw, sh], [400, 200]);
  assert.equal(sx, 4800); // centred
  assert.equal(sy, 0);
  assert.deepEqual([dx, dy, dw, dh], [0, 0, 1024, 512]);
});

test("the crop position and zoom move and shrink the window", async () => {
  const { made, createCanvas } = fakeCanvasFactory();
  await prepareImage(blob(), { x: 1, y: 0, scale: 2 }, { decode: async () => bitmap(2000, 2000), createCanvas });
  const [, sx, sy, sw, sh] = made[0].draws[0];
  assert.deepEqual([sw, sh], [1000, 500]); // 2000x1000 cover window, zoomed 2x
  assert.deepEqual([sx, sy], [1000, 0]);
});
