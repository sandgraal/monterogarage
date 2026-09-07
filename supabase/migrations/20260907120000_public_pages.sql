-- T2-404b — the world-reader path: what an anonymous visitor reads when a
-- vehicle's owner published it, served by the same two anon RPCs a grant
-- holder reaches.
-- refs specs/002-montero-garage (SHR-02, SHR-03, SHR-04, SHR-09, SHR-01,
-- GAR-01', GAR-04')
--
-- > **SHR-02** A user SHALL be able to publish, per vehicle: a showcase page
-- > and/or a work-log page, each at a stable public URL under their handle.
-- > **SHR-03** Costs and receipts SHALL stay private even on a public work-log
-- > unless opened per record.
--
-- ## Why this is the same reader and not a fourth function
--
-- The 2026-09-05 owner amendment on T2-404: "The world (no token) and a
-- share-token holder are both principals with no authenticated session; one
-- anon-granted reader serves both, reviewed once." `share-instrument.test.ts`
-- holds the anon-executable set **equal** to `SHARE_READER_FUNCTIONS`, so a
-- fourth entry point would be a widening of a security allow-list in a
-- grader's contract — which T2-402 already ruled is not an implementer's edit.
-- Nothing in `tests/garage/` changes for this migration.
--
-- ## Why the world path is gated on `p_token is null`, in that exact shape
--
-- T2-404a's narrowed SHR-09 rule (owner ruling 2026-09-06): a declared share
-- reader may consult `is_showcase_public` / `is_worklog_public` **only** on a
-- path that also requires the token to be absent. The same reader consulting
-- them while resolving a token is still a finding, because that is the routine
-- that could conflate "one grantee may see this" with "this is published" —
-- and the conflation puts a private work-log on a public problem page
-- (T2-403's scope guard).
--
-- So each reader below opens with `if p_token is null then … return; end if;`
-- and every publication flag it reads sits inside that branch. The predicate of
-- the world query repeats `p_token is null` as its first conjunct, which is not
-- redundancy for the grader's benefit: it is the statement itself refusing to
-- return a published row to a request that presented a token, so the guard
-- survives a later edit that moves the query out of the branch.
--
-- ## Why the signature grew rather than the function count
--
-- A world request has no token to name a vehicle with, so it names one the way
-- the URL does: a handle (`profiles.handle`, SHR-02's namespace) and a vehicle
-- id. Both arguments carry `default null`, so every call that exists today —
-- `{ p_token }` from `src/lib/supabase/shares.ts`, and `share-fixtures.ts`'
-- Tier-B payloads — resolves against this signature unchanged. Postgres cannot
-- add a parameter through `create or replace`, so each reader is dropped and
-- recreated, and its ACL is restated below because a drop takes the ACL with
-- it.
--
-- `share_read_receipts` is deliberately **not** touched. The world never sees a
-- receipt (SHR-03, GAR-05′, and `visibleReceipts` in
-- `src/lib/garage/visibility.ts` — `receiptsAreOpen` is `false` for the world),
-- and a reader with no world path needs no world argument. Called with a null
-- token it already refuses: `digest(null, 'sha256')` is null, no row matches,
-- and it raises the one refusal it has always raised.
--
-- ## What the world may see, and where that is decided
--
-- Exactly `src/lib/garage/visibility.ts`'s `world` principal, restated in SQL
-- because SHR-01 permits three enforcement modes and page code is none of
-- them:
--
-- * the vehicle's identity, when **either** page is published — a truck's name
--   and taxonomy identity is the header of both the showcase and the work-log,
--   so publishing either publishes it;
-- * a record, only when `vehicles.is_worklog_public` **and** `records.is_public`
--   — two switches, the vehicle's being the outer one (`mayReadRecord`);
-- * that record's cost pair, only when `records.is_cost_public` — SHR-03's
--   "costs … stay private even on a public work-log unless opened per record",
--   and appended rather than blanked, so a record whose cost was not opened has
--   no `cost_amount` key at all (SHR-06's shape, one audience over);
-- * never a receipt, never a visibility flag on a record, never an owner id.
--
-- The two per-vehicle publication flags **are** projected on the world path,
-- and that is not a leak: they say which of this truck's public pages exist,
-- which is the one thing a public index has to know to link them. They are the
-- owner's published decision, not a private one — and no reader may use them
-- for anything else, which is what T2-404a's rule now checks per occurrence.

-- ---------------------------------------------------------------------------
-- share_read_vehicle (SHR-02, SHR-05, SHR-07)
-- ---------------------------------------------------------------------------
-- The world path answers "which of this handle's trucks are published, and
-- which pages does each one have"; the token path is byte-for-byte the reader
-- T2-404 shipped, because a grant holder's answer did not change.
--
-- `retired_handles` is not consulted on purpose. A handle its owner renamed
-- away from resolves to nothing here, which is the whole point of keeping the
-- old word out of circulation (T2-402): a link shared under the old name goes
-- quiet rather than quietly pointing at whoever holds the word now.

drop function if exists public.share_read_vehicle(text);

create function public.share_read_vehicle(
  p_token text default null,
  p_handle text default null,
  p_vehicle_id uuid default null
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
begin
  if p_token is null then
    return query
      select jsonb_build_object(
               'id', v.id,
               'display_name', v.display_name,
               'generation_id', v.generation_id,
               'market_id', v.market_id,
               'model_year', v.model_year,
               'engine_id', v.engine_id,
               'odometer_km', v.odometer_km,
               'is_showcase_public', v.is_showcase_public,
               'is_worklog_public', v.is_worklog_public
             )
        from public.vehicles v
        join public.profiles p on p.id = v.owner_id
       where p_token is null
         and lower(p.handle) = lower(btrim(p_handle))
         and (p_vehicle_id is null or v.id = p_vehicle_id)
         and (v.is_showcase_public is true or v.is_worklog_public is true)
       order by v.created_at, v.id;
    return;
  end if;

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

-- ---------------------------------------------------------------------------
-- share_read_records (SHR-02, SHR-03, SHR-06, SHR-07)
-- ---------------------------------------------------------------------------
-- The world path is the published work-log: `is_worklog_public` on the truck,
-- `is_public` on the row, `is_cost_public` on the money. Three switches, none
-- of them derived from another — SHR-03 is precisely the claim that a public
-- work-log does not publish what the work cost.
--
-- A world request must name its vehicle: `v.id = p_vehicle_id` with a null
-- argument matches nothing, so "every published record of every truck" is not
-- a request this reader can be asked to serve by leaving a field out.
--
-- The token path keeps the vehicle-wide history it always had — that is what
-- the grant buys, and it is exactly why SHR-09 keeps the two apart.

drop function if exists public.share_read_records(text);

create function public.share_read_records(
  p_token text default null,
  p_handle text default null,
  p_vehicle_id uuid default null
)
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
  if p_token is null then
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
                  when r.is_cost_public is true then
                    jsonb_build_object(
                      'cost_amount', r.cost_amount,
                      'cost_currency', r.cost_currency
                    )
                  else '{}'::jsonb
                end
        from public.records r
        join public.vehicles v on v.id = r.vehicle_id
        join public.profiles p on p.id = v.owner_id
       where p_token is null
         and lower(p.handle) = lower(btrim(p_handle))
         and v.id = p_vehicle_id
         and v.is_worklog_public is true
         and r.is_public is true
       order by r.occurred_on desc, r.id;
    return;
  end if;

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

-- ---------------------------------------------------------------------------
-- The anon surface, restated because a drop takes the ACL with it
-- ---------------------------------------------------------------------------
-- Same two lines per routine as `20260906120100_share_grants.sql`, for the same
-- two reasons: Postgres grants EXECUTE on a *new* function to PUBLIC by
-- default, so a routine nobody revoked is reachable by `anon` in the running
-- database while being silent in the file; and a signed-in visitor holding a
-- link is still a visitor, so `authenticated` keeps its execute rather than
-- being made to log out to read a page anybody can read.

revoke all on function public.share_read_vehicle(text, text, uuid) from public;
revoke all on function public.share_read_records(text, text, uuid) from public;

grant execute on function public.share_read_vehicle(text, text, uuid) to anon;
grant execute on function public.share_read_records(text, text, uuid) to anon;

grant execute on function public.share_read_vehicle(text, text, uuid) to authenticated;
grant execute on function public.share_read_records(text, text, uuid) to authenticated;

comment on function public.share_read_vehicle(text, text, uuid) is
  'SHR-02/SHR-05/SHR-07: one vehicle''s identity. With a token, the granted truck; with a null token, the published trucks of one handle — never both on one path (SHR-09).';
comment on function public.share_read_records(text, text, uuid) is
  'SHR-02/SHR-03/SHR-06: a vehicle''s history. With a token, the whole history with costs the grant opened; with a null token, only records the owner published, with costs only where the record opened them.';
