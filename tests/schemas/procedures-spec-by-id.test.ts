/**
 * Graders — torque and fluid specs come from shared reference data **by id**
 * (PRC-03).
 *
 * > **PRC-03** IF a procedure cites a torque or fluid spec, THEN THE value
 * > SHALL come from shared reference data by ID, never inlined per-locale.
 *
 * One requirement, four ways to break it, and they fail at four different
 * moments — which is why this file is four blocks rather than one:
 *
 *  1. **Define time.** A figure declared in the *prose shape* means every
 *     content file stores the number twice, once per locale, forever.
 *     `defineEntrySchema` throws before any content is parsed. This is the
 *     T207/T501 numeric-prose guard, probed here with this collection's own
 *     figures — the same probe `src/schemas/parts.test.ts` runs by moving
 *     `quantityPerVehicle` into `partsProse`.
 *  2. **Parse time, prose side.** A figure smuggled into an entry file's
 *     `prose` is an unrecognised key, named with its locale path (SCF-04),
 *     never silently stripped.
 *  3. **Parse time, shared side.** A torque or fluid *value* inlined into the
 *     procedure's own shared data is the subtler half of "never inlined": it
 *     does not duplicate across locales, so the guard above never sees it, and
 *     it still means the figure now lives in two places (here, and in the
 *     `reference` entry it should have pointed at) with no mechanism keeping
 *     them equal. PRC-03 says the value comes from reference data **by ID**;
 *     an id is the only shape that has one copy.
 *  4. **Parse time, prose text.** The figure written into a *sentence* —
 *     "apriete a 88 N·m". This is the violation an author actually commits,
 *     it is per-locale by construction, and no type-level guard can see it
 *     because it is a string. See that block's own header for the scope and
 *     the false-positive budget.
 *
 * And then the corpus half: an id is only worth anything if the build resolves
 * it. That is `findProcedureIssues`, the mirror of `findPartIssues`.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker; T502 activates a grader by deleting exactly that
 * `.fails`. The canary (`procedures-seam-contract.test.ts`) proves today's
 * failures are the missing schema and the seam's throws.
 *
 * refs specs/001-foundation (PRC-01, PRC-03, REF-01, SCF-04)
 */
import { describe, expect, it } from "vitest";
import { z } from "astro/zod";

import { defineEntrySchema } from "../../src/schemas/entry.ts";
import {
  PROCEDURE_SPEC_KINDS,
  findProcedureIssues,
  procedureShapes,
  type ProcedureIssue,
} from "../../src/schemas/procedures.ts";
import { REFERENCE_KINDS } from "../../src/schemas/reference.ts";
import {
  issuesUnder,
  parseProcedure,
  procedureIssuePaths,
} from "../helpers/procedures.ts";
import { unrecognizedKeys } from "../helpers/schema-outcome.ts";
import {
  makeCorpusFor,
  makeProcedure,
  makeReference,
} from "../fixtures/procedure-fixtures.ts";

/** `reference` kinds a procedure may **not** cite as a spec. */
const NON_SPEC_KINDS = REFERENCE_KINDS.filter(
  (kind) => !(PROCEDURE_SPEC_KINDS as readonly string[]).includes(kind)
);

function issueCodes(issues: readonly ProcedureIssue[]): string[] {
  return issues.map((issue) => issue.code).sort();
}

/** Shared-data fields the `procedures` schema owns, per PRC-01. */
const OWNED_SHARED_FIELDS = [
  "system",
  "difficulty",
  "time",
  "steps",
  "specs",
  "tools",
  "prerequisites",
  "partsConsumed",
];

/** Per-locale fields the `procedures` schema owns. */
const OWNED_PROSE_FIELDS = [
  "title",
  "summary",
  "steps",
  "tools",
  "prerequisites",
];

/**
 * `field` is rejected as unrecognised **and the fields the schema owns are
 * not** — the second half is what stops the assertion passing vacuously.
 *
 * Today the registered `procedures` collection is the placeholder shape, so
 * *every* field of a procedure entry comes back unrecognised and a bare
 * `toContain(field)` is satisfied by a schema that knows nothing at all. That
 * is not a rejection of the inlined figure; it is a rejection of the whole
 * collection. Found by running the first draft of this file, which `it.fails`
 * duly reported as an unexpected pass.
 */
function expectOnlyThisIsUnrecognised(
  entry: Record<string, unknown>,
  field: string,
  owned: readonly string[]
): void {
  const keys = unrecognizedKeys(parseProcedure(entry));

  expect(keys, `\`${field}\` was accepted into the entry`).toContain(field);
  for (const ownedField of owned) {
    expect(
      keys,
      `\`${ownedField}\` is a field this collection owns, not an unknown key`
    ).not.toContain(ownedField);
  }
}

/* -------------------------------------------------------------------------
 * 1. Define time — the numeric-prose guard, probed with this collection
 * ---------------------------------------------------------------------- */

describe("no figure may be declared in the prose shape (PRC-03, define time)", () => {
  /*
   * Each row is a figure a procedures author would plausibly reach for, in a
   * shape the guard has to see through. A guard that unwraps one level is not
   * a guard: `specs: z.object({ torqueNm: z.number() })` duplicates a figure
   * per locale exactly like a top-level one.
   */
  it.each<[string, string, z.ZodType]>([
    ["a torque figure", "torqueNm", z.number()],
    ["an optional torque figure", "torqueNm", z.number().optional()],
    ["a capacity", "capacityLitres", z.number()],
    ["a difficulty", "difficultyRating", z.number()],
    ["a time estimate", "minutes", z.number()],
    ["a torque sequence", "torqueSequenceNm", z.array(z.number())],
    [
      "a figure nested one level down",
      "torqueSpec",
      z.object({ nm: z.number() }),
    ],
    [
      "a figure inside a per-step record",
      "stepTorques",
      z.record(z.string(), z.number()),
    ],
  ])("refuses %s in prose, naming the field", (_label, field, schema) => {
    const { shared, prose } = procedureShapes();

    expect(() =>
      defineEntrySchema(shared, { ...prose, [field]: schema })
    ).toThrow(new RegExp(field));
  });

  it("builds cleanly with the prose shape as it actually ships", () => {
    // The positive control. Without it, "the guard throws" is satisfied by a
    // guard that throws on everything.
    const { shared, prose } = procedureShapes();

    expect(() => defineEntrySchema(shared, prose)).not.toThrow();
  });

  it("keeps PRC-01's figures in shared data, where they belong", () => {
    const { shared, prose } = procedureShapes();

    // `difficulty` and `time` are numbers. In shared data they are walked by
    // `scripts/check-citations.mjs`; in prose they would be invisible to it
    // *and* stored twice. This is the same reasoning `parts` records for
    // `quantityPerVehicle`.
    expect(Object.keys(shared)).toEqual(
      expect.arrayContaining(["difficulty", "time"])
    );
    expect(Object.keys(prose)).not.toContain("difficulty");
    expect(Object.keys(prose)).not.toContain("time");
  });

  it("keeps the human half in prose, where a translator can reach it", () => {
    const { shared, prose } = procedureShapes();

    expect(Object.keys(prose)).toEqual(
      expect.arrayContaining(["steps", "tools", "prerequisites"])
    );
    // The mirror-image mistake: an English sentence in shared data is a page
    // that ships in one language.
    expect(Object.keys(shared)).not.toContain("safetyNotes");
  });
});

/* -------------------------------------------------------------------------
 * 2. Parse time, prose side
 * ---------------------------------------------------------------------- */

describe("a figure smuggled into an entry's prose is named (PRC-03, SCF-04)", () => {
  it.each<[string, unknown]>([
    ["torqueNm", 88],
    ["capacityLitres", 4.5],
    ["minutes", 45],
  ])("names `%s` written into an entry's prose", (field, value) => {
    const entry = makeProcedure({ extraProse: { [field]: value } });

    expectOnlyThisIsUnrecognised(entry, field, OWNED_PROSE_FIELDS);
    // Reported with its locale path, not just its key (SCF-04): an author
    // needs to know which of the two files to open.
    for (const locale of ["en", "es"]) {
      expect(issuesUnder(entry, `prose.${locale}`).length).toBeGreaterThan(0);
    }
  });

  it("accepts the same entry once the figure is gone", () => {
    expect(procedureIssuePaths(makeProcedure())).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 3. Parse time, shared side — "by ID" means there is no second copy
 * ---------------------------------------------------------------------- */

describe("a procedure states no spec of its own (PRC-03)", () => {
  /*
   * Every one of these is a field the `reference` collection already owns, on
   * an entry whose kind is built to carry it and whose `sources` cite it. A
   * procedure that redeclares one is the second copy PRC-03 exists to
   * prevent — and the copy nobody updates when the FSM figure is corrected.
   */
  it.each<[string, unknown]>([
    ["torque", { value: 88, unit: "nm" }],
    ["torqueNm", 88],
    ["stages", [{ torque: { value: 50, unit: "nm" } }]],
    ["capacity", { value: 4.5, unit: "l" }],
    ["specification", "API GL-5 SAE 75W-90"],
    ["serviceInterval", { km: 10000 }],
    ["fluid", { specification: "TEST", capacity: { value: 1, unit: "l" } }],
  ])("refuses an inlined `%s` in its own shared data", (field, value) => {
    expectOnlyThisIsUnrecognised(
      makeProcedure({ extraShared: { [field]: value } }),
      field,
      OWNED_SHARED_FIELDS
    );
  });

  it("accepts the reference entry id instead", () => {
    // The positive control, and the shape PRC-03 actually asks for: one id,
    // one copy of the number, in the entry that cites it.
    expect(
      procedureIssuePaths(
        makeProcedure({
          specs: ["test-ref-torque", "test-ref-fluid"],
          steps: [
            { id: "test-step-fill", specs: ["test-ref-fluid"] },
            { id: "test-step-torque", specs: ["test-ref-torque"] },
          ],
        })
      )
    ).toEqual([]);
  });

  it("rejects a catalogue token written where a spec id belongs", () => {
    /*
     * The mistake an author makes: pasting the *number* instead of naming the
     * entry that holds it. An entry id is lowercase kebab-case and a catalogue
     * token is uppercase, so the two cannot be confused silently — the rule,
     * and the reason for it, that `parts`' `supersededBy` already states.
     *
     * Deliberately **not** graded as "a bare number is rejected": `88` is a
     * legal kebab-case id by shape, and a rule that special-cased all-digit
     * strings would be a second, weaker id vocabulary. That the id names
     * nothing is the build's answer (`unknown-spec`), and it is the right one.
     */
    const issues = issuesUnder(
      makeProcedure({ specs: ["TEST-REF-0001"] }),
      "specs"
    );

    expect(issues.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------
 * 4. Parse time, prose text — the figure written into a sentence
 *
 * ## Why this block exists, and what it is scoped to
 *
 * This is the violation PRC-03 is actually about. "Apriete los pernos a 88
 * N·m" *is* an inlined per-locale value: the number now exists once in `en`,
 * once in `es`, and nowhere a build can compare them — so the day the FSM
 * figure is corrected, one language gets the fix. No type-level guard sees
 * it, because it is a string, and `check:citations` does not either, because
 * it walks numeric *leaves* and this is text.
 *
 * **The rule is a category, not a spelling list.** *A digit bound to a torque
 * or volume unit*, in any spelling of that unit, in step or safety-note prose.
 * The reject table below is evidence for the category and is **not
 * exhaustive** — `N·m`, `N.m`, `Nm`, `N m`, `lb-ft`, `ft-lb`, `ft lbs`,
 * `ft·lb`, `kgf·m`, `L`, `litros`, `qt`, `ml` are all one unit family wearing
 * different punctuation, and a detector written to match the eight strings
 * that occurred to a grader author is a detector with a bypass per spelling
 * (`.claude/GRADER-PRINCIPLES.md`, "grade behavior, not name lists"; T502a
 * review, F8). Expect to find a spelling this table misses; add it here and
 * widen the pattern, do not narrow the rule to the table.
 *
 * **What is deliberately outside the category.** Not every number — a step
 * legitimately says "remove the three bolts", "torque in two stages",
 * "1982–1991". Not a standard's designation: `SAE 75W-90`, `10W-30` and `API
 * GL-5` are the fluid's *name*, identical in both languages, and
 * `reference`'s `fluid.specification` already stores them as shared data. And
 * not a **displacement used as a component's name** — "the 3.5 L 6G74" — which
 * AGENTS.md carves out in as many words: "count descriptors that are part of a
 * component's NAME … are naming, not specs". The project's own truck is
 * described as a 3.5 L 6G74 and T504's wave-1 set is led by "timing belt
 * 6G74", so this is not a hypothetical; a litre figure bound to an engine code
 * is naming and must pass (T502a review, F3).
 *
 * **That carve-out is token-scoped, and the reject table pins it.** The engine
 * code excuses the figure it is attached to, never every figure in the same
 * sentence — "Torque the crank bolt to 185 N·m on the 6G74" states a spec and
 * must still be rejected. A sentence-scoped implementation would satisfy every
 * accept row and let that through, which is why three reject rows below pair
 * an engine code with a real figure (T502a review round 2).
 *
 * **Millimetres are deliberately not in the category, and that is a stated
 * gap.** A socket size, a drill bit and a valve clearance are all written
 * `14 mm`, and no regex separates the tool from the specification. The
 * clearance case is closed the other way instead — `dimension` is citable by
 * id (`PROCEDURE_SPEC_KINDS`), so an author *has* a correct move — and the
 * remaining risk is carried by review, not by this heuristic. If a future
 * round finds a way to tell the two apart, the rule can widen; until then a
 * detector that flagged every `mm` would flag the socket-size sentence in the
 * accept table below, which is how a real rule gets deleted in frustration.
 *
 * The positive controls below are that budget, written down. If the
 * implementer finds a real sentence this rejects wrongly, the fix is to
 * narrow the detector and add the sentence here — not to delete the rule.
 * ---------------------------------------------------------------------- */

describe("a figure written into a sentence is still an inlined value (PRC-03)", () => {
  function withStepText(locale: "en" | "es", text: string) {
    return makeProcedure({
      steps: [{ id: "test-step-torque", specs: ["test-ref-torque"] }],
      specs: ["test-ref-torque"],
      stepProse: { [locale]: { "test-step-torque": text } },
    });
  }

  it.each<[string, "en" | "es", string]>([
    ["N·m", "en", "Torque the bolts to 88 N·m in sequence."],
    ["N.m, full stop", "en", "Torque the bolts to 88 N.m in sequence."],
    ["N m, plain space", "en", "Torque the bolts to 88 N m in sequence."],
    ["Nm, no separator", "en", "Torque the bolts to 88Nm in sequence."],
    ["lb-ft", "en", "Torque the bolts to 65 lb-ft in sequence."],
    ["ft-lb, reversed", "en", "Torque the bolts to 65 ft-lb in sequence."],
    [
      "ft lbs, spaced plural",
      "en",
      "Torque the bolts to 65 ft lbs in sequence.",
    ],
    ["ft·lb, middle dot", "en", "Torque the bolts to 65 ft·lb in sequence."],
    ["kgf·m", "es", "Apriete los pernos a 9 kgf·m en secuencia."],
    ["kgf-m, hyphen", "es", "Apriete los pernos a 9 kgf-m en secuencia."],
    ["N·m in ES", "es", "Apriete los pernos a 88 N·m en secuencia."],
    ["litres", "en", "Refill with 4.5 L of fluid."],
    ["litros", "es", "Rellene con 4,5 litros de aceite."],
    ["quarts", "en", "Refill with 4.8 qt of fluid."],
    ["millilitres", "en", "Add 250 ml of assembly lube to the housing."],
    /*
     * The carve-out below is **token-scoped, not sentence-scoped**, and these
     * two rows are what force that (T502a review round 2).
     *
     * An implementer reading "the distinguishing feature is the engine code
     * beside the figure" could reasonably scope it to the sentence — skip any
     * sentence mentioning `6G74`/`6G72`/`4M40`/… — and every accept row below
     * would still pass while a real torque spec walked through. And it *would*
     * walk through: "torque the crank bolt to N on the 6G74" is exactly the
     * sentence T504's wave-1 timing-belt entry will want to write.
     *
     * The rule these pin: the engine code excuses the figure **it is attached
     * to**, not every figure in its sentence.
     */
    [
      "a torque figure in an engine-code sentence",
      "en",
      "Torque the crank bolt to 185 N·m on the 6G74.",
    ],
    [
      "a torque figure in an engine-code sentence, ES",
      "es",
      "Apriete el perno del cigüeñal a 185 N·m en el 6G74.",
    ],
    [
      "a capacity in an engine-code sentence",
      "en",
      "The 6G74 takes 4.5 L of oil with the filter.",
    ],
  ])(
    "rejects a step whose %s prose states the figure itself",
    (_label, locale, text) => {
      const entry = withStepText(locale, text);

      expect(
        issuesUnder(entry, `prose.${locale}.steps`).length,
        `nothing was reported for: ${text}`
      ).toBeGreaterThan(0);
    }
  );

  it.each<[string, "en" | "es", string]>([
    ["a count", "en", "Remove the three bolts and set them aside."],
    ["a numbered count", "en", "Remove the 3 bolts and set them aside."],
    ["a stage count", "es", "Apriete en 2 etapas, en el orden indicado."],
    [
      "a fluid standard",
      "en",
      "Refill with the API GL-5 SAE 75W-90 the spec above names.",
    ],
    [
      "a fluid grade in ES",
      "es",
      "Rellene con el aceite 10W-30 que indica la especificación.",
    ],
    [
      "a pointer to the spec, with no figure",
      "en",
      "Torque the bolts to the figure in the torque spec above, in sequence.",
    ],
    ["a year", "en", "On 1999 trucks the bracket is different."],
    ["a socket size", "en", "Use the 14 mm socket on the drain plug."],
    /*
     * AGENTS.md, verbatim: "count descriptors that are part of a component's
     * NAME — '24-valve', 'five-speed', 'veinticuatro válvulas', like 'SOHC' or
     * 'V6' — are naming, not specs". A displacement bound to an engine code is
     * that carve-out exactly, and it is the single most likely false positive
     * this collection will produce: the owner's truck *is* a 3.5 L 6G74, and
     * T504's first wave leads with "timing belt 6G74" (T502a review, F3).
     *
     * The distinguishing feature a detector can actually use is the engine
     * code next to the figure — `6G74`, `6G72`, `6G75`, `4M40`, `4M41`,
     * `4D56`, `4G54` — not the litre token, which is identical to the one in
     * "Refill with 4.5 L of fluid" above. Both spacings, both locales.
     */
    [
      "an engine displacement used as a name",
      "en",
      "Install the 3.5 L 6G74 engine cover.",
    ],
    [
      "an engine displacement, no space",
      "en",
      "The 3.0L 6G72 uses a different bracket.",
    ],
    [
      "an engine displacement in ES",
      "es",
      "Instale la tapa del motor 3.5 L 6G74.",
    ],
    [
      "a diesel displacement as a name",
      "en",
      "The 2.8 L 4M40 timing case is not interchangeable.",
    ],
  ])("accepts a step whose %s prose states no spec", (_label, locale, text) => {
    // The false-positive budget. A rule that flagged these would make the
    // collection unwritable, and the next author would delete the rule
    // instead of fixing it (`.claude/GRADER-PRINCIPLES.md`).
    expect(
      procedureIssuePaths(withStepText(locale, text)),
      `wrongly rejected: ${text}`
    ).toEqual([]);
  });

  it("applies the same rule to safety notes", () => {
    const entry = makeProcedure({
      system: "brakes",
      safetyNotes: {
        en: "Torque the caliper bracket to 100 N·m or it will come loose.",
        es: "Apriete el soporte de la mordaza a 100 N·m o se soltará.",
      },
    });

    expect(issuesUnder(entry, "prose.en.safetyNotes").length).toBeGreaterThan(
      0
    );
    expect(issuesUnder(entry, "prose.es.safetyNotes").length).toBeGreaterThan(
      0
    );
  });
});

/* -------------------------------------------------------------------------
 * 5. The corpus — an id nobody resolves is not a reference
 *
 * The mirror of `src/lib/parts/index.ts`' `findPartIssues`: the questions no
 * single entry can answer. T502 turns these into a build failure from
 * `astro:build:start`, naming every file involved (SCF-04).
 * ---------------------------------------------------------------------- */

describe("the build resolves every id a procedure states (PRC-03)", () => {
  it("is clean on a corpus that holds together", () => {
    expect(findProcedureIssues(makeCorpusFor([makeProcedure()]))).toEqual([]);
  });

  it.each(PROCEDURE_SPEC_KINDS)(
    "accepts a spec id naming a `%s` reference entry",
    (kind) => {
      const corpus = makeCorpusFor([
        makeProcedure({
          specs: [`test-ref-${kind}`],
          steps: [{ id: "test-step-torque", specs: [`test-ref-${kind}`] }],
        }),
      ]);

      expect(findProcedureIssues(corpus)).toEqual([]);
    }
  );

  it.each(NON_SPEC_KINDS)(
    "reports `wrong-spec-kind` for a spec id naming a `%s` entry",
    (kind) => {
      const corpus = {
        ...makeCorpusFor([
          makeProcedure({
            specs: [`test-ref-${kind}`],
            steps: [{ id: "test-step-torque", specs: [`test-ref-${kind}`] }],
          }),
        ]),
        references: [makeReference({ id: `test-ref-${kind}`, kind })],
      };

      const issues = findProcedureIssues(corpus);

      expect(issueCodes(issues)).toEqual(["wrong-spec-kind"]);
      expect(issues[0]?.field).toContain("specs");
      expect(issues[0]?.relatedEntryIds).toContain(`test-ref-${kind}`);
    }
  );

  it("reports `unknown-spec` for an id nobody wrote", () => {
    const corpus = makeCorpusFor([
      makeProcedure({
        specs: ["test-ref-nobody-wrote-this"],
        steps: [
          { id: "test-step-torque", specs: ["test-ref-nobody-wrote-this"] },
        ],
      }),
    ]);

    const issues = findProcedureIssues(corpus);

    // Distinct from `wrong-spec-kind` on purpose: "you cited the wrong row"
    // and "that row does not exist" send an author to two different places.
    expect(issueCodes(issues)).toEqual(["unknown-spec"]);
    expect(issues[0]?.entryId).toBe("test-g3-engine-oil-change");
  });

  it("reports `unknown-part` for a consumed part nobody wrote", () => {
    const corpus = makeCorpusFor([
      makeProcedure({
        partsConsumed: [{ part: "test-part-nobody-wrote-this" }],
        steps: [{ id: "test-step-lift" }],
        specs: [],
      }),
    ]);

    expect(issueCodes(findProcedureIssues(corpus))).toEqual(["unknown-part"]);
  });

  it("reports `unknown-prerequisite` for a procedure nobody wrote", () => {
    const corpus = makeCorpusFor([
      makeProcedure({
        prerequisites: [
          { id: "test-prereq-drain", procedure: "test-nobody-wrote-this" },
        ],
      }),
    ]);

    expect(issueCodes(findProcedureIssues(corpus))).toEqual([
      "unknown-prerequisite",
    ]);
  });

  it("reports `prerequisite-cycle` for two jobs requiring each other", () => {
    const corpus = makeCorpusFor([
      makeProcedure({
        id: "test-proc-a",
        prerequisites: [{ id: "test-prereq-b", procedure: "test-proc-b" }],
      }),
      makeProcedure({
        id: "test-proc-b",
        prerequisites: [{ id: "test-prereq-a", procedure: "test-proc-a" }],
      }),
    ]);

    const issues = findProcedureIssues(corpus);

    expect(issues.length).toBeGreaterThan(0);
    expect(new Set(issueCodes(issues))).toEqual(
      new Set(["prerequisite-cycle"])
    );
    // Both halves of the loop are named — an error naming one of two files
    // sends the author to the one that is probably fine.
    expect(
      issues.flatMap((issue) => [issue.entryId, ...issue.relatedEntryIds])
    ).toEqual(expect.arrayContaining(["test-proc-a", "test-proc-b"]));
  });

  it("reports `duplicate-entry-id` before anything derived from it", () => {
    // Staged the way `findPartIssues` stages its checks: while two entries
    // share an id, every pointer question has two answers, and reporting the
    // symptom next to the cause sends an author chasing the symptom.
    const corpus = makeCorpusFor([
      makeProcedure({ id: "test-proc-same" }),
      makeProcedure({ id: "test-proc-same", specs: ["test-ref-nobody"] }),
    ]);

    expect(new Set(issueCodes(findProcedureIssues(corpus)))).toEqual(
      new Set(["duplicate-entry-id"])
    );
  });

  it("is clean on a corpus that states no specs at all", () => {
    // A fluid top-up with no torque figure is a real procedure. A rule that
    // required a spec would make the collection narrower than PRC-01 asks.
    expect(
      findProcedureIssues(
        makeCorpusFor([
          makeProcedure({
            specs: [],
            steps: [{ id: "test-step-lift" }],
            partsConsumed: [],
          }),
        ])
      )
    ).toEqual([]);
  });
});
