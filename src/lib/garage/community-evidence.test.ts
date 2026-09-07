/**
 * The GAR-04′ community-evidence surfacing, at the presentation layer (T2-403).
 *
 * The database is the enforcement boundary (SHR-01) and `tests/garage/`'s
 * `public-pages.test.ts` grades `isEligibleForCommunityEvidence` directly.
 * These tests grade the *second wall* built on top of it — the module that
 * turns a set of published vehicles and their records into the items a problem
 * page renders — so the SHR-09 guarantee ("a grant never puts a private
 * work-log on a public problem page") holds even for a caller that assembled a
 * source out of wider rows than the world may see.
 *
 * refs specs/002-montero-garage (GAR-04′, SHR-09, SHR-01, SHR-02, SHR-03, SHR-06)
 */
import { describe, expect, it } from "vitest";
import type { RecordRow } from "./record.ts";
import type { VehicleRow } from "./vehicle.ts";
import {
  communityEvidenceAttribution,
  communityEvidenceItemsFromWorldRecords,
  compareCommunityEvidenceRecency,
  selectCommunityEvidence,
  type CommunityEvidenceSource,
} from "./community-evidence.ts";
import type { VisibleRecord } from "./visibility.ts";

const OWNER_ID = "00000000-0000-4000-8000-0000024030aa";
const VEHICLE_ID = "00000000-0000-4000-8000-00000000c001";
const PROBLEM_ID = "gen3-timing-belt-overdue";
const OTHER_PROBLEM_ID = "gen3-unstable-idle-and-stalling";

function vehicle(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: VEHICLE_ID,
    owner_id: OWNER_ID,
    display_name: "Gitana Blanca",
    generation_id: "gen3",
    market_id: "cr",
    model_year: 2002,
    engine_id: "6g74-sohc",
    odometer_km: 233_000,
    photo_paths: [],
    cover_photo_path: null,
    is_showcase_public: false,
    is_worklog_public: false,
    ...overrides,
  };
}

let recordCounter = 0;
function record(overrides: Partial<RecordRow> = {}): RecordRow {
  recordCounter += 1;
  return {
    id: `00000000-0000-4000-8000-0000000c${String(recordCounter).padStart(4, "0")}`,
    vehicle_id: VEHICLE_ID,
    occurred_on: "2026-08-30",
    kind: "work",
    title: "Timing belt at 233k",
    body: "Belt, tensioner and both idlers.",
    cost_amount: 245_000,
    cost_currency: "CRC",
    time_minutes: 480,
    odometer_km: 233_000,
    problem_ids: [PROBLEM_ID],
    part_ids: [],
    procedure_ids: [],
    is_public: false,
    is_cost_public: false,
    ...overrides,
  };
}

function source(
  overrides: Partial<CommunityEvidenceSource> = {}
): CommunityEvidenceSource {
  return {
    handle: "gitana",
    vehicle: vehicle({ is_worklog_public: true }),
    records: [record({ is_public: true })],
    ...overrides,
  };
}

function select(source_: CommunityEvidenceSource, problemId = PROBLEM_ID) {
  return selectCommunityEvidence({ problemId, sources: [source_] });
}

describe("SHR-09: a grant never surfaces a record as community evidence", () => {
  it("a public record on a PRIVATE work-log is not surfaced", () => {
    // The exact state typed grants created and GAR-04′ predates: a record
    // visible to one grantee, on a work-log the owner never published. A source
    // built from that grant's data still contributes nothing, because
    // eligibility re-reads `is_worklog_public` off the row.
    const items = select(
      source({
        vehicle: vehicle({ is_worklog_public: false }),
        records: [record({ is_public: true })],
      })
    );

    expect(items).toEqual([]);
  });

  it("a private record on a public work-log is not surfaced", () => {
    // Two switches, and the record's own is the inner one (GAR-04′'s "opt-in
    // per record"). Publishing the work-log does not publish every record on it.
    const items = select(
      source({
        vehicle: vehicle({ is_worklog_public: true }),
        records: [record({ is_public: false })],
      })
    );

    expect(items).toEqual([]);
  });

  it("a record whose vehicle_id does not match its source vehicle is not surfaced", () => {
    // A source that pairs a record with the wrong vehicle is a programming
    // error, and the two wrong answers are "show it" and "hide it". The module
    // hides it — the same conservative reading `visibility.ts` takes — because
    // guessing the other way surfaces one truck's history under another's name.
    const items = select(
      source({
        records: [
          record({
            is_public: true,
            vehicle_id: "00000000-0000-4000-8000-00000000c999",
          }),
        ],
      })
    );

    expect(items).toEqual([]);
  });
});

describe("GAR-04′: eligible records surface on the problem they name", () => {
  it("an eligible public record on a public work-log IS surfaced — POSITIVE CONTROL", () => {
    // Without this, every denial above is satisfied by a module that surfaces
    // nothing at all.
    const items = select(source());

    expect(items).toHaveLength(1);
    expect(items[0]?.record.title).toBe("Timing belt at 233k");
  });

  it("a record that references a DIFFERENT problem is not surfaced here", () => {
    const items = select(
      source({
        records: [record({ is_public: true, problem_ids: [OTHER_PROBLEM_ID] })],
      })
    );

    expect(items).toEqual([]);
  });

  it("a record that references no problem at all is not surfaced", () => {
    const items = select(
      source({ records: [record({ is_public: true, problem_ids: [] })] })
    );

    expect(items).toEqual([]);
  });

  it("a record that references several problems surfaces on each one it names", () => {
    const shared = record({
      is_public: true,
      problem_ids: [PROBLEM_ID, OTHER_PROBLEM_ID],
    });

    expect(select(source({ records: [shared] }), PROBLEM_ID)).toHaveLength(1);
    expect(
      select(source({ records: [shared] }), OTHER_PROBLEM_ID)
    ).toHaveLength(1);
  });
});

describe("SHR-03 / SHR-06: costs stay private unless opened per record", () => {
  it("a public record OMITS its cost keys until the cost is opened", () => {
    // Key absence, not `cost_amount: null` — the absent key says "you were not
    // shown this", and a null would say "this job was free" (a different, untrue
    // claim). The same reading the world reader and the work-log page settled.
    const [item] = select(
      source({ records: [record({ is_public: true, is_cost_public: false })] })
    );

    expect(item).toBeDefined();
    expect(Object.hasOwn(item!.record, "cost_amount")).toBe(false);
    expect(Object.hasOwn(item!.record, "cost_currency")).toBe(false);
  });

  it("the cost appears once the record's own cost flag is open", () => {
    const [item] = select(
      source({ records: [record({ is_public: true, is_cost_public: true })] })
    );

    expect(Object.hasOwn(item!.record, "cost_amount")).toBe(true);
    expect(item!.record.cost_amount).toBe(245_000);
    expect(item!.record.cost_currency).toBe("CRC");
  });

  it("the surfaced record never carries the visibility flags themselves", () => {
    const [item] = select(
      source({ records: [record({ is_public: true, is_cost_public: true })] })
    );

    expect(Object.hasOwn(item!.record, "is_public")).toBe(false);
    expect(Object.hasOwn(item!.record, "is_cost_public")).toBe(false);
  });
});

describe("attribution is public identity, never ownership", () => {
  it("carries the public handle and taxonomy identity", () => {
    const attribution = communityEvidenceAttribution("gitana", vehicle());

    expect(attribution).toEqual({
      handle: "gitana",
      vehicleId: VEHICLE_ID,
      displayName: "Gitana Blanca",
      generationId: "gen3",
      marketId: "cr",
      modelYear: 2002,
      engineId: "6g74-sohc",
    });
  });

  it("never carries the owner id", () => {
    const attribution = communityEvidenceAttribution("gitana", vehicle());

    expect(Object.hasOwn(attribution, "owner_id")).toBe(false);
    expect(Object.values(attribution)).not.toContain(OWNER_ID);
  });

  it("an item names the truck it came from", () => {
    const [item] = select(source());

    expect(item!.attribution.handle).toBe("gitana");
    expect(item!.attribution.vehicleId).toBe(VEHICLE_ID);
    expect(item!.attribution.displayName).toBe("Gitana Blanca");
  });
});

describe("aggregation and ordering across sources", () => {
  it("aggregates eligible evidence from several published trucks", () => {
    const other = source({
      handle: "otra-montero",
      vehicle: vehicle({
        id: "00000000-0000-4000-8000-00000000c777",
        owner_id: "00000000-0000-4000-8000-0000024030bb",
        display_name: "La Otra",
        is_worklog_public: true,
      }),
      records: [
        record({
          is_public: true,
          vehicle_id: "00000000-0000-4000-8000-00000000c777",
          occurred_on: "2025-01-01",
        }),
      ],
    });

    const items = selectCommunityEvidence({
      problemId: PROBLEM_ID,
      sources: [source(), other],
    });

    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.attribution.handle))).toEqual(
      new Set(["gitana", "otra-montero"])
    );
  });

  it("orders items newest first", () => {
    const items = select(
      source({
        records: [
          record({ is_public: true, occurred_on: "2020-01-01" }),
          record({ is_public: true, occurred_on: "2026-06-15" }),
          record({ is_public: true, occurred_on: "2023-03-03" }),
        ],
      })
    );

    expect(items.map((item) => item.record.occurred_on)).toEqual([
      "2026-06-15",
      "2023-03-03",
      "2020-01-01",
    ]);
  });

  it("breaks a same-day tie deterministically by id", () => {
    const a = record({
      id: "aaaa",
      is_public: true,
      occurred_on: "2026-06-15",
    });
    const b = record({
      id: "bbbb",
      is_public: true,
      occurred_on: "2026-06-15",
    });

    expect(
      select(source({ records: [b, a] })).map((item) => item.record.id)
    ).toEqual(["aaaa", "bbbb"]);
  });
});

describe("the world-record path shares the same shaping", () => {
  const attribution = communityEvidenceAttribution("gitana", vehicle());

  function visible(overrides: Partial<VisibleRecord> = {}): VisibleRecord {
    return {
      id: "vr1",
      vehicle_id: VEHICLE_ID,
      occurred_on: "2026-08-30",
      kind: "work",
      title: "Timing belt at 233k",
      body: null,
      time_minutes: 480,
      odometer_km: 233_000,
      problem_ids: [PROBLEM_ID],
      part_ids: [],
      procedure_ids: [],
      ...overrides,
    };
  }

  it("keeps records that name this problem", () => {
    const items = communityEvidenceItemsFromWorldRecords({
      problemId: PROBLEM_ID,
      attribution,
      records: [visible()],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.attribution).toBe(attribution);
  });

  it("drops records that name a different problem", () => {
    const items = communityEvidenceItemsFromWorldRecords({
      problemId: PROBLEM_ID,
      attribution,
      records: [visible({ problem_ids: [OTHER_PROBLEM_ID] })],
    });

    expect(items).toEqual([]);
  });

  it("compareCommunityEvidenceRecency sorts newest first", () => {
    const older = {
      record: visible({ id: "old", occurred_on: "2020-01-01" }),
      attribution,
    };
    const newer = {
      record: visible({ id: "new", occurred_on: "2026-01-01" }),
      attribution,
    };

    expect([older, newer].sort(compareCommunityEvidenceRecency)).toEqual([
      newer,
      older,
    ]);
  });
});
