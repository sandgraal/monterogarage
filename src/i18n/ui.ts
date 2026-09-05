/**
 * Typed UI-strings module (I18N-08).
 *
 * Every user-facing string in site chrome — nav, footer, labels, buttons,
 * error pages — lives here in both locales. Components never hard-code text;
 * the `no-hardcoded-ui-text` ESLint rule fails the build when they do.
 *
 * `UiStrings` is the contract: adding a key without translating it is a type
 * error, so `astro check` catches a missing locale before review does. ES is
 * Costa Rican Spanish in the `usted` register (AGENTS.md).
 *
 * This module holds *only* prose. Locale-independent values — URLs, the site
 * name, native language names, and every figure — belong in `src/site.ts` or
 * `src/i18n/routing.ts` and are interpolated in, so a fact is never stored
 * twice.
 */

import { LOCALES, type Locale } from "./routing";
import { SITE_NAME, TRUCK_NAME, TRUCK_YEAR } from "../site";
import type { GlossarySystem } from "../schemas/glossary";
import type {
  ActivityLevel,
  CommunityType,
  LinkKind,
} from "../schemas/community";
import type { ConfidenceTier, SourceKind } from "../schemas/entry";
import type {
  CostBand,
  DrivabilityState,
  ProblemSeverity,
} from "../schemas/problems";
import type { CrossReferenceQuality } from "../schemas/parts";
import type { ModImpact, ModReferenceCollection } from "../schemas/mods";
import type { DriveType, GenerationId } from "../schemas/vehicles";
import type { OptionalSelectionFacet } from "../lib/fitment";
import {
  COMMUNITY_TYPE_BRAND_NAMES,
  LINK_KIND_BRAND_NAMES,
  TRANSLATABLE_COMMUNITY_TYPES,
  TRANSLATABLE_LINK_KINDS,
  type TranslatableCommunityType,
  type TranslatableLinkKind,
} from "./community-brand-names";

/**
 * One flat key per glossary system (GLO-04's filter pills), derived from
 * `GLOSSARY_SYSTEMS` rather than hand-listed: adding a system without naming
 * it in both locales is a type error, not an untranslated pill.
 *
 * Flat and not a nested `Record<GlossarySystem, string>` on purpose —
 * `UiStrings` is a flat map of strings, and everything that sweeps it
 * (`ui.test.ts`'s completeness, placeholder and register checks, and
 * `scripts/check-es-register.mjs`) relies on that being true at one level.
 */
export type GlossarySystemStrings = {
  readonly [System in GlossarySystem as `glossarySystem.${System}`]: string;
};

/**
 * One flat key per *translatable* community type (T703a's type chip), same
 * rationale as {@link GlossarySystemStrings}: derived from
 * `TRANSLATABLE_COMMUNITY_TYPES` so a new translatable type with no
 * translation is a type error, not a chip that silently shows nothing.
 * `subreddit` is excluded — see `COMMUNITY_TYPE_BRAND_NAMES` in
 * `src/i18n/community-brand-names.ts` (bilingual review B4).
 */
export type CommunityTypeStrings = {
  readonly [
    Type in TranslatableCommunityType as `communityType.${Type}`
  ]: string;
};

/** One flat key per `ACTIVITY_LEVELS` value (T703a's activity badge). */
export type CommunityActivityStrings = {
  readonly [Level in ActivityLevel as `communityActivity.${Level}`]: string;
};

/**
 * One flat key per `TRANSLATABLE_LINK_KINDS` value — the `LINK_KINDS` values
 * that pair with an ordinary translated word. The rest are bare platform
 * names; see `src/i18n/community-brand-names.ts` for why those live outside
 * this typed-and-both-locales contract.
 */
export type CommunityLinkKindStrings = {
  readonly [
    Kind in TranslatableLinkKind as `communityLinkKind.${Kind}`
  ]: string;
};

/**
 * One flat key per `GENERATION_IDS` value.
 *
 * Renamed off T703a's `communityGeneration.` prefix by T204: the vehicle
 * selector's generation button row needs exactly these five words, and a
 * second `selectorGeneration.` copy of "Gen 3" / "Generación 3" would be the
 * same string translated twice. Same reasoning as
 * {@link ConfidenceTierStrings}, which was left unprefixed for this reason
 * from the start.
 */
export type GenerationStrings = {
  readonly [Gen in GenerationId as `generation.${Gen}`]: string;
};

/**
 * One flat key per `DRIVE_TYPES` value — the selector's optional drive
 * control (owner ruling 2026-08-30). Derived from the constant, so widening
 * the vocabulary is a type error rather than an untranslated option.
 */
export type DriveStrings = {
  readonly [Drive in DriveType as `drive.${Drive}`]: string;
};

/**
 * One flat key per facet a visitor may leave unanswered — the four
 * `OPTIONAL_SELECTION_FACETS` the fitment engine reports when a match leaned
 * on silence (T203 decision (a)). Derived, so a facet added to the match table
 * cannot reach the provisional notice untranslated.
 */
export type FitmentFacetStrings = {
  readonly [Facet in OptionalSelectionFacet as `fitmentFacet.${Facet}`]: string;
};

/**
 * One flat key per `CONFIDENCE_TIERS` value — not community-specific, so a
 * future page (T401's problem pages, PRB-04) reuses these rather than
 * re-translating the same five words under a different prefix.
 */
export type ConfidenceTierStrings = {
  readonly [Tier in ConfidenceTier as `confidenceTier.${Tier}`]: string;
};

/**
 * One flat key per `SOURCE_KINDS` value — the kind marker beside each numbered
 * source on a problem page (T401, the Main artboard's "· first-hand"). Derived
 * from the constant, so adding an evidence class without naming it in both
 * locales is a type error rather than an untranslated chip.
 */
export type SourceKindStrings = {
  readonly [Kind in SourceKind as `sourceKind.${Kind}`]: string;
};

/**
 * One flat key per `PROBLEM_SEVERITIES` value — T401's severity chip.
 */
export type ProblemSeverityStrings = {
  readonly [Severity in ProblemSeverity as `severity.${Severity}`]: string;
};

/**
 * One flat key per `DRIVABILITY_STATES` value (PRB-05).
 *
 * These four are the highest-consequence strings in this module: the triage
 * banner renders **both** locales' version on every problem page regardless of
 * which locale the page is, so a reader who only reads one of the two languages
 * still gets the answer to "can I drive it?". Derived from the constant so a
 * fifth state could not reach that banner untranslated.
 */
export type DrivabilityStrings = {
  readonly [State in DrivabilityState as `drivability.${State}`]: string;
};

/** One flat key per `COST_BANDS` value — the `$` chip's accessible name. */
export type CostBandStrings = {
  readonly [Band in CostBand as `costBand.${Band}`]: string;
};

/**
 * One flat key per `CROSS_REFERENCE_QUALITY` value — the verdict column of a
 * parts page's cross-reference table (PRT-01). Derived from the constant, for
 * the reason every mapped type here is: adding a verdict without translating
 * it is a type error, not an untranslated cell in a table a reader is using to
 * decide what to buy.
 */
export type CrossReferenceQualityStrings = {
  readonly [
    Quality in CrossReferenceQuality as `crossReferenceQuality.${Quality}`
  ]: string;
};

/**
 * One flat key per `MOD_IMPACTS` value (MOD-01) — the chip on every row of a
 * mod page's "what it breaks or affects" table, and the second filter group on
 * the index. Derived from the constant, for the reason every mapped type here
 * is: adding a fourth impact without translating it is a type error, not an
 * untranslated chip in the one table a reader is reading to decide whether to
 * start.
 */
export type ModImpactStrings = {
  readonly [Impact in ModImpact as `modImpact.${Impact}`]: string;
};

/**
 * One flat key per `MOD_REFERENCE_COLLECTIONS` value (MOD-02) — the word beside
 * a prerequisite saying *what kind of thing* it is, which is exactly the
 * information the typed reference's discriminator carries and a bare id would
 * not.
 */
export type ModReferenceCollectionStrings = {
  readonly [
    Collection in ModReferenceCollection as `modReferenceCollection.${Collection}`
  ]: string;
};

export interface UiStrings
  extends
    GlossarySystemStrings,
    CommunityTypeStrings,
    CommunityActivityStrings,
    CommunityLinkKindStrings,
    GenerationStrings,
    DriveStrings,
    FitmentFacetStrings,
    ConfidenceTierStrings,
    SourceKindStrings,
    ProblemSeverityStrings,
    DrivabilityStrings,
    CostBandStrings,
    CrossReferenceQualityStrings,
    ModImpactStrings,
    ModReferenceCollectionStrings {
  readonly siteTagline: string;
  readonly skipToContent: string;
  readonly navHome: string;
  readonly navGlossary: string;
  readonly navLabel: string;
  readonly languageLabel: string;
  readonly languageSwitcherLabel: string;
  readonly languageCurrent: string;
  readonly homeHeading: string;
  readonly homeIntro: string;
  readonly homeStatus: string;
  readonly footerSourceLabel: string;
  readonly footerIssuesLabel: string;
  readonly footerDisclaimer: string;
  /**
   * MIG-05 — the standing "independent enthusiast site, not affiliated with
   * Mitsubishi Motors" notice. Ships in the footer of every page from the
   * rename onward, in both locales.
   */
  readonly footerNotAffiliated: string;
  readonly notFoundTitle: string;
  readonly notFoundMessage: string;
  readonly notFoundHomeLink: string;
  readonly rootRedirectTitle: string;
  readonly rootRedirectMessage: string;
  readonly rootRedirectManual: string;
  /* Glossary page — GLO-04 */
  readonly glossaryHeading: string;
  readonly glossaryIntro: string;
  readonly glossarySearchLabel: string;
  readonly glossarySearchPlaceholder: string;
  readonly glossaryFilterLabel: string;
  readonly glossaryFilterAll: string;
  readonly glossaryAliasesLabel: string;
  readonly glossaryFalseFriendLabel: string;
  readonly glossaryRelatedLabel: string;
  readonly glossaryNoResults: string;
  readonly glossaryEmpty: string;
  /**
   * Result counter. `{shown}` and `{total}` are replaced with figures at
   * render time and again in the browser as the filter narrows the list —
   * the numbers are computed, never written into a locale (AGENTS.md).
   */
  readonly glossaryCountTemplate: string;
  /* Community directory page — T703a, COM-01, COM-02 */
  readonly navCommunity: string;
  readonly communityHeading: string;
  readonly communityIntro: string;
  readonly communityFilterRegionLabel: string;
  readonly communityFilterRegionAll: string;
  /**
   * The `WORLDWIDE_REGION` (`001`) pill's label. Typed here rather than read
   * from `Intl.DisplayNames` like every other region: EN's CLDR data gives
   * `"world"` (lowercase) for `001` while ES gives `"Mundo"` (capitalized),
   * so the EN pill would sit uncapitalized next to sibling pills like
   * "Costa Rica" (code review F2). ES already agrees with `Intl` here, so
   * this simply pins the one code where EN and the rest of this page's title
   * casing would otherwise disagree.
   */
  readonly communityRegionWorldwide: string;
  readonly communityFilterLanguageLabel: string;
  readonly communityFilterLanguageAll: string;
  readonly communityFilterGenerationLabel: string;
  readonly communityFilterGenerationAll: string;
  readonly communityFilterActivityLabel: string;
  readonly communityFilterActivityAll: string;
  readonly communityNoResults: string;
  readonly communityEmpty: string;
  readonly communityGoodForLabel: string;
  readonly communityVisitLabel: string;
  readonly communityAlsoOnLabel: string;
  /** `{shown}` / `{total}`, computed and interpolated — see `glossaryCountTemplate`. */
  readonly communityCountTemplate: string;
  /** `{date}` is `activityAssessed`, shared data interpolated in, never retyped. */
  readonly communityActivityAssessedTemplate: string;
  /* Sign-in / account page — 002 T2-202, ACC-01, ACC-02 */
  readonly navSignIn: string;
  readonly signInHeading: string;
  readonly signInIntro: string;
  /**
   * ACC-01's deny half, said out loud to the reader. This is not decoration:
   * a visitor who is never asked for a password should be told that is on
   * purpose, or the missing field reads as a broken form.
   */
  readonly signInNoPasswordNote: string;
  /** SHR-01, said before the account exists rather than after. */
  readonly signInPrivacyNote: string;
  readonly signInEmailLabel: string;
  readonly signInEmailPlaceholder: string;
  readonly signInEmailSubmit: string;
  readonly signInEmailSubmitBusy: string;
  readonly signInAlternativeLabel: string;
  readonly signInGoogleLabel: string;
  /** `{email}` is the address the reader just typed — interpolated, never stored. */
  readonly signInLinkSentTemplate: string;
  readonly signInEmailInvalid: string;
  readonly signInError: string;
  /** `{email}` is the signed-in account's own address. */
  readonly signInSignedInTemplate: string;
  readonly signInSignOut: string;
  /**
   * Shown when `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` are absent —
   * every build until the owner provisions the project. A page that renders a
   * dead form would be worse than one that says why it is dead.
   */
  readonly signInUnavailable: string;
  readonly signInScriptRequired: string;
  /* Garage — 002 T2-301, GAR-01′, ACC-02, SHR-01 */
  readonly navGarage: string;
  readonly garageHeading: string;
  readonly garageIntro: string;
  /** Shown when this build has no Supabase project — the sign-in page's rule. */
  readonly garageUnavailable: string;
  readonly garageScriptRequired: string;
  readonly garageSignedOutHeading: string;
  readonly garageSignedOutBody: string;
  readonly garageSignInLink: string;
  readonly garageLoading: string;
  readonly garageError: string;
  /**
   * Shown when the garage's own JavaScript could not finish loading — a
   * deploy rotated the chunk hash under an open tab, the network dropped, or
   * an extension or CSP blocked it. Distinct from `garageError`, which is a
   * request that failed: this one is "the page itself did not arrive", and
   * the only action that helps is reloading.
   */
  readonly garageUnreachable: string;
  readonly garageVehiclesHeading: string;
  readonly garageEmptyHeading: string;
  readonly garageEmptyBody: string;
  readonly garageAddVehicle: string;
  readonly garageOpenVehicle: string;
  readonly garageEditVehicle: string;
  readonly garageFormNewHeading: string;
  readonly garageFormEditHeading: string;
  readonly garageNameLabel: string;
  readonly garageNameHint: string;
  readonly garageIdentityLegend: string;
  readonly garageIdentityHint: string;
  /** The "leave this facet unanswered" option on market / year / engine. */
  readonly garageFacetUnknown: string;
  readonly garageOdometerLabel: string;
  readonly garageOdometerHint: string;
  readonly garageOdometerUnitLabel: string;
  readonly garageUnitKilometres: string;
  readonly garageUnitMiles: string;
  readonly garageSave: string;
  readonly garageSaving: string;
  readonly garageSaved: string;
  readonly garageCancel: string;
  readonly garageDelete: string;
  readonly garageDeleting: string;
  /** `{name}` is the vehicle's own display name, never stored per locale. */
  readonly garageDeleteConfirmTemplate: string;
  readonly garageIssueNameRequired: string;
  /** `{max}` is `MAX_DISPLAY_NAME_LENGTH`, interpolated — never typed here. */
  readonly garageIssueNameTooLongTemplate: string;
  readonly garageIssueGenerationRequired: string;
  readonly garageIssueIdentityUnknown: string;
  readonly garageIssueYearRange: string;
  readonly garageIssueOdometerNumber: string;
  readonly garageIssueOdometerLarge: string;
  readonly garageBackToVehicles: string;
  readonly garageStatEntries: string;
  readonly garageStatPlanned: string;
  /** The stat row's value when a figure has not been given (GAR-01′). */
  readonly garageStatUnrecorded: string;
  readonly garageTabsLabel: string;
  readonly garageTabTimeline: string;
  readonly garageTabCurrent: string;
  readonly garageTabPlanned: string;
  readonly garageTimelineEmpty: string;
  readonly garageCurrentEmpty: string;
  readonly garagePlannedEmpty: string;

  /* ---------------------------------------------------------------------
   * The derived views (T2-303, GAR-03′)
   *
   * Both sheets are computed from the records and nothing else
   * (`src/lib/garage/derived.ts`). Two distinctions run through the strings
   * below and neither is cosmetic:
   *
   * - **Unknown is not empty.** `…Unavailable` says the records did not
   *   arrive; `…Empty` says the owner has recorded nothing. Rendering the
   *   second when the first is true would make a failed request into a
   *   statement about somebody's truck (PR #68).
   * - **Nothing here is advice.** No string says a service is *due*, because
   *   a due date needs an interval the records cannot reach. The sheet
   *   reports elapsed time and distance, and "past its date" means the date
   *   the owner wrote has passed — not that the site thinks the work is late.
   * ------------------------------------------------------------------ */

  /** Heading over the derived mileage line. */
  readonly garageCurrentOdometerHeading: string;
  /** `{date}` is the day the reading was written down. */
  readonly garageCurrentOdometerOnTemplate: string;
  readonly garageCurrentOdometerUnknown: string;
  /** Shown when an earlier record reads higher — the owner's data disagrees. */
  readonly garageCurrentOdometerContradiction: string;
  readonly garageCurrentServiceHeading: string;
  readonly garageCurrentServiceHint: string;
  readonly garageCurrentServiceEmpty: string;
  /** `{date}` — when this reference entry was last named by a done record. */
  readonly garageCurrentServiceLastTemplate: string;
  /** `{distance}` is `Intl`-formatted in the reader's odometer unit. */
  readonly garageCurrentServiceSinceTemplate: string;
  readonly garageCurrentServiceSinceUnknown: string;
  readonly garageCurrentOpenHeading: string;
  /** Label-then-number, so neither locale has to agree with a plural. */
  readonly garageCurrentOpenOverdueTemplate: string;
  readonly garageCurrentOpenUpcomingTemplate: string;
  /**
   * The records are still on their way.
   *
   * A third state beside "empty" and "unavailable", and the reason there is
   * one: `garageDerivedUnavailable` is past tense ("could not be loaded"), so
   * showing it during the ordinary network beat claims a failure that has not
   * happened (T2-303 review, F2). Pending is not failed.
   */
  readonly garageDerivedLoading: string;
  /** The records did not load — said instead of an empty sheet. */
  readonly garageDerivedUnavailable: string;
  readonly garagePlannedQueueNote: string;
  readonly garagePlannedOverdueHeading: string;
  readonly garagePlannedUpcomingHeading: string;
  readonly garagePlannedEstimateHeading: string;
  readonly garagePlannedEstimateTimeLabel: string;
  readonly garagePlannedEstimateCostLabel: string;
  /** `{counted}` of `{total}` — a total without its coverage is a lie. */
  readonly garagePlannedEstimateCoverageTemplate: string;
  readonly garagePlannedEstimateNone: string;
  readonly garagePlannedEstimateCurrencyNote: string;
  readonly garagePhotosHeading: string;
  readonly garagePhotosEmpty: string;
  readonly garagePhotosAdd: string;
  readonly garagePhotosUploading: string;
  /** `{name}` is the vehicle's display name — the alt text of every photo. */
  readonly garagePhotoAltTemplate: string;
  readonly garagePhotoRemove: string;
  readonly garagePhotoTypeRejected: string;
  /** `{size}` is `MAX_PHOTO_BYTES`, formatted by `Intl` at render time. */
  readonly garagePhotoSizeRejectedTemplate: string;
  readonly garagePhotosPrivateNote: string;
  readonly garageUseForBrowsing: string;
  readonly garageUsedForBrowsing: string;
  readonly garageIdentityIncomplete: string;
  /* Records and receipts — T2-302, GAR-02′ / GAR-05′ */
  /**
   * The line that frames every record on the page as the owner's own account
   * of their own truck. AGENTS.md: user-entered garage records are the user's
   * own testimony, never presented as site-verified reference facts.
   */
  readonly garageRecordsTestimonyNote: string;
  readonly garageRecordAdd: string;
  readonly garageRecordEdit: string;
  readonly garageRecordNewHeading: string;
  readonly garageRecordEditHeading: string;
  readonly garageRecordSave: string;
  readonly garageRecordDelete: string;
  /** `{title}` is the record's own heading — the user's words. */
  readonly garageRecordDeleteConfirmTemplate: string;
  readonly garageRecordDateLabel: string;
  readonly garageRecordKindLabel: string;
  readonly garageRecordKindWork: string;
  readonly garageRecordKindReceipt: string;
  readonly garageRecordKindNote: string;
  readonly garageRecordKindPlan: string;
  readonly garageRecordTitleLabel: string;
  readonly garageRecordTitleHint: string;
  readonly garageRecordNotesLabel: string;
  readonly garageRecordNotesHint: string;
  readonly garageRecordCostLabel: string;
  readonly garageRecordCurrencyLabel: string;
  readonly garageRecordTimeLabel: string;
  readonly garageRecordTimeUnitLabel: string;
  readonly garageUnitHours: string;
  readonly garageUnitMinutes: string;
  readonly garageRecordOdometerLabel: string;
  readonly garageRecordOdometerHint: string;
  readonly garageStatusDone: string;
  readonly garageStatusPlanned: string;
  /**
   * The word beside a data chip's figure — real text, rendered off-screen, so
   * a chip is never a bare "1.2 hr" to anyone not reading the layout.
   */
  readonly garageChipTimeLabel: string;
  readonly garageChipCostLabel: string;
  readonly garageChipOdometerLabel: string;
  readonly garageChipReceiptsLabel: string;
  readonly garageReferencesLegend: string;
  readonly garageReferencesHint: string;
  readonly garageReferencesEmpty: string;
  readonly garageReferenceProblemsLabel: string;
  readonly garageReferencePartsLabel: string;
  readonly garageReferenceProceduresLabel: string;
  /** `{name}` is the reference entry's own title, in the reader's locale. */
  readonly garageReferenceProblemTemplate: string;
  readonly garageReferencePartTemplate: string;
  readonly garageReferenceProcedureTemplate: string;
  readonly garageReferenceUnresolved: string;
  readonly garageRecordIssueDate: string;
  readonly garageRecordIssueDateRange: string;
  readonly garageRecordIssueKind: string;
  readonly garageRecordIssueTitleRequired: string;
  /** `{max}` is a character count, interpolated from the module constant. */
  readonly garageRecordIssueTitleLongTemplate: string;
  readonly garageRecordIssueNotesLongTemplate: string;
  readonly garageRecordIssueCost: string;
  readonly garageRecordIssueCostSeparator: string;
  readonly garageRecordIssueCostLarge: string;
  readonly garageRecordIssueTime: string;
  readonly garageRecordIssueTimeLarge: string;
  readonly garageRecordIssueReferences: string;
  /**
   * Shown on the timeline when the records loaded but their receipt counts did
   * not. Without it a card with no chip reads as "no receipts attached", which
   * on a record of what happened is a wrong answer rather than a missing one.
   */
  readonly garageReceiptCountsUnavailable: string;
  readonly garageReceiptsHeading: string;
  readonly garageReceiptsEmpty: string;
  readonly garageReceiptsPrivateNote: string;
  readonly garageReceiptsNeedRecord: string;
  readonly garageReceiptFileLabel: string;
  readonly garageReceiptVendorLabel: string;
  readonly garageReceiptDateLabel: string;
  readonly garageReceiptAmountLabel: string;
  readonly garageReceiptAttach: string;
  readonly garageReceiptUploading: string;
  readonly garageReceiptOpen: string;
  readonly garageReceiptRemove: string;
  readonly garageReceiptRemoveConfirm: string;
  readonly garageReceiptTypeRejected: string;
  /** `{size}` is the size limit, formatted by `Intl` in the page. */
  readonly garageReceiptSizeRejectedTemplate: string;
  readonly garageReceiptIssueVendorLong: string;
  readonly garageReceiptIssueDate: string;
  readonly garageReceiptUntitled: string;
  /* Record media attachments — T2-305, GAR-06′ */
  readonly garageMediaHeading: string;
  readonly garageMediaEmpty: string;
  readonly garageMediaPrivateNote: string;
  readonly garageMediaNeedRecord: string;
  readonly garageMediaFileLabel: string;
  readonly garageMediaHint: string;
  readonly garageMediaAttach: string;
  readonly garageMediaUploading: string;
  readonly garageMediaOpen: string;
  readonly garageMediaRemove: string;
  readonly garageMediaRemoveConfirm: string;
  readonly garageMediaTypeRejected: string;
  /** `{size}` is the size limit, formatted by `Intl` in the page. */
  readonly garageMediaSizeRejectedTemplate: string;
  /*
   * One whole template per kind, `{index}` being its number within that kind.
   *
   * An attachment carries no vendor, date or amount to name it by (GAR-06′),
   * so "Voice note 2" is all there honestly is — and a remove button whose
   * accessible name is just "Remove" beside three others is a button nobody
   * using a screen reader can aim.
   *
   * Three templates rather than a shared `"{kind} {index}"` plus three nouns,
   * because the composition is not the same in both languages and the shared
   * half would have been a locale-independent value sitting in a per-locale
   * record — which `ui.test.ts` refuses, rightly: anything identical in both
   * locales belongs in `src/site.ts`, not here.
   */
  readonly garageMediaLabelPhotoTemplate: string;
  readonly garageMediaLabelVideoTemplate: string;
  readonly garageMediaLabelAudioTemplate: string;
  /* Vehicle selector — T204, FIT-03 */
  readonly vehicleSelectorLabel: string;
  readonly vehicleSelectorIdle: string;
  readonly vehicleSelectorOpen: string;
  readonly vehicleSelectorChange: string;
  readonly vehicleSelectorPanelLabel: string;
  readonly vehicleSelectorClear: string;
  readonly vehicleSelectorReset: string;
  readonly vehicleSelectorApply: string;
  readonly vehicleSelectorGenerationLabel: string;
  readonly vehicleSelectorMarketLabel: string;
  readonly vehicleSelectorYearLabel: string;
  readonly vehicleSelectorEngineLabel: string;
  readonly vehicleSelectorDriveLabel: string;
  /** The drive control's "I have not said" option — see `OPTIONAL_SELECTION_FACETS`. */
  readonly vehicleSelectorDriveAny: string;
  readonly vehicleSelectorFilterNote: string;
  /** `<optgroup>` for powertrains a `combination` entry lists (VEH-03 rule 1/2). */
  readonly vehicleSelectorEnginesRecorded: string;
  /** `<optgroup>` for powertrains no combination entry mentions — *unknown*, not impossible. */
  readonly vehicleSelectorEnginesUnrecorded: string;
  readonly vehicleSelectorNoEngines: string;
  /* Vehicle-filtered listings — T204, FIT-03 */
  /** `{shown}` / `{total}`, computed and interpolated — see `glossaryCountTemplate`. */
  readonly vehicleFitCountTemplate: string;
  readonly vehicleFilteredTag: string;
  readonly vehicleDoesNotFitLabel: string;
  readonly vehicleProvisionalLabel: string;
  /**
   * The standing warning that a filtered listing was matched on FIT-03's
   * quadruple alone (T203 review, F8). Shown whenever any visible row's match
   * leaned on a facet the visitor has not named; narrowing the selection is
   * what removes it.
   */
  readonly vehicleProvisionalNote: string;
  /** `{facets}` is an `Intl.ListFormat` list of `fitmentFacet.*` labels. */
  readonly vehicleProvisionalDetailTemplate: string;
  /* Problem finder — T401, PRB-01…PRB-05 */
  readonly navProblems: string;
  readonly problemsHeading: string;
  readonly problemsIntro: string;
  readonly problemsEmpty: string;
  /** `{shown}` / `{total}`, computed and interpolated — see `glossaryCountTemplate`. */
  readonly problemsCountTemplate: string;
  /* Symptom-first navigation — T402, PRB-02 */
  readonly problemsSearchLabel: string;
  readonly problemsSearchPlaceholder: string;
  /** `aria-label` for the symptom-pill group, same role as `glossaryFilterLabel`. */
  readonly problemsSymptomIndexLabel: string;
  /** The pill that clears a picked symptom, same role as `glossaryFilterAll`. */
  readonly problemsSymptomIndexAll: string;
  readonly problemsNoResults: string;
  readonly problemBreadcrumbLabel: string;
  readonly problemSymptomsHeading: string;
  readonly problemDiagnosticsHeading: string;
  readonly problemCausesHeading: string;
  readonly problemFixPathsHeading: string;
  /** Prefixes the causes a diagnostic result implicates. */
  readonly problemRulesInLabel: string;
  /** Prefixes the causes the same result eliminates. */
  readonly problemRulesOutLabel: string;
  readonly problemNoCauses: string;
  readonly problemNoDiagnostics: string;
  /**
   * Said out loud rather than left as an empty section: PRB-06 makes the gaps
   * report list a problem with no fix path, and a reader looking at one
   * deserves to know the site knows.
   */
  readonly problemNoFixPaths: string;
  /**
   * `{value}` / `{max}` are `difficulty` and `DIFFICULTY_MAX`, both figures
   * from shared data interpolated at render time — never typed into a locale
   * (AGENTS.md).
   */
  readonly problemDifficultyTemplate: string;
  readonly problemCostLabel: string;
  readonly problemPartsLabel: string;
  readonly problemProceduresLabel: string;
  /** Names the triage region for a screen reader; the banner itself is a chip. */
  readonly problemTriageLabel: string;
  /**
   * The provisional-match warning in its **safety-critical** form (T204's
   * binding note on T203 decision (a)): on a page where showing something that
   * does not actually fit the reader's truck is the expensive failure, the
   * standing `vehicleProvisionalNote` is not prominent enough.
   */
  readonly problemProvisionalSafetyNote: string;
  /* ---------------------------------------------------------------------
   * Evidence and safety framing — shared by every content page.
   *
   * These seven keys were three prefixed pairs plus a third caveat before the
   * T501 rebase collapse (2026-09-01): T401 landed `problem…`-prefixed copies
   * of the caveat, the safety notice and the sources labels, T501 landed
   * unprefixed ones, and T703a's community page had a caveat of its own. One
   * sentence translated twice is exactly the failure this module exists to
   * prevent — and for a safety warning it is worse than duplication, because a
   * warning that says two slightly different things on two pages is a warning
   * nobody can quote.
   *
   * **The surviving wording is T401's in every case.** It merged first, a
   * grader renders it (`tests/problem-bilingual-bands.test.ts`), and its safety
   * sentence carries AGENTS.md's mandated "never a substitute for a qualified
   * mechanic" framing verbatim while naming what the page *affects* rather
   * than what it is about — so it stays true for a fault, a part and a job
   * alike. T501's variants were deleted, not merged.
   * ------------------------------------------------------------------- */
  /**
   * PRB-04's visible caveat, rendered in **both** locales on every content
   * page whose tier is below `tsb` (`src/lib/confidence.ts` decides which).
   * `{tier}` is filled with `confidenceTier.<tier>` at render time.
   */
  readonly confidenceCaveatTemplate: string;
  /**
   * The heading of the standing safety notice AGENTS.md requires on every page
   * about brakes, steering, suspension, fuel, tires, SRS, towing or lifting
   * (`src/lib/safety.ts` decides which entries those are).
   *
   * `{system}` is a `glossarySystem.*` label, so the band names *which* system
   * it is warning about. Both `problems` and `parts` carry a `system` facet, so
   * both fill it; `src/components/SafetyNotice.astro` is the only renderer.
   */
  readonly safetyNoticeLabelTemplate: string;
  /**
   * The body of that notice — AGENTS.md's "never present the site as a
   * substitute for a qualified mechanic", as PRB-03 and PRC-02 require it.
   * Rendered in **both** languages in one band, page locale first.
   *
   * Subject-neutral on purpose: it names what the page *affects*, never what
   * the page is about, so it stays true for a fault, a part and a job alike.
   */
  readonly safetyNoticeBody: string;
  /**
   * The short chip form, for a listing card or a page header where the full
   * band does not fit — the design handoff's "safety-critical chip" token.
   *
   * Deliberately **not** `severity.safety-critical`, which carries the same two
   * words for a different fact: that key renders a `problems` entry's
   * `severity` field, a value from a closed data vocabulary that a part does
   * not have. Reusing it would couple the parts pages to `PROBLEM_SEVERITIES`.
   */
  readonly safetyCriticalChipLabel: string;
  /** The heading over a numbered source list, on any content page. */
  readonly sourcesHeading: string;
  /** The archived-copy link beside each numbered source. */
  readonly sourceArchiveLabel: string;
  /** `{date}` is a source's `accessed` field, formatted by `Intl` at render time. */
  readonly sourceAccessedTemplate: string;
  /* Parts — T501, PRT-01, PRT-02, PRT-03 */
  readonly navParts: string;
  readonly partsHeading: string;
  readonly partsIntro: string;
  readonly partsEmpty: string;
  readonly partsNoResults: string;
  /** `{shown}` / `{total}`, computed and interpolated — see `glossaryCountTemplate`. */
  readonly partsCountTemplate: string;
  readonly partsFilterSystemLabel: string;
  readonly partsFilterSystemAll: string;
  readonly partsOemNumberLabel: string;
  /** `{count}` is `quantityPerVehicle`, shared data interpolated in, never retyped. */
  readonly partsQuantityTemplate: string;
  readonly partsFitsLabel: string;
  /** The badge on the number a reader should order today (PRT-02). */
  readonly partsCurrentBadge: string;
  readonly partsSupersededBadge: string;
  /**
   * The third badge state — never merged into {@link partsCurrentBadge} —
   * for a chain `src/lib/parts/index.ts`'s `supersessionChain` could not
   * resolve (an unknown id, a dangling pointer, or a cycle). The build
   * refuses that corpus (`validate-parts`), so this is defense-in-depth; it
   * exists so "we could not follow this pointer" never renders as the
   * confident "order this one" badge (T501 audit, F5).
   */
  readonly partsSupersessionUnknownBadge: string;
  readonly partsSupersessionHeading: string;
  readonly partsSupersessionIntro: string;
  readonly partsSupersessionOldestLabel: string;
  readonly partsSupersessionCurrentLabel: string;
  /**
   * Shown when several older numbers were consolidated into one current
   * number, so the chain is a tree rather than a line — see
   * `supersessionChain` in `src/lib/parts/index.ts` for why the page says so
   * instead of drawing one branch and calling it the chain.
   */
  readonly partsSupersessionForkNote: string;
  readonly partsCrossReferencesHeading: string;
  readonly partsCrossReferenceBrandLabel: string;
  readonly partsCrossReferenceNumberLabel: string;
  readonly partsCrossReferenceQualityLabel: string;
  readonly partsCrossReferenceNoteLabel: string;
  readonly partsVendorsHeading: string;
  readonly partsVendorsIntro: string;
  readonly partsBackToIndex: string;
  /* Modifications — T601, MOD-01, MOD-02 */
  readonly navMods: string;
  readonly modsHeading: string;
  readonly modsIntro: string;
  readonly modsEmpty: string;
  readonly modsNoResults: string;
  /** `{shown}` / `{total}`, computed and interpolated — see `glossaryCountTemplate`. */
  readonly modsCountTemplate: string;
  readonly modsFilterSystemLabel: string;
  readonly modsFilterSystemAll: string;
  readonly modsFilterImpactLabel: string;
  readonly modsFilterImpactAll: string;
  readonly modsFitsLabel: string;
  readonly modsBackToIndex: string;
  /**
   * `{value}` / `{max}` are `difficulty` and `DIFFICULTY_MAX`, both figures
   * from shared data interpolated at render time — never typed into a locale
   * (AGENTS.md). Deliberately **not** `problemDifficultyTemplate`: that key is
   * T401's and reads as the difficulty of *fixing* something, which is a
   * different sentence from the difficulty of *choosing to do* something.
   */
  readonly modsDifficultyTemplate: string;
  readonly modsCostLabel: string;
  /** MOD-01's "what it requires (by entry ID)" — MOD-02's typed references. */
  readonly modsRequiresHeading: string;
  readonly modsRequiresIntro: string;
  readonly modsRequiresNone: string;
  /**
   * Beside a prerequisite whose target has not been written yet. The build
   * refuses that corpus (`validate-mods`), so this is defense-in-depth — it
   * exists so "we could not resolve this reference" never renders as a shorter
   * list of requirements than the entry actually declares (AGENTS.md, "a
   * failure is not a zero").
   */
  readonly modsRequiresUnresolvedLabel: string;
  /** MOD-01's "what it breaks or affects". */
  readonly modsAffectsHeading: string;
  readonly modsAffectsIntro: string;
  readonly modsAffectsNone: string;
  readonly modsAffectsSystemLabel: string;
  readonly modsAffectsImpactLabel: string;
  readonly modsAffectsNoteLabel: string;
  /** MOD-01's "honest tradeoffs prose in both locales". */
  readonly modsTradeoffsHeading: string;
  /**
   * The chip on an index card counting an entry's declared consequences.
   * `{count}` is `affects.length`, a figure computed at render time.
   */
  readonly modsAffectsCountTemplate: string;
}

const en: UiStrings = {
  siteTagline:
    "Montero, Pajero and Shogun — your garage and the reference behind it",
  skipToContent: "Skip to content",
  navHome: "Home",
  navGlossary: "Glossary",
  navLabel: "Main navigation",
  languageLabel: "Language",
  languageSwitcherLabel: "Choose a language",
  languageCurrent: "Current language",
  homeHeading: "Keep your Montero's whole life in one place",
  homeIntro: `${SITE_NAME} is where a Montero, Pajero or Shogun owner keeps their truck's whole life: every job, every receipt, every part. Behind it sits a reference covering every generation and market. It starts with ${TRUCK_NAME}, a ${TRUCK_YEAR} Mitsubishi Montero, in English and Costa Rican Spanish.`,
  homeStatus:
    "Under construction: the bilingual platform is in place; the garage and the reference content land next.",
  footerSourceLabel: "Source code on GitHub",
  footerIssuesLabel: "Report a problem or correct a fact",
  footerDisclaimer:
    "Reference material only. For safety-critical work, consult a qualified mechanic.",
  footerNotAffiliated:
    "An independent enthusiast site. Not affiliated with Mitsubishi Motors.",
  notFoundTitle: "Page not found",
  notFoundMessage: "That page does not exist, or it has moved.",
  notFoundHomeLink: "Go to the home page",
  rootRedirectTitle: "Choose a language",
  rootRedirectMessage: "Sending you to your language…",
  rootRedirectManual: "If nothing happens, choose a language:",
  glossaryHeading: "Glossary",
  glossaryIntro:
    "The Costa Rican terms this site uses, with their English equivalents. Regional variants are recorded as searchable aliases and never used in the Spanish text.",
  glossarySearchLabel: "Search for terms and regional variants",
  glossarySearchPlaceholder: "Search any variant — rin, goma, balatas…",
  glossaryFilterLabel: "Filter by system",
  glossaryFilterAll: "All systems",
  glossaryAliasesLabel: "Also called",
  glossaryFalseFriendLabel: "means something else in Costa Rica",
  glossaryRelatedLabel: "See also",
  glossaryNoResults: "No terms match that search or filter.",
  glossaryEmpty: "The glossary has no terms yet.",
  glossaryCountTemplate: "{shown} of {total} terms",
  "glossarySystem.engine": "Engine",
  "glossarySystem.fuel": "Fuel system",
  "glossarySystem.cooling": "Cooling",
  "glossarySystem.exhaust": "Exhaust",
  "glossarySystem.transmission": "Transmission",
  "glossarySystem.transfer-case": "Transfer case",
  "glossarySystem.drivetrain": "Drivetrain",
  "glossarySystem.brakes": "Brakes",
  "glossarySystem.suspension": "Suspension",
  "glossarySystem.steering": "Steering",
  "glossarySystem.wheels-tires": "Wheels and tires",
  "glossarySystem.electrical": "Electrical system",
  "glossarySystem.hvac": "Heating and air conditioning",
  "glossarySystem.body": "Body",
  "glossarySystem.interior": "Interior and trim",
  "glossarySystem.tools": "Tools",
  "glossarySystem.fluids": "Fluids",
  "glossarySystem.general": "General terms",
  navCommunity: "Community",
  communityHeading: "Community directory",
  communityIntro:
    "Forums, groups, shops and channels for Montero, Pajero and Shogun owners. Costa Rican and Spanish-language communities are listed as first-class entries, not an appendix.",
  communityFilterRegionLabel: "Filter by region",
  communityFilterRegionAll: "All regions",
  communityRegionWorldwide: "World",
  communityFilterLanguageLabel: "Filter by language",
  communityFilterLanguageAll: "All languages",
  communityFilterGenerationLabel: "Filter by generation",
  communityFilterGenerationAll: "All generations",
  communityFilterActivityLabel: "Filter by activity",
  communityFilterActivityAll: "All activity levels",
  communityNoResults: "No communities match these filters.",
  communityEmpty: "The community directory has no entries yet.",
  communityGoodForLabel: "Good for",
  communityVisitLabel: "Visit",
  communityAlsoOnLabel: "Also on",
  communityCountTemplate: "{shown} of {total} communities",
  communityActivityAssessedTemplate: "Checked {date}",
  "communityType.forum": "Forum",
  "communityType.facebook-group": "Facebook group",
  "communityType.whatsapp-group": "WhatsApp group",
  "communityType.telegram-group": "Telegram group",
  "communityType.discord": "Discord server",
  "communityType.club": "Owners' club",
  "communityType.youtube-channel": "YouTube channel",
  "communityType.vendor": "Vendor",
  "communityType.shop": "Parts shop",
  "communityActivity.very-active": "Very active",
  "communityActivity.active": "Active",
  "communityActivity.quiet": "Quiet",
  "communityActivity.dormant": "Dormant",
  "communityActivity.archived": "Archived",
  "communityLinkKind.website": "Website",
  "communityLinkKind.forum": "Forum",
  "communityLinkKind.map": "Map",
  "generation.gen1": "Gen 1",
  "generation.gen2": "Gen 2",
  "generation.gen2-5": "Gen 2.5",
  "generation.gen3": "Gen 3",
  "generation.gen4": "Gen 4",
  "confidenceTier.fsm-confirmed":
    "Confirmed in the Factory Service Manual (FSM)",
  "confidenceTier.tsb": "Technical service bulletin (TSB)",
  "confidenceTier.community-consensus": "Community consensus",
  "confidenceTier.first-hand": "First-hand experience",
  "confidenceTier.anecdotal": "Anecdotal",
  navSignIn: "Sign in",
  signInHeading: "Sign in to your garage",
  signInIntro:
    "Your garage holds your vehicles, your work records and your receipts. Sign in to open it, or to start one.",
  signInNoPasswordNote:
    "There is no password to choose or forget. We send a one-time link to your email, or you can continue with Google.",
  signInPrivacyNote:
    "Everything you store is private by default. Nothing is published until you publish it, one vehicle and one record at a time.",
  signInEmailLabel: "Email address",
  signInEmailPlaceholder: "name@example.com",
  signInEmailSubmit: "Email me a sign-in link",
  signInEmailSubmitBusy: "Sending…",
  signInAlternativeLabel: "or",
  signInGoogleLabel: "Continue with Google",
  signInLinkSentTemplate:
    "A sign-in link is on its way to {email}. It works once, and only from this device's browser session.",
  signInEmailInvalid: "Enter an email address you can open right now.",
  signInError:
    "That did not work. Try again in a moment, and if it keeps failing, report it from the footer link.",
  signInSignedInTemplate: "Signed in as {email}.",
  signInSignOut: "Sign out",
  signInUnavailable:
    "Accounts are not switched on yet on this deployment. The reference side of the site works without one.",
  signInScriptRequired:
    "Signing in needs JavaScript. Everything else on this site works without it.",
  navGarage: "Garage",
  garageHeading: "Your garage",
  garageIntro:
    "Every truck you keep here, with its photos and its odometer. Nobody else can see any of it unless you publish it.",
  garageUnavailable:
    "Accounts are not switched on yet on this deployment, so there is no garage to open. The reference side of the site works without one.",
  garageScriptRequired:
    "Your garage needs JavaScript: it is your own data, and your browser fetches it after you sign in. Everything else on this site works without it.",
  garageSignedOutHeading: "Sign in to open your garage",
  garageSignedOutBody:
    "A garage belongs to an account. Signing in takes one link sent to your email — there is no password to choose.",
  garageSignInLink: "Go to the sign-in page",
  garageLoading: "Opening your garage…",
  garageError:
    "That did not go through. Try again in a moment; nothing was changed.",
  garageUnreachable:
    "Your garage could not be opened — the connection dropped, or something in this browser blocked part of the page. Reload to try again; nothing you have saved is affected.",
  garageVehiclesHeading: "Your vehicles",
  garageEmptyHeading: "No vehicles yet",
  garageEmptyBody: `Add your Montero, Pajero or Shogun and give it a name. The truck this site was built around is called ${TRUCK_NAME}.`,
  garageAddVehicle: "Add a vehicle",
  garageOpenVehicle: "Open",
  garageEditVehicle: "Edit",
  garageFormNewHeading: "A new vehicle",
  garageFormEditHeading: "Edit this vehicle",
  garageNameLabel: "What you call it",
  garageNameHint:
    "The name you use for this truck. It is yours; nobody else sees it until you publish something.",
  garageIdentityLegend: "Which truck it is",
  garageIdentityHint:
    "This is what lets parts, procedures and problems be matched to your truck. Only the generation is needed — leave the rest unanswered if you are not sure.",
  garageFacetUnknown: "Not sure yet",
  garageOdometerLabel: "Odometer",
  garageOdometerHint:
    "The reading as it stands today. It is stored once and shown back in whichever unit you pick.",
  garageOdometerUnitLabel: "Odometer unit",
  garageUnitKilometres: "Kilometres",
  garageUnitMiles: "Miles",
  garageSave: "Save vehicle",
  garageSaving: "Saving…",
  garageSaved: "Saved.",
  garageCancel: "Cancel",
  garageDelete: "Delete this vehicle",
  garageDeleting: "Deleting…",
  garageDeleteConfirmTemplate:
    "Delete {name}? Its photos and everything recorded on it go with it, and that cannot be undone.",
  garageIssueNameRequired: "Give the vehicle a name.",
  garageIssueNameTooLongTemplate: "That name is longer than {max} characters.",
  garageIssueGenerationRequired: "Choose the generation.",
  garageIssueIdentityUnknown:
    "That is not a combination the taxonomy knows. Choose again from the lists.",
  garageIssueYearRange: "Choose a year from the list.",
  garageIssueOdometerNumber:
    "Write the odometer in digits, or leave the field empty.",
  garageIssueOdometerLarge:
    "That reading is higher than any odometer this site accepts.",
  garageBackToVehicles: "All vehicles",
  garageStatEntries: "Records",
  garageStatPlanned: "Planned",
  garageStatUnrecorded: "Not recorded",
  garageTabsLabel: "Garage views",
  garageTabTimeline: "Timeline",
  garageTabCurrent: "Current state",
  garageTabPlanned: "Planned work",
  garageTimelineEmpty: "Nothing has been recorded on this vehicle yet.",
  garageCurrentEmpty:
    "The current-state sheet is worked out from what you record, so it fills in as you go.",
  garagePlannedEmpty: "Nothing is planned on this vehicle yet.",
  garageCurrentOdometerHeading: "Latest reading in your records",
  garageCurrentOdometerOnTemplate: "Written down on {date}.",
  garageCurrentOdometerUnknown:
    "No record on this vehicle carries an odometer reading yet.",
  garageCurrentOdometerContradiction:
    "An earlier record reads higher than this one. Both are kept exactly as you wrote them.",
  garageCurrentServiceHeading: "Service history",
  garageCurrentServiceHint:
    "One line for each reference entry you have linked to a record, the one left longest first. The site does not know when any of it is due — it only knows what you wrote down.",
  garageCurrentServiceEmpty:
    "Nothing here yet. This history is built from the problems, parts and procedures you link to a record.",
  garageCurrentServiceLastTemplate: "Last done {date}",
  garageCurrentServiceSinceTemplate: "{distance} since",
  garageCurrentServiceSinceUnknown: "distance since unknown",
  garageCurrentOpenHeading: "Open items",
  garageCurrentOpenOverdueTemplate: "Past their date: {count}",
  garageCurrentOpenUpcomingTemplate: "Still ahead: {count}",
  garageDerivedLoading: "Working this out from your records…",
  garageDerivedUnavailable:
    "This view is worked out from your records, and they could not be loaded. Nothing here is a statement about the truck.",
  garagePlannedQueueNote:
    "In the order of the dates you gave, the ones already past first. The site sends no reminders.",
  garagePlannedOverdueHeading: "Past their date",
  garagePlannedUpcomingHeading: "Still ahead",
  garagePlannedEstimateHeading: "What you estimated",
  garagePlannedEstimateTimeLabel: "Time",
  garagePlannedEstimateCostLabel: "Cost",
  garagePlannedEstimateCoverageTemplate:
    "From {counted} of {total} planned items.",
  garagePlannedEstimateNone: "No planned item carries an estimate yet.",
  garagePlannedEstimateCurrencyNote:
    "Amounts are added up per currency and never converted between them.",
  garagePhotosHeading: "Photos",
  garagePhotosEmpty: "No photos yet.",
  garagePhotosAdd: "Add a photo",
  garagePhotosUploading: "Uploading…",
  garagePhotoAltTemplate: "Photo of {name}",
  garagePhotoRemove: "Remove this photo",
  garagePhotoTypeRejected:
    "That file is not an image this site stores. JPEG, PNG, WebP, AVIF and HEIC all work.",
  garagePhotoSizeRejectedTemplate: "That photo is larger than {size}.",
  garagePhotosPrivateNote:
    "Photos are held in private storage. Nobody without your session can open one, and the links this page uses expire on their own.",
  garageUseForBrowsing: "Browse the site as this truck",
  garageUsedForBrowsing: "The site is filtered to this truck.",
  garageIdentityIncomplete:
    "Name the market, the year and the engine to filter the site with this truck.",
  garageRecordsTestimonyNote:
    "These are your own notes about your own truck, kept as you wrote them. The site does not check them and never presents them as reference facts.",
  garageRecordAdd: "Add a record",
  garageRecordEdit: "Edit this record",
  garageRecordNewHeading: "A new record",
  garageRecordEditHeading: "Edit this record",
  garageRecordSave: "Save record",
  garageRecordDelete: "Delete this record",
  garageRecordDeleteConfirmTemplate:
    "Delete “{title}”? Its receipts go with it, and that cannot be undone.",
  garageRecordDateLabel: "Date",
  garageRecordKindLabel: "Kind of record",
  garageRecordKindWork: "Work done",
  garageRecordKindReceipt: "Receipt",
  garageRecordKindNote: "Note",
  garageRecordKindPlan: "Planned",
  garageRecordTitleLabel: "What it was",
  garageRecordTitleHint:
    "One line you will recognise later: “Front sway-bar end links replaced”.",
  garageRecordNotesLabel: "Notes",
  garageRecordNotesHint:
    "Anything worth remembering — what you found, what you would do differently. Write it in whichever language you think in.",
  garageRecordCostLabel: "Cost",
  garageRecordCurrencyLabel: "Currency",
  garageRecordTimeLabel: "Time it took",
  garageRecordTimeUnitLabel: "Time unit",
  garageUnitHours: "Hours",
  garageUnitMinutes: "Minutes",
  garageRecordOdometerLabel: "Odometer that day",
  garageRecordOdometerHint:
    "What the odometer read when this happened, if you noted it. It does not change the vehicle's current reading.",
  garageStatusDone: "done",
  garageStatusPlanned: "planned",
  garageChipTimeLabel: "Time",
  garageChipCostLabel: "Cost",
  garageChipOdometerLabel: "Odometer",
  garageChipReceiptsLabel: "Receipts",
  garageReferencesLegend: "Link it to the reference",
  garageReferencesHint:
    "The problem, parts and procedure pages this job used. Linking them is how your record and the reference find each other later.",
  garageReferencesEmpty:
    "The reference has no entries to link yet. Records saved now can be linked once it does.",
  garageReferenceProblemsLabel: "Problems",
  garageReferencePartsLabel: "Parts",
  garageReferenceProceduresLabel: "Procedures",
  garageReferenceProblemTemplate: "problem: {name}",
  garageReferencePartTemplate: "part: {name}",
  garageReferenceProcedureTemplate: "procedure: {name}",
  garageReferenceUnresolved:
    "This entry is not in the reference. Your record keeps it as you saved it.",
  garageRecordIssueDate: "Give the date this happened, as year-month-day.",
  garageRecordIssueDateRange:
    "That date is outside anything this site accepts.",
  garageRecordIssueKind: "Choose what kind of record this is.",
  garageRecordIssueTitleRequired: "Say in one line what this record is.",
  garageRecordIssueTitleLongTemplate:
    "That line is longer than {max} characters. The notes field has room for the rest.",
  garageRecordIssueNotesLongTemplate:
    "Those notes are longer than {max} characters.",
  garageRecordIssueCost: "Write the cost in digits, or leave the field empty.",
  garageRecordIssueCostSeparator:
    "That figure could be read two ways. Write it without thousands separators — 1500, or 1500.50.",
  garageRecordIssueCostLarge: "That cost is higher than this site accepts.",
  garageRecordIssueTime: "Write the time in digits, or leave the field empty.",
  garageRecordIssueTimeLarge:
    "That is longer than this site records for one job.",
  garageRecordIssueReferences:
    "One of the reference entries chosen is not on this site any more. Unselect it and save again.",
  garageReceiptCountsUnavailable:
    "Your records are here, but this page could not check which of them have receipts — so no receipt counts are shown below. Open a record to see its own. Reloading usually fixes it.",
  garageReceiptsHeading: "Receipts",
  garageReceiptsEmpty: "No receipts attached to this record.",
  garageReceiptsPrivateNote:
    "Receipts are held in private storage. Nobody without your session can open one, and the links this page uses expire on their own.",
  garageReceiptsNeedRecord:
    "Save the record first; then you can attach its receipts.",
  garageReceiptFileLabel: "The file",
  garageReceiptVendorLabel: "Where it is from",
  garageReceiptDateLabel: "Date on the receipt",
  garageReceiptAmountLabel: "Amount",
  garageReceiptAttach: "Attach receipt",
  garageReceiptUploading: "Uploading…",
  garageReceiptOpen: "Open",
  garageReceiptRemove: "Remove",
  garageReceiptRemoveConfirm:
    "Remove this receipt? The file goes with it, and that cannot be undone.",
  garageReceiptTypeRejected:
    "That file is not one this site stores. JPEG, PNG, WebP, HEIC and PDF all work.",
  garageReceiptSizeRejectedTemplate: "That file is larger than {size}.",
  garageReceiptIssueVendorLong: "That name is too long for the field.",
  garageReceiptIssueDate:
    "Give the receipt's date as year-month-day, or leave it empty.",
  garageReceiptUntitled: "Receipt",
  garageMediaHeading: "Photos, video and voice notes",
  garageMediaEmpty: "Nothing else is attached to this record.",
  garageMediaPrivateNote:
    "These are held in private storage, like the receipts above. Nobody without your session can open one, and the links this page uses expire on their own.",
  garageMediaNeedRecord:
    "Save the record first; then you can attach photos, video and voice notes to it.",
  garageMediaFileLabel: "The file",
  garageMediaHint:
    "Anything that documents the job and is not a receipt: a photo of the part that failed, a video of the noise, the voice note the shop sent you.",
  garageMediaAttach: "Attach file",
  garageMediaUploading: "Uploading…",
  garageMediaOpen: "Open",
  garageMediaRemove: "Remove",
  garageMediaRemoveConfirm:
    "Remove this attachment? The file goes with it, and that cannot be undone.",
  garageMediaTypeRejected:
    "That file is not one this site stores here. Photos, video and audio all work; a receipt goes in the section above.",
  garageMediaSizeRejectedTemplate: "That file is larger than {size}.",
  garageMediaLabelPhotoTemplate: "Photo {index}",
  garageMediaLabelVideoTemplate: "Video clip {index}",
  garageMediaLabelAudioTemplate: "Voice note {index}",
  vehicleSelectorLabel: "Your vehicle",
  vehicleSelectorIdle: "Browsing all vehicles",
  vehicleSelectorOpen: "Select your vehicle",
  vehicleSelectorChange: "Change vehicle",
  vehicleSelectorPanelLabel: "Which truck do you have?",
  vehicleSelectorClear: "Forget this vehicle",
  vehicleSelectorReset: "Clear",
  vehicleSelectorApply: "Set vehicle",
  vehicleSelectorGenerationLabel: "Generation",
  vehicleSelectorMarketLabel: "Market",
  vehicleSelectorYearLabel: "Year",
  vehicleSelectorEngineLabel: "Engine",
  vehicleSelectorDriveLabel: "Drive",
  vehicleSelectorDriveAny: "I have not said",
  vehicleSelectorFilterNote:
    "Combinations the taxonomy says never existed are filtered out as you pick.",
  vehicleSelectorEnginesRecorded: "Recorded for this combination",
  vehicleSelectorEnginesUnrecorded: "Not recorded — may still have existed",
  vehicleSelectorNoEngines: "No engine is listed for that combination yet.",
  vehicleFitCountTemplate: "{shown} of {total} fit your truck",
  vehicleFilteredTag: "filtered",
  vehicleDoesNotFitLabel: "Does not fit the vehicle you selected",
  vehicleProvisionalLabel: "Provisional match",
  vehicleProvisionalNote:
    "Matched on generation, market, year and engine only. Entries marked provisional also depend on something you have not told us, so some of them will not fit your truck. Narrowing your selection removes the mark.",
  vehicleProvisionalDetailTemplate:
    "This entry also depends on details you have not given: {facets}.",
  navParts: "Parts",
  partsHeading: "Parts",
  partsIntro:
    "Part numbers for the Montero, Pajero and Shogun, with the numbers that replaced them, the aftermarket equivalents worth knowing about, and where the numbers came from.",
  partsEmpty: "No part numbers have been published yet.",
  partsNoResults: "No parts match these filters.",
  partsCountTemplate: "{shown} of {total} parts",
  partsFilterSystemLabel: "Filter by system",
  partsFilterSystemAll: "All systems",
  partsOemNumberLabel: "OEM part number",
  partsQuantityTemplate: "{count} per vehicle",
  partsFitsLabel: "Fits",
  partsCurrentBadge: "Order this one",
  partsSupersededBadge: "Replaced",
  partsSupersessionUnknownBadge: "Verify before ordering",
  partsSupersessionHeading: "Supersession chain",
  partsSupersessionIntro:
    "Each number was replaced by the one after it. Only the last one can still be ordered.",
  partsSupersessionOldestLabel: "Oldest number",
  partsSupersessionCurrentLabel: "Current number",
  partsSupersessionForkNote:
    "Several older numbers were replaced by the same number, so the chain below is one branch of several. These other numbers join it at the same point:",
  partsCrossReferencesHeading: "Aftermarket cross-references",
  partsCrossReferenceBrandLabel: "Brand",
  partsCrossReferenceNumberLabel: "Their number",
  partsCrossReferenceQualityLabel: "Verdict",
  partsCrossReferenceNoteLabel: "What we know",
  partsVendorsHeading: "Where to buy it",
  partsVendorsIntro:
    "Sellers from the community directory. Nobody pays to be listed here, and nothing on this page is an affiliate link.",
  partsBackToIndex: "All parts",

  navMods: "Mods",
  modsHeading: "Modifications",
  modsIntro:
    "What each modification asks of the truck before it goes on, and what it " +
    "costs you afterwards. Nothing here is sold; the tradeoffs are the point.",
  modsEmpty: "No modifications have been written up yet.",
  modsNoResults: "No modifications match these filters.",
  modsCountTemplate: "{shown} of {total} modifications",
  modsFilterSystemLabel: "Filter by system",
  modsFilterSystemAll: "All systems",
  modsFilterImpactLabel: "Filter by consequence",
  modsFilterImpactAll: "Any consequence",
  modsFitsLabel: "Fits",
  modsBackToIndex: "All modifications",
  modsDifficultyTemplate: "Difficulty {value}/{max}",
  modsCostLabel: "Cost",
  modsRequiresHeading: "What it needs first",
  modsRequiresIntro:
    "Each of these has to be on the truck, or in your hands, before this one " +
    "makes sense.",
  modsRequiresNone: "Nothing else has to be done first.",
  modsRequiresUnresolvedLabel: "Not written up yet",
  modsAffectsHeading: "What it breaks or affects",
  modsAffectsIntro:
    "Everything below is a consequence of fitting this, not a reason against " +
    "it. Read it before you buy, not after.",
  modsAffectsNone: "Nothing has been documented as affected by this yet.",
  modsAffectsSystemLabel: "System",
  modsAffectsImpactLabel: "Consequence",
  modsAffectsNoteLabel: "What happens",
  modsTradeoffsHeading: "The honest tradeoffs",
  modsAffectsCountTemplate: "{count} affected",
  "modImpact.breaks": "Stops working",
  "modImpact.degrades": "Gets worse",
  "modImpact.needs-adjustment": "Has to be reset",
  "modReferenceCollection.mods": "Modification",
  "modReferenceCollection.parts": "Part",

  "crossReferenceQuality.oem-supplier": "Same maker as the OEM part",
  "crossReferenceQuality.equivalent": "Reported equivalent",
  "crossReferenceQuality.lower-grade": "Works, reported to wear out sooner",
  "crossReferenceQuality.avoid": "Avoid",
  "drive.2wd": "Two-wheel drive",
  "drive.4wd": "Four-wheel drive",
  "fitmentFacet.transmission": "transmission",
  "fitmentFacet.transferCase": "transfer case",
  "fitmentFacet.trim": "trim",
  "fitmentFacet.drive": "drive",
  navProblems: "Problems",
  problemsHeading: "Problems",
  problemsIntro:
    "Start from what the truck is doing. Every entry says what is safe to do about it right now, what to check, what usually causes it, and what fixing it takes.",
  problemsEmpty: "No problems have been written up yet.",
  problemsCountTemplate: "{shown} of {total} problems",
  problemsSearchLabel: "Search symptoms and problems",
  problemsSearchPlaceholder:
    "Search a symptom — grinding noise, hard shifting…",
  problemsSymptomIndexLabel: "Browse by symptom",
  problemsSymptomIndexAll: "All symptoms",
  problemsNoResults: "No problems match that symptom or search.",
  problemBreadcrumbLabel: "Breadcrumb",
  problemSymptomsHeading: "Symptoms",
  problemDiagnosticsHeading: "Diagnostic steps",
  problemCausesHeading: "Likely causes",
  problemFixPathsHeading: "Fix paths",
  sourcesHeading: "Sources",
  sourceAccessedTemplate: "Read {date}",
  problemRulesInLabel: "Points to",
  problemRulesOutLabel: "Rules out",
  problemNoCauses: "No root cause has been established for this one yet.",
  problemNoDiagnostics: "No diagnostic procedure has been written up yet.",
  problemNoFixPaths:
    "No fix path has been written up for this problem yet. It is on the backlog.",
  problemDifficultyTemplate: "Difficulty {value}/{max}",
  problemCostLabel: "Cost",
  problemPartsLabel: "Parts",
  problemProceduresLabel: "Procedures",
  sourceArchiveLabel: "archived copy",
  problemTriageLabel: "Can you drive it?",
  safetyNoticeLabelTemplate: "Safety notice — {system}.",
  safetyCriticalChipLabel: "Safety-critical",
  safetyNoticeBody:
    "This affects a safety-critical system. Reference material only: for safety-critical work, consult a qualified mechanic.",
  confidenceCaveatTemplate:
    "{tier}. This entry is not backed by factory documentation — treat its values and steps as a starting point, not as if they came from the factory manual.",
  problemProvisionalSafetyNote:
    "This is safety-critical, and the match to your truck is only provisional: it was made on generation, market, year and engine alone. Narrow your selection, and confirm against your own vehicle, before acting on anything here.",
  "sourceKind.fsm": "Factory Service Manual",
  "sourceKind.tsb": "Service bulletin",
  "sourceKind.manufacturer": "Manufacturer literature",
  "sourceKind.forum": "Owner forum",
  "sourceKind.video": "Repair or build video",
  "sourceKind.vendor": "Vendor catalogue",
  "sourceKind.reference": "Reference work",
  "sourceKind.first-hand": "First-hand",
  "severity.safety-critical": "Safety-critical",
  "severity.damaging": "Damages other parts",
  "severity.stranding": "Can strand you",
  "severity.degrading": "Works worse",
  "severity.cosmetic": "Cosmetic",
  "drivability.drive-normally": "Drive normally",
  "drivability.drive-gently-repair-soon": "Drive gently — repair soon",
  "drivability.do-not-drive": "Do not drive",
  "drivability.tow-only": "Tow only",
  "costBand.minimal": "Cheapest class of repair",
  "costBand.moderate": "A normal parts-and-an-afternoon job",
  "costBand.significant": "A major component or a shop bill",
  "costBand.major": "A big share of what the truck is worth",
};

const es: UiStrings = {
  siteTagline:
    "Montero, Pajero y Shogun — su taller y la referencia que lo respalda",
  skipToContent: "Saltar al contenido",
  navHome: "Inicio",
  navGlossary: "Glosario",
  navLabel: "Navegación principal",
  languageLabel: "Idioma",
  languageSwitcherLabel: "Elija un idioma",
  languageCurrent: "Idioma actual",
  homeHeading: "Guarde la vida entera de su Montero en un solo lugar",
  homeIntro: `${SITE_NAME} es donde el dueño de un Montero, Pajero o Shogun guarda la vida entera de su carro: cada trabajo, cada factura, cada repuesto. Lo respalda una referencia para todas las generaciones y todos los mercados. Todo empieza con ${TRUCK_NAME}, un Mitsubishi Montero ${TRUCK_YEAR}, en inglés y en español de Costa Rica.`,
  homeStatus:
    "En construcción: la plataforma bilingüe está lista; el taller y el contenido de referencia vienen a continuación.",
  footerSourceLabel: "Código fuente en GitHub",
  footerIssuesLabel: "Reporte un problema o corrija un dato",
  footerDisclaimer:
    "Material de referencia únicamente. En trabajos críticos para la seguridad, consulte a un mecánico calificado.",
  footerNotAffiliated:
    "Un sitio independiente, hecho por aficionados. Sin afiliación a Mitsubishi Motors.",
  notFoundTitle: "Página no encontrada",
  notFoundMessage: "Esa página no existe o cambió de dirección.",
  notFoundHomeLink: "Ir a la página de inicio",
  rootRedirectTitle: "Elija un idioma",
  rootRedirectMessage: "Redirigiendo a la versión en su idioma…",
  rootRedirectManual: "Si no pasa nada, elija un idioma:",
  glossaryHeading: "Glosario",
  glossaryIntro:
    "Los términos costarricenses que usa este sitio, con su equivalente en inglés. Las variantes regionales quedan registradas como alias que se pueden buscar y nunca se usan en el texto en español.",
  glossarySearchLabel: "Busque términos y variantes regionales",
  glossarySearchPlaceholder: "Busque cualquier variante — rin, goma, balatas…",
  glossaryFilterLabel: "Filtre por sistema",
  glossaryFilterAll: "Todos los sistemas",
  glossaryAliasesLabel: "También se le dice",
  glossaryFalseFriendLabel: "en Costa Rica significa otra cosa",
  glossaryRelatedLabel: "Vea también",
  glossaryNoResults: "Ningún término coincide con esa búsqueda o ese filtro.",
  glossaryEmpty: "El glosario todavía no tiene términos.",
  glossaryCountTemplate: "{shown} de {total} términos",
  "glossarySystem.engine": "Motor",
  "glossarySystem.fuel": "Sistema de combustible",
  "glossarySystem.cooling": "Refrigeración",
  "glossarySystem.exhaust": "Escape",
  "glossarySystem.transmission": "Transmisión",
  "glossarySystem.transfer-case": "Caja de transferencia",
  "glossarySystem.drivetrain": "Tren motriz",
  "glossarySystem.brakes": "Frenos",
  "glossarySystem.suspension": "Suspensión",
  "glossarySystem.steering": "Dirección",
  "glossarySystem.wheels-tires": "Aros y llantas",
  "glossarySystem.electrical": "Sistema eléctrico",
  "glossarySystem.hvac": "Calefacción y aire acondicionado",
  "glossarySystem.body": "Carrocería",
  "glossarySystem.interior": "Interior y acabados",
  "glossarySystem.tools": "Herramientas",
  "glossarySystem.fluids": "Líquidos",
  "glossarySystem.general": "Términos generales",
  navCommunity: "Comunidad",
  communityHeading: "Directorio de comunidades",
  communityIntro:
    "Foros, grupos, tiendas y canales para dueños de Montero, Pajero y Shogun. Las comunidades costarricenses y de habla hispana aparecen en igualdad de condiciones, no en un apéndice.",
  communityFilterRegionLabel: "Filtre por región",
  communityFilterRegionAll: "Todas las regiones",
  communityRegionWorldwide: "Mundo",
  communityFilterLanguageLabel: "Filtre por idioma",
  communityFilterLanguageAll: "Todos los idiomas",
  communityFilterGenerationLabel: "Filtre por generación",
  communityFilterGenerationAll: "Todas las generaciones",
  communityFilterActivityLabel: "Filtre por actividad",
  communityFilterActivityAll: "Todos los niveles de actividad",
  communityNoResults: "Ninguna comunidad coincide con estos filtros.",
  communityEmpty: "El directorio de comunidades todavía no tiene entradas.",
  communityGoodForLabel: "Bueno para",
  communityVisitLabel: "Visitar",
  communityAlsoOnLabel: "También en",
  communityCountTemplate: "{shown} de {total} comunidades",
  communityActivityAssessedTemplate: "Revisado el {date}",
  "communityType.forum": "Foro",
  "communityType.facebook-group": "Grupo de Facebook",
  "communityType.whatsapp-group": "Grupo de WhatsApp",
  "communityType.telegram-group": "Grupo de Telegram",
  "communityType.discord": "Servidor de Discord",
  "communityType.club": "Club de dueños",
  "communityType.youtube-channel": "Canal de YouTube",
  "communityType.vendor": "Proveedor",
  "communityType.shop": "Tienda de repuestos",
  /*
   * B3 (bilingual review, ruled) — feminine forms, agreeing with "comunidad"
   * (the noun this badge is describing), which is also what four other
   * strings on this page already name explicitly (`communityHeading`,
   * `communityEmpty`, `communityCountTemplate`, `communityNoResults`).
   * "Foro · Archivada" is expected and accepted: the badge agrees with the
   * community, not with the type chip next to it.
   */
  "communityActivity.very-active": "Muy activa",
  "communityActivity.active": "Activa",
  "communityActivity.quiet": "Poco activa",
  "communityActivity.dormant": "Inactiva",
  "communityActivity.archived": "Archivada",
  "communityLinkKind.website": "Sitio web",
  "communityLinkKind.forum": "Foro",
  "communityLinkKind.map": "Mapa",
  "generation.gen1": "Generación 1",
  "generation.gen2": "Generación 2",
  "generation.gen2-5": "Generación 2.5",
  "generation.gen3": "Generación 3",
  "generation.gen4": "Generación 4",
  "confidenceTier.fsm-confirmed": "Confirmado en el manual de fábrica (FSM)",
  "confidenceTier.tsb": "Boletín técnico de servicio (TSB)",
  "confidenceTier.community-consensus": "Consenso de la comunidad",
  "confidenceTier.first-hand": "Experiencia de primera mano",
  "confidenceTier.anecdotal": "Anecdótico",
  navSignIn: "Ingresar",
  signInHeading: "Ingrese a su taller",
  signInIntro:
    "En su taller quedan sus carros, sus trabajos y sus facturas. Ingrese para abrirlo, o para empezar uno.",
  signInNoPasswordNote:
    "No hay contraseña que escoger ni que olvidar. Le enviamos un enlace de un solo uso a su correo, o puede continuar con Google.",
  signInPrivacyNote:
    "Todo lo que guarde queda privado desde el inicio. Nada se publica hasta que usted lo publique, carro por carro y ficha por ficha.",
  signInEmailLabel: "Correo electrónico",
  signInEmailPlaceholder: "nombre@ejemplo.com",
  signInEmailSubmit: "Envíeme un enlace de acceso",
  signInEmailSubmitBusy: "Enviando…",
  signInAlternativeLabel: "o",
  signInGoogleLabel: "Continúe con Google",
  signInLinkSentTemplate:
    "Va en camino un enlace de acceso a {email}. Sirve una sola vez, y solo desde el navegador de este dispositivo.",
  signInEmailInvalid: "Escriba un correo que pueda abrir en este momento.",
  signInError:
    "No se pudo completar. Inténtelo de nuevo en un momento y, si sigue fallando, repórtelo con el enlace del pie de página.",
  signInSignedInTemplate: "Sesión iniciada como {email}.",
  signInSignOut: "Cerrar sesión",
  signInUnavailable:
    "Las cuentas todavía no están activas en este despliegue. La parte de referencia del sitio funciona sin cuenta.",
  signInScriptRequired:
    "Para ingresar se necesita JavaScript. Todo lo demás en este sitio funciona sin él.",
  navGarage: "Taller",
  garageHeading: "Su taller",
  garageIntro:
    "Cada carro que guarde aquí, con sus fotos y su kilometraje. Nadie más lo ve, salvo que usted lo publique.",
  garageUnavailable:
    "Las cuentas todavía no están activas en este despliegue, así que no hay taller que abrir. La parte de referencia del sitio funciona sin cuenta.",
  garageScriptRequired:
    "Su taller necesita JavaScript: son datos suyos y el navegador los trae después de que usted ingrese. Todo lo demás en este sitio funciona sin él.",
  garageSignedOutHeading: "Ingrese para abrir su taller",
  garageSignedOutBody:
    "El taller pertenece a una cuenta. Para ingresar basta con un enlace enviado a su correo: no hay contraseña que escoger.",
  garageSignInLink: "Ir a la página de ingreso",
  garageLoading: "Abriendo su taller…",
  garageError:
    "No se pudo completar. Inténtelo de nuevo en un momento; no se cambió nada.",
  garageUnreachable:
    "No se pudo abrir su taller: se cayó la conexión, o algo en este navegador bloqueó una parte de la página. Recargue para volver a intentarlo; nada de lo que usted haya guardado se ve afectado.",
  garageVehiclesHeading: "Sus carros",
  garageEmptyHeading: "Todavía no hay carros",
  garageEmptyBody: `Agregue su Montero, Pajero o Shogun y póngale nombre. Al carro alrededor del cual se armó este sitio se le dice ${TRUCK_NAME}.`,
  garageAddVehicle: "Agregar un carro",
  garageOpenVehicle: "Abrir",
  garageEditVehicle: "Editar",
  garageFormNewHeading: "Un carro nuevo",
  garageFormEditHeading: "Edite este carro",
  garageNameLabel: "Cómo le dice usted",
  garageNameHint:
    "El nombre con el que usted llama a este carro. Es suyo: nadie más lo ve hasta que usted publique algo.",
  garageIdentityLegend: "Cuál carro es",
  garageIdentityHint:
    "Es lo que permite que los repuestos, los procedimientos y las fallas se ajusten a su carro. Solo hace falta la generación; si no está seguro, deje lo demás sin responder.",
  garageFacetUnknown: "Todavía no lo sé",
  garageOdometerLabel: "Kilometraje",
  garageOdometerHint:
    "La lectura tal como está hoy. Se guarda una sola vez y se muestra en la unidad que usted escoja.",
  garageOdometerUnitLabel: "Unidad del kilometraje",
  garageUnitKilometres: "Kilómetros",
  garageUnitMiles: "Millas",
  garageSave: "Guardar el carro",
  garageSaving: "Guardando…",
  garageSaved: "Guardado.",
  garageCancel: "Cancelar",
  garageDelete: "Eliminar este carro",
  garageDeleting: "Eliminando…",
  garageDeleteConfirmTemplate:
    "¿Eliminar {name}? Se van con él sus fotos y todo lo que tenga anotado, y eso no se puede deshacer.",
  garageIssueNameRequired: "Póngale un nombre al carro.",
  garageIssueNameTooLongTemplate: "Ese nombre pasa de {max} caracteres.",
  garageIssueGenerationRequired: "Escoja la generación.",
  garageIssueIdentityUnknown:
    "Esa no es una combinación que la taxonomía conozca. Escoja de nuevo en las listas.",
  garageIssueYearRange: "Escoja un año de la lista.",
  garageIssueOdometerNumber:
    "Escriba el kilometraje en dígitos, o deje el campo vacío.",
  garageIssueOdometerLarge:
    "Esa lectura pasa de cualquier kilometraje que el sitio acepte.",
  garageBackToVehicles: "Todos los carros",
  garageStatEntries: "Fichas",
  garageStatPlanned: "Pendiente",
  garageStatUnrecorded: "Sin registrar",
  garageTabsLabel: "Vistas del taller",
  garageTabTimeline: "Bitácora",
  garageTabCurrent: "Estado actual",
  garageTabPlanned: "Trabajo pendiente",
  garageTimelineEmpty: "Todavía no hay nada anotado en este carro.",
  garageCurrentEmpty:
    "La hoja de estado actual se calcula con lo que usted anote, así que se va llenando sola.",
  garagePlannedEmpty: "Todavía no hay nada pendiente en este carro.",
  garageCurrentOdometerHeading: "Última lectura en sus fichas",
  garageCurrentOdometerOnTemplate: "Anotada el {date}.",
  garageCurrentOdometerUnknown:
    "Todavía ninguna ficha de este carro trae una lectura del kilometraje.",
  garageCurrentOdometerContradiction:
    "Una ficha anterior marca más que esta. Las dos quedan tal como usted las escribió.",
  garageCurrentServiceHeading: "Historial de servicio",
  garageCurrentServiceHint:
    "Una línea por cada entrada de referencia que usted haya enlazado a una ficha, primero la que lleva más tiempo sin tocarse. El sitio no sabe cuándo toca ninguna: solo sabe lo que usted anotó.",
  garageCurrentServiceEmpty:
    "Todavía no hay nada. Este historial se arma con las fallas, los repuestos y los procedimientos que usted enlace a una ficha.",
  garageCurrentServiceLastTemplate: "Última vez el {date}",
  garageCurrentServiceSinceTemplate: "{distance} desde entonces",
  garageCurrentServiceSinceUnknown:
    "no se sabe cuánto ha corrido desde entonces",
  garageCurrentOpenHeading: "Pendientes",
  garageCurrentOpenOverdueTemplate: "Con la fecha vencida: {count}",
  garageCurrentOpenUpcomingTemplate: "Por delante: {count}",
  garageDerivedLoading: "Calculando esto con sus fichas…",
  garageDerivedUnavailable:
    "Esta vista se calcula con sus fichas, y no se pudieron cargar. Nada de lo que aparece aquí dice algo sobre el carro.",
  garagePlannedQueueNote:
    "En el orden de las fechas que usted puso, primero las que ya pasaron. El sitio no manda recordatorios.",
  garagePlannedOverdueHeading: "Con la fecha vencida",
  garagePlannedUpcomingHeading: "Por delante",
  garagePlannedEstimateHeading: "Lo que usted estimó",
  garagePlannedEstimateTimeLabel: "Tiempo",
  garagePlannedEstimateCostLabel: "Costo",
  garagePlannedEstimateCoverageTemplate:
    "A partir de {counted} de {total} fichas pendientes.",
  garagePlannedEstimateNone:
    "Todavía ninguna ficha pendiente trae un estimado.",
  garagePlannedEstimateCurrencyNote:
    "Los montos se suman por moneda y nunca se convierten de una a otra.",
  garagePhotosHeading: "Fotos",
  garagePhotosEmpty: "Todavía no hay fotos.",
  garagePhotosAdd: "Agregar una foto",
  garagePhotosUploading: "Subiendo…",
  garagePhotoAltTemplate: "Foto de {name}",
  garagePhotoRemove: "Quite esta foto",
  garagePhotoTypeRejected:
    "Ese archivo no es una imagen de las que el sitio guarda. Sirven JPEG, PNG, WebP, AVIF y HEIC.",
  garagePhotoSizeRejectedTemplate: "Esa foto pasa de {size}.",
  garagePhotosPrivateNote:
    "Las fotos quedan en almacenamiento privado. Nadie sin su sesión puede abrir una, y los enlaces que usa esta página se vencen solos.",
  garageUseForBrowsing: "Ver el sitio como este carro",
  garageUsedForBrowsing: "El sitio está filtrado para este carro.",
  garageIdentityIncomplete:
    "Indique el mercado, el año y el motor para filtrar el sitio con este carro.",
  garageRecordsTestimonyNote:
    "Estas son sus propias anotaciones sobre su propio carro, tal como usted las escribió. El sitio no las verifica ni las presenta nunca como datos de referencia.",
  garageRecordAdd: "Agregar una ficha",
  garageRecordEdit: "Editar esta ficha",
  garageRecordNewHeading: "Una ficha nueva",
  garageRecordEditHeading: "Edite esta ficha",
  garageRecordSave: "Guardar la ficha",
  garageRecordDelete: "Eliminar esta ficha",
  garageRecordDeleteConfirmTemplate:
    "¿Eliminar «{title}»? Se van con ella sus facturas, y eso no se puede deshacer.",
  garageRecordDateLabel: "Fecha",
  garageRecordKindLabel: "Tipo de ficha",
  garageRecordKindWork: "Trabajo hecho",
  garageRecordKindReceipt: "Factura",
  garageRecordKindNote: "Nota",
  garageRecordKindPlan: "Pendiente",
  garageRecordTitleLabel: "Qué fue",
  garageRecordTitleHint:
    "Una línea que usted reconozca después: «Cambio de bujes de barra estabilizadora».",
  garageRecordNotesLabel: "Notas",
  garageRecordNotesHint:
    "Lo que valga la pena recordar: qué encontró, qué haría distinto. Escríbalo en el idioma en el que usted piensa.",
  garageRecordCostLabel: "Costo",
  garageRecordCurrencyLabel: "Moneda",
  garageRecordTimeLabel: "Cuánto tomó",
  garageRecordTimeUnitLabel: "Unidad de tiempo",
  garageUnitHours: "Horas",
  garageUnitMinutes: "Minutos",
  garageRecordOdometerLabel: "Kilometraje de ese día",
  garageRecordOdometerHint:
    "Lo que marcaba el kilometraje cuando pasó esto, si usted lo anotó. No cambia la lectura actual del carro.",
  garageStatusDone: "hecho",
  garageStatusPlanned: "pendiente",
  garageChipTimeLabel: "Tiempo",
  garageChipCostLabel: "Costo",
  garageChipOdometerLabel: "Kilometraje",
  garageChipReceiptsLabel: "Facturas",
  garageReferencesLegend: "Enlace la ficha con la referencia",
  garageReferencesHint:
    "Las fallas, los repuestos y el procedimiento que ocupó este trabajo. Enlazarlos es lo que después permite que su ficha y la referencia se encuentren.",
  garageReferencesEmpty:
    "Todavía no hay entradas de referencia que enlazar. Las fichas que guarde ahora se pueden enlazar cuando las haya.",
  garageReferenceProblemsLabel: "Fallas",
  garageReferencePartsLabel: "Repuestos",
  garageReferenceProceduresLabel: "Procedimientos",
  garageReferenceProblemTemplate: "falla: {name}",
  garageReferencePartTemplate: "repuesto: {name}",
  garageReferenceProcedureTemplate: "procedimiento: {name}",
  garageReferenceUnresolved:
    "Esta entrada ya no está en la referencia. Su ficha la conserva tal como usted la guardó.",
  garageRecordIssueDate: "Indique la fecha en que pasó, en año-mes-día.",
  garageRecordIssueDateRange:
    "Esa fecha queda fuera de lo que el sitio acepta.",
  garageRecordIssueKind: "Escoja qué tipo de ficha es.",
  garageRecordIssueTitleRequired: "Diga en una línea qué es esta ficha.",
  garageRecordIssueTitleLongTemplate:
    "Esa línea pasa de {max} caracteres. El campo de notas tiene espacio para el resto.",
  garageRecordIssueNotesLongTemplate: "Esas notas pasan de {max} caracteres.",
  garageRecordIssueCost: "Escriba el costo en dígitos, o deje el campo vacío.",
  garageRecordIssueCostSeparator:
    "Esa cifra se puede leer de dos maneras. Escríbala sin separadores de miles: 1500, o 1500,50.",
  garageRecordIssueCostLarge: "Ese costo pasa de lo que el sitio acepta.",
  garageRecordIssueTime: "Escriba el tiempo en dígitos, o deje el campo vacío.",
  garageRecordIssueTimeLarge:
    "Eso pasa del tiempo que el sitio registra para un solo trabajo.",
  garageRecordIssueReferences:
    "Una de las entradas de referencia escogidas ya no está en el sitio. Quítele la selección y guarde de nuevo.",
  garageReceiptCountsUnavailable:
    "Sus fichas están aquí, pero la página no pudo revisar cuáles tienen factura, así que abajo no se muestra ningún conteo de facturas. Abra una ficha para ver las suyas. Casi siempre se arregla recargando.",
  garageReceiptsHeading: "Facturas",
  garageReceiptsEmpty: "Esta ficha no tiene facturas adjuntas.",
  garageReceiptsPrivateNote:
    "Las facturas quedan en almacenamiento privado. Nadie sin su sesión puede abrir una, y los enlaces que usa esta página se vencen solos.",
  garageReceiptsNeedRecord:
    "Guarde primero la ficha; después puede adjuntarle sus facturas.",
  garageReceiptFileLabel: "El archivo",
  garageReceiptVendorLabel: "De dónde es",
  garageReceiptDateLabel: "Fecha de la factura",
  garageReceiptAmountLabel: "Monto",
  garageReceiptAttach: "Adjuntar la factura",
  garageReceiptUploading: "Subiendo…",
  garageReceiptOpen: "Abrir",
  garageReceiptRemove: "Quitar",
  garageReceiptRemoveConfirm:
    "¿Quitar esta factura? El archivo se va con ella, y eso no se puede deshacer.",
  garageReceiptTypeRejected:
    "Ese archivo no es de los que el sitio guarda. Sirven JPEG, PNG, WebP, HEIC y PDF.",
  garageReceiptSizeRejectedTemplate: "Ese archivo pasa de {size}.",
  garageReceiptIssueVendorLong: "Ese nombre es muy largo para el campo.",
  garageReceiptIssueDate:
    "Indique la fecha de la factura en año-mes-día, o déjela vacía.",
  garageReceiptUntitled: "Factura",
  garageMediaHeading: "Fotos, videos y notas de voz",
  garageMediaEmpty: "Esta ficha no tiene nada más adjunto.",
  garageMediaPrivateNote:
    "Esto se guarda en almacenamiento privado, igual que las facturas de arriba. Nadie sin su sesión puede abrirlo, y los enlaces que usa esta página vencen solos.",
  garageMediaNeedRecord:
    "Guarde primero la ficha; después puede adjuntarle fotos, videos y notas de voz.",
  garageMediaFileLabel: "El archivo",
  garageMediaHint:
    "Cualquier cosa que documente el trabajo y no sea una factura: una foto de la pieza que falló, un video del ruido, la nota de voz que le mandó el taller.",
  garageMediaAttach: "Adjuntar el archivo",
  garageMediaUploading: "Subiendo…",
  garageMediaOpen: "Abrir",
  garageMediaRemove: "Quitar",
  garageMediaRemoveConfirm:
    "¿Quitar este adjunto? El archivo se va con él, y eso no se puede deshacer.",
  garageMediaTypeRejected:
    "Ese archivo no es de los que el sitio guarda aquí. Sirven fotos, videos y audio; una factura va en la sección de arriba.",
  garageMediaSizeRejectedTemplate: "Ese archivo pasa de {size}.",
  garageMediaLabelPhotoTemplate: "Foto {index}",
  garageMediaLabelVideoTemplate: "Video {index}",
  garageMediaLabelAudioTemplate: "Nota de voz {index}",
  vehicleSelectorLabel: "Su vehículo",
  vehicleSelectorIdle: "Está viendo todos los vehículos",
  vehicleSelectorOpen: "Elija su vehículo",
  vehicleSelectorChange: "Cambie de vehículo",
  vehicleSelectorPanelLabel: "¿Cuál carro tiene usted?",
  vehicleSelectorClear: "Olvide este vehículo",
  vehicleSelectorReset: "Limpiar",
  vehicleSelectorApply: "Guardar el vehículo",
  vehicleSelectorGenerationLabel: "Generación",
  vehicleSelectorMarketLabel: "Mercado",
  vehicleSelectorYearLabel: "Año",
  vehicleSelectorEngineLabel: "Motor",
  vehicleSelectorDriveLabel: "Tracción",
  vehicleSelectorDriveAny: "No lo he indicado",
  vehicleSelectorFilterNote:
    "Conforme usted elige, se descartan las combinaciones que la taxonomía da por inexistentes.",
  vehicleSelectorEnginesRecorded: "Registrados para esta combinación",
  vehicleSelectorEnginesUnrecorded: "Sin registrar — pudieron haber existido",
  vehicleSelectorNoEngines:
    "Todavía no hay ningún motor registrado para esa combinación.",
  vehicleFitCountTemplate: "{shown} de {total} le sirven a su carro",
  vehicleFilteredTag: "descartada",
  vehicleDoesNotFitLabel: "No le sirve al vehículo que usted eligió",
  vehicleProvisionalLabel: "Coincidencia provisional",
  vehicleProvisionalNote:
    "La coincidencia se hizo solo con generación, mercado, año y motor. Las entradas marcadas como provisionales dependen además de algún dato que usted no nos ha dado, así que algunas no le van a servir a su carro. Si afina su selección, la marca desaparece.",
  vehicleProvisionalDetailTemplate:
    "Esta entrada depende además de datos que usted no ha indicado: {facets}.",
  navParts: "Repuestos",
  partsHeading: "Repuestos",
  partsIntro:
    "Números de parte para la Montero, la Pajero y la Shogun, con los números que los reemplazaron, los equivalentes de otras marcas que vale la pena conocer y de dónde salió cada número.",
  partsEmpty: "Todavía no se ha publicado ningún número de parte.",
  partsNoResults: "Ningún repuesto coincide con estos filtros.",
  partsCountTemplate: "{shown} de {total} repuestos",
  partsFilterSystemLabel: "Filtre por sistema",
  partsFilterSystemAll: "Todos los sistemas",
  partsOemNumberLabel: "Número de parte original",
  partsQuantityTemplate: "{count} por carro",
  partsFitsLabel: "Le sirve a",
  partsCurrentBadge: "Pida este",
  partsSupersededBadge: "Reemplazado",
  partsSupersessionUnknownBadge: "Verifique antes de pedir",
  partsSupersessionHeading: "Cadena de reemplazos",
  partsSupersessionIntro:
    "Cada número fue reemplazado por el siguiente. Solo el último se puede pedir hoy.",
  partsSupersessionOldestLabel: "Número más viejo",
  partsSupersessionCurrentLabel: "Número vigente",
  partsSupersessionForkNote:
    "Varios números viejos fueron reemplazados por el mismo número, así que la cadena de abajo es una rama entre varias. Estos otros números se unen en el mismo punto:",
  partsCrossReferencesHeading: "Equivalentes de otras marcas",
  partsCrossReferenceBrandLabel: "Marca",
  partsCrossReferenceNumberLabel: "Número de la marca",
  partsCrossReferenceQualityLabel: "Veredicto",
  partsCrossReferenceNoteLabel: "Lo que sabemos",
  partsVendorsHeading: "Dónde conseguirlo",
  partsVendorsIntro:
    "Vendedores tomados del directorio de comunidades. Nadie paga por aparecer aquí y en esta página no hay enlaces de afiliado.",
  partsBackToIndex: "Todos los repuestos",

  navMods: "Modificaciones",
  modsHeading: "Modificaciones",
  modsIntro:
    "Lo que cada modificación le exige al carro antes de montarla, y lo que " +
    "le cuesta después. Aquí no se vende nada: los contras son el punto.",
  modsEmpty: "Todavía no se ha documentado ninguna modificación.",
  modsNoResults: "Ninguna modificación coincide con estos filtros.",
  modsCountTemplate: "{shown} de {total} modificaciones",
  modsFilterSystemLabel: "Filtre por sistema",
  modsFilterSystemAll: "Todos los sistemas",
  modsFilterImpactLabel: "Filtre por consecuencia",
  modsFilterImpactAll: "Cualquier consecuencia",
  modsFitsLabel: "Le sirve a",
  modsBackToIndex: "Todas las modificaciones",
  modsDifficultyTemplate: "Dificultad {value}/{max}",
  modsCostLabel: "Costo",
  modsRequiresHeading: "Lo que hay que tener antes",
  modsRequiresIntro:
    "Cada cosa de esta lista tiene que estar puesta en el carro, o en sus " +
    "manos, antes de que esta modificación tenga sentido.",
  modsRequiresNone: "No hay que hacer nada antes.",
  modsRequiresUnresolvedLabel: "Todavía sin documentar",
  modsAffectsHeading: "Lo que daña o afecta",
  modsAffectsIntro:
    "Todo lo de abajo es consecuencia de montar esto, no un argumento en " +
    "contra. Léalo antes de comprar, no después.",
  modsAffectsNone: "Todavía no se ha documentado nada afectado por esto.",
  modsAffectsSystemLabel: "Sistema",
  modsAffectsImpactLabel: "Consecuencia",
  modsAffectsNoteLabel: "Qué pasa",
  modsTradeoffsHeading: "Los contras, sin adornos",
  modsAffectsCountTemplate: "{count} afectados",
  "modImpact.breaks": "Deja de servir",
  "modImpact.degrades": "Empeora",
  "modImpact.needs-adjustment": "Hay que reajustarlo",
  "modReferenceCollection.mods": "Modificación",
  "modReferenceCollection.parts": "Repuesto",

  "crossReferenceQuality.oem-supplier": "Del mismo fabricante que el original",
  "crossReferenceQuality.equivalent": "Reportado como equivalente",
  "crossReferenceQuality.lower-grade": "Sirve, pero reportan que dura menos",
  "crossReferenceQuality.avoid": "Evítelo",
  "drive.2wd": "Tracción sencilla",
  "drive.4wd": "Doble tracción",
  "fitmentFacet.transmission": "la transmisión",
  "fitmentFacet.transferCase": "la caja de transferencia",
  "fitmentFacet.trim": "el nivel de equipamiento",
  "fitmentFacet.drive": "la tracción",
  navProblems: "Problemas",
  problemsHeading: "Problemas",
  problemsIntro:
    "Empiece por lo que está haciendo el carro. Cada entrada dice qué se puede hacer con seguridad en este momento, qué revisar, cuál suele ser la causa y qué implica la reparación.",
  problemsEmpty: "Todavía no hay problemas documentados.",
  problemsCountTemplate: "{shown} de {total} problemas",
  problemsSearchLabel: "Busque síntomas y problemas",
  problemsSearchPlaceholder:
    "Busque un síntoma — ruido de rechinido, cambios duros…",
  problemsSymptomIndexLabel: "Explore por síntoma",
  problemsSymptomIndexAll: "Todos los síntomas",
  problemsNoResults: "Ningún problema coincide con ese síntoma o esa búsqueda.",
  problemBreadcrumbLabel: "Ruta de navegación",
  problemSymptomsHeading: "Síntomas",
  problemDiagnosticsHeading: "Pasos de diagnóstico",
  problemCausesHeading: "Causas probables",
  problemFixPathsHeading: "Rutas de reparación",
  sourcesHeading: "Fuentes",
  sourceAccessedTemplate: "Consultada el {date}",
  problemRulesInLabel: "Apunta a",
  problemRulesOutLabel: "Descarta",
  problemNoCauses: "Todavía no se ha establecido la causa de fondo.",
  problemNoDiagnostics:
    "Todavía no hay un procedimiento de diagnóstico escrito.",
  problemNoFixPaths:
    "Todavía no hay una ruta de reparación documentada para este problema. Queda pendiente.",
  problemDifficultyTemplate: "Dificultad {value}/{max}",
  problemCostLabel: "Costo",
  problemPartsLabel: "Repuestos",
  problemProceduresLabel: "Procedimientos",
  sourceArchiveLabel: "copia archivada",
  problemTriageLabel: "¿Puede manejarlo?",
  safetyNoticeLabelTemplate: "Aviso de seguridad — {system}.",
  safetyCriticalChipLabel: "Crítico para la seguridad",
  safetyNoticeBody:
    "Esto afecta un sistema crítico para la seguridad. Material de referencia únicamente: en trabajos críticos para la seguridad, consulte a un mecánico calificado.",
  confidenceCaveatTemplate:
    "{tier}. Esta entrada no se apoya en documentación de fábrica — tome los valores y los pasos como punto de partida, no como si vinieran del manual de fábrica.",
  problemProvisionalSafetyNote:
    "Esto es crítico para la seguridad y la coincidencia con su carro es apenas provisional: se hizo solo con generación, mercado, año y motor. Afine su selección, y confirme contra su propio vehículo, antes de actuar con base en esta página.",
  "sourceKind.fsm": "Manual de servicio de fábrica",
  "sourceKind.tsb": "Boletín de servicio",
  "sourceKind.manufacturer": "Documentación del fabricante",
  "sourceKind.forum": "Foro de dueños",
  "sourceKind.video": "Video de reparación o de preparación",
  "sourceKind.vendor": "Catálogo de proveedor",
  "sourceKind.reference": "Obra de referencia",
  "sourceKind.first-hand": "De primera mano",
  "severity.safety-critical": "Crítico para la seguridad",
  "severity.damaging": "Daña otras piezas",
  "severity.stranding": "Lo puede dejar varado",
  "severity.degrading": "Funciona peor",
  "severity.cosmetic": "Cosmético",
  "drivability.drive-normally": "Maneje normalmente",
  "drivability.drive-gently-repair-soon": "Maneje con cuidado — repare pronto",
  "drivability.do-not-drive": "No lo maneje",
  "drivability.tow-only": "Solo en grúa",
  "costBand.minimal": "La reparación más barata",
  "costBand.moderate": "Repuestos y una tarde de trabajo",
  "costBand.significant": "Una pieza mayor o una factura de taller",
  "costBand.major": "Buena parte de lo que vale el carro",
};

export const ui: Record<Locale, UiStrings> = { en, es };

/** UI strings for `locale`. The only supported way for a component to get text. */
export function t(locale: Locale): UiStrings {
  return ui[locale];
}

/**
 * The label for a glossary system id. The only supported way to read one —
 * so the `glossarySystem.` key prefix exists in exactly one place.
 */
export function glossarySystemLabel(
  strings: UiStrings,
  system: GlossarySystem
): string {
  return strings[`glossarySystem.${system}`];
}

/** The label for a community type id — the only supported way to read one. */
function isTranslatableCommunityType(
  type: CommunityType
): type is TranslatableCommunityType {
  return (TRANSLATABLE_COMMUNITY_TYPES as readonly CommunityType[]).includes(
    type
  );
}

export function communityTypeLabel(
  strings: UiStrings,
  type: CommunityType
): string {
  return isTranslatableCommunityType(type)
    ? strings[`communityType.${type}`]
    : COMMUNITY_TYPE_BRAND_NAMES[type];
}

/** The label for an activity level id. */
export function communityActivityLabel(
  strings: UiStrings,
  level: ActivityLevel
): string {
  return strings[`communityActivity.${level}`];
}

/** The label for a generation id, in the short "Gen N" / "Generación N" form. */
export function generationLabel(strings: UiStrings, gen: GenerationId): string {
  return strings[`generation.${gen}`];
}

/** The label for a `DRIVE_TYPES` value — the selector's drive control. */
export function driveLabel(strings: UiStrings, drive: DriveType): string {
  return strings[`drive.${drive}`];
}

/**
 * The label for one facet the visitor may have left unanswered, as named by
 * `provisionalMatchFacets` in `src/lib/fitment/`.
 */
export function fitmentFacetLabel(
  strings: UiStrings,
  facet: OptionalSelectionFacet
): string {
  return strings[`fitmentFacet.${facet}`];
}

/** The label for a source kind id — the only supported way to read one. */
export function sourceKindLabel(strings: UiStrings, kind: SourceKind): string {
  return strings[`sourceKind.${kind}`];
}

/** The label for a `PROBLEM_SEVERITIES` value (T401's severity chip). */
export function problemSeverityLabel(
  strings: UiStrings,
  severity: ProblemSeverity
): string {
  return strings[`severity.${severity}`];
}

/**
 * The label for a `DRIVABILITY_STATES` value (PRB-05).
 *
 * Read once per locale on every problem page, not once for the page locale:
 * the triage banner is the one surface the spec requires in **both** languages
 * regardless of which page a reader is on.
 */
export function drivabilityLabel(
  strings: UiStrings,
  state: DrivabilityState
): string {
  return strings[`drivability.${state}`];
}

/** The accessible name of a cost band, beside its `$` glyphs. */
export function costBandLabel(strings: UiStrings, band: CostBand): string {
  return strings[`costBand.${band}`];
}

/** The label for a confidence tier id. */
export function confidenceTierLabel(
  strings: UiStrings,
  tier: ConfidenceTier
): string {
  return strings[`confidenceTier.${tier}`];
}

/**
 * The label for a cross-reference verdict (PRT-01) — the only supported way to
 * read one, so the `crossReferenceQuality.` prefix exists in one place.
 */
export function crossReferenceQualityLabel(
  strings: UiStrings,
  quality: CrossReferenceQuality
): string {
  return strings[`crossReferenceQuality.${quality}`];
}

/**
 * The label for a `MOD_IMPACTS` value (MOD-01) — the only supported way to
 * read one, so the `modImpact.` prefix exists in exactly one place.
 */
export function modImpactLabel(strings: UiStrings, impact: ModImpact): string {
  return strings[`modImpact.${impact}`];
}

/**
 * The label for the collection half of a typed reference (MOD-02) — the word
 * that tells a reader whether a prerequisite is something to buy or something
 * to do.
 */
export function modReferenceCollectionLabel(
  strings: UiStrings,
  collection: ModReferenceCollection
): string {
  return strings[`modReferenceCollection.${collection}`];
}

/**
 * The confidence caveat AGENTS.md requires below `tsb`, in `strings`' own
 * locale, with the tier's translated name interpolated.
 *
 * A function rather than a `.replace()` at each call site: the caveat is
 * rendered in *both* locales on every page that shows it (the rule is
 * textual — "a visible caveat in both languages" — not page-scoped), so the
 * interpolation happens at least twice per entry and every caller has to get
 * the tier label from the same locale as the sentence around it.
 */
export function confidenceCaveat(
  strings: UiStrings,
  tier: ConfidenceTier
): string {
  return strings.confidenceCaveatTemplate.replace(
    "{tier}",
    confidenceTierLabel(strings, tier)
  );
}

/**
 * The label for a `links[]` entry's kind: a bare platform proper noun
 * (`Facebook`, `Discord`) for the kinds `LINK_KIND_BRAND_NAMES` names, and
 * translated prose for the rest (`website`, `forum`, `map`) — see
 * `src/i18n/community-brand-names.ts` for why the two are split.
 */
function isTranslatableLinkKind(kind: LinkKind): kind is TranslatableLinkKind {
  return (TRANSLATABLE_LINK_KINDS as readonly LinkKind[]).includes(kind);
}

export function communityLinkKindLabel(
  strings: UiStrings,
  kind: LinkKind
): string {
  return isTranslatableLinkKind(kind)
    ? strings[`communityLinkKind.${kind}`]
    : LINK_KIND_BRAND_NAMES[kind];
}

/** Every locale's strings, for pages that are not scoped to one locale (404, root). */
export const allUi: readonly { locale: Locale; strings: UiStrings }[] =
  LOCALES.map((locale) => ({ locale, strings: ui[locale] }));
