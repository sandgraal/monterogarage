/**
 * The `procedures` collection schema (PRC-01, PRC-02, PRC-03) — the site's jobs.
 *
 * > **PRC-01** THE `procedures` collection SHALL hold, per entry:
 * > prerequisites, tools (flagging special/SST tools), parts consumed, torque
 * > specs (from shared data, cited), fluid specs and capacities (cited),
 * > step-by-step prose in both locales, time estimate, difficulty 1–5, safety
 * > notes.
 * >
 * > **PRC-02** WHEN a procedure touches a safety-critical system, THE entry
 * > SHALL carry the `safety-critical` flag and render per PRB-03's notice
 * > rules.
 * >
 * > **PRC-03** IF a procedure cites a torque or fluid spec, THEN THE value
 * > SHALL come from shared reference data by ID, never inlined per-locale.
 *
 * Built on the T104 seam (`defineEntrySchema`), so the bilingual rule, the
 * data/prose split, the strict-object rule and the fitment/confidence
 * requirement are inherited rather than re-implemented.
 *
 * ## Assembled out of parts this repo already shipped
 *
 * Nothing here is re-minted. `difficultySchema` / `DIFFICULTY_MIN` /
 * `DIFFICULTY_MAX` and `FIX_TIME_UNITS` come from `src/schemas/problems.ts`,
 * whose docstring already says the scale is "exactly as PRB-01 (**and PRC-01**)
 * scale it". `quantitySchema` comes from `src/schemas/reference.ts` — one
 * implementation of "a figure stated as a value, as a band, or as a nominal
 * with its band", including the rule that a lone `min` is half a specification.
 * `system` is `glossarySystemSchema` and `safetyCritical` is the same
 * upward-only flag `parts` and `reference` carry, read by `src/lib/safety.ts`.
 * `ENTRY_REFERENCE_PATTERN` and `partNumberSchema` come from
 * `src/schemas/parts.ts`: an SST number is a Mitsubishi catalogue token exactly
 * like a part number, and an id that points at another entry has one shape
 * site-wide.
 *
 * ## The shape of a procedure: parallel halves joined by ids
 *
 * The `problems` pattern, reused rather than reinvented. Each of the three
 * human-facing lists appears **twice, keyed by the same ids** — the structural
 * half in shared `data` (order, which spec a step cites, whether a tool is
 * special) and the human half in per-locale `prose`:
 *
 * ```jsonc
 * "steps":  [{ "id": "drain", "specs": ["g3-torque-oil-drain-plug"] }],
 * "prose": {
 *   "en": { "steps": { "drain": "Drain the oil into a pan." } },
 *   "es": { "steps": { "drain": "Drene el aceite en una bandeja." } }
 * }
 * ```
 *
 * {@link checkProseCoverage} requires the id sets to match **exactly**, in both
 * locales: an id in `data` with no sentence in `prose.es` is a missing
 * translation (I18N-06 one level down), and a sentence for an id `data` does
 * not declare is text that renders nowhere, in one language. Index-aligned
 * parallel arrays would express the same thing and would silently re-pair
 * themselves the first time somebody reordered one list.
 *
 * ## PRC-03: three guards and a build check
 *
 * A figure a procedure states is a `reference` entry id in {@link specs}, and
 * nothing else. Four ways to break that, caught at four different moments:
 *
 * 1. **Define time.** A number declared in {@link proceduresProse} means every
 *    content file stores it twice, once per locale, forever —
 *    `defineEntrySchema` throws before any content is parsed.
 * 2. **Parse time, prose side.** A figure smuggled into an entry's `prose` is
 *    an unrecognised key, named with its locale path (SCF-04).
 * 3. **Parse time, shared side.** A `torque`, `capacity`, `specification` or
 *    `serviceInterval` field re-declared here is the subtler half of "never
 *    inlined": it does not duplicate across locales, so guard 1 never sees it,
 *    and the figure still lives in two places with nothing keeping them equal.
 *    The strict entry object refuses it, because this module simply does not
 *    declare those fields — a procedure states no spec of its own.
 * 4. **Parse time, prose text.** "Apriete los pernos a 88 N·m" — the violation
 *    an author actually commits, per-locale by construction, invisible to every
 *    type-level guard because it is a string. {@link findInlinedFigure}
 *    (`src/lib/procedures/figures.ts`) is the detector, and its docstring
 *    carries the category, the carve-outs and the stated gap.
 *
 * The corpus half — does the id resolve, and is it a kind that carries a
 * figure — is `src/lib/procedures/index.ts`, called from
 * `src/integrations/validate-procedures.ts` on `astro:build:start`.
 *
 * ## Numbers, and `check:citations`
 *
 * {@link proceduresShared} carries three figures — `difficulty`, `time` and a
 * consumed part's `quantity` — and every one of them is a numeric leaf of
 * shared data, which is what puts it inside `scripts/check-citations.mjs`' scan
 * (REF-02, and the T106-review note this task inherits from T501). An entry
 * that states a difficulty and cites nothing fails the build, named by field.
 * That is why `difficulty` is a **number** and not a five-value enum, and why
 * nothing in {@link proceduresProse} is a figure.
 *
 * ## Safety (PRC-02)
 *
 * Which entries render the standing bilingual safety notice is
 * `src/lib/safety.ts`'s `isSafetyCritical`, from `system` plus the upward-only
 * `safetyCritical` flag — the same one function `reference`, `parts` and
 * `problems` ask, so there is one answer site-wide. The flag only ever
 * promotes: `false` on a system already on the list is rejected
 * ({@link checkSafetyFlag}), and a job whose *subject* is towing or
 * jacking/lifting must set it ({@link checkSafetySubject}, the T207 audit's F3
 * — which matters more here than anywhere, because "jack the truck up" is an
 * instruction somebody follows).
 *
 * PRC-01's ninth field is required exactly where it is meant to be used:
 * **safety-critical ⇒ `safetyNotes` in both locales** ({@link
 * checkSafetyNotes}). The standing notice is one sentence the whole site
 * shares; if a safety-critical procedure could ship with no note of its own,
 * "safety notes" would be a field that never has to be filled in on precisely
 * the entries it exists for. Not safety-critical ⇒ optional, because a note on
 * an air-filter change is noise, and a notice nobody needs is a notice nobody
 * reads.
 *
 * refs specs/001-foundation (PRC-01, PRC-02, PRC-03)
 */
import { z } from "astro/zod";
import { defineEntrySchema } from "./entry";
import { glossarySystemSchema } from "./glossary";
import { ENTRY_REFERENCE_PATTERN, partNumberSchema } from "./parts";
import { FIX_TIME_UNITS, difficultySchema } from "./problems";
import { quantitySchema } from "./reference";
import {
  requiresSafetyFlagFromSubject,
  systemIsSafetyCritical,
} from "../lib/safety";
import { findInlinedFigure } from "../lib/procedures/figures";

/* -------------------------------------------------------------------------
 * Vocabularies and the corpus rules
 *
 * Declared in `src/lib/procedures/index.ts` and re-exported here, which is
 * where the T502a seam put them and where every consumer imports them from.
 * The declaration lives in the lib for the reason `src/lib/parts/part-numbers.ts`
 * exists: that module sits on an `astro:build:start` hook's import chain, which
 * Node's own ESM resolver walks, and this module's imports are extensionless.
 * One declaration, wrapped — never two.
 * ---------------------------------------------------------------------- */

export {
  PROCEDURE_ISSUE_CODES,
  PROCEDURE_SPEC_KINDS,
  ProceduresResolutionError,
  assertProceduresResolve,
  findProcedureIssues,
  readPartIds,
  readProcedures,
  readReferenceKinds,
} from "../lib/procedures/index";

export type {
  ProcedureCorpus,
  ProcedureIdentity,
  ProcedureIssue,
  ProcedureIssueCode,
  ProcedureSpecKind,
} from "../lib/procedures/index";

/* -------------------------------------------------------------------------
 * Ids
 * ---------------------------------------------------------------------- */

/**
 * The shape of every id this collection writes or points at — a step, tool or
 * prerequisite handle, and a reference into `reference`, `parts` or
 * `procedures`.
 *
 * `ENTRY_REFERENCE_PATTERN` rather than a fourth copy of the same regex: the
 * reasoning `src/schemas/parts.ts` records for `supersededBy` is this
 * collection's reasoning too, and it is the one check that catches the mistake
 * an author is actually going to make — writing a **catalogue number** where an
 * entry id belongs. `TEST-P0001` is uppercase and this pattern is not, so the
 * two cannot be confused silently. Whether the id names a real entry is the
 * build's question (`src/lib/procedures/index.ts`), exactly as a fitment id is
 * FIT-02's.
 */
export { ENTRY_REFERENCE_PATTERN } from "./parts";

const idSchema = (label: string, target: string) =>
  z.string().regex(ENTRY_REFERENCE_PATTERN, {
    message:
      `not a ${label} id: ids are lowercase ASCII letters and digits joined ` +
      `by single hyphens (\`drain-the-oil\`, \`g3-torque-oil-drain-plug\`), ` +
      `because ${target}. A catalogue number or a part number here would be a ` +
      `pointer nothing can resolve. refs specs/001-foundation (PRC-01)`,
  });

/** A handle for one row *within* this entry, joined to its prose by the id. */
const localIdSchema = (label: string) =>
  idSchema(
    label,
    `an id is the join key between shared data and both prose locales and ` +
      `\`Drain\` / \`drain\` must not become two keys for one ${label}`
  );

/* -------------------------------------------------------------------------
 * The rows
 * ---------------------------------------------------------------------- */

/**
 * One ordered step. The sentence lives in `prose.<locale>.steps[id]`; what is
 * here is the structure — which of the entry's declared specs and consumed
 * parts *this* step is about, so the page can render the figure and the part
 * number beside the instruction without either locale re-typing them.
 *
 * Both id lists are scoped to what the **entry** declares
 * ({@link checkStepReferences}): a step that cites a spec the entry never
 * listed renders as an empty row rather than as an error, which is the failure
 * mode a schema can see and should.
 */
export const procedureStepSchema = z
  .object({
    id: localIdSchema("step"),
    /** `reference` entry ids, each one also listed in the entry's `specs`. */
    specs: z.array(localIdSchema("spec")).default([]),
    /** `parts` entry ids, each one also listed in `partsConsumed`. */
    parts: z.array(localIdSchema("part")).default([]),
  })
  .strict();

/**
 * One tool. PRC-01 asks for "tools (flagging special/SST tools)", and both
 * halves are here: `special` is the flag, and `sstNumber` is the Mitsubishi
 * special service tool number when one exists.
 *
 * A tool's **name** is language and lives in `prose.<locale>.tools[id]`; its
 * SST number is not, and never appears per-locale.
 *
 * The one contradiction a shape can see is refused below: an SST number on a
 * tool that is not flagged special. A Mitsubishi SST *is* the "special tool"
 * PRC-01 wants flagged, so an entry that records the number and leaves the flag
 * off renders as an ordinary socket — and the reader finds out they cannot do
 * the job when the truck is already apart. The flag is the requirement; the
 * number is evidence for it. The converse is legal and common: a slide hammer
 * is a special tool nobody has a Mitsubishi number for.
 */
export const procedureToolSchema = z
  .object({
    id: localIdSchema("tool"),
    special: z.boolean().optional(),
    /** `MB990767`. A catalogue token, so it is `parts`' own number shape. */
    sstNumber: partNumberSchema().optional(),
  })
  .strict()
  .superRefine((tool, ctx) => {
    if (tool.sstNumber === undefined || tool.special === true) return;
    ctx.addIssue({
      code: "custom",
      path: ["special"],
      message:
        `\`${tool.sstNumber}\` is a Mitsubishi special service tool number, ` +
        `and this tool is not flagged \`special: true\` — so the page renders ` +
        `it as an ordinary hand tool and a reader finds out they cannot do ` +
        `the job with the truck already apart. PRC-01 asks for tools *with ` +
        `special/SST tools flagged*: the flag is the requirement and the ` +
        `number is the evidence for it. refs specs/001-foundation (PRC-01)`,
    });
  });

/**
 * One prerequisite — **either** a plain condition or another job on this site,
 * through one shape.
 *
 * "Engine cold. Truck level, on its jack stands." is a real prerequisite and is
 * not a `procedures` entry, so a shape that assumed it was would force authors
 * to invent entries for sentences. `procedure` is therefore optional: present,
 * it is a typed reference the build resolves and the page links; absent, the
 * sentence in `prose.<locale>.prerequisites[id]` is the whole row.
 */
export const procedurePrerequisiteSchema = z
  .object({
    id: localIdSchema("prerequisite"),
    /** The `procedures` entry a reader does first, when there is one. */
    procedure: idSchema(
      "procedure",
      `a prerequisite that names another job names it by entry id, so the ` +
        `build can resolve it and the page can link to it`
    ).optional(),
  })
  .strict();

/**
 * One part the job consumes — a gasket, a filter, six spark plugs.
 *
 * `part` is a `parts` entry id, never a re-spelled number: AGENTS.md calls a
 * wrong part number "the highest-consequence hallucination in this domain", and
 * a typed reference is the version a reader can open and check the supersession
 * chain on before ordering (PRT-02).
 *
 * `quantity` is optional, for the reason `parts`' own `quantityPerVehicle` is:
 * "how many" is often not what a catalogue states, and a guessed count is an
 * invented fact. When it is stated it is a numeric leaf of shared data, so
 * `check:citations` requires the source (REF-02).
 */
export const procedurePartConsumedSchema = z
  .object({
    part: idSchema(
      "part",
      `a consumed part is a typed reference into the parts collection rather ` +
        `than a re-spelled number`
    ),
    quantity: z.number().int().positive().optional(),
  })
  .strict();

/* -------------------------------------------------------------------------
 * The entry shape
 * ---------------------------------------------------------------------- */

/**
 * Locale-independent data for one job. Nothing here is translated.
 *
 * **Declaration order is load-bearing for exactly one reason**, and it is worth
 * saying out loud: `scripts/check-citations.mjs` walks the numeric leaves of
 * shared data in key order, and its message quotes the first offending field.
 * `difficulty` before `time` keeps the most-read figure first in that report.
 * Nothing else depends on the order.
 */
export const proceduresShared = {
  /**
   * Which system the job belongs to, from the glossary's vocabulary — one
   * vocabulary for the breadcrumb, the listing filter, and `src/lib/safety.ts`'
   * safety-critical decision, exactly as `reference`, `parts` and `problems`
   * use it.
   */
  system: glossarySystemSchema,
  /**
   * Promotes a job the system list does not catch — SRS/airbags, towing,
   * jacking and lifting points (AGENTS.md's safety-critical categories with no
   * system id of their own). Upward only; see {@link checkSafetyFlag}.
   */
  safetyCritical: z.boolean().optional(),
  /** PRC-01's "difficulty 1–5" — PRB-01's scale, shared, never a second one. */
  difficulty: difficultySchema,
  /** PRC-01's "time estimate": minutes or hours, as a real quantity. */
  time: quantitySchema(FIX_TIME_UNITS),
  /** PRC-01's "prerequisites". Empty is the common case. */
  prerequisites: z.array(procedurePrerequisiteSchema).default([]),
  /** PRC-01's "tools (flagging special/SST tools)". A job may need none. */
  tools: z.array(procedureToolSchema).default([]),
  /** PRC-01's "parts consumed". A diagnostic job consumes nothing. */
  partsConsumed: z.array(procedurePartConsumedSchema).default([]),
  /**
   * PRC-03's mechanism, and the **only** place a procedure states a figure:
   * `reference` entry ids, each naming a row that carries the number and its
   * own sources. A fluid top-up with no torque figure legitimately states none,
   * so the list may be empty.
   */
  specs: z
    .array(
      idSchema(
        "spec",
        `PRC-03 says a value comes from shared reference data **by ID**`
      )
    )
    .default([]),
  /**
   * PRC-01's "step-by-step", in order. At least one: a procedure that does not
   * say what to do is not a procedure, it is a title — the same reasoning
   * `problems` records for "at least one symptom".
   */
  steps: z.array(procedureStepSchema).min(1, {
    message:
      "a procedure states at least one step — an entry that says what a job " +
      "is called and never what to do is a title (PRC-01). " +
      "refs specs/001-foundation",
  }),
};

/**
 * Per-locale text.
 *
 * `title` and `summary` restate the base prose shape in `src/content.config.ts`
 * rather than importing it, for the reason `src/schemas/parts.ts` records:
 * `content.config.ts` imports *this* module to register the collection, so
 * reaching back the other way is a cycle.
 *
 * Nothing numeric may appear here — `defineEntrySchema` throws at define time
 * if it does. A torque, a capacity, an interval or a time is a fact stored
 * twice (AGENTS.md).
 */
export const proceduresProse = {
  title: z.string(),
  summary: z.string(),
  /**
   * `stepId → "Drain the oil into a pan."` — PRC-01's "step-by-step prose in
   * both locales". What to *do*; which figure the step is about is `specs` in
   * shared data, rendered from the one stored copy.
   */
  steps: z.record(z.string(), z.string()).default({}),
  /**
   * `toolId → "17 mm socket"`. A tool's name is language; its SST number is
   * not, and lives in shared data.
   */
  tools: z.record(z.string(), z.string()).default({}),
  /** `prerequisiteId → "Engine cold, truck level on its stands."` */
  prerequisites: z.record(z.string(), z.string()).default({}),
  /**
   * PRC-01's ninth field: *this job's* hazards, in this locale's words — not
   * the standing notice, which is one sentence the whole site shares and is
   * rendered by `SafetyNotice.astro` from the UI-strings module.
   *
   * Optional in shape and required in fact for a safety-critical entry; see
   * {@link checkSafetyNotes} for the derivation.
   */
  safetyNotes: z.string().optional(),
};

/**
 * The two halves of the entry shape.
 *
 * A function rather than two exported objects because that is the seam T502a
 * declared, and because it lets a grader probe the numeric-prose guard at
 * **define** time — `defineEntrySchema(shared, { ...prose, torqueNm: z.number() })`
 * must throw — the way `src/schemas/parts.test.ts` does for
 * `quantityPerVehicle`.
 */
export function procedureShapes(): {
  readonly shared: z.ZodRawShape;
  readonly prose: z.ZodRawShape;
} {
  return { shared: proceduresShared, prose: proceduresProse };
}

/* -------------------------------------------------------------------------
 * Per-entry rules
 *
 * Everything here is a contradiction visible from *inside one entry* — the
 * line `src/schemas/entry.ts`, `reference.ts` and `parts.ts` all draw for what
 * a schema refinement may enforce. Questions about other entries (does this
 * spec id name a real row? is this prerequisite loop closed?) are the build's,
 * in `src/lib/procedures/index.ts`.
 * ---------------------------------------------------------------------- */

/**
 * The slice of Zod's refinement context these rules use, declared structurally
 * (rather than importing `z.RefinementCtx`) so {@link checkProcedureEntry} can
 * be called with a plain collector from a unit test — the seam
 * `checkPartsEntry`, `checkReferenceEntry` and `checkProblemEntry` all use.
 */
export interface ProcedureRefineContext {
  addIssue(issue: {
    code: "custom";
    path: PropertyKey[];
    message: string;
  }): void;
}

interface ProcedureEntryShape {
  id?: unknown;
  system?: unknown;
  safetyCritical?: unknown;
  prerequisites?: unknown;
  tools?: unknown;
  partsConsumed?: unknown;
  specs?: unknown;
  steps?: unknown;
  prose?: unknown;
  [field: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStrings(value: unknown): string[] {
  return asArray(value).filter(
    (item): item is string => typeof item === "string"
  );
}

/** The keyed handle each row of `field` is identified by. */
const ID_KEY: Readonly<Record<string, string>> = {
  steps: "id",
  tools: "id",
  prerequisites: "id",
  partsConsumed: "part",
};

/** The ids declared by one of the entry's lists, in declaration order. */
function idsOf(entry: ProcedureEntryShape, field: string): string[] {
  if (field === "specs") return asStrings(entry.specs);
  const key = ID_KEY[field] ?? "id";
  return asArray(entry[field]).flatMap((row) => {
    const id = asRecord(row)?.[key];
    return typeof id === "string" ? [id] : [];
  });
}

/**
 * `safetyCritical` promotes; it never demotes.
 *
 * Verbatim the rule `src/schemas/reference.ts` and `parts.ts` state, because it
 * is the same rule about the same flag: an entry whose `system` is already on
 * `SAFETY_CRITICAL_SYSTEMS` cannot opt out of the standing bilingual safety
 * notice. PRC-02 gives procedures no licence to differ — a brake job is a brake
 * job whether it is filed as a part, a torque figure or a job.
 */
function checkSafetyFlag(
  entry: ProcedureEntryShape,
  ctx: ProcedureRefineContext
): void {
  if (entry.safetyCritical !== false) return;
  if (!systemIsSafetyCritical(entry.system)) return;

  ctx.addIssue({
    code: "custom",
    path: ["safetyCritical"],
    message:
      `\`${String(entry.system)}\` is a safety-critical system (AGENTS.md ` +
      `"Safety and legal"), so this procedure renders the standing bilingual ` +
      `safety notice whatever this field says. \`safetyCritical\` only ever ` +
      `promotes a job the system list does not catch — drop the field. ` +
      `refs specs/001-foundation (PRC-02)`,
  });
}

/**
 * Promotes a job whose *subject* names towing, or jacking/lifting points — two
 * of AGENTS.md's safety-critical categories with no `GLOSSARY_SYSTEMS` id of
 * their own, so `system` cannot reach them (T207 audit, F3).
 *
 * This matters more for `procedures` than for any other collection on the site:
 * "raise the truck" is an *instruction someone follows*, not a reference row
 * they read. The detector itself lives in `src/lib/safety.ts` beside
 * `isSafetyCritical`, so the rule that decides whether the notice renders is
 * one rule read from one place, whether a page or a schema is asking.
 */
function checkSafetySubject(
  entry: ProcedureEntryShape,
  ctx: ProcedureRefineContext
): void {
  if (entry.safetyCritical === true) return;
  if (systemIsSafetyCritical(entry.system)) return;
  if (!requiresSafetyFlagFromSubject(entry)) return;

  ctx.addIssue({
    code: "custom",
    path: ["safetyCritical"],
    message:
      `this procedure's subject names towing, or jacking/lifting points — ` +
      `AGENTS.md safety-critical categories with no \`system\` id of their ` +
      `own — so it must set \`safetyCritical: true\` to render the standing ` +
      `bilingual safety notice (PRC-02). "Raise the truck" is an instruction ` +
      `somebody follows, which is why this rule bites hardest here. ` +
      `refs specs/001-foundation (PRC-02)`,
  });
}

/**
 * A safety-critical procedure writes its own safety notes, in both locales.
 *
 * The derivation, stated so a reviewer can argue with exactly this: PRC-01
 * lists "safety notes" as a field the collection holds, and PRC-02 says a
 * safety-critical job renders the standing notice. Neither sentence alone makes
 * the *entry-specific* note mandatory. Read together they do: the standing
 * notice is the same sentence on a brake bleed and on a fuel-line replacement,
 * so if a safety-critical procedure may ship with no note of its own, PRC-01's
 * "safety notes" is a field that never has to be filled in on precisely the
 * entries it exists for.
 *
 * The locale list comes from the entry's own `prose` rather than from `LOCALES`
 * so this rule reports "the note is missing" and never re-reports "the locale
 * is missing" — `defineEntrySchema` already owns that, and one mistake should
 * produce one error.
 */
function checkSafetyNotes(
  entry: ProcedureEntryShape,
  ctx: ProcedureRefineContext
): void {
  const safetyCritical =
    entry.safetyCritical === true || systemIsSafetyCritical(entry.system);
  if (!safetyCritical) return;

  const prose = asRecord(entry.prose);
  if (prose === null) return;

  for (const [locale, block] of Object.entries(prose)) {
    const localeProse = asRecord(block);
    if (localeProse === null) continue;

    const note = localeProse["safetyNotes"];
    if (typeof note === "string" && note.trim().length > 0) continue;

    ctx.addIssue({
      code: "custom",
      path: ["prose", locale, "safetyNotes"],
      message:
        `this procedure is safety-critical, so it states its own hazards in ` +
        `\`${locale}\` (PRC-01's "safety notes"). The standing notice every ` +
        `safety-critical page shows is the *same* sentence site-wide — it ` +
        `says to see a qualified mechanic, not what will hurt you on this ` +
        `job. Both locales, always (I18N-06). ` +
        `refs specs/001-foundation (PRC-01, PRC-02)`,
    });
  }
}

/**
 * No list repeats an id.
 *
 * Swept over **every** id list, not the ones that occurred to an author: two
 * `steps`, `tools` or `prerequisites` rows sharing a handle share one sentence
 * and one of them is wrong, and a repeat in `specs` or `partsConsumed` renders
 * the same torque row, or the same part, twice on the page. T401's own record
 * names this defect class shipping once already — "`checkDuplicateIds` sweeps
 * the four top-level lists only, never the id lists *inside* a step" — so the
 * nested lists are swept here too rather than left as a known gap.
 */
function checkDuplicateIds(
  entry: ProcedureEntryShape,
  ctx: ProcedureRefineContext
): void {
  for (const field of ["steps", "tools", "prerequisites", "partsConsumed"]) {
    const key = ID_KEY[field] as string;
    const seen = new Map<string, number>();

    asArray(entry[field]).forEach((row, index) => {
      const id = asRecord(row)?.[key];
      if (typeof id !== "string") return;
      const first = seen.get(id);
      if (first === undefined) {
        seen.set(id, index);
        return;
      }
      ctx.addIssue({
        code: "custom",
        path: [field, index, key],
        message:
          `\`${id}\` is already declared at index ${first} of \`${field}\`. ` +
          `An id is a key — it joins this row to its sentence in both prose ` +
          `locales, and the page renders one row per key — so two rows cannot ` +
          `share one. refs specs/001-foundation (PRC-01)`,
      });
    });
  }

  checkDuplicateStrings(asStrings(entry.specs), ["specs"], "specs", ctx);

  asArray(entry.steps).forEach((row, index) => {
    const step = asRecord(row);
    if (step === null) return;
    for (const field of ["specs", "parts"]) {
      checkDuplicateStrings(
        asStrings(step[field]),
        ["steps", index, field],
        `this step's \`${field}\``,
        ctx
      );
    }
  });
}

/** The id-is-a-key rule for a list of bare id strings. */
function checkDuplicateStrings(
  ids: readonly string[],
  path: PropertyKey[],
  label: string,
  ctx: ProcedureRefineContext
): void {
  const seen = new Map<string, number>();
  ids.forEach((id, index) => {
    const first = seen.get(id);
    if (first === undefined) {
      seen.set(id, index);
      return;
    }
    ctx.addIssue({
      code: "custom",
      path: [...path, index],
      message:
        `\`${id}\` is already listed at index ${first} of ${label}. The ` +
        `second mention makes no second claim, and the page would render the ` +
        `same row twice. refs specs/001-foundation (PRC-01)`,
    });
  });
}

/**
 * A step points only at what its own entry declares.
 *
 * The intra-entry half of PRC-03's by-ID rule. Whether the id resolves to a
 * real `reference` or `parts` entry is the build's question; whether *this
 * entry* declared it is visible from inside the entry, and it is the mistake
 * that renders as an empty row rather than as an error. Same shape as
 * `problems`' rule that a fix path may only address causes the entry declares.
 */
function checkStepReferences(
  entry: ProcedureEntryShape,
  ctx: ProcedureRefineContext
): void {
  const declared: Record<string, Set<string>> = {
    specs: new Set(idsOf(entry, "specs")),
    parts: new Set(idsOf(entry, "partsConsumed")),
  };
  const source: Record<string, string> = {
    specs: "`specs`",
    parts: "`partsConsumed`",
  };

  asArray(entry.steps).forEach((row, index) => {
    const step = asRecord(row);
    if (step === null) return;

    for (const field of ["specs", "parts"] as const) {
      asStrings(step[field]).forEach((id, position) => {
        const known = declared[field] as Set<string>;
        if (known.has(id)) return;
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, field, position],
          message:
            `this step names \`${id}\`, which the entry's ${source[field]} ` +
            `does not declare — ` +
            (known.size === 0
              ? `it declares none at all`
              : `it declares ${[...known].map((each) => `\`${each}\``).join(", ")}`) +
            `. A step renders the rows its entry lists, so an undeclared id ` +
            `renders as nothing at all. Add it to ${source[field]}, or fix ` +
            `the typo. refs specs/001-foundation (PRC-01, PRC-03)`,
        });
      });
    }
  });
}

/**
 * A job is not its own prerequisite.
 *
 * The general case — a loop of any length — is the build's, because it needs
 * every entry. This is the one-node case, which is visible here and is by far
 * the likeliest way it happens (an author copies the entry's own id into the
 * field).
 */
function checkSelfPrerequisite(
  entry: ProcedureEntryShape,
  ctx: ProcedureRefineContext
): void {
  const { id } = entry;
  if (typeof id !== "string") return;

  asArray(entry.prerequisites).forEach((row, index) => {
    if (asRecord(row)?.["procedure"] !== id) return;
    ctx.addIssue({
      code: "custom",
      path: ["prerequisites", index, "procedure"],
      message:
        `\`${id}\` cannot be a prerequisite of itself: a prerequisite is a ` +
        `job you do *first*, and a reader told to do this job before doing ` +
        `this job cannot start. Name the other procedure, or state the ` +
        `prerequisite as a plain condition and drop the \`procedure\` field. ` +
        `refs specs/001-foundation (PRC-01)`,
    });
  });
}

/**
 * Every id declared in shared data has a sentence in **both** locales, and
 * neither locale carries a sentence for an id that does not exist.
 *
 * I18N-06 one level down, exactly as `problems` states it: "both or neither"
 * applies to a step as much as to a summary, and an entry whose Spanish version
 * silently listed four steps where the English listed five would pass every
 * other gate in the repo. The extra-key half matters just as much — a sentence
 * with no id is text that renders nowhere, in one language, and the author's
 * real intent (a step they meant to declare) is lost silently.
 */
function checkProseCoverage(
  entry: ProcedureEntryShape,
  ctx: ProcedureRefineContext
): void {
  const prose = asRecord(entry.prose);
  if (prose === null) return;

  const declared: Record<string, string[]> = {
    steps: idsOf(entry, "steps"),
    tools: idsOf(entry, "tools"),
    prerequisites: idsOf(entry, "prerequisites"),
  };

  for (const [locale, block] of Object.entries(prose)) {
    const localeProse = asRecord(block);
    if (localeProse === null) continue;

    for (const [field, ids] of Object.entries(declared)) {
      const sentences = asRecord(localeProse[field]) ?? {};

      for (const id of ids) {
        if (Object.hasOwn(sentences, id)) continue;
        ctx.addIssue({
          code: "custom",
          path: ["prose", locale, field, id],
          message:
            `\`${field}\` declares \`${id}\` but \`prose.${locale}.${field}\` ` +
            `has no sentence for it. Both locales or neither — a job whose ` +
            `steps exist in one language is a job half this site's readers ` +
            `cannot do (I18N-06). refs specs/001-foundation (PRC-01, I18N-06)`,
        });
      }

      const known = new Set(ids);
      for (const id of Object.keys(sentences)) {
        if (known.has(id)) continue;
        ctx.addIssue({
          code: "custom",
          path: ["prose", locale, field, id],
          message:
            `\`prose.${locale}.${field}\` has a sentence for \`${id}\`, which ` +
            `\`${field}\` does not declare — so it renders nowhere. Either ` +
            `add \`${id}\` to \`${field}\` (and write the other locale) or ` +
            `remove the sentence. refs specs/001-foundation (PRC-01)`,
        });
      }
    }
  }
}

/**
 * No sentence states a figure PRC-03 says belongs in a `reference` entry.
 *
 * Scoped to the two fields that tell a reader what to *do* and what will *hurt
 * them* — steps and safety notes. Tool and prerequisite names are deliberately
 * out of scope: "torque wrench, 20–200 N·m" is the tool's identity, not a
 * figure this job sets, and flagging it would be the false positive that gets
 * a real rule deleted. See `src/lib/procedures/figures.ts` for the category,
 * the engine-code carve-out and the stated `mm` gap.
 */
function checkInlinedFigures(
  entry: ProcedureEntryShape,
  ctx: ProcedureRefineContext
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
        `this sentence states the figure \`${figure}\` itself. PRC-03 says a ` +
        `torque, fluid or capacity value comes from shared reference data ` +
        `**by ID** — written into a sentence it exists once in \`en\`, once ` +
        `in \`es\` and nowhere a build can compare them, so the day the ` +
        `factory figure is corrected one language keeps the old one. Cite the ` +
        `\`reference\` entry in \`specs\` and let the page render the number ` +
        `from the one stored copy. (A count — "the three bolts", "two ` +
        `stages" — and a fluid's designation — \`SAE 75W-90\` — are not ` +
        `figures this rule is about.) refs specs/001-foundation (PRC-03)`,
    });
  };

  for (const [locale, block] of Object.entries(prose)) {
    const localeProse = asRecord(block);
    if (localeProse === null) continue;

    const steps = asRecord(localeProse["steps"]) ?? {};
    for (const [id, text] of Object.entries(steps)) {
      if (typeof text !== "string") continue;
      report(["prose", locale, "steps", id], text);
    }

    const notes = localeProse["safetyNotes"];
    if (typeof notes === "string") {
      report(["prose", locale, "safetyNotes"], notes);
    }
  }
}

/**
 * Every procedures rule, applied to an entry that already satisfies the base
 * entry shape. Exported so the rules can be unit-tested — and read — without
 * reconstructing the whole collection schema.
 */
export function checkProcedureEntry(
  entry: unknown,
  ctx: ProcedureRefineContext
): void {
  const candidate = asRecord(entry);
  if (candidate === null) return;

  checkSafetyFlag(candidate, ctx);
  checkSafetySubject(candidate, ctx);
  checkSafetyNotes(candidate, ctx);
  checkDuplicateIds(candidate, ctx);
  checkStepReferences(candidate, ctx);
  checkSelfPrerequisite(candidate, ctx);
  checkProseCoverage(candidate, ctx);
  checkInlinedFigures(candidate, ctx);
}

/**
 * The `procedures` collection schema: the base entry envelope (id, fitment,
 * confidence, sources, both prose locales) plus the shapes and rules above.
 */
export const proceduresSchema = defineEntrySchema(
  proceduresShared,
  proceduresProse
).superRefine((entry, ctx) => {
  checkProcedureEntry(entry, ctx);
});

export type ProcedureEntryData = z.infer<typeof proceduresSchema>;
