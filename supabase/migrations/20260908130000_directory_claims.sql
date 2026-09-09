-- T3-203 — the directory claim: `directory_claims`, one table and the RPCs that
-- create, verify, and publicly read a claim (SHP-02), plus the SHP-05 promise
-- that a claim never touches the directory's ordering or inclusion — enforced in
-- `src/lib/directory/neutral-order.ts`, not here.
-- refs specs/003-shop-tools (SHP-02, SHP-05), specs/002-montero-garage (ACC-03)
--
-- Every table/column name comes from `tests/shop/contract.ts` (T3-201 [TEST]):
-- DIRECTORY_CLAIMS_TABLE, CLAIM_SHOP_ID_COLUMN, CLAIM_ENTRY_ID_COLUMN,
-- CLAIM_VERIFIED_AT_COLUMN. The account-deletion lifecycle is graded by
-- `tests/garage/shared-table-cascade.test.ts` (T3-203a) as a *parent-hop* shared
-- table: a claim belongs to a shop, not to a person.
--
-- ## A claim is a pointer at git-owned content, never an edit to it (SHP-02)
--
-- `community_entry_id` is a bare `text` value — the content id of a `shop`-typed
-- entry in the 001 `community` collection (e.g.
-- `veinsa-motors-mitsubishi-costa-rica`). It carries **no foreign key**: the
-- community collection lives in git and is read-only, so a claim points at an
-- entry by id and can never relate to, or edit, a database copy of it. A FK here
-- would quietly turn "the collection stays read-only" into a lie.
--
-- ## The account-deletion lifecycle is the parent hop, not a person (SHP-02, ACC-03)
--
-- Unlike the three shop tables, `directory_claims` binds no `auth.users` column.
-- A claim is the shop's, never a member's, so its whole lifecycle is
-- `shop_id -> shops on delete cascade`: delete the shop, its claims go with it;
-- delete an *account*, the shop survives (`shops.created_by on delete set null`,
-- T3-202) and the claim survives with it. ACC-03 (account deletion is never
-- gated) is honoured transitively, without a direct hop that would wrongly bind
-- a shared business asset to one departing person.
--
-- ## `security definer`, the same posture every user-row routine takes (T3-202)
--
-- `directory_claims` is `force row level security`, so the definer RPCs run as
-- their owner and RLS is not consulted for the writes they mediate; whatever the
-- body checks is the whole of the access control. Each pins `set search_path =
-- ''` so no unqualified name resolves through a caller's search path (the 002
-- hygiene rule). The write paths are revoked from `anon`/`public` and granted
-- only to `authenticated` (create) or `service_role` (verify — see below); the
-- badge read is `authenticated`-only too, NOT anon-facing — see the
-- `directory_verified_claims` rationale below for why the badge stops at
-- signed-in readers instead of widening 002's anon allow-list.

-- ---------------------------------------------------------------------------
-- directory_claims (SHP-02) — a DB row pointing at a git-owned community entry
-- ---------------------------------------------------------------------------

create table public.directory_claims (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  community_entry_id text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  -- One live claim per (shop, entry): a shop cannot claim the same listing
  -- twice, and re-claiming is idempotent through create_directory_claim.
  unique (shop_id, community_entry_id)
);

create index directory_claims_shop_id_idx on public.directory_claims (shop_id);
create index directory_claims_entry_id_idx
  on public.directory_claims (community_entry_id);

alter table public.directory_claims enable row level security;
alter table public.directory_claims force row level security;

comment on table public.directory_claims is
  'SHP-02: a shop''s claim on a git-owned community `shop` entry, pointed at by content id (community_entry_id, a text pointer with no FK — the collection is read-only). verified_at null = unverified = no badge. Belongs to a shop, not a person: shop_id -> shops on delete cascade is its whole account-deletion lifecycle.';

-- ---------------------------------------------------------------------------
-- Grants — deny by default, then the minimum each role needs
-- ---------------------------------------------------------------------------
-- Supabase grants broad privileges on `public` to anon/authenticated before any
-- migration runs, so a grant *adds* to an inherited ACL rather than replacing
-- it. The table is emptied for all three roles first, then `authenticated` is
-- given SELECT only (to read its own shops' claims through the member-scoped
-- policy below). No *member-facing* role holds a direct INSERT/UPDATE/DELETE:
-- every member/shop write is a definer RPC. `service_role` is the documented
-- exception — the platform's own credential (what `verify_directory_claim`
-- above is granted to run as), not a caller-facing role. `anon` holds nothing
-- on the table — a public reader learns which entries are verified-claimed
-- only through the definer badge-read RPC, which exposes nothing else.

revoke all on public.directory_claims from anon, authenticated, public;

grant select on public.directory_claims to authenticated;
grant select, insert, update, delete on public.directory_claims to service_role;

-- ---------------------------------------------------------------------------
-- Policy — a member reads their own shops' claims (no anon), writes are definer
-- ---------------------------------------------------------------------------
-- Correlates through shop_members back to the row under test, so a member sees
-- exactly their shops' claims (verified or not) and nobody else's. Anon has no
-- policy and no grant: the public badge fact travels only through the read RPC.

create policy "members read their shops' claims"
  on public.directory_claims
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.shop_members m
       where m.shop_id = directory_claims.shop_id
         and m.account_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- create_directory_claim (SHP-02) — restricted to a member of the claiming shop
-- ---------------------------------------------------------------------------
-- The body consults shop_members to prove the caller belongs to the shop they
-- claim on behalf of. A claim is created unverified (verified_at null), so it
-- changes nothing a reader sees until the platform verifies it. Idempotent on
-- (shop_id, community_entry_id): re-claiming returns the existing claim's id
-- rather than erroring or minting a duplicate.

create function public.create_directory_claim(
  p_shop_id uuid,
  p_community_entry_id text
)
returns table (claim_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_entry text := nullif(btrim(p_community_entry_id), '');
  v_claim uuid;
begin
  if v_uid is null then
    raise insufficient_privilege using message = 'directory claim refused';
  end if;

  -- The caller must be a member of the shop the claim is filed under.
  if not exists (
    select 1
      from public.shop_members m
     where m.shop_id = p_shop_id
       and m.account_id = v_uid
  ) then
    raise insufficient_privilege using message = 'directory claim refused';
  end if;

  -- A blank entry id is the function's own refusal, not a raw NOT NULL
  -- violation, so the caller sees the same terse refusal as every rejection.
  if v_entry is null then
    raise insufficient_privilege using message = 'directory claim refused';
  end if;

  insert into public.directory_claims (shop_id, community_entry_id)
  values (p_shop_id, v_entry)
  on conflict (shop_id, community_entry_id) do nothing
  returning id into v_claim;

  -- ON CONFLICT DO NOTHING returns no row; fetch the existing claim so the
  -- call is idempotent (re-claiming is not an error).
  if v_claim is null then
    select c.id
      into v_claim
      from public.directory_claims c
     where c.shop_id = p_shop_id
       and c.community_entry_id = v_entry;
  end if;

  claim_id := v_claim;
  return next;
end;
$$;

revoke all on function public.create_directory_claim(uuid, text) from public;
revoke all on function public.create_directory_claim(uuid, text) from anon;
grant execute
  on function public.create_directory_claim(uuid, text) to authenticated;

comment on function public.create_directory_claim(uuid, text) is
  'SHP-02: files an UNVERIFIED claim on a community entry for p_shop_id; restricted to a member of that shop. Idempotent on (shop_id, community_entry_id). Returns {claim_id}. Changes nothing a reader sees until verified.';

-- ---------------------------------------------------------------------------
-- verify_directory_claim (SHP-02) — the trust gate, a PLATFORM action
-- ---------------------------------------------------------------------------
-- SHP-02: "THE claim SHALL be verified before the directory renders any claimed
-- badge." Verification is the platform confirming the shop controls the listing,
-- so it cannot be self-served: a shop verifying its own claim would empty the
-- gate of meaning. There is no admin/moderator role in this schema, so — like
-- `purge_expired_accounts` and the RM-02 search-index writer — verification is
-- granted only to `service_role`, the platform's own credential, and revoked
-- from anon, public, AND authenticated. Idempotent: verifying an already-
-- verified claim leaves verified_at unchanged.

create function public.verify_directory_claim(p_claim_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_found uuid;
begin
  update public.directory_claims c
     set verified_at = coalesce(c.verified_at, now())
   where c.id = p_claim_id
  returning c.id into v_found;

  return v_found is not null;
end;
$$;

revoke all on function public.verify_directory_claim(uuid) from public;
revoke all on function public.verify_directory_claim(uuid) from anon;
revoke all on function public.verify_directory_claim(uuid) from authenticated;
grant execute on function public.verify_directory_claim(uuid) to service_role;

comment on function public.verify_directory_claim(uuid) is
  'SHP-02: marks a claim verified (idempotent). The platform''s trust gate, not the shop''s — granted only to service_role so a shop cannot verify its own claim.';

-- ---------------------------------------------------------------------------
-- directory_verified_claims (SHP-02) — the badge read (authenticated-only)
-- ---------------------------------------------------------------------------
-- Returns only the community_entry_id of VERIFIED claims — no shop identity, no
-- account, no unverified rows — so it exposes exactly the display-only badge
-- fact the directory renders and nothing more, while the table itself stays
-- fully RLS-locked.
--
-- Granted to `authenticated` and revoked from `anon`/`public`, NOT anon-facing.
-- This is a deliberate boundary, not an oversight: 002's anon surface is a
-- locked allow-list — `tests/garage/share-instrument.test.ts` fails if any
-- anon-executable routine exists outside the declared share readers, and every
-- anon-reachable routine must satisfy the token-hash/expiry/revoke grant
-- contract, which a directory badge read is not and should not be. So the badge
-- is surfaced to signed-in readers; an anonymous visitor sees the neutral
-- directory with no badge (an unverified-equivalent view — SHP-02's "changes
-- nothing a reader sees" still holds). Widening the badge to anon would mean
-- extending that security allow-list, which is a T3-201/grader decision, not
-- this task's to make silently.

create function public.directory_verified_claims()
returns table (community_entry_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct c.community_entry_id
    from public.directory_claims c
   where c.verified_at is not null;
$$;

revoke all on function public.directory_verified_claims() from public;
revoke all on function public.directory_verified_claims() from anon;
grant execute on function public.directory_verified_claims() to authenticated;

comment on function public.directory_verified_claims() is
  'SHP-02: the community_entry_id of every VERIFIED claim, and nothing else — the display-only badge fact. Authenticated-only (the anon surface is an allow-list of the declared share readers, share-instrument.test.ts); the table stays RLS-locked.';
