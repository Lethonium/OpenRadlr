/**
 * The signed Android App Bundle for Google Play (npm run android:bundle,
 * docs/app.md#google-play): syncs the app, checks that it opens an https
 * server and that the upload key is set up, then builds the bundle.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const ANDROID = "android";
const SIGNING = `${ANDROID}/keystore.properties`;
const BUNDLE = `${ANDROID}/app/build/outputs/bundle/release/app-release.aab`;
// Where Android Studio puts its JDK and the SDK on a Mac, used when nothing else is set up.
const STUDIO_JDK = "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
const STUDIO_SDK = `${homedir()}/Library/Android/sdk`;

const fail = (message) => {
  console.error(`android:bundle: ${message}`);
  process.exit(1);
};

if (!existsSync(SIGNING) && !process.env.OPENRADLR_UPLOAD_STORE_FILE) {
  fail(`no upload key: create ${SIGNING} (docs/app.md#google-play) or set OPENRADLR_UPLOAD_STORE_FILE`);
}

execFileSync("npx", ["cap", "sync", "android"], { stdio: "inherit" });

// What the bundle will open: a store build must not point at a dev server.
const { server } = JSON.parse(readFileSync(`${ANDROID}/app/src/main/assets/capacitor.config.json`, "utf8"));
if (!server?.url?.startsWith("https://") || server.cleartext) {
  fail(`the app opens ${server?.url}, a store build needs an https server: unset OPENRADLR_APP_URL`);
}

const env = { ...process.env };
if (!env.JAVA_HOME && existsSync(STUDIO_JDK)) env.JAVA_HOME = STUDIO_JDK;
if (!env.ANDROID_HOME && !existsSync(`${ANDROID}/local.properties`) && existsSync(STUDIO_SDK)) env.ANDROID_HOME = STUDIO_SDK;
execFileSync("./gradlew", ["bundleRelease"], { cwd: ANDROID, stdio: "inherit", env });
console.log(`\n${BUNDLE} opens ${server.url}`);
