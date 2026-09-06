-- T2-306 — the cover-photo designation (GAR-01′, owner-approved addition
-- 2026-09-02). refs specs/002-montero-garage (GAR-01′, SHR-01)
--
-- > **GAR-01′** … A user SHALL be able to designate one uploaded photo as the
-- > vehicle's **cover photo**, rendered wherever the vehicle is shown as a
-- > single item — the garage vehicle list, and any future showcase-page card
-- > (SHR-02). Removing the designated cover photo SHALL leave the vehicle
-- > with no cover rather than silently promoting another one; a vehicle with
-- > photos but no cover renders the same placeholder image used when the
-- > vehicle has no photos.
--
-- `tests/garage/contract.ts` and `tests/garage/cover-photo.test.ts` are
-- T2-306a [TEST]'s graders, written before this file, from the spec, by an
-- instance that does not implement it (AGENTS.md separation rule; T901 audits
-- it through the commit trailer). This migration is what makes them green;
-- the reasoning below repeats what is already argued at length in both files
-- only where it decides something this DDL has to spell out.
--
-- ## The column: nullable, no default, a path not an index
--
-- `cover_photo_path text`, not `cover_photo_index int`: an index into a
-- client-written array names a different photo after any removal, and a
-- stale index is indistinguishable from a fresh one. Nullable with no
-- default — "no photos", "photos but no cover chosen" and "the cover just
-- departed" are all the same null, and a default (`photo_paths[1]`, say)
-- would be the silent promotion GAR-01′ forbids, spelled as DDL and applied
-- to every vehicle ever created.
--
-- ## Membership is enforced here, not in the page
--
-- A cover naming a photo the vehicle does not have is a defect ("not a user
-- error to accept silently" — the task line's own words), and the two
-- columns that decide it both live on this row, so the check belongs here
-- and nowhere upstream of it (SHR-01: a check in client or page code is none
-- of the three permitted enforcement modes).
--
-- ## The clearing trigger is scoped to a *departure*
--
-- A `before` trigger that clears whenever the cover is not a member would run
-- ahead of the check constraint above and swallow the very defect this
-- migration exists to refuse: a freshly written bogus designation gets
-- nulled instead of rejected, and the owner who clicked "set as cover" sees
-- no error and gets no cover (T2-306a review, F1 — caught by shipping this
-- exact shape as a migration and watching a live stack accept it). Consulting
-- `old.cover_photo_path` restricts the clearing to the one case it is *for* —
-- `photo_paths` moved underneath a designation nobody touched — and leaves a
-- fresh write for the constraint to judge. `is not distinct from`, not `=`,
-- because both sides are nullable and `null = null` is null, which is not a
-- match.

alter table public.vehicles
  add column if not exists cover_photo_path text;

comment on column public.vehicles.cover_photo_path is
  'GAR-01'': the one photo path designated as this vehicle''s cover. Null means no cover, whichever of three reasons applies (no photos, none chosen, or a departed designation cleared rather than promoted) — that distinction is a rendering concern, not a storage one. Membership in photo_paths is enforced by vehicles_cover_photo_path_ck; a departure is cleared, never promoted, by clear_departed_vehicle_cover().';

-- ---------------------------------------------------------------------------
-- Membership: a cover the vehicle does not have cannot be stored
-- ---------------------------------------------------------------------------

alter table public.vehicles
  drop constraint if exists vehicles_cover_photo_path_ck;

alter table public.vehicles
  add constraint vehicles_cover_photo_path_ck
  check (cover_photo_path is null or cover_photo_path = any (photo_paths));

-- ---------------------------------------------------------------------------
-- Clearing: a departed cover is nulled, never promoted, and only on departure
-- ---------------------------------------------------------------------------
-- No elevated privilege is needed here, unlike `handle_vehicle_deleted` or
-- `normalize_profile_handle` in the neighbouring migrations: this trigger
-- reads and writes only the row it was already granted to update, never
-- another user's row and never storage. Plain `security invoker` is correct,
-- not an oversight.
--
-- The `revoke`s below are a separate concern from that, and every function in
-- this file's neighbours carries the same three: Postgres grants `execute` on
-- a freshly created function to `public` by default, trigger function or not,
-- and a function nobody is meant to call directly stays that way only if this
-- says so. Nothing calls this one except the trigger below, which runs as
-- part of the `update` the row's own policy already allowed.

create or replace function public.clear_departed_vehicle_cover()
returns trigger
language plpgsql
as $$
begin
  if new.cover_photo_path is not null
     and new.cover_photo_path is not distinct from old.cover_photo_path
     and not (new.cover_photo_path = any (new.photo_paths)) then
    new.cover_photo_path := null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_departed_vehicle_cover() from public;
revoke all on function public.clear_departed_vehicle_cover() from anon;
revoke all on function public.clear_departed_vehicle_cover() from authenticated;

comment on function public.clear_departed_vehicle_cover() is
  'GAR-01'': when photo_paths changes underneath an untouched cover designation and the cover departs, clears it to null instead of promoting another photo. Scoped to departures by consulting old.cover_photo_path, so a freshly written bogus designation still reaches vehicles_cover_photo_path_ck rather than being silently nulled (T2-306a review, F1).';

drop trigger if exists on_vehicle_cover_departure on public.vehicles;

create trigger on_vehicle_cover_departure
  before update on public.vehicles
  for each row execute function public.clear_departed_vehicle_cover();
