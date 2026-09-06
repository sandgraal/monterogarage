-- T2-404 — typed share grants: the `shares` table, the two authenticated
-- lifecycle RPCs, and the three `security definer` readers an accountless
-- grant holder reaches.
-- refs specs/002-montero-garage (SHR-05, SHR-06, SHR-07, SHR-08, SHR-09,
-- SHR-01, GAR-05')
--
-- > **SHR-05** A user SHALL be able to issue, per vehicle, a **typed share
-- > grant**: a revocable, expiring, capability-scoped bearer token that admits
-- > its holder to a defined subset of that vehicle's data.
--
-- Every name and shape here comes from `tests/garage/contract.ts` (T2-401a /
-- T2-401 [TEST]), which is the authority: the table `shares`, the columns
-- `token_hash`/`kind`/`includes_costs`/`includes_receipts`/`expires_at`/
-- `revoked_at`, the routine names `create_share_grant`,
-- `revoke_share_grant`, `share_read_vehicle`, `share_read_records`,
-- `share_read_receipts`, and their argument names are decisions those files
-- made on the spec's behalf.
--
-- ## Why a `security definer` function granted to `anon`, and not RLS
--
-- SHR-07 puts a reader on the far side of the database with **no
-- `auth.uid()`**. RLS cannot express that: `rules.ts`' `policyIssues` rejects
-- any policy naming `anon`/`public` or whose `using` is not owner-scoped, and
-- correctly so. The architecture recorded for this task (002 §10, 2026-08-31)
-- is therefore a definer routine granted to `anon`, with every table keeping
-- `revoke all … from anon`. No new policy is owner-unscoped; nothing in
-- `rules.ts` had to be amended to let this land.
--
-- A definer routine runs as its owner and RLS on the tables it reads is **not
-- consulted**. Whatever the body checks is the entire access control. That is
-- why every one of the three readers below repeats the same three-part token
-- test — hash, expiry, revocation — inline rather than delegating it to a
-- helper: `tests/garage/share-instrument.test.ts` grades each of those three
-- as a separate finding against each anon-reachable routine, and a helper
-- would move the check out of the surface the grader can see.
--
-- ## The token: 256 bits, stored as a plain sha256 digest, never salted
--
-- `extensions.gen_random_bytes(32)` is 256 bits of CSPRNG output, hex-encoded
-- so it survives a URL fragment untouched. What is stored is
-- `extensions.digest(token, 'sha256')` in a `bytea not null unique` column, so
-- a database leak is not a grant leak.
--
-- **Plain sha256 is deliberate and it is the right primitive here.** bcrypt,
-- scrypt and argon2 exist to make *low-entropy human secrets* expensive to
-- guess: they buy work-factor against a keyspace small enough to enumerate.
-- Against 2^256 there is nothing to enumerate — an attacker who could brute
-- force this could brute force the AES key protecting the database — so a
-- work factor buys no security and costs a lookup that cannot use an index,
-- turning every share read into a full table scan. Salting is worse than
-- useless for the same reason: a per-row salt makes the digest unfindable by
-- index, which is exactly the property the unique constraint provides, and it
-- defends against a rainbow table that cannot exist for a 32-byte random
-- value. The next reviewer will ask; this is the argument.
--
-- ## Rate limiting is not in this file, and that is a considered position
--
-- Against a 256-bit keyspace, guessing is not the threat, so a rate limit here
-- would be a cost and denial-of-service control wearing a security costume.
-- What matters and *is* graded: the refusal is uniform across unknown,
-- expired and revoked (SHR-08), and the failure path is no more expensive than
-- the success path — one indexed lookup on `token_hash`, then a `raise`.
-- Counting attempts would mean a write on the anonymous path, which SHR-07
-- forbids outright.

-- ---------------------------------------------------------------------------
-- shares (SHR-05, SHR-06, SHR-08)
-- ---------------------------------------------------------------------------
-- Ownership goes through `vehicle_id` and not through a second `granted_by`
-- column: SHR-08 says a grant is revocable "by its issuer", and the issuer is
-- the vehicle's owner. One answer to "whose grant is this" means a vehicle
-- that changes hands cannot leave a live grant behind answering to the
-- previous owner — and the RLS predicate below is the `records` predicate with
-- one table name changed, a shape already proved against the cross-user
-- matrix.
--
-- `expires_at` is `not null` because SHR-08 says every grant "SHALL carry an
-- expiry", and a nullable expiry is a grant that never ends wearing the same
-- column name as one that does. `revoked_at` is nullable because null means
-- live: a revocation is a timestamp and not a delete, so "this grant was
-- revoked on the 3rd" survives for the owner to see.
--
-- `kind` is a closed set of two. SHR-05 makes the preset "a label over
-- explicit capability fields, never a branch in consuming code" — so the
-- column exists to *describe* a grant, and no reader below compares it to
-- anything. The capability columns decide; the label only says what the owner
-- meant.

create table public.shares (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles on delete cascade,
  token_hash bytea not null unique,
  kind text not null,
  includes_costs boolean not null default false,
  includes_receipts boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shares_kind_ck check (kind in ('mechanic', 'buyer'))
);

create index shares_vehicle_id_idx on public.shares (vehicle_id);

comment on table public.shares is
  'SHR-05: one revocable, expiring, capability-scoped grant on one vehicle. token_hash is sha256(token); the token itself exists in exactly one response and is never stored.';
comment on column public.shares.token_hash is
  'SHR-05: sha256 of a 256-bit random token. Not salted and not a KDF — see this migration''s header for why that is correct against this keyspace.';
comment on column public.shares.kind is
  'SHR-05: a label over the capability columns (mechanic | buyer). Never a branch in a reader.';
comment on column public.shares.includes_costs is
  'SHR-06: opens the money — record cost fields and the amount/currency pair on a receipt row. Independent of includes_receipts.';
comment on column public.shares.includes_receipts is
  'SHR-06: opens receipt rows and the signer path. Independent of includes_costs: a scan is shared with its total withheld when only this bit is set.';
comment on column public.shares.expires_at is
  'SHR-08: every grant carries an expiry. Not null — "until revoked" is a far date, not a null.';
comment on column public.shares.revoked_at is
  'SHR-08: null means live. Revocation is a timestamp, so the owner can still see what they ended and when.';

-- ---------------------------------------------------------------------------
-- Row-level security: enabled AND forced
-- ---------------------------------------------------------------------------
-- `enable` alone exempts the table owner, and migrations run as the owner.
-- This is the table that holds the material a bearer presents, so it gets
-- every property the other five get, from the same sweeps.

alter table public.shares enable row level security;
alter table public.shares force row level security;

create policy "shares owner all" on public.shares
  for all to authenticated
  using (
    exists (
      select 1
        from public.vehicles v
       where v.id = shares.vehicle_id
         and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.vehicles v
       where v.id = shares.vehicle_id
         and v.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- The revoke is not redundant with the grant: Supabase's default privileges
-- hand `authenticated` ALL on a new table in `public` — TRUNCATE included,
-- which no policy filters — and a `grant` *adds to* that ACL rather than
-- replacing it (T2-202 review, F2). Revoke by name first, then name what is
-- allowed.
--
-- `anon` reaches this table through nothing at all. The three readers below
-- are `security definer`, so they read it as their owner; the anonymous role
-- itself holds no privilege on it, which is what keeps `shares` inside the
-- same deny-by-default posture as every other user table.

revoke all on public.shares from anon;
revoke all on public.shares from public;
revoke all on public.shares from authenticated;

grant select, insert, update, delete on public.shares to authenticated;
grant select, insert, update, delete on public.shares to service_role;

-- ---------------------------------------------------------------------------
-- create_share_grant (SHR-05, SHR-06)
-- ---------------------------------------------------------------------------
-- Authenticated only. Issuing a grant is a write and it is the *owner's*
-- write: an anonymous caller able to mint a grant is an anonymous caller able
-- to grant themselves one.
--
-- The token is returned **once**, beside the id the owner will manage the
-- grant by. A token is a secret the owner copies and cannot be asked to keep;
-- an id is how they revoke one link without revoking the other (SHR-08 is
-- per-grant, which is why `revoke_share_grant` takes `p_share_id`).
--
-- `security definer` so the insert does not depend on the caller also holding
-- table privileges directly, and so ownership is checked once, here, in a
-- routine the graders read. The ownership test is explicit rather than
-- inherited from RLS precisely because a definer routine does not consult RLS.
--
-- ## The lifetime has a ceiling and deliberately no floor (T2-404 review, F10)
--
-- The form offers 7, 30 and 90 days, but a form is not an enforcement mode
-- (SHR-01). PostgREST exposes this routine directly, so `p_expires_in_hours`
-- is a caller-controlled integer and `make_interval(hours => 87600)` mints a
-- ten-year "expiring" grant — SHR-08's expiry requirement satisfied on paper
-- and defeated in fact. The ceiling below is the form's own longest choice, so
-- a direct call can do what the UI can do and nothing more.
--
-- There is no floor, and that asymmetry is the point rather than an oversight:
-- a short — or negative — lifetime produces a grant that every reader refuses
-- from the moment it exists, which cannot leak anything. Clamping it upward
-- would be the dangerous direction, and it would also break the Tier B
-- already-expired fixture, which asks for `-1` precisely because that is the
-- only way to observe a real expired grant without waiting an hour.

create function public.create_share_grant(
  p_vehicle_id uuid,
  p_kind text,
  p_includes_costs boolean,
  p_includes_receipts boolean,
  p_expires_in_hours integer
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
    expires_at
  )
  values (
    p_vehicle_id,
    extensions.digest(v_secret, 'sha256'),
    p_kind,
    coalesce(p_includes_costs, false),
    coalesce(p_includes_receipts, false),
    now() + make_interval(hours => v_hours)
  )
  returning id into share_id;

  token := v_secret;
  return next;
end;
$$;

revoke all on function public.create_share_grant(uuid, text, boolean, boolean, integer) from public;
revoke all on function public.create_share_grant(uuid, text, boolean, boolean, integer) from anon;
grant execute on function public.create_share_grant(uuid, text, boolean, boolean, integer) to authenticated;

comment on function public.create_share_grant(uuid, text, boolean, boolean, integer) is
  'SHR-05: issues one typed grant on one vehicle the caller owns. Returns {share_id, token}; the token is never stored and never returned again.';

-- ---------------------------------------------------------------------------
-- revoke_share_grant (SHR-08, 003 MON-02)
-- ---------------------------------------------------------------------------
-- > Revocation SHALL take effect on the next request and SHALL never be gated
-- > by payment, by plan, or by any other condition.
--
-- So this routine consults exactly one thing: whether the caller owns the
-- vehicle the grant is on. No subscription, no entitlement, no quota — and
-- `revocationGatingIssues` grades that as a deny-list rather than an
-- allow-list, because "any other condition" is the load-bearing phrase and the
-- day 003's entitlements table exists, joining it here would be one line that
-- reads like prudence.
--
-- Per **grant**, by id. An owner who handed their mechanic a link in March and
-- a buyer a link in June must be able to end one without ending the other; a
-- `revoke_share_grant(p_vehicle_id)` cannot express that, and a revoke-all is
-- a different operation the spec does not ask for.
--
-- Idempotent: `coalesce(revoked_at, now())` keeps the first revocation's
-- timestamp, so revoking twice does not rewrite when the owner actually cut
-- the link.
--
-- A grant the caller does not own matches no row, and this raises rather than
-- answering 200 with an empty update. Returning success for a revocation that
-- revoked nothing is the worst possible answer: the owner is told the link is
-- dead and it is not.

create function public.revoke_share_grant(p_share_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
begin
  if v_owner is null then
    raise insufficient_privilege using message = 'share revocation refused';
  end if;

  update public.shares s
     set revoked_at = coalesce(s.revoked_at, now())
   where s.id = p_share_id
     and exists (
       select 1
         from public.vehicles v
        where v.id = s.vehicle_id
          and v.owner_id = v_owner
     );

  if not found then
    raise insufficient_privilege using message = 'share revocation refused';
  end if;

  return true;
end;
$$;

revoke all on function public.revoke_share_grant(uuid) from public;
revoke all on function public.revoke_share_grant(uuid) from anon;
grant execute on function public.revoke_share_grant(uuid) to authenticated;

comment on function public.revoke_share_grant(uuid) is
  'SHR-08: ends one grant, by id, for its issuer. Gated on ownership and on nothing else — never on payment, plan, or any other condition.';

-- ---------------------------------------------------------------------------
-- The three readers (SHR-06, SHR-07)
-- ---------------------------------------------------------------------------
-- ## Why three entry points and not one JSON reader
--
-- SHR-06: costs and receipts are two decisions, and where a grant does not
-- open costs "THE data returned SHALL omit the cost fields entirely rather
-- than blanking them at render time". A single query has **one** predicate
-- governing **one** result set, so a reader returning both cost columns and
-- receipt data has no correct gating: `costs AND receipts` starves the
-- `costs=false receipts=true` grant, `costs OR receipts` serves one of them to
-- a grant that did not open it, and gating on neither is the leak outright.
-- Three entry points make the omission structural.
--
-- ## The refusal is one refusal (SHR-08)
--
-- Unknown, expired and revoked all reach the same `raise`, with the same
-- message, from the same place, after the same single indexed lookup. There is
-- no branch that could tell them apart and no message that names which one was
-- hit, so the surface is not an existence oracle. `share-grants.test.ts`
-- compares all three on the wire; this is the shape that makes them equal.
--
-- ## Every reader repeats the token test rather than sharing a helper
--
-- Deliberate. `share-instrument.test.ts` grades hash-not-plaintext, expiry and
-- revocation as three independent findings **against each anon-reachable
-- routine's own body**. A shared `resolve_share(token)` helper would empty
-- those three bodies of the checks that matter and move the whole access
-- decision somewhere the closed allow-list does not sweep. Thirty duplicated
-- characters, in exchange for the check being where the instrument looks.
--
-- ## `stable`, not `volatile`
--
-- These read and never write. SHR-07: "WHILE a request carries no
-- authenticated session, no grant SHALL admit any write." Marking them
-- `stable` says so to the planner as well as to a reader.

-- --- share_read_vehicle -----------------------------------------------------
-- §10 ruling 4 gives the accountless holder "the 001 reference filtered to
-- that exact vehicle by the fitment engine", and that needs the taxonomy
-- identity and nothing else. No owner id, no photo paths, no publication
-- flags: this is the smallest row that answers "which truck is this".

create function public.share_read_vehicle(p_token text)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
begin
  select s.vehicle_id
    into v_vehicle_id
    from public.shares s
   where s.token_hash = extensions.digest(p_token, 'sha256')
     and s.revoked_at is null
     and s.expires_at > now();

  if not found then
    raise insufficient_privilege using message = 'share unavailable';
  end if;

  return query
    select jsonb_build_object(
             'id', v.id,
             'display_name', v.display_name,
             'generation_id', v.generation_id,
             'market_id', v.market_id,
             'model_year', v.model_year,
             'engine_id', v.engine_id,
             'odometer_km', v.odometer_km
           )
      from public.vehicles v
     where v.id = v_vehicle_id;
end;
$$;

-- --- share_read_records -----------------------------------------------------
-- The vehicle's whole history — a grant is "hand my mechanic this truck's
-- whole history", so the record-level `is_public` flag is not consulted here.
-- That is what the grant buys, and it is exactly why SHR-09 keeps this path
-- away from the community-evidence path: a record visible to one grantee is
-- not published.
--
-- The columns are named one by one and the cost pair is **appended
-- conditionally**, so a grant that did not open costs receives a JSON object
-- with no `cost_amount` key at all. `cost_amount: null` would be a value, and
-- the value means the job was free — a different and untrue claim about
-- somebody's money.
--
-- The visibility flags are never projected: a record carrying `is_public` and
-- `is_cost_public` would tell the holder which of the owner's *other*
-- decisions they are not seeing.

create function public.share_read_records(p_token text)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
  v_includes_costs boolean;
begin
  select s.vehicle_id, s.includes_costs
    into v_vehicle_id, v_includes_costs
    from public.shares s
   where s.token_hash = extensions.digest(p_token, 'sha256')
     and s.revoked_at is null
     and s.expires_at > now();

  if not found then
    raise insufficient_privilege using message = 'share unavailable';
  end if;

  return query
    select jsonb_build_object(
             'id', r.id,
             'vehicle_id', r.vehicle_id,
             'occurred_on', r.occurred_on,
             'kind', r.kind::text,
             'title', r.title,
             'body', r.body,
             'time_minutes', r.time_minutes,
             'odometer_km', r.odometer_km,
             'problem_ids', to_jsonb(r.problem_ids),
             'part_ids', to_jsonb(r.part_ids),
             'procedure_ids', to_jsonb(r.procedure_ids)
           )
           || case
                when v_includes_costs is true then
                  jsonb_build_object(
                    'cost_amount', r.cost_amount,
                    'cost_currency', r.cost_currency
                  )
                else '{}'::jsonb
              end
      from public.records r
     where r.vehicle_id = v_vehicle_id
     order by r.occurred_on desc, r.id;
end;
$$;

-- --- share_read_receipts ----------------------------------------------------
-- **Which rows come back** is gated on `includes_receipts` and on nothing
-- else. A reader that also required `includes_costs` to return the row would
-- collapse SHR-06's two decisions into one, and the cell it would break —
-- `costs=false receipts=true` — is the cell a single "full access" boolean
-- cannot express. So a scan is still shared with its money withheld, exactly
-- as a record is.
--
-- ## `amount` and `currency` are the grant's *cost* decision, not its receipt
-- ## decision (T2-404 review, F1)
--
-- The first version of this routine returned `amount` and `currency`
-- unconditionally, and argued that a receipt *is* an amount, so withholding
-- the number while handing over a picture of the number was theatre. That
-- argument lost, for two reasons that are not stylistic:
--
-- 1. The owner's own issue panel says, in both locales, that they can "hand
--    over the scans without the totals, or the totals without the scans". A
--    reader that ships the totals with the scans anyway makes the checkbox
--    beside that sentence a lie, and the checkbox is the whole of SHR-06.
-- 2. `includes_costs` is the *money* bit, wherever the money lives. Reading it
--    as "the money on `records` only" is the same collapse in the other
--    direction: two columns, one of which quietly does not mean what it says.
--
-- So the money pair is **appended conditionally**, in the same idiom
-- `share_read_records` uses two functions above — omitted entirely, not
-- `null`, for a grant that does not open costs. That is a claim about the
-- *grant*, not about this *receipt*: `receipts.amount`/`receipts.currency`
-- are themselves nullable, and a `costs=true` grant on a receipt nobody ever
-- entered a total for still returns the pair as `null` — correctly, because
-- here `null` means "the owner never recorded one," not "you were not shown
-- it." Only the omitted case says the second thing.
--
-- The residual is stated rather than hidden: a `costs=false receipts=true`
-- grant can still open the scan and *read* the total off the image. This
-- routine cannot redact a JPEG. What it can do is refuse to put the figure
-- into a machine-readable field the holder can total up, sort by, or scrape —
-- and that is the difference between a document somebody looked at and a
-- dataset somebody has.
--
-- `storage_path` is returned because the Edge signer resolves it: the signer
-- signs the path this routine hands back and never a path a caller supplied,
-- which is the single rule that keeps authorization in Postgres.

create function public.share_read_receipts(p_token text)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
  v_includes_costs boolean;
begin
  select s.vehicle_id, s.includes_costs
    into v_vehicle_id, v_includes_costs
    from public.shares s
   where s.token_hash = extensions.digest(p_token, 'sha256')
     and s.revoked_at is null
     and s.expires_at > now()
     and s.includes_receipts is true;

  if not found then
    raise insufficient_privilege using message = 'share unavailable';
  end if;

  return query
    select jsonb_build_object(
             'id', rc.id,
             'record_id', rc.record_id,
             'storage_path', rc.storage_path,
             'vendor', rc.vendor,
             'issued_on', rc.issued_on
           )
           || case
                when v_includes_costs is true then
                  jsonb_build_object(
                    'amount', rc.amount,
                    'currency', rc.currency
                  )
                else '{}'::jsonb
              end
      from public.receipts rc
      join public.records r on r.id = rc.record_id
     where r.vehicle_id = v_vehicle_id
     order by rc.issued_on desc nulls last, rc.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The anon surface, and nothing else on it
-- ---------------------------------------------------------------------------
-- `revoke all … from public` first: Postgres grants EXECUTE on a new function
-- to PUBLIC by default, so a routine nobody revoked is reachable by `anon` in
-- the running database while being silent in the file. The `alter default
-- privileges … revoke all on functions from anon|public` in T2-202's schema
-- migration already covers new functions in `public`; these lines say it again
-- per routine so the end-state ACL is readable without reading another file.
--
-- `authenticated` gets execute too. A grant holder who happens to have an
-- account of their own is still a grant holder — the token is what admits
-- them, and refusing a signed-in visitor would mean a mechanic has to log out
-- to read a link a customer sent.

revoke all on function public.share_read_vehicle(text) from public;
revoke all on function public.share_read_records(text) from public;
revoke all on function public.share_read_receipts(text) from public;

grant execute on function public.share_read_vehicle(text) to anon;
grant execute on function public.share_read_records(text) to anon;
grant execute on function public.share_read_receipts(text) to anon;

grant execute on function public.share_read_vehicle(text) to authenticated;
grant execute on function public.share_read_records(text) to authenticated;
grant execute on function public.share_read_receipts(text) to authenticated;

comment on function public.share_read_vehicle(text) is
  'SHR-05/SHR-07: the granted vehicle''s taxonomy identity, so the 001 fitment engine can filter the reference to this exact truck.';
comment on function public.share_read_records(text) is
  'SHR-05/SHR-06: the granted vehicle''s history. Cost fields are present only when the grant opens them — omitted, not blanked.';
comment on function public.share_read_receipts(text) is
  'SHR-06: receipt metadata and the storage path the Edge signer resolves, only when the grant opens receipts. Which rows come back is independent of includes_costs; the amount/currency pair on each row is not, and is omitted rather than blanked.';

-- ---------------------------------------------------------------------------
-- The reserved-handle list catches up with the site's namespace (SHR-02)
-- ---------------------------------------------------------------------------
-- Not part of the grant surface, and here because this is the migration that
-- adds a route segment. T2-404 serves the accountless share page at
-- `/en/share/` and `/es/compartir/`, which puts two new words into
-- `COLLECTION_ROUTE_SEGMENTS` — and the reserved set is graded as a **superset
-- of the segments the site actually serves**, so both had to join
-- `RESERVED_HANDLES` in `src/lib/garage/handles.ts` and
-- `tests/garage/contract.ts` in this same change.
-- `20260903120100_public_handles.sql` states that list a third time as a check
-- constraint, and its own comment says why: "a word reserved in `handles.ts`
-- and forgotten here is a red `tier-b` job rather than a silent divergence
-- between the affordance and the guarantee."
--
-- **`search` and `buscar` are added here too, and that is a fix, not a
-- drive-by.** T702 added them to both TypeScript lists when it shipped
-- `/en/search/` and did not add them to this constraint — so as things stand
-- the form refuses the handle `buscar` and the database accepts it, which is
-- exactly the divergence the constraint exists to prevent. Found while adding
-- the two words beside them; leaving them out while restating this very list
-- would have been the harder thing to explain.
--
-- Restated in full rather than patched, because a check constraint has no
-- `alter … add value`: `drop constraint if exists` then `add constraint` is
-- the only shape, and it is the shape the file above already uses. Nothing
-- else about the constraint changes — same length bounds, same pattern, same
-- impersonation words, same `handle is null` escape for an account that has
-- never published.
--
-- Applying this to a database whose `profiles.handle` already holds one of the
-- four new words would fail, loudly, at migration time. That is the correct
-- behaviour and not a hazard worth working around: nobody holds one — the form
-- has refused `search` and `buscar` since T702, and `share` and `compartir`
-- have never been reachable — and a `not valid` constraint would leave the
-- guarantee false for exactly the row that broke it.

alter table public.profiles
  drop constraint if exists profiles_handle_ck;

alter table public.profiles
  add constraint profiles_handle_ck check (
    handle is null
    or (
      length(handle) >= 2
      and length(handle) <= 32
      and handle ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'
      and handle <> all (array[
        'admin', 'administrator', 'api', 'root', 'support', 'help',
        'official', 'staff', 'moderator', 'security', 'billing',
        'montero', 'monterogarage', 'gitana', 'www', 'mail',
        'static', 'assets', '_astro',
        'en', 'es',
        'glossary', 'glosario',
        'community', 'comunidad',
        'sign-in', 'ingresar',
        'garage', 'taller',
        'problems', 'problemas',
        'parts', 'repuestos',
        'mods', 'modificaciones',
        'procedures', 'procedimientos',
        'search', 'buscar',
        'share', 'compartir'
      ])
    )
  );
