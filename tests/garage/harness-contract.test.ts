/**
 * The T2-201 harness, graded against itself. **Nothing here is marked.**
 *
 * Every other file in `tests/garage/` is either an `it.fails` expectation
 * about T2-202 or a suite that skips when no local Supabase stack is running.
 * Both of those are green today, and both would stay green if the harness
 * underneath them quietly broke — a regex that matches nothing reports
 * "expected failure" in exactly the same words as a real unmet requirement,
 * and a skip predicate stuck on `false` reports "skipped" forever.
 *
 * So this file is the positive control for the instrument. It grades:
 *
 * - the **local-only guard**, against a table that includes real Supabase
 *   hosts and this site's own domain — the guard is what makes "no production
 *   credential" structural rather than aspirational;
 * - the **SQL tooling**, against hand-written DDL with a known answer, both
 *   the accepting and the rejecting side of every extractor;
 * - **JWT minting**, so the three actors are actually three different actors;
 * - the **skip decision**, including the fail-closed flag that turns a missing
 *   stack into an error the day CI can run one.
 *
 * This file never gets deleted. `seam-canary.test.ts` is the part T2-202
 * removes.
 *
 * refs specs/002-montero-garage (ACC-01, ACC-03, SHR-01, GAR-05′, MIG-03)
 */
import { describe, expect, it } from "vitest";
import {
  GRANT_EXPIRY_COLUMN,
  GRANT_REVOCATION_COLUMN,
  UNSHIPPED_USER_TABLES,
  PLAINTEXT_TOKEN_COLUMNS,
  SHARE_CAPABILITY_COLUMNS,
  SHARE_FLAG_COLUMNS,
  SHARE_GRANT_KINDS,
  SHARE_TOKEN_HASH_COLUMN,
  SHIPPED_USER_TABLES,
  USER_TABLES,
  USER_TABLE_NAMES,
  testEmail,
  testReceiptPath,
  testVehicleName,
} from "./contract.ts";
import {
  ALLOWED_LIVE_HOSTS,
  NON_LOCAL_TARGET,
  SKIP_REASONS,
  assertLocalTarget,
  decodeJwtPayload,
  detectLiveStack,
  FINGERPRINT_PROBE_ROLE,
  liveDecisionFrom,
  liveTitle,
  mintJwt,
  projectFingerprintIssue,
} from "./harness.ts";
import {
  columnDefinition,
  columnDefinitions,
  createTableBody,
  defaultExpression,
  enablesRls,
  foreignKey,
  forcesRls,
  normalizeSql,
  policies,
  statements,
  tableItems,
} from "./sql.ts";

/* -------------------------------------------------------------------------
 * The local-only guard
 * ---------------------------------------------------------------------- */

describe("assertLocalTarget — the harness cannot address a real database", () => {
  it.each(
    ALLOWED_LIVE_HOSTS.map(
      (host) => [host, `http://${host}:54321`] as [string, string]
    )
  )("accepts the loopback host %s", (_host, url) => {
    expect(() => assertLocalTarget(url)).not.toThrow();
  });

  it.each<[string, string]>([
    ["a hosted Supabase project", "https://abcdefghijklm.supabase.co"],
    ["the Supabase API domain", "https://api.supabase.com"],
    ["this site in production", "https://monterogarage.com"],
    ["a preview deployment", "https://monterogarage-abc123.vercel.app"],
    ["a private-range host", "http://10.0.0.5:54321"],
    ["a host that merely starts local", "http://localhost.evil.example"],
    ["a host that merely ends local", "http://notlocalhost"],
    ["an IP that merely starts 127", "http://127.0.0.1.evil.example"],
  ])("refuses %s", (_label, url) => {
    expect(() => assertLocalTarget(url)).toThrow(NON_LOCAL_TARGET);
  });

  it("refuses something that is not a URL at all", () => {
    expect(() => assertLocalTarget("not a url")).toThrow(NON_LOCAL_TARGET);
  });

  it("names the constitutional reason in the refusal, not just a code", () => {
    // A guard that fails with "invalid host" teaches the next reader to add
    // their host to the list. This one has to say why the list is short.
    expect(() => assertLocalTarget("https://x.supabase.co")).toThrow(
      /never a production credential/
    );
  });
});

/* -------------------------------------------------------------------------
 * The skip decision
 * ---------------------------------------------------------------------- */

describe("detectLiveStack — skips are named, and can be made fatal", () => {
  it("skips with a reason when nobody asked for the live tier", async () => {
    const decision = await detectLiveStack({});

    expect(decision.available).toBe(false);
    expect(decision.available === false && decision.reason).toBe(
      SKIP_REASONS.notEnabled
    );
  });

  it("tells the reader how to run it, in the reason itself", () => {
    expect(SKIP_REASONS.notEnabled).toContain("supabase start");
    expect(SKIP_REASONS.notEnabled).toContain("GARAGE_LIVE=1");
  });

  it("refuses a non-loopback SUPABASE_URL instead of skipping quietly", async () => {
    const decision = await detectLiveStack({
      GARAGE_LIVE: "1",
      SUPABASE_URL: "https://abcdefghijklm.supabase.co",
    });

    expect(decision.available).toBe(false);
    expect(decision.available === false && decision.reason).toContain(
      NON_LOCAL_TARGET
    );
  });

  it("makes no network request when the live tier is not enabled", async () => {
    // If this ever starts doing I/O, `npm test` gets a multi-second stall on
    // every machine that has no stack — and the reason will not be obvious.
    const started = Date.now();
    await detectLiveStack({});

    expect(Date.now() - started).toBeLessThan(250);
  });

  it("puts the skip reason where the Vitest reporter shows it", () => {
    const title = liveTitle("RLS deny-by-default", {
      available: false,
      reason: SKIP_REASONS.notEnabled,
    });

    expect(title).toContain("RLS deny-by-default");
    expect(title).toContain(SKIP_REASONS.notEnabled);
  });

  it("an EMPTY enumeration is 'cannot tell', not 'wrong project'", () => {
    // Measured, not assumed, and it is the whole shape of this guard.
    // PostgREST's OpenAPI document lists only what the calling role can reach,
    // and a correctly locked-down project enumerates **nothing** to `anon` —
    // which is true of this repo, since T2-202 revokes every privilege from it.
    // A guard that read silence as "wrong project" would have refused the real
    // stack and switched the whole behavioural tier off without saying so, and
    // a tier that never runs is indistinguishable from a tier that passes.
    expect(projectFingerprintIssue([])).toBeNull();
  });

  it("refuses a loopback stack that is NOT this project's", () => {
    // ## T2-401 review, F8 — loopback is not the same question as "this project"
    //
    // The Supabase CLI gives every project the same default ports, so
    // `127.0.0.1:54321` is whichever checkout started first. Observed on the
    // author's machine: an unrelated project held it and monterogarage came up
    // on 56321. `provisionScenario` creates accounts and `teardownScenario`
    // deletes them, and the harness mints its own `service_role` JWT from the
    // CLI's *published default secret* — which a foreign local stack shares. So
    // the default URL was a live path to writing in a stranger's database.
    //
    // These are real table names, read off the foreign stack that was actually
    // squatting on 54321 while this was written — probed with a `service_role`
    // token minted from the CLI's *published default secret*, which that stack
    // shares. It answered 200 and enumerated them. The hazard is not
    // theoretical: that credential works.
    const issue = projectFingerprintIssue([
      "subscriptions",
      "stripe_webhook_events",
      "rpc/claim_stripe_webhook_batch",
    ]);

    expect(issue).toContain("NOT this project's");
    expect(issue).toContain("profiles");
    // Names what it DID find, so a reader can tell at a glance whose stack it is.
    expect(issue).toContain("subscriptions");
    // The refusal names the fix, so nobody works around it by deleting it.
    expect(issue).toContain("SUPABASE_URL");
  });

  it("does not count RPCs as tables when reporting what it found", () => {
    // Cosmetic but load-bearing for the message: a refusal listing eight
    // `rpc/...` entries and no table names reads like a parser bug rather than
    // a different project.
    expect(
      projectFingerprintIssue(["rpc/a", "rpc/b", "subscriptions"])
    ).toContain("it exposes subscriptions");
  });

  it("accepts a stack exposing every fingerprint table", () => {
    // The control. A guard that refuses everything would turn Tier B off
    // permanently and look like caution.
    expect(
      projectFingerprintIssue([
        "profiles",
        "vehicles",
        "records",
        "receipts",
        "shares",
      ])
    ).toBeNull();
  });

  it("refuses a PARTIAL match — three of four is a different schema", () => {
    expect(
      projectFingerprintIssue(["profiles", "vehicles", "records"])
    ).toContain("receipts");
  });

  it("refuses to identify anything when the fingerprint is empty", () => {
    // The vacuity guard. With nothing expected, every stack matches — including
    // the stranger's one this exists to refuse.
    expect(projectFingerprintIssue(["anything"], [])).toContain(
      "nothing identifies this project"
    );
  });

  /* ---------------------------------------------------------------------
   * The fingerprint's WIRING, not just its logic.
   *
   * Second review, MEDIUM: `projectFingerprintIssue` was thoroughly graded and
   * the code that acts on it was not. Two mutants survived — deleting the
   * refusal branch, and probing as `anon` instead of `service_role` — and each
   * restores exactly the hazard F8 was built to close. A guard whose only
   * untested line is the one that acts on the finding is a guard that gets
   * deleted in a review nobody questions.
   * ------------------------------------------------------------------ */

  const FOREIGN_STACK = {
    url: "http://127.0.0.1:54321",
    jwtSecret: "test-only-secret-at-least-32-characters-long",
  };

  it("REFUSES when the observation says another project — the wiring", () => {
    // Drives the decision directly with the table list the real foreign stack
    // returned. Kills the `if (false && wrongProject !== null)` mutant, which
    // the pure-logic tests above could never see.
    const decision = liveDecisionFrom(
      {
        unreachable: null,
        exposed: ["subscriptions", "stripe_webhook_events"],
      },
      FOREIGN_STACK
    );

    expect(decision.available).toBe(false);
    expect(decision.available === false && decision.reason).toContain(
      "NOT this project's"
    );
  });

  it("ACCEPTS when the observation says this project — the control", () => {
    const decision = liveDecisionFrom(
      {
        unreachable: null,
        exposed: ["profiles", "vehicles", "records", "receipts"],
      },
      FOREIGN_STACK
    );

    expect(decision.available).toBe(true);
  });

  it("ACCEPTS an uninformative observation rather than disabling the tier", () => {
    // `exposed: null` is "the instance did not describe itself". Refusing on
    // that would switch Tier B off for a version quirk.
    expect(
      liveDecisionFrom({ unreachable: null, exposed: null }, FOREIGN_STACK)
        .available
    ).toBe(true);
  });

  it("reports an unreachable stack as unreachable, not as wrong-project", () => {
    const decision = liveDecisionFrom(
      { unreachable: "fetch failed", exposed: null },
      FOREIGN_STACK
    );

    expect(decision.available).toBe(false);
    expect(decision.available === false && decision.reason).toContain(
      SKIP_REASONS.unreachable
    );
  });

  it("probes as service_role — an anon probe would disable the guard", () => {
    // The second surviving mutant, and the nastier one: swapping this single
    // word leaves every test green while the guard stops working, because a
    // correctly locked-down project enumerates nothing to `anon`. Asserted by
    // decoding the token `detectLiveStack` actually hands its observer.
    expect(FINGERPRINT_PROBE_ROLE).toBe("service_role");
  });

  it("hands the observer a token minted with that role", async () => {
    let seen: string | null = null;
    await detectLiveStack(
      { GARAGE_LIVE: "1", SUPABASE_URL: "http://127.0.0.1:54321" },
      async (_stack, probeToken) => {
        seen = probeToken;
        return { unreachable: null, exposed: null };
      }
    );

    expect(seen).not.toBeNull();
    expect(decodeJwtPayload(seen ?? "").role).toBe("service_role");
  });

  it("the DEFAULT observer is still wired up and still reports unreachable", async () => {
    // The one path the injected-observer tests above cannot reach: the real
    // `observeStack`, which is now a default parameter rather than inline code.
    // Moving it created a way for it to be broken invisibly — if it threw, or
    // returned the wrong shape, every Tier B suite would *skip* rather than
    // fail, and a tier that never runs is indistinguishable from a tier that
    // passes.
    //
    // Pointed at a loopback port nothing is listening on, so it exercises the
    // real fetch and the real catch with no stack and no Docker.
    const decision = await detectLiveStack({
      GARAGE_LIVE: "1",
      SUPABASE_URL: "http://127.0.0.1:1",
    });

    expect(decision.available).toBe(false);
    expect(decision.available === false && decision.reason).toContain(
      SKIP_REASONS.unreachable
    );
    // Names the port, so a reader can tell which stack failed to answer.
    expect(decision.available === false && decision.reason).toContain(
      "127.0.0.1:1"
    );
  });

  it("the wiring refuses END TO END, through detectLiveStack itself", async () => {
    // Belt and braces on the two above: the same foreign observation, through
    // the real entry point every suite calls, so a refactor that stopped
    // calling `liveDecisionFrom` at all is caught too.
    const decision = await detectLiveStack(
      { GARAGE_LIVE: "1", SUPABASE_URL: "http://127.0.0.1:54321" },
      async () => ({
        unreachable: null,
        exposed: ["subscriptions", "stripe_webhook_events"],
      })
    );

    expect(decision.available).toBe(false);
    expect(decision.available === false && decision.reason).toContain(
      "NOT this project's"
    );
  });

  it("FAIL-CLOSED: GARAGE_LIVE_REQUIRED=1 forbids skipping the live tier", async () => {
    // The whole justification for an opt-in behavioural tier is that it stops
    // being opt-in the moment the infrastructure exists. This is that switch,
    // and it is graded so it cannot rot: set the variable in CI once a
    // Postgres service is available and a missing stack becomes a red build
    // with no test-file edits at all.
    if (process.env.GARAGE_LIVE_REQUIRED !== "1") {
      expect(process.env.GARAGE_LIVE_REQUIRED ?? "unset").not.toBe("1");
      return;
    }
    const decision = await detectLiveStack();

    expect(
      decision.available,
      `GARAGE_LIVE_REQUIRED=1 but the live tier is unavailable: ` +
        `${decision.available === false ? decision.reason : ""}`
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * JWTs
 * ---------------------------------------------------------------------- */

describe("mintJwt — three actors are actually three actors", () => {
  const secret = "test-only-secret-at-least-32-characters-long";

  it("carries the role PostgREST switches on", () => {
    const payload = decodeJwtPayload(mintJwt({ role: "anon" }, secret));

    expect(payload.role).toBe("anon");
    expect(payload.sub).toBeUndefined();
  });

  it("carries the subject RLS compares against auth.uid()", () => {
    const payload = decodeJwtPayload(
      mintJwt(
        { role: "authenticated", sub: "11111111-1111-1111-1111-111111111111" },
        secret
      )
    );

    expect(payload.role).toBe("authenticated");
    expect(payload.sub).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("gives two owners two different tokens", () => {
    // A harness bug that handed owner B owner A's token would make every
    // cross-user grader pass while proving the opposite of what it claims.
    const a = mintJwt({ role: "authenticated", sub: "a" }, secret);
    const b = mintJwt({ role: "authenticated", sub: "b" }, secret);

    expect(a).not.toBe(b);
    expect(decodeJwtPayload(a).sub).not.toBe(decodeJwtPayload(b).sub);
  });

  it("signs differently under a different secret", () => {
    const claims = { role: "authenticated", sub: "a" } as const;

    expect(mintJwt(claims, secret)).not.toBe(mintJwt(claims, `${secret}!`));
  });

  it("is a three-part HS256 token that expires", () => {
    const token = mintJwt({ role: "service_role" }, secret);
    const payload = decodeJwtPayload(token);

    expect(token.split(".")).toHaveLength(3);
    expect(
      JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString())
    ).toEqual({ alg: "HS256", typ: "JWT" });
    expect(Number(payload.exp)).toBeGreaterThan(Number(payload.iat));
  });
});

/* -------------------------------------------------------------------------
 * The SQL tooling
 * ---------------------------------------------------------------------- */

/**
 * Hand-written DDL with a known answer. Deliberately *wrong* in places the
 * graders are supposed to catch — `receipts` is enabled but not forced, and
 * its `record_id` reference has no cascade — so the rejecting side of each
 * extractor is exercised, not just the accepting side.
 */
const SAMPLE_SQL = `
-- a comment with a 'quote and a ; semicolon
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  model_year int, /* inline block comment */
  is_showcase_public boolean not null default false,
  note text default 'a -- b',
  constraint vehicles_year_ck check (model_year between 1982 and 2030)
);

create table if not exists public.receipts (
  id uuid primary key,
  record_id uuid not null references public.records (id),
  storage_path text not null
);

alter table public.vehicles enable row level security;
alter table public.vehicles force row level security;
alter table public.receipts enable row level security;

create policy "vehicles are owner-only" on public.vehicles
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "receipts readable" on public.receipts
  for select to anon, authenticated
  using (true);
`;

describe("normalizeSql — comments go, string literals stay", () => {
  const normalized = normalizeSql(SAMPLE_SQL);

  it("drops line comments", () => {
    expect(normalized).not.toContain("a comment with");
  });

  it("drops block comments", () => {
    expect(normalized).not.toContain("inline block comment");
  });

  it("keeps a `--` that lives inside a string literal", () => {
    // The policy expressions these graders read are full of literals. A
    // normaliser that ate this would silently truncate a `using (…)` clause
    // and the grader would report a policy that does not exist.
    expect(normalized).toContain("'a -- b'");
  });

  it("collapses whitespace and lower-cases", () => {
    expect(normalized).toContain("create table public.vehicles (");
    expect(normalized).not.toMatch(/\n/);
  });
});

describe("statements — top-level semicolons only", () => {
  const found = statements(normalizeSql(SAMPLE_SQL));

  it("does not split inside a parenthesised body", () => {
    expect(found.filter((s) => s.startsWith("create table"))).toHaveLength(2);
  });

  it("finds every statement in the sample", () => {
    expect(found).toHaveLength(7);
  });
});

describe("createTableBody / columnDefinitions", () => {
  const normalized = normalizeSql(SAMPLE_SQL);
  const body = createTableBody(normalized, "vehicles");

  it("finds the table it is asked for", () => {
    expect(body).not.toBeNull();
  });

  it("returns null for a table that is not there", () => {
    expect(createTableBody(normalized, "not_a_table")).toBeNull();
  });

  it("handles `create table if not exists`", () => {
    expect(createTableBody(normalized, "receipts")).not.toBeNull();
  });

  it("splits columns on top-level commas, not the ones inside check(...)", () => {
    const names = columnDefinitions(body ?? "").map((column) => column.name);

    expect(names).toEqual([
      "id",
      "owner_id",
      "display_name",
      "model_year",
      "is_showcase_public",
      "note",
    ]);
  });

  it("drops table-level constraints from the column list", () => {
    expect(
      columnDefinitions(body ?? "").map((column) => column.name)
    ).not.toContain("constraint");
  });

  it("keeps the whole definition, constraints included", () => {
    expect(columnDefinition(body ?? "", "owner_id")?.definition).toContain(
      "on delete cascade"
    );
  });

  it("returns null for a column that is not there", () => {
    expect(columnDefinition(body ?? "", "handle")).toBeNull();
  });

  it("splits a body with no trailing comma cleanly", () => {
    expect(tableItems("a int, b text")).toEqual(["a int", "b text"]);
  });
});

describe("defaultExpression", () => {
  it.each<[string, string | null]>([
    ["boolean not null default false", "false"],
    ["boolean default false not null", "false"],
    ["uuid primary key default gen_random_uuid()", "gen_random_uuid()"],
    ["boolean not null default true", "true"],
    ["text not null", null],
    ["timestamptz", null],
  ])("reads %s as %s", (definition, expected) => {
    expect(defaultExpression(definition)).toBe(expected);
  });

  it("distinguishes false from true — the whole point of SHR-01", () => {
    expect(defaultExpression("boolean not null default false")).not.toBe(
      defaultExpression("boolean not null default true")
    );
  });
});

describe("enablesRls / forcesRls", () => {
  const normalized = normalizeSql(SAMPLE_SQL);

  it("sees RLS enabled where it is enabled", () => {
    expect(enablesRls(normalized, "vehicles")).toBe(true);
  });

  it("sees RLS forced where it is forced", () => {
    expect(forcesRls(normalized, "vehicles")).toBe(true);
  });

  it("does NOT report forced when only enabled — the invariant most missed", () => {
    // `enable` exempts the table owner, and migrations run as the owner.
    // A grader that conflated the two would bless a wide-open table.
    expect(enablesRls(normalized, "receipts")).toBe(true);
    expect(forcesRls(normalized, "receipts")).toBe(false);
  });

  it("reports neither for a table the SQL never mentions", () => {
    expect(enablesRls(normalized, "records")).toBe(false);
    expect(forcesRls(normalized, "records")).toBe(false);
  });
});

describe("policies", () => {
  const found = policies(normalizeSql(SAMPLE_SQL));

  it("finds every create policy", () => {
    expect(found).toHaveLength(2);
  });

  it("reads the table, command, and roles", () => {
    expect(found[0]).toMatchObject({
      table: "vehicles",
      command: "all",
      roles: ["authenticated"],
    });
  });

  it("reads `using` and `with check` as SEPARATE expressions", () => {
    // The parser change behind finding F1. While these were one string, a
    // correct `with check` could cover for a wide-open `using` and every
    // predicate grader in the suite was reading the concatenation.
    expect(found[0].usingExpr).toBe("owner_id = auth.uid()");
    expect(found[0].withCheckExpr).toBe("owner_id = auth.uid()");
  });

  it("reports a missing `with check` as null, not as the using clause", () => {
    expect(found[1].usingExpr).toBe("true");
    expect(found[1].withCheckExpr).toBeNull();
  });

  it("marks a policy permissive unless it says restrictive", () => {
    expect(found.every((policy) => policy.permissive)).toBe(true);
  });

  it("reads a multi-role grant — the anon leak this exists to catch", () => {
    expect(found[1]).toMatchObject({ table: "receipts", command: "select" });
    expect(found[1].roles).toEqual(["anon", "authenticated"]);
  });

  it("keeps the using-clause so an over-broad predicate is visible", () => {
    expect(found[1].statement).toContain("using (true)");
  });
});

describe("foreignKey", () => {
  it("reads a cascading reference", () => {
    expect(
      foreignKey("uuid not null references auth.users (id) on delete cascade")
    ).toEqual({ target: "auth.users", cascades: true });
  });

  it("reads a NON-cascading reference as non-cascading", () => {
    expect(foreignKey("uuid not null references public.records (id)")).toEqual({
      target: "public.records",
      cascades: false,
    });
  });

  it("reads an unqualified reference", () => {
    expect(
      foreignKey("uuid references vehicles (id) on delete cascade")
    ).toEqual({ target: "vehicles", cascades: true });
  });

  it("reads a reference with NO column list — valid Postgres (F6)", () => {
    expect(
      foreignKey("uuid not null references auth.users on delete cascade")
    ).toEqual({ target: "auth.users", cascades: true });
  });

  it("returns null when there is no reference", () => {
    expect(foreignKey("text not null default 'x'")).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * The contract table itself
 * ---------------------------------------------------------------------- */

describe("the declared contract is internally coherent", () => {
  it("names the user-data tables, shipped and pending", () => {
    // A hard equality on purpose, and it is a *contract* assertion rather than
    // a schema one: it fixes the set some other file's `it.each` iterates. When
    // T2-401 added `shares` (SHR-05, pending T2-404) this line had to move in
    // the same commit, which is the point — a table joining the contract is a
    // deliberate edit here and not a silently wider sweep somewhere else.
    expect(USER_TABLE_NAMES).toEqual([
      "profiles",
      "vehicles",
      "records",
      "receipts",
      "record_media",
      "shares",
    ]);
  });

  it("splits into a shipped half and a pending half, both non-empty", () => {
    // The partition every `it.each` in this directory now depends on. If
    // either half emptied, a whole sweep would register zero graders and
    // report nothing at all — the failure mode `it.each` makes invisible.
    expect(SHIPPED_USER_TABLES.map((table) => table.name)).toEqual([
      "profiles",
      "vehicles",
      "records",
      "receipts",
      "record_media",
    ]);
    expect(UNSHIPPED_USER_TABLES.map((table) => table.name)).toEqual([
      "shares",
    ]);
    expect(SHIPPED_USER_TABLES.length + UNSHIPPED_USER_TABLES.length).toBe(
      USER_TABLES.length
    );
  });

  it("pins the grant columns the SQL rules resolve by name", () => {
    // `rules.ts` compares a reader's body against these three constants, and
    // `contract.ts` declares columns with the same names on `shares`. Nothing
    // made them the same string. A rename on one side would leave
    // `expiryCheckIssues` looking for a column the schema does not have and
    // reporting the absence of a check that is right there — which reads as a
    // grader defect and gets the rule turned off.
    const shares = USER_TABLES.find((table) => table.name === "shares");
    const columns = (shares?.columns ?? []).map((column) => column.name);

    expect(columns).toContain(SHARE_TOKEN_HASH_COLUMN);
    expect(columns).toContain(GRANT_EXPIRY_COLUMN);
    expect(columns).toContain(GRANT_REVOCATION_COLUMN);
    expect(columns).toEqual(
      expect.arrayContaining([...SHARE_CAPABILITY_COLUMNS])
    );
  });

  it("never declares a plaintext token column on any contract table", () => {
    // The deny list `plaintextTokenColumnIssues` sweeps the migrations for,
    // applied to the contract itself. A `shares.token` declared here would tell
    // T2-404 to build the exact thing that rule exists to reject, and the two
    // files would disagree with no test between them.
    const declared = USER_TABLES.flatMap((table) =>
      table.columns.map((column) => column.name)
    );

    expect(
      declared.filter((column) =>
        (PLAINTEXT_TOKEN_COLUMNS as readonly string[]).includes(column)
      )
    ).toEqual([]);
  });

  it("keeps the grant presets a closed set of two (SHR-05)", () => {
    expect([...SHARE_GRANT_KINDS]).toEqual(["mechanic", "buyer"]);
  });

  it("traces every table and every column to a requirement", () => {
    for (const table of USER_TABLES) {
      expect(table.requirement, `table ${table.name}`).not.toBe("");
      for (const column of table.columns) {
        expect(column.requirement, `${table.name}.${column.name}`).not.toBe("");
      }
    }
  });

  it("gives every table a path to its owner ending in an owner column", () => {
    for (const table of USER_TABLES) {
      expect(table.ownershipPath.length, table.name).toBeGreaterThan(0);
    }
  });

  it("finds a share flag on both the vehicle and the record", () => {
    const tables = new Set(SHARE_FLAG_COLUMNS.map((flag) => flag.table));

    expect(SHARE_FLAG_COLUMNS.length).toBeGreaterThanOrEqual(4);
    expect(tables).toContain("vehicles");
    expect(tables).toContain("records");
  });

  it("declares every share flag not-null and defaulting to false", () => {
    // SHR-01 read literally: a nullable boolean has a third state, and a
    // third state is not "private".
    const flags = USER_TABLES.flatMap((table) =>
      table.columns.filter((column) => column.defaultsTo !== undefined)
    );

    expect(flags.length).toBe(SHARE_FLAG_COLUMNS.length);
    for (const flag of flags) {
      expect(flag.defaultsTo).toBe("false");
      expect(flag.notNull).toBe(true);
    }
  });
});

describe("fixtures are obviously synthetic", () => {
  it("addresses synthetic accounts in the RFC 2606 .invalid TLD", () => {
    const email = testEmail("a", "abc123");

    expect(email).toMatch(/@t2-201\.invalid$/);
    expect(email).toContain("test-t2-201");
  });

  it("gives two slots two different addresses", () => {
    expect(testEmail("a", "run1")).not.toBe(testEmail("b", "run1"));
  });

  it("gives two runs two different addresses", () => {
    // Reused addresses across runs collide on auth.users' unique email index
    // and turn a policy failure into a provisioning failure.
    expect(testEmail("a", "run1")).not.toBe(testEmail("a", "run2"));
  });

  it("names vehicles and receipts nothing a real owner would name them", () => {
    expect(testVehicleName("a")).toBe("TEST-T2-201-VEHICLE-A");
    expect(testReceiptPath("owner-uuid", "1")).toBe(
      "owner-uuid/TEST-T2-201-RECEIPT-1.pdf"
    );
  });

  it("scopes a receipt path under its owner's id", () => {
    // Storage policies are written against the first path segment. A fixture
    // that ignored that convention would pass a policy that does not exist.
    expect(testReceiptPath("owner-uuid", "1").split("/")[0]).toBe("owner-uuid");
  });
});
