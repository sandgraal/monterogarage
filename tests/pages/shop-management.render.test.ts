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
      expect(page).toMatch(
        new RegExp(`${SHOP_PAGE_HOOKS.app}[^>]*\\bhidden\\b`)
      );
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
      // A session/auth read must exist somewhere in the page's wiring — the gate
      // is meaningless if nothing ever consults `auth.getSession()` / the browser
      // Supabase config to decide whether to reveal the app.
      expect(page).toMatch(
        /getSession|onAuthStateChange|SUPABASE_BROWSER_CONFIG/
      );
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
      // The `shares.ts` shape: a `{ ok: false; reason }` result and an
      // `if (error) return failed()` / `{ ok: false` on the roster read — so a
      // dropped request reaches the page as `failed`, not as `[]` (which would
      // read as "this shop holds no trucks"). Structural, mirroring shares.ts.
      expect(client, "no discriminated `ok: false` result").toMatch(
        /ok:\s*false/
      );
      expect(client, "no failure branch on an error").toMatch(
        /if\s*\(\s*error\s*\)[\s\S]{0,80}(?:ok:\s*false|failed\s*\()/
      );
    }
  );
});
