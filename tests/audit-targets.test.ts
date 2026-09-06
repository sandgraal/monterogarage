/**
 * Unit coverage for the shared inputs of the two post-build audits
 * (`scripts/lib/audit-targets.mjs`) and for the preview server's path
 * mapping (`scripts/serve-dist.mjs`).
 *
 * Both audits are otherwise only exercised end-to-end, where a wrong base
 * prefix looks like a passing run over zero pages, or — worse — like a
 * passing run over an unstyled page whose CSS 404'd. These are the two pure
 * functions where that mistake is visible — plus the preview server's
 * content-encoding negotiation, which is the third way the harness can grade
 * a document the deployed site never serves.
 *
 * refs specs/001-foundation (SCF-03, SCF-06)
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditTargets,
  builtServedPaths,
  collectionSampleTargets,
  normalizeBase,
  resolveChromePath,
} from "../scripts/lib/audit-targets.mjs";
import {
  MIN_COMPRESS_BYTES,
  isCompressibleType,
  negotiateEncoding,
  resolveRequest,
  startServer,
} from "../scripts/serve-dist.mjs";

const LOCALES = ["en", "es"];

describe("normalizeBase", () => {
  it("normalises every spelling of the deploy path to one form", () => {
    expect(normalizeBase("/Gitana-Montero")).toBe("/Gitana-Montero");
    expect(normalizeBase("/Gitana-Montero/")).toBe("/Gitana-Montero");
    expect(normalizeBase("Gitana-Montero")).toBe("/Gitana-Montero");
  });

  it("treats a root deploy as no prefix at all", () => {
    expect(normalizeBase("/")).toBe("");
    expect(normalizeBase("")).toBe("");
    expect(normalizeBase(undefined)).toBe("");
  });
});

describe("auditTargets", () => {
  it("audits both locales' home pages, neither privileged (I18N-01)", () => {
    const { a11y, lighthouse } = auditTargets({
      base: "/Gitana-Montero",
      locales: LOCALES,
    });

    for (const locale of LOCALES) {
      expect(lighthouse).toContain(`/Gitana-Montero/${locale}/`);
      expect(a11y).toContain(`/Gitana-Montero/${locale}/`);
    }
  });

  it("sweeps the 404 for a11y but keeps it out of the score budget", () => {
    const { a11y, lighthouse } = auditTargets({
      base: "/Gitana-Montero",
      locales: LOCALES,
    });

    expect(a11y).toContain("/Gitana-Montero/404.html");
    expect(lighthouse).not.toContain("/Gitana-Montero/404.html");
  });

  it("never audits the root redirect shim, which redirects on load", () => {
    const { a11y, lighthouse } = auditTargets({
      base: "/Gitana-Montero",
      locales: LOCALES,
    });

    expect(a11y).not.toContain("/Gitana-Montero/");
    expect(lighthouse).not.toContain("/Gitana-Montero/");
  });

  it("follows the deploy path when the site moves to a domain root", () => {
    const { lighthouse } = auditTargets({ base: "/", locales: LOCALES });
    expect(lighthouse).toEqual(["/en/", "/es/"]);
  });

  // SCF-06's "one representative content page per collection". The audits
  // pass `builtPaths` from `dist/`; if that plumbing is ever cut, the two
  // assertions below are what notice — a reviewer reading the docstring
  // cannot tell a wired-up helper from an exported-but-unused one.
  it("adds a representative content page per collection when one is built", () => {
    const builtPaths = [
      "/Gitana-Montero/",
      "/Gitana-Montero/404.html",
      "/Gitana-Montero/en/",
      "/Gitana-Montero/en/problems/transfer-case-wont-engage/",
      "/Gitana-Montero/en/problems/rear-diff-whine/",
      "/Gitana-Montero/es/",
      "/Gitana-Montero/es/problemas/transferencia-no-engrana/",
    ];

    const { a11y, lighthouse } = auditTargets({
      base: "/Gitana-Montero",
      locales: LOCALES,
      builtPaths,
    });

    for (const targets of [a11y, lighthouse]) {
      // One per locale+collection, not one per page.
      expect(targets).toContain("/Gitana-Montero/en/problems/rear-diff-whine/");
      expect(targets).not.toContain(
        "/Gitana-Montero/en/problems/transfer-case-wont-engage/"
      );
      expect(targets).toContain(
        "/Gitana-Montero/es/problemas/transferencia-no-engrana/"
      );
      // The homes never drop out when samples appear.
      expect(targets).toContain("/Gitana-Montero/en/");
      expect(targets).toContain("/Gitana-Montero/es/");
    }
  });

  it("audits only the homes (+404) when nothing else was built", () => {
    const { a11y, lighthouse } = auditTargets({
      base: "/Gitana-Montero",
      locales: LOCALES,
      builtPaths: [
        "/Gitana-Montero/",
        "/Gitana-Montero/404.html",
        "/Gitana-Montero/en/",
        "/Gitana-Montero/es/",
      ],
    });

    expect(lighthouse).toEqual(["/Gitana-Montero/en/", "/Gitana-Montero/es/"]);
    expect(a11y).toEqual([
      "/Gitana-Montero/en/",
      "/Gitana-Montero/es/",
      "/Gitana-Montero/404.html",
    ]);
  });
});

describe("builtServedPaths", () => {
  let distDir: string;

  beforeAll(async () => {
    distDir = await mkdtemp(path.join(os.tmpdir(), "gitana-dist-"));
    const pages = [
      "index.html",
      "404.html",
      "en/index.html",
      "es/index.html",
      "en/problems/transfer-case-wont-engage/index.html",
      "es/problemas/transferencia-no-engrana/index.html",
    ];
    for (const page of pages) {
      const file = path.join(distDir, page);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, '<!doctype html><html lang="en"></html>');
    }
    // Assets must not be mistaken for pages.
    await mkdir(path.join(distDir, "_astro"), { recursive: true });
    await writeFile(path.join(distDir, "_astro", "site.css"), "body{}");
  });

  afterAll(async () => {
    await rm(distDir, { recursive: true, force: true });
  });

  it("maps built files to the paths they are served at, under base", async () => {
    const served = await builtServedPaths({
      distDir,
      base: "/Gitana-Montero",
    });

    expect(served).toEqual([
      "/Gitana-Montero/",
      "/Gitana-Montero/404.html",
      "/Gitana-Montero/en/",
      "/Gitana-Montero/en/problems/transfer-case-wont-engage/",
      "/Gitana-Montero/es/",
      "/Gitana-Montero/es/problemas/transferencia-no-engrana/",
    ]);
  });

  it("feeds a real dist into the audit target set, end to end", async () => {
    const builtPaths = await builtServedPaths({
      distDir,
      base: "/Gitana-Montero",
    });
    const { a11y, lighthouse } = auditTargets({
      base: "/Gitana-Montero",
      locales: LOCALES,
      builtPaths,
    });

    expect(lighthouse).toEqual([
      "/Gitana-Montero/en/",
      "/Gitana-Montero/es/",
      "/Gitana-Montero/en/problems/transfer-case-wont-engage/",
      "/Gitana-Montero/es/problemas/transferencia-no-engrana/",
    ]);
    expect(a11y).toContain("/Gitana-Montero/404.html");
    expect(a11y).toContain(
      "/Gitana-Montero/es/problemas/transferencia-no-engrana/"
    );
  });

  it("returns nothing rather than throwing when dist is absent", async () => {
    expect(
      await builtServedPaths({
        distDir: path.join(distDir, "no-such-dir"),
        base: "/Gitana-Montero",
      })
    ).toEqual([]);
  });
});

describe("collectionSampleTargets", () => {
  const config = { base: "/Gitana-Montero", locales: LOCALES };

  it("returns nothing while every collection is empty", () => {
    expect(
      collectionSampleTargets(
        ["/Gitana-Montero/en/", "/Gitana-Montero/es/"],
        config
      )
    ).toEqual([]);
  });

  it("samples one page per collection per locale (SCF-06)", () => {
    // Deliberately unsorted, and `rear-diff-whine` sorts before
    // `transfer-case-wont-engage`: the sample is the first page in *path*
    // order, not in whatever order the directory walk returned, or a budget
    // regression on a stable site would look like a flake.
    const built = [
      "/Gitana-Montero/en/",
      "/Gitana-Montero/en/problems/transfer-case-wont-engage/",
      "/Gitana-Montero/en/problems/rear-diff-whine/",
      "/Gitana-Montero/en/parts/front-brake-pads/",
      "/Gitana-Montero/es/problemas/transferencia-no-engrana/",
    ];

    expect(collectionSampleTargets(built, config)).toEqual([
      "/Gitana-Montero/en/parts/front-brake-pads/",
      "/Gitana-Montero/en/problems/rear-diff-whine/",
      "/Gitana-Montero/es/problemas/transferencia-no-engrana/",
    ]);
  });

  it("ignores paths that are not under a known locale", () => {
    expect(
      collectionSampleTargets(["/Gitana-Montero/fr/problems/whatever/"], config)
    ).toEqual([]);
  });

  // T205: the glossary is the first collection whose only page is its index
  // (GLO-04 asks for one page, not one per term). Without the fallback below
  // it would be audited by nothing, which is a silent hole in SCF-06.
  it("falls back to a collection's index page when it has no entry pages", () => {
    const built = [
      "/Gitana-Montero/en/",
      "/Gitana-Montero/en/glossary/",
      "/Gitana-Montero/es/",
      "/Gitana-Montero/es/glosario/",
    ];

    expect(collectionSampleTargets(built, config)).toEqual([
      "/Gitana-Montero/en/glossary/",
      "/Gitana-Montero/es/glosario/",
    ]);
  });

  it("prefers an entry page over the index, and never audits both", () => {
    const built = [
      "/Gitana-Montero/en/",
      "/Gitana-Montero/en/problems/",
      "/Gitana-Montero/en/problems/rear-diff-whine/",
      "/Gitana-Montero/en/glossary/",
    ];

    expect(collectionSampleTargets(built, config)).toEqual([
      "/Gitana-Montero/en/glossary/",
      "/Gitana-Montero/en/problems/rear-diff-whine/",
    ]);
  });

  it("still ignores the 404 and the root shim", () => {
    expect(
      collectionSampleTargets(
        ["/Gitana-Montero/", "/Gitana-Montero/404.html"],
        config
      )
    ).toEqual([]);
  });
});

describe("resolveChromePath", () => {
  it("names the variable that pointed at a missing browser", () => {
    expect(() =>
      resolveChromePath({ CHROME_PATH: "/nowhere/google-chrome" })
    ).toThrow(/CHROME_PATH/);
  });
});

describe("serve-dist resolveRequest", () => {
  const distDir = path.resolve("/tmp/does-not-need-to-exist/dist");
  const config = { distDir, base: "/Gitana-Montero" };

  it("refuses anything outside the deploy base", () => {
    // Serving dist at the server root is the mistake that silently drops
    // every `/Gitana-Montero/_astro/…` asset and audits an unstyled page.
    const resolved = resolveRequest("/en/", config);
    expect(resolved.file).toBeNull();
    expect(resolved.reason).toMatch(/outside base/);
  });

  it("sends the bare base to its trailing-slash form", () => {
    expect(resolveRequest("/Gitana-Montero", config).redirect).toBe(
      "/Gitana-Montero/"
    );
  });

  it("refuses to escape dist via traversal", () => {
    const resolved = resolveRequest(
      "/Gitana-Montero/../../../../etc/passwd",
      config
    );
    expect(resolved.file).toBeNull();
    expect(resolved.reason).toBe("path traversal");
  });

  it("refuses an undecodable path instead of throwing", () => {
    const resolved = resolveRequest("/Gitana-Montero/%E0%A4%A", config);
    expect(resolved.file).toBeNull();
    expect(resolved.reason).toBe("undecodable path");
  });
});

/*
 * Compression is graded here because an uncompressed preview server is a
 * *silent* defect: every page still renders, every a11y rule still passes,
 * and only the Lighthouse performance number moves — by enough, on a heavy
 * page, to cross SCF-06's budget and back between runs. Production (Vercel)
 * answers `content-encoding: br` to any browser that asks, so a harness that
 * does not is measuring a document no visitor downloads.
 */
describe("serve-dist isCompressibleType", () => {
  it("compresses text and the structured text types", () => {
    for (const type of [
      "text/html; charset=utf-8",
      "text/css; charset=utf-8",
      "text/javascript; charset=utf-8",
      "application/json; charset=utf-8",
      "application/xml; charset=utf-8",
      "image/svg+xml",
    ]) {
      expect(isCompressibleType(type), type).toBe(true);
    }
  });

  it("leaves already-compressed formats alone", () => {
    // Gzipping a woff2 makes it *bigger* (34940 → 34973 bytes for
    // `archivo-400-800-latin.woff2`), which is the opposite of the fidelity
    // this server exists for.
    for (const type of [
      "font/woff2",
      "font/woff",
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/x-icon",
      "application/octet-stream",
      undefined,
    ]) {
      expect(isCompressibleType(type), String(type)).toBe(false);
    }
  });
});

describe("serve-dist negotiateEncoding", () => {
  it("prefers brotli when the client offers both, as production does", () => {
    expect(negotiateEncoding("gzip, deflate, br")).toBe("br");
    expect(negotiateEncoding("br;q=1.0, gzip;q=1.0")).toBe("br");
  });

  it("falls back to gzip for a client that only speaks gzip", () => {
    expect(negotiateEncoding("gzip, deflate")).toBe("gzip");
  });

  it("sends identity when the client did not ask", () => {
    expect(negotiateEncoding(undefined)).toBeNull();
    expect(negotiateEncoding("")).toBeNull();
    expect(negotiateEncoding("identity")).toBeNull();
  });

  it("reads q=0 as a refusal, not as an offer", () => {
    expect(negotiateEncoding("br;q=0, gzip;q=0")).toBeNull();
    expect(negotiateEncoding("br;q=0, gzip")).toBe("gzip");
  });

  it("honours explicit quality over preference order", () => {
    expect(negotiateEncoding("br;q=0.1, gzip;q=0.9")).toBe("gzip");
  });

  it("accepts the wildcard, and its refusal", () => {
    expect(negotiateEncoding("*")).toBe("br");
    expect(negotiateEncoding("identity, *;q=0")).toBeNull();
    expect(negotiateEncoding("*;q=0, gzip")).toBe("gzip");
  });

  it("ignores case and stray whitespace", () => {
    expect(negotiateEncoding("  GZIP ;Q=1 ")).toBe("gzip");
  });
});

describe("serve-dist compression over HTTP", () => {
  let distDir: string;
  let server: {
    origin: string;
    close: () => Promise<void>;
  };

  /** Long enough to compress well, and well over `MIN_COMPRESS_BYTES`. */
  const page = `<!doctype html><html lang="en"><body>${"<p>Gitana Blanca</p>".repeat(400)}</body></html>`;
  const tiny = "<!doctype html><html lang=en><body>hi</body></html>";
  /** Binary bytes standing in for a webfont; served byte-for-byte or not at all. */
  const font = Buffer.from(
    Array.from({ length: 4096 }, (_, index) => (index * 37 + 11) % 256)
  );

  beforeAll(async () => {
    distDir = await mkdtemp(path.join(os.tmpdir(), "serve-dist-gzip-"));
    await mkdir(path.join(distDir, "en"), { recursive: true });
    await writeFile(path.join(distDir, "en", "index.html"), page);
    await writeFile(path.join(distDir, "404.html"), page);
    await writeFile(path.join(distDir, "tiny.html"), tiny);
    await writeFile(path.join(distDir, "font.woff2"), font);
    server = await startServer({ distDir, base: "/" });
  });

  afterAll(async () => {
    await server?.close();
    await rm(distDir, { recursive: true, force: true });
  });

  it("compresses HTML with brotli for a browser-shaped request", async () => {
    const response = await fetch(`${server.origin}/en/`, {
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("vary")).toBe("accept-encoding");
    // `fetch` decodes transparently — which is the point: Lighthouse, Pa11y
    // and Playwright all read the original markup, and only the bytes on the
    // wire changed.
    expect(await response.text()).toBe(page);
    expect(Number(response.headers.get("content-length"))).toBeLessThan(
      Buffer.byteLength(page) / 2
    );
  });

  it("falls back to gzip, and to identity when nothing is offered", async () => {
    const gzipped = await fetch(`${server.origin}/en/`, {
      headers: { "accept-encoding": "gzip" },
    });
    expect(gzipped.headers.get("content-encoding")).toBe("gzip");
    expect(await gzipped.text()).toBe(page);

    const plain = await fetch(`${server.origin}/en/`, {
      headers: { "accept-encoding": "identity" },
    });
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(plain.headers.get("content-length")).toBe(
      String(Buffer.byteLength(page))
    );
    expect(await plain.text()).toBe(page);
  });

  it("leaves fonts and sub-kilobyte files uncompressed, as production does", async () => {
    expect(tiny.length).toBeLessThan(MIN_COMPRESS_BYTES);
    const small = await fetch(`${server.origin}/tiny.html`, {
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    expect(small.headers.get("content-encoding")).toBeNull();
    expect(await small.text()).toBe(tiny);

    const woff = await fetch(`${server.origin}/font.woff2`, {
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    expect(woff.headers.get("content-encoding")).toBeNull();
    expect(woff.headers.get("vary")).toBeNull();
    expect(Buffer.from(await woff.arrayBuffer())).toEqual(font);
  });

  it("still serves the 404 page, compressed, with its 404 status", async () => {
    const response = await fetch(`${server.origin}/nowhere/`, {
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(await response.text()).toBe(page);
  });
});
