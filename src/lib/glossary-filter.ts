/**
 * The glossary page's filter logic (GLO-04), as pure functions.
 *
 * Split out of `src/pages/[locale]/[glossarySegment].astro` so the rules are
 * unit-testable without a browser: the `.astro` `<script>` keeps only the DOM
 * wiring (find elements, toggle `hidden`, set `aria-pressed`), which is what
 * T204's Playwright suite will cover when it arrives. Everything that decides
 * *whether a term is shown* lives here.
 *
 * `formatCount` is shared by the server render and the client update, so the
 * counter says the same thing before and after the first keystroke and the
 * `{shown}` / `{total}` placeholder contract exists in one place.
 *
 * ## `buildHaystack` — no server-rendered `data-haystack` (SCF-06 follow-up)
 *
 * At 153 glossary terms the page used to carry the searchable text *twice*:
 * once as the visible card (canonical term, gloss, both definitions, system
 * label, alias chips) and again as a normalized `data-haystack` attribute on
 * every `<li>` — roughly 73 kB of the page's ~383 kB, for text a reader
 * never sees and a crawler already has in the chip markup. `buildHaystack`
 * takes the same *parts* the card already renders (read from the live DOM by
 * the `.astro` script's thin wiring, once per card, not per keystroke) and
 * normalizes them the same way `normalizeForSearch` always has, so the
 * matched set is unchanged — only the duplicate encoding is gone. The one
 * intentional narrowing: the *other* locale's system label (e.g. the Spanish
 * word for "brakes" while reading `/en/glossary/`) is no longer indexed,
 * because it was never rendered either — GLO-03/SRCH-02 promise alias
 * recall, not a translated category name nobody sees.
 */
import { normalizeForSearch } from "./text";

/**
 * The glossary page's own DOM id for one entry's card, `#term-<id>` with `/`
 * replaced (nested entry ids carry one, and `/` is not id-safe).
 *
 * Shared rather than reimplemented: `[glossarySegment].astro` uses it to
 * build the id it renders, and `[searchSegment].astro` (T702) uses the same
 * function to build the `#term-…` fragment its own cards link to — two
 * copies of this format existing anywhere is a page whose search result
 * links to an anchor that does not exist, silently, the day either drifts.
 */
export function glossaryTermDomId(id: string): string {
  return `term-${id.replace(/\//g, "--")}`;
}

/** What a card carries, as the filter sees it. */
export interface GlossaryFilterCard {
  /** The card's system id, `data-system`. */
  readonly system: string;
  /**
   * Pre-normalized searchable text. Built client-side by `buildHaystack`
   * from the card's own rendered text — there is no server-rendered
   * `data-haystack` attribute (SCF-06 follow-up; see the module docs).
   */
  readonly haystack: string;
}

/** One alias chip's searchable parts, as rendered (country tags joined, e.g. `"CR/MX"`). */
export interface GlossaryHaystackAlias {
  readonly term: string;
  readonly countries: string;
}

/**
 * The parts of a rendered card that are searchable, read once from the DOM
 * by the page's `<script>` and passed here rather than re-derived from
 * content data — so the haystack can never say something the card does not
 * actually show.
 */
export interface GlossaryHaystackSource {
  /** Both locales' term text (canonical + gloss). */
  readonly terms: readonly string[];
  /** Both locales' definition text. */
  readonly definitions: readonly string[];
  /** The rendered system label, page locale only (see module docs). */
  readonly system: string;
  /** Every alias chip, regardless of locale or country. */
  readonly aliases: readonly GlossaryHaystackAlias[];
}

/**
 * Normalize a card's rendered parts into the same haystack shape the page
 * used to serialize into `data-haystack`, without shipping the duplicate
 * bytes. See the module docs for why this is safe for SRCH-02 recall.
 *
 * Country tags render joined (`alias.countries`, e.g. `"CR/DO"`), which is
 * one token to `normalizeForSearch` — a `/` is not whitespace. The pre-T206
 * server-rendered haystack joined each country as its own array element
 * (`" "`-separated), so `"CR DO"` matched. Splitting `alias.countries` back
 * into its own tokens alongside the raw joined string keeps both shapes
 * findable — a single country code, the slash-joined chip text as shown, or
 * a space-separated pair — without reintroducing the duplicate bytes this
 * function exists to remove.
 */
export function buildHaystack(source: GlossaryHaystackSource): string {
  return normalizeForSearch(
    [
      ...source.terms,
      ...source.definitions,
      source.system,
      ...source.aliases.flatMap((alias) => [
        alias.term,
        alias.countries,
        ...alias.countries.split("/"),
      ]),
    ].join(" ")
  );
}

/** The active filter state. */
export interface GlossaryFilterState {
  /** A system id, or `""` for "no system filter". */
  readonly system: string;
  /** The raw text from the search box; normalized here, not by the caller. */
  readonly query: string;
}

/**
 * Whether a card survives the current filter.
 *
 * Both halves are AND-ed and both are permissive when empty, so the initial
 * state (`{ system: "", query: "" }`) shows everything — the same set the
 * server rendered, which is what makes the enhancement invisible on load.
 *
 * The query is matched as a *substring* of the normalized haystack rather
 * than as a whole word, unlike `check:glossary`'s conformance scan: a person
 * typing `neum` mid-word wants results, whereas a merge-blocking gate firing
 * mid-word would be a false positive. Different jobs, deliberately different
 * rules.
 */
export function matchesFilter(
  card: GlossaryFilterCard,
  state: GlossaryFilterState
): boolean {
  if (state.system !== "" && card.system !== state.system) return false;
  const query = normalizeForSearch(state.query);
  if (query === "") return true;
  return card.haystack.includes(query);
}

/** How many of `cards` the filter keeps. */
export function countMatches(
  cards: readonly GlossaryFilterCard[],
  state: GlossaryFilterState
): number {
  return cards.reduce(
    (total, card) => (matchesFilter(card, state) ? total + 1 : total),
    0
  );
}

/**
 * `"Showing {shown} of {total} terms"` filled in. The template is localized
 * prose from `src/i18n/ui.ts`; the figures are computed and interpolated, so
 * neither number is ever written into a locale (AGENTS.md).
 */
export function formatCount(
  template: string,
  shown: number,
  total: number
): string {
  return template
    .replace("{shown}", String(shown))
    .replace("{total}", String(total));
}
