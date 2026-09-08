/**
 * The roster / grant-binding contract — declared by **T3-101 [TEST]**, to be
 * satisfied by **T3-102 [PLATFORM]** (spec 003, the mechanic surface).
 *
 * ## What this file is, and what it deliberately is not
 *
 * It is the *smallest* set of new names the four graded properties of T3-101
 * need, and nothing else. Every one of those names is a **design decision this
 * file makes on the spec's behalf** so the graders can be concrete — the same
 * device `tests/garage/contract.ts` (T2-201/T2-401a) uses, and for the same
 * reason: a grader has to name something, and one line here is cheaper to
 * renegotiate than five test files. **If T3-102 prefers a different name, that
 * is a one-line conversation with the conductor.** What is *not* negotiable is
 * the behaviour graded around these names, which comes straight from the spec.
 *
 * It is **not** a parallel grant system. T3-101 was told to *reuse* the 002
 * typed-share-grant vocabulary, not mint a new one, so everything here is
 * additive to `specs/002-montero-garage`'s `shares` table and its RPCs:
 *
 * - the table is 002's `shares` — three columns added, nothing renamed;
 * - the issue path is 002's `create_share_grant` — two optional arguments
 *   added, so the 5-argument 002 call still resolves;
 * - the revoke path is 002's `revoke_share_grant`, unchanged and re-used;
 * - the accountless read path is 002's `share_read_vehicle` /
 *   `share_read_records` / `share_read_receipts`, unchanged and re-used.
 *
 * The genuinely new surface is two ideas 002 does not have: **binding** a grant
 * to the account of the email it was issued to, and a **roster** — the one
 * place MEC-05 says an authenticated mechanic sees every vehicle they hold a
 * live grant on.
 *
 * ## The four properties this contract exists to let the graders assert
 *
 * | # | property | spec |
 * |---|---|---|
 * | 1 | a grant issued to an email binds to that account on first authenticated open, **and to no other** | MEC-06 (named account) |
 * | 2 | an unbound grant is readable by its bearer yet **invisible to every roster** | SHR-07 + MEC-05 |
 * | 3 | a revoked **or** expired grant leaves the roster on the **next** request | MEC-05, SHR-08 |
 * | 4 | a shop member cannot see a grant issued to an **individual** | SHP-03, SHP-04 |
 *
 * ## The seam
 *
 * Every Tier-A grader resolves its subject through `requireAccountRoutine` /
 * `columnDefinitionFor` and fails **today** with the T3-102 seam error (or a
 * named "column absent" assertion) — never with an import error or an
 * `undefined is not an object`. A marker that cannot say what it is waiting for
 * is a marker that means nothing (the T2-401a lesson, re-applied).
 *
 * refs specs/003-shop-tools (MEC-05, MEC-06, SHP-03, SHP-04),
 * specs/002-montero-garage (SHR-05..09)
 */
import { SHARE_READER_TOKEN_ARGUMENT } from "../garage/contract.ts";

/* -------------------------------------------------------------------------
 * The seam
 * ---------------------------------------------------------------------- */

/**
 * The seam message. Every T3-101 declaration-tier grader is expected to fail
 * today with *this* — not with a typo, not with a bad path — so an `it.fails`
 * marker is honest about what it is waiting for.
 */
export const SEAM_ROSTER = "not implemented: T3-102";

/** The seam error for a roster / grant-binding surface T3-102 has not built. */
export function rosterSeam(what: string): Error {
  return new Error(
    `${SEAM_ROSTER} — ${what}. T3-101 [TEST] declared the roster and ` +
      `grant-binding contract as graders; T3-102 [PLATFORM] ships the ` +
      `migration — the three \`shares\` columns, \`bind_share_grant\`, ` +
      `\`mechanic_roster\`, \`extend_share_grant\`, and the extended ` +
      `\`create_share_grant\` — that satisfies it ` +
      `(refs specs/003-shop-tools MEC-05, MEC-06, SHP-03, SHP-04)`
  );
}

/* -------------------------------------------------------------------------
 * The table (002's `shares`, three columns added)
 * ---------------------------------------------------------------------- */

/** 002's grants table. Re-used, not replaced — see this file's header. */
export const SHARES_TABLE = "shares";

/**
 * The email a grant is **issued to** (MEC-06: "for a named account").
 *
 * Nullable: a plain 002 bearer grant (an anonymous link, no addressee) carries
 * no email and can therefore never bind — it stays an accountless link
 * forever, which is exactly 002's behaviour and the reason property 2's
 * "invisible to every roster" is true of it by construction.
 */
export const GRANTEE_EMAIL_COLUMN = "grantee_email";

/**
 * The account a grant **bound to** on first authenticated open — `null` means
 * unbound.
 *
 * This is the single fact that places a grant on a roster (property 1), and
 * the single fact whose absence keeps it off one (property 2). It references
 * `auth.users`: a binding is to a real account or it is nothing.
 *
 * ## Not part of the ownership path, on purpose
 *
 * 002's cascade grader walks `shares` by `vehicle_id -> owner_id` and requires
 * every hop to be `on delete cascade`. `bound_account_id` is *not* on that
 * path — a grant belongs to the vehicle's owner, not to the mechanic it was
 * lent to — so deleting the mechanic's account must not delete the owner's
 * grant row. Its FK is graded here as *pointing at* `auth.users`; what a
 * mechanic-account deletion does to a live binding (unbind vs. cascade) is an
 * open question left for T3-102 and recorded in the T3-101 report, not decided
 * silently by whichever `on delete` clause is easiest to type.
 */
export const BOUND_ACCOUNT_COLUMN = "bound_account_id";

/**
 * Whether a grant is visible to the bearer's **shop** (`true`) or only to the
 * **individual** it was issued to (`false`) — SHP-04.
 *
 * > Consent to share with a business is not implied by consent to share with a
 * > person who works there. — SHP-04
 *
 * So the safe value is `false` (individual), and it is the **default**, in the
 * same private-by-default posture SHR-01 gives every other visibility flag in
 * this schema (`is_public`, `is_cost_public`, `is_showcase_public`, …). The
 * owner is *told* at issue time that a grant to a shop member is shop-visible
 * and may choose the individual instead (T3-202's consent prompt); the data
 * layer's job is only to record the choice and default it to the conservative
 * one. A boolean rather than an `audience` enum to match that existing flag
 * idiom exactly.
 *
 * At T3-101 this flag's *schema* (present, boolean, `not null default false`)
 * is graded, and the account-isolation floor beneath SHP-04 is graded
 * behaviourally — an individual grant reaches only the bound account's roster.
 * The **shop** roster that consumes this flag does not exist until T3-201/
 * T3-202, so that half of SHP-04 is graded there; see `SHOP_ROSTER_HANDOFF`.
 */
export const SHOP_VISIBLE_COLUMN = "is_shop_visible";

/**
 * A one-line pointer, quoted in the graders' own comments, to the coverage
 * this task deliberately does *not* carry — so the next reader knows it is a
 * decision, not an omission (the "known-pages sweep is only as complete as its
 * list" principle: say what you do not cover).
 */
export const SHOP_ROSTER_HANDOFF =
  "T3-201/T3-202 own the shop roster that unions members' is_shop_visible " +
  "grants; T3-101 grades only the flag's schema and the account-isolation " +
  "floor (an individual grant reaches one account's roster and no other)";

/* -------------------------------------------------------------------------
 * The issue path (002's `create_share_grant`, two arguments added)
 * ---------------------------------------------------------------------- */

/**
 * The argument that names the account a grant is issued to (MEC-06).
 *
 * Added to 002's `create_share_grant`, defaulted so the 002 5-argument call —
 * an anonymous bearer link with no addressee — still resolves unchanged.
 *
 * ## A note for T3-102: extend, do not overload
 *
 * Adding arguments changes the routine's *identity* (`schema.name(argtypes)`),
 * so a bare `create or replace` produces a **second** `create_share_grant`
 * overload rather than replacing the first. 002's grader
 * (`share-grants.test.ts`, "ships public.create_share_grant") asserts exactly
 * one, and so does this contract's issue-argument grader. The migration must
 * therefore `drop function public.create_share_grant(uuid, text, boolean,
 * boolean, integer)` and create the widened signature (and re-`grant execute
 * … to authenticated`, because `drop` takes the ACL with it).
 */
export const SHARE_GRANTEE_EMAIL_ARGUMENT = "p_grantee_email";

/** The argument that records the SHP-04 shop-visibility choice at issue time. */
export const SHARE_SHOP_VISIBLE_ARGUMENT = "p_is_shop_visible";

/* -------------------------------------------------------------------------
 * The new RPCs
 * ---------------------------------------------------------------------- */

/**
 * The routine an **authenticated** mechanic calls to bind a grant to their
 * account on first open. Takes the same bearer token the accountless readers
 * take (`p_token`, re-used from 002) — the link the mechanic already holds is
 * the whole of the input.
 *
 * ## Why it is a routine and not a `bound_account_id` the owner sets
 *
 * The owner never learns the mechanic's account id — they issue to an *email*.
 * Binding is the mechanic proving, by presenting the token *while
 * authenticated as that email*, that they are the addressee. So the check the
 * body must make — `auth.email()` equals `grantee_email`, and the grant is
 * unbound — is the whole of "binds to that account **and to no other**", and
 * it can only be made where `auth.uid()` and `auth.email()` exist: on the
 * authenticated path, never the accountless one.
 */
export const BIND_GRANT_FUNCTION = "bind_share_grant";

/** `bind_share_grant`'s argument list — the bearer token, re-used from 002. */
export const BIND_GRANT_ARGUMENTS = [SHARE_READER_TOKEN_ARGUMENT] as const;

/**
 * The routine that answers MEC-05: "show every vehicle on their roster in one
 * place." Takes **no argument** — it keys entirely on `auth.uid()`, which is
 * what makes "someone else's roster" unrepresentable rather than merely
 * forbidden (the same shape ACC-03's `request_account_deletion()` uses).
 *
 * Returns one row per vehicle the caller holds a **live** grant on
 * (`revoked_at is null and expires_at > now()`), bound to their account. The
 * liveness filter is why property 3's revoked/expired grant "leaves the
 * roster on the next request": the roster is computed per request, not a
 * membership cached at bind time.
 */
export const MECHANIC_ROSTER_FUNCTION = "mechanic_roster";

/** `mechanic_roster` takes no arguments — it reads `auth.uid()`. */
export const MECHANIC_ROSTER_ARGUMENTS = [] as const;

/**
 * The field on a roster row that carries the vehicle's id, so a grader can ask
 * "is this vehicle on the roster?". Renegotiable like every name here; the
 * behaviour graded around it (the right vehicles appear, the wrong ones do
 * not) is not.
 */
export const ROSTER_VEHICLE_ID_FIELD = "vehicle_id";

/**
 * The routine an owner calls to **extend** a grant to "until revoked" for a
 * named account (MEC-06), and the companion to 002's `revoke_share_grant` — the
 * two controls MEC-06 says live "in the same place".
 *
 * Per grant, by id, exactly like revoke: an owner extends *this* link without
 * touching the buyer's link on the same truck. "Until revoked" is a far expiry
 * (002's contract already records that `expires_at` is `not null` and that
 * "until revoked" is a far date, not a null), so this routine pushes
 * `expires_at` out; the grant stays live and stays on the roster until the
 * owner revokes it.
 */
export const SHARE_EXTEND_FUNCTION = "extend_share_grant";

/** `extend_share_grant` takes the grant id — same per-grant shape as revoke. */
export const SHARE_EXTEND_ARGUMENTS = ["p_share_id"] as const;

/**
 * The routines that are the **account's** value-add and must never be reachable
 * without one.
 *
 * §1 of the spec is explicit: "the accountless path is read-only because it has
 * no `auth.uid()`", and "an account is what makes a mechanic addressable — by
 * the roster, by a proposal, by a shop." Binding, the roster, and extending are
 * all things you can only do *as* an account, so an `anon`/`public` caller must
 * hold no `execute` on any of them — and `authenticated` must hold `execute` on
 * all of them, or the account is worthless. Graded both ways, because a closed
 * door nobody can open is as broken as one that will not shut.
 */
export const ACCOUNT_ONLY_FUNCTIONS = [
  BIND_GRANT_FUNCTION,
  MECHANIC_ROSTER_FUNCTION,
  SHARE_EXTEND_FUNCTION,
] as const;

/* =========================================================================
 * T3-201 [TEST] — shops, membership, roster isolation, the directory claim
 *
 * Everything below is **additive** and lives in its own section so the
 * concurrent `test/003-t3-102-rebind-grader` branch (which touches
 * `roster.test.ts` and the T3-101 names above) rebases trivially: nothing here
 * renames or re-orders anything above this banner.
 *
 * As with the T3-101 block, every table / column / function / argument name is
 * a **decision this file makes on the spec's behalf** so the T3-201 graders can
 * be concrete (the T2-201 / T3-101 precedent). A name is one line to
 * renegotiate with the conductor if T3-202 / T3-203 prefer another; the
 * *behaviour* graded around these names — invite-only membership with no open
 * join, a shop member seeing exactly the shop's grants and no others, an
 * unverified claim rendering nothing, and a directory whose order and inclusion
 * are a pure function of git content — is SHP-01..05 verbatim and is not
 * renegotiable.
 *
 * It reuses the 002/003 grant vocabulary rather than minting a parallel one:
 * the shop roster reads 002's `shares` filtered by 003's `is_shop_visible`
 * (`SHOP_VISIBLE_COLUMN` above) and by shop membership; it does not invent a
 * second grant model.
 *
 * refs specs/003-shop-tools (SHP-01..05), specs/002-montero-garage (SHR-05..09)
 * ====================================================================== */

/* -------------------------------------------------------------------------
 * Seams — every T3-201 declaration-tier grader fails TODAY with one of these,
 * or with a named "column/argument absent", never with an import error.
 * ---------------------------------------------------------------------- */

/** Seam for the membership surface T3-202 has not built. */
export const SEAM_SHOP = "not implemented: T3-202";

/** The seam error for a shop / membership object T3-202 has not shipped. */
export function shopSeam(what: string): Error {
  return new Error(
    `${SEAM_SHOP} — ${what}. T3-201 [TEST] declared the shop-membership and ` +
      `roster-isolation contract as graders; T3-202 [PLATFORM] ships the ` +
      `migration — \`${SHOPS_TABLE}\`, \`${SHOP_MEMBERS_TABLE}\`, ` +
      `\`${SHOP_INVITES_TABLE}\`, and the RPCs \`${CREATE_SHOP_FUNCTION}\`, ` +
      `\`${INVITE_TO_SHOP_FUNCTION}\`, \`${ACCEPT_SHOP_INVITE_FUNCTION}\`, ` +
      `\`${SHOP_ROSTER_FUNCTION}\` — that satisfies it ` +
      `(refs specs/003-shop-tools SHP-01, SHP-03, SHP-04)`
  );
}

/** Seam for the directory-claim surface T3-203 has not built. */
export const SEAM_DIRECTORY = "not implemented: T3-203";

/** The seam error for a directory-claim object/module T3-203 has not shipped. */
export function directorySeam(what: string): Error {
  return new Error(
    `${SEAM_DIRECTORY} — ${what}. T3-201 [TEST] declared the directory-claim ` +
      `and directory-neutrality contract as graders; T3-203 [PLATFORM] ships ` +
      `the \`${DIRECTORY_CLAIMS_TABLE}\` migration and the pure render modules ` +
      `(\`${DIRECTORY_ORDER_MODULE}\`, \`${DIRECTORY_CLAIM_MODULE}\`) that ` +
      `satisfy it (refs specs/003-shop-tools SHP-02, SHP-05)`
  );
}

/* -------------------------------------------------------------------------
 * The membership tables (SHP-01, SHP-03)
 * ---------------------------------------------------------------------- */

/** A named business with one or more member accounts (spec §2, SHP-01). */
export const SHOPS_TABLE = "shops";

/**
 * The join table between an account and a shop. One row = one live membership.
 *
 * Its **write path is the whole of SHP-01's "no open join"**: a row here is
 * created only by `accept_shop_invite` (a security-definer routine that first
 * consults a matching invite), never by a caller inserting its own row. So the
 * graders assert `authenticated` holds **no direct `insert`** on this table —
 * the same definer-RPC write posture 002/003 give `shares` — which is the
 * affirmative way to state "there is no path for an account to add itself".
 */
export const SHOP_MEMBERS_TABLE = "shop_members";

/**
 * An outstanding invitation, addressed to an email by an existing member.
 * Membership comes only from accepting one of these (SHP-01).
 */
export const SHOP_INVITES_TABLE = "shop_invites";

/** The account that holds a membership / an invite's addressee, per table. */
export const SHOP_MEMBER_ACCOUNT_COLUMN = "account_id";

/** The shop a membership row belongs to. */
export const SHOP_MEMBER_SHOP_ID_COLUMN = "shop_id";

/** The email an invite is addressed to (the SHP-01 "invitation" addressee). */
export const SHOP_INVITE_EMAIL_COLUMN = "invitee_email";

/* -------------------------------------------------------------------------
 * The membership RPCs (SHP-01)
 * ---------------------------------------------------------------------- */

/** Create a shop; the caller becomes its first member. Returns the shop id. */
export const CREATE_SHOP_FUNCTION = "create_shop";
export const CREATE_SHOP_ARGUMENTS = ["p_name"] as const;
export const CREATE_SHOP_RESULT_ID_FIELD = "shop_id";

/**
 * Invite an account into a shop, addressed by email. Restricted to an
 * **existing member** of that shop (SHP-01: "invitation from an existing
 * member") — so its body must consult `shop_members` to prove the inviter
 * belongs. Returns the invite id.
 */
export const INVITE_TO_SHOP_FUNCTION = "invite_to_shop";
export const INVITE_TO_SHOP_ARGUMENTS = [
  "p_shop_id",
  "p_invitee_email",
] as const;
export const INVITE_RESULT_ID_FIELD = "invite_id";

/**
 * Accept an invite addressed to the caller's own email, becoming a member.
 * The one write path into `shop_members`. Its body must read the invite (and
 * check `auth.email()` matches the addressee) before writing the membership —
 * the same "consult the addressee, then write" shape `bind_share_grant` uses,
 * and the reason a non-invited account cannot self-join.
 */
export const ACCEPT_SHOP_INVITE_FUNCTION = "accept_shop_invite";
export const ACCEPT_SHOP_INVITE_ARGUMENTS = ["p_invite_id"] as const;

/* -------------------------------------------------------------------------
 * The shop roster (SHP-03, SHP-04) — the half T3-101 deferred
 * ---------------------------------------------------------------------- */

/**
 * The one place a shop's members see the shop's grants (SHP-03), keyed on the
 * shop id and gated on the caller's own membership.
 *
 * The SHP-04 isolation floor is the whole point: it returns a grant held by a
 * shop member **only when `is_shop_visible` is true**, so an individual grant
 * (the private-by-default value) never reaches it. Its body must therefore
 * consult `is_shop_visible` and `shop_members`, filter on the caller's
 * membership (`auth.uid()`), and — like `mechanic_roster` — return only live
 * grants (`revoked_at is null`, `expires_at > now()`). The row carries
 * `ROSTER_VEHICLE_ID_FIELD` so a grader can ask "is this vehicle on the shop
 * roster?".
 */
export const SHOP_ROSTER_FUNCTION = "shop_roster";
export const SHOP_ROSTER_ARGUMENTS = ["p_shop_id"] as const;

/**
 * The account surface a mechanic reaches only *as* an account (spec §1: "the
 * accountless path is read-only because it has no auth.uid()"). No anon/public
 * execute on any of them; `authenticated` execute on all. Graded both ways,
 * because a closed door nobody can open is as broken as one that will not shut.
 */
export const SHOP_ACCOUNT_ONLY_FUNCTIONS = [
  CREATE_SHOP_FUNCTION,
  INVITE_TO_SHOP_FUNCTION,
  ACCEPT_SHOP_INVITE_FUNCTION,
  SHOP_ROSTER_FUNCTION,
] as const;

/* -------------------------------------------------------------------------
 * The directory claim (SHP-02)
 *
 * A claim is a **database row pointing at a git-owned community `shop` entry by
 * its content id** — never an edit to the entry. The community collection stays
 * read-only (tasks.md T3-203). The claim is invisible to a reader until it is
 * verified: an unverified claim changes nothing anyone sees (SHP-02).
 * ---------------------------------------------------------------------- */

export const DIRECTORY_CLAIMS_TABLE = "directory_claims";

/** The claiming shop. */
export const CLAIM_SHOP_ID_COLUMN = "shop_id";

/**
 * The content id of the community `shop` entry being claimed — a `text`
 * pointer at git-owned content (e.g. `veinsa-motors-mitsubishi-costa-rica`),
 * not a foreign key into any user table. This is what makes a claim a pointer
 * rather than an edit.
 */
export const CLAIM_ENTRY_ID_COLUMN = "community_entry_id";

/**
 * When the claim was verified — **nullable**, `null` meaning unverified. The
 * single fact that decides whether the directory renders a claimed badge
 * (SHP-02); its absence is what makes an unverified claim render nothing.
 */
export const CLAIM_VERIFIED_AT_COLUMN = "verified_at";

/* -------------------------------------------------------------------------
 * The directory render seams (T3-203)
 *
 * SHP-02's "renders nothing" and SHP-05's "order/inclusion is a pure function
 * of content" are render properties, best graded as extracted pure functions —
 * the exact reason `src/lib/community-filter.ts` was split out of the directory
 * `.astro` page (its own docstring). T3-203 ships these modules; the graders
 * load them by dynamic import and, until they exist, fail with `directorySeam`
 * rather than an import error. Module paths are relative to `tests/shop/`.
 * ---------------------------------------------------------------------- */

/**
 * The neutral-ordering module (SHP-05). Exports `directoryListing(entries,
 * context)`: the ordered list of entry ids the directory shows, which must be a
 * pure function of the git-owned `entries` and provably independent of the
 * `context` (viewer account, claims, memberships, plans). The context argument
 * exists precisely so the grader can prove the output ignores every field in it
 * — an affirmative "here is everything that could tempt a ranking, and it
 * changes nothing".
 */
export const DIRECTORY_ORDER_MODULE =
  "../../src/lib/directory/neutral-order.ts";
export const DIRECTORY_LISTING_EXPORT = "directoryListing";

/**
 * The claimed-badge module (SHP-02). Exports `resolveClaimBadges(claims)`: the
 * set/map of community entry ids that show a claimed badge — which must include
 * a claim only when it is verified. An unverified claim contributes nothing.
 */
export const DIRECTORY_CLAIM_MODULE = "../../src/lib/directory/claim-badge.ts";
export const RESOLVE_CLAIM_BADGES_EXPORT = "resolveClaimBadges";
