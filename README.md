# Smart Form Filler

Smart Form Filler is a generic Tampermonkey userscript for authorized QA/testing of web forms with synthetic test data.

## Current version

**17.7.0**

## What it does

- Fills required fields or all supported fields
- Preserves existing user-entered values by default
- Uses labels, placeholders, attributes, table context, options, constraints, and validation messages to understand fields
- Repairs common validation failures where possible
- Supports native controls and common dynamic/custom form controls
- Supports embedded and cross-origin forms through top-page/child-frame userscript agents
- Marks required file uploads and other genuinely manual actions as **Manual Required**
- Provides Fill, Validate, Recheck & Correct, Stop, Undo, New Applicant, and Debug Export tools
- Does not intentionally submit the final form

## Installation

Public installation will be provided through Greasy Fork after the repository setup is complete.

The stable public userscript filename is:

`Smart_Form_Filler.user.js`

Every public production code change must increment the userscript `@version` metadata.

## Usage

1. Install Tampermonkey in a supported browser.
2. Install Smart Form Filler.
3. Open a form you are authorized to test.
4. Activate **Smart Form Filler** from the Tampermonkey menu.
5. Choose **Minimum Required Fields** or **Fill All Fields**.
6. Review any errors, review fields, or manual-required fields before proceeding manually.

## Intended use

Smart Form Filler is intended for authorized QA, testing, staging, demo, and development workflows. It generates synthetic test data and leaves final submission to the tester.

## Creator

Created with love ❤️ **Akash Singh**  
**akash.singh@meritto.com**
