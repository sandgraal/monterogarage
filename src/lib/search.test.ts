import { describe, expect, it } from "vitest";
import {
  SEARCH_DOCUMENT_TYPES,
  buildSearchHaystack,
  countSearchMatches,
  isSearchDocumentType,
  matchesSearchFilter,
  type SearchFilterCard,
  type SearchHaystackSource,
} from "./search";

/** A haystack source with every field defaulted to empty, one override at a time. */
function source(
  overrides: Partial<SearchHaystackSource> = {}
): SearchHaystackSource {
  return {
    title: [],
    subtitle: [],
    snippet: [],
    badges: [],
    codes: [],
    extra: [],
    ...overrides,
  };
}

describe("SEARCH_DOCUMENT_TYPES / isSearchDocumentType", () => {
  it("accepts every declared type", () => {
    for (const type of SEARCH_DOCUMENT_TYPES) {
      expect(isSearchDocumentType(type)).toBe(true);
    }
  });

  it("rejects a string that is not a declared type", () => {
    expect(isSearchDocumentType("garage")).toBe(false);
    expect(isSearchDocumentType("procedures")).toBe(false);
    expect(isSearchDocumentType("")).toBe(false);
  });
});

describe("buildSearchHaystack", () => {
  it("is the empty string when every field is empty", () => {
    expect(buildSearchHaystack(source())).toBe("");
  });

  it("is accent- and case-insensitive, matching normalizeForSearch", () => {
    const hay = buildSearchHaystack(source({ title: ["Neumático"] }));
    expect(hay).toContain("neumatico");
    expect(hay).not.toContain("Neumático");
  });

  it("case-folds an OEM part number so either case is found", () => {
    const hay = buildSearchHaystack(source({ codes: ["MD976075"] }));
    expect(hay).toContain("md976075");
  });

  it("joins fields with a space, so adjacent fields cannot fuse into a false substring", () => {
    const hay = buildSearchHaystack(
      source({ title: ["front"], snippet: ["axle"] })
    );
    expect(hay).toBe("front axle");
    // The word-boundary-spanning substring must not appear: "front" + "axle"
    // concatenated with no separator would contain "ntax"; joined with a
    // space it does not.
    expect(hay).not.toContain("ntax");
  });

  it("includes every field, in title/subtitle/snippet/badges/codes/extra order", () => {
    const hay = buildSearchHaystack({
      title: ["t"],
      subtitle: ["s"],
      snippet: ["n"],
      badges: ["b"],
      codes: ["c"],
      extra: ["e"],
    });
    expect(hay).toBe("t s n b c e");
  });

  it("collapses internal whitespace the way normalizeForSearch always has", () => {
    const hay = buildSearchHaystack(source({ title: ["  Rin   trasero  "] }));
    expect(hay).toBe("rin trasero");
  });
});

describe("matchesSearchFilter", () => {
  const glossaryCard: SearchFilterCard = {
    type: "glossary",
    haystack: buildSearchHaystack(
      source({
        title: ["Aro"],
        subtitle: ["Rim"],
        snippet: ["La pieza metálica sobre la que se monta el neumático."],
        badges: ["Suspensión y dirección"],
        // SRCH-02: the canonical entry's card renders the alias, so the
        // reader who searches the alias still lands on the canonical term.
        extra: ["rin (CR/MX)", "llanta (ES) — ¡ojo!"],
      })
    ),
  };

  const partCard: SearchFilterCard = {
    type: "parts",
    haystack: buildSearchHaystack(
      source({
        title: ["Water pump"],
        snippet: ["6G74 3.5L V6 water pump, OEM."],
        badges: ["Engine"],
        codes: ["MD976075"],
        extra: ["Aisin WPM-050"],
      })
    ),
  };

  const problemCard: SearchFilterCard = {
    type: "problems",
    haystack: buildSearchHaystack(
      source({
        title: ["Transfer case will not engage"],
        snippet: ["Front axle never locks in on demand."],
        badges: ["Drivetrain", "Drive gently, repair soon"],
        extra: ["4WD light flashes", "grinding noise on engagement"],
      })
    ),
  };

  const cards = [glossaryCard, partCard, problemCard];

  it("is permissive on the initial state — every card matches", () => {
    expect(
      cards.every((card) => matchesSearchFilter(card, { type: "", query: "" }))
    ).toBe(true);
  });

  it("a whitespace-only query is treated as empty (permissive)", () => {
    expect(matchesSearchFilter(glossaryCard, { type: "", query: "   " })).toBe(
      true
    );
  });

  it("SRCH-02: a regional alias substring finds the canonical entry's card", () => {
    expect(matchesSearchFilter(glossaryCard, { type: "", query: "rin" })).toBe(
      true
    );
  });

  it("an accented query finds an unaccented match and vice versa", () => {
    expect(
      matchesSearchFilter(glossaryCard, { type: "", query: "neumatico" })
    ).toBe(true);
  });

  it("SRCH-01: an OEM part number is searchable regardless of case", () => {
    expect(matchesSearchFilter(partCard, { type: "", query: "md976075" })).toBe(
      true
    );
    expect(matchesSearchFilter(partCard, { type: "", query: "MD976075" })).toBe(
      true
    );
  });

  it("a partial part number still matches (substring, not whole-word)", () => {
    expect(matchesSearchFilter(partCard, { type: "", query: "97607" })).toBe(
      true
    );
  });

  it("an aftermarket cross-reference number is searchable too", () => {
    expect(matchesSearchFilter(partCard, { type: "", query: "wpm-050" })).toBe(
      true
    );
  });

  it("SRCH-01: a symptom phrase is searchable", () => {
    expect(
      matchesSearchFilter(problemCard, { type: "", query: "grinding" })
    ).toBe(true);
  });

  it("a query with no match anywhere excludes the card", () => {
    expect(
      matchesSearchFilter(glossaryCard, { type: "", query: "carburador" })
    ).toBe(false);
  });

  it("the type facet excludes a card of a different type even with an empty query", () => {
    expect(
      matchesSearchFilter(glossaryCard, { type: "parts", query: "" })
    ).toBe(false);
    expect(matchesSearchFilter(partCard, { type: "parts", query: "" })).toBe(
      true
    );
  });

  it("the type facet and the query AND together", () => {
    // The query matches the part card's text but the type facet asks only
    // for glossary results — both must hold.
    expect(
      matchesSearchFilter(partCard, { type: "glossary", query: "water pump" })
    ).toBe(false);
    expect(
      matchesSearchFilter(partCard, { type: "parts", query: "water pump" })
    ).toBe(true);
  });

  it("a query that matches under one type filter does not leak into another", () => {
    // "engine" appears in the part card's badge; asking for problems-only
    // results must not surface it even though the text matches.
    const engineHaystack = buildSearchHaystack(source({ badges: ["Engine"] }));
    expect(
      matchesSearchFilter(
        { type: "parts", haystack: engineHaystack },
        { type: "problems", query: "engine" }
      )
    ).toBe(false);
  });
});

describe("countSearchMatches", () => {
  const cards: SearchFilterCard[] = [
    { type: "glossary", haystack: "rin trasero" },
    { type: "parts", haystack: "md976075 water pump" },
    { type: "parts", haystack: "mr374521 sway bar link" },
  ];

  it("counts zero over an empty document set", () => {
    expect(countSearchMatches([], { type: "", query: "" })).toBe(0);
  });

  it("counts every card on the permissive state", () => {
    expect(countSearchMatches(cards, { type: "", query: "" })).toBe(3);
  });

  it("counts only the cards that satisfy both facets", () => {
    expect(countSearchMatches(cards, { type: "parts", query: "" })).toBe(2);
    expect(countSearchMatches(cards, { type: "parts", query: "md" })).toBe(1);
    expect(countSearchMatches(cards, { type: "glossary", query: "md" })).toBe(
      0
    );
  });
});
