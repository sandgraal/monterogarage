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

const JSON_HEADERS = {
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

/** One receipt row as the RPC returns it. Only two fields are read. */
interface ResolvedReceipt {
  readonly id?: unknown;
  readonly storage_path?: unknown;
}

Deno.serve(async (request: Request): Promise<Response> => {
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
  if (error || !Array.isArray(data)) return refuse();

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
  if (signed.error || typeof signedUrl !== "string") return refuse();

  return new Response(
    JSON.stringify({ url: signedUrl, expires_in: expiresIn }),
    { status: 200, headers: JSON_HEADERS }
  );
});
