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
 * The composite primary key, as one string safe to use as a `Map`/`Set` key.
 *
 * `JSON.stringify` of the three-element tuple, rather than a hand-joined
 * string with a separator: `entryId` is free text (a content author's own
 * slug), and a hand-joined separator has to be a character provably absent
 * from every one of the three parts to avoid the class of bug
 * `tests/garage/sql.ts`'s `qualify()` documents. `collection` and `locale`
 * are both closed sets today, but `JSON.stringify` needs no such proof at
 * all — it escapes whatever the string actually contains — so this key
 * cannot collide regardless of what a future `entryId` contains.
 *
 * ## Note on the seam this function's caller replaces
 *
 * `SYNC_SEAM_NOT_IMPLEMENTED` (the `"not implemented: T802"` message the
 * stub used to throw) and the one `tests/sync/sync-plan.test.ts` test that
 * asserted it are both gone as of this change — the same convention
 * `tests/garage/`'s `harness-contract.test.ts` documents for
 * `seam-canary.test.ts`: a canary proving "the real tests fail for the right
 * reason" has nothing left to prove once the reason is gone, and left in
 * place it would itself become a false failure the moment
 * {@link computeSyncPlan} stopped throwing.
 */
function keyOf(row: ReferenceSearchKey): string {
  return JSON.stringify([row.collection, row.entryId, row.locale]);
}

/** Same-length, same-order string-array equality — `badges`/`codes`/`extra`. */
function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * Whether `gitRow` and `dbRow` are the same row in every field RM-01 asks the
 * sync to keep in step — not just the key. A key match with a stale `title`
 * or `snippet` is exactly the "converged" state idempotency requires the
 * second run to close, so every field short of `search_vector` (which the
 * database computes and the sync never supplies — see this file's own
 * `ReferenceSearchRow` docs) is compared.
 */
function sameRow(
  gitRow: ReferenceSearchRow,
  dbRow: ReferenceSearchRow
): boolean {
  return (
    gitRow.collection === dbRow.collection &&
    gitRow.entryId === dbRow.entryId &&
    gitRow.locale === dbRow.locale &&
    gitRow.href === dbRow.href &&
    gitRow.title === dbRow.title &&
    gitRow.subtitle === dbRow.subtitle &&
    gitRow.snippet === dbRow.snippet &&
    sameStrings(gitRow.badges, dbRow.badges) &&
    sameStrings(gitRow.codes, dbRow.codes) &&
    sameStrings(gitRow.extra, dbRow.extra)
  );
}

/**
 * Decide what {@link SyncPlan} brings `dbRows` into line with `gitRows`.
 *
 * A pure diff over two already-shaped row lists — no Supabase client, no
 * `getCollection`, no I/O (see this module's docstring for why that split is
 * what makes the RM-01 properties gradable at all without a live stack).
 *
 * **Idempotency**: a `gitRow` that already has an identical `dbRow` at its
 * key (every field {@link sameRow} compares, not just the key) produces
 * neither an upsert nor a delete — so re-running the plan the sync job just
 * applied finds nothing left to do (`tests/sync/sync-plan.test.ts`'s
 * "running the plan's own upserts back through as `dbRows` converges to a
 * no-op").
 *
 * **One-directionality**: `upserts` is always `gitRow` itself, verbatim,
 * never a value merged with what `dbRows` held at that key — a hand-edited or
 * stray-inserted `dbRow` is corrected or removed, never read from. `deletes`
 * is every key `dbRows` holds that no `gitRow` claims, by the full
 * `(collection, entryId, locale)` key — so the same `entryId` in two locales
 * is two independent rows, and dropping one locale's translation from git
 * deletes only that locale's row.
 */
export function computeSyncPlan(
  gitRows: readonly ReferenceSearchRow[],
  dbRows: readonly ReferenceSearchRow[]
): SyncPlan {
  const dbByKey = new Map<string, ReferenceSearchRow>();
  for (const dbRow of dbRows) dbByKey.set(keyOf(dbRow), dbRow);

  const gitKeys = new Set<string>();
  const upserts: ReferenceSearchRow[] = [];
  for (const gitRow of gitRows) {
    const key = keyOf(gitRow);
    gitKeys.add(key);
    const dbRow = dbByKey.get(key);
    if (dbRow === undefined || !sameRow(gitRow, dbRow)) {
      upserts.push(gitRow);
    }
  }

  const deletes: ReferenceSearchKey[] = [];
  for (const dbRow of dbRows) {
    if (gitKeys.has(keyOf(dbRow))) continue;
    deletes.push({
      collection: dbRow.collection,
      entryId: dbRow.entryId,
      locale: dbRow.locale,
    });
  }

  return { upserts, deletes };
}
