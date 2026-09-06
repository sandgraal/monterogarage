/**
 * Graders for the two write paths T2-305 changed, against a recording client.
 *
 * `garage.test.ts` covers the session helpers, which need no client. These need
 * one, so they get a fake — and the fake is the point: what is being graded is
 * **the shape of the request this module makes**, which is the only thing the
 * module actually controls. Row-level security is the enforcement, in the
 * database, and it is graded live in `tests/garage/`.
 *
 * ## Why the photo path is graded at all now
 *
 * The lost-update race T2-304 found (recorded on T2-305 in `tasks.md`) was a
 * *client-shaped* bug: the browser read `photo_paths`, appended to the array it
 * had read, and sent the whole array back, so two overlapping uploads both
 * started from the same array and the second erased the first one's entry. The
 * fix moved the read-modify-write into the database, and nothing here had a
 * grader that could tell the two apart — a revert would have been silent, and
 * the symptom (an object no row names) is invisible until someone counts.
 *
 * ## What the fake below does NOT model, for whoever extends it
 *
 * Recorded rather than fixed (T2-305 review, F3): the fake is sufficient for
 * the claims in this file and would mislead a reader who assumed more of it.
 * Three known gaps, each of which would make a *new* grader pass while
 * production did something else:
 *
 * 1. **`.eq()` / `.in()` / `.order()` ignore their arguments.** Nothing here
 *    checks that a filter names the right column, so a grader asserting "scoped
 *    by id" cannot be written against this fake as it stands.
 * 2. **`.single()` and a bare `select()` resolve identically**, to one object.
 *    Production returns an *array* without `.single()`, so a `listRecordMedia`
 *    or `listReceipts` grader written against this fake would receive an object
 *    where the real client hands back a list — and would pass while the page
 *    broke.
 * 3. ~~**`outcome("insert", name)` is the verb used for every table request**,
 *    so a failure can only be injected for inserts.~~ Closed by the T2-402
 *    review fix below: the builder now remembers every verb in the chain and a
 *    failure keyed to any of them fires, which is what lets `update:profiles`
 *    be graded. `errors` alongside `failures` injects a *specific* error
 *    object, because `saveHandle`'s whole job is discriminating between codes.
 *
 * Extending the remaining two is a small change; assuming they already work is
 * the expensive mistake.
 *
 * refs specs/002-montero-garage (GAR-01′, GAR-06′, SHR-01, MIG-03)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VehicleRow } from "../garage/vehicle.ts";

/** Every call the module made, in order, so an ordering claim is checkable. */
interface Call {
  readonly kind:
    "rpc" | "update" | "insert" | "delete" | "select" | "upload" | "remove";
  readonly target: string;
  readonly payload?: unknown;
}

let calls: Call[] = [];
/** Errors the fake should report, keyed by `<kind>:<target>`. */
let failures = new Set<string>();
/**
 * Specific error payloads, same key.
 *
 * A transport failure and a constraint violation are the *same* `error !==
 * null` to a fake that only knows "failed", and `saveHandle` has to tell them
 * apart by `code` — so a grader for it needs to choose the object, not just
 * ask for one.
 */
let errors = new Map<string, unknown>();

function outcome(kind: Call["kind"], target: string): { error: unknown } {
  const key = `${kind}:${target}`;
  if (errors.has(key)) return { error: errors.get(key) };
  return failures.has(key)
    ? { error: { message: `synthetic failure for ${key}` } }
    : { error: null };
}

/**
 * The first injected failure among the verbs a chain actually used.
 *
 * `.insert(…).select(…).single()` records two verbs; keying the outcome off
 * the last one would make `failures.add("insert:record_media")` silently stop
 * working. Keying off any of them keeps every existing grader true and lets a
 * new one name `update:profiles`.
 */
function chainOutcome(
  verbs: Call["kind"][],
  target: string
): { error: unknown } {
  for (const verb of verbs) {
    const { error } = outcome(verb, target);
    if (error !== null) return { error };
  }
  return { error: null };
}

const USER_ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "33333333-3333-4333-8333-333333333333";
const SAVED_HANDLE = "gitana-blanca";

/**
 * Tables the fake should answer with NO row and no error.
 *
 * `maybeSingle()` over zero rows is exactly that pair, which is the shape the
 * beat between a new account's first token and the `on_auth_user_created`
 * trigger produces. It is not an error and it is not a row, and code that
 * assumes one or the other is the bug this models.
 */
let absent = new Set<string>();

/** The row a successful chain hands back, per table. */
function row(table: string): unknown {
  if (absent.has(table)) return null;
  return table === "profiles"
    ? { id: USER_ID, handle: SAVED_HANDLE }
    : { id: "row", record_id: RECORD_ID };
}

/**
 * A stand-in for `SupabaseClient`, recording rather than asserting.
 *
 * Deliberately not a spy library: the assertions below are about *which*
 * requests were made and in what order, and a plain log reads the same way in
 * a failure message as it does in the test.
 */
function fakeClient(): unknown {
  const table = (name: string) => {
    const verbs: Call["kind"][] = [];
    const record = (kind: Call["kind"], payload?: unknown) => {
      verbs.push(kind);
      calls.push({ kind, target: name, payload });
    };
    const builder = {
      select: () => {
        record("select");
        return builder;
      },
      insert: (payload: unknown) => {
        record("insert", payload);
        return builder;
      },
      update: (payload: unknown) => {
        record("update", payload);
        return builder;
      },
      delete: () => {
        record("delete");
        return builder;
      },
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      single: () => builder,
      maybeSingle: () => builder,
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown
      ) => {
        const { error } = chainOutcome(verbs, name);
        return Promise.resolve(
          resolve({
            data: error === null ? row(name) : null,
            error,
          })
        );
      },
    };
    return builder;
  };

  return {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { id: USER_ID } } },
          error: null,
        }),
    },
    from: table,
    rpc: (name: string, args: unknown) => {
      calls.push({ kind: "rpc", target: name, payload: args });
      const { error } = outcome("rpc", name);
      return Promise.resolve({
        data: error === null ? ["stored/path/from/the/database"] : null,
        error,
      });
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => {
          calls.push({ kind: "upload", target: bucket, payload: path });
          return Promise.resolve(outcome("upload", bucket));
        },
        remove: (paths: string[]) => {
          calls.push({ kind: "remove", target: bucket, payload: paths });
          return Promise.resolve(outcome("remove", bucket));
        },
        list: () => Promise.resolve({ data: [], error: null }),
        createSignedUrls: () => Promise.resolve({ data: [], error: null }),
      }),
    },
  };
}

vi.mock("./auth.ts", () => ({
  getSupabaseClient: () => Promise.resolve(fakeClient()),
}));

const {
  removeVehiclePhoto,
  saveHandle,
  uploadRecordMedia,
  uploadVehiclePhoto,
} = await import("./garage.ts");

const EXISTING_PHOTO = `${USER_ID}/${VEHICLE_ID}/already-here.jpg`;

const VEHICLE: VehicleRow = {
  id: VEHICLE_ID,
  owner_id: USER_ID,
  display_name: "TEST",
  generation_id: "gen3",
  market_id: "us",
  model_year: 2002,
  engine_id: "6g74-sohc",
  odometer_km: 1,
  photo_paths: [EXISTING_PHOTO],
  is_showcase_public: false,
  is_worklog_public: false,
};

/** A `File` the module will accept, without needing a DOM. */
function file(type: string, size = 1024): File {
  return { type, size, name: "x" } as unknown as File;
}

beforeEach(() => {
  calls = [];
  failures = new Set();
  errors = new Map();
  absent = new Set();
});

describe("vehicles.photo_paths is written atomically (T2-304's race)", () => {
  it("appends through the RPC and never sends a computed array", async () => {
    // The whole fix in one assertion. `update({ photo_paths: [...] })` is the
    // bug: it carries the array the browser read, so whatever a concurrent
    // upload added between the read and the write is erased.
    const result = await uploadVehiclePhoto(VEHICLE, file("image/jpeg"));

    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.kind === "rpc")).toBe(true);
    expect(
      calls.filter(
        (call) => call.kind === "update" && call.target === "vehicles"
      )
    ).toEqual([]);
  });

  it("names the append routine and passes ONE path, not the array", async () => {
    await uploadVehiclePhoto(VEHICLE, file("image/png"));
    const rpc = calls.find((call) => call.kind === "rpc");

    expect(rpc?.target).toBe("append_vehicle_photo");
    const payload = rpc?.payload as { p_vehicle_id: string; p_path: string };
    expect(payload.p_vehicle_id).toBe(VEHICLE_ID);
    expect(typeof payload.p_path).toBe("string");
    expect(Array.isArray(payload.p_path)).toBe(false);
    // The path it sends is the one it just uploaded, not one off the row.
    expect(payload.p_path).not.toBe(EXISTING_PHOTO);
  });

  it("uploads the object BEFORE recording it", async () => {
    // Reversed, a failed upload leaves a `photo_paths` entry pointing at
    // nothing and the page renders a broken image for a photo never stored.
    await uploadVehiclePhoto(VEHICLE, file("image/webp"));

    expect(calls.map((call) => call.kind)).toEqual(["upload", "rpc"]);
  });

  it("does not record a photo whose upload failed", async () => {
    failures.add("upload:vehicle-photos");
    const result = await uploadVehiclePhoto(VEHICLE, file("image/jpeg"));

    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.kind === "rpc")).toBe(false);
  });

  it("removes through the RPC, dropping the reference before the bytes", async () => {
    // The mirror image, and it carries the same race: sending a filtered copy
    // of the array re-introduces every entry a concurrent upload just added.
    const result = await removeVehiclePhoto(VEHICLE, EXISTING_PHOTO);

    expect(result.ok).toBe(true);
    expect(calls.map((call) => `${call.kind}:${call.target}`)).toEqual([
      "rpc:remove_vehicle_photo",
      "remove:vehicle-photos",
    ]);
  });

  it("leaves the bytes alone when the row write failed", async () => {
    // A live reference to bytes that are gone is a broken image on the
    // reader's own page; an orphan object is invisible and swept by the
    // vehicle-delete trigger.
    failures.add("rpc:remove_vehicle_photo");
    const result = await removeVehiclePhoto(VEHICLE, EXISTING_PHOTO);

    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.kind === "remove")).toBe(false);
  });

  it("MUTATION: two overlapping uploads each send their OWN path", async () => {
    // The race, reproduced. Both calls are given the same stale row — which is
    // exactly what two tabs, or two files picked in a row, have — and neither
    // request carries the other's entry, so neither can erase it. Against the
    // old client-computed array this failed: both would have sent
    // `[already-here, mine]` and the second write would have won alone.
    await Promise.all([
      uploadVehiclePhoto(VEHICLE, file("image/jpeg")),
      uploadVehiclePhoto(VEHICLE, file("image/png")),
    ]);
    const paths = calls
      .filter((call) => call.kind === "rpc")
      .map((call) => (call.payload as { p_path: string }).p_path);

    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(2);
    for (const path of paths) {
      expect(path).not.toContain("already-here");
    }
  });
});

describe("a media attachment is stored object-first (GAR-06′)", () => {
  it("uploads into record-media, then inserts the row", async () => {
    const result = await uploadRecordMedia(
      VEHICLE_ID,
      RECORD_ID,
      file("audio/mp4")
    );

    expect(result.ok).toBe(true);
    expect(calls.map((call) => `${call.kind}:${call.target}`)).toEqual([
      "upload:record-media",
      "insert:record_media",
      "select:record_media",
    ]);
  });

  it("stores under <owner>/<vehicle>/<record>/, the policy's shape", async () => {
    await uploadRecordMedia(VEHICLE_ID, RECORD_ID, file("video/mp4"));
    const upload = calls.find((call) => call.kind === "upload");

    expect(String(upload?.payload).split("/").slice(0, 3)).toEqual([
      USER_ID,
      VEHICLE_ID,
      RECORD_ID,
    ]);
  });

  it("takes the bytes back out when the row insert fails", async () => {
    // Otherwise the file is stored and nothing points at it: the owner can
    // neither see it nor delete it, and only the account purge ever reaches it.
    failures.add("insert:record_media");
    const result = await uploadRecordMedia(
      VEHICLE_ID,
      RECORD_ID,
      file("image/jpeg")
    );

    expect(result.ok).toBe(false);
    expect(
      calls.some(
        (call) => call.kind === "remove" && call.target === "record-media"
      )
    ).toBe(true);
  });

  it("refuses a receipt's PDF before spending the reader's data", async () => {
    // The GAR-05′/GAR-06′ boundary, enforced by the bucket and reported here
    // so the refusal costs nothing. `rejected`, not `failed`, so the page can
    // say which of the two went wrong.
    const result = await uploadRecordMedia(
      VEHICLE_ID,
      RECORD_ID,
      file("application/pdf")
    );

    expect(result).toEqual({ ok: false, reason: "rejected" });
    expect(calls).toEqual([]);
  });

  it("refuses a file over the bucket's limit without uploading it", async () => {
    const result = await uploadRecordMedia(
      VEHICLE_ID,
      RECORD_ID,
      file("video/mp4", 200 * 1024 * 1024)
    );

    expect(result).toEqual({ ok: false, reason: "rejected" });
    expect(calls).toEqual([]);
  });
});

/**
 * `saveHandle` says "not available" ONLY when the value was refused (SHR-02).
 *
 * The two outcomes carry two different sentences on the page —
 * `garageHandleUnavailable` versus the generic error — so the whole value of
 * the distinction is that it is right. The bug these grade (T2-402 review,
 * Copilot) was `error.code ? "rejected" : "failed"`: true of Postgres
 * constraint violations, and *also* true of every PostgREST-level error, which
 * carries a `PGRST…` code of its own. The one that hurt is the missing profile
 * row, which told somebody their brand-new account's first choice of address
 * was taken.
 */
describe("saveHandle tells a refusal from a failure by SQLSTATE", () => {
  /** What the caller sees, given what the database (or the network) said. */
  const cases: ReadonlyArray<{
    readonly what: string;
    readonly error: unknown;
    readonly reason: "rejected" | "failed";
  }> = [
    {
      what: "unique_violation — held, or retired, by another account",
      error: { code: "23505", message: "duplicate key value…" },
      reason: "rejected",
    },
    {
      what: "check_violation — length, characters, or the reserved list",
      error: { code: "23514", message: "violates check constraint" },
      reason: "rejected",
    },
    {
      what: "PGRST116 — .single()/.maybeSingle() over no row at all",
      error: {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
      },
      reason: "failed",
    },
    {
      what: "PGRST301 — the token expired mid-form",
      error: { code: "PGRST301", message: "JWT expired" },
      reason: "failed",
    },
    {
      what: "42501 — a policy refused the write",
      error: { code: "42501", message: "permission denied" },
      reason: "failed",
    },
    {
      what: "57014 — the statement timed out",
      error: { code: "57014", message: "canceling statement" },
      reason: "failed",
    },
    {
      what: "a fetch failure, which postgrest-js reports with code ''",
      error: { code: "", message: "FetchError: Failed to fetch" },
      reason: "failed",
    },
  ];

  for (const { what, error, reason } of cases) {
    it(`${what} → ${reason}`, async () => {
      errors.set("update:profiles", error);

      expect(await saveHandle("gitana-blanca")).toEqual({
        ok: false,
        reason,
      });
    });
  }

  it("MUTATION: a missing profile row is never reported as unavailable", async () => {
    // The signup beat, in the shape `maybeSingle` actually produces: no row,
    // no error. Against the old `.single()` + `error.code` test this arrived as
    // PGRST116 and came back `rejected` — the page then told an account three
    // milliseconds old that the name nobody holds was somebody else's.
    absent.add("profiles");

    expect(await saveHandle("gitana-blanca")).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("returns the stored row when the database took the handle", async () => {
    const result = await saveHandle("gitana-blanca");

    expect(result).toEqual({
      ok: true,
      value: { id: USER_ID, handle: SAVED_HANDLE },
    });
    expect(calls.map((call) => `${call.kind}:${call.target}`)).toEqual([
      "update:profiles",
      "select:profiles",
    ]);
  });

  it("sends the value it was given, `null` included", async () => {
    // Releasing is a write of `null`, not a delete and not `""` — the trigger
    // folds the empty string to `null` precisely because the two must not be
    // different states. (What row the write is *scoped* to is not checkable
    // here: the fake's `.eq()` ignores its arguments — gap 1 above.)
    await saveHandle(null);
    const update = calls.find((call) => call.kind === "update");

    expect(update?.target).toBe("profiles");
    expect(update?.payload).toEqual({ handle: null });
  });
});
