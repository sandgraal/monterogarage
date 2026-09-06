/**
 * The fitment engine (FIT-01, FIT-02, FIT-04) — the only code that interprets
 * a fitment query.
 *
 * > **FIT-01** THE fitment engine SHALL live in `src/lib/fitment/` with unit
 * > tests, and SHALL be the only code that interprets fitment queries.
 *
 * T202 declared this module's surface as a seam and wrote the graders in
 * `tests/lib/fitment/` against it; T203 (this implementation) filled the
 * bodies in. Nothing outside this directory may re-derive "does entry E apply
 * to vehicle V" — a second answer is a second truth.
 *
 * ## The shape of an answer
 *
 * Three different questions live here and they are deliberately not the same
 * function:
 *
 * | question                                   | function              | answer            |
 * |--------------------------------------------|-----------------------|-------------------|
 * | does this entry's fact apply to my truck?  | `matchesVehicle`      | `boolean`         |
 * | did this exact truck leave the factory?    | `classifyCombination` | 3-valued verdict  |
 * | does this entry's fitment resolve at all?  | `validateEntryFitments` | issue list      |
 *
 * The first is a **filter** and errs towards showing; the second is a **claim
 * about the world** and errs towards `unknown`; the third is a **build gate**
 * and errs towards failing loudly. Collapsing any two of them is how a
 * reference site starts hiding content from the person who owns the truck.
 *
 * ## Rules this module implements, and where each comes from
 *
 * 1. **An omitted fitment facet is no restriction** (`src/schemas/vehicles.ts`:
 *    "`fitment.markets` is optional in the base fitment shape, where omitting
 *    it correctly means 'no market restriction' — a torque figure applies in
 *    every market").
 * 2. **`parentGeneration` expands downwards, never upwards** — `gens: ["gen2"]`
 *    covers a `gen2-5` truck; `gens: ["gen2-5"]` does not cover a `gen2` one.
 *    The containment is content (`gen2-5`'s entry), stated once.
 * 3. **VEH-03's four combination rules**, restated on `classifyCombination`.
 * 4. **JDM-span contract** (conductor ruling, 2026-08-30): the `production`
 *    spans in T201's generation entries are deliberately the *JDM* spans, so
 *    `generationsInProduction` is JDM-scoped by contract rather than a global
 *    production calendar. Per-market spans are a gaps-report item (GAP-01),
 *    not a defect here, and `year-outside-production` is measured against the
 *    same recorded spans for exactly that reason.
 * 5. **Existential impossibility** (ratified in the T202 review, 2026-08-30):
 *    a fitment is a query over a *set* of vehicles, so it is impossible only
 *    when **nothing** it names could have existed. One surviving candidate
 *    tuple is an accept.
 * 6. **`fitment.drive`** (owner ruling, 2026-08-30): a closed two-value
 *    vocabulary, `DRIVE_TYPES` in `src/schemas/vehicles.ts`, resolved here as
 *    a facet exactly like `markets`.
 * 7. **`"global"` in `fitment.markets` is absorbing** (owner ruling
 *    2026-09-06, extended to the mixed case by T203a): a `markets` array that
 *    *contains* `"global"` — `["global"]`, `["global", "us"]`, any mix — is no
 *    market restriction at all, exactly as if the field were omitted, and the
 *    real market ids beside it are inert. 103 shipped entries spell "applies
 *    everywhere" that way rather than by omitting the field, and every one of
 *    them read as "does not fit" the moment a reader picked a real market.
 *    Implemented once, in `readFitment`, whose docstring carries the full
 *    ruling and the list of what it deliberately does not reach.
 *
 * ## The two decisions T202 left to this task, and how they were decided
 *
 * ### (a) A fitment restricting a facet the *selection* is silent about
 *
 * FIT-03 fixes a selection as "gen + market + year + engine", so a visitor can
 * always be silent about transmission, transfer case, trim and drive. When a
 * fitment restricts one of those, the engine must either hide the entry or
 * show it. **Decision: show it — an absent selection facet is treated as
 * unrestricted, not as a failed match.**
 *
 * Why: hiding is the destructive answer. A visitor who has told us "Gen 3, US,
 * 2002, 6G74 SOHC" and nothing else is not asserting that their truck has no
 * transfer case; they simply have not said which one. Hiding a Super Select II
 * article from them withholds information they may need and gives them no
 * signal that anything was withheld — the same failure mode VEH-03's
 * `unknown`-over-`impossible` asymmetry exists to prevent ("a wrong
 * *impossible* silently hides a real vehicle from a reader who owns it, while
 * a wrong *unknown* only fails to catch a typo"). Showing, by contrast, is
 * recoverable in one click: the visitor narrows the selection and the entry
 * disappears. The rule is therefore symmetrical and easy to state — **a facet
 * neither side names is not a constraint** — and it degrades in the direction
 * of more information rather than less.
 *
 * The cost is real and is accepted: a listing filtered on the FIT-03 quadruple
 * alone will show some entries that a fully-specified truck would not match.
 * T204's selector is where a visitor buys precision by saying more. Graded in
 * `tests/lib/fitment/absent-selection-facets.test.ts`.
 *
 * ### (b) Combination scoping across `parentGeneration`
 *
 * Real content carries both `combos-gen2-jdm` and `combos-gen2-5-jdm`, so
 * "what does `classifyCombination` answer for a `gen2-5` truck?" is a live
 * question. **Decision: combination scoping is exact. `classifyCombination`
 * consults only the entries whose `generation` is the selection's own
 * generation id — `parentGeneration` is never followed, in either direction.**
 *
 * Why: `parentGeneration` expansion is a rule about *facts* ("does this torque
 * figure apply to a facelift truck?" — yes, the facelift is a Gen 2 truck). A
 * combination entry is not a fact about a truck; it is a **record of one
 * offering list, sourced for one exact scope**. Following the link upwards
 * would let the parent's list answer for the child, and both failure
 * directions are bad:
 *
 * - a parent-scoped `complete` entry could declare a facelift-only powertrain
 *   *impossible* — the confident wrong answer this taxonomy exists to prevent;
 * - a parent-scoped listing could report a facelift tuple as having *existed*
 *   when the source never said so. `combos-gen2-jdm`'s own prose is explicit:
 *   "Ranges close at the last listing before the mid-cycle facelift, which has
 *   its own entry." Inheriting its rows would fabricate a citation.
 *
 * A `gen2-5` selection in a scope with only a `gen2` entry therefore lands on
 * VEH-03 rule 3 — `unknown`, never `impossible` — which is the honest answer
 * and is already the graded behaviour for any unwritten scope. Graded in
 * `tests/lib/fitment/combination-scoping.test.ts`.
 *
 * Note this does **not** contradict rule 2 above: `validateEntryFitments` does
 * expand a fitment's `gens` before choosing which scopes to interrogate (a
 * `gens: ["gen2"]` fitment genuinely names `gen2-5` vehicles), and each scope
 * it lands on is then interrogated with its own exact generation id.
 *
 * refs specs/001-foundation (FIT-01, FIT-02, FIT-04, VEH-01, VEH-03, SCF-04)
 */
/*
 * The `.ts` extension is deliberate and is repeated along this module's whole
 * import chain (`src/schemas/vehicles.ts`, `src/schemas/entry.ts`,
 * `src/i18n/routing.ts`). FIT-02's build hook reaches this module through a
 * dynamic import that Astro hands to **Node's** ESM resolver rather than to
 * Vite's, and Node does not guess extensions — see the note on
 * `validateFitments` in `astro.config.mjs`. Extensions cost nothing under Vite
 * or Vitest and buy the module chain the property of loading under plain
 * `node` as well.
 */
import {
  DRIVE_TYPES,
  GENERATION_IDS,
  MARKETS,
  VEHICLE_KINDS,
  type VehicleKind,
} from "../../schemas/vehicle-vocabulary.ts";

/* -------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------- */

/**
 * The taxonomy index the resolver answers questions against.
 *
 * Opaque by design (T202 grades *answers*, not the index's shape): the real
 * index is stashed under one private key so callers cannot reach into it, and
 * so passing something that is not a `buildTaxonomy` result fails with a
 * sentence instead of `undefined`.
 */
export interface Taxonomy {
  readonly [key: string]: unknown;
}

/**
 * One vehicle a reader could be looking at.
 *
 * `gen`, `market`, `year` and `engine` are required because FIT-03 fixes
 * exactly that quadruple as a selection. The rest are optional, and an omitted
 * one is treated as unrestricted rather than as a mismatch — decision (a) in
 * the module docstring.
 */
export interface VehicleSelection {
  readonly gen: string;
  readonly market: string;
  readonly year: number;
  readonly engine: string;
  readonly transmission?: string;
  readonly transferCase?: string;
  readonly trim?: string;
  /**
   * `2wd` / `4wd` — `DRIVE_TYPES`. Optional like the other extra facets;
   * added under the owner's 2026-08-30 drive ruling.
   */
  readonly drive?: string;
}

/**
 * What the taxonomy knows about one exact powertrain tuple in one
 * (generation, market, year) scope.
 *
 * Three values, not a boolean, because VEH-03's whole point is that "not
 * listed" splits into two very different answers — see `classifyCombination`.
 */
export type CombinationVerdict = "existed" | "impossible" | "unknown";

/**
 * Every way a declared fitment can fail to resolve.
 *
 * FIT-02 names the first two ("a reference to a nonexistent ID or an
 * impossible combination"). The third is the T202 review's adopted advisory,
 * ratified on tasks.md's T203 line: a fitment whose year window is **disjoint**
 * from every recorded production span of the generations it names cannot
 * describe a vehicle that was ever built, and that is a typo in the content
 * rather than a gap in the data. Partial overlap is *not* an error (that is
 * gaps-report material, GAP-01), and `production.to: null` means the span is
 * open at the cited source, so it can never make a window disjoint.
 */
export const FITMENT_ISSUE_CODES = [
  "unknown-id",
  "impossible-combination",
  "year-outside-production",
] as const;

export type FitmentIssueCode = (typeof FITMENT_ISSUE_CODES)[number];

/**
 * One reason a declared fitment does not resolve.
 *
 * `path` is relative to the entry (`["fitment", "engines", 0]`) so the build
 * error names the field and not just the entry — SCF-04 ("names the file and
 * the field").
 */
export interface FitmentIssue {
  readonly code: FitmentIssueCode;
  /** `id` of the entry whose fitment failed. */
  readonly entryId: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/* -------------------------------------------------------------------------
 * Facets — the one table every rule in this module is driven from
 * ---------------------------------------------------------------------- */

/**
 * The taxonomy-backed facets of a fitment: which field names them, which
 * `kind` of entry their ids must resolve against, and which field of a
 * `VehicleSelection` they are compared with.
 *
 * A table rather than six near-identical branches, because the failure this
 * guards against is *asymmetry*: a facet that is validated but not matched
 * (or matched but not validated) is exactly the drift FIT-02 and FIT-04 would
 * otherwise disagree about, and no single grader would see it.
 */
const TAXONOMY_FACETS = [
  { field: "gens", kind: "generation", select: "gen" },
  { field: "markets", kind: "market", select: "market" },
  { field: "engines", kind: "engine", select: "engine" },
  { field: "transmissions", kind: "transmission", select: "transmission" },
  { field: "transferCases", kind: "transfer-case", select: "transferCase" },
  { field: "trims", kind: "trim", select: "trim" },
] as const satisfies readonly {
  field: string;
  kind: VehicleKind;
  select: keyof VehicleSelection;
}[];

/**
 * Facets compared directly against a selection field, with `gens` and `years`
 * left out because they have their own rules (generation expansion and the
 * year window). `drive` joins them here rather than in `TAXONOMY_FACETS`
 * because its vocabulary is a constant, not a set of taxonomy entries.
 */
const DIRECT_MATCH_FACETS = [
  { field: "markets", select: "market" },
  { field: "engines", select: "engine" },
  { field: "transmissions", select: "transmission" },
  { field: "transferCases", select: "transferCase" },
  { field: "trims", select: "trim" },
  { field: "drive", select: "drive" },
] as const satisfies readonly {
  field: string;
  select: keyof VehicleSelection;
}[];

/** Every fitment field this module reads, for the parser below. */
const ID_LIST_FIELDS = [
  ...TAXONOMY_FACETS.map((facet) => facet.field),
  "drive",
] as const;

/* -------------------------------------------------------------------------
 * The index
 * ---------------------------------------------------------------------- */

/**
 * `production` / `years` as recorded. `to: null` is "open at the time of the
 * cited source" and is read as unbounded, never as an end year.
 */
interface YearSpan {
  readonly from: number;
  readonly to: number | null;
}

/** A half-open-capable year window; `±Infinity` stands for "unstated". */
interface YearWindow {
  readonly from: number;
  readonly to: number;
}

const UNBOUNDED: YearWindow = { from: -Infinity, to: Infinity };

interface GenerationNode {
  readonly id: string;
  readonly production: YearSpan | null;
  readonly parentGeneration: string | null;
}

interface OfferingRecord {
  readonly years: YearSpan;
  readonly engine: string;
  readonly transmission: string;
  readonly transferCase: string;
  /** `null` = "not recorded at trim granularity" (VEH-03 rule 4). */
  readonly trims: readonly string[] | null;
}

interface CombinationNode {
  readonly id: string;
  readonly generation: string;
  readonly market: string;
  readonly coverage: "complete" | "partial";
  readonly offerings: readonly OfferingRecord[];
}

/**
 * Written as a `type` and not an `interface` on purpose: TypeScript only gives
 * *type aliases* of object literals an implicit index signature, so this is
 * what makes the index assignable to the deliberately-opaque `Taxonomy`.
 */
type FitmentIndex = {
  readonly idsByKind: ReadonlyMap<VehicleKind, ReadonlySet<string>>;
  readonly generations: ReadonlyMap<string, GenerationNode>;
  readonly childGenerations: ReadonlyMap<string, readonly string[]>;
  /** Keyed `${generation}|${market}`; a scope may have several entries. */
  readonly combinations: ReadonlyMap<string, readonly CombinationNode[]>;
};

/**
 * The one key a `Taxonomy` carries. Long and prefixed so nothing that is not a
 * `buildTaxonomy` result can collide with it by accident.
 */
const INDEX_KEY = "@@montero/fitment-index";

/** Marks a real index, so `indexOf` can tell one from an arbitrary object. */
const INDEX_BRAND = Symbol.for("montero.fitment.index");

type BrandedIndex = FitmentIndex & { readonly [INDEX_BRAND]: true };

function indexOf(taxonomy: Taxonomy): FitmentIndex {
  const candidate =
    typeof taxonomy === "object" && taxonomy !== null
      ? (taxonomy as Record<string, unknown>)[INDEX_KEY]
      : undefined;

  if (
    typeof candidate === "object" &&
    candidate !== null &&
    (candidate as Partial<BrandedIndex>)[INDEX_BRAND] === true
  ) {
    return candidate as FitmentIndex;
  }

  throw new TypeError(
    `this is not a taxonomy: pass the value \`buildTaxonomy(entries)\` ` +
      `returned. The fitment engine answers questions against an index it ` +
      `builds once (FIT-01, src/lib/fitment/). refs specs/001-foundation`
  );
}

/* -------------------------------------------------------------------------
 * Reading loosely-typed entries
 *
 * Every public function takes `unknown`, because the graders (and the build)
 * feed it entry objects read off disk. Nothing here throws on a malformed
 * entry: the *schemas* own "is this a legal entry", and this module owns "does
 * a legal entry resolve". An object it cannot read is simply not a taxonomy
 * node and not a fitment.
 * ---------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

function asYearSpan(value: unknown): YearSpan | null {
  const record = asRecord(value);
  if (record === null) return null;
  const { from, to } = record;
  if (typeof from !== "number" || !Number.isFinite(from)) return null;
  if (to === null || to === undefined) return { from, to: null };
  if (typeof to !== "number" || !Number.isFinite(to)) return null;
  return { from, to };
}

function asOffering(value: unknown): OfferingRecord | null {
  const record = asRecord(value);
  if (record === null) return null;
  const years = asYearSpan(record["years"]);
  const engine = asString(record["engine"]);
  const transmission = asString(record["transmission"]);
  const transferCase = asString(record["transferCase"]);
  if (
    years === null ||
    engine === null ||
    transmission === null ||
    transferCase === null
  ) {
    return null;
  }
  return {
    years,
    engine,
    transmission,
    transferCase,
    trims: asStringList(record["trims"]),
  };
}

/* -------------------------------------------------------------------------
 * Building the index
 * ---------------------------------------------------------------------- */

/**
 * Builds the resolver's index from the parsed `vehicles` collection.
 *
 * Takes `unknown[]` on purpose: the graders and the build both feed it entry
 * objects read off disk. The result is independent of the order the entries
 * arrive in — every lookup below is by key or by a sort with a total order,
 * which is what makes FIT-04's determinism requirement structural rather than
 * a promise.
 */
export function buildTaxonomy(entries: readonly unknown[]): Taxonomy {
  const idsByKind = new Map<VehicleKind, Set<string>>(
    VEHICLE_KINDS.map((kind) => [kind, new Set<string>()])
  );
  const generations = new Map<string, GenerationNode>();
  const combinations = new Map<string, CombinationNode[]>();

  for (const entry of entries) {
    const record = asRecord(entry);
    if (record === null) continue;

    const id = asString(record["id"]);
    const kind = asString(record["kind"]);
    if (id === null || kind === null) continue;
    if (!(VEHICLE_KINDS as readonly string[]).includes(kind)) continue;

    idsByKind.get(kind as VehicleKind)?.add(id);

    if (kind === "generation") {
      generations.set(id, {
        id,
        production: asYearSpan(record["production"]),
        parentGeneration: asString(record["parentGeneration"]),
      });
      continue;
    }

    if (kind !== "combination") continue;

    const generation = asString(record["generation"]);
    const market = asString(record["market"]);
    const coverage = asString(record["coverage"]);
    if (generation === null || market === null) continue;

    const offerings = (
      Array.isArray(record["offerings"]) ? record["offerings"] : []
    )
      .map(asOffering)
      .filter((offering): offering is OfferingRecord => offering !== null);

    const node: CombinationNode = {
      id,
      generation,
      market,
      // Anything that is not an explicit `complete` is treated as `partial`.
      // The schema requires the field, so this branch is unreachable through
      // real content; it fails towards `unknown`, which is the direction
      // VEH-03 says to fail in.
      coverage: coverage === "complete" ? "complete" : "partial",
      offerings,
    };

    const key = scopeKey(generation, market);
    const existing = combinations.get(key);
    if (existing === undefined) combinations.set(key, [node]);
    else existing.push(node);
  }

  // Sorted so a scope's entries are in a stable order whatever order the
  // collection was read in — the `shuffled()` determinism graders.
  for (const nodes of combinations.values()) {
    nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const childGenerations = new Map<string, string[]>();
  for (const generation of sortedGenerations([...generations.values()])) {
    const parent = generation.parentGeneration;
    if (parent === null || parent === generation.id) continue;
    const siblings = childGenerations.get(parent);
    if (siblings === undefined) childGenerations.set(parent, [generation.id]);
    else siblings.push(generation.id);
  }

  const index: BrandedIndex = {
    [INDEX_BRAND]: true,
    idsByKind,
    generations,
    childGenerations,
    combinations,
  };

  return { [INDEX_KEY]: index };
}

function scopeKey(generation: string, market: string): string {
  return `${generation}|${market}`;
}

/**
 * Generation ids in `GENERATION_IDS` order, with anything unrecognised sorted
 * after them alphabetically. A total order, so every list this module returns
 * is stable.
 */
function sortedGenerations<T extends { readonly id: string }>(
  nodes: readonly T[]
): T[] {
  const rank = (id: string) => {
    const at = (GENERATION_IDS as readonly string[]).indexOf(id);
    return at === -1 ? GENERATION_IDS.length : at;
  };
  return [...nodes].sort((a, b) => {
    const byRank = rank(a.id) - rank(b.id);
    if (byRank !== 0) return byRank;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function sortGenerationIds(ids: readonly string[]): string[] {
  return sortedGenerations(ids.map((id) => ({ id }))).map((node) => node.id);
}

/* -------------------------------------------------------------------------
 * Generations
 * ---------------------------------------------------------------------- */

/**
 * Expands a fitment's `gens` to every generation it covers, following
 * `parentGeneration` downwards.
 *
 * `src/schemas/vehicles.ts`: `gen2-5` "is a generation id whose entry declares
 * `parentGeneration: "gen2"`; the containment is content, stated once, and the
 * resolver (T203) is what expands `gens: ["gen2"]` to its children."
 * Containment is one-directional: a fact scoped to the facelift is not a fact
 * about the whole of Gen 2.
 *
 * An id with no entry expands to itself. That is not a silent pass — an
 * unknown generation id is a build error under `validateEntryFitments`, and
 * making it vanish here would turn a typo into "matches nothing", which is the
 * exact failure FIT-02 exists to catch.
 */
export function expandGenerations(
  gens: readonly string[],
  taxonomy: Taxonomy
): readonly string[] {
  return expandGenerationIds(gens, indexOf(taxonomy));
}

function expandGenerationIds(
  gens: readonly string[],
  index: FitmentIndex
): readonly string[] {
  const found = new Set<string>();
  const pending = [...gens];

  // Breadth-first with a `seen` set, so a malformed cycle in the content
  // (`a` -> `b` -> `a`) terminates instead of hanging the build.
  while (pending.length > 0) {
    const id = pending.shift();
    if (id === undefined || found.has(id)) continue;
    found.add(id);
    for (const child of index.childGenerations.get(id) ?? []) {
      if (!found.has(child)) pending.push(child);
    }
  }

  return sortGenerationIds([...found]);
}

/**
 * Every generation whose recorded production span contains `year`.
 *
 * FIT-04 names the hard case this exists for: "a 1999 vehicle matching both
 * Gen 2.5 and Gen 3 where production overlapped".
 *
 * **JDM-scoped by contract** (conductor ruling, 2026-08-30): T201 recorded the
 * `production` spans from Japanese-market sources deliberately, and `gen2`'s
 * fact-checked prose says so. This function answers from those spans and makes
 * no claim about when a generation was on sale in the US or in Costa Rica.
 * Per-market spans are a gaps-report item (GAP-01); when they land, they land
 * as data and this function reads them.
 */
export function generationsInProduction(
  year: number,
  taxonomy: Taxonomy
): readonly string[] {
  const index = indexOf(taxonomy);
  const inProduction = [...index.generations.values()].filter((generation) => {
    const { production } = generation;
    if (production === null) return false;
    return spanContains(production, year);
  });
  return sortedGenerations(inProduction).map((generation) => generation.id);
}

/** Both ends inclusive; `to: null` is open-ended, never an end year. */
function spanContains(span: YearSpan, year: number): boolean {
  return year >= span.from && year <= (span.to ?? Infinity);
}

function spanOverlapsWindow(span: YearSpan, window: YearWindow): boolean {
  return span.from <= window.to && (span.to ?? Infinity) >= window.from;
}

/* -------------------------------------------------------------------------
 * VEH-03 — did this combination exist?
 * ---------------------------------------------------------------------- */

/**
 * Classifies one exact vehicle against the combination data.
 *
 * The four rules are `src/schemas/vehicles.ts`'s, restated because this is the
 * function that implements them:
 *
 * 1. A tuple absent from a `coverage: "complete"` entry is **impossible**.
 * 2. A tuple absent from a `coverage: "partial"` entry is **unknown**.
 * 3. A (generation, market) pair with **no combination entry at all** is
 *    **unknown**, never impossible.
 * 4. `offerings[].trims` is an assertion about every trim listed; omitting it
 *    means "not recorded at trim granularity" — **unknown**, not impossible,
 *    "and unaffected by `coverage`, which is a claim about the offering list
 *    and not about any offering's internals".
 *
 * The asymmetry is deliberate and is graded: "a wrong *impossible* silently
 * hides a real vehicle from a reader who owns it, while a wrong *unknown* only
 * fails to catch a typo."
 *
 * Two consequences of that asymmetry, decided here:
 *
 * - A facet the selection omits (`transmission`, `transferCase`, `trim`) is a
 *   question that was not asked, so it constrains nothing — asking about a
 *   2002 US 6G74 with no gearbox named is asking "did *any* such truck exist".
 * - A scope covered by several combination entries is closed only if **every**
 *   one of them says `complete`. One `partial` entry in the scope means the
 *   offering list is admittedly unfinished, and an unfinished list cannot
 *   support "never existed".
 *
 * **Combination scoping is exact** — `parentGeneration` is not followed here.
 * See decision (b) in the module docstring for why.
 */
export function classifyCombination(
  selection: VehicleSelection,
  taxonomy: Taxonomy
): CombinationVerdict {
  return classifyScope(indexOf(taxonomy), {
    generation: selection.gen,
    market: selection.market,
    window: { from: selection.year, to: selection.year },
    engines: selection.engine === undefined ? null : [selection.engine],
    transmissions:
      selection.transmission === undefined ? null : [selection.transmission],
    transferCases:
      selection.transferCase === undefined ? null : [selection.transferCase],
    trims: selection.trim === undefined ? null : [selection.trim],
  });
}

/**
 * One combination question. Every `null` is a wildcard ("not asked"), and a
 * list is a set of acceptable values — which is what lets the single-vehicle
 * question and the whole-fitment question (ruling 5, existential
 * impossibility) share one implementation and therefore one set of rules.
 */
interface ScopeQuery {
  readonly generation: string;
  readonly market: string;
  readonly window: YearWindow;
  readonly engines: readonly string[] | null;
  readonly transmissions: readonly string[] | null;
  readonly transferCases: readonly string[] | null;
  readonly trims: readonly string[] | null;
}

function classifyScope(
  index: FitmentIndex,
  query: ScopeQuery
): CombinationVerdict {
  const entries =
    index.combinations.get(scopeKey(query.generation, query.market)) ?? [];

  // Rule 3 — nobody has written this scope up.
  if (entries.length === 0) return "unknown";

  const matching = entries.flatMap((entry) =>
    entry.offerings.filter(
      (offering) =>
        accepts(query.engines, offering.engine) &&
        accepts(query.transmissions, offering.transmission) &&
        accepts(query.transferCases, offering.transferCase) &&
        spanOverlapsWindow(offering.years, query.window)
    )
  );

  if (matching.length === 0) {
    // Rules 1 and 2 — only a wholly closed scope licenses "never existed".
    return entries.every((entry) => entry.coverage === "complete")
      ? "impossible"
      : "unknown";
  }

  // Rule 4 — `trims` is an assertion about what is listed and closes nothing.
  if (query.trims === null) return "existed";
  const trimmed = matching.some(
    (offering) =>
      offering.trims !== null &&
      offering.trims.some((trim) => query.trims?.includes(trim))
  );
  return trimmed ? "existed" : "unknown";
}

/** `null` asks nothing and therefore accepts everything. */
function accepts(allowed: readonly string[] | null, value: string): boolean {
  return allowed === null || allowed.includes(value);
}

/* -------------------------------------------------------------------------
 * FIT-04 — does entry E apply to vehicle V?
 * ---------------------------------------------------------------------- */

/** A fitment as this module reads it; every facet absent means "unrestricted". */
interface FitmentQuery {
  readonly gens: readonly string[];
  readonly years: YearWindow | null;
  readonly facets: ReadonlyMap<string, readonly string[]>;
}

/**
 * The `markets` id that is a *scope over all markets* rather than a market
 * anybody owns a truck in — rule 7 below. Named rather than inlined so the one
 * place the absorbing rule is implemented is greppable from
 * `src/schemas/vehicle-vocabulary.ts`'s `MARKETS`, where the id is declared.
 */
const UNRESTRICTED_MARKET = "global" satisfies (typeof MARKETS)[number];

/** The one fitment field rule 7 applies to. Deliberately not a table. */
const ABSORBING_FACET_FIELD = "markets";

/**
 * Reads a fitment object. Returns `null` when there is nothing resolvable —
 * no object, or no `gens`. `gens` is required by `fitmentSchema` ("at least
 * one generation: 'it's a Montero thing' is not a fitment"), so an entry
 * without it names no vehicles and matches none.
 *
 * ## Rule 7 — `"global"` in `fitment.markets` is absorbing (T203a/T203b)
 *
 * This is **the** seam the absorbing-`global` rule is implemented at, and it is
 * implemented here exactly once rather than at each call site. `readFitment` is
 * the only parser of a fitment in this module, so dropping the facet here makes
 * every consumer of a `FitmentQuery` agree by construction:
 *
 * - `matchesVehicle` (and `entryAppliesTo` through it) skips the facet, so the
 *   entry fits every market — FIT-04;
 * - `provisionalMatchFacets` sees an unrestricted `markets`, so a global
 *   fitment reads as a **full** match with nothing provisional. (`market` is
 *   not in `OPTIONAL_SELECTION_FACETS` either way, but the two readings now
 *   agree for the same reason rather than by coincidence — T204 review, F8);
 * - `checkCombination` falls back to `?? MARKETS` and interrogates every market
 *   scope, so a global fitment is `impossible-combination` only when *every*
 *   market's list is closed against it. Fixing `matchesVehicle` alone would
 *   have left this build gate reading `markets` literally and could fail a
 *   build on a fitment that names a perfectly possible truck — FIT-02.
 *
 * What it deliberately does **not** reach:
 *
 * - `collectUnknownIds` reads the *raw* fitment, not this query, so
 *   `["global", "narnia"]` still reports `unknown-id` at index 1 with the
 *   author's own array index. `global` is not a licence to stop resolving the
 *   ids beside it.
 * - `classifyCombination` and `buildTaxonomy` index a combination entry by its
 *   own `generation`/`market` fields, never through here, so combination
 *   scoping stays literal: `combos-gen4-global` still answers only for
 *   `gen4 × global` and a `gen4 × cr` selection is `unknown` (VEH-03 rule 3).
 * - The *selection* side: a visitor who picks `global` has picked one scope,
 *   and a `markets: ["us"]` fitment still misses them.
 * - Every other facet. `trims: ["global"]` is an unknown trim id, not a
 *   wildcard — hence a single named field rather than a value stripped from
 *   every list.
 *
 * An **empty** `markets: []` is untouched by this and stays a restriction
 * nothing satisfies (the line below), which is why the rule is written as
 * "contains the id → drop the facet" and never as a filter over the values: a
 * filter would turn `["global"]` into `[]` and hand it the opposite meaning.
 *
 * Ruling: owner, 2026-09-06 (`["global"]` resolves as an omitted `markets`),
 * extended to the mixed case by T203a — any array *containing* `"global"`
 * resolves as unrestricted and the real ids beside it are inert, because a
 * union with the universal set is the universal set. The cost, stated on
 * tasks.md's T203a line: "everywhere EXCEPT X" is no longer spellable as
 * `["global", …]`; list the real markets and omit `"global"`.
 */
function readFitment(fitment: unknown): FitmentQuery | null {
  const record = asRecord(fitment);
  if (record === null) return null;

  const gens = asStringList(record["gens"]);
  if (gens === null) return null;

  const facets = new Map<string, readonly string[]>();
  for (const field of ID_LIST_FIELDS) {
    if (field === "gens") continue;
    if (record[field] === undefined) continue;
    const values = asStringList(record[field]);
    // Rule 7 — a `markets` list naming `global` restricts nothing, so it is
    // not recorded at all: absent is exactly the spelling every consumer
    // already reads as "unrestricted".
    if (
      field === ABSORBING_FACET_FIELD &&
      values !== null &&
      values.includes(UNRESTRICTED_MARKET)
    ) {
      continue;
    }
    // A present-but-unreadable facet is a schema failure, not a match: it is
    // read as a restriction nothing satisfies rather than silently dropped.
    facets.set(field, values ?? []);
  }

  return { gens, years: readYearWindow(record["years"]), facets };
}

/**
 * A fitment's `years`. Either end may be absent, and an absent end is
 * unbounded — `{ from: 1999 }` is "1999 onwards". An empty or absent object is
 * no window at all.
 */
function readYearWindow(value: unknown): YearWindow | null {
  if (value === undefined || value === null) return null;
  const record = asRecord(value);
  if (record === null) return null;
  const { from, to } = record;
  const hasFrom = typeof from === "number" && Number.isFinite(from);
  const hasTo = typeof to === "number" && Number.isFinite(to);
  if (!hasFrom && !hasTo) return null;
  return {
    from: hasFrom ? (from as number) : -Infinity,
    to: hasTo ? (to as number) : Infinity,
  };
}

/**
 * Resolves a fitment query against one vehicle. Pure and deterministic: the
 * same `(fitment, vehicle, taxonomy)` always yields the same answer, the answer
 * does not depend on the order entries were indexed in, and neither argument is
 * mutated.
 *
 * An omitted *fitment* facet is no restriction. An omitted *selection* facet is
 * a question the visitor has not answered, and is likewise not a restriction —
 * decision (a) in the module docstring.
 */
export function matchesVehicle(
  fitment: unknown,
  vehicle: VehicleSelection,
  taxonomy: Taxonomy
): boolean {
  const index = indexOf(taxonomy);
  const query = readFitment(fitment);
  if (query === null) return false;

  if (!expandGenerationIds(query.gens, index).includes(vehicle.gen)) {
    return false;
  }

  if (query.years !== null) {
    if (vehicle.year < query.years.from) return false;
    if (vehicle.year > query.years.to) return false;
  }

  for (const facet of DIRECT_MATCH_FACETS) {
    const allowed = query.facets.get(facet.field);
    if (allowed === undefined) continue; // the fitment does not restrict it
    const selected = vehicle[facet.select];
    if (selected === undefined) continue; // the selection does not state it
    if (!allowed.includes(String(selected))) return false;
  }

  return true;
}

/**
 * FIT-04 in the requirement's own words — "does entry E apply to vehicle V".
 * Reads `entry.fitment` and answers exactly as `matchesVehicle` does; FIT-03's
 * listing filter is this function over a collection.
 */
export function entryAppliesTo(
  entry: unknown,
  vehicle: VehicleSelection,
  taxonomy: Taxonomy
): boolean {
  const record = asRecord(entry);
  if (record === null) return false;
  return matchesVehicle(record["fitment"], vehicle, taxonomy);
}

/* -------------------------------------------------------------------------
 * FIT-03 — what a match cost, so the reader can see it
 * ---------------------------------------------------------------------- */

/**
 * The `VehicleSelection` fields that decision (a) lets a visitor stay silent
 * about. FIT-03 fixes a selection as gen + market + year + engine, so these
 * four are the entire surface on which "an absent selection facet is treated
 * as unrestricted" can bite.
 *
 * Derived from {@link DIRECT_MATCH_FACETS} rather than hand-listed: a facet
 * added to the match table without being added here would be silently
 * unreportable, which is the one failure this function exists to prevent.
 */
const REQUIRED_SELECTION_FIELDS = ["gen", "market", "year", "engine"] as const;

export type OptionalSelectionFacet = Exclude<
  (typeof DIRECT_MATCH_FACETS)[number]["select"],
  (typeof REQUIRED_SELECTION_FIELDS)[number]
>;

export const OPTIONAL_SELECTION_FACETS: readonly OptionalSelectionFacet[] =
  DIRECT_MATCH_FACETS.map((facet) => facet.select).filter(
    (select): select is OptionalSelectionFacet =>
      !(REQUIRED_SELECTION_FIELDS as readonly string[]).includes(select)
  );

/**
 * Why a match is only *provisional*: the facets this fitment restricts that
 * the selection says nothing about. Empty when the match used no silence at
 * all, i.e. when the entry genuinely applies to the vehicle as specified.
 *
 * ## What this is for (T203 review, F8 — binding on T204)
 *
 * `matchesVehicle` errs towards showing: a fitment that names a transfer case
 * still matches a visitor who never said which transfer case they have
 * (decision (a) in the module docstring). That trade-off buys information
 * instead of hiding it, and its cost — "a listing filtered on the FIT-03
 * quadruple alone will show some entries that a fully-specified truck would
 * not match" — was accepted *on the condition that the reader can see it*.
 * This function is how a page sees it, per entry, so the indicator appears on
 * exactly the rows whose match leaned on an unanswered question and
 * disappears from a row the moment the visitor narrows the selection enough to
 * answer it.
 *
 * Answering it here rather than in a component is the same rule as everything
 * else in this module: a page that re-derived "did this match depend on
 * silence?" would be a second reading of a fitment, and a second reading is a
 * second truth (FIT-01).
 *
 * Returns `[]` for a fitment that does not match at all — an entry that is not
 * shown has no provisional-ness to report — and for an unreadable fitment.
 * The result is in {@link OPTIONAL_SELECTION_FACETS} order, so a caller
 * rendering the list gets a stable sentence (FIT-04's determinism).
 */
export function provisionalMatchFacets(
  fitment: unknown,
  vehicle: VehicleSelection,
  taxonomy: Taxonomy
): readonly OptionalSelectionFacet[] {
  if (!matchesVehicle(fitment, vehicle, taxonomy)) return [];

  const query = readFitment(fitment);
  if (query === null) return [];

  return OPTIONAL_SELECTION_FACETS.filter((select) => {
    const facet = DIRECT_MATCH_FACETS.find((entry) => entry.select === select);
    if (facet === undefined) return false;
    // Restricted by the fitment, unanswered by the visitor — the exact pair
    // `matchesVehicle` waves through.
    return (
      query.facets.get(facet.field) !== undefined &&
      vehicle[select] === undefined
    );
  });
}

/** `provisionalMatchFacets` for a whole entry — the `entryAppliesTo` pairing. */
export function entryProvisionalFacets(
  entry: unknown,
  vehicle: VehicleSelection,
  taxonomy: Taxonomy
): readonly OptionalSelectionFacet[] {
  const record = asRecord(entry);
  if (record === null) return [];
  return provisionalMatchFacets(record["fitment"], vehicle, taxonomy);
}

/* -------------------------------------------------------------------------
 * FIT-02 — build-time validation
 * ---------------------------------------------------------------------- */

/**
 * Every reason the given entries' fitments do not resolve against the
 * taxonomy; empty when they all do.
 *
 * Returned rather than thrown so one build reports every bad fitment instead
 * of the first — the same choice `validateSlugRegistry` makes.
 *
 * The three checks are staged, and the staging is deliberate: a fitment with
 * an unknown id gets *only* the `unknown-id` issues. Asking "was this
 * combination possible" about a `gen9` is asking a question with no answer,
 * and reporting a second, derived failure alongside the real one sends the
 * author chasing a symptom.
 */
export function validateEntryFitments(
  entries: readonly unknown[],
  taxonomy: Taxonomy
): readonly FitmentIssue[] {
  const index = indexOf(taxonomy);
  const issues: FitmentIssue[] = [];

  for (const entry of entries) {
    const record = asRecord(entry);
    if (record === null) continue;
    if (record["fitment"] === undefined) continue;

    const entryId = asString(record["id"]) ?? "(entry with no id)";
    const query = readFitment(record["fitment"]);
    if (query === null) continue; // shape is the schema's business, not ours

    const unknownIds = collectUnknownIds(entryId, record["fitment"], index);
    issues.push(...unknownIds);
    if (unknownIds.length > 0) continue;

    const gens = expandGenerationIds(query.gens, index);

    const outsideProduction = checkYearWindow(entryId, query, gens, index);
    if (outsideProduction !== null) {
      issues.push(outsideProduction);
      continue;
    }

    const impossible = checkCombination(entryId, query, gens, index);
    if (impossible !== null) issues.push(impossible);
  }

  return issues;
}

/**
 * FIT-02's first failure class. Ids resolve **by kind** —
 * `src/schemas/vehicles.ts`: "References between taxonomy nodes are
 * `(kind, id)` pairs … so an id need only be unique within its kind" — which
 * is why a real trim id in `transferCases` is as wrong as an invented one.
 *
 * Read from the raw fitment rather than from the parsed `FitmentQuery` so the
 * reported index is the author's own array index (SCF-04).
 */
function collectUnknownIds(
  entryId: string,
  fitment: unknown,
  index: FitmentIndex
): FitmentIssue[] {
  const record = asRecord(fitment);
  if (record === null) return [];
  const issues: FitmentIssue[] = [];

  for (const facet of TAXONOMY_FACETS) {
    const values = asStringList(record[facet.field]);
    if (values === null) continue;
    const known = index.idsByKind.get(facet.kind) ?? new Set<string>();
    values.forEach((value, at) => {
      if (known.has(value)) return;
      issues.push({
        code: "unknown-id",
        entryId,
        path: ["fitment", facet.field, at],
        message:
          `\`${value}\` is not the id of a \`${facet.kind}\` entry in the ` +
          `vehicle taxonomy, so this fitment names a vehicle the site has no ` +
          `vocabulary for. Fitment ids resolve against their own kind ` +
          `(VEH-01); add the taxonomy entry or fix the id. ` +
          `refs specs/001-foundation (FIT-02)`,
      });
    });
  }

  // `drive` is the one facet whose vocabulary is a constant rather than a set
  // of entries (owner ruling, 2026-08-30), but a value outside it is the same
  // failure: an id that resolves against nothing.
  const drive = asStringList(record["drive"]);
  if (drive !== null) {
    drive.forEach((value, at) => {
      if ((DRIVE_TYPES as readonly string[]).includes(value)) return;
      issues.push({
        code: "unknown-id",
        entryId,
        path: ["fitment", "drive", at],
        message:
          `\`${value}\` is not a drive type: \`fitment.drive\` resolves ` +
          `against the closed vocabulary ` +
          `${DRIVE_TYPES.map((type) => `\`${type}\``).join(" / ")} ` +
          `(owner ruling 2026-08-30, \`DRIVE_TYPES\` in ` +
          `src/schemas/vehicles.ts). refs specs/001-foundation (FIT-02)`,
      });
    });
  }

  return issues;
}

/**
 * The third issue code, adopted from the T202 review's advisory and ratified
 * on tasks.md's T203 line.
 *
 * A fitment year window **disjoint** from every recorded production span of
 * the generations it names describes no vehicle that was ever built — a
 * transposed digit, not a gap. Three things this deliberately does not do:
 *
 * - **Partial overlap is not an error.** A `gen3` fitment for 1998–2002 is
 *   half outside the recorded span; that is a content question for the gaps
 *   report (GAP-01), not a build break, because the recorded span is JDM and
 *   another market's may legitimately differ.
 * - **`production.to: null` never makes a window disjoint** — an open span is
 *   open, and reading it as an end year would invent one.
 * - **The check abstains only when *no* named generation has a recorded span**
 *   — absence of data is not evidence of absence, the same reading VEH-03
 *   rule 3 takes. Note this is all-or-nothing, not per-generation: a fitment
 *   naming one generation with a span and one without is still measured
 *   against the span it does have. Unreachable through real content either
 *   way, since `production` is required on every generation entry.
 */
function checkYearWindow(
  entryId: string,
  query: FitmentQuery,
  gens: readonly string[],
  index: FitmentIndex
): FitmentIssue | null {
  const window = query.years;
  if (window === null) return null;

  const spans = gens.flatMap((gen) => {
    const production = index.generations.get(gen)?.production;
    return production === undefined || production === null ? [] : [production];
  });
  if (spans.length === 0) return null;

  if (spans.some((span) => spanOverlapsWindow(span, window))) return null;

  return {
    code: "year-outside-production",
    entryId,
    path: ["fitment", "years"],
    message:
      `this fitment's year window (${describeWindow(window)}) does not ` +
      `overlap the recorded production of ${gens.map((gen) => `\`${gen}\``).join(", ")} ` +
      `(${spans.map(describeSpan).join(", ")}), so it names no vehicle that ` +
      `was ever built. Those spans are the JDM spans by contract (conductor ` +
      `ruling 2026-08-30); a window that merely *overlaps* them is fine and ` +
      `is gaps-report material, but a disjoint one is a typo. ` +
      `refs specs/001-foundation (FIT-02)`,
  };
}

function describeWindow(window: YearWindow): string {
  const from = window.from === -Infinity ? "…" : String(window.from);
  const to = window.to === Infinity ? "…" : String(window.to);
  return `${from}–${to}`;
}

function describeSpan(span: YearSpan): string {
  return `${span.from}–${span.to ?? "open"}`;
}

/**
 * FIT-02's second failure class, under the **existential** reading ratified in
 * the T202 review (2026-08-30): a fitment is a query over a set of vehicles,
 * so it is impossible only when *nothing* it names could have existed. One
 * surviving candidate scope is an accept.
 *
 * Every scope is interrogated with its own exact generation id — the fitment's
 * `gens` are expanded to choose *which* scopes to ask (a `gens: ["gen2"]`
 * fitment genuinely names `gen2-5` trucks), but no scope ever answers on
 * another's behalf. Decision (b) in the module docstring.
 *
 * **Coverage warning (T203 review, F3):** all seven combination entries in
 * today's content are honestly `coverage: "partial"`, so nothing in the real
 * corpus can produce an `impossible-combination` — this gate's positive
 * controls are entirely fixture-based (`validation.test.ts`,
 * `combination-scoping.test.ts`). A green build is therefore *not* evidence
 * that this check fires. The first sourced `complete` entry to land is the
 * moment to re-prove it against real data.
 */
function checkCombination(
  entryId: string,
  query: FitmentQuery,
  gens: readonly string[],
  index: FitmentIndex
): FitmentIssue | null {
  const markets = query.facets.get("markets") ?? MARKETS;
  const window = query.years ?? UNBOUNDED;

  const scopes: string[] = [];
  for (const generation of gens) {
    for (const market of markets) {
      const verdict = classifyScope(index, {
        generation,
        market,
        window,
        engines: query.facets.get("engines") ?? null,
        transmissions: query.facets.get("transmissions") ?? null,
        transferCases: query.facets.get("transferCases") ?? null,
        trims: query.facets.get("trims") ?? null,
      });
      // Anything other than a flat "never existed" keeps the fitment alive.
      if (verdict !== "impossible") return null;
      scopes.push(`${generation} × ${market}`);
    }
  }

  if (scopes.length === 0) return null;

  return {
    code: "impossible-combination",
    entryId,
    path: ["fitment"],
    message:
      `every vehicle this fitment names is a combination the taxonomy says ` +
      `never existed (${scopes.join(", ")}): each of those scopes has a ` +
      `\`coverage: "complete"\` combination entry and none of them lists a ` +
      `powertrain this fitment allows (VEH-03 rule 1). A fitment is only ` +
      `impossible when nothing it names could have existed, so one correct ` +
      `id is enough to fix it. refs specs/001-foundation (FIT-02)`,
  };
}

/**
 * What `assertFitmentsResolve` throws.
 *
 * Carries the structured `issues` as well as the rendered message, so a caller
 * that knows something the resolver does not — the build integration knows
 * which *file* each entry id came from (SCF-04) — can add it without
 * re-deriving the failures by grepping the message. An earlier draft did grep
 * it, and matched the market entry `me` inside the word "names".
 */
export class FitmentResolutionError extends Error {
  readonly issues: readonly FitmentIssue[];

  constructor(issues: readonly FitmentIssue[], message: string) {
    super(message);
    this.name = "FitmentResolutionError";
    this.issues = issues;
  }
}

/**
 * The build path FIT-02 requires: throws when any entry's fitment fails to
 * resolve, with a message naming every offending entry and field.
 *
 * Wired into the real build by `src/integrations/validate-fitments.ts`, so a
 * bad fitment is a red `npm run build` and not a warning nobody reads.
 */
export function assertFitmentsResolve(
  entries: readonly unknown[],
  taxonomy: Taxonomy
): void {
  const issues = validateEntryFitments(entries, taxonomy);
  if (issues.length === 0) return;

  const lines = issues.map(
    (issue) =>
      `  • [${issue.code}] ${issue.entryId} at ` +
      `${issue.path.map(String).join(".")}: ${issue.message}`
  );

  throw new FitmentResolutionError(
    issues,
    `${issues.length} fitment${issues.length === 1 ? "" : "s"} did not ` +
      `resolve against the vehicle taxonomy (FIT-02):\n${lines.join("\n")}`
  );
}
