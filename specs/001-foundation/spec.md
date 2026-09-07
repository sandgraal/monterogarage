# Spec 001 — Gitana: Bilingual Montero Platform Foundation

**Status:** Active · **Written:** 2026-08-27
**Constitution:** `AGENTS.md` (wins on conflict)
**Companions:** `plan.md` (build strategy), `tasks.md` (task breakdown)

Product decisions confirmed in the 2026-08-27 kickoff interview with the owner.
Decisions made after kickoff are recorded inline at the requirement they
affect, with a date. Acceptance criteria use EARS notation (WHEN/WHILE/IF-THEN/
WHERE/ubiquitous SHALL); each criterion is a single testable claim and maps to
at least one task in `tasks.md`.

---

## 1. Overview

Gitana is a bilingual (English / Costa Rican Spanish) static site with two
equally-weighted jobs: the complete build log of one 2002 Mitsubishi Montero,
and a comprehensive Montero/Pajero/Shogun reference — symptom-driven problem
finder, parts and fitment, procedures, modifications, and community directory —
covering all generations (1982–2021) and global markets.

v1 is read-only. Community contributions arrive via GitHub issue templates and
PRs. Accounts, comments, and submissions are explicitly out of scope (§9).

## 2. Definitions

| Term | Definition |
|---|---|
| **Generation** | Gen 1 (L040, 1982–1991) · Gen 2 (V20/V40, 1991–2000, incl. Gen 2.5 facelift 1997–) · Gen 3 (V60/V70, 1999–2006) · Gen 4 (V80/V90, 2006–2021, non-US) |
| **Market** | `us` (Montero, US/Canada) · `cr` (Costa Rica/LatAm, Montero) · `uk` (Shogun) · `au` (Pajero, AU/NZ) · `jdm` (Japan) · `eu` · `me` (Middle East) · `global` |
| **Fitment** | A structured query over the vehicle taxonomy: `{gens, markets?, years?, engines?, transmissions?, transferCases?, trims?, drive?}`. Resolved by the shared fitment engine; an entry's fitment names every vehicle its facts apply to |
| **Locale** | `en` (English) or `es` (Costa Rican Spanish, `usted` register). Never any other value |
| **Entry** | One document in a content collection: shared locale-independent `data` + locale-keyed `prose` with both locales required |
| **Confidence tier** | `fsm-confirmed` › `tsb` › `community-consensus` › `first-hand` › `anecdotal`. `first-hand` = verified on the project truck, flagged as single-vehicle evidence. *(2026-08-27: owner ratified the total order — `first-hand` sits between `community-consensus` and `anecdotal`. 2026-08-28: `fsm-confirmed` = factory-documented — FSM, official spec sheets, factory brochures/catalogues, i.e. manufacturer primary literature)* |
| **Canonical term** | The Costa Rican Spanish term the glossary designates for a concept; the only form allowed in ES prose |
| **Alias** | A regional variant of a canonical term (MX/ES/CO/AR/PE…), stored in the glossary for search only |
| **Gaps report** | Generated backlog: entries failing completeness heuristics (missing fix paths, uncited specs, dead links, uncovered fitment combinations) |
| **The truck** | 2002 Mitsubishi Montero, Gen 3, 6G74 SOHC 3.5L, Super Select 4WD II ("Gitana") |

---

## 3. Phase 1 — Platform scaffold (SCF, I18N)

### 3.1 Scaffold & CI (SCF)

- **SCF-01** THE repository SHALL build as an Astro project with TypeScript strict mode, static output, and content collections defined in `src/content.config.ts` with Zod schemas.
- **SCF-02** WHEN `npm run verify` runs at the repo root, THE pipeline SHALL execute check, lint, unit tests, locale check, citation check, glossary check, and build, and SHALL exit non-zero if any step fails.
- **SCF-03** WHEN a pull request is opened, THE CI workflow SHALL run every `verify` step, and SHALL block merge on any failure. Neither external link checking, accessibility, Lighthouse, nor end-to-end tests run on the merge path. External link checking runs as a separate weekly scheduled CI job plus on-demand (`workflow_dispatch`) runs (owner ruling 2026-08-30 — the archive.org throttle made it take 30 minutes to 2.6+ hours per run at content scale). A source only fails that check when both its `url` and its `archiveUrl` are unreachable — a dead original with a live archive is a gaps-report item, not a failure (GAP-01). Accessibility (Pa11y), Lighthouse budgets (SCF-06), and the Playwright end-to-end suite join it on the same weekly-scheduled, non-blocking path (owner ruling 2026-09-07 — these tests are too much for every PR, not worth that much testing on the merge path). Every one of these checks, on either path, opens or updates a tracking issue on failure instead of blocking a pull request.
- **SCF-04** IF a content entry fails its collection's Zod schema, THEN THE build SHALL fail with an error naming the file and field.
- **SCF-05** THE repository SHALL deploy to GitHub Pages on merge to `main`; WHEN a pull request runs CI, THE workflow SHALL upload the built site as a downloadable artifact (no live preview deployments for now — owner decision 2026-08-27).
- **SCF-06** THE site SHALL meet a Lighthouse accessibility score ≥ 95 and performance ≥ 90 on the home page and one representative content page per collection, enforced as a CI budget.
- **SCF-07** THE repository SHALL contain bilingual GitHub issue templates (report-a-problem, correct-a-fact, suggest-a-mod) and a PR template that requires fitment and source citations for content changes.

### 3.2 Internationalization (I18N)

- **I18N-01** THE site SHALL serve every page under both `/en/…` and `/es/…` path prefixes with neither locale privileged.
- **I18N-02** WHEN a request hits the site root `/`, THE site SHALL redirect to the visitor's preferred locale per `Accept-Language`, defaulting to `/en/` when no preference matches. *(2026-08-27: GitHub Pages (SCF-05) offers no server-side request hook, so the redirect is client-side — `navigator.languages`, the browser mirror of `Accept-Language`, through the same negotiation function a server would call — with a `noindex` bilingual chooser page and a `<noscript>` meta-refresh to `/en/` as fallback. Consequence: a no-JS visitor always lands on `/en/`, consistent with the stated default. The negotiation logic is server-shaped so an edge redirect can adopt it unchanged if the host ever allows one.)*
- **I18N-03** WHEN a visitor uses the locale switcher, THE site SHALL navigate to the same page in the other locale and SHALL persist the choice for subsequent visits.
- **I18N-04** THE site SHALL emit `hreflang` link pairs plus `x-default` on every page, and a CI check SHALL fail when any page's pair is missing or asymmetric.
- **I18N-05** WHERE a collection page has per-locale slugs (e.g. `/en/problems/…`, `/es/problemas/…`), THE slug registry SHALL map each entry to exactly one slug per locale, and a CI check SHALL fail on collisions or missing mappings.
- **I18N-06** IF an entry's `prose` lacks either `en` or `es`, THEN THE build SHALL fail (schema-level requirement, no exceptions field).
- **I18N-07** ES prose SHALL use the `usted` register; a lint rule SHALL flag second-person `tú`/`vos` conjugations in ES prose files.
- **I18N-08** THE UI chrome (nav, footer, labels, buttons, error pages) SHALL be fully translated in both locales via a typed UI-strings module; hard-coded user-facing strings in components SHALL fail lint.

## 4. Phase 2 — Vehicle taxonomy & fitment (VEH, FIT, GLO, REF)

### 4.1 Taxonomy (VEH)

- **VEH-01** THE `vehicles` collection SHALL model generations (with chassis codes and production years), markets, engines (petrol 4G54, 6G72 SOHC/DOHC, 6G74 SOHC/GDI, 6G75; diesel 4D56, 4M40, 4M41), transmissions, transfer cases (Easy Select, Super Select I/II), and trims, each with a stable ID.
- **VEH-02** WHEN two market names refer to the same vehicle (Montero/Pajero/Shogun), THE taxonomy SHALL model one vehicle with market-specific naming, never duplicate entries.
- **VEH-03** THE taxonomy SHALL record which engine/transmission/transfer-case combinations existed per generation, market, and year range, so impossible combinations are rejectable.

### 4.2 Fitment engine (FIT)

- **FIT-01** THE fitment engine SHALL live in `src/lib/fitment/` with unit tests, and SHALL be the only code that interprets fitment queries.
- **FIT-02** WHEN an entry declares a fitment, THE build SHALL resolve it against the taxonomy and fail on any reference to a nonexistent ID or an impossible combination (per VEH-03).
- **FIT-03** WHEN a visitor selects a vehicle (gen + market + year + engine), THE site SHALL filter any collection listing to entries whose fitment matches, and SHALL persist the selection across pages and locales.
- **FIT-04** THE fitment engine SHALL answer "does entry E apply to vehicle V" deterministically, with boundary-year tests (e.g. a 1999 vehicle matching both Gen 2.5 and Gen 3 where production overlapped).

### 4.3 Glossary (GLO)

- **GLO-01** THE `glossary` collection SHALL hold, per term: canonical EN, canonical ES (Costa Rican), regional aliases with country tags, definition prose in both locales, and links to related entries.
- **GLO-02** WHEN ES prose uses a term for which the glossary designates a canonical form, THE glossary check SHALL flag any non-canonical variant used in prose.
- **GLO-03** THE search index SHALL include glossary aliases so a query in any recorded regional variant finds the canonical entry.
- **GLO-04** THE glossary SHALL render as a public bilingual reference page, filterable by system (engine, brakes, suspension, …).

### 4.4 Reference data (REF)

- **REF-01** THE `reference` collection SHALL include: FSM section index (citations only, no reproduced content), VIN/option-code decoder data, fluid chart, torque master table, and capacities/dimensions — each entry fitment-scoped and source-cited.
- **REF-02** IF a numeric value in any reference entry lacks a source citation, THEN `check:citations` SHALL fail naming the entry and field.

## 5. Phase 3 — Garage / build log (GAR)

- **GAR-01** THE `garage` collection SHALL hold dated entries for the truck: work performed, parts used (by part ID), procedures followed (by procedure ID), actual cost, actual time, odometer, photos, and outcome prose in both locales.
- **GAR-02** THE site SHALL render a derived current-state sheet: what is on the truck now (parts, mods, fluids), mileage, and service history — computed from garage entries, never hand-maintained.
- **GAR-03** THE site SHALL render a planned-work queue from garage entries with status `planned`, ordered by priority.
- **GAR-04** WHEN a garage entry references a problem entry, THE problem entry SHALL display the first-hand outcome as `first-hand` evidence with a link back.
- **GAR-05** WHEN a garage entry names a part or procedure that has no entry yet, THE gaps report SHALL list it as missing.

## 6. Phase 4 — Problem finder (PRB)

- **PRB-01** THE `problems` collection SHALL hold, per entry: symptoms (short plain-language phrases, both locales), fitment, ordered diagnostic steps each stating what a result rules in or out, root causes ranked by likelihood, fix paths (difficulty 1–5, cost band, parts by ID, procedures by ID), severity, drivability triage, sources, confidence tier.
- **PRB-02** THE site SHALL offer symptom-first navigation: a visitor picks or searches a symptom phrase in their locale and reaches matching problems filtered by their selected vehicle.
- **PRB-03** WHEN a problem's severity is `safety-critical`, THE page SHALL render the standing bilingual safety notice and the "see a qualified mechanic" framing per AGENTS.md.
- **PRB-04** WHEN a problem entry's confidence tier is `community-consensus` or lower, THE page SHALL render the visible caveat in both locales.
- **PRB-05** THE drivability triage SHALL be one of: `drive-normally`, `drive-gently-repair-soon`, `do-not-drive`, `tow-only` — rendered prominently in both locales.
- **PRB-06** IF a problem entry has no fix path, THEN THE gaps report SHALL list it.

## 7. Phase 5 — Parts & procedures (PRT, PRC)

- **PRT-01** THE `parts` collection SHALL hold, per entry: OEM part number(s) with supersession chain, fitment, aftermarket equivalents (brand + number + quality note), typical price band, vendors, known-bad brands with evidence, sources.
- **PRT-02** WHEN a part number is superseded, THE page SHALL show the chain oldest→current and mark the current orderable number.
- **PRT-03** IF two parts entries claim the same OEM number with conflicting fitment, THEN THE build SHALL fail.
- **PRC-01** THE `procedures` collection SHALL hold, per entry: prerequisites, tools (flagging special/SST tools), parts consumed, torque specs (from shared data, cited), fluid specs and capacities (cited), step-by-step prose in both locales, time estimate, difficulty 1–5, safety notes.
- **PRC-02** WHEN a procedure touches a safety-critical system, THE entry SHALL carry the `safety-critical` flag and render per PRB-03's notice rules.
- **PRC-03** IF a procedure cites a torque or fluid spec, THEN THE value SHALL come from shared reference data by ID, never inlined per-locale.

## 8. Phases 6–8 — Mods, community & search, read-model (MOD, COM, SRCH, RM)

- **MOD-01** THE `mods` collection SHALL hold, per entry: what it requires (by entry ID), what it breaks or affects, cost band, difficulty, fitment, honest tradeoffs prose in both locales, sources.
- **MOD-02** WHEN a mod requires another mod or part, THE requirement SHALL be a typed reference that the build resolves.
- **COM-01** THE `community` collection SHALL hold forums, subreddits, groups (Facebook, WhatsApp, Telegram — WhatsApp/Telegram added as first-class types by owner ruling 2026-08-28; in Central America a WhatsApp group is often the primary venue), Discords, clubs, channels, vendors, and shops — tagged by region, language, generation focus, activity level, and "what it's good for" in both locales.
- **COM-02** Spanish-language and Central American communities SHALL be first-class entries, not an appendix.
- **SRCH-01** THE site SHALL provide client-side search per locale over titles, symptoms, glossary terms and aliases, and part numbers.
- **SRCH-02** WHEN a visitor searches a regional alias (e.g. `balatas`), THE results SHALL include the canonical entry (GLO-03).
- **GAP-01** THE `npm run gaps` report SHALL list: problems with no fix path, parts with no fitment, procedures missing torque or fluid citations, fitment combinations with zero coverage, glossary terms used in prose but undefined, entries at `anecdotal` confidence older than 90 days, and dead source links.
- **RM-01** WHEN content merges to `main`, CI SHALL sync the built content into Supabase (typed tables, `tsvector` columns with `english` and `spanish` dictionaries). The sync SHALL be idempotent and one-directional (git → DB, never back).
- **RM-02** THE Supabase read-model SHALL never be written by any process other than the CI sync job.

---

## 9. Out of scope for 001

User accounts, comments, user submissions, voting, forums or any writable
community surface · native apps · affiliate links or monetization · paid API ·
non-Montero/Pajero/Shogun vehicles · scraping or bulk-importing any external
site's content · Gen 4 content depth beyond taxonomy + high-level coverage
(revisit after Gen 2/3 are solid).
