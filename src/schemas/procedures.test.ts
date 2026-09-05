/**
 * T502 review regressions — the two defects an independent review of this
 * branch found by building a probe entry and shipping it (F1, F2).
 *
 * The T502a graders in `tests/schemas/procedures-*.test.ts` own the collection's
 * contract and are not touched here. This file pins the two rules that were
 * *missing* from the first implementation, in the shape the review reproduced
 * them: a hazard sentence that shipped in one language, and a torque figure
 * that shipped twice — once per locale — through a field nothing scanned.
 *
 * Both are graded through the **registered collection**, for the reason
 * `tests/helpers/procedures.ts` records: a perfect refinement does not make the
 * site bilingual if `src/content.config.ts` never applies it.
 *
 * refs specs/001-foundation (PRC-01, PRC-03, I18N-06)
 */
import { describe, expect, it } from "vitest";
import { collections } from "../content.config.ts";
import { issuesOf } from "../../tests/helpers/schema-outcome.ts";

interface Parsable {
  safeParse(value: unknown): unknown;
}

const proceduresSchema = (
  collections as unknown as Record<string, { schema: Parsable }>
)["procedures"]!.schema;

function issuesAt(entry: unknown, path: string): string[] {
  return issuesOf(proceduresSchema.safeParse(entry))
    .map((issue) => issue.path.map(String).join("."))
    .filter((each) => each === path || each.startsWith(`${path}.`));
}

function allIssuePaths(entry: unknown): string[] {
  return issuesOf(proceduresSchema.safeParse(entry))
    .map((issue) => issue.path.map(String).join("."))
    .sort();
}

/**
 * A minimal, valid, obviously-synthetic procedure. Deliberately **not**
 * safety-critical (`system: "engine"`, no flag), because that is the case both
 * defects lived in — the required-notes rule never fires here.
 */
function procedure(
  overrides: {
    prose?: {
      en?: Record<string, unknown>;
      es?: Record<string, unknown>;
    };
  } = {}
): Record<string, unknown> {
  const base = (locale: "en" | "es") => ({
    title: locale === "en" ? "TEST air filter change" : "Cambio TEST de filtro",
    summary:
      locale === "en"
        ? "Synthetic T502 fixture. Not a real job."
        : "Entrada sintética de T502. No es un trabajo real.",
    steps: {
      "test-step-open": locale === "en" ? "Open the box." : "Abra la caja.",
    },
    tools: {},
    prerequisites: {},
  });

  return {
    id: "test-g3-engine-air-filter",
    fitment: { gens: ["gen3"] },
    system: "engine",
    difficulty: 1,
    time: { value: 10, unit: "min" },
    prerequisites: [],
    tools: [],
    partsConsumed: [],
    specs: [],
    steps: [{ id: "test-step-open" }],
    confidence: "first-hand",
    sources: [],
    prose: {
      en: { ...base("en"), ...(overrides.prose?.en ?? {}) },
      es: { ...base("es"), ...(overrides.prose?.es ?? {}) },
    },
  };
}

/* -------------------------------------------------------------------------
 * F1 — a hazard may not ship in one language
 * ---------------------------------------------------------------------- */

describe("an optional safety note is symmetric across locales (review F1)", () => {
  it("accepts the fixture with no note at all", () => {
    // The positive control for the whole block: the rule is "both or neither",
    // not "every procedure states a hazard".
    expect(allIssuePaths(procedure())).toEqual([]);
  });

  it("accepts a note written in both locales", () => {
    expect(
      allIssuePaths(
        procedure({
          prose: {
            en: { safetyNotes: "Hot oil will burn you. Let it cool first." },
            es: {
              safetyNotes: "El aceite caliente quema. Déjelo enfriar primero.",
            },
          },
        })
      )
    ).toEqual([]);
  });

  it.each(["en", "es"] as const)(
    "rejects a note written only in %s, naming the locale that is missing it",
    (written) => {
      /*
       * The review's exact repro: an ordinary (non-safety-critical) procedure
       * whose EN prose warns about hot oil and whose ES prose says nothing. It
       * passed `astro check`, built both locales, and rendered the warning on
       * one page and nothing on the other.
       */
      const missing = written === "en" ? "es" : "en";
      const entry = procedure({
        prose: {
          [written]: {
            safetyNotes:
              written === "en"
                ? "Hot oil will burn you. Let it cool first."
                : "El aceite caliente quema. Déjelo enfriar primero.",
          },
        },
      });

      expect(issuesAt(entry, `prose.${missing}.safetyNotes`).length).toBe(1);
      // Reported against the half an author has to write, and only that half.
      expect(issuesAt(entry, `prose.${written}.safetyNotes`)).toEqual([]);
    }
  );

  it("does not double-report on a safety-critical entry", () => {
    /*
     * `checkSafetyNotes` already requires both locales there, and two
     * complaints about one missing sentence is the "one mistake, one error"
     * invariant broken — the same exclusion `checkOptionalNotesAreSymmetric`
     * makes in `src/schemas/parts.ts` for `avoid` rows.
     */
    const entry = {
      ...procedure({
        prose: {
          en: { safetyNotes: "Brake fluid strips paint and blinds people." },
        },
      }),
      system: "brakes",
    };

    expect(issuesAt(entry, "prose.es.safetyNotes").length).toBe(1);
  });
});

/* -------------------------------------------------------------------------
 * F2 — the figure detector scans every free-sentence field but `tools`
 * ---------------------------------------------------------------------- */

describe("a figure in any sentence is an inlined value (review F2)", () => {
  it("rejects a torque figure written into the summary, in both locales", () => {
    /*
     * The review's exact repro, and the one with the widest blast radius: a
     * summary renders on the detail page *and* on every index card, so this
     * shipped the same number twice per locale on two surfaces. The first
     * version of `checkInlinedFigures` scanned steps and safety notes only.
     */
    const entry = procedure({
      prose: {
        en: {
          summary: "Torque the drain plug to 39 N·m when you are done.",
        },
        es: {
          summary: "Apriete el tapón a 39 N·m al terminar.",
        },
      },
    });

    expect(issuesAt(entry, "prose.en.summary").length).toBe(1);
    expect(issuesAt(entry, "prose.es.summary").length).toBe(1);
  });

  it("rejects a capacity written into the title", () => {
    const entry = procedure({
      prose: { en: { title: "TEST oil change — takes 4.5 L" } },
    });

    expect(issuesAt(entry, "prose.en.title").length).toBe(1);
  });

  it("rejects a figure written into a prerequisite", () => {
    const entry = {
      ...procedure({
        prose: {
          en: {
            prerequisites: {
              "test-prereq-wheels": "Torque the wheels to 110 N·m first.",
            },
          },
          es: {
            prerequisites: {
              "test-prereq-wheels": "Apriete las ruedas a 110 N·m primero.",
            },
          },
        },
      }),
      prerequisites: [{ id: "test-prereq-wheels" }],
    };

    expect(
      issuesAt(entry, "prose.en.prerequisites.test-prereq-wheels").length
    ).toBe(1);
    expect(
      issuesAt(entry, "prose.es.prerequisites.test-prereq-wheels").length
    ).toBe(1);
  });

  it("leaves a tool's own range alone — that is the tool's identity", () => {
    /*
     * The false-positive budget, written down. "Torque wrench, 20–200 N·m" is
     * what the tool *is*, not a figure this job sets — AGENTS.md's carve-out
     * for count descriptors that are part of a component's name. A rule that
     * flagged it would make the collection unwritable and get itself deleted.
     */
    const entry = {
      ...procedure({
        prose: {
          en: { tools: { "test-tool-wrench": "Torque wrench, 20–200 N·m" } },
          es: {
            tools: { "test-tool-wrench": "Llave de torque, 20–200 N·m" },
          },
        },
      }),
      tools: [{ id: "test-tool-wrench" }],
    };

    expect(allIssuePaths(entry)).toEqual([]);
  });

  it("accepts a summary that points at the figure without stating it", () => {
    // The positive control: PRC-03 asks for the number to live in one place,
    // not for prose to stop mentioning that a torque spec exists.
    expect(
      allIssuePaths(
        procedure({
          prose: {
            en: {
              summary:
                "A filter change and a refill, torqued to the figure below.",
            },
            es: {
              summary:
                "Cambio de filtro y relleno, apretado a la cifra de abajo.",
            },
          },
        })
      )
    ).toEqual([]);
  });
});
