/**
 * The procedures index's DOM wiring (T504b, implementing T504a's seam).
 *
 * ## Why this file exists
 *
 * `tests/pages/procedures-index.render.test.ts` grades the four things T504a's
 * task line names: cards render, hrefs resolve, **filters work**, and T204's
 * provisional-match indicator shows on a partial fitment match. The first two
 * are in the emitted HTML and are graded from the server render alone. The
 * last two are behaviour, and behaviour on this page cannot live in the page
 * template's own `<script>` — Vitest cannot execute it.
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
 * of the same split for this page: `enhanceProceduresIndex` is a **move, not a
 * rewrite** of the template's former `enhance()`, with the two globals taken
 * as parameters instead of read off `globalThis` — the same reason
 * `src/lib/vehicle-selection.ts` takes a `Window` on every function ("so the
 * DOM tests can drive a JSDOM window").
 *
 * Behaviour, unchanged from the template's former inline script:
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
 * `destroy()` promises exactly one thing — unsubscribing from vehicle-
 * selection changes (`onVehicleSelectionChange`'s own returned function) —
 * and nothing wider. It does not detach the pill click listeners; nothing in
 * this page's contract asks it to, and the render test's own note says so.
 *
 * Nothing about fitment is decided here (FIT-01) and nothing about what a pill
 * matches is decided here (`./filter.ts`). This module reads the DOM, asks
 * those two, and writes the DOM back.
 *
 * refs specs/001-foundation (PRC-01, SCF-06, FIT-01, FIT-03, I18N-08)
 */

import {
  EMPTY_PROCEDURES_FILTER,
  matchesProceduresFilter,
  type ProceduresFilterState,
} from "./filter.ts";
import { formatCount } from "../glossary-filter.ts";
import { buildTaxonomy } from "../fitment/index.ts";
import { readSelectorPayload } from "../vehicle-taxonomy.ts";
import { createVehicleListingView } from "../vehicle-listing.ts";
import {
  onVehicleSelectionChange,
  readVehicleSelection,
  type StoredVehicleSelection,
} from "../vehicle-selection.ts";

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
  const toolbar = root.querySelector<HTMLElement>("[data-procedures-toolbar]");
  const count = root.querySelector<HTMLElement>("[data-procedures-count]");
  const none = root.querySelector<HTMLElement>("[data-procedures-none]");
  const cards = [...root.querySelectorAll<HTMLElement>(".procedure-card")];
  if (!toolbar || !count || !none) return null;

  const template = count.dataset["countTemplate"] ?? "";
  const total = Number(count.dataset["total"] ?? cards.length);
  const state: ProceduresFilterState = { ...EMPTY_PROCEDURES_FILTER };

  const payload = readSelectorPayload(win.document);
  // The same nodes the selector shipped, read once. Without a selector on the
  // page there is no taxonomy and no vehicle filter — the pills still work,
  // and `buildTaxonomy([])` gives the generation facet its "no expansion"
  // reading rather than throwing.
  const taxonomy = buildTaxonomy(payload?.nodes ?? []);

  const vehicle = createVehicleListingView({
    root,
    cards,
    taxonomy,
    lang: win.document.documentElement.lang,
  });

  function applyVehicle(selection: StoredVehicleSelection | null): void {
    vehicle?.apply(selection);
  }

  function apply(): void {
    let shown = 0;
    for (const card of cards) {
      const visible = matchesProceduresFilter(
        { system: card.dataset["system"] ?? "" },
        state
      );
      card.hidden = !visible;
      if (visible) shown += 1;
    }
    count!.textContent = formatCount(template, shown, total);
    none!.hidden = shown > 0;
    applyVehicle(readVehicleSelection(win));
  }

  const buttons = [
    ...toolbar.querySelectorAll<HTMLButtonElement>('[data-facet="system"]'),
  ];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const value = button.dataset["value"] ?? "";
      state.system = value;
      for (const sibling of buttons) {
        sibling.setAttribute(
          "aria-pressed",
          String((sibling.dataset["value"] ?? "") === value)
        );
      }
      apply();
    });
  }

  // The selector lives in the site chrome and knows nothing about this page;
  // it announces, and the listing re-filters (FIT-03).
  const unsubscribe = onVehicleSelectionChange(win, (selection) =>
    applyVehicle(selection)
  );

  apply();

  return {
    apply,
    destroy() {
      unsubscribe();
    },
  };
}
