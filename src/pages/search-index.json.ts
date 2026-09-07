/**
 * The built-content half of the git→Supabase read-model sync (T802, RM-01,
 * RM-02) — a single, locale-agnostic, prerendered JSON artifact naming every
 * {@link ReferenceSearchRow} the corpus asserts, for both locales.
 *
 * ## Why a build artifact, and not `scripts/sync-reference-search.mjs`
 * ## reading `getCollection()` directly
 *
 * `tests/sync/contract.ts`'s own docstring leaves this open ("whether the
 * sync's 'built content' should read Astro's `getCollection()` output
 * directly or a pre-built JSON artifact — orthogonal to every grader in this
 * branch"). It is not orthogonal to how the script actually has to run:
 * `astro:content` is a *virtual module* Vite resolves inside Astro's own
 * build pipeline, and every existing "read the corpus from plain Node" case
 * in this repo — `scripts/lib/content-entries.mjs`'s own docstring,
 * `src/lib/fitment/content.ts`'s "Why not `astro:content`" section, and
 * `astro.config.mjs`'s `validateFitments` hook comment ("this hook runs
 * before the content layer is available") — says the same thing: a script
 * that runs under bare `node`, with no bundler, cannot import it. So this
 * page is the seam: it runs *inside* `astro build` (where `getCollection` and
 * every `src/i18n/routes.ts` helper work exactly as they do for
 * `[searchSegment].astro`), and writes its answer to a static file
 * `scripts/sync-reference-search.mjs` — a plain-Node CI script — can read
 * with nothing more than `fs.readFile` and `JSON.parse`.
 *
 * ## Reuses the exact adapters the reader-facing search page uses
 *
 * Every field below comes from `src/lib/search-corpus.ts`'s four per-collection
 * functions — the same ones `[searchSegment].astro` calls for the client-side
 * index. This is deliberate and load-bearing: `src/lib/sync/reference-search.ts`'s
 * docstring warns that a server-side result set answering a different question
 * than the client-side index it is meant to sit behind "is not a fallback".
 * Sharing the adapter is what makes that structurally true rather than a
 * promise two files could quietly stop keeping.
 *
 * ## What is different from `SearchDocument`
 *
 * - `href` is **locale-prefixed** (`localeHref`), because a server-side reader
 *   (T803) or a row synced into Supabase has no page-local `docHref` to finish
 *   the job — unlike `SearchDocument.href`, which stays unprefixed until
 *   `[searchSegment].astro` renders it.
 * - The identity is the composite `{ collection, entryId, locale }` key
 *   `tests/sync/contract.ts` names as the table's primary key, not
 *   `SearchDocument`'s joined `` `${type}:${id}` `` string.
 * - One row **per locale**, not one `SearchDocument[]` per page request — this
 *   endpoint loops `LOCALES` itself and emits both locales' rows in one
 *   response, since the sync job needs the whole corpus in one read.
 *
 * refs specs/001-foundation (RM-01, RM-02, SRCH-01, SRCH-02)
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { LOCALES, localeHref, type Locale } from "../i18n/routing";
import { t } from "../i18n/ui";
import {
  glossaryCorpusRows,
  modsCorpusRows,
  partsCorpusRows,
  problemsCorpusRows,
  type SearchCorpusRow,
} from "../lib/search-corpus";
import type {
  ReferenceSearchCollection,
  ReferenceSearchRow,
} from "../lib/sync/reference-search";

// Static output (SCF-01): this route is prerendered once at build time, the
// same as every page on this site, and never runs per-request.
export const prerender = true;

/** `SearchCorpusRow[]` + a collection tag, mapped to the read-model's row shape. */
function toReferenceSearchRows(
  collection: ReferenceSearchCollection,
  locale: Locale,
  rows: readonly SearchCorpusRow[]
): ReferenceSearchRow[] {
  return rows.map((row) => ({
    collection,
    entryId: row.entryId,
    locale,
    href: row.routePath === null ? null : localeHref(locale, row.routePath),
    title: row.title,
    subtitle: row.subtitle,
    snippet: row.snippet,
    badges: row.badges,
    codes: row.codes,
    extra: row.extra,
  }));
}

export const GET: APIRoute = async () => {
  const glossaryEntries = await getCollection("glossary");
  const problemEntries = await getCollection("problems");
  const partsEntries = await getCollection("parts");
  const modsEntries = await getCollection("mods");

  const rows: ReferenceSearchRow[] = [];
  for (const locale of LOCALES) {
    const strings = t(locale);
    rows.push(
      ...toReferenceSearchRows(
        "glossary",
        locale,
        glossaryCorpusRows(glossaryEntries, locale, strings)
      ),
      ...toReferenceSearchRows(
        "problems",
        locale,
        problemsCorpusRows(problemEntries, locale, strings)
      ),
      ...toReferenceSearchRows(
        "parts",
        locale,
        partsCorpusRows(partsEntries, locale, strings)
      ),
      ...toReferenceSearchRows(
        "mods",
        locale,
        modsCorpusRows(modsEntries, locale, strings)
      )
    );
  }

  return new Response(JSON.stringify({ rows }), {
    headers: { "content-type": "application/json" },
  });
};
