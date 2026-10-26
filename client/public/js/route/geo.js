/**
 * Places the virtual world on the globe, so exported rides (TCX, GPX, Strava)
 * get a map track. Route coordinates are metres with x = east and y = north;
 * (0, 0) sits in open sea south of Mallorca — no real roads, so rides never
 * match real-world Strava segments.
 *
 * Never move the origin: rides already uploaded would no longer line up with
 * new ones.
 */

export const WORLD_ORIGIN = Object.freeze({ lat: 39, lon: 2.6 });

/**
 * Mean earth radius. A sphere rather than WGS84 on purpose: GPX tools and
 * Strava measure track length with the haversine formula on this sphere, so
 * the distance they compute matches the distance ridden.
 */
const EARTH_RADIUS_M = 6371008.8;
const DEG = 180 / Math.PI;

/**
 * Latitude and longitude of a world position (equirectangular around the
 * origin; accurate to well under 0.1 % over tens of kilometres).
 * @param {number} x metres east of the origin
 * @param {number} y metres north of the origin
 * @param {{lat: number, lon: number}} [origin] where (0, 0) sits; a route's own `geo` or the world origin
 * @returns {{lat: number, lon: number}}
 */
export function toLatLon(x, y, origin = WORLD_ORIGIN) {
  const lat = origin.lat + (y / EARTH_RADIUS_M) * DEG;
  const midLat = (origin.lat + lat) / 2;
  const lon = origin.lon + (x / (EARTH_RADIUS_M * Math.cos(midLat / DEG))) * DEG;
  return { lat, lon };
}
