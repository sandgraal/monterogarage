import { describe, expect, it } from "vitest";
import {
  MAX_RECEIPT_BYTES,
  MAX_VENDOR_LENGTH,
  RECEIPTS_BUCKET,
  RECEIPT_MIME_TYPES,
  randomReceiptId,
  receiptIssue,
  receiptObjectPath,
  receiptPathBelongsTo,
  receiptCountsByRecord,
  receiptPrefix,
  receiptWriteFromDraft,
  sortReceipts,
  validateReceiptDraft,
  type ReceiptDraft,
  type ReceiptRow,
} from "./receipt.ts";

const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

function draft(over: Partial<ReceiptDraft> = {}): ReceiptDraft {
  return { vendor: "", issuedOn: "", amount: "", currency: "CRC", ...over };
}

function receipt(over: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    id: "x1",
    record_id: "r1",
    storage_path: `${OWNER}/one.pdf`,
    vendor: null,
    issued_on: null,
    amount: null,
    currency: null,
    ...over,
  };
}

describe("the bucket", () => {
  it("is the contract's private receipts bucket", () => {
    expect(RECEIPTS_BUCKET).toBe("receipts");
  });

  it("accepts images and PDFs — GAR-05′ names both", () => {
    expect([...RECEIPT_MIME_TYPES].sort()).toEqual([
      "application/pdf",
      "image/heic",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  it("does not claim a type the bucket would reject after the upload", () => {
    // The migration's `allowed_mime_types` has no AVIF for receipts, and this
    // list is the copy that decides whether the reader's data gets spent.
    expect(RECEIPT_MIME_TYPES).not.toContain("image/avif");
  });
});

describe("receiptIssue", () => {
  it("passes a photographed factura and a scanned invoice", () => {
    expect(receiptIssue({ type: "image/jpeg", size: 3_500_000 })).toBeNull();
    expect(
      receiptIssue({ type: "application/pdf", size: 12_000_000 })
    ).toBeNull();
  });

  it("refuses a type the bucket does not store", () => {
    expect(receiptIssue({ type: "text/html", size: 10 })).toBe(
      "unsupported-type"
    );
    expect(receiptIssue({ type: "image/avif", size: 10 })).toBe(
      "unsupported-type"
    );
  });

  // `constructor` and `__proto__` only: the lookup lower-cases before it
  // indexes, so `toString` and `valueOf` become `tostring`/`valueof`, which are
  // members of nothing and would make a vacuous grader.
  it.each([["constructor"], ["__proto__"]])(
    "refuses %s, which the prototype chain answers for (T2-305 review, F2)",
    (name) => {
      // Ordinary strings, and a `Content-Type` header can carry either. `in`
      // answers `true` and the bracket lookup returns `Object` rather than
      // `undefined`, so before the `Object.hasOwn` fix `receiptObjectPath` did
      // not throw and built a name whose extension was a function's source.
      expect(receiptIssue({ type: name, size: 10 })).toBe("unsupported-type");
      expect(() =>
        receiptObjectPath({ ownerId: OWNER, mimeType: name, randomId: "x" })
      ).toThrow(/unsupported type/);
    }
  );

  it("refuses a file over the bucket's own limit", () => {
    expect(
      receiptIssue({ type: "image/png", size: MAX_RECEIPT_BYTES })
    ).toBeNull();
    expect(
      receiptIssue({ type: "image/png", size: MAX_RECEIPT_BYTES + 1 })
    ).toBe("too-large");
  });
});

describe("the path", () => {
  it("is `<owner>/<file>` — the contract's shape", () => {
    const path = receiptObjectPath({
      ownerId: OWNER,
      mimeType: "application/pdf",
      randomId: "abc-123",
    });
    expect(path).toBe(`${OWNER}/abc-123.pdf`);
  });

  it("puts the owner in the segment every policy compares to auth.uid()", () => {
    const path = receiptObjectPath({
      ownerId: OWNER,
      mimeType: "image/jpeg",
      randomId: "abc",
    });
    expect(path.split("/")[0]).toBe(OWNER);
  });

  it("refuses to build a path from anything but a uuid owner", () => {
    expect(() => receiptPrefix("../../etc")).toThrow();
    expect(() =>
      receiptObjectPath({
        ownerId: "not-a-uuid",
        mimeType: "image/png",
        randomId: "abc",
      })
    ).toThrow();
  });

  it("never takes the extension from an unsupported type", () => {
    expect(() =>
      receiptObjectPath({
        ownerId: OWNER,
        mimeType: "application/x-msdownload",
        randomId: "abc",
      })
    ).toThrow();
  });

  it("refuses an id that could carry a path separator", () => {
    expect(() =>
      receiptObjectPath({
        ownerId: OWNER,
        mimeType: "image/png",
        randomId: "../escape",
      })
    ).toThrow();
    expect(randomReceiptId()).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("receiptPathBelongsTo", () => {
  it("accepts this owner's own object", () => {
    expect(receiptPathBelongsTo(OWNER, `${OWNER}/one.pdf`)).toBe(true);
  });

  it("refuses another owner's, a deeper one, and a bare name", () => {
    // `storage_path` is a column a client wrote, so a row can name anything.
    expect(receiptPathBelongsTo(OWNER, `${OTHER}/one.pdf`)).toBe(false);
    expect(receiptPathBelongsTo(OWNER, `${OWNER}/nested/one.pdf`)).toBe(false);
    expect(receiptPathBelongsTo(OWNER, "one.pdf")).toBe(false);
    expect(receiptPathBelongsTo(OWNER, `${OWNER}/`)).toBe(false);
  });
});

describe("validateReceiptDraft", () => {
  it("accepts a photograph with nothing typed beside it", () => {
    // The commonest honest state: a picture of a factura and no fields yet.
    expect(validateReceiptDraft(draft())).toEqual([]);
  });

  it("accepts the fields GAR-05′ names", () => {
    expect(
      validateReceiptDraft(
        draft({
          vendor: "Repuestos La Uruca",
          issuedOn: "2026-07-19",
          amount: "38 500",
        })
      )
    ).toEqual([]);
  });

  it("refuses a date that is not a day", () => {
    expect(validateReceiptDraft(draft({ issuedOn: "2025-02-30" }))).toEqual([
      { field: "issuedOn", code: "not-a-date" },
    ]);
  });

  it("refuses a vendor longer than the field", () => {
    expect(
      validateReceiptDraft(draft({ vendor: "x".repeat(MAX_VENDOR_LENGTH + 1) }))
    ).toContainEqual({ field: "vendor", code: "too-long" });
  });

  it("shares the record form's answer to the ambiguous separator", () => {
    expect(validateReceiptDraft(draft({ amount: "1.500" }))).toContainEqual({
      field: "amount",
      code: "ambiguous-separator",
    });
  });

  it("refuses an amount with no currency to read it in", () => {
    expect(
      validateReceiptDraft(draft({ amount: "38500", currency: "" }))
    ).toContainEqual({ field: "currency", code: "unknown" });
  });
});

describe("receiptWriteFromDraft", () => {
  it("builds the row around the path it was given", () => {
    const path = `${OWNER}/abc.pdf`;
    expect(
      receiptWriteFromDraft(
        "r1",
        path,
        draft({
          vendor: "  Repuestos   La Uruca ",
          issuedOn: "2026-07-19",
          amount: "38500",
        })
      )
    ).toEqual({
      record_id: "r1",
      storage_path: path,
      vendor: "Repuestos La Uruca",
      issued_on: "2026-07-19",
      amount: 38500,
      currency: "CRC",
    });
  });

  it("stores an empty field as absent rather than as an empty string", () => {
    const write = receiptWriteFromDraft("r1", `${OWNER}/abc.pdf`, draft());
    expect(write?.vendor).toBeNull();
    expect(write?.issued_on).toBeNull();
    expect(write?.amount).toBeNull();
    expect(write?.currency).toBeNull();
  });

  it("refuses a draft with issues rather than sending half of it", () => {
    expect(
      receiptWriteFromDraft(
        "r1",
        `${OWNER}/abc.pdf`,
        draft({ amount: "1.500" })
      )
    ).toBeNull();
  });
});

describe("receiptCountsByRecord", () => {
  it("counts the receipts on each record", () => {
    const counts = receiptCountsByRecord([
      receipt({ id: "a", record_id: "r1" }),
      receipt({ id: "b", record_id: "r1" }),
      receipt({ id: "c", record_id: "r2" }),
    ]);
    expect(counts?.get("r1")).toBe(2);
    expect(counts?.get("r2")).toBe(1);
  });

  it("says nothing about a record with no receipts", () => {
    // Absent from the map, which the page renders as no chip — the honest
    // reading of a successful request that found nothing.
    expect(receiptCountsByRecord([])?.size).toBe(0);
    expect(receiptCountsByRecord([])?.get("r1")).toBeUndefined();
  });

  it("distinguishes a failed request from a record with no receipts", () => {
    /*
     * The defect this pins (PR #68): a failed receipts request used to reach
     * the timeline as an empty map, so every card rendered as "no receipts
     * attached" with nothing on screen saying the request had failed. On a
     * page that is somebody's record of what happened to their truck, a
     * falsely-empty chip is worse than an error — it is a wrong answer
     * wearing the clothes of a right one.
     *
     * `null` cannot be read as zero by accident; the type refuses it.
     */
    expect(receiptCountsByRecord(null)).toBeNull();
    expect(receiptCountsByRecord([])).not.toBeNull();
  });
});

describe("sortReceipts", () => {
  it("shows the most recent first and ties by id", () => {
    const older = receipt({ id: "a", issued_on: "2026-01-02" });
    const newer = receipt({ id: "b", issued_on: "2026-07-19" });
    const undated = receipt({ id: "c" });
    expect(sortReceipts([older, undated, newer]).map((row) => row.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});
