// Screenshots of the ride at a chosen spot on the route (#117).
//
// The rider joins part-way along the route, which the server supports directly
// (a join's `resume` point, exposed as `?at=<metres>`), so a shot is taken at the
// same place every time with no pedalling to get there.
//
//   node sceneryShot.mjs --out DIR --at 6490 --camera drone --scenery models
//   node sceneryShot.mjs --route riverside-flats --at 4700 --scenery quaternius
//   node sceneryShot.mjs --route cape-loop --at 5200 --eye 4300,60,2700 --target 4500,25,2960
//
// `--eye` and `--target` (world x,y,z) pin the camera there for the shot, to
// look at a landmark the road cameras do not face. Only the shot's copy of the
// camera module changes; the app is untouched.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

/** Settings written before the app starts, so it reads them on load. */
export function settingsFor({ scenery, camera, route = null, view = "3d", time = null, quality = null }) {
  const settings = { "openride.view": view, "openradlr.showFps": "on" };
  if (scenery) settings["openradlr.scenery"] = scenery;
  if (camera) settings["openride.camera"] = camera;
  if (route) settings["openride.route"] = route;
  if (time) settings["openride.time"] = time;
  if (quality) settings["openride.quality"] = quality;
  return settings;
}

function point(arg, value) {
  const xyz = value.split(",").map(Number);
  if (xyz.length !== 3 || !xyz.every(Number.isFinite)) throw new Error(`${arg} wants x,y,z`);
  return xyz;
}

/** The chase camera module's source, changed so every update ends at `eye` looking at `target`. */
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

/** `--name value` pairs, with defaults for a scenery shot. */
export function parseShotArgs(argv) {
  const opts = { url: "http://localhost:8080", out: null, at: "0", camera: "drone", scenery: "models", route: null, time: null, quality: null, eye: null, target: null, width: 1600, height: 900, wait: 9000, name: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = arg.startsWith("--") ? arg.slice(2) : null;
    if (!key) throw new Error(`Unexpected argument: ${arg}`);
    if (!(key in opts)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    opts[key] = ["width", "height", "wait"].includes(key) ? Number(value) : ["eye", "target"].includes(key) ? point(arg, value) : value;
  }
  if (!Number.isFinite(Number(opts.at)) || Number(opts.at) < 0) throw new Error("Invalid --at");
  return opts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseShotArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: true });
  // A service worker would answer the camera module itself, out of the route's reach.
  const pinned = Boolean(opts.eye || opts.target);
  const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, serviceWorkers: pinned ? "block" : "allow" });
  try {
    if (pinned) {
      if (!opts.eye || !opts.target) throw new Error("--eye and --target go together");
      await page.route("**/view3d/chaseCamera.js", async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: pinCamera(await response.text(), opts.eye, opts.target) });
      });
    }
    await page.goto(`${opts.url}/?at=${opts.at}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.evaluate((settings) => {
      for (const [key, value] of Object.entries(settings)) localStorage.setItem(key, value);
    }, settingsFor(opts));
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(8000);
    await page.locator("#name").fill("Scenery Check");
    await page.locator("button#join").click({ timeout: 30000 });
    await page.locator("#hud").waitFor({ state: "visible", timeout: 60000 });
    // Pause at the join point first, so the shot is taken where `--at` asked
    // and not wherever the ride reached while the worker built the world.
    // The pill is the only reliable answer: the click can land on the
    // building overlay and be swallowed.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.locator("#pause-ride").click({ timeout: 5000 }).catch(() => {});
      const paused = await page.evaluate("!document.querySelector('#pause-pill')?.hidden");
      if (paused) break;
      await page.waitForTimeout(500);
    }
    // The world is built in a worker and takes a while under software WebGL;
    // before it is ready the canvas still shows the menu's island (or the 2D
    // map), which is easy to mistake for a finished shot.
    await page.locator("#world-wrap").waitFor({ state: "visible", timeout: 120000 }).catch(() => {});
    // The note says "Building 3D world…" until the worker has handed the world
    // over; it is the only honest "the shot is ready" signal.
    await page.waitForFunction("!document.querySelector('#view-note')?.textContent", null, { timeout: 180000 }).catch(() => {});
    // A moment more for the first frames at the paused spot.
    await page.waitForTimeout(opts.wait);
    const out = opts.out ?? `${opts.camera}-${opts.at}-${opts.scenery}.png`;
    mkdirSync(out.replace(/\/[^/]*$/, "") || ".", { recursive: true });
    // A dense wood is slow under software WebGL; the default 30 s is not enough.
    await page.screenshot({ path: out, timeout: 120000 });
    console.log(out);
  } finally {
    await browser.close();
  }
}
