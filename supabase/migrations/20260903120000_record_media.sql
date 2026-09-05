-- T2-305 — record media attachments: the `record_media` table, the private
-- `record-media` bucket, the delete-record belt that reaches it, and the
-- atomic photo-path writers that close T2-304's lost-update race.
-- refs specs/002-montero-garage (GAR-06', GAR-01', GAR-05', SHR-01, ACC-03)
--
-- > **GAR-06'** (owner-approved addition, 2026-09-02) A record SHALL support
-- > general documentation attachments — photo, video, or audio, in addition to
-- > GAR-05''s image/PDF receipts — uploaded into user-private storage,
-- > independent of a receipt''s vendor/date/amount fields. Never publicly
-- > accessible unless the record''s visibility is opened.
--
-- Every name and shape here comes from `tests/garage/contract.ts` and
-- `tests/garage/record-media.test.ts` (T2-305a [TEST]), which are the
-- authority: the table `record_media`, the bucket id `record-media`, the path
-- `<owner uuid>/<vehicle id>/<record id>/<file>`, and the closed set
-- `photo | video | audio` are decisions those files made on the spec's behalf.
--
-- ## A row per object, not `records.media_paths text[]`
--
-- The array shape is what carries the defect T2-304's seeding found on
-- `vehicles.photo_paths`: two uploads landing back to back read-modify-write
-- the same array and one clobbers the other, leaving a real storage object
-- that no row names. An insert cannot lose to a concurrent insert, and a row
-- is also the only shape that can carry `media_kind`, which GAR-06' needs and
-- an array of paths cannot hold. (The array on `vehicles` is not going away —
-- it is fixed at the bottom of this file instead.)
--
-- ## An attachment is not a receipt
--
-- No `vendor`, no `issued_on`, no `amount`, no `currency`. GAR-06' says an
-- attachment is "independent of a receipt's vendor/date/amount fields", and a
-- financial column that arrives here "just in case" is how two surfaces that
-- must stay separate grow a shared shape nobody decided on. The boundary is
-- enforced on the bytes as well: the bucket refuses `application/pdf`, which
-- the receipts bucket allows, so the media bucket cannot quietly become a
-- second place to put facturas.

-- ---------------------------------------------------------------------------
-- record_media (GAR-06')
-- ---------------------------------------------------------------------------
-- `media_kind` is a closed set because GAR-06' names three kinds and only
-- three. Free text means the page's render branch is driven by strings nobody
-- validates, and "photo" versus "image" silently renders nothing — the same
-- reason `records.kind` is constrained.

create table public.record_media (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records on delete cascade,
  storage_path text not null,
  media_kind text not null,
  created_at timestamptz not null default now(),
  constraint record_media_storage_path_ck
    check (length(btrim(storage_path)) > 0),
  constraint record_media_kind_ck
    check (media_kind in ('photo', 'video', 'audio'))
);

create index record_media_record_id_idx on public.record_media (record_id);

comment on table public.record_media is
  'GAR-06'': photo/video/audio documentation attached to a record. One row per stored object; never a financial document (that is public.receipts).';
comment on column public.record_media.media_kind is
  'GAR-06'': photo | video | audio, and no fourth value.';

-- ---------------------------------------------------------------------------
-- Row-level security: enabled AND forced
-- ---------------------------------------------------------------------------
-- `enable` alone exempts the table owner, and migrations run as the owner, so
-- a table that is only enabled is wide open to anything holding that
-- connection.

alter table public.record_media enable row level security;
alter table public.record_media force row level security;

-- The ownership path is `record_id -> vehicle_id -> owner_id`, which is the
-- receipts policy with one table name changed. The subquery joins back to the
-- row (`r.id = record_media.record_id`); without that join,
-- `exists (select 1 from records ...)` would mean "own any record, read
-- everyone's attachments".

create policy "record media owner all" on public.record_media
  for all to authenticated
  using (
    exists (
      select 1
        from public.records r
        join public.vehicles v on v.id = r.vehicle_id
       where r.id = record_media.record_id
         and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.records r
        join public.vehicles v on v.id = r.vehicle_id
       where r.id = record_media.record_id
         and v.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- The revoke is not redundant with the grant. Supabase's default privileges
-- hand `authenticated` ALL on a new table in `public` — TRUNCATE included,
-- which no policy filters — and an explicit `grant` *adds to* that ACL rather
-- than replacing it. T2-202's F2 found that by emptying `profiles` as
-- `authenticated` against a schema whose declaration graders were green.
-- Revoke first, by name, then name what is allowed.

revoke all on public.record_media from anon;
revoke all on public.record_media from public;
revoke all on public.record_media from authenticated;

grant select, insert, update, delete on public.record_media to authenticated;
grant select, insert, update, delete on public.record_media to service_role;

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
--     record-media/<owner uuid>/<vehicle id>/<record id>/<file>
--
-- Three declared categories and nothing else. An untyped private bucket is a
-- general-purpose file host attached to a truck; a bucket that also took
-- `application/pdf` would be a second receipts bucket wearing a different
-- name. A hundred megabytes rather than the photos bucket's ten, because a
-- two-minute phone video of a noise the shop could not reproduce is the
-- motivating case and it does not fit in ten.
--
-- The same list and limit are mirrored in `src/lib/garage/record-media.ts` so
-- the page can refuse a file before spending a reader's data uploading it;
-- this is the copy that is enforced.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'record-media',
  'record-media',
  false,
  104857600,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
    'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm',
    'audio/amr', 'audio/3gpp'
  ]
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Policies on storage.objects
-- ---------------------------------------------------------------------------
-- `(storage.foldername(name))[1]` is the owner segment — the same position as
-- receipts and photos, deliberately, so these are policies whose shape has
-- already been proved against the whole cross-user matrix. Every clause
-- compares it to the caller, so a request for someone else's object is refused
-- at the point it is made, including the request for a *signed URL*, which is
-- a bearer token with a timer: once issued, nothing downstream asks who asked
-- for it.
--
-- No policy reads the vehicle or record segments, and none should: a user's
-- own records are all equally theirs, and a predicate joining storage to
-- `public.records` would make every attachment read depend on a second table's
-- policies staying correct. Those two segments earn their keep in the cleanup
-- below, where they turn "delete this record's media" into a prefix match.
--
-- Read and write are separate policies rather than one `for all`, so a future
-- edit that loosens one cannot silently loosen the other.

create policy "record media owner select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'record-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "record media owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'record-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "record media owner update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'record-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'record-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "record media owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'record-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- ACC-03: the purge has to know about a third bucket
-- ---------------------------------------------------------------------------
-- > **ACC-03** … after a 30-day recovery window, all vehicles, records, and
-- > **stored files** SHALL be hard-deleted.
--
-- A voice note is a stored file. The purge names its buckets explicitly, and
-- the failure is invisible from outside: the count it returns is deleted
-- *accounts*, so a purge that leaves an entire bucket behind reads as a
-- healthy one.
--
-- Replaced forward, not edited backward, for the reason T2-301 recorded: a
-- migration is a record of what ran, so editing an already-applied file
-- changes what a *fresh* database gets and nothing at all about the one that
-- exists. `create or replace` preserves the ACL; the grants below are a
-- restatement rather than a repair, restated so a reader of the file that last
-- defined this routine can see who may call it without opening another one.

create or replace function public.purge_expired_accounts(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired uuid[];
  v_expired_text text[];
  v_count integer := 0;
begin
  select coalesce(array_agg(p.id), array[]::uuid[])
    into v_expired
    from public.profiles p
   where p.deleted_at is not null
     and p.deleted_at <= p_now - interval '30 days';

  if array_length(v_expired, 1) is null then
    return 0;
  end if;

  select array_agg(id::text) into v_expired_text
    from unnest(v_expired) as t(id);

  perform set_config('storage.allow_delete_query', 'true', true);

  -- Every bucket this project stores user files in. A bucket added without
  -- being added here is how ACC-03 stops being true with nothing going red.
  delete from storage.objects o
   where o.bucket_id in ('receipts', 'vehicle-photos', 'record-media')
     and (storage.foldername(o.name))[1] = any (v_expired_text);

  delete from auth.users u
   where u.id = any (v_expired);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_expired_accounts(timestamptz) from public;
revoke all on function public.purge_expired_accounts(timestamptz) from anon;
revoke all on function public.purge_expired_accounts(timestamptz) from authenticated;
grant execute on function public.purge_expired_accounts(timestamptz) to service_role;

comment on function public.purge_expired_accounts(timestamptz) is
  'ACC-03 step 2: hard-deletes accounts whose 30-day window has closed, and their objects in every user bucket. Service role only.';

-- ---------------------------------------------------------------------------
-- Deleting one record has to reach its objects
-- ---------------------------------------------------------------------------
-- `record_media` rows disappear with their record because they are rows
-- pointing at rows, and `on delete cascade` is exactly that. A storage object
-- is not a row in `public`, so there is nothing for a foreign key to hang
-- from: removing one record from a vehicle's log would otherwise leave its
-- video in the bucket forever — still readable by its owner, still counted
-- against their quota, and named by a `record_media` row that no longer
-- exists.
--
-- `on_vehicle_deleted` cannot do this job: it is a *vehicles* trigger, and
-- cascade-deleting a record is a different event. This one is `for each row`
-- on purpose, so it also fires for records cascaded away by a vehicle delete.
--
-- It deletes **by prefix**, and the prefix is vehicle *and* record. Matching on
-- the owner segment alone would empty that owner's whole garage on the
-- deletion of one note — the same defect wearing the opposite coat, and far
-- harder to notice in production, because nobody checks the records they did
-- not delete. `old.id` is the only thing a row-level `after delete` trigger
-- knows about which record it is.
--
-- Not driven off the `record_media` rows, deliberately: `storage_path` is
-- written by a client, so it can disagree with the bucket in both directions,
-- and an upload whose row insert failed leaves an object the table never knew
-- about. The prefix is the truth.
--
-- ## Still open, and named here rather than forgotten a third time
--
-- **`receipts` has no delete-trigger belt, and this migration does not give it
-- one.** T2-302 recorded the gap and left it open; the cause is the receipt
-- *path* shape (`<owner>/<file>`), which carries nothing that identifies a
-- record or a vehicle, so no prefix can find one record's receipts and no
-- trigger can reach them without reading the rows it is cascading away.
-- Fixing it means changing the path of objects already stored — a data
-- migration this task does not authorise. `deleteRecord`/`deleteVehicle` in
-- `src/lib/supabase/garage.ts` still remove receipt objects through the
-- Storage API before the row delete that destroys the index, and the account
-- purge above still covers the abandoned case by owner prefix.
--
-- `security definer` because the caller is `authenticated` and the delete has
-- to happen regardless; `set search_path = ''` so every name below is
-- qualified. `storage.allow_delete_query` is Supabase's own opt-in for a
-- deliberate SQL deletion of object rows — `storage.protect_delete` refuses
-- without it.
--
-- The limit `purge_expired_accounts` documents applies here too: this removes
-- the object *rows*, which is every route to the bytes (download, list and
-- sign all go through them), and not the bytes in the storage backend, which
-- only the Storage API can delete and which reaching from inside Postgres
-- would mean keeping a service key in the database. AGENTS.md forbids that
-- anywhere in this project. The page therefore removes the objects through the
-- Storage API before deleting the row, and this trigger is the belt for when
-- it did not.

create function public.handle_record_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects o
   where o.bucket_id = 'record-media'
     and (storage.foldername(o.name))[2] = old.vehicle_id::text
     and (storage.foldername(o.name))[3] = old.id::text;

  return old;
end;
$$;

revoke all on function public.handle_record_deleted() from public;
revoke all on function public.handle_record_deleted() from anon;
revoke all on function public.handle_record_deleted() from authenticated;

comment on function public.handle_record_deleted() is
  'GAR-06'': removes a deleted record''s objects from record-media. No foreign key can reach storage.';

create trigger on_record_deleted
  after delete on public.records
  for each row execute function public.handle_record_deleted();

-- ---------------------------------------------------------------------------
-- The lost-update race on vehicles.photo_paths (found by T2-304)
-- ---------------------------------------------------------------------------
-- Uploading two vehicle photos back to back fast enough loses one of them.
-- The page read `photo_paths`, appended to the array it had read, and sent the
-- whole array back — so two uploads that overlap both start from the same
-- array and the second write erases the first entry. What is left is a real
-- storage object that no row names: invisible to its owner, still against
-- their quota, and only reachable again by the account purge. It happened for
-- real while seeding Gitana Blanca and was recovered by hand.
--
-- The fix is at the SQL layer and not in a client-side upload queue, because a
-- queue is a promise one tab makes and two tabs cannot keep — and the page is
-- not the only writer this row will ever have. `array_append` inside a single
-- `update` reads and writes the array in one statement, under the row lock
-- Postgres already takes, so a concurrent append waits and then appends to the
-- array the first one left behind.
--
-- ## `security invoker`, which is the whole point
--
-- These run as the caller, so `vehicles`' own policy decides whether the row
-- is theirs — exactly as it does for the `update` these replace. A definer
-- routine here would be a new way to write another user's row, which is the
-- one thing the ownership column exists to prevent. `set search_path = ''` all
-- the same: it costs nothing and it is what stops an unqualified `vehicles`
-- from resolving to a caller-created table.
--
-- Both return the resulting `photo_paths` rather than the whole row, so the
-- page's column list stays the authority on what a vehicle row contains. A
-- caller who does not own the vehicle updates no row and gets `null`, which is
-- the same refusal the policy already gives them.
--
-- Idempotent on purpose. A retry after a response that was lost in flight must
-- not list the same object twice, and `array_append` on its own would.

create function public.append_vehicle_photo(p_vehicle_id uuid, p_path text)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_paths text[];
begin
  update public.vehicles v
     set photo_paths = case
           when p_path = any (v.photo_paths) then v.photo_paths
           else array_append(v.photo_paths, p_path)
         end,
         updated_at = now()
   where v.id = p_vehicle_id
  returning v.photo_paths into v_paths;

  return v_paths;
end;
$$;

-- The mirror image, and it carries the same race: removing one photo by
-- sending a filtered copy of the array re-introduces every entry a concurrent
-- upload had just added.

create function public.remove_vehicle_photo(p_vehicle_id uuid, p_path text)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_paths text[];
begin
  update public.vehicles v
     set photo_paths = array_remove(v.photo_paths, p_path),
         updated_at = now()
   where v.id = p_vehicle_id
  returning v.photo_paths into v_paths;

  return v_paths;
end;
$$;

revoke all on function public.append_vehicle_photo(uuid, text) from public;
revoke all on function public.append_vehicle_photo(uuid, text) from anon;
revoke all on function public.remove_vehicle_photo(uuid, text) from public;
revoke all on function public.remove_vehicle_photo(uuid, text) from anon;

grant execute on function public.append_vehicle_photo(uuid, text) to authenticated;
grant execute on function public.remove_vehicle_photo(uuid, text) to authenticated;

comment on function public.append_vehicle_photo(uuid, text) is
  'GAR-01'': appends one object path to vehicles.photo_paths atomically. Runs as the caller, so RLS decides whose row it is.';
comment on function public.remove_vehicle_photo(uuid, text) is
  'GAR-01'': removes one object path from vehicles.photo_paths atomically. Runs as the caller, so RLS decides whose row it is.';
