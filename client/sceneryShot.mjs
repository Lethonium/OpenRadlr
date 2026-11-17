// Screenshots of the ride at a chosen spot on the route (#117).
//
// The rider joins part-way along the route, which the server supports directly
// (a join's `resume` point, exposed as `?at=<metres>`), so a shot is taken at the
// same place every time with no pedalling to get there.
//
//   node sceneryShot.mjs --out DIR --at 6490 --camera drone --scenery models
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

/** Settings written before the app starts, so it reads them on load. */
export function settingsFor({ scenery, camera, view = "3d" }) {
  const settings = { "openride.view": view, "openradlr.showFps": "on" };
  if (scenery) settings["openradlr.scenery"] = scenery;
  if (camera) settings["openride.camera"] = camera;
  return settings;
}

/** `--name value` pairs, with defaults for a scenery shot. */
export function parseShotArgs(argv) {
  const opts = { url: "http://localhost:8080", out: null, at: "0", camera: "drone", scenery: "models", width: 1600, height: 900, wait: 9000, name: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = arg.startsWith("--") ? arg.slice(2) : null;
    if (!key) throw new Error(`Unexpected argument: ${arg}`);
    if (!(key in opts)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    opts[key] = ["width", "height", "wait"].includes(key) ? Number(value) : value;
  }
  if (!Number.isFinite(Number(opts.at)) || Number(opts.at) < 0) throw new Error("Invalid --at");
  return opts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseShotArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
  try {
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
    // Software WebGL builds a world slowly and the rider drifts while it does.
    // Pause at the join point so every scenery level is photographed at the
    // same spot, not wherever the ride happened to reach.
    await page.locator("#pause-ride").click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(opts.wait);
    const out = opts.out ?? `${opts.camera}-${opts.at}-${opts.scenery}.png`;
    mkdirSync(out.replace(/\/[^/]*$/, "") || ".", { recursive: true });
    await page.screenshot({ path: out });
    console.log(out);
  } finally {
    await browser.close();
  }
}
