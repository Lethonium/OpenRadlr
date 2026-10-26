// Reads a bundled route from ../routes at build time and turns it into an
// elevation profile, so the page always shows the real roads of the game.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Marker {
  type: string;
  distance: number;
  length?: number;
}

interface RouteFile {
  name: string;
  points: [number, number, number][];
  markers: Marker[];
}

export interface Profile {
  name: string;
  lengthM: number;
  climbM: number;
  minEle: number;
  maxEle: number;
  /** [distance in m, elevation in m] */
  samples: [number, number][];
  segments: { type: "climb" | "sprint"; from: number; to: number }[];
}

// Builds run in landing/, so the bundled routes are one level up.
const routesDir = resolve(process.cwd(), "../routes");

export function loadProfile(id: string): Profile {
  const file = resolve(routesDir, `${id}.json`);
  const route: RouteFile = JSON.parse(readFileSync(file, "utf8"));

  const samples: [number, number][] = [];
  let distance = 0;
  let climb = 0;
  route.points.forEach(([x, y, ele], i) => {
    if (i > 0) {
      const [px, py, pe] = route.points[i - 1];
      distance += Math.hypot(x - px, y - py);
      climb += Math.max(0, ele - pe);
    }
    samples.push([distance, ele]);
  });

  const elevations = samples.map(([, e]) => e);
  return {
    name: route.name,
    lengthM: distance,
    climbM: climb,
    minEle: Math.min(...elevations),
    maxEle: Math.max(...elevations),
    samples,
    segments: route.markers
      .filter((m): m is Marker & { type: "climb" | "sprint" } => m.type === "climb" || m.type === "sprint")
      .map((m) => ({ type: m.type, from: m.distance, to: m.distance + (m.length ?? 0) })),
  };
}
