/**
 * Graders — CONTRACT 4: deleting an account really deletes everything.
 *
 * > **ACC-03** A user SHALL be able to delete their account; after a 30-day
 * > recovery window, all vehicles, records, and stored files SHALL be
 * > hard-deleted.
 *
 * "and stored files" is the clause this file exists for. A cascade of foreign
 * keys deletes *rows*, and it is very easy to ship a schema where every row is
 * gone and every receipt PDF is still sitting in the bucket — because a
 * `storage.objects` row and the bytes it points at are not the same thing, and
 * `on delete cascade` reaches neither of them from `public.receipts`.
 *
 * So the cascade is graded in three places that fail independently:
 *
 * 1. **Declared.** Every hop of every ownership path is `on delete cascade`,
 *    read out of the DDL.
 * 2. **Rows.** After the purge, no vehicle, record, or receipt row survives.
 * 3. **Files.** After the purge, the object is not listable, not readable by
 *    its owner, not signable, and not there.
 *
 * ## The recovery window
 *
 * ACC-03 has two events, not one: the user asks, and thirty days later the
 * data goes. They have different callers, and the first version of this file
 * pinned them as a single function in a way no implementation could satisfy —
 * the declaration grader demanded `auth.uid()` in the body while the
 * behavioural grader called it as the service role, where `auth.uid()` is
 * null (T2-201 review, F7). Neither tier could run, so nobody noticed the
 * graders were describing two different functions.
 *
 * They are two functions now, and `contract.ts` says why:
 * `request_account_deletion()` takes no argument and marks the caller's own
 * account; `purge_expired_accounts(p_now)` is the scheduled job, service-role
 * only, and takes the clock as a parameter so a grader can reach "thirty days
 * later" without waiting. `runAccountPurge` runs both in order.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker. T2-202 activates a grader by deleting exactly that
 * `.fails`.
 *
 * refs specs/002-montero-garage (ACC-03, GAR-05′, MIG-03)
 */
import { describe, expect, it } from "vitest";
import {
  PURGE_FUNCTION,
  RECOVERY_WINDOW_DAYS,
  REQUEST_DELETION_FUNCTION,
  USER_TABLES,
  testReceiptPath,
} from "./contract.ts";
import {
  createOwnedFixture,
  deleteAuthUser,
  detectLiveStack,
  downloadObject,
  listObjects,
  liveTitle,
  provisionScenario,
  rowCount,
  runAccountPurge,
  selectRows,
  signObject,
  stackOf,
  teardownScenario,
  uploadObject,
} from "./harness.ts";
import {
  columnDefinition,
  createTableBody,
  foreignKeyFor,
  migrationSql,
  statements,
} from "./sql.ts";

const live = await detectLiveStack();

/* =========================================================================
 * Tier A — declaration
 * ====================================================================== */

/**
 * Every foreign-key hop that must cascade, one row per grader.
 *
 * `shares` joins the chain in T2-401 as a **pending** hop (T2-404 creates the
 * table). It is on the list before it exists for the same reason the
 * completeness guard below exists at all: a grants table that outlives the
 * vehicle it grants access to is not an orphan a reader would notice — it is a
 * live bearer credential pointing at a row that has gone, and the failure mode
 * is whatever the reader does with the dangling reference. ACC-03 says *all*
 * of a deleted account's data goes.
 */
const CASCADE_HOPS = [
  ["profiles", "id", "auth.users"],
  ["vehicles", "owner_id", "auth.users"],
  ["records", "vehicle_id", "vehicles"],
  ["receipts", "record_id", "records"],
  // Promoted by T2-305 in the commit that created the table — the second of
  // the three edits `RECORD_MEDIA_TABLE`'s docstring names. A media row that
  // outlived its record would still name a storage path nothing can reach.
  ["record_media", "record_id", "records"],
] as const;

/** The hops a named task still has to ship. Marked, never dropped. */
const PENDING_CASCADE_HOPS = [
  ["shares", "vehicle_id", "vehicles", "T2-404"],
] as const;

describe("the ownership chain is declared to cascade", () => {
  it.fails.each(PENDING_CASCADE_HOPS)(
    "%s.%s references %s on delete cascade — pending %s",
    (table, column, target) => {
      const fk = foreignKeyFor(migrationSql(), table, column);

      expect(fk, `${table}.${column} has no foreign key`).not.toBeNull();
      expect(fk?.target).toContain(target.replace("auth.users", "users"));
      expect(fk?.cascades).toBe(true);
    }
  );

  it.each(CASCADE_HOPS)(
    "%s.%s references %s on delete cascade",
    (table, column, target) => {
      // One missing `on delete cascade` anywhere on this chain and ACC-03's
      // hard delete either fails on a constraint or leaves an orphan behind —
      // an orphaned receipt row still names a vendor, a date, and an amount.
      //
      // `foreignKeyFor` finds the constraint in all three places Postgres
      // accepts it: inline on the column, as a table-level constraint, or
      // added later by `alter table … add constraint`, which is what pg_dump
      // emits. The first version looked only inline and only with an explicit
      // column list, so it failed three correct spellings (T2-201 review, F6).
      const fk = foreignKeyFor(migrationSql(), table, column);

      expect(fk, `${table}.${column} has no foreign key`).not.toBeNull();
      expect(fk?.target).toContain(target.replace("auth.users", "users"));
      expect(fk?.cascades).toBe(true);
    }
  );

  // Unmarked, and passing today: this one grades `contract.ts` against
  // `CASCADE_HOPS`, both of which exist. It is the guard that stops the table
  // above from silently missing a table — a fifth one joining the schema
  // without joining the delete path would otherwise never be noticed here.
  it("covers every table in the contract, so the table above is complete", () => {
    // Both hop tables, because both are the delete path: a pending hop that
    // fell off this guard would be a table with no cascade grader at all, and
    // it would be missing on exactly the day the table appeared. The guard
    // grades `contract.ts` against the union, not against the shipped half.
    const onChain = new Set<string>([
      ...CASCADE_HOPS.map(([table]) => table),
      ...PENDING_CASCADE_HOPS.map(([table]) => table),
    ]);

    expect(
      USER_TABLES.map((table) => table.name).filter(
        (name) => !onChain.has(name)
      )
    ).toEqual([]);
  });

  it("no hop is on both lists — a hop is shipped or pending, not both", () => {
    // Without this, moving a hop from pending to shipped by copying rather
    // than moving would leave an `it.fails` that has started passing, which
    // Vitest reports as a failure whose message is about the wrong thing.
    const shipped = new Set<string>(
      CASCADE_HOPS.map(([table, column]) => `${table}.${column}`)
    );

    expect(
      PENDING_CASCADE_HOPS.map(
        ([table, column]) => `${table}.${column}`
      ).filter((hop) => shipped.has(hop))
    ).toEqual([]);
  });
});

describe("the 30-day recovery window is real (ACC-03)", () => {
  it("marks an account deleted rather than dropping it immediately", () => {
    // The window needs somewhere to live. Without it, "delete" is
    // irreversible on the first click and the requirement is unimplementable.
    const body = createTableBody(migrationSql(), "profiles");

    expect(columnDefinition(body ?? "", "deleted_at")).not.toBeNull();
  });

  it(`purges only after ${RECOVERY_WINDOW_DAYS} days`, () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      new RegExp(
        `${RECOVERY_WINDOW_DAYS}\\s*day|'${RECOVERY_WINDOW_DAYS} days'`
      )
    );
  });

  it(`ships a callable ${REQUEST_DELETION_FUNCTION} routine`, () => {
    expect(migrationSql()).toMatch(
      new RegExp(
        `create (or replace )?function [a-z_.]*${REQUEST_DELETION_FUNCTION}`
      )
    );
  });

  it(`${REQUEST_DELETION_FUNCTION} takes no user id — a victim is unrepresentable`, () => {
    // The fix for the incoherence the review found (F7). The old contract
    // wanted one function that both took a target user id *and* proved from
    // auth.uid() that the caller was that user — which no implementation can
    // do when the scheduled purge calls it with no session at all.
    //
    // Splitting it resolves that, and the split is better security anyway:
    // a routine with no parameter to put a victim in cannot be aimed at one.
    const sql = migrationSql();
    const signature = new RegExp(
      `create (?:or replace )?function [a-z_.]*${REQUEST_DELETION_FUNCTION}\\s*\\(([^)]*)\\)`
    ).exec(sql);

    expect(signature).not.toBeNull();
    expect((signature?.[1] ?? "x").trim()).toBe("");
  });

  it(`${REQUEST_DELETION_FUNCTION} marks only the caller's own row`, () => {
    // `security definer` runs with the definer's rights, so without an
    // auth.uid() scope inside the body it is a one-request account deletion
    // for any authenticated stranger.
    const sql = migrationSql();
    const start = sql.indexOf(REQUEST_DELETION_FUNCTION);
    const body = start === -1 ? "" : sql.slice(start, start + 4000);

    expect(body).toContain("auth.uid()");
  });

  it(`ships a schedulable ${PURGE_FUNCTION} routine`, () => {
    expect(migrationSql()).toMatch(
      new RegExp(`create (or replace )?function [a-z_.]*${PURGE_FUNCTION}`)
    );
  });

  it(`${PURGE_FUNCTION} is not callable by ordinary users`, () => {
    // The counterpart to the rule above. The purge legitimately runs with no
    // session, so it cannot defend itself with auth.uid() — which means the
    // grant is the entire defence, and it has to be revoked explicitly.
    const sql = migrationSql();
    const revokes = statements(sql).filter(
      (statement) =>
        statement.startsWith("revoke") &&
        statement.includes(PURGE_FUNCTION) &&
        /\b(authenticated|anon|public)\b/.test(statement)
    );

    expect(revokes.length).toBeGreaterThan(0);
  });
});

/* =========================================================================
 * Tier B — behavioural
 * ====================================================================== */

describe.skipIf(!live.available)(
  liveTitle("the purge reaches rows AND files", live),
  () => {
    it("leaves no vehicle, record, or receipt row behind", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const path = testReceiptPath(scenario.ownerA.userId ?? "", "1");
        await createOwnedFixture(scenario, scenario.ownerA, path);

        await runAccountPurge(scenario, scenario.ownerA);

        for (const table of ["vehicles", "records", "receipts"]) {
          const remaining = await selectRows(
            scenario,
            { ...scenario.ownerA },
            table
          );
          expect(rowCount(remaining), table).toBe(0);
        }
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("leaves no readable receipt file behind", async () => {
      // The clause the row cascade cannot satisfy on its own. If this is the
      // only grader in the file that stays red, the implementation deleted the
      // database and kept the PDFs.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const path = testReceiptPath(scenario.ownerA.userId ?? "", "1");
        await uploadObject(scenario, scenario.ownerA, path);
        await createOwnedFixture(scenario, scenario.ownerA, path);

        await runAccountPurge(scenario, scenario.ownerA);

        const read = await downloadObject(scenario, scenario.ownerA, path);
        expect(read.ok).toBe(false);
        expect(read.text).not.toContain("TEST-T2-201 synthetic receipt");
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("leaves no listable receipt file behind", async () => {
      // Separate from "not readable": an object can 403 on read and still
      // appear in a listing, and a listing of a deleted account's filenames is
      // itself data that should be gone.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const path = testReceiptPath(scenario.ownerA.userId ?? "", "1");
        await uploadObject(scenario, scenario.ownerA, path);
        await createOwnedFixture(scenario, scenario.ownerA, path);

        await runAccountPurge(scenario, scenario.ownerA);

        const listing = await listObjects(
          scenario,
          { ...scenario.ownerA },
          scenario.ownerA.userId ?? ""
        );
        expect(listing.text).not.toContain("TEST-T2-201-RECEIPT-1.pdf");
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("leaves no signable receipt file behind", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const path = testReceiptPath(scenario.ownerA.userId ?? "", "1");
        await uploadObject(scenario, scenario.ownerA, path);
        await createOwnedFixture(scenario, scenario.ownerA, path);

        await runAccountPurge(scenario, scenario.ownerA);

        const signed = await signObject(scenario, scenario.ownerA, path);
        expect(signed.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("does not touch the other owner's data", async () => {
      // A purge that over-reaches is the same defect wearing the opposite
      // coat, and it is much harder to notice in production.
      const scenario = await provisionScenario(stackOf(live));
      try {
        await createOwnedFixture(
          scenario,
          scenario.ownerA,
          testReceiptPath(scenario.ownerA.userId ?? "", "1")
        );
        const pathB = testReceiptPath(scenario.ownerB.userId ?? "", "1");
        await uploadObject(scenario, scenario.ownerB, pathB);
        await createOwnedFixture(scenario, scenario.ownerB, pathB);

        await runAccountPurge(scenario, scenario.ownerA);

        const remaining = await selectRows(
          scenario,
          scenario.ownerB,
          "vehicles"
        );
        expect(rowCount(remaining)).toBe(1);

        const readB = await downloadObject(scenario, scenario.ownerB, pathB);
        expect(readB.ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle("deleting the auth user is terminal, whatever the route", live),
  () => {
    it("removing the auth.users row removes every dependent row", async () => {
      // The purge function is one route. This is the other: whatever deletes
      // the account — an admin action, a GDPR request, a Supabase dashboard
      // click — must not be able to leave a garage behind with no owner.
      // This grader names no function, so it survives any rename.
      const scenario = await provisionScenario(stackOf(live));
      try {
        await createOwnedFixture(
          scenario,
          scenario.ownerA,
          testReceiptPath(scenario.ownerA.userId ?? "", "1")
        );

        const deleted = await deleteAuthUser(
          scenario,
          scenario.ownerA.userId ?? ""
        );
        expect(deleted.ok).toBe(true);

        // Read back as the service role: an owner-scoped read after the
        // owner is gone returns nothing whether the rows survived or not,
        // so it could never tell these two cases apart.
        const remaining = await selectRows(
          scenario,
          { ...scenario.ownerA, token: scenario.serviceToken },
          "vehicles",
          `owner_id=eq.${scenario.ownerA.userId}`
        );

        expect(rowCount(remaining)).toBe(0);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("POSITIVE CONTROL: the rows are there until the account goes", async () => {
      // Without this, the grader above passes against a schema where the
      // insert never worked in the first place.
      const scenario = await provisionScenario(stackOf(live));
      try {
        await createOwnedFixture(
          scenario,
          scenario.ownerA,
          testReceiptPath(scenario.ownerA.userId ?? "", "1")
        );

        const before = await selectRows(
          scenario,
          { ...scenario.ownerA, token: scenario.serviceToken },
          "vehicles",
          `owner_id=eq.${scenario.ownerA.userId}`
        );

        expect(rowCount(before)).toBe(1);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);
