# Tasks 003 — Shop tools

DRAFT — buildable only after the owner merges spec 003 and the AGENTS.md
amendment PR lands. Conventions identical to 001 and 002 (frontier rule, [TEST]
before [PLATFORM] pairs, [CONTENT] dual passes, checkbox in the final commit,
commit refs `specs/003-shop-tools`).

**Everything here depends on 002 Phase P3 being complete** — specifically
T2-404, which builds the grants this spec's roster and proposals hang off.
There is no useful 003 work that can start before it. Do not try to parallelise
across that boundary.

Routing: grants, RLS, anon-executable functions, the proposal write path, and
entitlements are hard-Opus. The billing webhook is `secrets-or-deploy`.

## Phase S1 — The mechanic's account

- [x] **T3-101 [TEST]** Roster and grant-binding graders: a grant issued to an
  email binds to that account on first authenticated open and to no other; an
  unbound grant is readable by its bearer and invisible to every roster; a
  revoked or expired grant leaves the roster on the next request; and the
  data-layer floor of SHP-04 — `is_shop_visible` is private by default, and an
  individual grant reaches only the bound account's roster and no other. (The
  shop-roster-excludes-individual-grants half of SHP-04 is T3-201's, once a
  shop roster exists to union `is_shop_visible` grants.) Depends: 002-T2-404
  merged. *(MEC-05, MEC-06, SHP-03, SHP-04)*
- [x] **T3-101a [TEST]** T3-101 follow-ups from independent code review, and a
  hard prerequisite for T3-102 — **must merge before T3-102**, so the
  roster/grant-binding security graders actually enforce and T3-102 cannot
  self-grade its own security property. (F1) Run `tests/shop`'s Tier B in CI: a
  `test:shop` script mirroring `test:garage`, added to the one `tier-b` job so
  the bind-to-the-addressed-account-and-no-other, first-open-binds-then-no-
  rebind, roster-liveness-on-revoke/expire, SHP-04 isolation, and extend-
  lifecycle proofs run against a live stack instead of nowhere. (F2) Grade
  `shares.bound_account_id`'s FK as `on delete set null` (002 ACC-03: a mechanic
  must be able to delete their own account while holding a live binding —
  unbind, never cascade-delete the owner's grant, never no-action/restrict which
  would block the deletion), extending the shared FK parser additively to expose
  the on-delete action. (F3) The T3-101-line wording fix above. Depends: T3-101
  merged. Blocks: T3-102. *(MEC-05, MEC-06, SHP-03, SHP-04; 002 ACC-03)*
- [x] **T3-102 [PLATFORM]** Mechanic roster: authenticated grant-holder view,
  one place, bilingual per 002 ACC-02. Owner-side "extend to until-revoked" and
  revoke controls. Activates T3-101. Depends: T3-101 and T3-101a merged. *(MEC-05, MEC-06)*

## Phase S2 — Shops

- [x] **T3-201 [TEST]** Shop membership and claim graders: membership is
  invite-only with no open join; a member sees exactly the shop's grants and no
  others; an unverified directory claim renders nothing; directory ordering and
  inclusion are provably unaffected by account, claim, or plan state (SHP-05 —
  grade it now, while there is no plan to be tempted by). Depends: T3-102. *(SHP-01..05)*
- [x] **T3-202a [TEST]** The SHARED user-table class, and a hard prerequisite
  for T3-202 — **must merge before T3-202**, so the shop tables have a home in
  the 002 garage taxonomy before T3-202 creates them and T3-202's implementer
  never grades its own taxonomy decision (the T802 separation precedent). The
  garage user-data model had two classes and every created `public` table had
  to be one: `USER_TABLES` (single-owner, an `on delete cascade` hop to
  `auth.users`) or `EXEMPT_PUBLIC_TABLES` (public reference content, no RLS
  question). 003's `shops`/`shop_members`/`shop_invites` are neither — private
  user data with **no single owner** (§2, SHP-01: a shop is a business with one
  or more members, invitation-only), so no honest single-owner cascade hop
  exists. Adds `SHARED_USER_TABLES` (a third class): `ungradedTableIssues`
  accepts a shared table and keeps it fully RLS-graded (enable + force +
  deny-by-default), while a new `sharedTableCascadeIssues` grades the shared
  account-deletion model instead of a single-owner hop. **Owner ruling
  (2026-09-08):** `shops.created_by` → `auth.users` **ON DELETE SET NULL** (a
  founder deleting their account leaves the shop standing for its other members;
  ACC-03 forbids gating that deletion, and `cascade` would destroy their shop);
  `shop_members.account_id` → `auth.users` **ON DELETE CASCADE** (a member's own
  membership row is theirs and goes on account deletion; ACC-03: never blocked);
  a **zero-member shop persists (orphaned)** — no forced cleanup. Graders are
  `it.fails` against the shipped migration (red today, T3-202 activates each by
  deleting its `.fails` line), with synthetic-DDL boundary tables and positive
  controls proving each clause bites. Depends: T3-201 merged. Blocks: T3-202.
  *(SHP-01; 002 ACC-03)*
- [x] **T3-202 [PLATFORM]** Shops: create, invite, membership, roster sharing
  subject to SHP-04's consent prompt. Activates T3-201's membership graders (SHP-01/03/04). Depends: T3-201 merged. *(SHP-01, SHP-03, SHP-04)*
- [x] **T3-202b [TEST]** Shop-management UI render/structural graders: the
  create/invite/roster page is account-gated and bilingual (both `/en/` and
  `/es/` via the typed `ui.ts`), carries a create control, an email invite
  control, and a roster fed by `shop_roster`, wires the real RPCs with no direct
  table writes from the client, and never renders a failed `shop_roster` read as
  an empty roster. Backfilled because T3-202 shipped the data layer but no task
  owned the page, leaving SHP-01/SHP-03 unreachable end-to-end (code review,
  owner-approved 2026-09-08). Route/segment decided on the spec's behalf:
  `shops`/`talleres`, recorded in `tests/shop/contract.ts`. Graders in
  `tests/pages/shop-management.render.test.ts`; activates T3-202c. Depends:
  T3-202 merged. *(SHP-01, SHP-03; 002 ACC-02)*
- [x] **T3-202c [PLATFORM]** Shop-management UI: the create/invite/roster page
  (`src/pages/[locale]/[shopsSegment].astro`) plus its `src/lib/supabase/shops.ts`
  RPC-wrapper, `shops`/`talleres` segment in `routes.ts`/`handles.ts`, and the
  shop `ui.ts` strings — bilingual, account-gated. Activates T3-202b's render
  graders (delete one `.fails` per satisfied grader). Depends: T3-202 merged.
  *(SHP-01, SHP-03)*
- [x] **T3-203a [TEST]** The directory-claim grader prerequisites T3-203 needs
  before its [PLATFORM] build — **must merge before T3-203** (the T802/T3-202a
  precedent: an independent test-writer lands the grader accommodation first, so
  T3-203's implementer never grades its own taxonomy/neutrality decision). Two
  additions, both `it.fails` T3-203 activates. (1) `directory_claims` joins
  `SHARED_USER_TABLES` (T3-202a's third class) as a `pending` parent-hop table:
  its account-lifecycle is indirect, so `sharedTableCascadeIssues` is extended
  additively with `parentCascadeColumns` to grade `shop_id → shops` **ON DELETE
  CASCADE** (a claim belongs to a shop; delete the shop, its claims go), while
  `community_entry_id` stays a text pointer with no FK and `verified_at` stays
  nullable (both T3-201's). Pins updated additively (`SHARED_USER_TABLE_NAMES`
  equality + a shipped/pending split); the full 002 garage suite stays green.
  (2) A page-neutrality render grader (`tests/pages/directory-neutrality.render.test.ts`)
  asserting the built directory page routes its ordering through
  `src/lib/directory/neutral-order.ts`'s `directoryListing`, not an inline sort —
  the SHP-05 coverage gap T3-201's review flagged (the module is proven neutral;
  nothing proved the page uses it). Depends: T3-202, T3-201 merged. Blocks:
  T3-203. *(SHP-02, SHP-05; 002 ACC-03)*
- [x] **T3-203 [PLATFORM]** Directory claim: claim flow against the 001
  community collection's `shop` entries, verification, claimed badge. The
  community collection stays git-owned and read-only — a claim is a database
  row pointing at a content id, never an edit to the entry. Extract
  `src/lib/directory/neutral-order.ts` (the `community-filter.ts` precedent) and
  route `[communitySegment].astro` through its `directoryListing` so SHP-05 holds
  page-level. Activates T3-201's directory graders (SHP-02/05) and T3-203a's
  `directory_claims` cascade + page-neutrality graders. Depends: T3-202,
  T3-203a, 001-T703a. *(SHP-02, SHP-05)*

## Phase S3 — Propose-and-accept

**Read `specs/003-shop-tools/spec.md` §7.1 before starting.** This phase is the
AGENTS.md writable-surface carve-out. It is narrow, and its narrowness is the
whole reason it was authorized.

- [x] **T3-301 [TEST]** Proposal graders. Depends: T3-202. *(PRO-01..06)*
  <br>The RLS shape is the reassuring part and should be graded as such: a
  `proposals` table with `owner_id` (the vehicle owner) and `proposed_by` (the
  mechanic) needs two ordinary policies, and **both pass `rules.ts` unchanged** —
  `authUidComparands` tests the *shape* (an `auth.uid()` equality against a row
  term), not that the column is named `owner_id`, and a conjunctive live-grant
  check rides along because a top-level `and` is not an `or`. Verified against
  the rule engine 2026-08-31. **No grader amendment is needed for the write
  path**, which is exactly why propose-and-accept was the affordable ruling.
  <br>*What must be graded:* a proposal is invisible to every principal except
  its author and the vehicle owner (PRO-04); a mechanic cannot insert a proposal
  against a vehicle they hold no live `can_propose` grant on; `records` gains no
  `status` column and no non-owner insert path (PRO-03 — grade the *absence*,
  because the tempting shortcut is a pending record); acceptance creates exactly
  one record carrying provenance; rejection creates none; revocation kills
  submit and withdraw but leaves pending proposals rejectable (PRO-06).
- [x] **T3-302 [PLATFORM]** Proposals: mechanic-side quote and job draft with
  line items, owner-side accept/reject with provenance carried onto the created
  record. Activates T3-301. Depends: T3-301 merged. *(PRO-01..04, PRO-06)*
- [ ] **T3-303 [PLATFORM]** Provenance rendering: an accepted record shows who
  proposed it and when it was accepted, as the owner's own testimony per
  AGENTS.md — never as a site-verified fact. Bilingual. Depends: T3-302. *(PRO-05)*

## Phase S4 — Entitlements

**Nothing in this phase may gate an owner.** MON-01..03 are the acceptance
criteria for the whole phase, not just for T3-401.

- [ ] **T3-401 [TEST]** Entitlement graders, written adversarially: an owner's
  read, write, export, share, revoke, and delete paths are unreachable from any
  entitlement check (MON-01, MON-02); a lapsed shop keeps live-grant reads and
  loses only tools (MON-03); no feature table carries a `plan` column (MON-08);
  the directory is unaffected by plan state (MON-05, restating T3-201's grader
  now that a plan exists to be tempted by); no analytics or ad SDK arrives with
  the billing surface (MON-06, extending 002's `auth-surface.test.ts` scan).
  Depends: T3-302. *(MON-01..08)*
- [ ] **T3-402 [PLATFORM]** Entitlements: subscriptions table, webhook, computed
  entitlements view. No billing provider in any feature table. Activates T3-401.
  Depends: T3-401 merged. *(MON-07, MON-08)*
- [ ] **T3-403 [PLATFORM]** Chargeable shop capabilities, and only these:
  roster beyond the free allowance, quote builder, multi-member seats, branded
  export of a vehicle history the shop holds a live grant on. Depends: T3-402. *(MON-07)*

## Open questions for the owner

Recorded rather than guessed. None blocks S1 or S2.

1. **The free roster allowance** (MON-07). A number that is too low makes the
   free tier useless as a hook; too high and there is no tier. Needs a figure
   before T3-403, not before T3-401.
2. **Price, currency, and whether Costa Rican shops are priced differently from
   US ones.** The site is bilingual and the first real shops are in Costa Rica;
   USD-only pricing is a decision, not a default.
3. **What happens to a shop's roster when its plan lapses below the free
   allowance.** MON-03 says it keeps live-grant *reads*, so the honest options
   are read-only-over-allowance or oldest-archived. Do not let this get decided
   by whatever the implementation finds easiest.
