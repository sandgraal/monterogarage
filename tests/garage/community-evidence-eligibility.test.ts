/**
 * Independent grader for T2-403's community-evidence **eligibility layer** —
 * `src/lib/garage/community-evidence.ts` and the visibility predicate it keys
 * on. Added post-review as the independent `[TEST]` pass the code review found
 * missing: T2-403 shipped `[PLATFORM]` with only its author's own
 * `src/lib/garage/community-evidence.test.ts`, so this file is a *different*
 * agent's derivation of the same rules straight from the spec — GAR-04′ and
 * SHR-09 — never from the implementation's own branches.
 *
 * > **GAR-04′** WHEN a record references a problem entry and its vehicle's
 * > work-log is public, THE problem page MAY surface it as community first-hand
 * > evidence (opt-in per record; the 001 GAR-04 idea, now multi-user).
 * > **SHR-09** A grant SHALL NOT make a record eligible for the community
 * > evidence surfacing of GAR-04′. That path keys on a *public* work-log; a
 * > record visible to one grantee is not public, and treating it as such would
 * > put a private work-log on a public problem page.
 *
 * ## What the spec fixes, in the plainest terms
 *
 * A record surfaces as community evidence **iff** all three hold, and nothing
 * else moves the answer:
 *
 *  1. the record's vehicle's **work-log is public** (`is_worklog_public`);
 *  2. the **record** itself is public (`is_public` — GAR-04′'s "opt-in per
 *     record");
 *  3. the record **references the problem** whose page it would appear on.
 *
 * SHR-09 is the boundary that a typed share grant — a state GAR-04′ predates —
 * does not touch any of the three. So eligibility is **world-keyed**: the same
 * question, and the same answer, no matter who is asking or who assembled the
 * candidate. A grant with every capability open, held by the record's own
 * grantee, does not make a private work-log's record eligible. That is the one
 * mistake this whole file exists to catch, because getting it wrong "will look
 * like a feature working correctly right up until someone notices" (the T2-403
 * scope guard in tasks.md).
 *
 * ## Every negative has a positive control (GRADER-PRINCIPLES.md)
 *
 * A rule that refuses a private work-log is worthless if it also refuses a
 * public one; a mask that omits a hidden cost is worthless if it also omits an
 * opened one. Each refusal below is paired with the acceptance that proves the
 * refusal is discriminating, not blanket.
 *
 * ## Fixtures are obviously synthetic
 *
 * TEST-prefixed problem ids and a reserved UUID range (`…e4xx`, distinct from
 * every other garage grader's range) so a real OEM/part number can never leak
 * in and a copy-paste collision is loud.
 *
 * refs specs/002-montero-garage (GAR-04′, SHR-09, SHR-01, SHR-02, SHR-03),
 * .claude/GRADER-PRINCIPLES.md
 */
import { describe, expect, it } from "vitest";

import {
  communityEvidenceAttribution,
  selectCommunityEvidence,
  type CommunityEvidenceItem,
} from "../../src/lib/garage/community-evidence.ts";
import type { RecordRow } from "../../src/lib/garage/record.ts";
import type { VehicleRow } from "../../src/lib/garage/vehicle.ts";
import {
  isEligibleForCommunityEvidence,
  type Principal,
} from "../../src/lib/garage/visibility.ts";

/* -------------------------------------------------------------------------
 * Synthetic fixtures — TEST namespace, reserved `…e4xx` UUID range.
 * ---------------------------------------------------------------------- */

const OWNER_ID = "00000000-0000-4000-8000-00000000e430";
const OTHER_OWNER_ID = "00000000-0000-4000-8000-00000000e431";
const VIEWER_ID = "00000000-0000-4000-8000-00000000e432";
const VEHICLE_ID = "00000000-0000-4000-8000-00000000e440";
const OTHER_VEHICLE_ID = "00000000-0000-4000-8000-00000000e441";
const RECORD_ID = "00000000-0000-4000-8000-00000000e450";

const PROBLEM_ID = "TEST-PRB-403-oil-leak";
const OTHER_PROBLEM_ID = "TEST-PRB-403-brake-judder";
const HANDLE = "test-t2-403-taller";

function vehicle(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: VEHICLE_ID,
    owner_id: OWNER_ID,
    display_name: "TEST-T2-403 Gitana",
    generation_id: "gen3",
    market_id: "cr",
    model_year: 2002,
    engine_id: "6g74-sohc",
    odometer_km: 233_000,
    photo_paths: ["TEST-secret-photo.jpg"],
    cover_photo_path: "TEST-secret-cover.jpg",
    is_showcase_public: false,
    is_worklog_public: true,
    ...overrides,
  };
}

function record(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: RECORD_ID,
    vehicle_id: VEHICLE_ID,
    occurred_on: "2026-07-19",
    kind: "work",
    title: "TEST-T2-403 valve-cover gasket",
    body: "TEST body — owner's own account",
    cost_amount: 245_000,
    cost_currency: "CRC",
    time_minutes: 180,
    odometer_km: 233_000,
    problem_ids: [PROBLEM_ID],
    part_ids: [],
    procedure_ids: [],
    is_public: true,
    is_cost_public: false,
    ...overrides,
  };
}

function source(
  vehicleRow: VehicleRow,
  records: readonly RecordRow[],
  handle = HANDLE
) {
  return { handle, vehicle: vehicleRow, records };
}

function surfaced(input: {
  readonly vehicle: VehicleRow;
  readonly records: readonly RecordRow[];
  readonly problemId?: string;
}): readonly CommunityEvidenceItem[] {
  return selectCommunityEvidence({
    problemId: input.problemId ?? PROBLEM_ID,
    sources: [source(input.vehicle, input.records)],
  });
}

/**
 * Every principal a caller could hand the eligibility predicate — the point of
 * the matrix is that SHR-09 makes the answer identical across all of them.
 * Includes the two states typed grants created that GAR-04′ predates: the
 * record's own grantee with every capability open, and a grant on a different
 * vehicle entirely.
 */
function everyPrincipal(vehicleId: string): readonly Principal[] {
  return [
    { kind: "world" },
    { kind: "owner", userId: OWNER_ID },
    { kind: "owner", userId: VIEWER_ID }, // someone who is not the owner
    {
      kind: "grant",
      vehicleId,
      includesCosts: true,
      includesReceipts: true,
    },
    {
      kind: "grant",
      vehicleId,
      includesCosts: false,
      includesReceipts: false,
    },
    {
      kind: "grant",
      vehicleId: OTHER_VEHICLE_ID,
      includesCosts: true,
      includesReceipts: true,
    },
  ];
}

function eligibleAcrossPrincipals(
  recordRow: RecordRow,
  vehicleRow: VehicleRow
): boolean[] {
  return everyPrincipal(vehicleRow.id).map((principal) =>
    isEligibleForCommunityEvidence({
      record: recordRow,
      vehicle: vehicleRow,
      principal,
    })
  );
}

/* =========================================================================
 * 1. GAR-04′ — the three clauses, each refusal paired with its acceptance
 * ====================================================================== */

describe("GAR-04′ eligibility, via selectCommunityEvidence", () => {
  it("surfaces a public record, on a public work-log, that references the problem — POSITIVE CONTROL", () => {
    const items = surfaced({
      vehicle: vehicle({ is_worklog_public: true }),
      records: [record({ is_public: true, problem_ids: [PROBLEM_ID] })],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.record.id).toBe(RECORD_ID);
  });

  it("refuses a record whose vehicle's work-log is NOT public (GAR-04′ keys on a public work-log)", () => {
    const items = surfaced({
      vehicle: vehicle({ is_worklog_public: false }),
      // Everything else is as open as it can be: the ONLY thing wrong is the
      // work-log flag, so a pass here would mean the flag is not the key.
      records: [record({ is_public: true, problem_ids: [PROBLEM_ID] })],
    });
    expect(items).toHaveLength(0);
  });

  it("refuses a record the owner has not opened (is_public false), even on a public work-log", () => {
    const items = surfaced({
      vehicle: vehicle({ is_worklog_public: true }),
      records: [record({ is_public: false, problem_ids: [PROBLEM_ID] })],
    });
    expect(items).toHaveLength(0);
  });

  it("refuses a record that references a DIFFERENT problem than this page's", () => {
    const items = surfaced({
      vehicle: vehicle({ is_worklog_public: true }),
      records: [record({ is_public: true, problem_ids: [OTHER_PROBLEM_ID] })],
      problemId: PROBLEM_ID,
    });
    expect(items).toHaveLength(0);
  });

  it("refuses a record that references no problem at all", () => {
    const items = surfaced({
      vehicle: vehicle({ is_worklog_public: true }),
      records: [record({ is_public: true, problem_ids: [] })],
    });
    expect(items).toHaveLength(0);
  });

  it("the predicate isolates each of GAR-04′'s three clauses, world principal", () => {
    // Routing every negative through selectCommunityEvidence is not enough on
    // its own: that path masks a second time (visibility.ts's own
    // `mayReadRecord`), so a break in the eligibility predicate's *work-log*
    // clause alone would still be caught by the mask and hidden from the
    // selector test. These assertions hold the other two clauses satisfied and
    // vary one, so each clause is graded on its own (GRADER-PRINCIPLES.md,
    // "mutation-test each clause of the rule separately").
    const world: Principal = { kind: "world" };
    const base = {
      vehicle: vehicle({ is_worklog_public: true }),
      principal: world,
    };

    // All three satisfied → eligible (POSITIVE CONTROL for the three below).
    expect(
      isEligibleForCommunityEvidence({
        ...base,
        record: record({ is_public: true, problem_ids: [PROBLEM_ID] }),
      })
    ).toBe(true);

    // Only the work-log clause fails.
    expect(
      isEligibleForCommunityEvidence({
        record: record({ is_public: true, problem_ids: [PROBLEM_ID] }),
        vehicle: vehicle({ is_worklog_public: false }),
        principal: world,
      })
    ).toBe(false);

    // Only the per-record opt-in fails.
    expect(
      isEligibleForCommunityEvidence({
        ...base,
        record: record({ is_public: false, problem_ids: [PROBLEM_ID] }),
      })
    ).toBe(false);

    // Only the "references a problem" clause fails.
    expect(
      isEligibleForCommunityEvidence({
        ...base,
        record: record({ is_public: true, problem_ids: [] }),
      })
    ).toBe(false);
  });

  it("refuses a record paired with the WRONG vehicle (record.vehicle_id ≠ vehicle.id)", () => {
    // A programming error — a record from one truck handed alongside another
    // truck's row. The safe answer is to hide it, never to publish one truck's
    // history under another's identity (visibility.ts's recordBelongsToVehicle
    // rule, derived here from the consequence, not from that function).
    const mismatched = record({
      vehicle_id: OTHER_VEHICLE_ID,
      is_public: true,
      problem_ids: [PROBLEM_ID],
    });
    const paired = vehicle({ id: VEHICLE_ID, is_worklog_public: true });

    // Directly at the predicate — isolated from the selector's second mask.
    expect(
      isEligibleForCommunityEvidence({
        record: mismatched,
        vehicle: paired,
        principal: { kind: "world" },
      })
    ).toBe(false);

    // And end-to-end.
    expect(surfaced({ vehicle: paired, records: [mismatched] })).toHaveLength(
      0
    );
  });
});

/* =========================================================================
 * 2. SHR-09 — a grant SHALL NOT make a record eligible
 * ====================================================================== */

describe("SHR-09 — eligibility is world-keyed and grant-independent", () => {
  it("a record made visible only by a typed grant (private work-log) is NOT eligible", () => {
    // The exact state the T2-403 scope guard warns about: a record readable by
    // one grantee (a grant opens the whole vehicle's history, is_public or not)
    // whose work-log was never published. A grant with EVERY capability open,
    // held for THIS vehicle, must not surface it — not through the predicate,
    // and not through the selector.
    const privateWorklog = vehicle({ is_worklog_public: false });
    const grantVisibleRecord = record({
      is_public: false, // never opened to the public
      problem_ids: [PROBLEM_ID],
    });
    const fullGrant: Principal = {
      kind: "grant",
      vehicleId: VEHICLE_ID,
      includesCosts: true,
      includesReceipts: true,
    };

    expect(
      isEligibleForCommunityEvidence({
        record: grantVisibleRecord,
        vehicle: privateWorklog,
        principal: fullGrant,
      })
    ).toBe(false);

    expect(
      surfaced({ vehicle: privateWorklog, records: [grantVisibleRecord] })
    ).toHaveLength(0);
  });

  it("eligibility is identical across every principal — a grant never changes the answer", () => {
    // The structural form of SHR-09: if eligibility varied by principal, then
    // "can this person see it" and "is this public" would be one question —
    // precisely the conflation SHR-09 forbids.
    const publicOne = eligibleAcrossPrincipals(
      record({ is_public: true, problem_ids: [PROBLEM_ID] }),
      vehicle({ is_worklog_public: true })
    );
    // Every principal agrees, and agrees on TRUE — the positive half.
    expect(new Set(publicOne).size).toBe(1);
    expect(publicOne.every((value) => value === true)).toBe(true);

    const privateOne = eligibleAcrossPrincipals(
      record({ is_public: false, problem_ids: [PROBLEM_ID] }),
      vehicle({ is_worklog_public: false })
    );
    // Every principal agrees, and agrees on FALSE — including the full-caps
    // grant on this very vehicle. This is the assertion that fails the moment
    // a grant is allowed to confer eligibility.
    expect(new Set(privateOne).size).toBe(1);
    expect(privateOne.every((value) => value === false)).toBe(true);
  });

  it("surfacing does not depend on who assembled the candidate set", () => {
    // Mix an ineligible (private work-log) source in with an eligible one; the
    // result is exactly the eligible item, and identical to selecting the
    // eligible source alone. The refusal keys on the row, not on the fact that
    // some assembler thought the private one worth including.
    const eligible = source(
      vehicle({ id: VEHICLE_ID, is_worklog_public: true }),
      [record({ id: RECORD_ID, is_public: true, problem_ids: [PROBLEM_ID] })],
      HANDLE
    );
    const ineligible = source(
      vehicle({
        id: OTHER_VEHICLE_ID,
        owner_id: OTHER_OWNER_ID,
        is_worklog_public: false,
      }),
      [
        record({
          id: "00000000-0000-4000-8000-00000000e451",
          vehicle_id: OTHER_VEHICLE_ID,
          is_public: true,
          problem_ids: [PROBLEM_ID],
        }),
      ],
      "test-t2-403-otro"
    );

    const alone = selectCommunityEvidence({
      problemId: PROBLEM_ID,
      sources: [eligible],
    });
    const mixed = selectCommunityEvidence({
      problemId: PROBLEM_ID,
      sources: [ineligible, eligible],
    });

    expect(alone).toHaveLength(1);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]?.record.id).toBe(RECORD_ID);
    expect(mixed).toEqual(alone);
  });
});

/* =========================================================================
 * 3. The surfaced shape carries nothing private (SHR-01, SHR-02, SHR-03)
 * ====================================================================== */

/** Vehicle-row fields the world may never learn — none may reach attribution. */
const PRIVATE_VEHICLE_FIELDS = [
  "owner_id",
  "is_worklog_public",
  "is_showcase_public",
  "photo_paths",
  "cover_photo_path",
  "odometer_km",
] as const;

describe("the surfaced item leaks no private field", () => {
  it("attribution carries the public identity and never owner_id or other private columns", () => {
    const items = surfaced({
      vehicle: vehicle({ is_worklog_public: true }),
      records: [record({ is_public: true, problem_ids: [PROBLEM_ID] })],
    });
    expect(items).toHaveLength(1);
    const attribution = items[0]!.attribution;

    // Positive control: the public identity IS present.
    expect(attribution.handle).toBe(HANDLE);
    expect(attribution.vehicleId).toBe(VEHICLE_ID);
    expect(attribution.displayName).toBe("TEST-T2-403 Gitana");

    // The negative: not one private column survived onto attribution.
    for (const field of PRIVATE_VEHICLE_FIELDS) {
      expect(Object.hasOwn(attribution, field)).toBe(false);
    }
  });

  it("omits the cost keys entirely when the record's cost was not opened (SHR-03)", () => {
    const items = surfaced({
      vehicle: vehicle({ is_worklog_public: true }),
      records: [
        record({
          is_public: true,
          is_cost_public: false,
          problem_ids: [PROBLEM_ID],
        }),
      ],
    });
    expect(items).toHaveLength(1);
    const row = items[0]!.record;
    // Omitted, not blanked: the absent key is the honest "you were not shown
    // this", where `null` would mean "this job was free" (SHR-06 shape).
    expect(Object.hasOwn(row, "cost_amount")).toBe(false);
    expect(Object.hasOwn(row, "cost_currency")).toBe(false);
  });

  it("shows the cost once the record's own cost flag is open — POSITIVE CONTROL", () => {
    const items = surfaced({
      vehicle: vehicle({ is_worklog_public: true }),
      records: [
        record({
          is_public: true,
          is_cost_public: true,
          cost_amount: 245_000,
          cost_currency: "CRC",
          problem_ids: [PROBLEM_ID],
        }),
      ],
    });
    expect(items).toHaveLength(1);
    const row = items[0]!.record;
    expect(Object.hasOwn(row, "cost_amount")).toBe(true);
    expect(row.cost_amount).toBe(245_000);
    expect(row.cost_currency).toBe("CRC");
  });

  it("never carries the visibility flags themselves (they are decisions, not content)", () => {
    const items = surfaced({
      vehicle: vehicle({ is_worklog_public: true }),
      records: [
        record({
          is_public: true,
          is_cost_public: true,
          problem_ids: [PROBLEM_ID],
        }),
      ],
    });
    expect(items).toHaveLength(1);
    const row = items[0]!.record;
    expect(Object.hasOwn(row, "is_public")).toBe(false);
    expect(Object.hasOwn(row, "is_cost_public")).toBe(false);
  });
});

/* =========================================================================
 * 4. communityEvidenceAttribution — the public-identity projection alone
 * ====================================================================== */

describe("communityEvidenceAttribution omits ownership by construction", () => {
  it("copies the public identity and drops owner_id even when the row carries one", () => {
    const attribution = communityEvidenceAttribution(HANDLE, {
      id: VEHICLE_ID,
      display_name: "TEST-T2-403 Gitana",
      generation_id: "gen3",
      market_id: "cr",
      model_year: 2002,
      engine_id: "6g74-sohc",
    });
    expect(attribution.handle).toBe(HANDLE);
    expect(attribution.vehicleId).toBe(VEHICLE_ID);
    expect(Object.hasOwn(attribution, "owner_id")).toBe(false);
  });
});
