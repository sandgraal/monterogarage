/**
 * `check:links` — SCF-02/SCF-03's link check, source half.
 *
 * Runs weekly (plus on demand) in `link-check.yml`'s `link-check` job, not
 * on the merge-blocking path (owner ruling 2026-08-30 — see that workflow
 * and `ci.yml`'s `links-a11y` job, which used to run this step). That job
 * has no build step first, so this cannot assume `dist/` exists (that is
 * `check:hreflang`'s job, which runs post-`astro build` inside `verify`).
 * What this script can check without a build: every entry's cited sources,
 * walked straight from `src/content/`.
 *
 * Two checks, both real (not a stub):
 *
 * 1. **Archive shape.** AGENTS.md: "Archive every source URL
 *    (web.archive.org) at the time of citation." The schema only checks
 *    `archiveUrl` is *an* http(s) URL (`src/schemas/entry.ts`); this checks
 *    it is actually a Wayback Machine snapshot, not e.g. the same live URL
 *    copy-pasted into both fields. Always a hard failure — it's a citation
 *    practice defect, not a reachability question.
 * 2. **Reachability, scored per *source*, not per field.** AGENTS.md: "Archive
 *    every source URL... forum threads die and take the evidence with them" —
 *    the whole point of `archiveUrl` is to survive `url` going dead. So a
 *    source only *fails* this check when **both** `url` and `archiveUrl` are
 *    unreachable; a dead original with a live archive snapshot is exactly the
 *    case the schema was designed to tolerate, and is downgraded to a
 *    warning (exit 0) rather than a build failure. Fixing it — re-citing a
 *    fresher original — is content work tracked by the gaps report's
 *    "dead source links" line (GAP-01, T703), not something `verify` should
 *    block a PR over. (T105 review, 2026-08-27: the original one-field-fails
 *    policy contradicted the very reason `archiveUrl` exists.)
 *
 * Reachability is fetched HEAD first (cheaper), falling back to GET when a
 * host rejects HEAD (`405`/`501`), with one retry on a thrown network error
 * before a side is declared unreachable — a single dropped packet should not
 * cost a citation its status. If *every* check this run performs fails with
 * the identical network-level error and none succeed, that is far more
 * likely a runner with no outbound network access than a coincidence of
 * dead links; `main()` prints a distinguishing note for that case so a red
 * `check:links` run in an offline sandbox is not mistaken for real link rot
 * (see `findUnreachableLinks`'s `offlineNotice`).
 *
 * **web.archive.org gets special handling.** At content scale (T201: ~140
 * source pairs, most citing an archive snapshot) the pooled concurrency below
 * self-inflicts a Wayback Machine rate-limit: every `archiveUrl` fetch came
 * back a connection-level error in CI while a same-size run against other
 * hosts passed clean. So `ARCHIVE_HOST` requests are pulled out of the shared
 * pool and run serially (concurrency 1) with a fixed inter-request delay
 * (`ARCHIVE_REQUEST_SPACING_MS`), and get their own backoff-retry policy —
 * up to `ARCHIVE_MAX_ATTEMPTS` attempts with exponential backoff
 * (`ARCHIVE_BACKOFF_SCHEDULE_MS`), honoring a `Retry-After` header when the
 * host sends one, and retrying HTTP 429 in addition to thrown connection
 * errors. Every other host keeps the original pooled `CONCURRENCY` and the
 * original single-immediate-retry policy — this is pure politeness toward
 * one host, not a change to the failure rule: a 429 or connection failure
 * that survives every backoff attempt still counts as unreachable, and a
 * source still only fails when **both** its `url` and `archiveUrl` are
 * unreachable (GAP-01, unchanged).
 *
 * Scope note: "internal references resolve" (AGENTS.md) is not implemented
 * here yet. Nothing in the T104 base schema creates an internal cross-entry
 * reference to validate — `fitment.{gens,engines,…}` are opaque id lists
 * against a vehicle taxonomy that does not exist as data until FIT-02/T203
 * (`src/schemas/entry.ts`'s fitment placeholder docstring), and resolving
 * them here would be exactly the kind of drive-by taxonomy assumption
 * AGENTS.md rules out for this task. When cross-entry references exist, they
 * get their own audit here, alongside this one, not instead of it.
 *
 * Usage: node scripts/check-links.mjs [--json <path>]
 *
 * `--json <path>` additionally writes `{ issues, warnings, offlineNotice }` as
 * JSON (file/field/message only — never the entry's full `data`), so a caller
 * that already paid this run's network cost can reuse the result instead of
 * auditing a second time. `scripts/gaps.mjs --link-audit <path>` is that
 * caller (T703): `link-check.yml` runs this script once with `--json`, and
 * the `gaps` step downstream folds the same run's `warnings` into the
 * dead-source-link category — never a second network pass.
 *
 * refs specs/001-foundation (SCF-02, SCF-03, GAP-01)
 */
import { writeFile } from "node:fs/promises";

import { CONTENT_ROOT, loadContentEntries } from "./lib/content-entries.mjs";

const ARCHIVE_HOST = "web.archive.org";
const FETCH_TIMEOUT_MS = 10_000;
/**
 * Per-attempt fetch timeout for `ARCHIVE_HOST` requests — higher than the
 * generic timeout because old Wayback Machine snapshots (especially PDFs and
 * pre-2010 pages stored in the `:80` URL format) can take significantly longer
 * to decompress and serve from cold storage. 30 s gives three times the
 * headroom before an AbortController fires, reducing intermittent "This
 * operation was aborted" false-positives that flip a warning into a build
 * failure when archive.org happens to be slow on a particular CI run.
 */
export const ARCHIVE_FETCH_TIMEOUT_MS = 30_000;
const CONCURRENCY = 6;

/** Fixed spacing between consecutive `ARCHIVE_HOST` requests (politeness, not a retry). */
export const ARCHIVE_REQUEST_SPACING_MS = 1_800;
/** 1 initial attempt + up to 3 backoff retries, per method, for `ARCHIVE_HOST` only. */
export const ARCHIVE_MAX_ATTEMPTS = 4;
/** Wait before retry attempts 2, 3, 4 respectively (exponential, ~2s/8s/20s). */
export const ARCHIVE_BACKOFF_SCHEDULE_MS = [2_000, 8_000, 20_000];
/** How often `runArchiveChecks` prints a liveness line, so CI logs are never silent for minutes. */
const ARCHIVE_PROGRESS_INTERVAL = 20;

/** The generic (non-archive) retry policy — unchanged from before: 1 immediate retry, no 429 handling. */
const GENERIC_POLICY = {
  maxAttempts: 2,
  backoffMs: [0],
  delayImpl: async () => {},
  retryOn429: false,
  timeoutMs: FETCH_TIMEOUT_MS,
};

/** `sources[]` entries are `{ title, url, archiveUrl, accessed, kind }`. */
function sourcesOf(data) {
  const sources = data && typeof data === "object" ? data.sources : undefined;
  return Array.isArray(sources) ? sources : [];
}

/** Structural check: is `url` actually a web.archive.org snapshot? */
export function isArchiveUrl(url) {
  try {
    return new URL(url).host === ARCHIVE_HOST;
  } catch {
    return false;
  }
}

/**
 * Every `{ entry, field, url }` this script could check reachability for,
 * across every entry's `sources[]` — one row per field. Used for the
 * end-of-run summary count; reachability itself is scored per-*source* by
 * {@link collectSourcePairs}, not per field (see module docstring point 2).
 */
export function collectLinkTargets(entries) {
  const targets = [];
  for (const entry of entries) {
    sourcesOf(entry.data).forEach((source, index) => {
      if (typeof source?.url === "string" && source.url !== "") {
        targets.push({
          entry,
          field: `sources[${index}].url`,
          url: source.url,
        });
      }
      if (typeof source?.archiveUrl === "string" && source.archiveUrl !== "") {
        targets.push({
          entry,
          field: `sources[${index}].archiveUrl`,
          url: source.archiveUrl,
        });
      }
    });
  }
  return targets;
}

/**
 * One `{ entry, index, url, archiveUrl }` per source, `url`/`archiveUrl`
 * `undefined` when blank/absent. The unit reachability is scored against —
 * see module docstring point 2 for why a source, not a field, is the unit.
 */
export function collectSourcePairs(entries) {
  const pairs = [];
  for (const entry of entries) {
    sourcesOf(entry.data).forEach((source, index) => {
      const url =
        typeof source?.url === "string" && source.url !== ""
          ? source.url
          : undefined;
      const archiveUrl =
        typeof source?.archiveUrl === "string" && source.archiveUrl !== ""
          ? source.archiveUrl
          : undefined;
      if (url === undefined && archiveUrl === undefined) return;
      pairs.push({ entry, index, url, archiveUrl });
    });
  }
  return pairs;
}

/**
 * Structural (no network) problems: an `archiveUrl` that is not on
 * web.archive.org.
 *
 * @returns {LinkIssue[]}
 */
export function findArchiveShapeIssues(entries) {
  const issues = [];
  for (const entry of entries) {
    sourcesOf(entry.data).forEach((source, index) => {
      if (typeof source?.archiveUrl !== "string" || source.archiveUrl === "")
        return;
      if (isArchiveUrl(source.archiveUrl)) return;
      issues.push({
        entry,
        field: `sources[${index}].archiveUrl`,
        message:
          `${entry.file}: \`sources[${index}].archiveUrl\` (${source.archiveUrl}) is not ` +
          `a ${ARCHIVE_HOST} snapshot — archive every source at citation time (AGENTS.md).`,
      });
    });
  }
  return issues;
}

/** Bounded-concurrency map, so a large source list does not open hundreds of sockets at once. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

/** One fetch attempt. Never throws — network failures come back as `{ ok: false, error }`. */
async function attemptOnce(
  url,
  method,
  fetchImpl,
  timeoutMs = FETCH_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
    });
    return { ok: true, response };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Real (production) delay — a plain `setTimeout` wrapped in a promise. */
async function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The longest we will ever honor a `Retry-After` header for — the largest
 * entry in `ARCHIVE_BACKOFF_SCHEDULE_MS`. `Retry-After` is server-supplied
 * and unbounded (a misbehaving or hostile host could send `Retry-After:
 * 999999999`); rather than lean on Node's incidental 32-bit `setTimeout`
 * clamp (~24.8 days) to save us, this ceiling is explicit and small enough
 * that a single check can never stall a run for more than the same worst
 * case a connection-failure retry already accepts.
 */
const RETRY_AFTER_CEILING_MS = Math.max(...ARCHIVE_BACKOFF_SCHEDULE_MS);

/**
 * How long to wait before the next attempt when a `429` response carries a
 * `Retry-After` header — seconds (`Retry-After: 5`) or an HTTP-date are both
 * valid per RFC 9110. Returns `null` when absent, unparseable, or the
 * duck-typed test double has no `headers`; otherwise clamps to
 * `RETRY_AFTER_CEILING_MS` (see its docstring).
 */
function retryAfterMs(response) {
  const header = response?.headers?.get?.("retry-after");
  if (typeof header !== "string" || header === "") return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.min(RETRY_AFTER_CEILING_MS, Math.max(0, seconds * 1_000));
  }
  const when = Date.parse(header);
  if (!Number.isNaN(when)) {
    return Math.min(RETRY_AFTER_CEILING_MS, Math.max(0, when - Date.now()));
  }
  return null;
}

/**
 * Attempt `method url` up to `policy.maxAttempts` times. A thrown network
 * error is always retryable (until attempts run out); an HTTP `429` is
 * retryable only when `policy.retryOn429` is set (archive host only — see
 * module docstring). Every retry waits `policy.delayImpl(ms)` first, `ms`
 * coming from the response's `Retry-After` header when present, else
 * `policy.backoffMs[attemptIndex]` (clamped to the schedule's last entry).
 */
async function attemptWithPolicy(url, method, fetchImpl, policy) {
  const { maxAttempts, backoffMs, delayImpl, retryOn429, timeoutMs } = policy;
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await attemptOnce(url, method, fetchImpl, timeoutMs);
    const isFinalAttempt = attempt === maxAttempts;
    if (last.ok) {
      const retryable = retryOn429 && last.response.status === 429;
      if (!retryable || isFinalAttempt) return last;
      const wait =
        retryAfterMs(last.response) ??
        backoffMs[attempt - 1] ??
        backoffMs[backoffMs.length - 1];
      await delayImpl(wait);
      continue;
    }
    if (isFinalAttempt) return last;
    const wait = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1];
    await delayImpl(wait);
  }
  return last;
}

/**
 * Fetch `url`, HEAD first (cheaper), falling back to GET when the host
 * rejects HEAD (`405`/`501`, common on forums and vendor sites) or every
 * attempt at a method exhausts `policy` (see {@link attemptWithPolicy}).
 * Returns `{ ok, status?, error? }`.
 */
async function checkReachable(url, fetchImpl, policy) {
  let lastError;
  for (const method of ["HEAD", "GET"]) {
    const attempt = await attemptWithPolicy(url, method, fetchImpl, policy);
    if (attempt.ok) {
      const { response } = attempt;
      if (response.ok || (response.status >= 200 && response.status < 400)) {
        return { ok: true, status: response.status };
      }
      if (
        method === "HEAD" &&
        (response.status === 405 || response.status === 501)
      ) {
        continue; // try GET
      }
      return { ok: false, status: response.status };
    }
    lastError = attempt.error;
    // Still failing after every retry this policy allows — try GET before
    // giving up entirely.
  }
  return { ok: false, error: lastError ?? "unreachable" };
}

/**
 * `ARCHIVE_HOST` checks, serialized (concurrency 1) with a fixed inter-
 * request delay and their own backoff-retry policy — see module docstring.
 * Prints a liveness line every `ARCHIVE_PROGRESS_INTERVAL` checks (and at the
 * end) so a CI log stays visibly alive through a multi-minute run.
 */
async function runArchiveChecks(checks, fetchImpl, delayImpl) {
  const policy = {
    maxAttempts: ARCHIVE_MAX_ATTEMPTS,
    backoffMs: ARCHIVE_BACKOFF_SCHEDULE_MS,
    delayImpl,
    retryOn429: true,
    timeoutMs: ARCHIVE_FETCH_TIMEOUT_MS,
  };
  const results = [];
  for (let index = 0; index < checks.length; index++) {
    if (index > 0) await delayImpl(ARCHIVE_REQUEST_SPACING_MS);
    const check = checks[index];
    const result = await checkReachable(check.target, fetchImpl, policy);
    results.push({ ...check, result });
    const done = index + 1;
    if (done % ARCHIVE_PROGRESS_INTERVAL === 0 || done === checks.length) {
      console.log(
        `check:links — ${ARCHIVE_HOST} reachability: ${done}/${checks.length} checked`
      );
    }
  }
  return results;
}

/**
 * A duck-typed subset of `fetch`'s signature — just enough for
 * {@link checkReachable}. Named explicitly rather than typed as `typeof
 * fetch` so test doubles do not have to satisfy the full `Response` shape
 * (headers, `redirected`, `statusText`, …) they never use.
 *
 * @typedef {(url: string, init: { method: string, redirect: string, signal: AbortSignal }) => Promise<{ ok: boolean, status?: number }>} FetchLike
 */

/**
 * @typedef {object} LinkIssue
 * @property {{ file: string, data: unknown }} entry
 * @property {string} field
 * @property {string} message
 */

/** @typedef {LinkIssue} LinkWarning Same shape; kept as a separate name for readability at call sites. */

function describeResult(result) {
  if (!result) return "not cited";
  if (result.ok) return `reachable (HTTP ${result.status})`;
  if (result.status !== undefined) return `HTTP ${result.status}`;
  return result.error ?? "unreachable";
}

/** `"ok"` (nothing to report) | `"warning"` (one side dead) | `"issue"` (both dead) | `"skip"` (neither side cited). */
function classifyPair(urlResult, archiveResult) {
  const urlOk = urlResult ? urlResult.ok : null;
  const archiveOk = archiveResult ? archiveResult.ok : null;
  if (urlOk === null && archiveOk === null) return "skip";
  if (urlOk === null) return archiveOk ? "ok" : "issue";
  if (archiveOk === null) return urlOk ? "ok" : "issue";
  if (urlOk && archiveOk) return "ok";
  if (!urlOk && !archiveOk) return "issue";
  return "warning";
}

/** @returns {LinkIssue} */
function makeIssue(pair, urlResult, archiveResult) {
  const { entry, index } = pair;
  return {
    entry,
    field: `sources[${index}]`,
    message:
      `${entry.file}: \`sources[${index}]\` is unreachable on both sides — ` +
      `url (${pair.url ?? "not cited"}): ${describeResult(urlResult)}; ` +
      `archiveUrl (${pair.archiveUrl ?? "not cited"}): ${describeResult(archiveResult)}.`,
  };
}

/** @returns {LinkWarning} */
function makeWarning(pair, urlResult, archiveResult) {
  const urlDead = urlResult !== null && !urlResult.ok;
  const deadSide = urlDead ? "url" : "archiveUrl";
  const liveSide = urlDead ? "archiveUrl" : "url";
  const deadValue = urlDead ? pair.url : pair.archiveUrl;
  const deadResult = urlDead ? urlResult : archiveResult;
  return {
    entry: pair.entry,
    field: `sources[${pair.index}].${deadSide}`,
    message:
      `${pair.entry.file}: \`sources[${pair.index}].${deadSide}\` (${deadValue}) is ` +
      `unreachable (${describeResult(deadResult)}), but \`${liveSide}\` still resolves — ` +
      `not a build failure. Re-citing a live original is content work tracked by the ` +
      `gaps report's dead-source-links line (GAP-01, T703).`,
  };
}

/**
 * When every reachability check in this run fails with the identical
 * network-level error and none succeed, that pattern is far more consistent
 * with "this runner has no outbound network access" than with a coincidence
 * of unrelated dead links — distinguish it so a red `check:links` run in an
 * offline sandbox is not read as real link rot. Requires at least two
 * checks: one failure proves nothing about the network as a whole.
 */
function detectOfflineNotice(results) {
  if (results.some((r) => r.ok)) return null;
  const errors = results
    .filter((r) => !r.ok)
    .map((r) => r.error)
    .filter((e) => typeof e === "string");
  if (errors.length < 2 || errors.length !== results.length) return null;
  const distinct = new Set(errors);
  if (distinct.size !== 1) return null;
  return (
    `all ${errors.length} reachability check(s) in this run failed identically ` +
    `(${[...distinct][0]}) — this looks like the runner has no outbound network ` +
    `access rather than ${errors.length} genuinely dead links. Verify connectivity ` +
    `before treating this result as real link rot.`
  );
}

/**
 * Reachability audit, scored per source (module docstring point 2).
 * `fetchImpl` is injectable so tests never hit the network — production
 * default is the global `fetch` (Node 24, no dependency needed).
 *
 * @param {{ file: string, data: unknown }[]} entries
 * @param {{ fetchImpl?: FetchLike, delayImpl?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<{ issues: LinkIssue[], warnings: LinkWarning[], offlineNotice: string | null }>}
 */
export async function findUnreachableLinks(entries, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayImpl = options.delayImpl ?? defaultDelay;
  const pairs = collectSourcePairs(entries);

  const checks = pairs.flatMap((pair) => [
    pair.url ? { pair, side: "url", target: pair.url } : null,
    pair.archiveUrl
      ? { pair, side: "archiveUrl", target: pair.archiveUrl }
      : null,
  ]);
  const performed = checks.filter((c) => c !== null);

  // ARCHIVE_HOST checks are pulled out of the shared pool and run serially,
  // spaced, with their own backoff policy (see module docstring); every
  // other host keeps the original pooled concurrency and immediate-retry
  // policy, unchanged from before this run split.
  const archiveChecks = performed.filter((check) => isArchiveUrl(check.target));
  const otherChecks = performed.filter((check) => !isArchiveUrl(check.target));

  const [archiveResults, otherResults] = await Promise.all([
    runArchiveChecks(archiveChecks, fetchImpl, delayImpl),
    mapWithConcurrency(otherChecks, CONCURRENCY, async (check) => ({
      ...check,
      result: await checkReachable(check.target, fetchImpl, GENERIC_POLICY),
    })),
  ]);
  const results = [...archiveResults, ...otherResults];

  const bySide = new Map();
  for (const { pair, side, result } of results) {
    const record = bySide.get(pair) ?? {};
    record[side] = result;
    bySide.set(pair, record);
  }

  const issues = [];
  const warnings = [];
  for (const pair of pairs) {
    const sides = bySide.get(pair) ?? {};
    const urlResult = sides.url ?? null;
    const archiveResult = sides.archiveUrl ?? null;
    const classification = classifyPair(urlResult, archiveResult);
    if (classification === "issue") {
      issues.push(makeIssue(pair, urlResult, archiveResult));
    } else if (classification === "warning") {
      warnings.push(makeWarning(pair, urlResult, archiveResult));
    }
  }

  const offlineNotice = detectOfflineNotice(results.map((r) => r.result));

  return { issues, warnings, offlineNotice };
}

/**
 * @param {{ file: string, data: unknown }[]} entries
 * @param {{ fetchImpl?: FetchLike, delayImpl?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<{ issues: LinkIssue[], warnings: LinkWarning[], offlineNotice: string | null }>}
 */
export async function auditLinks(entries, options = {}) {
  const shapeIssues = findArchiveShapeIssues(entries);
  const { issues, warnings, offlineNotice } = await findUnreachableLinks(
    entries,
    options
  );
  return { issues: [...shapeIssues, ...issues], warnings, offlineNotice };
}

/**
 * `{entry, field, message}` -> `{file, field, message}` — never the full
 * entry. Exported so `--json`'s output shape is unit-testable without
 * shelling out to the real CLI (which would need the network).
 */
export function serializeLinkIssue(issue) {
  return {
    file: issue.entry?.file,
    field: issue.field,
    message: issue.message,
  };
}

function parseArgs(argv) {
  const args = { jsonPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") args.jsonPath = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const entries = await loadContentEntries(CONTENT_ROOT);
  const { issues, warnings, offlineNotice } = await auditLinks(entries);

  if (offlineNotice) {
    console.error(`check:links — ${offlineNotice}`);
  }

  if (warnings.length > 0) {
    console.warn(
      `check:links — ${warnings.length} warning(s) — dead original with a live archive, ` +
        `not a build failure (GAP-01/T703 tracks these):`
    );
    for (const warning of warnings) console.warn(`  • ${warning.message}`);
  }

  if (args.jsonPath !== null) {
    await writeFile(
      args.jsonPath,
      JSON.stringify(
        {
          issues: issues.map(serializeLinkIssue),
          warnings: warnings.map(serializeLinkIssue),
          offlineNotice,
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    console.log(`check:links — wrote ${args.jsonPath}`);
  }

  if (issues.length > 0) {
    console.error(`check:links — ${issues.length} problem(s):`);
    for (const problem of issues) console.error(`  • ${problem.message}`);
    process.exitCode = 1;
    return;
  }

  const targetCount = collectLinkTargets(entries).length;
  console.log(
    `check:links — OK: ${targetCount} source URL(s) across ${entries.length} entr${
      entries.length === 1 ? "y" : "ies"
    } checked, every source has at least one reachable side and every ` +
      `archiveUrl is a real web.archive.org snapshot.`
  );
}

if (
  process.argv[1] &&
  new URL(process.argv[1], "file://").pathname ===
    new URL(import.meta.url).pathname
) {
  await main();
}
