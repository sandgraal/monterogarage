/**
 * The mods graph (MOD-01, MOD-02) — everything about the `mods` collection
 * that one entry cannot see on its own.
 *
 * `src/schemas/mods.ts` owns the shape of a single entry and the
 * contradictions visible from inside it. This module owns the questions that
 * are only answerable with the whole corpus in hand:
 *
 * 1. **Does every typed reference resolve?** (MOD-02: "a typed reference that
 *    the build resolves".) A `requires` or `affects[].ref` naming no entry is
 *    a build failure — and so, separately, is one naming an entry that exists
 *    in the *other* collection, because that is the mistake the discriminator
 *    was added to catch and reporting it as "not found" would hide the fix.
 * 2. **Does the requirement graph terminate?** A cycle is a build failure: it
 *    is a set of mods none of which can be fitted first, and a page walking
 *    the prerequisites to draw them would walk it forever.
 * 3. **Is each entry id unique?** Two entries claiming one id make every
 *    pointer to it ambiguous, exactly as in `src/lib/parts/index.ts`.
 * 4. **Does each `specs[]` id name a `reference` entry, and is it a kind that
 *    carries a figure?** (T604, on PRC-03's precedent.) "That row does not
 *    exist" and "you cited a row with no number in it" are two different
 *    mistakes that send an author to two different places, so they are two
 *    codes — the division `src/lib/procedures/index.ts` already draws for the
 *    identical pointer.
 *
 * ## Why the spec vocabulary is imported rather than re-declared
 *
 * {@link MOD_SPEC_KINDS} is `PROCEDURE_SPEC_KINDS`, aliased and not copied. The
 * question both ask is the same question — *which `reference` kinds carry a
 * figure* — and it has one answer, decided by REF-01's own filing rather than
 * by either collection's taste. Two lists would be two vocabularies an author
 * has to learn per collection and would drift the first time `reference` gained
 * a kind; that is the "never re-mint" discipline T501 records for
 * `sourceKind.*` and T502 was told to follow. `src/lib/procedures/index.ts` is
 * dependency-free, so importing it keeps this module's build-hook chain a
 * straight line. **If the two ever genuinely need to differ**, that is the
 * moment to lift the list into a shared module — not a reason to fork it now.
 *
 * ## Why a lib and an integration, and not a `check:*` script
 *
 * The division `src/lib/fitment/` + `src/integrations/validate-fitments.ts`
 * settled for FIT-02 and `src/lib/parts/` repeated for PRT-03: the rules are
 * pure functions that deserve unit tests without a browser or a build, and the
 * *build* is where a broken corpus actually stops. The lib returns issues
 * rather than throwing, so one build reports every problem instead of the
 * first.
 *
 * ## What this module deliberately does *not* import
 *
 * `src/integrations/validate-mods.ts` reaches this module from inside an
 * `astro:build:start` hook, which Astro resolves through Node's own ESM
 * resolver rather than through Vite. So every specifier on this chain carries
 * its `.ts` extension, and the chain has to stay short: the vocabularies come
 * from the dependency-free `./references.ts` rather than from
 * `src/schemas/mods.ts`, and the safety widening lives in `./safety.ts`
 * because `src/lib/safety.ts` is not on that chain. Same constraint,
 * same shape, as `src/lib/parts/part-numbers.ts`.
 *
 * Nothing here interprets a fitment (FIT-01).
 *
 * refs specs/001-foundation (MOD-01, MOD-02, SCF-04)
 */
import {
  MOD_REFERENCE_COLLECTIONS,
  modReferenceKey,
  type ModReferenceCollection,
} from "./references.ts";
import {
  PROCEDURE_SPEC_KINDS,
  readReferenceKinds,
} from "../procedures/index.ts";

/**
 * `id → kind` for every readable `reference` entry — re-exported, not
 * re-implemented, for the reason {@link MOD_SPEC_KINDS} records. Reading a
 * collection's `kind` field is not a mods idea or a procedures idea; a second
 * copy would be a second thing to keep correct.
 */
export { readReferenceKinds };

/**
 * The `reference` kinds a mod may cite as a figure — see the module docstring
 * for why this is an alias and not a second list.
 *
 * All four are reachable from a real mod, which is why none of them is trimmed
 * here: a roof rack states a **torque** and a load rating (a `dimension` — REF-01
 * files length, mass and angle together, so a weight and a load rating are
 * already storable), a long-range tank states a **capacity**, and a locker
 * install changes the diff's **fluid** designation. Trimming the last two would
 * leave an author with a figure, no legal way to cite it, and only one remaining
 * move — writing the number into a sentence, which is the exact outcome this
 * seam exists to prevent. A closed loop with no correct move in it is a schema
 * bug (the reasoning `PROCEDURE_SPEC_KINDS` records for `dimension`).
 *
 * The four kinds this list does **not** admit — `fsm-section` and the three
 * decoder kinds — carry no figure at all, so excluding them closes no loop on
 * anybody: a manual section is a citation and belongs in `sources`, and a VIN
 * or option code answers "what does this code mean", which no mod sets.
 */
export const MOD_SPEC_KINDS = PROCEDURE_SPEC_KINDS;

const SPEC_KIND_SET: ReadonlySet<string> = new Set(MOD_SPEC_KINDS);

/* -------------------------------------------------------------------------
 * What this module reads
 * ---------------------------------------------------------------------- */

/** One typed reference, as the graph sees it. */
export interface ModReferenceIdentity {
  readonly collection: string;
  readonly id: string;
  /**
   * Where it sits in the entry, as a dotted field path (`requires[0]`,
   * `affects[2].ref`) — SCF-04 asks the build to name the field, and a
   * reference that has forgotten where it came from cannot.
   */
  readonly field: string;
}

/**
 * The slice of a mods entry the graph needs, read tolerantly from `unknown` by
 * {@link readMods}: shape is the schema's business, and a module that threw on
 * a malformed entry would replace the schema's precise, field-named error with
 * a stack trace.
 */
export interface ModIdentity {
  readonly id: string;
  /** Every typed reference the entry makes, `requires` then `affects[].ref`. */
  readonly references: readonly ModReferenceIdentity[];
  /** The `requires` subset that points at another **mod** — the cycle edges. */
  readonly requiredModIds: readonly string[];
  /**
   * The `reference` entry ids this mod cites as figures (T604), in declaration
   * order — the author chose which figure a reader meets first.
   */
  readonly specs: readonly string[];
}

/** The slice of any referenced entry the resolver needs: does this id exist? */
export interface ReferencableEntry {
  readonly collection: string;
  readonly id: string;
}

export const MOD_ISSUE_CODES = [
  "duplicate-entry-id",
  "dangling-reference",
  "reference-wrong-collection",
  "requirement-cycle",
  /** `specs[i]` names no `reference` entry (T604). */
  "unknown-spec",
  /** It names one, of a kind {@link MOD_SPEC_KINDS} does not admit. */
  "wrong-spec-kind",
] as const;

export type ModIssueCode = (typeof MOD_ISSUE_CODES)[number];

export interface ModIssue {
  readonly code: ModIssueCode;
  /** The entry the issue is reported against. */
  readonly entryId: string;
  /** Dotted field path within that entry (SCF-04). */
  readonly field: string;
  /**
   * Every *other* entry the issue is about — the rest of a cycle, the
   * collection that actually holds a misfiled id. The build caller turns these
   * into file paths, which is why the ids are structured rather than only
   * spelled into the message.
   */
  readonly relatedEntryIds: readonly string[];
  readonly message: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** One `{ collection, id }` pair, or `null` when either half is unreadable. */
function readReference(
  value: unknown,
  field: string
): ModReferenceIdentity | null {
  const record = asRecord(value);
  if (record === null) return null;

  const collection = asNonEmptyString(record["collection"]);
  const id = asNonEmptyString(record["id"]);
  if (collection === null || id === null) return null;

  return { collection, id, field };
}

/**
 * Every readable mods entry, in input order.
 *
 * An entry with no `id` is skipped rather than reported: the schema already
 * rejects it, by field, and a second complaint here would send an author
 * chasing two problems for one mistake.
 */
export function readMods(entries: readonly unknown[]): ModIdentity[] {
  const mods: ModIdentity[] = [];

  for (const entry of entries) {
    const record = asRecord(entry);
    if (record === null) continue;

    const id = asNonEmptyString(record["id"]);
    if (id === null) continue;

    const references: ModReferenceIdentity[] = [];
    const requiredModIds: string[] = [];

    const requires = record["requires"];
    if (Array.isArray(requires)) {
      requires.forEach((value, index) => {
        const reference = readReference(value, `requires[${index}]`);
        if (reference === null) return;
        references.push(reference);
        if (reference.collection === "mods") requiredModIds.push(reference.id);
      });
    }

    const affects = record["affects"];
    if (Array.isArray(affects)) {
      affects.forEach((value, index) => {
        const row = asRecord(value);
        if (row === null) return;
        if (row["ref"] === undefined) return;
        const reference = readReference(row["ref"], `affects[${index}].ref`);
        if (reference === null) return;
        references.push(reference);
      });
    }

    /*
     * Read tolerantly, like every other list here: a non-string element is the
     * schema's complaint to make (by field, with a message), and a second one
     * from the build would send an author chasing two problems for one mistake.
     */
    const specsField = record["specs"];
    const specs = Array.isArray(specsField)
      ? specsField.filter((value): value is string => typeof value === "string")
      : [];

    mods.push({ id, references, requiredModIds, specs });
  }

  return mods;
}

/**
 * Every id that exists in each referencable collection.
 *
 * Callers pass the collections a reference may target
 * ({@link MOD_REFERENCE_COLLECTIONS}); an absent collection is an **empty
 * set**, which is why {@link findModIssues} reports "no entry has that id"
 * rather than assuming — a caller with no parts in hand and a caller whose
 * parts corpus is genuinely empty are the same state, and neither one is
 * permission to wave a pointer through.
 */
export function readReferencable(
  entries: readonly ReferencableEntry[]
): ReadonlyMap<string, ReadonlySet<string>> {
  const byCollection = new Map<string, Set<string>>();
  for (const collection of MOD_REFERENCE_COLLECTIONS) {
    byCollection.set(collection, new Set<string>());
  }

  for (const { collection, id } of entries) {
    const ids = byCollection.get(collection) ?? new Set<string>();
    ids.add(id);
    byCollection.set(collection, ids);
  }

  return byCollection;
}

/* -------------------------------------------------------------------------
 * The build rules
 * ---------------------------------------------------------------------- */

function duplicateEntryIdIssues(mods: readonly ModIdentity[]): ModIssue[] {
  const byId = new Map<string, ModIdentity[]>();
  for (const mod of mods) {
    byId.set(mod.id, [...(byId.get(mod.id) ?? []), mod]);
  }

  return [...byId.entries()]
    .filter(([, group]) => group.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, group]) => ({
      code: "duplicate-entry-id" as const,
      entryId: id,
      field: "id",
      /**
       * Empty, and that is the honest answer — the reasoning
       * `src/lib/parts/index.ts` records verbatim: every entry in the group
       * declares *this* id, so there is no other id to name. What
       * distinguishes them is their **file**, which this module cannot see;
       * `src/integrations/validate-mods.ts` resolves the id to every file
       * that declares it.
       */
      relatedEntryIds: [],
      message:
        `${group.length} mods entries declare \`id: "${id}"\`. Entry ids are ` +
        `how every typed reference names a mod (MOD-02), so a duplicated id ` +
        `makes every pointer to it ambiguous. The files are listed below. ` +
        `refs specs/001-foundation (MOD-02)`,
    }));
}

/**
 * MOD-02's "a typed reference that the build resolves", as two distinct
 * failures.
 *
 * `dangling-reference` — nothing anywhere has that id.
 * `reference-wrong-collection` — something does, in the *other* collection.
 *
 * Splitting them is the point of the discriminator. Folding the second into
 * the first would tell an author "no such entry" about an entry they are
 * looking straight at, and send them to write a duplicate of it.
 */
function referenceIssues(
  mods: readonly ModIdentity[],
  known: ReadonlyMap<string, ReadonlySet<string>>
): ModIssue[] {
  const issues: ModIssue[] = [];

  for (const mod of mods) {
    for (const { collection, id, field } of mod.references) {
      if (known.get(collection)?.has(id) === true) continue;

      const elsewhere = [...MOD_REFERENCE_COLLECTIONS].filter(
        (candidate) =>
          candidate !== collection && known.get(candidate)?.has(id) === true
      );

      if (elsewhere.length > 0) {
        issues.push({
          code: "reference-wrong-collection",
          entryId: mod.id,
          field,
          relatedEntryIds: [id],
          message:
            `\`${mod.id}\` names \`${modReferenceKey({ collection, id })}\`, ` +
            `and no entry in the \`${collection}\` collection has that id — ` +
            `but ${elsewhere.map((name) => `\`${name}\``).join(" / ")} does. ` +
            `A typed reference says which collection to look in (MOD-02), so ` +
            `this is a one-word fix and not a missing entry: set ` +
            `\`collection\` to ${elsewhere.map((name) => `\`${name}\``).join(" / ")}. ` +
            `refs specs/001-foundation (MOD-02)`,
        });
        continue;
      }

      issues.push({
        code: "dangling-reference",
        entryId: mod.id,
        field,
        relatedEntryIds: [],
        message:
          `\`${mod.id}\` names \`${modReferenceKey({ collection, id })}\`, ` +
          `and no entry in that collection has that id. A requirement is a ` +
          `typed reference the build resolves (MOD-02): the thing it names ` +
          `gets its own entry — with its own fitment, its own sources and ` +
          `both prose locales — or the reference comes out. A prerequisite a ` +
          `reader cannot open is a prerequisite they cannot price. ` +
          `refs specs/001-foundation (MOD-02)`,
      });
    }
  }

  return issues;
}

/**
 * T604's promise, as two distinct failures: every cited figure id names a
 * `reference` entry, and that entry is a kind that actually carries a number.
 *
 * ## Every id, on every entry, every time
 *
 * Both loops are unconditional and neither of them breaks early. That is worth
 * saying out loud because it is the one thing the graders could not prove: the
 * T603 review found the resolver-shaped mutants a reviewer had to build by hand
 * — `const [first] = specs`, a stray `return` where a `continue` belonged,
 * `.find()` where `.filter()` belonged — and a corpus with one mods entry
 * cannot tell a `for (const mod of mods)` from a `mods[0]`. So: the outer loop
 * visits **every mod**, the inner `forEach` visits **every id**, and each
 * problem is pushed rather than returned, because
 * `src/integrations/validate-mods.ts`' own contract is one pass per fix — an
 * author who fixes the id the message named and rebuilds into the same failure
 * learns the check is untrustworthy.
 *
 * `relatedEntryIds` carries the cited id on a wrong-kind issue and not on an
 * unknown one, and the asymmetry is deliberate: the build caller turns those
 * ids into **file paths**, and on a wrong-kind citation the file the author has
 * to open is in a different collection from the entry the issue is reported
 * against. An id that resolves to nothing has no file to name.
 */
function specIssues(
  mods: readonly ModIdentity[],
  referenceKinds: ReadonlyMap<string, string>
): ModIssue[] {
  const issues: ModIssue[] = [];

  for (const mod of mods) {
    mod.specs.forEach((spec, index) => {
      const kind = referenceKinds.get(spec);

      if (kind === undefined) {
        issues.push({
          code: "unknown-spec",
          entryId: mod.id,
          field: `specs[${index}]`,
          relatedEntryIds: [],
          message:
            `\`${mod.id}\` cites figure \`${spec}\`, and no \`reference\` ` +
            `entry has that id. A figure comes from shared reference data ` +
            `**by ID**, so the id is a typed reference the build resolves: ` +
            `write the reference entry — with its own fitment, its own ` +
            `sources and both prose locales — or take the citation out. A ` +
            `number typed into the tradeoffs prose instead is the one thing ` +
            `this field exists to prevent. ` +
            `refs specs/001-foundation (MOD-01, PRC-03 precedent)`,
        });
        return;
      }

      if (SPEC_KIND_SET.has(kind)) return;

      issues.push({
        code: "wrong-spec-kind",
        entryId: mod.id,
        field: `specs[${index}]`,
        relatedEntryIds: [spec],
        message:
          `\`${mod.id}\` cites \`${spec}\` as a figure, and that ` +
          `\`reference\` entry is a \`${kind}\` — not one of ` +
          `${MOD_SPEC_KINDS.map((each) => `\`${each}\``).join(" / ")}. ` +
          `\`specs\` holds the rows that carry a **number** this mod states — ` +
          `a fastener torque, a load rating, a capacity, a fluid spec. A ` +
          `manual section is a citation and belongs in \`sources\`, and a VIN ` +
          `or option code answers what a code means, which no mod sets. ` +
          `Citing one renders an empty row, so it is an authoring mistake ` +
          `with an answer rather than a silent blank. ` +
          `refs specs/001-foundation (MOD-01, PRC-03 precedent)`,
      });
    });
  }

  return issues;
}

/**
 * The strongly connected components of the requirement graph, by Tarjan's
 * algorithm — every node reachable from every other node in its own group.
 *
 * ## Why an SCC pass and not a walk
 *
 * `src/lib/parts/index.ts` detects its supersession loops by walking pointers,
 * and that is complete *there* because `supersededBy` is a single edge: a
 * walk that follows "the" pointer has followed all of them. `requires` is a
 * **list**, so the same walk is not complete and quietly misses cycles — with
 * `a → [b]`, `b → [c, a]`, following only `b`'s first edge walks off down `c`
 * and never sees `a → b → a`. That is precisely the shape a real corpus
 * produces (a mod with two prerequisites, one of which loops back), and a
 * cycle detector that misses cycles is worse than none, because it reads as
 * proof.
 *
 * SCCs remove the question rather than patching the walk: **every** cycle
 * lives entirely inside one component, so a graph whose components are all
 * singletons (with no self-edge) is acyclic, no exceptions and no ordering
 * luck. Reporting one issue per non-trivial component also means a knot of
 * four mods that require each other is one error naming four ids, rather than
 * an enumeration of its elementary cycles — of which there can be
 * exponentially many.
 *
 * Recursive rather than iterative: the depth is bounded by the number of mods
 * entries in the repo, which is a hand-written corpus.
 */
function stronglyConnectedComponents(mods: readonly ModIdentity[]): string[][] {
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const strongConnect = (id: string): void => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);

    for (const next of byId.get(id)?.requiredModIds ?? []) {
      if (!byId.has(next)) continue; // dangling — reported by `referenceIssues`
      if (!index.has(next)) {
        strongConnect(next);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) ?? 0, index.get(next) ?? 0));
      }
    }

    if (low.get(id) !== index.get(id)) return;

    const component: string[] = [];
    for (;;) {
      const popped = stack.pop();
      if (popped === undefined) break;
      onStack.delete(popped);
      component.push(popped);
      if (popped === id) break;
    }
    components.push(component);
  };

  // Sorted, so the components — and therefore the issues — come out in a
  // deterministic order whatever order the loader handed the files over in.
  for (const id of [...byId.keys()].sort()) {
    if (!index.has(id)) strongConnect(id);
  }

  return components;
}

/**
 * One concrete `a → b → c → a` path through a component, for the error
 * message.
 *
 * The component itself is the *finding*; this is only how it is spelled. A
 * reader fixing a four-mod knot needs to see one loop through it, not a set.
 * Starts at the component's lowest id and prefers the lowest next hop at each
 * step, so the path is deterministic.
 */
function cyclePath(
  members: readonly string[],
  byId: ReadonlyMap<string, ModIdentity>
): string[] {
  const inComponent = new Set(members);
  const start = [...members].sort()[0];
  if (start === undefined) return [];

  const path: string[] = [start];
  const visited = new Set<string>([start]);
  let cursor = start;

  for (;;) {
    const next = [...(byId.get(cursor)?.requiredModIds ?? [])]
      .filter((id) => inComponent.has(id))
      .sort()
      .find((id) => id === start || !visited.has(id));
    if (next === undefined) return path;
    if (next === start) return path;
    path.push(next);
    visited.add(next);
    cursor = next;
  }
}

/**
 * A requirement cycle, reported **once per cycle** at its lowest id — so a
 * three-mod loop is one error and not three.
 *
 * Only `requires` edges that point at another **mod** can form one: a `parts`
 * entry has no `requires` field to point back with, and `affects` is a
 * consequence rather than a precondition — a mod that degrades another mod
 * which degrades it back is a perfectly honest pair of sentences, not a
 * contradiction. Failing a build over that would be failing over the truth.
 */
function requirementCycleIssues(mods: readonly ModIdentity[]): ModIssue[] {
  const byId = new Map(mods.map((mod) => [mod.id, mod]));

  return stronglyConnectedComponents(mods)
    .filter((component) => {
      if (component.length > 1) return true;
      // A one-node component is a cycle only if it requires itself. The schema
      // catches that from inside the entry; the build catches it too, because
      // a rule that only one of the two layers enforces is a rule that stops
      // being enforced the day the other layer is refactored.
      const only = component[0];
      return (
        only !== undefined &&
        (byId.get(only)?.requiredModIds ?? []).includes(only)
      );
    })
    .map((component) => {
      const members = [...component].sort();
      const entryId = members[0] as string;
      const loop = cyclePath(members, byId);

      return {
        code: "requirement-cycle" as const,
        entryId,
        field: "requires",
        relatedEntryIds: members.filter((id) => id !== entryId),
        message:
          `the requirement pointers form a loop: ` +
          `${[...loop, loop[0]].map((id) => `\`${id}\``).join(" → ")}` +
          (members.length > loop.length
            ? ` (all of ${members.map((id) => `\`${id}\``).join(", ")} require ` +
              `one another, directly or through each other)`
            : "") +
          `. A prerequisite has to be fittable first, and in a loop none of ` +
          `them is — there is no order in which a reader could do this work, ` +
          `and a page walking the prerequisites would walk it forever. ` +
          `refs specs/001-foundation (MOD-02)`,
      };
    })
    .sort((a, b) => (a.entryId < b.entryId ? -1 : 1));
}

/**
 * Every reason the mods corpus does not hold together; empty when it does.
 *
 * `known` is the id set per referencable collection, from
 * {@link readReferencable}. A caller with nothing in hand passes an empty
 * list, and every reference is then reported as dangling — which is the
 * honest outcome, not a reason to skip the check.
 *
 * `referenceKinds` is `id → kind` for the `reference` collection, from
 * {@link readReferenceKinds}. It defaults to empty for the same reason `known`
 * does not special-case an empty corpus: a caller that has not loaded
 * `reference` and a corpus with no reference entries are the same state, and
 * neither is permission to wave a figure pointer through. An entry that cites
 * no figure is unaffected either way, which is what keeps the default from
 * quietly weakening a caller that forgot the argument.
 */
export function findModIssues(
  mods: readonly ModIdentity[],
  known: ReadonlyMap<string, ReadonlySet<string>>,
  referenceKinds: ReadonlyMap<string, string> = new Map()
): readonly ModIssue[] {
  const identity = duplicateEntryIdIssues(mods);

  // Staged the way `findPartIssues` stages its checks: while two entries share
  // an id, "does this pointer resolve" is a question with two answers, and
  // reporting a derived failure next to the real one sends the author chasing
  // a symptom.
  if (identity.length > 0) return identity;

  return [
    ...referenceIssues(mods, known),
    ...specIssues(mods, referenceKinds),
    ...requirementCycleIssues(mods),
  ];
}

/** Thrown by {@link assertModsResolve}; carries the structured issues. */
export class ModsResolutionError extends Error {
  readonly issues: readonly ModIssue[];

  constructor(issues: readonly ModIssue[]) {
    super(
      `${issues.length} mods problem(s):\n` +
        issues.map((issue) => `  • ${issue.message}`).join("\n")
    );
    this.name = "ModsResolutionError";
    this.issues = issues;
  }
}

/** {@link findModIssues}, as the build's throw. */
export function assertModsResolve(
  mods: readonly ModIdentity[],
  known: ReadonlyMap<string, ReadonlySet<string>>,
  referenceKinds: ReadonlyMap<string, string> = new Map()
): void {
  const issues = findModIssues(mods, known, referenceKinds);
  if (issues.length === 0) return;
  throw new ModsResolutionError(issues);
}

/* -------------------------------------------------------------------------
 * What a mod page renders
 * ---------------------------------------------------------------------- */

/**
 * One prerequisite, resolved far enough for a template to render it: which
 * collection it lives in (so the page knows which route registry to ask) and
 * whether the corpus actually has it.
 *
 * `resolved: false` is kept as its own value rather than dropped from the
 * list. The build refuses that corpus, so it is unreachable in a real build —
 * but a page that silently omitted an unresolvable prerequisite would render
 * a *shorter* list of requirements than the entry declares, which is the
 * confident-zero failure AGENTS.md names ("a failure is not a zero"): a reader
 * would be told this mod needs less than it does.
 */
export interface ResolvedRequirement {
  readonly collection: ModReferenceCollection;
  readonly id: string;
  readonly resolved: boolean;
}

/**
 * An entry's `requires` list, each row marked resolved or not against `known`.
 *
 * Order is the entry's own: an author lists prerequisites in the order they
 * are done, and re-sorting them would be the page inventing a sequence.
 */
export function resolveRequirements(
  requires: readonly unknown[],
  known: ReadonlyMap<string, ReadonlySet<string>>
): readonly ResolvedRequirement[] {
  const rows: ResolvedRequirement[] = [];

  for (const value of requires) {
    const reference = readReference(value, "requires");
    if (reference === null) continue;
    if (
      !(MOD_REFERENCE_COLLECTIONS as readonly string[]).includes(
        reference.collection
      )
    ) {
      continue;
    }

    rows.push({
      collection: reference.collection as ModReferenceCollection,
      id: reference.id,
      resolved: known.get(reference.collection)?.has(reference.id) === true,
    });
  }

  return rows;
}
