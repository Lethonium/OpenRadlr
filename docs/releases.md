# Releases

OpenRadlr ships as one application. [Release Please](https://github.com/googleapis/release-please)
maintains a release PR on `main`; merging it creates a `vX.Y.Z` tag and a GitHub
Release. It does not publish packages, build release assets, or deploy a server.

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
2. Review the proposed version, generated notes and passing CI. Keep adding
   user-visible notes with issue references under `[Unreleased]` during development.
   During release review, fold those notes into the generated version section,
   remove duplicates and leave `[Unreleased]` empty. Release Please inserts its
   generated version section above `[Unreleased]` and does not consume manual notes.
   Recheck any manual edits if subsequent commits regenerate the PR.
3. Merge the release PR. The next workflow run creates the tag and GitHub Release.
   Deploy using the existing deployment process when ready.

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
