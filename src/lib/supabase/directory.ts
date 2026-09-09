/**
 * The directory's browser-side read of the public claimed-badge fact —
 * **T3-203 [PLATFORM]**, SHP-02.
 *
 * The community directory is a static page (COM-01), and a claimed badge is a
 * display-only marker. Which git-owned community entries carry a **verified**
 * claim lives in the database, so it is read at runtime, in the browser, through
 * the definer routine `directory_verified_claims()`
 * (`20260908130000_directory_claims.sql`). That routine returns only the
 * `community_entry_id` of verified claims — no shop identity, no account, no
 * unverified rows — so this read learns exactly the display-only fact the page
 * renders and nothing else, while the `directory_claims` table itself stays
 * fully RLS-locked.
 *
 * ## Authenticated-only, because 002's anon surface is a locked allow-list
 *
 * `directory_verified_claims()` is granted to `authenticated`, not `anon`:
 * `tests/garage/share-instrument.test.ts` locks the anon-executable surface to
 * the declared share readers and holds every anon-reachable routine to the
 * token-hash/expiry/revoke contract, which a badge read is not. So a signed-in
 * reader sees the badge; an anonymous visitor sees the neutral directory with
 * none — which is exactly the unverified-equivalent view SHP-02 guarantees
 * ("changes nothing a reader sees"). Widening it to anon would extend that
 * security allow-list, a decision left to the conductor rather than made here.
 *
 * ## Failing to no badge is the correct degradation here
 *
 * AGENTS.md's "a failure is not a zero" rule protects a *user's own data* — a
 * dropped connection must never be rendered as "you have no records." A claimed
 * badge is the opposite shape: it is an additive affordance whose neutral, safe
 * state is *absent* (SHP-02 — an unverified, and so a fortiori an unknown, claim
 * renders nothing). So an unconfigured stack, a network failure, or a malformed
 * answer all resolve to the empty set: the page shows no badge, which never
 * misrepresents anything and never awards a badge that was not verified. The
 * pure resolver `resolveClaimBadges` (`src/lib/directory/claim-badge.ts`) owns
 * the "verified ⇒ badge" rule; this module only fetches, and the database has
 * already applied `verified_at is not null` before a row reaches here.
 *
 * refs specs/003-shop-tools (SHP-02), specs/001-foundation (COM-01)
 */
import { getSupabaseClient } from "./auth.ts";

/** The row shape `directory_verified_claims()` returns. */
interface VerifiedClaimRow {
  readonly community_entry_id?: unknown;
}

/**
 * The set of community entry ids that carry a verified claim, for the page to
 * badge. Empty on any failure — see the module docstring: absent is the safe,
 * neutral state for a display-only badge (SHP-02).
 */
export async function readVerifiedClaimEntryIds(): Promise<
  ReadonlySet<string>
> {
  const client = await getSupabaseClient();
  if (!client) return new Set();

  const { data, error } = await client.rpc("directory_verified_claims");
  if (error || !Array.isArray(data)) return new Set();

  return new Set(
    (data as VerifiedClaimRow[])
      .map((row) => row.community_entry_id)
      .filter((id): id is string => typeof id === "string" && id !== "")
  );
}

/**
 * File an (unverified) claim on a community entry for a shop the caller belongs
 * to — the SHP-02 create path, `create_directory_claim`. Restricted to a shop
 * member by the definer routine's body; the claim shows nothing to a reader
 * until the platform verifies it. Returns the claim id, or `null` when the
 * stack is unconfigured or the database refuses (not a shop member, blank id).
 */
export async function claimDirectoryEntry(input: {
  readonly shopId: string;
  readonly communityEntryId: string;
}): Promise<string | null> {
  const client = await getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.rpc("create_directory_claim", {
    p_shop_id: input.shopId,
    p_community_entry_id: input.communityEntryId,
  });
  if (error || !Array.isArray(data)) return null;

  const first = data[0] as { claim_id?: unknown } | undefined;
  return typeof first?.claim_id === "string" ? first.claim_id : null;
}
