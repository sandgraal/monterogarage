/**
 * The user-data contract, in one place — declared by T2-201 [TEST], satisfied
 * by T2-202 [PLATFORM].
 *
 * Every name below is **derived from `specs/002-montero-garage/spec.md`, not
 * from an implementation**: no implementation exists yet. A test-writer
 * instance authored this file and must not be the instance that builds
 * T2-202 (AGENTS.md separation rule; T901 audits it).
 *
 * ## Why the names live here and nowhere else
 *
 * A grader has to name something. Table and column names are a *design*
 * decision that this file makes on the spec's behalf so the graders can be
 * concrete — but making them concrete in nine test files would turn a rename
 * into a nine-file argument. They are all here instead: if T2-202 wants
 * `owner_id` to be `user_id`, that is a one-line conversation with the
 * conductor, not a rewrite. What is **not** negotiable is the behaviour the
 * graders assert around them, which comes straight from the constitution:
 *
 * > User data never leaves Supabase; every user table ships with row-level
 * > security proven by graders before content flows. — AGENTS.md, Boundaries
 *
 * ## Traceability
 *
 * Each entry carries the requirement id it exists to satisfy. If a row here
 * cites no requirement, it should not be here.
 *
 * refs specs/002-montero-garage (ACC-01, ACC-03, SHR-01, SHR-03, GAR-01′,
 * GAR-02′, GAR-05′, MIG-03)
 */

/* -------------------------------------------------------------------------
 * Column and table contracts
 * ---------------------------------------------------------------------- */

/** One column T2-202's DDL must declare, and how it must declare it. */
export interface ColumnContract {
  /** Column name as it must appear in `create table`. */
  readonly name: string;
  /** The requirement that puts this column in the schema. */
  readonly requirement: string;
  /**
   * A pattern the normalised column *type* must match, when the type is
   * load-bearing. Omitted where the spec constrains meaning but not storage
   * (a display name is text; nobody cares whether it is `text` or `varchar`).
   */
  readonly type?: RegExp;
  /** `true` when the column must be declared `not null`. */
  readonly notNull?: boolean;
  /**
   * The normalised `default` expression the column must carry, when the
   * default itself is the requirement. SHR-01 is exactly this case: the
   * privacy of a user's data is a schema default, not an application habit.
   */
  readonly defaultsTo?: string;
  /**
   * `true` when `not null default '{}'` is an acceptable way to spell
   * "optional" for this column.
   *
   * Only for collection-valued columns, where an empty array genuinely *is*
   * the absence of a value — and a better model than nullable, because it
   * removes the null-versus-empty ambiguity. Never for a scalar: `cost_amount
   * numeric not null default 0` is not an empty cost, it is a claim that the
   * job was free (T2-201 review, F8).
   */
  readonly absenceDefaultAllowed?: boolean;
  /**
   * The task that ships this column, when it does not exist yet.
   *
   * ## Why a marker rather than "add it when it lands" (T2-401)
   *
   * The `it.each` sweeps in `schema-shape.test.ts`, `sharing-default.test.ts`,
   * `rls-deny-by-default.test.ts` and `deletion-cascade.test.ts` are all driven
   * from this file, and they are **unmarked and green** — they describe a
   * schema that exists. Adding a column for a feature nobody has built turns
   * every one of those into a red test with no `it.fails` on it, which is the
   * failure mode the expected-failure convention exists to prevent: a suite
   * that is red for a reason the reporter cannot name gets "fixed" by deleting
   * the assertion.
   *
   * So a pending entry is still a full contract entry — it is swept, counted,
   * and completeness-checked exactly like every other — but the sweeps
   * partition on this field and run the pending half under `it.fails`. The
   * implementer activates it by deleting the `pending` line here and the
   * `.fails` markers that quote it, and nothing else moves.
   */
  readonly pending?: string;
}

/** One table T2-202's DDL must create, with the ownership path RLS uses. */
export interface TableContract {
  /** Unqualified table name in the `public` schema. */
  readonly name: string;
  /** The requirement that puts this table in the schema. */
  readonly requirement: string;
  /** The task that ships this table, when it does not exist yet. */
  readonly pending?: string;
  /**
   * How a row reaches its owning user, as a chain of foreign keys ending at
   * `auth.users.id`. `["owner_id"]` means the table carries the owner
   * directly; `["record_id", "vehicle_id", "owner_id"]` means two hops.
   *
   * The chain is what the cascade grader walks: every hop must be declared
   * `on delete cascade`, or ACC-03's hard delete leaves orphans behind.
   */
  readonly ownershipPath: readonly string[];
  readonly columns: readonly ColumnContract[];
}

/**
 * The media-attachment table (GAR-06′) — **declared by T2-305a, promoted into
 * `USER_TABLES` by T2-305**, which is the commit that created it.
 *
 * ## Why the declaration sits above `USER_TABLES` rather than beside its kin
 *
 * It is the fifth element of that array now, and `const` has no hoisting: a
 * definition further down the file is in its temporal dead zone when the array
 * literal is evaluated, and `USER_TABLE_NAMES` reads the array a hundred lines
 * later still. So promotion moved the declaration here rather than inlining
 * the entry and losing this docstring. Nothing else about it changed.
 *
 * ## Naming: `record_media`, not `record_attachments`
 *
 * A bucket id is global to the project and permanent in every stored path
 * (the `vehicle-photos` argument below), and the same is true of a table name
 * in every query that will ever read it. `record_attachments` is the *generic*
 * name for "a thing attached to a record" — and a receipt is already a thing
 * attached to a record, living in a different bucket under a different table
 * with different columns. A name that describes both while governing one is a
 * name that will be wrong the first time somebody reads it quickly.
 *
 * `record_media` describes the contents, and the contents are exactly what the
 * bucket's `allowed_mime_types` says they are: image, video, audio. It also
 * leaves `record_attachments` free for the general surface if one is ever
 * wanted. As with every other name in this file, this is T2-305a's design
 * decision on the spec's behalf and is a one-line conversation with the
 * conductor to change — what is not negotiable is the behaviour graded around
 * it.
 *
 * ## Why it is a table and not `records.media_paths text[]`
 *
 * `vehicles.photo_paths` is the array precedent, and T2-304's seeding found
 * the defect it carries: two uploads landing back-to-back read-modify-write the
 * same array and one clobbers the other, leaving a real storage object that no
 * row names (recorded on T2-302/T2-305 in `tasks.md`). A row per object has no
 * such race — an insert is an insert — and it is also the only shape that can
 * carry `media_kind`, which GAR-06′ needs and an array of paths cannot hold.
 *
 * ## What promotion took, for the next table that arrives this way
 *
 * `USER_TABLES` drives unmarked `it.each` sweeps in `schema-shape.test.ts`,
 * `rls-deny-by-default.test.ts` and `deletion-cascade.test.ts`, so a table
 * declared before its migration existed had to wait outside them:
 * `PENDING_USER_TABLES` held it, and the marked grader
 * `"record_media is enumerated in USER_TABLES"` failed until T2-305 made these
 * three edits in the same commit as the migration —
 *
 * 1. move this entry into the `USER_TABLES` array, emptying
 *    `PENDING_USER_TABLES` (which stays exported: `rules.ts` reads it, and the
 *    next table to arrive this way will refill it);
 * 2. add `["record_media", "record_id", "records"]` to `CASCADE_HOPS` in
 *    `tests/garage/deletion-cascade.test.ts`;
 * 3. extend the table-name lists in `harness-contract.test.ts`'s
 *    `"names the user-data tables, shipped and pending"` and
 *    `"splits into a shipped half and a pending half"`.
 *
 * **Verified, not assumed** (T2-305a ran a scratch migration to check): with
 * the table created and promotion skipped, the two ungraded-table sweeps in
 * `rls-deny-by-default.test.ts` and `share-instrument.test.ts` fail by name,
 * and so do the anonymous-privilege sweeps — Supabase's default privileges
 * grant ALL on a new table in `public` to `anon` and `authenticated`, and an
 * explicit `grant` *adds to* that ACL rather than replacing it. T2-202's F2
 * found that the hard way; `20260903120000_record_media.sql` does the revoke
 * dance by name before granting the four verbs.
 */
export const RECORD_MEDIA_TABLE: TableContract = {
  name: "record_media",
  requirement: "GAR-06′",
  ownershipPath: ["record_id", "vehicle_id", "owner_id"],
  columns: [
    { name: "id", requirement: "GAR-06′", type: /uuid/, notNull: true },
    {
      name: "record_id",
      requirement: "GAR-06′ (an attachment is documentation *of a record*)",
      type: /uuid/,
      notNull: true,
    },
    {
      name: "storage_path",
      requirement: "GAR-06′ (the object in the private bucket)",
      notNull: true,
    },
    {
      // The closed set. Without it the "photo, video, or audio" of GAR-06′ is
      // a sentence in a spec rather than a property of the data, and a UI that
      // renders an `<audio>` for a video is one typo away.
      name: "media_kind",
      requirement: "GAR-06′ (“photo, video, or audio” — three, and only three)",
      notNull: true,
    },
  ],
};

/**
 * The user-data tables. `profiles` exists because a user needs a row of their
 * own that is not `auth.users` (which no client may read).
 *
 * **SHR-02's public handle, taken up by T2-401.** T2-201 deferred it here by
 * name — "a stable public URL under their handle" implies a unique,
 * case-folded, reserved-word-screened identifier, and every one of those
 * properties is a grader of its own. `profiles.handle` is now declared
 * (pending T2-402) and the properties that make it safe are graded in
 * `handles.test.ts`; the constants they read are at the foot of this file.
 *
 * **`shares` is declared here (pending T2-404), not exempted.** The
 * `ungradedTableIssues` sweep goes red for any table in `public` that is
 * neither enumerated here nor in `EXEMPT_PUBLIC_TABLES`, and that sweep is the
 * whole of AGENTS.md's "every user table ships with row-level security proven
 * by graders before content flows". Exempting the grants table — the one table
 * in the schema that holds bearer secrets — to keep a build quiet would
 * re-open the exact hole the sweep was added to close.
 */
export const USER_TABLES: readonly TableContract[] = [
  {
    name: "profiles",
    requirement: "ACC-01 (an account has a row of its own)",
    ownershipPath: ["id"],
    columns: [
      {
        name: "id",
        requirement: "ACC-01",
        type: /uuid/,
        notNull: true,
      },
      {
        name: "deleted_at",
        requirement: "ACC-03 (the 30-day recovery window needs a mark)",
        type: /timestamptz|timestamp with time zone/,
      },
      {
        // Nullable on purpose: a user who has never published anything needs
        // no public identity, and forcing one on them at signup would make
        // every account permanently addressable in a namespace SHR-01 says is
        // private by default. The handle is claimed when a page is published.
        //
        // What is *not* optional is everything around it — uniqueness under
        // concurrent signup, case folding, the reserved list, and what a
        // rename does to a URL somebody already shared. Those are graded in
        // `handles.test.ts`, because none of them is expressible as a column
        // shape.
        name: "handle",
        requirement: "SHR-02 (a stable public URL under their handle)",
        pending: "T2-402",
      },
    ],
  },
  {
    name: "vehicles",
    requirement: "GAR-01′",
    ownershipPath: ["owner_id"],
    columns: [
      { name: "id", requirement: "GAR-01′", type: /uuid/, notNull: true },
      {
        name: "owner_id",
        requirement: "SHR-01 (RLS has to have something to compare)",
        type: /uuid/,
        notNull: true,
      },
      {
        name: "display_name",
        requirement: "GAR-01′ (“Gitana Blanca”)",
        notNull: true,
      },
      {
        name: "generation_id",
        requirement: "GAR-01′ (taxonomy identity, 001 VEH-01 ids)",
        notNull: true,
      },
      { name: "market_id", requirement: "GAR-01′" },
      { name: "model_year", requirement: "GAR-01′", type: /int/ },
      { name: "engine_id", requirement: "GAR-01′" },
      {
        name: "odometer_km",
        requirement: "GAR-01′ (current odometer)",
        type: /int|numeric/,
      },
      {
        // GAR-01′ names photos in the same breath as the display name. T2-201
        // could only grade that the word "photo" appeared somewhere in the
        // DDL, because no photo *surface* existed to have a shape. It does
        // now, so the column is pinned properly: an array of object paths in
        // VEHICLE_PHOTOS_BUCKET, in the same optional-collection idiom as a
        // record's reference arrays — `not null default '{}'`, where the
        // empty array is "no photos yet" with no null-versus-empty ambiguity
        // for every consumer to re-decide.
        name: "photo_paths",
        requirement: "GAR-01′ (photos) + SHR-01 (paths into a private bucket)",
        type: /\[\]|array/,
        absenceDefaultAllowed: true,
      },
      {
        name: "is_showcase_public",
        requirement: "SHR-01 + SHR-02 (showcase page, off by default)",
        type: /bool/,
        notNull: true,
        defaultsTo: "false",
      },
      {
        name: "is_worklog_public",
        requirement: "SHR-01 + SHR-02 (work-log page, off by default)",
        type: /bool/,
        notNull: true,
        defaultsTo: "false",
      },
    ],
  },
  {
    name: "records",
    requirement: "GAR-02′",
    ownershipPath: ["vehicle_id", "owner_id"],
    columns: [
      { name: "id", requirement: "GAR-02′", type: /uuid/, notNull: true },
      {
        name: "vehicle_id",
        requirement: "GAR-02′ (a record is an entry on a vehicle)",
        type: /uuid/,
        notNull: true,
      },
      {
        name: "occurred_on",
        requirement: "GAR-02′ (“dated”)",
        type: /date/,
        notNull: true,
      },
      {
        name: "kind",
        requirement: "GAR-02′ (“typed: work / receipt / note / plan”)",
        notNull: true,
      },
      { name: "cost_amount", requirement: "GAR-02′", type: /numeric|int/ },
      { name: "cost_currency", requirement: "GAR-02′" },
      { name: "time_minutes", requirement: "GAR-02′", type: /int/ },
      { name: "odometer_km", requirement: "GAR-02′", type: /int|numeric/ },
      {
        name: "problem_ids",
        requirement: "GAR-02′ (typed refs into 001 collections)",
        absenceDefaultAllowed: true,
      },
      {
        name: "part_ids",
        requirement: "GAR-02′",
        absenceDefaultAllowed: true,
      },
      {
        name: "procedure_ids",
        requirement: "GAR-02′",
        absenceDefaultAllowed: true,
      },
      {
        name: "is_public",
        requirement: "SHR-01 (per-record visibility, off by default)",
        type: /bool/,
        notNull: true,
        defaultsTo: "false",
      },
      {
        name: "is_cost_public",
        requirement: "SHR-03 (costs stay private unless opened per record)",
        type: /bool/,
        notNull: true,
        defaultsTo: "false",
      },
    ],
  },
  {
    name: "receipts",
    requirement: "GAR-05′",
    ownershipPath: ["record_id", "vehicle_id", "owner_id"],
    columns: [
      { name: "id", requirement: "GAR-05′", type: /uuid/, notNull: true },
      {
        name: "record_id",
        requirement: "GAR-05′ (a receipt is an attachment on a record)",
        type: /uuid/,
        notNull: true,
      },
      {
        name: "storage_path",
        requirement: "GAR-05′ (the object in the private bucket)",
        notNull: true,
      },
      { name: "vendor", requirement: "GAR-05′" },
      { name: "issued_on", requirement: "GAR-05′", type: /date/ },
      { name: "amount", requirement: "GAR-05′", type: /numeric|int/ },
      { name: "currency", requirement: "GAR-05′" },
    ],
  },
  RECORD_MEDIA_TABLE,
  {
    /**
     * The grants table (SHR-05..08) — declared by T2-401 [TEST], created by
     * T2-404 [PLATFORM].
     *
     * ## Why it is a user table and not infrastructure
     *
     * A row here is a decision one owner made about one truck: who may look,
     * at what, until when. It is owned, it is private, it cascades on account
     * deletion, and it is the single most sensitive table in the schema
     * because it holds the material a bearer presents. Every property the
     * other four tables get — forced RLS, an owner-scoped policy in both
     * `using` and `with check`, no anonymous grant, a cascade to `auth.users`
     * — it gets too, and it gets them from the same sweeps rather than from
     * hand-written one-offs.
     *
     * ## Ownership goes through the vehicle, not through a `granted_by`
     *
     * SHR-08 says the grant is revocable "by its issuer", and the issuer is
     * the vehicle's owner. Hanging ownership off `vehicle_id` rather than off
     * a second user column means there is exactly one answer to "whose grant
     * is this", so a vehicle that changes hands cannot leave a live grant
     * behind that answers to the previous owner — and the RLS predicate is the
     * `records` predicate with one table name changed, a shape already proved
     * against the whole cross-user matrix.
     */
    name: "shares",
    requirement: "SHR-05 (a revocable, expiring, capability-scoped grant)",
    pending: "T2-404",
    ownershipPath: ["vehicle_id", "owner_id"],
    columns: [
      {
        name: "id",
        requirement: "SHR-05",
        type: /uuid/,
        notNull: true,
        pending: "T2-404",
      },
      {
        name: "vehicle_id",
        requirement: "SHR-05 (a grant admits its holder to ONE vehicle)",
        type: /uuid/,
        notNull: true,
        pending: "T2-404",
      },
      {
        // `bytea`, not `text`: `digest(token, 'sha256')` returns bytea, and
        // storing it as text invites a hex/base64 mismatch between the writer
        // and the reader that fails open exactly once — on the comparison that
        // was supposed to reject a stranger.
        name: "token_hash",
        requirement: "SHR-05 (the stored value is not the bearer secret)",
        type: /bytea/,
        notNull: true,
        pending: "T2-404",
      },
      {
        // SHR-05: "A grant SHALL carry a `kind` naming its preset
        // (`mechanic`, `buyer`), and the preset SHALL be a label over explicit
        // capability fields, never a branch in consuming code." The column
        // exists so a grant can be *described*; it must never be what a reader
        // switches on. `share-grants.test.ts` grades both halves.
        name: "kind",
        requirement: "SHR-05 (a preset label over explicit capabilities)",
        notNull: true,
        pending: "T2-404",
      },
      {
        name: "includes_costs",
        requirement: "SHR-06 (costs and receipts are two decisions, not one)",
        type: /bool/,
        notNull: true,
        defaultsTo: "false",
        pending: "T2-404",
      },
      {
        name: "includes_receipts",
        requirement: "SHR-06 (receipts open INDEPENDENTLY of costs)",
        type: /bool/,
        notNull: true,
        defaultsTo: "false",
        pending: "T2-404",
      },
      {
        // `not null`: SHR-08 says every grant "SHALL carry an expiry", and a
        // nullable expiry is a grant that never ends wearing the same column
        // name as one that does. "Until revoked" (003 MEC-06) is a far date,
        // not a null — a null is the state nobody notices until it is years
        // old.
        name: "expires_at",
        requirement: "SHR-08 (every grant SHALL carry an expiry)",
        type: /timestamptz|timestamp with time zone/,
        notNull: true,
        pending: "T2-404",
      },
      {
        // Nullable, and that is the point: null means live. A revocation is a
        // timestamp, not a delete, so "this grant was revoked on the 3rd"
        // survives for the owner to see.
        name: "revoked_at",
        requirement: "SHR-08 (revocable by its issuer at any time)",
        type: /timestamptz|timestamp with time zone/,
        pending: "T2-404",
      },
      {
        name: "created_at",
        requirement: "SHR-08 (an owner cannot audit grants they cannot date)",
        type: /timestamptz|timestamp with time zone/,
        notNull: true,
        pending: "T2-404",
      },
    ],
  },
] as const;

/** Convenience: the table names, in the order the cascade walks them. */
export const USER_TABLE_NAMES = USER_TABLES.map((table) => table.name);

/* -------------------------------------------------------------------------
 * GAR-06′ — record media attachments (declared by T2-305a [TEST])
 * ---------------------------------------------------------------------- */

/**
 * The three attachment kinds GAR-06′ names, and nothing else.
 *
 * > **GAR-06′** A record SHALL support general documentation attachments —
 * > photo, video, or audio, in addition to GAR-05′'s image/PDF receipts —
 * > uploaded into user-private storage, independent of a receipt's
 * > vendor/date/amount fields.
 *
 * Each kind carries the MIME *prefix* that defines it, because the bucket's
 * `allowed_mime_types` is graded against the category rather than against a
 * list of spellings: `video/mp4` and `video/quicktime` are both video, and a
 * grader that enumerated one spelling would reject the other for no reason a
 * requirement can name. `sample` is one concrete member of the category, for
 * the live upload probes — a fixture has to pick something.
 *
 * `extension` exists so a synthetic object path is obviously what it claims to
 * be; Supabase's bucket filter reads the declared content type rather than the
 * name, so nothing depends on it, but a listing full of `.bin` would make a
 * live failure harder to read than it needs to be.
 */
export const RECORD_MEDIA_KINDS = [
  {
    kind: "photo",
    mimePrefix: "image/",
    sample: "image/jpeg",
    extension: "jpg",
  },
  {
    kind: "video",
    mimePrefix: "video/",
    sample: "video/mp4",
    extension: "mp4",
  },
  {
    kind: "audio",
    mimePrefix: "audio/",
    sample: "audio/mp4",
    extension: "m4a",
  },
] as const;

/** Convenience: just the kind names, for a `check` constraint or an enum. */
export const RECORD_MEDIA_KIND_NAMES = RECORD_MEDIA_KINDS.map(
  (entry) => entry.kind
);

/**
 * A MIME type in **none** of the three declared categories.
 *
 * `application/pdf` on purpose, and not an invented type: it is the one the
 * receipts bucket really allows, so "the media bucket refuses it" is a claim
 * about the boundary between GAR-05′ and GAR-06′ rather than a claim about a
 * string nobody would ever upload. If the media bucket accepted it, the two
 * surfaces would have collapsed into one general-purpose file host and the
 * independence GAR-06′ asks for would be a naming convention.
 */
export const NON_MEDIA_MIME_TYPE = "application/pdf";

/**
 * The columns that make a receipt a *receipt* (GAR-05′), named in one place.
 *
 * GAR-06′ is explicit that an attachment is "independent of a receipt's
 * vendor/date/amount fields". The grader that enforces it is a negative — no
 * column in this list may be required on a media row — so the list has to be
 * enumerated rather than inferred, in the same style as
 * `KNOWN_EXTERNAL_PROVIDERS` and `PLAINTEXT_TOKEN_COLUMNS`.
 */
export const RECEIPT_FINANCIAL_COLUMNS = [
  "vendor",
  "issued_on",
  "amount",
  "currency",
] as const;

/**
 * Tables this file has declared that no migration creates yet.
 *
 * Named rather than commented out, so the promotion grader has something to
 * read and so a reader can tell "declared, pending" from "forgotten".
 *
 * **Empty since T2-305**, which promoted `record_media` into `USER_TABLES` in
 * the commit that created the table. The export stays: `rules.ts` reads it so
 * `isCorrelated` has columns to test a pending table's policy against, and the
 * next table declared ahead of its migration refills it. An empty array here
 * means "nothing is waiting", which is a different and better answer than
 * "this idea was deleted".
 */
export const PENDING_USER_TABLES: readonly TableContract[] = [];

/* -------------------------------------------------------------------------
 * Two kinds of "not yet", and they are NOT the same list
 *
 * `PENDING_USER_TABLES` above (T2-305a) means **declared here but absent from
 * `USER_TABLES`** — a table the contract describes and the enumerated set does
 * not yet admit. Its promotion step is to *move* the entry into `USER_TABLES`
 * and empty that array.
 *
 * The pair below (T2-401) means **inside `USER_TABLES`, carrying a `pending`
 * marker** — enumerated, swept by every table-level grader, but under
 * `it.fails` until the migration catches up. Its promotion step is to delete
 * one `pending:` line.
 *
 * They arrived in the same file from two branches and briefly shared a name,
 * which did not compile. Keeping both, distinctly named, is deliberate: they
 * solve the same problem for tables at different stages, and collapsing them
 * would mean rewriting whichever task's promotion path lost. The distinction a
 * reader needs is *is the table in `USER_TABLES` yet* — if yes, it is
 * shipped-or-unshipped below; if no, it is pending above.
 * ---------------------------------------------------------------------- */

/**
 * The enumerated tables whose graders run unmarked, because they exist.
 *
 * Every `it.each` sweep over the contract partitions on this — see
 * `ColumnContract.pending` for why the unshipped half is not simply left out.
 */
export const SHIPPED_USER_TABLES = USER_TABLES.filter(
  (table) => table.pending === undefined
);

/**
 * The enumerated tables a named task still has to create. Swept under
 * `it.fails`, never dropped.
 *
 * `UNSHIPPED`, not `PENDING`, precisely because `PENDING_USER_TABLES` above
 * already means something else in this file.
 */
export const UNSHIPPED_USER_TABLES = USER_TABLES.filter(
  (table) => table.pending !== undefined
);

/**
 * Every `[table, column, requirement, contract]` row in the contract, split by
 * whether the thing it describes exists yet.
 *
 * One helper rather than four copies of the same `flatMap` + partition, so a
 * sweep cannot accidentally use the shipped half's predicate on the pending
 * half's rows — which would report an expected failure as a pass.
 */
export function columnRows(
  pending: boolean
): readonly (readonly [string, string, string, ColumnContract])[] {
  return USER_TABLES.flatMap((table) =>
    table.columns
      .filter(
        (column) =>
          ((table.pending ?? column.pending) !== undefined) === pending
      )
      .map(
        (column) =>
          [table.name, column.name, column.requirement, column] as const
      )
  );
}

/**
 * Every column whose *default* is the privacy guarantee. SHR-01 says
 * "everything a user stores SHALL default to private"; a boolean that is
 * nullable, or defaults to true, or has no default at all, breaks it — so all
 * three are graded, not just the value.
 */
export const SHARE_FLAG_COLUMNS: readonly {
  readonly table: string;
  readonly column: string;
  readonly requirement: string;
  /** The task that ships it, when it does not exist yet. */
  readonly pending?: string;
}[] = USER_TABLES.flatMap((table) =>
  table.columns
    .filter((column) => column.defaultsTo === "false")
    .map((column) => ({
      table: table.name,
      column: column.name,
      requirement: column.requirement,
      pending: table.pending ?? column.pending,
    }))
);

/* -------------------------------------------------------------------------
 * Storage
 * ---------------------------------------------------------------------- */

/**
 * The private bucket receipts live in (GAR-05′: "uploadable (image/PDF) into
 * user-private storage … never publicly accessible").
 */
export const RECEIPTS_BUCKET = "receipts";

/**
 * The private bucket vehicle photos live in — declared by T2-301a [TEST],
 * created by T2-301 [PLATFORM].
 *
 * ## Naming (T2-301a decision)
 *
 * `vehicle-photos`, not `photos`. A bucket id is global to the project and
 * permanent in every stored path, so the generic name would have to be shared
 * the first time anything else needs images — a profile avatar, a showcase
 * banner — and sharing it means one policy governing objects with different
 * ownership rules. `vehicle-photos` says what is in it and leaves the generic
 * name free.
 *
 * ## Private, like receipts, and for a reason that is *not* obvious
 *
 * A receipt is private because of what it shows. A vehicle photo is private
 * because of SHR-01: "everything a user stores SHALL default to private". A
 * truck in a driveway is a house, a plate, a neighbourhood. Nothing about
 * GAR-01′ asks for photos to be reachable without a session, and a public
 * bucket cannot be made private again for objects already uploaded.
 *
 * **Open question this deliberately does not answer, flagged for T2-401/402:**
 * SHR-02's showcase page is public, and a public page cannot render an object
 * from a private bucket without a signed URL, which expires. Whether that is
 * solved with long-lived signed URLs, a render-time proxy, or a second public
 * bucket that a user opts an image into, is a *sharing* decision and belongs
 * with the sharing graders. Pinning it here would be inventing the answer.
 *
 * The constraint that makes it hard, so T2-401 does not have to rediscover it:
 * **this site is static** (AGENTS.md, Stack — Astro, static output, on Vercel).
 * There is no request-time server to mint a fresh signed URL for an anonymous
 * visitor, so every option collapses to signing at *build* time — which means
 * a URL whose expiry is a deploy-cadence problem, and a rebuild whenever a
 * user adds a photo — or introducing an Edge Function, which is a new runtime
 * surface and therefore a stop-and-ask rather than a drive-by.
 */
export const VEHICLE_PHOTOS_BUCKET = "vehicle-photos";

/**
 * The private bucket a record's media attachments live in — declared by
 * T2-305a [TEST], created by T2-305 [PLATFORM].
 *
 * > **GAR-06′** A record SHALL support general documentation attachments —
 * > photo, video, or audio … uploaded into user-private storage … Never
 * > publicly accessible unless the record's visibility is opened.
 *
 * ## Why a third bucket rather than widening one of the two that exist
 *
 * Widening `receipts` would mean one `allowed_mime_types` list governing both
 * a financial document and a voice note, and one bucket where "is this a
 * receipt" is answered by which table happens to name the path — the exact
 * coupling GAR-06′ says must not exist ("independent of a receipt's
 * vendor/date/amount fields"). Widening `vehicle-photos` is worse: its objects
 * are `<owner>/<vehicle>/<file>` and its delete trigger sweeps that prefix, so
 * a record's media dropped in there would either be missed by the record-delete
 * path or swept away by the vehicle one, depending on where it was filed.
 *
 * A bucket is also the only place a MIME restriction can be enforced by the
 * platform rather than by page code, and SHR-01 is explicit that a check living
 * in client or page code is not one of the three permitted enforcement modes.
 *
 * ## Named for its contents
 *
 * `record-media`, matching `RECORD_MEDIA_TABLE` — see that entry for why the
 * generic `record-attachments` was rejected. The bucket id must be a valid
 * Supabase bucket id, which is why it is hyphenated where the table is
 * underscored; `vehicle-photos` / `vehicles.photo_paths` set that precedent.
 *
 * ## Private, and the open question is *still* open
 *
 * SHR-01 again: everything a user stores defaults to private, and a bucket that
 * has ever been public cannot be un-published for objects already in it. How a
 * *public* work-log page (SHR-02) renders an object out of a private bucket is
 * the same unanswered sharing question `VEHICLE_PHOTOS_BUCKET` records above,
 * and this entry does not answer it either. Video makes it slightly worse and
 * not differently shaped: a signed URL for a fifty-megabyte video expires
 * mid-playback exactly as one for a photo expires mid-render.
 */
export const RECORD_MEDIA_BUCKET = "record-media";

/**
 * Every bucket that must never serve an object without a session.
 *
 * `vehicle-photos.test.ts` runs a `describe.each` sweep over this list —
 * created-private, policed on all four commands, reached by the account purge
 * — so a third private bucket added here inherits those invariants the day it
 * is created, rather than the day someone remembers to write graders for it.
 *
 * The sweep is unmarked and conditional on the bucket existing, because a
 * bucket's *existence* is a different claim from its privacy and is pinned
 * separately. Adding a name here therefore costs nothing until the migration
 * catches up, and starts paying the moment it does.
 */
export const PRIVATE_BUCKETS = [
  RECEIPTS_BUCKET,
  VEHICLE_PHOTOS_BUCKET,
  RECORD_MEDIA_BUCKET,
] as const;

/* -------------------------------------------------------------------------
 * Auth surface (ACC-01)
 * ---------------------------------------------------------------------- */

/**
 * > **ACC-01** THE site SHALL authenticate users via Supabase Auth with email
 * > magic link and Google OAuth, and no password flow.
 *
 * "and no password flow" is the load-bearing half. The allowed set is closed:
 * anything not in it is a finding, including providers that are merely
 * *available* and left switched on by a default config.
 */
export const ALLOWED_AUTH_PROVIDERS = ["email", "google"] as const;

/**
 * External providers Supabase Auth can be configured with. The auth-surface
 * grader asserts every one of these except `google` is disabled — an
 * allow-list is only a guarantee if the deny half is enumerated.
 *
 * Source: `supabase/config.toml`'s `[auth.external.*]` table as shipped by
 * the Supabase CLI. If the CLI adds a provider, this list grows; a provider
 * missing from the config file counts as disabled.
 */
export const KNOWN_EXTERNAL_PROVIDERS = [
  "apple",
  "azure",
  "bitbucket",
  "discord",
  "facebook",
  "figma",
  "github",
  "gitlab",
  "google",
  "kakao",
  "keycloak",
  "linkedin_oidc",
  "notion",
  "slack_oidc",
  "spotify",
  "twitch",
  "twitter",
  "workos",
  "zoom",
] as const;

/* -------------------------------------------------------------------------
 * Account deletion (ACC-03)
 * ---------------------------------------------------------------------- */

/**
 * > **ACC-03** A user SHALL be able to delete their account; after a 30-day
 * > recovery window, all vehicles, records, and stored files SHALL be
 * > hard-deleted.
 *
 * ## Why this is two functions and not one
 *
 * The first version pinned a single `hard_delete_account(p_user_id uuid)` and
 * pinned it **inconsistently** (T2-201 review, F7): the declaration grader
 * demanded `auth.uid()` inside the body — so a stranger could not name a
 * victim — while the behavioural grader invoked it with a service token,
 * where `auth.uid()` is null. No single implementation could satisfy both.
 * The graders described two different functions and nobody noticed because
 * neither tier could run.
 *
 * They really are two different functions, so ACC-03's two events now get one
 * each:
 *
 * 1. **The user asks.** `request_account_deletion()` takes **no argument** and
 *    marks the caller's own account, using `auth.uid()`. Taking no user id is
 *    what makes "delete someone else's account" unrepresentable rather than
 *    merely forbidden — there is no parameter to put a victim in.
 * 2. **Thirty days pass.** `purge_expired_accounts(p_now timestamptz)` is the
 *    scheduled job: service-role only, no user argument, and it hard-deletes
 *    every account whose window has closed. It takes `p_now` so a grader can
 *    make "thirty days later" happen without waiting — the window stays real,
 *    and it stays testable.
 *
 * 3. **The terminal event.** Deleting the `auth.users` row must leave nothing
 *    behind, whatever route got us there. That grader names nothing at all
 *    and survives any rename of either function above.
 */
export const REQUEST_DELETION_FUNCTION = "request_account_deletion";

/** The scheduled purge. Service-role only; `p_now` makes the window testable. */
export const PURGE_FUNCTION = "purge_expired_accounts";

/** The recovery window, in days, that the purge must honour. */
export const RECOVERY_WINDOW_DAYS = 30;

/* -------------------------------------------------------------------------
 * Typed share grants (SHR-05..08) — declared by T2-401a [TEST]
 * ---------------------------------------------------------------------- */

/**
 * The roles an anonymous visitor arrives as.
 *
 * `public` is in the list because it is not a role beside `anon` — it is
 * *every* role, `anon` included. A privilege granted to `public` is a
 * privilege `anon` holds, and a `revoke … from anon` does not take it away.
 */
export const ANONYMOUS_ROLES = ["anon", "public"] as const;

/**
 * One function a grant holder with **no account** may execute.
 *
 * ## Why this list is the whole allow-list, and why it is closed
 *
 * SHR-07 puts a reader on the far side of the database with no `auth.uid()`,
 * which means RLS cannot be what protects it: the architecture decided for
 * T2-404 is a `security definer` function granted to `anon`, and a definer
 * function runs as its owner with RLS on the tables it reads **not consulted**.
 * Whatever the body checks is the entire access control.
 *
 * So the question a grader has to be able to answer is not "are these three
 * functions safe" but "is anything *else* reachable". That is only answerable
 * against a closed set: the functions executable by `anon` or `public` must
 * **equal** this list. The deny half is enumerated the same way
 * `KNOWN_EXTERNAL_PROVIDERS` enumerates it for auth providers — an allow-list
 * is only a guarantee when the complement is computed, not assumed.
 *
 * ## The names are this file's decision, and renegotiable in one line
 *
 * Exactly as for the table names above: T2-401a has to name something for the
 * graders to be concrete, and it names it here rather than in five test files.
 * If T2-404 prefers `share_records_read`, that is a one-line conversation with
 * the conductor. What is **not** negotiable is the behaviour graded around
 * them — definer, `set search_path = ''`, hash-not-plaintext, expiry,
 * revocation, and a named column projection.
 *
 * ## Why three readers and not one
 *
 * SHR-06: "costs and receipts are two decisions, not one", and where a grant
 * does not open costs "THE data returned SHALL omit the cost fields entirely
 * rather than blanking them at render time". Two independent capability bits
 * over one all-or-nothing payload is how a blanking bug gets written; separate
 * entry points make the omission structural. The vehicle reader is separate
 * again because §10's fourth ruling gives the accountless holder the 001
 * reference "filtered to that exact vehicle by the fitment engine", and that
 * needs the taxonomy identity and nothing else.
 */
/**
 * The schema every unqualified name in this file lives in.
 *
 * ## Why this is a named constant and not the string `"public"` in six places
 *
 * Every routine name here is written unqualified, and a grader that matches an
 * unqualified name against a parsed routine is matching **half an identity**.
 * Postgres will happily hold a `private.share_read_records` beside a
 * `public.share_read_records`; they are different functions with different
 * ACLs, and a comparison on `name` alone cannot tell them apart. That is not a
 * hypothetical — it is the shape a schema-qualified migration takes the first
 * time someone moves a helper out of `public` to tidy the API surface.
 *
 * Named here so the schema half of every comparison comes from one place, and
 * so a contract entry that ever needs a different schema is a one-line change
 * rather than a hunt (PR #74 review).
 */
export const CONTRACT_SCHEMA = "public";

export interface ShareReaderContract {
  /** Unqualified function name, resolved in `CONTRACT_SCHEMA`. */
  readonly name: string;
  /** The requirement that puts this function on the anon surface. */
  readonly requirement: string;
  /** What it is for, in one line, for a finding message. */
  readonly purpose: string;
}

export const SHARE_READER_FUNCTIONS: readonly ShareReaderContract[] = [
  {
    name: "share_read_vehicle",
    requirement:
      "SHR-05 + SHR-07 (§10 ruling 4: reference filtered by fitment)",
    purpose:
      "the vehicle's taxonomy identity, so the 001 fitment engine can filter " +
      "the reference to this exact truck",
  },
  {
    name: "share_read_records",
    requirement: "SHR-05 + SHR-06 (history; cost fields omitted, not blanked)",
    purpose:
      "the vehicle's history, with cost columns present only when the grant opens them",
  },
  {
    name: "share_read_receipts",
    requirement: "SHR-06 (receipts open independently of costs)",
    purpose:
      "receipt metadata and the storage path the Edge signer resolves, only " +
      "when the grant opens receipts",
  },
] as const;

/** Convenience: the share-reader names. */
export const SHARE_READER_NAMES = SHARE_READER_FUNCTIONS.map(
  (reader) => reader.name
);

/**
 * The enumerated deny half: routines that exist today and must never become
 * executable by `anon` or `public`.
 *
 * The closed allow-list above already catches any of these by computing the
 * complement, so this list is belt and braces — but it is the half that names
 * *why* each one is dangerous, and a finding that says
 * "purge_expired_accounts is anon-executable" is worth more than one that says
 * "an unexpected function is anon-executable".
 *
 * A name absent from the migrations is not a finding here: this asks what is
 * true of the routines that exist, not that they all still exist.
 */
export const PRIVILEGED_FUNCTIONS: readonly {
  readonly name: string;
  readonly why: string;
}[] = [
  {
    name: "handle_new_user",
    why: "inserts into profiles as its owner; anon-executable means anyone mints rows",
  },
  {
    name: "request_account_deletion",
    why: "ACC-03: marks an account for deletion — must require a session to name one",
  },
  {
    name: "purge_expired_accounts",
    why: "ACC-03: hard-deletes accounts whose window closed; service-role only",
  },
  {
    name: "handle_vehicle_deleted",
    why: "deletes storage objects as its owner",
  },
  {
    name: "deny_password_login",
    why: "ACC-01: GoTrue's auth hook; only supabase_auth_admin may call it",
  },
] as const;

/**
 * The column a share token is stored in — **a hash, never the token**.
 *
 * T2-404's architecture record: 256 bits from `gen_random_bytes(32)`, stored
 * as `token_hash bytea not null unique` = `digest(token, 'sha256')`. Plain
 * sha256 is deliberate and correct against a 256-bit keyspace; the point the
 * graders pin is that the *stored* value is not the bearer secret, so a
 * database leak is not a grant leak.
 */
export const SHARE_TOKEN_HASH_COLUMN = "token_hash";

/**
 * Column names that would mean the bearer secret is stored in the clear.
 *
 * Graded as a sweep over every created table rather than over a `shares` table
 * this file has not declared: the claim is "no table anywhere stores a share
 * token in plaintext", and naming the table would make it a claim about one.
 */
export const PLAINTEXT_TOKEN_COLUMNS = [
  "token",
  "token_plaintext",
  "plain_token",
  "share_token",
  "secret",
] as const;

/**
 * > **SHR-08** Every grant SHALL be revocable by its issuer at any time and
 * > SHALL carry an expiry.
 *
 * Two columns, because they are two independent failures. A grant that
 * validates the hash but never reads `revoked_at` is a grant that **cannot be
 * revoked**, and SHR-08 says revocation "SHALL take effect on the next request"
 * — which makes it the likeliest and the worst defect in the feature.
 */
export const GRANT_EXPIRY_COLUMN = "expires_at";
export const GRANT_REVOCATION_COLUMN = "revoked_at";

/**
 * Tables that may exist in `public` without being user data.
 *
 * In the style of `check-hreflang.mjs`'s `EXEMPT_PAGES`: a *named* exemption
 * with a reason, so the sweep over `createdTables()` stays closed. Anything
 * created in `public` that is neither in `USER_TABLES` nor named here is a
 * finding — "an ungraded table", which is what the constitution's "every user
 * table ships with row-level security proven by graders" forbids.
 *
 * **Empty today, and deliberately so.** Every table that exists is enumerated,
 * and so is every table a named task is going to create. In particular
 * `shares` is *not* exempt — T2-401 added it to `USER_TABLES` as a pending
 * entry, which is the ordering the task list encodes (T2-401 merges before
 * T2-404). Exempting it here to keep a build quiet would re-open the hole this
 * map was added to close.
 */
export const EXEMPT_PUBLIC_TABLES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([]);

/**
 * `table.column` boolean columns that may default to **true**, and why.
 *
 * The companion to `optimisticBooleanDefaultIssues`, which sweeps every
 * boolean in the schema rather than every boolean whose *name* looks like a
 * visibility flag. That inversion is the whole point: the flag nobody told the
 * guard about is, by construction, the one that does not follow the naming
 * convention the guard was matching on.
 *
 * **Empty, and it should stay that way.** SHR-01 makes "defaults to private"
 * the schema's posture, and a boolean that starts life `true` is a decision
 * made on the user's behalf. Adding a row here is a deliberate diff in a file
 * called `contract.ts`, reviewed beside the migration that needs it — which is
 * exactly the visibility a default-open column should have to earn.
 */
export const OPTIMISTIC_BOOLEAN_DEFAULTS: ReadonlyMap<string, string> = new Map<
  string,
  string
>([]);

/* -------------------------------------------------------------------------
 * Typed share grants, continued (SHR-05..09) — declared by T2-401 [TEST]
 * ---------------------------------------------------------------------- */

/**
 * > **SHR-05** … A grant SHALL carry a `kind` naming its preset (`mechanic`,
 * > `buyer`), and the preset SHALL be a label over explicit capability fields,
 * > **never a branch in consuming code**.
 *
 * A closed set, in the style of `records.kind`: two presets and no third. The
 * second half of the requirement is the half that is easy to lose, so it is
 * graded separately — a reader whose body says `if kind = 'mechanic'` has made
 * the label load-bearing, and the capability columns beside it decorative.
 */
export const SHARE_GRANT_KINDS = ["mechanic", "buyer"] as const;

/**
 * The capability columns a grant opens **independently** (SHR-06).
 *
 * Two, not one, and the graders check each against the other: a reader that
 * refuses receipts only when costs are also shut has collapsed two decisions
 * into one, which is precisely what SHR-06 forbids. That is a defect no schema
 * grader can see — both columns exist and both default to false — so it is
 * graded behaviourally, one cell per combination.
 */
export const SHARE_CAPABILITY_COLUMNS = [
  "includes_costs",
  "includes_receipts",
] as const;

/**
 * The two authenticated RPCs an owner uses to manage grants.
 *
 * Named here for the same reason the readers are: a grader has to name
 * something, and one line in this file is cheaper to renegotiate than five
 * test files. What is not negotiable is that **revocation is never gated** —
 * SHR-08 and 003 MON-02 both say so, and the grader for it asks whether the
 * body consults anything but the caller's ownership of the vehicle.
 */
export const SHARE_CREATE_FUNCTION = "create_share_grant";
export const SHARE_REVOKE_FUNCTION = "revoke_share_grant";

/**
 * The **parameter names**, not just the function names.
 *
 * ## Why the arguments are pinned here too (T2-401 review, F3)
 *
 * PostgREST resolves an RPC overload **by argument name**. A call whose named
 * arguments match no function resolves to nothing and quietly does nothing —
 * it does not error in a way a grader reading `response.ok` can distinguish
 * from a refusal. The first draft of these graders had three different revoke
 * signatures across the branch, and the one used by the central SHR-08 proof
 * revoked nothing at all: the "all three refusals are identical" comparison
 * would have compared a **live grant's successful response** against two
 * refusals, and failed for a fixture reason on the one grader whose whole job
 * is proving the requirement. That is the failure shape that gets an assertion
 * loosened by whoever hits it at 5pm.
 *
 * So the argument list is contract, graded like the names are, and every call
 * site reads it from here — `share-fixtures.ts` is the only place that builds
 * these payloads.
 */
export const SHARE_CREATE_ARGUMENTS = [
  "p_vehicle_id",
  "p_kind",
  "p_includes_costs",
  "p_includes_receipts",
  "p_expires_in_hours",
] as const;

/**
 * Revocation takes **one grant**, by id.
 *
 * > **SHR-08** Every grant SHALL be revocable **by its issuer** at any time.
 *
 * Read literally, that is a per-grant operation: an owner who issued a link to
 * their mechanic in March and another to a buyer in June must be able to end
 * one without ending the other. A `revoke_share_grant(p_vehicle_id)` — which an
 * earlier draft of these graders assumed — is a *different* operation, "revoke
 * everything on this truck", and the spec does not ask for it. Flagged to the
 * conductor rather than designed here: if the owner wants a revoke-all, it is a
 * second RPC with a second name, not a wider parameter on this one.
 *
 * The consequence for the create RPC is that it must return the grant's id
 * beside its token — see {@link SHARE_CREATE_RESULT_FIELDS}. A token is a
 * secret the owner copies once; an id is how they manage what they issued.
 */
export const SHARE_REVOKE_ARGUMENTS = ["p_share_id"] as const;

/**
 * What the create RPC hands back: the id to manage the grant with, and the
 * bearer token, **once**.
 *
 * The token exists in plaintext for exactly one response and never again
 * (`SHARE_TOKEN_HASH_COLUMN`), so this is the only shape in the system allowed
 * to carry it.
 */
export const SHARE_CREATE_RESULT_FIELDS = ["share_id", "token"] as const;

/**
 * The Edge Function that signs a receipt for a grant holder (T2-404).
 *
 * A Postgres function cannot mint a Supabase signed URL, so authorization
 * stays in Postgres — the anon RPC validates the token and *resolves* the path
 * — and the Edge Function signs the path it was handed back. The one rule that
 * makes that split safe is that **the signer never accepts a caller-supplied
 * path**; if it did, the authorization in Postgres would be advisory.
 */
export const RECEIPT_SIGNER_DIR = "supabase/functions/sign-receipt";

/**
 * The window a signed receipt URL may live for, in seconds.
 *
 * ## Why there is a ceiling at all
 *
 * A signed URL is a bearer credential that has left the building: it carries
 * no session, it is not revocable, and it works for whoever holds it. SHR-08
 * makes revocation take effect "on the next request" — but a signature already
 * minted *is* the previous request's answer, and nothing recalls it. The TTL is
 * therefore the only thing bounding a leaked signature, which makes the ceiling
 * a security parameter and not a tuning knob.
 *
 * ## Why there is a floor
 *
 * A URL that dies before the image finishes loading on a bad connection in a
 * workshop is a feature that does not work, and the fix somebody reaches for
 * under pressure is a much larger number. 60 seconds is the smallest window
 * that survives a slow mobile fetch; 300 is the largest that still bounds a
 * leak to "minutes".
 */
export const SIGNED_URL_TTL_SECONDS = { min: 60, max: 300 } as const;

/* -------------------------------------------------------------------------
 * Public handles (SHR-02) — declared by T2-401 [TEST]
 * ---------------------------------------------------------------------- */

/**
 * The shape a handle may take.
 *
 * Lower-case, digits, and single interior hyphens. No dots (they make a handle
 * look like a hostname and break the `x-default` hreflang pairing), no
 * underscores (indistinguishable from a hyphen in a printed URL), no leading
 * or trailing hyphen, and a floor of two characters so single letters stay
 * available for the site's own routes.
 */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const HANDLE_LENGTH = { min: 2, max: 32 } as const;

/**
 * Handles nobody may take, beyond the site's own route segments.
 *
 * ## Why this list is not the whole answer
 *
 * The dangerous collision is not `admin` — it is whatever route segment
 * somebody adds next year. So the reserved set is graded as **a superset of
 * the route segments that actually exist**, computed from `src/pages/` at test
 * time, rather than as a hand-written list checked against itself. This
 * constant is only the part a filesystem scan cannot know: words that would let
 * an account impersonate the site or its operators.
 *
 * `admin` and `api` are named in the task brief and are both here. They are
 * **not** takeable, and neither is any locale code, because `/es/` and a user
 * called `es` are the same string in the same position of the same URL.
 */
export const RESERVED_HANDLES = [
  // Impersonation. A handle is the only part of a garage URL a stranger types.
  "admin",
  "administrator",
  "api",
  "root",
  "support",
  "help",
  "official",
  "staff",
  "moderator",
  "security",
  "billing",
  "montero",
  "monterogarage",
  "gitana",
  "www",
  "mail",
  "static",
  "assets",
  "_astro",
  // The locales. `/es/` and a user called `es` are the same string in the same
  // position of the same URL.
  "en",
  "es",
  // Every route segment the site serves today, both locales, extracted from
  // `src/i18n/routes.ts` and checked against it by `handles.test.ts` so this
  // half cannot fall behind the site.
  //
  // **Reserved even though the handle's position in the URL is T2-402's to
  // decide.** If handles turn out to be nested under the garage segment, these
  // cost one Costa Rican owner the handle `taller`; if they turn out to be
  // top-level, not reserving them is a site-breaking collision and an
  // impersonation surface. The asymmetry is not close, and un-reserving later
  // is safe in a way that reserving later is not — somebody already holds it by
  // then.
  "glossary",
  "glosario",
  "community",
  "comunidad",
  "sign-in",
  "ingresar",
  "garage",
  "taller",
  "problems",
  "problemas",
  "parts",
  "repuestos",
  // T601's mods collection, added when it merged to main. The grader caught
  // this on the first CI run after the sync and named both locales — which is
  // the whole point of cross-checking the list against
  // `COLLECTION_ROUTE_SEGMENTS` rather than trusting it to stay complete.
  "mods",
  "modificaciones",
] as const;

/* -------------------------------------------------------------------------
 * Synthetic fixture namespace
 * ---------------------------------------------------------------------- */

/**
 * Every row, file, and account these graders create is stamped `TEST-` and
 * addressed in the RFC 2606 `.invalid` TLD, so a fixture that escapes into a
 * real database is obvious on sight and its email can never be delivered.
 * Nothing here resembles a real owner, a real truck, or a real receipt.
 */
export const TEST_NAMESPACE = "TEST-T2-201";

/** A non-routable address for synthetic actor `slot` (`a`, `b`, …). */
export function testEmail(slot: string, runId: string): string {
  return `${TEST_NAMESPACE.toLowerCase()}-${slot}-${runId}@t2-201.invalid`;
}

/** A display name no real user would pick. */
export function testVehicleName(slot: string): string {
  return `${TEST_NAMESPACE}-VEHICLE-${slot.toUpperCase()}`;
}

/** A receipt object path inside the private bucket. */
export function testReceiptPath(ownerId: string, slot: string): string {
  return `${ownerId}/${TEST_NAMESPACE}-RECEIPT-${slot}.pdf`;
}

/**
 * A vehicle-photo object path — **`<owner uuid>/<vehicle id>/<file>`**.
 *
 * ## Why two segments (T2-301a decision)
 *
 * The first segment is the owner, exactly as for receipts, because
 * `(storage.foldername(name))[1]` is what every storage policy compares to
 * `auth.uid()`. Keeping that position identical means the photos policies are
 * the receipts policies with one bucket id changed — a shape already proved
 * against the whole cross-user matrix, rather than a second thing to get
 * right.
 *
 * The second segment is the vehicle, and it is what makes
 * "delete this vehicle's photos" a prefix operation instead of a join. Without
 * it, removing one vehicle from a garage with three would mean reading
 * `photo_paths`, diffing it against the bucket, and hoping the two agree —
 * a reconciliation that is wrong the moment either side is written outside
 * the happy path.
 */
export function testVehiclePhotoPath(
  ownerId: string,
  vehicleId: string,
  slot: string
): string {
  return `${ownerId}/${vehicleId}/${TEST_NAMESPACE}-PHOTO-${slot}.jpg`;
}

/**
 * A record-media object path — **`<owner uuid>/<vehicle id>/<record id>/<file>`**.
 *
 * ## Why three id segments (T2-305a decision)
 *
 * The first segment is the owner, for the third time and for the same reason:
 * `(storage.foldername(name))[1]` is what every storage policy in this project
 * compares to `auth.uid()`, so keeping that position identical makes the
 * `record-media` policies the receipts policies with one bucket id changed —
 * a shape already proved against the whole cross-user matrix.
 *
 * The **third** segment is the load-bearing one, and it is here because of a
 * gap this project already has and has already paid for. T2-302 recorded it in
 * its own task notes:
 *
 * > **Found, not fixed — receipts have no delete-trigger belt.**
 * > `on_vehicle_deleted` sweeps `vehicle-photos` by `<owner>/<vehicle>/`
 * > prefix; receipt objects are `<owner>/<file>` (the contract's shape), so no
 * > prefix identifies one vehicle's receipts and no trigger can find them
 * > without reading the rows it is cascading away.
 *
 * That is a *path* defect, not a trigger defect: `<owner>/<file>` carries no
 * information about which record or which vehicle an object belongs to, so the
 * belt is unwritable however much anyone wants it. Putting the record id in
 * the path makes "delete this record's media" a prefix match — which is what
 * lets T2-305a grade the trigger's existence instead of recording the gap a
 * third time and moving on. The vehicle segment is kept between them so the
 * existing `<owner>/<vehicle>/` prefix sweep also reaches these objects, and
 * so a per-vehicle operation never has to enumerate records.
 *
 * `extension` is the caller's, because a `.m4a` and a `.mp4` are different
 * things to a human reading a bucket listing and identical to every policy.
 */
export function testRecordMediaPath(
  ownerId: string,
  vehicleId: string,
  recordId: string,
  slot: string,
  extension: string
): string {
  return (
    `${ownerId}/${vehicleId}/${recordId}/` +
    `${TEST_NAMESPACE}-MEDIA-${slot}.${extension}`
  );
}

/**
 * A taxonomy identity for a synthetic vehicle. Real 001 ids (`gen3`, `us`,
 * `6g74-sohc`) on purpose: GAR-01′ says the identity is "resolved against
 * 001's vehicles collection", so a fixture with an invented generation would
 * be testing the wrong thing the day that resolution is enforced.
 */
export const TEST_TAXONOMY_IDENTITY = {
  generation_id: "gen3",
  market_id: "us",
  model_year: 2002,
  engine_id: "6g74-sohc",
} as const;

/**
 * A synthetic public handle for slot `slot` and run `runId`.
 *
 * Lower-case and hyphenated so it satisfies `HANDLE_PATTERN` — a fixture the
 * format rule would reject on its own could never test uniqueness, case
 * folding, or reservation, because the first rule would answer first. Still
 * unmistakably synthetic: nothing a real owner would choose, and it carries the
 * run id so two concurrent runs cannot collide on the unique index and turn a
 * uniqueness proof into a provisioning failure.
 */
export function testHandle(slot: string, runId: string): string {
  return `${TEST_NAMESPACE.toLowerCase()}-${slot}-${runId}`;
}

/**
 * A synthetic bearer token — **not** a credential, and obviously so.
 *
 * A real grant token is 256 bits from `gen_random_bytes(32)`. This is a
 * labelled string, because a fixture that looked like a real token would become
 * one the day somebody pasted it into an issue. It is only ever presented to a
 * grader as "the wrong token", or hashed into a row that same grader created.
 */
export function testShareToken(slot: string, runId: string): string {
  return `${TEST_NAMESPACE}-SHARE-TOKEN-${slot.toUpperCase()}-${runId}`;
}
