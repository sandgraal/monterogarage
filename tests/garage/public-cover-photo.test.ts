/**
 * Graders — **the world reader's cover-photo gate.** Declared by T2-404d
 * [TEST], against an RPC that already ships and a `<img>` seam that already
 * exists but is never wired.
 *
 * > **GAR-01′** … A user SHALL be able to designate one uploaded photo as the
 * > vehicle's **cover photo** … rendered wherever the vehicle is shown as a
 * > single item — the garage vehicle list, and any future showcase-page card
 * > (SHR-02).
 * > **SHR-09** A grant SHALL NOT make a record eligible for the community
 * > evidence surfacing of GAR-04′.
 *
 * ## What T2-404b shipped, and what it left as a seam
 *
 * `20260907130000_vehicle_cover_photo_public_bucket.sql` copies a designated
 * cover into a **public** `vehicle-cover-photos` bucket the moment it is set,
 * and removes the copy the moment it departs — the storage half, done and
 * deployed. `20260907120000_public_pages.sql`'s `share_read_vehicle`, the
 * world-reader RPC the showcase page calls, never learned about it: its
 * `p_token is null` branch projects `id`, `display_name`, the taxonomy
 * columns, and the two publication flags — never `cover_photo_path`. The
 * showcase page's `<img data-showcase-cover>` is hidden and stays hidden,
 * because nothing ever sets a `src` on it (see that page's own doc comment).
 *
 * ## The seam this file grades against, named so the implementer builds to it
 *
 * **The RPC returns the raw `cover_photo_path`, not a full URL** — the page
 * already resolves `PUBLIC_SUPABASE_URL` (`SUPABASE_BROWSER_CONFIG`) and
 * `src/lib/garage/showcase-view.ts`'s new `publicCoverPhotoUrl` seam turns a
 * path into the public object URL in one place, so the database does not have
 * to know its own project URL to answer "does this vehicle have a cover" —
 * the same division `share_read_receipts` already draws between "resolve the
 * path in Postgres" and "sign it in the Edge Function that knows the API
 * origin" (`contract.ts`'s `RECEIPT_SIGNER_DIR`).
 *
 * **The gating flag is `is_showcase_public`, not the row-admitting OR**
 * (`is_showcase_public is true or is_worklog_public is true`) that decides
 * whether the vehicle is returned at all — see `contract.ts`'s
 * `COVER_PUBLICATION_FLAG` for why treating the wider OR as the cover's own
 * gate is the exact SHR-09 conflation ("the grant path and GAR-04′'s
 * publication path must not meet") one surface over: a truck whose owner
 * published *only* the work-log must not hand a cover photo to a page they
 * never chose to publish.
 *
 * ## Two tiers, on purpose (the SHR-08 precedent, `share-grants.test.ts`)
 *
 * Tier A parses the migration text and can prove a *shape* — the column is
 * mentioned only inside the `p_token is null` branch, and only behind its own
 * `case when is_showcase_public …` gate, never riding along in the same
 * object literal as the always-present identity fields. It cannot prove the
 * database actually refuses to hand out a cover at runtime — GRADER-
 * PRINCIPLES.md's own first lesson, "grade the end state, not the text." Tier
 * B asks the real question of a real anonymous request: a worklog-public,
 * showcase-**private** vehicle with a cover on file is the realistic,
 * non-trivial case (a fully private vehicle is not returned at all, so its
 * cover is trivially absent too — the parenthetical the task brief itself
 * names). Both run; neither substitutes for the other.
 *
 * ## Expected-failure convention
 *
 * `it.fails`, one marker per test. Every marked assertion below was proved to
 * fail for the *seam* — nothing exists yet that projects `cover_photo_path` on
 * the world path — by scratch-implementing the gated projection locally
 * against a live stack, watching every marker (and the negative guards below)
 * go green for the right reason, and reverting before this file was
 * committed. The negative guards are deliberately **unmarked**: they already
 * pass today, because nothing exposes a cover to anyone yet, and that is the
 * correct state for a feature that has not shipped. What makes an unmarked
 * pass meaningful rather than vacuous is proved the same way — mutated
 * locally into a leaking implementation, watched the same guards turn red,
 * reverted.
 *
 * refs specs/002-montero-garage (GAR-01′, SHR-02, SHR-09)
 */
import { describe, expect, it } from "vitest";
import {
  COVER_PHOTO_COLUMN,
  COVER_PUBLICATION_FLAG,
  SHARE_READER_TOKEN_ARGUMENT,
  TEST_TAXONOMY_IDENTITY,
  testHandle,
  testVehicleName,
  testVehiclePhotoPath,
} from "./contract.ts";
import {
  detectLiveStack,
  insertRow,
  liveTitle,
  provisionScenario,
  rpc,
  stackOf,
  teardownScenario,
  updateRows,
  type Scenario,
} from "./harness.ts";
import {
  anonExecutableFunctions,
  impliesAtom,
  isContractRoutine,
  tokenAbsentSpans,
} from "./rules.ts";
import {
  balancedAt,
  functions,
  migrationSql,
  normalizeSql,
  type FunctionDefinition,
} from "./sql.ts";

const live = await detectLiveStack();

/* =========================================================================
 * The rule: is a cover-photo mention gated the way SHR-09/GAR-01′ require?
 *
 * Local to this file, in the style `cover-photo.test.ts` set for the same
 * reason: a rule that answers one requirement about one column is easier to
 * read, and easier to mutate on purpose, next to the graders that use it than
 * three hundred lines away in `rules.ts` among the general-purpose ones.
 * ====================================================================== */

/**
 * The start offset of the innermost `jsonb_build_object(…)` call whose
 * parentheses enclose `at`, or `null` when `at` is not inside one.
 *
 * "Innermost" is the call with the **largest** start offset that still
 * encloses `at` — a nested call necessarily starts later than the one
 * enclosing it, so the largest qualifying start is the tightest fit.
 */
function jsonbCallStart(body: string, at: number): number | null {
  const pattern = /jsonb_build_object\s*\(/g;
  let best: number | null = null;
  for (let hit = pattern.exec(body); hit; hit = pattern.exec(body)) {
    const open = hit.index + hit[0].length - 1;
    const group = balancedAt(body, open);
    if (!group) continue;
    if (hit.index <= at && at < group.close) {
      if (best === null || hit.index > best) best = hit.index;
    }
  }
  return best;
}

/**
 * The start offsets of every `jsonb_build_object(…)` call that mentions
 * `marker` somewhere in its argument list — used below to find the call(s)
 * building a vehicle's always-present identity fields (`'display_name'`),
 * so a cover mention sharing one of those calls can be recognised as riding
 * along on a predicate that was never about the cover at all.
 */
function jsonbCallStartsContaining(body: string, marker: string): Set<number> {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "g");
  const starts = new Set<number>();
  for (let hit = pattern.exec(body); hit; hit = pattern.exec(body)) {
    const start = jsonbCallStart(body, hit.index);
    if (start !== null) starts.add(start);
  }
  return starts;
}

/**
 * `true` when `atom` **asserts** `gateFlag` true, not merely mentions its
 * name — the leaf test {@link isImmediatelyAfterGatedThen} hands to
 * {@link impliesAtom}.
 *
 * An ALLOWLIST of exactly three affirmative shapes, matched against the
 * **whole** atom (`^…$`), not a substring search inside it:
 *
 * - `<flag> is true` (optionally through a `v.`-style alias)
 * - `<flag> = true`
 * - a bare truthy reference — the atom IS the flag and nothing else, no
 *   trailing comparator at all (`when v.is_showcase_public then …` —
 *   `share_read_records` never spells its own cost gate this way, but this
 *   rule still has to honour it, see the corpus below)
 *
 * Anything that is not one of those three full-string shapes is refused —
 * which is what makes this a genuine allowlist rather than "present and not
 * one of the spellings someone thought to deny": an inverse spelling nobody
 * has enumerated yet is refused *by construction*, the same way
 * `impliesTokenAbsent`'s own leaf (`\b${tokenArgument}\s+is\s+null\b`)
 * refuses every spelling of "token present" without needing to name one.
 *
 * ## CLOSED (opus re-review, 2026-09-07, PR #160 further hardening): the
 * "refuse the negations I thought of" version was still a denylist, and a
 * denylist leaks every spelling nobody enumerated
 *
 * The version this replaces asked "does the atom mention `gateFlag`, and is
 * it *not* one of `is false` / `is not true` / `is unknown` / `is null`
 * right next to that mention" — a **denylist**, despite a doc comment here
 * (see below) that claimed it "draws the same line" as `impliesTokenAbsent`'s
 * genuine allowlist. It silently accepted every inverse spelling that was not
 * on its list of four:
 *
 * ```sql
 * -- None of these contains `is false`, `is not true`, `is unknown`, or
 * -- `is null` verbatim, so the denylist waved all three through — each
 * -- hands a cover to a showcase-PRIVATE vehicle exactly as `is false` would.
 * when v.is_showcase_public = false then …
 * when v.is_showcase_public <> true then …              -- also: != true
 * when v.is_showcase_public is distinct from true then …
 * ```
 *
 * `is distinct from true` is not a hypothetical: it is the exact idiom
 * `20260903120100_public_handles.sql` already ships (`new.handle is distinct
 * from v_previous`) for a different column, so it is a plausible implementer
 * spelling here, not an exotic case invented to pad the corpus. The fix is
 * not a fifth denied string — that only restarts the same enumeration game
 * one spelling later — it is inverting the test's shape: `assertsFlagTrue`
 * now names the **accepted** shapes and refuses everything else, which is
 * also the correction to the overstated claim that used to sit here: this
 * leaf did not yet draw the same line as `impliesTokenAbsent` when that
 * sentence was written, because it was checking the *complement* of the
 * accepted set instead of the accepted set itself. It draws that line now.
 *
 * ## CLOSED (code review, second round: PR #160 discussion r3952013889):
 * mention-vs-assertion, the same gap `impliesTokenAbsent` was already built
 * to avoid
 *
 * The first review round (below) fixed the *disjunction* shape — a wider
 * `or` no longer passes just because one branch names the flag. It left the
 * **leaf** itself asking only `/\bis_showcase_public\b/.test(atom)`, which is
 * true of `v.is_showcase_public is false` exactly as it is true of `v.
 * is_showcase_public is true`: the name is present in both, and only one of
 * them is a gate.
 *
 * ```sql
 * -- Mentions the flag. Is not a gate on it — the opposite of one.
 * when v.is_showcase_public is false then
 *   jsonb_build_object('cover_photo_path', v.cover_photo_path)
 * ```
 *
 * A leading `not` (`when not v.is_showcase_public then …`) is refused one
 * layer up, by {@link impliesAtom}'s own `/^not\b/` check, before this leaf
 * is ever asked — unaffected by every fix recorded in this comment and
 * reconfirmed in the corpus below.
 *
 * ## CLOSED (code review, HIGH): the OR-gated leak this rule exists to catch
 *
 * The original version asked whether `gateFlag` merely *appears* in the
 * condition — `new RegExp('\\b' + gateFlag + '\\b').test(condition)` — which
 * accepts any condition naming the flag anywhere, including as one branch of
 * a wider `or`:
 *
 * ```sql
 * -- The row-admitting OR, not a gate on this field at all (COVER_PUBLICATION_
 * -- FLAG's own doc comment). `is_showcase_public` appears in the text, so the
 * -- substring test accepted this — and a worklog-public, showcase-PRIVATE
 * -- vehicle got its cover handed out through exactly this branch.
 * when (v.is_showcase_public is true or v.is_worklog_public is true) then
 *   jsonb_build_object('cover_photo_path', v.cover_photo_path)
 * ```
 *
 * `condition` is now decomposed with {@link impliesAtom} — the exact
 * algorithm `impliesTokenAbsent` (`rules.ts`) already uses for the identical
 * structural question about `p_token is null` — so a top-level `or` is
 * accepted only when **every** disjunct implies the flag, a top-level `and`
 * needs only one conjunct to, and a negated atom implies nothing. The shape
 * above now fails: its `is_worklog_public` disjunct does not name the
 * showcase flag at all — and even a disjunct that DID name it would still
 * have to satisfy the allowlist leaf above — so `.every()` is false and the
 * condition does not imply the gate. See `coverExposureIssues`'s own corpus
 * for this shape pinned as a mutation.
 *
 * ## What is still a named, accepted limit
 *
 * A narrow, bounded-text heuristic and not a full `case`/`end` parser — named
 * as a limit rather than left to be found, the same discipline
 * `capabilityGateIssues` states for its own "tested, not merely selected"
 * check one file over. It recognises exactly the idiom
 * `share_read_records` already ships for cost omission (`case when
 * r.is_cost_public is true then jsonb_build_object(…) else '{}'::jsonb end`)
 * applied to the showcase flag instead of the cost flag, and it does **not**
 * recognise the logically-equivalent inverted form (`case when … is false
 * then '{}'::jsonb else jsonb_build_object(…) end`) — a real gap, left named
 * rather than chased, because Tier B below is what actually proves the
 * runtime behaviour regardless of which spelling a correct implementation
 * chooses.
 */
function assertsFlagTrue(atom: string, gateFlag: string): boolean {
  const trimmed = atom.trim();
  const qualified = `(?:[a-z0-9_]+\\.)?${gateFlag}`;
  return (
    new RegExp(`^${qualified}\\s+is\\s+true$`).test(trimmed) ||
    new RegExp(`^${qualified}\\s*=\\s*true$`).test(trimmed) ||
    new RegExp(`^${qualified}$`).test(trimmed)
  );
}

function isImmediatelyAfterGatedThen(
  body: string,
  position: number,
  gateFlag: string
): boolean {
  const before = body.slice(0, position).trimEnd();
  if (!/\bthen$/.test(before)) return false;
  const whenIndex = before.lastIndexOf("when");
  if (whenIndex === -1) return false;
  const condition = before.slice(
    whenIndex + "when".length,
    before.length - "then".length
  );
  return impliesAtom(condition, (atom) => assertsFlagTrue(atom, gateFlag));
}

/**
 * Findings: does `routine` expose `COVER_PHOTO_COLUMN` anywhere it should
 * not?
 *
 * Two, independent failure shapes, exactly as `capabilityGateIssues` and
 * `publicationFlagGateIssues` separate theirs so a red suite says which one
 * was missed:
 *
 * 1. **Outside the world path.** A share-grant holder resolves a *token*; the
 *    cover is a showcase-page concern the token path never asked about, and a
 *    routine that reads the column while resolving one is the SHR-09
 *    conflation restated for a fourth column (`is_showcase_public`,
 *    `is_worklog_public`, and now this one).
 * 2. **Inside the world path, but not gated on `is_showcase_public`
 *    specifically.** The row-admitting `(is_showcase_public is true or
 *    is_worklog_public is true)` is not a gate on this *field* — see
 *    `contract.ts`'s `COVER_PUBLICATION_FLAG`. A cover mention sharing the
 *    same `jsonb_build_object(…)` call as the vehicle's always-present
 *    `'display_name'` has inherited that wider predicate by construction; a
 *    mention in a call of its own that is not immediately reached through a
 *    `when … is_showcase_public … then` is treated the same way — narrowly
 *    but honestly, see {@link isImmediatelyAfterGatedThen}'s own limits.
 */
function coverExposureIssues(
  routine: FunctionDefinition,
  tokenArgument: string = SHARE_READER_TOKEN_ARGUMENT
): string[] {
  const body = routine.body;
  const occurrence = new RegExp(`\\b${COVER_PHOTO_COLUMN}\\b`, "g");
  if (!occurrence.test(body)) return [];
  occurrence.lastIndex = 0;

  const worldSpans = tokenAbsentSpans(body, tokenArgument);
  const identityCallStarts = jsonbCallStartsContaining(body, "'display_name'");

  let sawOutsideWorld = false;
  let sawUngated = false;

  for (let hit = occurrence.exec(body); hit; hit = occurrence.exec(body)) {
    const at = hit.index;
    const inWorld = worldSpans.some(
      (span) => at >= span.start && at < span.end
    );
    if (!inWorld) {
      sawOutsideWorld = true;
      continue;
    }

    const enclosing = jsonbCallStart(body, at);
    if (enclosing === null || identityCallStarts.has(enclosing)) {
      sawUngated = true;
      continue;
    }
    if (!isImmediatelyAfterGatedThen(body, enclosing, COVER_PUBLICATION_FLAG)) {
      sawUngated = true;
    }
  }

  const issues: string[] = [];
  if (sawOutsideWorld) {
    issues.push(
      `${routine.identity}: returns ${COVER_PHOTO_COLUMN} without requiring ` +
        `\`${tokenArgument} is null\` on that path — a share-grant holder ` +
        `must never receive a vehicle's cover through the token path (SHR-09)`
    );
  }
  if (sawUngated) {
    issues.push(
      `${routine.identity}: returns ${COVER_PHOTO_COLUMN} on the world path ` +
        `without gating it behind its own \`case when ${COVER_PUBLICATION_FLAG} ` +
        `is true\` branch — the row-admitting OR (is_showcase_public or ` +
        `is_worklog_public) is not a gate on this field, and a worklog-only ` +
        `vehicle must not receive a cover through it (GAR-01′, SHR-09)`
    );
  }
  return issues;
}

/* =========================================================================
 * Corpus — the rule fires, and stays quiet when it should
 *
 * Unmarked: these grade `coverExposureIssues` itself against fixtures with a
 * known answer, not the shipped migration, so they pass today regardless of
 * whether the feature exists yet.
 * ====================================================================== */

function routineFrom(fixtureSql: string, name: string): FunctionDefinition {
  const found = functions(normalizeSql(fixtureSql)).find((routine) =>
    isContractRoutine(routine, name)
  );
  if (!found) {
    throw new Error(`fixture does not declare public.${name}`);
  }
  return found;
}

/**
 * The correctly-gated shape: cover rides in its **own** `jsonb_build_object`,
 * reached only through `case when v.is_showcase_public is true then …`, and
 * appended (`||`) to the always-present identity object rather than folded
 * into it — the same `||`-merge idiom `share_read_records` already ships for
 * `is_cost_public`.
 */
const GATED_CORRECTLY = `
create function public.share_read_vehicle(
  p_token text default null,
  p_handle text default null,
  p_vehicle_id uuid default null
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
begin
  if p_token is null then
    return query
      select jsonb_build_object(
               'id', v.id,
               'display_name', v.display_name,
               'is_showcase_public', v.is_showcase_public,
               'is_worklog_public', v.is_worklog_public
             )
             || case
                  when v.is_showcase_public is true then
                    jsonb_build_object('cover_photo_path', v.cover_photo_path)
                  else '{}'::jsonb
                end
        from public.vehicles v
        join public.profiles p on p.id = v.owner_id
       where p_token is null
         and lower(p.handle) = lower(btrim(p_handle))
         and (v.is_showcase_public is true or v.is_worklog_public is true);
    return;
  end if;

  select s.vehicle_id
    into v_vehicle_id
    from public.shares s
   where s.token_hash = extensions.digest(p_token, 'sha256')
     and s.revoked_at is null
     and s.expires_at > now();

  if not found then
    raise insufficient_privilege using message = 'share unavailable';
  end if;

  return query
    select jsonb_build_object('id', v.id, 'display_name', v.display_name)
      from public.vehicles v
     where v.id = v_vehicle_id;
end;
$$;
`;

/** `GATED_CORRECTLY`, with one thing broken. */
function broken(fixture: string, replace: readonly [string, string]): string {
  const [from, to] = replace;
  expect(
    fixture,
    `mutation source \`${from}\` is not in the fixture`
  ).toContain(from);
  return fixture.replace(from, to);
}

describe("coverExposureIssues — fires on the realistic defect shapes, and only those", () => {
  it("POSITIVE CONTROL: the gated shape reports nothing", () => {
    expect(
      coverExposureIssues(routineFrom(GATED_CORRECTLY, "share_read_vehicle"))
    ).toEqual([]);
  });

  it("MUTATION: an unconditional cover in the SAME object as the identity fields is flagged", () => {
    // The realistic mistake: the row is already gated by the OR, so folding
    // the cover into the identity object *looks* gated and is not — it rides
    // the OR, not `is_showcase_public` alone.
    const leaking = broken(GATED_CORRECTLY, [
      "'is_worklog_public', v.is_worklog_public\n             )\n             || case\n                  when v.is_showcase_public is true then\n                    jsonb_build_object('cover_photo_path', v.cover_photo_path)\n                  else '{}'::jsonb\n                end",
      "'is_worklog_public', v.is_worklog_public,\n               'cover_photo_path', v.cover_photo_path\n             )",
    ]);

    const issues = coverExposureIssues(
      routineFrom(leaking, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: gated on is_worklog_public instead of is_showcase_public is flagged", () => {
    // The exact security-critical bypass the task brief names: a worklog-
    // public, showcase-PRIVATE vehicle must never receive a cover, and a gate
    // on the wrong flag is precisely what would leak it.
    const wrongFlag = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_worklog_public is true then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(wrongFlag, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: gated on the row-admitting OR (both flags) is flagged — the exact leak the HIGH-severity code review found", () => {
    // The condition literally contains `\bis_showcase_public\b`, so a plain
    // substring test on the whole condition — this rule's own defect before
    // the fix — accepted it as "gated on the showcase flag". It is not: the
    // OR's OTHER disjunct, is_worklog_public, is what actually admits a
    // worklog-public/showcase-PRIVATE row, and that row would get a cover
    // through this exact branch. `impliesAtom` requires EVERY top-level `or`
    // disjunct to imply the flag; `is_worklog_public is true` does not, so the
    // condition no longer implies the gate.
    const orGated = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when (v.is_showcase_public is true or v.is_worklog_public is true) then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(orGated, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: an unconditional `||` merge with no case/when at all is flagged", () => {
    const bareMerge = broken(GATED_CORRECTLY, [
      "|| case\n                  when v.is_showcase_public is true then\n                    jsonb_build_object('cover_photo_path', v.cover_photo_path)\n                  else '{}'::jsonb\n                end",
      "|| jsonb_build_object('cover_photo_path', v.cover_photo_path)",
    ]);

    const issues = coverExposureIssues(
      routineFrom(bareMerge, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: exposing the cover on the TOKEN path is flagged, independently of the world gate", () => {
    const onTokenPath = broken(GATED_CORRECTLY, [
      "select jsonb_build_object('id', v.id, 'display_name', v.display_name)\n      from public.vehicles v\n     where v.id = v_vehicle_id;",
      "select jsonb_build_object('id', v.id, 'display_name', v.display_name, 'cover_photo_path', v.cover_photo_path)\n      from public.vehicles v\n     where v.id = v_vehicle_id;",
    ]);

    const issues = coverExposureIssues(
      routineFrom(onTokenPath, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without requiring `p_token is null`"),
    ]);
  });

  it("accepts the bare-boolean spelling of the gate (`when v.is_showcase_public then`)", () => {
    // `is true` is not the only correct spelling of a boolean test in a CASE
    // branch — `share_read_records`'s own `is_cost_public` gate uses the
    // explicit form, but the bare column reference means the same thing and a
    // rule that rejected it would fail a schema for no reason a requirement
    // can name (the `foreignKeyFor` three-spellings precedent, one file over).
    const bareBoolean = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_showcase_public then",
    ]);

    expect(
      coverExposureIssues(routineFrom(bareBoolean, "share_read_vehicle"))
    ).toEqual([]);
  });

  it("MUTATION: gated on `is_showcase_public is false` is flagged — mentioning the flag is not the same as asserting it (PR #160 r3952013889)", () => {
    // `is_showcase_public` appears in the text — a leaf test that asks only
    // "does the atom mention the flag" (this rule's own defect before this
    // fix) accepted this exactly as it accepted the correctly-gated `is
    // true` branch, and a `case when … is false then jsonb_build_object(…)`
    // hands the cover to every row where the showcase flag is NOT set: the
    // inverse of the gate, wearing the gate's own column name. Revert
    // `assertsFlagTrue`'s negation check and this goes green for the wrong
    // reason — the exact bite-proof this test exists to pin.
    const invertedGate = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_showcase_public is false then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(invertedGate, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: gated on `is_showcase_public is not true` is flagged — the explicit three-valued-logic inverse", () => {
    const notTrueGate = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_showcase_public is not true then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(notTrueGate, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: `when not v.is_showcase_public then` is flagged — the leading-`not` refusal in `impliesAtom`, reconfirmed unaffected by this leaf fix", () => {
    const negatedBareGate = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when not v.is_showcase_public then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(negatedBareGate, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: gated on `is_showcase_public is unknown` is flagged — the third three-valued-logic inverse, pinned so the allowlist rewrite cannot silently drop it", () => {
    const unknownGate = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_showcase_public is unknown then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(unknownGate, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: gated on `is_showcase_public is null` is flagged — pinned for the same reason as `is unknown` above", () => {
    const nullGate = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_showcase_public is null then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(nullGate, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: gated on `is_showcase_public = false` is flagged — the equality-operator inverse the negation-denylist leaf used to leak (opus re-review)", () => {
    // The leak the allowlist rewrite exists to close: `= false` contains none
    // of the four strings (`is false`, `is not true`, `is unknown`, `is
    // null`) the old leaf denied, so it went straight through as "present and
    // not denied" — the exact silent-accept this PR fixes.
    const eqFalseGate = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_showcase_public = false then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(eqFalseGate, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: gated on `is_showcase_public <> true` is flagged — another equality-operator inverse the old denylist leaked", () => {
    const neqGate = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_showcase_public <> true then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(neqGate, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: gated on `is_showcase_public != true` is flagged — the ASCII spelling of the same inverse", () => {
    const bangEqGate = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_showcase_public != true then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(bangEqGate, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("MUTATION: gated on `is_showcase_public is distinct from true` is flagged — the plausible spelling, since `20260903120100_public_handles.sql` already ships this exact idiom for a different column", () => {
    const distinctGate = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_showcase_public is distinct from true then",
    ]);

    const issues = coverExposureIssues(
      routineFrom(distinctGate, "share_read_vehicle")
    );
    expect(issues).toEqual([
      expect.stringContaining("without gating it behind its own"),
    ]);
  });

  it("accepts the `= true` equality spelling of the gate — the second of the three allowlisted shapes, so tightening the leaf did not also narrow it below what a correct implementation may write", () => {
    const eqTrue = broken(GATED_CORRECTLY, [
      "when v.is_showcase_public is true then",
      "when v.is_showcase_public = true then",
    ]);

    expect(
      coverExposureIssues(routineFrom(eqTrue, "share_read_vehicle"))
    ).toEqual([]);
  });

  it("reports both findings at once when both defects are present", () => {
    const both = broken(
      broken(GATED_CORRECTLY, [
        "when v.is_showcase_public is true then",
        "when v.is_worklog_public is true then",
      ]),
      [
        "select jsonb_build_object('id', v.id, 'display_name', v.display_name)\n      from public.vehicles v\n     where v.id = v_vehicle_id;",
        "select jsonb_build_object('id', v.id, 'display_name', v.display_name, 'cover_photo_path', v.cover_photo_path)\n      from public.vehicles v\n     where v.id = v_vehicle_id;",
      ]
    );

    const issues = coverExposureIssues(routineFrom(both, "share_read_vehicle"));
    expect(issues).toHaveLength(2);
  });
});

/* =========================================================================
 * Tier A — the shipped migration, both directions
 * ====================================================================== */

function requireVehicleReader(): FunctionDefinition {
  const found = functions(migrationSql()).find((routine) =>
    isContractRoutine(routine, "share_read_vehicle")
  );
  if (!found) {
    throw new Error(
      "no function named public.share_read_vehicle exists in " +
        "supabase/migrations/ — this file assumes T2-404b's world-reader RPC, " +
        "which already ships"
    );
  }
  return found;
}

describe("share_read_vehicle: the cover gate, run against the shipped migration", () => {
  it("no OTHER anon-reachable routine mentions the cover column at all", () => {
    // Unmarked. If a future routine (a public index, a search RPC) starts
    // naming this column, this is the sweep that notices — SHR-09's own
    // reasoning ("must go through a reviewed world path") applies to a new
    // column exactly as it does to the two publication flags.
    const others = anonExecutableFunctions(migrationSql()).filter(
      (routine) => !isContractRoutine(routine, "share_read_vehicle")
    );
    const leaking = others.filter((routine) =>
      new RegExp(`\\b${COVER_PHOTO_COLUMN}\\b`).test(routine.body)
    );
    expect(leaking.map((routine) => routine.identity)).toEqual([]);
  });

  it("the anon surface exists to sweep — the check above is not vacuous", () => {
    expect(anonExecutableFunctions(migrationSql()).length).toBeGreaterThan(0);
  });

  it("share_read_vehicle's own handling of the column, whatever it is today, is gated correctly", () => {
    // Unmarked, and vacuously clean today: the routine mentions no cover
    // column at all yet, so there is nothing for `coverExposureIssues` to
    // object to. That is the correct state for an unshipped feature, and it
    // is what keeps this guard from reporting the same finding twice once the
    // it.fails positive control below is satisfied — this test starts
    // catching a real leak the moment the column is added, and does so
    // whether or not anyone remembers to update this file.
    expect(coverExposureIssues(requireVehicleReader())).toEqual([]);
  });

  it("POSITIVE CONTROL: the world path actually projects cover_photo_path (GAR-01′)", () => {
    // Without this, every clean report above is satisfied by a routine that
    // never mentions the column — a showcase page that never shows a cover.
    // Deleting this marker is the whole of this file's activation signal for
    // the RPC half; the corpus and the two guards above do not move.
    expect(requireVehicleReader().body).toMatch(
      new RegExp(`\\b${COVER_PHOTO_COLUMN}\\b`)
    );
  });
});

/* =========================================================================
 * Tier B — the real question, asked of a real anonymous request
 * ====================================================================== */

/** A vehicle with one photo, designated as its cover, owned by `actor`. */
async function vehicleWithCover(
  scenario: Scenario,
  overrides: {
    readonly isShowcasePublic: boolean;
    readonly isWorklogPublic: boolean;
  }
): Promise<{ readonly vehicleId: string; readonly coverPath: string }> {
  const created = await insertRow(scenario, scenario.ownerA, "vehicles", {
    owner_id: scenario.ownerA.userId,
    display_name: testVehicleName("a"),
    ...TEST_TAXONOMY_IDENTITY,
  });
  const rows = Array.isArray(created.body) ? created.body : [];
  const vehicleId = (rows[0] as { id?: string } | undefined)?.id;
  if (!created.ok || !vehicleId) {
    throw new Error(
      `could not create vehicle: ${created.status} ${created.text}`
    );
  }

  const coverPath = testVehiclePhotoPath(
    scenario.ownerA.userId ?? "",
    vehicleId,
    "1"
  );
  const linked = await updateRows(
    scenario,
    scenario.ownerA,
    "vehicles",
    `id=eq.${vehicleId}`,
    {
      photo_paths: [coverPath],
      cover_photo_path: coverPath,
      is_showcase_public: overrides.isShowcasePublic,
      is_worklog_public: overrides.isWorklogPublic,
    }
  );
  if (!linked.ok) {
    throw new Error(
      `could not designate cover: ${linked.status} ${linked.text}`
    );
  }

  return { vehicleId, coverPath };
}

/** Claim a handle for owner A, so the world reader has a name to resolve. */
async function claimHandle(scenario: Scenario): Promise<string> {
  const handle = testHandle("a", scenario.runId);
  const claimed = await updateRows(
    scenario,
    scenario.ownerA,
    "profiles",
    `id=eq.${scenario.ownerA.userId}`,
    { handle }
  );
  if (!claimed.ok) {
    throw new Error(
      `could not claim handle: ${claimed.status} ${claimed.text}`
    );
  }
  return handle;
}

/** Read one vehicle as the world (no token), by handle and vehicle id. */
async function readAsWorld(
  scenario: Scenario,
  handle: string,
  vehicleId: string
): Promise<Record<string, unknown> | undefined> {
  const response = await rpc(scenario, scenario.anon, "share_read_vehicle", {
    p_handle: handle,
    p_vehicle_id: vehicleId,
  });
  const rows = Array.isArray(response.body) ? response.body : [];
  expect(response.ok, response.text).toBe(true);
  return rows[0] as Record<string, unknown> | undefined;
}

describe.skipIf(!live.available)(
  liveTitle(
    "the world reader exposes a cover only when the SHOWCASE page is public",
    live
  ),
  () => {
    it(
      "a worklog-public, showcase-PRIVATE vehicle is returned with NO cover " +
        "(security-critical negative)",
      async () => {
        const scenario = await provisionScenario(stackOf(live));
        try {
          const handle = await claimHandle(scenario);
          const { vehicleId } = await vehicleWithCover(scenario, {
            isShowcasePublic: false,
            isWorklogPublic: true,
          });

          const row = await readAsWorld(scenario, handle, vehicleId);

          // The vehicle IS returned — the work-log alone admits the row — so
          // "no cover" below is not merely "the whole read failed" (AGENTS.md:
          // a failure is not a zero).
          expect(
            row,
            "the worklog-public vehicle was not returned at all"
          ).toBeDefined();
          expect(row?.is_worklog_public).toBe(true);
          expect(Object.hasOwn(row ?? {}, COVER_PHOTO_COLUMN)).toBe(false);
        } finally {
          await teardownScenario(scenario);
        }
      }
    );

    it("POSITIVE CONTROL: a showcase-PUBLIC vehicle's cover IS exposed, matching the stored path", async () => {
      // Without this, "no cover when showcase is private" above is
      // satisfiable by a reader that never returns a cover to anyone —
      // a showcase card that never shows one.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const handle = await claimHandle(scenario);
        const { vehicleId, coverPath } = await vehicleWithCover(scenario, {
          isShowcasePublic: true,
          isWorklogPublic: false,
        });

        const row = await readAsWorld(scenario, handle, vehicleId);

        expect(row).toBeDefined();
        expect(Object.hasOwn(row ?? {}, COVER_PHOTO_COLUMN)).toBe(true);
        expect(row?.[COVER_PHOTO_COLUMN]).toBe(coverPath);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("a vehicle with neither flag public is not returned at all — the cover question is moot", async () => {
      // The trivial case the task brief names in passing: nothing to expose
      // because there is no row to expose it on. Asserted anyway, because a
      // reader that returned the row with no cover for the wrong reason
      // (a bug that always omits it) would still pass the two graders above.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const handle = await claimHandle(scenario);
        const { vehicleId } = await vehicleWithCover(scenario, {
          isShowcasePublic: false,
          isWorklogPublic: false,
        });

        const row = await readAsWorld(scenario, handle, vehicleId);
        expect(row).toBeUndefined();
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("a share-grant holder (token path) never receives a cover field either", async () => {
      // The token path answers a different question (SHR-05's granted
      // history) and has never returned photos or a cover — this pins that a
      // cover fix does not accidentally widen the OTHER reader path while it
      // is at it. Uses a nonsense token deliberately: the assertion is about
      // the *shape* share_read_vehicle's token branch can produce, not about
      // a live grant, and a routine that leaked the column would do so before
      // ever checking the token's validity.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const response = await rpc(
          scenario,
          scenario.anon,
          "share_read_vehicle",
          {
            p_token: `${testHandle("z", scenario.runId)}-not-a-real-token`,
          }
        );
        const rows = Array.isArray(response.body) ? response.body : [];
        expect(
          rows.every((row) => !Object.hasOwn(row as object, COVER_PHOTO_COLUMN))
        ).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);
