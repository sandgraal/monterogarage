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

/* =========================================================================
 * T3-202b [TEST] — the shop-management UI (create / invite / roster page)
 *
 * T3-202 shipped the shops **data layer** — the three tables and the four RPCs
 * in `supabase/migrations/20260908120000_shops_membership.sql` — but code
 * review found no task owned the **user-facing page**, so SHP-01 ("a user SHALL
 * be able to create a shop, and to invite other accounts into it as members")
 * and SHP-03 (a member seeing the shop roster) are unreachable end-to-end. This
 * block is the fixed seam T3-202c [PLATFORM] builds the page against; the render
 * graders live in `tests/pages/shop-management.render.test.ts`.
 *
 * Everything below is **additive** and self-contained (nothing above is renamed
 * or re-ordered) so the sibling `test/003-t3-203a-*` branch, which also edits
 * `specs/003-shop-tools/tasks.md`, rebases trivially — the same discipline the
 * T3-201 banner above states for its own block.
 *
 * As with every block in this file, each route / hook / key / path name is a
 * **decision this file makes on the spec's behalf** so the graders can be
 * concrete (the T2-201 / T3-101 / T3-201 precedent). A name is one line to
 * renegotiate with the conductor if T3-202c prefers another; the *behaviour*
 * graded around these names — an account-gated bilingual page, a create control,
 * an email invite control, a roster fed by `shop_roster`, writes only through
 * the definer RPCs, and a failed roster read that is never rendered as an empty
 * roster — is SHP-01 / SHP-03 and AGENTS.md's "a failure is not a zero", and is
 * not renegotiable.
 *
 * refs specs/003-shop-tools (SHP-01, SHP-03), specs/002-montero-garage (ACC-02),
 * specs/001-foundation (I18N-01, I18N-04, I18N-05, I18N-08)
 * ====================================================================== */

/**
 * The seam string every T3-202b page/module structural grader names when it
 * fails today — so an `it.fails` marker is honest about what it is waiting for
 * (a page/module T3-202c has not built yet), never a silent import or path
 * error (the T2-401a lesson, re-applied at the page tier).
 */
export const SEAM_SHOP_UI = "not built yet: T3-202c";

/* -------------------------------------------------------------------------
 * The route / segment (decided on the spec's behalf) — SHP-01, I18N-01/04/05
 *
 * ## Why the ES segment is `talleres` and not `taller`
 *
 * A mechanic's shop *is* a `taller` in Costa Rican Spanish — the SHP-04 consent
 * copy already shipped in `src/i18n/ui.ts` says exactly that ("alguien que
 * trabaja en un taller"). But the **singular** `taller` is already the owner's
 * garage segment (`COLLECTION_ROUTE_SEGMENTS.garage.es`, and reserved in
 * `handles.ts`' `SITE_ROUTE_HANDLES`), decided and shipped in T2-301. Two route
 * segments cannot be the same string, so the shop surface takes the **plural**
 * `talleres`: the businesses a mechanic belongs to, distinct from the one
 * `taller` that is their own garage. Plural on both sides matches the
 * "the segment names the section, and the section is a list" convention every
 * other list collection in `routes.ts` follows (`repuestos`, `procedimientos`,
 * `problemas`, `comunidad`) — the shop page lists the shops you belong to, with
 * a create control and, per shop, its roster.
 *
 * This is the one genuinely contestable decision in this block and is recorded
 * as an open question in the T3-202b report; if the owner prefers a different
 * ES word the change is this one line plus `routes.ts`/`handles.ts`.
 */
export const SHOP_ROUTE_COLLECTION_ID = "shops";
export const SHOP_ROUTE_SEGMENTS = { en: "shops", es: "talleres" } as const;

/**
 * The dynamic-param name the page file uses, and the file's own path. Matches
 * the plural-collection precedent (`parts` → `[partsSegment].astro`, `mods` →
 * `[modsSegment].astro`), so the page is one file that builds both locales'
 * routes from `collectionRouteParams("shops", "shopsSegment")`.
 */
export const SHOP_PAGE_PARAM = "shopsSegment";
export const SHOP_PAGE_SOURCE_PATH = "src/pages/[locale]/[shopsSegment].astro";

/**
 * The browser-only client module the page imports its shop calls from — the
 * `shares.ts` / `garage.ts` precedent (RPC wrappers returning a discriminated
 * result, never throwing, never coalescing a failure to an empty list). The
 * page must not reach Supabase inline; it delegates to this module, which is
 * where the RPC wiring and the failure-is-not-a-zero discipline are graded.
 */
export const SHOP_CLIENT_MODULE_PATH = "src/lib/supabase/shops.ts";

/**
 * The three shipped RPCs the page's write/read paths must go through (SHP-01),
 * by their migration names — re-exported from the T3-201 block above so the
 * page grader and the migration cannot drift. `accept_shop_invite` is not here:
 * accepting an invite is a separate surface (an invitee's inbox/link), not part
 * of the create/invite/roster page this task grades.
 */
export const SHOP_UI_RPCS = {
  create: CREATE_SHOP_FUNCTION,
  invite: INVITE_TO_SHOP_FUNCTION,
  roster: SHOP_ROSTER_FUNCTION,
} as const;

/**
 * The PostgREST write verbs a browser client must NEVER call on a shop table
 * (SHP-01: every membership write is a `security definer` RPC; the migration
 * grants `authenticated` no direct insert/update/delete on any shop table). The
 * grader enumerates the whole category rather than one spelling — the
 * "grade behaviour, not name lists" principle — and matches them only when
 * chained onto a `.from(...)` call, so a `Map`/`Set` `.delete(...)` is not a
 * false positive.
 */
export const POSTGREST_WRITE_METHODS = [
  "insert",
  "update",
  "upsert",
  "delete",
] as const;

/* -------------------------------------------------------------------------
 * The page's structural hooks (SHP-01, SHP-03) — the `data-*` attributes the
 * render graders read, modelled on the garage page's `data-garage-*` set.
 * ---------------------------------------------------------------------- */

/**
 * The DOM hooks the shop-management page must carry. Names mirror the garage
 * page's `data-garage-*` convention one collection over, so the same reviewer
 * reads both. The four roster hooks are deliberately distinct states —
 * `loading`, `message` (a failed read), `empty` (a genuine zero), and the list
 * itself — because collapsing "we could not check" into "you have none" is the
 * exact failure AGENTS.md's "a failure is not a zero" forbids, and the garage
 * page's own `data-garage-roster-{loading,message,empty}` set is the shipped
 * precedent for keeping them apart.
 */
export const SHOP_PAGE_HOOKS = {
  /** The signed-out prompt, shown by default (the surface is account-gated). */
  gate: "data-shop-gate",
  /** The authenticated app, `hidden` until a session resolves. */
  app: "data-shop-app",
  /** The create-shop control (a form/button). */
  createControl: "data-shop-create",
  /** The shop-name input inside the create control. */
  nameInput: "data-shop-name-input",
  /** The invite control (a form). */
  inviteControl: "data-shop-invite",
  /** The invitee-email input inside the invite control (`type="email"`). */
  inviteEmailInput: "data-shop-invite-email",
  /** The roster list, fed by `shop_roster`. */
  roster: "data-shop-roster",
  /** The roster's loading state. */
  rosterLoading: "data-shop-roster-loading",
  /** The roster's FAILED-read message — distinct from empty (failure ≠ zero). */
  rosterMessage: "data-shop-roster-message",
  /** The roster's genuine-empty note. */
  rosterEmpty: "data-shop-roster-empty",
} as const;

/* -------------------------------------------------------------------------
 * The bilingual UI strings the page requires (ACC-02, I18N-08)
 * ---------------------------------------------------------------------- */

/**
 * The `UiStrings` keys the shop page needs, one per user-facing string the four
 * graded properties touch. The page renders every one of these through the
 * typed `src/i18n/ui.ts` (both locales, usted register) — never hardcoded — so
 * the grader asserts each key exists and is non-empty in **both** locales.
 *
 * Key-set parity across locales, non-emptiness, the usted register, and "no
 * figure retyped per locale" are already enforced *globally* over the whole
 * `ui` object by `src/i18n/ui.test.ts`; this list is the shop-specific
 * *existence* requirement that test cannot express (it grades whatever keys are
 * present, not which keys must be). Names follow the `garageHeading` /
 * `signInHeading` convention and are renegotiable per this block's header.
 */
export const SHOP_UI_STRING_KEYS = [
  "shopHeading",
  "shopSignedOutHeading",
  "shopSignedOutBody",
  "shopCreateNameLabel",
  "shopCreateButton",
  "shopInviteEmailLabel",
  "shopInviteButton",
  "shopRosterHeading",
  "shopRosterLoading",
  "shopRosterUnavailable",
  "shopRosterEmpty",
] as const;

/* =========================================================================
 * T3-301 [TEST] — propose-and-accept (PRO-01..06)
 *
 * The AGENTS.md writable-surface carve-out (003 §7.1), the narrowest one the
 * owner authorized: a holder of a live `can_propose` grant may submit a
 * *proposal*, which is inert until the vehicle's owner accepts it — the owner's
 * acceptance is the write. A proposal is never written into `records` in a
 * pending state.
 *
 * Everything below is **additive** and self-contained (nothing above is renamed
 * or re-ordered), following the T3-201 / T3-202b banner discipline so a sibling
 * branch rebases trivially. As with every block in this file, each table /
 * column / function / argument name is a **decision this file makes on the
 * spec's behalf** so the graders can be concrete (the T2-201 / T3-101 / T3-201
 * precedent). A name is one line to renegotiate with the conductor if
 * T3-302 / T3-303 prefer another; the *behaviour* graded around these names —
 * PRO-01..06 verbatim — is not renegotiable.
 *
 * It reuses the 002/003 grant vocabulary rather than minting a parallel one: a
 * proposal rides on 002's `shares` grant (one new capability column,
 * `can_propose`), acceptance writes a 002 `records` row (three new provenance
 * columns), and liveness is 002's `revoked_at`/`expires_at` on the same grant.
 *
 * ## The design this contract pins (from 003 §7.1 / PRO-01..06, and the T3-301
 *    task line's own note that the write path needs "two ordinary policies …
 *    both pass `rules.ts` unchanged")
 *
 * - **`proposals`** — a new two-principal table (`owner_id` = the vehicle
 *   owner, `proposed_by` = the mechanic), registered as a SHARED user table in
 *   `tests/garage/contract.ts` so `ungradedTableIssues` knows it. Behind RLS,
 *   with **two ordinary policies**: an owner policy keyed on `owner_id =
 *   auth.uid()` (the owner reads and rejects), and a proposer policy keyed on
 *   `proposed_by = auth.uid()` **and** a conjunctive live-`can_propose`-grant
 *   check (the mechanic submits, reads, and withdraws — and loses submit and
 *   withdraw the instant the grant is revoked or expires, PRO-06). Both pass
 *   `userTablePolicyIssues` unchanged.
 * - **submit / withdraw / reject are table ops governed by those policies** —
 *   the mechanic INSERTs and DELETEs their own row; the owner DELETEs (rejects)
 *   a pending row. No RPC, no `records` write — this is what PRO-03 buys.
 * - **`accept_proposal`** — the ONE new RPC, and the ONE write into `records`.
 *   `security definer`, keyed on `auth.uid()` = the proposal's `owner_id` (the
 *   owner's own action), it reads the proposal server-side and writes exactly
 *   one `records` row carrying the *true* provenance, then removes the
 *   proposal. A definer RPC precisely so the owner cannot forge a mechanic's
 *   provenance by hand and a mechanic cannot write `records` at all.
 *
 * refs specs/003-shop-tools (PRO-01..06), specs/002-montero-garage (SHR-05..09,
 * ACC-03), AGENTS.md (Facts — testimony; Boundaries — the §7.1 carve-out)
 * ====================================================================== */

/* -------------------------------------------------------------------------
 * Seams — every T3-301 declaration-tier grader fails TODAY with one of these,
 * or with a named "column/argument/function absent", never with an import error.
 * ---------------------------------------------------------------------- */

/** Seam for the proposal write/accept surface T3-302 has not built. */
export const SEAM_PROPOSAL = "not implemented: T3-302";

/** The seam error for a proposal object/routine T3-302 has not shipped. */
export function proposalSeam(what: string): Error {
  return new Error(
    `${SEAM_PROPOSAL} — ${what}. T3-301 [TEST] declared the propose-and-accept ` +
      `contract as graders; T3-302 [PLATFORM] ships the migration — the ` +
      `\`${PROPOSALS_TABLE}\` table with its two policies, the ` +
      `\`${CAN_PROPOSE_COLUMN}\` capability on \`${SHARES_TABLE}\`, the ` +
      `\`${ACCEPT_PROPOSAL_FUNCTION}\` RPC, and the \`records\` provenance ` +
      `columns — that satisfies it (refs specs/003-shop-tools PRO-01..06)`
  );
}

/** Seam for the provenance-rendering surface (PRO-05) T3-303 has not built. */
export const SEAM_PROVENANCE = "not built yet: T3-303";

/** The seam error for the PRO-05 provenance render module T3-303 has not shipped. */
export function provenanceSeam(what: string): Error {
  return new Error(
    `${SEAM_PROVENANCE} — ${what}. T3-301 [TEST] declared the PRO-05 ` +
      `provenance-as-testimony contract as render graders; T3-303 [PLATFORM] ` +
      `ships the pure label module (\`${PROVENANCE_MODULE}\`, export ` +
      `\`${PROVENANCE_LABEL_EXPORT}\`) that satisfies it — an accepted record ` +
      `shows who proposed it and when it was accepted, as the owner's own ` +
      `testimony, NEVER as a site-verified fact (refs specs/003-shop-tools ` +
      `PRO-05, AGENTS.md Facts)`
  );
}

/* -------------------------------------------------------------------------
 * The proposals table (PRO-01..04) — two principals, one owner column each
 * ---------------------------------------------------------------------- */

/** A mechanic's draft record, inert until the owner accepts it (spec §2, PRO-01). */
export const PROPOSALS_TABLE = "proposals";

/**
 * The vehicle **owner** — the acceptance authority. The owner policy keys on
 * `owner_id = auth.uid()` (reads and rejects); `accept_proposal` gates on it.
 * A `uuid` referencing `auth.users`, `on delete cascade` (ACC-03).
 */
export const PROPOSAL_OWNER_COLUMN = "owner_id";

/**
 * The **mechanic** who drafted it. The proposer policy keys on `proposed_by =
 * auth.uid()` (submit / read own / withdraw). A `uuid` referencing
 * `auth.users`, `on delete cascade` (an unaccepted draft dies with its author).
 */
export const PROPOSAL_PROPOSED_BY_COLUMN = "proposed_by";

/**
 * The vehicle the proposal is against (PRO-01: "against that vehicle"). A
 * `uuid` referencing `vehicles`, `on delete cascade` — a proposal on a deleted
 * vehicle is meaningless. Graded directly in the proposals suite (not part of
 * the SHARED account-cascade model, which owns only the two `auth.users` hops).
 */
export const PROPOSAL_VEHICLE_COLUMN = "vehicle_id";

/**
 * The pinned identity columns, for the schema graders.
 */
export const PROPOSAL_COLUMNS = [
  PROPOSAL_OWNER_COLUMN,
  PROPOSAL_PROPOSED_BY_COLUMN,
  PROPOSAL_VEHICLE_COLUMN,
] as const;

/* -------------------------------------------------------------------------
 * The `can_propose` capability (PRO-01) — additive to 002's `shares`
 *
 * SHR-05 forbids branching on `kind`: a grant's powers are explicit capability
 * columns, never `if kind = 'mechanic'`. So "may this holder propose?" is its
 * own column beside `includes_costs` / `includes_receipts`, private by default
 * (SHR-01: `not null default false`). It is NOT added to 002's
 * `SHARE_CAPABILITY_COLUMNS` (the cost/receipts pair 002's SHR-06 graders
 * pair-test) — it is a 003 capability, graded here, exactly as T3-102's
 * `is_shop_visible` was graded in this file rather than in the 002 `shares`
 * contract entry.
 * ---------------------------------------------------------------------- */

/** Whether a grant opens the propose-and-accept write path (PRO-01). */
export const CAN_PROPOSE_COLUMN = "can_propose";

/**
 * The `create_share_grant` argument that sets it at issue time.
 *
 * Added to the extended 002/003 `create_share_grant`, defaulted so the prior
 * 7-argument call (T3-102: `+ p_grantee_email + p_is_shop_visible`) still
 * resolves. Adding a defaulted argument changes the routine's identity, so —
 * exactly as T3-102's contract notes for its own two arguments — T3-302 must
 * `drop function` the current signature and create the widened one, then
 * re-`grant execute … to authenticated`.
 */
export const SHARE_CAN_PROPOSE_ARGUMENT = "p_can_propose";

/* -------------------------------------------------------------------------
 * The records provenance columns (PRO-02, PRO-05) — additive to 002's `records`
 *
 * Acceptance "SHALL create a record carrying the proposal's provenance — who
 * authored it, under which grant, and when it was accepted" (PRO-02). Three
 * nullable columns on `records`: null on an owner's own (non-proposal) record,
 * set by `accept_proposal` on an accepted one. Nullable because a normal record
 * has no proposal behind it — and the distinction between "owner wrote this"
 * and "owner accepted a proposal" is exactly what PRO-05 renders.
 * ---------------------------------------------------------------------- */

/**
 * Who authored the accepted proposal. `uuid` referencing `auth.users`,
 * **`on delete set null`** — the accepted record is the OWNER's and SURVIVES
 * the mechanic deleting their account (PRO-06: "proposals already accepted are
 * records and are unaffected"); only the attribution unbinds. This is the
 * opposite of `proposals.proposed_by` (cascade), and the difference is the
 * whole of "a draft dies with its author, an accepted record does not".
 */
export const RECORD_PROPOSED_BY_COLUMN = "proposed_by";

/** Under which grant it was proposed. `uuid` referencing `shares` (PRO-02). */
export const RECORD_PROPOSAL_SHARE_COLUMN = "proposed_under_share_id";

/** When the owner accepted it. `timestamptz`, null on a non-proposal record. */
export const RECORD_ACCEPTED_AT_COLUMN = "accepted_at";

/** The three provenance columns `accept_proposal` writes onto the record. */
export const RECORD_PROVENANCE_COLUMNS = [
  RECORD_PROPOSED_BY_COLUMN,
  RECORD_PROPOSAL_SHARE_COLUMN,
  RECORD_ACCEPTED_AT_COLUMN,
] as const;

/** 002's records table, re-used — acceptance writes here, and only here. */
export const RECORDS_TABLE = "records";

/**
 * The "pending record" column category PRO-03 forbids on `records`, graded as
 * an **absence** (the tempting shortcut is a `status`/`pending` column that
 * lets a proposal live in `records` before acceptance). Enumerated as a
 * category, not one spelling — the "grade behaviour, not name lists" principle.
 * None of these is a provenance column: `accepted_at` (allowed) is a distinct
 * token from `accepted` (forbidden), and the graders match on exact column
 * names, so a legitimate provenance column never trips this.
 */
export const RECORD_FORBIDDEN_STATE_COLUMNS = [
  "status",
  "state",
  "pending",
  "is_pending",
  "accepted",
  "is_accepted",
  "acceptance_state",
  "proposal_status",
  "draft",
  "is_draft",
] as const;

/**
 * The "the site vouches for this" column category PRO-05 (and AGENTS.md Facts)
 * forbids on `records`, graded as an absence. A user record — including one
 * created by accepting a proposal — is the owner's own testimony, never a
 * site-verified fact; a `verified`/`fact_checked` flag on the record would be
 * the schema making the over-claim the requirement forbids.
 */
export const RECORD_FORBIDDEN_VERIFICATION_COLUMNS = [
  "verified",
  "is_verified",
  "site_verified",
  "is_site_verified",
  "fact_checked",
  "is_fact_checked",
  "verified_by_site",
] as const;

/* -------------------------------------------------------------------------
 * The accept RPC (PRO-02) — the owner's action, the one records write
 * ---------------------------------------------------------------------- */

/**
 * The routine the **owner** calls to accept a proposal (PRO-02). `security
 * definer` (it writes `records`, whose insert policy is owner-only, and it must
 * carry the *true* server-side provenance, not whatever the caller supplies),
 * pinning `search_path = ''`. Its body gates on `auth.uid()` = the proposal's
 * `owner_id` — "acceptance is the owner's own action, keyed to `auth.uid()`" —
 * reads the proposal, inserts exactly one `records` row with provenance, and
 * removes the proposal. Returns the new record's id.
 */
export const ACCEPT_PROPOSAL_FUNCTION = "accept_proposal";
export const ACCEPT_PROPOSAL_ARGUMENTS = ["p_proposal_id"] as const;
export const ACCEPT_PROPOSAL_RESULT_ID_FIELD = "record_id";

/**
 * Rejection and withdrawal are **not** RPCs: the owner DELETEs a pending
 * proposal (reject, via the owner policy) and the mechanic DELETEs their own
 * (withdraw, via the proposer policy, which the live-grant check gates so
 * revocation kills it — PRO-06). Named here only so a reader looking for a
 * `reject_proposal` RPC finds the reason there is none: a delete governed by an
 * ordinary policy is the whole of it, and "nothing is created" (PRO-02) is a
 * property a delete has for free.
 */
export const PROPOSAL_REJECT_IS_OWNER_DELETE = true;

/**
 * The account surface a mechanic/owner reaches only *as* an account (spec §1:
 * "the accountless path is read-only because it has no auth.uid()"). No
 * anon/public execute on `accept_proposal`; `authenticated` execute on it.
 * Graded both ways, because a closed door nobody can open is as broken as one
 * that will not shut.
 */
export const PROPOSAL_ACCOUNT_ONLY_FUNCTIONS = [
  ACCEPT_PROPOSAL_FUNCTION,
] as const;

/* -------------------------------------------------------------------------
 * The PRO-05 provenance render module (T3-303)
 *
 * PRO-05's "renders as the owner's own testimony … never as a site-verified
 * fact" is a render property, best graded as an extracted pure function — the
 * same reason `src/lib/directory/*.ts` and `src/lib/community-filter.ts` were
 * split out of their `.astro` pages. T3-303 ships this module; the graders load
 * it by variable-path dynamic import and, until it exists, fail with
 * `provenanceSeam` rather than an import error. Module path is relative to
 * `tests/shop/`. T3-303 has no paired [TEST] task of its own, so PRO-05 is
 * graded here.
 * ---------------------------------------------------------------------- */

/**
 * The provenance-label module (PRO-05). Exports
 * `proposalProvenanceLabel(provenance, locale)`: the bilingual, `usted`-register
 * line an accepted record shows — who proposed it and when it was accepted —
 * which must frame it as a first-hand claim and must NOT assert site
 * verification. The grader proves the negative (no "verified by the site"
 * spelling in either locale, enumerated as a category) because that is the
 * load-bearing half of "never as a site-verified fact".
 */
export const PROVENANCE_MODULE = "../../src/lib/proposals/provenance.ts";
export const PROVENANCE_LABEL_EXPORT = "proposalProvenanceLabel";

/**
 * Phrases that would present an accepted record as something the SITE vouches
 * for, in either locale — forbidden by PRO-05. A category, not one spelling
 * (the "grade behaviour, not name lists" principle); the mutation control in
 * the provenance suite proves a tempted "verified by the site" label trips it.
 */
export const PROVENANCE_SITE_VERIFICATION_PHRASES = {
  en: [
    "verified by the site",
    "verified by monterogarage",
    "site-verified",
    "site verified",
    "fact-checked",
    "fact checked",
    "confirmed by the site",
    "we verified",
    "montero garage confirms",
  ],
  es: [
    "verificado por el sitio",
    "verificado por monterogarage",
    "confirmado por el sitio",
    "el sitio verifica",
    "el sitio confirma",
    "hecho verificado",
    "dato verificado",
    "verificado por montero garage",
  ],
} as const;
