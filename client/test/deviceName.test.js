import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceName } from "../public/js/net/deviceName.js";

test("knows the Quest 3", () => {
  assert.equal(deviceName("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 OculusBrowser/35.0 Quest 3 VR Safari/537.36"), "Quest 3");
  assert.equal(deviceName("Mozilla/5.0 (X11; Linux x86_64) OculusBrowser/20.0 VR Safari/537.36"), "Quest");
});

test("knows an Android phone from a tablet", () => {
  assert.equal(deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"), "Android phone");
  assert.equal(deviceName("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120 Safari/537.36"), "Android tablet");
});

test("knows an iPhone and an iPad", () => {
  assert.equal(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"), "iPhone");
  assert.equal(deviceName("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15"), "iPad");
});

test("falls back to Browser", () => {
  assert.equal(deviceName("Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0"), "Browser");
  assert.equal(deviceName(""), "Browser");
  assert.equal(deviceName(undefined), "Browser");
});
