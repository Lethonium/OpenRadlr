import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountClient, AccountError } from "../public/js/net/account.js";

/** A fetch that answers from a list and keeps every request. */
function fakeFetch(...answers) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, ...init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const [status, body] = answers.shift() ?? [200, {}];
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, requests };
}

test("me is the account, or null when signed out", async () => {
  const { fetch } = fakeFetch([200, { email: "anna@example.org" }], [401, { error: "signed_out" }]);
  const client = new AccountClient({ fetch });
  assert.equal((await client.me()).email, "anna@example.org");
  assert.equal(await client.me(), null);
});

test("changes are sent as JSON with the session cookie", async () => {
  const { fetch, requests } = fakeFetch([204, null]);
  await new AccountClient({ fetch }).startEmail("anna@example.org", "de");
  assert.equal(requests[0].url, "/id/v1/email/start");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers["Content-Type"], "application/json");
  assert.equal(requests[0].credentials, "same-origin");
  assert.deepEqual(requests[0].body, { email: "anna@example.org", lang: "de" });
});

test("a refusal throws with the server's code and status", async () => {
  const { fetch } = fakeFetch([401, { error: "wrong_code" }]);
  const error = await new AccountClient({ fetch }).verifyEmail("a@b.org", "1").catch((e) => e);
  assert.ok(error instanceof AccountError);
  assert.equal(error.code, "wrong_code");
  assert.equal(error.status, 401);
});

test("a network failure throws an offline error", async () => {
  const client = new AccountClient({ fetch: async () => Promise.reject(new TypeError("Failed to fetch")) });
  assert.equal((await client.me().catch((e) => e)).code, "offline");
});

test("rider paths are escaped", async () => {
  const { fetch, requests } = fakeFetch([204, null]);
  await new AccountClient({ fetch }).putRide("r1", "17/../x", { km: 1 });
  assert.equal(requests[0].url, "/id/v1/riders/r1/rides/17%2F..%2Fx");
  assert.equal(requests[0].method, "PUT");
});

test("the ride ids come back as a list", async () => {
  const { fetch } = fakeFetch([200, { ids: ["1", "2"] }]);
  assert.deepEqual(await new AccountClient({ fetch }).rideIds("r1"), ["1", "2"]);
});

test("deleting the account sends JSON too, as the server requires", async () => {
  const { fetch, requests } = fakeFetch([204, null]);
  await new AccountClient({ fetch }).deleteAccount("de");
  assert.equal(requests[0].method, "DELETE");
  assert.deepEqual(requests[0].body, { lang: "de" });
  assert.equal(requests[0].headers["Content-Type"], "application/json");
});
