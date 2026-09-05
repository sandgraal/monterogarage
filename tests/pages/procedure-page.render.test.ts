/**
 * Graders — the procedure page renders PRB-03's notice (PRC-02, render half).
 *
 * > **PRC-02** WHEN a procedure touches a safety-critical system, THE entry
 * > SHALL carry the `safety-critical` flag and **render per PRB-03's notice
 * > rules**.
 *
 * The schema half is `tests/schemas/procedures-safety.test.ts`. This file is
 * the other half, and it exists because of the defect T401's review found by
 * hand (F1): the bilingual-band invariant "was pinned by nothing executable —
 * the reviewer set `readingOrder = [locale]` in `TriageBanner.astro` and `npm
 * run verify` stayed fully green". A schema grader cannot see a template that
 * forgot to draw the band; `astro check` sees a valid array; Pa11y sees no
 * WCAG violation, because a monolingual notice is not an a11y defect. So this
 * file renders the **real page** through Astro's container API and asserts on
 * the emitted HTML, exactly as `tests/problem-bilingual-bands.test.ts` does.
 *
 * ## Reuse, never re-mint — asserted, not asked for
 *
 * T502's task line says `safetyCritical: true` procedures render "via T401's
 * `SafetyNotice.astro` + `ConfidenceCaveat.astro` (reuse, never re-mint — same
 * class-for-class-identical discipline T501 followed once both had merged)".
 * That is gradeable: the assertions below read the *class names and the
 * derived heading id those components emit* (`.safety`, `.safety__title`,
 * `.safety__line`, `aria-labelledby="safety-notice-<system>"`, `.caveat`,
 * `.caveat__line`), and compare every line against `t(locale)` rather than
 * against a copy of the sentence. A page that drew its own band with its own
 * markup fails here even if it says the right words — which is the point: two
 * bands that look alike today drift apart tomorrow.
 *
 * The system-derived heading id is load-bearing for this collection
 * specifically. PR #72 fixed `SafetyNotice.astro`'s `headingId` default *for
 * T502*: "two notices on one page would emit two elements with one id, with
 * `aria-labelledby` resolving to the first, so one notice would announce the
 * other's system".
 *
 * ## How the page is found
 *
 * By glob, not by import specifier — see `tests/helpers/page-modules.ts` for
 * the mechanism, the one naming convention it depends on, and why a missing
 * page has to be a loud failure rather than a silent skip. The canary
 * (`tests/schemas/procedures-seam-contract.test.ts`) proves the glob finds
 * T501's parts pages today, so "no procedures page" is a real absence and not
 * a broken pattern.
 *
 * ## The entry-loading pattern is a hard contract, not a preference
 *
 * **This harness renders the page with `props: { entry }` — T401's pattern —
 * and supports nothing else.** T502's page must read `Astro.props.entry`; a
 * page that instead takes `props: { entryId }` and looks the entry up through
 * `getCollection("procedures")` (T501's pattern) will render nothing here and
 * every marker below will fail for a harness reason rather than for PRC-02.
 *
 * The first draft of this file claimed to support both and passed both props.
 * It did not support both: the `astro:content` mock returns `[]` for
 * `getCollection("procedures")` and `undefined` for `getEntry`, because the
 * content store is a build artefact and `vitest run` happens before `astro
 * build` — so the lookup half was never going to resolve (T502a review, F1).
 * A grader that offers a choice it cannot honour is worse than one that
 * states a constraint, so the choice is gone and the constraint is stated
 * here, on T502's own tasks.md line, and in the failure message below.
 *
 * Making the lookup half work is not a small fix, and it is not free: the
 * store would have to be populated for a collection with zero content files,
 * which means either building first (`vitest` cannot) or mocking the loader
 * (which grades the mock). Passing the parsed entry as a prop is what T401
 * does, it is what the container API is for, and it keeps the fixture the
 * grader controls.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker; T502 activates a grader by deleting exactly that
 * `.fails`.
 *
 * refs specs/001-foundation (PRC-02, PRB-03, PRB-04, I18N-01, I18N-08)
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
// JSDOM is constructed explicitly rather than switching this file to Vitest's
// DOM environment — the note in `tests/locale-switcher.test.ts`: that
// environment turns on Vite's `browser` export condition and Astro's container
// then renders with no server renderer at all.
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { LOCALES, LOCALE_BCP47, type Locale } from "../../src/i18n/routing.ts";
import { COLLECTION_ROUTE_SEGMENTS } from "../../src/i18n/routes.ts";
import { glossarySystemLabel, t } from "../../src/i18n/ui.ts";
import { GLOSSARY_SYSTEMS } from "../../src/schemas/glossary.ts";
import {
  SAFETY_CRITICAL_SYSTEMS,
  isSafetyCritical,
} from "../../src/lib/safety.ts";
import { needsConfidenceCaveat } from "../../src/lib/confidence.ts";
import { CONFIDENCE_TIERS } from "../../src/schemas/entry.ts";
import { parsedProcedureData } from "../helpers/procedures.ts";
import {
  findProcedureDetailPage,
  loadPageComponent,
} from "../helpers/page-modules.ts";
import {
  makeProcedure,
  type ProcedureOptions,
} from "../fixtures/procedure-fixtures.ts";

/*
 * Hoisted, because `vi.mock` factories are lifted above every import and a
 * plain `const` would still be in its temporal dead zone when the first
 * mocked module is pulled in (`src/i18n/routes.ts` imports `entry-slugs`
 * eagerly, and `src/content.config.ts` imports `astro:content`).
 */
const { ENTRY_ID, SLUGS } = vi.hoisted(() => ({
  ENTRY_ID: "test-g3-engine-oil-change",
  SLUGS: { en: "test-procedure", es: "procedimiento-de-prueba" } as Record<
    "en" | "es",
    string
  >,
}));

/*
 * The page renders `BaseLayout`, which renders the vehicle selector, which
 * loads the `vehicles` collection. The content layer's store is a build
 * artefact and `vitest` runs before `astro build`, so the collections are
 * stubbed: the selector degrades to "no taxonomy" and nothing under test is
 * touched by it. The `reference` rows are here because a procedures page has
 * to resolve its `specs[]` ids to render them at all (PRC-03) — a page that
 * could not would fail here for a reason that has nothing to do with the
 * safety notice.
 *
 * Written out literally rather than built with `makeReference`, for the same
 * temporal-dead-zone reason as above: this factory can run before the fixture
 * module has finished evaluating.
 */
vi.mock("astro:content", async (importOriginal) => {
  /*
   * Partial, not total: `tests/helpers/procedures.ts` imports
   * `src/content.config.ts`, which calls the real `defineCollection`. Only the
   * two *content-store* readers are replaced — the store is a build artefact
   * and `vitest run` happens before `astro build`.
   */
  const actual = await importOriginal<Record<string, unknown>>();

  const referenceEntry = (id: string, kind: string, fields: object) => ({
    id,
    data: {
      id,
      fitment: { gens: ["gen3"] },
      kind,
      system: "engine",
      ...fields,
      confidence: "fsm-confirmed",
      sources: [],
      prose: {
        en: { title: `TEST reference ${id}`, summary: "Synthetic fixture." },
        es: { title: `Referencia TEST ${id}`, summary: "Entrada sintética." },
      },
    },
  });

  /*
   * `procedures` **throws** rather than returning `[]` (T502a review, F1).
   *
   * The content store is a build artefact and `vitest run` happens before
   * `astro build`, so this harness cannot serve a procedures lookup — it
   * passes the parsed entry as `props.entry` instead. Returning an empty
   * array would let a page that looks the entry up render an empty shell and
   * fail 35 markers with no hint why; throwing names the contract at the
   * exact call that broke it.
   */
  const unsupportedLookup = (name: string) =>
    new Error(
      `this grader does not serve \`${name}\` through the content store: ` +
        `\`vitest run\` executes before \`astro build\`, so the store is ` +
        `empty. The procedures page must read its entry from ` +
        `\`Astro.props.entry\` (T401's pattern, pinned on T502's tasks.md ` +
        `line) rather than looking it up. See the header of ` +
        `tests/pages/procedure-page.render.test.ts. refs specs/001-foundation`
    );

  /*
   * Which collection a call is about, **whichever call form it used**.
   *
   * `astro:content` accepts `getEntry("procedures", id)` *and*
   * `getEntry({ collection: "procedures", id })`, and `getEntries` takes an
   * array of those reference objects. The first version of this guard compared
   * the first argument to the string `"procedures"`, so the object form walked
   * straight past it and the mock answered `undefined` — a page that looked
   * its entry up rendered an empty "not found" shell and **17 of 35 markers
   * passed against it** (T502a review round 2). That is the same
   * "test that cannot fail" this guard exists to close, surviving in a second
   * spelling: `.claude/GRADER-PRINCIPLES.md`, "grade behavior, not name lists"
   * — a rule that recognises one spelling of a call is a rule with a bypass.
   */
  const collectionOf = (value: unknown): string | undefined => {
    if (typeof value === "string") return value;
    if (typeof value !== "object" || value === null) return undefined;
    const { collection } = value as { collection?: unknown };
    return typeof collection === "string" ? collection : undefined;
  };

  const refuseProcedures = (value: unknown): void => {
    if (collectionOf(value) !== "procedures") return;
    throw unsupportedLookup("procedures");
  };

  return {
    ...actual,
    getCollection: async (name: unknown) => {
      refuseProcedures(name);
      if (collectionOf(name) !== "reference") return [];
      return [
        referenceEntry("test-ref-torque", "torque", {
          torque: { value: 77, unit: "nm" },
        }),
        referenceEntry("test-ref-fluid", "fluid", {
          specification: "TEST SPEC 00W-00",
          capacity: { value: 3.3, unit: "l" },
        }),
        referenceEntry("test-ref-dimension", "dimension", {
          dimension: { value: 1.1, unit: "mm" },
        }),
      ];
    },
    getEntry: async (name: unknown) => {
      refuseProcedures(name);
      return undefined;
    },
    // Plural form, same rule: `getEntries` takes an array of references, so
    // every one of them is checked rather than the array itself.
    getEntries: async (references: unknown) => {
      if (Array.isArray(references)) references.forEach(refuseProcedures);
      else refuseProcedures(references);
      return [];
    },
  };
});

vi.mock("../../src/i18n/entry-slugs.ts", () => {
  const rows: Record<string, Record<string, string>> = { [ENTRY_ID]: SLUGS };
  return {
    ENTRY_SLUGS: { procedures: rows, parts: {} },
    slugRegistryIds: (collection: string) =>
      collection === "procedures" ? Object.keys(rows) : [],
    entrySlug: (collection: string, id: string, locale: string) =>
      collection === "procedures" ? (rows[id]?.[locale] ?? null) : null,
    entrySlugs: (collection: string, id: string) =>
      collection === "procedures" ? (rows[id] ?? null) : null,
  };
});

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

/*
 * The page is resolved **inside each test**, not in `beforeAll`.
 *
 * A `beforeAll` that throws fails the whole *suite* and marks every test
 * `skipped` — which Vitest reports as an error, not as an expected failure,
 * and an `it.fails` marker on a skipped test proves nothing. Resolving it per
 * test means each grader fails on its own, with the message naming the reason
 * (no page yet), which is what the marker is claiming.
 */
async function procedurePage(): Promise<unknown> {
  return loadPageComponent(findProcedureDetailPage(), "procedures detail page");
}

/**
 * The route segment T502 chooses for this collection.
 *
 * Read from the registry rather than written here: which Spanish word this is
 * (`procedimientos`, or whatever the glossary rules) is explicitly T502's
 * call, and a grader that hard-coded a guess would be legislating a bilingual
 * decision it has no standing to make.
 */
function segment(locale: Locale): string {
  const segments = (
    COLLECTION_ROUTE_SEGMENTS as Record<string, Record<Locale, string>>
  )["procedures"];
  if (segments === undefined) {
    throw new Error(
      "`COLLECTION_ROUTE_SEGMENTS` has no `procedures` row — the page cannot " +
        "have a URL in either locale (I18N-01, I18N-05). " +
        "refs specs/001-foundation"
    );
  }
  return segments[locale];
}

/**
 * `getStaticPaths` params for the discovered page, built from the parameter
 * names in its own file path.
 */
function paramsFor(pageKey: string, locale: Locale): Record<string, string> {
  const names = [...pageKey.matchAll(/\[([^\]]+)\]/g)].map(
    (match) => match[1]!
  );
  const params: Record<string, string> = {};

  for (const name of names) {
    if (name === "locale") params[name] = locale;
    else if (/segment/i.test(name)) params[name] = segment(locale);
    else if (/slug/i.test(name)) params[name] = SLUGS[locale];
    else params[name] = locale;
  }
  return params;
}

async function renderPage(
  locale: Locale,
  options: ProcedureOptions = {}
): Promise<Document> {
  const component = await procedurePage();
  const page = findProcedureDetailPage();
  const data = parsedProcedureData(makeProcedure({ id: ENTRY_ID, ...options }));
  const entry = { id: ENTRY_ID, data };
  const params = paramsFor(page?.key ?? "", locale);

  const html = await container.renderToString(
    component as Parameters<typeof container.renderToString>[0],
    {
      params,
      // `entry`, and only `entry` — see "The entry-loading pattern" above.
      props: { entry },
      request: new Request(
        `https://monterogarage.com/${locale}/${segment(locale)}/${SLUGS[locale]}/`
      ),
    }
  );

  return new JSDOM(html).window.document;
}

/** Text of the `lang`-marked descendants of `selector`, keyed by locale. */
function textByLocale(
  doc: Document,
  selector: string,
  childSelector: string
): Partial<Record<Locale, string[]>> {
  const band = doc.querySelector(selector);
  if (band === null) return {};

  const found: Partial<Record<Locale, string[]>> = {};
  for (const locale of LOCALES) {
    const nodes = [
      ...band.querySelectorAll(
        `${childSelector}[lang="${LOCALE_BCP47[locale]}"]`
      ),
    ];
    if (nodes.length > 0) {
      found[locale] = nodes.map((node) => node.textContent?.trim() ?? "");
    }
  }
  return found;
}

const SAFETY_NOTES = {
  en: "TEST hazard note — synthetic, no figures.",
  es: "Nota TEST de riesgo — sintética, sin cifras.",
};

/* -------------------------------------------------------------------------
 * PRB-03's notice, on a procedure page
 * ---------------------------------------------------------------------- */

describe("the safety notice is bilingual on either page (PRC-02, PRB-03)", () => {
  for (const pageLocale of LOCALES) {
    it(`states the notice in every language on the ${pageLocale} page`, async () => {
      const doc = await renderPage(pageLocale, {
        system: "brakes",
        safetyNotes: SAFETY_NOTES,
      });
      const said = textByLocale(doc, ".safety", ".safety__line");

      for (const locale of LOCALES) {
        // The mutation this kills is the one that survived T401's whole
        // pipeline: `readingOrder = [locale]`, which deletes the second
        // language from the notice a reader who does not read the page's
        // language depends on.
        expect(said[locale], `missing ${locale} safety line`).toEqual([
          t(locale).safetyNoticeBody,
        ]);
      }
    });

    it(`names the system in the ${pageLocale} heading`, async () => {
      const doc = await renderPage(pageLocale, {
        system: "brakes",
        safetyNotes: SAFETY_NOTES,
      });
      const strings = t(pageLocale);

      expect(doc.querySelector(".safety__title")?.textContent?.trim()).toBe(
        strings.safetyNoticeLabelTemplate.replace(
          "{system}",
          glossarySystemLabel(strings, "brakes")
        )
      );
    });
  }

  it("labels the notice by an id derived from the system (PR #72)", async () => {
    // Two notices on one page must not share one id: `aria-labelledby`
    // resolves to the first, so one notice would announce the other's system.
    // The default `SafetyNotice.astro` emits is `safety-notice-<system>`.
    const doc = await renderPage("en", {
      system: "steering",
      safetyNotes: SAFETY_NOTES,
    });
    const band = doc.querySelector(".safety");

    expect(band?.getAttribute("aria-labelledby")).toBe(
      "safety-notice-steering"
    );
    expect(doc.querySelector(".safety__title")?.id).toBe(
      "safety-notice-steering"
    );
  });
});

/* -------------------------------------------------------------------------
 * Composition — the notice appears exactly when `src/lib/safety.ts` says so
 * ---------------------------------------------------------------------- */

describe("the notice is conditioned on src/lib/safety.ts, not on the template (PRC-02)", () => {
  it.each(GLOSSARY_SYSTEMS)(
    "a `%s` procedure shows the notice iff the entry is safety-critical",
    async (system) => {
      const safetyCritical = (
        SAFETY_CRITICAL_SYSTEMS as readonly string[]
      ).includes(system);
      const doc = await renderPage("en", {
        system,
        ...(safetyCritical ? { safetyNotes: SAFETY_NOTES } : {}),
      });

      expect(doc.querySelector(".safety") !== null).toBe(safetyCritical);
      // The page's answer and the library's answer are the same answer.
      expect(doc.querySelector(".safety") !== null).toBe(
        isSafetyCritical({ system })
      );
    }
  );

  it("shows the notice on a promoted procedure (SRS, jacking, towing)", async () => {
    // The case `system` alone cannot reach — AGENTS.md's safety-critical
    // categories with no `GLOSSARY_SYSTEMS` id of their own.
    const doc = await renderPage("en", {
      system: "engine",
      safetyCritical: true,
      safetyNotes: SAFETY_NOTES,
    });

    expect(doc.querySelector(".safety")).not.toBeNull();
  });

  it("shows no notice on an ordinary job", async () => {
    // The positive control. A page that always drew the band would satisfy
    // every assertion above and make the notice meaningless.
    const doc = await renderPage("en");

    expect(doc.querySelector(".safety")).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * PRB-04's caveat — the second component T502 must reuse rather than re-mint
 * ---------------------------------------------------------------------- */

describe("the confidence caveat is the shared component (PRC-02, PRB-04)", () => {
  it.each(CONFIDENCE_TIERS)(
    "a `%s` procedure shows the caveat iff src/lib/confidence.ts says so",
    async (tier) => {
      const doc = await renderPage("en", {
        confidence: tier,
        ...(tier === "fsm-confirmed" || tier === "tsb" ? {} : { sources: [] }),
      });

      expect(doc.querySelector(".caveat") !== null).toBe(
        needsConfidenceCaveat(tier)
      );
    }
  );

  it.each(LOCALES)(
    "states the caveat in both languages on the %s page",
    async (pageLocale) => {
      const doc = await renderPage(pageLocale, {
        confidence: "anecdotal",
        sources: [],
      });
      const said = textByLocale(doc, ".caveat", ".caveat__line");

      for (const locale of LOCALES) {
        expect(said[locale], `missing ${locale} caveat line`).toBeDefined();
      }
    }
  );
});

/* -------------------------------------------------------------------------
 * The entry's own safety notes reach the page
 *
 * PRC-01's ninth field is not the standing notice — that sentence is the same
 * on every safety-critical page. These are *this job's* hazards, and a schema
 * that required them (see `procedures-safety.test.ts`) while the page never
 * rendered them would be a field authors fill in for nobody.
 * ---------------------------------------------------------------------- */

describe("the entry's own safety notes render (PRC-01)", () => {
  it.each(LOCALES)(
    "renders the entry's own safety note on the %s page",
    async (locale) => {
      const doc = await renderPage(locale, {
        system: "brakes",
        safetyNotes: SAFETY_NOTES,
      });

      expect(doc.body.textContent).toContain(SAFETY_NOTES[locale]);
    }
  );

  it("does not leak the other locale's note into the page", async () => {
    // Unlike the standing notice, the entry's own note is page-locale prose:
    // both locales' sentences in one column is how a bilingual page becomes
    // an unreadable one (the F8 reading recorded on T401).
    const doc = await renderPage("en", {
      system: "brakes",
      safetyNotes: SAFETY_NOTES,
    });

    expect(doc.body.textContent).not.toContain(SAFETY_NOTES.es);
  });
});
