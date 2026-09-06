/**
 * MOD-02 on the real build path.
 *
 * > **MOD-02** WHEN a mod requires another mod or part, THE requirement SHALL
 * > be a typed reference that **the build resolves**.
 *
 * "The build resolves" is the whole requirement. `findModIssues` being correct
 * and unit-tested proves nothing about the site if nothing calls it before
 * `dist/` is written; this integration is the call. A requirement naming no
 * entry, a requirement naming an entry in the other collection, a requirement
 * loop, or two entries claiming one id fails `npm run build` — and therefore
 * `npm run verify` and CI — with a message naming **every file involved**, not
 * just an entry id (SCF-04).
 *
 * ## Why an integration and not a `check:*` script
 *
 * The division `src/integrations/validate-fitments.ts` records for FIT-02 and
 * `validate-parts.ts` repeats for PRT-03. The rules are TypeScript that the
 * unit tests grade directly (`tests/lib/mods/mods-graph.test.ts`);
 * re-implementing them in a plain-Node `.mjs` script would be a second
 * implementation of "does this reference resolve", and the second one is
 * always the one that drifts.
 *
 * ## Why `astro:build:start`, and the `.ts` specifiers
 *
 * Both verbatim from the FIT-02 and PRT-03 hooks: it is the first hook of a
 * build so a bad corpus fails fast rather than after two minutes of page
 * generation, it deliberately does not run in `astro dev` (an author mid-edit
 * should get a broken page, not a dead dev server), and every import along
 * this module's chain carries its `.ts` extension because Astro resolves a
 * hook's dynamic import through Node's own ESM resolver rather than through
 * Vite.
 *
 * ## The slug half (I18N-05)
 *
 * Checked here too, and for the same "the build is where it counts" reason: a
 * mods entry with no row in `src/i18n/entry-slugs.ts` is a page that was never
 * built, and a row naming no entry is a URL that 404s. Neither is visible to
 * `validateSlugRegistry`, which can only see the registry — it cannot see the
 * corpus. Only a build can compare the two.
 *
 * refs specs/001-foundation (MOD-01, MOD-02, I18N-05, SCF-04)
 */
import type { AstroIntegrationLogger } from "astro";
import {
  ModsResolutionError,
  assertModsResolve,
  readMods,
  readReferencable,
  readReferenceKinds,
  type ModIssue,
  type ReferencableEntry,
} from "../lib/mods/index.ts";
import { MOD_REFERENCE_COLLECTIONS } from "../lib/mods/references.ts";
import { loadContent, type LoadedEntry } from "../lib/fitment/content.ts";
import { slugRegistryIds } from "../i18n/entry-slugs.ts";

/** The collection this check is about. */
const MODS_COLLECTION = "mods";

/**
 * `findModIssues` names entries by id, which is all it can do — it is given
 * entry objects, not paths. SCF-04 asks for the *file*, so the build caller
 * adds what only it knows.
 *
 * Every id an issue mentions is listed, `entryId` and `relatedEntryIds`
 * together, because the duplicate-id and cycle cases are precisely the ones
 * where naming a single file is worse than useless. Matched by exact id
 * equality, never by substring-matching the rendered message — the trap
 * `validate-fitments.ts` records (the market id `me` matches the word
 * "names").
 *
 * The index spans **every** collection, not just `mods`: a
 * `reference-wrong-collection` issue names a `parts` id, and the whole point
 * of that error is to send the author to the file that already exists.
 */
function withFileIndex(error: unknown, entries: readonly LoadedEntry[]): Error {
  if (!(error instanceof ModsResolutionError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  /** `id -> every file that declares it`, not just the first. */
  const filesById = new Map<string, string[]>();
  for (const entry of entries) {
    const { id } = (entry.data ?? {}) as { id?: unknown };
    if (typeof id !== "string") continue;
    const files = filesById.get(id) ?? [];
    files.push(entry.file);
    filesById.set(id, files);
  }

  const mentioned = (issue: ModIssue): string[] => [
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
 * I18N-05's corpus half: registry and content agree about which mods pages
 * exist. Returns the problems rather than throwing, so one build reports all
 * of them.
 */
function slugCoverageProblems(entries: readonly LoadedEntry[]): string[] {
  const entryIds = entries.flatMap((entry) => {
    const { id } = (entry.data ?? {}) as { id?: unknown };
    return typeof id === "string" ? [{ id, file: entry.file }] : [];
  });

  const registered = new Set(slugRegistryIds(MODS_COLLECTION));
  const present = new Set(entryIds.map((entry) => entry.id));

  const missing = entryIds
    .filter((entry) => !registered.has(entry.id))
    .map(
      (entry) =>
        `${entry.file}: entry \`${entry.id}\` has no row in ENTRY_SLUGS.mods ` +
        `(src/i18n/entry-slugs.ts), so no page is built for it in either ` +
        `locale — add \`{ en, es }\` slugs (I18N-05).`
    );

  const orphaned = [...registered]
    .filter((id) => !present.has(id))
    .sort()
    .map(
      (id) =>
        `src/i18n/entry-slugs.ts: ENTRY_SLUGS.mods lists \`${id}\`, and no ` +
        `entry in src/content/mods/ has that id — the row builds a URL that ` +
        `renders nothing (I18N-05).`
    );

  return [...missing, ...orphaned];
}

/**
 * The `astro:build:start` hook body, called by the integration declared in
 * `astro.config.mjs`.
 *
 * `contentRoot` defaults to the real `src/content/` and exists so graders can
 * run this exact function over a deliberately broken corpus. Without it the
 * only reachable outcome would be "today's content passes", which is a test
 * that cannot fail.
 */
export async function runModsBuildCheck(
  {
    logger,
  }: {
    logger: Pick<AstroIntegrationLogger, "info">;
  },
  contentRoot?: string
): Promise<void> {
  const { entries } = await loadContent(contentRoot);
  const modEntries = entries.filter(
    (entry) => entry.collection === MODS_COLLECTION
  );

  /**
   * Every entry in every collection a typed reference may target. Built from
   * the schema's own list rather than from a literal here, so widening
   * `MOD_REFERENCE_COLLECTIONS` cannot leave the resolver behind.
   */
  const referencable: ReferencableEntry[] = entries.flatMap((entry) => {
    if (
      !(MOD_REFERENCE_COLLECTIONS as readonly string[]).includes(
        entry.collection
      )
    ) {
      return [];
    }
    const { id } = (entry.data ?? {}) as { id?: unknown };
    return typeof id === "string" ? [{ collection: entry.collection, id }] : [];
  });

  const mods = readMods(modEntries.map((entry) => entry.data));

  /**
   * `id → kind` for the whole `reference` collection — what a cited figure id
   * resolves against (T604).
   *
   * Read from the loaded corpus rather than from `getCollection`, exactly as
   * `referencable` is: this hook runs before the content layer is available,
   * and a check that could not see `reference` would have to either skip the
   * rule or assume every id is fine. Assuming is the failure this whole module
   * exists to prevent.
   */
  const referenceKinds = readReferenceKinds(
    entries
      .filter((entry) => entry.collection === "reference")
      .map((entry) => entry.data)
  );

  try {
    // Throws on the first build that carries a broken mods graph, listing
    // every issue rather than the first — one pass per fix.
    assertModsResolve(mods, readReferencable(referencable), referenceKinds);
  } catch (error) {
    throw withFileIndex(error, entries);
  }

  const slugProblems = slugCoverageProblems(modEntries);
  if (slugProblems.length > 0) {
    throw new Error(
      `${slugProblems.length} mods slug problem(s):\n` +
        slugProblems.map((problem) => `  • ${problem}`).join("\n") +
        `\nrefs specs/001-foundation (I18N-05)`
    );
  }

  const references = mods.reduce(
    (total, mod) => total + mod.references.length,
    0
  );
  const specs = mods.reduce((total, mod) => total + mod.specs.length, 0);
  logger.info(
    `${mods.length} mod${mods.length === 1 ? "" : "s"}: ` +
      `${references} typed reference${references === 1 ? "" : "s"} and ` +
      `${specs} cited figure${specs === 1 ? "" : "s"} resolve, ` +
      `and no requirement loops (MOD-01, MOD-02)`
  );
}
