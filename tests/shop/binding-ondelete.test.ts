/**
 * **T3-101a [TEST]** — `shares.bound_account_id` must unbind, not cascade or
 * block, when a mechanic deletes their own account (F2).
 *
 * ## The requirement, and why a boolean could not carry it
 *
 * 002 ACC-03 forbids gating account deletion, and 003's whole premise is that a
 * mechanic is an ordinary account (spec §2). So a mechanic must be able to
 * delete their account *while holding a live binding* — which means the FK from
 * `shares.bound_account_id` to `auth.users` has to be `on delete set null`:
 *
 *  - `set null` **unbinds** the grant (the owner keeps their grant row, it
 *    simply returns to unbound) — correct;
 *  - `cascade` would delete the owner's grant row because the *mechanic* left —
 *    the grant belongs to the vehicle owner, not the mechanic, so this is data
 *    loss for the wrong party (the T3-101 contract's `BOUND_ACCOUNT_COLUMN`
 *    note calls this out explicitly);
 *  - `no action` / `restrict` would **block** the mechanic's deletion — exactly
 *    the gating ACC-03 forbids.
 *
 * The 002 FK parser exposed only a `cascades` boolean, which cannot tell those
 * three apart. T3-101a extends the parser **additively** — a new
 * `foreignKeyOnDeleteFor` (and `onDeleteActionOf`) in `tests/garage/sql.ts`,
 * leaving `foreignKey`/`foreignKeyFor` and their exact-match self-tests
 * untouched — and this file grades the action itself.
 *
 * ## Two kinds of test here, on purpose
 *
 * 1. **Positive controls / boundary table** (plain `it`, green *today*): they
 *    feed synthetic DDL to the new parser and pin that it reads every on-delete
 *    action, in all four FK spellings, and tells "no FK" apart from "an FK with
 *    no on-delete clause". These are the `.claude/GRADER-PRINCIPLES.md`
 *    "mutation-test the probe corpus" guard: break the parser and these go red.
 * 2. **The grader** (`it.fails`, red *today*): the actual T3-101a assertion
 *    against the shipped migration. It fails now with a named absence (the
 *    column/FK do not exist pre-T3-102), never an import error; T3-102 activates
 *    it by deleting the one `.fails` line, and only a `set null` FK turns it
 *    green.
 *
 * refs specs/003-shop-tools (MEC-06), specs/002-montero-garage (ACC-03)
 */
import { describe, expect, it } from "vitest";
import {
  columnDefinitionFor,
  foreignKeyOnDeleteFor,
  migrationSql,
  normalizeSql,
  onDeleteActionOf,
  type OnDeleteAction,
} from "../garage/sql.ts";
import { BOUND_ACCOUNT_COLUMN, SHARES_TABLE } from "./contract.ts";

/* -------------------------------------------------------------------------
 * Boundary table — every referential action, in every FK spelling.
 *
 * Synthetic DDL against a made-up `test_bindings` table so nothing here can be
 * confused with the real schema. The one variable is the `on delete …` clause;
 * `action` is what the parser must read back.
 * ---------------------------------------------------------------------- */

const ON_DELETE_CASES = [
  {
    label: "on delete set null",
    clause: "on delete set null",
    action: "set null",
  },
  {
    label: "on delete cascade",
    clause: "on delete cascade",
    action: "cascade",
  },
  {
    label: "on delete restrict",
    clause: "on delete restrict",
    action: "restrict",
  },
  {
    label: "on delete no action",
    clause: "on delete no action",
    action: "no action",
  },
  {
    label: "on delete set default",
    clause: "on delete set default",
    action: "set default",
  },
  { label: "no on-delete clause", clause: "", action: "no action" },
] as const satisfies readonly {
  label: string;
  clause: string;
  action: OnDeleteAction;
}[];

/** Inline `references` on a column of the original `create table`. */
function inlineCreate(clause: string): string {
  return normalizeSql(
    `create table public.test_bindings (
       id uuid primary key,
       bound_account_id uuid references auth.users ${clause}
     );`
  );
}

/** Inline `references` on a column added by a later `alter table add column`. */
function alterAddColumn(clause: string): string {
  return normalizeSql(
    `create table public.test_bindings (id uuid primary key);
     alter table public.test_bindings
       add column bound_account_id uuid references auth.users ${clause};`
  );
}

/** A table-level `constraint … foreign key (col)` inside `create table`. */
function tableLevelConstraint(clause: string): string {
  return normalizeSql(
    `create table public.test_bindings (
       id uuid primary key,
       bound_account_id uuid,
       constraint test_bindings_bound_fk
         foreign key (bound_account_id) references auth.users ${clause}
     );`
  );
}

/** `alter table … add constraint … foreign key (col)` — what pg_dump emits. */
function alterAddConstraint(clause: string): string {
  return normalizeSql(
    `create table public.test_bindings (id uuid primary key, bound_account_id uuid);
     alter table public.test_bindings
       add constraint test_bindings_bound_fk
       foreign key (bound_account_id) references auth.users ${clause};`
  );
}

describe.each([
  ["inline in create table", inlineCreate],
  ["inline on an alter-add-column", alterAddColumn],
  ["a table-level constraint", tableLevelConstraint],
  ["an alter-table add-constraint", alterAddConstraint],
] as const)(
  "foreignKeyOnDeleteFor reads the on-delete action from %s",
  (_spelling, build) => {
    it.each(ON_DELETE_CASES)("$label → $action", ({ clause, action }) => {
      expect(
        foreignKeyOnDeleteFor(
          build(clause),
          "test_bindings",
          "bound_account_id"
        )
      ).toBe(action);
    });
  }
);

describe("onDeleteActionOf parses the delete action from a references clause", () => {
  it.each(ON_DELETE_CASES)(
    "`references auth.users $label` → $action",
    ({ clause, action }) => {
      expect(onDeleteActionOf(`uuid references auth.users ${clause}`)).toBe(
        action
      );
    }
  );

  it("reads the delete action even when an on-update clause precedes it", () => {
    // `set null` must win over the `cascade` that belongs to `on update`.
    expect(
      onDeleteActionOf(
        "uuid references auth.users on update cascade on delete set null"
      )
    ).toBe("set null");
  });
});

describe("foreignKeyOnDeleteFor tells no-FK apart from a no-action FK", () => {
  it("returns null when the column carries no foreign key at all", () => {
    const sql = normalizeSql(
      `create table public.test_bindings (id uuid primary key, note text);`
    );
    expect(foreignKeyOnDeleteFor(sql, "test_bindings", "note")).toBeNull();
  });

  it('returns "no action" (never null) for an FK with no on-delete clause', () => {
    // The distinction matters: null means "nothing to grade", "no action" means
    // "graded, and it is the wrong action" — never coalesce the two.
    const sql = normalizeSql(
      `create table public.test_bindings (
         id uuid primary key,
         bound_account_id uuid references auth.users
       );`
    );
    expect(
      foreignKeyOnDeleteFor(sql, "test_bindings", "bound_account_id")
    ).toBe("no action");
  });
});

/* -------------------------------------------------------------------------
 * The grader — red today, activated by T3-102.
 * ---------------------------------------------------------------------- */

describe("shares.bound_account_id unbinds on account deletion (F2, ACC-03)", () => {
  it("the bound_account_id → auth.users foreign key is `on delete set null`", () => {
    const sql = migrationSql();

    // Precondition, shared with the T3-101 core FK grader: the column and a
    // foreign key must exist. This is what fails honestly *today*, pre-T3-102
    // — a named absence, never an import error or an undefined deref.
    const def = columnDefinitionFor(sql, SHARES_TABLE, BOUND_ACCOUNT_COLUMN);
    expect(
      def,
      `${SHARES_TABLE}.${BOUND_ACCOUNT_COLUMN} is not declared`
    ).not.toBeNull();

    const action = foreignKeyOnDeleteFor(
      sql,
      SHARES_TABLE,
      BOUND_ACCOUNT_COLUMN
    );
    expect(
      action,
      `${BOUND_ACCOUNT_COLUMN} carries no foreign key — there is no ` +
        `on-delete action to grade`
    ).not.toBeNull();

    // ACC-03: a mechanic must be able to delete their own account while
    // holding a live binding. The binding UNBINDS (set null) — it must never
    // cascade-delete the owner's grant row, and never be `no action` /
    // `restrict`, either of which would block the mechanic's own deletion.
    expect(action).toBe("set null");
  });
});
