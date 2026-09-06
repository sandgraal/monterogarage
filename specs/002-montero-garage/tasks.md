# Tasks 002 — Montero Garage pivot

DRAFT — buildable only after the owner merges spec 002 and the AGENTS.md
amendment PR lands. Conventions identical to 001 (frontier rule, [TEST] before
[PLATFORM] pairs, [CONTENT] dual passes, checkbox in final commit, commit refs
`specs/002-montero-garage`). Everything touching auth, RLS, storage policies,
or user-data schemas routes hard-Opus.

Domain: monterogarage.com is purchased (Namecheap, 2026-08-28). DNS cutover to
Vercel is an owner action inside T2-102 (the task prepares the exact records).

## Phase P0 — Rename & replatform

- [x] **T2-101 [PLATFORM]** Coordinated rename gitana-montero → monterogarage:
  repo rename (redirects verified), `site` → https://monterogarage.com,
  `base` → "/", src/site.ts (SITE_NAME → "Montero Garage", REPO_URL,
  keep TRUCK_YEAR with Gitana Blanca naming), ui.ts mission strings both
  locales, README, CI base-assertion updated for the no-base world,
  check:hreflang against the new absolute URLs, bilingual not-affiliated
  footer notice (MIG-05). *(MIG-01, MIG-05)*
  <br>**Landed in two halves on purpose.** GitHub Pages is the live deploy
  until T2-102, and a Pages *project site* is only reachable when `base` ===
  `/<RepoName>`. So T2-101 renamed the repository and set `base` to
  `/monterogarage`, leaving `site` at `https://sandgraal.github.io`; setting
  `site` to the custom domain before the DNS cutover (an owner action inside
  T2-102) would have published canonical/hreflang URLs at a host that does
  not answer. **T2-102 owns the remaining two lines of MIG-01:** `site` →
  `https://monterogarage.com`, `base` → `/`, and deleting the CI
  base-assertion step in the same commit.
- [x] **T2-102 [PLATFORM]** Vercel migration: project setup, production on
  main + preview deployments on PRs, CI gates unchanged and still
  merge-blocking, Pages deploy retired with a tombstone redirect, DNS records
  handed to the owner for Namecheap (owner action), Lighthouse/Pa11y budgets
  re-proved on the Vercel URL. **Also finishes MIG-01:** `site` →
  `https://monterogarage.com`, `base` → `/`, CI base-assertion step deleted
  (see T2-101). Depends: T2-101. *(MIG-02; amends 001 SCF-05)*
  <br>**Two parts are owner actions and are written out, not done:**
  `specs/002-montero-garage/HANDOFF-T2-102-DEPLOY.md` has the Vercel project
  import (do it *before* merging, so production is one automatic build away
  when `main` moves — but note the pre-merge deployment renders broken by
  construction, because `main` still sets `base: "/monterogarage"` while the
  output tree has no such directory; the merge is what fixes it, so nothing
  about the merge is gated on that deployment rendering) and the exact
  Namecheap records, read off Vercel's live docs on 2026-08-28. The Pages
  tombstone is **staged, not fired**: `.github/workflows/pages-tombstone.yml`
  is `workflow_dispatch`-only and refuses to publish until
  monterogarage.com answers, because removing the deploy job freezes the
  Pages site rather than breaking it — stale-but-working beats a redirect to
  a host that does not resolve. Budgets were re-proved against the
  `base: "/"` build served locally (both audits serve `dist/` themselves;
  they never needed the Vercel URL). Also closed a T2-101 review follow-up:
  `src/pages/404.astro` had no footer, so MIG-05's notice missed it.

## Phase P1 — Auth & user model

- [x] **T2-201 [TEST]** Graders for the user-data contract: RLS deny-by-default
  proofs (anon reads nothing private; user A cannot read user B), vehicle/record
  schema shape, receipts storage policy (no public URL for private objects),
  account-deletion cascade. Expected-failure markers. Depends: T2-102.
  *(ACC-01, ACC-03, SHR-01, GAR-05′)*
  <br>**Two tiers, because one of them cannot run in CI yet.** `tests/garage/`
  holds **77 `it.fails` marker lines → 216 marked tests** (161 failing today,
  55 skipped with the live stack absent) plus **143 unmarked positive
  controls**.
  *Tier A (declaration)* reads T2-202's DDL out of `supabase/migrations/` and
  `supabase/config.toml` and runs everywhere, forever — RLS enabled **and
  forced**, no policy granted to `anon`/`public`, every policy scoped to
  `auth.uid()`, share flags `not null default false`, every ownership FK
  `on delete cascade`, the receipts bucket created non-public, Google on and
  every other provider off. *Tier B (behavioural)* proves the same guarantees
  against a real Postgres through the real PostgREST / GoTrue / Storage
  surfaces as three actors (anon, owner A, owner B), and needs
  `supabase start` — i.e. Docker, which this task originally assumed CI did
  not have (see the correction directly below: that assumption was untested
  and wrong).
  <br>**Correction, 2026-09-01:** "Docker, which CI does not have" was never
  tested and is false. GitHub's stock `ubuntu-latest` ships Docker Engine and
  Compose, `supabase start` takes ~70 s there, and all 66 Tier-B graders run
  green — four for four
  (`specs/001-foundation/audits/T901-tier-b-ci-investigation.md`). The
  environment-variable prediction below held exactly: `ci.yml`'s `tier-b` job
  runs `npm run test:garage` and not one test file changed. The word to amend
  is *merge-blocking* — that job is deliberately advisory for now, pending the
  owner adding it to `main`'s required contexts (Stage 2).
  <br>Tier B suites
  `describe.skipIf` with the reason printed in the report, and
  `GARAGE_LIVE_REQUIRED=1` turns a missing stack into a hard failure, so the
  day CI grows a Postgres service one environment variable makes every
  behavioural proof merge-blocking with no test-file edits. Run it locally
  with `npm run test:garage`.
  <br>**No dependency, no key, no cloud.** JWTs are minted with `node:crypto`
  against the Supabase CLI's published local development secret and everything
  else is `fetch`; `assertLocalTarget` refuses any non-loopback host and is
  itself graded against a table that includes `*.supabase.co` and
  monterogarage.com. No Supabase project was created and no service key exists.
  <br>**T2-202 owns the seam:** `supabase/config.toml` + `supabase/migrations/`,
  and deleting `tests/garage/seam-canary.test.ts` (self-enforcing — leaving it
  turns `npm test` red). Table and column names are T2-201's design decision on
  the spec's behalf and live only in `tests/garage/contract.ts`, so a rename is
  a one-file change. Two things are **declaration-tier only** and named as
  gaps rather than faked: "no policy ⇒ no access" proved behaviourally needs a
  throwaway table, i.e. a direct SQL connection rather than PostgREST; and
  whether GoTrue can disable the password grant outright is a T2-202 finding —
  if it cannot, that is a stop-and-ask, not a quietly weakened grader.
  <br>**Rebuilt after review round 1, which proved the declaration tier was
  grading spelling rather than semantics.** Three wide-open schemas passed the
  entire merge-blocking proof and five correct DDL spellings were rejected. The
  cause was one design mistake with wide blast radius: predicates were matched
  as substrings against the *whole* policy statement, so `using` and
  `with check` were graded as their concatenation and a correct write rule
  covered for a read rule that handed every logged-in user everybody's rows.
  The rules now live in `tests/garage/rules.ts` as pure functions over DDL, and
  a predicate counts as owner-scoped only when **every top-level `or` branch**
  compares `auth.uid()` *by equality* against a row term — mention is not
  enough, and `or` is how a scoped predicate gets widened. Storage adds one
  clause: the read predicate must derive the owner from the object path, since
  that is the only thing about a storage row that says whose it is.
  <br>**`tests/garage/reviewer-probes.test.ts` pins the finding class forever:**
  the review's own leaking schemas plus the correct spellings it rejected,
  twelve variants with a known verdict, unmarked and green. Wide-open must
  fail, correct must pass; the next person to loosen a rule has to make a leak
  pass here first. Both directions were re-proved end-to-end against a scratch
  reference schema: correct → 168/168 declaration graders pass (so the contract
  is *satisfiable*, which round 1's ACC-03 pairing was not); three leaks
  injected → exactly 3 graders fail, each naming the offending clause.
  <br>ACC-03 is now two functions rather than one incoherent one:
  `request_account_deletion()` takes **no argument** and marks the caller's own
  row via `auth.uid()` — a victim is unrepresentable, not merely forbidden —
  and `purge_expired_accounts(p_now)` is the scheduled job, service-role only,
  taking the clock so a grader can reach "thirty days later" without waiting.
  <br>**Round 2 closed two more holes in the same guarantee class, both found
  by writing DDL rather than by reading code.** *Uncorrelated `exists`*: a
  subquery can carry a real `owner_id = auth.uid()` and still say nothing about
  the current row — `exists (select 1 from vehicles where owner_id =
  auth.uid())` means "own any truck, read everyone's records". Correlation back
  to the outer row *is* the ownership claim, so a predicate whose only equality
  lives in a subquery must now join back (qualified `records.vehicle_id` or the
  unqualified form Postgres resolves outward; both accepted). *`alter policy`
  was invisible*: `policies()` filtered on `create policy`, so a follow-up
  migration saying `alter policy … using (true)` reopened the original hole with
  every grader green. It now replays create/alter/drop in order and asks what
  the database looks like at the **end** of the directory. Also accepted:
  Supabase's own recommended `(select auth.uid()) = owner_id` and
  `owner_id in (select auth.uid())`, which were failing closed — a grader that
  rejects the officially recommended spelling pushes the implementation toward
  the slower one to get a green build.
  <br>**The probe corpus was itself mutation-tested, and had a hole.**
  Reintroducing the original F1 bug left every end-to-end probe green: P1 and
  P4 are caught by the tautology list and the path rule *before* the equality
  rule is reached, so the load-bearing rule was pinned only by unit tests of
  its own helper. N11/N12 close that — neither is tautological, neither is
  storage, so nothing but the equality rule can reject them. The same treatment
  was applied to the new rules (N4 for correlation, N3 for `alter policy`):
  each was verified by breaking its rule on purpose and confirming the corpus
  goes red. Four mutations, four caught by end-to-end probes.
  <br>**Also not graded here, and deliberately: SHR-02's public handle.**
  Uniqueness under concurrent signup, case folding, reserved words like
  `admin`/`api`, and what a handle change does to a published URL are each a
  grader of their own and none is in T2-201's scope. **They belong to T2-401**
  with the public pages. This file's silence is not permission.
- [x] **T2-202 [PLATFORM]** Supabase auth (magic link + Google, no passwords) +
  user/vehicle/record/receipt tables with RLS + private storage bucket.
  Activates T2-201 graders. Bilingual auth surface. Depends: T2-201 merged.
  *(ACC-01..04, SHR-01)*
  <br>**OWNER RULING on ACC-01, 2026-08-30 — "no passwords" means no password
  can ever _authenticate_.** Sessions come only from a magic link or from
  Google. The stricter reading — that no account may *carry* a password — was
  put to the owner and **rejected as unachievable on Supabase Auth**: T2-202
  proved live that GoTrue bcrypts a random secret even for accounts created
  without one, so "carries no password" is not a state the platform can be put
  in, and every path that blocks creation also breaks the magic-link flow
  ACC-01 requires. Creating an account that has a password is therefore **not**
  a finding; getting a session out of one is. The enforcement point is the
  `password_verification_attempt` hook, which answers a correct password on a
  real account with `400 "Password sign-in is disabled."` The T2-201 graders in
  `tests/garage/auth-surface.test.ts` were amended to the ratified reading
  (branch `fix/002-acc01-grader-ruling`, merged ahead of T2-202); the grader
  that demanded a refusal at signup is gone, as is the escape hatch that
  treated "creation refused" as a pass.
  <br>**Landed.** `supabase/config.toml` + four migrations; all 161 marked
  declaration graders activated by deleting `.fails` and nothing else (proved
  mechanically: every grader file is byte-identical to `main` modulo `.fails`
  and Prettier's re-wrap, `auth-surface.test.ts` against its amended text).
  Tier A 321/321. **Tier B ran for real** — Docker via colima, Supabase CLI
  2.114 / GoTrue 2.195 / Postgres 17.6 — **376/376 on a fresh stack**.
  `tests/garage/seam-canary.test.ts` deleted per its own docstring ("T2-202
  deletes this whole file"), the T203 precedent for a self-authorising grader
  file.
  <br>**Two defects the T2-202 review found by running it, both fixed here.**
  *F1, blocker:* `enable_confirmations = false` meant a signup carrying a
  password answered 200 with an access token **and** a refresh token — the one
  request in the system containing a password handed back a session, and worse,
  a pre-claim attack: sign up as an address you do not own, rotate the refresh
  token, and be inside the account the real owner later magic-links into, with
  SHR-01's blast radius and no proof of email ownership anywhere. On, that
  request returns a bare unconfirmed user and no token; magic-link sign-up is
  unaffected because that flow *is* an email confirmation. *F2, major:*
  `authenticated` held TRUNCATE on all four tables — Supabase's default
  privileges grant ALL on new tables in `public`, and an explicit
  `grant select, insert, update, delete` **adds to** that ACL rather than
  replacing it, so the role could empty `profiles` with no policy consulted
  (RLS does not filter TRUNCATE). Revoked in the default privileges and again
  by name per table before each grant; `role_table_grants` now reads exactly
  four verbs for `authenticated` and nothing for `anon`.
  <br>**One thing ACC-03 does not do, recorded rather than hidden:** the SQL
  purge needs Supabase's own `storage.allow_delete_query` opt-out, and it
  removes storage object *rows* — every route to a receipt — but not the bytes
  in the backend. Only the Storage API can, and reaching it from Postgres would
  mean a service key in the database, which AGENTS.md forbids. An Edge Function
  running inside Supabase is the follow-up; the runbook says so, and says how to
  assert the purge is really working (its `BYPASSRLS` dependence makes failure
  return `0`, indistinguishable from "nothing expired").
  <br>**Inherited from T2-201 — the shared-name correlation gap. DONE:**
  `isCorrelated` now subtracts the subquery's own tables' declared columns
  before the bare-name test, and N13/N14 (the reviewer's P1/P2) pin it
  end-to-end. Mutation-proved: reverting the rule turns exactly those probes
  plus the corpus sweep red (4 failures), restoring it returns 82/82.

## Phase P2 — The garage

- [x] **T2-301 [PLATFORM]** Vehicle profile: create/edit, display name,
  taxonomy identity via the 001 fitment engine, photos, odometer. Garage
  dashboard per HANDOFF-DESIGN.md's timeline direction. Depends: T2-202, 001-T203. *(GAR-01′)*
  <br>**The photos storage contract is graded ahead of you in
  `tests/garage/vehicle-photos.test.ts` (T2-301a, merged first).** 18 `it.fails`
  markers — 7 declaration, 11 live — activated by deleting exactly the `.fails`
  on each. Contract decisions, all argued in `tests/garage/contract.ts`: bucket
  id **`vehicle-photos`** (not `photos`, so the generic name stays free for a
  future avatar/banner surface with different ownership rules); path
  **`<owner uuid>/<vehicle id>/<file>`** — the owner stays in
  `(storage.foldername(name))[1]` so the photos policies are the receipts
  policies with one bucket id changed, and the vehicle segment makes
  per-vehicle cleanup a prefix match instead of a reconciliation against
  `photo_paths`; and `vehicles.photo_paths text[] not null default '{}'`, which
  T2-202 already ships and which is now pinned as a column contract rather than
  a `/photo/` regex.
  <br>**Three of those markers are not "receipts again" and will not fall out
  of copying that migration.** (a) `purge_expired_accounts` filters
  `bucket_id = 'receipts'` — correct when receipts were the only bucket, and
  silently incomplete now; a purged account would keep every photo row, which
  ACC-03 forbids. Generalise or extend it. (b) Deleting **one vehicle** must
  reach its objects, and no foreign key can do that — a storage object is not a
  row in `public`, so this needs a delete trigger on `vehicles`; two graders
  cover it (the trigger exists; the cleanup actually targets the photos
  bucket). (c) The bucket needs `allowed_mime_types` restricted to images: an
  untyped private bucket is a general-purpose file host attached to a truck.
  <br>Verified live against a stack with T2-202's four migrations applied: all
  11 live markers fail with `NoSuchBucket` and nothing else. The fixture writes
  the row half **before** the upload — vehicle insert, then `photo_paths`, then
  the object — so every live run exercises the column and the only thing left
  to fail is the missing bucket. (Review caught that the original ordering put
  the upload first, which meant the update never ran and the "the row half
  already fits" claim, though true, had no evidence behind it. Reordering makes
  it true by construction.)
  <br>**Deliberately left open, and yours only if you want it early:** SHR-02's
  showcase page is public and cannot render an object from a private bucket
  without a signed URL, which expires. Long-lived signatures, a render-time
  proxy, or an opt-in public bucket are all sharing decisions — they belong to
  T2-401/T2-402, and pinning one here would have been inventing the answer.
  <br>`/en/garage/` + `/es/taller/` (ES segment is the glossary's canonical
  term — `garaje` is a Spain/Mexico alias on `all-general-taller`). Identity is
  picked with T204's own `createVehicleOptions` reading the taxonomy payload
  `VehicleSelector.astro` already inlines — no fork, no second request. Photos
  live in the private `vehicle-photos` bucket; the owner's garage renders them
  through short-lived signed URLs, and how a *public* showcase page does it is
  still T2-401/402's open question, untouched here.
  <br>**Two things the odometer forced:** the display unit is a
  `localStorage` reader preference (the schema stores `odometer_km` once), and
  `vehicleWriteFromDraft` takes the previous row so an untouched figure is
  never re-converted — 247 500 km renders as 153 789 mi and converts back to
  247 499, which would walk a stored odometer a kilometre per save.
  <br>**The purge is replaced forward, not edited backward:**
  `purge_expired_accounts` named only the receipts bucket, so ACC-03's "stored
  files" stopped at photos. The new migration `create or replace`s it. Editing
  T2-202's applied migration was tried first and reverted — a migration is a
  record of what ran, so an edit to one already pushed changes what a *fresh*
  database gets and nothing about the one that exists.
- [x] **T2-302 [PLATFORM]** Records + receipts: dated typed records, cost/time/
  odometer, attachment upload to private storage, vendor/date/amount fields,
  typed references into reference collections. Depends: T2-301. *(GAR-02′, GAR-05′)*
  <br>**No column was added and none was needed** — every field came from
  T2-202's schema as `tests/garage/contract.ts` pins it. Done-versus-planned is
  `record_kind`'s fourth value, so the artboard's filled/hollow dot, dashed
  card and amber badge are one class driven by `kind`; a status column would
  have been a second way to say the same thing and a second way for the two to
  disagree.
  <br>**Typed references (GAR-02′) are the record's own `text[]` columns,
  validated against built content at render time** — nothing was added to a
  content schema. The page reads `getCollection("problems"|"parts"|
  "procedures")` at build time, inlines `{id, title}` per locale as one JSON
  payload (the `VehicleSelector.astro` seam), and the picker offers only what
  the site ships. Modelling it from the reference end would have put a private
  row's existence in a public git file. An id the site can no longer resolve
  renders as itself in a dashed chip rather than being dropped: a reference
  entry can be retired after a record was written, and tidying the link away
  would delete part of somebody's record. The chips are **not links yet** —
  problem/part/procedure pages are 001's T4xx/T5xx, and a chip pointing at a
  page that does not exist is a broken link `check:links` would be right to
  fail.
  <br>**Cost is the one figure that cannot follow "store it once, render per
  reader".** A currency is not a display unit, so `cost_amount` +
  `cost_currency` are stored as the user chose and never converted. The parse
  refuses rather than guesses: `1.500` is fifteen hundred in one locale and one
  and a half in the other, so a lone separator with three digits after it
  returns `ambiguous-separator` and the page asks for it again without
  separators. Getting that wrong moves somebody's money by a factor of a
  thousand.
  <br>**Two things left open, deliberately.** (a) The Planned tab renders the
  same cards filtered to `kind = 'plan'` — *not* GAR-03′'s computed queue,
  which is T2-303's; a panel saying "nothing is planned" beside a planned card
  on the timeline would have been the page lying to its owner. (b) The
  Current-state tab is untouched, T2-303's entirely.
  <br>**Review found the second two-unit figure walking (F1).** The
  odometer's "do not convert a figure nobody touched" guard was written for the
  odometer only, so `time_minutes` went through the display round trip on every
  save: 45 min renders as 0.8 h and comes back as **48**, 100 → 102, and 1 → 0.
  An edit to a record's *title* added three minutes to the job. The suite
  missed it because every fixture used 72 minutes — 1.2 h — one of the few
  values that survives. Both figures now share one rendering of `previous`, and
  the counterpart grader sweeps 1/45/100/359. **It came back once, one level
  up:** the unit control converted the *displayed* text, so a stored 45 shown
  as `0.8` h became `48` on the switch to minutes and the untouched guard
  stopped recognising it — and the first grader for that only ran the safe
  min→h direction, so it was green over a live defect. `convertTimeField` now
  takes the stored minutes and re-renders from the row when the box still
  reads what the row renders as, converting only what a reader actually typed;
  the grader runs both directions over values the display cannot round-trip
  (only multiples of six survive). Two smaller ones folded in: a
  receipt's object is now removed **before** its row (the row is the only index
  a receipt has, unlike a photo's `photo_paths`, so row-first could strand
  bytes nothing can name), and the time-unit control now *converts* the typed
  value on every path instead of discarding it on an existing record and
  silently reinterpreting it on a new one (`2` hours became two minutes).
  <br>**Zero and unknown are not the same chip (PR #68).** A failed receipts
  request reached the timeline as an empty map, so every card rendered as "no
  receipts attached" with nothing saying the request had failed — a wrong
  answer wearing the clothes of a right one, on the page that is supposed to
  be the record of what happened. The counts are now
  `ReadonlyMap | null`, so a caller cannot read the failure as zero; the
  records still paint (losing a whole work log to hide one chip is the worse
  trade), no receipt chips are drawn, and a notice beside the rail says the
  counts are unavailable and that opening a record still shows its own.
  <br>**Found, not fixed — receipts have no delete-trigger belt.**
  `on_vehicle_deleted` sweeps `vehicle-photos` by `<owner>/<vehicle>/` prefix;
  receipt objects are `<owner>/<file>` (the contract's shape), so no prefix
  identifies one vehicle's receipts and no trigger can find them without
  reading the rows it is cascading away. `deleteVehicle` and `deleteRecord`
  therefore remove the objects through the Storage API *before* the row delete
  that destroys the index, and a browser closed mid-request strands bytes until
  the account purge (which is prefix-by-owner and does cover them, ACC-03). A
  belt would be a `before delete` trigger collecting paths through the join —
  a migration, which this task did not authorise. Flagged for T2-303/T2-401.
- [x] **T2-303 [PLATFORM]** Derived views per vehicle: current-state sheet +
  planned queue, computed. Depends: T2-302. *(GAR-03′)*
  <br>**Everything is in `src/lib/garage/derived.ts`, pure and graded** (37
  unit graders; 18 hand-written mutants run against them, 0 survivors — the
  ones worth naming: latest-reading-as-`Math.max`, plans counted as work done,
  `sinceKm` unknown becoming `0`, a failed request read as an empty queue, and
  two currencies summed into one figure). It opens **no request**: all three
  tabs are computed from the one `records` array the page already fetched, so
  the per-vehicle fan-out warning inherited from T2-302 (F3) adds nothing here.
  `listRecords` is still deliberately unbounded and **must stay that way for
  these views** — a `.limit()` would silently truncate the array the sheet
  derives from, and a truncated record set does not produce a smaller answer,
  it produces a *wrong* one (the wrong latest odometer, a service line that
  claims a job was last done years before it was). Bounding it needs a
  windowing design where the derived figures are computed server-side; flagged,
  not invented here.
  <br>**Three things the spec demanded that the schema cannot answer, resolved
  without touching it.** (a) 001 GAR-03 says the queue is "ordered by
  priority" and there is no priority column; adding one is a schema change this
  task did not authorise, so **priority is the date the owner already gave the
  plan**, and the only non-arbitrary cut in a calendar is today — hence exactly
  two groups, `overdue` and `upcoming`, and no "soon" bucket, because a horizon
  is a judgement about somebody else's truck. (b) "Fluids/consumables state"
  would need the site to know some entry *is* engine oil; there is no consumable
  taxonomy on `parts`/`procedures`. So a service line is **one row per
  reference id the owner linked**, which reads correctly for fluids without
  claiming a classification the site does not have — and renders nothing at all
  today, because `parts`/`procedures`/`problems` ship empty until T4xx/T5xx.
  (c) **Nothing says "due."** A due date needs a service interval, and the only
  intervals in the repo (`serviceIntervalSchema`) live on `reference` entries,
  which GAR-02′ records cannot point at. The sheet reports *elapsed* — last
  done, and how far the truck has gone since.
  <br>**PR #68's lesson, generalized — and it had already leaked.** The page's
  `records` was `RecordRow[]`, set to `[]` on a failed `listRecords`, and the
  error line lived *inside the timeline panel*. So a reader on Current state or
  Planned work after a failed request got a panel with nothing in it and no
  explanation anywhere on screen. That is worse than the receipts case it
  mirrors: an empty derived sheet reads as a *finding* — no mileage on record,
  nothing ever serviced, nothing planned — three wrong statements about a truck,
  published off a dropped request. `records` is now `RecordRow[] | null`,
  `currentState`/`plannedQueue` take and return the nullable, `paintEntries`
  refuses to reveal its empty note for `null`, the stat row falls back to "not
  recorded" instead of a confident `0`, and the live region moved **above the
  tablist** so one announcement covers all three tabs (three copies would talk
  over each other).
  <br>**The odometer is derived, and it is not the profile's figure.**
  `vehicles.odometer_km` is hand-maintained, so GAR-03′ excludes it: the sheet
  shows the latest reading *written against a job*, labelled as such, while the
  stat row keeps showing the profile figure. Latest-by-date, not highest —
  `Math.max` makes one transposed digit the truck's mileage forever — and plans
  are excluded, because a plan is dated in the future by design and its
  odometer is a target, not a reading. When an earlier record reads higher the
  sheet **says so** rather than picking a winner; both are the owner's
  testimony. Same-day pairs are not flagged (their order is the arbitrary id
  tie-break).
  <br>**Money is totalled per currency and there is no field to put a
  cross-currency total in.** `PlannedEstimate.byCurrency` is a map, so the type
  itself makes the wrong answer unavailable. Summed in integer cents — decimal
  addition leaves a total that does not equal the visible parts.
  <br>**Coverage is per figure, and round 1 caught it not being so (F1).** The
  first version exposed one `itemsWithCost` and the page rendered
  `Math.max(itemsWithTime, itemsWithCost)` as a single sentence under every
  row: 7 plans with 2 time-only and 4 cost-only read as "Time 2 h; Cost
  $400.00; From 4 of 7 planned items" — true of neither figure, and exactly the
  failure the module's own docs claimed to prevent. Now the duration carries
  `itemsWithTime` and **each currency carries its own** `CurrencyTotal.items`
  (one shared cost coverage would have been the same lie one level down, with
  a colón line borrowing a dollar line's count). `PlannedEstimate` has no
  "items with any estimate" field left to reach for, the coverage slot lives on
  the estimate row's template, and `estimateRow` takes the count as an
  argument so no caller has a shared number available to pass by mistake. The
  repro now renders `Time — 2 hr — From 2 of 7` / `Cost — $400 — From 4 of 7`
  (ES: `A partir de 2 de 7` / `de 4 de 7`). Two new graders and two new mutants
  (M19/M20) pin it.
  <br>**An author `display: flex` beat the `[hidden]` attribute (F9,
  round 2).** `.garage__sheet` and `.garage__sheet-block` set `display: flex`
  at author origin, which outranks the user-agent `[hidden]` rule, so three
  new elements carried `hidden` from the script and rendered anyway — the
  exact trap `.garage__gate` already documents in this file and the glossary
  and community toolbars each shipped once. The consequence was the worst one
  available here: opening vehicle B while its records were in flight showed
  B's loading notice with **vehicle A's odometer still asserted underneath as
  computed fact**, persisting into the failure state; and an empty "Past their
  date" heading rendered over nothing. Reproduced in a real browser in both
  locales (computed `display: flex` with `hidden` set), fixed with the
  guard, re-probed to `none`. `.garage__sheet-list` is in the guard too — the
  same trap waiting for the first caller that hides one.
  <br>**And the slots are emptied, not merely hidden.** `paintCurrentState`
  and `paintPlannedQueue` now clear every figure on their early returns, so
  correctness does not rest on a CSS rule: a stale odometer that is only
  *invisible* is one style regression away from being a false statement about
  somebody's truck again. Two independent mechanisms, and nothing survives
  the vehicle it described.
  <br>**The staleness guard covered the success path only (F8, fixed round
  3).** `loadRecords`'s `!result.ok` branch returned *before* reaching the
  `opened?.id !== vehicle.id` check, and the `.catch` in `openDetail` had no
  check at all — so a failure could be applied to whichever vehicle happened
  to be on screen. Round 2 recorded this as self-correcting and **that was
  wrong**: the shepherd's ordering is open A → switch to B → B loads and
  paints correctly → *then* A's request rejects, and the unguarded handler
  replaces B's good records with `null` and marks the page failed with nothing
  left to correct it, because B's own request had already finished. A wrong
  answer with no path back to the right one, which is worse than the missing
  answer the nullable type exists to protect. Both paths are guarded now, and
  in `loadRecords` the single guard moved *above* the outcome check rather
  than being duplicated into each branch: whether the request succeeded has no
  bearing on whether it is still the right vehicle, and asking once is one
  fewer place for the next branch to forget. **Honest limit:** like the
  slot-clearing in F9, this guard has no automated test behind it until F3
  lands — "a request for the vehicle you are no longer looking at" is exactly
  the case that harness should own.
  <br>**Pending is not failed (F2).** `openDetail` painted `records = null`
  before `loadRecords` fired, so during the ordinary network beat both derived
  panels showed "…they could not be loaded" — a past-tense failure claim about
  a request still in flight, which is the `null`-vs-`[]` argument one step
  further on. There is now a third state: `recordsStatus` is
  `loading | loaded | failed`, each derived panel has its own loading note
  (`garageDerivedLoading`, both locales), and the failure copy is reserved for
  the real failure — including the `.catch` path, which also leaves `loading`
  so the panels cannot sit on "working this out…" forever.
  <br>**Not done, deliberately:** the current-state sheet reports open items as
  two counts and sends the reader to the Planned tab rather than drawing the
  queue twice; there is no reminder, notification or due-date surface anywhere
  (the copy says so in both locales). `/en/garage/` performance is 92 against
  the 90 budget — passing with two points, unchanged in kind by this task but
  worth knowing before the next thing lands on this page.
  <br>**Follow-ups recorded in round 1, not implemented here** (each is a
  separate change with its own blast radius, and both round-1 findings were
  found by reading rather than by a failing test — F3 is the one that fixes
  that):
  <br>· **F3 — the derived rendering layer has no automated coverage.**
  `paintCurrentState`, `paintPlannedQueue` and `estimateRow` in
  `[garageSegment].astro` are ~90 lines of glue that nothing grades, and
  **every** finding across all three review rounds lived there — F1, F2, F9
  and F8 — while `derived.ts` itself cleared 20/20 mutants. That is the
  strongest argument in this task for the harness. The next change to these
  functions still has nothing to fail against. Adopt the container-API seam
  T501 built in `part-page.render.test.ts` as the pattern; the cases worth
  pinning first are the four states per panel (loading / failed / empty /
  populated), the per-row coverage, and the stale-vehicle guard from F8 —
  each of those is a defect that shipped and was caught by reading.
  <br>· **F4 — the profile odometer's stat label is the unqualified one, and
  that is backwards.** The derived figure is carefully labelled "Latest
  reading in your records" while the hand-maintained profile figure beside it
  is just "Odometer", so the *less* authoritative number reads as the plain
  one. It is a T2-301 string; suggested "Odometer on the profile" /
  "Kilometraje del perfil".
  <br>· **F5 — the km/mi switch does not repaint the derived sheet.** Inherited
  T2-301 shape: the unit control repaints what it knew about, and the
  current-state figures are new. Every derived distance renders through
  `formatOdometer`, so the fix is a `paintRecords` call on the unit change,
  but it belongs with a sweep of every unit-dependent surface rather than a
  spot fix here.
  <br>· **F7 — `plannedRecords` in `src/lib/garage/record.ts` is now dead
  production code.** The planned tab was its only caller and now goes through
  `plannedQueue`. Left in place rather than deleted because T2-401's public
  work-log plausibly wants exactly "the plans, soonest first, unadorned"
  without the queue's grouping; if that lands elsewhere, delete it.
  <br>· **F10 — fixed.** F9 patched three leaking elements per-selector; a
  follow-up sweep found the same author `display: flex` beating `[hidden]`
  trap on five more elements this page alone — `[data-garage-app]` itself
  (a signed-out visitor was served the entire garage application, laid out
  beneath the sign-in gate), `[data-garage-empty]`, `[data-garage-detail-view]`,
  `[data-garage-form]` and `[data-garage-record-form]` — plus one on the
  sign-in page (`[authSegment].astro`'s `.signin__status`, the "You're signed
  in as ___" line, visible and empty while signed out). This is the fourth
  time the class has shipped (glossary toolbar, community toolbar,
  `.garage__gate`, F9's sheet trio), so it is now closed as a class rather
  than patched again: one scoped rule per page —
  `.garage [hidden] { display: none !important; }` and
  `.signin [hidden] { display: none !important; }` — with F9's and the
  earlier per-selector guards collapsed into it. Graded by
  `tests/e2e/hidden-guard.spec.ts` (Playwright, `getComputedStyle` over every
  `[hidden]` element on the garage, sign-in, glossary, community and problems
  pages, both locales, gated to the configured build for the two pages that
  need it); mutation-checked by removing the rule — the grader went red on
  exactly the garage and sign-in cases, both locales, and green again once
  restored.
- [ ] **T2-304 [CONTENT+DESIGN]** Gitana Blanca seed — user page #1: owner
  interview (001 T303's content) entered as real records with receipts;
  conductor+owner refine the garage views against it before generalization.
  Depends: T2-302. *(MIG-04)*
  <br>**Added mid-task (2026-09-02): the interview surfaced a real gap.**
  Gitana Blanca's seed data includes WhatsApp photos, videos, and voice notes
  documenting a shop's repair work — none of which are receipts in GAR-05′'s
  financial sense (vendor/date/amount), and video/audio have no attachment
  type at all today (the `vehicle-photos` bucket's `allowed_mime_types` is
  image-only per T2-301a). Owner-approved spec addition **GAR-06′** and new
  tasks **T2-305a/T2-305** below cover it. 11 of 12 documentation photos and
  the ROSOGA quote PDF (as a GAR-05′ receipt) were seeded directly against
  production via the conductor's Supabase connection, with the owner's
  explicit sign-off on that write path; the 12th photo silently failed to
  reach storage (not a data-loss risk — nothing references it) and is a
  loose end if anyone wants to chase it. **A real bug found in the process
  (ticketed below as T2-305):** uploading vehicle photos back-to-back fast enough
  triggers a lost-update race on `vehicles.photo_paths` — one upload's
  read-modify-write of the array can clobber another's, leaving a real
  storage object with no `photo_paths` entry pointing at it (recovered by
  hand this time via direct SQL). Whoever picks up hardening the photo
  upload flow should fix this — likely `array_append` at the SQL layer
  instead of a client-computed replacement array, or a serialized upload
  queue.

- [x] **T2-305a [TEST]** Graders for record media attachments (GAR-06′):
  a private bucket for photo/video/audio; RLS scoped to owner via the
  vehicle→owner ownership path (same shape as T2-301a's photos and receipts);
  `allowed_mime_types` restricted to the three declared kinds only; a
  delete-record trigger reaches its attachments (same defense-in-depth
  pattern T2-301a used for `on_vehicle_deleted`, and the same gap T2-302
  flagged and left open for receipts — do not repeat that gap a third time
  without at least naming it in this task's own notes); storage_path
  contract; distinct from and independent of GAR-05′'s receipt fields
  (vendor/date/amount stay receipt-only, never required on an attachment).
  Depends: T2-302. *(GAR-06′)*
- [x] **T2-305 [PLATFORM]** Record media attachments (owner-approved
  addition, 2026-09-02): new private bucket (photo/video/audio) + attachment
  rows scoped to a record, path `<owner uuid>/<vehicle id>/<record id>/<file>`
  per the T2-301a photos precedent; upload UI on the record edit page,
  alongside but visually distinct from receipts. Fix the lost-update race on
  `vehicles.photo_paths` noted above while touching this surface, if not
  already fixed elsewhere first. Activates T2-305a graders. Depends: T2-305a
  merged. *(GAR-06′)*
  <br>**All 41 `it.fails` markers in `tests/garage/record-media.test.ts`
  activated by deleting exactly the `.fails`** — 33 declaration, 8 live (20
  live cases once `it.fails.each` expands). Mutation-checked rather than
  assumed: with the migration moved aside, 32 of the 33 declaration graders go
  red and only the promotion one stays green, which is correct — promotion is a
  contract edit, not a migration one.
  <br>**Promotion, the three edits `RECORD_MEDIA_TABLE`'s docstring names**,
  plus one it could not have predicted: the entry had to *move* to above
  `USER_TABLES` in `contract.ts`, because `const` has no hoisting and
  `USER_TABLE_NAMES` reads the array a hundred lines before the old
  declaration site. `PENDING_USER_TABLES` is emptied but still exported —
  `rules.ts` reads it so `isCorrelated` has columns for a pending table's
  policy. `harness-contract.test.ts` needed **two** lists updated, not one:
  the shipped/pending split is a second hard equality in the same block.
  <br>**The record-delete belt narrows on `vehicle_id` AND `id`, not on the
  owner.** A records row has no `owner_id` to read, and matching the owner
  segment alone would empty that owner's whole garage on the deletion of one
  note. `for each row` on purpose, so it also fires for records cascaded away
  by a vehicle delete — which is the one live grader that would catch a
  statement-level trigger.
  <br>**Named for the third time and still not fixed: `receipts` has no belt.**
  T2-302 recorded it, T2-305a repeated it, and this task does not close it
  either — the cause is the receipt *path* shape (`<owner>/<file>`), which
  carries nothing identifying a record or a vehicle, so the fix is a migration
  of object names already in storage. That is a data migration this task did
  not authorise. It stays open for whoever owns receipts hardening.
  <br>**The lost-update race is fixed at the SQL layer** —
  `append_vehicle_photo` / `remove_vehicle_photo`, `security invoker` so
  `vehicles`' own policy still decides whose row it is, `array_append` /
  `array_remove` inside one `update` under the row lock Postgres already
  takes. Not a client-side queue: a queue is a promise one tab makes that a
  second tab has never heard of. The append is idempotent, because a retry
  after a lost response must not list the same object twice. New graders in
  `src/lib/supabase/garage-writes.test.ts` (12) run against a recording fake
  client; mutation-checked by restoring the client-computed array, which turns
  6 of them red including the named concurrency one. Before this branch the
  whole request layer of `garage.ts` had no graders at all, so a revert would
  have been silent.
  <br>**The media section is deliberately field-less.** GAR-06′ says an
  attachment is "independent of a receipt's vendor/date/amount fields", so the
  form is one file input and a button — the WhatsApp voice note that motivated
  the requirement cannot be filed at all if the form asks for a vendor first.
  `media_kind` is read from the declared MIME type rather than chosen by the
  reader, and each row renders as exactly one of `<img>`/`<video>`/`<audio>`
  with the other two removed.
  <br>**Two numbers differ from receipts and both are about video.** The bucket
  limit is 100 MB (receipts 20, photos 10) because a two-minute phone video of
  a noise is the motivating case; the signed-URL TTL is 30 minutes rather than
  10 because a browser streaming a large file makes range requests for as long
  as playback lasts, and a 10-minute signature expires *mid-playback* on a slow
  connection with an error that looks like a broken file.
  <br>**Not done, deliberately: no media chip on the timeline.** Receipts have
  one; adding a second would mean a second per-timeline request and a second
  "unknown is not zero" surface (PR #68), and the task scopes the UI to the
  record edit page. `mediaCountsByRecord` exists and returns the same
  three-state `ReadonlyMap | null` for whoever adds it.
  <br>**Tier B was not run: Docker is not running on this machine**
  (`supabase start` → `failed to connect to the docker API`). The 20 live
  graders are activated and unexercised locally; CI's informational `tier-b`
  job is the first thing that will run them. Every Tier-A grader, the whole
  unit suite and `npm run verify` are green.
  <br>**Review (no blocking findings; five Low/Informational, two fixed).**
  <br>*F1 — a docstring claimed a guarantee the code did not implement.*
  `record-media.ts` said `mediaPathBelongsTo` refuses to ask the storage API to
  "sign or remove" a foreign path. It guards `removeRecordMedia`,
  `deleteRecord` and `vehicleMediaPaths`; it does **not** guard
  `signRecordMediaUrls`. Not a live exposure — the bucket policy pins
  `(storage.foldername(name))[1]` to `auth.uid()`, so signing another owner's
  object is refused at the point it is asked for — and `signReceiptUrls` /
  `signPhotoUrls` have the identical unguarded shape. Fixed as documentation:
  the module docstring now names the three guarded call sites, names signing as
  deliberately unguarded, and says why (a refused signature is a player that
  does not render; a delete on an invented name is irreversible). Adding a
  fourth, differently-shaped sign path to prove what the database already
  proves would have left the other two looking careless by comparison.
  <br>*F2 — `in` and a bare bracket lookup walk the prototype chain.* Fixed in
  all three sibling modules (`record-media.ts`, and the pre-existing copies in
  `photos.ts` and `receipt.ts`) via one `Object.hasOwn` accessor each, so the
  next lookup added cannot get it wrong. **The sharper half was not in
  `mediaIssue`:** `mediaObjectPath` / `photoObjectPath` / `receiptObjectPath`
  guard with `=== undefined`, and `MIME_MAP["constructor"]` returns `Object`
  rather than `undefined` — so the guard did not fire at all and the builder
  returned a name whose "extension" was a function's source text. Six new
  graders (two per module), all six red against the old idiom.
  **`toLowerCase()` runs before the lookup**, so `toString`/`valueOf`/
  `hasOwnProperty` lower-case into members of nothing and make vacuous graders
  — verified by running them, and the reachable set is exactly `constructor`
  and `__proto__`. Pinned by a control asserting that fact.
  <br>*F3 — the hand-rolled supabase-js fake in `garage-writes.test.ts` has
  three modelling gaps*, now named in that file's own header rather than left
  for the next person to discover: `.eq()`/`.in()`/`.order()` ignore their
  arguments, `.single()` and a bare `select()` both resolve to one object where
  production returns an array without `.single()`, and `outcome("insert", …)`
  is used for every verb so only insert failures can be injected. Each would
  let a *future* grader pass while production did something else.
  <br>*F4 — the `photo_paths` race graders are self-authored.* There is no
  `[TEST]` task for GAR-01′'s race fix and no independent grader pass; the 12
  graders in `garage-writes.test.ts` were written by the same instance that
  wrote the fix. They mutation-test correctly (6 red against the restored
  client-computed array), but that is a weaker guarantee than the
  test-writer/implementer split this project normally gets, and this line does
  not claim otherwise. Whether it belongs on the AGENTS.md debt ledger is the
  conductor's call.
  <br>*F5 — nothing on the required merge path executes the migration SQL.*
  `npm run verify` is Tier A only, which parses migration text; the SQL is run
  only by CI's **non-required** `tier-b` job. Review did a static
  `libpg_query` parse (grammar valid; the alias-in-`RETURNING` this task
  flagged as its own biggest risk is in fact required and correct), but a parse
  is not an execution. **`tier-b`'s actual output must be read once CI runs,
  not assumed green.**

- [x] **T2-306a [TEST]** Graders for the cover-photo designation (GAR-01′):
  a nullable `vehicles.cover_photo_path` column (or equivalent) naming one entry already
  present in `vehicles.photo_paths` as the cover; the value SHALL be validated as
  membership in that same array (a cover path naming a photo the vehicle
  does not have is a defect, not a user error to accept silently); removing
  a photo that is the current cover SHALL clear the cover designation rather
  than leave a dangling reference (same "unknown is not zero" discipline as
  T2-303's supersession-state work in 001) — a delete-then-reselect race
  between two tabs is the concrete case to grade for; setting a cover SHALL
  be independent of upload order (the Nth photo added, not just the most
  recent or the first, can become the cover). Depends: T2-301. *(GAR-01′)*
  <br>**33 `it.fails` marker lines across two files**, activated by deleting
  exactly the `.fails` on each. `tests/garage/cover-photo.test.ts` — 21 (7
  declaration, 14 live under `describe.skipIf`); `src/lib/garage/cover.test.ts`
  — 12, all pure. Because four of them are `it.fails.each` tables the markers
  produce **43 expected-failure cases**: 21 that run anywhere (7 + 14) and 22
  live. Three more cases come free from the contract entry, in
  `schema-shape.test.ts`'s pending sweeps.
  <br>**Your whole activation is four moves, and none of them edits a
  grader** (T2-306a review, F2 + residual): ship the migration; implement the
  two `cover.ts` seam functions; delete the one `pending:` line in
  `contract.ts`; delete the `.fails` markers in `cover-photo.test.ts` and
  `cover.test.ts`. **Do not touch `schema-shape.test.ts`** — its
  `it.fails.each` sweeps are shared with `profiles.handle` (T2-402) and
  `shares` (T2-404), and deleting the `pending:` line re-partitions your
  column out of them automatically. Every control that used to assert the
  feature's *absence* is now either branch-aware or written against a
  synthetic never-shipping column, so all of them stay true on both sides of
  activation. **Measured, not asserted:** the whole end state was simulated —
  migration, seam, `pending:` line, markers — and the suite came back
  **3322 passed, 415 expected fail, 0 failures.** If you find yourself editing
  an unmarked grader to get green, that is a defect in these graders; say so
  rather than editing, because T901's separation audit reads exactly that
  signal.
  <br>**Contract decisions, all argued in `tests/garage/contract.ts`:**
  `vehicles.cover_photo_path text` — **nullable, and with no default**. A
  *path*, not `cover_photo_index int`, because an index into a client-written
  array names a different photo after any removal and a stale index is
  indistinguishable from a fresh one; a path is checkable against
  `photo_paths` and an index is not. Not `vehicle_photos.is_cover` either —
  no photos table exists, `src/lib/garage/photos.ts` argues why, and creating
  one is a schema decision this task had no mandate for. No default because
  `default photo_paths[1]` is the silent promotion GAR-01′ forbids, spelled
  as DDL and applied to every vehicle ever created.
  <br>**Two enforcements, and both routes are accepted.** Membership: a
  `check` constraint relating the two columns **or** a trigger that `raise`s —
  demanding one would fail a schema that chose the other for no reason a
  requirement can name. Clearing: a **`before update`** trigger on
  `public.vehicles` that assigns `cover_photo_path` and assigns it only
  `null`. `before` is graded because here the mechanism *is* the behaviour —
  an `after` trigger cannot change the row, so the membership constraint has
  already refused the removal GAR-01′ says must succeed. The trigger's
  function is found by **following `execute function`**, never by name
  (T2-301a's F1).
  <br>**Scope the clearing trigger to a DEPARTURE, or it will silently swallow
  the defect this task exists to catch** (T2-306a review, F1 — found by
  shipping the graders' own fixture as a real migration and watching a live
  stack accept it). A `before` trigger runs *before* the check constraint, so
  one that clears whenever the cover is not a member never lets a **freshly
  written** bogus designation reach the constraint: it nulls it and the write
  returns `ok`. The owner clicks "set as cover", gets no error, and gets no
  cover. Add
  `and new.cover_photo_path is not distinct from old.cover_photo_path` to the
  clearing condition (`is not distinct from`, not `=` — both sides are
  nullable and `null = null` is null), **or** declare the trigger
  `before update of photo_paths` so a cover-only patch never fires it — and if
  you take that route, **`photo_paths` must be the only column in the scope
  list**. `update of photo_paths, cover_photo_path` looks scoped, satisfies
  the naive reading, and still fires on a cover-only patch: the same defect
  with a scope clause bolted on, which the re-review caught by shipping that
  exact migration and watching Tier B fail it the same three ways. Either
  route satisfies the Tier A rule; all of it is controlled in
  `cover-photo.test.ts`. The rule is necessary, not sufficient — Tier B's
  "a path the vehicle does not have is refused" is what actually proves it.
  <br>**A seam you must fill: `src/lib/garage/cover.ts`.** Two exported
  symbols, both throwing `not implemented: T2-306` today —
  `resolveCoverPath(vehicle)` (the shared render helper T2-306's own line asks
  for, so T2-402 needs no second implementation; returns `null` for *no
  photos*, *no designation*, and *a designation the vehicle does not have*,
  and never falls back to `photo_paths[0]`) and `coverPhotoWrite(path)` (the
  patch body, graded to carry **exactly one key**). `CoverPhotoSource` is
  declared structurally so a `VehicleRow` that gains the column is assignable
  with no adapter.
  <br>**Why the write shape is graded at all:** T2-304's lost-update race on
  `vehicles.photo_paths` (open as T2-305) is one careless payload away from
  coming back — a "set as cover" that transmitted the array it read a moment
  ago would be the same bug on a surface where only one photo goes missing.
  Three live `it.fails.each` tables run the two-tab interleaving three ways
  (A→B, B→A, `Promise.all`), and one of them exists specifically to fail if
  designating a cover loses a photo another tab added.
  <br>**Harness change this needed: `columnDefinitionFor` in
  `tests/garage/sql.ts`.** `createTableBody` reads one statement, so it could
  only see columns a table was *born* with — and `public.vehicles` already
  exists, so this column can only arrive by `alter table`, and an applied
  migration is history (T2-301 tried editing one and reverted). Left alone,
  `schema-shape.test.ts`'s pending sweeps would have stayed red after the
  column shipped with no legitimate route to green. The new helper replays
  `create table` + `add`/`drop column` + `set`/`drop not null` + `set`/`drop
  default` in order; `isNotNullFor` and `isOptionalColumn` now read it too.
  **`profiles.handle` (T2-402) gets the same fix for free.**
  <br>**Verified, not assumed.** A scratch migration implementing the column,
  the check constraint and the departure-scoped trigger was applied to the
  migrations directory, the two `cover.ts` seam functions were temporarily
  implemented, and the whole suite re-run: **24 failures, every one of them an
  `it.fails` marker line that now passes, and zero unmarked controls moved.**
  Nothing else in the suite fired either — no anon-privilege,
  definer-`search_path` or ungraded-table sweep. Both scratch changes were
  reverted.
  <br>*Correcting the record (review F3):* the commit that first pushed this
  branch claimed the same experiment "moved nothing else in the suite". That
  was measured before the F2 fix and was an overclaim — **one** unmarked
  control did also go red, the flat absence assertion that F2 has since made
  branch-aware. The 10-marker half of that claim was right; "nothing else" was
  not. The number above (zero unmarked) is the post-fix measurement.
  <br>Eleven rule-level mutations were run one at a time — membership
  always-clean; the `before` clause; `isNullAssignment` always-true; the
  `set … =` assignment spelling; the `alter table` branch of
  `checkExpressions`; the `drop column` branch of `columnDefinitionFor`; the
  two halves of the departure-scoping clause (`consultsOld`,
  `scopedToSource`); the "cover not in the scope list" half of that clause;
  and both directions of `pendingMarkerIssues` — and each turned the suite red
  on exactly the controls that name it.
  <br>**One finding the activation simulation caught that review would not
  have.** Two of the controls written to *fix* the re-review's F2 residual
  used `cover_photo_path` itself as the "column the schema does not have" —
  reintroducing, inside the fix, the very defect being fixed. It surfaced only
  because the end state was simulated rather than reasoned about; both now use
  a synthetic `NEVER_SHIPPED_COLUMN` that is absent in every state. Worth
  repeating for any future `[TEST]` task: simulate the activation, do not
  argue it from the diff.
  <br>**Tier B:** could not be run in the authoring worktree (no Docker on
  that machine), so the 22 live markers were written blind there. The
  independent review ran them against a real stack — **822 passed, 243
  expected-fail, 0 failures** — and it is also how both F1 findings were
  caught, since three of these graders (`a path the vehicle does not have is
  refused`, `another vehicle's photo is refused`, `a vehicle with no photos
  cannot be given a cover`) fail loudly against an unscoped *or* a
  both-columns-scoped trigger. Tier A could not see either; Tier B saw both.
  That is the argument for promoting the `tier-b` job from informational,
  recorded here rather than acted on. No storage object is uploaded by any of them: the
  designation is a claim about two columns, and borrowing the bucket would
  make every cover grader depend on the storage API being up.
- [ ] **T2-306 [PLATFORM]** Cover-photo UI (owner-approved addition,
  2026-09-02): a "Set as cover" control per photo on the vehicle edit view,
  a "Remove cover" affordance, and rendering the designated cover — never
  just the first array entry — on the garage vehicle list card in place of
  the current text-only row. No showcase-page consumer yet (SHR-02 is
  unbuilt); design the render helper so T2-402 can reuse it without a
  second cover-resolution implementation. Activates T2-306a graders.
  Depends: T2-306a merged. *(GAR-01′)*
  <br>**Added mid-session (2026-09-02):** surfaced when the owner uploaded
  a real cover-candidate photo (a HEIC file, converted to JPEG by the
  conductor before upload since most non-Safari browsers cannot render HEIC
  directly — worth a passing thought for whoever builds this UI: does the
  upload path need to warn on or convert HEIC itself, rather than relying on
  every future photo happening to arrive pre-converted?) and there was
  nowhere on the site to designate it as anything more than one photo among
  several. The garage vehicle list currently renders no thumbnail at all for
  any vehicle — this task is also the first thing to put an image on that
  card.

## Phase P3 — Sharing

**Re-scoped 2026-08-31** by spec 002 §10 (typed share grants). SHR-05..09 add a
second principal to a phase that was written for one, and the instrument work
that implies is large enough to be its own task — hence T2-401a. T2-404 is new.
Read 002 §10 and `specs/003-shop-tools/spec.md` before starting any of these.

- [x] **T2-401a [TEST]** The instrument: grade functions and grants, not just
  policies. Split from T2-401 so it is reviewed as harness work rather than
  feature work — the T2-201/T2-202 rationale. Depends: T2-302. *(SHR-01, SHR-05..08)*
  <br>**Why this exists.** The recommended architecture for SHR-07 is a
  `security definer` function granted to `anon` — the only option that keeps
  `output: "static"` (001 SCF-01) and keeps the service key out of the repo. It
  is also the only option that moves enforcement onto a surface **with no
  graders at all**. `grep -rn "security definer" tests/` returns one hit and it
  is a comment. A definer function granted to `anon` doing
  `select * from public.records` produces **zero findings today** — verified by
  running the real graders against exactly that. This is the situation T2-201
  was created to end, and it must not be re-entered. **This task lands before
  any grant RPC exists.**
  <br>*What it must build:*
  <br>— a `functions()` parser in `tests/garage/sql.ts` mirroring `policies()`,
  **including grant replay**: name, signature, `security definer|invoker`,
  `set search_path`, body, and the **end-state** grant set after replaying every
  `grant`/`revoke` in file order;
  <br>— a **closed allow-list**: the set of functions executable by `anon` or
  `public` must *equal* the named share readers in `contract.ts`. Deny half
  enumerated, per the `KNOWN_EXTERNAL_PROVIDERS` standard already set in that file;
  <br>— every `security definer` function carries `set search_path = ''`
  (codifies what T2-202 already does in all four of its functions);
  <br>— the token triple as **three separate findings**: compares a hash and
  never a plaintext column, tests `expires_at`, tests `revoked_at`. Three,
  because they fail independently — a grant that validates the hash but skips
  `revoked_at` is a grant that cannot be revoked, and it is the likeliest defect
  in the whole feature;
  <br>— column projection, not row projection: reject `select *` and
  `returns setof public.records` in any anon-granted function;
  <br>— a probe corpus in `reviewer-probes.test.ts`, mutation-verified to that
  file's own standard: a definer function with no expiry check, one with no
  revocation check, one returning `select *`, one comparing the raw token, one
  missing `set search_path`. Break each rule on purpose; confirm the corpus goes red.
  <br>**Two live defects in the existing graders, found 2026-08-31, both fixed here.**
  <br>*(1) `revoke ... from anon` is counted, never replayed.*
  `rls-deny-by-default.test.ts` counts statements matching
  `^revoke ... from ... anon` and asserts the count is above zero. It never asks
  what the ACL is at the end. A directory containing
  `revoke all on public.records from anon;` followed by
  `grant select on public.records to anon;` **scores 1 and passes** — verified.
  `sql.ts` established replay discipline for policies for exactly this reason
  and it was never applied to grants. Second-order today (forced RLS plus no
  anon policy still yields zero rows); first-order the moment a grant RPC adds
  an anon-reachable surface. The `grants()` replay parser above fixes both at once.
  <br>*(2) Nothing enumerates the tables that actually exist.* Every table-level
  grader is driven from `contract.ts`; `userTablePolicyIssues` filters to
  `USER_TABLE_NAMES`. A fifth user table is **invisible** — verified: a `shares`
  table with `for all to anon using (true)` and no `force` yields zero findings.
  That contradicts AGENTS.md's "every user table ships with row-level security
  proven by graders before content flows". Fix with a `createdTables()` sweep
  cross-checked against `USER_TABLES`, with a named-exemption map in the style
  of `check-hreflang.mjs`'s `EXEMPT_PAGES`.
  <br>**Landed 2026-09-01** across two rounds. Round 2 added, on review: the
  `security_invoker` rule for views (PG15+ defaults it **off**, so a `public`
  view without it is the same hole class as a definer function); whole-row
  projection detection (`to_jsonb(r)`, `row_to_json(r)`, `jsonb_agg(r)`, bare
  `select r`, `alias.*` in any expression — each was a zero-finding bypass
  easier to write than the literal `select *` the rule already caught); and
  probes for the two tri-state halves that had none. 39 mutants, all killed.
  <br>**Recorded here for the T2-401 and T2-404 briefs — NOT implemented by
  T2-401a, and each is a deliberate scope hand-off rather than an oversight:**
  <br>— **(F5) Ban `alter default privileges … grant … to anon|public`.**
  `grants()` already parses and records every ADP statement, and the graders
  read the *revoke* half. Nothing yet rejects the grant half, which would hand
  every future object in `public` to an anonymous caller from one line in one
  migration — and it is the one privilege change that leaves no trace on any
  object that exists today, so the created-table and function sweeps cannot see
  it. One rule over `GrantState.defaultPrivileges`; belongs with T2-404's
  migration review.
  <br>— **A Tier A refusal-shape smell-check, alongside T2-401's Tier B
  SHR-08 proof.** SHR-08 requires unknown, expired, and revoked to be
  *indistinguishable* — "same status, same body, same shape" — which is
  genuinely behavioural and needs a running stack. But a weak Tier A proxy
  catches the likeliest mistake on every PR with no Docker: reject any
  anon-reachable routine whose body contains more than one distinct `raise`
  message, or any text matching `expired|revoked|not found`. It cannot prove
  the property and must not be described as if it does; it detects the
  mistake, which is a different and still useful job. Pair it with the real
  behavioural grader, never instead of it.
  <br>— **The three-reader architecture is endorsed**, but note what makes it
  real: `SHARE_READER_FUNCTIONS`' argument for three entry points over one JSON
  reader rests entirely on the projection rule. Before round 2 that rule caught
  only a literal `*`, so a single `to_jsonb(r)` reader would have satisfied
  every grader while defeating the argument for splitting them.
  <br>— **The limit of the projection rule, stated correctly.** It catches
  whole-row projection in every spelling tested, including inside a builder and
  inside a nested subquery. What it cannot do is enforce SHR-06's *capability
  scoping*: a fully-named `jsonb_build_object` that includes the cost columns is
  textually indistinguishable from legitimate projection. Where a grant does not
  open costs, that guarantee is carried by the capability check in the reader's
  body, not by any grader in this file — **T2-404's reviewer must verify it by
  reading.**

- [x] **T2-401 [TEST]** Sharing graders: private-by-default proofs at the URL
  level, per-record cost masking on public work-logs, showcase toggle
  round-trip, **and the typed grants of SHR-05..09**. Depends: T2-401a, T2-302.
  *(SHR-01..09)*
  <br>**Re-scoped 2026-08-31 and re-estimated — this is no longer the one-line
  task it was written as.** It grew from one principal (the world) to two, and
  it inherits SHR-02's handle work that T2-201 deferred here by name.
  <br>*Added scope:*
  <br>— declare `shares` in `USER_TABLES` — **and in the same commit** fix
  `harness-contract.test.ts`'s hard equality on the four table names and
  `deletion-cascade.test.ts`'s `CASCADE_HOPS` completeness guard, or the suite
  goes red for the wrong reason and someone "fixes" it by loosening a guard;
  <br>— **broaden `sharing-default.test.ts`'s negative sweep, which is
  name-shaped rather than semantics-shaped.** Its regex needs `is_` *and*
  `public|shared|visible` *and* `default true` all three, so a capability column
  like `includes_costs` — or an `is_active` — slips straight through the guard
  that exists to catch "a fifth flag this file does not know about". Verified
  both. Invert it: sweep every `boolean not null default true` in the migrations
  against a named allow-list;
  <br>— token delivery: no route under `src/pages/` takes a token as a path
  segment or search param; the client POSTs and never GETs it in a query string;
  `Referrer-Policy: no-referrer` on the share page (`vercel.json` has no
  `headers` block today — this is a file edit, not a setting);
  <br>— receipt signing: the signer never accepts a caller-supplied path; the
  three-cell matrix (own vehicle, other vehicle same owner, other owner); a
  signed-URL TTL ceiling of 60–300s, which is the *only* thing bounding a leaked
  signature; revocation cuts issuance immediately; `includes_receipts = false`
  refuses independently of `includes_costs`;
  <br>— SHR-09: a grant must not make a record eligible for GAR-04′ surfacing;
  <br>— **SHR-02's public handle**, assigned here by name in `contract.ts`:
  uniqueness under concurrent signup, case folding, whether `admin` and `api`
  are takeable, and what a handle change does to an already-published URL.
  *"This file's silence is not permission."*
  <br>**Two blind spots the T2-202 review found in the declaration tier. Both
  are for this task, and both are "verify, do not assume".**
  <br>*(a) An ACL probe.* Tier A reads migration **text**, so it can only see
  privileges someone wrote down — and the privilege that nearly shipped a hole
  was one **nobody granted**: Supabase's default privileges hand `authenticated`
  ALL on every new table in `public`, `grant select, insert, update, delete`
  *adds to* that ACL instead of replacing it, and **RLS does not filter
  TRUNCATE**. The reviewer emptied `profiles` as role `authenticated` against a
  schema whose 321 declaration graders were green. T2-202 fixed the schema
  (revoke before grant, per table and in the default privileges), but nothing
  *grades* it: a fifth table added later re-opens it silently. The grader has to
  ask the running database — `information_schema.role_table_grants` or
  `has_table_privilege` — that `authenticated` holds exactly
  `SELECT, INSERT, UPDATE, DELETE` on every user table and `anon` holds nothing.
  Behavioural tier, because an ACL is not a string in a file.
  <br>*(b) Join-semantics blindness.* `isOwnerScoped` judges whether a
  subquery *correlates*, not whether the correlation is **true**: a policy whose
  `exists` joins `on true` (or on the wrong pair of columns) passes Tier A
  intact, because the outer table's name does appear inside the subquery. What
  saved the shipped `records`/`receipts` policies is that RLS on `vehicles`
  applies *inside* the subquery as well, so a nonsense join still cannot reach
  another owner's row — defence that was inherited, not designed. Record it as
  **a property to verify rather than a property to rely on**: a behavioural
  grader that writes a deliberately mis-joined policy and proves owner B still
  reads nothing. If that ever stops being true, the declaration tier will not
  notice.
  <br>**Two defects in T2-401a's own projection rule, found in its round-2
  review. (c) is FIXED on the T2-401a branch; (d) remains for this task.**
  <br>*(c) `rowAliases` under-bound, so whole-row projection escaped.* **Fixed
  2026-09-01.** The old single regex matched only relations introduced by
  `from`/`join` and its optional alias group could swallow a following `join`,
  so two shapes bound the wrong set and the whole-row projection over the
  unbound relation produced **zero findings** — both confirmed against the
  shipped rule: `from public.records r, public.shares s` bound only `r` (so
  `select to_jsonb(s)`, a whole-row leak of the grants table, was silent), and
  `from public.records join public.shares s on …` bound only `records`.
  <br>The `from` list is now parsed rather than pattern-matched — split on
  top-level commas, each item read as optional prefix / relation or
  parenthesised subquery / optional `as` / alias refused if it is a keyword —
  and every `from` and `join` is scanned at any nesting depth. **The guarantee
  now covers comma joins, unaliased relations, `as` aliases, `lateral`, and
  subquery aliases**, in addition to the single-relation and aliased-`join`
  bodies it always covered. A third shape the reviewer raised, the subquery
  alias, was previously caught only when the subquery happened to contain a
  literal `*`; it is now caught on its own merits and pinned with a fixture
  that contains no `*` at all. Nine mutants over the new clauses, all killed.
  <br>*(d) No accept-case control on the `setof` rule.* `returns setof
  <user table>` is rejected and pinned, but nothing asserts that
  `returns setof <non-user-table>` — a composite type, a view, a domain — is
  *accepted*. The rule could become over-strict and reject a legitimate return
  shape with no test noticing, which is the direction that gets a security rule
  deleted rather than fixed. One fixture closes it.
  <br>**Landed 2026-09-02.** Six new grader files (`share-grants`,
  `share-delivery`, `receipt-signer`, `handles`, `public-pages`, plus the two
  behavioural ones below), six new rules in `rules.ts`, three seam modules under
  `src/lib/garage/` (`visibility`, `handles`, `share-link`), and `shares` +
  `profiles.handle` declared in `USER_TABLES` behind a new `pending` marker so
  every existing `it.each` sweep partitions instead of going red without a
  marker. 15 mutants over the new rules, all killed. **Two findings the task
  did not anticipate:**
  <br>*(b) is worse than recorded — the inherited defence does not exist.* The
  review's note assumed RLS on `vehicles` would save a mis-joined policy.
  Verified against the running database: it does **not**. A policy reading
  `exists (select 1 from public.vehicles v where records.vehicle_id is not null
  and v.owner_id = auth.uid())` passes `isOwnerScoped` intact **and lets owner B
  read owner A's records** — because RLS filters the subquery to B's own
  vehicles, so `exists` degenerates into "does B own anything". Closed at both
  tiers: `subqueryCorrelationIssues` (Tier A, requires the join to use the
  contract's declared ownership column) and `policy-join-semantics.test.ts`,
  which asserts the leak on a replica of the shipped shape so the property stays
  recorded rather than assumed.
  <br>*A live-target hazard in the Tier B harness — **found, then closed**.*
  The Supabase CLI gives every project the same default ports, so
  `127.0.0.1:54321/54322` is whichever checkout started first — observed on this
  machine, where an unrelated project held them. `assertLocalTarget` answers "is
  this my machine", not "is this my project", and the PostgREST tier creates and
  **deletes** accounts using a `service_role` JWT minted from the CLI's
  *published default secret*, which a foreign local stack shares. Confirmed
  live: that token was accepted by the other project's PostgREST (200) and
  enumerated its tables. `detectLiveStack` now fingerprints the stack before any
  grader provisions anything, and refuses with a named reason. Both directions
  proved against real stacks — refuses the foreign one, runs against the
  genuine one. The fingerprint is deliberately asymmetric (it refuses only on
  positive evidence of a different schema, never on silence) because an
  anon-role probe enumerates nothing against a correctly locked-down project,
  and a guard that read silence as "wrong project" would have switched the whole
  behavioural tier off invisibly.
  <br>**Round-2 review fixes (2026-09-03).** An independent review confirmed
  blind spot (b) three ways and found seven defects, all now closed:
  <br>— **F1 (high).** `parseRoles` did not strip identifier quotes, so
  `grant select on public.records to "anon";` — valid SQL, and the exact
  vulnerability shape T2-401a exists to catch — was recorded as the role
  `"anon"`, matched nothing, and produced **zero findings** from every rule
  built on the grant replay, T2-401's own new ADP rule included. One-line root
  fix; six probes, one per call site that names a role.
  <br>— **F2 (high).** `capabilityGateIssues`' third clause — the only detector
  for SHR-06's "receipts gated behind costs" collapse, the cell these files call
  the one that matters most — had no probe at all and could not fail. Reject and
  accept fixtures added, plus its real limit stated and pinned.
  <br>— **F3.** Three incompatible `revoke_share_grant` signatures across the
  branch; PostgREST resolves overloads by argument name, so the central SHR-08
  proof was revoking nothing and would have compared a live grant against two
  refusals. Argument lists are now contract (`SHARE_CREATE_ARGUMENTS`,
  `SHARE_REVOKE_ARGUMENTS`) and one module builds every payload. **Revocation is
  pinned per-grant, not per-vehicle** — SHR-08 says "every grant … by its
  issuer", and revoke-all is a different operation the spec does not ask for.
  <br>— **F4.** SHR-07's Tier B write proof called an RPC named `records`, which
  cannot exist, so it was unfalsifiable. It hits the table now, and asserts the
  row is unchanged as well as the response refused.
  <br>— **F5.** Three signer success cells never uploaded the object they asked
  to sign.
  <br>— **F6.** Tier B flakiness **was** partly this branch's: the server's own
  report named the cycle — this tier's DDL against `auth.users` versus GoTrue
  inserting an identity. Deadlock is transient by definition, so the transaction
  wrapper retries it. Measured: 2 red in 5 before, **9 green in 10** after.
  Residual, and explicitly *not* claimed fixed: about 1 run in 10 still fails in
  pre-existing suites under full parallel load (RLS rejections during
  provisioning, GoTrue's side of the same contention). That belongs to whoever
  promotes `tier-b` from informational to required.
  <br>— **F7.** A positive control did not reach the clause it controlled;
  `canonicalizeAuthUid` normalised the fixture before the escape ran. Replaced
  with a row-self comparison beside a genuine subquery, plus its negative pair.
  <br>— **F9/F10.** Two comments over-claimed: the reserved list is
  cross-checked against `src/i18n/routes.ts`, not computed from `src/pages/`
  (which holds only dynamic segments), and handle uniqueness is proved
  sequentially — enough to show the constraint is in the schema, not a
  concurrency proof. Both corrected in place rather than quietly dropped.
  <br>— **F11 (process, for T901/T902).** Every commit on this branch carries
  the same git author as T2-201 and T2-401a, so separation-by-authorship is not
  traceable through `git log` alone; the `X-Agent-Role` trailer is the only
  in-repo signal.
  <br>*Corrected claim:* the first round said "15 mutants, all killed". True of
  the 15 written, but the battery did not cover every clause separately as
  GRADER-PRINCIPLES requires — F2 and F7 are the proof.
  <br>**Round-3 review fixes (2026-09-03).** A second independent review
  reproduced every round-2 fix, including running the F8 guard live against the
  foreign stack in both directions, and found three more — all of the same
  shape: *the guard can be deleted and the tests stay green*.
  <br>— **M1. F8's detection logic was graded; its WIRING was not.** Two mutants
  survived: deleting the refusal branch, and probing as `anon` instead of
  `service_role`. The second is the nastier one — an anon probe enumerates
  nothing against a correctly locked-down project, so one word silently
  disables the entire wrong-project guard. `detectLiveStack` is now split into
  a pure `liveDecisionFrom` plus an injectable observer, so the refusal path and
  the probe role are both assertable without a stack. Five wiring mutants,
  including the reviewer's two verbatim, all killed.
  <br>— **M2. SHR-06's "cell that matters most" could pass while broken, and my
  documented limit was wrong.** Round 2 guarded the collapse clause with
  `!mentionsCosts` and called a both-kinds reader "off-architecture, therefore
  somebody else's problem". The reviewer disproved it with a reader using the
  contract's own approved name and one extra column: zero findings from all
  seven Tier A rules, because the closed allow-list checks the function *name*.
  It is a rule now, and a total one: one query has one predicate for one result
  set, so no gating of that shape can serve a `costs=false receipts=true` grant.
  Tier B was equally weak — a broken reader returning `200 []` satisfied
  `ok === true` — so the open cells assert rows came back.
  <br>— **M3. A "row unchanged" assertion was vacuously passable.** A failed
  read-back left `rows[0]` undefined and `undefined).not.toBe(999_999)` passes.
  The identical unknown-coalesced-to-zero mistake AGENTS.md names, in a file
  whose own `refusalShape` uses a `-1` sentinel to avoid it.
  <br>— **F-D/F-E (recorded, and fixed anyway).** A probe row reached its clause
  only through a neighbouring pattern, and the revocation deny-list had one
  probe for seven entries. F-F..F-K were documentation-only.
  <br>*Final battery:* **45 mutants, one per clause plus the wiring, all
  killed.* Tier B could not be re-soaked in round 3 (Docker down on the
  machine); the changed Tier B lines sit inside `it.fails` markers that cannot
  execute until T2-404 activates them, and the Tier A/pure paths are covered by
  the battery.
  <br>**Grader correction 2026-09-05 — `gitana` was graded both ways at once.**
  The T2-402 code review found `handles.test.ts` asserting
  `handleIssues("gitana") === []` (claimable by anyone) while `contract.ts`
  already listed `gitana` under its impersonation heading. Both cannot hold,
  and as things stood the *positive control* was the operative one: `gitana`
  was claimable. The reservation survives — MIG-04 makes Gitana Blanca user
  page #1 and the template every other garage is shaped by, so on
  monterogarage.com `/en/garage/gitana/` is the same impersonation surface as
  `montero`, which sits beside it in that list; and `contract.ts`'s own
  asymmetry argument (un-reserving later is safe, reserving later is not)
  decides ties like this. Reserving the word is not denying the owner the
  name: `handleIssues` gates *self-service claims*, MIG-04's seeding is a
  migration, and the display name's handle form `gitana-blanca` stays
  unreserved. **Grader-only change** — `contract.ts` was already correct and
  was not touched.
  <br>*Fix:* `blanca` replaces `gitana` in the claimable table (same "plain
  alphabetic word" shape, so no control was lost); `gitana` and `montero` join
  the reserved-rejection table and the Tier B database probes; the fixture
  lists are hoisted to `CLAIMABLE_FIXTURES` / `RESERVED_FIXTURES` and
  cross-checked against `RESERVED_HANDLES` in both directions, because the
  contradiction was only possible while the two lists were inline literals in
  blocks that never met. **5 mutants, all killed** — including one that
  restores the original defect verbatim. Documented limit: de-deriving the
  rejection table from `RESERVED_FIXTURES` silently shrinks it rather than
  going red; the derivation is what buys the guarantee.
  <br>*Owed by T2-402:* `gitana` (and `montero`) must reach the hand-written
  impersonation list in `handles.ts` **and** the SQL check constraint. Two
  open questions for the owner are in that branch's report: whether a
  reserved-word check constraint needs a seed/admin path for MIG-04's own
  profile, and whether `gitana-blanca` should be reserved too.
- [ ] **T2-402 [PLATFORM]** Showcase + work-log public pages: stable handle
  URLs, per-vehicle toggles, per-record/per-field visibility, HANDOFF-DESIGN.md
  chrome, hreflang. Activates T2-401. Depends: T2-401 merged, T2-303. *(SHR-02..04)*
  <br>**Amended 2026-08-31:** the per-record cost-masking logic must be
  **parameterised by principal**, not written once for "the public". T2-404
  needs the same masking for a different audience, and a second copy of a
  privacy rule is a second place for it to drift.
  <br>**Partly landed 2026-09-05, and deliberately left unchecked.** Four of
  the five deliverables shipped; the fifth — the public *pages* themselves — is
  blocked on a decision that is not an implementer's to make, so the box stays
  open rather than being ticked on four fifths.
  <br>*Shipped:* the principal-parameterised masking (`src/lib/garage/
  visibility.ts` — `maskRecordForPrincipal`, `maskRecordsForPrincipal`,
  `visibleReceipts`, `isEligibleForCommunityEvidence`, over an `owner | world |
  grant` union, so T2-404 adds a principal and not a code path); SHR-02's handle
  as a *namespace* (`src/lib/garage/handles.ts` plus
  `20260903120100_public_handles.sql`: folded on write by a trigger, unique on
  `lower(handle)`, reserved words in a check constraint, and `retired_handles`
  so a renamed owner's old URL cannot be inherited by a stranger); the
  per-vehicle and per-record/per-field toggles on `/en/garage/` + `/es/taller/`.
  **50 of T2-401's markers activated** (`handles.test.ts`,
  `public-pages.test.ts`, and `profiles.handle` promoted out of `pending` in
  `contract.ts`): 687 → 735 passing, 161 → 111 expected-fail.
  <br>*Blocked, and this is the finding:* **there is no anonymous read path in
  this schema, and T2-402 may not add one.** SHR-01 names "the public
  visibility columns of SHR-02" as one of the three enforcement modes, but
  `rules.ts`' `policyIssues` rejects any policy naming `anon`/`public` or whose
  `using` is not owner-scoped — correctly — so the columns cannot be expressed
  as RLS. The only remaining permitted shape is a `security definer` function
  granted to `anon`, and `share-instrument.test.ts`'s **unmarked** grader "no
  routine outside the declared share readers is anon-executable" holds that set
  *equal* to `SHARE_READER_FUNCTIONS`. Adding a fourth entry is widening a
  security allow-list in a grader's contract, which is a test-writer's edit and
  not an implementer's. Until that decision lands, a public page at
  `/en/garage/<handle>/` could render chrome and never data — and a page that
  renders "nothing here" when the truth is "no reader exists" is the
  failure-is-not-a-zero mistake AGENTS.md names.
  <br>*Recommended resolution, for whoever picks it up:* fold the public reader
  into T2-404, which is already building exactly this machinery (definer RPC
  granted to `anon`, tables keep `revoke all … from anon`). One reader — the
  world is a principal with no token, and `visibility.ts` already models it —
  costs one contract entry reviewed beside the migration, instead of two.
  <br>*Also found (not patched):* `contract.ts`'s `RESERVED_HANDLES` lists
  `gitana`, and `handles.test.ts`'s own positive control requires
  `handleIssues("gitana")` to return no issues. Both cannot hold. The control is
  the one that is right — Gitana Blanca is a *user's* truck (MIG-04), not the
  site's identity — so `handles.ts` and the migration leave the handle
  claimable and the grader's list is left for an independent session.
  <br>*Judgment call recorded:* `profiles.handle` is declared **twice** — in the
  original `create table` and again as `alter table … add column if not exists`.
  A column added only by an `alter` is invisible to `createTableBody`, which is
  what every contract shape grader reads, while an existing database will never
  re-run the first migration. Both paths converge; every rule lives in the new
  file, once.

- [ ] **T2-404 [PLATFORM]** Typed share grants: the `shares` table, create and
  revoke RPCs (authenticated), the anon read RPCs, the Edge Function receipt
  signer, and the accountless share page at a per-locale slug. Activates the
  T2-401a and T2-401 grant graders. Depends: **T2-401a merged**, T2-401 merged,
  T2-402. *(SHR-05..09)*
  <br>Kept out of T2-402 deliberately: this is a new trust boundary and it gets
  its own review rather than riding in behind the public pages.
  <br>*Architecture, decided 2026-08-31 — see 002 §10 and the plan record:*
  <br>— **`security definer` RPC granted to `anon`**, tables keep
  `revoke all ... from anon`. No new RLS policy is owner-unscoped, so
  `rules.ts` needs no amendment. Chosen over a scoped-JWT scheme (which would
  require loosening `isOwnerScoped`, the most load-bearing function in the
  harness) and over an SSR route (which would need `@astrojs/vercel`, break
  001 SCF-01, drop the route out of `dist/` and therefore out of
  `check-hreflang`, `check-a11y`, and Lighthouse, and require a service key in
  Vercel that `src/lib/supabase/config.ts` structurally refuses).
  <br>— **Receipts: an Edge Function that signs and does not decide.** A
  Postgres function cannot mint a Supabase signed URL — signing is a storage-api
  operation, which is the same wall T2-202 hit for purging receipt *bytes*. The
  function takes `{token, receipt_id}`, calls the anon RPC to validate and
  resolve a path, and signs only that path. Authorization stays in Postgres
  where the graders reach it. **This is the same Edge Function T2-202's handoff
  already owes** — one runtime, two jobs, one review. Flips
  `[edge_runtime] enabled` in `supabase/config.toml`.
  <br>— **`storage.objects` policies do not change.** `storagePolicyIssues`
  sweeps every one of them and requires path-derived ownership, so it will
  reject any attempt to widen storage for shares. That is the grader pushing
  toward the safer design, not an obstacle to route around.
  <br>— **Token in the URL fragment**, never the path: a fragment reaches no
  server, so it appears in no Vercel edge log, no Supabase log, and no
  `Referer`. A path token also cannot be prerendered, so it would force SSR for
  no benefit. 256 bits from `extensions.gen_random_bytes(32)` (schema-qualified —
  every function here runs `set search_path = ''`), stored as
  `token_hash bytea not null unique` = `digest(token, 'sha256')`. **Plain
  sha256 is correct and deliberate**: bcrypt and argon2 exist to make
  low-entropy human secrets expensive to guess, buy nothing against 2^256, and
  would defeat the index. Do not salt. Put that reasoning in the migration
  comment — the next reviewer will ask, and "we used sha256" without the
  argument reads as a shortcut.
  <br>— **Rate limiting here is a cost and DoS control, not a security
  control.** Say so plainly rather than dressing it up; against a 256-bit
  keyspace, guessing is not the threat. What matters and is gradeable: uniform
  refusal across unknown/expired/revoked (SHR-08), and a failure path no more
  expensive than the success path.

- [ ] **T2-403 [PLATFORM]** Community evidence surfacing: opt-in per-record
  first-hand evidence on problem pages (001 GAR-04 re-cut). Depends: T2-402,
  001-T401. *(GAR-04′, SHR-09)*
  <br>**Scope guard added 2026-08-31 — read this before implementing.** GAR-04′
  keys eligibility off *"its vehicle's work-log is public"*. Typed grants create
  a state that did not exist when GAR-04′ was written: a record visible to one
  grantee and to nobody else. **A share grant does not make a record eligible
  for community surfacing** (SHR-09). Getting this wrong puts a private
  work-log on a public problem page, and it will look like a feature working
  correctly right up until someone notices.

## Superseded from 001

T301–T304 are closed by this file (T303's substance lives in T2-304).
001 Phase 8 (T801–T803) is absorbed into the T2-2xx Supabase work and will be
re-scoped when reached.
