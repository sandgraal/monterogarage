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

- [ ] **T3-201 [TEST]** Shop membership and claim graders: membership is
  invite-only with no open join; a member sees exactly the shop's grants and no
  others; an unverified directory claim renders nothing; directory ordering and
  inclusion are provably unaffected by account, claim, or plan state (SHP-05 —
  grade it now, while there is no plan to be tempted by). Depends: T3-102. *(SHP-01..05)*
- [ ] **T3-202 [PLATFORM]** Shops: create, invite, membership, roster sharing
  subject to SHP-04's consent prompt. Activates T3-201. Depends: T3-201 merged. *(SHP-01, SHP-03, SHP-04)*
- [ ] **T3-203 [PLATFORM]** Directory claim: claim flow against the 001
  community collection's `shop` entries, verification, claimed badge. The
  community collection stays git-owned and read-only — a claim is a database
  row pointing at a content id, never an edit to the entry. Depends: T3-202,
  001-T703a. *(SHP-02, SHP-05)*

## Phase S3 — Propose-and-accept

**Read `specs/003-shop-tools/spec.md` §7.1 before starting.** This phase is the
AGENTS.md writable-surface carve-out. It is narrow, and its narrowness is the
whole reason it was authorized.

- [ ] **T3-301 [TEST]** Proposal graders. Depends: T3-202. *(PRO-01..06)*
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
- [ ] **T3-302 [PLATFORM]** Proposals: mechanic-side quote and job draft with
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
