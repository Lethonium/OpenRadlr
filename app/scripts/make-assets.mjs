/**
 * Source images for `capacitor-assets generate` (npm run assets): the app
 * icon from the client's maskable icon, the splash screen from the README
 * emblem, both on the icon's dark background.
 */
import sharp from "sharp";

const BG = { r: 8, g: 10, b: 14, alpha: 1 }; // #080a0e, the icon's own background
const ICON = "../client/public/icons/icon-maskable-512.png";
const EMBLEM = "../docs/assets/openradlr-emblem.png";
const OUT = "assets";

const resized = (file, width) => sharp(file).resize({ width, kernel: "lanczos3" }).png().toBuffer();
const canvas = (size) => sharp({ create: { width: size, height: size, channels: 4, background: BG } });

// iOS wants 1024 px; the largest master is 512 px, so it is scaled up.
const icon = await sharp(await resized(ICON, 1024)).flatten({ background: BG }).png().toBuffer();
await sharp(icon).toFile(`${OUT}/icon-only.png`);
// Android's adaptive icon insets the foreground to its visible area; the art keeps its own safe zone.
await sharp(icon).toFile(`${OUT}/icon-foreground.png`);
await canvas(1024).png().toFile(`${OUT}/icon-background.png`);
// Phones in portrait show about the middle 1250 px of the 2732 px splash.
await canvas(2732).composite([{ input: await resized(EMBLEM, 960), gravity: "center" }]).flatten({ background: BG }).png().toFile(`${OUT}/splash.png`);

// Android 12+ draws its own splash: an icon in a 288 dp square, masked to the
// inner circle of 192 dp, on a plain colour (styles.xml). The emblem is scaled
// so every opaque pixel stays inside that circle, and written per density.
const { data, info } = await sharp(EMBLEM).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let radius = 0;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < 16) continue;
    radius = Math.max(radius, Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2));
  }
}
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(DENSITIES)) {
  const size = Math.round(288 * scale);
  const width = Math.floor((info.width * (96 * scale)) / radius); // 96 dp: the circle's radius
  const emblem = await resized(EMBLEM, width);
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: emblem, gravity: "center" }])
    .png()
    .toFile(`android/app/src/main/res/drawable-${density}/splash_icon.png`);
}
