/**
 * Graders — the safety-critical flag on a procedure (PRC-02, schema half).
 *
 * > **PRC-02** WHEN a procedure touches a safety-critical system, THE entry
 * > SHALL carry the `safety-critical` flag and render per PRB-03's notice
 * > rules.
 *
 * Two halves, and this file is the first: *the entry carries the flag*. The
 * second — *and renders per PRB-03's notice rules* — is
 * `tests/pages/procedure-page.render.test.ts`, which renders the real page the
 * way T401's `tests/problem-bilingual-bands.test.ts` renders the real problem
 * page, and for the reason recorded there: a schema grader cannot see a
 * template that forgot to draw the band.
 *
 * ## The rule, restated exactly as `parts` and `reference` already state it
 *
 * `src/lib/safety.ts` is the single answer to "does this entry render the
 * standing bilingual safety notice", and it answers from `system` plus an
 * **upward-only** `safetyCritical` flag. Both collections that landed before
 * this one refuse the one incoherent value — `safetyCritical: false` on a
 * system that is already on `SAFETY_CRITICAL_SYSTEMS` — and PRC-02 gives
 * procedures no licence to differ. A brake job is a brake job whether it is
 * filed as a part, a torque figure or a procedure.
 *
 * The subject-derived half (`requiresSafetyFlagFromSubject`) is the T207 audit
 * finding F3, and it matters *more* for procedures than for anything else on
 * the site: "jack the truck up" is an instruction, not a reference row, and
 * jacking/lifting points are one of AGENTS.md's safety-critical categories
 * with no `GLOSSARY_SYSTEMS` id of their own.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker; T502 activates a grader by deleting exactly that
 * `.fails`. `tests/schemas/procedures-seam-contract.test.ts` is the canary,
 * and it proves `isSafetyCritical` and `requiresSafetyFlagFromSubject` already
 * behave the way these graders assume — so an expected failure here is about
 * the procedures schema and never about the safety module.
 *
 * refs specs/001-foundation (PRC-02, PRB-03; AGENTS.md "Safety and legal")
 */
import { describe, expect, it } from "vitest";

import {
  SAFETY_CRITICAL_SYSTEMS,
  isSafetyCritical,
} from "../../src/lib/safety.ts";
import { GLOSSARY_SYSTEMS } from "../../src/schemas/glossary.ts";
import { checkProcedureEntry } from "../../src/schemas/procedures.ts";
import {
  accepts,
  issuesUnder,
  parsedProcedureData,
  procedureIssuePaths,
} from "../helpers/procedures.ts";
import {
  DEFAULT_SAFETY_NOTES,
  makeProcedure,
} from "../fixtures/procedure-fixtures.ts";

/** Systems `src/lib/safety.ts` does *not* already promote. */
const ORDINARY_SYSTEMS = GLOSSARY_SYSTEMS.filter(
  (system) => !(SAFETY_CRITICAL_SYSTEMS as readonly string[]).includes(system)
);

/** Issues the per-entry rules alone report — the seam every collection exports. */
function refineIssues(entry: unknown): { path: string; message: string }[] {
  const collected: { path: string; message: string }[] = [];
  checkProcedureEntry(entry, {
    addIssue(issue) {
      collected.push({
        path: issue.path.map(String).join("."),
        message: issue.message,
      });
    },
  });
  return collected;
}

/* -------------------------------------------------------------------------
 * The flag only ever promotes
 * ---------------------------------------------------------------------- */

describe("`safetyCritical: false` cannot demote a safety-critical system (PRC-02)", () => {
  it.each(SAFETY_CRITICAL_SYSTEMS)(
    "rejects `safetyCritical: false` on `%s`",
    (system) => {
      const entry = makeProcedure({ system, safetyCritical: false });

      // Reported against the field the author has to change, and about
      // nothing else — one mistake, one error.
      expect(issuesUnder(entry, "safetyCritical").length).toBeGreaterThan(0);
      expect(
        procedureIssuePaths(entry).filter((path) => path !== "safetyCritical")
      ).toEqual([]);
    }
  );

  it.each(SAFETY_CRITICAL_SYSTEMS)(
    "says which system made `%s` safety-critical, so the message is actionable",
    (system) => {
      const [issue] = refineIssues(
        makeProcedure({ system, safetyCritical: false })
      );

      // Not `toContain("safety")`, which any sentence about safety satisfies:
      // the message has to name the system the author wrote (T501 review, F-A,
      // the substring trap).
      expect(issue?.message).toContain(system);
    }
  );

  it.each(ORDINARY_SYSTEMS)(
    "accepts `safetyCritical: false` on `%s`, which is not on the list",
    (system) => {
      expect(
        procedureIssuePaths(makeProcedure({ system, safetyCritical: false }))
      ).toEqual([]);
    }
  );

  it.each(ORDINARY_SYSTEMS)(
    "accepts `safetyCritical: true` on `%s` — the flag is a promotion",
    (system) => {
      expect(
        procedureIssuePaths(makeProcedure({ system, safetyCritical: true }))
      ).toEqual([]);
    }
  );

  it.each(SAFETY_CRITICAL_SYSTEMS)(
    "accepts `%s` with no flag at all — the system already says it",
    (system) => {
      // The default matters: AGENTS.md's list is a list of *systems*, so
      // making the notice depend on an author remembering to write the flag is
      // the one thing a safety default must not do (`src/lib/safety.ts`).
      expect(procedureIssuePaths(makeProcedure({ system }))).toEqual([]);
    }
  );
});

/* -------------------------------------------------------------------------
 * A parsed entry is what `src/lib/safety.ts` reads
 *
 * The connective tissue between the schema and PRC-02's rendering half: the
 * page asks `isSafetyCritical(entry.data)`, so the parsed entry has to carry
 * `system` and `safetyCritical` in the shape that function reads. A schema
 * that renamed either — `safetySystem`, `criticalSafety` — would satisfy every
 * field grader above and silently turn the notice off site-wide.
 * ---------------------------------------------------------------------- */

describe("a parsed procedure answers `isSafetyCritical` (PRC-02)", () => {
  it.each(SAFETY_CRITICAL_SYSTEMS)(
    "a `%s` procedure is safety-critical to src/lib/safety.ts",
    (system) => {
      expect(
        isSafetyCritical(parsedProcedureData(makeProcedure({ system })))
      ).toBe(true);
    }
  );

  it("an `engine` procedure is not, unless it says so", () => {
    expect(isSafetyCritical(parsedProcedureData(makeProcedure()))).toBe(false);
    expect(
      isSafetyCritical(
        parsedProcedureData(makeProcedure({ safetyCritical: true }))
      )
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * The subject-derived promotion (T207 audit, F3)
 *
 * AGENTS.md's safety-critical list includes "towing, jacking and lifting
 * points", and `GLOSSARY_SYSTEMS` has no id for either — widening that
 * vocabulary is a taxonomy change, which AGENTS.md puts behind a stop-and-ask.
 * So `src/lib/safety.ts` reads the entry's *subject* instead, bilingually, and
 * `src/schemas/reference.ts` requires the manual flag when it fires. A
 * procedure is the entry type where this matters most: "raise the truck" is an
 * instruction someone follows.
 * ---------------------------------------------------------------------- */

describe("a jacking or towing procedure carries the flag (PRC-02, T207 F3)", () => {
  const jackingTitles = {
    en: "Jacking points",
    es: "Puntos de apoyo",
  } as const;
  const towingTitles = {
    en: "Towing the truck",
    es: "Remolcar el carro",
  } as const;

  it.each<[string, Record<"en" | "es", string>]>([
    ["jacking", jackingTitles],
    ["towing", towingTitles],
  ])(
    "requires `safetyCritical: true` on a %s procedure filed under an ordinary system",
    (_label, titles) => {
      const entry = makeProcedure({ system: "engine", titles });

      expect(issuesUnder(entry, "safetyCritical").length).toBeGreaterThan(0);
    }
  );

  it.each<[string, Record<"en" | "es", string>]>([
    ["jacking", jackingTitles],
    ["towing", towingTitles],
  ])(
    "accepts the same %s procedure once it carries the flag",
    (_label, titles) => {
      expect(
        procedureIssuePaths(
          makeProcedure({ system: "engine", titles, safetyCritical: true })
        )
      ).toEqual([]);
    }
  );

  it("does not demand the flag when the system already covers it", () => {
    // Reporting here would be a second complaint about a page that already
    // renders the notice — one mistake, one error, and this is not even a
    // mistake.
    expect(
      procedureIssuePaths(
        makeProcedure({ system: "suspension", titles: jackingTitles })
      )
    ).toEqual([]);
  });

  it("leaves an ordinary job alone", () => {
    // The positive control for the detector's *narrowness*. A rule that
    // flagged every procedure would satisfy both requirements above and make
    // the flag meaningless.
    expect(accepts(makeProcedure())).toBe(true);
    expect(
      accepts(
        makeProcedure({
          system: "engine",
          titles: { en: "Valve lifter check", es: "Revisión de levas" },
        })
      )
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * Safety notes — PRC-01's ninth field, required once PRC-02 fires
 *
 * ## The derivation, stated so a reviewer can argue with exactly this
 *
 * PRC-01 lists "safety notes" as a field the collection holds; PRC-02 says a
 * procedure touching a safety-critical system carries the flag and renders the
 * standing notice. Neither sentence, alone, says the *entry-specific* note is
 * mandatory. Read together they do the work: the standing notice is one
 * sentence the whole site shares ("see a qualified mechanic"), and it is the
 * same sentence on a brake-bleed and on a fuel-line replacement. If a
 * safety-critical procedure may ship with no note of its own, then PRC-01's
 * "safety notes" is a field that never has to be filled in on precisely the
 * entries it exists for.
 *
 * So: **safety-critical ⇒ `safetyNotes` in both locales.** Not safety-critical
 * ⇒ optional, because a note on an air-filter change is noise, and a notice
 * nobody needs is a notice nobody reads (the reasoning `src/lib/safety.ts`
 * records for keeping `engine` off the list).
 * ---------------------------------------------------------------------- */

describe("a safety-critical procedure writes its own safety notes (PRC-01, PRC-02)", () => {
  const NOTES = DEFAULT_SAFETY_NOTES;

  it.each(SAFETY_CRITICAL_SYSTEMS)(
    "rejects a `%s` procedure with no safety notes",
    (system) => {
      const entry = makeProcedure({ system, omitSafetyNotes: true });
      const reported = [
        ...issuesUnder(entry, "prose.en.safetyNotes"),
        ...issuesUnder(entry, "prose.es.safetyNotes"),
      ];

      expect(reported.length).toBeGreaterThan(0);
    }
  );

  it.each(["en", "es"])(
    "reports the locale whose safety note is missing, and only that one",
    (locale) => {
      const other = locale === "en" ? "es" : "en";
      const entry = makeProcedure({
        system: "brakes",
        safetyNotes: { [other]: NOTES[other as "en" | "es"] },
      });

      expect(
        issuesUnder(entry, `prose.${locale}.safetyNotes`).length
      ).toBeGreaterThan(0);
      expect(issuesUnder(entry, `prose.${other}.safetyNotes`)).toEqual([]);
    }
  );

  it("accepts a safety-critical procedure whose notes are bilingual", () => {
    expect(
      procedureIssuePaths(
        makeProcedure({ system: "brakes", safetyNotes: NOTES })
      )
    ).toEqual([]);
  });

  it("accepts a promoted procedure whose notes are bilingual", () => {
    expect(
      procedureIssuePaths(
        makeProcedure({
          system: "engine",
          safetyCritical: true,
          safetyNotes: NOTES,
        })
      )
    ).toEqual([]);
  });

  it("lets an ordinary procedure omit them", () => {
    expect(
      procedureIssuePaths(makeProcedure({ omitSafetyNotes: true }))
    ).toEqual([]);
  });

  it("lets an ordinary procedure carry them anyway", () => {
    expect(procedureIssuePaths(makeProcedure({ safetyNotes: NOTES }))).toEqual(
      []
    );
  });
});
