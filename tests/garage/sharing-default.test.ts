/**
 * Graders — CONTRACT 5: private by default, at the schema level.
 *
 * > **SHR-01** Everything a user stores SHALL default to private (owner
 * > decision 2026-08-28). Row-level security in the database enforces it; no
 * > client-trusted checks.
 * > **SHR-03** Costs and receipts SHALL stay private even on a public
 * > work-log unless opened per record.
 *
 * The distinction this file exists to keep sharp: **private-by-default is a
 * column default, not an application habit.** A form that leaves the "make
 * public" box unticked is a client-trusted check — SHR-01 rules it out by
 * name. The guarantee has to survive a row inserted by a script, by a future
 * import job, by a `curl` the user found on a forum. That means:
 *
 * - the column exists, so visibility is representable at all;
 * - it is `not null`, so there is no third state that is neither public nor
 *   private and that some later `coalesce` gets wrong;
 * - it defaults to `false`, so an insert that never mentions it is private;
 * - and the default actually round-trips through the real database.
 *
 * `contract.ts`'s `SHARE_FLAG_COLUMNS` is the table these iterate: every
 * column whose *default* is the privacy guarantee, one grader per column per
 * property, because each fails on its own.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker. T2-202 activates a grader by deleting exactly that
 * `.fails`.
 *
 * refs specs/002-montero-garage (SHR-01, SHR-02, SHR-03, GAR-05′)
 */
import { describe, expect, it } from "vitest";
import {
  OPTIMISTIC_BOOLEAN_DEFAULTS,
  SHARE_FLAG_COLUMNS,
  TEST_TAXONOMY_IDENTITY,
  testReceiptPath,
  testVehicleName,
} from "./contract.ts";
import { optimisticBooleanDefaultIssues } from "./rules.ts";
import {
  createOwnedFixture,
  detectLiveStack,
  insertRow,
  liveTitle,
  provisionScenario,
  stackOf,
  teardownScenario,
} from "./harness.ts";
import {
  columnDefinition,
  createTableBody,
  defaultExpression,
  isNotNullFor,
  migrationSql,
} from "./sql.ts";

const live = await detectLiveStack();

const flagsOf = (pending: boolean) =>
  SHARE_FLAG_COLUMNS.filter(
    (flag) => (flag.pending !== undefined) === pending
  ).map((flag) => [flag.table, flag.column, flag.requirement] as const);

/** The flags on tables that exist. */
const FLAGS = flagsOf(false);

/**
 * The flags a named task still has to ship — SHR-06's two capability columns
 * on `shares` (T2-404). Marked, not dropped: see `ColumnContract.pending`.
 */
const PENDING_FLAGS = flagsOf(true);

/* =========================================================================
 * Tier A — declaration
 * ====================================================================== */

describe("every visibility flag is declared private-by-default", () => {
  it.each(FLAGS)("%s.%s exists (%s)", (table, column) => {
    const body = createTableBody(migrationSql(), table);

    expect(columnDefinition(body ?? "", column)).not.toBeNull();
  });

  it.each(FLAGS)("%s.%s is boolean (%s)", (table, column) => {
    const body = createTableBody(migrationSql(), table);

    expect(columnDefinition(body ?? "", column)?.definition ?? "").toMatch(
      /\bbool/
    );
  });

  it.each(FLAGS)("%s.%s is not null (%s)", (table, column) => {
    // A nullable visibility flag has three states, and only two of them are
    // answers. The third one is whatever the next `coalesce` decides.
    expect(isNotNullFor(migrationSql(), table, column)).toBe(true);
  });

  it.each(FLAGS)(
    "%s.%s DEFAULTS TO FALSE — the whole of SHR-01 (%s)",
    (table, column) => {
      const body = createTableBody(migrationSql(), table);
      const definition = columnDefinition(body ?? "", column);

      expect(defaultExpression(definition?.definition ?? "")).toBe("false");
    }
  );

  it.fails.each(PENDING_FLAGS)("%s.%s exists (%s)", (table, column) => {
    const body = createTableBody(migrationSql(), table);

    expect(columnDefinition(body ?? "", column)).not.toBeNull();
  });

  it.fails.each(PENDING_FLAGS)("%s.%s is boolean (%s)", (table, column) => {
    const body = createTableBody(migrationSql(), table);

    expect(columnDefinition(body ?? "", column)?.definition ?? "").toMatch(
      /\bbool/
    );
  });

  it.fails.each(PENDING_FLAGS)("%s.%s is not null (%s)", (table, column) => {
    expect(isNotNullFor(migrationSql(), table, column)).toBe(true);
  });

  it.fails.each(PENDING_FLAGS)(
    "%s.%s DEFAULTS TO FALSE — the whole of SHR-01 (%s)",
    (table, column) => {
      const body = createTableBody(migrationSql(), table);
      const definition = columnDefinition(body ?? "", column);

      expect(defaultExpression(definition?.definition ?? "")).toBe("false");
    }
  );

  it("the SHIPPED flag sweep is non-empty, and the partition is total", () => {
    // `it.each([])` registers nothing and reports nothing. Without this, a bug
    // that put every flag on one side would delete half the file in silence.
    //
    // ## The pending half emptied for real when T2-404 landed
    //
    // It held `shares.includes_costs` and `shares.includes_receipts` from
    // T2-401 until the migration that created them. The original form asserted
    // *both* halves non-empty, which reads as a vacuity guard but is really a
    // claim that some flag is always unbuilt — and that claim stops being true
    // exactly when the schema is finished, so honouring it would mean the
    // contract can never be completed without a red suite.
    //
    // The hazard is only ever about the half that carries the unmarked sweeps.
    // That is `FLAGS`, which is asserted non-empty here and enumerated
    // column-by-column above; an empty `PENDING_FLAGS` registers no `it.fails`
    // graders and there is, by definition, no unbuilt flag they could have
    // graded. The totality check is what stops a flag falling out of both
    // lists, which is the failure the original was reaching for.
    expect(FLAGS.length).toBeGreaterThanOrEqual(4);
    expect(FLAGS.length + PENDING_FLAGS.length).toBe(SHARE_FLAG_COLUMNS.length);
  });

  it("declares NO boolean defaulting to true, anywhere, whatever it is called", () => {
    // ## Rewritten by T2-401. The previous version was name-shaped.
    //
    // It swept for
    //   /(is_[a-z_]*(public|shared|visible)[a-z_]*)[^,)]*default true/
    // which needs an `is_` prefix AND one of three words AND the default, all
    // three. That is not a sweep for optimistic defaults; it is a sweep for one
    // *naming convention* of optimistic default — and it existed to catch "a
    // fifth flag this file does not know about", which is by construction the
    // flag that does not follow the convention. Verified: both
    //
    //   includes_costs boolean not null default true
    //   is_active      boolean not null default true
    //
    // walked straight past it. The first is not a hypothetical — it is a
    // capability column on `shares`, and defaulting it true opens every
    // grant's costs to every holder, which is SHR-06's exact prohibition.
    //
    // Inverted: every boolean that defaults to true is a finding unless it is
    // named in `OPTIMISTIC_BOOLEAN_DEFAULTS` with a reason. A rule that does
    // not read the column name cannot be dodged by choosing one.
    expect(
      optimisticBooleanDefaultIssues(
        migrationSql(),
        OPTIMISTIC_BOOLEAN_DEFAULTS
      )
    ).toEqual([]);
  });

  it("the exemption map is EMPTY — a default-open column is a deliberate diff", () => {
    // Same reasoning as `EXEMPT_PUBLIC_TABLES`' size assertion in
    // `share-instrument.test.ts` (round-2 F4): iterating an empty map asserting
    // each entry has a reason is a test that cannot fail. Asserting the size
    // can, and it puts the exemption and this file's blessing of it in one
    // diff.
    expect(OPTIMISTIC_BOOLEAN_DEFAULTS.size).toBe(0);
  });
});

/* =========================================================================
 * Tier B — behavioural
 * ====================================================================== */

describe.skipIf(!live.available)(
  liveTitle("the default survives a real insert", live),
  () => {
    it("a vehicle created without mentioning visibility is private", async () => {
      // The insert deliberately says nothing about sharing — exactly what a
      // script, an import job, or a hand-written request would do.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const response = await insertRow(
          scenario,
          scenario.ownerA,
          "vehicles",
          {
            owner_id: scenario.ownerA.userId,
            display_name: testVehicleName("a"),
            ...TEST_TAXONOMY_IDENTITY,
          }
        );

        const rows = Array.isArray(response.body) ? response.body : [];
        const vehicle = rows[0] as Record<string, unknown> | undefined;

        expect(vehicle?.is_showcase_public).toBe(false);
        expect(vehicle?.is_worklog_public).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("a record created without mentioning visibility is private", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const owned = await createOwnedFixture(
          scenario,
          scenario.ownerA,
          testReceiptPath(scenario.ownerA.userId ?? "", "1")
        );

        const response = await insertRow(scenario, scenario.ownerA, "records", {
          vehicle_id: owned.vehicleId,
          occurred_on: "2026-08-30",
          kind: "work",
        });

        const rows = Array.isArray(response.body) ? response.body : [];
        const record = rows[0] as Record<string, unknown> | undefined;

        expect(record?.is_public).toBe(false);
        expect(record?.is_cost_public).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("cost visibility is its own decision, not the record's", async () => {
      // SHR-03: publishing a work-log entry must not publish what it cost.
      // Two columns, two defaults, and opening one must leave the other shut.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const owned = await createOwnedFixture(
          scenario,
          scenario.ownerA,
          testReceiptPath(scenario.ownerA.userId ?? "", "1")
        );

        const response = await insertRow(scenario, scenario.ownerA, "records", {
          vehicle_id: owned.vehicleId,
          occurred_on: "2026-08-30",
          kind: "work",
          cost_amount: 45000,
          cost_currency: "CRC",
          is_public: true,
        });

        const rows = Array.isArray(response.body) ? response.body : [];
        const record = rows[0] as Record<string, unknown> | undefined;

        expect(record?.is_public).toBe(true);
        expect(record?.is_cost_public).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("POSITIVE CONTROL: the owner can still choose to publish", async () => {
      // Private-by-default is not private-by-force. SHR-02 is a feature, and
      // a schema that refused to flip the flag would satisfy every grader
      // above while shipping a garage nobody can share.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const response = await insertRow(
          scenario,
          scenario.ownerA,
          "vehicles",
          {
            owner_id: scenario.ownerA.userId,
            display_name: testVehicleName("a"),
            ...TEST_TAXONOMY_IDENTITY,
            is_showcase_public: true,
          }
        );

        const rows = Array.isArray(response.body) ? response.body : [];
        expect(
          (rows[0] as Record<string, unknown> | undefined)?.is_showcase_public
        ).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);
