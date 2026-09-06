/**
 * Graders — the build resolves every figure id a mod states (T603; MOD-02 on
 * the PRC-03 precedent).
 *
 * > **MOD-02** WHEN a mod requires another mod or part, THE requirement SHALL
 * > be a typed reference that **the build resolves**.
 *
 * MOD-02's clause is about `requires`, and T601 discharged it there. T603's
 * figure field is the same promise about a different pointer: "a figure lives
 * once in shared reference data, resolves by ID" is worth exactly nothing if
 * nothing resolves the id before `dist/` is written. An unresolved spec id is
 * a page that renders an empty row where a roof-load limit belongs — or, if a
 * renderer is careless, no row at all, which is a confident absence derived
 * from having failed to look.
 *
 * ## Why this file and not `tests/lib/mods/`
 *
 * T603 leaves T604 a judgment call — share `src/lib/procedures/specs.ts`'s
 * module or fork a `mods`-specific one — so a grader that imported a resolver
 * by path would be choosing for the implementer. `runModsBuildCheck` is the
 * one seam that exists either way: it is the `astro:build:start` hook body,
 * it already takes a `contentRoot` so graders can run it over a deliberately
 * broken corpus, and it is what `npm run build` actually calls. Every
 * assertion below is about the *outcome of a build*, which is the property
 * MOD-02 states and the one `.claude/GRADER-PRINCIPLES.md` asks for ("grade
 * the end state, not the text").
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker, one per test; T604 activates a grader by deleting
 * exactly that `.fails`. Unmarked tests pass today and must keep passing —
 * the accept cases are vacuous today by construction (nothing reads `specs`
 * yet) and are here so that the accept side of each reject rule is written
 * down before the rule exists, not after somebody trips over a false
 * positive.
 *
 * ## The position of a bad id is not part of the rule (§4)
 *
 * Added after an independent review mutation-tested this file and found every
 * reject case citing a single id, so the id under test was always `specs[0]`.
 * §4 is the fix and carries the reasoning.
 *
 * refs specs/001-foundation (MOD-01, MOD-02, PRC-03 precedent, REF-01, SCF-04)
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runModsBuildCheck } from "../../src/integrations/validate-mods.ts";
import {
  LENGTH_SPEC,
  ROOF_LOAD_SPEC,
  TORQUE_SPEC,
  makeMod,
  makeModPart,
  makeNonFigureReference,
  makeSpecReference,
  type SpecFixture,
} from "../fixtures/mod-spec-fixtures.ts";

/**
 * The slug registry, mocked so these fixtures are not required to keep
 * `src/i18n/entry-slugs.ts` in sync — the pattern
 * `tests/integrations/validate-mods.test.ts` established.
 */
let slugRows: readonly string[] = [];

vi.mock("../../src/i18n/entry-slugs.ts", () => ({
  slugRegistryIds: (collection: string) =>
    collection === "mods" ? slugRows : [],
}));

const roots: string[] = [];

afterEach(() => {
  slugRows = [];
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

interface CorpusOptions {
  /** `reference` entries the corpus contains, by figure fixture. */
  readonly specs?: readonly SpecFixture[];
  /** `reference` entries of a kind that carries no figure, by kind. */
  readonly nonFigureKinds?: readonly string[];
  /** The ids the single mods entry cites as figures. */
  readonly cites?: readonly string[];
  /** Extra shared fields merged onto the mods entry. */
  readonly extraShared?: Record<string, unknown>;
}

/** A content root holding one mod, one part, and the named reference rows. */
function corpusOf(options: CorpusOptions = {}): string {
  const {
    specs = [TORQUE_SPEC, ROOF_LOAD_SPEC, LENGTH_SPEC],
    nonFigureKinds = [],
    cites,
    extraShared,
  } = options;

  const root = mkdtempSync(path.join(tmpdir(), "t603-mods-"));
  roots.push(root);
  for (const dir of ["mods", "parts", "reference"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }

  const mod = makeMod({
    ...(cites === undefined ? {} : { specs: cites }),
    ...(extraShared === undefined ? {} : { extraShared }),
  });
  writeFileSync(
    path.join(root, "mods", "roof-rack.json"),
    JSON.stringify(mod, null, 2)
  );

  const part = makeModPart();
  writeFileSync(
    path.join(root, "parts", "bracket.json"),
    JSON.stringify(part, null, 2)
  );

  for (const spec of specs) {
    writeFileSync(
      path.join(root, "reference", `${spec.id}.json`),
      JSON.stringify(makeSpecReference(spec), null, 2)
    );
  }

  for (const kind of nonFigureKinds) {
    writeFileSync(
      path.join(root, "reference", `test-ref-mod-${kind}.json`),
      JSON.stringify(makeNonFigureReference(kind), null, 2)
    );
  }

  slugRows = [mod["id"] as string];
  return root;
}

const logger = { info: () => {} };

async function runOver(root: string): Promise<Error | null> {
  try {
    await runModsBuildCheck({ logger }, root);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * `reference` kinds that carry **no figure** — an FSM section is a citation, a
 * VIN position and the two code kinds answer "what does this mean". Citing one
 * as a mod's figure renders an empty row, which is why it is an authoring
 * mistake with its own message rather than a silent blank.
 *
 * Enumerated here rather than imported from a `MOD_SPEC_KINDS` constant, on
 * purpose: T604 has to decide whether `fluid` and `capacity` are citable by a
 * mod (a long-range tank states a capacity; a roof rack does not), and a
 * grader that pinned the whole list would make that decision for it. These
 * four carry no figure at all, so no reading of the seam admits them.
 */
const NON_FIGURE_KINDS = [
  "fsm-section",
  "vin-position",
  "vin-code",
  "option-code",
];

/* -------------------------------------------------------------------------
 * 1. The accept side, written down first
 * ---------------------------------------------------------------------- */

describe("a corpus whose figure ids resolve builds", () => {
  it("passes a corpus that states no figures at all", () => {
    // Green today and after. A mod that states no number is a real mod, and a
    // rule that required one would get inventions.
    return expect(runOver(corpusOf())).resolves.toBeNull();
  });

  it("passes a mod citing a torque and a dimension reference", () => {
    /*
     * Vacuous today — nothing reads `specs`, so this passes because the field
     * is ignored — and written now anyway. The accept side of a rule belongs
     * in the same commit as the reject side, so that the first person to hit
     * a false positive finds the intended-legal case already recorded rather
     * than arguing it from scratch. `torque` and `dimension` are the two the
     * task line names in as many words (torque, weight, load rating,
     * dimension — mass and length are both `dimension` units, REF-01 files
     * them together).
     */
    return expect(
      runOver(corpusOf({ cites: [TORQUE_SPEC.id, ROOF_LOAD_SPEC.id] }))
    ).resolves.toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * 2. An id nobody resolves is not a reference
 * ---------------------------------------------------------------------- */

describe("the build refuses a figure id that resolves to nothing", () => {
  it.fails("FAILS the build on a spec id nobody wrote", async () => {
    const error = await runOver(
      corpusOf({ cites: ["test-ref-mod-nobody-wrote-this"] })
    );

    expect(
      error,
      "the build accepted an unresolvable figure id"
    ).not.toBeNull();
    expect(error?.message).toContain("test-ref-mod-nobody-wrote-this");
  });

  it.fails(
    "names the file of the entry carrying the bad id (SCF-04)",
    async () => {
      const error = await runOver(
        corpusOf({ cites: ["test-ref-mod-nobody-wrote-this"] })
      );

      expect(error?.message ?? "").toContain("mods/roof-rack.json");
    }
  );

  it.fails("FAILS the build on a spec id naming a `parts` entry", async () => {
    /*
     * The mirror of T601's `reference-wrong-collection`, and its reasoning
     * carries over unchanged: an id can legitimately name a part *and* the
     * reference row that states that part's torque, so "the id exists
     * somewhere" is not resolution. A figure id names a `reference` entry.
     */
    const error = await runOver(
      corpusOf({ cites: [makeModPart()["id"] as string] })
    );

    expect(error, "a `parts` id was accepted as a figure id").not.toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * 3. A kind that carries no figure is a different mistake
 * ---------------------------------------------------------------------- */

describe("the build refuses a figure id naming a kind with no figure", () => {
  it.fails.each(NON_FIGURE_KINDS)(
    "FAILS the build on a spec id naming a `%s` entry",
    async (kind) => {
      const error = await runOver(
        corpusOf({
          nonFigureKinds: [kind],
          cites: [`test-ref-mod-${kind}`],
        })
      );

      expect(
        error,
        `a \`${kind}\` reference was accepted as a figure`
      ).not.toBeNull();
      expect(error?.message).toContain(`test-ref-mod-${kind}`);
    }
  );

  it.fails("names BOTH files on a wrong-kind citation (SCF-04)", async () => {
    /*
     * The case that most needs the file index: the entry the author has to
     * look at is in a *different collection* from the entry the issue is
     * reported against. Naming only the mods file sends them to the file that
     * is arguably correct — T601's own reasoning for the
     * `reference-wrong-collection` message, applied to the figure pointer.
     */
    const message =
      (
        await runOver(
          corpusOf({
            nonFigureKinds: ["vin-code"],
            cites: ["test-ref-mod-vin-code"],
          })
        )
      )?.message ?? "";

    expect(message).toContain("mods/roof-rack.json");
    expect(message).toContain("reference/test-ref-mod-vin-code.json");
  });
});

/* -------------------------------------------------------------------------
 * 4. WHERE the bad id sits in the list is not part of the rule
 *
 * Found by an independent review of this file, by mutation and not by reading
 * it (`.claude/GRADER-PRINCIPLES.md`, "mutation-test the probe corpus
 * itself"). Every reject case above cites exactly **one** id, so the id under
 * test is always `specs[0]`. A scratch resolver that validated only the first
 * element — `const [first] = specs`, a stray `return` where a `continue`
 * belonged, `.find()` where `.filter()` belonged, all three realistic slips in
 * a loop somebody writes once — turned every marker in this file green while
 * shipping a build that resolves the first figure a mod cites and takes the
 * rest on faith.
 *
 * These cases are that mutant's obituary. Each cites a list whose **first id
 * resolves correctly** and whose bad id sits somewhere else, so passing them
 * requires visiting every element; the accept case directly below them is what
 * stops "a list longer than one is an error" from being the cheap way through.
 *
 * The positions are chosen against specific loop bugs, not for coverage's
 * sake: index 1 of 2 kills first-only and an `i < length - 1` bound; index 1
 * of 3 kills first-only *and* last-only (`specs.at(-1)`); two bad ids in one
 * list kills "report the first problem and stop", which the module's own
 * contract already forbids ("listing every issue rather than the first — one
 * pass per fix", `src/integrations/validate-mods.ts`).
 * ---------------------------------------------------------------------- */

describe("the build checks EVERY cited id, not just the first", () => {
  it("passes a mod citing three ids that all resolve", () => {
    /*
     * The accept side, and the control that makes the three rejects below
     * mean what they say. Without it, a resolver that refused any `specs`
     * list longer than one element would satisfy all three and be called
     * correct. Vacuous today (nothing reads `specs`), green after T604.
     */
    return expect(
      runOver(
        corpusOf({
          cites: [TORQUE_SPEC.id, ROOF_LOAD_SPEC.id, LENGTH_SPEC.id],
        })
      )
    ).resolves.toBeNull();
  });

  it.fails(
    "FAILS the build on an unresolvable id in SECOND position",
    async () => {
      const error = await runOver(
        corpusOf({
          cites: [TORQUE_SPEC.id, "test-ref-mod-nobody-wrote-this"],
        })
      );

      expect(
        error,
        "the build resolved the first figure id and took the second on faith"
      ).not.toBeNull();
      expect(error?.message).toContain("test-ref-mod-nobody-wrote-this");
    }
  );

  it.fails(
    "FAILS the build on an unresolvable id in the MIDDLE of the list",
    async () => {
      // The position no off-by-one reaches by accident: not first, not last.
      const error = await runOver(
        corpusOf({
          cites: [
            TORQUE_SPEC.id,
            "test-ref-mod-nobody-wrote-this",
            ROOF_LOAD_SPEC.id,
          ],
        })
      );

      expect(
        error,
        "an unresolvable id between two good ones was accepted"
      ).not.toBeNull();
      expect(error?.message).toContain("test-ref-mod-nobody-wrote-this");
    }
  );

  it.fails(
    "FAILS the build on a wrong-kind id that is not the first cited",
    async () => {
      /*
       * The same position argument applied to the other rule. A resolver can
       * plausibly check existence for every id and the *kind* only for the
       * first — two loops where one was meant — and the single-id cases above
       * cannot tell the difference.
       */
      const error = await runOver(
        corpusOf({
          nonFigureKinds: ["vin-code"],
          cites: [TORQUE_SPEC.id, "test-ref-mod-vin-code"],
        })
      );

      expect(
        error,
        "a `vin-code` reference in second position was accepted as a figure"
      ).not.toBeNull();
      expect(error?.message).toContain("test-ref-mod-vin-code");
    }
  );

  it.fails("names BOTH bad ids when a list carries two", async () => {
    // "One pass per fix" — an author who fixes the id the message named and
    // rebuilds into the same failure learns the check is untrustworthy.
    const message =
      (
        await runOver(
          corpusOf({
            cites: [
              "test-ref-mod-nobody-wrote-this",
              TORQUE_SPEC.id,
              "test-ref-mod-second-ghost",
            ],
          })
        )
      )?.message ?? "";

    // Two ids sharing no prefix, so neither assertion can be satisfied by the
    // other id's substring.
    expect(message).toContain("test-ref-mod-nobody-wrote-this");
    expect(message, "only the first bad id was reported").toContain(
      "test-ref-mod-second-ghost"
    );
  });
});

/* -------------------------------------------------------------------------
 * 5. Anti-vacuity — this harness can fail
 *
 * Every marked grader above asserts that a build *failed*. If `runOver` could
 * not report a failure at all — a mis-wired mock, a corpus written to the
 * wrong directory, a hook that silently returns — they would all be red for a
 * reason that has nothing to do with T604's seam, and the activation would
 * look impossible. This proves the opposite on a rule that already exists.
 * ---------------------------------------------------------------------- */

describe("the harness reports a real build failure", () => {
  it("FAILS the build on a requirement that names nothing (T601's rule)", async () => {
    const root = corpusOf({
      extraShared: {
        requires: [{ collection: "parts", id: "test-part-mod-ghost" }],
      },
    });
    const error = await runOver(root);

    expect(error).not.toBeNull();
    expect(error?.message).toContain("test-part-mod-ghost");
    expect(error?.message).toContain("mods/roof-rack.json");
  });
});
