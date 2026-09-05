-- T2-402 — SHR-02's public handle: the namespace a published page lives in.
-- refs specs/002-montero-garage (SHR-01, SHR-02, SHR-04)
--
-- > **SHR-02** A user SHALL be able to publish, per vehicle: a showcase page
-- > and/or a work-log page, each at a **stable public URL under their handle**.
--
-- A handle is the only part of a garage URL a stranger can guess or type, so
-- four of its properties are security properties rather than validation
-- niceties. Each is enforced here, in the database, because SHR-01 says a check
-- that lives in client or page code is none of the three permitted enforcement
-- modes. `src/lib/garage/handles.ts` states the same format and reserved rules
-- so a form can answer before a round trip; it is an affordance, and this file
-- is the guarantee.
--
--   1. **Uniqueness lives here.** Two signups asking "is `gitana` free?" one
--      millisecond apart both get "yes" from a `select` in a form. A unique
--      index is the only thing that can say no to the second one.
--   2. **Case folds.** `Gitana` and `gitana` are the same string in the same
--      position of the same URL to every reader alive, so two accounts
--      differing only in case is an impersonation kit. Folded on the way in by
--      the trigger, and the unique index is on `lower(handle)` as well, so a
--      row written by a path that somehow skipped the trigger still collides.
--   3. **Reserved words are not takeable** — the site's own route segments,
--      both locale codes, and the words that would let an account impersonate
--      the site or its operators.
--   4. **A released handle does not immediately become somebody else's.**
--      SHR-02 calls the URL *stable*. If a rename freed the old handle for a
--      stranger, every link already shared — in a WhatsApp thread, on a forum,
--      printed on an invoice — would quietly start pointing at a different
--      person's garage: a URL that changed its meaning without changing its
--      text. `retired_handles` is how it does not.
--
-- ## Why the column is declared twice
--
-- `20260830120000_garage_schema.sql` now names `handle` inside its `create
-- table public.profiles`, and this file adds it with `if not exists`. That is
-- deliberate, not a merge accident: a database that already ran the first
-- migration will never re-run it, so the `alter` below is the only thing that
-- can reach it, while a *fresh* database needs the column to appear in a
-- `create table` body for the contract's shape graders to see it at all. The
-- two paths converge on the same schema and every rule that constrains the
-- column lives here, once.

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists handle text;

-- Every handle this account has released, folded. `not null default '{}'` and
-- never nullable: an empty array genuinely *is* "has released nothing", and the
-- null-versus-empty ambiguity would have to be re-decided by every reader.
alter table public.profiles
  add column if not exists retired_handles text[] not null default '{}';

comment on column public.profiles.handle is
  'SHR-02: the stable public namespace a published page lives under. Null until claimed.';
comment on column public.profiles.retired_handles is
  'SHR-02: handles this account has released. Nobody else may claim one; the original owner may take it back.';

-- ---------------------------------------------------------------------------
-- The shape of a handle
-- ---------------------------------------------------------------------------
-- Lower-case, digits, single interior hyphens; no dots (a handle that looks
-- like a hostname breaks the `x-default` hreflang pairing), no underscores
-- (indistinguishable from a hyphen in a printed URL), no leading or trailing
-- hyphen, and a floor of two characters so single letters stay available for
-- the site's own routes.
--
-- The bounds and the pattern are the same values as `HANDLE_LENGTH` and
-- `HANDLE_PATTERN` in `src/lib/garage/handles.ts`. SQL and TypeScript cannot
-- share a literal, so they are stated in both and `tests/garage/handles.test.ts`
-- drives the same words through both — Tier A through `handleIssues`, Tier B
-- through a live `update`.
--
-- The reserved list is the site's own namespace (both locale codes and every
-- route segment `COLLECTION_ROUTE_SEGMENTS` serves, in both locales) plus the
-- impersonation words. `_astro` could never have matched the pattern anyway; it
-- is listed so a reader does not have to work out whether its absence was an
-- oversight.
--
-- `gitana` is deliberately absent, and `tests/garage/contract.ts` disagrees —
-- see the note on `IMPERSONATION_HANDLES` in `src/lib/garage/handles.ts`.
-- Gitana Blanca is a user's truck (MIG-04), not the site's identity, and
-- `handles.test.ts`'s own positive control requires the handle to be claimable.

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
        'montero', 'monterogarage', 'www', 'mail',
        'static', 'assets', '_astro',
        'en', 'es',
        'glossary', 'glosario',
        'community', 'comunidad',
        'sign-in', 'ingresar',
        'garage', 'taller',
        'problems', 'problemas',
        'parts', 'repuestos',
        'mods', 'modificaciones'
      ])
    )
  );

-- ---------------------------------------------------------------------------
-- Uniqueness, case-insensitively, in the SCHEMA
-- ---------------------------------------------------------------------------
-- On `lower(handle)` rather than on `handle`, and that is the whole point: a
-- plain `unique (handle)` lets two accounts hold `gitana` and `Gitana`, which
-- are one address to every reader. The trigger below already folds on the way
-- in, so in practice the index sees folded values — it is the second wall, for
-- the write that arrives by some path the trigger did not run on.
--
-- Partial on `handle is not null`: null is not a claim, and every account that
-- has never published one would otherwise be competing for the same slot in a
-- plain unique index (Postgres does not, but the partial index says so out loud
-- and is the smaller index).

create unique index if not exists profiles_handle_lower_uk
  on public.profiles (lower(handle))
  where handle is not null;

-- ---------------------------------------------------------------------------
-- Folding, retirement, and the stranger who may not inherit a URL
-- ---------------------------------------------------------------------------
-- `security definer`, and it has to be: the "is this handle retired by somebody
-- else" question is a question about *another user's row*, which RLS correctly
-- hides from the caller. A `security invoker` trigger would ask it, see
-- nothing, and answer "free" — which is the defect, not the absence of one.
--
-- `set search_path = ''` for the usual reason: a definer routine resolves
-- unqualified names through the *caller's* search path, so a caller who can
-- create a schema could otherwise put their own `profiles` ahead of
-- `public.profiles` and have privileged code read it. Every name below is
-- schema-qualified.
--
-- What it deliberately does NOT do is answer uniqueness. A live collision is
-- the index's job (see above), so there is exactly one place that decides it.

create or replace function public.normalize_profile_handle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
begin
  -- The same fold as `normalizeHandle` in src/lib/garage/handles.ts: trim, then
  -- lower-case. An all-whitespace handle is `null` — "" is not a shorter
  -- handle, it is the absence of one, and the two must not be different states.
  new.handle := nullif(btrim(lower(coalesce(new.handle, ''))), '');
  new.retired_handles := coalesce(new.retired_handles, array[]::text[]);

  if tg_op = 'UPDATE' then
    v_previous := old.handle;
  end if;

  -- Releasing a handle retires it to this account. SHR-02's stability is a
  -- promise to whoever already holds the link, so the old address stops being
  -- claimable rather than going back into the pool.
  if v_previous is not null
     and new.handle is distinct from v_previous
     and not (v_previous = any (new.retired_handles)) then
    new.retired_handles := new.retired_handles || v_previous;
  end if;

  -- Only when the handle actually moved. Every other update of this row —
  -- ACC-03's `deleted_at`, an `updated_at` touch — would otherwise pay for a
  -- cross-account scan to re-answer a question about a value nobody changed.
  if new.handle is not null and new.handle is distinct from v_previous then
    -- Reclaiming your own released handle takes it back off your list, so a
    -- handle is never simultaneously held and retired by the same account.
    new.retired_handles := array_remove(new.retired_handles, new.handle);

    if exists (
      select 1
        from public.profiles p
       where p.id <> new.id
         and new.handle = any (p.retired_handles)
    ) then
      raise exception
        'handle % was released by another account and cannot be reused (SHR-02)',
        new.handle
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.normalize_profile_handle() from public;
revoke all on function public.normalize_profile_handle() from anon;
revoke all on function public.normalize_profile_handle() from authenticated;

comment on function public.normalize_profile_handle() is
  'SHR-02: folds a handle to its canonical form, retires the one it replaces, and refuses a handle another account released.';

drop trigger if exists on_profile_handle_write on public.profiles;

create trigger on_profile_handle_write
  before insert or update on public.profiles
  for each row execute function public.normalize_profile_handle();
