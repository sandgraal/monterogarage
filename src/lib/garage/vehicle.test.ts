import { describe, expect, it } from "vitest";
import {
  EMPTY_DRAFT,
  MAX_DISPLAY_NAME_LENGTH,
  draftFromVehicleRow,
  normalizeDisplayName,
  sortVehicles,
  validateVehicleDraft,
  vehiclePhotoPaths,
  vehicleSelectionOf,
  vehicleWriteFromDraft,
  type VehicleDraft,
  type VehicleRow,
} from "./vehicle.ts";
import { parseVehicleSelection } from "../vehicle-selection.ts";

/** The archetype the spec names: Gitana Blanca, a 2002 US-market Gen 3. */
const COMPLETE: VehicleDraft = {
  displayName: "Gitana Blanca",
  gen: "gen3",
  market: "us",
  year: "2002",
  engine: "6g74-sohc",
  odometer: "247500",
  odometerUnit: "km",
};

function row(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "22222222-2222-4222-8222-222222222222",
    display_name: "Gitana Blanca",
    generation_id: "gen3",
    market_id: "us",
    model_year: 2002,
    engine_id: "6g74-sohc",
    odometer_km: 247500,
    photo_paths: [],
    cover_photo_path: null,
    is_showcase_public: false,
    is_worklog_public: false,
    ...overrides,
  };
}

describe("normalizeDisplayName", () => {
  it("collapses the whitespace a paste brings with it", () => {
    expect(normalizeDisplayName("  Gitana   Blanca \n")).toBe("Gitana Blanca");
  });
});

describe("validateVehicleDraft", () => {
  it("accepts a complete profile", () => {
    expect(validateVehicleDraft(COMPLETE)).toEqual([]);
  });

  it("requires a display name — the user names their truck", () => {
    expect(
      validateVehicleDraft({ ...COMPLETE, displayName: "   " })
    ).toContainEqual({ field: "displayName", code: "required" });
  });

  it("caps the display name", () => {
    expect(
      validateVehicleDraft({
        ...COMPLETE,
        displayName: "G".repeat(MAX_DISPLAY_NAME_LENGTH + 1),
      })
    ).toContainEqual({ field: "displayName", code: "too-long" });
  });

  it("requires a generation, because the column is not null", () => {
    expect(validateVehicleDraft({ ...COMPLETE, gen: "" })).toContainEqual({
      field: "gen",
      code: "required",
    });
  });

  it("accepts a profile that names only its generation", () => {
    // The contract leaves market, year and engine nullable on purpose: an
    // owner who has never looked up their engine code still gets a garage.
    expect(
      validateVehicleDraft({
        ...EMPTY_DRAFT,
        displayName: "La Blanca",
        gen: "gen2",
      })
    ).toEqual([]);
  });

  it("refuses a generation outside the taxonomy vocabulary", () => {
    expect(validateVehicleDraft({ ...COMPLETE, gen: "gen9" })).toContainEqual({
      field: "gen",
      code: "unknown",
    });
  });

  it("refuses a market outside the taxonomy vocabulary", () => {
    expect(
      validateVehicleDraft({ ...COMPLETE, market: "atlantis" })
    ).toContainEqual({ field: "market", code: "unknown" });
  });

  it("refuses a year outside the production range", () => {
    for (const year of ["1975", "2099", "20 02"]) {
      expect(validateVehicleDraft({ ...COMPLETE, year }), year).toContainEqual({
        field: "year",
        code: "out-of-range",
      });
    }
  });

  it("refuses an engine id that is not shaped like a taxonomy id", () => {
    expect(
      validateVehicleDraft({ ...COMPLETE, engine: "6G74 SOHC" })
    ).toContainEqual({ field: "engine", code: "unknown" });
  });

  it("reports the odometer issue the parser found", () => {
    expect(
      validateVehicleDraft({ ...COMPLETE, odometer: "a lot" })
    ).toContainEqual({ field: "odometer", code: "not-a-number" });
  });

  it("reports every issue at once, not the first one", () => {
    const issues = validateVehicleDraft({
      ...EMPTY_DRAFT,
      odometer: "-1",
    });

    expect(issues.map((issue) => issue.field).sort()).toEqual([
      "displayName",
      "gen",
      "odometer",
    ]);
  });
});

describe("vehicleWriteFromDraft", () => {
  it("carries the columns a person filled in, and only those", () => {
    const write = vehicleWriteFromDraft(COMPLETE);
    expect(write).not.toBeNull();
    expect(Object.keys(write ?? {}).sort()).toEqual([
      "display_name",
      "engine_id",
      "generation_id",
      "market_id",
      "model_year",
      "odometer_km",
    ]);
  });

  it("never sends a share flag — private-by-default is the schema's job", () => {
    // SHR-01. A create path that transmits visibility is a create path where a
    // typo publishes somebody's truck.
    const write = vehicleWriteFromDraft(COMPLETE) ?? {};
    expect(Object.keys(write)).not.toContain("is_showcase_public");
    expect(Object.keys(write)).not.toContain("is_worklog_public");
  });

  it("never sends owner_id or photo_paths from the profile form", () => {
    // `owner_id` is the data layer's, from the session, and the policy is what
    // decides whether to believe it. `photo_paths` changes one upload at a
    // time; folding it into the form's save would let a stale field drop a
    // photo somebody just added in another tab.
    const write = vehicleWriteFromDraft(COMPLETE) ?? {};
    expect(Object.keys(write)).not.toContain("owner_id");
    expect(Object.keys(write)).not.toContain("photo_paths");
  });

  it("writes an unanswered facet as null, not as an empty string", () => {
    const write = vehicleWriteFromDraft({
      ...EMPTY_DRAFT,
      displayName: "La Blanca",
      gen: "gen2",
    });

    expect(write).toEqual({
      display_name: "La Blanca",
      generation_id: "gen2",
      market_id: null,
      model_year: null,
      engine_id: null,
      odometer_km: null,
    });
  });

  it("stores a mileage reading in kilometres", () => {
    expect(
      vehicleWriteFromDraft({
        ...COMPLETE,
        odometer: "100000",
        odometerUnit: "mi",
      })?.odometer_km
    ).toBe(160934);
  });

  it("refuses to build a write from an invalid draft", () => {
    expect(vehicleWriteFromDraft({ ...COMPLETE, displayName: "" })).toBeNull();
  });
});

describe("draftFromVehicleRow", () => {
  it("round-trips a row through the form and back", () => {
    expect(vehicleWriteFromDraft(draftFromVehicleRow(row(), "km"))).toEqual({
      display_name: "Gitana Blanca",
      generation_id: "gen3",
      market_id: "us",
      model_year: 2002,
      engine_id: "6g74-sohc",
      odometer_km: 247500,
    });
  });

  it("shows a stored row in the reader's own unit", () => {
    expect(draftFromVehicleRow(row(), "mi").odometer).toBe("153789");
  });

  it("does not move an odometer nobody touched, saving in miles", () => {
    // 247 500 km displays as 153 789 mi, which converts back to 247 499 — so
    // a save that only renamed the truck would walk the odometer down one
    // kilometre, every time. `previous` is what stops it.
    const stored = row();
    const asMiles = draftFromVehicleRow(stored, "mi");

    const renamed = vehicleWriteFromDraft(
      { ...asMiles, displayName: "La Blanca" },
      stored
    );

    expect(renamed?.odometer_km).toBe(247500);
  });

  it("does convert an odometer the reader actually retyped", () => {
    const stored = row();
    const asMiles = draftFromVehicleRow(stored, "mi");

    const driven = vehicleWriteFromDraft(
      { ...asMiles, odometer: "154000" },
      stored
    );

    expect(driven?.odometer_km).toBe(247839);
  });

  it("carries an absent odometer over untouched instead of inventing zero", () => {
    const stored = row({ odometer_km: null });
    const draft = draftFromVehicleRow(stored, "mi");

    expect(
      vehicleWriteFromDraft({ ...draft, displayName: "La Blanca" }, stored)
        ?.odometer_km
    ).toBeNull();
  });

  it("shows an absent odometer as an empty field, not as zero", () => {
    expect(draftFromVehicleRow(row({ odometer_km: null }), "km").odometer).toBe(
      ""
    );
  });
});

describe("vehicleSelectionOf", () => {
  it("hands the fitment engine a selection it accepts", () => {
    const selection = vehicleSelectionOf(row());
    // The proof that this is the same currency T204's selector spends: the
    // 001 parser has to accept it unchanged.
    expect(parseVehicleSelection(selection)).toEqual({
      gen: "gen3",
      market: "us",
      year: 2002,
      engine: "6g74-sohc",
    });
  });

  it("returns null for a partial identity rather than a partial truck", () => {
    expect(vehicleSelectionOf(row({ engine_id: null }))).toBeNull();
    expect(vehicleSelectionOf(row({ market_id: null }))).toBeNull();
    expect(vehicleSelectionOf(row({ model_year: null }))).toBeNull();
  });

  it("returns null when a stored id has fallen out of the vocabulary", () => {
    expect(vehicleSelectionOf(row({ generation_id: "gen9" }))).toBeNull();
    expect(vehicleSelectionOf(row({ market_id: "atlantis" }))).toBeNull();
    expect(vehicleSelectionOf(row({ model_year: 1970 }))).toBeNull();
  });
});

describe("vehiclePhotoPaths", () => {
  const owner = "22222222-2222-4222-8222-222222222222";
  const id = "11111111-1111-4111-8111-111111111111";

  it("keeps the paths that live under this vehicle's own prefix", () => {
    const paths = [`${owner}/${id}/a.jpg`, `${owner}/${id}/b.webp`];
    expect(
      vehiclePhotoPaths(row({ owner_id: owner, id, photo_paths: paths }))
    ).toEqual(paths);
  });

  it("drops a path pointing at another owner or another vehicle", () => {
    const stray = [
      `33333333-3333-4333-8333-333333333333/${id}/a.jpg`,
      `${owner}/44444444-4444-4444-8444-444444444444/a.jpg`,
      `${owner}/${id}/nested/a.jpg`,
      "a.jpg",
      "",
    ];

    expect(
      vehiclePhotoPaths(row({ owner_id: owner, id, photo_paths: stray }))
    ).toEqual([]);
  });
});

describe("sortVehicles", () => {
  it("orders by display name, ignoring case and accents", () => {
    const rows = [
      row({ id: "c", display_name: "Zorro" }),
      row({ id: "a", display_name: "ámbar" }),
      row({ id: "b", display_name: "Gitana Blanca" }),
    ];

    expect(
      sortVehicles(rows, "es-CR").map((entry) => entry.display_name)
    ).toEqual(["ámbar", "Gitana Blanca", "Zorro"]);
  });

  it("breaks a tie by id so the order never flickers", () => {
    const rows = [
      row({ id: "b", display_name: "Gitana" }),
      row({ id: "a", display_name: "Gitana" }),
    ];

    expect(sortVehicles(rows, "en-US").map((entry) => entry.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
