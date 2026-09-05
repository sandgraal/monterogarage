/**
 * Receipts: the bucket, the path scheme, what may be uploaded, and the row
 * that points at it (GAR-05′, SHR-01, SHR-03).
 *
 * > **GAR-05′** Receipts SHALL be first-class: uploadable (image/PDF) into
 * > user-private storage, with vendor/date/amount fields, never publicly
 * > accessible unless the specific record's cost visibility is opened.
 *
 * The receipts twin of `./photos.ts`, and deliberately its near-copy: the same
 * "the path is the ownership claim" reasoning, the same generated file name,
 * the same fail-fast size and type check in front of a server-side one. Where
 * it differs, it differs because the contract says so.
 *
 * ## The path *is* the ownership claim
 *
 * `supabase/migrations/…_receipts_storage.sql` scopes every policy on the
 * bucket to `(storage.foldername(name))[1] = auth.uid()::text`, because the
 * first segment of an object's path is the only thing about a storage row that
 * says whose it is. That makes {@link receiptObjectPath} security-relevant
 * code rather than a formatting helper:
 *
 *     receipts/<owner uuid>/<random>.<ext>
 *               ^^^^^^^^^^
 *               the only segment any policy reads
 *
 * ## Why there is no vehicle or record segment (and photos have one)
 *
 * `tests/garage/contract.ts` declares the receipts path as
 * `<owner uuid>/<file>` — `testReceiptPath(ownerId, slot)` — and declares the
 * photo path as `<owner uuid>/<vehicle id>/<file>`. The difference is not an
 * inconsistency, it is what each side has to reconcile against:
 *
 * - A photo's association to its vehicle is an entry in `vehicles.photo_paths`
 *   — an array a client wrote, which can disagree with the bucket in both
 *   directions. So "delete this vehicle's photos" is a *prefix* match, and the
 *   vehicle segment is what makes that possible without trusting the array.
 * - A receipt's association is `public.receipts`, one row per object, carrying
 *   `storage_path`. There is nothing to reconcile: the row *is* the index, it
 *   cascades away with its record and its vehicle, and every object it names
 *   can be removed by name. A second path segment would add a way for the path
 *   and the row to disagree about which record a receipt belongs to, and the
 *   row would still be the answer.
 *
 * What that costs is stated rather than hidden. Deleting a *vehicle* removes
 * its receipt rows by cascade, but no foreign key reaches storage and no
 * prefix identifies "this vehicle's receipts", so the objects have to be
 * removed by name before the row goes — which is what
 * `src/lib/supabase/garage.ts` does, in the same order and for the same reason
 * as photos. The account-level purge is unaffected: it deletes by *owner*
 * prefix across both buckets, and the owner is segment one here too.
 *
 * ## Four constants here are restatements, and nothing checks that they agree
 *
 * The bucket id, the MIME allow-list, the size limit and the path shape are
 * all *copies*: `tests/garage/contract.ts` declares the bucket id and the path,
 * and `…_receipts_storage.sql` declares the bucket id, the MIME list and the
 * limit, where they are the ones actually enforced. This copy exists so the
 * page can refuse a file before spending a reader's data uploading it — but no
 * test ties the two sides together, so a migration that widened the limit or
 * dropped a type would leave this file quietly wrong, and the symptom would be
 * an upload that fails after the bytes have gone up the wire (T2-302 review).
 * Importing the contract's declarations into `src/` — or grading the pair —
 * is the fix; it belongs with whoever next touches the storage contract, and
 * `photos.ts` carries the identical exposure.
 *
 * ## The file name is generated, never the reader's
 *
 * An uploaded name is attacker-controlled text that becomes part of a URL: it
 * can carry `../`, a leading `/`, a NUL, an RTL override that makes
 * `receipt.exe` render as `receipt.gpj`, or four kilobytes of Unicode. None of
 * that is worth keeping for a photograph of a factura, so the stored name is a
 * random identifier plus an extension derived from the *declared MIME type*,
 * which is the field that decides how a browser will treat the bytes.
 *
 * refs specs/002-montero-garage (GAR-05′, SHR-01, SHR-03, MIG-03)
 */

import { isUuid } from "./photos.ts";
import {
  CURRENCY_CODE_PATTERN,
  RECORD_DATE_RANGE,
  isCalendarDate,
  parseCost,
  type CostIssue,
} from "./record.ts";

/**
 * The private bucket receipts live in — the contract's `RECEIPTS_BUCKET`.
 *
 * `public = false` in the migration, which is the single decision governing
 * whether every receipt in the system has a permanent unauthenticated URL.
 * Nothing in this module may work around it: the owner's own page reads its
 * objects through short-lived signed URLs, and how a *shared* surface reads
 * one is a Phase P3 question (SHR-03, SHR-06) this file does not answer.
 */
export const RECEIPTS_BUCKET = "receipts";

/**
 * What may be uploaded, and the extension each type is stored under.
 *
 * The same five the migration's `allowed_mime_types` names, where they are
 * enforced; this copy is what lets the page refuse a file before spending the
 * reader's data on the upload. PDF is here and is absent from the photos
 * bucket, because GAR-05′ says "image/PDF" and a receipt genuinely arrives as
 * a scan. AVIF is *not* here, and is present for photos, for the same reason
 * in reverse: the bucket's list is the authority and this must not claim to
 * accept something the server will reject after the upload.
 */
export const RECEIPT_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export const RECEIPT_MIME_TYPES: readonly string[] = Object.keys(
  RECEIPT_MIME_EXTENSIONS
);

/**
 * Twenty megabytes — the migration's `file_size_limit`, and twice the photos
 * bucket's. A phone photo is one to five; it was the scanned multi-page
 * invoice that needed the larger number.
 */
export const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;

/** Why a chosen file was refused, or `null` when it was not. */
export type ReceiptIssue = "unsupported-type" | "too-large";

/** The minimum of `File` this module needs, so the graders need no DOM. */
export interface ChosenReceipt {
  readonly type: string;
  readonly size: number;
}

/**
 * The stored extension for a declared type, or `undefined`.
 *
 * `Object.hasOwn`, for the reason `photos.ts` records at its own copy of this
 * (T2-305 review, F2): `in` and a bare bracket lookup both walk the prototype
 * chain, so `"constructor"` — an ordinary string a `Content-Type` header can
 * carry — reads as a member and returns `Object` rather than `undefined`.
 */
function receiptExtension(mimeType: string): string | undefined {
  const key = mimeType.toLowerCase();
  return Object.hasOwn(RECEIPT_MIME_EXTENSIONS, key)
    ? RECEIPT_MIME_EXTENSIONS[key]
    : undefined;
}

export function receiptIssue(file: ChosenReceipt): ReceiptIssue | null {
  if (receiptExtension(file.type) === undefined) return "unsupported-type";
  if (file.size > MAX_RECEIPT_BYTES) return "too-large";
  return null;
}

/**
 * Every receipt object belonging to one owner: `<owner>/`.
 *
 * The unit the account purge works on (ACC-03), and the only prefix this
 * bucket has. Per-vehicle and per-record cleanup go by name, through
 * `receipts.storage_path` — see the note at the top of this file.
 */
export function receiptPrefix(ownerId: string): string {
  if (!isUuid(ownerId)) {
    throw new Error(
      "refusing to build a receipt path from a non-uuid owner: the first " +
        "segment is what every storage policy compares to auth.uid() " +
        "(refs specs/002-montero-garage SHR-01)"
    );
  }
  return ownerId;
}

/**
 * A fresh object path for an upload.
 *
 * `randomId` is injected so the graders can assert the shape without stubbing
 * a global; call sites pass {@link randomReceiptId}, which is
 * `crypto.randomUUID`.
 */
export function receiptObjectPath(input: {
  readonly ownerId: string;
  readonly mimeType: string;
  readonly randomId: string;
}): string {
  const extension = receiptExtension(input.mimeType);
  if (extension === undefined) {
    throw new Error(`refusing to store an unsupported type: ${input.mimeType}`);
  }
  if (!/^[A-Za-z0-9-]+$/.test(input.randomId)) {
    throw new Error("receipt id must be url-safe and free of path separators");
  }
  return `${receiptPrefix(input.ownerId)}/${input.randomId}.${extension}`;
}

/** A random object id. Split out so `receiptObjectPath` stays pure. */
export function randomReceiptId(): string {
  return crypto.randomUUID();
}

/**
 * `true` when a stored path is one of this owner's, in this bucket's shape.
 *
 * Used to keep a listing honest rather than to grant anything: `storage_path`
 * is a column a client wrote, so a row can name a path that points outside
 * `<owner>/`, and asking the storage API to sign it would be asking for
 * somebody else's object on the owner's behalf. The bucket's policies already
 * refuse that; this stops it from being *asked for*. The photos side does the
 * same in `vehiclePhotoPaths`.
 */
export function receiptPathBelongsTo(ownerId: string, path: string): boolean {
  if (!isUuid(ownerId)) return false;
  const segments = path.split("/");
  return segments.length === 2 && segments[0] === ownerId && segments[1] !== "";
}

/* -------------------------------------------------------------------------
 * The row
 * ---------------------------------------------------------------------- */

/**
 * The `receipts` row as the browser sees it — exactly the columns
 * `tests/garage/contract.ts` pins.
 *
 * `vendor`, `issued_on` and `amount`/`currency` are GAR-05′'s
 * "parsed-or-typed" fields. Nothing in this task parses them out of the image:
 * they are typed by the owner, and a field the site guessed at would be the
 * site putting words in a record that is the owner's testimony. Parsing is a
 * later, opt-in question with its own consent story.
 */
export interface ReceiptRow {
  readonly id: string;
  readonly record_id: string;
  readonly storage_path: string;
  readonly vendor: string | null;
  readonly issued_on: string | null;
  readonly amount: number | null;
  readonly currency: string | null;
}

/** The columns an insert sends. The path is built here, not typed. */
export interface ReceiptWrite {
  readonly record_id: string;
  readonly storage_path: string;
  readonly vendor: string | null;
  readonly issued_on: string | null;
  readonly amount: number | null;
  readonly currency: string | null;
}

/** The form's working copy for the fields beside the file. */
export interface ReceiptDraft {
  readonly vendor: string;
  readonly issuedOn: string;
  readonly amount: string;
  readonly currency: string;
}

/**
 * The longest vendor name accepted. A repuestera's name and its branch fit in
 * a hundred characters; past that it is the address as well.
 */
export const MAX_VENDOR_LENGTH = 100;

export const EMPTY_RECEIPT_DRAFT: ReceiptDraft = {
  vendor: "",
  issuedOn: "",
  amount: "",
  currency: "",
};

/**
 * How many receipts each record has — or `null`, meaning nobody knows.
 *
 * ## Why the "unknown" case is a type and not a flag
 *
 * The timeline draws a receipts chip when a record has receipts and no chip
 * when it has none. Those are the only two states a `Map<string, number>` can
 * express, so a *failed* receipts request had nowhere to go: passing an empty
 * map rendered every card as "no receipts attached", which is a claim, and a
 * false one, on a page whose whole purpose is being the record of what
 * happened (T2-302 review, PR #68). Nothing said it had failed, either.
 *
 * `null` is that missing third state. A caller cannot accidentally treat it as
 * zero — the type stops it — and the page's job becomes the one it should have
 * had all along: say the counts are unavailable, and draw no chip that would
 * imply otherwise.
 *
 * @param rows every receipt attached to the records on screen, or `null` when
 *   the request for them failed.
 */
export function receiptCountsByRecord(
  rows: readonly Pick<ReceiptRow, "record_id">[] | null
): ReadonlyMap<string, number> | null {
  if (rows === null) return null;
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.record_id, (counts.get(row.record_id) ?? 0) + 1);
  }
  return counts;
}

/** Receipts in the order they are shown: by issue date, then by id. */
export function sortReceipts(rows: readonly ReceiptRow[]): ReceiptRow[] {
  return [...rows].sort(
    (left, right) =>
      (right.issued_on ?? "").localeCompare(left.issued_on ?? "") ||
      left.id.localeCompare(right.id)
  );
}

export type ReceiptDraftIssue =
  | { readonly field: "vendor"; readonly code: "too-long" }
  | {
      readonly field: "issuedOn";
      readonly code: "not-a-date" | "out-of-range";
    }
  | { readonly field: "amount"; readonly code: CostIssue }
  | { readonly field: "currency"; readonly code: "unknown" };

/**
 * Every issue in a receipt draft, empty when it is attachable.
 *
 * Every field is optional — GAR-05′ asks for vendor/date/amount fields, not
 * for a form that refuses the photograph until they are filled in. The
 * commonest honest state is a picture of a factura and nothing typed yet, and
 * a receipt nobody could attach is a receipt nobody keeps.
 *
 * The amount goes through `parseCost`, so the whole `1.500` argument (see
 * `./record.ts`) applies here unchanged rather than being decided twice.
 */
export function validateReceiptDraft(
  draft: ReceiptDraft
): readonly ReceiptDraftIssue[] {
  const issues: ReceiptDraftIssue[] = [];

  if (draft.vendor.trim().length > MAX_VENDOR_LENGTH) {
    issues.push({ field: "vendor", code: "too-long" });
  }

  const issuedOn = draft.issuedOn.trim();
  if (issuedOn !== "") {
    if (!isCalendarDate(issuedOn)) {
      issues.push({ field: "issuedOn", code: "not-a-date" });
    } else if (
      issuedOn < RECORD_DATE_RANGE.from ||
      issuedOn > RECORD_DATE_RANGE.to
    ) {
      issues.push({ field: "issuedOn", code: "out-of-range" });
    }
  }

  const amount = parseCost(draft.amount);
  if (amount.issue !== null) {
    issues.push({ field: "amount", code: amount.issue });
  }
  if (amount.amount !== null && !CURRENCY_CODE_PATTERN.test(draft.currency)) {
    issues.push({ field: "currency", code: "unknown" });
  }

  return issues;
}

/**
 * The row body for a receipt insert, or `null` when the draft has issues.
 *
 * `storage_path` is not the draft's: it is built by
 * {@link receiptObjectPath} from the session's own user id at the moment of
 * upload, so no field a page holds can put an object under another owner.
 */
export function receiptWriteFromDraft(
  recordId: string,
  storagePath: string,
  draft: ReceiptDraft
): ReceiptWrite | null {
  if (validateReceiptDraft(draft).length > 0) return null;
  const vendor = draft.vendor.replace(/\s+/g, " ").trim();
  const issuedOn = draft.issuedOn.trim();
  const amount = parseCost(draft.amount).amount;
  return {
    record_id: recordId,
    storage_path: storagePath,
    vendor: vendor === "" ? null : vendor,
    issued_on: issuedOn === "" ? null : issuedOn,
    amount,
    currency: amount === null ? null : draft.currency,
  };
}
