// Screenshot of the running client for UI verification.
//
// Start the server first (e.g. `make dev`), then:
//   node screenshot.mjs [url] [--out file] [--width n] [--height n] [--wait ms] [--ride page]
// or via the Makefile:  make screenshot ARGS="--out shot.png"
//
// Defaults: http://localhost:8080, 1280x800, a short settle wait, and
// ~/.cache/openradlr/screenshots/screenshot-<UTC timestamp>.png.
// --ride <page> (e.g. "vr.html?preview=1&head=30,-10"): pairs a second screen through the real
// UI, starts a ride with the simulated trainer and screenshots <page> on the second screen once
// it shows the live ride. Exits non-zero with a message if any step fails.
// Prints the saved path on success. A fresh headless browser has empty
// localStorage, so the rider panel shows default profile values.

/* global document */
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { parseArgs } from "./screenshotArgs.mjs";

const DEFAULT_OUT_DIR = path.join(os.homedir(), ".cache", "openradlr", "screenshots");

function defaultOut() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return path.join(DEFAULT_OUT_DIR, `screenshot-${stamp}.png`);
}

const opts = parseArgs(process.argv.slice(2));
const out = opts.out ?? defaultOut();

const RIDE_TIMEOUT = 240_000;

/** Pairs a second screen with a tablet page, starts a simulated ride and returns the screen's page. */
async function pairAndRide(browser, opts) {
  const base = new URL(opts.url);
  const viewport = { width: opts.width, height: opts.height };
  const step = (name, promise) =>
    promise.catch((error) => {
      throw new Error(`--ride failed at "${name}": ${error.message.split("\n")[0]}`);
    });

  const tabletContext = await browser.newContext({ viewport });
  await tabletContext.addInitScript(() => {
    localStorage.setItem("openride.rideMode", "sim");
    localStorage.setItem("openride.profile.v1", JSON.stringify({ name: "Tablet", units: "metric", weightKg: 72, ftp: 260 }));
  });
  const tablet = await tabletContext.newPage();
  await tablet.goto(base.href);
  await step("world loaded", tablet.waitForSelector("#setup.world-building", { state: "detached", timeout: RIDE_TIMEOUT }));
  await step("settings", tablet.click("#start-settings > summary", { timeout: 30_000 }));
  await step("second-screen row", tablet.click("#screens-open", { timeout: 30_000 }));
  await step("pair a new screen", tablet.click("#screens-pair", { timeout: 30_000 }));
  await step("code shown", tablet.waitForFunction(() => /^\S{3} \S{3}$/.test(document.getElementById("screens-code")?.textContent.trim()), null, { timeout: 30_000 }));
  const code = (await tablet.textContent("#screens-code")).replace(/\s/g, "");

  const screen = await (await browser.newContext({ viewport })).newPage();
  await screen.goto(new URL(opts.ride, base).href);
  await step("pair now button", screen.click("#vr-pair, #cockpit-pair", { timeout: 30_000 }));
  await step("code entry", screen.waitForSelector(".code-input", { state: "visible", timeout: 30_000 }));
  const boxes = screen.locator(".code-input");
  for (let i = 0; i < code.length; i += 1) await boxes.nth(i).fill(code[i]);
  // Claiming reloads the page, which then has no pair button.
  await step("claimed", screen.waitForFunction(() => performance.getEntriesByType("navigation")[0]?.type === "reload", null, { timeout: 60_000 }));

  await step("close panel", tablet.click("#screens-close"));
  await step("simulated trainer", tablet.click("#use-simulated"));
  await step("start ride", tablet.click("#join"));
  await step("ride hud", tablet.waitForSelector("#hud", { timeout: RIDE_TIMEOUT }));
  await step("live ride", screen.waitForSelector("body[data-live]", { timeout: RIDE_TIMEOUT }));
  return screen;
}

const browser = await chromium.launch({ headless: true });
try {
  const page =
    opts.ride === null
      ? await browser.newPage({ viewport: { width: opts.width, height: opts.height } })
      : await pairAndRide(browser, opts);
  if (opts.ride === null) await page.goto(opts.url);
  // The menu makes one fetch on load; networkidle is a good settle point, but
  // never fail the screenshot because of it.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(opts.wait);
  mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (!process.exitCode) console.log(out);
