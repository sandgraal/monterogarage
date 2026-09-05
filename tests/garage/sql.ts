/**
 * Grader infrastructure — the *declaration* tier of the T2-201 harness.
 *
 * This module reads whatever DDL T2-202 ships under `supabase/` and turns it
 * into something assertable. It is not an implementation of anything the spec
 * asks for; it is the instrument the graders read the implementation with.
 *
 * ## Why a declaration tier exists at all
 *
 * The behavioural tier (`harness.ts`) proves RLS the only way it can honestly
 * be proved: by asking a real Postgres, through a real API, as three real
 * actors. That needs `supabase start`, which needs Docker, which CI does not
 * have today (see `harness.ts` for the full infrastructure note). If that were
 * the only tier, every RLS guarantee in this repo would be unproven on the
 * merge path — the exact situation AGENTS.md's "proven by graders before
 * content flows" forbids.
 *
 * So the declaration tier runs everywhere, with no Docker and no network, and
 * pins the invariants that are visible in the DDL itself: RLS enabled *and*
 * forced, no policy granted to `anon`/`public`, share flags defaulting to
 * false, ownership chains declared `on delete cascade`, the receipts bucket
 * created non-public. Those are not a substitute for the behavioural proofs.
 * They are the half that can never silently stop running.
 *
 * ## Deliberately not a SQL parser
 *
 * It normalises (comments out, whitespace collapsed, lower-cased, string
 * literals preserved) and then extracts by structure: balanced-paren bodies
 * for `create table`, top-level comma splits for column definitions,
 * statement splits on top-level semicolons. Anything it cannot understand it
 * reports rather than guesses at — a silent "no match" in a security grader
 * is worse than no grader.
 *
 * refs specs/002-montero-garage (SHR-01, ACC-03, GAR-05′, MIG-03)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, resolved from this file so the graders are cwd-independent. */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Where the Supabase CLI keeps a project's DDL. */
export const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

/** Where the Supabase CLI keeps local stack + auth configuration. */
export const CONFIG_PATH = join(REPO_ROOT, "supabase", "config.toml");

/**
 * The seam message. Every declaration-tier grader is expected to fail today
 * with *this* — not with a typo, not with a bad path. `harness-contract.test.ts`
 * is the unmarked canary that proves it, so the `it.fails` markers elsewhere
 * are honest.
 */
export const SEAM_NOT_IMPLEMENTED = "not implemented: T2-202";

function seam(what: string): Error {
  return new Error(
    `${SEAM_NOT_IMPLEMENTED} — ${what}. T2-201 declared the user-data ` +
      `contract as graders; T2-202 [PLATFORM] ships the DDL that satisfies ` +
      `it (refs specs/002-montero-garage)`
  );
}

/* -------------------------------------------------------------------------
 * Reading
 * ---------------------------------------------------------------------- */

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `true` once T2-202 has landed any migration at all. */
export function migrationsExist(): boolean {
  return isDirectory(MIGRATIONS_DIR) && listMigrationFiles().length > 0;
}

function listMigrationFiles(): string[] {
  if (!isDirectory(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * Every migration concatenated in filename order — which for the Supabase CLI
 * is timestamp order, i.e. the order Postgres will apply them.
 *
 * Throws the seam error when there are none, so a grader that has not been
 * activated yet fails for a reason a human can read.
 */
export function readMigrationSql(): string {
  const files = listMigrationFiles();
  if (files.length === 0) {
    throw seam(`no .sql migrations found under supabase/migrations/`);
  }
  return files
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"))
    .join("\n");
}

/** `supabase/config.toml` as text, or the seam error if T2-202 has not run. */
export function readSupabaseConfig(): string {
  if (!isFile(CONFIG_PATH)) {
    throw seam(`supabase/config.toml does not exist`);
  }
  return readFileSync(CONFIG_PATH, "utf8");
}

/* -------------------------------------------------------------------------
 * Normalising
 * ---------------------------------------------------------------------- */

/**
 * Lower-case the SQL, drop `--` and block comments, collapse whitespace.
 *
 * String literals and dollar-quoted bodies are **not inspected**: comment
 * stripping stops at their boundaries, because a `--` inside `'…'` is data,
 * not a comment, and a normaliser that ate it would truncate exactly the
 * policy expressions these graders read.
 *
 * Not inspected is not the same as unchanged. The last line case-folds and
 * collapses whitespace across the whole output, literals and bodies included,
 * so what survives is *structure and tokens* rather than the original bytes.
 * Every rule in this suite matches lowercase keywords and is whitespace-
 * agnostic, so that is the right trade — but a rule that needed a literal's
 * exact text or a quoted identifier's casing could not be built on this
 * (PR #74 review).
 */
export function normalizeSql(sql: string): string {
  let out = "";
  let index = 0;
  while (index < sql.length) {
    const two = sql.slice(index, index + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", index);
      index = end === -1 ? sql.length : end;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }
    const char = sql[index];
    if (char === "'" || char === '"') {
      const quote = char;
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === quote && sql[cursor + 1] === quote) {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === quote) break;
        cursor += 1;
      }
      out += sql.slice(index, Math.min(cursor + 1, sql.length));
      index = cursor + 1;
      continue;
    }
    // Dollar-quoted bodies (functions) are copied through **uninspected** —
    // comment stripping and quote scanning are skipped for their whole extent,
    // so their structure and tokens arrive intact. They are not copied
    // *verbatim*: the final line below case-folds and collapses whitespace
    // across the entire output, this included. That is what the function
    // graders want — they match lowercase keywords and are whitespace-agnostic
    // — but a body is not byte-identical to its source, and a rule that needed
    // original casing (a quoted identifier, a literal's exact text) could not
    // rely on it (PR #74 review).
    const tag = dollarTagAt(sql, index);
    if (tag !== null) {
      const end = sql.indexOf(tag, index + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      out += sql.slice(index, stop);
      index = stop;
      continue;
    }
    out += char;
    index += 1;
  }
  return out.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The dollar-quote tag opening at `index`, or `null`.
 *
 * `$$` is the common spelling and was the only one the first version
 * understood. Postgres also accepts a *named* tag — `$function$`, `$body$` —
 * and `pg_dump` emits one whenever the body could contain `$$`. A named tag was
 * invisible to both `normalizeSql` and `statements`, so a function body
 * containing a `;` split into fragments and every function-level grader read
 * half a body (T2-401a). Generalising is backward compatible: `$$` is simply
 * the tag with an empty name.
 *
 * A tag name must start with a letter or underscore, which is what keeps
 * plpgsql's positional parameters (`$1`, `$2`) from being mistaken for one.
 */
export function dollarTagAt(sql: string, index: number): string | null {
  if (sql[index] !== "$") return null;
  const match = /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(sql.slice(index));
  return match ? match[0] : null;
}

/** Normalised migration SQL, ready to assert against. */
export function migrationSql(): string {
  return normalizeSql(readMigrationSql());
}

/**
 * Split normalised SQL into statements on top-level semicolons.
 *
 * Dollar-quoted bodies are skipped whole, by *tag*: a body opened with
 * `$function$` ends at the next `$function$` and not at some unrelated `$$`
 * inside it. The previous version toggled a boolean on every `$$`, which meant
 * a named tag was not recognised at all and the `;` after every `end` in a
 * plpgsql body became a statement boundary.
 */
export function statements(normalized: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let openTag: string | null = null;
  for (let index = 0; index < normalized.length; index += 1) {
    const tag = dollarTagAt(normalized, index);
    if (openTag === null && tag !== null) {
      openTag = tag;
      index += tag.length - 1;
      continue;
    }
    if (openTag !== null) {
      if (tag === openTag) {
        openTag = null;
        index += tag.length - 1;
      }
      continue;
    }
    const char = normalized[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === ";" && depth === 0) {
      const statement = normalized.slice(start, index).trim();
      if (statement) out.push(statement);
      start = index + 1;
    }
  }
  const tail = normalized.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/* -------------------------------------------------------------------------
 * Extracting
 * ---------------------------------------------------------------------- */

/** The parenthesised body of `create table <name> ( … )`, or `null`. */
export function createTableBody(
  normalized: string,
  table: string
): string | null {
  const pattern = new RegExp(
    `create table (?:if not exists )?(?:public\\.)?${table}\\s*\\(`
  );
  const match = pattern.exec(normalized);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let index = open; index < normalized.length; index += 1) {
    if (normalized[index] === "(") depth += 1;
    else if (normalized[index] === ")") {
      depth -= 1;
      if (depth === 0) return normalized.slice(open + 1, index).trim();
    }
  }
  return null;
}

/** Split a `create table` body into its top-level comma-separated items. */
export function tableItems(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      out.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

/** One column definition, as written. */
export interface ColumnDefinition {
  readonly name: string;
  /** Everything after the name: type, constraints, default. */
  readonly definition: string;
}

const TABLE_CONSTRAINT_KEYWORDS = [
  "primary key",
  "foreign key",
  "unique",
  "check",
  "constraint",
  "exclude",
  "like",
];

/** Column definitions from a `create table` body, constraints filtered out. */
export function columnDefinitions(body: string): ColumnDefinition[] {
  return tableItems(body)
    .filter(
      (item) =>
        !TABLE_CONSTRAINT_KEYWORDS.some((keyword) => item.startsWith(keyword))
    )
    .map((item) => {
      const space = item.indexOf(" ");
      return space === -1
        ? { name: item, definition: "" }
        : { name: item.slice(0, space), definition: item.slice(space + 1) };
    });
}

/** Find one column's definition in a table body, or `null`. */
export function columnDefinition(
  body: string,
  column: string
): ColumnDefinition | null {
  return columnDefinitions(body).find((def) => def.name === column) ?? null;
}

/** Remove a `default …` clause from a column definition, leaving the rest. */
function withoutDefault(definition: string): string {
  const expr = defaultExpression(definition);
  if (expr === null) return definition;
  const escaped = expr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return definition
    .replace(new RegExp(`\\bdefault\\s+${escaped}`), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One column's definition **after every statement has run** — declared by
 * T2-306a [TEST].
 *
 * ## Why this exists, and why `columnDefinition` alone was not enough
 *
 * A migration directory is a sequence, not a snapshot, and the only honest
 * question to ask of it is what the database looks like at the *end*
 * (`.claude/GRADER-PRINCIPLES.md`, "grade the end state, not the text" — the
 * same principle `policies()`, `grants()` and `functions()` already apply by
 * replaying their statements in order). `createTableBody` reads exactly one
 * statement, so it can only see columns a table was **born with**.
 *
 * That was the whole truth while every user column arrived in T2-202's
 * original `create table`. It stops being true the moment a task adds a
 * column to a table that already exists — which is every pending column
 * contract in this file. T2-306's `vehicles.cover_photo_path` cannot be added
 * to a `create table` that has already been pushed: editing an applied
 * migration changes what a *fresh* database gets and nothing about the one
 * that exists, which T2-301 tried and reverted for exactly that reason. So it
 * arrives as `alter table public.vehicles add column …`, and a sweep built on
 * `createTableBody` would keep reporting it missing after it shipped — an
 * expected failure with no legitimate route to green, which is the shape that
 * gets a grader deleted instead of satisfied.
 *
 * ## What is replayed
 *
 * In statement order, and last-write-wins:
 *
 * - `create table …( col … )` — the starting definition, if any;
 * - `alter table … add [column] [if not exists] col …` — replaces it;
 * - `alter table … drop [column] [if exists] col` — **removes** it, so a
 *   column added and later dropped reads as absent rather than present;
 * - `alter table … alter [column] col set/drop not null`;
 * - `alter table … alter [column] col set/drop default …`.
 *
 * Multi-action `alter table` statements are split on top-level commas, so
 * `add column a text, add column b text` is two actions and not one
 * unparsed blob.
 *
 * What is **not** replayed, stated rather than left to be discovered:
 * `rename column` (no migration in this project has ever used one, and a
 * rename that this returned a stale name for would be worse than one it
 * refused to follow), `alter column type`, and table-level `add primary key`
 * — {@link isNotNullFor} still reads those from the `create table` body only.
 */
export function columnDefinitionFor(
  normalized: string,
  table: string,
  column: string
): ColumnDefinition | null {
  const body = createTableBody(normalized, table);
  let current = body ? columnDefinition(body, column) : null;

  const prefix = new RegExp(`^${alterTablePrefix(table)}\\s+`);
  const added = new RegExp(
    `^add (?:column )?(?:if not exists )?${column}\\b([\\s\\S]*)$`
  );
  const dropped = new RegExp(`^drop (?:column )?(?:if exists )?${column}\\b`);
  const altered = new RegExp(`^alter (?:column )?${column}\\b([\\s\\S]*)$`);

  for (const statement of statements(normalized)) {
    const head = prefix.exec(statement);
    if (!head) continue;

    for (const action of splitTopLevelCommas(statement.slice(head[0].length))) {
      const add = added.exec(action);
      if (add) {
        current = { name: column, definition: add[1].trim() };
        continue;
      }
      if (dropped.test(action)) {
        current = null;
        continue;
      }
      const change = altered.exec(action);
      if (!change || current === null) continue;

      const verb = change[1].trim();
      if (verb === "set not null") {
        current = {
          name: column,
          definition: `${current.definition} not null`.trim(),
        };
      } else if (verb === "drop not null") {
        current = {
          name: column,
          definition: current.definition
            .replace(/\bnot null\b/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        };
      } else if (verb === "drop default") {
        current = {
          name: column,
          definition: withoutDefault(current.definition),
        };
      } else if (verb.startsWith("set default ")) {
        current = {
          name: column,
          definition:
            `${withoutDefault(current.definition)} ` +
            `default ${verb.slice("set default ".length).trim()}`.trim(),
        };
      }
    }
  }
  return current;
}

/**
 * The `default …` expression of a column definition, or `null`.
 *
 * Stops at the next constraint keyword so `default false not null` yields
 * `false`, not `false not null`.
 */
export function defaultExpression(definition: string): string | null {
  const match = /\bdefault\s+(.+)$/.exec(definition);
  if (!match) return null;
  return match[1]
    .replace(
      /\b(not null|null|references|primary key|unique|check|generated)\b[\s\S]*$/,
      ""
    )
    .trim();
}

/**
 * The balanced-paren expression introduced by `keyword`, or `null`.
 *
 * `using (a = (b))` must yield `a = (b)` and not `a = (b`, which is why this
 * counts depth instead of reaching for the next `)`.
 */
export function parenExpression(
  statement: string,
  keyword: "using" | "with check"
): string | null {
  const opener = new RegExp(`\\b${keyword}\\s*\\(`).exec(statement);
  if (!opener) return null;
  const open = opener.index + opener[0].length - 1;
  let depth = 0;
  for (let index = open; index < statement.length; index += 1) {
    if (statement[index] === "(") depth += 1;
    else if (statement[index] === ")") {
      depth -= 1;
      if (depth === 0) return statement.slice(open + 1, index).trim();
    }
  }
  return null;
}

/** One `create policy` statement, decomposed. */
export interface PolicyDefinition {
  readonly name: string;
  readonly table: string;
  /** `select` | `insert` | `update` | `delete` | `all` */
  readonly command: string;
  /** The roles named in `to …`; empty means the SQL default, `public`. */
  readonly roles: readonly string[];
  /**
   * The `using (…)` predicate, or `null`. Governs which rows are **visible**
   * — reads, and which rows an update or delete may touch.
   *
   * Kept apart from `withCheckExpr` because the T2-201 review found that
   * grading their concatenation grades nothing: a policy reading
   * `using (auth.uid() is not null) with check (owner_id = auth.uid())` has a
   * correct-looking string and hands every logged-in user everybody's rows.
   * The two clauses answer different questions and each has to be asked.
   */
  readonly usingExpr: string | null;
  /** The `with check (…)` predicate — which *new* rows are allowed. */
  readonly withCheckExpr: string | null;
  /** `false` for `as restrictive`. Restrictive policies filter, never grant. */
  readonly permissive: boolean;
  readonly statement: string;
}

function policyName(statement: string, verb: string): string {
  return (
    new RegExp(`${verb} policy "?([a-z0-9_ -]+)"? on`)
      .exec(statement)?.[1]
      ?.trim() ?? ""
  );
}

function policyTable(statement: string): string {
  return (
    /\bon (?:(?:public|storage)\.)?([a-z0-9_]+)/.exec(statement)?.[1] ?? ""
  );
}

/**
 * The roles a `create policy … to …` names.
 *
 * Accepts quoted identifiers and strips the quotes, for the reason
 * `parseRoles` gives at length (T2-401, F1). The old character class excluded
 * `"` outright, so `to "anon"` matched nothing and the policy was recorded with
 * **no** roles — which `userTablePolicyIssues` then reports as "granted to
 * public (no `to` clause)". That failed closed, so it was not a hole; but it
 * was a finding whose message named the wrong defect, and a reviewer chasing a
 * missing `to` clause that is right there in the file is a reviewer who
 * concludes the grader is broken.
 */
function policyRoles(statement: string): string[] {
  const clause = /\bto ([a-z0-9_,"\s]+?)(?= using| with check|$)/.exec(
    statement
  )?.[1];
  return clause
    ? clause
        .split(",")
        .map((role) => role.replace(/"/g, "").trim())
        .filter(Boolean)
    : [];
}

/**
 * Every policy the migrations leave **in force**, after replaying
 * `create` / `alter` / `drop` in order.
 *
 * ## Why this replays instead of listing `create policy`
 *
 * It used to filter for `create policy` and stop there, which made
 * `alter policy` invisible (T2-201 confirm review, D2). A second migration
 * saying
 *
 * ```sql
 * alter policy "records are owner-only" on public.records using (true);
 * ```
 *
 * reopened the exact hole finding F1 was about, and every grader in the suite
 * reported green — they were still reading the original, safe `create`. A
 * migration directory is a *sequence*, and the only honest question to ask of
 * it is what the database looks like at the end.
 *
 * `alter policy` may change the roles and either predicate; it cannot change
 * the command, so that is carried forward. `drop policy` removes the entry
 * entirely — a table left with no policy is then caught by the "no policy at
 * all" finding rather than silently passing.
 */
export function policies(normalized: string): PolicyDefinition[] {
  const inForce = new Map<string, PolicyDefinition>();
  const key = (table: string, name: string) => `${table}::${name}`;

  for (const statement of statements(normalized)) {
    if (statement.startsWith("create policy")) {
      const table = policyTable(statement);
      const name = policyName(statement, "create");
      inForce.set(key(table, name), {
        name,
        table,
        command:
          /\bfor (all|select|insert|update|delete)\b/.exec(statement)?.[1] ??
          "all",
        roles: policyRoles(statement),
        usingExpr: parenExpression(statement, "using"),
        withCheckExpr: parenExpression(statement, "with check"),
        permissive: !/\bas restrictive\b/.test(statement),
        statement,
      });
      continue;
    }

    if (statement.startsWith("alter policy")) {
      const table = policyTable(statement);
      const name = policyName(statement, "alter");
      const existing = inForce.get(key(table, name));
      const usingExpr = parenExpression(statement, "using");
      const withCheckExpr = parenExpression(statement, "with check");
      const roles = policyRoles(statement);
      inForce.set(key(table, name), {
        name,
        table,
        // ALTER POLICY cannot change the command.
        command: existing?.command ?? "all",
        roles: roles.length > 0 ? roles : (existing?.roles ?? []),
        usingExpr: usingExpr ?? existing?.usingExpr ?? null,
        withCheckExpr: withCheckExpr ?? existing?.withCheckExpr ?? null,
        permissive: existing?.permissive ?? true,
        // The statement now in force is the one that last set the predicate,
        // so a finding quotes the ALTER a reader has to go and look at.
        statement,
      });
      continue;
    }

    if (statement.startsWith("drop policy")) {
      inForce.delete(
        key(policyTable(statement), policyName(statement, "drop"))
      );
    }
  }

  return [...inForce.values()];
}

/**
 * `alter table [ if exists ] [ only ] [public.]<table>` — the full spelling
 * Postgres accepts.
 *
 * `only` matters because `pg_dump` writes `ALTER TABLE ONLY`, so a schema
 * round-tripped through a dump would have failed the RLS graders while being
 * completely correct (T2-201 review, F6).
 */
function alterTablePrefix(table: string): string {
  return `alter table (?:if exists )?(?:only )?(?:public\\.)?${table}\\b`;
}

/** `true` when the SQL enables RLS on `table`. */
export function enablesRls(normalized: string, table: string): boolean {
  return new RegExp(
    `${alterTablePrefix(table)} enable row level security`
  ).test(normalized);
}

/**
 * `true` when the SQL *forces* RLS on `table`.
 *
 * `enable` alone exempts the table owner, and Supabase migrations run as the
 * owner — so a table that is only `enable`d is wide open to anything that
 * connects as that role. `force` closes it. This is the invariant most often
 * missed, which is why it is graded separately from `enable`.
 */
export function forcesRls(normalized: string, table: string): boolean {
  return new RegExp(`${alterTablePrefix(table)} force row level security`).test(
    normalized
  );
}

/**
 * The referenced table of a `references …` clause, plus whether the reference
 * is declared `on delete cascade`.
 *
 * The referenced column list is **optional**: `references auth.users on delete
 * cascade` is valid Postgres — it targets the primary key — and rejecting it
 * failed a correct schema (T2-201 review, F6).
 */
export function foreignKey(
  definition: string
): { readonly target: string; readonly cascades: boolean } | null {
  const match =
    /references\s+(?:([a-z0-9_]+)\.)?([a-z0-9_]+)\s*(?:\(([^)]*)\))?([\s\S]*)$/.exec(
      definition
    );
  if (!match) return null;
  const schema = match[1] ? `${match[1]}.` : "";
  return {
    target: `${schema}${match[2]}`,
    cascades: /on delete cascade/.test(match[4] ?? ""),
  };
}

/** The table-level constraint items of a `create table` body. */
export function tableConstraints(body: string): string[] {
  return tableItems(body).filter((item) =>
    TABLE_CONSTRAINT_KEYWORDS.some((keyword) => item.startsWith(keyword))
  );
}

/**
 * The foreign key on `table.column`, wherever it is declared.
 *
 * Postgres accepts three spellings and a schema is no less correct for
 * choosing one of the latter two, so all three are searched (T2-201 review,
 * F6): inline on the column, as a table-level `constraint … foreign key (…)`
 * inside `create table`, or bolted on afterwards with `alter table … add
 * constraint … foreign key (…)`, which is what `pg_dump` emits.
 */
export function foreignKeyFor(
  normalized: string,
  table: string,
  column: string
): { readonly target: string; readonly cascades: boolean } | null {
  const body = createTableBody(normalized, table);
  if (body) {
    const inline = columnDefinition(body, column);
    const fromColumn = inline ? foreignKey(inline.definition) : null;
    if (fromColumn) return fromColumn;

    for (const constraint of tableConstraints(body)) {
      const match = /foreign key\s*\(([^)]*)\)([\s\S]*)$/.exec(constraint);
      if (!match) continue;
      const columns = match[1].split(",").map((name) => name.trim());
      if (columns.includes(column)) return foreignKey(match[2]);
    }
  }

  for (const statement of statements(normalized)) {
    if (!new RegExp(`^${alterTablePrefix(table)}`).test(statement)) continue;
    const match = /foreign key\s*\(([^)]*)\)([\s\S]*)$/.exec(statement);
    if (!match) continue;
    const columns = match[1].split(",").map((name) => name.trim());
    if (columns.includes(column)) return foreignKey(match[2]);
  }
  return null;
}

/**
 * `true` when `table.column` cannot be null.
 *
 * **`primary key` implies `NOT NULL`** — in Postgres it is not an extra
 * constraint you may also want, it is part of what a primary key *is*. The
 * first version of this harness demanded the literal `not null` and therefore
 * failed a column spelled `id uuid primary key`, which is the spelling used in
 * its own sample DDL (T2-201 review, F6).
 *
 * Reads the **end-state** definition (T2-306a), so a column added or made
 * not-null by a later `alter table` is judged on what it finally is rather
 * than on what the `create table` said. The table-level `primary key (…)`
 * sweep below still reads the `create table` body only — see
 * {@link columnDefinitionFor} for what that replay does and does not cover.
 */
export function isNotNullFor(
  normalized: string,
  table: string,
  column: string
): boolean {
  const definition = columnDefinitionFor(normalized, table, column);
  if (!definition) return false;
  if (/\bnot null\b/.test(definition.definition)) return true;
  if (/\bprimary key\b/.test(definition.definition)) return true;

  const body = createTableBody(normalized, table);
  if (!body) return false;
  for (const constraint of tableConstraints(body)) {
    const match = /primary key\s*\(([^)]*)\)/.exec(constraint);
    if (!match) continue;
    if (
      match[1]
        .split(",")
        .map((name) => name.trim())
        .includes(column)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * `true` when a default expression means "nothing here yet".
 *
 * GAR-02′ makes a record's reference arrays optional, and
 * `problem_ids text[] not null default '{}'` says exactly that — an empty
 * array is the absence of references, and it is a *better* modelling choice
 * than a nullable array because it removes the null/empty ambiguity. The
 * optionality grader has to accept it (T2-201 review, F8).
 */
export function representsAbsence(defaultExpr: string | null): boolean {
  if (defaultExpr === null) return false;
  const expr = defaultExpr.replace(/::[a-z_ \][]+$/, "").trim();
  return (
    /^'\{\s*\}'$/.test(expr) ||
    /^array\s*\[\s*\]$/.test(expr) ||
    /^'\[\s*\]'$/.test(expr) ||
    /^'\{\s*\}'::/.test(expr)
  );
}

/* =========================================================================
 * T2-401a — the second declaration surface: FUNCTIONS and GRANTS
 *
 * Everything above this line reads tables and policies. That was the whole of
 * the attack surface while every path into user data went through PostgREST
 * and RLS. SHR-05..08 add a path that does not: a `security definer` function
 * granted to `anon` runs as its owner, with RLS on the tables it touches not
 * consulted at all. Whatever such a function checks *is* the access control.
 *
 * Before this block, `grep -rn "security definer" tests/` returned one hit and
 * it was a comment. A definer function granted to `anon` doing
 * `select * from public.records` produced zero findings — verified against the
 * real graders. Two parsers close that:
 *
 * - `functions()` — the `policies()` replay discipline, applied to routines:
 *   name, argument signature, `security definer|invoker`, `set search_path`,
 *   return type, and body, after replaying `create` / `create or replace` /
 *   `drop` in file order.
 * - `grants()` — the **end-state ACL**. A migration directory is a sequence,
 *   and the only honest question to ask of it is what the database looks like
 *   at the end. `revoke all on public.records from anon;` followed by
 *   `grant select on public.records to anon;` is an anon-readable table, and
 *   the grader it replaced counted the revoke and called it proof.
 *
 * refs specs/002-montero-garage (SHR-01, SHR-05, SHR-06, SHR-07, SHR-08)
 * ====================================================================== */

/**
 * The seam for the sharing surface. Every T2-401a grader that describes a
 * function which does not exist yet fails with *this*, not with a typo — so an
 * `it.fails` marker in `share-instrument.test.ts` is honest about what it is
 * waiting for.
 */
export const SEAM_SHARE_GRANTS = "not implemented: T2-404";

/** The seam error for a share-grant surface T2-404 has not built yet. */
export function shareSeam(what: string): Error {
  return new Error(
    `${SEAM_SHARE_GRANTS} — ${what}. T2-401a [TEST] declared the sharing ` +
      `instrument; T2-404 [PLATFORM] ships the shares table, the grant RPCs, ` +
      `and the anon read RPCs that satisfy it ` +
      `(refs specs/002-montero-garage SHR-05..09)`
  );
}

/* -------------------------------------------------------------------------
 * Balanced-paren scanning, shared by the function and grant parsers
 * ---------------------------------------------------------------------- */

/**
 * The contents of the parenthesised group opening at `open`, plus the index of
 * its closing paren. `null` when the group never closes.
 */
export function balancedAt(
  text: string,
  open: number
): { readonly inner: string; readonly close: number } | null {
  if (text[open] !== "(") return null;
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return { inner: text.slice(open + 1, index).trim(), close: index };
      }
    }
  }
  return null;
}

/** Split on top-level commas, ignoring parens and string literals. */
export function splitTopLevelCommas(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      out.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

/* -------------------------------------------------------------------------
 * Function signatures
 * ---------------------------------------------------------------------- */

/**
 * Type spellings Postgres treats as the same type.
 *
 * This matters because a routine's ACL key is its *signature*, and the create
 * and the grant are free to spell the same type differently:
 * `create function f(p_now timestamptz)` is granted by
 * `grant execute on function f(timestamp with time zone)`. A parser that
 * compared the two as strings would file the grant against a function that
 * does not exist and then report the real one as ungranted — a finding about
 * nothing, which is how a grader teaches people to ignore it.
 */
const TYPE_ALIASES = new Map<string, string>([
  ["timestamp with time zone", "timestamptz"],
  ["timestamp without time zone", "timestamp"],
  ["time with time zone", "timetz"],
  ["time without time zone", "time"],
  ["character varying", "varchar"],
  ["character", "char"],
  ["boolean", "bool"],
  ["integer", "int"],
  ["int4", "int"],
  ["int8", "bigint"],
  ["int2", "smallint"],
  ["double precision", "float8"],
  ["real", "float4"],
  ["decimal", "numeric"],
]);

/**
 * Multi-word type names whose *first* word is a type keyword.
 *
 * Needed to tell an unnamed `timestamp with time zone` argument from a named
 * `p_now timestamptz` one: in both cases the first token is followed by more
 * tokens, and only the type list distinguishes them.
 */
const TYPE_FIRST_WORDS = new Set([
  "timestamp",
  "time",
  "character",
  "double",
  "bit",
  "interval",
  "numeric",
  "decimal",
  "national",
]);

/** One argument of a routine, reduced to the type Postgres keys the ACL on. */
export function canonicalArgumentType(rawArgument: string): string | null {
  let argument = rawArgument
    .trim()
    // `default …` and `= …` are not part of the signature.
    .replace(/\s+(?:default\s+|=\s*)[\s\S]*$/, "")
    .trim();

  const mode = /^(in|out|inout|variadic)\s+/.exec(argument);
  if (mode) {
    // OUT parameters are not part of a function's identity.
    if (mode[1] === "out") return null;
    argument = argument.slice(mode[0].length).trim();
  }

  const words = argument.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  // Drop the argument *name* when there is one. An unnamed multi-word type is
  // recognised by its first word rather than guessed at.
  if (words.length > 1 && !TYPE_FIRST_WORDS.has(words[0])) {
    words.shift();
  }

  const type = words
    .join(" ")
    .replace(/^pg_catalog\./, "")
    .trim();
  const arrayMatch = /^(.*?)((?:\s*\[\s*\d*\s*\])+)$/.exec(type);
  const base = (arrayMatch ? arrayMatch[1] : type).trim();
  const suffix = arrayMatch ? "[]" : "";
  return `${TYPE_ALIASES.get(base) ?? base}${suffix}`;
}

/** A routine's argument list, reduced to canonical types in order. */
export function canonicalArgumentTypes(rawArguments: string): string[] {
  return splitTopLevelCommas(rawArguments)
    .map(canonicalArgumentType)
    .filter((type): type is string => type !== null);
}

/**
 * `public.purge_expired_accounts(timestamptz)` — the key an ACL is filed under.
 */
export function functionIdentity(
  schema: string,
  name: string,
  argTypes: readonly string[]
): string {
  return `${schema}.${name}(${argTypes.join(", ")})`;
}

/* -------------------------------------------------------------------------
 * Functions
 * ---------------------------------------------------------------------- */

/** One `create function` statement, decomposed. */
export interface FunctionDefinition {
  readonly schema: string;
  readonly name: string;
  /** Canonical IN/INOUT argument types, in order. */
  readonly argTypes: readonly string[];
  /** `public.name(type, type)` — matches the spelling a `grant` uses. */
  readonly identity: string;
  /**
   * The `returns …` clause as written, or `""`. Load-bearing for SHR-06: a
   * function that `returns setof public.records` returns *every column* of
   * that table, so opting a cost field out of the projection is not something
   * its body can do.
   */
  readonly returns: string;
  readonly language: string;
  /**
   * `true` for `security definer` — the mode in which the function runs as its
   * owner and RLS on the tables it reads is **not consulted**.
   */
  readonly securityDefiner: boolean;
  /**
   * The `set search_path` value as written (`''` included), or `null` when the
   * routine sets none. A definer function with a caller-controlled search path
   * is a privilege-escalation primitive.
   */
  readonly searchPath: string | null;
  /** The dollar-quoted body, without its tags. `""` when there is none. */
  readonly body: string;
  /** The statement with the body removed — attributes only. */
  readonly header: string;
  readonly statement: string;
}

const CREATE_FUNCTION =
  /^create (?:or replace )?(?:function|procedure) (?:([a-z0-9_]+)\.)?([a-z0-9_]+)\s*\(/;
const DROP_FUNCTION =
  /^drop (?:function|procedure) (?:if exists )?(?:([a-z0-9_]+)\.)?([a-z0-9_]+)\s*(\()?/;

/** The `returns` clause of a routine header, or `""`. */
function returnsClause(header: string): string {
  const table = /\breturns\s+table\s*\(/.exec(header);
  if (table) {
    const group = balancedAt(header, table.index + table[0].length - 1);
    return group ? `table (${group.inner})` : "table";
  }
  const match =
    /\breturns\s+((?:setof\s+)?[a-z0-9_."]+(?:\s*\[\s*\])?)(?=\s|$)/.exec(
      header
    );
  if (!match) return "";
  // `returns null on null input` is a volatility attribute, not a return type.
  if (/^null\b/.test(match[1])) return "";
  return match[1].trim();
}

/**
 * Every routine the migrations leave **in place**, after replaying
 * `create` / `create or replace` / `drop` in file order.
 *
 * Mirrors `policies()` deliberately, for the same reason: the last statement
 * wins, and a grader that reads the first `create` is grading a database that
 * stopped existing two migrations ago. `create or replace` replaces the
 * definition and — exactly as in Postgres — leaves the ACL alone.
 */
export function functions(normalized: string): FunctionDefinition[] {
  const inPlace = new Map<string, FunctionDefinition>();

  for (const statement of statements(normalized)) {
    const created = CREATE_FUNCTION.exec(statement);
    if (created) {
      const open = created.index + created[0].length - 1;
      const group = balancedAt(statement, open);
      if (!group) continue;
      const schema = created[1] ?? "public";
      const name = created[2];
      const argTypes = canonicalArgumentTypes(group.inner);
      const tail = statement.slice(group.close + 1);

      // The body, by dollar tag. `as $$ … $$` and `as $function$ … $function$`
      // are the same construct and both have to be readable.
      let body = "";
      let header = tail;
      const asTag = /\bas\s+(\$(?:[a-z_][a-z0-9_]*)?\$)/.exec(tail);
      if (asTag) {
        const tag = asTag[1];
        const start = asTag.index + asTag[0].length;
        const end = tail.indexOf(tag, start);
        body = end === -1 ? tail.slice(start) : tail.slice(start, end);
        header = tail.slice(0, asTag.index);
      } else {
        // SQL-standard bodies: `begin atomic … end` and `return <expr>`.
        const atomic = /\bbegin\s+atomic\b/.exec(tail);
        const returnBody = /\breturn\s+/.exec(tail);
        if (atomic) {
          body = tail.slice(atomic.index);
          header = tail.slice(0, atomic.index);
        } else if (returnBody && /\blanguage\s+sql\b/.test(tail)) {
          body = tail.slice(returnBody.index);
          header = tail.slice(0, returnBody.index);
        }
      }

      header = header.trim();
      const searchPath =
        /\bset\s+search_path\s*(?:=|to)\s*('[^']*'|[a-z0-9_$",. ]+?)(?=\s*(?:as|language|security|stable|immutable|volatile|strict|parallel|cost|rows|leakproof|set|window|return|begin)\b|\s*$)/.exec(
          header
        )?.[1] ?? null;

      const definition: FunctionDefinition = {
        schema,
        name,
        argTypes,
        identity: functionIdentity(schema, name, argTypes),
        returns: returnsClause(header),
        language: /\blanguage\s+([a-z0-9_]+)/.exec(header)?.[1] ?? "",
        securityDefiner: /\bsecurity\s+definer\b/.test(header),
        searchPath: searchPath === null ? null : searchPath.trim(),
        body: body.trim(),
        header,
        statement,
      };
      inPlace.set(definition.identity, definition);
      continue;
    }

    const dropped = DROP_FUNCTION.exec(statement);
    if (dropped) {
      const schema = dropped[1] ?? "public";
      const name = dropped[2];
      if (dropped[3]) {
        const group = balancedAt(
          statement,
          statement.indexOf("(", dropped.index)
        );
        const argTypes = group ? canonicalArgumentTypes(group.inner) : [];
        inPlace.delete(functionIdentity(schema, name, argTypes));
      } else {
        // `drop function f` with no argument list drops the one routine of
        // that name — an error in Postgres when it is ambiguous, so removing
        // every overload matches what a valid migration can mean.
        for (const key of [...inPlace.keys()]) {
          if (key.startsWith(`${schema}.${name}(`)) inPlace.delete(key);
        }
      }
    }
  }

  return [...inPlace.values()];
}

/* -------------------------------------------------------------------------
 * Grant replay — the end-state ACL
 * ---------------------------------------------------------------------- */

/** What kind of object an ACL is filed against. */
export type ObjectKind = "table" | "view" | "function" | "sequence" | "schema";

const CREATE_RELATION =
  /^create (?:(table)|(?:materialized )?(view)) (?:if not exists )?(?:([a-z0-9_]+)\.)?([a-z0-9_]+)/;

/**
 * One object's access control list at the end of the migration directory.
 *
 * ## Why `cleared` exists, and why its absence means "unknown"
 *
 * This module reads migration *text*. The text is not the whole ACL: Supabase's
 * own role setup grants `anon` and `authenticated` privileges on `public`
 * before any migration in this repo runs, and none of it appears in a file
 * here. T2-202's review proved that the hard way — a schema whose 321
 * declaration graders were green let `authenticated` TRUNCATE `profiles`,
 * because `grant select, insert, update, delete` **adds to** an inherited ACL
 * rather than replacing it.
 *
 * So the replay does not pretend to know a baseline it cannot see. `cleared`
 * records the roles an explicit `revoke all` emptied; a role that was never
 * cleared may hold privileges nothing in the text mentions, and
 * `privilegeVerdict` answers `"unknown"` for it. Every grader treats
 * `"unknown"` as a finding, so the instrument fails **closed** on the one thing
 * it genuinely cannot see.
 */
export interface ObjectAcl {
  readonly kind: ObjectKind;
  readonly identity: string;
  /** Role → the privileges granted to it, still in force at the end. */
  readonly granted: ReadonlyMap<string, ReadonlySet<string>>;
  /** Roles whose inherited privileges an explicit `revoke all` emptied. */
  readonly cleared: ReadonlySet<string>;
  /** The grant/revoke statements that touched this object, in order. */
  readonly history: readonly string[];
}

/**
 * One `alter default privileges` statement.
 *
 * Recorded rather than replayed into any object's ACL: default privileges
 * apply to objects created *afterwards, by the role that set them*, and this
 * module cannot know which role runs a migration. T2-202's review is the
 * reason for the caution — the first version of that migration assumed default
 * privileges had emptied the tables' ACLs and the running database disagreed.
 * The `revokes future default privileges` grader reads these records; nothing
 * else does.
 */
export interface DefaultPrivilegeRecord {
  readonly action: "grant" | "revoke";
  readonly schema: string;
  /** `tables` | `sequences` | `functions` | `routines` | `types` | `schemas` */
  readonly objectType: string;
  readonly privileges: readonly string[];
  readonly roles: readonly string[];
  readonly statement: string;
}

/** The database's privileges at the end of the migration directory. */
export interface GrantState {
  readonly objects: ReadonlyMap<string, ObjectAcl>;
  readonly defaultPrivileges: readonly DefaultPrivilegeRecord[];
}

/** `"granted"` — the role holds it. `"none"` — provably not. `"unknown"` — the text does not say. */
export type GrantVerdict = "granted" | "none" | "unknown";

interface MutableAcl {
  kind: ObjectKind;
  identity: string;
  granted: Map<string, Set<string>>;
  cleared: Set<string>;
  history: string[];
}

const ALL_PRIVILEGES = "all";

function parsePrivileges(clause: string): string[] {
  const text = clause.trim().replace(/\s+privileges$/, "");
  if (text === ALL_PRIVILEGES) return [ALL_PRIVILEGES];
  return splitTopLevelCommas(text)
    .map((privilege) => privilege.replace(/\s*\([^)]*\)\s*$/, "").trim())
    .filter(Boolean);
}

/**
 * The roles named in a `to …` / `from …` clause.
 *
 * ## Identifier quotes are stripped, and that is the whole point (T2-401, F1)
 *
 * `grant select on public.records to "anon";` is valid SQL and means exactly
 * what the unquoted form means. Before this, the quotes survived into the
 * parsed role name, so the recorded role was the literal string `"anon"`,
 * which matches nothing in `ANONYMOUS_ROLES` — and **every rule built on the
 * grant replay returned zero findings for it**. Verified by direct execution:
 * the unquoted spelling flagged the leak, the quoted one reported clean.
 *
 * That is precisely the vulnerability shape T2-401a exists to catch, reachable
 * by adding two characters. It silently defeated `tableGrantIssues`,
 * `anonExecutableFunctions`, the closed allow-list, and T2-401's own
 * `defaultPrivilegeGrantIssues`.
 *
 * Quotes are removed rather than honoured because the safe failure direction
 * is **over-matching**: Postgres treats `"ANON"` and `anon` as different roles,
 * so folding them together can only produce a spurious finding — five minutes
 * of a reviewer's time — whereas keeping them apart produced a missed one,
 * which is a live hole. Same reasoning, and the same `.replace(/"/g, "")`, as
 * `qualify` already applies to object names.
 */
function parseRoles(clause: string): string[] {
  return splitTopLevelCommas(
    clause
      .trim()
      .replace(/\s+with grant option$/, "")
      .replace(/\s+(?:cascade|restrict)$/, "")
  )
    .map((role) =>
      role
        .replace(/^(?:group|role)\s+/, "")
        .replace(/"/g, "")
        .trim()
    )
    .filter(Boolean);
}

/** `public.records` — the key a table ACL is filed under. */
function qualify(reference: string, fallbackSchema = "public"): string {
  const trimmed = reference.trim().replace(/"/g, "");
  return trimmed.includes(".") ? trimmed : `${fallbackSchema}.${trimmed}`;
}

/**
 * The database's privileges at the end of the migration directory, after
 * replaying every `grant` and `revoke` in file order.
 *
 * ## The defect this exists to close (recorded 2026-08-31)
 *
 * `rls-deny-by-default.test.ts` counted statements matching
 * `^revoke … from … anon` and asserted the count was above zero. It never
 * asked what the ACL was at the end, so a directory containing
 *
 * ```sql
 * revoke all on public.records from anon;
 * grant select on public.records to anon;
 * ```
 *
 * scored 1 and passed — verified. `policies()` established replay discipline
 * for exactly this reason and it was never applied to grants. Second-order
 * while forced RLS and no anon policy still yield zero rows; first-order the
 * moment a `security definer` RPC adds an anon-reachable surface, which is what
 * T2-404 is about to do.
 */
export function grants(normalized: string): GrantState {
  const objects = new Map<string, MutableAcl>();
  const defaultPrivileges: DefaultPrivilegeRecord[] = [];

  const acl = (kind: ObjectKind, identity: string): MutableAcl => {
    const existing = objects.get(identity);
    if (existing) return existing;
    const fresh: MutableAcl = {
      kind,
      identity,
      granted: new Map(),
      cleared: new Set(),
      history: [],
    };
    objects.set(identity, fresh);
    return fresh;
  };

  const apply = (
    entry: MutableAcl,
    action: "grant" | "revoke",
    privileges: readonly string[],
    roles: readonly string[],
    statement: string
  ): void => {
    entry.history.push(statement);
    for (const role of roles) {
      const held = entry.granted.get(role) ?? new Set<string>();
      if (action === "grant") {
        for (const privilege of privileges) held.add(privilege);
        entry.granted.set(role, held);
        // A grant after a revoke re-opens the object. The ACL is still known —
        // it is known to contain this.
        continue;
      }
      if (privileges.includes(ALL_PRIVILEGES)) {
        entry.granted.set(role, new Set());
        entry.cleared.add(role);
        continue;
      }
      for (const privilege of privileges) held.delete(privilege);
      held.delete(ALL_PRIVILEGES);
      entry.granted.set(role, held);
    }
  };

  for (const statement of statements(normalized)) {
    // Register every object the directory creates, so an object with no
    // grant statement at all is present with an unknown ACL rather than
    // absent — absent would let a grader loop over nothing and report clean.
    const relation = CREATE_RELATION.exec(statement);
    if (relation) {
      const schema = relation[3] ?? "public";
      // `storage.objects` and `auth.users` are Supabase's, not this schema's.
      if (schema === "public") {
        acl(relation[1] ? "table" : "view", `${schema}.${relation[4]}`);
      }
    }
    const createdFunction = CREATE_FUNCTION.exec(statement);
    if (createdFunction) {
      const open = createdFunction.index + createdFunction[0].length - 1;
      const group = balancedAt(statement, open);
      if (group) {
        acl(
          "function",
          functionIdentity(
            createdFunction[1] ?? "public",
            createdFunction[2],
            canonicalArgumentTypes(group.inner)
          )
        );
      }
    }

    const adp =
      /^alter default privileges\b([\s\S]*?)\b(grant|revoke)\s+([\s\S]+?)\s+on\s+([a-z]+)\s+(?:to|from)\s+([\s\S]+)$/.exec(
        statement
      );
    if (adp) {
      defaultPrivileges.push({
        action: adp[2] as "grant" | "revoke",
        schema: /\bin schema\s+([a-z0-9_]+)/.exec(adp[1])?.[1] ?? "public",
        objectType: adp[4],
        privileges: parsePrivileges(adp[3]),
        roles: parseRoles(adp[5]),
        statement,
      });
      continue;
    }

    const grant =
      /^(grant|revoke)\s+(?:grant option for\s+)?([\s\S]+?)\s+on\s+([\s\S]+?)\s+(?:to|from)\s+([\s\S]+)$/.exec(
        statement
      );
    if (!grant) continue;

    const action = grant[1] as "grant" | "revoke";
    const privileges = parsePrivileges(grant[2]);
    const target = grant[3].trim();
    const roles = parseRoles(grant[4]);

    const bulk =
      // Quoted schema names accepted for the same reason quoted roles are
      // (T2-401, F1): `grant … on all tables in schema "public" to anon` is
      // valid SQL, and a character class that excluded `"` would have made the
      // whole bulk grant invisible to the replay.
      /^all\s+(tables|sequences|functions|routines|procedures)\s+in\s+schema\s+([a-z0-9_,"\s]+)$/.exec(
        target
      );
    if (bulk) {
      const schemas = new Set(
        bulk[2].split(",").map((name) => name.trim().replace(/"/g, ""))
      );
      const wantFunctions = bulk[1] !== "tables" && bulk[1] !== "sequences";
      for (const entry of objects.values()) {
        const schema = entry.identity.split(".")[0];
        if (!schemas.has(schema)) continue;
        const isFunction = entry.kind === "function";
        if (wantFunctions !== isFunction) continue;
        // `ALL TABLES` covers views, as Postgres does.
        if (
          !wantFunctions &&
          entry.kind !== "table" &&
          entry.kind !== "view" &&
          bulk[1] === "tables"
        ) {
          continue;
        }
        apply(entry, action, privileges, roles, statement);
      }
      continue;
    }

    const schemaTarget = /^schema\s+([a-z0-9_,". ]+)$/.exec(target);
    if (schemaTarget) {
      for (const name of splitTopLevelCommas(schemaTarget[1])) {
        apply(
          acl("schema", `schema ${name.replace(/"/g, "").trim()}`),
          action,
          privileges,
          roles,
          statement
        );
      }
      continue;
    }

    const kindMatch = /^(table|function|procedure|routine|sequence)\s+/.exec(
      target
    );
    const kind: ObjectKind =
      kindMatch === null
        ? "table"
        : kindMatch[1] === "table"
          ? "table"
          : kindMatch[1] === "sequence"
            ? "sequence"
            : "function";
    const list = kindMatch ? target.slice(kindMatch[0].length) : target;

    for (const reference of splitTopLevelCommas(list)) {
      if (kind === "function") {
        const open = reference.indexOf("(");
        if (open === -1) {
          // `grant execute on function public.f to anon` — legal when the name
          // is unambiguous. Apply to every overload the directory declares.
          const prefix = `${qualify(reference)}(`;
          const matches = [...objects.values()].filter(
            (entry) =>
              entry.kind === "function" && entry.identity.startsWith(prefix)
          );
          for (const entry of matches) {
            apply(entry, action, privileges, roles, statement);
          }
          continue;
        }
        const group = balancedAt(reference, open);
        const identity = functionIdentity(
          qualify(reference.slice(0, open)).split(".")[0],
          qualify(reference.slice(0, open)).split(".")[1],
          group ? canonicalArgumentTypes(group.inner) : []
        );
        apply(acl("function", identity), action, privileges, roles, statement);
        continue;
      }

      const identity = qualify(reference);
      const existing = objects.get(identity);
      apply(
        existing ?? acl(kind, identity),
        action,
        privileges,
        roles,
        statement
      );
    }
  }

  return {
    objects: new Map(
      [...objects].map(([identity, entry]) => [
        identity,
        {
          kind: entry.kind,
          identity: entry.identity,
          granted: new Map(
            [...entry.granted].map(([role, held]) => [role, new Set(held)])
          ),
          cleared: new Set(entry.cleared),
          history: [...entry.history],
        } satisfies ObjectAcl,
      ])
    ),
    defaultPrivileges,
  };
}

/**
 * Does `role` hold `privilege` on `identity` at the end of the directory?
 *
 * Three answers, not two. `"unknown"` is the honest one for an object whose
 * inherited ACL nothing in the text emptied — see `ObjectAcl.cleared`. Every
 * caller treats it as a finding, so the instrument errs toward reporting a
 * privilege that may not exist rather than missing one that does.
 *
 * `public` is not a role in a list — it is *every* role. A grant to `public`
 * therefore satisfies a question about `anon`, and, crucially, a
 * `revoke … from anon` does **not** take away a privilege `public` still holds.
 */
/**
 * `true` when the migration text has emptied `role`'s ACL on this object, so
 * "no privilege found" can honestly be reported as "no privilege held".
 *
 * **Two conditions, and the second is the one that gets forgotten.** Clearing
 * `anon` is not enough, because `public` is not a role beside `anon` — it is
 * *every* role. A privilege `public` inherited from Supabase's role setup
 * reaches `anon` through membership, and `revoke … from anon` does not touch
 * it. So a directory that revokes only from `anon` has told us nothing about
 * what `anon` can actually do, and the honest answer is `"unknown"`.
 *
 * ## Why this is one function and not two copies
 *
 * It used to be inlined in both `privilegeVerdict` and `rolePrivileges`, which
 * is worse than it sounds: the round-2 review flipped the `&&` to `||` in
 * *either* copy and all 516 garage tests stayed green. The table graders read
 * `rolePrivileges` and the allow-list reads `privilegeVerdict`, so neither
 * mutant alone moved the other's callers, and no probe covered the
 * revoke-from-anon-only case at all. One definition means one mutation now
 * moves every caller — and `G12` below is the probe that makes it move.
 */
function aclKnownFor(acl: ObjectAcl, role: string): boolean {
  const knownForRole = role === "public" || acl.cleared.has(role);
  const knownForPublic = acl.cleared.has("public");
  return knownForRole && knownForPublic;
}

export function privilegeVerdict(
  state: GrantState,
  identity: string,
  role: string,
  privilege: string
): GrantVerdict {
  const acl = state.objects.get(identity);
  if (!acl) return "unknown";

  const holds = (held: ReadonlySet<string> | undefined): boolean =>
    held !== undefined && (held.has(privilege) || held.has(ALL_PRIVILEGES));

  if (holds(acl.granted.get(role))) return "granted";
  if (role !== "public" && holds(acl.granted.get("public"))) return "granted";

  return aclKnownFor(acl, role) ? "none" : "unknown";
}

/** Every privilege `role` is known to hold on `identity`, with the verdict. */
export function rolePrivileges(
  state: GrantState,
  identity: string,
  role: string
): { readonly verdict: GrantVerdict; readonly privileges: string[] } {
  const acl = state.objects.get(identity);
  if (!acl) return { verdict: "unknown", privileges: [] };
  const direct = acl.granted.get(role) ?? new Set<string>();
  const shared =
    role === "public"
      ? new Set<string>()
      : (acl.granted.get("public") ?? new Set<string>());
  const privileges = [...new Set([...direct, ...shared])].sort();
  if (privileges.length > 0) return { verdict: "granted", privileges };
  // Delegates to the same knowledge test `privilegeVerdict` uses, so the two
  // cannot drift and one mutation moves both.
  return {
    verdict: aclKnownFor(acl, role) ? "none" : "unknown",
    privileges,
  };
}

/* -------------------------------------------------------------------------
 * Created tables — what actually exists, as opposed to what is enumerated
 * ---------------------------------------------------------------------- */

/** One relation the migrations create. */
export interface CreatedRelation {
  readonly schema: string;
  readonly name: string;
  readonly kind: "table" | "view";
  readonly identity: string;
  /**
   * The `create` statement that put it there, as normalised.
   *
   * Kept because a view's *options* live in the create and nowhere else:
   * `with (security_invoker = true)` is the difference between a view that
   * applies the caller's RLS and one that runs as its owner. A rename carries
   * the original statement forward — the options travel with the relation, not
   * with the name.
   */
  readonly statement: string;
}

/**
 * Every relation the migrations leave **in existence**, after replaying
 * `create` / `drop` / `alter … rename to` in file order.
 *
 * ## The defect this exists to close (recorded 2026-08-31)
 *
 * Nothing enumerated the tables that actually exist. Every table-level grader
 * is driven from `contract.ts` and `userTablePolicyIssues` filters to
 * `USER_TABLE_NAMES`, so a fifth user table was **invisible** — verified: a
 * `shares` table with `for all to anon using (true)` and no `force` produced
 * zero findings. That contradicts the constitution directly:
 *
 * > every user table ships with row-level security proven by graders before
 * > content flows — AGENTS.md, Boundaries
 *
 * A guarantee about "every user table" cannot be driven off a hand-written
 * list of user tables. The list says what *should* be there; this says what
 * *is*, and the difference is the finding.
 */
export function createdRelations(normalized: string): CreatedRelation[] {
  const inExistence = new Map<string, CreatedRelation>();

  for (const statement of statements(normalized)) {
    const created = CREATE_RELATION.exec(statement);
    if (created) {
      const schema = created[3] ?? "public";
      const name = created[4];
      const identity = `${schema}.${name}`;
      inExistence.set(identity, {
        schema,
        name,
        kind: created[1] ? "table" : "view",
        identity,
        statement,
      });
      continue;
    }

    const dropped =
      /^drop (?:table|(?:materialized )?view) (?:if exists )?(?:([a-z0-9_]+)\.)?([a-z0-9_]+)/.exec(
        statement
      );
    if (dropped) {
      inExistence.delete(`${dropped[1] ?? "public"}.${dropped[2]}`);
      continue;
    }

    const renamed =
      /^alter (?:table|view) (?:if exists )?(?:only )?(?:([a-z0-9_]+)\.)?([a-z0-9_]+) rename to ([a-z0-9_]+)/.exec(
        statement
      );
    if (renamed) {
      const schema = renamed[1] ?? "public";
      const from = `${schema}.${renamed[2]}`;
      const previous = inExistence.get(from);
      if (previous) {
        inExistence.delete(from);
        const identity = `${schema}.${renamed[3]}`;
        inExistence.set(identity, {
          ...previous,
          name: renamed[3],
          identity,
        });
      }
    }
  }

  return [...inExistence.values()];
}

/** Every `create table` in the `public` schema the directory leaves behind. */
export function createdTables(normalized: string): CreatedRelation[] {
  return createdRelations(normalized).filter(
    (relation) => relation.kind === "table" && relation.schema === "public"
  );
}

/** Every `create view` in the `public` schema the directory leaves behind. */
export function createdViews(normalized: string): CreatedRelation[] {
  return createdRelations(normalized).filter(
    (relation) => relation.kind === "view" && relation.schema === "public"
  );
}
