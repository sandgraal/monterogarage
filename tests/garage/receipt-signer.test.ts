/**
 * Graders — **the receipt signer.** Declared by T2-401 [TEST], activated by
 * T2-404 [PLATFORM].
 *
 * ## Why an Edge Function exists at all, and what makes it safe
 *
 * A Postgres function cannot mint a Supabase signed URL — signing is a
 * storage-api operation, the same wall T2-202 hit when it needed to purge
 * receipt *bytes*. T2-404's architecture therefore splits the job:
 *
 * - **Postgres decides.** The anon RPC validates the token, checks expiry and
 *   revocation, checks `includes_receipts`, and **resolves a storage path**.
 * - **The Edge Function signs.** It signs the path Postgres handed back, and
 *   nothing else.
 *
 * The whole safety of that split rests on one rule: **the signer never accepts
 * a caller-supplied path.** If it did, every authorization decision in Postgres
 * would be advisory — the caller would name the object and the signer would
 * sign it, which is a storage-wide read primitive wearing a share-link costume.
 *
 * ## The TTL is a security parameter, not a tuning knob
 *
 * A signed URL is a bearer credential that has left the building: no session,
 * no revocation, works for whoever holds it. SHR-08 makes revocation take
 * effect "on the next request" — but a signature already minted *is* the
 * previous request's answer and nothing recalls it. **The TTL is the only thing
 * bounding a leaked signature**, which is why `SIGNED_URL_TTL_SECONDS` has a
 * ceiling and why that ceiling is graded rather than left to a default.
 *
 * ## The three-cell ownership matrix
 *
 * | the receipt is on | must the signer sign it |
 * |---|---|
 * | the granted vehicle | yes, when `includes_receipts` |
 * | another vehicle of the **same owner** | **no** — a grant admits to one vehicle |
 * | another owner's vehicle | no |
 *
 * The middle cell is the one that gets built wrong, because a resolver that
 * goes token → owner → receipts returns exactly the right answer for an owner
 * with one truck, which is everybody's hand-test.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker; T2-404 activates a grader by deleting exactly that
 * `.fails`. Marked graders resolve the signer through `requireSigner`, so they
 * fail with a sentence naming the missing file rather than with `ENOENT` three
 * frames deep.
 *
 * refs specs/002-montero-garage (SHR-05, SHR-06, SHR-07, SHR-08, GAR-05′)
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RECEIPTS_BUCKET,
  RECEIPT_SIGNER_DIR,
  SHARE_READER_NAMES,
  SIGNED_URL_TTL_SECONDS,
  testReceiptPath,
} from "./contract.ts";
import {
  assertLocalTarget,
  createOwnedFixture,
  detectLiveStack,
  liveTitle,
  provisionScenario,
  signObject,
  stackOf,
  teardownScenario,
  uploadObject,
  type Scenario,
} from "./harness.ts";
import { issueGrant, revokeGrant, type IssuedGrant } from "./share-fixtures.ts";
import { readSupabaseConfig, SEAM_SHARE_GRANTS, shareSeam } from "./sql.ts";

const live = await detectLiveStack();

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SIGNER_DIR = join(REPO_ROOT, RECEIPT_SIGNER_DIR);

/**
 * Every source file of the signer, or the seam error naming what is missing.
 *
 * Concatenated rather than read as one `index.ts`, because a signer split into
 * a handler and a helper is a perfectly reasonable shape and a grader that only
 * read `index.ts` would go quiet the day somebody refactored — the worst
 * possible direction for a rule about a caller-supplied path.
 */
function requireSigner(
  directory: string = SIGNER_DIR
): { path: string; text: string }[] {
  if (!existsSync(directory)) {
    throw shareSeam(`no Edge Function at ${RECEIPT_SIGNER_DIR}/`);
  }
  const files = readdirSync(directory)
    .filter((name) => /\.(ts|js|mts)$/.test(name))
    .map((name) => ({
      path: `${RECEIPT_SIGNER_DIR}/${name}`,
      text: readFileSync(join(directory, name), "utf8"),
    }));
  if (files.length === 0) {
    throw shareSeam(`${RECEIPT_SIGNER_DIR}/ contains no source file`);
  }
  return files;
}

/** The signer's whole source, as one string. */
function signerSource(): string {
  return requireSigner()
    .map((file) => file.text)
    .join("\n");
}

/* =========================================================================
 * Tier A — unmarked. Claims about the repo as it stands.
 * ====================================================================== */

describe("there is exactly one signer, and these rules reach all of it", () => {
  it("the seam still names its subject when a file goes missing", () => {
    // **The seam control changed shape when the seam was filled** — the same
    // move `public-pages.test.ts` records for T2-402 and `share-delivery.
    // test.ts` for this task. It used to assert `requireSigner()` *throws*,
    // which is precisely the grader that must fail once the Edge Function
    // exists; leaving it would make a green suite impossible rather than
    // meaningful.
    //
    // What it still has to prove is the half that outlives the seam: that a
    // missing signer fails with a sentence naming the directory, not with an
    // `ENOENT` three frames deep — because every marked grader below reads
    // `signerSource()`, and a resolver that failed unhelpfully would turn one
    // deleted file into six unreadable failures.
    //
    // Both failure branches, against directories with a known answer: one that
    // does not exist, and one that exists and holds no source file (the
    // migrations directory is all `.sql`). The second is the branch a partial
    // deletion hits, and it had no control at all before.
    const absent = join(REPO_ROOT, "supabase", "no-such-directory");
    const empty = join(REPO_ROOT, "supabase", "migrations");

    expect(() => requireSigner(absent)).toThrow(SEAM_SHARE_GRANTS);
    expect(() => requireSigner(absent)).toThrow(RECEIPT_SIGNER_DIR);
    expect(() => requireSigner(empty)).toThrow(SEAM_SHARE_GRANTS);
    expect(() => requireSigner(empty)).toThrow("contains no source file");

    // The control on the two above: the real directory resolves. Without it,
    // both assertions are satisfied by a resolver that refuses everything.
    expect(requireSigner().length).toBeGreaterThan(0);
  });

  it("no Edge Function anywhere in the repo signs storage objects today", () => {
    // The sweep that stops a *second* signer appearing beside the graded one.
    // Every rule in this file is written about `RECEIPT_SIGNER_DIR`; a signer
    // somewhere else inherits none of them, and would be the obvious place to
    // put the caller-supplied path this file forbids.
    const functionsDir = join(REPO_ROOT, "supabase", "functions");
    const present = existsSync(functionsDir) ? readdirSync(functionsDir) : [];

    expect(present.filter((name) => name !== "sign-receipt")).toEqual([]);
  });

  it("the TTL window is a real range, and a short one", () => {
    // A guard on the contract, not on the implementation. A window somebody
    // widened to an hour "because the workshop wifi is bad" would make every
    // grader below pass while the leak it bounds got twelve times longer.
    expect(SIGNED_URL_TTL_SECONDS.min).toBe(60);
    expect(SIGNED_URL_TTL_SECONDS.max).toBe(300);
    expect(SIGNED_URL_TTL_SECONDS.max).toBeLessThanOrEqual(300);
  });
});

/* =========================================================================
 * Tier A — marked. The signer T2-404 ships.
 * ====================================================================== */

describe("the signer signs; it does not decide", () => {
  it(`ships an Edge Function at ${RECEIPT_SIGNER_DIR}`, () => {
    expect(requireSigner().length).toBeGreaterThan(0);
  });

  it("NEVER reads a path out of the request", () => {
    // The rule the whole split rests on. A signer that accepts
    // `{ token, path }` has turned Postgres's authorization into a suggestion:
    // the caller names the object, the signer signs it, and the bucket becomes
    // readable to anyone holding any live token.
    const source = signerSource();
    const offenders = [
      /\bbody\s*[.[]\s*["'`]?(?:path|storage_path|object|key|file)\b/,
      /\breq(?:uest)?\.\w*\bpath\b/,
      /searchParams\.get\(\s*["'`](?:path|object|key|file)["'`]/,
    ].filter((pattern) => pattern.test(source));

    expect(offenders.map(String)).toEqual([]);
  });

  it("asks the database to resolve the path", () => {
    // The other half of the same claim, positively: authorization stays in
    // Postgres where the graders reach it. A signer that queried
    // `storage.objects` directly, or read `public.receipts` itself, would have
    // re-implemented the access check outside every rule in `rules.ts`.
    const source = signerSource();

    expect(source).toContain(SHARE_READER_NAMES[2]);
    expect(source).not.toMatch(/from\s*\(\s*["'`]receipts["'`]\s*\)/);
  });

  it("signs inside the TTL ceiling and never above it", () => {
    // Every numeric literal handed to a sign call has to sit in the window. The
    // grader reads the literals rather than trusting a named constant, because
    // the defect is somebody passing `3600` at one call site.
    const source = signerSource();
    const expiries = [
      ...source.matchAll(/createSignedUrl\s*\([^)]*?,\s*(\d+)/g),
      ...source.matchAll(/expiresIn\s*[:=]\s*(\d+)/g),
    ].map((match) => Number(match[1]));

    expect(expiries.length).toBeGreaterThan(0);
    for (const seconds of expiries) {
      expect(seconds).toBeGreaterThanOrEqual(SIGNED_URL_TTL_SECONDS.min);
      expect(seconds).toBeLessThanOrEqual(SIGNED_URL_TTL_SECONDS.max);
    }
  });

  it("signs only in the receipts bucket", () => {
    // A signer that took the bucket from anywhere but a constant would be one
    // parameter away from signing `vehicle-photos` — a different bucket with a
    // different consent story (T2-301a).
    expect(signerSource()).toContain(`"${RECEIPTS_BUCKET}"`);
  });

  it("the edge runtime is switched on in config.toml", () => {
    // `[edge_runtime] enabled` is off today. Named here because it is the one
    // line that makes the whole surface exist, and because leaving it off would
    // make every behavioural grader below skip rather than fail — a silent pass
    // in the shape of an absence.
    expect(readSupabaseConfig()).toMatch(
      /\[edge_runtime\][\s\S]*?enabled\s*=\s*true/
    );
  });
});

/* =========================================================================
 * Tier B — behavioural. The matrix, and the two independence claims.
 * ====================================================================== */

describe.skipIf(!live.available)(
  liveTitle("the storage layer still refuses a stranger", live),
  () => {
    it("owner B cannot sign owner A's receipt — the floor everything rests on", async () => {
      // Unmarked, and true today: T2-202's storage policies already prove it,
      // and `storage-privacy.test.ts` grades the whole cross-user matrix. It is
      // restated here because the signer is about to become a *second* door to
      // the same bytes, and the value of this grader is that it says what the
      // first door does — so a regression in the signer cannot be mistaken for
      // a regression in storage.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const path = testReceiptPath(scenario.ownerA.userId ?? "", "1");
        await createOwnedFixture(scenario, scenario.ownerA, path);

        const stolen = await signObject(scenario, scenario.ownerB, path);

        expect(stolen.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("POSITIVE CONTROL: the owner CAN sign their own", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const path = testReceiptPath(scenario.ownerA.userId ?? "", "1");
        // The bytes have to be there: the storage API refuses to sign a path
        // with no object behind it, so a fixture that only created the database
        // row would make this control fail for a reason that has nothing to do
        // with ownership.
        await uploadObject(scenario, scenario.ownerA, path);
        await createOwnedFixture(scenario, scenario.ownerA, path);

        const signed = await signObject(scenario, scenario.ownerA, path);

        expect(signed.ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("a signed URL cannot be asked for a longer life than the ceiling", async () => {
      // Unmarked, and it is about the *storage API*, not the signer: whatever
      // the Edge Function does, the underlying endpoint accepts any
      // `expiresIn` a caller sends. So the ceiling can never be enforced by the
      // storage layer, which is exactly why it has to be enforced in the signer
      // — and why the Tier A literal check above is not belt-and-braces but the
      // only enforcement there is.
      //
      // Recorded as an observation rather than a requirement: this asserts what
      // the platform does, so that the next reader does not assume a limit that
      // is not there.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const path = testReceiptPath(scenario.ownerA.userId ?? "", "1");
        await uploadObject(scenario, scenario.ownerA, path);
        await createOwnedFixture(scenario, scenario.ownerA, path);

        const long = await signObject(
          scenario,
          scenario.ownerA,
          path,
          RECEIPTS_BUCKET,
          60 * 60 * 24 * 365
        );

        expect(long.ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle("the signer's three-cell ownership matrix", live),
  () => {
    /**
     * Ask the Edge Function to sign the receipt a grant resolves to.
     *
     * Sends **only** `{ token, receipt_id }`. There is no path parameter to
     * send, and that is the point: a helper that offered one as a matter of
     * course would be documenting the interface this whole file forbids. The
     * one grader that *does* send a path sends it explicitly, as an attack.
     */
    async function askSigner(
      scenario: Scenario,
      body: Record<string, unknown>
    ): Promise<{ ok: boolean; status: number; text: string }> {
      assertLocalTarget(scenario.stack.url);
      const response = await fetch(
        `${scenario.stack.url}/functions/v1/sign-receipt`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            apikey: scenario.anon.token,
            authorization: `Bearer ${scenario.anon.token}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        }
      );
      return {
        ok: response.ok,
        status: response.status,
        text: await response.text(),
      };
    }

    /**
     * Issue a grant on `vehicleId` as owner A.
     *
     * Delegates to `share-fixtures.ts` rather than building the payload here.
     * The first draft had its own copy and the two drifted into incompatible
     * argument names — which PostgREST resolves to *no function at all*, so the
     * revocation cell below revoked nothing (T2-401 review, F3).
     */
    function grantOn(
      scenario: Scenario,
      vehicleId: string,
      includesCosts: boolean,
      includesReceipts: boolean
    ): Promise<IssuedGrant> {
      return issueGrant(scenario, scenario.ownerA, vehicleId, {
        includesCosts,
        includesReceipts,
      });
    }

    /**
     * A vehicle -> record -> receipt chain **with the bytes uploaded**.
     *
     * The upload is the point (T2-401 review, F5). `createOwnedFixture` writes
     * the database rows only, and the storage API refuses to sign a path with
     * no object behind it — so three success cells here would have failed for a
     * fixture reason the day T2-404 activated them, on exactly the assertions
     * meant to prove the signer works. The unmarked control in the previous
     * block documents that behaviour; these fixtures now honour it.
     */
    async function uploadedFixture(
      scenario: Scenario,
      owner: Scenario["ownerA"],
      slot: string
    ) {
      const path = testReceiptPath(owner.userId ?? "", slot);
      await uploadObject(scenario, owner, path);
      return createOwnedFixture(scenario, owner, path);
    }

    it("signs a receipt on the granted vehicle", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const owned = await uploadedFixture(scenario, scenario.ownerA, "1");
        const grant = await grantOn(scenario, owned.vehicleId, false, true);

        const signed = await askSigner(scenario, {
          token: grant.token,
          receipt_id: owned.receiptId,
        });

        expect(signed.ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("REFUSES a receipt on another vehicle of the SAME owner", async () => {
      // The cell that gets built wrong. A resolver that goes token → owner →
      // receipts returns exactly the right answer for an owner with one truck,
      // which is the only case anybody hand-tests — and hands over the second
      // truck's invoices the day the owner buys one.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const granted = await uploadedFixture(scenario, scenario.ownerA, "1");
        const other = await uploadedFixture(scenario, scenario.ownerA, "2");
        const grant = await grantOn(scenario, granted.vehicleId, false, true);

        const signed = await askSigner(scenario, {
          token: grant.token,
          receipt_id: other.receiptId,
        });

        expect(signed.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("REFUSES a receipt on another owner's vehicle", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const mine = await uploadedFixture(scenario, scenario.ownerA, "1");
        const theirs = await uploadedFixture(scenario, scenario.ownerB, "1");
        const grant = await grantOn(scenario, mine.vehicleId, false, true);

        const signed = await askSigner(scenario, {
          token: grant.token,
          receipt_id: theirs.receiptId,
        });

        expect(signed.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("REFUSES once the grant is revoked, on the next request", async () => {
      // SHR-08's "takes effect on the next request", applied to issuance. A
      // signature already minted cannot be recalled — that is what the TTL
      // ceiling is for — but no *new* one may be issued after revocation.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const owned = await uploadedFixture(scenario, scenario.ownerA, "1");
        const grant = await grantOn(scenario, owned.vehicleId, false, true);

        const before = await askSigner(scenario, {
          token: grant.token,
          receipt_id: owned.receiptId,
        });
        expect(before.ok).toBe(true);

        const cut = await revokeGrant(scenario, scenario.ownerA, grant.shareId);
        expect(cut.ok).toBe(true);

        const after = await askSigner(scenario, {
          token: grant.token,
          receipt_id: owned.receiptId,
        });
        expect(after.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("REFUSES when includes_receipts is false, EVEN IF includes_costs is true", async () => {
      // SHR-06's independence, in the direction that is easy to get wrong: a
      // signer that reads "this grant opens costs" as "this grant opens the
      // financial stuff" hands over the scans as well.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const owned = await uploadedFixture(scenario, scenario.ownerA, "1");
        const grant = await grantOn(scenario, owned.vehicleId, true, false);

        const signed = await askSigner(scenario, {
          token: grant.token,
          receipt_id: owned.receiptId,
        });

        expect(signed.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("SIGNS when includes_receipts is true and includes_costs is FALSE", async () => {
      // The mirror image, and the positive control for the cell above.
      // Without it, "receipts refused" is satisfied by a signer that refuses
      // everything.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const owned = await uploadedFixture(scenario, scenario.ownerA, "1");
        const grant = await grantOn(scenario, owned.vehicleId, false, true);

        const signed = await askSigner(scenario, {
          token: grant.token,
          receipt_id: owned.receiptId,
        });

        expect(signed.ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("ignores a caller-supplied path entirely", async () => {
      // The behavioural half of the Tier A rule. Sending a path IS the attack;
      // the correct answer is that it changes nothing — the signer signs what
      // Postgres resolved for `receipt_id`, or it refuses.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const mine = await uploadedFixture(scenario, scenario.ownerA, "1");
        const theirs = await uploadedFixture(scenario, scenario.ownerB, "1");
        const grant = await grantOn(scenario, mine.vehicleId, false, true);

        const signed = await askSigner(scenario, {
          token: grant.token,
          receipt_id: mine.receiptId,
          path: theirs.storagePath,
          storage_path: theirs.storagePath,
        });

        expect(signed.ok).toBe(true);
        expect(signed.text).not.toContain(theirs.storagePath);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);
