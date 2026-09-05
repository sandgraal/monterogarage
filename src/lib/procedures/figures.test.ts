/**
 * The PRC-03 prose-figure detector, at the unit level.
 *
 * `tests/schemas/procedures-spec-by-id.test.ts` (T502a) owns the *rule* — that
 * a figure written into a step is rejected and a count is not — and its reject
 * table is explicitly "evidence for the category and **not** exhaustive", with
 * an instruction attached: "expect to find a spelling this table misses; add it
 * here and widen the pattern, do not narrow the rule".
 *
 * This file is that widening, recorded where it can be argued with. Every
 * rejected row below is a spelling a Mitsubishi FSM torque table actually
 * prints — `88 N·m (9.0 kg-m, 65 ft-lb)` is the shape of the line an author
 * transcribing one is looking at — and every accepted row is a sentence a real
 * procedure will want to write.
 *
 * refs specs/001-foundation (PRC-03)
 */
import { describe, expect, it } from "vitest";
import { findInlinedFigure } from "./figures.ts";

describe("the metric spelling FSM tables print (review F5)", () => {
  it.each([
    ["kg-m, no f", "Torque the bolts to 9.0 kg-m in sequence."],
    ["kgm, closed", "Torque the bolts to 9.0 kgm in sequence."],
    ["kg·m, middle dot", "Apriete los pernos a 9,0 kg·m en secuencia."],
    ["kg m, spaced", "Torque the bolts to 9.0 kg m in sequence."],
    ["kgf-m, with the f", "Apriete los pernos a 9,0 kgf-m."],
  ])("rejects %s", (_label, text) => {
    // The whole reason this is a defect and not a nicety: an FSM prints
    // `88 N·m (9.0 kg-m, 65 ft-lb)` on one line, so a transcribing author
    // meets the `kg-m` spelling in the same breath as the one already caught.
    expect(findInlinedFigure(text)).not.toBeNull();
  });

  it.each([
    [
      "a mass with a word after it",
      "The head weighs 9 kg more than the block.",
    ],
    ["a mass at the end of a clause", "It weighs 5 kg, so use the hoist."],
    ["a mass before a capital", "Lift the 9 kg. Mount it on the bench."],
  ])("accepts %s — a mass is not a torque", (_label, text) => {
    // `kg…m` must not read a kilogram followed by any word starting with `m`
    // as a kilogram-metre. The trailing boundary is what makes that true.
    expect(findInlinedFigure(text)).toBeNull();
  });
});

describe("the imperial spellings, both orders and both scales", () => {
  it.each([
    ["lb-in", "Torque the cover screws to 25 lb-in."],
    ["in-lb, reversed", "Torque the cover screws to 25 in-lb."],
    ["inlb, closed", "Torque the cover screws to 25 inlb."],
  ])("rejects %s", (_label, text) => {
    expect(findInlinedFigure(text)).not.toBeNull();
  });

  it("accepts a mass followed by the English preposition", () => {
    /*
     * The reason `lb…in` and `in…lb` are the one family that does not admit a
     * bare space: "5 lbs in the bag" is a mass and a preposition. Charts print
     * `5 lb-in`, never `5 lb in`, so nothing is lost.
     */
    expect(findInlinedFigure("Put the 5 lbs in the parts tray.")).toBeNull();
  });
});

describe("units spelled out in words", () => {
  it.each([
    ["newton metres", "Torque the bolts to 88 newton metres."],
    ["newton meters", "Torque the bolts to 88 newton meters."],
    ["newton-metros", "Apriete los pernos a 88 newton-metros."],
    ["kilogram-meters", "Torque the bolts to 9 kilogram-meters."],
    ["kilográmetros", "Apriete los pernos a 9 kilográmetros."],
    ["foot-pounds", "Torque the bolts to 65 foot-pounds."],
    ["pound-feet, reversed", "Torque the bolts to 65 pound-feet."],
    ["libras-pie", "Apriete los pernos a 65 libras-pie."],
  ])("rejects %s", (_label, text) => {
    // A rule that recognised `N·m` and not "newton metres" would be a rule
    // with a bypass per vocabulary, which is the failure mode the whole module
    // is written against.
    expect(findInlinedFigure(text)).not.toBeNull();
  });

  it.each([
    ["a distance in feet", "Route the hose 3 feet along the rail."],
    ["a distance in pies", "Pase la manguera 3 pies por el riel."],
    ["a mass in pounds", "The assembly weighs 40 pounds without the fluid."],
  ])("accepts %s — one unit is not a compound", (_label, text) => {
    expect(findInlinedFigure(text)).toBeNull();
  });
});

describe("what the detector still deliberately does not see", () => {
  it("leaves millimetres alone — the stated gap", () => {
    // A socket size, a drill bit and a valve clearance are all `14 mm`, and no
    // regex separates the tool from the specification. The clearance case is
    // closed the other way instead: `dimension` is a citable spec kind, so an
    // author has a correct move. Recorded here so the gap is visible rather
    // than rediscovered.
    expect(findInlinedFigure("Use the 14 mm socket on the drain plug.")).toBe(
      null
    );
  });

  it("leaves a displacement used as an engine's name alone", () => {
    expect(findInlinedFigure("Install the 3.5 L 6G74 engine cover.")).toBe(
      null
    );
  });

  it("still catches a torque figure in an engine-code sentence", () => {
    // The carve-out is scoped to the volume family alone: nobody names an
    // engine after a torque figure, so a torque beside a code is still a spec.
    expect(
      findInlinedFigure("Torque the crank bolt to 185 N·m on the 6G74.")
    ).not.toBeNull();
  });

  it("quotes the figure it found, so the error can name it", () => {
    // SCF-04: an error that says "this sentence contains a figure" sends
    // somebody re-reading a paragraph.
    expect(findInlinedFigure("Torque the bolts to 9.0 kg-m.")).toBe("9.0 kg-m");
  });
});
