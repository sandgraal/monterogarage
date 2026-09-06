/**
 * Synthetic fixtures for the T603 graders — typed mods figures by id
 * (MOD-01, MOD-02, PRC-03 precedent).
 *
 * ## Everything here is obviously fake, on purpose
 *
 * Same rule `tests/fixtures/procedure-fixtures.ts` states, for the same
 * reason: AGENTS.md calls an invented part number "the highest-consequence
 * hallucination in this domain", and a *plausible* figure in a fixture is how
 * one leaks into content. Every identifier is in the reserved test namespace
 * (`test-…` entry ids, `TEST-…` catalogue tokens, `example.invalid` URLs) and
 * every figure is a round `100` or a `4.5` no supplier ever published. Nothing
 * here is a claim about a Montero, a roof rack or a bumper.
 *
 * ## The `reference` builder is imported, not re-minted
 *
 * `makeReference` already exists in `tests/fixtures/procedure-fixtures.ts` and
 * builds an entry valid against the real `reference` schema. A mods-side copy
 * would be a second synthetic-reference vocabulary that drifts the first time
 * `reference` gains a field — the same "never re-mint" discipline T501/T502
 * record for `sourceKind.*` labels. This module wraps it with the figures a
 * *mod* states (a fastener torque, a roof-load limit, a length) rather than
 * the ones a service job states.
 *
 * ## The two figures, and why they are what they are
 *
 * - `test-ref-mod-torque` — `100 N·m`, a `torque` reference. An integer with a
 *   unit whose symbol is identical in both languages, so "EN and ES render the
 *   same string" is a claim about the *stored value* and not about number
 *   formatting.
 * - `test-ref-mod-roof-load` — `100 kg`, a `dimension` reference. REF-01 files
 *   length, mass and angle together (`DIMENSION_UNITS`), so a load rating is
 *   already storable today — which is exactly why T602's "no typed home for a
 *   roof-load limit" was a gap in `mods`, not in `reference`.
 * - `test-ref-mod-length` — `4.5 m`, the decimal case. One stored value, two
 *   renderings (`4.5` / `4,5`): the property that separates "rendered per
 *   locale from one copy" from "typed twice".
 *
 * refs specs/001-foundation (MOD-01, MOD-02, PRC-03 precedent, REF-02)
 */
import { LOCALES, type Locale } from "../../src/i18n/routing.ts";
import { makeReference, makeSource } from "./procedure-fixtures.ts";

export type { Locale };
export { LOCALES, makeSource };

/* -------------------------------------------------------------------------
 * The reference entries a mod's figures live in
 * ---------------------------------------------------------------------- */

/** One cited figure: the id a mod names, and what both locales must show. */
export interface SpecFixture {
  readonly id: string;
  readonly kind: string;
  /** The kind-owned fields, as `reference` stores them. */
  readonly fields: Record<string, unknown>;
  /**
   * The rendered figure, in the notation an EN page uses. The ES page renders
   * the *same stored value*; where the two notations differ (a decimal comma)
   * the graders normalise before comparing rather than pinning a formatter.
   */
  readonly label: string;
}

/** A fastener torque a mod sets — `100 N·m`. */
export const TORQUE_SPEC: SpecFixture = {
  id: "test-ref-mod-torque",
  kind: "torque",
  fields: { torque: { value: 100, unit: "nm" } },
  label: "100 N·m",
};

/** A load rating — `100 kg`, stored as a `dimension` in mass units. */
export const ROOF_LOAD_SPEC: SpecFixture = {
  id: "test-ref-mod-roof-load",
  kind: "dimension",
  fields: { dimension: { value: 100, unit: "kg" } },
  label: "100 kg",
};

/** The decimal case — `4.5 m` in EN, `4,5 m` in ES, one stored `4.5`. */
export const LENGTH_SPEC: SpecFixture = {
  id: "test-ref-mod-length",
  kind: "dimension",
  fields: { dimension: { value: 4.5, unit: "m" } },
  label: "4.5 m",
};

/** Every figure fixture a mod may cite. */
export const SPEC_FIXTURES: readonly SpecFixture[] = [
  TORQUE_SPEC,
  ROOF_LOAD_SPEC,
  LENGTH_SPEC,
];

/**
 * A `reference` entry carrying one {@link SpecFixture}'s figure.
 *
 * `cited` is a knob and not a default because REF-02's non-vacuity grader
 * needs the uncited case: the tier moves with the sources (an `fsm-confirmed`
 * entry with `sources: []` does not parse at all — `CITATION_REQUIRED_TIERS`),
 * so an uncited fixture drops to `first-hand`, which is exactly the case
 * REF-02 exists for.
 */
export function makeSpecReference(
  spec: SpecFixture,
  { cited = true }: { cited?: boolean } = {}
): Record<string, unknown> {
  const entry = makeReference({
    id: spec.id,
    kind: spec.kind,
    system: "body",
    fields: spec.fields,
  });

  return cited
    ? entry
    : { ...entry, confidence: "first-hand", sources: [] as unknown[] };
}

/**
 * A `reference` entry of a kind that carries **no figure** — an FSM section, a
 * VIN position, an option code. Citing one as a mod's spec is an authoring
 * mistake with a clear answer, not a silently empty row.
 */
export function makeNonFigureReference(kind: string): Record<string, unknown> {
  return makeReference({ id: `test-ref-mod-${kind}`, kind, system: "body" });
}

/* -------------------------------------------------------------------------
 * `parts` entries — what a `requires` row resolves against
 * ---------------------------------------------------------------------- */

export function makeModPart(
  id = "test-part-mod-bracket"
): Record<string, unknown> {
  return {
    id,
    fitment: { gens: ["gen3"] },
    oemNumber: "TEST-M0001",
    system: "body",
    confidence: "fsm-confirmed",
    sources: [makeSource()],
    prose: {
      en: { title: `TEST part ${id}`, summary: "Synthetic T603 fixture." },
      es: { title: `Repuesto TEST ${id}`, summary: "Entrada sintética." },
    },
  };
}

/* -------------------------------------------------------------------------
 * `mods` entries
 * ---------------------------------------------------------------------- */

export interface ModAffectsRow {
  readonly id: string;
  readonly system: string;
  readonly impact: string;
  readonly ref?: { collection: string; id: string };
}

export interface ModOptions {
  readonly id?: string;
  readonly system?: string;
  readonly safetyCritical?: boolean;
  readonly cost?: unknown;
  readonly difficulty?: unknown;
  readonly confidence?: string;
  readonly sources?: readonly unknown[];
  readonly requires?: readonly { collection: string; id: string }[];
  readonly affects?: readonly ModAffectsRow[];
  /**
   * The T603 seam: `reference` entry ids this mod states a figure from.
   *
   * Typed `readonly unknown[]` and not `readonly string[]` on purpose — the
   * graders have to be able to hand the parser the shapes it must *refuse*
   * (an object carrying the figure beside the id, an uppercase catalogue
   * token), and a `string[]` parameter would make the wrong-shape rows
   * uncompilable rather than red.
   */
  readonly specs?: readonly unknown[];
  /** Per-locale title override — the subject the safety detector reads. */
  readonly titles?: Partial<Record<Locale, string>>;
  /** Per-locale summary override. */
  readonly summaries?: Partial<Record<Locale, string>>;
  /** Per-locale tradeoffs override — MOD-01's required field. */
  readonly tradeoffs?: Partial<Record<Locale, string>>;
  /** Per-locale `affectsNotes` override, keyed by row id. */
  readonly affectsNotes?: Partial<Record<Locale, Record<string, string>>>;
  /** Merged into shared data last — for fields the schema must *reject*. */
  readonly extraShared?: Record<string, unknown>;
  /** Merged into every locale's prose last — same purpose. */
  readonly extraProse?: Record<string, unknown>;
}

const DEFAULT_TITLES: Record<Locale, string> = {
  en: "TEST modification — synthetic",
  es: "Modificación TEST — sintética",
};

const DEFAULT_SUMMARIES: Record<Locale, string> = {
  en: "Synthetic T603 fixture. Not a real modification.",
  es: "Entrada sintética de T603. No es una modificación real.",
};

const DEFAULT_TRADEOFFS: Record<Locale, string> = {
  en: "TEST tradeoffs sentence in English. It states no figure.",
  es: "Frase TEST de contras en español. No indica ninguna cifra.",
};

/**
 * A mods entry as an author would write it — valid against today's schema by
 * default, with one knob per rule the graders need to break.
 *
 * Returned as a plain `Record<string, unknown>` for the reason
 * `makeProcedure` records: a grader must be able to hand the parser shapes the
 * type system would refuse, and the field this task is about does not exist
 * yet.
 */
export function makeMod(options: ModOptions = {}): Record<string, unknown> {
  const {
    id = "test-mod-roof-rack",
    system = "body",
    safetyCritical,
    cost = { from: "moderate", to: "significant" },
    difficulty = 3,
    confidence = "community-consensus",
    sources = [makeSource("forum")],
    requires = [],
    affects = [],
    specs,
    titles,
    summaries,
    tradeoffs,
    affectsNotes,
    extraShared,
    extraProse,
  } = options;

  const prose = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      {
        title: titles?.[locale] ?? DEFAULT_TITLES[locale],
        summary: summaries?.[locale] ?? DEFAULT_SUMMARIES[locale],
        tradeoffs: tradeoffs?.[locale] ?? DEFAULT_TRADEOFFS[locale],
        ...(affects.length > 0
          ? {
              affectsNotes:
                affectsNotes?.[locale] ??
                Object.fromEntries(
                  affects.map((row) => [
                    row.id,
                    locale === "en"
                      ? `TEST English note about ${row.id}.`
                      : `Nota TEST en español sobre ${row.id}.`,
                  ])
                ),
            }
          : {}),
        ...(extraProse ?? {}),
      },
    ])
  );

  return {
    id,
    /*
     * The year range puts two numbers inside the *fixed entry envelope*,
     * which `scripts/check-citations.mjs` deliberately never scans. Without
     * them the citation grader's control for that carve-out would be vacuous.
     */
    fitment: { gens: ["gen3"], years: { from: 1999, to: 2006 } },
    system,
    ...(safetyCritical === undefined ? {} : { safetyCritical }),
    cost,
    difficulty,
    requires,
    affects,
    ...(specs === undefined ? {} : { specs }),
    ...(extraShared ?? {}),
    confidence,
    sources,
    prose,
  };
}

/**
 * The same entry with one shared-data field removed. Deleting rather than
 * setting `undefined`: `{ specs: undefined }` is a *present* key in JSON terms
 * and some schemas treat the two differently.
 */
export function without(
  entry: Record<string, unknown>,
  field: string
): Record<string, unknown> {
  const copy = { ...entry };
  delete copy[field];
  return copy;
}

/** The corpus a mod citing every {@link SPEC_FIXTURES} figure resolves against. */
export function makeModCorpusFor(mods: readonly unknown[]): {
  mods: readonly unknown[];
  parts: readonly unknown[];
  references: readonly unknown[];
} {
  return {
    mods,
    parts: [makeModPart()],
    references: SPEC_FIXTURES.map((spec) => makeSpecReference(spec)),
  };
}
