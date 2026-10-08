import { describe, expect, it } from "vitest";
import { Fxapis, FxapisError, Orderwright, OrderwrightError, newIdempotencyKey } from "./index.ts";

/**
 * The generated client.
 *
 * What matters is not that every method exists — the generator guarantees
 * that — but that the few hand-written parts behave: the auth header, the
 * idempotency key, and above all what `retryable` says about an unresolved
 * order.
 */
function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

function withFetch<T>(impl: unknown, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

describe("requests", () => {
  it("sends the key as a bearer token", async () => {
    const { calls, fetchImpl } = stub(200, { data: [] });
    await withFetch(fetchImpl, () => new Fxapis("fx_test_abc").getAccounts());
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer fx_test_abc");
  });

  it("sends an idempotency key when given one", async () => {
    const { calls, fetchImpl } = stub(201, { data: {} });
    await withFetch(fetchImpl, () =>
      new Fxapis("k").postAccountsByIdOrdersMarket("acct", { symbol: "EURUSD" }, { idempotencyKey: "abc" })
    );
    expect((calls[0]!.init.headers as Record<string, string>)["idempotency-key"]).toBe("abc");
  });

  it("escapes a path parameter rather than interpolating it raw", async () => {
    const { calls, fetchImpl } = stub(200, { data: {} });
    await withFetch(fetchImpl, () => new Fxapis("k").getAccountsById("a/../b"));
    expect(calls[0]!.url).toContain("a%2F..%2Fb");
  });

  it("unwraps the data envelope", async () => {
    const { fetchImpl } = stub(200, { data: { id: "x" } });
    const result = await withFetch(fetchImpl, () => new Fxapis("k").getAccountsById("x"));
    expect(result).toEqual({ id: "x" });
  });

  it("sends query parameters and skips undefined ones", async () => {
    const { calls, fetchImpl } = stub(200, { data: [], page: { hasMore: false, nextCursor: null } });
    await withFetch(fetchImpl, () =>
      new Fxapis("k").getOrders({ query: { accountId: "a 1", state: "unknown", limit: 200, cursor: undefined } })
    );
    expect(calls[0]!.url).toBe("https://api.fxapis.com/v1/orders?accountId=a+1&state=unknown&limit=200");
  });

  it("sends no query string when there is none", async () => {
    const { calls, fetchImpl } = stub(200, { data: [] });
    await withFetch(fetchImpl, () => new Fxapis("k").getOrders({ query: {} }));
    expect(calls[0]!.url).toBe("https://api.fxapis.com/v1/orders");
  });

  it("makes a fresh idempotency key each time", () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it("keeps the page of a paginated list, without changing the array", async () => {
    const page = { hasMore: true, nextCursor: "2026-09-28T14:02:11.482Z" };
    const { fetchImpl } = stub(200, { data: [{ id: "o1" }], page });
    const result = await withFetch(fetchImpl, () => new Fxapis("k").getOrders());
    expect(result).toEqual([{ id: "o1" }]);
    expect(JSON.stringify(result)).toBe('[{"id":"o1"}]');
    expect((result as { page?: unknown }).page).toEqual(page);
  });

  it("strips a trailing slash from the base url", async () => {
    const { calls, fetchImpl } = stub(200, { data: [] });
    await withFetch(fetchImpl, () => new Fxapis("k", "https://api.test/").getAccounts());
    expect(calls[0]!.url).toBe("https://api.test/v1/accounts");
  });
});

describe("errors", () => {
  it("throws with the code and request id", async () => {
    const { fetchImpl } = stub(422, {
      error: { code: "ORDER_REJECTED", message: "No money" },
      requestId: "req-1",
    });
    const error = await withFetch(fetchImpl, () => new Fxapis("k").getAccounts().catch((e: unknown) => e));
    expect(error).toBeInstanceOf(FxapisError);
    const typed = error as FxapisError;
    expect(typed.code).toBe("ORDER_REJECTED");
    expect(typed.requestId).toBe("req-1");
    expect(typed.status).toBe(422);
  });

  it("does not call an unresolved order retryable", async () => {
    // The one that matters. The order may be live at the broker; a client
    // library that said "retry" here would open a second position.
    const { fetchImpl } = stub(502, {
      error: {
        code: "ORDER_UNRESOLVED",
        message: "We do not know whether the order reached the broker.",
        details: [{ orderId: "o1", state: "unknown", retryable: false }],
      },
    });
    const error = (await withFetch(fetchImpl, () =>
      new Fxapis("k").getAccounts().catch((e: unknown) => e)
    )) as FxapisError;
    expect(error.retryable).toBe(false);
  });

  it("calls a send that never left retryable", async () => {
    const { fetchImpl } = stub(502, {
      error: { code: "SEND_FAILED", message: "never sent", details: [{ retryable: true }] },
    });
    const error = (await withFetch(fetchImpl, () =>
      new Fxapis("k").getAccounts().catch((e: unknown) => e)
    )) as FxapisError;
    expect(error.retryable).toBe(true);
  });

  it("calls an account that was not ready in time retryable", async () => {
    // Nothing was sent; the same key is safe to resend.
    const { fetchImpl } = stub(409, { error: { code: "ACCOUNT_NOT_READY", message: "not online in time" } });
    const error = (await withFetch(fetchImpl, () =>
      new Fxapis("k").getAccounts().catch((e: unknown) => e)
    )) as FxapisError;
    expect(error.retryable).toBe(true);
  });

  it("calls rate limiting retryable", async () => {
    const { fetchImpl } = stub(429, { error: { code: "RATE_LIMITED", message: "slow down" } });
    const error = (await withFetch(fetchImpl, () =>
      new Fxapis("k").getAccounts().catch((e: unknown) => e)
    )) as FxapisError;
    expect(error.retryable).toBe(true);
  });

  it("reads retryable from the detail when the broker rejected transiently", async () => {
    const { fetchImpl } = stub(422, {
      error: { code: "ORDER_REJECTED", message: "Requote", details: [{ retryable: true }] },
    });
    const error = (await withFetch(fetchImpl, () =>
      new Fxapis("k").getAccounts().catch((e: unknown) => e)
    )) as FxapisError;
    expect(error.retryable).toBe(true);
  });

  it("turns a gateway's non-JSON error page into a retryable FxapisError, not a SyntaxError", async () => {
    // A proxy between the client and fxapis (a 502/504 page). The request may
    // or may not have arrived, so the answer is: retry with the same key.
    const fetchImpl = async () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    const error = (await withFetch(fetchImpl, () =>
      new Fxapis("k").postAccountsByIdOrdersMarket("a", {}, { idempotencyKey: "k1" }).catch((e: unknown) => e)
    )) as FxapisError;
    expect(error).toBeInstanceOf(FxapisError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("GATEWAY_ERROR");
    expect(error.retryable).toBe(true);
  });

  it("reports a successful status that is not JSON, rather than returning nothing", async () => {
    const fetchImpl = async () => new Response("not json", { status: 200 });
    const error = (await withFetch(fetchImpl, () => new Fxapis("k").getAccounts().catch((e: unknown) => e))) as FxapisError;
    expect(error).toBeInstanceOf(FxapisError);
    expect(error.code).toBe("INVALID_RESPONSE");
  });

  it("says how long to wait when rate limited", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow down" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "7" },
      });
    const error = (await withFetch(fetchImpl, () => new Fxapis("k").getAccounts().catch((e: unknown) => e))) as FxapisError;
    expect(error.retryAfter).toBe(7);
  });

  it("calls the documented transient failures retryable", async () => {
    for (const code of ["INTERNAL_ERROR", "ACCOUNT_LEASED_ELSEWHERE", "SCHEDULER_FAILED", "MT5_UNAVAILABLE", "SECRET_STORE_UNAVAILABLE"]) {
      const { fetchImpl } = stub(503, { error: { code, message: "transient" } });
      const error = (await withFetch(fetchImpl, () => new Fxapis("k").getAccounts().catch((e: unknown) => e))) as FxapisError;
      expect(error.retryable, code).toBe(true);
    }
  });

  it("does not retry a quota refusal", async () => {
    // A bigger plan or a new month, not a retry.
    const { fetchImpl } = stub(402, { error: { code: "QUOTA_EXCEEDED", message: "over plan" } });
    const error = (await withFetch(fetchImpl, () =>
      new Fxapis("k").getAccounts().catch((e: unknown) => e)
    )) as FxapisError;
    expect(error.retryable).toBe(false);
  });
});

describe("what it deliberately does not do", () => {
  it("has no retry loop of its own", async () => {
    // A client library that retries an order on the customer's behalf is one
    // that can open a position twice. That decision is not ours to make
    // inside a convenience wrapper.
    const source = new Fxapis("k") as unknown as Record<string, unknown>;
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(source));
    expect(names.filter((n) => /retry|backoff/i.test(n))).toEqual([]);
  });
});

describe("the names from before fxapis", () => {
  it("still work, as aliases of the new ones", () => {
    expect(Orderwright).toBe(Fxapis);
    expect(OrderwrightError).toBe(FxapisError);
  });
});
