# Changelog

Recent notable public changes to Smart FormSense are documented here. The repository commit history remains the source of truth for intermediate historical patches that predate the current maintained release notes.

## 17.25.0

Embedded-form lifecycle and modal-interaction reliability fix.

- Isolated Smart FormSense panel pointer/click/touch events so host-page outside-click handlers do not normally treat panel interaction as a page click
- Required a fresh iframe/frame-agent response during embedded-form discovery instead of trusting a recently cached agent
- Added a pre-command liveness acknowledgement before Fill, Validate, Recheck, QA, and embedded Undo actions
- Added an active embedded-form watchdog that pings the frame while a remote action is running
- If the iframe closes or disappears, Smart FormSense now stops safely within a few seconds instead of waiting for the full remote-command timeout
- Stale embedded agents are dropped after an unsuccessful discovery pass
- Remote results with `ok: false` are now surfaced as failures instead of being treated as successful completion
- Existing form-filling logic, synthetic-data rules, existing-value protection, Stop, Undo, analytics, sharing, and final-submit/payment safety behavior remain unchanged

## 17.24.0

Public update-source reliability fix.

- Moved in-product update discovery from the repository raw URL to the public Greasy Fork JSON API
- Added Greasy Fork API access permission for version checks
- Changed source `@updateURL` / `@downloadURL` metadata to the public Greasy Fork userscript endpoint
- Kept the in-product Update action on the public Greasy Fork page
- Changed automatic update-check cadence from 12 hours to 24 hours
- Removed the remaining browser-side dependency on the private/raw GitHub source for update discovery
- Existing form-filling, QA, safety, analytics, sharing, iframe, Stop, Undo, and final-submit protection behavior is unchanged

## 17.23.0

Update-flow reliability fix.

- Changed the in-product **Update Smart FormSense** action to open the public Greasy Fork page instead of the raw GitHub userscript URL
- Kept GitHub raw source only for lightweight version checking
- Recomputed update visibility from the current runtime version instead of trusting stale cached availability state
- Prevented a stale/invalid update action from opening when Smart FormSense is already current
- Removed the false assumption that returning from the update tab means installation succeeded
- After returning from Greasy Fork, Smart FormSense now tells the user to reload only if they actually completed the Tampermonkey update
- Existing form-filling, QA, safety, analytics, sharing, iframe, Stop, Undo, and final-submit protection behavior is unchanged

## 17.22.0

Maintenance/documentation release.

- Refreshed the production version from **17.21.0** to **17.22.0** in all current userscript version references
- Corrected an outdated PostHog source comment that still implied analytics were disabled until configuration; anonymous PostHog analytics were already configured and live
- Kept the existing PostHog project host/configuration and privacy model unchanged
- Refreshed `README.md` to describe the current Auto Form Filler, Auto QA Testing, compact panel, Share, update flow, feedback, Developer Mode, creator thoughts, shortcuts, and analytics privacy rules
- Brought the changelog forward through the recent production releases
- No intended runtime feature or form-mutation behavior changes
- Existing no-final-submit, existing-value protection, synthetic-data, iframe/cross-origin, Stop, and Undo safety behavior remains unchanged

## 17.21.0

Compact-panel release.

- Reduced vertical screen usage across the Smart FormSense panel without removing functionality
- Tightened hero/header spacing, title/tagline spacing, profile/zoom controls, body padding, tabs, mode row, progress, stage text, stat cards, primary/secondary controls, status, help/legend, creator footer, creator-thought row, and QA surfaces
- Preserved the minimal-primary-surface approach so less-frequent configuration stays in Settings/modals
- Kept the Shadow DOM panel architecture and existing runtime/safety behavior intact

## 17.20.0

Creator personality release.

- Added a pool of **60 curated Smart FormSense thoughts** in the footer
- Added a **4-hour** thought rotation interval
- Added manual `↻` shuffle
- Prevented immediate consecutive repeats
- Stored thought state locally through Tampermonkey storage
- Manual shuffle resets the 4-hour interval
- Kept creator identity fixed while only the thought changes
- Explicitly kept creator thoughts out of Settings
- Explicitly kept thought changes/shuffles out of PostHog analytics

## 17.19.0

Sharing and analytics release.

- Added the compact Share menu
- Added **Email**, **Copy Link**, **WhatsApp**, and **Microsoft Teams** share channels
- Added comma-separated recipient handling and recipient validation for Email
- Added default mail-handler flow with Gmail web-compose fallback
- Kept final send under user control
- Added colorful channel identities while retaining a compact UI
- Added anonymous privacy-first PostHog product analytics
- Added local anonymous installation identity with People profiles disabled
- Added product events covering first run, sessions, mode selection, Fill/QA starts, sharing, updates/settings/feedback/version flows, and related operational usage
- Kept form values, entered personal data, passwords/OTPs, payment data, synthetic QA values, full URLs/query strings, and share-recipient emails out of analytics
- Added/finished the hidden Developer Mode flow and developer-only controls
- Polished the share menu and email fallback before the final production cleanup

## 17.18.2

Update apply-flow fix.

- Improved the update flow after Tampermonkey installs a newer version
- Added/clarified the reload step needed for an already-open page to run the newly installed userscript

## 17.18.1

Update-cache reliability fix.

- Fixed update-check caching behavior so current/latest version state refreshes more reliably

## 17.18.0

UI polish release.

- Refined panel header/window controls and icon treatment
- Improved feedback modal interaction, selected-state clarity, hover/close behavior, and success presentation
- Continued visual polish around update availability and panel controls
- Updated current-version references throughout reports/debug/runtime output

## 17.17.0

Smart FormSense branding and product-services refinement release.

- Returned the product name to **Smart FormSense** after the temporary v17.16 naming experiment
- Added the production `@updateURL` and `@downloadURL` flow pointing to the main userscript
- Added automatic update-check configuration and current/latest version infrastructure
- Added Formspree-backed in-product feedback support
- Added `GM_xmlhttpRequest` and required connection permissions for product services
- Continued settings migration and report/runtime version consistency work
- Preserved the existing final manual-submission safeguards

## 17.16.0

Temporary naming and core-behavior/settings refinement release.

- Temporarily renamed the product to **Auto Form Filler and Auto QA Testing**; later releases returned to **Smart FormSense**
- Clarified the product description around automatic form filling and functional QA
- Promoted panel position and dependency handling to core behavior instead of ordinary user preferences
- Removed/ignored legacy stored settings for those concepts during settings merge
- Added notification-duration configuration
- Expanded QA field diagnostics and detailed validation evidence, including whether an action was clicked where recorded
- Continued report branding/version updates

## 17.15.0

Major UX/settings/report refinement release.

- Added settings migration work and new general defaults
- Added completion notifications and default-workspace behavior
- Improved live counter/status recomputation after Undo, New Applicant, trusted edits, and other state changes
- Added panel-scale/status-refresh state used by later UI refinements
- Expanded the human-readable QA report with grouped **Detailed Validation** evidence
- Added exact tested value, trigger, expected behavior, observed behavior, and grouped pass/fail presentation where available
- Preserved the existing form-filling and final-submission safety model

## 17.10.0

Black-box functional QA release.

- Reframed QA from a static readiness/configuration scan into **applicant-side functional testing of the finished form**
- Added reversible field snapshots so QA can temporarily test values and restore the original state after each case
- Added functional mandatory-field checks that exercise blank values and observe user-facing validation without automatically submitting the form
- Added semantic positive/negative test cases for email, mobile, pincode, names, percentage/CGPA, passing year, and date fields where safe
- Added boundary tests for configured maxlength/min/max constraints
- Added dropdown selection tests and radio/checkbox interaction tests
- Added safe dependency probes for common **Country → State → District → City** chains, restoring the original parent/child values after testing
- Changed read-only datepicker handling so widget-controlled date fields are no longer treated as automatic critical failures
- Added explicit Review/manual cases for datepicker UI, file uploads, and journey-only validation that cannot be proven safely without user progression/submission
- Added a **Functional QA Score** based on actual executed test cases
- Updated QA terminology to **Failed / Warning / Review / Passed** and changed the main action to **Run Functional QA**
- Updated the HTML QA report to describe reproduced functional failures and safe black-box testing rather than backend/readiness configuration findings
- Preserved the separate QA Debug export for detailed troubleshooting
- Embedded/cross-origin forms now use the same functional QA engine through the child-frame bridge
- Final form submission remains manual and is never invoked automatically

## 17.9.0

QA accuracy and reporting refinement release.

- Reworked the **Form Readiness** score to use weighted issue severity alongside passed checks, preventing repeated low-severity observations from incorrectly collapsing healthy forms to 0/100
- Expanded required-field detection to include native `required`, ARIA, and common framework/custom validation attributes and classes
- Changed visual-only required markers to **Observations** that request functional confirmation instead of automatically treating them as configuration warnings
- Audited radio groups once instead of generating duplicate findings for each option
- Improved field naming for academic and table layouts by using stronger row/column context
- Added smarter handling for dependent disabled required fields, hidden/inactive required fields, required file uploads, and duplicate IDs
- Grouped repeated QA findings in the panel for easier review
- Renamed the positive counter to **Checks Passed** for clearer meaning
- Added a human-readable, printable **HTML QA Report** with score, risk level, summary, grouped findings, affected fields, guidance, and plain-language severity explanations
- Added a separate **QA Debug JSON** export containing detailed per-field required signals, constraints, validation state, runtime information, and standard Smart FormSense diagnostics for troubleshooting
- Added QA Debug export support for embedded/cross-origin form execution contexts
- Form Filling behavior and final manual-submission safeguards remain unchanged

## 17.8.0

Smart FormSense dual-mode release.

- Rebranded the product from **Smart Form Filler** to **Smart FormSense**
- Added the tagline **Intelligent Form Filling & QA Testing**
- Introduced separate **Form Filling** and **QA Testing** workspaces in one panel
- Preserved the existing form-filling workflow and controls
- Added a safe, non-destructive **Run QA Audit** workflow
- Added a **Form Readiness** score with Critical, Warning, Observation, and Passed summaries
- Added QA checks for required-field consistency, field clarity, contradictory constraints, dropdown/dependency readiness, current validation state, and manual QA requirements
- Added clickable QA findings that navigate to the related field when supported
- Added embedded/cross-origin QA Audit support through the existing child-frame agent bridge
- Added structured **Export QA Report** output
- Updated debug/report branding to Smart FormSense v17.8
- Final form submission remains manual

## 17.7.0

Production baseline before the Smart FormSense rebrand.

- Generic Smart Form Filler branding
- Completion-first synthetic form filling
- Minimum Required Fields and Fill All Fields modes
- Validation-aware diagnostics and repair
- Responsive Stop behavior with cooperative UI yielding
- Academic row/column intelligence and chronology safeguards
- Repeating-row uniqueness handling
- Dynamic/dependent control support
- Embedded and cross-origin iframe agent architecture
- Debug export and runtime error reporting
- Undo, New Applicant, counters, and counter navigation
- Required file uploads remain Manual Required
- Final form submission remains manual
