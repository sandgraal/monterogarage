/**
 * Graders — what a `procedures` entry holds (PRC-01).
 *
 * > **PRC-01** THE `procedures` collection SHALL hold, per entry:
 * > prerequisites, tools (flagging special/SST tools), parts consumed, torque
 * > specs (from shared data, cited), fluid specs and capacities (cited),
 * > step-by-step prose in both locales, time estimate, difficulty 1–5, safety
 * > notes.
 *
 * Nine things, and this file grades every one of them as a *shape* question.
 * The two that are not only shape questions live elsewhere: PRC-03's
 * by-ID rule is `procedures-spec-by-id.test.ts`, and PRC-02's flag and notice
 * are `procedures-safety.test.ts` and `tests/pages/procedure-page.render.test.ts`.
 *
 * ## Parsed through the registered collection, on purpose
 *
 * Every assertion goes through `collections.procedures.schema` (see
 * `tests/helpers/procedures.ts`), not through a schema value imported from
 * `src/schemas/`. `procedures` is registered **today**, on the placeholder
 * `baseEntrySchema()` — so "the schema is written but nothing calls it" is the
 * live state of this collection, not a hypothetical, and a grader that could
 * not tell the two apart would be worthless here.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker; T502 activates a grader by deleting exactly that
 * `.fails` and nothing else. `tests/schemas/procedures-seam-contract.test.ts`
 * is the unmarked canary proving today's failures are the missing schema.
 *
 * ## Positive controls
 *
 * Every rejection below is paired with an acceptance in the same block, and
 * the acceptance is not decorative: it is what stops the fix from being "add
 * `.strict()` everywhere and reject the field outright". `.claude/GRADER-PRINCIPLES.md`
 * — a rule with no positive control drifts over-strict for months, then gets
 * deleted out of frustration instead of fixed.
 *
 * refs specs/001-foundation (PRC-01, SCF-04)
 */
import { describe, expect, it } from "vitest";

import { DIFFICULTY_MAX, DIFFICULTY_MIN } from "../../src/schemas/problems.ts";
import {
  accepts,
  issuesUnder,
  parseProcedure,
  procedureIssuePaths,
} from "../helpers/procedures.ts";
import { unrecognizedKeys } from "../helpers/schema-outcome.ts";
import { makeProcedure, without } from "../fixtures/procedure-fixtures.ts";
import { COLLECTION_ROUTE_SEGMENTS } from "../../src/i18n/routes.ts";
import { ENTRY_SLUGS } from "../../src/i18n/entry-slugs.ts";
import { LOCALES } from "../../src/i18n/routing.ts";

/**
 * A boundary-table row's verdict, asserted so that **neither direction passes
 * vacuously**.
 *
 * The trap this exists to avoid, found by running the first draft of this
 * file: today the registered `procedures` collection rejects *everything* — a
 * procedure entry's every field is an unrecognised key — so a rejection row
 * written as `expect(accepts(entry)).toBe(false)` passes today, and `it.fails`
 * then reports it as an unexpected *success*. Worse, on a day when it did not
 * report that, the row would be a test that cannot fail: it says "reject this"
 * against a schema that rejects the valid case too.
 *
 * So a rejection row asserts the rejection is **about this field**, in
 * SCF-04's sense and `.claude/GRADER-PRINCIPLES.md`'s ("rejected for the
 * stated reason, not just 'it threw'"), and that nothing *else* is reported —
 * one mistake, one error, the invariant `src/schemas/parts.ts` states about
 * its own rules. An acceptance row asserts a completely clean parse.
 */
function expectFieldVerdict(
  field: string,
  entry: Record<string, unknown>,
  accepted: boolean
): void {
  if (accepted) {
    expect(procedureIssuePaths(entry)).toEqual([]);
    return;
  }

  const reported = issuesUnder(entry, field);
  expect(
    reported.length,
    `nothing was reported against \`${field}\``
  ).toBeGreaterThan(0);
  expect(
    procedureIssuePaths(entry).filter(
      (path) => path !== field && !path.startsWith(`${field}.`)
    ),
    "one mistake should produce one error"
  ).toEqual([]);
}

/**
 * The simplest entry PRC-01 admits: one step, and none of the four optional
 * lists. A real procedure — "top up the washer fluid" — and the fixture the
 * optionality graders need, because it declares nothing that could dangle
 * when a list is removed.
 */
function standalone(): Record<string, unknown> {
  return makeProcedure({
    steps: [{ id: "test-step-lift" }],
    specs: [],
    tools: [],
    prerequisites: [],
    partsConsumed: [],
  });
}

/* -------------------------------------------------------------------------
 * The whole entry
 * ---------------------------------------------------------------------- */

describe("a complete procedure entry (PRC-01)", () => {
  it("accepts the nine things PRC-01 asks for, with no complaint", () => {
    // The positive control for this entire file. If it ever passes while a
    // rejection grader below also passes, one of the two is wrong.
    expect(procedureIssuePaths(makeProcedure())).toEqual([]);
    expect(accepts(makeProcedure())).toBe(true);
  });

  /*
   * "SHALL hold, per entry" is required, not optional, for the four fields
   * that have no honest empty value. The list-shaped fields are deliberately
   * *not* here — a job that consumes no parts and needs no special tool is
   * real, and `prerequisites: []` is the common case. See the acceptance
   * below, which is the other half of this rule.
   */
  it.each(["system", "difficulty", "time", "steps"])(
    "requires `%s` and reports it by name (SCF-04)",
    (field) => {
      const issues = issuesUnder(without(makeProcedure(), field), field);
      expect(issues.length).toBeGreaterThan(0);
    }
  );

  it.each(["prerequisites", "tools", "partsConsumed", "specs"])(
    "lets `%s` be absent — a job may need none of them",
    (field) => {
      // Built from the standalone fixture, not from the full one: dropping
      // `tools` from an entry that still carries tool *prose* is an orphan
      // prose key, and dropping `specs` from one whose steps still cite a spec
      // is a dangling intra-entry reference. Both are real rules, graded
      // elsewhere in this file — asking one fixture to violate them while
      // proving the field is optional is a grader contradiction, not a
      // requirement. (Found against a scratch implementation.)
      expect(procedureIssuePaths(without(standalone(), field))).toEqual([]);
    }
  );

  it("names an unknown field rather than silently stripping it", () => {
    const outcome = parseProcedure(
      makeProcedure({ extraShared: { dificulty: 3 } })
    );
    const keys = unrecognizedKeys(outcome);

    expect(keys).toContain("dificulty");
    // …and the correctly-spelled field is *recognised*. Without this half the
    // assertion passes today, when every field of a procedure entry is an
    // unrecognised key — a rejection that says nothing about the typo.
    expect(keys).not.toContain("difficulty");
  });
});

/* -------------------------------------------------------------------------
 * Steps — PRC-01's "step-by-step prose in both locales"
 * ---------------------------------------------------------------------- */

describe("steps (PRC-01)", () => {
  it("rejects a procedure with no steps at all", () => {
    // A procedure that does not say what to do is not a procedure; it is a
    // title. The same reasoning as `problems`' "at least one symptom".
    expect(
      issuesUnder(makeProcedure({ steps: [] }), "steps").length
    ).toBeGreaterThan(0);
  });

  it("accepts a single-step procedure", () => {
    expect(
      procedureIssuePaths(
        makeProcedure({ steps: [{ id: "test-step-only" }], specs: [] })
      )
    ).toEqual([]);
  });

  it.each(["en", "es"])(
    "rejects a step whose %s sentence is missing",
    (locale) => {
      const entry = makeProcedure({
        proseOmit: { [locale]: { steps: ["test-step-torque"] } },
      });

      // Reported against the locale that is missing it, so an author is sent
      // to the file half they have to write — not to the half that is fine.
      const reported = issuesUnder(entry, `prose.${locale}.steps`);
      const other = issuesUnder(
        entry,
        `prose.${locale === "en" ? "es" : "en"}.steps`
      );

      expect(reported.length).toBeGreaterThan(0);
      expect(other).toEqual([]);
    }
  );

  it("rejects a step sentence keyed to a step that does not exist", () => {
    const entry = makeProcedure({
      stepProse: { en: { "test-step-ghost": "TEST orphan sentence." } },
    });
    // `stepProse` only overrides declared ids, so add the orphan directly.
    const prose = (
      entry as { prose: Record<string, { steps: Record<string, string> }> }
    ).prose;
    prose["en"]!.steps["test-step-ghost"] = "TEST orphan sentence.";

    expect(issuesUnder(entry, "prose.en.steps").length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------
 * Duplicate ids — every list, not just the one that occurred to me
 *
 * ## Why this is a table and not a single `steps` test
 *
 * The first draft graded duplicates for `steps` only, on the reasoning that
 * the prose is keyed by a step id. That reasoning is correct and it applies
 * *identically* to `tools` and `prerequisites`, which are keyed the same way —
 * two rows sharing one handle share one sentence, and one of them is wrong.
 * It applies differently but just as forcefully to `specs[]` and
 * `partsConsumed[]`: a repeat there renders the same torque row, or the same
 * part, twice on the page.
 *
 * T401's own tasks.md line records this exact defect class shipping once
 * already — "`checkDuplicateIds` sweeps the four top-level lists only, never
 * the id lists *inside* a step" — which is a rule that was right about the
 * lists somebody thought of and silent about the rest. Enumerating the
 * category rather than one member of it is `.claude/GRADER-PRINCIPLES.md`'s
 * "grade behavior, not name lists" (T502a review, F5).
 *
 * The nested lists (`steps[].specs`, `steps[].parts`) are the *next* ring out
 * and are deliberately left to the intra-entry reference rules below, which
 * already reject anything a step names that the entry does not declare — a
 * repeat inside one step is a weaker fault than a dangling one, and it is
 * recorded here as a known gap rather than silently skipped.
 * ---------------------------------------------------------------------- */

describe("no list repeats an id (PRC-01)", () => {
  it.each<[string, Record<string, unknown>]>([
    [
      "steps",
      {
        steps: [{ id: "test-step-same" }, { id: "test-step-same" }],
        specs: [],
      },
    ],
    ["tools", { tools: [{ id: "test-tool-same" }, { id: "test-tool-same" }] }],
    [
      "prerequisites",
      {
        prerequisites: [{ id: "test-prereq-same" }, { id: "test-prereq-same" }],
      },
    ],
    ["specs", { specs: ["test-ref-torque", "test-ref-torque"] }],
    [
      "partsConsumed",
      {
        partsConsumed: [
          { part: "test-part-oil-filter" },
          { part: "test-part-oil-filter" },
        ],
      },
    ],
  ])("rejects `%s` naming the same thing twice", (field, overrides) => {
    const issues = issuesUnder(makeProcedure(overrides), field);

    expect(
      issues.length,
      `a repeat in \`${field}\` went unreported`
    ).toBeGreaterThan(0);
  });

  it.each<[string, Record<string, unknown>]>([
    [
      "steps",
      {
        steps: [{ id: "test-step-lift" }, { id: "test-step-torque" }],
        specs: ["test-ref-torque"],
      },
    ],
    [
      "tools",
      {
        tools: [{ id: "test-tool-socket" }, { id: "test-tool-wrench" }],
      },
    ],
    [
      "prerequisites",
      {
        prerequisites: [
          { id: "test-prereq-cold" },
          { id: "test-prereq-level" },
        ],
      },
    ],
    ["specs", { specs: ["test-ref-torque", "test-ref-fluid"] }],
    [
      "partsConsumed",
      {
        partsConsumed: [
          { part: "test-part-oil-filter" },
          { part: "test-part-drain-washer" },
        ],
      },
    ],
  ])("accepts two distinct entries in `%s`", (_field, overrides) => {
    // The positive control for every row above: the rule is "no repeats",
    // not "no second row".
    expect(procedureIssuePaths(makeProcedure(overrides))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * Tools — PRC-01's "tools (flagging special/SST tools)"
 * ---------------------------------------------------------------------- */

describe("tools, and the special/SST flag (PRC-01)", () => {
  it("accepts a job that needs no tools at all", () => {
    expect(procedureIssuePaths(makeProcedure({ tools: [] }))).toEqual([]);
  });

  it("accepts an ordinary tool with no flag", () => {
    expect(
      procedureIssuePaths(
        makeProcedure({ tools: [{ id: "test-tool-socket" }] })
      )
    ).toEqual([]);
  });

  it("accepts a special tool carrying its SST number", () => {
    expect(
      procedureIssuePaths(
        makeProcedure({
          tools: [
            { id: "test-tool-sst", special: true, sstNumber: "TEST-SST-0001" },
          ],
        })
      )
    ).toEqual([]);
  });

  it("rejects an SST number on a tool not flagged special", () => {
    /*
     * A Mitsubishi special service tool *is* the "special tool" PRC-01 wants
     * flagged. An entry that records the number but leaves `special` off
     * renders as an ordinary socket, and the reader finds out they cannot do
     * the job when the truck is already apart. The flag is the requirement;
     * the number is evidence for it, and evidence without the flag is the
     * contradiction a schema can see.
     */
    const issues = issuesUnder(
      makeProcedure({
        tools: [{ id: "test-tool-sst", sstNumber: "TEST-SST-0001" }],
      }),
      "tools"
    );

    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts a special tool with no SST number", () => {
    // A slide hammer is a special tool nobody has a Mitsubishi number for.
    expect(
      procedureIssuePaths(
        makeProcedure({ tools: [{ id: "test-tool-puller", special: true }] })
      )
    ).toEqual([]);
  });

  it.each(["en", "es"])(
    "rejects a tool with no %s name — a tool list is prose too",
    (locale) => {
      const entry = makeProcedure({
        proseOmit: { [locale]: { tools: ["test-tool-sst"] } },
      });

      expect(
        issuesUnder(entry, `prose.${locale}.tools`).length
      ).toBeGreaterThan(0);
    }
  );
});

/* -------------------------------------------------------------------------
 * Parts consumed — PRC-01
 * ---------------------------------------------------------------------- */

describe("parts consumed (PRC-01)", () => {
  it("accepts a part consumed with no stated quantity", () => {
    // "How many" is often not what a catalogue states, and a guessed count is
    // an invented fact — the reasoning `parts`' `quantityPerVehicle` records.
    expect(
      procedureIssuePaths(
        makeProcedure({ partsConsumed: [{ part: "test-part-oil-filter" }] })
      )
    ).toEqual([]);
  });

  it.each<[unknown]>([[0], [-1], [1.5]])(
    "rejects a consumed quantity of %s",
    (quantity) => {
      const issues = issuesUnder(
        makeProcedure({
          partsConsumed: [
            {
              part: "test-part-oil-filter",
              quantity: quantity as number,
            },
          ],
        }),
        "partsConsumed"
      );

      expect(issues.length).toBeGreaterThan(0);
    }
  );

  it("accepts a whole positive quantity", () => {
    expect(
      procedureIssuePaths(
        makeProcedure({
          partsConsumed: [{ part: "test-part-oil-filter", quantity: 6 }],
        })
      )
    ).toEqual([]);
  });

  it("rejects a part number written where a part id belongs", () => {
    /*
     * The mistake an author will actually make. `TEST-P0001` is uppercase and
     * an entry id is lowercase kebab-case, so the two cannot be confused
     * silently — the same rule, for the same reason, that `parts`'
     * `supersededBy` states. Whether the id names a real entry is the build's
     * question (`unknown-part`), not this one.
     */
    const issues = issuesUnder(
      makeProcedure({ partsConsumed: [{ part: "TEST-P0001" }] }),
      "partsConsumed"
    );

    expect(issues.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------
 * Difficulty — PRC-01's "difficulty 1–5"
 *
 * The boundary table. `DIFFICULTY_MIN`/`DIFFICULTY_MAX` are imported from
 * `src/schemas/problems.ts` rather than written as `1` and `5` here, because
 * PRC-01 and PRB-01 are the same scale and that module's docstring already
 * says so ("exactly as PRB-01 (**and PRC-01**) scale it"). A grader that spelt
 * the numbers out would keep passing on the day somebody minted a second,
 * different five-point scale — which is precisely the drift T502's task line
 * forbids.
 * ---------------------------------------------------------------------- */

describe("difficulty is the shared 1–5 scale (PRC-01)", () => {
  it.each<[unknown, boolean]>([
    [DIFFICULTY_MIN - 1, false],
    [DIFFICULTY_MIN, true],
    [2, true],
    [3, true],
    [4, true],
    [DIFFICULTY_MAX, true],
    [DIFFICULTY_MAX + 1, false],
    [2.5, false],
    ["3", false],
    [null, false],
  ])("difficulty %s → accepted: %s", (difficulty, expected) => {
    expectFieldVerdict("difficulty", makeProcedure({ difficulty }), expected);
  });
});

/* -------------------------------------------------------------------------
 * Time estimate — PRC-01
 *
 * The three forms `quantitySchema` admits, and the ones it refuses. Written
 * as a table because the refusals are what make the field a *specification*
 * rather than a free-text guess: a lone `min` is half a spec, and the missing
 * half is never derived (an invented midpoint is an invented number).
 * ---------------------------------------------------------------------- */

describe("the time estimate is a real quantity (PRC-01)", () => {
  it.each<[string, unknown, boolean]>([
    ["a nominal", { value: 45, unit: "min" }, true],
    ["a nominal in hours", { value: 3, unit: "h" }, true],
    ["a band", { min: 30, max: 90, unit: "min" }, true],
    [
      "a nominal with its band",
      { value: 45, min: 30, max: 90, unit: "min" },
      true,
    ],
    ["a lone min", { min: 30, unit: "min" }, false],
    ["a lone max", { max: 90, unit: "min" }, false],
    ["a band the wrong way round", { min: 90, max: 30, unit: "min" }, false],
    ["zero", { value: 0, unit: "h" }, false],
    ["a negative", { value: -1, unit: "h" }, false],
    ["no unit", { value: 45 }, false],
    ["a unit nothing on this site uses", { value: 2, unit: "days" }, false],
    ["a bare number", 45, false],
    ["a sentence", "about an hour", false],
  ])(
    // One `%s`, one argument. Vitest fills placeholders positionally, so a
    // second `%s` here would print the *time object* and call it the verdict —
    // the same title bug the T502a review found in the render file (F7).
    "a time estimate stated as %s",
    (_label, time, expected) => {
      expectFieldVerdict("time", makeProcedure({ time }), expected);
    }
  );
});

/* -------------------------------------------------------------------------
 * Prerequisites — PRC-01
 * ---------------------------------------------------------------------- */

describe("prerequisites (PRC-01)", () => {
  it("accepts a prerequisite that is a condition, not a procedure", () => {
    // "Engine cold. Truck level, on its jack stands." A prerequisite is not
    // always another job on this site, and a shape that assumed it was would
    // force authors to invent entries for sentences.
    expect(
      procedureIssuePaths(
        makeProcedure({ prerequisites: [{ id: "test-prereq-cold" }] })
      )
    ).toEqual([]);
  });

  it("accepts a prerequisite that names another procedure", () => {
    expect(
      procedureIssuePaths(
        makeProcedure({
          id: "test-g3-engine-timing-belt",
          prerequisites: [
            {
              id: "test-prereq-drain",
              procedure: "test-g3-engine-oil-change",
            },
          ],
        })
      )
    ).toEqual([]);
  });

  it("rejects a procedure that requires itself", () => {
    const issues = issuesUnder(
      makeProcedure({
        id: "test-g3-engine-oil-change",
        prerequisites: [
          {
            id: "test-prereq-self",
            procedure: "test-g3-engine-oil-change",
          },
        ],
      }),
      "prerequisites"
    );

    expect(issues.length).toBeGreaterThan(0);
  });

  it.each(["en", "es"])(
    "rejects a prerequisite with no %s sentence",
    (locale) => {
      const entry = makeProcedure({
        proseOmit: { [locale]: { prerequisites: ["test-prereq-cold"] } },
      });

      expect(
        issuesUnder(entry, `prose.${locale}.prerequisites`).length
      ).toBeGreaterThan(0);
    }
  );
});

/* -------------------------------------------------------------------------
 * A step points only at what its own entry declares
 *
 * The intra-entry half of PRC-03's by-ID rule: whether the id resolves to a
 * real `reference` or `parts` entry is the build's question
 * (`procedures-spec-by-id.test.ts`), but whether *this entry* declared it is
 * visible from inside the entry, and it is the mistake that renders as an
 * empty row rather than as an error. Same shape as `problems`' rule that a fix
 * path may only address causes the entry declares.
 * ---------------------------------------------------------------------- */

describe("a step references only what the entry declares (PRC-01)", () => {
  it("rejects a step spec id the entry never listed in `specs`", () => {
    const issues = issuesUnder(
      makeProcedure({
        steps: [{ id: "test-step-torque", specs: ["test-ref-fluid"] }],
        specs: ["test-ref-torque"],
      }),
      "steps"
    );

    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts a step spec id the entry did list", () => {
    expect(
      procedureIssuePaths(
        makeProcedure({
          steps: [{ id: "test-step-torque", specs: ["test-ref-torque"] }],
          specs: ["test-ref-torque"],
        })
      )
    ).toEqual([]);
  });

  it("rejects a step part id the entry never consumes", () => {
    const issues = issuesUnder(
      makeProcedure({
        steps: [{ id: "test-step-fit", parts: ["test-part-gasket"] }],
        partsConsumed: [{ part: "test-part-oil-filter" }],
        specs: [],
      }),
      "steps"
    );

    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts a step part id the entry does consume", () => {
    expect(
      procedureIssuePaths(
        makeProcedure({
          steps: [{ id: "test-step-fit", parts: ["test-part-oil-filter"] }],
          partsConsumed: [{ part: "test-part-oil-filter" }],
          specs: [],
        })
      )
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * The collection has a bilingual route (I18N-01, I18N-05)
 *
 * ## Why these are here, and why they were not
 *
 * `src/schemas/procedures.ts` claimed, in its own docstring, that the graders
 * "require only that `COLLECTION_ROUTE_SEGMENTS.procedures` exists, carries
 * both locales, and does not put the English word in the Spanish URL". None of
 * that was true: nothing anywhere asserted it, and the repo-wide slug-registry
 * graders pin the `es !== en` property for `glossary` by name only — so a
 * `procedures` row reading `{ en: "procedures", es: "procedures" }` would have
 * passed every check in the repository (T502a review, F4).
 *
 * A docstring is not a grader. These are the grader.
 *
 * **What is still T502's call:** the actual Spanish word. Whether the segment
 * is `procedimientos` or something else is a glossary ruling, and T502's
 * tasks.md line owns it. What is graded is the shape around the choice —
 * present, bilingual, distinct, and not the English word — which is I18N-01's
 * "neither locale is privileged" in the one place a reader can see it.
 * ---------------------------------------------------------------------- */

describe("the collection has a bilingual route (I18N-01, I18N-05)", () => {
  function segments(): Record<string, string> | undefined {
    return (
      COLLECTION_ROUTE_SEGMENTS as Record<string, Record<string, string>>
    )["procedures"];
  }

  it("registers a `procedures` route segment", () => {
    // Without a row the collection has no URL in either locale, so the page
    // T502 writes builds nothing and `check:hreflang` never sees it.
    expect(segments()).toBeDefined();
  });

  it.each(LOCALES)("carries a %s segment", (locale) => {
    expect(typeof segments()?.[locale]).toBe("string");
    expect(segments()?.[locale]).not.toBe("");
  });

  it("does not put the English word in the Spanish URL", () => {
    const row = segments();

    // The whole of I18N-01 in one assertion: `/es/procedures/` would be the
    // English word wearing a Spanish accent, exactly what `repuestos` and
    // `taller` were chosen to avoid on the collections that came before.
    expect(row?.["es"]).not.toBe(row?.["en"]);
    expect(row?.["es"]).not.toBe("procedures");
  });

  it.each(LOCALES)("uses a lowercase, hyphen-safe %s segment", (locale) => {
    // Segments are "lowercase, hyphenated, and never URL-encoded" —
    // `src/i18n/routes.ts`' own rule for this registry.
    expect(segments()?.[locale]).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("opens a `procedures` namespace in the slug registry", () => {
    /*
     * `parts: {}` is the precedent: T501 registered an empty namespace so the
     * build's "every entry has a slug row, every row names an entry" check has
     * something to compare against, and so `slugRegistryIds("procedures")`
     * answers `[]` rather than `undefined`. T504 fills it; the namespace has
     * to exist before it can.
     */
    expect(Object.keys(ENTRY_SLUGS)).toContain("procedures");
  });
});
