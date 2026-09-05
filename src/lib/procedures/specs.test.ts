import { describe, expect, it } from "vitest";
import {
  UNIT_SYMBOLS,
  quantityLabel,
  referenceFigures,
  specRows,
  unitSymbol,
} from "./specs.ts";
import {
  DIMENSION_UNITS,
  TORQUE_UNITS,
  VOLUME_UNITS,
} from "../../schemas/reference.ts";

/** A synthetic `reference` entry. Every figure is an obvious placeholder. */
function reference(
  id: string,
  kind: string,
  fields: Record<string, unknown> = {}
): { data: Record<string, unknown> } {
  return {
    data: {
      id,
      kind,
      system: "engine",
      ...fields,
      prose: {
        en: { title: `TEST ${kind} ${id}`, summary: "Synthetic." },
        es: { title: `TEST ${kind} ${id} (es)`, summary: "Sintética." },
      },
    },
  };
}

describe("unit symbols (PRC-03, REF-01)", () => {
  it("prints the stored id as the symbol a reader recognises", () => {
    expect(unitSymbol("nm")).toBe("N·m");
    expect(unitSymbol("l")).toBe("L");
    expect(unitSymbol("deg")).toBe("°");
  });

  it("falls back to the stored id rather than to a blank", () => {
    // Ugly and honest beats a page with a number and no unit on it.
    expect(unitSymbol("test-unit")).toBe("test-unit");
  });

  it("names every unit a citable spec kind can be stated in (review F6)", () => {
    /*
     * `UNIT_SYMBOLS` is hand-maintained, and a hand-maintained table stops
     * being complete the first time somebody widens a vocabulary in
     * `src/schemas/reference.ts` — the failure would be silent, rendering the
     * raw stored id (`us-gal`) on a page. Derived from the real vocabularies
     * rather than re-listed here, so adding a unit there turns *this* red
     * (`.claude/GRADER-PRINCIPLES.md`: "a known-list sweep is only as complete
     * as its list" — so do not keep a second list).
     *
     * Scoped to the three families `PROCEDURE_SPEC_KINDS` can carry: torque,
     * volume (fluid and capacity), and dimension.
     */
    const cited = [...TORQUE_UNITS, ...VOLUME_UNITS, ...DIMENSION_UNITS];
    const missing = cited.filter((unit) => !(unit in UNIT_SYMBOLS));

    expect(missing).toEqual([]);
  });
});

describe("one stored figure, two renderings (PRC-03)", () => {
  it("renders a nominal", () => {
    expect(quantityLabel({ value: 77, unit: "nm" }, "en-US")).toBe("77 N·m");
  });

  it("renders a band with the unit attached once", () => {
    expect(quantityLabel({ min: 70, max: 84, unit: "nm" }, "en-US")).toBe(
      "70–84 N·m"
    );
  });

  it("renders a nominal with its band", () => {
    expect(
      quantityLabel({ value: 77, min: 70, max: 84, unit: "nm" }, "en-US")
    ).toBe("77 N·m (70–84)");
  });

  it("formats the number in the page locale, from one stored figure", () => {
    // The whole of PRC-03's rendering half in one assertion: the repository
    // holds `3.3` once, and each locale prints it its own way. A per-locale
    // *stored* figure is what the schema refuses.
    expect(quantityLabel({ value: 3.3, unit: "l" }, "en-US")).toBe("3.3 L");
    expect(quantityLabel({ value: 3.3, unit: "l" }, "es-CR")).toBe("3,3 L");
  });

  it("returns the empty string for a half-written figure", () => {
    // Unreachable through the schema (`quantitySchema` rejects a lone bound);
    // total rather than `undefined` so no caller has to branch.
    expect(quantityLabel({ min: 70, unit: "nm" }, "en-US")).toBe("");
  });
});

describe("the figures a reference row states (REF-01)", () => {
  it("reads a torque figure", () => {
    expect(
      referenceFigures(
        { kind: "torque", torque: { value: 77, unit: "nm" } },
        "en-US"
      )
    ).toEqual(["77 N·m"]);
  });

  it("reads a fluid's designation and its capacity, in that order", () => {
    // The designation first: a reader looking at a fluid row wants to know
    // *which* fluid before they know how much of it.
    expect(
      referenceFigures(
        {
          kind: "fluid",
          specification: "TEST SPEC 00W-00",
          capacity: { value: 3.3, unit: "l" },
        },
        "en-US"
      )
    ).toEqual(["TEST SPEC 00W-00", "3.3 L"]);
  });

  it("reads a tightening sequence stage by stage", () => {
    expect(
      referenceFigures(
        {
          kind: "torque",
          torque: { value: 50, unit: "nm" },
          stages: [
            { torque: { value: 50, unit: "nm" } },
            { angle: { value: 90, unit: "deg" } },
          ],
        },
        "en-US"
      )
    ).toEqual(["50 N·m", "50 N·m", "90°"]);
  });

  it("reads a dimension — the kind that closes the `mm` gap (review F7)", () => {
    /*
     * `dimension` is citable precisely so a valve clearance has a legal home
     * outside a sentence (the detector deliberately does not see `mm`). If this
     * render path were broken, that escape hatch would be a dead end and the
     * only remaining move would be the one PRC-03 forbids — so it is graded,
     * in both locales' number formatting.
     */
    const clearance = {
      kind: "dimension",
      dimension: { value: 0.15, unit: "mm" },
    };

    expect(referenceFigures(clearance, "en-US")).toEqual(["0.15 mm"]);
    expect(referenceFigures(clearance, "es-CR")).toEqual(["0,15 mm"]);
  });

  it("reads a signed alignment figure without losing its sign", () => {
    // Camber, caster and toe are legitimately negative (`ANGLE_UNITS` is the
    // one family `quantitySchema` lets be non-positive). A renderer that
    // dropped the sign would invert an alignment spec.
    expect(
      referenceFigures(
        { kind: "dimension", dimension: { value: -0.5, unit: "deg" } },
        "en-US"
      )
    ).toEqual(["-0.5°"]);
  });

  it("states nothing for a row that carries no figure", () => {
    // An `fsm-section` row is a citation, not a value — `PROCEDURE_SPEC_KINDS`
    // refuses it, and if one ever reached a page it must render as silence
    // rather than as an invented number.
    expect(
      referenceFigures(
        { kind: "fsm-section", manual: "TEST manual", pages: { from: 17 } },
        "en-US"
      )
    ).toEqual([]);
  });
});

describe("the rows a procedures page renders (PRC-03)", () => {
  const corpus = [
    reference("test-ref-torque", "torque", {
      torque: { value: 77, unit: "nm" },
    }),
    reference("test-ref-capacity", "capacity", {
      capacity: { value: 3.3, unit: "l" },
    }),
  ];

  it("keeps the entry's declaration order, not alphabetical order", () => {
    // The author chose which figure a reader meets first, exactly as they
    // chose the order of the steps.
    expect(
      specRows(["test-ref-torque", "test-ref-capacity"], corpus, "en").map(
        (row) => row.id
      )
    ).toEqual(["test-ref-torque", "test-ref-capacity"]);
  });

  it("renders the figure and the title from the cited entry", () => {
    const [row] = specRows(["test-ref-torque"], corpus, "en");

    expect(row?.resolved).toBe(true);
    expect(row?.kind).toBe("torque");
    expect(row?.title).toBe("TEST torque test-ref-torque");
    expect(row?.figures).toEqual(["77 N·m"]);
  });

  it("reads the title from the page's own locale", () => {
    expect(specRows(["test-ref-torque"], corpus, "es")[0]?.title).toBe(
      "TEST torque test-ref-torque (es)"
    );
  });

  it("marks an id nobody wrote as unresolved rather than blank", () => {
    // `validate-procedures` refuses that corpus at build time, so this is
    // defense-in-depth — but "we could not find the figure" must never render
    // as the confident absence of one.
    const [row] = specRows(["test-ref-nobody-wrote-this"], corpus, "en");

    expect(row?.resolved).toBe(false);
    expect(row?.figures).toEqual([]);
    expect(row?.title).toBeNull();
  });
});
