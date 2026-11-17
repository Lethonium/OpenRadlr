import { test } from "node:test";
import assert from "node:assert/strict";
import credits from "../../.github/scripts/release-contributors.cjs";

const pr = (name, n = 1) => `* A change by @${name} in https://github.com/example/ride/pull/${n}`;
const first = (name) => `* @${name} made their first contribution in https://github.com/example/ride/pull/1`;
const release = { id: 10, tag_name: "v0.2.0", body: "## Features\n\n* A feature\n", published_at: "2026-11-17T12:00:00Z", target_commitish: "main" };

function fixture(notes, current = release, releases = []) {
  const updates = [];
  const requests = [];
  const repos = {
    getReleaseByTag: async () => ({ data: current }),
    listReleases: () => {},
    generateReleaseNotes: async (args) => { requests.push(args); return { data: { body: notes } }; },
    updateRelease: async (args) => { updates.push(args); },
  };
  return { github: { rest: { repos }, paginate: async () => releases }, updates, requests };
}

async function run(fake) {
  return credits({ github: fake.github, owner: "example", repo: "ride", tag: release.tag_name });
}

test("release credits list each human once, marking first-time contributors inline", async () => {
  const fake = fixture([pr("zoe"), pr("Ada"), pr("Ada", 2), pr("dependabot[bot]"), "## New Contributors", first("zoe"), first("dependabot[bot]")].join("\n"));
  await run(fake);
  const body = fake.updates[0].body;
  assert.ok(body.startsWith(release.body));
  assert.match(body, /Thanks to @Ada, @zoe \(first contribution\)!/);
  assert.doesNotMatch(body, /dependabot|New Contributors/);
  assert.equal(body.match(/@Ada/g).length, 1);
});

test("mentions in change descriptions are not credited as authors", async () => {
  const fake = fixture(pr("Ada").replace("A change", "Help @someone"));
  await run(fake);
  assert.match(fake.updates[0].body, /Thanks to @Ada!/);
  assert.doesNotMatch(fake.updates[0].body, /@someone/);
});

test("bot-only releases do not get an empty contributors section", async () => {
  const fake = fixture(pr("github-actions[bot]"));
  await run(fake);
  assert.deepEqual(fake.updates, []);
});

test("credits use the previous published stable release, excluding newer, draft and prereleases", async () => {
  const fake = fixture(pr("Ada"), release, [
    release,
    { tag_name: "v0.3.0", published_at: "2026-11-18T12:00:00Z" },
    { tag_name: "v0.1.0", published_at: "2026-11-11T12:00:00Z" },
    { tag_name: "v0.0.1", published_at: "2026-10-11T12:00:00Z" },
    { tag_name: "draft", draft: true, published_at: "2026-11-16T12:00:00Z" },
    { tag_name: "v0.2.0-rc1", prerelease: true, published_at: "2026-11-16T12:00:00Z" },
  ]);
  await run(fake);
  assert.equal(fake.requests[0].previous_tag_name, "v0.1.0");
  assert.equal(fake.requests[0].tag_name, "v0.2.0");
});

test("first releases let GitHub generate notes without a previous tag", async () => {
  const fake = fixture(pr("Ada"));
  await run(fake);
  assert.equal(fake.requests[0].previous_tag_name, undefined);
});

test("rerunning credits preserves surrounding release notes without duplicating the section", async () => {
  const fake = fixture(pr("Ada"));
  await run(fake);
  const previous = fake.updates[0].body;
  const again = fixture(pr("Ada"), { ...release, body: previous });
  await run(again);
  assert.deepEqual(again.updates, []);
});

test("rerunning replaces only the managed section and preserves custom text after it", async () => {
  const fake = fixture(pr("Ada"));
  await run(fake);
  const again = fixture(pr("zoe"), { ...release, body: fake.updates[0].body + "\n\nCustom release notes" });
  await run(again);
  assert.match(again.updates[0].body, /Thanks to @zoe!/);
  assert.doesNotMatch(again.updates[0].body, /@Ada/);
  assert.ok(again.updates[0].body.endsWith("\n\nCustom release notes"));
});

test("API failures leave the original release untouched", async () => {
  const fake = fixture(pr("Ada"));
  fake.github.rest.repos.generateReleaseNotes = async () => { throw new Error("unavailable"); };
  await assert.rejects(run(fake), /unavailable/);
  assert.deepEqual(fake.updates, []);
});
