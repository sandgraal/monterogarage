/**
 * Graders — idempotency and one-directionality of `computeSyncPlan` (RM-01,
 * RM-02).
 *
 * > **RM-01** … The sync SHALL be idempotent and one-directional (git → DB,
 * > never back).
 * > **RM-02** THE Supabase read-model SHALL never be written by any process
 * > other than the CI sync job.
 *
 * T802 [PLATFORM] implemented `src/lib/sync/reference-search.ts`'s
 * `computeSyncPlan` and activated every grader below by deleting its
 * `it.fails` marker. The one unmarked seam canary that used to live here
 * (`computeSyncPlan([], [])` throwing `SYNC_SEAM_NOT_IMPLEMENTED`) is gone in
 * the same change — `tests/garage/`'s `harness-contract.test.ts` documents
 * the identical convention for `seam-canary.test.ts`: a canary proving "the
 * real tests fail for the right reason" has nothing left to prove once the
 * function it watches stops throwing.
 *
 * ## What "idempotent" and "one-directional" mean for a pure diff function
 *
 * The sync job itself does the actual writing, and that I/O is not gradable
 * without a live Supabase project — T802's job, proved against a live stack
 * the way `tests/garage/` proves RLS, if a Tier B ever exists for this
 * feature. What a **pure function** taking "what git says" and "what the
 * table currently holds" can be honestly graded for, with no network, is:
 *
 * - **Idempotency**: calling it twice in a row, where the second call's
 *   `dbRows` is exactly the first call's `upserts` (i.e., "the sync already
 *   ran and applied its own plan"), produces an empty plan the second time.
 *   A sync whose second run still emits work has not converged — running it
 *   twice would not leave the database in the state the first run reached.
 * - **One-directionality**: the plan is a pure function of `gitRows` — a
 *   `dbRows` value that disagrees with git on some field is **overwritten,
 *   never merged**, and a `dbRows` row that git does not sanction at all
 *   (never in `gitRows`, by any key) is **deleted, never adopted**. Both are
 *   the same property stated twice: nothing that originates in the database
 *   ever survives into what git asserts should exist. A sync that "merged"
 *   a hand-edited row, or "adopted" a stray manual insert, would be reading
 *   FROM Supabase to decide what the corpus contains — the direction RM-01
 *   forbids — even though every line of its code is still, technically, a
 *   write.
 *
 * refs specs/001-foundation (RM-01, RM-02)
 */
import { describe, expect, it } from "vitest";
import { collectionRoutePath } from "../../src/i18n/routes.ts";
import {
  computeSyncPlan,
  type ReferenceSearchRow,
} from "../../src/lib/sync/reference-search.ts";

/**
 * A minimal, obviously-synthetic row. `TEST-` prefix on every id, in the
 * reserved test namespace `.claude/GRADER-PRINCIPLES.md`'s fixture
 * convention asks for — this can never collide with a real content slug.
 *
 * **`href` follows `locale` and `collection`.** The first version hard-coded
 * `/en/glossary/…` whatever the overrides said, so `row({ locale: "es" })`
 * produced a row claiming to be Spanish while pointing at an English URL —
 * internally inconsistent in exactly the way that hides a locale bug from any
 * grader that ever asserts on `href` (PR #139 review). The prefix and the
 * translated segment both come from `src/i18n/routes.ts`, this repo's single
 * source of truth for them, so an `es` fixture lands on `/es/glosario/…` and
 * a `parts` fixture on `/…/repuestos/…` — not on a prefix swap that would
 * still be wrong for every collection with a translated segment.
 */
function row(
  overrides: Partial<ReferenceSearchRow> & { readonly entryId: string }
): ReferenceSearchRow {
  const collection = overrides.collection ?? "glossary";
  const locale = overrides.locale ?? "en";

  return {
    collection,
    locale,
    href: `/${locale}${collectionRoutePath(collection, locale)}${overrides.entryId.toLowerCase()}/`,
    title: `Test term ${overrides.entryId}`,
    subtitle: null,
    snippet: "A synthetic glossary entry used only by T801's graders.",
    badges: [],
    codes: [],
    extra: [],
    ...overrides,
  };
}

const OIL_FILTER = row({ entryId: "TEST-OIL-FILTER" });
const BRAKE_PADS = row({ entryId: "TEST-BRAKE-PADS", codes: ["MD-TEST-001"] });

/* =========================================================================
 * Idempotency (RM-01)
 * ====================================================================== */

describe("idempotency — a converged sync emits no further work", () => {
  it("an empty corpus against an empty table needs nothing", () => {
    const plan = computeSyncPlan([], []);
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("running the plan's own upserts back through as dbRows converges to a no-op", () => {
    // The literal "run it twice" property: apply the first plan, feed its
    // result back in as the table's new state, and the second computation
    // must find nothing left to do.
    const firstPlan = computeSyncPlan([OIL_FILTER, BRAKE_PADS], []);
    const secondPlan = computeSyncPlan(
      [OIL_FILTER, BRAKE_PADS],
      firstPlan.upserts
    );

    expect(secondPlan.upserts).toEqual([]);
    expect(secondPlan.deletes).toEqual([]);
  });

  it("a row identical to git produces neither an upsert nor a delete", () => {
    const plan = computeSyncPlan([OIL_FILTER], [OIL_FILTER]);
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("re-syncing unchanged content alongside one real edit touches ONLY the edited row", () => {
    // Idempotency is not "diff everything every time" — a sync that
    // re-upserts every row on every run is still technically convergent, but
    // it is not what "the sync SHALL be idempotent" is graded as meaning
    // here: a no-op run costs nothing, and a one-row edit costs one row.
    const editedBrakePads = {
      ...BRAKE_PADS,
      snippet: "Updated snippet text.",
    };
    const plan = computeSyncPlan(
      [OIL_FILTER, editedBrakePads],
      [OIL_FILTER, BRAKE_PADS]
    );

    expect(plan.upserts).toEqual([editedBrakePads]);
    expect(plan.deletes).toEqual([]);
  });
});

/* =========================================================================
 * One-directionality (RM-01, RM-02)
 * ====================================================================== */

describe("one-directionality — git always wins, nothing is merged", () => {
  it("a hand-edited row in the DB is OVERWRITTEN with git's version, not merged", () => {
    // Simulates someone editing the row directly in the Supabase dashboard —
    // RM-02's exact scenario. The title differs from git; the plan must
    // reproduce git's row exactly, not some blend of the two.
    const handEdited = {
      ...OIL_FILTER,
      title: "Someone typed this in Supabase",
    };
    const plan = computeSyncPlan([OIL_FILTER], [handEdited]);

    expect(plan.upserts).toEqual([OIL_FILTER]);
    expect(plan.upserts[0]?.title).not.toBe(handEdited.title);
  });

  it("a row present in the DB but absent from git is DELETED, not adopted", () => {
    // Simulates a stray manual INSERT straight into Supabase, or content
    // that was removed from git. Either way, git is the sole source of
    // truth, and a row it does not assert must not survive a sync.
    const strayInsert = row({ entryId: "TEST-NEVER-IN-GIT" });
    const plan = computeSyncPlan([OIL_FILTER], [OIL_FILTER, strayInsert]);

    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([
      {
        collection: strayInsert.collection,
        entryId: strayInsert.entryId,
        locale: strayInsert.locale,
      },
    ]);
  });

  it("a git entry removed since the last sync is deleted from the table", () => {
    const plan = computeSyncPlan([], [OIL_FILTER]);

    expect(plan.deletes).toEqual([
      {
        collection: OIL_FILTER.collection,
        entryId: OIL_FILTER.entryId,
        locale: OIL_FILTER.locale,
      },
    ]);
  });

  it("the same entry_id in two locales is two independent rows", () => {
    // One-directionality's corollary at the key level: `entry_id` alone is
    // not the key, `(collection, entry_id, locale)` is. Deleting the `es`
    // translation from git must not touch the `en` row that shares the same
    // `collection`/`entry_id`.
    const englishRow = row({ entryId: "TEST-BILINGUAL", locale: "en" });
    const spanishRow = row({ entryId: "TEST-BILINGUAL", locale: "es" });
    const plan = computeSyncPlan([englishRow], [englishRow, spanishRow]);

    expect(plan.deletes).toEqual([
      {
        collection: spanishRow.collection,
        entryId: spanishRow.entryId,
        locale: "es",
      },
    ]);
  });

  it("upserted rows are exactly git's rows — no field is ever taken from the DB copy", () => {
    // A partial-merge implementation (keep the DB's `href`, take git's
    // `title`, say) would pass every test above that only inspects `title`.
    // This asserts field-for-field equality against the WHOLE git row, so a
    // merge anywhere in the object is caught regardless of which field it
    // touches.
    const dbVersion = {
      ...BRAKE_PADS,
      href: "/en/glossary/hand-edited-href/",
      badges: ["a stray badge nobody in git wrote"],
    };
    const plan = computeSyncPlan([BRAKE_PADS], [dbVersion]);

    expect(plan.upserts).toEqual([BRAKE_PADS]);
  });
});

/* =========================================================================
 * The fixtures themselves
 * ====================================================================== */

describe("fixtures are obviously synthetic", () => {
  // Unmarked — describes this file's own row builder, not T802's code.
  it("every entry id lives in the TEST- namespace", () => {
    for (const fixture of [OIL_FILTER, BRAKE_PADS]) {
      expect(fixture.entryId).toMatch(/^TEST-/);
    }
  });

  it("a synthetic part number is also namespaced, not a plausible real OEM number", () => {
    expect(BRAKE_PADS.codes[0]).toMatch(/TEST/);
  });

  it("an EN row's href is an EN URL", () => {
    expect(row({ entryId: "TEST-HREF", locale: "en" }).href).toBe(
      "/en/glossary/test-href/"
    );
  });

  it("an ES row's href is an ES URL, with the translated segment", () => {
    // The defect this closes: `row({ locale: "es" })` used to return
    // `/en/glossary/…`, a Spanish row carrying an English href. A grader that
    // ever asserts on `href` would have been comparing against a fixture that
    // was already wrong.
    expect(row({ entryId: "TEST-HREF", locale: "es" }).href).toBe(
      "/es/glosario/test-href/"
    );
  });

  it("the collection's own translated segment is used, not glossary's", () => {
    expect(
      row({ entryId: "TEST-HREF", collection: "parts", locale: "es" }).href
    ).toBe("/es/repuestos/test-href/");
  });

  it("every fixture's href prefix agrees with its own locale", () => {
    for (const fixture of [
      OIL_FILTER,
      BRAKE_PADS,
      row({ entryId: "TEST-BILINGUAL", locale: "es" }),
    ]) {
      expect(fixture.href, fixture.entryId).toMatch(
        new RegExp(`^/${fixture.locale}/`)
      );
    }
  });

  it("an explicit href override still wins", () => {
    // The one-directionality graders above rely on being able to hand-edit a
    // row's href to simulate a Supabase-side edit; the locale-aware default
    // must not take that away.
    expect(
      row({ entryId: "TEST-HREF", href: "/en/glossary/hand-edited/" }).href
    ).toBe("/en/glossary/hand-edited/");
  });
});
