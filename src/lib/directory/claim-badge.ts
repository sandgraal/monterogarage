/**
 * The directory claimed-badge resolver — **T3-203 [PLATFORM]**, SHP-02.
 *
 * > **SHP-02** A shop SHALL be able to claim a `shop`-typed entry in the 001
 * > community directory. THE claim SHALL be verified before the directory
 * > renders any claimed badge, and an unverified claim SHALL change nothing a
 * > reader sees.
 *
 * A claim is a database row (`public.directory_claims`) pointing at a git-owned
 * community entry by its content id — never an edit to the entry, which stays
 * read-only in git. The single fact that decides whether the directory renders a
 * claimed badge is `verified_at`: `null` (or absent) means unverified, and an
 * unverified claim contributes nothing. This resolver is the pure, browser-free
 * render logic (`tests/shop/directory.test.ts` grades it by dynamic import); the
 * page reveals a badge only for the entry ids this returns.
 *
 * refs specs/003-shop-tools (SHP-02)
 */

/** A directory claim as the render layer sees it: a pointer plus its verified fact. */
export interface DirectoryClaim {
  /** The git-owned community entry's content id the claim points at. */
  readonly communityEntryId: string;
  /** The claiming shop. Optional here — the badge does not depend on it. */
  readonly shopId?: string;
  /** When the claim was verified; `null`/absent is the unverified state. */
  readonly verifiedAt?: string | null;
}

/**
 * The set of community entry ids that show a claimed badge — a claim only when
 * it is **verified** (`verifiedAt` is a non-empty timestamp). An unverified or
 * absent claim is filtered out, so "an unverified claim renders nothing" is true
 * by construction rather than by a caller remembering to check.
 */
export function resolveClaimBadges(
  claims: readonly DirectoryClaim[]
): ReadonlySet<string> {
  return new Set(
    claims
      .filter(
        (claim) =>
          typeof claim.verifiedAt === "string" && claim.verifiedAt !== ""
      )
      .map((claim) => claim.communityEntryId)
  );
}
