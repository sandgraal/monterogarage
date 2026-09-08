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
 * `parts` is populated by T503's wave-1 set — the parts the merged Gen 3
 * problem entries already name in `fixPaths[].parts`. T501 built the schema
 * and the page templates; the build checks
 * (`src/integrations/validate-parts.ts`, `validate-mods.ts`) turn the first
 * unlisted entry, or the first row naming no entry, into a named error.
 *
 * `mods` is populated by T602's wave-1 set. The ES slugs are a Costa Rican
 * reader's own words rather than the English one transliterated, per the note
 * above: `levante-de-suspension`, `barras-laterales-de-acero`,
 * `bloqueo-del-diferencial-trasero`. They are unaccented because they are URLs,
 * which is the same call `problems` and `glossary` already made.
 *
 * `barras-laterales-de-acero` rather than `estribos-de-acero` on purpose: the
 * merged `problems` content already uses `estribos` for the *sills* — the
 * structural rocker panels that rust — and this entry's whole argument is that
 * a bolt-on side rail is not a structure. Reusing the word would have inverted
 * an established term on a safety-critical page (T602 bilingual review, #8).
 */
export const ENTRY_SLUGS: Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<Locale, string>>>>>
> = {
  /**
   * PRT-01 — one page per part number. Wave 1 (T503) is the set of parts the
   * merged Gen 3 problem entries already point at through
   * `fixPaths[].parts`, so every row here closes a reference the gaps report
   * was naming.
   *
   * The ES slug is a Costa Rican reader's own words, not the English one with
   * an accent — `rotula-inferior-delantera`, `empaque-de-tapa-de-valvulas`,
   * `arandela-del-tapon-de-la-transmision`. They are unaccented because they
   * are URLs, which is the same call `problems`, `procedures`, `mods` and
   * `glossary` already made.
   *
   * Three conventions this collection adds, all because a part number is a
   * thing you shout across a parts counter:
   *
   * - **A superseded number gets its own slug, and the slug says so**
   *   (`thermostat-superseded-number` / `termostato-numero-reemplazado`).
   *   PRT-02 renders the chain, but the URL is what somebody pastes into a
   *   message, and a URL that reads like the current part when it is not is
   *   the one place the chain cannot help.
   * - **Left and right are separate slugs**, because they are separate part
   *   numbers (`front-sway-bar-end-link-left` / `-right`). Collapsing them
   *   would put two numbers behind one URL, which is exactly the ambiguity
   *   `src/schemas/parts.ts` refuses at the entry level.
   * - **A slug never reads more general than the number behind it.** The
   *   transfer case carries five position switches with five different
   *   Mitsubishi numbers, so `gen3-transfer-case-position-switch` — the id the
   *   merged problem entry already references, and which cannot be renamed
   *   without breaking that reference — is slugged
   *   `transfer-case-position-switch-2wd`, naming the position it actually
   *   is. A bare `transfer-case-position-switch` URL would promise the answer
   *   to "which switch" and deliver one of five.
   */
  parts: {
    "gen3-timing-belt-tensioner": {
      en: "timing-belt-tensioner",
      es: "tensor-de-faja-de-distribucion",
    },
    "gen3-front-camshaft-seal": {
      en: "front-camshaft-seal",
      es: "retenedor-delantero-de-arbol-de-levas",
    },
    "gen3-front-crankshaft-seal": {
      en: "front-crankshaft-seal",
      es: "retenedor-delantero-de-ciguenal",
    },
    "gen3-valve-cover-gasket": {
      en: "valve-cover-gasket",
      es: "empaque-de-tapa-de-valvulas",
    },
    "gen3-thermostat": {
      en: "thermostat",
      es: "termostato",
    },
    "gen3-thermostat-md351861": {
      en: "thermostat-superseded-number",
      es: "termostato-numero-reemplazado",
    },
    "gen3-thermostat-larger-v6": {
      en: "thermostat-larger-v6",
      es: "termostato-v6-mayor",
    },
    "gen3-accessory-drive-belt-idler-pulley": {
      en: "drive-belt-idler-pulley-smooth",
      es: "polea-loca-lisa",
    },
    "gen3-accessory-drive-belt-idler-pulley-grooved": {
      en: "drive-belt-idler-pulley-grooved",
      es: "polea-loca-acanalada",
    },
    "gen3-exhaust-manifold-gasket": {
      en: "exhaust-manifold-gasket",
      es: "empaque-de-multiple-de-escape",
    },
    "gen3-rear-heater-tee-joint-pipe": {
      en: "rear-heater-tee-pipe",
      es: "tubo-en-t-del-calefactor-trasero",
    },
    "gen3-surge-tank-gasket-set": {
      en: "surge-tank-gasket",
      es: "empaque-de-deposito-de-admision",
    },
    "gen3-front-lower-ball-joint": {
      en: "front-lower-ball-joint",
      es: "rotula-inferior-delantera",
    },
    "gen3-front-upper-ball-joint": {
      en: "front-upper-ball-joint",
      es: "rotula-superior-delantera",
    },
    "gen3-front-sway-bar-end-link": {
      en: "front-sway-bar-end-link-left",
      es: "bieleta-delantera-izquierda",
    },
    "gen3-front-sway-bar-end-link-right": {
      en: "front-sway-bar-end-link-right",
      es: "bieleta-delantera-derecha",
    },
    "gen3-front-shock-dust-boot": {
      en: "front-shock-dust-boot",
      es: "guardapolvo-de-amortiguador-delantero",
    },
    "gen3-brake-booster-accumulator": {
      en: "brake-booster-accumulator",
      es: "deposito-de-presion-del-booster",
    },
    "gen3-brake-booster-accumulator-without-traction-control": {
      en: "brake-booster-accumulator-without-traction-control",
      es: "deposito-de-presion-sin-control-de-traccion",
    },
    "gen3-differential-seal": {
      en: "rear-differential-side-seal",
      es: "retenedor-lateral-del-diferencial-trasero",
    },
    "gen3-transfer-case-position-switch": {
      en: "transfer-case-position-switch-2wd",
      es: "interruptor-de-posicion-de-transferencia-2wd",
    },
    "gen3-transfer-case-position-switch-2wd-4wd": {
      en: "transfer-case-position-switch-2wd-4wd",
      es: "interruptor-de-posicion-de-transferencia-2wd-4wd",
    },
    "gen3-transfer-case-position-switch-4h": {
      en: "transfer-case-position-switch-4h",
      es: "interruptor-de-posicion-de-transferencia-4h",
    },
    "gen3-transfer-case-position-switch-cdl": {
      en: "transfer-case-position-switch-centre-diff-lock",
      es: "interruptor-de-posicion-de-transferencia-bloqueo-central",
    },
    "gen3-transfer-case-position-switch-4llc": {
      en: "transfer-case-position-switch-4llc",
      es: "interruptor-de-posicion-de-transferencia-4llc",
    },
    "gen3-transfer-case-switch-crush-washer": {
      en: "transfer-case-switch-crush-washer",
      es: "arandela-del-interruptor-de-transferencia",
    },
    "gen3-transmission-crossmember-bushing": {
      en: "transmission-crossmember-bushing",
      es: "buje-de-travesano-de-transmision",
    },
    "gen3-transmission-pan-drain-crush-washer": {
      en: "transmission-drain-plug-crush-washer",
      es: "arandela-del-tapon-de-la-transmision",
    },
    "gen3-automatic-transmission-fluid-spiii": {
      en: "automatic-transmission-fluid-sp-iii",
      es: "aceite-de-transmision-automatica-sp-iii",
    },
    "gen3-timing-belt": {
      en: "timing-belt",
      es: "faja-de-distribucion",
    },
    "gen3-accessory-drive-belt": {
      en: "accessory-drive-belt",
      es: "faja-de-accesorios",
    },
    "gen3-accessory-drive-belt-tensioner": {
      en: "accessory-drive-belt-tensioner",
      es: "tensor-de-faja-de-accesorios",
    },
    "gen3-freewheel-clutch-control-solenoid": {
      en: "freewheel-clutch-control-solenoid",
      es: "solenoide-de-embrague-de-rueda-libre",
    },
    "gen3-fuel-filler-hose": {
      en: "fuel-filler-hose",
      es: "manguera-de-llenado-de-combustible",
    },
    "gen3-fuel-tank-safety-valve": {
      en: "fuel-tank-safety-valve",
      es: "valvula-de-seguridad-del-tanque-de-combustible",
    },
    "gen3-updated-crankshaft-bolt-and-washer-set": {
      en: "updated-crankshaft-bolt-and-washer-set",
      es: "juego-de-tornillo-central-de-ciguenal-actualizado",
    },
    "gen3-front-sway-bar-bushing": {
      en: "front-sway-bar-bushing",
      es: "buje-de-barra-estabilizadora-delantera",
    },
  },
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
   *
   * Wave 1 (T504) is the maintenance set. Two ES slugs are deliberately
   * shorter than their English counterparts rather than transliterations of
   * them: `pastillas-de-freno-delanteras` is what a Costa Rican driver asks a
   * `taller` for, and `cambio-de-aceite-de-transferencia` is how the job is
   * named out loud — nobody says "cambio de aceite de la caja de
   * transferencia" twice in the same conversation.
   */
  procedures: {
    "gen3-engine-oil-and-filter-change": {
      en: "engine-oil-and-filter-change",
      es: "cambio-de-aceite-y-filtro",
    },
    "gen3-air-cleaner-element-replacement": {
      en: "air-filter-replacement",
      es: "cambio-de-filtro-de-aire",
    },
    "gen3-spark-plug-replacement": {
      en: "spark-plug-replacement",
      es: "cambio-de-bujias",
    },
    "gen3-timing-belt-replacement": {
      en: "timing-belt-replacement",
      es: "cambio-de-faja-de-distribucion",
    },
    "gen3-differential-oil-change": {
      en: "differential-oil-change",
      es: "cambio-de-aceite-de-diferenciales",
    },
    "gen3-transfer-case-oil-change": {
      en: "transfer-case-oil-change",
      es: "cambio-de-aceite-de-transferencia",
    },
    "gen3-front-brake-pad-replacement": {
      en: "front-brake-pads",
      es: "pastillas-de-freno-delanteras",
    },
    "gen3-brake-fluid-change": {
      en: "brake-fluid-change",
      es: "cambio-de-liquido-de-frenos",
    },
  },
  /** MOD-01 — one page per modification. Wave 1 (T602). */
  mods: {
    "gen3-suspension-lift-springs": {
      en: "suspension-lift",
      es: "levante-de-suspension",
    },
    "gen3-wheels-tires-33-inch-tires": {
      en: "33-inch-tires",
      es: "llantas-de-33",
    },
    "gen3-drivetrain-regear-third-member-swap": {
      en: "regearing",
      es: "cambio-de-relacion-del-diferencial",
    },
    "gen3-body-front-skid-plates": {
      en: "front-skid-plates",
      es: "protectores-de-carter-delanteros",
    },
    "gen3-body-steel-side-rails": {
      en: "steel-side-rails",
      es: "barras-laterales-de-acero",
    },
    "gen3-body-steel-front-bumper": {
      en: "steel-front-bumper",
      es: "bumper-delantero-de-acero",
    },
    "gen3-body-roof-rack-and-roof-load": {
      en: "roof-rack-and-roof-load",
      es: "parrilla-de-techo-y-carga",
    },
    "gen3-interior-drawer-system": {
      en: "drawer-system",
      es: "sistema-de-gavetas",
    },
    "gen3-electrical-dual-battery": {
      en: "dual-battery",
      es: "doble-bateria",
    },
    "gen3-drivetrain-rear-air-locker": {
      en: "rear-air-locker",
      es: "bloqueo-del-diferencial-trasero",
    },
  },
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
