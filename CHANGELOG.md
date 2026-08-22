# Changelog

All notable public changes to Smart FormSense are documented here.

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
