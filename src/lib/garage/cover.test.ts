/**
 * Graders — the cover-photo render helper (T2-306a [TEST]).
 *
 * > **GAR-01′** A user SHALL be able to designate one uploaded photo as the
 * > vehicle's **cover photo** … Removing the designated cover photo SHALL
 * > leave the vehicle with no cover rather than silently promoting another
 * > one; a vehicle with photos but no cover renders the same placeholder image
 * > used when the vehicle has no photos.
 *
 * The database half of this requirement — the column, the membership
 * constraint, the trigger that clears a departed cover, and the two-tab race —
 * is graded in `tests/garage/cover-photo.test.ts`. This file grades the half
 * no SQL can see: **what a page renders**, given a row.
 *
 * ## Why the render half needs graders of its own
 *
 * "Never just the first array entry" is a rendering rule. A schema can hold a
 * perfectly correct `cover_photo_path` while a card renders `photo_paths[0]`
 * beside it, and every database grader in this repo would stay green. That is
 * not hypothetical — `src/lib/garage/photos.ts` still documents the *old*
 * convention in its own header ("That column is where order lives (the first
 * path is the cover photo)"), written before this requirement existed. The
 * convention T2-306 replaces is currently the one written down, so the grader
 * that keeps it replaced has to exist.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker; T2-306 activates a grader by deleting exactly that
 * `.fails`. The unmarked graders at the foot of the file are controls on this
 * file's own fixtures and on the seam, and they pass today.
 *
 * refs specs/002-montero-garage (GAR-01′, SHR-01, SHR-02)
 */
import { describe, expect, it } from "vitest";
import {
  COVER_SEAM,
  coverPhotoWrite,
  resolveCoverPath,
  type CoverPhotoSource,
} from "./cover.ts";
import { vehicleWriteFromDraft, type VehicleDraft } from "./vehicle.ts";

const OWNER = "22222222-2222-4222-8222-222222222222";
const VEHICLE = "11111111-1111-4111-8111-111111111111";

/** A synthetic object path under this vehicle's own prefix. */
function photo(slot: string): string {
  return `${OWNER}/${VEHICLE}/TEST-T2-306A-PHOTO-${slot}.jpg`;
}

/** Three photos, in the order they were uploaded. */
const PHOTOS = [photo("1"), photo("2"), photo("3")] as const;

/**
 * The message `call` threw, or `null` if it returned.
 *
 * A three-state answer rather than a boolean, so "it threw the seam", "it
 * threw something else", and "it ran" stay distinguishable — the same
 * discipline AGENTS.md asks for everywhere else in this project, applied to a
 * control rather than to a fetch.
 */
function threw(call: () => unknown): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function vehicle(overrides: Partial<CoverPhotoSource> = {}): CoverPhotoSource {
  return {
    id: VEHICLE,
    owner_id: OWNER,
    photo_paths: [...PHOTOS],
    cover_photo_path: null,
    ...overrides,
  };
}

/* =========================================================================
 * resolveCoverPath — the single cover-resolution implementation
 * ====================================================================== */

describe("resolveCoverPath renders the photo the owner designated", () => {
  it.fails(
    "returns the designated path when it is one of the vehicle's photos",
    () => {
      expect(resolveCoverPath(vehicle({ cover_photo_path: PHOTOS[1] }))).toBe(
        PHOTOS[1]
      );
    }
  );

  // **The Nth photo, not the most recent and not the first** — the task line
  // names this explicitly, and it is an `it.each` table rather than one
  // assertion about the middle photo because "works for index 1" and "works
  // for every index" are different claims, and an implementation that
  // special-cased either end would satisfy the first.
  it.fails.each(PHOTOS.map((path, index) => [index, path] as const))(
    "designating photo %i of three resolves to that photo",
    (_index, path) => {
      expect(resolveCoverPath(vehicle({ cover_photo_path: path }))).toBe(path);
    }
  );

  it.fails(
    "does not depend on where the designated photo sits in the array",
    () => {
      // The same designation, the same answer, whatever order the array is in.
      // A resolver written as "find the cover, else the first" passes the
      // assertions above and fails this one only if the array is shuffled — so
      // the array is shuffled.
      const reordered = [PHOTOS[2], PHOTOS[0], PHOTOS[1]];

      expect(
        resolveCoverPath(
          vehicle({ photo_paths: reordered, cover_photo_path: PHOTOS[0] })
        )
      ).toBe(PHOTOS[0]);
    }
  );
});

describe("resolveCoverPath renders the placeholder rather than guessing", () => {
  it.fails(
    "returns null when the vehicle has photos but no designation",
    () => {
      // GAR-01′, read literally: "a vehicle with photos but no cover renders the
      // same placeholder image used when the vehicle has no photos". The whole
      // of this requirement is the *absence* of a fallback, so this is the
      // grader that fails against the obvious wrong implementation.
      expect(resolveCoverPath(vehicle({ cover_photo_path: null }))).toBeNull();
    }
  );

  it.fails("returns null when the vehicle has no photos at all", () => {
    expect(
      resolveCoverPath(vehicle({ photo_paths: [], cover_photo_path: null }))
    ).toBeNull();
  });

  it.fails("never falls back to the first photo", () => {
    // Stated as its own grader, and asserted as a non-equality, because
    // `toBeNull()` above would also be satisfied by a resolver that happened
    // to return null for a *different* reason. This one names the value that
    // must not come back.
    const resolved = resolveCoverPath(vehicle({ cover_photo_path: null }));

    expect(resolved).not.toBe(PHOTOS[0]);
    expect(resolved).toBeNull();
  });

  it.fails("returns null for a designation the vehicle does not have", () => {
    // The dangling case. The database is supposed to make it unrepresentable
    // (`tests/garage/cover-photo.test.ts` grades that); this is the belt, and
    // it matters because the wrong answer here is not a missing image — it is
    // a request to the storage API for an object under a path the row does not
    // own, made on the owner's behalf.
    const stranger = `${OWNER}/${VEHICLE}/TEST-T2-306A-PHOTO-REMOVED.jpg`;

    expect(
      resolveCoverPath(
        vehicle({ photo_paths: [...PHOTOS], cover_photo_path: stranger })
      )
    ).toBeNull();
  });

  it.fails(
    "returns null for a designation under another vehicle's prefix",
    () => {
      // Same discipline as `vehiclePhotoPaths` in `./vehicle.ts`: a path that
      // does not live under `<owner>/<vehicle>/` is not this vehicle's, even if
      // the array it was read from says otherwise — and `photo_paths` is an
      // array a client wrote.
      const other = "33333333-3333-4333-8333-333333333333";
      const foreign = `${other}/${VEHICLE}/TEST-T2-306A-PHOTO-1.jpg`;

      expect(
        resolveCoverPath(
          vehicle({
            photo_paths: [...PHOTOS, foreign],
            cover_photo_path: foreign,
          })
        )
      ).toBeNull();
    }
  );

  it.fails("returns null for a designation with an extra path segment", () => {
    // `<owner>/<vehicle>/<file>` is exactly three segments. A fourth means the
    // path was built by something that is not `photoObjectPath`, and a
    // resolver that shrugged at it would hand a hand-crafted key to the
    // storage API.
    const nested = `${OWNER}/${VEHICLE}/nested/TEST-T2-306A-PHOTO-1.jpg`;

    expect(
      resolveCoverPath(
        vehicle({ photo_paths: [nested], cover_photo_path: nested })
      )
    ).toBeNull();
  });
});

/* =========================================================================
 * coverPhotoWrite — the payload that cannot lose a photo
 * ====================================================================== */

describe("coverPhotoWrite touches the cover column and nothing else", () => {
  it.fails("sets the cover with a single-key patch", () => {
    expect(coverPhotoWrite(PHOTOS[1])).toEqual({
      cover_photo_path: PHOTOS[1],
    });
  });

  it.fails("clears the cover with the same shape", () => {
    // "Remove cover" is a designation of none, not a different operation, and
    // certainly not a delete of the photo.
    expect(coverPhotoWrite(null)).toEqual({ cover_photo_path: null });
  });

  it.fails("never carries photo_paths", () => {
    // The grader the task line asked for by name. T2-304's seeding found a
    // lost-update race on `vehicles.photo_paths` — two writers
    // read-modify-write the array and one clobbers the other, stranding a real
    // storage object that no row names. A "set as cover" payload that carried
    // the array it read a moment ago would be that same race in a different
    // form, and the graders for this feature must not accidentally bless it.
    //
    // Asserted as a key sweep rather than as `not.toHaveProperty("photo_paths")`
    // so that *any* second column — a whole-row PATCH, an `updated_at` the
    // client computed, a display name a stale form field still held — is a
    // finding too. One key is the property; "not that one key" is a spelling
    // of it with a bypass built in.
    for (const path of [PHOTOS[0], null]) {
      expect(Object.keys(coverPhotoWrite(path))).toEqual(["cover_photo_path"]);
    }
  });
});

/* =========================================================================
 * Controls — unmarked, and they pass today
 * ====================================================================== */

describe("the seam and the fixtures are what this file thinks they are", () => {
  // Without these, every `it.fails` above could be failing because the module
  // does not resolve, or because a fixture path is malformed — which looks
  // identical in the reporter and means something completely different
  // (`.claude/GRADER-PRINCIPLES.md`: assert the reason).
  it("either throws the NAMED seam or is implemented — never a third thing", () => {
    // **Branch-aware on purpose (T2-306a review, F2).** The first version
    // asserted flatly that both functions throw, which meant T2-306's only
    // route to green was to delete this control — exactly what T901's
    // separation audit exists to flag, and not something an activation note
    // mentioning only `.fails` markers authorized.
    //
    // What the control is actually for survives the rewrite intact: an
    // unimplemented function must fail with *this* message and not with a
    // module-resolution error or a `TypeError`, because those look identical
    // in a report and mean something completely different
    // (`.claude/GRADER-PRINCIPLES.md`: assert the reason). The third thing —
    // throwing something that is not the seam — is a finding in both branches,
    // which is the whole point.
    for (const call of [
      () => resolveCoverPath(vehicle()),
      () => coverPhotoWrite(null),
    ]) {
      const message = threw(call);
      if (message !== null) expect(message).toContain(COVER_SEAM);
    }
  });

  it("once implemented, resolves a real designation", () => {
    // The presence half, so activation makes this file's controls *stronger*
    // rather than leaving a dead one to delete. Skipped while the seam throws;
    // the marked graders above are what carry the requirement until then.
    if (threw(() => resolveCoverPath(vehicle())) !== null) {
      expect(threw(() => resolveCoverPath(vehicle()))).toContain(COVER_SEAM);
      return;
    }

    expect(resolveCoverPath(vehicle({ cover_photo_path: PHOTOS[1] }))).toBe(
      PHOTOS[1]
    );
    expect(Object.keys(coverPhotoWrite(null))).toEqual(["cover_photo_path"]);
  });

  it("names a task in the seam message", () => {
    // A seam message that did not name a task is a seam nobody can route. The
    // pattern rather than the literal, so the constant outlives T2-306 the way
    // `SEAM_NOT_IMPLEMENTED` outlived T2-202 — these constants stay in the
    // repo after activation, and a control that pinned one task id would have
    // to be edited by whoever reuses it next.
    expect(COVER_SEAM).toMatch(/^not implemented: T2-\d+[a-z]?$/);
  });

  it("builds fixture photos under this vehicle's own prefix", () => {
    // If the fixture paths drifted out of `<owner>/<vehicle>/<file>`, the
    // "returns the designated path" graders would demand a path a correct
    // implementation is *right* to refuse, and the implementer's only route to
    // green would be to weaken the filter.
    for (const path of PHOTOS) {
      expect(path.split("/")).toHaveLength(3);
      expect(path.startsWith(`${OWNER}/${VEHICLE}/`)).toBe(true);
    }
  });

  it("keeps the three fixture photos distinct and ordered", () => {
    // The order-independence graders are worth nothing if two "different"
    // photos are the same string.
    expect(new Set(PHOTOS).size).toBe(3);
    expect(PHOTOS[0]).not.toBe(PHOTOS[2]);
  });

  it("uses a reserved TEST- namespace for every synthetic path", () => {
    // AGENTS.md: nothing in a fixture should be mistakable for real user data.
    for (const path of PHOTOS) {
      expect(path).toContain("TEST-T2-306A-");
    }
  });
});

describe("the profile form's save cannot clobber a cover set in another tab", () => {
  // **Unmarked, and green today** — a regression guard rather than an expected
  // failure, and the distinction is worth stating: `VehicleWrite` correctly
  // omits `photo_paths` already, for the reason its own docstring gives
  // ("folding them into the profile form's save would let a stale form field
  // drop a photo somebody just added"). The cover designation is the same
  // hazard with a smaller blast radius and a much easier mistake to make,
  // because unlike a photo array it *looks* like an ordinary profile field.
  //
  // T2-306 puts the "Set as cover" control on the vehicle edit view, next to
  // the profile form. The moment the designation joins the form's write, a
  // reader who opens the profile in one tab, sets a cover in another, and
  // saves the first has silently reverted the second — the exact two-tab shape
  // this task exists to grade for, arriving through the front door.
  const COMPLETE: VehicleDraft = {
    displayName: "Gitana Blanca",
    gen: "gen3",
    market: "us",
    year: "2002",
    engine: "6g74-sohc",
    odometer: "247500",
    odometerUnit: "km",
  };

  it("omits the cover designation from the profile write", () => {
    const write = vehicleWriteFromDraft(COMPLETE);

    expect(write).not.toBeNull();
    expect(Object.keys(write ?? {})).not.toContain("cover_photo_path");
  });

  it("omits photo_paths too, so this guard is reading a real payload", () => {
    // The positive control on the control: if `vehicleWriteFromDraft` ever
    // returned an empty object, the assertion above would pass for a reason
    // that has nothing to do with the cover.
    const write = vehicleWriteFromDraft(COMPLETE);

    expect(Object.keys(write ?? {})).not.toContain("photo_paths");
    expect(Object.keys(write ?? {})).toContain("display_name");
  });
});
