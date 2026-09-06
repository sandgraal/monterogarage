/**
 * Graders — CONTRACT 5: the sharing surface is a **function** surface, and it
 * is graded like one.
 *
 * > **SHR-01** … Enforcement has exactly **three** modes and no fourth:
 * > row-level security scoped to `auth.uid()`; the public visibility columns of
 * > SHR-02; and the typed grants of SHR-05, whose checks live in
 * > `security definer` functions inside the database.
 * > — specs/002-montero-garage §5, as amended 2026-08-31
 *
 * ## Why this file exists, and why it lands before the feature does
 *
 * Everything else in `tests/garage/` grades tables and policies, which was the
 * whole attack surface while every route to user data went through PostgREST
 * and RLS. SHR-07 puts a reader on the far side of the database with no
 * `auth.uid()` at all, and the architecture that serves it — recorded for
 * T2-404, and the only one that keeps `output: "static"` and keeps the service
 * key out of the repo — is a `security definer` function granted to `anon`.
 *
 * A definer function runs as its **owner**. RLS on the tables it reads is not
 * consulted. `force row level security`, `revoke all … from anon`, every
 * owner-scoped predicate `rules.ts` exists to enforce: none of it applies
 * inside that function body. Whatever the body checks is the entire access
 * control, and before this file the repo had no grader that could see inside
 * one. `grep -rn "security definer" tests/` returned a single hit and it was a
 * comment; a definer function granted to `anon` doing
 * `select * from public.records` produced **zero findings**, verified by
 * running the real graders against exactly that.
 *
 * That is the situation T2-201 was written to end. Landing the graders first is
 * the only way it does not get re-entered, so this file describes a surface
 * that does not exist yet.
 *
 * ## What each half of the file is doing
 *
 * **The unmarked half is live today and protects the repo now.** The deny
 * direction of the allow-list — *nothing* is reachable by an anonymous caller
 * — is true of today's migrations and must stay true through T2-404. So are
 * the `search_path` sweep, the end-state ACL, and the created-table sweep.
 * These are not expectations about the future; they are assertions about the
 * present, and they go red the day someone loosens them.
 *
 * **The marked half is the expected failure.** Nine `it.fails` markers, one
 * per line, each describing one property of the grant readers T2-404 ships.
 * They fail today with `not implemented: T2-404` — deliberately, so the marker
 * is honest about what it is waiting for rather than green because a regex
 * matched nothing.
 *
 * ## Where the rules themselves are proved
 *
 * Not here. A test that fails because a function is missing proves nothing
 * about the rule it would have applied, so every rule in this file is graded
 * against DDL with a known answer in `reviewer-probes.test.ts` — the wide-open
 * variant must be rejected and the correct variant accepted, and that corpus
 * has been mutation-tested by breaking each rule on purpose and confirming it
 * goes red. This file points the instrument at the repo; that file proves the
 * instrument works.
 *
 * ## Tier A only
 *
 * Everything here parses migration text. No Docker, no network, runs on the
 * merge path forever. The behavioural half — that a real anonymous PostgREST
 * client gets nothing, and that an expired token and a revoked token and an
 * unknown token are indistinguishable (SHR-08) — is T2-401's, and it needs a
 * running stack to be worth anything.
 *
 * refs specs/002-montero-garage (SHR-01, SHR-05, SHR-06, SHR-07, SHR-08)
 */
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ROLES,
  CONTRACT_SCHEMA,
  EXEMPT_PUBLIC_TABLES,
  PRIVILEGED_FUNCTIONS,
  SHARE_READER_FUNCTIONS,
  SHARE_READER_NAMES,
  SHIPPED_USER_TABLES,
} from "./contract.ts";
import {
  anonFunctionAllowListIssues,
  anonSurfaceIssues,
  anonWriteIssues,
  definerSearchPathIssues,
  expiryCheckIssues,
  findShareReaders,
  isContractRoutine,
  plaintextTokenColumnIssues,
  projectionIssues,
  revocationCheckIssues,
  tableGrantIssues,
  tokenHashIssues,
  ungradedTableIssues,
  viewGrantIssues,
  viewSecurityInvokerIssues,
} from "./rules.ts";
import {
  createdTables,
  functions,
  grants,
  migrationSql,
  normalizeSql,
  privilegeVerdict,
  SEAM_SHARE_GRANTS,
  shareSeam,
  type FunctionDefinition,
} from "./sql.ts";

/**
 * The share readers, or the seam error naming the task that ships them.
 *
 * Every marked grader below goes through this, so each one fails with
 * `not implemented: T2-404` rather than with `undefined is not an object` —
 * the T2-201 discipline that makes an `it.fails` marker mean something.
 *
 * Resolution is by **schema and name** (`findShareReaders`), so a
 * `private.share_read_records` cannot satisfy the guard and hand the marked
 * graders below an object from a schema this contract never described
 * (PR #74 review).
 */
/**
 * Each of these takes the SQL as an argument, defaulting to the real
 * migrations.
 *
 * The default is what every grader below uses. The *argument* exists so the
 * self-check suite at the foot of this file can point them at a fixture: these
 * three are the file's own resolution layer, and while they read
 * `migrationSql()` and nothing else, no probe could reach them — the real
 * migrations contain no share readers and no second schema, so a
 * schema-scoping regression here would be invisible in both the scoped and the
 * unscoped spelling. Mutation-testing found exactly that (PR #74 review): the
 * rule in `rules.ts` was pinned, and the wiring to it was not.
 */
function requireShareReaders(
  normalized: string = migrationSql()
): FunctionDefinition[] {
  const { found, missing } = findShareReaders(normalized, SHARE_READER_NAMES);
  if (missing.length > 0) {
    throw shareSeam(
      `no function named ${missing.join(", ")} exists in supabase/migrations/`
    );
  }
  return found;
}

/** Every routine in the contract's schema bearing `name`. */
function contractRoutines(
  name: string,
  normalized: string = migrationSql()
): FunctionDefinition[] {
  return functions(normalized).filter((routine) =>
    isContractRoutine(routine, name)
  );
}

/** The names of every routine declared in the contract's schema. */
function contractRoutineNames(normalized: string = migrationSql()): string[] {
  return functions(normalized)
    .filter((routine) => routine.schema === CONTRACT_SCHEMA)
    .map((routine) => routine.name);
}

/* =========================================================================
 * The instrument, pointed at the repo as it stands
 *
 * Unmarked. These are assertions about today's migrations, and they are the
 * positive control for every parser the marked half depends on: if
 * `functions()` silently stopped finding anything, the marked graders would
 * still report "expected failure" in exactly the same words.
 * ====================================================================== */

describe("the function parser reads the migrations that exist", () => {
  it("finds the account-lifecycle and auth routines by name AND schema", () => {
    const found = contractRoutineNames();

    // Named rather than counted: T2-404 adds routines, and a grader that
    // asserted "exactly five" would have to be edited by the task it exists
    // to constrain. Scoped to the contract's schema so a same-named routine
    // somewhere else cannot stand in for one of these (PR #74 review).
    for (const { name } of PRIVILEGED_FUNCTIONS) {
      expect(found, `missing ${CONTRACT_SCHEMA}.${name}`).toContain(name);
    }
  });

  it("reads the argument signature the way a GRANT spells it", () => {
    // `create function purge_expired_accounts(p_now timestamptz default now())`
    // is granted by `grant execute on function … (timestamptz)`. If those two
    // did not resolve to one identity, every ACL finding would be about a
    // routine that does not exist.
    const [purge] = contractRoutines("purge_expired_accounts");

    expect(purge?.identity).toBe("public.purge_expired_accounts(timestamptz)");
  });

  it("distinguishes `security definer` from `security invoker`", () => {
    // If this collapsed, the search_path sweep below would be vacuous and
    // report green forever.
    const found = functions(migrationSql());
    const definers = found.filter((routine) => routine.securityDefiner);
    const definerNames = definers
      .filter((routine) => routine.schema === CONTRACT_SCHEMA)
      .map((routine) => routine.name);

    expect(definers.length).toBeGreaterThan(0);
    expect(found.length).toBeGreaterThan(definers.length);
    expect(definerNames).toContain("request_account_deletion");
    // ACC-01's password hook is `stable`, not `definer` — the invoker side.
    expect(definerNames).not.toContain("deny_password_login");
  });

  it("reads a body, not an empty string", () => {
    // A body-reading rule against an empty body is a rule that always passes.
    for (const routine of functions(migrationSql())) {
      expect(routine.body.length, routine.identity).toBeGreaterThan(0);
    }
  });
});

describe("every `security definer` routine pins its search path", () => {
  it("carries `set search_path = ''`", () => {
    // Codifies what T2-202 already does in all four of its functions. A
    // definer routine resolves unqualified names through the *caller's*
    // search path, so a caller who can create a schema can put their own
    // `records` ahead of `public.records` and have privileged code read it.
    expect(definerSearchPathIssues(migrationSql())).toEqual([]);
  });
});

/* =========================================================================
 * The closed allow-list
 * ====================================================================== */

describe("nothing an anonymous caller can execute is unaccounted for", () => {
  it("no routine outside the declared share readers is anon-executable", () => {
    // The deny half, and the half that is load-bearing *today*: it is true of
    // the current migrations and it is what T2-404 must not break. An
    // allow-list is only a guarantee when the complement is computed rather
    // than assumed — the standard `KNOWN_EXTERNAL_PROVIDERS` sets for auth
    // providers, applied to the function surface.
    //
    // "Executable" includes the case where the migration text simply does not
    // say: Postgres grants EXECUTE on a new function to PUBLIC by default, so
    // a routine nobody revoked is reachable by `anon` in the running database
    // while being silent in the file.
    expect(
      anonFunctionAllowListIssues(migrationSql(), SHARE_READER_NAMES).unexpected
    ).toEqual([]);
  });

  it.each(PRIVILEGED_FUNCTIONS.map((entry) => [entry.name, entry.why]))(
    "%s stays unreachable by an anonymous caller — %s",
    (name) => {
      // The enumerated deny half. The sweep above already catches these by
      // computing the complement; this names them, so the finding a reviewer
      // reads says which dangerous routine opened rather than "an unexpected
      // function". A name absent from the migrations is not a finding: this
      // asks what is true of the routines that exist.
      //
      // Matched on NAME ALONE, deliberately, and this is the one place in the
      // file that still is. Schema-scoping the *allow* direction closes a hole
      // (a `private` impostor passing as a declared reader); schema-scoping a
      // *deny* direction would open one, because a `private.purge_expired_
      // accounts` is exactly as dangerous as the public one. Over-matching here
      // can only add assertions, never drop them (PR #74 review).
      const state = grants(migrationSql());
      const matching = functions(migrationSql()).filter(
        (routine) => routine.name === name
      );

      for (const routine of matching) {
        for (const role of ANONYMOUS_ROLES) {
          expect(
            privilegeVerdict(state, routine.identity, role, "execute"),
            `${routine.identity} / ${role}`
          ).toBe("none");
        }
      }
    }
  );

  it("every anon-reachable routine satisfies the whole grant contract", () => {
    // The sweep that makes the rules apply to whatever T2-404 actually ships
    // rather than to the three names `contract.ts` currently guesses at.
    //
    // **Vacuous today**, because nothing is anon-reachable — and that vacuity
    // is not hidden: the `missing` half of the allow-list, marked below, is
    // red precisely until this sweep has something to say.
    expect(anonSurfaceIssues(migrationSql())).toEqual([]);
  });
});

/* =========================================================================
 * DEFECT FIX (1) — the end-state ACL
 * ====================================================================== */

describe("privileges are graded at the END of the directory", () => {
  it("leaves no anonymous privilege on any table that exists", () => {
    // Replaces a grader that counted `revoke … from anon` statements and
    // asserted the count was above zero (recorded defect, 2026-08-31). A
    // directory containing `revoke all on public.records from anon;` followed
    // by `grant select on public.records to anon;` scored 1 and passed.
    //
    // The table list is the union of what is *enumerated* and what is
    // *created*, so a fifth table cannot dodge the ACL question by not being
    // in the contract — which is the same hole defect (2) is about, reached
    // from the privilege side.
    // Shipped names rather than every enumerated name: `tableGrantIssues`
    // correctly reports "the end-state ACL is unknown" for a table no
    // statement ever mentions, and a table T2-404 has not created yet has no
    // ACL for anything to be known about. The `createdTables` half is what
    // keeps this airtight anyway — the day `shares` exists it joins this sweep
    // from the other side, whether or not anyone remembers to move it.
    const sql = migrationSql();
    const tables = [
      ...new Set([
        ...SHIPPED_USER_TABLES.map((table) => table.name),
        ...createdTables(sql).map((table) => table.name),
      ]),
    ];

    expect(tableGrantIssues(sql, tables)).toEqual([]);
  });

  it("revokes future default privileges too", () => {
    // The revoke above covers the tables that exist. This covers the one
    // written a year from now by someone who has not read this file. Read
    // structurally from the replayed `alter default privileges` records
    // rather than by regex over the whole file, so a matching phrase in a
    // comment or an unrelated statement cannot satisfy it.
    const records = grants(migrationSql()).defaultPrivileges;
    const revoked = records.filter(
      (record) =>
        record.action === "revoke" &&
        record.roles.some((role) => ANONYMOUS_ROLES.includes(role as never))
    );

    expect(revoked.map((record) => record.objectType)).toEqual(
      expect.arrayContaining(["tables"])
    );
    expect(revoked.map((record) => record.objectType)).toEqual(
      expect.arrayContaining(["functions"])
    );
  });

  it("grants no view to an anonymous caller", () => {
    // A view is not a table and `createdTables` will not find it, but a view
    // over user data reachable by `anon` leaks exactly as hard. Vacuous until
    // the derived views land; free until then.
    expect(viewGrantIssues(migrationSql())).toEqual([]);
  });

  it("creates every view `with (security_invoker = true)`", () => {
    // The other half of the view surface, and the half that matters even when
    // the grants are right. A view runs as its **owner** unless this option
    // says otherwise, so RLS on the underlying tables is evaluated against the
    // owner and not the caller — a `security definer` function with nicer
    // syntax. `security_invoker` arrived in PG15 and defaults to `false`, so
    // the default is the unsafe direction: the same shape of invariant as
    // `force row level security`, and it needs a grader for the same reason.
    //
    // Vacuous today — no migration creates a view — and it starts paying the
    // day one does, which is the point of landing it before that day.
    expect(viewSecurityInvokerIssues(migrationSql())).toEqual([]);
  });
});

/* =========================================================================
 * DEFECT FIX (2) — what exists, versus what is enumerated
 * ====================================================================== */

describe("every table that exists is a table some grader knows about", () => {
  it("creates no public table that is neither enumerated nor exempt", () => {
    // Recorded defect, 2026-08-31: nothing enumerated the tables that
    // actually exist. Every table-level grader is driven from `contract.ts`
    // and `userTablePolicyIssues` filters to `USER_TABLE_NAMES`, so a fifth
    // user table was invisible — a `shares` table with
    // `for all to anon using (true)` and no `force` produced zero findings.
    //
    // > every user table ships with row-level security proven by graders
    // > before content flows — AGENTS.md, Boundaries
    //
    // A guarantee about *every* user table cannot be driven off a hand-written
    // list of user tables.
    expect(ungradedTableIssues(migrationSql())).toEqual([]);
  });

  it("the exemption map is EMPTY — growing it is a deliberate diff", () => {
    // Round-2 review, F4. This used to iterate the map asserting each entry
    // carried a reason, which over an empty map is a test that cannot fail —
    // the exact thing this file's own standard forbids.
    //
    // Asserting the size instead does two jobs. It can fail, and it turns
    // adding an exemption into an edit *here*, in a file called
    // `share-instrument`, rather than a quiet line in a data table. That
    // closes the path where T2-404 unblocks its own red build by exempting
    // `shares` with a plausible-sounding reason: the exemption and the
    // grader's blessing of it now land in the same diff, where a conductor
    // reviewing the sharing work will see both.
    //
    // The mechanism itself — that a named exemption is honoured and an
    // unnamed table is not — is graded against a synthetic map in
    // `reviewer-probes.test.ts` (G10), so keeping this one at zero costs no
    // coverage.
    expect(EXEMPT_PUBLIC_TABLES.size).toBe(0);
  });

  it("stores no share token in the clear, in any table", () => {
    // Swept over every created table rather than over a `shares` table this
    // file has not declared: the claim is that nothing anywhere holds a
    // bearer secret in plaintext. Vacuous today, and it starts paying the day
    // the grants table lands.
    expect(plaintextTokenColumnIssues(migrationSql())).toEqual([]);
  });
});

/* =========================================================================
 * The grant readers T2-404 ships — marked, one line each
 *
 * `it.fails` is the marker. T2-404 activates a grader by deleting exactly
 * that `.fails` and nothing else.
 * ====================================================================== */

describe("typed share grants (SHR-05..08)", () => {
  it("every declared share reader exists in the migrations", () => {
    const declared = contractRoutineNames();
    const missing = SHARE_READER_FUNCTIONS.filter(
      (reader) => !declared.includes(reader.name)
    ).map(
      (reader) =>
        `${CONTRACT_SCHEMA}.${reader.name} (${reader.requirement}): ${reader.purpose}`
    );

    expect(missing).toEqual([]);
  });

  it("the anon-executable set EQUALS the declared share readers", () => {
    // The closed allow-list, completeness half. The deny half is unmarked
    // above and green; this is the direction that cannot be satisfied until a
    // reader exists and is granted. Both halves together are the equality.
    expect(
      anonFunctionAllowListIssues(migrationSql(), SHARE_READER_NAMES).missing
    ).toEqual([]);
  });

  it("every share reader is `security definer`", () => {
    // Not a style preference: the caller has no `auth.uid()`, so an invoker
    // function would run as `anon` and be filtered by RLS to nothing. Definer
    // is what makes the surface work — and what makes everything below
    // mandatory rather than advisory.
    const invokers = requireShareReaders()
      .filter((routine) => !routine.securityDefiner)
      .map((routine) => routine.identity);

    expect(invokers).toEqual([]);
  });

  it("every share reader carries `set search_path = ''`", () => {
    const issues = requireShareReaders()
      .filter(
        (routine) =>
          routine.searchPath === null ||
          !["''", "pg_catalog"].includes(routine.searchPath)
      )
      .map(
        (routine) => `${routine.identity}: search_path=${routine.searchPath}`
      );

    expect(issues).toEqual([]);
  });

  it("TOKEN 1/3: compares a hash, never a plaintext token column", () => {
    // Three graders, not one, because they fail independently and for
    // different reasons. This one is about what a database leak costs: if the
    // row holds the token, reading the table is holding every live grant.
    expect(requireShareReaders().flatMap(tokenHashIssues)).toEqual([]);
  });

  it("TOKEN 2/3: tests `expires_at`", () => {
    // SHR-08: "Every grant … SHALL carry an expiry." A column nobody reads is
    // not an expiry, it is a comment.
    expect(requireShareReaders().flatMap(expiryCheckIssues)).toEqual([]);
  });

  it("TOKEN 3/3: tests `revoked_at`", () => {
    // The likeliest defect in the whole feature, and the reason the triple is
    // three findings. A reader that validates the hash and checks the expiry
    // and skips this is a grant that **cannot be revoked** — and it passes
    // every hand-test, because a grant you have not revoked behaves
    // identically either way. SHR-08 makes revocation unconditional:
    // "SHALL take effect on the next request and SHALL never be gated by
    // payment, by plan, or by any other condition."
    expect(requireShareReaders().flatMap(revocationCheckIssues)).toEqual([]);
  });

  it("names its columns — no `select *`, no `setof` a user table", () => {
    // SHR-06: where a grant does not open costs, the data returned "SHALL
    // omit the cost fields entirely rather than blanking them at render
    // time". `select *` and `returns setof public.records` both make that
    // impossible: the shape is the table's shape, so every column the table
    // gains later is served to every grant holder with no diff in the
    // function at all. Column projection, not row projection.
    expect(requireShareReaders().flatMap(projectionIssues)).toEqual([]);
  });

  it("the accountless path is read-only (SHR-07)", () => {
    // "WHILE a request carries no authenticated session, no grant SHALL admit
    // any write." Graded on the path rather than on the three names above —
    // see the unmarked sweep, which applies this to whatever is actually
    // reachable.
    expect(requireShareReaders().flatMap(anonWriteIssues)).toEqual([]);
  });
});

/* =========================================================================
 * This file's own resolution layer, graded. **Nothing here is marked.**
 *
 * `reviewer-probes.test.ts` grades the rules; this grades the three helpers
 * above that connect this file to them. The distinction is not academic — the
 * PR #74 mutation run killed every mutant in `rules.ts` and left the two in
 * this file alive, because everything here reads the real migrations and the
 * real migrations contain no share readers and no second schema. A wiring
 * regression was therefore invisible: scoped and unscoped resolution give the
 * same answer against a repo that has neither.
 *
 * So the helpers take their SQL as an argument and these tests hand them a
 * fixture with a known answer. Same discipline as `harness-contract.test.ts`
 * being the unmarked canary for the parsers.
 * ====================================================================== */

describe("the seam guard and name lookups are schema-scoped", () => {
  /**
   * The full declared reader set, in `schema` — correct in every respect
   * except, for the impostor, the one property under test. Nothing else in the
   * instrument can be what rejects it.
   */
  const readerSet = (schema: string): string =>
    normalizeSql(
      SHARE_READER_NAMES.map(
        (name) => `
          create function ${schema}.${name}(p_token text)
          returns table (id uuid)
          language sql
          stable
          security definer
          set search_path = ''
          as $share$
            select r.id from public.records r
            join public.shares s on s.vehicle_id = r.vehicle_id
            where s.token_hash = extensions.digest(p_token, 'sha256')
              and s.revoked_at is null
              and s.expires_at > now();
          $share$;

          revoke all on function ${schema}.${name}(text) from public;
          grant execute on function ${schema}.${name}(text) to anon;
        `
      ).join("\n")
    );

  const IMPOSTORS = readerSet("private");
  const GENUINE = readerSet(CONTRACT_SCHEMA);

  it("the seam guard refuses impostors in another schema", () => {
    // Were this to pass, every marked grader above would receive routines from
    // a schema this contract never described and report on them as if they
    // were the real readers.
    expect(() => requireShareReaders(IMPOSTORS)).toThrow(SEAM_SHARE_GRANTS);
    expect(() => requireShareReaders(IMPOSTORS)).toThrow(
      `${CONTRACT_SCHEMA}.share_read_records`
    );
  });

  it("the seam guard accepts the genuine readers — the control", () => {
    // Tightening a matcher is only safe if the objects it exists to find still
    // resolve. Without this, the assertion above is satisfied by a guard that
    // refuses everything.
    expect(() => requireShareReaders(GENUINE)).not.toThrow();
    expect(requireShareReaders(GENUINE).map((r) => r.name)).toEqual([
      ...SHARE_READER_NAMES,
    ]);
  });

  it("the name lookups do not see routines outside the contract's schema", () => {
    expect(contractRoutineNames(IMPOSTORS)).toEqual([]);
    expect(contractRoutines("share_read_records", IMPOSTORS)).toEqual([]);

    expect(contractRoutineNames(GENUINE)).toEqual([...SHARE_READER_NAMES]);
    expect(contractRoutines("share_read_records", GENUINE)).toHaveLength(1);
  });

  it("the allow-list rejects the impostors and accepts the genuine set", () => {
    // The end-to-end pair, through this file's own entry point rather than
    // the probe corpus's.
    expect(
      anonFunctionAllowListIssues(IMPOSTORS, SHARE_READER_NAMES).unexpected
    ).toHaveLength(SHARE_READER_NAMES.length);
    expect(
      anonFunctionAllowListIssues(GENUINE, SHARE_READER_NAMES).unexpected
    ).toEqual([]);
    expect(
      anonFunctionAllowListIssues(GENUINE, SHARE_READER_NAMES).missing
    ).toEqual([]);
  });
});
