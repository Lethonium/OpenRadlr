import { test } from "node:test";
import assert from "node:assert/strict";
import { toLatLon } from "../public/js/route/geo.js";
import { clampGrades, detectClimbs, gpxToRoute, parseGpx, projectTrack, resample, simplify, smoothElevation } from "../public/js/route/gpxImport.js";

function haversine(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

const ORIGIN = { lat: 29, lon: -13.5 };

/** GPX text for a list of {x, y, ele} metres around ORIGIN. */
function gpxOf(points) {
  const pts = points.map((p) => {
    const { lat, lon } = toLatLon(p.x, p.y, ORIGIN);
    const ele = p.ele === undefined ? "" : `<ele>${p.ele}</ele>`;
    return `<trkpt lat="${lat}" lon="${lon}">${ele}</trkpt>`;
  });
  return `<gpx><trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

/** Elevation profile along a straight east-west line, closed by a return leg. */
function loopWith(profile, length = 6000, step = 10) {
  const out = [];
  for (let d = 0; d <= length; d += step) out.push({ x: d, y: 0, ele: profile(d) });
  for (let d = length - step; d > 0; d -= step) out.push({ x: d, y: 40, ele: profile(d) });
  out.push({ x: 0, y: 5, ele: profile(0) });
  return out;
}

const nodesOf = (profile, length = 3000) => {
  const nodes = [];
  for (let d = 0; d <= length; d += 10) nodes.push({ x: d, y: 0, elevation: profile(d) });
  return nodes;
};

test("parses trkpt in any attribute order, namespaced, over several segments", () => {
  const text = `<gpx xmlns:g="x"><trk>
    <trkseg><trkpt lat="1" lon="2"><ele>10</ele></trkpt><trkpt lat="1.1" lon="2.1"><ele>11</ele></trkpt></trkseg>
    <trkseg><g:trkpt lon="2.2" lat="1.2"><g:ele>12</g:ele></g:trkpt><trkpt lat="1.3" lon="2.3"><ele>13</ele></trkpt></trkseg>
    <trkseg><trkpt lat='1.4' lon='2.4'><ele>14</ele></trkpt><trkpt lat="1.5" lon="2.5"><ele>15</ele></trkpt></trkseg>
  </trk></gpx>`;
  const points = parseGpx(text);
  assert.equal(points.length, 6);
  assert.deepEqual(points.map((p) => p.ele), [10, 11, 12, 13, 14, 15]);
  assert.deepEqual(points[2], { lat: 1.2, lon: 2.2, ele: 12 });
});

test("interpolates missing elevation and rejects a track without any", () => {
  const text = `<gpx><trk><trkseg><trkpt lat="1" lon="1"><ele>10</ele></trkpt><trkpt lat="1" lon="1.1"/><trkpt lat="1" lon="1.2"><ele>20</ele></trkpt></trkseg></trk></gpx>`;
  assert.deepEqual(parseGpx(text).map((p) => p.ele), [10, 15, 20]);
  assert.throws(() => parseGpx(`<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>`), /no elevation/);
  assert.throws(() => parseGpx("<gpx/>"), /no track points/);
});

test("projection round-trips through toLatLon", () => {
  const track = [0, 5000, 12000, 20000].map((d, i) => ({ ...toLatLon(d, i * 3000, ORIGIN), ele: i }));
  const nodes = projectTrack(track);
  assert.deepEqual([nodes[0].x, nodes[0].y], [0, 0]);
  const last = nodes.at(-1);
  const measured = haversine(track[0], track.at(-1));
  assert.ok(Math.abs(Math.hypot(last.x, last.y) - measured) / measured < 0.0001);
});

test("resampling keeps the length within 0.1 % and spacing at 10 m", () => {
  const nodes = [{ x: 0, y: 0, elevation: 0 }, { x: 3000, y: 0, elevation: 30 }, { x: 3000, y: 4000, elevation: 10 }];
  const out = resample(nodes, 10);
  let length = 0;
  for (let i = 1; i < out.length; i++) {
    const gap = Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
    length += gap;
    if (i < out.length - 1) assert.ok(Math.abs(gap - 10) < 0.01, `gap ${gap}`);
  }
  assert.ok(Math.abs(length - 7000) / 7000 < 0.001);
  assert.deepEqual(out.at(-1), nodes.at(-1));
});

test("duplicate points do not create NaN", () => {
  const points = loopWith((d) => d / 100);
  const doubled = points.flatMap((p) => [p, p]);
  const { route } = gpxToRoute(gpxOf(doubled), { id: "x", name: "X" });
  for (const p of route.points) assert.ok(p.every(Number.isFinite));
});

test("clamps a 20 % ramp to 12 % over 50 m windows without changing total rise by more than 1 %", () => {
  const wall = (d) => (d < 1000 ? 0 : d < 1200 ? (d - 1000) * 0.2 : 40);
  const nodes = nodesOf(wall);
  const out = clampGrades(nodes, { max: 0.12 });
  for (let i = 0; i + 5 < out.length; i++) {
    assert.ok(Math.abs(out[i + 5].elevation - out[i].elevation) / 50 <= 0.12 + 1e-9, `at ${i * 10}`);
  }
  const rise = (ns) => ns.reduce((s, n, i) => s + (i ? Math.max(0, n.elevation - ns[i - 1].elevation) : 0), 0);
  assert.ok(Math.abs(rise(out) - rise(nodes)) / rise(nodes) < 0.01);
});

test("finds one climb of ~2 km on a synthetic 5 % ramp and merges across a 200 m dip", () => {
  const profile = (d) => (d < 500 ? 0 : d < 1500 ? (d - 500) * 0.05 : d < 1700 ? 50 : d < 2700 ? 50 + (d - 1700) * 0.05 : 100);
  const climbs = detectClimbs(smoothElevation(nodesOf(profile, 4000), 20));
  assert.equal(climbs.length, 1);
  assert.ok(Math.abs(climbs[0].distance - 500) < 60, `${climbs[0].distance}`);
  assert.ok(climbs[0].length > 2000 && climbs[0].length < 2400, `${climbs[0].length}`);
  assert.ok(Math.abs(climbs[0].gain - 100) < 6);
  assert.equal(detectClimbs(nodesOf((d) => d * 0.05, 800)).length, 0);
});

test("simplify keeps shape within tolerance", () => {
  const nodes = nodesOf((d) => Math.sin(d / 300) * 20, 3000);
  const out = simplify(nodes);
  assert.ok(out.length < nodes.length);
  assert.deepEqual(out[0], nodes[0]);
});

test("rejects an open track", () => {
  const open = [];
  for (let d = 0; d <= 3000; d += 10) open.push({ x: d, y: 0, ele: 10 });
  assert.throws(() => gpxToRoute(gpxOf(open), { id: "x", name: "X" }), /does not end within 200 m/);
  const closed = loopWith(() => 10);
  assert.doesNotThrow(() => gpxToRoute(gpxOf(closed), { id: "x", name: "X" }));
});

test("the finish line has no step: the lap's last point matches its first", () => {
  const { route } = gpxToRoute(gpxOf(loopWith((d) => d / 100)), { id: "x", name: "X" });
  const first = route.points[0];
  const last = route.points.at(-1);
  assert.ok(Math.abs(last[2] - first[2]) < 1, `${last[2]} vs ${first[2]}`);
});

test("gpxToRoute names climbs from markers and reports deviation", () => {
  const profile = (d) => (d < 1000 ? 0 : d < 3000 ? (d - 1000) * 0.05 : 100);
  const { route, report } = gpxToRoute(gpxOf(loopWith(profile)), {
    id: "demo",
    name: "Demo",
    seed: 5,
    geo: { lat: 38, lon: 2.6 },
    markers: [{ type: "climb", name: "Femés", distance: 2000 }, { type: "sprint", name: "Yaiza", distance: 4500 }],
    targetLength: 12000,
    targetClimb: 100,
  });
  assert.deepEqual(route.markers[0], { type: "start_finish", distance: 0 });
  const climb = route.markers.find((m) => m.type === "climb");
  assert.equal(climb.name, "Femés");
  assert.equal(route.markers.find((m) => m.type === "sprint").name, "Yaiza");
  assert.deepEqual(route.geo, { lat: 38, lon: 2.6 });
  assert.equal(route.loop, true);
  assert.equal(route.seed, 5);
  assert.ok(Math.abs(report.lengthOff - (report.length - 12000) / 12000) < 1e-12);
  assert.ok(report.steepest.grade <= 0.12);
});
