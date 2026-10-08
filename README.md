<div align="center">

<img src="https://fxapis.com/logo.png" alt="" width="72" height="72">

# fxapis

**The official TypeScript / Node.js client for fxapis — the hosted MetaTrader 5 REST API**

[Website](https://fxapis.com) · [Docs](https://docs.fxapis.com) · [API Reference](https://docs.fxapis.com/api-reference) · [Status](https://status.fxapis.com) · [Support](mailto:support@fxapis.com)

[![License: MIT](https://img.shields.io/badge/license-MIT-22D3D6?style=flat-square)](LICENSE)
[![ci](https://img.shields.io/github/actions/workflow/status/FXapis/fxapis-typescript/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/FXapis/fxapis-typescript/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/fxapis?style=flat-square&color=22D3D6)](https://www.npmjs.com/package/fxapis)
[![release](https://img.shields.io/github/v/release/FXapis/fxapis-typescript?style=flat-square&color=22D3D6)](https://github.com/FXapis/fxapis-typescript/releases)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![fxapis status](https://status.fxapis.com/badge.svg)](https://status.fxapis.com)

</div>

---

Connect an MT5 account once, then place market and pending orders, close and modify positions, read positions and deal history, and send one trade to many accounts at once — over plain HTTPS.

You run **no MetaTrader terminal, no Windows VPS and no EA**. fxapis runs the MT5 terminals in its cloud (EU, Amsterdam) and puts an API in front of them. Use it for **copy trading** and trade copiers, **click-to-trade** signal apps, trading bots, and back-office tools that manage many MT5 accounts.

- **Zero dependencies** — uses the built-in `fetch` (Node.js 18+, Deno, Bun, edge runtimes)
- **Generated from the [OpenAPI spec](https://docs.fxapis.com/api-reference)**: one method per endpoint, nothing missing, nothing hand-drifted
- **Typed errors** with a stable `code` and an honest `retryable`
- **ESM**, with full TypeScript declarations

MT5 only (MT4 is not supported). Call it from your **backend** — never ship an API key to a browser or mobile app.

## Table of contents

- [Installation](#installation)
- [Quickstart](#quickstart)
- [Orders, idempotency and the three failures](#orders-idempotency-and-the-three-failures)
- [Methods](#methods)
- [Pagination](#pagination)
- [Copy trading in one call](#copy-trading-in-one-call)
- [Error handling reference](#error-handling-reference)
- [Good to know](#good-to-know)
- [Related fxapis repositories](#related-fxapis-repositories)
- [Contributing](#contributing)
- [Support](#support)
- [License](#license)

## Installation

```bash
npm install fxapis
```

Create an API key in the console at [fxapis.com](https://fxapis.com).

> [!WARNING]
> **Test keys reach real brokers.** An `fx_test_` key is a label for your configuration, not a sandbox. Build and test with a **broker demo account**.

## Quickstart

```ts
import { Fxapis, FxapisError, newIdempotencyKey } from "fxapis";

const fx = new Fxapis(process.env.FXAPIS_API_KEY!);

// 1. Connect an MT5 account (once). The trading password, not the investor password.
const account = await fx.postAccounts({
  login: "26177561",
  server: "VantageMarkets-Demo",
  password: process.env.MT5_PASSWORD,
  mode: "warm_on_demand", // online when needed, offline after 15 idle minutes
  label: "demo — strategy A",
});

// 2. Bring it online (returns 202 at once) and poll until it is ready — about 10 s.
await fx.postAccountsByIdWarm(account.id);
for (;;) {
  const status = await fx.getAccountsByIdStatus(account.id);
  if (status.state === "ready") break;
  if (["invalid_credentials", "needs_2fa", "needs_certificate", "trading_disabled"].includes(status.state)) {
    throw new Error(`account needs attention: ${status.state} — ${status.detail}`);
  }
  await new Promise((r) => setTimeout(r, 2000));
}

// 3. Trade. Volumes and prices are strings: "0.01", not 0.01.
const order = await fx.postAccountsByIdOrdersMarket(
  account.id,
  { symbol: "EURUSD", side: "buy", volume: "0.01", stopLoss: "1.12900", takeProfit: "1.14200" },
  { idempotencyKey: newIdempotencyKey() },
);
console.log(order.state, order.filledPrice);

// 4. Positions, then close one — always with an idempotency key.
const positions = await fx.getAccountsByIdPositions(account.id);
for (const p of positions) {
  await fx.postAccountsByIdPositionsByPositionIdClose(account.id, p.brokerPositionId, {}, {
    idempotencyKey: `close_${p.brokerPositionId}`,
  });
}
```

Responses are the `data` of the API's `{ "data": … }` envelope. Every method takes a final `options` argument: `{ idempotencyKey?, query?, signal? }`.

## Orders, idempotency and the three failures

Send an `idempotencyKey` with every market order, pending order, close and multi-account order. The API honours a key for 24 hours: resending the same key with the same body returns the first answer instead of placing a second order. Derive it from something stable — e.g. `` `signal_${signalId}:member_${memberId}` `` — so a double click or a restarted worker cannot trade twice.

```ts
const key = `signal_${signal.id}:member_${member.id}`;
try {
  await fx.postAccountsByIdOrdersMarket(member.accountId, body, { idempotencyKey: key });
} catch (err) {
  if (!(err instanceof FxapisError)) throw err;
  switch (err.code) {
    case "ORDER_UNRESOLVED":
      // We do not know yet whether it reached the broker. NEVER resend.
      // Poll GET /v1/orders/{id} (fx.getOrdersById) until it leaves "unknown".
      break;
    case "SEND_FAILED":
    case "ACCOUNT_NOT_READY":
    case "NO_RUNTIME":
      // Nothing was sent. Retry with the SAME key.
      break;
    case "ORDER_REJECTED":
      // The broker refused; nothing opened. If err.retryable, try again with a NEW key.
      break;
  }
}
```

`FxapisError` carries `status`, `code` (stable — match on it), `message` (for humans), `requestId` (quote it to support), `details`, and `retryable`, which is `false` for `ORDER_UNRESOLVED` whatever else is true. The client never retries on its own: that decision stays with you.

## Methods

Method names are generated from the path: `POST /v1/accounts/{id}/orders/market` → `postAccountsByIdOrdersMarket(id, body, options)`.

| What | Method | Endpoint |
|---|---|---|
| Workspace and plan | `getWorkspace()` | `GET /v1/workspace` |
| Connect an MT5 account | `postAccounts(body)` | `POST /v1/accounts` |
| List / get accounts | `getAccounts()`, `getAccountsById(id)` | `GET /v1/accounts[/{id}]` |
| Poll lifecycle state | `getAccountsByIdStatus(id)` | `GET /v1/accounts/{id}/status` |
| Bring online / offline | `postAccountsByIdWarm(id)`, `postAccountsByIdCool(id)` | `POST …/warm`, `…/cool` |
| Prepare up to 200 accounts | `postAccountsPrepare({ accountIds })` | `POST /v1/accounts/prepare` |
| Restart, disconnect, set mode | `postAccountsByIdRestart`, `postAccountsByIdDisconnect`, `postAccountsByIdMode(id, { mode })` | `POST …/restart`, `…/disconnect`, `…/mode` |
| Delete an account and its history | `deleteAccountsById(id)`, or `deleteAccountsById(id, { query: { force: "true" } })` with open positions | `DELETE /v1/accounts/{id}` |
| Market order | `postAccountsByIdOrdersMarket(id, body, { idempotencyKey })` | `POST …/orders/market` |
| Instruments, and an account's broker symbols | `getInstruments()`, `getAccountsByIdSymbols(id, { query: { search } })`, `getAccountsByIdInstruments(id)` | `GET /v1/instruments`, `GET …/symbols`, `GET …/instruments` |
| Limit / stop / stop-limit | `postAccountsByIdOrdersPending(id, body, { idempotencyKey })` | `POST …/orders/pending` |
| Modify / cancel pending | `postOrdersByIdModify(id, body)`, `postOrdersByIdCancel(id)` | `POST /v1/orders/{id}/modify`, `…/cancel` |
| Positions | `getAccountsByIdPositions(id)` | `GET …/positions` |
| Close / modify a position | `postAccountsByIdPositionsByPositionIdClose`, `…Modify` | `POST …/positions/{positionId}/close`, `…/modify` |
| Margin / profit | `postAccountsByIdCalculate(id, body)` | `POST …/calculate` |
| Orders (paginated) | `getOrders({ query: { accountId, state, symbol, since, until, limit, cursor } })` | `GET /v1/orders` |
| One order, its deals | `getOrdersById(id)`, `getOrdersByIdDeals(id)` | `GET /v1/orders/{id}[/deals]` |
| Account deal history | `getAccountsByIdDeals(id, { query: { since, limit, cursor } })` | `GET …/deals` |
| Confirm unknown results now | `postAccountsByIdReconcile(id)` | `POST …/reconcile` |
| Multi-account order | `postExecutionwaves(body, { idempotencyKey })` | `POST /v1/execution-waves` |
| Follow / list / cancel it | `getExecutionwavesById(id)`, `getExecutionwaves()`, `postExecutionwavesByIdCancel(id)` | `/v1/execution-waves…` |
| Usage this month | `getBillingUsage()`, `getBillingUsageDaily()` | `GET /v1/billing/usage[/daily]` |

API keys, members and billing are covered too — every endpoint in the [API reference](https://docs.fxapis.com/api-reference) has a method.

### Pagination

`GET /v1/orders` and `GET /v1/accounts/{id}/deals` return 50 rows by default (up to 200), newest first, cursor-paginated. The returned array carries the page as a (non-enumerable) `page` property:

```ts
let cursor: string | undefined;
do {
  const orders = await fx.getOrders({ query: { accountId, limit: 200, cursor } });
  for (const order of orders) console.log(order.id, order.state);
  cursor = orders.page?.hasMore ? orders.page.nextCursor : undefined;
} while (cursor);
```

## Copy trading in one call

```ts
const wave = await fx.postExecutionwaves(
  {
    accountIds: followerIds,                 // up to 500
    symbol: "EURUSD", side: "buy", volume: "0.10",
    weights: { [bigAccountId]: "0.50" },     // optional per-account volume
    barrierPolicy: "release-ready",          // or "all-or-nothing", "wait"
    clientWaveId: `master-${dealId}`,
  },
  { idempotencyKey: `master-deal-${dealId}` },
);
// Poll fx.getExecutionwavesById(wave.id) until state is "settled" (or "cancelled" / "abandoned").
```

There are no event webhooks yet — poll. See [`node/copy-trader.ts`](https://github.com/FXapis/fxapis-examples/tree/main/node) in the examples repo.

## Error handling reference

| `code` | What it means | What to do |
|---|---|---|
| `ORDER_UNRESOLVED` | We don't yet know if the order reached the broker | **Never resend.** Poll `getOrdersById` until it leaves `unknown` |
| `SEND_FAILED` | Nothing reached the broker | Retry with the **same** `idempotencyKey` |
| `ACCOUNT_NOT_READY` / `NO_RUNTIME` | The account isn't online | Bring it online, wait for `ready`, retry with the same key |
| `ORDER_REJECTED` | The broker refused it; nothing opened | Show `message` to the user; retry with a **new** key only if `retryable` |
| `MISSING_SCOPE` | The API key doesn't allow this call | Ask for a key with the right scope — don't work around it |
| `RATE_LIMITED` | Too many requests | Wait `retryAfterSeconds`, then retry once |

## Good to know

- On-demand accounts (`warm_on_demand`) come online for an order or a prepare and go offline after 15 idle minutes; stops and targets live at the broker and keep working while offline.
- Positions are a snapshot with `observedAt`. Call `postAccountsByIdReconcile` for a fresh read while the account is online.
- Keys can be scoped, including read-only and reduce-only (close but never open).
- Use `new Fxapis(key, baseUrl)` to point at another base URL.

## Related fxapis repositories

| Repository | What it is |
|---|---|
| [`fxapis-examples`](https://github.com/FXapis/fxapis-examples) | Runnable examples using this SDK (Node/TypeScript, Python, curl) |
| [`fxapis-python`](https://github.com/FXapis/fxapis-python) | The official Python SDK, same conventions |
| [`fxapis-nextjs-starter`](https://github.com/FXapis/fxapis-nextjs-starter) | A small working Next.js app built on this SDK |
| [`fxapis-mcp-examples`](https://github.com/FXapis/fxapis-mcp-examples) | Connect AI agents (Claude, Cursor, VS Code) over MCP |
| [`fxapis-integrations`](https://github.com/FXapis/fxapis-integrations) | Postman collection, TradingView payloads, automation templates |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — in short, `src/index.ts` is generated from the OpenAPI
spec; the hand-written parts (the `Fxapis` class, `FxapisError`, idempotency helpers) are where a
pull request helps most. What changed in each version is in [CHANGELOG.md](CHANGELOG.md), and how a
version is released in [RELEASING.md](RELEASING.md).

## Support

- **Docs:** [docs.fxapis.com](https://docs.fxapis.com)
- **Status:** [status.fxapis.com](https://status.fxapis.com)
- **Bugs:** [open an issue](https://github.com/FXapis/fxapis-typescript/issues)
- **Everything else:** [support@fxapis.com](mailto:support@fxapis.com)

## License

[MIT](LICENSE) © 2026 El Wizard
