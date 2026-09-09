/**
 * Graders — **propose-and-accept, T3-301 [TEST]**, activated by **T3-302
 * [PLATFORM]** (spec 003, the AGENTS.md §7.1 writable-surface carve-out).
 *
 * This is the accounts / RLS / provenance boundary — the load-bearing
 * correctness class, and the narrowest carve-out the owner authorized — so it
 * is graded adversarially: every guarantee is bitten by its own grader, every
 * negative is proved real rather than merely spelled, and every negative has a
 * positive control in the same run.
 *
 * | guarantee (PRO-01..06 / 003 §7.1) | Tier A | Tier B |
 * |---|---|---|
 * | a proposal is inert until the owner accepts; acceptance is the write (PRO-02) | `accept_proposal` is the one records-writing routine, security-definer, keyed on `auth.uid()` = the proposal's owner | the owner accepts → exactly one record with provenance; a mechanic cannot write records or accept their own proposal |
 * | it cannot be written into `records`; no pending record (PRO-03) | `records` gains no state/status column; its insert path stays owner-only | — |
 * | it needs a live `can_propose` grant (PRO-01) | `shares.can_propose` exists; the proposer policy checks a live grant | a `can_propose` grant admits a proposal; a grant without it does not |
 * | only the author and the owner see it (PRO-04) | the two policies are `auth.uid()`-keyed, owner-scoped, non-anon | author and owner see it; a third mechanic does not |
 * | revocation kills submit and withdraw; pending stays rejectable (PRO-06) | the proposer policy's check rides on `revoked_at`/`expires_at` | after revocation: no submit, no withdraw; the owner can still reject; an accepted record is unaffected |
 *
 * ## Two tiers, the same discipline as `membership.test.ts` / `roster.test.ts`
 *
 * **Tier A** parses the migration text, runs everywhere, on the merge path.
 * Every Tier-A grader that describes something T3-302 BUILDS is `it.fails`: it
 * fails **today**, for the right reason (the T3-302 seam — a named
 * "table/function/column absent" — never an import error), and T3-302 activates
 * it by deleting exactly that `.fails` line. The PRO-03 / PRO-05 **absence**
 * guards are unmarked: they must pass today and keep passing (a record must
 * never gain a pending-state or site-verified flag), and each carries a
 * mutation control proving it bites.
 *
 * **Tier B** talks to a real local stack (`describe.skipIf(!live.available)`),
 * because "a mechanic cannot forge an accepted record" and "the individual
 * proposal is withheld from a third mechanic" are statements about behaviour no
 * amount of reading SQL proves. It is `it.fails`, so a deliberate `GARAGE_LIVE=1`
 * run before T3-302 lands reports the proofs as expected failures rather than
 * errors; T3-302 deletes those markers too. Under plain `npm test` the whole
 * tier skips with a named reason, so it never reddens the merge gate.
 *
 * ## Names are decisions, and they live in one file
 *
 * Every table/column/function/argument name comes from `./contract.ts`, which
 * makes them on the spec's behalf (the T2-201 / T3-101 / T3-201 precedent). A
 * rename is a one-line change there. What is not negotiable is the behaviour
 * graded around them: PRO-01..06.
 *
 * refs specs/003-shop-tools (PRO-01..06), specs/002-montero-garage (SHR-05..09,
 * ACC-03), AGENTS.md (Facts — testimony; Boundaries — §7.1 carve-out)
 */
import { describe, expect, it } from "vitest";
import {
  CONTRACT_SCHEMA,
  GRANT_EXPIRY_COLUMN,
  GRANT_REVOCATION_COLUMN,
  SHARED_USER_TABLES,
  SHARE_CREATE_FUNCTION,
  testReceiptPath,
} from "../garage/contract.ts";
import {
  createOwnedFixture,
  detectLiveStack,
  liveTitle,
  provisionScenario,
  rowCount,
  stackOf,
  teardownScenario,
  type Scenario,
} from "../garage/harness.ts";
import {
  authUidComparands,
  definerSearchPathIssues,
  effectiveCheck,
  isAnonExecutable,
  isContractRoutine,
  sharedTableCascadeIssues,
  tableGrantIssues,
  userTablePolicyIssues,
} from "../garage/rules.ts";
import {
  columnDefinitionFor,
  createdTables,
  defaultExpression,
  enablesRls,
  forcesRls,
  foreignKeyFor,
  foreignKeyOnDeleteFor,
  functions,
  grants,
  isNotNullFor,
  migrationSql,
  normalizeSql,
  policies,
  privilegeVerdict,
  type FunctionDefinition,
  type PolicyDefinition,
} from "../garage/sql.ts";
import {
  ACCEPT_PROPOSAL_ARGUMENTS,
  ACCEPT_PROPOSAL_FUNCTION,
  CAN_PROPOSE_COLUMN,
  PROPOSAL_ACCOUNT_ONLY_FUNCTIONS,
  PROPOSAL_COLUMNS,
  PROPOSAL_OWNER_COLUMN,
  PROPOSAL_PROPOSED_BY_COLUMN,
  PROPOSAL_VEHICLE_COLUMN,
  PROPOSALS_TABLE,
  RECORD_ACCEPTED_AT_COLUMN,
  RECORD_FORBIDDEN_STATE_COLUMNS,
  RECORD_FORBIDDEN_VERIFICATION_COLUMNS,
  RECORD_PROPOSAL_SHARE_COLUMN,
  RECORD_PROPOSED_BY_COLUMN,
  RECORD_PROVENANCE_COLUMNS,
  RECORDS_TABLE,
  SHARE_CAN_PROPOSE_ARGUMENT,
  SHARES_TABLE,
  proposalSeam,
} from "./contract.ts";
import { bindGrant, dropAuthedActor, makeAuthedActor } from "./fixtures.ts";
import {
  acceptProposal,
  forgeRecordInsert,
  issueProposeGrant,
  proposalIdOf,
  proposalsInclude,
  readProposals,
  readVehicleRecords,
  rejectProposal,
  revokeGrant,
  submitProposal,
  withdrawProposal,
} from "./proposal-fixtures.ts";

const live = await detectLiveStack();

/* -------------------------------------------------------------------------
 * Seam guards — a Tier-A grader resolves its subject or throws the T3-302 seam,
 * never an `undefined is not an object` or an import error.
 * ---------------------------------------------------------------------- */

/** Assert the `proposals` table exists in the migrations, or throw the seam. */
function requireProposalsTable(): void {
  const exists = createdTables(migrationSql()).some(
    (table) => table.name === PROPOSALS_TABLE
  );
  if (!exists) {
    throw proposalSeam(
      `no table named ${CONTRACT_SCHEMA}.${PROPOSALS_TABLE} exists in ` +
        `supabase/migrations/`
    );
  }
}

/**
 * The one routine bearing `name` in `public`, or the seam. By schema AND name
 * (`isContractRoutine`) for the PR #74 reason; more than one match is its own
 * finding — an overload where the contract expects one.
 */
function requireProposalRoutine(name: string): FunctionDefinition {
  const found = functions(migrationSql()).filter((routine) =>
    isContractRoutine(routine, name)
  );
  if (found.length === 0) {
    throw proposalSeam(
      `no function named ${CONTRACT_SCHEMA}.${name} exists in ` +
        `supabase/migrations/`
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

/** Every policy on the proposals table in `sql`, in force at the end. */
function proposalPoliciesIn(sql: string): PolicyDefinition[] {
  return policies(sql).filter((policy) => policy.table === PROPOSALS_TABLE);
}

/** Every policy on the proposals table, in force at the end of the directory. */
function proposalPolicies(): PolicyDefinition[] {
  return proposalPoliciesIn(migrationSql());
}

/** The proposals policy in `sql` tying a row to `auth.uid()` via `column`. */
function policyKeyedOnIn(
  sql: string,
  column: string
): PolicyDefinition | undefined {
  return proposalPoliciesIn(sql).find((policy) =>
    [policy.usingExpr, policy.withCheckExpr].some(
      (expr) => expr !== null && authUidComparands(expr).includes(column)
    )
  );
}

/** The proposal policy whose predicate ties a row to `auth.uid()` via `column`. */
function policyKeyedOn(column: string): PolicyDefinition | undefined {
  return policyKeyedOnIn(migrationSql(), column);
}

/* -------------------------------------------------------------------------
 * The live-can_propose check, resolved through the proposer policy (PRO-01,
 * PRO-06) — owner ruling 2026-09-09.
 *
 * The check may live INLINE in the proposer policy's predicate, OR in a
 * `security definer` helper the predicate CALLS. The ruling's reason: an inline
 * `exists (select … from shares join vehicles …)` is evaluated under the
 * *caller's* RLS, and `shares`/`vehicles` are owner-scoped `force`-RLS, so a
 * mechanic caller can never satisfy it — PRO-01 ("a holder of a live
 * can_propose grant may submit") would fail outright (the Tier-B positive
 * control at `submitted.ok === false` is exactly that). A `security definer`
 * helper bypasses RLS the way `accept_proposal` and T3-102's mechanic RPCs do.
 * So the grader reads THROUGH the reference rather than demanding the four
 * tokens inline — and it does NOT hard-code the helper's name (that would only
 * move the over-constraint): a function is reachable iff the predicate calls it.
 * ---------------------------------------------------------------------- */

/** The grant-liveness tokens the check must consult, wherever it lives. */
const LIVENESS_TOKENS = [
  SHARES_TABLE,
  CAN_PROPOSE_COLUMN,
  GRANT_REVOCATION_COLUMN,
  GRANT_EXPIRY_COLUMN,
] as const;

/** The proposals policy in `sql` that carries the proposer (submit) path. */
function proposerPolicyIn(sql: string): PolicyDefinition | undefined {
  return policyKeyedOnIn(sql, PROPOSAL_PROPOSED_BY_COLUMN);
}

/** Escape a string for use as a literal inside a `RegExp`. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `true` when `text` mentions every grant-liveness token. */
function carriesLiveness(text: string): boolean {
  return LIVENESS_TOKENS.every((token) => text.includes(token));
}

/**
 * The SQL the proposer policy's live-grant check is reachable through: the
 * policy predicate, PLUS the body of every migration function the predicate
 * calls by name. One level of resolution — the owner-ruled design is a single
 * helper — and no helper name is hard-coded: a function counts as reachable iff
 * the predicate calls it (`name(`, on a word boundary so a `can_propose`
 * *column* is never mistaken for a call).
 */
function reachableLiveness(
  sql: string,
  policy: PolicyDefinition
): {
  readonly text: string;
  readonly inline: boolean;
  readonly livenessHelpers: readonly FunctionDefinition[];
} {
  const predicate = `${policy.usingExpr ?? ""} ${policy.withCheckExpr ?? ""}`;
  const called = functions(sql).filter((fn) =>
    new RegExp(`(^|[^a-z0-9_])${escapeRegExp(fn.name)}\\s*\\(`).test(predicate)
  );
  return {
    text: [predicate, ...called.map((fn) => fn.body)].join(" "),
    inline: carriesLiveness(predicate),
    livenessHelpers: called.filter((fn) => carriesLiveness(fn.body)),
  };
}

/**
 * Findings against the proposer policy's live-can_propose check (PRO-01,
 * PRO-06). The liveness (`shares` + `can_propose` + `revoked_at` + `expires_at`)
 * and the vehicle-owner correlation (the proposal's `vehicle_id` AND `owner_id`,
 * tied into the check as a helper's call args or an inline correlation) must be
 * reachable from the policy; and if the liveness lives in a helper rather than
 * inline, that helper must be `security definer` — a non-definer helper called
 * from an RLS predicate runs under the caller's RLS and reintroduces the exact
 * hole the 2026-09-09 ruling closes.
 *
 * A structural floor only: it cannot prove the helper USES its arguments — the
 * Tier-B PRO-01 proofs below are that behavioural bar. It fails **closed** on a
 * liveness split across two helpers (an exotic design the owner-ruled single
 * helper is not), which is a one-line renegotiation, not a silent pass.
 */
function proposerLivenessIssues(
  sql: string,
  policy: PolicyDefinition
): string[] {
  const reach = reachableLiveness(sql, policy);
  const issues: string[] = [];
  for (const token of LIVENESS_TOKENS) {
    if (!reach.text.includes(token)) {
      issues.push(
        `the live can_propose check never consults \`${token}\` — not inline ` +
          `in the proposer policy, and not in any helper it calls`
      );
    }
  }
  for (const column of [PROPOSAL_VEHICLE_COLUMN, PROPOSAL_OWNER_COLUMN]) {
    if (!reach.text.includes(column)) {
      issues.push(
        `the live-grant check is not correlated to the proposal's ` +
          `\`${column}\` (the vehicle-owner correlation is absent)`
      );
    }
  }
  if (!reach.inline) {
    if (reach.livenessHelpers.length === 0) {
      issues.push(
        `the proposer policy carries no inline live-grant check and calls no ` +
          `helper whose body carries one`
      );
    } else if (!reach.livenessHelpers.some((fn) => fn.securityDefiner)) {
      issues.push(
        `the live-grant helper is not \`security definer\` — called from an ` +
          `RLS predicate it runs under the caller's RLS, so a mechanic can ` +
          `never satisfy it (the exact bug the 2026-09-09 ruling fixes)`
      );
    }
  }
  return issues;
}

/** Commands whose *permissive* policy admits an INSERT (they OR together). */
const INSERT_ADMITTING_COMMANDS = new Set(["insert", "all"]);

/**
 * Proposals policies that admit an INSERT the caller did NOT author — the
 * forgery gap (finding #3). Permissive INSERT policies OR together, so ANY
 * policy that admits an INSERT is a submit path; PRO-01 makes the ONLY
 * legitimate submit path a holder of a live can_propose grant, whose new row is
 * `proposed_by = auth.uid()`. A policy that admits an INSERT without tying the
 * new row's `proposed_by` to the caller (e.g. an owner `for all` whose
 * `with check` only tests `owner_id`) lets the vehicle owner insert a proposal
 * with an arbitrary `proposed_by`, forging a mechanic's authorship and, on
 * acceptance, fabricating the provenance §7.1 and PRO-05 exist to keep honest.
 */
function forgingInsertPolicies(
  policyList: readonly PolicyDefinition[]
): string[] {
  return policyList
    .filter((policy) => {
      if (!policy.permissive) return false; // restrictive only narrows
      if (!INSERT_ADMITTING_COMMANDS.has(policy.command)) return false;
      const check = effectiveCheck(policy);
      const tiesProposer =
        check !== null &&
        authUidComparands(check).includes(PROPOSAL_PROPOSED_BY_COLUMN);
      return !tiesProposer;
    })
    .map((policy) => `${policy.name} (for ${policy.command})`);
}

/* =========================================================================
 * Tier A — the schema, the grants, the policies, and the routine bodies T3-302
 * ships. Each fails today with the T3-302 seam or a named absence.
 * ====================================================================== */

describe("the proposals table ships behind row-level security (PRO-03, PRO-04)", () => {
  it(`${CONTRACT_SCHEMA}.${PROPOSALS_TABLE} is a created table`, () => {
    requireProposalsTable();
  });

  it.each(PROPOSAL_COLUMNS)("proposals.%s is a column", (column) => {
    requireProposalsTable();
    expect(
      columnDefinitionFor(migrationSql(), PROPOSALS_TABLE, column),
      `proposals.${column} is absent`
    ).not.toBeNull();
  });

  it("proposals enables AND forces row level security", () => {
    // `enable` alone exempts the table owner (which migrations run as); `force`
    // closes it. Both required, graded separately because `force` is the one
    // most often missed. AGENTS.md: "every user table ships with RLS."
    requireProposalsTable();
    const sql = migrationSql();
    expect(enablesRls(sql, PROPOSALS_TABLE), "does not enable RLS").toBe(true);
    expect(forcesRls(sql, PROPOSALS_TABLE), "does not force RLS").toBe(true);
  });

  it("no anonymous role reaches the proposals table", () => {
    // A proposal is an authenticated flow (spec §1: "the accountless path is
    // read-only because it has no auth.uid()"). `tableGrantIssues` flags anon
    // holding anything AND — the unknown-is-not-zero hazard — a table whose
    // inherited anon privileges (Supabase grants ALL on `public` by default)
    // are never revoked, which is as much a hole as an explicit grant.
    requireProposalsTable();
    expect(tableGrantIssues(migrationSql(), [PROPOSALS_TABLE])).toEqual([]);
  });

  it("owner_id is on delete cascade to auth.users (ACC-03)", () => {
    requireProposalsTable();
    const fk = foreignKeyFor(
      migrationSql(),
      PROPOSALS_TABLE,
      PROPOSAL_OWNER_COLUMN
    );
    expect(fk, "owner_id has no foreign key").not.toBeNull();
    expect(fk?.target).toContain("users");
    expect(
      foreignKeyOnDeleteFor(
        migrationSql(),
        PROPOSALS_TABLE,
        PROPOSAL_OWNER_COLUMN
      )
    ).toBe("cascade");
  });

  it("proposed_by is on delete cascade to auth.users — a draft dies with its author (ACC-03)", () => {
    requireProposalsTable();
    const fk = foreignKeyFor(
      migrationSql(),
      PROPOSALS_TABLE,
      PROPOSAL_PROPOSED_BY_COLUMN
    );
    expect(fk, "proposed_by has no foreign key").not.toBeNull();
    expect(fk?.target).toContain("users");
    expect(
      foreignKeyOnDeleteFor(
        migrationSql(),
        PROPOSALS_TABLE,
        PROPOSAL_PROPOSED_BY_COLUMN
      )
    ).toBe("cascade");
  });

  it("vehicle_id is on delete cascade to vehicles — a proposal on a gone vehicle is meaningless", () => {
    requireProposalsTable();
    const fk = foreignKeyFor(
      migrationSql(),
      PROPOSALS_TABLE,
      PROPOSAL_VEHICLE_COLUMN
    );
    expect(fk, "vehicle_id has no foreign key").not.toBeNull();
    expect(fk?.target).toContain("vehicles");
    expect(
      foreignKeyOnDeleteFor(
        migrationSql(),
        PROPOSALS_TABLE,
        PROPOSAL_VEHICLE_COLUMN
      )
    ).toBe("cascade");
  });

  it("the shared account-deletion model holds for proposals (both accounts cascade)", () => {
    // The same `sharedTableCascadeIssues` the 002 suite runs, aimed at just
    // the proposals entry: BOTH owner_id and proposed_by must cascade to
    // auth.users, so a pending draft vanishes when either party deletes their
    // account. Passing an explicit list keeps this file from importing the
    // shipped-set default (which excludes a pending table).
    const entry = SHARED_USER_TABLES.find((t) => t.name === PROPOSALS_TABLE);
    if (!entry) {
      throw new Error(
        "proposals is not registered in SHARED_USER_TABLES — T3-301a's " +
          "contract wiring is missing"
      );
    }
    expect(sharedTableCascadeIssues(migrationSql(), [entry])).toEqual([]);
  });
});

describe("proposals is registered as a pending SHARED user table (contract wiring)", () => {
  // Unmarked: proves the accommodation this task added to `tests/garage/
  // contract.ts` is present, so `ungradedTableIssues` will accept `proposals`
  // the day T3-302's migration creates it (and the `it.fails` cascade grader
  // above has an entry to read). If someone removes it, this fails today, not
  // silently on T3-302's merge.
  it("names proposals in SHARED_USER_TABLES, carried pending T3-302", () => {
    const entry = SHARED_USER_TABLES.find((t) => t.name === PROPOSALS_TABLE);
    expect(entry, "proposals missing from SHARED_USER_TABLES").toBeDefined();
    expect(entry?.pending).toBe("T3-302");
    expect([...(entry?.accountCascadeColumns ?? [])]).toEqual([
      PROPOSAL_OWNER_COLUMN,
      PROPOSAL_PROPOSED_BY_COLUMN,
    ]);
  });
});

describe("only the author and the owner can see a proposal (PRO-04)", () => {
  it("every proposals policy is owner-scoped, non-anon, and has a `to` clause", () => {
    // The generic single-owner sweep, aimed at proposals by an explicit list
    // (the task line: "both pass rules.ts unchanged"). It rejects a policy
    // granted to anon/public, one with no `to` clause, one whose predicate is
    // not tied to auth.uid(), and a table with no policy at all.
    requireProposalsTable();
    expect(userTablePolicyIssues(migrationSql(), [PROPOSALS_TABLE])).toEqual(
      []
    );
  });

  it("an owner policy keys the row to owner_id = auth.uid()", () => {
    requireProposalsTable();
    expect(
      policyKeyedOn(PROPOSAL_OWNER_COLUMN),
      "no proposals policy ties a row to the owner via auth.uid()"
    ).toBeDefined();
  });

  it("a proposer policy keys the row to proposed_by = auth.uid()", () => {
    requireProposalsTable();
    expect(
      policyKeyedOn(PROPOSAL_PROPOSED_BY_COLUMN),
      "no proposals policy ties a row to the proposer via auth.uid()"
    ).toBeDefined();
  });

  it("the auth.uid() shape these graders rely on discriminates (mutation control)", () => {
    // Proof the policy-key graders are not decorative: `auth.uid() is not null`
    // MENTIONS auth.uid() but ties no row to the caller — it hands every
    // logged-in user everybody's proposals, the F1 hole. `authUidComparands`
    // must return the column for an equality and nothing for the tautology.
    expect(authUidComparands("owner_id = auth.uid()")).toEqual(["owner_id"]);
    expect(authUidComparands("proposed_by = auth.uid()")).toEqual([
      "proposed_by",
    ]);
    expect(authUidComparands("auth.uid() is not null")).toEqual([]);
    expect(authUidComparands("true")).toEqual([]);
  });

  it("userTablePolicyIssues bites a broadened proposals policy (mutation control)", () => {
    // A tempted `using (owner_id = auth.uid() or true)` — the shortcut that
    // opens every proposal to everyone — must be caught, and the correct pair
    // must pass, on synthetic DDL so the corpus is graded without a migration.
    const correct =
      `create table ${CONTRACT_SCHEMA}.${PROPOSALS_TABLE} ` +
      `(id uuid primary key, owner_id uuid, proposed_by uuid);\n` +
      `create policy "owner" on ${CONTRACT_SCHEMA}.${PROPOSALS_TABLE} ` +
      `for all to authenticated using (owner_id = auth.uid()) ` +
      `with check (owner_id = auth.uid());\n` +
      `create policy "proposer" on ${CONTRACT_SCHEMA}.${PROPOSALS_TABLE} ` +
      `for all to authenticated using (proposed_by = auth.uid()) ` +
      `with check (proposed_by = auth.uid());`;
    const broadened = correct.replace(
      "using (owner_id = auth.uid())",
      "using (owner_id = auth.uid() or true)"
    );
    expect(userTablePolicyIssues(correct, [PROPOSALS_TABLE])).toEqual([]);
    expect(
      userTablePolicyIssues(broadened, [PROPOSALS_TABLE]).length
    ).toBeGreaterThan(0);
  });
});

describe("the proposal write path requires a live can_propose grant (PRO-01, PRO-06)", () => {
  it(`${SHARES_TABLE}.${CAN_PROPOSE_COLUMN} is a boolean, not-null, default false capability`, () => {
    // SHR-05: a grant's powers are explicit capability columns, never a
    // branch on `kind`. SHR-01: private by default — the capability is closed
    // unless the owner opens it.
    const def = columnDefinitionFor(
      migrationSql(),
      SHARES_TABLE,
      CAN_PROPOSE_COLUMN
    );
    expect(
      def,
      `${SHARES_TABLE}.${CAN_PROPOSE_COLUMN} is absent`
    ).not.toBeNull();
    expect(/bool/.test(def?.definition ?? ""), "not boolean").toBe(true);
    expect(
      isNotNullFor(migrationSql(), SHARES_TABLE, CAN_PROPOSE_COLUMN),
      "not `not null`"
    ).toBe(true);
    expect(
      defaultExpression(def?.definition ?? ""),
      "default is not false"
    ).toBe("false");
  });

  it(`${SHARE_CREATE_FUNCTION} takes ${SHARE_CAN_PROPOSE_ARGUMENT}, and stays one routine`, () => {
    // Adding a defaulted argument changes the routine's identity, so T3-302
    // must drop + recreate (and re-grant execute), leaving exactly one
    // overload — the same discipline T3-102 used for its two arguments.
    const found = functions(migrationSql()).filter((routine) =>
      isContractRoutine(routine, SHARE_CREATE_FUNCTION)
    );
    expect(found.length, `${SHARE_CREATE_FUNCTION} overload count`).toBe(1);
    expect(found[0]?.argNames ?? []).toContain(SHARE_CAN_PROPOSE_ARGUMENT);
  });

  it("the proposer policy consults a live can_propose grant — inline, or via a helper it calls", () => {
    // PRO-01 + PRO-06's structural floor, corrected by the 2026-09-09 ruling:
    // the mechanic's submit path must consult the `shares` grant, its
    // `can_propose` capability, and BOTH liveness columns, correlated to the
    // proposal's vehicle and owner — a check that skips `revoked_at`/
    // `expires_at` is a path a revoked grant still opens. The check may be
    // inline OR in a `security definer` helper the policy calls; the grader
    // reads THROUGH the reference (see `reachableLiveness`) so it does not
    // force the inline `exists (select … from shares …)` a mechanic can never
    // satisfy under RLS — the very defect this ruling fixes. The Tier-B
    // PRO-01 proofs are the behavioural bar this structural floor stands on.
    requireProposalsTable();
    const policy = proposerPolicyIn(migrationSql());
    if (!policy) {
      throw proposalSeam(
        `no proposer-scoped policy on ${PROPOSALS_TABLE} to carry the ` +
          `live-grant check`
      );
    }
    expect(proposerLivenessIssues(migrationSql(), policy)).toEqual([]);
  });

  /** A proposer policy whose live-grant check lives in a named helper, built
   * from synthetic DDL so each mutation control varies exactly one thing. Fake
   * objects only (the reserved `test_` namespace); no migration is read. */
  const helperProposals = (opts: {
    readonly helperBody: string;
    readonly definer: boolean;
    readonly callsHelper: boolean;
  }): string =>
    `create table public.${PROPOSALS_TABLE} ` +
    `(id uuid primary key, ${PROPOSAL_OWNER_COLUMN} uuid, ` +
    `${PROPOSAL_PROPOSED_BY_COLUMN} uuid, ${PROPOSAL_VEHICLE_COLUMN} uuid);\n` +
    `create function public.test_live_grant(p_vehicle_id uuid, p_owner_id uuid) ` +
    `returns boolean language sql ` +
    `${opts.definer ? "security definer set search_path = '' " : ""}` +
    `as $$ select exists (${opts.helperBody}) $$;\n` +
    `create policy "proposer" on public.${PROPOSALS_TABLE} ` +
    `for all to authenticated ` +
    `using (${PROPOSAL_PROPOSED_BY_COLUMN} = auth.uid()) ` +
    `with check (${PROPOSAL_PROPOSED_BY_COLUMN} = auth.uid()` +
    (opts.callsHelper
      ? ` and public.test_live_grant(${PROPOSAL_VEHICLE_COLUMN}, ` +
        `${PROPOSAL_OWNER_COLUMN}))`
      : `)`);

  const fullLiveness =
    `select 1 from public.${SHARES_TABLE} s ` +
    `join public.vehicles v on v.id = s.${PROPOSAL_VEHICLE_COLUMN} ` +
    `where s.${PROPOSAL_VEHICLE_COLUMN} = p_vehicle_id ` +
    `and v.${PROPOSAL_OWNER_COLUMN} = p_owner_id ` +
    `and s.bound_account_id = auth.uid() and s.${CAN_PROPOSE_COLUMN} ` +
    `and s.${GRANT_REVOCATION_COLUMN} is null ` +
    `and s.${GRANT_EXPIRY_COLUMN} > now()`;

  const staleLiveness =
    `select 1 from public.${SHARES_TABLE} s ` +
    `where s.${PROPOSAL_VEHICLE_COLUMN} = p_vehicle_id ` +
    `and s.bound_account_id = auth.uid() and s.${CAN_PROPOSE_COLUMN}`;

  it("the live-grant check accepts a definer helper and bites missing liveness / a non-definer helper (mutation control)", () => {
    // (a) a `security definer` helper carrying FULL liveness → accepted.
    const good = normalizeSql(
      helperProposals({
        helperBody: fullLiveness,
        definer: true,
        callsHelper: true,
      })
    );
    const goodPolicy = proposerPolicyIn(good);
    expect(goodPolicy, "(a) fixture has no proposer policy").toBeDefined();
    expect(
      proposerLivenessIssues(good, goodPolicy as PolicyDefinition),
      "(a) a definer helper with full liveness must be accepted"
    ).toEqual([]);

    // (b) a helper MISSING `revoked_at`/`expires_at` → rejected, and the
    // finding NAMES the columns it is missing (assert the reason, not the throw).
    const stale = normalizeSql(
      helperProposals({
        helperBody: staleLiveness,
        definer: true,
        callsHelper: true,
      })
    );
    const staleIssues = proposerLivenessIssues(
      stale,
      proposerPolicyIn(stale) as PolicyDefinition
    );
    expect(
      staleIssues.some((i) => i.includes(GRANT_REVOCATION_COLUMN)),
      "(b) a helper missing revoked_at must be rejected for that reason"
    ).toBe(true);
    expect(
      staleIssues.some((i) => i.includes(GRANT_EXPIRY_COLUMN)),
      "(b) a helper missing expires_at must be rejected for that reason"
    ).toBe(true);

    // (c) a proposer policy that carries NEITHER an inline check NOR a
    // live-grant helper it calls → rejected (the helper exists but is uncalled).
    const bare = normalizeSql(
      helperProposals({
        helperBody: fullLiveness,
        definer: true,
        callsHelper: false,
      })
    );
    expect(
      proposerLivenessIssues(bare, proposerPolicyIn(bare) as PolicyDefinition)
        .length,
      "(c) a policy reaching no live-grant check must be rejected"
    ).toBeGreaterThan(0);

    // (d) FULL liveness in a helper that is NOT `security definer` → rejected:
    // called from an RLS predicate it runs under the caller's RLS and
    // reintroduces the exact bug the ruling fixes.
    const invoker = normalizeSql(
      helperProposals({
        helperBody: fullLiveness,
        definer: false,
        callsHelper: true,
      })
    );
    const invokerIssues = proposerLivenessIssues(
      invoker,
      proposerPolicyIn(invoker) as PolicyDefinition
    );
    expect(
      invokerIssues.some((i) => i.includes("security definer")),
      "(d) a non-definer liveness helper must be rejected for that reason"
    ).toBe(true);
  });

  it("an inline live-grant check is accepted too (mutation control)", () => {
    // The other accepted spelling: the four liveness tokens + the vehicle-owner
    // correlation inline in the predicate, no helper. Tier A grades the
    // spelling; Tier B grades whether a mechanic can actually satisfy it.
    const inline = normalizeSql(
      `create table public.${PROPOSALS_TABLE} ` +
        `(id uuid primary key, ${PROPOSAL_OWNER_COLUMN} uuid, ` +
        `${PROPOSAL_PROPOSED_BY_COLUMN} uuid, ${PROPOSAL_VEHICLE_COLUMN} uuid);\n` +
        `create policy "proposer" on public.${PROPOSALS_TABLE} ` +
        `for all to authenticated ` +
        `using (${PROPOSAL_PROPOSED_BY_COLUMN} = auth.uid()) with check (` +
        `${PROPOSAL_PROPOSED_BY_COLUMN} = auth.uid() and exists (` +
        `select 1 from public.${SHARES_TABLE} s join public.vehicles v ` +
        `on v.id = s.${PROPOSAL_VEHICLE_COLUMN} ` +
        `where s.${PROPOSAL_VEHICLE_COLUMN} = ` +
        `${PROPOSALS_TABLE}.${PROPOSAL_VEHICLE_COLUMN} ` +
        `and v.${PROPOSAL_OWNER_COLUMN} = ` +
        `${PROPOSALS_TABLE}.${PROPOSAL_OWNER_COLUMN} ` +
        `and s.bound_account_id = auth.uid() and s.${CAN_PROPOSE_COLUMN} ` +
        `and s.${GRANT_REVOCATION_COLUMN} is null ` +
        `and s.${GRANT_EXPIRY_COLUMN} > now()))`
    );
    const inlinePolicy = proposerPolicyIn(inline);
    expect(
      inlinePolicy,
      "the inline fixture has no proposer policy"
    ).toBeDefined();
    expect(
      proposerLivenessIssues(inline, inlinePolicy as PolicyDefinition),
      "a full inline live-grant check must be accepted"
    ).toEqual([]);
  });
});

describe("the owner cannot forge a proposal (PRO-01, §7.1 provenance integrity)", () => {
  // Permissive INSERT policies OR together. PRO-01 makes a live can_propose
  // grant the ONLY submit path, so the ONLY policy that may admit an INSERT is
  // the proposer policy, whose new row is `proposed_by = auth.uid()`. An owner
  // `for all` policy whose `with check` only tests `owner_id` would ALSO admit
  // an INSERT — letting the vehicle owner insert a proposal with an arbitrary
  // `proposed_by`, forging a mechanic's authorship and, on acceptance,
  // fabricating the provenance §7.1 and PRO-05 exist to keep honest.
  //
  // Unmarked (not an `it.fails`), on purpose: it is a live constraint T3-302
  // cannot ship a forgery design past — it bites the moment T3-302 creates the
  // proposals policies — and is vacuously clean until then (no proposals policy
  // exists on `main`). Its teeth are proven NOW by the adjacent mutation
  // control, per "a test that cannot fail is worse than none" — the same
  // unmarked-guard-plus-mutation-control shape the PRO-03/PRO-05 absence guards
  // below use.
  it("no proposals policy admits an INSERT not tied to proposed_by = auth.uid()", () => {
    expect(
      forgingInsertPolicies(proposalPolicies()),
      "a proposals policy admits an INSERT the caller did not author — the " +
        "owner can forge a mechanic's proposal (PRO-01, §7.1)"
    ).toEqual([]);
  });

  it("the forgery guard bites an owner `for all` insert path and clears a split owner policy (mutation control)", () => {
    // Forgery-permitting: the owner policy is `for all`, so its
    // `with check (owner_id = auth.uid())` admits an owner-authored INSERT that
    // skips the proposer/can_propose check entirely.
    const forging = normalizeSql(
      `create table public.${PROPOSALS_TABLE} ` +
        `(id uuid primary key, ${PROPOSAL_OWNER_COLUMN} uuid, ` +
        `${PROPOSAL_PROPOSED_BY_COLUMN} uuid, ${PROPOSAL_VEHICLE_COLUMN} uuid);\n` +
        `create policy "owner all" on public.${PROPOSALS_TABLE} ` +
        `for all to authenticated ` +
        `using (${PROPOSAL_OWNER_COLUMN} = auth.uid()) ` +
        `with check (${PROPOSAL_OWNER_COLUMN} = auth.uid());\n` +
        `create policy "proposer" on public.${PROPOSALS_TABLE} ` +
        `for all to authenticated ` +
        `using (${PROPOSAL_PROPOSED_BY_COLUMN} = auth.uid()) ` +
        `with check (${PROPOSAL_PROPOSED_BY_COLUMN} = auth.uid())`
    );
    const forgingFindings = forgingInsertPolicies(proposalPoliciesIn(forging));
    expect(
      forgingFindings.length,
      "an owner `for all` policy is a forgery path and must be flagged"
    ).toBeGreaterThan(0);
    expect(
      forgingFindings.some((f) => f.includes("owner all")),
      "the finding must name the owner `for all` policy"
    ).toBe(true);

    // Safe: the owner only READS (select) and REJECTS (delete); the proposer
    // alone submits, and its `with check` ties the new row to the caller. No
    // policy admits a forged INSERT — the positive control for this guard.
    const safe = normalizeSql(
      `create table public.${PROPOSALS_TABLE} ` +
        `(id uuid primary key, ${PROPOSAL_OWNER_COLUMN} uuid, ` +
        `${PROPOSAL_PROPOSED_BY_COLUMN} uuid, ${PROPOSAL_VEHICLE_COLUMN} uuid);\n` +
        `create policy "owner reads" on public.${PROPOSALS_TABLE} ` +
        `for select to authenticated ` +
        `using (${PROPOSAL_OWNER_COLUMN} = auth.uid());\n` +
        `create policy "owner rejects" on public.${PROPOSALS_TABLE} ` +
        `for delete to authenticated ` +
        `using (${PROPOSAL_OWNER_COLUMN} = auth.uid());\n` +
        `create policy "proposer" on public.${PROPOSALS_TABLE} ` +
        `for all to authenticated ` +
        `using (${PROPOSAL_PROPOSED_BY_COLUMN} = auth.uid()) ` +
        `with check (${PROPOSAL_PROPOSED_BY_COLUMN} = auth.uid())`
    );
    expect(
      forgingInsertPolicies(proposalPoliciesIn(safe)),
      "the split owner (select + delete) design admits no forged INSERT"
    ).toEqual([]);
  });
});

describe("acceptance is the owner's own action, and the one write into records (PRO-02)", () => {
  it(`ships ${CONTRACT_SCHEMA}.${ACCEPT_PROPOSAL_FUNCTION}, taking the proposal id`, () => {
    const accept = requireProposalRoutine(ACCEPT_PROPOSAL_FUNCTION);
    for (const name of ACCEPT_PROPOSAL_ARGUMENTS) {
      expect(accept.argNames, `missing ${name}`).toContain(name);
    }
  });

  it("accept_proposal is security definer and pins search_path = ''", () => {
    const accept = requireProposalRoutine(ACCEPT_PROPOSAL_FUNCTION);
    expect(accept.securityDefiner, "not security definer").toBe(true);
    expect(
      definerSearchPathIssues(migrationSql()).filter((issue) =>
        issue.includes(accept.identity)
      ),
      "search_path not pinned to ''"
    ).toEqual([]);
  });

  it("accept_proposal ties auth.uid() to the proposal's owner — the owner's own action", () => {
    // "Acceptance is the owner's own action, keyed to auth.uid()." A definer
    // routine bypasses RLS, so the ownership check must be IN the body: it
    // ties the caller to the proposal's owner_id. `authUidComparands` on the
    // body proves an equality, not a mere mention.
    const accept = requireProposalRoutine(ACCEPT_PROPOSAL_FUNCTION);
    expect(
      authUidComparands(accept.body),
      `${ACCEPT_PROPOSAL_FUNCTION} never ties auth.uid() to ${PROPOSAL_OWNER_COLUMN}`
    ).toContain(PROPOSAL_OWNER_COLUMN);
  });

  it("accept_proposal reads the proposal and writes exactly records", () => {
    const accept = requireProposalRoutine(ACCEPT_PROPOSAL_FUNCTION);
    expect(accept.body, `never reads ${PROPOSALS_TABLE}`).toContain(
      PROPOSALS_TABLE
    );
    expect(accept.body, `never writes ${RECORDS_TABLE}`).toContain(
      RECORDS_TABLE
    );
  });

  it.each(RECORD_PROVENANCE_COLUMNS)(
    "accept_proposal carries %s onto the created record (PRO-02 provenance)",
    (column) => {
      const accept = requireProposalRoutine(ACCEPT_PROPOSAL_FUNCTION);
      expect(accept.body, `never sets provenance ${column}`).toContain(column);
    }
  );

  it.each(RECORD_PROVENANCE_COLUMNS)(
    "records.%s exists — provenance the accepted record carries (PRO-02, PRO-05)",
    (column) => {
      expect(
        columnDefinitionFor(migrationSql(), RECORDS_TABLE, column),
        `records.${column} is absent`
      ).not.toBeNull();
    }
  );

  it("records.accepted_at is a timestamp; the share/author refs are uuid", () => {
    const acceptedAt = columnDefinitionFor(
      migrationSql(),
      RECORDS_TABLE,
      RECORD_ACCEPTED_AT_COLUMN
    );
    expect(acceptedAt, "records.accepted_at absent").not.toBeNull();
    expect(/timestamp/.test(acceptedAt?.definition ?? "")).toBe(true);
    for (const column of [
      RECORD_PROPOSED_BY_COLUMN,
      RECORD_PROPOSAL_SHARE_COLUMN,
    ]) {
      const def = columnDefinitionFor(migrationSql(), RECORDS_TABLE, column);
      expect(def, `records.${column} absent`).not.toBeNull();
      expect(
        /uuid/.test(def?.definition ?? ""),
        `records.${column} not uuid`
      ).toBe(true);
    }
  });

  it("records.proposed_by is on delete set null — an accepted record survives its author (PRO-06)", () => {
    // The mirror image of proposals.proposed_by (cascade). An accepted
    // proposal IS the owner's record; the mechanic deleting their account
    // must not delete the owner's record — only unbind the attribution.
    const fk = foreignKeyFor(
      migrationSql(),
      RECORDS_TABLE,
      RECORD_PROPOSED_BY_COLUMN
    );
    expect(fk, "records.proposed_by has no foreign key").not.toBeNull();
    expect(fk?.target).toContain("users");
    expect(
      foreignKeyOnDeleteFor(
        migrationSql(),
        RECORDS_TABLE,
        RECORD_PROPOSED_BY_COLUMN
      )
    ).toBe("set null");
  });
});

describe("acceptance is account-only, and reachable by an account (spec §1)", () => {
  it("accept_proposal is not reachable without an account", () => {
    // §1: "the accountless path is read-only because it has no auth.uid()."
    // Accepting is the write; an anon/public caller holds no execute on it. An
    // "unknown" verdict counts as reachable (Postgres grants execute to PUBLIC
    // by default), so this also catches a forgotten revoke.
    const state = grants(migrationSql());
    const reachable = PROPOSAL_ACCOUNT_ONLY_FUNCTIONS.filter((name) =>
      isAnonExecutable(state, requireProposalRoutine(name))
    );
    expect(reachable).toEqual([]);
  });

  it("accept_proposal is reachable by an authenticated caller", () => {
    // The other direction — a closed door nobody can open is as broken as one
    // that will not shut.
    const state = grants(migrationSql());
    const unreachable = PROPOSAL_ACCOUNT_ONLY_FUNCTIONS.filter(
      (name) =>
        privilegeVerdict(
          state,
          requireProposalRoutine(name).identity,
          "authenticated",
          "execute"
        ) !== "granted"
    );
    expect(unreachable).toEqual([]);
  });
});

/* =========================================================================
 * Tier A — the ABSENCES (unmarked): a proposal is never a pending record, and
 * an accepted record is testimony, never a site-verified fact. These pass today
 * and must keep passing; each carries a mutation control proving it bites.
 * ====================================================================== */

describe("a proposal is never written into records as a pending row (PRO-03)", () => {
  it.each(RECORD_FORBIDDEN_STATE_COLUMNS)(
    "records carries no `%s` column — a pending record is the forbidden shortcut",
    (column) => {
      // PRO-03: "A proposal SHALL never be written into the records table in a
      // pending state." The tempting shortcut is a status/pending column that
      // lets a proposal live in `records` before acceptance. Graded as an
      // absence, as a category (not one spelling). `accepted_at` (provenance)
      // is a distinct token from `accepted` (forbidden) — matched exactly, so
      // provenance never trips this.
      expect(
        columnDefinitionFor(migrationSql(), RECORDS_TABLE, column),
        `records grew a \`${column}\` column — a proposal must live in ` +
          `${PROPOSALS_TABLE} until acceptance copies it (PRO-03)`
      ).toBeNull();
    }
  );

  it("records keeps exactly one author path — its owner (no non-owner insert)", () => {
    // PRO-03: "Records have exactly one author path — their owner — and 002's
    // RLS proves it." Re-asserted here as a PRO-03 guard: nothing T3-302 adds
    // may open a non-owner insert into records. Passes today (002); must keep
    // passing after T3-302.
    expect(userTablePolicyIssues(migrationSql(), [RECORDS_TABLE])).toEqual([]);
  });

  it("the pending-column absence check bites a records.status (mutation control)", () => {
    const withStatus =
      `create table ${CONTRACT_SCHEMA}.${RECORDS_TABLE} ` +
      `(id uuid primary key, status text);`;
    const without = `create table ${CONTRACT_SCHEMA}.${RECORDS_TABLE} (id uuid primary key);`;
    expect(
      columnDefinitionFor(withStatus, RECORDS_TABLE, "status")
    ).not.toBeNull();
    expect(columnDefinitionFor(without, RECORDS_TABLE, "status")).toBeNull();
    // And a provenance column is NOT mistaken for a forbidden one:
    const withProvenance =
      `create table ${CONTRACT_SCHEMA}.${RECORDS_TABLE} ` +
      `(id uuid primary key, accepted_at timestamptz);`;
    expect(
      columnDefinitionFor(withProvenance, RECORDS_TABLE, "accepted"),
      "`accepted` must not match `accepted_at`"
    ).toBeNull();
  });

  it("the non-owner-insert guard bites a broadened records insert (mutation control)", () => {
    const broadened =
      `create table ${CONTRACT_SCHEMA}.${RECORDS_TABLE} ` +
      `(id uuid primary key, vehicle_id uuid);\n` +
      `create policy "anyone inserts" on ${CONTRACT_SCHEMA}.${RECORDS_TABLE} ` +
      `for insert to authenticated with check (true);`;
    expect(
      userTablePolicyIssues(broadened, [RECORDS_TABLE]).length
    ).toBeGreaterThan(0);
  });
});

describe("an accepted record is the owner's testimony, not a site-verified fact (PRO-05)", () => {
  it.each(RECORD_FORBIDDEN_VERIFICATION_COLUMNS)(
    "records carries no `%s` flag — the site never vouches for a user record",
    (column) => {
      // PRO-05 / AGENTS.md Facts: a record created by accepting a proposal is
      // the owner's own record, never presented as a site-verified reference
      // fact. A `verified`/`fact_checked` flag on the record would be the schema
      // making that over-claim. Absence, graded as a category.
      expect(
        columnDefinitionFor(migrationSql(), RECORDS_TABLE, column),
        `records grew a \`${column}\` flag — a user record is testimony, not a ` +
          `site-verified fact (PRO-05)`
      ).toBeNull();
    }
  );

  it("the verification-flag absence check bites a records.is_verified (mutation control)", () => {
    const withFlag =
      `create table ${CONTRACT_SCHEMA}.${RECORDS_TABLE} ` +
      `(id uuid primary key, is_verified boolean);`;
    expect(
      columnDefinitionFor(withFlag, RECORDS_TABLE, "is_verified")
    ).not.toBeNull();
  });
});

/* =========================================================================
 * Tier B — behavioural. The half that actually proves a live grant admits a
 * proposal, isolation from a third principal, the owner's acceptance is the
 * write, and revocation kills submit/withdraw. `it.fails` until T3-302 ships;
 * skipped entirely with a named reason when no local stack is present.
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
  liveTitle("PRO-01 — only a live can_propose grant admits a proposal", live),
  () => {
    it.each([
      ["opens can_propose", true, true],
      ["withholds can_propose", false, false],
    ] as const)(
      "a bound grant that %s → submit is %s",
      async (_label, canPropose, expected) => {
        // The capability boundary, as a two-row table on the one variable that
        // decides it. Positive control is built in: the true row must succeed
        // and the false row must be refused, in the same grader.
        const scenario = await provisionScenario(stackOf(live));
        const mechanic = await makeAuthedActor(scenario, "m");
        try {
          const vehicleId = await ownedVehicleId(scenario);
          const grant = await issueProposeGrant(
            scenario,
            scenario.ownerA,
            vehicleId,
            { granteeEmail: mechanic.email, canPropose }
          );
          expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
            true
          );
          const submitted = await submitProposal(
            scenario,
            mechanic,
            scenario.ownerA.userId as string,
            vehicleId
          );
          expect(submitted.ok).toBe(expected);
        } finally {
          await dropAuthedActor(scenario, mechanic);
          await teardownScenario(scenario);
        }
      }
    );

    it("a mechanic with no grant cannot submit; the same mechanic, once granted, can", async () => {
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        // No grant at all: refused.
        const ungranted = await submitProposal(
          scenario,
          mechanic,
          scenario.ownerA.userId as string,
          vehicleId
        );
        expect(ungranted.ok).toBe(false);
        // Positive control: a live can_propose grant, and now it works.
        const grant = await issueProposeGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email, canPropose: true }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );
        const granted = await submitProposal(
          scenario,
          mechanic,
          scenario.ownerA.userId as string,
          vehicleId
        );
        expect(granted.ok).toBe(true);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle(
    "PRO-04 — a proposal is visible only to its author and the vehicle owner",
    live
  ),
  () => {
    it("the author and the owner see the proposal; a third mechanic does not", async () => {
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      const stranger = await makeAuthedActor(scenario, "s");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueProposeGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email, canPropose: true }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );
        const submitted = await submitProposal(
          scenario,
          mechanic,
          scenario.ownerA.userId as string,
          vehicleId
        );
        expect(submitted.ok).toBe(true);
        const proposalId = proposalIdOf(submitted);
        expect(proposalId).not.toBeNull();

        // Author sees it, owner sees it (positive controls) …
        const authorView = await readProposals(scenario, mechanic);
        expect(authorView.ok).toBe(true);
        expect(proposalsInclude(authorView, proposalId as string)).toBe(true);
        const ownerView = await readProposals(scenario, scenario.ownerA);
        expect(ownerView.ok).toBe(true);
        expect(proposalsInclude(ownerView, proposalId as string)).toBe(true);

        // … and a third mechanic does not — refusal or empty, never the row.
        const strangerView = await readProposals(scenario, stranger);
        expect(proposalsInclude(strangerView, proposalId as string)).toBe(
          false
        );
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
    "PRO-02 — the owner's acceptance is the write; rejection writes nothing",
    live
  ),
  () => {
    it("acceptance creates exactly one record carrying the proposal's provenance", async () => {
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueProposeGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email, canPropose: true }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );
        const submitted = await submitProposal(
          scenario,
          mechanic,
          scenario.ownerA.userId as string,
          vehicleId
        );
        const proposalId = proposalIdOf(submitted);
        expect(proposalId).not.toBeNull();

        const before = await readVehicleRecords(
          scenario,
          scenario.ownerA,
          vehicleId
        );
        // createOwnedFixture already made one record on this vehicle.
        const beforeCount = rowCount(before);

        const accepted = await acceptProposal(
          scenario,
          scenario.ownerA,
          proposalId as string
        );
        expect(accepted.ok).toBe(true);

        const after = await readVehicleRecords(
          scenario,
          scenario.ownerA,
          vehicleId
        );
        expect(after.ok).toBe(true);
        expect(rowCount(after) - beforeCount).toBe(1);

        const rows = (after.body as Record<string, unknown>[]) ?? [];
        const provenanced = rows.find(
          (row) => row[RECORD_PROPOSED_BY_COLUMN] === mechanic.userId
        );
        expect(provenanced, "the new record carries no proposer").toBeDefined();
        expect(provenanced?.[RECORD_ACCEPTED_AT_COLUMN]).toBeTruthy();
        expect(provenanced?.[RECORD_PROPOSAL_SHARE_COLUMN]).toBe(grant.shareId);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });

    it("rejection creates no record", async () => {
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueProposeGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email, canPropose: true }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );
        const submitted = await submitProposal(
          scenario,
          mechanic,
          scenario.ownerA.userId as string,
          vehicleId
        );
        const proposalId = proposalIdOf(submitted);
        expect(proposalId).not.toBeNull();

        const before = rowCount(
          await readVehicleRecords(scenario, scenario.ownerA, vehicleId)
        );
        const rejected = await rejectProposal(
          scenario,
          scenario.ownerA,
          proposalId as string
        );
        expect(rejected.ok).toBe(true);
        const after = await readVehicleRecords(
          scenario,
          scenario.ownerA,
          vehicleId
        );
        expect(after.ok).toBe(true);
        // Nothing created — and the proposal is gone.
        expect(rowCount(after)).toBe(before);
        const ownerView = await readProposals(scenario, scenario.ownerA);
        expect(proposalsInclude(ownerView, proposalId as string)).toBe(false);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle("PRO-02/PRO-03 — a mechanic cannot forge an accepted record", live),
  () => {
    it("a mechanic cannot write a record directly, nor accept their own proposal; the owner can", async () => {
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueProposeGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email, canPropose: true }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );

        // Forgery 1: a direct write into the owner's records is refused
        // (records' insert policy is owner-only — PRO-03).
        const forged = await forgeRecordInsert(scenario, mechanic, vehicleId);
        expect(forged.ok).toBe(false);

        const submitted = await submitProposal(
          scenario,
          mechanic,
          scenario.ownerA.userId as string,
          vehicleId
        );
        const proposalId = proposalIdOf(submitted);
        expect(proposalId).not.toBeNull();

        const before = rowCount(
          await readVehicleRecords(scenario, scenario.ownerA, vehicleId)
        );

        // Forgery 2: the mechanic accepts their OWN proposal — acceptance is
        // keyed to the owner's auth.uid(), so this must create nothing.
        await acceptProposal(scenario, mechanic, proposalId as string);
        const afterForge = rowCount(
          await readVehicleRecords(scenario, scenario.ownerA, vehicleId)
        );
        expect(afterForge).toBe(before);

        // Positive control: the OWNER accepts, and now a record appears.
        const ownerAccept = await acceptProposal(
          scenario,
          scenario.ownerA,
          proposalId as string
        );
        expect(ownerAccept.ok).toBe(true);
        const afterOwner = rowCount(
          await readVehicleRecords(scenario, scenario.ownerA, vehicleId)
        );
        expect(afterOwner - before).toBe(1);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle(
    "PRO-06 — revocation kills submit and withdraw; pending stays rejectable",
    live
  ),
  () => {
    it("after revocation the mechanic cannot submit or withdraw, but the owner can reject", async () => {
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueProposeGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email, canPropose: true }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );

        // Two live proposals: P0 (to withdraw as a positive control while
        // live) and P1 (to survive to revocation for the owner to reject).
        const p0 = proposalIdOf(
          await submitProposal(
            scenario,
            mechanic,
            scenario.ownerA.userId as string,
            vehicleId
          )
        );
        const p1 = proposalIdOf(
          await submitProposal(
            scenario,
            mechanic,
            scenario.ownerA.userId as string,
            vehicleId
          )
        );
        expect(p0).not.toBeNull();
        expect(p1).not.toBeNull();

        // Positive control: while the grant is live, the mechanic CAN
        // withdraw their own proposal.
        expect(
          (await withdrawProposal(scenario, mechanic, p0 as string)).ok
        ).toBe(true);

        // Revoke the grant.
        expect(
          (await revokeGrant(scenario, scenario.ownerA, grant.shareId)).ok
        ).toBe(true);

        // Now the mechanic can neither submit …
        const lateSubmit = await submitProposal(
          scenario,
          mechanic,
          scenario.ownerA.userId as string,
          vehicleId
        );
        expect(lateSubmit.ok).toBe(false);
        // … nor withdraw the still-pending P1.
        await withdrawProposal(scenario, mechanic, p1 as string);
        const stillThere = await readProposals(scenario, scenario.ownerA);
        expect(proposalsInclude(stillThere, p1 as string)).toBe(true);

        // But the owner can still reject the pending P1 (PRO-06).
        expect(
          (await rejectProposal(scenario, scenario.ownerA, p1 as string)).ok
        ).toBe(true);
        const afterReject = await readProposals(scenario, scenario.ownerA);
        expect(proposalsInclude(afterReject, p1 as string)).toBe(false);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });

    it("an accepted record is unaffected when the grant is later revoked", async () => {
      const scenario = await provisionScenario(stackOf(live));
      const mechanic = await makeAuthedActor(scenario, "m");
      try {
        const vehicleId = await ownedVehicleId(scenario);
        const grant = await issueProposeGrant(
          scenario,
          scenario.ownerA,
          vehicleId,
          { granteeEmail: mechanic.email, canPropose: true }
        );
        expect((await bindGrant(scenario, mechanic, grant.token)).ok).toBe(
          true
        );
        const proposalId = proposalIdOf(
          await submitProposal(
            scenario,
            mechanic,
            scenario.ownerA.userId as string,
            vehicleId
          )
        );
        expect(proposalId).not.toBeNull();
        expect(
          (
            await acceptProposal(
              scenario,
              scenario.ownerA,
              proposalId as string
            )
          ).ok
        ).toBe(true);
        const afterAccept = rowCount(
          await readVehicleRecords(scenario, scenario.ownerA, vehicleId)
        );

        // Revoke the grant — the accepted record is a record now, unaffected.
        expect(
          (await revokeGrant(scenario, scenario.ownerA, grant.shareId)).ok
        ).toBe(true);
        const afterRevoke = await readVehicleRecords(
          scenario,
          scenario.ownerA,
          vehicleId
        );
        expect(afterRevoke.ok).toBe(true);
        expect(rowCount(afterRevoke)).toBe(afterAccept);
      } finally {
        await dropAuthedActor(scenario, mechanic);
        await teardownScenario(scenario);
      }
    });
  }
);

/* PRO-06 is "revoked OR expires". The revocation half is proved above and is
 * the load-bearing one; the expiry half is the same proof with `expireGrant`
 * (fixtures.ts) in place of `revokeGrant` — the roster suite proves the two are
 * interchangeable liveness triggers, so it is left as a one-line follow-up
 * against these same fixtures rather than doubled here. */
