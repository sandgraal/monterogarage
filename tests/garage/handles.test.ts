/**
 * Graders — **SHR-02's public handle.** Declared by T2-401 [TEST], activated by
 * T2-402 [PLATFORM].
 *
 * > **SHR-02** A user SHALL be able to publish, per vehicle: a showcase page
 * > and/or a work-log page, each at a **stable public URL under their handle**.
 *
 * ## Why this file exists, and why T2-201 refused to write it
 *
 * `contract.ts` said so, by name:
 *
 * > **Not graded here, and deliberately: SHR-02's public handle.** … every one
 * > of those properties is a grader of its own — uniqueness under concurrent
 * > signup, case folding, whether `admin` and `api` are takeable, what happens
 * > to a published URL when a handle changes. … half-pinning it would be worse
 * > than leaving it open: T2-202 would build to a contract that stops short of
 * > the hard parts. **It belongs to T2-401 [TEST].** Named here so nobody reads
 * > this file's silence as "handles are unconstrained".
 *
 * This is that file. The four properties, and why each one is a security
 * property rather than a validation nicety:
 *
 * 1. **Uniqueness lives in the database.** Two signups asking "is `gitana`
 *    free?" at the same moment both get "yes", so the answer has to be a unique
 *    index rather than a `select` in the form.
 *
 *    **What the Tier B graders actually prove is the weaker, checkable half**:
 *    a second account cannot take a handle the first already holds, asserted by
 *    writing twice *sequentially*. That is enough to prove the constraint
 *    exists in the schema — a form-only check fails it — and it is **not** a
 *    proof that the constraint holds under genuine concurrency, which would
 *    need two overlapping transactions and is a different test. Stated here so
 *    nobody reads "uniqueness under concurrent signup" off the task line and
 *    assumes it was demonstrated (T2-401 review, F10).
 * 2. **Case folds.** `Gitana` and `gitana` are the same string in the same
 *    position of the same URL to every reader alive. Two accounts differing
 *    only in case is an impersonation kit.
 * 3. **Reserved words are not takeable.** `admin` and `api` are named in the
 *    task brief; the dangerous one is the route segment somebody adds next
 *    year, so the reserved set is graded as a **superset of the segments the
 *    site actually serves**, read out of `src/i18n/routes.ts` at test time.
 *
 *    `RESERVED_HANDLES` is still a hand-written literal — the grader
 *    cross-checks it against the registry rather than deriving it, so adding a
 *    collection turns this file red until somebody reserves the new segment.
 *    That is the intended ergonomics (a reserved word is a decision), but it is
 *    worth stating plainly rather than implying the list computes itself.
 *
 *    **`gitana` is one of those reserved words, and this file used to say the
 *    opposite.** Until 2026-09-05 the POSITIVE CONTROL table below asserted
 *    `handleIssues("gitana") === []` — claimable by any account — while
 *    `contract.ts` had already listed `gitana` under its impersonation
 *    heading. Both cannot hold. The reservation is the half that survives:
 *    MIG-04 makes Gitana Blanca "user page #1 … used to drive the design of
 *    every garage view", and AGENTS.md calls her "the template every other
 *    garage is shaped by" — so on monterogarage.com `/en/garage/gitana/` in a
 *    stranger's hands reads as the site speaking, exactly like the `montero`
 *    and `monterogarage` sitting beside it in that list. `contract.ts`'s own
 *    recorded asymmetry decides it: un-reserving later is safe, reserving
 *    later is not, because somebody already holds it by then.
 *
 *    Reserving the word does not deny the owner the name. `handleIssues` is
 *    the *self-service claim* validator; MIG-04's seeding is a migration.
 *    Those are different mechanisms — and the spec never says the owner's
 *    handle is the literal string `gitana`. The name it actually gives is the
 *    display name **Gitana Blanca**, whose handle form `gitana-blanca` is
 *    unreserved and stays a positive control below.
 *
 *    The contradiction was possible because the two lists were only ever read
 *    by human eyes. They are cross-checked now, in the unmarked block below:
 *    no claimable fixture may be reserved, and every fixture this file rejects
 *    *as* reserved must actually be in `RESERVED_HANDLES`.
 *
 *    **`src/pages/` is deliberately not scanned**, and that is not an
 *    oversight: every route under `src/pages/[locale]/` is a *dynamic* segment
 *    (`[garageSegment].astro`, `[partsSegment].astro`), so the directory
 *    contains no literal path words at all. The literal words live in
 *    `COLLECTION_ROUTE_SEGMENTS` and nowhere else, which is why that is what
 *    gets read. A filesystem sweep here would be a sweep over an empty set —
 *    the vacuity this directory exists to refuse.
 * 4. **A released handle does not immediately become somebody else's.** SHR-02
 *    calls the URL *stable*. If a rename frees the old handle for a stranger,
 *    every link already shared quietly starts pointing at a different person's
 *    garage — a URL that changed its meaning without changing its text. This
 *    is the one property the spec implies rather than states, and it is flagged
 *    as an open question in T2-401's report.
 *
 * ## Expected-failure convention — **activated by T2-402 (2026-09-03)**
 *
 * `it.fails` was the marker; T2-402 activated each grader by deleting exactly
 * that `.fails`. The reserved-list superset check was always **unmarked** — it
 * is a claim about `contract.ts` and `src/i18n/routes.ts`, both of which
 * existed already. The seam control ("every entry point throws the named seam
 * error") went with the seam it controlled: a grader whose assertion is "this
 * is still unimplemented" is one that must fail the moment it is implemented.
 *
 * refs specs/002-montero-garage (SHR-01, SHR-02, SHR-04), 001 (I18N-01, I18N-05)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HANDLE_LENGTH,
  HANDLE_PATTERN,
  RESERVED_HANDLES,
  TEST_TAXONOMY_IDENTITY,
  testHandle,
  testVehicleName,
} from "./contract.ts";
import {
  detectLiveStack,
  insertRow,
  liveTitle,
  provisionScenario,
  stackOf,
  teardownScenario,
  updateRows,
} from "./harness.ts";
import { columnDefinition, createTableBody, migrationSql } from "./sql.ts";
import {
  handleIssues,
  handlePath,
  normalizeHandle,
} from "../../src/lib/garage/handles.ts";

const live = await detectLiveStack();

/**
 * The route registry, resolved against this file rather than assembled from a
 * root string.
 *
 * `new URL(relative, import.meta.url)` does the whole join in one step, so
 * there is no intermediate whose trailing separator the path depends on. The
 * separator was never actually at risk here — URL resolution guarantees it for
 * a directory-ish specifier, and `new URL("../..", …)` yields `/repo/` exactly
 * as `"../../"` does — but a later refactor to `path.resolve`/`dirname`, which
 * do *not* add one, would silently produce `…/Gitana-Monterosrc/i18n/…`. One
 * expression removes the trap and matches how `share-delivery.test.ts` builds
 * its paths, so the two files this task added no longer resolve paths two
 * different ways (PR #100 review).
 */
const ROUTES_MODULE = fileURLToPath(
  new URL("../../src/i18n/routes.ts", import.meta.url)
);

/**
 * Every literal route segment the site serves, both locales.
 *
 * Read as **text** rather than imported. `src/i18n/routes.ts` pulls in the slug
 * registry and the content collections, so importing it drags Astro's virtual
 * `astro:content` into a suite that has no business needing it — and a grader
 * that fails because of an import graph is a grader nobody trusts. The regex is
 * checked for vacuity below, which is the real risk with this technique.
 */
function siteRouteSegments(): string[] {
  const source = readFileSync(ROUTES_MODULE, "utf8");
  const block =
    /COLLECTION_ROUTE_SEGMENTS\s*=\s*\{([\s\S]*?)\n\} as const/.exec(source);
  if (!block) return [];
  return [
    ...block[1].matchAll(/\{\s*en:\s*"([^"]+)",\s*es:\s*"([^"]+)"\s*\}/g),
  ].flatMap((match) => [match[1], match[2]]);
}

/* =========================================================================
 * Handle fixtures, hoisted so the reserved-set block can cross-check them.
 *
 * These were inline `it.each` tables until 2026-09-05, which is precisely how
 * `gitana` came to be asserted claimable in one table while `contract.ts`
 * reserved it in another: nothing compared the two. Named constants let the
 * unmarked block below assert they cannot disagree again.
 * ====================================================================== */

/**
 * Handles a stranger may claim. Every rejection in this file is only
 * meaningful because these are accepted — a validator that refused everything
 * would satisfy the whole rejection table.
 *
 * Four distinct shapes, on purpose:
 * - `blanca` — a plain lowercase alphabetic word, no separator, no digit.
 *   This is the row `gitana` used to fill; it is *not* a site word, *not* the
 *   distinctive half of the flagship truck's name, and not in
 *   `RESERVED_HANDLES` (asserted below, so reserving it later turns this file
 *   red rather than silently recreating the contradiction).
 * - `gitana-blanca` — the hyphen. Unreserved: the impersonation risk is the
 *   bare site word, and MIG-04's seed needs a claimable form of the display
 *   name. Availability is the unique index's job, not `handleIssues`'.
 * - `montero2002` — digits, and a reserved word as a strict prefix.
 * - `g1` — exactly `HANDLE_LENGTH.min`.
 */
const CLAIMABLE_FIXTURES = [
  "blanca",
  "gitana-blanca",
  "montero2002",
  "g1",
] as const;

/**
 * Handles that must be rejected with the `reserved` issue specifically.
 *
 * `Admin` is here in mixed case deliberately — the reservation check runs
 * after folding, and a check that ran on the raw input would be defeated by
 * the shift key.
 */
const RESERVED_FIXTURES = [
  "admin",
  "Admin",
  "api",
  "es",
  "taller",
  // The flagship words. `montero` and `monterogarage` are the site itself;
  // `gitana` is the truck the whole platform is designed around (MIG-04), and
  // a garage URL is the one place a stranger cannot tell the difference.
  "montero",
  "gitana",
] as const;

/**
 * The subset Tier B writes to a real database.
 *
 * Already folded, so the probe tests the *reservation* rule rather than the
 * case-folding rule — which has its own grader, and would otherwise be the
 * thing answering. Derived from `RESERVED_FIXTURES` rather than re-typed so
 * the SQL check constraint and the pure validator cannot drift apart: adding a
 * word in one place adds it in both.
 */
const RESERVED_DB_PROBES = RESERVED_FIXTURES.filter(
  (handle) => handle === handle.toLowerCase()
);

/* =========================================================================
 * The reserved set. **Unmarked** — a claim about two files that exist.
 * ====================================================================== */

describe("the reserved set covers the site's own namespace", () => {
  it("extracts the route segments — the regex is not vacuous", () => {
    // The failure mode of a text-scraping grader is that it silently matches
    // nothing and the superset check below becomes "a list contains the empty
    // set", which is true of every list. Named segments, not just a count, so a
    // regex that started matching the wrong thing is visible too.
    const segments = siteRouteSegments();

    expect(segments.length).toBeGreaterThanOrEqual(10);
    expect(segments).toContain("glossary");
    expect(segments).toContain("glosario");
    expect(segments).toContain("taller");
  });

  it("reserves EVERY route segment the site serves, in both locales", () => {
    // A hand-written list checked only against itself stops being complete the
    // first time the site grows. This is the check that notices: add a
    // collection to `COLLECTION_ROUTE_SEGMENTS` and this grader goes red until
    // the segment is reserved.
    const reserved = new Set<string>(RESERVED_HANDLES);
    const missing = siteRouteSegments().filter(
      (segment) => !reserved.has(segment)
    );

    expect(missing).toEqual([]);
  });

  it("reserves both locale codes", () => {
    // `/es/` and a user called `es` are the same string in the same position of
    // the same URL.
    expect([...RESERVED_HANDLES]).toContain("en");
    expect([...RESERVED_HANDLES]).toContain("es");
  });

  it("reserves the impersonation words the brief names", () => {
    expect([...RESERVED_HANDLES]).toContain("admin");
    expect([...RESERVED_HANDLES]).toContain("api");
  });

  it("every reserved word is itself a well-formed handle", () => {
    // A reserved word that the format rule would reject anyway is a row that
    // can never fire — it reserves nothing, and it makes the list look more
    // complete than it is. `_astro` is the one deliberate exception: it is a
    // real path Astro emits, so it must be reserved even though no user could
    // ever have claimed it.
    const unreachable = RESERVED_HANDLES.filter(
      (handle) => handle !== "_astro" && !HANDLE_PATTERN.test(handle)
    );

    expect(unreachable).toEqual([]);
  });

  it("the reserved list has no duplicates", () => {
    expect(new Set(RESERVED_HANDLES).size).toBe(RESERVED_HANDLES.length);
  });

  it("reserves the flagship words a stranger could speak as the site", () => {
    // `montero` and `monterogarage` are the site's own name. `gitana` is the
    // truck MIG-04 makes user page #1 and AGENTS.md calls the template every
    // other garage is shaped by — on this domain the three read alike in a
    // URL, so they are reserved alike.
    expect([...RESERVED_HANDLES]).toContain("montero");
    expect([...RESERVED_HANDLES]).toContain("monterogarage");
    expect([...RESERVED_HANDLES]).toContain("gitana");
  });

  /* -----------------------------------------------------------------------
   * The two consistency guards. These exist because the defect they catch
   * actually shipped: `gitana` sat in `RESERVED_HANDLES` and in this file's
   * claimable table at the same time from T2-401 until 2026-09-05, and no
   * grader could see it because the fixtures were inline literals in two
   * blocks that never met. They are unmarked — they compare two test-file
   * constants and are answerable today, before T2-402 exists.
   * -------------------------------------------------------------------- */

  it("NO claimable fixture is reserved — the two lists cannot disagree", () => {
    const reserved = new Set<string>(RESERVED_HANDLES);
    const contradictory = CLAIMABLE_FIXTURES.filter((handle) =>
      reserved.has(handle.toLowerCase())
    );

    expect(contradictory).toEqual([]);
  });

  it("EVERY fixture rejected as reserved is actually in the list", () => {
    // The mirror. Without it, deleting a word from `RESERVED_HANDLES` leaves
    // the rejection table below asserting a rule nothing implements — and the
    // implementer, reading only `contract.ts`, would build the weaker thing
    // and never learn the grader disagreed.
    const reserved = new Set<string>(RESERVED_HANDLES);
    const unbacked = RESERVED_FIXTURES.filter(
      (handle) => !reserved.has(handle.toLowerCase())
    );

    expect(unbacked).toEqual([]);
  });

  it("the two fixture sets are disjoint and neither is empty", () => {
    // Vacuity control for the two guards above: both are `filter(...)` over a
    // list, and both are trivially satisfied by an empty list.
    expect(CLAIMABLE_FIXTURES.length).toBeGreaterThanOrEqual(4);
    expect(RESERVED_FIXTURES.length).toBeGreaterThanOrEqual(5);
    // `RESERVED_DB_PROBES` is a `filter`, and `it.each([])` over an empty
    // table is a Tier B block that reports nothing and looks like a pass.
    expect(RESERVED_DB_PROBES.length).toBeGreaterThanOrEqual(5);
    expect(RESERVED_DB_PROBES).toContain("gitana");

    const claimable = new Set<string>(
      CLAIMABLE_FIXTURES.map((handle) => handle.toLowerCase())
    );
    const overlap = RESERVED_FIXTURES.filter((handle) =>
      claimable.has(handle.toLowerCase())
    );

    expect(overlap).toEqual([]);
  });
});

/* =========================================================================
 * The format rules.
 * ====================================================================== */

describe("normalizeHandle folds a candidate to one canonical form", () => {
  it.each<[string, string]>([
    ["Gitana", "gitana"],
    ["GITANA", "gitana"],
    ["  gitana  ", "gitana"],
    ["gitana", "gitana"],
  ])("folds %s to %s", (input, expected) => {
    expect(normalizeHandle(input)).toBe(expected);
  });

  it("is idempotent — folding a folded handle changes nothing", () => {
    // The property that makes a unique index on the folded value meaningful. If
    // folding twice differed from folding once, two rows could disagree about
    // which one they are.
    expect(normalizeHandle(normalizeHandle("Gitana"))).toBe(
      normalizeHandle("Gitana")
    );
  });

  it("does NOT validate — it returns a string for anything", () => {
    // Canonicalisation and validation are separate on purpose: a
    // `normalizeHandle` that threw would make `handleIssues` unable to report
    // *why* a candidate failed, and a form that can only say "invalid" makes
    // the user guess.
    expect(typeof normalizeHandle("!!!")).toBe("string");
  });
});

describe("handleIssues names every reason, not the first one", () => {
  it.each<[string, string]>([
    ["", "empty"],
    ["a", "too-short"],
    ["a".repeat(HANDLE_LENGTH.max + 1), "too-long"],
    ["gitana blanca", "bad-characters"],
    ["gitana.blanca", "bad-characters"],
    ["gitana_blanca", "bad-characters"],
    ["-gitana", "bad-characters"],
    ["gitana-", "bad-characters"],
    // Derived from `RESERVED_FIXTURES` rather than re-typed, so this table and
    // the guards above can never name different words.
    ...RESERVED_FIXTURES.map((handle): [string, string] => [
      handle,
      "reserved",
    ]),
  ])("rejects %s as %s", (input, issue) => {
    expect(handleIssues(input)).toContain(issue);
  });

  it("reports MORE than one reason when more than one applies", () => {
    // An array rather than a first-failure, so a grader can tell a length rule
    // from a reservation rule. Without that, a reservation rule could be
    // deleted and nothing would notice — the length rule would still answer.
    expect(handleIssues("A").length).toBeGreaterThanOrEqual(1);
    expect(handleIssues("!")).toEqual(
      expect.arrayContaining(["too-short", "bad-characters"])
    );
  });

  it.each<[string]>(CLAIMABLE_FIXTURES.map((handle): [string] => [handle]))(
    "POSITIVE CONTROL: accepts %s",
    (input) => {
      // Every rejection above is only meaningful because these pass. A
      // validator that refused everything would satisfy the whole table.
      //
      // `gitana` was here until 2026-09-05 and is not any more: it is reserved
      // (see the file header and `RESERVED_FIXTURES`). `blanca` took its row so
      // the "plain alphabetic word" shape is still controlled for.
      expect(handleIssues(input)).toEqual([]);
    }
  );

  it("screens the reserved list AFTER folding, not before", () => {
    // `Admin` is `admin`. A reservation check that ran on the raw input would
    // be defeated by the shift key.
    expect(handleIssues("ADMIN")).toContain("reserved");
  });
});

describe("handlePath is the stable URL SHR-02 promises", () => {
  it("is per-locale and carries the handle", () => {
    const es = handlePath({ handle: "gitana", locale: "es" });
    const en = handlePath({ handle: "gitana", locale: "en" });

    expect(es).toContain("gitana");
    expect(en).toContain("gitana");
    expect(es.startsWith("/es/")).toBe(true);
    expect(en.startsWith("/en/")).toBe(true);
  });

  it("differs between locales — I18N-01 privileges neither", () => {
    // If the two were identical, one locale's word would be serving both, which
    // is the asymmetry I18N-01 exists to prevent.
    expect(handlePath({ handle: "gitana", locale: "es" })).not.toBe(
      handlePath({ handle: "gitana", locale: "en" })
    );
  });
});

/* =========================================================================
 * The schema.
 * ====================================================================== */

describe("the database is what enforces uniqueness (SHR-02)", () => {
  it("profiles carries a handle column", () => {
    const body = createTableBody(migrationSql(), "profiles");

    expect(columnDefinition(body ?? "", "handle")).not.toBeNull();
  });

  it("the handle is unique, case-insensitively, in the SCHEMA", () => {
    // Not in the form. A `select … where handle = $1` before an insert is a
    // check-then-act race that two signups one millisecond apart both win.
    // Either spelling is fine — `citext`, or a unique index on `lower(handle)`
    // — because both make the database the thing that says no.
    const sql = migrationSql();

    expect(sql).toMatch(
      /create unique index[^;]*profiles[^;]*\(\s*lower\s*\(\s*handle\s*\)\s*\)|handle\s+citext[^,)]*unique|unique\s*\(\s*lower\s*\(\s*handle\s*\)\s*\)/
    );
  });
});

/* =========================================================================
 * Tier B — the properties only a database can answer.
 * ====================================================================== */

describe.skipIf(!live.available)(
  liveTitle("handles are unique, folded, and not recyclable", live),
  () => {
    // Sequential, not concurrent — see the file header. This proves the
    // constraint is in the schema (a form-only check fails it); it does not
    // prove behaviour under two overlapping transactions.
    it("a second account cannot take a handle already held", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const handle = testHandle("a", scenario.runId);

        const first = await updateRows(
          scenario,
          scenario.ownerA,
          "profiles",
          `id=eq.${scenario.ownerA.userId}`,
          { handle }
        );
        const second = await updateRows(
          scenario,
          scenario.ownerB,
          "profiles",
          `id=eq.${scenario.ownerB.userId}`,
          { handle }
        );

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("two accounts cannot hold handles differing only in case", async () => {
      // The impersonation kit. Written as its own grader because a schema with
      // a plain `unique (handle)` passes the one above and fails this one — and
      // that is the schema somebody writes first.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const handle = testHandle("a", scenario.runId);

        const claimed = await updateRows(
          scenario,
          scenario.ownerA,
          "profiles",
          `id=eq.${scenario.ownerA.userId}`,
          { handle }
        );
        const shouted = await updateRows(
          scenario,
          scenario.ownerB,
          "profiles",
          `id=eq.${scenario.ownerB.userId}`,
          { handle: handle.toUpperCase() }
        );

        // The precondition, asserted rather than assumed. Without it this
        // grader **passes today** for entirely the wrong reason: there is no
        // `handle` column, so PostgREST refuses *both* writes and "the second
        // one was refused" is trivially true. An `it.fails` that passes is a
        // reported failure whose message is about the wrong thing.
        expect(claimed.ok).toBe(true);
        expect(shouted.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it.each(RESERVED_DB_PROBES)(
      "the database refuses the reserved handle %s",
      async (handle) => {
        // Reserved in the schema, not only in the form. SHR-01's posture is
        // that the guarantee survives a row inserted by a script, by an import
        // job, by a `curl` somebody found on a forum.
        const scenario = await provisionScenario(stackOf(live));
        try {
          // The control comes first, and it is load-bearing: with no `handle`
          // column every write is refused, so "the reserved one was refused"
          // would be true of a schema that has no handles at all.
          const allowed = await updateRows(
            scenario,
            scenario.ownerA,
            "profiles",
            `id=eq.${scenario.ownerA.userId}`,
            { handle: testHandle("a", scenario.runId) }
          );
          const response = await updateRows(
            scenario,
            scenario.ownerA,
            "profiles",
            `id=eq.${scenario.ownerA.userId}`,
            { handle }
          );

          expect(allowed.ok).toBe(true);
          expect(response.ok).toBe(false);
        } finally {
          await teardownScenario(scenario);
        }
      }
    );

    it("a released handle is not immediately takeable by ANOTHER account", async () => {
      // ## The property SHR-02 implies rather than states
      //
      // "a stable public URL under their handle". If owner A renames from H1 to
      // H2 and owner B may then claim H1, every link A already shared — in a
      // WhatsApp thread, on a forum, printed on an invoice — silently starts
      // pointing at B's garage. The URL did not change; what it means did.
      //
      // Recorded as an open question for the owner in T2-401's report, because
      // the spec does not say it outright and the alternatives (forbid renames;
      // retire the old handle; 410 the old URL) are a product decision. What is
      // *not* a product decision is that a stranger must not inherit it.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const released = testHandle("a", scenario.runId);

        const claimed = await updateRows(
          scenario,
          scenario.ownerA,
          "profiles",
          `id=eq.${scenario.ownerA.userId}`,
          { handle: released }
        );
        const renamed = await updateRows(
          scenario,
          scenario.ownerA,
          "profiles",
          `id=eq.${scenario.ownerA.userId}`,
          { handle: testHandle("a2", scenario.runId) }
        );

        const stolen = await updateRows(
          scenario,
          scenario.ownerB,
          "profiles",
          `id=eq.${scenario.ownerB.userId}`,
          { handle: released }
        );

        // Both preconditions asserted: a rename that never happened would
        // make "the old handle is not takeable" true for the dullest of
        // reasons.
        expect(claimed.ok).toBe(true);
        expect(renamed.ok).toBe(true);
        expect(stolen.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("POSITIVE CONTROL: the original owner CAN reclaim it", async () => {
      // Without this, the grader above is satisfied by a schema where a handle
      // is permanent and a rename is impossible — which would fail SHR-02 in
      // the other direction and look like success.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const first = testHandle("a", scenario.runId);

        await updateRows(
          scenario,
          scenario.ownerA,
          "profiles",
          `id=eq.${scenario.ownerA.userId}`,
          { handle: first }
        );
        await updateRows(
          scenario,
          scenario.ownerA,
          "profiles",
          `id=eq.${scenario.ownerA.userId}`,
          { handle: testHandle("a2", scenario.runId) }
        );
        const reclaimed = await updateRows(
          scenario,
          scenario.ownerA,
          "profiles",
          `id=eq.${scenario.ownerA.userId}`,
          { handle: first }
        );

        expect(reclaimed.ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("retired_handles is trigger-owned — a client cannot squat the namespace", async () => {
      // ## The defect this pins (T2-402 review, F1 — reproduced live)
      //
      // Retirement is what makes the grader two above true, and its input used
      // to be `new.retired_handles` — the value the *client* sent. `profiles`
      // carries a table-wide `grant update to authenticated` with no column
      // list, so one request to one's own row —
      //
      //     PATCH /rest/v1/profiles?id=eq.<self>
      //     {"retired_handles": ["gitana", "montero2002", "cr", ...]}
      //
      // — made every named handle permanently unclaimable by anybody, because
      // the "released by another account" refusal fired on a handle nobody had
      // ever held. The whole namespace, for the price of one PATCH.
      //
      // ## Why the attack request is asserted to SUCCEED
      //
      // This is the positive control, and it is the half that makes the grader
      // mean something. `attack.ok === true` says the write really did reach
      // the row: the defence under test is the trigger discarding the value,
      // not PostgREST refusing the column. If someone later "fixes" this by
      // revoking the column instead, this line goes red and says so — which is
      // the honest outcome, because a column-level revoke is a different
      // (and also acceptable) fix that this grader should be told about rather
      // than silently satisfied by.
      //
      // The negative half — that a *genuine* retirement still blocks a stranger
      // — is the grader two above, and neither is worth anything without the
      // other: together they say the list is enforced and unforgeable.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const squatted = testHandle("squat", scenario.runId);

        const attack = await updateRows(
          scenario,
          scenario.ownerA,
          "profiles",
          `id=eq.${scenario.ownerA.userId}`,
          { retired_handles: [squatted] }
        );

        // Owner B has never met owner A and has nothing to do with any of it.
        const claim = await updateRows(
          scenario,
          scenario.ownerB,
          "profiles",
          `id=eq.${scenario.ownerB.userId}`,
          { handle: squatted }
        );

        expect(attack.ok).toBe(true);
        expect(claim.ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("a vehicle can be published under the handle (SHR-02)", async () => {
      // The point of the whole file. Every rule above is a constraint, and a
      // set of constraints with no working case is a feature nobody can use.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const claimed = await updateRows(
          scenario,
          scenario.ownerA,
          "profiles",
          `id=eq.${scenario.ownerA.userId}`,
          { handle: testHandle("a", scenario.runId) }
        );
        const vehicle = await insertRow(scenario, scenario.ownerA, "vehicles", {
          owner_id: scenario.ownerA.userId,
          display_name: testVehicleName("a"),
          ...TEST_TAXONOMY_IDENTITY,
          is_showcase_public: true,
        });

        // The handle is the half that does not exist yet; publishing a
        // vehicle already works. Asserting only the second would make this
        // grader pass today and say nothing about SHR-02.
        expect(claimed.ok).toBe(true);
        expect(vehicle.ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);
