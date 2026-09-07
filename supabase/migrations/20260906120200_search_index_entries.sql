-- T802 — the git→Supabase read-model: `search_index_entries` (RM-01, RM-02).
-- refs specs/001-foundation (RM-01, RM-02, SRCH-01, SRCH-02)
--
-- > **RM-01** WHEN content merges to `main`, CI SHALL sync the built content
-- > into Supabase (typed tables, `tsvector` columns with `english` and
-- > `spanish` dictionaries). The sync SHALL be idempotent and one-directional
-- > (git → DB, never back).
-- > **RM-02** THE Supabase read-model SHALL never be written by any process
-- > other than the CI sync job.
--
-- Every table/column name and every closed-set value here comes from
-- `tests/sync/contract.ts` (T801 [TEST]), which is the naming authority the
-- same way `tests/garage/contract.ts` is for the user-data schema — see that
-- file's own docstring for why the names live there and not invented here.
--
-- ## This table is public reference content, not private user data
--
-- Every other migration in this directory (`20260830120000_garage_schema.sql`
-- onward) denies `select` to `anon` by default, because it holds one owner's
-- vehicles, receipts and shares. This table holds the opposite kind of
-- thing — the same glossary/problems/parts/mods content this site already
-- renders into public HTML — so `select` is granted to `anon` and
-- `authenticated` deliberately (`tests/sync/contract.ts`'s
-- `SEARCH_INDEX_WRITE_VERBS` grades only `insert`/`update`/`delete`, on
-- purpose). What RM-02 actually forbids is a **write** reaching any role but
-- the CI sync job, which authenticates as `service_role` — so only the write
-- verbs are revoked from everyone else, and RLS is still enabled and forced
-- (the same "deny by default, including for a table nobody has written yet"
-- discipline `20260830120000_garage_schema.sql` documents) with exactly one
-- policy: a public, unconditional `select`.
--
-- ## The primary key IS the idempotent upsert's conflict target
--
-- `(collection, entry_id, locale)` — one row per entry per locale (RM-01 read
-- as "columns, plural, using both dictionaries across the table", not "every
-- row carries two `tsvector` columns" — `tests/sync/contract.ts`'s
-- `SEARCH_VECTOR_LOCALE_CONFIG` docstring works through why). The sync script
-- (`scripts/sync-reference-search.mjs`) issues
-- `insert … on conflict (collection, entry_id, locale) do update`, so this
-- constraint is not decorative — a table with a surrogate `id` key and these
-- three as ordinary columns would turn every re-sync into duplicate rows
-- instead of updates.
--
-- ## `search_vector` is a generated column, not trigger-maintained
--
-- Either shape is graded (`tests/sync/schema-shape.test.ts`'s
-- `searchVectorLocaleIssues` recognises both the `case … when` and the
-- `if/elsif` trigger-function shapes) — `generated always as (…) stored` is
-- chosen here because the value is a pure function of five other columns on
-- the same row and Postgres computing it on write, once, is simpler than a
-- `before insert or update` trigger doing the same arithmetic by hand.
--
-- `to_tsvector`'s dictionary argument branches on `locale` — `'english'` only
-- where `locale = 'en'`, `'spanish'` only where `locale = 'es'` — RM-01's
-- literal requirement. The concatenated document is every text-bearing
-- column: `title`/`subtitle`/`snippet` (SRCH-01's "titles" and "symptoms")
-- plus `badges`/`codes`/`extra` flattened to space-joined text (SRCH-01's
-- "part numbers", SRCH-02's aliases) — the server-side equivalent of
-- `src/lib/search.ts`'s `buildSearchHaystack`, which concatenates the same
-- six fields client-side for the exact same reason (two adjacent fields
-- joined by a space can never fuse into a false substring match).

create table public.search_index_entries (
  collection text not null,
  entry_id text not null,
  locale text not null,
  href text,
  title text not null,
  subtitle text,
  snippet text not null,
  badges text[] not null default '{}',
  codes text[] not null default '{}',
  extra text[] not null default '{}',
  search_vector tsvector generated always as (
    to_tsvector(
      (case locale
         when 'en' then 'english'::regconfig
         when 'es' then 'spanish'::regconfig
       end),
      coalesce(title, '') || ' ' ||
        coalesce(subtitle, '') || ' ' ||
        coalesce(snippet, '') || ' ' ||
        coalesce(array_to_string(badges, ' '), '') || ' ' ||
        coalesce(array_to_string(codes, ' '), '') || ' ' ||
        coalesce(array_to_string(extra, ' '), '')
    )
  ) stored not null,
  constraint search_index_entries_pkey primary key (collection, entry_id, locale),
  constraint search_index_entries_collection_ck
    check (collection in ('glossary', 'problems', 'parts', 'mods')),
  constraint search_index_entries_locale_ck
    check (locale in ('en', 'es'))
);

comment on table public.search_index_entries is
  'RM-01/RM-02: the git-authored read-model the CI sync job (scripts/sync-reference-search.mjs) writes on every merge to main. One row per (collection, entry_id, locale). Never written by anything else.';
comment on column public.search_index_entries.search_vector is
  'RM-01: generated, per-row dictionary keyed on locale — english for en, spanish for es. Indexed below.';

-- ---------------------------------------------------------------------------
-- The GIN index `@@` queries need (RM-01, T803's server-side search endpoint)
-- ---------------------------------------------------------------------------
-- A `tsvector` column with no index still answers `@@` correctly; it does a
-- sequential scan on every request. RM-01 does not say "index", but a
-- production search endpoint querying this column with none is not a serious
-- reading of what the requirement is for (`tests/sync/rules.ts`'s
-- `hasGinIndexOn` docstring says the same).

create index search_index_entries_search_vector_idx
  on public.search_index_entries
  using gin (search_vector);

-- ---------------------------------------------------------------------------
-- Row-level security: enabled AND forced, one public `select` policy
-- ---------------------------------------------------------------------------
-- `enable` alone exempts the table owner, and migrations — and the CI sync
-- job, which connects with the service-role key — run as (or above) the
-- owner; `force` is what keeps that exemption from also covering any future
-- owner-run code path nobody intended to bypass RLS with.

alter table public.search_index_entries enable row level security;
alter table public.search_index_entries force row level security;

create policy "search index entries are public reference data" on public.search_index_entries
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- The revoke is not redundant with the grant that follows: Supabase's default
-- privileges hand `authenticated` ALL on a new table in `public` — TRUNCATE
-- included, which no policy filters — and a `grant` *adds to* whatever ACL a
-- table already carries rather than replacing it
-- (`20260830120000_garage_schema.sql`'s own note on this, T2-202 review F2).
-- Revoke by name first, then name exactly what RM-02 allows: `select` for
-- `anon`/`authenticated` (public reference content), and every verb for
-- `service_role` (the CI sync job's own credential, RM-02's one writer).

revoke all on public.search_index_entries from anon;
revoke all on public.search_index_entries from public;
revoke all on public.search_index_entries from authenticated;

grant select on public.search_index_entries to anon;
grant select on public.search_index_entries to authenticated;

grant select, insert, update, delete on public.search_index_entries to service_role;
