/**
 * Rendering PRC-03's figures — the `reference` rows a procedure cites by id,
 * turned into the strings its page shows.
 *
 * > **PRC-03** IF a procedure cites a torque or fluid spec, THEN THE value
 * > SHALL come from shared reference data by ID, never inlined per-locale.
 *
 * The by-ID rule is only half a promise until something renders the number the
 * id points at. This module is the other half: given a procedure's `specs[]`
 * and the `reference` collection, it produces one row per cited id carrying the
 * entry's own per-locale title and the figures **read out of that entry**. The
 * number therefore exists exactly once in the repository, and both locales'
 * pages are rendered from that one copy — which is the property PRC-03 is
 * about, and the property a page that re-typed the figure would quietly lose.
 *
 * ## Why the unit symbols are not in the UI-strings module
 *
 * `N·m` is not prose. It is the SI symbol, identical in English and in Costa
 * Rican Spanish, and AGENTS.md's rule is that a locale-independent value is
 * stored once and never per-locale. The *stored* unit is an id from
 * `src/schemas/reference.ts`' closed vocabularies (`nm`, `us-qt`, `deg`) —
 * lowercase and hyphenated so nothing can spell it two ways — and this table
 * is the one place those ids become the symbol a reader recognises. Putting it
 * in `src/i18n/ui.ts` would create two translations of a symbol that has one
 * form, which is exactly the duplication the split exists to prevent.
 *
 * The *number* beside it is formatted with `Intl.NumberFormat` in the page
 * locale, so a Costa Rican reader sees `4,5 L` and an English reader `4.5 L`.
 * That is rendering, not storage: one stored figure, two renderings.
 *
 * ## Unresolved is not blank
 *
 * A cited id that names no `reference` entry comes back `resolved: false` and
 * the page says so, rather than rendering an empty row.
 * `src/integrations/validate-procedures.ts` refuses that corpus at build time,
 * so this is defense-in-depth — but "we could not find the figure" must never
 * render as the confident absence of one (`.claude/GRADER-PRINCIPLES.md`,
 * "unknown is not zero").
 *
 * refs specs/001-foundation (PRC-01, PRC-03, REF-01)
 */

/**
 * Stored unit id → the symbol it is printed as.
 *
 * Every key is a member of one of `src/schemas/reference.ts`' unit
 * vocabularies (`TORQUE_UNITS`, `VOLUME_UNITS`, `DIMENSION_UNITS`). A unit with
 * no entry here renders as its stored id, which is ugly and honest — far better
 * than a blank where a unit belongs.
 */
export const UNIT_SYMBOLS: Readonly<Record<string, string>> = {
  // Torque
  nm: "N·m",
  "kgf-m": "kgf·m",
  "lbf-ft": "lb-ft",
  "lbf-in": "lb-in",
  // Volume
  l: "L",
  ml: "mL",
  cc: "cc",
  "us-qt": "US qt",
  "us-gal": "US gal",
  "imp-qt": "imp qt",
  "imp-gal": "imp gal",
  // Length, mass, angle
  mm: "mm",
  cm: "cm",
  m: "m",
  in: "in",
  ft: "ft",
  kg: "kg",
  lb: "lb",
  deg: "°",
};

/** The unit's printed symbol, or the stored id when nothing maps it. */
export function unitSymbol(unit: string): string {
  return UNIT_SYMBOLS[unit] ?? unit;
}

/** A figure as `reference` stores it — `quantitySchema`'s three forms. */
export interface StoredQuantity {
  readonly value?: number | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly unit: string;
}

/**
 * One stored quantity, in the page locale: `88 N·m`, `84–96 N·m`, or
 * `88 N·m (84–96)` for a nominal with its band.
 *
 * The unit is attached once, at the end of a band, which is how every factory
 * chart prints one — the same choice `fixTimeLabel` in `src/lib/problems.ts`
 * records for a fix path's time.
 */
export function quantityLabel(
  quantity: StoredQuantity,
  locale: string
): string {
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const symbol = unitSymbol(quantity.unit);
  /*
   * A degree sign is written tight against its figure (`90°`) and every other
   * unit symbol is written with a space (`77 N·m`). Typography, decided here
   * rather than per page, so the two locales cannot space a figure differently.
   */
  const gap = quantity.unit === "deg" ? "" : " ";
  const { value, min, max } = quantity;
  const hasBand = min !== undefined && max !== undefined;

  if (value !== undefined && hasBand) {
    return `${format.format(value)}${gap}${symbol} (${format.format(min)}–${format.format(max)})`;
  }
  if (value !== undefined) return `${format.format(value)}${gap}${symbol}`;
  if (hasBand) {
    return `${format.format(min)}–${format.format(max)}${gap}${symbol}`;
  }
  // Unreachable through the schema (`quantitySchema` rejects a lone bound);
  // returning the empty string rather than `undefined` keeps callers total.
  return "";
}

/** One cited figure, as the procedures page renders it. */
export interface SpecRow {
  /** The `reference` entry id the procedure cited. */
  readonly id: string;
  /** Whether that id named a real entry. */
  readonly resolved: boolean;
  /** The reference entry's own title in this locale, or `null` when unresolved. */
  readonly title: string | null;
  /** Its `kind`, for the chip — `torque`, `fluid`, `capacity`, `dimension`. */
  readonly kind: string | null;
  /**
   * The figures the row states, in the order the reference entry declares
   * them. A `fluid` row states its designation and its capacity; a `torque`
   * row its figure and, when it has one, its tightening stages.
   */
  readonly figures: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asQuantity(value: unknown): StoredQuantity | null {
  const record = asRecord(value);
  if (record === null || typeof record["unit"] !== "string") return null;
  return {
    value: typeof record["value"] === "number" ? record["value"] : undefined,
    min: typeof record["min"] === "number" ? record["min"] : undefined,
    max: typeof record["max"] === "number" ? record["max"] : undefined,
    unit: record["unit"],
  };
}

/**
 * Every figure one `reference` entry states, as text.
 *
 * Read field by field rather than by walking every numeric leaf: a page that
 * printed "17" because a row happened to carry a page number would be worse
 * than one that printed nothing. The fields here are the four spec kinds'
 * figure-bearing ones, and nothing else.
 */
export function referenceFigures(data: unknown, locale: string): string[] {
  const record = asRecord(data);
  if (record === null) return [];

  const figures: string[] = [];

  // `fluid.specification` — `API GL-5 SAE 75W-90`. Shared data, not prose: a
  // standard's designation is the same string in every language.
  const specification = record["specification"];
  if (typeof specification === "string") figures.push(specification);

  for (const field of ["torque", "capacity", "dimension"]) {
    const quantity = asQuantity(record[field]);
    if (quantity === null) continue;
    const label = quantityLabel(quantity, locale);
    if (label !== "") figures.push(label);
  }

  // Torque-to-yield and angle-tightened fasteners: "50 N·m, then 90°".
  const stages = record["stages"];
  if (Array.isArray(stages)) {
    stages.forEach((stage) => {
      const row = asRecord(stage);
      if (row === null) return;
      const parts = ["torque", "angle"]
        .map((field) => asQuantity(row[field]))
        .filter((quantity): quantity is StoredQuantity => quantity !== null)
        .map((quantity) => quantityLabel(quantity, locale))
        .filter((label) => label !== "");
      if (parts.length > 0) figures.push(parts.join(" + "));
    });
  }

  return figures;
}

/** The slice of a `reference` entry this module reads. */
export interface ReferenceEntryLike {
  readonly data: unknown;
}

/**
 * One row per cited spec id, in the order the procedure declares them.
 *
 * Declaration order and not alphabetical: the entry's author chose which figure
 * a reader meets first, exactly as they chose the order of the steps.
 */
export function specRows(
  ids: readonly string[],
  references: readonly ReferenceEntryLike[],
  locale: string
): SpecRow[] {
  const byId = new Map<string, unknown>();
  for (const entry of references) {
    const id = asRecord(entry.data)?.["id"];
    if (typeof id === "string" && !byId.has(id)) byId.set(id, entry.data);
  }

  return ids.map((id) => {
    const data = byId.get(id);
    const record = asRecord(data);
    if (record === undefined || record === null) {
      return { id, resolved: false, title: null, kind: null, figures: [] };
    }

    const prose = asRecord(record["prose"]);
    const localeProse = asRecord(prose?.[locale]);
    const title = localeProse?.["title"];

    return {
      id,
      resolved: true,
      title: typeof title === "string" ? title : null,
      kind: typeof record["kind"] === "string" ? record["kind"] : null,
      figures: referenceFigures(record, locale),
    };
  });
}
