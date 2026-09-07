/**
 * Which published trucks a problem page looks to for community first-hand
 * evidence — the discovery seam for GAR-04′ (T2-403).
 *
 * ## Why this is a curated list and not a query
 *
 * GAR-04′ surfaces "community first-hand evidence" — records from *other
 * owners'* published work-logs — on a reference problem page. Answering "every
 * published record that names this problem, across every truck" needs an
 * enumeration this platform deliberately cannot do from the surface a problem
 * page has:
 *
 *  - **The site is static** (AGENTS.md — Astro, static output on Vercel). There
 *    is no request-time server to run such a query for an anonymous visitor;
 *    the showcase and work-log pages solve the same problem by fetching one
 *    named vehicle from the browser at runtime, never by enumerating.
 *  - **The anon surface is exactly three per-vehicle readers** (SHR-05..09,
 *    pinned by `tests/garage/share-instrument.test.ts` and
 *    `share-grants.test.ts`). `share_read_records` answers "this handle's this
 *    truck's published records", never "every truck's". A fourth anon routine
 *    that enumerated published trucks would be the widening SHR-09 forbids — an
 *    anon-reachable routine reading a publication flag that is not a declared
 *    share reader — so it is not an edit an implementer makes.
 *  - **There is no service key in this repo** (AGENTS.md; `config.ts`'s
 *    `isSecretKey` refuses one on sight), so there is no build-time query that
 *    bypasses row-level security to enumerate either.
 *
 * A scalable answer — a public, world-masked read-model of published-and-opted
 * records, populated by CI the way `search_index_entries` is (RM-01/RM-02), and
 * exempted in `tests/garage/contract.ts`'s table map — is a schema and
 * infrastructure decision, not a drive-by (AGENTS.md). Until it exists, the
 * surface is driven by this explicit list: each entry is a truck whose owner
 * published its work-log (SHR-02) and is content to have its first-hand records
 * appear on the matching problem pages. The eligibility of any individual
 * record is still the database's and {@link selectCommunityEvidence}'s to
 * decide, per record, at read time — this list only says *where to look*, never
 * *what to show*.
 *
 * ## Why the entries are safe to keep in git
 *
 * A `handle` and a `vehicleId` are already public: they are the showcase URL
 * (SHR-02). Nothing here is a secret, and nothing here is a record — the
 * records are read from the live database in the visitor's browser, world-masked
 * by the same reader the work-log page uses, so a truck that later unpublishes
 * simply stops returning rows and its evidence disappears on the next visit.
 *
 * Empty today: Gitana Blanca (MIG-04, user page #1) is seeded into the hosted
 * database, not into git, so her `vehicleId` is not a value this file may
 * invent. Registering the first source is an owner/conductor action once the
 * hosted vehicle id is known.
 *
 * refs specs/002-montero-garage (GAR-04′, SHR-02, SHR-09, MIG-03, MIG-04)
 */

/** One published truck a problem page may show first-hand evidence from. */
export interface CommunityEvidenceVehicleRef {
  /** The public handle the vehicle is published under (SHR-02). */
  readonly handle: string;
  /** The vehicle's id, as it appears in its public showcase URL. */
  readonly vehicleId: string;
}

/**
 * The registered sources, in a stable order. Empty until the first published
 * truck is registered — see the module note on why this is a curated list.
 */
const COMMUNITY_EVIDENCE_SOURCES: readonly CommunityEvidenceVehicleRef[] = [];

/**
 * The published trucks a problem page looks to for community evidence.
 *
 * A function rather than a bare export so a future read-model (RM-01/RM-02) can
 * replace the source of this list without every caller changing — the problem
 * page asks *for the list*, it does not read a constant.
 */
export function communityEvidenceSources(): readonly CommunityEvidenceVehicleRef[] {
  return COMMUNITY_EVIDENCE_SOURCES;
}
