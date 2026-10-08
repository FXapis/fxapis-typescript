# Changelog

All notable changes to this package. Versions follow [Semantic Versioning](https://semver.org/):
while the version is `0.x`, a minor release (`0.2.0`) may change the API and a patch release
(`0.1.2`) does not.

## [Unreleased]

## [0.1.2] — 2026-10-08

- A proxy's non-JSON error page (a 502 or 504) is now an FxapisError with code GATEWAY_ERROR, retryable with the same idempotencyKey — no longer a SyntaxError.
- FxapisError.retryAfter: the seconds from Retry-After, set on RATE_LIMITED.
- retryable is true for every code the API documents as transient, including INTERNAL_ERROR, ACCOUNT_LEASED_ELSEWHERE, SCHEDULER_FAILED and MT5_UNAVAILABLE.
- Method docs follow the API: a placed pending order is working; reconcile settles opening orders.

## [0.1.1] — 2026-10-08

- First release on npm: `npm install fxapis`. Same client as 0.1.0.

## [0.1.0] — 2026-10-07

- First release, installable from this repository. One typed method per endpoint, generated from the OpenAPI spec; zero runtime dependencies; ESM; typed errors carrying the API's stable `code`; `newIdempotencyKey()`.
