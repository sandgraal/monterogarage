/**
 * Render / structural graders for the **shop-management page** — declared by
 * **T3-202b [TEST]**, against a page (and a client module, and route/string
 * registrations) that **T3-202c [PLATFORM]** has not built yet.
 *
 * ## Why this task exists
 *
 * T3-202 shipped the shops *data layer* — the three tables and the four RPCs in
 * `supabase/migrations/20260908120000_shops_membership.sql` — and its graders
 * (`tests/shop/*`) prove that layer. But code review found **no task owned the
 * user-facing page**, so SHP-01 ("a user SHALL be able to create a shop, and to
 * invite other accounts into it as members") and SHP-03 (a shop member seeing
 * the roster) were unreachable *end to end*. The owner approved building the
 * page (2026-09-08); this file grades it, and `tests/shop/contract.ts`'s new
 * "T3-202b" block is the fixed seam T3-202c builds against (route/segment, DOM
 * hooks, RPC names, the required `ui.ts` keys, the client-module path).
 *
 * ## What is grade-able structurally, and what is deliberately left out
 *
 * This is a **static** grader, exactly like `procedures-index.render.test.ts`
 * (T504a) and `showcase-worklog.render.test.ts` (T2-404c): Astro compiles a
 * page's `<script>` to an empty client module under Vitest's SSR transform, so
 * the page's runtime behaviour cannot be *executed* here. What it *can* do is
 * read the shipped source **structurally** — the built page's markup and the
 * client module's text — and read the registries the page depends on
 * (`COLLECTION_ROUTE_SEGMENTS`, `RESERVED_HANDLES`, `ui`) at runtime. So this
 * file grades:
 *
 *  1. the route/segment is registered, bilingual, and reserved (SHP-01, I18N);
 *  2. the page's user-facing strings exist in both locales via `ui.ts` (ACC-02);
 *  3. the page is account-gated (a signed-out gate, a `hidden` app, `<noscript>`);
 *  4. it carries a create control, an email invite control, and a roster;
 *  5. its writes go through the definer RPCs — no direct table write from the
 *     client (SHP-01);
 *  6. a failed `shop_roster` read is never rendered as an empty roster — the
 *     four roster states are distinct (AGENTS.md: a failure is not a zero).
 *
 * What it does **not** grade — and what therefore belongs to T3-202c's own
 * review and to `tests/e2e/`: that clicking "create" actually calls the RPC and
 * the roster repaints, that the consent/SHP-04 prompt behaves, the ES register
 * reads naturally (the bilingual-editor pass owns register nuance beyond the
 * mechanical `ui.test.ts` `tú`/`vos` scan), and accept-invite (a separate
 * surface, not this create/invite/roster page).
 *
 * ## How each marked grader fails **today, for the right reason**
 *
 * Every negative is one of two honest shapes, never an import error or an
 * ENOENT crash (`.claude/GRADER-PRINCIPLES.md`, "a test that fails for the
 * wrong reason proves nothing"):
 *
 *  · **registry reads** assert a key/segment/handle is present *before* reading
 *    through it, so today's failure is a clean "no `shops` segment registered",
 *    not a `TypeError` on `undefined[locale]`;
 *  · **source reads** go through {@link readOptionalSource}, which returns
 *    `null` (never throws) for a file T3-202c has not written, so today's
 *    failure is a clean "shop page not built yet at <path>".
 *
 * ## Positive controls and mutation-proofing
 *
 * Every text-scan helper is unit-tested against inline fixtures with both a
 * positive and a negative control, decoupled from any file on disk, so a broken
 * regex is caught here first (GRADER-PRINCIPLES, "mutation-test the probe corpus
 * itself"). And every helper that a marked grader relies on is *also* run,
 * green, against the **shipped** garage page / `shares.ts` — proving the helper
 * recognises the correct shipped pattern, so a marked shop grader failing today
 * means "the shop surface is not built", not "the helper never matches
 * anything" (GRADER-PRINCIPLES, "every finding needs a positive control").
 *
 * ## Expected-failure convention
 *
 * `it.fails`, one marker line per test — T3-202c activates a grader by deleting
 * exactly that `.fails`, never by editing an assertion or a fixture (AGENTS.md's
 * activation rule). The plain `it(...)` tests here are the helper self-tests and
 * the shipped-code positive controls; they pass today and must keep passing.
 *
 * Every marked grader was proved to go green *for the right reason* before this
 * file was committed: the author wrote a throwaway minimal page at
 * `SHOP_PAGE_SOURCE_PATH`, a throwaway `shops.ts`, and throwaway `shops`
 * entries in `routes.ts` / `handles.ts` / `ui.ts` carrying exactly these hooks,
 * strings, and RPC calls, deleted every `.fails`, watched the suite go green,
 * then reverted all of it. "Simulate the activation; do not argue it from the
 * diff."
 *
 * refs specs/003-shop-tools (SHP-01, SHP-03), specs/002-montero-garage (ACC-02),
 * specs/001-foundation (I18N-01, I18N-04, I18N-05, I18N-08)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALES,
  localeHref,
  localizedAlternateLinks,
  type Locale,
  type LocalizedRoutePaths,
} from "../../src/i18n/routing.ts";
import { COLLECTION_ROUTE_SEGMENTS } from "../../src/i18n/routes.ts";
import { RESERVED_HANDLES } from "../../src/lib/garage/handles.ts";
import { ui } from "../../src/i18n/ui.ts";
import {
  POSTGREST_WRITE_METHODS,
  SHOP_CLIENT_MODULE_PATH,
  SHOP_PAGE_HOOKS,
  SHOP_PAGE_SOURCE_PATH,
  SHOP_ROUTE_SEGMENTS,
  SHOP_UI_RPCS,
  SHOP_UI_STRING_KEYS,
} from "../shop/contract.ts";

/* -------------------------------------------------------------------------
 * Reading source that may not exist yet, without crashing.
 *
 * A page T3-202c has not written must fail its graders as a clean, named
 * assertion ("not built yet"), never as an ENOENT that `it.fails` would count
 * as an expected failure for entirely the wrong reason. `readOptionalSource`
 * returns `null` on any read error; `readShippedSource` is its strict sibling
 * for the shipped positive-control files, where a missing file *is* a real bug.
 * ---------------------------------------------------------------------- */

/** Absolute path for a repo path relative to this file's `tests/pages/` dir. */
function repoPath(relPathFromRepoRoot: string): string {
  return fileURLToPath(
    new URL(`../../${relPathFromRepoRoot}`, import.meta.url)
  );
}

/** The file's text, or `null` if it does not exist / cannot be read. */
function readOptionalSource(relPathFromRepoRoot: string): string | null {
  try {
    return readFileSync(repoPath(relPathFromRepoRoot), "utf8");
  } catch {
    return null;
  }
}

/** The file's text; throws (a real bug) if a shipped file is missing. */
function readShippedSource(relPathFromRepoRoot: string): string {
  return readFileSync(repoPath(relPathFromRepoRoot), "utf8");
}

const SHOP_PAGE = () => readOptionalSource(SHOP_PAGE_SOURCE_PATH);
const SHOP_CLIENT = () => readOptionalSource(SHOP_CLIENT_MODULE_PATH);

/** The shipped garage page / share client — the positive-control corpus. */
const GARAGE_PAGE_PATH = "src/pages/[locale]/[garageSegment].astro";
const GARAGE_CLIENT_PATH = "src/lib/supabase/garage.ts";
const SHARES_CLIENT_PATH = "src/lib/supabase/shares.ts";

/* =========================================================================
 * Probe helpers — each mutation-proofed by its own self-test below.
 * ====================================================================== */

/** Does `source` call `client.rpc("<name>")` (single- or double-quoted)? */
function callsRpc(source: string, name: string): boolean {
  return new RegExp(`\\.rpc\\s*\\(\\s*["']${name}["']`).test(source);
}

/**
 * Every direct PostgREST table **write** in `source`: a write verb chained onto
 * a `.from(...)` call. Anchored to `.from(...)` on purpose — that is what makes
 * it a table write rather than a `Map`/`Set` `.delete(...)`, and it enumerates
 * the whole write-verb category ({@link POSTGREST_WRITE_METHODS}) rather than
 * one spelling (GRADER-PRINCIPLES: grade behaviour, not name lists).
 */
function directTableWrites(source: string): string[] {
  const verbs = POSTGREST_WRITE_METHODS.join("|");
  const pattern = new RegExp(
    `\\.from\\s*\\([^)]*\\)\\s*\\.\\s*(?:${verbs})\\s*\\(`,
    "g"
  );
  return [...source.matchAll(pattern)].map((m) => m[0]);
}

/** The digit-runs in a string, sorted — for per-locale number-parity checks. */
function digitRuns(value: string): string[] {
  return (value.match(/\d+/g) ?? []).slice().sort();
}

/**
 * Does the page `<script>` keep a **failed** roster read distinct from an
 * **empty** one? The structural signature of "a failure is not a zero" on this
 * page: the script references the dedicated failure-message element, carries a
 * failure token (a `"failed"` status, a `!x.ok` / `.reason` read, or an
 * "unavailable" string), and drives the *empty* element off an emptiness
 * condition (`.length …`) — three separate facts, so a script that toggled the
 * empty note on `!ok` (collapsing the two) does not satisfy it.
 */
function distinguishesFailureFromEmpty(
  script: string,
  hooks: typeof SHOP_PAGE_HOOKS
): boolean {
  const referencesMessage = script.includes(hooks.rosterMessage);
  const referencesEmpty = script.includes(hooks.rosterEmpty);
  const referencesLoading = script.includes(hooks.rosterLoading);
  const hasFailureToken =
    /["']failed["']|![A-Za-z_$][\w$]*\.ok\b|\.reason\b|[Uu]navailable/.test(
      script
    );
  const hasEmptyCondition = /\.length\b/.test(script);
  return (
    referencesMessage &&
    referencesEmpty &&
    referencesLoading &&
    hasFailureToken &&
    hasEmptyCondition
  );
}

/**
 * Does the **opening tag** that carries `hookAttr` also carry a literal
 * `hidden` attribute — as opposed to `hookAttr` and `hidden` merely both
 * appearing *somewhere* in the source, in either order, with no requirement
 * that they belong to the same element?
 *
 * Finds every complete opening tag in `source` (`<tag ...>`, a run of
 * non-`>` characters so it can never cross into a second tag), keeps the ones
 * whose attribute list carries `hookAttr` as a whole attribute token, and asks
 * whether that *same* tag also carries `hidden` as a whole attribute token —
 * `\s${name}(?=[\s=/>])`, so `aria-hidden="true"` does not satisfy `hidden`
 * (the hyphen is not a token boundary this checks for) and a JS property
 * access (`app.hidden`) inside a `<script>` never reads as an HTML attribute,
 * because it is never inside an opening tag's `<...>` run in the first place.
 *
 * This is the fix for the code-review finding that
 * `` new RegExp(`${hook}[^>]*\\bhidden\\b`) `` matched `data-shop-app` in a
 * `<script>` selector string followed, arbitrarily far downstream and past no
 * `>`, by an unrelated `app.hidden = false` — passing even when the
 * server-rendered element itself carried no `hidden` attribute at all
 * (T3-202b code review, fix 1).
 */
function elementCarriesHiddenAttribute(
  source: string,
  hookAttr: string
): boolean {
  const tags = source.match(/<[A-Za-z][\w-]*\b[^>]*>/g) ?? [];
  const carriesToken = (tag: string, name: string): boolean =>
    new RegExp(`\\s${name}(?=[\\s=/>])`).test(tag);
  return tags.some(
    (tag) => carriesToken(tag, hookAttr) && carriesToken(tag, "hidden")
  );
}

/**
 * Does an actual session read — `.getSession(` or `.onAuthStateChange(`
 * **called**, not merely mentioned — appear in `pageSource`, or in
 * `clientSource` if the page delegates to a client module?
 *
 * This is the fix for the code-review finding that
 * `/getSession|onAuthStateChange|SUPABASE_BROWSER_CONFIG/` was satisfied by
 * `import { SUPABASE_BROWSER_CONFIG } from "..."` alone — which every
 * RPC-calling page carries, whether or not it ever checks who is signed in —
 * so a page that reveals its app unconditionally still passed as long as it
 * imported the config for an unrelated reason (T3-202b code review, fix 3).
 *
 * `clientSource` was added in a second review round: the *shipped* garage
 * page never calls `.getSession()`/`.onAuthStateChange()` itself — it
 * delegates to `currentUserIdIfAny` in `src/lib/supabase/garage.ts`, and the
 * real session read lives there. A page-only scan reported that shipped,
 * correct pattern as "no session check", which would have forced a correct
 * T3-202c that copied the garage precedent (session read in `shops.ts`) into
 * a spec-inconsistent inline check in the `.astro` page just to satisfy this
 * grader. Checking **either** source fixes the false negative without
 * reopening the bare-import bypass in the new source: each source is tested
 * for an actual *call*, exactly as before, not merely mentioned or imported
 * (T3-202b code review round 2).
 */
function checksSessionBeforeReveal(
  pageSource: string,
  clientSource: string | null
): boolean {
  const callsSession = (source: string): boolean =>
    /\.getSession\s*\(|\.onAuthStateChange\s*\(/.test(source);
  return (
    callsSession(pageSource) ||
    (clientSource !== null && callsSession(clientSource))
  );
}

/**
 * The index of the `closeCh` that balances the `openCh` at
 * `source[openIndex]`, tracking nesting depth so an inner pair of the same
 * two characters does not end the search early. `-1` if the source ends
 * before the pair balances (a real bug in the source, never expected against
 * real TS).
 */
function matchingDelimiterIndex(
  source: string,
  openIndex: number,
  openCh: string,
  closeCh: string
): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === openCh) depth += 1;
    else if (source[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The index of a function's real opening `{`, starting the search right
 * after its parameter list's closing `)`.
 *
 * Tracks **angle-bracket depth**, not brace depth, and returns only a `{`
 * seen while that depth is `0` — so a return type shaped like
 * `Promise<{ ok: true } | { ok: false }>` (a plausible discriminated-result
 * type, and the exact shape this file's own scratch fixtures used while
 * proving this helper) does not read as the function's body just because it
 * is the first `{` in the source: both of its braces sit inside the
 * `Promise<...>` angle brackets, so this only stops once that generic has
 * closed.
 */
function functionBodyOpenBraceIndex(source: string, fromIndex: number): number {
  let angleDepth = 0;
  for (let i = fromIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "<") angleDepth += 1;
    else if (ch === ">") {
      if (angleDepth > 0) angleDepth -= 1;
    } else if (ch === "{" && angleDepth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Every top-level function body in `source` — `function name(...) { ... }` /
 * `async function name(...) { ... }`, and their `const name = async (...) =>
 * { ... }` sibling (the two shapes `shares.ts` and `garage.ts` actually use)
 * — extracted by balancing delimiters from the parameter list onward, rather
 * than a bounded regex, so neither a nested `if`/`for` inside the function
 * nor a parenthesized type in a parameter's own type annotation (`ask: () =>
 * Promise<string | null>`, `garage.ts`'s real `currentUserIdIfAny` signature)
 * truncates the parameter list early, and an inline-brace return type does
 * not get mistaken for the function's opening brace.
 */
function topLevelFunctionBodies(source: string): string[] {
  const startPattern =
    /(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*\(|(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*async\s*(?:<[^>]*>)?\s*\(/g;
  const bodies: string[] = [];
  for (const m of source.matchAll(startPattern)) {
    if (m.index === undefined) continue;
    const openParenIndex = m.index + m[0].length - 1;
    const closeParenIndex = matchingDelimiterIndex(
      source,
      openParenIndex,
      "(",
      ")"
    );
    if (closeParenIndex === -1) continue;
    const openBraceIndex = functionBodyOpenBraceIndex(
      source,
      closeParenIndex + 1
    );
    if (openBraceIndex === -1) continue;
    const closeBraceIndex = matchingDelimiterIndex(
      source,
      openBraceIndex,
      "{",
      "}"
    );
    if (closeBraceIndex === -1) continue;
    bodies.push(source.slice(openBraceIndex, closeBraceIndex + 1));
  }
  return bodies;
}

/**
 * The body of the **one function** in `source` whose body calls
 * `.rpc(rpcName, ...)` — found by behaviour, not by an assumed function name,
 * mirroring how {@link directTableWrites} scopes to `.from(...)` chains
 * rather than scanning the whole file (GRADER-PRINCIPLES: grade behaviour,
 * not a name list). `""` if no top-level function calls that rpc.
 *
 * This is the fix for the code-review finding that the discriminated-failure
 * grader scanned the *whole* `shops.ts`, so a module that handled
 * `create_shop`/`invite_to_shop` errors correctly but silently dropped a
 * `shop_roster` failure to `{ ok: true, value: [] }` still passed — the
 * *other* two functions' `ok: false` satisfied a whole-file regex regardless
 * of what the roster function itself did (T3-202b code review, fix 2).
 */
function functionBodyCallingRpc(source: string, rpcName: string): string {
  return (
    topLevelFunctionBodies(source).find((body) => callsRpc(body, rpcName)) ?? ""
  );
}

/* -------------------------------------------------------------------------
 * Helper self-tests (mutation-proofing the probes). These pass today.
 * ---------------------------------------------------------------------- */

describe("callsRpc — helper self-test", () => {
  it("matches a double- or single-quoted rpc call — POSITIVE CONTROL", () => {
    expect(
      callsRpc(`await c.rpc("create_shop", { p_name })`, "create_shop")
    ).toBe(true);
    expect(callsRpc(`c.rpc('shop_roster', { p_shop_id })`, "shop_roster")).toBe(
      true
    );
  });

  it("does not match a different rpc name, or a bare mention — NEGATIVE CONTROL", () => {
    expect(callsRpc(`c.rpc("invite_to_shop")`, "create_shop")).toBe(false);
    expect(callsRpc(`// create_shop is an RPC`, "create_shop")).toBe(false);
  });
});

describe("directTableWrites — helper self-test", () => {
  it("flags every write verb chained onto .from(...) — POSITIVE CONTROL", () => {
    for (const verb of POSTGREST_WRITE_METHODS) {
      expect(
        directTableWrites(`c.from("shops").${verb}({ name })`),
        verb
      ).toHaveLength(1);
    }
  });

  it("does NOT flag a .from(...).select(...) read", () => {
    // Reading shop tables is legitimate (the migration grants member-scoped
    // SELECT with RLS); only writes must go through the definer RPCs.
    expect(directTableWrites(`c.from("shops").select("id, name")`)).toEqual([]);
  });

  it("does NOT flag a Map/Set .delete(...) — the false positive to avoid", () => {
    expect(directTableWrites(`state.delete(key); seen.delete(id);`)).toEqual(
      []
    );
  });

  it("does NOT flag an .rpc(...) call — writes-through-RPC is the point", () => {
    expect(directTableWrites(`c.rpc("create_shop", { p_name })`)).toEqual([]);
  });
});

describe("digitRuns — helper self-test", () => {
  it("extracts and sorts digit runs — POSITIVE CONTROL", () => {
    expect(digitRuns("up to 5 seats, 30-day trial")).toEqual(["30", "5"]);
  });

  it("catches a per-locale number divergence — NEGATIVE CONTROL", () => {
    // The exact defect the shop-strings parity check exists to catch: a figure
    // that differs between locales instead of being one shared number.
    expect(digitRuns("up to 5 members")).not.toEqual(
      digitRuns("hasta 3 miembros")
    );
    expect(digitRuns("no numbers here")).toEqual(digitRuns("aquí sin cifras"));
  });
});

describe("distinguishesFailureFromEmpty — helper self-test", () => {
  const H = SHOP_PAGE_HOOKS;

  it("recognises three distinct roster states — POSITIVE CONTROL", () => {
    const correct = `
      const roster = q("[${"data-shop-roster"}]");
      const loading = q("[${H.rosterLoading}]");
      const message = q("[${H.rosterMessage}]");
      const empty = q("[${H.rosterEmpty}]");
      const result = await readShopRoster(id);
      loading.hidden = true;
      if (!result.ok) { message.hidden = false; return; }
      empty.hidden = result.value.length > 0;
    `;
    expect(distinguishesFailureFromEmpty(correct, H)).toBe(true);
  });

  it("rejects a page that collapses failure into empty — NEGATIVE CONTROL", () => {
    // The defect: no dedicated failure element, and the empty note is shown
    // whenever the list is not populated — including when the read *failed*.
    const collapsed = `
      const empty = q("[${H.rosterEmpty}]");
      const loading = q("[${H.rosterLoading}]");
      const rows = (await readShopRoster(id)) ?? [];
      empty.hidden = rows.length > 0;
    `;
    expect(distinguishesFailureFromEmpty(collapsed, H)).toBe(false);
  });
});

describe("elementCarriesHiddenAttribute — helper self-test", () => {
  it("recognises hidden on the same opening tag, either attribute order — POSITIVE CONTROL", () => {
    expect(
      elementCarriesHiddenAttribute(
        `<div data-shop-app hidden>`,
        "data-shop-app"
      )
    ).toBe(true);
    expect(
      elementCarriesHiddenAttribute(
        `<div hidden data-shop-app>`,
        "data-shop-app"
      )
    ).toBe(true);
  });

  it("does NOT match a <script> reference to the hook plus an unrelated later `.hidden` — NEGATIVE CONTROL", () => {
    // The exact bypass code review found: the hook string reappears inside a
    // query-selector literal in a <script>, and `hidden` reappears far later
    // as a JS property write — neither lives inside the actual opening tag,
    // which here carries no `hidden` attribute at all.
    const bypass = `
      <div data-shop-app>
        <p>content</p>
      </div>
      <script>
        const app = document.querySelector("[data-shop-app]");
        app.hidden = false;
      </script>
    `;
    expect(elementCarriesHiddenAttribute(bypass, "data-shop-app")).toBe(false);
  });

  it("does NOT accept aria-hidden as standing in for hidden — NEGATIVE CONTROL", () => {
    expect(
      elementCarriesHiddenAttribute(
        `<div data-shop-app aria-hidden="true">`,
        "data-shop-app"
      )
    ).toBe(false);
  });
});

describe("checksSessionBeforeReveal — helper self-test", () => {
  it("recognises an actual getSession()/onAuthStateChange() call in the page source — POSITIVE CONTROL", () => {
    expect(
      checksSessionBeforeReveal(
        `const { data } = await client.auth.getSession();`,
        null
      )
    ).toBe(true);
    expect(
      checksSessionBeforeReveal(
        `client.auth.onAuthStateChange((event, session) => {});`,
        null
      )
    ).toBe(true);
  });

  it("recognises the session read when it lives only in the client module — POSITIVE CONTROL (garage delegation pattern)", () => {
    // The shape a correct T3-202c may legitimately ship: the page has no
    // inline session check at all — it delegates to a
    // `currentUserIdIfAny`-shaped wrapper in `shops.ts`, and the real
    // `.getSession()` call lives there. This is the exact false negative the
    // union across both sources exists to remove.
    const page =
      "<div data-shop-app hidden></div>\n" +
      "<script>\n" +
      '  import { currentUserIdIfAny } from "../../lib/supabase/shops.ts";\n' +
      "  void currentUserIdIfAny(window);\n" +
      "</script>";
    const client =
      "export async function currentUserIdIfAny(win) {\n" +
      "  const { data } = await client.auth.getSession();\n" +
      "  return data.session?.user.id ?? null;\n" +
      "}";
    expect(checksSessionBeforeReveal(page, client)).toBe(true);
  });

  it("does NOT match a bare, unused import of the browser config in either source — NEGATIVE CONTROL", () => {
    // The exact bypass code review found: importing SUPABASE_BROWSER_CONFIG
    // satisfied the old regex whether or not the page ever checked a
    // session. Extending the check to a second source must not reopen that
    // bypass there: a client module that only imports the config, never
    // calling getSession()/onAuthStateChange(), must not satisfy the union.
    const bypassPage =
      'import { SUPABASE_BROWSER_CONFIG } from "../../lib/supabase/config";\n' +
      "const configured = SUPABASE_BROWSER_CONFIG !== null;";
    const bypassClient =
      'import { SUPABASE_BROWSER_CONFIG } from "./config.ts";\n' +
      "export const configured = SUPABASE_BROWSER_CONFIG !== null;";
    expect(checksSessionBeforeReveal(bypassPage, null)).toBe(false);
    expect(checksSessionBeforeReveal(bypassPage, bypassClient)).toBe(false);
  });

  it("does NOT pass when neither the page nor a (not-yet-built) client module calls it — NEGATIVE CONTROL", () => {
    expect(
      checksSessionBeforeReveal("<div data-shop-app hidden></div>", null)
    ).toBe(false);
  });
});

describe("topLevelFunctionBodies / functionBodyCallingRpc — helper self-test", () => {
  it("extracts exactly the function whose body calls the named rpc, not a sibling's — POSITIVE CONTROL", () => {
    const source = `
      export async function createShop(name: string) {
        const { data, error } = await client.rpc("create_shop", { p_name: name });
        if (error) return { ok: false, reason: "failed" };
        return { ok: true, value: data };
      }

      export async function readShopRoster(shopId: string) {
        if (shopId.length > 0) {
          const nested = { marker: true };
        }
        const { data, error } = await client.rpc("shop_roster", { p_shop_id: shopId });
        if (error) return { ok: false, reason: "failed" };
        return { ok: true, value: data };
      }
    `;
    const body = functionBodyCallingRpc(source, "shop_roster");
    expect(body).toContain("shop_roster");
    expect(body).not.toContain("create_shop");
    // A nested `if` block's own closing brace must not truncate extraction.
    expect(body).toContain("marker: true");
    expect(body).toContain("ok: false");
  });

  it("returns an empty string when no top-level function calls the named rpc — NEGATIVE CONTROL", () => {
    const source = `export async function createShop() { await client.rpc("create_shop"); }`;
    expect(functionBodyCallingRpc(source, "shop_roster")).toBe("");
  });

  it("does not mistake an inline-union return type's own braces for the function body", () => {
    // `Promise<{ ok: true } | { ok: false }>` is a plausible discriminated-
    // result type, and its first `{` is *not* the function's opening brace —
    // it is nested inside the `Promise<...>` generic. A naive "skip to the
    // first `{`" extractor grabs `{ ok: true; value: unknown[] }` as if it
    // were the whole function, finds no `.rpc(...)` call inside that
    // fragment, and reports "no such function" even though the real function
    // (and its real `.rpc("shop_roster", ...)` call) is right there.
    const source = `
      export async function readShopRoster(
        shopId: string
      ): Promise<{ ok: true; value: unknown[] } | { ok: false; reason: string }> {
        const { data } = await client.rpc("shop_roster", { p_shop_id: shopId });
        return { ok: true, value: (data as unknown[]) ?? [] };
      }
    `;
    const body = functionBodyCallingRpc(source, "shop_roster");
    expect(body, "the real function body was not found").not.toBe("");
    expect(body).toContain("shop_roster");
  });

  it("does not truncate the parameter list at a nested paren inside a parameter's own type", () => {
    // `garage.ts`'s real `currentUserIdIfAny(win: Window, ask: () =>
    // Promise<string | null> = currentUserId)` shape: the second parameter's
    // *type* is itself a parenthesized arrow-function type, so the first `)`
    // encountered after the opening `(` is not the parameter list's own close.
    const source = `
      export async function readShopRoster(
        shopId: string,
        ask: () => Promise<string | null> = currentUserId
      ) {
        const { data, error } = await client.rpc("shop_roster", { p_shop_id: shopId });
        if (error) return { ok: false, reason: "failed" };
        return { ok: true, value: data };
      }
    `;
    const body = functionBodyCallingRpc(source, "shop_roster");
    expect(body, "the real function body was not found").not.toBe("");
    expect(body).toContain("ok: false");
  });
});

/* =========================================================================
 * Shipped-code POSITIVE CONTROLS — prove the probes recognise the correct
 * pattern in real code, so a marked shop grader failing today means
 * "not built", not "the probe never matches anything". These pass today.
 * ====================================================================== */

describe("shipped-code positive controls (the probes are not vacuous)", () => {
  it("directTableWrites finds no write in shares.ts, which reads .from(...) legitimately", () => {
    // `shares.ts` DOES `.from("shares").select(...)` — a read — and routes every
    // mutation through `.rpc(...)`. If the write probe flagged that read, the
    // shop "no direct writes" grader below would be meaningless.
    const shares = readShippedSource(SHARES_CLIENT_PATH);
    expect(shares).toContain('.from("shares")');
    expect(directTableWrites(shares)).toEqual([]);
  });

  it("callsRpc finds shares.ts's real .rpc(...) calls", () => {
    const shares = readShippedSource(SHARES_CLIENT_PATH);
    expect(callsRpc(shares, "create_share_grant")).toBe(true);
    expect(callsRpc(shares, "mechanic_roster")).toBe(true);
    expect(callsRpc(shares, "shop_roster")).toBe(false); // not wired there yet
  });

  it("elementCarriesHiddenAttribute finds the garage page's own data-garage-app hidden tag", () => {
    const garage = readShippedSource(GARAGE_PAGE_PATH);
    expect(elementCarriesHiddenAttribute(garage, "data-garage-app")).toBe(true);
  });

  it("checksSessionBeforeReveal finds shares.ts's real getSession() call", () => {
    const shares = readShippedSource(SHARES_CLIENT_PATH);
    expect(checksSessionBeforeReveal(shares, null)).toBe(true);
  });

  it("checksSessionBeforeReveal finds the session check in garage.ts even though the garage page itself never calls it — the exact delegation shape a correct T3-202c may copy", () => {
    // The garage page does NOT call .getSession()/.onAuthStateChange() itself
    // — it delegates to `currentUserIdIfAny`, whose real session read lives in
    // garage.ts. A page-only scan reports this shipped, correct pattern as
    // "no session check" (a false negative); checking the union of both
    // sources reports it correctly.
    const garagePage = readShippedSource(GARAGE_PAGE_PATH);
    const garageClient = readShippedSource(GARAGE_CLIENT_PATH);
    expect(
      checksSessionBeforeReveal(garagePage, null),
      "the garage page itself was expected to carry no getSession()/" +
        "onAuthStateChange() call — if this now fails, the shipped page " +
        "changed and this positive control needs updating"
    ).toBe(false);
    expect(checksSessionBeforeReveal(garagePage, garageClient)).toBe(true);
  });

  it("functionBodyCallingRpc finds shares.ts's real readMechanicRoster body, and it discriminates its failure", () => {
    // Proves the extractor works against real, non-fixture TS (not just a
    // fixture shaped to fit the regex), and that the shipped `readMechanicRoster`
    // — which reaches its failure via a shared `failed()` helper rather than an
    // inline `{ ok: false }` literal — still reads as discriminated, which is
    // the exact idiom the shop client module is expected to copy.
    const shares = readShippedSource(SHARES_CLIENT_PATH);
    const body = functionBodyCallingRpc(shares, "mechanic_roster");
    expect(
      body,
      'no function body calls .rpc("mechanic_roster", ...)'
    ).not.toBe("");
    expect(body).not.toContain("create_share_grant");
    expect(body).toMatch(
      /if\s*\(\s*error\s*\)[\s\S]{0,80}(?:ok:\s*false|failed\s*\(|refused\s*\()/
    );
  });

  it("the garage page carries the distinct roster states this page must mirror", () => {
    // The garage page's owner-side roster already keeps loading / message /
    // empty / list apart (`data-garage-roster-*`); it is the shipped precedent
    // the shop roster copies, and its presence proves the four-distinct-hooks
    // structural check recognises the correct shipped shape.
    const garage = readShippedSource(GARAGE_PAGE_PATH);
    for (const hook of [
      "data-garage-roster-loading",
      "data-garage-roster-message",
      "data-garage-roster-empty",
      "data-garage-roster",
    ]) {
      expect(garage, hook).toContain(hook);
    }
  });

  it("the garage page is itself account-gated (the gate/app/noscript precedent)", () => {
    const garage = readShippedSource(GARAGE_PAGE_PATH);
    expect(garage).toContain("data-garage-gate");
    expect(garage).toContain("data-garage-app");
    expect(garage).toMatch(/<noscript/);
  });
});

/* =========================================================================
 * 1. The route / segment — registered, bilingual, reserved (SHP-01, I18N)
 *
 * Read through a widened view of the registry so a missing `shops` key is a
 * clean "not registered" assertion, never a `TypeError` on `undefined[locale]`
 * (and so this file type-checks before `shops` is a `CollectionRouteId`).
 * ====================================================================== */

const segments = COLLECTION_ROUTE_SEGMENTS as unknown as Record<
  string,
  Record<Locale, string>
>;
const reserved = RESERVED_HANDLES as readonly string[];

/** Build the {en,es} route paths for a segment record, `/segment/` shape. */
function routePathsFor(segs: Record<Locale, string>): LocalizedRoutePaths {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, `/${segs[locale]}/`])
  ) as LocalizedRoutePaths;
}

describe("the shop route is registered, bilingual, and reserved (SHP-01, I18N-01/04/05)", () => {
  it("POSITIVE CONTROL: an existing collection segment resolves and is symmetric", () => {
    // Proves the registry and the hreflang helper work, so the shop failures
    // below are about the missing `shops` segment, not a broken harness.
    expect(Object.hasOwn(segments, "garage")).toBe(true);
    const routes = routePathsFor(segments.garage);
    const alternates = localizedAlternateLinks(routes);
    expect(alternates.map((l) => l.hreflang).sort()).toEqual(
      ["en", "es", "x-default"].sort()
    );
  });

  it.fails(
    "COLLECTION_ROUTE_SEGMENTS carries a `shops` segment in both locales",
    () => {
      expect(
        Object.hasOwn(segments, "shops"),
        "no `shops` segment registered in COLLECTION_ROUTE_SEGMENTS (routes.ts)"
      ).toBe(true);
      expect(segments.shops.en).toBe(SHOP_ROUTE_SEGMENTS.en);
      expect(segments.shops.es).toBe(SHOP_ROUTE_SEGMENTS.es);
    }
  );

  it.fails(
    "the shop route emits a symmetric hreflang set with x-default",
    () => {
      expect(Object.hasOwn(segments, "shops")).toBe(true);
      const routes = routePathsFor(segments.shops);
      const alternates = localizedAlternateLinks(routes);
      expect(alternates.map((l) => l.hreflang).sort()).toEqual(
        ["en", "es", "x-default"].sort()
      );
      for (const locale of LOCALES) {
        const link = alternates.find((l) => l.hreflang === locale);
        expect(link?.href).toBe(localeHref(locale, routes[locale]));
      }
      const xDefault = alternates.find((l) => l.hreflang === "x-default");
      expect(xDefault?.href).toBe(
        localeHref(DEFAULT_LOCALE, routes[DEFAULT_LOCALE])
      );
    }
  );

  it.fails(
    "both shop segments are reserved handles (no owner may claim them)",
    () => {
      // `handles.ts`' compile-time `SITE_NAMESPACE_IS_RESERVED` will *force* the
      // implementer to reserve them when they register the segment; this pins the
      // requirement from the grader side too. Both, because `/es/{handle}/` and a
      // handle equal to the ES segment collide at the same URL position.
      expect(reserved).toContain(SHOP_ROUTE_SEGMENTS.en);
      expect(reserved).toContain(SHOP_ROUTE_SEGMENTS.es);
    }
  );

  it("POSITIVE CONTROL: the garage segments are already reserved", () => {
    expect(reserved).toContain("garage");
    expect(reserved).toContain("taller");
  });
});

/* =========================================================================
 * 2. The user-facing strings — both locales, via ui.ts (ACC-02, I18N-08)
 * ====================================================================== */

const strings = ui as unknown as Record<Locale, Record<string, unknown>>;

describe("the shop page's strings exist in both locales via ui.ts (ACC-02, I18N-08)", () => {
  it("POSITIVE CONTROL: an existing key is present and non-empty in both locales", () => {
    // Proves the `ui` loader works, so the per-key `.fails` markers below fail
    // because the shop keys are absent, not because reading `ui` is broken.
    for (const locale of LOCALES) {
      const value = strings[locale]["garageHeading"];
      expect(typeof value, `${locale}.garageHeading`).toBe("string");
      expect((value as string).trim()).not.toBe("");
    }
  });
});

// `it.each` cannot be marked `it.fails` per-row, so the required-key existence
// checks live in their own block, one marked test per key, so T3-202c activates
// each string by deleting exactly one `.fails` line — the same one-marker-per-
// activation discipline the rest of the file uses.
describe("required shop ui.ts keys (one activation marker each)", () => {
  for (const key of SHOP_UI_STRING_KEYS) {
    it.fails(`ui.${key} exists in both locales`, () => {
      for (const locale of LOCALES) {
        const value = strings[locale][key];
        expect(typeof value, `${locale}.${key}`).toBe("string");
        expect((value as string).trim(), `${locale}.${key}`).not.toBe("");
      }
    });
  }

  it.fails(
    "no shop string diverges in its numbers between locales (numbers are shared)",
    () => {
      for (const key of SHOP_UI_STRING_KEYS) {
        const en = strings.en[key];
        const es = strings.es[key];
        expect(typeof en, `en.${key}`).toBe("string");
        expect(typeof es, `es.${key}`).toBe("string");
        expect(digitRuns(en as string), `numbers diverge in ${key}`).toEqual(
          digitRuns(es as string)
        );
      }
    }
  );
});

/* =========================================================================
 * 3. The page is account-gated (the shop surface belongs to an account)
 * ====================================================================== */

describe("the shop page is account-gated (SHP-01: an account is what makes a mechanic addressable)", () => {
  it.fails(
    "renders a signed-out gate and hides the app until a session resolves",
    () => {
      const page = SHOP_PAGE();
      expect(
        page,
        `shop page not built yet at ${SHOP_PAGE_SOURCE_PATH}`
      ).not.toBeNull();
      if (page === null) return;
      expect(page).toContain(SHOP_PAGE_HOOKS.gate);
      expect(page).toContain(SHOP_PAGE_HOOKS.app);
      // The app is private by default — hidden in the markup, revealed by script
      // only once a session is confirmed (the garage page's own posture).
      // Anchored to the element's own opening tag (elementCarriesHiddenAttribute),
      // not a bare "hidden somewhere before the next >" scan — the latter is
      // satisfied by `app.hidden = false` in the page's own <script>, which is
      // exactly backwards: it passes when the server-rendered element carries
      // no `hidden` attribute at all (T3-202b code review, fix 1).
      expect(
        elementCarriesHiddenAttribute(page, SHOP_PAGE_HOOKS.app),
        `<... ${SHOP_PAGE_HOOKS.app} ...> does not carry a literal hidden attribute`
      ).toBe(true);
    }
  );

  it.fails(
    "keeps a <noscript> fallback (the data is JS-loaded, like the garage)",
    () => {
      const page = SHOP_PAGE();
      expect(
        page,
        `shop page not built yet at ${SHOP_PAGE_SOURCE_PATH}`
      ).not.toBeNull();
      if (page === null) return;
      expect(page).toMatch(/<noscript/);
    }
  );

  it.fails(
    "reveals the app only after checking the session (not client-trusted markup)",
    () => {
      const page = SHOP_PAGE();
      expect(
        page,
        `shop page not built yet at ${SHOP_PAGE_SOURCE_PATH}`
      ).not.toBeNull();
      if (page === null) return;
      // A session/auth read must exist somewhere in the page's wiring — an
      // *actual call*, not merely importing the browser config, which every
      // RPC-calling page does whether or not it ever checks who is signed in.
      // A bare import was enough to satisfy the old regex — the gate is
      // meaningless if nothing ever calls `getSession()`/`onAuthStateChange()`
      // to decide whether to reveal the app (T3-202b code review, fix 3).
      //
      // The call may live in the page itself, or — the shipped garage
      // precedent (the page delegates to `currentUserIdIfAny` in
      // `garage.ts`, never calling `.getSession()` inline) — in the shop
      // client module. Either satisfies "a session was actually checked
      // before the app was revealed"; only "neither" is the real defect this
      // grader exists to catch (T3-202b code review round 2).
      const client = SHOP_CLIENT();
      expect(
        checksSessionBeforeReveal(page, client),
        "neither the page nor the shop client module ever calls " +
          "getSession()/onAuthStateChange() — importing the browser config " +
          "alone says nothing about whether a session was checked"
      ).toBe(true);
    }
  );
});

/* =========================================================================
 * 4. Create / invite / roster controls (SHP-01, SHP-03)
 * ====================================================================== */

describe("the shop page carries a create control, an email invite control, and a roster (SHP-01, SHP-03)", () => {
  it.fails("has a create-shop control with a shop-name input", () => {
    const page = SHOP_PAGE();
    expect(
      page,
      `shop page not built yet at ${SHOP_PAGE_SOURCE_PATH}`
    ).not.toBeNull();
    if (page === null) return;
    expect(page).toContain(SHOP_PAGE_HOOKS.createControl);
    expect(page).toContain(SHOP_PAGE_HOOKS.nameInput);
  });

  it.fails(
    'has an invite control whose email field is an <input type="email">',
    () => {
      const page = SHOP_PAGE();
      expect(
        page,
        `shop page not built yet at ${SHOP_PAGE_SOURCE_PATH}`
      ).not.toBeNull();
      if (page === null) return;
      expect(page).toContain(SHOP_PAGE_HOOKS.inviteControl);
      expect(page).toContain(SHOP_PAGE_HOOKS.inviteEmailInput);
      // The invite is addressed by email (invite_to_shop's p_invitee_email); the
      // field must declare that type so the browser validates it and the intent is
      // unambiguous in the markup.
      const emailInput = new RegExp(
        `<input[^>]*${SHOP_PAGE_HOOKS.inviteEmailInput}[^>]*>`
      ).exec(page)?.[0];
      expect(
        emailInput,
        `no <input> carries ${SHOP_PAGE_HOOKS.inviteEmailInput}`
      ).toBeDefined();
      expect(emailInput ?? "").toMatch(/type=["']email["']/);
    }
  );

  it.fails("has a roster display", () => {
    const page = SHOP_PAGE();
    expect(
      page,
      `shop page not built yet at ${SHOP_PAGE_SOURCE_PATH}`
    ).not.toBeNull();
    if (page === null) return;
    expect(page).toContain(SHOP_PAGE_HOOKS.roster);
  });

  it.fails(
    "renders the shop strings from ui.ts rather than hardcoding them",
    () => {
      // A proxy for "no hardcoded user-facing text": the page must reference the
      // typed strings for its roster states (the ones most tempting to inline).
      // Full hardcoded-text detection is the code-reviewer's + ui.test.ts's job.
      const page = SHOP_PAGE();
      expect(
        page,
        `shop page not built yet at ${SHOP_PAGE_SOURCE_PATH}`
      ).not.toBeNull();
      if (page === null) return;
      for (const key of [
        "shopHeading",
        "shopRosterUnavailable",
        "shopRosterEmpty",
      ]) {
        expect(page, `page never references strings.${key}`).toContain(key);
      }
    }
  );
});

/* =========================================================================
 * 5. Writes go through the definer RPCs — no direct table write (SHP-01)
 * ====================================================================== */

describe("the shop page wires the real RPCs and writes nothing directly (SHP-01)", () => {
  it.fails(
    "a client module wraps create_shop / invite_to_shop / shop_roster",
    () => {
      const client = SHOP_CLIENT();
      expect(
        client,
        `shop client module not built yet at ${SHOP_CLIENT_MODULE_PATH}`
      ).not.toBeNull();
      if (client === null) return;
      expect(callsRpc(client, SHOP_UI_RPCS.create)).toBe(true);
      expect(callsRpc(client, SHOP_UI_RPCS.invite)).toBe(true);
      expect(callsRpc(client, SHOP_UI_RPCS.roster)).toBe(true);
    }
  );

  it.fails(
    "neither the client module nor the page writes to a shop table directly",
    () => {
      const client = SHOP_CLIENT();
      expect(
        client,
        `shop client module not built yet at ${SHOP_CLIENT_MODULE_PATH}`
      ).not.toBeNull();
      if (client === null) return;
      const page = SHOP_PAGE() ?? "";
      // Every membership write is a `security definer` RPC; the migration grants
      // `authenticated` no direct insert/update/delete on any shop table, so a
      // `.from(table).insert(...)` in the browser is both a dead call and a smell.
      expect(
        directTableWrites(client),
        "direct write in the shop client module"
      ).toEqual([]);
      expect(directTableWrites(page), "direct write in the shop page").toEqual(
        []
      );
    }
  );
});

/* =========================================================================
 * 6. A failed roster read is never an empty roster (AGENTS.md: failure ≠ zero)
 * ====================================================================== */

describe("a failed shop_roster read is not rendered as an empty roster (a failure is not a zero)", () => {
  it.fails(
    "the roster markup keeps loading / failed / empty / list as four distinct states",
    () => {
      const page = SHOP_PAGE();
      expect(
        page,
        `shop page not built yet at ${SHOP_PAGE_SOURCE_PATH}`
      ).not.toBeNull();
      if (page === null) return;
      for (const hook of [
        SHOP_PAGE_HOOKS.rosterLoading,
        SHOP_PAGE_HOOKS.rosterMessage,
        SHOP_PAGE_HOOKS.rosterEmpty,
        SHOP_PAGE_HOOKS.roster,
      ]) {
        expect(page, `roster state hook ${hook} is missing`).toContain(hook);
      }
    }
  );

  it.fails(
    "the page script drives the failed state apart from the empty state",
    () => {
      const page = SHOP_PAGE();
      expect(
        page,
        `shop page not built yet at ${SHOP_PAGE_SOURCE_PATH}`
      ).not.toBeNull();
      if (page === null) return;
      expect(
        distinguishesFailureFromEmpty(page, SHOP_PAGE_HOOKS),
        "the roster script does not keep a failed read distinct from an empty one"
      ).toBe(true);
    }
  );

  it.fails(
    "the client module returns a discriminated failure, never a bare empty list",
    () => {
      const client = SHOP_CLIENT();
      expect(
        client,
        `shop client module not built yet at ${SHOP_CLIENT_MODULE_PATH}`
      ).not.toBeNull();
      if (client === null) return;
      // Scoped to the roster-reading function's *own* body — the one function
      // whose body calls `.rpc(SHOP_UI_RPCS.roster, ...)`, found by behaviour
      // (mirroring how `directTableWrites` scopes to `.from(...)` chains
      // rather than scanning the whole file). A module that handles
      // create_shop/invite_to_shop errors correctly but silently drops a
      // shop_roster failure to `{ ok: true, value: [] }` used to pass this
      // grader because the *other two* functions' `ok: false` satisfied a
      // whole-file scan regardless of what the roster function did
      // (T3-202b code review, fix 2).
      const rosterBody = functionBodyCallingRpc(client, SHOP_UI_RPCS.roster);
      expect(
        rosterBody,
        `no function body calls .rpc("${SHOP_UI_RPCS.roster}", ...)`
      ).not.toBe("");
      // The `shares.ts` shape: a `{ ok: false; reason }` result — or an
      // equivalent failure-helper call, the `readMechanicRoster` idiom this
      // module is expected to copy — and an `if (error)` branch that reaches
      // it, so a dropped request reaches the page as `failed`, not as `[]`
      // (which would read as "this shop holds no trucks").
      expect(
        rosterBody,
        "the roster function has no discriminated `ok: false` result (or " +
          "equivalent failure-helper call) anywhere in its own body"
      ).toMatch(/ok:\s*false|failed\s*\(|refused\s*\(/);
      expect(
        rosterBody,
        "the roster function's `if (error)` branch never reaches a " +
          "discriminated failure"
      ).toMatch(
        /if\s*\(\s*error\s*\)[\s\S]{0,80}(?:ok:\s*false|failed\s*\(|refused\s*\()/
      );
    }
  );
});
