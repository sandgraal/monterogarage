/**
 * Site-wide client-side search (T702, SRCH-01, SRCH-02).
 *
 * > **SRCH-01** THE site SHALL provide client-side search per locale over
 * > titles, symptoms, glossary terms and aliases, and part numbers.
 * > **SRCH-02** WHEN a visitor searches a regional alias (e.g. `balatas`),
 * > THE results SHALL include the canonical entry (GLO-03).
 *
 * ## Collection-agnostic by construction
 *
 * This module never mentions `glossary`, `problems`, `parts` or `mods` by
 * name. It knows exactly one shape — {@link SearchDocument}, a `type` tag plus
 * the handful of text fields every collection can produce (`title`,
 * `snippet`, `badges`, `codes`, `extra`) — and matches against that shape
 * only. `src/pages/[locale]/[searchSegment].astro` is where each collection
 * meets this module: it reads `getCollection(...)`, maps each entry's own
 * fields into a `SearchDocument`, and concatenates the arrays. Adding a fifth
 * collection to the index (`procedures`, once T502 gives it a route to link
 * to) is one more `getCollection` call and one more `.map()` in that page —
 * never a change here, and never a second copy of the matching logic the way
 * a per-collection filter (`glossary-filter.ts`, `problems-filter.ts`,
 * `src/lib/parts/filter.ts`) would otherwise invite.
 *
 * `parts`, `procedures` and `mods` are allowed to be empty collections today
 * (T503/T502/T602 have not shipped content yet) — an adapter over zero
 * entries produces zero documents, `buildSearchHaystack` and
 * `matchesSearchFilter` are total functions over empty inputs, and nothing
 * here assumes a non-empty corpus. `garage` is deliberately never adapted:
 * 002 MIG-03 makes a user's garage entries private, Supabase-backed data
 * behind RLS, and this is a public, statically-built search index — indexing
 * it would leak private records into every reader's build output.
 *
 * ## Haystack built from the rendered card, not a second copy (SCF-06)
 *
 * Same discipline as `glossary-filter.ts`'s `buildHaystack` and
 * `problems-filter.ts`'s `buildHaystack`: {@link buildSearchHaystack} is
 * called client-side, once per card, from the DOM the server already
 * rendered — the card's own title, snippet, badge chips, code chips and
 * "extra" chips (aliases, symptom bullets, cross-reference numbers,
 * whichever the type carries) — never from a second `data-haystack`
 * attribute serialized into the page. A reader without JavaScript sees the
 * complete, server-rendered, unfiltered result list and no dead search box
 * (the toolbar is laid out only under `html.js`, the same CSS trick every
 * other listing page on this site uses).
 *
 * ## Two facets, ANDed, both permissive when empty
 *
 * `type` (a picked result kind, exact match) and `query` (free text,
 * substring match against the card's own haystack) default to `""` — the
 * same shape `glossary-filter.ts`'s `GlossaryFilterState` and
 * `problems-filter.ts`'s `ProblemFilterState` use, so the initial state
 * reproduces the server-rendered listing exactly.
 *
 * refs specs/001-foundation (SRCH-01, SRCH-02, GLO-03)
 */
import { normalizeForSearch } from "./text";

/**
 * Every kind of result the index currently carries, in the order the type
 * pills render. A collection joins this list the day its page can produce a
 * real `href` for a reader to land on — see the module docstring for why
 * `procedures` and `garage` are not here yet.
 */
export const SEARCH_DOCUMENT_TYPES = [
  "glossary",
  "problems",
  "parts",
  "mods",
] as const;

export type SearchDocumentType = (typeof SEARCH_DOCUMENT_TYPES)[number];

/** Whether `value` is one of {@link SEARCH_DOCUMENT_TYPES}. */
export function isSearchDocumentType(
  value: string
): value is SearchDocumentType {
  return (SEARCH_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * One result, already resolved to the page's own locale by whichever adapter
 * built it (glossary's canonical term in `locale`, a problem's `prose.slug`
 * href, a part's OEM number, …). Every field here is either already-rendered
 * text or a route a `localeHref` call away from a real link — nothing in
 * this module interprets fitment, confidence or safety; those stay each
 * entry's own detail page's job.
 */
export interface SearchDocument {
  /** Globally unique across the whole index: `` `${type}:${entryId}` ``. */
  readonly id: string;
  readonly type: SearchDocumentType;
  /**
   * The entry's route, in `locale`, **unprefixed** — the same "no `/en`, no
   * deploy base yet" contract `entryRoutePath` and `collectionRoutePath`
   * already promise, so the page's own `localeHref` call is the only place
   * the prefix is added. `null` when the entry has no route to link to (an
   * id absent from the slug registry) — the card then renders its title
   * unlinked rather than linking somewhere plausible-but-wrong, the same
   * rule `[partsSegment].astro` and `[modsSegment].astro` already follow.
   */
  readonly href: string | null;
  /** Page-locale title — a glossary term, a problem's title, … */
  readonly title: string;
  /**
   * Secondary text shown beside the title. Only the glossary adapter fills
   * this (the other locale's term, matching the glossary page's own
   * "headword leads, gloss follows" rule) — every other type leaves it
   * `null`.
   */
  readonly subtitle: string | null;
  /** Page-locale summary or definition. */
  readonly snippet: string;
  /** Rendered chip text: system, severity, supersession status, … */
  readonly badges: readonly string[];
  /** Rendered part-number chip text (SRCH-01's "part numbers"). */
  readonly codes: readonly string[];
  /**
   * Whatever else the type renders and wants searchable: a glossary entry's
   * alias chips (SRCH-02), a problem's symptom bullets (SRCH-01's
   * "symptoms"), a part's cross-reference rows.
   */
  readonly extra: readonly string[];
}

/**
 * The parts of a rendered result card that are searchable, read once from
 * the DOM by the page's `<script>` and passed here — never re-derived from
 * content data (see the module docstring's SCF-06 note).
 */
export interface SearchHaystackSource {
  readonly title: readonly string[];
  readonly subtitle: readonly string[];
  readonly snippet: readonly string[];
  readonly badges: readonly string[];
  readonly codes: readonly string[];
  readonly extra: readonly string[];
}

/**
 * Normalize a card's rendered parts into one searchable string, fields
 * joined by a space so two adjacent fields can never fuse into a false
 * substring match (`["front"]` + `["axle"]` reads as `"front axle"`, not
 * `"frontaxle"` — a query spanning the boundary, `"ntax"`, correctly misses).
 *
 * Accent- and case-insensitive via `normalizeForSearch` — the same function
 * `glossary-filter.ts` and `problems-filter.ts` use, so a reader typing
 * `neumatico` still finds `neumático` and `MD976075` still finds `md976075`.
 */
export function buildSearchHaystack(source: SearchHaystackSource): string {
  return normalizeForSearch(
    [
      ...source.title,
      ...source.subtitle,
      ...source.snippet,
      ...source.badges,
      ...source.codes,
      ...source.extra,
    ].join(" ")
  );
}

/** One card's already-normalized filterable text, as the filter sees it. */
export interface SearchFilterCard {
  readonly type: string;
  readonly haystack: string;
}

/**
 * The active filter state. `""` is permissive for both facets.
 *
 * **`normalizedQuery` is already normalized** (`normalizeForSearch`) by the
 * caller — this module never calls `normalizeForSearch` on it. That is a
 * deliberate performance fix (code review on PR #106, SCF-06): the search
 * box's `input` handler fires once per keystroke and calls
 * {@link matchesSearchFilter} once per rendered card — 221 cards at this
 * index's current size — so normalizing inside this function meant redoing
 * the same NFD-decompose-and-strip-marks work 221 times over for one
 * keystroke instead of once. `[searchSegment].astro`'s `input` listener now
 * normalizes exactly once per event, before the per-card loop, and every
 * card compares against that one already-normalized string.
 */
export interface SearchFilterState {
  /** A `SearchDocumentType`, or `""` for "every type". */
  readonly type: string;
  /**
   * Pre-normalized query text, or `""` for "no query" (permissive). Passing
   * raw, un-normalized text here is a caller bug, not something this
   * function corrects — see the interface docs above for why.
   */
  readonly normalizedQuery: string;
}

/**
 * Whether a card survives the current filter.
 *
 * Both facets are ANDed and both are permissive when empty — the same
 * contract `glossary-filter.ts`'s `matchesFilter` and `problems-filter.ts`'s
 * `matchesFilter` state, so the enhancement reproduces the server-rendered,
 * unfiltered listing on load. Unlike those two, this function does not
 * itself call `normalizeForSearch` — see `SearchFilterState`'s docs.
 */
export function matchesSearchFilter(
  card: SearchFilterCard,
  state: SearchFilterState
): boolean {
  if (state.type !== "" && card.type !== state.type) return false;
  if (state.normalizedQuery === "") return true;
  return card.haystack.includes(state.normalizedQuery);
}

/** How many of `cards` the filter keeps. */
export function countSearchMatches(
  cards: readonly SearchFilterCard[],
  state: SearchFilterState
): number {
  return cards.reduce(
    (total, card) => (matchesSearchFilter(card, state) ? total + 1 : total),
    0
  );
}
