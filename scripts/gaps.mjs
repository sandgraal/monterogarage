/**
 * `npm run gaps` — the GAP-01 content-backlog report.
 *
 * > **GAP-01** THE `npm run gaps` report SHALL list: problems with no fix
 * > path, parts with no fitment, procedures missing torque or fluid
 * > citations, fitment combinations with zero coverage, glossary terms used
 * > in prose but undefined, entries at `anecdotal` confidence older than
 * > 90 days, and dead source links.
 *
 * Unlike every other `check:*` script, this one **never fails the build**.
 * It is a report for a content-researcher deciding what to write next
 * (T503's own line literally depends on one of these categories), not a
 * gate — CLAUDE.md calls it "the content backlog report" and T703's task
 * line asks for it "wired into CI as a non-blocking report artifact". A
 * category with findings is expected, ordinary, and often exactly the state
 * a young corpus should be in (PRB-01's own docstring: "a documented problem
 * nobody has solved yet is still worth publishing" — that entry is *supposed*
 * to show up here). `main()` only ever sets a nonzero exit code when the
 * script itself fails to run (a read error, a malformed corpus it cannot
 * even walk) — never because it found something to report.
 *
 * ## The eight categories, and where each one's logic actually lives
 *
 * GAP-01 names seven; an eighth — dangling `problems.fixPaths[].parts` /
 * `.procedures` ids — is T703's other named job ("the internal-reference
 * resolution half of check:links, deferred from T105... T203's resolver is
 * the dependency"). Every category reuses real, already-adjudicated logic
 * rather than re-deriving it — the two rules this repo will not bend for a
 * report script:
 *
 * 1. **No second fitment interpreter (FIT-01).** "Fitment combinations with
 *    zero coverage" calls the real resolver
 *    (`buildTaxonomy`/`entryAppliesTo` from `src/lib/fitment/index.ts`) —
 *    the same module `src/integrations/validate-fitments.ts` calls at build
 *    time. This is also the literal reading of the task line's "T203's
 *    resolver is the dependency": before T203 there was no code that could
 *    answer "does this vehicle exist" or "does this entry apply to it" at
 *    all, so this category could not have been built earlier.
 * 2. **No second glossary scanner.** "Glossary terms used in prose but
 *    undefined" reuses `scripts/check-glossary.mjs`'s own normalization and
 *    entry-reading helpers rather than re-tokenizing prose a second way.
 *
 * ## Judgment calls (recorded here because GAP-01's one-line spec and the
 * schemas built after it leave real gaps to fill; see each function's own
 * docstring for the reasoning in full)
 *
 * - **"Parts with no fitment"** cannot mean a literally empty `fitment` —
 *   `fitmentSchema` requires a non-empty `gens` on every entry, always
 *   (`src/schemas/entry.ts`). Read here as "fitment narrowed no further than
 *   the bare minimum the schema requires" — no market, year, engine,
 *   transmission, transfer case, trim or drive — which is the honest
 *   equivalent for a schema that never allows the literal empty case.
 * - **"Procedures missing torque or fluid citations"** is read literally:
 *   zero `specs[]` ids resolving to a `reference` entry of kind `torque` or
 *   `fluid`. This does not judge whether a given job *should* have one (a
 *   pure diagnostic step legitimately has neither) — it surfaces the
 *   candidates and leaves the judgment to a reviewer, same as PRB-06 does for
 *   fix paths.
 * - **"Fitment combinations with zero coverage"** is scored at the grain the
 *   taxonomy actually declares combinations at — one `vehicles` `kind:
 *   "combination"` entry's `offerings[]` row (generation + market + engine +
 *   transmission + transfer case, across the offering's recorded years) —
 *   against `problems`/`parts`/`procedures`/`mods` (the collections that are
 *   "content about a truck" in GAP-01's sense; `reference`/`community`/
 *   `glossary` are foundational or directory data, not truck-specific
 *   content, and are deliberately excluded from the coverage count).
 * - **"Glossary terms used in prose but undefined"** cannot be recall-complete
 *   without either NLP or a hand-curated jargon list, and
 *   `scripts/check-glossary.mjs`'s own design principle ("zero false
 *   positives beats recall") argues against a broad, uncurated scan even for
 *   a non-blocking report. This ships a curated, extensible allowlist of
 *   real Montero/automotive acronyms ({@link KNOWN_JARGON_TERMS}) checked
 *   against the glossary's own canonical terms and aliases — real (validated
 *   against today's content: `EGR` and `FSM` are both used and both
 *   currently undefined) rather than a stub, but explicitly not exhaustive.
 *   Extend the list as new jargon is noticed; a corpus-driven extraction is
 *   future work, not this task's job to invent.
 * - **"Entries at anecdotal confidence older than 90 days"** needs an age,
 *   and no schema (`src/schemas/entry.ts`) carries one for a generic entry —
 *   only `community`'s `activityAssessed` does, and only for that collection.
 *   Adding a field is a schema change no task line here authorized (AGENTS.md:
 *   "schema and taxonomy changes are never a drive-by edit"). This uses each
 *   file's last `git log` commit date instead — a non-invasive, already-true
 *   fact about the repository standing in for "how long has this sat
 *   unrevisited" — injectable (`gitDate`) so the test suite never shells out.
 * - **Dead source links** reuses `scripts/check-links.mjs`'s own
 *   `auditLinks(...).warnings` (the "dead original, live archive" case) —
 *   the same network-checked classification `check:links` already computes,
 *   never a second implementation of reachability. That network audit is
 *   the slow part of this whole repo's checks (30 min–2.6+ h at content
 *   scale per the 2026-08-30 ruling `check-links.mjs`'s own module docstring
 *   records), so it does **not** run by default — `gaps` would silently
 *   reintroduce the exact per-PR cost that ruling eliminated. Two ways to
 *   include it, and they are not interchangeable:
 *     - `--link-audit <path>` reads a JSON file `check-links.mjs --json`
 *       already wrote — reusing a network pass someone else already paid
 *       for, at zero extra cost. This is what `link-check.yml` uses: it
 *       already runs `check:links` weekly, so `gaps` there rides that run's
 *       result instead of auditing a second time.
 *     - `--with-links` runs the audit itself, here, for an ad hoc local
 *       check when no recent `check:links --json` output exists yet. Slow,
 *       and mutually exclusive with `--link-audit`.
 *   With neither flag, this category reports as "not checked this run"
 *   rather than as "zero found" — an absence of evidence is not evidence of
 *   absence, and a report that cannot tell the two apart would be worse than
 *   one that says so.
 *
 * ## Output
 *
 * Console: a per-category summary, always. `--json <path>` (default
 * `gaps-report.json`, repo root, gitignored) additionally writes the same
 * data as machine-readable JSON — the CI artifact `ci.yml`'s `content-gaps`
 * job uploads.
 *
 * Usage: `node scripts/gaps.mjs [--with-links] [--json <path>|--no-json]`
 *
 * refs specs/001-foundation (GAP-01, PRB-06, FIT-01)
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CONTENT_ROOT,
  REPO_ROOT,
  loadContentEntries,
  stringLeaves,
} from "./lib/content-entries.mjs";
import { auditLinks } from "./check-links.mjs";
import { glossaryEntriesOf, normalizeForSearch } from "./check-glossary.mjs";
// `.ts` on purpose: this is the real fitment resolver (FIT-01 — "the only
// code that interprets fitment queries"), not a second reading of one. Node
// 24 strips the erasable TypeScript syntax itself; `src/lib/fitment/index.ts`
// and its whole import chain are written with explicit extensions for
// exactly this reason (see that module's own docstring).
import { buildTaxonomy, entryAppliesTo } from "../src/lib/fitment/index.ts";

/* -------------------------------------------------------------------------
 * Small shared helpers
 * ---------------------------------------------------------------------- */

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value) {
  return isPlainObject(value) ? value : null;
}

function idOf(data) {
  const id = asRecord(data)?.id;
  return typeof id === "string" ? id : undefined;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** `entries` narrowed to one collection's `data`, in file order. */
function collectionData(entries, collection) {
  return entries
    .filter((entry) => entry.collection === collection)
    .map((entry) => ({ file: entry.file, data: entry.data }));
}

/** Every `data.id` declared in one collection, as a `Set`. */
function idSetOf(entries, collection) {
  const ids = new Set();
  for (const { data } of collectionData(entries, collection)) {
    const id = idOf(data);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/* -------------------------------------------------------------------------
 * 1. Problems with no fix path (PRB-06)
 * ---------------------------------------------------------------------- */

export function findProblemsWithNoFixPath(entries) {
  const items = [];
  for (const { file, data } of collectionData(entries, "problems")) {
    if (asArray(data?.fixPaths).length > 0) continue;
    items.push({
      entryId: idOf(data),
      file,
      message:
        `${file}: no fix path yet — a documented problem with nothing to ` +
        `do about it (PRB-06).`,
    });
  }
  return items;
}

/* -------------------------------------------------------------------------
 * 2. Parts with no (narrowed) fitment
 * ---------------------------------------------------------------------- */

/** Every fitment facet besides the always-required `gens` — see module docstring. */
const FITMENT_NARROWING_FACETS = [
  "markets",
  "years",
  "engines",
  "transmissions",
  "transferCases",
  "trims",
  "drive",
];

function isNarrowed(fitment) {
  const record = asRecord(fitment) ?? {};
  return FITMENT_NARROWING_FACETS.some((facet) => {
    const value = record[facet];
    if (value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (isPlainObject(value)) return Object.keys(value).length > 0;
    return true;
  });
}

export function findPartsWithNoFitment(entries) {
  const items = [];
  for (const { file, data } of collectionData(entries, "parts")) {
    if (isNarrowed(data?.fitment)) continue;
    const gens = asRecord(data?.fitment)?.gens;
    items.push({
      entryId: idOf(data),
      file,
      message:
        `${file}: fitment names only \`gens\` (${JSON.stringify(gens)}) — ` +
        `no market, year, engine, transmission, transfer case, trim or ` +
        `drive narrows which trucks this part actually fits (PRT-01, GAP-01).`,
    });
  }
  return items;
}

/* -------------------------------------------------------------------------
 * 3. Procedures missing a torque or fluid citation (PRC-01, PRC-03)
 * ---------------------------------------------------------------------- */

export function findProceduresMissingTorqueOrFluid(entries) {
  const kindById = new Map();
  for (const { data } of collectionData(entries, "reference")) {
    const id = idOf(data);
    if (id !== undefined) kindById.set(id, data?.kind);
  }

  const items = [];
  for (const { file, data } of collectionData(entries, "procedures")) {
    const specs = asArray(data?.specs);
    const hasTorqueOrFluid = specs.some((specId) => {
      const kind = kindById.get(specId);
      return kind === "torque" || kind === "fluid";
    });
    if (hasTorqueOrFluid) continue;
    items.push({
      entryId: idOf(data),
      file,
      message:
        `${file}: cites no \`torque\` or \`fluid\` reference row — confirm ` +
        `this job genuinely needs neither, or add the citation (PRC-01, ` +
        `PRC-03, GAP-01).`,
    });
  }
  return items;
}

/* -------------------------------------------------------------------------
 * 4. Fitment combinations with zero coverage (FIT-01/T203's resolver)
 * ---------------------------------------------------------------------- */

/**
 * The collections that count as "content about a truck" for coverage
 * purposes — see the module docstring's judgment-call note.
 */
const COVERAGE_COLLECTIONS = ["problems", "parts", "procedures", "mods"];

function offeringLabel(generation, market, offering) {
  const span = `${offering?.years?.from ?? "?"}–${offering?.years?.to ?? "present"}`;
  const extra = [offering?.transmission, offering?.transferCase]
    .filter((value) => typeof value === "string")
    .join(", ");
  return (
    `${generation}/${market}, ${offering?.engine ?? "?"}` +
    (extra ? ` (${extra})` : "") +
    `, ${span}`
  );
}

export function findZeroCoverageCombinations(entries) {
  const taxonomyData = collectionData(entries, "vehicles").map((e) => e.data);
  const taxonomy = buildTaxonomy(taxonomyData);

  const candidates = entries.filter((entry) =>
    COVERAGE_COLLECTIONS.includes(entry.collection)
  );

  const items = [];
  for (const { file, data } of collectionData(entries, "vehicles")) {
    if (data?.kind !== "combination") continue;
    const generation = data?.generation;
    const market = data?.market;
    if (typeof generation !== "string" || typeof market !== "string") continue;

    asArray(data?.offerings).forEach((offering, index) => {
      const engine = offering?.engine;
      const year = offering?.years?.from;
      if (typeof engine !== "string" || typeof year !== "number") return;

      const vehicle = {
        gen: generation,
        market,
        year,
        engine,
        transmission:
          typeof offering?.transmission === "string"
            ? offering.transmission
            : undefined,
        transferCase:
          typeof offering?.transferCase === "string"
            ? offering.transferCase
            : undefined,
      };

      const covered = candidates.some((candidate) =>
        entryAppliesTo(candidate.data, vehicle, taxonomy)
      );
      if (covered) return;

      items.push({
        entryId: `${idOf(data) ?? "?"}#offerings[${index}]`,
        file,
        message:
          `${file}: offerings[${index}] (${offeringLabel(generation, market, offering)}) ` +
          `has zero coverage in problems/parts/procedures/mods — a real, ` +
          `taxonomy-recorded combination nobody has written about yet ` +
          `(GAP-01, T203's resolver).`,
      });
    });
  }
  return items;
}

/* -------------------------------------------------------------------------
 * 5. Glossary terms used in prose but undefined (heuristic — see docstring)
 * ---------------------------------------------------------------------- */

/**
 * A curated, extensible allowlist of real Montero/automotive jargon
 * acronyms. See the module docstring for why this is a curated list rather
 * than a corpus-driven extraction.
 */
export const KNOWN_JARGON_TERMS = [
  "ABS",
  "CDI",
  "DOHC",
  "ECU",
  "EGR",
  "FSM",
  "GDI",
  "GVWR",
  "IAC",
  "LSD",
  "MAF",
  "MAP",
  "NVH",
  "OEM",
  "PCV",
  "PSI",
  "PTO",
  "RPM",
  "SOHC",
  "SST",
  "TCU",
  "TPS",
  "TSB",
  "VIN",
];

/** Every string inside `data.prose` (both locales), flattened. */
function proseStringsOf(data) {
  const prose = asRecord(data)?.prose;
  if (prose === null || prose === undefined) return [];
  return stringLeaves(prose).map((leaf) => leaf.value);
}

/** Normalized canonical terms and aliases the glossary already defines. */
function knownGlossaryVocabulary(entries) {
  const known = new Set();
  for (const glossaryEntry of glossaryEntriesOf(entries)) {
    for (const term of Object.values(glossaryEntry.terms)) {
      known.add(normalizeForSearch(term));
    }
    for (const alias of glossaryEntry.aliases) {
      known.add(normalizeForSearch(alias.term));
    }
  }
  return known;
}

/**
 * Escapes every regex metacharacter in `term` so it can be interpolated into
 * `new RegExp(...)` and still match literally. `KNOWN_JARGON_TERMS` is
 * currently all plain alphanumerics, but nothing enforces that going
 * forward — a future term containing `.`, `+`, `(`, etc. must not silently
 * change what the built pattern matches (or throw).
 */
function escapeRegExp(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findUndefinedGlossaryTerms(entries) {
  const known = knownGlossaryVocabulary(entries);
  const undefinedTerms = KNOWN_JARGON_TERMS.filter(
    (term) => !known.has(normalizeForSearch(term))
  );
  if (undefinedTerms.length === 0) return [];

  // `g` flag: counting real occurrences (below) needs `String.prototype.match`
  // to return every match, not just tell us whether one exists.
  const patterns = new Map(
    undefinedTerms.map((term) => [
      term,
      new RegExp(`\\b${escapeRegExp(term)}\\b`, "g"),
    ])
  );
  /** `term -> { count, files: Set<string> }` */
  const usages = new Map();

  for (const entry of entries) {
    if (entry.collection === "glossary") continue; // defining a term is not "used undefined"
    for (const text of proseStringsOf(entry.data)) {
      for (const term of undefinedTerms) {
        // `String.prototype.match` resets the global regex's `lastIndex` to
        // 0 before it starts, so the shared pattern is safe to reuse across
        // every text/term pair here — no manual state reset needed.
        const matches = text.match(patterns.get(term));
        if (matches === null) continue;
        const record = usages.get(term) ?? { count: 0, files: new Set() };
        record.count += matches.length;
        record.files.add(entry.file);
        usages.set(term, record);
      }
    }
  }

  const items = [];
  for (const [term, { count, files }] of usages) {
    const sortedFiles = [...files].sort();
    items.push({
      entryId: term,
      file: sortedFiles[0],
      message:
        `\`${term}\` appears in prose ${count} time(s) across ` +
        `${files.size} file(s) (e.g. ${sortedFiles[0]}) with no glossary ` +
        `entry (canonical term or alias) defining it — candidate for a new ` +
        `glossary term (GLO-01, GAP-01).`,
    });
  }
  return items.sort((a, b) => (a.entryId < b.entryId ? -1 : 1));
}

/* -------------------------------------------------------------------------
 * 6. Entries at `anecdotal` confidence older than 90 days
 * ---------------------------------------------------------------------- */

export const ANECDOTAL_STALE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The last commit date to touch `file`, or `null` when git has no history
 * for it (an uncommitted new file, or a checkout with no `.git`). Real
 * production default; tests inject a fake so the suite never shells out.
 */
export function gitLastCommitDate(file, repoRoot = REPO_ROOT) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "" ? null : new Date(out);
  } catch {
    return null;
  }
}

export function findStaleAnecdotalEntries(
  entries,
  { now = new Date(), repoRoot = REPO_ROOT, gitDate = gitLastCommitDate } = {}
) {
  const items = [];
  for (const entry of entries) {
    if (asRecord(entry.data)?.confidence !== "anecdotal") continue;
    const lastTouched = gitDate(entry.file, repoRoot);
    // No git history to judge age from — silence rather than a guess (same
    // "fail towards not reporting a fact we cannot support" the fitment
    // engine's own JDM-span note takes).
    if (lastTouched === null) continue;

    const ageDays = Math.floor(
      (now.getTime() - lastTouched.getTime()) / DAY_MS
    );
    if (ageDays < ANECDOTAL_STALE_DAYS) continue;

    items.push({
      entryId: idOf(entry.data),
      file: entry.file,
      message:
        `${entry.file}: at \`anecdotal\` confidence, last touched ` +
        `${lastTouched.toISOString().slice(0, 10)} (${ageDays} days ago) — ` +
        `promote with new evidence or confirm it still holds. Confidence ` +
        `tiers ratchet upward only with new evidence (plan.md, GAP-01).`,
    });
  }
  return items;
}

/* -------------------------------------------------------------------------
 * 7. Dangling `problems.fixPaths[].parts` / `.procedures` ids — the
 *    internal-reference resolution half of check:links (T703, deferred from
 *    T105; see `src/schemas/problems.ts`'s `fixPathSchema` docstring, which
 *    names this exact script and rule).
 * ---------------------------------------------------------------------- */

export function findDanglingFixPathReferences(entries) {
  const knownPartIds = idSetOf(entries, "parts");
  const knownProcedureIds = idSetOf(entries, "procedures");

  const items = [];
  for (const { file, data } of collectionData(entries, "problems")) {
    asArray(data?.fixPaths).forEach((fixPath, index) => {
      const record = asRecord(fixPath);
      if (record === null) return;

      for (const [field, known, label] of [
        ["parts", knownPartIds, "parts"],
        ["procedures", knownProcedureIds, "procedures"],
      ]) {
        asArray(record[field]).forEach((id) => {
          if (typeof id !== "string" || known.has(id)) return;
          items.push({
            entryId: idOf(data),
            file,
            message:
              `${file}: fixPaths[${index}].${field} names \`${id}\`, which ` +
              `no \`${label}\` entry declares yet — the id renders as a bare ` +
              `chip until that ${label === "parts" ? "part" : "procedure"} ` +
              `is written (PRB-01, T703).`,
          });
        });
      }
    });
  }
  return items;
}

/* -------------------------------------------------------------------------
 * 8. Dead source links — reuses `check:links`' own network-checked
 *    classification. See module docstring for why this does not run by
 *    default.
 * ---------------------------------------------------------------------- */

/**
 * Accepts either shape a `warnings` list can arrive in: the live
 * `auditLinks()` result (`{ entry: { file, data }, field, message }`, used by
 * `--with-links`) or `check-links.mjs --json`'s on-disk shape
 * (`{ file, field, message }`, no `data` — used by `--link-audit`). Only the
 * former can carry an `entryId`; the latter leaves it `undefined`, which is
 * fine — `file` is every gap item's real identifier regardless of category.
 */
export function mapLinkWarningsToGapItems(warnings) {
  return warnings.map((warning) => ({
    entryId: idOf(warning.entry?.data),
    file: warning.file ?? warning.entry?.file,
    message: warning.message,
  }));
}

/**
 * Reads a `check-links.mjs --json` file for `--link-audit`. Distinguishes
 * three outcomes rather than collapsing "could not check" into "checked, zero
 * found" (AGENTS.md: a failure is not a zero; an absence of evidence is not
 * evidence of absence — see the module docstring's dead-source-links note,
 * and `check-links.mjs`'s own `offlineNotice` for the precedent of surfacing
 * an "I couldn't tell" state distinctly rather than silently):
 *
 * - the file is missing or unreadable,
 * - the file's contents are not valid JSON,
 * - the parsed JSON has no `warnings` array (not a `check-links.mjs --json`
 *   file, or a version whose shape changed).
 *
 * `{ warnings: null, error: <string> }` for any of those; `{ warnings: [...],
 * error: null }` on success. Never returns `{ warnings: [] }` as a stand-in
 * for "could not check" — that is exactly the collapse this function exists
 * to prevent.
 *
 * @param {string} filePath
 * @param {{ readFileImpl?: (path: string, encoding: "utf8") => Promise<string> }} [options]
 *   injectable so tests never touch the real filesystem — narrowed to the
 *   one `readFile` overload this function actually calls, not the full
 *   `typeof readFile` union.
 * @returns {Promise<{ warnings: unknown[] | null, error: string | null }>}
 */
export async function readLinkAuditWarnings(
  filePath,
  { readFileImpl = readFile } = {}
) {
  let raw;
  try {
    raw = await readFileImpl(filePath, "utf8");
  } catch (cause) {
    return {
      warnings: null,
      error: `could not read --link-audit file ${filePath}: ${cause.message}`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return {
      warnings: null,
      error: `--link-audit file ${filePath} is not valid JSON: ${cause.message}`,
    };
  }

  if (!Array.isArray(parsed?.warnings)) {
    return {
      warnings: null,
      error:
        `--link-audit file ${filePath} has no \`warnings\` array — is it ` +
        `really a \`check-links.mjs --json\` output file?`,
    };
  }

  return { warnings: parsed.warnings, error: null };
}

/* -------------------------------------------------------------------------
 * Assembling the report
 * ---------------------------------------------------------------------- */

/**
 * `id -> { label, find }`. `find(entries, context)` returns this category's
 * items; `context` carries the injectable bits (`now`, `gitDate`, `repoRoot`)
 * every category is free to ignore.
 */
const CATEGORIES = [
  {
    id: "no-fix-path",
    label: "Problems with no fix path (PRB-06)",
    find: (entries) => findProblemsWithNoFixPath(entries),
  },
  {
    id: "part-no-fitment",
    label: "Parts with no narrowed fitment (GAP-01)",
    find: (entries) => findPartsWithNoFitment(entries),
  },
  {
    id: "procedure-missing-torque-fluid",
    label: "Procedures missing a torque or fluid citation (GAP-01)",
    find: (entries) => findProceduresMissingTorqueOrFluid(entries),
  },
  {
    id: "fitment-zero-coverage",
    label: "Fitment combinations with zero content coverage (GAP-01)",
    find: (entries) => findZeroCoverageCombinations(entries),
  },
  {
    id: "undefined-glossary-term",
    label: "Glossary terms used in prose but undefined (GAP-01)",
    find: (entries) => findUndefinedGlossaryTerms(entries),
  },
  {
    id: "stale-anecdotal",
    label: `Anecdotal-confidence entries older than ${ANECDOTAL_STALE_DAYS} days (GAP-01)`,
    find: (entries, ctx) =>
      findStaleAnecdotalEntries(entries, {
        now: ctx.now,
        repoRoot: ctx.repoRoot,
        gitDate: ctx.gitDate,
      }),
  },
  {
    id: "dangling-fix-path-reference",
    label: "Fix-path parts/procedures ids naming nothing yet (T703)",
    find: (entries) => findDanglingFixPathReferences(entries),
  },
  {
    id: "dead-source-link",
    label: "Dead original with a live archive (GAP-01, from check:links)",
    find: (_entries, ctx) =>
      ctx.linkWarnings === null
        ? null // "not checked this run" — see module docstring
        : mapLinkWarningsToGapItems(ctx.linkWarnings),
  },
];

/**
 * @typedef {object} GapItem
 * @property {string} [entryId]
 * @property {string} [file]
 * @property {string} message
 */

/**
 * @typedef {object} GapCategory
 * @property {string} label
 * @property {boolean} checked `false` means "not checked this run" (the
 *   dead-source-link category with neither `--with-links` nor `--link-audit`)
 *   — distinct from `checked: true, count: 0`, which really means "zero found".
 * @property {number} count
 * @property {GapItem[]} items
 */

/**
 * The whole GAP-01 report, as data. `options.linkWarnings` — pass
 * `auditLinks(entries).warnings` (or `mapLinkWarningsToGapItems`'s own input
 * shape) to include the dead-source-link category; `null` (default) marks it
 * "not checked this run" rather than "zero found".
 *
 * @param {readonly {collection: string, file: string, data: unknown}[]} entries
 * @param {{ now?: Date, repoRoot?: string, gitDate?: typeof gitLastCommitDate, linkWarnings?: unknown[] | null }} [options]
 * @returns {{ generatedAt: string, totalCount: number, categories: Record<string, GapCategory> }}
 */
export function buildGapsReport(entries, options = {}) {
  const {
    now = new Date(),
    repoRoot = REPO_ROOT,
    gitDate = gitLastCommitDate,
    linkWarnings = null,
  } = options;

  const ctx = { now, repoRoot, gitDate, linkWarnings };

  /** @type {Record<string, GapCategory>} */
  const categories = {};
  let totalCount = 0;
  for (const { id, label, find } of CATEGORIES) {
    const items = find(entries, ctx);
    categories[id] = {
      label,
      checked: items !== null,
      count: items === null ? 0 : items.length,
      items: items ?? [],
    };
    if (items !== null) totalCount += items.length;
  }

  return {
    generatedAt: now.toISOString(),
    totalCount,
    categories,
  };
}

/* -------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------- */

const DEFAULT_JSON_OUTPUT = path.join(REPO_ROOT, "gaps-report.json");

function parseArgs(argv) {
  const args = {
    withLinks: false,
    linkAuditPath: null,
    jsonPath: DEFAULT_JSON_OUTPUT,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--with-links") args.withLinks = true;
    else if (arg === "--link-audit") args.linkAuditPath = argv[++i];
    else if (arg === "--json") args.jsonPath = argv[++i];
    else if (arg === "--no-json") args.jsonPath = null;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printReport(report) {
  console.log(
    `gaps — content backlog report generated ${report.generatedAt}\n` +
      `gaps — ${report.totalCount} item(s) across every checked category:\n`
  );
  for (const { label, checked, count, items } of Object.values(
    report.categories
  )) {
    if (!checked) {
      console.log(
        `— ${label}: not checked this run (see --with-links / --link-audit)\n`
      );
      continue;
    }
    console.log(`— ${label}: ${count}`);
    for (const item of items) {
      console.log(`    • ${item.message}`);
    }
    console.log("");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/gaps.mjs [--with-links | --link-audit <path>] [--json <path>|--no-json]\n\n" +
        "  --with-links     Run check:links' network reachability audit here and\n" +
        "                   fold its dead-original-with-live-archive warnings in.\n" +
        "                   Slow (see scripts/check-links.mjs) — off by default.\n" +
        "  --link-audit P   Reuse a JSON file check-links.mjs already wrote\n" +
        "                   (`node scripts/check-links.mjs --json P`) instead of\n" +
        "                   auditing again — the no-double-network-cost path\n" +
        "                   `link-check.yml` uses.\n" +
        `  --json PATH      Write the report as JSON (default ${DEFAULT_JSON_OUTPUT}).\n` +
        "  --no-json        Skip writing the JSON file."
    );
    return;
  }

  if (args.withLinks && args.linkAuditPath !== null) {
    console.error(
      "gaps — --with-links and --link-audit are mutually exclusive: the " +
        "point of --link-audit is to avoid a second network pass."
    );
    process.exitCode = 1;
    return;
  }

  const entries = await loadContentEntries(CONTENT_ROOT);

  let linkWarnings = null;
  if (args.withLinks) {
    console.log(
      "gaps — --with-links: running check:links' network reachability audit " +
        "(this can take a while at content scale; see scripts/check-links.mjs)…"
    );
    const audit = await auditLinks(entries);
    linkWarnings = audit.warnings;
  } else if (args.linkAuditPath !== null) {
    const { warnings, error } = await readLinkAuditWarnings(args.linkAuditPath);
    if (error !== null) {
      // Missing/unreadable/malformed --link-audit input is a real failure of
      // what was asked for, not "zero dead links" — surface it loudly and
      // leave `linkWarnings` at `null` so the report still says "not checked
      // this run" for dead-source-link rather than a false-clean "0".
      console.error(`gaps — --link-audit: ${error}`);
      process.exitCode = 1;
    } else {
      linkWarnings = warnings;
    }
  }

  const report = buildGapsReport(entries, { linkWarnings });
  printReport(report);

  if (args.jsonPath !== null) {
    await writeFile(
      args.jsonPath,
      JSON.stringify(report, null, 2) + "\n",
      "utf8"
    );
    console.log(`gaps — wrote ${args.jsonPath}`);
  }
}

if (
  process.argv[1] &&
  new URL(process.argv[1], "file://").pathname ===
    new URL(import.meta.url).pathname
) {
  await main();
}
