-- T2-404b (cover-photo public-bucket half) — a new public `vehicle-cover-photos`
-- bucket, kept in sync with T2-306's `cover_photo_path` by a copy-on-designate /
-- remove-on-departure pair of triggers.
-- refs specs/002-montero-garage (SHR-02..04, SHR-09, GAR-01')
--
-- > **Owner ruling, 2026-09-07 (tasks.md:1523-1535):** the showcase card
-- > cannot show T2-306's designated cover photo as-is — `photo_paths` lives in
-- > a private, path-derived-ownership bucket no anonymous reader can see.
-- > Ruling: a **new public storage bucket**, populated by a **copy-on-
-- > designate step** added to the cover-photo flow (T2-306's
-- > `clear_departed_vehicle_cover()` trigger path) — when `cover_photo_path`
-- > is set, the chosen photo is copied into the public bucket under the same
-- > key; when cleared or departed, the public copy is removed. Two copies of
-- > one file, deliberately, in exchange for a trivial (bucket-is-public) RLS
-- > story instead of a second signer surface.
--
-- ## Why this cannot be a scoped read on the private bucket instead
--
-- The rejected alternative is a `storage.objects` policy on `vehicle-photos`
-- that opens `select` to `anon` when the path equals some public vehicle's
-- `cover_photo_path` — which needs no second bucket and no copy at all. The
-- ruling calls it "a second signer surface" and rejects it, and the reason is
-- sharper than taste: `vehicle-photos` is private under SHR-01's
-- **unconditional** rule ("everything a user stores SHALL default to
-- private"), documented at length in `20260831120000_vehicle_photos_storage.sql`
-- as a decision that holds "even though showcase pages are public" — a public
-- bucket hands out a permanent, guessable, unauthenticated URL to *every*
-- object in it from the moment it exists, and a `select` policy that only
-- *sometimes* applies is the one shape of mistake (a boolean condition
-- computed wrong, a column renamed, a join that silently stops matching) that
-- turns an entire owner-private album public with no migration announcing it.
-- A second, genuinely-public bucket containing *only copies nothing else
-- lives in* cannot leak the original by any policy bug, because the original
-- is never in it.
--
-- ## Why the copy cannot be pure SQL — proven against a live stack, not assumed
--
-- A `storage.objects` row is metadata; the bytes live in the Storage
-- **backend**, addressed by a key this migration cannot construct or reach.
-- Verified directly against this project's own local stack rather than taken
-- on faith: `docker exec supabase_storage_monterogarage sh -c 'find /mnt'`
-- shows every object at
-- `/mnt/<tenant>/<tenant>/<bucket_id>/<name>/<version>` — a path keyed by
-- **bucket, name, and a `version` UUID `storage.objects` also stores, but
-- does not expose any function to move or duplicate**. Two rows created
-- moments apart for byte-identical content (proven with the receipts bucket's
-- own seed fixtures, same size, same `eTag`) get two different `version`s and
-- two separate files on disk. An `insert into storage.objects` naming the new
-- bucket and the old `name` therefore produces a row with nothing behind it —
-- a Postgres "success" and a Storage API 404 for every reader, forever. This
-- is exactly the limit `20260831120000_vehicle_photos_storage.sql` and
-- `20260903120000_record_media.sql` already document for **deletion** ("not
-- the bytes in the storage backend, which only the Storage API can delete") —
-- this migration hits the same wall from the write side, for the same reason.
--
-- ## Why the way through is not a service key
--
-- Both migrations above stop there and route the actual byte operation
-- through the *page*, calling the Storage API as the signed-in owner, because
-- the only way for **Postgres** to reach that API is a static credential, and
-- AGENTS.md forbids keeping a service key in the database. That refusal is
-- correct and this migration does not relitigate it — grep it for
-- `service_role` or a hardcoded key and find neither.
--
-- What it does instead is forward the one credential already, legitimately,
-- in the room. PostgREST sets `request.headers` as a GUC for the lifetime of
-- the transaction handling every request it proxies — confirmed live, against
-- this exact stack, with a throwaway `security invoker` probe function
-- (`current_setting('request.headers', true)::json->>'authorization'`) called
-- both as an RPC and as a plain table `PATCH`, both times printing the exact
-- `Bearer …` value curl was given. That value is the **raw, already-signed**
-- token PostgREST just validated to let this very `update` through — not the
-- decoded claims (`request.jwt.claims`, which cannot be turned back into a
-- valid signature without the signing secret, and reconstructing one would
-- be the service-key problem wearing a hat), and not a secret this migration
-- invents or stores. Forwarding it authenticates the copy call **as the same
-- owner whose update just fired the trigger**, subject to the exact same
-- storage policies as if that owner had called the Storage API directly, for
-- exactly as long as the token they already hold remains valid. Nothing new
-- is created, nothing is written to the database, and the call can do nothing
-- its holder could not already do with one more request of their own.
--
-- Verified end-to-end against the local stack before being written into this
-- file: upload a photo as an authenticated test owner into `vehicle-photos`;
-- extract that owner's own bearer token; issue `net.http_post` to the Storage
-- API's `/object/copy` route with only that header attached (no `apikey`,
-- no service role); read the destination bucket's object back over plain
-- anonymous `curl`. It served the file.
--
-- ## Where the call lands, locally and once hosted
--
-- `net.http_post` targets `kong`, not `127.0.0.1:54321` — a trigger runs
-- inside the database container, where `127.0.0.1` is itself, not the host's
-- port mapping. `docker inspect` on this project's own Kong container shows
-- its network alias is `api.supabase.internal` alongside the plain `kong`
-- hostname — Supabase's own naming for project-internal traffic — and it is
-- the identical Kong instance the external `:54321` route above already
-- proxies through. The base URL is read from a Postgres setting
-- (`app.settings.storage_internal_url`) with the local value as its default,
-- so the **hosted project is not this migration's to configure blind**: see
-- `specs/002-montero-garage/HANDOFF-T2-404B-STORAGE-URL.md` for the one-time
-- `alter database … set …` the owner runs there. Until that lands, or if the
-- call ever fails for any other reason (network hiccup, an expired token,
-- `pg_net` unreachable), the exception handler below swallows it: the
-- **designation itself always succeeds**, because nothing about GAR-01' or
-- SHR-01 depends on this call, and the showcase card keeps rendering the same
-- no-cover placeholder a photo-less vehicle already gets — the ruling's own
-- words, "that fallback is not itself blocking."
--
-- ## Eventual, not immediate — and that is the ruling's own trade, not a bug
--
-- `net.http_post` enqueues and returns; the actual HTTP round trip happens
-- moments later on `pg_net`'s own worker. A showcase page rendered in the
-- instant between "cover designated" and "copy landed" sees the placeholder,
-- exactly as it would have before this bucket existed. `tests/garage`'s Tier
-- B proof polls for the copy to appear rather than asserting it is there
-- synchronously, because asserting synchronous delivery of an intentionally
-- asynchronous call would be grading a promise this design never made.

-- ---------------------------------------------------------------------------
-- pg_net — the one extension this file adds, and the whole reason it is safe
-- ---------------------------------------------------------------------------
-- Supabase ships `pg_net` for exactly this shape of need (its own "Database
-- Webhooks" feature is built on it): a trigger that has to make an outbound
-- HTTP call without blocking the transaction that fired it. Installed into
-- `extensions`, the schema every other Supabase-provided extension in this
-- project already lives in.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
--     vehicle-cover-photos/<owner uuid>/<vehicle id>/<file>
--
-- The same path shape as `vehicle-photos`, and deliberately: "under the same
-- key" is the ruling's own phrase, and a copy is only recognisably a copy of
-- a specific private object if the two paths agree. Image types and the size
-- limit mirror `vehicle-photos` for the same reason `record-media` mirrors
-- receipts' shape where the two are the same kind of thing — a cover photo is
-- always one of the vehicle's uploaded *photos* (GAR-01'), never a fourth
-- kind of file this bucket has to reason about.
--
-- `public = true`: this is the one bucket in the project where that is
-- correct rather than the leak `20260831120000` spends a comment warning
-- against, because nothing else about this bucket claims to be private —
-- see the RLS section below for what "public" does and does not bypass.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vehicle-cover-photos',
  'vehicle-cover-photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Policies on storage.objects — and what "public" does and does not bypass
-- ---------------------------------------------------------------------------
-- Verified live, against this stack, before this shape was chosen: an
-- anonymous `GET` on `/storage/v1/object/public/<bucket>/<name>` succeeds for
-- a `public = true` bucket with **zero** policies granting anything to `anon`
-- or `public` — that route does not consult `storage.objects` RLS at all. So
-- the anonymous-read half of this bucket's job needs no policy whatsoever,
-- and adding one would be worse than useless: `tests/garage/rules.ts`'s
-- `storagePolicyIssues` — the sweep that already runs, unconditionally, over
-- every `storage.objects` policy in every bucket this project has — treats a
-- policy granted `to anon` or `to public` as a finding on its own terms, with
-- no per-bucket exception, because every bucket before this one has been
-- private and a policy open to `anon` on any of them would have been exactly
-- the leak T2-201's review went looking for. This bucket earns its anonymous
-- readability from `storage.buckets.public` alone, and stays inside that
-- sweep's rule rather than asking the rule to make an exception.
--
-- What RLS still has to do is decide who may *write* here, because "public
-- bucket" says nothing about that — and the answer is not "any authenticated
-- owner of a matching path", the `vehicle-photos` shape, because that alone
-- would let a buggy or malicious caller plant an object here for a photo the
-- vehicle owns but has not designated as its cover, which is precisely the
-- non-cover exposure this task exists to prevent. So the `with check` below
-- adds a second clause past ownership: the path must equal that vehicle's
-- **current** `cover_photo_path`, read live off `public.vehicles`. A write
-- attempting anything else — a plain photo, a stale former cover, another
-- owner's path — is refused by the database regardless of what wrote it or
-- why, the same "enforced where the two columns live" argument
-- `20260906120000` already made for `vehicles_cover_photo_path_ck`, one
-- table over.
--
-- `update` is granted alongside `insert` for parity with the pattern every
-- other bucket in this project follows, though the trigger below only ever
-- needs the latter: a cover that changes files gets a fresh key, and a cover
-- re-designated after being cleared is a fresh `insert` into a slot the
-- belt-delete below already emptied, never an `update` in place.

create policy "vehicle cover photos owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vehicle-cover-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
        from public.vehicles v
       where v.id::text = (storage.foldername(name))[2]
         and v.owner_id = (select auth.uid())
         and v.cover_photo_path = name
    )
  );

create policy "vehicle cover photos owner update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'vehicle-cover-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'vehicle-cover-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
        from public.vehicles v
       where v.id::text = (storage.foldername(name))[2]
         and v.owner_id = (select auth.uid())
         and v.cover_photo_path = name
    )
  );

-- `select` and `delete`, owner-scoped by path exactly like every other
-- bucket, so an authenticated owner can always see and remove their own
-- public copies through the ordinary authenticated route — the automatic
-- belt below does not make either capability redundant to grant, only
-- redundant to rely on.
--
-- **This `select` policy is never actually consulted, for anyone, and that is
-- not a bug.** Proven live: an authenticated owner-B token reading owner-A's
-- object through the plain `/object/<bucket>/<name>` route — not the
-- `/object/public/…` route the comment above already covers — also returns
-- 200, unfiltered, the moment `storage.buckets.public` is true. Supabase's
-- Storage API treats `public` as a bucket-wide "no read policy applies here"
-- switch on every GET route, not only the one with `public` in its name, and
-- nothing in `storage.objects` RLS can change that — a `using` clause is only
-- ever consulted when the API decides to consult one. Granting the policy
-- anyway is still correct, for the same "if this bucket's `public` flag were
-- ever wrong, RLS is the second thing that would have to *also* be wrong"
-- defence-in-depth reasoning as everywhere else in this project — it is a
-- read policy that would matter the day the bucket is not public and does
-- nothing before that day, which is a different claim from protecting a
-- cross-owner read today. It does not, and nothing about GAR-01′ or SHR-02
-- needs it to: every object in this bucket is, by construction, a photo its
-- owner already chose to publish on a public showcase page.

create policy "vehicle cover photos owner select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vehicle-cover-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "vehicle cover photos owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vehicle-cover-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- The sync trigger: copy on designate, remove on clear or departure
-- ---------------------------------------------------------------------------
-- One `after` trigger on `vehicles`, not an extension of
-- `clear_departed_vehicle_cover()` itself, because that function is a
-- `before` trigger whose entire job is deciding what `new.cover_photo_path`
-- **becomes** — folding a second, unrelated side effect (an outbound HTTP
-- call) into a row-shaping function would make one function answer two
-- questions, and the departure case already reaches this trigger for free:
-- by the time an `after` trigger sees the row, `new.cover_photo_path` is
-- whatever `clear_departed_vehicle_cover()` decided it should be, so a plain
-- `old` vs `new` comparison here catches a direct clear, a departure-clear,
-- and a designation with exactly one shape of logic, and does not need to
-- know which of the three happened.
--
-- `security invoker`, deliberately, for the same reason
-- `append_vehicle_photo`/`remove_vehicle_photo` in `20260903120000` are: this
-- runs as the owner whose row it already is, so the `delete` half needs no
-- elevated privilege and no `storage.allow_delete_query` — the owner-scoped
-- policy above already lets them remove their own object, exactly as if they
-- had called the Storage API themselves. A `security definer` routine here
-- would be a new way to touch storage on another user's behalf, which is the
-- one thing this file's whole design (forward the caller's own token, never a
-- wider one) exists to avoid.
--
-- Every branch that can fail for a reason unrelated to the vehicle write
-- itself — `pg_net` unreachable, no request context (a direct SQL write, a
-- seed script, a service-role call with nothing to forward), a delete racing
-- an object already gone — is caught and discarded. The designation the
-- owner asked for must never fail because its derived, disposable shadow
-- could not be written or removed.

create or replace function public.sync_vehicle_cover_public_copy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_auth_header text;
begin
  if new.cover_photo_path is not distinct from old.cover_photo_path then
    return new;
  end if;

  -- The half that needs no network call at all: a cover that departed (by
  -- direct clear, by `clear_departed_vehicle_cover()`, or because this row is
  -- about to have a different one) leaves its old public copy behind unless
  -- something removes it, and removing a `storage.objects` row is exactly the
  -- SQL delete every other bucket in this project already does — **and, as
  -- `handle_vehicle_deleted` next door already had to discover, an RLS grant
  -- alone is not enough to run it.** `storage.protect_delete` is a `before
  -- delete` trigger Supabase itself installs on `storage.objects`, and it
  -- fires ahead of RLS, refusing *any* plain SQL delete — however the caller
  -- is authorized to make it — unless the session has explicitly opted in
  -- with `storage.allow_delete_query`. Proven live rather than assumed: the
  -- first version of this function omitted the `perform set_config` below,
  -- on the theory that the owner-scoped `delete` policy already granted was
  -- enough, and every deletion silently failed and was silently swallowed by
  -- the `exception when others` guard — a passing designation, a "successful"
  -- update, and an old cover that stayed world-readable forever. Caught only
  -- by polling the public route after a cover change in a live Tier B run,
  -- not by reading the SQL, which is exactly the failure mode `exception when
  -- others then null` always risks and exactly why this comment exists.
  if old.cover_photo_path is not null then
    begin
      perform set_config('storage.allow_delete_query', 'true', true);
      delete from storage.objects
       where bucket_id = 'vehicle-cover-photos'
         and name = old.cover_photo_path;
    exception when others then
      null;
    end;
  end if;

  -- The half that does: a freshly designated cover has to be copied in, and
  -- the only credential available to a trigger that should authenticate as
  -- this owner and no one wider is the bearer token PostgREST already
  -- validated for this very request.
  if new.cover_photo_path is not null then
    begin
      v_auth_header :=
        current_setting('request.headers', true)::json ->> 'authorization';

      if v_auth_header is not null then
        perform net.http_post(
          url := coalesce(
            current_setting('app.settings.storage_internal_url', true),
            'http://kong:8000'
          ) || '/storage/v1/object/copy',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', v_auth_header
          ),
          body := jsonb_build_object(
            'bucketId', 'vehicle-photos',
            'sourceKey', new.cover_photo_path,
            'destinationBucket', 'vehicle-cover-photos',
            'destinationKey', new.cover_photo_path
          )
        );
      end if;
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_vehicle_cover_public_copy() from public;
revoke all on function public.sync_vehicle_cover_public_copy() from anon;
revoke all on function public.sync_vehicle_cover_public_copy() from authenticated;

comment on function public.sync_vehicle_cover_public_copy() is
  'T2-404b: keeps vehicle-cover-photos in sync with cover_photo_path. Removal is a plain SQL delete; the copy-in forwards the caller''s own PostgREST bearer token to the Storage API''s copy route (never a service key) and swallows any failure, because GAR-01'' and SHR-01 do not depend on this call succeeding.';

drop trigger if exists on_vehicle_cover_public_copy on public.vehicles;

create trigger on_vehicle_cover_public_copy
  after insert or update on public.vehicles
  for each row execute function public.sync_vehicle_cover_public_copy();

-- ---------------------------------------------------------------------------
-- Vehicle deletion has to reach this bucket too
-- ---------------------------------------------------------------------------
-- `on_vehicle_deleted` (`20260831120000`) already removes a deleted vehicle's
-- objects from `vehicle-photos` by owner+vehicle prefix; a hard-deleted
-- vehicle's public cover copy is the same kind of orphan the same way, and
-- the fix is the same one already used twice in this project for exactly this
-- situation: replace the routine forward rather than edit the migration that
-- shipped it, because a migration is a record of what ran, not a live
-- definition — `20260831120000`'s own comment on this point still applies
-- verbatim. `create or replace` keeps the trigger already pointed at this
-- function name; only the body changes.

create or replace function public.handle_vehicle_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects o
   where o.bucket_id in ('vehicle-photos', 'vehicle-cover-photos')
     and (storage.foldername(o.name))[1] = old.owner_id::text
     and (storage.foldername(o.name))[2] = old.id::text;

  return old;
end;
$$;

revoke all on function public.handle_vehicle_deleted() from public;
revoke all on function public.handle_vehicle_deleted() from anon;
revoke all on function public.handle_vehicle_deleted() from authenticated;

comment on function public.handle_vehicle_deleted() is
  'GAR-01'': removes a deleted vehicle''s objects from vehicle-photos and its public cover copy from vehicle-cover-photos. No foreign key can reach storage.';

-- ---------------------------------------------------------------------------
-- ACC-03: the purge has to know about a fourth bucket
-- ---------------------------------------------------------------------------
-- > **ACC-03** … after a 30-day recovery window, all vehicles, records, and
-- > **stored files** SHALL be hard-deleted.
--
-- A public cover copy is still a stored file, and the same invisible-failure
-- shape `20260831120000` and `20260903120000` both warn about applies a third
-- time: the count this function returns is deleted *accounts*, so a purge
-- that leaves one bucket behind still reads as healthy. Replaced forward for
-- the same reason as `handle_vehicle_deleted` above; the grants are restated,
-- not repaired, so a reader of the definition that lands last can see who may
-- call it without opening another file.

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
   where o.bucket_id in ('receipts', 'vehicle-photos', 'record-media', 'vehicle-cover-photos')
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
