/**
 * The procedures graph (PRC-01, PRC-03) — everything about the `procedures`
 * collection that one entry cannot see on its own.
 *
 * `src/schemas/procedures.ts` owns the shape of a single entry and the
 * contradictions visible from inside it. This module owns the questions that
 * are only answerable with the whole corpus in hand:
 *
 * 1. **Is this entry id unique?** Every typed reference below names an entry by
 *    id, so a duplicated id makes every pointer to it ambiguous.
 * 2. **Does each `specs[]` id name a `reference` entry, and is it a kind that
 *    carries a figure?** (PRC-03.) "You cited the wrong row" and "that row does
 *    not exist" are two different mistakes and send an author to two different
 *    places, so they are two codes.
 * 3. **Does each `partsConsumed[].part` id name a `parts` entry?** (PRC-01.)
 * 4. **Does each `prerequisites[].procedure` id name a `procedures` entry, and
 *    do the prerequisites terminate?** A loop is a job that cannot be started.
 *
 * ## Why a lib and an integration, and not a `check:*` script
 *
 * The division `src/lib/parts/` and `src/integrations/validate-parts.ts`
 * settled for PRT-03, for the same reasons: the rules are pure functions that
 * deserve unit tests without a browser or a build, and the *build* is where
 * "an id nobody resolves is not a reference" becomes true. The lib returns
 * issues rather than throwing, so one build reports every problem instead of
 * the first.
 *
 * ## Why the vocabularies live here rather than in the schema module
 *
 * {@link PROCEDURE_SPEC_KINDS} and {@link PROCEDURE_ISSUE_CODES} are
 * re-exported by `src/schemas/procedures.ts`, which is where the T502a seam
 * declared them and where the graders import them from. They are *declared*
 * here for the reason `src/lib/parts/part-numbers.ts` exists: this module sits
 * on an `astro:build:start` hook's import chain, which Node's own ESM resolver
 * walks, so every module on it carries `.ts` specifiers and may not reach into
 * the schema graph (whose imports are extensionless). One declaration, wrapped
 * by the schema module — never two.
 *
 * Nothing here interprets a fitment (FIT-01) and nothing here parses an entry:
 * shape is the schema's business, and a module that threw on a malformed entry
 * would replace the schema's precise, field-named error with a stack trace.
 *
 * refs specs/001-foundation (PRC-01, PRC-03, SCF-04)
 */

/**
 * The `reference` kinds a procedure may cite by id (PRC-03).
 *
 * PRC-03's own words are "a torque or fluid spec". `capacity` and `dimension`
 * are here as well, and the reason is the same one twice: PRC-01 asks for
 * "fluid specs **and capacities**" in the same breath, REF-01 files
 * "capacities/dimensions" as one line, and a capacity or a clearance is a
 * number exactly like a torque is. If a procedure may not inline "88 N·m" it
 * may not inline "2.3 L" or "0.15 mm" either.
 *
 * `dimension` in particular is load-bearing rather than generous. Valve
 * clearance, belt deflection, endplay, runout and alignment specs are all
 * figures a *procedure* sets, and all of them are `dimension` rows. Excluding
 * the kind would leave an author with no legal way to cite a clearance, and the
 * only remaining path would be to write the number into a sentence — the exact
 * outcome PRC-03 exists to prevent. A closed loop with no correct move in it is
 * a schema bug, not a strict rule.
 *
 * Deliberately **not** here: `fsm-section` (a citation, not a value — it
 * belongs in `sources`) and the three decoder kinds (`vin-position`,
 * `vin-code`, `option-code`), which answer "what does this code mean" and are
 * not figures any job sets. None of them carries a figure, so excluding them
 * closes no loop on an author; citing one is an authoring mistake with a clear
 * message ({@link PROCEDURE_ISSUE_CODES}' `wrong-spec-kind`) rather than a
 * silently rendered empty row.
 *
 * Every member is a real `ReferenceKind`; `tests/schemas/reference.test.ts`
 * owns that vocabulary and `src/schemas/procedures.ts` re-exports this one
 * beside it.
 */
export const PROCEDURE_SPEC_KINDS = [
  "torque",
  "fluid",
  "capacity",
  "dimension",
] as const;

export type ProcedureSpecKind = (typeof PROCEDURE_SPEC_KINDS)[number];

const SPEC_KIND_SET: ReadonlySet<string> = new Set(PROCEDURE_SPEC_KINDS);

/**
 * The ways the *corpus* can fail to hold together — the questions no single
 * entry can answer, which are therefore the build's and not a schema
 * refinement's. Exactly the division `src/lib/parts/index.ts` records for
 * PRT-03 and `src/lib/fitment/index.ts` for FIT-02.
 */
export const PROCEDURE_ISSUE_CODES = [
  "duplicate-entry-id",
  /** `specs[i]` names no `reference` entry. */
  "unknown-spec",
  /** It names one, of a kind {@link PROCEDURE_SPEC_KINDS} does not admit. */
  "wrong-spec-kind",
  /** `partsConsumed[i].part` names no `parts` entry. */
  "unknown-part",
  /** `prerequisites[i].procedure` names no `procedures` entry. */
  "unknown-prerequisite",
  /** Prerequisites that require each other, directly or around a loop. */
  "prerequisite-cycle",
] as const;

export type ProcedureIssueCode = (typeof PROCEDURE_ISSUE_CODES)[number];

/** One reason the procedures corpus does not hold together. */
export interface ProcedureIssue {
  readonly code: ProcedureIssueCode;
  /** The entry the issue is reported against. */
  readonly entryId: string;
  /** Dotted field path within that entry (SCF-04). */
  readonly field: string;
  /**
   * Every *other* entry the issue is about — the other claimant of a
   * duplicated id, the rest of a cycle, the reference row of the wrong kind.
   * Structured rather than only spelled into the message, because the build
   * caller turns ids into file paths and an error naming one file of two sends
   * the author to the wrong one.
   */
  readonly relatedEntryIds: readonly string[];
  readonly message: string;
}

/**
 * The three collections the corpus rules compare, read tolerantly from
 * `unknown` exactly as `readParts` / `readSellers` do.
 */
export interface ProcedureCorpus {
  readonly procedures: readonly unknown[];
  /** The `reference` collection — what `specs[]` ids resolve against. */
  readonly references: readonly unknown[];
  /** The `parts` collection — what `partsConsumed[].part` ids resolve against. */
  readonly parts: readonly unknown[];
}

/* -------------------------------------------------------------------------
 * Reading
 * ---------------------------------------------------------------------- */

/** The slice of a procedures entry the graph needs. */
export interface ProcedureIdentity {
  readonly id: string;
  readonly specs: readonly string[];
  readonly partsConsumed: readonly string[];
  /** `prerequisites[i].procedure`, with the index it was declared at. */
  readonly prerequisites: readonly {
    readonly index: number;
    readonly id: string;
  }[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Every readable procedures entry, in input order.
 *
 * An entry with no `id` is skipped rather than reported: the schema already
 * rejects it, by field, and a second complaint here would send an author
 * chasing two problems for one mistake.
 */
export function readProcedures(
  entries: readonly unknown[]
): ProcedureIdentity[] {
  const procedures: ProcedureIdentity[] = [];

  for (const entry of entries) {
    const record = asRecord(entry);
    if (record === null) continue;
    const id = asId(record["id"]);
    if (id === null) continue;

    const specs = Array.isArray(record["specs"])
      ? record["specs"].flatMap((value) => {
          const spec = asId(value);
          return spec === null ? [] : [spec];
        })
      : [];

    const partsConsumed = Array.isArray(record["partsConsumed"])
      ? record["partsConsumed"].flatMap((value) => {
          const part = asId(asRecord(value)?.["part"]);
          return part === null ? [] : [part];
        })
      : [];

    const prerequisites = Array.isArray(record["prerequisites"])
      ? record["prerequisites"].flatMap((value, index) => {
          const procedure = asId(asRecord(value)?.["procedure"]);
          return procedure === null ? [] : [{ index, id: procedure }];
        })
      : [];

    procedures.push({ id, specs, partsConsumed, prerequisites });
  }

  return procedures;
}

/** `id → kind` for every readable `reference` entry. */
export function readReferenceKinds(
  entries: readonly unknown[]
): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const entry of entries) {
    const record = asRecord(entry);
    const id = asId(record?.["id"]);
    if (id === null || kinds.has(id)) continue;
    kinds.set(id, typeof record?.["kind"] === "string" ? record["kind"] : "");
  }
  return kinds;
}

/** Every readable `parts` entry id. */
export function readPartIds(entries: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = asId(asRecord(entry)?.["id"]);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/* -------------------------------------------------------------------------
 * The build rules
 * ---------------------------------------------------------------------- */

function duplicateEntryIdIssues(
  procedures: readonly ProcedureIdentity[]
): ProcedureIssue[] {
  const byId = new Map<string, ProcedureIdentity[]>();
  for (const procedure of procedures) {
    byId.set(procedure.id, [...(byId.get(procedure.id) ?? []), procedure]);
  }

  return [...byId.entries()]
    .filter(([, group]) => group.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, group]) => ({
      code: "duplicate-entry-id" as const,
      entryId: id,
      field: "id",
      /*
       * Empty, and that is the honest answer — the same reasoning
       * `src/lib/parts/index.ts` records. Every entry in this group declares
       * *this* id, so there is no other id to name; what distinguishes them is
       * their **file**, which this module cannot see and the build caller adds.
       */
      relatedEntryIds: [],
      message:
        `${group.length} procedures entries declare \`id: "${id}"\`. Entry ` +
        `ids are how a prerequisite, a problem's fix path and the slug ` +
        `registry all name a job, so a duplicated id makes every pointer to ` +
        `it ambiguous. The files are listed below. ` +
        `refs specs/001-foundation (PRC-01)`,
    }));
}

function specIssues(
  procedures: readonly ProcedureIdentity[],
  referenceKinds: ReadonlyMap<string, string>
): ProcedureIssue[] {
  const issues: ProcedureIssue[] = [];

  for (const procedure of procedures) {
    procedure.specs.forEach((spec, index) => {
      const kind = referenceKinds.get(spec);

      if (kind === undefined) {
        issues.push({
          code: "unknown-spec",
          entryId: procedure.id,
          field: `specs[${index}]`,
          relatedEntryIds: [],
          message:
            `\`${procedure.id}\` cites spec \`${spec}\`, and no \`reference\` ` +
            `entry has that id. PRC-03 says a torque or fluid value comes ` +
            `from shared reference data **by ID**, so the id is a typed ` +
            `reference the build resolves: write the reference entry — with ` +
            `its own fitment, its own sources and both prose locales — or ` +
            `take the citation out. A figure typed into a step instead is the ` +
            `one thing PRC-03 forbids. refs specs/001-foundation (PRC-03)`,
        });
        return;
      }

      if (SPEC_KIND_SET.has(kind)) return;

      issues.push({
        code: "wrong-spec-kind",
        entryId: procedure.id,
        field: `specs[${index}]`,
        relatedEntryIds: [spec],
        message:
          `\`${procedure.id}\` cites \`${spec}\` as a spec, and that ` +
          `\`reference\` entry is a \`${kind}\` — not one of ` +
          `${PROCEDURE_SPEC_KINDS.map((each) => `\`${each}\``).join(" / ")}. ` +
          `\`specs\` holds the rows that carry a **figure** this job sets; a ` +
          `manual section is a citation and belongs in \`sources\`, and a VIN ` +
          `or option code answers what a code means, which no procedure sets. ` +
          `refs specs/001-foundation (PRC-03)`,
      });
    });
  }

  return issues;
}

function partIssues(
  procedures: readonly ProcedureIdentity[],
  partIds: ReadonlySet<string>
): ProcedureIssue[] {
  const issues: ProcedureIssue[] = [];

  for (const procedure of procedures) {
    procedure.partsConsumed.forEach((part, index) => {
      if (partIds.has(part)) return;
      issues.push({
        code: "unknown-part",
        entryId: procedure.id,
        field: `partsConsumed[${index}].part`,
        relatedEntryIds: [],
        message:
          `\`${procedure.id}\` consumes \`${part}\`, and no \`parts\` entry ` +
          `has that id. A consumed part is a typed reference into the parts ` +
          `collection rather than a re-spelled number, so a reader can open ` +
          `it and check the supersession chain before ordering (PRT-02). Add ` +
          `the parts entry, or drop the row. ` +
          `refs specs/001-foundation (PRC-01)`,
      });
    });
  }

  return issues;
}

function prerequisiteIssues(
  procedures: readonly ProcedureIdentity[]
): ProcedureIssue[] {
  const byId = new Map(
    procedures.map((procedure) => [procedure.id, procedure])
  );
  const issues: ProcedureIssue[] = [];

  for (const procedure of procedures) {
    for (const { index, id } of procedure.prerequisites) {
      if (byId.has(id)) continue;
      issues.push({
        code: "unknown-prerequisite",
        entryId: procedure.id,
        field: `prerequisites[${index}].procedure`,
        relatedEntryIds: [],
        message:
          `\`${procedure.id}\` requires procedure \`${id}\`, and no ` +
          `\`procedures\` entry has that id. A prerequisite that names ` +
          `another job is a link a reader follows before they start; one that ` +
          `names nothing is a job they cannot do first. Write the procedure, ` +
          `or state the prerequisite as a plain condition — a prerequisite ` +
          `row with no \`procedure\` field is a sentence, and that is a ` +
          `legitimate prerequisite. refs specs/001-foundation (PRC-01)`,
      });
    }
  }

  return [...issues, ...prerequisiteCycleIssues(procedures)];
}

/**
 * Prerequisite loops, reported **once per cycle at its lowest id** so a
 * three-job loop is one error and not three — the staging
 * `src/lib/parts/index.ts` uses for supersession cycles, and for the same
 * reason: three copies of one fact is three fixes an author has to decide are
 * the same fix.
 *
 * A cycle is walked over *every* prerequisite edge, not only the first, because
 * a job may require two others and the loop can go through either.
 */
function prerequisiteCycleIssues(
  procedures: readonly ProcedureIdentity[]
): ProcedureIssue[] {
  const byId = new Map(
    procedures.map((procedure) => [procedure.id, procedure])
  );
  const issues: ProcedureIssue[] = [];
  const reported = new Set<string>();

  const walk = (start: string, path: string[], seen: Set<string>): void => {
    const procedure = byId.get(start);
    if (procedure === undefined) return;

    for (const { id } of procedure.prerequisites) {
      if (!byId.has(id)) continue;

      if (seen.has(id)) {
        const loop = path.slice(path.indexOf(id));
        const key = [...loop].sort().join(">");
        const lowest = [...loop].sort()[0];
        if (lowest !== path[0] || reported.has(key)) continue;
        reported.add(key);
        issues.push({
          code: "prerequisite-cycle",
          entryId: loop[0] as string,
          field: "prerequisites",
          relatedEntryIds: loop.slice(1),
          message:
            `the prerequisite pointers form a loop: ` +
            `${[...loop, loop[0]].map((each) => `\`${each}\``).join(" → ")}. ` +
            `A prerequisite is a job you do *first*, so a loop is a set of ` +
            `jobs none of which can be started — and the page that renders ` +
            `"do this first" would walk it forever. One of these is not ` +
            `really a prerequisite of the other. ` +
            `refs specs/001-foundation (PRC-01)`,
        });
        continue;
      }

      seen.add(id);
      path.push(id);
      walk(id, path, seen);
      path.pop();
      seen.delete(id);
    }
  };

  for (const procedure of procedures) {
    walk(procedure.id, [procedure.id], new Set([procedure.id]));
  }

  return issues;
}

/**
 * Every reason the procedures corpus does not hold together; empty when it
 * does. The mirror of `findPartIssues`, and the function
 * `src/integrations/validate-procedures.ts` turns into a build failure naming
 * every file involved (SCF-04).
 */
export function findProcedureIssues(
  corpus: ProcedureCorpus
): readonly ProcedureIssue[] {
  const procedures = readProcedures(corpus.procedures);
  const identity = duplicateEntryIdIssues(procedures);

  // Staged the way `findPartIssues` stages its checks: while two entries share
  // an id, every pointer question has two answers, and reporting the symptom
  // next to the cause sends an author chasing the symptom.
  if (identity.length > 0) return identity;

  return [
    ...specIssues(procedures, readReferenceKinds(corpus.references)),
    ...partIssues(procedures, readPartIds(corpus.parts)),
    ...prerequisiteIssues(procedures),
  ];
}

/** Thrown by {@link assertProceduresResolve}; carries the structured issues. */
export class ProceduresResolutionError extends Error {
  readonly issues: readonly ProcedureIssue[];

  constructor(issues: readonly ProcedureIssue[]) {
    super(
      `${issues.length} procedures problem(s):\n` +
        issues.map((issue) => `  • ${issue.message}`).join("\n")
    );
    this.name = "ProceduresResolutionError";
    this.issues = issues;
  }
}

/** {@link findProcedureIssues}, as the build's throw. */
export function assertProceduresResolve(corpus: ProcedureCorpus): void {
  const issues = findProcedureIssues(corpus);
  if (issues.length === 0) return;
  throw new ProceduresResolutionError(issues);
}
