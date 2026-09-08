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
