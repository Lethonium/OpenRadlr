// A contact sheet of imported models, drawn with the game's own shading rules,
// so a candidate kit can be judged by eye before it is wired in (#117).
//
//   node kitSheet.mjs <kit dir> <out.png>
//
// Every model in the folder, fitted into a grid and shaded with one sun, so the
// style of a candidate pack can be judged before any of it is wired in.
import { readFileSync, readdirSync } from "node:fs";
import { chromium } from "playwright";

const [dir, out] = process.argv.slice(2);
const files = readdirSync(dir).filter((n) => n.endsWith(".geo.json")).sort();
const models = files.map((f) => {
  const m = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  return { name: f.replace(".geo.json", ""), triangles: m.triangles, bounds: m.bounds };
});

const html = `<!doctype html><html><body style="margin:0;background:#7fb2d9">
<canvas id="c" width="1400" height="900"></canvas>
<script>
const models = ${JSON.stringify(models)};
const c = document.getElementById("c"), g = c.getContext("2d");
// Ground
const grad = g.createLinearGradient(0,0,0,900);
grad.addColorStop(0,"#9dd07a"); grad.addColorStop(1,"#6fae55");
g.fillStyle = grad; g.fillRect(0,0,1400,900);
const cols = 6, rows = Math.ceil(models.length / cols);
const cw = 1400 / cols, ch = 900 / rows;
const sun = [0.45, 0.78, 0.43];
const nrm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
models.forEach((m, i) => {
  const ox = (i % cols) * cw + cw / 2, oy = (i / cols | 0) * ch + ch * 0.88;
  // Fit the model into its cell
  const b = m.bounds, h = Math.max(0.001, b.max[1] - b.min[1]);
  const w = Math.max(b.max[0]-b.min[0], b.max[2]-b.min[2]);
  const s = Math.min((cw * 0.8) / Math.max(w, 0.001), (ch * 0.75) / h);
  const t = m.triangles;
  const faces = [];
  for (let k = 0; k < t.length; k += 3) {
    const p = [t[k], t[k+1], t[k+2]];
    const a = p[0], bb = p[1], cc = p[2];
    const u = [bb[0]-a[0], bb[1]-a[1], bb[2]-a[2]], v = [cc[0]-a[0], cc[1]-a[1], cc[2]-a[2]];
    const n = nrm([u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]);
    const depth = (a[2] + bb[2] + cc[2]) / 3;
    faces.push({ p, n, depth, col: [a[3], a[4], a[5]] });
  }
  faces.sort((x, y) => x.depth - y.depth);
  const proj = (p) => [ox + p[0] * s, oy - p[1] * s];
  for (const f of faces) {
    const lam = 0.45 + 0.55 * Math.max(0, f.n[0]*sun[0] + f.n[1]*sun[1] + f.n[2]*sun[2]);
    // The models are authored dark; lift them the way the world's tonemap would.
    const col = f.col.map((x) => Math.min(255, Math.round(Math.pow(x, 0.45) * 255 * lam)));
    g.fillStyle = "rgb(" + col[0] + "," + col[1] + "," + col[2] + ")";
    g.beginPath();
    const p0 = proj(f.p[0]), p1 = proj(f.p[1]), p2 = proj(f.p[2]);
    g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.closePath(); g.fill();
  }
  g.fillStyle = "#123"; g.font = "13px sans-serif";
  g.fillText(m.name + " (" + ((m.triangles.length/3)|0) + "t)", ox - cw/2 + 8, (i/cols|0)*ch + 18);
});
</script></body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.setContent(html);
await page.waitForTimeout(500);
await page.screenshot({ path: out });
await browser.close();
console.log(out);
