/**
 * A vehicle profile: the row, the form draft, and the crossing between them
 * (GAR-01′).
 *
 * > **GAR-01′** A user SHALL create vehicle profiles with a display name,
 * > taxonomy identity resolved by the 001 fitment engine, photos, and
 * > odometer.
 *
 * This module is pure: no DOM, no Supabase client, no `import.meta.env`. It is
 * where the rules about what a vehicle profile *is* live, so they can be
 * graded by `vehicle.test.ts` without a browser or a database, and so the page
 * component is left with markup and wiring — the same division
 * `VehicleSelector.astro` keeps against `src/lib/vehicle-options.ts`.
 *
 * ## Taxonomy identity: the quadruple, and why three quarters of it is
 * optional
 *
 * `tests/garage/contract.ts` declares `generation_id` `not null` and leaves
 * `market_id`, `model_year` and `engine_id` nullable. That is a decision, not
 * an oversight, and this module honours it literally: a user who knows they
 * have a Gen 3 and has never looked up whether their engine is a `6g74-sohc`
 * can still save a profile. Requiring the full quadruple would lock out the
 * owner GAR-01′ is written for.
 *
 * What a partial identity costs is stated rather than hidden: only a complete
 * quadruple can be handed to the 001 fitment engine as a
 * {@link StoredVehicleSelection}, so only a complete profile can drive the
 * site-wide selector (FIT-03). {@link vehicleSelectionOf} returns `null` for
 * the rest, and the page renders the difference.
 *
 * ## What this module does NOT decide
 *
 * Whether a generation/market/year/engine combination could have existed. That
 * question belongs to `src/lib/fitment/` and reaches this page through
 * `src/lib/vehicle-options.ts` — the same `createVehicleOptions` /
 * `selectionIsOfferable` pair T204's selector uses, reading the same inlined
 * taxonomy payload. Nothing here re-implements a millimetre of it (FIT-01).
 *
 * `drive` is deliberately absent from the row. The contract pins no column for
 * it, and a schema addition is not a drive-by edit (AGENTS.md); a profile
 * therefore stores FIT-03's quadruple and nothing else, and the selector's
 * optional drive facet stays where T204 put it.
 *
 * refs specs/002-montero-garage (GAR-01′, SHR-01), specs/001-foundation (FIT-01, FIT-03)
 */

import type { StoredVehicleSelection } from "../vehicle-selection.ts";
import {
  GENERATION_IDS,
  MARKETS,
  PRODUCTION_YEAR_RANGE,
  TAXONOMY_ID_PATTERN,
} from "../../schemas/vehicle-vocabulary.ts";
import {
  odometerInUnit,
  parseOdometer,
  type OdometerIssue,
  type OdometerUnit,
} from "./odometer.ts";

/**
 * The `vehicles` row as the browser sees it — exactly the columns
 * `tests/garage/contract.ts` pins, in `snake_case`, because that is what
 * PostgREST returns and renaming them on the way in would be a second place
 * for the schema to live.
 */
export interface VehicleRow {
  readonly id: string;
  readonly owner_id: string;
  readonly display_name: string;
  readonly generation_id: string;
  readonly market_id: string | null;
  readonly model_year: number | null;
  readonly engine_id: string | null;
  readonly odometer_km: number | null;
  /** Object paths in the private `vehicle-photos` bucket — see `./photos.ts`. */
  readonly photo_paths: readonly string[];
  /**
   * The designated cover, or `null` (GAR-01′, T2-306). Resolve it with
   * {@link resolveCoverPath} in `./cover.ts` — never by reading
   * `photo_paths[0]` — and never write it through {@link VehicleWrite}; see
   * that interface's own note on why the cover is a write of its own.
   */
  readonly cover_photo_path: string | null;
  readonly is_showcase_public: boolean;
  readonly is_worklog_public: boolean;
}

/**
 * The columns a create/update sends — the ones a *person* filled in.
 *
 * Not `owner_id`: `public.vehicles.owner_id` has no default, so the insert has
 * to carry it, but that is the data layer's job (it holds the session) and not
 * the form's. `src/lib/supabase/garage.ts` attaches the signed-in user's own
 * id, and the `with check ((select auth.uid()) = owner_id)` policy is what
 * makes any other value fail — the client is *asked* who it is and the
 * database decides whether to believe it.
 *
 * Not the share flags either: they default to `false` in the schema (SHR-01),
 * and a create path that transmits visibility is a create path where a typo
 * publishes somebody's truck.
 *
 * Not `photo_paths`: photos are added and removed one upload at a time,
 * against the storage bucket, and folding them into the profile form's save
 * would let a stale form field drop a photo somebody just added.
 *
 * Not `cover_photo_path` either, and for the same shape of reason: the "Set as
 * cover" / "Remove cover" controls write it on their own, through
 * `setVehicleCover` and `coverPhotoWrite` (`./cover.ts`), so a reader who opens
 * the profile in one tab, sets a cover in another, and saves the first cannot
 * revert the second (`./cover.test.ts` grades this exact guard).
 */
export interface VehicleWrite {
  readonly display_name: string;
  readonly generation_id: string;
  readonly market_id: string | null;
  readonly model_year: number | null;
  readonly engine_id: string | null;
  readonly odometer_km: number | null;
}

/** The form's working copy, all strings, exactly as the controls hold it. */
export interface VehicleDraft {
  readonly displayName: string;
  readonly gen: string;
  readonly market: string;
  readonly year: string;
  readonly engine: string;
  readonly odometer: string;
  readonly odometerUnit: OdometerUnit;
}

/**
 * The longest display name accepted.
 *
 * "Gitana Blanca" is thirteen characters. Sixty is room for a name, a nickname
 * and a plate; past that it is not a name any more, and a garage list of
 * paragraph-long headings is a garage nobody can scan.
 */
export const MAX_DISPLAY_NAME_LENGTH = 60;

/** Everything that can be wrong with a draft, as ids the page localizes. */
export type VehicleDraftIssue =
  | { readonly field: "displayName"; readonly code: "required" | "too-long" }
  | { readonly field: "gen"; readonly code: "required" | "unknown" }
  | { readonly field: "market"; readonly code: "unknown" }
  | { readonly field: "year"; readonly code: "out-of-range" }
  | { readonly field: "engine"; readonly code: "unknown" }
  | { readonly field: "odometer"; readonly code: OdometerIssue };

export const EMPTY_DRAFT: VehicleDraft = {
  displayName: "",
  gen: "",
  market: "",
  year: "",
  engine: "",
  odometer: "",
  odometerUnit: "km",
};

/**
 * Collapse the runs of whitespace a paste brings with it, and trim.
 *
 * Not a sanitiser — nothing here is interpolated as HTML; the page sets
 * `textContent`. It exists so `"  Gitana   Blanca "` and `"Gitana Blanca"` are
 * the same truck in a list sorted by name.
 */
export function normalizeDisplayName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isKnownGeneration(value: string): boolean {
  return (GENERATION_IDS as readonly string[]).includes(value);
}

function isKnownMarket(value: string): boolean {
  return (MARKETS as readonly string[]).includes(value);
}

/**
 * Every issue in `draft`, empty when it is saveable.
 *
 * Returns a list rather than the first problem, so a reader gets told about
 * both their empty name and their impossible year in one pass instead of
 * discovering them one save at a time.
 *
 * The vocabulary checks are shape checks — "is this plausibly a taxonomy id" —
 * exactly as `parseVehicleSelection` does them. Whether the *combination*
 * could have existed is the fitment engine's question, asked by the option
 * lists the form is built from, and it is not re-asked here.
 */
export function validateVehicleDraft(
  draft: VehicleDraft
): readonly VehicleDraftIssue[] {
  const issues: VehicleDraftIssue[] = [];

  const name = normalizeDisplayName(draft.displayName);
  if (name === "") issues.push({ field: "displayName", code: "required" });
  else if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    issues.push({ field: "displayName", code: "too-long" });
  }

  if (draft.gen === "") issues.push({ field: "gen", code: "required" });
  else if (!isKnownGeneration(draft.gen)) {
    issues.push({ field: "gen", code: "unknown" });
  }

  if (draft.market !== "" && !isKnownMarket(draft.market)) {
    issues.push({ field: "market", code: "unknown" });
  }

  if (draft.year !== "") {
    const year = Number(draft.year);
    if (
      !Number.isInteger(year) ||
      year < PRODUCTION_YEAR_RANGE.from ||
      year > PRODUCTION_YEAR_RANGE.to
    ) {
      issues.push({ field: "year", code: "out-of-range" });
    }
  }

  if (draft.engine !== "" && !TAXONOMY_ID_PATTERN.test(draft.engine)) {
    issues.push({ field: "engine", code: "unknown" });
  }

  const odometer = parseOdometer(draft.odometer, draft.odometerUnit);
  if (odometer.issue !== null) {
    issues.push({ field: "odometer", code: odometer.issue });
  }

  return issues;
}

/**
 * The row body for an insert or an update, or `null` when the draft has issues.
 *
 * See {@link VehicleWrite} for the three groups of columns that are
 * deliberately not in it.
 *
 * ## `previous`, and the odometer that walks
 *
 * On the edit path the caller passes the row being edited. It is used for
 * exactly one thing: when the odometer field still reads what
 * {@link draftFromVehicleRow} put there, the stored kilometres are carried
 * over **unconverted**.
 *
 * Without that, a reader whose display unit is miles would rewrite the row
 * every time they saved a change to the *name*: 247 500 km renders as 153 790
 * mi, which converts back to 247 501 km, and the next save makes it 247 502.
 * A figure nobody touched must come back out as the figure that went in, so
 * the untouched case does not go through a conversion at all.
 */
export function vehicleWriteFromDraft(
  draft: VehicleDraft,
  previous: VehicleRow | null = null
): VehicleWrite | null {
  if (validateVehicleDraft(draft).length > 0) return null;

  const untouched =
    previous !== null &&
    draft.odometer ===
      draftFromVehicleRow(previous, draft.odometerUnit).odometer;
  const odometerKm = untouched
    ? previous.odometer_km
    : parseOdometer(draft.odometer, draft.odometerUnit).km;

  return {
    display_name: normalizeDisplayName(draft.displayName),
    generation_id: draft.gen,
    market_id: draft.market === "" ? null : draft.market,
    model_year: draft.year === "" ? null : Number(draft.year),
    engine_id: draft.engine === "" ? null : draft.engine,
    odometer_km: odometerKm,
  };
}

/** A stored row, back in the form's shape, for the edit path. */
export function draftFromVehicleRow(
  row: VehicleRow,
  unit: OdometerUnit
): VehicleDraft {
  return {
    displayName: row.display_name,
    gen: row.generation_id,
    market: row.market_id ?? "",
    year: row.model_year === null ? "" : String(row.model_year),
    engine: row.engine_id ?? "",
    odometer:
      row.odometer_km === null
        ? ""
        : String(odometerInUnit(row.odometer_km, unit)),
    odometerUnit: unit,
  };
}

/**
 * The row as a selection the 001 fitment engine will accept, or `null`.
 *
 * `null` is the honest answer for a partial identity: FIT-03's contract is a
 * complete quadruple, `parseVehicleSelection` rejects anything less, and
 * handing the engine three quarters of a truck would filter listings against a
 * vehicle nobody described.
 *
 * This is the seam `src/lib/vehicle-selection.ts` predicted — "when user
 * accounts land, a signed-in visitor's garage vehicle becomes the better
 * source" — so the value returned here is written through
 * `writeVehicleSelection` unchanged, not through a second storage path.
 */
export function vehicleSelectionOf(
  row: VehicleRow
): StoredVehicleSelection | null {
  if (row.market_id === null || row.engine_id === null) return null;
  if (row.model_year === null) return null;
  if (!isKnownGeneration(row.generation_id)) return null;
  if (!isKnownMarket(row.market_id)) return null;
  if (!TAXONOMY_ID_PATTERN.test(row.engine_id)) return null;
  if (
    !Number.isInteger(row.model_year) ||
    row.model_year < PRODUCTION_YEAR_RANGE.from ||
    row.model_year > PRODUCTION_YEAR_RANGE.to
  ) {
    return null;
  }
  return {
    gen: row.generation_id,
    market: row.market_id,
    year: row.model_year,
    engine: row.engine_id,
  };
}

/**
 * The photo objects that really belong to this vehicle.
 *
 * `photo_paths` is an array a client wrote, so it is an array a client can get
 * wrong — a stale tab, a failed upload half-recorded, or a row edited by hand
 * in the dashboard. Rendering a path that points outside `<owner>/<vehicle>/`
 * would at best 404 and at worst ask the storage API for somebody else's
 * object on the owner's behalf, so the list is filtered against the row it
 * came from before anything is signed.
 *
 * (The filter is a correctness measure, not the access control: the bucket's
 * policies already refuse any object whose first path segment is not the
 * caller. This stops a wrong path from being *asked for*.)
 */
export function vehiclePhotoPaths(row: VehicleRow): string[] {
  const prefix = `${row.owner_id}/${row.id}/`;
  return row.photo_paths.filter(
    (path) =>
      path.startsWith(prefix) && !path.slice(prefix.length).includes("/")
  );
}

/**
 * Vehicles in the order a garage list shows them: by display name, folded and
 * accent-aware, then by id so the order never depends on what the database
 * felt like returning.
 */
export function sortVehicles(
  rows: readonly VehicleRow[],
  locale: string
): VehicleRow[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  return [...rows].sort(
    (left, right) =>
      collator.compare(left.display_name, right.display_name) ||
      left.id.localeCompare(right.id)
  );
}
