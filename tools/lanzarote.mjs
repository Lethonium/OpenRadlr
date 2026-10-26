#!/usr/bin/env node
/**
 * Builds the Lanzarote Lava 180 bike course as a GPX track (#42): the waypoints
 * below are routed over OpenStreetMap roads (public OSRM router) and each
 * point gets its elevation from the Copernicus GLO-30 DEM.
 *
 *   node tools/lanzarote.mjs            fetch OSRM and DEM tiles (network), write the GPX
 *   node tools/lanzarote.mjs --offline reuse tools/.cache/
 *
 * Writes routes/sources/lanzarote-lava-180.gpx, then convert it with
 *   node tools/gpx-route.mjs routes/sources/lanzarote-lava-180.gpx --id lanzarote-lava-180 \
 *     --name "Lanzarote Lava 180" --geo 38,2.6 --seed 1992 --sigma 200 \
 *     --markers routes/sources/lanzarote-lava-180-markers.json \
 *     --target-length 180000 --target-climb 2500 --out routes/lanzarote-lava-180.json
 *
 * The course order is UNCONFIRMED: it is the commonly published order, not
 * checked against the official course map. Fix it by editing WAYPOINTS (one
 * line each; add a pin wherever the router leaves the course) and rerunning.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openCog } from "./dem.mjs";

// [lat, lon, name] in course order. Coordinates from OpenStreetMap (Nominatim).
const WAYPOINTS = [
  [28.9199, -13.6631, "Playa Grande, Puerto del Carmen (start)"],
  [28.9607, -13.6465, "Tías"],
  [28.9380, -13.7683, "Yaiza"],
  [28.8631, -13.8509, "Playa Blanca"],
  [28.9138, -13.7789, "Femés"],
  [28.9380, -13.7683, "Yaiza"],
  [29.0430, -13.6898, "Mancha Blanca (via LZ-67, Timanfaya)"],
  [29.0666, -13.6765, "Tinajo"],
  [29.0589, -13.5502, "Teguise"],
  [29.1274, -13.4796, "Tabayesco"],
  [29.2164, -13.4784, "Mirador del Río"],
  [29.1459, -13.5001, "Haría"],
  [29.0840, -13.5231, "Los Valles"],
  [29.0589, -13.5502, "Teguise"],
  [28.9835, -13.6130, "San Bartolomé"],
  [28.9199, -13.6631, "Playa Grande, Puerto del Carmen (finish)"],
];

const SANITY = [
  { name: "Puerto del Carmen start", lat: 28.9199, lon: -13.6631, min: 0, max: 15 },
  { name: "Mirador del Río", lat: 29.2164, lon: -13.4784, min: 450, max: 510 },
];
const CACHE = fileURLToPath(new URL("./.cache/", import.meta.url));
const OUT = fileURLToPath(new URL("../routes/sources/lanzarote-lava-180.gpx", import.meta.url));
const TILES = ["N28_00_W014_00", "N29_00_W014_00"];
const OSM = "Road geometry © OpenStreetMap contributors, ODbL";
const DEM = "Elevation: Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA";

const offline = process.argv.includes("--offline");
mkdirSync(CACHE, { recursive: true });

async function cached(file, url, binary) {
  const path = CACHE + file;
  if (!existsSync(path)) {
    if (offline) throw new Error(`${file} is not cached and --offline was given`);
    const response = await fetch(url, { headers: { "user-agent": "openradlr-tools/1.0" } });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  return binary ? readFileSync(path) : readFileSync(path, "utf8");
}

const query = WAYPOINTS.map(([lat, lon]) => `${lon},${lat}`).join(";");
const osrm = JSON.parse(
  await cached(`osrm-${createHash("sha1").update(query).digest("hex").slice(0, 16)}.json`, `https://router.project-osrm.org/route/v1/driving/${query}?overview=full&geometries=geojson&continue_straight=true`, false),
);
if (osrm.code !== "Ok") throw new Error(`OSRM: ${osrm.code}`);
const coordinates = osrm.routes[0].geometry.coordinates;

const tiles = [];
for (const tile of TILES) {
  const name = `Copernicus_DSM_COG_10_${tile}_DEM`;
  tiles.push(openCog(await cached(`${name}.tif`, `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`, true)));
}
const elevation = (lat, lon) => {
  for (const tile of tiles) {
    const e = tile.elevation(lat, lon);
    if (Number.isFinite(e)) return e;
  }
  return NaN;
};

for (const check of SANITY) {
  const e = elevation(check.lat, check.lon);
  console.log(`${check.name}: ${e.toFixed(1)} m (expected ${check.min}–${check.max})`);
  if (!(e >= check.min && e <= check.max)) throw new Error(`DEM sanity check failed at ${check.name}`);
}

// The island's highest point (Peñas del Chache, ~670 m) shows the DEM is not offset or scaled.
let highest = 0;
for (let lat = 29.0; lat < 29.2; lat += 0.002) for (let lon = -13.9; lon < -13.45; lon += 0.002) highest = Math.max(highest, elevation(lat, lon) || 0);
console.log(`Island high point: ${highest.toFixed(0)} m (expected 640–700)`);
if (!(highest >= 640 && highest <= 700)) throw new Error("DEM sanity check failed at the island high point");

const points = coordinates.map(([lon, lat]) => ({ lat, lon, ele: elevation(lat, lon) }));
const missing = points.filter((p) => !Number.isFinite(p.ele)).length;
if (missing) throw new Error(`${missing} track points have no DEM elevation`);

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="openradlr tools/lanzarote.mjs" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Lanzarote Lava 180 bike course</name>
    <desc>${OSM}. ${DEM}. Course order unconfirmed: built from public guides, pending a check by someone who knows it.</desc>
  </metadata>
  <trk>
    <name>Lanzarote Lava 180 bike course (unconfirmed)</name>
    <trkseg>
${points.map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele.toFixed(1)}</ele></trkpt>`).join("\n")}
    </trkseg>
  </trk>
</gpx>
`;
writeFileSync(OUT, gpx);
console.log(`${points.length} points, OSRM distance ${(osrm.routes[0].distance / 1000).toFixed(1)} km → ${OUT}`);
