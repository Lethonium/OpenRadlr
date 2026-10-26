import { test } from "node:test";
import assert from "node:assert/strict";
import { WORLD_ORIGIN, toLatLon } from "../public/js/route/geo.js";

/** Great-circle distance in metres (haversine, mean earth radius). */
function haversine(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

test("the world origin is open sea south of Mallorca", () => {
  assert.deepEqual(WORLD_ORIGIN, { lat: 39, lon: 2.6 });
  assert.deepEqual(toLatLon(0, 0), WORLD_ORIGIN);
});

test("toLatLon uses a given origin", () => {
  assert.deepEqual(toLatLon(0, 0, { lat: 38, lon: 2.6 }), { lat: 38, lon: 2.6 });
  assert.ok(toLatLon(1000, 0, { lat: 38, lon: 2.6 }).lon > 2.6);
});

test("x points east and y points north", () => {
  const east = toLatLon(1000, 0);
  const north = toLatLon(0, 1000);
  assert.ok(east.lon > WORLD_ORIGIN.lon && Math.abs(east.lat - WORLD_ORIGIN.lat) < 1e-9);
  assert.ok(north.lat > WORLD_ORIGIN.lat && Math.abs(north.lon - WORLD_ORIGIN.lon) < 1e-9);
});

test("distances on the map match distances in the world to within 0.1 %", () => {
  for (const [x, y] of [[1000, 0], [0, 1000], [-3000, 4000], [15000, -15000]]) {
    const metres = Math.hypot(x, y);
    const measured = haversine(WORLD_ORIGIN, toLatLon(x, y));
    assert.ok(Math.abs(measured - metres) / metres < 0.001, `${x},${y}: ${measured} vs ${metres}`);
  }
});

test("a 20 km radius around the origin stays clear of Mallorca and Cabrera", () => {
  const corners = [[-20000, -20000], [20000, -20000], [-20000, 20000], [20000, 20000]].map(([x, y]) => toLatLon(x, y));
  const maxLat = Math.max(...corners.map((c) => c.lat));
  const maxLon = Math.max(...corners.map((c) => c.lon));
  assert.ok(maxLat < 39.3, "south coast of Mallorca is above 39.3° N west of 2.9° E");
  assert.ok(maxLon < 2.9, "Cabrera starts at about 2.9° E");
});
