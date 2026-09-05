import { describe, expect, it } from "vitest";
import { EMPTY_PROCEDURES_FILTER, matchesProceduresFilter } from "./filter.ts";

describe("the procedures index system filter (PRC-01)", () => {
  it("shows everything while no pill is chosen", () => {
    // The positive control for the whole module: the "all" pill is the empty
    // string, not a magic id, so a listing with no filter chosen is not a
    // listing filtered on a system nobody named.
    expect(
      matchesProceduresFilter({ system: "brakes" }, EMPTY_PROCEDURES_FILTER)
    ).toBe(true);
    expect(
      matchesProceduresFilter({ system: "engine" }, EMPTY_PROCEDURES_FILTER)
    ).toBe(true);
  });

  it("keeps a card whose system is the chosen one", () => {
    expect(
      matchesProceduresFilter({ system: "brakes" }, { system: "brakes" })
    ).toBe(true);
  });

  it("hides a card whose system is a different one", () => {
    expect(
      matchesProceduresFilter({ system: "engine" }, { system: "brakes" })
    ).toBe(false);
  });

  it("matches exactly — a system id is a closed vocabulary, not free text", () => {
    // `GLOSSARY_SYSTEMS` ids are lowercase and hyphenated, so a near-match is a
    // bug rather than a kindness: `Brakes` reaching this function means
    // something upstream stopped using the vocabulary.
    expect(
      matchesProceduresFilter({ system: "Brakes" }, { system: "brakes" })
    ).toBe(false);
    expect(
      matchesProceduresFilter({ system: "wheels" }, { system: "wheels-tires" })
    ).toBe(false);
  });

  it("hides a card with no system at all when a pill is chosen", () => {
    // A card that carries no facet is not a card that matches every facet —
    // "unknown is not zero" (`.claude/GRADER-PRINCIPLES.md`).
    expect(matchesProceduresFilter({ system: "" }, { system: "brakes" })).toBe(
      false
    );
  });
});
