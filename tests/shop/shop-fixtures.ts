/**
 * Behavioural helpers for the **T3-201 [TEST]** shop-membership and
 * roster-isolation graders — the one place a shop is created, an account is
 * invited and accepts, a self-join is attempted, and the shop roster is read.
 *
 * ## Same discipline as `fixtures.ts`
 *
 * Every RPC payload key comes from `contract.ts`'s pinned argument lists, for
 * the reason `fixtures.ts`'s header spells out (T2-401 F3): PostgREST resolves
 * an overload by argument *name*, so a call whose named arguments match no
 * function resolves to nothing and returns something a grader reading
 * `response.ok` cannot tell from a refusal. If `inviteToShop` spelled
 * `p_invitee_email` and the routine expected `p_email`, an invite that carried
 * no addressee would let *anyone* accept it — and the "no open join" proof
 * would pass for a fixture reason on the one behaviour it exists to check.
 *
 * The precondition helpers (`createShop`) throw the T3-202 seam (with status
 * and body) rather than returning a value a caller might read as a refusal, so
 * a live pre-T3-202 run fails with "create_shop answered 404", not "expected
 * undefined to be a string". The verb-style helpers (`inviteToShop`,
 * `acceptShopInvite`, `readShopRoster`, `selfJoinAttempt`) return the response
 * instead, because half their callers are asserting a *refusal* and a helper
 * that threw on non-2xx could not express that.
 *
 * refs specs/003-shop-tools (SHP-01, SHP-03, SHP-04)
 */
import {
  rpc,
  insertRow,
  type ApiResponse,
  type Actor,
  type Scenario,
} from "../garage/harness.ts";
import {
  ACCEPT_SHOP_INVITE_ARGUMENTS,
  ACCEPT_SHOP_INVITE_FUNCTION,
  CREATE_SHOP_ARGUMENTS,
  CREATE_SHOP_FUNCTION,
  CREATE_SHOP_RESULT_ID_FIELD,
  INVITE_RESULT_ID_FIELD,
  INVITE_TO_SHOP_ARGUMENTS,
  INVITE_TO_SHOP_FUNCTION,
  SHOP_MEMBERS_TABLE,
  SHOP_MEMBER_ACCOUNT_COLUMN,
  SHOP_MEMBER_SHOP_ID_COLUMN,
  SHOP_ROSTER_ARGUMENTS,
  SHOP_ROSTER_FUNCTION,
  shopSeam,
} from "./contract.ts";

/** The first row of a PostgREST body, whether it came back as an array or object. */
function firstRow(body: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(body))
    return body[0] as Record<string, unknown> | undefined;
  if (body && typeof body === "object") return body as Record<string, unknown>;
  return undefined;
}

/* -------------------------------------------------------------------------
 * Creating a shop (SHP-01)
 * ---------------------------------------------------------------------- */

/**
 * Create a shop as `owner`, who becomes its first member. A precondition of
 * every membership grader, so it throws the seam on failure rather than
 * returning a shop id a caller would then read as `undefined`.
 */
export async function createShop(
  scenario: Scenario,
  owner: Actor,
  name: string
): Promise<{ readonly shopId: string }> {
  const [nameArg] = CREATE_SHOP_ARGUMENTS;
  const response = await rpc(scenario, owner, CREATE_SHOP_FUNCTION, {
    [nameArg]: name,
  });
  if (!response.ok) {
    throw shopSeam(
      `${CREATE_SHOP_FUNCTION} answered ${response.status}: ${response.text}`
    );
  }
  const shopId = firstRow(response.body)?.[CREATE_SHOP_RESULT_ID_FIELD];
  if (typeof shopId !== "string" || !shopId) {
    throw shopSeam(
      `${CREATE_SHOP_FUNCTION} did not return {${CREATE_SHOP_RESULT_ID_FIELD}}: ` +
        response.text
    );
  }
  return { shopId };
}

/* -------------------------------------------------------------------------
 * Inviting and accepting (SHP-01)
 * ---------------------------------------------------------------------- */

/**
 * Invite `inviteeEmail` into `shopId` as `member`. Returns the response so a
 * caller can assert either success (a member invites) or refusal (a non-member
 * cannot).
 */
export function inviteToShop(
  scenario: Scenario,
  member: Actor,
  shopId: string,
  inviteeEmail: string
): Promise<ApiResponse> {
  const [shopArg, emailArg] = INVITE_TO_SHOP_ARGUMENTS;
  return rpc(scenario, member, INVITE_TO_SHOP_FUNCTION, {
    [shopArg]: shopId,
    [emailArg]: inviteeEmail,
  });
}

/** The invite id carried by an `inviteToShop` response, or `null`. */
export function inviteIdOf(response: ApiResponse): string | null {
  const id = firstRow(response.body)?.[INVITE_RESULT_ID_FIELD];
  return typeof id === "string" && id ? id : null;
}

/**
 * Accept invite `inviteId` as `actor` — becoming a member iff the invite is
 * addressed to `actor`'s own email. Returns the response so a caller can assert
 * success (the addressee) or refusal (anyone else).
 */
export function acceptShopInvite(
  scenario: Scenario,
  actor: Actor,
  inviteId: string
): Promise<ApiResponse> {
  const [idArg] = ACCEPT_SHOP_INVITE_ARGUMENTS;
  return rpc(scenario, actor, ACCEPT_SHOP_INVITE_FUNCTION, {
    [idArg]: inviteId,
  });
}

/**
 * The **open-join attempt**: `actor` tries to write its own membership row into
 * `shop_members` directly, bypassing any invite. SHP-01 requires this to be
 * refused — membership is written only by the security-definer
 * `accept_shop_invite`. The columns are the real ones so that, were there an
 * open-join grant or a self-scoped insert policy, this would *succeed* — the
 * proof has to be able to catch the hole it is looking for, not fail for a
 * wrong-column reason.
 */
export function selfJoinAttempt(
  scenario: Scenario,
  actor: Actor,
  shopId: string
): Promise<ApiResponse> {
  return insertRow(scenario, actor, SHOP_MEMBERS_TABLE, {
    [SHOP_MEMBER_SHOP_ID_COLUMN]: shopId,
    [SHOP_MEMBER_ACCOUNT_COLUMN]: actor.userId,
  });
}

/* -------------------------------------------------------------------------
 * Reading the shop roster (SHP-03, SHP-04)
 * ---------------------------------------------------------------------- */

/** Read `shopId`'s roster as `actor` — every shop-visible grant its members hold. */
export function readShopRoster(
  scenario: Scenario,
  actor: Actor,
  shopId: string
): Promise<ApiResponse> {
  const [shopArg] = SHOP_ROSTER_ARGUMENTS;
  return rpc(scenario, actor, SHOP_ROSTER_FUNCTION, { [shopArg]: shopId });
}
