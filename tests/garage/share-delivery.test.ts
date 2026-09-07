/**
 * Graders — **how the token travels.** Declared by T2-401 [TEST], activated by
 * T2-404 [PLATFORM].
 *
 * A share token is a bearer credential (SHR-05). Everything in
 * `share-grants.test.ts` is about what it buys once presented; this file is
 * about the far duller question of where it is written down on the way, which
 * is where credentials are actually lost.
 *
 * The list of places a URL is recorded is longer than it looks: the Vercel edge
 * log, the Supabase request log, the browser's history and its sync, the
 * `Referer` header on every outbound link and every third-party asset, a proxy,
 * a screenshot, a support ticket. **A fragment reaches none of them** — it is
 * not sent to the origin at all — which is why T2-404's architecture record put
 * the token there and why these graders exist to keep it there.
 *
 * Four claims, each failing on its own:
 *
 * 1. **No route takes a token as a path segment or a search parameter.** Graded
 *    as a sweep over `src/pages/`, not over a list of known share routes — the
 *    dangerous file is the one nobody thought to add to a list.
 * 2. **The client POSTs it.** PostgREST accepts RPC over `GET` too, and a
 *    `GET …/rpc/share_read_records?p_token=…` puts the credential straight back
 *    into the log the fragment kept it out of.
 * 3. **`Referrer-Policy: no-referrer` on the share page.** The fragment is not
 *    in a `Referer`, but the *path* is, and the path names a page that exists
 *    only because somebody was granted access. `vercel.json` carries no
 *    `headers` block today: this is a file edit, not a dashboard setting.
 * 4. **The page is not indexable** (003 MEC-04). A bearer-token page has no
 *    place in a search index, a sitemap, or the hreflang graph of 001 I18N-04.
 *
 * ## The sweep is semantics-shaped, and its vacuity is pinned
 *
 * `src/pages/` has no share route today, so claim 1 is vacuous — and a vacuous
 * sweep reports exactly the same green as a correct one. So the sweep asserts
 * it actually read files, and the count is checked against a floor. The same
 * discipline `sharing-default.test.ts` needed when its negative sweep turned
 * out to be matching a naming convention rather than a property.
 *
 * refs specs/002-montero-garage (SHR-05, SHR-07, SHR-08), 003 (MEC-04)
 */
import { getTransformedRoutes } from "@vercel/routing-utils";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCALES, localeHref, type Locale } from "../../src/i18n/routing.ts";
import {
  SHARE_TOKEN_FRAGMENT_KEY,
  shareLinkFor,
  shareTokenFromUrl,
} from "../../src/lib/garage/share-link.ts";
import { SHARE_ROUTE_SEGMENTS } from "../../src/lib/garage/share-route.ts";
import { handleRoutePath } from "../../src/lib/garage/handles.ts";
import {
  SHOWCASE_PLACEHOLDER_HANDLE,
  SHOWCASE_PLACEHOLDER_VEHICLE,
  showcaseRoutePath,
  worklogRoutePath,
} from "../../src/lib/garage/showcase-view.ts";

/** Repo root, resolved from this file so the sweeps are cwd-independent. */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const PAGES_DIR = join(REPO_ROOT, "src", "pages");
const SRC_DIR = join(REPO_ROOT, "src");
const VERCEL_CONFIG = join(REPO_ROOT, "vercel.json");

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Every `src/` file that could carry a client request, with its text. */
function clientSources(): { path: string; text: string }[] {
  return filesUnder(SRC_DIR)
    .filter((path) => /\.(ts|astro|mts)$/.test(path))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

/**
 * Words that name a bearer secret in a route parameter.
 *
 * Matched against the *parameter name* rather than the file name, so
 * `src/pages/[locale]/[shareSegment].astro` — a per-locale slug for the share
 * page, which is correct and expected — is not a finding, while
 * `src/pages/[locale]/s/[token].astro` is.
 */
const SECRET_PARAM = /^\[\.{0,3}(token|share|grant|secret|key|t)\]$/i;

/* =========================================================================
 * Claim 1 — no route takes a token. **Unmarked.**
 * ====================================================================== */

describe("no route under src/pages takes a token as a path segment", () => {
  const pages = filesUnder(PAGES_DIR);

  it("the sweep read the pages directory — it is not vacuous", () => {
    // A sweep over an empty list reports the same green as a sweep over a clean
    // one. Without this, a broken path or a renamed directory would silently
    // delete claim 1 and nothing would say so.
    expect(pages.length).toBeGreaterThanOrEqual(8);
    expect(pages.some((path) => path.endsWith("index.astro"))).toBe(true);
  });

  it("no dynamic segment is named for a secret", () => {
    // Sweeps the segments that exist rather than checking a list of known
    // share routes: the dangerous file is the one nobody added to the list.
    // A token in a path segment is in the request line, so it is in every
    // access log between the browser and the origin — and it cannot be
    // prerendered, so it would force SSR (001 SCF-01) for no benefit.
    const offenders = pages.filter((path) =>
      path
        .slice(PAGES_DIR.length + 1)
        .split(/[\\/]/)
        .some((segment) => SECRET_PARAM.test(segment.replace(/\.astro$/, "")))
    );

    expect(offenders).toEqual([]);
  });

  it("nothing in src/ reads a token out of the query string", () => {
    // The other half of the same mistake. A page that accepts
    // `?token=…` puts the credential in the request line even though the route
    // is static, and `Referrer-Policy` does not help: the query string is part
    // of the URL the *server* logs, not just of what it sends onward.
    const offenders = clientSources()
      .filter(({ text }) =>
        /searchParams\.get\(\s*["'`](?:token|t|share|grant)["'`]|Astro\.url\.search\b/.test(
          text
        )
      )
      .map(({ path }) => path.slice(REPO_ROOT.length));

    expect(offenders).toEqual([]);
  });

  it("nothing in src/ puts a token into a GET query string", () => {
    // PostgREST accepts RPC over `GET` as well as `POST`, so this is a real
    // choice somebody can make wrongly — and the wrong one is the shorter line.
    const offenders = clientSources()
      .filter(({ text }) => /rpc\/[a-z_]*share[a-z_]*\?/.test(text))
      .map(({ path }) => path.slice(REPO_ROOT.length));

    expect(offenders).toEqual([]);
  });

  it("the source sweep read real files — it is not vacuous either", () => {
    const sources = clientSources();

    expect(sources.length).toBeGreaterThanOrEqual(20);
    expect(sources.some(({ text }) => text.includes("Astro"))).toBe(true);
  });
});

/* =========================================================================
 * Claims 2–4 — marked. The surface T2-404 ships.
 * ====================================================================== */

describe("the token lives in the fragment (SHR-05)", () => {
  const ORIGIN = "https://monterogarage.com";
  const TOKEN = "TEST-T2-401-SHARE-TOKEN-A";

  it("shareLinkFor puts the token after the hash and nowhere else", () => {
    const link = shareLinkFor({ origin: ORIGIN, locale: "es", token: TOKEN });
    const url = new URL(link);

    expect(url.hash).toContain(TOKEN);
    expect(url.pathname).not.toContain(TOKEN);
    expect(url.search).toBe("");
  });

  it("the fragment uses the agreed key, so writer and reader agree", () => {
    const link = shareLinkFor({ origin: ORIGIN, locale: "en", token: TOKEN });

    expect(new URL(link).hash).toContain(`${SHARE_TOKEN_FRAGMENT_KEY}=`);
  });

  it("shareTokenFromUrl round-trips its own link", () => {
    const link = shareLinkFor({ origin: ORIGIN, locale: "en", token: TOKEN });

    expect(shareTokenFromUrl(link)).toBe(TOKEN);
  });

  it("a token in the QUERY STRING is not honoured", () => {
    // Deliberately not lenient. If a query-string token also worked, a link
    // that had already leaked into a log would keep working, and nobody would
    // find out until the log did. It fails loudly instead, where somebody sees
    // it.
    expect(
      shareTokenFromUrl(`${ORIGIN}/es/compartir/?token=${TOKEN}`)
    ).toBeNull();
  });

  it("a URL with no token reads as null, never as an empty string", () => {
    // AGENTS.md: a failure is not a zero. `""` would be sent to the database as
    // a token and compared against a hash, which is a query nobody meant to
    // run.
    expect(shareTokenFromUrl(`${ORIGIN}/es/compartir/`)).toBeNull();
  });

  it("a URL that is not a URL reads as null, not as a throw", () => {
    // **The seam control that used to live here went with the seam** — the
    // same move `public-pages.test.ts` records for T2-402. It asserted that
    // `shareLinkFor` and `shareTokenFromUrl` still threw `NOT_IMPLEMENTED`,
    // which is exactly the grader that must fail once the thing is built;
    // leaving it would make a green suite impossible rather than meaningful.
    //
    // What replaces it is the control the markers above actually still need: a
    // reader handed something that is not a URL at all. Without it, "a token in
    // the query string is not honoured" and "a URL with no token reads as
    // null" are both satisfied by a parser that throws on everything, and the
    // callers — a page reading `window.location.href` on first paint — would
    // get an exception where they were promised a `null`.
    expect(shareTokenFromUrl("not a url at all")).toBeNull();
    expect(shareTokenFromUrl("")).toBeNull();
  });
});

describe("the share page sends no referrer (SHR-05)", () => {
  const config = (): Record<string, unknown> =>
    JSON.parse(readFileSync(VERCEL_CONFIG, "utf8")) as Record<string, unknown>;

  it("vercel.json is valid JSON with the framework this repo deploys", () => {
    // Unmarked: the control for the two markers below. Without it, "there is no
    // headers block" would be equally satisfied by a file that failed to parse.
    expect(config().framework).toBe("astro");
  });

  it("declares a headers block at all", () => {
    expect(Array.isArray(config().headers)).toBe(true);
  });

  it("sends `Referrer-Policy: no-referrer` on the share route", () => {
    // The fragment never reaches a server, but the *path* does, and it is in
    // the `Referer` of every outbound link and every third-party request the
    // page makes. The page's own existence is the thing worth not leaking: it
    // says somebody was granted access to a specific truck.
    interface HeaderRule {
      readonly source?: string;
      readonly headers?: readonly { key?: string; value?: string }[];
    }
    const rules = (config().headers ?? []) as readonly HeaderRule[];
    const matching = rules.filter((rule) =>
      (rule.headers ?? []).some(
        (header) =>
          header.key?.toLowerCase() === "referrer-policy" &&
          header.value === "no-referrer"
      )
    );

    expect(matching.length).toBeGreaterThan(0);
    expect(matching.map((rule) => rule.source ?? "").join(" ")).toMatch(
      /compartir|share|\/s\//
    );
  });

  it("the `source` pattern actually matches the share route, not just its name (T2-404 review, F11)", () => {
    // The test above only checks that `source` *mentions* "share" or
    // "compartir" somewhere in the string — which the original, broken
    // pattern also did. `/(en|es)/(share|compartir)/:path*` read like a match
    // for this route and was not one: `:path*`'s optional trailing group
    // cannot also absorb the bare trailing slash `trailingSlash: true`
    // guarantees on every route, so it never matched `/en/share/` or
    // `/es/compartir/` themselves — the page's *only* request path, since the
    // token lives in the URL fragment and the page is never requested with a
    // further path segment (`[shareSegment].astro`'s own doc comment). A
    // string-shaped assertion cannot catch that; compiling the rule with
    // `@vercel/routing-utils` — the library Vercel's own build uses to turn
    // `vercel.json` into routes — can.
    interface HeaderRule {
      readonly source?: string;
      readonly headers?: readonly { key?: string; value?: string }[];
    }
    const rules = (config().headers ?? []) as readonly HeaderRule[];
    const shareRule = rules.find((rule) =>
      (rule.headers ?? []).some(
        (header) => header.key?.toLowerCase() === "referrer-policy"
      )
    );
    expect(shareRule?.source).toBeTruthy();

    const compiled = getTransformedRoutes({
      headers: [
        { source: shareRule!.source!, headers: [{ key: "x", value: "1" }] },
      ],
    });
    expect(compiled.error).toBeNull();
    const compiledSource = compiled.routes?.[0]?.src;
    expect(typeof compiledSource).toBe("string");
    const re = new RegExp(compiledSource as string);

    for (const locale of LOCALES) {
      const segment = SHARE_ROUTE_SEGMENTS[locale];
      // Both forms the page is actually requested at: bare, and with the
      // trailing slash `trailingSlash: true` always adds.
      expect(re.test(`/${locale}/${segment}`)).toBe(true);
      expect(re.test(`/${locale}/${segment}/`)).toBe(true);
    }

    // Near misses a looser (or a future, sloppier) pattern could start
    // matching, or a stricter one could stop matching.
    expect(re.test("/fr/share/")).toBe(false);
    expect(re.test("/en/garage/")).toBe(false);
    expect(re.test("/en/sharex/")).toBe(false);
  });
});

describe("the share page is not indexable (003 MEC-04)", () => {
  /** Every page source that looks like the accountless share view. */
  const sharePages = (): { path: string; text: string }[] =>
    filesUnder(PAGES_DIR)
      .filter((path) => /share|compartir/i.test(path))
      .map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it("a share page exists, at a per-locale slug", () => {
    // I18N-01: neither locale is privileged, and the share page is a
    // user-facing surface like any other. Marked because the page is T2-404's.
    expect(sharePages().length).toBeGreaterThan(0);
  });

  it("every share page declares `noindex`", () => {
    // "A bearer-token page has no place in a search index" — 003 MEC-04. The
    // page is reachable by anyone holding the URL, which is the whole point,
    // and a crawler that finds one holds it too.
    const pages = sharePages();

    expect(pages.length).toBeGreaterThan(0);
    for (const { path, text } of pages) {
      expect(text, path).toMatch(/noindex/);
    }
  });
});

/* =========================================================================
 * The showcase / work-log rewrites resolve the URLs those pages emit —
 * T2-404b review, F2. **Authored by the T2-404b pages-fix implementer**, not a
 * T2-404 grader: it is a static-config↔URL correspondence check, not a re-grade
 * of the render logic `tests/pages/showcase-worklog.render.test.ts` owns.
 *
 * The public showcase/work-log pages are built once per locale at a placeholder
 * and reached in production through the four `vercel.json` rewrites for
 * `/{garage}/:handle/:vehicleId/` and its `/{log|historial}/` child (see the
 * page templates' doc comments and `showcase-view.ts`'s module note, point 4).
 * That rewrite is the **one surface `npm run verify` cannot exercise** — no
 * render grader, and no build, ever routes a request through `vercel.json`.
 *
 * The specific way it can be silently wrong: this repo sets `trailingSlash:
 * true`, so every URL these pages emit as canonical/hreflang/switcher links
 * ends in `/`, and the trailing-slash 308 redirect normalises every request to
 * that slashed form *before* the rewrite phase runs. A `source` written without
 * the slash compiles (via `@vercel/routing-utils`, the library Vercel's own
 * build uses) to a `src` anchored `…$` right after the vehicle id — which never
 * matches the slashed request path, so the live page 404s while every grader in
 * this repo stays green. This block compiles each rewrite in that same trailing-
 * slash regime and asserts its `source` matches the URL the route *builders*
 * emit and its `destination` is the placeholder those builders resolve — the
 * same shape the F11 case above pins for the share page's own header rule.
 * ====================================================================== */

describe("vercel.json's showcase/work-log rewrites resolve the URLs those pages emit (T2-404b review, F2)", () => {
  interface Rewrite {
    readonly source?: string;
    readonly destination?: string;
  }
  const config = (): {
    trailingSlash?: boolean;
    rewrites?: readonly Rewrite[];
  } =>
    JSON.parse(readFileSync(VERCEL_CONFIG, "utf8")) as {
      trailingSlash?: boolean;
      rewrites?: readonly Rewrite[];
    };

  // Concrete but obviously-synthetic inputs: a handle in the normalised shape
  // `handles.ts` produces, and a vehicle id in the 36-char UUID shape the
  // rewrite constrains `:vehicleId` to. The correspondence is checked against
  // the URL the route BUILDERS emit for these — not a hand-copied string — so a
  // change to the route shape the rewrites did not follow fails here.
  const HANDLE = "test-t2-404b-taller";
  const VEHICLE_ID = "3f7c2b1a-0e4d-4a9b-8c2f-1d2e3a4b5c6d";

  /**
   * Compile one rewrite's `source` exactly as this repo's Vercel build would —
   * `trailingSlash` included — and hand back a matcher for its request path.
   * The rewrite route is the single compiled route carrying a `dest` and no
   * redirect `status` or phase `handle` (the redirects `trailingSlash: true`
   * emits carry a `status`; the filesystem phase carries a `handle`).
   */
  function matcherFor(rewrite: Rewrite): RegExp {
    const compiled = getTransformedRoutes({
      trailingSlash: config().trailingSlash,
      rewrites: [
        { source: rewrite.source!, destination: rewrite.destination! },
      ],
    });
    expect(compiled.error, rewrite.source).toBeNull();
    const route = (compiled.routes ?? []).find((entry) => {
      const candidate = entry as {
        src?: unknown;
        dest?: unknown;
        status?: unknown;
        handle?: unknown;
      };
      return (
        typeof candidate.src === "string" &&
        typeof candidate.dest === "string" &&
        candidate.status === undefined &&
        candidate.handle === undefined
      );
    });
    expect(route, rewrite.source).toBeTruthy();
    return new RegExp((route as { src: string }).src);
  }

  /**
   * The two published surfaces, one entry per (page, locale): the URL the page
   * emits, the placeholder it is built at (both from the same route builders
   * `getStaticPaths` and `BaseLayout` use), and the near-miss neighbours a
   * rewrite must not swallow.
   */
  const emitted = LOCALES.flatMap((locale: Locale) => [
    {
      label: `showcase ${locale}`,
      realUrl: localeHref(
        locale,
        showcaseRoutePath(HANDLE, VEHICLE_ID, locale)
      ),
      placeholderDest: localeHref(
        locale,
        showcaseRoutePath(
          SHOWCASE_PLACEHOLDER_HANDLE,
          SHOWCASE_PLACEHOLDER_VEHICLE,
          locale
        )
      ),
      handleIndex: localeHref(locale, handleRoutePath(HANDLE, locale)),
      // One level deeper than the showcase URL is the work-log page, a
      // different rewrite — the showcase rule must not claim it.
      deeper: localeHref(locale, worklogRoutePath(HANDLE, VEHICLE_ID, locale)),
    },
    {
      label: `worklog ${locale}`,
      realUrl: localeHref(locale, worklogRoutePath(HANDLE, VEHICLE_ID, locale)),
      placeholderDest: localeHref(
        locale,
        worklogRoutePath(
          SHOWCASE_PLACEHOLDER_HANDLE,
          SHOWCASE_PLACEHOLDER_VEHICLE,
          locale
        )
      ),
      handleIndex: localeHref(locale, handleRoutePath(HANDLE, locale)),
      deeper: localeHref(
        locale,
        `${worklogRoutePath(HANDLE, VEHICLE_ID, locale)}extra/`
      ),
    },
  ]);

  it("the config compiles, in the trailing-slash regime these pages assume", () => {
    // The premise the whole finding rests on: every URL these pages emit ends
    // in `/`, so a rewrite whose `source` lacked the slash would 404 the live
    // page. Pin both halves so a future flip of either is caught right here
    // rather than in production.
    const current = config();
    expect(current.trailingSlash).toBe(true);
    expect(Array.isArray(current.rewrites)).toBe(true);
    for (const page of emitted) {
      expect(page.realUrl.endsWith("/"), page.label).toBe(true);
    }
  });

  it.each(emitted)(
    "$label: exactly one rewrite matches the emitted URL and targets its built placeholder",
    ({ realUrl, placeholderDest }) => {
      const rewrites = config().rewrites ?? [];
      const matches = rewrites.filter((rewrite) =>
        matcherFor(rewrite).test(realUrl)
      );
      // Exactly one — not zero (the F2 404), not two (an ambiguous shadow).
      expect(matches).toHaveLength(1);
      // …and it rewrites to the placeholder the page is actually BUILT at,
      // derived from the same route builders `getStaticPaths` uses, not a copy.
      expect(matches[0]!.destination).toBe(placeholderDest);
    }
  );

  it.each(emitted)(
    "$label: the rewrite does not shadow the handle index, a non-UUID segment, the bare pre-redirect path, or a deeper route",
    ({ realUrl, handleIndex, deeper }) => {
      const rewrites = config().rewrites ?? [];
      const matching = rewrites.find((rewrite) =>
        matcherFor(rewrite).test(realUrl)
      );
      expect(matching).toBeDefined();
      const re = matcherFor(matching!);

      // One segment up: the handle's own index page (`handles.ts`) keeps it.
      expect(re.test(handleIndex)).toBe(false);
      // The UUID constraint on `:vehicleId`: a non-UUID second segment is a
      // different route (a future `…/settings/`, say), never a vehicle.
      expect(re.test(realUrl.replace(VEHICLE_ID, "not-a-uuid"))).toBe(false);
      // The bare form is handled by the `trailingSlash` 308 first; the rewrite
      // itself must match only the slashed form that redirect produces.
      expect(re.test(realUrl.replace(/\/$/, ""))).toBe(false);
      // A route one level deeper than this one is a different page.
      expect(re.test(deeper)).toBe(false);
    }
  );

  it("every rewrite corresponds to exactly one emitted page URL — no orphan rule", () => {
    // The reverse direction: not only is every emitted URL matched, every
    // rewrite in the file is claimed by exactly one emitted URL — so a stray or
    // duplicated rule (a copy-paste that matches nothing, or matches two pages)
    // is a finding rather than dead config nobody reads.
    const rewrites = config().rewrites ?? [];
    expect(rewrites.length).toBe(emitted.length);
    for (const rewrite of rewrites) {
      const re = matcherFor(rewrite);
      const claimed = emitted.filter((page) => re.test(page.realUrl));
      expect(claimed.map((page) => page.label)).toHaveLength(1);
    }
  });
});
