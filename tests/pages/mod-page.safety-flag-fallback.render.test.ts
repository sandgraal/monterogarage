/**
 * T601a — the safety-critical **flag-only fallback is suppressed** whenever any
 * unrelated system was already promoted (T601 review, finding F4).
 *
 * ## The defect, in one sentence
 *
 * `src/pages/[locale]/[modsSegment]/[modSlug].astro` derives which bands to
 * draw as
 *
 * ```ts
 * const safetySystems =
 *   safety.systems.length > 0 ? safety.systems : [data.system];
 * ```
 *
 * — so the flag-only fallback is gated on the promoted set being **empty at
 * all**, not on *the specific reason this entry carries `safetyCritical: true`*
 * being uncovered. An entry that has BOTH an ordinary `affects` row hitting a
 * real `SAFETY_CRITICAL_SYSTEMS` member AND the flag set for one of AGENTS.md's
 * three no-system-id hazards (SRS/airbags, tires and load ratings, towing /
 * jacking / lifting points) renders only the band for the first. The hazard the
 * flag exists to surface appears **nowhere on the page**, and nothing is red.
 *
 * `src/lib/safety.ts` states the premise this depends on: SRS/airbags and load
 * ratings "still rely on an author writing `safetyCritical: true` by hand,
 * which is a known, named gap and not a silent one." That sentence is only true
 * while writing the flag by hand actually produces a notice. Today it can be
 * written correctly and produce nothing.
 *
 * ## How it was found, and that it is real
 *
 * An independent fact-checker on the T602 content branch
 * (`feat/001-t602-mods-wave-1`) hit it by executing the built pages, not by
 * reading the diff. Three shipped-shape entries, reproduced faithfully in the
 * fixtures below (`src/content/mods/` on that branch — quoted here, never
 * depended on: this file's corpus is entirely its own):
 *
 *  · `gen3-body-steel-front-bumper` — `system: body`, `safetyCritical: true`
 *    for an **SRS/airbag-timing** hazard filed `system: interior` (not a
 *    critical system), plus a constant-weight row filed `system: suspension`
 *    (which is). Renders "Safety notice — Suspension" and nothing else. The
 *    airbag hazard — the single most consequential sentence on the page — has
 *    no band at all.
 *  · `gen3-body-roof-rack-and-roof-load` — `system: body`,
 *    `safetyCritical: true` for a **load-rating** hazard, plus a
 *    `suspension` row. Identical outcome.
 *  · `gen3-body-steel-side-rails` — `system: body`, `safetyCritical: true` for
 *    a **jacking-point** hazard, and both `affects` rows filed `body`. This one
 *    is **not** the defect: the promoted set is empty, so the existing fallback
 *    fires and a `body` band renders. Recorded because assuming all three are
 *    the same shape is how the working direction gets broken by the fix — it is
 *    the inverse control in `describe("controls")` below.
 *
 * ## What the fix has to do, and what this file deliberately does not ask for
 *
 * **Additive, never replacing.** The system-derived bands are correct — they
 * name real hazards derived from real rows — so the flag's band is drawn *in
 * addition to* them. A fix that swapped one omission for another (dropping
 * "Suspension" to make room for "Body") is the mirror-image defect, and
 * `describe("controls")` fails on it.
 *
 * **"Already covered" can only mean one thing today.** The schema records that
 * an entry is safety-critical; it records nothing about *which* hazard the flag
 * stands for. So the only mechanically-checkable reading of "the flagged reason
 * is already covered" is "the entry's own `system` is already among the
 * promoted ones" — which is exactly the case where the fallback band would be a
 * literal duplicate of a band already on the page. Anything richer (knowing
 * that a `wheels-tires` row covers a load-rating flag) needs a hazard taxonomy
 * the collection does not have, and inventing one is an AGENTS.md
 * "Boundaries" stop-and-ask. **This file does not ask for one.**
 *
 * The cost of that limit is one arguably-redundant band on an entry whose flag
 * happens to stand for a hazard some other row already names. The cost of the
 * status quo is a real SRS hazard with no band at all. Over-notifying is the
 * safe failure direction here, and it is chosen on purpose.
 *
 * **Standing owner decision this file is downstream of.** Because there is no
 * hazard taxonomy, these graders necessarily require the flag's band to name
 * the entry's own `system` — "Safety notice — Body" for an SRS hazard on a
 * `body`-filed bumper, which says *where* to look and not *what* the hazard
 * is. That is the existing flag-only fallback's own vocabulary, deliberately
 * reused rather than re-minted. If a hazard taxonomy is ever ratified (a
 * separate AGENTS.md "Boundaries" stop-and-ask), the correct heading becomes
 * the hazard, and **the assertions in this file that name `body`,
 * `interior` and `electrical` as the flag's band all need rewriting** — they
 * are not incidental. Recorded on T601a's `tasks.md` line as an open
 * follow-up, not only here.
 *
 * **A band is a WARNING, not a heading.** Every id/heading/region assertion
 * below is also satisfied by a bespoke `<section><h2>…</h2></section>` with
 * nothing under it — which would put a label on the page where AGENTS.md asks
 * for the standing bilingual notice and the "see a qualified mechanic"
 * framing. Two graders therefore count `safetyNoticeBody` occurrences and
 * require one per band, per locale (review F-A). Keep using
 * `SafetyNotice.astro` and this is free.
 *
 * **Where the fix lands is mostly not graded — with one route to avoid.**
 * Correcting the page's `safetySystems` derivation satisfies everything below,
 * and so does giving `ModSafety` a **new** field for the flag's own band. What
 * does *not* work is the naive `modSafety` route: pushing the entry's own
 * `system` into `ModSafety.systems` when the flag is set turns every grader in
 * this file green **and turns `tests/lib/mods/safety.test.ts:42` red** — an
 * existing, correct assertion that a flag-only verdict reports `systems: []`,
 * because that array is documented as *the systems that are the reason*, and
 * a flag-only entry has none (review F-B). Do not "fix" that grader; it is
 * right. The graders here read the rendered page, per
 * `.claude/GRADER-PRINCIPLES.md` ("grade the end state, not the text").
 *
 * ## Expected-failure convention (read before editing)
 *
 * Graders for behaviour that does not exist yet are declared `it.fails(...)` /
 * `it.fails.each(...)`, the convention `tests/schemas/collections.test.ts`
 * established. The marker is the literal text `.fails` on the `it` line and
 * nothing else: the implementer activates a grader by **deleting exactly that
 * `.fails`**. Leaving one on after the fix lands turns the suite red ("expected
 * test to fail"), so activation cannot be forgotten silently. `it.fails.each`
 * is one marker line covering its whole table.
 *
 * Every expected failure has a control beside it in `describe("controls")` that
 * is **green today and must stay green after the fix** — including the two
 * directions a careless fix breaks (an unflagged entry gaining a band it should
 * not have; a flagged entry losing the bands it already had).
 *
 * This file is a `[TEST]`-role artefact. Implementers must not otherwise edit
 * it (AGENTS.md separation rule, audited by T901). It exists because T601 is on
 * that ledger: its self-authored grader pinned the F1 defect as the
 * specification, which is the failure mode an independent pass exists to catch.
 *
 * ## Fixtures
 *
 * Every id is synthetic and in this file's own reserved `test-mod-t601a-`
 * namespace; every title carries `TEST` / `PRUEBA`; the one cited source is at
 * `example.invalid`. Nothing here names a real part, a real vendor, or a real
 * document, so nothing can leak into content.
 *
 * refs specs/001-foundation (T601a; MOD-01; AGENTS.md "Safety and legal")
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { glossarySystemLabel, t } from "../../src/i18n/ui.ts";
import type { GlossarySystem } from "../../src/schemas/glossary.ts";

type Locale = "en" | "es";

const LOCALES: readonly Locale[] = ["en", "es"];

const MODS_SEGMENT: Record<Locale, string> = {
  en: "mods",
  es: "modificaciones",
};

/* -------------------------------------------------------------------------
 * The corpus
 *
 * Every fixture is `modEntry(id, { … })` — one shape, so the only thing that
 * differs between two fixtures is the thing under test.
 * ---------------------------------------------------------------------- */

interface AffectsRow {
  readonly id: string;
  readonly system: string;
  readonly impact: "breaks" | "degrades" | "needs-adjustment";
}

function modEntry(
  id: string,
  extra: {
    system: string;
    safetyCritical?: boolean;
    affects?: readonly AffectsRow[];
  }
) {
  const affects = extra.affects ?? [];
  const notes = Object.fromEntries(
    affects.map((row) => [row.id, `TEST note for ${row.id}.`])
  );
  const notesEs = Object.fromEntries(
    affects.map((row) => [row.id, `Nota TEST sobre ${row.id}.`])
  );
  return {
    id,
    data: {
      id,
      fitment: { gens: ["gen3"] },
      cost: { from: "moderate", to: "significant" },
      difficulty: 3,
      requires: [],
      confidence: "community-consensus",
      sources: [
        {
          title: "TEST fixture source — not a real document",
          url: "https://example.invalid/t601a/source",
          archiveUrl:
            "https://web.archive.org/web/20260101000000/" +
            "https://example.invalid/t601a/source",
          accessed: "2026-09-05",
          kind: "forum",
        },
      ],
      prose: {
        en: {
          title: `TEST ${id}`,
          summary: "Synthetic T601a fixture.",
          tradeoffs: "TEST tradeoffs sentence in English.",
          affectsNotes: notes,
        },
        es: {
          title: `PRUEBA ${id}`,
          summary: "Entrada sintética de T601a.",
          tradeoffs: "Frase TEST de contras en español.",
          affectsNotes: notesEs,
        },
      },
      ...extra,
      affects,
    },
  };
}

/*
 * THE DEFECT. Filed `body` (on no list), flagged for an SRS/airbag hazard that
 * has no system id of its own and is therefore filed `interior` (also on no
 * list), and carrying one ordinary weight row filed `suspension` (which IS on
 * the list). `modSafety` promotes `suspension` alone, the promoted set is
 * non-empty, the fallback never fires, and the airbag hazard gets no band.
 *
 * This is `gen3-body-steel-front-bumper`'s shape, with real prose replaced.
 */
const FLAG_PLUS_SYSTEM_ID = "test-mod-t601a-flag-plus-system";

/*
 * The same defect with TWO promoted systems, so "the flag's band is added"
 * cannot be satisfied by a fix that renders a fixed number of bands, and
 * "every system-derived band survives" is graded against more than one.
 */
const FLAG_PLUS_TWO_ID = "test-mod-t601a-flag-plus-two-systems";

/*
 * INVERSE CONTROL — green today, must stay green. The flag with nothing
 * covering it and nothing else promoted: the pre-existing fallback path, which
 * this fix must not weaken. `gen3-body-steel-side-rails`' shape.
 */
const FLAG_ONLY_ID = "test-mod-t601a-flag-only";

/*
 * POSITIVE CONTROL — green today, must stay green. The flag on an entry whose
 * OWN system is already promoted, so a fallback band would be a literal
 * duplicate of a band already on the page. Exactly one band, one id.
 */
const FLAG_COVERED_ID = "test-mod-t601a-flag-covered";

/*
 * MIRROR-IMAGE CONTROL — green today, must stay green. No flag at all, one
 * promoted system. A fix that appends `data.system` unconditionally rather
 * than only for the flag turns this red by adding an `electrical` band that
 * names no hazard — the T601 F1 defect coming back through the fix.
 */
const NO_FLAG_ID = "test-mod-t601a-no-flag";

/* ANTI-VACUITY CONTROL — nothing critical anywhere: zero bands. */
const QUIET_ID = "test-mod-t601a-quiet";

/* The `it.fails.each` table's three rows, one fixture each. */
const REPRO_BUMPER_ID = "test-mod-t601a-repro-bumper";
const REPRO_RACK_ID = "test-mod-t601a-repro-rack";
const REPRO_FUEL_ID = "test-mod-t601a-repro-fuel";

const ENTRIES = [
  modEntry(FLAG_PLUS_SYSTEM_ID, {
    system: "body",
    safetyCritical: true,
    affects: [
      { id: "srs-timing", system: "interior", impact: "breaks" },
      { id: "front-spring-weight", system: "suspension", impact: "degrades" },
    ],
  }),
  modEntry(FLAG_PLUS_TWO_ID, {
    system: "body",
    safetyCritical: true,
    affects: [
      { id: "abs-module", system: "brakes", impact: "breaks" },
      { id: "front-spring-weight", system: "suspension", impact: "degrades" },
    ],
  }),
  modEntry(FLAG_ONLY_ID, {
    system: "interior",
    safetyCritical: true,
    affects: [{ id: "trim-panel", system: "interior", impact: "degrades" }],
  }),
  modEntry(FLAG_COVERED_ID, {
    system: "brakes",
    safetyCritical: true,
    affects: [{ id: "pad-wear", system: "brakes", impact: "degrades" }],
  }),
  modEntry(NO_FLAG_ID, {
    system: "electrical",
    affects: [{ id: "abs-module", system: "brakes", impact: "breaks" }],
  }),
  modEntry(QUIET_ID, {
    system: "electrical",
    affects: [{ id: "wiring", system: "electrical", impact: "degrades" }],
  }),
  modEntry(REPRO_BUMPER_ID, {
    system: "body",
    safetyCritical: true,
    affects: [
      { id: "srs-timing", system: "interior", impact: "breaks" },
      { id: "clearance", system: "body", impact: "needs-adjustment" },
      {
        id: "front-spring-weight",
        system: "suspension",
        impact: "needs-adjustment",
      },
    ],
  }),
  modEntry(REPRO_RACK_ID, {
    system: "body",
    safetyCritical: true,
    affects: [
      { id: "dynamic-limit", system: "body", impact: "needs-adjustment" },
      { id: "roof-weight", system: "suspension", impact: "needs-adjustment" },
    ],
  }),
  modEntry(REPRO_FUEL_ID, {
    system: "electrical",
    safetyCritical: true,
    affects: [{ id: "tank-line", system: "fuel", impact: "degrades" }],
  }),
];

vi.mock("astro:content", () => ({
  getCollection: async (name: string) => (name === "mods" ? ENTRIES : []),
}));

const MOD_SLUGS: Record<string, Record<Locale, string>> = Object.fromEntries(
  ENTRIES.map((entry) => [
    entry.id,
    { en: entry.id, es: `es-${entry.id}` } as Record<Locale, string>,
  ])
);

vi.mock("../../src/i18n/entry-slugs.ts", () => {
  const table: Record<string, Record<string, Record<Locale, string>>> = {
    mods: MOD_SLUGS,
    parts: {},
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

let render: (locale: Locale, entryId: string) => Promise<string>;

beforeAll(async () => {
  const { experimental_AstroContainer } = await import("astro/container");
  const container = await experimental_AstroContainer.create();
  const page =
    await import("../../src/pages/[locale]/[modsSegment]/[modSlug].astro");

  render = (locale, entryId) =>
    container.renderToString(page.default, {
      params: {
        locale,
        modsSegment: MODS_SEGMENT[locale],
        modSlug: MOD_SLUGS[entryId]?.[locale] ?? "",
      },
      props: { entryId },
    });
});

/* -------------------------------------------------------------------------
 * Reading the rendered page
 * ---------------------------------------------------------------------- */

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
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every safety band on the page, by the system its heading id names.
 *
 * Read from the heading `id`, which is the same string `SafetyNotice` puts in
 * the region's `aria-labelledby` — so this is the set of bands a screen reader
 * announces, not a count of anything that merely looks like one. Returned as
 * an array (not a Set) so a duplicate id is visible to the caller: two regions
 * sharing one id is the `aria-labelledby` cross-resolution `SafetyNotice`'s
 * derived-id design exists to prevent.
 */
function safetyNoticeSystems(html: string): string[] {
  return [...html.matchAll(/\bid="safety-notice-([a-z-]+)"/g)].map(
    (match) => match[1] as string
  );
}

/** The heading text `SafetyNotice` renders for `system`, in `locale`. */
function safetyHeading(locale: Locale, system: GlossarySystem): string {
  const strings = t(locale);
  return strings.safetyNoticeLabelTemplate.replace(
    "{system}",
    glossarySystemLabel(strings, system)
  );
}

/**
 * How many times `needle` occurs in `haystack` — non-overlapping, literal.
 *
 * `split` rather than a `RegExp`, because the needles here are translated UI
 * strings full of characters a regex would read as syntax.
 */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * The standing warning sentence itself, counted per locale.
 *
 * A heading is a label; `safetyNoticeBody` is the warning AGENTS.md actually
 * requires ("a standing bilingual safety notice on the page", and the site is
 * "never presented as a substitute for a qualified mechanic"). `SafetyNotice`
 * renders it once per band **per locale**, so the count of either locale's
 * sentence is the count of real, complete notices on the page — which is what
 * distinguishes a genuine band from a bespoke heading with nothing under it
 * (review F-A).
 */
function completeNoticeCount(html: string, locale: Locale): number {
  return countOccurrences(text(html), t(locale).safetyNoticeBody);
}

/* -------------------------------------------------------------------------
 * The defect (T601 review, F4) — expected failures
 * ---------------------------------------------------------------------- */

describe("a flagged hazard with no system id, on a page that already has a band", () => {
  it("renders the flag's OWN band ALONGSIDE the system-derived one", async () => {
    /*
     * `test-mod-t601a-flag-plus-system` is `body`-filed, flagged for an
     * SRS hazard, and carries a `suspension` row. Both ids are named
     * explicitly rather than counted: "at least two bands render" would be
     * satisfied by a fix that drew the wrong two, and T601's F2 is this
     * repo's own record of what an under-specified safety grader costs.
     *
     * `body` is the flag's band because that is the entry's own `system` —
     * the same string the existing flag-only fallback already uses, and
     * therefore not a new vocabulary this grader is inventing.
     */
    for (const locale of LOCALES) {
      const html = await render(locale, FLAG_PLUS_SYSTEM_ID);
      expect(html).toContain('id="safety-notice-suspension"');
      expect(html).toContain('id="safety-notice-body"');
    }
  });

  it("names the flagged system in words, in both locales", async () => {
    // The id is the machine's handle; the heading is what a reader sees, and
    // the two can drift. Both locales, because "standing bilingual safety
    // notice" is AGENTS.md's own phrase.
    for (const locale of LOCALES) {
      const body = text(await render(locale, FLAG_PLUS_SYSTEM_ID));
      expect(body).toContain(safetyHeading(locale, "body"));
      expect(body).toContain(safetyHeading(locale, "suspension"));
    }
  });

  it("gives the flag's band a labelled region of its own (aria-labelledby)", async () => {
    /*
     * A heading with no region pointing at it is decoration. `SafetyNotice`
     * puts `headingId` in both places; this asserts the region side, so a
     * fix that emitted bare heading text would still be red.
     */
    const html = await render("en", FLAG_PLUS_SYSTEM_ID);
    expect(html).toContain('aria-labelledby="safety-notice-body"');
    expect(html).toContain('aria-labelledby="safety-notice-suspension"');
  });

  it("makes the flag's band a REAL notice — one bilingual WARNING per band", async () => {
    /*
     * Review F-A. Everything above grades the band's heading, its id and its
     * region — all of which a bespoke `<section><h2>…</h2></section>` would
     * satisfy while carrying no warning at all. AGENTS.md requires the
     * standing bilingual notice and the "see a qualified mechanic" framing,
     * which live in `safetyNoticeBody`, not in the heading.
     *
     * So: the count of warning sentences equals the count of bands. Two
     * bands on `test-mod-t601a-flag-plus-system`, therefore two sentences —
     * which fails in BOTH failure directions at once. Too few means the
     * added band is a heading with nothing under it; too many means a
     * duplicated or orphaned warning. Counted in each locale independently
     * because `SafetyNotice` carries both languages in every band, so a
     * band that lost one of them is a half-bilingual notice and red here.
     */
    for (const locale of LOCALES) {
      const html = await render(locale, FLAG_PLUS_SYSTEM_ID);
      const bands = safetyNoticeSystems(html).length;
      expect(bands).toBe(2);
      expect(completeNoticeCount(html, "en")).toBe(bands);
      expect(completeNoticeCount(html, "es")).toBe(bands);
    }
  });

  it("is ADDITIVE — every system-derived band survives the flag's arrival", async () => {
    /*
     * The load-bearing half of the fix's shape. `test-mod-t601a-flag-plus-
     * two-systems` promotes `brakes` and `suspension` and is flagged for a
     * `body`-filed hazard, so the correct page carries exactly three bands.
     *
     * Asserted as an exact set, in both directions:
     *  · all three present — a fix that REPLACED the system-derived bands
     *    with the flag's one (trading one omission for another, the
     *    mirror-image defect) fails here;
     *  · exactly three, all distinct — a fix that appended the flag's band
     *    unconditionally, or twice, fails here too.
     * Order is deliberately NOT asserted: which band reads first is a
     * presentation decision this grader has no standing to pin.
     */
    for (const locale of LOCALES) {
      const systems = safetyNoticeSystems(
        await render(locale, FLAG_PLUS_TWO_ID)
      );
      expect([...systems].sort()).toEqual(["body", "brakes", "suspension"]);
      expect(new Set(systems).size).toBe(3);
    }
  });

  it.each<[string, string, readonly string[]]>([
    [
      "SRS/airbag flag behind a suspension row (steel-front-bumper shape)",
      REPRO_BUMPER_ID,
      ["body", "suspension"],
    ],
    [
      "load-rating flag behind a suspension row (roof-rack shape)",
      REPRO_RACK_ID,
      ["body", "suspension"],
    ],
    [
      "no-system-id flag behind a fuel row (a third system, so the table " +
        "cannot be satisfied by hardcoding `suspension`)",
      REPRO_FUEL_ID,
      ["electrical", "fuel"],
    ],
  ])("draws both bands: %s", async (_name, entryId, expected) => {
    // The three shipped shapes the T602 fact-checker executed, reproduced
    // structurally. Each expects the entry's own system AND the promoted
    // one, as an exact sorted set.
    const systems = safetyNoticeSystems(await render("en", entryId));
    expect([...systems].sort()).toEqual([...expected].sort());
  });
});

/* -------------------------------------------------------------------------
 * Controls — green today, and every one of them must still be green after the
 * fix. These are what stop the fix from trading this defect for another.
 * ---------------------------------------------------------------------- */

describe("controls", () => {
  it("renders every fixture at all (so the negative assertions mean something)", async () => {
    // Anti-vacuity. A page that threw, or rendered nothing, would satisfy
    // every `not.toContain` and every zero-length expectation below.
    for (const entry of ENTRIES) {
      for (const locale of LOCALES) {
        const body = text(await render(locale, entry.id));
        expect(body).toContain(
          locale === "en" ? `TEST ${entry.id}` : `PRUEBA ${entry.id}`
        );
      }
    }
  });

  it("INVERSE: the flag alone, with nothing promoted, still falls back", async () => {
    /*
     * The direction that already works, and the reason it is here: this fix
     * edits the exact expression that implements it. `test-mod-t601a-flag-
     * only` is `interior`-filed with an `interior` row, so nothing is
     * promoted and the flag's band is the only band.
     */
    for (const locale of LOCALES) {
      const html = await render(locale, FLAG_ONLY_ID);
      expect(safetyNoticeSystems(html)).toEqual(["interior"]);
      expect(text(html)).toContain(safetyHeading(locale, "interior"));
    }
  });

  it("INVERSE: that fallback band still carries the bilingual WARNING", async () => {
    /*
     * Review F-A, the control half. The fix rewrites the expression that
     * produces this page's only band, so a fix that replaced `SafetyNotice`
     * with bespoke markup would strip the actual warning from
     * `gen3-body-steel-side-rails`' shape — the one entry of the three that
     * works today — while every heading-and-id grader stayed green. Exactly
     * one band, therefore exactly one warning sentence per locale, and both
     * languages present regardless of which locale the page is in.
     */
    for (const locale of LOCALES) {
      const html = await render(locale, FLAG_ONLY_ID);
      expect(completeNoticeCount(html, "en")).toBe(1);
      expect(completeNoticeCount(html, "es")).toBe(1);
    }
  });

  it("POSITIVE: a flag whose own system is already promoted adds no duplicate", async () => {
    /*
     * `test-mod-t601a-flag-covered` is `brakes`-filed, flagged, with a
     * `brakes` row: `modSafety` promotes `brakes` once, and the flag's band
     * would name the same system. One band, one id — two regions sharing the
     * id `safety-notice-brakes` is precisely the `aria-labelledby`
     * cross-resolution `SafetyNotice`'s derived id was built to avoid.
     *
     * This is the honest limit of the rule: "already covered" can only mean
     * "the entry's own system is already promoted", because nothing in the
     * schema says which hazard the flag stands for. See this file's header.
     */
    for (const locale of LOCALES) {
      const html = await render(locale, FLAG_COVERED_ID);
      expect(safetyNoticeSystems(html)).toEqual(["brakes"]);
      expect(text(html)).toContain(safetyHeading(locale, "brakes"));
    }
  });

  it("MIRROR IMAGE: an UNFLAGGED entry gains no band for its own system", async () => {
    /*
     * The cheapest wrong fix is `[...safety.systems, data.system]` with no
     * flag condition. `test-mod-t601a-no-flag` is `electrical`-filed and
     * breaks the `brakes` with no flag set — exactly T601 F1's fixture — so
     * that fix would put "Safety notice — Electrical system" back on the
     * page, which is the defect F1 closed. Both directions asserted.
     */
    for (const locale of LOCALES) {
      const html = await render(locale, NO_FLAG_ID);
      expect(safetyNoticeSystems(html)).toEqual(["brakes"]);
      const body = text(html);
      expect(body).toContain(safetyHeading(locale, "brakes"));
      expect(body).not.toContain(safetyHeading(locale, "electrical"));
    }
  });

  it("QUIET: an entry that touches nothing critical still renders no band", async () => {
    for (const locale of LOCALES) {
      const html = await render(locale, QUIET_ID);
      expect(safetyNoticeSystems(html)).toEqual([]);
      expect(text(html)).not.toContain(t(locale).safetyCriticalChipLabel);
    }
  });

  it("the safety-critical chip is on every flagged fixture, before and after", async () => {
    // The chip and the band are two separate renders of one verdict. If a fix
    // moved the band and left the chip behind (or vice versa) the page would
    // contradict itself, so the chip is pinned on the same fixtures.
    for (const entryId of [
      FLAG_PLUS_SYSTEM_ID,
      FLAG_PLUS_TWO_ID,
      FLAG_ONLY_ID,
      FLAG_COVERED_ID,
      NO_FLAG_ID,
    ]) {
      for (const locale of LOCALES) {
        expect(text(await render(locale, entryId))).toContain(
          t(locale).safetyCriticalChipLabel
        );
      }
    }
  });
});
