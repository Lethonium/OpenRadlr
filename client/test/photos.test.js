import { test } from "node:test";
import assert from "node:assert/strict";
import { PhotoAlbum, canShareFiles, composeSummary, photoActions, downsample, photoFileName, photoStats } from "../public/js/view/photos.js";

test("names photo files after the date, route and number", () => {
  const t = new Date(2026, 9, 14, 15, 30).getTime();
  assert.equal(photoFileName(t, "rolling-hills", 3), "openradlr-2026-10-14-1530-rolling-hills-3.png");
  assert.equal(photoFileName(t, "Col de la Forge!", "summary"), "openradlr-2026-10-14-1530-col-de-la-forge-summary.png");
  assert.equal(photoFileName(t, "", ""), "openradlr-2026-10-14-1530-ride.png");
});

function album(max) {
  const revoked = [];
  let n = 0;
  const photos = new PhotoAlbum({ max, createUrl: () => `blob:${(n += 1)}`, revokeUrl: (url) => revoked.push(url) });
  return { photos, revoked };
}

test("the album keeps photos in order and drops the oldest beyond the limit", () => {
  const { photos, revoked } = album(2);
  photos.add("a", { name: "a.png", takenAt: 1 });
  photos.add("b", { name: "b.png", takenAt: 2 });
  photos.add("c", { name: "c.png", takenAt: 3 });
  assert.deepEqual(photos.photos.map((p) => p.name), ["b.png", "c.png"]);
  assert.deepEqual(revoked, ["blob:1"]);
  assert.equal(photos.size, 2);
});

test("removing a photo frees its URL", () => {
  const { photos, revoked } = album(5);
  const first = photos.add("a", { name: "a.png" });
  photos.add("b", { name: "b.png" });
  assert.equal(photos.remove(first.id), true);
  assert.equal(photos.remove(first.id), false);
  assert.deepEqual(revoked, ["blob:1"]);
  assert.deepEqual(photos.photos.map((p) => p.name), ["b.png"]);
});

test("clearing the album for the next ride frees every URL", () => {
  const { photos, revoked } = album(5);
  photos.add("a", { name: "a.png" });
  photos.setSummary("s", { name: "summary.png" });
  photos.clear();
  assert.deepEqual(photos.images, []);
  assert.equal(photos.size, 0);
  assert.deepEqual(revoked.sort(), ["blob:1", "blob:2"]);
});

test("the summary image comes first among the ride's images and is replaced, not added", () => {
  const { photos, revoked } = album(1);
  assert.deepEqual(photos.images, []);
  photos.add("a", { name: "a.png", takenAt: 1 });
  photos.setSummary("s1", { name: "summary.png", takenAt: 0 });
  photos.setSummary("s2", { name: "summary.png", takenAt: 0 });
  photos.add("b", { name: "b.png", takenAt: 2 });
  assert.deepEqual(photos.images.map((p) => p.blob), ["s2", "b"], "the photo limit doesn't count the summary");
  assert.equal(photos.images[0].summary, true);
  assert.equal(photos.size, 1, "size counts photos only");
  assert.deepEqual(revoked, ["blob:2", "blob:1"], "the old summary and the dropped photo free their URLs");
});

test("photo stats show distance, time, power, speed and grade", () => {
  const stats = photoStats({ distanceM: 12345, elapsedS: 3725, power: 231.6, speed: 10, gradePercent: -4.25 });
  assert.deepEqual(stats, [
    ["Distance", "12.35 km"],
    ["Time", "1:02:05"],
    ["Power", "232 W"],
    ["Speed", "36.0 km/h"],
    ["Grade", "−4.3 %"],
  ]);
  assert.equal(photoStats({ distanceM: 0, elapsedS: 0, power: undefined, speed: undefined, gradePercent: 0 })[2][1], "0 W");
});

test("downsampling averages buckets and keeps short series", () => {
  assert.deepEqual(downsample([1, 2, 3], 5), [1, 2, 3]);
  assert.deepEqual(downsample([1, 3, 5, 7, 9, 11], 3), [2, 6, 10]);
  assert.equal(downsample(Array.from({ length: 1000 }, (_, i) => i), 240).length, 240);
});

test("sharing files is offered only where the browser supports it", () => {
  assert.equal(canShareFiles(undefined), false);
  assert.equal(canShareFiles({}), false);
  assert.equal(canShareFiles({ canShare: ({ files }) => files.length === 1 }), true);
  assert.equal(canShareFiles({ canShare: () => { throw new Error("nope"); } }), false);
});

/** A canvas document whose 2D context records the text drawn on it. */
function recordingDoc() {
  const texts = [];
  const state = { font: "10px sans-serif", textAlign: "left" };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return (text) => ({ width: text.length * Number(/(\d+)px/.exec(target.font)[1]) * 0.6 });
      if (key === "fillText") return (text, x, y) => texts.push({ text, x, y, align: target.textAlign, width: ctx.measureText(text).width });
      if (key === "createLinearGradient") return () => ({ addColorStop() {} });
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return { doc: { createElement: () => canvas }, texts };
}

const RIDE = {
  routeName: "Col de la Forge",
  serverName: "OpenRadlr",
  when: new Date(2026, 10, 10, 15, 48),
  stats: [["Time", "1:02:38"], ["Distance", "30.53 km"], ["Avg power", "168 W"], ["Max power", "484 W"], ["Elevation", "510 m"], ["Work", "831 kJ"]],
  power: [100, 200, 150],
  elevation: [10, 20, 15],
};

test("the summary card is 4:3, the shape Strava shows photos in, so it isn't cropped", () => {
  const { doc } = recordingDoc();
  const canvas = composeSummary(RIDE, doc);
  assert.equal(canvas.width * 3, canvas.height * 4);
});

test("the summary card keeps all its text clear of the edges", () => {
  const { doc, texts } = recordingDoc();
  const canvas = composeSummary(RIDE, doc);
  const margin = canvas.width * 0.04;
  const outside = texts.filter(({ x, y, align, width }) => {
    const from = align === "right" ? x - width : x;
    return from < margin || from + width > canvas.width - margin || y < margin || y > canvas.height - margin;
  });
  assert.deepEqual(outside.map((t) => t.text), []);
});


test("the summary has its own save action without a duplicate save-all action", () => {
  const { photos } = album();
  photos.setSummary("summary", { name: "summary.png" });
  assert.deepEqual(photoActions(photos, false), { summaryEnabled: true, allVisible: false, shareVisible: false });
});

test("ride photos can be saved and shared before the summary is ready", () => {
  const { photos } = album();
  photos.add("photo", { name: "photo.png" });
  assert.deepEqual(photoActions(photos, true), { summaryEnabled: false, allVisible: true, shareVisible: true });
});
