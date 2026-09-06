-- T2-202 — the user-data schema: profiles, vehicles, records, receipts.
-- refs specs/002-montero-garage (ACC-01, ACC-03, GAR-01', GAR-02', GAR-05',
-- SHR-01, SHR-03, MIG-03)
--
-- Every table and column name here comes from tests/garage/contract.ts, which
-- is the naming authority: T2-201 made those choices on the spec's behalf so a
-- rename is a one-file change rather than a nine-file argument.
--
-- Two invariants this file exists to make structural rather than habitual:
--
--   * RLS is ENABLED and FORCED on all four tables. `enable` alone exempts the
--     table owner, and migrations run as the owner, so a table that is only
--     enabled is wide open to anything holding that connection.
--   * Everything a user stores defaults to private (SHR-01). That is a column
--     default, not a form default: a row inserted by a script, an import job or
--     a curl someone found on a forum is private too.

-- ---------------------------------------------------------------------------
-- Deny by default, including for tables nobody has written yet
-- ---------------------------------------------------------------------------
-- RLS filters rows; GRANT decides whether a role may reach the table at all,
-- and **RLS does not filter TRUNCATE** — a role holding that privilege empties
-- the table without a single policy being consulted.
--
-- The first version of this block revoked from `anon` and `public` and said the
-- four tables therefore start with no grants. That was false in the running
-- database (T2-202 review, F2): Supabase's own default privileges hand
-- `authenticated` ALL on new tables in `public`, and an explicit
-- `grant select, insert, update, delete` **adds to** that ACL rather than
-- replacing it. `authenticated` kept TRUNCATE, and the reviewer emptied
-- `profiles` as that role against the shipped schema.
--
-- So `authenticated` is revoked here too, and again by name on each table
-- below. The declaration tier cannot catch this class on its own — it reads
-- migration text, and a privilege nobody granted appears nowhere in it.

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on tables from authenticated;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges in schema public revoke all on sequences from authenticated;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on functions from public;

-- ---------------------------------------------------------------------------
-- profiles (ACC-01, ACC-03)
-- ---------------------------------------------------------------------------
-- A user needs a row of their own that is not `auth.users`, which no client may
-- read. `deleted_at` is where ACC-03's 30-day recovery window lives: "delete"
-- marks, it does not drop, until the window closes.

-- `handle` (SHR-02) is declared here and given its rules in
-- `20260903120100_public_handles.sql`, which also adds it by `alter table` for
-- databases that already ran this file. Both paths end identically; the reason
-- the column is named in *this* statement as well is that a column added only
-- by an `alter` is invisible to `createTableBody` in `tests/garage/sql.ts`, and
-- the contract's shape graders read a `create table` body and nothing else.
-- Nullable on purpose: a user who has never published anything needs no public
-- identity, and forcing one at signup would make every account permanently
-- addressable in a namespace SHR-01 says is private by default.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  deleted_at timestamptz,
  handle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per account (ACC-01). deleted_at opens ACC-03''s 30-day window.';

-- ---------------------------------------------------------------------------
-- vehicles (GAR-01')
-- ---------------------------------------------------------------------------
-- Taxonomy identity is four separate columns, not one denormalised "spec"
-- string: the 001 fitment engine answers "does entry E apply to vehicle V"
-- against generation/market/year/engine, and a joined string cannot be asked
-- that question. The ids resolve against 001's `vehicles` collection, which
-- lives in git — so there is no foreign key to point at, and a check
-- constraint enumerating them here would be the same taxonomy stored twice.

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  display_name text not null,
  generation_id text not null,
  market_id text,
  model_year int,
  engine_id text,
  odometer_km int,
  photo_paths text[] not null default '{}',
  is_showcase_public boolean not null default false,
  is_worklog_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_display_name_ck check (length(btrim(display_name)) > 0),
  constraint vehicles_generation_id_ck check (length(btrim(generation_id)) > 0),
  constraint vehicles_model_year_ck
    check (model_year is null or model_year between 1982 and 2100),
  constraint vehicles_odometer_km_ck
    check (odometer_km is null or odometer_km >= 0)
);

create index vehicles_owner_id_idx on public.vehicles (owner_id);

comment on column public.vehicles.is_showcase_public is
  'SHR-01/SHR-02: off by default. Publishing is a decision, never a default.';
comment on column public.vehicles.is_worklog_public is
  'SHR-01/SHR-02: off by default, and independent of the showcase page.';

-- ---------------------------------------------------------------------------
-- records (GAR-02')
-- ---------------------------------------------------------------------------
-- `kind` is a closed set because GAR-02' names four values and only four. Free
-- text here means GAR-03's derived views are computed off strings nobody
-- validates, and "plan" vs "planned" silently empties a page.
--
-- Cost, time, odometer and the reference arrays are optional, and optional has
-- two correct spellings. Nullable for the scalars: `cost_amount numeric not
-- null default 0` is not an empty cost, it is a claim that the job was free.
-- `not null default '{}'` for the arrays, where an empty array genuinely *is*
-- the absence of references and removes the null-versus-empty ambiguity every
-- consumer would otherwise have to handle.

create type public.record_kind as enum ('work', 'receipt', 'note', 'plan');

create table public.records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles on delete cascade,
  occurred_on date not null,
  kind public.record_kind not null,
  title text,
  body text,
  cost_amount numeric,
  cost_currency text,
  time_minutes int,
  odometer_km int,
  problem_ids text[] not null default '{}',
  part_ids text[] not null default '{}',
  procedure_ids text[] not null default '{}',
  is_public boolean not null default false,
  is_cost_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint records_cost_amount_ck
    check (cost_amount is null or cost_amount >= 0),
  constraint records_cost_currency_ck
    check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  constraint records_time_minutes_ck
    check (time_minutes is null or time_minutes >= 0),
  constraint records_odometer_km_ck
    check (odometer_km is null or odometer_km >= 0),
  constraint records_cost_pair_ck
    check (cost_amount is null or cost_currency is not null)
);

create index records_vehicle_id_idx on public.records (vehicle_id);
create index records_occurred_on_idx on public.records (vehicle_id, occurred_on);

comment on column public.records.is_cost_public is
  'SHR-03: publishing a work-log entry must not publish what it cost.';

-- ---------------------------------------------------------------------------
-- receipts (GAR-05')
-- ---------------------------------------------------------------------------
-- The row carries the metadata; the bytes live in the private `receipts`
-- bucket, keyed by `storage_path` (see the storage migration). A receipt is the
-- most personal object this site will ever hold.

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records on delete cascade,
  storage_path text not null,
  vendor text,
  issued_on date,
  amount numeric,
  currency text,
  created_at timestamptz not null default now(),
  constraint receipts_storage_path_ck
    check (length(btrim(storage_path)) > 0),
  constraint receipts_amount_ck check (amount is null or amount >= 0),
  constraint receipts_currency_ck
    check (currency is null or currency ~ '^[A-Z]{3}$')
);

create index receipts_record_id_idx on public.receipts (record_id);

-- ---------------------------------------------------------------------------
-- Row-level security: enabled AND forced
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.vehicles enable row level security;
alter table public.vehicles force row level security;
alter table public.records enable row level security;
alter table public.records force row level security;
alter table public.receipts enable row level security;
alter table public.receipts force row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Every policy is granted to `authenticated` and to nobody else, and every one
-- is owner-scoped in BOTH halves. `using` decides what you can see; `with
-- check` decides what you can write, and a correct `with check` says nothing
-- about a wide-open `using`.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` is Supabase's own
-- recommendation: the scalar subquery lets Postgres hoist the call out of the
-- per-row loop.
--
-- For `records` and `receipts` the ownership claim lives in a subquery, and a
-- subquery only speaks about *this* row if it joins back to it — without
-- `v.id = records.vehicle_id`, `exists (select 1 from vehicles where owner_id =
-- auth.uid())` means "own any truck, read everyone's records".

create policy "profiles owner all" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "vehicles owner all" on public.vehicles
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "records owner all" on public.records
  for all to authenticated
  using (
    exists (
      select 1
        from public.vehicles v
       where v.id = records.vehicle_id
         and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.vehicles v
       where v.id = records.vehicle_id
         and v.owner_id = (select auth.uid())
    )
  );

create policy "receipts owner all" on public.receipts
  for all to authenticated
  using (
    exists (
      select 1
        from public.records r
        join public.vehicles v on v.id = r.vehicle_id
       where r.id = receipts.record_id
         and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.records r
        join public.vehicles v on v.id = r.vehicle_id
       where r.id = receipts.record_id
         and v.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- `anon` reaches none of these tables at all: not a filtered view, nothing.
-- The revoke is what makes a table that ships before its policies do an outage
-- rather than a leak.
--
-- `authenticated` is revoked and then granted back **exactly four verbs**. The
-- revoke is not redundant with the grant: a grant adds to whatever ACL the
-- table already carries, and Supabase's default privileges give a new table in
-- `public` ALL to `authenticated` — TRUNCATE included, which no policy filters
-- (T2-202 review, F2). Revoke first, then name what is allowed.

revoke all on public.profiles from anon;
revoke all on public.vehicles from anon;
revoke all on public.records from anon;
revoke all on public.receipts from anon;

revoke all on public.profiles from public;
revoke all on public.vehicles from public;
revoke all on public.records from public;
revoke all on public.receipts from public;

revoke all on public.profiles from authenticated;
revoke all on public.vehicles from authenticated;
revoke all on public.records from authenticated;
revoke all on public.receipts from authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.records to authenticated;
grant select, insert, update, delete on public.receipts to authenticated;

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.vehicles to service_role;
grant select, insert, update, delete on public.records to service_role;
grant select, insert, update, delete on public.receipts to service_role;
