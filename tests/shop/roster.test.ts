/**
 * Graders — **the mechanic's roster and grant binding, T3-101 [TEST]**,
 * activated by **T3-102 [PLATFORM]** (spec 003).
 *
 * This is the first task of spec 003, and it is an accounts / RLS / user-data
 * boundary — the load-bearing correctness class — so it is graded adversarially:
 * every negative is proved real, not merely spelled, and every negative has a
 * positive control in the same run.
 *
 * | property (from the task line) | Tier A | Tier B |
 * |---|---|---|
 * | a grant issued to an email binds to that account on first authenticated open, **and to no other** | argument + column shape, bind-body shape | the binding boundary table, and the no-re-bind proof |
 * | an unbound grant is readable by its bearer yet **invisible to every roster** | roster ties rows to `auth.uid()` | bearer reads it; no roster shows it (with the roster proven non-empty) |
 * | a revoked **or** expired grant leaves the roster on the **next** request | roster tests `revoked_at` and `expires_at` (002 rules re-used) | revoke, then expire, each observed leaving |
 * | a shop member cannot see a grant issued to an **individual** (SHP-04) | `is_shop_visible` schema, private-by-default | an individual grant reaches only the bound account; the individual roster is audience-agnostic |
 *
 * ## Two tiers, the same discipline as `tests/garage/`
 *
 * **Tier A** parses the migration text and runs everywhere — no Docker, on the
 * merge path. Every Tier-A grader is marked `it.fails`: it fails **today**,
 * for the right reason (the T3-102 seam, or a named "column/argument absent"
 * assertion — never an import error), and T3-102 activates it by deleting
 * exactly that `.fails` line. That is what keeps `npm run verify` green while
 * the feature does not exist.
 *
 * **Tier B** talks to a real local stack (`describe.skipIf(!live.available)`),
 * because "binds to that account and to no other" and "leaves the roster on the
 * next request" are statements about behaviour that no amount of reading SQL
 * proves. It is also marked `it.fails`, so a deliberate `GARAGE_LIVE=1` run
 * before T3-102 lands reports the proofs as expected failures rather than
 * errors; T3-102 deletes those markers too. Under `npm test` with no stack the
 * whole tier skips with a named reason, so it never reddens the merge gate.
 *
 * ## Names are decisions, and they live in one file
 *
 * Every table/column/function/argument name comes from `./contract.ts`, which
 * makes them on the spec's behalf (the T2-201 precedent). A rename is a one-line
 * change there, not a hunt through this file.
 *
 * refs specs/003-shop-tools (MEC-05, MEC-06, SHP-03, SHP-04),
 * specs/002-montero-garage (SHR-05..09)
 */
import { describe, expect, it } from "vitest";
import {
  CONTRACT_SCHEMA,
  SHARE_CREATE_ARGUMENTS,
  SHARE_CREATE_FUNCTION,
  SHARE_READER_NAMES,
  SHARE_READER_TOKEN_ARGUMENT,
  testReceiptPath,
} from "../garage/contract.ts";
import {
  createOwnedFixture,
  detectLiveStack,
  liveTitle,
  provisionScenario,
  rpc,
  stackOf,
  teardownScenario,
  type Scenario,
} from "../garage/harness.ts";
import {
  definerSearchPathIssues,
  expiryCheckIssues,
  isAnonExecutable,
  isContractRoutine,
  revocationCheckIssues,
  tokenHashIssues,
} from "../garage/rules.ts";
import { revokeGrant } from "../garage/share-fixtures.ts";
import {
  columnDefinitionFor,
  defaultExpression,
  foreignKey,
  foreignKeyFor,
  functions,
  grants,
  isNotNullFor,
  migrationSql,
  privilegeVerdict,
  type FunctionDefinition,
} from "../garage/sql.ts";
import {
  ACCOUNT_ONLY_FUNCTIONS,
  BIND_GRANT_ARGUMENTS,
  BIND_GRANT_FUNCTION,
  BOUND_ACCOUNT_COLUMN,
  GRANTEE_EMAIL_COLUMN,
  MECHANIC_ROSTER_FUNCTION,
  SHARE_EXTEND_ARGUMENTS,
  SHARE_EXTEND_FUNCTION,
  SHARE_GRANTEE_EMAIL_ARGUMENT,
  SHARE_SHOP_VISIBLE_ARGUMENT,
  SHARES_TABLE,
  SHOP_VISIBLE_COLUMN,
  rosterSeam,
} from "./contract.ts";
import {
  bindGrant,
  dropAuthedActor,
  expireGrant,
  extendGrant,
  issueNamedGrant,
  makeAuthedActor,
  readRoster,
  rosterHasVehicle,
} from "./fixtures.ts";

const live = await detectLiveStack();

/**
 * The one T3-102 routine bearing `name` in `CONTRACT_SCHEMA`, or the seam.
 *
 * By schema **and** name (`isContractRoutine`), for the PR #74 reason: a
 * `private.mechanic_roster` is a different function with a different ACL, and a
 * comparison on the bare name cannot tell them apart. More than one match is a
 * finding of its own — an overload where the contract expects one routine.
 */
function requireAccountRoutine(
  name: string,
  normalized: string = migrationSql()
): FunctionDefinition {
  const found = functions(normalized).filter((routine) =>
    isContractRoutine(routine, name)
  );
  if (found.length === 0) {
    throw rosterSeam(
      `no function named ${CONTRACT_SCHEMA}.${name} exists in supabase/migrations/`
    );
  }
  if (found.length > 1) {
    throw new Error(
      `${CONTRACT_SCHEMA}.${name} has ${found.length} overloads — the contract ` +
        `expects exactly one`
    );
  }
  return found[0];
}

/* =========================================================================
 * Tier A — marked. The schema, the argument lists, and the routine bodies
 * T3-102 ships. Each fails today with the T3-102 seam or a named absence.
 * ====================================================================== */

describe("the shares table gains the binding columns (MEC-06, SHP-04)", () => {
  it("grantee_email is a nullable column — the addressee", () => {
    // MEC-06: a grant is issued "for a named account". The email is that name.
    // Nullable, because a plain 002 bearer link has no addressee and must
    // remain issuable — which is also what makes it forever unbindable and so
    // forever off every roster (property 2, by construction).
    const sql = migrationSql();
    const def = columnDefinitionFor(sql, SHARES_TABLE, GRANTEE_EMAIL_COLUMN);
    expect(
      def,
      `${SHARES_TABLE}.${GRANTEE_EMAIL_COLUMN} is not declared`
    ).not.toBeNull();
    expect(isNotNullFor(sql, SHARES_TABLE, GRANTEE_EMAIL_COLUMN)).toBe(false);
  });

  it("bound_account_id is a uuid referencing auth.users", () => {
    // The single fact that puts a grant on a roster, and whose absence keeps it
    // off one. A binding is to a real account or it is nothing, so the column
    // references auth.users.
    const sql = migrationSql();
    const def = columnDefinitionFor(sql, SHARES_TABLE, BOUND_ACCOUNT_COLUMN);
    expect(
      def,
      `${SHARES_TABLE}.${BOUND_ACCOUNT_COLUMN} is not declared`
    ).not.toBeNull();
    expect(def?.definition).toMatch(/uuid/);

    // Both idioms: an inline `references` on the `add column` (parsed off the
    // column definition), and a separate table-level FK (parsed by
    // `foreignKeyFor`). Either is a correct way to point a binding at a real
    // account; requiring one spelling would fail the other for no reason a
    // requirement can name.
    const fk =
      foreignKey(def?.definition ?? "") ??
      foreignKeyFor(sql, SHARES_TABLE, BOUND_ACCOUNT_COLUMN);
    expect(
      fk,
      `${BOUND_ACCOUNT_COLUMN} carries no foreign key — a binding must point ` +
        `at a real account`
    ).not.toBeNull();
    expect(fk?.target).toMatch(/(?:^|\.)users$/);
  });

  it("is_shop_visible is not-null default false — SHP-04, private by default", () => {
    // > Consent to share with a business is not implied by consent to share
    // > with a person who works there. — SHP-04
    //
    // So the safe value is the default, in the same private-by-default
    // posture SHR-01 gives every other visibility flag. The shop roster that
    // *consumes* this flag is T3-201's; T3-101 pins that the flag exists and
    // defaults to individual.
    const sql = migrationSql();
    const def = columnDefinitionFor(sql, SHARES_TABLE, SHOP_VISIBLE_COLUMN);
    expect(
      def,
      `${SHARES_TABLE}.${SHOP_VISIBLE_COLUMN} is not declared`
    ).not.toBeNull();
    expect(def?.definition).toMatch(/bool/);
    expect(isNotNullFor(sql, SHARES_TABLE, SHOP_VISIBLE_COLUMN)).toBe(true);
    expect(defaultExpression(def?.definition ?? "")).toBe("false");
  });
});

describe("the issue path records the addressee and the audience (MEC-06, SHP-04)", () => {
  it("create_share_grant takes p_grantee_email and p_is_shop_visible, and stays one routine", () => {
    // Reuse, not a parallel issue RPC: 002's `create_share_grant` gains two
    // defaulted arguments. Exactly one routine — adding arguments changes the
    // identity, so a bare `create or replace` would leave a second overload
    // and both this grader and 002's "ships create_share_grant" would fail.
    // T3-102 must drop-and-recreate; see `SHARE_GRANTEE_EMAIL_ARGUMENT`.
    const all = functions(migrationSql()).filter((routine) =>
      isContractRoutine(routine, SHARE_CREATE_FUNCTION)
    );
    expect(all).toHaveLength(1);
    const [create] = all;

    expect(create.argNames).toContain(SHARE_GRANTEE_EMAIL_ARGUMENT);
    expect(create.argNames).toContain(SHARE_SHOP_VISIBLE_ARGUMENT);
    // The 002 arguments survive — the 5-argument anonymous-link call must
    // still resolve.
    for (const name of SHARE_CREATE_ARGUMENTS) {
      expect(create.argNames, `dropped 002 argument ${name}`).toContain(name);
    }
  });
});

describe("the account surface: bind, roster, extend (MEC-05, MEC-06)", () => {
  it(`ships ${CONTRACT_SCHEMA}.${BIND_GRANT_FUNCTION}, taking the token`, () => {
    const bind = requireAccountRoutine(BIND_GRANT_FUNCTION);
    for (const name of BIND_GRANT_ARGUMENTS) {
      expect(
        bind.argNames,
        `${BIND_GRANT_FUNCTION} is missing ${name}`
      ).toContain(name);
    }
  });

  it(`ships ${CONTRACT_SCHEMA}.${MECHANIC_ROSTER_FUNCTION}`, () => {
    // MEC-05: "one place". It takes no argument a caller can name — it reads
    // auth.uid() — which is what makes "someone else's roster" unrepresentable.
    const roster = requireAccountRoutine(MECHANIC_ROSTER_FUNCTION);
    expect(roster.argNames).toEqual([]);
  });

  it(`ships ${CONTRACT_SCHEMA}.${SHARE_EXTEND_FUNCTION}, per grant`, () => {
    // MEC-06: "extend to until-revoked … and revoke from the same place". Per
    // grant, by id, exactly like revoke — extend one link without touching the
    // other on the same truck.
    const extend = requireAccountRoutine(SHARE_EXTEND_FUNCTION);
    for (const name of SHARE_EXTEND_ARGUMENTS) {
      expect(
        extend.argNames,
        `${SHARE_EXTEND_FUNCTION} is missing ${name}`
      ).toContain(name);
    }
  });

  it("no account routine is reachable without an account", () => {
    // §1: "the accountless path is read-only because it has no auth.uid()."
    // Binding, the roster, and extending are the account's value-add, so an
    // anon/public caller holds no execute on any of them. An `"unknown"`
    // verdict counts as reachable (Postgres grants execute to PUBLIC by
    // default), so this also catches a forgotten `revoke`.
    const state = grants(migrationSql());
    const reachable = ACCOUNT_ONLY_FUNCTIONS.filter((name) =>
      isAnonExecutable(state, requireAccountRoutine(name))
    );
    expect(reachable).toEqual([]);
  });

  it("every account routine is reachable by an authenticated caller", () => {
    // The other direction, so "not anon" is not satisfied by a routine nobody
    // can reach at all. A closed door nobody can open is as broken as one that
    // will not shut.
    const state = grants(migrationSql());
    const unreachable = ACCOUNT_ONLY_FUNCTIONS.filter(
      (name) =>
        privilegeVerdict(
          state,
          requireAccountRoutine(name).identity,
          "authenticated",
          "execute"
        ) !== "granted"
    );
    expect(unreachable).toEqual([]);
  });

  it("every security-definer account routine pins search_path = ''", () => {
    // A definer routine resolves unqualified names through the caller's search
    // path; `set search_path = ''` forces every name to be schema-qualified.
    // Re-uses 002's rule, scoped to these routines — a routine that is invoker
    // (extend, if T3-102 leans on the owner's RLS) is not required to set one,
    // which is why this filters the rule's findings rather than asserting the
    // mode.
    const issues = definerSearchPathIssues(migrationSql());
    for (const name of ACCOUNT_ONLY_FUNCTIONS) {
      const routine = requireAccountRoutine(name);
      expect(
        issues.filter((issue) => issue.includes(routine.identity)),
        `${routine.identity} search_path`
      ).toEqual([]);
    }
  });
});

describe("the roster shows only live grants, keyed to the caller (MEC-05, SHR-08)", () => {
  it("mechanic_roster tests revoked_at — the reused SHR-08 rule", () => {
    // The likeliest defect in the whole feature: a roster that keys on the
    // binding and never re-reads revoked_at, so a revoked grant lingers. 002's
    // `revocationCheckIssues` is exactly this question, one surface over.
    expect(
      revocationCheckIssues(requireAccountRoutine(MECHANIC_ROSTER_FUNCTION))
    ).toEqual([]);
  });

  it("mechanic_roster tests expires_at — the reused SHR-08 rule", () => {
    expect(
      expiryCheckIssues(requireAccountRoutine(MECHANIC_ROSTER_FUNCTION))
    ).toEqual([]);
  });

  it("mechanic_roster ties its rows to the caller's own binding", () => {
    // Structural floor under property 4's behavioural proof: a roster that does
    // not name bound_account_id cannot be scoped to a binding, and one that
    // does not name auth.uid() cannot be scoped to the caller — either way it
    // would hand one mechanic another's grants. The behaviour is proved in
    // Tier B; this is the cheap check that fails on the merge path.
    const roster = requireAccountRoutine(MECHANIC_ROSTER_FUNCTION);
    expect(roster.body).toContain(BOUND_ACCOUNT_COLUMN);
    expect(roster.body).toMatch(/auth\.uid\(\)/);
  });
});

describe("binding resolves the grant safely and only for its addressee (MEC-06)", () => {
  it("bind_share_grant looks the grant up by hash, never plaintext", () => {
    // 002's three-part token rule, the hash half: a bind that resolves the
    // token against a plaintext column is a bind whose lookup key is the bearer
    // secret. Re-used unchanged.
    expect(tokenHashIssues(requireAccountRoutine(BIND_GRANT_FUNCTION))).toEqual(
      []
    );
  });

  it("bind_share_grant reads the addressee and writes the binding", () => {
    // "binds to that account and to no other" rests on the body consulting the
    // addressee (grantee_email) before it writes the binding (bound_account_id).
    // A bind that never reads grantee_email binds whoever holds the token; one
    // that never writes bound_account_id binds nobody. Tier B proves the
    // behaviour against a live email mismatch; this pins the two seams it needs.
    const bind = requireAccountRoutine(BIND_GRANT_FUNCTION);
    expect(bind.body).toContain(GRANTEE_EMAIL_COLUMN);
    expect(bind.body).toContain(BOUND_ACCOUNT_COLUMN);
  });
});

/* =========================================================================
 * Tier B — behavioural. The half that can actually prove binding, roster
 * visibility, and revocation/expiry on the next request. Marked it.fails so a
 * pre-T3-102 live run reports expected failures, not errors; skipped entirely
 * when no local stack is present.
 * ====================================================================== */

/** One owned vehicle for owner A, created as owner A through the API. */
async function ownedVehicleId(scenario: Scenario, slot = "1"): Promise<string> {
  const owned = await createOwnedFixture(
    scenario,
    scenario.ownerA,
    testReceiptPath(scenario.ownerA.userId ?? "", slot)
  );
  return owned.vehicleId;
}

/** Read a vehicle as an accountless bearer of `token` — 002's SHR-07 path. */
function readAsBearer(
  scenario: Scenario,
  token: string
): Promise<{ ok: boolean }> {
  return rpc(scenario, scenario.anon, SHARE_READER_NAMES[0], {
    [SHARE_READER_TOKEN_ARGUMENT]: token,
  });
}

describe.skipIf(!live.available)(
  liveTitle(
    "property 1 — a grant binds to its addressee and to no other",
    live
  ),
  () => {
    it.each([
      ["a matching email binds and lands on the caller's roster", true],
      ["a mismatched email is refused and never lands on any roster", false],
    ] as const)("%s", async (_label, emailMatches) => {
      // The core of "binds to that account, and to no other", as a two-row
      // boundary table on the one variable that decides it: whether the caller
      // authenticated as the addressee. The grant is always issued to the
      // mechanic; the caller is the mechanic (match) or the stranger (mismatch).
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      const stranger = await makeAuthedActor(scenario, "s");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          {
            granteeEmail: mechanic.email,
          }
        );

        const caller = emailMatches ? mechanic : stranger;
        const bound = await bindGrant(scenario, caller, grant.token);
        expect(bound.ok).toBe(emailMatches);

        const roster = await readRoster(scenario, caller);
        expect(roster.ok).toBe(true);
        expect(rosterHasVehicle(roster, vehicleId)).toBe(emailMatches);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await dropAuthedActor(scenario, stranger);
        await teardownScenario(scenario);
      }
    });

    it("the first authenticated open binds, and no later opener can re-bind it", async () => {
      // "on first authenticated open" is a once-only event. After the
      // addressee binds, a stranger holding the same token cannot capture the
      // binding — and the addressee keeps it. The positive control (the
      // mechanic is on the roster) is what stops "the stranger sees nothing"
      // being satisfied by a roster that is broken for everyone.
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      const stranger = await makeAuthedActor(scenario, "s");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email }
        );

        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );
        const stolen = await bindGrant(scenario, stranger, grant.token);
        expect(stolen.ok).toBe(false);

        const mechanicRoster = await readRoster(scenario, mechanic);
        const strangerRoster = await readRoster(scenario, stranger);
        expect(mechanicRoster.ok).toBe(true);
        expect(strangerRoster.ok).toBe(true);
        expect(rosterHasVehicle(mechanicRoster, vehicleId)).toBe(true);
        expect(rosterHasVehicle(strangerRoster, vehicleId)).toBe(false);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await dropAuthedActor(scenario, stranger);
        await teardownScenario(scenario);
      }
    });

    it("the addressee themself cannot re-bind an already-bound grant (once-only, not idempotent)", async () => {
      // The sibling test above proves a *stranger* cannot capture the
      // binding — but `grantee_email = auth.email()` refuses a stranger on
      // its own, regardless of whether `bound_account_id is null` is checked
      // at all. It cannot exercise that clause. This is the one case that
      // can: the *same* addressee, who satisfies the email check both
      // times, calling `bind` a second time. `bind_share_grant`'s atomic
      // UPDATE also requires `bound_account_id is null` — so a second call
      // from the addressee who already holds the binding must still be
      // refused ("share binding refused"), not silently re-succeed. Drop
      // that clause and this is the only grader in the suite that reddens:
      // the stranger proof above stays green because it never reaches the
      // null check, and it would stay green forever if this were the only
      // "no re-bind" proof on file.
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email }
        );

        // Positive control: the first bind, by the addressee, succeeds and
        // lands the vehicle on their roster — so the refusal asserted below
        // is not "bind is broken for everyone."
        const first = await bindGrant(scenario, mechanic, grant.token);
        expect(first.ok).toBe(true);
        const rosterAfterFirst = await readRoster(scenario, mechanic);
        expect(rosterAfterFirst.ok).toBe(true);
        expect(rosterHasVehicle(rosterAfterFirst, vehicleId)).toBe(true);

        // The clause under test: the same addressee, same token, second
        // call. Refused, and refused by name — not merely a non-2xx status,
        // which an unrelated failure could also produce.
        const second = await bindGrant(scenario, mechanic, grant.token);
        expect(second.ok).toBe(false);
        expect(second.text).toContain("share binding refused");

        // Still on the roster exactly because of the first bind, not a
        // partial effect of the refused second call.
        const rosterAfterSecond = await readRoster(scenario, mechanic);
        expect(rosterAfterSecond.ok).toBe(true);
        expect(rosterHasVehicle(rosterAfterSecond, vehicleId)).toBe(true);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle(
    "property 2 — an unbound grant is readable by its bearer, invisible to every roster",
    live
  ),
  () => {
    it("the accountless bearer can read an unbound grant", async () => {
      // SHR-07 / MEC-01: the mechanic opens the link before signing up. A named
      // grant nobody has bound is still an open link for whoever holds the
      // token — binding is about the roster, not about the read path.
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          {
            granteeEmail: mechanic.email,
          }
        );
        expect((await readAsBearer(scenario, grant.token)).ok).toBe(true);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });

    it("an unbound grant is on nobody's roster", async () => {
      // Issued to the mechanic, bound by nobody: neither the addressee's roster
      // nor a stranger's shows it. The positive control — the mechanic's roster
      // fills the instant they bind — is what proves the empty roster is a real
      // "nothing here", not a roster reader that always answers empty.
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      const stranger = await makeAuthedActor(scenario, "s");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          {
            granteeEmail: mechanic.email,
          }
        );

        const beforeMechanic = await readRoster(scenario, mechanic);
        const beforeStranger = await readRoster(scenario, stranger);
        expect(beforeMechanic.ok).toBe(true);
        expect(beforeStranger.ok).toBe(true);
        expect(rosterHasVehicle(beforeMechanic, vehicleId)).toBe(false);
        expect(rosterHasVehicle(beforeStranger, vehicleId)).toBe(false);

        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );
        const afterMechanic = await readRoster(scenario, mechanic);
        expect(afterMechanic.ok).toBe(true);
        expect(rosterHasVehicle(afterMechanic, vehicleId)).toBe(true);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await dropAuthedActor(scenario, stranger);
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle(
    "property 3 — a revoked or expired grant leaves the roster on the next request",
    live
  ),
  () => {
    it("revocation drops the vehicle from the roster", async () => {
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          {
            granteeEmail: mechanic.email,
          }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );

        const before = await readRoster(scenario, mechanic);
        expect(before.ok).toBe(true);
        expect(rosterHasVehicle(before, vehicleId)).toBe(true);

        expect(
          (await revokeGrant(scenario, scenario.ownerA, grant.shareId)).ok
        ).toBe(true);

        const after = await readRoster(scenario, mechanic);
        expect(after.ok).toBe(true);
        expect(rosterHasVehicle(after, vehicleId)).toBe(false);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });

    it("expiry drops the vehicle from the roster", async () => {
      // The grant is bound while live, then its expiry is moved into the past.
      // A roster that still lists it cached membership at bind time instead of
      // consulting liveness per request — the exact defect the reused
      // `expiryCheckIssues` rule pins in Tier A, proved here on the wire.
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          {
            granteeEmail: mechanic.email,
          }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );

        const before = await readRoster(scenario, mechanic);
        expect(before.ok).toBe(true);
        expect(rosterHasVehicle(before, vehicleId)).toBe(true);

        expect(
          (await expireGrant(scenario, scenario.ownerA, grant.shareId)).ok
        ).toBe(true);

        const after = await readRoster(scenario, mechanic);
        expect(after.ok).toBe(true);
        expect(rosterHasVehicle(after, vehicleId)).toBe(false);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle(
    "property 4 — a grant issued to the individual reaches only that account (SHP-04)",
    live
  ),
  () => {
    it("an individual grant is on the addressee's roster and no shopmate's", async () => {
      // SHP-04's account-isolation floor: an individual grant (is_shop_visible
      // = false) issued to the mechanic reaches the mechanic's roster and not
      // a would-be shopmate's. The positive control gives the shopmate their
      // *own* bound grant on a second vehicle, so their roster is proven to
      // work — a shopmate who sees their own vehicle but not the mechanic's
      // individual one is the isolation this asserts.
      //
      // The shop roster that would union is_shop_visible grants is T3-201's,
      // and so is the proof that it excludes individual ones; T3-101 grades
      // the data-layer floor beneath it. (SHOP_ROSTER_HANDOFF.)
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      const shopmate = await makeAuthedActor(scenario, "p");
      try {
        const mechVehicle = await ownedVehicleId(scenario, "1");
        const mateVehicle = await ownedVehicleId(scenario, "2");

        const individual = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          mechVehicle,
          { granteeEmail: mechanic.email, shopVisible: false }
        );
        const mateGrant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          mateVehicle,
          { granteeEmail: shopmate.email, shopVisible: false }
        );

        expect((await bindGrant(scenario, mechanic, individual.token)).ok).toBe(
          true
        );
        expect((await bindGrant(scenario, shopmate, mateGrant.token)).ok).toBe(
          true
        );

        const mechanicRoster = await readRoster(scenario, mechanic);
        const shopmateRoster = await readRoster(scenario, shopmate);
        expect(mechanicRoster.ok).toBe(true);
        expect(shopmateRoster.ok).toBe(true);

        expect(rosterHasVehicle(mechanicRoster, mechVehicle)).toBe(true);
        // The isolation: the shopmate's own roster works (their vehicle is on
        // it) yet the mechanic's individual grant is not.
        expect(rosterHasVehicle(shopmateRoster, mateVehicle)).toBe(true);
        expect(rosterHasVehicle(shopmateRoster, mechVehicle)).toBe(false);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await dropAuthedActor(scenario, shopmate);
        await teardownScenario(scenario);
      }
    });

    it("the individual roster is audience-agnostic: a shop-visible grant still reaches only the bound account", async () => {
      // is_shop_visible governs the *shop* roster (T3-201), never the
      // individual one: a shop-visible grant bound to the mechanic is on the
      // mechanic's roster and still not on a shopmate's individual roster.
      // This distinguishes the flag's two readers — the day the shop roster
      // exists it will union this grant, and the individual roster never will.
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      const shopmate = await makeAuthedActor(scenario, "p");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email, shopVisible: true }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );

        const mechanicRoster = await readRoster(scenario, mechanic);
        const shopmateRoster = await readRoster(scenario, shopmate);
        expect(mechanicRoster.ok).toBe(true);
        expect(shopmateRoster.ok).toBe(true);
        expect(rosterHasVehicle(mechanicRoster, vehicleId)).toBe(true);
        expect(rosterHasVehicle(shopmateRoster, vehicleId)).toBe(false);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await dropAuthedActor(scenario, shopmate);
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle(
    "MEC-06 — extend to until-revoked, and revoke, from the same place",
    live
  ),
  () => {
    it("an owner extends an expired grant back onto the roster, then revokes it off", async () => {
      // The full MEC-06 lifecycle for a named account: a grant that has
      // lapsed off the roster is extended to "until revoked" and returns,
      // then is revoked and leaves — the two controls "in the same place".
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );
        expect(
          rosterHasVehicle(await readRoster(scenario, mechanic), vehicleId)
        ).toBe(true);

        await expireGrant(scenario, scenario.ownerA, grant.shareId);
        expect(
          rosterHasVehicle(await readRoster(scenario, mechanic), vehicleId)
        ).toBe(false);

        expect(
          (await extendGrant(scenario, scenario.ownerA, grant.shareId)).ok
        ).toBe(true);
        expect(
          rosterHasVehicle(await readRoster(scenario, mechanic), vehicleId)
        ).toBe(true);

        expect(
          (await revokeGrant(scenario, scenario.ownerA, grant.shareId)).ok
        ).toBe(true);
        expect(
          rosterHasVehicle(await readRoster(scenario, mechanic), vehicleId)
        ).toBe(false);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });

    it("only the issuer can extend a grant", async () => {
      // Extend is ungated on plan (like revoke) but not unowned. A different
      // owner cannot push out someone else's expiry — and the grant is
      // unchanged afterwards, which the bound mechanic's still-present roster
      // proves.
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          {
            granteeEmail: mechanic.email,
          }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );

        const stolen = await extendGrant(
          scenario,
          scenario.ownerB,
          grant.shareId
        );
        expect(stolen.ok).toBe(false);

        const roster = await readRoster(scenario, mechanic);
        expect(roster.ok).toBe(true);
        expect(rosterHasVehicle(roster, vehicleId)).toBe(true);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });
  }
);
