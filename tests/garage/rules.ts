/**
 * Grader infrastructure — **the semantic layer**.
 *
 * ## Why this file exists
 *
 * The first version of T2-201's declaration tier graded *spelling*. It asked
 * whether a policy statement contained the characters `auth.uid()` and did not
 * contain the characters `using (true)`. The review proved what that is worth
 * by writing schemas that are wide open and pass:
 *
 * ```sql
 * -- 164 graders passed. Every logged-in user reads everybody's records.
 * create policy "…" on public.records for all to authenticated
 *   using (auth.uid() is not null)
 *   with check (vehicle_id in (select id from vehicles where owner_id = auth.uid()));
 *
 * -- Passed. `1 = 1` is not the literal string `true`.
 * create policy "…" on public.vehicles for all to authenticated using (1 = 1);
 *
 * -- Passed. Every authenticated user downloads everybody's receipts.
 * create policy "…" on storage.objects for select to authenticated
 *   using (bucket_id = 'receipts' and auth.uid() is not null);
 * ```
 *
 * All three failed the same way: the graders tested the *concatenation* of
 * `using` and `with check`, so a correct `with check` covered for a wide-open
 * `using`. The two clauses answer different questions — `using` decides what
 * you can **see**, `with check` decides what you can **write** — and a
 * predicate that satisfies one says nothing about the other.
 *
 * So the rules moved out of the test bodies and into this file, as pure
 * functions over DDL text that return a list of findings. Three things follow
 * from that:
 *
 * 1. The graders became thin — they assert `issues == []` — so a rule can be
 *    fixed in one place instead of six.
 * 2. The rules are **testable against DDL with a known answer**, which is what
 *    `reviewer-probes.test.ts` does: the wide-open variants must be rejected
 *    and the correctly-spelled ones must be accepted. That suite is unmarked
 *    and green, and it is what stops this entire finding class from coming
 *    back — and it has itself been mutation-tested, because a corpus that
 *    only reaches the rules it happens to hit first has holes in it.
 * 3. Being about semantics rather than substrings, the rules accept spellings
 *    the string-matching version rejected — `primary key` for `not null`,
 *    `references auth.users` with no column list, table-level constraints,
 *    `ALTER TABLE ONLY`.
 *
 * ## The rule that does the work
 *
 * A predicate is **owner-scoped** when every one of its top-level `or`
 * branches compares `auth.uid()` for equality against something belonging to
 * the row. Two halves, both load-bearing:
 *
 * - *equality against a row term*, not merely a mention. `auth.uid() is not
 *   null` mentions it and means "anyone logged in".
 * - *every* branch, because `or` is how a scoped predicate gets widened:
 *   `owner_id = auth.uid() or true` reads as careful and grants everything.
 *
 * And one more, added after the confirm review: when the equality lives inside
 * a subquery, the subquery must **correlate** back to the outer row. Without
 * that, `exists (select 1 from vehicles where owner_id = auth.uid())` is a
 * global "does this person own anything at all" and grants every record in the
 * database to anyone with one truck. See `isCorrelated`.
 *
 * refs specs/002-montero-garage (SHR-01, SHR-03, GAR-05′, ACC-03)
 */
import {
  ANONYMOUS_ROLES,
  CONTRACT_SCHEMA,
  EXEMPT_PUBLIC_TABLES,
  GRANT_EXPIRY_COLUMN,
  GRANT_REVOCATION_COLUMN,
  PENDING_USER_TABLES,
  PLAINTEXT_TOKEN_COLUMNS,
  SHARE_GRANT_KINDS,
  SHARE_TOKEN_HASH_COLUMN,
  USER_TABLES,
  USER_TABLE_NAMES,
} from "./contract.ts";
import {
  balancedAt,
  createTableBody,
  createdTables,
  createdViews,
  columnDefinitionFor,
  columnDefinitions,
  defaultExpression,
  enablesRls,
  forcesRls,
  functions,
  grants,
  parenExpression,
  policies,
  privilegeVerdict,
  representsAbsence,
  rolePrivileges,
  statements,
  type FunctionDefinition,
  type GrantState,
  type PolicyDefinition,
} from "./sql.ts";

/* -------------------------------------------------------------------------
 * Expression analysis
 * ---------------------------------------------------------------------- */

/** Split on a top-level boolean operator, ignoring parens and string literals. */
export function splitTopLevel(expr: string, operator: "or" | "and"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < expr.length; index += 1) {
    const char = expr[index];
    if (char === "'") quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0) {
      const ahead = expr.slice(index);
      const match = new RegExp(`^\\b${operator}\\b`).exec(ahead);
      const boundaryBefore = index === 0 || /\s|\)/.test(expr[index - 1]);
      if (match && boundaryBefore) {
        parts.push(expr.slice(start, index).trim());
        index += operator.length - 1;
        start = index + 1;
      }
    }
  }
  parts.push(expr.slice(start).trim());
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Strip redundant wrapping parens: `((a = b))` → `a = b`. */
export function unwrap(expr: string): string {
  let out = expr.trim();
  while (out.startsWith("(") && out.endsWith(")")) {
    let depth = 0;
    let closesAtEnd = true;
    for (let index = 0; index < out.length; index += 1) {
      if (out[index] === "(") depth += 1;
      else if (out[index] === ")") {
        depth -= 1;
        if (depth === 0 && index < out.length - 1) closesAtEnd = false;
      }
    }
    if (!closesAtEnd) break;
    out = out.slice(1, -1).trim();
  }
  return out;
}

/**
 * Things that are true for anybody who gets as far as being asked.
 *
 * Not an attempt at a general theorem prover — a closed list of the forms that
 * actually turn up in a hand-written policy, including the two the review
 * used to walk through the first version of this harness (`1 = 1`, and
 * `auth.uid() is not null`, which reads like a security check and means
 * "any account at all").
 */
export function isTautological(expr: string): boolean {
  const term = unwrap(expr).replace(/\s+/g, " ").trim();
  if (term === "true") return true;
  if (/^\(?\s*(\d+)\s*=\s*(\d+)\s*\)?$/.test(term)) {
    const [, left, right] = /^\(?\s*(\d+)\s*=\s*(\d+)\s*\)?$/.exec(term) ?? [];
    return left === right;
  }
  if (/^'([^']*)'\s*=\s*'([^']*)'$/.test(term)) {
    const [, left, right] = /^'([^']*)'\s*=\s*'([^']*)'$/.exec(term) ?? [];
    return left === right;
  }
  // "Somebody is logged in" is not "this row is yours".
  if (/^auth\.uid\(\)\s*is not null$/.test(term)) return true;
  if (/^auth\.role\(\)\s*=\s*'authenticated'$/.test(term)) return true;
  if (/^auth\.jwt\(\)\s*is not null$/.test(term)) return true;
  if (/^current_user\s*is not null$/.test(term)) return true;
  // A conjunction is tautological only if every conjunct is.
  const conjuncts = splitTopLevel(term, "and");
  if (conjuncts.length > 1) return conjuncts.every(isTautological);
  return false;
}

/**
 * Rewrite the two idioms Supabase's own RLS performance guide recommends into
 * the plain form the comparand matcher understands.
 *
 * `(select auth.uid()) = owner_id` and `owner_id in (select auth.uid())` are
 * not exotic: wrapping the call in a scalar subquery lets Postgres hoist it
 * out of the per-row loop, so they are what a schema written for scale will
 * actually say. Both were being rejected as unscoped — a grader that fails
 * closed on the officially recommended spelling would have pushed T2-202
 * toward the slower one to get a green build (T2-201 confirm review, R4).
 */
export function canonicalizeAuthUid(expr: string): string {
  return expr
    .replace(/\bin\s*\(\s*select\s+auth\.uid\(\)\s*\)/g, "= auth.uid()")
    .replace(/\(\s*select\s+auth\.uid\(\)\s*\)/g, "auth.uid()");
}

/**
 * Operands that are not row terms — comparing to these proves nothing.
 *
 * `current_setting('request.jwt…')` is here because `auth.uid()` *is*
 * `current_setting('request.jwt.claims')::json->>'sub'` underneath. Comparing
 * the two is comparing the caller to themselves: always true, and it reads
 * like a careful check (T2-201 confirm review, R3).
 */
const NON_ROW_TERMS =
  /^(true|false|null|\d+|'.*'|auth\.uid\(\)(::[a-z_]+)?|auth\.role\(\)|auth\.jwt\(\).*|current_setting\(.*|current_user|session_user)$/;

/**
 * Every term compared for **equality** with `auth.uid()` in `expr`.
 *
 * Equality is the point. A predicate that merely mentions `auth.uid()` —
 * `auth.uid() is not null`, `coalesce(auth.uid(), …)` — has not tied the row
 * to the caller, and that distinction is the whole of finding F1.
 */
export function authUidComparands(rawExpr: string): string[] {
  const expr = canonicalizeAuthUid(rawExpr);
  const term = "[a-z0-9_.\"'\\[\\]()>-]+(?:::[a-z_ \\[\\]]+)?";
  const out: string[] = [];
  for (const pattern of [
    new RegExp(`(${term})\\s*=\\s*auth\\.uid\\(\\)(?:::[a-z_]+)?`, "g"),
    new RegExp(`auth\\.uid\\(\\)(?:::[a-z_]+)?\\s*=\\s*(${term})`, "g"),
  ]) {
    for (const match of expr.matchAll(pattern)) {
      const operand = match[1].replace(/::[a-z_ [\]]+$/, "").trim();
      if (!operand || NON_ROW_TERMS.test(operand)) continue;
      out.push(operand);
    }
  }
  return out;
}

/** Functions that pull the owning folder out of a storage object's name. */
const PATH_EXTRACTORS = /storage\.foldername|split_part|string_to_array|ltree/;

export interface ScopeOptions {
  /** Storage policies must also derive the owner from the object path. */
  readonly requirePathExtraction?: boolean;
  /** The table the policy is on — needed to judge subquery correlation. */
  readonly outerTable?: string;
  /** That table's declared columns, for the unqualified-reference case. */
  readonly outerColumns?: readonly string[];
}

/**
 * Split `expr` into the part outside any subquery and the subqueries
 * themselves. A subquery is a parenthesised group whose body starts `select`.
 */
export function stripSubqueries(expr: string): {
  readonly outer: string;
  readonly subqueries: string[];
} {
  const subqueries: string[] = [];
  let outer = "";
  let index = 0;
  while (index < expr.length) {
    if (expr[index] === "(" && /^\(\s*select\b/.test(expr.slice(index))) {
      let depth = 0;
      let end = index;
      for (let cursor = index; cursor < expr.length; cursor += 1) {
        if (expr[cursor] === "(") depth += 1;
        else if (expr[cursor] === ")") {
          depth -= 1;
          if (depth === 0) {
            end = cursor;
            break;
          }
        }
      }
      subqueries.push(expr.slice(index + 1, end).trim());
      outer += " SUBQUERY ";
      index = end + 1;
      continue;
    }
    outer += expr[index];
    index += 1;
  }
  return { outer, subqueries };
}

/**
 * `true` when `subquery` refers back to the row the policy is filtering.
 *
 * This is the whole of finding D1. A subquery can contain a perfectly good
 * `owner_id = auth.uid()` and still say nothing about the current row:
 *
 * ```sql
 * -- "if you own ANY vehicle, read EVERYONE's records"
 * using (exists (select 1 from vehicles v where v.owner_id = auth.uid()))
 * ```
 *
 * The equality is there, the tautology check passes, and the policy is wide
 * open to every user who owns a single truck. What is missing is the join back
 * to the outer row — `v.id = records.vehicle_id`. Correlation *is* the
 * ownership claim; without it the subquery is a global yes/no about the
 * caller.
 *
 * Both spellings of the back-reference count: qualified (`records.vehicle_id`,
 * which is the clearer one) and unqualified (`vehicle_id`, which Postgres
 * resolves outward when the inner tables have no such column). Rejecting the
 * unqualified form would fail a correct policy, so it is accepted — via the
 * outer table's declared columns, ignoring any that arrive with an alias
 * prefix.
 *
 * ## CLOSED IN T2-202: the shared-column-name gap
 *
 * Accepting the unqualified spelling used to cost something. The bare-name
 * test matched column *names* and did not resolve them against the subquery's
 * own `from` list, so when the inner table declared a column of the same name
 * as an outer one, a bare mention was read as a back-reference to the outer
 * row when it was nothing of the kind — and the uncorrelated subquery D1
 * exists to catch was waved through.
 *
 * It was reachable with this contract's own columns: `records` and `vehicles`
 * share exactly `{id, odometer_km}`. Two shapes, both of which used to pass:
 *
 * ```sql
 * -- `id = id` is a self-join on the INNER table. Reads as correlation. Is not.
 * exists (select 1 from vehicles v where id = id and v.owner_id = auth.uid())
 *
 * -- bare `odometer_km` resolves to vehicles.odometer_km, never to records'.
 * exists (select 1 from vehicles v where odometer_km > 0 and v.owner_id = auth.uid())
 * ```
 *
 * The fix, recorded on T2-201's handoff and landed with T2-202's first real
 * policy: read the subquery's own `from`/`join` list and **subtract those
 * tables' declared columns from `outerColumns` before the bare-name test**. A
 * name the inner table also declares cannot be evidence of an outward
 * reference, because Postgres resolves it inward. Both shapes above now
 * produce a finding, and both are pinned end-to-end as N13/N14 in
 * `reviewer-probes.test.ts` — the reviewer's P1/P2 — the same way N4 pins the
 * rule they are a hole in.
 *
 * Deliberately unchanged, because it is the safe half: the *qualified*
 * spelling (`records.vehicle_id`) still short-circuits to `true`, and a
 * subquery whose only candidate names have all been subtracted is judged
 * uncorrelated rather than unknown. This rule fails **closed** now — it can
 * reject a policy that correlates through something this module cannot see
 * (a view, a CTE, a table outside `USER_TABLES`), and rejecting a correct
 * policy is the direction a security grader should err in.
 */
export function isCorrelated(subquery: string, options: ScopeOptions): boolean {
  // With no table context there is nothing to correlate against, so this
  // cannot judge and must not invent a finding.
  if (!options.outerTable) return true;
  if (subquery.includes(`${options.outerTable}.`)) return true;

  // A bare name the subquery's OWN tables declare resolves inward, so it says
  // nothing about the outer row.
  const inner = new Set(
    subqueryTables(subquery).flatMap((table) => columnsOf(table))
  );
  return (options.outerColumns ?? [])
    .filter((column) => !inner.has(column))
    .some((column) => new RegExp(`(^|[^.a-z0-9_])${column}\\b`).test(subquery));
}

/**
 * The tables a subquery reads from, unqualified — the `from` and `join` list.
 *
 * Deliberately shallow: it collects names, it does not resolve aliases or
 * nesting. It only has to be right about which *declared* columns could
 * resolve inward, and a name it misses simply leaves that column in the
 * candidate set, which is the direction the old bug ran in — so a miss here
 * cannot be worse than not having the check at all.
 */
export function subqueryTables(subquery: string): string[] {
  return [
    ...subquery.matchAll(/\b(?:from|join)\s+(?:[a-z0-9_]+\.)?([a-z0-9_]+)/g),
  ].map((match) => match[1]);
}

/**
 * `true` when **every top-level `or` branch** of `expr` ties the row to the
 * caller.
 *
 * Every branch, because `or` is how a careful-looking predicate gets widened
 * to everything. One branch that grants unconditionally grants
 * unconditionally, however scoped its neighbours are.
 */
export function isOwnerScoped(
  expr: string | null,
  options: ScopeOptions = {}
): boolean {
  if (expr === null) return false;
  const branches = splitTopLevel(unwrap(expr), "or");
  if (branches.length === 0) return false;
  return branches.every((branch) => branchIsOwnerScoped(branch, options));
}

function branchIsOwnerScoped(branch: string, options: ScopeOptions): boolean {
  if (isTautological(branch)) return false;
  const canonical = canonicalizeAuthUid(branch);
  if (options.requirePathExtraction && !PATH_EXTRACTORS.test(canonical)) {
    return false;
  }

  const { outer, subqueries } = stripSubqueries(canonical);

  // A comparison on the row itself needs no correlation — it *is* the row.
  if (authUidComparands(outer).length > 0) return true;

  // Otherwise the claim rests entirely on a subquery, and a subquery only
  // speaks about this row if it mentions this row (D1).
  const owning = subqueries.filter(
    (subquery) => authUidComparands(subquery).length > 0
  );
  if (owning.length === 0) return false;
  return owning.some((subquery) => isCorrelated(subquery, options));
}

/* -------------------------------------------------------------------------
 * Policy rules
 * ---------------------------------------------------------------------- */

/**
 * The predicate Postgres actually applies to new rows.
 *
 * For `update` and `all`, omitting `with check` is not an omission: Postgres
 * reuses the `using` expression for the write side. Treating a missing clause
 * as a finding would reject `for all using (owner_id = auth.uid())`, which is
 * both idiomatic and correct.
 */
export function effectiveCheck(policy: PolicyDefinition): string | null {
  if (policy.withCheckExpr !== null) return policy.withCheckExpr;
  if (policy.command === "update" || policy.command === "all") {
    return policy.usingExpr;
  }
  return null;
}

const READ_COMMANDS = new Set(["select", "update", "delete", "all"]);
const WRITE_COMMANDS = new Set(["insert", "update", "all"]);

function policyIssues(
  policy: PolicyDefinition,
  options: ScopeOptions
): string[] {
  const issues: string[] = [];
  const where = `${policy.table} policy "${policy.name}" (for ${policy.command})`;

  if (
    policy.roles.length === 0 ||
    policy.roles.some((role) => role === "anon" || role === "public")
  ) {
    issues.push(
      `${where}: granted to ${policy.roles.length === 0 ? "public (no `to` clause)" : policy.roles.join(", ")}`
    );
  }

  // Restrictive policies only ever narrow what a permissive policy granted, so
  // they are not required to be owner-scoped on their own.
  if (!policy.permissive) return issues;

  if (READ_COMMANDS.has(policy.command)) {
    if (!isOwnerScoped(policy.usingExpr, options)) {
      issues.push(
        `${where}: \`using\` is not owner-scoped — ` +
          `${policy.usingExpr === null ? "no using clause" : `using (${policy.usingExpr})`}`
      );
    }
  }
  if (WRITE_COMMANDS.has(policy.command)) {
    const check = effectiveCheck(policy);
    if (!isOwnerScoped(check, options)) {
      issues.push(
        `${where}: \`with check\` is not owner-scoped — ` +
          `${check === null ? "no with check clause" : `with check (${check})`}`
      );
    }
  }
  return issues;
}

/**
 * The declared columns of a contract table, for correlation checking.
 *
 * `PENDING_USER_TABLES` is searched alongside `USER_TABLES` (T2-305a). A table
 * that is declared but not yet created is exactly the case where a grader is
 * asked to judge a policy that does not exist yet, and `isCorrelated` fails
 * **closed** when it has no columns to test the unqualified back-reference
 * against — so leaving a pending table out would reject the correct,
 * idiomatic `… where record_id = id` spelling with no route to green but
 * renaming. Adding pending tables cannot change any existing verdict: no name
 * in `PENDING_USER_TABLES` is in `USER_TABLES`, and the only effect is more
 * candidate names for a table nothing currently references.
 */
function columnsOf(table: string): readonly string[] {
  return (
    [...USER_TABLES, ...PENDING_USER_TABLES]
      .find((entry) => entry.name === table)
      ?.columns.map((column) => column.name) ?? []
  );
}

/** Every finding against the policies on the named user tables. */
export function userTablePolicyIssues(
  normalized: string,
  tables: readonly string[]
): string[] {
  const found = policies(normalized).filter((policy) =>
    tables.includes(policy.table)
  );
  const issues = found.flatMap((policy) =>
    policyIssues(policy, {
      outerTable: policy.table,
      outerColumns: columnsOf(policy.table),
    })
  );

  for (const table of tables) {
    if (!found.some((policy) => policy.table === table)) {
      issues.push(`${table}: no policy at all`);
    }
  }
  return issues;
}

/**
 * Every finding against `storage.objects` policies.
 *
 * Same rule as the tables plus one: the predicate has to derive the owner from
 * the object's *path*, because that is the only thing about a storage row that
 * says whose it is. Finding F2 was a policy that checked the bucket and the
 * session and never the path.
 */
export function storagePolicyIssues(normalized: string): string[] {
  const found = policies(normalized).filter(
    (policy) => policy.table === "objects"
  );
  if (found.length === 0) return ["storage.objects: no policy at all"];
  return found.flatMap((policy) =>
    policyIssues(policy, {
      requirePathExtraction: true,
      outerTable: "objects",
      outerColumns: ["name", "bucket_id", "owner", "id"],
    })
  );
}

/**
 * Every finding against the policies protecting **one** storage bucket.
 *
 * `storagePolicyIssues` grades every `storage.objects` policy together, which
 * was the whole truth while receipts were the only bucket. It stops being the
 * whole truth the moment there are two: a project whose receipts policies are
 * flawless and whose photo objects have no policy at all passes it, because
 * every policy that exists is fine and the missing one is not a policy.
 *
 * So this asks the question per bucket — are there policies naming this
 * bucket, do they cover all four commands, and is each one owner-scoped
 * through the object path. A bucket nobody wrote a policy for is a finding
 * here, and under `force row level security` it is also, mercifully, an
 * outage rather than a leak.
 *
 * refs specs/002-montero-garage (GAR-01′ photos, GAR-05′ receipts, SHR-01)
 */
export function bucketPolicyIssues(
  normalized: string,
  bucket: string
): string[] {
  const forBucket = policies(normalized).filter(
    (policy) =>
      policy.table === "objects" &&
      [policy.usingExpr, policy.withCheckExpr]
        .filter((expr): expr is string => expr !== null)
        .some((expr) => expr.includes(`'${bucket}'`))
  );

  if (forBucket.length === 0) {
    return [`storage.objects: no policy names the ${bucket} bucket`];
  }

  const issues = forBucket.flatMap((policy) =>
    policyIssues(policy, {
      requirePathExtraction: true,
      outerTable: "objects",
      outerColumns: ["name", "bucket_id", "owner", "id"],
    })
  );

  const covered = new Set<string>();
  for (const policy of forBucket) {
    if (!policy.permissive) continue;
    if (policy.command === "all") {
      for (const command of ["select", "insert", "update", "delete"]) {
        covered.add(command);
      }
    } else {
      covered.add(policy.command);
    }
  }
  for (const command of ["select", "insert", "update", "delete"]) {
    if (!covered.has(command)) {
      issues.push(`${bucket}: no policy covers ${command}`);
    }
  }
  return issues;
}

/** Which SQL commands each table's policies cover. */
export function coveredCommands(
  normalized: string,
  table: string
): Set<string> {
  const covered = new Set<string>();
  for (const policy of policies(normalized)) {
    if (policy.table !== table || !policy.permissive) continue;
    if (policy.command === "all") {
      for (const command of ["select", "insert", "update", "delete"]) {
        covered.add(command);
      }
    } else {
      covered.add(policy.command);
    }
  }
  return covered;
}

/* -------------------------------------------------------------------------
 * Storage bucket privacy
 * ---------------------------------------------------------------------- */

/**
 * Every finding against the privacy of `bucket`.
 *
 * Three ways to get this wrong, and the first version of the harness caught
 * none of them reliably (T2-201 review, F5): create it public; create it
 * private and flip it in a later migration; create it private and flip it in
 * the same statement's `on conflict do update`. So the check is scoped to the
 * statements that touch `storage.buckets` — not, as before, to a slice running
 * to the end of the file, where a stray `false` anywhere satisfied it.
 */
export function bucketPrivacyIssues(
  normalized: string,
  bucket: string
): string[] {
  const issues: string[] = [];
  const literal = `'${bucket}'`;
  const touching = statements(normalized).filter(
    (statement) =>
      (statement.includes("storage.buckets") ||
        statement.includes("create_bucket")) &&
      statement.includes(literal)
  );

  const creating = touching.filter(
    (statement) =>
      statement.startsWith("insert into storage.buckets") ||
      statement.includes("create_bucket")
  );
  if (creating.length === 0) {
    issues.push(`no statement creates the ${bucket} bucket`);
  }

  for (const statement of touching) {
    // Inside a statement that names this bucket, `true` can only be the
    // public flag — there is nothing else boolean in a bucket row worth
    // setting. Position-independent on purpose: the review's probe passed by
    // putting the value before the name.
    if (/\btrue\b/.test(statement)) {
      issues.push(
        `a statement sets ${bucket} public: ${statement.slice(0, 160)}`
      );
    }
    if (
      statement.startsWith("insert into storage.buckets") &&
      !/\bfalse\b/.test(statement)
    ) {
      issues.push(
        `${bucket} is created without an explicit public = false: ` +
          statement.slice(0, 160)
      );
    }
  }

  // A later mutation that names no bucket flips every bucket, including this
  // one, so it is a finding even though the loop above cannot see it.
  for (const statement of statements(normalized)) {
    if (!statement.startsWith("update storage.buckets")) continue;
    if (/set[\s\S]*public\s*=\s*true/.test(statement)) {
      issues.push(
        `a later update sets buckets public: ${statement.slice(0, 160)}`
      );
    }
  }
  return issues;
}

/* -------------------------------------------------------------------------
 * Column rules
 * ---------------------------------------------------------------------- */

/**
 * `true` when `table.column` is optional in the sense GAR-02′ means it.
 *
 * Nullable is the obvious spelling. `not null default '{}'` is the other one,
 * and it is a better model for the reference arrays — an empty array *is* "no
 * references", with none of the null-versus-empty ambiguity (T2-201 review,
 * F8).
 *
 * Reads the **end-state** definition (T2-306a): a column that arrives in a
 * later `alter table … add column` is exactly as optional as one declared in
 * the `create table`, and a sweep that could not see it would report every
 * such column as non-optional forever.
 */
export function isOptionalColumn(
  normalized: string,
  table: string,
  column: string,
  allowAbsenceDefault: boolean
): boolean {
  const definition = columnDefinitionFor(normalized, table, column);
  if (!definition) return false;
  const notNull = /\bnot null\b/.test(definition.definition);
  if (!notNull) return true;
  if (!allowAbsenceDefault) return false;
  return representsAbsence(defaultExpression(definition.definition));
}

/** Re-exported so the probe suite can reach the parser it is grading. */
export { parenExpression };

/* =========================================================================
 * T2-401a — rules over FUNCTIONS and GRANTS
 *
 * The rules above judge policies, which is the whole story only while every
 * path to user data goes through RLS. A `security definer` function granted to
 * `anon` is a path that does not: it runs as its owner, RLS on the tables it
 * reads is not consulted, and whatever its body checks is the access control.
 *
 * Same shape as the policy rules, for the same reasons: pure functions over
 * DDL text returning a list of findings, so the graders stay thin, a rule can
 * be fixed in one place, and every rule is itself gradeable against DDL with a
 * known answer — which is what `reviewer-probes.test.ts` does to all of them.
 *
 * refs specs/002-montero-garage (SHR-01, SHR-05, SHR-06, SHR-07, SHR-08)
 * ====================================================================== */

/* -------------------------------------------------------------------------
 * `security definer` hygiene
 * ---------------------------------------------------------------------- */

/**
 * Every `security definer` routine must carry `set search_path = ''`.
 *
 * Codifies what T2-202 already does in all four of its functions, which is the
 * moment to codify it: a practice that is universal and ungraded is a practice
 * one hurried migration away from not being universal.
 *
 * The reason it is not style. A definer function runs with its owner's
 * privileges and resolves unqualified names through the *caller's*
 * `search_path`. A caller who can create a schema can therefore put their own
 * `records` table ahead of `public.records` and have privileged code read it.
 * `set search_path = ''` removes the ambiguity by removing the search path:
 * every name in the body must then be schema-qualified, which is a cost worth
 * paying and a diff worth seeing.
 *
 * Accepted spellings are `''` and `pg_catalog` alone — both mean "resolve
 * nothing implicitly from a schema a caller controls". Anything else,
 * including `public`, is a finding.
 */
export function definerSearchPathIssues(normalized: string): string[] {
  const issues: string[] = [];
  for (const routine of functions(normalized)) {
    if (!routine.securityDefiner) continue;
    const searchPath = routine.searchPath;
    if (searchPath === null) {
      issues.push(
        `${routine.identity}: security definer with no \`set search_path\` — ` +
          `unqualified names resolve through the caller's search path`
      );
      continue;
    }
    const value = searchPath.replace(/^'|'$/g, "").trim();
    if (value !== "" && value !== "pg_catalog") {
      issues.push(
        `${routine.identity}: security definer with ` +
          `\`set search_path = ${searchPath}\` — must be '' so every name is ` +
          `schema-qualified`
      );
    }
  }
  return issues;
}

/* -------------------------------------------------------------------------
 * The closed allow-list of anon-executable functions
 * ---------------------------------------------------------------------- */

/**
 * `true` when `anon` or `public` can execute `routine` at the end of the
 * migration directory — **including when the text does not say**.
 *
 * An `"unknown"` verdict counts as executable on purpose. Postgres grants
 * `EXECUTE` on a new function to `PUBLIC` by default; a routine whose ACL no
 * migration ever emptied is therefore reachable by `anon` in the running
 * database while being silent in the file. Reading that silence as "not
 * granted" is the single easiest way for this whole instrument to be
 * decorative, so it reads as "granted" and the fix is one `revoke` line.
 */
export function isAnonExecutable(
  state: GrantState,
  routine: FunctionDefinition
): boolean {
  return ANONYMOUS_ROLES.some(
    (role) =>
      privilegeVerdict(state, routine.identity, role, "execute") !== "none"
  );
}

/** Every routine `anon` or `public` can reach, at the end of the directory. */
export function anonExecutableFunctions(
  normalized: string
): FunctionDefinition[] {
  const state = grants(normalized);
  return functions(normalized).filter((routine) =>
    isAnonExecutable(state, routine)
  );
}

/**
 * Does `routine` bear this contract's `name`, **in this contract's schema**?
 *
 * ## The gap this closes (PR #74 review)
 *
 * Every comparison in this suite used to be `routine.name === name`, which
 * matches half an identity. A routine is `(schema, name, argument types)`, and
 * two of those were being thrown away. The consequence was worst on the half
 * of the allow-list that is live today:
 *
 * ```sql
 * -- `share_read_records` is a declared share reader, so the "unexpected"
 * -- filter waved this through — a security definer function in a schema
 * -- nothing in this contract has ever mentioned, executable by anon.
 * create function private.share_read_records(p_token text) …
 * grant execute on function private.share_read_records(text) to anon;
 * ```
 *
 * It cut the other way too: that same routine satisfied the *completeness*
 * half, so the graders would have reported the public reader present when only
 * a wrong-schema impostor existed, and the seam guard would have handed the
 * marked tests an object from a schema they were never describing.
 *
 * One predicate, used everywhere a contract name meets a parsed routine, so a
 * single mutation moves every caller — the same de-duplication argument as
 * `aclKnownFor`.
 */
export function isContractRoutine(
  routine: FunctionDefinition,
  name: string
): boolean {
  return routine.schema === CONTRACT_SCHEMA && routine.name === name;
}

/**
 * The declared share readers present in `normalized`, and the names that are
 * absent — matched by schema **and** name, never by name alone.
 *
 * Lives here rather than in the grader file so the schema-scoping is reachable
 * by the probe corpus: a rule that only the seam guard could exercise is a rule
 * the corpus cannot mutation-test.
 */
export function findShareReaders(
  normalized: string,
  names: readonly string[]
): { readonly found: FunctionDefinition[]; readonly missing: string[] } {
  const declared = functions(normalized);
  const found: FunctionDefinition[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const routine = declared.find((entry) => isContractRoutine(entry, name));
    if (routine) found.push(routine);
    else missing.push(`${CONTRACT_SCHEMA}.${name}`);
  }
  return { found, missing };
}

/**
 * The closed allow-list, as two independently-failing halves.
 *
 * `unexpected` is the security half and it is live today: anything reachable
 * by `anon` that is not a named share reader. `missing` is the completeness
 * half and it is the expected failure until T2-404 ships — a share reader that
 * does not exist, or exists and was never granted, cannot serve anybody.
 *
 * Kept apart because they fail for opposite reasons and a caller that merged
 * them would have to choose which one to be wrong about.
 *
 * Both halves match on **schema and name** — see `isContractRoutine` for the
 * impostor this rejects.
 */
export function anonFunctionAllowListIssues(
  normalized: string,
  allowed: readonly string[]
): { readonly unexpected: string[]; readonly missing: string[] } {
  const state = grants(normalized);
  const declared = functions(normalized);
  const reachable = declared.filter((routine) =>
    isAnonExecutable(state, routine)
  );

  const unexpected = reachable
    .filter(
      (routine) => !allowed.some((name) => isContractRoutine(routine, name))
    )
    .map((routine) => {
      const verdicts = ANONYMOUS_ROLES.map(
        (role) =>
          `${role}=${privilegeVerdict(state, routine.identity, role, "execute")}`
      ).join(" ");
      const impostor = allowed.includes(routine.name)
        ? ` — it bears a declared share reader's name but lives in ` +
          `${routine.schema}, not ${CONTRACT_SCHEMA}`
        : "";
      return (
        `${routine.identity}: executable by an anonymous caller (${verdicts}) ` +
        `but is not a declared share reader` +
        (routine.securityDefiner ? " — and it is security definer" : "") +
        impostor
      );
    });

  const missing = allowed
    .filter(
      (name) => !reachable.some((routine) => isContractRoutine(routine, name))
    )
    .map((name) => {
      const exists = declared.some((routine) =>
        isContractRoutine(routine, name)
      );
      return exists
        ? `${CONTRACT_SCHEMA}.${name}: declared share reader exists but is not executable by anon`
        : `${CONTRACT_SCHEMA}.${name}: declared share reader does not exist in the migrations`;
    });

  return { unexpected, missing };
}

/* -------------------------------------------------------------------------
 * The token triple — three rules, because they fail independently
 * ---------------------------------------------------------------------- */

/** The routine's body with `select … for update` locking clauses removed. */
function bodyWithoutLockClauses(routine: FunctionDefinition): string {
  return routine.body.replace(/\bfor\s+(?:no\s+key\s+)?update\b/g, " ");
}

/**
 * **Rule 1 of 3.** The grant is looked up by *hash*, and the bearer token is
 * never compared against a column holding it in the clear.
 *
 * Separate from expiry and revocation because it fails on its own and for its
 * own reason: this one is about what a database leak costs. If the row holds
 * the token, reading the table *is* holding every live grant.
 */
export function tokenHashIssues(routine: FunctionDefinition): string[] {
  const issues: string[] = [];
  const body = routine.body;
  const where = routine.identity;

  const hashes = /\b(?:digest|sha256|sha512|hmac|crypt|encode)\s*\(/.test(body);
  if (!hashes) {
    issues.push(
      `${where}: never hashes the token — a lookup that does not hash is a ` +
        `lookup against a plaintext secret`
    );
  }
  if (!new RegExp(`\\b${SHARE_TOKEN_HASH_COLUMN}\\b`).test(body)) {
    issues.push(
      `${where}: does not compare against ${SHARE_TOKEN_HASH_COLUMN}`
    );
  }
  for (const column of PLAINTEXT_TOKEN_COLUMNS) {
    // `token_hash` is not `token`: `\b` will not match across the underscore,
    // so the hash column cannot be mistaken for the plaintext one.
    const compared = new RegExp(
      `\\b${column}\\s*=|=\\s*(?:[a-z0-9_]+\\.)?${column}\\b`
    );
    if (compared.test(body)) {
      issues.push(
        `${where}: compares a plaintext token column \`${column}\` — the ` +
          `stored value must be a hash, never the bearer secret`
      );
    }
  }
  return issues;
}

/**
 * **Rule 2 of 3.** The grant's `expires_at` is tested.
 *
 * SHR-08: "Every grant … SHALL carry an expiry". A column nobody reads is not
 * an expiry, it is a comment. Requires the column to appear in a comparison,
 * not merely to appear — the F1 lesson, one surface over.
 */
export function expiryCheckIssues(routine: FunctionDefinition): string[] {
  const body = bodyWithoutLockClauses(routine);
  const column = GRANT_EXPIRY_COLUMN;
  const compared =
    new RegExp(`\\b${column}\\b\\s*(?:>|<|>=|<=|is\\b)`).test(body) ||
    new RegExp(`(?:>|<|>=|<=)\\s*(?:[a-z0-9_]+\\.)?${column}\\b`).test(body);
  if (compared) return [];
  return [
    `${routine.identity}: does not test ${column} — ` +
      (new RegExp(`\\b${column}\\b`).test(body)
        ? `the column is mentioned but never compared`
        : `an expiry nothing reads is not an expiry (SHR-08)`),
  ];
}

/**
 * **Rule 3 of 3, and the one most likely to be the real defect.** The grant's
 * `revoked_at` is tested.
 *
 * SHR-08: revocation "SHALL take effect on the next request and SHALL never be
 * gated by payment, by plan, or by any other condition". A reader that
 * validates the hash and checks the expiry and skips this is a grant that
 * **cannot be revoked** — and it passes every hand-test, because a grant you
 * have not revoked behaves identically either way. Its own finding for exactly
 * that reason: merged into the other two, a green expiry check would carry it.
 */
export function revocationCheckIssues(routine: FunctionDefinition): string[] {
  const body = bodyWithoutLockClauses(routine);
  const column = GRANT_REVOCATION_COLUMN;
  const compared =
    new RegExp(`\\b${column}\\b\\s*is\\s+(?:not\\s+)?null\\b`).test(body) ||
    new RegExp(`\\b${column}\\b\\s*(?:>|<|>=|<=)`).test(body) ||
    new RegExp(`(?:>|<|>=|<=)\\s*(?:[a-z0-9_]+\\.)?${column}\\b`).test(body) ||
    new RegExp(`\\bcoalesce\\s*\\([^)]*\\b${column}\\b`).test(body);
  if (compared) return [];
  return [
    `${routine.identity}: does not test ${column} — ` +
      `a grant that cannot be revoked (SHR-08)`,
  ];
}

/* -------------------------------------------------------------------------
 * Column projection, not row projection
 * ---------------------------------------------------------------------- */

/**
 * Words that follow a table name in a `from`/`join` clause and are **not** an
 * alias. Without this list, `from public.records where …` reads `where` as the
 * alias and the whole-row rules start hunting for `where.*`.
 */
const NOT_AN_ALIAS = new Set([
  "where",
  "on",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "outer",
  "cross",
  "natural",
  "lateral",
  "group",
  "order",
  "limit",
  "offset",
  "having",
  "union",
  "using",
  "returning",
  "select",
  "and",
  "or",
  "as",
  "into",
  "for",
  "loop",
  "with",
  "intersect",
  "except",
  "fetch",
  "window",
  "values",
  "distinct",
  "tablesample",
  "end",
  "then",
  "else",
  "when",
  "case",
  "is",
  "not",
  "null",
  "returns",
  "begin",
  "declare",
]);

/** Words that may precede a relation in a `from` item, and are not the relation. */
const RELATION_PREFIXES = new Set(["lateral", "only"]);

function skipSpace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

/** The `[schema.]name` or bare identifier at `index`, unquoted. */
function readReference(
  text: string,
  index: number
): { readonly word: string; readonly next: number } {
  const match = /^[a-z0-9_."]+/.exec(text.slice(index));
  if (!match) return { word: "", next: index };
  return { word: match[0].replace(/"/g, ""), next: index + match[0].length };
}

/**
 * Read ONE relation of a `from`/`join` list, binding whatever name the rest of
 * the query would use to refer to its rows.
 *
 * Returns the index just past the relation, or `null` when there is no
 * relation here — which is how the comma loop knows to stop.
 */
function readRelation(
  body: string,
  index: number,
  aliases: Set<string>
): number | null {
  let cursor = skipSpace(body, index);

  // `lateral (…)`, `only public.t`
  for (;;) {
    const prefix = readReference(body, cursor);
    if (!RELATION_PREFIXES.has(prefix.word)) break;
    cursor = skipSpace(body, prefix.next);
  }

  let bound: string | null = null;
  if (body[cursor] === "(") {
    // A subquery or a parenthesised join. Its own `from` is found separately
    // by the scan below; what matters here is the alias the outer query uses.
    const group = balancedAt(body, cursor);
    if (!group) return null;
    cursor = skipSpace(body, group.close + 1);
  } else {
    const relation = readReference(body, cursor);
    if (!relation.word) return null;
    bound = relation.word.split(".").pop() ?? relation.word;
    cursor = skipSpace(body, relation.next);
  }

  // An explicit `as` is not itself the alias.
  const maybeAs = readReference(body, cursor);
  if (maybeAs.word === "as") cursor = skipSpace(body, maybeAs.next);

  const maybeAlias = readReference(body, cursor);
  if (
    maybeAlias.word &&
    !NOT_AN_ALIAS.has(maybeAlias.word) &&
    /^[a-z_][a-z0-9_]*$/.test(maybeAlias.word)
  ) {
    bound = maybeAlias.word;
    cursor = maybeAlias.next;
    // A column alias list — `f(x) as t(a, b)` — belongs to the alias, not to
    // the next relation.
    const afterAlias = skipSpace(body, cursor);
    if (body[afterAlias] === "(") {
      const group = balancedAt(body, afterAlias);
      if (group) cursor = group.close + 1;
    }
  }

  if (bound) aliases.add(bound);
  return cursor;
}

/**
 * The row aliases a query body binds — `from public.records r` → `r`,
 * `from public.records` → `records`.
 *
 * Needed because whole-row projection is spelled *through* an alias, and the
 * only way to tell `to_jsonb(r)` (the entire row) from `to_jsonb(payload)` (a
 * column) is to know which names are rows. **A name this misses is a whole row
 * that leaves the database unexamined**, so it errs toward binding too much:
 * an over-bound name can only cause a false finding, and an under-bound one
 * causes silence.
 *
 * ## Two defects this replaces (round-2 review, D2 — both confirmed, not theoretical)
 *
 * The first version was one regex —
 * `\b(?:from|join)\s+(?:(\w+)\.)?(\w+)(?:\s+(?:as\s+)?(\w+))?` — and it under-bound
 * in two ways that each let a whole row through:
 *
 * ```sql
 * -- 1. COMMA JOINS. Only `from` and `join` introduce a relation to that regex,
 * --    so the second relation of a comma list was never bound at all:
 * select to_jsonb(s) from public.records r, public.shares s …
 * --    bound {r}; `to_jsonb(s)` — the whole grants row, token hash included —
 * --    produced ZERO findings.
 *
 * -- 2. AN UNALIASED FIRST RELATION. The optional alias group happily matched
 * --    the word `join`, consuming it, so the scan never saw the second
 * --    relation as a join at all:
 * select to_jsonb(s) from public.records join public.shares s on …
 * --    bound {records} and nothing else.
 * ```
 *
 * So the `from` list is now *parsed* rather than pattern-matched: split on
 * top-level commas, each item read as an optional prefix, a relation or a
 * parenthesised subquery, an optional `as`, and an alias that is refused if it
 * is a keyword. Every `from` and `join` in the body is scanned, at any nesting
 * depth, so a subquery's own relations are bound too.
 */
export function rowAliases(body: string): string[] {
  const aliases = new Set<string>();

  for (const keyword of body.matchAll(/\b(from|join)\b/g)) {
    let cursor = keyword.index + keyword[0].length;
    for (;;) {
      const next = readRelation(body, cursor, aliases);
      if (next === null) break;
      cursor = next;
      // `join` takes exactly one relation; only a `from` list continues.
      if (keyword[1] === "join") break;
      const afterItem = skipSpace(body, cursor);
      if (body[afterItem] !== ",") break;
      cursor = afterItem + 1;
    }
  }

  return [...aliases];
}

/**
 * Functions that serialise an entire row into one value.
 *
 * Every one of these turns "name your columns" into a formality: the output is
 * the row, whatever the row happens to contain today.
 */
const ROW_SERIALIZERS = [
  "to_jsonb",
  "to_json",
  "row_to_json",
  "jsonb_agg",
  "json_agg",
  "array_agg",
  "row",
];

/**
 * An anon-reachable routine must name the columns it returns.
 *
 * > **SHR-06** WHERE a grant does not open costs, THE data returned SHALL omit
 * > the cost fields entirely rather than blanking them at render time.
 *
 * `select *` and `returns setof public.records` both make that impossible to
 * honour: the shape is the table's shape, so every column the table gains
 * later — a cost, a note, a private flag — is served to every grant holder
 * from the moment the migration lands, with no diff in the function at all.
 * The rule is about *columns*; RLS and the token checks are about rows, and
 * neither says anything about width.
 *
 * ## Why a literal `*` is not the whole rule (round-2 review, F3)
 *
 * The first version tested for `*` and nothing else, so **every** whole-row
 * spelling walked past it and the full `anonSurfaceIssues` sweep returned
 * zero findings:
 *
 * ```sql
 * select to_jsonb(r) from public.records r …   -- every column, as JSON
 * select row_to_json(r) …                      -- same
 * select jsonb_agg(r) …                        -- same, aggregated
 * select r.* …                                 -- same, spelled out
 * select r from public.records r …             -- same, as a composite
 * ```
 *
 * That is a bypass *easier to write* than the thing the rule caught — and it
 * is precisely the single-JSON-reader shape that `contract.ts`'s three-reader
 * note argues against, which means the architecture argument was resting on a
 * rule that did not enforce it. So the rule now asks the real question: does
 * anything here hand back a whole row, however it is spelled.
 */
export function projectionIssues(routine: FunctionDefinition): string[] {
  const issues: string[] = [];
  const where = routine.identity;
  const body = routine.body;
  const explain =
    `an anon-reachable routine must name its columns, or every column the ` +
    `table gains later is served with it (SHR-06)`;

  if (/\bselect\s+(?:distinct\s+)?(?:[a-z0-9_]+\.)?\*/.test(body)) {
    issues.push(`${where}: selects \`*\` — ${explain}`);
  }

  for (const alias of rowAliases(body)) {
    // `r.*` anywhere, not just directly after `select` — it is just as whole
    // inside `jsonb_build_object('r', r.*)` or a function argument.
    if (new RegExp(`\\b${alias}\\.\\*`).test(body)) {
      issues.push(`${where}: references \`${alias}.*\` — ${explain}`);
    }
    // A whole-row serialiser applied to the alias.
    const serializer = new RegExp(
      `\\b(${ROW_SERIALIZERS.join("|")})\\s*\\(\\s*${alias}(?:\\.\\*)?\\s*\\)`
    ).exec(body);
    if (serializer) {
      issues.push(
        `${where}: \`${serializer[1]}(${alias})\` serialises the whole row — ${explain}`
      );
    }
    // A bare alias in the select list is the composite row itself.
    if (
      new RegExp(
        `\\bselect\\s+(?:distinct\\s+)?${alias}\\s*(?:,|\\bfrom\\b|$)`
      ).test(body)
    ) {
      issues.push(`${where}: selects the bare row \`${alias}\` — ${explain}`);
    }
  }

  const setof = /\bsetof\s+(?:public\.)?([a-z0-9_]+)/.exec(
    `${routine.returns} ${routine.header}`
  );
  if (setof && USER_TABLE_NAMES.includes(setof[1])) {
    issues.push(
      `${where}: returns \`setof ${setof[1]}\` — the return shape is the ` +
        `whole user table, so cost fields cannot be omitted (SHR-06)`
    );
  }
  return issues;
}

/**
 * An anon-reachable routine must not write.
 *
 * > **SHR-07** THE holder of a grant SHALL NOT be required to have an account,
 * > and the accountless path SHALL be read-only. WHILE a request carries no
 * > authenticated session, no grant SHALL admit any write.
 *
 * Read literally: the property is of the *path*, so it is graded on the path —
 * every routine an anonymous caller can execute — rather than on the three
 * this file happens to name.
 */
export function anonWriteIssues(routine: FunctionDefinition): string[] {
  const body = bodyWithoutLockClauses(routine);
  const writes = [
    ["insert", /\binsert\s+into\b/],
    ["update", /\bupdate\s+(?:only\s+)?[a-z0-9_"]+\s+set\b/],
    ["delete", /\bdelete\s+from\b/],
    ["truncate", /\btruncate\b/],
    ["ddl", /\b(?:create|drop|alter)\s+(?:table|view|function|policy|role)\b/],
  ] as const;
  return writes
    .filter(([, pattern]) => pattern.test(body))
    .map(
      ([verb]) =>
        `${routine.identity}: anon-reachable routine performs a ${verb} — ` +
        `the accountless path is read-only (SHR-07)`
    );
}

/**
 * Every finding against the routines an anonymous caller can execute.
 *
 * The sweep that makes the rules above apply to whatever T2-404 actually
 * ships, rather than to the three names this repo currently guesses at. It is
 * vacuous today — nothing is anon-reachable — and that vacuity is itself
 * pinned, by the `missing` half of the allow-list going red until the readers
 * exist.
 */
export function anonSurfaceIssues(normalized: string): string[] {
  return anonExecutableFunctions(normalized).flatMap((routine) => [
    ...projectionIssues(routine),
    ...anonWriteIssues(routine),
    ...tokenHashIssues(routine),
    ...expiryCheckIssues(routine),
    ...revocationCheckIssues(routine),
    ...(routine.securityDefiner && routine.searchPath === null
      ? [`${routine.identity}: security definer with no \`set search_path\``]
      : []),
  ]);
}

/* -------------------------------------------------------------------------
 * DEFECT FIX (1) — the end-state ACL, not a count of revokes
 * ---------------------------------------------------------------------- */

/**
 * Every finding against the **end-state** privileges on the named user tables.
 *
 * Replaces a grader that counted `revoke … from anon` statements and asserted
 * the count was above zero. A directory containing
 *
 * ```sql
 * revoke all on public.records from anon;
 * grant select on public.records to anon;
 * ```
 *
 * scored 1 and passed — verified 2026-08-31. The count answers "was a revoke
 * written", which is not a security property; this answers "who can reach the
 * table when the migrations finish", which is.
 *
 * Three findings, all of which are one wrong line away:
 *
 * - an anonymous role holding **anything**;
 * - an ACL the text never emptied, so an inherited Supabase grant may survive
 *   (`"unknown"` — the shape of T2-202's near-miss, where nobody granted the
 *   privilege that nearly shipped the hole);
 * - `authenticated` holding more than the four verbs the schema means to give
 *   it. `TRUNCATE` is the one that matters and the one RLS does not filter.
 */
export function tableGrantIssues(
  normalized: string,
  tables: readonly string[]
): string[] {
  const state = grants(normalized);
  const issues: string[] = [];
  const expected = ["select", "insert", "update", "delete"];

  for (const table of tables) {
    const identity = `public.${table}`;

    for (const role of ANONYMOUS_ROLES) {
      const held = rolePrivileges(state, identity, role);
      if (held.verdict === "granted") {
        issues.push(
          `${identity}: ${role} holds ${held.privileges.join(", ")} at the ` +
            `end of the migrations`
        );
      } else if (held.verdict === "unknown") {
        issues.push(
          `${identity}: nothing revokes ${role}'s inherited privileges — the ` +
            `end-state ACL is unknown, and Supabase grants on public by default`
        );
      }
    }

    const authenticated = rolePrivileges(state, identity, "authenticated");
    if (authenticated.verdict === "unknown") {
      issues.push(
        `${identity}: nothing revokes authenticated's inherited privileges ` +
          `before granting — a grant adds to an ACL, it does not replace it`
      );
      continue;
    }
    const extra = authenticated.privileges.filter(
      (privilege) => !expected.includes(privilege)
    );
    if (extra.length > 0) {
      issues.push(
        `${identity}: authenticated holds ${extra.join(", ")} beyond ` +
          `select/insert/update/delete — RLS does not filter truncate`
      );
    }
  }
  return issues;
}

/**
 * Every view in `public` must be created `with (security_invoker = true)`.
 *
 * ## The same hole class as a definer function, one object type over
 *
 * A view runs its query as the view's **owner** unless told otherwise, so RLS
 * on the underlying tables is evaluated against the owner and not against the
 * caller. A `public` view over `records` without this option is a
 * `security definer` function with nicer syntax: `force row level security`,
 * every owner-scoped predicate in this file, and `revoke all … from anon` all
 * stop applying to the rows it returns.
 *
 * **The default is the unsafe direction.** `security_invoker` was added in
 * PG15 and defaults to `false`, so a view is owner-executing unless somebody
 * remembered a clause that did not exist a few releases ago. That is exactly
 * the shape of invariant that needs a grader rather than a habit — the same
 * argument as `force row level security`, which is the other option whose
 * default is the wrong one.
 *
 * Vacuous today (no migration creates a view) and it starts paying the day one
 * does. `viewGrantIssues` already covers the privilege half of this surface;
 * this is the half that matters even when the grants are right, because a view
 * `authenticated` may legitimately select from still must not hand that caller
 * another owner's rows.
 */
export function viewSecurityInvokerIssues(normalized: string): string[] {
  const issues: string[] = [];
  for (const view of createdViews(normalized)) {
    if (
      !/\bwith\s*\([^)]*\bsecurity_invoker\s*=\s*(?:true|on)\b/.test(
        view.statement
      )
    ) {
      issues.push(
        `${view.identity}: created without \`with (security_invoker = true)\` — ` +
          `the view runs as its owner, so RLS on the underlying tables is ` +
          `evaluated against the owner and not the caller`
      );
    }
  }
  return issues;
}

/** Every finding against the privileges on views in `public`. */
export function viewGrantIssues(normalized: string): string[] {
  const state = grants(normalized);
  const issues: string[] = [];
  for (const view of createdViews(normalized)) {
    for (const role of ANONYMOUS_ROLES) {
      const held = rolePrivileges(state, view.identity, role);
      if (held.verdict === "granted") {
        issues.push(
          `${view.identity}: ${role} holds ${held.privileges.join(", ")} on a view`
        );
      }
    }
  }
  return issues;
}

/* -------------------------------------------------------------------------
 * DEFECT FIX (2) — what exists, cross-checked against what is enumerated
 * ---------------------------------------------------------------------- */

/**
 * Every finding against a table that exists but nothing grades.
 *
 * The constitution says *every* user table ships with RLS proven by graders.
 * Every table-level grader in this suite is driven from `USER_TABLE_NAMES`, so
 * before this, "every" meant "these four": a `shares` table with
 * `for all to anon using (true)` and no `force` produced zero findings —
 * verified 2026-08-31.
 *
 * The sweep runs the other way. It starts from `createdTables()` — what the
 * directory actually leaves behind — and reports anything neither enumerated
 * in `USER_TABLES` nor named in `EXEMPT_PUBLIC_TABLES`, in the style of
 * `check-hreflang.mjs`'s `EXEMPT_PAGES`: an exemption is a decision with a
 * reason attached, and everything else is a bug.
 *
 * RLS is checked on **every** created table, enumerated or not. A table nobody
 * added to the contract is exactly the table whose `force` was forgotten, and
 * making the RLS finding conditional on enumeration would put the check behind
 * the door it exists to open.
 */
export function ungradedTableIssues(
  normalized: string,
  options: {
    readonly enumerated?: readonly string[];
    readonly exempt?: ReadonlyMap<string, string>;
  } = {}
): string[] {
  const enumerated = options.enumerated ?? USER_TABLE_NAMES;
  const exempt = options.exempt ?? EXEMPT_PUBLIC_TABLES;
  const issues: string[] = [];

  for (const table of createdTables(normalized)) {
    const exemptReason = exempt.get(table.name);
    if (!enumerated.includes(table.name) && exemptReason === undefined) {
      issues.push(
        `${table.identity}: created but not enumerated in USER_TABLES and not ` +
          `named in EXEMPT_PUBLIC_TABLES — no grader knows it exists`
      );
    }
    if (exemptReason !== undefined) continue;

    if (!enablesRls(normalized, table.name)) {
      issues.push(`${table.identity}: row level security is not enabled`);
    }
    if (!forcesRls(normalized, table.name)) {
      issues.push(
        `${table.identity}: row level security is not FORCED — the owner role ` +
          `is exempt, and migrations run as the owner`
      );
    }
  }
  return issues;
}

/**
 * Every finding against a table column that stores a bearer secret in the clear.
 *
 * A sweep over every created table rather than over a named `shares` table:
 * the claim is that nothing anywhere holds a share token in plaintext, and
 * naming the table would narrow it to a claim about one table's spelling.
 */
export function plaintextTokenColumnIssues(normalized: string): string[] {
  const issues: string[] = [];
  for (const table of createdTables(normalized)) {
    const body = createTableBody(normalized, table.name);
    if (!body) continue;
    for (const column of columnDefinitions(body)) {
      if (!PLAINTEXT_TOKEN_COLUMNS.includes(column.name as never)) continue;
      issues.push(
        `${table.identity}.${column.name}: a share token stored in the clear — ` +
          `store ${SHARE_TOKEN_HASH_COLUMN} instead, so reading the table is ` +
          `not holding every live grant`
      );
    }
  }
  return issues;
}

/* -------------------------------------------------------------------------
 * T2-401 — the typed-grant rules (SHR-05, SHR-06, SHR-08)
 * ---------------------------------------------------------------------- */

/**
 * The preset must be a **label**, never a branch.
 *
 * > **SHR-05** A grant SHALL carry a `kind` naming its preset (`mechanic`,
 * > `buyer`), and the preset SHALL be **a label over explicit capability
 * > fields, never a branch in consuming code**.
 *
 * The requirement is unusually specific about a mechanism, and the reason is
 * worth stating: a reader that says `if kind = 'mechanic' then …` has made the
 * label load-bearing and the capability columns decorative. Adding a third
 * preset then means editing every reader — and, far worse, a grant whose
 * capability columns say one thing and whose `kind` says another resolves to
 * whatever the branch decided. Two sources of truth for one permission.
 *
 * So an anon-reachable routine may **return** `kind` (to show the holder what
 * they were given) but must not **compare** it to anything.
 */
export function presetBranchIssues(routine: FunctionDefinition): string[] {
  const body = routine.body;
  const issues: string[] = [];
  const comparisons = [
    /\bkind\s*(?:=|<>|!=)\s*'/,
    /\bkind\s+in\s*\(/,
    /\bcase\s+(?:[a-z0-9_]+\.)?kind\b/,
    /\bwhen\s+(?:[a-z0-9_]+\.)?kind\s*=/,
  ];
  if (comparisons.some((pattern) => pattern.test(body))) {
    issues.push(
      `${routine.identity}: branches on the grant's \`kind\` — SHR-05 makes ` +
        `the preset a label over the capability columns, never a branch; two ` +
        `sources of truth for one permission is one too many`
    );
  }
  // The other direction of the same mistake: a preset name hard-coded inside
  // an access decision, without the word `kind` appearing beside it.
  for (const preset of SHARE_GRANT_KINDS) {
    if (new RegExp(`'${preset}'`).test(body)) {
      issues.push(
        `${routine.identity}: names the preset '${preset}' in its body — the ` +
          `capability columns decide, not the label (SHR-05)`
      );
    }
  }
  return issues;
}

/**
 * A grant's capabilities are two independent decisions, and both are gated.
 *
 * > **SHR-06** Capabilities SHALL be scoped per grant and SHALL **open
 * > independently**: costs and receipts are two decisions, not one.
 *
 * Deliberately narrow, because the interesting half of SHR-06 is not statically
 * decidable — a fully-named `jsonb_build_object` that includes the cost columns
 * is textually indistinguishable from legitimate projection, which T2-401a
 * recorded as the limit of the projection rule. What *is* decidable:
 *
 * - a routine that returns a cost column must **test** `includes_costs`;
 * - a routine that returns receipt data must **test** `includes_receipts`;
 * - and neither test may stand behind the other — `includes_receipts` reachable
 *   only when `includes_costs` is also true is the two-decisions-collapsed
 *   defect, written in SQL.
 *
 * "Test" means compared, not merely selected — the same distinction
 * `expiryCheckIssues` draws, and for the same reason: a column that is returned
 * and never compared is a comment.
 */
export function capabilityGateIssues(routine: FunctionDefinition): string[] {
  const body = routine.body;
  const issues: string[] = [];
  const tests = (column: string): boolean =>
    new RegExp(
      `(?:[a-z0-9_]+\\.)?${column}\\s*(?:=|is\\s+(?:not\\s+)?true)` +
        `|\\band\\s+(?:[a-z0-9_]+\\.)?${column}\\b(?!\\s*,)` +
        `|\\bwhere\\s+(?:[a-z0-9_]+\\.)?${column}\\b(?!\\s*,)`
    ).test(body);

  const mentionsCosts = /\bcost_amount\b|\bcost_currency\b/.test(body);
  if (mentionsCosts && !tests("includes_costs")) {
    issues.push(
      `${routine.identity}: returns cost columns without testing ` +
        `\`includes_costs\` — SHR-06 says the fields are omitted entirely ` +
        `where the grant does not open them`
    );
  }

  const mentionsReceipts = /\bstorage_path\b|\bpublic\.receipts\b/.test(body);
  if (mentionsReceipts && !tests("includes_receipts")) {
    issues.push(
      `${routine.identity}: returns receipt data without testing ` +
        `\`includes_receipts\` — receipts open independently of costs (SHR-06)`
    );
  }

  if (
    mentionsReceipts &&
    !mentionsCosts &&
    /includes_costs[\s\S]{0,80}\band\b[\s\S]{0,30}includes_receipts|includes_receipts[\s\S]{0,30}\band\b[\s\S]{0,80}includes_costs/.test(
      body
    )
  ) {
    issues.push(
      `${routine.identity}: gates receipts behind \`includes_costs\` as well ` +
        `— SHR-06 makes them two decisions, not one`
    );
  }

  // ## One routine cannot serve both capabilities. Ever. (second review)
  //
  // The first version of this rule guarded the clause above with
  // `!mentionsCosts` and called the gap a *stated limit*: a routine returning
  // cost columns and receipt data was said to be off-architecture, and
  // therefore somebody else's problem. **That was wrong, and the review proved
  // it** — a reader with the contract's own approved name,
  // `public.share_read_receipts`, returning `(id, cost_amount, storage_path)`
  // behind `includes_costs = true and includes_receipts = true`, produced zero
  // findings from every Tier A rule. The closed allow-list checks the function
  // *name*; it has nothing to say about an extra column.
  //
  // It is not a heuristic either, which is why it is a rule rather than a
  // caveat. A single query has **one** predicate governing **one** result set,
  // so for the two mixed grants there is no correct form:
  //
  // - gated `costs AND receipts` → a `costs=false receipts=true` grant gets
  //   nothing, and SHR-06 says receipts open independently;
  // - gated `costs OR receipts`  → one of them is served to a grant that did
  //   not open it, which is the leak;
  // - gated on neither           → clauses 1 and 2 above already fire.
  //
  // So the shape is unsatisfiable, and `SHARE_READER_FUNCTIONS`' three entry
  // points are not a style preference but the only arrangement that can honour
  // the requirement. This makes the omission structural, which is what the
  // contract claimed all along.
  if (mentionsCosts && mentionsReceipts) {
    issues.push(
      `${routine.identity}: returns cost columns AND receipt data from one ` +
        `routine — SHR-06 opens the two independently, and a single query has ` +
        `one predicate for one result set, so no gating of it can serve a ` +
        `grant that opens receipts but not costs. Split it, as ` +
        `SHARE_READER_FUNCTIONS does`
    );
  }
  return issues;
}

/**
 * The refusal must not be an existence oracle — the **Tier A smell check**.
 *
 * > **SHR-08** IF a grant is expired, revoked, or unknown, THEN the refusal
 * > SHALL be **indistinguishable across all three cases** — same status, same
 * > body, same shape — so that the surface is not an existence oracle.
 *
 * ## What this can and cannot claim
 *
 * It **cannot** prove the property. Indistinguishability is behavioural — it is
 * about status codes and response bodies over the wire — and the real proof is
 * in `share-grants.test.ts`'s Tier B cells, which put all three refusals side
 * by side and compare them. T2-401a's hand-off asked for the pair, explicitly
 * never the substitute.
 *
 * What it **can** do is catch the likeliest mistake on every PR with no Docker:
 * a body that raises more than one distinct message, or whose refusal text
 * names which of the three cases it hit.
 */
export function refusalShapeIssues(routine: FunctionDefinition): string[] {
  const body = routine.body;
  const issues: string[] = [];

  const raised = [
    ...body.matchAll(
      /\braise\s+(?:[a-z_]+\s+)?(?:using\s+message\s*=\s*)?'([^']*)'/g
    ),
  ].map((match) => match[1]);
  const distinct = [...new Set(raised)];
  if (distinct.length > 1) {
    issues.push(
      `${routine.identity}: raises ${distinct.length} distinct messages ` +
        `(${distinct.map((message) => `"${message}"`).join(", ")}) — SHR-08 ` +
        `requires one refusal, not a taxonomy of them`
    );
  }

  // ## Scoped to the raised MESSAGES, not to the body (T2-401 probe G21)
  //
  // The first version scanned the whole body, and the accept-case control
  // caught it immediately: `if not found then raise …` is plpgsql's built-in
  // `FOUND` variable, the idiomatic way to test a `select … into`, and it
  // appears in every correct implementation of this routine. A rule that
  // reported on it would have fired on the one shape the requirement actually
  // wants, which is precisely how a security rule gets deleted rather than
  // fixed. The rule is about what the *caller is told*, so it reads what the
  // caller is told.
  for (const message of distinct) {
    const telling =
      /\b(expired|revoked|not found|no such|unknown token|already used)\b/.exec(
        message
      );
    if (!telling) continue;
    issues.push(
      `${routine.identity}: its refusal text says "${telling[1]}" — that is ` +
        `an existence oracle, and SHR-08 forbids distinguishing the three cases`
    );
  }
  return issues;
}

/**
 * Revocation is never gated. On anything.
 *
 * > **SHR-08** … Revocation SHALL take effect on the next request and SHALL
 * > **never be gated by payment, by plan, or by any other condition**.
 * > **003 MON-02** Revocation SHALL never be gated.
 *
 * "Any other condition" is the load-bearing phrase, so this is a deny-list of
 * what a revoke path must not consult rather than an allow-list of what it may:
 * the moment a `subscriptions` or `entitlements` table exists (003 MON-08),
 * joining it here is one line and reads like prudence.
 */
export function revocationGatingIssues(routine: FunctionDefinition): string[] {
  const forbidden = [
    "subscription",
    "entitlement",
    "plan_id",
    "billing",
    "stripe",
    "customer_id",
    "quota",
  ];
  return forbidden
    .filter((token) => new RegExp(`\\b${token}`).test(routine.body))
    .map(
      (token) =>
        `${routine.identity}: consults \`${token}\` — revocation is never ` +
        `gated by payment, by plan, or by any other condition (SHR-08, ` +
        `003 MON-02)`
    );
}

/**
 * `alter default privileges … grant … to anon|public` is banned outright.
 *
 * T2-401a's recorded hand-off (F5): `grants()` already parses and replays every
 * ADP statement, and the graders read the **revoke** half. Nothing rejected the
 * grant half — one line in one migration that hands every *future* object in
 * the schema to an anonymous caller, and the one privilege change that leaves
 * no trace on any object existing today, so neither the created-table sweep nor
 * the function sweep can see it.
 *
 * `live-acl.test.ts`'s birth probe catches the same class behaviourally, by
 * looking at what a new table is actually born holding. Both, deliberately:
 * this half runs on every PR with no Docker.
 */
export function defaultPrivilegeGrantIssues(normalized: string): string[] {
  return grants(normalized)
    .defaultPrivileges.filter(
      (record) =>
        record.action === "grant" &&
        record.roles.some((role) =>
          (ANONYMOUS_ROLES as readonly string[]).includes(role)
        )
    )
    .map(
      (record) =>
        `alter default privileges … grant on ${record.objectType} to ` +
        `${record.roles.join(", ")} — every FUTURE object in the schema, ` +
        `handed to an anonymous caller by one line, with no trace on any ` +
        `object that exists today`
    );
}

/* -------------------------------------------------------------------------
 * T2-401 — blind spot (b): correlation is not the same as a correct join
 * ---------------------------------------------------------------------- */

/**
 * Every finding against a policy that correlates **textually** but not **by
 * key**.
 *
 * ## The blind spot, and what verifying it actually showed
 *
 * `isOwnerScoped` asks whether a subquery *mentions* the outer row
 * (`isCorrelated`, the D1 rule). It cannot ask whether the mention is a
 * **join**. So this predicate passes the whole declaration tier intact:
 *
 * ```sql
 * using (
 *   exists (
 *     select 1 from public.vehicles v
 *      where records.vehicle_id is not null      -- mentions the outer row
 *        and v.owner_id = (select auth.uid())    -- compares to the caller
 *   )
 * )
 * ```
 *
 * The T2-202 review recorded this as a blind spot and recorded a belief
 * alongside it: that RLS on `vehicles` applies inside the subquery, so a
 * nonsense join still could not reach another owner's row — "defence that was
 * inherited, not designed" — and asked T2-401 to **verify rather than rely on
 * it**.
 *
 * **Verified 2026-09-02 against the running database, and the belief is
 * false.** With that policy added, owner B read owner A's record. RLS on
 * `vehicles` does filter `v` to B's own vehicles — which is exactly why the
 * leak happens: `exists` becomes "does B own *any* vehicle", which is true, so
 * every row of `records` passes. The same is true of the shape the review
 * described literally, `exists (select 1 from public.vehicles v where
 * records.vehicle_id is not null)` — though that one has no `auth.uid()` in
 * the subquery at all and `isOwnerScoped` already rejects it.
 *
 * So there is no inherited defence. The declaration tier is the only thing
 * between the schema and that leak, and until this rule the declaration tier
 * could not see it. `policy-join-semantics.test.ts` holds the behavioural
 * proof; this is the Tier A half, and the two are deliberately redundant.
 *
 * ## What the rule requires
 *
 * When ownership rests on a subquery rather than on a comparison against the
 * row itself, the subquery must **equate the outer row's declared ownership
 * column to a column of the relation it reads** — `v.id = records.vehicle_id`,
 * with `vehicle_id` coming from `contract.ts`'s `ownershipPath`, not from a
 * guess. That is precise enough to reject both failing shapes above *and*
 * `v.id = records.id` — a join on the wrong pair of columns, which happens not
 * to leak today only because no vehicle id equals a record id.
 */
export function subqueryCorrelationIssues(
  normalized: string,
  tables: readonly string[]
): string[] {
  const issues: string[] = [];

  for (const policy of policies(normalized)) {
    if (!tables.includes(policy.table) || !policy.permissive) continue;
    const contract = USER_TABLES.find((entry) => entry.name === policy.table);
    const key = contract?.ownershipPath[0];
    if (key === undefined) continue;

    const clauses: [string, string | null][] = [
      ["using", policy.usingExpr],
      ["with check", effectiveCheck(policy)],
    ];

    for (const [clause, expr] of clauses) {
      if (expr === null) continue;
      const canonical = canonicalizeAuthUid(expr);
      const { outer, subqueries } = stripSubqueries(canonical);
      // A comparison against the row itself needs no join at all.
      if (authUidComparands(outer).length > 0) continue;
      if (subqueries.length === 0) continue;

      const qualified = `[a-z0-9_]+\\.[a-z0-9_]+`;
      const outerKey = `${policy.table}\\.${key}`;
      const correlates = new RegExp(
        `${qualified}\\s*=\\s*${outerKey}\\b|\\b${outerKey}\\s*=\\s*${qualified}`
      );
      if (subqueries.some((subquery) => correlates.test(subquery))) continue;

      issues.push(
        `${policy.table} policy "${policy.name}" (for ${policy.command}): ` +
          `\`${clause}\` rests on a subquery that never joins on ` +
          `${policy.table}.${key} — mentioning the outer row is not the same ` +
          `as joining to it, and RLS on the inner table does NOT save you ` +
          `(verified: owner B read owner A's record through exactly this shape)`
      );
    }
  }
  return issues;
}

/* -------------------------------------------------------------------------
 * T2-401 — the optimistic-default sweep, inverted
 * ---------------------------------------------------------------------- */

/**
 * Every boolean in the schema that defaults to **true**, unless it is named.
 *
 * ## The rule this replaces was name-shaped, and that is why it missed
 *
 * `sharing-default.test.ts` used to sweep for
 * `/(is_[a-z_]*(public|shared|visible)[a-z_]*)[^,)]*default true/`. It needed
 * three things at once — an `is_` prefix, one of three words in the middle, and
 * the default — which means it was not a sweep for optimistic defaults at all.
 * It was a sweep for *one naming convention* of optimistic default, and it
 * existed precisely to catch "a fifth flag this file does not know about" — the
 * flag nobody told it about being, by construction, the one that does not
 * follow the convention.
 *
 * Both of these walked straight past it, verified against the shipped rule:
 *
 * ```sql
 * includes_costs boolean not null default true   -- SHR-06, opens every cost
 * is_active      boolean not null default true   -- no `public|shared|visible`
 * ```
 *
 * The first is not hypothetical: it is a capability column this very task adds
 * to `shares`, and defaulting it to `true` would open every grant's costs to
 * every holder — SHR-06's exact prohibition — while the guard that exists to
 * notice reported nothing.
 *
 * ## So the question is inverted
 *
 * Every boolean column that defaults to true is a finding, and the exceptions
 * are enumerated with reasons in `contract.ts`'s
 * `OPTIMISTIC_BOOLEAN_DEFAULTS`. That direction cannot be dodged by a name,
 * because it does not read the name. SHR-01 says everything a user stores
 * defaults to private; a boolean that starts life `true` is a decision made on
 * the user's behalf, and if there is a good reason for one, the reason belongs
 * in a diff somebody reviews.
 *
 * Nullable columns are swept too, though the requirement names `not null`: a
 * nullable boolean defaulting to true is strictly worse, since it has the
 * optimistic default *and* a third state.
 */
export function optimisticBooleanDefaultIssues(
  normalized: string,
  allowed: ReadonlyMap<string, string>
): string[] {
  const issues: string[] = [];
  const explain =
    `SHR-01: everything a user stores defaults to private. If this default is ` +
    `right, name it in OPTIMISTIC_BOOLEAN_DEFAULTS with a reason`;

  for (const table of createdTables(normalized)) {
    const body = createTableBody(normalized, table.name);
    if (!body) continue;
    for (const column of columnDefinitions(body)) {
      if (!/\bbool/.test(column.definition)) continue;
      if (defaultExpression(column.definition) !== "true") continue;
      const key = `${table.name}.${column.name}`;
      if (allowed.has(key)) continue;
      issues.push(
        `${table.identity}.${column.name}: boolean defaulting to true — ${explain}`
      );
    }
  }

  // The second spelling, and the one a `create table` sweep cannot see: a
  // column created honest and flipped later. `alter table … alter column …
  // set default true` is one line in a migration nobody reads twice, and it
  // changes every row inserted after it.
  for (const statement of statements(normalized)) {
    const altered =
      /^alter table (?:if exists )?(?:only )?([a-z0-9_.]+) alter(?: column)? ([a-z0-9_]+) set default true\b/.exec(
        statement
      );
    if (!altered) continue;
    const table = altered[1].split(".").pop() ?? altered[1];
    const key = `${table}.${altered[2]}`;
    if (allowed.has(key)) continue;
    issues.push(
      `${altered[1]}.${altered[2]}: default flipped to true by a later ` +
        `\`alter table\` — ${explain}`
    );
  }
  return issues;
}
