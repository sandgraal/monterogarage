/**
 * Client-logic grader for `bindShareGrant`'s refused-vs-failed classification.
 *
 * This is the one decision the *module* owns on the bind path: the database
 * decides whether a grant binds, but the browser decides what to tell a
 * mechanic when the call comes back with an error, and that choice is
 * load-bearing. `refused` tells a legitimate mechanic "this binding isn't
 * yours" — a dead end — while `failed` tells them "try again." Misclassifying a
 * timeout or a 5xx as `refused` strands a valid user on a working link, so the
 * line between the two is graded here rather than trusted.
 *
 * Only the definer's authorization refusal (`42501 insufficient_privilege`,
 * which `bind_share_grant` raises for "not your account", already bound,
 * expired, or revoked) is `refused`. Every other server error — a statement
 * timeout, a serialization failure or deadlock, a dropped connection PostgREST
 * surfaces with an empty code, an unexpected SQLSTATE, a 5xx — is `failed`.
 *
 * The fake client follows the idiom `garage-writes.test.ts` established: mock
 * `./auth.ts`, record/return through a recording stand-in, and grade the shape
 * of the request and the reading of its reply — never RLS, which is graded live
 * in `tests/garage/` and `tests/shop/`.
 *
 * refs specs/003-shop-tools (MEC-05, MEC-06), specs/002-montero-garage (SHR-08)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The error the fake `bind_share_grant` RPC reports, or `null` for a clean
 * bind. A PostgREST error object carries `code` (the SQLSTATE); that is the only
 * field the classification reads, so it is the only field the fake supplies.
 */
let rpcError: { code?: string } | null = null;

/** The RPC name and token the fake was last asked to call, so the request shape is checkable. */
let lastRpc: { name: string; args: unknown } | null = null;

function fakeClient(): unknown {
  return {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { id: "mechanic-1" } } },
          error: null,
        }),
    },
    rpc: (name: string, args: unknown) => {
      lastRpc = { name, args };
      return Promise.resolve({ data: null, error: rpcError });
    },
  };
}

vi.mock("./auth.ts", () => ({
  getSupabaseClient: () => Promise.resolve(fakeClient()),
}));

const { bindShareGrant } = await import("./shares.ts");

beforeEach(() => {
  rpcError = null;
  lastRpc = null;
});

describe("bindShareGrant classification", () => {
  it("POSTs the token to bind_share_grant", async () => {
    await bindShareGrant("tok-abc");
    expect(lastRpc).toEqual({
      name: "bind_share_grant",
      args: { p_token: "tok-abc" },
    });
  });

  it("maps 42501 (insufficient_privilege) to refused", async () => {
    rpcError = { code: "42501" };
    expect(await bindShareGrant("tok")).toEqual({
      ok: false,
      reason: "refused",
    });
  });

  it("reports a clean bind as ok", async () => {
    rpcError = null;
    expect(await bindShareGrant("tok")).toEqual({ ok: true, value: true });
  });

  /**
   * Every non-42501 server condition is retryable, not a refusal. Each entry is
   * a SQLSTATE a *contendable UPDATE* can realistically surface — a refusal here
   * would strand a valid mechanic on a link that is genuinely theirs.
   */
  it.each([
    ["57014 statement timeout", "57014"],
    ["40001 serialization failure", "40001"],
    ["40P01 deadlock detected", "40P01"],
    ["08006 connection failure", "08006"],
    ["53300 too many connections (5xx-class)", "53300"],
    ["XX000 internal error", "XX000"],
    ["P0001 unexpected raise", "P0001"],
  ])("maps %s to failed, never refused", async (_label, code) => {
    rpcError = { code };
    expect(await bindShareGrant("tok")).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("maps an empty code (fetch rejected, no SQLSTATE) to failed", async () => {
    // postgrest-js synthesises an error with `code: ""` when `fetch` itself
    // rejects — a request that never reached Postgres, and so never a refusal.
    rpcError = { code: "" };
    expect(await bindShareGrant("tok")).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("maps a missing code to failed", async () => {
    rpcError = {};
    expect(await bindShareGrant("tok")).toEqual({
      ok: false,
      reason: "failed",
    });
  });
});
