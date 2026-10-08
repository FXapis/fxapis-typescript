# Releasing

Every release goes out through this repository's [release workflow](.github/workflows/release.yml),
never from a laptop: it builds, tests and publishes to [npm](https://www.npmjs.com/package/fxapis) with
Trusted Publishing, so no publish token exists anywhere to leak.

## The routine

1. **Prepare.** The client code is maintained in the fxapis monorepo and copied here; maintainers
   run its `scripts/release-sdk.sh`, which syncs the code, bumps the version in `package.json`, adds the
   `CHANGELOG.md` entry, runs the checks below, and — once CI on `main` is green — creates the
   GitHub release `vX.Y.Z`.
2. **The release workflow builds it**: the tag must equal the package version, then type checks,
   tests and the build must pass.
3. **The workflow stages the version on npm** (Trusted Publishing, with provenance) — it is not live yet.
4. **A maintainer approves it** with their own 2FA: on npmjs.com, or `npm stage list fxapis` then `npm stage approve <stage-id>`. Only then is it installable.

By hand, without the script: bump the version in `package.json`, add a `CHANGELOG.md` section under
`## [Unreleased]`, push to `main`, wait for CI, then
`gh release create vX.Y.Z --title vX.Y.Z --notes "…"`.

## Versioning

- **Patch** (`0.1.1 → 0.1.2`): fixes, docs, new optional fields or methods — nothing that breaks code
  written against the previous version.
- **Minor** (`0.1.x → 0.2.0`): anything that can break existing code while the version is `0.x` —
  a renamed method, a changed type, a raised minimum runtime.
- A version is never re-released: if one is wrong, release the next one.

## What keeps a release honest

- **One approval per release**, by a person, with 2FA — see the steps above.
- **Only release tags can publish.** The `npm` environment accepts deployments from `v*` tags only.
- **Release tags are permanent.** A ruleset blocks moving or deleting `v*` tags, so `vX.Y.Z` always
  means the same code.
- **The tag must match the package version**, or the workflow stops before building.
