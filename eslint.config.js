// @ts-check
import { defineConfig } from "eslint/config";
import eslint from "@eslint/js";
import eslintPluginAstro from "eslint-plugin-astro";
import globals from "globals";
import tseslint from "typescript-eslint";
import gitana from "./scripts/eslint/index.mjs";

export default defineConfig(
  {
    ignores: [
      "dist/**",
      // The configured-build audit target (`ci.yml`, `dist-configured/`) is
      // the same generated output as `dist/`, under a different name.
      "dist-configured/**",
      ".astro/**",
      "node_modules/**",
      "coverage/**",
      // Agent worktrees live in `.claude/worktrees/` and are independent
      // checkouts that lint themselves. Without this, one agent's
      // work-in-progress edit fails `npm run verify` in the main checkout and
      // in every other worktree — a build break nobody in those checkouts can
      // see the cause of. (`.prettierignore` already skips `.claude/`.)
      ".claude/**",
      // Supabase Edge Functions are Deno, not Node: `Deno.serve`, `Deno.env`,
      // and `jsr:`/`https:` import specifiers are all valid there and all
      // errors here, and this repo ships no Deno toolchain to lint them with.
      // Linting them under Node's globals would report five findings that are
      // each "this file is not Node", which is the kind of noise that gets a
      // rule switched off rather than a file fixed. What actually grades this
      // directory is `tests/garage/receipt-signer.test.ts`, which reads the
      // source for the rules that matter (never a caller-supplied path, never
      // a TTL above the ceiling, never a second signer).
      "supabase/functions/**",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintPluginAstro.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Astro's own convention for env.d.ts: a triple-slash reference to the
    // generated content-collection/env types, which is declaration-only.
    files: ["src/env.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    // I18N-08: user-facing strings live in src/i18n/ui.ts, never in markup.
    // Scoped to .astro because that is where markup lives; the strings module
    // itself is .ts and is therefore never its own violation.
    files: ["**/*.astro"],
    plugins: { gitana },
    rules: {
      "gitana/no-hardcoded-ui-text": "error",
    },
  }
);
