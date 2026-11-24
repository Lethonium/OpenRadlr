/**
 * The world shot list: what to shoot, the settings a shot starts the app with,
 * and the camera pinning that makes a shot repeatable. Pure, so it is tested in
 * node; `worldShots.mjs` is the Playwright half that drives a browser.
 *
 * A shot names a `kind`:
 * - `menu`: the start menu over the island, optionally with a route picked.
 * - `ride`: a ride joined at `at` metres along the route, paused for the shot.
 * - `workbench`: one plant of the kit on the workbench page, in a season and at a time of day (`asset` is needed).
 *
 * `eye` and `target` (world x,y,z) go together and pin the chase camera there,
 * for a landmark the ride's own cameras do not face.
 */

export const SHOT_KINDS = Object.freeze(["menu", "ride", "workbench"]);
export const SHOT_TIMES = Object.freeze(["auto", "day", "golden", "dusk", "night"]);

const point = (shot, key, value) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`shot "${shot.name}" needs ${key} as [x, y, z]`);
  }
  return value;
};

/**
 * A shot list from its JSON: an array of `{ name, kind, route?, at?, camera?,
 * time?, season?, weather?, asset?, eye?, target?, wait? }`. Throws on anything a run could not
 * shoot as asked, naming the shot.
 * @param {string} json
 * @returns {object[]}
 */
export function parseShotList(json) {
  const raw = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("the shot list is an array of shots");
  const seen = new Set();
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("each shot is an object");
    if (typeof entry.name !== "string" || entry.name.trim() === "") throw new Error("each shot needs a name");
    const shot = { name: entry.name, kind: entry.kind };
    if (seen.has(shot.name)) throw new Error(`shot "${shot.name}" appears twice`);
    seen.add(shot.name);
    if (!SHOT_KINDS.includes(shot.kind)) throw new Error(`shot "${shot.name}" has an unknown kind: ${shot.kind}`);
    for (const key of ["route", "camera", "season", "asset", "weather"]) {
      if (entry[key] === undefined) continue;
      if (typeof entry[key] !== "string" || entry[key] === "") throw new Error(`shot "${shot.name}" has an invalid ${key}`);
      shot[key] = entry[key];
    }
    if ((shot.kind === "workbench") !== (shot.asset !== undefined)) {
      throw new Error(`shot "${shot.name}" ${shot.kind === "workbench" ? "needs an asset" : "has an asset but is not a workbench shot"}`);
    }
    if (entry.time !== undefined) {
      if (!SHOT_TIMES.includes(entry.time)) throw new Error(`shot "${shot.name}" has an unknown time: ${entry.time}`);
      shot.time = entry.time;
    }
    if (entry.at !== undefined) {
      if (!Number.isFinite(entry.at) || entry.at < 0) throw new Error(`shot "${shot.name}" needs at as metres >= 0`);
      shot.at = entry.at;
    }
    if (entry.wait !== undefined) {
      if (!Number.isFinite(entry.wait) || entry.wait < 0) throw new Error(`shot "${shot.name}" needs wait as ms >= 0`);
      shot.wait = entry.wait;
    }
    if ((entry.eye === undefined) !== (entry.target === undefined)) {
      throw new Error(`shot "${shot.name}" needs eye and target together`);
    }
    if (entry.eye !== undefined) {
      shot.eye = point(shot, "eye", entry.eye);
      shot.target = point(shot, "target", entry.target);
    }
    return shot;
  });
}

/**
 * The address a shot starts from, below `base` (no trailing slash).
 * @param {object} shot
 * @param {string} base
 * @returns {string}
 */
export function urlFor(shot, base) {
  if (shot.kind === "workbench") {
    const query = new URLSearchParams({ asset: shot.asset });
    for (const key of ["season", "time"]) if (shot[key]) query.set(key, shot[key]);
    return `${base}/workbench.html?${query}`;
  }
  const weather = shot.weather ? `&weather=${shot.weather}` : "";
  return shot.kind === "ride" ? `${base}/?at=${shot.at ?? 0}${weather}` : `${base}/`;
}

/**
 * The localStorage entries a shot starts the app with, written before load so
 * the app reads them. Never a quality level: `low` turns the 3D menu off.
 * @param {object} shot
 * @returns {Record<string, string>}
 */
export function settingsFor(shot) {
  const settings = { "openride.view": "3d" };
  for (const [key, setting] of [
    ["route", "openride.route"],
    ["camera", "openride.camera"],
    ["time", "openride.time"],
    ["season", "openride.season"],
  ]) {
    if (shot[key]) settings[setting] = shot[key];
  }
  return settings;
}

/**
 * The chase camera module's source, changed so every update ends at `eye`
 * looking at `target`. Only the shot's copy of the module changes.
 * @param {string} source
 * @param {number[]} eye
 * @param {number[]} target
 * @returns {string}
 */
export function pinCamera(source, eye, target) {
  return `${source}
{
  const follow = ChaseCamera.prototype.update;
  ChaseCamera.prototype.update = function (...args) {
    follow.apply(this, args);
    this.eye = ${JSON.stringify(eye)};
    this.target = ${JSON.stringify(target)};
    return this;
  };
}
`;
}
