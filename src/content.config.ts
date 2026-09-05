/**
 * Content collections (SCF-01, I18N-06).
 *
 * Every collection is built from `defineEntrySchema` — the single place the
 * `{ id, fitment, ...shared, confidence, sources, prose: { en, es } }` shape is
 * assembled — so the bilingual rule and the data/prose split are enforced
 * structurally rather than by review. A collection that hand-rolled its shape
 * could accept a one-locale entry while every factory unit test stayed green,
 * which is why `tests/schemas/collections.test.ts` grades what is registered
 * here and not just the factory.
 *
 * T104 registers the **base** shape for each collection the spec names
 * (§4–§8). Collection-specific fields — engine ids and chassis codes
 * (VEH-01), symptoms and fix paths (PRB-01), part numbers and supersession
 * chains (PRT-01), and so on — are added by the phase task that owns each
 * collection, by extending the `shared` and `prose` shapes passed below. Per
 * AGENTS.md a schema change is never a drive-by edit: it belongs to the task
 * that owns the collection.
 *
 * refs specs/001-foundation (SCF-01, SCF-04, I18N-06)
 */
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { defineEntrySchema } from "./schemas/entry";
import { communitySchema } from "./schemas/community";
import { glossaryEntrySchema } from "./schemas/glossary";
import { modsSchema } from "./schemas/mods";
import { partsSchema } from "./schemas/parts";
import { problemsEntrySchema } from "./schemas/problems";
import { proceduresSchema } from "./schemas/procedures";
import { referenceEntrySchema } from "./schemas/reference";
import { vehiclesEntrySchema } from "./schemas/vehicles";

/**
 * Files whose name starts with `_` are drafts/notes and are never loaded, per
 * Astro's own convention. Entries are data files or Markdown; the human text
 * lives in `prose.en` / `prose.es` either way, so a Markdown body is never the
 * canonical prose for one locale.
 */
export const ENTRY_PATTERN = "**/[^_]*.{md,mdx,json,yaml,yml}";

/**
 * The same pattern with the body-bearing formats removed — data files only.
 *
 * A `.md`/`.mdx` entry has a *body* as well as frontmatter, and the body is
 * outside every schema: `defineEntrySchema` validates `data`, so a Markdown
 * body is unvalidated, unlocalized free text that Astro will happily render.
 * For most collections that is merely unused. For `reference` it is a hole in
 * a copyright rule — the `fsm-section` kind caps its per-locale summary
 * precisely so the field cannot hold a reproduced procedure (AGENTS.md: "Cite
 * the Factory Service Manual, never reproduce it"), and a Markdown body walks
 * straight around that cap (T207 review, F1).
 *
 * So the guard is made structural where the rule is: this collection has no
 * legitimate use for a body, and a loader pattern cannot be forgotten the way
 * a check can. A `.md` under `src/content/reference/` is simply not an entry —
 * it never reaches the schema, never reaches a page, and never ships.
 *
 * **What this does not do, stated plainly** (measured, not assumed): such a
 * file is inert, but it is not *flagged*. The plain-Node scanners in
 * `scripts/lib/content-entries.mjs` walk every extension for every collection,
 * so a well-formed-frontmatter `.md` here is counted and passed by
 * `check:locales` / `check:citations` while Astro ignores it — the site is
 * safe, but a reproduced procedure could still sit in the repository. Closing
 * that (and the repo-wide fact that `.md` bodies are monolingual free text no
 * check reads, pre-existing since T104) is the follow-up recorded on tasks.md's
 * T207 line: it needs a decision about every collection, which this task does
 * not own.
 */
export const DATA_ENTRY_PATTERN = "**/[^_]*.{json,yaml,yml}";

/**
 * Which loader pattern each collection uses — the one place the answer lives,
 * so it is readable by a test rather than buried in a `glob()` call nobody can
 * introspect (`glob()` returns a loader that does not expose its pattern).
 *
 * A collection absent from this table is on {@link ENTRY_PATTERN}. Only
 * `reference` narrows, and only for the copyright reason above; widening it
 * again would be a visible edit to this table with a failing test attached
 * (`src/schemas/reference.test.ts`, "loads the reference collection from data
 * files only").
 */
export const COLLECTION_ENTRY_PATTERNS: Readonly<Record<string, string>> = {
  reference: DATA_ENTRY_PATTERN,
};

/**
 * Prose fields every entry carries, in both locales.
 *
 * Nothing numeric may appear here — `defineEntrySchema` throws at define time
 * if it does (AGENTS.md: "numbers are never translated").
 */
const baseProse = {
  title: z.string(),
  summary: z.string(),
};

/** The shape a collection gets until the phase task that owns it lands. */
const baseEntrySchema = () => defineEntrySchema({}, baseProse);

/**
 * One collection loaded from `src/content/<name>/`.
 *
 * Most collections still get `baseEntrySchema()`: their own fields arrive
 * with the phase task that owns them. A collection whose task *has* landed
 * passes the schema that task built — always via `defineEntrySchema` in
 * `src/schemas/<name>.ts`, so the `{ id, fitment, …, prose: { en, es } }`
 * envelope is identical either way and `tests/schemas/collections.test.ts`
 * grades both forms the same.
 *
 * Generic in the schema, and required rather than defaulted (T205): Astro
 * derives `entry.data` from `z.infer` of whatever type this parameter
 * *declares*, so annotating it as the base `z.ZodType` erased every
 * collection's data to `unknown` and any page reading a collection lost its
 * types. A generic with a default value would need an unsound cast to keep
 * the default, so every collection names its schema instead — one visible
 * word per line, and no collection is silently on the base shape.
 *
 * The loader pattern comes from {@link COLLECTION_ENTRY_PATTERNS}, defaulting
 * to {@link ENTRY_PATTERN} — a table rather than an argument, so the one
 * collection that narrows cannot be narrowed (or silently re-widened) without
 * the test that reads that table noticing.
 */
function entryCollection<S extends z.ZodType>(name: string, schema: S) {
  return defineCollection({
    loader: glob({
      pattern: COLLECTION_ENTRY_PATTERNS[name] ?? ENTRY_PATTERN,
      base: `./src/content/${name}`,
    }),
    schema,
  });
}

export const collections = {
  /** VEH-01…03 — generations, markets, engines, transmissions, trims. */
  vehicles: entryCollection("vehicles", vehiclesEntrySchema(baseProse)),
  /**
   * GLO-01…04 — canonical EN/ES terms and regional aliases.
   *
   * Assembled in `src/schemas/glossary.ts` (still through
   * `defineEntrySchema`) because the canonical-term format is the input to a
   * merge-blocking check and deserves its own module and its own tests. T205.
   */
  glossary: entryCollection("glossary", glossaryEntrySchema),
  /**
   * REF-01, REF-02 — FSM index, fluids, torque master table, capacities.
   *
   * Assembled in `src/schemas/reference.ts` (still through
   * `defineEntrySchema`): every figure is a `{ value, unit }` quantity in
   * shared data, which is what puts it in `check:citations`' scan. T207
   * (schema half). VIN/option-code decoder data is T208's kind to add.
   *
   * **Data files only** (`DATA_ENTRY_PATTERN`): the `fsm-section` kind caps
   * its per-locale summary so the field cannot hold a reproduced FSM
   * procedure, and a Markdown body would be unvalidated text that walks
   * straight around that cap (T207 review, F1). The narrowing itself is in
   * `COLLECTION_ENTRY_PATTERNS`.
   */
  reference: entryCollection("reference", referenceEntrySchema(baseProse)),
  /** GAR-01…05 — the build log for the truck. */
  garage: entryCollection("garage", baseEntrySchema()),
  /** PRB-01…06 — the symptom-driven problem finder. T401 (schema half). */
  problems: entryCollection("problems", problemsEntrySchema(baseProse)),
  /** PRT-01…03 — parts, fitment, supersession chains (T501). */
  parts: entryCollection("parts", partsSchema),
  /**
   * PRC-01…03 — step-by-step procedures: prerequisites, tools (with the
   * special/SST flag), parts consumed, and every torque or fluid figure cited
   * as a `reference` entry id rather than typed into a sentence (T502).
   * Cross-entry resolution of those ids is the build's, in
   * `src/integrations/validate-procedures.ts`.
   */
  procedures: entryCollection("procedures", proceduresSchema),
  /**
   * MOD-01, MOD-02 — modifications, their typed prerequisites and what they
   * break (T601). Cross-entry resolution of those references is the build's,
   * in `src/integrations/validate-mods.ts`.
   */
  mods: entryCollection("mods", modsSchema),
  /** COM-01, COM-02 — the bilingual community directory (T700). */
  community: entryCollection("community", communitySchema),
};
