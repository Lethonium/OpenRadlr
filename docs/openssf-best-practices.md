# OpenSSF Best Practices assessment

This is an evidence worksheet for a maintainer completing the
[OpenSSF Best Practices passing questionnaire](https://www.bestpractices.dev/en/criteria/0).
It is **not** a badge, certification, or declaration that every criterion is met.
No project registration was returned by the service's repository-URL lookup on
2026-11-22. A maintainer must register the project and review the complete current
questionnaire; repository changes alone cannot earn this badge.

## Project details for registration

- Name: **OpenRadlr**
- Website: <https://openradlr.com/>
- Source repository: <https://github.com/Lethonium/OpenRadlr>
- Description: Open-source indoor cycling in a browser or native app, with a Rust
  multiplayer server, smart-trainer integration, virtual routes and workouts.
- Code licence: GNU AGPL v3 or later ([LICENSE](../LICENSE)).
- Artwork licence: CC BY-SA 4.0 ([ASSETS-LICENSE.md](../ASSETS-LICENSE.md)).
- Maintainers: see [CODEOWNERS](../.github/CODEOWNERS). Use a maintainer's own
  account and contact information when registering; do not invent contact details.

## Evidence to review

These are starting points, not pre-filled "Met" answers. Use permanent links to
reviewed commits when submitting evidence that must remain stable.

| Area | Repository evidence | Review still required |
| --- | --- | --- |
| Purpose, obtaining the software and participation | [README](../README.md), [CONTRIBUTING](../CONTRIBUTING.md), public [issues](https://github.com/Lethonium/OpenRadlr/issues) and PRs | Confirm the website points users to the relevant information. |
| Licencing and documentation | [LICENSE](../LICENSE), [asset licence](../ASSETS-LICENSE.md), [architecture](architecture.md), [protocol](protocol.md), [deployment](deploy.md), [app](app.md) | Check scope, completeness and third-party licences; code and artwork use different licences. |
| Change control and releases | Git history, [release process](releases.md), version files, tags and [published notes](https://github.com/Lethonium/OpenRadlr/releases) | Verify the actual releases and whether security fixes are described appropriately. |
| Builds, tests and analysis | [Makefile](../Makefile), [CI](../.github/workflows/ci.yml), client/Rust tests, ESLint, Clippy, [CodeQL results](https://github.com/Lethonium/OpenRadlr/security/code-scanning), [pre-commit checks](../.pre-commit-config.yaml) | Inspect recent successful runs and assess test adequacy. Do not infer a coverage percentage from test counts. |
| Reports and discussion | Public issues/PRs, [code of conduct](../CODE_OF_CONDUCT.md), [security policy](../SECURITY.md) | Review actual bug/enhancement response history over the period the questionnaire requires. A policy alone does not prove responses occurred. |
| Private security reporting | [Private report form](https://github.com/Lethonium/OpenRadlr/security/advisories/new), enabled in GitHub as checked on 2026-11-22 | Maintainers must confirm who receives reports, historical response/fix times, and their disclosure process. |
| Secure design and cryptography | [architecture decisions](adr/), [server dependencies](../server/crates/server/Cargo.toml), [Strava implementation](../server/crates/server/src/strava.rs) | A qualified maintainer must evaluate secure-design knowledge, cryptographic usage and key handling. Library names do not establish correct use. |
| Dependency vulnerability status | Dependabot alerts, dependency lockfiles, [dependency fixes PR](https://github.com/Lethonium/OpenRadlr/pull/126) | The PR must be merged before its fixes count. picomatch has no published patched version as of this review; assess exposure and retain the open finding. |

## Related work that is not yet evidence of a completed practice

- [Property-based fuzzing PR](https://github.com/Lethonium/OpenRadlr/pull/129):
  client boundary properties and scheduled searches. Confirm it is merged and
  its scheduled run succeeds before relying on that practice.
- [Signed source releases PR](https://github.com/Lethonium/OpenRadlr/pull/130):
  keyless provenance and verification. Confirm a real release has the assets
  and that download verification succeeds before claiming signed downloads.

Neither PR's existence proves the practice is already operating. The separate
Scorecard checks and the Best Practices questionnaire are different assessments.

## Maintainer completion

1. Sign in to [the Best Practices service](https://www.bestpractices.dev/) and
   register the exact repository URL above, checking first for an existing entry.
2. Work through the whole current passing questionnaire. Use "Unmet" or "Unknown"
   where evidence is missing. Use "N/A" only with the justification the criterion
   permits. This worksheet is not an exhaustive substitute for the questionnaire.
3. Review response-history and expertise questions personally. Do not publish
   private report contents, secrets or personal information as evidence.
4. Save the assessment, record its project URL/ID here in a follow-up, and add the
   service-provided badge only after that ID exists. An in-progress badge must
   remain labelled in progress; do not substitute a generic passing graphic.
5. Review the assessment when releases, security practices or ownership change.
   Scorecard discovers the assessment through the service's API; a README badge
   image on its own does not resolve the CII-Best-Practices finding.
