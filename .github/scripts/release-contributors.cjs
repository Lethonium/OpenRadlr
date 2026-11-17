// Append compact credits to GitHub Releases; Release Please keeps owning the changelog.
const START = "<!-- release-contributors:start -->";
const END = "<!-- release-contributors:end -->";

module.exports = async function releaseContributors({ github, owner, repo, tag }) {
  const repos = github.rest.repos;
  const { data: release } = await repos.getReleaseByTag({ owner, repo, tag });
  const releases = await github.paginate(repos.listReleases, { owner, repo, per_page: 100 });
  // Explicitly bound the range so retrying an older release cannot credit newer work.
  const previous = releases
    .filter((r) => !r.draft && !r.prerelease && r.tag_name !== tag && Date.parse(r.published_at) < Date.parse(release.published_at))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  const { data: notes } = await repos.generateReleaseNotes({
    owner, repo, tag_name: tag, target_commitish: release.target_commitish,
    ...(previous ? { previous_tag_name: previous.tag_name } : {}),
  });
  // GitHub's generated notes provide PR authors and first-time contributor status.
  // Only parse author positions, never arbitrary @mentions in PR titles.
  const authors = [...notes.body.matchAll(/^[-*] .* by @([\w-]+(?:\[bot\])?) in https:\/\/\S+\/pull\/\d+\s*$/gm)].map((match) => match[1]);
  const newcomers = new Set([...notes.body.matchAll(/^[-*] @([\w-]+(?:\[bot\])?) made their first contribution in https:\/\/\S+\/pull\/\d+\s*$/gm)].map((match) => match[1].toLowerCase()));
  const humans = new Map(authors.filter((name) => !name.endsWith("[bot]")).map((name) => [name.toLowerCase(), name]));
  const names = [...humans].sort(([a], [b]) => a.localeCompare(b)).map(([key, name]) => `@${name}${newcomers.has(key) ? " (first contribution)" : ""}`);
  const section = names.length ? `${START}\n### Contributors\n\nThanks to ${names.join(", ")}!\n${END}` : "";
  const original = release.body || "";
  const start = original.indexOf(START);
  const end = original.indexOf(END, start);
  let body;
  if (start >= 0 && end >= start) {
    body = original.slice(0, start) + section + original.slice(end + END.length);
  } else {
    body = section ? `${original.trimEnd()}\n\n${section}\n` : original;
  }
  if (body !== original) await repos.updateRelease({ owner, repo, release_id: release.id, body });
  return body;
};
