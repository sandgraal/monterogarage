/**
 * Independent render/structural grader for T2-403's page-integration layer —
 * `src/components/CommunityEvidence.astro` and its wiring into the problem
 * page. Added post-review as the independent `[TEST]` pass the code review
 * found missing: T2-403 shipped `[PLATFORM]` with only its author's own unit
 * test of the pure selector module and no grader of the surface itself. This
 * file is a *different* agent's derivation, straight from the spec — GAR-04′,
 * SHR-09, and AGENTS.md's testimony rule — never from the component's own
 * branches. Style follows `tests/pages/showcase-worklog.render.test.ts`:
 * render what can be rendered, read structurally what cannot, and mutation-
 * proof every probe helper against fixtures with a known answer.
 *
 * > **GAR-04′** WHEN a record references a problem entry and its vehicle's
 * > work-log is public, THE problem page MAY surface it as community first-hand
 * > evidence (opt-in per record; the 001 GAR-04 idea, now multi-user).
 * > **SHR-09** A grant SHALL NOT make a record eligible for the community
 * > evidence surfacing of GAR-04′.
 *
 * ## What this file grades, and how
 *
 *  1. **Dormant unless there is something to surface.** The section is emitted
 *     only when the browser Supabase config is present AND at least one source
 *     is registered — otherwise a build with no live project ships no dormant
 *     script and a problem page carries no empty heading. Rendered four ways
 *     through `experimental_AstroContainer` with the two inputs mocked.
 *  2. **Hidden by default, and *genuinely* so.** The AGENTS.md T2-303/F10
 *     incident was a `[hidden]` element that a `display: flex`/`grid` rule
 *     un-hid (the class shipped five times). The section carries
 *     `class="panel community-evidence"`, and `.panel` supplies a
 *     `display: flex` — so `[hidden]` alone would lose, and the section's own
 *     `.community-evidence[hidden] { display: none !important }` is what makes
 *     the attribute effective. jsdom's `getComputedStyle` does NOT model that
 *     specificity fight (it returns `none` even for the un-guarded defect
 *     shape — verified while writing this file), so a naive computed-style
 *     assertion here would be a test that cannot fail. Instead the winning
 *     `display` is resolved from the component's own parsed stylesheet against
 *     the real `.panel { display: flex }` competitor, by a small cascade
 *     resolver that is itself mutation-proofed below, and the file proves the
 *     guard is load-bearing by showing the element would be *visible* without
 *     it. The airtight browser-computed check remains the e2e sweep's job
 *     (`tests/e2e/hidden-guard.spec.ts`); this problem-detail surface is not on
 *     that sweep's page list today because it renders only on a configured
 *     build with a registered source — it should be added there when the first
 *     source is registered (GRADER-PRINCIPLES.md, "a known-pages sweep is only
 *     as complete as its list").
 *  3. **`problemId` wired from the problem page.** The rendered section carries
 *     the prop as `data-problem-id`, and the page passes the problem entry's
 *     stable **id** (`entry.id`) — the exact id space a record's `problem_ids`
 *     hold (`referenceOptions` in `[garageSegment].astro` builds the picker
 *     from `entry.id`), so the client join `problem_ids.includes(problemId)`
 *     can match. Passing the per-locale slug instead would silently surface
 *     nothing.
 *  4. **Testimony, not authority.** AGENTS.md (the §8 Facts amendment):
 *     user-entered records are the user's own testimony, never site-verified
 *     reference facts. The band leads with a note that says so, in the reader's
 *     locale.
 *  5. **Bilingual, no numeric divergence.** `/en/` and `/es/` emit distinct
 *     prose, and every numeric token the section carries is identical across
 *     the two (numbers are shared data — AGENTS.md).
 *
 * refs specs/002-montero-garage (GAR-04′, SHR-09, SHR-01, SHR-02, SHR-03),
 * specs/001-foundation (I18N-01, I18N-08), AGENTS.md, .claude/GRADER-PRINCIPLES.md
 */
import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LOCALES, type Locale } from "../../src/i18n/routing.ts";
import { t } from "../../src/i18n/ui.ts";

/* -------------------------------------------------------------------------
 * Mocking the two dormancy inputs — set per test through a hoisted holder.
 *
 * The component reads `SUPABASE_BROWSER_CONFIG` (a build-time value from
 * `import.meta.env`, null on any build with no project) and
 * `communityEvidenceSources()` (empty until the first published truck is
 * registered — so the real, unmocked value never renders the section). Both
 * are controlled here so the gate can be exercised deterministically, on CI
 * and locally alike, independent of any `.env.local`.
 * ---------------------------------------------------------------------- */

const holder = vi.hoisted(() => ({
  config: null as { url: string; anonKey: string } | null,
  sources: [] as { handle: string; vehicleId: string }[],
}));

vi.mock("../../src/lib/supabase/config", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    get SUPABASE_BROWSER_CONFIG() {
      return holder.config;
    },
  };
});

vi.mock(
  "../../src/lib/garage/community-evidence-sources",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
      ...actual,
      communityEvidenceSources: () => holder.sources,
    };
  }
);

const CONFIG = { url: "https://test.supabase.co", anonKey: "test-anon-key" };
const SOURCE = { handle: "test-t2-403-taller", vehicleId: "TEST-VEHICLE-403" };
const PROBLEM_ID = "TEST-PROBLEM-403";

async function render(input: {
  readonly locale: Locale;
  readonly problemId?: string;
}): Promise<string> {
  const { experimental_AstroContainer } = await import("astro/container");
  const container = await experimental_AstroContainer.create();
  const mod = await import("../../src/components/CommunityEvidence.astro");
  type Renderable = Parameters<typeof container.renderToString>[0];
  return container.renderToString(mod.default as unknown as Renderable, {
    props: { locale: input.locale, problemId: input.problemId ?? PROBLEM_ID },
  });
}

/** The rendered section element, or `null` when the component stayed dormant. */
function sectionOf(html: string): Element | null {
  const dom = new JSDOM(html);
  return dom.window.document.querySelector("[data-community-evidence]");
}

beforeEach(() => {
  holder.config = null;
  holder.sources = [];
});

/* =========================================================================
 * 1. Dormant unless both the config AND a source are present
 * ====================================================================== */

describe("the section renders only when config AND a source are both present", () => {
  it("renders when both are present — POSITIVE CONTROL", async () => {
    holder.config = CONFIG;
    holder.sources = [SOURCE];
    expect(sectionOf(await render({ locale: "en" }))).not.toBeNull();
  });

  it("stays dormant when no source is registered (config present)", async () => {
    holder.config = CONFIG;
    holder.sources = [];
    const html = await render({ locale: "en" });
    expect(sectionOf(html)).toBeNull();
    // Not merely hidden — nothing at all, so a build with no source ships no
    // dormant markup for the section.
    expect(html).not.toContain("data-community-evidence");
  });

  it("stays dormant when Supabase is not configured (source present)", async () => {
    holder.config = null;
    holder.sources = [SOURCE];
    const html = await render({ locale: "en" });
    expect(sectionOf(html)).toBeNull();
    expect(html).not.toContain("data-community-evidence");
  });

  it("stays dormant when neither is present", async () => {
    holder.config = null;
    holder.sources = [];
    expect(sectionOf(await render({ locale: "en" }))).toBeNull();
  });
});

/* =========================================================================
 * 2. Hidden by default — and the [hidden] attribute is genuinely effective
 * ====================================================================== */

/* --- the cascade resolver, and its own self-tests (mutation-proofing) --- */

interface DisplayRule {
  readonly selector: string;
  readonly display: string;
  readonly important: boolean;
  readonly origin: "ua" | "author";
}

interface ElementDesc {
  readonly classes: readonly string[];
  readonly attrs: readonly string[];
}

/** A selector's specificity as `[ids, classes+attrs+pseudoclasses, types]`. */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const attrs = (selector.match(/\[[^\]]*\]/g) ?? []).length;
  const pseudoClasses = (selector.match(/(?<!:):(?!:)[\w-]+/g) ?? []).length;
  const pseudoElements = (selector.match(/::[\w-]+/g) ?? []).length;
  const types = (selector.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).length;
  return [ids, classes + attrs + pseudoClasses, types + pseudoElements];
}

/**
 * Whether a single (combinator-free) compound selector matches the element.
 * Selectors with a combinator cannot match an element examined in isolation,
 * so they are refused — none of the `display`-bearing rules involved here use
 * one, and treating a descendant selector as a match would be unsound.
 */
function selectorMatches(selector: string, element: ElementDesc): boolean {
  if (/[\s>+~]/.test(selector.trim())) return false;
  const needClasses = (selector.match(/\.[\w-]+/g) ?? []).map((c) =>
    c.slice(1)
  );
  const needAttrs = (selector.match(/\[([\w-]+)/g) ?? []).map((a) =>
    a.slice(1)
  );
  const classSet = new Set(element.classes);
  const attrSet = new Set(element.attrs);
  return (
    needClasses.every((c) => classSet.has(c)) &&
    needAttrs.every((a) => attrSet.has(a))
  );
}

/** The cascade rank: author `!important` > author normal > UA normal. */
function rank(rule: DisplayRule): number {
  if (rule.origin === "author") return rule.important ? 3 : 2;
  return rule.important ? 4 : 1; // UA important would be 4; not produced here
}

/**
 * The `display` value that actually wins for `element`, given `rules` in
 * source order — real cascade semantics (origin/`!important` tier, then
 * specificity, then source order), because jsdom's own `getComputedStyle`
 * does not model the tie this file exists to catch.
 */
/** `true` when `candidate` beats `incumbent` in the cascade, source order aside. */
function beats(candidate: DisplayRule, incumbent: DisplayRule): boolean {
  const a = rank(candidate);
  const b = rank(incumbent);
  if (a !== b) return a > b;
  const sa = specificity(candidate.selector);
  const sb = specificity(incumbent.selector);
  for (let i = 0; i < 3; i += 1) {
    if (sa[i] !== sb[i]) return sa[i] > sb[i];
  }
  return true; // equal specificity → later source order wins (candidate is later)
}

function winningDisplay(
  rules: readonly DisplayRule[],
  element: ElementDesc
): string | null {
  let winner: DisplayRule | null = null;
  for (const rule of rules) {
    if (!selectorMatches(rule.selector, element)) continue;
    if (winner === null || beats(rule, winner)) winner = rule;
  }
  return winner === null ? null : winner.display;
}

const UA_HIDDEN: DisplayRule = {
  selector: "[hidden]",
  display: "none",
  important: false,
  origin: "ua",
};
/** The real competitor: the section also carries `class="panel"`. */
const PANEL_FLEX: DisplayRule = {
  selector: ".panel",
  display: "flex",
  important: false,
  origin: "author",
};
const HIDDEN_ELEMENT: ElementDesc = {
  classes: ["panel", "community-evidence"],
  attrs: ["hidden"],
};

describe("winningDisplay — cascade resolver self-tests (mutation-proofing the probe)", () => {
  it("reproduces the T2-303/F10 defect: a bare [hidden] loses to .panel's flex", () => {
    expect(winningDisplay([UA_HIDDEN, PANEL_FLEX], HIDDEN_ELEMENT)).toBe(
      "flex"
    );
  });

  it("an author !important display:none on the hidden state wins", () => {
    const guard: DisplayRule = {
      selector: ".community-evidence[hidden]",
      display: "none",
      important: true,
      origin: "author",
    };
    expect(winningDisplay([UA_HIDDEN, PANEL_FLEX, guard], HIDDEN_ELEMENT)).toBe(
      "none"
    );
  });

  it("even without !important, the higher-specificity hidden rule wins", () => {
    const guard: DisplayRule = {
      selector: ".community-evidence[hidden]",
      display: "none",
      important: false,
      origin: "author",
    };
    expect(winningDisplay([UA_HIDDEN, PANEL_FLEX, guard], HIDDEN_ELEMENT)).toBe(
      "none"
    );
  });

  it("a hidden-state rule that sets display:flex does NOT count as hiding — POSITIVE CONTROL for the negative", () => {
    const notAGuard: DisplayRule = {
      selector: ".community-evidence[hidden]",
      display: "flex",
      important: true,
      origin: "author",
    };
    expect(
      winningDisplay([UA_HIDDEN, PANEL_FLEX, notAGuard], HIDDEN_ELEMENT)
    ).not.toBe("none");
  });
});

/* --- parse the component's real stylesheet, from source --- */

const COMPONENT_PATH = "../../src/components/CommunityEvidence.astro";

/** The component's single `<style>` body, from source. Requires exactly one. */
function componentStyle(): string {
  const source = readFileSync(new URL(COMPONENT_PATH, import.meta.url), "utf8");
  const matches = [
    ...source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g),
  ];
  expect(matches.length, "expected exactly one <style> block").toBe(1);
  return matches[0]?.[1] ?? "";
}

/** Every `display`-bearing (selector → value/important) pair in `css`. */
function displayRulesFromCss(css: string): DisplayRule[] {
  const dom = new JSDOM(`<style>${css}</style>`);
  const sheet = dom.window.document.styleSheets[0];
  const rules: DisplayRule[] = [];
  for (const rule of Array.from(sheet.cssRules) as unknown[]) {
    const styleRule = rule as {
      selectorText?: string;
      style?: {
        getPropertyValue(name: string): string;
        getPropertyPriority(name: string): string;
      };
    };
    if (!styleRule.selectorText || !styleRule.style) continue;
    const display = styleRule.style.getPropertyValue("display");
    if (display === "") continue;
    const important =
      styleRule.style.getPropertyPriority("display") === "important";
    for (const selector of styleRule.selectorText.split(",")) {
      rules.push({
        selector: selector.trim(),
        display,
        important,
        origin: "author",
      });
    }
  }
  return rules;
}

describe("the [hidden] attribute is genuinely effective (T2-303/F10 class)", () => {
  it("the rendered section carries the hidden attribute", async () => {
    holder.config = CONFIG;
    holder.sources = [SOURCE];
    const section = sectionOf(await render({ locale: "en" }));
    expect(section).not.toBeNull();
    expect(section?.hasAttribute("hidden")).toBe(true);
    // And it really is the `.panel`-classed element, so the competitor below
    // is the real one, not a strawman.
    expect(section?.classList.contains("panel")).toBe(true);
  });

  it("with the section's own stylesheet, the hidden element computes display:none", () => {
    const authorRules = displayRulesFromCss(componentStyle());
    const cascade = [UA_HIDDEN, PANEL_FLEX, ...authorRules];
    expect(winningDisplay(cascade, HIDDEN_ELEMENT)).toBe("none");
  });

  it("the guard is load-bearing — without the hidden-state rule the element would be visible", () => {
    // Strip the component's own `[hidden]`-qualified rules and confirm the
    // element would show `.panel`'s flex. This is what proves, on the REAL
    // file, that the `display:none` the test above sees comes from the guard
    // and not from something that would hide it anyway.
    const withoutGuard = displayRulesFromCss(componentStyle()).filter(
      (rule) => !rule.selector.includes("[hidden]")
    );
    const cascade = [UA_HIDDEN, PANEL_FLEX, ...withoutGuard];
    expect(winningDisplay(cascade, HIDDEN_ELEMENT)).not.toBe("none");
  });
});

/* =========================================================================
 * 3. problemId wiring
 * ====================================================================== */

describe("problemId is wired from the problem page", () => {
  it("the rendered section carries the problemId prop as data-problem-id", async () => {
    holder.config = CONFIG;
    holder.sources = [SOURCE];
    const section = sectionOf(
      await render({ locale: "en", problemId: "TEST-PROBLEM-wired-xyz" })
    );
    expect(section?.getAttribute("data-problem-id")).toBe(
      "TEST-PROBLEM-wired-xyz"
    );
  });

  it("the problem page passes the entry's stable id — the join key records hold", () => {
    // `record.problem_ids` are built from `entry.id` (referenceOptions in
    // [garageSegment].astro), so the page must hand the component `entry.id`,
    // not `prose[locale].slug`, or the client join matches nothing.
    const page = readFileSync(
      new URL(
        "../../src/pages/[locale]/[problemsSegment]/[problemSlug].astro",
        import.meta.url
      ),
      "utf8"
    );
    expect(page).toMatch(/<CommunityEvidence\b[^>]*\bproblemId=\{entry\.id\}/);
    // And it is passed the reader's locale, so the chrome is bilingual.
    expect(page).toMatch(/<CommunityEvidence\b[^>]*\blocale=\{locale\}/);
  });
});

/* =========================================================================
 * 4. Testimony, not authoritative repair guidance
 * ====================================================================== */

/**
 * The disclaimer anchors AGENTS.md's Facts amendment requires the note to
 * carry, per locale: these are the reader's own accounts, the site does not
 * verify them, and they are never presented as reference facts. Two anchors
 * each, so a rewrite that keeps the meaning still passes but one that turns the
 * band into authoritative guidance (dropping the disclaimer) fails.
 */
const TESTIMONY_ANCHORS: Record<Locale, readonly RegExp[]> = {
  en: [
    /reference facts?/i,
    /\b(does not|doesn't|never|not)\b[\s\S]*\b(check|verif)/i,
  ],
  es: [/datos de referencia/i, /\bno\b[\s\S]*\b(verifica|revisa|comprueba)/i],
};

describe("the band is framed as testimony (AGENTS.md Facts amendment)", () => {
  it.each(LOCALES)(
    "%s: leads with a testimony note, distinct from the heading",
    async (locale) => {
      holder.config = CONFIG;
      holder.sources = [SOURCE];
      const section = sectionOf(await render({ locale }));
      expect(section).not.toBeNull();

      const heading =
        section?.querySelector(".panel__title")?.textContent?.trim() ?? "";
      const note =
        section
          ?.querySelector(".community-evidence__note")
          ?.textContent?.trim() ?? "";

      expect(heading.length).toBeGreaterThan(0);
      expect(note.length).toBeGreaterThan(0);
      expect(note).not.toBe(heading);

      // Wired to the localized strings, not hard-coded.
      expect(heading).toBe(t(locale).problemCommunityEvidenceHeading);
      expect(note).toBe(t(locale).problemCommunityEvidenceNote);

      // And the note actually disclaims verification / reference-fact status.
      for (const anchor of TESTIMONY_ANCHORS[locale]) {
        expect(note).toMatch(anchor);
      }
    }
  );
});

/* =========================================================================
 * 5. Bilingual — distinct prose, no numeric divergence
 * ====================================================================== */

/** Every numeric token in `html`, as a sorted multiset. */
function numericTokens(html: string): string[] {
  return (html.match(/\d+(?:\.\d+)?/g) ?? []).sort();
}

/** The section text with tags flattened, for phrase comparison. */
function flatten(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("both locales emit distinct strings with no numeric divergence", () => {
  it("the en and es sections carry different prose", async () => {
    holder.config = CONFIG;
    holder.sources = [SOURCE];
    const en = await render({ locale: "en" });
    holder.config = CONFIG;
    holder.sources = [SOURCE];
    const es = await render({ locale: "es" });

    expect(sectionOf(en)).not.toBeNull();
    expect(sectionOf(es)).not.toBeNull();
    expect(t("en").problemCommunityEvidenceHeading).not.toBe(
      t("es").problemCommunityEvidenceHeading
    );
    expect(t("en").problemCommunityEvidenceNote).not.toBe(
      t("es").problemCommunityEvidenceNote
    );
    // The rendered chrome differs too, not only the source table.
    expect(flatten(en)).not.toBe(flatten(es));
  });

  it("every numeric token is identical across locales (numbers are shared data)", async () => {
    holder.config = CONFIG;
    holder.sources = [SOURCE];
    const en = await render({ locale: "en", problemId: PROBLEM_ID });
    holder.config = CONFIG;
    holder.sources = [SOURCE];
    const es = await render({ locale: "es", problemId: PROBLEM_ID });
    expect(numericTokens(en)).toEqual(numericTokens(es));
  });
});
