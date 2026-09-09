import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALES } from "./routing";
import { SITE_NAME, TRUCK_YEAR } from "../site";
import { allUi, t, ui } from "./ui";

// Shared by BOTH the real usted-register grader below and its mutation-proof
// regression test — one binding, not two independently typed copies. `\b`
// is ASCII/`\w`-based, so `/\btú\b/i` never matches: "ú" is not a word
// character to JS's regex engine, so there is no word boundary between "ú"
// and the space or punctuation that follows it — the trailing `\b` fails
// silently on every real occurrence. `tu` (no accent), `vos`, `vosotros`,
// `tuyo`, `tuya`, and `contigo` are all plain ASCII, so `\b` is the right
// tool for them; only the accented pronoun needs a Unicode-aware boundary.
// Same idiom as `src/lib/procedures/figures.ts`'s `END` and
// `tests/shop/provenance.test.ts`'s `TU_PATTERN`: a negative lookaround for
// a letter or digit, which is the property actually wanted ("tú" as its own
// token, not a substring of a longer word).
//
// If this constant regresses back to the inert ASCII-\b-only form, BOTH the
// grader test and the regression test below must go red — not just one of
// them, and not because someone remembered to keep a second copy in sync.
const FORBIDDEN_ASCII_REGISTER = /\b(tu|vos|vosotros|tuyo|tuya|contigo)\b/i;
const FORBIDDEN_TU_REGISTER = /(?<![\p{L}\p{N}])tú(?![\p{L}\p{N}])/iu;

/** The single detector both the grader and its regression test consume. */
function hasForbiddenRegister(text: string): boolean {
  return (
    FORBIDDEN_ASCII_REGISTER.test(text) || FORBIDDEN_TU_REGISTER.test(text)
  );
}

describe("UI strings module (I18N-08)", () => {
  it("covers every locale", () => {
    expect(Object.keys(ui).sort()).toEqual([...LOCALES].sort());
  });

  it("has identical key sets in both locales — no string ships in one language", () => {
    const en = Object.keys(ui.en).sort();
    const es = Object.keys(ui.es).sort();
    expect(es).toEqual(en);
  });

  it("has no empty or placeholder values", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(ui[locale])) {
        expect(typeof value, `${locale}.${key}`).toBe("string");
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
        // Case-sensitive and word-bounded on purpose. The original
        // `/^(TODO|TBD|FIXME)/i` rejected any Spanish string starting with
        // "Todo…" — "Todos los sistemas", "Todo el sitio" — which is a
        // false positive on ordinary copy, not a placeholder. A placeholder
        // marker is written in caps and stands alone as a word.
        expect(value, `${locale}.${key}`).not.toMatch(/^(TODO|TBD|FIXME)\b/);
      }
    }
  });

  it("uses the usted register in ES, never tú or vos (AGENTS.md)", () => {
    for (const [key, value] of Object.entries(ui.es)) {
      expect(hasForbiddenRegister(value), `es.${key}`).toBe(false);
    }
  });

  it("mutation-proves the tú boundary fix — reverting FORBIDDEN_TU_REGISTER to the old ASCII \\b form must turn this red", () => {
    // Not a test of `ui.es` (already clean) — a test of the *detector
    // itself*, per .claude/GRADER-PRINCIPLES.md ("mutation-test the probe
    // corpus"): a rule that cannot be observed to fail on a violation it is
    // supposed to catch is decorative. Fixtures are synthetic sentences,
    // never real UI copy.
    //
    // Critically, these run through `hasForbiddenRegister` — the exact
    // function the grader test above calls, backed by the exact module-level
    // `FORBIDDEN_ASCII_REGISTER` / `FORBIDDEN_TU_REGISTER` constants it uses
    // — not a second, independently retyped copy of the regexes. Retyping
    // the same literal twice only proves the two copies agree with each
    // other; it proves nothing about whether the real grader's pattern still
    // catches a violation. Reverting `FORBIDDEN_TU_REGISTER` above to the
    // old, inert `/\bt[úu]\b/i` must make the two "tú" assertions below fail,
    // because there is only one binding for both this test and the grader to
    // read.
    const informalTu = "tú tenés el vehículo";
    const informalTuCapitalized = "Tú debés revisar el nivel de aceite.";
    const informalVos = "vos tenés el vehículo";
    const usted = "Usted debe revisar el nivel de aceite antes de conducir.";

    expect(hasForbiddenRegister(informalTu)).toBe(true);
    expect(hasForbiddenRegister(informalTuCapitalized)).toBe(true);

    // `vos` was never broken — plain ASCII, so `\b` already worked; confirm
    // the shared detector still catches it so the fix didn't disturb it.
    expect(hasForbiddenRegister(informalVos)).toBe(true);

    // Positive control: a genuinely `usted`-register sentence trips the
    // shared detector on neither arm — the fix must not turn into a
    // false-positive machine.
    expect(hasForbiddenRegister(usted)).toBe(false);
  });

  it("translates every string — nothing is copied through untranslated", () => {
    // Locale-independent values (the site name, URLs, figures) live in
    // src/site.ts, so no key here may be byte-identical across locales.
    const shared = Object.keys(ui.en).filter(
      (key) =>
        ui.en[key as keyof typeof ui.en] === ui.es[key as keyof typeof ui.es]
    );
    expect(shared).toEqual([]);
  });

  it("stores no figure per locale — numbers are interpolated, not retyped", () => {
    // AGENTS.md: "if you find yourself writing the same figure twice, the
    // schema is wrong". The truck's model year comes from src/site.ts.
    expect(ui.en.homeIntro).toContain(String(TRUCK_YEAR));
    expect(ui.es.homeIntro).toContain(String(TRUCK_YEAR));

    const source = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    expect(source).not.toContain(String(TRUCK_YEAR));
  });

  it("keeps the site name out of the per-locale records", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(ui[locale])).not.toContain("siteName");
      expect(Object.values(ui[locale])).not.toContain(SITE_NAME);
    }
  });

  it("t() returns the strings for the requested locale", () => {
    expect(t("en").navHome).toBe(ui.en.navHome);
    expect(t("es").navHome).toBe(ui.es.navHome);
  });

  it("allUi exposes every locale in a stable order for non-localized pages", () => {
    expect(allUi.map((entry) => entry.locale)).toEqual([...LOCALES]);
  });
});
