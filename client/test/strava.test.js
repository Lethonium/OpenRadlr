import { test } from "node:test";
import assert from "node:assert/strict";
import { StravaClient, activityUrl, appLoginResult, stravaMessage } from "../public/js/net/strava.js";

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

test("the app starts a login and claims it with the ticket", async () => {
  const { strava, calls } = client([reply(200, { url: "/auth/strava?app=abc" }), reply(204, {})]);
  assert.equal(await strava.startAppLogin(), "/auth/strava?app=abc");
  assert.equal(calls[0].url, "/auth/strava/app");
  assert.equal(calls[0].method, "POST");
  await strava.claimAppLogin("t1");
  assert.equal(calls[1].url, "/auth/strava/app/claim");
  assert.deepEqual(JSON.parse(calls[1].body), { ticket: "t1" });
});

test("a claim the server refuses is an error", async () => {
  const { strava } = client([reply(404, { code: "no_login", message: "no finished Strava login to claim" })]);
  await assert.rejects(strava.claimAppLogin("t1"), /no finished Strava login/);
});

test("reads how an app login ended from its openradlr:// URL", () => {
  assert.deepEqual(appLoginResult("openradlr://strava?result=connected&ticket=t1"), { result: "connected", ticket: "t1" });
  assert.deepEqual(appLoginResult("openradlr://strava?result=denied"), { result: "denied", ticket: null });
  assert.deepEqual(appLoginResult("not a url"), { result: "failed", ticket: null });
});
