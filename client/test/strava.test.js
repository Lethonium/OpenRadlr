import { test } from "node:test";
import assert from "node:assert/strict";
import { StravaClient, activityUrl, stravaMessage } from "../public/js/net/strava.js";

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

function client(responses) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    const next = responses.shift();
    return typeof next === "function" ? next(url, options) : next;
  };
  return { strava: new StravaClient({ fetch, sleep: async () => {} }), calls };
}

test("me is null when not connected", async () => {
  const { strava } = client([reply(401, { code: "not_connected" }), reply(200, { athlete_id: 1, name: "Leon F.", can_upload: true })]);
  assert.equal(await strava.me(), null);
  assert.equal((await strava.me()).name, "Leon F.");
});

test("upload posts the TCX and waits until Strava made an activity", async () => {
  const { strava, calls } = client([
    reply(200, { id: 9, status: "Your activity is still being processed." }),
    reply(200, { id: 9, status: "Your activity is still being processed." }),
    reply(200, { id: 9, status: "Your activity is ready.", activity_id: 77 }),
  ]);
  const upload = await strava.upload("<?xml ...", "OpenRadlr · Rolling Hills");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "/api/strava/upload?name=OpenRadlr%20%C2%B7%20Rolling%20Hills");
  assert.equal(calls[0].body, "<?xml ...");
  const done = await strava.waitForActivity(upload);
  assert.equal(done.activity_id, 77);
  assert.equal(calls[2].url, "/api/strava/upload/9");
  assert.equal(activityUrl(77), "https://www.strava.com/activities/77");
});

test("upload errors carry the server's message; polling stops on errors", async () => {
  const { strava } = client([reply(403, { code: "upload_not_allowed", message: "allow uploads" })]);
  await assert.rejects(strava.upload("x", "n"), /allow uploads/);

  const second = client([reply(200, { id: 3, error: "duplicate of activity 5" })]).strava;
  const status = await second.waitForActivity({ id: 3, error: "duplicate of activity 5" });
  assert.equal(status.error, "duplicate of activity 5");
});

test("messages after returning from Strava", () => {
  assert.match(stravaMessage("denied"), /cancelled/);
  assert.equal(stravaMessage(null), null);
});
