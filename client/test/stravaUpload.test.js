import { test } from "node:test";
import assert from "node:assert/strict";
import { StravaUpload, UploadReceipts, uploadKey } from "../public/js/net/stravaUpload.js";

function storage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
}
function setup(overrides = {}) {
  const calls = [];
  const receipts = new UploadReceipts({ storage: storage() });
  const client = {
    upload: async () => { calls.push("post"); return { id: 9 }; },
    waitForActivity: async (receipt) => { calls.push(receipt.id); return receipt; },
    ...overrides,
  };
  const job = new StravaUpload({ client, receipts, key: "7:1000" });
  return { job, client, calls, receipts };
}
const file = () => new Uint8Array([1]);

test("accepted but still processing is pending, never saved", async () => {
  const { job } = setup();
  await job.run(file, "ride");
  assert.equal(job.state.phase, "pending");
  assert.equal(job.state.uploadId, 9);
  assert.equal(job.state.activityId, null);
});

test("checking a pending upload never submits the ride again", async () => {
  const { job, calls } = setup();
  await job.run(file, "ride");
  await job.run(file, "ride");
  assert.deepEqual(calls, ["post", 9, 9]);
});

test("a reloaded controller resumes its accepted upload", async () => {
  const { job, client, receipts, calls } = setup();
  await job.run(file, "ride");
  const reloaded = new StravaUpload({ client, receipts, key: "7:1000" });
  await reloaded.run(file, "ride");
  assert.deepEqual(calls, ["post", 9, 9]);
});

test("a failed status check retains the upload ID for retry", async () => {
  const { job, calls } = setup({ waitForActivity: async () => { throw new Error("offline"); } });
  await job.run(file, "ride");
  assert.equal(job.state.phase, "check-failed");
  assert.equal(job.state.uploadId, 9);
  await job.run(file, "ride");
  assert.deepEqual(calls, ["post"]);
});

test("concurrent clicks share one submission", async () => {
  let resolve;
  const { job } = setup({ upload: () => new Promise((r) => { resolve = r; }) });
  const first = job.run(file, "ride");
  const second = job.run(file, "ride");
  assert.equal(first, second);
  resolve({ id: 9, activity_id: 77 });
  await first;
  assert.equal(job.state.phase, "success");
});

test("an immediate activity ID succeeds without polling", async () => {
  const { job, calls } = setup({ upload: async () => ({ id: 9, activity_id: 77 }) });
  await job.run(file, "ride");
  assert.equal(job.state.activityId, 77);
  assert.deepEqual(calls, []);
});

test("Strava rejection is terminal and is not called success", async () => {
  const { job } = setup({ upload: async () => ({ id: 9, error: "duplicate" }) });
  await job.run(file, "ride");
  assert.equal(job.state.phase, "rejected");
  assert.equal(job.state.error, "duplicate");
});

test("a lost submission response needs explicit permission before resubmission", async () => {
  const { job, calls } = setup({ upload: async () => { calls.push("post"); throw new Error("offline"); } });
  await job.run(file, "ride");
  assert.equal(job.state.phase, "uncertain");
  await job.run(file, "ride");
  assert.deepEqual(calls, ["post"]);
  await job.run(file, "ride", { resubmit: true });
  assert.deepEqual(calls, ["post", "post"]);
});

test("reload during submission is uncertain rather than safe to post", () => {
  const receipts = new UploadReceipts({ storage: storage() });
  receipts.save("7:1000", { phase: "uploading", uploadId: null, activityId: null });
  const job = new StravaUpload({ client: {}, receipts, key: "7:1000" });
  assert.equal(job.state.phase, "uncertain");
});

test("disposing during submission persists the receipt without notifying the old screen or polling", async () => {
  let resolve;
  const { job, calls, receipts } = setup({ upload: () => new Promise((r) => { resolve = r; }) });
  const states = [];
  job.subscribe((state) => states.push(state.phase));
  const running = job.run(file, "ride");
  job.dispose();
  resolve({ id: 9 });
  await running;
  assert.deepEqual(calls, []);
  assert.deepEqual(states, ["idle", "uploading"]);
  assert.equal(receipts.load("7:1000").uploadId, 9);
});

test("receipts belong to both the athlete and the ride", () => {
  assert.notEqual(uploadKey(7, 1000), uploadKey(8, 1000));
  assert.notEqual(uploadKey(7, 1000), uploadKey(7, 2000));
});

test("unavailable storage retains the receipt in memory and exposes the limitation", async () => {
  const receipts = new UploadReceipts({ storage: { getItem() { throw new Error(); }, setItem() { throw new Error(); } } });
  const { client } = setup();
  const job = new StravaUpload({ client, receipts, key: "7:1000" });
  await job.run(file, "ride");
  assert.equal(job.state.persisted, false);
  assert.equal(receipts.load("7:1000").uploadId, 9);
});

test("a confirmed activity is never uploaded twice", async () => {
  const { job, client, receipts, calls } = setup({ waitForActivity: async () => ({ id: 9, activity_id: 77 }) });
  await job.run(file, "ride");
  const reloaded = new StravaUpload({ client, receipts, key: "7:1000" });
  await reloaded.run(file, "ride");
  assert.deepEqual(calls, ["post"]);
});

test("a recovery panel opened during submission checks the late receipt instead of reposting", async () => {
  let resolve;
  const { job, client, receipts, calls } = setup({ upload: () => { calls.push("post"); return calls.length > 1 ? Promise.resolve({ id: 10 }) : new Promise((r) => { resolve = r; }); } });
  const running = job.run(file, "ride");
  job.dispose();
  const recovery = new StravaUpload({ client, receipts, key: "7:1000" });
  resolve({ id: 9 });
  await running;
  await recovery.run(file, "ride", { resubmit: true });
  assert.deepEqual(calls, ["post", 9]);
});

test("a real storage round trip resumes processing after reload", async () => {
  const disk = storage();
  const receipts = new UploadReceipts({ storage: disk });
  const { client, calls } = setup();
  await new StravaUpload({ client, receipts, key: "7:1000" }).run(file, "ride");
  const afterReload = new StravaUpload({ client, receipts: new UploadReceipts({ storage: disk }), key: "7:1000" });
  await afterReload.run(file, "ride");
  assert.deepEqual(calls, ["post", 9, 9]);
});

test("permission denial is a refused submission rather than an uncertain one", async () => {
  const { job } = setup({ upload: async () => { throw Object.assign(new Error("permission"), { status: 403, code: "upload_not_allowed" }); } });
  await job.run(file, "ride");
  assert.equal(job.state.phase, "failed");
  assert.equal(job.state.code, "upload_not_allowed");
});

test("an invalid upload response never counts as success", async () => {
  const { job } = setup({ upload: async () => ({}) });
  await job.run(file, "ride");
  assert.equal(job.state.phase, "uncertain");
});
