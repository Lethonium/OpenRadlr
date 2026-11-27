/**
 * The rider look (#25): what a rider picks for their rider in the Profile dialog, which pieces their achievements
 * unlock, the short code other riders get it as, and where it is kept. Pure: storage and randomness come in.
 *
 * A choice is one option id per slot (`LOOK_SLOTS`), height in centimetres. `lookFromChoice` turns it into the
 * fields of the rig's `RiderLook`, over a base look for anything the choice leaves out.
 */
import { RIDER_SKINS } from "../view3d/assets/riders/look.js";
import { seededRandom } from "../world/noise.js";

/** Where the active rider's look is kept (rider-scoped storage). */
export const LOOK_KEY = "openradlr.look";

const free = (...ids) => ids.map((id) => ({ id }));
const earned = (id, unlock) => ({ id, unlock });

/** Jersey, shorts, helmet and frame colours. */
const PALETTE = Object.freeze([
  "#c8102e", "#0b3d91", "#1b7a3d", "#f28c17", "#6a1b9a", "#00a3c7", "#f2c200",
  "#ff5a8a", "#7a4a2a", "#e8e8e8", "#ffffff", "#8d8f94", "#222222", "#15161a",
]);
const HAIR = Object.freeze(["#1d1410", "#3b2a1f", "#6b4a2b", "#b8893d", "#d9b56b", "#c2452d", "#8a8a8a", "#e9e4da"]);
export const GOLD = "#d4af37";
const HEIGHT_CM = Object.freeze([150, 205]);
/** Body mass index of each build. */
const BUILD_BMI = Object.freeze({ slim: 20, average: 23, strong: 26, heavy: 30 });

/**
 * The slots in code order, each with its options; an option with `unlock` needs that achievement.
 * `colour` slots show swatches, the rest chips.
 */
export const LOOK_SLOTS = Object.freeze({
  style: { group: "body", options: [...free("modern"), earned("classic", "classicRider")] },
  skin: { group: "body", options: free(...Object.keys(RIDER_SKINS)) },
  hair: { group: "body", colour: true, options: free(...HAIR) },
  hairStyle: { group: "body", options: [...free("short", "long"), earned("ponytail", "bendy")] },
  moustache: { group: "body", options: [...free("none"), earned("handlebar", "bothWays")] },
  height: { group: "body", range: HEIGHT_CM, options: [] },
  build: { group: "body", options: free(...Object.keys(BUILD_BMI)) },
  kit: { group: "kit", options: [...free("road", "long", "casual"), earned("skinsuit", "marathon")] },
  pattern: {
    group: "kit",
    options: [
      ...free("solid", "hoops", "band"),
      earned("sash", "firstRide"),
      earned("panels", "century"),
      earned("chevron", "climb1000"),
      earned("dots", "climb4000"),
      earned("fade", "summits10"),
      earned("rainbow", "watts1000"),
    ],
  },
  primary: { group: "kit", colour: true, options: free(...PALETTE) },
  secondary: { group: "kit", colour: true, options: free(...PALETTE) },
  accent: { group: "kit", colour: true, options: free(...PALETTE) },
  shorts: { group: "kit", colour: true, options: free(...PALETTE) },
  socks: { group: "kit", colour: true, options: free(...PALETTE) },
  sockHeight: { group: "kit", options: [...free("low", "crew"), earned("tall", "weeks4"), earned("knee", "thumbWarrior")] },
  shoes: { group: "kit", colour: true, options: free(...PALETTE) },
  gloves: { group: "kit", options: free("on", "off") },
  helmetStyle: { group: "head", options: [...free("road"), earned("aero", "weeks12"), earned("cap", "classicRider"), earned("lemon", "lemons10")] },
  helmet: { group: "head", colour: true, options: free(...PALETTE) },
  glasses: { group: "head", options: free("off", "on") },
  bike: { group: "bike", options: [...free("road", "city"), earned("gravel", "tourist")] },
  frame: { group: "bike", colour: true, options: [...free(...PALETTE), earned(GOLD, "km1000")] },
  frameAccent: { group: "bike", colour: true, options: free(...PALETTE) },
});

const SLOT_NAMES = Object.keys(LOOK_SLOTS);
const VERSION = "1";
const CODE = /^[0-9a-z]{1,48}$/;

/** Whether an option is open to a rider with these earned achievements (`{id: ms}`). */
export const isUnlocked = (option, earnedIds = {}) => !option.unlock || Boolean(earnedIds?.[option.unlock]);

const clampHeight = (cm) => Math.min(HEIGHT_CM[1], Math.max(HEIGHT_CM[0], Math.round(cm)));

/** A choice of only unlocked pieces, drawn from `rng`; height around 1.76 m. */
export function randomChoice(earnedIds, rng) {
  const choice = {};
  for (const [slot, { options, range }] of Object.entries(LOOK_SLOTS)) {
    if (range) {
      choice[slot] = clampHeight(162 + rng() * 28);
      continue;
    }
    const open = options.filter((option) => isUnlocked(option, earnedIds));
    choice[slot] = open[Math.min(open.length - 1, Math.floor(rng() * open.length))].id;
  }
  return choice;
}

/** The look a rider gets before they pick one: free pieces only, the same for the same seed. */
export const rolledChoice = (seed) => randomChoice({}, seededRandom(Math.imul(seed | 0, 2654435761) >>> 0));

/** `choice` with every slot filled (from the seed's rolled look) and every locked piece swapped for the slot's first option. */
export function sanitizeLook(choice, earnedIds, seed = 1) {
  const fallback = rolledChoice(seed);
  const clean = {};
  for (const [slot, { options, range }] of Object.entries(LOOK_SLOTS)) {
    const value = choice?.[slot];
    if (range) {
      clean[slot] = Number.isFinite(value) ? clampHeight(value) : fallback[slot];
      continue;
    }
    const option = options.find((one) => one.id === value);
    clean[slot] = !option ? fallback[slot] : isUnlocked(option, earnedIds) ? option.id : options[0].id;
  }
  return clean;
}

/** The short code a choice travels as: a version character, then one base-36 character per slot (height two). */
export function encodeLook(choice) {
  let code = VERSION;
  for (const [slot, { options, range }] of Object.entries(LOOK_SLOTS)) {
    if (range) {
      code += (clampHeight(choice[slot]) - range[0]).toString(36).padStart(2, "0");
      continue;
    }
    code += Math.max(0, options.findIndex((option) => option.id === choice[slot])).toString(36);
  }
  return code;
}

/** The slots a code names, leaving out any index this client does not know; null for a code it cannot read at all. */
export function decodeLook(code) {
  if (typeof code !== "string" || !CODE.test(code) || code[0] !== VERSION) return null;
  const choice = {};
  let at = 1;
  for (const slot of SLOT_NAMES) {
    const { options, range } = LOOK_SLOTS[slot];
    const width = range ? 2 : 1;
    const part = code.slice(at, at + width);
    at += width;
    if (part.length < width) break;
    const index = Number.parseInt(part, 36);
    if (range) {
      if (index <= range[1] - range[0]) choice[slot] = range[0] + index;
    } else if (options[index]) choice[slot] = options[index].id;
  }
  return choice;
}

/**
 * The rig's look for a choice, over `base` for what the choice leaves out; `classic` says whether the rider is drawn as
 * the classic rider and bike.
 * @param {Partial<Record<string, string | number>>} choice
 * @param {import("../view3d/assets/riders/look.js").RiderLook} base
 */
export function lookFromChoice(choice, base) {
  const look = { ...base, classic: choice.style === "classic" };
  const copy = ["skin", "hair", "hairStyle", "kit", "pattern", "primary", "secondary", "accent", "shorts", "socks", "sockHeight", "shoes", "helmetStyle", "helmet", "bike", "frame", "frameAccent"];
  for (const key of copy) if (choice[key] !== undefined) look[key] = choice[key];
  if (choice.moustache !== undefined) look.moustache = choice.moustache === "handlebar";
  if (choice.gloves !== undefined) look.gloves = choice.gloves === "on";
  if (choice.glasses !== undefined) look.glasses = choice.glasses === "on";
  if (Number.isFinite(choice.height)) look.height = choice.height / 100;
  if (choice.build !== undefined || Number.isFinite(choice.height)) {
    const bmi = BUILD_BMI[choice.build] ?? base.weight / (base.height * base.height);
    look.weight = Math.min(120, Math.max(45, bmi * look.height * look.height));
  }
  return look;
}

/**
 * The look to keep for a rider who switched on the old "Classic rider" setting before looks existed: their rolled look
 * as the classic rider, once Old School is earned and no look is kept yet; else null (nothing to carry over).
 */
export function carriedClassic(kept, classicSetting, earnedIds, seed) {
  if (kept || classicSetting !== "on" || !earnedIds?.classicRider) return null;
  return { ...rolledChoice(seed), style: "classic" };
}

/** The kept look, or null when there is none or it cannot be read. */
export function loadLook(storage) {
  try {
    const choice = JSON.parse(storage.getItem(LOOK_KEY) ?? "null");
    return choice && typeof choice === "object" && !Array.isArray(choice) ? choice : null;
  } catch {
    return null;
  }
}

/** False when the storage refuses. */
export function saveLook(storage, choice) {
  try {
    storage.setItem(LOOK_KEY, JSON.stringify(choice));
    return true;
  } catch {
    return false;
  }
}
