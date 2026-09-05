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
import { normalizeForSearch } from "./text";

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

/**
 * Pre-normalizes `raw` the way `[searchSegment].astro`'s `input` listener
 * does — once, before calling `matchesSearchFilter` — never inside the
 * function under test (PR #106 code review: normalizing inside
 * `matchesSearchFilter` redid the same work once per card per keystroke).
 */
const q = (raw: string): string => normalizeForSearch(raw);

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
      cards.every((card) =>
        matchesSearchFilter(card, { type: "", normalizedQuery: "" })
      )
    ).toBe(true);
  });

  it("an empty normalizedQuery is permissive regardless of what produced it", () => {
    // The caller (the page's `input` handler) is responsible for turning a
    // whitespace-only box into `""` via `normalizeForSearch` before calling
    // in — this module only ever sees the already-normalized result.
    expect(
      matchesSearchFilter(glossaryCard, {
        type: "",
        normalizedQuery: q("   "),
      })
    ).toBe(true);
  });

  it("SRCH-02: a regional alias substring finds the canonical entry's card", () => {
    expect(
      matchesSearchFilter(glossaryCard, { type: "", normalizedQuery: q("rin") })
    ).toBe(true);
  });

  it("an accented query finds an unaccented match and vice versa", () => {
    expect(
      matchesSearchFilter(glossaryCard, {
        type: "",
        normalizedQuery: q("neumatico"),
      })
    ).toBe(true);
    // The accented spelling normalizes to the same thing, so it matches too —
    // this is exercising the caller's `normalizeForSearch` call, not a second
    // one inside `matchesSearchFilter` (there is none any more).
    expect(
      matchesSearchFilter(glossaryCard, {
        type: "",
        normalizedQuery: q("neumático"),
      })
    ).toBe(true);
  });

  it("SRCH-01: an OEM part number is searchable regardless of case", () => {
    expect(
      matchesSearchFilter(partCard, {
        type: "",
        normalizedQuery: q("md976075"),
      })
    ).toBe(true);
    expect(
      matchesSearchFilter(partCard, {
        type: "",
        normalizedQuery: q("MD976075"),
      })
    ).toBe(true);
  });

  it("a partial part number still matches (substring, not whole-word)", () => {
    expect(
      matchesSearchFilter(partCard, { type: "", normalizedQuery: q("97607") })
    ).toBe(true);
  });

  it("an aftermarket cross-reference number is searchable too", () => {
    expect(
      matchesSearchFilter(partCard, {
        type: "",
        normalizedQuery: q("wpm-050"),
      })
    ).toBe(true);
  });

  it("SRCH-01: a symptom phrase is searchable", () => {
    expect(
      matchesSearchFilter(problemCard, {
        type: "",
        normalizedQuery: q("grinding"),
      })
    ).toBe(true);
  });

  it("a query with no match anywhere excludes the card", () => {
    expect(
      matchesSearchFilter(glossaryCard, {
        type: "",
        normalizedQuery: q("carburador"),
      })
    ).toBe(false);
  });

  it("the type facet excludes a card of a different type even with an empty query", () => {
    expect(
      matchesSearchFilter(glossaryCard, { type: "parts", normalizedQuery: "" })
    ).toBe(false);
    expect(
      matchesSearchFilter(partCard, { type: "parts", normalizedQuery: "" })
    ).toBe(true);
  });

  it("the type facet and the query AND together", () => {
    // The query matches the part card's text but the type facet asks only
    // for glossary results — both must hold.
    expect(
      matchesSearchFilter(partCard, {
        type: "glossary",
        normalizedQuery: q("water pump"),
      })
    ).toBe(false);
    expect(
      matchesSearchFilter(partCard, {
        type: "parts",
        normalizedQuery: q("water pump"),
      })
    ).toBe(true);
  });

  it("a query that matches under one type filter does not leak into another", () => {
    // "engine" appears in the part card's badge; asking for problems-only
    // results must not surface it even though the text matches.
    const engineHaystack = buildSearchHaystack(source({ badges: ["Engine"] }));
    expect(
      matchesSearchFilter(
        { type: "parts", haystack: engineHaystack },
        { type: "problems", normalizedQuery: q("engine") }
      )
    ).toBe(false);
  });

  /* -----------------------------------------------------------------------
   * PR #106 code review: matchesSearchFilter no longer normalizes. These
   * lock that contract in — a regression that reintroduces an internal
   * normalizeForSearch call would still pass every test above (normalized
   * input round-trips through normalizeForSearch unchanged), so a test that
   * hands the function *un-normalized* text is the only way to catch it.
   * -------------------------------------------------------------------- */
  it("does not itself normalize: an un-normalized (accented/uppercase) query is compared literally", () => {
    // The haystack is already normalized (lowercase, unaccented) by
    // buildSearchHaystack. A caller that forgot to normalize the query
    // first gets a literal, case-sensitive substring comparison — which is
    // exactly what should happen, so the bug is visible in the page script
    // that forgot to normalize, not swallowed silently here.
    expect(
      matchesSearchFilter(glossaryCard, {
        type: "",
        normalizedQuery: "Neumático",
      })
    ).toBe(false);
    expect(
      matchesSearchFilter(glossaryCard, {
        type: "",
        normalizedQuery: "NEUMATICO",
      })
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
    expect(countSearchMatches([], { type: "", normalizedQuery: "" })).toBe(0);
  });

  it("counts every card on the permissive state", () => {
    expect(countSearchMatches(cards, { type: "", normalizedQuery: "" })).toBe(
      3
    );
  });

  it("counts only the cards that satisfy both facets", () => {
    expect(
      countSearchMatches(cards, { type: "parts", normalizedQuery: "" })
    ).toBe(2);
    expect(
      countSearchMatches(cards, { type: "parts", normalizedQuery: "md" })
    ).toBe(1);
    expect(
      countSearchMatches(cards, { type: "glossary", normalizedQuery: "md" })
    ).toBe(0);
  });
});
