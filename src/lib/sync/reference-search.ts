/**
 * The git→Supabase read-model sync (RM-01, RM-02) — **the seam, not the
 * implementation**.
 *
 * T801 [TEST] declares this contract from `specs/001-foundation/spec.md`
 * alone; no sync job exists yet. T802 [PLATFORM] is the task that makes
 * {@link computeSyncPlan} real — it activates `tests/sync/sync-plan.test.ts`
 * by deleting that file's `it.fails` marker lines, one at a time, and nothing
 * in this module's *shape* should need to change to do it (the row and plan
 * types are the contract; only the thrown stub becomes a real function body).
 *
 * ## Why the diff logic is a pure function at all
 *
 * RM-01 says the sync "SHALL be idempotent and one-directional (git → DB,
 * never back)". Both of those are properties of *what rows get written*, not
 * of *how a network call is made* — so the part worth grading without a live
 * Supabase project is the part that decides, given "what git says" and "what
 * the table currently holds", which rows to upsert and which to delete.
 * {@link computeSyncPlan} is that decision, isolated from the Supabase client,
 * from `getCollection()`, and from any I/O — exactly so `tests/sync/` can
 * grade it in Tier A, on every machine, with no network and no Docker (the
 * same reason `tests/garage/sql.ts` reads migration *text* rather than a live
 * schema for its declaration tier).
 *
 * `scripts/sync-reference-search.mjs` (T802's own naming decision, or
 * whichever name it prefers — see `tests/sync/contract.ts` for why the name
 * itself is a one-line, renegotiable decision and not what is graded) is
 * expected to be a thin wrapper: read the built content collections, read the
 * current table with the Supabase service-role client, call this function,
 * then execute exactly the upserts and deletes it returns. Nothing about that
 * wrapper is graded here — I/O is T802's to write and T802's to prove against
 * a live stack, the same split `tests/garage/` draws between `sql.ts`
 * (declaration) and `harness.ts` (behaviour).
 *
 * refs specs/001-foundation (RM-01, RM-02)
 */

/**
 * The closed set of collections the read-model indexes.
 *
 * **Reused, not re-minted.** `src/lib/search.ts`'s `SEARCH_DOCUMENT_TYPES` is
 * already the closed set SRCH-01/SRCH-02's client-side search indexes —
 * "titles, symptoms, glossary terms and aliases, and part numbers" reads
 * straight onto `glossary`, `problems`, `parts`, and T702 added `mods` for
 * the same shape (`affects`/tradeoffs prose plus fitment). `procedures` and
 * `garage` are excluded there for reasons that hold here unchanged:
 * `procedures` has no route to link a result to yet (T502 review note quoted
 * in `search.ts`), and `garage` is private, RLS-scoped, per-user data — 002
 * MIG-03 makes indexing it into a public read-model a data leak, not a
 * feature gap. **Decision recorded here for T802**: the read-model's
 * `collection` column is this same closed set, so a client-side result and a
 * server-side result are always answers to the same question. Widening
 * either list without widening the other is the drift RM-01's "server-side
 * search endpoint … behind client-side fallback" (T803) cannot tolerate — a
 * fallback that returns a different result set than the thing it falls back
 * *from* is not a fallback.
 */
export type ReferenceSearchCollection =
  "glossary" | "problems" | "parts" | "mods";

/** The two locales this repo ships, matching `src/i18n/routes.ts`'s set. */
export type ReferenceSearchLocale = "en" | "es";

/**
 * The three columns that uniquely identify one row — one entry, in one
 * locale. A composite key rather than a single joined string (contrast
 * `SearchDocument.id`'s `` `${type}:${entryId}` `` in `src/lib/search.ts`):
 * the DB primary key is `(collection, entry_id, locale)` as three real
 * columns (`tests/sync/contract.ts`'s `REFERENCE_SEARCH_TABLE`), because a
 * joined string invites exactly the colon-in-an-id ambiguity `qualify()` in
 * `tests/garage/sql.ts` exists to avoid on the SQL side, and a composite key
 * needs no escaping scheme to begin with.
 */
export interface ReferenceSearchKey {
  readonly collection: ReferenceSearchCollection;
  readonly entryId: string;
  readonly locale: ReferenceSearchLocale;
}

/**
 * One row of the read-model, as git (via the built content collections)
 * asserts it should be. Deliberately the same shape as
 * `src/lib/search.ts`'s `SearchDocument` minus `id`/`type` (replaced by the
 * composite {@link ReferenceSearchKey}) and minus `search_vector`, which the
 * database computes from `title`/`snippet`/`extra` and is never supplied by
 * the sync job — see `tests/sync/contract.ts` for the generation rule.
 */
export interface ReferenceSearchRow extends ReferenceSearchKey {
  readonly href: string | null;
  readonly title: string;
  readonly subtitle: string | null;
  readonly snippet: string;
  readonly badges: readonly string[];
  readonly codes: readonly string[];
  readonly extra: readonly string[];
}

/** What the sync job must do to bring the table into line with git. */
export interface SyncPlan {
  /**
   * Rows to `insert … on conflict (collection, entry_id, locale) do update`
   * — new content, and content whose stored row no longer matches git.
   */
  readonly upserts: readonly ReferenceSearchRow[];
  /**
   * Keys to delete — rows the table holds that git no longer asserts, by
   * whatever route: the content entry was removed, or the row was never
   * git's to begin with (RM-02's "never written by any process other than
   * the CI sync job" reduces the second case to "did the sync's own last run
   * ever produce this key" — an out-of-band insert is one plan-and-apply
   * cycle away from being deleted).
   */
  readonly deletes: readonly ReferenceSearchKey[];
}

/**
 * The seam message. Every `tests/sync/sync-plan.test.ts` grader is expected
 * to fail today with *this* — not a typo, not an import error — so the
 * `it.fails` markers there are honest about what they are waiting for.
 */
export const SYNC_SEAM_NOT_IMPLEMENTED = "not implemented: T802";

/**
 * Decide what {@link SyncPlan} brings `dbRows` into line with `gitRows`.
 *
 * **Not implemented.** T801 [TEST] declares the contract this function must
 * satisfy — see `tests/sync/sync-plan.test.ts` for the idempotency and
 * one-directionality properties every future implementation is graded
 * against — and T802 [PLATFORM] writes the body. Until then this throws, so
 * a test that calls it fails for a reason a human can read rather than for a
 * wrong number silently produced by a function nobody wrote yet.
 */
export function computeSyncPlan(
  gitRows: readonly ReferenceSearchRow[],
  dbRows: readonly ReferenceSearchRow[]
): SyncPlan {
  // Referenced so a strict linter does not flag unused parameters on a
  // deliberately unimplemented function — the seam throws before either is
  // read, but the signature is the contract.
  void gitRows;
  void dbRows;
  throw new Error(
    `${SYNC_SEAM_NOT_IMPLEMENTED} — computeSyncPlan has no implementation. ` +
      `T801 [TEST] declared the git→Supabase read-model sync contract; T802 ` +
      `[PLATFORM] ships the diff logic that satisfies it ` +
      `(refs specs/001-foundation RM-01, RM-02)`
  );
}
