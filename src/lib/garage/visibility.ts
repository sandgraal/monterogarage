/**
 * What one **principal** may see of one vehicle's records — the seam declared
 * by T2-401 [TEST] and filled by T2-402 [PLATFORM].
 *
 * ## One function, three principals — and why that is the requirement
 *
 * > **T2-402, amended 2026-08-31:** the per-record cost-masking logic must be
 * > **parameterised by principal**, not written once for "the public". T2-404
 * > needs the same masking for a different audience, and a second copy of a
 * > privacy rule is a second place for it to drift.
 *
 * There are three audiences for a record and they are *not* three code paths:
 *
 * | principal | sees | governed by |
 * |---|---|---|
 * | the owner | everything | RLS on `auth.uid()` |
 * | the world | records with `is_public` on a vehicle with `is_worklog_public`, costs only with `is_cost_public` | SHR-02, SHR-03 |
 * | a grant holder | records on the granted vehicle, costs only with `includes_costs`, receipts only with `includes_receipts` | SHR-05, SHR-06 |
 *
 * Writing that as three functions is how the world's rule and the grant
 * holder's rule end up disagreeing about one edge — and the edge that goes
 * wrong is somebody's invoice. A fourth audience (003's roster view) joins
 * {@link Principal} and the two `switch`es below; it does not fork the module.
 *
 * The shape that makes that true is the one decision worth naming: each
 * function asks the principal **two independent questions** —
 * {@link mayReadRecord} and {@link costsAreOpen}, plus
 * {@link receiptsAreOpen} — rather than computing one "access level". SHR-06's
 * hardest cell is `costs = false, receipts = true`, which no single level can
 * express, and a reader that gates receipts behind costs gets it wrong in the
 * direction that shows somebody an invoice they did not publish.
 *
 * ## Omission, not blanking — the shape of the return type is the requirement
 *
 * > **SHR-06** … WHERE a grant does not open costs, THE data returned SHALL
 * > **omit the cost fields entirely** rather than blanking them at render time.
 *
 * So {@link VisibleRecord} makes the cost keys *optional* rather than
 * `number | null`, and {@link maskRecordForPrincipal} builds its result by
 * **adding** keys rather than by copying the row and deleting them. A spread
 * that then `delete`s is one forgotten line away from leaking, and the leak is
 * invisible in review because the type still says the key is optional.
 * `cost_amount: null` is a value and the value means *this job was free*; the
 * absence of the key is the only honest way to say *you were not shown this*
 * (AGENTS.md — a failure is not a zero, one surface over).
 *
 * ## Purity, and why this is the *second* wall rather than the first
 *
 * This module is pure: no Supabase client, no DOM, no `import.meta.env`. The
 * database is still the enforcement boundary — SHR-01 names all three permitted
 * modes and a check in page code is none of them. The point of masking here as
 * well is that a page which somehow receives a wider row still cannot render
 * the extra columns, and that the *same* rule is the one T2-404's `security
 * definer` readers project their columns from.
 *
 * refs specs/002-montero-garage (SHR-02, SHR-03, SHR-06, SHR-09, GAR-04′,
 * GAR-05′)
 */
import type { RecordRow } from "./record.ts";
import type { ReceiptRow } from "./receipt.ts";
import type { VehicleRow } from "./vehicle.ts";

/**
 * Who is asking.
 *
 * A closed union on purpose: adding a fourth audience has to be a type error
 * somewhere, not a fourth `if` that a reviewer has to notice.
 */
export type Principal =
  /** The signed-in owner of the vehicle. Sees everything. */
  | { readonly kind: "owner"; readonly userId: string }
  /** An anonymous visitor to a published page. SHR-02, SHR-03. */
  | { readonly kind: "world" }
  /**
   * The holder of a typed share grant (SHR-05..08).
   *
   * `includesCosts` and `includesReceipts` are two independent decisions
   * (SHR-06) and are carried as two fields for exactly that reason — a single
   * `capabilities: "full" | "history"` enum would make them one.
   */
  | {
      readonly kind: "grant";
      readonly vehicleId: string;
      readonly includesCosts: boolean;
      readonly includesReceipts: boolean;
    };

/**
 * A record as one principal may see it.
 *
 * The cost keys are **optional, not nullable**: see the module note. Nothing
 * else about a record changes between audiences — a masked record is a record
 * with fewer keys, never a record with different values.
 */
export type VisibleRecord = Omit<
  RecordRow,
  "cost_amount" | "cost_currency" | "is_public" | "is_cost_public"
> & {
  readonly cost_amount?: number | null;
  readonly cost_currency?: string | null;
};

/**
 * The two per-vehicle switches SHR-02 gives an owner, as a write.
 *
 * Declared here rather than beside `VehicleWrite` in `./vehicle.ts`, and that
 * is deliberate on both counts. `VehicleWrite` is "the columns a *person*
 * filled in" and it excludes these on purpose — a create path that transmits
 * visibility is a create path where a typo publishes somebody's truck. So
 * publishing is a separate write, and its shape lives next to
 * {@link mayReadRecord}, the rule that reads the same two columns back. One
 * file to open when asking what publishing means.
 *
 * Partial because the two are independent decisions (SHR-02 names them
 * separately): publishing a photo gallery is not publishing a maintenance
 * history with dates, odometer readings, and a home town in the vendor names.
 * A toggle sends the field it changed and says nothing about the other.
 */
export interface VehiclePublication {
  readonly is_showcase_public?: boolean;
  readonly is_worklog_public?: boolean;
}

/**
 * The per-record and per-field switches of SHR-02 and SHR-03, as a write.
 *
 * `is_cost_public` is not implied by `is_public` and must never become so:
 * SHR-03 is exactly the claim that "costs … stay private even on a public
 * work-log unless opened per record". Two fields, two decisions, and the same
 * partial shape as {@link VehiclePublication} for the same reason.
 */
export interface RecordPublication {
  readonly is_public?: boolean;
  readonly is_cost_public?: boolean;
}

/** Everything a masking decision needs, in one argument. */
export interface MaskInput {
  readonly record: RecordRow;
  readonly vehicle: VehicleRow;
  readonly principal: Principal;
}

/**
 * `true` when the record and the vehicle handed in are actually a pair.
 *
 * A caller that pairs a record with the wrong vehicle is asking a question with
 * no answer, and the two available wrong answers are "show it" and "hide it".
 * This module picks "hide it" — every gate below is `false` when the pair does
 * not hold — because the mistake is a programming error and the consequence of
 * guessing the other way is publishing one truck's history on another's page.
 */
function recordBelongsToVehicle(input: MaskInput): boolean {
  return input.record.vehicle_id === input.vehicle.id;
}

/**
 * May `principal` see this record at all?
 *
 * The two-switch structure holds through the whole module: this answers *row*
 * visibility and nothing else, and {@link costsAreOpen} answers *column*
 * visibility independently. SHR-03 is exactly the claim that those are two
 * questions — "costs … stay private even on a public work-log".
 */
function mayReadRecord(input: MaskInput): boolean {
  if (!recordBelongsToVehicle(input)) return false;
  const { record, vehicle, principal } = input;

  switch (principal.kind) {
    case "owner":
      // Their own truck, and only their own: a principal claiming ownership of
      // a vehicle they do not own is a bug, and it is the bug that would hand
      // one user another user's garage.
      return principal.userId === vehicle.owner_id;
    case "world":
      // Two switches, and the vehicle's is the outer one. A record marked
      // `is_public` on a vehicle whose work-log was never published is a record
      // the owner staged, not one they released.
      return vehicle.is_worklog_public && record.is_public;
    case "grant":
      // A grant admits its holder to ONE vehicle (SHR-05), and to that
      // vehicle's history whether or not the owner published any of it — that
      // is what the grant buys. The failure mode this guards is a reader that
      // resolves a token to an *owner* and then reads that owner's records,
      // which returns exactly the right answer for the single-vehicle case
      // everybody tests by hand.
      return principal.vehicleId === vehicle.id;
  }
}

/**
 * May `principal` see what it cost?
 *
 * Asked separately from {@link mayReadRecord} and never derived from it. For
 * the world the switch is the record's own `is_cost_public` (SHR-03); for a
 * grant holder it is the grant's `includes_costs` and *not* the record's flag —
 * the owner opened this history to this person, and a per-record public flag is
 * a decision about the public.
 */
function costsAreOpen(input: MaskInput): boolean {
  const { record, principal } = input;
  switch (principal.kind) {
    case "owner":
      return true;
    case "world":
      return record.is_cost_public;
    case "grant":
      return principal.includesCosts;
  }
}

/**
 * May `principal` see the receipt *rows* on this record?
 *
 * **The world never may**, and that is the conservative reading of two
 * requirements that point the same way. SHR-03: "Costs and receipts SHALL stay
 * private even on a public work-log unless opened per record." GAR-05′:
 * receipts are "never publicly accessible unless the specific record's cost
 * visibility is opened." The switch GAR-05′ names is `is_cost_public`, whose
 * label to the owner is about *what a job cost* — and a `ReceiptRow` carries
 * `storage_path`, which is `<owner uuid>/<file>` in a private bucket. Handing
 * that to an anonymous visitor publishes the owner's account id and a key into
 * storage in exchange for nothing, because the bytes behind it are unreachable
 * without a signature no static page can mint.
 *
 * So publishing an invoice is left to be a decision of its own rather than a
 * side effect of ticking "show the cost". Recorded as an open question on
 * T2-402 rather than decided quietly: if the owner wants the public to see
 * receipts, that is a third per-record flag, not a wider reading of this one.
 */
function receiptsAreOpen(input: MaskInput): boolean {
  const { principal } = input;
  switch (principal.kind) {
    case "owner":
      return true;
    case "world":
      return false;
    case "grant":
      return principal.includesReceipts;
  }
}

/**
 * The record as `principal` may see it, or `null` when they may not see it at
 * all.
 *
 * `null` rather than an empty record: "there is a record here you cannot read"
 * and "there is no record here" are different facts, and a page that cannot
 * tell them apart will render a heading over nothing.
 *
 * Built by naming every key that survives, so the visibility flags are absent
 * because nothing put them there. A published record carrying `is_public` and
 * `is_cost_public` would tell a reader which of the owner's *other* decisions
 * they are not seeing — small, and exactly the kind of thing that ships because
 * nobody asked.
 */
export function maskRecordForPrincipal(input: MaskInput): VisibleRecord | null {
  if (!mayReadRecord(input)) return null;
  const { record } = input;

  const visible: VisibleRecord = {
    id: record.id,
    vehicle_id: record.vehicle_id,
    occurred_on: record.occurred_on,
    kind: record.kind,
    title: record.title,
    body: record.body,
    time_minutes: record.time_minutes,
    odometer_km: record.odometer_km,
    problem_ids: record.problem_ids,
    part_ids: record.part_ids,
    procedure_ids: record.procedure_ids,
  };

  if (!costsAreOpen(input)) return visible;
  return {
    ...visible,
    cost_amount: record.cost_amount,
    cost_currency: record.cost_currency,
  };
}

/**
 * {@link maskRecordForPrincipal} over a timeline, **dropping** what is hidden.
 *
 * Dropped and not nulled: a list with holes in it is a list that leaks a count,
 * and "three records, two of which you may not see" is information the owner
 * did not publish.
 */
export function maskRecordsForPrincipal(input: {
  readonly records: readonly RecordRow[];
  readonly vehicle: VehicleRow;
  readonly principal: Principal;
}): readonly VisibleRecord[] {
  return input.records
    .map((record) =>
      maskRecordForPrincipal({
        record,
        vehicle: input.vehicle,
        principal: input.principal,
      })
    )
    .filter((record): record is VisibleRecord => record !== null);
}

/**
 * The receipts on a record that `principal` may see.
 *
 * Separate from the record masking because SHR-06 makes receipts a decision of
 * their own: a grant may open receipts and not costs, or costs and not
 * receipts, and folding them into one call is how that stops being true.
 *
 * Row visibility still gates it — a receipt hangs off a record, so a record the
 * principal may not read has no visible receipts however wide the capability
 * is.
 */
export function visibleReceipts(input: {
  readonly receipts: readonly ReceiptRow[];
  readonly record: RecordRow;
  readonly vehicle: VehicleRow;
  readonly principal: Principal;
}): readonly ReceiptRow[] {
  const decision: MaskInput = {
    record: input.record,
    vehicle: input.vehicle,
    principal: input.principal,
  };
  if (!mayReadRecord(decision)) return [];
  if (!receiptsAreOpen(decision)) return [];
  return input.receipts.filter(
    (receipt) => receipt.record_id === input.record.id
  );
}

/**
 * Whether a record may be surfaced as community first-hand evidence on a
 * problem page (GAR-04′).
 *
 * > **SHR-09** A grant SHALL NOT make a record eligible for the community
 * > evidence surfacing of GAR-04′. That path keys on a *public* work-log; a
 * > record visible to one grantee is not public, and treating it as such would
 * > put a private work-log on a public problem page.
 *
 * So this **ignores `principal` entirely**, and the parameter stays in the
 * signature to say so out loud: the caller has one, the honest answer does not
 * depend on it, and the shape of the function is what makes that checkable. If
 * eligibility varied by principal, then "can this person see it" and "is this
 * public" would be the same question — precisely the conflation SHR-09 forbids.
 *
 * The third clause is GAR-04′'s own: a record is surfaced *on a problem page*,
 * so a record referencing no problem has no page to appear on and publishing it
 * anyway would be surfacing a work-log entry for no reason at all.
 *
 * It lives here rather than in T2-403's own module because eligibility is a
 * *visibility* question, and asking it anywhere else is how it gets answered
 * with "can somebody see this" instead of "is this public".
 */
export function isEligibleForCommunityEvidence(input: {
  readonly record: RecordRow;
  readonly vehicle: VehicleRow;
  readonly principal: Principal;
}): boolean {
  const { record, vehicle } = input;
  if (record.vehicle_id !== vehicle.id) return false;
  return (
    vehicle.is_worklog_public &&
    record.is_public &&
    record.problem_ids.length > 0
  );
}
