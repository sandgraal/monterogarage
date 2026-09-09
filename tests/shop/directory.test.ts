/**
 * Graders — **the community-directory claim and directory neutrality, T3-201
 * [TEST]**, activated by **T3-203 [PLATFORM]** (spec 003, the directory claim
 * flow). Note the split activation: T3-202 activates the membership graders in
 * `membership.test.ts`; the directory claim is T3-203's, so *these* markers are
 * the ones T3-203 deletes.
 *
 * ## The two guarantees, and why one of them is graded now on purpose
 *
 * - **SHP-02 — an unverified claim renders nothing.** A claim is a database row
 *   pointing at a git-owned community `shop` entry by its content id, never an
 *   edit to the entry; the community collection stays read-only (tasks.md
 *   T3-203). The directory renders a claimed badge only once the claim is
 *   verified, and an unverified claim changes nothing a reader sees.
 *
 * - **SHP-05 — directory neutrality.** The directory's ordering and inclusion
 *   are a pure function of the git-owned community content (plus any
 *   spec-sanctioned neutral facet), provably independent of who is claimed, who
 *   is a member, or any subscription/plan state. MON-05 restates this as a money
 *   rule "because it will be tempting later"; T3-401 re-runs it once a plan
 *   exists. **This grader is written now, before any entitlement exists, so no
 *   future plan can be tempted to buy ranking without turning it red.** The
 *   invariance it pins is only load-bearing if it is in place *before* the
 *   thing that would violate it.
 *
 * ## How these render properties are graded — extracted pure functions
 *
 * SHP-02's "renders nothing" and SHP-05's "pure function of content" are render
 * concerns, and the project already extracts render logic out of the directory
 * `.astro` page into unit-testable pure modules for exactly this reason — see
 * `src/lib/community-filter.ts`'s own docstring ("everything that decides
 * whether a card is shown is unit-testable without a browser"). T3-203 ships two
 * more such modules; these graders load them by **dynamic import** so a missing
 * module fails with the named `directorySeam`, not an unresolvable static import
 * that would error the whole file (the marker convention: fail today, for the
 * right reason). The controls below (`neutralListing` / `temptedListing`, and
 * the content-schema strictness checks) are hermetic and green *today* — they
 * are the "mutation-test the probe corpus" guard that proves the seam-backed
 * assertions can actually fail.
 *
 * Every name is a decision made on the spec's behalf in `./contract.ts`,
 * renegotiable in one line; the behaviour — SHP-02, SHP-05 — is not.
 *
 * refs specs/003-shop-tools (SHP-02, SHP-05, MON-05),
 * specs/001-foundation (COM-01)
 */
import { describe, expect, it } from "vitest";
import { CONTRACT_SCHEMA } from "../garage/contract.ts";
import { tableGrantIssues } from "../garage/rules.ts";
import {
  columnDefinitionFor,
  createdTables,
  enablesRls,
  foreignKey,
  foreignKeyFor,
  forcesRls,
  isNotNullFor,
  migrationSql,
} from "../garage/sql.ts";
import { communitySchema } from "../../src/schemas/community.ts";
import {
  CLAIM_ENTRY_ID_COLUMN,
  CLAIM_SHOP_ID_COLUMN,
  CLAIM_VERIFIED_AT_COLUMN,
  DIRECTORY_CLAIMS_TABLE,
  DIRECTORY_CLAIM_MODULE,
  DIRECTORY_LISTING_EXPORT,
  DIRECTORY_ORDER_MODULE,
  RESOLVE_CLAIM_BADGES_EXPORT,
  directorySeam,
} from "./contract.ts";

/* =========================================================================
 * Synthetic fixtures — obviously not real content (TEST- namespace).
 * ====================================================================== */

/** One directory row, reduced to what ordering and inclusion can depend on. */
interface DirectoryEntryFixture {
  readonly id: string;
  readonly title: string;
}

/** A directory claim: a DB row pointing at a git content id. */
interface DirectoryClaimFixture {
  readonly communityEntryId: string;
  readonly shopId: string;
  /** `null` means unverified — the fact that decides whether a badge renders. */
  readonly verifiedAt: string | null;
}

/**
 * Everything that could tempt a non-neutral directory: who is viewing, which
 * entries are claimed, which shops the viewer belongs to, and each shop's plan.
 * SHP-05 says the ordering/inclusion output ignores every field here.
 */
interface DirectoryContext {
  readonly viewerAccountId: string | null;
  readonly claims: readonly DirectoryClaimFixture[];
  readonly memberships: readonly string[];
  readonly plans: Readonly<Record<string, string>>;
}

/** Neutral title order: aaa, mmm, zzz. The last one is the one we claim/pay for. */
const ENTRIES: readonly DirectoryEntryFixture[] = [
  { id: "TEST-shop-aaa", title: "Aaa Taller" },
  { id: "TEST-shop-mmm", title: "Mmm Repuestos" },
  { id: "TEST-shop-zzz", title: "Zzz Motors" },
];

const CLAIM_ZZZ_VERIFIED: DirectoryClaimFixture = {
  communityEntryId: "TEST-shop-zzz",
  shopId: "TEST-shop-1",
  verifiedAt: "2026-09-08T00:00:00Z",
};
const CLAIM_ZZZ_UNVERIFIED: DirectoryClaimFixture = {
  communityEntryId: "TEST-shop-zzz",
  shopId: "TEST-shop-1",
  verifiedAt: null,
};

const EMPTY_CONTEXT: DirectoryContext = {
  viewerAccountId: null,
  claims: [],
  memberships: [],
  plans: {},
};

/**
 * Contexts a tempted ranking would react to — a claim on the last-by-title
 * entry, that claim's shop on a paid plan, a viewer who is a shop member, and
 * combinations. Every one must produce the exact same listing as `EMPTY_CONTEXT`
 * (SHP-05). "Only the last entry claimed" is deliberate: a context that claims
 * *everything* could not reorder a rank-first listing and so would not catch it.
 */
const NON_NEUTRAL_CONTEXTS: readonly (readonly [string, DirectoryContext])[] = [
  [
    "a viewer who is a member of a shop",
    {
      viewerAccountId: "TEST-acct-1",
      claims: [],
      memberships: ["TEST-shop-1"],
      plans: {},
    },
  ],
  [
    "the last-by-title entry claimed and verified",
    { ...EMPTY_CONTEXT, claims: [CLAIM_ZZZ_VERIFIED] },
  ],
  [
    "the last-by-title claim's shop on a paid plan",
    {
      ...EMPTY_CONTEXT,
      claims: [CLAIM_ZZZ_VERIFIED],
      plans: { "TEST-shop-1": "pro" },
    },
  ],
  [
    "an unverified claim on the last-by-title entry",
    { ...EMPTY_CONTEXT, claims: [CLAIM_ZZZ_UNVERIFIED] },
  ],
  [
    "a mix: last entry claimed and paid, viewer a member",
    {
      viewerAccountId: "TEST-acct-1",
      claims: [CLAIM_ZZZ_VERIFIED],
      memberships: ["TEST-shop-1"],
      plans: { "TEST-shop-1": "pro" },
    },
  ],
];

/* -------------------------------------------------------------------------
 * Hermetic references — green today. They prove the seam-backed assertions
 * below are discriminating rather than decorative (GRADER-PRINCIPLES: mutation-
 * test the probe corpus; a test that cannot fail is worse than none).
 * ---------------------------------------------------------------------- */

/**
 * A content-only listing: order is title alone, inclusion is every entry, and
 * it takes **no context** — content-only by construction. This is what a
 * SHP-05-correct `directoryListing` must be equivalent to.
 */
function neutralListing(
  entries: readonly DirectoryEntryFixture[]
): readonly string[] {
  return [...entries]
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
    .map((entry) => entry.id);
}

/**
 * A *tempted* listing that ranks paid, then verified-claimed, entries first —
 * the exact thing SHP-05 / MON-05 forbid. Used only to prove the invariance
 * assertion can fail; never imported by any shipped code.
 */
function temptedListing(
  entries: readonly DirectoryEntryFixture[],
  context: DirectoryContext
): readonly string[] {
  const verified = new Set(
    context.claims.filter((c) => c.verifiedAt).map((c) => c.communityEntryId)
  );
  const paid = new Set(
    context.claims
      .filter((c) => {
        const plan = context.plans[c.shopId];
        return plan !== undefined && plan !== "free";
      })
      .map((c) => c.communityEntryId)
  );
  const rank = (entry: DirectoryEntryFixture): number =>
    paid.has(entry.id) ? 0 : verified.has(entry.id) ? 1 : 2;
  return [...entries]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
    )
    .map((entry) => entry.id);
}

/* -------------------------------------------------------------------------
 * The T3-203 render seams, loaded by dynamic import.
 * ---------------------------------------------------------------------- */

type DirectoryListing = (
  entries: readonly DirectoryEntryFixture[],
  context: DirectoryContext
) => readonly string[];

type ResolveClaimBadges = (
  claims: readonly DirectoryClaimFixture[]
) => ReadonlySet<string> | Set<string>;

/**
 * Load a named export from a T3-203 module by **variable-path** dynamic import.
 *
 * The path is a `string` variable (the `./contract.ts` constant), not a string
 * literal, on purpose: a literal `import("…/neutral-order.ts")` makes `tsc`
 * (and so `astro check`, `npm run verify`'s first gate) fail with ts(2307)
 * "cannot find module" while T3-203 has not written it — an error, not the
 * expected failure the marker convention requires. A variable specifier is
 * typed `Promise<any>` and never resolved by `tsc`, and the inline
 * `@vite-ignore` annotation keeps Vite from resolving it at transform time;
 * both are settled at runtime, resolving relative to this file when the module
 * exists and rejecting catchably (→ the named `directorySeam`) when it does
 * not. Verified both ways before adoption.
 */
async function loadExport<T>(
  modulePath: string,
  exportName: string,
  what: string
): Promise<T> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ modulePath)) as Record<
      string,
      unknown
    >;
  } catch {
    throw directorySeam(
      `${modulePath} (${exportName}) is not implemented — ${what}`
    );
  }
  const fn = mod[exportName];
  if (typeof fn !== "function") {
    throw directorySeam(
      `${modulePath} does not export ${exportName} — ${what}`
    );
  }
  return fn as T;
}

function loadDirectoryListing(): Promise<DirectoryListing> {
  return loadExport<DirectoryListing>(
    DIRECTORY_ORDER_MODULE,
    DIRECTORY_LISTING_EXPORT,
    "the SHP-05 neutral directory ordering"
  );
}

function loadResolveClaimBadges(): Promise<ResolveClaimBadges> {
  return loadExport<ResolveClaimBadges>(
    DIRECTORY_CLAIM_MODULE,
    RESOLVE_CLAIM_BADGES_EXPORT,
    "the SHP-02 claimed-badge resolver"
  );
}

/* =========================================================================
 * SHP-02, structural (Tier A) — the claim is a DB row pointing at content,
 * never an edit to the git-owned entry. Each fails today with the T3-203 seam.
 * ====================================================================== */

describe("the directory_claims table is a pointer at content, behind RLS (SHP-02)", () => {
  function requireClaimsTable(): void {
    const exists = createdTables(migrationSql()).some(
      (table) => table.name === DIRECTORY_CLAIMS_TABLE
    );
    if (!exists) {
      throw directorySeam(
        `no table named ${CONTRACT_SCHEMA}.${DIRECTORY_CLAIMS_TABLE} exists in ` +
          `supabase/migrations/`
      );
    }
  }

  it("directory_claims enables AND forces row level security", () => {
    requireClaimsTable();
    const sql = migrationSql();
    expect(enablesRls(sql, DIRECTORY_CLAIMS_TABLE)).toBe(true);
    expect(forcesRls(sql, DIRECTORY_CLAIMS_TABLE)).toBe(true);
  });

  it("no anonymous role reaches directory_claims", () => {
    requireClaimsTable();
    expect(tableGrantIssues(migrationSql(), [DIRECTORY_CLAIMS_TABLE])).toEqual(
      []
    );
  });

  it("community_entry_id is a text pointer at a content id, not a table FK", () => {
    // The claim points at a git-owned community entry by its *content id* — a
    // `text` value like `veinsa-motors-mitsubishi-costa-rica`. It is not a
    // foreign key into any user table, because the community collection lives in
    // git and not in the database. A FK here would mean a claim edits/relates to
    // a DB copy of the entry — exactly what "the collection stays read-only"
    // forbids.
    requireClaimsTable();
    const sql = migrationSql();
    const def = columnDefinitionFor(
      sql,
      DIRECTORY_CLAIMS_TABLE,
      CLAIM_ENTRY_ID_COLUMN
    );
    expect(
      def,
      `${DIRECTORY_CLAIMS_TABLE}.${CLAIM_ENTRY_ID_COLUMN} is not declared`
    ).not.toBeNull();
    expect(def?.definition).toMatch(/text/);
    const fk =
      foreignKey(def?.definition ?? "") ??
      foreignKeyFor(sql, DIRECTORY_CLAIMS_TABLE, CLAIM_ENTRY_ID_COLUMN);
    expect(
      fk,
      `${CLAIM_ENTRY_ID_COLUMN} carries a foreign key — a claim must point at a ` +
        `git content id, not a database relation`
    ).toBeNull();
  });

  it("verified_at is nullable — null is the unverified state", () => {
    // SHP-02's single decisive fact: `verified_at is null` ⇒ unverified ⇒ no
    // badge. If the column were `not null` there would be no way to represent an
    // unverified claim, and "an unverified claim changes nothing" would be
    // unstatable.
    requireClaimsTable();
    const sql = migrationSql();
    const def = columnDefinitionFor(
      sql,
      DIRECTORY_CLAIMS_TABLE,
      CLAIM_VERIFIED_AT_COLUMN
    );
    expect(
      def,
      `${DIRECTORY_CLAIMS_TABLE}.${CLAIM_VERIFIED_AT_COLUMN} is not declared`
    ).not.toBeNull();
    expect(
      isNotNullFor(sql, DIRECTORY_CLAIMS_TABLE, CLAIM_VERIFIED_AT_COLUMN)
    ).toBe(false);
  });

  it("shop_id records the claiming shop", () => {
    requireClaimsTable();
    const def = columnDefinitionFor(
      migrationSql(),
      DIRECTORY_CLAIMS_TABLE,
      CLAIM_SHOP_ID_COLUMN
    );
    expect(
      def,
      `${DIRECTORY_CLAIMS_TABLE}.${CLAIM_SHOP_ID_COLUMN} is not declared`
    ).not.toBeNull();
  });
});

/* =========================================================================
 * SHP-02, content read-only (green today) — a claim can never be an edit to
 * the community entry, because the content schema cannot carry claim state.
 * ====================================================================== */

describe("the community content schema cannot carry claim/verification state (SHP-02)", () => {
  /** A synthetic, valid `shop`-typed community entry — obviously not real. */
  const validShopEntry = {
    id: "TEST-shop-directory-entry",
    fitment: { gens: ["gen3"], markets: ["cr"] },
    communityType: "shop",
    regions: ["CR"],
    languages: ["es-CR"],
    activity: "active",
    activityAssessed: "2026-09-08",
    url: "https://example.com/test-shop",
    confidence: "first-hand",
    sources: [],
    prose: {
      en: {
        title: "TEST shop entry",
        summary: "A synthetic community shop entry used only for grading.",
        goodFor: ["Grading the directory claim invariant"],
      },
      es: {
        title: "TEST entrada de taller",
        summary: "Una entrada sintética de taller usada solo para calificar.",
        goodFor: ["Calificar la invariante de reclamo del directorio"],
      },
    },
  } as const;

  it("the valid shop entry parses (the positive control)", () => {
    // Without this, a schema broken so that *nothing* parses would make the
    // rejection tests below pass vacuously.
    const result = communitySchema.safeParse(validShopEntry);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it.each([
    ["verified", { verified: true }],
    ["claimedByShopId", { claimedByShopId: "TEST-shop-1" }],
    ["claimVerifiedAt", { claimVerifiedAt: "2026-09-08" }],
  ])(
    "rejects a community entry carrying a `%s` claim field",
    (_label, extra) => {
      // A claim lives in the database, never in the entry. The content schema is
      // `.strict()`, so an entry that tries to carry verification/claim state is
      // rejected at build time — which is what keeps a claim from ever being an
      // edit to the git-owned entry.
      const result = communitySchema.safeParse({ ...validShopEntry, ...extra });
      expect(result.success).toBe(false);
    }
  );
});

/* =========================================================================
 * SHP-02, render (Tier B-style, seam) — an unverified claim renders nothing.
 * ====================================================================== */

describe("an unverified directory claim renders nothing (SHP-02)", () => {
  it.each([
    ["an unverified claim shows no badge", null, false],
    ["a verified claim shows a badge", "2026-09-08T00:00:00Z", true],
  ] as const)("%s", async (_label, verifiedAt, shows) => {
    // The boundary on the one variable that decides visibility: whether the
    // claim is verified. The verified row is the positive control that stops
    // "shows nothing" being satisfied by a resolver that always returns empty.
    const resolveClaimBadges = await loadResolveClaimBadges();
    const badges = resolveClaimBadges([
      { communityEntryId: "TEST-shop-zzz", shopId: "TEST-shop-1", verifiedAt },
    ]);
    expect(badges.has("TEST-shop-zzz")).toBe(shows);
  });

  it("no claim at all shows no badge", async () => {
    const resolveClaimBadges = await loadResolveClaimBadges();
    expect(resolveClaimBadges([]).has("TEST-shop-zzz")).toBe(false);
  });
});

/* =========================================================================
 * SHP-05 — directory ordering and inclusion are a pure function of content.
 * ====================================================================== */

describe("directory ordering and inclusion are neutral (SHP-05, MON-05)", () => {
  it.each(NON_NEUTRAL_CONTEXTS)(
    "order and inclusion are identical under %s",
    async (_label, context) => {
      // The load-bearing SHP-05 assertion: the directory's output is byte-for-
      // byte identical whether or not entries are claimed, whoever is a member,
      // and whatever plan any shop holds. Written now, before entitlements
      // exist, so no future plan can quietly buy ranking without turning this
      // red (MON-05: "restates SHP-05 as a money rule because it will be
      // tempting later").
      const directoryListing = await loadDirectoryListing();
      expect(directoryListing(ENTRIES, context)).toEqual(
        directoryListing(ENTRIES, EMPTY_CONTEXT)
      );
    }
  );

  it("inclusion is every entry, exactly once — nothing added or hidden", async () => {
    // Inclusion is content-only too: a claim, a membership, or a plan can
    // neither add an entry nor drop one.
    const directoryListing = await loadDirectoryListing();
    const listed = directoryListing(ENTRIES, EMPTY_CONTEXT);
    expect([...listed].sort()).toEqual([...ENTRIES.map((e) => e.id)].sort());
  });

  it("the listing is a real function of the content, not a constant", async () => {
    // Guards the invariance assertions above against a degenerate `() => []`
    // implementation that would satisfy every "identical" check vacuously:
    // dropping an entry from the *content* must change the output.
    const directoryListing = await loadDirectoryListing();
    const full = directoryListing(ENTRIES, EMPTY_CONTEXT);
    const fewer = directoryListing(ENTRIES.slice(0, 2), EMPTY_CONTEXT);
    expect(fewer).not.toEqual(full);
    expect(fewer).toHaveLength(2);
  });
});

describe("the SHP-05 neutrality assertion can actually fail (mutation-test the corpus)", () => {
  it("a claim-ranked or plan-ranked listing violates the invariance the graders pin", () => {
    // Proof the seam-backed invariance table is not decorative. Were
    // directoryListing to rank verified-claimed or paid entries first — the
    // tempting shortcut — its output under a claimed/paid context would DIFFER
    // from its empty-context output, which is exactly the equality the SHP-05
    // table asserts. So the tempted future implementation is caught.
    expect(temptedListing(ENTRIES, EMPTY_CONTEXT)).not.toEqual(
      temptedListing(ENTRIES, {
        ...EMPTY_CONTEXT,
        claims: [CLAIM_ZZZ_VERIFIED],
      })
    );
    expect(temptedListing(ENTRIES, EMPTY_CONTEXT)).not.toEqual(
      temptedListing(ENTRIES, {
        ...EMPTY_CONTEXT,
        claims: [CLAIM_ZZZ_VERIFIED],
        plans: { "TEST-shop-1": "pro" },
      })
    );
  });

  it("the difference is the ranking, not the contexts — a content-only listing is the neutral order", () => {
    // The other half: with no claim/plan to react to, even the tempted listing
    // equals the content-only `neutralListing`, so the reordering above is
    // caused entirely by the claim/plan facets a SHP-05-correct implementation
    // must ignore — not by the contexts differing in some way any correct
    // listing would legitimately react to.
    expect(temptedListing(ENTRIES, EMPTY_CONTEXT)).toEqual(
      neutralListing(ENTRIES)
    );
  });

  it("an unverified claim never earns a badge in the tempted control either", () => {
    // Ties the SHP-02 corpus to a concrete predicate so its boundary table is
    // shown discriminating today: only a verified claim is a badge.
    const badged = (
      claims: readonly DirectoryClaimFixture[]
    ): ReadonlySet<string> =>
      new Set(
        claims.filter((c) => c.verifiedAt).map((c) => c.communityEntryId)
      );
    expect(badged([CLAIM_ZZZ_UNVERIFIED]).has("TEST-shop-zzz")).toBe(false);
    expect(badged([CLAIM_ZZZ_VERIFIED]).has("TEST-shop-zzz")).toBe(true);
  });
});
