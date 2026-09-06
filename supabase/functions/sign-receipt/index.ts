/**
 * `sign-receipt` — the Edge Function that **signs and does not decide**
 * (T2-404; 002 SHR-05..08, GAR-05′).
 *
 * ## Why this runtime exists at all
 *
 * A Postgres function cannot mint a Supabase signed URL. Signing is a
 * storage-api operation, which is the same wall T2-202 hit when it needed to
 * purge receipt *bytes* rather than receipt rows. So the job splits, and the
 * split is the whole security design:
 *
 * - **Postgres decides.** `public.share_read_receipts(p_token)` validates the
 *   token hash, the expiry and the revocation, checks `includes_receipts`, and
 *   resolves the storage paths the grant admits. Every one of those checks is
 *   graded by `tests/garage/share-instrument.test.ts` and `rules.ts`.
 * - **This function signs.** It signs a path that RPC handed back, and nothing
 *   else.
 *
 * **The one rule that makes the split safe: this function never accepts a
 * caller-supplied path.** If it did, every authorization decision in Postgres
 * would be advisory — the caller would name the object and the signer would
 * sign it, which is a storage-wide read primitive wearing a share-link
 * costume. There is no path parameter in the request shape, and the response
 * is built from what the database returned.
 *
 * ## Two clients, two keys, and the asymmetry is the point
 *
 * - The **anon** key calls the RPC. The whole authorization argument is that
 *   an anonymous caller presenting a token gets exactly what the grant opens,
 *   so this function asks the same question a browser would ask, as the same
 *   role. Calling it with the service key would bypass nothing (the routine is
 *   `security definer` either way) but it would make the request untestable as
 *   a proxy for the browser's, and it would put the service role one refactor
 *   away from the query.
 * - The **service** key signs. Storage policies are `to authenticated` with a
 *   path-derived owner check (T2-202), and a grant holder has no session — so
 *   nothing but the service role can mint this URL, and `storagePolicyIssues`
 *   would reject any attempt to widen those policies instead. The key is read
 *   from the platform's own injected environment; it is not in this repo and
 *   never reaches a browser (`src/lib/supabase/config.ts` structurally refuses
 *   one on that side).
 *
 * ## The TTL is a security parameter, not a tuning knob
 *
 * A signed URL is a bearer credential that has left the building: no session,
 * no revocation, works for whoever holds it. SHR-08 makes revocation take
 * effect "on the next request" — but a signature already minted *is* the
 * previous request's answer, and nothing recalls it. The TTL is therefore the
 * only thing bounding a leaked signature, which is why it is a constant here
 * and why `tests/garage/receipt-signer.test.ts` reads the literal rather than
 * trusting a name.
 *
 * ## CORS is not decoration here — without it the button does not work
 *
 * The caller is `src/lib/supabase/shares.ts`, running on `monterogarage.com`,
 * POSTing to the Supabase project's origin with `content-type:
 * application/json`, `apikey` and `authorization`. That is a **non-simple**
 * cross-origin request three times over, so every browser sends an `OPTIONS`
 * preflight first — and a preflight answered without
 * `Access-Control-Allow-Origin` fails before the POST is ever attempted. A
 * function that refuses `OPTIONS` is therefore not a stricter function; it is a
 * function whose only caller can never reach it, and the failure shows up in
 * the browser console rather than in any test that calls it with `fetch` from
 * Deno or Node (T2-404 review, F2).
 *
 * `*` for the origin, and that is not a weakening. This function holds no
 * ambient authority: no cookie, no session, nothing the browser attaches on its
 * own. Authorization is entirely the bearer token in the request body, so an
 * origin allow-list would only ever inconvenience a caller who already holds
 * the token — while breaking every Vercel preview deploy, which is how the
 * allow-list gets replaced with `*` in a hurry six months from now.
 *
 * The headers ride on **every** response, refusals included. A CORS header on
 * the success path alone means the browser cannot read the refusal either, and
 * an unreadable 403 surfaces to the page as a network failure — collapsing the
 * exact distinction `ShareResult` draws between "refused" and "failed".
 *
 * ## The refusal says nothing (SHR-08)
 *
 * Unknown token, expired grant, revoked grant, `includes_receipts = false`,
 * and a receipt id on a vehicle this grant does not reach all produce the same
 * status and the same body. The first four are already one answer because the
 * RPC gives one answer; the fifth is made to match here. A signer that said
 * "no such receipt" for one and "forbidden" for another would hand back the
 * existence oracle the database refused to be.
 *
 * refs specs/002-montero-garage (SHR-05, SHR-06, SHR-07, SHR-08, GAR-05′)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * The bucket receipts live in, as a constant.
 *
 * Never from the request and never from a variable a caller can influence: a
 * signer that took its bucket from anywhere else would be one parameter away
 * from signing `vehicle-photos`, a different bucket with a different consent
 * story (T2-301a) and no `includes_receipts` bit governing it.
 */
const RECEIPTS_BUCKET = "receipts";

/**
 * How long a signed receipt URL lives, in seconds.
 *
 * Named for the storage API's own parameter, and holding the literal: this is
 * the only number in the file and `receipt-signer.test.ts` reads it as a
 * literal rather than following a name to a declaration somewhere else. The
 * window comes from `SIGNED_URL_TTL_SECONDS` in `tests/garage/contract.ts` —
 * 60 seconds is the smallest that survives a slow mobile fetch in a workshop,
 * 300 the largest that still bounds a leaked signature to "minutes". This is
 * that ceiling: there is no reason for a shorter one and no authority for a
 * longer.
 */
const expiresIn = 300;

/** The RPC that decides. Named once; the graders read this string. */
const SHARE_RECEIPTS_READER = "share_read_receipts";

/** One refusal, for every reason. */
const REFUSED = { error: "share unavailable" };

/**
 * The preflight answer, and the prefix of every other answer.
 *
 * `apikey` and `authorization` are what the Supabase client sends; `x-client-info`
 * is what `@supabase/supabase-js` adds on its own, listed so that a future
 * caller built on the SDK rather than raw `fetch` does not fail a preflight for
 * a header nobody chose to send.
 */
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
} as const;

const JSON_HEADERS = {
  ...corsHeaders,
  "content-type": "application/json",
  // Belt for the surface the fragment already keeps out of the log: this
  // response is only ever fetched by the share page, and nothing about it
  // should be cached by an intermediary.
  "cache-control": "no-store",
} as const;

/** Refuse. Always the same status, always the same body. */
function refuse(): Response {
  return new Response(JSON.stringify(REFUSED), {
    status: 403,
    headers: JSON_HEADERS,
  });
}

/**
 * We could not check — an outage or a stalled deploy, never a decision
 * (T2-404 review, F9).
 *
 * Same shape as the "signer unconfigured" response above, and for the same
 * reason: CORS headers still attached, because a browser that cannot read a
 * failed response cannot tell it apart from a network error either, and a
 * distinct status from `refuse()`'s 403 so a Supabase outage never reads to a
 * holder — or to whoever is watching logs — as "share unavailable" the way a
 * revoked grant does.
 */
function unavailable(): Response {
  return new Response(JSON.stringify({ error: "could not check share" }), {
    status: 500,
    headers: JSON_HEADERS,
  });
}

/**
 * Did Postgres answer the RPC, or did the request never get there?
 *
 * The exact discriminator `src/lib/supabase/shares.ts`'s `serverAnswered`
 * uses on the same client library, read here because this function calls
 * `share_read_receipts` a second time rather than trusting the browser's copy
 * (the whole point of "Postgres decides" above). `postgrest-js` fills `code`
 * from the SQLSTATE in the server's response body, so a genuine refusal
 * carries one (`42501`, the `insufficient_privilege` every share reader
 * raises alike); when `fetch` itself never gets a response — a dead
 * `SUPABASE_URL`, a DNS failure, a timeout — the same library synthesises an
 * error with `code` set to `""` and `status: 0`, because a request that never
 * reached Postgres has no SQLSTATE to report.
 */
function serverAnswered(error: { readonly code?: string } | null): boolean {
  return typeof error?.code === "string" && error.code !== "";
}

/**
 * `PGRST202`: the routine is not in PostgREST's schema cache — a migration
 * that has not run against this project, not a token any grant ever issued.
 * The server did answer, so `serverAnswered` alone would call this a refusal;
 * it is this function's deploy being incomplete, the same class of problem as
 * the missing-env-var check above, and it is treated the same way.
 */
function isMissingRoutine(error: { readonly code?: string } | null): boolean {
  return error?.code === "PGRST202";
}

/**
 * Did Storage answer the signing request, or did it never get there?
 *
 * `storage-js` mints a `StorageApiError` — with a numeric `status` — when the
 * request reached the Storage API and got an HTTP response back, including a
 * 4xx or 5xx; it mints a `StorageUnknownError` — `status` left `undefined` —
 * when `fetch` rejected before any response existed. The same asymmetry
 * `serverAnswered` reads on the anon client above, one API over.
 */
function storageAnswered(error: { readonly status?: number } | null): boolean {
  return typeof error?.status === "number";
}

/** One receipt row as the RPC returns it. Only two fields are read. */
interface ResolvedReceipt {
  readonly id?: unknown;
  readonly storage_path?: unknown;
}

Deno.serve(async (request: Request): Promise<Response> => {
  // The preflight, answered before anything else and before any refusal: a
  // browser sends `OPTIONS` with no body and no credentials, and treating it as
  // "not a POST" makes the real POST unreachable.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") return refuse();

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    // A misconfigured deploy is not a refusal — it is this function being
    // broken — and saying so with the same 403 would make an outage look like
    // a revoked grant to everyone reading logs. AGENTS.md: a failure is not a
    // zero, and it is not a "no" either.
    return new Response(JSON.stringify({ error: "signer unconfigured" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return refuse();
  }

  const token = payload.token;
  const receiptId = payload.receipt_id;
  if (typeof token !== "string" || token === "") return refuse();
  if (typeof receiptId !== "string" || receiptId === "") return refuse();

  // Everything else in the payload is ignored, deliberately and by
  // construction: nothing below reads another key. A caller who sends a
  // `path` or a `storage_path` alongside these two has sent a field this
  // function does not have a name for.

  // --- Postgres decides -----------------------------------------------------
  // As `anon`, POSTed, with the token in the body — never in a query string,
  // which would put the credential back into the log the URL fragment kept it
  // out of.
  const asAnon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await asAnon.rpc(SHARE_RECEIPTS_READER, {
    p_token: token,
  });
  if (error) {
    // A dropped connection is not a "no" here either (T2-404 review, F9) —
    // confirmed by execution against a dead `SUPABASE_URL`, which came back
    // as this function's own 403 rather than the 500 an outage is.
    if (!serverAnswered(error) || isMissingRoutine(error)) return unavailable();
    return refuse();
  }
  // Not an array is not an empty array, same as `readAsHolder` in
  // `src/lib/supabase/shares.ts`: a reader that answered with something
  // unexpected is a failure, and rendering it as "this grant reaches
  // nothing" would be the failure-is-not-a-zero mistake one layer down.
  if (!Array.isArray(data)) return unavailable();

  const resolved = (data as ResolvedReceipt[]).find(
    (row) => row?.id === receiptId
  );
  const resolvedPath = resolved?.storage_path;
  // The receipt is on another vehicle — including another vehicle of the same
  // owner, which is the cell that gets built wrong. The grant admits its
  // holder to ONE vehicle (SHR-05), so a receipt the RPC did not return is a
  // receipt this token cannot reach, and it refuses in the same words as an
  // unknown token.
  if (typeof resolvedPath !== "string" || resolvedPath === "") return refuse();

  // --- This function signs --------------------------------------------------
  const asService = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await asService.storage
    .from(RECEIPTS_BUCKET)
    .createSignedUrl(resolvedPath, expiresIn);

  const signedUrl = signed.data?.signedUrl;
  if (signed.error) {
    // Same split as the RPC above: a Storage outage is not Storage refusing
    // the path Postgres already authorized.
    if (!storageAnswered(signed.error)) return unavailable();
    return refuse();
  }
  if (typeof signedUrl !== "string") return unavailable();

  return new Response(
    JSON.stringify({ url: signedUrl, expires_in: expiresIn }),
    { status: 200, headers: JSON_HEADERS }
  );
});
