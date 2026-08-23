from pathlib import Path

PATH = Path('Smart_Form_Filler.user.js')
text = PATH.read_text(encoding='utf-8')

if '// @version      17.12.0' not in text:
    raise SystemExit('Expected Smart FormSense v17.12.0 source')


def replace_block(src: str, start: str, end: str, replacement: str) -> str:
    a = src.find(start)
    if a < 0:
        raise AssertionError(f'start marker not found: {start}')
    b = src.find(end, a)
    if b < 0:
        raise AssertionError(f'end marker not found: {end}')
    return src[:a] + replacement.rstrip() + '\n\n' + src[b:]


def replace_once(src: str, old: str, new: str, label: str) -> str:
    count = src.count(old)
    if count != 1:
        raise AssertionError(f'{label} matched {count} times')
    return src.replace(old, new, 1)


# Version / stale debug branding.
text = text.replace('// @version      17.12.0', '// @version      17.12.1', 1)
text = text.replace("'17.12.0'", "'17.12.1'")
text = text.replace('v17.12.0', 'v17.12.1')
text = text.replace('V17.11', 'V17.12.1')
text = text.replace("productVersion:\n        '17.9.0'", "productVersion:\n        '17.12.1'")
text = text.replace("productVersion: '17.9.0'", "productVersion: '17.12.1'")


SEMANTIC_BLOCK = r'''  const qaSemanticFor = el => {
    const type = normalize(el?.type);
    const ownContext = normalize([
      qaHumanLabel(el),
      el?.name,
      el?.id,
      el?.getAttribute?.('placeholder'),
      tableHeaderContext(el),
      tableRowLabelContext(el)
    ].filter(Boolean).join(' '));

    if (type === 'file') return 'file';
    if (/percentage.*cgpa|cgpa.*percentage/.test(ownContext)) return 'marks_metric';
    if (/email|e mail/.test(ownContext)) return 'email';
    if (/mobile|phone|contact number|telephone/.test(ownContext)) return 'mobile';
    if (/aadhaar|aadhar/.test(ownContext)) return 'aadhaar';
    if (/pin code|pincode|postal|zip/.test(ownContext)) return 'pincode';
    if (/percentage|percent/.test(ownContext)) return 'percentage';
    if (/cgpa/.test(ownContext)) return 'cgpa';
    if (/date of birth|birth date|\bdob\b/.test(ownContext)) return 'dob';
    if (/year of passing|passing year|pass year|completion year/.test(ownContext)) return 'passing_year';
    if (/first name|middle name|last name|full name|father.*name|mother.*name|guardian.*name|applicant name|parent name/.test(ownContext)) return 'name';
    if (/mother tongue|native language|first language|language spoken/.test(ownContext)) return 'language';
    if (/country/.test(ownContext)) return 'country';
    if (/state|province/.test(ownContext)) return 'state';
    if (/district/.test(ownContext)) return 'district';
    if (/city|town/.test(ownContext)) return 'city';

    if (['radio', 'checkbox'].includes(type)) return '';

    const snapshot = debugFieldSnapshot(el);
    if (snapshot?.semantic && snapshot.confidence !== 'low') {
      return normalize(snapshot.semantic);
    }

    // Do not let a broad form heading overpower the field's own label.
    // Low-confidence semantics are still available in Export Debug, but QA
    // falls back to a generic field check instead of choosing the wrong test.
    return '';
  };'''

text = replace_block(
    text,
    '  const qaSemanticFor = el => {',
    '  const qaCleanLabel = (label, el = null) => {',
    SEMANTIC_BLOCK,
)


CLICK_BLOCK = r'''  const qaClickJourneyButton = async (button, fields = []) => {
    const before = qaJourneyState();
    const beforeValidation = qaValidationDigest(fields);
    const form = button?.form || button?.closest?.('form') || null;
    let submitAttempted = false;

    const observeSubmit = () => {
      submitAttempted = true;
    };

    try { form?.addEventListener('submit', observeSubmit, true); } catch {}
    try { button.click(); } catch {}

    const started = Date.now();
    let after = qaJourneyState();
    let afterValidation = qaValidationDigest(
      visibleFillableFields().filter(el => !isLikelyInternalField(el))
    );

    while (Date.now() - started < 2600) {
      await sleep(180);
      after = qaJourneyState();
      const currentFields = visibleFillableFields().filter(el => !isLikelyInternalField(el));
      afterValidation = qaValidationDigest(currentFields);
      const progressed = before.url !== after.url || before.keys !== after.keys;
      const validationChanged = beforeValidation.signature !== afterValidation.signature;
      if (progressed || validationChanged) {
        await sleep(260);
        after = qaJourneyState();
        afterValidation = qaValidationDigest(
          visibleFillableFields().filter(el => !isLikelyInternalField(el))
        );
        break;
      }
    }

    try { form?.removeEventListener('submit', observeSubmit, true); } catch {}

    const beforeKeys = new Set(
      beforeValidation.entries.map(item => `${item.fieldKey || ''}|${normalize(item.text)}`)
    );
    const newValidationEntries = afterValidation.entries.filter(
      item => !beforeKeys.has(`${item.fieldKey || ''}|${normalize(item.text)}`)
    );

    return {
      before,
      after,
      submitAttempted,
      progressed: before.url !== after.url || before.keys !== after.keys,
      buttonText: qaButtonText(button),
      validationBefore: beforeValidation,
      validationAfter: afterValidation,
      newValidationEntries,
      waitedMs: Date.now() - started
    };
  };'''

text = replace_block(
    text,
    '  const qaClickJourneyButton = async button => {',
    '  const qaFeedbackQuality = text => {',
    CLICK_BLOCK,
)


VALIDATION_BLOCK = r'''  const qaValidationMessageText = node =>
    String(node?.innerText || node?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 320);

  const qaValidationLooksRelevant = text =>
    /required|mandatory|invalid|please\s+(?:enter|select|choose)|must|minimum|maximum|digit|character|format|not\s+valid|not\s+allowed|cannot|error/i.test(
      String(text || '')
    );

  const qaMapValidationNodeToField = (node, fields) => {
    const list = (fields || []).filter(el => el?.isConnected);
    if (!node || !list.length) return null;

    try {
      const forId = String(node.getAttribute?.('for') || '').trim();
      if (forId) {
        const direct = list.find(el => String(el.id || '') === forId);
        if (direct) return direct;
      }
    } catch {}

    try {
      const nodeId = String(node.id || '').trim();
      if (nodeId) {
        const described = list.find(el =>
          String(el.getAttribute?.('aria-describedby') || '')
            .split(/\s+/)
            .includes(nodeId)
        );
        if (described) return described;
      }
    } catch {}

    let cursor = node;
    for (let depth = 0; cursor && depth < 6; depth++, cursor = cursor.parentElement) {
      try {
        if (list.includes(cursor)) return cursor;
        const direct = cursor.querySelector?.(
          'input:not([type="hidden"]),select,textarea'
        );
        if (direct && list.includes(direct)) return direct;
      } catch {}
    }

    try {
      let sibling = node.previousElementSibling;
      for (let i = 0; sibling && i < 3; i++, sibling = sibling.previousElementSibling) {
        if (list.includes(sibling)) return sibling;
        const nested = sibling.querySelector?.('input:not([type="hidden"]),select,textarea');
        if (nested && list.includes(nested)) return nested;
      }
    } catch {}

    return null;
  };

  const qaValidationDigest = fields => {
    const list = (fields || []).filter(el => el?.isConnected);
    const entries = new Map();

    const add = (el, text, source = 'field') => {
      const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 320);
      if (!clean || !qaValidationLooksRelevant(clean)) return;
      const key = el ? fieldKey(el) : '';
      const signature = `${key}|${normalize(clean)}`;
      if (entries.has(signature)) return;
      entries.set(signature, {
        field: el ? qaCleanLabel(qaHumanLabel(el), el) : 'Form-level validation',
        fieldKey: key || null,
        text: clean,
        source
      });
    };

    for (const el of list) {
      const feedback = qaVisibleFeedback(el);
      if (feedback.invalid) add(el, feedback.text || 'Validation error', 'field');
    }

    const selectors = [
      '.error',
      '.errors',
      '.invalid-feedback',
      '.field-error',
      '.form-error',
      '.error-message',
      '.help-block',
      '.text-danger',
      '.validation-error',
      '.parsley-errors-list',
      'label.error',
      '[role="alert"]',
      '[aria-live="assertive"]'
    ].join(',');

    try {
      for (const doc of collectDocuments()) {
        for (const node of doc.querySelectorAll(selectors)) {
          if (!isVisible(node)) continue;
          const message = qaValidationMessageText(node);
          if (!qaValidationLooksRelevant(message)) continue;
          const el = qaMapValidationNodeToField(node, list);
          add(el, message, 'page');
        }
      }
    } catch {}

    const output = [...entries.values()];
    return {
      count: output.length,
      signature: output
        .map(item => `${item.fieldKey || ''}:${normalize(item.text)}`)
        .sort()
        .join('|'),
      entries: output
    };
  };'''

text = replace_block(
    text,
    '  const qaValidationDigest = fields => {',
    '  const qaWaitForManualProgress = async (fields, timeoutMs = 15000) => {',
    VALIDATION_BLOCK,
)


# Make manual-assisted progression compare exact validation entries, not just counts.
old_manual = r'''        if (progressed || validationChanged || (clickedAt && Date.now() - clickedAt >= 900)) {
          return {
            observed: true,
            clickedText,
            progressed,
            beforeValidation,
            afterValidation,
            waitedMs: Date.now() - started
          };
        }'''
new_manual = r'''        if (progressed || validationChanged || (clickedAt && Date.now() - clickedAt >= 900)) {
          const beforeKeys = new Set(
            beforeValidation.entries.map(item => `${item.fieldKey || ''}|${normalize(item.text)}`)
          );
          const newValidationEntries = afterValidation.entries.filter(
            item => !beforeKeys.has(`${item.fieldKey || ''}|${normalize(item.text)}`)
          );
          return {
            observed: true,
            clickedText,
            progressed,
            beforeValidation,
            afterValidation,
            newValidationEntries,
            waitedMs: Date.now() - started
          };
        }'''
text = replace_once(text, old_manual, new_manual, 'manual progression evidence')


# Strict select choices: placeholder-only dropdowns must never pass option QA.
SELECT_BLOCK = r'''  const qaIsPlaceholderOption = option => {
    if (!option || option.disabled) return true;
    const value = String(option.value ?? '').trim();
    const label = String(option.textContent || option.label || '').replace(/\s+/g, ' ').trim();
    if (!value) return true;
    return /^(?:select|choose|please\s+(?:select|choose)|--+|select\s+one|choose\s+one|select\s+option|choose\s+option)(?:\s|$)/i.test(label);
  };

  const qaRealSelectOptions = el => {
    if (!el || el.tagName !== 'SELECT') return [];
    return [...el.options].filter(option => !qaIsPlaceholderOption(option));
  };

  const qaRunSelectInteractionCase = async el => {
    const options = qaRealSelectOptions(el);
    if (!options.length) {
      return {
        status: 'review',
        actual: 'No real selectable choice is currently available; only an empty or placeholder option was found.'
      };
    }

    const snapshot = qaSnapshotFieldValue(el);
    const current = String(el.value ?? '');
    const target = options.find(option => String(option.value) !== current) || options[0];

    el.value = target.value;
    qaDispatchInteraction(el);
    await sleep(120);

    const retained = String(el.value ?? '') === String(target.value);
    const feedback = qaVisibleFeedback(el);

    await qaRestoreFieldValue(el, snapshot);

    return {
      status: retained && !feedback.invalid ? 'passed' : 'failed',
      actual: retained
        ? (feedback.invalid ? `A real option was selected, but validation remained: ${feedback.text}` : 'A real dropdown option could be selected and retained.')
        : 'A real dropdown option could not be selected or retained.'
    };
  };'''

text = replace_block(
    text,
    '  const qaRunSelectInteractionCase = async el => {',
    '  const qaRunToggleCase = async el => {',
    SELECT_BLOCK,
)

# Dependency QA should also ignore placeholder-only options.
dep_a = text.find('  const qaSelectStateSignature = el => [')
dep_b = text.find('  const qaRunJourneyChecks = async (fields, candidates) => {', dep_a)
if dep_a < 0 or dep_b < 0:
    raise AssertionError('dependency QA block markers missing')
dep_segment = text[dep_a:dep_b].replace('validOptions(', 'qaRealSelectOptions(')
text = text[:dep_a] + dep_segment + text[dep_b:]


JOURNEY_BLOCK = r'''  const qaRunJourneyChecks = async (fields, candidates) => {
    const rows = [];
    if (state.stopRequested) return rows;

    const liveFields = (fields || []).filter(el => el?.isConnected && !isLikelyInternalField(el));
    const buttons = qaFindJourneyButtons();
    const button = buttons.safe[0];

    if (!button) {
      if (buttons.protectedFinal.length || buttons.other.length) {
        const manual = await qaWaitForManualProgress(liveFields, 15000);
        if (manual.observed) {
          const newEntries = Array.isArray(manual.newValidationEntries)
            ? manual.newValidationEntries
            : [];
          rows.push({
            status: manual.progressed || newEntries.length > 0 ? 'passed' : 'review',
            name: 'Manual Continue / Submit check',
            actual: manual.progressed
              ? `Your ${manual.clickedText || 'form action'} click moved the form forward and Smart FormSense detected the new step.`
              : newEntries.length > 0
                ? `Your ${manual.clickedText || 'form action'} click triggered validation on ${newEntries.length} field(s).`
                : 'A form action was clicked, but progression or fresh validation could not be confirmed.',
            evidence: {
              method: 'manual-assisted-journey',
              clickedText: manual.clickedText,
              progressed: manual.progressed,
              validationBefore: manual.beforeValidation.count,
              validationAfter: manual.afterValidation.count,
              validationEntries: newEntries,
              waitedMs: manual.waitedMs
            }
          });
        } else {
          rows.push({
            status: 'review',
            name: 'Continue / Submit needs a manual click',
            actual: buttons.protectedFinal.length
              ? 'The available progression action looks like a final Submit or transaction action, so Smart FormSense left the click to the user.'
              : 'Smart FormSense could not identify a safe progression button automatically.',
            evidence: { method: 'manual-assisted-journey', waitedMs: manual.waitedMs }
          });
        }
      } else {
        rows.push({
          status: 'review',
          name: 'Continue / Submit action not found',
          actual: 'No visible Continue, Save & Next, Submit or similar form action was detected on this step.'
        });
      }
      return rows;
    }

    const required = liveFields.filter(el => {
      if (normalize(el.type) === 'file' || el.readOnly) return false;
      const signals = qaRequiredSignals(el);
      return signals.visible || signals.configured || isRequired(el);
    });

    if (required.length) {
      const snapshots = required.map(el => [el, qaSnapshotFieldValue(el)]);

      for (const el of required) {
        if (el.tagName === 'SELECT') {
          const placeholder = [...el.options].find(option =>
            !option.disabled &&
            (!String(option.value || '').trim() || /^(?:select|choose|please select|--)/i.test(String(option.textContent || '').trim()))
          );
          if (placeholder) el.value = placeholder.value;
          else el.selectedIndex = -1;
        } else if (normalize(el.type) === 'checkbox') {
          el.checked = false;
        } else if (normalize(el.type) === 'radio') {
          radioGroupMembers(el).forEach(item => { item.checked = false; });
        } else {
          qaSetNativeLikeValue(el, '');
        }
        qaDispatchInteraction(el);
      }

      const click = await qaClickJourneyButton(button, required);
      const requiredKeys = new Set(required.map(el => fieldKey(el)));
      const mapped = click.validationAfter.entries.filter(
        item => item.fieldKey && requiredKeys.has(item.fieldKey)
      );
      const mappedKeys = new Set(mapped.map(item => item.fieldKey));

      if (click.progressed) {
        rows.push({
          status: 'blocker',
          name: 'Required fields allowed progression',
          actual: 'The form moved forward while required test fields were blank.',
          evidence: {
            method: 'safe-journey-click',
            buttonText: click.buttonText,
            progressed: true,
            validationEntries: mapped
          }
        });
      } else if (mapped.length) {
        rows.push({
          status: 'passed',
          name: 'Required fields block progression',
          actual: `The form stayed on the step and validation was identified for ${mapped.length} required field(s).`,
          evidence: {
            method: 'safe-journey-click',
            buttonText: click.buttonText,
            progressed: false,
            validationEntries: mapped,
            validationFields: mapped.map(item => item.field)
          }
        });

        for (const el of required) {
          if (mappedKeys.has(fieldKey(el))) continue;
          rows.push({
            el,
            status: 'review',
            name: 'Required field still needs confirmation',
            actual: 'The form was blocked, but Smart FormSense could not map a validation message to this required field on this attempt.'
          });
        }
      } else if (click.validationAfter.count > 0) {
        rows.push({
          status: 'review',
          name: 'Required validation appeared but could not be mapped',
          actual: `The form stayed on the step and showed ${click.validationAfter.count} validation message(s), but the messages could not be reliably matched to their fields.`,
          evidence: {
            method: 'safe-journey-click',
            buttonText: click.buttonText,
            progressed: false,
            validationEntries: click.validationAfter.entries
          }
        });
      } else {
        rows.push({
          status: 'review',
          name: 'Required field messages need confirmation',
          actual: 'The form did not move forward, but no clear validation message could be identified after using the progression button.',
          evidence: { method: 'safe-journey-click', buttonText: click.buttonText, progressed: false }
        });
      }

      for (const entry of mapped) {
        if (qaFeedbackQuality(entry.text) !== 'clear') {
          const el = required.find(item => fieldKey(item) === entry.fieldKey) || null;
          rows.push({
            el,
            status: 'review',
            name: 'Validation message could be clearer',
            actual: entry.text || 'Validation was triggered, but the message was missing or too generic.'
          });
        }
      }

      for (const [el, snapshot] of snapshots) {
        if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
      }
      await sleep(250);

      if (click.progressed) return rows;
    }

    for (const candidate of (candidates || []).slice(0, 5)) {
      if (state.stopRequested) break;
      const el = candidate.el;
      if (!el?.isConnected || !button?.isConnected) continue;

      const snapshot = qaSnapshotFieldValue(el);
      const entry = await qaAttemptUserEntry(el, candidate.testCase.value);
      const click = await qaClickJourneyButton(button, liveFields);
      const directFeedback = qaVisibleFeedback(el);
      const mapped = click.validationAfter.entries.find(
        item => item.fieldKey === fieldKey(el)
      );
      const feedbackText = mapped?.text || directFeedback.text || '';

      if (mapped || directFeedback.invalid) {
        rows.push({
          el,
          status: 'passed',
          name: candidate.testCase.label,
          actual: `The form rejected the invalid value when ${click.buttonText || 'Continue'} was used${feedbackText ? `: ${feedbackText}` : '.'}`,
          evidence: {
            method: 'journey-probe',
            attemptedValue: entry.attemptedValue,
            acceptedValue: entry.acceptedValue,
            feedback: feedbackText,
            progressed: click.progressed,
            submitAttempted: click.submitAttempted,
            validationEntries: mapped ? [mapped] : []
          }
        });
      } else if (click.progressed) {
        rows.push({
          el,
          status: 'failed',
          name: candidate.testCase.label,
          actual: `The invalid value ${JSON.stringify(entry.acceptedValue)} was allowed when ${click.buttonText || 'Continue'} was used.`,
          evidence: {
            method: 'journey-probe',
            attemptedValue: entry.attemptedValue,
            acceptedValue: entry.acceptedValue,
            feedback: '',
            progressed: true,
            submitAttempted: click.submitAttempted
          }
        });
      } else {
        rows.push({
          el,
          status: 'review',
          name: candidate.testCase.label,
          actual: 'The form stayed on the step, but validation for this specific value could not be confirmed because another field or rule may be blocking progression first.',
          evidence: {
            method: 'journey-probe',
            attemptedValue: entry.attemptedValue,
            acceptedValue: entry.acceptedValue,
            feedback: '',
            progressed: false,
            submitAttempted: click.submitAttempted,
            validationEntries: click.validationAfter.entries
          }
        });
      }

      if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
      await sleep(180);
      if (click.progressed) break;
    }

    return rows;
  };'''

text = replace_block(
    text,
    '  const qaRunJourneyChecks = async (fields, candidates) => {',
    '  const qaFunctionalCasesFor = el => {',
    JOURNEY_BLOCK,
)


FUNCTIONAL_CASES_BLOCK = r'''  const qaFunctionalCasesFor = el => {
    const type = normalize(el.type);
    const semantic = qaSemanticFor(el);
    const currentYear = new Date().getFullYear();
    const cases = [];

    const add = (id, label, value, expectation, severity = 'warning') => {
      cases.push({ id, label, value, expectation, severity });
    };

    if (semantic === 'email') {
      add('email-invalid', 'Reject malformed email', 'qa.invalid@', 'reject');
      add('email-valid', 'Accept valid email', 'qa.test.user@gmail.com', 'accept');
    } else if (semantic === 'mobile') {
      add('mobile-alpha', 'Reject alphabetic mobile number', '98ABCD1234', 'reject');
      add('mobile-short', 'Reject short mobile number', '98765', 'reject');
      add('mobile-valid', 'Accept valid 10-digit mobile number', '9876543210', 'accept');
    } else if (semantic === 'aadhaar') {
      add('aadhaar-alpha', 'Reject alphabetic Aadhaar value', '12AB56789012', 'reject');
      add('aadhaar-short', 'Reject short Aadhaar value', '12345678901', 'reject');
      add('aadhaar-valid', 'Accept 12-digit Aadhaar format', '123456789012', 'accept');
    } else if (semantic === 'pincode') {
      add('pincode-alpha', 'Reject alphabetic pincode', '11AB01', 'reject');
      add('pincode-short', 'Reject short pincode', '11001', 'reject');
      add('pincode-valid', 'Accept valid 6-digit pincode', '110001', 'accept');
    } else if (semantic === 'percentage') {
      add('percentage-over', 'Reject percentage above 100', '101', 'reject');
      add('percentage-valid', 'Accept valid percentage', '75', 'accept');
    } else if (semantic === 'cgpa') {
      add('cgpa-over', 'Reject CGPA above expected range', '11', 'reject');
      add('cgpa-valid', 'Accept valid CGPA', '8.5', 'accept');
    } else if (semantic === 'passing_year') {
      add('year-future', 'Reject future passing year', String(currentYear + 5), 'reject');
      add('year-valid', 'Accept realistic passing year', String(currentYear - 3), 'accept');
    } else if (semantic === 'dob') {
      if (!el.readOnly) {
        if (type === 'date') {
          add('dob-future', 'Reject future date of birth', `${currentYear + 1}-01-15`, 'reject');
          add('dob-valid', 'Accept realistic date of birth', '2000-01-15', 'accept');
        } else {
          add('dob-invalid', 'Reject impossible date of birth', '31/02/2020', 'reject');
          add('dob-valid', 'Accept realistic date of birth', '15/01/2000', 'accept');
        }
      }
    } else if (semantic === 'name') {
      add('name-numeric', 'Reject numeric-only name', '123456', 'reject');
      add('name-valid', 'Accept normal name', 'Test User', 'accept');
    }

    const maxLength = Number(el.getAttribute?.('maxlength'));
    if (
      Number.isFinite(maxLength) &&
      maxLength > 0 &&
      maxLength <= 120 &&
      !['file', 'radio', 'checkbox'].includes(type)
    ) {
      add(
        'maxlength-boundary',
        `Enforce maximum length of ${maxLength}`,
        'A'.repeat(maxLength + 1),
        'reject',
        'warning'
      );
    }

    if (
      type === 'number' &&
      el.getAttribute?.('max') !== null &&
      el.getAttribute?.('max') !== ''
    ) {
      const max = Number(el.getAttribute('max'));
      if (Number.isFinite(max)) {
        add('number-over-max', `Reject value above maximum ${max}`, String(max + 1), 'reject');
      }
    }

    if (
      type === 'number' &&
      el.getAttribute?.('min') !== null &&
      el.getAttribute?.('min') !== ''
    ) {
      const min = Number(el.getAttribute('min'));
      if (Number.isFinite(min)) {
        add('number-under-min', `Reject value below minimum ${min}`, String(min - 1), 'reject');
      }
    }

    return cases.slice(0, 4);
  };'''

text = replace_block(
    text,
    '  const qaFunctionalCasesFor = el => {',
    '  const qaRunOneFieldCase = async (el, testCase) => {',
    FUNCTIONAL_CASES_BLOCK,
)


# Report terminology: distinguish field coverage, validation coverage and confirmed pass rate.
mark_a = text.find('  const qaMarkReportIncomplete = (report, runState = \'stopped\', reason = \'\') => {')
mark_b = text.find('  const qaFallbackPartialReport = (runState, reason) =>', mark_a)
if mark_a < 0 or mark_b < 0:
    raise AssertionError('incomplete report block markers missing')
mark_segment = text[mark_a:mark_b]
mark_segment = mark_segment.replace('reportVersion: 5', 'reportVersion: 7')
mark_segment = mark_segment.replace('score: 0', 'confirmedPassRate: 0')
mark_segment = mark_segment.replace('coverage: 0', 'validationCoverage: 0')
text = text[:mark_a] + mark_segment + text[mark_b:]

assemble_a = text.find("    const assembleReport = (runState = 'running', stopReason = '') => {")
assemble_b = text.find('    const publishPartial = (runState = \'running\'', assemble_a)
if assemble_a < 0 or assemble_b < 0:
    raise AssertionError('assembleReport markers missing')
assemble_segment = text[assemble_a:assemble_b]
assemble_segment = assemble_segment.replace(
    '      const score = completed ? Math.round(clamp((passed / completed) * 100, 0, 100)) : 0;',
    '      const confirmedPassRate = completed ? Math.round(clamp((passed / completed) * 100, 0, 100)) : 0;'
)
assemble_segment = assemble_segment.replace(
    '      const coverage = checksRun ? Math.round(clamp((completed / checksRun) * 100, 0, 100)) : 0;',
    '      const validationCoverage = checksRun ? Math.round(clamp((completed / checksRun) * 100, 0, 100)) : 0;'
)
assemble_segment = assemble_segment.replace('        coverage,\n        score,', '        validationCoverage,\n        confirmedPassRate,')
assemble_segment = assemble_segment.replace('        reportVersion: 6,', '        reportVersion: 7,')
assemble_segment = assemble_segment.replace('        score,\n        rating,\n        coverage,', '        confirmedPassRate,\n        rating,\n        validationCoverage,')
text = text[:assemble_a] + assemble_segment + text[assemble_b:]


# Add a resolver so a later Next/Continue confirmation closes earlier Review items.
resolver_marker = '    const testField = async (key, el) => {'
resolver = r'''    const resolveEarlierReview = ({
      fieldKeyValue = '',
      category = '',
      name = '',
      actual = ''
    }) => {
      const resolvedIds = new Set();
      for (const row of testCases) {
        if (row.status !== 'review') continue;
        if (fieldKeyValue && row.fieldKey !== fieldKeyValue) continue;
        if (category && row.category !== category) continue;
        if (name && row.name !== name) continue;
        row.status = 'passed';
        if (actual) row.actual = actual;
        resolvedIds.add(row.id);
      }

      if (resolvedIds.size) {
        for (let index = findings.length - 1; index >= 0; index--) {
          if (resolvedIds.has(findings[index]?.testCaseId)) {
            findings.splice(index, 1);
          }
        }
      }

      return resolvedIds.size;
    };

'''
if resolver_marker not in text:
    raise AssertionError('testField marker missing')
text = text.replace(resolver_marker, resolver + resolver_marker, 1)


# Required generic text fields should still get a positive typing check.
old_fallback = r'''        if (testCases.length === beforeCount) {
          if (['text', 'search', 'tel', 'email', 'url', 'number', ''].includes(type) || el.tagName === 'TEXTAREA') {
            const snapshot = qaSnapshotFieldValue(el);
            const result = await qaAttemptUserEntry(el, 'Test');
            const accepted = String(result.acceptedValue || '').length > 0;
            await qaRestoreFieldValue(el, snapshot);
            addCase({
              el,
              category: 'Basic Field Behaviour',
              name: 'Basic input interaction',
              status: accepted ? 'passed' : 'review',
              expected: 'The field accepts normal applicant input and can return to its original value.',
              actual: accepted ? 'Normal input could be entered and the original value was restored.' : 'Smart FormSense could not confirm normal input behaviour.',
              evidence: { method: result.method, attemptedValue: result.attemptedValue, acceptedValue: result.acceptedValue, restored: true }
            });
          } else {
            addCase({
              el,
              category: 'Basic Field Behaviour',
              name: 'Field availability',
              status: 'passed',
              expected: 'The field is visible and available to the applicant.',
              actual: `${label} was detected and remained available during QA.`
            });
          }
        }'''
new_fallback = r'''        const textLikeForBasic =
          ['text', 'search', 'tel', 'email', 'url', 'number', ''].includes(type) ||
          el.tagName === 'TEXTAREA';

        if (functionalCases.length === 0 && textLikeForBasic) {
          const snapshot = qaSnapshotFieldValue(el);
          const result = await qaAttemptUserEntry(el, 'Test');
          const accepted = String(result.acceptedValue || '').length > 0;
          await qaRestoreFieldValue(el, snapshot);
          addCase({
            el,
            category: 'Basic Field Behaviour',
            name: 'Basic input interaction',
            status: accepted ? 'passed' : 'review',
            expected: 'The field accepts normal applicant input and can return to its original value.',
            actual: accepted ? 'Normal input could be entered and the original value was restored.' : 'Smart FormSense could not confirm normal input behaviour.',
            evidence: { method: result.method, attemptedValue: result.attemptedValue, acceptedValue: result.acceptedValue, restored: true }
          });
        } else if (testCases.length === beforeCount) {
          addCase({
            el,
            category: 'Basic Field Behaviour',
            name: 'Field availability',
            status: 'passed',
            expected: 'The field is visible and available to the applicant.',
            actual: `${label} was detected and remained available during QA.`
          });
        }'''
text = replace_once(text, old_fallback, new_fallback, 'generic positive field check')


# Use journey evidence to resolve earlier Review rows rather than showing both.
old_journey_loop = r'''        for (const row of rows) {
          addCase({
            el: row.el || null,
            category: 'Journey Validation',
            name: row.name,
            status: row.status,
            expected: 'The form should stop incorrect/incomplete data and allow valid data to move to the next step.',
            actual: row.actual,
            evidence: row.evidence || null,
            guidance: row.status === 'failed'
              ? 'Review the affected form validation and rerun this journey check.'
              : row.status === 'review'
                ? 'Use the form Continue/Submit action once and confirm the expected validation or progression.'
                : ''
          });
        }'''
new_journey_loop = r'''        for (const row of rows) {
          addCase({
            el: row.el || null,
            category: 'Journey Validation',
            name: row.name,
            status: row.status,
            expected: 'The form should stop incorrect/incomplete data and allow valid data to move to the next step.',
            actual: row.actual,
            evidence: row.evidence || null,
            guidance: row.status === 'failed' || row.status === 'blocker'
              ? 'Review the affected form validation and rerun this journey check.'
              : row.status === 'review'
                ? 'Use the form Continue/Submit action once and confirm the expected validation or progression.'
                : ''
          });

          if (row.status === 'passed') {
            const validationEntries = Array.isArray(row.evidence?.validationEntries)
              ? row.evidence.validationEntries
              : [];

            for (const entry of validationEntries) {
              if (!entry?.fieldKey) continue;
              resolveEarlierReview({
                fieldKeyValue: entry.fieldKey,
                category: 'Mandatory Validation',
                name: 'Required-field behaviour',
                actual: `Confirmed on form progression: ${entry.text || 'required validation appeared.'}`
              });
            }

            if (row.el && row.name) {
              resolveEarlierReview({
                fieldKeyValue: fieldKey(row.el),
                category: 'Input Validation',
                name: row.name,
                actual: row.actual
              });
            }
          }
        }'''
text = replace_once(text, old_journey_loop, new_journey_loop, 'journey review resolver')


REPORT_BLOCK = r'''  const buildQaFriendlyHtml = report => {
    const qa = report || state.qaReport;
    if (!qa) return '';

    const esc = qaEscapeHtml;
    const grouped = qaGroupedFindings(qa);
    const confirmed = grouped.filter(item => ['critical', 'warning'].includes(item.severity));
    const reviewRaw = grouped.filter(item => item.severity === 'observation');
    const passed = Number(qa.counts?.passed || 0);
    const checksRun = Number(qa.checksRun || 0);
    const detectedCount = Number(qa.fieldsAudited || 0);
    const checkedCount = Number(qa.fieldsChecked || 0);
    const fieldCoverage = Number(
      qa.fieldCoverage ?? qa.summary?.fieldCoverage ??
      (detectedCount ? Math.round((checkedCount / detectedCount) * 100) : 0)
    );

    const generated = (() => {
      try { return new Date(qa.generatedAt).toLocaleString(); }
      catch { return qa.generatedAt || ''; }
    })();

    const friendlyReview = new Map();
    const putReview = (key, title, what, action, fields = []) => {
      const current = friendlyReview.get(key) || { title, what, action, fields: [] };
      current.fields.push(...(fields || []));
      friendlyReview.set(key, current);
    };

    for (const item of reviewRaw) {
      const text = `${item.category || ''} ${item.title || ''}`.toLowerCase();
      if (/validation message could be clearer/.test(text)) {
        putReview('messages', 'Validation messages could be clearer', 'The form blocked the applicant, but one or more messages were too short or generic.', 'Check that each message clearly tells the applicant what needs to be corrected.', item.fields);
      } else if (/mandatory validation|required-field|required field/.test(text)) {
        putReview('required', 'Required fields still need confirmation', 'These required fields were not individually confirmed by the form-level validation check.', 'Use Continue/Submit with these fields empty and make sure each one is caught before the applicant can proceed.', item.fields);
      } else if (/mobile/.test(text)) {
        putReview('mobile', 'Mobile number validation needs confirmation', 'Invalid or short mobile numbers could be typed without an immediate error.', 'Make sure invalid and short mobile numbers are rejected before the applicant can continue.', item.fields);
      } else if (/aadhaar|aadhar/.test(text)) {
        putReview('aadhaar', 'Aadhaar validation needs confirmation', 'Smart FormSense could not fully confirm numeric and length rules for the Aadhaar field.', 'Make sure alphabetic values and short values are rejected, and a valid 12-digit value is accepted.', item.fields);
      } else if (/pincode|postal|zip/.test(text)) {
        putReview('pincode', 'Pincode validation needs confirmation', 'An invalid or short pincode could be typed without an immediate error.', 'Make sure the pincode is rejected before the applicant can continue.', item.fields);
      } else if (/name/.test(text) && /numeric|reject|validation/.test(text)) {
        putReview('name', 'Name validation needs confirmation', 'Numbers could be entered in one or more name fields without an immediate error.', 'Make sure numeric-only names are rejected before the applicant can continue.', item.fields);
      } else if (/date picker|date-picker/.test(text)) {
        putReview('date', 'Date fields need a quick manual check', 'These fields use a calendar control that cannot be fully verified through typing alone.', 'Open each calendar, check allowed/blocked dates, select a date and confirm it remains saved.', item.fields);
      } else if (/file upload/.test(text)) {
        putReview('file', 'File uploads need a quick manual check', 'Real files are required to verify upload behaviour.', 'Try a valid file, wrong file type, oversized file, remove it and upload again.', item.fields);
      } else if (/dropdown behaviour|option selection/.test(text)) {
        putReview('dropdown', 'Dropdown choices need confirmation', 'One or more dropdowns did not have a real selectable choice available during QA.', 'Open these dropdowns and confirm applicants can select a real option instead of only seeing Select/Choose.', item.fields);
      } else if (/dependenc/.test(text)) {
        putReview('dependency', 'Dependent dropdowns need confirmation', 'One or more dependent dropdowns were not fully confirmed during the automated run.', 'Change the parent selection and confirm each child dropdown loads the correct options before continuing.', item.fields);
      } else if (/marks range|marking scheme|percentage|cgpa/.test(text)) {
        putReview('marks', 'Percentage / CGPA rules need confirmation', 'The allowed range depends on the selected marking scheme.', 'Switch the marking scheme and confirm the allowed values and error message change correctly.', item.fields);
      } else if (/journey validation|continue|submit|progression/.test(text)) {
        putReview('journey', 'Form progression needs confirmation', 'Smart FormSense could not fully confirm this progression step.', 'Click the form Continue/Save & Next/Submit action once and confirm validation appears before incorrect data can proceed.', item.fields);
      } else if (/prefilled|locked/.test(text)) {
        putReview('locked', 'Locked or prefilled fields need confirmation', 'One or more locked fields need a quick check to ensure the correct value appears at the right time.', 'Confirm the value is populated when expected and remains unchanged.', item.fields);
      } else {
        putReview(`other:${item.title}`, item.title || 'Manual check needed', 'Smart FormSense could not fully confirm this behaviour automatically.', item.guidance || 'Check this behaviour once manually before sign-off.', item.fields);
      }
    }

    const review = [...friendlyReview.values()].map(item => ({
      ...item,
      fields: [...new Set(item.fields || [])]
    }));

    const status = qa.incomplete
      ? (qa.runState === 'stopped' ? 'Partial QA • Stopped' : 'Partial QA • Interrupted')
      : confirmed.length
        ? 'Needs Attention'
        : review.length || checkedCount < detectedCount
          ? 'Needs Review'
          : 'Ready for Final Sign-off';

    const statusClass = qa.incomplete
      ? 'partialStatus'
      : confirmed.length
        ? 'issueStatus'
        : review.length || checkedCount < detectedCount
          ? 'reviewStatus'
          : 'goodStatus';

    const overview = confirmed.length
      ? `${confirmed.length} confirmed issue type${confirmed.length === 1 ? '' : 's'} need attention before sign-off.`
      : review.length
        ? 'No confirmed problem was reproduced. Complete the highlighted review items before sign-off.'
        : 'No applicant-facing problem was reproduced in the completed checks.';

    const fieldsLine = fields => {
      const list = [...new Set(fields || [])];
      if (!list.length) return '';
      return `<div class="fields"><b>Fields:</b> ${list.map(esc).join(', ')}</div>`;
    };

    const statusTone = value => {
      const text = String(value || '').toLowerCase();
      if (/issue|blocked|attention/.test(text)) return 'bad';
      if (/checked|not applicable/.test(text)) return 'good';
      return 'reviewTone';
    };

    const confirmedHtml = confirmed.length
      ? `<section class="sectionBlock"><div class="sectionHead"><div><span class="eyebrow redEye">ACTION REQUIRED</span><h2>What needs fixing</h2></div><span class="countBadge redBadge">${confirmed.length}</span></div>${confirmed.map(item => `
          <article class="item issue">
            <div class="iconBox issueIcon">!</div>
            <div class="itemBody">
              <div class="itemTitle">${esc(item.title)}</div>
              ${fieldsLine(item.fields)}
              <div class="what">${esc(item.message || 'This behaviour did not work as expected for an applicant.')}</div>
              <div class="action"><b>What to do:</b> ${esc(item.guidance || 'Review this form setting and rerun QA.')}</div>
            </div>
          </article>`).join('')}</section>`
      : '';

    const reviewHtml = review.length
      ? `<section class="sectionBlock"><div class="sectionHead"><div><span class="eyebrow amberEye">QUICK REVIEW</span><h2>What you still need to check</h2></div><span class="countBadge amberBadge">${review.length}</span></div>${review.map(item => `
          <article class="item review">
            <div class="iconBox reviewIcon">?</div>
            <div class="itemBody">
              <div class="itemTitle">${esc(item.title)}</div>
              ${fieldsLine(item.fields)}
              <div class="what">${esc(item.what)}</div>
              <div class="action"><b>Check:</b> ${esc(item.action)}</div>
            </div>
          </article>`).join('')}</section>`
      : '';

    const uncovered = Array.isArray(qa.uncoveredFields) ? qa.uncoveredFields : [];
    const validationCoverage = Number(qa.validationCoverage ?? qa.summary?.validationCoverage ?? 0);

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart FormSense QA Report</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#202435;font-family:Inter,Segoe UI,Arial,sans-serif}.wrap{max-width:900px;margin:auto;padding:30px 18px 48px}.hero{background:linear-gradient(135deg,#ffffff 0%,#f7f5ff 58%,#eef7ff 100%);border:1px solid #e5e7f2;border-radius:22px;padding:24px;box-shadow:0 14px 36px rgba(61,50,123,.07)}.brand{font-size:12px;font-weight:900;letter-spacing:.08em;color:#6657e8}.hero h1{font-size:24px;margin:6px 0 4px}.meta{font-size:11px;color:#777d8e;line-height:1.55}.status{display:inline-flex;align-items:center;margin-top:14px;padding:7px 11px;border-radius:999px;font-size:11px;font-weight:900}.goodStatus{background:#dcfce7;color:#166534}.reviewStatus{background:#fef3c7;color:#92400e}.issueStatus{background:#fee2e2;color:#991b1b}.partialStatus{background:#e0e7ff;color:#3730a3}.overview{margin-top:12px;font-size:13px;line-height:1.6;color:#4d5568}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}.metric{border-radius:14px;padding:13px 10px;border:1px solid}.metric b{display:block;font-size:20px;line-height:1.1}.metric span{display:block;font-size:9px;font-weight:850;letter-spacing:.04em;margin-top:5px}.coverageMetric{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}.issueMetric{background:#fff1f2;border-color:#fecdd3;color:#be123c}.reviewMetric{background:#fffbeb;border-color:#fde68a;color:#a16207}.passMetric{background:#f0fdf4;border-color:#bbf7d0;color:#15803d}.coverageBar{height:7px;background:#dbeafe;border-radius:999px;overflow:hidden;margin-top:8px}.coverageFill{height:100%;background:linear-gradient(90deg,#4f46e5,#06b6d4);border-radius:999px}.journeyGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}.journeyCard{background:#fff;border:1px solid #e6e8ef;border-radius:13px;padding:11px 12px}.journeyCard span{font-size:9px;color:#7b8190;font-weight:800}.journeyCard b{display:block;margin-top:4px;font-size:11px}.good{color:#15803d}.bad{color:#b91c1c}.reviewTone{color:#a16207}.partial{margin-top:14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:13px;padding:11px 13px;font-size:11px;color:#9a3412}.sectionBlock{margin-top:28px}.sectionHead{display:flex;align-items:end;justify-content:space-between;margin-bottom:10px}.sectionHead h2{font-size:17px;margin:3px 0 0}.eyebrow{font-size:9px;font-weight:900;letter-spacing:.12em}.redEye{color:#dc2626}.amberEye{color:#d97706}.countBadge{min-width:28px;height:28px;border-radius:999px;display:grid;place-items:center;font-size:11px;font-weight:900}.redBadge{background:#fee2e2;color:#b91c1c}.amberBadge{background:#fef3c7;color:#92400e}.item{display:flex;gap:12px;background:#fff;border:1px solid #e5e7ed;border-radius:15px;padding:14px;margin:9px 0;box-shadow:0 5px 16px rgba(30,41,59,.035)}.item.issue{border-color:#fecaca;background:linear-gradient(135deg,#fff,#fff7f7)}.item.review{border-color:#fde68a;background:linear-gradient(135deg,#fff,#fffdf5)}.iconBox{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-weight:950;flex:0 0 auto}.issueIcon{background:#fee2e2;color:#b91c1c}.reviewIcon{background:#fef3c7;color:#92400e}.itemBody{min-width:0;flex:1}.itemTitle{font-size:14px;font-weight:900}.fields,.what,.action{margin-top:6px;font-size:11px;line-height:1.58;color:#606778}.fields b,.action b{color:#343949}.action{background:rgba(248,250,252,.9);border:1px solid #eef0f4;border-radius:9px;padding:9px 10px}.passed{margin-top:26px;background:linear-gradient(135deg,#ecfdf5,#f0fdf4);border:1px solid #bbf7d0;border-radius:15px;padding:14px;color:#166534;font-size:12px;font-weight:750}.note{margin-top:18px;background:#fff;border:1px solid #e7e9ef;border-radius:13px;padding:12px;font-size:10px;line-height:1.6;color:#858b99}.footer{text-align:center;margin-top:24px;font-size:10px;color:#979baa}@media(max-width:680px){.summary{grid-template-columns:repeat(2,1fr)}.journeyGrid{grid-template-columns:1fr}.hero{padding:18px}}@media print{body{background:#fff}.wrap{padding:0}.hero,.item{box-shadow:none}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div class="brand">✦ SMART FORMSENSE QA</div>
    <h1>${esc(qa.page?.title || 'Form')}</h1>
    <div class="meta">${esc(qa.page?.hostname || location.hostname || '')}<br>${esc(generated)} • v${esc(qa.productVersion || '17.12.1')}</div>
    <div class="status ${statusClass}">${esc(status)}</div>
    <div class="overview">${esc(overview)}</div>

    <div class="summary">
      <div class="metric coverageMetric"><b>${checkedCount}/${detectedCount}</b><span>FIELDS COVERED</span><div class="coverageBar"><div class="coverageFill" style="width:${Math.max(0,Math.min(100,fieldCoverage))}%"></div></div></div>
      <div class="metric issueMetric"><b>${confirmed.length}</b><span>ISSUE TYPES</span></div>
      <div class="metric reviewMetric"><b>${review.length}</b><span>NEEDS REVIEW</span></div>
      <div class="metric passMetric"><b>${passed}/${checksRun}</b><span>CHECKS CONFIRMED</span></div>
    </div>

    <div class="journeyGrid">
      <div class="journeyCard"><span>FIELD DISCOVERY</span><b class="${fieldCoverage === 100 ? 'good' : 'reviewTone'}">${fieldCoverage}% covered</b></div>
      <div class="journeyCard"><span>DEPENDENT FIELDS</span><b class="${statusTone(qa.dependencyStatus)}">${esc(qa.dependencyStatus || 'Not reached')}</b></div>
      <div class="journeyCard"><span>FORM PROGRESSION</span><b class="${statusTone(qa.journeyStatus)}">${esc(qa.journeyStatus || 'Not reached')}</b></div>
    </div>
  </div>

  ${qa.incomplete ? `<div class="partial"><b>Partial report.</b> ${esc(qa.summary?.headline || 'QA did not complete.')} ${qa.stopReason ? `<br>${esc(qa.stopReason)}` : ''}</div>` : ''}
  ${confirmedHtml}
  ${reviewHtml}
  ${uncovered.length ? `<section class="sectionBlock"><div class="sectionHead"><div><span class="eyebrow amberEye">COVERAGE GAP</span><h2>Fields not fully covered</h2></div><span class="countBadge amberBadge">${uncovered.length}</span></div><article class="item review"><div class="iconBox reviewIcon">?</div><div class="itemBody"><div class="fields"><b>Fields:</b> ${uncovered.map(esc).join(', ')}</div><div class="action"><b>Check:</b> Review these fields manually, then rerun QA.</div></div></article></section>` : ''}

  <div class="passed">✓ ${passed} automated checks were confirmed OK. ${validationCoverage < 100 ? `${checksRun - passed} check(s) are either review items or confirmed issues.` : ''}</div>
  <div class="note"><b>Simple report:</b> this page only shows what the form QC user needs to act on. Exact test values, DOM details, timings and diagnostic evidence remain in <b>Export Debug</b>. Final Submit, payment and application-generation actions stay under the user's control.</div>
  <div class="footer">Created with love ❤️ Akash Singh • Smart FormSense</div>
</div>
</body>
</html>`;
  };'''

text = replace_block(
    text,
    '  const buildQaFriendlyHtml = report => {',
    '  const exportQaReport = report => {',
    REPORT_BLOCK,
)

# Keep panel wording aligned with the report model.
text = text.replace('FUNCTIONAL QA SCORE', 'FIELD QA COVERAGE')
text = text.replace('Run functional QA to test this form', 'Run QA to check field coverage and form behaviour')

PATH.write_text(text, encoding='utf-8')
print('Patched Smart FormSense to v17.12.1')
