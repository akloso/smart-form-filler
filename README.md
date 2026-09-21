# Smart FormSense

*Intelligent Form Filling & QA Testing*

Smart FormSense is a Tampermonkey userscript for authorized form filling and black-box functional QA with synthetic test data. It combines completion-first form automation with applicant-side testing that exercises the finished form safely from the user perspective.

## Current production version

**17.25.0**

v17.25.0 hardens embedded/cross-origin form handling. Smart FormSense now isolates panel interactions from host-page outside-click handlers, requires a fresh iframe response before routing an action, watches active embedded forms for disappearance, and fails quickly and safely if an embedded form closes or becomes unavailable.

## Core product rules

These rules are intentionally treated as product invariants:

- **No active command = no field writes.** Opening a page or opening Smart FormSense must not silently mutate a form.
- Final **Submit / Payment / Finalize / Complete** actions remain manual.
- Meaningful existing user-entered values are preserved by default.
- Undo should reverse Smart FormSense-owned changes without destroying later manual edits.
- Generated identities and values are synthetic and are used only during explicit Fill/QA actions.
- File uploads remain manual.
- CAPTCHA is never solved automatically.

## Two workspaces

### ⚡ Auto Form Filler

Smart FormSense understands the form and fills it with synthetic test data when the user explicitly starts a fill action.

- **Minimum Required Fields** — completes the minimum meaningful set needed for progression.
- **Fill All Fields** — attempts all relevant fields while protecting existing meaningful values and manual-only controls.
- Uses labels, placeholders, IDs/names, nearby text, row/column context, options, required signals, native constraints, validation messages, current state, and dependency relationships to understand fields.
- Supports text inputs, dropdowns, radios, checkboxes, custom controls, repeating rows, academic/table layouts, delayed DOM updates, and dynamic/dependent fields.
- Includes **Validate**, **Recheck & Correct**, **Stop**, **Undo**, **New Applicant**, navigation counters, and debug export.
- Supports embedded and cross-origin forms through the existing top-page/child-frame bridge.

### 🧪 Auto QA Testing

QA is **black-box applicant-side functional testing**, not a backend configuration audit.

Where safe, Smart FormSense can exercise:

- required/blank behavior
- valid, invalid, and boundary values
- email, mobile, pincode, names, percentage/CGPA, passing years, and dates
- min/max/maxlength constraints
- dropdowns, radios, and checkboxes
- dependency chains such as **Country → State → District → City**
- safe Next/Continue progression when needed to trigger meaningful validation

QA temporarily changes field state, observes actual behavior, and restores the original state where supported. If something cannot be proven safely—such as a widget restriction, file upload, datepicker detail, or journey-only check—it is reported as **Review/manual** instead of being invented as a failure.

QA outcomes distinguish:

- **Failed / blocker**
- **Warning**
- **Review/manual**
- **Passed**

Reports can include the field, test name, exact test value, trigger, whether an action was clicked, expected behavior, observed behavior, and outcome. Smart FormSense can export a human-readable HTML QA report and QA Debug JSON.

## Compact panel

The v17.21 compact-panel release reduced vertical screen usage without removing product functionality. The current panel keeps the primary surface small and pushes less-frequent configuration into Settings/modals.

The visible panel uses Shadow DOM to reduce CSS collisions with host websites.

## Sharing

The Share menu supports:

- **Email** — accepts one or more comma-separated recipients and prepares a draft; the user performs the final send.
- **Copy Link** — copies the public Smart FormSense installation link.
- **WhatsApp** — opens a prepared share message.
- **Microsoft Teams** — opens a prepared Teams chat/draft.

Recipient email addresses are never sent to analytics.

## Updates

Public installation and updates use Greasy Fork:

`https://greasyfork.org/en/scripts/592133-smart-form-filler`

Smart FormSense checks the public Greasy Fork JSON API for the currently published version. Automatic checks run at most once per 24 hours; **Check for Updates** can still be run manually.

The source metadata `@updateURL` and `@downloadURL` also point to the public Greasy Fork userscript endpoint. Greasy Fork may rewrite these metadata keys when publishing, which is expected.

When an update is available, **Update Smart FormSense** opens the Greasy Fork page. Complete the Tampermonkey update there, then reload any already-open form page so the new userscript version is injected.

## Feedback

Smart FormSense includes an in-product feedback flow for category/rating/message and optional contact email. Feedback is separate from form contents.

## Developer Mode

Developer Mode is intentionally hidden from the normal surface.

- Click the displayed version **5 times** to enable Developer Mode for **1 hour**.
- Click the version **5 times** again while enabled to disable it.
- Developer-only debug controls become visible while Developer Mode is active.

## Creator thoughts

The footer includes a small rotating Smart FormSense thought above the fixed creator identity.

- 60 curated thoughts
- 4-hour rotation
- manual `↻` shuffle
- no immediate consecutive repeat
- locally persisted state
- no Settings option
- no PostHog event for thought changes

## Analytics and privacy

Smart FormSense uses privacy-first anonymous PostHog product analytics. A random local installation ID is used and People profiles are disabled.

Analytics may include safe operational metadata such as:

- anonymous installation ID
- Smart FormSense version
- mode
- counts and duration
- hostname
- share channel
- timestamps

Smart FormSense analytics must never send:

- form field values
- names or email addresses entered in forms
- phone numbers
- Aadhaar or PAN values
- passwords or OTPs
- payment information
- synthetic QA values
- full URLs or query strings
- Share recipient email addresses

## Installation

Public installation is available through Greasy Fork:

https://greasyfork.org/en/scripts/592133-smart-form-filler

The stable public userscript filename remains:

`Smart_Form_Filler.user.js`

This filename is intentionally retained so the existing GitHub → Greasy Fork source path remains stable.

## Usage

1. Install Tampermonkey in a supported browser.
2. Install Smart FormSense from Greasy Fork.
3. Open a form you are authorized to fill/test.
4. Open Smart FormSense.
5. Use **⚡ Auto Form Filler** for form completion assistance or **🧪 Auto QA Testing** for applicant-side functional QA.
6. Review any failures, warnings, review/manual items, and reports before making a final manual submission or go-live decision.

## Default keyboard shortcuts

`PRIMARY` means **Ctrl** on Windows/Linux and **Command** on macOS.

| Action | Shortcut |
| --- | --- |
| Open / Minimize | `PRIMARY + ALT + M` |
| Settings | `PRIMARY + ALT + S` |
| Fill Form | `PRIMARY + ALT + F` |
| Validate | `PRIMARY + ALT + V` |
| Recheck | `PRIMARY + ALT + C` |
| Stop | `PRIMARY + ALT + X` |
| Undo | `PRIMARY + ALT + Z` |
| New Applicant | `PRIMARY + ALT + N` |
| Run QA | `PRIMARY + ALT + Q` |
| Report | `PRIMARY + ALT + R` |

## Safety

Smart FormSense is intended for authorized QA, testing, staging, demo, development, and legitimate form-filling workflows. It does not automatically complete irreversible final submission/payment/finalization actions.

## Creator

Created with love ❤️ **Akash Singh**  
**akash.singh@meritto.com**
