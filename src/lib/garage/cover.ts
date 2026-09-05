/**
 * The cover-photo designation, resolved once (GAR-01′) — **a seam declared by
 * T2-306a [TEST], implemented by T2-306 [PLATFORM]**.
 *
 * > **GAR-01′** … A user SHALL be able to designate one uploaded photo as the
 * > vehicle's **cover photo** (owner-approved addition, 2026-09-02), rendered
 * > wherever the vehicle is shown as a single item — the garage vehicle list,
 * > and any future showcase-page card (SHR-02). Removing the designated cover
 * > photo SHALL leave the vehicle with no cover rather than silently promoting
 * > another one; a vehicle with photos but no cover renders the same
 * > placeholder image used when the vehicle has no photos.
 *
 * ## Why this file exists before the feature does
 *
 * Every function here throws {@link COVER_SEAM}. That is deliberate: the
 * graders in `./cover.test.ts` are written against a contract, not against an
 * implementation, and the instance that wrote them is not the instance that
 * will fill them in (AGENTS.md separation rule; T901 audits it). A stub that
 * throws a named error is what lets a grader fail **for the reason it names**
 * rather than with a module-resolution error, which looks identical in a
 * report and means something completely different.
 *
 * ## Why the resolution is one function and not one per page
 *
 * T2-306's task line asks for the render helper to be shared: *"design the
 * render helper so T2-402 can reuse it without a second cover-resolution
 * implementation."* Two implementations of "which photo is the cover" is how
 * a garage card and a showcase card end up disagreeing about the same truck —
 * and the second one is always the one written in a hurry, against a row shape
 * somebody assumed rather than read.
 *
 * ## What this module is NOT
 *
 * It is not the enforcement. A cover that names a photo the vehicle does not
 * have is refused by the **database** — see `tests/garage/contract.ts`'s
 * `cover_photo_path` entry and the constraint and trigger graded in
 * `tests/garage/cover-photo.test.ts`. SHR-01 is explicit that a check living
 * in client or page code is not one of the three permitted enforcement modes,
 * so nothing here may be the only thing standing between a reader and someone
 * else's object. {@link resolveCoverPath} filters for the same reason
 * `vehiclePhotoPaths` in `./vehicle.ts` filters: to stop a wrong path from
 * being *asked for*, not to grant anything.
 *
 * refs specs/002-montero-garage (GAR-01′, SHR-01, SHR-02)
 */

/**
 * The seam message. Every grader in `./cover.test.ts` that describes behaviour
 * T2-306 has not built yet fails with *this* — not with a typo, not with a bad
 * import path.
 */
export const COVER_SEAM = "not implemented: T2-306";

function seam(what: string): Error {
  return new Error(
    `${COVER_SEAM} — ${what}. T2-306a [TEST] declared the cover-photo ` +
      `designation as graders; T2-306 [PLATFORM] ships the column, the ` +
      `enforcement and the UI that satisfy them ` +
      `(refs specs/002-montero-garage GAR-01′)`
  );
}

/**
 * The parts of a `vehicles` row a cover decision is made from.
 *
 * Declared structurally rather than as `VehicleRow` from `./vehicle.ts` on
 * purpose: `VehicleRow` does not carry `cover_photo_path` yet, and adding a
 * field to it is implementation work this task must not do. A `VehicleRow`
 * that gains the column is assignable to this interface with no adapter, so
 * T2-306 passes rows straight in.
 *
 * `cover_photo_path` is `string | null` and never `string | undefined`: null
 * is what the column holds, and a second spelling of "no cover" is a second
 * branch every caller has to remember.
 */
export interface CoverPhotoSource {
  readonly id: string;
  readonly owner_id: string;
  readonly photo_paths: readonly string[];
  readonly cover_photo_path: string | null;
}

/**
 * The object path to render as this vehicle's cover, or `null` for none.
 *
 * ## `null` means "render the placeholder", and it means it in three cases
 *
 * GAR-01′ collapses them at the *render* layer and only there:
 *
 * 1. the vehicle has no photos;
 * 2. the vehicle has photos and the owner has designated none;
 * 3. the designation does not name a photo this vehicle actually has.
 *
 * The third is a **defect** rather than a state — the database is supposed to
 * make it unrepresentable — and this function's job is to fail safe rather
 * than to paper over it: a path outside `<owner>/<vehicle>/` would at best 404
 * and at worst ask the storage API for somebody else's object on the owner's
 * behalf. Returning `null` for it is the belt; the constraint is the braces.
 *
 * ## What it must never do
 *
 * Fall back to `photo_paths[0]`. "Silently promoting another one" is the exact
 * phrase GAR-01′ forbids, and the first array entry is the tempting thing to
 * promote — `src/lib/garage/photos.ts` still carries a docstring from before
 * this requirement existed claiming *"the first path is the cover photo"*,
 * which is precisely the convention T2-306 replaces and which the graders in
 * `./cover.test.ts` exist to keep replaced.
 */
export function resolveCoverPath(vehicle: CoverPhotoSource): string | null {
  throw seam(`resolveCoverPath for vehicle ${vehicle.id}`);
}

/**
 * The PostgREST patch body that sets — or, with `null`, clears — the cover.
 *
 * ## Why the write shape is graded at all
 *
 * Because the same lost-update race this project already paid for once is one
 * careless payload away from coming back wearing a different coat. T2-304's
 * seeding found it on `vehicles.photo_paths`: two uploads read-modify-write
 * the same array and one clobbers the other, leaving a real storage object
 * that no row names. A "set as cover" that transmitted the whole row — or the
 * array it read a moment ago alongside the new designation — would resurrect
 * that defect on a surface where it is *harder* to notice, because the array
 * would look plausible and only one photo would be missing.
 *
 * So the payload carries exactly one key. A patch that touches only
 * `cover_photo_path` cannot lose a photo a second tab added between the read
 * and the write, whatever order the two land in. That is not an optimisation;
 * it is the whole of this function's reason to exist, and it is why a helper
 * this small is worth a name and a grader rather than an inline object
 * literal at each call site.
 */
export function coverPhotoWrite(
  path: string | null
): Readonly<Record<string, string | null>> {
  throw seam(`coverPhotoWrite(${path ?? "null"})`);
}
