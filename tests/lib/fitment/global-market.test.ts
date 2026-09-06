/**
 * Graders — `markets: ["global"]` is **not** a market restriction (T203a).
 *
 * ## The bug these grade
 *
 * `matchesVehicle` reads `fitment.markets` through `DIRECT_MATCH_FACETS`:
 *
 * ```ts
 * const allowed = query.facets.get(facet.field);
 * if (allowed === undefined) continue; // the fitment does not restrict it
 * ```
 *
 * The check is skipped only when the field is **entirely absent**, so a
 * present `markets: ["global"]` is compared literally against the visitor's
 * market and never equals `"us"`, `"cr"`, `"jdm"` or any other real selection.
 * `src/lib/fitment/index.ts`'s own docstring already states the intended
 * semantics — rule 1, quoting `src/schemas/vehicles.ts`: "`fitment.markets` is
 * optional in the base fitment shape, where omitting it correctly means 'no
 * market restriction'" — but **103 shipped entries** (89 of them
 * `markets: ["global"]` exactly, plus 14 that name `global` alongside a real
 * market) declare the field rather than omitting it, evidently reading
 * `"global"` as "applies everywhere". Every one of them currently reads as
 * "does not fit" the moment a reader picks a real market, which is the
 * expensive direction: the site tells an owner that the general-export torque
 * figure for their truck is not for them.
 *
 * **Owner ruling (2026-09-06):** fix the engine, not the 103 files. `"global"`
 * in a `markets` array resolves the same as omitting the field entirely.
 *
 * ## The decision this task makes, so T203b does not have to guess
 *
 * `["global", "us"]` — `global` alongside a real market — **is unrestricted
 * too. `"global"` is absorbing: any `markets` array that contains it is no
 * restriction at all, exactly as if the field were absent.** Four reasons, in
 * the order they carried weight:
 *
 * 1. **The ruling's own words.** "`global` *in* a `markets` array", not
 *    "`global` as the sole member of".
 * 2. **Set semantics.** Every `DIRECT_MATCH_FACETS` facet is a disjunction —
 *    a list of acceptable values. `"global"` denotes the universal market set,
 *    and a union with the universal set is the universal set. Any other
 *    reading makes one token's meaning depend on its neighbours, which is how
 *    a taxonomy stops being checkable.
 * 3. **The module's stated bias.** Decision (a) in the fitment docstring errs
 *    towards showing, because "hiding is the destructive answer … showing is
 *    recoverable in one click".
 * 4. **Real content agrees.** All 14 mixed entries use the extra id as an
 *    *addition*, never an exclusion — `gls`/`glx` are "the mid grade in
 *    Australia **and** the reference grade on the factory export sheet"
 *    (`["au", "global"]`), `option-code-gen3-transmission-v5a51` is in the
 *    general-export chassis manual **and** printed in the North American
 *    manuals (`["global", "us"]`). The four `g4-*` problems and the
 *    generation entries list every market their generation was sold in *plus*
 *    `global`: exhaustive enumerations, not exclusions.
 *
 * **The cost, stated plainly:** "everywhere except X" is no longer expressible
 * as `["global", …]`. Express it by listing the real markets and **omitting**
 * `"global"`. `tests/lib/fitment/global-market-content.test.ts` carries a
 * ratchet over today's 14 mixed entries so the next author of one is made to
 * read this paragraph.
 *
 * ## What is deliberately NOT changed
 *
 * - **`"global"` on the *selection* side stays literal.** A visitor who picks
 *   "general export" has picked one scope, not all of them; a `markets: ["us"]`
 *   fitment does not match them. The bug is in how a *fitment* names markets.
 * - **Combination scoping stays literal.** `combos-gen4-global` records the
 *   general-export offering list; it must not start answering for `gen4 × cr`,
 *   because VEH-03 rule 3 ("no entry at all is *unknown*, never impossible")
 *   is the honest answer there and a partial list from another scope is not.
 * - **No other facet gains an absorbing value.** `trims: ["global"]` is an
 *   unknown trim id, not a wildcard.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker, one line per test. T203b activates a grader by
 * deleting exactly that `.fails`, changing nothing else. A test with no marker
 * passes today and must keep passing: those are this file's positive controls,
 * and several of them exist specifically to catch a *too-broad* fix (an
 * implementation that strips `"global"` from every facet, or that turns
 * `markets: []` into "unrestricted", goes red on them).
 *
 * refs specs/001-foundation (FIT-01, FIT-03, FIT-04, FIT-02)
 */
import { describe, expect, it } from "vitest";

import {
  MARKETS,
  type Market,
} from "../../../src/schemas/vehicle-vocabulary.ts";
import {
  OPTIONAL_SELECTION_FACETS,
  buildTaxonomy,
  classifyCombination,
  entryAppliesTo,
  matchesVehicle,
  provisionalMatchFacets,
  validateEntryFitments,
  type Taxonomy,
  type VehicleSelection,
} from "../../../src/lib/fitment/index.ts";
import {
  makeFitmentEntry,
  makeSyntheticTaxonomyEntries,
  readVehicleEntries,
  type ContentEntry,
} from "../../fixtures/fitment-fixtures.ts";

/**
 * Every market a person can actually own a truck in — `MARKETS` less the
 * `"global"` pseudo-market. This is the domain of every table below, so it is
 * asserted non-empty before anything reads it: an empty `it.each` table is a
 * suite that reports green having graded nothing.
 */
const REAL_MARKETS: readonly Market[] = MARKETS.filter(
  (market) => market !== "global"
);

if (REAL_MARKETS.length === 0) {
  throw new Error(
    "MARKETS contains nothing but `global` — the T203a tables would be empty"
  );
}

const realTaxonomy = buildTaxonomy(readVehicleEntries());

/** Gitana Blanca as FIT-03 lets a visitor describe her: the quadruple only. */
const GITANA: VehicleSelection = {
  gen: "gen3",
  market: "us",
  year: 2002,
  engine: "6g74-sohc",
};

const inMarket = (market: string): VehicleSelection => ({ ...GITANA, market });

/** The two spellings the ruling says must answer identically. */
const GLOBAL_ONLY = { gens: ["gen3"], markets: ["global"] } as const;
const MARKETS_OMITTED = { gens: ["gen3"] } as const;

/* -------------------------------------------------------------------------
 * 0. The vocabulary the whole file stands on
 * ---------------------------------------------------------------------- */

describe("the market vocabulary these graders read", () => {
  it("carries `global` alongside real markets (spec §2)", () => {
    expect(MARKETS).toContain("global");
    expect(REAL_MARKETS.length).toBeGreaterThanOrEqual(7);
    expect(REAL_MARKETS).not.toContain("global");
  });

  it("has a `global` market entry in the real taxonomy, so it is a legal id", () => {
    // If this ever stops being true, `markets: ["global"]` would be an
    // `unknown-id` build error and this whole file would be grading a fiction.
    const issues = validateEntryFitments(
      [makeFitmentEntry({ ...GLOBAL_ONLY })],
      realTaxonomy
    );
    expect(issues.filter((issue) => issue.code === "unknown-id")).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 1. The rule: `markets: ["global"]` is no restriction
 * ---------------------------------------------------------------------- */

describe('`markets: ["global"]` matches every real market (FIT-04)', () => {
  it.fails.each(REAL_MARKETS)(
    "a global-market fitment fits a %s truck",
    (market) => {
      expect(
        matchesVehicle({ ...GLOBAL_ONLY }, inMarket(market), realTaxonomy),
        `a \`markets: ["global"]\` fitment did not fit a ${market} truck`
      ).toBe(true);
    }
  );

  it.fails.each(REAL_MARKETS)(
    "answers identically to omitting `markets` for %s",
    (market) => {
      const vehicle = inMarket(market);
      expect(
        matchesVehicle({ ...GLOBAL_ONLY }, vehicle, realTaxonomy),
        "`global` and an omitted `markets` gave different answers"
      ).toBe(matchesVehicle({ ...MARKETS_OMITTED }, vehicle, realTaxonomy));
    }
  );

  // Positive controls — both pass today, and are what tells a red run above
  // apart from a broken fixture, a broken taxonomy, or a broken import.
  it.each(REAL_MARKETS)(
    "control: an omitted `markets` already fits a %s truck",
    (market) => {
      expect(
        matchesVehicle({ ...MARKETS_OMITTED }, inMarket(market), realTaxonomy)
      ).toBe(true);
    }
  );

  it("control: a global-market fitment already fits a `global` selection", () => {
    expect(
      matchesVehicle({ ...GLOBAL_ONLY }, inMarket("global"), realTaxonomy)
    ).toBe(true);
  });

  it("control: the same fitment misses on a facet that is genuinely wrong", () => {
    // Same fitment, wrong generation. Proves the tables above fail on the
    // market comparison and not because `matchesVehicle` answers `false` to
    // everything the fixture hands it.
    expect(
      matchesVehicle(
        { ...GLOBAL_ONLY },
        { ...GITANA, gen: "gen1", market: "global" },
        realTaxonomy
      )
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * 2. `global` is absorbing — the decision, graded
 * ---------------------------------------------------------------------- */

/** Both orderings, because a fix that only reads `markets[0]` is a fix. */
const MIXED_SPELLINGS: readonly (readonly string[])[] = [
  ["global", "us"],
  ["us", "global"],
  ["au", "global"],
  ["global", "cr", "uk"],
];

/**
 * The mixed table has to be split by whether the market is **literally
 * listed**, because the two halves are in different states today and lumping
 * them together makes the suite lie in both directions.
 *
 * A `["global", "us"]` fitment already fits a `us` truck — `"us"` is right
 * there in the array — so marking that row `it.fails` reports "Expect test to
 * fail" and turns a genuine pass into a red run. Only the rows naming a market
 * the array does *not* contain are the ones the absorbing rule has to win, and
 * those are the only rows that may carry the marker. The listed half stays
 * unmarked and is this section's positive control.
 */
const MIXED_CASES = MIXED_SPELLINGS.flatMap((markets) =>
  REAL_MARKETS.map((market) => ({
    markets,
    market,
    listed: markets.includes(market),
  }))
);

const MIXED_UNLISTED = MIXED_CASES.filter((row) => !row.listed);
const MIXED_LISTED = MIXED_CASES.filter((row) => row.listed);

if (MIXED_UNLISTED.length === 0 || MIXED_LISTED.length === 0) {
  throw new Error(
    "the T203a mixed-market table partitioned to empty — one half of the " +
      "listed/unlisted split would grade nothing"
  );
}

describe("`global` alongside a real market is still unrestricted", () => {
  it.fails.each(MIXED_UNLISTED)(
    "$markets fits a $market truck it does not name",
    ({ markets, market }) => {
      expect(
        matchesVehicle(
          { gens: ["gen3"], markets: [...markets] },
          inMarket(market),
          realTaxonomy
        ),
        `\`markets: ${JSON.stringify(markets)}\` did not fit a ${market} truck`
      ).toBe(true);
    }
  );

  it.each(MIXED_LISTED)(
    "control: $markets already fits the $market truck it does name",
    ({ markets, market }) => {
      expect(
        matchesVehicle(
          { gens: ["gen3"], markets: [...markets] },
          inMarket(market),
          realTaxonomy
        )
      ).toBe(true);
    }
  );

  it.fails("reads the same as omitting `markets`, in every real market", () => {
    for (const markets of MIXED_SPELLINGS) {
      for (const market of REAL_MARKETS) {
        const vehicle = inMarket(market);
        expect(
          matchesVehicle(
            { gens: ["gen3"], markets: [...markets] },
            vehicle,
            realTaxonomy
          ),
          `${JSON.stringify(markets)} disagreed with an omitted \`markets\` ` +
            `for ${market}`
        ).toBe(matchesVehicle({ ...MARKETS_OMITTED }, vehicle, realTaxonomy));
      }
    }
  });

  it("control: a mixed list without `global` restricts normally", () => {
    // The dominance rule is about the token `global`, not about long lists.
    const fitment = { gens: ["gen3"], markets: ["us", "cr"] };
    expect(matchesVehicle(fitment, inMarket("us"), realTaxonomy)).toBe(true);
    expect(matchesVehicle(fitment, inMarket("cr"), realTaxonomy)).toBe(true);
    expect(matchesVehicle(fitment, inMarket("jdm"), realTaxonomy)).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * 3. What must NOT move — the fix has to stay a market fix
 * ---------------------------------------------------------------------- */

describe("`markets` still restricts everything else (no over-broad fix)", () => {
  it("a single-market fitment still excludes another market", () => {
    expect(
      matchesVehicle(
        { gens: ["gen3"], markets: ["us"] },
        inMarket("cr"),
        realTaxonomy
      )
    ).toBe(false);
  });

  it("an EMPTY `markets` list still matches nothing", () => {
    // The trap for a fix written as `values.filter(v => v !== "global")`: an
    // array that empties out must not become "unrestricted". `readFitment`
    // already reads a present-but-unusable facet as a restriction nothing
    // satisfies, and that reading is load-bearing.
    for (const market of [...REAL_MARKETS, "global"]) {
      expect(
        matchesVehicle(
          { gens: ["gen3"], markets: [] },
          inMarket(market),
          realTaxonomy
        ),
        `an empty \`markets\` list matched a ${market} truck`
      ).toBe(false);
    }
  });

  it("a `global` SELECTION is still one scope, not all of them", () => {
    // The fitment names the US market; the visitor picked general export.
    // That is a miss, and stays a miss: this fix is fitment-side only.
    expect(
      matchesVehicle(
        { gens: ["gen3"], markets: ["us"] },
        inMarket("global"),
        realTaxonomy
      )
    ).toBe(false);
  });

  it("no OTHER facet gains an absorbing `global` value", () => {
    // A fix that strips `"global"` from every facet list rather than from
    // `markets` alone turns each of these into a wildcard.
    expect(
      matchesVehicle(
        { gens: ["gen3"], trims: ["global"] },
        { ...GITANA, trim: "gls" },
        realTaxonomy
      ),
      '`trims: ["global"]` behaved as a wildcard'
    ).toBe(false);
    expect(
      matchesVehicle(
        { gens: ["gen3"], engines: ["global"] },
        GITANA,
        realTaxonomy
      ),
      '`engines: ["global"]` behaved as a wildcard'
    ).toBe(false);
    expect(
      matchesVehicle(
        { gens: ["gen3"], transferCases: ["global"] },
        { ...GITANA, transferCase: "super-select-ii" },
        realTaxonomy
      ),
      '`transferCases: ["global"]` behaved as a wildcard'
    ).toBe(false);
  });

  it("a `global` combination scope still answers only for itself (VEH-03)", () => {
    // `combos-gen4-global` is a *record of one offering list*, not a fact that
    // travels. A Costa Rican Gen 4 scope has no entry, so it is `unknown` —
    // never `existed` borrowed from the export sheet, never `impossible`.
    expect(
      classifyCombination(
        { gen: "gen4", market: "cr", year: 2018, engine: "6g75" },
        realTaxonomy
      )
    ).toBe("unknown");
    expect(
      classifyCombination(
        { gen: "gen4", market: "global", year: 2018, engine: "6g75" },
        realTaxonomy
      )
    ).toBe("existed");
  });
});

/* -------------------------------------------------------------------------
 * 4. `entryAppliesTo` answers exactly as `matchesVehicle` does (FIT-04)
 * ---------------------------------------------------------------------- */

describe("entryAppliesTo carries the same rule", () => {
  const entry = makeFitmentEntry({ ...GLOBAL_ONLY }, "test-fitment-global");

  it.fails.each(REAL_MARKETS)(
    "a global entry applies to a %s truck",
    (market) => {
      expect(entryAppliesTo(entry, inMarket(market), realTaxonomy)).toBe(true);
    }
  );

  it.fails("agrees with matchesVehicle on every real market", () => {
    for (const market of REAL_MARKETS) {
      const vehicle = inMarket(market);
      const viaEntry = entryAppliesTo(entry, vehicle, realTaxonomy);
      expect(viaEntry, `entryAppliesTo disagreed for ${market}`).toBe(
        matchesVehicle(entry.fitment, vehicle, realTaxonomy)
      );
      expect(viaEntry).toBe(true);
    }
  });

  it("control: an entry with no fitment at all still applies to nobody", () => {
    expect(
      entryAppliesTo({ id: "test-fitment-bare" }, GITANA, realTaxonomy)
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * 5. A global match is a FULL match, not a provisional one (T204 / F8)
 * ---------------------------------------------------------------------- */

describe("the provisional indicator does not fire on a global fitment", () => {
  it("control: `market` is not an optional selection facet", () => {
    // The structural reason a global fitment can never read as provisional:
    // FIT-03 makes market part of the required quadruple, so a fitment that
    // restricts markets never leans on a question the visitor left unanswered.
    expect(OPTIONAL_SELECTION_FACETS).not.toContain("market");
    expect(OPTIONAL_SELECTION_FACETS).toContain("transferCase");
  });

  it.fails(
    "a global-market fitment matches FULLY, with nothing provisional",
    () => {
      const fitment = { ...GLOBAL_ONLY };
      expect(
        matchesVehicle(fitment, GITANA, realTaxonomy),
        "the global fitment did not match at all, so `[]` below means nothing"
      ).toBe(true);
      expect(provisionalMatchFacets(fitment, GITANA, realTaxonomy)).toEqual([]);
    }
  );

  it.fails(
    "reports only the genuinely unanswered facet beside a global market",
    () => {
      const fitment = {
        gens: ["gen3"],
        markets: ["global"],
        transferCases: ["super-select-ii"],
      };
      expect(matchesVehicle(fitment, GITANA, realTaxonomy)).toBe(true);
      // `market` is answered; `transferCase` is not. Only the second is why the
      // match is provisional.
      expect(provisionalMatchFacets(fitment, GITANA, realTaxonomy)).toEqual([
        "transferCase",
      ]);
    }
  );

  it("control: a real-market fitment already matches fully today", () => {
    const fitment = { gens: ["gen3"], markets: ["us"] };
    expect(matchesVehicle(fitment, GITANA, realTaxonomy)).toBe(true);
    expect(provisionalMatchFacets(fitment, GITANA, realTaxonomy)).toEqual([]);
  });

  it("control: `provisionalMatchFacets` reports [] for a row that does not fit", () => {
    // Which is why the two markers above assert the match *first*: `[]` alone
    // is ambiguous between "full match" and "no match".
    expect(
      provisionalMatchFacets(
        { gens: ["gen3"], markets: ["cr"], transferCases: ["super-select-ii"] },
        GITANA,
        realTaxonomy
      )
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 6. The boundary years still bite (FIT-04's named hard case)
 * ---------------------------------------------------------------------- */

describe("1999 Gen 2.5 / Gen 3 overlap, with a global market", () => {
  const gen25Global = {
    gens: ["gen2-5"],
    markets: ["global"],
    years: { from: 1997, to: 1999 },
  };
  const gen25Omitted = { gens: ["gen2-5"], years: { from: 1997, to: 1999 } };

  it.fails.each(REAL_MARKETS)(
    "a 1999 Gen 2.5 %s truck fits the global-market fitment",
    (market) => {
      expect(
        matchesVehicle(
          gen25Global,
          { gen: "gen2-5", market, year: 1999, engine: "6g74-sohc" },
          realTaxonomy
        )
      ).toBe(true);
    }
  );

  it("the year window still excludes a 2000 truck, global or not", () => {
    const vehicle = {
      gen: "gen2-5",
      market: "us",
      year: 2000,
      engine: "6g74-sohc",
    };
    expect(matchesVehicle(gen25Omitted, vehicle, realTaxonomy)).toBe(false);
    expect(matchesVehicle(gen25Global, vehicle, realTaxonomy)).toBe(
      matchesVehicle(gen25Omitted, vehicle, realTaxonomy)
    );
  });

  it("the generation rule still bites: gen2-5 does not expand upwards", () => {
    const vehicle = {
      gen: "gen2",
      market: "us",
      year: 1999,
      engine: "6g74-sohc",
    };
    expect(matchesVehicle(gen25Omitted, vehicle, realTaxonomy)).toBe(false);
    expect(matchesVehicle(gen25Global, vehicle, realTaxonomy)).toBe(false);
  });

  it.fails("a global Gen 2 fitment still reaches a 1999 Gen 2.5 truck", () => {
    // `parentGeneration` expands downwards; the market fix must not touch it.
    expect(
      matchesVehicle(
        { gens: ["gen2"], markets: ["global"] },
        { gen: "gen2-5", market: "jdm", year: 1999, engine: "6g74-sohc" },
        realTaxonomy
      )
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * 7. Build-time validation (FIT-02) — same equivalence, same gate
 * ---------------------------------------------------------------------- */

/**
 * A synthetic taxonomy with a market node for every id in `MARKETS`, so a
 * fitment naming any of them resolves. Built on T202's fixture set, which
 * supplies the generations and the invented powertrain ids; only the market
 * nodes are added here, because `makeSyntheticTaxonomyEntries` deliberately
 * carries just `us` and `cr`.
 */
function marketNodes(): ContentEntry[] {
  const known = new Set(["us", "cr"]);
  return MARKETS.filter((market) => !known.has(market)).map((market) => ({
    id: market,
    kind: "market",
    fitment: { gens: ["gen2", "gen2-5", "gen3"], markets: [market] },
    confidence: "community-consensus",
    sources: [
      {
        title: "TEST fixture source — not a real document",
        url: "https://example.invalid/t203a-global/source",
        archiveUrl:
          "https://web.archive.org/web/20260101000000/" +
          "https://example.invalid/t203a-global/source",
        accessed: "2026-09-06",
        kind: "reference",
      },
    ],
    prose: {
      en: { title: `TEST market ${market}`, summary: "Synthetic market node." },
      es: {
        title: `TEST market ${market}`,
        summary: "Nodo de mercado sintético.",
      },
    },
  }));
}

/** One `coverage: "complete"` combination entry, invented powertrain and all. */
function completeCombination(market: string, engine: string): ContentEntry {
  return {
    id: `combos-gen3-${market}`,
    kind: "combination",
    fitment: { gens: ["gen3"], markets: [market] },
    generation: "gen3",
    market,
    coverage: "complete",
    offerings: [
      {
        years: { from: 1999, to: 2006 },
        engine,
        transmission: "test-gearbox-alpha",
        transferCase: "test-tcase-alpha",
      },
    ],
    confidence: "community-consensus",
    sources: [],
    prose: {
      en: { title: "TEST combos", summary: "Synthetic combination entry." },
      es: {
        title: "TEST combos",
        summary: "Entrada de combinación sintética.",
      },
    },
  };
}

/** `combos-gen3-us` in T202's fixtures is `complete`; drop it where it collides. */
function withoutRealisedScopes(entries: ContentEntry[]): ContentEntry[] {
  return entries.filter((entry) => entry.kind !== "combination");
}

const UNLISTED_ENGINE = "test-engine-beta";

describe("validateEntryFitments treats a global market as unrestricted (FIT-02)", () => {
  /**
   * The scope that is `complete` is `global`; `us` is honestly `partial`.
   * Today the validator looks only at the literal `global` scope, finds a
   * closed list without the engine, and **fails the build** on a fitment that
   * names a perfectly possible truck.
   */
  const narrowTaxonomy: Taxonomy = buildTaxonomy([
    ...withoutRealisedScopes(makeSyntheticTaxonomyEntries()),
    ...marketNodes(),
    completeCombination("global", "test-engine-alpha"),
    {
      ...completeCombination("us", "test-engine-alpha"),
      coverage: "partial",
    },
  ]);

  const impossibleShape = {
    gens: ["gen3"],
    engines: [UNLISTED_ENGINE],
  };

  it.fails(
    "does not report `impossible-combination` on a global fitment that is possible elsewhere",
    () => {
      const issues = validateEntryFitments(
        [makeFitmentEntry({ ...impossibleShape, markets: ["global"] })],
        narrowTaxonomy
      );
      expect(
        issues.map((issue) => issue.code),
        "a global-market fitment was called impossible on the strength of one scope"
      ).toEqual([]);
    }
  );

  it("control: the same fitment with `markets` omitted reports nothing", () => {
    expect(
      validateEntryFitments(
        [makeFitmentEntry({ ...impossibleShape })],
        narrowTaxonomy
      )
    ).toEqual([]);
  });

  /**
   * The mirror case: every market's list is closed and none of them lists the
   * engine, so the fitment really does name no vehicle that ever existed. The
   * gate must still fire — a fix that made `markets: ["global"]` unrestricted
   * by *dropping the scope loop* would turn this green and disable FIT-02's
   * second failure class for 89 entries.
   */
  const closedTaxonomy: Taxonomy = buildTaxonomy([
    ...withoutRealisedScopes(makeSyntheticTaxonomyEntries()),
    ...marketNodes(),
    ...MARKETS.map((market) =>
      completeCombination(market, "test-engine-alpha")
    ),
  ]);

  it("still reports `impossible-combination` when EVERY market's list is closed", () => {
    const issues = validateEntryFitments(
      [makeFitmentEntry({ ...impossibleShape, markets: ["global"] })],
      closedTaxonomy
    );
    expect(issues.map((issue) => issue.code)).toEqual([
      "impossible-combination",
    ]);
  });

  it("control: the omitted-`markets` spelling reports the same issue", () => {
    expect(
      validateEntryFitments(
        [makeFitmentEntry({ ...impossibleShape })],
        closedTaxonomy
      ).map((issue) => issue.code)
    ).toEqual(["impossible-combination"]);
  });

  it("still reports `unknown-id` for a bogus market beside `global`", () => {
    // `global` is not a licence to stop resolving the ids around it.
    const issues = validateEntryFitments(
      [
        makeFitmentEntry({
          gens: ["gen3"],
          markets: ["global", "narnia"],
        }),
      ],
      closedTaxonomy
    );
    expect(issues.map((issue) => issue.code)).toEqual(["unknown-id"]);
    expect(issues[0]?.path).toEqual(["fitment", "markets", 1]);
  });

  it("still reports `year-outside-production` for a global fitment", () => {
    const issues = validateEntryFitments(
      [
        makeFitmentEntry({
          gens: ["gen3"],
          markets: ["global"],
          years: { from: 1960, to: 1970 },
        }),
      ],
      closedTaxonomy
    );
    expect(issues.map((issue) => issue.code)).toEqual([
      "year-outside-production",
    ]);
  });
});
