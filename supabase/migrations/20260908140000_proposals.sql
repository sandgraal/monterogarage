-- T3-302 — propose-and-accept: the `proposals` table (a mechanic's draft record,
-- inert until the owner accepts it), the `can_propose` capability on 002's
-- `shares`, three provenance columns on 002's `records`, and the one RPC that
-- writes a record — `accept_proposal`.
-- refs specs/003-shop-tools (PRO-01..06, §7.1 the writable-surface carve-out),
-- specs/002-montero-garage (SHR-05..09, ACC-03),
-- AGENTS.md (Facts — testimony; Boundaries — the §7.1 carve-out)
--
-- Every table/column/function/argument name comes from `tests/shop/contract.ts`
-- (T3-301 [TEST]) and reuses 002's vocabulary rather than minting a parallel one:
-- a proposal rides on 002's `shares` grant (one new capability column,
-- `can_propose`), acceptance writes a 002 `records` row (three new provenance
-- columns), and liveness is 002's `revoked_at`/`expires_at` on the same grant.
--
-- ## The shape of the carve-out (§7.1, PRO-01..06) — narrow on purpose
--
-- The only user-to-user writable surface AGENTS.md authorizes: a holder of a
-- live `can_propose` grant may submit a *proposal*, which has no effect until the
-- vehicle's owner accepts it. Acceptance is the owner's own action, and it is the
-- one write into `records`. A proposal is NEVER written into `records` in a
-- pending state — it lives in its own table until acceptance copies it (PRO-03).
--
-- ## Three ordinary policies, no RPC for submit/withdraw/reject (PRO-04, PRO-06)
--
-- `proposals` is a two-principal row: `owner_id` (the vehicle owner, who accepts
-- or rejects) and `proposed_by` (the mechanic, who drafts, reads, and withdraws).
--
--   * the OWNER gets TWO policies, split on purpose (2026-09-09 review, finding
--     #3): a `for select` policy (the owner reads their proposal inbox) and a
--     `for delete` policy (the owner rejects a pending proposal), each keyed to
--     `owner_id = auth.uid()` and NOTHING else — so a pending proposal stays
--     rejectable even after the mechanic's grant is revoked (PRO-06). There is
--     deliberately no owner INSERT/UPDATE path: permissive INSERT policies OR
--     together, so a single owner `for all` whose `with check` tests only
--     `owner_id` would let the owner INSERT a proposal with an arbitrary
--     `proposed_by`, forging a mechanic's authorship (and, on acceptance,
--     fabricating the provenance §7.1 / PRO-05 exist to keep honest). Splitting
--     removes that INSERT path entirely; acceptance is the `accept_proposal`
--     definer RPC, which needs no table-level owner write.
--   * the PROPOSER policy keys the row to `proposed_by = auth.uid()` AND a live
--     `can_propose` grant the mechanic holds on the vehicle, checked via the
--     `security definer` helper `has_live_can_propose_grant` (see below). That
--     conjunct rides on BOTH `using` (SELECT/DELETE) and `with check` (INSERT), so
--     revocation or expiry kills submit AND withdraw on the next request (PRO-06),
--     while the owner's own reject path is untouched. The policy stays `for all`:
--     its INSERT is tied to `proposed_by = auth.uid()`, so the forgery guard does
--     not flag it.
--
-- All three policies pass `rules.ts` unchanged (T3-301's task note):
-- `authUidComparands` tests the *shape* — an `auth.uid()` equality against a row
-- term — not the column name, and a top-level `and` (the live-grant conjunct) is
-- not an `or`, so the predicate stays owner-scoped. Submit is a direct INSERT,
-- withdraw and reject are direct DELETEs, all governed by these policies — no RPC,
-- no `records` write. That is exactly what PRO-03 buys: the only path into
-- `records` is the owner's.
--
-- ## Why the proposer check is a `security definer` helper, not an inline exists
--    (2026-09-09 owner ruling, finding #1)
--
-- The live-grant check reads `shares` and `vehicles`. Both are `force row level
-- security`, owner-scoped: a mechanic caller can see NEITHER their own bound
-- grant row (shares is owner-only) nor the owner's vehicle. So an inline
-- `exists (select … from shares join vehicles …)` in the proposer policy runs
-- under the *caller's* RLS and can never be satisfied by the very mechanic PRO-01
-- authorizes — the granted mechanic's submit is refused. The fix is a
-- `security definer` helper (`has_live_can_propose_grant`) that runs as owner,
-- bypassing shares/vehicles RLS, and returns the boolean the policy consults.
-- It is the same definer-bypass discipline `accept_proposal` and T3-102's
-- mechanic RPCs use.
--
-- ## `accept_proposal` — `security definer`, the owner's action, the one records
--    write (PRO-02)
--
-- `records` is `force row level security` and its insert policy is owner-only, and
-- the record must carry the *true* server-side provenance, not whatever a caller
-- supplies. So acceptance is a `security definer` routine, pinning `set search_path
-- = ''` (the 002 hygiene rule), that gates on `auth.uid()` = the proposal's
-- `owner_id` — a definer routine bypasses RLS, so the ownership check lives IN the
-- body — locks the proposal row (`for update`), reads it server-side, resolves the
-- grant it was proposed under, inserts exactly ONE `records` row carrying the
-- provenance, and removes the proposal. A definer routine precisely so a mechanic
-- cannot write `records` at all and the owner cannot forge a mechanic's provenance
-- by hand. The `for update` lock makes acceptance idempotent under a concurrent
-- double-accept (finding #c): the second caller blocks, then finds the row already
-- gone and creates nothing — exactly one record, never two.

-- ---------------------------------------------------------------------------
-- can_propose (PRO-01) — a capability column on 002's `shares`
-- ---------------------------------------------------------------------------
-- SHR-05 forbids branching on `kind`: a grant's powers are explicit capability
-- columns, never `if kind = 'mechanic'`. So "may this holder propose?" is its own
-- boolean beside `includes_costs`/`includes_receipts`, `not null default false` —
-- private by default (SHR-01): the propose write path is closed unless the owner
-- opens it at issue time.

alter table public.shares
  add column can_propose boolean not null default false;

comment on column public.shares.can_propose is
  'PRO-01: whether this grant opens the propose-and-accept write path. not null default false — private by default (SHR-01); the owner opens it at issue time via create_share_grant(p_can_propose).';

-- ---------------------------------------------------------------------------
-- create_share_grant, widened (PRO-01) — dropped and recreated
-- ---------------------------------------------------------------------------
-- One defaulted argument is added — `p_can_propose` — so the prior 7-argument
-- call (002's five + T3-102's `p_grantee_email` + `p_is_shop_visible`) still
-- resolves unchanged. Adding an argument changes the routine's *identity*
-- (`schema.name(argtypes)`), so a bare `create or replace` would leave a SECOND
-- overload; both 002's "ships exactly one" grader and 003's issue-argument grader
-- assert exactly one routine. So the 7-argument signature is dropped and the
-- widened one created; `drop` takes the ACL with it, so the grants are restated
-- below. This is the identical 5→7 discipline T3-102 used, one argument further.
--
-- Everything else is T3-102's routine unchanged: authenticated only, the 256-bit
-- token returned once beside the id, the sha256 digest stored, the ownership
-- check, the expiry ceiling, and the two named columns. The new column is written
-- from the new argument and defaults to the conservative `false`.

drop function public.create_share_grant(uuid, text, boolean, boolean, integer, text, boolean);

create function public.create_share_grant(
  p_vehicle_id uuid,
  p_kind text,
  p_includes_costs boolean,
  p_includes_receipts boolean,
  p_expires_in_hours integer,
  p_grantee_email text default null,
  p_is_shop_visible boolean default false,
  p_can_propose boolean default false
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
    is_shop_visible,
    can_propose
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
    coalesce(p_is_shop_visible, false),
    coalesce(p_can_propose, false)
  )
  returning id into share_id;

  token := v_secret;
  return next;
end;
$$;

revoke all on function public.create_share_grant(uuid, text, boolean, boolean, integer, text, boolean, boolean) from public;
revoke all on function public.create_share_grant(uuid, text, boolean, boolean, integer, text, boolean, boolean) from anon;
grant execute on function public.create_share_grant(uuid, text, boolean, boolean, integer, text, boolean, boolean) to authenticated;

comment on function public.create_share_grant(uuid, text, boolean, boolean, integer, text, boolean, boolean) is
  'SHR-05/MEC-06/SHP-04/PRO-01: issues one typed grant on one vehicle the caller owns, optionally addressed to an email, carrying a shop-visibility choice and a can_propose capability. Returns {share_id, token}; the token is never stored and never returned again.';

-- ---------------------------------------------------------------------------
-- records provenance (PRO-02, PRO-05) — three nullable columns on 002's `records`
-- ---------------------------------------------------------------------------
-- Acceptance "SHALL create a record carrying the proposal's provenance — who
-- authored it, under which grant, and when it was accepted" (PRO-02). Three
-- nullable columns: null on an owner's own (non-proposal) record, set by
-- `accept_proposal` on an accepted one. Nullable because a normal record has no
-- proposal behind it — and the distinction between "owner wrote this" and "owner
-- accepted a mechanic's proposal" is exactly what PRO-05 renders.
--
-- `proposed_by` is `on delete set null` — the MIRROR IMAGE of proposals.proposed_by
-- (cascade). An accepted proposal IS the owner's record; the mechanic later
-- deleting their account must not delete the owner's record — only unbind the
-- attribution (PRO-06: "proposals already accepted are records and are
-- unaffected"). `proposed_under_share_id` is `set null` for the same reason (a
-- record survives its grant's deletion). Neither is a "the site vouches for this"
-- flag: a record created by accepting a proposal is the owner's own testimony,
-- never a site-verified fact (PRO-05 / AGENTS.md Facts) — so there is deliberately
-- no verified/fact_checked column here.

-- The FKs are added as named constraints rather than inline on the column, so
-- the on-delete action is read the same way from `add constraint … foreign key`
-- as from a `create table` constraint (the parser reads an inline `references`
-- only inside a `create table` body, not on an `alter table … add column`).

alter table public.records
  add column proposed_by uuid;

alter table public.records
  add column proposed_under_share_id uuid;

alter table public.records
  add column accepted_at timestamptz;

alter table public.records
  add constraint records_proposed_by_fk
  foreign key (proposed_by) references auth.users on delete set null;

alter table public.records
  add constraint records_proposed_under_share_id_fk
  foreign key (proposed_under_share_id) references public.shares on delete set null;

comment on column public.records.proposed_by is
  'PRO-02 provenance: the mechanic who authored the accepted proposal; null on an owner''s own record. references auth.users on delete set null — the record is the OWNER''s and survives the mechanic deleting their account (PRO-06); only the attribution unbinds.';
comment on column public.records.proposed_under_share_id is
  'PRO-02 provenance: the grant the accepted proposal was made under; null on an owner''s own record. references public.shares on delete set null.';
comment on column public.records.accepted_at is
  'PRO-02 provenance: when the owner accepted the proposal; null on an owner''s own record. The record is the owner''s own testimony, never a site-verified fact (PRO-05).';

-- ---------------------------------------------------------------------------
-- proposals (PRO-01, PRO-03, PRO-04) — a mechanic's draft, inert until accepted
-- ---------------------------------------------------------------------------
-- A draft record with the same shape as 002 GAR-02′ (dated, typed, optional cost,
-- time, odometer, typed references) plus optional line items (PRO-01). It lives in
-- its OWN table, never in `records`, until acceptance copies it (PRO-03).
--
-- Both `owner_id` and `proposed_by` are `on delete cascade` to `auth.users`
-- (T3-301's SHARED_USER_TABLES entry, ACC-03): a pending draft is inert and must
-- vanish if EITHER party deletes their account — the owner (their vehicle and its
-- proposal-inbox go) OR the mechanic (their unaccepted draft is theirs and goes
-- with them). `vehicle_id` cascades to `vehicles` — a proposal on a gone vehicle
-- is meaningless. The record-shaped check constraints mirror `records` so a draft
-- cannot hold a shape a record could not.

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  proposed_by uuid not null references auth.users on delete cascade,
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
  -- PRO-01's "optional line items": a structured quote breakdown the mechanic
  -- itemizes. It is the quote's working — the accepted record keeps the total
  -- (cost_amount) and the job shape, so line_items lives on the draft and is not
  -- copied onto the record, which is a historical log entry and not a quote.
  line_items jsonb,
  created_at timestamptz not null default now(),
  constraint proposals_cost_amount_ck
    check (cost_amount is null or cost_amount >= 0),
  constraint proposals_cost_currency_ck
    check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  constraint proposals_time_minutes_ck
    check (time_minutes is null or time_minutes >= 0),
  constraint proposals_odometer_km_ck
    check (odometer_km is null or odometer_km >= 0),
  constraint proposals_cost_pair_ck
    check (cost_amount is null or cost_currency is not null)
);

create index proposals_owner_id_idx on public.proposals (owner_id);
create index proposals_proposed_by_idx on public.proposals (proposed_by);
create index proposals_vehicle_id_idx on public.proposals (vehicle_id);

alter table public.proposals enable row level security;
alter table public.proposals force row level security;

comment on table public.proposals is
  'PRO-01..04: a mechanic''s draft record against an owner''s vehicle, inert until the owner accepts it. Two principals (owner_id, proposed_by), each with an ordinary RLS policy; never written into records in a pending state (PRO-03).';

-- ---------------------------------------------------------------------------
-- Grants — deny by default, then the minimum each role needs
-- ---------------------------------------------------------------------------
-- Supabase grants broad privileges on `public` before any migration runs, so a
-- grant *adds* to an inherited ACL rather than replacing it (T2-202 F2). Empty
-- the table for all three roles first, then give `authenticated` exactly the
-- verbs the two policies govern: SELECT (read), INSERT (submit), DELETE (withdraw
-- / reject). No UPDATE — a proposal is withdrawn and re-submitted, not edited —
-- and no anon: §1, "the accountless path is read-only because it has no
-- auth.uid()". Unlike the shop tables (definer-RPC writes, SELECT only), submit /
-- withdraw / reject are ordinary table ops governed by RLS (T3-301's design), so
-- the write verbs are granted here and gated by the policies below.

revoke all on public.proposals from anon, authenticated, public;

grant select, insert, delete on public.proposals to authenticated;

-- ---------------------------------------------------------------------------
-- has_live_can_propose_grant (PRO-01, PRO-06) — the proposer policy's live-grant
-- check, as a `security definer` helper (2026-09-09 owner ruling, finding #1)
-- ---------------------------------------------------------------------------
-- Answers "does this caller hold a LIVE can_propose grant on `p_vehicle_id`, and
-- is `p_owner_id` the vehicle's real owner?" — the exact correlation the proposer
-- policy needs. It is `security definer` because it reads `shares` and `vehicles`,
-- both `force row level security` and owner-scoped: run under the mechanic
-- caller's RLS (an inline `exists`), the check can never see the mechanic's own
-- bound grant nor the owner's vehicle, and so a granted mechanic's submit is
-- refused — the live-confirmed PRO-01 defect this ruling fixes. As definer it
-- runs as owner and bypasses that RLS, while `(select auth.uid())` still reads the
-- CALLER's identity from the request JWT (definer context does not change it), so
-- the grant is matched to the mechanic actually calling, not to the definer.
--
-- `set search_path = ''` + fully-qualified names is the 002 hygiene rule. It is
-- `stable` (reads only) and reachable to `authenticated` alone (the RLS predicate
-- calls it as the authenticated caller); revoked from public and anon so the
-- accountless path cannot reach it. Body carries all four liveness facts — the
-- `shares` grant, its `can_propose` capability, `revoked_at is null`, and
-- `expires_at > now()` — plus the vehicle-owner correlation the policy asserts.

create function public.has_live_can_propose_grant(
  p_vehicle_id uuid,
  p_owner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.shares s
      join public.vehicles v on v.id = s.vehicle_id
     where s.vehicle_id = p_vehicle_id
       and v.owner_id = p_owner_id
       and s.bound_account_id = (select auth.uid())
       and s.can_propose
       and s.revoked_at is null
       and s.expires_at > now()
  );
$$;

revoke all on function public.has_live_can_propose_grant(uuid, uuid) from public;
revoke all on function public.has_live_can_propose_grant(uuid, uuid) from anon;
grant execute on function public.has_live_can_propose_grant(uuid, uuid) to authenticated;

comment on function public.has_live_can_propose_grant(uuid, uuid) is
  'PRO-01/PRO-06: security-definer predicate for the proposals proposer policy — true iff the CALLER holds a live can_propose grant (not revoked, not expired) on p_vehicle_id whose owner is p_owner_id. Definer because shares/vehicles are owner-scoped force-RLS and an inline check under the caller''s RLS can never see the mechanic''s grant (2026-09-09 ruling, finding #1).';

-- ---------------------------------------------------------------------------
-- Policies (PRO-04, PRO-06) — owner-scoped and proposer-scoped, all to
-- authenticated, all pass rules.ts unchanged
-- ---------------------------------------------------------------------------
-- The OWNER gets TWO policies (2026-09-09 review, finding #3): a `for select`
-- read of their proposal inbox and a `for delete` reject, each gated on ownership
-- alone so a pending proposal stays rejectable after the mechanic's grant is
-- revoked (PRO-06). There is no owner INSERT/UPDATE policy — a single owner
-- `for all` whose `with check` tested only `owner_id` would OR into an INSERT path
-- letting the owner forge a mechanic's `proposed_by`; splitting removes it, and
-- acceptance is `accept_proposal` (which needs no table-level owner write).
-- `(select auth.uid())` is Supabase's own hoisting recommendation.

create policy "proposals owner select" on public.proposals
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "proposals owner delete" on public.proposals
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- The PROPOSER submits, reads, and withdraws their own draft — but only while
-- they hold a LIVE `can_propose` grant on the vehicle, bound to their account.
-- The live-grant conjunct is the `has_live_can_propose_grant` helper above, called
-- with the row under test (`vehicle_id`, `owner_id`); it checks BOTH liveness
-- columns (`revoked_at is null`, `expires_at > now()`), so a revoked or expired
-- grant closes submit AND withdraw on the next request (PRO-06). It rides on
-- `using` (SELECT/DELETE) and `with check` (INSERT) alike. The helper's
-- vehicle-owner correlation ties `owner_id` to the vehicle's real owner, so the
-- proposer cannot forge it. The policy stays `for all`: its INSERT is tied to
-- `proposed_by = auth.uid()`, so it is not a forgery path.

create policy "proposals proposer all" on public.proposals
  for all to authenticated
  using (
    proposed_by = (select auth.uid())
    and public.has_live_can_propose_grant(vehicle_id, owner_id)
  )
  with check (
    proposed_by = (select auth.uid())
    and public.has_live_can_propose_grant(vehicle_id, owner_id)
  );

-- ---------------------------------------------------------------------------
-- accept_proposal (PRO-02) — the owner's action, the one write into records
-- ---------------------------------------------------------------------------
-- Gated on `auth.uid()` = the proposal's `owner_id`, in the body, because a
-- definer routine bypasses RLS. Reads the proposal, resolves the grant it was
-- proposed under (for provenance), inserts exactly ONE `records` row carrying the
-- three provenance columns, and removes the proposal. Returns the new record id.
-- A mechanic accepting their OWN proposal matches no row here (they are not the
-- owner), so nothing is created — the forgery the Tier-B grader probes. Rejection
-- and withdrawal are not routines: they are the owner's / mechanic's DELETE under
-- the policies above, and "nothing is created" is a property a delete has for free.

create function public.accept_proposal(p_proposal_id uuid)
returns table (record_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_proposal public.proposals;
  v_share_id uuid;
begin
  if v_owner is null then
    raise insufficient_privilege using message = 'proposal acceptance refused';
  end if;

  -- Acceptance is the OWNER's own action, keyed to auth.uid(). A proposal the
  -- caller does not own matches no row and is refused — one refusal, so the
  -- surface is not an oracle about whether the proposal exists. `for update`
  -- locks the row so a concurrent double-accept (finding #c) is idempotent: the
  -- second caller blocks here, then — the first having deleted the row on commit
  -- — re-reads under READ COMMITTED, finds no row, and creates nothing.
  select p.* into v_proposal
    from public.proposals p
   where p.id = p_proposal_id
     and owner_id = (select auth.uid())
   for update;

  if not found then
    raise insufficient_privilege using message = 'proposal acceptance refused';
  end if;

  -- The grant the proposal was made under — the "under which grant" of PRO-02's
  -- provenance. The proposer policy guaranteed a live can_propose grant existed
  -- at submit; resolve it (preferring one still live) for the record's testimony.
  -- Known limitation (finding #d, accepted per §7.1 "keep the writable surface
  -- narrow"): the proposal does not pin its share at submit, so where a mechanic
  -- holds MORE THAN ONE can_propose grant on the same vehicle this picks the
  -- most-live one rather than the exact grant the draft was authored under.
  -- Pinning at submit would widen the mechanic-writable surface (a caller-supplied
  -- share_id to validate), which the carve-out forbids; accept-time resolution
  -- stays.
  select s.id into v_share_id
    from public.shares s
   where s.vehicle_id = v_proposal.vehicle_id
     and s.bound_account_id = v_proposal.proposed_by
     and s.can_propose
   order by (s.revoked_at is null and s.expires_at > now()) desc,
            s.expires_at desc
   limit 1;

  -- The ONE write into records (PRO-02, PRO-03). The draft's record-shaped fields
  -- become the record; the three provenance columns carry the true, server-side
  -- attribution — never whatever a caller supplied.
  insert into public.records (
    vehicle_id,
    occurred_on,
    kind,
    title,
    body,
    cost_amount,
    cost_currency,
    time_minutes,
    odometer_km,
    problem_ids,
    part_ids,
    procedure_ids,
    proposed_by,
    proposed_under_share_id,
    accepted_at
  )
  values (
    v_proposal.vehicle_id,
    v_proposal.occurred_on,
    v_proposal.kind,
    v_proposal.title,
    v_proposal.body,
    v_proposal.cost_amount,
    v_proposal.cost_currency,
    v_proposal.time_minutes,
    v_proposal.odometer_km,
    v_proposal.problem_ids,
    v_proposal.part_ids,
    v_proposal.procedure_ids,
    v_proposal.proposed_by,
    v_share_id,
    now()
  )
  returning id into record_id;

  -- The proposal has become a record; it no longer lives here.
  delete from public.proposals where id = p_proposal_id;

  return next;
end;
$$;

revoke all on function public.accept_proposal(uuid) from public;
revoke all on function public.accept_proposal(uuid) from anon;
grant execute on function public.accept_proposal(uuid) to authenticated;

comment on function public.accept_proposal(uuid) is
  'PRO-02: the vehicle owner accepts a pending proposal — the owner''s own action (keyed on auth.uid() = the proposal''s owner_id) and the one write into records. Creates exactly one record carrying the proposal''s provenance, then removes the proposal. Returns the new record id.';
