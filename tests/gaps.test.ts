/**
 * Graders — `npm run gaps` (T703, GAP-01, PRB-06).
 *
 * Self-tested per the T402/T501/T601/T702 conductor-ledgered exception: no
 * paired `[TEST]` task exists for this `[PLATFORM]`-only line, so these
 * graders ship alongside the implementation in the same branch, reviewed by
 * an independent code-reviewer rather than a separate test-writer pass.
 *
 * Every fixture is synthetic. `findZeroCoverageCombinations` and
 * `findStaleAnecdotalEntries` are the two categories that would otherwise
 * reach outside the test (the real fitment resolver, the real filesystem's
 * git history) — the former is exercised through the same `buildTaxonomy`
 * seam `tests/lib/fitment/*.test.ts` already use, and the latter takes an
 * injectable `gitDate`/`now` so this suite never shells out to `git`.
 *
 * refs specs/001-foundation (GAP-01, PRB-06, FIT-01)
 */
import { describe, expect, it } from "vitest";

import {
  ANECDOTAL_STALE_DAYS,
  KNOWN_JARGON_TERMS,
  buildGapsReport,
  findDanglingFixPathReferences,
  findPartsWithNoFitment,
  findProblemsWithNoFixPath,
  findProceduresMissingTorqueOrFluid,
  findStaleAnecdotalEntries,
  findUndefinedGlossaryTerms,
  findZeroCoverageCombinations,
  mapLinkWarningsToGapItems,
  readLinkAuditWarnings,
} from "../scripts/gaps.mjs";

interface Entry {
  collection: string;
  file: string;
  data: unknown;
}

function entry(collection: string, file: string, data: unknown): Entry {
  return { collection, file, data };
}

/* -------------------------------------------------------------------------
 * 1. Problems with no fix path
 * ---------------------------------------------------------------------- */

describe("findProblemsWithNoFixPath", () => {
  it("reports a problem whose fixPaths is empty", () => {
    const entries = [
      entry("problems", "src/content/problems/no-fix.json", {
        id: "no-fix",
        fixPaths: [],
      }),
    ];

    const items = findProblemsWithNoFixPath(entries);

    expect(items).toHaveLength(1);
    expect(items[0]?.entryId).toBe("no-fix");
    expect(items[0]?.message).toMatch(/PRB-06/);
  });

  it("says nothing about a problem with at least one fix path", () => {
    const entries = [
      entry("problems", "src/content/problems/has-fix.json", {
        id: "has-fix",
        fixPaths: [{ id: "replace-it" }],
      }),
    ];

    expect(findProblemsWithNoFixPath(entries)).toEqual([]);
  });

  it("treats a missing fixPaths field the same as empty", () => {
    const entries = [
      entry("problems", "src/content/problems/undeclared.json", {
        id: "undeclared",
      }),
    ];

    expect(findProblemsWithNoFixPath(entries)).toHaveLength(1);
  });

  it("ignores entries outside the problems collection", () => {
    const entries = [entry("parts", "src/content/parts/x.json", { id: "x" })];

    expect(findProblemsWithNoFixPath(entries)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 2. Parts with no narrowed fitment
 * ---------------------------------------------------------------------- */

describe("findPartsWithNoFitment", () => {
  it("reports a part whose fitment names only gens", () => {
    const entries = [
      entry("parts", "src/content/parts/bare.json", {
        id: "bare",
        fitment: { gens: ["gen3"] },
      }),
    ];

    const items = findPartsWithNoFitment(entries);

    expect(items).toHaveLength(1);
    expect(items[0]?.message).toContain('["gen3"]');
  });

  it("says nothing once any narrowing facet is present", () => {
    const narrowedBy = [
      { markets: ["us"] },
      { years: { from: 1999 } },
      { engines: ["6g74-sohc"] },
      { transmissions: ["automatic-4-speed"] },
      { transferCases: ["super-select"] },
      { trims: ["ls"] },
      { drive: ["4wd"] },
    ];

    for (const extra of narrowedBy) {
      const entries = [
        entry("parts", "src/content/parts/narrowed.json", {
          id: "narrowed",
          fitment: { gens: ["gen3"], ...extra },
        }),
      ];
      expect(findPartsWithNoFitment(entries)).toEqual([]);
    }
  });

  it("treats an empty narrowing array the same as absent", () => {
    const entries = [
      entry("parts", "src/content/parts/empty-array.json", {
        id: "empty-array",
        fitment: { gens: ["gen3"], markets: [] },
      }),
    ];

    expect(findPartsWithNoFitment(entries)).toHaveLength(1);
  });

  it("ignores non-parts collections", () => {
    const entries = [
      entry("problems", "src/content/problems/x.json", {
        id: "x",
        fitment: { gens: ["gen3"] },
      }),
    ];

    expect(findPartsWithNoFitment(entries)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 3. Procedures missing a torque or fluid citation
 * ---------------------------------------------------------------------- */

describe("findProceduresMissingTorqueOrFluid", () => {
  function reference(id: string, kind: string): Entry {
    return entry("reference", `src/content/reference/${id}.json`, {
      id,
      kind,
    });
  }

  it("reports a procedure whose specs cite neither torque nor fluid", () => {
    const entries = [
      reference("g3-capacity-fuel-tank", "capacity"),
      entry("procedures", "src/content/procedures/inspect.json", {
        id: "inspect",
        specs: ["g3-capacity-fuel-tank"],
      }),
    ];

    const items = findProceduresMissingTorqueOrFluid(entries);

    expect(items).toHaveLength(1);
    expect(items[0]?.entryId).toBe("inspect");
  });

  it("says nothing once a cited spec is torque-kind", () => {
    const entries = [
      reference("g3-torque-headbolt", "torque"),
      entry("procedures", "src/content/procedures/retorque.json", {
        id: "retorque",
        specs: ["g3-torque-headbolt"],
      }),
    ];

    expect(findProceduresMissingTorqueOrFluid(entries)).toEqual([]);
  });

  it("says nothing once a cited spec is fluid-kind", () => {
    const entries = [
      reference("g3-fluid-atf", "fluid"),
      entry("procedures", "src/content/procedures/fill.json", {
        id: "fill",
        specs: ["g3-fluid-atf"],
      }),
    ];

    expect(findProceduresMissingTorqueOrFluid(entries)).toEqual([]);
  });

  it("reports a procedure with no specs at all", () => {
    const entries = [
      entry("procedures", "src/content/procedures/diagnose.json", {
        id: "diagnose",
      }),
    ];

    expect(findProceduresMissingTorqueOrFluid(entries)).toHaveLength(1);
  });

  it("does not resolve a spec id against the wrong collection", () => {
    // A `parts` entry sharing an id with a would-be `reference` row must not
    // be mistaken for one — `kindById` is built only from `reference` data.
    const entries = [
      entry("parts", "src/content/parts/g3-torque-headbolt.json", {
        id: "g3-torque-headbolt",
      }),
      entry("procedures", "src/content/procedures/retorque.json", {
        id: "retorque",
        specs: ["g3-torque-headbolt"],
      }),
    ];

    expect(findProceduresMissingTorqueOrFluid(entries)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------
 * 4. Fitment combinations with zero coverage
 * ---------------------------------------------------------------------- */

describe("findZeroCoverageCombinations", () => {
  function generation(id: string, from: number, to: number | null): Entry {
    return entry("vehicles", `src/content/vehicles/${id}.json`, {
      id,
      kind: "generation",
      production: { from, to },
    });
  }

  function combination(
    id: string,
    generationId: string,
    market: string,
    offerings: unknown[]
  ): Entry {
    return entry("vehicles", `src/content/vehicles/${id}.json`, {
      id,
      kind: "combination",
      generation: generationId,
      market,
      coverage: "partial",
      offerings,
    });
  }

  it("reports an offering no problem/part/procedure/mod covers", () => {
    const entries = [
      generation("gen3", 1999, 2006),
      combination("combos-gen3-us", "gen3", "us", [
        {
          years: { from: 1999, to: 2002 },
          engine: "6g74-sohc",
          transmission: "automatic-4-speed",
        },
      ]),
    ];

    const items = findZeroCoverageCombinations(entries);

    expect(items).toHaveLength(1);
    expect(items[0]?.file).toBe("src/content/vehicles/combos-gen3-us.json");
    expect(items[0]?.message).toContain("gen3/us");
    expect(items[0]?.message).toContain("6g74-sohc");
  });

  it("says nothing once any problem/part/procedure/mod applies to the vehicle", () => {
    const entries = [
      generation("gen3", 1999, 2006),
      combination("combos-gen3-us", "gen3", "us", [
        {
          years: { from: 1999, to: 2002 },
          engine: "6g74-sohc",
          transmission: "automatic-4-speed",
        },
      ]),
      entry("problems", "src/content/problems/covers-it.json", {
        id: "covers-it",
        fitment: { gens: ["gen3"], markets: ["us"], engines: ["6g74-sohc"] },
      }),
    ];

    expect(findZeroCoverageCombinations(entries)).toEqual([]);
  });

  it("does not count reference, community or glossary content as coverage", () => {
    const entries = [
      generation("gen3", 1999, 2006),
      combination("combos-gen3-us", "gen3", "us", [
        {
          years: { from: 1999, to: 2002 },
          engine: "6g74-sohc",
        },
      ]),
      entry("reference", "src/content/reference/torque-row.json", {
        id: "torque-row",
        fitment: { gens: ["gen3"], markets: ["us"], engines: ["6g74-sohc"] },
      }),
    ];

    expect(findZeroCoverageCombinations(entries)).toHaveLength(1);
  });

  it("ignores a non-combination vehicles entry", () => {
    const entries = [
      generation("gen3", 1999, 2006),
      entry("vehicles", "src/content/vehicles/6g74-sohc.json", {
        id: "6g74-sohc",
        kind: "engine",
      }),
    ];

    expect(findZeroCoverageCombinations(entries)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 5. Glossary terms used in prose but undefined
 * ---------------------------------------------------------------------- */

describe("findUndefinedGlossaryTerms", () => {
  it("flags a known jargon acronym used in prose with no glossary entry", () => {
    const entries = [
      entry("problems", "src/content/problems/egr.json", {
        id: "egr",
        prose: {
          en: { title: "EGR passages coke up", summary: "The EGR system…" },
          es: { title: "EGR se tapa", summary: "El EGR…" },
        },
      }),
    ];

    const items = findUndefinedGlossaryTerms(entries);
    const egr = items.find((item) => item.entryId === "EGR");

    expect(egr).toBeDefined();
    // "EGR" appears once in each of title.en/summary.en/title.es/summary.es.
    expect(egr?.message).toContain("4 time(s)");
    expect(egr?.message).toContain("1 file(s)");
  });

  it("says nothing once the glossary defines the term as a canonical title", () => {
    const entries = [
      entry("glossary", "src/content/glossary/egr.json", {
        id: "egr",
        prose: {
          en: { title: "EGR", summary: "Exhaust gas recirculation." },
          es: { title: "EGR", summary: "Recirculación de gases de escape." },
        },
      }),
      entry("problems", "src/content/problems/egr.json", {
        id: "egr-problem",
        prose: {
          en: { title: "EGR passages coke up", summary: "…" },
          es: { title: "EGR se tapa", summary: "…" },
        },
      }),
    ];

    expect(
      findUndefinedGlossaryTerms(entries).some((item) => item.entryId === "EGR")
    ).toBe(false);
  });

  it("says nothing once the glossary defines the term as an alias", () => {
    const entries = [
      entry("glossary", "src/content/glossary/computadora.json", {
        id: "computadora",
        aliases: [{ locale: "es", term: "ECU" }],
        prose: {
          en: { title: "Engine control unit", summary: "…" },
          es: { title: "Computadora del motor", summary: "…" },
        },
      }),
      entry("problems", "src/content/problems/ecu.json", {
        id: "ecu-problem",
        prose: {
          en: { title: "ECU fails to communicate", summary: "…" },
          es: { title: "La ECU no responde", summary: "…" },
        },
      }),
    ];

    expect(
      findUndefinedGlossaryTerms(entries).some((item) => item.entryId === "ECU")
    ).toBe(false);
  });

  it("only scans prose, never ids or other data fields", () => {
    // `TSB` appears in the entry id and in `sources[].kind`, never in prose.
    const entries = [
      entry("problems", "src/content/problems/tsb-9001.json", {
        id: "tsb-9001-issue",
        sources: [{ kind: "TSB" }],
        prose: {
          en: { title: "A bulletin issue", summary: "Nothing acronymic here." },
          es: { title: "Un problema de boletín", summary: "Nada aquí." },
        },
      }),
    ];

    expect(
      findUndefinedGlossaryTerms(entries).some((item) => item.entryId === "TSB")
    ).toBe(false);
  });

  it("never flags a term the glossary itself is still writing", () => {
    // A glossary entry's own prose mentioning its own future title should not
    // count as "used elsewhere, undefined" — glossary entries are excluded.
    const entries = [
      entry("glossary", "src/content/glossary/vin.json", {
        id: "vin",
        prose: {
          en: { title: "VIN", summary: "The VIN is stamped on the frame." },
          es: { title: "VIN", summary: "El VIN está en el chasís." },
        },
      }),
    ];

    expect(
      findUndefinedGlossaryTerms(entries).some((item) => item.entryId === "VIN")
    ).toBe(false);
  });

  it("flags a standalone jargon acronym used as its own word", () => {
    // Paired with the next test: this is the positive case for the
    // word-boundary regex in findUndefinedGlossaryTerms — "PSI" appearing
    // on its own (surrounded by non-word characters) must be flagged.
    const entries = [
      entry("problems", "src/content/problems/psi-standalone.json", {
        id: "psi-standalone",
        prose: {
          en: {
            title: "Front tire pressure",
            summary: "Runs about 32 PSI cold.",
          },
          es: {
            title: "Presión de la llanta delantera",
            summary: "Anda en 32 PSI en frío.",
          },
        },
      }),
    ];

    expect(
      findUndefinedGlossaryTerms(entries).some((item) => item.entryId === "PSI")
    ).toBe(true);
  });

  it("does not treat a jargon acronym as used when it is only a substring of a longer word", () => {
    // "PSIG" (pounds per square inch gauge) is a real, distinct automotive
    // unit that legitimately appears in fuel-pressure specs. It contains
    // "PSI" as a literal substring, but that is not a use of the acronym
    // "PSI" — the regex must require a word boundary after the term, not
    // just match anywhere. Without `\b`, this would be a false positive.
    const entries = [
      entry("problems", "src/content/problems/psig-only.json", {
        id: "psig-only",
        prose: {
          en: {
            title: "Fuel pressure spec",
            summary: "The regulator holds 58 PSIG at idle.",
          },
          es: {
            title: "Especificación de presión de combustible",
            summary: "El regulador mantiene 58 PSIG en ralentí.",
          },
        },
      }),
    ];

    expect(
      findUndefinedGlossaryTerms(entries).some((item) => item.entryId === "PSI")
    ).toBe(false);
  });

  it("KNOWN_JARGON_TERMS is a real, non-empty curated list", () => {
    expect(KNOWN_JARGON_TERMS.length).toBeGreaterThan(0);
    expect(KNOWN_JARGON_TERMS).toContain("EGR");
  });

  it("counts every occurrence of a term repeated within a single string leaf, not just whether it appears", () => {
    // Regression for the `RegExp.test()`-derived count bug: a boolean "does
    // this leaf contain the term" can only ever add 1 per leaf, which
    // undercounts when the same term appears more than once in one string.
    // "EGR" appears three times in this single summary string.
    const entries = [
      entry("problems", "src/content/problems/egr-repeat.json", {
        id: "egr-repeat",
        prose: {
          en: {
            title: "EGR",
            summary:
              "The EGR valve sticks, the EGR passages coke up, and the " +
              "EGR cooler eventually clogs too.",
          },
          es: {
            title: "EGR",
            summary: "La válvula EGR se pega.",
          },
        },
      }),
    ];

    const egr = findUndefinedGlossaryTerms(entries).find(
      (item) => item.entryId === "EGR"
    );

    expect(egr).toBeDefined();
    // title.en (1) + summary.en (3) + title.es (1) + summary.es (1) = 6.
    expect(egr?.message).toContain("6 time(s)");
  });

  it("escapes regex metacharacters in a jargon term before building its matcher", () => {
    // No current KNOWN_JARGON_TERMS entry has a regex metacharacter. This
    // temporarily adds one with a `.` (real production risk the review
    // flagged: interpolating a term straight into `new RegExp` treats `.` as
    // "any character") to prove it is escaped rather than interpreted, and
    // restores the list afterward so no other test observes the mutation.
    KNOWN_JARGON_TERMS.push("A.B");
    try {
      const entries = [
        entry("problems", "src/content/problems/weird-term.json", {
          id: "weird-term",
          prose: {
            en: { title: "Uses A.B literally", summary: "A.B appears here." },
            es: {
              title: "Usa A.B literalmente",
              summary: "A.B aparece aquí.",
            },
          },
        }),
        entry("problems", "src/content/problems/would-false-match.json", {
          id: "would-false-match",
          prose: {
            // If "." were treated as "any character" instead of a literal
            // dot, this "AxB" would wrongly match `\bA.B\b` too. It must not
            // count towards A.B's occurrences.
            en: {
              title: "AxB is unrelated",
              summary: "Nothing to do with it.",
            },
            es: { title: "AxB no tiene relación", summary: "Nada que ver." },
          },
        }),
      ];

      expect(() => findUndefinedGlossaryTerms(entries)).not.toThrow();

      const item = findUndefinedGlossaryTerms(entries).find(
        (i) => i.entryId === "A.B"
      );
      expect(item).toBeDefined();
      // Only the literal "A.B" file counts (2 leaves: title.en, title.es,
      // summary.en, summary.es of the first entry = 4); "AxB" never matches.
      expect(item?.message).toContain("4 time(s)");
      expect(item?.message).toContain("1 file(s)");
    } finally {
      KNOWN_JARGON_TERMS.pop();
    }
  });
});

/* -------------------------------------------------------------------------
 * 6. Entries at anecdotal confidence older than 90 days
 * ---------------------------------------------------------------------- */

describe("findStaleAnecdotalEntries", () => {
  const now = new Date("2026-09-06T00:00:00Z");

  it("reports an anecdotal entry last touched more than 90 days ago", () => {
    const entries = [
      entry("problems", "src/content/problems/old.json", {
        id: "old",
        confidence: "anecdotal",
      }),
    ];
    const gitDate = () => new Date("2026-05-01T00:00:00Z");

    const items = findStaleAnecdotalEntries(entries, { now, gitDate });

    expect(items).toHaveLength(1);
    expect(items[0]?.message).toContain("anecdotal");
  });

  it("says nothing for an anecdotal entry touched within the window", () => {
    const entries = [
      entry("problems", "src/content/problems/fresh.json", {
        id: "fresh",
        confidence: "anecdotal",
      }),
    ];
    const gitDate = () => new Date("2026-09-01T00:00:00Z");

    expect(findStaleAnecdotalEntries(entries, { now, gitDate })).toEqual([]);
  });

  it("is exact at the ANECDOTAL_STALE_DAYS boundary", () => {
    const boundary = new Date(
      now.getTime() - ANECDOTAL_STALE_DAYS * 24 * 60 * 60 * 1000
    );
    const entries = [
      entry("problems", "src/content/problems/boundary.json", {
        id: "boundary",
        confidence: "anecdotal",
      }),
    ];

    expect(
      findStaleAnecdotalEntries(entries, {
        now,
        gitDate: () => boundary,
      })
    ).toHaveLength(1);
  });

  it("ignores entries at a stronger confidence tier", () => {
    const entries = [
      entry("problems", "src/content/problems/strong.json", {
        id: "strong",
        confidence: "fsm-confirmed",
      }),
    ];

    expect(
      findStaleAnecdotalEntries(entries, {
        now,
        gitDate: () => new Date("2020-01-01T00:00:00Z"),
      })
    ).toEqual([]);
  });

  it("says nothing when git has no history for the file", () => {
    const entries = [
      entry("problems", "src/content/problems/untracked.json", {
        id: "untracked",
        confidence: "anecdotal",
      }),
    ];

    expect(
      findStaleAnecdotalEntries(entries, { now, gitDate: () => null })
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 7. Dangling fixPaths[].parts / .procedures references
 * ---------------------------------------------------------------------- */

describe("findDanglingFixPathReferences", () => {
  it("reports a fix path part id naming no parts entry", () => {
    const entries = [
      entry("problems", "src/content/problems/leak.json", {
        id: "leak",
        fixPaths: [{ id: "replace-seal", parts: ["g3-seal"], procedures: [] }],
      }),
    ];

    const items = findDanglingFixPathReferences(entries);

    expect(items).toHaveLength(1);
    expect(items[0]?.message).toContain("g3-seal");
    expect(items[0]?.message).toContain("parts");
  });

  it("reports a fix path procedure id naming no procedures entry", () => {
    const entries = [
      entry("problems", "src/content/problems/leak.json", {
        id: "leak",
        fixPaths: [
          { id: "replace-seal", parts: [], procedures: ["g3-replace-seal"] },
        ],
      }),
    ];

    const items = findDanglingFixPathReferences(entries);

    expect(items).toHaveLength(1);
    expect(items[0]?.message).toContain("g3-replace-seal");
    expect(items[0]?.message).toContain("procedures");
  });

  it("says nothing once the named part and procedure both exist", () => {
    const entries = [
      entry("parts", "src/content/parts/g3-seal.json", { id: "g3-seal" }),
      entry("procedures", "src/content/procedures/g3-replace-seal.json", {
        id: "g3-replace-seal",
      }),
      entry("problems", "src/content/problems/leak.json", {
        id: "leak",
        fixPaths: [
          {
            id: "replace-seal",
            parts: ["g3-seal"],
            procedures: ["g3-replace-seal"],
          },
        ],
      }),
    ];

    expect(findDanglingFixPathReferences(entries)).toEqual([]);
  });

  it("reports one item per dangling id, not one per fix path", () => {
    const entries = [
      entry("problems", "src/content/problems/multi.json", {
        id: "multi",
        fixPaths: [
          { id: "a", parts: ["missing-1", "missing-2"], procedures: [] },
        ],
      }),
    ];

    expect(findDanglingFixPathReferences(entries)).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------
 * 8. Dead source links (mapping only — network audit itself is check:links')
 * ---------------------------------------------------------------------- */

describe("mapLinkWarningsToGapItems", () => {
  it("maps a check:links warning to a gap item", () => {
    const warnings = [
      {
        entry: { file: "src/content/reference/x.json", data: { id: "x" } },
        field: "sources[0].url",
        message: "src/content/reference/x.json: dead original, live archive",
      },
    ];

    const items = mapLinkWarningsToGapItems(warnings);

    expect(items).toEqual([
      {
        entryId: "x",
        file: "src/content/reference/x.json",
        message: "src/content/reference/x.json: dead original, live archive",
      },
    ]);
  });

  it("returns an empty list for no warnings", () => {
    expect(mapLinkWarningsToGapItems([])).toEqual([]);
  });

  it("also accepts check-links.mjs --json's on-disk shape (--link-audit)", () => {
    // No `entry` wrapper, no `data` — see `serializeLinkIssue` in
    // scripts/check-links.mjs. `entryId` is undefined here on purpose: the
    // on-disk shape never carried it.
    const warnings = [
      {
        file: "src/content/reference/y.json",
        field: "sources[0].url",
        message: "src/content/reference/y.json: dead original, live archive",
      },
    ];

    expect(mapLinkWarningsToGapItems(warnings)).toEqual([
      {
        entryId: undefined,
        file: "src/content/reference/y.json",
        message: "src/content/reference/y.json: dead original, live archive",
      },
    ]);
  });
});

describe("readLinkAuditWarnings", () => {
  // Regression coverage for the silent-fallback bug: a missing, unreadable,
  // malformed, or shape-mismatched --link-audit file must never collapse
  // into `{ warnings: [] }` — that reads downstream as "checked, zero dead
  // links found" when the truth is "could not check at all" (AGENTS.md: a
  // failure is not a zero).

  it("returns the warnings array on a well-formed check-links.mjs --json file", async () => {
    const readFileImpl = async () =>
      JSON.stringify({
        issues: [],
        warnings: [
          {
            file: "src/content/reference/y.json",
            field: "sources[0].url",
            message: "dead original, live archive",
          },
        ],
        offlineNotice: null,
      });

    const result = await readLinkAuditWarnings("fake-path.json", {
      readFileImpl,
    });

    expect(result.error).toBeNull();
    expect(result.warnings).toEqual([
      {
        file: "src/content/reference/y.json",
        field: "sources[0].url",
        message: "dead original, live archive",
      },
    ]);
  });

  it("reports an error (not an empty array) when the file cannot be read", async () => {
    const readFileImpl = async () => {
      throw Object.assign(new Error("ENOENT: no such file"), {
        code: "ENOENT",
      });
    };

    const result = await readLinkAuditWarnings("missing.json", {
      readFileImpl,
    });

    expect(result.warnings).toBeNull();
    expect(result.error).toMatch(/could not read/i);
  });

  it("reports an error (not an empty array) when the file is not valid JSON", async () => {
    const readFileImpl = async () => "{ not json ";

    const result = await readLinkAuditWarnings("malformed.json", {
      readFileImpl,
    });

    expect(result.warnings).toBeNull();
    expect(result.error).toMatch(/not valid json/i);
  });

  it("reports an error (not an empty array) when the parsed JSON has no warnings array", () => {
    const cases = [
      "{}",
      JSON.stringify({ issues: [] }),
      JSON.stringify({ warnings: "not-an-array" }),
      JSON.stringify(null),
      "[]",
    ];

    return Promise.all(
      cases.map(async (raw) => {
        const result = await readLinkAuditWarnings("shape-mismatch.json", {
          readFileImpl: async () => raw,
        });
        expect(result.warnings).toBeNull();
        expect(result.error).toMatch(/warnings.*array/i);
      })
    );
  });
});

/* -------------------------------------------------------------------------
 * buildGapsReport — assembling every category
 * ---------------------------------------------------------------------- */

describe("buildGapsReport", () => {
  const now = new Date("2026-09-06T00:00:00Z");

  it("marks dead-source-link unchecked when linkWarnings is not supplied", () => {
    const report = buildGapsReport([], { now });

    expect(report.categories["dead-source-link"]?.checked).toBe(false);
    expect(report.categories["dead-source-link"]?.count).toBe(0);
    expect(report.categories["dead-source-link"]?.items).toEqual([]);
  });

  it("includes dead-source-link findings when linkWarnings is supplied", () => {
    const report = buildGapsReport([], {
      now,
      linkWarnings: [
        {
          entry: { file: "src/content/reference/x.json", data: { id: "x" } },
          message: "dead original, live archive",
        },
      ],
    });

    expect(report.categories["dead-source-link"]?.checked).toBe(true);
    expect(report.categories["dead-source-link"]?.count).toBe(1);
  });

  it("totals every checked category's item count", () => {
    const entries = [
      entry("problems", "src/content/problems/no-fix.json", {
        id: "no-fix",
        fixPaths: [],
      }),
      entry("parts", "src/content/parts/bare.json", {
        id: "bare",
        fitment: { gens: ["gen3"] },
      }),
    ];

    const report = buildGapsReport(entries, { now });

    expect(report.totalCount).toBe(
      report.categories["no-fix-path"]!.count +
        report.categories["part-no-fitment"]!.count +
        report.categories["procedure-missing-torque-fluid"]!.count +
        report.categories["fitment-zero-coverage"]!.count +
        report.categories["undefined-glossary-term"]!.count +
        report.categories["stale-anecdotal"]!.count +
        report.categories["dangling-fix-path-reference"]!.count
    );
    expect(report.totalCount).toBe(2);
  });

  it("carries every documented category id", () => {
    const report = buildGapsReport([], { now });

    expect(Object.keys(report.categories).sort()).toEqual(
      [
        "no-fix-path",
        "part-no-fitment",
        "procedure-missing-torque-fluid",
        "fitment-zero-coverage",
        "undefined-glossary-term",
        "stale-anecdotal",
        "dangling-fix-path-reference",
        "dead-source-link",
      ].sort()
    );
  });

  it("is deterministic given the same inputs and injected clock", () => {
    const entries = [
      entry("problems", "src/content/problems/no-fix.json", {
        id: "no-fix",
        fixPaths: [],
      }),
    ];

    const first = buildGapsReport(entries, { now });
    const second = buildGapsReport(entries, { now });

    expect(first.categories).toEqual(second.categories);
  });
});
