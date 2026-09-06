/**
 * The procedures **index** page, rendered and driven (T504a, PRC-01, SCF-06).
 *
 * ## Why this file exists, and why its author is not T502's
 *
 * `src/pages/[locale]/[proceduresSegment].astro` shipped in T502 with no
 * render grader of any kind, and T502's own reviewer deferred writing one
 * (AGENTS.md's `[TEST]`-debt ledger, T502 entry, 2026-09-05) for two reasons:
 * the collection was empty, so a grader would have had nothing to render
 * against; and having the page's own author write the grader for his own
 * freshly-written page is exactly the failure mode T601-F2 recorded — a
 * grader that encodes what the code does rather than what the spec asks for.
 * T504 authored the eight wave-1 entries; this file is the other half of that
 * pair, written against `spec.md` and the task line, by a different agent.
 *
 * ## What it grades, in the task line's own four terms
 *
 *  1. **cards render** — one card per entry, in each locale's own prose, with
 *     the system label, the difficulty and time chips, the safety chip on the
 *     brake jobs and on nothing else, and the confidence caveat only below
 *     `tsb`.
 *  2. **hrefs resolve** — every card's link target is checked against the set
 *     of routes the *detail* page's own `getStaticPaths` actually builds, in
 *     both directions. A string-shape assertion ("starts with `/en/`") cannot
 *     tell a working URL from a plausible 404, and the bare-route defect T501
 *     shipped on two pages at once is precisely a plausible 404.
 *  3. **filters work** — each of the four system pills narrows the list to
 *     exactly the cards of that system, `All systems` restores every card, and
 *     the count line and the no-results line follow.
 *  4. **T204's provisional-match indicator** — visible on the transfer-case
 *     job and on nothing else, in both locales, naming the facet the reader
 *     was never asked about; and *not* visible on a row that simply does not
 *     fit, which is a different state with different words.
 *
 * ## The corpus is the real content, not a mirror of it
 *
 * `getCollection` is mocked to read `src/content/procedures/*.json` off disk
 * and parse each file through the **registered** collection schema
 * (`tests/helpers/procedures.ts`), so what this page is handed here is what
 * Astro hands it in a real build. Two consequences worth stating:
 *
 *  · Nothing in this file invents a procedure. AGENTS.md treats fabricated
 *    reference content as the highest-consequence hallucination in this
 *    domain, and a procedure fixture that reads like a real job is one
 *    copy-paste away from becoming one. The one synthetic entry this file does
 *    add — for the confidence caveat, which no real wave-1 entry can trigger
 *    because all eight are `fsm-confirmed` — is built by the repo's own
 *    `makeProcedure`, so it carries a `test-`-prefixed id and says `TEST` in
 *    both locales' prose, the reserved namespace every other grader here uses.
 *  · The expectations are derived from the corpus, not hard-coded against it.
 *    "One card per entry" is over whatever is on disk; "these systems get
 *    pills" is over the systems present; "this entry is a provisional match"
 *    is over the FIT-03 rule (a fitment facet outside the gen/market/year/
 *    engine quadruple), not over a list of ids. Wave 2 adding entries must not
 *    turn this file red, and a wave-2 entry with a `transmissions` restriction
 *    must be picked up by the provisional graders without anyone editing them.
 *
 *    The one thing that *is* pinned by id is the corpus contract in the first
 *    describe block, which fails loudly and by name if T504's still-running
 *    fact-check or bilingual review changes a slug or a fitment facet out from
 *    under this file. That is deliberate: a silent re-derivation would let the
 *    provisional graders quietly become vacuous.
 *
 * ## The seam, and why the behavioural half needs one
 *
 * Astro compiles a page's `<script>` into a client module
 * (`…astro?astro&type=script&index=0&lang.ts`). Under Vitest's SSR transform
 * that module resolves to an **empty** module — verified, not assumed: this
 * file's author imported it, got `Object.keys(mod) === []`, and watched every
 * click do nothing while the DOM and the roots were confirmed correct. So
 * `vitest` cannot execute the page's own wiring, and "filters work" and "the
 * provisional indicator shows" are not gradeable here at all while the wiring
 * lives inline in the template.
 *
 * The repo already answers this shape of problem the same way three times —
 * `rememberLocaleFromClick`, `matchesProceduresFilter`,
 * `createVehicleListingView` are all wiring pulled out of a template so a
 * jsdom test can drive it. This file requires the last piece:
 *
 *     src/lib/procedures/index-view.ts
 *       export function enhanceProceduresIndex(
 *         root: HTMLElement,
 *         win: Window,
 *       ): ProceduresIndexView | null
 *
 * It is a **move, not a rewrite**: the body is the template's existing
 * `enhance()` with `document`/`window` taken as `win` instead of read off the
 * global, returning `null` for a root with no toolbar (the empty state) and a
 * handle with `apply()` / `destroy()` otherwise. The page `<script>` becomes
 * the two lines that call it. The stub committed with this file throws
 * `not implemented: T504a`; every grader below marked `it.fails` fails for
 * that one reason and no other.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker, one line per test — delete exactly that `.fails`
 * to activate a grader. Every marked grader in this file was proved to go
 * green *for the right reason* before the file was committed: the author
 * wrote a scratch `enhanceProceduresIndex` (the verbatim move described
 * above), deleted every `.fails`, ran the suite green, and then reverted the
 * scratch implementation to the throwing stub. "Simulate the activation, do
 * not argue it from the diff."
 *
 * ## What this file still cannot see
 *
 * That the page's `<script>` actually *calls* the seam. A lib that works and a
 * page that never imports it would pass every behavioural grader here while
 * the shipped page stayed inert. `the page delegates its wiring to the seam`
 * below closes that with a source-text read of the template, which is the
 * weakest assertion in the file and is here because Vitest has no stronger
 * one available; the browser-level version belongs to `tests/e2e/`.
 *
 * refs specs/001-foundation (PRC-01, SCF-06, FIT-01, FIT-03, I18N-01, I18N-05, I18N-08)
 */
import { readFileSync, readdirSync } from "node:fs";
// JSDOM is constructed explicitly rather than switching this file to Vitest's
// DOM *environment* — `tests/locale-switcher.test.ts`' note: that environment
// turns on Vite's `browser` export condition and Astro's container then
// renders with no server renderer at all.
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { LOCALES, type Locale } from "../../src/i18n/routing.ts";
import { COLLECTION_ROUTE_SEGMENTS } from "../../src/i18n/routes.ts";
import { ENTRY_SLUGS } from "../../src/i18n/entry-slugs.ts";
import {
  confidenceCaveat,
  fitmentFacetLabel,
  glossarySystemLabel,
  t,
} from "../../src/i18n/ui.ts";
import { isSafetyCritical } from "../../src/lib/safety.ts";
import { needsConfidenceCaveat } from "../../src/lib/confidence.ts";
import { fixTimeLabel } from "../../src/lib/problems.ts";
import { DIFFICULTY_MAX } from "../../src/schemas/problems.ts";
import type { ConfidenceTier } from "../../src/schemas/entry.ts";
import type { GlossarySystem } from "../../src/schemas/glossary.ts";
import { parsedProcedureData } from "../helpers/procedures.ts";
import { makeProcedure } from "../fixtures/procedure-fixtures.ts";

/* -------------------------------------------------------------------------
 * The corpus: T504's real entries, parsed by the registered schema
 * ---------------------------------------------------------------------- */

const PROCEDURES_DIR = new URL(
  "../../src/content/procedures/",
  import.meta.url
);
const VEHICLES_DIR = new URL("../../src/content/vehicles/", import.meta.url);

function readJsonDir(dir: URL): Record<string, unknown>[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map(
      (name) =>
        JSON.parse(readFileSync(new URL(name, dir), "utf8")) as Record<
          string,
          unknown
        >
    );
}

/**
 * The one synthetic entry, for the one card band the real corpus cannot
 * produce: every wave-1 procedure is `fsm-confirmed`, so nothing below `tsb`
 * exists to render `ConfidenceCaveat` from, and a caveat grader written
 * against the real corpus alone would be a pair of `not.toContain` calls that
 * can never fail.
 *
 * Built by the repo's own `makeProcedure` rather than hand-written, so it is
 * obviously synthetic (`test-`-prefixed id, `TEST` in both prose titles) and
 * so it stays valid as the procedures schema grows. A plausible-looking
 * procedure fixture is one copy-paste from becoming content nobody sourced.
 */
const SYNTHETIC_CAVEAT_ID = "test-t504a-anecdotal-control";
const SYNTHETIC_CAVEAT_ENTRY = makeProcedure({
  id: SYNTHETIC_CAVEAT_ID,
  confidence: "anecdotal",
});

interface Entry {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

function toEntry(raw: Record<string, unknown>): Entry {
  const data = parsedProcedureData(raw);
  return { id: String(data["id"]), data };
}

/** T504's eight, exactly as the build sees them. */
const REAL_ENTRIES: readonly Entry[] = readJsonDir(PROCEDURES_DIR).map(toEntry);

/** The vehicle taxonomy the page and the selector payload are both built on. */
const VEHICLE_ENTRIES = readJsonDir(VEHICLES_DIR).map((data) => ({
  id: String(data["id"]),
  data,
}));

/**
 * Mutable so a test can render the *same* page against a different corpus —
 * the empty state (SCF-06 audits the page in it) and the caveat control.
 */
let corpus: readonly Entry[] = REAL_ENTRIES;

/*
 * Partial, not total: `tests/helpers/procedures.ts` imports
 * `src/content.config.ts`, which calls the real `defineCollection`. Only the
 * content-*store* reader is replaced, because the store is a build artefact
 * and `vitest run` happens before `astro build` — the schemas, the loaders and
 * the registry are all the real ones.
 */
vi.mock("astro:content", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getCollection: async (name: string) => {
      if (name === "procedures") return corpus;
      if (name === "vehicles") return VEHICLE_ENTRIES;
      return [];
    },
  };
});

async function withCorpus<T>(
  entries: readonly Entry[],
  body: () => Promise<T>
): Promise<T> {
  corpus = entries;
  try {
    return await body();
  } finally {
    corpus = REAL_ENTRIES;
  }
}

/* -------------------------------------------------------------------------
 * Reading the corpus the way the spec does
 * ---------------------------------------------------------------------- */

const SEGMENT: Record<Locale, string> = {
  en: "procedures",
  es: "procedimientos",
};

function fitmentOf(entry: Entry): Record<string, unknown> {
  return (entry.data["fitment"] ?? {}) as Record<string, unknown>;
}

function systemOf(entry: Entry): GlossarySystem {
  return entry.data["system"] as GlossarySystem;
}

function proseOf(entry: Entry, locale: Locale): Record<string, string> {
  const prose = entry.data["prose"] as Record<string, Record<string, string>>;
  return prose[locale] as Record<string, string>;
}

/*
 * The corpus is `Record<string, unknown>` because it comes off disk. These
 * three narrow it at the one place each figure is read, rather than typing the
 * whole entry — the schema has already accepted the value by the time any of
 * them runs (`parsedProcedureData` throws otherwise), so the cast is a
 * restatement of a check that has happened, not an assumption.
 */
function confidenceOf(entry: Entry): ConfidenceTier {
  return entry.data["confidence"] as ConfidenceTier;
}

function difficultyOf(entry: Entry): number {
  return entry.data["difficulty"] as number;
}

function timeOf(entry: Entry): Parameters<typeof fixTimeLabel>[0] {
  return entry.data["time"] as Parameters<typeof fixTimeLabel>[0];
}

/**
 * The fitment facets a FIT-03 selection can never answer.
 *
 * > **FIT-03** WHEN a visitor selects a vehicle (**gen + market + year +
 * > engine**) …
 *
 * A fitment that restricts anything outside that quadruple is matched
 * permissively (T203 decision (a): an unstated facet is unrestricted rather
 * than a mismatch), and T204's indicator is the binding condition under which
 * that permissiveness was accepted. Derived from the requirement rather than
 * from `OPTIONAL_SELECTION_FACETS` on purpose: if the engine's own list drifts
 * away from the spec, this file should notice rather than agree.
 */
const UNANSWERABLE_FITMENT_FIELDS = [
  "transmissions",
  "transferCases",
  "trims",
  "drive",
] as const;

/** Whether an entry can only ever be a *provisional* match, per FIT-03. */
function isProvisionalCapable(entry: Entry): boolean {
  const fitment = fitmentOf(entry);
  return UNANSWERABLE_FITMENT_FIELDS.some(
    (field) => fitment[field] !== undefined
  );
}

const PROVISIONAL_ENTRIES = REAL_ENTRIES.filter(isProvisionalCapable);
const FULL_MATCH_ENTRIES = REAL_ENTRIES.filter(
  (entry) => !isProvisionalCapable(entry)
);

/** Every system present in the corpus — the pills the page must offer. */
const SYSTEMS_PRESENT = [...new Set(REAL_ENTRIES.map(systemOf))].sort();

/* -------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------- */

let render: (locale: Locale) => Promise<string>;
let detailRoutes: Set<string>;

beforeAll(async () => {
  const { experimental_AstroContainer } = await import("astro/container");
  const container = await experimental_AstroContainer.create();
  const page =
    await import("../../src/pages/[locale]/[proceduresSegment].astro");

  /*
   * The index page takes no `Astro.props` — every input is a route param — so
   * Astro types its component factory as `(_props: never) => …`, which is not
   * assignable to `renderToString`'s parameter. The cast is about that typing
   * quirk and nothing else (the parts and mods index graders carry the same
   * note).
   */
  type Renderable = Parameters<typeof container.renderToString>[0];

  render = (locale) =>
    container.renderToString(page.default as unknown as Renderable, {
      params: { locale, proceduresSegment: SEGMENT[locale] },
    });

  /*
   * The routes the *detail* page actually builds, from its own
   * `getStaticPaths` — the ground truth a card href has to land on. Reading
   * them from the page rather than recomposing them from the two registries
   * is the point: recomposition would agree with a card that composed them
   * the same wrong way.
   */
  const detail =
    (await import("../../src/pages/[locale]/[proceduresSegment]/[procedureSlug].astro")) as {
      getStaticPaths: () => Promise<
        | { params: Record<string, string> }[]
        | { params: Record<string, string> }[]
      >;
    };
  const rows = await detail.getStaticPaths();
  detailRoutes = new Set(
    rows.map(
      (row) =>
        `/${row.params["locale"]}/${row.params["proceduresSegment"]}/` +
        `${row.params["procedureSlug"]}/`
    )
  );
});

/**
 * A `data-*` attribute matched at its own boundaries, never as a substring.
 * `toContain("data-procedures-list")` also matches `data-procedures-list-v2`,
 * so it cannot tell "the hook is here" from "something that starts the same
 * way is here" — the trap the parts index grader's own note records.
 */
function attr(name: string): RegExp {
  return new RegExp(`(?<![\\w-])${name}(?![\\w-])`);
}

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
 * Just one card's HTML.
 *
 * Slicing on the card's own `id` is what makes "the safety chip is on *this*
 * card and not on that one" assertable at all; a whole-page `toContain`
 * cannot tell the difference, which is how a band rendered on every card
 * would pass. The throw is deliberate and loud: a missing card would
 * otherwise make every assertion about it vacuously true.
 */
function card(html: string, entryId: string): string {
  const marker = `id="procedure-${entryId}"`;
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error(
      `no card for \`${entryId}\` in the rendered procedures index — the ` +
        `entry did not render at all, which would make every assertion ` +
        `about it vacuous`
    );
  }
  const next = html.indexOf('id="procedure-', start + marker.length);
  return html.slice(start, next === -1 ? undefined : next);
}

/* -------------------------------------------------------------------------
 * The corpus contract
 *
 * Everything else in this file is derived from the corpus, which means every
 * negative assertion in it goes vacuous if the corpus quietly changes shape.
 * These are the positive controls for the corpus itself, and they name names
 * on purpose: T504's content is still under independent fact-check and
 * bilingual review while this file is written, and a slug or a fitment facet
 * moving is a thing this file should say out loud rather than absorb.
 * ---------------------------------------------------------------------- */

describe("the corpus these graders rest on", () => {
  it("has entries at all", () => {
    expect(REAL_ENTRIES.length).toBeGreaterThan(0);
  });

  it("carries both locales' prose on every entry (I18N-06)", () => {
    for (const entry of REAL_ENTRIES) {
      for (const locale of LOCALES) {
        expect(proseOf(entry, locale)["title"]).toBeTruthy();
        expect(proseOf(entry, locale)["summary"]).toBeTruthy();
      }
    }
  });

  it("has a registry slug in both locales for every entry (I18N-05)", () => {
    const rows = ENTRY_SLUGS.procedures as Record<
      string,
      Record<Locale, string>
    >;
    for (const entry of REAL_ENTRIES) {
      expect(
        rows[entry.id],
        `no ENTRY_SLUGS row for ${entry.id}`
      ).toBeDefined();
      for (const locale of LOCALES) {
        expect(rows[entry.id]?.[locale]).toBeTruthy();
      }
    }
  });

  it("spans more than one system, or the pill graders prove nothing", () => {
    expect(SYSTEMS_PRESENT.length).toBeGreaterThan(1);
  });

  /**
   * The positive control for every provisional grader below, and the negative
   * control for every "and not on the others" clause. Without *both* sides
   * present the whole provisional section is decorative.
   */
  it("contains at least one provisional match and at least one full match", () => {
    expect(
      PROVISIONAL_ENTRIES.map((entry) => entry.id),
      "no entry restricts a fitment facet outside FIT-03's gen/market/year/" +
        "engine quadruple, so nothing on this page can render T204's " +
        "provisional indicator and every grader for it is vacuous"
    ).not.toHaveLength(0);
    expect(FULL_MATCH_ENTRIES.map((entry) => entry.id)).not.toHaveLength(0);
  });

  /**
   * Named, so a rename during T504's review is a failure that says what
   * happened instead of a silently narrower test.
   */
  it("still has `gen3-transfer-case-oil-change` as its provisional case", () => {
    expect(
      PROVISIONAL_ENTRIES.map((entry) => entry.id),
      "wave 1's only provisional-match entry was " +
        "`gen3-transfer-case-oil-change` (`transferCases: [super-select-ii]`). " +
        "If T504's fact-check or bilingual review changed that, re-read the " +
        "provisional graders below before adjusting this line — they are " +
        "derived from the corpus and will keep passing while quietly " +
        "grading nothing."
    ).toContain("gen3-transfer-case-oil-change");
  });

  /**
   * `engines` is inside FIT-03's quadruple, so an engine-restricted entry is
   * never provisional — it either fits or it does not. Pinned because getting
   * this backwards is the single most likely way to write a provisional
   * grader that grades the wrong thing.
   */
  it("does not count an engine restriction as provisional", () => {
    /*
     * Selected from the raw fitment fields, not from `isProvisionalCapable`
     * itself — filtering on the function under test and then asserting
     * against its own output (`PROVISIONAL_ENTRIES` is
     * `REAL_ENTRIES.filter(isProvisionalCapable)`) would be true by
     * construction no matter what the function did. An entry that also
     * restricts one of `UNANSWERABLE_FITMENT_FIELDS` is excluded here
     * because it is legitimately provisional for that other reason; this
     * assertion is only about the engine facet.
     */
    const engineOnlyRestricted = REAL_ENTRIES.filter((entry) => {
      const fitment = fitmentOf(entry);
      return (
        fitment["engines"] !== undefined &&
        !UNANSWERABLE_FITMENT_FIELDS.some(
          (field) => fitment[field] !== undefined
        )
      );
    });
    expect(engineOnlyRestricted.length).toBeGreaterThan(0);
    for (const entry of engineOnlyRestricted) {
      expect(
        PROVISIONAL_ENTRIES,
        `\`${entry.id}\` restricts only \`engines\`, which is inside FIT-03's ` +
          "gen/market/year/engine quadruple, so it must never be counted as " +
          "a provisional match"
      ).not.toContain(entry);
    }
  });
});

/* -------------------------------------------------------------------------
 * 1. Cards render
 * ---------------------------------------------------------------------- */

describe("the listing renders a card per entry", () => {
  it("renders every entry, in both locales", async () => {
    for (const locale of LOCALES) {
      const html = await render(locale);
      for (const entry of REAL_ENTRIES) {
        expect(() => card(html, entry.id)).not.toThrow();
      }
      expect(html).toMatch(attr("data-procedures-toolbar"));
      expect(html).toMatch(attr("data-procedures-list"));
      expect(html).toMatch(attr("data-procedures-count"));
      expect(html).toMatch(attr("data-procedures-none"));
      expect(html).toContain(`data-total="${REAL_ENTRIES.length}"`);
    }
  });

  it("renders the heading and intro, and not the empty sentence", async () => {
    for (const locale of LOCALES) {
      const body = text(await render(locale));
      const strings = t(locale);
      expect(body).toContain(strings.proceduresHeading);
      expect(body).toContain(strings.proceduresIntro);
      expect(body).not.toContain(strings.proceduresEmpty);
    }
  });

  it("renders each locale's own title and summary, and never the other's", async () => {
    for (const locale of LOCALES) {
      const html = await render(locale);
      const other: Locale = locale === "en" ? "es" : "en";
      for (const entry of REAL_ENTRIES) {
        const own = proseOf(entry, locale);
        const foreign = proseOf(entry, other);
        const body = text(card(html, entry.id));
        expect(body).toContain(own["title"]);
        expect(body).toContain(own["summary"]);
        if (foreign["title"] !== own["title"]) {
          expect(body).not.toContain(foreign["title"]);
        }
        if (foreign["summary"] !== own["summary"]) {
          expect(body).not.toContain(foreign["summary"]);
        }
      }
    }
  });

  it("labels each card's system in the page's language", async () => {
    for (const locale of LOCALES) {
      const html = await render(locale);
      for (const entry of REAL_ENTRIES) {
        const body = card(html, entry.id);
        expect(body).toContain(`data-system="${systemOf(entry)}"`);
        expect(text(body)).toContain(
          glossarySystemLabel(t(locale), systemOf(entry))
        );
      }
    }
  });

  /**
   * Shared `data`, rendered once per locale through that locale's own
   * template — the bilingual rule's other half: the *number* never diverges,
   * the sentence around it always does.
   */
  it("renders the difficulty and time figures from shared data", async () => {
    for (const locale of LOCALES) {
      const strings = t(locale);
      const numbers = new Intl.NumberFormat(locale === "en" ? "en" : "es-CR");
      const html = await render(locale);
      for (const entry of REAL_ENTRIES) {
        const body = text(card(html, entry.id));
        expect(body).toContain(
          strings.proceduresDifficultyTemplate
            .replace("{value}", numbers.format(difficultyOf(entry)))
            .replace("{max}", numbers.format(DIFFICULTY_MAX))
        );
        const time = fixTimeLabel(
          timeOf(entry),
          locale === "en" ? "en" : "es-CR"
        );
        if (time !== "") {
          expect(body).toContain(time);
        }
      }
    }
  });

  /**
   * Derived from `isSafetyCritical`, over the whole corpus, so this is a
   * paired assertion rather than a list: every safety-critical card carries
   * the chip and every other card does not. Wave 1 makes both halves real —
   * the two brake jobs against six that are not.
   */
  it("puts the safety chip on exactly the safety-critical cards", async () => {
    const critical = REAL_ENTRIES.filter((entry) =>
      isSafetyCritical(entry.data)
    );
    const ordinary = REAL_ENTRIES.filter(
      (entry) => !isSafetyCritical(entry.data)
    );
    expect(critical.length).toBeGreaterThan(0);
    expect(ordinary.length).toBeGreaterThan(0);

    for (const locale of LOCALES) {
      const html = await render(locale);
      const label = t(locale).safetyCriticalChipLabel;
      for (const entry of critical) {
        const body = card(html, entry.id);
        expect(body, `${entry.id} is safety-critical`).toContain("tag--safety");
        expect(text(body)).toContain(label);
      }
      for (const entry of ordinary) {
        const body = card(html, entry.id);
        expect(body, `${entry.id} is not safety-critical`).not.toContain(
          "tag--safety"
        );
        expect(text(body)).not.toContain(label);
      }
    }
  });

  it("carries no confidence caveat on an `fsm-confirmed` corpus", async () => {
    for (const entry of REAL_ENTRIES) {
      expect(needsConfidenceCaveat(confidenceOf(entry))).toBe(false);
    }
    for (const locale of LOCALES) {
      const html = await render(locale);
      expect(html).not.toContain('class="caveat"');
    }
  });

  /**
   * The positive control for the line above: without it, `not.toContain` on a
   * corpus that can never produce a caveat is a test that cannot fail, and it
   * would keep passing with the caveat branch deleted from the template.
   */
  it("renders the confidence caveat on a sub-`tsb` card", async () => {
    await withCorpus(
      [...REAL_ENTRIES, toEntry(SYNTHETIC_CAVEAT_ENTRY)],
      async () => {
        for (const locale of LOCALES) {
          const body = text(card(await render(locale), SYNTHETIC_CAVEAT_ID));
          for (const each of LOCALES) {
            expect(body).toContain(confidenceCaveat(t(each), "anecdotal"));
          }
        }
      }
    );
  });
});

/* -------------------------------------------------------------------------
 * 2. Hrefs resolve
 * ---------------------------------------------------------------------- */

describe("every card links to a page that is actually built", () => {
  it("lands every card href on a route the detail page generates", async () => {
    expect(detailRoutes.size).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      const html = await render(locale);
      for (const entry of REAL_ENTRIES) {
        const body = card(html, entry.id);
        const href = /href="([^"]+)"/.exec(body)?.[1];
        expect(href, `${entry.id} card has no link at all`).toBeDefined();
        expect(
          detailRoutes,
          `${entry.id}'s card links to ${String(href)}, which the procedures ` +
            `detail page does not build — a 404 that no current CI check sees`
        ).toContain(href);
        expect(href?.startsWith(`/${locale}/`)).toBe(true);
      }
    }
  });

  it("builds a card for every route the detail page generates", async () => {
    for (const locale of LOCALES) {
      const html = await render(locale);
      const hrefs = new Set(
        [...html.matchAll(/href="(\/[^"]*)"/g)].map((match) => match[1])
      );
      for (const route of detailRoutes) {
        if (!route.startsWith(`/${locale}/`)) continue;
        expect(
          hrefs,
          `${route} is built but nothing on the ${locale} index links to it`
        ).toContain(route);
      }
    }
  });

  it("never emits the locale-independent route as an href (the T501 defect)", async () => {
    for (const locale of LOCALES) {
      const html = await render(locale);
      // `entryRoutePath`'s own output, rendered raw, is a 404 on every card.
      expect(html).not.toContain(`href="/${SEGMENT[locale]}/`);
    }
  });

  it("uses each locale's own segment and slug, never the other's (I18N-01)", async () => {
    const rows = ENTRY_SLUGS.procedures as Record<
      string,
      Record<Locale, string>
    >;
    const en = await render("en");
    const es = await render("es");
    for (const entry of REAL_ENTRIES) {
      const slugs = rows[entry.id];
      if (slugs === undefined) continue;
      expect(en).toContain(`href="/en/procedures/${slugs.en}/"`);
      expect(es).toContain(`href="/es/procedimientos/${slugs.es}/"`);
      if (slugs.es !== slugs.en) {
        expect(en).not.toContain(`href="/en/procedures/${slugs.es}/"`);
        expect(es).not.toContain(`href="/es/procedimientos/${slugs.en}/"`);
      }
    }
  });

  it("uses the segments the route registry declares (I18N-05)", () => {
    expect(COLLECTION_ROUTE_SEGMENTS.procedures.en).toBe(SEGMENT.en);
    expect(COLLECTION_ROUTE_SEGMENTS.procedures.es).toBe(SEGMENT.es);
  });

  it("emits a symmetric hreflang set with x-default", async () => {
    for (const locale of LOCALES) {
      const html = await render(locale);
      expect(html).toContain('hreflang="en"');
      expect(html).toContain('hreflang="es"');
      expect(html).toContain('hreflang="x-default"');
      expect(html).toContain("/en/procedures/");
      expect(html).toContain("/es/procedimientos/");
    }
  });
});

/* -------------------------------------------------------------------------
 * 3. The toolbar's markup contract (the half that renders)
 * ---------------------------------------------------------------------- */

describe("the system pills", () => {
  it("offers one pill per system present, and no others", async () => {
    for (const locale of LOCALES) {
      const html = await render(locale);
      for (const system of SYSTEMS_PRESENT) {
        expect(html).toContain(`data-value="${system}"`);
        expect(text(html)).toContain(glossarySystemLabel(t(locale), system));
      }
      // A pill for a system no card carries is a control that empties the
      // list — the glossary page's rule, and the reason `systemOptions`
      // filters rather than listing the whole vocabulary.
      const doc = new JSDOM(html).window.document;
      const offered = [
        ...doc.querySelectorAll<HTMLButtonElement>('[data-facet="system"]'),
      ]
        .map((button) => button.dataset["value"] ?? "")
        .filter((value) => value !== "");
      expect([...offered].sort()).toEqual([...SYSTEMS_PRESENT].sort());
    }
  });

  it("starts on `All systems`, pressed, with nothing else pressed", async () => {
    for (const locale of LOCALES) {
      const doc = new JSDOM(await render(locale)).window.document;
      const pills = [
        ...doc.querySelectorAll<HTMLButtonElement>('[data-facet="system"]'),
      ];
      expect(pills.length).toBe(SYSTEMS_PRESENT.length + 1);
      const pressed = pills.filter(
        (button) => button.getAttribute("aria-pressed") === "true"
      );
      expect(pressed).toHaveLength(1);
      expect(pressed[0]?.dataset["value"] ?? "(absent)").toBe("");
      expect(pressed[0]?.textContent).toBe(t(locale).proceduresFilterSystemAll);
      // A `<div>` with a click handler is not a control; the pill group is
      // real buttons in a labelled group, or a keyboard reader cannot filter.
      expect(pills.every((button) => button.tagName === "BUTTON")).toBe(true);
      // Scoped to the pill group's own parent, not the first `role="group"`
      // on the page — the site chrome's vehicle selector is one too, and the
      // first draft of this line asserted the selector's label by accident.
      expect(pills[0]?.parentElement?.getAttribute("role")).toBe("group");
      expect(pills[0]?.parentElement?.getAttribute("aria-label")).toBe(
        t(locale).proceduresFilterSystemLabel
      );
    }
  });

  it("renders the no-results line hidden, ready for the filter", async () => {
    for (const locale of LOCALES) {
      const html = await render(locale);
      expect(html).toMatch(attr("data-procedures-none"));
      const none = new JSDOM(html).window.document.querySelector<HTMLElement>(
        "[data-procedures-none]"
      );
      expect(none?.hidden).toBe(true);
      expect(none?.textContent).toBe(t(locale).proceduresNoResults);
    }
  });
});

describe("the empty state — how SCF-06 audits this page with no content", () => {
  it("renders the empty sentence and no dead controls", async () => {
    await withCorpus([], async () => {
      for (const locale of LOCALES) {
        const html = await render(locale);
        expect(text(html)).toContain(t(locale).proceduresEmpty);
        expect(html).not.toMatch(attr("data-procedures-toolbar"));
        expect(html).not.toMatch(attr("data-procedures-list"));
        expect(html).not.toMatch(attr("data-procedures-count"));
        expect(html).not.toMatch(attr("data-procedures-none"));
      }
    });
  });
});

/* -------------------------------------------------------------------------
 * The seam
 * ---------------------------------------------------------------------- */

const SEAM_MODULE = "../../src/lib/procedures/index-view.ts";

interface ProceduresIndexView {
  apply(): void;
  destroy(): void;
}

type EnhanceFn = (root: HTMLElement, win: Window) => ProceduresIndexView | null;

async function seam(): Promise<EnhanceFn> {
  const mod = (await import(SEAM_MODULE)) as {
    enhanceProceduresIndex: EnhanceFn;
  };
  return mod.enhanceProceduresIndex;
}

/** A rendered page, in a DOM, with the page's wiring applied to it. */
interface Mounted {
  readonly win: Window;
  readonly doc: Document;
  readonly cards: readonly HTMLElement[];
  readonly view: ProceduresIndexView | null;
  visible(): string[];
  pill(system: string): HTMLButtonElement;
  countLine(): string;
  fitLine(): string;
  /** The provisional row's text, `null` when the row was never built. */
  provisional(entryId: string): string | null;
  /** The "does not fit" row's text, `null` when the row was never built. */
  filtered(entryId: string): string | null;
  noteHidden(): boolean;
  summaryHidden(): boolean;
}

async function mount(locale: Locale): Promise<Mounted> {
  const html = await render(locale);
  const dom = new JSDOM(html, {
    url: `https://monterogarage.test/${locale}/${SEGMENT[locale]}/`,
  });
  const win = dom.window as unknown as Window;
  const doc = win.document;
  // The page lays its toolbar out only for a script-capable document; the
  // inline head script does this in a browser and JSDOM does not run it here.
  doc.documentElement.classList.add("js");

  const root = doc.querySelector<HTMLElement>("[data-procedures]");
  if (root === null) throw new Error("the page rendered no [data-procedures]");

  const cards = [...doc.querySelectorAll<HTMLElement>(".procedure-card")];
  const view = (await seam())(root, win);

  /*
   * `getElementById`, not a `#id` selector: entry ids are kebab-case today but
   * a selector would need `CSS.escape`, and *nothing in this test environment
   * has it*. JSDOM does not implement `CSS` at all — `new JSDOM("<p></p>")
   * .window.CSS` is `undefined` on the version this repo pins (28.x, measured
   * 2026-09-06), so the per-window escape hatch other browser globals get does
   * not exist here — and Node has no ambient `CSS` either. The first draft of
   * this helper reached for the ambient `CSS` and every provisional grader
   * failed with a `ReferenceError` that `it.fails` reported as an expected
   * failure. That is precisely the "failed for the wrong reason" trap, and it
   * was caught by the activation simulation rather than by reading the code.
   */
  const rowIn = (entryId: string, selector: string): string | null => {
    const el = doc
      .getElementById(`procedure-${entryId}`)
      ?.querySelector<HTMLElement>(selector);
    if (el === undefined || el === null) return null;
    return el.hidden ? null : (el.textContent ?? "");
  };

  return {
    win,
    doc,
    cards,
    view,
    visible: () =>
      cards
        .filter((element) => !element.hidden)
        .map((element) => element.id.replace(/^procedure-/, "")),
    pill: (system) => {
      const button = doc.querySelector<HTMLButtonElement>(
        `[data-facet="system"][data-value="${system}"]`
      );
      if (button === null) throw new Error(`no pill for system \`${system}\``);
      return button;
    },
    countLine: () =>
      doc.querySelector("[data-procedures-count]")?.textContent ?? "",
    fitLine: () => doc.querySelector("[data-vehicle-fit]")?.textContent ?? "",
    provisional: (entryId) => rowIn(entryId, "[data-entry-provisional]"),
    filtered: (entryId) => rowIn(entryId, "[data-entry-fit]"),
    noteHidden: () =>
      doc.querySelector<HTMLElement>("[data-vehicle-provisional-note]")
        ?.hidden ?? true,
    summaryHidden: () =>
      doc.querySelector<HTMLElement>("[data-vehicle-summary]")?.hidden ?? true,
  };
}

/** Gitana Blanca's shape of answer: FIT-03's quadruple and nothing more. */
function selectionFor(engine: string, gen = "gen3", year = 2002) {
  return { gen, market: "global", year, engine } as const;
}

async function selectVehicle(
  mounted: Mounted,
  selection: ReturnType<typeof selectionFor> | null
): Promise<void> {
  const { writeVehicleSelection, clearVehicleSelection } =
    await import("../../src/lib/vehicle-selection.ts");
  if (selection === null) {
    clearVehicleSelection(mounted.win);
    return;
  }
  const stored = writeVehicleSelection(selection, mounted.win);
  if (stored === null) {
    throw new Error(
      `the test's own selection ${JSON.stringify(selection)} was rejected by ` +
        `parseVehicleSelection — the fixture is wrong, not the page`
    );
  }
}

describe("the seam the page's wiring must live behind", () => {
  /**
   * Not marked, and it must stay unmarked: this is what tells a reader that
   * the `it.fails` graders below fail because the seam is unimplemented and
   * not because the module cannot be imported at all. `it.fails` reports a
   * module-resolution error and a real assertion failure identically.
   */
  it("is importable and exports `enhanceProceduresIndex`", async () => {
    const enhance = await seam();
    expect(typeof enhance).toBe("function");
  });

  /**
   * The reason canary. Every `it.fails` below fails because this one does; if
   * this activates and they do not, the failure is theirs and not the seam's.
   */
  it.fails("is implemented", async () => {
    const enhance = await seam();
    const html = await render("en");
    const dom = new JSDOM(html);
    const win = dom.window as unknown as Window;
    const root = win.document.querySelector<HTMLElement>("[data-procedures]");
    expect(root).not.toBeNull();
    expect(() => enhance(root as HTMLElement, win)).not.toThrow();
  });

  /**
   * The weakest assertion in this file, and the note in the header says why:
   * Vitest cannot execute the compiled page script, so "the page delegates"
   * can only be read out of the template's source. A lib that works and a page
   * that never calls it would otherwise pass every behavioural grader here
   * while the shipped page stayed inert.
   */
  it.fails("the page delegates its wiring to the seam", () => {
    const template = readFileSync(
      new URL(
        "../../src/pages/[locale]/[proceduresSegment].astro",
        import.meta.url
      ),
      "utf8"
    );
    expect(template).toContain("enhanceProceduresIndex");
    expect(template).toMatch(/from ["'][^"']*procedures\/index-view["']/);
    // …and does not keep a second copy of the wiring inline beside it.
    expect(template).not.toContain("matchesProceduresFilter");
    expect(template).not.toContain("createVehicleListingView");
  });

  it.fails(
    "returns null for a root with no toolbar (the empty state)",
    async () => {
      const enhance = await seam();
      await withCorpus([], async () => {
        const dom = new JSDOM(await render("en"));
        const win = dom.window as unknown as Window;
        const root =
          win.document.querySelector<HTMLElement>("[data-procedures]");
        expect(root).not.toBeNull();
        expect(enhance(root as HTMLElement, win)).toBeNull();
      });
    }
  );

  /*
   * `apply()` and `destroy()` are the whole of `ProceduresIndexView`, and
   * every other grader in this file only ever asks whether the handle came
   * back `null`. `return { apply() {}, destroy() {} }` would satisfy all of
   * them. The two graders below are what make the handle mean something: each
   * puts the page in a state only the named method can get it out of (or into),
   * so a no-op body fails and a real one passes.
   */

  /**
   * `apply()` — "re-run the pill filter and repaint". Driven by putting the
   * DOM in a state the filter *disagrees* with (no pill pressed, every card
   * hidden) and asking the view to restore it. The mount-time paint cannot be
   * mistaken for this: the cards are hidden after that has already happened.
   */
  it.fails("`apply()` repaints the list from the current state", async () => {
    const page = await mount("en");
    expect(
      page.view,
      "a rendered page with a toolbar must return a view to exercise"
    ).not.toBeNull();
    const view = page.view as ProceduresIndexView;

    expect(page.visible().length).toBe(REAL_ENTRIES.length);
    for (const card of page.cards) card.hidden = true;
    expect(page.visible()).toEqual([]);

    view.apply();

    expect(page.visible().sort()).toEqual(
      REAL_ENTRIES.map((entry) => entry.id).sort()
    );
    expect(page.countLine()).toBe(
      t("en")
        .proceduresCountTemplate.replace("{shown}", String(REAL_ENTRIES.length))
        .replace("{total}", String(REAL_ENTRIES.length))
    );
  });

  /**
   * `destroy()` — "unsubscribe from vehicle-selection changes", and nothing
   * wider: FIT-03's selector lives in the site chrome and announces through
   * the document, so the only thing a destroyed view can be observed to have
   * stopped doing is answering that announcement. The live half runs first and
   * is the positive control — without it, a view that painted nothing at all
   * would pass the "nothing moved after `destroy()`" half for the wrong
   * reason. Nothing here asserts the pills stop working: `destroy()` does not
   * promise that, and grading a promise the contract does not make is how a
   * grader starts dictating an implementation.
   */
  it.fails(
    "`destroy()` stops the view answering vehicle-selection changes",
    async () => {
      const page = await mount("en");
      expect(page.view).not.toBeNull();
      const view = page.view as ProceduresIndexView;

      // Live: a Gen 2 truck against a Gen 3 corpus dims every row.
      await selectVehicle(page, selectionFor("6g74-sohc", "gen2", 1995));
      const painted = REAL_ENTRIES.map((entry) => page.filtered(entry.id));
      expect(
        painted.every((row) => row !== null),
        "the live view must paint before `destroy()` can be shown to stop it"
      ).toBe(true);
      expect(page.summaryHidden()).toBe(false);

      // Torn down: the identical announcement — the one `clears every marker
      // when the vehicle is cleared` proves a *live* view repaints for — must
      // now change nothing on the page.
      view.destroy();
      await selectVehicle(page, null);

      expect(REAL_ENTRIES.map((entry) => page.filtered(entry.id))).toEqual(
        painted
      );
      expect(page.summaryHidden()).toBe(false);
    }
  );
});

/* -------------------------------------------------------------------------
 * 4. Filters work
 * ---------------------------------------------------------------------- */

describe("the system filter narrows the list", () => {
  it.fails("shows every card before anything is clicked", async () => {
    for (const locale of LOCALES) {
      const page = await mount(locale);
      expect(page.visible().sort()).toEqual(
        REAL_ENTRIES.map((entry) => entry.id).sort()
      );
      expect(page.countLine()).toBe(
        t(locale)
          .proceduresCountTemplate.replace(
            "{shown}",
            String(REAL_ENTRIES.length)
          )
          .replace("{total}", String(REAL_ENTRIES.length))
      );
    }
  });

  /**
   * Every system present, not one of them. A pill that filtered on the wrong
   * attribute would still narrow *something*, and a single-system spot check
   * would call that a pass.
   */
  it.fails("narrows to exactly the cards of the system clicked", async () => {
    for (const locale of LOCALES) {
      const page = await mount(locale);
      for (const system of SYSTEMS_PRESENT) {
        page.pill(system).click();
        const expected = REAL_ENTRIES.filter(
          (entry) => systemOf(entry) === system
        ).map((entry) => entry.id);
        expect(expected.length).toBeGreaterThan(0);
        expect(page.visible().sort()).toEqual([...expected].sort());
      }
    }
  });

  it.fails("counts the narrowed list against the unchanged total", async () => {
    const page = await mount("en");
    for (const system of SYSTEMS_PRESENT) {
      page.pill(system).click();
      const shown = REAL_ENTRIES.filter(
        (entry) => systemOf(entry) === system
      ).length;
      expect(page.countLine()).toBe(
        t("en")
          .proceduresCountTemplate.replace("{shown}", String(shown))
          .replace("{total}", String(REAL_ENTRIES.length))
      );
    }
  });

  it.fails(
    "restores every card when `All systems` is clicked again",
    async () => {
      const page = await mount("en");
      page.pill(SYSTEMS_PRESENT[0] as string).click();
      expect(page.visible().length).toBeLessThan(REAL_ENTRIES.length);
      page.pill("").click();
      expect(page.visible().sort()).toEqual(
        REAL_ENTRIES.map((entry) => entry.id).sort()
      );
    }
  );

  it.fails("presses exactly one pill at a time", async () => {
    const page = await mount("en");
    for (const system of [...SYSTEMS_PRESENT, ""]) {
      page.pill(system).click();
      const pressed = [
        ...page.doc.querySelectorAll<HTMLButtonElement>(
          '[data-facet="system"][aria-pressed="true"]'
        ),
      ].map((button) => button.dataset["value"] ?? "");
      expect(pressed).toEqual([system]);
    }
  });

  /**
   * The no-results line has never been seen. The corpus cannot empty itself
   * through a pill — every pill has at least one card — so the state is
   * reached by filtering a one-system corpus on a system it does not have,
   * which is the same code path a wave-2 pill combination will reach for real.
   */
  it.fails(
    "shows the no-results line when a filter empties the list",
    async () => {
      const oneSystem = REAL_ENTRIES.filter(
        (entry) => systemOf(entry) === SYSTEMS_PRESENT[0]
      );
      const otherSystem = SYSTEMS_PRESENT.find(
        (system) => system !== SYSTEMS_PRESENT[0]
      );
      expect(otherSystem).toBeDefined();

      await withCorpus(oneSystem, async () => {
        const page = await mount("en");
        const none = page.doc.querySelector<HTMLElement>(
          "[data-procedures-none]"
        );
        expect(none?.hidden).toBe(true);

        // The pill for the absent system is not rendered, so the state is
        // driven the way a browser would: set the button's value and click it.
        const button = page.pill("");
        button.dataset["value"] = otherSystem as string;
        button.click();

        expect(page.visible()).toEqual([]);
        expect(none?.hidden).toBe(false);
        expect(none?.textContent).toBe(t("en").proceduresNoResults);
      });
    }
  );
});

/* -------------------------------------------------------------------------
 * 5. T204's provisional-match indicator
 * ---------------------------------------------------------------------- */

describe("T204's provisional-match indicator", () => {
  it.fails("shows nothing at all until a vehicle is selected", async () => {
    const page = await mount("en");
    expect(page.summaryHidden()).toBe(true);
    for (const entry of REAL_ENTRIES) {
      expect(page.provisional(entry.id)).toBeNull();
      expect(page.filtered(entry.id)).toBeNull();
    }
  });

  /**
   * The whole point, in one test: the entry whose fitment names a facet
   * FIT-03's selection is silent about says so, and the seven that fit
   * outright say nothing. Both halves in one run — a "shows on the transfer
   * case" test alone would pass just as well if the indicator were painted on
   * every card.
   */
  it.fails(
    "marks the provisional match and only the provisional match",
    async () => {
      for (const locale of LOCALES) {
        const page = await mount(locale);
        await selectVehicle(page, selectionFor("6g74-gdi"));

        for (const entry of PROVISIONAL_ENTRIES) {
          expect(
            page.provisional(entry.id),
            `${entry.id} restricts a facet outside FIT-03's quadruple and must ` +
              `say so`
          ).not.toBeNull();
        }
        for (const entry of FULL_MATCH_ENTRIES) {
          expect(
            page.provisional(entry.id),
            `${entry.id} matches outright — calling that provisional tells a ` +
              `reader the site is unsure when it is not`
          ).toBeNull();
        }
      }
    }
  );

  it.fails(
    "names the unanswered facet, in the page's own language",
    async () => {
      for (const locale of LOCALES) {
        const strings = t(locale);
        const page = await mount(locale);
        await selectVehicle(page, selectionFor("6g74-gdi"));

        const body = page.provisional("gen3-transfer-case-oil-change") ?? "";
        expect(body).toContain(strings.vehicleProvisionalLabel);
        expect(body).toContain(
          strings.vehicleProvisionalDetailTemplate.replace(
            "{facets}",
            fitmentFacetLabel(strings, "transferCase")
          )
        );
        // Never the other locale's words on this locale's page (I18N-08).
        const other = t(locale === "en" ? "es" : "en");
        expect(body).not.toContain(other.vehicleProvisionalLabel);
      }
    }
  );

  it.fails(
    "raises the standing note only while a provisional row is visible",
    async () => {
      const page = await mount("en");
      await selectVehicle(page, selectionFor("6g74-gdi"));
      expect(page.noteHidden()).toBe(false);
      expect(
        page.doc.querySelector("[data-vehicle-provisional-note]")?.textContent
      ).toBe(t("en").vehicleProvisionalNote);

      // Filtered to a system the provisional entry is not in, the note has
      // nothing to warn about — a standing warning about a row the reader
      // cannot see is a warning that trains readers to ignore warnings.
      const withoutProvisional = SYSTEMS_PRESENT.find((system) =>
        REAL_ENTRIES.every(
          (entry) => systemOf(entry) !== system || !isProvisionalCapable(entry)
        )
      );
      expect(withoutProvisional).toBeDefined();
      page.pill(withoutProvisional as string).click();
      expect(page.noteHidden()).toBe(true);

      page.pill("").click();
      expect(page.noteHidden()).toBe(false);
    }
  );

  /**
   * "Does not fit" and "provisional" are different sentences about different
   * situations, and `provisionalMatchFacets` returns nothing for a row that
   * does not match at all. A card that showed both would be telling a reader
   * the site is unsure about a job it has already ruled out.
   */
  it.fails("never marks a row that does not fit as provisional", async () => {
    const page = await mount("en");
    await selectVehicle(page, selectionFor("6g74-sohc", "gen2", 1995));

    for (const entry of REAL_ENTRIES) {
      expect(
        page.filtered(entry.id),
        `${entry.id} is a Gen 3 job and a Gen 2 truck was selected`
      ).not.toBeNull();
      expect(page.provisional(entry.id)).toBeNull();
    }
    expect(page.noteHidden()).toBe(true);
    expect(page.fitLine()).toBe(
      t("en")
        .vehicleFitCountTemplate.replace("{shown}", "0")
        .replace("{total}", String(REAL_ENTRIES.length))
    );
  });

  /**
   * The engine facet *is* inside FIT-03's quadruple, so an engine-restricted
   * entry is a hard miss for the wrong engine, never a provisional match.
   * Paired with the test above so "dim it" and "qualify it" cannot be
   * satisfied by the same branch.
   */
  it.fails(
    "dims an engine mismatch rather than calling it provisional",
    async () => {
      const page = await mount("en");
      await selectVehicle(page, selectionFor("6g74-sohc"));

      const gdiOnly = REAL_ENTRIES.filter((entry) => {
        const engines = fitmentOf(entry)["engines"];
        return Array.isArray(engines) && !engines.includes("6g74-sohc");
      });
      expect(gdiOnly.length).toBeGreaterThan(0);

      for (const entry of gdiOnly) {
        expect(page.filtered(entry.id)).toContain(
          t("en").vehicleDoesNotFitLabel
        );
        expect(page.provisional(entry.id)).toBeNull();
      }
      // …and the transfer-case job still qualifies itself, on the same render.
      expect(page.provisional("gen3-transfer-case-oil-change")).not.toBeNull();
    }
  );

  it.fails("clears every marker when the vehicle is cleared", async () => {
    const page = await mount("en");
    await selectVehicle(page, selectionFor("6g74-sohc", "gen2", 1995));
    expect(page.filtered(REAL_ENTRIES[0]?.id as string)).not.toBeNull();

    await selectVehicle(page, null);
    expect(page.summaryHidden()).toBe(true);
    for (const entry of REAL_ENTRIES) {
      expect(page.provisional(entry.id)).toBeNull();
      expect(page.filtered(entry.id)).toBeNull();
      expect(entry.id && page.cards.every((c) => !c.hidden)).toBe(true);
    }
  });

  /**
   * The two counters on the page must agree about what "the list" is: the
   * pill count is `shown of total`, the fit count is `fitting of visible`.
   */
  it.fails(
    "counts fitting rows against the visible list, not the whole corpus",
    async () => {
      const page = await mount("en");
      await selectVehicle(page, selectionFor("6g74-sohc"));

      const brakes = SYSTEMS_PRESENT.includes("brakes" as GlossarySystem)
        ? ("brakes" as GlossarySystem)
        : (SYSTEMS_PRESENT[0] as GlossarySystem);
      page.pill(brakes).click();

      const visible = REAL_ENTRIES.filter(
        (entry) => systemOf(entry) === brakes
      );
      expect(page.fitLine()).toBe(
        t("en")
          .vehicleFitCountTemplate.replace("{shown}", String(visible.length))
          .replace("{total}", String(visible.length))
      );
    }
  );
});
