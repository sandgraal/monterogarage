/**
 * Graders — one-directionality of the CI wiring itself (RM-01, RM-02).
 *
 * `schema-shape.test.ts` grades that the read-model *table* cannot be
 * written except by the CI job (privileges). `sync-plan.test.ts` grades that
 * the diff *logic* never lets a database value win over git (semantics).
 * Neither can see the third way this could still go wrong: the job that
 * carries write privilege runs somewhere it should not — a step that also
 * runs on pull requests from forks, a secret smuggled into a client-visible
 * variable, a script that also happens to write into `src/content/`.
 *
 * Neither `scripts/sync-reference-search.mjs` nor
 * `.github/workflows/sync-reference-search.yml` exists yet — T802 ships
 * both, at the paths `tests/sync/contract.ts` names (`SYNC_SCRIPT_PATH`,
 * `SYNC_WORKFLOW_PATH`; renegotiable in one line, same as every other name
 * in that file). Every grader here is `it.fails`.
 *
 * refs specs/001-foundation (RM-01, RM-02)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_CLIENT_KEY_ENV_VAR,
  SYNC_SCRIPT_PATH,
  SYNC_SERVICE_KEY_ENV_VAR,
  SYNC_WORKFLOW_PATH,
} from "./contract.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const SEAM = "not implemented: T802";

function readRepoFile(relativePath: string, what: string): string {
  try {
    return readFileSync(`${REPO_ROOT}${relativePath}`, "utf8");
  } catch {
    throw new Error(
      `${SEAM} — ${what} does not exist at ${relativePath}. T801 [TEST] named ` +
        `the path; T802 [PLATFORM] creates the file (refs specs/001-foundation ` +
        `RM-01, RM-02)`
    );
  }
}

describe("the CI wiring is honest about not existing yet", () => {
  // Unmarked canary, same role as the one in `sync-plan.test.ts`.
  it("names the T802 seam when the script is missing", () => {
    expect(() => readRepoFile(SYNC_SCRIPT_PATH, "the sync script")).toThrow(
      SEAM
    );
  });

  it("names the T802 seam when the workflow is missing", () => {
    expect(() => readRepoFile(SYNC_WORKFLOW_PATH, "the sync workflow")).toThrow(
      SEAM
    );
  });
});

/* =========================================================================
 * The workflow's trigger — RM-01's "WHEN content merges to main"
 * ====================================================================== */

describe("RM-01 — the sync runs only when content merges to main", () => {
  it.fails("the workflow triggers on push to main", () => {
    const workflow = readRepoFile(SYNC_WORKFLOW_PATH, "the sync workflow");
    // A loose match on purpose: this asks "is `push` gated to `main`
    // somewhere in the trigger block", not "is the YAML formatted one
    // specific way" — `on:\n  push:\n    branches: [main]` and
    // `on:\n  push:\n    branches:\n      - main` must both pass.
    expect(workflow).toMatch(/\bpush\s*:[\s\S]*?branches\s*:[\s\S]*?main/);
  });

  it.fails(
    "the workflow does NOT run on pull_request — a fork PR must never hold write credentials",
    () => {
      const workflow = readRepoFile(SYNC_WORKFLOW_PATH, "the sync workflow");
      expect(workflow).not.toMatch(/\bpull_request\s*:/);
    }
  );
});

/* =========================================================================
 * The credential — RM-02's "no process other than the CI sync job"
 * ====================================================================== */

describe("RM-02 — the write credential is the CI job's alone", () => {
  it.fails(
    "the workflow reads the service-role key from a repository secret, not a literal",
    () => {
      const workflow = readRepoFile(SYNC_WORKFLOW_PATH, "the sync workflow");
      expect(workflow).toContain(`secrets.${SYNC_SERVICE_KEY_ENV_VAR}`);
    }
  );

  it.fails(
    "the workflow never assigns the write credential to a PUBLIC_-prefixed variable",
    () => {
      // src/lib/supabase/config.ts's whole design is that only PUBLIC_* reaches
      // client code. Naming the service-role secret into that prefix anywhere
      // in this workflow would make "no service key exists in this repo"
      // (that module's own docstring) false the moment this job runs.
      const workflow = readRepoFile(SYNC_WORKFLOW_PATH, "the sync workflow");
      const line = workflow
        .split("\n")
        .find((candidate) => candidate.includes(FORBIDDEN_CLIENT_KEY_ENV_VAR));

      expect(line ?? "").not.toContain(SYNC_SERVICE_KEY_ENV_VAR);
    }
  );

  it.fails(
    "the sync script itself never reads the PUBLIC_ anon-key variable",
    () => {
      // The write path authenticates as the service role, full stop — reaching
      // for the anon key anywhere in the writer is a sign it is about to make
      // an RLS-governed (and therefore rejectable, silently-partial) write
      // instead of the unconditional one RM-02 assumes the CI job can make.
      const script = readRepoFile(SYNC_SCRIPT_PATH, "the sync script");
      expect(script).not.toContain(FORBIDDEN_CLIENT_KEY_ENV_VAR);
    }
  );
});

/* =========================================================================
 * One-directionality of the script's SOURCE — it may read git, never write it
 * ====================================================================== */

describe("RM-01 — the sync script never writes back into git-authored content", () => {
  it.fails(
    "the script contains no write call whose path touches src/content",
    () => {
      // A structural sweep, not a claim about every possible spelling of
      // "write a file" — `.claude/GRADER-PRINCIPLES.md`'s "known-pages sweep"
      // caveat applies here in miniature: this enumerates the Node write APIs
      // that actually exist (`writeFile`, `writeFileSync`, `appendFile`,
      // `appendFileSync`, `rm`, `rmSync`, `unlink`, `unlinkSync`) rather than
      // grading "the word content appears", so a read of `src/content/…` (the
      // sync's whole job) does not trip it, and only a write naming that path
      // does.
      const script = readRepoFile(SYNC_SCRIPT_PATH, "the sync script");
      const writeCallWithContentPath = new RegExp(
        "\\b(writeFile(?:Sync)?|appendFile(?:Sync)?|rm(?:Sync)?|unlink(?:Sync)?)" +
          "\\s*\\([^)]*(?:src/content|\\bcontent\\.config)"
      );

      expect(script).not.toMatch(writeCallWithContentPath);
    }
  );

  it.fails(
    "the script imports computeSyncPlan rather than re-implementing the diff inline",
    () => {
      // Not a style preference: `computeSyncPlan` is the ONLY thing
      // `tests/sync/sync-plan.test.ts` can prove idempotent and
      // one-directional without a live stack. A script that reimplements the
      // same decision inline routes around every one of those proofs, and
      // would still pass every other grader in this file while doing so.
      const script = readRepoFile(SYNC_SCRIPT_PATH, "the sync script");
      expect(script).toMatch(/computeSyncPlan/);
    }
  );
});
