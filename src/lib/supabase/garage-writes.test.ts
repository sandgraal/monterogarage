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

function outcome(kind: Call["kind"], target: string): { error: unknown } {
  return failures.has(`${kind}:${target}`)
    ? { error: { message: `synthetic failure for ${kind}:${target}` } }
    : { error: null };
}

const USER_ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "33333333-3333-4333-8333-333333333333";

/**
 * A stand-in for `SupabaseClient`, recording rather than asserting.
 *
 * Deliberately not a spy library: the assertions below are about *which*
 * requests were made and in what order, and a plain log reads the same way in
 * a failure message as it does in the test.
 */
function fakeClient(): unknown {
  const table = (name: string) => {
    const builder = {
      select: () => {
        calls.push({ kind: "select", target: name });
        return builder;
      },
      insert: (payload: unknown) => {
        calls.push({ kind: "insert", target: name, payload });
        return builder;
      },
      update: (payload: unknown) => {
        calls.push({ kind: "update", target: name, payload });
        return builder;
      },
      delete: () => {
        calls.push({ kind: "delete", target: name });
        return builder;
      },
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      single: () => builder,
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown
      ) => {
        const { error } = outcome("insert", name);
        return Promise.resolve(
          resolve({
            data: error === null ? { id: "row", record_id: RECORD_ID } : null,
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

const { removeVehiclePhoto, uploadRecordMedia, uploadVehiclePhoto } =
  await import("./garage.ts");

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
