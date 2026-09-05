/**
 * Public handles — the seam declared by T2-401 [TEST], filled by T2-402
 * [PLATFORM].
 *
 * > **SHR-02** A user SHALL be able to publish, per vehicle: a showcase page
 * > and/or a work-log page, each at a **stable public URL under their handle**,
 * > bilingual chrome, user content in whatever language the user wrote.
 *
 * ## Why a handle is a security object and not a nickname
 *
 * A handle is the only part of a garage URL a stranger can guess or type, and
 * three of its properties decide whether a link means what its reader thinks:
 *
 * 1. **Uniqueness has to live in the database.** Two signups checking "is
 *    `gitana` free?" at the same moment both get "yes", so the answer must be a
 *    unique index and not a lookup in the form. This module never claims to
 *    answer it — {@link handleIssues} reports the rules a *string* can break,
 *    and availability is the database's answer to a write.
 * 2. **Case must fold.** `Gitana` and `gitana` are the same string in the same
 *    position of the same URL to every reader on earth, and two accounts that
 *    differ only in case is an impersonation kit. {@link normalizeHandle} is
 *    the fold, and `20260903120000_public_handles.sql` applies the identical
 *    fold in a `before insert or update` trigger so a row written by a script,
 *    an import job or a `curl` somebody found on a forum is folded too.
 * 3. **A released handle must not immediately become somebody else's.** SHR-02
 *    says the URL is *stable*. If a rename frees the old handle for a stranger,
 *    every link already shared quietly starts pointing at a different person's
 *    garage — a URL that changed its meaning without changing its text. That
 *    one is unrepresentable in this module (it is a fact about two rows) and
 *    lives in the migration's `profiles.retired_handles`.
 *
 * ## The rules are stated **twice**, on purpose, and never three times
 *
 * The format and reserved rules exist here (so a form can say what is wrong
 * before a round trip) and in the schema (so the guarantee survives a client
 * that never ran this code). SHR-01 is explicit that a check living in client
 * code is not one of the three permitted enforcement modes — so this module is
 * an *affordance*, and the migration is the enforcement. They are kept in step
 * by `tests/garage/handles.test.ts`, which grades the same words through both:
 * `handleIssues("admin")` in Tier A and a live `update … set handle = 'admin'`
 * in Tier B.
 *
 * The third copy would be `tests/garage/contract.ts`'s `RESERVED_HANDLES`, and
 * it is not a copy in the sense that matters: it is an independently authored
 * grader's list, and its whole job is to disagree with this one when this one
 * is wrong.
 *
 * ## Reserved words: transcribed, and *proved* against the registry
 *
 * {@link RESERVED_HANDLES} is the site's own namespace plus the impersonation
 * words. The namespace half was computed from `COLLECTION_ROUTE_SEGMENTS` until
 * that turned out to cost every visitor a copy of Zod (see the import note
 * below), so it is written out — and {@link SITE_NAMESPACE_IS_RESERVED} then
 * re-derives the same set from the registry's *type* and fails the build if the
 * list has fallen behind it. Adding a collection to the site still cannot leave
 * its segment claimable; the check runs at `astro check` instead of at page
 * load, and names the missing segment when it fires.
 *
 * The impersonation half stays hand-written with no derivation possible,
 * because reserving a word is a decision.
 *
 * refs specs/002-montero-garage (SHR-01, SHR-02, SHR-04),
 * specs/001-foundation (I18N-01, I18N-04, I18N-05)
 */
import { LOCALES, isLocale, type Locale } from "../../i18n/routing";
/**
 * **`import type`, and that is load-bearing rather than tidy.**
 *
 * This module is imported by the garage page's *client* script, and a value
 * import of `src/i18n/routes.ts` drags the whole schema graph with it —
 * `routes.ts` → `schemas/slugs.ts` → `schemas/entry.ts` → `astro/zod`. That
 * shipped a schema-validation library to every visitor's browser to validate no
 * schemas, on the heaviest-scripted page on the site (T2-402 review, F3;
 * measured at +167% raw / +163% gzip on this page's bundle). `handles.test.ts`
 * already refuses to import the same module for the same reason, in its own
 * words.
 *
 * A type-only import is erased before bundling, so the registry is still the
 * authority for every value below — checked by the compiler, at `astro check`
 * time, in `npm run verify` — and none of it reaches the browser.
 */
import type { COLLECTION_ROUTE_SEGMENTS } from "../../i18n/routes";

/**
 * The shape a handle may take.
 *
 * Lower-case, digits, and single interior hyphens. No dots (they make a handle
 * look like a hostname and break the `x-default` hreflang pairing), no
 * underscores (indistinguishable from a hyphen in a printed URL), no leading or
 * trailing hyphen, and a floor of two characters so single letters stay
 * available for the site's own routes.
 *
 * Deliberately identical to `HANDLE_PATTERN` in `tests/garage/contract.ts` —
 * that file is the grader's independent statement of the same rule, and
 * `handles.test.ts` drives its own table through {@link handleIssues}, so the
 * two disagreeing is a red build rather than a silent divergence.
 */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** The inclusive length bounds, in characters, of a well-formed handle. */
export const HANDLE_LENGTH = { min: 2, max: 32 } as const;

/**
 * The segment a handle is nested under, per locale.
 *
 * The `satisfies` clause is the whole safety story now that the registry is a
 * type-only import: `COLLECTION_ROUTE_SEGMENTS.garage` is
 * `{ readonly en: "garage"; readonly es: "taller" }` — *literal* types, because
 * the registry is declared `as const` — so this object is assignable to it only
 * when both strings match exactly. Rename `taller` in `src/i18n/routes.ts` and
 * `astro check` fails here rather than the site quietly serving published pages
 * at an address the locale switcher does not know about.
 */
const GARAGE_ROUTE_SEGMENTS = {
  en: "garage",
  es: "taller",
} as const satisfies (typeof COLLECTION_ROUTE_SEGMENTS)["garage"];

/**
 * Words that would let an account impersonate the site or its operators.
 *
 * The half a filesystem or a registry scan cannot know. `admin` and `api` are
 * named in SHR-02's task brief; the rest are the words a reader would read as
 * "this page is the site talking", plus the two asset prefixes Astro and this
 * deploy actually emit (`_astro`, `assets`).
 *
 * `_astro` cannot match {@link HANDLE_PATTERN} and so could never have been
 * claimed. It is reserved anyway: the list's job is to describe the namespace,
 * and a reader who finds it missing has to work out for themselves whether that
 * is an oversight.
 *
 * ## `gitana` is deliberately **not** here, and `contract.ts` disagrees
 *
 * `RESERVED_HANDLES` in `tests/garage/contract.ts` lists it among the
 * impersonation words, and the same file's `handles.test.ts` asserts
 * `handleIssues("gitana")` returns **no** issues as one of its four positive
 * controls. Both cannot hold, and the positive control is the one that is
 * right: Gitana Blanca is a *user's* truck (MIG-04 — "user page #1"), not the
 * site's own identity, so reserving her name would be the platform taking a
 * handle away from the first owner it was built for. The divergence is reported
 * on T2-402 rather than patched into the grader's list, because that list is an
 * independent statement and not mine to edit.
 */
const IMPERSONATION_HANDLES = [
  "admin",
  "administrator",
  "api",
  "root",
  "support",
  "help",
  "official",
  "staff",
  "moderator",
  "security",
  "billing",
  "montero",
  "monterogarage",
  "www",
  "mail",
  "static",
  "assets",
  "_astro",
] as const;

/**
 * Every route segment the site serves, in either locale.
 *
 * Written out rather than computed with `Object.values(...)`, because the
 * computation needed the registry as a *value* and that is what put Zod in the
 * browser (see the import note above). What is not given up is the guarantee:
 * {@link SITE_NAMESPACE_IS_RESERVED} below re-derives the same set from the
 * registry's **type** and fails the build if this list falls behind it. The
 * check moved from run time to compile time; it did not go away.
 */
const SITE_ROUTE_HANDLES = [
  "glossary",
  "glosario",
  "community",
  "comunidad",
  "sign-in",
  "ingresar",
  "garage",
  "taller",
  "problems",
  "problemas",
  "parts",
  "repuestos",
  "mods",
  "modificaciones",
] as const;

/**
 * Every handle nobody may claim: the impersonation words, both locale codes,
 * and every route segment the site serves in either locale.
 *
 * The locale codes are not decoration — `/es/` and a user called `es` are the
 * same string in the same position of the same URL.
 *
 * A handle lives at `/{locale}/{garage segment}/{handle}/`, so only the segment
 * *at the handle's own position* can truly collide with it. Reserving the whole
 * registry anyway costs one Costa Rican owner the handle `taller` and buys
 * immunity from the position ever moving — and un-reserving a word later is
 * safe in a way that reserving one later is not, because by then somebody holds
 * it.
 */
export const RESERVED_HANDLES = [
  ...IMPERSONATION_HANDLES,
  ...LOCALES,
  ...SITE_ROUTE_HANDLES,
] as const;

/**
 * Compile-time proof that {@link RESERVED_HANDLES} still covers the site's own
 * namespace.
 *
 * `SiteSegment` is every string in `COLLECTION_ROUTE_SEGMENTS`, read off the
 * registry's literal type. A union is assignable to another union only when
 * every member is, so this is exactly the superset check `handles.test.ts` runs
 * against the grader's own list — asked of *this* list, at `astro check` time,
 * for free at run time.
 *
 * Add a collection to the registry without reserving its segments and the build
 * fails here, naming them in the error: `true` is not assignable to
 * `["unreserved route segment(s)", "recipes" | "recetas"]`. That is the failure
 * this list existed to have, kept after the value import had to go.
 */
type SiteSegment =
  (typeof COLLECTION_ROUTE_SEGMENTS)[keyof typeof COLLECTION_ROUTE_SEGMENTS][Locale];

export const SITE_NAMESPACE_IS_RESERVED: SiteSegment extends (typeof RESERVED_HANDLES)[number]
  ? true
  : [
      "unreserved route segment(s)",
      Exclude<SiteSegment, (typeof RESERVED_HANDLES)[number]>,
    ] = true;

/** The same set, folded, for the O(1) membership test {@link handleIssues} runs. */
const RESERVED = new Set<string>(
  RESERVED_HANDLES.map((handle) => handle.toLowerCase())
);

/** Why a candidate handle cannot be used. One reason per failing rule. */
export type HandleIssue =
  "empty" | "too-short" | "too-long" | "bad-characters" | "reserved";

/**
 * Fold a candidate handle to its canonical form.
 *
 * Canonicalisation is what makes uniqueness meaningful: the unique index is on
 * *this* value, so `Gitana`, `gitana`, and ` gitana ` are one handle and not
 * three. It is deliberately **not** a validator — it returns a string for any
 * input, including one {@link handleIssues} will then reject, so the two
 * concerns stay separable and each is graded on its own.
 *
 * `toLowerCase`, not `toLocaleLowerCase`: the fold has to agree with Postgres'
 * `lower()` on an ASCII handle, and a Turkish locale's dotless ı would make the
 * browser and the database disagree about which row a URL names.
 */
export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Every reason `input` may not be claimed as a handle, in a stable order.
 *
 * An array rather than a boolean or a first-failure: a form that can only say
 * "invalid" makes the user guess, and a grader that only sees "invalid" cannot
 * tell a length rule from a reservation rule — which is how a reservation rule
 * gets accidentally deleted and nothing notices.
 *
 * Every rule is applied to the **folded** value, so `ADMIN` is `admin` and the
 * shift key defeats nothing.
 */
export function handleIssues(input: string): readonly HandleIssue[] {
  const handle = normalizeHandle(input);
  if (handle === "") return ["empty"];

  const issues: HandleIssue[] = [];
  if (handle.length < HANDLE_LENGTH.min) issues.push("too-short");
  if (handle.length > HANDLE_LENGTH.max) issues.push("too-long");
  if (!HANDLE_PATTERN.test(handle)) issues.push("bad-characters");
  if (RESERVED.has(handle)) issues.push("reserved");
  return issues;
}

/** `true` when `input` breaks no rule this module can see. Availability is not one. */
export function isWellFormedHandle(input: string): boolean {
  return handleIssues(input).length === 0;
}

/**
 * The published page's route in `locale`, **without** the `/en` / `/es` prefix:
 * `/garage/gitana/` in English, `/taller/gitana/` in Spanish.
 *
 * The shape every other route in this project returns (`collectionRoutePath`,
 * `entryRoutePath`), because `BaseLayout` needs all of a page's locale paths
 * side by side to emit the hreflang pairs and prefixing them earlier would
 * leave nothing to compare.
 *
 * ## Why the handle is nested under the garage segment
 *
 * A top-level `/{locale}/{handle}/` would put every account in the same
 * namespace as every route the site will ever add, so next year's new section
 * either collides with a handle somebody holds or is refused because of one.
 * Nesting confines the collision surface to a single segment — `garage` /
 * `taller`, both already reserved — and the ES word is the glossary's canonical
 * `taller` rather than `garaje`, which is a tagged ES/MX alias
 * (`all-general-taller`). See `src/i18n/routes.ts`.
 */
export function handleRoutePath(handle: string, locale: Locale): string {
  return `/${GARAGE_ROUTE_SEGMENTS[locale]}/${normalizeHandle(handle)}/`;
}

/**
 * The path a published page lives at, for `handle` in `locale` — **with** the
 * locale prefix: `/es/taller/gitana/`.
 *
 * Here rather than in a page component because it is the thing SHR-02 calls
 * stable, and I18N-04 needs the two locales' spellings of it to emit the
 * hreflang pair. A URL built inline in markup is a URL with no test.
 *
 * Throws on a locale this site does not serve. An unknown locale here would
 * otherwise produce `/de/undefined/gitana/` — a plausible-looking string that
 * is nobody's page, which is worse than a stack trace at the one call site that
 * built it.
 */
export function handlePath(input: {
  readonly handle: string;
  readonly locale: string;
}): string {
  if (!isLocale(input.locale)) {
    throw new Error(
      `handlePath: ${JSON.stringify(input.locale)} is not a locale this site ` +
        `serves (${LOCALES.join(", ")}) — refs specs/001-foundation I18N-01`
    );
  }
  return `/${input.locale}${handleRoutePath(input.handle, input.locale)}`;
}

/**
 * Every locale's route for one handle, in the shape `BaseLayout` and the locale
 * switcher read — so switching language on `/en/garage/gitana/` lands on
 * `/es/taller/gitana/` and not on a 404 (I18N-03, I18N-04).
 */
export function handleRoutePaths(
  handle: string
): Readonly<Record<Locale, string>> {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, handleRoutePath(handle, locale)])
  ) as Readonly<Record<Locale, string>>;
}
