/**
 * The `[hidden]` guard sweep, in a real browser (T2-303 review, F10).
 *
 * The defect class: an author-origin `display: flex`/`grid` on an element
 * beats the user-agent `[hidden] { display: none }` rule, so an element that
 * carries `hidden` — from its server-rendered markup, or set by a script at
 * runtime — can still compute a visible `display` and render laid out. This
 * shipped four separate times as one-off per-selector patches before this
 * grader existed (the glossary toolbar, the community toolbar,
 * `.garage__gate`, and the T2-303 derived-sheet trio — see the superseded
 * guards' comments in `[garageSegment].astro`), and a fifth review pass
 * (this one) found it again, twice more: five leaking elements on the
 * garage page — including `[data-garage-app]` itself, which meant a
 * signed-out visitor to `/en/garage/` was served the *entire* garage
 * application, laid out beneath the sign-in gate — and one on the sign-in
 * page (`.signin__status`, the "You're signed in as ___" line, visible and
 * empty while signed out).
 *
 * The fix (this same change) is one scoped rule per page —
 * `.garage [hidden] { display: none !important; }` and
 * `.signin [hidden] { display: none !important; }` — that closes the whole
 * class rather than the next instance of it. This file is the grader that
 * keeps that true: for every page below, every element carrying `hidden` in
 * the rendered DOM must compute `display: none`. Not "the ones a person
 * remembered to check" — every one, because that is the actual invariant the
 * fix claims to establish.
 *
 * ## Why the garage and sign-in pages need the *configured* build
 *
 * Same reasoning as `tests/e2e/garage-unreachable.spec.ts` (see that file's
 * header for the full argument, which this note only summarizes):
 * `[garageSegment].astro` and `[authSegment].astro` both branch on
 * `SUPABASE_BROWSER_CONFIG !== null` at build time, and render a single
 * static "accounts are not switched on here" notice — with almost nothing
 * carrying `hidden` — when it is `null`. The markup this task actually fixed
 * (`[data-garage-app]`, `.signin__status`, …) exists only in the configured
 * branch, so testing only the plain build would be green whether or not the
 * fix existed — the same trap `garage-unreachable.spec.ts` was written
 * against. The glossary, community and problems pages do not branch on
 * Supabase configuration and run unconditionally against whichever `dist`
 * this suite is pointed at.
 *
 * ## Mutation check (recorded here, not automated): removing either scoped
 * `[hidden]` rule above must turn every test for that page red, in both
 * locales, against the configured build. That is how this file was verified
 * before it shipped — see the PR/commit this file landed in for the
 * before/after run.
 *
 * refs specs/002-montero-garage, T2-303 review F10
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/** The `dist` directory this run's `webServer` is actually serving. */
const DIST_DIR = path.resolve(REPO_ROOT, process.env["E2E_DIST"] ?? "dist");

/**
 * CI's independent claim that *this run's* build was made with a Supabase
 * project configured — same convention, same reasoning, as
 * `garage-unreachable.spec.ts`: never derived from the markup-sniffing
 * detection below, so a detector that silently stops matching fails loudly
 * here instead of skip-passing forever.
 */
const EXPECT_CONFIGURED = process.env["E2E_EXPECT_CONFIGURED"] === "1";

/**
 * Pages that never branch on Supabase configuration — their `[hidden]`
 * elements are real on any build, so these run unconditionally.
 *
 * **This list is the whole scope of the sweep** (`.claude/GRADER-PRINCIPLES.md`,
 * "a known-pages sweep is only as complete as its list"). Adding a page that
 * lays anything out with `display: flex`/`grid` and hides it with `hidden`
 * means adding it here; nothing scans for the omission.
 *
 * The parts pages are the proof of that: `/en/parts/` and `/es/repuestos/`
 * were missed when T401's problems pages were added the same day, even though
 * `[partsSegment].astro` has both halves of the defect class (a
 * `display: grid` list of `display: flex` cards that the filter script hides
 * with `hidden`, and a `[data-parts-none]` paragraph). They are listed here
 * from the T501 audit follow-up onward.
 *
 * A note for whoever runs this next: the `parts` collection is empty until
 * T503, so `/en/parts/` currently renders its empty state and carries **no**
 * `[hidden]` element at all — these two rows pass vacuously today and start
 * checking something real the moment the first parts entry lands. That is the
 * right time to have added them, not a reason to wait.
 */
const UNCONDITIONAL_PAGES = [
  { locale: "en", path: "/en/glossary/" },
  { locale: "es", path: "/es/glosario/" },
  { locale: "en", path: "/en/community/" },
  { locale: "es", path: "/es/comunidad/" },
  { locale: "en", path: "/en/problems/" },
  { locale: "es", path: "/es/problemas/" },
  { locale: "en", path: "/en/parts/" },
  { locale: "es", path: "/es/repuestos/" },
  // T601 — the mods index carries a `[hidden]` element (`data-mods-none`) and
  // lays its toolbar out with `display: flex`, exactly like the parts index.
  { locale: "en", path: "/en/mods/" },
  { locale: "es", path: "/es/modificaciones/" },
  // T502 — the procedures index has both halves of the defect class again: a
  // `display: grid` list of `display: flex` cards the filter script hides with
  // `hidden`, and a `[data-procedures-none]` paragraph. Listed on the same
  // reasoning the parts note above records — the collection is empty until
  // T504, so these two rows pass vacuously today and start checking something
  // real the moment the first procedure lands. That is the right time to have
  // added them, not a reason to wait.
  { locale: "en", path: "/en/procedures/" },
  { locale: "es", path: "/es/procedimientos/" },
  // T702 — the site-wide search page carries a `[hidden]` element
  // (`data-search-none`) and lays its toolbar out with `display: flex`,
  // exactly like every other filtered listing above.
  { locale: "en", path: "/en/search/" },
  { locale: "es", path: "/es/buscar/" },
] as const;

/**
 * Pages that render their real, `[hidden]`-carrying app markup only when
 * `SUPABASE_BROWSER_CONFIG !== null` at build time — each paired with the
 * one attribute that exists only inside that page's `configured` branch,
 * matched at attribute boundaries (not a bare substring — see
 * `garage-unreachable.spec.ts` for why `.includes()` is not safe here: it
 * would also match a renamed `data-garage-gate-open` or `data-garage-gate2`).
 */
const CONFIGURED_ONLY_PAGES = [
  {
    locale: "en",
    path: "/en/garage/",
    marker: /(?<![\w-])data-garage-gate(?![\w-])/,
  },
  {
    locale: "es",
    path: "/es/taller/",
    marker: /(?<![\w-])data-garage-gate(?![\w-])/,
  },
  {
    locale: "en",
    path: "/en/sign-in/",
    marker: /(?<![\w-])data-signin-signed-in(?![\w-])/,
  },
  {
    locale: "es",
    path: "/es/ingresar/",
    marker: /(?<![\w-])data-signin-signed-in(?![\w-])/,
  },
] as const;

/** `servedPath`'s built HTML, or `null` if this run's `dist` has no such file. */
function readBuiltHtml(distDir: string, servedPath: string): string | null {
  const file = path.join(distDir, servedPath.replace(/^\//, ""), "index.html");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

/**
 * `true` when `servedPath`'s built HTML rendered the configured branch
 * (`marker` found) rather than the "accounts are not switched on here"
 * notice. Reads the page's actual output, the same reasoning as
 * `garage-unreachable.spec.ts`'s `pageWasBuiltConfigured`.
 */
function pageWasBuiltConfigured(
  distDir: string,
  servedPath: string,
  marker: RegExp
): boolean {
  const html = readBuiltHtml(distDir, servedPath);
  return html !== null && marker.test(html);
}

/**
 * Loud, at module load, before a single test runs: if CI declared this run's
 * build configured but *every* configured-only page disagrees, that is not
 * "this happens to be the plain build" (CI would not have set the env var) —
 * it is one of the two markers having drifted from what the build actually
 * contains. Same reasoning as `garage-unreachable.spec.ts`'s identical check
 * (T2-301 review F1): a detection string that quietly stops detecting must
 * break CI, not report a row of green skips.
 */
if (EXPECT_CONFIGURED) {
  const anyConfigured = CONFIGURED_ONLY_PAGES.some(
    ({ path: pagePath, marker }) =>
      pageWasBuiltConfigured(DIST_DIR, pagePath, marker)
  );
  if (!anyConfigured) {
    throw new Error(
      "hidden-guard — E2E_EXPECT_CONFIGURED=1 (this run's build is " +
        "supposed to have a Supabase project configured) but no page under " +
        `${DIST_DIR} matched its configured marker (data-garage-gate or ` +
        "data-signin-signed-in). Either [garageSegment].astro or " +
        "[authSegment].astro no longer render that attribute when " +
        "configured (update CONFIGURED_ONLY_PAGES to match), or this build " +
        "genuinely was not made with PUBLIC_SUPABASE_URL/" +
        "PUBLIC_SUPABASE_ANON_KEY set. Failing the whole file rather than " +
        "skipping every test: a stale detection string here must break CI, " +
        "not silently stop catching the F10 hidden-guard regression this " +
        "suite exists for."
    );
  }
}

/**
 * Every element in `page`'s rendered DOM that carries `hidden` and computes
 * a `display` other than `none` — the invariant this whole file checks for.
 * Empty means no leaks. Each entry is a human-readable label built from the
 * element's tag, class and `data-*` attributes, for a failure message that
 * names the element without needing a screenshot.
 */
async function hiddenLeaks(
  page: Page
): Promise<Array<{ label: string; display: string }>> {
  return page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("[hidden]"));
    return elements
      .map((el) => {
        const display = getComputedStyle(el).display;
        const dataAttrs = Array.from(el.attributes)
          .filter((attr) => attr.name.startsWith("data-"))
          .map((attr) => attr.name)
          .join(" ");
        const className = el.getAttribute("class") ?? "";
        return {
          label: `<${el.tagName.toLowerCase()} class="${className}" ${dataAttrs}>`,
          display,
        };
      })
      .filter((entry) => entry.display !== "none");
  });
}

for (const { locale, path: pagePath } of UNCONDITIONAL_PAGES) {
  test(`${locale} ${pagePath} — every [hidden] element computes display:none`, async ({
    page,
  }) => {
    await page.goto(pagePath);
    const leaks = await hiddenLeaks(page);
    expect(leaks, JSON.stringify(leaks, null, 2)).toEqual([]);
  });
}

for (const { locale, path: pagePath, marker } of CONFIGURED_ONLY_PAGES) {
  test.describe(`${locale} ${pagePath} (configured)`, () => {
    test.beforeEach(async () => {
      const configured = pageWasBuiltConfigured(DIST_DIR, pagePath, marker);
      if (!configured) {
        if (EXPECT_CONFIGURED) {
          // Same reasoning as the module-level check above, for the case
          // where only this one page lost its marker while another kept it
          // (so the module-level "at least one" check passed).
          throw new Error(
            `hidden-guard — E2E_EXPECT_CONFIGURED=1 but ${pagePath} does ` +
              `not match its configured marker (${marker}) — failing ` +
              "loudly instead of skipping (F1's reasoning: a silent skip " +
              "here is exactly how this spec's regression coverage would " +
              "go dark)."
          );
        }
        test.skip(
          true,
          `${DIST_DIR}${pagePath} was not built with a configured Supabase ` +
            "project (no PUBLIC_SUPABASE_URL/PUBLIC_SUPABASE_ANON_KEY at " +
            "build time), so this page's real app markup never renders and " +
            "there is nothing here for the hidden-guard sweep to check. Run " +
            "against a configured build (E2E_DIST=dist-configured " +
            "E2E_EXPECT_CONFIGURED=1; see ci.yml) to exercise this for real."
        );
      }
    });

    test(`every [hidden] element computes display:none`, async ({ page }) => {
      await page.goto(pagePath);
      const leaks = await hiddenLeaks(page);
      expect(leaks, JSON.stringify(leaks, null, 2)).toEqual([]);
    });
  });
}
