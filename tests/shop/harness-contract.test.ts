/**
 * **T3-101a [TEST]** — the shop live tier is fail-closed *on its own*.
 *
 * ## Why this file exists (the Medium finding on the T3-101a review)
 *
 * `npm run test:shop` runs `GARAGE_LIVE=1 GARAGE_LIVE_REQUIRED=1 vitest run
 * tests/shop`, and `ci.yml`'s `tier-b` job runs it as a separate step from
 * `test:garage` so a red one names which lineage's live proofs broke. The whole
 * value of that `GARAGE_LIVE_REQUIRED=1` is that a **missing stack becomes a red
 * build instead of green-with-skips** — every `describe.skipIf(!live.available)`
 * suite in `roster.test.ts` skips silently when no stack answers, and a silent
 * skip of a security proof is the "unknown is not zero" hazard this repo has
 * repeatedly paid for.
 *
 * But `GARAGE_LIVE_REQUIRED` had **exactly one consumer**: the fail-closed guard
 * in `tests/garage/harness-contract.test.ts` — a file `test:shop` does **not**
 * run. So `test:shop` against a missing stack exited **0** with every Tier-B
 * marker silently skipped: the shop live tier was fail-closed only *incidentally*,
 * because the sibling `test:garage` step ran first in the same job. Reorder or
 * split those steps and the shop live proofs would skip green forever. The
 * `ci.yml` comment claiming both scripts are fail-closed via that env var was
 * therefore false for `test:shop`.
 *
 * This file closes it: it is the co-located mirror of the garage guard, so
 * `npm run test:shop` **exits non-zero on its own** when `GARAGE_LIVE_REQUIRED=1`
 * and the live stack is unavailable — independent of `test:garage`, of step
 * ordering, and of the two jobs ever being split.
 *
 * ## Nothing here is `it.fails`, and that is the point
 *
 * Every other file in `tests/shop/` is either an `it.fails` expectation about
 * T3-102 or a `skipIf` suite that skips when no stack is running — both stay
 * green whether or not the tier actually ran. This file is the instrument that
 * makes "the tier ran" observable: a plain guard that passes under `verify`
 * (where `GARAGE_LIVE_REQUIRED` is unset, so skipping is legitimate) and **fails
 * loudly** under `test:shop` when the stack it requires is not there.
 *
 * ## It reuses the 002 detection, it does not invent a second one
 *
 * `detectLiveStack` from `../garage/harness.ts` is the exact predicate every
 * `tests/shop` suite already skips on (`roster.test.ts`'s top-level
 * `const live = await detectLiveStack()`). Grading the guard against the same
 * function is what makes "the guard fires ⇔ the suites skip" true by
 * construction; a private copy of the availability check could drift so the
 * guard passed while the suites skipped, which is the failure this whole task is
 * about.
 *
 * A test-writer instance authored this file and must not be the instance that
 * builds T3-102 (AGENTS.md separation rule; T901 audits it).
 *
 * refs specs/003-shop-tools (MEC-05, MEC-06, SHP-03, SHP-04),
 * specs/002-montero-garage (MIG-03)
 */
import { describe, expect, it } from "vitest";
import {
  detectLiveStack,
  SKIP_REASONS,
  type LiveDecision,
  type LiveStack,
} from "../garage/harness.ts";

/* -------------------------------------------------------------------------
 * The rule, as a pure predicate.
 *
 * Split out so BOTH its directions can be graded in the same run `verify`
 * executes — with no stack, no Docker, and no network — rather than only in the
 * one CI configuration that sets the flag. A guard whose accepting *and*
 * rejecting branches are never both exercised is a guard that can rot in the
 * direction nobody watches (GRADER-PRINCIPLES: every finding needs a positive
 * control; mutation-test each clause).
 * ---------------------------------------------------------------------- */

/**
 * The reason the shop live tier must **not** be skipped, or `null` when
 * skipping it is legitimate.
 *
 * A non-null string means "`GARAGE_LIVE_REQUIRED=1` was set and the tier is
 * unavailable, so the build must go red". `null` means either the caller did not
 * require the tier (plain `npm test` / `verify`) or the tier is actually up —
 * both cases where a skip, or a pass, is correct.
 */
function failClosedReason(
  required: boolean,
  decision: LiveDecision
): string | null {
  if (!required) return null;
  if (decision.available) return null;
  return decision.reason;
}

/* -------------------------------------------------------------------------
 * The predicate's own controls — hermetic, so they bite under `verify`.
 * ---------------------------------------------------------------------- */

describe("failClosedReason — required-but-unavailable is the only red state", () => {
  const up: LiveDecision = {
    available: true,
    stack: {
      url: "http://127.0.0.1:54321",
      jwtSecret: "x",
    } satisfies LiveStack,
  };
  const down: LiveDecision = {
    available: false,
    reason: "no Supabase stack answered on the local URL",
  };

  it("REQUIRED + unavailable → the reason (the build must go red)", () => {
    // The negative assertion, and the whole point of the file: when the flag is
    // set and nothing is listening, the guard has something to fail on.
    expect(failClosedReason(true, down)).toBe(down.reason);
  });

  it("REQUIRED + available → null (the control: a healthy stack is never flagged)", () => {
    // Without this, a guard hard-wired to `return "red"` would pass the test
    // above and turn every CI run red on a working stack — as broken as one that
    // never fires.
    expect(failClosedReason(true, up)).toBeNull();
  });

  it("not REQUIRED + unavailable → null (verify skips cleanly, stays green)", () => {
    // This is why `npm run verify` (no GARAGE_LIVE_REQUIRED) is not reddened by
    // the guard even though it has no stack.
    expect(failClosedReason(false, down)).toBeNull();
  });

  it("not REQUIRED + available → null", () => {
    expect(failClosedReason(false, up)).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * The wiring — the guard fires on the SAME detection tests/shop skips on.
 * ---------------------------------------------------------------------- */

describe("wired to detectLiveStack, the predicate tests/shop suites skip on", () => {
  it("a missing stack under REQUIRED=1 is a violation, end to end", async () => {
    // Exactly the state ci.yml's `test:shop` step must catch: GARAGE_LIVE=1 and
    // nothing listening. detectLiveStack reports it unavailable and the guard
    // turns that into a reason to fail. Real fetch to a dead loopback port —
    // connection refused is immediate, so there is no timeout to flake on.
    const decision = await detectLiveStack({
      GARAGE_LIVE: "1",
      SUPABASE_URL: "http://127.0.0.1:1",
    });

    expect(decision.available).toBe(false);
    expect(failClosedReason(true, decision)).not.toBeNull();
  });

  it("a live this-project stack under REQUIRED=1 is NOT a violation — the control", async () => {
    // Injected observer, so no stack is needed to prove the accepting side: a
    // reachable instance exposing 002's fingerprint tables is `available`, and
    // the guard lets it through. A guard that also fired here would switch the
    // shop tier off exactly when it should run.
    const decision = await detectLiveStack(
      { GARAGE_LIVE: "1", SUPABASE_URL: "http://127.0.0.1:54321" },
      async () => ({
        unreachable: null,
        exposed: ["profiles", "vehicles", "records", "receipts", "shares"],
      })
    );

    expect(decision.available).toBe(true);
    expect(failClosedReason(true, decision)).toBeNull();
  });

  it("GARAGE_LIVE unset makes no network request and is never a violation", async () => {
    // The verify path: nobody asked for the tier, so detectLiveStack returns the
    // named skip reason without touching the network, and the guard stays quiet.
    const started = Date.now();
    const decision = await detectLiveStack({});

    expect(decision.available).toBe(false);
    expect(decision.available === false && decision.reason).toBe(
      SKIP_REASONS.notEnabled
    );
    expect(failClosedReason(false, decision)).toBeNull();
    expect(Date.now() - started).toBeLessThan(250);
  });
});

/* -------------------------------------------------------------------------
 * The guard itself — real process env, real detection.
 *
 * This is the line that makes `npm run test:shop` fail-closed on its own. Under
 * `verify` (GARAGE_LIVE_REQUIRED unset) it passes; under `test:shop` with a
 * stack it passes; under `test:shop` with no stack it FAILS, which is the whole
 * point. Set the flag in CI once a Postgres service is available and a missing
 * stack becomes a red build with no test-file edits — the same switch
 * `tests/garage/harness-contract.test.ts` grades for the 002 tier, mirrored here
 * so the 003 tier does not lean on the garage step running first.
 * ---------------------------------------------------------------------- */

describe("FAIL-CLOSED: the shop live tier cannot be skipped when required", () => {
  it("GARAGE_LIVE_REQUIRED=1 forbids skipping the shop live tier", async () => {
    const required = process.env.GARAGE_LIVE_REQUIRED === "1";
    const decision = await detectLiveStack();
    const reason = failClosedReason(required, decision);

    expect(
      reason,
      reason === null
        ? undefined
        : `GARAGE_LIVE_REQUIRED=1 but the shop live tier is unavailable: ${reason}`
    ).toBeNull();
  });
});
