# Changelog

All notable changes to this package. Versions follow [Semantic Versioning](https://semver.org/):
while the version is `0.x`, a minor release (`0.2.0`) may change the API and a patch release
(`0.1.2`) does not.

## [Unreleased]

## [0.1.5] — 2026-10-14

- getEvents / getEventsById: catch up on webhook events after downtime
- postWebhooksByIdReplay: re-send what an endpoint missed (failed only by default)
- Delivery logs: paged deliveries with the request and response, and an attempt detail method

## [0.1.4] — 2026-10-11

- Webhooks: methods for the /v1/webhooks endpoints — list, create, read, update, enable, disable, rotate the secret, send a test event, delete, read deliveries and redeliver.
- verifyWebhook(rawBody, signatureHeader, secret) checks a delivery's fxapis-signature header and returns the event; it throws WebhookVerificationError when the signature is missing, malformed, too old or does not match. Runs on Web Crypto: Node 18+, Deno, Bun, edge runtimes and browsers.

## [0.1.3] — 2026-10-08

- The changes of 0.1.2, which never reached npm: GATEWAY_ERROR for a proxy's non-JSON error page, FxapisError.retryAfter, and retryable for every documented transient code.
- The release workflow publishes the tested build as-is.

## [0.1.2] — 2026-10-08

**Not published to npm** — the release workflow failed before publishing. These changes shipped in 0.1.3.

- A proxy's non-JSON error page (a 502 or 504) is now an FxapisError with code GATEWAY_ERROR, retryable with the same idempotencyKey — no longer a SyntaxError.
- FxapisError.retryAfter: the seconds from Retry-After, set on RATE_LIMITED.
- retryable is true for every code the API documents as transient, including INTERNAL_ERROR, ACCOUNT_LEASED_ELSEWHERE, SCHEDULER_FAILED and MT5_UNAVAILABLE.
- Method docs follow the API: a placed pending order is working; reconcile settles opening orders.

## [0.1.1] — 2026-10-08

- First release on npm: `npm install fxapis`. Same client as 0.1.0.

## [0.1.0] — 2026-10-07

- First release, installable from this repository. One typed method per endpoint, generated from the OpenAPI spec; zero runtime dependencies; ESM; typed errors carrying the API's stable `code`; `newIdempotencyKey()`.
