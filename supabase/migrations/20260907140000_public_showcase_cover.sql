-- T2-404d (RPC half) — the world-reader path finally learns about the public
-- cover-photo copy T2-404b's `20260907130000_vehicle_cover_photo_public_bucket.sql`
-- has been populating all along.
-- refs specs/002-montero-garage (GAR-01′, SHR-02, SHR-09)
--
-- > **GAR-01′** … A user SHALL be able to designate one uploaded photo as the
-- > vehicle's **cover photo** … rendered wherever the vehicle is shown as a
-- > single item — the garage vehicle list, and any future showcase-page card
-- > (SHR-02).
-- > **SHR-09** A grant SHALL NOT make a record eligible for the community
-- > evidence surfacing of GAR-04′.
--
-- ## What was missing
--
-- The storage half shipped and is live: a public `vehicle-cover-photos`
-- bucket, kept in sync with `vehicles.cover_photo_path` by a copy-on-designate
-- trigger. `share_read_vehicle`'s `p_token is null` (world) branch never
-- learned about it — it projects identity and the two publication flags, never
-- `cover_photo_path` — so the showcase page's cover image has nothing to show.
--
-- ## Why the gate is `is_showcase_public`, alone, not the row-admitting OR
--
-- The world branch's own `where` clause admits a row when *either* page is
-- public (`is_showcase_public is true or is_worklog_public is true`), because
-- a work-log-only truck still needs a name and taxonomy identity to head that
-- page. That OR is a gate on the *row*, not on this *field*: GAR-01′ names the
-- cover as content of the showcase card specifically, so a vehicle whose owner
-- published only the work-log must not hand out a cover photo through a page
-- they never chose to publish. `tests/garage/contract.ts`'s
-- `COVER_PUBLICATION_FLAG` and `tests/garage/public-cover-photo.test.ts`'s
-- `coverExposureIssues` grade exactly this distinction, down to the exact
-- affirmative idiom below (`case when v.is_showcase_public is true then …`,
-- the same `||`-merge shape `share_read_records` already ships for
-- `is_cost_public`).
--
-- ## Why the RPC returns a raw path, not a full URL
--
-- Postgres does not know its own project's public Storage origin, and should
-- not have to: `src/lib/garage/showcase-view.ts`'s `publicCoverPhotoUrl` seam
-- is the one place that turns a stored path into
-- `<PUBLIC_SUPABASE_URL>/storage/v1/object/public/vehicle-cover-photos/<path>`,
-- the same division `share_read_receipts`/`sign-receipt` already draw between
-- "resolve the path in Postgres" and "turn it into a URL where the API origin
-- is known."
--
-- ## Why only this branch changes
--
-- The token path is untouched: a share-grant holder resolves a token, not a
-- handle, and the cover is a showcase-page concern that path never asked
-- about — reading the column there would be the identical SHR-09 conflation
-- one column further (`tests/garage/public-cover-photo.test.ts`'s
-- "outside the world path" finding). The row-admitting `where` clause is also
-- untouched: which vehicles are returned at all does not change, only what one
-- of the returned rows may additionally carry.
--
-- `create or replace` keeps the function's OID and therefore its existing ACL
-- (`anon`/`authenticated` execute, granted by `20260907120000_public_pages.sql`)
-- — nothing to restate here, unlike a `drop`-and-`create`.

create or replace function public.share_read_vehicle(
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
             || case
                  when v.is_showcase_public is true then
                    jsonb_build_object('cover_photo_path', v.cover_photo_path)
                  else '{}'::jsonb
                end
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

comment on function public.share_read_vehicle(text, text, uuid) is
  'SHR-02/SHR-05/SHR-07: one vehicle''s identity. With a token, the granted truck; with a null token, the published trucks of one handle — never both on one path (SHR-09). The world path additionally carries cover_photo_path, gated on is_showcase_public specifically (GAR-01′), never the row-admitting OR.';
