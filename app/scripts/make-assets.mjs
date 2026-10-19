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
