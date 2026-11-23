# Dependency advisory status

Reviewed on 2026-11-18 against the public advisory records and package registries.
This records remaining work; it does not suppress any security alerts.

| Advisory | Dependency and exposure | Status |
| --- | --- | --- |
| [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) | `minimatch` through the client's development-only ESLint dependency | ESLint 10.15 uses patched minimatch 11; both direct and config-array paths resolve to 11.0.9. |
| [RUSTSEC-2026-0459](https://rustsec.org/advisories/RUSTSEC-2026-0459.html) | SQLite bundled by `rusqlite`, used for Strava accounts | rusqlite 0.41 resolves to libsqlite3-sys 0.39.1, bundling patched SQLite 3.54.1. Its minimum Rust version raises the workspace requirement to 1.89. |
| [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) | `picomatch` in the landing page's Astro/Vite build dependency tree | **Open:** the latest published picomatch is 4.0.7, which is affected. No published patched release is available. |

## Remaining picomatch advisory

The vulnerability requires attacker-controlled extglob patterns. The landing
page is compiled from repository-controlled source and configuration; its
production container serves static files with Caddy and runs no Node.js server.
Do not expose the build tooling as a service accepting arbitrary glob patterns.
Build pull requests with read-only credentials and without production secrets,
as with other untrusted contributions. This limits exposure; it is not a patch.

Keep the alert open. When upstream publishes a patched version, update every
picomatch path in `landing/package-lock.json`, run `npm ci` and `npm run build`
in `landing/`, and rerun the dependency audit. Do not force an unrelated major
version, use an unreviewed fork, or dismiss the alert merely to improve Scorecard.

## Checking locally

- `npm audit --prefix client` checks the client tooling tree.
- `npm audit --prefix landing` checks the landing tooling tree.
- Check `server/Cargo.lock` against the [RustSec advisory database](https://rustsec.org/)
  with `cargo audit` when installed; `cargo tree -i libsqlite3-sys` in `server/`
  shows the SQLite dependency path.
- `make check` validates the application after dependency changes.

Scorecard and Dependabot may continue to report the old default-branch lockfiles
until the fixes are merged and their scans refresh. The unpatched picomatch
finding should remain visible after that refresh.
