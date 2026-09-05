/**
 * Graders — every figure a procedure states is inside `check:citations`' scan
 * (REF-02, and the T106-review note carried on T501's tasks.md line).
 *
 * > **REF-02** IF a numeric value in any reference entry lacks a source
 * > citation, THEN `check:citations` SHALL fail naming the entry and field.
 *
 * The note T501's task line records, and T502's inherits: *"numeric fields
 * added here must come with proof that `check:citations` fires on them
 * uncited"*. T501 discharged it by showing that a parts entry carrying
 * `quantityPerVehicle` with `sources: []` fails the build named by field. This
 * file is the same proof for the three figures PRC-01 puts on a procedure:
 * `difficulty`, the `time` estimate, and a consumed part's `quantity`.
 *
 * ## Why this is a real grader and not a restatement of the shape graders
 *
 * `scripts/check-citations.mjs` walks the **numeric leaves of shared data**.
 * A figure stored as a string (`difficulty: "2"`), stored inside prose, or
 * stored as a five-value enum is invisible to it — and each of those is a
 * plausible schema choice that would satisfy every field-shape grader in
 * `procedures-shape.test.ts` while quietly removing the collection from
 * REF-02's enforcement. The only way to see the difference is to parse a real
 * entry and hand the result to the real checker, which is what this file does.
 *
 * `src/schemas/problems.ts` records the same reasoning for `difficulty`: "a
 * **number**, not a five-value enum, and that is load-bearing … an enum would
 * be invisible to that scan."
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker; T502 activates a grader by deleting exactly that
 * `.fails`. The canary proves `findCitationIssues` already fires on an
 * uncited number today, so an expected failure here is about the procedures
 * schema and never about the checker.
 *
 * refs specs/001-foundation (REF-02, PRC-01)
 */
import { describe, expect, it } from "vitest";

import { findCitationIssues } from "../../scripts/check-citations.mjs";
import { parsedProcedureData } from "../helpers/procedures.ts";
import { makeProcedure, makeSource } from "../fixtures/procedure-fixtures.ts";

interface CitationIssue {
  readonly field: string;
  readonly message: string;
}

/**
 * One parsed procedure, as `check:citations` sees it on disk.
 *
 * The confidence tier moves with the sources, and that is not cosmetic:
 * `defineEntrySchema` refuses an entry claiming `fsm-confirmed` or `tsb` while
 * `sources` is empty ("a document says so" with nothing cited is a structural
 * contradiction). An uncited fixture at the default tier would therefore never
 * parse, and this file would grade a thrown fixture rather than the checker —
 * found by running these graders against a scratch implementation.
 *
 * `first-hand` is the honest tier for an uncited entry, and it is exactly the
 * case REF-02 exists for: the tier gate lets it through, and the *number* is
 * what still needs a source.
 */
function citationIssues(
  options: Parameters<typeof makeProcedure>[0] = {}
): CitationIssue[] {
  const uncited = options.sources !== undefined && options.sources.length === 0;

  return findCitationIssues({
    collection: "procedures",
    file: "src/content/procedures/test-g3-engine-oil-change.json",
    data: parsedProcedureData(
      makeProcedure({
        ...(uncited ? { confidence: "first-hand" } : {}),
        ...options,
      })
    ),
  }) as CitationIssue[];
}

/* -------------------------------------------------------------------------
 * The figures PRC-01 puts on a procedure
 * ---------------------------------------------------------------------- */

describe("an uncited procedure fails `check:citations` by field (REF-02)", () => {
  it("names the difficulty", () => {
    expect(
      citationIssues({ sources: [] }).map((issue) => issue.field)
    ).toContain("difficulty");
  });

  it("names the time estimate, down to the figure inside it", () => {
    // `time.value`, not `time`: SCF-04 wants the field, and a band states two
    // figures that an author edits separately.
    expect(
      citationIssues({ sources: [], time: { value: 45, unit: "min" } }).map(
        (issue) => issue.field
      )
    ).toContain("time.value");
  });

  it("names both ends of a time band", () => {
    const fields = citationIssues({
      sources: [],
      time: { min: 30, max: 90, unit: "min" },
    }).map((issue) => issue.field);

    expect(fields).toContain("time.min");
    expect(fields).toContain("time.max");
  });

  it("names a consumed part's quantity, with its index", () => {
    expect(
      citationIssues({
        sources: [],
        partsConsumed: [{ part: "test-part-oil-filter", quantity: 6 }],
      }).map((issue) => issue.field)
    ).toContain("partsConsumed[0].quantity");
  });

  it("says the figure and the rule in the message, not just the field", () => {
    const [issue] = citationIssues({ sources: [], difficulty: 3 });

    // The message an author reads has to carry the value, so they can tell
    // which of several numbers is meant, and the requirement, so they know it
    // is not negotiable.
    expect(issue?.message).toMatch(/difficulty/);
    expect(issue?.message).toMatch(/3/);
    expect(issue?.message).toMatch(/REF-02/);
  });
});

/* -------------------------------------------------------------------------
 * Positive controls
 * ---------------------------------------------------------------------- */

describe("what a cited procedure is allowed to do", () => {
  it("is clean once the entry cites one source", () => {
    // The control that keeps the rule from being "procedures may not carry
    // numbers". REF-02 asks for a citation, not for silence.
    expect(citationIssues({ sources: [makeSource()] })).toEqual([]);
  });

  it("is clean when a job states no optional figure at all", () => {
    expect(
      citationIssues({
        sources: [makeSource()],
        partsConsumed: [{ part: "test-part-oil-filter" }],
      })
    ).toEqual([]);
  });

  it("does not treat the fitment year range as an uncited spec", () => {
    // `fitment` is part of the fixed entry envelope, which
    // `scripts/check-citations.mjs` deliberately never scans: those numbers
    // say which trucks the entry is about, not what the entry asserts.
    const fields = citationIssues({ sources: [] }).map((issue) => issue.field);

    expect(fields.filter((field) => field.startsWith("fitment"))).toEqual([]);
  });
});
