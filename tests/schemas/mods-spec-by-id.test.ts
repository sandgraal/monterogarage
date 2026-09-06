/**
 * Graders — a mod's figures come from shared reference data **by id**
 * (T603; MOD-01, MOD-02, on the PRC-03 precedent).
 *
 * > **MOD-01** THE `mods` collection SHALL hold, per entry: what it requires
 * > (by entry ID), what it breaks or affects, cost band, difficulty, fitment,
 * > honest tradeoffs prose in both locales, sources.
 * >
 * > **PRC-03** (the precedent this mirrors) IF a procedure cites a torque or
 * > fluid spec, THEN THE value SHALL come from shared reference data by ID,
 * > never inlined per-locale.
 *
 * ## Why this file exists
 *
 * T602's fact-check found that `modsShared` "is a strict object with no
 * numeric field beyond `difficulty`, so a tire diameter, a roof-load limit or
 * a gear ratio has no typed home. Every figure therefore sits in the entry's
 * `sources[].title`." Two costs, both recorded on that task line: an entry's
 * numbers are invisible to `check:citations` (so "every numeric spec carries a
 * source" is *vacuous* for exactly the entries that state the most figures),
 * and a Spanish reader's only view of "100 kg roof load" is an English
 * sentence inside a citation.
 *
 * T604 closes it by giving `mods` the seam `procedures` already has. This file
 * grades that seam's **shape**; three siblings grade the rest:
 *
 *  · `tests/schemas/mods-citations.test.ts` — the figure is inside REF-02's
 *    enforcement, end to end, and the alternative typed path is available for
 *    the shipped entries that currently have none.
 *  · `tests/integrations/validate-mods-specs.test.ts` — the build resolves the
 *    ids, and refuses a kind that carries no figure.
 *  · `tests/pages/mod-page.specs.render.test.ts` — both locales render the
 *    identical resolved figure from the one stored value.
 *
 * ## The field is `specs`, and that is a contract, not a preference
 *
 * T603's task line says "mirroring T502a/T502's specs-by-id pattern". A second
 * name for one idea is a second vocabulary an author has to learn per
 * collection, and the repository already pays that cost once (T501's "Owed 2"
 * note: `sourceKind.*` keys were minted once and T502 was told never to
 * re-mint them). So the graders pin `specs`, a `readonly string[]` of
 * `reference` entry ids in **shared** data.
 *
 * **What they deliberately do not pin** is where the resolving/rendering code
 * lives. T603's task line leaves T604 the judgment call — share
 * `src/lib/procedures/specs.ts` or fork a `mods`-specific module — so every
 * grader here reaches the behaviour through the registered collection, the
 * build hook, or the rendered page, never through a module path.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker, one per test; T604 activates a grader by deleting
 * exactly that `.fails` and nothing else. Tests **without** the marker are
 * controls that are green today and must stay green — several of them exist
 * precisely to catch the plausible wrong fixes (a figure moved into prose, a
 * figure declared twice, a detector that flags a tire size).
 *
 * ## The activation was simulated, not argued
 *
 * A scratch T604 (`specs` on `modsShared`; a duplicate rule; the PRC-03 prose
 * detector applied to `title`/`summary`/`tradeoffs`/`affectsNotes`; `specIds`
 * read by `readMods` and resolved against `reference` kinds in
 * `runModsBuildCheck`; `specRows` from `src/lib/procedures/specs.ts` reused
 * verbatim by the mod page) turned **all** markers in this file and its three
 * siblings green — 100 tests — with the rest of the repository unmoved (3972
 * passing, no other suite touched). Then it was mutated, and each mutant was
 * killed by the graders written for it and by no others:
 *
 * | mutant | red |
 * | --- | --- |
 * | the prose detector removed | 11, all in block 4 |
 * | the prose detector scoped to `tradeoffs` only (the T502-F2 shape) | 3 — summary, title, `affectsNotes` |
 * | the duplicate-spec rule removed | 1 |
 * | `specs` admits `{ id, value, unit }` | 1 |
 * | every `reference` kind counts as a figure | 5, all in the build grader |
 * | the page renders both locales from the EN resolution | 1 |
 * | the page drops unresolved rows | 1 |
 *
 * The `{ id, value, unit }` mutant **passed the first draft of this file** —
 * the reject table listed one spelling of "a figure beside the id" and the
 * mutant used another. That is the incident behind block 3's category note,
 * and it was found by mutating a candidate implementation rather than by
 * re-reading the table.
 *
 * refs specs/001-foundation (MOD-01, MOD-02, PRC-03 precedent, REF-01, SCF-04)
 */
import { describe, expect, it } from "vitest";
import { z } from "astro/zod";

import { defineEntrySchema } from "../../src/schemas/entry.ts";
import { modsProse, modsShared } from "../../src/schemas/mods.ts";
import { unrecognizedKeys } from "../helpers/schema-outcome.ts";
import {
  accepts,
  issueSummary,
  issuesUnder,
  modIssuePaths,
  parseMod,
  parsedModData,
} from "../helpers/mods.ts";
import {
  LENGTH_SPEC,
  ROOF_LOAD_SPEC,
  TORQUE_SPEC,
  makeMod,
  makeSource,
} from "../fixtures/mod-spec-fixtures.ts";

/**
 * The shared-data fields the `mods` schema owns **today**, before T604.
 *
 * Kept at today's list on purpose. `expectOnlyThisIsUnrecognised` uses it to
 * prove a rejection is *about the smuggled figure* and not about the whole
 * collection being unknown to the parser; if `specs` were listed here every
 * row in that table would flip to an expected failure and the table would stop
 * grading what it is for. That `specs` joins this list is the separate,
 * marked grader below.
 */
const OWNED_SHARED_FIELDS = [
  "system",
  "cost",
  "difficulty",
  "requires",
  "affects",
];

/** Per-locale fields the `mods` schema owns. */
const OWNED_PROSE_FIELDS = ["title", "summary", "tradeoffs", "affectsNotes"];

/**
 * `field` is rejected as unrecognised **and the fields the schema owns are
 * not** — the second half is what stops the assertion passing vacuously.
 *
 * The failure mode it exists for, recorded verbatim on T502a: a bare
 * `toContain(field)` is satisfied by a schema that knows nothing at all, which
 * is a rejection of the collection rather than of the inlined figure.
 */
function expectOnlyThisIsUnrecognised(
  entry: Record<string, unknown>,
  field: string,
  owned: readonly string[]
): void {
  const keys = unrecognizedKeys(parseMod(entry));

  expect(keys, `\`${field}\` was accepted into the entry`).toContain(field);
  for (const ownedField of owned) {
    expect(
      keys,
      `\`${ownedField}\` is a field this collection owns, not an unknown key`
    ).not.toContain(ownedField);
  }
}

/* -------------------------------------------------------------------------
 * 1. Define time — the numeric-prose guard, probed with a mod's figures
 *
 * The mirror-image mistake to the one T602 actually made. T602 put its
 * figures in `sources[].title`, which stores them once; the *other* wrong
 * answer — and the one a schema author reaches for when told "mods needs a
 * typed figure field" — is a numeric field in `modsProse`, which stores them
 * twice, once per locale, forever. `defineEntrySchema` throws at define time
 * on that shape, and these rows prove it throws on the shapes a **mods**
 * author would reach for rather than on the ones a procedures author would.
 * ---------------------------------------------------------------------- */

describe("no figure may be declared in the mods prose shape (define time)", () => {
  it.each<[string, string, z.ZodType]>([
    ["a roof-load limit", "roofLoadKg", z.number()],
    ["an optional roof-load limit", "roofLoadKg", z.number().optional()],
    ["a lift height", "liftHeightMm", z.number()],
    ["a tire diameter", "tireDiameterIn", z.number()],
    ["a gear ratio", "gearRatio", z.number()],
    ["a fastener torque", "torqueNm", z.number()],
    ["a list of figures", "loadRatingsKg", z.array(z.number())],
    [
      "a figure nested one level down",
      "roofLoad",
      z.object({ kg: z.number() }),
    ],
    [
      "a figure inside a per-row record",
      "affectsFigures",
      z.record(z.string(), z.number()),
    ],
  ])("refuses %s in prose, naming the field", (_label, field, schema) => {
    expect(() =>
      defineEntrySchema(modsShared, { ...modsProse, [field]: schema })
    ).toThrow(new RegExp(field));
  });

  it("builds cleanly with the prose shape as it actually ships", () => {
    // The positive control. Without it, "the guard throws" is satisfied by a
    // guard that throws on everything.
    expect(() => defineEntrySchema(modsShared, modsProse)).not.toThrow();
  });

  it("keeps the human half in prose, where a translator can reach it", () => {
    expect(Object.keys(modsProse)).toEqual(
      expect.arrayContaining(["title", "summary", "tradeoffs"])
    );
    // The mirror-image mistake: an English sentence in shared data is a page
    // that ships in one language.
    expect(Object.keys(modsShared)).not.toContain("tradeoffs");
  });

  it("keeps the figure path out of prose", () => {
    // Must stay true after T604: `specs` is a list of ids — shared data, one
    // copy — and a per-locale `specs` would be two lists of ids that can
    // disagree about which figure the ES page shows.
    expect(Object.keys(modsProse)).not.toContain("specs");
  });
});

/* -------------------------------------------------------------------------
 * 2. The seam itself — `modsShared` gains the referenced-by-id figure field
 * ---------------------------------------------------------------------- */

describe("`modsShared` has a typed, referenced-by-id figure field (T603)", () => {
  it.fails("declares `specs` in shared data", () => {
    // The seam, at its narrowest. T602's finding in one assertion: there is
    // no typed home for a figure on a mods entry.
    expect(Object.keys(modsShared)).toContain("specs");
  });

  it.fails("accepts an entry that cites a figure by id", () => {
    const entry = makeMod({ specs: [TORQUE_SPEC.id, ROOF_LOAD_SPEC.id] });

    expect(accepts(entry), issueSummary(entry)).toBe(true);
  });

  it.fails("does not report `specs` as an unknown key", () => {
    // Stated separately from "accepts" so the failure message says *which*
    // shape of rejection happened: an unknown key means the field does not
    // exist, and an issue under `specs` means it exists and refused this
    // value. Those send an implementer to two different places.
    expect(
      unrecognizedKeys(parseMod(makeMod({ specs: [TORQUE_SPEC.id] })))
    ).not.toContain("specs");
  });

  it.fails("treats `specs` as a field the collection owns", () => {
    // The `OWNED_SHARED_FIELDS` table above is frozen at today's list for a
    // stated reason; this is the one grader that moves it.
    expectOnlyThisIsUnrecognised(
      makeMod({ specs: [TORQUE_SPEC.id], extraShared: { roofLoadKg: 100 } }),
      "roofLoadKg",
      [...OWNED_SHARED_FIELDS, "specs"]
    );
  });

  it("accepts an entry that states no figure at all", () => {
    // Empty is legal, and must stay legal. Plenty of mods state no number —
    // a rule that required one would get inventions, the same reasoning
    // `requires` records for its own empty default (T601 contract 1).
    expect(modIssuePaths(makeMod())).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 3. "By id" means there is exactly one copy
 *
 * The subtler half of "never inlined". A figure written into the mod's own
 * shared data does not duplicate across locales, so the bilingual guard never
 * sees it — and it still means the number lives in two places (here, and in
 * the `reference` entry it should have pointed at) with nothing keeping them
 * equal. An id is the only shape that has one copy.
 * ---------------------------------------------------------------------- */

describe("a mod states no figure of its own (T603, PRC-03 precedent)", () => {
  /*
   * Every one of these is a field `reference` already owns, on an entry whose
   * kind is built to carry it and whose `sources` cite it. Green today
   * (`modsShared` is strict and owns none of them) and must stay green: the
   * plausible wrong fix for T604 is a typed figure field that stores the
   * *number* rather than the id, which would satisfy "mods has a typed
   * numeric field" and reintroduce the second copy.
   */
  it.each<[string, unknown]>([
    ["torque", { value: 100, unit: "nm" }],
    ["torqueNm", 100],
    ["roofLoadKg", 100],
    ["weight", { value: 100, unit: "kg" }],
    ["dimension", { value: 100, unit: "kg" }],
    ["capacity", { value: 4.5, unit: "l" }],
    ["specification", "TEST SPEC 00W-00"],
    ["stages", [{ torque: { value: 50, unit: "nm" } }]],
    ["figures", [{ label: "roof load", value: 100, unit: "kg" }]],
  ])("refuses an inlined `%s` in its own shared data", (field, value) => {
    expectOnlyThisIsUnrecognised(
      makeMod({ extraShared: { [field]: value } }),
      field,
      OWNED_SHARED_FIELDS
    );
  });

  /*
   * The hybrid shape is the most likely wrong answer available to T604,
   * because it *looks* like it satisfies both halves at once ("referenced by
   * id" **and** "a typed numeric field"). It is the second copy wearing the
   * reference's clothes: the number now lives here and in the `reference`
   * entry, with nothing keeping the two equal.
   *
   * **The rule is a category, not a spelling list, and this table is evidence
   * for the category rather than the whole of it** — the lesson
   * `.claude/GRADER-PRINCIPLES.md` records as "grade behavior, not name
   * lists". The category is: *a `specs` element that carries a number
   * anywhere inside it*. The first draft of this file listed only
   * `{ id, torque: { value, unit } }`, and a scratch implementation that
   * admitted `{ id, value, unit }` passed the whole suite — found by mutating
   * the candidate implementation, not by reading the table. Expect to find a
   * spelling this table still misses; add it here and keep the rule stated as
   * the category.
   *
   * Asserted as an issue **under `specs`**, never merely as "the entry is
   * rejected": today the whole field is an unrecognised key reported at the
   * root, so "rejected" is already true and an `it.fails` on it would report
   * an unexpected pass. Issues under `specs` are empty today and non-empty
   * only once the field exists and refuses this value.
   */
  it.fails.each<[string, unknown]>([
    [
      "a nested kind-owned figure",
      { id: TORQUE_SPEC.id, torque: { value: 100, unit: "nm" } },
    ],
    [
      "a flattened value and unit",
      { id: TORQUE_SPEC.id, value: 100, unit: "nm" },
    ],
    ["a bare unit-named figure", { id: ROOF_LOAD_SPEC.id, kg: 100 }],
    ["a list of figures", { id: TORQUE_SPEC.id, figures: [100] }],
    ["an override of the stored figure", { id: TORQUE_SPEC.id, override: 100 }],
    ["a figure object with no id at all", { value: 100, unit: "kg" }],
    ["a bare number in the list", 100],
  ])("refuses `specs` carrying %s beside the id", (_label, element) => {
    const entry = makeMod({ specs: [element] });

    expect(issuesUnder(entry, "specs").length).toBeGreaterThan(0);
  });

  it.fails("parses `specs` to exactly the ids the entry wrote", () => {
    /*
     * The category stated once more, this time without a table: whatever
     * shape T604 declares, what a page receives is the list of ids and
     * nothing derived from them. A schema that resolved ids into objects at
     * parse time would put the figure back inside the mod entry — invisible
     * to the reject rows above, because it is the *schema* adding the number
     * rather than the author.
     */
    const data = parsedModData(
      makeMod({ specs: [TORQUE_SPEC.id, ROOF_LOAD_SPEC.id] })
    );

    expect(data["specs"]).toEqual([TORQUE_SPEC.id, ROOF_LOAD_SPEC.id]);
  });

  it.fails("refuses a catalogue token written where a spec id belongs", () => {
    /*
     * The mistake an author makes: pasting the *token* instead of naming the
     * entry that holds the number. An entry id is lowercase kebab-case and a
     * catalogue token is uppercase, so the two cannot be confused silently —
     * the rule `parts`' `supersededBy` already states.
     *
     * Deliberately **not** graded as "a bare number is rejected": `100` is a
     * legal kebab-case id by shape, and a rule that special-cased all-digit
     * strings would be a second, weaker id vocabulary. That the id names
     * nothing is the build's answer, and it is the right one — see
     * `tests/integrations/validate-mods-specs.test.ts`.
     */
    const entry = makeMod({ specs: ["TEST-REF-0001"] });

    expect(issuesUnder(entry, "specs").length).toBeGreaterThan(0);
  });

  it.fails("refuses the same figure cited twice on one entry", () => {
    /*
     * `procedures` already refuses this (`checkDuplicateStrings`), and the
     * reason carries over unchanged: a page renders one row per cited id, so
     * a repeat is a figure shown twice, and the author who repeated it
     * probably meant to cite a *different* one.
     */
    const entry = makeMod({ specs: [TORQUE_SPEC.id, TORQUE_SPEC.id] });

    expect(issuesUnder(entry, "specs").length).toBeGreaterThan(0);
  });

  it.fails("accepts several distinct figures on one entry", () => {
    // The positive control for the duplicate rule. Without it, "duplicates
    // are refused" is satisfied by a rule that refuses every list longer
    // than one — and a roof rack legitimately states a load rating, a
    // fastener torque and a length.
    const entry = makeMod({
      specs: [TORQUE_SPEC.id, ROOF_LOAD_SPEC.id, LENGTH_SPEC.id],
    });

    expect(accepts(entry), issueSummary(entry)).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * 4. A figure written into a sentence is still an inlined value
 *
 * ## Why this block is here at all
 *
 * T603's grade list does not name it, and it is included because T602's own
 * bilingual review found the defect in shipped content: "the 33s entry typed a
 * source figure ('60 mph') into **both** locale prose blocks one sentence
 * after its own summary promised the numbers were 'in the citation rather than
 * repeated here'." That was caught by a human reading two files side by side.
 * Nothing in the repository would have caught it, and giving `mods` a typed
 * figure path without the guard that makes authors use it leaves the same hole
 * with a nicer alternative beside it.
 *
 * ## Scope, and the false-positive budget
 *
 * The category is `src/lib/procedures/figures.ts`' — *a digit bound to a
 * torque or volume unit, in any spelling of that unit* — applied to the free
 * sentences `mods` owns: `title`, `summary`, `tradeoffs` and each
 * `affectsNotes` row. It is a category and not a spelling list; expect to find
 * a spelling this table misses, and widen the pattern rather than narrowing
 * the rule to the table.
 *
 * **Three things are deliberately outside it, and each is a reject row's
 * mirror in the accept table below.**
 *
 *  1. **`sources[].title` is not scanned.** Run against the ten shipped
 *     wave-1 entries, the procedures detector fires on five source titles and
 *     on zero prose strings — and all five are false positives of the kind
 *     that gets a rule deleted: "3.8L V6" is the engine's name in a document
 *     title, "3000cc" is part of ARB's own product description. A source
 *     title is a document's title, quoted; T603's grade item is that an
 *     author has an *alternative* to putting the figure there, not that the
 *     citation is forbidden from containing one.
 *  2. **Mass, length and angle are a stated gap**, exactly as `mm` is for
 *     procedures. "100 kg" and "51 mm" are the roof-load and lift-height
 *     shapes this collection most wants to catch, and no regex separates them
 *     from "a 14 mm socket" or "a 20 kg drawer you lift out". The gap is
 *     closed the other way instead — `dimension` is citable by id, so an
 *     author *has* a correct move — and the residual risk is carried by
 *     review. If a future round finds a way to tell them apart, widen it.
 *  3. **A tire size, a gear ratio and a count are not figures this rule is
 *     about.** `285/75R16`, `4.9`, "the three bolts" carry no unit token, so
 *     they are outside the category by construction rather than by exception.
 * ---------------------------------------------------------------------- */

describe("a figure written into a mod's sentence is an inlined value", () => {
  it.fails.each<[string, "en" | "es", string]>([
    ["N·m", "en", "Torque the rack feet to 100 N·m before loading it."],
    ["Nm, no separator", "en", "Torque the rack feet to 100Nm before loading."],
    ["N·m in ES", "es", "Apriete las patas a 100 N·m antes de cargarla."],
    ["kgf-m", "es", "Apriete las patas a 10 kgf-m antes de cargarla."],
    ["lb-ft", "en", "Torque the rack feet to 74 lb-ft before loading it."],
    ["ft lbs, spaced plural", "en", "Torque the feet to 74 ft lbs."],
    ["litres", "en", "The auxiliary tank adds 40 L of range."],
    ["litros", "es", "El tanque auxiliar agrega 40 litros de autonomía."],
  ])(
    "rejects tradeoffs prose that states the figure itself (%s)",
    (_label, locale, text) => {
      const entry = makeMod({ tradeoffs: { [locale]: text } });

      expect(
        issuesUnder(entry, `prose.${locale}.tradeoffs`).length,
        `nothing was reported for: ${text}`
      ).toBeGreaterThan(0);
    }
  );

  it.fails(
    "rejects a figure in the summary, which renders on every card",
    () => {
      /*
       * The T502 review's F2 defect, one collection later. A summary renders on
       * the detail page *and* on every index card, and a detector scoped to the
       * "interesting" field only would ship the figure twice, once per locale,
       * on the most surfaces of any field this collection has.
       */
      const entry = makeMod({
        summaries: { en: "A roof rack rated by a 100 N·m fastener torque." },
      });

      expect(issuesUnder(entry, "prose.en.summary").length).toBeGreaterThan(0);
    }
  );

  it.fails("rejects a figure in an `affectsNotes` row", () => {
    // The consequence sentences are where a tradeoff's number actually gets
    // written — "the springs lose 4.5 L of travel" is a claim about a figure,
    // keyed per row, in both locales.
    const entry = makeMod({
      affects: [{ id: "ride", system: "suspension", impact: "degrades" }],
      affectsNotes: {
        en: { ride: "Refill the damper with 0.5 L less oil than stock." },
        es: {
          ride: "Rellene el amortiguador con 0,5 litros menos que el original.",
        },
      },
    });

    expect(issuesUnder(entry, "prose.en.affectsNotes").length).toBeGreaterThan(
      0
    );
    expect(issuesUnder(entry, "prose.es.affectsNotes").length).toBeGreaterThan(
      0
    );
  });

  it.fails("rejects a figure in the title", () => {
    const entry = makeMod({
      titles: { en: "Roof rack, torqued to 100 N·m" },
    });

    expect(issuesUnder(entry, "prose.en.title").length).toBeGreaterThan(0);
  });

  /*
   * The false-positive budget, written down. Every row is green today and
   * must stay green: a rule that flagged these would make the collection
   * unwritable, and the next author would delete the rule rather than fix it
   * (`.claude/GRADER-PRINCIPLES.md`). Several are lifted from the vocabulary
   * T602 actually shipped.
   */
  it.each<[string, "en" | "es", string]>([
    ["a tire size", "en", "The 285/75R16 is the size this entry is about."],
    ["a tire size in ES", "es", "La medida 285/75R16 es la de esta entrada."],
    [
      "a gear ratio",
      "en",
      "Going from 4.3 to 4.9 restores the shorter gearing.",
    ],
    ["a count", "en", "Remove the three bolts and set them aside."],
    ["a numbered count", "es", "Retire los 3 pernos y guárdelos."],
    ["a year", "en", "On 1999 trucks the crossbar is different."],
    ["an inch dimension", "en", "The rack sits 3 in above the roof line."],
    ["a millimetre dimension", "es", "El soporte queda a 51 mm del techo."],
    [
      "a mass, the stated gap",
      "en",
      "A steel drawer weighs about 20 kg empty.",
    ],
    [
      "a mass in ES, the stated gap",
      "es",
      "Una gaveta de acero pesa unos 20 kg.",
    ],
    [
      "a pointer to the figure, with no figure",
      "en",
      "Stay under the roof-load limit in the specification above.",
    ],
    [
      "an engine displacement used as a name",
      "en",
      "The 3.5 L 6G74 does not change what this rack bolts to.",
    ],
    [
      "an engine displacement in ES",
      "es",
      "El 3.5 L 6G74 no cambia dónde se atornilla la parrilla.",
    ],
  ])(
    "accepts tradeoffs prose that states no spec (%s)",
    (_label, locale, text) => {
      const entry = makeMod({ tradeoffs: { [locale]: text } });

      expect(modIssuePaths(entry), `wrongly rejected: ${text}`).toEqual([]);
    }
  );

  it("accepts a numeric claim inside a source title, deliberately", () => {
    /*
     * The carve-out that matters most to this task, and the one a widened
     * detector would break first.
     *
     * Run against the ten shipped wave-1 mods entries, the PRC-03 detector
     * fires on five `sources[].title` strings and on zero prose strings —
     * "…4dr SUV 3.8L V6 4x4 auto…", "…Air Locker RD110… 3000cc…". Those are
     * documents' own titles, quoted, and flagging them would be flagging the
     * citation for citing accurately. T603's grade item is that the author
     * has an alternative typed path, **not** that the citation is forbidden a
     * number; `tests/schemas/mods-citations.test.ts` grades the alternative.
     */
    const entry = makeMod({
      sources: [
        {
          ...makeSource("vendor"),
          title:
            "TEST catalogue — 2003 model 3.8L V6, roof load «100 kg», " +
            "quoted verbatim from a synthetic listing",
        },
      ],
      confidence: "community-consensus",
    });

    expect(modIssuePaths(entry)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 5. Anti-vacuity — the prose rules above are graded through a live parser
 * ---------------------------------------------------------------------- */

describe("the prose graders are not passing on a schema that rejects nothing", () => {
  it("rejects a blank tradeoffs sentence, naming the locale", () => {
    // A present-but-empty locale field is a missing translation (I18N-06),
    // and this is the proof that `issuesUnder(entry, "prose.es.tradeoffs")`
    // can report anything at all — without it, every reject row above could
    // be failing because the path never reports, not because the figure is
    // allowed.
    const entry = makeMod({ tradeoffs: { es: "   " } });

    expect(issuesUnder(entry, "prose.es.tradeoffs").length).toBeGreaterThan(0);
    expect(issuesUnder(entry, "prose.en.tradeoffs")).toEqual([]);
  });

  it("rejects an unknown key inside one locale's prose, naming it", () => {
    const entry = makeMod({ extraProse: { roofLoadKg: 100 } });

    expect(unrecognizedKeys(parseMod(entry))).toContain("roofLoadKg");
    for (const field of OWNED_PROSE_FIELDS) {
      expect(unrecognizedKeys(parseMod(entry))).not.toContain(field);
    }
  });
});
