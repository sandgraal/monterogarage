// @ts-check
import { defineConfig } from "astro/config";

/**
 * FIT-02 on the build path: every entry's fitment is resolved against the
 * vehicle taxonomy before a single page is rendered, so a nonexistent id or an
 * impossible combination is a red build rather than a page nobody can reach.
 *
 * The check itself is `src/lib/fitment/` (FIT-01 — the only code that
 * interprets fitment queries); this is only the wiring.
 *
 * Two details here are load-bearing and neither is stylistic:
 *
 * 1. **The import is lazy.** `scripts/check-hreflang.mjs` and
 *    `scripts/lib/audit-targets.mjs` `import()` this config under bare Node,
 *    with no bundler, to read `site`, `base` and `i18n.locales`. A top-level
 *    import of the resolver would make every one of those scripts pay for —
 *    and depend on — the whole schema graph. Inside a hook that only ever runs
 *    during a real build, they never touch it.
 * 2. **The specifier carries its `.ts` extension**, and so do the imports
 *    along `src/integrations/validate-fitments.ts` → `src/lib/fitment/` →
 *    `src/schemas/`. Astro resolves a hook's dynamic import through Node's own
 *    ESM resolver rather than through Vite's plugin container, and Node does
 *    not guess extensions. With them, Node 24 type-strips the chain and the
 *    same modules load identically under Vite, under Vitest and under bare
 *    `node` — the portability `scripts/lib/content-entries.mjs` had to
 *    duplicate a whole module to work around.
 *
 * @type {import("astro").AstroIntegration}
 */
const validateFitments = {
  name: "montero:validate-fitments",
  hooks: {
    "astro:build:start": async (context) => {
      const { runFitmentBuildCheck } =
        await import("./src/integrations/validate-fitments.ts");
      await runFitmentBuildCheck(context);
    },
  },
};

/**
 * PRT-02 / PRT-03 on the build path: two parts entries may not claim one OEM
 * number, every `supersededBy` pointer resolves and terminates, and every
 * vendor names a real seller — checked before a single page is rendered, so a
 * reader never gets two answers for one part number.
 *
 * The check itself is `src/lib/parts/` (unit-tested); this is only the wiring,
 * and it repeats `validateFitments`' two load-bearing details verbatim — the
 * lazy import and the `.ts` specifiers — for the reasons given above.
 *
 * @type {import("astro").AstroIntegration}
 */
const validateParts = {
  name: "montero:validate-parts",
  hooks: {
    "astro:build:start": async (context) => {
      const { runPartsBuildCheck } =
        await import("./src/integrations/validate-parts.ts");
      await runPartsBuildCheck(context);
    },
  },
};

/**
 * MOD-02 on the build path: every typed `requires` / `affects[].ref` reference
 * resolves to a real entry **in the collection it names**, no requirement loop
 * survives, and every mods entry has a slug row — checked before a single page
 * is rendered, so a reader never follows a prerequisite link to nothing.
 *
 * The check itself is `src/lib/mods/` (unit-tested); this is only the wiring,
 * and it repeats `validateFitments`' two load-bearing details verbatim — the
 * lazy import and the `.ts` specifiers — for the reasons given above.
 *
 * @type {import("astro").AstroIntegration}
 */
const validateMods = {
  name: "montero:validate-mods",
  hooks: {
    "astro:build:start": async (context) => {
      const { runModsBuildCheck } =
        await import("./src/integrations/validate-mods.ts");
      await runModsBuildCheck(context);
    },
  },
};

/**
 * PRC-01 / PRC-03 on the build path: every `specs[]` id resolves to a
 * `reference` row that actually carries a figure, every consumed part names a
 * `parts` entry, every prerequisite that names a job names a real one and no
 * prerequisite loop survives — checked before a single page is rendered, so a
 * reader never meets a torque figure the site failed to look up.
 *
 * The check itself is `src/lib/procedures/` (unit-tested); this is only the
 * wiring, and it repeats `validateFitments`' two load-bearing details verbatim
 * — the lazy import and the `.ts` specifiers — for the reasons given above.
 *
 * @type {import("astro").AstroIntegration}
 */
const validateProcedures = {
  name: "montero:validate-procedures",
  hooks: {
    "astro:build:start": async (context) => {
      const { runProceduresBuildCheck } =
        await import("./src/integrations/validate-procedures.ts");
      await runProceduresBuildCheck(context);
    },
  },
};

/**
 * Single source of truth for where this site is deployed.
 *
 * T2-102 finished MIG-01/MIG-02: hosting is Vercel, the site is served from
 * the apex of monterogarage.com, so there is no deploy path any more and
 * `base` is `/`. The GitHub Pages era (`https://sandgraal.github.io` +
 * `base: "/monterogarage"`, a Pages *project site* served under `/<RepoName>/`)
 * ended with it, and so did CI's "base must equal /<RepoName>" assertion —
 * that was a GitHub-Pages-project-site rule and nothing else.
 *
 * `site` names the production origin, not whichever origin a given build is
 * served from. Vercel preview deployments therefore emit canonical/hreflang
 * URLs on monterogarage.com rather than on the preview's own `*.vercel.app`
 * host — which is what you want: a preview must never invite a crawler to
 * index it, and previews are `noindex` on Vercel regardless.
 *
 * Both values are changed here and nowhere else: every internal link,
 * canonical URL and hreflang href is derived from them through
 * `src/i18n/routing.ts` (`import.meta.env.BASE_URL`) and `Astro.site`.
 */
export default defineConfig({
  site: "https://monterogarage.com",
  base: "/",

  // Static output (SCF-01).
  output: "static",

  // FIT-02, PRT-02/PRT-03, MOD-02, PRC-01/PRC-03 — see the integrations above.
  integrations: [
    validateFitments,
    validateParts,
    validateMods,
    validateProcedures,
  ],

  // I18N-01: both locales are prefixed, so neither is privileged — `/en/…`
  // and `/es/…` are generated by the same routes from the same code.
  // I18N-02: `redirectToDefaultLocale` is off because `src/pages/index.astro`
  // owns `/` and negotiates the locale instead of hard-redirecting to `/en/`.
  i18n: {
    locales: ["en", "es"],
    defaultLocale: "en",
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
});
