# CLAUDE.md

Read `AGENTS.md` first — it is the constitution and wins over everything,
including this file. Then, for the current work:

- `specs/001-foundation/` — the reference platform. `spec.md` (requirements),
  `plan.md` (build order and separation rules), `tasks.md` (progress).
- `specs/002-montero-garage/` — the multi-user pivot, and the active spec for
  accounts, the garage, and sharing. `§10` carries the 2026-08-31 amendment
  adding typed share grants (SHR-05..09).
- `specs/003-shop-tools/` — the mechanic and shop surface: roster,
  propose-and-accept, shop-side monetization. Gated on 002 Phase P3.

Each spec's own `tasks.md` is the source of truth for its progress.

## What this repo is

**Montero Garage** (monterogarage.com): a bilingual (EN / Costa Rican ES)
platform where any Mitsubishi Montero/Pajero/Shogun owner keeps their truck's
whole life — vehicle profile, every receipt, every job — private by default,
shareable by choice, on top of a comprehensive reference covering all
generations and markets. The owner's 2002 Montero, **Gitana Blanca**, is user
page #1.

Astro static site; *reference* content as Zod-typed collections in git;
**Supabase is the auth + user-data + storage layer** (002 MIG-03 — not a
derived read-model; user data's source of truth is the database, behind RLS).
Deploy is Vercel. Agents write all site code and content; the main session
conducts.

## Commands

- `npm run verify` — every merge-blocking check. Link checking, a11y (Pa11y),
  Lighthouse budgets, and end-to-end tests are not merge-blocking — they run
  on weekly-scheduled CI jobs instead (`link-check.yml` since 2026-08-30,
  `a11y-lighthouse-e2e.yml` since 2026-09-07); must pass before any commit
- `npm run dev` / `npm run build` / `npm run check`
- `npm test` / `npm run lint` / `npm run test:e2e` (Playwright, `tests/e2e/`)
- `npm run check:locales` / `check:citations` / `check:glossary` / `check:links`
- `npm run gaps` — generates the content backlog report
- `npm run test:garage` — the user-data graders. Tier A (parses the migration
  text) runs anywhere and runs inside `verify`, so it carries the merge gate.
  Tier B (hits a real local stack) needs `supabase start` and Docker — which
  GitHub runners do have, contrary to what this line used to say. Since
  2026-09-01 Tier B also runs in CI, as the **non-required, informational**
  `tier-b` job in `ci.yml`: it reports red on every PR when the live RLS
  proofs break, but it does not block merges. Promotion to a required check is
  the owner's call after a soak period — see
  `specs/001-foundation/audits/T901-tier-b-ci-investigation.md`.

## Environment — this machine is unusual

- **No system Node.** Prefix every shell that runs npm/node with
  `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" &&`
  Subagent worktree shells cannot source `nvm.sh` via `.` (Bash guard blocks
  it) — the direct PATH export is the form that works everywhere.
- **This volume (`/Volumes/Samsung T9`) has silently dropped writes before.**
  After every push: `git ls-remote origin <branch>` to confirm it landed, and
  `git show --stat HEAD` to confirm the commit is what you think it is.
- Worktrees do not inherit gitignored files. Copy `.env.local` (once it exists)
  from the main checkout — `git worktree list` shows its path.

## Bilingual rules (the short version — AGENTS.md has the full text)

- Every entry has `prose.en` AND `prose.es`. Missing either = build error.
- Numbers (specs, part numbers, capacities, fitment) are shared `data`,
  stored once, never per-locale.
- Costa Rican Spanish, `usted` register. Glossary terms are canonical;
  regional variants go in glossary `aliases` only.
- URLs: `/en/…` and `/es/…`, equal footing, per-locale slugs, hreflang pairs
  + `x-default` on every page.

## Workflow

- Branch from `main` as `feat/001-t###-short-slug` (lowercase id, 2–4 word slug).
- Commit messages: `type(scope): …, refs specs/001-foundation`.
- Open every PR as a **draft the moment the branch is pushed** so CI runs
  during review; mark ready when review clears.
- Branch protection requires the CI checks and conversation resolution. A PR
  at `BLOCKED` until threads resolve is expected, not a failure. Reply on each
  thread and resolve it after pushing a fix — never resolve silently.
- Check the task's box in `specs/001-foundation/tasks.md` in the final commit
  of the branch that completes it.

## Operating mode: conductor (owner's standing instruction, 2026-08-27)

- The main session **orchestrates, it does not implement**. Start work with
  `/conduct T###` (or `next` / `phase N`). Site code is written by
  `implementer`, graders by `test-writer`, content by `content-researcher` —
  each in its own worktree (`isolation: "worktree"`, background).
- Every content branch gets **two independent passes run concurrently**:
  `fact-checker` (claims vs. cited sources) and `bilingual-editor` (ES register,
  glossary conformance, no number diverging between locales). Every code branch
  gets `code-reviewer`. `pr-shepherd` opens the PR, resolves every thread,
  rebases on conflicts, and **merges autonomously** once required checks are
  green and threads are resolved. No "shall I merge?".
- The main session's only source edits are harness/docs/memory (`.claude/`,
  `specs/*/tasks.md` checkbox fixes, handoffs). Everything else goes to an
  agent — including review-comment fixes (`SendMessage` to the agent with the
  context).
- Model routing per `.claude/routing/routing-policy.json`; record
  `T### -> role -> model/effort (reason)` before each dispatch.
- Parallelism: dispatch every independent eligible task at once. **Parallel is
  the default and serial needs a stated reason** — name the task and the file
  or interface it would collide with. `next` names where to start, not how
  many to run. Recompute the eligible frontier after every merge and refill in
  the same turn. The main session never blocks on one agent.
- Stop-and-ask only for: reviewer/author deadlock after two rounds, a suspected
  grader defect, spec ambiguity, an AGENTS.md boundary, infra failure after one
  rerun. Keep other tasks moving while asking.
- Blockers are surfaced in chat **and** as a `⛔ Blocked:` PR comment.
- **One conductor session at a time (owner ruling, 2026-09-01).** A second
  session's concurrent edits to `.claude/`, `specs/*/tasks.md`, or routing
  config are a process failure to report to the owner, not a pattern the
  harness is designed to coordinate around — this happened once and should
  not happen again.

## Harness

- `/conduct` is the default entry point.
- Agents: `.claude/agents/{implementer,test-writer,content-researcher,fact-checker,bilingual-editor,code-reviewer,pr-shepherd}.md`
- Routing: `.claude/routing/routing-policy.json` (machine-checkable; validated
  in CI by `scripts/validate-routing.mjs`) + `routing.md` (judgment guidance).
- Hooks: `guard-dangerous-git.sh` blocks `--no-verify`, bare force-push, pushes
  to main, `gh pr merge --admin`; `pre-commit-verify.sh` gates commits on
  `npm run verify` in whichever worktree is committing (skips gracefully before
  Phase 1 lands).
- Per-user setting overrides go in `.claude/settings.local.json` (gitignored).
