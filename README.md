# Smart FormSense

*Intelligent Form Filling & QA Testing*

Smart FormSense is a Tampermonkey userscript for authorized form filling and QA testing with synthetic test data. It combines fast completion-first form automation with a safe, non-destructive QA audit for form readiness checks.

## Current version

**17.9.0**

## Two modes

### ⚡ Form Filling

- Fill **Minimum Required Fields** or **Fill All Fields**
- Preserve existing user-entered values by default
- Understand fields using labels, placeholders, attributes, table context, options, constraints, and validation messages
- Repair many common validation failures where possible
- Support native controls, dynamic/custom controls, dependent fields, and embedded/cross-origin forms
- Keep required file uploads and other genuinely manual actions as **Manual Required**
- Provide Validate, Recheck & Correct, Stop, Undo, New Applicant, and Debug Export tools

### 🧪 QA Testing

- Run a **non-destructive QA Audit** without submitting the form or deliberately injecting invalid values
- Produce a weighted **Form Readiness** score that accounts for passed checks and finding severity instead of allowing repeated low-severity findings to collapse the score
- Summarize **Critical**, **Warning**, **Observation**, and **Checks Passed** results
- Detect native, ARIA, and common framework/custom required-field signals while treating visual-only required markers as manual confirmation points rather than automatic configuration failures
- Audit radio groups once instead of reporting each option separately
- Use stronger row/column context for academic and table-based field labels
- Check required-field consistency, field clarity, contradictory constraints, dropdown/dependency readiness, current validation state, duplicate IDs, and manual QA requirements
- Group repeated findings in the panel and keep findings navigable to the affected field when supported
- Support embedded/cross-origin forms through the existing child-frame agent bridge
- Export a human-readable **HTML QA Report** with score, risk summary, grouped findings, affected fields, guidance, and printable details
- Export a separate **QA Debug JSON** with detailed field signals, constraints, validity information, runtime diagnostics, and the standard Smart FormSense debug data for troubleshooting

The QA readiness score is an advisory testing aid, not a production certification.

## Installation

Public installation is available through Greasy Fork:

https://greasyfork.org/en/scripts/592133-smart-form-filler

The stable public userscript filename remains:

`Smart_Form_Filler.user.js`

This filename is intentionally retained so the existing GitHub → Greasy Fork source sync continues without changing the public source URL.

Every public production code change must increment the userscript `@version` metadata.

## Usage

1. Install Tampermonkey in a supported browser.
2. Install Smart FormSense from Greasy Fork.
3. Open a form you are authorized to test.
4. Activate **Smart FormSense** from the Tampermonkey menu.
5. Use **⚡ Form Filling** for completion assistance or **🧪 QA Testing** for the readiness audit.
6. Review any errors, QA findings, review fields, or manual-required fields before proceeding manually.

## Safety

Smart FormSense is intended for authorized QA, testing, staging, demo, and development workflows. It generates synthetic test data, preserves existing values by default, and does not intentionally submit the final form.

## Creator

Created with love ❤️ **Akash Singh**  
**akash.singh@meritto.com**
