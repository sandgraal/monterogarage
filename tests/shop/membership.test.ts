/**
 * Graders — **shop membership and roster isolation, T3-201 [TEST]**, activated
 * by **T3-202 [PLATFORM]** (spec 003, the shop surface).
 *
 * This is an accounts / RLS / user-data boundary — the load-bearing correctness
 * class — so it is graded adversarially: every guarantee is bitten by its own
 * grader, every negative is proved real rather than merely spelled, and every
 * negative has a positive control in the same run.
 *
 * | guarantee (from the task line / SHP-01,03,04) | Tier A | Tier B |
 * |---|---|---|
 * | membership is invite-only, **no open join** (SHP-01) | the invite RPCs exist; `authenticated` holds **no direct insert** on `shop_members`; `accept_shop_invite` reads the invite before writing membership; `invite_to_shop` consults `shop_members` | the addressee joins and a stranger cannot; a non-member cannot self-insert a membership row; only an existing member can invite |
 * | a member sees **exactly** the shop's grants and **no others** (SHP-03, SHP-04) | `shop_roster` consults `is_shop_visible` + `shop_members` + `auth.uid()`, and only live grants | a shopmate's shop-visible grant appears; a shopmate's *individual* grant does not; another shop's grant never reaches this roster; a non-member cannot read it |
 *
 * ## Two tiers, the same discipline as `tests/garage/` and `roster.test.ts`
 *
 * **Tier A** parses the migration text, runs everywhere, on the merge path.
 * Every Tier-A grader is `it.fails`: it fails **today**, for the right reason
 * (the T3-202 seam — a named "table/function/argument absent" — never an import
 * error), and T3-202 activates it by deleting exactly that `.fails` line.
 *
 * **Tier B** talks to a real local stack (`describe.skipIf(!live.available)`),
 * because "a stranger cannot join" and "the individual grant is withheld" are
 * statements about behaviour no amount of reading SQL proves. It is also
 * `it.fails`, so a deliberate `GARAGE_LIVE=1` run before T3-202 lands reports
 * the proofs as expected failures rather than errors; T3-202 deletes those
 * markers too. Under plain `npm test` the whole tier skips with a named reason,
 * so it never reddens the merge gate.
 *
 * ## Names are decisions, and they live in one file
 *
 * Every table/column/function/argument name comes from `./contract.ts`, which
 * makes them on the spec's behalf (the T2-201 / T3-101 precedent). A rename is a
 * one-line change there, not a hunt through this file. What is not negotiable is
 * the behaviour graded around them: SHP-01, SHP-03, SHP-04.
 *
 * refs specs/003-shop-tools (SHP-01, SHP-03, SHP-04),
 * specs/002-montero-garage (SHR-05..09)
 */
import { describe, expect, it } from "vitest";
import { CONTRACT_SCHEMA, testReceiptPath } from "../garage/contract.ts";
import {
  createOwnedFixture,
  detectLiveStack,
  liveTitle,
  provisionScenario,
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
  tableGrantIssues,
} from "../garage/rules.ts";
import {
  createdTables,
  enablesRls,
  forcesRls,
  functions,
  grants,
  migrationSql,
  privilegeVerdict,
  type FunctionDefinition,
} from "../garage/sql.ts";
import {
  bindGrant,
  dropAuthedActor,
  issueNamedGrant,
  makeAuthedActor,
  rosterHasVehicle,
} from "./fixtures.ts";
import {
  ACCEPT_SHOP_INVITE_ARGUMENTS,
  ACCEPT_SHOP_INVITE_FUNCTION,
  CREATE_SHOP_ARGUMENTS,
  CREATE_SHOP_FUNCTION,
  INVITE_TO_SHOP_ARGUMENTS,
  INVITE_TO_SHOP_FUNCTION,
  SHOPS_TABLE,
  SHOP_ACCOUNT_ONLY_FUNCTIONS,
  SHOP_INVITES_TABLE,
  SHOP_INVITE_EMAIL_COLUMN,
  SHOP_MEMBERS_TABLE,
  SHOP_ROSTER_ARGUMENTS,
  SHOP_ROSTER_FUNCTION,
  SHOP_VISIBLE_COLUMN,
  shopSeam,
} from "./contract.ts";
import {
  acceptShopInvite,
  createShop,
  inviteIdOf,
  inviteToShop,
  readShopRoster,
  selfJoinAttempt,
} from "./shop-fixtures.ts";

const live = await detectLiveStack();

/** Every new user table this task introduces — RLS is graded on each. */
const SHOP_TABLES = [
  SHOPS_TABLE,
  SHOP_MEMBERS_TABLE,
  SHOP_INVITES_TABLE,
] as const;

/** Assert a T3-202 table exists in the migrations, or throw the seam. */
function requireShopTable(name: string): void {
  const exists = createdTables(migrationSql()).some(
    (table) => table.name === name
  );
  if (!exists) {
    throw shopSeam(
      `no table named ${CONTRACT_SCHEMA}.${name} exists in supabase/migrations/`
    );
  }
}

/**
 * The one T3-202 routine bearing `name` in `public`, or the seam.
 *
 * By schema **and** name (`isContractRoutine`), for the PR #74 reason: a
 * `private.shop_roster` is a different function with a different ACL, and a
 * comparison on the bare name cannot tell them apart. More than one match is a
 * finding of its own — an overload where the contract expects one routine.
 */
function requireShopRoutine(name: string): FunctionDefinition {
  const found = functions(migrationSql()).filter((routine) =>
    isContractRoutine(routine, name)
  );
  if (found.length === 0) {
    throw shopSeam(
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
 * Tier A — the schema, the grants, and the routine bodies T3-202 ships. Each
 * fails today with the T3-202 seam or a named absence.
 * ====================================================================== */

describe("the membership tables ship with row-level security (SHP-01)", () => {
  it.fails.each(SHOP_TABLES)(
    "%s enables AND forces row level security",
    (table) => {
      // AGENTS.md, Boundaries: "every user table ships with row-level security
      // proven by graders before content flows." `enable` alone exempts the
      // table owner (which Supabase migrations run as); `force` closes it. Both
      // are required, and they are graded separately because `force` is the one
      // most often missed.
      requireShopTable(table);
      const sql = migrationSql();
      expect(enablesRls(sql, table), `${table} does not enable RLS`).toBe(true);
      expect(forcesRls(sql, table), `${table} does not force RLS`).toBe(true);
    }
  );

  it.fails("no anonymous role reaches any membership table", () => {
    // The whole membership surface is account-only (spec §1). `tableGrantIssues`
    // flags anon holding anything, and — the "unknown is not zero" hazard —
    // flags a table whose inherited anon privileges are never revoked (Supabase
    // grants on `public` by default), which is as much a hole as an explicit
    // grant.
    for (const table of SHOP_TABLES) requireShopTable(table);
    expect(tableGrantIssues(migrationSql(), SHOP_TABLES)).toEqual([]);
  });
});

describe("membership is invite-only: no open join (SHP-01)", () => {
  it.fails("authenticated holds no direct insert on shop_members", () => {
    // The structural floor under "there is no path for an account to add itself
    // to a shop". A membership row is written only by the security-definer
    // `accept_shop_invite` (which first consults a matching invite) — the same
    // definer-RPC write posture 002/003 give `shares`. So `authenticated` must
    // hold *no* direct `insert` here:
    //   - "granted" is an open join by policy;
    //   - "unknown" is an open join by default — nothing revoked the privilege
    //     Supabase grants on `public`, so the door is open and merely unlatched.
    // Only "none" (explicitly revoked / never granted-and-known) is safe.
    requireShopTable(SHOP_MEMBERS_TABLE);
    const verdict = privilegeVerdict(
      grants(migrationSql()),
      `${CONTRACT_SCHEMA}.${SHOP_MEMBERS_TABLE}`,
      "authenticated",
      "insert"
    );
    expect(
      verdict,
      `authenticated can insert into ${SHOP_MEMBERS_TABLE} (verdict: ${verdict}) ` +
        `— membership must be written only by ${ACCEPT_SHOP_INVITE_FUNCTION}`
    ).toBe("none");
  });

  it.fails(
    "accept_shop_invite reads the invite before writing the membership",
    () => {
      // "Membership comes only from an accepted invite." The body must consult the
      // invite (the addressee — `invitee_email` / the invites table) *and* write
      // the membership (`shop_members`). An accept that never reads the invite
      // admits whoever calls it; one that never writes shop_members admits nobody.
      // The email match itself is proved on the wire in Tier B; this pins the two
      // seams it needs — the same shape roster.test.ts pins for `bind_share_grant`.
      const accept = requireShopRoutine(ACCEPT_SHOP_INVITE_FUNCTION);
      expect(
        accept.body,
        `${ACCEPT_SHOP_INVITE_FUNCTION} never consults the invite`
      ).toMatch(
        new RegExp(`${SHOP_INVITES_TABLE}|${SHOP_INVITE_EMAIL_COLUMN}`)
      );
      expect(
        accept.body,
        `${ACCEPT_SHOP_INVITE_FUNCTION} never writes ${SHOP_MEMBERS_TABLE}`
      ).toContain(SHOP_MEMBERS_TABLE);
      expect(
        accept.body,
        `${ACCEPT_SHOP_INVITE_FUNCTION} never checks the caller is the addressee`
      ).toMatch(/auth\.email\(\)/);
    }
  );

  it.fails("invite_to_shop restricts inviting to an existing member", () => {
    // SHP-01: "Membership is by invitation from an existing member." An invite
    // routine that never consults `shop_members` lets any account invite into
    // any shop — a second open-join route wearing the invite path's clothes.
    const invite = requireShopRoutine(INVITE_TO_SHOP_FUNCTION);
    expect(
      invite.body,
      `${INVITE_TO_SHOP_FUNCTION} never checks the inviter's membership`
    ).toContain(SHOP_MEMBERS_TABLE);
    expect(invite.body).toMatch(/auth\.uid\(\)/);
  });
});

describe("the membership RPCs exist with their pinned signatures (SHP-01)", () => {
  it.fails(`ships ${CONTRACT_SCHEMA}.${CREATE_SHOP_FUNCTION}`, () => {
    const create = requireShopRoutine(CREATE_SHOP_FUNCTION);
    for (const name of CREATE_SHOP_ARGUMENTS) {
      expect(
        create.argNames,
        `${CREATE_SHOP_FUNCTION} missing ${name}`
      ).toContain(name);
    }
  });

  it.fails(`ships ${CONTRACT_SCHEMA}.${INVITE_TO_SHOP_FUNCTION}`, () => {
    const invite = requireShopRoutine(INVITE_TO_SHOP_FUNCTION);
    for (const name of INVITE_TO_SHOP_ARGUMENTS) {
      expect(
        invite.argNames,
        `${INVITE_TO_SHOP_FUNCTION} missing ${name}`
      ).toContain(name);
    }
  });

  it.fails(`ships ${CONTRACT_SCHEMA}.${ACCEPT_SHOP_INVITE_FUNCTION}`, () => {
    const accept = requireShopRoutine(ACCEPT_SHOP_INVITE_FUNCTION);
    for (const name of ACCEPT_SHOP_INVITE_ARGUMENTS) {
      expect(
        accept.argNames,
        `${ACCEPT_SHOP_INVITE_FUNCTION} missing ${name}`
      ).toContain(name);
    }
  });

  it.fails(`ships ${CONTRACT_SCHEMA}.${SHOP_ROSTER_FUNCTION}, per shop`, () => {
    const roster = requireShopRoutine(SHOP_ROSTER_FUNCTION);
    for (const name of SHOP_ROSTER_ARGUMENTS) {
      expect(
        roster.argNames,
        `${SHOP_ROSTER_FUNCTION} missing ${name}`
      ).toContain(name);
    }
  });
});

describe("the shop surface is account-only, and reachable by an account (spec §1)", () => {
  it.fails("no shop routine is reachable without an account", () => {
    // §1: "the accountless path is read-only because it has no auth.uid()."
    // Creating a shop, inviting, accepting, and the shop roster are all things
    // you can only do *as* an account, so an anon/public caller holds no
    // execute on any of them. An "unknown" verdict counts as reachable
    // (Postgres grants execute to PUBLIC by default), so this also catches a
    // forgotten `revoke`.
    const state = grants(migrationSql());
    const reachable = SHOP_ACCOUNT_ONLY_FUNCTIONS.filter((name) =>
      isAnonExecutable(state, requireShopRoutine(name))
    );
    expect(reachable).toEqual([]);
  });

  it.fails("every shop routine is reachable by an authenticated caller", () => {
    // The other direction, so "not anon" is not satisfied by a routine nobody
    // can reach at all — a closed door nobody can open is as broken as one that
    // will not shut.
    const state = grants(migrationSql());
    const unreachable = SHOP_ACCOUNT_ONLY_FUNCTIONS.filter(
      (name) =>
        privilegeVerdict(
          state,
          requireShopRoutine(name).identity,
          "authenticated",
          "execute"
        ) !== "granted"
    );
    expect(unreachable).toEqual([]);
  });

  it.fails("every security-definer shop routine pins search_path = ''", () => {
    // A definer routine resolves unqualified names through the caller's search
    // path; `set search_path = ''` forces every name schema-qualified. Reused
    // 002 rule, scoped to these routines — an invoker routine is not required to
    // set one, which is why this filters the rule's findings by identity.
    const issues = definerSearchPathIssues(migrationSql());
    for (const name of SHOP_ACCOUNT_ONLY_FUNCTIONS) {
      const routine = requireShopRoutine(name);
      expect(
        issues.filter((issue) => issue.includes(routine.identity)),
        `${routine.identity} search_path`
      ).toEqual([]);
    }
  });
});

describe("the shop roster returns exactly the shop's live shop-visible grants (SHP-03, SHP-04)", () => {
  it.fails(
    "shop_roster consults is_shop_visible, shop_members, and the caller",
    () => {
      // The SHP-04 isolation floor, structurally: a roster that never reads
      // `is_shop_visible` cannot exclude an individual grant, one that never reads
      // `shop_members` cannot scope to a shop, and one that never reads
      // `auth.uid()` cannot gate on the caller's own membership — any of the three
      // would hand a member grants they must not see. The behaviour is proved in
      // Tier B; this is the cheap check that fails on the merge path.
      const roster = requireShopRoutine(SHOP_ROSTER_FUNCTION);
      expect(
        roster.body,
        `${SHOP_ROSTER_FUNCTION} never reads ${SHOP_VISIBLE_COLUMN} — it cannot ` +
          `exclude individual grants`
      ).toContain(SHOP_VISIBLE_COLUMN);
      expect(
        roster.body,
        `${SHOP_ROSTER_FUNCTION} never reads ${SHOP_MEMBERS_TABLE} — it cannot ` +
          `scope to one shop`
      ).toContain(SHOP_MEMBERS_TABLE);
      expect(roster.body).toMatch(/auth\.uid\(\)/);
    }
  );

  it.fails(
    "shop_roster tests revoked_at — a revoked grant leaves the shop roster",
    () => {
      // The likeliest defect: a roster that never re-reads revoked_at, so a
      // revoked grant lingers for a whole shop. 002's `revocationCheckIssues` is
      // exactly this question, one surface over.
      expect(
        revocationCheckIssues(requireShopRoutine(SHOP_ROSTER_FUNCTION))
      ).toEqual([]);
    }
  );

  it.fails(
    "shop_roster tests expires_at — an expired grant leaves the shop roster",
    () => {
      expect(
        expiryCheckIssues(requireShopRoutine(SHOP_ROSTER_FUNCTION))
      ).toEqual([]);
    }
  );
});

/* =========================================================================
 * Tier B — behavioural. The half that actually proves invite-only membership,
 * the absence of a self-join, and roster isolation on the wire. Marked it.fails
 * so a pre-T3-202 live run reports expected failures, not errors; skipped
 * entirely when no local stack is present.
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

describe.skipIf(!live.available)(
  liveTitle(
    "SHP-01 — membership is by invitation only, with no open join",
    live
  ),
  () => {
    it.fails.each([
      ["the addressee accepts and becomes a member", true],
      ["a stranger holding the invite id cannot accept it", false],
    ] as const)("%s", async (_label, callerIsAddressee) => {
      // Invite-only, as a two-row boundary on the one variable that decides it:
      // whether the caller is the account the invite was addressed to. The
      // invite is always addressed to the mechanic; the caller is the mechanic
      // (accepts) or the stranger (refused).
      const scenario = await provisionScenario(stackOf(live));
      const owner = await makeAuthedActor(scenario, "o");
      const mechanic = await makeAuthedActor(scenario, "m");
      const stranger = await makeAuthedActor(scenario, "s");
      try {
        const { shopId } = await createShop(scenario, owner, "TEST-SHOP-alpha");
        const invited = await inviteToShop(
          scenario,
          owner,
          shopId,
          mechanic.email as string
        );
        expect(invited.ok).toBe(true);
        const inviteId = inviteIdOf(invited);
        expect(inviteId).not.toBeNull();

        const caller = callerIsAddressee ? mechanic : stranger;
        const accepted = await acceptShopInvite(
          scenario,
          caller,
          inviteId as string
        );
        expect(accepted.ok).toBe(callerIsAddressee);
      } finally {
        await dropAuthedActor(scenario, owner);
        await dropAuthedActor(scenario, mechanic);
        await dropAuthedActor(scenario, stranger);
        await teardownScenario(scenario);
      }
    });

    it.fails(
      "a non-member cannot write its own membership row (no open join)",
      async () => {
        // The absence of a self-join route, proved rather than asserted: a
        // stranger tries to insert its own `shop_members` row directly and is
        // refused. The positive control is the whole point of the test — the same
        // stranger, once invited and accepted, IS a member and can then invite a
        // third account (a capability SHP-01 reserves for members). So the refusal
        // above is "no open join", not "membership is broken for everyone".
        const scenario = await provisionScenario(stackOf(live));
        const owner = await makeAuthedActor(scenario, "o");
        const stranger = await makeAuthedActor(scenario, "s");
        const third = await makeAuthedActor(scenario, "t");
        try {
          const { shopId } = await createShop(
            scenario,
            owner,
            "TEST-SHOP-beta"
          );

          // No invite: a direct self-insert must be refused.
          const openJoin = await selfJoinAttempt(scenario, stranger, shopId);
          expect(openJoin.ok).toBe(false);
          // And the stranger, still a non-member, cannot invite either.
          const invalidInvite = await inviteToShop(
            scenario,
            stranger,
            shopId,
            third.email as string
          );
          expect(invalidInvite.ok).toBe(false);

          // Positive control: invited + accepted, the stranger becomes a member
          // and can now invite the third account.
          const invited = await inviteToShop(
            scenario,
            owner,
            shopId,
            stranger.email as string
          );
          expect(invited.ok).toBe(true);
          expect(
            (
              await acceptShopInvite(
                scenario,
                stranger,
                inviteIdOf(invited) as string
              )
            ).ok
          ).toBe(true);
          const memberInvite = await inviteToShop(
            scenario,
            stranger,
            shopId,
            third.email as string
          );
          expect(memberInvite.ok).toBe(true);
        } finally {
          await dropAuthedActor(scenario, owner);
          await dropAuthedActor(scenario, stranger);
          await dropAuthedActor(scenario, third);
          await teardownScenario(scenario);
        }
      }
    );
  }
);

describe.skipIf(!live.available)(
  liveTitle(
    "SHP-03 / SHP-04 — a member sees exactly the shop's grants and no others",
    live
  ),
  () => {
    /**
     * A shop with two members (M1 the reader, M2 the shopmate), each an
     * authenticated mechanic account, plus owner A who issues the grants.
     */
    async function shopWithTwoMembers(scenario: Scenario) {
      const m1 = await makeAuthedActor(scenario, "m");
      const m2 = await makeAuthedActor(scenario, "p");
      const { shopId } = await createShop(scenario, m1, "TEST-SHOP-gamma");
      const invited = await inviteToShop(
        scenario,
        m1,
        shopId,
        m2.email as string
      );
      if (!invited.ok)
        throw shopSeam(`invite_to_shop answered ${invited.status}`);
      const accepted = await acceptShopInvite(
        scenario,
        m2,
        inviteIdOf(invited) as string
      );
      if (!accepted.ok) {
        throw shopSeam(`accept_shop_invite answered ${accepted.status}`);
      }
      return { m1, m2, shopId };
    }

    it.fails(
      "a shopmate's shop-visible grant appears on the shop roster (SHP-03)",
      async () => {
        const scenario = await provisionScenario(stackOf(live));
        const { m1, m2, shopId } = await shopWithTwoMembers(scenario);
        try {
          const vehicleId = await ownedVehicleId(scenario);
          const grant = await issueNamedGrant(
            scenario,
            scenario.ownerA,
            vehicleId,
            {
              granteeEmail: m2.email,
              shopVisible: true,
            }
          );
          expect((await bindGrant(scenario, m2, grant.token)).ok).toBe(true);

          const roster = await readShopRoster(scenario, m1, shopId);
          expect(roster.ok).toBe(true);
          expect(rosterHasVehicle(roster, vehicleId)).toBe(true);
        } finally {
          await dropAuthedActor(scenario, m1);
          await dropAuthedActor(scenario, m2);
          await teardownScenario(scenario);
        }
      }
    );

    it.fails(
      "a shopmate's individual grant is withheld from the shop roster (SHP-04)",
      async () => {
        // SHP-04: "Consent to share with a business is not implied by consent to
        // share with a person who works there." An individual grant
        // (is_shop_visible = false) bound to M2 must not reach M1 through the shop
        // roster. The positive control gives M2 a *second*, shop-visible grant on
        // another vehicle, so the roster is proven to work — M1 sees the
        // shop-visible one and not the individual one is the isolation asserted.
        const scenario = await provisionScenario(stackOf(live));
        const { m1, m2, shopId } = await shopWithTwoMembers(scenario);
        try {
          const individualVehicle = await ownedVehicleId(scenario, "1");
          const sharedVehicle = await ownedVehicleId(scenario, "2");

          const individual = await issueNamedGrant(
            scenario,
            scenario.ownerA,
            individualVehicle,
            { granteeEmail: m2.email, shopVisible: false }
          );
          const shared = await issueNamedGrant(
            scenario,
            scenario.ownerA,
            sharedVehicle,
            { granteeEmail: m2.email, shopVisible: true }
          );
          expect((await bindGrant(scenario, m2, individual.token)).ok).toBe(
            true
          );
          expect((await bindGrant(scenario, m2, shared.token)).ok).toBe(true);

          const roster = await readShopRoster(scenario, m1, shopId);
          expect(roster.ok).toBe(true);
          // The roster works (the shop-visible grant is on it) …
          expect(rosterHasVehicle(roster, sharedVehicle)).toBe(true);
          // … and yet the individual grant is withheld.
          expect(rosterHasVehicle(roster, individualVehicle)).toBe(false);
        } finally {
          await dropAuthedActor(scenario, m1);
          await dropAuthedActor(scenario, m2);
          await teardownScenario(scenario);
        }
      }
    );

    it.fails(
      "another shop's shop-visible grant never reaches this shop's roster",
      async () => {
        // "No others": a grant held by a member of a *different* shop, even
        // shop-visible, is not on this shop's roster. The positive control is this
        // shop's own shop-visible grant, which the reader does see — so "not on the
        // roster" is real isolation, not an empty roster.
        const scenario = await provisionScenario(stackOf(live));
        const { m1, m2, shopId } = await shopWithTwoMembers(scenario);
        const outsider = await makeAuthedActor(scenario, "x");
        try {
          // A second shop, wholly separate, with `outsider` as its member.
          const { shopId: otherShopId } = await createShop(
            scenario,
            outsider,
            "TEST-SHOP-delta"
          );
          expect(otherShopId).not.toBe(shopId);

          const ourVehicle = await ownedVehicleId(scenario, "1");
          const theirVehicle = await ownedVehicleId(scenario, "2");
          const ours = await issueNamedGrant(
            scenario,
            scenario.ownerA,
            ourVehicle,
            {
              granteeEmail: m2.email,
              shopVisible: true,
            }
          );
          const theirs = await issueNamedGrant(
            scenario,
            scenario.ownerA,
            theirVehicle,
            { granteeEmail: outsider.email, shopVisible: true }
          );
          expect((await bindGrant(scenario, m2, ours.token)).ok).toBe(true);
          expect((await bindGrant(scenario, outsider, theirs.token)).ok).toBe(
            true
          );

          const roster = await readShopRoster(scenario, m1, shopId);
          expect(roster.ok).toBe(true);
          expect(rosterHasVehicle(roster, ourVehicle)).toBe(true);
          expect(rosterHasVehicle(roster, theirVehicle)).toBe(false);
        } finally {
          await dropAuthedActor(scenario, m1);
          await dropAuthedActor(scenario, m2);
          await dropAuthedActor(scenario, outsider);
          await teardownScenario(scenario);
        }
      }
    );

    it.fails("a non-member cannot read a shop's roster", async () => {
      // A stranger who is in no shop cannot read this shop's roster: either the
      // call is refused, or it returns nothing — a leak is a breach either way,
      // so the assertion is "the shop-visible vehicle is not visible to the
      // stranger", regardless of status. The positive control is M1, a member,
      // reading the same roster and seeing the vehicle — so "the stranger sees
      // nothing" is isolation, not a roster that is empty for everyone.
      const scenario = await provisionScenario(stackOf(live));
      const { m1, m2, shopId } = await shopWithTwoMembers(scenario);
      const stranger = await makeAuthedActor(scenario, "s");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueNamedGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          {
            granteeEmail: m2.email,
            shopVisible: true,
          }
        );
        expect((await bindGrant(scenario, m2, grant.token)).ok).toBe(true);

        const strangerView = await readShopRoster(scenario, stranger, shopId);
        // A refusal has no rows; an "ok but empty" also has no rows. Either is
        // correct — what must never happen is the vehicle appearing.
        expect(rosterHasVehicle(strangerView, vehicleId)).toBe(false);

        const memberView = await readShopRoster(scenario, m1, shopId);
        expect(memberView.ok).toBe(true);
        expect(rosterHasVehicle(memberView, vehicleId)).toBe(true);
      } finally {
        await dropAuthedActor(scenario, m1);
        await dropAuthedActor(scenario, m2);
        await dropAuthedActor(scenario, stranger);
        await teardownScenario(scenario);
      }
    });
  }
);
