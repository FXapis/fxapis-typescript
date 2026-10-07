# Contributing

## This client is generated, mostly

`src/index.ts` is generated from fxapis's OpenAPI spec in the main repository: one typed method
per endpoint, named from its path and verb (`GET /v1/accounts/{id}/status` →
`getAccountsByIdStatus`). That generation step lives in the private monorepo, not here, because
it also generates the Python SDK and the published OpenAPI document from the same source of
truth — the three can never drift apart if only one place produces all of them.

**What that means for a pull request here:**

- A new or changed **endpoint method** (name, parameters, return type) needs to come from a
  change to the API first, then a regeneration — open an issue or email
  [support@fxapis.com](mailto:support@fxapis.com) rather than hand-editing a generated method; a
  hand edit would be overwritten by the next release.
- The **hand-written parts** are fair game for a pull request: the `Fxapis` class's constructor,
  auth header, retry/idempotency helpers, `FxapisError`, and `newIdempotencyKey`. These are at
  the top of `src/index.ts`, clearly separated from the generated methods below them.
- **Tests, docs, examples and build tooling** are always welcome.

## Before you open a pull request

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build        # tsc -p tsconfig.build.json
```

These are exactly what the `ci` workflow runs, on Node 20, 22 and 24.

## Reporting a bug

Open an [issue](https://github.com/FXapis/fxapis-typescript/issues) with the method called, the
error (`FxapisError`'s `code` and `message`), and the response `requestId` if you have one. For
account or billing issues rather than a client bug, email
[support@fxapis.com](mailto:support@fxapis.com).
