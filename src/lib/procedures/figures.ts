/**
 * "A figure written into a sentence is still an inlined value" (PRC-03), as a
 * pure function.
 *
 * > **PRC-03** IF a procedure cites a torque or fluid spec, THEN THE value
 * > SHALL come from shared reference data by ID, never inlined per-locale.
 *
 * The other three ways to break PRC-03 are caught by shapes:
 * `defineEntrySchema` throws at define time on a numeric prose field, and the
 * strict entry object refuses a figure smuggled into `prose` or re-declared in
 * the procedure's own shared data. This module catches the fourth, which is the
 * one an author actually commits: **"Apriete los pernos a 88 N·m"**. That
 * number now exists once in `en`, once in `es`, and nowhere a build can compare
 * them — so the day the FSM figure is corrected, one language gets the fix. No
 * type-level guard sees it, because it is a string, and `check:citations` does
 * not either, because it walks numeric *leaves* and this is text.
 *
 * ## The rule is a category, not a spelling list
 *
 * *A digit bound to a torque or volume unit*, in any spelling of that unit.
 * `N·m`, `N.m`, `Nm`, `N m`, `lb-ft`, `ft-lb`, `ft lbs`, `ft·lb`, `kgf·m`, `L`,
 * `litros`, `qt`, `ml` are one unit family wearing different punctuation, and a
 * detector written to match the eight strings that occurred to its author is a
 * detector with a bypass per spelling (`.claude/GRADER-PRINCIPLES.md`, "grade
 * behavior, not name lists"). So the units are assembled from *families* —
 * torque as "a force unit joined to a distance unit by any separator or none",
 * volume as the symbols and the words — rather than enumerated.
 *
 * ## What is deliberately outside the category
 *
 * - **Not every number.** "Remove the three bolts", "torque in two stages",
 *   "on 1999 trucks" are counts and dates, not specifications.
 * - **Not a standard's designation.** `SAE 75W-90`, `10W-30`, `API GL-5` are
 *   the fluid's *name*, identical in both languages, and
 *   `reference`'s `fluid.specification` already stores them as shared data.
 *   They carry no unit token, so they are outside the category by construction
 *   rather than by exception.
 * - **Not a displacement used as a component's name** — "the 3.5 L 6G74".
 *   AGENTS.md carves this out in as many words: "count descriptors that are
 *   part of a component's NAME … are naming, not specs". The project's own
 *   truck is described as a 3.5 L 6G74, so this is not hypothetical. See
 *   {@link ENGINE_CODE} for how narrow the carve-out is.
 * - **Millimetres, deliberately, and that is a stated gap.** A socket size, a
 *   drill bit and a valve clearance are all written `14 mm`, and no regex
 *   separates the tool from the specification. The clearance case is closed the
 *   other way instead — `dimension` is a citable `PROCEDURE_SPEC_KINDS` member,
 *   so an author *has* a correct move — and the remaining risk is carried by
 *   review. A detector that flagged every `mm` would flag "use the 14 mm socket
 *   on the drain plug", which is how a real rule gets deleted in frustration.
 *
 * ## Scope: every free sentence but a tool's own name
 *
 * `src/schemas/procedures.ts` applies this to `title`, `summary`, `steps`,
 * `prerequisites` and `safetyNotes`. The first version scanned steps and safety
 * notes only, and `summary` was a **live bypass** (review F2): it renders on the
 * detail page and on every index card, and a summary saying "Torque the drain
 * plug to 39 N·m" shipped the figure twice, once per locale, past every gate in
 * the repository.
 *
 * `tools` prose is deliberately still out. A tool's name legitimately contains
 * its range ("torque wrench, 20–200 N·m"), which is the tool's identity and not
 * a figure this job sets, and flagging it would be the false positive that gets
 * the whole rule deleted. The same reasoning AGENTS.md uses for `24-valve` and
 * `V6`.
 *
 * refs specs/001-foundation (PRC-03; AGENTS.md "Numbers are never translated")
 */

/** A decimal figure in either locale's notation — `88`, `4.5`, `4,5`. */
const NUMBER = String.raw`\d+(?:[.,]\d+)?`;

/**
 * The separators a compound unit is written with: a middle dot, a full stop, a
 * hyphen, a space, or nothing at all. Enumerated as *punctuation* rather than
 * as whole unit spellings, which is what makes `N·m` / `N.m` / `N-m` / `N m` /
 * `Nm` one rule instead of five.
 */
const JOIN = String.raw`\s*[·⋅.\-]?\s*`;

/**
 * The same separator set with the *space* removed — punctuation or nothing.
 *
 * Used only where a bare space would make the rule too eager: `lb…in` and
 * `in…lb`. "Add 5 lbs in the bag" is a mass and an English preposition, not an
 * inch-pound figure, and `5 lb-in` / `5 in-lb` / `5 inlb` are the spellings a
 * chart actually prints. Every other family keeps the space, because `88 N m`
 * and `65 ft lbs` are real.
 */
const TIGHT_JOIN = String.raw`[·⋅.\-]?`;

/**
 * Torque: a force unit joined to a distance unit, in symbols or in words.
 *
 * `n…m` covers `Nm`, `N·m`, `N.m`, `N-m` and `N m`. `kgf?…m` covers the metric
 * spelling factory literature still prints **with or without the `f`** — a
 * Mitsubishi FSM table reads `88 N·m (9.0 kg-m, 65 ft-lb)`, so `kg-m`, `kgm`
 * and `kg·m` are exactly what an author transcribing one will type (review F5).
 * `lb…ft` / `ft…lb` are both orders of the imperial symbol, with the optional
 * `f` (`lbf`) and plural `s` (`ft lbs`); `lb…in` / `in…lb` are the same pair
 * for small fasteners, on {@link TIGHT_JOIN} for the reason recorded there.
 *
 * The spelled-out forms are here for the same reason the punctuation is
 * enumerated rather than the spellings: a rule that recognised `N·m` and not
 * "newton metres" would be a rule with a bypass per vocabulary, and the
 * grader's own docstring says to widen the pattern rather than narrow the rule
 * when a missing spelling turns up. Both English orthographies (`meter`,
 * `metre`), the Spanish (`metro`, `kilográmetro`, `libras-pie`), and both
 * orders of the imperial pair.
 */
const TORQUE_UNIT =
  String.raw`(?:n${JOIN}m` +
  String.raw`|kgf?${JOIN}m` +
  String.raw`|lbf?s?${JOIN}ft` +
  String.raw`|ft${JOIN}lbf?s?` +
  String.raw`|lbf?s?${TIGHT_JOIN}in` +
  String.raw`|in${TIGHT_JOIN}lbf?s?` +
  // "88 newton metres", "9 kilogram-meters", "9 kilogramo metro"
  String.raw`|(?:newton|kilogramo?)s?${JOIN}met(?:er|re|ro)s?` +
  // "9 kilográmetros", "9 newtonmetros" — the closed compound
  String.raw`|(?:newton|kilogr[aá])met(?:er|re|ro)s?` +
  // "65 foot-pounds", "65 pound-feet", "65 libras-pie", "65 pie-libras"
  String.raw`|(?:foot|feet|pie)s?${JOIN}(?:pound|libra)s?` +
  String.raw`|(?:pound|libra)s?${JOIN}(?:foot|feet|pie)s?)`;

/**
 * Volume: the symbols and the words, longest first so `litros` is never
 * matched as a bare `l` with a trailing boundary failure.
 *
 * `mm` is not here and never matches: `ml` requires its `l`, and no other
 * alternative begins with `m`. That is the stated gap above, made structural.
 */
const VOLUME_UNIT =
  String.raw`(?:litros?|litres?|liters?|galones?|gallons?|quarts?` +
  String.raw`|ml|cc|qt|gal|l)`;

/**
 * The trailing boundary. `\b` would be wrong twice over: it is ASCII-only, and
 * it would also *require* a word character before the unit, which `88Nm` does
 * not have. A negative lookahead for a letter or a digit is the property
 * actually wanted — "the unit token ended here" — and it is what stops
 * `1 N mientras` from reading as a torque figure.
 */
const END = String.raw`(?![\p{L}\p{N}])`;

/**
 * A Mitsubishi engine family code, by **shape**: digit, letter, two digits,
 * optional letter — `6G74`, `6G72`, `4M40`, `4D56`, `4G54`. A shape rather than
 * a list, for the reason every rule in this module is a category: a list of the
 * codes that occurred to one author silently stops covering the corpus the
 * moment somebody writes about the 4M41.
 */
const ENGINE_CODE = String.raw`\d[a-z]\d{2}[a-z]?${END}`;

/**
 * A torque figure. **No carve-out**, and that asymmetry is the point.
 *
 * A displacement used as a name is always a *volume*: nobody names an engine
 * after a torque figure. So "Torque the crank bolt to 185 N·m on the 6G74"
 * states a spec and is rejected, while "Install the 3.5 L 6G74 engine cover"
 * names a part and is not. Scoping the carve-out to the volume family removes
 * the hole a sentence-scoped one would leave: the engine code excuses the
 * figure it is attached to, never every figure in its sentence.
 */
const TORQUE_FIGURE = new RegExp(`${NUMBER}\\s*${TORQUE_UNIT}${END}`, "giu");

/**
 * A volume figure that is **not** immediately followed by an engine code.
 *
 * "3.5 L 6G74" is the engine's name; "4.5 L of oil" is a fill quantity, and so
 * is "The 6G74 takes 4.5 L of oil" — the code has to follow the figure it
 * names, because that is the only position in which it is naming it.
 */
const VOLUME_FIGURE = new RegExp(
  `${NUMBER}\\s*${VOLUME_UNIT}${END}(?!\\s+${ENGINE_CODE})`,
  "giu"
);

/**
 * The first figure `text` states with a torque or volume unit, or `null`.
 *
 * Returns the matched substring rather than a boolean so the schema's error can
 * quote the exact words an author has to move into a `reference` entry — SCF-04
 * asks for a message that names the thing, and "this sentence contains a
 * figure" sends someone re-reading a paragraph.
 */
export function findInlinedFigure(text: string): string | null {
  for (const pattern of [TORQUE_FIGURE, VOLUME_FIGURE]) {
    // `g` regexes carry `lastIndex` between calls; resetting is what keeps two
    // calls with the same string from disagreeing.
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match !== null) return match[0];
  }
  return null;
}
