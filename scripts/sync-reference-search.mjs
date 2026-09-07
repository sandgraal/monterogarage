/**
 * The CI half of the git→Supabase read-model sync (T802, RM-01, RM-02).
 *
 * A thin wrapper, on purpose: everything gradable without a live Supabase
 * project already lives in `src/lib/sync/reference-search.ts`'s
 * `computeSyncPlan` (`tests/sync/sync-plan.test.ts`'s idempotency and
 * one-directionality proofs), and everything gradable by reading this file's
 * own text lives in `tests/sync/ci-wiring.test.ts`. What is left for this
 * script to do is exactly the I/O `computeSyncPlan` was built to stay clear
 * of: read the built content, read the table, call the pure function, execute
 * what it returns.
 *
 * ## Where "the built content" comes from
 *
 * `src/pages/search-index.json.ts` — a prerendered, locale-agnostic JSON
 * endpoint built by `astro build` — not `getCollection()` called from here
 * directly. `astro:content` is a Vite virtual module; this script runs under
 * bare `node`, in a GitHub Actions job with no bundler, and every existing
 * "read the corpus from plain Node" module in this repo
 * (`scripts/lib/content-entries.mjs`, `src/lib/fitment/content.ts`,
 * `astro.config.mjs`'s own `validateFitments` hook comment) says the same
 * thing about why that import cannot work here. `search-index.json.ts`'s own
 * docstring has the full reasoning for choosing a build artifact over the
 * alternative `tests/sync/contract.ts` left open.
 *
 * ## Never the anon key, never a `PUBLIC_*` variable
 *
 * This script authenticates to Supabase as `service_role`, from the
 * `SUPABASE_SERVICE_ROLE_KEY` environment variable — a repository secret,
 * read only inside `.github/workflows/sync-reference-search.yml`'s own job,
 * never a `PUBLIC_*`-prefixed one (`src/lib/supabase/config.ts`'s "no service
 * key exists in this repo" invariant). The write path needs exactly the
 * privilege the anon key must never carry, so this script does not import
 * `@supabase/supabase-js`'s browser-facing helpers and does not read the
 * anon-key variable at all — reaching for it here would mean an RLS-governed,
 * silently-partial write instead of the unconditional one RM-02 assumes the
 * CI job can make.
 *
 * Usage: `node scripts/sync-reference-search.mjs [--input path] [--dry-run]`
 *
 * refs specs/001-foundation (RM-01, RM-02)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeSyncPlan } from "../src/lib/sync/reference-search.ts";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** Where `astro build` writes `src/pages/search-index.json.ts`'s output. */
export const DEFAULT_INPUT_PATH = path.join(
  REPO_ROOT,
  "dist",
  "search-index.json"
);

/** The table this script reads and writes — `tests/sync/contract.ts`'s name. */
export const SEARCH_INDEX_TABLE = "search_index_entries";

/**
 * Every column the table declares, in the shape `.select()` and `.upsert()`
 * both use — snake_case, matching the migration
 * (`supabase/migrations/20260906120200_search_index_entries.sql`).
 * `search_vector` is deliberately absent: it is `generated always as (…)
 * stored`, the database computes it, and this script never reads or writes it.
 */
const DB_COLUMNS =
  "collection, entry_id, locale, href, title, subtitle, snippet, badges, codes, extra";

/**
 * `{ rows: ReferenceSearchRow[] }` from the build artifact `astro build`
 * wrote at `search-index.json.ts` (`GET`'s own JSON shape) → parsed rows, in
 * `computeSyncPlan`'s own camelCase shape. Throws with a message naming the
 * missing build step when the file is absent — the same "an absent
 * prerequisite is a named error, not a false-empty corpus" discipline
 * `scripts/gaps.mjs`'s `--link-audit` reader documents.
 */
export async function readGitRows(inputPath, { readFileImpl = readFile } = {}) {
  let raw;
  try {
    raw = await readFileImpl(inputPath, "utf8");
  } catch (cause) {
    throw new Error(
      `sync-reference-search: could not read ${inputPath} — run \`astro build\` ` +
        `first (src/pages/search-index.json.ts writes this file). ` +
        `Cause: ${cause.message}`,
      { cause }
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `sync-reference-search: ${inputPath} is not valid JSON — ${cause.message}`,
      { cause }
    );
  }

  if (!Array.isArray(parsed?.rows)) {
    throw new Error(
      `sync-reference-search: ${inputPath} has no \`rows\` array — is it ` +
        `really search-index.json.ts's own output?`
    );
  }

  return parsed.rows;
}

/** One `ReferenceSearchRow` → one row in the table's own (snake_case) shape. */
export function toDbRow(row) {
  return {
    collection: row.collection,
    entry_id: row.entryId,
    locale: row.locale,
    href: row.href,
    title: row.title,
    subtitle: row.subtitle,
    snippet: row.snippet,
    badges: row.badges,
    codes: row.codes,
    extra: row.extra,
  };
}

/** One row as `.select()` returns it → `computeSyncPlan`'s `ReferenceSearchRow`. */
export function fromDbRow(record) {
  return {
    collection: record.collection,
    entryId: record.entry_id,
    locale: record.locale,
    href: record.href,
    title: record.title,
    subtitle: record.subtitle,
    snippet: record.snippet,
    badges: record.badges ?? [],
    codes: record.codes ?? [],
    extra: record.extra ?? [],
  };
}

/**
 * Every row currently in the table, read with the service-role client — RLS
 * is enabled and forced on this table (the migration), but `service_role`
 * bypasses RLS by design, the same way every other CI/admin path in this repo
 * does; nothing here depends on a policy admitting this read.
 */
export async function readDbRows(client) {
  const { data, error } = await client
    .from(SEARCH_INDEX_TABLE)
    .select(DB_COLUMNS);
  if (error) {
    throw new Error(
      `sync-reference-search: reading the table failed: ${error.message}`
    );
  }
  return (data ?? []).map(fromDbRow);
}

/** `upserts.length` in `chunkSize`-row batches — one request per batch. */
export function chunk(items, chunkSize) {
  const out = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    out.push(items.slice(index, index + chunkSize));
  }
  return out;
}

const UPSERT_CHUNK_SIZE = 500;

/**
 * Executes a {@link SyncPlan} exactly as `computeSyncPlan` decided it —
 * `upserts` written verbatim (RM-01's one-directionality: git's row, never a
 * value blended with what the table held), `deletes` removed by their full
 * composite key. Never anything computeSyncPlan did not ask for.
 */
export async function applyPlan(client, plan) {
  for (const batch of chunk(plan.upserts, UPSERT_CHUNK_SIZE)) {
    if (batch.length === 0) continue;
    const { error } = await client
      .from(SEARCH_INDEX_TABLE)
      .upsert(batch.map(toDbRow), { onConflict: "collection,entry_id,locale" });
    if (error) {
      throw new Error(`sync-reference-search: upsert failed: ${error.message}`);
    }
  }

  for (const key of plan.deletes) {
    const { error } = await client.from(SEARCH_INDEX_TABLE).delete().match({
      collection: key.collection,
      entry_id: key.entryId,
      locale: key.locale,
    });
    if (error) {
      throw new Error(`sync-reference-search: delete failed: ${error.message}`);
    }
  }
}

/** The two environment variables this script needs, read and validated once. */
export function readCredentials(env) {
  const url =
    typeof env.PUBLIC_SUPABASE_URL === "string"
      ? env.PUBLIC_SUPABASE_URL.trim()
      : "";
  const serviceKey =
    typeof env.SUPABASE_SERVICE_ROLE_KEY === "string"
      ? env.SUPABASE_SERVICE_ROLE_KEY.trim()
      : "";

  if (url === "" || serviceKey === "") {
    throw new Error(
      "sync-reference-search: PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "must both be set — this script authenticates as service_role and " +
        "never falls back to an unauthenticated client."
    );
  }

  return { url, serviceKey };
}

function parseArgs(argv) {
  const args = { inputPath: DEFAULT_INPUT_PATH, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input")
      args.inputPath = path.resolve(REPO_ROOT, argv[++index]);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/sync-reference-search.mjs [--input path] [--dry-run]\n\n" +
        `  --input PATH   Read git rows from PATH instead of ${DEFAULT_INPUT_PATH}.\n` +
        "  --dry-run      Compute and print the plan; write nothing."
    );
    return;
  }

  const gitRows = await readGitRows(args.inputPath);
  console.log(`sync-reference-search: read ${gitRows.length} row(s) from git.`);

  const { url, serviceKey } = readCredentials(process.env);
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const dbRows = await readDbRows(client);
  console.log(
    `sync-reference-search: read ${dbRows.length} row(s) from Supabase.`
  );

  const plan = computeSyncPlan(gitRows, dbRows);
  console.log(
    `sync-reference-search: plan is ${plan.upserts.length} upsert(s), ` +
      `${plan.deletes.length} delete(s).`
  );

  if (args.dryRun) {
    console.log("sync-reference-search: --dry-run — writing nothing.");
    return;
  }

  await applyPlan(client, plan);
  console.log("sync-reference-search: done.");
}

if (
  process.argv[1] &&
  new URL(process.argv[1], "file://").pathname ===
    new URL(import.meta.url).pathname
) {
  await main();
}
