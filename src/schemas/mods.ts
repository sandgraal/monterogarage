/**
 * The `mods` collection schema (MOD-01, MOD-02) — modifications and the honest
 * price of making them.
 *
 * > **MOD-01** THE `mods` collection SHALL hold, per entry: what it requires
 * > (by entry ID), what it breaks or affects, cost band, difficulty, fitment,
 * > honest tradeoffs prose in both locales, sources.
 * >
 * > **MOD-02** WHEN a mod requires another mod or part, THE requirement SHALL
 * > be a typed reference that the build resolves.
 *
 * Built on the T104 seam (`defineEntrySchema`), so the bilingual rule, the
 * data/prose split, the strict-object rule and the fitment/confidence
 * requirement are inherited rather than re-implemented.
 *
 * ## The typed reference is the whole of MOD-02
 *
 * A requirement is `{ collection, id }` — never a bare id string, and never a
 * free-text "you'll also need extended brake lines".
 *
 * The **`collection` discriminator is what makes it typed**, and it is
 * load-bearing rather than decorative. MOD-02's own sentence names *two*
 * target collections ("another mod or part"), and nothing stops one id
 * existing in both: `all-suspension-lift-kit` is an entirely plausible id for
 * a `mods` entry *and* for the `parts` entry that is the kit in a box. A bare
 * id would leave the resolver to search collections in some order and take the
 * first hit, which is a silent wrong answer — the page would link a reader to
 * the wrong page, and the build would call it resolved. With the discriminator
 * there is exactly one place to look, "the id exists but in the other
 * collection" becomes its own named build error
 * (`reference-wrong-collection`, `src/lib/mods/index.ts`), and the page knows
 * which route registry to build the link from without guessing.
 *
 * Resolution itself — does the id name a real entry, does the requirement
 * graph terminate — is a whole-corpus question and lives in
 * `src/lib/mods/index.ts`, exactly as PRT-02's supersession resolution lives
 * in `src/lib/parts/index.ts`. This module owns only what one entry can see
 * about itself.
 *
 * ## `requires` and `affects` are different edges and stay separate
 *
 * - **`requires`** is a *precondition*: without it, this mod does not go on
 *   the truck at all. It is MOD-01's "what it requires (by entry ID)".
 * - **`affects`** is a *consequence*: after this mod, something that used to
 *   be fine is not. It is MOD-01's "what it breaks or affects".
 *
 * Collapsing them into one list with a flag was rejected: they point in
 * opposite directions in time, only one of them can form a cycle worth
 * failing a build over (you cannot require a mod that requires you; you very
 * much *can* affect a mod that affects you), and a reader deciding whether to
 * start reads the two lists for different reasons.
 *
 * ## Every `affects` row carries its sentence, in both locales
 *
 * `affects[]` holds `{ id, system, impact, ref? }` in shared data and the
 * *explanation* in `prose.<locale>.affectsNotes`, keyed by the row's `id`
 * (never by array index — the T501 lesson: reordering the list would silently
 * re-point every note, and the diff would look like a no-op).
 *
 * The note is **required in both locales for every row**, which is stricter
 * than the `parts` collection's rule for the equivalent field, deliberately.
 * `breaks` / `degrades` / `needs-adjustment` is a three-word verdict about
 * somebody's truck, and MOD-01 asks in the same breath for "honest tradeoffs
 * prose in both locales" — a bare red chip reading "brakes: breaks" with no
 * words is precisely the dishonest form of that. It is the same structural
 * argument PRT-01's "known-bad brands **with evidence**" makes about naming a
 * business, applied to naming a hazard.
 *
 * ## Safety
 *
 * A mod carries `system` (what it modifies) exactly as `parts` and `problems`
 * do, so `src/lib/safety.ts` reaches it unchanged.
 *
 * What is new here is that a mod can be safety-critical **because of what it
 * touches on the way past**: a dual-battery install is `electrical`, and if it
 * `breaks` the ABS module it is a brakes page whatever its own facet says.
 * That widening lives in `src/lib/mods/index.ts` (`modSafety`), which composes
 * `isSafetyCritical`/`systemIsSafetyCritical` rather than restating them — the
 * flag still only ever promotes, never demotes, and this module refuses the
 * one incoherent value (`safetyCritical: false` on an already-critical
 * system) exactly as `parts` and `reference` do.
 *
 * ## Numbers, and `check:citations`
 *
 * `difficulty` is a number in shared data, so `scripts/check-citations.mjs`
 * walks it: a mod that states a difficulty and cites nothing fails the build,
 * named by field (REF-02, and the T106-review note carried on T501's line).
 * Nothing in {@link modsProse} is a figure — `defineEntrySchema` throws at
 * define time if it ever becomes one.
 *
 * ## Every *other* figure is a `reference` id — T604, on PRC-03's precedent
 *
 * T602's fact-check found that this collection had no typed home for a number:
 * `difficulty` aside, "`modsShared` is a strict object with no numeric field,
 * so a tire diameter, a roof-load limit or a gear ratio has no typed home.
 * Every figure therefore sits in the entry's `sources[].title`." That cost two
 * things at once — the numbers were invisible to `check:citations`, so REF-02's
 * "every numeric spec carries a source" was *vacuous* for exactly the entries
 * that state the most figures, and a Spanish reader's only view of "100 kg roof
 * load" was an English sentence inside a citation.
 *
 * {@link modsShared}'s `specs` closes it the way `procedures` already had:
 * **ids, never values**. A roof-load limit lives once, in the `reference` entry
 * that carries it and its own sources, and both locales' pages render from that
 * one copy. Note what this field deliberately is not — a `{ id, value, unit }`
 * row. That shape looks like it satisfies both halves ("referenced by id" *and*
 * "a typed number") and is the second copy wearing the reference's clothes: the
 * figure would live here and in the `reference` entry with nothing keeping the
 * two equal.
 *
 * Whether the id names a real entry, and whether that entry's `kind` carries a
 * figure at all, are whole-corpus questions and live in `src/lib/mods/index.ts`
 * — the same division `requires` already draws.
 *
 * {@link checkInlinedFigures} is the other half: a typed path an author never
 * uses is not a fix, so the sentences this collection owns are scanned for a
 * figure written into them, exactly as `procedures` scans its own. The
 * detector's stated gap (mass and length are outside the category, because no
 * regex separates "100 kg" from "a 20 kg drawer you lift out") is inherited
 * unchanged from `src/lib/procedures/figures.ts`; it is closed the other way,
 * by `dimension` being citable, so an author always has a correct move.
 *
 * `cost` reuses T401's `COST_BANDS` through {@link fixCostSchema} rather than
 * minting a mods-only price vocabulary. A fix path's cost and a mod's cost are
 * the same claim about the same money; two enums would render as two different
 * chips for one idea, and would drift the first time either list gained a step
 * (the reason recorded on `costBandSchema`'s own export, and the call T501
 * made for PRT-01's price band).
 *
 * refs specs/001-foundation (MOD-01, MOD-02)
 */
import { z } from "astro/zod";
import { defineEntrySchema, nonBlankString } from "./entry";
import { glossarySystemSchema } from "./glossary";
import { difficultySchema, fixCostSchema } from "./problems";
import {
  requiresSafetyFlagFromSubject,
  systemIsSafetyCritical,
} from "../lib/safety";
import { findInlinedFigure } from "../lib/procedures/figures";
import {
  MOD_ID_PATTERN,
  MOD_IMPACTS,
  MOD_REFERENCE_COLLECTIONS,
  modReferenceKey,
} from "../lib/mods/references";

/* -------------------------------------------------------------------------
 * Ids and typed references — MOD-02
 *
 * The vocabularies themselves live in `src/lib/mods/references.ts` — see that
 * module for why (the build hook that resolves MOD-02's references must reach
 * them through Node's own ESM resolver, without dragging the schema graph
 * along; the same split `src/lib/parts/part-numbers.ts` records for PRT-03).
 * This module only wraps them in Zod, so the definition of "a typed reference"
 * exists once, and re-exports them so a content author has one import path.
 * ---------------------------------------------------------------------- */

export {
  MOD_ID_PATTERN,
  MOD_IMPACTS,
  MOD_IMPACT_WORST,
  MOD_REFERENCE_COLLECTIONS,
  modReferenceKey,
  type ModImpact,
  type ModReferenceCollection,
} from "../lib/mods/references";

/**
 * MOD-02's typed reference: which collection, and which entry in it.
 *
 * See the module docstring for why the discriminator is not optional and not
 * inferable.
 */
export const modReferenceSchema = z
  .object({
    collection: z.enum(MOD_REFERENCE_COLLECTIONS),
    id: z.string().regex(MOD_ID_PATTERN, {
      message:
        "a typed reference names its target by entry id, which is lowercase " +
        "kebab-case (`all-electrical-dual-battery`) — not a slug, not a file " +
        "path and not a part number. Whether that id names a real entry is " +
        "resolved by the build (`src/lib/mods/index.ts`). " +
        "refs specs/001-foundation (MOD-02)",
    }),
  })
  .strict();

export type ModReference = z.infer<typeof modReferenceSchema>;

/**
 * One figure this mod states, as the id of the `reference` entry that holds it
 * (T604, on PRC-03's precedent).
 *
 * A bare id string and not `{ collection, id }`: unlike `requires`, there is no
 * discriminator to make, because there is only one collection a figure can come
 * from. `reference` is where REF-01 files torques, capacities, fluids and
 * dimensions, and it is the only collection whose entries carry a number with
 * its own sources attached. `procedures` spells its own `specs` the same way,
 * and a second spelling of one idea is a second vocabulary an author has to
 * learn per collection.
 *
 * The pattern is the one check that catches the mistake an author actually
 * makes — pasting a **catalogue token** (`MR455009`, `TEST-REF-0001`, uppercase)
 * where an entry id belongs. Whether the id names a real entry, and whether that
 * entry carries a figure at all, is the build's question
 * (`src/lib/mods/index.ts`), exactly as it is for a typed reference.
 */
export const modSpecIdSchema = z.string().regex(MOD_ID_PATTERN, {
  message:
    "a figure is cited by the id of the `reference` entry that holds it, " +
    "which is lowercase kebab-case (`g3-dimension-roof-load`) — not a " +
    "catalogue number, not a slug and not the number itself. The value stays " +
    "in the `reference` entry, with its own sources, so it exists once and " +
    "both locales render from that one copy. " +
    "refs specs/001-foundation (MOD-01, PRC-03 precedent)",
});

/* -------------------------------------------------------------------------
 * What a mod breaks or affects — MOD-01
 * ---------------------------------------------------------------------- */

/** `MOD_IMPACTS` as a closed enum; see that constant for what each value means. */
export const modImpactSchema = z.enum(MOD_IMPACTS);

/**
 * One consequence of fitting this mod.
 *
 * `id` is an author-chosen handle, unique **within the entry** — the key the
 * bilingual note is stored under, and usable as a DOM id on the page. It is
 * not a global id and nothing outside the entry ever refers to it (the
 * `crossReferences[].ref` pattern `src/schemas/parts.ts` settled, for the same
 * reason: an array index would re-point every note the day someone reorders
 * the list).
 */
export const modImpactRowSchema = z
  .object({
    id: z.string().regex(MOD_ID_PATTERN, {
      message:
        "`id` is a lowercase kebab-case handle for this consequence inside " +
        "this entry (`headlamp-aim`); the bilingual note in " +
        "`prose.<locale>.affectsNotes` is keyed by it. " +
        "refs specs/001-foundation (MOD-01)",
    }),
    /**
     * Which system takes the hit, from the glossary's vocabulary — the same
     * closed list `parts`, `problems` and `reference` file under, so a mod's
     * consequences land in the same filter pills, the same translated labels
     * and the same `src/lib/safety.ts` judgement rather than a second
     * near-identical taxonomy.
     */
    system: glossarySystemSchema,
    impact: modImpactSchema,
    /**
     * Optionally, the entry this consequence is *about* — the mod it is
     * incompatible with, or the part it renders unusable. A typed reference
     * like every other, resolved by the build.
     *
     * Optional because most consequences have no entry to point at yet ("the
     * factory jack no longer reaches" is true long before anyone writes a
     * jacking-points page), and MOD-01 asks for "what it breaks or affects",
     * not "which entry id it breaks". The `system` facet and the bilingual
     * note carry the claim on their own; the reference sharpens it when there
     * is something to sharpen it with.
     */
    ref: modReferenceSchema.optional(),
  })
  .strict();

export type ModImpactRow = z.infer<typeof modImpactRowSchema>;

/* -------------------------------------------------------------------------
 * The entry shape
 * ---------------------------------------------------------------------- */

/** Locale-independent facts about the modification. Nothing here is translated. */
export const modsShared = {
  /**
   * Which system the mod is *of* — a lift is `suspension`, a dual battery is
   * `electrical`, a roof rack is `body`. What it collides with on the way past
   * is `affects`, and `src/lib/mods/index.ts` reads both when it decides
   * whether the standing bilingual safety notice renders.
   */
  system: glossarySystemSchema,

  /**
   * Promotes a mod neither the system list nor the subject detector catches —
   * AGENTS.md's SRS/airbags and load-rating categories, which have no
   * `GLOSSARY_SYSTEMS` id of their own. Upward only: `false` on a system that
   * is already safety-critical is rejected below, exactly as
   * `src/schemas/parts.ts` and `src/schemas/reference.ts` reject it.
   */
  safetyCritical: z.boolean().optional(),

  /**
   * MOD-01's "cost band", MOD-02-adjacent only in that it is data. T401's
   * `COST_BANDS`, as a single band or a range — never a figure. A price in
   * colones or dollars would be a number no source could support six months
   * from now, in a market where the same kit lands at three prices depending
   * on who imported it.
   */
  cost: fixCostSchema,

  /** MOD-01's "difficulty", on PRB-01/PRC-01's shared 1–5 scale. */
  difficulty: difficultySchema,

  /**
   * MOD-01's "what it requires (by entry ID)", as MOD-02's typed references.
   *
   * Defaults to empty and empty is legal: plenty of mods are genuinely
   * standalone, and a schema that forced every entry to invent a prerequisite
   * would get inventions. The build refuses a reference that does not resolve,
   * a self-reference and a requirement cycle
   * (`src/lib/mods/index.ts`).
   */
  requires: z.array(modReferenceSchema).default([]),

  /**
   * MOD-01's "what it breaks or affects".
   *
   * Also legally empty — but note that an entry with no `affects` row and no
   * tradeoffs prose is what `npm run gaps` is for (GAP-01's shape), not
   * something this schema can distinguish from an honestly consequence-free
   * mod. What it *can* refuse, and does, is a row with no sentence attached.
   */
  affects: z.array(modImpactRowSchema).default([]),

  /**
   * Every figure this mod states, by `reference` entry id (T604).
   *
   * Empty by default and legally empty: plenty of mods state no number at all,
   * and a schema that demanded one would get inventions — the reasoning
   * `requires` already records for its own empty default.
   *
   * See the module docstring for why this is a list of ids and never a list of
   * `{ id, value, unit }` rows, and {@link modSpecIdSchema} for the id's shape.
   */
  specs: z.array(modSpecIdSchema).default([]),
};

/**
 * Per-locale text.
 *
 * `title` and `summary` restate the base prose shape in
 * `src/content.config.ts` rather than importing it, for the reason
 * `src/schemas/community.ts` and `src/schemas/parts.ts` both record:
 * `content.config.ts` imports *this* module to register the collection, so
 * reaching back the other way is a cycle.
 *
 * Nothing numeric may appear here — `defineEntrySchema` throws at define time
 * if it does. A cost, a difficulty, a lift height or a tire size written into
 * a locale is a fact stored twice (AGENTS.md).
 */
export const modsProse = {
  title: z.string(),
  summary: z.string(),

  /**
   * MOD-01's "honest tradeoffs prose", and the field this collection exists
   * for.
   *
   * **Required, in both locales, on every entry** — not optional, not
   * defaulted. A modifications section that lets an entry ship with the
   * upside written and the downside left blank is an advertisement, and this
   * site is not one. The requirement is structural for the same reason the
   * bilingual rule is: "we'll add the tradeoffs later" is a state that never
   * ends, and a reader cannot see that it is the state they are in.
   *
   * A separate field from `summary` on purpose. `summary` says what the mod
   * *is*; this says what it *costs you*, and merging them would let a
   * well-written sentence about capability count as having disclosed a
   * downside.
   */
  tradeoffs: nonBlankString(),

  /**
   * `affectsRowId → "The factory rear brake hose is now too short."`
   *
   * A record and not an array because the key is what ties a sentence to a
   * consequence; see {@link modImpactRowSchema}. Every key must name a
   * declared row and every declared row must have a key, **in both locales** —
   * both directions are checked below, so a note keyed to nothing is a build
   * error rather than text nothing renders, and a red chip with no words
   * cannot ship.
   *
   * Optional as a whole only so an entry with no `affects` rows need not carry
   * an empty object; an entry *with* rows is required to fill it.
   */
  affectsNotes: z.record(z.string(), nonBlankString()).optional(),
};

/* -------------------------------------------------------------------------
 * Per-entry rules
 *
 * Everything here is a contradiction visible from *inside one entry* — the
 * line `src/schemas/entry.ts`, `src/schemas/reference.ts` and
 * `src/schemas/parts.ts` all draw for what a schema refinement may enforce.
 * Questions about other entries (does this reference resolve? does the
 * requirement graph terminate?) are the build's, in `src/lib/mods/index.ts`.
 * ---------------------------------------------------------------------- */

/**
 * The slice of Zod's refinement context these rules use, declared structurally
 * (rather than importing `z.RefinementCtx`) so {@link checkModsEntry} can be
 * called with a plain collector from a unit test — the seam
 * `checkPartsEntry`, `checkReferenceEntry` and `checkVehicleTaxonomy` use.
 */
export interface ModsRefineContext {
  addIssue(issue: {
    code: "custom";
    path: PropertyKey[];
    message: string;
  }): void;
}

interface ModsEntryShape {
  id?: unknown;
  system?: unknown;
  safetyCritical?: unknown;
  requires?: unknown;
  affects?: unknown;
  specs?: unknown;
  sources?: unknown;
  prose?: unknown;
}

interface ReadReference {
  readonly collection?: string;
  readonly id?: string;
}

interface ReadRequirement extends ReadReference {
  readonly index: number;
}

interface ReadImpactRow {
  readonly index: number;
  readonly id?: string;
  readonly system?: string;
  readonly impact?: string;
  readonly ref?: ReadReference;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * `requires`, read tolerantly — the field schema reports shape, and a second
 * complaint here would send an author chasing two problems for one mistake.
 */
function readRequires(entry: ModsEntryShape): ReadRequirement[] {
  const { requires } = entry;
  if (!Array.isArray(requires)) return [];

  return requires.map((value, index) => {
    const record = asRecord(value);
    if (record === null) return { index };
    return {
      index,
      collection: asString(record["collection"]),
      id: asString(record["id"]),
    };
  });
}

/** `affects`, read the same way. */
function readAffects(entry: ModsEntryShape): ReadImpactRow[] {
  const { affects } = entry;
  if (!Array.isArray(affects)) return [];

  return affects.map((value, index) => {
    const record = asRecord(value);
    if (record === null) return { index };

    const refRecord = asRecord(record["ref"]);
    return {
      index,
      id: asString(record["id"]),
      system: asString(record["system"]),
      impact: asString(record["impact"]),
      ref:
        refRecord === null
          ? undefined
          : {
              collection: asString(refRecord["collection"]),
              id: asString(refRecord["id"]),
            },
    };
  });
}

/**
 * `prose.<locale>.affectsNotes`, per locale, read tolerantly.
 *
 * One row per **locale the entry declares**, not per locale that happens to
 * carry notes — a locale whose `affectsNotes` is absent gets an empty map.
 * That distinction is the whole point: the realistic mistake is writing the EN
 * sentence for a `breaks` row and forgetting the ES one, and a reader that
 * skipped absent locales would report nothing for exactly that case (the
 * `readNotes` argument in `src/schemas/parts.ts`, and the F1 audit finding
 * that made it load-bearing there).
 *
 * The locale list comes from the entry rather than from `LOCALES` so a missing
 * locale is reported once, by `defineEntrySchema`, rather than twice.
 */
function readNotes(
  entry: ModsEntryShape
): { locale: string; notes: Record<string, unknown> }[] {
  const prose = asRecord(entry.prose);
  if (prose === null) return [];

  const found: { locale: string; notes: Record<string, unknown> }[] = [];
  for (const [locale, value] of Object.entries(prose)) {
    const localeRecord = asRecord(value);
    if (localeRecord === null) continue;
    const notes = asRecord(localeRecord["affectsNotes"]);
    found.push({ locale, notes: notes ?? {} });
  }
  return found;
}

/**
 * `safetyCritical` promotes; it never demotes. Verbatim the rule
 * `src/schemas/parts.ts` and `src/schemas/reference.ts` state, because it is
 * the same rule about the same flag.
 */
function checkSafetyFlag(entry: ModsEntryShape, ctx: ModsRefineContext): void {
  if (entry.safetyCritical !== false) return;
  if (!systemIsSafetyCritical(entry.system)) return;

  ctx.addIssue({
    code: "custom",
    path: ["safetyCritical"],
    message:
      `\`${String(entry.system)}\` is a safety-critical system (AGENTS.md ` +
      `"Safety and legal"), so this mod renders the standing bilingual ` +
      `safety notice whatever this field says. \`safetyCritical\` only ever ` +
      `promotes a mod the system list does not catch — drop the field. ` +
      `refs specs/001-foundation (MOD-01)`,
  });
}

/**
 * The T207-audit subject rule, applied to this collection.
 *
 * Mods are where towing and jacking/lifting actually live on this site — a
 * suspension lift, a roof-load system, a recovery point — and every one of
 * those is an AGENTS.md safety-critical category with no `GLOSSARY_SYSTEMS` id
 * of its own. The detector is `src/lib/safety.ts`'
 * {@link requiresSafetyFlagFromSubject}, read from there rather than restated,
 * so the rule that decides whether the standing bilingual safety notice
 * renders is one rule read from one place.
 */
function checkSafetySubject(
  entry: ModsEntryShape,
  ctx: ModsRefineContext
): void {
  if (entry.safetyCritical === true) return;
  if (systemIsSafetyCritical(entry.system)) return;
  if (!requiresSafetyFlagFromSubject(entry)) return;

  ctx.addIssue({
    code: "custom",
    path: ["safetyCritical"],
    message:
      `this mod's subject names towing, or jacking/lifting points — ` +
      `AGENTS.md safety-critical categories with no \`system\` id of their ` +
      `own — so it must set \`safetyCritical: true\` to render the standing ` +
      `bilingual safety notice (AGENTS.md "Safety and legal"). ` +
      `refs specs/001-foundation (MOD-01)`,
  });
}

/**
 * A mod does not require itself.
 *
 * The general case — a cycle of any length — is the build's, because it needs
 * every entry. This is the one-node case, which is visible from inside the
 * entry and is by far the likeliest way it happens (an author copies the
 * entry's own id into the list).
 */
function checkSelfRequirement(
  entry: ModsEntryShape,
  ctx: ModsRefineContext
): void {
  const id = asString(entry.id);
  if (id === undefined) return;

  for (const { collection, id: target, index } of readRequires(entry)) {
    if (collection !== "mods" || target !== id) continue;

    ctx.addIssue({
      code: "custom",
      path: ["requires", index],
      message:
        `\`${id}\` cannot require itself: \`requires\` names the *other* ` +
        `mods and parts that have to be on the truck first, and a mod with ` +
        `no prerequisites simply lists none. ` +
        `refs specs/001-foundation (MOD-02)`,
    });
  }
}

/** The same reference may not be required twice — the page would list it twice. */
function checkRequirementsAreUnique(
  entry: ModsEntryShape,
  ctx: ModsRefineContext
): void {
  const seen = new Map<string, number>();

  for (const { collection, id, index } of readRequires(entry)) {
    if (collection === undefined || id === undefined) continue;
    const key = modReferenceKey({ collection, id });
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, index);
      continue;
    }

    ctx.addIssue({
      code: "custom",
      path: ["requires", index],
      message:
        `\`${key}\` is already required at index ${first} — the same ` +
        `prerequisite twice is one row entered twice, and the page would ` +
        `render it twice. refs specs/001-foundation (MOD-02)`,
    });
  }
}

/** Two consequences may not share a handle — the notes are keyed by it. */
function checkAffectsIdsAreUnique(
  entry: ModsEntryShape,
  ctx: ModsRefineContext
): void {
  const seen = new Map<string, number>();

  for (const { id, index } of readAffects(entry)) {
    if (id === undefined) continue;
    const first = seen.get(id);
    if (first === undefined) {
      seen.set(id, index);
      continue;
    }

    ctx.addIssue({
      code: "custom",
      path: ["affects", index, "id"],
      message:
        `\`${id}\` is already used by the consequence at index ${first}. ` +
        `Each handle is unique within the entry because the bilingual note ` +
        `is keyed by it — two rows sharing one handle share one sentence and ` +
        `one of them is wrong. refs specs/001-foundation (MOD-01)`,
    });
  }
}

/**
 * A mod's consequence is a consequence for something *else*.
 *
 * A row whose `ref` points back at this very entry would render as "this mod
 * breaks itself", which is either a copy-paste or a claim that belongs in the
 * tradeoffs prose rather than in a cross-reference.
 */
function checkAffectsSelfReference(
  entry: ModsEntryShape,
  ctx: ModsRefineContext
): void {
  const id = asString(entry.id);
  if (id === undefined) return;

  for (const row of readAffects(entry)) {
    const { ref, index } = row;
    if (ref === undefined) continue;
    if (ref.collection !== "mods" || ref.id !== id) continue;

    ctx.addIssue({
      code: "custom",
      path: ["affects", index, "ref"],
      message:
        `\`${id}\` cannot list itself as something it affects: \`ref\` names ` +
        `the *other* entry this consequence is about. If the point is that ` +
        `the mod has a downside of its own, that is what the bilingual ` +
        `\`tradeoffs\` prose is for. refs specs/001-foundation (MOD-01)`,
    });
  }
}

/**
 * Every consequence has its sentence, in **every locale the entry declares**.
 *
 * This is MOD-01's "honest tradeoffs prose in both locales" made structural at
 * the row level: `impact: "breaks"` with no words is a red chip a reader
 * cannot weigh, and a sentence written in `en` and left out of `es` is
 * AGENTS.md's "no page ships in one language, both or neither" violated one
 * table cell at a time — the exact defect the T501 audit found (F1) in the
 * collection this pattern is borrowed from.
 *
 * The locale list comes from the entry's own `prose` rather than from
 * `LOCALES`, so this rule reports "the note is missing" and never re-reports
 * "the locale is missing" — `defineEntrySchema` already owns that, and one
 * mistake should produce one error.
 */
function checkAffectsNotesAreComplete(
  entry: ModsEntryShape,
  ctx: ModsRefineContext
): void {
  const rows = readAffects(entry);
  if (rows.length === 0) return;

  const locales = readNotes(entry);

  for (const { id, impact, index } of rows) {
    if (id === undefined) continue;

    for (const { locale, notes } of locales) {
      const note = notes[id];
      if (typeof note === "string" && note.trim().length > 0) continue;

      ctx.addIssue({
        code: "custom",
        path: ["prose", locale, "affectsNotes", id],
        message:
          `the consequence at index ${index} says this mod ` +
          `\`${impact ?? "affects"}\` something, so it needs a sentence in ` +
          `this locale saying what and why — MOD-01 asks for honest ` +
          `tradeoffs prose in both locales, and a verdict with no words is a ` +
          `label a reader cannot weigh. Both locales, always (I18N-06). ` +
          `refs specs/001-foundation (MOD-01)`,
      });
    }
  }
}

/** Every note names a consequence that exists. */
function checkNotesNameDeclaredRows(
  entry: ModsEntryShape,
  ctx: ModsRefineContext
): void {
  const declared = new Set(
    readAffects(entry).flatMap(({ id }) => (id === undefined ? [] : [id]))
  );

  for (const { locale, notes } of readNotes(entry)) {
    for (const key of Object.keys(notes)) {
      if (declared.has(key)) continue;

      ctx.addIssue({
        code: "custom",
        path: ["prose", locale, "affectsNotes", key],
        message:
          `no \`affects\` row on this entry has \`id: "${key}"\`` +
          (declared.size === 0
            ? `, and the entry declares none at all`
            : ` (it declares ${[...declared].map((row) => `\`${row}\``).join(", ")})`) +
          `. A note keyed to nothing renders nowhere — either the row was ` +
          `deleted and the note should go with it, or the key is a typo. ` +
          `refs specs/001-foundation (MOD-01)`,
      });
    }
  }
}

/**
 * The same figure may not be cited twice on one entry.
 *
 * `procedures` already refuses this (`checkDuplicateStrings`) and the reason
 * carries over unchanged: the page renders one row per cited id, so a repeat is
 * one figure shown twice — and the author who repeated it probably meant to
 * cite a *different* one, which is the mistake worth naming.
 */
function checkSpecsAreUnique(
  entry: ModsEntryShape,
  ctx: ModsRefineContext
): void {
  const { specs } = entry;
  if (!Array.isArray(specs)) return;

  const seen = new Map<string, number>();

  specs.forEach((value, index) => {
    if (typeof value !== "string") return;
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, index);
      return;
    }

    ctx.addIssue({
      code: "custom",
      path: ["specs", index],
      message:
        `\`${value}\` is already cited at index ${first}. The page renders ` +
        `one row per cited id, so the same figure twice is one row entered ` +
        `twice — and if two different figures were meant, one of these ids is ` +
        `the wrong one. refs specs/001-foundation (MOD-01, PRC-03 precedent)`,
    });
  });
}

/**
 * Every free sentence this collection owns, scanned for a figure written into
 * it — the fourth way to inline a value, and the only one no shape can catch.
 *
 * The other three are already closed: `defineEntrySchema` throws at define time
 * on a numeric prose field, and the strict entry object refuses a figure
 * smuggled into `prose` or re-declared in the mod's own shared data. This
 * catches **"Apriete las patas a 100 N·m"** — a number that now exists once in
 * `en`, once in `es`, and nowhere a build can compare them.
 *
 * It is here rather than left to review because T602's own bilingual pass found
 * the defect in shipped content: the 33s entry typed a source's figure into
 * *both* locale prose blocks one sentence after its summary promised the
 * numbers were "in the citation rather than repeated here". Giving `mods` a
 * typed figure path without the guard that pushes an author toward it would
 * leave that hole with a nicer alternative beside it.
 *
 * ## Scope, and the two things deliberately outside it
 *
 * `title`, `summary`, `tradeoffs` and each `affectsNotes` row — every sentence
 * a reader sees. `title` and `summary` are in for the reason T502's review
 * recorded as F2 one collection over: a summary renders on the detail page
 * *and* on every index card, so a detector scoped to the "interesting" field
 * ships the figure on the most surfaces the collection has.
 *
 *  1. **`sources[].title` is not scanned.** A source title is a document's own
 *     title, quoted. Run against the ten shipped wave-1 entries the detector
 *     fires on five of them and every one is a false positive of the kind that
 *     gets a rule deleted — "3.8L V6" is the engine's name inside a listing's
 *     title, "3000cc" is part of ARB's own product description. The
 *     requirement is that an author has an *alternative* to putting the figure
 *     there, not that a citation may not quote accurately.
 *  2. **Mass, length and angle are a stated gap**, inherited verbatim from
 *     `src/lib/procedures/figures.ts` (where it is written down for `mm`).
 *     "100 kg" and "51 mm" are the roof-load and lift-height shapes this
 *     collection most wants to catch, and no regex separates them from "a
 *     14 mm socket" or "a 20 kg drawer you lift out". It is closed the other
 *     way instead — `dimension` is citable by id, so an author *has* a correct
 *     move — and the residual risk is carried by review. If a future round
 *     finds a way to tell a figure from a tool size, widen the pattern there
 *     and the whole repository gains it at once.
 */
function checkInlinedFigures(
  entry: ModsEntryShape,
  ctx: ModsRefineContext
): void {
  const prose = asRecord(entry.prose);
  if (prose === null) return;

  const report = (path: PropertyKey[], text: string): void => {
    const figure = findInlinedFigure(text);
    if (figure === null) return;

    ctx.addIssue({
      code: "custom",
      path,
      message:
        `this sentence states the figure \`${figure}\` itself. A figure comes ` +
        `from shared reference data **by ID** (PRC-03's rule, and this ` +
        `collection's since T604) — written into a sentence it exists once in ` +
        `\`en\`, once in \`es\` and nowhere a build can compare them, so the ` +
        `day the figure is corrected one language keeps the old one, and a ` +
        `reader of the other language is the one who finds out. Cite the ` +
        `\`reference\` entry in \`specs\` and let the page render the number ` +
        `from the one stored copy. (A count — "the three bolts" — a tire size ` +
        `and a gear ratio are not figures this rule is about.) ` +
        `refs specs/001-foundation (MOD-01, PRC-03 precedent)`,
    });
  };

  for (const [locale, block] of Object.entries(prose)) {
    const localeProse = asRecord(block);
    if (localeProse === null) continue;

    for (const field of ["title", "summary", "tradeoffs"]) {
      const text = localeProse[field];
      if (typeof text !== "string") continue;
      report(["prose", locale, field], text);
    }

    const notes = asRecord(localeProse["affectsNotes"]) ?? {};
    for (const [id, text] of Object.entries(notes)) {
      if (typeof text !== "string") continue;
      report(["prose", locale, "affectsNotes", id], text);
    }
  }
}

/**
 * Every mods rule, applied to an entry that already satisfies the base entry
 * shape. Exported so the rules can be unit-tested — and read — without
 * reconstructing the whole collection schema.
 */
export function checkModsEntry(entry: unknown, ctx: ModsRefineContext): void {
  const candidate = asRecord(entry);
  if (candidate === null) return;

  checkSafetyFlag(candidate, ctx);
  checkSafetySubject(candidate, ctx);
  checkSelfRequirement(candidate, ctx);
  checkRequirementsAreUnique(candidate, ctx);
  checkAffectsIdsAreUnique(candidate, ctx);
  checkAffectsSelfReference(candidate, ctx);
  checkAffectsNotesAreComplete(candidate, ctx);
  checkNotesNameDeclaredRows(candidate, ctx);
  checkSpecsAreUnique(candidate, ctx);
  checkInlinedFigures(candidate, ctx);
}

/**
 * The registered `mods` schema: the base entry envelope (id, fitment,
 * confidence, sources, both prose locales) plus the rules above.
 */
export const modsSchema = defineEntrySchema(modsShared, modsProse).superRefine(
  (entry, ctx) => {
    checkModsEntry(entry, ctx);
  }
);

export type ModEntryData = z.infer<typeof modsSchema>;
