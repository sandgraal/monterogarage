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
 * a document five times heavier than the one any visitor downloads
 * (`/en/glossary/`: 271958 bytes raw, 53874 as production sends it), and
 * Lighthouse's performance score is built partly on transfer cost. The gap is
 * not academic: `/en/glossary/` scored 99 through the uncompressed harness on
 * an idle machine and 90 — SCF-06's floor, exactly — on a busy one, with no
 * code change in between, because a 266 KB document has no headroom left and
 * the load decides the rest. Serving the same built bytes compressed puts it
 * clear of the budget and keeps it there: the score stops describing the
 * harness and starts describing the site again.
 *
 * ## The rule this file is held to
 *
 * **Never serve a response lighter than production's.** A harness that
 * over-compresses fails in the silent direction: it passes a page that would
 * miss the budget for a real visitor, and nothing in the run says so. Every
 * behaviour below is therefore measured against the live site rather than
 * assumed, *including the compression level* (see `COMPRESS_OPTIONS`) — the
 * first version of this file guessed brotli quality 5 and was 12-14% lighter
 * than production on every asset sampled.
 *
 * As it stands the harness reproduces production to the byte on the page that
 * matters (`/en/glossary/`: 53874 both) and lands one byte under on the two
 * small assets sampled (4224 vs 4225, 2056 vs 2057) — 0.02%, which is the
 * difference between two brotli builds, not a level mismatch.
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
 * Compressed bodies are cached in memory, one per encoding per file, which is
 * what a CDN serving a static build does and what keeps the per-response cost
 * off the shared assets every one of the audited pages pulls in.
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

/**
 * The *levels*, not just the codecs, are read off production — because a
 * merge-blocking budget that serves a lighter response than the deployed site
 * can pass a page that would miss the budget in front of a real visitor, and
 * it would do it silently. Compression level is therefore part of the
 * fidelity claim, not a free tuning knob.
 *
 * Measured 2026-09-05 by fetching the live site with a single
 * `Accept-Encoding`, *not* decoding the body, and recompressing the identity
 * bytes locally at every level. Vercel compresses at brotli quality 3:
 *
 *   page / asset          identity   prod br   local q3   local q5   local q11
 *   /en/glossary/           271958     53874      53874      47419       40864
 *   /en/                     20919      4225       4224       3728        3313
 *   _astro/BaseLayout.css     8668      2057       2056       1773        1659
 *
 * q3 reproduces production to the byte on HTML and to within one byte on CSS.
 * q5 — the value this file shipped with for one review round — was 12-14%
 * *lighter* than production across all three, i.e. wrong in the dangerous
 * direction. q11 is 24% lighter and costs 304 ms on the glossary page, which
 * would also distort time-to-first-byte; q3 costs 1.6 ms.
 *
 * gzip is only reached by a client that refuses brotli, which Lighthouse's
 * Chrome never is, but the same rule applies to it: production's gzip is
 * level 5 (`/en/` 4123 vs local L5 4117, CSS 1959 vs 1965), and zlib's
 * default level 6 was again slightly lighter than production.
 */
const COMPRESS_OPTIONS = Object.freeze({
  br: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 3 } },
  gzip: { level: 5 },
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
 * A codec listed twice keeps its **highest** q-value. RFC 9110 does not say
 * what a duplicate list member means — it is malformed input — so the only
 * choice available is which way to be wrong, and last-write-wins is the one
 * reading that can turn an acceptance into a refusal: `br;q=1, br;q=0` would
 * drop to gzip or to identity, and on this server identity means grading a
 * 266 KB page that no visitor downloads. Taking the maximum keeps a stated
 * acceptance stated, and makes the result independent of header order, which
 * is the property a negotiator should have. Chrome never sends a duplicate,
 * so this is robustness, not a live path.
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

    if (codec === "*") wildcard = Math.max(wildcard ?? 0, quality);
    else offered.set(codec, Math.max(offered.get(codec) ?? 0, quality));
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
 * Compressed bodies: **one entry per (encoding, file)**, holding that file's
 * current version only.
 *
 * The version (mtime + size) is stored *beside* the body rather than baked
 * into the key, so a rebuild under a long-lived `npm run serve:dist`
 * overwrites the entry instead of adding a second one next to it. Keying by
 * version would be equally correct about staleness and quietly unbounded:
 * every `astro build` would strand the previous copy of every changed file,
 * for the life of the process. Bounded by the number of files actually
 * requested, which for `dist/` is what a CDN would hold anyway.
 *
 * @type {Map<string, { version: string, body: Buffer }>}
 */
const compressedCache = new Map();

/**
 * How many bodies the cache is holding. Exported only so
 * `tests/audit-targets.test.ts` can grade the bound — "does not grow across
 * rebuilds" is not observable from a response, and it was a real defect.
 */
export function compressedCacheSize() {
  return compressedCache.size;
}

async function compressedBody(file, stats, encoding) {
  const key = `${encoding}\0${file}`;
  const version = `${stats.mtimeMs}\0${stats.size}`;
  const cached = compressedCache.get(key);
  if (cached !== undefined && cached.version === version) return cached.body;

  const body = await compress[encoding](
    await readFile(file),
    COMPRESS_OPTIONS[encoding]
  );
  compressedCache.set(key, { version, body });
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

  // `Vary` describes whether the representation *can* differ by request
  // header, so it is a fact about the file, not about this response: a
  // compressible file over the size floor still varies even on the identity
  // answer this particular client asked for. Below the floor it does not vary
  // at all — every client gets the same bytes no matter what it accepts — and
  // advertising otherwise would describe a negotiation that cannot happen.
  //
  // Production sends no `Vary` on anything (Vercel's edge owns its own cache
  // keys), so there is no fidelity claim here either way and nothing
  // Lighthouse scores. This is only about the header being true.
  const negotiable = compressible && stats.size >= MIN_COMPRESS_BYTES;
  if (negotiable) headers["vary"] = "accept-encoding";

  const encoding = negotiable
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
