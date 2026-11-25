/**
 * Words over the road: the names on the arches, and banners counting down the
 * last kilometre of a climb and marking halfway round a loop. The texts are
 * the same in every language (numbers, units, "KOM", the brand), so the world
 * stays one world for everyone. See docs/superpowers/specs/2026-11-10-banners-design.md.
 */
/** What each arch says, by marker type. */
export const ARCH_TEXT = Object.freeze({ start_finish: "OPENRADLR", climb: "KOM", sprint: "SPRINT" });

/** Metres over the road where an arch's beam is centred. */
export const ARCH_HEIGHT = 5.2;

export const BANNERS = Object.freeze({
  text: Object.freeze({ halfway: "1/2", climb1000: "1 KM ^", climb500: "500 M ^" }),
  /** Loops at least this long get a halfway banner. */
  halfwayFromM: 3000,
  /** A countdown banner needs this much climb below it. */
  climbBelowM: 150,
  /** No banner this close to an arch. */
  clearOfArchM: 60,
  /** Banner cloth: bottom edge and height (metres over the road); lemon yellow for halfway. */
  bottom: 4.1,
  height: 0.95,
  halfway: [1.0, 0.82, 0.1],
});

/**
 * Where banners hang on a route: `{distance, kind, text}` in riding order —
 * "climb" 1 km and 500 m before each climb's top where the climb is long
 * enough, "halfway" round a loop.
 */
export function bannerSpots(route) {
  const spots = [];
  for (const marker of route.markers) {
    if (marker.type !== "climb") continue;
    const top = marker.distance + (marker.length ?? 0);
    for (const [before, text] of [
      [1000, BANNERS.text.climb1000],
      [500, BANNERS.text.climb500],
    ]) {
      if ((marker.length ?? 0) >= before + BANNERS.climbBelowM) spots.push({ distance: top - before, kind: "climb", text });
    }
  }
  if (route.loop && route.length >= BANNERS.halfwayFromM) spots.push({ distance: route.length / 2, kind: "halfway", text: BANNERS.text.halfway });
  const arches = route.markers.map((m) => m.distance);
  const clear = (d) => arches.every((a) => Math.abs(route.loop ? route.signedGap(a, d) : d - a) >= BANNERS.clearOfArchM);
  return spots.filter((s) => clear(s.distance)).sort((a, b) => a.distance - b.distance);
}

/**
 * Where the arches stand on a route: one per start/finish, climb and sprint marker, with the name each carries
 * (`ARCH_TEXT`), as `{kind, text, distance}` in marker order.
 */
export function archSpots(route) {
  return route.markers.filter((marker) => ARCH_TEXT[marker.type]).map((marker) => ({ kind: marker.type, text: ARCH_TEXT[marker.type], distance: marker.distance }));
}

/** Where the banners hang: `{kind: "climb"|"halfway", text, distance}`, see `bannerSpots`. */
export const bannerPlacements = (route) => bannerSpots(route);
