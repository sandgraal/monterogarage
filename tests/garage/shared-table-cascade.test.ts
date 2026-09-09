/**
 * **T3-202a [TEST]** — the SHARED user-table class, and the account-deletion
 * (ACC-03) lifecycle a shared table has instead of a single-owner cascade hop.
 * **Must merge before T3-202**, which creates `shops`, `shop_members`,
 * `shop_invites` and rebases onto this accommodation (the T802 separation
 * precedent: an independent test-writer re-authors the grader accommodation
 * from spec and lands it first, so T3-202's implementer never grades its own
 * taxonomy decision).
 *
 * ## The problem this file exists to solve
 *
 * The 002 garage suite has two table classes and every created `public` table
 * must be one of them: {@link USER_TABLES} (single-owner private data, an
 * `on delete cascade` hop to `auth.users`) or {@link EXEMPT_PUBLIC_TABLES}
 * (public reference content, no RLS question). 003's shop tables are neither —
 * private user data (so not exempt), but with **no single owner** (003 §2: a
 * shop is "a named business with one or more member accounts"; SHP-01 makes
 * membership multi-account and invitation-only), so no honest single-owner
 * cascade hop exists. `contract.ts` adds {@link SHARED_USER_TABLES} as the
 * third class; this file grades what that class must be.
 *
 * ## The lifecycle model (owner ruling, 2026-09-08)
 *
 * ACC-03 is the fixed point — a user can always delete their account, never
 * gated. So on a shared table:
 *  - the column that IS the account's own row (`shop_members.account_id`) must
 *    be `on delete cascade`: the member's own membership goes with them;
 *  - a column that merely RECORDS who opened/issued a shared row
 *    (`shops.created_by`, `shop_invites.invited_by`) must be `on delete set
 *    null`: the shop/invite outlives the departing account (a `cascade` would
 *    destroy a business its other members still belong to; `restrict` /
 *    `no action` would BLOCK the deletion ACC-03 forbids gating);
 *  - a zero-member shop persists (orphaned) — no forced cleanup is required.
 *
 * ## Two kinds of test here, on purpose (the binding-ondelete.test.ts shape)
 *
 * 1. **Positive controls / boundary tables** (plain `it`, green *today*): they
 *    feed synthetic DDL — a made-up shop schema mutated one clause at a time —
 *    to the rules and pin that a correct schema passes and every wrong action
 *    is caught, for the exact reason ACC-03 gives. These are the
 *    `.claude/GRADER-PRINCIPLES.md` "mutation-test the probe corpus" guard:
 *    break `sharedTableCascadeIssues` or `ungradedTableIssues` and these go red.
 * 2. **The graders** (`it.fails`, red *today*): the actual T3-202a assertions
 *    against the shipped migration. Each fails now with a named absence (the
 *    shop tables do not exist pre-T3-202), never an import error; T3-202
 *    activates each by deleting exactly its one `.fails` line, and only a
 *    correct shared-cascade migration turns it green.
 *
 * refs specs/003-shop-tools (SHP-01, §2 "Shop"), specs/002-montero-garage
 * (ACC-03)
 */
import { describe, expect, it } from "vitest";
import {
  EXEMPT_PUBLIC_TABLES,
  SHARED_USER_TABLES,
  SHARED_USER_TABLE_NAMES,
} from "./contract.ts";
import {
  sharedTableCascadeIssues,
  tableGrantIssues,
  ungradedTableIssues,
} from "./rules.ts";
import {
  createdTables,
  enablesRls,
  forcesRls,
  foreignKeyOnDeleteFor,
  migrationSql,
  normalizeSql,
} from "./sql.ts";

const sql = (text: string) => normalizeSql(text);

/* =========================================================================
 * Synthetic shop schema — a correct one, and a builder that mutates it
 *
 * `test_`-free on purpose: the whole point is DDL of the *exact* shape T3-202
 * will ship, so "the correct schema passes" is a claim about the real table
 * names. Nothing here is written to `supabase/migrations`; it is only ever fed
 * to a rule function as a string.
 * ====================================================================== */

interface ShopSchemaOptions {
  /** `on delete …` clause on `shop_members.account_id` (default correct). */
  readonly accountClause?: string;
  /** `on delete …` clause on `shops.created_by` (default correct). */
  readonly createdByClause?: string;
  /** `on delete …` clause on `shop_invites.invited_by` (default correct). */
  readonly invitedByClause?: string;
  /** Drop `force row level security` from this table, to prove RLS is graded. */
  readonly unforced?: "shops" | "shop_members" | "shop_invites";
  /** Add a leaking `grant select … to anon` on this table. */
  readonly leakTo?: "shops" | "shop_members" | "shop_invites";
}

/** A correct shared shop schema, mutable one clause at a time. */
function shopSchema(options: ShopSchemaOptions = {}): string {
  const {
    accountClause = "on delete cascade",
    createdByClause = "on delete set null",
    invitedByClause = "on delete set null",
    unforced,
    leakTo,
  } = options;

  const force = (table: string): string =>
    unforced === table
      ? ""
      : `alter table public.${table} force row level security;`;

  const leak = (table: string): string =>
    leakTo === table ? `grant select on public.${table} to anon;` : "";

  return sql(`
    create table public.shops (
      id uuid primary key,
      name text not null,
      created_by uuid references auth.users ${createdByClause}
    );
    alter table public.shops enable row level security;
    ${force("shops")}

    create table public.shop_members (
      id uuid primary key,
      shop_id uuid not null references public.shops on delete cascade,
      account_id uuid not null references auth.users ${accountClause}
    );
    alter table public.shop_members enable row level security;
    ${force("shop_members")}

    create table public.shop_invites (
      id uuid primary key,
      shop_id uuid not null references public.shops on delete cascade,
      invitee_email text not null,
      invited_by uuid references auth.users ${invitedByClause}
    );
    alter table public.shop_invites enable row level security;
    ${force("shop_invites")}

    revoke all on public.shops from anon, authenticated, public;
    revoke all on public.shop_members from anon, authenticated, public;
    revoke all on public.shop_invites from anon, authenticated, public;
    grant select on public.shops to authenticated;
    grant select on public.shop_members to authenticated;
    grant select on public.shop_invites to authenticated;
    ${leak("shops")}${leak("shop_members")}${leak("shop_invites")}
  `);
}

const SHOP_TABLES = ["shops", "shop_members", "shop_invites"] as const;

/* =========================================================================
 * POSITIVE CONTROL — a correct shared schema is fully accepted (proof (a))
 * ====================================================================== */

describe("a correct shared shop schema passes every garage-taxonomy sweep", () => {
  const correct = shopSchema();

  it("the three shop tables are accepted, not flagged as ungraded", () => {
    // The whole accommodation: without SHARED_USER_TABLES these three would be
    // "created but not enumerated … no grader knows it exists".
    expect(ungradedTableIssues(correct)).toEqual([]);
  });

  it("its account-deletion lifecycle model holds (no cascade findings)", () => {
    expect(sharedTableCascadeIssues(correct)).toEqual([]);
  });

  it("its deny-by-default grants pass tableGrantIssues", () => {
    expect(tableGrantIssues(correct, [...SHOP_TABLES])).toEqual([]);
  });
});

/* =========================================================================
 * A SHARED table stays fully RLS-graded — it is NOT an exemption (proof (b))
 * ====================================================================== */

describe("a shared table is RLS-graded exactly like a single-owner table", () => {
  it.each(SHOP_TABLES)(
    "a %s missing `force row level security` still FAILS",
    (table) => {
      const issues = ungradedTableIssues(shopSchema({ unforced: table })).join(
        " | "
      );
      expect(issues).toContain(`public.${table}`);
      expect(issues).toContain("not FORCED");
    }
  );

  it.each(SHOP_TABLES)(
    "a %s leaking `select` to anon still FAILS the deny-by-default sweep",
    (table) => {
      const issues = tableGrantIssues(shopSchema({ leakTo: table }), [
        ...SHOP_TABLES,
      ]).join(" | ");
      expect(issues).toContain(`public.${table}`);
      expect(issues).toContain("anon");
    }
  );

  it("being SHARED does not exempt: a shared name is not in EXEMPT_PUBLIC_TABLES", () => {
    // The exemption path (skip RLS) is reserved for public reference content.
    // A shop table taking that path would drop its RLS proof — the exact hole
    // this class is designed NOT to open.
    for (const table of SHARED_USER_TABLE_NAMES) {
      expect(EXEMPT_PUBLIC_TABLES.has(table), table).toBe(false);
    }
  });
});

/* =========================================================================
 * Boundary table — the account-scoped column MUST cascade (proof (c))
 *
 * `shop_members.account_id` is the member's own row. Only `on delete cascade`
 * is correct; every other action either orphans the row or blocks the member's
 * own account deletion (ACC-03).
 * ====================================================================== */

const ACCOUNT_CASCADE_CASES = [
  {
    label: "on delete cascade → accepted",
    clause: "on delete cascade",
    accepted: true,
  },
  {
    label: "on delete set null → rejected",
    clause: "on delete set null",
    accepted: false,
  },
  {
    label: "on delete restrict → rejected",
    clause: "on delete restrict",
    accepted: false,
  },
  {
    label: "on delete no action → rejected",
    clause: "on delete no action",
    accepted: false,
  },
  { label: "no on-delete clause → rejected", clause: "", accepted: false },
] as const;

describe("shop_members.account_id must be `on delete cascade` (ACC-03)", () => {
  it.each(ACCOUNT_CASCADE_CASES)("$label", ({ clause, accepted }) => {
    const issues = sharedTableCascadeIssues(
      shopSchema({ accountClause: clause })
    );
    const named = issues.filter((issue) =>
      issue.startsWith("shop_members.account_id:")
    );
    if (accepted) {
      expect(named).toEqual([]);
    } else {
      expect(named.length, issues.join(" | ")).toBe(1);
    }
  });

  it("a set-null account_id (an orphaned membership) is rejected by name", () => {
    // The specific wrong choice worth spelling out: `set null` would leave a
    // membership row whose member is gone — the member's own data surviving
    // their deletion, which ACC-03 says must not happen.
    const issues = sharedTableCascadeIssues(
      shopSchema({ accountClause: "on delete set null" })
    ).join(" | ");
    expect(issues).toContain(
      "shop_members.account_id: on delete set null, not cascade"
    );
  });

  it("an account_id with NO foreign key at all is a named absence, not silence", () => {
    const noFk = sql(`
      create table public.shops (
        id uuid primary key,
        created_by uuid references auth.users on delete set null
      );
      create table public.shop_members (
        id uuid primary key,
        account_id uuid not null
      );
      create table public.shop_invites (
        id uuid primary key,
        invited_by uuid references auth.users on delete set null
      );
    `);
    const issues = sharedTableCascadeIssues(noFk).join(" | ");
    expect(issues).toContain(
      "shop_members.account_id: no foreign key to auth.users"
    );
  });

  it("an account_id cascading to the wrong table is rejected", () => {
    // `cascade` is the right action, but a cascade to `public.shops` is not the
    // auth.users hop ACC-03 is about — it would not fire on account deletion.
    const wrongTarget = sql(`
      create table public.shops (
        id uuid primary key,
        created_by uuid references auth.users on delete set null
      );
      create table public.shop_members (
        id uuid primary key,
        account_id uuid not null references public.shops on delete cascade
      );
      create table public.shop_invites (
        id uuid primary key,
        invited_by uuid references auth.users on delete set null
      );
    `);
    const issues = sharedTableCascadeIssues(wrongTarget).join(" | ");
    expect(issues).toContain(
      "shop_members.account_id: references public.shops"
    );
  });

  it.each([
    { label: "public.users", target: "public.users" },
    { label: "auth.users_old", target: "auth.users_old" },
  ])(
    "an account_id referencing $label — wrong table, but the name still " +
      'contains "users" — is rejected, not silently accepted',
    ({ target }) => {
      // The regression this pins (Copilot review, PR #174): the FK-target
      // check used to be `!fk.target.includes("users")`, a substring test.
      // `public.users` and `auth.users_old` both contain "users", so the old
      // check treated them as the auth.users hop. `on delete cascade` here is
      // otherwise the *correct* action for this column, so under the old
      // check this schema produced ZERO findings — a false pass. The fix
      // compares `fk.target` to `SHARED_TABLE_ACCOUNT_TARGET` for exact
      // equality, so a same-name-different-schema or same-schema-different-
      // name target is caught. (Mutation check: reverting `accountHopIssues`
      // to the `.includes("users")` form makes this exact case go green when
      // it should be red — the bug this test exists to prevent.)
      const wrongTargetContainingUsers = sql(`
        create table public.shops (
          id uuid primary key,
          created_by uuid references auth.users on delete set null
        );
        create table public.shop_members (
          id uuid primary key,
          account_id uuid not null references ${target} on delete cascade
        );
        create table public.shop_invites (
          id uuid primary key,
          invited_by uuid references auth.users on delete set null
        );
      `);
      const issues = sharedTableCascadeIssues(wrongTargetContainingUsers).join(
        " | "
      );
      expect(issues).toContain(
        `shop_members.account_id: references ${target}, not auth.users`
      );
    }
  );

  it("the correct auth.users target still passes (positive control)", () => {
    // Same shape as the two cases above, but the actual, correct target —
    // proving the exact-match fix doesn't over-reject a legitimate hop.
    const correctTarget = sql(`
      create table public.shops (
        id uuid primary key,
        created_by uuid references auth.users on delete set null
      );
      create table public.shop_members (
        id uuid primary key,
        account_id uuid not null references auth.users on delete cascade
      );
      create table public.shop_invites (
        id uuid primary key,
        invited_by uuid references auth.users on delete set null
      );
    `);
    const named = sharedTableCascadeIssues(correctTarget).filter((issue) =>
      issue.startsWith("shop_members.account_id:")
    );
    expect(named).toEqual([]);
  });
});

/* =========================================================================
 * Boundary table — the founder column MUST set null (proof (d))
 *
 * `shops.created_by` (and `shop_invites.invited_by`) name an account on a row
 * shared with others. Only `on delete set null` is correct: `cascade` destroys
 * a shared shop when its founder leaves; `restrict`/`no action` block the
 * founder's deletion (ACC-03).
 * ====================================================================== */

const FOUNDER_SETNULL_CASES = [
  {
    label: "on delete set null → accepted",
    clause: "on delete set null",
    accepted: true,
  },
  {
    label: "on delete cascade → rejected",
    clause: "on delete cascade",
    accepted: false,
  },
  {
    label: "on delete restrict → rejected",
    clause: "on delete restrict",
    accepted: false,
  },
  {
    label: "on delete no action → rejected",
    clause: "on delete no action",
    accepted: false,
  },
  { label: "no on-delete clause → rejected", clause: "", accepted: false },
] as const;

describe("shops.created_by must be `on delete set null` (ACC-03)", () => {
  it.each(FOUNDER_SETNULL_CASES)("$label", ({ clause, accepted }) => {
    const named = sharedTableCascadeIssues(
      shopSchema({ createdByClause: clause })
    ).filter((issue) => issue.startsWith("shops.created_by:"));
    if (accepted) {
      expect(named).toEqual([]);
    } else {
      expect(named.length).toBe(1);
    }
  });

  it("a cascading created_by (destroys the shared shop) is rejected by name", () => {
    // The headline wrong choice: a founder deleting their account would take
    // the whole business — and every other member's shop — with them.
    const issues = sharedTableCascadeIssues(
      shopSchema({ createdByClause: "on delete cascade" })
    ).join(" | ");
    expect(issues).toContain(
      "shops.created_by: on delete cascade, not set null"
    );
  });

  it("shop_invites.invited_by is graded the same way", () => {
    const issues = sharedTableCascadeIssues(
      shopSchema({ invitedByClause: "on delete cascade" })
    ).join(" | ");
    expect(issues).toContain(
      "shop_invites.invited_by: on delete cascade, not set null"
    );
  });
});

/* =========================================================================
 * The contract itself — the three classes are coherent and disjoint
 * ====================================================================== */

describe("the SHARED user-table class is internally coherent", () => {
  // The pinned name list and the three-class disjointness live in
  // `harness-contract.test.ts` beside `USER_TABLE_NAMES`, so the contract's
  // table sets have one source of truth. This file owns only the guard the
  // cascade rule depends on.
  it("every shared table declares at least one auth.users lifecycle column", () => {
    // The completeness guard: a shared table with no cascade/set-null column
    // would be swept by `sharedTableCascadeIssues` and produce nothing — a rule
    // that cannot fail. Each entry must bind at least one column to the account,
    // so a fourth shared table cannot join the class without a cascade grader.
    for (const table of SHARED_USER_TABLES) {
      const columns = [
        ...table.accountCascadeColumns,
        ...table.founderSetNullColumns,
      ];
      expect(columns.length, table.name).toBeGreaterThan(0);
    }
  });
});

/* =========================================================================
 * The graders — activated by T3-202, green against the shipped migration
 *
 * Each reads the shipped migration, which now creates the shop tables. T3-202
 * activated each by deleting its one `.fails` marker; they stay green only while
 * a correct shared-cascade migration remains in place — a regression turns them
 * red with a named absence.
 * ====================================================================== */

describe("the shipped migration creates the shop tables with RLS forced", () => {
  it.each(SHARED_USER_TABLE_NAMES)(
    "public.%s exists and forces row level security",
    (table) => {
      const created = createdTables(migrationSql()).map((t) => t.name);
      expect(created, `public.${table} is not created yet`).toContain(table);
      expect(enablesRls(migrationSql(), table)).toBe(true);
      expect(forcesRls(migrationSql(), table)).toBe(true);
    }
  );
});

describe("the shipped migration honours the shared account-deletion model (ACC-03)", () => {
  it("shop_members.account_id is `on delete cascade` to auth.users", () => {
    const action = foreignKeyOnDeleteFor(
      migrationSql(),
      "shop_members",
      "account_id"
    );
    expect(
      action,
      "shop_members.account_id carries no auth.users foreign key to grade"
    ).not.toBeNull();
    expect(action).toBe("cascade");
  });

  it("shops.created_by is `on delete set null` to auth.users", () => {
    const action = foreignKeyOnDeleteFor(migrationSql(), "shops", "created_by");
    expect(
      action,
      "shops.created_by carries no auth.users foreign key to grade"
    ).not.toBeNull();
    expect(action).toBe("set null");
  });

  it("shop_invites.invited_by is `on delete set null` to auth.users", () => {
    const action = foreignKeyOnDeleteFor(
      migrationSql(),
      "shop_invites",
      "invited_by"
    );
    expect(
      action,
      "shop_invites.invited_by carries no auth.users foreign key to grade"
    ).not.toBeNull();
    expect(action).toBe("set null");
  });

  it("the whole shared-cascade model holds — no findings", () => {
    expect(sharedTableCascadeIssues(migrationSql())).toEqual([]);
  });

  it("the shop tables are accepted by the ungraded-table sweep, RLS and all", () => {
    // The other side of the accommodation, against the real migration: now that
    // T3-202 ships the tables, `ungradedTableIssues` must find them known AND
    // RLS-forced. createdTables now lists all three, so the assertion below —
    // that the sweep has *seen and cleared* all three — holds.
    const created = createdTables(migrationSql()).map((t) => t.name);
    for (const table of SHARED_USER_TABLE_NAMES) {
      expect(created, `public.${table} not created yet`).toContain(table);
    }
    expect(ungradedTableIssues(migrationSql())).toEqual([]);
  });
});
