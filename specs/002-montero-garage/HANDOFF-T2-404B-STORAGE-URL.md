# HANDOFF T2-404b — the hosted Storage API's internal URL (owner action)

**To:** the owner. **From:** T2-404b (cover-photo public-bucket half,
implementer).
**Status:** everything in the repository is done and Tier-B-proven against a
local stack. One setting is not, because it needs the hosted project's own
identity and neither an agent nor CI has one.

## What this is for

`sync_vehicle_cover_public_copy()` (`supabase/migrations/20260907130000_vehicle_cover_photo_public_bucket.sql`)
copies a newly designated cover photo into the public `vehicle-cover-photos`
bucket by calling the Storage API's `/object/copy` route from inside a
Postgres trigger, via `pg_net`. It needs a base URL to call, and the correct
one is different on the local stack (where this migration was proven) and on
the hosted project:

- **Local (`supabase start`):** a trigger runs inside the `db` container,
  where `127.0.0.1` is itself, not the host's port mapping. The right target
  is `kong`, the local stack's internal gateway container — reachable at
  `http://kong:8000` on the Docker network `supabase start` creates, which the
  function already defaults to.
- **Hosted:** there is no `kong` hostname to resolve, and no reason to expect
  one — hosted Supabase's internal topology is not this migration's to guess
  at. What every hosted project *does* publish, and what this function should
  use there instead, is the same public API URL the site's own
  `PUBLIC_SUPABASE_URL` already points at
  (`https://<ref>.supabase.co` — see `HANDOFF-T2-202-SUPABASE.md` Step 4).
  Postgres on a hosted Supabase project has outbound internet access, and
  `https://<ref>.supabase.co/storage/v1/…` is the same route the browser
  itself would call.

## The one-time step

In the SQL editor on the hosted project, once the project ref is known:

```sql
alter database postgres set app.settings.storage_internal_url = 'https://<ref>.supabase.co';
```

`current_setting('app.settings.storage_internal_url', true)` is read fresh on
every trigger firing (not cached at migration time), so this can be set
before or after `supabase db push` runs T2-404b's migration, in either order,
and takes effect on the next cover designation either way.

**Verify:** designate a cover photo for a real vehicle, wait a few seconds
(the call is asynchronous — see the migration's own comment on why), then
fetch `https://<ref>.supabase.co/storage/v1/object/public/vehicle-cover-photos/<the same path>`
with no credentials. It should serve the photo.

## Why this is not blocking

Per the owner ruling this task shipped against (`tasks.md`, T2-404b, the
cover-photo ruling): "Until this ships, the showcase renders the same
no-cover placeholder a photo-less vehicle already gets — that fallback is not
itself blocking." The trigger's own exception handling makes the same true of
this one setting specifically: if `app.settings.storage_internal_url` is
unset, wrong, or `pg_net` cannot reach it, the copy call fails silently and
the cover **designation itself still succeeds** — `cover_photo_path` is set,
the owner-facing garage still renders the cover through its own signed-URL
path (unaffected by any of this), and the public showcase card falls back to
the placeholder until the copy lands. Nothing about GAR-01′ or SHR-02 depends
on this call succeeding; it only decides whether the *public* showcase card
shows the photo or the placeholder in the meantime.

## What was NOT built, deliberately

No service key, no hardcoded credential, anywhere in this migration —
`sync_vehicle_cover_public_copy()` forwards the caller's own already-validated
PostgREST bearer token to the Storage API, authenticating the copy as the
same owner whose update just fired the trigger and nothing wider (see the
migration's own header comment for the full argument and how it was proven
live). This handoff exists only to tell Postgres *where* to send that
forwarded token on the hosted project — it grants nothing new.
