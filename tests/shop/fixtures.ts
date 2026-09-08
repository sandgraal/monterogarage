/**
 * Behavioural helpers for the T3-101 roster / grant-binding graders — the one
 * place a named grant is issued, bound, extended, and read as a roster.
 *
 * ## Why the payloads are built from `contract.ts`'s pinned argument lists
 *
 * The same reason 002's `share-fixtures.ts` exists (T2-401 review, F3):
 * **PostgREST resolves an RPC overload by argument name**, so a call whose
 * named arguments match no function resolves to nothing and returns something a
 * grader reading `response.ok` cannot tell from a refusal. If `issueNamedGrant`
 * spelled `p_grantee_email` and the routine expected `p_email`, the grant would
 * carry no addressee, binding would then match nobody, and property 1's proof
 * would fail for a *fixture* reason on the one behaviour it exists to check. So
 * every payload key here comes from `contract.ts`, and the Tier-A signature
 * graders assert the routine takes those same names.
 *
 * ## Failures are loud and named
 *
 * `issueNamedGrant` throws the T3-102 seam (with status and body) rather than
 * returning a value a caller might read as a refusal — so a live pre-T3-102 run
 * fails with "create_share_grant answered 404" instead of "expected undefined
 * to be a string", which is the whole point of the seam convention. The
 * verb-style helpers (`bindGrant`, `readRoster`, `extendGrant`) return the
 * response instead, because half their callers are asserting a *refusal* and a
 * helper that threw on non-2xx could not express that.
 *
 * refs specs/003-shop-tools (MEC-05, MEC-06, SHP-03, SHP-04),
 * specs/002-montero-garage (SHR-05, SHR-06, SHR-08)
 */
import {
  SHARE_CREATE_ARGUMENTS,
  SHARE_CREATE_FUNCTION,
  SHARE_CREATE_RESULT_FIELDS,
  SHARE_GRANT_KINDS,
  testEmail,
} from "../garage/contract.ts";
import {
  adminCreateUser,
  adminDeleteUser,
  mintJwt,
  rpc,
  updateRows,
  type Actor,
  type ApiResponse,
  type Scenario,
} from "../garage/harness.ts";
import type { IssuedGrant } from "../garage/share-fixtures.ts";
import {
  BIND_GRANT_ARGUMENTS,
  BIND_GRANT_FUNCTION,
  MECHANIC_ROSTER_FUNCTION,
  ROSTER_VEHICLE_ID_FIELD,
  SHARE_EXTEND_ARGUMENTS,
  SHARE_EXTEND_FUNCTION,
  SHARE_GRANTEE_EMAIL_ARGUMENT,
  SHARE_SHOP_VISIBLE_ARGUMENT,
  SHARES_TABLE,
  rosterSeam,
} from "./contract.ts";

/* -------------------------------------------------------------------------
 * Extra actors
 * ---------------------------------------------------------------------- */

/**
 * Create one authenticated account beyond the scenario's owner A / owner B and
 * hand back an actor holding a JWT the local stack will accept.
 *
 * The properties need principals the two-owner scenario does not carry: a
 * *mechanic* (the addressee), a *stranger* (a wrong account that must not be
 * able to bind), and a *shopmate* (a second mechanic who must not see an
 * individual grant). Built with the admin API + `mintJwt`, exactly as
 * `provisionScenario` builds its owners, so the JWT carries the `email` claim
 * `auth.email()` reads — which is the claim binding turns on.
 *
 * The caller is responsible for `dropAuthedActor` in a `finally`.
 */
export async function makeAuthedActor(
  scenario: Scenario,
  slot: string
): Promise<Actor> {
  const email = testEmail(slot, scenario.runId);
  const created = await adminCreateUser(scenario.stack, {
    email,
    email_confirm: true,
  });
  if (!created.ok) {
    throw new Error(
      `could not create synthetic actor ${email}: ` +
        `${created.status} ${created.text}`
    );
  }
  const userId = (created.body as { id?: string }).id;
  if (!userId) {
    throw new Error(`auth admin returned no id for ${email}`);
  }
  return {
    slot,
    userId,
    email,
    token: mintJwt(
      { role: "authenticated", sub: userId, email },
      scenario.stack.jwtSecret
    ),
  };
}

/** Best-effort removal of an actor from `makeAuthedActor`. Never throws. */
export async function dropAuthedActor(
  scenario: Scenario,
  actor: Actor
): Promise<void> {
  if (!actor.userId) return;
  await adminDeleteUser(scenario.stack, actor.userId);
}

/* -------------------------------------------------------------------------
 * Issuing a named grant
 * ---------------------------------------------------------------------- */

/** How a named grant differs from the default (private, 24 h, `mechanic`). */
export interface NamedGrantOptions {
  /** The email the grant is issued to (MEC-06). Omit for an anonymous link. */
  readonly granteeEmail?: string | null;
  /** SHP-04: visible to the shop (`true`) or the individual only (`false`). */
  readonly shopVisible?: boolean;
  readonly includesCosts?: boolean;
  readonly includesReceipts?: boolean;
  readonly expiresInHours?: number;
  readonly kind?: (typeof SHARE_GRANT_KINDS)[number];
}

/**
 * Issue a grant on `vehicleId` as `owner`, addressed to an email and carrying a
 * shop-visibility choice — the extended 002 `create_share_grant` (MEC-06,
 * SHP-04). Every key comes from the pinned argument lists; see this file's
 * header for why that matters.
 */
export async function issueNamedGrant(
  scenario: Scenario,
  owner: Actor,
  vehicleId: string,
  options: NamedGrantOptions = {}
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
  });
  if (!response.ok) {
    throw rosterSeam(
      `${SHARE_CREATE_FUNCTION} answered ${response.status}: ${response.text}`
    );
  }

  const [idField, tokenField] = SHARE_CREATE_RESULT_FIELDS;
  const row = Array.isArray(response.body)
    ? (response.body[0] as Record<string, unknown> | undefined)
    : (response.body as Record<string, unknown> | null);
  const shareId = row?.[idField];
  const token = row?.[tokenField];
  if (typeof shareId !== "string" || typeof token !== "string" || !token) {
    throw rosterSeam(
      `${SHARE_CREATE_FUNCTION} did not return {${idField}, ${tokenField}}: ` +
        response.text
    );
  }
  return { shareId, token, response };
}

/* -------------------------------------------------------------------------
 * Binding, the roster, extending
 * ---------------------------------------------------------------------- */

/** Bind a grant to `actor`'s account by presenting its token. */
export function bindGrant(
  scenario: Scenario,
  actor: Actor,
  token: string
): Promise<ApiResponse> {
  const [tokenArg] = BIND_GRANT_ARGUMENTS;
  return rpc(scenario, actor, BIND_GRANT_FUNCTION, { [tokenArg]: token });
}

/** Read `actor`'s roster — every vehicle they hold a live bound grant on. */
export function readRoster(
  scenario: Scenario,
  actor: Actor
): Promise<ApiResponse> {
  return rpc(scenario, actor, MECHANIC_ROSTER_FUNCTION, {});
}

/** Extend one grant to "until revoked", by id, as `actor`. */
export function extendGrant(
  scenario: Scenario,
  actor: Actor,
  shareId: string
): Promise<ApiResponse> {
  const [idArg] = SHARE_EXTEND_ARGUMENTS;
  return rpc(scenario, actor, SHARE_EXTEND_FUNCTION, { [idArg]: shareId });
}

/**
 * `true` when `vehicleId` appears on the roster response.
 *
 * Reads `ROSTER_VEHICLE_ID_FIELD` off each row. A non-array body yields
 * `false` — but callers must assert `response.ok` first, so a *failed* roster
 * read never masquerades as a clean "not on the roster" (the failure-is-not-a-
 * zero rule this repo has paid for three times). The `-1`-style sentinel is not
 * needed here because the boolean question is only ever asked after `ok` is
 * proven true.
 */
export function rosterHasVehicle(
  response: ApiResponse,
  vehicleId: string
): boolean {
  const rows: Record<string, unknown>[] = Array.isArray(response.body)
    ? (response.body as Record<string, unknown>[])
    : [];
  return rows.some((row) => row[ROSTER_VEHICLE_ID_FIELD] === vehicleId);
}

/**
 * Move a grant's expiry into the past, as its owner, to make "the grant
 * expired" observable without waiting an hour.
 *
 * This is the roster's expiry filter under test (property 3): the row is
 * untouched except for `expires_at`, so a roster that still lists the vehicle
 * afterward is a roster that cached membership at bind time instead of
 * consulting liveness per request. Done as the *owner* through the 002
 * "shares owner all" policy — a real path, not a service-role bypass.
 */
export function expireGrant(
  scenario: Scenario,
  owner: Actor,
  shareId: string
): Promise<ApiResponse> {
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return updateRows(scenario, owner, SHARES_TABLE, `id=eq.${shareId}`, {
    expires_at: past,
  });
}
