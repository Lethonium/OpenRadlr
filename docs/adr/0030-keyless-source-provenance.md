# 30. Keyless provenance for release source archives

## Context

Release Please publishes version tags and release notes, but releases have no
attached artifacts or signatures. GitHub's automatically generated source links
alone do not provide a project-issued provenance statement for a downloaded file.
We want verifiable release downloads without maintaining a long-lived signing key.

## Decision

For future published releases, a dedicated GitHub Actions workflow archives only
the exact tagged commit, checks its `version.txt`, and generates SHA-256 checksums.
GitHub's pinned `actions/attest` action issues Sigstore-backed SLSA provenance for
both the source archive and checksum manifest using the job's short-lived OIDC
identity. The workflow verifies the bundle against the repository, signing
workflow and source tag before attaching the files and `.sigstore.json` bundle.

Pull requests run unsigned packaging tests with read-only permissions. Only the
release publishing job has contents, attestation and OIDC write permissions. No
production credentials or persistent signing key are involved.

## Consequences

Consumers can verify downloaded source with `gh attestation verify` and verify
checksums before extraction. The signature authenticates provenance and file
integrity; it does not establish that the source is free of vulnerabilities.

The release publisher depends on GitHub/Sigstore availability. Failed runs can be
retried on the same release. Existing releases are not silently backfilled.
This publishes source artifacts; native binaries, app-store signing and container
signing remain separate concerns.
