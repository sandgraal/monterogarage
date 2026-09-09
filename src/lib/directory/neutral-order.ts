/**
 * The community directory's neutral ordering — **T3-203 [PLATFORM]**, SHP-05.
 *
 * > **SHP-05** THE community directory's ordering, inclusion, and editorial
 * > content SHALL be unaffected by whether a shop has an account, a claim, or a
 * > plan. The directory is curated content under 001 COM-01 and stays that way.
 *
 * ## Why this is a module, not an inline sort in the page
 *
 * The exact reason `src/lib/community-filter.ts` was split out of the directory
 * `.astro` page: a render decision that a spec pins is only trustworthy if it is
 * unit-testable without a browser. SHP-05 says the directory's *order and
 * inclusion* are a pure function of the git-owned `community` content — provably
 * independent of who is claimed, who is a member, and any subscription/plan
 * state. So the ordering lives here, the page delegates to it
 * (`tests/pages/directory-neutrality.render.test.ts` grades the wiring), and
 * `tests/shop/directory.test.ts` proves the invariance directly: it calls
 * `directoryListing` with a corpus of "tempting" contexts (a claimed-and-paid
 * entry, a viewer who is a member) and asserts the output is byte-for-byte
 * identical to the empty-context output. MON-05 restates SHP-05 as a money rule
 * "because it will be tempting later"; this module makes the temptation
 * unrepresentable.
 *
 * ## How the invariance is structural, not merely tested
 *
 * `directoryListing` reads `context` for **nothing**. The parameter exists only
 * so a grader can hand it every field that could tempt a non-neutral ranking and
 * prove none of them changes the output. The ordering is a function of the
 * entries' `title` alone (a git-owned, editorial field), and the optional
 * `compare` a caller may pass receives only two `string` titles — it is
 * structurally unable to see a claim, a membership, or a plan, so no caller can
 * smuggle a paid ranking in through it either.
 *
 * refs specs/003-shop-tools (SHP-05, MON-05), specs/001-foundation (COM-01)
 */

/** One directory entry, reduced to what ordering and inclusion may depend on. */
export interface DirectoryEntry {
  /** The git-owned community entry's content id — the stable listing identity. */
  readonly id: string;
  /** The editorial title the neutral order sorts by (git-owned prose). */
  readonly title: string;
}

/**
 * Everything a *non-neutral* directory would react to: who is viewing, which
 * entries are claimed, which shops the viewer belongs to, and each shop's plan.
 * SHP-05 says the ordering/inclusion output ignores every field here — so this
 * type exists to be *received and not read*, which is exactly what lets a grader
 * prove the output is invariant under it. Every field is optional so a caller
 * that knows none of them (the public directory page) can pass `{}`.
 */
export interface DirectoryContext {
  readonly viewerAccountId?: string | null;
  readonly claims?: readonly unknown[];
  readonly memberships?: readonly string[];
  readonly plans?: Readonly<Record<string, string>>;
}

/** A locale-agnostic, deterministic title comparison — the neutral default. */
function defaultCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The ordered list of entry ids the directory shows.
 *
 * A pure function of `entries` (their git-owned titles): every entry appears
 * exactly once, ordered by title, and `context` changes nothing. `compare` is an
 * optional presentation facet — the page passes a locale `Intl.Collator` so
 * `/es/comunidad/` collates in Spanish and `/en/community/` in English — and it
 * only ever sees two title strings, never a claim or a plan, so it cannot alter
 * *which* entries appear or make the order depend on anything but the content.
 */
export function directoryListing(
  entries: readonly DirectoryEntry[],
  // Received, deliberately never read — see the module docstring (SHP-05).
  _context?: DirectoryContext | null,
  compare: (a: string, b: string) => number = defaultCompare
): readonly string[] {
  return [...entries]
    .sort((a, b) => compare(a.title, b.title))
    .map((entry) => entry.id);
}
