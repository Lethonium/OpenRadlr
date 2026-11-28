/**
 * Which sprites the 2D views draw, as bake jobs: a workbench asset, how it is shot (side or top view,
 * pixels per metre, turn, frames) and by day or night. Pure: no Three.js. The baker renders the jobs.
 */

export const HOUSE_STYLES_2D = Object.freeze(["cottage", "whitewashed", "timber", "stone"]);
/** The turns (radians) a side-view house is baked at; a house turned past these shows its gable, near enough to the widest. */
export const HOUSE_TURNS = Object.freeze([-1.2, -0.75, -0.4, 0, 0.4, 0.75, 1.2]);
/** How many yaws a top-view house is baked at, evenly round the circle. */
export const HOUSE_YAWS = 12;

/** Plants and roadside props, by workbench id. */
export const PLANT_SPRITES = Object.freeze(["broadleaf", "pine", "birch", "olive", "cypress", "almond", "bush", "lavender", "rock", "hayBale", "umbrellaPine", "poplar", "bench", "cart", "logPile", "mailbox", "beehive", "cairn"]);
/** Big buildings: sprite name to workbench id. */
export const BUILDING_SPRITES = Object.freeze({ farm: "farmstead", cafe: "bike-cafe", lamp: "streetLamp", lighthouse: "lighthouse", windmill: "windmill", turbine: "windTurbine", castle: "castle" });
export const CREATURE_SPRITES = Object.freeze(["spectator", "cow", "sheep", "horse", "pig"]);
/** The game's own things (workbench ids): the route arch, the lemon, the tandem and the beer bike. */
export const GAME_SPRITES = Object.freeze(["route-arch", "lemon", "tandem", "beer-bike"]);

/** The turn the side view shows a farm and a café at (a little off straight-on, so they read as buildings). */
const BUILDING_TURN = -0.45;
/** Pixels per metre by kind and view. */
const PPM = Object.freeze({
  side: Object.freeze({ plant: 22, building: 12, creature: 30, house: 14, game: 12, rider: 48 }),
  top: Object.freeze({ plant: 10, building: 8, creature: 16, house: 8, game: 8, rider: 24 }),
});
/** The buildings (sprite names) that light up at night. */
const LIT_BUILDINGS = Object.freeze(["farm", "cafe", "lamp", "lighthouse"]);
/** A rider's pedalling in the side view: frames and seconds between them. */
const RIDER_FRAMES = 12;
const RIDER_DT = 0.0556;
/** km/h a baked rider is ridden at (spins the wheels). */
const RIDER_SPEED = 30;

/**
 * @typedef {object} SpriteJob
 * @property {string} key unique per (view, night) and look
 * @property {string} id workbench asset id
 * @property {object} options asset options
 * @property {"side"|"top"} view
 * @property {number} ppm pixels per metre
 * @property {number} yaw asset turn in radians
 * @property {number} frames
 * @property {number} dt seconds between frames
 * @property {boolean} night
 */

/** The unique name of a job's sprite. */
export function spriteKey(job) {
  return `${job.view}${job.night ? "-night" : ""}:${job.id}:${JSON.stringify(job.options)}:${job.yaw.toFixed(3)}`;
}

function job(id, view, kind, { options = {}, yaw = 0, frames = 1, dt = 0, night = false, ppm = PPM[view][kind] } = {}) {
  const made = { id, options, view, ppm, yaw, frames, dt, night };
  return { key: spriteKey(made), ...made };
}

/**
 * Every sprite a view needs, by day or (only what lights up) by night.
 * @param {{view: "side"|"top", night?: boolean}} spec
 * @returns {SpriteJob[]}
 */
export function spriteJobs({ view, night = false }) {
  const houses = [];
  for (const style of HOUSE_STYLES_2D) {
    const yaws = view === "side" ? HOUSE_TURNS : Array.from({ length: HOUSE_YAWS }, (_, k) => (k / HOUSE_YAWS) * Math.PI * 2);
    for (const yaw of yaws) houses.push(job("house", view, "house", { options: { style }, yaw, night }));
  }
  const buildings = Object.entries(BUILDING_SPRITES)
    .filter(([name]) => !night || LIT_BUILDINGS.includes(name))
    .map(([name, id]) => job(id, view, "building", { yaw: view === "side" && (name === "farm" || name === "cafe") ? BUILDING_TURN : 0, night }));
  if (night) return [...houses, ...buildings];
  return [
    ...PLANT_SPRITES.map((id) => job(id, view, "plant")),
    ...houses,
    ...buildings,
    ...CREATURE_SPRITES.map((id) => job(id, view, "creature")),
    ...GAME_SPRITES.map((id) => job(id, view, "game")),
  ];
}

/**
 * The job for one rider's look: the cyclist in that look, pedalling in the side view, one frame from above.
 * @param {object} look a rider look (see view3d/assets/riders/look.js); passed on as the cyclist's options
 * @param {"side"|"top"} view
 * @returns {SpriteJob}
 */
export function riderJob(look, view) {
  const side = view === "side";
  return job("cyclist", view, "rider", { options: { ...look, speed: RIDER_SPEED }, frames: side ? RIDER_FRAMES : 1, dt: side ? RIDER_DT : 0 });
}
