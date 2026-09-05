/**
 * Graders — **per-record cost masking, the showcase toggle, and SHR-09.**
 * Declared by T2-401 [TEST], activated by T2-402 / T2-403 / T2-404.
 *
 * > **SHR-03** Costs and receipts SHALL stay private even on a public work-log
 * > unless opened per record.
 * > **SHR-06** … WHERE a grant does not open costs, THE data returned SHALL
 * > **omit the cost fields entirely** rather than blanking them at render time.
 * > **SHR-09** A grant SHALL NOT make a record eligible for the community
 * > evidence surfacing of GAR-04′.
 *
 * ## One masking function, three principals — and why that is the requirement
 *
 * T2-402's amendment of 2026-08-31 is explicit: the per-record cost-masking
 * logic must be **parameterised by principal**, not written once for "the
 * public", because T2-404 needs the same masking for a different audience and
 * "a second copy of a privacy rule is a second place for it to drift".
 *
 * So these graders never ask "what does the work-log page render". They ask
 * `maskRecordForPrincipal` the same question three times with three principals,
 * and the table below is the whole of SHR-03 and SHR-06 in one place. A future
 * fourth audience (003's roster view) joins the table; it does not fork the
 * function.
 *
 * ## Omission is asserted as key absence, deliberately
 *
 * `cost_amount: null` is a value, and the value means *this job was free*.
 * The absence of the key is the only honest way to say *you were not shown
 * this*. A render layer handed `null` cannot tell them apart, and one of them
 * is a lie about somebody's money — so the assertions use `Object.hasOwn`, not
 * `toBeNull()`. This is the same "unknown is not zero" rule the constitution
 * names, one surface over.
 *
 * ## Expected-failure convention — **activated by T2-402 (2026-09-03)**
 *
 * `it.fails` was the marker while `src/lib/garage/visibility.ts` was a seam
 * whose functions threw `not implemented: T2-401`, and an unmarked control
 * asserted they threw *that*, so a marker could never be satisfied by an
 * accidental value. T2-402 filled the seam: every marker below is deleted and
 * the graders now assert the requirement directly. The seam control went with
 * the seam — a control that asserts "this still throws" is exactly the grader
 * that must fail once the thing is built, and leaving it would make a green
 * suite impossible rather than meaningful.
 *
 * refs specs/002-montero-garage (SHR-02, SHR-03, SHR-06, SHR-09, GAR-04′)
 */
import { describe, expect, it } from "vitest";
import type { RecordRow } from "../../src/lib/garage/record.ts";
import type { VehicleRow } from "../../src/lib/garage/vehicle.ts";
import type { ReceiptRow } from "../../src/lib/garage/receipt.ts";
import {
  isEligibleForCommunityEvidence,
  maskRecordForPrincipal,
  maskRecordsForPrincipal,
  visibleReceipts,
  type Principal,
} from "../../src/lib/garage/visibility.ts";
import {
  TEST_TAXONOMY_IDENTITY,
  testReceiptPath,
  testVehicleName,
} from "./contract.ts";
import {
  createOwnedFixture,
  detectLiveStack,
  insertRow,
  liveTitle,
  provisionScenario,
  selectRows,
  stackOf,
  teardownScenario,
  updateRows,
} from "./harness.ts";

const live = await detectLiveStack();

const OWNER_ID = "00000000-0000-4000-8000-0000024010aa";
const VEHICLE_ID = "00000000-0000-4000-8000-00000000a001";

/** A vehicle with both toggles closed — SHR-01's default state. */
function vehicle(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: VEHICLE_ID,
    owner_id: OWNER_ID,
    display_name: testVehicleName("a"),
    generation_id: TEST_TAXONOMY_IDENTITY.generation_id,
    market_id: TEST_TAXONOMY_IDENTITY.market_id,
    model_year: TEST_TAXONOMY_IDENTITY.model_year,
    engine_id: TEST_TAXONOMY_IDENTITY.engine_id,
    odometer_km: 233_000,
    photo_paths: [],
    is_showcase_public: false,
    is_worklog_public: false,
    ...overrides,
  };
}

/** A record with a real cost on it, private by default. */
function record(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: "00000000-0000-4000-8000-00000000a002",
    vehicle_id: VEHICLE_ID,
    occurred_on: "2026-08-30",
    kind: "work",
    title: "TEST-T2-401 timing belt",
    body: null,
    cost_amount: 245_000,
    cost_currency: "CRC",
    time_minutes: 480,
    odometer_km: 233_000,
    problem_ids: ["test-t2-401-problem"],
    part_ids: [],
    procedure_ids: [],
    is_public: false,
    is_cost_public: false,
    ...overrides,
  };
}

function receipt(): ReceiptRow {
  return {
    id: "00000000-0000-4000-8000-00000000a003",
    record_id: "00000000-0000-4000-8000-00000000a002",
    storage_path: testReceiptPath(OWNER_ID, "1"),
    vendor: "TEST-T2-401-VENDOR",
    issued_on: "2026-08-30",
    amount: 245_000,
    currency: "CRC",
  };
}

const OWNER: Principal = { kind: "owner", userId: OWNER_ID };
const WORLD: Principal = { kind: "world" };
const grantee = (
  includesCosts: boolean,
  includesReceipts: boolean
): Principal => ({
  kind: "grant",
  vehicleId: VEHICLE_ID,
  includesCosts,
  includesReceipts,
});

/* =========================================================================
 * SHR-03 — the world's view.
 * ====================================================================== */

describe("the public work-log (SHR-02, SHR-03)", () => {
  it("a private record is not visible to the world at all", () => {
    // SHR-01's default, at the render layer. The database is the enforcement
    // boundary; this is the second wall, and it exists because a page that
    // somehow receives a wider row must still not be able to render it.
    expect(
      maskRecordForPrincipal({
        record: record({ is_public: false }),
        vehicle: vehicle({ is_worklog_public: true }),
        principal: WORLD,
      })
    ).toBeNull();
  });

  it("no record is visible when the WORK-LOG itself is private", () => {
    // Two switches, and the vehicle's is the outer one. A record marked
    // `is_public` on a vehicle whose work-log was never published is a record
    // the owner staged, not one they released.
    expect(
      maskRecordForPrincipal({
        record: record({ is_public: true }),
        vehicle: vehicle({ is_worklog_public: false }),
        principal: WORLD,
      })
    ).toBeNull();
  });

  it("a public record is visible — POSITIVE CONTROL", () => {
    // Without this, every denial above is satisfied by a function that returns
    // `null` for everything, i.e. a work-log page nobody can publish.
    const masked = maskRecordForPrincipal({
      record: record({ is_public: true }),
      vehicle: vehicle({ is_worklog_public: true }),
      principal: WORLD,
    });

    expect(masked).not.toBeNull();
    expect(masked?.id).toBe(record().id);
    expect(masked?.title).toBe(record().title);
  });

  it("a public record OMITS its cost until the cost is opened", () => {
    // SHR-03. Asserted as key absence: `cost_amount: null` would say the job
    // was free, which is a different and untrue claim.
    const masked = maskRecordForPrincipal({
      record: record({ is_public: true, is_cost_public: false }),
      vehicle: vehicle({ is_worklog_public: true }),
      principal: WORLD,
    });

    expect(Object.hasOwn(masked ?? {}, "cost_amount")).toBe(false);
    expect(Object.hasOwn(masked ?? {}, "cost_currency")).toBe(false);
  });

  it("the cost appears once the record's own cost flag is open", () => {
    const masked = maskRecordForPrincipal({
      record: record({ is_public: true, is_cost_public: true }),
      vehicle: vehicle({ is_worklog_public: true }),
      principal: WORLD,
    });

    expect(Object.hasOwn(masked ?? {}, "cost_amount")).toBe(true);
    expect(masked?.cost_amount).toBe(245_000);
  });

  it("the mask never leaks the visibility flags themselves", () => {
    // A published record carrying `is_public` and `is_cost_public` tells a
    // reader which of the owner's *other* decisions they are not seeing. Small,
    // and exactly the kind of thing that ships because nobody asked.
    const masked = maskRecordForPrincipal({
      record: record({ is_public: true, is_cost_public: true }),
      vehicle: vehicle({ is_worklog_public: true }),
      principal: WORLD,
    });

    expect(Object.hasOwn(masked ?? {}, "is_public")).toBe(false);
    expect(Object.hasOwn(masked ?? {}, "is_cost_public")).toBe(false);
  });

  it("the owner sees everything, unmasked", () => {
    // The third principal, and the one that must not be affected by any of the
    // above. An owner who cannot see their own costs has had their garage
    // broken by a privacy feature.
    const masked = maskRecordForPrincipal({
      record: record(),
      vehicle: vehicle(),
      principal: OWNER,
    });

    expect(masked?.cost_amount).toBe(245_000);
    expect(masked?.cost_currency).toBe("CRC");
  });

  it("the timeline mask drops hidden records rather than nulling them", () => {
    // A list with holes in it is a list that leaks a count. "Three records, two
    // of which you may not see" is information the owner did not publish.
    const timeline = maskRecordsForPrincipal({
      records: [
        record({ id: "r1", is_public: true }),
        record({ id: "r2", is_public: false }),
      ],
      vehicle: vehicle({ is_worklog_public: true }),
      principal: WORLD,
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.id).toBe("r1");
  });
});

/* =========================================================================
 * SHR-06 — the grantee's view, same function.
 * ====================================================================== */

describe("a grant holder is a principal, not a second code path (SHR-06)", () => {
  it("sees a record the world cannot — that is what the grant buys", () => {
    // The grant's whole purpose: "hand my mechanic this truck's whole history".
    // A private record on a private work-log, visible to the holder and nobody
    // else.
    const masked = maskRecordForPrincipal({
      record: record({ is_public: false }),
      vehicle: vehicle({ is_worklog_public: false }),
      principal: grantee(true, true),
    });

    expect(masked).not.toBeNull();
  });

  it.each<[boolean, boolean]>([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "costs=%s receipts=%s — each capability answers only for itself",
    (includesCosts, includesReceipts) => {
      // The cell that matters is `costs=false receipts=true`: it cannot be
      // expressed by one "full access" boolean, and it is the one a reader that
      // gates receipts behind costs gets wrong.
      const principal = grantee(includesCosts, includesReceipts);
      const masked = maskRecordForPrincipal({
        record: record(),
        vehicle: vehicle(),
        principal,
      });
      const receipts = visibleReceipts({
        receipts: [receipt()],
        record: record(),
        vehicle: vehicle(),
        principal,
      });

      expect(Object.hasOwn(masked ?? {}, "cost_amount")).toBe(includesCosts);
      expect(receipts.length > 0).toBe(includesReceipts);
    }
  );

  it("a grant on another vehicle shows nothing of this one", () => {
    // A grant admits its holder to ONE vehicle (SHR-05). The failure mode — a
    // reader that resolves the token to an *owner* and then reads that owner's
    // records — returns exactly the right answer for the single-vehicle case
    // everybody tests by hand.
    expect(
      maskRecordForPrincipal({
        record: record(),
        vehicle: vehicle(),
        principal: {
          kind: "grant",
          vehicleId: "00000000-0000-4000-8000-00000000b001",
          includesCosts: true,
          includesReceipts: true,
        },
      })
    ).toBeNull();
  });

  it("a receipt is invisible to the world even on a public record", () => {
    // GAR-05′: receipts are "never publicly accessible unless the specific
    // record's cost visibility is opened", and SHR-03 says the same from the
    // other side. The world is not a grantee and has no `includes_receipts`.
    expect(
      visibleReceipts({
        receipts: [receipt()],
        record: record({ is_public: true, is_cost_public: false }),
        vehicle: vehicle({ is_worklog_public: true }),
        principal: WORLD,
      })
    ).toEqual([]);
  });
});

/* =========================================================================
 * SHR-09 — a grant is not publication.
 * ====================================================================== */

describe("SHR-09: a grant never makes a record community-eligible", () => {
  it("a record visible only to a grantee is NOT eligible", () => {
    // > That path keys on a *public* work-log; a record visible to one grantee
    // > is not public, and treating it as such would put a private work-log on
    // > a public problem page.
    //
    // T2-403's scope guard adds the line that makes this worth a grader of its
    // own: getting it wrong "will look like a feature working correctly right
    // up until someone notices".
    expect(
      isEligibleForCommunityEvidence({
        record: record({ is_public: true }),
        vehicle: vehicle({ is_worklog_public: false }),
        principal: grantee(true, true),
      })
    ).toBe(false);
  });

  it("eligibility does not depend on WHO is asking", () => {
    // The structural form of SHR-09. If eligibility varied by principal, then
    // "can this person see it" and "is this public" would be the same question
    // — which is precisely the conflation the requirement forbids.
    const input = {
      record: record({ is_public: true }),
      vehicle: vehicle({ is_worklog_public: false }),
    };

    expect(isEligibleForCommunityEvidence({ ...input, principal: OWNER })).toBe(
      isEligibleForCommunityEvidence({ ...input, principal: WORLD })
    );
    expect(
      isEligibleForCommunityEvidence({
        ...input,
        principal: grantee(true, true),
      })
    ).toBe(isEligibleForCommunityEvidence({ ...input, principal: WORLD }));
  });

  it("a public record on a PUBLIC work-log IS eligible — POSITIVE CONTROL", () => {
    // GAR-04′ is a feature. Without this, every denial above is satisfied by a
    // function that returns `false` and a community-evidence surface that never
    // shows anything.
    expect(
      isEligibleForCommunityEvidence({
        record: record({ is_public: true }),
        vehicle: vehicle({ is_worklog_public: true }),
        principal: WORLD,
      })
    ).toBe(true);
  });

  it("a record with no problem reference is never eligible", () => {
    // GAR-04′ surfaces a record *on a problem page*. A record that references
    // no problem has no page to appear on, and a surface that showed it anyway
    // would be publishing a work-log entry with no reason at all.
    expect(
      isEligibleForCommunityEvidence({
        record: record({ is_public: true, problem_ids: [] }),
        vehicle: vehicle({ is_worklog_public: true }),
        principal: WORLD,
      })
    ).toBe(false);
  });
});

/* =========================================================================
 * Tier B — the showcase toggle, round-tripped.
 * ====================================================================== */

describe.skipIf(!live.available)(
  liveTitle("the showcase toggle round-trips (SHR-02)", live),
  () => {
    it("an owner can publish and then UNPUBLISH a showcase", async () => {
      // Unmarked: `is_showcase_public` exists today and the round trip is the
      // claim SHR-02 makes. The half that gets forgotten is the way back —
      // publishing is the feature everybody builds, unpublishing is the one
      // somebody needs at 2am, and a toggle that only goes one way is a
      // privacy incident with a UI.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const created = await insertRow(scenario, scenario.ownerA, "vehicles", {
          owner_id: scenario.ownerA.userId,
          display_name: testVehicleName("a"),
          ...TEST_TAXONOMY_IDENTITY,
        });
        const rows = Array.isArray(created.body) ? created.body : [];
        const id = (rows[0] as { id?: string } | undefined)?.id;

        expect(id).toBeTruthy();

        const published = await updateRows(
          scenario,
          scenario.ownerA,
          "vehicles",
          `id=eq.${id}`,
          { is_showcase_public: true }
        );
        const backRows = Array.isArray(published.body) ? published.body : [];
        expect(
          (backRows[0] as { is_showcase_public?: boolean } | undefined)
            ?.is_showcase_public
        ).toBe(true);

        const withdrawn = await updateRows(
          scenario,
          scenario.ownerA,
          "vehicles",
          `id=eq.${id}`,
          { is_showcase_public: false }
        );
        const finalRows = Array.isArray(withdrawn.body) ? withdrawn.body : [];
        expect(
          (finalRows[0] as { is_showcase_public?: boolean } | undefined)
            ?.is_showcase_public
        ).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("owner B cannot publish owner A's vehicle", async () => {
      // Unmarked. Publishing is a write, and the write policy is the same one
      // every other cross-user grader proves — but this is the write whose
      // consequence is a stranger's truck on the public internet, so it gets
      // its own line.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const owned = await createOwnedFixture(
          scenario,
          scenario.ownerA,
          testReceiptPath(scenario.ownerA.userId ?? "", "1")
        );

        await updateRows(
          scenario,
          scenario.ownerB,
          "vehicles",
          `id=eq.${owned.vehicleId}`,
          { is_showcase_public: true }
        );

        const readBack = await selectRows(
          scenario,
          scenario.ownerA,
          "vehicles",
          `id=eq.${owned.vehicleId}`
        );
        const rows = Array.isArray(readBack.body) ? readBack.body : [];

        expect(
          (rows[0] as { is_showcase_public?: boolean } | undefined)
            ?.is_showcase_public
        ).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("the work-log toggle is independent of the showcase toggle", async () => {
      // Two pages, two decisions (SHR-02 names them separately). Publishing a
      // photo gallery is not publishing a maintenance history with dates,
      // odometer readings, and a home town in the vendor names.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const created = await insertRow(scenario, scenario.ownerA, "vehicles", {
          owner_id: scenario.ownerA.userId,
          display_name: testVehicleName("a"),
          ...TEST_TAXONOMY_IDENTITY,
          is_showcase_public: true,
        });
        const rows = Array.isArray(created.body) ? created.body : [];
        const vehicleRow = rows[0] as
          | { is_showcase_public?: boolean; is_worklog_public?: boolean }
          | undefined;

        expect(vehicleRow?.is_showcase_public).toBe(true);
        expect(vehicleRow?.is_worklog_public).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);
