/**
 * Graders — both locales render the identical resolved figure from the one
 * stored value (T603; MOD-01, I18N-04, on the PRC-03 precedent).
 *
 * ## The half of the finding a schema grader cannot reach
 *
 * T602's fact-check recorded two costs of keeping a mod's figures inside
 * `sources[].title`. `tests/schemas/mods-citations.test.ts` grades the first.
 * This file grades the second, in T602's own words:
 *
 * > a Spanish reader's only view of a figure like "100 kg roof load" is an
 * > English sentence inside a citation, defeating the bilingual
 * > number-locality rule in spirit even though no field is technically
 * > duplicated.
 *
 * A typed field that nothing renders would leave that exactly as it is. So
 * these assertions are about *the page a reader loads*: the figure appears in
 * `/es/…` as well as `/en/…`, both come from one stored number, and neither
 * locale shows a figure the other does not.
 *
 * ## Why the page and not a resolver module
 *
 * T603's task line leaves T604 a judgment call — share
 * `src/lib/procedures/specs.ts` or fork a `mods`-specific module — and records
 * that the implementer must say which and why. A grader that imported a
 * resolver by path would take that decision away and would also grade the
 * wrong thing: T501 shipped a locale-independent route rendered bare on two
 * pages, and no unit test saw it because the defect was in the composition,
 * not in the function. The container render is the composition.
 *
 * ## What is graded, and what is deliberately left open
 *
 * Graded: the number and its unit reach both locales; the two locales agree
 * about every figure on the page; the entry's own per-locale *title* still
 * differs, so a page that had simply printed the same bytes twice cannot pass;
 * an id that resolves to nothing is shown as such rather than dropped.
 *
 * Left open: markup, headings, section order, and whether `4.5` prints as
 * `4,5` in Spanish. {@link figureTokens} normalises the decimal separator and
 * the unit's punctuation before comparing, so `100 N·m`, `100 N.m` and
 * `100Nm` are one figure and `4.5 m` / `4,5 m` are one value — the graders
 * pin the *stored number*, not a formatter T604 is free to choose.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker, one per test; T604 activates a grader by deleting
 * exactly that `.fails`. The unmarked tests are green today and must stay
 * green — two of them exist only so the marked ones cannot pass vacuously.
 *
 * refs specs/001-foundation (MOD-01, MOD-02, I18N-01, I18N-04, PRC-03 precedent)
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  LENGTH_SPEC,
  ROOF_LOAD_SPEC,
  TORQUE_SPEC,
  makeMod,
  makeModPart,
  makeSpecReference,
} from "../fixtures/mod-spec-fixtures.ts";

type Locale = "en" | "es";

const LOCALES: readonly Locale[] = ["en", "es"];

const MODS_SEGMENT: Record<Locale, string> = {
  en: "mods",
  es: "modificaciones",
};

/* -------------------------------------------------------------------------
 * The corpus
 * ---------------------------------------------------------------------- */

/** The page's subject: cites all three figures plus one id nobody wrote. */
const SUBJECT_ID = "test-mod-roof-rack";

/** The id that resolves to nothing — "unknown is not zero". */
const UNWRITTEN_SPEC_ID = "test-ref-mod-unwritten";

const SUBJECT = makeMod({
  id: SUBJECT_ID,
  specs: [TORQUE_SPEC.id, ROOF_LOAD_SPEC.id, LENGTH_SPEC.id, UNWRITTEN_SPEC_ID],
});

/** A second entry citing one figure — the single-figure case, kept separate. */
const ONE_FIGURE_ID = "test-mod-one-figure";

const ONE_FIGURE = makeMod({
  id: ONE_FIGURE_ID,
  specs: [ROOF_LOAD_SPEC.id],
});

/** A mod that states no figure at all — the empty state must still render. */
const BARE_ID = "test-mod-bare";

const BARE = makeMod({ id: BARE_ID });

const MOD_ENTRIES = [SUBJECT, ONE_FIGURE, BARE].map((data) => ({
  id: data["id"] as string,
  data,
}));

const REFERENCE_ENTRIES = [TORQUE_SPEC, ROOF_LOAD_SPEC, LENGTH_SPEC].map(
  (spec) => {
    const data = makeSpecReference(spec);
    return { id: data["id"] as string, data };
  }
);

vi.mock("astro:content", () => ({
  getCollection: async (name: string) => {
    if (name === "mods") return MOD_ENTRIES;
    if (name === "reference") return REFERENCE_ENTRIES;
    if (name === "parts") {
      const data = makeModPart();
      return [{ id: data["id"] as string, data }];
    }
    return [];
  },
}));

const MOD_SLUGS: Record<string, Record<Locale, string>> = {
  [SUBJECT_ID]: { en: "roof-rack", es: "parrilla-de-techo" },
  [ONE_FIGURE_ID]: { en: "one-figure", es: "una-cifra" },
  [BARE_ID]: { en: "bare", es: "sin-cifras" },
};

vi.mock("../../src/i18n/entry-slugs.ts", () => {
  const table: Record<string, Record<string, Record<Locale, string>>> = {
    mods: MOD_SLUGS,
    parts: { "test-part-mod-bracket": { en: "bracket", es: "soporte" } },
  };
  return {
    ENTRY_SLUGS: table,
    slugRegistryIds: (collection: string) =>
      Object.keys(table[collection] ?? {}),
    entrySlug: (collection: string, id: string, locale: Locale) =>
      table[collection]?.[id]?.[locale] ?? null,
    entrySlugs: (collection: string, id: string) =>
      table[collection]?.[id] ?? null,
  };
});

let render: (locale: Locale, entryId?: string) => Promise<string>;

beforeAll(async () => {
  const { experimental_AstroContainer } = await import("astro/container");
  const container = await experimental_AstroContainer.create();
  const page =
    await import("../../src/pages/[locale]/[modsSegment]/[modSlug].astro");

  render = (locale, entryId = SUBJECT_ID) =>
    container.renderToString(page.default, {
      params: {
        locale,
        modsSegment: MODS_SEGMENT[locale],
        modSlug: MOD_SLUGS[entryId]?.[locale] ?? "",
      },
      props: { entryId },
    });
});

/** The rendered text with tags and entities flattened, for phrase matching. */
function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#183;|&middot;/g, "·")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every `<number><unit>` figure a rendered page states, normalised.
 *
 * Normalisation is what makes these graders about the *stored value* rather
 * than about a formatter T604 gets to choose:
 *
 *  · the decimal separator collapses (`4,5` and `4.5` are one number), so
 *    `Intl.NumberFormat` in the page locale is allowed and not required;
 *  · the unit's internal punctuation and spacing collapse (`N·m`, `N.m`,
 *    `N m` and `Nm` are one unit), so a chosen symbol table is not pinned;
 *  · thousands separators are not stripped, deliberately — a page that
 *    printed `1,000 kg` where another printed `1 kg` would be stating a
 *    different figure, and that must not normalise away.
 *
 * Scoped to the three units this fixture stores. A general "every number on
 * the page" sweep would pick up the difficulty rating and the fitment years,
 * which are per-page furniture and not the figures under test.
 */
function figureTokens(rendered: string): string[] {
  const pattern =
    /(\d+(?:[.,]\d+)?)\s*(n\s*[-·⋅.]?\s*m|kg|m)(?![\p{L}\p{N}])/giu;
  const tokens: string[] = [];
  for (const match of text(rendered).matchAll(pattern)) {
    const number = (match[1] ?? "").replace(",", ".");
    const unit = (match[2] ?? "").toLowerCase().replace(/[\s\-·⋅.]/g, "");
    tokens.push(`${number}${unit}`);
  }
  return tokens.sort();
}

/* -------------------------------------------------------------------------
 * 1. Anti-vacuity — the page renders, and it renders nothing numeric by luck
 * ---------------------------------------------------------------------- */

describe("the page renders at all", () => {
  it("renders the title, summary and tradeoffs in each locale", async () => {
    for (const locale of LOCALES) {
      const body = text(await render(locale));
      expect(body).toContain(
        locale === "en"
          ? "TEST modification — synthetic"
          : "Modificación TEST — sintética"
      );
      expect(body).toContain(
        locale === "en"
          ? "TEST tradeoffs sentence in English."
          : "Frase TEST de contras en español."
      );
    }
  });

  it("has no figure anywhere in the fixture's own prose or citations", () => {
    /*
     * The control that makes every figure assertion below meaningful. If the
     * fixture's tradeoffs sentence or a source title carried "100 kg", a page
     * that resolved nothing at all would still contain the string and the
     * marked graders would pass on a page that never read `specs`.
     *
     * Asserted against the fixture data, not the rendered page: the rendered
     * page is the thing under test, and a control that read it would be
     * asserting the conclusion.
     */
    const prose = JSON.stringify([
      SUBJECT["prose"],
      SUBJECT["sources"],
      ONE_FIGURE["prose"],
      ONE_FIGURE["sources"],
    ]);

    expect(prose).not.toMatch(/\d+\s*(?:kg|N·m|Nm)/i);
  });

  it("renders a mod that states no figure without inventing one", async () => {
    // The empty state. Must stay green: a section that appeared with nothing
    // in it, or a "0 kg" where a mod simply states no load rating, is the
    // confident-zero mistake `.claude/GRADER-PRINCIPLES.md` names.
    for (const locale of LOCALES) {
      expect(figureTokens(await render(locale, BARE_ID))).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------
 * 2. The figure reaches both locales
 * ---------------------------------------------------------------------- */

describe("both locales render the resolved figure (T603)", () => {
  it.fails("renders the torque figure in English and in Spanish", async () => {
    for (const locale of LOCALES) {
      expect(
        figureTokens(await render(locale)),
        `the ${locale} page states no 100 N·m figure`
      ).toContain("100nm");
    }
  });

  it.fails("renders the load rating in English and in Spanish", async () => {
    /*
     * The shape T602 named: "a Spanish reader's only view of a figure like
     * '100 kg roof load' is an English sentence inside a citation". After
     * T604 the Spanish page states it as a figure, from the same stored
     * number the English page reads.
     */
    for (const locale of LOCALES) {
      expect(
        figureTokens(await render(locale)),
        `the ${locale} page states no 100 kg load rating`
      ).toContain("100kg");
    }
  });

  it.fails("renders a decimal figure from one stored value", async () => {
    // `4.5` stored once. `4.5 m` and `4,5 m` are both correct renderings and
    // both normalise to the same token; `4.6 m` in one locale would not.
    for (const locale of LOCALES) {
      expect(figureTokens(await render(locale)), locale).toContain("4.5m");
    }
  });

  it.fails(
    "renders the figure on an entry that cites exactly one",
    async () => {
      // The single-figure case. Separate from the subject so "renders the
      // figures" and "renders *a* figure" are two assertions rather than one
      // that could pass because a list happened to be non-empty.
      for (const locale of LOCALES) {
        expect(
          figureTokens(await render(locale, ONE_FIGURE_ID)),
          locale
        ).toEqual(["100kg"]);
      }
    }
  );
});

/* -------------------------------------------------------------------------
 * 3. The two locales agree about the number and disagree about the words
 * ---------------------------------------------------------------------- */

describe("one stored value, two renderings (AGENTS.md, I18N-04)", () => {
  it.fails("states exactly the same figures in both locales", async () => {
    /*
     * The divergence guard, and the assertion this whole file is for. A
     * figure that exists once and is rendered twice cannot differ between
     * locales; a figure typed into two prose blocks can, and did — T602's
     * bilingual review round 1 found the regear entry asserting opposite
     * directions about a ratio in EN and ES, and the 33s entry repeating a
     * source's figure into both locale prose blocks.
     *
     * The non-empty assertion comes first on purpose: two empty lists are
     * equal, so without it this grader would pass today over a page that
     * renders no figures at all.
     */
    const en = figureTokens(await render("en"));
    const es = figureTokens(await render("es"));

    expect(en, "the English page renders no figures").not.toEqual([]);
    expect(es).toEqual(en);
  });

  it.fails("still shows each locale its own words for the figure", async () => {
    /*
     * The mirror, and the control that stops "both locales are identical"
     * being satisfied by a page that renders the English one twice. The
     * `reference` entry's own `prose.<locale>.title` differs; the number does
     * not. Both properties have to hold at once, which is precisely what
     * "shared data, per-locale prose" means.
     */
    const en = text(await render("en"));
    const es = text(await render("es"));

    expect(en).toContain(`TEST reference ${ROOF_LOAD_SPEC.id}`);
    expect(es).toContain(`Referencia TEST ${ROOF_LOAD_SPEC.id}`);
    expect(es).not.toContain(`TEST reference ${ROOF_LOAD_SPEC.id}`);
  });
});

/* -------------------------------------------------------------------------
 * 4. An id that resolves to nothing is said, not swallowed
 * ---------------------------------------------------------------------- */

describe("an unresolved figure id is shown as unresolved", () => {
  it.fails("names the unwritten id on the page, in both locales", async () => {
    /*
     * The build refuses this corpus
     * (`tests/integrations/validate-mods-specs.test.ts`), so this is
     * defence-in-depth — but a page that silently dropped the row would show
     * a *shorter* figure list than the entry declares, which is a confident
     * answer derived from having failed to look. T601 made the same choice
     * for an unresolved `requires` row, and this is the same rule one field
     * over (AGENTS.md, "a failure is not a zero").
     */
    for (const locale of LOCALES) {
      expect(text(await render(locale)), locale).toContain(UNWRITTEN_SPEC_ID);
    }
  });

  it.fails("does not render it as a figure", async () => {
    // "We could not find this number" must not become "this number is
    // nothing". The unresolved row adds no token to either locale's figure
    // list, so the counts stay equal to the three that resolved.
    for (const locale of LOCALES) {
      expect(figureTokens(await render(locale)), locale).toEqual([
        "100kg",
        "100nm",
        "4.5m",
      ]);
    }
  });
});
