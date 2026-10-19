import type { CapacitorConfig } from "@capacitor/cli";
import { writeFileSync } from "node:fs";

/**
 * The app loads the client from a running OpenRadlr server, so it is always
 * the version that server speaks (docs/app.md). Point it at your own server
 * with `OPENRADLR_APP_URL=http://192.168.1.20:8080 npx cap sync`.
 */
const url = process.env.OPENRADLR_APP_URL ?? "https://openradlr.com";

// The offline page's "Try again" goes back to the same server.
writeFileSync("www/server.js", `export const SERVER_URL = ${JSON.stringify(url)};\n`);

const config: CapacitorConfig = {
  appId: "com.openradlr.app",
  appName: "OpenRadlr",
  // Only shown when the server can't be reached.
  webDir: "www",
  // The splash screen's colour, so there is no white flash before the page has loaded.
  backgroundColor: "#080a0e",
  server: {
    // Other sites (Strava links) open outside; Strava's login uses the system sign-in sheet.
    url,
    errorPath: "index.html",
    cleartext: url.startsWith("http://"),
  },
  ios: {
    contentInset: "never",
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: "Looking for devices…",
        cancel: "Cancel",
        availableDevices: "Devices nearby",
        noDeviceFound: "No device found. Is it switched on and awake?",
      },
    },
  },
};

export default config;
