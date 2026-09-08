-- T3-102 — the mechanic roster and grant binding: three columns on 002's
-- `shares`, the widened `create_share_grant`, and the three account-only RPCs a
-- mechanic reaches only *as* an account — `bind_share_grant`,
-- `mechanic_roster`, `extend_share_grant`.
-- refs specs/003-shop-tools (MEC-05, MEC-06, SHP-03, SHP-04),
-- specs/002-montero-garage (SHR-05..09, ACC-02, ACC-03)
--
-- Every name and shape here comes from `tests/shop/contract.ts` (T3-101 [TEST])
-- and reuses 002's `tests/garage/contract.ts`: the table is 002's `shares`
-- (three columns added, nothing renamed), the issue path is 002's
-- `create_share_grant` (two defaulted arguments added), the revoke path is
-- 002's `revoke_share_grant` unchanged, and the accountless readers are 002's
-- `share_read_*` unchanged. The genuinely new surface is two ideas 002 does not
-- have: **binding** a grant to the account of the email it was issued to, and a
-- **roster** — the one place MEC-05 gives an authenticated mechanic every
-- vehicle they hold a live grant on.
--
-- ## Why binding is a routine and not a column the owner sets
--
-- The owner issues to an *email* (MEC-06, "a named account"); they never learn
-- the mechanic's account id. Binding is the mechanic proving, by presenting the
-- token *while authenticated as that email*, that they are the addressee. So
-- the check `bind_share_grant` makes — `auth.email()` equals `grantee_email`,
-- and the grant is still unbound — is the whole of "binds to that account and
-- to no other", and it can only be made where `auth.uid()`/`auth.email()`
-- exist: the authenticated path, never the accountless one. That is also why
-- these three routines are revoked from `anon`/`public` and granted only to
-- `authenticated` — §1: "the accountless path is read-only because it has no
-- auth.uid()", and an account is what makes a mechanic addressable.
--
-- ## `security definer`, like every other routine that touches `shares`
--
-- `shares` is `force row level security` and its only policy is owner-scoped, so
-- a mechanic — who is not the owner — cannot read or write the owner's grant row
-- under RLS. The 002 readers already resolve this the same way: a definer
-- routine runs as its owner, RLS on the tables it reads is not consulted, and
-- whatever the body checks is the entire access control. Binding writes the
-- owner's row on the mechanic's behalf; the roster reads the owner's rows the
-- mechanic is bound to; both must therefore be definer, and both pin
-- `set search_path = ''` so no unqualified name resolves through a caller's
-- search path (the 002 hygiene rule, `definerSearchPathIssues`).

-- ---------------------------------------------------------------------------
-- The three columns (MEC-06, SHP-04, ACC-03)
-- ---------------------------------------------------------------------------
-- `grantee_email` is the addressee — the "named account" of MEC-06. Nullable,
-- because a plain 002 bearer link has no addressee: it stays an accountless
-- link forever, which is exactly what makes it forever unbindable and so
-- forever off every roster (an unbound grant is on nobody's roster, by
-- construction).
--
-- `bound_account_id` is the single fact that puts a grant on a roster, and
-- whose absence keeps it off one. It references `auth.users` — a binding is to a
-- real account or it is nothing — and it is **`on delete set null`**, settled by
-- T3-101a: ACC-03 forbids gating account deletion, and 003's premise is that a
-- mechanic is an ordinary account, so a mechanic must be able to delete their
-- account *while holding a live binding*. `set null` **unbinds** the grant (the
-- owner keeps their row; it returns to unbound). `cascade` would delete the
-- *owner's* grant row because the *mechanic* left — data loss for the wrong
-- party — and `restrict`/`no action` would block the mechanic's own deletion,
-- the very gating ACC-03 forbids. `bound_account_id` is deliberately **not** on
-- the `vehicle_id -> owner_id` ownership path 002's cascade grader walks: a
-- grant belongs to the vehicle's owner, not to the mechanic it was lent to.
--
-- `is_shop_visible` records the SHP-04 choice at issue time. `not null default
-- false` — individual by default — in the same private-by-default posture SHR-01
-- gives every other visibility flag: "Consent to share with a business is not
-- implied by consent to share with a person who works there." The owner is told
-- at issue time that a grant to a shop member is shop-visible and may choose the
-- individual instead (T3-202's consent prompt); the data layer's job is only to
-- record the choice and default it to the conservative one. The **shop** roster
-- that consumes this flag is T3-201/T3-202's; this migration ships the flag's
-- schema and the account-isolation floor beneath SHP-04 (an individual grant
-- reaches only the bound account's roster).

alter table public.shares
  add column grantee_email text;

alter table public.shares
  add column bound_account_id uuid references auth.users on delete set null;

alter table public.shares
  add column is_shop_visible boolean not null default false;

create index shares_bound_account_id_idx on public.shares (bound_account_id);

comment on column public.shares.grantee_email is
  'MEC-06: the email a grant is issued to — the "named account". Nullable: a plain 002 bearer link has no addressee and so can never bind, staying an accountless link forever.';
comment on column public.shares.bound_account_id is
  'MEC-05/MEC-06: the account a grant bound to on first authenticated open; null means unbound. references auth.users on delete set null (T3-101a, ACC-03) — a mechanic deleting their own account unbinds the grant, never deletes the owner''s row and never is blocked.';
comment on column public.shares.is_shop_visible is
  'SHP-04: visible to the bearer''s shop (true) or the individual only (false). Default false — individual, private by default. The shop roster that unions this flag is T3-201/T3-202.';

-- ---------------------------------------------------------------------------
-- create_share_grant, widened (MEC-06, SHP-04) — dropped and recreated
-- ---------------------------------------------------------------------------
-- Two defaulted arguments are added so the 002 5-argument anonymous-link call
-- still resolves unchanged. Adding arguments changes the routine's *identity*
-- (`schema.name(argtypes)`), so a bare `create or replace` would leave a
-- **second** `create_share_grant` overload — and both 002's "ships exactly one"
-- grader and 003's issue-argument grader assert exactly one routine. So the old
-- 5-argument signature is dropped and the widened one created; `drop` takes the
-- ACL with it, so the grants are restated below.
--
-- Everything else is 002's routine unchanged: authenticated only (issuing is the
-- owner's write), the 256-bit token returned once beside the id, the sha256
-- digest stored, the ownership check, and the expiry ceiling that keeps a direct
-- call from minting a ten-year "expiring" grant. The two new columns are written
-- from the two new arguments and default to the conservative values.

drop function public.create_share_grant(uuid, text, boolean, boolean, integer);

create function public.create_share_grant(
  p_vehicle_id uuid,
  p_kind text,
  p_includes_costs boolean,
  p_includes_receipts boolean,
  p_expires_in_hours integer,
  p_grantee_email text default null,
  p_is_shop_visible boolean default false
)
returns table (share_id uuid, token text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_secret text;
  v_hours integer := coalesce(p_expires_in_hours, 24);
  -- 90 days, in hours. The longest lifetime `SHARE_EXPIRY_DAY_CHOICES` in
  -- `src/lib/supabase/shares.ts` offers, restated here because this routine is
  -- reachable without that form.
  v_max_hours constant integer := 90 * 24;
begin
  if v_owner is null then
    raise insufficient_privilege using message = 'share grant refused';
  end if;

  -- Same refusal as every other rejection in this routine: an owner who asked
  -- for ten years is told no, not told which of the checks said so.
  if v_hours > v_max_hours then
    raise insufficient_privilege using message = 'share grant refused';
  end if;

  if not exists (
    select 1
      from public.vehicles v
     where v.id = p_vehicle_id
       and v.owner_id = v_owner
  ) then
    raise insufficient_privilege using message = 'share grant refused';
  end if;

  -- 256 bits, hex so it survives a URL fragment with no escaping. The row
  -- stores only the digest; this local is the only place the secret exists
  -- server-side, and it exists for the length of this statement.
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.shares (
    vehicle_id,
    token_hash,
    kind,
    includes_costs,
    includes_receipts,
    expires_at,
    grantee_email,
    is_shop_visible
  )
  values (
    p_vehicle_id,
    extensions.digest(v_secret, 'sha256'),
    p_kind,
    coalesce(p_includes_costs, false),
    coalesce(p_includes_receipts, false),
    now() + make_interval(hours => v_hours),
    -- An empty address is no address: a grant issued to '' can never bind (no
    -- one authenticates as the empty email), so store null rather than a value
    -- that reads like an addressee and is not one.
    nullif(btrim(p_grantee_email), ''),
    coalesce(p_is_shop_visible, false)
  )
  returning id into share_id;

  token := v_secret;
  return next;
end;
$$;

revoke all on function public.create_share_grant(uuid, text, boolean, boolean, integer, text, boolean) from public;
revoke all on function public.create_share_grant(uuid, text, boolean, boolean, integer, text, boolean) from anon;
grant execute on function public.create_share_grant(uuid, text, boolean, boolean, integer, text, boolean) to authenticated;

comment on function public.create_share_grant(uuid, text, boolean, boolean, integer, text, boolean) is
  'SHR-05/MEC-06/SHP-04: issues one typed grant on one vehicle the caller owns, optionally addressed to an email and carrying a shop-visibility choice. Returns {share_id, token}; the token is never stored and never returned again.';

-- ---------------------------------------------------------------------------
-- bind_share_grant (MEC-06) — first authenticated open binds, and only for
-- the addressee
-- ---------------------------------------------------------------------------
-- The load-bearing security property. A single atomic UPDATE is the whole check:
-- it binds the grant to the caller's account only when the grant is live, still
-- unbound, and was issued to the caller's own email. The WHERE clause **reads
-- grantee_email**; the SET **writes bound_account_id** — the addressee is
-- consulted before the binding is written.
--
--  - a matching email binds (the caller is the addressee);
--  - a mismatched email matches no row and is refused — it lands on no roster;
--  - an already-bound grant (`bound_account_id is not null`) matches no row, so
--    the *first* authenticated open binds and no later opener can re-bind it,
--    and the addressee keeps it;
--  - the lookup is by `token_hash = digest(token)`, never against a plaintext
--    column — a database leak is not a grant leak (002's token-hash rule,
--    reused unchanged).
--
-- Email comparison is case-folded on both sides: an email address is not
-- case-sensitive in its local part in practice, and an owner who typed
-- `Mecanico@…` must not lock out a mechanic whose account is `mecanico@…`.
-- A grant with a null `grantee_email` (a plain bearer link) matches no row here
-- and therefore never binds — property 2 by construction.

create function public.bind_share_grant(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := (select auth.email());
begin
  if v_uid is null or v_email is null then
    raise insufficient_privilege using message = 'share binding refused';
  end if;

  update public.shares s
     set bound_account_id = v_uid
   where s.token_hash = extensions.digest(p_token, 'sha256')
     and s.revoked_at is null
     and s.expires_at > now()
     and s.bound_account_id is null
     and s.grantee_email is not null
     and lower(s.grantee_email) = lower(v_email);

  -- Unknown token, expired, revoked, already bound, or issued to someone else:
  -- one refusal, so the surface is not an oracle about which it was.
  if not found then
    raise insufficient_privilege using message = 'share binding refused';
  end if;

  return true;
end;
$$;

revoke all on function public.bind_share_grant(text) from public;
revoke all on function public.bind_share_grant(text) from anon;
grant execute on function public.bind_share_grant(text) to authenticated;

comment on function public.bind_share_grant(text) is
  'MEC-06: binds a named grant to the caller''s account on first authenticated open, only when auth.email() equals the grant''s grantee_email and the grant is live and unbound. Idempotent-safe: an already-bound grant is refused, so no later opener can re-bind it.';

-- ---------------------------------------------------------------------------
-- mechanic_roster (MEC-05) — one place, keyed to the caller
-- ---------------------------------------------------------------------------
-- MEC-05: "show every vehicle on their roster in one place." Takes **no
-- argument** — it keys entirely on `auth.uid()`, which is what makes "someone
-- else's roster" unrepresentable rather than merely forbidden (the same shape
-- ACC-03's `request_account_deletion()` uses).
--
-- One row per vehicle the caller holds a **live** grant on, bound to their
-- account: `bound_account_id = auth.uid()`, `revoked_at is null`, `expires_at >
-- now()`. The liveness filter is why a revoked or expired grant leaves the
-- roster on the **next** request — the roster is computed per request, never a
-- membership cached at bind time. The roster is audience-agnostic: it does not
-- consult `is_shop_visible` at all, so an individual grant and a shop-visible
-- grant both reach only the account they are bound to (the shop roster that
-- unions `is_shop_visible` grants is T3-201's).
--
-- The columns are named one by one (never `select *` / `to_jsonb(v)`), so a
-- column the vehicle gains later is not served here without a diff. The token
-- and its hash are not among them: the roster tells a mechanic *which* trucks
-- they hold a live grant on; the link they already hold is what opens each one.

create function public.mechanic_roster()
returns table (
  vehicle_id uuid,
  share_id uuid,
  display_name text,
  generation_id text,
  market_id text,
  model_year integer,
  engine_id text,
  kind text,
  includes_costs boolean,
  includes_receipts boolean,
  is_shop_visible boolean,
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
    raise insufficient_privilege using message = 'roster unavailable';
  end if;

  return query
    select s.vehicle_id,
           s.id,
           v.display_name,
           v.generation_id,
           v.market_id,
           v.model_year,
           v.engine_id,
           s.kind,
           s.includes_costs,
           s.includes_receipts,
           s.is_shop_visible,
           s.expires_at
      from public.shares s
      join public.vehicles v on v.id = s.vehicle_id
     where s.bound_account_id = v_uid
       and s.revoked_at is null
       and s.expires_at > now()
     order by s.expires_at asc, s.id asc;
end;
$$;

revoke all on function public.mechanic_roster() from public;
revoke all on function public.mechanic_roster() from anon;
grant execute on function public.mechanic_roster() to authenticated;

comment on function public.mechanic_roster() is
  'MEC-05: every vehicle the caller holds a live, bound grant on, in one place. Keyed on auth.uid(); an unbound grant is on nobody''s roster, and a revoked or expired grant leaves it on the next request.';

-- ---------------------------------------------------------------------------
-- extend_share_grant (MEC-06) — extend to "until revoked", per grant
-- ---------------------------------------------------------------------------
-- The companion to 002's `revoke_share_grant`, and the two controls MEC-06 says
-- live "in the same place". Per grant, by id, exactly like revoke: an owner
-- extends *this* link without touching the buyer's link on the same truck.
--
-- "Until revoked" is a **far expiry**, not a null: 002's contract records that
-- `expires_at` is `not null` and that "until revoked" is a far date. So this
-- pushes `expires_at` far out; the grant stays live and stays on the roster
-- until the owner revokes it. It does **not** clear `revoked_at`: a revoked
-- grant is the owner's decision and stays dead — extending is about lifetime,
-- revoking is final.
--
-- Gated on ownership and on **nothing else** (MEC-06 defers to SHR-08 /
-- MON-02): no subscription, no plan, no quota. A grant the caller does not own
-- matches no row and this raises rather than answering success for an extension
-- that extended nothing — the same refusal shape `revoke_share_grant` uses.

create function public.extend_share_grant(p_share_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  -- A century out. Far enough that "until revoked" means what it says, and
  -- still a real timestamp so every reader's `expires_at > now()` check keeps
  -- working unchanged (SHR-08: not a null).
  v_until constant timestamptz := now() + interval '100 years';
begin
  if v_owner is null then
    raise insufficient_privilege using message = 'share extension refused';
  end if;

  update public.shares s
     set expires_at = v_until
   where s.id = p_share_id
     and s.revoked_at is null
     and exists (
       select 1
         from public.vehicles v
        where v.id = s.vehicle_id
          and v.owner_id = v_owner
     );

  if not found then
    raise insufficient_privilege using message = 'share extension refused';
  end if;

  return true;
end;
$$;

revoke all on function public.extend_share_grant(uuid) from public;
revoke all on function public.extend_share_grant(uuid) from anon;
grant execute on function public.extend_share_grant(uuid) to authenticated;

comment on function public.extend_share_grant(uuid) is
  'MEC-06: extends one grant, by id, to "until revoked" (a far expiry, never a null) for its issuer. Gated on ownership and on nothing else. Does not resurrect a revoked grant.';
