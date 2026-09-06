/**
 * Graders — `check:links` (SCF-02/SCF-03 link check, source half), including
 * the T105 review's F2 policy change: a source fails only when **both**
 * `url` and `archiveUrl` are unreachable; one dead side with a live other is
 * a warning (exit 0), not a build failure.
 *
 * Every reachability test injects a fake `fetchImpl` — this suite must never
 * touch the network.
 *
 * refs specs/001-foundation (SCF-02, SCF-03, GAP-01)
 */
import { describe, expect, it, vi } from "vitest";
import {
  ARCHIVE_BACKOFF_SCHEDULE_MS,
  ARCHIVE_MAX_ATTEMPTS,
  ARCHIVE_REQUEST_SPACING_MS,
  auditLinks,
  collectLinkTargets,
  collectSourcePairs,
  findArchiveShapeIssues,
  findUnreachableLinks,
  isArchiveUrl,
  serializeLinkIssue,
} from "../scripts/check-links.mjs";

/** A no-op delay so tests exercising archive-host retry/backoff/spacing logic stay fast. */
const instantDelay = async () => {};

interface Entry {
  collection: string;
  file: string;
  data: unknown;
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    collection: "reference",
    file: "src/content/reference/x.md",
    data: {
      id: "x",
      sources: [
        {
          title: "TEST source",
          url: "https://example.invalid/page",
          archiveUrl:
            "https://web.archive.org/web/20260101000000/https://example.invalid/page",
          accessed: "2026-08-27",
          kind: "forum",
        },
      ],
      prose: {},
    },
    ...overrides,
  };
}

/**
 * Same shape as {@link entry}, but the source cites only `archiveUrl` (no
 * `url`) — isolates archive-host reachability from the both-sides classifier
 * (`classifyPair` scores `urlOk === null` as "ok"/"issue" purely off
 * `archiveOk`, see `check-links.mjs`), so archive backoff/retry behavior can
 * be asserted without a second, unrelated fetch masking the result.
 */
function archiveOnlyEntry(
  file = "src/content/reference/archive-only.md"
): Entry {
  return {
    collection: "reference",
    file,
    data: {
      id: "archive-only",
      sources: [
        {
          title: "TEST source",
          archiveUrl:
            "https://web.archive.org/web/20260101000000/https://example.invalid/archive-only",
          accessed: "2026-08-27",
          kind: "forum",
        },
      ],
      prose: {},
    },
  };
}

describe("isArchiveUrl", () => {
  it("accepts a web.archive.org URL", () => {
    expect(
      isArchiveUrl(
        "https://web.archive.org/web/20260101000000/https://x.invalid"
      )
    ).toBe(true);
  });

  it("rejects a non-archive host", () => {
    expect(isArchiveUrl("https://example.invalid/not-an-archive")).toBe(false);
  });

  it("rejects an unparseable URL", () => {
    expect(isArchiveUrl("not a url")).toBe(false);
  });
});

describe("collectLinkTargets", () => {
  it("collects both url and archiveUrl from every source, entry-scoped", () => {
    const targets = collectLinkTargets([entry()]);
    expect(targets).toHaveLength(2);
    expect(targets.map((t: { field: string }) => t.field)).toEqual([
      "sources[0].url",
      "sources[0].archiveUrl",
    ]);
  });

  it("returns [] for an entry with no sources", () => {
    expect(
      collectLinkTargets([entry({ data: { id: "x", sources: [], prose: {} } })])
    ).toEqual([]);
  });
});

describe("collectSourcePairs", () => {
  it("pairs url and archiveUrl for the same source", () => {
    const pairs = collectSourcePairs([entry()]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.url).toBe("https://example.invalid/page");
    expect(pairs[0]?.archiveUrl).toMatch(/web\.archive\.org/);
  });

  it("skips a source with neither url nor archiveUrl", () => {
    const pairs = collectSourcePairs([
      entry({
        data: {
          id: "x",
          sources: [{ title: "T", accessed: "2026-08-27", kind: "forum" }],
          prose: {},
        },
      }),
    ]);
    expect(pairs).toEqual([]);
  });
});

describe("findArchiveShapeIssues", () => {
  it("is clean when archiveUrl is a real web.archive.org snapshot", () => {
    expect(findArchiveShapeIssues([entry()])).toEqual([]);
  });

  it("flags an archiveUrl that is not on web.archive.org", () => {
    const issues = findArchiveShapeIssues([
      entry({
        data: {
          id: "x",
          sources: [
            {
              title: "T",
              url: "https://example.invalid/a",
              archiveUrl: "https://example.invalid/a",
              accessed: "2026-08-27",
              kind: "forum",
            },
          ],
          prose: {},
        },
      }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/not a web\.archive\.org snapshot/);
  });
});

describe("findUnreachableLinks — F2 both-sides-dead policy", () => {
  it("is clean when both sides respond 2xx", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200 });
    const { issues, warnings } = await findUnreachableLinks([entry()], {
      fetchImpl,
    });
    expect(issues).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("issues (fails) when both url and archiveUrl are unreachable", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404 });
    const { issues, warnings } = await findUnreachableLinks([entry()], {
      fetchImpl,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.entry.file).toBe("src/content/reference/x.md");
    expect(issues[0]?.message).toMatch(/unreachable on both sides/);
    expect(issues[0]?.message).toMatch(/HTTP 404/);
    expect(warnings).toEqual([]);
  });

  it("warns (does not fail) when only url is dead and archiveUrl lives", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("web.archive.org")) return { ok: true, status: 200 };
      return { ok: false, status: 404 };
    };
    const { issues, warnings } = await findUnreachableLinks([entry()], {
      fetchImpl,
    });
    expect(issues).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.field).toBe("sources[0].url");
    expect(warnings[0]?.message).toMatch(/archiveUrl.*still resolves/);
    expect(warnings[0]?.message).toMatch(/GAP-01, T703/);
  });

  it("warns (does not fail) when only archiveUrl is dead and url lives", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("web.archive.org")) return { ok: false, status: 404 };
      return { ok: true, status: 200 };
    };
    const { issues, warnings } = await findUnreachableLinks([entry()], {
      fetchImpl,
    });
    expect(issues).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.field).toBe("sources[0].archiveUrl");
    expect(warnings[0]?.message).toMatch(/url.*still resolves/);
  });

  it("retries with GET when HEAD is rejected (405), and passes if GET succeeds", async () => {
    const calls: string[] = [];
    const fetchImpl = async (_url: string, init: { method: string }) => {
      calls.push(init.method);
      if (init.method === "HEAD") return { ok: false, status: 405 };
      return { ok: true, status: 200 };
    };
    const { issues, warnings } = await findUnreachableLinks([entry()], {
      fetchImpl,
    });
    expect(issues).toEqual([]);
    expect(warnings).toEqual([]);
    expect(calls).toContain("HEAD");
    expect(calls).toContain("GET");
  });

  it("retries once on a thrown network error before falling back to GET (non-archive side); the archive side gets its own longer backoff policy", async () => {
    let headAttempts = 0;
    const fetchImpl = async (_url: string, init: { method: string }) => {
      if (init.method === "HEAD") {
        headAttempts += 1;
        throw new Error("getaddrinfo ENOTFOUND example.invalid");
      }
      return { ok: true, status: 200 };
    };
    const { issues, warnings } = await findUnreachableLinks([entry()], {
      fetchImpl,
      delayImpl: instantDelay,
    });
    expect(issues).toEqual([]);
    expect(warnings).toEqual([]);
    // Non-archive `url` side: one initial HEAD attempt plus exactly one
    // retry (2). Archive `archiveUrl` side: `ARCHIVE_MAX_ATTEMPTS` HEAD
    // attempts under its own backoff policy.
    expect(headAttempts).toBe(2 + ARCHIVE_MAX_ATTEMPTS);
  });

  it("declares a side unreachable after its retry also fails", async () => {
    const fetchImpl = async () => {
      throw new Error("getaddrinfo ENOTFOUND example.invalid");
    };
    const { issues } = await findUnreachableLinks([entry()], {
      fetchImpl,
      delayImpl: instantDelay,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/ENOTFOUND/);
  });
});

describe("findUnreachableLinks — offline notice", () => {
  it("is null when nothing fails", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200 });
    const { offlineNotice } = await findUnreachableLinks([entry()], {
      fetchImpl,
    });
    expect(offlineNotice).toBeNull();
  });

  it("is null for a single dead link (one failure proves nothing about the network)", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("web.archive.org")) return { ok: true, status: 200 };
      throw new Error("getaddrinfo ENOTFOUND example.invalid");
    };
    const { offlineNotice } = await findUnreachableLinks([entry()], {
      fetchImpl,
    });
    expect(offlineNotice).toBeNull();
  });

  it("fires when every check fails identically across multiple entries", async () => {
    const entries = [
      entry(),
      entry({
        file: "src/content/reference/y.md",
        data: {
          id: "y",
          sources: [
            {
              title: "T",
              url: "https://another.invalid/page",
              archiveUrl:
                "https://web.archive.org/web/20260101000000/https://another.invalid/page",
              accessed: "2026-08-27",
              kind: "forum",
            },
          ],
          prose: {},
        },
      }),
    ];
    const fetchImpl = async () => {
      throw new Error("fetch failed");
    };
    const { offlineNotice, issues } = await findUnreachableLinks(entries, {
      fetchImpl,
      delayImpl: instantDelay,
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(offlineNotice).toMatch(/no outbound network access/);
    expect(offlineNotice).toMatch(/fetch failed/);
  });

  it("does not fire when failures have different reasons (real, unrelated dead links)", async () => {
    const entries = [
      entry(),
      entry({
        file: "src/content/reference/y.md",
        data: {
          id: "y",
          sources: [
            {
              title: "T",
              url: "https://another.invalid/page",
              archiveUrl:
                "https://web.archive.org/web/20260101000000/https://another.invalid/page",
              accessed: "2026-08-27",
              kind: "forum",
            },
          ],
          prose: {},
        },
      }),
    ];
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call % 2 === 0) return { ok: false, status: 404 };
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const { offlineNotice } = await findUnreachableLinks(entries, {
      fetchImpl,
      delayImpl: instantDelay,
    });
    expect(offlineNotice).toBeNull();
  });
});

describe("findUnreachableLinks — archive.org throttling", () => {
  it("serializes archive.org requests with a fixed spacing delay instead of the pooled concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve(); // yield, so a real overlap would show up
      inFlight -= 1;
      return { ok: true, status: 200 };
    };
    const delayCalls: number[] = [];
    const delayImpl = vi.fn(async (ms: number) => {
      delayCalls.push(ms);
    });

    const entries = [
      archiveOnlyEntry("src/content/reference/a.md"),
      archiveOnlyEntry("src/content/reference/b.md"),
      archiveOnlyEntry("src/content/reference/c.md"),
    ];
    const { issues, warnings } = await findUnreachableLinks(entries, {
      fetchImpl,
      delayImpl,
    });

    expect(issues).toEqual([]);
    expect(warnings).toEqual([]);
    // Never more than one archive.org request in flight at once.
    expect(maxInFlight).toBe(1);
    // Spacing delay fires between requests (2 gaps for 3 serialized checks),
    // every one at the fixed spacing constant — no backoff was needed since
    // every fetch succeeded on the first attempt.
    expect(delayCalls).toEqual([
      ARCHIVE_REQUEST_SPACING_MS,
      ARCHIVE_REQUEST_SPACING_MS,
    ]);
  });

  it("retries a 429 with backoff (honoring Retry-After) and succeeds", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: {
            get: (name: string) => (name === "retry-after" ? "1" : null),
          },
        };
      }
      return { ok: true, status: 200 };
    };
    const delayCalls: number[] = [];
    const delayImpl = async (ms: number) => {
      delayCalls.push(ms);
    };

    const { issues, warnings } = await findUnreachableLinks(
      [archiveOnlyEntry()],
      { fetchImpl, delayImpl }
    );

    expect(issues).toEqual([]);
    expect(warnings).toEqual([]);
    expect(calls).toBe(2);
    // Retry-After: 1 (second) overrides the default backoff schedule entry.
    expect(delayCalls).toEqual([1_000]);
  });

  it("clamps an absurd Retry-After value to the largest backoff schedule entry instead of waiting it out", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: {
            // A year, in seconds — a hostile or misconfigured host.
            get: (name: string) => (name === "retry-after" ? "31536000" : null),
          },
        };
      }
      return { ok: true, status: 200 };
    };
    const delayCalls: number[] = [];
    const delayImpl = async (ms: number) => {
      delayCalls.push(ms);
    };

    const { issues, warnings } = await findUnreachableLinks(
      [archiveOnlyEntry()],
      { fetchImpl, delayImpl }
    );

    expect(issues).toEqual([]);
    expect(warnings).toEqual([]);
    expect(calls).toBe(2);
    // Clamped to the largest ARCHIVE_BACKOFF_SCHEDULE_MS entry, not the
    // year-long value the header actually requested.
    expect(delayCalls).toEqual([Math.max(...ARCHIVE_BACKOFF_SCHEDULE_MS)]);
  });

  it("reports a source unreachable when archive.org keeps returning 429 through every backoff attempt", async () => {
    let headCalls = 0;
    let getCalls = 0;
    const fetchImpl = async (_url: string, init: { method: string }) => {
      if (init.method === "HEAD") headCalls += 1;
      else getCalls += 1;
      return { ok: false, status: 429 };
    };
    const { issues, warnings } = await findUnreachableLinks(
      [archiveOnlyEntry()],
      { fetchImpl, delayImpl: instantDelay }
    );

    expect(warnings).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/unreachable on both sides/);
    expect(issues[0]?.message).toMatch(/HTTP 429/);
    // A 429 status (not a thrown error) fails immediately without an
    // additional GET fallback (only 405/501 trigger that) — but every
    // ARCHIVE_MAX_ATTEMPTS backoff attempt was exhausted first, not just one.
    expect(headCalls).toBe(ARCHIVE_MAX_ATTEMPTS);
    expect(getCalls).toBe(0);
  });

  it("reports a source unreachable when archive.org connection failures persist through every backoff attempt (GAP-01 rule unchanged)", async () => {
    let headCalls = 0;
    let getCalls = 0;
    const fetchImpl = async (_url: string, init: { method: string }) => {
      if (init.method === "HEAD") headCalls += 1;
      else getCalls += 1;
      throw new Error("fetch failed");
    };
    const delayCalls: number[] = [];
    const delayImpl = async (ms: number) => {
      delayCalls.push(ms);
    };
    const { issues, warnings } = await findUnreachableLinks(
      [archiveOnlyEntry()],
      { fetchImpl, delayImpl }
    );

    expect(warnings).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/unreachable on both sides/);
    expect(issues[0]?.message).toMatch(/fetch failed/);
    // Every attempt this run's backoff policy allows was actually spent
    // before giving up — HEAD then GET, each ARCHIVE_MAX_ATTEMPTS times.
    expect(headCalls).toBe(ARCHIVE_MAX_ATTEMPTS);
    expect(getCalls).toBe(ARCHIVE_MAX_ATTEMPTS);
    // The full exponential schedule was used, once for HEAD's exhausted
    // retries and again for GET's.
    expect(delayCalls).toEqual([
      ...ARCHIVE_BACKOFF_SCHEDULE_MS,
      ...ARCHIVE_BACKOFF_SCHEDULE_MS,
    ]);
  });
});

describe("auditLinks", () => {
  it("combines archive-shape issues, reachability issues, and warnings", async () => {
    const badArchive = entry({
      file: "src/content/reference/bad-archive.md",
      data: {
        id: "bad-archive",
        sources: [
          {
            title: "T",
            url: "https://example.invalid/a",
            archiveUrl: "https://example.invalid/a",
            accessed: "2026-08-27",
            kind: "forum",
          },
        ],
        prose: {},
      },
    });
    const fetchImpl = async () => ({ ok: false, status: 500 });
    const { issues, warnings } = await auditLinks([badArchive], {
      fetchImpl,
    });
    expect(
      issues.some((i: { message: string }) =>
        /web\.archive\.org/.test(i.message)
      )
    ).toBe(true);
    expect(
      issues.some((i: { message: string }) => /HTTP 500/.test(i.message))
    ).toBe(true);
    expect(warnings).toEqual([]);
  });
});

describe("serializeLinkIssue", () => {
  it("keeps file, field and message and drops the entry's full data (--json, T703)", () => {
    const issue = {
      entry: {
        file: "src/content/reference/x.json",
        data: { id: "x", sources: [{ url: "https://example.invalid" }] },
      },
      field: "sources[0]",
      message: "src/content/reference/x.json: unreachable",
    };

    expect(serializeLinkIssue(issue)).toEqual({
      file: "src/content/reference/x.json",
      field: "sources[0]",
      message: "src/content/reference/x.json: unreachable",
    });
  });
});
