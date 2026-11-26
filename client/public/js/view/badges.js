/**
 * The achievements' pins (#27): enamel pins with a gold rim, one drawing per
 * achievement. The shape and enamel say what kind it is; locked pins are the same
 * drawing greyed by CSS. Constant SVG markup only, no rider data goes in.
 */

const INK = "#2b1d14";
const LINE = `stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"`;

const SHAPES = {
  // [rim path, enamel path]
  round: ["M50 4a46 46 0 1 1 0 92a46 46 0 1 1 0-92Z", "M50 11a39 39 0 1 1 0 78a39 39 0 1 1 0-78Z"],
  shield: ["M50 3L91 15V47C91 74 73 90 50 98C27 90 9 74 9 47V15Z", "M50 10.5L84 20.5V47C84 69.5 69 83 50 90.5C31 83 16 69.5 16 47V20.5Z"],
  hexagon: [polygon(6, 47, -90), polygon(6, 39.5, -90)],
  ticket: ["M26 4H74A22 22 0 0 1 96 26V74A22 22 0 0 1 74 96H26A22 22 0 0 1 4 74V26A22 22 0 0 1 26 4Z", "M29 11H71A18 18 0 0 1 89 29V71A18 18 0 0 1 71 89H29A18 18 0 0 1 11 71V29A18 18 0 0 1 29 11Z"],
  burst: [star(14, 48, 42), "M50 13a37 37 0 1 1 0 74a37 37 0 1 1 0-74Z"],
};

/** Enamel, light to dark, per shape. */
const ENAMEL = {
  round: ["#ffa25a", "#d94f18"],
  shield: ["#4fd8c6", "#0f7a72"],
  hexagon: ["#6cb4ff", "#2152c2"],
  ticket: ["#8fdf63", "#2c8a36"],
  burst: ["#a57bff", "#4a27a3"],
};

function polygon(n, r, startDeg) {
  const points = Array.from({ length: n }, (_, i) => {
    const a = ((startDeg + (360 / n) * i) * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${points.join("L")}Z`;
}

function star(n, outer, inner) {
  const points = Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((-90 + (180 / n) * i) * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${points.join("L")}Z`;
}

const deg = (d) => (d * Math.PI) / 180;
const at = (cx, cy, r, d) => [cx + r * Math.cos(deg(d)), cy + r * Math.sin(deg(d))].map((v) => v.toFixed(2));

/** A white stroke with an ink outline (thick ink under a thinner colour). */
const outlined = (d, colour = "#fff", width = 5) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width + 5}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

const bigText = (text, y, size, fill = "#fff") =>
  `<text x="50" y="${y}" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="${size}" fill="${fill}" stroke="${INK}" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${text}</text>`;

function laurel() {
  let leaves = "";
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const d = side < 0 ? 205 - i * 24 : -25 + i * 24;
      const [x, y] = at(50, 52, 28, d);
      const rot = d + (side < 0 ? -60 : 60);
      leaves += `<ellipse cx="${x}" cy="${y}" rx="3.6" ry="7" transform="rotate(${rot.toFixed(1)} ${x} ${y})" fill="#b6ec7a" ${LINE} stroke-width="1.8"/>`;
    }
  }
  return leaves;
}

function croissant() {
  const parts = [
    [188, 5.5, 9],
    [352, 5.5, 9],
    [222, 9, 12.5],
    [318, 9, 12.5],
    [270, 13, 16],
  ];
  return parts
    .map(([d, rx, ry]) => {
      const [x, y] = at(50, 70, 26, d);
      return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${d + 90} ${x} ${y})" fill="#f6c45e" ${LINE}/>`;
    })
    .join("")
    .concat(`<path d="M44 40q6 3 12 0M43 48q7 3 14 0" fill="none" stroke="#c4801f" stroke-width="2.2" stroke-linecap="round"/>`);
}

function calendar(inside) {
  return `<rect x="25" y="29" width="50" height="46" rx="6" fill="#fff" ${LINE}/>
<path d="M25 35a6 6 0 0 1 6-6h38a6 6 0 0 1 6 6v8H25Z" fill="#ef4b4b" ${LINE}/>
<path d="M37 24v10M63 24v10" ${LINE} stroke-width="4.5"/>${inside}`;
}

const tick = (x, y) => `<path d="M${x - 4} ${y}l3 3.5l6-7" fill="none" stroke="#1f9d4c" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;

function burstLines() {
  const colours = ["#ffe14d", "#ff6b9a", "#6cf0ff", "#fff"];
  let out = "";
  for (let i = 0; i < 12; i++) {
    const d = i * 30 - 90;
    const [x1, y1] = at(50, 48, 8, d);
    const [x2, y2] = at(50, 48, i % 2 ? 22 : 27, d);
    out += `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${colours[i % 4]}" stroke-width="3.4" stroke-linecap="round"/><circle cx="${x2}" cy="${y2}" r="2.6" fill="${colours[i % 4]}"/>`;
  }
  return out;
}

function spokes(cx, cy, r) {
  let out = "";
  for (let i = 0; i < 8; i++) {
    const [x, y] = at(cx, cy, r, i * 22.5);
    const [x2, y2] = at(cx, cy, r, i * 22.5 + 180);
    out += `<path d="M${x} ${y}L${x2} ${y2}" stroke="#cfd6df" stroke-width="1.6"/>`;
  }
  return out;
}

/** The drawings, in a 100 × 100 box centred on 50 50. */
const ICONS = {
  firstRide: `<circle cx="42" cy="58" r="17" fill="#dfe4ea" ${LINE}/>
<circle cx="42" cy="58" r="17" fill="none" stroke="${INK}" stroke-width="5" stroke-dasharray="3 3.7"/>
<circle cx="42" cy="58" r="9" fill="#9aa5b4" ${LINE}/>
<path d="M42 58L66 36" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><path d="M42 58L66 36" stroke="#c7ced8" stroke-width="5" stroke-linecap="round"/>
<circle cx="42" cy="58" r="4" fill="${INK}"/>
<rect x="55" y="29" width="24" height="13" rx="3" transform="rotate(-8 67 35.5)" fill="#3b4250" ${LINE}/>
<path d="M60 33.5v6M65 33v6M70 32.3v6" stroke="#8d97a6" stroke-width="1.8" transform="rotate(-8 67 35.5)"/>`,
  marathon: `<rect x="25" y="30" width="50" height="42" rx="5" transform="rotate(-6 50 51)" fill="#fff" ${LINE}/>
<path d="M27 40h46" transform="rotate(-6 50 51)" stroke="#ef4b4b" stroke-width="5"/>
<g transform="rotate(-6 50 51)" fill="#9aa5b4" stroke="${INK}" stroke-width="1.4"><circle cx="30" cy="34.5" r="2"/><circle cx="70" cy="34.5" r="2"/><circle cx="30" cy="67" r="2"/><circle cx="70" cy="67" r="2"/></g>
<text x="50" y="62" transform="rotate(-6 50 51)" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="17" fill="${INK}">42.2</text>`,
  century: `${laurel()}${bigText("100", 59, 21)}`,
  km1000: `<circle cx="50" cy="63" r="20" fill="#56b6ff" ${LINE}/>
<path d="M36 58c4-5 10-4 12 1s-3 8-7 8s-7-4-5-9ZM54 48c6-2 11 2 12 7c-4 1-6 4-9 3s-6-7-3-10ZM55 73c4-3 9-2 10 2c-3 3-7 4-10-2Z" fill="#7fd45a" stroke="${INK}" stroke-width="1.8"/>
<path d="M28 43c0-4 3-6 7-6h26c5 0 8 2 8 6Z" fill="#c9f0a6" ${LINE}/>
<path d="M62 37l2-10M66 38l6-8" ${LINE} stroke-width="2"/><circle cx="64" cy="26" r="2.4" fill="${INK}"/><circle cx="72.5" cy="29" r="2.4" fill="${INK}"/>
<circle cx="46" cy="29" r="12" fill="#ffb25a" ${LINE}/><path d="M46 29m-2 2a3 3 0 1 1 5-3a6 6 0 1 1-9 6a9 9 0 0 1 4-12" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  croissants: croissant(),
  climb1000: `<path d="M18 72L38 44L50 58L62 46L82 72Z" fill="#bfe9e3" ${LINE}/>
<path d="M26 72L50 36L74 72Z" fill="#ffd166" ${LINE}/><path d="M50 36L42 72H58Z" fill="#a8541f" ${LINE}/>
<path d="M50 36V22" ${LINE}/><path d="M50 22L62 26L50 30Z" fill="#ef4b4b" ${LINE} stroke-width="2"/>
<path d="M20 72H80" ${LINE}/>`,
  climb4000: `<circle cx="66" cy="32" r="8" fill="#ff7a59" ${LINE}/>
<path d="M18 74L40 38L58 74Z" fill="#7d8fa8" ${LINE}/><path d="M40 38L34 48L40 45L44 49Z" fill="#fff" ${LINE} stroke-width="2"/>
<path d="M36 74L60 30L84 74Z" fill="#a4b4c9" ${LINE}/><path d="M60 30L52 44L58 41L62 45L67 43Z" fill="#fff" ${LINE} stroke-width="2"/>`,
  everest: `<path d="M16 76L50 30L84 76Z" fill="#8ea0b8" ${LINE}/>
<path d="M50 30L39 45L45 42L50 47L55 42L61 45Z" fill="#fff" ${LINE} stroke-width="2"/>
<path d="M30 76L46 56L54 66L62 58L72 76" fill="#6f829c" ${LINE} stroke-width="2"/>
<path d="M50 30V15" ${LINE}/><path d="M50 15L64 19.5L50 24Z" fill="#ef4b4b" ${LINE} stroke-width="2"/>`,
  weeks4: calendar(`${tick(37, 54)}${tick(53, 54)}${tick(37, 66)}${tick(53, 66)}<circle cx="67" cy="60" r="2.4" fill="#d5d9df"/>`),
  weeks12: calendar(`<text x="50" y="69" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="24" fill="#ef4b4b">12</text>
<path d="M68 70l2.5 5l5.5 .8l-4 3.9l1 5.5l-5-2.6l-5 2.6l1-5.5l-4-3.9l5.5-.8Z" fill="#ffe14d" ${LINE} stroke-width="2"/>`),
  knowThyself: `<path d="M24 62A26 26 0 0 1 76 62Z" fill="#fff" ${LINE}/>
<path d="M30 60A20 20 0 0 1 40 43" fill="none" stroke="#4cc76a" stroke-width="6"/><path d="M41 42.5A20 20 0 0 1 59 42.5" fill="none" stroke="#ffd23f" stroke-width="6"/><path d="M60 43A20 20 0 0 1 70 60" fill="none" stroke="#ef4b4b" stroke-width="6"/>
<path d="M50 62L64 46" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/><circle cx="50" cy="62" r="5" fill="#3b4250" ${LINE} stroke-width="2"/>
<path d="M24 62H76" ${LINE}/>`,
  stronger: `<rect x="26" y="56" width="11" height="18" rx="2" fill="#fff" ${LINE}/><rect x="44.5" y="46" width="11" height="28" rx="2" fill="#fff" ${LINE}/><rect x="63" y="34" width="11" height="40" rx="2" fill="#fff" ${LINE}/>
${outlined("M24 48L40 38L50 42L70 24", "#ffe14d", 4.5)}<path d="M62 22L74 20L72 32Z" fill="#ffe14d" ${LINE}/>`,
  watts1000: `<path d="M57 18L32 55H48L41 82L70 42H54Z" fill="#ffe14d" ${LINE}/><path d="M55 24L40 49" stroke="#fff8c2" stroke-width="2.4" stroke-linecap="round"/>`,
  tourist: `<rect x="23" y="36" width="54" height="36" rx="7" fill="#3b4250" ${LINE}/><path d="M38 36l4-7h16l4 7" fill="#3b4250" ${LINE}/>
<circle cx="50" cy="54" r="13" fill="#cfd6df" ${LINE}/><circle cx="50" cy="54" r="7.5" fill="#56b6ff" ${LINE} stroke-width="2"/><circle cx="47.5" cy="51.5" r="2.2" fill="#fff"/>
<rect x="64" y="40" width="7" height="4" rx="1" fill="#ffe14d"/>`,
  local: `<path d="M31 48V74H69V48" fill="#fff" ${LINE}/>
<path d="M24 51L50 28L76 51" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 51L50 28L76 51" fill="none" stroke="#ef4b4b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M50 70c-9-6-12-10-12-14a5.5 5.5 0 0 1 12-2a5.5 5.5 0 0 1 12 2c0 4-3 8-12 14Z" fill="#ff6b9a" ${LINE}/>`,
  bothWays: `${outlined("M30 46A21 21 0 0 1 68 38")}<path d="M60 31L73 37L64 47Z" fill="#fff" ${LINE}/>
${outlined("M70 56A21 21 0 0 1 32 64")}<path d="M40 70L27 64L36 54Z" fill="#fff" ${LINE}/>`,
  lavaFeet: `<path d="M50 30c12 0 18 9 17 19c-1 7-5 10-5 16c0 7-5 12-12 12s-12-5-12-12c0-7 3-10 2-16c-1-10 3-19 10-19Z" fill="#ffd9b8" ${LINE}/>
<g fill="#ffd9b8" stroke="${INK}" stroke-width="2"><circle cx="40" cy="25" r="4.4"/><circle cx="47.5" cy="20" r="4.1"/><circle cx="55" cy="19.5" r="3.7"/><circle cx="61.5" cy="22" r="3.3"/><circle cx="66.5" cy="26.5" r="2.9"/></g>
<g transform="translate(5 14) scale(.9)"><path d="M24 78c-4-10 4-14 4-22c5 4 6 9 6 12c2-8 8-12 6-22c8 6 10 14 10 20c2-6 6-8 6-14c6 6 8 12 8 18c2-4 2-6 1-10c6 6 8 12 6 18Z" fill="#ff5a2a" ${LINE}/>
<path d="M33 78c-2-6 3-8 4-12c3 3 4 6 4 9c2-4 5-6 5-10c4 4 6 8 6 13Z" fill="#ffc23d"/><path d="M54 78c-1-5 2-7 3-10c3 3 5 6 4 10Z" fill="#ffc23d"/></g>`,
  lemons10: `<path d="M24 52c2-14 14-22 28-21c4-4 10-3 12 0c8 3 14 11 13 21c-1 14-14 22-28 21c-4 4-10 3-12 0c-8-3-14-11-13-21Z" fill="#ffe14d" ${LINE}/>
<path d="M60 31c4-8 12-9 16-6c-3 6-9 9-16 6Z" fill="#6fc94f" ${LINE} stroke-width="2"/>
<rect x="31" y="45" width="15" height="10" rx="4" fill="${INK}"/><rect x="52" y="45" width="15" height="10" rx="4" fill="${INK}"/><path d="M46 48h6" stroke="${INK}" stroke-width="2.4"/>
<path d="M34 47h5" stroke="#8fd3ff" stroke-width="1.8" stroke-linecap="round"/><path d="M55 47h5" stroke="#8fd3ff" stroke-width="1.8" stroke-linecap="round"/>
<path d="M42 62q8 6 15 0" fill="none" ${LINE}/>`,
  summits10: `<path d="M16 76L34 50L44 62L56 44L70 60L84 76Z" fill="#a4b4c9" ${LINE}/>
<path d="M34 50V30" ${LINE}/><path d="M34 30L46 34L34 38Z" fill="#ffd23f" ${LINE} stroke-width="2"/>
<path d="M56 44V20" ${LINE}/><path d="M56 20L69 24.5L56 29Z" fill="#ef4b4b" ${LINE} stroke-width="2"/>
<path d="M70 60V40" ${LINE}/><path d="M70 40L81 43.5L70 47Z" fill="#56b6ff" ${LINE} stroke-width="2"/>`,
  nightOwl: `<path d="M68 22a12 12 0 1 0 10 18a10 10 0 0 1-10-18Z" fill="#ffe14d" ${LINE} stroke-width="2"/>
<path d="M33 40l-3-12l10 7M67 40l3-12l-10 7" fill="#9b6a43" ${LINE}/>
<ellipse cx="50" cy="56" rx="21" ry="23" fill="#9b6a43" ${LINE}/><ellipse cx="50" cy="63" rx="12" ry="13" fill="#e6c49a"/>
<circle cx="41" cy="48" r="8" fill="#fff" ${LINE}/><circle cx="59" cy="48" r="8" fill="#fff" ${LINE}/><circle cx="42" cy="49" r="3.6" fill="${INK}"/><circle cx="58" cy="49" r="3.6" fill="${INK}"/>
<path d="M47 55l3 5l3-5Z" fill="#ffa23d" ${LINE} stroke-width="1.8"/>`,
  earlyBird: `<path d="M18 72a32 32 0 0 1 64 0Z" fill="#ffb347" ${LINE}/>
<g stroke="#ffe14d" stroke-width="3" stroke-linecap="round"><path d="M50 32v-6M28 42l-5-4M72 42l5-4M20 58h-6M80 58h6"/></g>
<circle cx="50" cy="48" r="17" fill="#56b6ff" ${LINE}/><path d="M39 55c5 5 17 5 22 0c-5 8-17 8-22 0Z" fill="#cfeaff"/>
<path d="M36 50c-6-4-3-11 3-11c2 4 2 8-3 11Z" fill="#3b8de0" ${LINE} stroke-width="2"/>
<circle cx="55" cy="43" r="3" fill="${INK}"/><circle cx="56" cy="42" r="1" fill="#fff"/><path d="M66 45l10 2.5l-10 3.5Z" fill="#ffa23d" ${LINE} stroke-width="1.8"/>`,
  lunchBreak: `<path d="M22 50c0-10 12-16 28-16s28 6 28 16Z" fill="#e8a75a" ${LINE}/>
<path d="M22 54c4-3 7 3 11 0s7 3 11 0s7 3 11 0s7 3 11 0s7 3 12 0" fill="none" stroke="#6fc94f" stroke-width="5" stroke-linecap="round"/>
<rect x="22" y="56" width="56" height="5" rx="2.5" fill="#ef4b4b" ${LINE} stroke-width="2"/><path d="M24 62l52 0l-4 4h-44Z" fill="#ffd23f" ${LINE} stroke-width="2"/>
<rect x="22" y="66" width="56" height="9" rx="4" fill="#e8a75a" ${LINE}/>
<circle cx="70" cy="30" r="10" fill="#fff" ${LINE}/><path d="M70 24v6l4 3" fill="none" ${LINE} stroke-width="2.2"/>`,
  cookieBurner: `<defs><mask id="bite"><rect width="100" height="100" fill="#fff"/><circle cx="70" cy="40" r="9" fill="#000"/><circle cx="74" cy="51" r="7" fill="#000"/></mask></defs>
<g mask="url(#bite)"><circle cx="48" cy="54" r="24" fill="#d99a52" ${LINE}/><circle cx="48" cy="54" r="19" fill="none" stroke="#e8b06d" stroke-width="3"/>
<g fill="#5a2f14"><circle cx="38" cy="46" r="3.4"/><circle cx="52" cy="42" r="3"/><circle cx="44" cy="59" r="3.6"/><circle cx="58" cy="62" r="3"/><circle cx="34" cy="62" r="2.6"/></g></g>
<path d="M66 32c-6-8 2-12 0-18c8 4 12 10 8 18c4-2 4-5 4-7c4 6 2 13-4 14c-4 1-7-2-8-7Z" fill="#ff7a2f" ${LINE} stroke-width="2"/>`,
  newYear: `${burstLines()}<circle cx="50" cy="48" r="5" fill="#fff" ${LINE} stroke-width="2"/>
<path d="M50 54L48 80" stroke="#ffe14d" stroke-width="2" stroke-dasharray="2 3" stroke-linecap="round"/>`,
  thumbWarrior: `<rect x="32" y="20" width="34" height="60" rx="7" fill="#3b4250" ${LINE}/><rect x="36.5" y="27" width="25" height="44" rx="3" fill="#8fd3ff"/>
<rect x="40" y="56" width="18" height="8" rx="4" fill="#ff7a1a"/>
<path d="M42 84c-4-8-2-16 4-22l6-6c3-3 8-1 7 3l-2 7h10c4 0 6 4 4 7c2 2 1 6-2 7c1 3-1 6-4 6Z" fill="#ffd9b8" ${LINE}/>
<path d="M51 58l4-2" stroke="#e8a98a" stroke-width="2" stroke-linecap="round"/>`,
  bendy: `${outlined("M50 48C35 46 33 28 49 19M50 48C65 46 67 28 51 19", "#ffd9b8", 4.5)}
${outlined("M50 66L50 84", "#3b4250", 6)}${outlined("M50 66L64 70L51 76", "#3b4250", 6)}
${outlined("M50 47L50 66", "#ff6b9a", 9)}
<circle cx="50" cy="36" r="7.5" fill="#ffd9b8" ${LINE}/><path d="M43 34c1-6 13-6 14 0c-3-2-10-2-14 0Z" fill="#5a2f14"/>`,
  crossTrainer: `<circle cx="50" cy="50" r="24" fill="none" stroke="${INK}" stroke-width="8"/><circle cx="50" cy="50" r="24" fill="none" stroke="#3b4250" stroke-width="4"/>${spokes(50, 50, 21)}<circle cx="50" cy="50" r="4" fill="#cfd6df" ${LINE} stroke-width="2"/>
<g transform="rotate(-35 50 50)"><rect x="28" y="47" width="44" height="6" rx="3" fill="#cfd6df" ${LINE} stroke-width="2"/>
<rect x="22" y="38" width="9" height="24" rx="3" fill="#ef4b4b" ${LINE}/><rect x="69" y="38" width="9" height="24" rx="3" fill="#ef4b4b" ${LINE}/>
<rect x="17" y="42" width="6" height="16" rx="2.5" fill="#ef4b4b" ${LINE} stroke-width="2"/><rect x="77" y="42" width="6" height="16" rx="2.5" fill="#ef4b4b" ${LINE} stroke-width="2"/></g>`,
  classicRider: `<polygon points="45.9,72.0 32.0,80.0 18.1,72.0 18.1,56.0 32.0,48.0 45.9,56.0" fill="#dfe4ea" ${LINE}/>
<polygon points="81.9,72.0 68.0,80.0 54.1,72.0 54.1,56.0 68.0,48.0 81.9,56.0" fill="#dfe4ea" ${LINE}/>
<polygon points="37.2,67.0 32.0,70.0 26.8,67.0 26.8,61.0 32.0,58.0 37.2,61.0" fill="#9aa5b4" ${LINE} stroke-width="2.4"/>
<polygon points="73.2,67.0 68.0,70.0 62.8,67.0 62.8,61.0 68.0,58.0 73.2,61.0" fill="#9aa5b4" ${LINE} stroke-width="2.4"/>
<path d="M34 64L46 46L62 46L66 64M46 46L52 64L34 64M52 64L62 46" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
<path d="M34 64L46 46L62 46L66 64M46 46L52 64L34 64M52 64L62 46" fill="none" stroke="#ef4b4b" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>
<path d="M43 40h8M60 40v6" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
};

/** Which pin each achievement wears. */
export const BADGE_SHAPES = Object.freeze({
  firstRide: "round",
  marathon: "round",
  century: "round",
  km1000: "round",
  croissants: "round",
  climb1000: "shield",
  climb4000: "shield",
  everest: "shield",
  summits10: "shield",
  weeks4: "hexagon",
  weeks12: "hexagon",
  knowThyself: "hexagon",
  stronger: "hexagon",
  watts1000: "hexagon",
  tourist: "ticket",
  local: "ticket",
  bothWays: "ticket",
  lavaFeet: "ticket",
  lemons10: "ticket",
  nightOwl: "burst",
  earlyBird: "burst",
  lunchBreak: "burst",
  cookieBurner: "burst",
  newYear: "burst",
  thumbWarrior: "burst",
  bendy: "burst",
  crossTrainer: "burst",
  classicRider: "round",
});

let nextUid = 0;

/** The pin's SVG markup; `hidden` draws a secret one still locked: the blank pin with a "?". */
export function badgeSvg(id, { hidden = false } = {}) {
  const shape = BADGE_SHAPES[id] ?? "round";
  const [rim, enamel] = SHAPES[shape];
  const [light, dark] = ENAMEL[shape];
  const u = `b${nextUid++}`;
  const icon = hidden ? bigText("?", 64, 40) : (ICONS[id] ?? "").replaceAll('id="bite"', `id="${u}bite"`).replaceAll("url(#bite)", `url(#${u}bite)`);
  return `<svg class="badge-pin" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
<defs><linearGradient id="${u}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe7a1"/><stop offset=".5" stop-color="#d9a640"/><stop offset="1" stop-color="#8f6420"/></linearGradient>
<linearGradient id="${u}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
<clipPath id="${u}c"><path d="${enamel}"/></clipPath></defs>
<path d="${rim}" transform="translate(0 2)" fill="#000" opacity=".35"/>
<path d="${rim}" fill="url(#${u}r)"/>
<path d="${enamel}" fill="url(#${u}e)" stroke="#8f6420" stroke-width="1.5"/>
<path d="${enamel}" transform="translate(50 50) scale(.87) translate(-50 -50)" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2" stroke-dasharray="2 3"/>
${icon}
<g clip-path="url(#${u}c)"><ellipse cx="34" cy="16" rx="34" ry="14" transform="rotate(-25 34 16)" fill="#fff" opacity=".2"/></g>
</svg>`;
}
