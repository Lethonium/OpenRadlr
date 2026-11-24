import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareSourceArchive } from "../../.github/scripts/release-source.cjs";

const sha = "a".repeat(40);
function fixture({ version = "1.2.3", tagSha = sha } = {}) {
  const calls = [];
  const archive = Buffer.from("fixture archive");
  const run = (command, args) => {
    assert.equal(command, "git");
    calls.push(args);
    if (args[0] === "rev-parse") return Buffer.from((args.at(-1) === "HEAD" ? sha : tagSha) + "\n");
    if (args[0] === "show") return Buffer.from(version + "\n");
    if (args[0] === "archive") return archive;
    throw new Error("Unexpected git command");
  };
  return { run, calls, archive };
}

test("source releases reject invalid tag names before invoking git", () => {
  for (const tag of ["", "main", "../../outside", "v1.2.3;echo bad", "v1.2.3\n"]) {
    const fake = fixture();
    assert.throws(() => prepareSourceArchive({ tag, run: fake.run }), /tag/);
    assert.deepEqual(fake.calls, []);
  }
});

test("source releases must archive the exact commit the release tag points to", () => {
  const fake = fixture({ tagSha: "b".repeat(40) });
  assert.throws(() => prepareSourceArchive({ tag: "v1.2.3", run: fake.run }), /checkout/);
  assert.ok(fake.calls.every((args) => args[0] !== "archive"));
});

test("source release versions must match the tagged version file", () => {
  const fake = fixture({ version: "1.2.2" });
  assert.throws(() => prepareSourceArchive({ tag: "v1.2.3", run: fake.run }), /version/);
  assert.ok(fake.calls.every((args) => args[0] !== "archive"));
});

test("source archives use a fixed commit and checksums describe their actual bytes", () => {
  const fake = fixture();
  const result = prepareSourceArchive({ tag: "v1.2.3", run: fake.run });
  assert.equal(result.name, "openradlr-v1.2.3-source.tar.gz");
  assert.deepEqual(fake.calls.at(-1), ["archive", "--format=tar.gz", "--prefix=openradlr-v1.2.3/", sha]);
  assert.equal(result.archive, fake.archive);
  assert.equal(result.checksums, `${createHash("sha256").update(result.archive).digest("hex")}  ${result.name}\n`);
});

test("unsigned PR snapshots do not need an existing release tag", () => {
  const fake = fixture();
  prepareSourceArchive({ tag: "v0.0.0-test", snapshot: true, run: fake.run });
  assert.deepEqual(fake.calls.filter((args) => args[0] === "rev-parse"), [["rev-parse", "--verify", "HEAD"]]);
});
