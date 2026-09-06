/**
 * Graders — `check:citations` actually walks a mod's figures, and every
 * shipped entry whose numbers live in a citation's title has a typed
 * alternative (T603; REF-02, MOD-01).
 *
 * > **REF-02** IF a numeric value in any reference entry lacks a source
 * > citation, THEN `check:citations` SHALL fail naming the entry and field.
 *
 * ## The finding this file exists for, in T602's own words
 *
 * > `check:citations` only walks typed fields, so it passes on these entries
 * > **because** the numbers are hidden from it — the "every numeric spec
 * > carries a source" guarantee is vacuous for them.
 *
 * "Vacuous" is the operative word, and it is why this file grades the checker
 * against real parsed entries rather than restating the schema graders. A
 * figure stored as a string, stored inside prose, or stored under a key
 * `sharedData()` skips is invisible to `numericLeaves` — and each of those is
 * a plausible T604 choice that would satisfy every field-shape grader in
 * `mods-spec-by-id.test.ts` while quietly leaving `mods` outside REF-02's
 * enforcement. The only way to see the difference is to hand the result to the
 * real checker, which is what this file does.
 *
 * ## The precedent that says a scan's scope is where the bug hides
 *
 * T502's review, F2: *"PRC-03's prose detector did not scan `summary`… the
 * reviewer's probe shipped '39 N·m' twice, once per locale, past every gate."*
 * A rule that is correct about the fields it looks at and silent about one it
 * does not is the shape of every defect this repository has paid for twice.
 * The controls below pin the scan's *scope* — that the new field is not under
 * a reserved key, that a number placed in it is reported by path — separately
 * from the rule itself.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker, one per test; T604 activates a grader by deleting
 * exactly that `.fails`. Everything unmarked is green today and must stay
 * green — including the two that document a gap `check:citations` will still
 * have after T604, so that a later reader can tell a deliberate limit from an
 * oversight.
 *
 * refs specs/001-foundation (REF-02, MOD-01, MOD-02, PRC-03 precedent)
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { findCitationIssues } from "../../scripts/check-citations.mjs";
import { RESERVED_ENTRY_FIELDS } from "../../scripts/lib/content-entries.mjs";
import { findInlinedFigure } from "../../src/lib/procedures/figures.ts";
import { accepts, issueSummary, parsedModData } from "../helpers/mods.ts";
import {
  ROOF_LOAD_SPEC,
  TORQUE_SPEC,
  makeMod,
  makeSource,
  makeSpecReference,
} from "../fixtures/mod-spec-fixtures.ts";

interface CitationIssue {
  readonly field: string;
  readonly message: string;
}

/** Every field `check:citations` names on one entry, as it sees it on disk. */
function citationFields(
  data: unknown,
  collection = "mods",
  file = "src/content/mods/test-mod-roof-rack.json"
): string[] {
  return (
    findCitationIssues({ collection, file, data }) as CitationIssue[]
  ).map((issue) => issue.field);
}

/**
 * One parsed mod, as `check:citations` sees it.
 *
 * The confidence tier moves with the sources, and that is not cosmetic:
 * `defineEntrySchema` refuses an entry claiming `fsm-confirmed` or `tsb` while
 * `sources` is empty, so an uncited fixture at a documentary tier would never
 * parse and this file would grade a thrown fixture rather than the checker.
 * `first-hand` is the honest tier for an uncited entry and is exactly the case
 * REF-02 exists for: the tier gate lets it through, and the *number* is what
 * still needs a source.
 */
function modCitationFields(
  options: Parameters<typeof makeMod>[0] = {}
): string[] {
  const uncited = options.sources !== undefined && options.sources.length === 0;

  return citationFields(
    parsedModData(
      makeMod({ ...(uncited ? { confidence: "first-hand" } : {}), ...options })
    )
  );
}

/* -------------------------------------------------------------------------
 * 1. `mods` is inside REF-02 at all — the control everything else rests on
 * ---------------------------------------------------------------------- */

describe("an uncited mod fails `check:citations` by field (REF-02)", () => {
  it("names the difficulty", () => {
    // Green today. Without it, every grader below could be passing because
    // `findCitationIssues` never reports on a `mods` entry at all.
    expect(modCitationFields({ sources: [] })).toContain("difficulty");
  });

  it("says the figure and the rule in the message, not just the field", () => {
    const [issue] = findCitationIssues({
      collection: "mods",
      file: "src/content/mods/test-mod-roof-rack.json",
      data: parsedModData(
        makeMod({ confidence: "first-hand", sources: [], difficulty: 4 })
      ),
    }) as CitationIssue[];

    expect(issue?.message).toMatch(/difficulty/);
    expect(issue?.message).toMatch(/4/);
    expect(issue?.message).toMatch(/REF-02/);
  });

  it("is clean once the entry cites one source", () => {
    // The control that keeps the rule from being "mods may not carry
    // numbers". REF-02 asks for a citation, not for silence.
    expect(modCitationFields({ sources: [makeSource("forum")] })).toEqual([]);
  });

  it("does not treat the fitment year range as an uncited spec", () => {
    // `fitment` is part of the fixed entry envelope, which
    // `scripts/check-citations.mjs` deliberately never scans: those numbers
    // say which trucks the entry is about, not what the entry asserts.
    expect(
      modCitationFields({ sources: [] }).filter((field) =>
        field.startsWith("fitment")
      )
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 2. The scan's scope — the new field must not be a blind spot
 *
 * These are green today and are the ratchet, not the feature. They fail if
 * T604 puts the figure path under a reserved key, inside `prose`, or anywhere
 * else `sharedData()` skips — the F2-shaped mistake, caught by grading the
 * scope rather than the rule.
 * ---------------------------------------------------------------------- */

describe("`check:citations` can reach the field T604 adds", () => {
  it("does not skip `specs` as part of the fixed entry envelope", () => {
    expect(RESERVED_ENTRY_FIELDS).not.toContain("specs");
  });

  it("names a number written into `specs`, by path", () => {
    /*
     * Hand-built rather than parsed, because this grades the *checker* and
     * not the schema: `check:citations` reads the JSON on disk, so it sees
     * whatever a file literally contains, including shapes the schema would
     * refuse. If T604's field ever carried a raw figure, REF-02 would still
     * see it — and if the field were named `sources` or nested under `prose`,
     * it would not, which is the whole point of this assertion.
     */
    const fields = citationFields({
      id: "test-mod-roof-rack",
      fitment: { gens: ["gen3"] },
      system: "body",
      specs: [{ id: TORQUE_SPEC.id, torque: { value: 100, unit: "nm" } }],
      confidence: "first-hand",
      sources: [],
      prose: {},
    });

    expect(fields).toContain("specs[0].torque.value");
  });

  it("stays silent on a figure hidden inside a citation's title", () => {
    /*
     * The gap, asserted so it cannot be mistaken for an oversight — and the
     * reason T603 exists rather than "widen `check:citations` to scan
     * strings".
     *
     * `numericLeaves` walks numbers; a source title is text, so "«100 kg»"
     * inside one is invisible to REF-02 both before and after T604. Widening
     * the scan to source titles would be worse than useless: run against the
     * ten shipped wave-1 entries, a figure detector fires on five titles and
     * every one is a document quoting its own subject ("3.8L V6",
     * "Air Locker RD110 … 3000cc"). The fix is a typed path the figure can
     * move *to*, which is what the graders below are about.
     */
    expect(
      modCitationFields({
        confidence: "first-hand",
        sources: [
          {
            ...makeSource("vendor"),
            title: "TEST listing — roof load «100 kg»",
          },
        ],
      })
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * 3. The guarantee is not vacuous — a mod's figure lands somewhere REF-02 walks
 * ---------------------------------------------------------------------- */

describe("a figure a mod states carries a source (REF-02, T603)", () => {
  it("names the figure in an uncited `reference` entry", () => {
    // Green today, and the half that makes "by id" worth anything: the entry
    // the id points at is itself inside REF-02, so moving a figure out of a
    // citation's title and into a `reference` row does not launder it.
    expect(
      citationFields(
        makeSpecReference(ROOF_LOAD_SPEC, { cited: false }),
        "reference",
        "src/content/reference/test-ref-mod-roof-load.json"
      )
    ).toContain("dimension.value");
  });

  it("is clean when that reference entry cites its source", () => {
    expect(
      citationFields(
        makeSpecReference(ROOF_LOAD_SPEC),
        "reference",
        "src/content/reference/test-ref-mod-roof-load.json"
      )
    ).toEqual([]);
  });

  it("adds no second copy of the number to the mod itself", () => {
    /*
     * The end-state assertion, and the one that tells a by-id field from a
     * typed-number field: after citing a 100 kg roof load and a 100 N·m
     * torque, the *only* figure `check:citations` finds on the mod is the one
     * the mod actually owns (`difficulty`). An id contributes no numeric leaf,
     * so the number exists once, in the entry that cites it.
     *
     * A hybrid `{ id, value, unit }` shape would report `specs[0].value` here
     * and turn this red — which is the correct outcome, not a false alarm.
     */
    const fields = modCitationFields({
      sources: [],
      specs: [TORQUE_SPEC.id, ROOF_LOAD_SPEC.id],
    });

    expect(fields).toEqual(["difficulty"]);
  });
});

/* -------------------------------------------------------------------------
 * 4. Grade item 1, against the corpus that has the problem
 *
 * "Every entry with a numeric claim in `sources[].title` prose has an
 * alternative typed path available" — read as *available*, not *taken*:
 * migrating the ten shipped wave-1 entries is T604's content follow-up, not
 * this grader's subject. What is graded here is that the door exists, on the
 * exact entries that need it.
 * ---------------------------------------------------------------------- */

const MODS_CONTENT = new URL("../../src/content/mods/", import.meta.url);

interface ShippedEntry {
  readonly file: string;
  readonly data: Record<string, unknown>;
}

function shippedMods(): ShippedEntry[] {
  return readdirSync(MODS_CONTENT)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      file: name,
      data: JSON.parse(
        readFileSync(new URL(name, MODS_CONTENT), "utf8")
      ) as Record<string, unknown>,
    }));
}

/**
 * A mass or length figure — the two families `src/lib/procedures/figures.ts`
 * deliberately leaves out (its category is torque and volume) and the two a
 * *mod* states most often: a roof load, a curb weight, a lift height.
 *
 * Used here to **audit** the corpus, never to reject an entry. The
 * false-positive cost that keeps it out of the schema does not apply to a
 * question asked of ten files by a grader.
 */
const MASS_OR_LENGTH =
  /\d[\d.,]*\s*(?:kgs?|lbs?\.?|libras?|tons?|toneladas?|mm|cm|milímetros?|centímetros?|pulgadas?|inches)(?![\p{L}\p{N}])/iu;

/** Whether any of this entry's source titles states a figure. */
function titleFigure(data: Record<string, unknown>): string | null {
  const sources = Array.isArray(data["sources"]) ? data["sources"] : [];
  for (const source of sources) {
    const title = (source as { title?: unknown }).title;
    if (typeof title !== "string") continue;
    const torqueOrVolume = findInlinedFigure(title);
    if (torqueOrVolume !== null) return torqueOrVolume;
    const massOrLength = MASS_OR_LENGTH.exec(title);
    if (massOrLength !== null) return massOrLength[0];
  }
  return null;
}

describe("the shipped wave-1 entries have a typed path available (T603)", () => {
  it("finds entries whose numbers live only in a citation's title", () => {
    /*
     * Anti-vacuity for the grader below, and the reproduction of T602's
     * finding. If this ever reports zero, either the content moved its
     * figures (good — say so and delete both) or the detector drifted (bad),
     * and the marked grader below would be passing over an empty list either
     * way.
     */
    const withFigures = shippedMods().filter(
      (entry) => titleFigure(entry.data) !== null
    );

    expect(
      withFigures.map((entry) => entry.file),
      "no shipped mods entry states a figure in a source title"
    ).not.toEqual([]);
  });

  it("accepts every shipped entry exactly as it stands today", () => {
    // The control that isolates the failure below to the *added* field: if a
    // shipped entry did not parse for some unrelated reason, the marked
    // grader would be red for that reason and look like a missing seam.
    for (const { file, data } of shippedMods()) {
      expect(accepts(data), `${file}: ${issueSummary(data)}`).toBe(true);
    }
  });

  it("accepts each of them with the figure cited by id instead", () => {
    const withFigures = shippedMods().filter(
      (entry) => titleFigure(entry.data) !== null
    );

    for (const { file, data } of withFigures) {
      const migrated = { ...data, specs: [ROOF_LOAD_SPEC.id] };
      expect(accepts(migrated), `${file}: ${issueSummary(migrated)}`).toBe(
        true
      );
    }
  });

  it("does not report `check:citations` problems for them today", () => {
    /*
     * The vacuity, measured. These entries cite sources, so REF-02 is silent
     * about them — and it would be just as silent if the figures in those
     * titles were wrong, because it never sees them. That is the state T603
     * changes the shape of, and recording it here means a later reader can
     * tell that the checker's silence was never evidence of coverage.
     */
    for (const { file, data } of shippedMods()) {
      expect(
        citationFields(data, "mods", `src/content/mods/${file}`),
        file
      ).toEqual([]);
    }
  });
});
