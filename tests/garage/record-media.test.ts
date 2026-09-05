/**
 * Graders — record media attachments (T2-305a [TEST]).
 *
 * > **GAR-06′** (owner-approved addition, 2026-09-02) A record SHALL support
 * > general documentation attachments — photo, video, or audio, in addition to
 * > GAR-05′'s image/PDF receipts — uploaded into user-private storage,
 * > independent of a receipt's vendor/date/amount fields. Never publicly
 * > accessible unless the record's visibility is opened. Motivating case: an
 * > owner's WhatsApp media (photos, videos, voice notes) documenting a shop's
 * > work, none of which is a receipt in GAR-05′'s financial sense.
 * > **SHR-01** Everything a user stores SHALL default to private.
 * > **ACC-03** … after a 30-day recovery window, all vehicles, records, and
 * > stored files SHALL be hard-deleted.
 *
 * Written before T2-305 [PLATFORM] exists, from the spec, by an instance that
 * will not implement it (AGENTS.md separation rule; T901 audits it through the
 * `X-Agent-Role` trailer). Modelled on T2-301a's vehicle-photos graders, which
 * is what the task list asks for — the private-bucket shape is a shape already
 * proved, and copying it deliberately is cheaper and safer than inventing a
 * second one.
 *
 * ## What is genuinely new here
 *
 * 1. **Three MIME categories, closed.** The photos bucket is image-only and
 *    the receipts bucket is image+PDF. This one is the first bucket whose
 *    allow-list spans categories, and the requirement names exactly three. So
 *    the restriction is graded as an **end state** — the value
 *    `allowed_mime_types` holds after every statement in the directory has
 *    run, not the text of the `insert` — because `on conflict do update set`
 *    and a later `update storage.buckets` are both ways to widen it silently.
 *    A bucket that accepts `application/pdf` has quietly become a second
 *    receipts bucket; one that accepts everything is a private general-purpose
 *    file host attached to a truck.
 * 2. **A delete-record trigger, which receipts never got.** T2-302 recorded
 *    the gap in its own `tasks.md` notes and left it open:
 *
 *    > **Found, not fixed — receipts have no delete-trigger belt.**
 *    > `on_vehicle_deleted` sweeps `vehicle-photos` by `<owner>/<vehicle>/`
 *    > prefix; receipt objects are `<owner>/<file>` (the contract's shape), so
 *    > no prefix identifies one vehicle's receipts and no trigger can find
 *    > them without reading the rows it is cascading away.
 *
 *    **T2-305a does not repeat that gap, and it does not repeat it by fixing
 *    the cause rather than the symptom**: the media path carries the record id
 *    (`<owner>/<vehicle>/<record>/<file>`, argued in `contract.ts`), which is
 *    what makes the belt writable at all. The trigger's existence, the bucket
 *    it targets, and the fact that it narrows to the record being deleted are
 *    three separate graders below, because a trigger that fires and deletes
 *    nothing and a trigger that fires and deletes a whole garage are different
 *    failures with the same green checkbox.
 *
 *    **Still open and named here so it is not forgotten a third time:
 *    `receipts` itself has no belt.** Nothing in this file closes it; the fix
 *    is a receipt path shape, which is a migration this task does not
 *    authorise and a change to already-stored object names. It stays flagged
 *    for whoever owns receipts hardening.
 * 3. **Independence from GAR-05′.** "independent of a receipt's
 *    vendor/date/amount fields" is a *negative* requirement, so it is graded
 *    negatively (no financial column may be required on a media row) and
 *    positively (a live insert carrying nothing but record, path and kind is
 *    accepted). Either one alone is satisfiable by a schema nobody wants.
 *
 * ## Contract decisions this task owns (all in `contract.ts`, all argued there)
 *
 * - bucket id **`record-media`**, table **`record_media`** — not
 *   `record-attachments`, which already describes receipts
 * - path **`<owner uuid>/<vehicle id>/<record id>/<file>`**
 * - columns `id`, `record_id`, `storage_path`, `media_kind`, and no others
 * - `media_kind` is the closed set `photo` | `video` | `audio`
 * - a **row per object**, not `records.media_paths text[]` — the array shape
 *   is what carries the lost-update race T2-304 found on `vehicles.photo_paths`
 *
 * ## What T2-305 owes, in full
 *
 * **Graded here, activated by deleting a `.fails` and nothing else** — the
 * bucket and its four policies; the MIME allow-list; the `record_media` table,
 * its columns, its cascade and its closed `media_kind`; RLS enabled *and*
 * forced with all four commands policed through the vehicle; the independence
 * of receipt fields; **a delete trigger on `public.records` that reaches the
 * media bucket and narrows to `old.id`**; and the account purge reaching the
 * new bucket. The trigger is called out by name here because it is the one
 * requirement that does not fall out of copying the photos migration —
 * `on_vehicle_deleted` is a *vehicles* trigger, and cascade-deleting a record
 * is not the same event.
 *
 * **Two things that need an edit beyond a `.fails`:**
 *
 * 1. **Promotion.** The generic sweeps in `schema-shape.test.ts`,
 *    `rls-deny-by-default.test.ts` and `deletion-cascade.test.ts` are driven
 *    from `USER_TABLES`, and `record_media` is deliberately **not** in it yet
 *    — a contract for a table no migration creates would turn those *unmarked*
 *    sweeps red, and an unmarked red is indistinguishable from a broken suite.
 *    `PENDING_USER_TABLES` holds it instead, and the marked grader
 *    `"record_media is enumerated in USER_TABLES"` fails until T2-305 promotes
 *    it. `contract.ts` spells out the three edits promotion takes.
 * 2. **The ACL.** Supabase's default privileges grant ALL on a new table in
 *    `public`, and an explicit `grant` adds to that ACL rather than replacing
 *    it (T2-202's F2). Revoke by name first, then grant the four verbs to
 *    `authenticated` only, or the anonymous-privilege sweeps go red.
 *
 * **Nothing else in this file should need editing.** Every unmarked control
 * here is written to stay true after T2-305 lands: two of them originally
 * pinned *today's* migration state — "there is no records delete trigger" and
 * "record_media is in `PENDING_USER_TABLES`" — which would have forced T2-305
 * to edit a grader to do the right thing, the separation violation T901 audits
 * for. Both were rewritten to assert the property rather than the calendar
 * (review F1). If you find yourself needing to change a grader that is not
 * marked, that is a defect in this file — say so rather than editing it.
 *
 * ## Expected-failure convention
 *
 * `it.fails` is the marker; T2-305 activates a grader by deleting exactly that
 * `.fails` and nothing else. Positive controls sit unmarked beside every
 * negative assertion — a grader that fails because a helper found nothing
 * looks identical in the report to one that fails because the guarantee is
 * missing, and they mean opposite things.
 *
 * **A live denial is always paired with a live success in the same test.** Four
 * Tier-B graders here originally asserted only `expect(response.ok).toBe(false)`
 * — owner B cannot upload, owner B cannot attach, the bucket refuses a PDF, the
 * table refuses an unnamed kind — and every one of them *passed* against a
 * stack with no bucket and no table, because absence refuses everybody just as
 * convincingly as a correct policy does. They could not distinguish "enforced"
 * from "not built", which is the whole question they exist to answer. The
 * Tier-B CI job caught it by reporting `Expect test to fail` on a marked
 * grader: a marker that passes is not a small bookkeeping error, it is a
 * grader that will still pass when the feature ships broken. Each now proves
 * the legitimate actor succeeds before asserting the illegitimate one fails.
 *
 * refs specs/002-montero-garage (GAR-06′, GAR-05′, SHR-01, ACC-03)
 */
import { describe, expect, it } from "vitest";
import {
  NON_MEDIA_MIME_TYPE,
  PENDING_USER_TABLES,
  PRIVATE_BUCKETS,
  RECEIPTS_BUCKET,
  RECEIPT_FINANCIAL_COLUMNS,
  RECORD_MEDIA_BUCKET,
  RECORD_MEDIA_KINDS,
  RECORD_MEDIA_KIND_NAMES,
  RECORD_MEDIA_TABLE,
  TEST_TAXONOMY_IDENTITY,
  USER_TABLES,
  USER_TABLE_NAMES,
  VEHICLE_PHOTOS_BUCKET,
  testRecordMediaPath,
  testVehicleName,
} from "./contract.ts";
import {
  type Actor,
  type Scenario,
  SYNTHETIC_JPEG,
  deleteRows,
  detectLiveStack,
  downloadObject,
  fetchPublicObject,
  followSignedUrl,
  insertRow,
  listObjects,
  liveTitle,
  provisionScenario,
  runAccountPurge,
  selectRows,
  signObject,
  stackOf,
  teardownScenario,
  uploadObject,
} from "./harness.ts";
import {
  bucketPolicyIssues,
  bucketPrivacyIssues,
  coveredCommands,
  userTablePolicyIssues,
} from "./rules.ts";
import {
  balancedAt,
  columnDefinition,
  createTableBody,
  enablesRls,
  foreignKeyFor,
  forcesRls,
  isNotNullFor,
  migrationSql,
  normalizeSql,
  statements,
  tableItems,
} from "./sql.ts";

const live = await detectLiveStack();

const TABLE = RECORD_MEDIA_TABLE.name;

/* =========================================================================
 * Declaration-tier helpers
 *
 * Local to this file, exactly as T2-301a kept its own — a rule that has never
 * been used twice does not belong in `rules.ts`, where every export is a
 * shared surface with its own probe corpus.
 * ====================================================================== */

/**
 * The `create function` statement for `name`, body included — **the last one**.
 *
 * Last-definition-wins, for the reason T2-301a recorded: `create or replace`
 * is how a shipped routine is extended once `db push` has run, so reading the
 * *first* definition grades a version no longer in force and would reject the
 * correct fix for the very gap this file demands.
 */
function functionBody(sql: string, name: string): string {
  const defined = statements(sql).filter((statement) =>
    new RegExp(`create (?:or replace )?function [a-z_.]*${name}\\b`).test(
      statement
    )
  );
  return defined.at(-1) ?? "";
}

/**
 * `true` when a routine's storage cleanup actually reaches `bucket`.
 *
 * An unfiltered `delete from storage.objects` reaches every bucket. A filtered
 * one reaches only the buckets it names.
 */
function deletionReachesBucket(body: string, bucket: string): boolean {
  if (!/delete from storage\.objects/.test(body)) return false;
  if (!/bucket_id/.test(body)) return true;
  return body.includes(`'${bucket}'`);
}

/** The `create trigger` statement that fires on a row of `table` being deleted. */
function deleteTriggerOn(sql: string, table: string): string | undefined {
  return statements(sql).find(
    (statement) =>
      statement.startsWith("create trigger") &&
      /\bdelete\b/.test(statement) &&
      new RegExp(`\\bon (?:public\\.)?${table}\\b`).test(statement)
  );
}

/**
 * The body of whatever function `table`'s delete trigger calls.
 *
 * Follows `execute function <name>` rather than matching a list of plausible
 * names (T2-301a review, F1): an implementer who writes the equally natural
 * `cleanup_record_media` instead of `handle_record_deleted` must have a route
 * to green that is not "rename your function to satisfy a test".
 */
function deleteCleanupBody(sql: string, table: string): string {
  const trigger = deleteTriggerOn(sql, table);
  if (!trigger) return "";
  const target = /execute (?:function|procedure)\s+([a-z0-9_.]+)\s*\(/.exec(
    trigger
  )?.[1];
  if (!target) return "";
  const bare = target.includes(".") ? target.split(".").pop() : target;
  return bare ? functionBody(sql, bare) : "";
}

/** Every `delete from storage.objects …;` inside a routine body. */
function storageDeletes(body: string): string[] {
  return [...body.matchAll(/delete from storage\.objects[\s\S]*?;/g)].map(
    (match) => match[0]
  );
}

/**
 * Findings against a cleanup routine's *scope*.
 *
 * Two failures wear the same green checkbox and are opposites: a trigger that
 * deletes nothing (the object outlives its record, ACC-03 and the quota both
 * lose) and a trigger that deletes by owner prefix alone (deleting one record
 * empties the whole garage — the same defect wearing the opposite coat, and
 * far harder to notice in production, because nobody checks the *other*
 * records after deleting one).
 *
 * `old.id` is what a row-level `after delete` trigger on `records` has to read
 * to know which record it is; there is no other spelling of that fact, so
 * requiring it is a claim about the narrowing and not about the author's
 * style. The bucket filter is deliberately permissive: a cleanup that names no
 * `bucket_id` at all reaches every bucket, which is over-broad about buckets
 * and still correctly narrow about the record.
 */
function recordScopeIssues(body: string, bucket: string): string[] {
  if (body === "") return ["no cleanup routine found"];
  const reaching = storageDeletes(body).filter(
    (statement) =>
      !/bucket_id/.test(statement) || statement.includes(`'${bucket}'`)
  );
  if (reaching.length === 0) {
    return [`no delete from storage.objects reaches ${bucket}`];
  }
  return reaching
    .filter((statement) => !/\bold\.(?:id|"id")\b/.test(statement))
    .map(
      (statement) =>
        `a deletion reaching ${bucket} is not narrowed to the deleted row ` +
        `(no old.id): ${statement.slice(0, 160)}`
    );
}

/* -------------------------------------------------------------------------
 * `allowed_mime_types`, graded as an end state
 * ---------------------------------------------------------------------- */

/**
 * What `allowed_mime_types` holds after the whole migration directory has run.
 *
 * Four states, and the three that are not `restricted` are **not** collapsed
 * into "no findings" or "empty list". `undeclared` (nobody ever set it),
 * `unrestricted` (explicitly `null`, which Supabase reads as "any type"), and
 * `unparsed` (set to an expression this module cannot read) are each a
 * different thing to tell a reader, and the last one especially: a grader that
 * cannot read a value must say so rather than pass. AGENTS.md, *Facts*: "A
 * failure is not a zero."
 */
type MimeRestriction =
  | { readonly state: "undeclared" }
  | { readonly state: "unrestricted" }
  | { readonly state: "unparsed"; readonly raw: string }
  | { readonly state: "restricted"; readonly types: readonly string[] };

/**
 * Split on commas that are outside parens, **brackets**, and string literals.
 *
 * `sql.ts`'s `splitTopLevelCommas` tracks parens and quotes but not brackets,
 * which is correct for the policy predicates and column lists it was written
 * for and wrong here: the one value this module has to read is an
 * `array['image/jpeg', 'video/mp4']`, and a splitter blind to `[` cuts it in
 * half at the first comma. That failure is silent and looks exactly like an
 * unreadable expression, so it is fixed rather than worked around. Local
 * rather than a change to `sql.ts`: nothing else needs it yet, and widening a
 * shared parser used by every security rule in the directory to serve one
 * caller is not a trade worth making.
 *
 * ## Escaped quotes: `''` is handled, and here is why (PR #96 review)
 *
 * The quote tracking is a bare parity toggle, which *looks* wrong for SQL's
 * doubled-quote escape — `'it''s'` — and is not. The escape is two **adjacent**
 * quote characters, so it flips `quoted` twice and lands back where it started,
 * and no comma can ever sit between them to be mis-read while the flag is
 * momentarily wrong. Parity is preserved at every position a comma can occupy,
 * which is the only property the split depends on. Verified rather than
 * reasoned about: the controls in "the splitter survives SQL's escaped quotes"
 * run the ugly cases, including a literal that carries a comma *and* an escaped
 * quote (`'a,b''c,d'`), and an end-to-end insert whose bucket **name** is
 * `'it''s, media'`.
 *
 * ## The one form it does NOT handle, named rather than left to be discovered
 *
 * Postgres also accepts backslash escapes inside an `E''` string, and
 * `e'a\',b'` genuinely does mis-split — the backslashed quote breaks parity.
 * That is not a hole this function can close on its own: `normalizeSql` in
 * `sql.ts` does not understand E-strings either, so the literal is already
 * mangled before it arrives here, and every rule in this directory shares that
 * limitation. It is unreachable through content (a bucket id, a bucket name and
 * a MIME type cannot contain a backslash), but "unreachable" is not the same as
 * "safe", so `mimeRestriction` refuses to read any `storage.buckets` statement
 * containing a backslash and reports `unparsed` instead of guessing.
 */
function splitTopLevelItems(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") quoted = !quoted;
    if (quoted) continue;
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      out.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

/** The balanced group opened by the first `(` matched by `opener`. */
function parenAfter(statement: string, opener: RegExp): string | null {
  const match = opener.exec(statement);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  return balancedAt(statement, open)?.inner ?? null;
}

/**
 * **Every** top-level tuple after `values`, not just the first.
 *
 * A multi-row insert is one statement with several rows —
 * `values ('receipts', …), ('record-media', …)` — and reading only the first
 * one and attributing it to every bucket the statement names is a rule that
 * **fails open**: a migration that restricts `receipts` properly and creates
 * `record-media` with `allowed_mime_types` null reports the media bucket as
 * correctly restricted while it accepts any file at all. That is the exact
 * "private general-purpose file host attached to a truck" this module exists
 * to prevent, arriving through the module meant to catch it (review F2, and
 * reproduced before it was fixed).
 *
 * The caller picks the right tuple by matching the `id` literal, and falls
 * back to `unparsed` when it cannot — which is the only honest answer and the
 * one that fails closed.
 */
function valueTuples(statement: string): string[] {
  const match = /\bvalues\s*\(/.exec(statement);
  if (!match) return [];

  const tuples: string[] = [];
  let index = match.index + match[0].length - 1;
  while (index < statement.length && statement[index] === "(") {
    const group = balancedAt(statement, index);
    if (!group) break;
    tuples.push(group.inner);

    let cursor = group.close + 1;
    while (cursor < statement.length && /\s/.test(statement[cursor])) {
      cursor += 1;
    }
    if (statement[cursor] !== ",") break;
    cursor += 1;
    while (cursor < statement.length && /\s/.test(statement[cursor])) {
      cursor += 1;
    }
    index = cursor;
  }
  return tuples;
}

/**
 * `true` when a statement uses string escaping this module cannot lex.
 *
 * Only one form qualifies: a backslash, which in an `E''` string escapes the
 * quote that follows it and breaks the parity `splitTopLevelItems` relies on.
 * SQL's own `''` escape is handled correctly and is *not* flagged.
 *
 * A backslash in a `storage.buckets` statement is anomalous to begin with — a
 * bucket id, a bucket name and a MIME type have no use for one — so the false
 * positive rate is zero in practice and the failure direction is the safe one.
 * `.claude/GRADER-PRINCIPLES.md`: "the safe failure direction is
 * over-matching — a spurious finding costs a reviewer five minutes; a missed
 * one is a live hole."
 */
function hasUnreadableEscape(statement: string): boolean {
  return statement.includes("\\");
}

/**
 * The one tuple that inserts `bucket`, or `null` when that cannot be decided.
 *
 * A single-row insert is unambiguous — the statement names the bucket and has
 * one row, so that row is the bucket's. Beyond that the row has to be picked
 * by its `id` literal, and anything that leaves the choice unclear (no `id`
 * column in the list, no row matching, two rows matching) returns `null` so
 * the caller can report `unparsed`. Guessing here is what fails open.
 */
function tupleFor(
  tuples: readonly string[],
  columnNames: readonly string[],
  bucket: string
): string | null {
  if (tuples.length === 1) return tuples[0];

  const idIndex = columnNames.indexOf("id");
  if (idIndex < 0) return null;

  const matching = tuples.filter((tuple) => {
    const parts = splitTopLevelItems(tuple);
    if (idIndex >= parts.length) return false;
    return parts[idIndex].trim().replace(/^'|'$/g, "") === bucket;
  });
  return matching.length === 1 ? matching[0] : null;
}

/** The `set …` clause of an update, cut at its top-level `where`. */
function setClause(statement: string): string | null {
  const match = /\bset\b/.exec(statement);
  if (!match) return null;
  const rest = statement.slice(match.index + match[0].length);
  let depth = 0;
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (
      depth === 0 &&
      /\s/.test(char) &&
      /^\s*where\b/.test(rest.slice(index))
    ) {
      return rest.slice(0, index).trim();
    }
  }
  return rest.trim();
}

/** The expression assigned to `column` by a `set` clause, or `null`. */
function assignedExpression(statement: string, column: string): string | null {
  const clause = setClause(statement);
  if (clause === null) return null;
  for (const part of splitTopLevelItems(clause)) {
    const match = new RegExp(`^${column}\\s*=\\s*([\\s\\S]+)$`).exec(part);
    if (match) return match[1].trim();
  }
  return null;
}

/** Read one assigned expression into a restriction state. */
function readMimeExpression(
  expr: string,
  previous: MimeRestriction
): MimeRestriction {
  const trimmed = expr.replace(/::\s*[a-z_]+(\s*\[\s*\])*\s*$/, "").trim();

  if (trimmed === "null") return { state: "unrestricted" };
  // `on conflict … do update set allowed_mime_types = excluded.allowed_mime_types`
  // re-applies the value from the same statement's `values`, which the caller
  // has already read. Not a change, and certainly not unreadable.
  if (trimmed === `excluded.${"allowed_mime_types"}`) return previous;

  if (/^array\s*\[/.test(trimmed)) {
    const open = trimmed.indexOf("[");
    const close = trimmed.lastIndexOf("]");
    if (close > open) {
      return {
        state: "restricted",
        types: splitTopLevelItems(trimmed.slice(open + 1, close))
          .map((item) => item.trim().replace(/^'|'$/g, "").trim())
          .filter(Boolean),
      };
    }
  }

  const braced = /^'\{([\s\S]*)\}'$/.exec(trimmed);
  if (braced) {
    return {
      state: "restricted",
      types: braced[1]
        .split(",")
        .map((item) => item.trim().replace(/^"|"$/g, "").trim())
        .filter(Boolean),
    };
  }

  return { state: "unparsed", raw: expr };
}

/**
 * Replay every statement that touches `storage.buckets`, in order, and report
 * what `bucket`'s `allowed_mime_types` ends up as.
 *
 * Three ways to widen a restriction after declaring it, and a grader that read
 * only the `insert` would miss all three: `on conflict (id) do update set`, a
 * later `update … where id = '<bucket>'`, and a later `update` with **no**
 * `where` at all, which reaches every bucket in the project. The last one is
 * the reason this walks unscoped updates too — it is the exact shape
 * `bucketPrivacyIssues` grew a second loop for after the same review.
 */
function mimeRestriction(sql: string, bucket: string): MimeRestriction {
  let current: MimeRestriction = { state: "undeclared" };
  const literal = `'${bucket}'`;

  for (const statement of statements(sql)) {
    if (!statement.includes("storage.buckets")) continue;

    if (statement.startsWith("insert into storage.buckets")) {
      if (!statement.includes(literal)) continue;
      if (hasUnreadableEscape(statement)) {
        current = {
          state: "unparsed",
          raw:
            `the statement uses backslash string escaping, which this module ` +
            `cannot lex: ${statement.slice(0, 120)}`,
        };
        continue;
      }
      const columns = parenAfter(
        statement,
        /insert into storage\.buckets\s*\(/
      );
      const tuples = valueTuples(statement);
      if (columns === null || tuples.length === 0) {
        current = {
          state: "unparsed",
          raw: `insert without a readable column list: ${statement.slice(0, 120)}`,
        };
      } else {
        const names = splitTopLevelItems(columns).map((name) => name.trim());
        const row = tupleFor(tuples, names, bucket);
        if (row === null) {
          current = {
            state: "unparsed",
            raw:
              `a multi-row insert names ${bucket} but no single row can be ` +
              `attributed to it: ${statement.slice(0, 120)}`,
          };
        } else {
          const exprs = splitTopLevelItems(row);
          const index = names.indexOf("allowed_mime_types");
          if (index >= 0 && index < exprs.length) {
            current = readMimeExpression(exprs[index], current);
          }
        }
      }
      const conflict = assignedExpression(statement, "allowed_mime_types");
      if (conflict !== null) current = readMimeExpression(conflict, current);
      continue;
    }

    if (statement.startsWith("update storage.buckets")) {
      const scoped = /\bwhere\b/.test(statement);
      if (scoped && !statement.includes(literal)) continue;
      if (hasUnreadableEscape(statement)) {
        current = {
          state: "unparsed",
          raw:
            `the statement uses backslash string escaping, which this module ` +
            `cannot lex: ${statement.slice(0, 120)}`,
        };
        continue;
      }
      const assigned = assignedExpression(statement, "allowed_mime_types");
      if (assigned !== null) current = readMimeExpression(assigned, current);
    }
  }
  return current;
}

/**
 * Every finding against "this bucket allows the three declared kinds and
 * nothing else".
 *
 * Graded per **category**, not per spelling. `video/mp4` and
 * `video/quicktime` are both video and a rule that enumerated one would
 * reject the other for no reason GAR-06′ can name — the same mistake as
 * matching `select *` instead of whole-row projection. Both directions are
 * findings: a category present that the requirement does not name, and a
 * category the requirement names that is absent (an "audio" bucket that
 * refuses every voice note is the motivating case failing silently).
 */
function mimeRestrictionIssues(sql: string, bucket: string): string[] {
  const restriction = mimeRestriction(sql, bucket);

  if (restriction.state === "undeclared") {
    return [
      `${bucket}: allowed_mime_types is never declared — the bucket accepts ` +
        `any file type, which makes it a private general-purpose file host`,
    ];
  }
  if (restriction.state === "unrestricted") {
    return [
      `${bucket}: allowed_mime_types ends as null — every restriction was ` +
        `removed by a later statement`,
    ];
  }
  if (restriction.state === "unparsed") {
    return [
      `${bucket}: allowed_mime_types is set to something these graders cannot ` +
        `read, so nothing is proved either way: ${restriction.raw}`,
    ];
  }

  const issues: string[] = [];
  if (restriction.types.length === 0) {
    issues.push(
      `${bucket}: allowed_mime_types is empty — nothing can be uploaded`
    );
  }

  const prefixes = RECORD_MEDIA_KINDS.map((entry) => entry.mimePrefix);
  for (const type of restriction.types) {
    if (!prefixes.some((prefix) => type.startsWith(prefix))) {
      issues.push(
        `${bucket}: allows ${type}, which is neither photo, video, nor audio`
      );
    }
  }
  for (const entry of RECORD_MEDIA_KINDS) {
    if (!restriction.types.some((type) => type.startsWith(entry.mimePrefix))) {
      issues.push(
        `${bucket}: no ${entry.kind} type is allowed — GAR-06′ names all three`
      );
    }
  }
  return issues;
}

/* -------------------------------------------------------------------------
 * Independence from GAR-05′
 * ---------------------------------------------------------------------- */

/**
 * Findings against "a receipt's fields are never required on an attachment".
 *
 * A missing table is a finding rather than a clean result: "we checked and the
 * table imposes nothing" and "there is no table to check" are different
 * answers and only one of them means the requirement is met.
 */
function requiredReceiptFieldIssues(sql: string, table: string): string[] {
  const body = createTableBody(sql, table);
  if (body === null) {
    return [`${table}: no create table statement, so nothing can be checked`];
  }
  return RECEIPT_FINANCIAL_COLUMNS.filter(
    (column) =>
      columnDefinition(body, column) !== null &&
      isNotNullFor(sql, table, column)
  ).map(
    (column) =>
      `${table}.${column} is required — GAR-06′ says an attachment is ` +
      `independent of a receipt's vendor/date/amount fields`
  );
}

/* -------------------------------------------------------------------------
 * The closed set of media kinds
 * ---------------------------------------------------------------------- */

/**
 * Whatever DDL constrains `table.column` to a closed set, or `""`.
 *
 * Four spellings are all correct Postgres and all accepted: an inline
 * `check`, a table-level `check`, a `create type … as enum`, and a later
 * `alter table … add constraint … check`. Demanding one of them would be a
 * contract nobody declared — the same F1 mistake as hard-coding a trigger
 * function's name.
 */
function closedSetDdl(sql: string, table: string, column: string): string {
  const body = createTableBody(sql, table);
  if (body === null) return "";

  const definition = columnDefinition(body, column);
  if (definition && /\bcheck\s*\(/.test(definition.definition)) {
    return definition.definition;
  }

  for (const item of tableItems(body)) {
    if (/\bcheck\s*\(/.test(item) && item.includes(column)) return item;
  }

  const typeName = definition
    ? /^\s*(?:[a-z0-9_]+\.)?([a-z0-9_]+)/.exec(definition.definition)?.[1]
    : undefined;
  if (typeName) {
    const created = statements(sql).find((statement) =>
      new RegExp(
        `^create (?:type|domain) (?:[a-z0-9_]+\\.)?${typeName}\\b`
      ).test(statement)
    );
    if (created) return created;
  }

  const altered = statements(sql).find(
    (statement) =>
      statement.startsWith("alter table") &&
      new RegExp(`\\b${table}\\b`).test(statement) &&
      /\bcheck\s*\(/.test(statement) &&
      statement.includes(column)
  );
  return altered ?? "";
}

/* =========================================================================
 * Tier A — declaration: the bucket
 * ====================================================================== */

describe("the record-media bucket is created private", () => {
  it("creates a private bucket and never flips it public", () => {
    expect(bucketPrivacyIssues(migrationSql(), RECORD_MEDIA_BUCKET)).toEqual(
      []
    );
  });

  it("polices the bucket, on all four commands, scoped by path", () => {
    // `bucketPolicyIssues` rather than `storagePolicyIssues`: the whole-table
    // rule is satisfied today by receipts and photos alone, and would stay
    // satisfied if this bucket shipped with no policy whatsoever — every
    // policy that exists would be sound, and the missing one is not a policy.
    expect(bucketPolicyIssues(migrationSql(), RECORD_MEDIA_BUCKET)).toEqual([]);
  });

  it("grants no record-media policy to anon", () => {
    // Both halves matter. Filtering for "granted to" alone passes vacuously
    // today — there are no media policies, so none are granted to anon — which
    // is a grader reporting success because the feature is missing.
    const issues = bucketPolicyIssues(migrationSql(), RECORD_MEDIA_BUCKET);

    expect(issues.filter((issue) => issue.includes("granted to"))).toEqual([]);
    expect(issues).not.toContain(
      `storage.objects: no policy names the ${RECORD_MEDIA_BUCKET} bucket`
    );
  });

  it("restricts the bucket to photo, video and audio and nothing else", () => {
    expect(mimeRestrictionIssues(migrationSql(), RECORD_MEDIA_BUCKET)).toEqual(
      []
    );
  });

  it.each(RECORD_MEDIA_KINDS.map((entry) => [entry.kind, entry.mimePrefix]))(
    "allows at least one %s type (%s…)",
    (_kind, prefix) => {
      // The per-kind half, as a boundary table rather than one aggregate
      // assertion: a bucket that allows images and nothing else satisfies "no
      // disallowed category is present" completely, and is the exact shape the
      // `vehicle-photos` bucket already has. The WhatsApp voice note is the
      // motivating case and it is the one an image-only allow-list drops.
      const restriction = mimeRestriction(migrationSql(), RECORD_MEDIA_BUCKET);

      expect(restriction.state, JSON.stringify(restriction)).toBe("restricted");
      expect(
        restriction.state === "restricted" ? restriction.types : []
      ).toEqual(expect.arrayContaining([expect.stringContaining(prefix)]));
    }
  );

  it(`refuses ${NON_MEDIA_MIME_TYPE}, which belongs to receipts`, () => {
    // The boundary between GAR-05′ and GAR-06′, stated as the thing that must
    // NOT be true. If the media bucket takes PDFs it has become a second
    // receipts bucket and "independent of a receipt's fields" is a naming
    // convention rather than a property.
    const restriction = mimeRestriction(migrationSql(), RECORD_MEDIA_BUCKET);

    expect(restriction.state).toBe("restricted");
    expect(
      restriction.state === "restricted" ? restriction.types : ["unreadable"]
    ).not.toContain(NON_MEDIA_MIME_TYPE);
  });
});

describe("ACC-03 reaches media objects too", () => {
  it("POSITIVE CONTROL: purge_expired_accounts reaches the two shipped buckets", () => {
    // Unmarked, passing today. Without it, the marked grader below could be
    // failing because `functionBody` found nothing — which looks identical in
    // the report and means something completely different.
    const body = functionBody(migrationSql(), "purge_expired_accounts");

    expect(body, "purge_expired_accounts not found").not.toBe("");
    expect(deletionReachesBucket(body, RECEIPTS_BUCKET)).toBe(true);
    expect(deletionReachesBucket(body, VEHICLE_PHOTOS_BUCKET)).toBe(true);
  });

  it("purge_expired_accounts deletes record-media objects", () => {
    // ACC-03 says "all vehicles, records, and stored files"; a voice note is a
    // stored file. The purge names its buckets explicitly, and the failure is
    // invisible from outside — the count it returns is deleted *accounts*, so
    // a purge that leaves a whole bucket behind reads as a healthy one.
    const body = functionBody(migrationSql(), "purge_expired_accounts");

    expect(deletionReachesBucket(body, RECORD_MEDIA_BUCKET)).toBe(true);
  });
});

/* =========================================================================
 * Tier A — declaration: the table
 * ====================================================================== */

describe("the record_media table exists and is shaped by GAR-06′", () => {
  it(`public.${TABLE} is created`, () => {
    expect(createTableBody(migrationSql(), TABLE)).not.toBeNull();
  });

  it.each(
    RECORD_MEDIA_TABLE.columns.map((column) => [
      column.name,
      column.requirement,
    ])
  )(`${TABLE}.%s exists (%s)`, (column) => {
    const body = createTableBody(migrationSql(), TABLE);

    expect(body, `no ${TABLE} table`).not.toBeNull();
    expect(columnDefinition(body ?? "", column)).not.toBeNull();
  });

  it.each(
    RECORD_MEDIA_TABLE.columns
      .filter((column) => column.notNull === true)
      .map((column) => [column.name])
  )(`${TABLE}.%s cannot be null`, (column) => {
    // An attachment with no path is a row pointing at nothing; one with no
    // kind cannot be rendered as anything in particular; one with no record is
    // an orphan the ownership path cannot reach, which means RLS cannot judge
    // it either.
    expect(isNotNullFor(migrationSql(), TABLE, column)).toBe(true);
  });

  it(`${TABLE}.record_id references records on delete cascade`, () => {
    // The ownership path is `record_id → vehicle_id → owner_id`. A missing
    // cascade on this hop leaves an orphan row that still names a storage
    // path, and ACC-03's hard delete either fails on the constraint or lies.
    const fk = foreignKeyFor(migrationSql(), TABLE, "record_id");

    expect(fk, `${TABLE}.record_id has no foreign key`).not.toBeNull();
    expect(fk?.target).toContain("records");
    expect(fk?.cascades).toBe(true);
  });

  it("media_kind is a closed set, not free text", () => {
    // GAR-06′ names three kinds. Free text means the page's render branch is
    // driven by strings nobody validates, and "photo" vs "image" silently
    // renders nothing — the same failure `records.kind` is constrained against.
    const ddl = closedSetDdl(migrationSql(), TABLE, "media_kind");

    expect(ddl, "nothing constrains media_kind to a closed set").not.toBe("");
    for (const kind of RECORD_MEDIA_KIND_NAMES) {
      expect(ddl, kind).toContain(`'${kind}'`);
    }
  });
});

describe("record_media is private by default (SHR-01)", () => {
  it("enables row level security", () => {
    expect(enablesRls(migrationSql(), TABLE)).toBe(true);
  });

  it("FORCES row level security", () => {
    // Without `force`, the table owner is exempt — and migrations run as the
    // owner, so every proof written against a policy is a proof about
    // somebody else's session.
    expect(forcesRls(migrationSql(), TABLE)).toBe(true);
  });

  it("polices every command, owner-scoped through the vehicle", () => {
    expect(userTablePolicyIssues(migrationSql(), [TABLE])).toEqual([]);
  });

  it.each([["select"], ["insert"], ["update"], ["delete"]])(
    "covers %s with a policy",
    (command) => {
      // Four separate graders rather than one, because a table policed for
      // reads and open for deletes is a specific, plausible, silent failure.
      expect([...coveredCommands(migrationSql(), TABLE)]).toContain(command);
    }
  );
});

describe("an attachment is not a receipt (GAR-06′ ✕ GAR-05′)", () => {
  it("POSITIVE CONTROL: the rule fires on a table that DOES require them", () => {
    // Unmarked. `requiredReceiptFieldIssues` returning `[]` has to mean
    // "checked, and nothing is required" rather than "the rule never fires".
    const synthetic = normalizeSql(`
      create table public.record_media (
        id uuid primary key,
        record_id uuid not null references public.records(id) on delete cascade,
        storage_path text not null,
        media_kind text not null,
        vendor text not null,
        amount numeric not null
      );
    `);
    const issues = requiredReceiptFieldIssues(synthetic, TABLE);

    expect(issues).toHaveLength(2);
    expect(issues.join(" | ")).toContain("record_media.vendor is required");
    expect(issues.join(" | ")).toContain("record_media.amount is required");
  });

  it("POSITIVE CONTROL: the rule is clean on a table that only allows them", () => {
    // The other direction, so the rule cannot decay into "any mention of
    // vendor is a finding". GAR-06′ forbids *requiring* a receipt's fields, not
    // carrying an optional one.
    const synthetic = normalizeSql(`
      create table public.record_media (
        id uuid primary key,
        record_id uuid not null,
        storage_path text not null,
        media_kind text not null,
        vendor text
      );
    `);

    expect(requiredReceiptFieldIssues(synthetic, TABLE)).toEqual([]);
  });

  it("POSITIVE CONTROL: today's receipts table does not require its own fields", () => {
    // GAR-05′ says a receipt *has* vendor/date/amount, not that it must be
    // typed in before the file can be kept. Proves the rule reads the real
    // shipped DDL and not just synthetic strings.
    expect(requiredReceiptFieldIssues(migrationSql(), "receipts")).toEqual([]);
  });

  it("POSITIVE CONTROL: a missing table is a finding, not a clean result", () => {
    // AGENTS.md: a failure is not a zero. "Nothing is required" and "there is
    // nothing to check" must not be the same answer.
    expect(requiredReceiptFieldIssues("", TABLE)).toEqual([
      `${TABLE}: no create table statement, so nothing can be checked`,
    ]);
  });

  it("no receipt field is required on a media row", () => {
    expect(requiredReceiptFieldIssues(migrationSql(), TABLE)).toEqual([]);
  });

  it("record_media declares no column the contract does not name", () => {
    // The independence claim from the other side. GAR-06′ asks for
    // documentation, not a second financial ledger, and a `vendor`/`amount`
    // pair that arrives "just in case" is how two surfaces that must stay
    // separate grow a shared shape nobody decided on. Extra columns a
    // requirement *does* ask for are a one-line change to `contract.ts`.
    const body = createTableBody(migrationSql(), TABLE);
    expect(body, `no ${TABLE} table`).not.toBeNull();

    const declared = new Set(
      RECORD_MEDIA_TABLE.columns.map((column) => column.name)
    );
    const unexpected = RECEIPT_FINANCIAL_COLUMNS.filter(
      (column) =>
        !declared.has(column) && columnDefinition(body ?? "", column) !== null
    );

    expect(unexpected).toEqual([]);
  });
});

/* =========================================================================
 * Tier A — declaration: deleting a record reaches its objects
 * ====================================================================== */

describe("deleting a record reaches its media objects", () => {
  it("POSITIVE CONTROL: the trigger finder sees the shipped vehicles trigger", () => {
    // Unmarked. Every marked grader below is satisfied by a helper that finds
    // nothing, so the helper is proved against a trigger that really exists —
    // `on_vehicle_deleted`, shipped by T2-301 — before it is trusted to report
    // the absence of one that does not.
    const sql = migrationSql();

    expect(
      deleteTriggerOn(sql, "vehicles"),
      "no vehicles delete trigger"
    ).toBeDefined();
    expect(
      deletionReachesBucket(
        deleteCleanupBody(sql, "vehicles"),
        VEHICLE_PHOTOS_BUCKET
      )
    ).toBe(true);
  });

  it("POSITIVE CONTROL: the trigger finder discriminates by table", () => {
    // Graded against **synthetic** DDL carrying only a vehicles trigger, not
    // against today's migration directory.
    //
    // The first version asserted `deleteTriggerOn(migrationSql(), "records")`
    // is undefined — true today, and a trap: it is unmarked, so T2-305 would
    // have had to *edit a grader* to add the very trigger the marked graders
    // below demand, which is the separation violation T901 audits for (review
    // F1). The claim worth making is about the finder, not about the calendar:
    // a trigger on one table must not be mistaken for a trigger on another,
    // which is what makes "no records trigger" mean something. That claim
    // stays true forever, before and after T2-305.
    const onlyVehicles = normalizeSql(`
      create trigger on_vehicle_deleted
        after delete on public.vehicles
        for each row execute function public.handle_vehicle_deleted();
    `);

    expect(deleteTriggerOn(onlyVehicles, "vehicles")).toBeDefined();
    expect(deleteTriggerOn(onlyVehicles, "records")).toBeUndefined();
  });

  it("POSITIVE CONTROL: the finder does not mistake an insert trigger for a delete one", () => {
    // The other way the finder could report a false positive, and the one
    // that would make the marked graders below pass over a records trigger
    // that never fires on a delete.
    const insertOnly = normalizeSql(`
      create trigger on_record_created
        after insert on public.records
        for each row execute function public.handle_record_created();
    `);

    expect(deleteTriggerOn(insertOnly, "records")).toBeUndefined();
  });

  it("a delete trigger exists on public.records", () => {
    // No foreign key can do this: a storage object is not a row in `public`,
    // so `on delete cascade` has nothing to hang from. Removing one record
    // from a vehicle's log would otherwise leave its video in the bucket
    // forever — still readable by its owner, still against their quota, and
    // named by a `record_media` row that no longer exists.
    expect(
      deleteTriggerOn(migrationSql(), "records"),
      "no delete trigger on public.records"
    ).toBeDefined();
  });

  it("the record-delete cleanup targets the record-media bucket", () => {
    // Separate from the trigger existing, because a trigger that fires and
    // deletes nothing is the failure this section is about. The routine is
    // found by following `execute function`, not by guessing its name.
    const body = deleteCleanupBody(migrationSql(), "records");

    expect(body, "the records delete trigger calls nothing findable").not.toBe(
      ""
    );
    expect(deletionReachesBucket(body, RECORD_MEDIA_BUCKET)).toBe(true);
  });

  it("the record-delete cleanup narrows to the record being deleted", () => {
    // The over-reach direction. A cleanup keyed on the owner segment alone
    // deletes every media object that owner has, in every vehicle, on every
    // record — triggered by deleting one note.
    expect(
      recordScopeIssues(
        deleteCleanupBody(migrationSql(), "records"),
        RECORD_MEDIA_BUCKET
      )
    ).toEqual([]);
  });
});

/* =========================================================================
 * Tier A — the promotion T2-305 owes the generic sweeps
 * ====================================================================== */

describe("record_media joins the tables every generic sweep already covers", () => {
  it("POSITIVE CONTROL: it is declared somewhere, not silently forgotten", () => {
    // Unmarked, and asserted against **both** lists on purpose.
    //
    // The first version asserted membership in `PENDING_USER_TABLES` alone,
    // which is true today and goes red the moment T2-305 does exactly the
    // promotion `contract.ts` prescribes — an unmarked grader that punishes
    // the correct implementation and leaves no route to green but editing a
    // grader (review F1). The claim that actually matters is "a contract for
    // this table exists", and *where* it is recorded is what the marked
    // grader below tracks. Together they still distinguish all three states:
    // declared-and-promoted, declared-but-pending, and forgotten.
    expect(
      [...USER_TABLES, ...PENDING_USER_TABLES].map((table) => table.name)
    ).toContain(TABLE);
    expect(RECORD_MEDIA_TABLE.ownershipPath).toEqual([
      "record_id",
      "vehicle_id",
      "owner_id",
    ]);
  });

  it("record_media is enumerated in USER_TABLES", () => {
    // T2-305 promotes it, in the same commit that creates the table. Three
    // edits, all named in `contract.ts`'s `RECORD_MEDIA_TABLE` docstring:
    //   1. move the entry into `USER_TABLES`, emptying `PENDING_USER_TABLES`
    //   2. add `["record_media", "record_id", "records"]` to `CASCADE_HOPS`
    //      in `deletion-cascade.test.ts`
    //   3. extend the table-name list in `harness-contract.test.ts`
    // Until then `ungradedTableIssues` will call the new table out by name the
    // moment the migration creates it — deliberately, so a user table cannot
    // exist that no grader knows about.
    expect(USER_TABLE_NAMES).toContain(TABLE);
  });
});

/* =========================================================================
 * The private-bucket manifest
 * ====================================================================== */

describe("the media bucket is on the private manifest", () => {
  it("lists all three private buckets", () => {
    // Unmarked, and `toContain` rather than exact equality: a fourth private
    // bucket should inherit the sweep in `vehicle-photos.test.ts`, not turn
    // this control red for having done the right thing.
    expect(PRIVATE_BUCKETS).toContain(RECEIPTS_BUCKET);
    expect(PRIVATE_BUCKETS).toContain(VEHICLE_PHOTOS_BUCKET);
    expect(PRIVATE_BUCKETS).toContain(RECORD_MEDIA_BUCKET);
  });
});

/* =========================================================================
 * Tier B — behavioural
 * ====================================================================== */

/** Byte markers, one per kind, so a leak assertion can say which one leaked. */
const MEDIA_BODY_MARKERS = {
  photo: "TEST-T2-305-MEDIA-BYTES-PHOTO",
  video: "TEST-T2-305-MEDIA-BYTES-VIDEO",
  audio: "TEST-T2-305-MEDIA-BYTES-AUDIO",
} as const;

/** An ISO base-media-format `ftyp` box — the first bytes of every MP4/M4A. */
function ftypBox(brand: string): Buffer {
  const body = Buffer.concat([
    Buffer.from("ftyp", "ascii"),
    Buffer.from(brand, "ascii"),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from("isomiso2", "ascii"),
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length + 4, 0);
  return Buffer.concat([size, body]);
}

/**
 * The three fixtures, each a real container header with its marker appended
 * after it.
 *
 * The marker is the point (T2-301a review, F3): `not.toContain(marker)` on a
 * response body proves nothing if the bytes never carried the marker under any
 * circumstance — it passes whether the bucket leaked or not. The header is
 * also the point: Supabase's bucket filter reads the *declared* content type,
 * so a fixture that were not really a video would still upload, and the
 * grader would pass for a reason unrelated to its claim.
 */
const MEDIA_FIXTURES = {
  photo: Buffer.concat([
    SYNTHETIC_JPEG,
    Buffer.from(`\n${MEDIA_BODY_MARKERS.photo}\n`, "utf8"),
  ]),
  video: Buffer.concat([
    ftypBox("isom"),
    Buffer.from(`\n${MEDIA_BODY_MARKERS.video}\n`, "utf8"),
  ]),
  audio: Buffer.concat([
    ftypBox("M4A "),
    Buffer.from(`\n${MEDIA_BODY_MARKERS.audio}\n`, "utf8"),
  ]),
} as const;

type MediaKind = keyof typeof MEDIA_FIXTURES;

const SAMPLE_MIME: Record<MediaKind, string> = {
  photo: RECORD_MEDIA_KINDS[0].sample,
  video: RECORD_MEDIA_KINDS[1].sample,
  audio: RECORD_MEDIA_KINDS[2].sample,
};

const EXTENSION: Record<MediaKind, string> = {
  photo: RECORD_MEDIA_KINDS[0].extension,
  video: RECORD_MEDIA_KINDS[1].extension,
  audio: RECORD_MEDIA_KINDS[2].extension,
};

interface RecordFixture {
  readonly vehicleId: string;
  readonly recordId: string;
}

/**
 * A vehicle and one record on it, owned by `actor`.
 *
 * Built only out of tables that exist today, so a live failure downstream is
 * about `record_media` or `record-media` and never about provisioning.
 */
async function createRecordFixture(
  scenario: Scenario,
  actor: Actor
): Promise<RecordFixture> {
  const vehicle = await insertRow(scenario, actor, "vehicles", {
    owner_id: actor.userId,
    display_name: testVehicleName(actor.slot),
    ...TEST_TAXONOMY_IDENTITY,
  });
  const vehicleRow = (Array.isArray(vehicle.body) ? vehicle.body : [])[0] as
    { id?: string } | undefined;
  if (!vehicle.ok || !vehicleRow?.id) {
    throw new Error(
      `could not create vehicle: ${vehicle.status} ${vehicle.text}`
    );
  }

  const record = await insertRow(scenario, actor, "records", {
    vehicle_id: vehicleRow.id,
    occurred_on: "2026-09-02",
    kind: "work",
  });
  const recordRow = (Array.isArray(record.body) ? record.body : [])[0] as
    { id?: string } | undefined;
  if (!record.ok || !recordRow?.id) {
    throw new Error(`could not create record: ${record.status} ${record.text}`);
  }

  return { vehicleId: vehicleRow.id, recordId: recordRow.id };
}

/** The object path a media attachment on `fixture` would live at. */
function mediaPathFor(
  actor: Actor,
  fixture: RecordFixture,
  kind: MediaKind,
  slot: string
): string {
  return testRecordMediaPath(
    actor.userId ?? "",
    fixture.vehicleId,
    fixture.recordId,
    slot,
    EXTENSION[kind]
  );
}

/** Upload the fixture bytes for `kind` at `path`. */
function uploadMedia(
  scenario: Scenario,
  actor: Actor,
  path: string,
  kind: MediaKind
): ReturnType<typeof uploadObject> {
  return uploadObject(scenario, actor, path, {
    bucket: RECORD_MEDIA_BUCKET,
    bytes: MEDIA_FIXTURES[kind],
    contentType: SAMPLE_MIME[kind],
  });
}

/**
 * A record with one media attachment: the **row first**, then the object.
 *
 * Row-first is T2-301a's F2 lesson: with the upload first, a missing bucket
 * throws before the row is ever written and every claim about the table goes
 * unexercised while appearing to have been tested. This way each live run
 * touches both halves and the error names whichever is missing.
 */
async function createRecordWithMedia(
  scenario: Scenario,
  actor: Actor,
  kind: MediaKind = "video",
  slot = "1"
): Promise<RecordFixture & { readonly mediaPath: string }> {
  const fixture = await createRecordFixture(scenario, actor);
  const mediaPath = mediaPathFor(actor, fixture, kind, slot);

  const row = await insertRow(scenario, actor, TABLE, {
    record_id: fixture.recordId,
    storage_path: mediaPath,
    media_kind: kind,
  });
  if (!row.ok) {
    throw new Error(`could not create ${TABLE} row: ${row.status} ${row.text}`);
  }

  const uploaded = await uploadMedia(scenario, actor, mediaPath, kind);
  if (!uploaded.ok) {
    throw new Error(
      `could not upload media: ${uploaded.status} ${uploaded.text}`
    );
  }

  return { ...fixture, mediaPath };
}

describe.skipIf(!live.available)(
  liveTitle("a record's media has no public URL", live),
  () => {
    it("the public object route does not serve an attachment", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { mediaPath } = await createRecordWithMedia(
          scenario,
          scenario.ownerA
        );

        const publicRead = await fetchPublicObject(
          scenario,
          mediaPath,
          RECORD_MEDIA_BUCKET
        );

        expect(publicRead.ok).toBe(false);
        expect(publicRead.text).not.toContain(MEDIA_BODY_MARKERS.video);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("an unauthenticated direct read does not serve it", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { mediaPath } = await createRecordWithMedia(
          scenario,
          scenario.ownerA
        );

        const anonRead = await downloadObject(
          scenario,
          scenario.anon,
          mediaPath,
          RECORD_MEDIA_BUCKET
        );

        expect(anonRead.ok).toBe(false);
        expect(anonRead.text).not.toContain(MEDIA_BODY_MARKERS.video);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("anon cannot list the media bucket", async () => {
      // A media path is `<owner>/<vehicle>/<record>/<file>`, so one listing
      // hands out the owner id, the vehicle id, the record id and the
      // filename together — a map of somebody's garage without reading a byte.
      const scenario = await provisionScenario(stackOf(live));
      try {
        await createRecordWithMedia(scenario, scenario.ownerA);

        const listing = await listObjects(
          scenario,
          scenario.anon,
          "",
          RECORD_MEDIA_BUCKET
        );

        expect(listing.text).not.toContain("MEDIA");
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("POSITIVE CONTROL: the owner reads their own attachment back", async () => {
      // Every denial above is satisfied by a bucket that does not exist.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { mediaPath } = await createRecordWithMedia(
          scenario,
          scenario.ownerA
        );

        const ownerRead = await downloadObject(
          scenario,
          scenario.ownerA,
          mediaPath,
          RECORD_MEDIA_BUCKET
        );

        expect(ownerRead.ok).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("POSITIVE CONTROL: the owner's signed URL works without credentials", async () => {
      // The feature has to work. A signed URL nobody can follow satisfies
      // every denial above and ships a garage where no video ever plays.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { mediaPath } = await createRecordWithMedia(
          scenario,
          scenario.ownerA
        );

        const signed = await signObject(
          scenario,
          scenario.ownerA,
          mediaPath,
          RECORD_MEDIA_BUCKET
        );
        expect(signed.ok).toBe(true);

        const url = (signed.body as { signedURL?: string }).signedURL ?? "";
        expect(url).toBeTruthy();
        expect(await followSignedUrl(stackOf(live), url)).toMatchObject({
          ok: true,
        });
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle("one owner's media is their own", live),
  () => {
    it("owner B cannot read owner A's attachment", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { mediaPath } = await createRecordWithMedia(
          scenario,
          scenario.ownerA
        );

        const read = await downloadObject(
          scenario,
          scenario.ownerB,
          mediaPath,
          RECORD_MEDIA_BUCKET
        );

        expect(read.ok).toBe(false);
        expect(read.text).not.toContain(MEDIA_BODY_MARKERS.video);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("owner B cannot sign for owner A's attachment", async () => {
      // The refusal has to happen at signing: a signed URL is a bearer token,
      // and once issued nothing downstream asks who asked for it.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { mediaPath } = await createRecordWithMedia(
          scenario,
          scenario.ownerA
        );

        const signed = await signObject(
          scenario,
          scenario.ownerB,
          mediaPath,
          RECORD_MEDIA_BUCKET
        );

        expect(signed.ok).toBe(false);
        expect(signed.text).not.toContain("token");
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("owner B cannot upload into owner A's prefix", async () => {
      // Write access to someone else's prefix is also the ability to replace
      // their documentation with something else entirely.
      //
      // **The refusal is asserted next to a success, and it has to be.** With
      // only `expect(uploaded.ok).toBe(false)` this grader passed against a
      // stack where the bucket did not exist yet — every upload fails when
      // there is nothing to upload into, so it could not tell "the policy
      // refused owner B" from "the feature is missing". Caught by the Tier-B
      // CI job reporting `Expect test to fail` on a marked grader, which is
      // the signal that a negative assertion is being satisfied by absence.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const fixture = await createRecordFixture(scenario, scenario.ownerA);
        const forged = testRecordMediaPath(
          scenario.ownerA.userId ?? "",
          fixture.vehicleId,
          fixture.recordId,
          "forged",
          EXTENSION.video
        );

        // The surface exists and works for the person it belongs to …
        const byOwner = await uploadMedia(
          scenario,
          scenario.ownerA,
          forged,
          "video"
        );
        expect(byOwner.ok, byOwner.text).toBe(true);

        // … and refuses the person it does not.
        const forgedByB = testRecordMediaPath(
          scenario.ownerA.userId ?? "",
          fixture.vehicleId,
          fixture.recordId,
          "forged-b",
          EXTENSION.video
        );
        const uploaded = await uploadMedia(
          scenario,
          scenario.ownerB,
          forgedByB,
          "video"
        );

        expect(uploaded.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("owner B cannot read owner A's record_media rows", async () => {
      // The row half. The object policies and the table policies are two
      // independent guarantees, and the row alone names the vendor-free
      // storage path an attacker would then go and sign for.
      const scenario = await provisionScenario(stackOf(live));
      try {
        await createRecordWithMedia(scenario, scenario.ownerA);

        const read = await selectRows(scenario, scenario.ownerB, TABLE, "");

        expect(Array.isArray(read.body) ? read.body : []).toEqual([]);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("owner B cannot attach media to owner A's record", async () => {
      // The FK keeps an attachment on a record; the policy keeps it on *your*
      // record. This is the seam between them, and a correct FK with a lazy
      // `with check` fails exactly here.
      //
      // Paired with a success for the same reason as the upload grader above:
      // a 404 from a table that does not exist is not a policy refusing
      // anybody, and unpaired this assertion could not tell the two apart.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const fixture = await createRecordFixture(scenario, scenario.ownerA);

        // Owner A can attach to their own record …
        const byOwner = await insertRow(scenario, scenario.ownerA, TABLE, {
          record_id: fixture.recordId,
          storage_path: mediaPathFor(scenario.ownerA, fixture, "video", "own"),
          media_kind: "video",
        });
        expect(byOwner.ok, byOwner.text).toBe(true);

        // … and owner B cannot attach to owner A's.
        const response = await insertRow(scenario, scenario.ownerB, TABLE, {
          record_id: fixture.recordId,
          storage_path: testRecordMediaPath(
            scenario.ownerB.userId ?? "",
            fixture.vehicleId,
            fixture.recordId,
            "forged",
            EXTENSION.video
          ),
          media_kind: "video",
        });

        expect(response.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle("the bucket accepts three kinds and only three", live),
  () => {
    it.each(RECORD_MEDIA_KIND_NAMES.map((kind) => [kind]))(
      "accepts a %s upload",
      async (kind) => {
        // The positive half of the MIME restriction, one grader per kind. An
        // aggregate assertion would let an image-only bucket look mostly fine.
        const scenario = await provisionScenario(stackOf(live));
        try {
          const fixture = await createRecordFixture(scenario, scenario.ownerA);
          const path = mediaPathFor(
            scenario.ownerA,
            fixture,
            kind as MediaKind,
            kind
          );

          const uploaded = await uploadMedia(
            scenario,
            scenario.ownerA,
            path,
            kind as MediaKind
          );

          expect(uploaded.ok, uploaded.text).toBe(true);
        } finally {
          await teardownScenario(scenario);
        }
      }
    );

    it(`refuses a ${NON_MEDIA_MIME_TYPE} upload`, async () => {
      // The negative half, and the GAR-05′/GAR-06′ boundary made real: the
      // media bucket is not a second place to put receipts.
      //
      // The declared-kind upload has to succeed in the same test. A bucket
      // that does not exist refuses a PDF exactly as convincingly as a bucket
      // with a correct MIME filter, so unpaired this asserted nothing about
      // the filter at all.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const fixture = await createRecordFixture(scenario, scenario.ownerA);

        const allowed = await uploadMedia(
          scenario,
          scenario.ownerA,
          mediaPathFor(scenario.ownerA, fixture, "video", "allowed"),
          "video"
        );
        expect(allowed.ok, allowed.text).toBe(true);

        const path = testRecordMediaPath(
          scenario.ownerA.userId ?? "",
          fixture.vehicleId,
          fixture.recordId,
          "pdf",
          "pdf"
        );
        const uploaded = await uploadObject(scenario, scenario.ownerA, path, {
          bucket: RECORD_MEDIA_BUCKET,
          bytes: Buffer.from("%PDF-1.4 TEST-T2-305 synthetic receipt\n"),
          contentType: NON_MEDIA_MIME_TYPE,
        });

        expect(uploaded.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("refuses a media row whose kind is not one of the three", async () => {
      // The closed set, proved rather than read out of the DDL — and paired
      // with an accepted kind, because a missing table rejects every insert
      // and would have made this look like a working `check` constraint.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const fixture = await createRecordFixture(scenario, scenario.ownerA);

        const named = await insertRow(scenario, scenario.ownerA, TABLE, {
          record_id: fixture.recordId,
          storage_path: mediaPathFor(
            scenario.ownerA,
            fixture,
            "video",
            "akind"
          ),
          media_kind: "video",
        });
        expect(named.ok, named.text).toBe(true);

        const response = await insertRow(scenario, scenario.ownerA, TABLE, {
          record_id: fixture.recordId,
          storage_path: mediaPathFor(
            scenario.ownerA,
            fixture,
            "video",
            "notakind"
          ),
          media_kind: "TEST-NOT-A-KIND",
        });

        expect(response.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("POSITIVE CONTROL: an attachment needs no vendor, date or amount", async () => {
      // GAR-06′'s independence clause, end to end: record, path, kind, and
      // nothing else. If this fails, the media surface has inherited GAR-05′'s
      // form and the WhatsApp voice note that started all this cannot be
      // filed without inventing a vendor.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const fixture = await createRecordFixture(scenario, scenario.ownerA);

        const response = await insertRow(scenario, scenario.ownerA, TABLE, {
          record_id: fixture.recordId,
          storage_path: mediaPathFor(scenario.ownerA, fixture, "audio", "bare"),
          media_kind: "audio",
        });

        expect(response.ok, response.text).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);

describe.skipIf(!live.available)(
  liveTitle("deleting reaches the objects", live),
  () => {
    it("deleting a record removes its media objects", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { recordId, mediaPath } = await createRecordWithMedia(
          scenario,
          scenario.ownerA
        );

        const deleted = await deleteRows(
          scenario,
          scenario.ownerA,
          "records",
          `id=eq.${recordId}`
        );
        expect(deleted.ok).toBe(true);

        const read = await downloadObject(
          scenario,
          scenario.ownerA,
          mediaPath,
          RECORD_MEDIA_BUCKET
        );

        expect(read.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("deleting one record leaves another record's media alone", async () => {
      // The over-reach direction, which is the same defect wearing the
      // opposite coat and much harder to notice: nobody checks the records
      // they did not delete.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const keep = await createRecordWithMedia(
          scenario,
          scenario.ownerA,
          "video",
          "keep"
        );
        const drop = await createRecordWithMedia(
          scenario,
          scenario.ownerA,
          "audio",
          "drop"
        );

        await deleteRows(
          scenario,
          scenario.ownerA,
          "records",
          `id=eq.${drop.recordId}`
        );

        const survivor = await downloadObject(
          scenario,
          scenario.ownerA,
          keep.mediaPath,
          RECORD_MEDIA_BUCKET
        );

        expect(survivor.ok, survivor.text).toBe(true);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("deleting a vehicle removes its records' media objects", async () => {
      // A vehicle delete cascades its records away, and a row-level `after
      // delete` trigger on `records` fires for cascaded rows too — so this
      // should follow from the record trigger. "Should follow" is exactly the
      // kind of claim that is worth one live grader rather than an argument:
      // if the belt is written as a statement-level trigger instead, this is
      // the one that catches it.
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { vehicleId, mediaPath } = await createRecordWithMedia(
          scenario,
          scenario.ownerA
        );

        await deleteRows(
          scenario,
          scenario.ownerA,
          "vehicles",
          `id=eq.${vehicleId}`
        );

        const read = await downloadObject(
          scenario,
          scenario.ownerA,
          mediaPath,
          RECORD_MEDIA_BUCKET
        );

        expect(read.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });

    it("the account purge removes media objects too", async () => {
      const scenario = await provisionScenario(stackOf(live));
      try {
        const { mediaPath } = await createRecordWithMedia(
          scenario,
          scenario.ownerA
        );

        await runAccountPurge(scenario, scenario.ownerA);

        const read = await downloadObject(
          scenario,
          scenario.ownerA,
          mediaPath,
          RECORD_MEDIA_BUCKET
        );

        expect(read.ok).toBe(false);
      } finally {
        await teardownScenario(scenario);
      }
    });
  }
);

/* =========================================================================
 * Guards on this file's own rules and fixtures
 *
 * All unmarked and all green today. Every one of them exists because the rule
 * or fixture above it would otherwise be trusted without ever having been
 * shown to fire — `.claude/GRADER-PRINCIPLES.md`, "mutation-test the probe
 * corpus itself".
 * ====================================================================== */

describe("the MIME rule reads an end state, not a spelling", () => {
  const BUCKET = RECORD_MEDIA_BUCKET;
  const correct = normalizeSql(`
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('record-media', 'record-media', false, 104857600,
      array['image/jpeg', 'image/png', 'video/mp4', 'audio/mp4', 'audio/mpeg'])
    on conflict (id) do nothing;
  `);

  it("accepts a correct three-category allow-list", () => {
    // The satisfiability control. A contract nothing can satisfy is worse than
    // no contract: the fix becomes "loosen the grader".
    expect(mimeRestrictionIssues(correct, BUCKET)).toEqual([]);
  });

  it("reads the declared types out of an array literal", () => {
    const restriction = mimeRestriction(correct, BUCKET);

    expect(restriction.state).toBe("restricted");
    expect(restriction.state === "restricted" ? restriction.types : []).toEqual(
      ["image/jpeg", "image/png", "video/mp4", "audio/mp4", "audio/mpeg"]
    );
  });

  it("reads the brace-literal spelling too", () => {
    // `'{a,b}'::text[]` is the same array and a perfectly ordinary way to
    // write it. A rule that only knew `array[…]` would reject correct DDL.
    const braced = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'record-media', false,
        '{image/jpeg,video/mp4,audio/mp4}'::text[]);
    `);

    expect(mimeRestrictionIssues(braced, BUCKET)).toEqual([]);
  });

  it("reports a bucket nobody declared as undeclared, not as clean", () => {
    const issues = mimeRestrictionIssues("", BUCKET);

    expect(mimeRestriction("", BUCKET).state).toBe("undeclared");
    expect(issues.join(" ")).toContain("never declared");
  });

  it("catches a later update that nulls the restriction", () => {
    const widened = normalizeSql(`
      ${correct}
      update storage.buckets set allowed_mime_types = null where id = 'record-media';
    `);

    expect(mimeRestriction(widened, BUCKET).state).toBe("unrestricted");
    expect(mimeRestrictionIssues(widened, BUCKET).join(" ")).toContain(
      "ends as null"
    );
  });

  it("catches an UNSCOPED later update, which reaches every bucket", () => {
    // The shape `bucketPrivacyIssues` grew a second loop for: a statement that
    // names no bucket names them all, so a rule that only looked at statements
    // mentioning this bucket would not see it.
    const widened = normalizeSql(`
      ${correct}
      update storage.buckets set allowed_mime_types = null;
    `);

    expect(mimeRestriction(widened, BUCKET).state).toBe("unrestricted");
  });

  it("ignores a later update scoped to a DIFFERENT bucket", () => {
    // The over-matching direction. Widening the receipts bucket is not a
    // finding about this one, and a rule that said so would cry wolf.
    const other = normalizeSql(`
      ${correct}
      update storage.buckets set allowed_mime_types = null where id = 'receipts';
    `);

    expect(mimeRestrictionIssues(other, BUCKET)).toEqual([]);
  });

  it("catches an `on conflict do update` that widens in the same statement", () => {
    const sneaky = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'record-media', false, array['image/jpeg', 'video/mp4', 'audio/mp4'])
      on conflict (id) do update set allowed_mime_types = null;
    `);

    expect(mimeRestriction(sneaky, BUCKET).state).toBe("unrestricted");
  });

  it("treats `excluded.allowed_mime_types` as the value already read", () => {
    // The idiomatic upsert. Reading it as unparseable would report a finding
    // against correct DDL.
    const upsert = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'record-media', false, array['image/jpeg', 'video/mp4', 'audio/mp4'])
      on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;
    `);

    expect(mimeRestrictionIssues(upsert, BUCKET)).toEqual([]);
  });

  it("refuses to pass on a value it cannot read", () => {
    // Unknown is not zero. A restriction computed by a function call is not
    // "no findings", it is "we could not check".
    const opaque = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'record-media', false, public.media_types());
    `);
    const restriction = mimeRestriction(opaque, BUCKET);

    expect(restriction.state).toBe("unparsed");
    expect(mimeRestrictionIssues(opaque, BUCKET).join(" ")).toContain(
      "cannot read"
    );
  });

  it("reports an EMPTY allow-list as a finding of its own", () => {
    // The branch no other control reaches. `array[]::text[]` is a bucket that
    // accepts nothing — the mirror image of accepting everything, and just as
    // wrong: it satisfies "allows nothing it should not" completely.
    const empty = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'record-media', false, array[]::text[]);
    `);
    const issues = mimeRestrictionIssues(empty, BUCKET).join(" | ");

    expect(mimeRestriction(empty, BUCKET)).toEqual({
      state: "restricted",
      types: [],
    });
    expect(issues).toContain("is empty — nothing can be uploaded");
  });

  it("MUTATION: a multi-row insert cannot hide a wide-open bucket (F2)", () => {
    // The reviewer's reproduction, pinned so it cannot come back. One
    // statement, two rows: `receipts` restricted to exactly the three declared
    // categories, and `record-media` created with `allowed_mime_types` null —
    // a bucket that accepts any file at all.
    //
    // Reading only the first tuple attributed the *receipts* restriction to
    // `record-media` and reported it clean, so the marked grader
    // "restricts the bucket to photo, video and audio and nothing else"
    // PASSED over a private general-purpose file host. Failing open, in the
    // one rule whose whole job is to catch that.
    const multiRow = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values
        ('receipts', 'receipts', false, array['image/jpeg', 'video/mp4', 'audio/mp4']),
        ('record-media', 'record-media', false, null);
    `);

    expect(mimeRestriction(multiRow, BUCKET).state).toBe("unrestricted");
    expect(mimeRestrictionIssues(multiRow, BUCKET).join(" ")).toContain(
      "ends as null"
    );
    // And the other row is still read as its own row, not as this one's.
    expect(mimeRestriction(multiRow, RECEIPTS_BUCKET)).toEqual({
      state: "restricted",
      types: ["image/jpeg", "video/mp4", "audio/mp4"],
    });
  });

  it("picks the right row out of a multi-row insert when it is correct", () => {
    // The positive control for the same code path: the fix must not turn
    // every multi-row insert into a finding, or a perfectly ordinary
    // two-bucket migration could never go green.
    const multiRow = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values
        ('receipts', 'receipts', false, array['image/jpeg', 'application/pdf']),
        ('record-media', 'record-media', false, array['image/jpeg', 'video/mp4', 'audio/mp4']);
    `);

    expect(mimeRestrictionIssues(multiRow, BUCKET)).toEqual([]);
    expect(
      mimeRestrictionIssues(multiRow, RECEIPTS_BUCKET).join(" | ")
    ).toContain("allows application/pdf");
  });

  it("refuses to guess when a multi-row insert has no id column", () => {
    // Positional-ish: the rows cannot be attributed to a bucket without an
    // `id` in the column list, so the answer is "we could not check" rather
    // than whichever row happened to be first.
    const headless = normalizeSql(`
      insert into storage.buckets (name, public, allowed_mime_types)
      values
        ('receipts', false, array['image/jpeg', 'video/mp4', 'audio/mp4']),
        ('record-media', false, null);
    `);

    expect(mimeRestriction(headless, BUCKET).state).toBe("unparsed");
    expect(mimeRestrictionIssues(headless, BUCKET).join(" ")).toContain(
      "cannot read"
    );
  });

  it("refuses to guess when two rows claim the same bucket", () => {
    // Legal SQL that would fail at runtime on the primary key, but a grader
    // asked an ambiguous question must not answer it confidently.
    const duplicated = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values
        ('record-media', 'record-media', false, array['image/jpeg', 'video/mp4', 'audio/mp4']),
        ('record-media', 'record-media', false, null);
    `);

    expect(mimeRestriction(duplicated, BUCKET).state).toBe("unparsed");
  });

  it("still reads a plain single-row insert with no id column", () => {
    // The single-row case stays unambiguous: the statement names the bucket
    // and has exactly one row, so tightening the multi-row path must not
    // regress it.
    const single = normalizeSql(`
      insert into storage.buckets (name, public, allowed_mime_types)
      values ('record-media', false, array['image/jpeg', 'video/mp4', 'audio/mp4']);
    `);

    expect(mimeRestrictionIssues(single, BUCKET)).toEqual([]);
  });

  it("refuses to guess at an insert with no column list", () => {
    // Positional inserts are legal SQL and unreadable without the table
    // definition. "We cannot tell" must not read as "no findings" — the same
    // rule as the `unparsed` state above, reached by a different route, and
    // the branch nothing else exercises.
    const positional = normalizeSql(`
      insert into storage.buckets
      values ('record-media', 'record-media', false, array['image/jpeg']);
    `);

    expect(mimeRestriction(positional, BUCKET).state).toBe("unparsed");
    expect(mimeRestrictionIssues(positional, BUCKET).join(" ")).toContain(
      "cannot read"
    );
  });

  it("reports an out-of-category type by name", () => {
    const withPdf = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'record-media', false,
        array['image/jpeg', 'video/mp4', 'audio/mp4', 'application/pdf']);
    `);

    expect(mimeRestrictionIssues(withPdf, BUCKET)).toEqual([
      `${BUCKET}: allows application/pdf, which is neither photo, video, nor audio`,
    ]);
  });

  it("reports a wildcard, which is every category", () => {
    const wild = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'record-media', false, array['*/*']);
    `);
    const issues = mimeRestrictionIssues(wild, BUCKET).join(" | ");

    expect(issues).toContain("allows */*");
    expect(issues).toContain("no photo type is allowed");
  });

  it("reports each missing category separately", () => {
    const imagesOnly = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'record-media', false, array['image/jpeg']);
    `);
    const issues = mimeRestrictionIssues(imagesOnly, BUCKET).join(" | ");

    expect(issues).toContain("no video type is allowed");
    expect(issues).toContain("no audio type is allowed");
    expect(issues).not.toContain("no photo type is allowed");
  });

  it("accepts a category wildcard inside a permitted category", () => {
    // `image/*` is a real Supabase spelling and is entirely within GAR-06′'s
    // photo category. Rejecting it would be grading a spelling.
    const prefixed = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'record-media', false, array['image/*', 'video/*', 'audio/*']);
    `);

    expect(mimeRestrictionIssues(prefixed, BUCKET)).toEqual([]);
  });

  it("MUTATION: the shipped photos bucket is image-only, so two kinds are missing", () => {
    // Run against real, shipped DDL rather than a synthetic string — proof
    // that the rule fires on something that actually exists and is not merely
    // consistent with its own fixtures.
    const issues = mimeRestrictionIssues(
      migrationSql(),
      VEHICLE_PHOTOS_BUCKET
    ).join(" | ");

    expect(issues).toContain("no video type is allowed");
    expect(issues).toContain("no audio type is allowed");
  });

  it("MUTATION: the shipped receipts bucket allows a PDF, and the rule says so", () => {
    expect(
      mimeRestrictionIssues(migrationSql(), RECEIPTS_BUCKET).join(" | ")
    ).toContain("allows application/pdf");
  });
});

describe("the splitter survives SQL's escaped quotes", () => {
  // Raised by a bot reviewer on PR #96: does the bare parity toggle in
  // `splitTopLevelItems` mis-split on `''`? It does not — the escape is two
  // ADJACENT quotes, so it flips the flag twice and no comma can sit between
  // them — but until these controls existed that was an argument rather than a
  // fact, and the argument is exactly the kind that is right for years and then
  // quietly wrong after someone "simplifies" the loop.
  //
  // The reviewer's real finding was the coverage gap, and it was correct: not
  // one test exercised an escaped quote.
  const BUCKET = RECORD_MEDIA_BUCKET;

  it("reads a bucket name containing an escaped quote AND a comma", () => {
    // The nastiest shape that can legally occur: the `name` column carries
    // both, so a mis-split would shift every later field by one and hand the
    // MIME reader `false` instead of the array — or, worse, hand it the array
    // from a different column and report a restriction that is not there.
    const awkward = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'it''s, media', false,
        array['image/jpeg', 'video/mp4', 'audio/mp4']);
    `);

    expect(mimeRestriction(awkward, BUCKET)).toEqual({
      state: "restricted",
      types: ["image/jpeg", "video/mp4", "audio/mp4"],
    });
    expect(mimeRestrictionIssues(awkward, BUCKET)).toEqual([]);
  });

  it("still attributes multi-row tuples correctly when a name is escaped", () => {
    // F2's row-selection walks the same split, so the two fixes have to hold
    // together: the escaped quote must not shift the `id` out of position and
    // make the wrong row look like this bucket's.
    const multiRow = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values
        ('receipts', 'the owner''s, receipts', false, array['application/pdf']),
        ('record-media', 'it''s, media', false, null);
    `);

    expect(mimeRestriction(multiRow, BUCKET).state).toBe("unrestricted");
    expect(mimeRestriction(multiRow, RECEIPTS_BUCKET)).toEqual({
      state: "restricted",
      types: ["application/pdf"],
    });
  });

  it("does not treat an escaped quote as an unreadable escape", () => {
    // The over-matching direction: `''` is ordinary, correct SQL and must not
    // trip the backslash guard, or a perfectly normal migration would be
    // reported as unreadable.
    const escaped = normalizeSql(`
      insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('record-media', 'it''s media', false,
        array['image/jpeg', 'video/mp4', 'audio/mp4']);
    `);

    expect(mimeRestriction(escaped, BUCKET).state).toBe("restricted");
  });

  it("MUTATION: refuses to read a backslash-escaped E-string", () => {
    // The form the parity toggle genuinely cannot lex, and the reason the
    // guard exists. `normalizeSql` does not understand E-strings either, so the
    // literal is already mangled before it reaches the splitter and every rule
    // in this directory shares the limitation. Unreachable through content — a
    // bucket id, a bucket name and a MIME type have no use for a backslash —
    // but unreachable is not the same as safe, so the answer is "we could not
    // check" rather than a confident reading of a mis-split tuple.
    const eString = normalizeSql(
      String.raw`insert into storage.buckets (id, name, public, allowed_mime_types)
        values ('record-media', e'it\'s, media', false, null);`
    );

    expect(mimeRestriction(eString, BUCKET).state).toBe("unparsed");
    expect(mimeRestrictionIssues(eString, BUCKET).join(" ")).toContain(
      "cannot read"
    );
  });

  it("MUTATION: refuses a backslash in a later widening update too", () => {
    // The guard has to cover both branches of the replay, or the statement
    // that removes the restriction is the one that slips through.
    const widened = normalizeSql(
      String.raw`insert into storage.buckets (id, name, public, allowed_mime_types)
        values ('record-media', 'record-media', false, array['image/jpeg', 'video/mp4', 'audio/mp4']);
      update storage.buckets set allowed_mime_types = null
       where name = e'record\'s media' and id = 'record-media';`
    );

    expect(mimeRestriction(widened, BUCKET).state).toBe("unparsed");
  });

  it("today's shipped migrations contain no unreadable escape", () => {
    // The claim that makes the guard cheap: it is not silently degrading any
    // real reading, because nothing in the directory trips it.
    const tripped = statements(migrationSql()).filter(
      (statement) =>
        statement.includes("storage.buckets") && statement.includes("\\")
    );

    expect(tripped).toEqual([]);
  });
});

describe("the record-scope rule can fail in both directions", () => {
  const scoped = `
    delete from storage.objects o
     where o.bucket_id = 'record-media'
       and (storage.foldername(o.name))[1] = old.owner_id::text
       and (storage.foldername(o.name))[3] = old.id::text;
  `;
  const ownerOnly = `
    delete from storage.objects o
     where o.bucket_id = 'record-media'
       and (storage.foldername(o.name))[1] = old.owner_id::text;
  `;

  it("passes a deletion narrowed by the deleted row", () => {
    expect(recordScopeIssues(scoped, RECORD_MEDIA_BUCKET)).toEqual([]);
  });

  it("MUTATION: flags a deletion narrowed only by owner", () => {
    // The whole-garage wipe. Without this the trigger graders are satisfied by
    // the most destructive implementation available.
    expect(
      recordScopeIssues(ownerOnly, RECORD_MEDIA_BUCKET).join(" | ")
    ).toContain("not narrowed to the deleted row");
  });

  it("MUTATION: flags a cleanup that never reaches this bucket", () => {
    expect(
      recordScopeIssues(scoped, "some-other-bucket").join(" | ")
    ).toContain("no delete from storage.objects reaches");
  });

  it("MUTATION: flags a missing cleanup routine as missing, not as clean", () => {
    expect(recordScopeIssues("", RECORD_MEDIA_BUCKET)).toEqual([
      "no cleanup routine found",
    ]);
  });

  it("reads an unfiltered deletion as reaching this bucket, if it is scoped", () => {
    // `delete from storage.objects where … old.id …` with no `bucket_id` is
    // over-broad about buckets and correctly narrow about the row, which is
    // the direction that loses no data.
    const unfiltered = `
      delete from storage.objects o
       where (storage.foldername(o.name))[3] = old.id::text;
    `;

    expect(recordScopeIssues(unfiltered, RECORD_MEDIA_BUCKET)).toEqual([]);
  });
});

describe("the closed-set finder accepts every correct spelling", () => {
  const KINDS = "'photo', 'video', 'audio'";

  it.each([
    [
      "an inline check",
      `create table public.record_media (
         id uuid primary key,
         media_kind text not null check (media_kind in (${KINDS})));`,
    ],
    [
      "a table-level check",
      `create table public.record_media (
         id uuid primary key,
         media_kind text not null,
         constraint record_media_kind_check check (media_kind in (${KINDS})));`,
    ],
    [
      "a later alter table",
      `create table public.record_media (
         id uuid primary key,
         media_kind text not null);
       alter table public.record_media
         add constraint record_media_kind_check check (media_kind in (${KINDS}));`,
    ],
    [
      "an enum type",
      `create type public.media_kind as enum (${KINDS});
       create table public.record_media (
         id uuid primary key,
         media_kind public.media_kind not null);`,
    ],
  ])("finds the closed set declared as %s", (_name, ddl) => {
    const found = closedSetDdl(normalizeSql(ddl), TABLE, "media_kind");

    expect(found).not.toBe("");
    for (const kind of RECORD_MEDIA_KIND_NAMES) {
      expect(found, kind).toContain(`'${kind}'`);
    }
  });

  it("MUTATION: finds nothing when media_kind is bare text", () => {
    const bare = normalizeSql(`
      create table public.record_media (
        id uuid primary key,
        media_kind text not null);
    `);

    expect(closedSetDdl(bare, TABLE, "media_kind")).toBe("");
  });

  it("MUTATION: finds a constraint that names only two of the three kinds", () => {
    // Found, but incomplete — which is why the grader asserts each kind
    // literal rather than stopping at "a constraint exists".
    const partial = normalizeSql(`
      create table public.record_media (
        id uuid primary key,
        media_kind text not null check (media_kind in ('photo', 'video')));
    `);
    const found = closedSetDdl(partial, TABLE, "media_kind");

    expect(found).not.toBe("");
    expect(found).not.toContain("'audio'");
  });
});

describe("the media fixtures are coherent", () => {
  it("puts owner, vehicle and record in the first three path segments", () => {
    // If the path convention drifts, every storage policy written against
    // `(storage.foldername(name))[1]` silently stops matching and the graders
    // above report a leak that is really a typo.
    const path = testRecordMediaPath(
      "owner-uuid",
      "vehicle-uuid",
      "record-uuid",
      "1",
      "mp4"
    );

    expect(path.split("/")).toEqual([
      "owner-uuid",
      "vehicle-uuid",
      "record-uuid",
      "TEST-T2-201-MEDIA-1.mp4",
    ]);
  });

  it("names every fixture in a reserved TEST- namespace", () => {
    expect(
      testRecordMediaPath("o", "v", "r", "1", "m4a").split("/").pop()
    ).toMatch(/^TEST-/);
  });

  it.each((Object.keys(MEDIA_FIXTURES) as MediaKind[]).map((kind) => [kind]))(
    "the %s bytes really carry the marker the leak graders look for",
    (kind) => {
      // The F3 guard, one per kind. `not.toContain(marker)` is worth nothing if
      // the bytes never contained it under any circumstance.
      expect(MEDIA_FIXTURES[kind].includes(MEDIA_BODY_MARKERS[kind])).toBe(
        true
      );
    }
  );

  it("gives each kind a distinct marker, so a leak says which one leaked", () => {
    expect(new Set(Object.values(MEDIA_BODY_MARKERS)).size).toBe(3);
  });

  it("builds real container headers, not just labelled noise", () => {
    // Supabase's bucket filter reads the *declared* content type, so a fixture
    // that were not really a video would upload anyway and the live graders
    // would pass for a reason unrelated to their claim.
    expect(MEDIA_FIXTURES.photo.subarray(0, 2)).toEqual(
      Buffer.from([0xff, 0xd8])
    );
    expect(MEDIA_FIXTURES.video.subarray(4, 12).toString("ascii")).toBe(
      "ftypisom"
    );
    expect(MEDIA_FIXTURES.audio.subarray(4, 12).toString("ascii")).toBe(
      "ftypM4A "
    );
  });

  it("declares a sample MIME type inside each declared category", () => {
    for (const entry of RECORD_MEDIA_KINDS) {
      expect(entry.sample.startsWith(entry.mimePrefix), entry.kind).toBe(true);
    }
  });

  it("keeps the non-media probe genuinely out of all three categories", () => {
    // If `NON_MEDIA_MIME_TYPE` ever became a media type, the boundary graders
    // above would pass without asking anything.
    for (const entry of RECORD_MEDIA_KINDS) {
      expect(NON_MEDIA_MIME_TYPE.startsWith(entry.mimePrefix)).toBe(false);
    }
  });
});

describe("the contract this file grades is real", () => {
  // Unmarked: if `contract.ts` loses the column list, every `it.each` above
  // silently becomes zero graders and the suite still reports green.
  it("names four columns, each traced to a requirement", () => {
    expect(RECORD_MEDIA_TABLE.columns).toHaveLength(4);
    for (const column of RECORD_MEDIA_TABLE.columns) {
      expect(column.requirement, column.name).toContain("GAR-06");
    }
  });

  it("names exactly three media kinds", () => {
    expect(RECORD_MEDIA_KIND_NAMES).toEqual(["photo", "video", "audio"]);
  });

  it("enumerates the receipt fields the independence rule is written against", () => {
    expect(RECEIPT_FINANCIAL_COLUMNS.length).toBeGreaterThanOrEqual(3);
    expect([...RECEIPT_FINANCIAL_COLUMNS]).toEqual(
      expect.arrayContaining(["vendor", "issued_on", "amount"])
    );
  });
});
