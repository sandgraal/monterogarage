/**
 * The accountless share page's route segment, per locale — the one pair
 * `src/lib/garage/share-link.ts` needs and cannot import from
 * `src/i18n/routes.ts`.
 *
 * ## Why this file exists at all (the `handles.ts` precedent)
 *
 * `src/i18n/routes.ts` imports the slug registry, which imports the content
 * collections, which drags Astro's virtual `astro:content` — and Zod — into
 * anything that reads it as a *value*. `share-link.ts` is pure browser/Node
 * code graded by `tests/garage/share-delivery.test.ts`, which has no Astro
 * environment; `src/lib/garage/handles.ts` hit exactly this and solved it the
 * same way, and its docstring records why the alternative (importing the
 * registry for its values) was given up.
 *
 * What is **not** given up is the guarantee that the two agree.
 * {@link SHARE_ROUTE_SEGMENTS} carries a `satisfies` clause against the
 * registry's *literal type*, imported type-only, so renaming `compartir` in
 * `src/i18n/routes.ts` fails `astro check` here rather than shipping a share
 * link that 404s for every Costa Rican reader who was sent one.
 *
 * refs specs/002-montero-garage (SHR-05, SHR-07), 001 (I18N-01)
 */
import type { COLLECTION_ROUTE_SEGMENTS } from "../../i18n/routes";

/**
 * `/en/share/` and `/es/compartir/`, without the locale prefix or the base.
 *
 * `compartir` is the plain Costa Rican verb-as-noun for the act this page is
 * the result of — the owner *compartió* the truck's history with somebody.
 * It is not a glossary headword (sharing is an action on the site, not a truck
 * part or a system), so there is no GLO-02 ruling to defer to, and the same
 * reasoning `buscar` records for `/es/buscar/` applies unchanged.
 */
export const SHARE_ROUTE_SEGMENTS = {
  en: "share",
  es: "compartir",
} as const satisfies (typeof COLLECTION_ROUTE_SEGMENTS)["share"];
