// Screenshot of the running client for UI verification.
//
// Start the server first (e.g. `make dev`), then:
//   node screenshot.mjs [url] [--out file] [--width n] [--height n] [--wait ms]
// or via the Makefile:  make screenshot ARGS="--out shot.png"
//
// Defaults: http://localhost:8080, 1280x800, a short settle wait, and
// ~/.cache/openradlr/screenshots/screenshot-<UTC timestamp>.png.
// Prints the saved path on success. A fresh headless browser has empty
// localStorage, so the rider panel shows default profile values.

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

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
  await page.goto(opts.url);
  // The menu makes one fetch on load; networkidle is a good settle point, but
  // never fail the screenshot because of it.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(opts.wait);
  mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
} finally {
  await browser.close();
}

console.log(out);
