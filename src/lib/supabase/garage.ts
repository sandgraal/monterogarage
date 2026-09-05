/**
 * Everything the garage page asks the database and the storage API for
 * (GAR-01′, GAR-02′, GAR-05′, SHR-01, MIG-03). Browser-only.
 *
 * The counterpart to `./auth.ts`: same shape, same rules, same reason for
 * existing. The page component holds markup and DOM wiring; every request,
 * every column list and every failure mode lives here, so the page never spells
 * a table name and a change of schema is a change to one file.
 *
 * ## This module trusts nothing and enforces nothing
 *
 * Not a hedge — a description of where the boundary is. Row-level security is
 * the enforcement, in the database, on every request (SHR-01: "no
 * client-trusted checks"). What this module does is *ask correctly*: it sends
 * the session's own `owner_id`, it scopes every mutation by id, and it builds
 * storage paths through `src/lib/garage/photos.ts`. If any of that were
 * subverted, the policies would refuse the request; the point of getting it
 * right here is that the honest path works, not that the dishonest one fails.
 *
 * `owner_id` is sent explicitly because `public.vehicles.owner_id` has no
 * default. The insert policy is `with check ((select auth.uid()) = owner_id)`,
 * so the client is *asked* who it is and the database decides whether to
 * believe it.
 *
 * ## Outcomes, not exceptions
 *
 * Every function returns a discriminated result rather than throwing, matching
 * `AuthOutcome` in `./auth.ts`. A garage page has exactly one honest thing to
 * do when a request fails — say so in the reader's language and leave what is
 * on screen alone — and that is easier to get right when failure is a value.
 *
 * refs specs/002-montero-garage (GAR-01′, GAR-02′, GAR-05′, SHR-01, SHR-03,
 * MIG-03)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "./auth.ts";
import {
  VEHICLE_PHOTOS_BUCKET,
  photoIssue,
  photoObjectPath,
  photoPrefix,
  randomPhotoId,
  type ChosenFile,
} from "../garage/photos.ts";
import {
  RECEIPTS_BUCKET,
  receiptIssue,
  receiptObjectPath,
  receiptPathBelongsTo,
  randomReceiptId,
  type ChosenReceipt,
  type ReceiptRow,
  type ReceiptWrite,
} from "../garage/receipt.ts";
import {
  RECORD_MEDIA_BUCKET,
  mediaIssue,
  mediaObjectPath,
  mediaPathBelongsTo,
  mediaWriteFromFile,
  randomMediaId,
  type ChosenMedia,
  type RecordMediaRow,
} from "../garage/record-media.ts";
import type { VehicleRow, VehicleWrite } from "../garage/vehicle.ts";
import type { RecordRow, RecordWrite } from "../garage/record.ts";

/**
 * The columns the page reads. Named rather than `select("*")`: a `*` would
 * quietly start shipping whatever a later migration adds — including a column
 * a future task means to keep server-side.
 */
const VEHICLE_COLUMNS =
  "id, owner_id, display_name, generation_id, market_id, model_year, " +
  "engine_id, odometer_km, photo_paths, is_showcase_public, is_worklog_public";

/** The record columns the page reads, for the same reason (GAR-02′). */
const RECORD_COLUMNS =
  "id, vehicle_id, occurred_on, kind, title, body, cost_amount, " +
  "cost_currency, time_minutes, odometer_km, problem_ids, part_ids, " +
  "procedure_ids, is_public, is_cost_public";

/** The receipt columns the page reads (GAR-05′). */
const RECEIPT_COLUMNS =
  "id, record_id, storage_path, vendor, issued_on, amount, currency";

/**
 * The media columns the page reads (GAR-06′) — the contract's four, minus the
 * `created_at` the migration keeps for its own sake.
 */
const RECORD_MEDIA_COLUMNS = "id, record_id, storage_path, media_kind";

/** How long a photo's signed URL lives. */
export const PHOTO_URL_TTL_SECONDS = 60 * 10;

/**
 * How long a receipt's signed URL lives.
 *
 * The same ten minutes as a photo, and for the same reason: this is the owner
 * looking at their own garage, a signed-in surface where a short-lived URL is
 * not a limitation anybody notices. A receipt is the most personal object this
 * site holds — a name, a date, an amount, sometimes a plate — so if the two
 * numbers were ever to diverge it would not be this one that grew.
 */
export const RECEIPT_URL_TTL_SECONDS = 60 * 10;

/**
 * PostgREST's result type, narrowed to ours.
 *
 * This project ships no generated `Database` types — that would be a fifth
 * copy of the schema, after the migration, the contract, `VehicleRow` and the
 * column list above — so `supabase-js` types an untyped `select(string)` as
 * `GenericStringError`, which overlaps with nothing. The cast is therefore
 * through `unknown` and lives in one place with this note, rather than being
 * repeated at five call sites where it would read as carelessness.
 *
 * What actually keeps the shape honest is `VEHICLE_COLUMNS`: the query names
 * the columns, so a rename in the schema is a request that errors rather than
 * a row with a missing field.
 */
function asRow(data: unknown): VehicleRow {
  return data as VehicleRow;
}

function asRows(data: unknown): VehicleRow[] {
  return (data ?? []) as VehicleRow[];
}

function asRecord(data: unknown): RecordRow {
  return data as RecordRow;
}

function asRecords(data: unknown): RecordRow[] {
  return (data ?? []) as RecordRow[];
}

function asReceipt(data: unknown): ReceiptRow {
  return data as ReceiptRow;
}

function asReceipts(data: unknown): ReceiptRow[] {
  return (data ?? []) as ReceiptRow[];
}

function asMedia(data: unknown): RecordMediaRow {
  return data as RecordMediaRow;
}

function asMediaRows(data: unknown): RecordMediaRow[] {
  return (data ?? []) as RecordMediaRow[];
}

export type GarageResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: "unconfigured" | "signed-out" | "failed" | "rejected";
    };

function failed<T>(): GarageResult<T> {
  return { ok: false, reason: "failed" };
}

/** The client plus the signed-in user's id, or why neither is available. */
async function session(): Promise<
  GarageResult<{ client: SupabaseClient; userId: string }>
> {
  const client = await getSupabaseClient();
  if (!client) return { ok: false, reason: "unconfigured" };
  const { data, error } = await client.auth.getSession();
  if (error) return failed();
  const userId = data.session?.user.id ?? null;
  if (userId === null) return { ok: false, reason: "signed-out" };
  return { ok: true, value: { client, userId } };
}

/** The signed-in account's id, or `null`. The page's gate. */
export async function currentUserId(): Promise<string | null> {
  const open = await session();
  return open.ok ? open.value.userId : null;
}

/* -------------------------------------------------------------------------
 * Asking "is anyone signed in?" without downloading a client
 * ---------------------------------------------------------------------- */

/**
 * The shape of the key `supabase-js` persists a session under.
 *
 * `sb-<project ref>-auth-token`, its default `storageKey`. Matched by shape
 * rather than rebuilt from the project URL, because the derivation is the
 * library's business and a second copy of it here would be wrong the day the
 * library changed it — and being wrong in that direction (no key matched)
 * would sign a reader out. See {@link hasStoredSession} for why a false
 * negative is the one failure that matters.
 */
export const SESSION_STORAGE_KEY_PATTERN = /^sb-.+-auth-token$/;

/**
 * `true` when this browser has a persisted session for *some* Supabase project.
 *
 * The point is what it lets the caller skip. `getSupabaseClient()` dynamically
 * imports `@supabase/supabase-js` — around 200 kB — and asking it "who is
 * signed in?" therefore costs that download **on page load**, for every
 * visitor, including the reference-site reader who clicked "Garage" out of
 * curiosity and is about to be shown a sign-in prompt. That measured 89 on the
 * Lighthouse performance budget against SCF-06's 90, and the wasted bytes were
 * the whole of the difference.
 *
 * Deliberately optimistic: a stray key means the client loads and then reports
 * no session, which costs a download and nothing else. A *missing* key when a
 * session exists would show a signed-in reader the sign-in prompt, so the
 * caller pairs this with {@link carriesAuthResponse} for the one case where a
 * real session has not been written to storage yet.
 */
export function hasStoredSession(win: Window): boolean {
  try {
    const storage = win.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && SESSION_STORAGE_KEY_PATTERN.test(key)) return true;
    }
    return false;
  } catch {
    // Storage blocked: no session can have been persisted either, so the
    // honest answer is the same one.
    return false;
  }
}

/**
 * `true` when this URL is a landing from an auth redirect.
 *
 * The moment `hasStoredSession` is wrong: a browser arriving from a magic link
 * or from Google carries the grant in the URL and has nothing in storage yet.
 * Today those land on the sign-in page rather than here, but "today's
 * `emailRedirectTo`" is not a property this page should depend on — a reader
 * who is silently signed out by a redirect target changing would have no way
 * to tell what happened.
 */
export function carriesAuthResponse(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  return ["code", "access_token", "error", "error_description"].some(
    (key) => url.searchParams.has(key) || hash.has(key)
  );
}

/**
 * The signed-in account's id, without paying for the client to find out there
 * is nobody. `null` means "show the sign-in prompt".
 *
 * The two conditions are an `or`, and the second one is the load-bearing half:
 * dropping it leaves a browser arriving from a magic link — grant in the URL,
 * nothing in storage yet — being told to sign in again, which is a loop with
 * no exit. That mutant survived the first version of these graders because
 * only `hasStoredSession` and `carriesAuthResponse` were tested, never their
 * composition (T2-301 review, M10).
 *
 * `ask` exists so the composition *is* observable: both branches return `null`
 * when nothing is configured, so a test that only reads the return value
 * cannot tell "asked and got nobody" from "never asked". Injecting the ask
 * makes the difference a fact instead of an inference.
 */
export async function currentUserIdIfAny(
  win: Window,
  ask: () => Promise<string | null> = currentUserId
): Promise<string | null> {
  if (!hasStoredSession(win) && !carriesAuthResponse(win.location.href)) {
    return null;
  }
  return ask();
}

/* -------------------------------------------------------------------------
 * Vehicles
 * ---------------------------------------------------------------------- */

/**
 * Every vehicle the signed-in user owns.
 *
 * No `.eq("owner_id", …)` filter, and that is not an oversight: the policy
 * `using ((select auth.uid()) = owner_id)` is what limits the rows, and adding
 * a client-side filter on top would make the page *look* like it depends on
 * one. If the filter were ever the thing doing the work, SHR-01 would already
 * be broken.
 */
export async function listVehicles(): Promise<GarageResult<VehicleRow[]>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client
    .from("vehicles")
    .select(VEHICLE_COLUMNS);
  if (error) return failed();
  return { ok: true, value: asRows(data) };
}

export async function createVehicle(
  write: VehicleWrite
): Promise<GarageResult<VehicleRow>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client
    .from("vehicles")
    .insert({ ...write, owner_id: open.value.userId })
    .select(VEHICLE_COLUMNS)
    .single();
  if (error || !data) return failed();
  return { ok: true, value: asRow(data) };
}

export async function updateVehicle(
  id: string,
  write: VehicleWrite
): Promise<GarageResult<VehicleRow>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client
    .from("vehicles")
    .update(write)
    .eq("id", id)
    .select(VEHICLE_COLUMNS)
    .single();
  if (error || !data) return failed();
  return { ok: true, value: asRow(data) };
}

/**
 * Delete a vehicle and, first, the objects that belong to it.
 *
 * Order matters and the belt-and-braces is deliberate. The Storage API is the
 * only thing that can remove the *bytes*; the `on_vehicle_deleted` trigger
 * removes the object *rows*, which is every route to those bytes, and is what
 * covers the case where this call did not happen or did not finish. Doing only
 * the trigger would leave unreferenced bytes behind; doing only this would
 * leave rows behind whenever a browser closed mid-request.
 *
 * A failure to remove objects does not abort the row delete: the trigger will
 * take the rows, and a vehicle a user asked to delete has to actually go.
 *
 * ## Receipts have no trigger behind them, and cannot
 *
 * `on_vehicle_deleted` sweeps the `vehicle-photos` bucket by
 * `<owner>/<vehicle>/` prefix. Receipt objects live at `<owner>/<file>` — the
 * shape `tests/garage/contract.ts` declares — so no prefix identifies one
 * vehicle's receipts and no trigger can find them without reading the rows it
 * is in the middle of cascading away. So this call is the *only* thing that
 * removes them, and it runs first, before the delete that destroys the index.
 * The account-level purge still covers the abandoned case, because it works on
 * the owner segment across both buckets (ACC-03).
 */
export async function deleteVehicle(id: string): Promise<GarageResult<null>> {
  const open = await session();
  if (!open.ok) return open;
  const { client, userId } = open.value;

  const listed = await listPhotoObjects(client, userId, id);
  if (listed.length > 0) {
    await client.storage.from(VEHICLE_PHOTOS_BUCKET).remove(listed);
  }

  const receipts = await vehicleReceiptPaths(client, userId, id);
  if (receipts.length > 0) {
    await client.storage.from(RECEIPTS_BUCKET).remove(receipts);
  }

  const media = await vehicleMediaPaths(client, userId, id);
  if (media.length > 0) {
    await client.storage.from(RECORD_MEDIA_BUCKET).remove(media);
  }

  const { error } = await client.from("vehicles").delete().eq("id", id);
  if (error) return failed();
  return { ok: true, value: null };
}

/* -------------------------------------------------------------------------
 * Photos
 * ---------------------------------------------------------------------- */

/** The object paths under one vehicle's prefix, as full paths. */
async function listPhotoObjects(
  client: SupabaseClient,
  ownerId: string,
  vehicleId: string
): Promise<string[]> {
  let prefix: string;
  try {
    prefix = photoPrefix(ownerId, vehicleId);
  } catch {
    return [];
  }
  const { data, error } = await client.storage
    .from(VEHICLE_PHOTOS_BUCKET)
    .list(prefix);
  if (error || !data) return [];
  return data.map((entry) => `${prefix}/${entry.name}`);
}

/**
 * Upload one photo and record its path on the vehicle.
 *
 * Two steps that have to both happen, in this order: the object first, then
 * the row. Reversed, a failed upload would leave a `photo_paths` entry
 * pointing at nothing and the page would render a broken image for a photo
 * that was never stored. This way a failed row update leaves an orphan object
 * instead — invisible, and swept by the vehicle-delete trigger and by the
 * account purge, both of which work on the prefix rather than on the array.
 *
 * `rejected` means the file itself was refused (wrong type, too large) rather
 * than the request failing, so the page can say which.
 */
export async function uploadVehiclePhoto(
  vehicle: VehicleRow,
  file: File
): Promise<GarageResult<VehicleRow>> {
  const open = await session();
  if (!open.ok) return open;
  const { client, userId } = open.value;

  if (photoIssue(file as ChosenFile) !== null) {
    return { ok: false, reason: "rejected" };
  }

  let path: string;
  try {
    path = photoObjectPath({
      ownerId: userId,
      vehicleId: vehicle.id,
      mimeType: file.type,
      randomId: randomPhotoId(),
    });
  } catch {
    return { ok: false, reason: "rejected" };
  }

  const uploaded = await client.storage
    .from(VEHICLE_PHOTOS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) return failed();

  return appendPhotoPath(client, vehicle, path);
}

/**
 * Remove one photo: the row's reference first, then the object.
 *
 * The mirror image of the upload's order, for the mirror-image reason. Dropping
 * the reference first means the worst case is an orphan object nobody renders;
 * deleting the object first would mean a live reference to bytes that are gone,
 * which is a broken image on the reader's own page.
 */
export async function removeVehiclePhoto(
  vehicle: VehicleRow,
  path: string
): Promise<GarageResult<VehicleRow>> {
  const open = await session();
  if (!open.ok) return open;
  const { client } = open.value;

  const updated = await mutatePhotoPaths(
    client,
    "remove_vehicle_photo",
    vehicle,
    path
  );
  if (!updated.ok) return updated;

  await client.storage.from(VEHICLE_PHOTOS_BUCKET).remove([path]);
  return updated;
}

function appendPhotoPath(
  client: SupabaseClient,
  vehicle: VehicleRow,
  path: string
): Promise<GarageResult<VehicleRow>> {
  return mutatePhotoPaths(client, "append_vehicle_photo", vehicle, path);
}

/**
 * Add or drop one entry of `vehicles.photo_paths`, **atomically**.
 *
 * ## The bug this replaces (found by T2-304, ticketed on T2-305)
 *
 * The previous version read `vehicle.photo_paths`, computed the new array in
 * the browser, and sent the whole thing back with an `update`. Two uploads
 * overlapping — which is what happens when a reader picks two photos in a row,
 * or has the garage open in two tabs — both start from the array as it was
 * before either of them, and the second write erases the first one's entry.
 * What is left behind is a real storage object that no row names: invisible to
 * its owner, still counted against their quota, and reachable again only by the
 * account purge. It happened for real while seeding Gitana Blanca and was
 * recovered by hand with direct SQL.
 *
 * The fix is `array_append` / `array_remove` inside a single `update`, which
 * reads and writes under the row lock Postgres already takes — so a concurrent
 * append waits and then appends to the array the first one left. That has to
 * live in the database: PostgREST cannot express a column expression in an
 * update, and a client-side upload queue is a promise one tab makes that a
 * second tab has never heard of.
 *
 * Both routines are `security invoker`, so `vehicles`' own policy still decides
 * whose row this is — exactly as it did for the `update` they replace. A caller
 * who does not own the vehicle updates no row and gets `null` back, which this
 * reports as a failure.
 *
 * The RPC returns just the resulting `photo_paths`, not the row, so the page's
 * `VEHICLE_COLUMNS` stays the only place that says what a vehicle row contains.
 */
async function mutatePhotoPaths(
  client: SupabaseClient,
  routine: "append_vehicle_photo" | "remove_vehicle_photo",
  vehicle: VehicleRow,
  path: string
): Promise<GarageResult<VehicleRow>> {
  const { data, error } = await client.rpc(routine, {
    p_vehicle_id: vehicle.id,
    p_path: path,
  });
  if (error || !Array.isArray(data)) return failed();
  return { ok: true, value: { ...vehicle, photo_paths: data as string[] } };
}

/**
 * Short-lived signed URLs for a vehicle's photos, keyed by object path.
 *
 * Signed, because the bucket is private and must stay that way (SHR-01), and
 * this is the owner looking at their own garage — a signed-in surface where a
 * ten-minute URL is not a limitation anybody notices.
 *
 * How a *public* showcase page (SHR-02) renders an object out of a private
 * bucket is a different question with a different answer, and
 * `tests/garage/contract.ts` deliberately leaves it to T2-401/T2-402. Nothing
 * here should be reused as if it were that answer: a URL long-lived enough for
 * a public page is a URL that has stopped being an access control.
 */
export async function signPhotoUrls(
  paths: readonly string[]
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;
  const client = await getSupabaseClient();
  if (!client) return signed;

  const { data, error } = await client.storage
    .from(VEHICLE_PHOTOS_BUCKET)
    .createSignedUrls([...paths], PHOTO_URL_TTL_SECONDS);
  if (error || !data) return signed;

  for (const entry of data) {
    if (entry.error !== null || !entry.signedUrl || !entry.path) continue;
    signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}

/* -------------------------------------------------------------------------
 * Records (GAR-02′)
 * ---------------------------------------------------------------------- */

/**
 * Every record on one vehicle.
 *
 * The `.eq("vehicle_id", …)` here is a *selection*, not a check, and the
 * difference matters enough to write down. `listVehicles` deliberately sends
 * no `owner_id` filter, because a filter that looked like the thing keeping
 * one user's trucks out of another's browser would hide whether the policy was
 * doing its job. Here the policy already limits the rows to the caller's own
 * vehicles' records; naming a vehicle narrows the caller's own data to the
 * page they are on, which is what a `where` is for.
 *
 * The database's ordering is a starting point only: `timelineOrder` in
 * `src/lib/garage/record.ts` is what the artboard's two-directional rail
 * actually needs, and it is the graded one.
 */
export async function listRecords(
  vehicleId: string
): Promise<GarageResult<RecordRow[]>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client
    .from("records")
    .select(RECORD_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .order("occurred_on", { ascending: false });
  if (error) return failed();
  return { ok: true, value: asRecords(data) };
}

/**
 * Insert one record.
 *
 * No `owner_id` to send: a record's ownership is its vehicle's, and the insert
 * policy checks it through the subquery `exists (select 1 from vehicles v
 * where v.id = records.vehicle_id and v.owner_id = auth.uid())`. So the honest
 * request names a vehicle and the database decides whether that vehicle is the
 * caller's.
 */
export async function createRecord(
  write: RecordWrite
): Promise<GarageResult<RecordRow>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client
    .from("records")
    .insert(write)
    .select(RECORD_COLUMNS)
    .single();
  if (error || !data) return failed();
  return { ok: true, value: asRecord(data) };
}

export async function updateRecord(
  id: string,
  write: RecordWrite
): Promise<GarageResult<RecordRow>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client
    .from("records")
    .update(write)
    .eq("id", id)
    .select(RECORD_COLUMNS)
    .single();
  if (error || !data) return failed();
  return { ok: true, value: asRecord(data) };
}

/**
 * Delete a record and, first, the receipt objects attached to it.
 *
 * `receipts` rows cascade with the record; the bytes do not, because a storage
 * object is not a row in `public`. So the objects have to go while their rows
 * still name them. Reversing the order would leave objects in the bucket with
 * nothing pointing at them — invisible to the owner, still counted against
 * their quota, and only reachable again by the account purge.
 *
 * A failure to remove the objects does not abort the row delete: a record the
 * user asked to delete has to actually go, and an orphan object is the smaller
 * of the two wrongs.
 */
export async function deleteRecord(id: string): Promise<GarageResult<null>> {
  const open = await session();
  if (!open.ok) return open;
  const { client, userId } = open.value;

  const attached = await listReceipts([id]);
  if (attached.ok) {
    const paths = attached.value
      .map((receipt) => receipt.storage_path)
      .filter((path) => receiptPathBelongsTo(userId, path));
    if (paths.length > 0) {
      await client.storage.from(RECEIPTS_BUCKET).remove(paths);
    }
  }

  // Media objects, for the same reason and with one difference: these DO have
  // a belt behind them. `on_record_deleted` sweeps `<owner>/<vehicle>/<record>/`
  // when the row goes, because the media path carries the record id and the
  // receipt path does not. This call still runs first, because the trigger can
  // only remove the object *rows* — the bytes in the storage backend are the
  // Storage API's, and reaching them from inside Postgres would mean keeping a
  // service key in the database.
  const media = await listRecordMedia([id]);
  if (media.ok) {
    const paths = media.value
      .map((entry) => entry.storage_path)
      .filter((path) => mediaPathBelongsTo(userId, id, path));
    if (paths.length > 0) {
      await client.storage.from(RECORD_MEDIA_BUCKET).remove(paths);
    }
  }

  const { error } = await client.from("records").delete().eq("id", id);
  if (error) return failed();
  return { ok: true, value: null };
}

/* -------------------------------------------------------------------------
 * Receipts (GAR-05′)
 * ---------------------------------------------------------------------- */

/**
 * The receipts attached to a set of records, in one request.
 *
 * One request rather than one per record: a timeline of forty entries would
 * otherwise open forty connections to render a row of chips. An empty id list
 * short-circuits, because `in.()` is a request that can only return nothing.
 */
export async function listReceipts(
  recordIds: readonly string[]
): Promise<GarageResult<ReceiptRow[]>> {
  if (recordIds.length === 0) return { ok: true, value: [] };
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client
    .from("receipts")
    .select(RECEIPT_COLUMNS)
    .in("record_id", [...recordIds]);
  if (error) return failed();
  return { ok: true, value: asReceipts(data) };
}

/**
 * Every receipt object path belonging to one vehicle, as the storage API needs
 * them.
 *
 * Two requests rather than one embedded resource: the record ids first, then
 * the paths. An embedded filter (`records!inner(vehicle_id)`) would do it in
 * one, at the price of a query whose correctness depends on PostgREST's
 * foreign-key introspection agreeing with what the reader of this file
 * assumes. Two plain requests are the shape a reviewer can check against the
 * policies.
 *
 * Paths outside `<owner>/` are dropped rather than sent: `storage_path` is a
 * column a client wrote, and asking the storage API to delete an arbitrary
 * name on the owner's behalf is a request that should never be made, whatever
 * the policies would do with it.
 */
async function vehicleReceiptPaths(
  client: SupabaseClient,
  ownerId: string,
  vehicleId: string
): Promise<string[]> {
  const records = await client
    .from("records")
    .select("id")
    .eq("vehicle_id", vehicleId);
  if (records.error || !records.data) return [];
  const ids = (records.data as unknown as { id: string }[]).map(
    (row) => row.id
  );
  if (ids.length === 0) return [];

  const receipts = await client
    .from("receipts")
    .select("storage_path")
    .in("record_id", ids);
  if (receipts.error || !receipts.data) return [];
  return (receipts.data as unknown as { storage_path: string }[])
    .map((row) => row.storage_path)
    .filter((path) => receiptPathBelongsTo(ownerId, path));
}

/**
 * Attach one receipt to a record: the object first, then the row.
 *
 * The order photos already established, for the mirror-image reason. A row
 * written before a failed upload points at bytes that do not exist, and the
 * page would offer a link that 404s. This way a failed insert leaves an orphan
 * object instead — and here, unlike photos, that case is cleaned up
 * immediately, because the path is known and no array has to be reconciled to
 * discover it.
 *
 * `toWrite` builds the row from the path this function generated, so the
 * caller never invents a `storage_path`: the owner segment comes from the
 * session and nothing a form holds can move an object under another owner.
 *
 * `rejected` means the file itself was refused (wrong type, too large) or the
 * typed fields beside it did not validate — the page can say which, because it
 * is the one that ran the validation.
 */
export async function uploadReceipt(
  recordId: string,
  file: File,
  toWrite: (path: string) => ReceiptWrite | null
): Promise<GarageResult<ReceiptRow>> {
  const open = await session();
  if (!open.ok) return open;
  const { client, userId } = open.value;

  if (receiptIssue(file as ChosenReceipt) !== null) {
    return { ok: false, reason: "rejected" };
  }

  let path: string;
  try {
    path = receiptObjectPath({
      ownerId: userId,
      mimeType: file.type,
      randomId: randomReceiptId(),
    });
  } catch {
    return { ok: false, reason: "rejected" };
  }

  const write = toWrite(path);
  if (write === null || write.record_id !== recordId) {
    return { ok: false, reason: "rejected" };
  }

  const uploaded = await client.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) return failed();

  const { data, error } = await client
    .from("receipts")
    .insert(write)
    .select(RECEIPT_COLUMNS)
    .single();
  if (error || !data) {
    // The bytes are stored and nothing points at them. Take them back out
    // rather than leave a file the owner can neither see nor delete.
    await client.storage.from(RECEIPTS_BUCKET).remove([path]);
    return failed();
  }
  return { ok: true, value: asReceipt(data) };
}

/**
 * Remove one receipt: the object first, then the row.
 *
 * The same order as {@link deleteRecord}, and for the same reason — which is
 * the reason receipts differ from photos here (T2-302 review, F2). A photo's
 * index is `vehicles.photo_paths`, an array that survives the object, so the
 * photo path drops the *reference* first and the worst case is an orphan
 * object nobody renders. A receipt's index is the row itself: delete it first
 * and a failed object delete leaves bytes that nothing in the system can name
 * again until the account purge sweeps the owner's whole prefix.
 *
 * The other order's cost is a row pointing at bytes that are gone, for as long
 * as it takes to press the button again — visible, retryable, and recoverable.
 * An unreachable object is none of the three.
 *
 * ## The object's failure stops the row, and here that is not belt-and-braces
 *
 * `deleteRecord` and `deleteVehicle` deliberately ignore a failed object
 * removal, because a record or a vehicle the user asked to delete has to go
 * and a trigger or the account purge sweeps up behind them. Neither is true of
 * one receipt: nothing else ever revisits a single object, so proceeding past
 * a reported failure would manufacture exactly the unreachable bytes the
 * ordering above exists to prevent (T2-302 review, round 2). So the error is
 * checked and the row stays — the receipt is still listed, and pressing remove
 * again is a retry rather than a dead end.
 *
 * An object that is already gone does not take this branch: the Storage API's
 * `remove` reports no error for a key that is not there, so a row whose bytes
 * vanished is still deletable.
 */
export async function removeReceipt(
  receipt: ReceiptRow
): Promise<GarageResult<null>> {
  const open = await session();
  if (!open.ok) return open;
  const { client, userId } = open.value;

  if (receiptPathBelongsTo(userId, receipt.storage_path)) {
    const removed = await client.storage
      .from(RECEIPTS_BUCKET)
      .remove([receipt.storage_path]);
    if (removed.error) return failed();
  }

  const { error } = await client.from("receipts").delete().eq("id", receipt.id);
  if (error) return failed();
  return { ok: true, value: null };
}

/**
 * Short-lived signed URLs for receipt objects, keyed by object path.
 *
 * Signed, because the bucket is private and must stay that way (SHR-01), and
 * this is the owner opening their own factura. SHR-03 is why nothing here is
 * reusable by a public work-log: a cost — and the receipt behind it — stays
 * private even on a published page unless it is opened per record, and a URL
 * long-lived enough to sit in a public page's markup has stopped being an
 * access control. That surface is T2-401/T2-402's, with SHR-06's
 * per-capability answer, and this function is not it.
 */
export async function signReceiptUrls(
  paths: readonly string[]
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;
  const client = await getSupabaseClient();
  if (!client) return signed;

  const { data, error } = await client.storage
    .from(RECEIPTS_BUCKET)
    .createSignedUrls([...paths], RECEIPT_URL_TTL_SECONDS);
  if (error || !data) return signed;

  for (const entry of data) {
    if (entry.error !== null || !entry.signedUrl || !entry.path) continue;
    signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}

/* -------------------------------------------------------------------------
 * Record media (GAR-06′)
 * ---------------------------------------------------------------------- */

/**
 * How long a media attachment's signed URL lives.
 *
 * **Thirty minutes, not the ten a photo or a receipt gets, and the difference
 * is the one thing about video that is genuinely different.** A signed URL is
 * checked when the request is made; a browser streaming a fifty-megabyte video
 * makes range requests for as long as playback lasts, so a ten-minute
 * signature can expire *mid-playback* on a slow connection and the player
 * stops with an error that looks like a broken file. Thirty minutes is still
 * short enough to be an access control on a signed-in surface, and long enough
 * that nobody watches a repair video across the boundary.
 *
 * This is not, and must not become, the answer for a public work-log page: a
 * URL long-lived enough to sit in a static page's markup has stopped being an
 * access control at all. That is T2-401/T2-402's question.
 */
export const RECORD_MEDIA_URL_TTL_SECONDS = 60 * 30;

/**
 * The media attached to a set of records, in one request.
 *
 * One request rather than one per record, for the reason `listReceipts`
 * records: a timeline of forty entries would otherwise open forty connections
 * to render a row of chips.
 */
export async function listRecordMedia(
  recordIds: readonly string[]
): Promise<GarageResult<RecordMediaRow[]>> {
  if (recordIds.length === 0) return { ok: true, value: [] };
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client
    .from("record_media")
    .select(RECORD_MEDIA_COLUMNS)
    .in("record_id", [...recordIds]);
  if (error) return failed();
  return { ok: true, value: asMediaRows(data) };
}

/**
 * Every media object path belonging to one vehicle.
 *
 * Two requests rather than one embedded resource, matching
 * `vehicleReceiptPaths`: the record ids first, then the paths. An embedded
 * filter would do it in one, at the price of a query whose correctness depends
 * on PostgREST's foreign-key introspection agreeing with what the reader of
 * this file assumes.
 *
 * A path that does not live under `<owner>/…/<its own record>/` is dropped
 * rather than sent. `storage_path` is a column a client wrote, and asking the
 * storage API to delete an arbitrary name on the owner's behalf is a request
 * that should never be made, whatever the policies would do with it.
 */
async function vehicleMediaPaths(
  client: SupabaseClient,
  ownerId: string,
  vehicleId: string
): Promise<string[]> {
  const records = await client
    .from("records")
    .select("id")
    .eq("vehicle_id", vehicleId);
  if (records.error || !records.data) return [];
  const ids = (records.data as unknown as { id: string }[]).map(
    (row) => row.id
  );
  if (ids.length === 0) return [];

  const media = await client
    .from("record_media")
    .select("record_id, storage_path")
    .in("record_id", ids);
  if (media.error || !media.data) return [];
  return (
    media.data as unknown as { record_id: string; storage_path: string }[]
  )
    .filter((row) =>
      mediaPathBelongsTo(ownerId, row.record_id, row.storage_path)
    )
    .map((row) => row.storage_path);
}

/**
 * Attach one media file to a record: the object first, then the row.
 *
 * The order receipts already established, for the same reason. A row written
 * before a failed upload points at bytes that do not exist, and the page would
 * offer a player that plays nothing. This way a failed insert leaves an orphan
 * object — and, as with receipts, that case is cleaned up immediately, because
 * the path is known and there is no array to reconcile to discover it.
 *
 * There is nothing to validate beside the file, and that is the requirement
 * rather than an omission: GAR-06′ says an attachment is "independent of a
 * receipt's vendor/date/amount fields", and the WhatsApp voice note that
 * motivated it cannot be filed at all if the form asks for a vendor first. The
 * kind is read from the declared MIME type, not chosen by the reader.
 *
 * `rejected` means the file itself was refused — wrong type, or too large.
 */
export async function uploadRecordMedia(
  vehicleId: string,
  recordId: string,
  file: File
): Promise<GarageResult<RecordMediaRow>> {
  const open = await session();
  if (!open.ok) return open;
  const { client, userId } = open.value;

  if (mediaIssue(file as ChosenMedia) !== null) {
    return { ok: false, reason: "rejected" };
  }

  let path: string;
  try {
    path = mediaObjectPath({
      ownerId: userId,
      vehicleId,
      recordId,
      mimeType: file.type,
      randomId: randomMediaId(),
    });
  } catch {
    return { ok: false, reason: "rejected" };
  }

  const write = mediaWriteFromFile(recordId, path, file.type);
  if (write === null) return { ok: false, reason: "rejected" };

  const uploaded = await client.storage
    .from(RECORD_MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) return failed();

  const { data, error } = await client
    .from("record_media")
    .insert(write)
    .select(RECORD_MEDIA_COLUMNS)
    .single();
  if (error || !data) {
    // The bytes are stored and nothing points at them. Take them back out
    // rather than leave a file the owner can neither see nor delete.
    await client.storage.from(RECORD_MEDIA_BUCKET).remove([path]);
    return failed();
  }
  return { ok: true, value: asMedia(data) };
}

/**
 * Remove one attachment: the object first, then the row.
 *
 * The receipts order, and for the receipts reason (T2-302 review, F2). A
 * photo's index is `vehicles.photo_paths`, an array that survives the object,
 * so the photo path can drop the reference first. A media attachment's index is
 * the row itself — delete it first and a failed object delete leaves bytes that
 * nothing can name again until `on_record_deleted` or the account purge sweeps
 * the prefix.
 *
 * The object's failure stops the row, and here that is not belt-and-braces:
 * nothing else revisits a *single* object, so proceeding past a reported
 * failure would manufacture exactly the unreachable bytes the ordering exists
 * to prevent. An object that is already gone does not take this branch — the
 * Storage API reports no error for a key that is not there.
 */
export async function removeRecordMedia(
  media: RecordMediaRow
): Promise<GarageResult<null>> {
  const open = await session();
  if (!open.ok) return open;
  const { client, userId } = open.value;

  if (mediaPathBelongsTo(userId, media.record_id, media.storage_path)) {
    const removed = await client.storage
      .from(RECORD_MEDIA_BUCKET)
      .remove([media.storage_path]);
    if (removed.error) return failed();
  }

  const { error } = await client
    .from("record_media")
    .delete()
    .eq("id", media.id);
  if (error) return failed();
  return { ok: true, value: null };
}

/**
 * Short-lived signed URLs for media objects, keyed by object path.
 *
 * Signed, because the bucket is private and must stay that way (SHR-01), and
 * this is the owner looking at their own record. GAR-06′ says an attachment is
 * "never publicly accessible unless the record's visibility is opened", and
 * nothing here is that: opening a record is a *sharing* decision with its own
 * surface (SHR-02, SHR-06), and a URL long-lived enough for a public page has
 * stopped being an access control.
 */
export async function signRecordMediaUrls(
  paths: readonly string[]
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;
  const client = await getSupabaseClient();
  if (!client) return signed;

  const { data, error } = await client.storage
    .from(RECORD_MEDIA_BUCKET)
    .createSignedUrls([...paths], RECORD_MEDIA_URL_TTL_SECONDS);
  if (error || !data) return signed;

  for (const entry of data) {
    if (entry.error !== null || !entry.signedUrl || !entry.path) continue;
    signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}
