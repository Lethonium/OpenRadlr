const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

function prepareSourceArchive({ tag, snapshot = false, run = execFileSync }) {
  if (typeof tag !== "string" || tag.trim() !== tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(tag)) {
    throw new Error("Expected a version tag such as v1.2.3");
  }
  const git = (...args) => run("git", args, { maxBuffer: 256 * 1024 * 1024 });
  const sha = git("rev-parse", "--verify", "HEAD").toString().trim();
  if (!snapshot) {
    const taggedSha = git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`).toString().trim();
    if (sha !== taggedSha) throw new Error("Release checkout does not match its tag");
    const version = git("show", `${sha}:version.txt`).toString().trim();
    if (tag !== `v${version}`) throw new Error("Release tag does not match version.txt");
  }
  // Archive the committed tree only, excluding local files, credentials and build output.
  const archive = git("archive", "--format=tar.gz", `--prefix=openradlr-${tag}/`, sha);
  const name = `openradlr-${tag}-source.tar.gz`;
  const digest = createHash("sha256").update(archive).digest("hex");
  return { name, archive, checksums: `${digest}  ${name}\n` };
}

module.exports = { prepareSourceArchive };

if (require.main === module) {
  const output = process.env.OUT_DIR;
  if (!output) throw new Error("OUT_DIR must name the release artifact directory");
  const result = prepareSourceArchive({ tag: process.env.RELEASE_TAG, snapshot: process.env.SNAPSHOT === "true" });
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, result.name), result.archive);
  writeFileSync(join(output, "SHA256SUMS"), result.checksums);
  console.log(`Prepared ${result.name}`);
}
