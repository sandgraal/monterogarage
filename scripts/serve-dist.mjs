/**
 * A static server for `dist/`, mounted at the site's `base`.
 *
 * The a11y sweep (`scripts/check-a11y.mjs`) and the Lighthouse budgets
 * (`scripts/check-lighthouse.mjs`) both need the *built* site over HTTP, on
 * the same path prefix GitHub Pages serves it from. Serving `dist/` at the
 * server root instead would 404 every asset — the build writes absolute URLs
 * under `base` (`/monterogarage/_astro/…`), so a root-mounted preview
 * silently strips the CSS and audits an unstyled page: colour-contrast checks
 * pass on a page nobody will ever see, and the performance numbers describe a
 * document that is not the artifact.
 *
 * `astro preview` would also mount at `base`, but it is a dev-tool dependency
 * with its own port negotiation and readiness output. This is ~100 lines with
 * no negotiation: bind port 0, report the port that was actually assigned,
 * and expose `close()`. That matters because both audits run in the same CI
 * job and a fixed port is a flake waiting for a busy runner.
 *
 * ## Why this server compresses
 *
 * Production is Vercel, and Vercel compresses every text response. Measured
 * against the live site on 2026-09-05:
 *
 *   $ curl -sI -H 'accept-encoding: gzip, deflate, br' https://monterogarage.com/en/
 *   content-encoding: br
 *
 * An uncompressed harness therefore does not serve "the artifact" — it serves
 * a document ~5× heavier than the one any visitor downloads (`/en/glossary/`:
 * 266043 bytes raw, 50414 gzipped, 46037 brotlied), and Lighthouse's
 * performance score is built partly on transfer cost. The gap is not
 * academic: `/en/glossary/` scored 99 through the uncompressed harness on an
 * idle machine and 90 — SCF-06's floor, exactly — on a busy one, with no code
 * change in between, because a 266 KB document has no headroom left and the
 * load decides the rest. Serving the same built bytes compressed puts it
 * clear of the budget and keeps it there: the score stops describing the
 * harness and starts describing the site again.
 *
 * The three behaviours below were each read off production rather than
 * guessed, so the harness under-reports nothing:
 *
 * - **Brotli preferred, gzip as the fallback.** Vercel answers `br` to a
 *   browser that offers both, and so does this.
 * - **Only when the client asks.** No `accept-encoding`, no compression —
 *   production sends identity to such a client, and so does this.
 * - **Only text, and only above 1 KiB.** Production returns a 919-byte script
 *   and every `.woff2` uncompressed and a 1065-byte script as `br`, which
 *   places its floor at the conventional 1024 bytes. Compressing an already
 *   compressed format makes it bigger (`archivo-400-800-latin.woff2`: 34940
 *   bytes raw, 34973 gzipped), so the type list is an allowlist.
 *
 * Compressed bodies are cached in memory per file *version* (path + mtime +
 * size), which is what a CDN serving a static build does and what keeps the
 * per-response cost off the shared assets every one of the audited pages
 * pulls in.
 *
 * Usage:
 *   node scripts/serve-dist.mjs [--port 4321] [--dist dist]
 *
 * refs specs/001-foundation (SCF-03, SCF-06)
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

import {
  REPO_ROOT,
  normalizeBase,
  readSiteConfig,
} from "./lib/audit-targets.mjs";

const MIME_TYPES = new Map(
  Object.entries({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".xml": "application/xml; charset=utf-8",
  })
);

/**
 * Content types worth compressing, beyond every `text/*`. An allowlist and
 * not a denylist: an unrecognised extension is served as
 * `application/octet-stream`, and guessing that an unknown binary compresses
 * well is how a harness starts inflating already-compressed bytes.
 */
const COMPRESSIBLE_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/manifest+json",
  "application/xml",
  "image/svg+xml",
]);

/** Production's floor (see the header note): below this, identity. */
export const MIN_COMPRESS_BYTES = 1024;

/** Preference order, most-preferred first — Vercel's answer, so ours too. */
const ENCODINGS = Object.freeze(["br", "gzip"]);

const compress = Object.freeze({
  br: promisify(zlib.brotliCompress),
  gzip: promisify(zlib.gzip),
});

const COMPRESS_OPTIONS = Object.freeze({
  // Quality 5, not brotli's default 11: this is a *server*, and the audits
  // read time-to-first-byte as part of the score, so a half-second stall
  // spent squeezing out a few more kilobytes would trade one distortion for
  // another. Measured on `dist/en/glossary/index.html` (266043 bytes):
  //
  //   gzip     50414 bytes    5.9 ms
  //   br q5    46037 bytes    4.4 ms   ← here
  //   br q11   39707 bytes  456.4 ms
  //
  // q5 is the quality CDNs use for on-the-fly brotli, it already beats gzip,
  // and the ~6 KB it leaves on the table err on the side of a *heavier*
  // response than production sends — the direction that cannot flatter a
  // page into budget.
  br: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } },
  gzip: { level: zlib.constants.Z_DEFAULT_COMPRESSION },
});

/**
 * `true` when a response of this content type should be compressed.
 *
 * @param {string|undefined} contentType a full header value, parameters and all
 */
export function isCompressibleType(contentType) {
  const type = String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return type.startsWith("text/") || COMPRESSIBLE_TYPES.has(type);
}

/**
 * The encoding to answer an `Accept-Encoding` header with, or `null` for
 * identity. Honours q-values (`gzip;q=0` is a refusal, not a request) and the
 * `*` wildcard, and breaks ties by `ENCODINGS` order rather than by header
 * order, so a browser listing `gzip, br` still gets brotli — the same choice
 * production makes.
 *
 * Exported for `tests/audit-targets.test.ts`: negotiation is the one piece of
 * this file with enough branches to be worth grading without a socket.
 *
 * @param {string|string[]|undefined} header
 * @param {readonly string[]} available
 * @returns {"br"|"gzip"|null}
 */
export function negotiateEncoding(header, available = ENCODINGS) {
  if (header === undefined || header === null) return null;
  const raw = Array.isArray(header) ? header.join(",") : String(header);

  /** @type {Map<string, number>} */
  const offered = new Map();
  let wildcard = null;

  for (const part of raw.split(",")) {
    const [token, ...parameters] = part.trim().split(";");
    const codec = token.trim().toLowerCase();
    if (codec === "") continue;

    let quality = 1;
    for (const parameter of parameters) {
      const [key, value] = parameter.split("=");
      if (key?.trim().toLowerCase() !== "q") continue;
      const parsed = Number.parseFloat(value ?? "");
      if (Number.isFinite(parsed)) quality = parsed;
    }

    if (codec === "*") wildcard = quality;
    else offered.set(codec, quality);
  }

  let best = null;
  for (const codec of available) {
    const quality = offered.get(codec) ?? wildcard ?? 0;
    if (quality > 0 && (best === null || quality > best.quality)) {
      best = { codec, quality };
    }
  }
  return best === null ? null : /** @type {"br"|"gzip"} */ (best.codec);
}

/**
 * Compressed bodies, keyed by file *version*. `dist/` does not change while
 * an audit runs, but keying on mtime and size rather than on path alone means
 * a rebuild under a long-lived `npm run serve:dist` cannot serve stale bytes.
 *
 * @type {Map<string, Buffer>}
 */
const compressedCache = new Map();

async function compressedBody(file, stats, encoding) {
  const key = `${encoding}\0${file}\0${stats.mtimeMs}\0${stats.size}`;
  const cached = compressedCache.get(key);
  if (cached !== undefined) return cached;

  const body = await compress[encoding](
    await readFile(file),
    COMPRESS_OPTIONS[encoding]
  );
  compressedCache.set(key, body);
  return body;
}

/**
 * Map a requested URL path to a file inside `distDir`, or to a reason it
 * cannot be served. Pure, so `tests/audit-targets.test.ts` can grade the base
 * handling and the traversal guard without opening a socket.
 *
 * @returns {{ file: string|null, redirect?: string, reason?: string }}
 */
export function resolveRequest(urlPath, { distDir, base }) {
  const prefix = normalizeBase(base);

  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return { file: null, reason: "undecodable path" };
  }

  let rest = decoded;
  if (prefix !== "") {
    if (rest === prefix) return { file: null, redirect: `${prefix}/` };
    if (!rest.startsWith(`${prefix}/`)) {
      return { file: null, reason: `outside base ${prefix}/` };
    }
    rest = rest.slice(prefix.length);
  }

  const relative = rest.replace(/^\/+/, "");
  // Resolve first, then prove containment: `..` segments and absolute-looking
  // inputs are both handled by the same check rather than by pattern-matching.
  const candidate = path.resolve(distDir, relative);
  const root = path.resolve(distDir);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return { file: null, reason: "path traversal" };
  }

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    if (!decoded.endsWith("/")) return { file: null, redirect: `${decoded}/` };
    const index = path.join(candidate, "index.html");
    return existsSync(index)
      ? { file: index }
      : { file: null, reason: "directory has no index.html" };
  }

  if (existsSync(candidate)) return { file: candidate };
  return { file: null, reason: "not found" };
}

/**
 * Write one file out, negotiating compression the way production does.
 *
 * Identity is always the safe answer, so every failure path — an unreadable
 * file, a zlib error — falls back to streaming the bytes rather than to a 500:
 * an audit that cannot read the page reports a *page* problem, and that would
 * be a lie about the artifact.
 */
async function sendFile(request, response, file, statusCode) {
  const contentType =
    MIME_TYPES.get(path.extname(file).toLowerCase()) ??
    "application/octet-stream";
  const compressible = isCompressibleType(contentType);

  /** @type {Record<string, string>} */
  const headers = { "content-type": contentType, "cache-control": "no-store" };
  // Correct even when this particular response went out uncompressed: the
  // representation still varies by request header.
  if (compressible) headers["vary"] = "accept-encoding";

  const sendIdentity = (size) => {
    if (size !== null) headers["content-length"] = String(size);
    response.writeHead(statusCode, headers);
    createReadStream(file).pipe(response);
  };

  let stats;
  try {
    stats = statSync(file);
  } catch {
    sendIdentity(null);
    return;
  }

  const encoding =
    compressible && stats.size >= MIN_COMPRESS_BYTES
      ? negotiateEncoding(request.headers["accept-encoding"])
      : null;

  if (encoding === null) {
    sendIdentity(stats.size);
    return;
  }

  let body;
  try {
    body = await compressedBody(file, stats, encoding);
  } catch {
    sendIdentity(stats.size);
    return;
  }

  headers["content-encoding"] = encoding;
  headers["content-length"] = String(body.length);
  response.writeHead(statusCode, headers);
  response.end(body);
}

/**
 * `sendFile` as a fire-and-forget call: the `http` handler is synchronous, so
 * a rejection here would otherwise be an unhandled one and take the whole
 * audit down with a stack trace instead of a failing page.
 */
async function serve(request, response, file, statusCode) {
  try {
    await sendFile(request, response, file, statusCode);
  } catch (error) {
    console.error(`serve-dist — ${file}: ${error?.message ?? error}`);
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end();
  }
}

/**
 * Start the server. Pass `port: 0` (the default) to let the OS pick a free
 * one; the resolved port is on the returned handle.
 *
 * @returns {Promise<{ origin: string, port: number, close: () => Promise<void> }>}
 */
export async function startServer({
  distDir = path.join(REPO_ROOT, "dist"),
  base = "/",
  port = 0,
  host = "127.0.0.1",
} = {}) {
  const notFoundPage = path.join(distDir, "404.html");

  const server = http.createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://localhost");
    const resolved = resolveRequest(requested.pathname, { distDir, base });

    if (resolved.redirect) {
      response.writeHead(301, { location: resolved.redirect });
      response.end();
      return;
    }

    if (resolved.file === null) {
      // The built 404 page, with the status a real visitor would get. The
      // audits request `/404.html` directly, which takes the branch above and
      // returns 200 — a tool that refuses to score a 404 response still sees
      // the page.
      if (existsSync(notFoundPage)) {
        void serve(request, response, notFoundPage, 404);
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(`404 — ${resolved.reason ?? "not found"}\n`);
      return;
    }

    void serve(request, response, resolved.file, 200);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;

  return {
    origin: `http://${host}:${actualPort}`,
    port: actualPort,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const readFlag = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? null : argv[index + 1];
  };

  const { base } = await readSiteConfig();
  const distDir = path.resolve(REPO_ROOT, readFlag("dist") ?? "dist");
  if (!existsSync(distDir)) {
    console.error(
      `serve-dist — ${distDir} does not exist; run \`astro build\` first.`
    );
    process.exitCode = 1;
    return;
  }

  const port = Number(readFlag("port") ?? 0);
  const { origin } = await startServer({ distDir, base, port });
  console.log(`serve-dist — listening on ${origin}${normalizeBase(base)}/`);
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main();
}
