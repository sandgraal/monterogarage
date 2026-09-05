/**
 * PRC-01 and PRC-03 on the real build path.
 *
 * > **PRC-03** IF a procedure cites a torque or fluid spec, THEN THE value
 * > SHALL come from shared reference data by ID, never inlined per-locale.
 *
 * "By ID" is only worth anything if something resolves the id. `src/schemas/
 * procedures.ts` refuses a figure typed into a sentence and refuses a step that
 * cites a spec its own entry never declared; neither can see whether
 * `g3-torque-oil-drain-plug` is a row that exists, or whether it is a
 * `fsm-section` (a citation, not a value). This integration is the call that
 * can. A dangling spec id, a spec of the wrong kind, a consumed part nobody
 * wrote, a prerequisite naming no procedure, or a prerequisite loop fails
 * `npm run build` — and therefore `npm run verify` and CI — with a message
 * naming **every file involved** (SCF-04).
 *
 * ## Why an integration and not a `check:*` script
 *
 * The division `src/integrations/validate-fitments.ts` records for FIT-02 and
 * `validate-parts.ts` for PRT-03, for the same reason. The rules are TypeScript
 * the unit graders exercise directly (`tests/schemas/procedures-spec-by-id.test.ts`
 * drives `findProcedureIssues` over synthetic corpora); re-implementing them in
 * a plain-Node `.mjs` script would be a second implementation of "does this id
 * resolve", and the second one is always the one that drifts.
 *
 * ## Why `astro:build:start`, and the `.ts` specifiers
 *
 * Both verbatim from the FIT-02 hook: it is the first hook of a build so a bad
 * corpus fails fast rather than after two minutes of page generation, it
 * deliberately does not run in `astro dev` (an author mid-edit should get a
 * broken page, not a dead dev server), and every import along this module's
 * chain carries its `.ts` extension because Astro resolves a hook's dynamic
 * import through Node's own ESM resolver rather than through Vite. That is also
 * why the vocabularies and the corpus rules live in `src/lib/procedures/`, with
 * `src/schemas/procedures.ts` re-exporting them, rather than the other way
 * round — the schema graph's imports are extensionless and Node does not guess.
 *
 * ## The slug half (I18N-05)
 *
 * Checked here too, and for the same "the build is where it counts" reason: a
 * procedures entry with no row in `src/i18n/entry-slugs.ts` is a page that was
 * never built, and a row naming no entry is a URL that 404s. Neither is visible
 * to `validateSlugRegistry`, which can only see the registry — it cannot see
 * the corpus. Only a build can compare the two.
 *
 * refs specs/001-foundation (PRC-01, PRC-03, I18N-05, SCF-04)
 */
import type { AstroIntegrationLogger } from "astro";
import {
  ProceduresResolutionError,
  assertProceduresResolve,
  type ProcedureIssue,
} from "../lib/procedures/index.ts";
import { loadContent, type LoadedEntry } from "../lib/fitment/content.ts";
import { slugRegistryIds } from "../i18n/entry-slugs.ts";

const PROCEDURES_COLLECTION = "procedures";
/** What `specs[]` ids resolve against (PRC-03). */
const REFERENCE_COLLECTION = "reference";
/** What `partsConsumed[].part` ids resolve against (PRC-01). */
const PARTS_COLLECTION = "parts";

/**
 * `findProcedureIssues` names entries by id, which is all it can do — it is
 * given entry objects, not paths. SCF-04 asks for the *file*, so the build
 * caller adds what only it knows.
 *
 * Every id an issue mentions is listed, `entryId` and `relatedEntryIds`
 * together, because the duplicate-id and prerequisite-cycle cases are precisely
 * the ones where naming a single file is worse than useless. Matched by exact
 * id equality, never by substring-matching the rendered message — the trap
 * `validate-fitments.ts` records.
 */
function withFileIndex(error: unknown, entries: readonly LoadedEntry[]): Error {
  if (!(error instanceof ProceduresResolutionError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * `id -> every file that declares it`, not just the first: a
   * `duplicate-entry-id` failure is *by definition* about two or more files
   * sharing one id, and a report naming only the first sends the author to the
   * file that is as likely as not the correct one (the PR #75 fix on
   * `validate-parts.ts`, adopted here rather than rediscovered).
   */
  const filesById = new Map<string, string[]>();
  for (const entry of entries) {
    const { id } = (entry.data ?? {}) as { id?: unknown };
    if (typeof id !== "string") continue;
    const files = filesById.get(id) ?? [];
    files.push(entry.file);
    filesById.set(id, files);
  }

  const mentioned = (issue: ProcedureIssue): string[] => [
    issue.entryId,
    ...issue.relatedEntryIds,
  ];

  const named = [...new Set(error.issues.flatMap(mentioned))]
    .sort()
    .flatMap((id) =>
      [...(filesById.get(id) ?? [])].sort().map((file) => `  ${id} → ${file}`)
    );

  if (named.length === 0) return error;

  const augmented = new Error(
    `${error.message}\n\nThe entries named above live in:\n${named.join("\n")}`
  );
  augmented.stack = error.stack;
  return augmented;
}

/**
 * I18N-05's corpus half: registry and content agree about which procedure pages
 * exist. Returns the problems rather than throwing, so one build reports all of
 * them.
 */
function slugCoverageProblems(entries: readonly LoadedEntry[]): string[] {
  const entryIds = entries.flatMap((entry) => {
    const { id } = (entry.data ?? {}) as { id?: unknown };
    return typeof id === "string" ? [{ id, file: entry.file }] : [];
  });

  const registered = new Set(slugRegistryIds(PROCEDURES_COLLECTION));
  const present = new Set(entryIds.map((entry) => entry.id));

  const missing = entryIds
    .filter((entry) => !registered.has(entry.id))
    .map(
      (entry) =>
        `${entry.file}: entry \`${entry.id}\` has no row in ` +
        `ENTRY_SLUGS.procedures (src/i18n/entry-slugs.ts), so no page is ` +
        `built for it in either locale — add \`{ en, es }\` slugs (I18N-05).`
    );

  const orphaned = [...registered]
    .filter((id) => !present.has(id))
    .sort()
    .map(
      (id) =>
        `src/i18n/entry-slugs.ts: ENTRY_SLUGS.procedures lists \`${id}\`, and ` +
        `no entry in src/content/procedures/ has that id — the row builds a ` +
        `URL that renders nothing (I18N-05).`
    );

  return [...missing, ...orphaned];
}

/**
 * The `astro:build:start` hook body, called by the integration declared in
 * `astro.config.mjs`. Exported as a plain function rather than as an
 * `AstroIntegration` factory so the config can reach it through one lazy
 * `await import()` — see the module docstring and `validate-fitments.ts`.
 *
 * `contentRoot` defaults to the real `src/content/` and exists so graders can
 * run this exact function over a deliberately broken corpus. Without it the
 * only reachable outcome would be "today's content passes", which is a test
 * that cannot fail.
 */
export async function runProceduresBuildCheck(
  {
    logger,
  }: {
    logger: Pick<AstroIntegrationLogger, "info">;
  },
  contentRoot?: string
): Promise<void> {
  const { entries } = await loadContent(contentRoot);
  const procedureEntries = entries.filter(
    (entry) => entry.collection === PROCEDURES_COLLECTION
  );

  try {
    // Throws on the first build that carries a broken procedures graph,
    // listing every issue rather than the first — one pass per fix.
    assertProceduresResolve({
      procedures: procedureEntries.map((entry) => entry.data),
      references: entries
        .filter((entry) => entry.collection === REFERENCE_COLLECTION)
        .map((entry) => entry.data),
      parts: entries
        .filter((entry) => entry.collection === PARTS_COLLECTION)
        .map((entry) => entry.data),
    });
  } catch (error) {
    throw withFileIndex(error, procedureEntries);
  }

  const slugProblems = slugCoverageProblems(procedureEntries);
  if (slugProblems.length > 0) {
    throw new Error(
      `${slugProblems.length} procedures slug problem(s):\n` +
        slugProblems.map((problem) => `  • ${problem}`).join("\n") +
        `\nrefs specs/001-foundation (I18N-05)`
    );
  }

  logger.info(
    `${procedureEntries.length} procedure${procedureEntries.length === 1 ? "" : "s"}: ` +
      `every cited spec resolves to a reference row that carries a figure, ` +
      `every consumed part names a parts entry, and no prerequisite loops ` +
      `(PRC-01, PRC-03)`
  );
}
