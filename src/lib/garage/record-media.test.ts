/**
 * Unit graders for `./record-media.ts` (GAR-06′).
 *
 * The Tier-A/Tier-B graders in `tests/garage/record-media.test.ts` grade the
 * *migration* — the bucket, the policies, the table. These grade the module the
 * page calls, which is the half that decides what path an object is stored
 * under and therefore whose object it is. The two agree on the path shape by
 * assertion here, not by hope: `testRecordMediaPath` in
 * `tests/garage/contract.ts` builds the same four segments.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_MEDIA_BYTES,
  MEDIA_ACCEPT_TYPES,
  MEDIA_KINDS,
  MEDIA_MIME_TYPES,
  RECORD_MEDIA_BUCKET,
  mediaCountsByRecord,
  mediaIssue,
  mediaKindOf,
  mediaObjectPath,
  mediaPathBelongsTo,
  mediaPrefix,
  mediaWriteFromFile,
  randomMediaId,
  sortRecordMedia,
  type RecordMediaRow,
} from "./record-media.ts";

const OWNER = "22222222-2222-4222-8222-222222222222";
const VEHICLE = "11111111-1111-4111-8111-111111111111";
const RECORD = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

describe("the bucket", () => {
  it("is its own bucket, not receipts and not vehicle-photos", () => {
    // A bucket id is permanent in every stored path, and sharing one means one
    // `allowed_mime_types` list governing a factura and a voice note.
    expect(RECORD_MEDIA_BUCKET).toBe("record-media");
  });

  it("takes photo, video and audio and nothing else", () => {
    const prefixes = new Set(
      MEDIA_ACCEPT_TYPES.map((type) => `${type.split("/")[0]}/`)
    );

    expect([...prefixes].sort()).toEqual(["audio/", "image/", "video/"]);
  });

  it("refuses application/pdf, which belongs to receipts (GAR-05′)", () => {
    // The boundary between the two requirements, stated as the thing that must
    // NOT be true. A media bucket that took PDFs has become a second receipts
    // bucket and "independent of a receipt's fields" is a naming convention.
    expect(MEDIA_ACCEPT_TYPES).not.toContain("application/pdf");
    expect(mediaKindOf("application/pdf")).toBeNull();
  });

  it("covers all three kinds — an audio-less bucket drops the voice note", () => {
    // The motivating case for GAR-06′ is a WhatsApp voice note. An allow-list
    // that is images plus video satisfies "nothing forbidden is allowed"
    // completely and refuses the one file the requirement exists for.
    for (const kind of MEDIA_KINDS) {
      expect(
        Object.values(MEDIA_MIME_TYPES).some((entry) => entry.kind === kind),
        kind
      ).toBe(true);
    }
  });

  it("names the spellings a phone actually produces", () => {
    // `audio/ogg` is an Android WhatsApp voice note; `video/quicktime` is an
    // iPhone video. A reader whose file is refused for a container reason has
    // no way to act on the refusal.
    expect(mediaKindOf("audio/ogg")).toBe("audio");
    expect(mediaKindOf("video/quicktime")).toBe("video");
    expect(mediaKindOf("image/heic")).toBe("photo");
  });
});

describe("mediaIssue", () => {
  it("passes an ordinary phone video", () => {
    expect(mediaIssue({ type: "video/mp4", size: 42_000_000 })).toBeNull();
  });

  it("is case-insensitive about the declared type", () => {
    expect(mediaIssue({ type: "AUDIO/MP4", size: 10 })).toBeNull();
  });

  it("refuses a type outside the three categories", () => {
    expect(mediaIssue({ type: "application/pdf", size: 10 })).toBe(
      "unsupported-type"
    );
    expect(mediaIssue({ type: "text/html", size: 10 })).toBe(
      "unsupported-type"
    );
    expect(mediaIssue({ type: "", size: 10 })).toBe("unsupported-type");
  });

  it("refuses a file over the limit, and takes one exactly at it", () => {
    expect(mediaIssue({ type: "video/mp4", size: MAX_MEDIA_BYTES })).toBeNull();
    expect(mediaIssue({ type: "video/mp4", size: MAX_MEDIA_BYTES + 1 })).toBe(
      "too-large"
    );
  });

  /**
   * The only two prototype members that survive the lookup's `toLowerCase()`.
   *
   * `toString`, `valueOf` and `hasOwnProperty` are the names that come to mind
   * first and every one of them is **vacuous here**: the lookup lower-cases
   * before it indexes, and `"tostring"` is not a member of anything. A grader
   * built on them would pass against the broken code and prove nothing —
   * verified by running it. These two are all-lowercase already, so they are
   * the whole of the reachable set.
   */
  const PROTOTYPE_KEYS = [["constructor"], ["__proto__"]];

  it.each(PROTOTYPE_KEYS)(
    "refuses %s, which the prototype chain answers for (T2-305 review, F2)",
    (name) => {
      // Ordinary strings, and a `Content-Type` header can carry either. Both
      // obvious spellings of the lookup consult the prototype:
      // `"constructor" in MEDIA_MIME_TYPES` is `true`, and the bracket lookup
      // returns `Object` rather than `undefined`, so a `=== undefined` guard
      // does not fire either. Left alone, `mediaObjectPath` returns a name
      // whose extension is a function's source text.
      expect(mediaIssue({ type: name, size: 10 })).toBe("unsupported-type");
      expect(mediaKindOf(name)).toBeNull();
      expect(mediaWriteFromFile(RECORD, "p", name)).toBeNull();
      expect(() =>
        mediaObjectPath({
          ownerId: OWNER,
          vehicleId: VEHICLE,
          recordId: RECORD,
          mimeType: name,
          randomId: "x",
        })
      ).toThrow(/unsupported type/);
    }
  );

  it("MUTATION: those two really are prototype members before lowercasing", () => {
    // The guard on the guard. If a future edit dropped `toLowerCase()` from
    // the lookup, or renamed the allow-list, the graders above could go quiet
    // for a reason unrelated to their claim. This states the fact they rest on.
    for (const [name] of PROTOTYPE_KEYS) {
      expect(name, name).toBe(name.toLowerCase());
      expect(name in MEDIA_MIME_TYPES, name).toBe(true);
      expect(Object.hasOwn(MEDIA_MIME_TYPES, name), name).toBe(false);
    }
  });

  it("checks the type before the size", () => {
    // Both wrong should report the type: it is the one a reader can do
    // something about by choosing a different file rather than a smaller one.
    expect(
      mediaIssue({ type: "application/zip", size: MAX_MEDIA_BYTES + 1 })
    ).toBe("unsupported-type");
  });
});

describe("the object path", () => {
  it("is <owner>/<vehicle>/<record>/<file>", () => {
    const path = mediaObjectPath({
      ownerId: OWNER,
      vehicleId: VEHICLE,
      recordId: RECORD,
      mimeType: "audio/mp4",
      randomId: "abc-123",
    });

    expect(path.split("/")).toEqual([OWNER, VEHICLE, RECORD, "abc-123.m4a"]);
  });

  it("puts the owner FIRST — every storage policy reads that segment", () => {
    // `(storage.foldername(name))[1] = auth.uid()::text` is the whole of the
    // ownership check on the bucket. If this segment moved, every policy would
    // silently stop matching and the failure would look like a typo.
    expect(
      mediaObjectPath({
        ownerId: OWNER,
        vehicleId: VEHICLE,
        recordId: RECORD,
        mimeType: "image/jpeg",
        randomId: "x",
      }).startsWith(`${OWNER}/`)
    ).toBe(true);
  });

  it("derives the extension from the declared type, not from a name", () => {
    expect(
      mediaObjectPath({
        ownerId: OWNER,
        vehicleId: VEHICLE,
        recordId: RECORD,
        mimeType: "video/quicktime",
        randomId: "x",
      })
    ).toMatch(/\.mov$/);
  });

  it("refuses a type the bucket would reject after the upload", () => {
    expect(() =>
      mediaObjectPath({
        ownerId: OWNER,
        vehicleId: VEHICLE,
        recordId: RECORD,
        mimeType: "application/pdf",
        randomId: "x",
      })
    ).toThrow(/unsupported type/);
  });

  it("refuses an id carrying a path separator", () => {
    // The stored name is generated, so this is unreachable through content
    // today — which is a property of today's call sites and not of the
    // function that builds a security-relevant path.
    expect(() =>
      mediaObjectPath({
        ownerId: OWNER,
        vehicleId: VEHICLE,
        recordId: RECORD,
        mimeType: "image/png",
        randomId: "../../elsewhere",
      })
    ).toThrow(/url-safe/);
  });

  it.each([
    ["owner", "not-a-uuid", VEHICLE, RECORD],
    ["vehicle", OWNER, "not-a-uuid", RECORD],
    ["record", OWNER, VEHICLE, "not-a-uuid"],
  ])("refuses a non-uuid %s segment", (_which, owner, vehicle, record) => {
    expect(() => mediaPrefix(owner, vehicle, record)).toThrow(/non-uuid/);
  });

  it("prefixes a record's objects with all three ids", () => {
    expect(mediaPrefix(OWNER, VEHICLE, RECORD)).toBe(
      `${OWNER}/${VEHICLE}/${RECORD}`
    );
  });

  it("generates a url-safe id", () => {
    expect(randomMediaId()).toMatch(/^[A-Za-z0-9-]+$/);
  });
});

describe("mediaPathBelongsTo", () => {
  const mine = `${OWNER}/${VEHICLE}/${RECORD}/abc.mp4`;

  it("accepts this owner's object on this record", () => {
    expect(mediaPathBelongsTo(OWNER, RECORD, mine)).toBe(true);
  });

  it("refuses another owner's prefix", () => {
    // `storage_path` is a column a client wrote. Asking the storage API to
    // sign an arbitrary name on the owner's behalf is a request that should
    // never be made, whatever the policies would do with it.
    expect(
      mediaPathBelongsTo(OWNER, RECORD, `${OTHER}/${VEHICLE}/${RECORD}/a.mp4`)
    ).toBe(false);
  });

  it("refuses a path filed under a different record", () => {
    expect(
      mediaPathBelongsTo(OWNER, RECORD, `${OWNER}/${VEHICLE}/${OTHER}/a.mp4`)
    ).toBe(false);
  });

  it("refuses the wrong number of segments", () => {
    expect(mediaPathBelongsTo(OWNER, RECORD, `${OWNER}/a.mp4`)).toBe(false);
    expect(
      mediaPathBelongsTo(OWNER, RECORD, `${OWNER}/${VEHICLE}/${RECORD}/a/b.mp4`)
    ).toBe(false);
  });

  it("refuses an empty file segment", () => {
    expect(
      mediaPathBelongsTo(OWNER, RECORD, `${OWNER}/${VEHICLE}/${RECORD}/`)
    ).toBe(false);
  });

  it("refuses when the owner or record it is checked against is not a uuid", () => {
    expect(mediaPathBelongsTo("", RECORD, mine)).toBe(false);
    expect(mediaPathBelongsTo(OWNER, "", mine)).toBe(false);
  });
});

describe("the row an insert sends", () => {
  it("carries the record, the path and the kind, and nothing else", () => {
    // GAR-06′: "independent of a receipt's vendor/date/amount fields". The
    // negative is the requirement, so it is asserted as one.
    const write = mediaWriteFromFile(RECORD, `${OWNER}/x/y/z.m4a`, "audio/mp4");

    expect(write).toEqual({
      record_id: RECORD,
      storage_path: `${OWNER}/x/y/z.m4a`,
      media_kind: "audio",
    });
    expect(Object.keys(write ?? {})).toHaveLength(3);
  });

  it("reads the kind from the file rather than asking the reader", () => {
    expect(mediaWriteFromFile(RECORD, "p", "video/webm")?.media_kind).toBe(
      "video"
    );
    expect(mediaWriteFromFile(RECORD, "p", "image/png")?.media_kind).toBe(
      "photo"
    );
  });

  it("returns null for a type the bucket does not take", () => {
    expect(mediaWriteFromFile(RECORD, "p", "application/pdf")).toBeNull();
  });
});

describe("mediaCountsByRecord", () => {
  it("counts per record", () => {
    const counts = mediaCountsByRecord([
      { record_id: "a" },
      { record_id: "a" },
      { record_id: "b" },
    ]);

    expect(counts?.get("a")).toBe(2);
    expect(counts?.get("b")).toBe(1);
  });

  it("reports a failed request as null, never as zero", () => {
    // PR #68's rule, applied a second time: a card drawn with no chip because
    // the request failed reads as "nothing attached", which is a wrong answer
    // wearing the clothes of a right one.
    expect(mediaCountsByRecord(null)).toBeNull();
  });

  it("distinguishes no attachments from an unknown count", () => {
    expect(mediaCountsByRecord([])?.size).toBe(0);
  });
});

describe("sortRecordMedia", () => {
  const row = (id: string, kind: RecordMediaRow["media_kind"]) =>
    ({
      id,
      record_id: RECORD,
      storage_path: `${OWNER}/${VEHICLE}/${RECORD}/${id}`,
      media_kind: kind,
    }) satisfies RecordMediaRow;

  it("groups by kind in the order GAR-06′ names them", () => {
    const sorted = sortRecordMedia([
      row("c", "audio"),
      row("a", "video"),
      row("b", "photo"),
    ]);

    expect(sorted.map((entry) => entry.media_kind)).toEqual([
      "photo",
      "video",
      "audio",
    ]);
  });

  it("is stable within a kind, so a reload does not reshuffle", () => {
    const sorted = sortRecordMedia([
      row("b", "photo"),
      row("a", "photo"),
      row("c", "photo"),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its argument", () => {
    const rows = [row("b", "audio"), row("a", "photo")];
    sortRecordMedia(rows);

    expect(rows.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});
