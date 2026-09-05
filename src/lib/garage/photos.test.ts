import { describe, expect, it } from "vitest";
import {
  MAX_PHOTO_BYTES,
  VEHICLE_PHOTOS_BUCKET,
  PHOTO_MIME_TYPES,
  isUuid,
  photoIssue,
  photoObjectPath,
  photoPrefix,
  randomPhotoId,
  vehicleIdOfPhotoPath,
} from "./photos.ts";

const OWNER = "22222222-2222-4222-8222-222222222222";
const VEHICLE = "11111111-1111-4111-8111-111111111111";

describe("the bucket", () => {
  it("is its own bucket, not the receipts one", () => {
    // A photo on a public showcase page and a receipt carrying a card's last
    // four are not the same kind of object, and sharing a bucket would mean
    // sharing whatever policy either one ends up needing.
    expect(VEHICLE_PHOTOS_BUCKET).toBe("vehicle-photos");
  });

  it("accepts images only", () => {
    expect([...PHOTO_MIME_TYPES].sort()).toEqual([
      "image/avif",
      "image/heic",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(PHOTO_MIME_TYPES).not.toContain("application/pdf");
  });
});

describe("photoIssue", () => {
  it("passes an ordinary phone photo", () => {
    expect(photoIssue({ type: "image/jpeg", size: 3_500_000 })).toBeNull();
  });

  it("is case-insensitive about the declared type", () => {
    expect(photoIssue({ type: "IMAGE/JPEG", size: 10 })).toBeNull();
  });

  it("refuses a type that is not an image", () => {
    expect(photoIssue({ type: "application/pdf", size: 10 })).toBe(
      "unsupported-type"
    );
    expect(photoIssue({ type: "text/html", size: 10 })).toBe(
      "unsupported-type"
    );
    expect(photoIssue({ type: "", size: 10 })).toBe("unsupported-type");
  });

  // `constructor` and `__proto__` only: the lookup lower-cases before it
  // indexes, so `toString` and `valueOf` become `tostring`/`valueof`, which are
  // members of nothing and would make a vacuous grader.
  it.each([["constructor"], ["__proto__"]])(
    "refuses %s, which the prototype chain answers for (T2-305 review, F2)",
    (name) => {
      // Ordinary strings, and a `Content-Type` header can carry either.
      // `"constructor" in PHOTO_MIME_EXTENSIONS` is `true` and the bracket
      // lookup returns `Object`, not `undefined` — so before the `Object.hasOwn`
      // fix `photoObjectPath` built a name whose extension was a function's
      // source text.
      expect(photoIssue({ type: name, size: 10 })).toBe("unsupported-type");
      expect(() =>
        photoObjectPath({
          ownerId: OWNER,
          vehicleId: VEHICLE,
          mimeType: name,
          randomId: "x",
        })
      ).toThrow(/unsupported type/);
    }
  );

  it("refuses a file over the size limit", () => {
    expect(photoIssue({ type: "image/png", size: MAX_PHOTO_BYTES })).toBeNull();
    expect(photoIssue({ type: "image/png", size: MAX_PHOTO_BYTES + 1 })).toBe(
      "too-large"
    );
  });
});

describe("the path scheme", () => {
  it("puts the owner first — that segment is the whole RLS claim", () => {
    const path = photoObjectPath({
      ownerId: OWNER,
      vehicleId: VEHICLE,
      mimeType: "image/jpeg",
      randomId: "abc-123",
    });

    expect(path).toBe(`${OWNER}/${VEHICLE}/abc-123.jpg`);
    expect(path.split("/")[0]).toBe(OWNER);
  });

  it("derives the extension from the declared type, never from a filename", () => {
    // The declared type is what decides how a browser treats the bytes; a
    // reader-supplied `.jpg` on an HTML file decides nothing.
    expect(
      photoObjectPath({
        ownerId: OWNER,
        vehicleId: VEHICLE,
        mimeType: "image/webp",
        randomId: "x",
      })
    ).toMatch(/\.webp$/);
  });

  it("refuses to build a path for an unsupported type", () => {
    expect(() =>
      photoObjectPath({
        ownerId: OWNER,
        vehicleId: VEHICLE,
        mimeType: "application/pdf",
        randomId: "x",
      })
    ).toThrow(/unsupported/);
  });

  it("refuses an id that could escape its folder", () => {
    for (const randomId of ["../evil", "a/b", "a b", ""]) {
      expect(
        () =>
          photoObjectPath({
            ownerId: OWNER,
            vehicleId: VEHICLE,
            mimeType: "image/png",
            randomId,
          }),
        randomId
      ).toThrow();
    }
  });

  it("refuses a segment that is not a uuid", () => {
    // The policy compares segment one to `auth.uid()::text`. A path whose
    // first segment is `..` or another user's handle must never be built at
    // all — being refused by the server is the second line, not the first.
    expect(() => photoPrefix("..", VEHICLE)).toThrow(/non-uuid/);
    expect(() => photoPrefix(OWNER, "../../etc")).toThrow(/non-uuid/);
    expect(() => photoPrefix("", VEHICLE)).toThrow(/non-uuid/);
  });

  it("generates url-safe ids that its own path builder accepts", () => {
    const id = randomPhotoId();
    expect(isUuid(id)).toBe(true);
    expect(() =>
      photoObjectPath({
        ownerId: OWNER,
        vehicleId: VEHICLE,
        mimeType: "image/jpeg",
        randomId: id,
      })
    ).not.toThrow();
  });
});

describe("vehicleIdOfPhotoPath", () => {
  it("reads the vehicle back out of a path this module built", () => {
    const path = photoObjectPath({
      ownerId: OWNER,
      vehicleId: VEHICLE,
      mimeType: "image/jpeg",
      randomId: randomPhotoId(),
    });

    expect(vehicleIdOfPhotoPath(path)).toBe(VEHICLE);
  });

  it("returns null for anything shaped differently", () => {
    expect(vehicleIdOfPhotoPath(`${OWNER}/loose.jpg`)).toBeNull();
    expect(vehicleIdOfPhotoPath(`${OWNER}/${VEHICLE}/deep/er.jpg`)).toBeNull();
    expect(vehicleIdOfPhotoPath("")).toBeNull();
  });
});
