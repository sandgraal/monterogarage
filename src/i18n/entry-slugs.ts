/**
 * The per-**entry** slug registry (I18N-05).
 *
 * > **I18N-05** WHERE a collection page has per-locale slugs (e.g.
 * > `/en/problems/…`, `/es/problemas/…`), THE slug registry SHALL map each
 * > entry to exactly one slug per locale, and a CI check SHALL fail on
 * > collisions or missing mappings.
 *
 * ## Why this is not `src/i18n/routes.ts`
 *
 * That registry maps a **collection** to its path *segment* — one row per
 * collection, `/en/parts/` ↔ `/es/repuestos/`. This one maps an **entry** to
 * its slug *within* that segment — one row per document,
 * `/en/parts/water-pump-6g74/` ↔ `/es/repuestos/bomba-de-agua-6g74/`. They are
 * different tables answering different questions, and both feed the same
 * validator (`validateSlugRegistry`), which is the rule I18N-05 actually
 * states.
 *
 * ## Why the slugs live here and not on the entry
 *
 * A slug is a *collision-prone* value: two entries claiming
 * `bomba-de-agua` produce a URL that silently resolves to one of them.
 * Spread across entry files, that collision is invisible until someone reads
 * every file; in one table, it is a build error naming both entries. I18N-05
 * says "THE slug registry", singular, for this reason — and `routes.ts`
 * already set the precedent of a hand-written registry validated at module
 * load, so a bad row fails `astro build` rather than shipping a broken link.
 *
 * It also keeps the URL out of the content schema, where it would be a
 * per-locale string that is not prose and not a fact — the one field that fits
 * neither half of the data/prose split.
 *
 * ## For the agent adding entries (T503, T602 and after)
 *
 * Add one row per entry, keyed by the entry's own `id`:
 *
 * ```ts
 * parts: {
 *   "g3-cooling-water-pump-6g74": {
 *     en: "water-pump-6g74",
 *     es: "bomba-de-agua-6g74",
 *   },
 * }
 * ```
 *
 * The ES slug is a Costa Rican reader's own words, not the English one with an
 * accent — the same rule the `repuestos` segment follows. Two entries may
 * share a slug across *locales* (many part slugs are the same word in EN and
 * ES); two entries may not share one *within* a locale. Both rules are
 * `validateSlugRegistry`'s, and neither is restated here.
 *
 * An entry with no row (or a row naming no entry) fails the build —
 * `src/integrations/validate-parts.ts` — because a parts entry with no slug
 * is a page that was never built and a row with no entry is a link to
 * nothing.
 *
 * ## Import style
 *
 * Every import below carries its `.ts` extension: this module is reachable
 * from an Astro build hook, which Node's own ESM resolver walks (see
 * `astro.config.mjs`). It deliberately does **not** import `./routes.ts` —
 * that dependency runs the other way, so the path helpers can live beside the
 * segments they are built from without dragging them onto the hook's chain.
 *
 * refs specs/001-foundation (I18N-05, PRT-01)
 */
import { LOCALES, type Locale } from "./routing.ts";
import { validateSlugRegistry, type SlugRegistry } from "../schemas/slugs.ts";

/**
 * `{ [collection]: { [entryId]: { en, es } } }`.
 *
 * Empty for both collections today: T501 and T601 built the schemas and the
 * page templates, and T503 / T602 author the entries. An empty table is a
 * valid registry — it maps every one of its zero entries to exactly one slug
 * per locale — and the build checks (`src/integrations/validate-parts.ts`,
 * `validate-mods.ts`) turn the first unlisted entry into a named error.
 */
export const ENTRY_SLUGS: Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<Locale, string>>>>>
> = {
  /** PRT-01 — one page per part number. Populated by T503. */
  parts: {},
  /** MOD-01 — one page per modification. Populated by T602. */
  mods: {},
  /**
   * PRC-01 — one page per job. Populated by T504.
   *
   * The namespace is opened empty, on T501's precedent: the build's "every
   * entry has a slug row, every row names an entry" check
   * (`src/integrations/validate-procedures.ts`) needs something to compare
   * against, and `slugRegistryIds("procedures")` has to answer `[]` rather
   * than `undefined` from the day the page template lands.
   *
   * The ES slug is a Costa Rican reader's own words, never the English one
   * with an accent: `cambio-de-aceite-6g74`, not `oil-change-6g74`.
   */
  procedures: {},
};

const registryIssues = validateSlugRegistry(ENTRY_SLUGS as SlugRegistry);

if (registryIssues.length > 0) {
  throw new Error(
    `ENTRY_SLUGS is not a valid slug registry ` +
      `(${registryIssues.length} problem(s)):\n` +
      registryIssues.map((issue) => `  • ${issue.message}`).join("\n") +
      `\nEvery entry page needs exactly one slug per locale, unique within ` +
      `that locale (I18N-05). refs specs/001-foundation`
  );
}

/** The entry ids this registry lists for `collection`, in declaration order. */
export function slugRegistryIds(collection: string): readonly string[] {
  return Object.keys(ENTRY_SLUGS[collection] ?? {});
}

/** One entry's slug in one locale, or `null` when the entry has no row. */
export function entrySlug(
  collection: string,
  entryId: string,
  locale: Locale
): string | null {
  return ENTRY_SLUGS[collection]?.[entryId]?.[locale] ?? null;
}

/**
 * Every locale's slug for one entry, or `null` when the entry has no row.
 *
 * Returns the whole set rather than one locale at a time because that is what
 * an hreflang pair needs: a page that knew only its own slug could emit an
 * alternate link to a URL nobody built, which is exactly what
 * `check:hreflang` fails on.
 */
export function entrySlugs(
  collection: string,
  entryId: string
): Readonly<Record<Locale, string>> | null {
  const row = ENTRY_SLUGS[collection]?.[entryId];
  if (row === undefined) return null;
  for (const locale of LOCALES) {
    if (typeof row[locale] !== "string") return null;
  }
  return row;
}
