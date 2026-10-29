// Promo recorder. usage: node rec.mjs <shot.json>   (see README.md)
// Env: PROMO_OUT (default ~/.cache/openradlr/promo), PROMO_GL=software|gpu (default gpu)
// Shot: {name, width, height, scale, record:true|false, steps:[...]}
// Steps (seconds are game seconds): {goto}, {wait:s}, {click:sel}, {hover:sel}, {waitFor:sel}, {fill:[sel,val]}, {key:code},
//   {power:w}, {eval:js}, {still:name}, {rec:"start", clip?}|{rec:"stop"}
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const shot = JSON.parse(readFileSync(process.argv[2], "utf8"));
const S = shot.scale ?? 1;
const out = process.env.PROMO_OUT ?? path.join(os.homedir(), ".cache", "openradlr", "promo");
const dir = path.join(out, "raw", shot.name);
mkdirSync(dir, { recursive: true });

const clock = (S) => {
  const pn = performance.now.bind(performance), t0 = pn(), d0 = Date.now();
  const v = () => t0 + (pn() - t0) * S;
  performance.now = v;
  const OD = Date;
  class VD extends OD { constructor(...a) { a.length ? super(...a) : super(d0 + (pn() - t0) * S); } static now() { return d0 + (pn() - t0) * S; } }
  window.Date = VD;
  const st = window.setTimeout, si = window.setInterval, raf = window.requestAnimationFrame;
  window.setTimeout = (f, ms = 0, ...a) => st(f, ms / S, ...a);
  window.setInterval = (f, ms = 0, ...a) => si(f, ms / S, ...a);
  window.requestAnimationFrame = (cb) => raf(() => cb(v()));
};

const glArgs = process.env.PROMO_GL === "software"
  ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
  : ["--ignore-gpu-blocklist", "--enable-gpu"];
const browser = await chromium.launch({ args: glArgs });
// bypassCSP: the app's CSP (style-src 'self') would block `eval` steps that inject <style> to hide UI.
const ctx = await browser.newContext({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 1, bypassCSP: true });
await ctx.addInitScript(clock, S);
if (shot.storage) await ctx.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, shot.storage);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Animation.enable");
await cdp.send("Animation.setPlaybackRate", { playbackRate: S });

// A shot records one or more clips; {rec:"start", clip:"name"} writes to raw/<shot>/<clip>/,
// without a clip name to raw/<shot>/ itself.
let n = 0, recording = false, clipDir = dir, times = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  if (recording) {
    const f = `${clipDir}/frames/${String(n).padStart(6, "0")}.jpg`;
    writeFileSync(f, Buffer.from(data, "base64"));
    times.push([f, metadata.timestamp]); n++;
  }
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

// ffmpeg concat list, durations in game time
const finishClip = async () => {
  await cdp.send("Page.stopScreencast"); recording = false;
  let list = "ffconcat version 1.0\n";
  for (let i = 0; i < times.length; i++) {
    const d = i + 1 < times.length ? (times[i + 1][1] - times[i][1]) * S : 1 / 30;
    list += `file 'frames/${times[i][0].split("/").pop()}'\nduration ${d.toFixed(5)}\n`;
  }
  if (times.length) writeFileSync(`${clipDir}/frames.ffconcat`, list);
  console.log(path.relative(out, clipDir), "frames", times.length, "game s", times.length ? ((times.at(-1)[1] - times[0][1]) * S).toFixed(1) : 0);
};

const wait = (s) => page.waitForTimeout((s * 1000) / S);
for (const st of shot.steps) {
  if (st.goto) { await page.goto(st.goto); await page.waitForLoadState("networkidle").catch(() => {}); }
  else if (st.wait != null) await wait(st.wait);
  else if (st.click) await page.click(st.click);
  else if (st.hover) await page.hover(st.hover);
  else if (st.waitFor) await page.waitForSelector(st.waitFor, { state: "visible", timeout: 600000 });
  else if (st.fill) await page.fill(st.fill[0], st.fill[1]);
  else if (st.select) await page.selectOption(st.select[0], st.select[1]);
  else if (st.key) await page.keyboard.press(st.key);
  else if (st.power != null) await page.evaluate((w) => { const e = document.getElementById("sim-power"); e.value = w; e.dispatchEvent(new Event("input")); }, st.power);
  else if (st.eval) await page.evaluate(st.eval);
  else if (st.still) await page.screenshot({ timeout: 600000, path: `${dir}/${st.still}.png` });
  else if (st.rec === "start") {
    clipDir = st.clip ? path.join(dir, st.clip) : dir; times = []; n = 0;
    mkdirSync(`${clipDir}/frames`, { recursive: true });
    recording = true; await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: shot.width, maxHeight: shot.height }); }
  else if (st.rec === "stop") await finishClip();
}
if (recording) await finishClip();
await browser.close();
