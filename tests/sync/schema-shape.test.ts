/**
 * Graders — the read-model table shape (RM-01, RM-02, SRCH-01).
 *
 * > **RM-01** WHEN content merges to `main`, CI SHALL sync the built content
 * > into Supabase (typed tables, `tsvector` columns with `english` and
 * > `spanish` dictionaries). The sync SHALL be idempotent and one-directional
 * > (git → DB, never back).
 * > **RM-02** THE Supabase read-model SHALL never be written by any process
 * > other than the CI sync job.
 *
 * T802 [PLATFORM] shipped the migration
 * (`supabase/migrations/20260906120200_search_index_entries.sql`) and
 * activated every DDL-reading grader below by deleting its `it.fails` line,
 * the same convention `tests/garage/` uses throughout (see
 * `schema-shape.test.ts` there for the precedent this file follows).
 *
 * ## Two kinds of test in this file, and why only one kind was ever marked
 *
 * `describe("searchVectorLocaleIssues — …")`, `describe("hasGinIndexOn —
 * …")`, `describe("primaryKeyColumns — …")` and
 * `describe("writeGrantIssues — …")` grade **this file's own
 * instrument**, `tests/sync/rules.ts`, against hand-written sample SQL with a
 * known-correct and a known-wrong answer. They are unmarked and green — the
 * positive control `.claude/GRADER-PRINCIPLES.md` asks for ("Mutation-test
 * the probe corpus itself"), proving the rule can both accept and reject
 * independent of whatever the real migration says. Every other `describe` in
 * this file reads the real migration directory and was `it.fails` until T802.
 *
 * refs specs/001-foundation (RM-01, RM-02, SRCH-01)
 */
import { describe, expect, it } from "vitest";
import {
  SEARCH_INDEX_COLUMNS,
  SEARCH_INDEX_TABLE,
  SEARCH_VECTOR_COLUMN_NAME,
} from "./contract.ts";
import {
  hasGinIndexOn,
  localeDictionaryConfigFor,
  primaryKeyColumns,
  searchVectorLocaleIssues,
  writeGrantIssues,
} from "./rules.ts";
import {
  columnDefinition,
  createTableBody,
  enablesRls,
  forcesRls,
  functions,
  migrationSql,
  normalizeSql,
} from "../garage/sql.ts";

/* =========================================================================
 * The instrument, mutation-tested against hand-written SQL — UNMARKED
 * ====================================================================== */

/** The canonical generated-column shape this file's own docs illustrate. */
const CORRECT_GENERATED_COLUMN = normalizeSql(`
  search_vector tsvector generated always as (
    to_tsvector(
      case locale when 'en' then 'english'::regconfig when 'es' then 'spanish'::regconfig end,
      coalesce(title, '') || ' ' || coalesce(snippet, '')
    )
  ) stored
`);

/** The equally-valid trigger-function shape. */
const CORRECT_TRIGGER_BODY = normalizeSql(`
  begin
    if new.locale = 'en' then
      new.search_vector := to_tsvector('english', coalesce(new.title, ''));
    elsif new.locale = 'es' then
      new.search_vector := to_tsvector('spanish', coalesce(new.title, ''));
    end if;
    return new;
  end;
`);

/** The realistic defect: both branches use the same dictionary. */
const SAME_CONFIG_BOTH_LOCALES = normalizeSql(`
  search_vector tsvector generated always as (
    to_tsvector(
      case locale when 'en' then 'english'::regconfig when 'es' then 'english'::regconfig end,
      title
    )
  ) stored
`);

/** No branching at all — a single hard-coded dictionary. */
const NO_LOCALE_BRANCH = normalizeSql(`
  search_vector tsvector generated always as (to_tsvector('english', title)) stored
`);

describe("localeDictionaryConfigFor — reads the CASE and the trigger shapes", () => {
  it("reads 'en' from the CASE shape", () => {
    expect(localeDictionaryConfigFor(CORRECT_GENERATED_COLUMN, "en")).toBe(
      "english"
    );
  });

  it("reads 'es' from the CASE shape", () => {
    expect(localeDictionaryConfigFor(CORRECT_GENERATED_COLUMN, "es")).toBe(
      "spanish"
    );
  });

  it("reads 'en' from the trigger shape", () => {
    expect(localeDictionaryConfigFor(CORRECT_TRIGGER_BODY, "en")).toBe(
      "english"
    );
  });

  it("reads 'es' from the trigger shape", () => {
    expect(localeDictionaryConfigFor(CORRECT_TRIGGER_BODY, "es")).toBe(
      "spanish"
    );
  });

  it("does not confuse the 'es' branch's dictionary for 'en's — the mutation this file exists to catch", () => {
    // The whole reason this is grammar-anchored rather than window-based:
    // 'english' sits well within any window wide enough to see 'spanish'
    // after 'en', and a proximity check would report BOTH here.
    expect(localeDictionaryConfigFor(CORRECT_GENERATED_COLUMN, "en")).not.toBe(
      "spanish"
    );
  });

  it("returns null when neither shape is present", () => {
    expect(localeDictionaryConfigFor("select 1", "en")).toBeNull();
  });
});

describe("searchVectorLocaleIssues — the positive and the negative", () => {
  it("ACCEPTS the correct CASE shape (positive control)", () => {
    expect(searchVectorLocaleIssues(CORRECT_GENERATED_COLUMN)).toEqual([]);
  });

  it("ACCEPTS the correct trigger shape (positive control)", () => {
    expect(searchVectorLocaleIssues(CORRECT_TRIGGER_BODY)).toEqual([]);
  });

  it("REJECTS the same-dictionary-both-locales defect, naming both locales", () => {
    const issues = searchVectorLocaleIssues(SAME_CONFIG_BOTH_LOCALES);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toMatch(/'es'/);
    expect(issues.join(" ")).toMatch(/english/);
  });

  it("REJECTS a single hard-coded dictionary with no locale branch at all", () => {
    const issues = searchVectorLocaleIssues(NO_LOCALE_BRANCH);

    expect(issues.join(" ")).toContain(
      "no dictionary config found for locale 'es'"
    );
  });

  it("REJECTS the mirror-image swap ('en'→spanish, 'es'→english)", () => {
    const swapped = normalizeSql(`
      case locale when 'en' then 'spanish'::regconfig when 'es' then 'english'::regconfig end
    `);
    const issues = searchVectorLocaleIssues(swapped);

    expect(issues.some((issue) => issue.includes("'en'"))).toBe(true);
    expect(issues.some((issue) => issue.includes("'es'"))).toBe(true);
  });
});

describe("hasGinIndexOn — the positive and the negative", () => {
  const withIndex = normalizeSql(`
    create table public.search_index_entries (id uuid);
    create index search_index_entries_search_vector_idx
      on public.search_index_entries using gin (search_vector);
  `);
  const withoutIndex = normalizeSql(`
    create table public.search_index_entries (id uuid);
  `);
  const wrongMethod = normalizeSql(`
    create index x on public.search_index_entries using btree (search_vector);
  `);

  it("ACCEPTS a real GIN index on the column (positive control)", () => {
    expect(
      hasGinIndexOn(withIndex, "search_index_entries", "search_vector")
    ).toBe(true);
  });

  it("REJECTS when there is no index at all", () => {
    expect(
      hasGinIndexOn(withoutIndex, "search_index_entries", "search_vector")
    ).toBe(false);
  });

  it("REJECTS a non-GIN index — btree cannot serve `@@` at scale", () => {
    expect(
      hasGinIndexOn(wrongMethod, "search_index_entries", "search_vector")
    ).toBe(false);
  });
});

/**
 * The primary key `contract.ts` asks for, derived from the `primaryKey: true`
 * flags rather than retyped — a fourth flagged column would move this and the
 * grader below together, which is the point of deriving it.
 */
const EXPECTED_PRIMARY_KEY = SEARCH_INDEX_COLUMNS.filter(
  (column) => column.primaryKey
).map((column) => column.name);

describe("primaryKeyColumns — the positive and the negative", () => {
  const composite = normalizeSql(`
    create table public.search_index_entries (
      collection text not null,
      entry_id text not null,
      locale text not null,
      title text not null,
      primary key (collection, entry_id, locale)
    );
  `);
  const namedConstraint = normalizeSql(`
    create table public.search_index_entries (
      collection text not null,
      entry_id text not null,
      locale text not null,
      constraint search_index_entries_pkey primary key (collection, entry_id, locale)
    );
  `);
  const boltedOn = normalizeSql(`
    create table public.search_index_entries (
      collection text not null,
      entry_id text not null,
      locale text not null
    );
    alter table only public.search_index_entries
      add constraint search_index_entries_pkey primary key (collection, entry_id, locale);
  `);
  /** The exact defect the old presence-only assertion let through. */
  const surrogateId = normalizeSql(`
    create table public.search_index_entries (
      id uuid primary key default gen_random_uuid(),
      collection text not null,
      entry_id text not null,
      locale text not null
    );
  `);
  /** The other one: a key that forgot the locale column. */
  const missingLocale = normalizeSql(`
    create table public.search_index_entries (
      collection text not null,
      entry_id text not null,
      locale text not null,
      primary key (collection, entry_id)
    );
  `);
  const noKeyAtAll = normalizeSql(`
    create table public.search_index_entries (
      collection text not null,
      entry_id text not null,
      locale text not null
    );
  `);

  it("reads a table-level composite key (positive control)", () => {
    expect(primaryKeyColumns(composite, "search_index_entries")).toEqual([
      "collection",
      "entry_id",
      "locale",
    ]);
  });

  it("reads a NAMED table-level constraint the same way", () => {
    expect(primaryKeyColumns(namedConstraint, "search_index_entries")).toEqual([
      "collection",
      "entry_id",
      "locale",
    ]);
  });

  it("reads an ALTER TABLE ONLY … ADD CONSTRAINT key — what pg_dump emits", () => {
    expect(primaryKeyColumns(boltedOn, "search_index_entries")).toEqual([
      "collection",
      "entry_id",
      "locale",
    ]);
  });

  it("reports a surrogate id key as ['id'] — the shape a presence check missed", () => {
    // All three real key columns are present in this DDL; only the *key* is
    // wrong. A grader reading `columnDefinitions` alone scores it a pass.
    expect(primaryKeyColumns(surrogateId, "search_index_entries")).toEqual([
      "id",
    ]);
    expect(primaryKeyColumns(surrogateId, "search_index_entries")).not.toEqual(
      EXPECTED_PRIMARY_KEY
    );
  });

  it("reports a key missing `locale` as the two columns it really has", () => {
    expect(primaryKeyColumns(missingLocale, "search_index_entries")).toEqual([
      "collection",
      "entry_id",
    ]);
  });

  it("returns null when nothing declares a key — unknown is not an empty key", () => {
    expect(primaryKeyColumns(noKeyAtAll, "search_index_entries")).toBeNull();
  });

  it("returns null for a table the migration never creates", () => {
    expect(primaryKeyColumns(composite, "some_other_table")).toBeNull();
  });
});

describe("writeGrantIssues — the positive and the negative", () => {
  const locked = normalizeSql(`
    create table public.search_index_entries (id uuid);
    revoke all on public.search_index_entries from anon, authenticated, public;
    grant select on public.search_index_entries to anon, authenticated;
  `);
  const leaky = normalizeSql(`
    create table public.search_index_entries (id uuid);
    revoke all on public.search_index_entries from anon, authenticated, public;
    grant select, insert on public.search_index_entries to authenticated;
  `);
  const unproven = normalizeSql(`
    create table public.search_index_entries (id uuid);
  `);

  it("ACCEPTS select-only for anon/authenticated (positive control — public reference data)", () => {
    expect(writeGrantIssues(locked, "search_index_entries")).toEqual([]);
  });

  it("REJECTS insert reachable by authenticated — RM-02's exact defect shape", () => {
    const issues = writeGrantIssues(leaky, "search_index_entries");

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("authenticated");
    expect(issues.join(" ")).toContain("insert");
  });

  it("REJECTS an ACL nothing has cleared — unknown is a finding, not a pass", () => {
    const issues = writeGrantIssues(unproven, "search_index_entries");

    expect(issues.join(" ")).toContain("unknown");
  });
});

/* =========================================================================
 * The real migration directory — T802 has not shipped it yet
 * ====================================================================== */

function searchIndexTableBody(): string | null {
  return createTableBody(migrationSql(), SEARCH_INDEX_TABLE);
}

describe("the table exists", () => {
  it(`public.${SEARCH_INDEX_TABLE} is created`, () => {
    expect(searchIndexTableBody()).not.toBeNull();
  });
});

describe("every column RM-01/SRCH-01 asks for is declared", () => {
  it.each(
    SEARCH_INDEX_COLUMNS.map(
      (column) => [column.name, column.requirement] as const
    )
  )("%s exists (%s)", (name) => {
    const body = searchIndexTableBody();
    expect(body).not.toBeNull();
    expect(columnDefinition(body ?? "", name)).not.toBeNull();
  });

  it.each(
    SEARCH_INDEX_COLUMNS.filter((column) => column.type !== undefined).map(
      (column) => [column.name, column] as const
    )
  )("%s has the type RM-01/SRCH-01 implies", (name, column) => {
    const body = searchIndexTableBody();
    const definition = body ? columnDefinition(body, name) : null;

    expect(definition).not.toBeNull();
    expect(definition?.definition ?? "").toMatch(column.type as RegExp);
  });

  it.each(
    SEARCH_INDEX_COLUMNS.filter((column) => column.notNull).map(
      (column) => [column.name] as const
    )
  )("%s is not null", (name) => {
    const body = searchIndexTableBody();
    const definition = body ? columnDefinition(body, name) : null;

    expect(definition?.definition ?? "").toMatch(
      /\bnot null\b|\bprimary key\b/
    );
  });

  it("the primary key is exactly (collection, entry_id, locale)", () => {
    // The *key*, not the columns. The first version of this asked only
    // whether the three names appeared among `columnDefinitions`, which a
    // surrogate `id uuid primary key` sitting beside three ordinary columns
    // satisfied completely — as did a two-column key that forgot `locale`.
    // RM-01's idempotent upsert needs `(collection, entry_id, locale)` to be a
    // real conflict target, so that is what is read here.
    //
    // Membership and arity are graded; column *order* is not. Order is a real
    // choice (it decides which prefix scans the implicit index can serve) and
    // it is T802's to make — `contract.ts` lists the three in one order to be
    // readable, not to rule on that.
    const key = primaryKeyColumns(migrationSql(), SEARCH_INDEX_TABLE);

    // `null` is "no primary key is declared anywhere", which is a finding
    // rather than a key with no columns.
    expect(key, "no primary key declared on the table").not.toBeNull();
    expect([...(key ?? [])].sort()).toEqual([...EXPECTED_PRIMARY_KEY].sort());
  });
});

describe("RM-01 — the tsvector column uses per-language dictionaries", () => {
  it("the shipped search_vector definition names both dictionaries correctly", () => {
    const normalized = migrationSql();
    const body = createTableBody(normalized, SEARCH_INDEX_TABLE);
    const columnText =
      (body
        ? columnDefinition(body, SEARCH_VECTOR_COLUMN_NAME)?.definition
        : null) ?? "";
    const triggerText = functions(normalized)
      .map((fn) => fn.body)
      .join(" ");

    const issues = searchVectorLocaleIssues(`${columnText} ${triggerText}`);
    expect(issues).toEqual([]);
  });

  it("a GIN index exists on search_vector", () => {
    expect(
      hasGinIndexOn(
        migrationSql(),
        SEARCH_INDEX_TABLE,
        SEARCH_VECTOR_COLUMN_NAME
      )
    ).toBe(true);
  });
});

describe("RM-02 — no write access outside the CI sync job", () => {
  it("no anon/public/authenticated role holds insert, update, or delete", () => {
    expect(writeGrantIssues(migrationSql(), SEARCH_INDEX_TABLE)).toEqual([]);
  });

  it("row level security is enabled", () => {
    expect(enablesRls(migrationSql(), SEARCH_INDEX_TABLE)).toBe(true);
  });

  it("row level security is FORCED", () => {
    expect(forcesRls(migrationSql(), SEARCH_INDEX_TABLE)).toBe(true);
  });
});

describe("the contract is internally coherent", () => {
  // Unmarked — this describes `contract.ts` itself, not T802's migration.
  it("declares the three primary-key columns among its columns", () => {
    const names = SEARCH_INDEX_COLUMNS.map((column) => column.name);
    expect(names).toEqual(
      expect.arrayContaining(["collection", "entry_id", "locale"])
    );
  });

  it("flags exactly those three as primaryKey — nothing more, nothing less", () => {
    // What the grader above actually compares against. If a fourth column
    // ever carries `primaryKey: true`, or one of these three loses it, the
    // key assertion silently changes shape — so the flags are graded too.
    expect([...EXPECTED_PRIMARY_KEY].sort()).toEqual([
      "collection",
      "entry_id",
      "locale",
    ]);
  });

  it("declares search_vector as tsvector and not null", () => {
    const column = SEARCH_INDEX_COLUMNS.find(
      (candidate) => candidate.name === SEARCH_VECTOR_COLUMN_NAME
    );
    expect(column?.type).toEqual(/tsvector/);
    expect(column?.notNull).toBe(true);
  });

  it("traces every column to a requirement", () => {
    for (const column of SEARCH_INDEX_COLUMNS) {
      expect(column.requirement, column.name).not.toBe("");
    }
  });
});
