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

/**
 * The displayed length of a result card's snippet (SCF-06 follow-up,
 * PR #106 review). `[searchSegment].astro` uses this to shorten what a card
 * *shows*; {@link splitSnippet}'s `hidden` half keeps the rest of the text
 * reachable to {@link buildSearchHaystack} at effectively no rendering cost
 * (see that function's docs for why — this is not the same trade a naive
 * `title="…full text…"` attribute would make).
 *
 * **150, not the first cut's 200** (second SCF-06 round: the first round
 * cleared `/en/search/` at 91/90 but left `/es/buscar/` at 89/90, and CI's
 * own noise band at that margin ran several points wide on repeat runs of
 * the *same* commit — 90 by a hair is not the target, margin above the
 * noise is). 200 was already generous relative to glossary definitions,
 * which average ~225–247 characters (EN/ES) — meaning **most glossary
 * entries were being truncated at 200 already**, not "mostly fitting
 * under it" as the first cut's reasoning claimed; 150 is honest about
 * that instead of asserting a headroom that was not really there.
 * `problems` entries' summaries — full paragraphs, averaging **1170
 * characters in EN and 1284 in ES** — stay the dominant weight
 * contributor either way and are cut hard regardless of where exactly
 * this constant sits.
 */
export const SNIPPET_MAX_LENGTH = 150;

/**
 * The displayed length of a result card's joined "extra" chip — every
 * alias (glossary) or symptom bullet (problems) the card carries, folded
 * into one chip's text (`[searchSegment].astro`'s own `doc.extra.join(" · ")`
 * before this fix; now that join is what {@link splitSnippet} receives).
 *
 * Deliberately shorter than {@link SNIPPET_MAX_LENGTH} and a separate
 * constant rather than the same number reused: glossary aliases, joined,
 * average only ~50 characters and top out (p90) around 121 across this
 * corpus — a chip has no need for `SNIPPET_MAX_LENGTH`'s budget and almost
 * never uses it. `problems` symptom lists average ~274–306 characters
 * joined, comparable in shape to a short snippet, and are exactly where
 * this earns the same keep the snippet cut does.
 */
export const EXTRA_MAX_LENGTH = 120;

/** The two halves {@link splitSnippet} divides a snippet into. */
export interface SnippetParts {
  /** What the card shows — `text` unchanged, or a `…`-suffixed prefix. */
  readonly visible: string;
  /**
   * Whatever `visible` cut off, verbatim — `""` when nothing was cut.
   * `visible`'s content (with its trailing `…` removed) followed by `hidden`
   * reconstructs `text` exactly; nothing is duplicated between the two.
   */
  readonly hidden: string;
}

/**
 * Split `text` into a short, displayable `visible` prefix and a `hidden`
 * remainder, breaking on the last word boundary at or before `maxLength`
 * rather than mid-word. Text already at or under the limit is returned
 * whole, as `{ visible: text, hidden: "" }` — no ellipsis added to a
 * snippet that was never truncated.
 *
 * ## Why a hidden remainder and not a `title` attribute
 *
 * The first version of this fix put the *entire* untruncated snippet into a
 * `title` attribute so search could still find it — which is exactly
 * backwards for a page-weight fix: it left the shortened text on display
 * *and added a second, full copy* of the same string as an attribute value,
 * making the page larger, not smaller (caught before merge — see PR #106's
 * history). The two `SnippetParts` are non-overlapping instead: concatenated
 * they equal `text` exactly once, so nothing is stored twice.
 *
 * `[searchSegment].astro` renders `hidden` inside a `.visually-hidden` span
 * (this page's existing sr-only recipe, already used for the search box's
 * own `<label>`) rather than dropping it: a browser does essentially no
 * layout or paint work for a clipped, one-line, off-screen span regardless
 * of how much text is inside it, so the bulk of a long `problems` summary
 * costs render time only while it is *visible* — but `element.textContent`
 * still walks into hidden descendants, so {@link buildSearchHaystack}
 * (which reads a card's rendered `textContent`) sees `visible + hidden`,
 * i.e. the complete original snippet, and SRCH-01 recall is unaffected.
 *
 * The word-boundary search only looks within the trailing quarter of the
 * budget (`maxLength / 4`): a `text` with no whitespace anywhere near the
 * cut point (one very long word, or a language whose script does not use
 * ASCII spaces) falls back to a hard cut rather than trimming away most of
 * the budget hunting for a boundary that is not there.
 *
 * Safe on this corpus's Spanish text: accented Latin letters (`á`, `ñ`, …)
 * are single UTF-16 code units in ordinary (non-decomposed) form, which is
 * how every `prose.es` value in this repo is authored and how `.length` and
 * string slicing count — so a cut point never lands inside one character,
 * the way it could if the text had been NFD-decomposed first (see
 * `src/lib/text.ts`'s own note on why `normalizeForSearch` decomposes and
 * this function deliberately does not).
 */
export function splitSnippet(
  text: string,
  maxLength: number = SNIPPET_MAX_LENGTH
): SnippetParts {
  if (text.length <= maxLength) return { visible: text, hidden: "" };

  const hardCut = text.slice(0, maxLength);
  const boundary = hardCut.lastIndexOf(" ");
  const minBoundary = maxLength - Math.floor(maxLength / 4);
  const cutIndex = boundary >= minBoundary ? boundary : maxLength;

  // `visibleRaw` and `hidden` are complementary slices of the same string at
  // the same index (`text.slice(0, i) + text.slice(i) === text` for any
  // `i`), so trimming only ever moves characters from one side to the
  // other — it can never lose or duplicate one.
  const visibleRaw = text.slice(0, cutIndex).trimEnd();
  const hidden = text.slice(visibleRaw.length);

  return { visible: `${visibleRaw}…`, hidden };
}

/**
 * The `visible` half of {@link splitSnippet} on its own, for a caller that
 * only wants what the card shows and does not need to render the hidden
 * remainder (every existing caller before this one did, hence this stays a
 * separate, smaller function rather than every call site destructuring the
 * pair).
 */
export function truncateSnippet(
  text: string,
  maxLength: number = SNIPPET_MAX_LENGTH
): string {
  return splitSnippet(text, maxLength).visible;
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
