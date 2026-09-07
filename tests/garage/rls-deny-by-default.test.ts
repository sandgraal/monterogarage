/**
 * Graders — CONTRACT 1: row-level security denies by default.
 *
 * > User data never leaves Supabase; every user table ships with row-level
 * > security proven by graders before content flows.
 * > — AGENTS.md, Boundaries
 *
 * > **SHR-01** Everything a user stores SHALL default to private. Row-level
 * > security in the database enforces it; **no client-trusted checks**.
 * > — specs/002-montero-garage
 *
 * Three claims, which fail separately and are therefore graded separately:
 *
 * 1. **An anonymous client reads nothing private.** Not "reads a filtered
 *    view" — nothing.
 * 2. **Owner A cannot read, write, or enumerate owner B's data.** Read is the
 *    obvious one; write and enumerate are the ones that get forgotten. A
 *    policy that blocks `select` but not `update` lets a stranger publish
 *    your work-log. A policy with a correct `using` and no `with check` lets
 *    a stranger write rows *into* your garage — rows that every downstream
 *    view then renders as your own testimony (AGENTS.md, Facts).
 * 3. **A table with no policy grants no access.** Deny-by-default is a
 *    Postgres property, and the repo should hold a proof rather than an
 *    assumption — because the day someone adds a fifth table and forgets its
 *    policies, this decides whether that is a leak or an outage.
 *
 * ## Two tiers, and what each is allowed to claim
 *
 * The declaration suite reads T2-202's DDL and runs everywhere, forever. The
 * behavioural suite asks a real Postgres, as three real actors, and runs only
 * against a local `supabase start`. Neither substitutes for the other; the
 * full argument is in `harness.ts`.
 *
 * **Claim 3's gap is closed as of T2-401.** It used to be graded at the
 * declaration tier only, because proving it behaviourally means creating a
 * throwaway table at test time — a direct SQL connection rather than
 * PostgREST, i.e. a Postgres driver this repo did not carry. It carries one
 * now (`db.ts`, loopback only, project-identity checked), and the proof lives
 * in `live-acl.test.ts`: a table created inside a rolled-back transaction is
 * born with no privilege for `anon`, `public`, or `authenticated`. The
 * mutation run that pins it is recorded there.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker. T2-202 activates a grader by deleting exactly that
 * `.fails` — one marker line per test, nothing else to edit.
 *
 * refs specs/002-montero-garage (SHR-01, MIG-03, GAR-01′, GAR-02′, GAR-05′)
 */
import { describe, expect, it } from "vitest";
import {
  UNSHIPPED_USER_TABLES,
  SHIPPED_USER_TABLES,
  USER_TABLE_NAMES,
  testReceiptPath,
  testVehicleName,
} from "./contract.ts";
import {
  createOwnedFixture,
  deleteRows,
  detectLiveStack,
  insertRow,
  liveTitle,
  provisionScenario,
  rowCount,
  selectRows,
  stackOf,
  teardownScenario,
  updateRows,
} from "./harness.ts";
import {
  coveredCommands,
  subqueryCorrelationIssues,
  tableGrantIssues,
  ungradedTableIssues,
  userTablePolicyIssues,
} from "./rules.ts";
import {
  createdTables,
  enablesRls,
  forcesRls,
  grants,
  migrationSql,
} from "./sql.ts";

const live = await detectLiveStack();

/**
 * The tables that exist, and the tables a named task will create.
 *
 * The sweeps below partition on this rather than dropping the pending half —
 * see `ColumnContract.pending` in `contract.ts`. `shares` (T2-404) is the
 * table this file's own G10 probe was written about: a grants table with
 * `for all to anon using (true)` and no `force`, invisible to every grader
 * because nothing enumerated it. It is enumerated now, before it exists.
 */
const SHIPPED = SHIPPED_USER_TABLES.map((table) => [table.name] as const);
const PENDING = UNSHIPPED_USER_TABLES.map(
  (table) => [table.name, table.pending ?? ""] as const
);
const SHIPPED_NAMES = SHIPPED_USER_TABLES.map((table) => table.name);

/* =========================================================================
 * Tier A — declaration
 * ====================================================================== */

describe("RLS is declared on every user table", () => {
  it.each(SHIPPED)("public.%s has row level security enabled", (table) => {
    expect(enablesRls(migrationSql(), table)).toBe(true);
  });

  it.fails.each(PENDING)(
    "public.%s has row level security enabled — pending %s",
    (table) => {
      expect(enablesRls(migrationSql(), table)).toBe(true);
    }
  );

  it.fails.each(PENDING)(
    "public.%s has row level security FORCED — pending %s",
    (table) => {
      expect(forcesRls(migrationSql(), table)).toBe(true);
    }
  );

  it.fails.each(PENDING)(
    "every %s policy is owner-scoped in BOTH `using` and `with check` — pending %s",
    (table) => {
      expect(userTablePolicyIssues(migrationSql(), [table])).toEqual([]);
    }
  );

  it.each(SHIPPED)(
    "every %s policy JOINS on the ownership column, not merely mentions it",
    (table) => {
      // ## Added by T2-401. Blind spot (b) from the T2-202 review.
      //
      // `isOwnerScoped` asks whether a subquery *mentions* the outer row. It
      // cannot ask whether the mention is a join, so
      //   using (exists (select 1 from public.vehicles v
      //                   where records.vehicle_id is not null
      //                     and v.owner_id = (select auth.uid())))
      // passes every grader above. The review recorded a belief that RLS on
      // `vehicles` would save it anyway. **Verified 2026-09-02: it does not** —
      // owner B read owner A's record through exactly that policy. The proof,
      // and the two shapes it covers, are in `policy-join-semantics.test.ts`.
      //
      // The rule is additive: it does not touch `isOwnerScoped`, and today's
      // schema answers it, because both subquery policies already join on the
      // column `contract.ts` declares as the ownership path.
      expect(subqueryCorrelationIssues(migrationSql(), [table])).toEqual([]);
    }
  );

  it.fails.each(PENDING)(
    "every %s policy JOINS on the ownership column — pending %s",
    (table) => {
      expect(subqueryCorrelationIssues(migrationSql(), [table])).toEqual([]);
      // A table with no policy at all produces no finding from this rule —
      // correctly, since it grades the shape of a policy that exists. The
      // marker therefore has to rest on the policy existing, which is the
      // claim `userTablePolicyIssues` makes above.
      expect(userTablePolicyIssues(migrationSql(), [table])).toEqual([]);
    }
  );

  it.fails.each(PENDING)(
    "public.%s covers select, insert, update, and delete — pending %s",
    (table) => {
      const covered = coveredCommands(migrationSql(), table);
      expect(
        ["select", "insert", "update", "delete"].filter(
          (command) => !covered.has(command)
        )
      ).toEqual([]);
    }
  );

  it.each(SHIPPED)(
    "public.%s has row level security FORCED, not merely enabled",
    (table) => {
      // `enable` exempts the table's owner role, and Supabase migrations run
      // as that role. Without `force`, anything holding the owner connection
      // reads every user's data with no policy consulted at all. This is the
      // single most commonly missed line in a Supabase schema.
      expect(forcesRls(migrationSql(), table)).toBe(true);
    }
  );

  it.each(SHIPPED)(
    "every %s policy is owner-scoped in BOTH `using` and `with check`",
    (table) => {
      // The finding that rebuilt this file (T2-201 review, F1). The previous
      // version asked whether the policy *statement* contained the characters
      // `auth.uid()`, which a policy reading
      //   using (auth.uid() is not null) with check (owner_id = auth.uid())
      // satisfies while handing every logged-in user everybody's rows.
      //
      // `using` decides what you can see; `with check` decides what you can
      // write. They are graded separately, each must tie the row to the
      // caller by equality (not by mention), and every top-level `or` branch
      // must do so — because `or` is how a scoped predicate gets widened.
      //
      // The rule lives in rules.ts and is itself graded, against the review's
      // own leaking schemas, in reviewer-probes.test.ts.
      expect(userTablePolicyIssues(migrationSql(), [table])).toEqual([]);
    }
  );

  it("grants no policy to anon or public on any user table", () => {
    // `roles.length === 0` counts as a leak on purpose: a `create policy`
    // with no `to` clause defaults to `public`, which includes `anon`.
    // Every table, shipped or pending: the finding this filters for is
    // "granted to anon/public", and a pending table with no policy at all
    // produces a different finding that this filter drops. So the sweep can
    // stay whole — it goes red the day a leaking policy appears on `shares`,
    // not the day `shares` appears.
    const leaks = userTablePolicyIssues(migrationSql(), [
      ...USER_TABLE_NAMES,
    ]).filter((issue) => issue.includes("granted to"));

    expect(leaks).toEqual([]);
  });

  it("covers select, insert, update, and delete on every user table", () => {
    // A table with only a `for select` policy is not readable by strangers —
    // and not writable by its owner either. More to the point, one with
    // select and update but no delete makes ACC-03's "a user SHALL be able
    // to delete their account" impossible to perform as the user.
    const missing: string[] = [];
    for (const table of SHIPPED_NAMES) {
      const covered = coveredCommands(migrationSql(), table);
      for (const command of ["select", "insert", "update", "delete"]) {
        if (!covered.has(command)) missing.push(`${table}.${command}`);
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("deny-by-default is declared, not assumed", () => {
  it("leaves anon and public with NO privilege on any user table", () => {
    // RLS filters rows; GRANT decides whether a role may reach the table at
    // all. Supabase's `anon` role ships with broad grants on `public`, so
    // "we wrote policies" is not the whole story — the revoke is what makes a
    // table that ships before its policies do an outage rather than a leak.
    //
    // ## Rewritten by T2-401a. The previous version was a false pass.
    //
    // It counted statements matching `^revoke … from … anon` and asserted the
    // count was above zero. It never asked what the ACL was at the end, so a
    // directory containing
    //
    //   revoke all on public.records from anon;
    //   grant select on public.records to anon;
    //
    // scored 1 and passed — verified 2026-08-31. `sql.ts` established replay
    // discipline for policies for exactly this reason (`alter policy`, D2) and
    // it had never been applied to grants. A migration directory is a
    // sequence, and the only honest question is what the database looks like
    // at the end.
    //
    // Second-order while forced RLS and no anon policy still yield zero rows;
    // first-order the moment a `security definer` RPC granted to `anon` adds a
    // surface where no policy is consulted at all — which is T2-404.
    //
    // The list is the union of what is enumerated and what is **created**, so
    // a fifth table cannot dodge the question by not being in the contract.
    //
    // The list is the union of what is **shipped** and what is **created** —
    // shipped rather than enumerated, because `tableGrantIssues` correctly
    // reports "the end-state ACL is unknown" for a table no statement ever
    // mentions, and a table that does not exist yet has no ACL to be known.
    // The `createdTables` half is what makes this airtight anyway: the day
    // T2-404 creates `shares`, it joins this sweep from the other side whether
    // anyone remembers to move it or not. The same is true from the exemption
    // side: `tableGrantIssues` defaults to skipping anything named in
    // `EXEMPT_PUBLIC_TABLES` (`search_index_entries`, RM-01/RM-02) — public
    // reference content this sweep was never meant to grade — without either
    // call site here having to filter `tables` itself. See that map's own
    // docstring, and `tableGrantIssues`'s, for why that table's `anon` select
    // grant is correct rather than a finding.
    const sql = migrationSql();
    const tables = [
      ...new Set([
        ...SHIPPED_NAMES,
        ...createdTables(sql).map((table) => table.name),
      ]),
    ];

    expect(tableGrantIssues(sql, tables)).toEqual([]);
  });

  it("revokes future default privileges too", () => {
    // The revoke above covers the tables that exist. This covers the one
    // written a year from now by someone who has not read this file.
    //
    // Read from the replayed `alter default privileges` records rather than by
    // regex over the whole file: the previous spelling matched
    // `alter default privileges[\s\S]*revoke[\s\S]*from[\s\S]*anon`, which
    // spans arbitrary distance and would be satisfied by three unrelated
    // statements — or by one statement and a comment.
    const records = grants(migrationSql()).defaultPrivileges;
    const revokedTypes = records
      .filter(
        (record) =>
          record.action === "revoke" &&
          record.roles.some((role) => role === "anon" || role === "public")
      )
      .map((record) => record.objectType);

    expect(revokedTypes).toContain("tables");
  });
});

describe("every table that exists is a table the graders know about", () => {
  it("creates no public table that is neither enumerated nor exempt", () => {
    // ## Added by T2-401a. The second recorded defect.
    //
    // Nothing enumerated the tables that actually exist. Every table-level
    // grader in this suite is driven from `contract.ts`, and
    // `userTablePolicyIssues` filters to `USER_TABLE_NAMES` — so a fifth user
    // table was **invisible**: a `shares` table with
    // `for all to anon using (true)` and no `force` produced zero findings,
    // verified 2026-08-31.
    //
    // > every user table ships with row-level security proven by graders
    // > before content flows — AGENTS.md, Boundaries
    //
    // That guarantee cannot be driven off a hand-written list of user tables.
    // This sweep runs the other way: it starts from what the directory
    // actually creates and reports anything no grader knows about, with a
    // named-exemption map in the style of `check-hreflang.mjs`'s
    // `EXEMPT_PAGES`. RLS is checked on every created table, enumerated or
    // not — a table nobody added to the contract is exactly the table whose
    // `force` was forgotten.
    //
    // The rule is graded against DDL with a known answer, both directions, in
    // `reviewer-probes.test.ts` (G10).
    expect(ungradedTableIssues(migrationSql())).toEqual([]);
  });
});

/* =========================================================================
 * Tier B — behavioural
 * ====================================================================== */

describe.skipIf(!live.available)(
  liveTitle("anonymous clients read nothing private", live),
  () => {
    it.each(SHIPPED)(
      "anon selects zero rows from %s even when rows exist",
      async (table) => {
        const scenario = await provisionScenario(stackOf(live));
        try {
          await createOwnedFixture(
            scenario,
            scenario.ownerA,
            testReceiptPath(scenario.ownerA.userId ?? "", "1")
          );

          const response = await selectRows(scenario, scenario.anon, table);

          // Either a refusal or an empty set is correct. A row is not.
          expect(rowCount(response)).toBe(0);
          expect(response.text).not.toContain(testVehicleName("a"));
        } finally {
          await teardownScenario(scenario);
        }
      }
    );

    it("anon cannot insert a row it would then own", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const response = await insertRow(scenario, scenario.anon, "vehicles", {
          owner_id: scenario.ownerA.userId,
          display_name: testVehicleName("anon"),
        });

        expect(response.ok).toBe(false);
        expect(response.status).toBeGreaterThanOrEqual(400);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("POSITIVE CONTROL: the same read succeeds for the owner", async () => {
      // Without this, every assertion above is satisfied by a database that
      // is simply broken, a bucket that does not exist, or a PostgREST that
      // 404s everything. "Nobody can read it" is only a security property
      // if somebody can.
      const scenario = await provisionScenario(stackOf(live));
      try {
        await createOwnedFixture(
          scenario,
          scenario.ownerA,
          testReceiptPath(scenario.ownerA.userId ?? "", "1")
        );

        const response = await selectRows(
          scenario,
          scenario.ownerA,
          "vehicles"
        );

        expect(response.ok).toBe(true);
        expect(rowCount(response)).toBe(1);
        expect(response.text).toContain(testVehicleName("a"));
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle("owner A cannot reach owner B", live),
  () => {
    /**
     * The cross-user access matrix. Every cell is one grader, because every
     * cell is one policy clause that can be wrong on its own: `using` governs
     * read, update-visibility and delete; `with check` governs insert and the
     * post-image of update. A schema can get four of these right and the
     * fifth wrong, and only a table finds that.
     */
    const CROSS_USER_OPERATIONS = [
      ["read", "vehicles"],
      ["read", "records"],
      ["read", "receipts"],
      ["read", "profiles"],
      ["update", "vehicles"],
      ["update", "records"],
      ["update", "receipts"],
      ["delete", "vehicles"],
      ["delete", "records"],
      ["delete", "receipts"],
    ] as const;

    it.each(CROSS_USER_OPERATIONS)(
      "owner B cannot %s owner A's %s",
      async (operation, table) => {
        const scenario = await provisionScenario(stackOf(live));
        try {
          const owned = await createOwnedFixture(
            scenario,
            scenario.ownerA,
            testReceiptPath(scenario.ownerA.userId ?? "", "1")
          );
          const id =
            table === "vehicles"
              ? owned.vehicleId
              : table === "records"
                ? owned.recordId
                : table === "receipts"
                  ? owned.receiptId
                  : (scenario.ownerA.userId ?? "");
          const query = `id=eq.${id}`;

          const response =
            operation === "read"
              ? await selectRows(scenario, scenario.ownerB, table, query)
              : operation === "update"
                ? await updateRows(scenario, scenario.ownerB, table, query, {
                    // Nothing schema-specific: the point is that the row does
                    // not move, not which column was aimed at.
                    id,
                  })
                : await deleteRows(scenario, scenario.ownerB, table, query);

          // Denied or invisible, never effective.
          expect(rowCount(response)).toBe(0);

          // And the row is still exactly as owner A left it.
          const asOwner = await selectRows(
            scenario,
            scenario.ownerA,
            table,
            query
          );
          expect(rowCount(asOwner)).toBe(1);
        } finally {
          await teardownScenario(scenario);
        }
      }
    );

    it("owner B cannot enumerate owner A's rows without naming them", async () => {
      // The graders above name a row id. Enumeration is the other shape of
      // the same leak: an unfiltered list.
      const scenario = await provisionScenario(stackOf(live));
      try {
        await createOwnedFixture(
          scenario,
          scenario.ownerA,
          testReceiptPath(scenario.ownerA.userId ?? "", "1")
        );

        const response = await selectRows(
          scenario,
          scenario.ownerB,
          "vehicles"
        );

        expect(rowCount(response)).toBe(0);
        expect(response.text).not.toContain(testVehicleName("a"));
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("owner B cannot create a row belonging to owner A", async () => {
      // `with check`, specifically.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const response = await insertRow(
          scenario,
          scenario.ownerB,
          "vehicles",
          {
            owner_id: scenario.ownerA.userId,
            display_name: testVehicleName("forged"),
          }
        );

        expect(response.ok).toBe(false);

        const asOwnerA = await selectRows(
          scenario,
          scenario.ownerA,
          "vehicles"
        );
        expect(asOwnerA.text).not.toContain(testVehicleName("forged"));
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("owner B cannot reassign their own row to owner A", async () => {
      // The other half of `with check`: an insert that is legal at write time,
      // followed by an update that walks it across the ownership boundary.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const owned = await createOwnedFixture(
          scenario,
          scenario.ownerB,
          testReceiptPath(scenario.ownerB.userId ?? "", "1")
        );

        const response = await updateRows(
          scenario,
          scenario.ownerB,
          "vehicles",
          `id=eq.${owned.vehicleId}`,
          { owner_id: scenario.ownerA.userId }
        );

        expect(rowCount(response)).toBe(0);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("POSITIVE CONTROL: each owner reads their own row and only their own", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        await createOwnedFixture(
          scenario,
          scenario.ownerA,
          testReceiptPath(scenario.ownerA.userId ?? "", "1")
        );
        await createOwnedFixture(
          scenario,
          scenario.ownerB,
          testReceiptPath(scenario.ownerB.userId ?? "", "1")
        );

        const a = await selectRows(scenario, scenario.ownerA, "vehicles");
        const b = await selectRows(scenario, scenario.ownerB, "vehicles");

        expect(rowCount(a)).toBe(1);
        expect(rowCount(b)).toBe(1);
        expect(a.text).toContain(testVehicleName("a"));
        expect(b.text).toContain(testVehicleName("b"));
        expect(a.text).not.toContain(testVehicleName("b"));
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);
