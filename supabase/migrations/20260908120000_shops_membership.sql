-- T3-202 — shops, membership, and the shop roster: three tables (`shops`,
-- `shop_members`, `shop_invites`) and four account-only RPCs (`create_shop`,
-- `invite_to_shop`, `accept_shop_invite`, `shop_roster`).
-- refs specs/003-shop-tools (SHP-01, SHP-03, SHP-04),
-- specs/002-montero-garage (SHR-05..09, ACC-02, ACC-03)
--
-- Every table/column/function/argument name comes from `tests/shop/contract.ts`
-- (T3-201 [TEST]). The shop roster reuses 002's `shares` filtered by 003's
-- `is_shop_visible` (T3-102) and shop membership; it does not mint a parallel
-- grant model.
--
-- ## Membership is invite-only, no open join (SHP-01, SHP-03)
--
-- There is no path for an account to add itself to a shop. `authenticated`
-- holds **no direct insert** on `shop_members`; a membership row is written only
-- by the security-definer `accept_shop_invite`, which first proves the caller is
-- the invite's addressee (`auth.email()` = `invitee_email`) — the same
-- "consult the addressee, then write" shape `bind_share_grant` (T3-102) uses.
-- Possession of an invite id alone is not sufficient.
--
-- ## `security definer`, like every routine that touches user rows under RLS
--
-- All three tables are `force row level security`, so the definer RPCs run as
-- their owner and RLS is not consulted for the writes they mediate; whatever the
-- body checks is the whole of the access control. Each pins `set search_path =
-- ''` so no unqualified name resolves through a caller's search path (the 002
-- hygiene rule), is revoked from `anon`/`public`, and is granted only to
-- `authenticated` — §1: "the accountless path is read-only because it has no
-- auth.uid()", and an account is what makes a mechanic addressable by a shop.

-- ---------------------------------------------------------------------------
-- shops (SHP-01) — a named business with one or more member accounts
-- ---------------------------------------------------------------------------
-- A shop is a shared entity, not a single-owner row: it has one or more members
-- and outlives any one of them. `created_by` records who opened it, and is
-- `on delete set null` — a founder deleting their own account (002 ACC-03, never
-- gated) must not cascade-delete a shop other members still belong to.

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

alter table public.shops enable row level security;
alter table public.shops force row level security;

comment on table public.shops is
  'SHP-01: a named business with one or more member accounts. Shared, not single-owner: it outlives any one member, so created_by is on delete set null.';

-- ---------------------------------------------------------------------------
-- shop_members (SHP-01) — the join table; its write path is the "no open join"
-- ---------------------------------------------------------------------------
-- One row = one live membership. A row is created only by `accept_shop_invite`;
-- `authenticated` holds no direct insert here (see the grants block), which is
-- the affirmative way to state "there is no path for an account to add itself".
-- `account_id` cascades on account deletion (ACC-03: a deleted account's data
-- goes — a membership is the account's), and `shop_id` cascades on shop
-- deletion. The unique pair makes accepting an invite idempotent.

create table public.shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  account_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  unique (shop_id, account_id)
);

create index shop_members_account_id_idx on public.shop_members (account_id);
create index shop_members_shop_id_idx on public.shop_members (shop_id);

alter table public.shop_members enable row level security;
alter table public.shop_members force row level security;

comment on table public.shop_members is
  'SHP-01: one row per live membership. Written only by accept_shop_invite (a definer RPC); authenticated holds no direct insert — the structural floor under "no open join".';

-- ---------------------------------------------------------------------------
-- shop_invites (SHP-01) — an outstanding invitation, addressed by email
-- ---------------------------------------------------------------------------
-- Issued by an existing member (`invite_to_shop`), addressed to an email.
-- Membership comes only from accepting one of these. `invited_by` is
-- `on delete set null` (the inviter may later delete their account without
-- erasing the invite's audit trail); `accepted_at` records single use.

create table public.shop_invites (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  invitee_email text not null,
  invited_by uuid references auth.users on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index shop_invites_shop_id_idx on public.shop_invites (shop_id);

alter table public.shop_invites enable row level security;
alter table public.shop_invites force row level security;

comment on table public.shop_invites is
  'SHP-01: an outstanding invitation addressed to an email by an existing member. Membership comes only from accepting one, gated on auth.email() = invitee_email.';

-- ---------------------------------------------------------------------------
-- Grants — deny by default, then the minimum each role needs
-- ---------------------------------------------------------------------------
-- Supabase grants broad privileges on `public` to anon/authenticated before any
-- migration runs, so a grant *adds* to an inherited ACL rather than replacing
-- it. Every table is emptied for all three roles first, then `authenticated` is
-- given SELECT only (to read its own memberships / its shops / its shops'
-- invites through the owner/member-scoped policies below). No role holds a
-- direct INSERT/UPDATE/DELETE on any of these tables: every write is a
-- definer RPC. In particular `authenticated` holds no INSERT on shop_members —
-- SHP-01's "no open join", stated as an ACL fact.

revoke all on public.shops from anon, authenticated, public;
revoke all on public.shop_members from anon, authenticated, public;
revoke all on public.shop_invites from anon, authenticated, public;

grant select on public.shops to authenticated;
grant select on public.shop_members to authenticated;
grant select on public.shop_invites to authenticated;

-- ---------------------------------------------------------------------------
-- Policies — owner/member-scoped SELECT (no anon), everything else definer-only
-- ---------------------------------------------------------------------------
-- shop_members is scoped to the caller's own rows (a direct auth.uid() equality,
-- no subquery — and no recursion into shop_members from its own policy). shops
-- and shop_invites correlate through shop_members back to the row under test, so
-- a member sees exactly their shops and those shops' invites, and nobody else's.

create policy "members read their own membership rows"
  on public.shop_members
  for select
  to authenticated
  using (account_id = (select auth.uid()));

create policy "members read the shops they belong to"
  on public.shops
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.shop_members m
       where m.shop_id = shops.id
         and m.account_id = (select auth.uid())
    )
  );

create policy "members read their shops' invites"
  on public.shop_invites
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.shop_members m
       where m.shop_id = shop_invites.shop_id
         and m.account_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- create_shop (SHP-01) — the caller becomes the first member
-- ---------------------------------------------------------------------------

create function public.create_shop(p_name text)
returns table (shop_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_shop uuid;
begin
  if v_uid is null then
    raise insufficient_privilege using message = 'shop creation refused';
  end if;

  insert into public.shops (name, created_by)
  values (nullif(btrim(p_name), ''), v_uid)
  returning id into v_shop;

  -- The creator is the shop's first member — the one account that can then
  -- invite the rest.
  insert into public.shop_members (shop_id, account_id)
  values (v_shop, v_uid);

  shop_id := v_shop;
  return next;
end;
$$;

revoke all on function public.create_shop(text) from public;
revoke all on function public.create_shop(text) from anon;
grant execute on function public.create_shop(text) to authenticated;

comment on function public.create_shop(text) is
  'SHP-01: creates a shop and makes the caller its first member. Returns {shop_id}.';

-- ---------------------------------------------------------------------------
-- invite_to_shop (SHP-01) — restricted to an existing member of the shop
-- ---------------------------------------------------------------------------
-- The body consults shop_members to prove the inviter belongs to the shop
-- (SHP-01: "invitation from an existing member"). An invite that never checked
-- this would be a second open-join route wearing the invite path's clothes.

create function public.invite_to_shop(p_shop_id uuid, p_invitee_email text)
returns table (invite_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite uuid;
begin
  if v_uid is null then
    raise insufficient_privilege using message = 'invite refused';
  end if;

  if not exists (
    select 1
      from public.shop_members m
     where m.shop_id = p_shop_id
       and m.account_id = v_uid
  ) then
    raise insufficient_privilege using message = 'invite refused';
  end if;

  insert into public.shop_invites (shop_id, invitee_email, invited_by)
  values (p_shop_id, lower(nullif(btrim(p_invitee_email), '')), v_uid)
  returning id into v_invite;

  invite_id := v_invite;
  return next;
end;
$$;

revoke all on function public.invite_to_shop(uuid, text) from public;
revoke all on function public.invite_to_shop(uuid, text) from anon;
grant execute on function public.invite_to_shop(uuid, text) to authenticated;

comment on function public.invite_to_shop(uuid, text) is
  'SHP-01: invites an email into a shop; restricted to an existing member. Returns {invite_id}.';

-- ---------------------------------------------------------------------------
-- accept_shop_invite (SHP-01) — the one write path into shop_members
-- ---------------------------------------------------------------------------
-- Reads the invite and gates on the caller being its addressee before writing
-- the membership: a single UPDATE marks the invite accepted only when it is
-- unaccepted and `auth.email()` matches `invitee_email` (case-folded, the
-- bind_share_grant idiom), and only then is the shop_members row written.
--  - a non-addressee matches no row and is refused — possession of the id is
--    not enough;
--  - an already-accepted invite matches no row, so it is single-use;
--  - the membership insert is idempotent on (shop_id, account_id).

create function public.accept_shop_invite(p_invite_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := (select auth.email());
  v_shop uuid;
begin
  if v_uid is null or v_email is null then
    raise insufficient_privilege using message = 'invite acceptance refused';
  end if;

  update public.shop_invites i
     set accepted_at = now()
   where i.id = p_invite_id
     and i.accepted_at is null
     and i.invitee_email is not null
     and lower(i.invitee_email) = lower(v_email)
  returning i.shop_id into v_shop;

  if v_shop is null then
    raise insufficient_privilege using message = 'invite acceptance refused';
  end if;

  insert into public.shop_members (shop_id, account_id)
  values (v_shop, v_uid)
  on conflict (shop_id, account_id) do nothing;

  return true;
end;
$$;

revoke all on function public.accept_shop_invite(uuid) from public;
revoke all on function public.accept_shop_invite(uuid) from anon;
grant execute on function public.accept_shop_invite(uuid) to authenticated;

comment on function public.accept_shop_invite(uuid) is
  'SHP-01: accepts an invite addressed to the caller''s own email, writing the membership. The one write path into shop_members; possession of the invite id alone is not sufficient.';

-- ---------------------------------------------------------------------------
-- shop_roster (SHP-03, SHP-04) — exactly this shop's live shop-visible grants
-- ---------------------------------------------------------------------------
-- The half T3-101 deferred. Gated on the caller's own membership of p_shop_id
-- (auth.uid()), it returns one row per vehicle a *member of this shop* holds a
-- live, shop-visible grant on — and nothing else:
--  - `is_shop_visible = true` excludes individual grants (SHP-04: consent to a
--    business is not implied by consent to a person who works there);
--  - joining `shares.bound_account_id` to a `shop_members` row *of this shop*
--    excludes both individual grants held by non-members and grants held by
--    members of *other* shops ("no others");
--  - `revoked_at is null` and `expires_at > now()` recompute liveness per
--    request, so a revoked or expired grant leaves the roster on the next call.
-- Columns are named one by one (never select *), and the token/hash are not
-- among them: the roster names which trucks the shop holds a live grant on.

create function public.shop_roster(p_shop_id uuid)
returns table (
  vehicle_id uuid,
  share_id uuid,
  bound_account_id uuid,
  display_name text,
  generation_id text,
  market_id text,
  model_year integer,
  engine_id text,
  kind text,
  includes_costs boolean,
  includes_receipts boolean,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise insufficient_privilege using message = 'shop roster unavailable';
  end if;

  -- The caller must be a member of the shop whose roster they ask for.
  if not exists (
    select 1
      from public.shop_members me
     where me.shop_id = p_shop_id
       and me.account_id = v_uid
  ) then
    raise insufficient_privilege using message = 'shop roster unavailable';
  end if;

  return query
    select s.vehicle_id,
           s.id,
           s.bound_account_id,
           v.display_name,
           v.generation_id,
           v.market_id,
           v.model_year,
           v.engine_id,
           s.kind,
           s.includes_costs,
           s.includes_receipts,
           s.expires_at
      from public.shares s
      join public.shop_members holder
        on holder.account_id = s.bound_account_id
       and holder.shop_id = p_shop_id
      join public.vehicles v
        on v.id = s.vehicle_id
     where s.is_shop_visible = true
       and s.revoked_at is null
       and s.expires_at > now()
     order by s.expires_at asc, s.id asc;
end;
$$;

revoke all on function public.shop_roster(uuid) from public;
revoke all on function public.shop_roster(uuid) from anon;
grant execute on function public.shop_roster(uuid) to authenticated;

comment on function public.shop_roster(uuid) is
  'SHP-03/SHP-04: every vehicle a member of p_shop_id holds a live, shop-visible grant on, and no others. Keyed on the caller''s membership; individual grants, non-members'' grants, and other shops'' grants never reach it.';
