/**
 * Grader — **the community directory PAGE is wired to the neutral orderer,
 * T3-203a [TEST]**, activated by **T3-203 [PLATFORM]** (spec 003, the directory
 * claim flow and the `neutral-order.ts` extraction it ships).
 *
 * ## The coverage gap this closes (T3-201 review flag)
 *
 * `tests/shop/directory.test.ts` (T3-201) proves `directoryListing` is neutral
 * as a *module*: its output is byte-for-byte identical whoever is claimed,
 * paid, or a member (SHP-05). But nothing proves the directory **page** routes
 * through it. A T3-203 could ship a perfectly neutral `neutral-order.ts` and
 * still rank claimed/paid entries inline in
 * `src/pages/[locale]/[communitySegment].astro` — the module would pass every
 * T3-201 grader while the page a reader actually sees is not neutral. SHP-05 is
 * a claim about the directory a reader sees, so it has to hold at the page
 * level too.
 *
 * ## Why a STRUCTURAL read of the page source, not a render
 *
 * `tests/pages/showcase-worklog.render.test.ts` is this repo's precedent for
 * exactly this situation: Vitest cannot meaningfully drive an Astro page whose
 * ordering is decided in server frontmatter over a real `getCollection` read,
 * and the page's *exact* future shape is T3-203's to choose. So — as that file
 * does for the showcase `<script>` — this grader reads the page's own source
 * and asserts, *structurally*, the one property SHP-05 needs at the page level:
 * the community listing's order comes from `directoryListing`
 * ({@link DIRECTORY_ORDER_MODULE}), not from an inline sort in the page. This
 * mirrors the `community-filter.ts` extraction precedent — "everything that
 * decides whether a card is shown is unit-testable without a browser" — one
 * decision over: everything that decides the *order* of the cards moves into
 * `neutral-order.ts`, and the page delegates.
 *
 * Three independent structural clauses, one `it.fails` marker each so T3-203
 * activates them one at a time by deleting exactly that line:
 *  1. the page imports `directoryListing` from the neutral-order module;
 *  2. the page calls `directoryListing(...)` in its frontmatter;
 *  3. the page does not order the community entries with an inline `.sort()`.
 *
 * ## What this does and does not catch (say the limit out loud)
 *
 * Clause 3 catches a `.sort()` applied to the community-collection lineage —
 * the realistic inline-ranking shape (`entries.map(...).sort(rankByClaim)`),
 * including the review's exact worry of a page that imports `directoryListing`
 * yet still sorts inline. It does not attempt to catch every conceivable
 * non-`.sort` inline reordering (a hand-rolled partition), because the
 * authoritative, spelling-agnostic neutrality proof is T3-201's behavioural
 * module grader; this file's job is the page→module *wiring* that grader cannot
 * see. Every structural helper below is unit-tested on synthetic source first
 * (`.claude/GRADER-PRINCIPLES.md`, "mutation-test the probe corpus itself"), so
 * a helper that stops discriminating is caught here before any page relies on it.
 *
 * The controls (`ROUTING_FIXTURE` etc.) are hermetic and green today; the three
 * graders read the shipped page and fail today for the *right* reason — the
 * page has no neutral-order import and sorts the community entries inline right
 * now (`src/pages/[locale]/[communitySegment].astro`, `entries.map(...).sort(
 * (a, b) => collator.compare(a.title, b.title))`).
 *
 * refs specs/003-shop-tools (SHP-05, MON-05), specs/001-foundation (COM-01)
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DIRECTORY_LISTING_EXPORT,
  DIRECTORY_ORDER_MODULE,
} from "../shop/contract.ts";

/* =========================================================================
 * The page under test, and the module identity it must route through.
 * ====================================================================== */

/** The community directory page (COM-01), relative to this file. */
const DIRECTORY_PAGE_PATH = "../../src/pages/[locale]/[communitySegment].astro";

/**
 * The module-path *suffix* the page must import `directoryListing` from —
 * derived from the `./contract.ts` constant so a rename is one line there, not
 * a literal duplicated here. `DIRECTORY_ORDER_MODULE` is
 * `"../../src/lib/directory/neutral-order.ts"` (relative to `tests/shop/`); the
 * stable, path-prefix-independent part is `directory/neutral-order`, which the
 * page will import at whatever relative depth it sits (`../../lib/…`).
 */
const NEUTRAL_ORDER_SUFFIX = DIRECTORY_ORDER_MODULE.replace(
  /^.*\/lib\//,
  ""
).replace(/\.ts$/, "");

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* =========================================================================
 * Structural helpers — each unit-tested below before any page relies on it.
 * ====================================================================== */

/**
 * The Astro frontmatter (the code fenced between the first two `---` lines).
 * Throws, loudly, if the page has no frontmatter fence — a shape change this
 * grader cannot reason about must fail as "the shape is gone", never as a
 * silent empty string that makes every assertion vacuously true.
 */
function frontmatter(source: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) {
    throw new Error(
      "no Astro frontmatter fence (`---`) found — the directory page's shape " +
        "has changed and this structural grader cannot read it"
    );
  }
  return match[1];
}

/** `true` when `source` imports {@link DIRECTORY_LISTING_EXPORT} from the neutral-order module. */
function importsNeutralOrder(source: string): boolean {
  const re = new RegExp(
    `import\\s*(?:type\\s+)?\\{[^}]*\\b${DIRECTORY_LISTING_EXPORT}\\b[^}]*\\}` +
      `\\s*from\\s*["'][^"']*${escapeRegExp(NEUTRAL_ORDER_SUFFIX)}(?:\\.ts)?["']`
  );
  return re.test(source);
}

/** `true` when `frontmatter` calls `directoryListing(...)`. */
function callsDirectoryListing(frontmatterText: string): boolean {
  return new RegExp(`\\b${DIRECTORY_LISTING_EXPORT}\\s*\\(`).test(
    frontmatterText
  );
}

/** The `const <name> = await getCollection("community")` variable, or throws. */
function communityCollectionVar(frontmatterText: string): string {
  const match =
    /const\s+(\w+)\s*=\s*await\s+getCollection\(\s*["']community["']\s*\)/.exec(
      frontmatterText
    );
  if (!match) {
    throw new Error(
      'no `const … = await getCollection("community")` in the directory page ' +
        "frontmatter — its shape has changed and the inline-sort check cannot " +
        "root itself"
    );
  }
  return match[1];
}

/**
 * The set of variable names in the community-collection *lineage*: the
 * collection variable itself, plus any `const X = <first identifier is a
 * lineage var>` derived from it (`communities = entries.map(...)`). Iterated to
 * a fixpoint so a two-hop derivation is caught too.
 */
function communityLineage(
  frontmatterText: string,
  collectionVar: string
): ReadonlySet<string> {
  const lineage = new Set<string>([collectionVar]);
  let changed = true;
  let guard = 0;
  while (changed && guard < 8) {
    changed = false;
    guard += 1;
    for (const m of frontmatterText.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(\w+)/g
    )) {
      const name = m[1];
      const firstIdent = m[2];
      if (lineage.has(firstIdent) && !lineage.has(name)) {
        lineage.add(name);
        changed = true;
      }
    }
  }
  return lineage;
}

/** The matching opener index for the closer at `closeIndex`, or -1. */
function matchOpenLeft(text: string, closeIndex: number): number {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i--) {
    const ch = text[i];
    if (ch === ")" || ch === "]" || ch === "}") depth += 1;
    else if (ch === "(" || ch === "[" || ch === "{") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The root identifier of the method-chain receiver immediately to the left of
 * the `.` at `dotIndex`, or `null` when the receiver is not rooted at a bare
 * identifier (an array/object literal, a string, a call with no receiver name).
 * Walks left, jumping balanced `()[]{}` groups whole, so
 * `entries.map(...).sort` resolves to `entries` and `[...arr].sort` resolves to
 * `null`.
 */
function receiverRootBefore(text: string, dotIndex: number): string | null {
  let i = dotIndex - 1;
  const skipWs = () => {
    while (i >= 0 && /\s/.test(text[i])) i -= 1;
  };
  let root: string | null = null;
  skipWs();
  while (i >= 0) {
    const ch = text[i];
    if (ch === ")" || ch === "]" || ch === "}") {
      const open = matchOpenLeft(text, i);
      if (open < 0) return root;
      i = open - 1;
      skipWs();
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      const end = i;
      while (i >= 0 && /[A-Za-z0-9_$]/.test(text[i])) i -= 1;
      root = text.slice(i + 1, end + 1);
      skipWs();
      if (text[i] === ".") {
        i -= 1;
        skipWs();
        continue;
      }
      return root;
    }
    return root;
  }
  return root;
}

/** The receiver-root of every `.sort(` in `frontmatter`. */
function sortReceiverRoots(frontmatterText: string): (string | null)[] {
  const roots: (string | null)[] = [];
  for (const m of frontmatterText.matchAll(/\.sort\s*\(/g)) {
    roots.push(receiverRootBefore(frontmatterText, m.index ?? 0));
  }
  return roots;
}

/**
 * The names of community-lineage variables that are inline-sorted in the page
 * frontmatter — a non-empty result is an SHP-05 page-level violation: the
 * community order is computed inline rather than delegated to
 * `directoryListing`. A facet-option `.sort()` (rooted at an array literal or a
 * non-lineage variable) is *not* here, which is the whole point.
 */
function inlineCommunitySortRoots(frontmatterText: string): string[] {
  const collectionVar = communityCollectionVar(frontmatterText);
  const lineage = communityLineage(frontmatterText, collectionVar);
  return sortReceiverRoots(frontmatterText).filter(
    (root): root is string => root !== null && lineage.has(root)
  );
}

/** Every SHP-05 page-wiring finding against `source`. Empty = the page delegates. */
function directoryOrderingIssues(source: string): string[] {
  const fm = frontmatter(source);
  const issues: string[] = [];
  if (!importsNeutralOrder(source)) {
    issues.push(
      `the page does not import ${DIRECTORY_LISTING_EXPORT} from ` +
        `${NEUTRAL_ORDER_SUFFIX} — SHP-05 ordering must be delegated to the ` +
        `neutral module, not computed in the page`
    );
  }
  if (!callsDirectoryListing(fm)) {
    issues.push(
      `the page never calls ${DIRECTORY_LISTING_EXPORT}(...) — nothing routes ` +
        `the community listing through the neutral orderer`
    );
  }
  for (const root of inlineCommunitySortRoots(fm)) {
    issues.push(
      `the page orders the community entries with an inline .sort() on ` +
        `\`${root}\` — SHP-05 order must come from ${DIRECTORY_LISTING_EXPORT}, ` +
        `not an inline sort in the page`
    );
  }
  return issues;
}

/* =========================================================================
 * Synthetic page-source fixtures — obviously not the real page.
 * ====================================================================== */

const IMPORT_LINE = `import { ${DIRECTORY_LISTING_EXPORT} } from "../../lib/${NEUTRAL_ORDER_SUFFIX}";`;

/** A page that delegates ordering to directoryListing — SHP-05-correct. */
const ROUTING_FIXTURE = `---
${IMPORT_LINE}
const entries = await getCollection("community");
const cards = entries.map((e) => ({ id: e.id, title: e.data.prose.en.title }));
const ordered = ${DIRECTORY_LISTING_EXPORT}(cards, { viewerAccountId: null });
---
<ul>{ordered.map((id) => <li>{id}</li>)}</ul>
`;

/** The current-page defect shape: sorts community entries inline, no neutral module. */
const INLINE_SORT_FIXTURE = `---
const entries = await getCollection("community");
const communities = entries
  .map((e) => ({ id: e.id, title: e.data.prose.en.title }))
  .sort((a, b) => collator.compare(a.title, b.title));
---
<ul>{communities.map((c) => <li>{c.id}</li>)}</ul>
`;

/** The review's exact worry: imports directoryListing yet still ranks inline. */
const IMPORTS_BUT_SORTS_FIXTURE = `---
${IMPORT_LINE}
const entries = await getCollection("community");
const communities = entries
  .map((e) => ({ id: e.id, title: e.data.prose.en.title }))
  .sort((a, b) => rankByClaim(a) - rankByClaim(b));
const unused = ${DIRECTORY_LISTING_EXPORT}(communities, {});
---
<ul>{communities.map((c) => <li>{c.id}</li>)}</ul>
`;

/** Delegates, and legitimately sorts a FACET-OPTIONS array — must NOT be flagged. */
const FACET_SORT_FIXTURE = `---
${IMPORT_LINE}
const entries = await getCollection("community");
const cards = entries.map((e) => ({ id: e.id, regions: e.data.regions }));
const ordered = ${DIRECTORY_LISTING_EXPORT}(cards, {});
const regionOptions = [...new Set(cards.flatMap((c) => c.regions))].sort(
  (a, b) => collator.compare(a, b)
);
---
<ul>{ordered.map((id) => <li>{id}</li>)}</ul>
`;

/* =========================================================================
 * Helper self-tests — mutation-proof the probe before any page relies on it.
 * ====================================================================== */

describe("receiverRootBefore / sortReceiverRoots — helper self-test", () => {
  it("resolves a chained sort to its collection root", () => {
    const fm = `const x = entries.map((e) => e.id).sort((a, b) => a - b);`;
    const dot = fm.indexOf(".sort");
    expect(receiverRootBefore(fm, dot)).toBe("entries");
  });

  it("resolves a sort on an array literal to null (a facet-options sort)", () => {
    const fm = `const o = [...new Set(cards.flatMap((c) => c.regions))].sort((a, b) => a - b);`;
    const dot = fm.indexOf(".sort");
    expect(receiverRootBefore(fm, dot)).toBeNull();
  });

  it("balances nested mixed brackets rather than stopping at the first opener", () => {
    const fm = `const x = entries.map((e) => ({ id: e.id, gens: [e.g] })).sort((a, b) => a - b);`;
    const dot = fm.indexOf(".sort");
    expect(receiverRootBefore(fm, dot)).toBe("entries");
  });

  it("collects every .sort receiver root in order", () => {
    const fm = `const a = xs.sort(f); const b = [1].sort(g); const c = ys.map(h).sort(k);`;
    expect(sortReceiverRoots(fm)).toEqual(["xs", null, "ys"]);
  });

  it("roots a `return [...].map().sort()` at the keyword `return`, never a lineage var", () => {
    // The real directory page's facet-option sort has exactly this shape
    // (`labeledOptions`: `return [...byCode.entries()].map(...).sort(...)`).
    // The receiver root is the keyword before the array literal, which is never
    // a community-lineage variable — so the facet sort is correctly excluded by
    // `inlineCommunitySortRoots`, and only the community-entries sort remains.
    const fm = `return [...byCode.entries()].map((x) => x).sort((a, b) => a - b);`;
    const dot = fm.indexOf(".sort");
    expect(receiverRootBefore(fm, dot)).toBe("return");
  });
});

describe("communityLineage — helper self-test", () => {
  it("includes the collection var and every var derived from it", () => {
    const fm = `const entries = await getCollection("community");
const communities = entries.map((e) => e.id);
const regionOptions = labeledOptions(communities);`;
    const lineage = communityLineage(fm, "entries");
    expect(lineage.has("entries")).toBe(true);
    expect(lineage.has("communities")).toBe(true);
    // A var derived through a *function call* (labeledOptions) is NOT lineage:
    // its first identifier is the function, not a lineage var.
    expect(lineage.has("regionOptions")).toBe(false);
  });
});

describe("importsNeutralOrder / callsDirectoryListing — helper self-test", () => {
  it("recognizes the import from the neutral-order module (with or without .ts)", () => {
    expect(importsNeutralOrder(IMPORT_LINE)).toBe(true);
    expect(
      importsNeutralOrder(
        `import { ${DIRECTORY_LISTING_EXPORT} } from "../../lib/${NEUTRAL_ORDER_SUFFIX}.ts";`
      )
    ).toBe(true);
  });

  it("does NOT recognize an import of some other symbol from the module — POSITIVE CONTROL", () => {
    expect(
      importsNeutralOrder(
        `import { somethingElse } from "../../lib/${NEUTRAL_ORDER_SUFFIX}";`
      )
    ).toBe(false);
  });

  it("does NOT recognize directoryListing imported from an unrelated path", () => {
    expect(
      importsNeutralOrder(
        `import { ${DIRECTORY_LISTING_EXPORT} } from "../../lib/community-filter";`
      )
    ).toBe(false);
  });

  it("recognizes a directoryListing call in frontmatter", () => {
    expect(
      callsDirectoryListing(`const o = directoryListing(cards, ctx);`)
    ).toBe(true);
    expect(callsDirectoryListing(`const o = cards.slice();`)).toBe(false);
  });
});

/* =========================================================================
 * directoryOrderingIssues — the corpus is discriminating (green today).
 * ====================================================================== */

describe("directoryOrderingIssues — mutation-test the corpus", () => {
  it("a page that delegates ordering to directoryListing PASSES (satisfiable)", () => {
    expect(directoryOrderingIssues(ROUTING_FIXTURE)).toEqual([]);
  });

  it("the current inline-sort defect shape FAILS on all three clauses (bites)", () => {
    const issues = directoryOrderingIssues(INLINE_SORT_FIXTURE);
    expect(issues.length).toBe(3);
    expect(issues.join(" | ")).toContain("does not import");
    expect(issues.join(" | ")).toContain("never calls");
    expect(issues.join(" | ")).toContain("inline .sort() on `entries`");
  });

  it("imports directoryListing yet still ranks inline STILL FAILS (the review's worry)", () => {
    const issues = directoryOrderingIssues(IMPORTS_BUT_SORTS_FIXTURE);
    // import ✓, call ✓, but the community entries are inline-sorted → 1 finding.
    expect(issues).toEqual([
      expect.stringContaining("inline .sort() on `entries`"),
    ]);
  });

  it("a delegating page with a legitimate facet-options sort is NOT flagged (no false positive)", () => {
    expect(directoryOrderingIssues(FACET_SORT_FIXTURE)).toEqual([]);
  });
});

/* =========================================================================
 * The graders — red today, activated by T3-203's neutral-order extraction.
 * ====================================================================== */

function directoryPageSource(): string {
  return readFileSync(new URL(DIRECTORY_PAGE_PATH, import.meta.url), "utf8");
}

describe("the community directory page routes ordering through the neutral module (SHP-05)", () => {
  it("imports directoryListing from the neutral-order module", () => {
    expect(importsNeutralOrder(directoryPageSource())).toBe(true);
  });

  it("calls directoryListing(...) in its frontmatter", () => {
    expect(callsDirectoryListing(frontmatter(directoryPageSource()))).toBe(
      true
    );
  });

  it("does not order the community entries with an inline .sort()", () => {
    expect(
      inlineCommunitySortRoots(frontmatter(directoryPageSource()))
    ).toEqual([]);
  });
});
