/**
 * Record media attachments: the bucket, the path scheme, the three kinds, and
 * the row that points at an object (GAR-06′, SHR-01).
 *
 * > **GAR-06′** (owner-approved addition, 2026-09-02) A record SHALL support
 * > general documentation attachments — photo, video, or audio, in addition to
 * > GAR-05′'s image/PDF receipts — uploaded into user-private storage,
 * > independent of a receipt's vendor/date/amount fields. Never publicly
 * > accessible unless the record's visibility is opened.
 *
 * The third sibling of `./photos.ts` and `./receipt.ts`, and deliberately
 * their near-copy: the same "the path is the ownership claim" reasoning, the
 * same generated file name, the same fail-fast size and type check in front of
 * a server-side one. Where it differs, it differs because the contract says so.
 *
 * ## The path *is* the ownership claim, and it carries two more segments
 *
 * `supabase/migrations/…_record_media.sql` scopes every policy on the bucket to
 * `(storage.foldername(name))[1] = auth.uid()::text`, for the third time and
 * for the same reason: the first segment of an object's path is the only thing
 * about a storage row that says whose it is.
 *
 *     record-media/<owner uuid>/<vehicle id>/<record id>/<random>.<ext>
 *                   ^^^^^^^^^^
 *                   the only segment any policy reads
 *
 * The **record** segment is the one that is new, and it is here because of a
 * gap this project has already paid for. A receipt lives at `<owner>/<file>`,
 * which carries nothing identifying a record or a vehicle — so no prefix finds
 * one record's receipts, no delete trigger can reach them, and T2-302 recorded
 * that as found-and-not-fixed. Putting the record id in the path makes "delete
 * this record's media" a prefix match, which is what lets the migration ship a
 * `on_record_deleted` belt at all. The vehicle segment sits between them so a
 * per-vehicle operation never has to enumerate records.
 *
 * None of that makes the path the *association*: `public.record_media` is, one
 * row per object, and it is what a listing reads. The path's later segments are
 * a **check** — see {@link mediaPathBelongsTo}.
 *
 * ## Exactly where that check is applied, and where it is not
 *
 * It guards the three **destructive or enumerating** call sites in
 * `src/lib/supabase/garage.ts`: `removeRecordMedia`, `deleteRecord`, and
 * `vehicleMediaPaths`. A `storage_path` is a column a client wrote, so a row
 * can name a path pointing outside `<owner>/`, and asking the Storage API to
 * *delete* an arbitrary name on the owner's behalf is a request that should
 * never be made — whatever the policies would do with it.
 *
 * It does **not** guard `signRecordMediaUrls`, and the first version of this
 * docstring wrongly said it did (T2-305 review, F1). Signing is left unguarded
 * deliberately and for the same reason `signReceiptUrls` and `signPhotoUrls`
 * are: the bucket's own policy pins
 * `(storage.foldername(name))[1]` to `auth.uid()`, so a request to sign
 * somebody else's object is refused at the point it is made and the signature
 * is never issued. Adding a fourth, differently-shaped sign function to prove a
 * property the database already proves would buy nothing and would leave two of
 * the three sign paths looking careless by comparison. What the guard prevents
 * on the delete path — an irreversible action taken on a name the row invented
 * — has no counterpart here, because a signature that is refused is simply a
 * player that does not render.
 *
 * ## Why a row per object and not `records.media_paths text[]`
 *
 * The array shape carries the lost-update race T2-304 found on
 * `vehicles.photo_paths`: two uploads read the same array, and the second write
 * erases the first entry, leaving a real storage object nothing names. An
 * insert cannot lose to a concurrent insert. It is also the only shape that can
 * hold {@link MediaKind}, which GAR-06′ needs.
 *
 * ## An attachment is not a receipt
 *
 * No vendor, no date, no amount — GAR-06′ says so in as many words, and the
 * WhatsApp voice note that motivated the requirement cannot be filed at all if
 * the form demands a vendor first. The only thing typed beside the file is
 * nothing: pick a file, attach it. The bucket refuses `application/pdf`, so the
 * boundary with GAR-05′ is enforced on the bytes and not by a naming
 * convention.
 *
 * ## These constants are restatements, and nothing checks that they agree
 *
 * The bucket id, the MIME allow-list and the size limit are copies of the
 * migration's, where they are the ones actually enforced (and of
 * `tests/garage/contract.ts`, which declares the bucket id and the path). This
 * copy exists so the page can refuse a file before spending a reader's data
 * uploading it. `receipt.ts` records the same exposure and the same fix —
 * importing the contract into `src/`, or grading the pair — and this module
 * inherits it unchanged.
 *
 * refs specs/002-montero-garage (GAR-06′, GAR-05′, SHR-01, MIG-03)
 */

import { isUuid } from "./photos.ts";

/**
 * The private bucket a record's media attachments live in — the contract's
 * `RECORD_MEDIA_BUCKET`.
 *
 * `record-media`, hyphenated where the table is underscored, because a bucket
 * id has to be a valid Supabase bucket id; `vehicle-photos` /
 * `vehicles.photo_paths` set that precedent. `public = false` in the migration,
 * which is the single decision governing whether every video in the system has
 * a permanent unauthenticated URL. Nothing in this module may work around it:
 * the owner's own page reads its objects through short-lived signed URLs, and
 * how a *public* work-log page (SHR-02) reads one is the open sharing question
 * `contract.ts` leaves to T2-401/T2-402.
 */
export const RECORD_MEDIA_BUCKET = "record-media";

/**
 * The three kinds GAR-06′ names, and nothing else.
 *
 * A closed set here and a `check` constraint in the migration, for the same
 * reason `records.kind` is one: the page's render branch is driven by this
 * value, and "photo" versus "image" renders nothing at all.
 */
export const MEDIA_KINDS = ["photo", "video", "audio"] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * What may be uploaded: the kind each type belongs to, and the extension it is
 * stored under.
 *
 * The same list the migration's `allowed_mime_types` names, where it is
 * enforced. `application/pdf` is deliberately absent and is present for
 * receipts: a media bucket that took PDFs would be a second receipts bucket,
 * and GAR-06′'s independence would be a naming convention rather than a
 * property.
 *
 * The list is broad *within* the three categories on purpose — `audio/ogg` is
 * what an Android WhatsApp voice note arrives as, `video/quicktime` is what an
 * iPhone video arrives as, and a reader whose file is refused for a codec
 * reason has no way to act on the refusal.
 */
export const MEDIA_MIME_TYPES: Readonly<
  Record<string, { readonly kind: MediaKind; readonly extension: string }>
> = {
  "image/jpeg": { kind: "photo", extension: "jpg" },
  "image/png": { kind: "photo", extension: "png" },
  "image/webp": { kind: "photo", extension: "webp" },
  "image/avif": { kind: "photo", extension: "avif" },
  "image/heic": { kind: "photo", extension: "heic" },
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/quicktime": { kind: "video", extension: "mov" },
  "video/webm": { kind: "video", extension: "webm" },
  "video/3gpp": { kind: "video", extension: "3gp" },
  "audio/mpeg": { kind: "audio", extension: "mp3" },
  "audio/mp4": { kind: "audio", extension: "m4a" },
  "audio/aac": { kind: "audio", extension: "aac" },
  "audio/ogg": { kind: "audio", extension: "ogg" },
  "audio/webm": { kind: "audio", extension: "weba" },
  "audio/amr": { kind: "audio", extension: "amr" },
  "audio/3gpp": { kind: "audio", extension: "3ga" },
};

export const MEDIA_ACCEPT_TYPES: readonly string[] =
  Object.keys(MEDIA_MIME_TYPES);

/**
 * A hundred megabytes — the migration's `file_size_limit`, and ten times the
 * photos bucket's.
 *
 * The number is set by the one case the requirement exists for: a two-minute
 * phone video of a noise the shop could not reproduce. A photo is one to five
 * megabytes and a voice note is under one, so the limit is only ever reached by
 * video, and a video limit of ten would refuse the motivating case outright.
 */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

/** Why a chosen file was refused, or `null` when it was not. */
export type MediaIssue = "unsupported-type" | "too-large";

/** The minimum of `File` this module needs, so the graders need no DOM. */
export interface ChosenMedia {
  readonly type: string;
  readonly size: number;
}

/**
 * The allow-list entry for a declared type, or `undefined`.
 *
 * `Object.hasOwn` rather than `in` or a bare bracket lookup, and that is not
 * pedantry (T2-305 review, F2). Both of the obvious spellings consult the
 * prototype chain, so `"constructor"` — an ordinary string, and one a
 * `Content-Type` header can carry — reads as a member: `in` answers `true`, and
 * the bracket lookup returns `Object` itself rather than `undefined`, which
 * means a `=== undefined` guard does **not** fire. Left alone, that is a file
 * whose "extension" is the source text of a function.
 *
 * One accessor rather than three call sites repeating the guard, so the next
 * lookup added here cannot quietly get it wrong.
 */
function mimeEntry(
  mimeType: string
): { readonly kind: MediaKind; readonly extension: string } | undefined {
  const key = mimeType.toLowerCase();
  return Object.hasOwn(MEDIA_MIME_TYPES, key)
    ? MEDIA_MIME_TYPES[key]
    : undefined;
}

export function mediaIssue(file: ChosenMedia): MediaIssue | null {
  if (mimeEntry(file.type) === undefined) return "unsupported-type";
  if (file.size > MAX_MEDIA_BYTES) return "too-large";
  return null;
}

/**
 * The kind a declared MIME type belongs to, or `null` when it is not one of
 * ours.
 *
 * Read from the *declared* type rather than from the file name, because the
 * declared type is what the bucket filters on and what decides how a browser
 * will treat the bytes. A file called `nota.mp3` that arrives as
 * `application/octet-stream` is refused here and would be refused by the
 * bucket too; guessing from the extension would make the two disagree.
 */
export function mediaKindOf(mimeType: string): MediaKind | null {
  return mimeEntry(mimeType)?.kind ?? null;
}

/**
 * Every object belonging to one record: `<owner>/<vehicle>/<record>/`.
 *
 * The unit of listing, and the prefix the `on_record_deleted` trigger deletes
 * by. Throws rather than returning a best effort: the first segment is what
 * every storage policy compares to `auth.uid()`, so a path built from
 * something that is not a uuid is a request that should never be made.
 */
export function mediaPrefix(
  ownerId: string,
  vehicleId: string,
  recordId: string
): string {
  if (!isUuid(ownerId) || !isUuid(vehicleId) || !isUuid(recordId)) {
    throw new Error(
      "refusing to build a media path from a non-uuid segment: the first " +
        "segment is what every storage policy compares to auth.uid() " +
        "(refs specs/002-montero-garage SHR-01)"
    );
  }
  return `${ownerId}/${vehicleId}/${recordId}`;
}

/**
 * A fresh object path for an upload.
 *
 * The file name is generated, never the reader's. An uploaded name is
 * attacker-controlled text that becomes part of a URL: it can carry `../`, a
 * leading `/`, a NUL, an RTL override that makes `nota.exe` render as
 * `nota.gpj`, or four kilobytes of Unicode. None of that is worth keeping for a
 * voice note, so the stored name is a random identifier plus an extension
 * derived from the declared MIME type.
 *
 * `randomId` is injected so the graders can assert the shape without stubbing a
 * global; call sites pass {@link randomMediaId}.
 */
export function mediaObjectPath(input: {
  readonly ownerId: string;
  readonly vehicleId: string;
  readonly recordId: string;
  readonly mimeType: string;
  readonly randomId: string;
}): string {
  const entry = mimeEntry(input.mimeType);
  if (entry === undefined) {
    throw new Error(`refusing to store an unsupported type: ${input.mimeType}`);
  }
  if (!/^[A-Za-z0-9-]+$/.test(input.randomId)) {
    throw new Error("media id must be url-safe and free of path separators");
  }
  return `${mediaPrefix(input.ownerId, input.vehicleId, input.recordId)}/${input.randomId}.${entry.extension}`;
}

/** A random object id. Split out so `mediaObjectPath` stays pure. */
export function randomMediaId(): string {
  return crypto.randomUUID();
}

/**
 * `true` when a stored path is one of this owner's, under this record.
 *
 * Used to keep a listing honest rather than to grant anything: `storage_path`
 * is a column a client wrote, so a row can name a path pointing outside
 * `<owner>/`, and asking the Storage API to **delete** it would be asking for
 * somebody else's object on the owner's behalf. The bucket's policies already
 * refuse that; this stops it from being *asked for*. `receipt.ts` does the same
 * in `receiptPathBelongsTo`, and photos in `vehiclePhotoPaths`.
 *
 * Applied to the delete and enumerate paths only, never to signing — the
 * module docstring says which and why (T2-305 review, F1).
 */
export function mediaPathBelongsTo(
  ownerId: string,
  recordId: string,
  path: string
): boolean {
  if (!isUuid(ownerId) || !isUuid(recordId)) return false;
  const segments = path.split("/");
  return (
    segments.length === 4 &&
    segments[0] === ownerId &&
    segments[2] === recordId &&
    segments[3] !== ""
  );
}

/* -------------------------------------------------------------------------
 * The row
 * ---------------------------------------------------------------------- */

/**
 * The `record_media` row as the browser sees it — exactly the four columns
 * `tests/garage/contract.ts` pins, and no fifth.
 */
export interface RecordMediaRow {
  readonly id: string;
  readonly record_id: string;
  readonly storage_path: string;
  readonly media_kind: MediaKind;
}

/**
 * The columns an insert sends.
 *
 * There is no draft type beside it and there should not be: GAR-06′'s whole
 * point is that an attachment carries no typed fields of its own. The path is
 * built at upload time from the session's user id, so nothing a form holds can
 * put an object under another owner, and the kind is read from the file's
 * declared type rather than chosen — a reader who has to classify their own
 * voice note is being asked a question the browser already answered.
 */
export interface RecordMediaWrite {
  readonly record_id: string;
  readonly storage_path: string;
  readonly media_kind: MediaKind;
}

/**
 * The row body for a media insert, or `null` when the file is not one this
 * bucket takes.
 *
 * Returns `null` rather than throwing so the caller can report a refusal in the
 * reader's language, which is the same shape `receiptWriteFromDraft` uses.
 */
export function mediaWriteFromFile(
  recordId: string,
  storagePath: string,
  mimeType: string
): RecordMediaWrite | null {
  const kind = mediaKindOf(mimeType);
  if (kind === null) return null;
  return { record_id: recordId, storage_path: storagePath, media_kind: kind };
}

/**
 * How many attachments each record has — or `null`, meaning nobody knows.
 *
 * The same three-state shape as `receiptCountsByRecord`, and for the reason
 * PR #68 established: a failed request passed on as an empty map renders every
 * card as "nothing attached", which is a claim, and a false one, on a page
 * whose purpose is being the record of what happened. `null` is the state a
 * caller cannot mistake for zero.
 */
export function mediaCountsByRecord(
  rows: readonly Pick<RecordMediaRow, "record_id">[] | null
): ReadonlyMap<string, number> | null {
  if (rows === null) return null;
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.record_id, (counts.get(row.record_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Attachments in the order they are shown: by kind, then by id.
 *
 * Grouped by kind rather than by upload time because the three render as three
 * different things — an image, a video player, an audio player — and a list
 * that alternates between them is harder to scan than one that does not. `id`
 * breaks the tie so the order is stable across reloads; there is no timestamp
 * in the contract's four columns to sort by.
 */
export function sortRecordMedia(
  rows: readonly RecordMediaRow[]
): RecordMediaRow[] {
  const rank = (row: RecordMediaRow): number =>
    MEDIA_KINDS.indexOf(row.media_kind);
  return [...rows].sort(
    (left, right) => rank(left) - rank(right) || left.id.localeCompare(right.id)
  );
}
