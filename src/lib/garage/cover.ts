/**
 * The cover-photo designation, resolved once (GAR-01′) — a seam declared by
 * T2-306a [TEST] and filled in by T2-306 [PLATFORM].
 *
 * > **GAR-01′** … A user SHALL be able to designate one uploaded photo as the
 * > vehicle's **cover photo** (owner-approved addition, 2026-09-02), rendered
 * > wherever the vehicle is shown as a single item — the garage vehicle list,
 * > and any future showcase-page card (SHR-02). Removing the designated cover
 * > photo SHALL leave the vehicle with no cover rather than silently promoting
 * > another one; a vehicle with photos but no cover renders the same
 * > placeholder image used when the vehicle has no photos.
 *
 * ## Why the resolution is one function and not one per page
 *
 * T2-306's task line asks for the render helper to be shared: *"design the
 * render helper so T2-402 can reuse it without a second cover-resolution
 * implementation."* Two implementations of "which photo is the cover" is how
 * a garage card and a showcase card end up disagreeing about the same truck —
 * and the second one is always the one written in a hurry, against a row shape
 * somebody assumed rather than read. `resolveCoverPath` is imported straight
 * into `src/pages/[locale]/[garageSegment].astro`'s list-card and edit-view
 * rendering, and whichever task ships a showcase card next (T2-404, having
 * absorbed T2-402's public-page rendering) reuses the same function rather
 * than re-deriving the answer.
 *
 * ## What this module is NOT
 *
 * It is not the enforcement. A cover that names a photo the vehicle does not
 * have is refused by the **database** — see `tests/garage/contract.ts`'s
 * `cover_photo_path` entry and the constraint and trigger graded in
 * `tests/garage/cover-photo.test.ts`, and shipped in
 * `supabase/migrations/20260906120000_vehicle_cover_photo.sql`. SHR-01 is
 * explicit that a check living in client or page code is not one of the three
 * permitted enforcement modes, so nothing here may be the only thing standing
 * between a reader and someone else's object. {@link resolveCoverPath} filters
 * for the same reason `vehiclePhotoPaths` in `./vehicle.ts` filters: to stop a
 * wrong path from being *asked for*, not to grant anything — the database has
 * already refused it as a designation; this is the belt that keeps the page
 * from asking the storage API for it anyway.
 *
 * refs specs/002-montero-garage (GAR-01′, SHR-01, SHR-02)
 */

/**
 * The seam message this module's functions used to throw while T2-306 was
 * unbuilt.
 *
 * Left in place, unused by the functions below, for the reason
 * `SEAM_NOT_IMPLEMENTED` outlived T2-202: `./cover.test.ts`'s own control
 * ("names a task in the seam message") still asserts its shape, and a future
 * seam in this project is free to reuse the pattern.
 */
export const COVER_SEAM = "not implemented: T2-306";

/**
 * The parts of a `vehicles` row a cover decision is made from.
 *
 * Declared structurally rather than as `VehicleRow` from `./vehicle.ts`, so
 * this module has no dependency on it — a `VehicleRow` (which does now carry
 * `cover_photo_path`, see its own docstring) is assignable to this interface
 * with no adapter, and every call site in the garage page passes a row
 * straight in.
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
 * promote — `src/lib/garage/photos.ts` carried a docstring, before T2-306,
 * claiming *"the first path is the cover photo"*, which was precisely the
 * convention this function replaces (now corrected there too) and which the
 * graders in `./cover.test.ts` exist to keep replaced.
 */
export function resolveCoverPath(vehicle: CoverPhotoSource): string | null {
  const cover = vehicle.cover_photo_path;
  if (cover === null) return null;

  // The same ownership check `vehiclePhotoPaths` in `./vehicle.ts` applies to
  // the whole array, asked of one path: it has to live directly under
  // `<owner>/<vehicle>/` — no fewer segments (not this vehicle's at all) and
  // no more (not a path `photoObjectPath` could have built). Not imported
  // from `./vehicle.ts` on purpose — `CoverPhotoSource` is declared
  // structurally precisely so this module does not have to depend on
  // `VehicleRow`, and the check is three lines, not worth a coupling.
  const prefix = `${vehicle.owner_id}/${vehicle.id}/`;
  const ownsPath =
    cover.startsWith(prefix) && !cover.slice(prefix.length).includes("/");
  if (!ownsPath) return null;

  // Membership, asked last and against `vehicle.photo_paths` as it actually
  // is — never `photo_paths[0]`, and never anything but a lookup of the
  // designation that was already there.
  return vehicle.photo_paths.includes(cover) ? cover : null;
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
  return { cover_photo_path: path };
}
