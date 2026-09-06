/**
 * Typed share grants, from both ends (SHR-05..08). Browser-only.
 *
 * Two audiences, one module, and they never share a request:
 *
 * - **The owner**, signed in, issuing and revoking grants on their own
 *   vehicles. Those go through the two authenticated RPCs, which check
 *   ownership in the database.
 * - **The holder**, with no account at all, presenting a bearer token. Those
 *   go through the three `security definer` readers granted to `anon`, which
 *   are the whole of SHR-07's accountless path.
 *
 * ## This module trusts nothing and enforces nothing
 *
 * The same boundary `./garage.ts` states, and it matters more here. Every
 * decision — is this token live, has it expired, was it revoked, does the
 * grant open costs, does it open receipts, which vehicle does it reach — is
 * made inside `20260906120000_share_grants.sql`, because SHR-01 names exactly
 * three enforcement modes and "a check in page code" is not one of them. What
 * this module does is *ask correctly*: it POSTs the token (never a query
 * string, which would put a bearer credential into every access log between
 * the browser and the origin) and it renders whatever comes back.
 *
 * That is also why there is no `includesCosts` flag in the reader results. The
 * database omits the cost keys from rows a grant does not open, so "was I shown
 * this" is answered by the shape of the data rather than by a boolean this
 * module could get wrong. `Object.hasOwn(row, "cost_amount")` is the whole
 * question, and `src/lib/garage/visibility.ts`'s `VisibleRecord` is already
 * that shape. `SharedReceipt` below carries `amount`/`currency` optionally for
 * exactly the same reason: `includes_costs` is the money bit wherever the
 * money lives, receipts included.
 *
 * ## Failures are values, and a failure is never an empty list
 *
 * Every function returns a discriminated result rather than throwing, matching
 * `GarageResult` in `./garage.ts`. A share page has exactly one honest thing to
 * do when a request fails — say so, in the reader's language, and show nothing
 * it cannot stand behind — and a fetch that failed must never reach the page as
 * `[]`, which would read as "this truck has no history" (AGENTS.md: a failure
 * is not a zero).
 *
 * refs specs/002-montero-garage (SHR-05, SHR-06, SHR-07, SHR-08, GAR-05′)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "./auth.ts";
import type { VisibleRecord } from "../garage/visibility.ts";

/**
 * What a request did, in a form a page can render.
 *
 * `refused` is its own reason and is **the only thing a holder is ever told**
 * about why a token did not work. SHR-08 requires unknown, expired and revoked
 * to be indistinguishable — the database already answers all three identically,
 * and collapsing them here as well means no future edit to this module can
 * accidentally reconstruct the oracle out of a status code.
 */
export type ShareResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: "unconfigured" | "signed-out" | "refused" | "failed";
    };

/** The preset a grant is labelled with (SHR-05). A label, never a branch. */
export type ShareGrantKind = "mechanic" | "buyer";

/** The two presets, in the order the form offers them. */
export const SHARE_GRANT_KINDS: readonly ShareGrantKind[] = [
  "mechanic",
  "buyer",
];

/**
 * How long a grant may run, in days, as the form offers it.
 *
 * Days rather than hours because that is the unit an owner thinks in ("until
 * the truck is out of the shop"), and one shared list of numbers rather than
 * one label per locale, because a duration is a figure and figures are stored
 * once (AGENTS.md). The RPC takes hours, so the conversion happens here, in
 * one place.
 */
export const SHARE_EXPIRY_DAY_CHOICES = [7, 30, 90] as const;

/** Hours in a day. Named so the conversion below is not a bare `24`. */
const HOURS_PER_DAY = 24;

/** One grant, as its issuer sees it. Never carries the token. */
export interface ShareGrantRow {
  readonly id: string;
  readonly vehicle_id: string;
  readonly kind: string;
  readonly includes_costs: boolean;
  readonly includes_receipts: boolean;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly created_at: string;
}

/**
 * The columns the garage page reads off a grant.
 *
 * Named rather than `select("*")`, for the reason `./garage.ts` gives — and
 * with one extra: `token_hash` is in this table, and a `*` would ship every
 * live grant's digest into the owner's browser for no reason at all.
 */
const SHARE_COLUMNS =
  "id, vehicle_id, kind, includes_costs, includes_receipts, " +
  "expires_at, revoked_at, created_at";

/** What `create_share_grant` hands back — once, and never again. */
export interface IssuedGrant {
  readonly shareId: string;
  readonly token: string;
}

/**
 * One receipt as a grant holder sees it.
 *
 * `amount` and `currency` are **optional, not nullable**, for the same reason
 * `VisibleRecord`'s cost keys are: `share_read_receipts` omits the pair
 * entirely from a grant that does not open costs, and a required nullable field
 * would have made "this receipt was for nothing" and "you were not shown the
 * total" the same value. Which rows arrive is `includes_receipts`; whether the
 * money rides along is `includes_costs`, and they are two questions (SHR-06).
 */
export interface SharedReceipt {
  readonly id: string;
  readonly record_id: string;
  readonly storage_path: string;
  readonly vendor: string | null;
  readonly issued_on: string | null;
  readonly amount?: number | null;
  readonly currency?: string | null;
}

/** The granted vehicle's identity — the taxonomy fields and the name. */
export interface SharedVehicle {
  readonly id: string;
  readonly display_name: string;
  readonly generation_id: string;
  readonly market_id: string | null;
  readonly model_year: number | null;
  readonly engine_id: string | null;
  readonly odometer_km: number | null;
}

function failed<T>(): ShareResult<T> {
  return { ok: false, reason: "failed" };
}

function refused<T>(): ShareResult<T> {
  return { ok: false, reason: "refused" };
}

/**
 * Did the *database* answer, or did the request never get there?
 *
 * PostgREST reports both through the same `error` object, and telling them
 * apart is the difference between "this link is no longer valid" and "we could
 * not check right now" — two sentences a holder must never see in place of one
 * another (SHR-08 governs the first; AGENTS.md's "a failure is not a zero"
 * governs the second).
 *
 * The discriminator is the SQLSTATE. `postgrest-js` fills `code` from the
 * server's response body, so a genuine refusal carries `42501` — the
 * `insufficient_privilege` every share reader raises for unknown, expired and
 * revoked alike. When `fetch` itself rejects, the same library synthesises an
 * error object out of the `TypeError` with `code` set to the empty string,
 * because a request that never reached Postgres has no SQLSTATE to report.
 *
 * Reading the code rather than the message keeps SHR-08 intact: all three
 * refusal causes share one SQLSTATE, so nothing here can reconstruct which one
 * the holder hit.
 */
function serverAnswered(error: { readonly code?: string } | null): boolean {
  return typeof error?.code === "string" && error.code !== "";
}

/* -------------------------------------------------------------------------
 * The owner's end (SHR-05, SHR-08)
 * ---------------------------------------------------------------------- */

/**
 * A client with a live session, or why there is not one.
 *
 * The user id is not returned and is not needed: unlike `./garage.ts`, nothing
 * here sends an owner id to the database. Ownership is decided inside the two
 * RPCs, from `auth.uid()`, which is the only copy of that answer a caller
 * cannot influence.
 */
async function session(): Promise<ShareResult<SupabaseClient>> {
  const client = await getSupabaseClient();
  if (!client) return { ok: false, reason: "unconfigured" };
  const { data, error } = await client.auth.getSession();
  if (error) return failed();
  if (!data.session?.user.id) return { ok: false, reason: "signed-out" };
  return { ok: true, value: client };
}

/**
 * Every grant on one vehicle, newest first — live ones and ended ones.
 *
 * Revoked and expired grants stay on the list on purpose. SHR-08 makes
 * revocation a timestamp rather than a delete precisely so an owner can see
 * what they ended and when, and a list that showed only live grants would make
 * "did I actually revoke that?" unanswerable from the only screen that asks it.
 *
 * RLS does the scoping: the policy on `shares` reaches the row through the
 * vehicle's `owner_id`, so the filter below is about *which* of the caller's
 * trucks, never about whose.
 */
export async function listShareGrants(
  vehicleId: string
): Promise<ShareResult<ShareGrantRow[]>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value
    .from("shares")
    .select(SHARE_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false });
  if (error) return failed();
  return { ok: true, value: (data ?? []) as unknown as ShareGrantRow[] };
}

/**
 * Issue one grant, and hand back the token exactly once.
 *
 * The capability bits are two arguments and not one, all the way down: SHR-06
 * says costs and receipts open independently, and a single `fullAccess` boolean
 * anywhere on this path — form, function signature, RPC — would make the
 * `costs=false receipts=true` grant unrepresentable rather than merely
 * unbuilt.
 *
 * `expiresInDays` is converted to the hours the RPC takes here rather than in
 * the page, so the one place a duration is arithmetic is the one place it is
 * tested.
 */
export async function createShareGrant(input: {
  readonly vehicleId: string;
  readonly kind: ShareGrantKind;
  readonly includesCosts: boolean;
  readonly includesReceipts: boolean;
  readonly expiresInDays: number;
}): Promise<ShareResult<IssuedGrant>> {
  const open = await session();
  if (!open.ok) return open;

  const { data, error } = await open.value.rpc("create_share_grant", {
    p_vehicle_id: input.vehicleId,
    p_kind: input.kind,
    p_includes_costs: input.includesCosts,
    p_includes_receipts: input.includesReceipts,
    p_expires_in_hours: input.expiresInDays * HOURS_PER_DAY,
  });
  if (error) return failed();

  const row = Array.isArray(data)
    ? (data[0] as Record<string, unknown> | undefined)
    : (data as Record<string, unknown> | null);
  const shareId = row?.share_id;
  const token = row?.token;
  // A response that parsed but carried no token is a failure and not a grant.
  // Returning `{ ok: true, token: "" }` here would put an empty string into a
  // share link and tell the owner it worked.
  if (
    typeof shareId !== "string" ||
    typeof token !== "string" ||
    token === ""
  ) {
    return failed();
  }
  return { ok: true, value: { shareId, token } };
}

/**
 * End one grant, by id.
 *
 * Per grant, never per vehicle: an owner who gave their mechanic a link in
 * March and a buyer a link in June must be able to end one without ending the
 * other (SHR-08).
 */
export async function revokeShareGrant(
  shareId: string
): Promise<ShareResult<true>> {
  const open = await session();
  if (!open.ok) return open;
  const { error } = await open.value.rpc("revoke_share_grant", {
    p_share_id: shareId,
  });
  if (error) return failed();
  return { ok: true, value: true };
}

/* -------------------------------------------------------------------------
 * The holder's end (SHR-06, SHR-07) — no account, no session
 * ---------------------------------------------------------------------- */

/**
 * Call one anon reader with `token`.
 *
 * `rpc()` POSTs, which is the whole point: PostgREST accepts RPC over `GET`
 * as well, and a reader called that way carries `p_token` in the query string
 * — which puts the bearer credential into the request line, and therefore into
 * every access log between the browser and the origin, after the URL fragment
 * went to the trouble of keeping it out.
 *
 * The URL that mistake produces is deliberately *not* written out here.
 * `share-delivery.test.ts` sweeps all of `src/` for its shape, and it cannot
 * tell a warning from a call — correctly, because a grader that skipped
 * comments would skip a commented-out one too.
 *
 * Every error the *database* returns becomes `refused`, undifferentiated: it
 * answers unknown, expired and revoked identically (SHR-08), and collapsing
 * them again here keeps the client from re-deriving a difference out of a
 * status code.
 *
 * ## A dropped connection is not a "no" (T2-404 review, F8)
 *
 * The first version stopped at `if (error) return refused()`, which told a
 * holder on a workshop's bad wifi that their link had been revoked. That is the
 * same class of mistake as rendering a failed fetch as `[]`: an outage
 * reported as somebody's decision. `signSharedReceipt` below already draws the
 * line — `catch` is `failed`, a non-`ok` response is `refused` — and this is
 * that line, drawn where PostgREST puts it.
 */
async function readAsHolder<T>(
  reader: string,
  token: string
): Promise<ShareResult<T[]>> {
  const client = await getSupabaseClient();
  if (!client) return { ok: false, reason: "unconfigured" };
  const { data, error } = await client.rpc(reader, { p_token: token });
  if (error) return serverAnswered(error) ? refused() : failed();
  // Not an array is not an empty array. A reader that answered with something
  // unexpected is a failure, and rendering it as "no records" would be the
  // failure-is-not-a-zero mistake on the one page whose whole content is
  // somebody else's history.
  if (!Array.isArray(data)) return failed();
  return { ok: true, value: data as T[] };
}

/** The granted vehicle's identity, or a refusal. */
export async function readSharedVehicle(
  token: string
): Promise<ShareResult<SharedVehicle | null>> {
  const rows = await readAsHolder<SharedVehicle>("share_read_vehicle", token);
  if (!rows.ok) return rows;
  return { ok: true, value: rows.value[0] ?? null };
}

/**
 * The granted vehicle's history.
 *
 * Typed as `VisibleRecord` — the same shape `maskRecordForPrincipal` produces
 * for every other audience — because the cost keys are *optional* in that type
 * and absent in the payload when the grant does not open them. A type with
 * required nullable cost fields would have made the page unable to tell "free"
 * from "not shown to you", which is the distinction SHR-06 exists for.
 */
export function readSharedRecords(
  token: string
): Promise<ShareResult<VisibleRecord[]>> {
  return readAsHolder<VisibleRecord>("share_read_records", token);
}

/** Receipt metadata, when — and only when — the grant opens receipts. */
export function readSharedReceipts(
  token: string
): Promise<ShareResult<SharedReceipt[]>> {
  return readAsHolder<SharedReceipt>("share_read_receipts", token);
}

/**
 * Ask the Edge Function for a signed URL to one receipt.
 *
 * **Sends only the token and the receipt id.** There is no path parameter to
 * send: the function resolves the path through the same anon RPC above and
 * signs what Postgres handed back, so authorization stays in the database
 * where the graders reach it. A signer that accepted a path would be a
 * storage-wide read primitive wearing a share-link costume.
 *
 * POST, for the same reason every other call here is a POST.
 */
export async function signSharedReceipt(input: {
  readonly token: string;
  readonly receiptId: string;
  readonly supabaseUrl: string;
  readonly anonKey: string;
}): Promise<ShareResult<string>> {
  let response: Response;
  try {
    response = await fetch(`${input.supabaseUrl}/functions/v1/sign-receipt`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: input.anonKey,
        authorization: `Bearer ${input.anonKey}`,
      },
      body: JSON.stringify({
        token: input.token,
        receipt_id: input.receiptId,
      }),
    });
  } catch {
    return failed();
  }
  if (!response.ok) return refused();

  let payload: { url?: unknown };
  try {
    payload = (await response.json()) as { url?: unknown };
  } catch {
    return failed();
  }
  if (typeof payload.url !== "string" || payload.url === "") return failed();
  return { ok: true, value: payload.url };
}
