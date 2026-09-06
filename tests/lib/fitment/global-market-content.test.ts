/**
 * Graders — the `markets: ["global"]` rule against the **real shipped
 * corpus** (T203a).
 *
 * ## Why a second file, and why real content
 *
 * `tests/lib/fitment/global-market.test.ts` grades the rule on fixtures. This
 * file grades it on the 103 entries that actually declare `global` today,
 * because that is the whole reason the bug matters: the ruling is "fix the
 * engine, not the files", and the only way that ruling is proven is by showing
 * the engine unbreaks *those files*. A fix that satisfies a synthetic
 * `{ gens: ["gen3"], markets: ["global"] }` and still hides
 * `fluid-gen3-brake-fluid` from a Costa Rican Gen 3 owner has fixed nothing
 * anybody reads.
 *
 * Today the corpus splits:
 *
 * | shape                         | count | example                                       |
 * |-------------------------------|-------|-----------------------------------------------|
 * | `markets: ["global"]` exactly | 89    | `torque-gen3-wheel-nut`, `fsm-gen3-11-engine`  |
 * | `global` + a real market      | 14    | `gls` (`["au","global"]`), `option-code-gen3-transmission-v5a51` (`["global","us"]`) |
 *
 * Both shapes read as **unrestricted** under the decision recorded in the
 * sibling file's header ("`global` is absorbing"). The property graded here is
 * the one the owner's ruling states directly: for every affected entry and
 * every market its generations were sold in, the entry answers **exactly as it
 * would with `markets` omitted**.
 *
 * ## How the selection for each entry is built
 *
 * Derived from the entry's own fitment, never guessed: the generation comes
 * from `fitment.gens`, the market from that generation's `marketNames` (the
 * markets the selector actually offers for it — `src/lib/vehicle-options.ts`),
 * the year from `fitment.years.from` when the entry states a window, and the
 * engine from `fitment.engines[0]` when the entry restricts engines. Every
 * *optional* selection facet is deliberately left unstated, so decision (a)
 * ("an absent selection facet is not a constraint") waves them through and the
 * **only** facet that can decide the answer is `markets`. That is what makes a
 * red row here mean "the market comparison is wrong" and nothing else — and
 * the `global`-selection control below is the proof, since it exercises the
 * identical selection with one field changed.
 *
 * ## Expected-failure convention
 *
 * `it.fails` marks a grader T203b activates by deleting exactly that `.fails`.
 * Unmarked tests pass today and must keep passing. The `it.fails` tables are
 * built from the *content*, never from what the engine currently answers, so
 * activation does not silently empty one of them.
 *
 * refs specs/001-foundation (FIT-01, FIT-03, FIT-04)
 */
import { describe, expect, it } from "vitest";

import { MARKETS } from "../../../src/schemas/vehicle-vocabulary.ts";
import {
  buildTaxonomy,
  entryAppliesTo,
  type VehicleSelection,
} from "../../../src/lib/fitment/index.ts";
import {
  readAllContentEntries,
  readVehicleEntries,
  type ContentEntry,
} from "../../fixtures/fitment-fixtures.ts";

const vehicleEntries = readVehicleEntries();
const taxonomy = buildTaxonomy(vehicleEntries);

/* -------------------------------------------------------------------------
 * Reading the corpus
 * ---------------------------------------------------------------------- */

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : [];
}

const generations = vehicleEntries.filter(
  (entry) => entry.kind === "generation"
);

/** The real markets a generation entry says it was sold in, `global` aside. */
const marketsByGeneration = new Map<string, readonly string[]>(
  generations.map((entry) => [
    String(entry.id),
    (Array.isArray(entry["marketNames"]) ? entry["marketNames"] : [])
      .flatMap((row) =>
        typeof row === "object" && row !== null && "market" in row
          ? [String((row as { market: unknown }).market)]
          : []
      )
      .filter((market) => market !== "global"),
  ])
);

const productionFrom = new Map<string, number>(
  generations.flatMap((entry) => {
    const production = entry["production"];
    const from =
      typeof production === "object" &&
      production !== null &&
      typeof (production as { from?: unknown }).from === "number"
        ? (production as { from: number }).from
        : null;
    return from === null ? [] : [[String(entry.id), from] as [string, number]];
  })
);

interface AffectedEntry {
  readonly id: string;
  readonly entry: ContentEntry;
  readonly markets: readonly string[];
  /** Every (generation, real market) selection this entry's fitment names. */
  readonly selections: readonly VehicleSelection[];
  /** The same entry with `markets` removed — the spelling the ruling equates it to. */
  readonly withoutMarkets: ContentEntry;
}

function selectionsFor(entry: ContentEntry): VehicleSelection[] {
  const fitment = entry.fitment ?? {};
  const years = fitment["years"];
  const from =
    typeof years === "object" &&
    years !== null &&
    typeof (years as { from?: unknown }).from === "number"
      ? (years as { from: number }).from
      : null;
  const engine = stringList(fitment["engines"])[0] ?? "6g74-sohc";

  return stringList(fitment["gens"]).flatMap((gen) =>
    (marketsByGeneration.get(gen) ?? []).map((market) => ({
      gen,
      market,
      year: from ?? productionFrom.get(gen) ?? 2002,
      engine,
    }))
  );
}

function withoutMarkets(entry: ContentEntry): ContentEntry {
  const fitment: Record<string, unknown> = { ...(entry.fitment ?? {}) };
  delete fitment["markets"];
  return { ...entry, fitment };
}

const AFFECTED: readonly AffectedEntry[] = readAllContentEntries()
  .filter((entry) => stringList(entry.fitment?.["markets"]).includes("global"))
  .map((entry) => ({
    id: String(entry.id),
    entry,
    markets: stringList(entry.fitment?.["markets"]),
    selections: selectionsFor(entry),
    withoutMarkets: withoutMarkets(entry),
  }));

/**
 * A loader that finds nothing must not read as "nothing is broken". Thrown at
 * module scope on purpose: an empty corpus is reported as a file-level error,
 * not as a hundred quietly-passing `it.fails` markers.
 */
if (AFFECTED.length < 80) {
  throw new Error(
    `only ${AFFECTED.length} entries declaring \`markets: ["global"]\` were ` +
      `read from src/content/ — expected ~103. The corpus reader is broken, ` +
      `or the content moved; either way these graders are grading nothing.`
  );
}

/** `markets: ["global"]` and nothing else — the 89 the ruling is about. */
const GLOBAL_ONLY = AFFECTED.filter((row) => row.markets.length === 1);

/** `global` beside a real market id — the case T203a had to decide. */
const MIXED = AFFECTED.filter((row) => row.markets.length > 1);

/**
 * The mixed entries that actually discriminate: those naming a generation
 * that was sold in a market the entry does **not** list. Partitioned by the
 * content's own shape, not by what the engine answers, so this table is the
 * same before and after T203b.
 */
const MIXED_WITH_UNLISTED = MIXED.filter((row) =>
  row.selections.some((selection) => !row.markets.includes(selection.market))
);

if (GLOBAL_ONLY.length === 0 || MIXED_WITH_UNLISTED.length === 0) {
  throw new Error(
    "the T203a corpus tables partitioned to empty — an `it.each` over an " +
      "empty table grades nothing"
  );
}

/* -------------------------------------------------------------------------
 * 1. The corpus is what these graders think it is
 * ---------------------------------------------------------------------- */

describe("the shipped entries this rule is about", () => {
  it('finds the ~89 `markets: ["global"]` entries the ruling names', () => {
    expect(GLOBAL_ONLY.length).toBeGreaterThanOrEqual(85);
    expect(AFFECTED.length).toBeGreaterThan(GLOBAL_ONLY.length);
  });

  it("gives every affected entry at least one real-market selection", () => {
    // An entry with no selection would assert nothing and pass — the empty
    // -table failure `.claude/GRADER-PRINCIPLES.md` names.
    const barren = AFFECTED.filter((row) => row.selections.length === 0);
    expect(
      barren.map((row) => row.id),
      "these entries name no market any generation of theirs was sold in"
    ).toEqual([]);
  });

  it("names only markets in the closed vocabulary", () => {
    for (const row of AFFECTED) {
      for (const market of row.markets) {
        expect(MARKETS, `${row.id} names \`${market}\``).toContain(market);
      }
    }
  });
});

/* -------------------------------------------------------------------------
 * 2. The rule, on real data
 * ---------------------------------------------------------------------- */

describe("every shipped global-market entry fits the trucks it names", () => {
  it.fails.each(GLOBAL_ONLY)(
    "$id fits a truck in every market it names",
    (row) => {
      const missed = row.selections.filter(
        (selection) => !entryAppliesTo(row.entry, selection, taxonomy)
      );
      expect(
        missed.map((selection) => `${selection.gen}/${selection.market}`),
        `${row.id} (markets ${JSON.stringify(row.markets)}) did not fit`
      ).toEqual([]);
    }
  );

  it.fails("the whole corpus, as one number", () => {
    const misses = AFFECTED.flatMap((row) =>
      row.selections
        .filter((selection) => !entryAppliesTo(row.entry, selection, taxonomy))
        .map((selection) => `${row.id} @ ${selection.gen}/${selection.market}`)
    );
    expect(
      misses.length,
      `${misses.length} (entry, market) pairs read as "does not fit". ` +
        `First ten: ${misses.slice(0, 10).join(", ")}`
    ).toBe(0);
  });

  it.fails.each(GLOBAL_ONLY)(
    "$id answers exactly as it would with `markets` omitted",
    (row) => {
      // The ruling in one assertion: the two spellings are the same fitment.
      const divergent = row.selections.filter(
        (selection) =>
          entryAppliesTo(row.entry, selection, taxonomy) !==
          entryAppliesTo(row.withoutMarkets, selection, taxonomy)
      );
      expect(
        divergent.map((selection) => `${selection.gen}/${selection.market}`),
        `${row.id} answered differently from its omitted-\`markets\` twin`
      ).toEqual([]);
    }
  );

  /**
   * The control that gives the markers above their meaning. Same entry, same
   * generation, same year, same engine — one field different. It passes
   * today, so a red row above is the market comparison and cannot be a
   * malformed selection, a year window, an engine restriction, or a fitment
   * the reader failed to parse.
   */
  it.each(AFFECTED)(
    "control: $id already fits the identical truck in the `global` market",
    (row) => {
      const missed = row.selections.filter(
        (selection) =>
          !entryAppliesTo(
            row.entry,
            { ...selection, market: "global" },
            taxonomy
          )
      );
      expect(
        missed.map((selection) => `${selection.gen}/global`),
        `${row.id} does not fit even a general-export truck — the selection ` +
          `built for it is wrong, not the engine`
      ).toEqual([]);
    }
  );

  it("control: a market restriction still hides an entry from another market", () => {
    // Proof that `entryAppliesTo` can still answer `false` in this file.
    expect(
      entryAppliesTo(
        {
          id: "test-fitment-us-only",
          fitment: { gens: ["gen3"], markets: ["us"] },
        },
        { gen: "gen3", market: "cr", year: 2002, engine: "6g74-sohc" },
        taxonomy
      )
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * 3. The mixed-array ratchet
 * ---------------------------------------------------------------------- */

/**
 * The entries that name `global` **alongside** a real market, as of
 * 2026-09-06.
 *
 * This is a known-list sweep and it is deliberately exact — the same
 * limitation `.claude/GRADER-PRINCIPLES.md` records for
 * `tests/e2e/hidden-guard.spec.ts`, taken on purpose here rather than
 * inherited: the point is that the *next* mixed entry is written by somebody
 * who has read the decision, not by somebody who assumes `["global", "cr"]`
 * means "Costa Rica plus the export sheet, and nowhere else". It does not. It
 * means everywhere.
 *
 * Every id below was read at the time of writing, and each uses the extra
 * market as an **addition** to the general-export scope, never as an
 * exclusion. Adding to this list is fine; do it after checking the same thing.
 */
const KNOWN_MIXED = [
  "g1-suspension-torsion-bar-sag",
  "g1-transfer-case-free-wheeling-hub",
  "g4-engine-crank-pulley-perished",
  "g4-engine-turbo-vane-actuator",
  "g4-exhaust-egr-and-inlet-carbon",
  "g4-fuel-injector-and-pump-wear",
  "gen1",
  "gen2",
  "gen2-5",
  "gen3",
  "gen4",
  "gls",
  "glx",
  "option-code-gen3-transmission-v5a51",
].sort();

describe("`global` alongside a real market, on real content", () => {
  it("is only the entries that have been read and reasoned about", () => {
    expect(
      MIXED.map((row) => row.id).sort(),
      "A `fitment.markets` array mixing `global` with a real market id now " +
        "reads as UNRESTRICTED — `global` is absorbing, and the real ids " +
        "beside it are inert (T203a decision; see the header of " +
        "tests/lib/fitment/global-market.test.ts). If you meant " +
        '"everywhere EXCEPT X", that spelling no longer exists: list the ' +
        "real markets and omit `global`. If you meant the general-export " +
        "scope and also named a market for a human reader, that is fine — " +
        "add the id to KNOWN_MIXED."
    ).toEqual(KNOWN_MIXED);
  });

  it("control: a mixed entry already fits the markets it does list", () => {
    for (const row of MIXED) {
      const listed = row.selections.filter((selection) =>
        row.markets.includes(selection.market)
      );
      const missed = listed.filter(
        (selection) => !entryAppliesTo(row.entry, selection, taxonomy)
      );
      expect(
        missed.map((selection) => `${row.id} @ ${selection.market}`)
      ).toEqual([]);
    }
  });

  it.fails.each(MIXED_WITH_UNLISTED)(
    "$id reaches a market it does not list, because `global` already covers it",
    (row) => {
      const unlisted = row.selections.filter(
        (selection) => !row.markets.includes(selection.market)
      );
      const missed = unlisted.filter(
        (selection) => !entryAppliesTo(row.entry, selection, taxonomy)
      );
      expect(
        missed.map((selection) => `${selection.gen}/${selection.market}`),
        `${row.id} lists ${JSON.stringify(row.markets)} and hid itself from a ` +
          `market \`global\` already covers`
      ).toEqual([]);
    }
  );
});
