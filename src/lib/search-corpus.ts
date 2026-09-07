/**
 * The four indexed collections, mapped to one shared row shape — the single
 * place that answers "what does this glossary/problems/parts/mods entry look
 * like as a search result", reused by both the client-side index
 * (`[searchSegment].astro`, SRCH-01/SRCH-02) and the Supabase read-model
 * export (`src/pages/search-index.json.ts`, RM-01/RM-02, T802).
 *
 * ## Why this module exists, and why it did not before T802
 *
 * Before this task, `[searchSegment].astro` was the only reader of these four
 * collections, so its four inline `.map()` adapters were the whole of "how a
 * glossary term becomes a search result". T802 needs the same mapping a
 * second time — the read-model export needs the same title, the same
 * snippet, the same badge text, the same alias/symptom "extra" chips a
 * reader's browser already shows — and copying those four blocks into a
 * second file is exactly the drift `src/lib/sync/reference-search.ts`'s
 * docstring warns about: "a fallback that returns a different result set
 * than the thing it falls back from is not a fallback." So the four adapters
 * moved here, and `[searchSegment].astro` now calls them instead of defining
 * them — one implementation, two callers, not two implementations that can
 * quietly disagree about what a badge says.
 *
 * ## What this module deliberately does NOT decide
 *
 * A {@link SearchCorpusRow}'s `routePath` is **unprefixed** — no `/en`, no
 * deploy base — the same "add the prefix at the call site" contract
 * `entryRoutePath`/`collectionRoutePath` already promise. Prefixing it
 * (`localeHref`, for a page reader) or turning it into a
 * `${locale}:${collection}:${entryId}` composite key (for the read-model) is
 * each caller's own job; this module only ever answers "what route, in this
 * locale, unprefixed, or `null` when there is none".
 *
 * Nothing here talks to Supabase, `astro:content`'s `getCollection`, or the
 * DOM. It takes already-loaded entries (whatever `getCollection(...)`
 * returned) and a locale and returns plain data — same discipline
 * `src/lib/search.ts`'s own docstring asks for ("this module never mentions
 * `glossary`, `problems`, `parts` or `mods` by name"), except this module is
 * the one place that *does* know their names, on purpose: it is the seam
 * between "a collection's own schema" and "the collection-agnostic shape"
 * `search.ts` and the read-model both consume.
 *
 * refs specs/001-foundation (SRCH-01, SRCH-02, RM-01, RM-02)
 */
import type { CollectionEntry } from "astro:content";
import {
  collectionRoutePath,
  entryRoutePath,
  COLLECTION_ROUTE_SEGMENTS,
} from "../i18n/routes";
import { LOCALES, type Locale } from "../i18n/routing";
import { glossaryTermDomId } from "./glossary-filter";
import { problemRoutePath } from "./problems";
import {
  glossarySystemLabel,
  problemSeverityLabel,
  type UiStrings,
} from "../i18n/ui";

/**
 * One entry, shaped for either caller to finish mapping into its own result
 * type (`SearchDocument` or `ReferenceSearchRow`).
 *
 * `entryId` is always the entry's own `data.id` — the stable, author-assigned
 * identity `defineEntrySchema` requires on every collection
 * (`src/schemas/entry.ts`'s `RESERVED_ENTRY_FIELDS`), not Astro's
 * file-path-derived `entry.id`. The two happen to agree on every entry in
 * this corpus today, but `data.id` is the one the entry-slug registry
 * (`src/i18n/entry-slugs.ts`) and every `entryRoutePath` call already key by,
 * so using it here keeps one identity per entry instead of two that could
 * drift apart the day a file is renamed.
 */
export interface SearchCorpusRow {
  readonly entryId: string;
  /** Unprefixed — see module docstring. `null` when the entry has no route. */
  readonly routePath: string | null;
  readonly title: string;
  readonly subtitle: string | null;
  readonly snippet: string;
  readonly badges: readonly string[];
  readonly codes: readonly string[];
  readonly extra: readonly string[];
}

/**
 * SRCH-02: every alias renders the same way the glossary page's own alias
 * chips do — term and countries together (`rin (CR/MX)`) — so a reader who
 * searches a regional alias finds the canonical entry because its own card
 * already says the alias.
 */
export function glossaryCorpusRows(
  entries: readonly CollectionEntry<"glossary">[],
  locale: Locale,
  strings: UiStrings
): SearchCorpusRow[] {
  const otherLocales = LOCALES.filter((candidate) => candidate !== locale);

  return entries.map((entry) => {
    const { id: entryId, system, aliases } = entry.data;
    const gloss = otherLocales
      .map((other) => entry.data.prose[other].title)
      .filter((term) => term.length > 0);

    return {
      entryId,
      routePath: `${collectionRoutePath("glossary", locale)}#${glossaryTermDomId(entryId)}`,
      title: entry.data.prose[locale].title,
      subtitle: gloss.length > 0 ? gloss.join(" / ") : null,
      snippet: entry.data.prose[locale].summary,
      badges: [glossarySystemLabel(strings, system)],
      codes: [],
      extra: aliases.map(
        (alias) => `${alias.term} (${alias.countries.join("/")})`
      ),
    };
  });
}

/** SRCH-01's "symptoms" — the same resolved text the problems index shows. */
export function problemsCorpusRows(
  entries: readonly CollectionEntry<"problems">[],
  locale: Locale,
  strings: UiStrings
): SearchCorpusRow[] {
  const problemsSegment = COLLECTION_ROUTE_SEGMENTS.problems[locale];

  return entries.map((entry) => {
    const { data } = entry;
    const prose = data.prose[locale];

    return {
      entryId: data.id,
      routePath: problemRoutePath(problemsSegment, prose.slug),
      title: prose.title,
      subtitle: null,
      snippet: prose.summary,
      badges: [
        glossarySystemLabel(strings, data.system),
        problemSeverityLabel(strings, data.severity),
      ],
      codes: [],
      extra: data.symptoms.map((id) => prose.symptoms[id] ?? id),
    };
  });
}

/** SRCH-01's "part numbers": the OEM number and every cross-referenced one. */
export function partsCorpusRows(
  entries: readonly CollectionEntry<"parts">[],
  locale: Locale,
  strings: UiStrings
): SearchCorpusRow[] {
  return entries.map((entry) => {
    const { id, oemNumber, system, crossReferences } = entry.data;
    const local = entry.data.prose[locale];
    const crossRefs = crossReferences ?? [];

    return {
      entryId: id,
      routePath: entryRoutePath("parts", id, locale),
      title: local.title,
      subtitle: null,
      snippet: local.summary,
      badges: [glossarySystemLabel(strings, system)],
      codes: [oemNumber, ...crossRefs.map((cross) => cross.partNumber)],
      extra: crossRefs.map((cross) => `${cross.brand} ${cross.partNumber}`),
    };
  });
}

export function modsCorpusRows(
  entries: readonly CollectionEntry<"mods">[],
  locale: Locale,
  strings: UiStrings
): SearchCorpusRow[] {
  return entries.map((entry) => {
    const { id, system } = entry.data;
    const local = entry.data.prose[locale];

    return {
      entryId: id,
      routePath: entryRoutePath("mods", id, locale),
      title: local.title,
      subtitle: null,
      snippet: local.summary,
      badges: [glossarySystemLabel(strings, system)],
      codes: [],
      extra: [],
    };
  });
}
