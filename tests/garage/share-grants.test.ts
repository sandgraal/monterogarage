/**
 * Graders — **typed share grants, SHR-05..09.** Declared by T2-401 [TEST],
 * activated by T2-404 [PLATFORM].
 *
 * `share-instrument.test.ts` (T2-401a) grades the *shape* of the anon function
 * surface: definer, `search_path`, hash-not-plaintext, expiry, revocation,
 * column projection, read-only. This file grades what a grant **means**:
 *
 * | requirement | the claim | where |
 * |---|---|---|
 * | SHR-05 | the preset is a label, never a branch | Tier A, `presetBranchIssues` |
 * | SHR-06 | costs and receipts open independently | Tier A + the four-cell matrix |
 * | SHR-06 | cost fields are **omitted**, not blanked | Tier B, key absence |
 * | SHR-07 | the accountless path is read-only | Tier A + Tier B |
 * | SHR-08 | unknown / expired / revoked are indistinguishable | Tier B, three-way |
 * | SHR-08 | revocation is immediate and ungated | Tier A + Tier B |
 * | SHR-09 | a grant never makes a record community-eligible | Tier A sweep + `public-pages.test.ts` |
 *
 * ## Why SHR-08's refusal is graded twice, differently
 *
 * "Same status, same body, same shape" is a statement about responses on a
 * wire. No amount of reading SQL proves it, and T2-401a's hand-off said so when
 * it handed the job here: pair a Tier A **smell check** — more than one refusal
 * message, or refusal text naming which case it hit — with the real
 * behavioural proof, *never* substitute one for the other. Both are below, and
 * the Tier A one describes itself as a smell check in its own name.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker. T2-404 activates a grader by deleting exactly that
 * `.fails` and nothing else. Everything marked here resolves its subject
 * through `requireGrantRoutine`, so it fails with `not implemented: T2-404`
 * rather than with `undefined is not an object` — a marker that cannot say what
 * it is waiting for is a marker that means nothing.
 *
 * refs specs/002-montero-garage (SHR-05, SHR-06, SHR-07, SHR-08, SHR-09,
 * GAR-04′), 003 (MON-02, MEC-01)
 */
import { describe, expect, it } from "vitest";
import {
  CONTRACT_SCHEMA,
  SHARE_CAPABILITY_COLUMNS,
  SHARE_CREATE_ARGUMENTS,
  SHARE_CREATE_FUNCTION,
  SHARE_CREATE_RESULT_FIELDS,
  SHARE_GRANT_KINDS,
  SHARE_READER_NAMES,
  SHARE_REVOKE_ARGUMENTS,
  SHARE_REVOKE_FUNCTION,
  testReceiptPath,
  testShareToken,
} from "./contract.ts";
import {
  createOwnedFixture,
  detectLiveStack,
  insertRow,
  liveTitle,
  provisionScenario,
  rpc,
  selectRows,
  stackOf,
  teardownScenario,
  updateRows,
  type ApiResponse,
  type Scenario,
} from "./harness.ts";
import { issueGrant, refusalShape, revokeGrant } from "./share-fixtures.ts";
import {
  anonExecutableFunctions,
  capabilityGateIssues,
  defaultPrivilegeGrantIssues,
  isAnonExecutable,
  presetBranchIssues,
  refusalShapeIssues,
  revocationGatingIssues,
} from "./rules.ts";
import {
  functions,
  grants,
  migrationSql,
  shareSeam,
  type FunctionDefinition,
} from "./sql.ts";

const live = await detectLiveStack();

/**
 * Every routine in the contract's schema bearing `name`, or the seam error.
 *
 * By schema **and** name (`CONTRACT_SCHEMA`), for the reason PR #74's review
 * gave: a `private.share_read_records` is a different function with a different
 * ACL, and a comparison on the bare name cannot tell them apart.
 */
function requireGrantRoutine(
  name: string,
  normalized: string = migrationSql()
): FunctionDefinition[] {
  const found = functions(normalized).filter(
    (routine) => routine.schema === CONTRACT_SCHEMA && routine.name === name
  );
  if (found.length === 0) {
    throw shareSeam(
      `no function named ${CONTRACT_SCHEMA}.${name} exists in supabase/migrations/`
    );
  }
  return found;
}

/** Every anon-reachable routine, or the seam error if there are none. */
function requireAnonSurface(
  normalized: string = migrationSql()
): FunctionDefinition[] {
  const found = anonExecutableFunctions(normalized);
  if (found.length === 0) {
    throw shareSeam("no routine is executable by an anonymous caller");
  }
  return found;
}

/* =========================================================================
 * Tier A — unmarked. Assertions about the migrations as they stand.
 * ====================================================================== */

describe("no line hands FUTURE objects to an anonymous caller", () => {
  it("never grants default privileges to anon or public", () => {
    // T2-401a's recorded hand-off, F5. `grants()` has always replayed the
    // `alter default privileges` records and the graders only ever read the
    // *revoke* half. The grant half is the one privilege change that leaves no
    // trace on any object that exists today — so the created-table sweep and
    // the function sweep are both structurally blind to it, and it would take
    // effect on `shares` the moment T2-404 created it.
    //
    // `live-acl.test.ts`'s birth probe asks the same question of the running
    // database. This half runs on every PR with no Docker.
    expect(defaultPrivilegeGrantIssues(migrationSql())).toEqual([]);
  });

  it("the ADP replay sees something, so the sweep is not vacuous", () => {
    // T2-202 writes seven `alter default privileges … revoke` statements. If
    // the parser stopped finding them, the grader above would report clean
    // against a file it had failed to read — the exact vacuity this directory
    // exists to refuse.
    const records = grants(migrationSql()).defaultPrivileges;

    expect(records.length).toBeGreaterThanOrEqual(7);
    expect(records.every((record) => record.action === "revoke")).toBe(true);
  });
});

describe("SHR-09: nothing in the schema lets a grant surface a record", () => {
  it("no anon-reachable routine reads a vehicle's public work-log flag", () => {
    // > **SHR-09** A grant SHALL NOT make a record eligible for the community
    // > evidence surfacing of GAR-04′.
    //
    // The two paths must not meet in SQL: the grant readers key on a token, and
    // GAR-04′ keys on `is_worklog_public`. A routine that reads both is a
    // routine that can conflate them, and the conflation puts a private
    // work-log on a public problem page — which "will look like a feature
    // working correctly right up until someone notices" (T2-403's scope guard).
    //
    // Vacuous today (nothing is anon-reachable) and pinned as such by the
    // marked completeness half in `share-instrument.test.ts`. It starts paying
    // the day T2-404 lands, which is the point of landing it first.
    const offenders = anonExecutableFunctions(migrationSql())
      .filter((routine) =>
        /\bis_worklog_public\b|\bis_showcase_public\b/.test(routine.body)
      )
      .map((routine) => routine.identity);

    expect(offenders).toEqual([]);
  });
});

/* =========================================================================
 * Tier A — marked. The grant surface T2-404 ships.
 * ====================================================================== */

describe("the grant lifecycle RPCs (SHR-05, SHR-08)", () => {
  it(`ships ${CONTRACT_SCHEMA}.${SHARE_CREATE_FUNCTION}`, () => {
    expect(requireGrantRoutine(SHARE_CREATE_FUNCTION)).toHaveLength(1);
  });

  it(`ships ${CONTRACT_SCHEMA}.${SHARE_REVOKE_FUNCTION}`, () => {
    expect(requireGrantRoutine(SHARE_REVOKE_FUNCTION)).toHaveLength(1);
  });

  it("neither lifecycle RPC is reachable without a session", () => {
    // SHR-07 makes the accountless path read-only. Issuing and revoking are
    // writes, and they are the owner's writes: an anonymous caller able to mint
    // a grant is an anonymous caller able to grant themselves one.
    const state = grants(migrationSql());
    const reachable = [SHARE_CREATE_FUNCTION, SHARE_REVOKE_FUNCTION]
      .flatMap((name) => requireGrantRoutine(name))
      .filter((routine) => isAnonExecutable(state, routine))
      .map((routine) => routine.identity);

    expect(reachable).toEqual([]);
  });

  it("revocation consults nothing but the caller's ownership", () => {
    // > SHALL never be gated by payment, by plan, or by any other condition
    // > — SHR-08, restated as 003 MON-02
    //
    // A deny-list rather than an allow-list, because "any other condition" is
    // the load-bearing phrase: once 003's subscriptions table exists, joining
    // it here is one line and reads like prudence.
    expect(
      requireGrantRoutine(SHARE_REVOKE_FUNCTION).flatMap(revocationGatingIssues)
    ).toEqual([]);
  });

  it.fails(
    "both lifecycle RPCs take the argument names the graders send",
    () => {
      // ## T2-401 review, F3 — the argument list is contract, not detail
      //
      // PostgREST resolves an RPC overload **by argument name**. A call whose
      // names match no function resolves to nothing and answers in a way a
      // grader reading `response.ok` cannot tell from a refusal — so a revoke
      // with the wrong parameter name revokes nothing, silently, and the SHR-08
      // proof then compares a *live* grant against two refusals and fails for a
      // fixture reason. That is the failure shape that gets an assertion
      // loosened instead of fixed.
      //
      // So the names are pinned, and `share-fixtures.ts` builds every payload
      // from the same lists. If T2-404 wants different names, this line and
      // `contract.ts` move together and every call site follows.
      const [create] = requireGrantRoutine(SHARE_CREATE_FUNCTION);
      const [revoke] = requireGrantRoutine(SHARE_REVOKE_FUNCTION);

      for (const name of SHARE_CREATE_ARGUMENTS) {
        expect(
          create.header,
          `${SHARE_CREATE_FUNCTION} is missing ${name}`
        ).toContain(name);
      }
      for (const name of SHARE_REVOKE_ARGUMENTS) {
        expect(
          revoke.header,
          `${SHARE_REVOKE_FUNCTION} is missing ${name}`
        ).toContain(name);
      }
    }
  );

  it.fails("revocation is per-GRANT, not per-vehicle (SHR-08)", () => {
    // > Every grant SHALL be revocable **by its issuer** at any time.
    //
    // A grant, not a truck. An owner who issued one link to their mechanic and
    // another to a buyer must be able to end one without ending the other, and
    // `revoke_share_grant(p_vehicle_id)` cannot express that. Graded as the
    // *absence* of a vehicle parameter, because a signature taking both is a
    // signature where the wrong one gets passed.
    const [revoke] = requireGrantRoutine(SHARE_REVOKE_FUNCTION);

    expect(revoke.header).toContain("p_share_id");
    expect(revoke.header).not.toContain("p_vehicle_id");
  });

  it("the create RPC hands back the grant's id beside its token", () => {
    // The consequence of pinning revocation to an id: the issuer has to be
    // given one. A token is a secret the owner copies once and cannot be asked
    // to keep; an id is how they manage what they issued.
    const [create] = requireGrantRoutine(SHARE_CREATE_FUNCTION);

    for (const field of SHARE_CREATE_RESULT_FIELDS) {
      expect(
        `${create.returns} ${create.body}`,
        `${SHARE_CREATE_FUNCTION} never returns ${field}`
      ).toContain(field);
    }
  });

  it("the create RPC returns the token ONCE and stores only its hash", () => {
    // The token is 256 bits the owner has to be able to copy. It exists in
    // plaintext for exactly one response and never again — so the create RPC is
    // the only routine in the schema allowed to emit it, and the row it writes
    // must carry the digest.
    const [create] = requireGrantRoutine(SHARE_CREATE_FUNCTION);

    expect(create.body).toMatch(/gen_random_bytes\s*\(\s*32\s*\)/);
    expect(create.body).toMatch(/digest\s*\(/);
    expect(create.body).not.toMatch(/insert[\s\S]*\btoken\b\s*[,)]/);
  });
});

describe("SHR-05: the preset is a label, never a branch", () => {
  it("no anon-reachable routine branches on the grant's `kind`", () => {
    // "the preset SHALL be a label over explicit capability fields, never a
    // branch in consuming code". A reader that says `if kind = 'mechanic'` has
    // made the label load-bearing and the capability columns decorative — and a
    // grant whose columns and label disagree then resolves to whatever the
    // branch decided.
    expect(requireAnonSurface().flatMap(presetBranchIssues)).toEqual([]);
  });

  it("the create RPC constrains `kind` to the two named presets", () => {
    // The closed set, in the style of `records.kind`. A free-text preset makes
    // the label unusable for the one thing it is for — telling the owner, and
    // the holder, what this grant was meant to be.
    const sql = migrationSql();

    expect(requireGrantRoutine(SHARE_CREATE_FUNCTION)).toHaveLength(1);
    for (const preset of SHARE_GRANT_KINDS) {
      expect(sql).toContain(`'${preset}'`);
    }
    expect(sql).toMatch(
      /check \([^)]*kind[^)]*\)|create (?:type|domain) (?:[a-z_]+\.)?[a-z_]*(?:share_)?kind\b/
    );
  });
});

describe("SHR-06: costs and receipts are two decisions", () => {
  it("every anon-reachable routine gates the data it returns", () => {
    // A routine returning cost columns must test `includes_costs`; one
    // returning receipt data must test `includes_receipts`; and neither may
    // stand behind the other.
    //
    // The rule is narrow on purpose. The half it cannot reach — a fully-named
    // `jsonb_build_object` that includes the cost columns is textually
    // identical to legitimate projection — is why T2-404's reviewer is told to
    // verify capability scoping **by reading**, and why the four-cell matrix
    // below exists in Tier B.
    expect(requireAnonSurface().flatMap(capabilityGateIssues)).toEqual([]);
  });

  it("the two capability columns are separately named in the schema", () => {
    const sql = migrationSql();

    for (const column of SHARE_CAPABILITY_COLUMNS) {
      expect(sql, `${column} is not declared`).toContain(column);
    }
  });
});

describe("SHR-08: the refusal is not an existence oracle (SMELL CHECK)", () => {
  it("no anon-reachable routine raises more than one refusal", () => {
    // **This does not prove SHR-08.** Indistinguishability is a property of
    // responses on a wire; the proof is the three-way Tier B comparison below.
    // What this catches, on every PR with no Docker, is the likeliest way to
    // get it wrong: a helpful error message that names which of unknown,
    // expired, and revoked the caller hit.
    expect(requireAnonSurface().flatMap(refusalShapeIssues)).toEqual([]);
  });
});

/* =========================================================================
 * Tier B — behavioural. The half that can actually prove SHR-08.
 *
 * Every grant is issued and revoked through `share-fixtures.ts`, which builds
 * its payloads from `contract.ts`'s pinned argument lists. That is not tidiness
 * — see F3 in that file's header: PostgREST resolves RPC overloads by argument
 * name, so a call with the wrong names revokes nothing and returns something
 * indistinguishable from a refusal, which would have made the SHR-08 proof
 * below fail for a fixture reason on the one grader that matters most.
 * ====================================================================== */

/** One vehicle owned by owner A, created through the API as that owner. */
async function ownedVehicle(
  scenario: Scenario,
  slot = "1"
): Promise<{ readonly vehicleId: string }> {
  const owned = await createOwnedFixture(
    scenario,
    scenario.ownerA,
    testReceiptPath(scenario.ownerA.userId ?? "", slot)
  );
  return { vehicleId: owned.vehicleId };
}

/** Read a vehicle's history as an accountless holder of `token`. */
function readAsHolder(
  scenario: Scenario,
  token: string,
  reader: string = SHARE_READER_NAMES[1]
): Promise<ApiResponse> {
  return rpc(scenario, scenario.anon, reader, { p_token: token });
}

describe.skipIf(!live.available)(
  liveTitle("SHR-08: unknown, expired, and revoked are one answer", live),
  () => {
    it("all three refusals are byte-for-byte identical", async () => {
      // The requirement, run. "Same status, same body, same shape — so that the
      // surface is not an existence oracle."
      //
      // Compared as a triple in one grader rather than three graders comparing
      // against a constant, because the property is *equality between the
      // three*, not conformance of each to some expected refusal. An
      // implementation that changed all three together is still correct.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId } = await ownedVehicle(scenario);

        const revoked = await issueGrant(scenario, scenario.ownerA, vehicleId);
        const cut = await revokeGrant(
          scenario,
          scenario.ownerA,
          revoked.shareId
        );
        // Asserted, not assumed. A revoke that silently did nothing would make
        // the "revoked" arm of this comparison a *live* grant, and the grader
        // would fail for a fixture reason on the one property it exists for.
        expect(cut.ok).toBe(true);

        const expired = await issueGrant(scenario, scenario.ownerA, vehicleId, {
          expiresInHours: -1,
        });

        const shapes = [
          refusalShape(
            await readAsHolder(scenario, testShareToken("x", scenario.runId))
          ),
          refusalShape(await readAsHolder(scenario, expired.token)),
          refusalShape(await readAsHolder(scenario, revoked.token)),
        ];

        expect(shapes[1]).toEqual(shapes[0]);
        expect(shapes[2]).toEqual(shapes[0]);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("POSITIVE CONTROL: a live grant answers DIFFERENTLY", async () => {
      // Without this, "the three refusals match" is satisfied by a surface that
      // refuses everything — including the grant just issued — which would be a
      // broken feature reported as a secure one.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId } = await ownedVehicle(scenario);
        const grant = await issueGrant(scenario, scenario.ownerA, vehicleId);

        const allowed = await readAsHolder(scenario, grant.token);
        const refused = await readAsHolder(
          scenario,
          testShareToken("x", scenario.runId)
        );

        expect(allowed.ok).toBe(true);
        expect(refusalShape(allowed)).not.toEqual(refusalShape(refused));
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("revocation takes effect on the NEXT request", async () => {
      // "SHALL take effect on the next request". The likeliest defect in the
      // whole feature is a reader that validates the hash and the expiry and
      // never reads `revoked_at` — and it passes every hand-test, because a
      // grant you have not revoked behaves identically either way.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId } = await ownedVehicle(scenario);
        const grant = await issueGrant(scenario, scenario.ownerA, vehicleId);

        const before = await readAsHolder(scenario, grant.token);
        expect(before.ok).toBe(true);

        const cut = await revokeGrant(scenario, scenario.ownerA, grant.shareId);
        expect(cut.ok).toBe(true);

        const after = await readAsHolder(scenario, grant.token);
        expect(after.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("revoking ONE grant leaves the owner's other grant alive", async () => {
      // SHR-08 is per-grant: "revocable by its issuer at any time" is about a
      // grant, not about a truck. An owner who gave their mechanic a link in
      // March and a buyer a link in June must be able to end one without ending
      // the other — and a `revoke_share_grant(p_vehicle_id)` cannot express
      // that, which is why `contract.ts` pins the id signature.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId } = await ownedVehicle(scenario);
        const first = await issueGrant(scenario, scenario.ownerA, vehicleId);
        const second = await issueGrant(scenario, scenario.ownerA, vehicleId, {
          kind: SHARE_GRANT_KINDS[1],
        });

        await revokeGrant(scenario, scenario.ownerA, first.shareId);

        expect((await readAsHolder(scenario, first.token)).ok).toBe(false);
        expect((await readAsHolder(scenario, second.token)).ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle("SHR-06: the four-cell capability matrix", live),
  () => {
    it.each<[boolean, boolean]>([
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ])(
      "costs=%s receipts=%s — each field appears only when its own bit is set",
      async (includesCosts, includesReceipts) => {
        // The cell that matters most is `costs=false receipts=true`: it is the
        // one a single "full access" boolean cannot express, and the one a
        // reader that gates receipts behind costs gets wrong.
        //
        // **Omission, not blanking.** SHR-06 says the cost fields are omitted
        // *entirely* where the grant does not open them, so the assertion is
        // about key presence and not about the value being null. `null` is a
        // value that means "this job was free"; the absent key is the only
        // honest way to say "you were not shown this".
        const scenario = await provisionScenario(stackOf(live));
        try {
          const { vehicleId } = await ownedVehicle(scenario);
          const grant = await issueGrant(scenario, scenario.ownerA, vehicleId, {
            includesCosts,
            includesReceipts,
          });

          const history = await readAsHolder(scenario, grant.token);
          const rows = Array.isArray(history.body) ? history.body : [];

          // The fixture put exactly one record on this vehicle. Asserting the
          // shape before reading a key out of it is what stops the cost
          // assertion below being made against `{}` — an empty read would
          // satisfy `hasOwn(...) === false` and look like correct omission.
          expect(history.ok).toBe(true);
          expect(rows).toHaveLength(1);

          const row = rows[0] as Record<string, unknown>;
          expect(Object.hasOwn(row, "cost_amount")).toBe(includesCosts);

          const receipts = await readAsHolder(
            scenario,
            grant.token,
            SHARE_READER_NAMES[2]
          );
          const receiptRows = Array.isArray(receipts.body) ? receipts.body : [];

          // ## `ok` alone cannot tell working from broken (second review)
          //
          // A receipts reader that gates itself behind `includes_costs` as well
          // returns **HTTP 200 with `[]`** for a `costs=false receipts=true`
          // grant — the cell these files call the one that matters most — and
          // `ok === true` is perfectly satisfied by it. The grader would have
          // passed against precisely the defect it exists to catch.
          //
          // So the open case asserts rows came back, not merely that nothing
          // errored. The fixture uploads one receipt, so the count is known.
          expect(receipts.ok).toBe(includesReceipts);
          if (includesReceipts) {
            expect(receiptRows.length).toBeGreaterThan(0);

            // `receipts.ok` and the row count above are satisfied by a reader
            // that returns every receipt row with `amount`/`currency` always
            // attached — the exact regression the migration's own comments
            // (T2-404 review, F1) name and fix: those two fields are the
            // grant's *cost* decision, not its *receipt* decision, and stay
            // gated on `includesCosts` even in this cell, where receipts are
            // open. `createOwnedFixture` puts a non-null `amount` (123.45) on
            // the one receipt this vehicle has, so `hasOwn` below is a real
            // presence check, not one an empty or null field would pass by
            // accident.
            const receiptRow = receiptRows[0] as Record<string, unknown>;
            expect(Object.hasOwn(receiptRow, "amount")).toBe(includesCosts);
            expect(Object.hasOwn(receiptRow, "currency")).toBe(includesCosts);
          } else {
            expect(receiptRows).toHaveLength(0);
          }
        } finally {
          await teardownScenario(scenario);
        }
      }
    );

    it("a grant reaches ONE vehicle, not the owner's garage", async () => {
      // A grant is issued per vehicle (SHR-05). An owner with two trucks who
      // hands a mechanic a link to one has not handed over the other, and the
      // failure mode — a reader that resolves the token to an *owner* and then
      // reads that owner's records — returns exactly the right data for the
      // single-vehicle case that everybody tests by hand.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const first = await ownedVehicle(scenario, "1");
        const second = await ownedVehicle(scenario, "2");
        const grant = await issueGrant(
          scenario,
          scenario.ownerA,
          first.vehicleId
        );

        const history = await readAsHolder(scenario, grant.token);
        const rows = Array.isArray(history.body) ? history.body : [];

        expect(history.ok).toBe(true);
        expect(history.text).not.toContain(second.vehicleId);
        for (const row of rows as Record<string, unknown>[]) {
          expect(row.vehicle_id).toBe(first.vehicleId);
        }
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle("SHR-07: the accountless path is read-only", live),
  () => {
    it("a holder with no session cannot INSERT a record", async () => {
      // "WHILE a request carries no authenticated session, no grant SHALL admit
      // any write." Graded over the **table**, because the requirement is about
      // the path: whatever a token buys, it does not buy a row.
      //
      // ## T2-401 review, F4
      //
      // The first draft called `rpc(scenario, scenario.anon, "records", …)` —
      // an RPC to a stored procedure literally named `records`, which does not
      // exist and never will, so it 404s and `ok === false` forever regardless
      // of what RLS does. Unfalsifiable: the grader could not have caught the
      // defect it was written for. It hits `/rest/v1/records` now.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId } = await ownedVehicle(scenario);
        const grant = await issueGrant(scenario, scenario.ownerA, vehicleId, {
          includesCosts: true,
          includesReceipts: true,
        });
        expect(grant.token).toBeTruthy();

        const written = await insertRow(scenario, scenario.anon, "records", {
          vehicle_id: vehicleId,
          occurred_on: "2026-08-30",
          kind: "note",
        });

        expect(written.ok).toBe(false);
        expect(written.status).toBeGreaterThanOrEqual(400);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("a holder with no session cannot UPDATE a record", async () => {
      // The other verb, and the more tempting one: a mechanic "correcting" an
      // odometer reading is the exact feature 003's propose-and-accept exists
      // to provide *with* an account and an owner's acceptance (PRO-02, PRO-03).
      const scenario = await provisionScenario(stackOf(live));
      try {
        const owned = await createOwnedFixture(
          scenario,
          scenario.ownerA,
          testReceiptPath(scenario.ownerA.userId ?? "", "1")
        );
        const grant = await issueGrant(
          scenario,
          scenario.ownerA,
          owned.vehicleId,
          { includesCosts: true, includesReceipts: true }
        );
        expect(grant.token).toBeTruthy();

        const written = await updateRows(
          scenario,
          scenario.anon,
          "records",
          `id=eq.${owned.recordId}`,
          { odometer_km: 999_999 }
        );

        expect(written.ok).toBe(false);

        // And the row is untouched — a PostgREST update that matches no row
        // under RLS returns 2xx with an empty body on some configurations, so
        // "the response was not ok" is not on its own a statement about data.
        const readBack = await selectRows(
          scenario,
          scenario.ownerA,
          "records",
          `id=eq.${owned.recordId}`
        );
        const rows = Array.isArray(readBack.body) ? readBack.body : [];

        // ## The read-back has to be known-good before it proves anything
        //
        // Second review: without these two lines the assertion below is
        // **vacuously passable**. A failed read leaves `rows` as `[]`,
        // `rows[0]` is `undefined`, the optional chain yields `undefined`, and
        // `undefined).not.toBe(999_999)` is trivially true — so a check that
        // could not run reports as a check that passed.
        //
        // This is the same unknown-coalesced-to-zero mistake AGENTS.md names,
        // and `share-fixtures.ts`'s `refusalShape` uses a `-1` sentinel
        // specifically to avoid it. Got it right there, missed it here.
        expect(readBack.ok).toBe(true);
        expect(rows).toHaveLength(1);
        expect((rows[0] as { odometer_km?: number }).odometer_km).not.toBe(
          999_999
        );
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("a holder cannot issue a grant of their own", async () => {
      // The escalation. A grant that can mint a grant is a grant with no
      // expiry, whatever its `expires_at` says.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId } = await ownedVehicle(scenario);
        await issueGrant(scenario, scenario.ownerA, vehicleId);

        const minted = await rpc(
          scenario,
          scenario.anon,
          SHARE_CREATE_FUNCTION,
          Object.fromEntries(
            SHARE_CREATE_ARGUMENTS.map((name) => [
              name,
              name === "p_vehicle_id" ? vehicleId : null,
            ])
          )
        );

        expect(minted.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("owner B cannot revoke owner A's grant", async () => {
      // Revocation is ungated (SHR-08) but it is not unowned. The two are easy
      // to conflate while implementing the first one.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId } = await ownedVehicle(scenario);
        const grant = await issueGrant(scenario, scenario.ownerA, vehicleId);

        const stolen = await revokeGrant(
          scenario,
          scenario.ownerB,
          grant.shareId
        );
        const stillWorks = await readAsHolder(scenario, grant.token);

        expect(stolen.ok).toBe(false);
        expect(stillWorks.ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);
