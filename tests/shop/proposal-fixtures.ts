/**
 * Behavioural helpers for the **T3-301 [TEST]** propose-and-accept graders — the
 * one place a `can_propose` grant is issued, a proposal is submitted, read,
 * withdrawn, rejected, and accepted, and a forged `records` write is attempted.
 *
 * ## Same discipline as `fixtures.ts` / `shop-fixtures.ts`
 *
 * Every RPC payload key comes from `contract.ts`'s pinned argument lists, for
 * the reason those files' headers spell out (T2-401 F3): PostgREST resolves an
 * overload by argument *name*, so a call whose named arguments match no
 * function resolves to nothing and returns something a grader reading
 * `response.ok` cannot tell from a refusal. If `issueProposeGrant` spelled
 * `p_can_propose` wrong, the grant would open no propose capability, and PRO-01
 * would "pass" for a fixture reason on the one behaviour it exists to check.
 *
 * The precondition helper (`issueProposeGrant`) throws the T3-302 seam (with
 * status and body) rather than returning a value a caller might read as a
 * refusal, so a live pre-T3-302 run fails with "create_share_grant answered
 * 404", not "expected undefined to be a string". The verb-style helpers
 * (`submitProposal`, `acceptProposal`, `rejectProposal`, `withdrawProposal`,
 * `readProposals`, `forgeRecordInsert`) return the response instead, because
 * half their callers are asserting a *refusal* and a helper that threw on
 * non-2xx could not express that.
 *
 * ## Why a separate grant-issuing helper, not `fixtures.ts`' `issueNamedGrant`
 *
 * `issueNamedGrant` (T3-101) sends the 002+T3-102 argument set and MUST keep
 * doing exactly that — extending it to always send `p_can_propose` would make
 * every T3-101 roster call resolve to no overload against the *current*
 * `create_share_grant` (which has no `p_can_propose` yet). So the propose grant
 * is issued here, from the same pinned argument constants, with the third 003
 * argument added. No arg-name drift: the constants are the single source.
 *
 * refs specs/003-shop-tools (PRO-01..06), specs/002-montero-garage (SHR-05..09)
 */
import {
  SHARE_CREATE_ARGUMENTS,
  SHARE_CREATE_FUNCTION,
  SHARE_CREATE_RESULT_FIELDS,
  SHARE_GRANT_KINDS,
  SHARE_REVOKE_ARGUMENTS,
  SHARE_REVOKE_FUNCTION,
} from "../garage/contract.ts";
import {
  deleteRows,
  insertRow,
  rpc,
  selectRows,
  type ApiResponse,
  type Actor,
  type Scenario,
} from "../garage/harness.ts";
import type { IssuedGrant } from "../garage/share-fixtures.ts";
import {
  ACCEPT_PROPOSAL_ARGUMENTS,
  ACCEPT_PROPOSAL_FUNCTION,
  PROPOSALS_TABLE,
  PROPOSAL_OWNER_COLUMN,
  PROPOSAL_PROPOSED_BY_COLUMN,
  PROPOSAL_VEHICLE_COLUMN,
  RECORDS_TABLE,
  SHARE_CAN_PROPOSE_ARGUMENT,
  SHARE_GRANTEE_EMAIL_ARGUMENT,
  SHARE_SHOP_VISIBLE_ARGUMENT,
  proposalSeam,
} from "./contract.ts";

/** The first row of a PostgREST body, array or object, else undefined. */
function firstRow(body: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(body))
    return body[0] as Record<string, unknown> | undefined;
  if (body && typeof body === "object") return body as Record<string, unknown>;
  return undefined;
}

/* -------------------------------------------------------------------------
 * Issuing a grant that opens `can_propose` (PRO-01)
 * ---------------------------------------------------------------------- */

/** How a propose grant differs from the default. */
export interface ProposeGrantOptions {
  /** PRO-01: does the grant open the propose write path? Defaults to `true`. */
  readonly canPropose?: boolean;
  /** The email the grant is issued to (MEC-06). */
  readonly granteeEmail?: string | null;
  readonly shopVisible?: boolean;
  readonly includesCosts?: boolean;
  readonly includesReceipts?: boolean;
  readonly expiresInHours?: number;
  readonly kind?: (typeof SHARE_GRANT_KINDS)[number];
}

/**
 * Issue a grant on `vehicleId` as `owner`, carrying the `can_propose` choice —
 * the extended 002/003 `create_share_grant`. Throws the seam on failure so a
 * pre-T3-302 live run is loud and named.
 */
export async function issueProposeGrant(
  scenario: Scenario,
  owner: Actor,
  vehicleId: string,
  options: ProposeGrantOptions = {}
): Promise<IssuedGrant> {
  const [vehicle, kind, costs, receipts, expiry] = SHARE_CREATE_ARGUMENTS;
  const response = await rpc(scenario, owner, SHARE_CREATE_FUNCTION, {
    [vehicle]: vehicleId,
    [kind]: options.kind ?? SHARE_GRANT_KINDS[0],
    [costs]: options.includesCosts ?? false,
    [receipts]: options.includesReceipts ?? false,
    [expiry]: options.expiresInHours ?? 24,
    [SHARE_GRANTEE_EMAIL_ARGUMENT]: options.granteeEmail ?? null,
    [SHARE_SHOP_VISIBLE_ARGUMENT]: options.shopVisible ?? false,
    [SHARE_CAN_PROPOSE_ARGUMENT]: options.canPropose ?? true,
  });
  if (!response.ok) {
    throw proposalSeam(
      `${SHARE_CREATE_FUNCTION} answered ${response.status}: ${response.text}`
    );
  }
  const [idField, tokenField] = SHARE_CREATE_RESULT_FIELDS;
  const row = firstRow(response.body);
  const shareId = row?.[idField];
  const token = row?.[tokenField];
  if (typeof shareId !== "string" || typeof token !== "string" || !token) {
    throw proposalSeam(
      `${SHARE_CREATE_FUNCTION} did not return {${idField}, ${tokenField}}: ` +
        response.text
    );
  }
  return { shareId, token, response };
}

/** Revoke a grant, by id, as its issuer (002's `revoke_share_grant`, re-used). */
export function revokeGrant(
  scenario: Scenario,
  owner: Actor,
  shareId: string
): Promise<ApiResponse> {
  const [idArg] = SHARE_REVOKE_ARGUMENTS;
  return rpc(scenario, owner, SHARE_REVOKE_FUNCTION, { [idArg]: shareId });
}

/* -------------------------------------------------------------------------
 * Submitting a proposal (PRO-01) — a direct INSERT governed by RLS
 * ---------------------------------------------------------------------- */

/** The fields a proposal insert carries beyond the three identity columns. */
export interface ProposalPayload {
  readonly occurredOn?: string;
  readonly kind?: string;
  readonly costAmount?: number | null;
  readonly costCurrency?: string | null;
}

/**
 * Submit a proposal as `mechanic` against `vehicleId` owned by `ownerId` — the
 * PRO-01 write path, a direct INSERT the proposer RLS policy governs.
 *
 * The `owner_id` is supplied (the test knows it) so the insert works whether
 * T3-302 validates it in the policy's `with check` or derives it by trigger:
 * supplying the correct value satisfies a check, and a trigger that re-derives
 * it writes the same value. Returns the response so a caller can assert success
 * (a live `can_propose` grant) or refusal (no grant, wrong capability, revoked,
 * or expired).
 */
export function submitProposal(
  scenario: Scenario,
  mechanic: Actor,
  ownerId: string,
  vehicleId: string,
  payload: ProposalPayload = {}
): Promise<ApiResponse> {
  return insertRow(scenario, mechanic, PROPOSALS_TABLE, {
    [PROPOSAL_OWNER_COLUMN]: ownerId,
    [PROPOSAL_VEHICLE_COLUMN]: vehicleId,
    [PROPOSAL_PROPOSED_BY_COLUMN]: mechanic.userId,
    occurred_on: payload.occurredOn ?? "2026-09-08",
    kind: payload.kind ?? "work",
    cost_amount: payload.costAmount ?? 45000,
    cost_currency: payload.costCurrency ?? "CRC",
  });
}

/** The proposal id carried by a `submitProposal` response, or `null`. */
export function proposalIdOf(response: ApiResponse): string | null {
  const id = firstRow(response.body)?.id;
  return typeof id === "string" && id ? id : null;
}

/** Read the proposals `actor` can see (their own, or the owner's inbox). */
export function readProposals(
  scenario: Scenario,
  actor: Actor
): Promise<ApiResponse> {
  return selectRows(scenario, actor, PROPOSALS_TABLE, "select=*");
}

/** `true` when `proposalId` appears in a proposals read. Caller asserts `ok` first. */
export function proposalsInclude(
  response: ApiResponse,
  proposalId: string
): boolean {
  const rows: Record<string, unknown>[] = Array.isArray(response.body)
    ? (response.body as Record<string, unknown>[])
    : [];
  return rows.some((row) => row.id === proposalId);
}

/* -------------------------------------------------------------------------
 * Accepting, rejecting, withdrawing (PRO-02, PRO-06)
 * ---------------------------------------------------------------------- */

/** Accept a proposal as `owner` — the one write into `records` (PRO-02). */
export function acceptProposal(
  scenario: Scenario,
  owner: Actor,
  proposalId: string
): Promise<ApiResponse> {
  const [idArg] = ACCEPT_PROPOSAL_ARGUMENTS;
  return rpc(scenario, owner, ACCEPT_PROPOSAL_FUNCTION, {
    [idArg]: proposalId,
  });
}

/** Reject a proposal as `owner` — a DELETE via the owner policy (creates none). */
export function rejectProposal(
  scenario: Scenario,
  owner: Actor,
  proposalId: string
): Promise<ApiResponse> {
  return deleteRows(scenario, owner, PROPOSALS_TABLE, `id=eq.${proposalId}`);
}

/** Withdraw a proposal as `mechanic` — a DELETE via the proposer policy (PRO-04). */
export function withdrawProposal(
  scenario: Scenario,
  mechanic: Actor,
  proposalId: string
): Promise<ApiResponse> {
  return deleteRows(scenario, mechanic, PROPOSALS_TABLE, `id=eq.${proposalId}`);
}

/* -------------------------------------------------------------------------
 * Reading records, and the forgery attempt (PRO-02, PRO-03)
 * ---------------------------------------------------------------------- */

/** Read `owner`'s records on `vehicleId`, so a grader can count them. */
export function readVehicleRecords(
  scenario: Scenario,
  owner: Actor,
  vehicleId: string
): Promise<ApiResponse> {
  return selectRows(
    scenario,
    owner,
    RECORDS_TABLE,
    `select=*&vehicle_id=eq.${vehicleId}`
  );
}

/**
 * The **forgery attempt** (PRO-02, PRO-03): a mechanic tries to write a record
 * directly onto the owner's vehicle, bypassing acceptance. 002's `records`
 * insert policy is owner-only, so this must be refused — the columns are the
 * real ones so that, were there a non-owner insert path, this would *succeed*;
 * the proof has to be able to catch the hole it looks for.
 */
export function forgeRecordInsert(
  scenario: Scenario,
  mechanic: Actor,
  vehicleId: string
): Promise<ApiResponse> {
  return insertRow(scenario, mechanic, RECORDS_TABLE, {
    vehicle_id: vehicleId,
    occurred_on: "2026-09-08",
    kind: "work",
    cost_amount: 45000,
    cost_currency: "CRC",
  });
}
