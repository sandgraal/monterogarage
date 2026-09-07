/**
 * The git→Supabase read-model contract (RM-01, RM-02) — declared by T801
 * [TEST], satisfied by T802 [PLATFORM].
 *
 * No sync job and no migration for it exist yet. Every name below is derived
 * from `specs/001-foundation/spec.md` alone, the same discipline
 * `tests/garage/contract.ts` documents at length for T2-201/T2-202 — read that
 * file's own header before touching this one; this file follows its
 * conventions on purpose rather than inventing new ones for a problem that is
 * one layer removed but structurally the same (a git-authored fact becoming a
 * row a grader can check).
 *
 * ## Why the names live here and nowhere else
 *
 * Same reasoning as `tests/garage/contract.ts`: a grader has to name a table
 * and its columns to be concrete, and putting that decision in five test
 * files turns a rename into a five-file argument. If T802 prefers a different
 * table name, that is a one-line conversation with the conductor. What is
 * **not** negotiable is the behaviour graded around it — idempotency,
 * one-directionality, and the per-locale `tsvector` split.
 *
 * ## What this file does NOT decide
 *
 * It does not decide how the sync job authenticates to Supabase, whether it
 * runs as a GitHub Actions step or a Vercel deploy hook, or the exact
 * `INSERT … ON CONFLICT` SQL T802 writes. Those are T802's to choose; this
 * file (and `src/lib/sync/reference-search.ts`) pin only the properties RM-01
 * and RM-02 actually state, plus the minimum shape needed to state them
 * concretely.
 *
 * refs specs/001-foundation (RM-01, RM-02, SRCH-01)
 */
import {
  SEARCH_DOCUMENT_TYPES,
  type SearchDocumentType,
} from "../../src/lib/search.ts";
import type { ReferenceSearchCollection } from "../../src/lib/sync/reference-search.ts";

/* -------------------------------------------------------------------------
 * The table (RM-01: "typed tables, tsvector columns with english and
 * spanish dictionaries")
 * ---------------------------------------------------------------------- */

/**
 * The unified read-model table's name.
 *
 * **One table, not five** (a judgment call this file makes on RM-01's
 * behalf). RM-01 says "typed tables" (plural) and "the built content" with no
 * further shape, so the choice between "one table with a `collection`
 * column" and "one table per content collection" is not settled by the text
 * alone. One table is chosen because:
 *
 * 1. It mirrors the shape SRCH-01's own client-side implementation already
 *    committed to — `src/lib/search.ts`'s `SearchDocument` is deliberately
 *    "collection-agnostic by construction … never mentions `glossary`,
 *    `problems`, `parts` or `mods` by name" (that module's own docstring),
 *    precisely so a fifth collection is one adapter, not a second matching
 *    engine. T803's server-side search endpoint is a fallback *for* that
 *    same client-side search (task line: "behind client-side fallback"), and
 *    a fallback answering a differently-shaped question is not a fallback.
 * 2. A single `select … where locale = $1 and search_vector @@ query`
 *    against one table is the server-side equivalent of the one client-side
 *    filter loop `matchesSearchFilter` already runs over one concatenated
 *    array — five tables would need a `union all` T803 would have to
 *    maintain in step with every collection this repo ever adds.
 *
 * "Typed" is satisfied a different way than "one table per type" would
 * satisfy it: `collection` is a checked, closed-set column (graded below),
 * not a free-text field — five different shapes wearing one column, not one
 * shape with no seams at all.
 *
 * Named `search_index_entries`, not `reference_search` or `reference_*`
 * anything — `reference` already names one specific content collection
 * (REF-01/02: torque/fluid/capacity master data), and a table called
 * `reference_search` sitting next to a *content collection* called
 * `reference` invites exactly the "which one do you mean" confusion this
 * file exists to prevent everywhere else.
 */
export const SEARCH_INDEX_TABLE = "search_index_entries";

/**
 * The closed set of collections the table's `collection` column may hold —
 * re-exported from `src/lib/sync/reference-search.ts`'s
 * `ReferenceSearchCollection`, which is itself `src/lib/search.ts`'s
 * `SEARCH_DOCUMENT_TYPES` under a different name. Three modules, one list,
 * on purpose: see that module's docstring for why re-minting it here would
 * be exactly the drift RM-01/SRCH-01 cannot tolerate.
 */
export const SEARCH_INDEX_COLLECTIONS: readonly SearchDocumentType[] =
  SEARCH_DOCUMENT_TYPES;

/** Compile-time proof the two lists really are the same list, not two. */
export type _AssertSameCollectionSet = [ReferenceSearchCollection] extends [
  SearchDocumentType,
]
  ? true
  : never;

/** The two locales a row may be filed under. */
export const SEARCH_INDEX_LOCALES = ["en", "es"] as const;

/** One column the migration's `create table` must declare. */
export interface SearchIndexColumn {
  readonly name: string;
  readonly requirement: string;
  /** A pattern the normalised column *type* must match. */
  readonly type?: RegExp;
  readonly notNull?: boolean;
  /** `true` for the three columns that make up the primary key. */
  readonly primaryKey?: boolean;
}

/**
 * Every column RM-01/SRCH-01 puts on the table, mirroring
 * `src/lib/search.ts`'s `SearchDocument` field-for-field (minus `id`/`type`,
 * replaced by the three primary-key columns) — see
 * `ReferenceSearchRow` in `src/lib/sync/reference-search.ts` for the
 * app-side type this is the DB-side twin of.
 */
export const SEARCH_INDEX_COLUMNS: readonly SearchIndexColumn[] = [
  {
    name: "collection",
    requirement: "RM-01 (typed — a closed set, checked below)",
    notNull: true,
    primaryKey: true,
  },
  {
    name: "entry_id",
    requirement: "RM-01 (the git content entry this row indexes)",
    notNull: true,
    primaryKey: true,
  },
  {
    name: "locale",
    requirement: "RM-01 (per-language row — see SEARCH_VECTOR_COLUMN)",
    notNull: true,
    primaryKey: true,
  },
  { name: "href", requirement: "SRCH-01 (a result the reader can land on)" },
  {
    name: "title",
    requirement: 'SRCH-01 ("titles")',
    notNull: true,
  },
  {
    name: "subtitle",
    requirement: "SRCH-01 (the glossary adapter's second term)",
  },
  {
    name: "snippet",
    requirement: "SRCH-01 (a summary or definition to search and to show)",
    notNull: true,
  },
  {
    name: "badges",
    requirement: "SRCH-01 (rendered chip text)",
    type: /\[\]|array/,
  },
  {
    name: "codes",
    requirement: 'SRCH-01 ("part numbers")',
    type: /\[\]|array/,
  },
  {
    name: "extra",
    requirement: 'SRCH-01/SRCH-02 ("glossary terms and aliases", symptoms)',
    type: /\[\]|array/,
  },
  {
    name: "search_vector",
    requirement:
      'RM-01 ("tsvector columns with english and spanish dictionaries")',
    type: /tsvector/,
    notNull: true,
  },
] as const;

/** The generated, indexed full-text column — named once, read everywhere. */
export const SEARCH_VECTOR_COLUMN_NAME = "search_vector";

/* -------------------------------------------------------------------------
 * The per-language split (RM-01's central design decision this file makes)
 * ---------------------------------------------------------------------- */

/**
 * **One row per (entry, locale), not one row per entry with two `tsvector`
 * columns.** RM-01's "tsvector columns with english and spanish
 * dictionaries" is read literally as "columns, plural, using both
 * dictionaries across the table" rather than "every row carries two
 * columns" — and the per-row-per-locale shape is chosen because:
 *
 * 1. Every reader-facing surface in this repo is already locale-scoped —
 *    `/en/…` and `/es/…` are "equal footing … per-locale slugs" (CLAUDE.md),
 *    and SRCH-01 itself says "client-side search **per locale**". A row per
 *    locale means T803's query is `where locale = $1 and search_vector @@
 *    plainto_tsquery($2::regconfig, $3)` — the same shape as every other
 *    per-locale query this site runs — rather than a query that must first
 *    decide which of two columns on one row to read.
 * 2. `search_vector`'s dictionary config is then a two-way `case` on a
 *    column of the same row (`locale`), which is one generated expression
 *    doing one job, rather than two generated columns each doing half of it
 *    and a reader having to know which one a given query cares about.
 *
 * The generation rule this file asks T802 to implement, in words a
 * `create table` can express as a `generated always as (…) stored` column:
 *
 * ```sql
 * search_vector tsvector generated always as (
 *   to_tsvector(
 *     case locale when 'en' then 'english' when 'es' then 'spanish' end::regconfig,
 *     coalesce(title, '') || ' ' || coalesce(snippet, '') || ' ' ||
 *       coalesce(array_to_string(extra, ' '), '')
 *   )
 * ) stored
 * ```
 *
 * `tests/sync/schema-shape.test.ts` grades the branching structure of
 * whatever expression T802 actually writes — that it names `'english'` only
 * where `locale = 'en'` and `'spanish'` only where `locale = 'es'`, not that
 * it is spelled exactly like the SQL above (a trigger-maintained column with
 * a `before insert or update` function is an equally valid way to satisfy
 * the same graders, and is not disqualified by anything here).
 */
export const SEARCH_VECTOR_LOCALE_CONFIG: Readonly<
  Record<(typeof SEARCH_INDEX_LOCALES)[number], string>
> = {
  en: "english",
  es: "spanish",
};

/* -------------------------------------------------------------------------
 * RM-02 — write access
 * ---------------------------------------------------------------------- */

/**
 * Verbs that must **never** be granted to an anonymous or merely-signed-in
 * role on the read-model table.
 *
 * RM-02: "THE Supabase read-model SHALL never be written by any process
 * other than the CI sync job." Unlike `tests/garage/contract.ts`'s
 * `USER_TABLES` — private data, where even `select` must be denied to `anon`
 * by default — this table holds *public* reference content, so `select`
 * being reachable by `anon`/`authenticated` is not itself a finding (T803's
 * server-side search endpoint has to read it somehow, and doing that with
 * the anon key rather than a secret one is the *safer* of T803's two
 * options — see `src/lib/supabase/config.ts`'s own reasoning for why a
 * secret key never belongs anywhere this repo's build can reach it). What
 * RM-02 actually forbids is a write reaching any role but the one the CI job
 * authenticates as, so only the three write verbs are graded here.
 */
export const SEARCH_INDEX_WRITE_VERBS = ["insert", "update", "delete"] as const;

/**
 * Roles the write-verb sweep runs over.
 *
 * `anon` and `authenticated` for the same reason `tests/garage/contract.ts`'s
 * `ANONYMOUS_ROLES` (`anon`, `public`) matters there — `public` is not a role
 * beside `anon`, it is every role, so a privilege granted to `public` reaches
 * both. `authenticated` is included and `ANONYMOUS_ROLES` is not reused
 * verbatim because a *signed-in* visitor must not be able to write this table
 * either — RM-02 says "any process other than the CI sync job", and a
 * logged-in garage user is exactly such a process.
 */
export const SEARCH_INDEX_WRITE_DENIED_ROLES = [
  "anon",
  "public",
  "authenticated",
] as const;

/* -------------------------------------------------------------------------
 * CI wiring (RM-01: "WHEN content merges to main, CI SHALL sync")
 * ---------------------------------------------------------------------- */

/**
 * Where T802 is expected to place the sync script.
 *
 * `scripts/*.mjs` is the established location for a build-time/CI Node
 * script with no Astro dependency — `scripts/gaps.mjs` is the precedent
 * (T703), invoked directly by a workflow step and unit-tested by importing
 * its exported functions rather than shelling out. This file names the path
 * so `tests/sync/ci-wiring.test.ts` can find it without a second constant
 * drifting from the first; it is a one-line rename away from whatever T802
 * actually prefers, same as every other name in this file.
 */
export const SYNC_SCRIPT_PATH = "scripts/sync-reference-search.mjs";

/**
 * Where T802 is expected to wire the CI job that runs it.
 *
 * A dedicated workflow rather than a step inside `ci.yml` — RM-01's trigger
 * is "content merges to main", not "every pull request", and `ci.yml`'s own
 * header comment (`.github/workflows/ci.yml`) is explicit that its three job
 * names are load-bearing branch-protection contexts; adding a fourth
 * merge-to-main-only trigger inside that file would either run on every PR
 * (wrong trigger) or need a conditional that silently no-ops most runs
 * (the shape `link-check.yml` was split out specifically to avoid). A
 * same-directory sibling workflow, triggered on `push` to `main` only,
 * keeps RM-01's trigger condition visible in the file's own `on:` block
 * rather than buried in a job-level `if:`.
 */
export const SYNC_WORKFLOW_PATH = ".github/workflows/sync-reference-search.yml";

/**
 * The environment variable name the CI job's Supabase credential must be
 * read from.
 *
 * **Never `PUBLIC_*`.** `src/lib/supabase/config.ts`'s whole design is that
 * only `PUBLIC_`-prefixed variables reach client code, and its own
 * `isSecretKey`/`SECRET_KEY_REFUSED` guard exists because "no service key
 * exists in this repo" (that module's docstring) must be true structurally,
 * not by habit. RM-02's write path needs exactly the privilege a `PUBLIC_*`
 * key must never carry, so this name is deliberately outside that prefix —
 * a GitHub Actions repository secret, injected only into the CI job's own
 * process environment, never into a Vercel/browser build.
 */
export const SYNC_SERVICE_KEY_ENV_VAR = "SUPABASE_SERVICE_ROLE_KEY";

/** A forbidden env var name — the client-safe one, named for the sweep. */
export const FORBIDDEN_CLIENT_KEY_ENV_VAR = "PUBLIC_SUPABASE_ANON_KEY";
