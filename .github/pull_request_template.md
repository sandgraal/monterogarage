## What / Qué

<!-- One or two sentences. EN or ES. -->

Task: T### · Spec tags: <!-- e.g. PRB-01, GLO-02 -->

## Content checklist / Lista para contenido (delete if platform-only PR)

Required for any PR that adds or edits an entry. / Obligatorio para todo PR
que agregue o modifique una entrada.

- [ ] Every entry has both `prose.en` and `prose.es` / Cada entrada tiene
      `prose.en` y `prose.es`
- [ ] Every numeric spec lives in shared `data`, not prose, and carries a
      source / Toda especificación numérica vive en `data` compartido, con fuente
- [ ] No invented part numbers — every number traces to an opened source /
      Ningún número de parte inventado — cada número viene de una fuente abierta
- [ ] **Fitment** declared and resolvable for every entry / **Aplicación**
      (fitment) declarada y resoluble en cada entrada
- [ ] Confidence tier honest; sources archived (`archiveUrl`) / Nivel de
      confianza honesto; fuentes archivadas (`archiveUrl`)
- [ ] ES prose: `usted` register, canonical glossary terms / Prosa en español:
      registro de `usted`, términos canónicos del glosario

## Proof

<!-- Commands run + one-line results (npm run verify, etc.) -->

<!--
CI gates this PR on: Harness validation · Verify. Link checking, a11y (Pa11y
WCAG2AA), the SCF-06 Lighthouse budgets, and end-to-end tests run on weekly
scheduled jobs instead, not on this PR. The built site is attached to the
Verify run as the `site-dist` artifact — download it from the run summary to
inspect the pages this branch produces. Merging to `main` deploys to production
on Vercel.
-->

## Passes

<!-- Fact-checked / Bilingual-edited / Code-reviewed: clean or fixed-in-sha -->
