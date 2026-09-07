/**
 * Graders for T2-404b's public showcase/work-log page templates —
 * declared by T2-404c [TEST], against a page that does not exist yet.
 *
 * > **SHR-02** A user SHALL be able to publish, per vehicle: a showcase page
 * > and/or a work-log page, each at a **stable public URL under their
 * > handle**, bilingual chrome, user content in whatever language the user
 * > wrote.
 * > **SHR-03** Costs and receipts SHALL stay private even on a public
 * > work-log unless opened per record.
 * > **SHR-04** Public pages SHALL carry the reference site's chrome and
 * > design (HANDOFF-DESIGN.md) and hreflang per 001 I18N-04.
 * > **SHR-09** A grant SHALL NOT make a record eligible for the community
 * > evidence surfacing of GAR-04′.
 *
 * ## Why this file cannot `AstroContainer.renderToString` a page
 *
 * `tests/pages/procedures-index.render.test.ts` (T504a) is this repo's
 * precedent for a self-authored grader on somebody else's freshly-written
 * page — but that page (`[proceduresSegment].astro`) already existed when
 * its grader was written; only its client wiring was missing, and the
 * grader could still render the server-side HTML through
 * `experimental_AstroContainer` and drive the DOM with a seam. T2-404b's
 * page templates have not been written at all: there is no
 * `src/pages/[locale]/[garageSegment]/…` file to import, dynamically or
 * otherwise, and its **exact** filename is an implementation choice this
 * task's own brief leaves open ("nested under the garage/taller segment" —
 * one file with optional rest params, or three files, both build the same
 * URLs). Importing a guessed path would fail for a reason this file did not
 * choose and could not name — exactly the "fails for the wrong reason" trap
 * `.claude/GRADER-PRINCIPLES.md` warns against.
 *
 * So this file follows `tests/sync/sync-plan.test.ts`'s (T801) precedent
 * instead of T504a's: `src/lib/garage/showcase-view.ts` is a **seam module
 * this file's author wrote**, every export throwing
 * `SHOWCASE_SEAM_NOT_IMPLEMENTED`, and every grader below calls it. T2-404b
 * replaces the throws with real logic and its page templates **delegate** to
 * this module rather than re-deriving the same decisions inline — the same
 * reason `visibility.ts` exists as a single masking authority one file over.
 * An unmarked canary proves every `.fails` marker below fails for the seam
 * and nothing else.
 *
 * ## What is, and is not, this file's job
 *
 * `tests/garage/public-pages.test.ts` already grades `visibility.ts`'s
 * `Principal { kind: "world" }` masking (cost omission, receipt denial, the
 * two-switch structure) — this file does not re-litigate any of that. What
 * `resolveShowcasePage` is graded on here is that it **delegates** to that
 * already-proven function rather than re-deriving its own copy (asserted by
 * equality against the real `maskRecordsForPrincipal` output), plus the two
 * decisions that have no other home: handle → vehicle resolution (including
 * the retired-handle rule) and the per-vehicle publication gate at the
 * page-selection boundary. `tests/garage/share-grants.test.ts` and
 * `tests/garage/contract.ts`'s `publicationFlagGateIssues` (T2-404a) already
 * grade the **RPC** side of "does an anon-executable reader leak
 * `is_worklog_public`/`is_showcase_public` outside a null-token path" — this
 * file is not that either. This file grades what a **page template** does
 * with data it has already legitimately received.
 *
 * ## Expected-failure convention
 *
 * `it.fails`, one marker per test, exactly `tests/sync/sync-plan.test.ts`'s
 * and `tests/pages/procedures-index.render.test.ts`'s convention: T2-404b
 * deletes exactly the `.fails` on each grader its implementation satisfies,
 * and never edits an assertion, a fixture, or an expected value (AGENTS.md's
 * activation rule, the receipt-signer/`EXEMPT_PUBLIC_TABLES` incidents in its
 * Orchestration ledger are what this convention exists to prevent repeating).
 * Every marker in this file was proved to fail for the *seam*, not for a
 * typo: the author wrote a scratch implementation of every seam function
 * (the masking delegation, the route nesting, the retired-handle rule, the
 * link rewrite), deleted every `.fails`, watched the suite go green, and
 * reverted the scratch implementation back to the throwing stub before
 * committing this file.
 *
 * refs specs/002-montero-garage (SHR-02, SHR-03, SHR-04, SHR-09),
 * specs/001-foundation (SCF-01, I18N-01, I18N-04, I18N-05),
 * specs/001-foundation/design/HANDOFF-DESIGN.md
 */
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALES,
  localeHref,
  localizedAlternateLinks,
  type Locale,
} from "../../src/i18n/routing.ts";
import { handleRoutePath } from "../../src/lib/garage/handles.ts";
import type { RecordRow } from "../../src/lib/garage/record.ts";
import type { VehicleRow } from "../../src/lib/garage/vehicle.ts";
import {
  maskRecordsForPrincipal,
  type VisibleRecord,
} from "../../src/lib/garage/visibility.ts";
import {
  applyResolvedShowcaseLinks,
  resolveShowcasePage,
  showcaseRoutePath,
  showcaseRoutePaths,
  worklogRoutePath,
  worklogRoutePaths,
  SHOWCASE_SEAM_NOT_IMPLEMENTED,
  type PublicProfileDirectory,
  type ShowcasePageKind,
} from "../../src/lib/garage/showcase-view.ts";

/* -------------------------------------------------------------------------
 * Fixtures — obviously synthetic, TEST-prefixed, distinct from every other
 * grader file's UUID range so a copy-paste collision is loud rather than
 * silent (public-pages.test.ts uses the `…a0xx` range; this file uses
 * `…c4xx`, chosen for T2-404[c]).
 * ---------------------------------------------------------------------- */

const OWNER_ID = "00000000-0000-4000-8000-00000000c400";
const OTHER_OWNER_ID = "00000000-0000-4000-8000-00000000c500";
const VEHICLE_ID = "00000000-0000-4000-8000-00000000c401";
const OTHER_VEHICLE_ID = "00000000-0000-4000-8000-00000000c402";

const HANDLE = "test-t2-404c-taller";
const RETIRED_HANDLE = "test-t2-404c-viejo";
const OTHER_HANDLE = "test-t2-404c-otro";
const UNKNOWN_HANDLE = "test-t2-404c-nunca-existio";

function vehicle(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: VEHICLE_ID,
    owner_id: OWNER_ID,
    display_name: "TEST-T2-404c Gitana",
    generation_id: "gen3",
    market_id: "us",
    model_year: 2002,
    engine_id: "6g74-sohc",
    odometer_km: 233_000,
    photo_paths: [],
    cover_photo_path: null,
    is_showcase_public: true,
    is_worklog_public: true,
    ...overrides,
  };
}

function record(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: "00000000-0000-4000-8000-00000000c410",
    vehicle_id: VEHICLE_ID,
    occurred_on: "2026-08-30",
    kind: "work",
    title: "TEST-T2-404c timing belt",
    body: null,
    cost_amount: 245_000,
    cost_currency: "CRC",
    time_minutes: 480,
    odometer_km: 233_000,
    problem_ids: [],
    part_ids: [],
    procedure_ids: [],
    is_public: true,
    is_cost_public: true,
    ...overrides,
  };
}

/** The profile the resolver looks the handle up in — a one-vehicle garage. */
function profile(
  overrides: Partial<PublicProfileDirectory> = {}
): PublicProfileDirectory {
  return {
    handle: HANDLE,
    retiredHandles: [],
    vehicles: [vehicle()],
    ...overrides,
  };
}

function resolve(input: {
  readonly profiles: readonly PublicProfileDirectory[];
  readonly records?: readonly RecordRow[];
  /** Defaults to {@link HANDLE} — most callers only vary the vehicle/flags. */
  readonly handle?: string;
  readonly vehicleId?: string;
  readonly page: ShowcasePageKind;
}) {
  return resolveShowcasePage({
    profiles: input.profiles,
    records: input.records ?? [],
    handle: input.handle ?? HANDLE,
    vehicleId: input.vehicleId ?? VEHICLE_ID,
    page: input.page,
  });
}

/* -------------------------------------------------------------------------
 * The seam canary
 * ---------------------------------------------------------------------- */

describe("the showcase-view seam is honest about not existing yet", () => {
  // Unmarked — proves the `.fails` markers below fail because T2-404b has
  // not shipped, not because of a typo in this file. The reason canary
  // `tests/sync/sync-plan.test.ts` and `procedures-index.render.test.ts`
  // both carry, one file over.
  it("every export throws the named seam error", () => {
    expect(() => resolve({ profiles: [profile()], page: "showcase" })).toThrow(
      SHOWCASE_SEAM_NOT_IMPLEMENTED
    );
    expect(() => showcaseRoutePath(HANDLE, VEHICLE_ID, "en")).toThrow(
      SHOWCASE_SEAM_NOT_IMPLEMENTED
    );
    expect(() => worklogRoutePath(HANDLE, VEHICLE_ID, "en")).toThrow(
      SHOWCASE_SEAM_NOT_IMPLEMENTED
    );
    expect(() =>
      applyResolvedShowcaseLinks({
        doc: new JSDOM("<!doctype html><html><head></head></html>").window
          .document,
        routes: { en: "/garage/x/y/", es: "/taller/x/y/" },
        locale: "en",
      })
    ).toThrow(SHOWCASE_SEAM_NOT_IMPLEMENTED);
  });
});

/* =========================================================================
 * 1. Route construction — nested under `handles.ts`'s existing index route
 * ====================================================================== */

describe("the showcase route nests under the handle's own route (SHR-02)", () => {
  it.fails(
    "the showcase route is the handle's route plus the vehicle id",
    () => {
      for (const locale of LOCALES) {
        const expected = `${handleRoutePath(HANDLE, locale)}${VEHICLE_ID}/`;
        expect(showcaseRoutePath(HANDLE, VEHICLE_ID, locale)).toBe(expected);
      }
    }
  );

  it.fails(
    "the work-log route is the showcase route plus the locale's own word",
    () => {
      // `log` / `historial` — T2-404b's own task brief names these exact
      // segments; this is not this file inventing a third guess.
      const WORKLOG_SEGMENT: Record<Locale, string> = {
        en: "log",
        es: "historial",
      };
      for (const locale of LOCALES) {
        const expected =
          `${handleRoutePath(HANDLE, locale)}${VEHICLE_ID}/` +
          `${WORKLOG_SEGMENT[locale]}/`;
        expect(worklogRoutePath(HANDLE, VEHICLE_ID, locale)).toBe(expected);
      }
    }
  );

  it.fails(
    "every route starts with a `/`, ends with a `/`, and never doubles a slash",
    () => {
      // A cheap but real defect class: string concatenation across three
      // levels (handle segment, vehicle id, log segment) is exactly where an
      // extra or missing slash creeps in.
      for (const locale of LOCALES) {
        for (const path of [
          showcaseRoutePath(HANDLE, VEHICLE_ID, locale),
          worklogRoutePath(HANDLE, VEHICLE_ID, locale),
        ]) {
          expect(path.startsWith("/")).toBe(true);
          expect(path.endsWith("/")).toBe(true);
          expect(path).not.toMatch(/\/\//);
        }
      }
    }
  );

  it.fails(
    "emits a symmetric hreflang set with x-default for the showcase route",
    () => {
      const routes = showcaseRoutePaths(HANDLE, VEHICLE_ID);
      const alternates = localizedAlternateLinks(routes);
      expect(alternates.map((link) => link.hreflang).sort()).toEqual(
        ["en", "es", "x-default"].sort()
      );
      for (const locale of LOCALES) {
        const link = alternates.find((each) => each.hreflang === locale);
        expect(link?.href).toBe(localeHref(locale, routes[locale]));
      }
      const xDefault = alternates.find((each) => each.hreflang === "x-default");
      expect(xDefault?.href).toBe(
        localeHref(DEFAULT_LOCALE, routes[DEFAULT_LOCALE])
      );
    }
  );

  it.fails(
    "emits a symmetric hreflang set with x-default for the work-log route",
    () => {
      const routes = worklogRoutePaths(HANDLE, VEHICLE_ID);
      const alternates = localizedAlternateLinks(routes);
      expect(alternates.map((link) => link.hreflang).sort()).toEqual(
        ["en", "es", "x-default"].sort()
      );
      for (const locale of LOCALES) {
        const link = alternates.find((each) => each.hreflang === locale);
        expect(link?.href).toBe(localeHref(locale, routes[locale]));
      }
    }
  );

  it.fails(
    "the work-log route is never mistaken for the showcase route (I18N-05 shape)",
    () => {
      for (const locale of LOCALES) {
        expect(worklogRoutePath(HANDLE, VEHICLE_ID, locale)).not.toBe(
          showcaseRoutePath(HANDLE, VEHICLE_ID, locale)
        );
      }
    }
  );
});

/* =========================================================================
 * 2. Handle resolution — including the retired-handle rule
 * ====================================================================== */

describe("handle resolution (SHR-02's stable-URL promise)", () => {
  it.fails("an unknown handle resolves as unknown, on either page kind", () => {
    for (const page of ["showcase", "worklog"] as const) {
      const resolution = resolve({
        profiles: [profile()],
        handle: UNKNOWN_HANDLE,
        page,
      });
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) expect(resolution.reason).toBe("handle-unknown");
    }
  });

  it.fails(
    "a live handle resolves — POSITIVE CONTROL for the unknown-handle refusal",
    () => {
      // Without this, "an unknown handle refuses" could be satisfied by a
      // function that refuses every handle, including real ones.
      const resolution = resolve({
        profiles: [profile()],
        handle: HANDLE,
        page: "showcase",
      });
      expect(resolution.ok).toBe(true);
    }
  );

  it.fails(
    "a retired handle goes quiet — it never resolves to the profile that once held it",
    () => {
      // `20260903120100_public_handles.sql`'s own column comment: "Nobody
      // else may claim one; the original owner may take it back." So the
      // *only* way `test-t2-404c-viejo` can appear in `retiredHandles` here
      // is that this exact profile once held it and has since moved on to
      // `HANDLE` — and the URL built from the old word is still dead. A
      // resolver that fell through "not an active handle" to "well, it is
      // in *someone's* retired list, close enough" would hand this profile's
      // current garage to a stale link nobody chose to keep working.
      const withHistory = profile({ retiredHandles: [RETIRED_HANDLE] });
      const resolution = resolve({
        profiles: [withHistory],
        handle: RETIRED_HANDLE,
        page: "showcase",
      });
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) expect(resolution.reason).toBe("handle-retired");
    }
  );

  it.fails(
    "a retired handle is reported distinctly from a handle nobody ever held",
    () => {
      // Both refuse, and a page is free to render one sentence for both (the
      // way `[shareSegment].astro` folds unknown/expired/revoked into one
      // sentence) — but the *resolver* must be able to tell them apart, or
      // this and the "handle nobody ever held" grader above could both be
      // satisfied by a function that always returns "handle-unknown", which
      // is a resolver that also cannot express "handle-retired" at all.
      const withHistory = profile({ retiredHandles: [RETIRED_HANDLE] });
      const retired = resolve({
        profiles: [withHistory],
        handle: RETIRED_HANDLE,
        page: "showcase",
      });
      const neverHeld = resolve({
        profiles: [withHistory],
        handle: UNKNOWN_HANDLE,
        page: "showcase",
      });
      expect(retired.ok).toBe(false);
      expect(neverHeld.ok).toBe(false);
      if (!retired.ok && !neverHeld.ok) {
        expect(retired.reason).not.toBe(neverHeld.reason);
      }
    }
  );

  it.fails(
    "a vehicle id that belongs to a DIFFERENT profile is not found under this handle",
    () => {
      // The showcase-page equivalent of `visibility.ts`'s "a grant on
      // another vehicle shows nothing of this one": the failure mode is a
      // resolver that finds *a* vehicle with the requested id anywhere in
      // the directory rather than checking it belongs to *this* handle's
      // profile.
      const mine = profile({ handle: HANDLE, vehicles: [vehicle()] });
      const someoneElses = profile({
        handle: OTHER_HANDLE,
        vehicles: [vehicle({ id: OTHER_VEHICLE_ID, owner_id: OTHER_OWNER_ID })],
      });
      const resolution = resolve({
        profiles: [mine, someoneElses],
        handle: HANDLE,
        vehicleId: OTHER_VEHICLE_ID,
        page: "showcase",
      });
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) expect(resolution.reason).toBe("vehicle-unknown");
    }
  );
});

/* =========================================================================
 * 3. The privacy boundary — per page kind
 * ====================================================================== */

/**
 * The boundary table itself: which page kind is gated by which flag, and the
 * refusal it must produce when that flag is closed. `it.each` per this
 * project's convention for spec-given structure (locale enum, confidence
 * tiers, fitment years — this is the showcase/work-log analogue).
 */
const PUBLICATION_GATES: readonly {
  readonly page: ShowcasePageKind;
  readonly openFlag: "is_showcase_public" | "is_worklog_public";
  readonly reason: "showcase-private" | "worklog-private";
}[] = [
  {
    page: "showcase",
    openFlag: "is_showcase_public",
    reason: "showcase-private",
  },
  { page: "worklog", openFlag: "is_worklog_public", reason: "worklog-private" },
];

describe.each(PUBLICATION_GATES)(
  "the $page page's own publication flag (SHR-02)",
  ({ page, openFlag, reason }) => {
    it.fails(`closed → refused as "${reason}", never a vehicle`, () => {
      const closed = vehicle({ [openFlag]: false } as Partial<VehicleRow>);
      const resolution = resolve({
        profiles: [profile({ vehicles: [closed] })],
        page,
      });
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) expect(resolution.reason).toBe(reason);
      // Not just the type-level guarantee: a real implementation returning
      // `{ ok: false, reason: "…", vehicle: closed }` — a debugging leftover,
      // say — still satisfies the discriminated union and would still leak.
      expect(Object.hasOwn(resolution, "vehicle")).toBe(false);
      expect(Object.hasOwn(resolution, "records")).toBe(false);
    });

    it.fails(
      `open → POSITIVE CONTROL, the ${page} page actually resolves`,
      () => {
        // Without this, "closed refuses" above could be satisfied by a
        // resolver that refuses every vehicle regardless of the flag.
        const open = vehicle({ [openFlag]: true } as Partial<VehicleRow>);
        const resolution = resolve({
          profiles: [profile({ vehicles: [open] })],
          page,
        });
        expect(resolution.ok).toBe(true);
        if (resolution.ok) expect(resolution.page).toBe(page);
      }
    );

    it.fails(
      `the OTHER page kind's flag does not open the ${page} page (SHR-02's two switches are independent)`,
      () => {
        // `is_showcase_public: true, is_worklog_public: false` must not leak
        // the work-log, and the reverse must not leak the showcase — the two
        // are separate owner decisions (`VehiclePublication`'s own doc
        // comment) and a resolver that treats either as implying the other
        // collapses them into one.
        const otherFlag: "is_showcase_public" | "is_worklog_public" =
          openFlag === "is_showcase_public"
            ? "is_worklog_public"
            : "is_showcase_public";
        const onlyOtherOpen = vehicle({
          [openFlag]: false,
          [otherFlag]: true,
        } as Partial<VehicleRow>);
        const resolution = resolve({
          profiles: [profile({ vehicles: [onlyOtherOpen] })],
          page,
        });
        expect(resolution.ok).toBe(false);
        if (!resolution.ok) expect(resolution.reason).toBe(reason);
      }
    );
  }
);

/* =========================================================================
 * 4. The work-log page delegates to `visibility.ts` — SHR-03, SHR-06, SHR-09
 * ====================================================================== */

describe("the work-log page's records are visibility.ts's own answer, not a second copy", () => {
  it.fails(
    "resolves to exactly maskRecordsForPrincipal's output for the world",
    () => {
      const open = vehicle({ is_worklog_public: true });
      const records: RecordRow[] = [
        record({ id: "c410", is_public: true, is_cost_public: true }),
        record({ id: "c411", is_public: true, is_cost_public: false }),
        record({ id: "c412", is_public: false }),
      ];
      const resolution = resolve({
        profiles: [profile({ vehicles: [open] })],
        records,
        page: "worklog",
      });
      expect(resolution.ok).toBe(true);
      if (!resolution.ok || resolution.page !== "worklog") return;

      const expected = maskRecordsForPrincipal({
        records,
        vehicle: open,
        principal: { kind: "world" },
      });
      expect(resolution.records).toEqual(expected);
      // The private record must be the one thing dropped, not merely
      // somewhere in the diff — pinned by id so a masking bug that dropped
      // the wrong record would still be caught.
      expect(resolution.records.map((row) => row.id)).not.toContain("c412");
      expect(resolution.records).toHaveLength(2);
    }
  );

  it.fails(
    "omits the cost keys entirely on a record whose own cost flag is closed (SHR-03)",
    () => {
      const open = vehicle({ is_worklog_public: true });
      const records: RecordRow[] = [
        record({ id: "c413", is_public: true, is_cost_public: false }),
      ];
      const resolution = resolve({
        profiles: [profile({ vehicles: [open] })],
        records,
        page: "worklog",
      });
      expect(resolution.ok).toBe(true);
      if (!resolution.ok || resolution.page !== "worklog") return;
      const row = resolution.records.find((each) => each.id === "c413");
      expect(row).toBeDefined();
      expect(Object.hasOwn(row as VisibleRecord, "cost_amount")).toBe(false);
      expect(Object.hasOwn(row as VisibleRecord, "cost_currency")).toBe(false);
    }
  );

  it.fails(
    "shows the cost once the record's own cost flag is open — POSITIVE CONTROL",
    () => {
      const open = vehicle({ is_worklog_public: true });
      const records: RecordRow[] = [
        record({ id: "c414", is_public: true, is_cost_public: true }),
      ];
      const resolution = resolve({
        profiles: [profile({ vehicles: [open] })],
        records,
        page: "worklog",
      });
      expect(resolution.ok).toBe(true);
      if (!resolution.ok || resolution.page !== "worklog") return;
      const row = resolution.records.find((each) => each.id === "c414");
      expect(Object.hasOwn(row as VisibleRecord, "cost_amount")).toBe(true);
      expect(row?.cost_amount).toBe(245_000);
    }
  );

  it.fails(
    "never carries a receipts field of any kind (SHR-03, GAR-05′)",
    () => {
      // The world never sees receipts under any capability — there is no
      // capability to open them with, unlike a share grant's
      // `includes_receipts`. `WorklogFound`'s type has no `receipts` key at
      // all; this is the runtime half of that same guarantee, so a
      // real implementation adding one "for convenience" is a red build.
      const open = vehicle({ is_worklog_public: true });
      const resolution = resolve({
        profiles: [profile({ vehicles: [open] })],
        records: [record({ is_public: true, is_cost_public: true })],
        page: "worklog",
      });
      expect(resolution.ok).toBe(true);
      expect(Object.hasOwn(resolution, "receipts")).toBe(false);
    }
  );

  it.fails(
    "the showcase page never carries records at all, published or not (SHR-02's two pages)",
    () => {
      // A showcase-only vehicle (worklog closed) must not leak record data
      // through the *showcase* resolution as some kind of preview — SHR-02
      // draws the line between the two pages, not between "some records" and
      // "all records".
      const showcaseOnly = vehicle({
        is_showcase_public: true,
        is_worklog_public: false,
      });
      const resolution = resolve({
        profiles: [profile({ vehicles: [showcaseOnly] })],
        records: [record({ is_public: true, is_cost_public: true })],
        page: "showcase",
      });
      expect(resolution.ok).toBe(true);
      expect(Object.hasOwn(resolution, "records")).toBe(false);
    }
  );
});

/* =========================================================================
 * 5. The placeholder-rewrite problem — canonical, hreflang, and the
 *    locale switcher on a statically-rewritten page
 * ====================================================================== */

describe("the placeholder route never leaks into the resolved page's chrome", () => {
  /**
   * The document under test is shaped exactly like what `BaseLayout` would
   * emit for *some* placeholder `routePathByLocale` at build time — not a
   * hand-invented shape, the real one `[shareSegment].astro`'s own layout
   * produces, minus the parts irrelevant here. `LocaleSwitcher.astro`'s own
   * `data-locale-choice` attribute is the real hook name.
   */
  function placeholderDocument(): Document {
    const placeholder = {
      en: "/garage/__pending__/",
      es: "/taller/__pendiente__/",
    } as const;
    const dom = new JSDOM(
      `<!doctype html><html lang="en"><head>
        <link rel="canonical" href="https://monterogarage.com/en${placeholder.en}" />
        <link rel="alternate" hreflang="en" href="https://monterogarage.com/en${placeholder.en}" />
        <link rel="alternate" hreflang="es" href="https://monterogarage.com/es${placeholder.es}" />
        <link rel="alternate" hreflang="x-default" href="https://monterogarage.com/en${placeholder.en}" />
      </head><body>
        <nav>
          <a data-locale-choice="en" href="https://monterogarage.com/en${placeholder.en}">English</a>
          <a data-locale-choice="es" href="https://monterogarage.com/es${placeholder.es}">Español</a>
        </nav>
      </body></html>`
    );
    return dom.window.document;
  }

  it.fails(
    "rewrites the canonical link to the resolved handle/vehicle route",
    () => {
      const doc = placeholderDocument();
      const routes = { en: "/garage/gitana/veh1/", es: "/taller/gitana/veh1/" };
      applyResolvedShowcaseLinks({ doc, routes, locale: "en" });

      const canonical = doc.querySelector('link[rel="canonical"]');
      expect(canonical?.getAttribute("href")).toContain(routes.en);
      expect(canonical?.getAttribute("href")).not.toContain("__pending__");
    }
  );

  it.fails(
    "rewrites every hreflang alternate, including x-default, to the resolved routes",
    () => {
      const doc = placeholderDocument();
      const routes = { en: "/garage/gitana/veh1/", es: "/taller/gitana/veh1/" };
      applyResolvedShowcaseLinks({ doc, routes, locale: "en" });

      const en = doc.querySelector('link[hreflang="en"]');
      const es = doc.querySelector('link[hreflang="es"]');
      const xDefault = doc.querySelector('link[hreflang="x-default"]');
      expect(en?.getAttribute("href")).toContain(routes.en);
      expect(es?.getAttribute("href")).toContain(routes.es);
      expect(xDefault?.getAttribute("href")).toContain(routes.en);
      expect(doc.documentElement.outerHTML).not.toContain("__pending__");
      expect(doc.documentElement.outerHTML).not.toContain("__pendiente__");
    }
  );

  it.fails(
    "rewrites the locale switcher's own anchors, not only the <head> tags",
    () => {
      // The defect this test exists to catch: a fix that only touches
      // `BaseLayout`'s own `<link>` tags leaves `LocaleSwitcher.astro`'s
      // anchors pointing at the shared placeholder, so a reader who clicks
      // "Español" on a live showcase page lands on whatever vehicle happens
      // to have been last resolved at that placeholder path — a stranger's
      // garage, from the reader's point of view.
      const doc = placeholderDocument();
      const routes = { en: "/garage/gitana/veh1/", es: "/taller/gitana/veh1/" };
      applyResolvedShowcaseLinks({ doc, routes, locale: "en" });

      const enChoice = doc.querySelector('[data-locale-choice="en"]');
      const esChoice = doc.querySelector('[data-locale-choice="es"]');
      expect(enChoice?.getAttribute("href")).toContain(routes.en);
      expect(esChoice?.getAttribute("href")).toContain(routes.es);
      expect(enChoice?.getAttribute("href")).not.toContain("__pending__");
      expect(esChoice?.getAttribute("href")).not.toContain("__pendiente__");
    }
  );

  it.fails(
    "is idempotent — applying it twice with the same routes changes nothing further",
    () => {
      // A client script may re-run this on navigation; a version that
      // appended a second canonical link instead of replacing the one that
      // is there would pass every test above and still ship two conflicting
      // `<link rel="canonical">` tags — a real SEO defect neither of the
      // single-application tests can see.
      const doc = placeholderDocument();
      const routes = { en: "/garage/gitana/veh1/", es: "/taller/gitana/veh1/" };
      applyResolvedShowcaseLinks({ doc, routes, locale: "en" });
      const once = doc.documentElement.outerHTML;
      applyResolvedShowcaseLinks({ doc, routes, locale: "en" });
      expect(doc.documentElement.outerHTML).toBe(once);
      expect(doc.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    }
  );
});
