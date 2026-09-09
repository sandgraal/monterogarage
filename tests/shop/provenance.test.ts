/**
 * Graders — **provenance rendering, PRO-05**, part of **T3-301 [TEST]**,
 * activated by **T3-303 [PLATFORM]** (which has no paired [TEST] task of its
 * own, so PRO-05 is graded here).
 *
 * PRO-05: an accepted record "SHALL render as the owner's own testimony per
 * AGENTS.md, with its provenance visible — never as a site-verified fact, and
 * never fact-checked by the site." AGENTS.md Facts says the same: a record
 * created by accepting a mechanic's proposal carries its provenance, remains
 * the owner's own record, and is never presented as a site-verified reference
 * fact. "A second author does not make it a second kind of fact."
 *
 * The load-bearing, non-over-specified half of that requirement is the
 * **negative**: whatever wording T3-303 chooses, the label must NOT tell the
 * reader the SITE vouches for the record. That is graded as a category of
 * forbidden phrases in both locales (the "grade behaviour, not name lists"
 * principle), with a mutation control proving the check bites. The positive
 * half — the label names the proposer and the acceptance, in both locales, in
 * the `usted` register — is graded too, but loosely (it must contain the
 * proposer and the date it is handed), because the exact phrasing is T3-303's.
 *
 * The render property is graded as a **pure module** (`src/lib/proposals/
 * provenance.ts`), the same extraction `src/lib/directory/*.ts` and
 * `src/lib/community-filter.ts` used to make a render rule testable. It is
 * loaded by variable-path dynamic import so `astro check` does not fail on a
 * module T3-303 has not written — it fails, catchably, with the named
 * `provenanceSeam`, and each grader is `it.fails` until T3-303 ships it.
 *
 * refs specs/003-shop-tools (PRO-05), AGENTS.md (Facts — testimony)
 */
import { describe, expect, it } from "vitest";
import {
  PROVENANCE_LABEL_EXPORT,
  PROVENANCE_MODULE,
  PROVENANCE_SITE_VERIFICATION_PHRASES,
  provenanceSeam,
} from "./contract.ts";

/** The shape a grader hands the label function (renegotiable per contract). */
interface ProvenanceInput {
  readonly proposerName: string;
  readonly acceptedOn: string;
  readonly shareId?: string;
}
type ProposalProvenanceLabel = (
  input: ProvenanceInput,
  locale: "en" | "es"
) => string;

/** A synthetic accepted-proposal provenance — obviously test data (TEST-…). */
const SAMPLE: ProvenanceInput = {
  proposerName: "TEST-MECHANIC-Alonso",
  acceptedOn: "2026-09-08",
  shareId: "TEST-SHARE-0001",
};

const LOCALES = ["en", "es"] as const;

/**
 * Unicode-aware `tú` boundary — mirrors `src/lib/procedures/figures.ts`'s
 * `END` and the tokenizer in `scripts/check-es-register.mjs`. `/\btú\b/`
 * would be wrong, not just imprecise: JS's `\b` is ASCII/`\w`-based and `ú`
 * is not a word character, so there is **no** word boundary immediately
 * after "tú" — `/\btú\b/.test("tú tenés el vehículo")` is always `false`,
 * silently. A negative lookaround for a letter or digit on both sides is
 * the property actually wanted ("tú" as its own token, not a substring).
 */
const TU_PATTERN = /(?<![\p{L}\p{N}])tú(?![\p{L}\p{N}])/u;
/** `vos` is plain ASCII on every character, so `\bvos\b` is not the same bug. */
const VOS_PATTERN = /\bvos\b/;

/**
 * The informal-register predicate the usted-register grader below applies —
 * pulled out so the "mutation-test the corpus" suite exercises the exact
 * same check on synthetic strings instead of a second, possibly-diverging
 * copy of it.
 */
function usesInformalRegister(es: string): { tu: boolean; vos: boolean } {
  const lower = es.toLowerCase();
  return { tu: TU_PATTERN.test(lower), vos: VOS_PATTERN.test(lower) };
}

/**
 * Load the label function from the T3-303 module by variable-path dynamic
 * import — a literal specifier would make `tsc`/`astro check` fail with ts(2307)
 * while T3-303 has not written it (an error, not the expected failure the
 * marker convention needs). The `@vite-ignore` keeps Vite from resolving it at
 * transform time; it resolves at runtime, or rejects catchably. Mirrors
 * `directory.test.ts`'s `loadExport`.
 */
async function loadLabel(): Promise<ProposalProvenanceLabel> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ PROVENANCE_MODULE)) as Record<
      string,
      unknown
    >;
  } catch {
    throw provenanceSeam(
      `${PROVENANCE_MODULE} (${PROVENANCE_LABEL_EXPORT}) is not implemented`
    );
  }
  const fn = mod[PROVENANCE_LABEL_EXPORT];
  if (typeof fn !== "function") {
    throw provenanceSeam(
      `${PROVENANCE_MODULE} does not export ${PROVENANCE_LABEL_EXPORT}`
    );
  }
  return fn as ProposalProvenanceLabel;
}

describe("an accepted record's provenance renders, bilingually (PRO-05)", () => {
  it.fails.each(LOCALES)(
    "the %s label names the proposer and the acceptance",
    async (locale) => {
      const label = await loadLabel();
      const out = label(SAMPLE, locale);
      expect(typeof out, "label is not a string").toBe("string");
      expect(out.trim().length, "label is empty").toBeGreaterThan(0);
      expect(out, "label omits the proposer").toContain(SAMPLE.proposerName);
      expect(out, "label omits when it was accepted").toContain(
        SAMPLE.acceptedOn
      );
    }
  );
});

describe("provenance is a first-hand claim, never a site-verified fact (PRO-05)", () => {
  it.fails.each(LOCALES)(
    "the %s label makes no site-verification claim",
    async (locale) => {
      // The load-bearing PRO-05 negative: the site never vouches for a user
      // record. Whatever T3-303's wording, none of the "the site verified this"
      // phrasings may appear, in either locale.
      const label = await loadLabel();
      const out = label(SAMPLE, locale).toLowerCase();
      for (const phrase of PROVENANCE_SITE_VERIFICATION_PHRASES[locale]) {
        expect(
          out.includes(phrase),
          `${locale} label claims site verification: "${phrase}"`
        ).toBe(false);
      }
    }
  );

  it.fails(
    "the ES label addresses the reader in the usted register",
    async () => {
      // Kept separate from the bilingual sweep above so its marker names exactly
      // what it waits for. `usted` register: no `tú`, no `vos`.
      const label = await loadLabel();
      const es = label(SAMPLE, "es");
      const { tu, vos } = usesInformalRegister(es);
      expect(tu, "ES label uses tú").toBe(false);
      expect(vos, "ES label uses vos").toBe(false);
    }
  );
});

describe("the PRO-05 negative can actually fail (mutation-test the corpus)", () => {
  it("a tempted 'verified by the site' label trips the forbidden-phrase check", () => {
    // Proof the phrase list is not decorative. A label that DID claim site
    // verification — the over-claim PRO-05 forbids — must be caught by the same
    // predicate the graders above apply, in each locale, on synthetic strings.
    const temptedEn =
      "Proposed by TEST-MECHANIC-Alonso, accepted 2026-09-08 — verified by the site.";
    const temptedEs =
      "Propuesto por TEST-MECHANIC-Alonso, aceptado el 2026-09-08 — verificado por el sitio.";
    const tripsFor = (out: string, locale: "en" | "es"): boolean =>
      PROVENANCE_SITE_VERIFICATION_PHRASES[locale].some((phrase) =>
        out.toLowerCase().includes(phrase)
      );
    expect(tripsFor(temptedEn, "en")).toBe(true);
    expect(tripsFor(temptedEs, "es")).toBe(true);

    // … and a clean, testimony-framed label does NOT trip it — so the check
    // flags the over-claim, not any provenance line at all.
    const cleanEn =
      "Proposed by TEST-MECHANIC-Alonso; accepted by the owner on 2026-09-08.";
    const cleanEs =
      "Propuesto por TEST-MECHANIC-Alonso; el propietario lo aceptó el 2026-09-08.";
    expect(tripsFor(cleanEn, "en")).toBe(false);
    expect(tripsFor(cleanEs, "es")).toBe(false);
  });

  it("the usted-register check actually catches tú and vos, not just their absence", () => {
    // Proof the Unicode-aware `tú` boundary bites. This is the exact defect
    // this test was fixed for: `/\btú\b/.test("tú tenés…")` is always `false`
    // because JS's `\b` never matches immediately after a non-ASCII letter
    // like `ú` — so the old check was inert and would have waved through a
    // Spanish label that wrongly used `tú`.
    expect(
      usesInformalRegister("Tú aceptaste el trabajo el 2026-09-08.").tu,
      "a tú-register label must be caught"
    ).toBe(true);
    expect(
      usesInformalRegister("Vos aceptaste el trabajo el 2026-09-08.").vos,
      "a vos-register label must be caught"
    ).toBe(true);

    // … and a genuine usted-register label trips neither half.
    const cleanUsted =
      "Propuesto por TEST-MECHANIC-Alonso; el propietario lo aceptó el 2026-09-08.";
    const { tu, vos } = usesInformalRegister(cleanUsted);
    expect(tu, "a clean usted-register label must not trip the tú check").toBe(
      false
    );
    expect(
      vos,
      "a clean usted-register label must not trip the vos check"
    ).toBe(false);
  });
});
