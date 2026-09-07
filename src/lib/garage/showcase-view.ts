/**
 * The public showcase/work-log pages' view seam — declared by T2-404c
 * [TEST], to be filled by T2-404b [PLATFORM].
 *
 * > **SHR-02** A user SHALL be able to publish, per vehicle: a showcase page
 * > and/or a work-log page, each at a **stable public URL under their
 * > handle**, bilingual chrome, user content in whatever language the user
 * > wrote.
 * > **SHR-03** Costs and receipts SHALL stay private even on a public
 * > work-log unless opened per record.
 * > **SHR-04** Public pages SHALL carry the reference site's chrome and
 * > design (HANDOFF-DESIGN.md) and hreflang per 001 I18N-04.
 *
 * ## What this module is, and what it deliberately is not
 *
 * `src/lib/garage/visibility.ts` already answers *"what may the world see of
 * one record"* (`Principal { kind: "world" }`), and `tests/garage/
 * public-pages.test.ts` already grades that answer — cost omission, receipt
 * denial, the two-switch structure. This module does not re-answer that
 * question; {@link resolveShowcasePage} is required to *delegate* to
 * `maskRecordsForPrincipal` for the work-log case, and this file's own
 * graders assert exactly that delegation (equality against the real
 * function's output), not a second copy of the masking rule.
 *
 * What *is* new here, and has no other home yet:
 *
 *  1. **Handle → vehicle resolution**, including the retired-handle rule
 *     `20260903120100_public_handles.sql` states in its own column comment:
 *     "Nobody else may claim one; the original owner may take it back." A
 *     handle that only exists in some profile's `retired_handles` is not a
 *     live page for *anybody* — not the profile that retired it (that
 *     profile is reached by its *current* handle, not the old one) and
 *     never a stranger who could not have claimed the word in the first
 *     place. {@link resolveShowcasePage} returns `"handle-retired"` for that
 *     case, never a resolved vehicle.
 *  2. **The per-vehicle publication gate** (`is_showcase_public` /
 *     `is_worklog_public`) at the page-selection boundary — which record
 *     masking assumes has already happened (`visibility.ts`'s own
 *     `mayReadRecord` reads `vehicle.is_worklog_public` too, but a page that
 *     never calls it at all for the showcase-only case has nothing to catch
 *     the mistake).
 *  3. **Route construction** for the two nested URL levels SHR-02 asks for
 *     under `handles.ts`'s existing `/{locale}/{garage segment}/{handle}/`:
 *     `…/{vehicleId}/` (showcase) and `…/{vehicleId}/{log segment}/`
 *     (work-log) — nested exactly one level deeper each time, the same shape
 *     `handles.ts` already documents for the index page it owns.
 *  4. **The placeholder-rewrite canonical/hreflang problem.** 001 SCF-01
 *     forbids SSR and handles are unknown at build time, so (per the
 *     existing `[shareSegment].astro` precedent) these pages are built once
 *     per locale at a placeholder path and reached in production through a
 *     `vercel.json` rewrite. `BaseLayout`'s `<link rel="canonical">` and
 *     `<link rel="alternate" hreflang>` tags are emitted from the *build-time*
 *     route, which is the placeholder — correct for `noindex`ed
 *     `[shareSegment].astro`, wrong here: SHR-04 wants this surface
 *     `hreflang`-correct and (unlike the accountless share link) nothing
 *     marks it `noindex`, so a canonical left pointing at the shared
 *     placeholder would tell a crawler that every distinct owner's showcase
 *     page is a duplicate of one URL. The same build-time value also reaches
 *     `LocaleSwitcher.astro`'s `[data-locale-choice]` anchors — they are
 *     server-rendered from the same `routePathByLocale` prop `BaseLayout`
 *     reads for hreflang — so a reader who switches language on a *live*
 *     showcase page would otherwise be sent back to the shared placeholder in
 *     the other locale instead of this vehicle's own page there.
 *     {@link applyResolvedShowcaseLinks} is the seam a page's client script
 *     must call, once the handle and vehicle id are known, to rewrite both
 *     the `<head>` tags and the switcher's anchors to the real address.
 *
 * ## Expected-failure convention
 *
 * Every export below throws {@link SHOWCASE_SEAM_NOT_IMPLEMENTED}. T2-404b
 * replaces the throw with the real logic and, in `tests/pages/
 * showcase-worklog.render.test.ts`, deletes exactly the `.fails` marker on
 * each grader that logic satisfies — never edits an assertion (AGENTS.md's
 * activation convention; T801's `computeSyncPlan` is the precedent this
 * module follows).
 *
 * refs specs/002-montero-garage (SHR-02, SHR-03, SHR-04, SHR-09),
 * specs/001-foundation (SCF-01, I18N-04),
 * specs/001-foundation/design/HANDOFF-DESIGN.md
 */
import type { Locale, LocalizedRoutePaths } from "../../i18n/routing.ts";
import type { RecordRow } from "./record.ts";
import type { VehicleRow } from "./vehicle.ts";
import type { VisibleRecord } from "./visibility.ts";

/** Thrown by every export in this module until T2-404b fills the seam. */
export const SHOWCASE_SEAM_NOT_IMPLEMENTED = "not implemented: T2-404b";

function notImplemented(): never {
  throw new Error(SHOWCASE_SEAM_NOT_IMPLEMENTED);
}

/** Which of the two published surfaces SHR-02 names is being resolved. */
export type ShowcasePageKind = "showcase" | "worklog";

/**
 * Why a resolution refused to name a vehicle at all.
 *
 * Every member is a *refusal*, and {@link ShowcaseResolution}'s `ok: false`
 * branch carries nothing else — no vehicle, no partial data — because "the
 * word does not currently name a public page" and "here is some of what it
 * names" must never be the same shape to render against (the T601-F2 lesson,
 * one surface over: a grader — or a template — that can be satisfied by a
 * *wrong* value is worse than one that cannot be satisfied at all).
 */
export type ShowcaseRefusalReason =
  | "handle-unknown"
  | "handle-retired"
  | "vehicle-unknown"
  | "showcase-private"
  | "worklog-private";

export interface ShowcaseRefusal {
  readonly ok: false;
  readonly reason: ShowcaseRefusalReason;
}

/** A resolved showcase page: the vehicle, and nothing about its history. */
export interface ShowcaseFound {
  readonly ok: true;
  readonly page: "showcase";
  readonly vehicle: VehicleRow;
}

/**
 * A resolved work-log page: the vehicle and its history, already masked for
 * the world (SHR-03, SHR-06's omission rule).
 *
 * `records` is required to equal
 * `maskRecordsForPrincipal({ records, vehicle, principal: { kind: "world" } })`
 * over the full record set a world reader is entitled to fetch — see the
 * module note. Nothing here re-derives that answer.
 */
export interface WorklogFound {
  readonly ok: true;
  readonly page: "worklog";
  readonly vehicle: VehicleRow;
  readonly records: readonly VisibleRecord[];
}

export type ShowcaseResolution = ShowcaseRefusal | ShowcaseFound | WorklogFound;

/**
 * One profile's public surface: its **current** handle, the handles it has
 * released (SHR-02's stability guarantee, `profiles.retired_handles`), and
 * the vehicles it owns. Not `ProfileRow` from `src/lib/supabase/garage.ts` —
 * that type is the *signed-in owner's own* read of their profile and has no
 * reason to carry `retired_handles`; this is the shape a world-facing
 * directory needs, which is a different question asked by a different
 * reader.
 */
export interface PublicProfileDirectory {
  readonly handle: string;
  readonly retiredHandles: readonly string[];
  readonly vehicles: readonly VehicleRow[];
}

/**
 * Resolve one URL's worth of public showcase/work-log data.
 *
 * `handle` and `vehicleId` are exactly the two path parameters the URL shape
 * in T2-404b's task brief carries (`/{locale}/{garage}/{handle}/{vehicleId}/`
 * and its `/{log|historial}/` child); `profiles`/`records` stand in for
 * whatever the real anon RPC path returns — this function's job is the
 * *decision*, not the fetch.
 *
 * Refusal order matters and is part of the contract graded below:
 * `handle-retired` is checked before falling through to `handle-unknown`, so
 * a retired handle is never reported as merely absent (a distinction a
 * reviewer debugging "why does my old link 404" needs, even though both
 * render the same refused page to a reader — SHR-08's "one refusal, same
 * shape" rule is about a *bearer-token* surface's existence-oracle risk, and
 * a handle is not a secret, so this module is free to keep the reason
 * distinct internally while the page renders one generic "not published"
 * state for both, same as `[shareSegment].astro` folds unknown/expired/
 * revoked into one sentence for its own — different — reason).
 */
export function resolveShowcasePage(input: {
  readonly profiles: readonly PublicProfileDirectory[];
  readonly records: readonly RecordRow[];
  readonly handle: string;
  readonly vehicleId: string;
  readonly page: ShowcasePageKind;
}): ShowcaseResolution {
  void input;
  return notImplemented();
}

/**
 * The showcase page's route in `locale`, **without** the locale prefix —
 * nested one level under `handleRoutePath` (`src/lib/garage/handles.ts`),
 * the same way every other route builder in this repo composes with the
 * registry it extends.
 */
export function showcaseRoutePath(
  handle: string,
  vehicleId: string,
  locale: Locale
): string {
  void handle;
  void vehicleId;
  void locale;
  return notImplemented();
}

/** Every locale's showcase route for one vehicle, for hreflang and the switcher. */
export function showcaseRoutePaths(
  handle: string,
  vehicleId: string
): LocalizedRoutePaths {
  void handle;
  void vehicleId;
  return notImplemented();
}

/**
 * The work-log page's route in `locale` — one level under
 * {@link showcaseRoutePath}, in that locale's own word for it (`log` /
 * `historial`, T2-404b's task brief).
 */
export function worklogRoutePath(
  handle: string,
  vehicleId: string,
  locale: Locale
): string {
  void handle;
  void vehicleId;
  void locale;
  return notImplemented();
}

/** Every locale's work-log route for one vehicle. */
export function worklogRoutePaths(
  handle: string,
  vehicleId: string
): LocalizedRoutePaths {
  void handle;
  void vehicleId;
  return notImplemented();
}

/**
 * Rewrite a rendered document's canonical and hreflang `<link>` tags from
 * the build-time placeholder route to the real, resolved one.
 *
 * See the module note's point 4. `doc` is handed in rather than read off
 * `window.document` so this is callable from a JSDOM test without a real
 * browser (the same shape `enhanceProceduresIndex` and every other DOM seam
 * in this repo takes its root/window explicitly). The contract:
 *
 *  - exactly one `<link rel="canonical">` remains, and its `href` resolves
 *    `routes[locale]` — not `Astro.url.pathname`, which at request time is
 *    still the rewritten placeholder;
 *  - exactly one `<link rel="alternate" hreflang="en">` and one
 *    `hreflang="es"` remain, each resolving that locale's entry in `routes`;
 *  - exactly one `<link rel="alternate" hreflang="x-default">` remains,
 *    resolving `routes.en` (`DEFAULT_LOCALE`, `src/i18n/routing.ts`);
 *  - every `[data-locale-choice]` anchor (`LocaleSwitcher.astro`'s own hook)
 *    has its `href` rewritten to `localeHref(thatAnchor's own locale,
 *    routes[thatAnchor's own locale])` — the switcher on a live showcase page
 *    must cross to *this vehicle's* page in the other locale, not back to
 *    the shared placeholder every locale's build shares;
 *  - nothing in the returned document still points at the placeholder route
 *    it was rendered with — the specific leak this seam exists to close.
 */
export function applyResolvedShowcaseLinks(input: {
  readonly doc: Document;
  readonly routes: LocalizedRoutePaths;
  readonly locale: Locale;
}): void {
  void input;
  notImplemented();
}
