/**
 * The one way the T603 graders reach the `mods` schema: through the
 * **registered collection**, never through a schema value a grader imported
 * directly.
 *
 * `tests/schemas/collections.test.ts` states the reason for the whole repo: "a
 * perfect factory does not make the site bilingual if `src/content.config.ts`
 * never calls it". A `modsSchema` exported from `src/schemas/mods.ts` and
 * wired to nothing would satisfy every field-level grader while shipping a
 * collection that still accepts anything.
 *
 * The mirror of `tests/helpers/procedures.ts`, deliberately: T603 mirrors
 * T502a's seam, so the graders should reach their subject the same way.
 *
 * refs specs/001-foundation (MOD-01, MOD-02, SCF-01, SCF-04)
 */
import { z } from "astro/zod";
import { collections } from "../../src/content.config.ts";
import { issuesOf } from "./schema-outcome.ts";

interface RegisteredCollection {
  schema?: unknown;
}

interface Parsable {
  safeParse(value: unknown): unknown;
}

/**
 * Astro allows a collection `schema` to be a Zod schema or a function of a
 * context (`{ image }`) returning one. Both are unwrapped, exactly as
 * `tests/schemas/collections.test.ts` does, so T604 is free to use either.
 */
function schemaOf(collection: unknown): Parsable {
  const { schema } = (collection ?? {}) as RegisteredCollection;
  const resolved =
    typeof schema === "function"
      ? (schema as (context: { image: () => unknown }) => unknown)({
          image: () => z.any(),
        })
      : schema;

  if (
    typeof resolved !== "object" ||
    resolved === null ||
    typeof (resolved as Parsable).safeParse !== "function"
  ) {
    throw new Error(
      "the registered `mods` collection has no parsable schema — " +
        "src/content.config.ts must register it through defineEntrySchema " +
        "(SCF-01). refs specs/001-foundation"
    );
  }

  return resolved as Parsable;
}

/** The registered `mods` collection's schema. */
export function modsCollectionSchema(): Parsable {
  const registered = (collections as Record<string, unknown>)["mods"];
  if (registered === undefined) {
    throw new Error(
      "no `mods` collection is registered in src/content.config.ts " +
        "(MOD-01). refs specs/001-foundation"
    );
  }
  return schemaOf(registered);
}

/** One entry, parsed by the collection the site actually builds from. */
export function parseMod(entry: unknown): unknown {
  return modsCollectionSchema().safeParse(entry);
}

/** Dotted issue paths, sorted — order is not part of any contract graded here. */
export function modIssuePaths(entry: unknown): string[] {
  return issuesOf(parseMod(entry))
    .map((issue) => issue.path.map(String).join("."))
    .sort();
}

/**
 * The issues reported against `path`, or against anything nested under it.
 *
 * Prefix matching is on **path segments**, so `specs` does not match
 * `specsOfSomethingElse`. Nesting matters because a grader asking "did this
 * entry's `specs` get rejected" must not have to guess how deep the schema
 * chose to report — but note the deliberate consequence: an
 * `unrecognized_keys` issue is reported at the *root* path with the key in its
 * `keys` array, so `issuesUnder(entry, "specs")` is empty for an entry whose
 * whole `specs` field is an unknown key. That is the distinction the T603
 * graders rely on to tell "the field does not exist yet" from "the field
 * exists and refused this value".
 */
export function issuesUnder(
  entry: unknown,
  path: string
): { path: string; message: string }[] {
  return issuesOf(parseMod(entry))
    .map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }))
    .filter(
      (issue) => issue.path === path || issue.path.startsWith(`${path}.`)
    );
}

/** Whether the registered schema accepts `entry` outright. */
export function accepts(entry: unknown): boolean {
  const outcome = parseMod(entry) as { success?: boolean };
  return outcome.success === true;
}

/** Every issue as `path: message`, for an assertion message that names the reason. */
export function issueSummary(entry: unknown): string {
  return issuesOf(parseMod(entry))
    .map(
      (issue) =>
        `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`
    )
    .join(" | ");
}

/**
 * The parsed entry, with every `.default([])` the schema applies — what a page
 * actually receives as `entry.data`.
 *
 * Throws, naming the issues, rather than returning `undefined`: a grader
 * handed an invalid fixture would otherwise fail somewhere far away, and the
 * reason would be gone by then.
 */
export function parsedModData(entry: unknown): Record<string, unknown> {
  const outcome = parseMod(entry) as { success?: boolean; data?: unknown };
  if (outcome.success !== true) {
    throw new Error(
      `the fixture does not parse against the registered \`mods\` schema:\n` +
        issuesOf(outcome)
          .map(
            (issue) =>
              `  • ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`
          )
          .join("\n")
    );
  }
  return outcome.data as Record<string, unknown>;
}
