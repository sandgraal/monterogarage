/**
 * The procedures index's system filter (PRC-01), as a pure function.
 *
 * Split out of the page template for the reason `glossary-filter.ts`,
 * `community-filter.ts`, `parts/filter.ts` and `mods/filter.ts` are: the page's
 * `<script>` is DOM wiring, and what a pill *matches* is a rule that deserves a
 * unit test without a browser. It also means the server render and the browser
 * answer the question with the same code, so the first paint and the first
 * click cannot disagree.
 *
 * One facet, deliberately. A reader arrives at this listing holding a **job**
 * ("I need to change the oil"), and the narrowing that helps is the system.
 * Difficulty and time are already chips on every card; filtering on them would
 * be the listing helping somebody rule out the repair they actually have to do.
 *
 * Nothing here knows anything about fitment (FIT-01). FIT-03's vehicle filter
 * is a *different shape* of control that dims rather than hides — the Selector
 * artboard's "never hidden silently", T204's own rule — and it is owned by
 * `src/lib/vehicle-listing.ts`. That distinction matters more on this listing
 * than on any other: a procedure that "does not fit" is often the very job a
 * reader is trying to rule out for their truck, and the site owes them the
 * chance to disagree with its match, provisional matches included.
 *
 * refs specs/001-foundation (PRC-01, FIT-01, FIT-03)
 */

/** What one card carries, as the DOM stores it. */
export interface ProceduresCardFacets {
  readonly system: string;
}

/** The pills' state. `""` means "all" — the pill the group starts on. */
export interface ProceduresFilterState {
  system: string;
}

export const EMPTY_PROCEDURES_FILTER: ProceduresFilterState = { system: "" };

/**
 * Whether a card survives the current filter.
 *
 * An unset facet matches everything, and matching is exact-string: systems are
 * ids from a closed vocabulary (`GLOSSARY_SYSTEMS`), never free text, so there
 * is nothing to normalize and a near-match would be a bug rather than a
 * kindness.
 */
export function matchesProceduresFilter(
  card: ProceduresCardFacets,
  state: ProceduresFilterState
): boolean {
  if (state.system === "") return true;
  return card.system === state.system;
}
