-- T2-404d follow-up — read the cover-copy Storage API base URL from a
-- Supabase Vault secret, not an unsettable Postgres GUC.
-- refs specs/002-montero-garage (SHR-02..04, SHR-09, GAR-01')
--
-- ## The problem this fixes
--
-- `20260907130000_vehicle_cover_photo_public_bucket.sql` resolved the
-- outbound Storage API base URL as
-- `coalesce(current_setting('app.settings.storage_internal_url', true),
-- 'http://kong:8000')` — a Postgres custom GUC, settable locally with
-- `alter database … set app.settings.storage_internal_url = …` while running
-- as a superuser. The hosted project's `postgres` role is not a superuser
-- there, and Postgres 15+ refuses `alter database … set` for a
-- custom (dotted) parameter class from a non-superuser — there is no
-- supported way for this migration to persist that GUC on the hosted
-- database. A manual `create or replace` was applied directly against the
-- hosted database to hardcode its own project URL as the fallback, which is
-- exactly the kind of prod-only drift a re-deploy of this migration
-- directory would silently revert. This migration removes the GUC from the
-- picture entirely: the URL now comes from a **Supabase Vault** secret,
-- which is ordinary encrypted table storage any role can read through
-- `vault.decrypted_secrets` (subject to that view's own grants) and any
-- role with `pgsodium`/vault privileges can write with
-- `vault.create_secret(...)` — no superuser, no GUC, no per-environment code
-- diff.
--
-- Deliberately **not** a new `public` table: an earlier attempt at this same
-- fix used a small config table and tripped `ungradedTableIssues`
-- (`tests/garage/rules.ts`) — a new table in `public` this contract's
-- private-data sweeps did not know how to grade. Vault's `vault.secrets` /
-- `vault.decrypted_secrets` already exist in the `vault` schema Supabase
-- ships; this migration adds no table anywhere.
--
-- This migration does **not** seed the secret itself. `vault.create_secret`
-- is a write the conductor runs once, out-of-band, against each environment
-- after this migration is deployed (see the PR description) — a migration
-- file is a record of schema, not of environment-specific values, and
-- hardcoding a hosted URL into a migration would recreate the exact problem
-- this file exists to remove. Locally, with no secret seeded, the getter
-- below falls back to the same `http://kong:8000` default the old GUC
-- fallback used, so local Tier B behaviour is unchanged.

-- ---------------------------------------------------------------------------
-- The getter
-- ---------------------------------------------------------------------------
-- `security definer`, deliberately: `vault.decrypted_secrets` is granted to
-- `postgres` (the role that owns this function once created, on both the
-- local stack and the hosted project) and to `service_role` — not to
-- `authenticated`, the role the trigger below actually runs as (it is
-- `security invoker`, unchanged). A plain `security invoker` getter called
-- from that trigger would fail to read the view at all; `security definer`
-- lets the getter run as its owner, `postgres`, for exactly this one read,
-- while `set search_path = ''` keeps every name in its body schema-qualified
-- so no caller-controlled schema can shadow `vault.decrypted_secrets`.
--
-- `stable`, not `volatile`: the answer only changes when the secret itself
-- is rewritten, which never happens inside the transaction that calls this.
--
-- Revoked from `public` and `anon` and granted only to `authenticated`,
-- because `authenticated` is the only role that ever needs it —
-- `sync_vehicle_cover_public_copy()` below is `security invoker` and runs as
-- whichever authenticated owner's write fired the trigger. Nothing anonymous
-- ever calls this.

create or replace function public.get_cover_storage_url()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select ds.decrypted_secret
       from vault.decrypted_secrets ds
      where ds.name = 'cover_storage_url'
      limit 1),
    'http://kong:8000'
  );
$$;

revoke all on function public.get_cover_storage_url() from public, anon;
grant execute on function public.get_cover_storage_url() to authenticated;

comment on function public.get_cover_storage_url() is
  'T2-404d: returns the Storage API base URL sync_vehicle_cover_public_copy() posts its copy request to. Exists because the hosted project''s non-superuser postgres role cannot persist the app.settings.storage_internal_url custom GUC (PG15+ refuses alter database … set for a non-superuser on a dotted parameter class), so the value instead lives in a Vault secret named cover_storage_url, seeded per-environment by vault.create_secret(...) out-of-band from this migration; falls back to the local kong gateway (http://kong:8000) when the secret is unset, which is always true on a fresh local stack.';

-- ---------------------------------------------------------------------------
-- The sync trigger, forwarded to read the URL from the getter above
-- ---------------------------------------------------------------------------
-- Byte-for-byte the version `20260907130000_vehicle_cover_photo_public_bucket.sql`
-- shipped, except the one line that resolved the GUC now calls
-- `public.get_cover_storage_url()` instead. Everything else — `security
-- invoker`, the removal-side `raise warning`, forwarding `request.headers`'
-- bearer token, every exception handler — is unchanged. `create or replace`
-- rather than editing the earlier file, for the same "a migration is a
-- record of what ran, not a live definition" reason that file's own comments
-- already give for `handle_vehicle_deleted` and `purge_expired_accounts`.

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
  -- A swallowed *removal* is not the same risk as a swallowed copy-in: a
  -- failed copy leaves the showcase card on its existing no-cover placeholder
  -- (the ruling's own accepted fallback), but a failed removal leaves a
  -- de-designated cover's public copy sitting at its stable, unauthenticated
  -- `/object/public/…` URL indefinitely — a privacy regression with no signal
  -- and no retry. The `storage.allow_delete_query` fix above already removed
  -- the one *known* cause (`storage.protect_delete` firing ahead of RLS), but
  -- anything else that can make a `delete` fail (a lock, a statement
  -- timeout, a future policy change) must not vanish the same way that bug
  -- once did: `raise warning` so it lands in logs, without turning a storage
  -- hiccup into a failed vehicle write.
  if old.cover_photo_path is not null then
    begin
      perform set_config('storage.allow_delete_query', 'true', true);
      delete from storage.objects
       where bucket_id = 'vehicle-cover-photos'
         and name = old.cover_photo_path;
    exception when others then
      raise warning
        'sync_vehicle_cover_public_copy: failed to remove public cover copy % from bucket vehicle-cover-photos: %',
        old.cover_photo_path, sqlerrm;
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
          url := public.get_cover_storage_url() || '/storage/v1/object/copy',
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
  'T2-404b/T2-404d: keeps vehicle-cover-photos in sync with cover_photo_path. Removal is a plain SQL delete that logs (raise warning) rather than silently swallows a failure, because a de-designated cover left world-readable is a privacy regression; the copy-in forwards the caller''s own PostgREST bearer token to the Storage API''s copy route (never a service key -- it transits pg_net''s net-schema queue/response tables, not a stored secret) and swallows any failure there, because GAR-01'' and SHR-01 do not depend on the copy succeeding. The Storage API base URL comes from public.get_cover_storage_url() (a Vault secret, environment-settable, falling back to the local kong gateway) rather than the app.settings.storage_internal_url GUC the hosted project cannot persist.';
