/**
 * Everything the shop-management page asks the database for (SHP-01, SHP-03).
 * Browser-only.
 *
 * The counterpart to `./garage.ts` and `./shares.ts`: same shape, same rules,
 * same reason for existing. The page holds markup and DOM wiring; every
 * request, every column list, every failure mode, and the session read all
 * live here, so the page never spells a table name and a change of schema is a
 * change to one file.
 *
 * ## This module trusts nothing and enforces nothing
 *
 * Row-level security and the four `security definer` RPCs are the enforcement,
 * in the database, on every request (SHP-01: membership writes are RPCs, not
 * open inserts; there is no open join). What this module does is *ask
 * correctly*: creating a shop, inviting an account, and reading a roster all go
 * through the RPCs, which key on `auth.uid()`. The only direct table touch is a
 * **read** — `listMyShops` selects the caller's own memberships, scoped by the
 * member-scoped RLS on `shops`, because there is no `my_shops` RPC and a read
 * is not a write. No `insert`/`update`/`delete` is ever issued from the
 * browser; a direct write against a shop table here would be both a dead call
 * (the migration grants `authenticated` no direct write) and a smell.
 *
 * ## Failures are values, and a failure is never an empty list
 *
 * Every function returns a discriminated result rather than throwing, matching
 * `GarageResult`/`ShareResult`. A roster read that failed must never reach the
 * page as `[]`, which would read as "this shop holds no trucks" when the truth
 * is "we could not check" (AGENTS.md: a failure is not a zero).
 *
 * refs specs/003-shop-tools (SHP-01, SHP-03), specs/002-montero-garage (ACC-02,
 * SHR-01, MIG-03)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "./auth.ts";

/**
 * What a shop request did, in a form the page can render — the same four
 * outcomes `garage.ts` uses. `unconfigured` is a build with no project;
 * `signed-out` is the gate; `failed` is a request that did not arrive or that
 * the database refused, kept distinct from an *empty* result.
 */
export type ShopResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: "unconfigured" | "signed-out" | "failed";
    };

/** One shop the signed-in account belongs to, as the list reads it. */
export interface ShopRow {
  readonly id: string;
  readonly name: string;
}

/**
 * One row of a shop's roster, as `shop_roster(p_shop_id)` returns it — a
 * vehicle a member holds a live, shop-visible grant on (SHP-03/SHP-04). The
 * token is deliberately absent: the roster names *which* trucks the shop can
 * reach, and the grant its member already holds is what opens each one.
 */
export interface ShopRosterEntry {
  readonly vehicle_id: string;
  readonly share_id: string;
  readonly display_name: string;
  readonly generation_id: string;
  readonly market_id: string | null;
  readonly model_year: number | null;
  readonly engine_id: string | null;
  readonly kind: string;
  readonly includes_costs: boolean;
  readonly includes_receipts: boolean;
  readonly expires_at: string;
}

/**
 * The columns the list reads off a membership's shop. Named rather than
 * `select("*")`, for the reason `garage.ts` gives: a `*` would quietly start
 * shipping whatever a later migration adds.
 */
const SHOP_COLUMNS = "id, name";

function failed<T>(): ShopResult<T> {
  return { ok: false, reason: "failed" };
}

/**
 * The client plus the signed-in user's id, or why neither is available.
 *
 * The session read the whole surface is gated on lives here — the garage
 * precedent, where the page delegates the check to the client library rather
 * than calling `getSession()` inline. `auth.uid()` inside each RPC is the copy
 * of "who is this" that a caller cannot influence; the id returned here is only
 * used to decide whether to reveal the app.
 */
async function session(): Promise<
  ShopResult<{ client: SupabaseClient; userId: string }>
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
 * Asking "is anyone signed in?" without downloading the client
 *
 * The garage page's posture, mirrored here so a reference reader who clicks
 * "Shops" out of curiosity is shown the sign-in prompt without paying for the
 * ~200 kB `@supabase/supabase-js` chunk first (SCF-06). These two probes are a
 * deliberate, documented second copy of `garage.ts`'s: importing them from
 * there would drag the garage's whole module graph (photos, receipts, media)
 * into this page's bundle to reuse fifteen lines, and this module is imported
 * by the shop page's client script. A *missing* key when a session exists is
 * the one failure that matters — it would sign a reader out — so the pair is
 * deliberately optimistic and paired the same way `currentUserIdIfAny` pairs
 * them.
 * ---------------------------------------------------------------------- */

/** `sb-<project ref>-auth-token`, `supabase-js`'s default `storageKey` shape. */
const SESSION_STORAGE_KEY_PATTERN = /^sb-.+-auth-token$/;

/** `true` when this browser has a persisted session for some Supabase project. */
function hasStoredSession(win: Window): boolean {
  try {
    const storage = win.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && SESSION_STORAGE_KEY_PATTERN.test(key)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** `true` when this URL is a landing from an auth redirect (grant in the URL). */
function carriesAuthResponse(href: string): boolean {
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
 * The two conditions are an `or`, and the second is load-bearing: a browser
 * arriving from a magic link carries the grant in the URL with nothing in
 * storage yet, and dropping it would tell that reader to sign in again — a loop
 * with no exit. `ask` is injectable so the composition is observable in a test.
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
 * The shops the account belongs to (SHP-01)
 * ---------------------------------------------------------------------- */

/**
 * Every shop the signed-in account is a member of.
 *
 * A direct `select`, not an RPC: there is no `my_shops` RPC, and the migration
 * grants members a scoped `SELECT` on `shops` (a member sees the shops they
 * belong to and no others — RLS does the scoping, not a filter here). Reading
 * is legitimate; only writes go through the definer RPCs. A failed read is
 * `failed`, never `[]`: an account with no shops and a request that dropped are
 * different sentences (AGENTS.md — a failure is not a zero).
 */
export async function listMyShops(): Promise<ShopResult<ShopRow[]>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client
    .from("shops")
    .select(SHOP_COLUMNS)
    .order("name", { ascending: true });
  if (error) return failed();
  return { ok: true, value: (data ?? []) as unknown as ShopRow[] };
}

/**
 * Create a shop; the caller becomes its first member (SHP-01).
 *
 * `create_shop` returns `{ shop_id }`; a response that parsed but carried no
 * id is a failure and not a shop, so it is reported as such rather than handed
 * back as a blank id the page would treat as success.
 */
export async function createShop(
  name: string
): Promise<ShopResult<{ shopId: string }>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client.rpc("create_shop", {
    p_name: name,
  });
  if (error) return failed();
  const row = Array.isArray(data)
    ? (data[0] as Record<string, unknown> | undefined)
    : (data as Record<string, unknown> | null);
  const shopId = row?.shop_id;
  if (typeof shopId !== "string" || shopId === "") return failed();
  return { ok: true, value: { shopId } };
}

/**
 * Invite an account into a shop, addressed by email (SHP-01).
 *
 * Restricted inside `invite_to_shop` to an existing member of the shop — the
 * body consults `shop_members` to prove the inviter belongs — so a non-member
 * caller is refused there and reported as `failed` here. Returns the invite id.
 */
export async function inviteToShop(input: {
  readonly shopId: string;
  readonly email: string;
}): Promise<ShopResult<{ inviteId: string }>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client.rpc("invite_to_shop", {
    p_shop_id: input.shopId,
    p_invitee_email: input.email,
  });
  if (error) return failed();
  const row = Array.isArray(data)
    ? (data[0] as Record<string, unknown> | undefined)
    : (data as Record<string, unknown> | null);
  const inviteId = row?.invite_id;
  if (typeof inviteId !== "string" || inviteId === "") return failed();
  return { ok: true, value: { inviteId } };
}

/**
 * Every vehicle this shop's members hold a live, shop-visible grant on
 * (SHP-03, SHP-04).
 *
 * Gated inside `shop_roster` on the caller's own membership of `p_shop_id`
 * (`auth.uid()`), and filtered to live (`revoked_at is null`,
 * `expires_at > now()`), shop-visible grants — so an individual grant, a
 * non-member's grant, or another shop's grant never reaches it. A failed read
 * is `failed` and never `[]`: an empty roster and a broken request are
 * different sentences, and a shop must never be told "no trucks are shared with
 * you" because a request dropped (AGENTS.md — a failure is not a zero). A
 * reader that answered with something that is not an array is a failure too,
 * never rendered as "no trucks".
 */
export async function readShopRoster(
  shopId: string
): Promise<ShopResult<ShopRosterEntry[]>> {
  const open = await session();
  if (!open.ok) return open;
  const { data, error } = await open.value.client.rpc("shop_roster", {
    p_shop_id: shopId,
  });
  if (error) return failed();
  if (!Array.isArray(data)) return failed();
  return { ok: true, value: data as ShopRosterEntry[] };
}
