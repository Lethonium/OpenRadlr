// Screenshots of the 3D world from a list of fixed cameras.
//
// Start the server first (e.g. `make dev`), then:
//   node worldShots.mjs --list worldShots.json --out DIR [--only name,name] [--url http://localhost:8080]
// or via the Makefile:  make world-shots ARGS="--out DIR"
//
// Each shot writes <out>/<name>.png at 1600x900, deviceScaleFactor 1, and its
// path is printed. The list is parsed by worldShotList.mjs, which also holds
// the settings and camera pinning; this file is only the Playwright half.
//
// Software WebGL renders at about one frame a second, so the default timeout is
// ten minutes and a shot waits for the world to say it is ready rather than for
// a fixed time.
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { parseShotList, pinCamera, settingsFor, urlFor } from "./worldShotList.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.join(os.homedir(), ".cache", "openradlr", "screenshots", "world");
const WIDTH = 1600;
const HEIGHT = 900;
const DEFAULT_WAIT = 9000;
const TIMEOUT = 600_000;

/** `--name value` pairs, with defaults for a world shot run. */
export function parseRunArgs(argv) {
  const opts = {
    list: path.join(HERE, "worldShots.json"),
    out: DEFAULT_OUT_DIR,
    only: null,
    url: "http://localhost:8080",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = arg.startsWith("--") ? arg.slice(2) : null;
    if (!key || !(key in opts)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    opts[key] = key === "only" ? value.split(",").map((name) => name.trim()).filter(Boolean) : value;
  }
  return opts;
}

/** Writes the shot's settings before the app starts, so it reads them on load. */
async function startWithSettings(page, shot, base) {
  await page.goto(urlFor(shot, base));
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate((settings) => {
    for (const [key, value] of Object.entries(settings)) localStorage.setItem(key, value);
  }, settingsFor(shot));
  await page.reload();
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** The menu is over the island once the setup screen is no longer building it. */
async function waitForMenuWorld(page) {
  await page.waitForFunction(() => !globalThis.document.querySelector("#setup")?.classList.contains("world-building"));
}

/** The workbench has drawn its first frame of the asked plant. */
async function waitForWorkbench(page) {
  await page.waitForFunction(() => globalThis.Workbench?.ready === true, null, { timeout: TIMEOUT });
}

/** Joins a ride as "World Check", pauses at the join point and waits for its world. */
async function waitForRideWorld(page) {
  await page.locator("#name").fill("World Check");
  await page.locator("button#join").click({ timeout: TIMEOUT });
  await page.locator("#hud").waitFor({ state: "visible", timeout: TIMEOUT });
  // Pause first, so the shot is taken where `at` asked and not wherever the
  // ride reached while the worker built the world. The pill is the only
  // reliable answer: the click can land on the building overlay and be swallowed.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.locator("#pause-ride").click({ timeout: 5000 }).catch(() => {});
    const paused = await page.evaluate(() => !globalThis.document.querySelector("#pause-pill")?.hidden);
    if (paused) break;
    await page.waitForTimeout(500);
  }
  // Before the worker hands the world over the canvas still shows the menu's
  // island (or the 2D map), which is easy to mistake for a finished shot.
  await page.locator("#world-wrap").waitFor({ state: "visible", timeout: TIMEOUT }).catch(() => {});
  await page.waitForFunction(() => !globalThis.document.querySelector("#view-note")?.textContent, null, { timeout: TIMEOUT }).catch(() => {});
}

/** Runs one shot in its own page and writes its PNG; returns the path. */
async function shoot(browser, shot, opts) {
  const pinned = Boolean(shot.eye);
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    // A service worker would answer the camera module itself, out of the route's reach.
    serviceWorkers: pinned ? "block" : "allow",
  });
  page.setDefaultTimeout(TIMEOUT);
  try {
    if (pinned) {
      await page.route("**/view3d/chaseCamera.js", async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: pinCamera(await response.text(), shot.eye, shot.target) });
      });
    }
    await startWithSettings(page, shot, opts.url);
    if (shot.kind === "menu") await waitForMenuWorld(page);
    if (shot.kind === "ride") await waitForRideWorld(page);
    if (shot.kind === "workbench") await waitForWorkbench(page);
    await page.waitForTimeout(shot.wait ?? DEFAULT_WAIT);
    const out = path.join(opts.out, `${shot.name}.png`);
    mkdirSync(path.dirname(out), { recursive: true });
    // A dense world is slow under software WebGL; the default 30 s is not enough.
    await page.screenshot({ path: out, timeout: 120_000 });
    return out;
  } finally {
    await page.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseRunArgs(process.argv.slice(2));
  const shots = parseShotList(readFileSync(opts.list, "utf8"));
  const chosen = opts.only ? shots.filter((shot) => opts.only.includes(shot.name)) : shots;
  if (opts.only) {
    const missing = opts.only.filter((name) => !shots.some((shot) => shot.name === name));
    if (missing.length) throw new Error(`No shot named ${missing.join(", ")} in ${opts.list}`);
  }
  if (!chosen.length) throw new Error(`${opts.list} has no shots to run`);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const shot of chosen) console.log(await shoot(browser, shot, opts));
  } finally {
    await browser.close();
  }
}
