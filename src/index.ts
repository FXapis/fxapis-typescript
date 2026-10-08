// Generated from openapi.json by scripts/generate-sdk.ts. Do not edit.
//
// Regenerate with `pnpm sdk:generate` after changing a route. The spec is
// itself generated from the route schemas, so a rename travels from the
// handler to this file without anyone remembering to carry it.
//
// fxapis 0.1.0

export type RequestOptions = {
  /**
   * Sent as `Idempotency-Key`.
   *
   * Use one on anything that trades. Without it a request that times out
   * leaves you unable to retry safely: you cannot tell whether the order was
   * placed, and guessing wrong opens a second position.
   */
  idempotencyKey?: string;
  /** Query parameters, e.g. `{ accountId, state: "unknown", limit: 200, cursor }`. Undefined values are skipped. */
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
};

/** A fresh Idempotency-Key. Keep it until the order has an answer, and resend with the same one. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Codes the API documents as safe to send again, as they are, after a short wait. */
const RETRYABLE_CODES = new Set([
  "SEND_FAILED",
  "ACCOUNT_NOT_READY",
  "NO_RUNTIME",
  "RATE_LIMITED",
  "IDEMPOTENCY_IN_FLIGHT",
  "ACCOUNT_EXECUTING",
  "ACCOUNT_LEASED_ELSEWHERE",
  "SECRET_STORE_UNAVAILABLE",
  "SCHEDULER_FAILED",
  "RESTART_FAILED",
  "MT5_UNAVAILABLE",
  "SYMBOLS_UNAVAILABLE",
  "SESSIONS_NOT_SYNCED",
  "PROVIDER_ERROR",
  "TOO_SOON",
  "INTERNAL_ERROR",
  "GATEWAY_ERROR",
]);

export class FxapisError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: unknown;
  /** Seconds to wait before retrying, from the `Retry-After` header — set on `RATE_LIMITED`. */
  readonly retryAfter: number | undefined;

  constructor(
    status: number,
    body: { error?: { code?: string; message?: string; details?: unknown }; requestId?: string },
    retryAfter?: number
  ) {
    super(body.error?.message ?? `request failed with ${status}`);
    this.name = "FxapisError";
    this.status = status;
    this.code = body.error?.code ?? "UNKNOWN";
    this.requestId = body.requestId;
    this.details = body.error?.details;
    this.retryAfter = retryAfter;
  }

  /**
   * Whether sending the same request again is safe.
   *
   * False for `ORDER_UNRESOLVED`, and that is the important one: the order
   * may be live at the broker. Poll it instead of resending. On anything that
   * trades, retry with the same `idempotencyKey` — that is what makes it safe.
   * `ACCOUNT_NOT_READY` is retryable unless the account needs its owner
   * (`invalid_credentials`, `needs_2fa`, …): check its state before looping.
   */
  get retryable(): boolean {
    if (RETRYABLE_CODES.has(this.code)) return true;
    const detail = Array.isArray(this.details) ? (this.details[0] as { retryable?: boolean } | undefined) : undefined;
    return detail?.retryable === true;
  }
}

export class Fxapis {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string, baseUrl = "https://api.fxapis.com") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request(method: string, path: string, body: unknown, options: RequestOptions) {
    const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) search.set(name, String(value));
    }
    const query = search.toString() ? `?${search.toString()}` : "";

    const response = await fetch(`${this.baseUrl}${path}${query}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      // Not the API's own answer: a proxy or load balancer between here and
      // fxapis (a 502/504 page). The request may or may not have arrived, so
      // a trade must be retried with the same idempotencyKey, never a new one.
      parsed = {
        error: {
          code: response.ok ? "INVALID_RESPONSE" : "GATEWAY_ERROR",
          message: `HTTP ${response.status} without an fxapis response. Retry with the same idempotencyKey.`,
        },
      };
      if (response.ok) throw new FxapisError(response.status, parsed);
    }
    if (!response.ok) {
      const wait = Number(response.headers.get("retry-after"));
      throw new FxapisError(response.status, parsed, Number.isFinite(wait) && wait > 0 ? wait : undefined);
    }
    // A paginated list is still returned as its array, with the page attached
    // out of the way (not enumerable, so it never shows up in JSON or a
    // spread): `const orders = await fx.getOrders(); orders.page?.nextCursor`.
    if (Array.isArray(parsed.data) && parsed.page) {
      Object.defineProperty(parsed.data, "page", { value: parsed.page, enumerable: false });
    }
    return parsed.data ?? parsed;
  }

  /** Liveness — Says the fxapis API process is up, for liveness probes and uptime monitors. Checks nothing else and never returns anything but 200; use /readyz to know whether it can serve traffic. */
  async getHealthz(options: RequestOptions = {}) {
    return this.request("GET", `/healthz`, undefined, options);
  }

  /** Readiness — Says the API can serve traffic right now, including storing and using account credentials. Returns 503 when it cannot. */
  async getReadyz(options: RequestOptions = {}) {
    return this.request("GET", `/readyz`, undefined, options);
  }

  /** List connected accounts — Every account in this workspace, newest first. */
  async getAccounts(options: RequestOptions = {}) {
    return this.request("GET", `/v1/accounts`, undefined, options);
  }

  /** Connect an MT5 account — Stores the account and encrypts its password. It does **not** log in: the account lands in `created`, and connects when you bring it online or when the first order arrives on a `warm_on_demand` account. */
  async postAccounts(body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts`, body, options);
  }

  /** Fetch one account — One connected account: its login, server, label, mode, current state and when it last changed. The password is never included. Another workspace's account is 404. */
  async getAccountsById(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/accounts/${encodeURIComponent(id)}`, undefined, options);
  }

  /**
   * Delete an account and its history — Removes the account for good: its terminal is stopped, its password erased, and the record deleted with its orders, deals and positions. **This cannot be undone.** To stop trading on an account but keep its history readable, disconnect it instead.
   *
   * Query (`options.query`): `force`.
   */
  async deleteAccountsById(id: string, options: RequestOptions = {}) {
    return this.request("DELETE", `/v1/accounts/${encodeURIComponent(id)}`, undefined, options);
  }

  /** Poll lifecycle state — The endpoint to poll after bringing an account online. Cheap enough to call every second or two; `state` reaches `ready` when the account is logged in and ready to trade. */
  async getAccountsByIdStatus(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/accounts/${encodeURIComponent(id)}/status`, undefined, options);
  }

  /** Replace an account's password — Gives a connected account a new trading password — after the member changed it at the broker, or when the account is in `invalid_credentials` because the one it had was wrong. Send `server` as well to correct the server name. */
  async postAccountsByIdPassword(id: string, body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/password`, body, options);
  }

  /** Move an account to another server — For a login refused because it was added under the wrong server name: keeps the stored password and tries it on `server` instead, so the password is not sent again. The broker's likely servers are in the account's `problem.otherServers`. With `connect: true` (the default) the account is brought online straight away, so the answer comes back in seconds — watch `state`, or the account's events. */
  async postAccountsByIdServer(id: string, body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/server`, body, options);
  }

  /**
   * What happened to an account — The account's history in words, newest first: added, logging in, refused by the broker, online, moved to another server, taken offline. The same record the console shows as the account's activity.
   *
   * Query (`options.query`): `limit`.
   */
  async getAccountsByIdEvents(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/accounts/${encodeURIComponent(id)}/events`, undefined, options);
  }

  /** Bring an account online — Starts connecting the account and returns **202** immediately — the broker login is still in progress. Poll `pollUrl` until `state` is `ready`. */
  async postAccountsByIdWarm(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/warm`, undefined, options);
  }

  /** Bring several accounts online at once — Brings every account listed online and returns **202** with a result for each — the broker logins are still in progress. Built for a signal: call it when the signal goes out, and by the time people act on it their accounts are online, so the order goes straight through instead of waiting for a login. */
  async postAccountsPrepare(body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/prepare`, body, options);
  }

  /** Take an account offline — Takes the account offline and keeps it, with its stored password, in `standby` — ready to be brought online again. Open positions are untouched: a stop loss or take profit is held by the broker and keeps working while the account is offline. */
  async postAccountsByIdCool(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/cool`, undefined, options);
  }

  /** Restart the connection — For an account that is online but misbehaving — `degraded`, stale quotes, a stuck sync. Returns **202**; poll `pollUrl` until `state` is `ready`. Refused with 409 while an order is in flight, for the same reason as taking it offline. */
  async postAccountsByIdRestart(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/restart`, undefined, options);
  }

  /** Disconnect and erase the credential — Takes the account offline and **deletes the stored password**. The account record stays, with its history, in `offline`. Reconnecting means sending the password again. */
  async postAccountsByIdDisconnect(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/disconnect`, undefined, options);
  }

  /** Change how eagerly the account stays connected — `always_on`: stays connected. `warm_on_demand`: connects on demand (the first order, or a prepare) and goes offline by itself when idle. `cold`: connects only when you ask. */
  async postAccountsByIdMode(id: string, body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/mode`, body, options);
  }

  /**
   * List the instruments a signal can name — The markets fxapis names once, whatever each broker calls them: currency pairs, metals, indices, energies and crypto. A signal that names one of these as `instrument` is traded on every account under that account's own broker symbol. Needs no account and no broker.
   *
   * Query (`options.query`): `category`.
   */
  async getInstruments(options: RequestOptions = {}) {
    return this.request("GET", `/v1/instruments`, undefined, options);
  }

  /**
   * List the symbols an account's broker offers — Every symbol the account's broker offers it, with its contract specification, as read from the broker when the account was last online — so it answers while the account is offline. Refreshed each time the account comes online and the list is a day old. `syncedAt` says when.
   *
   * Query (`options.query`): `search`, `tradable`, `limit`, `cursor`.
   */
  async getAccountsByIdSymbols(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/accounts/${encodeURIComponent(id)}/symbols`, undefined, options);
  }

  /** See how each instrument maps onto an account's broker — For every instrument, the symbol an order naming it will trade on this account — or why it cannot: the broker has several plausible symbols (`ambiguous`, with `candidates`), or does not offer it (`missing`). Useful when a member connects, to tell them which signals their account can follow. */
  async getAccountsByIdInstruments(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/accounts/${encodeURIComponent(id)}/instruments`, undefined, options);
  }

  /**
   * Market hours for a symbol or instrument, from the account's broker — When the account's broker lets orders be placed in a symbol — or in this account's symbol for an instrument — as the broker configured it (MetaTrader's `SymbolInfoSessionTrade`), with whether it is open now and when that next changes.
   *
   * Query (`options.query`): `symbol`, `instrument`.
   */
  async getAccountsByIdSessions(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/accounts/${encodeURIComponent(id)}/sessions`, undefined, options);
  }

  /** Read an account's symbols from its broker now — Reads the broker's symbol list again and remaps the instruments, for when the broker has added symbols. Needs the account online (`ready`); returns 409 `ACCOUNT_NOT_READY` otherwise. It happens on its own once a day while the account is online, so most integrations never call this. */
  async postAccountsByIdSymbolsSync(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/symbols/sync`, undefined, options);
  }

  /**
   * Search broker servers — MT5 servers matching what someone typed — a broker's name (`vantage`), the start of a server name (`JustMarkets-De`), with or without dashes and spaces. Built for a typeahead in your connect form: call it as the person types (debounced, from 2 characters) and let them pick.
   *
   * Query (`options.query`): `q`, `limit`.
   */
  async getBrokersServers(options: RequestOptions = {}) {
    return this.request("GET", `/v1/brokers/servers`, undefined, options);
  }

  /**
   * Place a market order — Sends a market order and waits for the broker's answer.
   *
   * Send `options.idempotencyKey` (e.g. `newIdempotencyKey()`) and reuse it on a retry: the same key returns the first answer instead of placing a second order.
   */
  async postAccountsByIdOrdersMarket(id: string, body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/orders/market`, body, options);
  }

  /**
   * Close a position — Closes a position in whole, or partly if you send a `volume`.
   *
   * Send `options.idempotencyKey` (e.g. `newIdempotencyKey()`) and reuse it on a retry: the same key returns the first answer instead of placing a second order.
   */
  async postAccountsByIdPositionsByPositionIdClose(id: string, positionId: string, body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/positions/${encodeURIComponent(positionId)}/close`, body, options);
  }

  /** Move a position's stop loss or take profit — **Send `null` to remove a level.** Omitting the field leaves it unchanged — an omitted field silently clearing a stop is how protection disappears without anybody choosing it. */
  async postAccountsByIdPositionsByPositionIdModify(id: string, positionId: string, body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/positions/${encodeURIComponent(positionId)}/modify`, body, options);
  }

  /**
   * Place a limit, stop or stop-limit order — A success here means **placed and waiting**, not filled — the broker answers `10008 PLACED` and the order is `working` until it triggers.
   *
   * Send `options.idempotencyKey` (e.g. `newIdempotencyKey()`) and reuse it on a retry: the same key returns the first answer instead of placing a second order.
   */
  async postAccountsByIdOrdersPending(id: string, body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/orders/pending`, body, options);
  }

  /** Move a pending order's price or levels — Keeps the order's ticket. Cancelling and re-placing loses its place in the broker's queue and leaves a window where the order does not exist at all — on a fast market that window is where the move happens. */
  async postOrdersByIdModify(id: string, body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/orders/${encodeURIComponent(id)}/modify`, body, options);
  }

  /** Cancel a pending order — Removes a pending order that has not triggered. If it already has, the broker refuses with `10035` — at that point there is a position, not an order, and what you want is a close. */
  async postOrdersByIdCancel(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/orders/${encodeURIComponent(id)}/cancel`, undefined, options);
  }

  /** Margin required, or profit at a price — Opens nothing and is safe to call freely. This is how you find out an order will be refused for margin *before* sending it, rather than collecting a `10019` from the broker. */
  async postAccountsByIdCalculate(id: string, body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/calculate`, body, options);
  }

  /**
   * List orders — Every order this workspace has placed, newest first, across all accounts unless `accountId` narrows it. Filter by `state` to find what needs attention — `state=unknown` is the set whose result we are still confirming with the broker.
   *
   * Query (`options.query`): `accountId`, `state`, `symbol`, `since`, `until`, `limit`, `cursor`.
   */
  async getOrders(options: RequestOptions = {}) {
    return this.request("GET", `/v1/orders`, undefined, options);
  }

  /** Fetch one order — The authoritative record of one order: what was asked for, what the broker returned, and its own return code unmodified. Poll this after an `ORDER_UNRESOLVED` response — an opening order moves out of `unknown` as soon as we have confirmed the result with the broker; a close, stop change or cancel stays `unknown`, with a `stateDetail` saying what to check at the broker. */
  async getOrdersById(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/orders/${encodeURIComponent(id)}`, undefined, options);
  }

  /** Deals produced by one order — One order can produce several deals — a partial fill leaves more than one. These are the broker's own records of money changing hands, which is what a statement is reconciled against. */
  async getOrdersByIdDeals(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/orders/${encodeURIComponent(id)}/deals`, undefined, options);
  }

  /**
   * An account's full deal history — Everything the broker recorded against this account, **including deals no order of yours caused** — a stop loss firing, a swap charge, a deposit, or somebody trading the same login from the MetaTrader desktop.
   *
   * Query (`options.query`): `symbol`, `since`, `until`, `limit`, `cursor`.
   */
  async getAccountsByIdDeals(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/accounts/${encodeURIComponent(id)}/deals`, undefined, options);
  }

  /** Confirm pending results with the broker now — Confirms the result of every opening order on this account still in `unknown`, and brings its deals and positions up to date with the broker. A close, stop change or cancel in `unknown` is not settled from deal history — its `stateDetail` says to check the position or order at the broker. */
  async postAccountsByIdReconcile(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/accounts/${encodeURIComponent(id)}/reconcile`, undefined, options);
  }

  /**
   * Positions on an account — What we last saw, with `observedAt` saying when. The broker is authoritative and this is a snapshot, not a ledger — `observedAt` is here so you can tell a current view from a stale one rather than having to assume.
   *
   * Query (`options.query`): `includeClosed`.
   */
  async getAccountsByIdPositions(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/accounts/${encodeURIComponent(id)}/positions`, undefined, options);
  }

  /**
   * Place one trade on many accounts — A multi-account order: one trade placed on many accounts at once. Every account is brought online first, then the orders are sent together — at `executeAt`, or as soon as every account is online.
   *
   * Send `options.idempotencyKey` (e.g. `newIdempotencyKey()`) and reuse it on a retry: the same key returns the first answer instead of placing a second order.
   */
  async postExecutionwaves(body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/execution-waves`, body, options);
  }

  /** List multi-account orders — Multi-account orders in this workspace, newest first, with each one's state, symbol, side, number of accounts and summary of results. */
  async getExecutionwaves(options: RequestOptions = {}) {
    return this.request("GET", `/v1/execution-waves`, undefined, options);
  }

  /** Follow a multi-account order — Poll this after creating a multi-account order. `state` moves `planned → preparing → armed → releasing → settled`: accepted, bringing accounts online, waiting for `executeAt`, sending, and every account has a result. `cancelled` and `abandoned` mean nothing was sent. */
  async getExecutionwavesById(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/execution-waves/${encodeURIComponent(id)}`, undefined, options);
  }

  /** Cancel a multi-account order before it is sent — Only while nothing has been sent. Once orders are going out there is no cancelling them — `cancelled` would claim nothing was sent, and that is exactly the promise we can no longer make. */
  async postExecutionwavesByIdCancel(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/execution-waves/${encodeURIComponent(id)}/cancel`, undefined, options);
  }

  /** The available plans — The plans on offer now: what each includes and what it costs. Prices are in minor units — `9900` is $99.00, never a float. */
  async getPlans(options: RequestOptions = {}) {
    return this.request("GET", `/v1/plans`, undefined, options);
  }

  /** This month's usage and what it would cost — Counted as it happens rather than derived at the end of the month, so this is the same number the invoice will use. */
  async getBillingUsage(options: RequestOptions = {}) {
    return this.request("GET", `/v1/billing/usage`, undefined, options);
  }

  /** Usage broken down by day — For a chart, or for checking an invoice line against the day it came from. */
  async getBillingUsageDaily(options: RequestOptions = {}) {
    return this.request("GET", `/v1/billing/usage/daily`, undefined, options);
  }

  /** What is paying for the plan — The workspace's subscription, if it has one: plan, card or crypto, status, the current paid period and whether it ends at period end. Null when nothing is being paid for. */
  async getBillingSubscription(options: RequestOptions = {}) {
    return this.request("GET", `/v1/billing/subscription`, undefined, options);
  }

  /** Invoices, newest first — Every invoice for this workspace, newest first, with its number, amount, status, provider and any refunds. Amounts are in minor units. */
  async getBillingInvoices(options: RequestOptions = {}) {
    return this.request("GET", `/v1/billing/invoices`, undefined, options);
  }

  /** Coins accepted for crypto payment — Each with the network it must be sent on. Sending on another network loses the payment. */
  async getBillingCryptoCoins(options: RequestOptions = {}) {
    return this.request("GET", `/v1/billing/crypto/coins`, undefined, options);
  }

  /** One invoice — One invoice by id, with its lines, payment status and refunds. Another workspace's invoice is 404. */
  async getBillingInvoicesById(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/billing/invoices/${encodeURIComponent(id)}`, undefined, options);
  }

  /** List this workspace's keys — Newest first, revoked keys included — a revocation is history worth seeing. */
  async getApikeys(options: RequestOptions = {}) {
    return this.request("GET", `/v1/api-keys`, undefined, options);
  }

  /** Create a key — Returns the key in `key`, **once**. We cannot show a key again after creation, or recover it. A lost key is replaced, not recovered. */
  async postApikeys(body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/api-keys`, body, options);
  }

  /** Read one key — A key's name, scopes, environment label, hint and when it was last used — never the key itself, which is shown only once, when it is created. */
  async getApikeysById(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/api-keys/${encodeURIComponent(id)}`, undefined, options);
  }

  /** Rename or re-scope a key — New scopes replace the old ones and apply from the key's next request. The key itself does not change, so nothing using it needs redeploying. A revoked key cannot be changed. */
  async patchApikeysById(id: string, body: unknown, options: RequestOptions = {}) {
    return this.request("PATCH", `/v1/api-keys/${encodeURIComponent(id)}`, body, options);
  }

  /** Revoke a key — Refused from its very next request — there is no cache to wait for. Revoking an already-revoked key succeeds and changes nothing, so a retried revoke is safe. */
  async postApikeysByIdRevoke(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/api-keys/${encodeURIComponent(id)}/revoke`, undefined, options);
  }

  /** The workspace this credential belongs to — Its plan, and whether trading is switched off. Our staff switch trading off for a whole workspace only during an incident; this is where to see it. */
  async getWorkspace(options: RequestOptions = {}) {
    return this.request("GET", `/v1/workspace`, undefined, options);
  }

  /** List TradingView alert hooks — Newest first. Deleted hooks are not listed. The URLs are shown only as hints — the secret is not stored. */
  async getAlerthooks(options: RequestOptions = {}) {
    return this.request("GET", `/v1/alert-hooks`, undefined, options);
  }

  /** Create a TradingView alert hook — Returns a secret `url` to paste into a TradingView alert's **Webhook URL**. Every alert sent to it becomes an order on the hook's accounts: one account places an ordinary order, several place a multi-account order. */
  async postAlerthooks(body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/alert-hooks`, body, options);
  }

  /** Read one alert hook — One alert hook: its name, accounts, defaults, whether it is enabled and when it was last used. The secret URL is never returned again — rotate the hook for a new one. */
  async getAlerthooksById(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/alert-hooks/${encodeURIComponent(id)}`, undefined, options);
  }

  /** Change an alert hook's name, accounts or defaults — The URL does not change, so nothing needs editing in TradingView. `defaults` fields you send replace those fields; the rest stay as they are. `symbolMap`, when sent, replaces the whole map. */
  async patchAlerthooksById(id: string, body: unknown, options: RequestOptions = {}) {
    return this.request("PATCH", `/v1/alert-hooks/${encodeURIComponent(id)}`, body, options);
  }

  /** Delete an alert hook — Its URL stops working at once and cannot be brought back. Orders it placed stay in the history, with the alert that caused them in `clientOrderId`. */
  async deleteAlerthooksById(id: string, options: RequestOptions = {}) {
    return this.request("DELETE", `/v1/alert-hooks/${encodeURIComponent(id)}`, undefined, options);
  }

  /** Replace an alert hook's URL — Issues a new secret URL and retires the old one at once: alerts still pointing at it are refused from now on. Update every TradingView alert that uses it. The new `url` is returned **once**. */
  async postAlerthooksByIdRotate(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/alert-hooks/${encodeURIComponent(id)}/rotate`, undefined, options);
  }

  /** Enable an alert hook — Alerts are traded again from the next one. Safe to repeat. */
  async postAlerthooksByIdEnable(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/alert-hooks/${encodeURIComponent(id)}/enable`, undefined, options);
  }

  /** Disable an alert hook — Alerts are refused — answered 409 and recorded as `rejected` — until it is enabled again. The URL stays the same, so nothing changes in TradingView. Safe to repeat. */
  async postAlerthooksByIdDisable(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/alert-hooks/${encodeURIComponent(id)}/disable`, undefined, options);
  }

  /**
   * Alerts a hook received, and what became of each — Newest first, kept for 30 days. The first place to look when an alert did not trade: every alert that reached a hook is here — refused, ignored and duplicate ones included — with the reason in words.
   *
   * Query (`options.query`): `status`, `limit`, `cursor`.
   */
  async getAlerthooksByIdDeliveries(id: string, options: RequestOptions = {}) {
    return this.request("GET", `/v1/alert-hooks/${encodeURIComponent(id)}/deliveries`, undefined, options);
  }

  /** List this workspace's members — Everyone in this workspace, with their role and when they joined. Removed members are not listed. */
  async getMembers(options: RequestOptions = {}) {
    return this.request("GET", `/v1/members`, undefined, options);
  }

  /** Change a member's role — Only the owner changes roles, and the owner's own role cannot be changed here. Takes effect on the member's next request. */
  async patchMembersById(id: string, body: unknown, options: RequestOptions = {}) {
    return this.request("PATCH", `/v1/members/${encodeURIComponent(id)}`, body, options);
  }

  /** Remove a member — Signs them out everywhere at once and deletes their password. What they did stays attributed to them. Keys they created belong to the workspace and are not revoked — revoke them separately if they should stop too. */
  async postMembersByIdRemove(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/members/${encodeURIComponent(id)}/remove`, undefined, options);
  }

  /** List open invitations — Unaccepted, unrevoked and unexpired. */
  async getMembersInvitations(options: RequestOptions = {}) {
    return this.request("GET", `/v1/members/invitations`, undefined, options);
  }

  /** Invite someone — Returns a link to send them; there is no email yet. An address that already has an open invitation gets that invitation back — the same link, not a new one — with `handedBack: true`. To change the role on it, revoke it and invite again. */
  async postMembersInvitations(body: unknown, options: RequestOptions = {}) {
    return this.request("POST", `/v1/members/invitations`, body, options);
  }

  /** Withdraw an invitation — Its link stops working immediately. Safe to repeat. */
  async postMembersInvitationsByIdRevoke(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/members/invitations/${encodeURIComponent(id)}/revoke`, undefined, options);
  }

  /** Send an invitation again — The same link, emailed again — for one that was not received. At most once a minute per invitation. */
  async postMembersInvitationsByIdResend(id: string, options: RequestOptions = {}) {
    return this.request("POST", `/v1/members/invitations/${encodeURIComponent(id)}/resend`, undefined, options);
  }
}

/** @deprecated The client's name before fxapis. Use `Fxapis`. */
export const Orderwright = Fxapis;
/** @deprecated Use `FxapisError`. */
export const OrderwrightError = FxapisError;
/** @deprecated Use `FxapisError`. */
export type OrderwrightError = FxapisError;
