/**
 * Grading logic for the git→Supabase read-model (RM-01, RM-02) — the
 * instrument, not the thing it grades.
 *
 * Everything here is pure text/state analysis over already-parsed structures
 * from `tests/garage/sql.ts`, which this file **imports and does not
 * duplicate** — `grants()`, `rolePrivileges()`, `enablesRls()`, `forcesRls()`
 * and the rest already replay a migration directory correctly (T2-401a's
 * whole point), and re-deriving that here would be a second, divergent
 * implementation of the same replay.
 *
 * ## `searchVectorLocaleIssues` is deliberately not a general SQL parser
 *
 * It recognises exactly two structural shapes for "this branch of the
 * expression uses that dictionary", both anchored on the locale literal
 * being immediately followed by the thing that consumes it — never on mere
 * proximity. A naive "are both strings within N characters of each other"
 * check was tried and rejected while writing this file: for the canonical
 * `case … when 'en' then 'english' … when 'es' then 'spanish' … end` shape,
 * a window wide enough to see `'english'` after `'en'` is also wide enough
 * to see the *next* branch's `'spanish'`, which would make the same window
 * "prove" that `'en'` maps to both dictionaries at once and mask a real
 * same-config-for-both-locales defect. Anchoring on the grammar (`when
 * 'en' then '…'`, or `locale = 'en' … to_tsvector('…'`) does not have that
 * failure mode because the two locales' branches never share an anchor.
 *
 * refs specs/001-foundation (RM-01, RM-02)
 */
import { grants, rolePrivileges, type GrantState } from "../garage/sql.ts";
import {
  SEARCH_INDEX_WRITE_DENIED_ROLES,
  SEARCH_INDEX_WRITE_VERBS,
  SEARCH_VECTOR_LOCALE_CONFIG,
} from "./contract.ts";

/* -------------------------------------------------------------------------
 * RM-01 — per-language `tsvector` dictionaries
 * ---------------------------------------------------------------------- */

function casePattern(locale: string): RegExp {
  return new RegExp(`when\\s+'${locale}'\\s+then\\s+'([a-z]+)'`);
}

function ifPattern(locale: string): RegExp {
  // `if|elsif new.locale = 'en' then … to_tsvector('english', …)` — the
  // trigger-function shape. Bounded to 80 characters so an unrelated later
  // `to_tsvector` call (a different column, a different branch) cannot be
  // mistaken for this one; the canonical trigger body puts the assignment
  // right after the condition, well inside that budget.
  return new RegExp(
    `(?:new\\.)?locale\\s*=\\s*'${locale}'[\\s\\S]{0,80}?to_tsvector\\(\\s*'([a-z]+)'`
  );
}

/**
 * The dictionary name `text` associates with `locale`, by either recognised
 * structural shape — `null` if neither is present.
 */
export function localeDictionaryConfigFor(
  text: string,
  locale: "en" | "es"
): string | null {
  return (
    casePattern(locale).exec(text)?.[1] ??
    ifPattern(locale).exec(text)?.[1] ??
    null
  );
}

/**
 * Every way `text` (a `search_vector` column definition, a trigger function
 * body, or the two concatenated) fails RM-01's "tsvector columns with
 * english and spanish dictionaries" — empty when both locales resolve to the
 * dictionary `SEARCH_VECTOR_LOCALE_CONFIG` names for them.
 */
export function searchVectorLocaleIssues(text: string): string[] {
  const issues: string[] = [];
  const found: Partial<Record<"en" | "es", string>> = {};

  for (const locale of Object.keys(SEARCH_VECTOR_LOCALE_CONFIG) as (
    "en" | "es"
  )[]) {
    const expected = SEARCH_VECTOR_LOCALE_CONFIG[locale];
    const config = localeDictionaryConfigFor(text, locale);
    if (config === null) {
      issues.push(
        `no dictionary config found for locale '${locale}' — expected ` +
          `'${expected}' (RM-01)`
      );
      continue;
    }
    found[locale] = config;
    if (config !== expected) {
      issues.push(
        `locale '${locale}' resolves to dictionary '${config}', expected ` +
          `'${expected}' (RM-01)`
      );
    }
  }

  // Belt and braces: even if each locale happened to match ITS OWN expected
  // config (so the loop above raised nothing), a document that somehow
  // reused one dictionary for both would still be wrong — this catches that
  // shape directly rather than only inferring it from two separate misses.
  if (
    found.en !== undefined &&
    found.es !== undefined &&
    found.en === found.es
  ) {
    issues.push(
      `both locales resolve to the same dictionary '${found.en}' — search ` +
        `quality breaks in at least one language (RM-01)`
    );
  }

  return issues;
}

/* -------------------------------------------------------------------------
 * RM-01 — a GIN index on the generated column
 * ---------------------------------------------------------------------- */

/**
 * `true` when the migrations create a GIN index over `column` on `table`.
 *
 * A `tsvector` column with no index still answers `@@` queries correctly —
 * it just does a sequential scan on every request, which is silent
 * correctness with a performance cliff nobody notices until the corpus is
 * large enough for T803's endpoint to time out. RM-01 does not use the word
 * "index", but "a tsvector column" that a server-side search endpoint (T803)
 * is meant to query in production without one is not a serious reading of
 * what the requirement is for.
 */
export function hasGinIndexOn(
  normalized: string,
  table: string,
  column: string
): boolean {
  const pattern = new RegExp(
    `create index[^;]*?\\bon\\s+(?:public\\.)?${table}\\b[^;]*?using gin\\s*` +
      `\\([^)]*\\b${column}\\b[^)]*\\)`
  );
  return pattern.test(normalized);
}

/* -------------------------------------------------------------------------
 * RM-02 — write access denied to everything but the CI sync job
 * ---------------------------------------------------------------------- */

/**
 * Every write-verb (`insert`/`update`/`delete`) held by a role RM-02
 * forbids, at the end of the migration directory.
 *
 * Mirrors `tests/garage/rules.ts`'s `tableGrantIssues` in spirit — replay the
 * end-state ACL, never count `revoke` statements — but with a **different
 * verdict for `select`**, because this table is public reference content and
 * `tests/garage/contract.ts`'s "no privilege at all for `anon`" standard is
 * the wrong standard here (see `SEARCH_INDEX_WRITE_VERBS`'s doc comment in
 * `contract.ts` for why). `"unknown"` is still always a finding for the write
 * verbs specifically — an ACL nothing in the text clears is not proof the
 * write path is closed, whatever `select`'s state is.
 */
export function writeGrantIssues(
  normalized: string,
  table: string,
  state: GrantState = grants(normalized)
): string[] {
  const identity = `public.${table}`;
  const issues: string[] = [];

  for (const role of SEARCH_INDEX_WRITE_DENIED_ROLES) {
    const held = rolePrivileges(state, identity, role);

    if (held.verdict === "unknown") {
      issues.push(
        `${identity}: nothing revokes ${role}'s inherited privileges before ` +
          `granting — the end-state ACL for write verbs is unknown, and ` +
          `Supabase grants on public by default (RM-02)`
      );
      continue;
    }

    const heldWrites = held.privileges.filter((privilege) =>
      (SEARCH_INDEX_WRITE_VERBS as readonly string[]).includes(privilege)
    );
    if (heldWrites.length > 0) {
      issues.push(
        `${identity}: ${role} holds ${heldWrites.join(", ")} — RM-02 forbids ` +
          `any writer but the CI sync job`
      );
    }
  }

  return issues;
}
