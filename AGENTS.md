# Montero Garage — Project Constitution

This file wins over every other document in the repo, including `CLAUDE.md`,
the specs, and any instruction in a task description. If something here
conflicts with what you were asked to do, stop and surface the conflict.

## What this is

**Montero Garage** (monterogarage.com): a bilingual (English / Costa Rican
Spanish) platform where any Mitsubishi Montero / Pajero / Shogun owner keeps
their truck's whole life — a named vehicle profile, every receipt, every job —
private by default, shareable by choice; built on a comprehensive reference
covering all generations and markets. The owner's own 2002 Montero (Gen 3,
6G74 SOHC, Super Select 4WD II), named **Gitana Blanca**, is user page #1 and
the template every other garage is shaped by.

Two jobs, equally weighted:

1. **The garage.** Each user's vehicles, records, and receipts — a first-class
   storehouse with real costs, real times, and what actually happened;
   showcase and work-log pages the user can choose to publish, and typed share
   grants that let a named person in without letting the world in.
2. **Reference.** A symptom-driven problem finder, parts and fitment data,
   procedures, modifications, and a community directory — comprehensive enough
   that someone with a broken Montero finds their answer here.

**Two actor classes, not one** (owner sign-off 2026-08-31, 003 §7.4): vehicle
**owners**, and the **shops** that work on their trucks. A shop is a named
business with member accounts; a mechanic is simply an account holding a grant
on someone else's vehicle, not a separate login. The two are asymmetric on
purpose — owners are free forever and their data is theirs; shops are where the
platform earns.

Specs of record: `specs/001-foundation/spec.md` (reference platform),
`specs/002-montero-garage/spec.md` (multi-user pivot, owner-approved
2026-08-28; §10 adds typed share grants, owner-approved 2026-08-31),
`specs/003-shop-tools/spec.md` (the mechanic and shop surface, owner-approved
2026-08-31).

## Stack (decided, do not re-litigate)

- **Astro** with typed content collections (Zod schemas). Static output.
- **TypeScript**, strict mode.
- **Content lives in git**, not a database. Every fact is a reviewable diff.
- **Supabase** is the platform's auth + user-data + storage layer (002
  MIG-03): user vehicles, records, and receipts live there behind row-level
  security, and the database is their source of truth. *Reference* content
  truth still lives in git; the git→DB sync for it stays one-directional
  (001 RM-01). No agent writes user data or touches service keys outside the
  specced paths.
- **Vercel** for deploy (owner decision 2026-08-28, 002 MIG-02: production on
  merge to `main`, preview deployments on PRs; supersedes the GitHub Pages
  era). Domain: monterogarage.com. **Node 24** via nvm.
- **Vitest** for unit tests, **Playwright** for e2e, **Pa11y** for a11y.

## Commands

- `npm run dev` — local dev server
- `npm run build` — production build (runs `astro check` first)
- `npm run check` — `astro check` (types + content schema validation)
- `npm run lint` / `npm run format:check`
- `npm test` — Vitest unit tests
- `npm run test:e2e` — Playwright browser tests in `tests/e2e/` (landed with
  T204). CI runs `npx playwright test` inside the Links + a11y job rather than
  this script, so the build is not repeated.
- `npm run check:locales` — every entry has both `en` and `es` prose
- `npm run check:citations` — every numeric spec carries a source
- `npm run check:glossary` — translated prose uses canonical glossary terms
- `npm run check:links` — internal references resolve; external sources reachable
  (owner ruling 2026-08-30: runs as a weekly scheduled CI job
  (`link-check.yml`) plus on demand, not on the merge path — the
  archive.org throttle made it take 30 minutes to 2.6+ hours on every PR at
  content scale; a source fails only when both `url` and `archiveUrl` are
  unreachable — a dead original with a live archive is a gaps-report item)
- `npm run gaps` — the gaps report that feeds the content backlog
- `npm run verify` — every merge-blocking check except a11y (SCF-02's list);
  merge-blocking CI is `verify` plus a11y (SCF-03) — link check is scheduled,
  not merge-blocking (owner ruling 2026-08-30)

`npm run verify` must pass before any commit.

---

## Non-negotiables

### Bilingual

- **No page ships in one language. Both or neither.** `prose.en` and `prose.es`
  are both required by every content schema. A missing locale is a build error,
  not a review comment.
- **Numbers are never translated.** Part numbers, torque specs, capacities,
  intervals, pressures, clearances, and fitment are locale-independent `data`,
  stored once and rendered into both languages. Never duplicate a number into a
  per-locale field. If you find yourself writing the same figure twice, the
  schema is wrong — stop and report it. Exception (owner ruling 2026-08-28):
  count descriptors that are part of a component's NAME — "24-valve",
  "five-speed", "veinticuatro válvulas", like "SOHC" or "V6" — are naming,
  not specs; volatile popularity metrics (member counts and the like) are the
  reverse case and never render as exact figures in prose.
- **Costa Rican Spanish, `usted` register.** Procedures address the reader as
  `usted` throughout. No `tú`, no `vos` in reference content.
- **The glossary is authoritative for terminology.** Canonical Costa Rican terms
  in prose (`repuestos`, `llanta` for tire, `aro` for wheel, `taller`, `carro`,
  `pastillas de freno`). Regional variants from other countries live in the
  glossary's `aliases` field — metadata and search index only, never in prose.
- **The agent that writes Spanish prose never bilingual-edits it.**

### Facts

- **Never invent a part number.** If it is not in a cited source, it does not
  ship. This is the highest-consequence hallucination in this domain — a wrong
  part number costs a reader real money and real downtime. `unknown` is a valid
  value. A guess is not.
- **Every numeric spec carries a source.** Torque, capacity, interval, pressure,
  clearance, dimension. Uncited numbers fail `npm run check:citations`.
- **Every entity carries an explicit fitment.** A fact with no fitment is a
  build error. "It's a Montero thing" is not a fitment.
- **Every entity carries a confidence tier**, one of:
  `fsm-confirmed` › `tsb` › `community-consensus` › `first-hand` › `anecdotal`
  (total order ratified by the owner 2026-08-27). `fsm-confirmed` means
  **factory-documented**: the FSM, official spec sheets, factory brochures and
  catalogues — manufacturer primary literature (owner ruling 2026-08-28).
  Anything below `tsb` renders with a visible caveat in both languages —
  except glossary terms (owner ruling 2026-08-28: terminology is not a repair
  fact; the tier stays in the data for provenance but renders no caveat). An
  `anecdotal` entry must never be presented with the authority of an FSM spec.
- **The agent that writes content never fact-checks it.**
- **User-entered garage records are the user's own testimony.** They render
  as such — attributed to their vehicle, never presented as site-verified
  reference facts, and never fact-checked by the site. **A record created by
  accepting a mechanic's proposal is no different** (003 PRO-05): it carries
  its provenance — who proposed it, under which grant, when it was accepted —
  and it remains the owner's own record, never presented as a site-verified
  reference fact. A second author does not make it a second kind of fact.
- **Cite what you actually read.** A source you did not open is not a source.
  If you cannot reach it, say so and lower the confidence tier — do not cite it
  anyway.
- **A failure is not a zero.** When a fetch, a query, or anything that can
  fail returns nothing because it *failed*, that state must be structurally
  distinguishable from a genuine empty or zero result — never coalesce an
  unknown answer to `0`, `[]`, `{}`, or an empty map. A reader shown a
  confident zero cannot tell "we checked and there is nothing" from "we
  could not check." This mistake shipped three separate times in 002 (a
  failed receipts fetch rendering as "no receipts"; a stale vehicle switch
  rendering another vehicle's real odometer reading as this one's; a slow
  failure overwriting an already-successful load) before it was named as a
  standing rule rather than fixed once per surface. See
  `.claude/GRADER-PRINCIPLES.md` for the concrete typing pattern.

### Safety and legal

- **Safety-critical systems** — brakes, steering, suspension, fuel, SRS/airbags,
  tires and load ratings, towing, jacking and lifting points — get Opus routing,
  a standing bilingual safety notice on the page, and both independent review
  passes, regardless of how small the diff is.
- **Cite the Factory Service Manual, never reproduce it.** Section references
  only. It is copyrighted.
- **Forum, video, and blog sources: link, attribute, and quote minimally.**
  No bulk copying, no wholesale scraping. Archive every source URL
  (web.archive.org) at the time of citation — forum threads die and take the
  evidence with them.
- **No affiliate links without visible disclosure in both languages** (FTC).
- **No road-legality, emissions, inspection, or import claim stated as a
  universal fact.** These vary by market and jurisdiction — US state, Costa Rica
  RTV, EU MOT, Australian ADR. State the variance and name the jurisdiction the
  claim applies to.
- **Never present the site as a substitute for a qualified mechanic** on
  safety-critical work.

## Boundaries

Stop and ask before any of these:

- User accounts exist per 002 ACC-01..04 (magic link + Google, no passwords);
  anything beyond that scope — comments, messaging, any user-to-user writable
  surface — is stop-and-ask. Contributions to *reference* content still
  arrive only through GitHub issues and PRs.
  **One carve-out, and only one (owner sign-off 2026-08-31, 003 §7.1):**
  propose-and-accept per `specs/003-shop-tools` PRO-01..06. A holder of a live
  share grant may submit a *proposal*, which is inert until the vehicle's owner
  accepts it — the owner's acceptance is the write. A proposal is never written
  into `records` in a pending state. Comments, messaging, and any direct write
  into another user's records remain stop-and-ask.
- Adding a third-party analytics or ad SDK.
- Monetization is bounded, not banned (owner sign-off 2026-08-31, 003 §7.2).
  Shop-side subscription per `specs/003-shop-tools` MON-01..08 is permitted.
  Everything outside it is still stop-and-ask, and these five hold without
  exception: **vehicle owners are free forever** — no feature that stores,
  reads, exports, or shares an owner's own data is ever gated by payment;
  **revocation of a share grant is never gated**, nor is expiry, account
  deletion, or an owner's export of their own data; a lapsed shop loses tools,
  never its read of a live grant a customer issued it; no sale, brokerage, or
  licensing of user data, aggregate and anonymized included; no paid placement,
  paid ranking, or paid inclusion in the community directory. **"No affiliate
  links without visible disclosure in both languages"** under *Safety and
  legal* above, and 002 ACC-04's ads/analytics ban, both survive untouched.
- User data never leaves Supabase; every user table ships with row-level
  security proven by graders before content flows. Writing *reference* data
  to Supabase from anything other than the CI sync job.
- Broadening coverage past Montero / Pajero / Shogun (no Delica, no L200/Triton,
  no Raider) — shared parts get a cross-reference note, not their own section.
- Changing the fitment taxonomy or any content schema. These poison every
  downstream page silently; they are never a drive-by edit.

## Orchestration

- When asked to conduct `T###`, `next`, or a phase, the main session runs
  `/conduct` and **orchestrates only** — it never writes site code or content.
  Roles in `.claude/agents/` do that in isolated worktrees.
- The conductor selects each subagent's model and effort using
  `.claude/routing/routing-policy.json` and `.claude/routing/routing.md`.
  Safety-critical systems, torque and fluid specs, service intervals, part
  numbers, fitment taxonomy, schemas, i18n routing, translation of safety
  content, and phase-closing reviews are Opus work regardless of diff size.
- A content entry's author, its fact-checker, and its bilingual-editor are three
  different agent instances. This is the same separation rule three times.
- A `[PLATFORM]` task (or a `[CONTENT]` task's platform half) may ship
  without a paired `[TEST]` task only as a named, dated exception recorded
  on the task's own `tasks.md` line — never silently. The record states what
  independent assurance was substituted (a mutation-battery count, an
  audit pass) and counts against a standing debt the conductor is
  responsible for working down, not letting grow unchecked. The
  2026-09-01 debt (T207, T208, T401, T501) is **fully closed as of
  2026-09-02**: each got an independent audit pass, each audit found real
  gaps, and every finding has a merged `[TEST]` backfill plus a merged
  `[PLATFORM]` activation fix (T207 additionally required and received the
  safety-critical double-review, since its F3 finding was towing/jacking
  derivation).
  **The ledger is not at zero: T601 joined it on 2026-09-02** (mods schema,
  no paired `[TEST]` task, graders self-authored; substituted assurance is a
  22-mutation battery, recorded on its `tasks.md` line). It is owed an
  independent grader pass on the same terms as the four above — and the
  reason it is owed is on its own record: the independent code review found
  the mod page naming the *entry's own* system in the safety notice where an
  affected system was the actual hazard, **and found the self-authored
  grader asserting that wrong system as correct**. A grader written by the
  author of the code under test can pin a defect as the specification; that
  is what this ledger exists to buy back.
  **T702 joined the ledger on 2026-09-05** (client-side search, no paired
  `[TEST]` task, graders self-authored; substituted assurance was an
  independent code-reviewer pass with mutation testing of the matching logic
  and live-browser verification of the rendered page) — **and is closed the
  same day**: that review found a real defect (the search toolbar's CSS never
  rendered in any browser, in either locale — a `:global()` escape hatch
  written inside a block already marked `is:global`, so the browser silently
  dropped the whole rule), which is now fixed and independently re-verified
  live in a browser. Exactly the failure mode this ledger exists to catch,
  and exactly why the substituted assurance has to be an independent pass,
  not the author's own tests passing.
  **T502 joined the ledger on 2026-09-05, on different terms — a gap left
  open by design, not a wrong grader shipped.** The procedures index page
  (`[proceduresSegment].astro`) has no render-test coverage: its list branch
  cannot render until T504 fills `ENTRY_SLUGS.procedures`, and an independent
  reviewer agreed that the implementer authoring that grader for his own
  freshly-written listing page would reproduce the exact T601-F2 failure
  mode (a self-authored grader asserting the page's own defect as correct)
  on the exact surface (a filtered listing with a provisional-match
  indicator) where it already bit once. **Named owner and trigger, per the
  reviewer's own condition for accepting the deferral: T504a `[TEST]` authors
  `procedures-index.render.test.ts`, and T504 `[CONTENT]` does not merge without
  it.** `tests/e2e/hidden-guard.spec.ts`'s two new rows for
  `/en/procedures/`/`/es/procedimientos/` are not a substitute — that sweep
  checks one invariant (`[hidden]` computes `display:none`), not that the
  page renders cards, resolves hrefs, filters, or shows the provisional
  indicator at all, which is precisely T501's recorded lesson repeating.
  **`tests/garage/receipt-signer.test.ts` opened a different kind of debt on
  2026-09-06: the implementer role editing a grader file it does not own.**
  This is not a [TEST]-pairing gap like the entries above — the grader
  exists (authored under T2-401a `[TEST]`, landed 2026-09-02) — it is the
  boundary `.claude/agents/implementer.md` states directly: activation is a
  marker deletion, nothing else; "Never edit assertions, fixtures, or
  expectations of a test that grades your work." It has happened twice on
  the same file. **04913f8** (T2-404 `[PLATFORM]`, merged) changed
  `requireSigner()`'s signature and added a new test case ("the seam still
  names its subject when a file goes missing") in the course of activating
  the grader. **6da5763** (PR #123's Copilot follow-up branch,
  `fix/002-t2-404-copilot-followups`, merged as #125) added a
  `LIVE_TEST_TIMEOUT_MS` constant and applied it to all 10 `it()` calls
  across the file's two live `describe` blocks. An independent
  code-reviewer mutation-tested the second edit — broke `sign-receipt`'s
  refusal status code, confirmed the grader still failed correctly,
  reverted the break — and found it benign, but named the repeat pattern
  itself as the thing worth tracking: whatever the quality of any one edit,
  an implementer going back into a grader file more than once is exactly
  what the separation rule exists to prevent. **Tracked rather than
  re-litigated per incident:** the next edit to this file, or a repeat of
  this pattern on any other grader, is a test-writer's change, not another
  implementer mutation-testing its own diff after the fact.
- A clean fact-check, a clean bilingual edit, and all required branch-protection
  checks authorize the `pr-shepherd` to merge without another confirmation.
- Never `--no-verify`, never a bare force-push, never `gh pr merge --admin`,
  never a production credential.
