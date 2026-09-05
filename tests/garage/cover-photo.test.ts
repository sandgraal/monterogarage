/**
 * Graders — the cover-photo designation (T2-306a [TEST]).
 *
 * > **GAR-01′** … A user SHALL be able to designate one uploaded photo as the
 * > vehicle's **cover photo** (owner-approved addition, 2026-09-02), rendered
 * > wherever the vehicle is shown as a single item — the garage vehicle list,
 * > and any future showcase-page card (SHR-02). Removing the designated cover
 * > photo SHALL leave the vehicle with no cover rather than silently promoting
 * > another one; a vehicle with photos but no cover renders the same
 * > placeholder image used when the vehicle has no photos.
 *
 * T2-301 shipped the photos: the `vehicle-photos` bucket, the
 * `<owner>/<vehicle>/<file>` path, and `vehicles.photo_paths`. This file is
 * what T2-306 has to satisfy to designate one of them — written before it,
 * from the spec, by an instance that will not implement it (AGENTS.md
 * separation rule; T901 audits it through the commit trailer).
 *
 * The **render** half of GAR-01′ — "never just the first array entry", and the
 * placeholder a coverless vehicle shows — is graded in
 * `src/lib/garage/cover.test.ts`, because it is a claim about a function and
 * not about a schema. This file grades the database.
 *
 * ## The three things this task is actually about
 *
 * 1. **Membership is a database property.** The task line is explicit: "a
 *    cover path naming a photo the vehicle does not have is a defect, not a
 *    user error to accept silently". A dangling cover is a request to the
 *    storage API for an object the row does not own, made on the owner's
 *    behalf, and nothing in a page can tell it apart from a photo that failed
 *    to load — which is the "a failure is not a zero" rule from AGENTS.md
 *    arriving in image form.
 *
 * 2. **Removing the cover clears it, atomically, and does not promote.**
 *    GAR-01′ says "leave the vehicle with no cover rather than silently
 *    promoting another one". Two failure directions and both are graded: a
 *    dangling reference left behind, and an auto-promotion that quietly
 *    publishes a photo the owner did not choose.
 *
 * 3. **The two-tab race.** This project has already paid for exactly one
 *    lost-update race, on this exact column's neighbour: T2-304's seeding
 *    found that two photo uploads racing on `vehicles.photo_paths` clobber
 *    each other, stranding a real storage object no row names (ticketed as
 *    T2-305). The cover designation could reintroduce it in a different form
 *    — a "set as cover" that writes back the array it read a moment ago — and
 *    a grader that failed to notice would bless the second instance of a bug
 *    the first instance is still open on. So the guarantee is put where a
 *    stale tab cannot get around it: in the schema, not in the page. The
 *    payload-shape half of the same rule is graded on `coverPhotoWrite` in
 *    `src/lib/garage/cover.test.ts`.
 *
 * ## What Tier A can and cannot see, stated rather than left to be found
 *
 * The declaration rules below read the *end state* of the migration sequence
 * and can prove that an enforcement **exists** and relates the two columns.
 * They cannot prove it means the right thing: a check spelled
 * `check (cover_photo_path is null or cardinality(photo_paths) > 0)` names
 * both columns and enforces nothing useful. Only the live tier can ask the
 * database to refuse, and it does. This is the same honest limit
 * `.claude/GRADER-PRINCIPLES.md` records for list-based sweeps, and it is why
 * the live half is not decorative.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker; T2-306 activates a grader by deleting exactly that
 * `.fails`. The rule-control block at the foot of the file is unmarked and
 * passes today — without it, every marked grader above could be failing
 * because a helper returns nothing, which looks identical in a report and
 * means the opposite thing.
 *
 * refs specs/002-montero-garage (GAR-01′, SHR-01, ACC-03)
 */
import { describe, expect, it } from "vitest";
import {
  COVER_PHOTO_COLUMN,
  COVER_PHOTO_SOURCE_COLUMN,
  TEST_TAXONOMY_IDENTITY,
  USER_TABLES,
  testVehicleName,
  testVehiclePhotoPath,
} from "./contract.ts";
import {
  type Actor,
  type ApiResponse,
  type Scenario,
  detectLiveStack,
  insertRow,
  liveTitle,
  provisionScenario,
  selectRows,
  stackOf,
  teardownScenario,
  updateRows,
} from "./harness.ts";
import {
  balancedAt,
  columnDefinitionFor,
  createTableBody,
  defaultExpression,
  isNotNullFor,
  migrationSql,
  normalizeSql,
  statements,
  tableConstraints,
} from "./sql.ts";

const live = await detectLiveStack();

/** The table the designation lives on. */
const TABLE = "vehicles";

/* =========================================================================
 * Declaration-tier rules
 *
 * Local to this file, in the style `vehicle-photos.test.ts` set: a rule that
 * exists to answer one requirement is easier to read, and easier to mutate on
 * purpose, next to the graders that read it than three hundred lines away in
 * `rules.ts` among the policy rules. Every one of them is exercised against a
 * fixture with a known answer at the foot of the file — both directions.
 * ====================================================================== */

/**
 * The `create function` statement for `name`, body included — **the last one**.
 *
 * Last-definition-wins, exactly as `vehicle-photos.test.ts` does it and for
 * the same reason: `create or replace function` is how a shipped function is
 * extended once `db push` has run, so reading the *first* definition grades a
 * version that is no longer in force. A migration directory is a sequence and
 * the only honest question to ask of it is what the database looks like at the
 * **end**.
 */
function functionBody(sql: string, name: string): string {
  const defined = statements(sql).filter((statement) =>
    new RegExp(`create (?:or replace )?function [a-z_.]*${name}\\b`).test(
      statement
    )
  );
  return defined.at(-1) ?? "";
}

/** Every `create trigger` statement declared on `public.vehicles`. */
function vehicleTriggers(sql: string): string[] {
  return statements(sql).filter(
    (statement) =>
      statement.startsWith("create trigger") &&
      new RegExp(`\\bon (?:public\\.)?${TABLE}\\b`).test(statement)
  );
}

/**
 * The body of whatever function a trigger statement calls.
 *
 * Follows `execute function <name>` rather than matching a list of plausible
 * names. T2-301a's F1 is the reason: an earlier draft of the photos graders
 * hard-coded `handle_vehicle_deleted` / `vehicle_photos_cleanup`, which is a
 * contract nobody declared — an implementer who wrote the equally natural
 * `cleanup_vehicle_photos` would have failed with no legitimate route to
 * green, and the "fix" would have been to rename a function to satisfy a test.
 */
function triggerBody(sql: string, trigger: string): string {
  const target = /execute (?:function|procedure)\s+([a-z0-9_.]+)\s*\(/.exec(
    trigger
  )?.[1];
  if (!target) return "";
  const bare = target.includes(".") ? target.split(".").pop() : target;
  return bare ? functionBody(sql, bare) : "";
}

/**
 * Every `check (…)` expression that applies to `table`, wherever it is written.
 *
 * Three spellings, and a schema is no less correct for choosing any of them
 * (the `foreignKeyFor` precedent): inline on a column inside `create table`,
 * as a table-level constraint inside `create table`, or bolted on afterwards
 * with `alter table … add constraint … check (…)`. The third is the one
 * T2-306 must use — `public.vehicles` already exists and an applied migration
 * is history, not a draft — so a rule that read only the first two would be
 * unsatisfiable by the only route available.
 */
function checkExpressions(sql: string, table: string): string[] {
  const out: string[] = [];

  const collect = (text: string): void => {
    let cursor = 0;
    for (;;) {
      const match = /\bcheck\s*\(/.exec(text.slice(cursor));
      if (!match) return;
      const open = cursor + match.index + match[0].length - 1;
      const balanced = balancedAt(text, open);
      if (!balanced) return;
      out.push(balanced.inner);
      cursor = balanced.close + 1;
    }
  };

  const body = createTableBody(sql, table);
  if (body) {
    for (const item of tableConstraints(body)) collect(item);
    // Inline column checks live outside `tableConstraints`, which only returns
    // the *table-level* items. `photo_paths text[] check (…)` is a column
    // definition as far as that helper is concerned.
    collect(body);
  }

  for (const statement of statements(sql)) {
    if (
      !new RegExp(
        `^alter table (?:if exists )?(?:only )?(?:public\\.)?${table}\\b`
      ).test(statement)
    ) {
      continue;
    }
    collect(statement);
  }

  return out;
}

/**
 * Every assignment to the cover column inside a routine body, RHS included.
 *
 * ## The accepted spellings, and why the list is closed
 *
 * `:=` (plpgsql's assignment operator) and `set <column> =` (an `update`'s
 * set-clause). Both are unambiguous. A bare `cover_photo_path = x` is **not**
 * read as an assignment, and that is deliberate rather than an oversight: in
 * plpgsql the same three tokens are a *comparison* far more often than they
 * are an assignment — `if new.cover_photo_path = old.cover_photo_path then`,
 * `where cover_photo_path = …` — and a rule that could not tell them apart
 * would report the no-promotion violation against correct code, which is how a
 * real rule gets deleted out of frustration instead of fixed.
 *
 * The cost is that a body written entirely with `new.x = null;` reads as "never
 * assigns the cover" rather than as "assigns it correctly". That is a finding
 * either way, the message says which column it could not find an assignment
 * for, and `:=` is the operator the Postgres documentation uses — so the
 * failure is legible and the fix is a two-character diff, not a redesign.
 */
function coverAssignments(body: string): string[] {
  const out: string[] = [];
  const patterns = [
    new RegExp(`(?:new\\.|old\\.)?${COVER_PHOTO_COLUMN}\\s*:=\\s*([^;]+)`, "g"),
    new RegExp(`\\bset\\s+${COVER_PHOTO_COLUMN}\\s*=\\s*([^;]+)`, "g"),
  ];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      out.push(match[1].split(/\bwhere\b|,/)[0].trim());
    }
  }
  return out;
}

/** `true` when an assignment's right-hand side is `null` and nothing else. */
function isNullAssignment(rhs: string): boolean {
  return /^null(?:\s*::\s*[a-z ]+)?$/.test(rhs.trim());
}

/**
 * Findings: the database does not refuse a cover the vehicle does not have.
 *
 * Two routes are accepted, because two are correct. A `check` constraint
 * relating the two columns makes the dangling state unrepresentable; a trigger
 * on `vehicles` that `raise`s when the designation is not a member does the
 * same thing with a better error message. Demanding the first would fail a
 * schema that chose the second for no reason a requirement can name.
 *
 * What is **not** accepted is the designation being mentioned nowhere, or
 * being constrained without reference to `photo_paths` — a
 * `check (cover_photo_path <> '')` is a shape check, not a membership one, and
 * the difference is the whole requirement.
 */
function coverMembershipIssues(sql: string): string[] {
  const checks = checkExpressions(sql, TABLE);
  const mentioningChecks = checks.filter((expr) =>
    expr.includes(COVER_PHOTO_COLUMN)
  );
  const relatingChecks = mentioningChecks.filter((expr) =>
    expr.includes(COVER_PHOTO_SOURCE_COLUMN)
  );

  const bodies = vehicleTriggers(sql).map((trigger) =>
    triggerBody(sql, trigger)
  );
  const mentioningBodies = bodies.filter((body) =>
    body.includes(COVER_PHOTO_COLUMN)
  );
  const raisingBodies = mentioningBodies.filter(
    (body) => body.includes(COVER_PHOTO_SOURCE_COLUMN) && /\braise\b/.test(body)
  );

  if (relatingChecks.length > 0 || raisingBodies.length > 0) return [];

  if (mentioningChecks.length === 0 && mentioningBodies.length === 0) {
    return [
      `public.${TABLE}: nothing constrains ${COVER_PHOTO_COLUMN} — a cover ` +
        `naming a photo the vehicle does not have would be stored silently`,
    ];
  }
  return [
    `public.${TABLE}: ${COVER_PHOTO_COLUMN} is constrained but never ` +
      `compared against ${COVER_PHOTO_SOURCE_COLUMN} — membership is not ` +
      `enforced`,
  ];
}

/**
 * Findings: removing a photo can leave the cover dangling, or promote another.
 *
 * The requirement has three parts and each is its own finding, so an
 * implementer reading a red suite is told which one they missed rather than
 * that "the cover thing is wrong":
 *
 * 1. **Something must fire on `update`.** A cover cannot be cleared by a
 *    constraint — a constraint's only move is to refuse, and GAR-01′ asks for
 *    the removal to *succeed* with no cover left behind, not to be rejected.
 * 2. **It must fire `before` the row is written.** An `after` trigger cannot
 *    change the row it was handed, so the membership constraint has already
 *    judged a row whose cover left the array and refused the removal — which
 *    turns "remove this photo" into an error message the owner cannot act on.
 *    Mechanism, yes; but here the mechanism *is* the behaviour.
 * 3. **It must clear, never promote.** Every assignment to the cover column
 *    has to be `null`. "Silently promoting another one" is the phrase GAR-01′
 *    forbids, and `photo_paths[1]` is the tempting thing to promote.
 */
function coverClearingIssues(sql: string): string[] {
  const updateTriggers = vehicleTriggers(sql).filter((trigger) =>
    /\bupdate\b/.test(trigger)
  );
  if (updateTriggers.length === 0) {
    return [
      `public.${TABLE}: no trigger fires on update — removing a photo cannot ` +
        `clear the cover that named it`,
    ];
  }

  const issues: string[] = [];
  const clearing = updateTriggers.filter(
    (trigger) => coverAssignments(triggerBody(sql, trigger)).length > 0
  );

  if (clearing.length === 0) {
    issues.push(
      `public.${TABLE}: no update trigger assigns ${COVER_PHOTO_COLUMN} — a ` +
        `removed cover would be left as a dangling reference`
    );
    return issues;
  }

  for (const trigger of clearing) {
    const name = /^create trigger ([a-z0-9_]+)/.exec(trigger)?.[1] ?? "?";
    if (!/\bbefore\b/.test(trigger)) {
      issues.push(
        `public.${TABLE}: trigger ${name} fires after the row is written, so ` +
          `the membership constraint has already refused the removal it ` +
          `exists to allow`
      );
    }
    for (const rhs of coverAssignments(triggerBody(sql, trigger))) {
      if (!isNullAssignment(rhs)) {
        issues.push(
          `public.${TABLE}: trigger ${name} assigns ${COVER_PHOTO_COLUMN} ` +
            `the value \`${rhs}\` — GAR-01′ forbids promoting another photo`
        );
      }
    }
  }
  return issues;
}

/* =========================================================================
 * Tier A — declaration
 * ====================================================================== */

describe("the cover designation is a column of its own (GAR-01′)", () => {
  it.fails(`public.${TABLE}.${COVER_PHOTO_COLUMN} exists`, () => {
    // The column-level sweep in `schema-shape.test.ts` grades this too, from
    // the contract table. Repeated here on purpose: this file is where an
    // implementer looks, and a feature whose central column is only asserted
    // in a generic `it.each` three files away is a feature whose central
    // column is easy to miss.
    expect(
      columnDefinitionFor(migrationSql(), TABLE, COVER_PHOTO_COLUMN)
    ).not.toBeNull();
  });

  it.fails("is nullable — 'no cover' is a state, not an error", () => {
    // GAR-01′ requires a vehicle with photos and no cover to render the
    // placeholder, which means "no cover" has to be *storable*. A `not null`
    // would make the removal of a cover impossible to express except by
    // deleting every photo.
    const sql = migrationSql();

    expect(
      columnDefinitionFor(sql, TABLE, COVER_PHOTO_COLUMN),
      `${COVER_PHOTO_COLUMN} is not declared at all`
    ).not.toBeNull();
    expect(isNotNullFor(sql, TABLE, COVER_PHOTO_COLUMN)).toBe(false);
  });

  it.fails("carries no default — a cover is chosen, never assigned", () => {
    // A `default photo_paths[1]` would be the silent promotion GAR-01′
    // forbids, spelled as DDL, applied to every vehicle ever created, and
    // invisible in every diff after the one that added it.
    const definition = columnDefinitionFor(
      migrationSql(),
      TABLE,
      COVER_PHOTO_COLUMN
    );

    expect(
      definition,
      `${COVER_PHOTO_COLUMN} is not declared at all`
    ).not.toBeNull();
    const expression = defaultExpression(definition?.definition ?? "");
    expect(expression === null || expression === "null").toBe(true);
  });
});

describe("a cover the vehicle does not have is refused by the database", () => {
  it.fails("relates the cover column to photo_paths", () => {
    expect(coverMembershipIssues(migrationSql())).toEqual([]);
  });

  it.fails("does not settle for a constraint that ignores photo_paths", () => {
    // The second finding, named. Without this the grader above would be
    // satisfiable by any check that happened to mention the column — and
    // "mentions the column" is exactly what a hurried `check
    // (cover_photo_path <> '')` does.
    expect(coverMembershipIssues(migrationSql())).not.toContainEqual(
      expect.stringContaining("never compared against")
    );
    expect(coverMembershipIssues(migrationSql())).toEqual([]);
  });
});

describe("removing the cover photo clears the designation", () => {
  it.fails("fires something on update, before the row is written", () => {
    expect(coverClearingIssues(migrationSql())).toEqual([]);
  });

  it.fails("clears to null and never promotes another photo", () => {
    // Same rule, different half, asserted separately so a red suite says which
    // of the two an implementer missed. `photo_paths[1]` satisfies "assigns
    // the column" and violates the requirement.
    const issues = coverClearingIssues(migrationSql());

    expect(
      issues.filter((issue) => issue.includes("forbids promoting"))
    ).toEqual([]);
    expect(issues).toEqual([]);
  });
});

/* =========================================================================
 * Tier B — behavioural
 *
 * Nothing here uploads an object. That is deliberate: the cover designation
 * is a claim about two *columns*, and every question this tier asks — is the
 * membership refused, is the cover cleared, do two tabs interleave safely —
 * is answered without a byte in the bucket. The object lifecycle is
 * `vehicle-photos.test.ts`'s, already graded, and borrowing it here would make
 * every cover grader depend on the storage API being up.
 * ====================================================================== */

/** The columns this file reads back. Both may be absent before T2-306. */
interface CoverRow {
  readonly photo_paths?: readonly string[];
  readonly cover_photo_path?: string | null;
}

/** A vehicle owned by `actor` with `count` photo paths recorded, in order. */
async function vehicleWithPhotos(
  scenario: Scenario,
  actor: Actor,
  count: number
): Promise<{ readonly vehicleId: string; readonly paths: string[] }> {
  const inserted = await insertRow(scenario, actor, TABLE, {
    owner_id: actor.userId,
    display_name: testVehicleName(actor.slot),
    ...TEST_TAXONOMY_IDENTITY,
  });
  const rows = Array.isArray(inserted.body) ? inserted.body : [];
  const vehicle = rows[0] as { id?: string } | undefined;
  if (!inserted.ok || !vehicle?.id) {
    throw new Error(
      `could not create vehicle: ${inserted.status} ${inserted.text}`
    );
  }

  const paths = Array.from({ length: count }, (_unused, index) =>
    testVehiclePhotoPath(actor.userId ?? "", vehicle.id ?? "", `${index + 1}`)
  );
  if (paths.length > 0) {
    const linked = await updateRows(
      scenario,
      actor,
      TABLE,
      `id=eq.${vehicle.id}`,
      { photo_paths: paths }
    );
    if (!linked.ok) {
      throw new Error(
        `could not record photo_paths: ${linked.status} ${linked.text}`
      );
    }
  }

  return { vehicleId: vehicle.id, paths };
}

/**
 * The vehicle row as `actor` sees it.
 *
 * **Throws on a failed read rather than returning an empty row.** AGENTS.md's
 * "a failure is not a zero": a grader handed `{}` because the request failed
 * would go on to assert `cover_photo_path` is null and *pass*, reporting a
 * requirement satisfied by an outage.
 */
async function readVehicle(
  scenario: Scenario,
  actor: Actor,
  vehicleId: string
): Promise<CoverRow> {
  const response = await selectRows(
    scenario,
    actor,
    TABLE,
    `id=eq.${vehicleId}&select=*`
  );
  const rows = Array.isArray(response.body) ? response.body : [];
  if (!response.ok || rows.length !== 1) {
    throw new Error(
      `could not read vehicle ${vehicleId}: ${response.status} ${response.text}`
    );
  }
  return rows[0] as CoverRow;
}

/** Set (or, with `null`, clear) the cover — a patch of exactly one column. */
function setCover(
  scenario: Scenario,
  actor: Actor,
  vehicleId: string,
  path: string | null
): Promise<ApiResponse> {
  return updateRows(scenario, actor, TABLE, `id=eq.${vehicleId}`, {
    [COVER_PHOTO_COLUMN]: path,
  });
}

/** Replace the photo array — the shape a removal takes over PostgREST. */
function setPhotos(
  scenario: Scenario,
  actor: Actor,
  vehicleId: string,
  paths: readonly string[]
): Promise<ApiResponse> {
  return updateRows(scenario, actor, TABLE, `id=eq.${vehicleId}`, {
    [COVER_PHOTO_SOURCE_COLUMN]: paths,
  });
}

/**
 * The invariant, as a list of findings: a cover is null or a member, always.
 *
 * Returns a finding — rather than `false` — when the column is *absent*, so a
 * race grader run against a schema that never shipped the feature fails saying
 * so instead of reporting a sound end state it never actually observed.
 */
function coverIsSound(row: CoverRow): string[] {
  const cover = row.cover_photo_path;
  if (cover === undefined) {
    return [`${TABLE}.${COVER_PHOTO_COLUMN} is not a column on this row`];
  }
  if (cover === null) return [];
  const paths = row.photo_paths;
  if (paths === undefined) {
    return [
      `${TABLE}.${COVER_PHOTO_SOURCE_COLUMN} is not a column on this row`,
    ];
  }
  return paths.includes(cover)
    ? []
    : [`dangling cover: ${cover} is not among [${paths.join(", ")}]`];
}

describe.skipIf(!live.available)(
  liveTitle("a cover names a photo the vehicle actually has", live),
  () => {
    it.fails("an owner designates one of their own photos", async () => {
      // The positive control, and it is *first* in every grader below too: the
      // refusals in this block are all satisfied by a column that does not
      // exist, so each one proves the write path works before it proves the
      // wrong write is refused.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, paths } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          3
        );

        const set = await setCover(
          scenario,
          scenario.ownerA,
          vehicleId,
          paths[1]
        );
        expect(set.ok, set.text).toBe(true);

        const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
        expect(row.cover_photo_path).toBe(paths[1]);
        expect(coverIsSound(row)).toEqual([]);
      } finally {
        await teardownScenario(scenario);
      }
    });

    // **Independent of upload order** — the task line names this. The Nth
    // photo added, not just the most recent or the first. A table rather than
    // one assertion, because an implementation that special-cased either end
    // of the array would satisfy a single-case grader.
    it.fails.each([0, 1, 2].map((index) => [index]))(
      "photo %i of three can be the cover",
      async (index) => {
        const scenario = await provisionScenario(stackOf(live));
        try {
          const { vehicleId, paths } = await vehicleWithPhotos(
            scenario,
            scenario.ownerA,
            3
          );

          const set = await setCover(
            scenario,
            scenario.ownerA,
            vehicleId,
            paths[index]
          );
          expect(set.ok, set.text).toBe(true);

          const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
          expect(row.cover_photo_path).toBe(paths[index]);
          // The array is untouched by a designation: setting a cover is not a
          // reorder, and a "cover = first entry" implementation that moved the
          // chosen photo to the front would pass the assertion above.
          expect(row.photo_paths).toEqual(paths);
        } finally {
          await teardownScenario(scenario);
        }
      }
    );

    it.fails("a path the vehicle does not have is refused", async () => {
      // The defect the task line names: "not a user error to accept
      // silently". Structured positive-then-negative so a missing column fails
      // at the first step rather than passing the refusal vacuously.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, paths } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          2
        );
        const good = await setCover(
          scenario,
          scenario.ownerA,
          vehicleId,
          paths[0]
        );
        expect(good.ok, good.text).toBe(true);

        const stranger = testVehiclePhotoPath(
          scenario.ownerA.userId ?? "",
          vehicleId,
          "never-uploaded"
        );
        const bad = await setCover(
          scenario,
          scenario.ownerA,
          vehicleId,
          stranger
        );

        expect(bad.ok).toBe(false);
        const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
        expect(row.cover_photo_path).toBe(paths[0]);
        expect(coverIsSound(row)).toEqual([]);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it.fails("another vehicle's photo is refused", async () => {
      // The same rule with a path that is real, owned by the same person, and
      // still not this truck's. It is the plausible mistake — one garage, two
      // vehicles, one stale tab — where the invented path above is the
      // implausible one.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const mine = await vehicleWithPhotos(scenario, scenario.ownerA, 2);
        const other = await vehicleWithPhotos(scenario, scenario.ownerA, 2);

        const good = await setCover(
          scenario,
          scenario.ownerA,
          mine.vehicleId,
          mine.paths[0]
        );
        expect(good.ok, good.text).toBe(true);

        const bad = await setCover(
          scenario,
          scenario.ownerA,
          mine.vehicleId,
          other.paths[0]
        );

        expect(bad.ok).toBe(false);
        expect(
          (await readVehicle(scenario, scenario.ownerA, mine.vehicleId))
            .cover_photo_path
        ).toBe(mine.paths[0]);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it.fails("a vehicle with no photos cannot be given a cover", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          0
        );
        const invented = testVehiclePhotoPath(
          scenario.ownerA.userId ?? "",
          vehicleId,
          "1"
        );

        const set = await setCover(
          scenario,
          scenario.ownerA,
          vehicleId,
          invented
        );

        expect(set.ok).toBe(false);
        expect(
          coverIsSound(await readVehicle(scenario, scenario.ownerA, vehicleId))
        ).toEqual([]);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it.fails("the cover can be cleared explicitly", async () => {
      // T2-306's "Remove cover" affordance. Clearing is a designation of none,
      // not a deletion of the photo — so the photo must still be there
      // afterwards, which is the half a "remove cover" button wired to the
      // wrong handler gets wrong.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, paths } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          3
        );
        expect(
          (await setCover(scenario, scenario.ownerA, vehicleId, paths[2])).ok
        ).toBe(true);

        const cleared = await setCover(
          scenario,
          scenario.ownerA,
          vehicleId,
          null
        );
        expect(cleared.ok, cleared.text).toBe(true);

        const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
        expect(row.cover_photo_path).toBeNull();
        expect(row.photo_paths).toEqual(paths);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it.fails(
      "one owner cannot set the cover on another's vehicle",
      async () => {
        // A new writable column on an existing table inherits the update policy
        // — and "inherits" is a claim, not a fact, until something asks.
        const scenario = await provisionScenario(stackOf(live));
        try {
          const { vehicleId, paths } = await vehicleWithPhotos(
            scenario,
            scenario.ownerA,
            2
          );
          expect(
            (await setCover(scenario, scenario.ownerA, vehicleId, paths[0])).ok
          ).toBe(true);

          await setCover(scenario, scenario.ownerB, vehicleId, paths[1]);

          expect(
            (await readVehicle(scenario, scenario.ownerA, vehicleId))
              .cover_photo_path
          ).toBe(paths[0]);
        } finally {
          await teardownScenario(scenario);
        }
      }
    );
  }
);

describe.skipIf(!live.available)(
  liveTitle("removing the cover photo clears the designation", live),
  () => {
    it.fails("removing the cover leaves no cover", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, paths } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          3
        );
        expect(
          (await setCover(scenario, scenario.ownerA, vehicleId, paths[0])).ok
        ).toBe(true);

        // The removal **succeeds**. GAR-01′ asks for the designation to be
        // cleared, not for the removal to be refused — a schema that only
        // refused would leave the owner unable to delete their own photo.
        const removed = await setPhotos(scenario, scenario.ownerA, vehicleId, [
          paths[1],
          paths[2],
        ]);
        expect(removed.ok, removed.text).toBe(true);

        const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
        expect(row.cover_photo_path).toBeNull();
        expect(coverIsSound(row)).toEqual([]);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it.fails("does not silently promote another photo", async () => {
      // Stated separately and asserted as non-equalities, because
      // `toBeNull()` alone would also be satisfied by a resolver that returned
      // null for some other reason. GAR-01′'s words are "rather than silently
      // promoting another one", so the graders name the photos that must not
      // come back.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, paths } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          3
        );
        expect(
          (await setCover(scenario, scenario.ownerA, vehicleId, paths[1])).ok
        ).toBe(true);

        await setPhotos(scenario, scenario.ownerA, vehicleId, [
          paths[0],
          paths[2],
        ]);

        const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
        expect(row.cover_photo_path).not.toBe(paths[0]);
        expect(row.cover_photo_path).not.toBe(paths[2]);
        expect(row.cover_photo_path).toBeNull();
      } finally {
        await teardownScenario(scenario);
      }
    });

    it.fails("removing a NON-cover photo leaves the cover alone", async () => {
      // The over-reach direction: the same defect wearing the opposite coat,
      // and much harder to notice in production, because a cover that
      // *disappears* looks like a rendering glitch rather than a data one.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, paths } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          3
        );
        expect(
          (await setCover(scenario, scenario.ownerA, vehicleId, paths[2])).ok
        ).toBe(true);

        const removed = await setPhotos(scenario, scenario.ownerA, vehicleId, [
          paths[1],
          paths[2],
        ]);
        expect(removed.ok, removed.text).toBe(true);

        const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
        expect(row.cover_photo_path).toBe(paths[2]);
        expect(coverIsSound(row)).toEqual([]);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it.fails("emptying the photo array clears the cover", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, paths } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          2
        );
        expect(
          (await setCover(scenario, scenario.ownerA, vehicleId, paths[0])).ok
        ).toBe(true);

        const emptied = await setPhotos(
          scenario,
          scenario.ownerA,
          vehicleId,
          []
        );
        expect(emptied.ok, emptied.text).toBe(true);

        const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
        expect(row.cover_photo_path).toBeNull();
        expect(row.photo_paths).toEqual([]);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(liveTitle("two tabs, one truck", live), () => {
  // The concrete case the task line asks for. Both actors are `ownerA` with
  // the same token, because that is what two tabs *are* — not two users.
  // Every grader here runs the interleaving three ways: A then B, B then A,
  // and both at once, because a race that only shows up in one order is
  // still a race and picking an order is picking the answer.
  const ORDERS = ["a-then-b", "b-then-a", "concurrent"] as const;
  type Order = (typeof ORDERS)[number];

  async function interleave(
    order: Order,
    first: () => Promise<ApiResponse>,
    second: () => Promise<ApiResponse>
  ): Promise<void> {
    if (order === "a-then-b") {
      await first();
      await second();
      return;
    }
    if (order === "b-then-a") {
      await second();
      await first();
      return;
    }
    await Promise.all([first(), second()]);
  }

  it.fails.each(ORDERS.map((order) => [order]))(
    "%s: one tab removes the cover while the other re-designates it",
    async (order) => {
      // The delete-then-reselect race, at its sharpest. Tab B is looking at
      // a stale list that still shows the removed photo and clicks "set as
      // cover" on it. Whatever order the two writes land in, the row must
      // never end up naming a photo the array does not contain.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, paths } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          3
        );
        expect(
          (await setCover(scenario, scenario.ownerA, vehicleId, paths[0])).ok
        ).toBe(true);

        await interleave(
          order,
          () =>
            setPhotos(scenario, scenario.ownerA, vehicleId, [
              paths[1],
              paths[2],
            ]),
          () => setCover(scenario, scenario.ownerA, vehicleId, paths[0])
        );

        const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
        expect(coverIsSound(row), order).toEqual([]);
        expect(row.photo_paths).not.toContain(paths[0]);
      } finally {
        await teardownScenario(scenario);
      }
    }
  );

  it.fails.each(ORDERS.map((order) => [order]))(
    "%s: one tab removes the cover while the other picks a different photo",
    async (order) => {
      // The likelier version, and the one with a *right* answer rather than
      // only a safe one: tab B chooses a photo that survives the removal, so
      // the end state is either that photo or none — and never the removed
      // one.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, paths } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          3
        );
        expect(
          (await setCover(scenario, scenario.ownerA, vehicleId, paths[0])).ok
        ).toBe(true);

        await interleave(
          order,
          () =>
            setPhotos(scenario, scenario.ownerA, vehicleId, [
              paths[1],
              paths[2],
            ]),
          () => setCover(scenario, scenario.ownerA, vehicleId, paths[1])
        );

        const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
        expect(coverIsSound(row), order).toEqual([]);
        expect(row.cover_photo_path).not.toBe(paths[0]);
        expect([paths[1], null]).toContain(row.cover_photo_path);
      } finally {
        await teardownScenario(scenario);
      }
    }
  );

  it.fails.each(ORDERS.map((order) => [order]))(
    "%s: designating a cover does not lose a photo the other tab added",
    async (order) => {
      // **The grader that refuses to bless the same race in a different
      // form.** T2-304 found the original on `vehicles.photo_paths`: two
      // writers read-modify-write the array and one clobbers the other,
      // stranding a real storage object no row names (T2-305). A "set as
      // cover" implemented as a whole-row write — or as a patch carrying the
      // array it read a moment ago — is that same bug, on a surface where it
      // is harder to see, because the array still looks plausible and only
      // one photo is gone.
      //
      // Tab A adds a fourth photo. Tab B, holding a read from before it,
      // designates a cover. A single-column patch cannot lose A's addition
      // in any order; a stale-array write loses it in at least one.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, paths } = await vehicleWithPhotos(
          scenario,
          scenario.ownerA,
          3
        );
        const added = testVehiclePhotoPath(
          scenario.ownerA.userId ?? "",
          vehicleId,
          "4"
        );

        await interleave(
          order,
          () =>
            setPhotos(scenario, scenario.ownerA, vehicleId, [...paths, added]),
          () => setCover(scenario, scenario.ownerA, vehicleId, paths[1])
        );

        const row = await readVehicle(scenario, scenario.ownerA, vehicleId);
        expect(row.photo_paths, order).toContain(added);
        expect(row.cover_photo_path).toBe(paths[1]);
        expect(coverIsSound(row)).toEqual([]);
      } finally {
        await teardownScenario(scenario);
      }
    }
  );
});

/* =========================================================================
 * Controls on this file's own rules — unmarked, and they pass today
 *
 * `.claude/GRADER-PRINCIPLES.md`, twice over: every rule that can report a
 * violation is shown reporting *clean* on a genuinely correct case, and every
 * clause is broken on purpose against a fixture with a known answer. A rule
 * with no positive control drifts over-strict for months before anyone
 * notices; a rule with no negative control was decorative all along.
 * ====================================================================== */

/** A schema that gets the cover right, by check constraint plus trigger. */
const CORRECT = normalizeSql(`
  create table public.vehicles (
    id uuid primary key,
    owner_id uuid not null,
    photo_paths text[] not null default '{}'
  );

  alter table public.vehicles add column cover_photo_path text;

  alter table public.vehicles
    add constraint vehicles_cover_photo_path_ck
    check (cover_photo_path is null or cover_photo_path = any(photo_paths));

  create function public.clear_departed_cover()
  returns trigger language plpgsql as $$
  begin
    if new.cover_photo_path is not null
       and not (new.cover_photo_path = any(new.photo_paths)) then
      new.cover_photo_path := null;
    end if;
    return new;
  end;
  $$;

  create trigger vehicles_clear_departed_cover
    before update on public.vehicles
    for each row execute function public.clear_departed_cover();
`);

/** `CORRECT`, with one thing broken. */
function broken(replace: readonly [string, string]): string {
  const [from, to] = replace;
  expect(
    CORRECT,
    `mutation source \`${from}\` is not in the fixture`
  ).toContain(from);
  return CORRECT.replace(from, to);
}

describe("the membership rule fires, and stays quiet when it should", () => {
  it("POSITIVE CONTROL: reports nothing against a correct schema", () => {
    expect(coverMembershipIssues(CORRECT)).toEqual([]);
  });

  it("accepts a trigger that raises instead of a check constraint", () => {
    // Two correct designs, and demanding one would fail the other for no
    // reason a requirement can name (the `foreignKeyFor` three-spellings
    // precedent).
    const byTrigger = normalizeSql(`
      create table public.vehicles (
        id uuid primary key,
        photo_paths text[] not null default '{}',
        cover_photo_path text
      );

      create function public.guard_cover()
      returns trigger language plpgsql as $$
      begin
        if new.cover_photo_path is not null
           and not (new.cover_photo_path = any(new.photo_paths)) then
          raise exception 'cover photo is not one of this vehicle''s photos';
        end if;
        return new;
      end;
      $$;

      create trigger vehicles_guard_cover
        before insert or update on public.vehicles
        for each row execute function public.guard_cover();
    `);

    expect(coverMembershipIssues(byTrigger)).toEqual([]);
  });

  it("MUTATION: reports the column as unconstrained when nothing mentions it", () => {
    const unguarded = normalizeSql(`
      create table public.vehicles (
        id uuid primary key,
        photo_paths text[] not null default '{}',
        cover_photo_path text
      );
    `);

    expect(coverMembershipIssues(unguarded)).toEqual([
      expect.stringContaining("nothing constrains"),
    ]);
  });

  it("MUTATION: reports a constraint that ignores photo_paths", () => {
    // The realistic shape of the defect, not the obvious one: a check *is*
    // there, it just checks the wrong thing. This is the branch T2-401a's
    // review found untested on two other rules, so it is tested here.
    const shapeOnly = broken([
      "check (cover_photo_path is null or cover_photo_path = any(photo_paths))",
      "check (cover_photo_path is null or length(cover_photo_path) > 0)",
    ]);

    expect(coverMembershipIssues(shapeOnly)).toEqual([
      expect.stringContaining("never compared against"),
    ]);
  });

  it("MUTATION: a trigger that mentions both columns but never raises is not enforcement", () => {
    // A trigger that only *clears* satisfies the clearing rule and does not
    // satisfy this one, which is correct: clearing a departed cover says
    // nothing about refusing one that was never there.
    const clearingOnly = broken([
      "check (cover_photo_path is null or cover_photo_path = any(photo_paths))",
      "check (id is not null)",
    ]);

    expect(coverMembershipIssues(clearingOnly)).toEqual([
      expect.stringContaining("never compared against"),
    ]);
  });

  it("finds a check written inline on the column, not just as a table constraint", () => {
    // Postgres accepts both and neither is more correct. A rule that read only
    // the table-level form would fail a schema for its formatting.
    const inline = normalizeSql(`
      create table public.vehicles (
        id uuid primary key,
        photo_paths text[] not null default '{}',
        cover_photo_path text check (cover_photo_path = any(photo_paths))
      );
    `);

    expect(coverMembershipIssues(inline)).toEqual([]);
  });
});

describe("the clearing rule fires, and stays quiet when it should", () => {
  it("POSITIVE CONTROL: reports nothing against a correct schema", () => {
    expect(coverClearingIssues(CORRECT)).toEqual([]);
  });

  it("MUTATION: reports a missing update trigger", () => {
    const noTrigger = broken([
      "create trigger vehicles_clear_departed_cover before update on public.vehicles",
      "create trigger vehicles_clear_departed_cover after delete on public.vehicles",
    ]);

    expect(coverClearingIssues(noTrigger)).toEqual([
      expect.stringContaining("no trigger fires on update"),
    ]);
  });

  it("MUTATION: reports an update trigger that never touches the cover", () => {
    const silent = broken([
      "new.cover_photo_path := null;",
      "new.photo_paths := new.photo_paths;",
    ]);

    expect(coverClearingIssues(silent)).toEqual([
      expect.stringContaining(
        `no update trigger assigns ${COVER_PHOTO_COLUMN}`
      ),
    ]);
  });

  it("MUTATION: reports a trigger that fires after the row is written", () => {
    const late = broken([
      "before update on public.vehicles",
      "after update on public.vehicles",
    ]);

    expect(coverClearingIssues(late)).toEqual([
      expect.stringContaining("fires after the row is written"),
    ]);
  });

  it("MUTATION: reports a promotion to the first photo", () => {
    // The defect GAR-01′ names by hand — "rather than silently promoting
    // another one" — in the exact spelling somebody reaches for.
    const promoting = broken([
      "new.cover_photo_path := null;",
      "new.cover_photo_path := new.photo_paths[1];",
    ]);
    const issues = coverClearingIssues(promoting);

    expect(issues).toEqual([expect.stringContaining("forbids promoting")]);
    expect(issues[0]).toContain("new.photo_paths[1]");
  });

  it("MUTATION: reports a promotion however it is spelled", () => {
    // Not one spelling of the category — the category. A subquery over
    // `unnest` promotes exactly as hard as an array subscript and contains no
    // `[1]` for a literal-matching rule to catch.
    const subquery = broken([
      "new.cover_photo_path := null;",
      "new.cover_photo_path := (select p from unnest(new.photo_paths) as p limit 1);",
    ]);

    expect(coverClearingIssues(subquery)).toEqual([
      expect.stringContaining("forbids promoting"),
    ]);
  });

  it("accepts the update-clause spelling as well as the plpgsql one", () => {
    // `update … set cover_photo_path = null` is an assignment too, and a rule
    // that knew only `:=` would fail a statement trigger for its dialect.
    const bySetClause = normalizeSql(`
      create table public.vehicles (
        id uuid primary key,
        photo_paths text[] not null default '{}',
        cover_photo_path text
      );

      create function public.clear_cover()
      returns trigger language plpgsql as $$
      begin
        update public.vehicles
           set cover_photo_path = null
         where id = new.id and not (cover_photo_path = any(photo_paths));
        return new;
      end;
      $$;

      create trigger vehicles_clear_cover
        before update on public.vehicles
        for each row execute function public.clear_cover();
    `);

    expect(coverClearingIssues(bySetClause)).toEqual([]);
  });

  it("does not read a comparison as an assignment", () => {
    // The false-positive direction, which is the one that gets a rule turned
    // off rather than fixed. `if new.cover_photo_path = old.cover_photo_path`
    // is three tokens away from an assignment and means the opposite thing.
    const comparing = broken([
      "if new.cover_photo_path is not null",
      "if new.cover_photo_path = old.cover_photo_path then return new; end if; if new.cover_photo_path is not null",
    ]);

    expect(coverClearingIssues(comparing)).toEqual([]);
  });
});

describe("the helpers read the shipped schema, not an empty string", () => {
  // Every marked grader above is satisfied by a helper that finds nothing, so
  // these prove the helpers can find something in the DDL that really exists.
  const sql = migrationSql();

  it("finds the photo column T2-301 shipped", () => {
    expect(
      columnDefinitionFor(sql, TABLE, COVER_PHOTO_SOURCE_COLUMN)
    ).not.toBeNull();
  });

  it("finds the delete trigger T2-301 shipped on vehicles", () => {
    const triggers = vehicleTriggers(sql);

    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers.some((trigger) => /\bdelete\b/.test(trigger))).toBe(true);
  });

  it("follows that trigger to a function body with statements in it", () => {
    const deleteTrigger = vehicleTriggers(sql).find((trigger) =>
      /\bdelete\b/.test(trigger)
    );

    expect(deleteTrigger).toBeDefined();
    expect(triggerBody(sql, deleteTrigger ?? "")).toContain(
      "delete from storage.objects"
    );
  });

  it("finds the check constraints vehicles already carries", () => {
    // `vehicles_display_name_ck` and friends. If `checkExpressions` returned
    // nothing here, the membership rule would be reporting "nothing
    // constrains the cover" from a parser that cannot see a constraint at all.
    const found = checkExpressions(sql, TABLE);

    expect(found.length).toBeGreaterThan(0);
    expect(found.some((expr) => expr.includes("display_name"))).toBe(true);
  });

  it("reports today's schema as missing both halves of the requirement", () => {
    // The seam, asserted rather than assumed: the marked graders above must be
    // failing because the feature does not exist, and this says so in the one
    // place a reader will look when they wonder whether a marker is honest.
    expect(coverMembershipIssues(sql)).toEqual([
      expect.stringContaining("nothing constrains"),
    ]);
    expect(coverClearingIssues(sql)).toEqual([
      expect.stringContaining("no trigger fires on update"),
    ]);
    expect(columnDefinitionFor(sql, TABLE, COVER_PHOTO_COLUMN)).toBeNull();
  });
});

describe("the contract and the rules name the same columns", () => {
  it("declares the cover column on vehicles, pending T2-306", () => {
    // Nothing but this test makes `COVER_PHOTO_COLUMN` and the contract entry
    // the same string. A rename on one side would leave every rule above
    // looking for a column the schema does not have and reporting the absence
    // of an enforcement that is right there — which reads as a grader defect
    // and gets the rule turned off.
    const vehicles = USER_TABLES.find((table) => table.name === TABLE);
    const cover = vehicles?.columns.find(
      (column) => column.name === COVER_PHOTO_COLUMN
    );

    expect(
      cover,
      `${TABLE}.${COVER_PHOTO_COLUMN} is not in the contract`
    ).toBeDefined();
    expect(cover?.pending).toBe("T2-306");
    expect(cover?.requirement).toContain("GAR-01′");
  });

  it("declares the cover column nullable and with no default in the contract", () => {
    // The contract has to agree with the graders about the *shape*, or T2-306
    // is handed two specifications.
    const cover = USER_TABLES.find(
      (table) => table.name === TABLE
    )?.columns.find((column) => column.name === COVER_PHOTO_COLUMN);

    expect(cover?.notNull).toBeUndefined();
    expect(cover?.defaultsTo).toBeUndefined();
    expect(cover?.absenceDefaultAllowed).toBeUndefined();
  });

  it("names the photo array the membership rule compares against", () => {
    const vehicles = USER_TABLES.find((table) => table.name === TABLE);

    expect(vehicles?.columns.map((column) => column.name)).toContain(
      COVER_PHOTO_SOURCE_COLUMN
    );
  });
});

describe("columnDefinitionFor replays the sequence, not the first statement", () => {
  // T2-306a added this to `sql.ts`, and every pending column contract in this
  // repo now depends on it — `profiles.handle` (T2-402) as much as this one.
  // Graded here because this is the task that needed it.
  const CREATED = normalizeSql(`
    create table public.vehicles (
      id uuid primary key,
      photo_paths text[] not null default '{}'
    );
  `);

  it("finds a column the table was created with", () => {
    expect(
      columnDefinitionFor(CREATED, TABLE, "photo_paths")?.definition
    ).toContain("text[]");
  });

  it("finds a column a later alter table added", () => {
    const added = `${CREATED}; alter table public.vehicles add column cover_photo_path text;`;

    expect(
      columnDefinitionFor(added, TABLE, "cover_photo_path")?.definition
    ).toBe("text");
  });

  it("accepts `add` without the optional `column` keyword", () => {
    const added = `${CREATED}; alter table only public.vehicles add if not exists cover_photo_path text;`;

    expect(
      columnDefinitionFor(added, TABLE, "cover_photo_path")
    ).not.toBeNull();
  });

  it("reports a column added and later dropped as ABSENT", () => {
    // The end-state half. A rule that returned the last definition it saw,
    // ignoring the drop, would report a column that no longer exists — which
    // is the exact failure `.claude/GRADER-PRINCIPLES.md` records for the
    // revoke-then-grant sequence.
    const dropped =
      `${CREATED}; alter table public.vehicles add column cover_photo_path text;` +
      ` alter table public.vehicles drop column cover_photo_path;`;

    expect(columnDefinitionFor(dropped, TABLE, "cover_photo_path")).toBeNull();
  });

  it("follows a later `set not null` and `drop not null`", () => {
    const tightened =
      `${CREATED}; alter table public.vehicles add column cover_photo_path text;` +
      ` alter table public.vehicles alter column cover_photo_path set not null;`;
    const loosened = `${tightened} alter table public.vehicles alter column cover_photo_path drop not null;`;

    expect(isNotNullFor(tightened, TABLE, "cover_photo_path")).toBe(true);
    expect(isNotNullFor(loosened, TABLE, "cover_photo_path")).toBe(false);
  });

  it("follows a later `set default` and `drop default`", () => {
    const defaulted =
      `${CREATED}; alter table public.vehicles add column cover_photo_path text;` +
      ` alter table public.vehicles alter column cover_photo_path set default 'x';`;
    const undefaulted = `${defaulted} alter table public.vehicles alter column cover_photo_path drop default;`;

    expect(
      defaultExpression(
        columnDefinitionFor(defaulted, TABLE, "cover_photo_path")?.definition ??
          ""
      )
    ).toBe("'x'");
    expect(
      defaultExpression(
        columnDefinitionFor(undefaulted, TABLE, "cover_photo_path")
          ?.definition ?? ""
      )
    ).toBeNull();
  });

  it("splits a multi-action alter into its actions", () => {
    const multi = `${CREATED}; alter table public.vehicles add column cover_photo_path text, add column cover_set_at timestamptz;`;

    expect(
      columnDefinitionFor(multi, TABLE, "cover_photo_path")
    ).not.toBeNull();
    expect(columnDefinitionFor(multi, TABLE, "cover_set_at")).not.toBeNull();
  });

  it("does not mistake another table's alter for this one", () => {
    const elsewhere = `${CREATED}; alter table public.profiles add column cover_photo_path text;`;

    expect(
      columnDefinitionFor(elsewhere, TABLE, "cover_photo_path")
    ).toBeNull();
  });

  it("does not mistake `add constraint` for `add column`", () => {
    const constrained = `${CREATED}; alter table public.vehicles add constraint cover_photo_path_ck check (id is not null);`;

    expect(
      columnDefinitionFor(constrained, TABLE, "cover_photo_path")
    ).toBeNull();
  });
});
