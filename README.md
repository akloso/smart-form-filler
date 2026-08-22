# Smart FormSense

*Intelligent Form Filling & QA Testing*

Smart FormSense is a Tampermonkey userscript for authorized form filling and black-box functional QA with synthetic test data. It combines fast completion-first form automation with applicant-side QA that safely exercises the finished form without touching backend configuration or automatically submitting the final form.

## Current version

**17.10.0**

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

- Run **black-box functional QA** from the applicant/user point of view instead of auditing backend implementation choices
- Temporarily exercise fields with relevant blank, valid, invalid, and boundary values, then restore the original state after each test
- Test mandatory-field behaviour, valid/invalid input handling, dropdown selection, radio/checkbox interaction, and common numeric/text boundaries
- Use field semantics to generate relevant cases for email, mobile, pincode, percentage/CGPA, names, passing years, and dates where safe
- Probe common dependency chains such as **Country → State → District → City** and report whether child fields react to parent changes
- Recognize read-only datepicker controls as widget-driven fields instead of automatically treating them as broken
- Keep file uploads, datepicker UI details, and journey-only validation as explicit review/manual test cases where browser restrictions or no-submit safety prevent a reliable automated conclusion
- Produce a **Functional QA Score** based on executed test cases
- Summarize **Failed**, **Warning**, **Review**, and **Passed** test cases
- Keep findings navigable to the affected field when supported
- Support embedded/cross-origin forms through the existing child-frame agent bridge
- Export a human-readable **HTML Functional QA Report**
- Export a separate **QA Debug JSON** with detailed field/test/runtime diagnostics for troubleshooting

Smart FormSense never automatically performs the final submission. Functional QA temporarily changes field state only for safe test execution and restores values afterward.

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
5. Use **⚡ Form Filling** for completion assistance or **🧪 QA Testing** for black-box functional testing.
6. Review reproduced failures, warnings, review/manual cases, and the exported report before go-live approval.

## Safety

Smart FormSense is intended for authorized QA, testing, staging, demo, and development workflows. It generates synthetic test data, preserves/restores user state during QA where supported, and does not intentionally submit the final form.

## Creator

Created with love ❤️ **Akash Singh**  
**akash.singh@meritto.com**
