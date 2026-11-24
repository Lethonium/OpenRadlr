# Releases

OpenRadlr ships as one application. [Release Please](https://github.com/googleapis/release-please)
maintains a release PR on `main`; merging it creates a `vX.Y.Z` tag and a GitHub
Release. A separate workflow attaches signed source artifacts after publication
(see below). Neither workflow deploys a server or publishes a package registry entry.

## Repository setup

Before merging the automation, a maintainer must:

1. Create a fine-grained personal access token restricted to this repository,
   with **Contents**, **Issues**, and **Pull requests** permissions set to
   **Read and write**. The token owner must have write access to the repository.
2. Save it as the Actions repository secret `RELEASE_PLEASE_TOKEN` under
   **Settings → Secrets and variables → Actions**. Renew it before it expires.
3. Allow Actions to create pull requests under **Settings → Actions → General**
   if required by the repository or organization policy.

The separate token lets CI run on generated release PRs and tags. Events created
with the default `GITHUB_TOKEN` do not trigger other workflows; see the
[action's credential documentation](https://github.com/googleapis/release-please-action#github-credentials).
The workflow deliberately requires the configured token.

## Commit messages

Use Conventional Commits for commits landing on `main`. With squash merges, use
the PR title as the squash commit subject and preserve any breaking-change footer
in its body. Keep the description imperative and include issue numbers:

```text
feat(client): Add a rider search (#123)
fix(server): Preserve ride progress after reconnecting (#124)
chore(ci): Update the Rust toolchain
```

`feat` adds a minor version and `fix` adds a patch version. A `!` after the type
or scope, or a `BREAKING CHANGE:` footer, marks a breaking change. Before 1.0,
breaking changes bump the minor version; from 1.0 onward they bump the major.
Other types (`docs`, `test`, `refactor`, `ci`, `build`, `chore`) normally do not
trigger a release unless they declare a breaking change.

## Reviewing and publishing

1. Merge changes into `main`. The workflow opens or updates the release PR when
   there are releasable Conventional Commits. It can also be run manually on `main`.
2. Review the proposed version, the generated notes and passing CI. Release
   Please writes `CHANGELOG.md` and the GitHub Release from the merged PR titles,
   so nobody edits the changelog by hand: a change whose title isn't a
   Conventional Commit is missing from the notes, which is why reviewers check
   the title before merging.
3. Merge the release PR. The next workflow run creates the tag and GitHub Release.
   Deploy using the existing deployment process when ready.

## Contributor credits

After Release Please publishes a release, the workflow appends one compact
**Contributors** section to its GitHub Release notes. Each human PR author in
that release appears once; first-time contributors are marked `(first contribution)`.
Bot accounts are excluded. GitHub's generated release notes supply both the PR
attribution and first-time status, using the previous published stable release
as the comparison point. These credits cover merged pull requests, including
ones outside the feature/fix changelog; direct commits and reviews are not credited.

The feature/fix notes and `CHANGELOG.md` keep their existing format, without
per-change author mentions. Credits are added only to the published GitHub
Release, so they appear after publication rather than in the release PR preview.

To retry a failed credits step or refresh an existing release, run **Release
Please** manually on `main` with **credits-tag** set to its tag, e.g. `v0.1.0`.
This mode skips release creation and replaces only the managed contributor section,
preserving the rest of the release notes. Leaving the input empty runs the usual
release flow. Existing releases are not modified automatically.

## Verifiable source downloads

For releases published after this workflow is merged, **Signed release source**
attaches three files to the GitHub Release:

- `openradlr-vX.Y.Z-source.tar.gz`: the committed source tree at the release tag.
- `SHA256SUMS`: the source archive's SHA-256 checksum.
- `openradlr-vX.Y.Z.sigstore.json`: a signed provenance bundle covering both files.

The workflow checks that the checkout is the tagged commit and its `version.txt`
matches the release. It generates [GitHub artifact attestations](https://github.com/actions/attest)
with a short-lived Sigstore certificate, then verifies both subjects against this
repository, the signing workflow and source tag before uploading. Pull-request
checks only build unsigned snapshots and have no publishing or OIDC permission.

To download and verify a release with a recent [GitHub CLI](https://cli.github.com/manual/gh_attestation_verify),
replace `v0.2.0` with a release that has these assets, and run in an empty directory:

```bash
tag=v0.2.0
gh release download "$tag" --repo Lethonium/OpenRadlr \
  --pattern "openradlr-${tag}-source.tar.gz" --pattern SHA256SUMS \
  --pattern "openradlr-${tag}.sigstore.json"
for file in "openradlr-${tag}-source.tar.gz" SHA256SUMS; do
  gh attestation verify "$file" --repo Lethonium/OpenRadlr \
    --bundle "openradlr-${tag}.sigstore.json" \
    --signer-workflow Lethonium/OpenRadlr/.github/workflows/release-source.yml \
    --source-ref "refs/tags/$tag"
done
sha256sum --check SHA256SUMS  # macOS: shasum -a 256 --check SHA256SUMS
```

Verify signatures and checksums before extracting or building the archive.
These are source releases, not prebuilt server binaries or app-store packages.
The attestation identifies the source and producing workflow; it is not a security
audit of the code. No extra signing secret is needed. Release Please uses its
existing separate token, so its published-release event can trigger this workflow.

If publication fails, inspect the **Signed release source** run and rerun its
failed job. Rebuilding the same committed tree produces the same archive; upload
replaces only the three named source assets. Existing releases are not modified
automatically, and releases predating the workflow are not supported by this job.
Scorecard's Signed-Releases result can change only after a release has actual
signature assets and its scan refreshes.

## Version tracking

`release-please-config.json` defines one root package so changes anywhere in the
repository can contribute to a release. The `simple` strategy updates `version.txt`
and `CHANGELOG.md`. Targeted extra-file updates synchronize the Rust workspace
version, both local crate entries in `server/Cargo.lock`, the client package version
and both version fields in its npm lockfile. Dependency versions stay independent.
The crate manifests continue to inherit `version.workspace = true`.
The landing site's package has no release version.

The Cargo lockfile selector uses `name.value` because Release Please's TOML
updater wraps scalar values with source-position metadata. When upgrading the
action, verify a proposed version bump changes both local crates and leaves
third-party dependency versions unchanged.

There are no existing releases to seed. The manifest starts empty and
`initial-version` makes the first release **0.1.0**. Older commits without a
Conventional Commit prefix are not included automatically; summarize the initial
application in the first release PR. To start it explicitly, use a commit body
containing `Release-As: 0.1.0` (for example on a `chore: Prepare the first release`
commit). After the first release, Release Please maintains the manifest; do not
manually bump the version files for ordinary changes.
