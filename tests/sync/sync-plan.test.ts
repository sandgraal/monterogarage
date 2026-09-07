/**
 * Graders — idempotency and one-directionality of `computeSyncPlan` (RM-01,
 * RM-02).
 *
 * > **RM-01** … The sync SHALL be idempotent and one-directional (git → DB,
 * > never back).
 * > **RM-02** THE Supabase read-model SHALL never be written by any process
 * > other than the CI sync job.
 *
 * `src/lib/sync/reference-search.ts`'s `computeSyncPlan` has no
 * implementation yet — it throws `SYNC_SEAM_NOT_IMPLEMENTED`
 * (`"not implemented: T802"`). Every test below calls it and is `it.fails`;
 * T802 activates one by deleting exactly that marker line.
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
import {
  computeSyncPlan,
  SYNC_SEAM_NOT_IMPLEMENTED,
  type ReferenceSearchRow,
} from "../../src/lib/sync/reference-search.ts";

/**
 * A minimal, obviously-synthetic row. `TEST-` prefix on every id, in the
 * reserved test namespace `.claude/GRADER-PRINCIPLES.md`'s fixture
 * convention asks for — this can never collide with a real content slug.
 */
function row(
  overrides: Partial<ReferenceSearchRow> & { readonly entryId: string }
): ReferenceSearchRow {
  return {
    collection: "glossary",
    locale: "en",
    href: `/en/glossary/${overrides.entryId}/`,
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

describe("computeSyncPlan is honest about not existing yet", () => {
  // Unmarked canary — proves the `.fails` markers below are failing for the
  // seam, not for a typo, the same role `harness-contract.test.ts` plays for
  // `tests/garage/sql.ts`.
  it("throws the T802 seam, naming itself", () => {
    expect(() => computeSyncPlan([], [])).toThrow(SYNC_SEAM_NOT_IMPLEMENTED);
  });
});

/* =========================================================================
 * Idempotency (RM-01)
 * ====================================================================== */

describe("idempotency — a converged sync emits no further work", () => {
  it.fails("an empty corpus against an empty table needs nothing", () => {
    const plan = computeSyncPlan([], []);
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it.fails(
    "running the plan's own upserts back through as dbRows converges to a no-op",
    () => {
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
    }
  );

  it.fails(
    "a row identical to git produces neither an upsert nor a delete",
    () => {
      const plan = computeSyncPlan([OIL_FILTER], [OIL_FILTER]);
      expect(plan.upserts).toEqual([]);
      expect(plan.deletes).toEqual([]);
    }
  );

  it.fails(
    "re-syncing unchanged content alongside one real edit touches ONLY the edited row",
    () => {
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
    }
  );
});

/* =========================================================================
 * One-directionality (RM-01, RM-02)
 * ====================================================================== */

describe("one-directionality — git always wins, nothing is merged", () => {
  it.fails(
    "a hand-edited row in the DB is OVERWRITTEN with git's version, not merged",
    () => {
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
    }
  );

  it.fails(
    "a row present in the DB but absent from git is DELETED, not adopted",
    () => {
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
    }
  );

  it.fails(
    "a git entry removed since the last sync is deleted from the table",
    () => {
      const plan = computeSyncPlan([], [OIL_FILTER]);

      expect(plan.deletes).toEqual([
        {
          collection: OIL_FILTER.collection,
          entryId: OIL_FILTER.entryId,
          locale: OIL_FILTER.locale,
        },
      ]);
    }
  );

  it.fails("the same entry_id in two locales is two independent rows", () => {
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

  it.fails(
    "upserted rows are exactly git's rows — no field is ever taken from the DB copy",
    () => {
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
    }
  );
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
});
