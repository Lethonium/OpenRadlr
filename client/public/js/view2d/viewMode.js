/** The ride's view choice: the 3D world, or one of the two 2D views drawn from it. Pure. */

/** Every view, in the order the view key cycles through them. */
export const VIEW_MODES = Object.freeze(["3d", "map", "side"]);

/** A stored choice as a view: the old "2d" is the map; anything unknown is 3D. */
export function viewModeOf(saved) {
  if (saved === "2d") return "map";
  return VIEW_MODES.includes(saved) ? saved : "3d";
}

/** The view after `mode` among the ones this ride offers (the map always); `mode` itself when it is the only one. */
export function nextViewMode(mode, { has3d, hasSide }) {
  const offered = VIEW_MODES.filter((candidate) => candidate === "map" || (candidate === "3d" && has3d) || (candidate === "side" && hasSide));
  const at = offered.indexOf(mode);
  return offered[(at + 1) % offered.length];
}
