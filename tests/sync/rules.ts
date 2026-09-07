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
import {
  columnDefinitions,
  createTableBody,
  grants,
  rolePrivileges,
  statements,
  tableConstraints,
  type GrantState,
} from "../garage/sql.ts";
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

/* -------------------------------------------------------------------------
 * The primary key, as the migration actually declares it
 * ---------------------------------------------------------------------- */

/**
 * Same spelling `tests/garage/sql.ts`'s (non-exported) `alterTablePrefix`
 * uses, and for the same reason: `pg_dump` writes `ALTER TABLE ONLY`, and a
 * schema round-tripped through a dump is not less correct for it.
 */
function alterTablePrefix(table: string): string {
  return `alter table (?:if exists )?(?:only )?(?:public\\.)?${table}\\b`;
}

const PRIMARY_KEY_LIST = /primary key\s*\(([^)]*)\)/;

function splitColumnList(list: string): string[] {
  return list
    .split(",")
    .map((name) => name.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/**
 * The columns of `table`'s primary key **as finally declared**, or `null` when
 * nothing in the migration directory declares one at all.
 *
 * ## Why this is not "are these three columns present"
 *
 * The grader this replaces read `columnDefinitions(body)` and asserted the
 * three key columns appeared among them. That is a test of column *presence*,
 * not of the key: a table with a surrogate `id uuid primary key` plus
 * `collection`, `entry_id` and `locale` as ordinary nullable columns passed it
 * unchanged, and so did a two-column key that forgot `locale` — the shape that
 * makes `tests/sync/sync-plan.test.ts`'s "the same entry_id in two locales is
 * two independent rows" impossible to satisfy at the storage layer, whatever
 * `computeSyncPlan` decides in memory. RM-01's idempotent
 * `insert … on conflict (collection, entry_id, locale) do update` needs that
 * exact conflict target to exist as a real unique constraint; a `primary key`
 * spelled any other way makes the upsert a duplicate-row insert.
 *
 * ## What is read, and in what order
 *
 * All three spellings Postgres accepts, in statement order, last declaration
 * winning (a table has at most one primary key, so a later
 * `alter table … add … primary key` is either the only one or an error the
 * database itself rejects):
 *
 * 1. table-level inside `create table` — `primary key (a, b, c)` or
 *    `constraint <name> primary key (a, b, c)`, via `tableConstraints`;
 * 2. column-level inline — `id uuid primary key`, which is necessarily a
 *    single-column key and is exactly the surrogate-id defect above;
 * 3. `alter table … add [constraint <name>] primary key (a, b, c)`.
 *
 * `null` is deliberately distinct from `[]`
 * (`.claude/GRADER-PRINCIPLES.md`, "unknown is not zero"): "this migration
 * declares no primary key" is a finding, not a key with no columns.
 */
export function primaryKeyColumns(
  normalized: string,
  table: string
): string[] | null {
  let found: string[] | null = null;

  const body = createTableBody(normalized, table);
  if (body !== null) {
    for (const constraint of tableConstraints(body)) {
      const match = PRIMARY_KEY_LIST.exec(constraint);
      if (match) found = splitColumnList(match[1]);
    }
    if (found === null) {
      const inline = columnDefinitions(body).filter((column) =>
        /\bprimary key\b/.test(column.definition)
      );
      // More than one column claiming an inline `primary key` is invalid SQL
      // rather than a composite key; report it as declared so the caller sees
      // the real shape instead of a tidied-up guess.
      if (inline.length > 0) found = inline.map((column) => column.name);
    }
  }

  const alterPattern = new RegExp(`^${alterTablePrefix(table)}\\b`);
  for (const statement of statements(normalized)) {
    if (!alterPattern.test(statement)) continue;
    if (!/\badd\b/.test(statement)) continue;
    const match = PRIMARY_KEY_LIST.exec(statement);
    if (match) found = splitColumnList(match[1]);
  }

  return found;
}

/* -------------------------------------------------------------------------
 * RM-02 — the write credential never reaches a client-visible variable
 * ---------------------------------------------------------------------- */

/** Assignment operators a workflow file can bind a name with. */
const ASSIGNMENT = "(?::|=)";

/**
 * Every place `workflow` binds the service-role credential to a variable whose
 * name would reach client code.
 *
 * ## The bug this exists to catch
 *
 * `src/lib/supabase/config.ts` treats the `PUBLIC_` prefix as the whole
 * boundary between "safe in a browser bundle" and "must never leave CI". The
 * first version of this rule lived inline in `tests/sync/ci-wiring.test.ts`
 * and checked exactly one variable — it found the line containing
 * `PUBLIC_SUPABASE_ANON_KEY` and asserted that *that line* did not also name
 * the service-role secret. A workflow spelling
 *
 * ```yaml
 * env:
 *   PUBLIC_SUPABASE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
 * ```
 *
 * leaked the identical credential into the identical client-visible prefix and
 * passed, because the leak was not on the one line the rule looked at. The
 * property is "no `PUBLIC_*` name is ever bound to the service key", not "this
 * one `PUBLIC_*` name is not" — `.claude/GRADER-PRINCIPLES.md`, "grade
 * behavior, not name lists".
 *
 * ## What counts as a binding
 *
 * Any `PUBLIC_…` identifier followed by `:` (YAML mapping) or `=` (shell
 * assignment, including `echo "PUBLIC_X=$SECRET" >> $GITHUB_ENV`), whose value
 * names `serviceKeyEnvVar` — which catches `${{ secrets.NAME }}`,
 * `${{ env.NAME }}`, `$NAME` and `${NAME}` in one test, since all four contain
 * the variable's name. A value on its own continuation line (an empty
 * rest-of-line, or a `|`/`>` block scalar) is followed for as long as the
 * indentation stays deeper than the key's.
 *
 * Deliberately **over-matching**: a commented-out leak is reported, and so is
 * a `PUBLIC_*` binding in a step this job never runs. A spurious finding costs
 * a reviewer five minutes; a missed one ships a service-role key to every
 * browser that loads the site.
 *
 * What it does **not** catch, said out loud rather than left to be
 * discovered: a *laundered* leak, where the secret is bound to a non-`PUBLIC_`
 * name first and that name is then copied into a `PUBLIC_` one. Closing that
 * needs dataflow through the workflow's env, not a text rule; the sweep below
 * is the direct spelling, which is the one a rushed edit actually produces.
 */
export function clientKeyLeakIssues(
  workflow: string,
  serviceKeyEnvVar: string,
  clientPrefix = "PUBLIC_"
): string[] {
  const issues: string[] = [];
  const lines = workflow.split("\n");
  // Not anchored at `^`: the binding can start mid-line inside a `run:` shell
  // command. The leading class excludes `.` so `${{ secrets.PUBLIC_X }}` (a
  // read of a secret that happens to be named PUBLIC_*) is not mistaken for a
  // binding of one.
  const binding = new RegExp(
    `(?:^|[^A-Za-z0-9_.$])(${clientPrefix}[A-Za-z0-9_]*)\\s*${ASSIGNMENT}`,
    "g"
  );

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    binding.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = binding.exec(line)) !== null) {
      const name = match[1];
      const rest = line.slice(match.index + match[0].length);
      let value = rest;

      // A YAML value that lives on the following line(s): an empty
      // rest-of-line, or a block-scalar indicator. Follow it while the
      // indentation stays deeper than this key's.
      if (/^\s*(?:[|>][-+]?\d*)?\s*$/.test(rest)) {
        const indent = line.length - line.trimStart().length;
        for (let ahead = index + 1; ahead < lines.length; ahead += 1) {
          const next = lines[ahead];
          if (next.trim() === "") continue;
          const nextIndent = next.length - next.trimStart().length;
          if (nextIndent <= indent) break;
          value += `\n${next}`;
        }
      }

      if (value.includes(serviceKeyEnvVar)) {
        issues.push(
          `${name} is bound to ${serviceKeyEnvVar} — a ${clientPrefix}-prefixed ` +
            `variable is client-visible by construction ` +
            `(src/lib/supabase/config.ts), and RM-02's write credential must ` +
            `never be reachable from one`
        );
      }
    }
  }

  return issues;
}
