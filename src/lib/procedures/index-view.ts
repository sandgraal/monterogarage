/**
 * The procedures index's DOM wiring — **a stub owed to T504 (T504a's seam).**
 *
 * ## Why this file exists before it does anything
 *
 * `tests/pages/procedures-index.render.test.ts` grades the four things T504a's
 * task line names: cards render, hrefs resolve, **filters work**, and T204's
 * provisional-match indicator shows on a partial fitment match. The first two
 * are in the emitted HTML and are graded today. The last two are behaviour,
 * and behaviour on this page currently lives in the page template's own
 * `<script>` — which Vitest cannot execute.
 *
 * That is a measured fact, not a guess. Astro compiles a page's `<script>`
 * into a client module (`…astro?astro&type=script&index=0&lang.ts`); imported
 * under Vitest's SSR transform it resolves to an **empty** module
 * (`Object.keys(mod).length === 0`), so every click in a JSDOM copy of the
 * page does nothing while the document and the roots are provably correct.
 *
 * The repo already solves this shape of problem three times, and each time the
 * same way — pull the wiring out of the template so a jsdom test can drive it:
 * `rememberLocaleFromClick` (I18N-03's persistence), `matchesProceduresFilter`
 * (this page's own pill rule, split out by T502 for exactly this reason), and
 * `createVehicleListingView` (FIT-03's painter). This module is the last piece
 * of the same split for this page.
 *
 * ## What the implementer owes
 *
 * A **move, not a rewrite**. `enhanceProceduresIndex` is the body of the
 * template's existing `enhance()`, with the two globals taken as parameters
 * instead of read off `globalThis` — the same reason `src/lib/vehicle-selection.ts`
 * takes a `Window` on every function ("so the DOM tests can drive a JSDOM
 * window"). Behaviour must not change:
 *
 *   · `null` for a root with no toolbar, count or no-results line — the empty
 *     state, which is how SCF-06 audits this page and how it shipped before
 *     T504's entries landed. No listeners, no summary, no dead controls.
 *   · otherwise: bind the system pills (exactly one `aria-pressed="true"` at a
 *     time), keep `[data-procedures-count]` and `[data-procedures-none]` in
 *     step with what is visible, build the vehicle view through
 *     `createVehicleListingView`, subscribe with `onVehicleSelectionChange`,
 *     and run once on mount.
 *
 * and the page `<script>` becomes the call:
 *
 *     import { enhanceProceduresIndex } from "../../lib/procedures/index-view";
 *     for (const root of document.querySelectorAll<HTMLElement>(
 *       "[data-procedures]"
 *     )) {
 *       enhanceProceduresIndex(root, window);
 *     }
 *
 * Nothing about fitment is decided here (FIT-01) and nothing about what a pill
 * matches is decided here (`./filter.ts`). This module reads the DOM, asks
 * those two, and writes the DOM back.
 *
 * ## The alternative, stated so it can be argued rather than assumed
 *
 * The only other way to grade "filters work" and "the indicator shows" is a
 * browser: a `tests/e2e/` Playwright spec against a built `dist/`. That is a
 * legitimate choice and it needs no seam — but it is a different artefact from
 * the one T504a's task line names (`procedures-index.render.test.ts`), it adds
 * a browser to the path of a merge gate that is deliberately browser-free, and
 * it would leave the wiring on this page the only listing wiring in the repo
 * with no unit-level grader. If a reviewer prefers that trade, the graders
 * marked `it.fails` in the render test are the ones to move.
 *
 * refs specs/001-foundation (PRC-01, SCF-06, FIT-01, FIT-03, I18N-08)
 */

/** One index page's live filter, once it has been wired to a document. */
export interface ProceduresIndexView {
  /** Re-run the pill filter and repaint the vehicle markers. */
  apply(): void;
  /** Unsubscribe from vehicle-selection changes. */
  destroy(): void;
}

/**
 * Wire one `[data-procedures]` root, or `null` when there is nothing to wire.
 *
 * @param root the listing section — `[data-procedures]`
 * @param win the window that owns it; taken rather than read off the global so
 *   a JSDOM window can be driven directly, the rule
 *   `src/lib/vehicle-selection.ts` already follows
 */
export function enhanceProceduresIndex(
  root: HTMLElement,
  win: Window
): ProceduresIndexView | null {
  void root;
  void win;
  throw new Error(
    "not implemented: T504a — `enhanceProceduresIndex` is the seam the " +
      "procedures index's client wiring must move behind so it can be " +
      "graded without a browser. Move the body of the `<script>` in " +
      "src/pages/[locale]/[proceduresSegment].astro here, have that script " +
      "call this, then delete the `.fails` from each activated grader in " +
      "tests/pages/procedures-index.render.test.ts. " +
      "refs specs/001-foundation (PRC-01, SCF-06)"
  );
}
