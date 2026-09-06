/**
 * Per-locale collection route segments (I18N-01, I18N-05).
 *
 * A Costa Rican reader looking for the glossary looks for `/es/glosario/`, not
 * `/es/glossary/`. I18N-01 says neither locale is privileged, and leaving the
 * English word in the Spanish URL privileges English in the one place a reader
 * can see it. So the *segment* is per-locale, and this module is the single
 * registry of which segment each collection uses in each locale.
 *
 * ## Why this is not `src/schemas/slugs.ts`
 *
 * I18N-05's registry maps **entries** to slugs (`{ collection: { entryId: {
 * en, es } } }`) — one row per document, checked for collisions inside a
 * collection. This registry maps **collections** to their path segment: one
 * row per collection, and there is exactly one glossary page, not one page per
 * term (GLO-04: "THE glossary SHALL render as a public bilingual reference
 * page", singular; the artboard shows every term as a card on that one page).
 *
 * They are different tables, but the *rule* is identical — exactly one value
 * per locale, no duplicates within a locale, no locale outside `en`/`es`. So
 * this module does not restate the rule: it feeds the registry to
 * {@link validateSlugRegistry}, the same validator I18N-05 uses, and throws at
 * module load if it fails. Module load happens during `astro build`, so a bad
 * registry is a build error rather than a broken link (SCF-04's spirit).
 * `tests/i18n/routes.test.ts` grades the validation itself.
 *
 * When per-entry pages arrive (T401's problem pages and friends), those get
 * `src/schemas/slugs.ts` proper; this registry keeps owning the segment those
 * URLs are nested under.
 *
 * refs specs/001-foundation (I18N-01, I18N-04, I18N-05, GLO-04)
 */
import { LOCALES, type Locale, type LocalizedRoutePaths } from "./routing";
import { validateSlugRegistry } from "../schemas/slugs";
import { entrySlugs, slugRegistryIds } from "./entry-slugs";

/**
 * Collection id → the path segment it is served under, per locale.
 *
 * Only collections that actually have a page appear here; a collection with no
 * page has no URL to name. Segments are lowercase, hyphenated, and never
 * URL-encoded — `glosario`, not `glosário`.
 */
export const COLLECTION_ROUTE_SEGMENTS = {
  glossary: { en: "glossary", es: "glosario" },
  /** T703a — the public community directory page (COM-01, COM-02). */
  community: { en: "community", es: "comunidad" },
  /**
   * T2-202 — the sign-in / account page (002 ACC-01, ACC-02).
   *
   * Not a content collection: it has no entries and never will. It is here
   * because this registry is what `BaseLayout` reads to emit hreflang pairs
   * and what the locale switcher reads to cross between `/en/sign-in/` and
   * `/es/ingresar/` — and a second registry with the same rule, for the same
   * job, is how the two drift apart. The type is
   * `Record<string, Record<Locale, string>>`, so "collection" was always the
   * *usual* caller rather than the only permitted one.
   */
  signIn: { en: "sign-in", es: "ingresar" },
  /**
   * T2-301 — the garage: a user's vehicles and their profiles (002 GAR-01′).
   *
   * The ES segment is **`taller`**, not `garaje`. That is the glossary's
   * ruling, not a preference: `all-general-taller` is the canonical term and
   * lists `garaje` as an alias tagged `ES`/`MX` — Spain and Mexico — which is
   * exactly the kind of regional variant AGENTS.md keeps out of prose and out
   * of URLs. In Costa Rica the place where the work happens is the taller, and
   * the ES sign-in page has been saying "Ingrese a su taller" since T2-202. A
   * `/es/garaje/` would have been the English word wearing a Spanish accent.
   */
  garage: { en: "garage", es: "taller" },
  /**
   * T401 — the symptom-driven problem finder (PRB-01…PRB-05).
   *
   * **The ES segment is `problemas`, deliberately, and not `fallas`.** The
   * glossary designates `falla` as the canonical Costa Rican term for a
   * *fault* (`all-general-falla`, EN headword "fault"), with `avería` as the
   * peninsular alias to keep out of prose — and `problema` appears nowhere in
   * that entry's aliases, so nothing in GLO-02 is engaged either way. The
   * choice was made on three other grounds:
   *
   * 1. **They are not the same concept at this level.** A `falla` is the thing
   *    that failed; a `problems` entry is the documented *case* — symptoms,
   *    diagnosis, causes, fix paths — of which the fallas are the `causes`
   *    field. The schema draws that line explicitly, and naming the section
   *    after its own sub-part would blur it.
   * 2. **Symmetry (I18N-01).** The glossary's EN headword for `falla` is
   *    "fault", not "problem". Taking `fallas` in ES while EN stays `problems`
   *    would narrow the section's meaning in one locale only — the precise
   *    asymmetry "neither locale privileged" exists to prevent — and the
   *    honest symmetric alternative, `/en/faults/`, contradicts the spec's own
   *    collection name.
   * 3. **The artboard and the spec agree.** I18N-05's worked example is
   *    `/es/problemas/…`, and the ES problem artboard's breadcrumb reads
   *    "Problemas".
   *
   * Contrast `garage` → `taller` above, where the glossary *did* rule on the
   * exact concept (`garaje` is a tagged ES/MX alias of the canonical
   * `taller`). Here it did not, so the deciding argument is the concept
   * boundary, not the vocabulary.
   */
  problems: { en: "problems", es: "problemas" },
  /**
   * T501 — the parts index and, under it, one page per part number
   * (PRT-01…03).
   *
   * The ES segment is **`repuestos`**, and that is the glossary's ruling
   * rather than a preference. `all-general-repuestos` is the canonical Costa
   * Rican term — AGENTS.md names it in the same breath as `taller` and
   * `llanta` — and it files `refacción`/`refacciones` (MX),
   * `recambio`/`recambios` (ES) and `autoparte`/`autopartes` (CO, MX) as
   * *aliases*: regional variants that live in the glossary's search index and
   * never in prose, which includes never in a URL. `/es/partes/` would have
   * been the English word wearing a Spanish accent, and `/es/refacciones/`
   * would have been Mexico's word in a Costa Rican site's address bar.
   *
   * Plural on both sides, matching `glossary`/`glosario` and
   * `community`/`comunidad`: the segment names the section, and the section is
   * a list.
   */
  parts: { en: "parts", es: "repuestos" },
  /**
   * T601 — modifications and their tradeoffs (MOD-01, MOD-02).
   *
   * **EN is `mods`, ES is `modificaciones`,** and the asymmetry in length is
   * the point rather than a compromise: I18N-01 asks that each locale get the
   * word its own readers use, not that the two words be the same shape.
   * English-speaking Montero owners say "mods"; nobody writes `/es/mods/`.
   *
   * The ES word was chosen over the two near neighbours the glossary already
   * rules on, and neither is a GLO-02 alias question — `modificación` appears
   * in no entry's `aliases`, so nothing is being pulled out of the search
   * index and into a URL:
   *
   * 1. **`preparación`** (`all-general-preparacion`) is the canonical Costa
   *    Rican term for a *build* — the whole project, "preparación de vehículos
   *    4x4", as the shops advertise it. It names the programme; this
   *    collection holds its individual items. `/es/preparacion/` would be a
   *    section named after the sum of its contents.
   * 2. **`levante`** (`all-suspension-levante-de-suspension`) is one mod, not
   *    the category.
   *
   * `modificaciones` is also the word the jurisdictional surface uses — a
   * Costa Rican owner meets it at the RTV, where "modificaciones al vehículo"
   * is what gets inspected — so it is the word a reader arrives already
   * holding.
   */
  mods: { en: "mods", es: "modificaciones" },
  /**
   * T502 — the procedures index and, under it, one page per job (PRC-01…03).
   *
   * **The ES segment is `procedimientos`.** Unlike `taller` and `repuestos`,
   * this is not a case where the glossary rules on the exact word: no glossary
   * entry is headed "procedure", and `procedimiento` appears in **no** entry's
   * `aliases`, so GLO-02's canonical-over-variant rule is not engaged in either
   * direction. The choice therefore rests on three other grounds, the same
   * three the `problemas` note above records for its own case:
   *
   * 1. **It is the word the corpus already uses.** `procedimiento` is what the
   *    merged ES prose reaches for unprompted — the FSM section index describes
   *    "los procedimientos sobre el vehículo para revisar y cambiar el aceite",
   *    a torque entry cites "el procedimiento de eje interno", and a brakes
   *    problem entry tells a reader to find a mechanic "que tenga el
   *    procedimiento de fábrica". A URL segment that disagreed with the site's
   *    own prose would be the reader's first false note.
   * 2. **Symmetry (I18N-01).** `procedures` / `procedimientos` are the same
   *    concept at the same scope in both languages — neither locale's segment
   *    is narrower than the other's, which is the asymmetry `fallas` would have
   *    introduced for `problems`.
   * 3. **It is not the English word wearing an accent.** The alternative a
   *    hurried author reaches for is `/es/procedures/`, which is exactly what
   *    `repuestos` and `taller` were chosen to avoid.
   *
   * Plural on both sides, matching every other collection here: the segment
   * names the section, and the section is a list.
   */
  procedures: { en: "procedures", es: "procedimientos" },
  /**
   * T702 — the site-wide search page (SRCH-01, SRCH-02).
   *
   * Not a content collection (same shape as `signIn` above): it has no
   * entries of its own, only an index built from the collections that do.
   * `buscar` is the plain Costa Rican verb-as-noun a reader looks for; it is
   * not a glossary headword (searching is an action on the site, not a truck
   * part or a system), so there is no GLO-02 ruling to defer to here.
   */
  search: { en: "search", es: "buscar" },
} as const satisfies Readonly<Record<string, Readonly<Record<Locale, string>>>>;

export type CollectionRouteId = keyof typeof COLLECTION_ROUTE_SEGMENTS;

/**
 * The registry name passed to {@link validateSlugRegistry}. It expects a
 * collection→entry→locale nesting; here the "collection" is the registry
 * itself and each "entry" is a collection id, so the issue messages read
 * `collection-routes/glossary: …`.
 */
const REGISTRY_LABEL = "collection-routes";

const registryIssues = validateSlugRegistry({
  [REGISTRY_LABEL]: COLLECTION_ROUTE_SEGMENTS,
});

if (registryIssues.length > 0) {
  throw new Error(
    `COLLECTION_ROUTE_SEGMENTS is not a valid route registry ` +
      `(${registryIssues.length} problem(s)):\n` +
      registryIssues.map((issue) => `  • ${issue.message}`).join("\n") +
      `\nEvery collection page needs exactly one segment per locale, unique ` +
      `within that locale (I18N-05). refs specs/001-foundation`
  );
}

/**
 * A collection page's route **in `locale`, without the locale prefix**:
 * `/glossary/` for `en`, `/glosario/` for `es`.
 *
 * The word to avoid here is "locale-independent" — the returned path is very
 * much locale-*specific* (that is the point of a translated segment, I18N-01).
 * What it omits is the `/en` / `/es` prefix and the deploy base, which
 * `localeHref` adds at the moment a link is rendered. Everything in this
 * module returns paths in that shape, because `BaseLayout` needs all of a
 * page's locale paths side by side to emit the hreflang pairs, and prefixing
 * them earlier would leave nothing to compare (T601 review, PR #94).
 *
 * `splitLocalePath` in `src/i18n/routing.ts` does call its second return value
 * the "locale-independent route", and that is a different, correct use of the
 * phrase: there it means "what is left after the locale prefix is stripped".
 * The value is the same shape; only the emphasis differs.
 */
export function collectionRoutePath(
  collection: CollectionRouteId,
  locale: Locale
): string {
  return `/${COLLECTION_ROUTE_SEGMENTS[collection][locale]}/`;
}

/**
 * Every locale's route for a collection page, ready for
 * `localizedAlternateLinks` and for the locale switcher — so switching
 * language from `/en/glossary/` lands on `/es/glosario/` and not on a 404.
 */
export function collectionRoutePaths(
  collection: CollectionRouteId
): LocalizedRoutePaths {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, collectionRoutePath(collection, locale)])
  ) as LocalizedRoutePaths;
}

/**
 * `getStaticPaths` rows for a collection's page: one per locale, carrying the
 * locale's own segment. A page file named `[locale]/[<something>].astro`
 * spreads these to build `/en/glossary/` and `/es/glosario/` from one
 * component (I18N-01: same route, same code, both locales).
 */
export function collectionRouteParams(
  collection: CollectionRouteId,
  segmentParam: string
): { params: Record<string, string> }[] {
  return LOCALES.map((locale) => ({
    params: {
      locale,
      [segmentParam]: COLLECTION_ROUTE_SEGMENTS[collection][locale],
    },
  }));
}

/* -------------------------------------------------------------------------
 * Entry pages — the two registries composed (I18N-01, I18N-04, I18N-05)
 *
 * A per-entry URL is this module's segment plus `src/i18n/entry-slugs.ts`'
 * slug: `/` + `repuestos` + `/` + `bomba-de-agua-6g74` + `/`. Composing them
 * here rather than in a page means the two registries meet in exactly one
 * place, and a page cannot accidentally build an ES URL out of an EN slug.
 * ---------------------------------------------------------------------- */

/** One entry's route in `locale`, or `null` when it has no slug row. */
export function entryRoutePath(
  collection: CollectionRouteId,
  entryId: string,
  locale: Locale
): string | null {
  const slug = entrySlugs(collection, entryId)?.[locale];
  if (slug === undefined) return null;
  return `${collectionRoutePath(collection, locale)}${slug}/`;
}

/**
 * Every locale's route for one entry page, ready for
 * `localizedAlternateLinks` and the locale switcher — so switching language on
 * `/en/parts/water-pump-6g74/` lands on `/es/repuestos/bomba-de-agua-6g74/`
 * and not on a 404 (I18N-03, I18N-04).
 *
 * `null` when the entry has no registry row, which is the state the build
 * check turns into a named error rather than a silently missing page.
 */
export function entryRoutePaths(
  collection: CollectionRouteId,
  entryId: string
): LocalizedRoutePaths | null {
  const slugs = entrySlugs(collection, entryId);
  if (slugs === null) return null;

  return Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      `${collectionRoutePath(collection, locale)}${slugs[locale]}/`,
    ])
  ) as LocalizedRoutePaths;
}

/**
 * `getStaticPaths` rows for a collection's entry pages: one per locale per
 * registered entry, each carrying that locale's own segment and slug, with the
 * entry id passed through as a prop so the page never has to reverse a slug
 * back into an id.
 *
 * Returns `[]` while the registry is empty — which is a page that builds
 * nothing, not a build error. The collection's *index* still builds, so
 * `/en/parts/` and `/es/repuestos/` exist (and are audited) from the day the
 * template lands.
 */
export function entryRouteParams(
  collection: CollectionRouteId,
  segmentParam: string,
  slugParam: string
): { params: Record<string, string>; props: { entryId: string } }[] {
  return slugRegistryIds(collection).flatMap((entryId) => {
    const slugs = entrySlugs(collection, entryId);
    if (slugs === null) return [];

    return LOCALES.map((locale) => ({
      params: {
        locale,
        [segmentParam]: COLLECTION_ROUTE_SEGMENTS[collection][locale],
        [slugParam]: slugs[locale],
      },
      props: { entryId },
    }));
  });
}
