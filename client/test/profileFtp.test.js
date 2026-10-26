import { test } from "node:test";
import assert from "node:assert/strict";
import { ProfileStore } from "../public/js/profile/profileStore.js";
import { ftpProvenance } from "../public/js/view/ftpProvenance.js";

function memoryStorage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => (value = next) };
}

const NOON = new Date(2026, 9, 19, 12).getTime();

test("a new profile starts with a default FTP and no date", () => {
  const profile = new ProfileStore({ storage: memoryStorage() }).load();
  assert.equal(profile.ftpSource, "default");
  assert.equal(profile.ftpDate, null);
  assert.equal(profile.ftpDismissed, null);
});

test("a stored profile from before provenance with the default FTP loads as default", () => {
  const store = new ProfileStore({ storage: memoryStorage('{"name":"Old","ftp":200}') });
  assert.equal(store.load().ftpSource, "default");
});

test("a changed FTP is typed by default, or takes the given source", () => {
  const store = new ProfileStore({ storage: memoryStorage() });
  const typed = store.save({ ...store.load(), ftp: 230 }, { now: NOON });
  assert.equal(typed.ftpSource, "typed");
  assert.equal(typed.ftpDate, NOON);
  const tested = store.save({ ...typed, ftp: 240 }, { ftpSource: "tested", now: NOON + 1 });
  assert.equal(tested.ftpSource, "tested");
  assert.equal(tested.ftpDate, NOON + 1);
  assert.equal(tested.levelW, null);
});

test("saving the same FTP keeps its source and date", () => {
  const store = new ProfileStore({ storage: memoryStorage() });
  const first = store.save({ ...store.load(), ftp: 230 }, { ftpSource: "estimated", now: NOON });
  const again = store.save({ ...first, name: "Ann" }, { now: NOON + 5000 });
  assert.equal(again.ftpSource, "estimated");
  assert.equal(again.ftpDate, NOON);
  assert.equal(store.load().ftpSource, "estimated");
});

test("provenance text names the source and the date", () => {
  const at = (ftpSource, ftpDate = NOON) => ftpProvenance({ ftpSource, ftpDate }, { locale: "en-GB" });
  assert.equal(at("default", null), "Default value: take the FTP test or ride a hard effort to measure it.");
  assert.equal(at("typed"), "Entered by hand on 19 Oct.");
  assert.equal(at("estimated"), "Estimated from your rides on 19 Oct.");
  assert.equal(at("tested"), "Measured by the ramp test on 19 Oct.");
  assert.equal(at("typed", null), "Entered by hand.");
});

test("provenance survives a malformed browser locale", () => {
  const text = ftpProvenance({ ftpSource: "tested", ftpDate: NOON }, { locale: "en-US@posix" });
  assert.match(text, /^Measured by the ramp test on .+\.$/);
});

test("a stored profile with a custom FTP but no source loads as typed, without a date", () => {
  const store = new ProfileStore({ storage: memoryStorage('{"name":"Old","ftp":250}') });
  const profile = store.load();
  assert.equal(profile.ftpSource, "typed");
  assert.equal(profile.ftpDate, null);
  assert.equal(ftpProvenance(profile, { locale: "en-GB" }), "Entered by hand.");
});

test("a changed FTP clears a dismissed estimate unless the caller sets it", () => {
  const store = new ProfileStore({ storage: memoryStorage() });
  const dismissed = store.save({ ...store.load(), ftpDismissed: 260 });
  assert.equal(dismissed.ftpDismissed, 260);
  const changed = store.save({ ...dismissed, ftp: 230 }, { now: NOON });
  assert.equal(changed.ftpDismissed, null);
  const explicit = store.save({ ...changed, ftp: 240, ftpDismissed: 300 }, { now: NOON + 1 });
  assert.equal(explicit.ftpDismissed, 300);
});
