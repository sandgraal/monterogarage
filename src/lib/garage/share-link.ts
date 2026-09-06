/**
 * Where a share token lives in a URL — declared by T2-401 [TEST], filled by
 * T2-404 [PLATFORM].
 *
 * ## The whole module is one decision, and it is a security decision
 *
 * A share token is a bearer credential (SHR-05). Every place a URL is recorded
 * is a place that credential leaks, and the list is longer than it looks: the
 * Vercel edge log, the Supabase request log, the browser's history and its
 * sync, the `Referer` header on every outbound link and every third-party
 * asset, an analytics beacon, a proxy, a shoulder, a screenshot.
 *
 * **A fragment reaches no server.** `https://…/s/#t=<token>` is sent to the
 * origin as `https://…/s/`; the fragment never leaves the browser, appears in
 * no access log, and is not part of any `Referer`. A path segment or a query
 * parameter is the opposite of that in every respect — and a path token also
 * cannot be prerendered, so it would force SSR (001 SCF-01) for no benefit at
 * all.
 *
 * The three rules, and each is graded separately because each fails on its own:
 *
 * 1. **The token is in the fragment.** {@link shareLinkFor} puts it there;
 *    `share-delivery.test.ts` asserts no route under `src/pages/` takes a token
 *    as a path segment or a search parameter.
 * 2. **The client POSTs it, never GETs it.** A `GET /rest/v1/rpc/x?token=…`
 *    puts the credential straight back into the log the fragment kept it out
 *    of. PostgREST accepts RPC over both verbs, so this is a real choice
 *    somebody can make wrongly. `src/lib/supabase/shares.ts` is the only caller
 *    and it goes through `supabase-js`'s `rpc()`, which POSTs.
 * 3. **`Referrer-Policy: no-referrer` on the share page.** The fragment is not
 *    in a `Referer`, but the *path* still is, and the path names a page that
 *    exists only because somebody was given a grant. `vercel.json` carries the
 *    `headers` block that sends it.
 *
 * refs specs/002-montero-garage (SHR-05, SHR-07, SHR-08), 003 (MEC-04)
 */
import { localeHref, type Locale } from "../../i18n/routing.ts";
import { SHARE_ROUTE_SEGMENTS } from "./share-route.ts";

/**
 * The fragment key the token travels under.
 *
 * Named rather than spelled inline in two places, because the writer and the
 * reader disagreeing about it is a bug whose symptom is "the link does not
 * work", which somebody fixes by moving the token into the query string.
 */
export const SHARE_TOKEN_FRAGMENT_KEY = "t";

/**
 * The share page's route in `locale`, **without** the locale prefix or the
 * deploy base — the same shape `collectionRoutePath` returns, so
 * `localeHref` can add both at the moment a link is rendered.
 *
 * The segment pair is shared with `src/i18n/routes.ts` through
 * `./share-route.ts` — see that module for why the literals live outside the
 * Astro-facing registry and how the two are kept from drifting.
 */
export function sharePagePath(locale: Locale): string {
  return `/${SHARE_ROUTE_SEGMENTS[locale]}/`;
}

/**
 * The full share URL for `token`, in `locale`.
 *
 * `origin` is a parameter rather than read from `import.meta.env` so this stays
 * pure and gradeable without a build — and so the one caller that has to build
 * a link for somebody else's browser (the owner's garage, copying a link to the
 * clipboard) cannot accidentally emit a `localhost` URL from a preview deploy.
 *
 * The token is appended with no encoding because it is 64 hex characters by
 * construction (`extensions.gen_random_bytes(32)`, hex-encoded in
 * `create_share_grant`); `encodeURIComponent` would be a no-op on that alphabet
 * and would hide a change of alphabet rather than surviving one. It is applied
 * anyway, for the day somebody changes the encoding in the migration and does
 * not read this comment.
 */
export function shareLinkFor(input: {
  readonly origin: string;
  readonly locale: Locale;
  readonly token: string;
}): string {
  const url = new URL(
    localeHref(input.locale, sharePagePath(input.locale)),
    input.origin
  );
  url.hash = `${SHARE_TOKEN_FRAGMENT_KEY}=${encodeURIComponent(input.token)}`;
  return url.toString();
}

/**
 * The token carried by `url`, or `null` when there is none.
 *
 * `null`, never `""`: an absent token and an empty one are different states and
 * only one of them is worth sending to the database (AGENTS.md — a failure is
 * not a zero). An empty string would be hashed and compared against every live
 * grant, which is a query nobody meant to run.
 *
 * **Reads the fragment only.** A token in the query string is not a token this
 * function will honour, so a link that leaked one into a log does not also
 * work — it fails, loudly, where somebody will notice, instead of quietly
 * rewarding the leak.
 */
export function shareTokenFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // `URL.hash` keeps the leading `#`, and an absent fragment is `""` rather
  // than null — so the empty case has to be answered before parsing, or
  // `URLSearchParams("")` would hand back a well-formed empty map and the
  // caller would get `""` for "no token at all".
  const fragment = parsed.hash.replace(/^#/, "");
  if (fragment === "") return null;

  const token = new URLSearchParams(fragment).get(SHARE_TOKEN_FRAGMENT_KEY);
  if (token === null || token === "") return null;
  return token;
}
