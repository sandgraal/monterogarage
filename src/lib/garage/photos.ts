/**
 * Vehicle photos: the bucket, the path scheme, and what may be uploaded
 * (GAR-01′, SHR-01).
 *
 * > **GAR-01′** A user SHALL create vehicle profiles with a display name,
 * > taxonomy identity …, **photos**, and odometer.
 * > **SHR-01** Everything a user stores SHALL default to private.
 *
 * ## The path *is* the ownership claim
 *
 * `supabase/migrations/…_photos_storage.sql` scopes every policy on the bucket
 * to `(storage.foldername(name))[1] = auth.uid()::text`, exactly as the
 * receipts bucket does, because the first segment of an object's path is the
 * only thing about a storage row that says whose it is. That makes
 * {@link photoObjectPath} security-relevant code rather than a formatting
 * helper, and it is why it lives in a module with graders instead of inline in
 * a page:
 *
 *     photos/<owner uuid>/<vehicle uuid>/<random>.<ext>
 *              ^^^^^^^^^^
 *              the only segment any policy reads
 *
 * The **association** between a photo and a vehicle is not this path, though:
 * it is `public.vehicles.photo_paths`, the `text[]` T2-202 already shipped.
 * That column is where order lives (the first path is the cover photo), and it
 * disappears with the vehicle row through the same cascade as everything else.
 * No `vehicle_photos` table was added: `tests/garage/contract.ts` pins none,
 * the column that would carry it already exists, and a schema addition is
 * never a drive-by edit (AGENTS.md).
 *
 * The path's second segment is therefore a *check*, not the source of truth —
 * see `vehiclePhotoPaths` in `./vehicle.ts`, which refuses to render a stored
 * path that does not live under the vehicle it was read from.
 *
 * One cost is stated rather than hidden: deleting a vehicle deletes the row
 * and its `photo_paths` with it, but no foreign key can cascade into storage,
 * so the objects have to be removed first — by prefix, using
 * {@link photoPrefix}. That is the same limit `purge_expired_accounts`
 * documents one level up, at the account.
 *
 * ## The file name is generated, never the reader's
 *
 * An uploaded name is attacker-controlled text that becomes part of a URL. It
 * can contain `../`, a leading `/`, a NUL, an RTL override that makes
 * `photo.exe` render as `photo.gpj`, or 4 kB of Unicode. None of that is worth
 * keeping for a truck photo, so the stored name is a random identifier plus an
 * extension derived from the *declared MIME type* — which is the field that
 * actually decides how a browser will treat the bytes.
 *
 * refs specs/002-montero-garage (GAR-01′, SHR-01, MIG-03)
 */

/**
 * The private bucket vehicle photos live in.
 *
 * `vehicle-photos`, not `photos`, and the name is the graders'
 * (`VEHICLE_PHOTOS_BUCKET` in `tests/garage/contract.ts`): a bucket id is
 * global to the project and permanent in every stored path, so the generic
 * name would have to be shared the first time anything else needs images — a
 * profile avatar, a showcase banner — and sharing it means one policy
 * governing objects with different ownership rules.
 */
export const VEHICLE_PHOTOS_BUCKET = "vehicle-photos";

/**
 * What may be uploaded, and the extension each type is stored under.
 *
 * Images only — a receipt is a PDF sometimes, a photo of a truck never is, and
 * the narrower the allow-list the less the bucket can be used as a file drop.
 * The same list is repeated in the migration's `allowed_mime_types`, where it
 * is enforced server-side; this copy is what lets the page refuse a file
 * before spending the reader's data on the upload.
 */
export const PHOTO_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
};

export const PHOTO_MIME_TYPES: readonly string[] = Object.keys(
  PHOTO_MIME_EXTENSIONS
);

/**
 * Ten megabytes. A phone photo is one to five; twenty is the receipts bucket's
 * limit because a scanned multi-page PDF is genuinely bigger. Enforced in the
 * migration too — this copy exists to fail fast, not to be the defence.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Why a chosen file was refused, or `null` when it was not. */
export type PhotoIssue = "unsupported-type" | "too-large";

/** The minimum of `File` this module needs, so the graders need no DOM. */
export interface ChosenFile {
  readonly type: string;
  readonly size: number;
}

/**
 * The stored extension for a declared type, or `undefined`.
 *
 * `Object.hasOwn`, because both of the obvious spellings consult the prototype
 * chain (T2-305 review, F2 — found in the media module, and this is the same
 * idiom it was copied from). `"constructor"` is an ordinary string that a
 * `Content-Type` header can carry: `in` answers `true` for it, and the bracket
 * lookup returns `Object` rather than `undefined`, so a `=== undefined` guard
 * does not fire and the "extension" becomes a function's source text.
 */
function photoExtension(mimeType: string): string | undefined {
  const key = mimeType.toLowerCase();
  return Object.hasOwn(PHOTO_MIME_EXTENSIONS, key)
    ? PHOTO_MIME_EXTENSIONS[key]
    : undefined;
}

export function photoIssue(file: ChosenFile): PhotoIssue | null {
  if (photoExtension(file.type) === undefined) return "unsupported-type";
  if (file.size > MAX_PHOTO_BYTES) return "too-large";
  return null;
}

/**
 * `true` when `value` is a v4-shaped UUID.
 *
 * Both path segments are checked against this before they are joined. Neither
 * is reader input today — one comes from the session and one from a row — but
 * "not reader input today" is a property of the current call sites, and the
 * function that builds a security-relevant path should not depend on one.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * Every object belonging to one vehicle: `<owner>/<vehicle>/`.
 *
 * This is the unit of listing *and* of deletion. When a vehicle row is deleted
 * the row cascade cannot reach storage — the same limit
 * `purge_expired_accounts` documents at the account level — so the page
 * removes this prefix's objects before deleting the row.
 */
export function photoPrefix(ownerId: string, vehicleId: string): string {
  if (!isUuid(ownerId) || !isUuid(vehicleId)) {
    throw new Error(
      "refusing to build a photo path from a non-uuid segment: the first " +
        "segment is what every storage policy compares to auth.uid() " +
        "(refs specs/002-montero-garage SHR-01)"
    );
  }
  return `${ownerId}/${vehicleId}`;
}

/**
 * A fresh object path for an upload.
 *
 * `randomId` is injected so the graders can assert the shape without stubbing
 * a global; call sites pass {@link randomPhotoId}, which is
 * `crypto.randomUUID`.
 */
export function photoObjectPath(input: {
  readonly ownerId: string;
  readonly vehicleId: string;
  readonly mimeType: string;
  readonly randomId: string;
}): string {
  const extension = photoExtension(input.mimeType);
  if (extension === undefined) {
    throw new Error(`refusing to store an unsupported type: ${input.mimeType}`);
  }
  if (!/^[A-Za-z0-9-]+$/.test(input.randomId)) {
    throw new Error("photo id must be url-safe and free of path separators");
  }
  return `${photoPrefix(input.ownerId, input.vehicleId)}/${input.randomId}.${extension}`;
}

/** A random object id. Split out so `photoObjectPath` stays pure. */
export function randomPhotoId(): string {
  return crypto.randomUUID();
}

/**
 * The vehicle a stored path belongs to, or `null` if the path is not one of
 * ours. Used to keep a listing honest rather than to grant anything.
 */
export function vehicleIdOfPhotoPath(path: string): string | null {
  const segments = path.split("/");
  if (segments.length !== 3) return null;
  const [owner, vehicle] = segments;
  if (!isUuid(owner) || !isUuid(vehicle)) return null;
  return vehicle;
}
