# 17. One application version with Release Please

Date: 2026-11-08 · Status: accepted

## Context

The browser client and Rust server ship together and currently share version
0.1.0. There are no release tags. Manual version updates would need to keep the
workspace, client and lockfiles consistent.

## Decision

Use Release Please in manifest mode with one package rooted at the repository
root. The simple strategy tracks the application in `version.txt`; targeted
JSON and TOML updates synchronize existing version fields. Conventional Commits
drive release PRs, changelog entries and `vX.Y.Z` GitHub Releases. The first
release is 0.1.0. Before 1.0, breaking changes bump the minor version.

Run the action on `main` using a dedicated repository token so generated PRs
receive the existing CI checks. Maintainers choose when to merge the release PR.

## Consequences

- Client-only and server-only changes can both trigger an application release.
- Contributors use Conventional Commits for commits landing on `main`.
- Maintainers provision and renew the token. Release Please alone writes
  `CHANGELOG.md` from the PR titles; there are no hand-written notes to
  reconcile (since 0.1.0, when an `[Unreleased]` list kept apart from the
  generated sections was dropped).
- Deployment and artifact publication remain separate from release creation.
- New versioned components must be added to the synchronized file list.
