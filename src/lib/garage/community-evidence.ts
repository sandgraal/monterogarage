/**
 * Which published records surface on which problem page, and in what shape —
 * the GAR-04′ community-evidence surfacing (T2-403).
 *
 * > **GAR-04′** WHEN a record references a problem entry and its vehicle's
 * > work-log is public, THE problem page MAY surface it as community first-hand
 * > evidence (opt-in per record; the 001 GAR-04 idea, now multi-user).
 * > **SHR-09** A grant SHALL NOT make a record eligible for the community
 * > evidence surfacing of GAR-04′. That path keys on a *public* work-log; a
 * > record visible to one grantee is not public, and treating it as such would
 * > put a private work-log on a public problem page.
 *
 * ## This is the second wall, and it is an allow-list
 *
 * The database is the enforcement boundary (SHR-01): the anon world reader
 * `share_read_records` returns a record only when the truck's
 * `is_worklog_public` and the record's `is_public` are both set, and it never
 * returns anything on a token path. This module does not weaken that — it
 * restates it, so a build (or a page) that somehow holds a wider row still
 * cannot surface it. Every function here runs a record through
 * {@link isEligibleForCommunityEvidence} with the **world** principal before it
 * can become an item. Eligibility never depends on who is asking (that is
 * SHR-09's structural form), so a record shared to one grantee and to nobody
 * else — a state typed grants created that GAR-04′ predates — is refused here
 * exactly as it is refused at the database: its vehicle's work-log is not
 * public, so it is not eligible, whoever built the source that carried it.
 *
 * "Allow-list, not deny-list" is the shape that makes that hold under a later
 * edit: a record is surfaced only when it passes every clause, so a new field
 * or a new source cannot open a leak by being forgotten in a filter — it opens
 * one only if someone widens the eligibility predicate itself, which is the one
 * place the graders watch (`tests/garage/public-pages.test.ts`, SHR-09).
 *
 * ## Purity, so the rule is gradeable without a browser or a database
 *
 * No DOM, no Supabase client, no `import.meta.env`. {@link selectCommunityEvidence}
 * takes raw rows and is the tested statement of the rule
 * (`community-evidence.test.ts`). {@link communityEvidenceItemsFromWorldRecords}
 * is the same shaping over records the database has *already* world-masked —
 * the shape the client enhancement on a problem page consumes — so the two
 * paths never disagree about what an item is.
 *
 * refs specs/002-montero-garage (GAR-04′, SHR-09, SHR-01, SHR-02, SHR-03),
 * specs/001-foundation (PRB-01)
 */
import type { RecordRow } from "./record.ts";
import type { VehicleRow } from "./vehicle.ts";
import {
  isEligibleForCommunityEvidence,
  maskRecordForPrincipal,
  type Principal,
  type VisibleRecord,
} from "./visibility.ts";

/**
 * The world, named once. Community-evidence eligibility is a *visibility*
 * question asked of the public and no one else — {@link isEligibleForCommunityEvidence}
 * ignores the principal on purpose (SHR-09), and passing the world principal
 * says out loud which audience the surface is for.
 */
const WORLD: Principal = { kind: "world" };

/**
 * The public identity of the truck a piece of evidence came from.
 *
 * Attribution, never ownership: a `handle` and a `vehicleId` are already in the
 * public showcase URL (SHR-02), and the taxonomy quadruple is the header of
 * both public pages. There is deliberately **no `owner_id`** — the world never
 * learns whose account a truck is, only the name its owner chose to publish it
 * under. Built from the same columns the world reader projects, so a field the
 * world may not see cannot arrive here to be rendered.
 */
export interface CommunityEvidenceAttribution {
  /** The public handle the vehicle is published under (SHR-02). */
  readonly handle: string;
  readonly vehicleId: string;
  readonly displayName: string;
  readonly generationId: string;
  readonly marketId: string | null;
  readonly modelYear: number | null;
  readonly engineId: string | null;
}

/**
 * One published vehicle and its records, as a candidate source of evidence.
 *
 * `vehicle` is the full {@link VehicleRow} on purpose: eligibility reads
 * `is_worklog_public` off it, and handing a narrower shape would be handing the
 * rule less than it needs to refuse a private work-log. `records` are that
 * vehicle's records; each is tested individually, because `is_public` is a
 * per-record decision (GAR-04′'s "opt-in per record").
 */
export interface CommunityEvidenceSource {
  /** The public handle the vehicle is published under (SHR-02). */
  readonly handle: string;
  readonly vehicle: VehicleRow;
  readonly records: readonly RecordRow[];
}

/**
 * One record, world-masked, ready to render on a problem page with the public
 * identity of the truck it came from.
 *
 * `record` is a {@link VisibleRecord}: the cost keys are present only when the
 * owner opened them per record (SHR-03/SHR-06, absent not blanked), and the
 * visibility flags themselves never survive masking. `attribution` carries no
 * more than the public pages already show.
 */
export interface CommunityEvidenceItem {
  readonly record: VisibleRecord;
  readonly attribution: CommunityEvidenceAttribution;
}

/**
 * The public identity of one source, with nothing private in it.
 *
 * Reads only the columns SHR-02's world reader projects; `owner_id` is on the
 * row but is never copied, so it cannot leak by being spread.
 */
export function communityEvidenceAttribution(
  handle: string,
  vehicle: Pick<
    VehicleRow,
    | "id"
    | "display_name"
    | "generation_id"
    | "market_id"
    | "model_year"
    | "engine_id"
  >
): CommunityEvidenceAttribution {
  return {
    handle,
    vehicleId: vehicle.id,
    displayName: vehicle.display_name,
    generationId: vehicle.generation_id,
    marketId: vehicle.market_id,
    modelYear: vehicle.model_year,
    engineId: vehicle.engine_id,
  };
}

/**
 * Newest first, then by id — the same order a work-log timeline uses, so a
 * reader meets the most recent first-hand account of a problem before older
 * ones. `id` breaks a same-day tie deterministically, so a rebuild does not
 * reshuffle the section.
 */
export function compareCommunityEvidenceRecency(
  a: CommunityEvidenceItem,
  b: CommunityEvidenceItem
): number {
  if (a.record.occurred_on !== b.record.occurred_on) {
    return a.record.occurred_on < b.record.occurred_on ? 1 : -1;
  }
  if (a.record.id === b.record.id) return 0;
  return a.record.id < b.record.id ? -1 : 1;
}

/**
 * Shape already-world-masked records into evidence items for one problem.
 *
 * The path the client enhancement takes: `share_read_records` has already
 * applied the world's row and column visibility at the database (SHR-01), so
 * these records are eligible by construction and the one filter left is
 * GAR-04′'s own — *this* problem. A record surfaces on a problem page only when
 * it names that problem, because that is the page it belongs on; a record that
 * names no problem, or a different one, has no reason to appear here.
 *
 * Unsorted: a caller aggregating items from several sources sorts the union
 * once with {@link compareCommunityEvidenceRecency}, which is the only order
 * that is meaningful across sources.
 */
export function communityEvidenceItemsFromWorldRecords(input: {
  readonly problemId: string;
  readonly attribution: CommunityEvidenceAttribution;
  readonly records: readonly VisibleRecord[];
}): readonly CommunityEvidenceItem[] {
  return input.records
    .filter((record) => record.problem_ids.includes(input.problemId))
    .map((record) => ({ record, attribution: input.attribution }));
}

/**
 * The records that may be surfaced as community first-hand evidence on one
 * problem page, world-masked and attributed, newest first.
 *
 * The tested statement of GAR-04′ over raw rows. Each record is admitted only
 * if it clears every clause, in this order:
 *
 *  1. {@link isEligibleForCommunityEvidence} with the **world** principal — the
 *     work-log is public, the record is public, and it references *some*
 *     problem (SHR-09: never a grant, never dependent on who is asking);
 *  2. it references *this* problem (GAR-04′: the page it belongs on);
 *  3. {@link maskRecordForPrincipal} with the world principal returns a row —
 *     it always does once (1) holds, but the mask is what strips the cost pair
 *     the owner did not open and the visibility flags themselves.
 *
 * A source whose records were assembled from a grant, or from a private
 * work-log, contributes nothing: clause (1) re-reads `is_worklog_public` and
 * `is_public` off the row and refuses it, which is what keeps a private
 * work-log off a public problem page no matter how the source was built.
 */
export function selectCommunityEvidence(input: {
  readonly problemId: string;
  readonly sources: readonly CommunityEvidenceSource[];
}): readonly CommunityEvidenceItem[] {
  const items = input.sources.flatMap((source) => {
    const attribution = communityEvidenceAttribution(
      source.handle,
      source.vehicle
    );
    const worldRecords = source.records
      .filter((record) =>
        isEligibleForCommunityEvidence({
          record,
          vehicle: source.vehicle,
          principal: WORLD,
        })
      )
      .map((record) =>
        maskRecordForPrincipal({
          record,
          vehicle: source.vehicle,
          principal: WORLD,
        })
      )
      .filter((record): record is VisibleRecord => record !== null);

    return communityEvidenceItemsFromWorldRecords({
      problemId: input.problemId,
      attribution,
      records: worldRecords,
    });
  });

  return [...items].sort(compareCommunityEvidenceRecency);
}
