/**
 * Reviewer-derived regression fixtures. **Nothing here is marked.**
 *
 * The T2-201 review defeated the first version of the declaration tier by
 * writing DDL rather than by reading the graders: three wide-open schemas
 * passed the entire merge-blocking proof, and five correctly-spelled schemas
 * were rejected. The graders were measuring string similarity to an imagined
 * implementation and calling it row-level security.
 *
 * Those schemas live here now, as a corpus with a known answer:
 *
 * - **WIDE-OPEN variants must be rejected.** Each one leaks, and each one is
 *   written the way somebody would actually write it while believing it was
 *   safe. Every one of them passed before.
 * - **CORRECT variants must be accepted.** Each is valid Postgres that a
 *   reasonable schema would use, and every one of them failed before.
 *
 * This suite grades `rules.ts` and `sql.ts` — the instrument — against DDL
 * whose verdict is known, so it runs and passes today with no Supabase
 * anywhere. It is what stops this finding class from coming back: the next
 * person to loosen a predicate rule has to make a leak pass here first.
 *
 * The fixtures are deliberately minimal. Each isolates the one property under
 * test rather than being a whole schema, because a probe that fails for six
 * reasons proves nothing about any of them.
 *
 * ## The corpus was itself found wanting, and mutation-tested since
 *
 * The confirm review mutation-tested this file and found the load-bearing
 * rule — that a comparand must be *found*, not merely a mention — was pinned
 * by nothing here (R5). Reintroducing that bug failed only the unit tests of
 * `authUidComparands`; every end-to-end DDL probe stayed green, because P1 and
 * P4 are both caught by *other* rules (the tautology list, the path-extraction
 * requirement) before the equality rule is ever reached. A corpus that only
 * exercises the rules it happens to reach first is a corpus with holes in it.
 *
 * N11 and N12 exist to close that: neither is tautological, neither is a
 * storage policy, so **nothing but the equality rule can reject them**.
 * Re-running the mutation now fails 4 end-to-end probes instead of 0.
 *
 * Same treatment for the two rules added in that round — N4 is the only thing
 * standing between `isCorrelated` and silence (D1), and N3 the only thing
 * watching `alter policy` (D2). Each was verified by breaking its rule on
 * purpose and confirming this file goes red.
 *
 * refs specs/002-montero-garage (SHR-01, SHR-03, GAR-02′, GAR-05′, ACC-03)
 */
import { describe, expect, it } from "vitest";
import {
  EXEMPT_PUBLIC_TABLES,
  RECEIPTS_BUCKET,
  SHARE_READER_NAMES,
  USER_TABLE_NAMES,
} from "./contract.ts";
import {
  anonExecutableFunctions,
  anonFunctionAllowListIssues,
  anonSurfaceIssues,
  anonWriteIssues,
  authUidComparands,
  bucketPolicyIssues,
  bucketPrivacyIssues,
  capabilityGateIssues,
  defaultPrivilegeGrantIssues,
  definerSearchPathIssues,
  effectiveCheck,
  expiryCheckIssues,
  findShareReaders,
  isContractRoutine,
  isCorrelated,
  isOptionalColumn,
  isOwnerScoped,
  isTautological,
  optimisticBooleanDefaultIssues,
  plaintextTokenColumnIssues,
  presetBranchIssues,
  projectionIssues,
  publicationFlagGateIssues,
  publicationFlagIssues,
  refusalShapeIssues,
  revocationCheckIssues,
  revocationGatingIssues,
  rowAliases,
  splitTopLevel,
  storagePolicyIssues,
  stripSubqueries,
  subqueryCorrelationIssues,
  subqueryTables,
  tableGrantIssues,
  tokenHashIssues,
  ungradedTableIssues,
  userTablePolicyIssues,
  viewSecurityInvokerIssues,
} from "./rules.ts";
import {
  canonicalArgumentTypes,
  columnDefinition,
  createTableBody,
  createdTables,
  declaredArgumentNames,
  dollarTagAt,
  enablesRls,
  foreignKeyFor,
  forcesRls,
  functions,
  grants,
  isNotNullFor,
  migrationSql,
  normalizeSql,
  policies,
  privilegeVerdict,
  representsAbsence,
  rolePrivileges,
  statementRanges,
  statements,
  type FunctionDefinition,
} from "./sql.ts";

const sql = (text: string) => normalizeSql(text);

/* =========================================================================
 * A. Wide-open schemas that MUST be rejected
 * ====================================================================== */

/**
 * P1 — the finding that started it. A correct `with check` covering for a
 * `using` that hands every logged-in user everybody's rows. 164 graders
 * passed on this.
 */
const P1_USING_ANY_LOGGED_IN = sql(`
  create policy "records are owner-only" on public.records
    for all to authenticated
    using (auth.uid() is not null)
    with check (vehicle_id in (select id from vehicles where owner_id = auth.uid()));
`);

/** P2 — a tautology that is not spelled `true`. */
const P2_ONE_EQUALS_ONE = sql(`
  create policy "vehicles are owner-only" on public.vehicles
    for all to authenticated
    using (1 = 1);
`);

/** P3 — a scoped predicate widened by an `or` branch nobody reads to the end of. */
const P3_OR_WIDENED = sql(`
  create policy "vehicles are owner-only" on public.vehicles
    for all to authenticated
    using (owner_id = auth.uid() or auth.role() = 'authenticated');
`);

/** P4 — F2: storage scoped by bucket and session, never by path. */
const P4_STORAGE_NO_PATH = sql(`
  create policy "receipts are owner-only" on storage.objects
    for select to authenticated
    using (bucket_id = 'receipts' and auth.uid() is not null);
`);

/** P5 — F5: the bucket created private, then quietly flipped later. */
const P5_BUCKET_FLIPPED_LATER = sql(`
  insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false);
  update storage.buckets set public = true where id = 'receipts';
`);

/** P6 — F5: the value before the name, which the old regex could not see. */
const P6_BUCKET_PUBLIC_REVERSED = sql(`
  insert into storage.buckets (public, id, name) values (true, 'receipts', 'receipts');
`);

/** P7 — a write policy with no ownership check at all on the new row. */
const P7_INSERT_UNCHECKED = sql(`
  create policy "anyone may write" on public.vehicles
    for insert to authenticated
    with check (true);
`);

/**
 * N3 — a follow-up migration reopens F1 with `alter policy`.
 *
 * The `create` is impeccable. The database at the end of the directory is
 * wide open. A grader that reads only `create policy` reports green
 * (confirm review, D2).
 */
const N3_ALTER_POLICY_REOPENS = sql(`
  create policy "records are owner-only" on public.records
    for all to authenticated
    using (exists (
      select 1 from public.vehicles v
      where v.id = records.vehicle_id and v.owner_id = auth.uid()
    ));

  alter policy "records are owner-only" on public.records
    using (true);
`);

/**
 * N4 — an UNCORRELATED exists: own any vehicle, read everyone's records.
 *
 * Contains a real `owner_id = auth.uid()` equality and is not a tautology, so
 * every rule except correlation is satisfied. What is missing is the join back
 * to the outer row (confirm review, D1).
 */
const N4_UNCORRELATED_EXISTS = sql(`
  create policy "records are owner-only" on public.records
    for all to authenticated
    using (exists (
      select 1 from public.vehicles v where v.owner_id = auth.uid()
    ));
`);

/**
 * N11 — mentions `auth.uid()` without ever comparing it, in a conjunction the
 * tautology list cannot reach.
 *
 * **This probe exists to pin the equality rule itself** (confirm review, R5).
 * Mutation-testing the corpus showed the load-bearing rule — that a comparand
 * must be found, not merely a mention — was graded only by unit tests of the
 * helper: reintroducing the bug there left every end-to-end probe green.
 * `deleted_at is null` is not tautological, so `isTautological` returns false
 * for the conjunction, and the path-extraction rule does not apply to a table.
 * Nothing but the equality rule can reject this.
 */
const N11_MENTION_NOT_EQUALITY = sql(`
  create policy "vehicles are owner-only" on public.vehicles
    for all to authenticated
    using (display_name is not null and auth.uid() is not null);
`);

/** N12 — the same, hidden inside a function call rather than a comparison. */
const N12_MENTION_IN_FUNCTION = sql(`
  create policy "vehicles are owner-only" on public.vehicles
    for all to authenticated
    using (coalesce(auth.uid(), owner_id) is not null and model_year > 1982);
`);

/**
 * N13 — the reviewer's **P1**: an uncorrelated `exists` wearing a self-join.
 *
 * The shared-name hole T2-201 recorded and T2-202 closed. `isCorrelated`
 * accepts the unqualified back-reference spelling by matching the outer
 * table's column *names*; `records` and `vehicles` share `{id, odometer_km}`,
 * so a bare `id` inside a subquery over `vehicles` used to read as a
 * back-reference to `records.id` when Postgres resolves it inward to
 * `v.id` — `id = id` is a self-join on the inner table and correlates with
 * nothing.
 *
 * Everything else about this policy is impeccable: real equality, real
 * `auth.uid()`, no tautology, not storage. Only the correlation rule can
 * reject it, and only the *tightened* one can.
 */
const N13_SHARED_NAME_SELF_JOIN = sql(`
  create policy "records are owner-only" on public.records
    for all to authenticated
    using (exists (
      select 1 from public.vehicles v where id = id and v.owner_id = auth.uid()
    ));
`);

/**
 * N14 — the reviewer's **P2**: the same hole through an ordinary predicate.
 *
 * `odometer_km` is the other name the two tables share. Bare, inside a
 * subquery over `vehicles`, it resolves to `v.odometer_km` and never to the
 * record's — so "own any truck with an odometer reading, read everyone's
 * records". Kept separate from N13 because it is a *plausible* predicate
 * rather than an obvious tell: nobody writes `id = id` by accident, and
 * plenty of people write a range filter.
 */
const N14_SHARED_NAME_PREDICATE = sql(`
  create policy "records are owner-only" on public.records
    for all to authenticated
    using (exists (
      select 1 from public.vehicles v
      where odometer_km > 0 and v.owner_id = auth.uid()
    ));
`);

/**
 * N16 — a second bucket policed for reads only.
 *
 * Hoisted to module scope so the sweep below can reach it: the per-bucket rule
 * was the newest in the file and the only one with no sweep coverage at all
 * (T2-301a review, F4).
 */
const N16_BUCKET_READ_ONLY = sql(`
  create policy "photos owner select" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'vehicle-photos'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );
`);

/** N17 — a second bucket scoped by bucket id and session, never by path. */
const N17_BUCKET_NO_PATH = sql(`
  create policy "photos any user" on storage.objects
    for all to authenticated
    using (bucket_id = 'vehicle-photos' and auth.uid() is not null)
    with check (bucket_id = 'vehicle-photos' and auth.uid() is not null);
`);

describe("WIDE-OPEN: schemas that leak must be rejected", () => {
  it("P1 rejects a wide-open `using` behind a correct `with check`", () => {
    const issues = userTablePolicyIssues(P1_USING_ANY_LOGGED_IN, ["records"]);

    expect(issues.join(" | ")).toContain("`using` is not owner-scoped");
  });

  it("P1: the `with check` half is correctly recognised as fine", () => {
    // The point is that the two clauses are judged separately. If this also
    // reported an issue, the grader would be right by accident.
    const [policy] = policies(P1_USING_ANY_LOGGED_IN);

    expect(isOwnerScoped(policy.withCheckExpr)).toBe(true);
    expect(isOwnerScoped(policy.usingExpr)).toBe(false);
  });

  it("P2 rejects `1 = 1`", () => {
    expect(
      userTablePolicyIssues(P2_ONE_EQUALS_ONE, ["vehicles"]).join(" | ")
    ).toContain("not owner-scoped");
  });

  it("P3 rejects a scoped predicate widened by `or`", () => {
    expect(
      userTablePolicyIssues(P3_OR_WIDENED, ["vehicles"]).join(" | ")
    ).toContain("not owner-scoped");
  });

  it("P4 rejects a storage policy that never reads the object path", () => {
    expect(storagePolicyIssues(P4_STORAGE_NO_PATH).join(" | ")).toContain(
      "not owner-scoped"
    );
  });

  it("P5 rejects a bucket flipped public by a later migration", () => {
    expect(
      bucketPrivacyIssues(P5_BUCKET_FLIPPED_LATER, RECEIPTS_BUCKET).join(" | ")
    ).toContain("public");
  });

  it("P6 rejects a public bucket whose columns are in an unexpected order", () => {
    expect(
      bucketPrivacyIssues(P6_BUCKET_PUBLIC_REVERSED, RECEIPTS_BUCKET).length
    ).toBeGreaterThan(0);
  });

  it("P7 rejects an unconditional `with check`", () => {
    expect(
      userTablePolicyIssues(P7_INSERT_UNCHECKED, ["vehicles"]).join(" | ")
    ).toContain("`with check` is not owner-scoped");
  });

  it("N3 rejects a policy reopened by a later `alter policy`", () => {
    expect(
      userTablePolicyIssues(N3_ALTER_POLICY_REOPENS, ["records"]).join(" | ")
    ).toContain("not owner-scoped");
  });

  it("N3: the CREATE on its own would have been fine", () => {
    // Proving the finding is about the ALTER and not about a parser that
    // stopped understanding the original policy.
    const createOnly = N3_ALTER_POLICY_REOPENS.slice(
      0,
      N3_ALTER_POLICY_REOPENS.indexOf("alter policy")
    );

    expect(userTablePolicyIssues(createOnly, ["records"])).toEqual([]);
  });

  it("N3: a dropped policy leaves the table uncovered, not silently passing", () => {
    const dropped = sql(`
      create policy "records are owner-only" on public.records
        for all to authenticated using (owner_id = auth.uid());
      drop policy "records are owner-only" on public.records;
    `);

    expect(userTablePolicyIssues(dropped, ["records"])).toEqual([
      "records: no policy at all",
    ]);
  });

  it("N4 rejects an UNCORRELATED exists — own any, read all", () => {
    expect(
      userTablePolicyIssues(N4_UNCORRELATED_EXISTS, ["records"]).join(" | ")
    ).toContain("not owner-scoped");
  });

  it("N4 vs C8: correlation is the ONLY difference between them", () => {
    // Both subqueries contain `v.owner_id = auth.uid()`. Only one joins back
    // to the outer row. If this pair ever agrees, the D1 rule has stopped
    // doing anything.
    expect(
      userTablePolicyIssues(N4_UNCORRELATED_EXISTS, ["records"]).length
    ).toBeGreaterThan(0);
    expect(userTablePolicyIssues(C8_NESTED_OWNERSHIP, ["records"])).toEqual([]);
  });

  it("N11 rejects a MENTION of auth.uid() that is never an equality", () => {
    // The probe that pins the equality rule end-to-end (R5). Not a tautology,
    // not a storage policy: nothing else in the ruleset can reject it.
    expect(
      userTablePolicyIssues(N11_MENTION_NOT_EQUALITY, ["vehicles"]).join(" | ")
    ).toContain("not owner-scoped");
  });

  it("N12 rejects auth.uid() buried in a function call", () => {
    expect(
      userTablePolicyIssues(N12_MENTION_IN_FUNCTION, ["vehicles"]).join(" | ")
    ).toContain("not owner-scoped");
  });

  it("N13 rejects a self-join on a column name both tables declare", () => {
    expect(
      userTablePolicyIssues(N13_SHARED_NAME_SELF_JOIN, ["records"]).join(" | ")
    ).toContain("not owner-scoped");
  });

  it("N14 rejects a shared-name predicate that resolves inward", () => {
    expect(
      userTablePolicyIssues(N14_SHARED_NAME_PREDICATE, ["records"]).join(" | ")
    ).toContain("not owner-scoped");
  });

  it("N13/N14 are rejected for CORRELATION, not for something else", () => {
    // Each fixture has to fail for the reason it was written. If one of them
    // ever starts failing on the equality rule or the tautology list instead,
    // the corpus would still be green while the correlation fix rotted.
    for (const [name, fixture] of [
      ["N13", N13_SHARED_NAME_SELF_JOIN],
      ["N14", N14_SHARED_NAME_PREDICATE],
    ] as const) {
      const [policy] = policies(fixture);
      const { subqueries } = stripSubqueries(policy.usingExpr ?? "");

      expect(subqueries, name).toHaveLength(1);
      // A real equality against a row term is present…
      expect(authUidComparands(subqueries[0]), name).toContain("v.owner_id");
      // …and the predicate is not a tautology…
      expect(isTautological(policy.usingExpr ?? ""), name).toBe(false);
      // …so correlation is the only thing left to reject it.
      expect(
        isCorrelated(subqueries[0], {
          outerTable: "records",
          outerColumns: ["id", "vehicle_id", "odometer_km", "kind"],
        }),
        name
      ).toBe(false);
    }
  });

  it("the tightened rule still accepts the unqualified spelling it exists for", () => {
    // The whole reason `isCorrelated` looks at bare names is that
    // `where v.id = vehicle_id` is legal, correct Postgres. Subtracting the
    // inner table's columns must not have taken that with it — `vehicle_id`
    // is a `records` column and `vehicles` has no such column, so it survives
    // the subtraction and still counts as the back-reference it is.
    expect(
      isCorrelated("select 1 from public.vehicles v where v.id = vehicle_id", {
        outerTable: "records",
        outerColumns: ["id", "vehicle_id", "odometer_km"],
      })
    ).toBe(true);
  });

  it("subqueryTables reads the from/join list the subtraction needs", () => {
    expect(
      subqueryTables(
        "select 1 from public.records r join public.vehicles v on v.id = r.vehicle_id"
      )
    ).toEqual(["records", "vehicles"]);
  });

  it("N15 rejects a SECOND bucket left with no policy of its own", () => {
    // T2-301a. `storagePolicyIssues` grades every storage.objects policy
    // together, which was the whole truth while receipts were the only
    // bucket. Here every policy that exists is flawless and the photos bucket
    // has none — so the whole-table rule says nothing, and only the
    // per-bucket rule catches it.
    expect(storagePolicyIssues(C9_STORAGE_PATH_SCOPED)).toEqual([]);
    expect(
      bucketPolicyIssues(C9_STORAGE_PATH_SCOPED, "vehicle-photos").join(" | ")
    ).toContain("no policy names the vehicle-photos bucket");
  });

  it("N16 rejects a bucket whose policies miss a command", () => {
    // Select-only means the owner cannot upload; delete-less means the
    // cascade cannot reach the objects. Both are findings, and neither is
    // visible to a rule that only asks whether the policies present are sound.
    const issues = bucketPolicyIssues(
      N16_BUCKET_READ_ONLY,
      "vehicle-photos"
    ).join(" | ");

    expect(issues).toContain("no policy covers insert");
    expect(issues).toContain("no policy covers delete");
    expect(issues).not.toContain("no policy covers select");
  });

  it("N17 rejects a second bucket scoped by bucket id but not by path", () => {
    // The F2 shape again, one bucket over: every authenticated user reads
    // every user's photos.
    expect(
      bucketPolicyIssues(N17_BUCKET_NO_PATH, "vehicle-photos").join(" | ")
    ).toContain("not owner-scoped");
  });

  it("every wide-open probe produces at least one finding", () => {
    // The sweep. A rule refactor that quietly stopped detecting one of these
    // would otherwise only show up as one silent green test.
    const verdicts: [string, string[]][] = [
      [
        "P1 using-any-logged-in",
        userTablePolicyIssues(P1_USING_ANY_LOGGED_IN, ["records"]),
      ],
      ["P2 1=1", userTablePolicyIssues(P2_ONE_EQUALS_ONE, ["vehicles"])],
      ["P3 or-widened", userTablePolicyIssues(P3_OR_WIDENED, ["vehicles"])],
      ["P4 storage-no-path", storagePolicyIssues(P4_STORAGE_NO_PATH)],
      [
        "P5 bucket-flipped",
        bucketPrivacyIssues(P5_BUCKET_FLIPPED_LATER, RECEIPTS_BUCKET),
      ],
      [
        "P6 bucket-reversed",
        bucketPrivacyIssues(P6_BUCKET_PUBLIC_REVERSED, RECEIPTS_BUCKET),
      ],
      [
        "P7 insert-unchecked",
        userTablePolicyIssues(P7_INSERT_UNCHECKED, ["vehicles"]),
      ],
      [
        "N3 alter-policy",
        userTablePolicyIssues(N3_ALTER_POLICY_REOPENS, ["records"]),
      ],
      [
        "N4 uncorrelated-exists",
        userTablePolicyIssues(N4_UNCORRELATED_EXISTS, ["records"]),
      ],
      [
        "N11 mention-not-equality",
        userTablePolicyIssues(N11_MENTION_NOT_EQUALITY, ["vehicles"]),
      ],
      [
        "N12 mention-in-function",
        userTablePolicyIssues(N12_MENTION_IN_FUNCTION, ["vehicles"]),
      ],
      [
        "N13 shared-name self-join",
        userTablePolicyIssues(N13_SHARED_NAME_SELF_JOIN, ["records"]),
      ],
      [
        "N14 shared-name predicate",
        userTablePolicyIssues(N14_SHARED_NAME_PREDICATE, ["records"]),
      ],
      // The per-bucket rule (T2-301a). It was the newest rule in the file and
      // the only one with no sweep coverage at all, which is the position a
      // rule is least likely to be noticed going quiet from.
      [
        "N15 second bucket unpoliced",
        bucketPolicyIssues(C9_STORAGE_PATH_SCOPED, "vehicle-photos"),
      ],
      [
        "N16 bucket missing a command",
        bucketPolicyIssues(N16_BUCKET_READ_ONLY, "vehicle-photos"),
      ],
      [
        "N17 bucket without path scoping",
        bucketPolicyIssues(N17_BUCKET_NO_PATH, "vehicle-photos"),
      ],
    ];

    expect(
      verdicts.filter(([, issues]) => issues.length === 0).map(([name]) => name)
    ).toEqual([]);
  });
});

/* =========================================================================
 * B. Correct schemas that MUST be accepted
 * ====================================================================== */

/** C1 — `primary key` implies NOT NULL; demanding the literal was wrong. */
const C1_PRIMARY_KEY_IMPLIES_NOT_NULL = sql(`
  create table public.vehicles (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null
  );
`);

/** C2 — a reference to a table's primary key needs no column list. */
const C2_REFERENCES_NO_COLUMN_LIST = sql(`
  create table public.vehicles (
    id uuid primary key,
    owner_id uuid not null references auth.users on delete cascade
  );
`);

/** C3 — the same key declared as a table-level constraint. */
const C3_TABLE_LEVEL_FK = sql(`
  create table public.records (
    id uuid primary key,
    vehicle_id uuid not null,
    constraint records_vehicle_fk foreign key (vehicle_id)
      references public.vehicles (id) on delete cascade
  );
`);

/** C4 — pg_dump's spelling: `ALTER TABLE ONLY`, constraint added afterwards. */
const C4_ALTER_TABLE_ONLY = sql(`
  create table public.receipts (
    id uuid primary key,
    record_id uuid not null
  );
  alter table only public.receipts enable row level security;
  alter table only public.receipts force row level security;
  alter table only public.receipts
    add constraint receipts_record_fk foreign key (record_id)
    references public.records (id) on delete cascade;
`);

/** C5 — a schema-qualified enum type for the record kind. */
const C5_QUALIFIED_ENUM = sql(`
  create type public.record_kind as enum ('work', 'receipt', 'note', 'plan');
  create table public.records (
    id uuid primary key,
    kind public.record_kind not null
  );
`);

/** C6 — an empty array is how "no references" is spelled. */
const C6_EMPTY_ARRAY_DEFAULT = sql(`
  create table public.records (
    id uuid primary key,
    problem_ids text[] not null default '{}',
    part_ids text[] not null default array[]::text[]
  );
`);

/** C7 — `for all` with only a `using` clause: Postgres reuses it for writes. */
const C7_FOR_ALL_USING_ONLY = sql(`
  create policy "vehicles are owner-only" on public.vehicles
    for all to authenticated
    using (owner_id = auth.uid());
`);

/** C8 — the nested-ownership spelling, via an exists subquery. */
const C8_NESTED_OWNERSHIP = sql(`
  create policy "records are owner-only" on public.records
    for all to authenticated
    using (exists (
      select 1 from public.vehicles v
      where v.id = records.vehicle_id and v.owner_id = auth.uid()
    ));
`);

/** C9 — a correct storage policy: bucket plus the object's owning folder. */
const C9_STORAGE_PATH_SCOPED = sql(`
  create policy "receipts are owner-only" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'receipts'
      and (storage.foldername(name))[1] = auth.uid()::text
    );
`);

/** C10 — a restrictive policy that narrows; it need not grant on its own. */
const C10_RESTRICTIVE_NARROWS = sql(`
  create policy "vehicles are owner-only" on public.vehicles
    for all to authenticated
    using (owner_id = auth.uid());
  create policy "no deleted accounts" on public.vehicles
    as restrictive for all to authenticated
    using (auth.uid() is not null);
`);

/**
 * N9 — `(select auth.uid()) = owner_id`, straight out of Supabase's own RLS
 * performance guide: the scalar subquery lets Postgres hoist the call out of
 * the per-row loop. This is what T2-202 will write at scale, and it was
 * failing closed (confirm review, R4).
 */
const N9_SELECT_WRAPPED_UID = sql(`
  create policy "vehicles are owner-only" on public.vehicles
    for all to authenticated
    using ((select auth.uid()) = owner_id)
    with check ((select auth.uid()) = owner_id);
`);

/** N10 — the `in (select auth.uid())` spelling of the same idiom. */
const N10_IN_SELECT_UID = sql(`
  create policy "vehicles are owner-only" on public.vehicles
    for all to authenticated
    using (owner_id in (select auth.uid()));
`);

/** C11 — the bucket created private, explicitly. */
const C11_BUCKET_PRIVATE = sql(`
  insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', false)
  on conflict (id) do nothing;
`);

describe("CORRECT: valid schemas must be accepted", () => {
  it("C1 accepts `primary key` as satisfying not-null", () => {
    expect(
      isNotNullFor(C1_PRIMARY_KEY_IMPLIES_NOT_NULL, "vehicles", "id")
    ).toBe(true);
  });

  it("C1 still reports a genuinely nullable column as nullable", () => {
    // The negative half: if `isNotNullFor` returned true for everything, the
    // grader above would pass and mean nothing.
    const nullable = sql(`create table public.vehicles (note text);`);

    expect(isNotNullFor(nullable, "vehicles", "note")).toBe(false);
  });

  it("C2 accepts a reference with no column list", () => {
    const fk = foreignKeyFor(
      C2_REFERENCES_NO_COLUMN_LIST,
      "vehicles",
      "owner_id"
    );

    expect(fk).toEqual({ target: "auth.users", cascades: true });
  });

  it("C3 accepts a table-level foreign key constraint", () => {
    const fk = foreignKeyFor(C3_TABLE_LEVEL_FK, "records", "vehicle_id");

    expect(fk).toEqual({ target: "public.vehicles", cascades: true });
  });

  it("C4 accepts ALTER TABLE ONLY for RLS and for constraints", () => {
    const fk = foreignKeyFor(C4_ALTER_TABLE_ONLY, "receipts", "record_id");

    expect(fk).toEqual({ target: "public.records", cascades: true });
  });

  it("C4 sees RLS enabled and forced through ALTER TABLE ONLY", () => {
    expect(enablesRls(C4_ALTER_TABLE_ONLY, "receipts")).toBe(true);
    expect(forcesRls(C4_ALTER_TABLE_ONLY, "receipts")).toBe(true);
  });

  it("C4 still reports enabled-but-not-forced through ALTER TABLE ONLY", () => {
    // The invariant the whole harness exists for must not have been loosened
    // in the course of accepting `ONLY`.
    const enabledOnly = sql(`
      alter table only public.receipts enable row level security;
    `);

    expect(enablesRls(enabledOnly, "receipts")).toBe(true);
    expect(forcesRls(enabledOnly, "receipts")).toBe(false);
  });

  it("C5 accepts a schema-qualified enum type", () => {
    expect(C5_QUALIFIED_ENUM).toMatch(
      /create (?:type|domain) (?:[a-z_]+\.)?[a-z_]*kind\b/
    );
  });

  it("C6 accepts `not null default '{}'` as optional", () => {
    expect(
      isOptionalColumn(C6_EMPTY_ARRAY_DEFAULT, "records", "problem_ids", true)
    ).toBe(true);
    expect(
      isOptionalColumn(C6_EMPTY_ARRAY_DEFAULT, "records", "part_ids", true)
    ).toBe(true);
  });

  it("C6 still rejects a required column pretending to be optional", () => {
    // `not null default 0` on a cost is not optionality — it is inventing a
    // number, which is the one thing this project refuses to do.
    const forced = sql(`
      create table public.records (
        id uuid primary key,
        cost_amount numeric not null default 0
      );
    `);

    expect(isOptionalColumn(forced, "records", "cost_amount", true)).toBe(
      false
    );
  });

  it("C7 accepts `for all` with only a using clause", () => {
    expect(userTablePolicyIssues(C7_FOR_ALL_USING_ONLY, ["vehicles"])).toEqual(
      []
    );
  });

  it("C7: the write side falls back to `using`, as Postgres does", () => {
    const [policy] = policies(C7_FOR_ALL_USING_ONLY);

    expect(effectiveCheck(policy)).toBe("owner_id = auth.uid()");
  });

  it("C8 accepts nested ownership through an exists subquery", () => {
    expect(userTablePolicyIssues(C8_NESTED_OWNERSHIP, ["records"])).toEqual([]);
  });

  it("C9 accepts a path-scoped storage policy", () => {
    expect(storagePolicyIssues(C9_STORAGE_PATH_SCOPED)).toEqual([]);
  });

  it("N18 accepts a correctly policed second bucket", () => {
    // The positive control: the rule must not simply dislike photos.
    const correct = sql(`
      create policy "photos owner all" on storage.objects
        for all to authenticated
        using (
          bucket_id = 'vehicle-photos'
          and (storage.foldername(name))[1] = (select auth.uid())::text
        )
        with check (
          bucket_id = 'vehicle-photos'
          and (storage.foldername(name))[1] = (select auth.uid())::text
        );
    `);

    expect(bucketPolicyIssues(correct, "vehicle-photos")).toEqual([]);
  });

  it("C10 accepts a restrictive policy that only narrows", () => {
    expect(
      userTablePolicyIssues(C10_RESTRICTIVE_NARROWS, ["vehicles"])
    ).toEqual([]);
  });

  it("C11 accepts an explicitly private bucket", () => {
    expect(bucketPrivacyIssues(C11_BUCKET_PRIVATE, RECEIPTS_BUCKET)).toEqual(
      []
    );
  });

  it("N9 accepts `(select auth.uid()) = owner_id` — Supabase's own idiom", () => {
    expect(userTablePolicyIssues(N9_SELECT_WRAPPED_UID, ["vehicles"])).toEqual(
      []
    );
  });

  it("N10 accepts `owner_id in (select auth.uid())`", () => {
    expect(userTablePolicyIssues(N10_IN_SELECT_UID, ["vehicles"])).toEqual([]);
  });

  it("N9/N10: the subquery wrapper does not smuggle past the equality rule", () => {
    // Accepting the idiom must not decay into "any (select …) counts". A
    // wrapped call that is still only a mention has to stay rejected.
    const wrappedMention = sql(`
      create policy "vehicles are owner-only" on public.vehicles
        for all to authenticated
        using ((select auth.uid()) is not null and display_name is not null);
    `);

    expect(
      userTablePolicyIssues(wrappedMention, ["vehicles"]).join(" | ")
    ).toContain("not owner-scoped");
  });

  it("every correct probe produces no findings", () => {
    const verdicts = [
      userTablePolicyIssues(C7_FOR_ALL_USING_ONLY, ["vehicles"]),
      userTablePolicyIssues(C8_NESTED_OWNERSHIP, ["records"]),
      storagePolicyIssues(C9_STORAGE_PATH_SCOPED),
      userTablePolicyIssues(C10_RESTRICTIVE_NARROWS, ["vehicles"]),
      bucketPrivacyIssues(C11_BUCKET_PRIVATE, RECEIPTS_BUCKET),
      userTablePolicyIssues(N9_SELECT_WRAPPED_UID, ["vehicles"]),
      userTablePolicyIssues(N10_IN_SELECT_UID, ["vehicles"]),
    ];

    expect(verdicts.flat()).toEqual([]);
  });
});

/* =========================================================================
 * C. The expression analysis underneath, graded directly
 * ====================================================================== */

describe("splitTopLevel", () => {
  it("splits on a top-level or", () => {
    expect(splitTopLevel("a = 1 or b = 2", "or")).toEqual(["a = 1", "b = 2"]);
  });

  it("does NOT split inside parentheses", () => {
    // The `or` inside a subquery belongs to the subquery. Splitting there
    // would report a correct policy as widened.
    expect(
      splitTopLevel("exists (select 1 where a = 1 or b = 2)", "or")
    ).toHaveLength(1);
  });

  it("does not split a word that merely starts with or", () => {
    expect(splitTopLevel("order_id = auth.uid()", "or")).toEqual([
      "order_id = auth.uid()",
    ]);
  });

  it("splits on and, too", () => {
    expect(splitTopLevel("a = 1 and b = 2", "and")).toEqual(["a = 1", "b = 2"]);
  });
});

describe("isTautological", () => {
  it.each([
    ["true", true],
    ["1 = 1", true],
    ["(1 = 1)", true],
    ["42 = 42", true],
    ["'x' = 'x'", true],
    ["auth.uid() is not null", true],
    ["auth.role() = 'authenticated'", true],
    ["true and true", true],
    ["owner_id = auth.uid()", false],
    ["1 = 2", false],
    ["'x' = 'y'", false],
    ["bucket_id = 'receipts'", false],
    ["owner_id = auth.uid() and auth.uid() is not null", false],
  ])("%s → %s", (expr, expected) => {
    expect(isTautological(expr)).toBe(expected);
  });
});

describe("authUidComparands — equality, not mention", () => {
  it("finds the column on the left", () => {
    expect(authUidComparands("owner_id = auth.uid()")).toContain("owner_id");
  });

  it("finds the column on the right", () => {
    expect(authUidComparands("auth.uid() = owner_id")).toContain("owner_id");
  });

  it("sees through a cast", () => {
    expect(
      authUidComparands("(storage.foldername(name))[1] = auth.uid()::text")
    ).toHaveLength(1);
  });

  it("finds NOTHING in a mere mention — the whole of F1", () => {
    expect(authUidComparands("auth.uid() is not null")).toEqual([]);
  });

  it("does not count auth.uid() compared with itself", () => {
    expect(authUidComparands("auth.uid() = auth.uid()")).toEqual([]);
  });

  it("does not count a comparison with a literal", () => {
    expect(authUidComparands("auth.uid() = 'some-uuid'")).toEqual([]);
  });

  it("does not count the caller compared with themselves (R3)", () => {
    // `auth.uid()` IS `current_setting('request.jwt.claims')…->>'sub'`
    // underneath, so this is always true while reading like a careful check.
    expect(
      authUidComparands(
        "current_setting('request.jwt.claim.sub') = auth.uid()::text"
      )
    ).toEqual([]);
  });

  it("sees through Supabase's `(select auth.uid())` idiom (R4)", () => {
    expect(authUidComparands("(select auth.uid()) = owner_id")).toEqual([
      "owner_id",
    ]);
  });

  it("sees through the `in (select auth.uid())` idiom (R4)", () => {
    expect(authUidComparands("owner_id in (select auth.uid())")).toEqual([
      "owner_id",
    ]);
  });
});

describe("stripSubqueries / isCorrelated — the D1 rule, directly", () => {
  it("separates a subquery from the predicate around it", () => {
    const { outer, subqueries } = stripSubqueries(
      "exists (select 1 from vehicles v where v.owner_id = auth.uid())"
    );

    expect(subqueries).toHaveLength(1);
    expect(outer).not.toContain("auth.uid()");
  });

  it("calls a subquery that names the outer table correlated", () => {
    expect(
      isCorrelated("select 1 from vehicles v where v.id = records.vehicle_id", {
        outerTable: "records",
        outerColumns: ["id", "vehicle_id"],
      })
    ).toBe(true);
  });

  it("calls a subquery referencing an outer column UNqualified correlated", () => {
    // Legal Postgres — resolved outward when the inner table has no such
    // column. Rejecting it would fail a correct policy.
    expect(
      isCorrelated("select 1 from vehicles v where v.id = vehicle_id", {
        outerTable: "records",
        outerColumns: ["id", "vehicle_id"],
      })
    ).toBe(true);
  });

  it("calls a subquery that never mentions the outer row UNcorrelated", () => {
    expect(
      isCorrelated("select 1 from vehicles v where v.owner_id = auth.uid()", {
        outerTable: "records",
        outerColumns: ["id", "vehicle_id", "occurred_on", "kind"],
      })
    ).toBe(false);
  });

  it("is not fooled by `id` appearing inside `owner_id`", () => {
    // The word-boundary case: a substring match would call this correlated
    // and D1 would quietly stop working.
    expect(
      isCorrelated("select 1 from vehicles v where v.owner_id = auth.uid()", {
        outerTable: "records",
        outerColumns: ["id"],
      })
    ).toBe(false);
  });

  it("declines to judge when there is no outer table, rather than inventing a finding", () => {
    expect(isCorrelated("select 1 from vehicles v", {})).toBe(true);
  });
});

describe("representsAbsence", () => {
  it.each([
    ["'{}'", true],
    ["array[]", true],
    ["'{}'::text[]", true],
    ["array[]::text[]", true],
    ["0", false],
    ["'{unset}'", false],
    ["null", false],
  ])("%s → %s", (expr, expected) => {
    expect(representsAbsence(expr)).toBe(expected);
  });
});

describe("the probe fixtures are real DDL, not empty strings", () => {
  // Belt and braces: every fixture above must actually parse into the thing
  // it claims to be, or the verdicts are about nothing.
  it("the policy probes each contain exactly one or two policies", () => {
    for (const [name, fixture] of [
      ["P1", P1_USING_ANY_LOGGED_IN],
      ["P2", P2_ONE_EQUALS_ONE],
      ["P3", P3_OR_WIDENED],
      ["P4", P4_STORAGE_NO_PATH],
      ["P7", P7_INSERT_UNCHECKED],
      ["C7", C7_FOR_ALL_USING_ONLY],
      ["C8", C8_NESTED_OWNERSHIP],
      ["C9", C9_STORAGE_PATH_SCOPED],
      ["C10", C10_RESTRICTIVE_NARROWS],
    ] as const) {
      expect(policies(fixture).length, name).toBeGreaterThan(0);
    }
  });

  it("the table probes each parse into a create-table body", () => {
    expect(
      createTableBody(C1_PRIMARY_KEY_IMPLIES_NOT_NULL, "vehicles")
    ).not.toBeNull();
    expect(
      columnDefinition(
        createTableBody(C6_EMPTY_ARRAY_DEFAULT, "records") ?? "",
        "problem_ids"
      )
    ).not.toBeNull();
  });
});

/* =========================================================================
 * D. T2-401a — the FUNCTION and GRANT surface
 *
 * Same contract as the sections above, applied to the rules that grade
 * `security definer` functions and end-state ACLs: a leaking variant that must
 * be rejected, a correct variant that must be accepted, and each fixture
 * minimal enough that only the rule under test can decide it.
 *
 * ## Mutation-verified, to this file's own standard
 *
 * Thirty-nine mutations were applied to `rules.ts` and `sql.ts` — each rule
 * disabled or inverted in turn, each clause of the compound rules separately —
 * and this suite went red for every one. That matters more here than anywhere
 * else in the file, because these fixtures describe a surface that does not
 * exist yet: a rule that quietly matched nothing would look exactly like a
 * rule that is waiting, and `share-instrument.test.ts`'s `it.fails` markers
 * would go on reporting "expected failure" either way.
 *
 * Seven mutations survived a first pass and the probes were strengthened until
 * they did not, which is the only reason to run the exercise at all. Each
 * survivor was a rule the corpus *appeared* to cover:
 *
 * - **`dollarTagAt` matching `$1`.** Relaxing the first character of a tag
 *   name turns every plpgsql positional parameter into a dollar quote and
 *   swallows the rest of the file. Pinned now as a direct table.
 * - **`statements()` closing a body on any tag rather than its own.** The
 *   entire reason named tags exist is a body containing `$$`; without one in
 *   the corpus the rule was unreachable. Pinned by a `$function$` body with a
 *   `$$` inside it.
 * - **The `public` half of the ACL knowledge test** (round-2 F1). Flipping the
 *   `&&` to `||` left all 516 tests green: every fixture revoked from `anon`
 *   *and* `public`, so the forgot-`public` case had no probe at all. Pinned by
 *   G12/G12b — and the test itself de-duplicated into one `aclKnownFor`, since
 *   two copies meant neither mutant moved the other's callers.
 * - **Expiry and revocation pinned only against ABSENCE** (round-2 F2). Every
 *   fixture removed the column outright, so relaxing either comparison to a
 *   bare-mention test stayed green — and `expiryCheckIssues`' own
 *   "mentioned but never compared" branch was dead code no probe produced.
 *   Pinned by G13, a reader returning both columns and testing neither.
 * - **Whole-row projection** (round-2 F3). The rule caught a literal `*` and
 *   nothing else, so `to_jsonb(r)`, `row_to_json(r)`, `jsonb_agg(r)`, bare
 *   `select r`, and `r.*` inside a builder each returned **zero** findings
 *   from the full sweep — a bypass easier to write than the thing the rule
 *   caught. Pinned by G14, one probe per spelling, each clause of the widened
 *   rule separately mutation-verified.
 * - **`security_invoker` present but `false`.** Testing for the option's
 *   presence accepts the value that turns it off — the F1 lesson on a view
 *   option. Pinned by G15c.
 *
 * refs specs/002-montero-garage (SHR-01, SHR-05, SHR-06, SHR-07, SHR-08)
 * ====================================================================== */

/**
 * The reference share reader: everything the spec asks for, spelled the way
 * T2-404's architecture record says it will be spelled.
 *
 * The positive control for all five function rules at once. Without it, every
 * rejection below is satisfied by a rule that dislikes functions.
 */
const CORRECT_SHARE_READER = sql(`
  create function public.share_read_records(p_token text)
  returns table (id uuid, occurred_on date, kind text)
  language sql
  stable
  security definer
  set search_path = ''
  as $share$
    select r.id, r.occurred_on, r.kind
    from public.records r
    join public.shares s on s.vehicle_id = r.vehicle_id
    where s.token_hash = extensions.digest(p_token, 'sha256')
      and s.revoked_at is null
      and s.expires_at > now();
  $share$;

  revoke all on function public.share_read_records(text) from public;
  revoke all on function public.share_read_records(text) from authenticated;
  grant execute on function public.share_read_records(text) to anon;
`);

/**
 * G17 — **PR #74 review**: the right name in the wrong schema.
 *
 * Byte-for-byte the reference reader with `public.` changed to `private.` in
 * the create and both grants. Everything about it is otherwise impeccable: it
 * hashes, it checks expiry and revocation, it names its columns, it is
 * `security definer` with a pinned `search_path`. **Not one body rule can
 * reject it** — which is exactly what makes it the right probe for a
 * schema-scoping bug, because only the allow-list can be what catches it.
 *
 * Before the fix it satisfied both halves at once: the `unexpected` filter
 * saw a declared reader's name and waved an anon-executable definer function
 * through, and the `missing` filter counted it as the public reader being
 * present.
 */
const G17_WRONG_SCHEMA_READER = sql(`
  create function private.share_read_records(p_token text)
  returns table (id uuid, occurred_on date, kind text)
  language sql
  stable
  security definer
  set search_path = ''
  as $share$
    select r.id, r.occurred_on, r.kind
    from public.records r
    join public.shares s on s.vehicle_id = r.vehicle_id
    where s.token_hash = extensions.digest(p_token, 'sha256')
      and s.revoked_at is null
      and s.expires_at > now();
  $share$;

  revoke all on function private.share_read_records(text) from public;
  revoke all on function private.share_read_records(text) from authenticated;
  grant execute on function private.share_read_records(text) to anon;
`);

/** The one routine in the correct fixture, for the per-rule probes. */
function readerOf(fixture: string): FunctionDefinition {
  const [routine] = functions(fixture);
  if (!routine) throw new Error("fixture declares no function");
  return routine;
}

/** Rewrite one line of the reference reader — one property broken at a time. */
function brokenReader(from: string, to: string): string {
  const broken = CORRECT_SHARE_READER.replace(from, to);
  if (broken === CORRECT_SHARE_READER) {
    throw new Error(`probe fixture did not change: "${from}" not found`);
  }
  return broken;
}

/** G1 — a definer routine that leaves the search path to its caller. */
const G1_DEFINER_NO_SEARCH_PATH = brokenReader("set search_path = '' ", "");

/** G2 — a reader that never asks whether the grant has expired (SHR-08). */
const G2_NO_EXPIRY_CHECK = brokenReader("and s.expires_at > now()", "");

/** G3 — a reader that cannot be revoked. The likeliest defect (SHR-08). */
const G3_NO_REVOCATION_CHECK = brokenReader("and s.revoked_at is null", "");

/** G4 — row projection where SHR-06 requires column projection. */
const G4_SELECT_STAR = brokenReader(
  "select r.id, r.occurred_on, r.kind",
  "select r.*"
);

/** G5 — the token compared against a column that holds it in the clear. */
const G5_RAW_TOKEN = brokenReader(
  "s.token_hash = extensions.digest(p_token, 'sha256')",
  "s.token = p_token"
);

/** G6 — the return shape *is* the user table, so no column can be omitted. */
const G6_SETOF_USER_TABLE = sql(`
  create function public.share_read_records(p_token text)
  returns setof public.records
  language sql
  stable
  security definer
  set search_path = ''
  as $share$
    select r.id, r.occurred_on
    from public.records r
    join public.shares s on s.vehicle_id = r.vehicle_id
    where s.token_hash = extensions.digest(p_token, 'sha256')
      and s.revoked_at is null
      and s.expires_at > now();
  $share$;

  revoke all on function public.share_read_records(text) from public;
  grant execute on function public.share_read_records(text) to anon;
`);

/** G7 — the accountless path admitting a write (SHR-07). */
const G7_ANON_WRITE = sql(`
  create function public.share_note(p_token text, p_body text)
  returns void
  language plpgsql
  security definer
  set search_path = ''
  as $share$
  begin
    insert into public.records (vehicle_id, kind)
    select s.vehicle_id, 'note'
    from public.shares s
    where s.token_hash = extensions.digest(p_token, 'sha256')
      and s.revoked_at is null
      and s.expires_at > now();
  end;
  $share$;

  revoke all on function public.share_note(text, text) from public;
  grant execute on function public.share_note(text, text) to anon;
`);

/**
 * G8 — a definer routine nobody revoked.
 *
 * The quiet one. Postgres grants EXECUTE on a new function to `PUBLIC` by
 * default, so this is reachable by `anon` in the running database while the
 * migration text says nothing at all. A replay that read silence as "not
 * granted" would report it clean, which is the shape of the near-miss T2-202's
 * review found on the table side — the privilege that nearly shipped a hole
 * was one **nobody granted**.
 */
const G8_NEVER_REVOKED = sql(`
  create function public.share_read_everything(p_token text)
  returns table (id uuid)
  language sql
  security definer
  set search_path = ''
  as $share$ select r.id from public.records r; $share$;
`);

/**
 * G9 — **the recorded defect (1)**: a revoke, then a grant that undoes it.
 *
 * The grader this replaced counted statements matching
 * `^revoke … from … anon` and asserted the count was above zero. This
 * directory scores 1 and passed — verified 2026-08-31.
 */
const G9_REVOKE_THEN_GRANT = sql(`
  revoke all on public.records from anon;
  revoke all on public.records from public;
  revoke all on public.records from authenticated;
  grant select, insert, update, delete on public.records to authenticated;
  grant select on public.records to anon;
`);

/** G9b — the same directory without the undo. The control. */
const G9B_REVOKE_ONLY = sql(`
  revoke all on public.records from anon;
  revoke all on public.records from public;
  revoke all on public.records from authenticated;
  grant select, insert, update, delete on public.records to authenticated;
`);

/**
 * G26 — **T2-401 review, F1**: the same leak, spelled with identifier quotes.
 *
 * `grant select on public.records to "anon";` is valid SQL and means exactly
 * what G9's last line means. Before the fix, `parseRoles` kept the quotes, so
 * the role was recorded as the literal `"anon"`, matched nothing in
 * `ANONYMOUS_ROLES`, and **every rule built on the grant replay returned zero
 * findings** — verified by direct execution against the shipped parser.
 *
 * Two characters, and the whole of T2-401a is switched off. That is why the
 * variants below are a table rather than one probe: the bypass is available at
 * every call site that names a role, so each of them is asked.
 */
const G26_QUOTED_ROLE_GRANT = sql(`
  revoke all on public.records from anon;
  revoke all on public.records from public;
  revoke all on public.records from authenticated;
  grant select, insert, update, delete on public.records to authenticated;
  grant select on public.records to "anon";
`);

/** G26b — quoted `"public"`, which reaches `anon` without naming it. */
const G26B_QUOTED_PUBLIC_GRANT = sql(`
  revoke all on public.records from anon;
  revoke all on public.records from public;
  revoke all on public.records from authenticated;
  grant select, insert, update, delete on public.records to authenticated;
  grant select on public.records to "public";
`);

/** G26c — the default-privileges half, quoted (T2-401's own new rule). */
const G26C_QUOTED_ADP_GRANT = sql(`
  alter default privileges in schema public grant select on tables to "anon";
`);

/** G26d — a quoted role in a bulk grant over a quoted schema. */
const G26D_QUOTED_BULK_GRANT = sql(`
  create table public.records (id uuid primary key);
  revoke all on public.records from anon;
  revoke all on public.records from public;
  revoke all on public.records from authenticated;
  grant select, insert, update, delete on public.records to authenticated;
  grant select on all tables in schema "public" to "anon";
`);

/** G26e — a quoted role on an anon-executable function. */
const G26E_QUOTED_FUNCTION_GRANT = sql(`
  create function public.share_read_everything(p_token text)
  returns table (id uuid)
  language sql stable security definer set search_path = ''
  as $share$ select r.id from public.records r; $share$;

  revoke all on function public.share_read_everything(text) from public;
  grant execute on function public.share_read_everything(text) to "anon";
`);

/** G26f — a quoted role on a policy. */
const G26F_QUOTED_POLICY_ROLE = sql(`
  create table public.records (id uuid primary key, vehicle_id uuid not null);
  alter table public.records enable row level security;
  alter table public.records force row level security;
  create policy "records readable" on public.records
    for select to "anon" using (true);
`);

/**
 * G10 — **the recorded defect (2)**: a fifth user table nothing enumerates.
 *
 * `for all to anon using (true)` and no `force`. Every table-level grader is
 * driven from `contract.ts`, so this produced zero findings — verified
 * 2026-08-31.
 */
const G10_FIFTH_TABLE = sql(`
  create table public.shares (
    id uuid primary key,
    vehicle_id uuid not null,
    token_hash bytea not null
  );
  alter table public.shares enable row level security;
  create policy "shares readable" on public.shares
    for all to anon using (true);
`);

/**
 * G12 — **round-2 F1**: a directory that revokes from `anon` and forgets
 * `public`.
 *
 * The half of the tri-state that had no probe at all. `public` is not a role
 * beside `anon` — it is every role — so a privilege `public` inherited from
 * Supabase's role setup still reaches `anon`, and `revoke … from anon` does
 * not touch it. The end-state ACL here is genuinely **unknown**, and the
 * review proved the gap by flipping the `&&` in the knowledge test to `||` in
 * either copy and watching all 516 garage tests stay green.
 */
const G12_REVOKE_ANON_ONLY = sql(`
  revoke all on public.records from anon;
  grant select, insert, update, delete on public.records to authenticated;
`);

/** G12b — a definer routine with the same omission. */
const G12B_FUNCTION_REVOKE_ANON_ONLY = sql(`
  create function public.share_read_records(p_token text)
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

  revoke all on function public.share_read_records(text) from anon;
`);

/**
 * G13 — **round-2 F2**: the columns are *returned* and never *tested*.
 *
 * The realistic defect shape, and the one the rules were not pinned against:
 * every earlier probe removed the column entirely, so relaxing either
 * comparison regex to a bare-mention test left the suite green. A reader that
 * selects `expires_at` and `revoked_at` into its output — so a caller can see
 * them — while filtering on neither is a grant that never expires and cannot
 * be revoked, and it reads as careful.
 */
const G13_MENTIONED_NEVER_COMPARED = sql(`
  create function public.share_read_records(p_token text)
  returns table (id uuid, expires_at timestamptz, revoked_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
  as $share$
    select r.id, s.expires_at, s.revoked_at
    from public.records r
    join public.shares s on s.vehicle_id = r.vehicle_id
    where s.token_hash = extensions.digest(p_token, 'sha256');
  $share$;

  revoke all on function public.share_read_records(text) from public;
  grant execute on function public.share_read_records(text) to anon;
`);

/**
 * G14 — **round-2 F3**: whole-row projection, in every spelling that is not a
 * literal `*`.
 *
 * Each of these returns every column of `records`, and every one of them
 * produced **zero** findings from the full `anonSurfaceIssues` sweep. That is
 * a bypass easier to write than the thing the rule caught.
 */
const G14_WHOLE_ROW_SPELLINGS = [
  ["to_jsonb", "select to_jsonb(r)"],
  ["to_jsonb(r.*)", "select to_jsonb(r.*)"],
  ["row_to_json", "select row_to_json(r)"],
  ["jsonb_agg", "select jsonb_agg(r)"],
  ["bare alias", "select r"],
  ["alias.*", "select r.*"],
  // `r.*` buried in a builder that is NOT a whole-row serialiser. Its own
  // entry because it is the only spelling the literal-`*` check and the
  // serialiser check both miss — mutation-verified: dropping the `alias.*`
  // rule while every other probe stayed green (round-2 self-check).
  ["alias.* inside a builder", "select jsonb_build_object('all', r.*)"],
] as const;

const DEFAULT_READER_FROM =
  "from public.records r join public.shares s on s.vehicle_id = r.vehicle_id";

function wholeRowReader(
  projection: string,
  from: string = DEFAULT_READER_FROM
): string {
  return sql(`
    create function public.share_read_records(p_token text)
    returns jsonb
    language sql
    stable
    security definer
    set search_path = ''
    as $share$
      ${projection}
      ${from}
      where s.token_hash = extensions.digest(p_token, 'sha256')
        and s.revoked_at is null
        and s.expires_at > now();
    $share$;

    revoke all on function public.share_read_records(text) from public;
    grant execute on function public.share_read_records(text) to anon;
  `);
}

/**
 * G16 — **round-2 D2**: the `from`-clause shapes `rowAliases` used to miss.
 *
 * Each binds a relation the old single-regex version never saw, and in each
 * the whole-row projection over that relation produced **zero** findings.
 * Confirmed against the shipped rule before the fix rather than derived from
 * reading it — the same discipline as the two recorded grader defects.
 */
const G16_MISSED_ALIAS_SHAPES = [
  [
    "comma join, second relation",
    "select to_jsonb(s)",
    "from public.records r, public.shares s",
  ],
  [
    "unaliased first relation, then join",
    "select to_jsonb(s)",
    "from public.records join public.shares s on s.id = records.id",
  ],
  [
    "subquery alias",
    "select to_jsonb(x)",
    "from (select r.id, r.kind from public.records r) x join public.shares s on true",
  ],
] as const;

/** G15 — a view that runs as its owner, so RLS is evaluated against the owner. */
const G15_VIEW_WITHOUT_INVOKER = sql(`
  create view public.vehicle_state as
    select v.id, v.display_name from public.vehicles v;
`);

/** G15b — the same view, declared to run as its caller. */
const G15B_VIEW_WITH_INVOKER = sql(`
  create view public.vehicle_state with (security_invoker = true) as
    select v.id, v.display_name from public.vehicles v;
`);

/**
 * G15c — the option present and switched **off**.
 *
 * Its own fixture because "mentions security_invoker" and "runs as the
 * caller" are different claims, and only the second one is the guarantee.
 * Mutation-verified: relaxing the rule to a bare mention of the option
 * survived G15 and G15b together (round-2 self-check).
 */
const G15C_VIEW_INVOKER_FALSE = sql(`
  create view public.vehicle_state with (security_invoker = false) as
    select v.id, v.display_name from public.vehicles v;
`);

/** G11 — the bearer secret stored in the clear. */
const G11_PLAINTEXT_TOKEN_COLUMN = sql(`
  create table public.shares (
    id uuid primary key,
    token text not null unique,
    expires_at timestamptz not null
  );
  alter table public.shares enable row level security;
  alter table public.shares force row level security;
`);

describe("WIDE-OPEN: the function surface", () => {
  it("G1 rejects a `security definer` routine with no `set search_path`", () => {
    expect(
      definerSearchPathIssues(G1_DEFINER_NO_SEARCH_PATH).join(" | ")
    ).toContain("no `set search_path`");
  });

  it("G1 rejects `set search_path = public` too — it is not empty", () => {
    // `public` is a schema a caller may be able to create objects in. The
    // rule accepts `''` and `pg_catalog` and nothing else.
    const toPublic = brokenReader(
      "set search_path = ''",
      "set search_path = public"
    );

    expect(definerSearchPathIssues(toPublic).join(" | ")).toContain(
      "must be ''"
    );
  });

  it("G1: the reference reader passes the same rule", () => {
    // Positive control. A rule that rejected every definer routine would
    // satisfy both assertions above and mean nothing.
    expect(definerSearchPathIssues(CORRECT_SHARE_READER)).toEqual([]);
  });

  it("G2 rejects a reader that never tests expires_at", () => {
    expect(
      expiryCheckIssues(readerOf(G2_NO_EXPIRY_CHECK)).join(" | ")
    ).toContain("does not test expires_at");
  });

  it("G2 fails ONLY the expiry rule — the triple is three findings", () => {
    // The whole reason the token triple is three graders. Dropping the expiry
    // check must not disturb the hash rule or the revocation rule, or a
    // reviewer reading one red test cannot tell which property is missing.
    const routine = readerOf(G2_NO_EXPIRY_CHECK);

    expect(tokenHashIssues(routine)).toEqual([]);
    expect(revocationCheckIssues(routine)).toEqual([]);
    expect(expiryCheckIssues(routine)).not.toEqual([]);
  });

  it("G3 rejects a grant that cannot be revoked", () => {
    expect(
      revocationCheckIssues(readerOf(G3_NO_REVOCATION_CHECK)).join(" | ")
    ).toContain("does not test revoked_at");
  });

  it("G3 fails ONLY the revocation rule", () => {
    // The likeliest real defect, and the one that hand-testing cannot find: a
    // grant you have not revoked behaves identically whether or not the
    // reader reads `revoked_at`.
    const routine = readerOf(G3_NO_REVOCATION_CHECK);

    expect(tokenHashIssues(routine)).toEqual([]);
    expect(expiryCheckIssues(routine)).toEqual([]);
    expect(revocationCheckIssues(routine)).not.toEqual([]);
  });

  it("G4 rejects `select *` in an anon-reachable routine", () => {
    expect(projectionIssues(readerOf(G4_SELECT_STAR)).join(" | ")).toContain(
      "selects `*`"
    );
  });

  it("G5 rejects a raw-token comparison", () => {
    const issues = tokenHashIssues(readerOf(G5_RAW_TOKEN)).join(" | ");

    expect(issues).toContain("plaintext token column");
    expect(issues).toContain("never hashes the token");
  });

  it("G5: `token_hash` is not read as the plaintext column `token`", () => {
    // The word-boundary case, and it decides the whole rule: if `\btoken\b`
    // matched inside `token_hash`, the correct reader would be rejected and
    // the rule would be turned off within a day.
    expect(tokenHashIssues(readerOf(CORRECT_SHARE_READER))).toEqual([]);
  });

  it("G6 rejects `returns setof` a user table", () => {
    expect(
      projectionIssues(readerOf(G6_SETOF_USER_TABLE)).join(" | ")
    ).toContain("returns `setof records`");
  });

  it("G6: the finding is about the RETURN shape, not the body", () => {
    // The body names its columns. Only the return type is wrong — so if this
    // ever starts passing, it is the `returns` parser that broke, not the
    // select-star rule covering for it.
    const routine = readerOf(G6_SETOF_USER_TABLE);

    expect(routine.body).not.toMatch(/select\s+[a-z]*\.?\*/);
    expect(projectionIssues(routine)).toHaveLength(1);
  });

  it("G7 rejects a write on the accountless path (SHR-07)", () => {
    expect(anonWriteIssues(readerOf(G7_ANON_WRITE)).join(" | ")).toContain(
      "performs a insert"
    );
  });

  it("G7: a read-only reader is not accused of writing", () => {
    expect(anonWriteIssues(readerOf(CORRECT_SHARE_READER))).toEqual([]);
  });

  it("G8 counts a NEVER-REVOKED routine as anon-reachable", () => {
    // Postgres grants EXECUTE to PUBLIC by default. Silence in the migration
    // text is not evidence of absence, and a security rule that treats it as
    // such is decorative.
    expect(
      anonExecutableFunctions(G8_NEVER_REVOKED).map((routine) => routine.name)
    ).toEqual(["share_read_everything"]);
  });

  it("G8 is caught by the closed allow-list, by name", () => {
    const { unexpected } = anonFunctionAllowListIssues(G8_NEVER_REVOKED, [
      "share_read_records",
    ]);

    expect(unexpected.join(" | ")).toContain("share_read_everything");
    expect(unexpected.join(" | ")).toContain("security definer");
  });

  it("G8: adding the revokes takes it back off the anon surface", () => {
    // The control for the tri-state. If `unknown` and `none` were the same
    // answer, this pair would agree and the rule would be reporting on
    // nothing.
    const revoked = `${G8_NEVER_REVOKED} revoke all on function public.share_read_everything(text) from public; revoke all on function public.share_read_everything(text) from anon;`;

    expect(anonExecutableFunctions(revoked)).toEqual([]);
  });
});

describe("WIDE-OPEN: the two recorded grader defects", () => {
  it("G9 rejects revoke-then-grant — the END-STATE ACL, not a count", () => {
    expect(
      tableGrantIssues(G9_REVOKE_THEN_GRANT, ["records"]).join(" | ")
    ).toContain("anon holds select");
  });

  it("G9: the grader this replaced scores it 1 and passes — the false pass", () => {
    // Recorded verbatim so the regression cannot come back as a "simplification".
    // The old rule was: count statements matching this pattern, assert > 0.
    const revokes = statements(G9_REVOKE_THEN_GRANT).filter((statement) =>
      /^revoke\b[\s\S]*\bfrom\b[\s\S]*\banon\b/.test(statement)
    );

    expect(revokes.length).toBeGreaterThan(0); // the old grader's verdict: PASS
    expect(tableGrantIssues(G9_REVOKE_THEN_GRANT, ["records"])).not.toEqual([]); // the new one: FAIL
  });

  it("G9b: the same directory without the undo is accepted", () => {
    expect(tableGrantIssues(G9B_REVOKE_ONLY, ["records"])).toEqual([]);
  });

  it("G9: order is what distinguishes them", () => {
    // Both directories contain the same two statements. Only the order
    // differs, and the whole point of a replay is that the order decides.
    const grantThenRevoke = sql(`
      grant select on public.records to anon;
      revoke all on public.records from anon;
      revoke all on public.records from public;
    `);
    const state = grants(grantThenRevoke);

    expect(privilegeVerdict(state, "public.records", "anon", "select")).toBe(
      "none"
    );
    expect(
      privilegeVerdict(
        grants(G9_REVOKE_THEN_GRANT),
        "public.records",
        "anon",
        "select"
      )
    ).toBe("granted");
  });

  it("G9: a grant to `public` reaches anon, and a revoke from anon does not undo it", () => {
    // `public` is not a role beside `anon` — it is every role. This is the
    // spelling of the same hole that looks most like a fix.
    const state = grants(
      sql(`
        revoke all on public.records from anon;
        grant select on public.records to public;
      `)
    );

    expect(privilegeVerdict(state, "public.records", "anon", "select")).toBe(
      "granted"
    );
  });

  it("G9: authenticated holding TRUNCATE is a finding — RLS does not filter it", () => {
    // T2-202's review emptied `profiles` as `authenticated` against a schema
    // whose declaration graders were all green.
    const truncatable = sql(`
      revoke all on public.records from anon;
      revoke all on public.records from public;
      revoke all on public.records from authenticated;
      grant select, insert, update, delete, truncate on public.records to authenticated;
    `);

    expect(tableGrantIssues(truncatable, ["records"]).join(" | ")).toContain(
      "truncate"
    );
  });

  it("G9: an ACL nothing ever emptied is reported UNKNOWN, not clean", () => {
    // The T2-202 lesson in one assertion: `grant select, … to authenticated`
    // *adds to* whatever Supabase already granted. A directory that grants
    // without revoking first has an ACL this module cannot see, and saying so
    // is the only honest answer.
    const noRevoke = sql(`
      grant select, insert, update, delete on public.records to authenticated;
    `);

    expect(tableGrantIssues(noRevoke, ["records"]).join(" | ")).toContain(
      "unknown"
    );
  });

  /**
   * The enumerated list as it stood when G10 was recorded — the four tables
   * T2-202 shipped.
   *
   * Passed explicitly rather than read from `USER_TABLE_NAMES`, because
   * T2-401 added `shares` to the contract (pending T2-404) and the live list
   * therefore no longer reproduces the defect. A probe that grades a rule must
   * not silently become a probe that grades the contract: this keeps G10
   * asking "is a table outside the list invisible?", which is the question the
   * rule exists to answer, for as long as the rule exists.
   */
  const ENUMERATED_BEFORE_G10 = [
    "profiles",
    "vehicles",
    "records",
    "receipts",
  ] as const;

  it("G10 rejects a fifth table nothing enumerates", () => {
    const issues = ungradedTableIssues(G10_FIFTH_TABLE, {
      enumerated: ENUMERATED_BEFORE_G10,
    }).join(" | ");

    expect(issues).toContain("public.shares");
    expect(issues).toContain("not enumerated in USER_TABLES");
    expect(issues).toContain("not FORCED");
  });

  it("G10: the graders it dodges report nothing about it — the false pass", () => {
    // Recorded verbatim. `userTablePolicyIssues` filters to the enumerated
    // list, so the wide-open `for all to anon using (true)` policy on `shares`
    // is invisible to it. The finding has to come from the other direction —
    // from what the directory *creates*.
    const blind = userTablePolicyIssues(G10_FIFTH_TABLE, ENUMERATED_BEFORE_G10);

    expect(blind.filter((issue) => issue.includes("shares"))).toEqual([]);
    expect(
      ungradedTableIssues(G10_FIFTH_TABLE, {
        enumerated: ENUMERATED_BEFORE_G10,
      })
    ).not.toEqual([]);
  });

  it("G10: the contract now enumerates `shares` — the defect is closed", () => {
    // The other half of the historical note, and the reason the probes above
    // pass their list explicitly. T2-401 declared `shares` in `USER_TABLES` as
    // a pending entry, so the live default no longer reports it as ungraded —
    // which is the fix working, not the rule weakening. Asserted here so that
    // if `shares` were ever quietly dropped from the contract, this file says
    // so rather than the G10 probes silently starting to grade the contract
    // instead of the rule.
    expect([...USER_TABLE_NAMES]).toContain("shares");
    expect(ungradedTableIssues(G10_FIFTH_TABLE).join(" | ")).not.toContain(
      "not enumerated"
    );
  });

  it("G10: enumerating the table clears the enumeration finding, not the RLS one", () => {
    // The fix is to grade it, not to list it. A table added to `USER_TABLES`
    // still has to force RLS.
    const issues = ungradedTableIssues(G10_FIFTH_TABLE, {
      enumerated: [...USER_TABLE_NAMES, "shares"],
    }).join(" | ");

    expect(issues).not.toContain("not enumerated");
    expect(issues).toContain("not FORCED");
  });

  it("G10: a NAMED exemption is accepted, an unnamed one is not", () => {
    // The `EXEMPT_PAGES` mechanism, graded against a synthetic map so the
    // real one can stay empty and still be proven to work.
    const exempt = new Map([["shares", "not user data — a synthetic probe"]]);

    expect(ungradedTableIssues(G10_FIFTH_TABLE, { exempt })).toEqual([]);
    expect(
      ungradedTableIssues(G10_FIFTH_TABLE, { exempt: new Map() })
    ).not.toEqual([]);
  });

  it("G10: a correctly declared table produces nothing", () => {
    const correct = sql(`
      create table public.records (id uuid primary key);
      alter table public.records enable row level security;
      alter table public.records force row level security;
    `);

    expect(ungradedTableIssues(correct)).toEqual([]);
  });

  it("G12 rejects a revoke that forgets `public` — the ACL is UNKNOWN", () => {
    // Round-2 F1. Revoking from `anon` alone says nothing about what `anon`
    // can do, because a privilege `public` holds reaches every role.
    const state = grants(G12_REVOKE_ANON_ONLY);

    expect(rolePrivileges(state, "public.records", "anon").verdict).toBe(
      "unknown"
    );
    expect(privilegeVerdict(state, "public.records", "anon", "select")).toBe(
      "unknown"
    );
    expect(
      tableGrantIssues(G12_REVOKE_ANON_ONLY, ["records"]).join(" | ")
    ).toContain("nothing revokes public's inherited privileges");
  });

  it("G12: GRANT ALL then a PARTIAL revoke reports unknown, never none", () => {
    // Locks in the answer to PR #74's third thread, and it is worth stating
    // precisely because the intuitive reading is wrong in a reassuring
    // direction.
    //
    // `grant all` records the token `all`; this module never expands it into
    // the concrete privilege list, because that list is a Postgres version
    // detail and guessing it would be inventing knowledge. So a later
    // `revoke select` cannot subtract from it accurately, and the replay drops
    // the whole entry rather than pretend — leaving every privilege on this
    // object "unknown", *including the ones `all` plainly granted*.
    //
    // That is over-reporting, which is the safe direction and the one every
    // caller treats as a finding. What it must never do is answer "none":
    // a partial revoke is not evidence that an ACL is understood, and reading
    // it that way would clear a role that still holds `insert` and `truncate`.
    const partial = sql(`
      grant all on public.records to anon;
      revoke select on public.records from anon;
    `);
    const state = grants(partial);

    for (const privilege of ["select", "insert", "truncate"]) {
      expect(
        privilegeVerdict(state, "public.records", "anon", privilege),
        privilege
      ).not.toBe("none");
    }
    expect(tableGrantIssues(partial, ["records"]).join(" | ")).toContain(
      "unknown"
    );
  });

  it("G12: adding the `public` revoke is what makes the answer knowable", () => {
    // The control. One statement is the entire difference between "unknown"
    // and "none", and if this pair ever agrees the tri-state has collapsed.
    const complete = `${G12_REVOKE_ANON_ONLY} revoke all on public.records from public; revoke all on public.records from authenticated;`;

    expect(
      rolePrivileges(grants(complete), "public.records", "anon").verdict
    ).toBe("none");
    expect(tableGrantIssues(complete, ["records"])).toEqual([]);
  });

  it("G12b: a definer routine revoked from anon only stays anon-reachable", () => {
    // The same omission on the surface where it costs most. The routine looks
    // locked down — there is a revoke, and it names `anon` — and `public`
    // still holds Postgres's default EXECUTE.
    expect(
      anonExecutableFunctions(G12B_FUNCTION_REVOKE_ANON_ONLY).map(
        (routine) => routine.name
      )
    ).toEqual(["share_read_records"]);
    expect(
      anonFunctionAllowListIssues(
        G12B_FUNCTION_REVOKE_ANON_ONLY,
        []
      ).unexpected.join(" | ")
    ).toContain("security definer");
  });

  it("G13 rejects columns that are RETURNED but never TESTED", () => {
    // Round-2 F2. Every earlier probe removed the column outright, so the
    // rules were pinned only against absence — relaxing either comparison to
    // a bare-mention test left the suite green.
    const routine = readerOf(G13_MENTIONED_NEVER_COMPARED);

    expect(expiryCheckIssues(routine).join(" | ")).toContain(
      "mentioned but never compared"
    );
    expect(revocationCheckIssues(routine).join(" | ")).toContain(
      "cannot be revoked"
    );
  });

  it("G13: the hash check is fine — only the two time rules fire", () => {
    // Each fixture must fail for the reason it was written. This one hashes
    // correctly and projects named columns; only expiry and revocation are
    // missing.
    const routine = readerOf(G13_MENTIONED_NEVER_COMPARED);

    expect(tokenHashIssues(routine)).toEqual([]);
    expect(projectionIssues(routine)).toEqual([]);
  });

  it.each(G14_WHOLE_ROW_SPELLINGS)(
    "G14 rejects whole-row projection spelled `%s`",
    (_label, projection) => {
      // Round-2 F3. Every one of these returns every column of `records` and
      // every one produced zero findings before the rule was widened.
      const fixture = wholeRowReader(projection);

      expect(projectionIssues(readerOf(fixture))).not.toEqual([]);
      // And it is caught by the sweep a reviewer actually reads, not only by
      // the rule in isolation.
      expect(anonSurfaceIssues(fixture)).not.toEqual([]);
    }
  );

  it("G14: a named-column projection over the same query is accepted", () => {
    // The control for the widened rule. `r.id, r.occurred_on` names its
    // columns and must stay clean, or the rule is simply refusing joins.
    const named = wholeRowReader("select r.id, r.occurred_on");

    expect(projectionIssues(readerOf(named))).toEqual([]);
    expect(anonSurfaceIssues(named)).toEqual([]);
  });

  it("G14: rowAliases reads the aliases the whole-row rules depend on", () => {
    // If this returned nothing, every whole-row check above would be vacuous
    // and the `it.each` would be asserting that literal `*` is still caught.
    expect(
      rowAliases(
        "select r.id from public.records r join public.shares s on s.vehicle_id = r.vehicle_id"
      )
    ).toEqual(["r", "s"]);
  });

  it("G14: a keyword after a table name is not read as an alias", () => {
    // `from public.records where …` must not bind `where` as a row alias, or
    // the rule starts hunting for `where.*` and misses the real one.
    expect(rowAliases("select id from public.records where id = 1")).toEqual([
      "records",
    ]);
  });

  it.each(G16_MISSED_ALIAS_SHAPES)(
    "G16 rejects whole-row projection over a %s",
    (_label, projection, from) => {
      expect(
        projectionIssues(readerOf(wholeRowReader(projection, from)))
      ).not.toEqual([]);
    }
  );

  it("G16: the subquery-alias finding is NOT coming from a literal `*`", () => {
    // The honest version of the reviewer's third shape. Before D2 this was
    // caught only when the subquery happened to contain `select *`; with named
    // inner columns it was invisible. The fixture below names every inner
    // column, so the literal-`*` clause cannot be what rejects it — the alias
    // binding is.
    const fixture = wholeRowReader(
      "select to_jsonb(x)",
      "from (select r.id, r.kind from public.records r) x join public.shares s on true"
    );
    const routine = readerOf(fixture);

    expect(routine.body).not.toMatch(/\*/);
    expect(rowAliases(routine.body)).toContain("x");
    expect(projectionIssues(routine).join(" | ")).toContain("to_jsonb(x)");
  });

  it.each(G16_MISSED_ALIAS_SHAPES)(
    "G16 CONTROL: naming the columns over the same %s is accepted",
    (_label, _projection, from) => {
      // Binding more relations must not make the rule reject correct queries —
      // over-binding is the safe direction only if it stays quiet on a named
      // projection.
      const named = wholeRowReader("select r.id, r.kind", from);

      expect(projectionIssues(readerOf(named))).toEqual([]);
    }
  );

  it.each<[string, string, string[]]>([
    [
      "aliased join",
      "select 1 from public.records r join public.shares s on true",
      ["r", "s"],
    ],
    [
      "comma join",
      "select 1 from public.records r, public.shares s",
      ["r", "s"],
    ],
    [
      "three-way comma join",
      "select 1 from public.records r, public.shares s, public.receipts t",
      ["r", "s", "t"],
    ],
    [
      "unaliased first relation",
      "select 1 from public.records join public.shares s on true",
      ["records", "s"],
    ],
    [
      "neither relation aliased",
      "select 1 from public.records join public.shares on true",
      ["records", "shares"],
    ],
    ["explicit AS", "select 1 from public.records as r", ["r"]],
    [
      "subquery alias binds the alias AND the inner relation",
      "select 1 from (select r.id from public.records r) x",
      ["x", "r"],
    ],
    [
      "lateral",
      "select 1 from public.records r, lateral (select 1) y",
      ["r", "y"],
    ],
    [
      "no alias at all",
      "select id from public.records where id = 1",
      ["records"],
    ],
  ])("G16 rowAliases binds %s", (_label, body, expected) => {
    // Graded directly as well as end-to-end: the whole-row rules are only as
    // good as this, and a regression here would make all of them quietly
    // vacuous rather than visibly wrong.
    expect(rowAliases(body).sort()).toEqual([...expected].sort());
  });

  it("G16: a keyword is still never bound as an alias", () => {
    // The half of the old behaviour that was right, and must survive the
    // rewrite: `from public.records where …` must not bind `where`.
    for (const keyword of ["where", "join", "left", "group", "order", "on"]) {
      expect(
        rowAliases(`select 1 from public.records ${keyword} x`),
        keyword
      ).not.toContain(keyword);
    }
  });

  it("G17 rejects an anon-executable impostor in another schema", () => {
    // PR #74 review, gap 1. The `unexpected` half is the one the PR body calls
    // live today, and a name-only comparison let a `security definer` routine
    // granted to `anon` through it on the strength of its name alone.
    const { unexpected } = anonFunctionAllowListIssues(
      G17_WRONG_SCHEMA_READER,
      ["share_read_records"]
    );

    expect(unexpected.join(" | ")).toContain(
      "private.share_read_records(text)"
    );
    expect(unexpected.join(" | ")).toContain("security definer");
    // And the finding says WHY, so a reviewer is not left comparing strings.
    expect(unexpected.join(" | ")).toContain("lives in private, not public");
  });

  it("G17: the impostor does not satisfy the COMPLETENESS half either", () => {
    // The same bug cutting the other way — the graders would have reported the
    // public reader present when only the wrong-schema one existed.
    const { missing } = anonFunctionAllowListIssues(G17_WRONG_SCHEMA_READER, [
      "share_read_records",
    ]);

    expect(missing).toEqual([
      "public.share_read_records: declared share reader does not exist in the migrations",
    ]);
  });

  it("G17 rejects the impostor at the SEAM GUARD too", () => {
    // PR #74 review, gap 2. `requireShareReaders` resolves through this, so a
    // pass here would hand every marked grader an object from a schema the
    // contract never described — and they would report on it as if it were the
    // real reader.
    const { found, missing } = findShareReaders(G17_WRONG_SCHEMA_READER, [
      "share_read_records",
    ]);

    expect(found).toEqual([]);
    expect(missing).toEqual(["public.share_read_records"]);
  });

  it("G17: NO body rule rejects it — the allow-list is the only thing that can", () => {
    // Attribution. The impostor is a correct reader in every respect except
    // its schema, so if any of these ever started firing, the probes above
    // would be passing for the wrong reason and the schema check could rot
    // underneath them unnoticed.
    const routine = readerOf(G17_WRONG_SCHEMA_READER);

    expect(tokenHashIssues(routine)).toEqual([]);
    expect(expiryCheckIssues(routine)).toEqual([]);
    expect(revocationCheckIssues(routine)).toEqual([]);
    expect(projectionIssues(routine)).toEqual([]);
    expect(anonWriteIssues(routine)).toEqual([]);
    expect(definerSearchPathIssues(G17_WRONG_SCHEMA_READER)).toEqual([]);
  });

  it("G17: isContractRoutine matches on schema AND name", () => {
    // The predicate both gaps resolve through, graded directly.
    const impostor = readerOf(G17_WRONG_SCHEMA_READER);
    const genuine = readerOf(CORRECT_SHARE_READER);

    expect(isContractRoutine(genuine, "share_read_records")).toBe(true);
    expect(isContractRoutine(impostor, "share_read_records")).toBe(false);
    // A right-schema routine with the wrong name is not a match either.
    expect(isContractRoutine(genuine, "share_read_vehicle")).toBe(false);
  });

  it("G15 rejects a view created without `security_invoker`", () => {
    // The option arrived in PG15 and defaults to `false`, so the default is
    // the unsafe direction: the view runs as its owner and RLS on the
    // underlying tables is evaluated against the owner, not the caller.
    expect(
      viewSecurityInvokerIssues(G15_VIEW_WITHOUT_INVOKER).join(" | ")
    ).toContain("public.vehicle_state");
  });

  it("G15b accepts a view that runs as its caller", () => {
    expect(viewSecurityInvokerIssues(G15B_VIEW_WITH_INVOKER)).toEqual([]);
  });

  it("G15c rejects `security_invoker = false` — mentioning it is not setting it", () => {
    // The F1 lesson applied to a view option: a rule that tests for the
    // presence of the word accepts the value that turns it off.
    expect(
      viewSecurityInvokerIssues(G15C_VIEW_INVOKER_FALSE).join(" | ")
    ).toContain("public.vehicle_state");
  });

  it("G15: a table is not asked for `security_invoker`", () => {
    // The rule applies to views only. If it fired on tables, the four real
    // user tables would light up and someone would delete the rule.
    expect(viewSecurityInvokerIssues(G10_FIFTH_TABLE)).toEqual([]);
  });

  it("G11 rejects a bearer secret stored in the clear", () => {
    expect(
      plaintextTokenColumnIssues(G11_PLAINTEXT_TOKEN_COLUMN).join(" | ")
    ).toContain("public.shares.token");
  });

  it("G11: `token_hash` is not mistaken for a plaintext column", () => {
    expect(plaintextTokenColumnIssues(G10_FIFTH_TABLE)).toEqual([]);
  });
});

describe("CORRECT: the reference share reader must be accepted", () => {
  it("is anon-reachable, and is the ONLY thing that is", () => {
    expect(
      anonExecutableFunctions(CORRECT_SHARE_READER).map(
        (routine) => routine.name
      )
    ).toEqual(["share_read_records"]);
  });

  it("satisfies the closed allow-list in both directions", () => {
    const { unexpected, missing } = anonFunctionAllowListIssues(
      CORRECT_SHARE_READER,
      ["share_read_records"]
    );

    expect(unexpected).toEqual([]);
    expect(missing).toEqual([]);
  });

  it("satisfies the seam guard — schema-scoping did not break the real thing", () => {
    // The control for G17. Tightening a matcher is only safe if the object it
    // exists to find still resolves.
    const { found, missing } = findShareReaders(CORRECT_SHARE_READER, [
      "share_read_records",
    ]);

    expect(missing).toEqual([]);
    expect(found.map((routine) => routine.identity)).toEqual([
      "public.share_read_records(text)",
    ]);
  });

  it("produces no finding from ANY of the anon-surface rules", () => {
    // The single assertion that would catch a rule which has become
    // over-strict. Every rejection above is only meaningful because this
    // passes.
    expect(anonSurfaceIssues(CORRECT_SHARE_READER)).toEqual([]);
  });

  it("parses as one definer routine with a pinned search path", () => {
    const routine = readerOf(CORRECT_SHARE_READER);

    expect(routine.identity).toBe("public.share_read_records(text)");
    expect(routine.securityDefiner).toBe(true);
    expect(routine.searchPath).toBe("''");
    expect(routine.returns).toContain("table (");
  });

  it("every wide-open function/grant probe produces at least one finding", () => {
    // The sweep, in the shape section A uses. A rule refactor that quietly
    // stopped detecting one of these would otherwise show up as one silent
    // green test.
    const verdicts: [string, string[]][] = [
      [
        "G1 definer no search_path",
        definerSearchPathIssues(G1_DEFINER_NO_SEARCH_PATH),
      ],
      ["G2 no expiry", expiryCheckIssues(readerOf(G2_NO_EXPIRY_CHECK))],
      [
        "G3 no revocation",
        revocationCheckIssues(readerOf(G3_NO_REVOCATION_CHECK)),
      ],
      ["G4 select star", projectionIssues(readerOf(G4_SELECT_STAR))],
      ["G5 raw token", tokenHashIssues(readerOf(G5_RAW_TOKEN))],
      ["G6 setof user table", projectionIssues(readerOf(G6_SETOF_USER_TABLE))],
      ["G7 anon write", anonWriteIssues(readerOf(G7_ANON_WRITE))],
      [
        "G8 never revoked",
        anonFunctionAllowListIssues(G8_NEVER_REVOKED, []).unexpected,
      ],
      [
        "G9 revoke then grant",
        tableGrantIssues(G9_REVOKE_THEN_GRANT, ["records"]),
      ],
      ["G10 fifth table", ungradedTableIssues(G10_FIFTH_TABLE)],
      [
        "G11 plaintext token",
        plaintextTokenColumnIssues(G11_PLAINTEXT_TOKEN_COLUMN),
      ],
      [
        "G12 revoke forgets public",
        tableGrantIssues(G12_REVOKE_ANON_ONLY, ["records"]),
      ],
      [
        "G12b definer revoked from anon only",
        anonFunctionAllowListIssues(G12B_FUNCTION_REVOKE_ANON_ONLY, [])
          .unexpected,
      ],
      [
        "G13 expiry mentioned never compared",
        expiryCheckIssues(readerOf(G13_MENTIONED_NEVER_COMPARED)),
      ],
      [
        "G13 revocation mentioned never compared",
        revocationCheckIssues(readerOf(G13_MENTIONED_NEVER_COMPARED)),
      ],
      ...G14_WHOLE_ROW_SPELLINGS.map(
        ([label, projection]): [string, string[]] => [
          `G14 whole row via ${label}`,
          anonSurfaceIssues(wholeRowReader(projection)),
        ]
      ),
      [
        "G15 view without security_invoker",
        viewSecurityInvokerIssues(G15_VIEW_WITHOUT_INVOKER),
      ],
      [
        "G15c view with security_invoker = false",
        viewSecurityInvokerIssues(G15C_VIEW_INVOKER_FALSE),
      ],
      ...G16_MISSED_ALIAS_SHAPES.map(
        ([label, projection, from]): [string, string[]] => [
          `G16 whole row over ${label}`,
          anonSurfaceIssues(wholeRowReader(projection, from)),
        ]
      ),
      [
        "G17 wrong-schema impostor (allow-list)",
        anonFunctionAllowListIssues(G17_WRONG_SCHEMA_READER, [
          "share_read_records",
        ]).unexpected,
      ],
      [
        "G17 wrong-schema impostor (seam guard)",
        findShareReaders(G17_WRONG_SCHEMA_READER, ["share_read_records"])
          .missing,
      ],
    ];

    expect(
      verdicts.filter(([, issues]) => issues.length === 0).map(([name]) => name)
    ).toEqual([]);
  });

  it("every correct function/grant probe produces none", () => {
    expect(
      [
        anonSurfaceIssues(CORRECT_SHARE_READER),
        definerSearchPathIssues(CORRECT_SHARE_READER),
        tableGrantIssues(G9B_REVOKE_ONLY, ["records"]),
        plaintextTokenColumnIssues(G10_FIFTH_TABLE),
        // Round-2 additions: the widened projection rule must still accept a
        // named-column projection, and the view rule a caller-scoped view.
        anonSurfaceIssues(wholeRowReader("select r.id, r.occurred_on")),
        viewSecurityInvokerIssues(G15B_VIEW_WITH_INVOKER),
      ].flat()
    ).toEqual([]);
  });
});

/* =========================================================================
 * E. The function/grant parsers underneath, graded directly
 * ====================================================================== */

describe("dollar-quoted bodies", () => {
  it("does not split a statement on a `;` inside a NAMED dollar tag", () => {
    // `$$` was the only tag the first version understood. `pg_dump` writes a
    // named tag whenever the body could contain `$$`, and a named tag made
    // every `;` in a plpgsql body a statement boundary — so every
    // function-level rule read a fragment.
    const named = sql(`
      create function public.f() returns void language plpgsql as $body$
      begin
        insert into public.t values (1);
        insert into public.t values (2);
      end;
      $body$;
      grant execute on function public.f() to anon;
    `);

    expect(statements(named)).toHaveLength(2);
    expect(functions(named)).toHaveLength(1);
  });

  it("still handles the plain `$$` spelling", () => {
    const plain = sql(`
      create function public.f() returns void language plpgsql as $$
      begin
        insert into public.t values (1);
      end;
      $$;
    `);

    expect(statements(plain)).toHaveLength(1);
    expect(functions(plain)[0].body).toContain("insert into public.t");
  });

  it("does not mistake a plpgsql positional parameter for a tag", () => {
    // `$1` is not a dollar quote. If it were read as one, everything after it
    // would vanish into a body that never closes.
    const positional = sql(`
      create function public.f(a int) returns int language sql as $$ select $1; $$;
      grant execute on function public.f(int) to anon;
    `);

    expect(statements(positional)).toHaveLength(2);
  });

  it.each<[string, number, string | null]>([
    ["$$", 0, "$$"],
    ["$body$", 0, "$body$"],
    ["$_x9$", 0, "$_x9$"],
    // A tag name must start with a letter or underscore. Without that, `$1`
    // is a tag and everything after a positional parameter disappears into a
    // body that never closes — and `statements()` returns one giant fragment
    // that no rule can read. Mutation-verified: relaxing the first character
    // survives every end-to-end probe, so it is pinned here directly.
    ["$1", 0, null],
    ["$1$", 0, null],
    ["select $1", 7, null],
    ["nothing", 0, null],
    ["a $$ b", 2, "$$"],
  ])("dollarTagAt(%j, %i) → %j", (text, index, expected) => {
    expect(dollarTagAt(text, index)).toBe(expected);
  });

  it("closes a body on its OWN tag, not on a different one inside it", () => {
    // The entire reason named tags exist: `$function$` wraps a body that
    // itself contains `$$`. A scanner that exited on any tag would end the
    // body at the inner `$$`, and the `;` after it would split the statement —
    // silently, with the rest of the function read as separate statements.
    const nested = sql(`
      create function public.f() returns void language plpgsql as $function$
      begin
        execute $$ select 1; $$;
        insert into public.t values (2);
      end;
      $function$;
      grant execute on function public.f() to anon;
    `);

    expect(statements(nested)).toHaveLength(2);
    expect(functions(nested)).toHaveLength(1);
    expect(functions(nested)[0].body).toContain("insert into public.t");
  });
});

describe("canonicalArgumentTypes — a signature is the ACL key", () => {
  it.each<[string, string[]]>([
    ["p_now timestamptz default now()", ["timestamptz"]],
    ["timestamp with time zone", ["timestamptz"]],
    ["p_when timestamp with time zone", ["timestamptz"]],
    ["event jsonb", ["jsonb"]],
    ["jsonb", ["jsonb"]],
    ["p_token text, p_id uuid", ["text", "uuid"]],
    ["in p_token text", ["text"]],
    ["variadic p_ids uuid[]", ["uuid[]"]],
    ["p_flag boolean", ["bool"]],
    ["p_n integer", ["int"]],
    ["", []],
  ])("reads `%s` as %j", (args, expected) => {
    expect(canonicalArgumentTypes(args)).toEqual(expected);
  });

  it("drops OUT parameters — they are not part of the identity", () => {
    expect(canonicalArgumentTypes("p_token text, out p_found bool")).toEqual([
      "text",
    ]);
  });

  it("resolves the CREATE and the GRANT to one identity", () => {
    // The case that actually occurs in this repo: the create spells the type
    // `timestamptz` and names the argument; the grant spells neither.
    const fixture = sql(`
      create function public.purge(p_now timestamp with time zone default now())
      returns int language sql security definer set search_path = ''
      as $$ select 1; $$;
      revoke all on function public.purge(timestamptz) from public;
      revoke all on function public.purge(timestamptz) from anon;
    `);

    expect(functions(fixture)[0].identity).toBe("public.purge(timestamptz)");
    expect(anonExecutableFunctions(fixture)).toEqual([]);
  });
});

describe("declaredArgumentNames — PostgREST resolves by NAME (T2-404a)", () => {
  // ## The defect this closes, recorded verbatim
  //
  // `share-grants.test.ts` asserted argument names against
  // `FunctionDefinition.header`, and `functions()` builds `header` from the
  // text **after** the argument list's closing paren — so no argument name
  // could ever appear in it. Verified against the shipped migration:
  // `create.statement.includes("p_vehicle_id")` is `true` and
  // `create.header.includes("p_vehicle_id")` is `false`. Two graders were
  // unsatisfiable as written and were left marked with the defect recorded
  // rather than worked around (T2-404's "Grader defect found, not worked
  // around"). This is the parser that makes them askable.
  //
  // The rules are deliberately the *same* rules `canonicalArgumentType` uses to
  // decide where the name stops and the type starts, so the two halves of one
  // argument list cannot disagree about it.

  it.each<[string, string[]]>([
    ["p_now timestamptz default now()", ["p_now"]],
    ["timestamp with time zone", []],
    ["p_when timestamp with time zone", ["p_when"]],
    ["event jsonb", ["event"]],
    ["jsonb", []],
    ["p_token text, p_id uuid", ["p_token", "p_id"]],
    ["in p_token text", ["p_token"]],
    ["inout p_total numeric", ["p_total"]],
    ["variadic p_ids uuid[]", ["p_ids"]],
    ["p_n integer = 5", ["p_n"]],
    ['"p_token" text', ["p_token"]],
    ["", []],
  ])("reads `%s` as %j", (args, expected) => {
    expect(declaredArgumentNames(args)).toEqual(expected);
  });

  it("drops OUT parameters — a caller cannot name one", () => {
    // The unsafe direction, closed. `returns table (share_id uuid, token text)`
    // desugars to OUT parameters, so accepting them would let a routine satisfy
    // "does it TAKE `share_id`?" by *returning* one.
    expect(declaredArgumentNames("p_token text, out p_found bool")).toEqual([
      "p_token",
    ]);
  });

  it("a multi-word type is not mistaken for a name", () => {
    // `timestamp` is a type keyword, not somebody's parameter. The shared
    // `TYPE_FIRST_WORDS` list is what tells them apart, and getting this wrong
    // in the *name* direction would report a routine as taking an argument
    // called `timestamp`.
    expect(
      declaredArgumentNames("timestamp with time zone, character varying")
    ).toEqual([]);
  });

  it("the shipped lifecycle RPCs parse to their real signatures", () => {
    // The end-to-end half. Read off the migration that actually shipped, so a
    // parser that produced plausible-looking nonsense for synthetic input would
    // still be caught.
    //
    // Lifecycle RPCs only: `create_share_grant` and `revoke_share_grant` — the
    // pair the migration's own header comment (20260906120100_share_grants.sql)
    // names "the two authenticated lifecycle RPCs", distinct from
    // `share_read_vehicle`/`_records`/`_receipts`, its "three security definer
    // readers". `share-grants.test.ts`'s "both lifecycle RPCs take the argument
    // names the graders send" uses the same two-RPC scope independently.
    //
    // `share_read_records`'s real argNames used to be asserted here too
    // (`toEqual(["p_token"])`), but that pinned an exact, closed signature on a
    // reader T2-404b (specs/002-montero-garage) is required to widen: the
    // public showcase/work-log world-reader path serves a null token and has
    // no token to look a vehicle up by, so it needs a way to name a handle and
    // a vehicle id instead. It also proved nothing this test doesn't already
    // prove without it — `revoke_share_grant(p_share_id uuid)` is the same
    // single-arg, single-line, no-default, no-keyword shape, read from the
    // same real migration, so the parser's ability to read a one-argument
    // routine's real signature off shipped SQL is still exercised end-to-end
    // — `revoke_share_grant` is a lifecycle RPC, not a reader, but the parser
    // doesn't know the difference; it only sees argument syntax.
    // Removed 2026-09-06 (grader-defect fix, refs specs/002-montero-garage
    // T2-404b) rather than widened to a guessed future signature, since this
    // test's job is proving the parser against what already shipped, not
    // pre-committing an implementation to argument names the spec does not
    // name.
    //
    // `create_share_grant` gained `p_grantee_email` and `p_is_shop_visible` in
    // T3-102 (specs/003-shop-tools, MEC-06/SHP-04), which drop-and-recreate the
    // routine with two defaulted arguments — the merged T3-101 [TEST] contract
    // (`tests/shop/contract.ts`, `tests/shop/roster.test.ts`) and
    // `share-grants.test.ts`'s own "takes the argument names the graders send"
    // both require it. That is the real, shipped seven-argument signature, not a
    // guess, so this probe reads it back exactly as the T2-404b note above says
    // it should — end-to-end against what actually shipped, now exercising the
    // parser's args-with-`default` handling too. Updated 2026-09-07 (the same
    // stale-fixture grader-defect fix the T2-404b removal above records, refs
    // specs/003-shop-tools T3-102).
    const declared = functions(migrationSql());
    const named = (name: string) =>
      declared.find((routine) => routine.name === name)?.argNames;

    expect(named("create_share_grant")).toEqual([
      "p_vehicle_id",
      "p_kind",
      "p_includes_costs",
      "p_includes_receipts",
      "p_expires_in_hours",
      "p_grantee_email",
      "p_is_shop_visible",
    ]);
    expect(named("revoke_share_grant")).toEqual(["p_share_id"]);
  });

  it("`header` still contains NO argument name — the defect, pinned", () => {
    // Recorded the way G9 records the revoke-then-grant false pass. `header` is
    // not broken; it was the wrong field to ask, and this line is what stops
    // somebody "simplifying" the graders back onto it.
    const [create] = functions(migrationSql()).filter(
      (routine) => routine.name === "create_share_grant"
    );

    expect(create.statement).toContain("p_vehicle_id");
    expect(create.header).not.toContain("p_vehicle_id");
    expect(create.argNames).toContain("p_vehicle_id");
  });
});

describe("statementRanges — one scan, two shapes (T2-404a)", () => {
  it("agrees with statements() text for text", () => {
    // The de-duplication guard. `statements()` now delegates here, so a
    // mutation in one is a mutation in both — the `aclKnownFor` lesson.
    const fixture = sql(`
      create table public.a (id uuid);
      alter table public.a enable row level security;
      grant select on public.a to authenticated;
    `);

    expect(statementRanges(fixture).map((range) => range.text)).toEqual(
      statements(fixture)
    );
  });

  it("every range slices back to its own text — the offsets are real", () => {
    // The assertion that pins the offsets rather than merely reading them. A
    // range spanning the whole input still carries the right `text`, so a
    // weaker check (`start <= at < end`) is satisfied by offsets that have
    // stopped meaning anything — verified by mutation, which is how this test
    // came to be written this way.
    const fixture = sql(`
      select 1;
      select is_worklog_public from public.vehicles;
      select 3;
    `);

    for (const range of statementRanges(fixture)) {
      expect(fixture.slice(range.start, range.end).trim()).toBe(range.text);
    }
  });

  it("the ranges are disjoint and in order", () => {
    const fixture = sql(`select 1; select 2; select 3;`);
    const ranges = statementRanges(fixture);

    expect(ranges).toHaveLength(3);
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index].start).toBeGreaterThanOrEqual(ranges[index - 1].end);
    }
  });

  it("a dollar-quoted body stays one range", () => {
    // The `;` inside a plpgsql body is not a statement boundary. `statements()`
    // has always known that; the offsets have to agree, or a rule reading them
    // would attribute a function's internals to the statement after it.
    const fixture = sql(`
      create function public.f() returns void language plpgsql as $body$
      begin perform 1; perform 2; end;
      $body$;
      select 9;
    `);

    expect(statementRanges(fixture)).toHaveLength(2);
    expect(statementRanges(fixture)[0].text).toContain("perform 2");
  });
});

describe("functions() replays create / replace / drop", () => {
  it("keeps the LAST definition, as Postgres does", () => {
    const replaced = sql(`
      create function public.f() returns void language plpgsql
      security definer set search_path = '' as $$ begin end; $$;
      create or replace function public.f() returns void language plpgsql
      security definer as $$ begin end; $$;
    `);

    expect(functions(replaced)).toHaveLength(1);
    // The replacement dropped `set search_path`, and the end state is what
    // gets graded — the `alter policy` lesson (D2) on the function surface.
    expect(definerSearchPathIssues(replaced).join(" | ")).toContain(
      "no `set search_path`"
    );
  });

  it("`create or replace` does NOT reset the ACL — as in Postgres", () => {
    // Replacing a function keeps its grants. A replay that re-initialised the
    // ACL would report a granted function as ungranted and hide the grant.
    const replaced = sql(`
      create function public.f() returns void language sql as $$ select 1; $$;
      revoke all on function public.f() from public;
      grant execute on function public.f() to anon;
      create or replace function public.f() returns void language sql as $$ select 2; $$;
    `);

    expect(
      privilegeVerdict(grants(replaced), "public.f()", "anon", "execute")
    ).toBe("granted");
  });

  it("a dropped function is gone from the end state", () => {
    const dropped = sql(`
      create function public.f() returns void language plpgsql
      security definer as $$ begin end; $$;
      drop function public.f();
    `);

    expect(functions(dropped)).toEqual([]);
    expect(definerSearchPathIssues(dropped)).toEqual([]);
  });
});

describe("grants() — the end-state ACL", () => {
  it("applies `all functions in schema` to the functions declared before it", () => {
    const bulk = sql(`
      create function public.f() returns void language sql as $$ select 1; $$;
      revoke all on all functions in schema public from public;
      revoke all on all functions in schema public from anon;
    `);

    expect(anonExecutableFunctions(bulk)).toEqual([]);
  });

  it("records `alter default privileges` without replaying it into an ACL", () => {
    // Default privileges apply to objects created afterwards *by the role
    // that set them*, and this module cannot know which role runs a
    // migration. T2-202's review is the reason for the caution: the first
    // version of that migration assumed they had emptied the tables' ACLs and
    // the running database disagreed.
    const adp = sql(`
      alter default privileges in schema public revoke all on tables from anon;
      create table public.t (id uuid primary key);
    `);
    const state = grants(adp);

    expect(state.defaultPrivileges).toHaveLength(1);
    expect(state.defaultPrivileges[0]).toMatchObject({
      action: "revoke",
      schema: "public",
      objectType: "tables",
      roles: ["anon"],
    });
    // …and the table's own ACL is still unknown, because nothing revoked on it.
    expect(rolePrivileges(state, "public.t", "anon").verdict).toBe("unknown");
  });

  it("reports a table nothing created and nothing granted as unknown", () => {
    expect(
      rolePrivileges(grants(sql(`select 1;`)), "public.ghost", "anon").verdict
    ).toBe("unknown");
  });

  it("removes one privilege without emptying the ACL", () => {
    const partial = sql(`
      revoke all on public.records from anon;
      revoke all on public.records from public;
      grant select, insert on public.records to anon;
      revoke insert on public.records from anon;
    `);

    expect(
      rolePrivileges(grants(partial), "public.records", "anon").privileges
    ).toEqual(["select"]);
  });
});

describe("createdTables() — what exists, replayed", () => {
  it("forgets a dropped table", () => {
    const dropped = sql(`
      create table public.tmp (id uuid primary key);
      drop table public.tmp;
    `);

    expect(createdTables(dropped)).toEqual([]);
  });

  it("follows a rename", () => {
    const renamed = sql(`
      create table public.grants_old (id uuid primary key);
      alter table public.grants_old rename to shares;
    `);

    expect(createdTables(renamed).map((table) => table.name)).toEqual([
      "shares",
    ]);
  });

  it("ignores tables outside the public schema", () => {
    // `storage.objects` and `auth.users` are Supabase's; they have their own
    // graders and are not this contract's to enumerate.
    const other = sql(`
      create table storage.buckets_extra (id text primary key);
      create table public.shares (id uuid primary key);
    `);

    expect(createdTables(other).map((table) => table.identity)).toEqual([
      "public.shares",
    ]);
  });
});

/* =========================================================================
 * F. T2-401's probes — the typed-grant rules, and defect (d)
 *
 * Same standard as everything above: every rule gets a fixture it must reject
 * **and** a fixture it must accept, and each was mutation-tested by breaking
 * the rule on purpose and confirming the corpus went red. A rule with no
 * accept-case can drift over-strict for months before anyone notices, which is
 * how a real security rule gets deleted instead of fixed — and that is exactly
 * defect (d) below.
 * ====================================================================== */

/** Rewrite one line of the reference reader, for the T2-401 rules. */
function variantReader(from: string, to: string): FunctionDefinition {
  const rewritten = CORRECT_SHARE_READER.replace(from, to);
  if (rewritten === CORRECT_SHARE_READER) {
    throw new Error(`probe fixture did not change: "${from}" not found`);
  }
  return readerOf(rewritten);
}

/**
 * **(d) — the missing accept-case on the `setof` rule.** Recorded in T2-401's
 * brief, found in T2-401a's round-2 review, and this is the one fixture that
 * closes it.
 *
 * `returns setof <user table>` is rejected and pinned by G6. Nothing asserted
 * that `returns setof <non-user-table>` is **accepted** — so the rule could
 * become over-strict, start rejecting a legitimate return shape, and no test
 * would say a word. That is the direction that gets a security rule deleted
 * rather than fixed: a rule which flags correct code is a rule somebody
 * removes under deadline.
 *
 * Three legitimate shapes, because `setof` has three common non-table
 * operands and a naive tightening breaks a different one each time: a composite
 * type, a view, and a scalar/base type.
 */
const G18_SETOF_NON_USER_TABLE: [string, string][] = [
  [
    "a composite type",
    `create type public.share_record as (id uuid, occurred_on date);
     create function public.share_read_records(p_token text)
     returns setof public.share_record
     language sql stable security definer set search_path = ''
     as $share$
       select r.id, r.occurred_on
       from public.records r
       join public.shares s on s.vehicle_id = r.vehicle_id
       where s.token_hash = extensions.digest(p_token, 'sha256')
         and s.revoked_at is null
         and s.expires_at > now();
     $share$;`,
  ],
  [
    "a view",
    `create function public.share_read_records(p_token text)
     returns setof public.share_records_view
     language sql stable security definer set search_path = ''
     as $share$
       select v.id, v.occurred_on
       from public.share_records_view v
       join public.shares s on s.vehicle_id = v.vehicle_id
       where s.token_hash = extensions.digest(p_token, 'sha256')
         and s.revoked_at is null
         and s.expires_at > now();
     $share$;`,
  ],
  [
    "a base type",
    `create function public.share_read_record_ids(p_token text)
     returns setof uuid
     language sql stable security definer set search_path = ''
     as $share$
       select r.id
       from public.records r
       join public.shares s on s.vehicle_id = r.vehicle_id
       where s.token_hash = extensions.digest(p_token, 'sha256')
         and s.revoked_at is null
         and s.expires_at > now();
     $share$;`,
  ],
];

/** G19 — a reader that branches on the preset instead of the capabilities. */
const G19_BRANCHES_ON_KIND = variantReader(
  "and s.expires_at > now()",
  "and s.expires_at > now() and s.kind = 'mechanic'"
);

/** G20 — cost columns returned with no capability gate at all (SHR-06). */
const G20_UNGATED_COSTS = variantReader(
  "select r.id, r.occurred_on, r.kind",
  "select r.id, r.occurred_on, r.kind, r.cost_amount, r.cost_currency"
);

/**
 * G20c — **T2-401 review, F2**: the two decisions collapsed into one.
 *
 * A receipts reader that requires `includes_costs` **as well as**
 * `includes_receipts`. SHR-06 says the two open independently, so a grant with
 * `costs=false receipts=true` — the cell this branch's own files call "the cell
 * that matters most", the one a single `full_access` boolean cannot express —
 * gets nothing from this reader.
 *
 * The clause that catches it shipped with **no probe at all**: the reviewer
 * neutered it and the whole suite stayed green. It is the only detector for
 * this defect, so it was the one clause in the rule that could not fail.
 */
const G20C_RECEIPTS_BEHIND_COSTS = readerOf(
  sql(`
    create function public.share_read_receipts(p_token text)
    returns table (id uuid, storage_path text)
    language sql stable security definer set search_path = ''
    as $share$
      select x.id, x.storage_path
      from public.receipts x
      join public.records r on r.id = x.record_id
      join public.shares s on s.vehicle_id = r.vehicle_id
      where s.token_hash = extensions.digest(p_token, 'sha256')
        and s.revoked_at is null
        and s.expires_at > now()
        and s.includes_costs = true
        and s.includes_receipts = true;
    $share$;
  `)
);

/** G20d — the same reader gated on receipts ALONE. The accept case. */
const G20D_RECEIPTS_ALONE = readerOf(
  sql(`
    create function public.share_read_receipts(p_token text)
    returns table (id uuid, storage_path text)
    language sql stable security definer set search_path = ''
    as $share$
      select x.id, x.storage_path
      from public.receipts x
      join public.records r on r.id = x.record_id
      join public.shares s on s.vehicle_id = r.vehicle_id
      where s.token_hash = extensions.digest(p_token, 'sha256')
        and s.revoked_at is null
        and s.expires_at > now()
        and s.includes_receipts = true;
    $share$;
  `)
);

/** G20b — the same columns, correctly gated. The accept case. */
const G20B_GATED_COSTS = readerOf(
  sql(`
    create function public.share_read_records(p_token text)
    returns table (id uuid, cost_amount numeric)
    language sql stable security definer set search_path = ''
    as $share$
      select r.id, r.cost_amount
      from public.records r
      join public.shares s on s.vehicle_id = r.vehicle_id
      where s.token_hash = extensions.digest(p_token, 'sha256')
        and s.revoked_at is null
        and s.expires_at > now()
        and s.includes_costs = true;
    $share$;
  `)
);

/** G21 — a refusal that tells the caller which of the three cases it hit. */
const G21_TALKATIVE_REFUSAL = readerOf(
  sql(`
    create function public.share_read_records(p_token text)
    returns table (id uuid)
    language plpgsql stable security definer set search_path = ''
    as $share$
    declare g public.shares;
    begin
      select * into g from public.shares
       where token_hash = extensions.digest(p_token, 'sha256');
      if not found then raise exception 'not found'; end if;
      if g.revoked_at is not null then raise exception 'grant revoked'; end if;
      if g.expires_at < now() then raise exception 'grant expired'; end if;
      return query select r.id from public.records r where r.vehicle_id = g.vehicle_id;
    end;
    $share$;
  `)
);

/** G21b — one refusal, said the same way whatever happened. The accept case. */
const G21B_UNIFORM_REFUSAL = readerOf(
  sql(`
    create function public.share_read_records(p_token text)
    returns table (id uuid)
    language plpgsql stable security definer set search_path = ''
    as $share$
    declare g public.shares;
    begin
      select * into g from public.shares
       where token_hash = extensions.digest(p_token, 'sha256')
         and revoked_at is null
         and expires_at > now();
      if not found then raise exception 'no'; end if;
      return query select r.id from public.records r where r.vehicle_id = g.vehicle_id;
    end;
    $share$;
  `)
);

/**
 * G22 — revocation that consults a plan (SHR-08, 003 MON-02).
 *
 * Signature matches `SHARE_REVOKE_ARGUMENTS` (`p_share_id`), which is the
 * contract every call site now builds from — see F3 in `share-fixtures.ts`.
 * A probe modelling a signature nothing else uses is a probe about a function
 * that will never exist.
 */
const G22_GATED_REVOCATION = readerOf(
  sql(`
    create function public.revoke_share_grant(p_share_id uuid)
    returns void
    language sql security definer set search_path = ''
    as $revoke$
      update public.shares s set revoked_at = now()
       where s.id = p_share_id
         and exists (select 1 from public.subscriptions b
                      where b.owner_id = (select auth.uid())
                        and b.status = 'active');
    $revoke$;
  `)
);

/** G22b — revocation that consults ownership and nothing else. Accept case. */
const G22B_UNGATED_REVOCATION = readerOf(
  sql(`
    create function public.revoke_share_grant(p_share_id uuid)
    returns void
    language sql security definer set search_path = ''
    as $revoke$
      update public.shares s set revoked_at = now()
       where s.id = p_share_id
         and exists (select 1 from public.vehicles v
                      where v.id = s.vehicle_id
                        and v.owner_id = (select auth.uid()));
    $revoke$;
  `)
);

/** G23 — every future object in the schema, handed to anon by one line. */
const G23_ADP_GRANT = sql(`
  alter default privileges in schema public grant select on tables to anon;
`);

/** G23b — the revoke half, which is what the schema actually ships. */
const G23B_ADP_REVOKE = sql(`
  alter default privileges in schema public revoke all on tables from anon;
  alter default privileges in schema public revoke all on tables from public;
`);

/**
 * G24 — the two optimistic defaults the old name-shaped sweep walked past.
 *
 * Both verified against the shipped regex, which needed `is_` *and*
 * `public|shared|visible` *and* `default true`, all three.
 */
const G24_OPTIMISTIC_DEFAULTS = sql(`
  create table public.shares (
    id uuid primary key,
    includes_costs boolean not null default true,
    is_active boolean not null default true,
    includes_receipts boolean not null default false
  );
`);

/** G24b — the same table, private by default. The accept case. */
const G24B_HONEST_DEFAULTS = sql(`
  create table public.shares (
    id uuid primary key,
    includes_costs boolean not null default false,
    is_active boolean not null default false,
    includes_receipts boolean not null default false
  );
`);

/** G24c — created honest, flipped later by an `alter table`. */
const G24C_FLIPPED_LATER = sql(`
  create table public.shares (
    id uuid primary key,
    includes_costs boolean not null default false
  );
  alter table public.shares alter column includes_costs set default true;
`);

/* -------------------------------------------------------------------------
 * G27 — T2-404a: SHR-09's publication flags, and the one path allowed to
 * read them.
 *
 * The rule this corpus grades was **narrowed** by an owner ruling on
 * 2026-09-06, and a narrowing is the most dangerous edit a security rule can
 * receive: the easy mistake is to widen it into "a declared reader may read the
 * flags", which is a blanket exemption wearing a narrowing's clothes. So both
 * halves are pinned here — the correctly-gated reader must be **accepted**, and
 * the same reader with the gate removed must still be **rejected**. Neither
 * assertion means anything without the other.
 *
 * Every fixture below is one declared share reader, spelled the way T2-404's
 * public-page reader will have to be spelled, differing from its sibling in
 * exactly the property under test.
 * ---------------------------------------------------------------------- */

/** A `share_read_records` fixture with `body`, granted to `anon`. */
const flagReader = (body: string, language = "plpgsql"): string =>
  sql(`
    create function public.share_read_records(p_token text, p_handle text)
    returns setof jsonb
    language ${language} stable security definer set search_path = ''
    as $share$
    ${body}
    $share$;

    revoke all on function public.share_read_records(text, text) from public;
    grant execute on function public.share_read_records(text, text) to anon;
  `);

/**
 * G27 — the ACCEPT case: the world path reads the flags, the token path does
 * not, and the two are separated by `if p_token is null then`.
 *
 * This is the shape the 2026-09-05 amendment asks for — one anon reader serving
 * both the world and a token holder — and before the narrowing it was a
 * finding. It carries a `case … when … then … else … end` **expression** after
 * the chain closes, on purpose: that is the construct the span scanner has to
 * not mistake for an `if`-chain's `else`, and `share_read_records` already uses
 * one for its cost pair.
 */
const G27_GATED_WORLD_PATH = flagReader(`
  declare
    v_vehicle_id uuid;
    v_includes_costs boolean := false;
  begin
    if p_token is null then
      select v.id into v_vehicle_id
        from public.vehicles v
        join public.profiles p on p.id = v.owner_id
       where p.handle = p_handle
         and v.is_worklog_public is true;
    elsif p_token is not null then
      select s.vehicle_id, s.includes_costs into v_vehicle_id, v_includes_costs
        from public.shares s
       where s.token_hash = extensions.digest(p_token, 'sha256')
         and s.revoked_at is null
         and s.expires_at > now();
    end if;

    if not found then
      raise insufficient_privilege using message = 'share unavailable';
    end if;

    return query
      select jsonb_build_object('id', r.id, 'title', r.title)
             || case when v_includes_costs is true
                     then jsonb_build_object('cost_amount', r.cost_amount)
                     else '{}'::jsonb end
        from public.records r
       where r.vehicle_id = v_vehicle_id;
  end;
`);

/**
 * G27b — the REJECT case that makes the narrowing safe: the identical reader
 * with **no token test at all** on the flag read.
 *
 * "It is a declared reader, so the flags are fine" is the reading that would
 * pass this, and it is exactly the reading the owner's ruling forbids. If this
 * ever goes green, the rule has become a blanket exemption.
 */
const G27B_UNGATED_FLAG_READ = flagReader(`
  declare
    v_vehicle_id uuid;
  begin
    select v.id into v_vehicle_id
      from public.vehicles v
      join public.profiles p on p.id = v.owner_id
     where p.handle = p_handle
       and v.is_worklog_public is true;

    if not found then
      select s.vehicle_id into v_vehicle_id
        from public.shares s
       where s.token_hash = extensions.digest(p_token, 'sha256')
         and s.revoked_at is null
         and s.expires_at > now();
    end if;

    return query select jsonb_build_object('id', r.id)
      from public.records r where r.vehicle_id = v_vehicle_id;
  end;
`);

/**
 * G27c — the flags consulted **while resolving a real token**.
 *
 * The half the ruling names explicitly and the one a "does the body contain a
 * null test anywhere?" rule would wave through: this body *does* contain
 * `p_token is null`, one branch up. The flag read is in the other branch.
 */
const G27C_FLAG_ON_TOKEN_PATH = flagReader(`
  declare
    v_vehicle_id uuid;
  begin
    if p_token is null then
      select v.id into v_vehicle_id
        from public.vehicles v
        join public.profiles p on p.id = v.owner_id
       where p.handle = p_handle;
    else
      select s.vehicle_id into v_vehicle_id
        from public.shares s
        join public.vehicles v on v.id = s.vehicle_id
       where s.token_hash = extensions.digest(p_token, 'sha256')
         and s.revoked_at is null
         and s.expires_at > now()
         and v.is_worklog_public is true;
    end if;

    return query select jsonb_build_object('id', r.id)
      from public.records r where r.vehicle_id = v_vehicle_id;
  end;
`);

/**
 * G27e — the guard widened by an `or` nobody reads to the end of.
 *
 * `if p_token is null or p_token = 'x' then` guarantees nothing about the
 * token, and a rule that matched `p_token is null` as a substring would call
 * this gated. Same defect shape as P3 and N11 at the top of this file, on a
 * different predicate — which is why the guard is decided by
 * `impliesTokenAbsent` and not by a regex.
 */
const G27E_WIDENED_GUARD = flagReader(`
  begin
    if p_token is null or p_token = 'x' then
      return query select jsonb_build_object('id', v.id)
        from public.vehicles v where v.is_worklog_public is true;
    end if;
  end;
`);

/** G27f — the same widening inside a single predicate, no `if` at all. */
const G27F_OR_PREDICATE = flagReader(
  `select jsonb_build_object('id', v.id)
     from public.vehicles v
    where (p_token is null or v.is_worklog_public is true);`,
  "sql"
);

/**
 * G27g — the single-predicate ACCEPT case: a `language sql` reader whose world
 * branch carries the null test as a conjunct and whose token branch does not
 * touch the flags.
 *
 * Here so the rule is not silently plpgsql-only. Without it, a tightening that
 * required an `if` statement would reject a legitimate reader and nothing
 * would say so — the direction that gets a security rule deleted rather than
 * fixed.
 */
const G27G_CONJUNCT_ACCEPT = flagReader(
  `select jsonb_build_object('id', r.id)
     from public.records r
     join public.vehicles v on v.id = r.vehicle_id
     join public.profiles p on p.id = v.owner_id
    where (p_token is null and p.handle = p_handle and v.is_worklog_public is true)
       or (exists (select 1 from public.shares s
                    where s.token_hash = extensions.digest(p_token, 'sha256')
                      and s.revoked_at is null
                      and s.expires_at > now()
                      and s.vehicle_id = r.vehicle_id));`,
  "sql"
);

/** G27h — the flag read after the guarded chain has already closed. */
const G27H_AFTER_END_IF = flagReader(`
  begin
    if p_token is null then
      return query select jsonb_build_object('id', 1);
    end if;
    return query select jsonb_build_object('id', v.id)
      from public.vehicles v where v.is_worklog_public is true;
  end;
`);

/**
 * G27i — a routine that is **not** a declared share reader, correctly gated,
 * and still forbidden.
 *
 * Verdict 1 of the three, and the half of SHR-09 that did not change. The
 * narrowing is for the allow-list and for nothing else; a fourth anon-granted
 * routine reading the flags is the allow-list widening T2-402 already ruled is
 * not an implementer's edit.
 */
const G27I_NOT_ALLOW_LISTED = sql(`
  create function public.community_evidence(p_token text, p_handle text)
  returns setof jsonb
  language plpgsql stable security definer set search_path = ''
  as $share$
  begin
    if p_token is null then
      return query select jsonb_build_object('id', r.id)
        from public.records r
        join public.vehicles v on v.id = r.vehicle_id
       where v.is_worklog_public is true;
    end if;
  end;
  $share$;

  revoke all on function public.community_evidence(text, text) from public;
  grant execute on function public.community_evidence(text, text) to anon;
`);

/**
 * G27k — the flag read in a **later** statement than the one carrying the null
 * test.
 *
 * This exists because a mutation survived the first pass: emptying
 * `statementRanges`' offsets (every range spanning the whole body) left the
 * whole corpus green, since every other fixture either resolves inside a
 * branch span or has exactly one statement. With the offsets broken, the flag
 * occurrence here is attributed to the *first* statement — whose predicate is
 * `p_token is null` — and an ungated read is reported as gated. Nothing else in
 * this file can tell those two apart.
 */
const G27K_LATER_STATEMENT = flagReader(`
  begin
    perform 1 from public.profiles p where p_token is null;
    return query select jsonb_build_object('id', v.id)
      from public.vehicles v where v.is_worklog_public is true;
  end;
`);

/**
 * G27l — the flags read behind `if p_token is NOT null then`.
 *
 * The inversion, and the one spelling that must never be mistaken for a gate:
 * this is the forbidden half of the owner's ruling written as plainly as it can
 * be written — flags consulted precisely *because* a token was presented. It
 * exists because `\bp_token is null\b` and `\bp_token is not null\b` are one
 * relaxed quantifier apart, and a rule that accepted the second would report
 * the exact conflation SHR-09 forbids as correctly gated.
 */
const G27L_INVERTED_GUARD = flagReader(`
  begin
    if p_token is not null then
      return query select jsonb_build_object('id', v.id)
        from public.vehicles v where v.is_worklog_public is true;
    end if;
  end;
`);

/** G27j — one flag gated and a second one not. The finding names the second. */
const G27J_ONE_OF_TWO = flagReader(`
  begin
    if p_token is null then
      return query select jsonb_build_object('id', v.id)
        from public.vehicles v where v.is_worklog_public is true;
    end if;
    return query select jsonb_build_object('id', v.id)
      from public.vehicles v where v.is_showcase_public is true;
  end;
`);

/**
 * G27m — the flags on the token path, reached by `elsif` rather than `else`.
 *
 * G27c is the same finding spelled with `else`, and the two take different
 * branches of the span scanner: `else` ends a branch and opens nothing, while
 * `elsif` ends one branch and evaluates a fresh condition. A corpus that tested
 * only the `else` spelling would leave the `elsif` half of that scanner free to
 * be mutated into "an `elsif` does not end the branch before it", and the
 * guarded span would then swallow the token path.
 */
const G27M_ELSIF_TOKEN_PATH = flagReader(`
  declare
    v_vehicle_id uuid;
  begin
    if p_token is null then
      select v.id into v_vehicle_id from public.vehicles v
        join public.profiles p on p.id = v.owner_id where p.handle = p_handle;
    elsif p_token is not null then
      select s.vehicle_id into v_vehicle_id
        from public.shares s
        join public.vehicles v on v.id = s.vehicle_id
       where s.token_hash = extensions.digest(p_token, 'sha256')
         and v.is_worklog_public is true;
    end if;

    return query select jsonb_build_object('id', r.id)
      from public.records r where r.vehicle_id = v_vehicle_id;
  end;
`);

/**
 * G27n ACCEPT — the gate expressed as an `elsif`, not as the opening `if`.
 *
 * The positive control G27m needs, and the one that keeps the `elsif` half of
 * the scanner from being deleted instead of fixed: a reader may perfectly well
 * dispatch on something else first and reach its world path second. Without
 * this fixture, "an `elsif` never opens a guarded span" is a mutation the whole
 * corpus survives, and the rule would quietly reject a legitimate reader.
 */
const G27N_ELSIF_GATED = flagReader(`
  begin
    if p_handle is null then
      raise insufficient_privilege using message = 'share unavailable';
    elsif p_token is null then
      return query select jsonb_build_object('id', v.id)
        from public.vehicles v where v.is_worklog_public is true;
    else
      return query select jsonb_build_object('id', s.vehicle_id)
        from public.shares s
       where s.token_hash = extensions.digest(p_token, 'sha256');
    end if;
  end;
`);

/**
 * G27o — the guard negated: `if not (p_token is null) then`.
 *
 * The most dangerous fixture in this corpus, because the body **contains
 * `p_token is null` verbatim** and means its exact opposite. This is G27l's
 * finding wearing the accept case's text: the flags are read precisely because
 * a token was presented. It is here because the rule's atom test is ultimately
 * a regex, and a regex cannot see a `not` three characters to its left — so
 * `impliesTokenAbsent` refuses a negated atom outright, and this fixture is
 * what fails if that refusal is ever removed as redundant.
 */
const G27O_NEGATED_GUARD = flagReader(`
  begin
    if not (p_token is null) then
      return query select jsonb_build_object('id', v.id)
        from public.vehicles v where v.is_worklog_public is true;
    end if;
  end;
`);

/** G27p — the same negation inside a single predicate, no `if` at all. */
const G27P_NEGATED_PREDICATE = flagReader(
  `select jsonb_build_object('id', v.id)
     from public.vehicles v
    where not (p_token is null) and v.is_worklog_public is true;`,
  "sql"
);

/**
 * G27q — a gated first arm and an **ungated second arm of a `union`**.
 *
 * One `;`-delimited statement with two predicates. The first says the token is
 * absent; the second says nothing at all, and it is the one that reads the
 * flag. A rule that asked "does this statement's top-level predicate imply the
 * token is absent?" and stopped there accepts this — the predicate it found is
 * real, it is top-level, and it governs the *other* arm. This is why
 * `wherePredicate` reports where its authority stops.
 */
const G27Q_UNION_SECOND_ARM = flagReader(
  `select jsonb_build_object('id', v.id)
     from public.vehicles v
     join public.profiles p on p.id = v.owner_id
    where p_token is null and p.handle = p_handle
   union
   select jsonb_build_object('id', v2.id)
     from public.vehicles v2
    where v2.is_worklog_public is true;`,
  "sql"
);

/**
 * G27r — the flag read into a local with no predicate on the read at all.
 *
 * The simplest spelling of the forbidden thing, and the one a predicate-shaped
 * rule is most likely to be silent about: there is no `where` here to analyse,
 * so "no predicate" must mean ungated. Reading it as "nothing to object to" is
 * the failure mode `wherePredicate`'s doc comment names.
 */
const G27R_BARE_ASSIGNMENT = flagReader(`
  declare
    v_public boolean;
  begin
    select v.is_worklog_public into v_public
      from public.vehicles v
      join public.profiles p on p.id = v.owner_id
     where p.handle = p_handle;
    return query select jsonb_build_object('public', v_public);
  end;
`);

/**
 * G27s — the flags in the `else` branch of `if <token> is not null then`.
 *
 * Semantically this *is* the world path, and the rule rejects it anyway. That
 * is the over-strictness the section header in `rules.ts` declares on purpose,
 * pinned here so it is visibly a decision rather than an undiscovered bug: the
 * guarded path has to name its condition positively, which is what stops a
 * `case … when … then … else … end` expression from being read as an
 * `if`-chain's `else` and marking a region guarded that nothing guards.
 *
 * If a later task decides the cost is not worth paying, this is the fixture
 * whose expectation flips — and flipping it is a deliberate edit to a
 * trust-boundary rule, which is the point.
 */
const G27S_NEGATIVE_ELSE = flagReader(`
  begin
    if p_token is not null then
      return query select jsonb_build_object('id', s.vehicle_id)
        from public.shares s
       where s.token_hash = extensions.digest(p_token, 'sha256');
    else
      return query select jsonb_build_object('id', v.id)
        from public.vehicles v where v.is_worklog_public is true;
    end if;
  end;
`);

/**
 * G27t ACCEPT — the flag in a join's `on` clause, gated by the statement's own
 * `where`.
 *
 * A publication flag is a join condition at least as often as it is a `where`
 * conjunct, and the gate still governs it: the predicate is top-level and the
 * flag sits inside the region it governs. Without this fixture, tightening the
 * rule to "the flag must appear inside the predicate text" would reject a
 * legitimate reader and no assertion would object.
 */
const G27T_ON_CLAUSE = flagReader(`
  begin
    return query select jsonb_build_object('id', r.id)
      from public.records r
      join public.vehicles v
        on v.id = r.vehicle_id and v.is_worklog_public is true
     where p_token is null;
  end;
`);

/**
 * G27u — an identifier that **ends in `where`**, with the real predicate ungated.
 *
 * `serviced_elsewhere` contains the keyword the predicate scanner looks for, and
 * the text that follows it inside the `on` clause happens to assert the token is
 * null. A scanner that matched `where` without checking what precedes it finds
 * its predicate eight characters early, reads `… and p_token is null where
 * v.is_worklog_public is true` as the statement's gate, and **accepts an
 * ungated flag read**. The real `where` is two lines down and says nothing about
 * the token.
 *
 * Written because the left-boundary check survived the first mutation round: no
 * other fixture could tell it from a no-op, and a clause no fixture can kill is
 * a clause that is not being graded (`.claude/GRADER-PRINCIPLES.md`, "mutation-
 * test each clause of the rule separately").
 */
const G27U_KEYWORD_SUFFIX_IDENTIFIER = flagReader(`
  begin
    return query select jsonb_build_object('id', v.id)
      from public.vehicles v
      join public.records r
        on r.vehicle_id = v.id and r.serviced_elsewhere and p_token is null
     where v.is_worklog_public is true;
  end;
`);

/**
 * G27v ACCEPT — a genuinely-gated flag read as a **non-first** top-level
 * statement of the body (PR #141 bot-review, `at`/`predicate.end` coordinate
 * mismatch).
 *
 * `wherePredicate` is called with `range.text` — the statement *trimmed* —
 * but the caller compared its `end` offset against `at - range.start`, an
 * offset into the *untrimmed* statement. `range.start` and the point
 * `range.text` actually starts from disagree by exactly the untrimmed
 * statement's own leading whitespace, and every statement but the first in a
 * body carries one such leading space once `normalizeSql` has collapsed its
 * original indentation down to a single character — which is what the
 * `v_noop := 1;` line before the real read manufactures here.
 *
 * Pinned as a regression for the *coordinate-consistent* formula rather than
 * as a fail-before/pass-after demonstration of the reported defect: the
 * reported mismatch is bounded by one collapsed-whitespace character, and the
 * shortest distance a legitimately-gated occurrence of either publication
 * flag can sit from `predicate.end` is bounded below by the flag's own
 * column-name length (18 characters, `is_worklog_public`) — an order of
 * magnitude past the one-character error, so no fixture built from this
 * project's actual `PUBLIC_VISIBILITY_FLAG_COLUMNS` names can flip between
 * the pre-fix and post-fix formula. It still earns its place: a cruder
 * regression of the same defect class — comparing the raw, un-adjusted `at`
 * against `predicate.end` — pushes the flag's occurrence *past* `predicate.end`
 * in this fixture's numbers and this fixture catches it, where none of the
 * other G27 fixtures (all first-statement bodies) would.
 */
const G27V_LEADING_WHITESPACE_GATED = flagReader(`
  declare
    v_noop int;
  begin
    v_noop := 1;
    return query select jsonb_build_object('id', v.id)
      from public.vehicles v
     where p_token is null and v.is_worklog_public is true;
  end;
`);

describe("T2-401 (d): the `setof` rule has an ACCEPT case at last", () => {
  it.each(G18_SETOF_NON_USER_TABLE)(
    "accepts `returns setof` %s",
    (_label, fixture) => {
      // The defect, closed. Without this, `projectionIssues` could be tightened
      // — say, to reject every `setof` — and the only signal would be T2-404
      // failing to ship a legitimate return shape, at which point the rule gets
      // deleted rather than fixed.
      const routines = functions(sql(fixture));

      expect(routines.length).toBeGreaterThan(0);
      expect(routines.flatMap(projectionIssues)).toEqual([]);
    }
  );

  it("still rejects `returns setof` a USER table — the rule did not go soft", () => {
    // The paired half. An accept-case that was added by loosening the rule
    // would be worse than no accept-case at all.
    expect(
      projectionIssues(readerOf(G6_SETOF_USER_TABLE)).join(" | ")
    ).toContain("returns `setof records`");
  });

  it("the accept and reject cases differ ONLY in the return type", () => {
    // Guards against the accept fixtures passing for an unrelated reason —
    // a body that names its columns, say, which every one of them does.
    for (const [, fixture] of G18_SETOF_NON_USER_TABLE) {
      expect(fixture).toMatch(/returns setof/);
      expect(fixture).not.toMatch(/select\s+[a-z]*\.?\*/);
    }
  });
});

describe("T2-401 F1: an identifier-quoted role is still that role", () => {
  // The bypass, at every call site that names a role. One-line root fix in
  // `parseRoles`; six probes, because the rule it defeats is different at each
  // of them and a fix that only reached one would look complete.

  it('G26 rejects `to "anon"` — the end-state ACL, quotes and all', () => {
    expect(
      tableGrantIssues(G26_QUOTED_ROLE_GRANT, ["records"]).join(" | ")
    ).toContain("anon holds select");
  });

  it("G26: the UNQUOTED spelling of the same leak is caught identically", () => {
    // The pair that makes the claim "quoting changes nothing" checkable rather
    // than asserted. Same directory, same verdict.
    expect(tableGrantIssues(G26_QUOTED_ROLE_GRANT, ["records"])).toEqual(
      tableGrantIssues(G9_REVOKE_THEN_GRANT, ["records"])
    );
  });

  it('G26b rejects `to "public"` — the role that IS anon', () => {
    // `public` is not a role beside `anon`, it is every role. Quoted or not, a
    // privilege granted to it is a privilege `anon` holds.
    expect(
      tableGrantIssues(G26B_QUOTED_PUBLIC_GRANT, ["records"]).join(" | ")
    ).toContain("public holds select");
  });

  it("G26c rejects a quoted role in `alter default privileges`", () => {
    // T2-401's own new rule, defeated by the same two characters. Recorded
    // separately because `defaultPrivilegeGrantIssues` reads a different parser
    // path (`adp`) from the object grants above.
    expect(
      defaultPrivilegeGrantIssues(G26C_QUOTED_ADP_GRANT).join(" | ")
    ).toContain("every FUTURE object");
  });

  it("G26d rejects a quoted role over a quoted schema in a bulk grant", () => {
    // Two quoted identifiers in one statement, and the schema half had its own
    // character class excluding `"` — so the bulk grant matched nothing at all
    // and applied to no object.
    expect(
      tableGrantIssues(G26D_QUOTED_BULK_GRANT, ["records"]).join(" | ")
    ).toContain("anon holds select");
  });

  it("G26e counts a quoted-role function grant as anon-reachable", () => {
    // The closed allow-list. A reader granted to `"anon"` was invisible to the
    // complement computation, which is the one thing standing between the
    // schema and an unaccounted anon surface.
    expect(
      anonExecutableFunctions(G26E_QUOTED_FUNCTION_GRANT).map(
        (routine) => routine.name
      )
    ).toEqual(["share_read_everything"]);
    expect(
      anonFunctionAllowListIssues(G26E_QUOTED_FUNCTION_GRANT, []).unexpected
    ).not.toEqual([]);
  });

  it("G26f names the role a quoted policy actually grants to", () => {
    // This half already failed *closed* — the old regex excluded `"`, so the
    // policy parsed with no roles and was reported as "granted to public (no
    // `to` clause)". A finding, but one whose message named the wrong defect,
    // and a reviewer looking for a missing `to` clause that is plainly there
    // concludes the grader is broken.
    const issues = userTablePolicyIssues(G26F_QUOTED_POLICY_ROLE, ["records"]);

    expect(issues.join(" | ")).toContain("granted to anon");
    expect(issues.join(" | ")).not.toContain("no `to` clause");
  });

  it("G26 CONTROL: quoting a role does not INVENT a finding", () => {
    // The over-strict direction. Stripping quotes must not make a correct
    // directory look wrong: the same revokes, quoted, still leave anon holding
    // nothing.
    const quotedRevokes = sql(`
      revoke all on public.records from "anon";
      revoke all on public.records from "public";
      revoke all on public.records from "authenticated";
      grant select, insert, update, delete on public.records to "authenticated";
    `);

    expect(tableGrantIssues(quotedRevokes, ["records"])).toEqual([]);
    expect(tableGrantIssues(quotedRevokes, ["records"])).toEqual(
      tableGrantIssues(G9B_REVOKE_ONLY, ["records"])
    );
  });

  it("G26 CONTROL: the real migrations are unaffected by the fix", () => {
    // The whole point of a parser change in a shipped harness. If stripping
    // quotes had altered any verdict about the schema that exists, that would
    // be the change breaking something rather than fixing it.
    expect(defaultPrivilegeGrantIssues(migrationSql())).toEqual([]);
    expect(
      tableGrantIssues(
        migrationSql(),
        [...USER_TABLE_NAMES].filter((t) => t !== "shares")
      )
    ).toEqual([]);
  });
});

describe("T2-401: SHR-05, the preset is a label", () => {
  it("G19 rejects a reader that branches on `kind`", () => {
    expect(presetBranchIssues(G19_BRANCHES_ON_KIND).join(" | ")).toContain(
      "branches on the grant's `kind`"
    );
  });

  it("G19 rejects a hard-coded preset name even without a comparison", () => {
    // The second spelling of the same mistake: `coalesce(s.kind, 'mechanic')`
    // compares nothing and still makes the label load-bearing.
    const named = variantReader(
      "select r.id, r.occurred_on, r.kind",
      "select r.id, r.occurred_on, coalesce(s.kind, 'buyer')"
    );

    expect(presetBranchIssues(named).join(" | ")).toContain("names the preset");
  });

  it.each<[string, string]>([
    ["equality", "and s.kind = 'x'"],
    ["inequality", "and s.kind <> 'x'"],
    ["an IN list", "and s.kind in ('x', 'y')"],
    ["a CASE subject", "and (case s.kind when 'x' then true else false end)"],
    // `= p_kind`, not `= 'x'`: with a quoted literal this row also matches the
    // equality pattern, so it would pass even if the `when … kind =` pattern
    // were deleted — the same confound as the IN row, one clause over
    // (second review, F-D).
    ["a WHEN comparison", "and (case when s.kind = p_kind then true end)"],
  ])("G19 rejects the preset branch spelled as %s", (_label, clause) => {
    // Every alternative in the rule, one probe each, and **none of them names a
    // real preset**. That is the point: the first version of this table used
    // `'mechanic'`, which fires the rule's *other* clause, so every row passed
    // no matter what the pattern under test did. The per-clause mutation
    // battery caught it — deleting the `kind in (...)` pattern left the suite
    // green — which is the same shape of hole as F2 in a rule whose other
    // branches were already covered.
    //
    // "Mutation-test each clause separately, not just the rule as a whole" is
    // the principle; a probe that reaches the clause only through a neighbour
    // is not testing it.
    const branching = variantReader("and s.expires_at > now()", clause);

    expect(presetBranchIssues(branching).join(" | ")).toContain(
      "branches on the grant's `kind`"
    );
  });

  it("G19 CONTROL: returning `kind` without comparing it is fine", () => {
    // The reference reader selects `r.kind` — a *record's* kind, not the
    // grant's — and a rule that flagged it would be unusable from the first
    // day. This is the accept case that keeps the rule narrow enough to keep.
    expect(presetBranchIssues(readerOf(CORRECT_SHARE_READER))).toEqual([]);
  });
});

describe("T2-401: SHR-06, capabilities gate what they return", () => {
  it("G20 rejects cost columns with no `includes_costs` test", () => {
    expect(capabilityGateIssues(G20_UNGATED_COSTS).join(" | ")).toContain(
      "without testing `includes_costs`"
    );
  });

  it("G20 CONTROL: the same columns behind the gate are accepted", () => {
    expect(capabilityGateIssues(G20B_GATED_COSTS)).toEqual([]);
  });

  it("G20 rejects receipt data with no `includes_receipts` test", () => {
    const receipts = variantReader(
      "select r.id, r.occurred_on, r.kind",
      "select r.id, r.occurred_on, x.storage_path"
    );

    expect(capabilityGateIssues(receipts).join(" | ")).toContain(
      "without testing `includes_receipts`"
    );
  });

  it("G20 CONTROL: a reader returning neither is not accused of either", () => {
    // The reference reader returns no cost and no receipt column. A rule that
    // reported on it would fire on every correct reader in the schema.
    expect(capabilityGateIssues(readerOf(CORRECT_SHARE_READER))).toEqual([]);
  });

  it("G20c rejects receipts gated BEHIND costs — the collapse", () => {
    // **T2-401 review, F2.** This clause is the only detector for the
    // two-decisions-collapsed defect, and it shipped with no probe: the
    // reviewer neutered it and the entire suite stayed green. It was the one
    // clause in the rule that could not fail.
    //
    // The defect it catches costs a real user something specific: a grant
    // issued as `costs=false receipts=true` — an owner handing a mechanic the
    // scans without the prices — returns nothing at all.
    expect(
      capabilityGateIssues(G20C_RECEIPTS_BEHIND_COSTS).join(" | ")
    ).toContain("gates receipts behind `includes_costs`");
  });

  it("G20d CONTROL: the same reader gated on receipts ALONE is accepted", () => {
    // One line different from G20c. Without this, the rejection above is
    // equally satisfied by a clause that fires on every receipts reader.
    expect(capabilityGateIssues(G20D_RECEIPTS_ALONE)).toEqual([]);
  });

  it("G20c/d differ ONLY in the extra `includes_costs` conjunct", () => {
    // Pins that the two fixtures are a matched pair rather than two unrelated
    // readers that happen to differ in verdict.
    expect(G20C_RECEIPTS_BEHIND_COSTS.body).toContain(
      "s.includes_costs = true"
    );
    expect(G20D_RECEIPTS_ALONE.body).not.toContain("includes_costs");
    expect(
      G20C_RECEIPTS_BEHIND_COSTS.body.replace(
        /\s*and s\.includes_costs = true/,
        ""
      )
    ).toBe(G20D_RECEIPTS_ALONE.body);
  });

  it("G20e rejects ONE routine serving both capabilities", () => {
    // ## The "stated limit" that was not a limit (second review, MEDIUM)
    //
    // The first version of this file asserted the opposite of this test. It
    // guarded clause 3 with `!mentionsCosts`, declared a routine returning both
    // kinds "off-architecture and therefore somebody else's problem", and
    // pinned that as a deliberate limit.
    //
    // It was wrong. This is the reviewer's fixture, verbatim in shape: the
    // contract's **own approved name**, one extra column, both gates present —
    // and it produced zero findings from all seven Tier A rules. The closed
    // allow-list checks the function name; it has nothing to say about an
    // extra column. So the "architecture closes it" argument closed nothing.
    //
    // It is now a rule, and a total one rather than a heuristic: one query has
    // one predicate for one result set, so a `costs=false receipts=true` grant
    // cannot be served correctly by any gating of this shape.
    const both = readerOf(
      sql(`
        create function public.share_read_receipts(p_token text)
        returns table (id uuid, cost_amount numeric, storage_path text)
        language sql stable security definer set search_path = ''
        as $share$
          select r.id, r.cost_amount, x.storage_path
          from public.records r
          join public.receipts x on x.record_id = r.id
          join public.shares s on s.vehicle_id = r.vehicle_id
          where s.token_hash = extensions.digest(p_token, 'sha256')
            and s.revoked_at is null
            and s.expires_at > now()
            and s.includes_costs = true
            and s.includes_receipts = true;
        $share$;
      `)
    );

    expect(capabilityGateIssues(both).join(" | ")).toContain(
      "returns cost columns AND receipt data from one routine"
    );
  });

  it("G20e CONTROL: either kind ALONE, correctly gated, is accepted", () => {
    // The pair. A rule that rejected both single-capability readers would
    // reject the architecture it exists to enforce.
    expect(capabilityGateIssues(G20B_GATED_COSTS)).toEqual([]);
    expect(capabilityGateIssues(G20D_RECEIPTS_ALONE)).toEqual([]);
  });
});

describe("T2-401: SHR-08, the refusal is one refusal", () => {
  it("G21 rejects three distinct refusal messages", () => {
    expect(refusalShapeIssues(G21_TALKATIVE_REFUSAL).join(" | ")).toContain(
      "distinct messages"
    );
  });

  it("G21 rejects refusal text that names the case", () => {
    // The oracle, stated in words. "grant expired" tells a caller that the
    // token they guessed was once real, which is the whole thing SHR-08 exists
    // to withhold.
    expect(refusalShapeIssues(G21_TALKATIVE_REFUSAL).join(" | ")).toContain(
      "existence oracle"
    );
  });

  it("G21 CONTROL: one uniform refusal produces nothing", () => {
    expect(refusalShapeIssues(G21B_UNIFORM_REFUSAL)).toEqual([]);
  });

  it("G21 CONTROL: `revoked_at` and `expires_at` are not refusal text", () => {
    // A reader that names the columns it checks is not an oracle; only what it
    // *tells the caller* can be. The rule reads the raised messages, not the
    // body, so `s.revoked_at is null` is invisible to it.
    expect(refusalShapeIssues(readerOf(CORRECT_SHARE_READER))).toEqual([]);
  });

  it("G21 CONTROL: plpgsql's `if not found` is control flow, not a message", () => {
    // **This control found a real over-match**, on the first run. The rule
    // originally scanned the whole body, and `if not found then raise …` is the
    // idiomatic way to test a `select … into` — present in every correct
    // implementation of this routine. Reporting on it would have flagged the
    // one shape SHR-08 actually wants, which is exactly how a security rule
    // ends up deleted instead of fixed. Fixed by scoping the rule to the raised
    // messages; pinned here so it cannot come back.
    expect(G21B_UNIFORM_REFUSAL.body).toContain("if not found");
    expect(refusalShapeIssues(G21B_UNIFORM_REFUSAL)).toEqual([]);
  });
});

describe("T2-401: SHR-08 / 003 MON-02, revocation is never gated", () => {
  it("G22 rejects a revoke that consults a subscription", () => {
    expect(revocationGatingIssues(G22_GATED_REVOCATION).join(" | ")).toContain(
      "subscription"
    );
  });

  it.each<[string]>([
    ["subscription"],
    ["entitlement"],
    ["plan_id"],
    ["billing"],
    ["stripe"],
    ["customer_id"],
    ["quota"],
  ])("G22 rejects a revoke that consults `%s`", (token) => {
    // One probe per deny-list entry, not one probe for the list (second
    // review, F-E). A single-token probe means six of the seven entries can be
    // deleted with the suite staying green — and the entry most likely to be
    // "tidied away" is whichever one nobody wrote a test for. "Any other
    // condition" is SHR-08's phrase; the enumeration is how it is enforced.
    const gated = readerOf(
      sql(`
        create function public.revoke_share_grant(p_share_id uuid)
        returns void
        language sql security definer set search_path = ''
        as $revoke$
          update public.shares s set revoked_at = now()
           where s.id = p_share_id
             and exists (select 1 from public.${token}s b
                          where b.owner_id = (select auth.uid()));
        $revoke$;
      `)
    );

    expect(revocationGatingIssues(gated).join(" | ")).toContain(token);
  });

  it("G22 CONTROL: a revoke scoped to ownership alone is accepted", () => {
    // Ungated is not unowned. A rule that could not tell those apart would
    // reject the only correct implementation.
    expect(revocationGatingIssues(G22B_UNGATED_REVOCATION)).toEqual([]);
  });
});

describe("T2-401: default privileges, the grant half", () => {
  it("G23 rejects `alter default privileges … grant … to anon`", () => {
    expect(defaultPrivilegeGrantIssues(G23_ADP_GRANT).join(" | ")).toContain(
      "every FUTURE object"
    );
  });

  it("G23 CONTROL: the revoke half produces nothing", () => {
    expect(defaultPrivilegeGrantIssues(G23B_ADP_REVOKE)).toEqual([]);
  });

  it("G23: the replay saw the statements — neither verdict is vacuous", () => {
    // Both fixtures must actually parse into ADP records, or "no findings"
    // above would be a statement about a parser that read nothing.
    expect(grants(G23_ADP_GRANT).defaultPrivileges).toHaveLength(1);
    expect(grants(G23B_ADP_REVOKE).defaultPrivileges).toHaveLength(2);
  });
});

describe("T2-401: the optimistic-default sweep, inverted", () => {
  const NONE = new Map<string, string>();

  it.each<[string]>([["includes_costs"], ["is_active"]])(
    "G24 rejects `%s boolean not null default true`",
    (column) => {
      // Both verified against the *old* name-shaped regex, which required
      // `is_` AND `public|shared|visible` AND `default true` — so both walked
      // straight past the guard that existed to catch "a fifth flag this file
      // does not know about".
      expect(
        optimisticBooleanDefaultIssues(G24_OPTIMISTIC_DEFAULTS, NONE).join(
          " | "
        )
      ).toContain(column);
    }
  );

  it("G24: the OLD rule scores both of them clean — the false pass", () => {
    // Recorded verbatim, the way G9 records the revoke-then-grant false pass.
    // This is the evidence that the rewrite was necessary rather than tidy.
    const oldRule = [
      ...G24_OPTIMISTIC_DEFAULTS.matchAll(
        /(is_[a-z_]*(public|shared|visible)[a-z_]*)[^,)]*default true/g
      ),
    ].map((match) => match[1]);

    expect(oldRule).toEqual([]);
    expect(
      optimisticBooleanDefaultIssues(G24_OPTIMISTIC_DEFAULTS, NONE).length
    ).toBe(2);
  });

  it("G24b CONTROL: booleans defaulting to false produce nothing", () => {
    expect(optimisticBooleanDefaultIssues(G24B_HONEST_DEFAULTS, NONE)).toEqual(
      []
    );
  });

  it("G24c rejects a default flipped by a later `alter table`", () => {
    // A migration directory is a sequence. A column created honest and flipped
    // three files later is invisible to any rule that only reads `create table`
    // — the same lesson as the revoke-then-grant defect, one surface over.
    expect(
      optimisticBooleanDefaultIssues(G24C_FLIPPED_LATER, NONE).join(" | ")
    ).toContain("flipped to true");
  });

  it("G24: a NAMED exemption is honoured, an unnamed one is not", () => {
    // The `EXEMPT_PAGES` mechanism again, graded against a synthetic map so the
    // real one can stay empty and still be proven to work.
    const allowed = new Map([
      ["shares.is_active", "a probe fixture, not a real column"],
    ]);

    expect(
      optimisticBooleanDefaultIssues(G24_OPTIMISTIC_DEFAULTS, allowed).join(
        " | "
      )
    ).not.toContain("is_active");
    expect(
      optimisticBooleanDefaultIssues(G24_OPTIMISTIC_DEFAULTS, allowed).join(
        " | "
      )
    ).toContain("includes_costs");
  });

  it("G24: does not report a non-boolean column that defaults to true-ish", () => {
    // The over-match direction. A `text` column defaulting to `'true'` is not a
    // visibility flag, and a rule that said so would be reporting on data.
    const text = sql(`
      create table public.shares (
        id uuid primary key,
        note text not null default 'true'
      );
    `);

    expect(optimisticBooleanDefaultIssues(text, NONE)).toEqual([]);
  });
});

describe("T2-404a: SHR-09, the flags and the world path", () => {
  // The narrowing, graded from both sides. Read the fixture comments above for
  // what each one isolates; every assertion here is paired with its opposite.

  it("G27 ACCEPT: a declared reader gated on `p_token is null`", () => {
    // The whole point of the ruling. Before the narrowing this was a finding,
    // and the amendment that created the shape did not revisit the rule.
    expect(
      publicationFlagIssues(G27_GATED_WORLD_PATH, SHARE_READER_NAMES)
    ).toEqual([]);
  });

  it("G27b REJECTS an ungated flag read by the SAME declared reader", () => {
    // The half that makes the accept case above safe rather than a blanket
    // exemption. If this ever goes green, "allow-listed" has come to mean
    // "may read the flags", which is not what the owner ruled.
    expect(
      publicationFlagIssues(G27B_UNGATED_FLAG_READ, SHARE_READER_NAMES).join(
        " | "
      )
    ).toContain("without requiring `p_token is null`");
  });

  it("G27c REJECTS the flags consulted while resolving a token", () => {
    // `p_token is null` appears in this body — one branch away from the flag.
    // A rule that asked "does the body mention the null test?" passes it.
    expect(
      publicationFlagIssues(G27C_FLAG_ON_TOKEN_PATH, SHARE_READER_NAMES).join(
        " | "
      )
    ).toContain("is_worklog_public");
  });

  it.each<[string, string]>([
    ["G27e a guard widened by `or`", G27E_WIDENED_GUARD],
    ["G27f the same widening in a predicate", G27F_OR_PREDICATE],
    ["G27h a read after `end if`", G27H_AFTER_END_IF],
    ["G27j the second of two flags", G27J_ONE_OF_TWO],
    ["G27k a null test in an EARLIER statement", G27K_LATER_STATEMENT],
    ["G27l a guard on `is NOT null`", G27L_INVERTED_GUARD],
    ["G27m the token path reached by `elsif`", G27M_ELSIF_TOKEN_PATH],
    ["G27o a guard negated by `not (… is null)`", G27O_NEGATED_GUARD],
    ["G27p the same negation in a predicate", G27P_NEGATED_PREDICATE],
    ["G27q the ungated second arm of a `union`", G27Q_UNION_SECOND_ARM],
    ["G27r a bare assignment with no predicate", G27R_BARE_ASSIGNMENT],
    [
      "G27s the `else` of `is not null` (over-strict, deliberate)",
      G27S_NEGATIVE_ELSE,
    ],
    ["G27u an identifier ending in `where`", G27U_KEYWORD_SUFFIX_IDENTIFIER],
  ])("%s is rejected", (_label, fixture) => {
    expect(
      publicationFlagIssues(fixture, SHARE_READER_NAMES).length
    ).toBeGreaterThan(0);
  });

  it.each<[string, string]>([
    ["G27n the gate expressed as an `elsif`", G27N_ELSIF_GATED],
    ["G27t the flag in a join's `on`, gated by the `where`", G27T_ON_CLAUSE],
    [
      "G27v a gated read as a non-first statement (leading whitespace)",
      G27V_LEADING_WHITESPACE_GATED,
    ],
  ])("%s is ACCEPTED", (_label, fixture) => {
    // Paired with the rejects above, one for one. G27n is G27m's control and
    // G27t is G27r's: without them, "an `elsif` never gates" and "a flag
    // outside the predicate text is never gated" are both mutations the corpus
    // survives, and each would reject a reader doing the right thing. G27v is
    // the coordinate-space regression (PR #141): the accept case has to
    // survive on a statement whose own leading whitespace was collapsed and
    // then trimmed away, not just on the first statement of a body.
    expect(publicationFlagIssues(fixture, SHARE_READER_NAMES)).toEqual([]);
  });

  it("G27j names the UNGATED flag and not the gated one", () => {
    // A finding that named both would be telling a reviewer to go and look at
    // correct code, which is how a real rule gets ignored.
    const found = publicationFlagIssues(
      G27J_ONE_OF_TWO,
      SHARE_READER_NAMES
    ).join(" | ");

    expect(found).toContain("is_showcase_public");
    expect(found).not.toContain("is_worklog_public");
  });

  it("G27g ACCEPT: the single-predicate spelling, gated as a conjunct", () => {
    // The rule is not plpgsql-only. Without this, tightening it to require an
    // `if` statement would reject a legitimate `language sql` reader silently.
    expect(
      publicationFlagIssues(G27G_CONJUNCT_ACCEPT, SHARE_READER_NAMES)
    ).toEqual([]);
  });

  it("G27i REJECTS a correctly-gated routine that is not on the allow-list", () => {
    // Verdict 1, unchanged by the narrowing: this body is gated exactly as
    // G27's is, and it is still forbidden, because it is not one of the three
    // readers the contract names.
    expect(
      publicationFlagIssues(G27I_NOT_ALLOW_LISTED, SHARE_READER_NAMES).join(
        " | "
      )
    ).toContain("is not a declared share reader");
  });

  it("the allow-list is matched by SCHEMA and name, not by name", () => {
    // The PR #74 lesson, applied to the new rule. A `private.share_read_records`
    // bearing a declared reader's name must not inherit its permission to read
    // the flags — it is a different function with a different ACL.
    const impostor = G27_GATED_WORLD_PATH.replaceAll(
      "public.share_read_records",
      "private.share_read_records"
    );

    expect(impostor).not.toEqual(G27_GATED_WORLD_PATH);
    expect(
      publicationFlagIssues(impostor, SHARE_READER_NAMES).join(" | ")
    ).toContain("is not a declared share reader");
  });

  it("a reader that names no flag at all produces nothing", () => {
    // The reference reader, which is what shipped. The rule must be silent
    // about it — otherwise the unmarked grader in `share-grants.test.ts` would
    // be red for a routine doing exactly the right thing.
    expect(
      publicationFlagGateIssues(readerOf(CORRECT_SHARE_READER), true)
    ).toEqual([]);
    expect(
      publicationFlagGateIssues(readerOf(CORRECT_SHARE_READER), false)
    ).toEqual([]);
  });

  it("the per-routine rule and the sweep agree", () => {
    // The sweep decides allow-list membership and delegates the rest. A
    // divergence between them would mean one of the two is grading something
    // nobody asserts on.
    const [routine] = functions(G27B_UNGATED_FLAG_READ);

    expect(publicationFlagGateIssues(routine, true)).toEqual(
      publicationFlagIssues(G27B_UNGATED_FLAG_READ, SHARE_READER_NAMES)
    );
  });

  it("every G27 fixture is one anon-reachable routine — none is vacuous", () => {
    // The corpus's own canary. Each verdict above is a statement about a
    // routine the sweep can actually see; a fixture that failed to parse, or
    // that was never granted to `anon`, would score "no findings" and look
    // like an accept case.
    for (const fixture of [
      G27_GATED_WORLD_PATH,
      G27B_UNGATED_FLAG_READ,
      G27C_FLAG_ON_TOKEN_PATH,
      G27E_WIDENED_GUARD,
      G27F_OR_PREDICATE,
      G27G_CONJUNCT_ACCEPT,
      G27H_AFTER_END_IF,
      G27I_NOT_ALLOW_LISTED,
      G27J_ONE_OF_TWO,
      G27K_LATER_STATEMENT,
      G27L_INVERTED_GUARD,
      G27M_ELSIF_TOKEN_PATH,
      G27N_ELSIF_GATED,
      G27O_NEGATED_GUARD,
      G27P_NEGATED_PREDICATE,
      G27Q_UNION_SECOND_ARM,
      G27R_BARE_ASSIGNMENT,
      G27S_NEGATIVE_ELSE,
      G27T_ON_CLAUSE,
      G27U_KEYWORD_SUFFIX_IDENTIFIER,
      G27V_LEADING_WHITESPACE_GATED,
    ]) {
      expect(functions(fixture)).toHaveLength(1);
      expect(anonExecutableFunctions(fixture)).toHaveLength(1);
      expect(functions(fixture)[0].body).toMatch(
        /is_worklog_public|is_showcase_public/
      );
    }
  });
});

describe("T2-401: every new probe fires, and every control stays silent", () => {
  it("every wide-open T2-401 probe produces at least one finding", () => {
    // The sweep, in the shape sections A and D use. A rule refactor that
    // quietly stopped detecting one of these would otherwise show up as a
    // single silent green test.
    const verdicts: [string, string[]][] = [
      ["G19 branches on kind", presetBranchIssues(G19_BRANCHES_ON_KIND)],
      ["G20 ungated costs", capabilityGateIssues(G20_UNGATED_COSTS)],
      [
        "G20c receipts behind costs",
        capabilityGateIssues(G20C_RECEIPTS_BEHIND_COSTS),
      ],
      [
        "G26 quoted role grant",
        tableGrantIssues(G26_QUOTED_ROLE_GRANT, ["records"]),
      ],
      [
        "G26b quoted public grant",
        tableGrantIssues(G26B_QUOTED_PUBLIC_GRANT, ["records"]),
      ],
      [
        "G26c quoted ADP grant",
        defaultPrivilegeGrantIssues(G26C_QUOTED_ADP_GRANT),
      ],
      [
        "G26d quoted bulk grant",
        tableGrantIssues(G26D_QUOTED_BULK_GRANT, ["records"]),
      ],
      [
        "G26e quoted function grant",
        anonFunctionAllowListIssues(G26E_QUOTED_FUNCTION_GRANT, []).unexpected,
      ],
      [
        "G26f quoted policy role",
        userTablePolicyIssues(G26F_QUOTED_POLICY_ROLE, ["records"]),
      ],
      ["G21 talkative refusal", refusalShapeIssues(G21_TALKATIVE_REFUSAL)],
      ["G22 gated revocation", revocationGatingIssues(G22_GATED_REVOCATION)],
      ["G23 ADP grant to anon", defaultPrivilegeGrantIssues(G23_ADP_GRANT)],
      [
        "G24 optimistic defaults",
        optimisticBooleanDefaultIssues(G24_OPTIMISTIC_DEFAULTS, new Map()),
      ],
      [
        "G24c default flipped later",
        optimisticBooleanDefaultIssues(G24C_FLIPPED_LATER, new Map()),
      ],
      [
        "G25 mis-joined policy",
        subqueryCorrelationIssues(
          sql(`
            create policy "records owner all" on public.records
              for all to authenticated
              using (exists (select 1 from public.vehicles v
                              where records.vehicle_id is not null
                                and v.owner_id = (select auth.uid())));
          `),
          ["records"]
        ),
      ],
      [
        "G27b ungated flag read",
        publicationFlagIssues(G27B_UNGATED_FLAG_READ, SHARE_READER_NAMES),
      ],
      [
        "G27c flag on the token path",
        publicationFlagIssues(G27C_FLAG_ON_TOKEN_PATH, SHARE_READER_NAMES),
      ],
      [
        "G27e widened guard",
        publicationFlagIssues(G27E_WIDENED_GUARD, SHARE_READER_NAMES),
      ],
      [
        "G27f widened predicate",
        publicationFlagIssues(G27F_OR_PREDICATE, SHARE_READER_NAMES),
      ],
      [
        "G27h read after end if",
        publicationFlagIssues(G27H_AFTER_END_IF, SHARE_READER_NAMES),
      ],
      [
        "G27i not on the allow-list",
        publicationFlagIssues(G27I_NOT_ALLOW_LISTED, SHARE_READER_NAMES),
      ],
      [
        "G27j one of two flags ungated",
        publicationFlagIssues(G27J_ONE_OF_TWO, SHARE_READER_NAMES),
      ],
      [
        "G27k null test in an earlier statement",
        publicationFlagIssues(G27K_LATER_STATEMENT, SHARE_READER_NAMES),
      ],
      [
        "G27l guard on `is not null`",
        publicationFlagIssues(G27L_INVERTED_GUARD, SHARE_READER_NAMES),
      ],
      [
        "G27m token path reached by elsif",
        publicationFlagIssues(G27M_ELSIF_TOKEN_PATH, SHARE_READER_NAMES),
      ],
      [
        "G27o guard negated by `not`",
        publicationFlagIssues(G27O_NEGATED_GUARD, SHARE_READER_NAMES),
      ],
      [
        "G27p negation in a predicate",
        publicationFlagIssues(G27P_NEGATED_PREDICATE, SHARE_READER_NAMES),
      ],
      [
        "G27q ungated union arm",
        publicationFlagIssues(G27Q_UNION_SECOND_ARM, SHARE_READER_NAMES),
      ],
      [
        "G27r bare assignment",
        publicationFlagIssues(G27R_BARE_ASSIGNMENT, SHARE_READER_NAMES),
      ],
      [
        "G27s else of `is not null`",
        publicationFlagIssues(G27S_NEGATIVE_ELSE, SHARE_READER_NAMES),
      ],
      [
        "G27u identifier ending in `where`",
        publicationFlagIssues(
          G27U_KEYWORD_SUFFIX_IDENTIFIER,
          SHARE_READER_NAMES
        ),
      ],
    ];

    expect(
      verdicts.filter(([, issues]) => issues.length === 0).map(([name]) => name)
    ).toEqual([]);
  });

  it("every correct T2-401 probe produces none", () => {
    // The single assertion that would catch a rule which has become
    // over-strict. Every rejection above is only meaningful because this
    // passes.
    expect(
      [
        presetBranchIssues(readerOf(CORRECT_SHARE_READER)),
        capabilityGateIssues(readerOf(CORRECT_SHARE_READER)),
        capabilityGateIssues(G20B_GATED_COSTS),
        capabilityGateIssues(G20D_RECEIPTS_ALONE),
        refusalShapeIssues(readerOf(CORRECT_SHARE_READER)),
        refusalShapeIssues(G21B_UNIFORM_REFUSAL),
        revocationGatingIssues(G22B_UNGATED_REVOCATION),
        defaultPrivilegeGrantIssues(G23B_ADP_REVOKE),
        optimisticBooleanDefaultIssues(G24B_HONEST_DEFAULTS, new Map()),
        subqueryCorrelationIssues(
          sql(`
            create policy "records owner all" on public.records
              for all to authenticated
              using (exists (select 1 from public.vehicles v
                              where v.id = records.vehicle_id
                                and v.owner_id = (select auth.uid())));
          `),
          ["records"]
        ),
        publicationFlagIssues(G27_GATED_WORLD_PATH, SHARE_READER_NAMES),
        publicationFlagIssues(G27G_CONJUNCT_ACCEPT, SHARE_READER_NAMES),
        publicationFlagIssues(G27N_ELSIF_GATED, SHARE_READER_NAMES),
        publicationFlagIssues(G27T_ON_CLAUSE, SHARE_READER_NAMES),
        publicationFlagIssues(
          G27V_LEADING_WHITESPACE_GATED,
          SHARE_READER_NAMES
        ),
        publicationFlagGateIssues(readerOf(CORRECT_SHARE_READER), true),
        ...G18_SETOF_NON_USER_TABLE.map(([, fixture]) =>
          functions(sql(fixture)).flatMap(projectionIssues)
        ),
      ].flat()
    ).toEqual([]);
  });
});

/* =========================================================================
 * G28 — `tableGrantIssues` honouring `EXEMPT_PUBLIC_TABLES`
 * ====================================================================== */

describe("G28: tableGrantIssues skips a table EXEMPT_PUBLIC_TABLES names, and only that table", () => {
  /**
   * The grant shape RM-01/RM-02 actually requires for
   * `search_index_entries` — `select` to `anon` and `authenticated`,
   * everything else revoked, full CRUD reserved to `service_role` — derived
   * from `specs/001-foundation/spec.md` (RM-02) and T801's `tasks.md` entry
   * ("`select` for `anon`/`authenticated` is **not** graded as a violation —
   * this is public reference content, not `tests/garage/contract.ts`'s
   * private-data standard"), not copied from any implementer's migration.
   * Table name matches the real one deliberately: this is the fixture that
   * proves the *real* default `EXEMPT_PUBLIC_TABLES` (not a synthetic
   * stand-in) actually silences the real table it names.
   */
  const G28_SEARCH_INDEX_ENTRIES = sql(`
    create table public.search_index_entries (
      collection text not null,
      entry_id text not null,
      locale text not null,
      title text not null,
      constraint search_index_entries_pkey primary key (collection, entry_id, locale)
    );
    alter table public.search_index_entries enable row level security;
    alter table public.search_index_entries force row level security;
    create policy "search index entries are public reference data"
      on public.search_index_entries for select to anon, authenticated using (true);

    revoke all on public.search_index_entries from anon;
    revoke all on public.search_index_entries from public;
    revoke all on public.search_index_entries from authenticated;

    grant select on public.search_index_entries to anon;
    grant select on public.search_index_entries to authenticated;
    grant select, insert, update, delete on public.search_index_entries to service_role;
  `);

  /**
   * The same shape, on a table name that will never appear in the real
   * `EXEMPT_PUBLIC_TABLES` — a generic probe for the *mechanism*, in the
   * style of G10's synthetic exempt map for `ungradedTableIssues`, so the
   * behaviour under test is "a named exemption is honoured", not "this one
   * particular table happens to work".
   */
  const G28_GENERIC_PUBLIC_TABLE = sql(`
    create table public.reference_probe (id uuid primary key);
    revoke all on public.reference_probe from anon;
    revoke all on public.reference_probe from public;
    revoke all on public.reference_probe from authenticated;
    grant select on public.reference_probe to anon;
    grant select on public.reference_probe to authenticated;
  `);

  it("G28: with no exemption, the anon select grant is flagged — the failing-first proof", () => {
    // Confirms `tableGrantIssues` still does its ordinary job when a table is
    // NOT exempt: this is the exact finding `search_index_entries` would have
    // produced against every call site in this suite before this branch
    // added it to `EXEMPT_PUBLIC_TABLES` — reproduced here against a
    // synthetic table name (rather than the real one) so this probe keeps
    // meaning what it says even after the real table is exempted below.
    const issues = tableGrantIssues(
      G28_GENERIC_PUBLIC_TABLE,
      ["reference_probe"],
      {
        exempt: new Map(),
      }
    ).join(" | ");

    expect(issues).toContain("public.reference_probe");
    expect(issues).toContain("anon holds select");
  });

  it("G28: naming the table in a synthetic exempt map silences it", () => {
    const exempt = new Map([
      ["reference_probe", "synthetic probe — public reference data"],
    ]);

    expect(
      tableGrantIssues(G28_GENERIC_PUBLIC_TABLE, ["reference_probe"], {
        exempt,
      })
    ).toEqual([]);
  });

  it("G28: the DEFAULT exempt set — EXEMPT_PUBLIC_TABLES itself — silences search_index_entries with no options argument", () => {
    // The real assertion: both call sites in `rls-deny-by-default.test.ts`
    // and `share-instrument.test.ts` call `tableGrantIssues(sql, tables)`
    // with no third argument, so this is the path that actually matters.
    expect(
      tableGrantIssues(G28_SEARCH_INDEX_ENTRIES, ["search_index_entries"])
    ).toEqual([]);
  });

  it("G28: exempting one table does not blind the sweep to a genuinely wide-open one", () => {
    // The positive control this whole probe would be worthless without. Reuses
    // G9 — an unrelated, already-wide-open `records` fixture from earlier in
    // this file — called with the real default `EXEMPT_PUBLIC_TABLES`, which
    // does not contain "records". If adding an entry ever widened the check
    // instead of narrowing it to the named table, this goes green and should
    // not.
    expect(tableGrantIssues(G9_REVOKE_THEN_GRANT, ["records"])).not.toEqual([]);
  });

  it("G28: EXEMPT_PUBLIC_TABLES really does contain search_index_entries, with a real reason", () => {
    // A control on the fixture data itself, not the rule — if this map were
    // ever emptied back out (or the key renamed) while the tests above kept
    // passing `search_index_entries` explicitly as a table name, the probe
    // above would start testing nothing. `share-instrument.test.ts` also pins
    // the map's exact size; this pins the one entry's shape.
    expect(EXEMPT_PUBLIC_TABLES.has("search_index_entries")).toBe(true);
    expect(
      EXEMPT_PUBLIC_TABLES.get("search_index_entries")?.length ?? 0
    ).toBeGreaterThan(20);
  });

  it("G28: the known, bounded gap — an exempt table's WRITE grants are not checked here", () => {
    // Documented rather than hidden, per .claude/GRADER-PRINCIPLES.md's "a
    // known-pages sweep is only as complete as its list": `tableGrantIssues`
    // skips an exempt table entirely, so a mistaken `grant insert … to
    // authenticated` on `search_index_entries` would NOT be caught by this
    // function. That is intentional, not an oversight — `tableGrantIssues`'s
    // "authenticated may hold select/insert/update/delete" expected-list is
    // the correct shape for RLS-scoped user data and the WRONG shape for this
    // table (RM-02 forbids all three verbs for `authenticated` too, not just
    // `anon`), so reusing it here would give a false pass, not a real proof.
    // The real proof of write-verb absence is
    // `tests/sync/contract.ts`'s `SEARCH_INDEX_WRITE_VERBS` /
    // `SEARCH_INDEX_WRITE_DENIED_ROLES` and `tests/sync/rules.ts`'s
    // `writeGrantIssues` — a different suite, deliberately, because it is the
    // one that knows this table's actual expected ACL.
    const compromised = sql(`
      ${G28_SEARCH_INDEX_ENTRIES}
      grant insert on public.search_index_entries to authenticated;
    `);

    expect(tableGrantIssues(compromised, ["search_index_entries"])).toEqual([]);
  });
});
