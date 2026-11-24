import { test } from "node:test";
import assert from "node:assert/strict";
import { accountMenuItem, finishOffer, riderBadge, riderStatus } from "../public/js/view/accountView.js";

const signedIn = (patch = {}) => ({ phase: "signedIn", me: { email: "anna@example.org", riders: [] }, linked: false, backup: null, ...patch });

test("the rider row says the progress is only on this device while signed out", () => {
  assert.deepEqual(riderBadge({ phase: "signedOut" }), { key: "account.status.local", params: {}, ok: false });
  assert.equal(riderBadge({ phase: "codeSent" }).key, "account.status.local");
});

test("the rider row says nothing while the account loads or can't be reached", () => {
  assert.equal(riderBadge({ phase: "loading" }), null);
  assert.equal(riderBadge({ phase: "offline" }), null);
  assert.equal(finishOffer({ phase: "offline" }), false);
});

test("signed in on an unsaved rider, the row says it isn't saved", () => {
  assert.equal(riderBadge(signedIn()).key, "account.status.notSaved");
});

test("a saved rider's row says where it is saved, or that it is saving", () => {
  assert.deepEqual(riderBadge(signedIn({ linked: true })), { key: "account.status.saved", params: { email: "anna@example.org" }, ok: true });
  assert.equal(riderBadge(signedIn({ linked: true, backup: { running: true } })).key, "account.status.backingUp");
});

test("the menu offers to save until the rider is saved, then has no account entry", () => {
  assert.equal(accountMenuItem({ phase: "signedOut" }).key, "account.menu.save");
  assert.equal(accountMenuItem(signedIn()).key, "account.saveRider");
  assert.equal(accountMenuItem(signedIn({ linked: true })), null);
});

test("the summary offers an account unless the rider is saved", () => {
  assert.equal(finishOffer({ phase: "signedOut" }), true);
  assert.equal(finishOffer(signedIn()), true);
  assert.equal(finishOffer(signedIn({ linked: true })), false);
  assert.equal(finishOffer({ phase: "loading" }), false);
});

test("the rider card tells a failed backup from a good one", () => {
  assert.deepEqual(riderStatus(signedIn({ linked: true, backup: { running: false, ok: false, reason: "offline" } }), null), { title: "account.rider.failed.title", detail: "account.rider.failed.detail", tone: "warning", when: null });
  assert.deepEqual(riderStatus(signedIn({ linked: true }), 5), { title: "account.rider.saved.title", detail: "account.rider.saved.detail", tone: "ok", when: 5 });
  assert.equal(riderStatus(signedIn({ linked: true }), null).detail, "account.rider.saved.detailNew");
  assert.equal(riderStatus(signedIn({ linked: true, backup: { running: true } }), 5).title, "account.rider.backingUp.title");
  assert.deepEqual(riderStatus(signedIn(), null), { title: "account.rider.notSaved.title", detail: "account.rider.notSaved.detail", tone: "warning", when: null });
});

test("a full account says so on the rider card", () => {
  const status = riderStatus(signedIn({ linked: true, backup: { running: false, ok: false, reason: "quota_exceeded" } }), null);
  assert.deepEqual([status.title, status.detail, status.tone], ["account.rider.full.title", "account.rider.full.detail", "warning"]);
});
