from pathlib import Path

p = Path('Smart_Form_Filler.user.js')
s = p.read_text(encoding='utf-8')


def replace_span(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise AssertionError(f'{label}: start marker not found')
    end = text.find(end_marker, start + len(start_marker))
    if end < 0:
        raise AssertionError(f'{label}: end marker not found')
    return text[:start] + replacement + text[end:]


# Version/source consistency.
s = s.replace('// @version      17.10.0', '// @version      17.11.0', 1)
s = s.replace('Smart FormSense V17.10', 'Smart FormSense V17.11')
s = s.replace('Smart_FormSense_V17_10_Debug_', 'Smart_FormSense_V17_11_Debug_')
s = s.replace("productVersion: '17.10.0'", "productVersion: '17.11.0'")
s = s.replace("qa.productVersion || '17.10.0'", "qa.productVersion || '17.11.0'")

# Replace semantic helper and add applicant-like QA helpers without touching unrelated code.
semantic_start = "  const qaSemanticFor = el => {"
semantic_end = "  const qaFunctionalCasesFor = el => {"
semantic_helpers = r'''  const qaSemanticFor = el => {
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
    if (/pin code|pincode|postal|zip/.test(ownContext)) return 'pincode';
    if (/percentage|percent/.test(ownContext)) return 'percentage';
    if (/cgpa/.test(ownContext)) return 'cgpa';
    if (/date of birth|birth date|\bdob\b/.test(ownContext)) return 'dob';
    if (/year of passing|passing year|pass year|completion year/.test(ownContext)) return 'passing_year';
    if (/first name|last name|father.*name|mother.*name|guardian.*name|applicant name|parent name/.test(ownContext)) return 'name';
    if (/country/.test(ownContext)) return 'country';
    if (/state|province/.test(ownContext)) return 'state';
    if (/district/.test(ownContext)) return 'district';
    if (/city|town/.test(ownContext)) return 'city';

    if (['radio', 'checkbox'].includes(type)) return '';

    const snapshot = debugFieldSnapshot(el);
    if (snapshot?.semantic && snapshot.confidence !== 'low') {
      return normalize(snapshot.semantic);
    }

    return snapshot?.semantic ? normalize(snapshot.semantic) : '';
  };

  const qaCleanLabel = (label, el = null) => {
    let text = String(label || 'Unnamed field').replace(/\s+/g, ' ').trim();
    if (normalize(el?.type) === 'radio') text = text.replace(/^(?:yes|no)\s+/i, '');
    text = text.replace(/\s*\*+\s*$/, '').trim();
    if (/i hereby declare|declaration|i agree/i.test(text) && text.length > 70) return 'Declaration Agreement';
    if (/permanent address same as address for correspondence/i.test(text)) return 'Permanent Address Same as Correspondence?';
    return text.length > 92 ? `${text.slice(0, 89).trim()}…` : text;
  };

  const qaAttemptUserEntry = async (el, value) => {
    const attemptedValue = String(value ?? '');
    const type = normalize(el?.type);

    if (!el || ['radio', 'checkbox'].includes(type) || el.tagName === 'SELECT') {
      qaSetNativeLikeValue(el, value);
      await sleep(70);
      return {
        method: 'control-interaction',
        attemptedValue,
        acceptedValue: String(el?.value ?? '')
      };
    }

    try { el.focus({ preventScroll: true }); } catch {}
    qaSetNativeLikeValue(el, '');

    const win = el.ownerDocument?.defaultView || window;
    const maxLength = Number(el.maxLength);
    const enforceMax = Number.isFinite(maxLength) && maxLength >= 0;

    for (const char of attemptedValue) {
      let allowed = true;
      try {
        const keydown = new win.KeyboardEvent('keydown', {
          key: char,
          bubbles: true,
          cancelable: true
        });
        allowed = el.dispatchEvent(keydown);
      } catch {}
      if (!allowed) continue;

      try {
        const beforeInput = new win.InputEvent('beforeinput', {
          data: char,
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        });
        allowed = el.dispatchEvent(beforeInput);
      } catch {}
      if (!allowed) continue;

      if (enforceMax && String(el.value ?? '').length >= maxLength) continue;
      qaSetNativeLikeValue(el, `${String(el.value ?? '')}${char}`);

      try {
        el.dispatchEvent(new win.KeyboardEvent('keyup', { key: char, bubbles: true }));
      } catch {}
    }

    try { el.dispatchEvent(new win.Event('blur', { bubbles: true })); } catch {}
    await sleep(90);

    return {
      method: 'user-like-entry',
      attemptedValue,
      acceptedValue: String(el.value ?? ''),
      normalizedOrBlocked: String(el.value ?? '') !== attemptedValue
    };
  };

  const qaButtonText = el => normalize(
    el?.innerText ||
    el?.textContent ||
    el?.value ||
    el?.getAttribute?.('aria-label') ||
    el?.title ||
    ''
  );

  const qaFindJourneyButtons = () => {
    const safe = [];
    const protectedFinal = [];
    const nodes = [...document.querySelector(
      'button,input[type="button"],input[type="submit"],a,[role="button"]'
    )];

    for (const el of nodes) {
      if (!isVisible(el) || el.disabled) continue;
      const text = qaButtonText(el);
      if (!text) continue;

      if (/\bsubmit\b|pay|payment|generate application|confirm admission|finali[sz]e|place order/.test(text)) {
        protectedFinal.push(el);
        continue;
      }

      if (/^(?:next|continue|proceed)$|save\s*(?:&|and)\s*next|continue to|proceed to|next step/.test(text)) {
        safe.push(el);
      }
    }

    return { safe, protectedFinal };
  };

  const qaJourneyState = () => ({
    url: location.href,
    keys: visibleFillableFields()
      .filter(el => !isLikelyInternalField(el))
      .map(fieldKey)
      .sort()
      .join('|')
  });

  const qaClickJourneyButton = async button => {
    const before = qaJourneyState();
    const form = button?.form || button?.closest?.('form') || null;
    let submitAttempted = false;

    const guard = event => {
      submitAttempted = true;
      try { event.preventDefault(); } catch {}
    };

    try { form?.addEventListener('submit', guard, true); } catch {}
    try { button.click(); } catch {}
    await sleep(500);
    try { form?.removeEventListener('submit', guard, true); } catch {}

    const after = qaJourneyState();
    return {
      before,
      after,
      submitAttempted,
      progressed: before.url !== after.url || before.keys !== after.keys
    };
  };

  const qaFeedbackQuality = text => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'missing';
    if (clean.length < 8 || /^(?:required|invalid|error|mandatory|please enter)$/i.test(clean)) return 'generic';
    return 'clear';
  };

  const qaRunDependencyChain = async fields => {
    const map = new Map();
    for (const el of fields) {
      if (el.tagName !== 'SELECT') continue;
      const semantic = qaSemanticFor(el);
      if (semantic && !map.has(semantic)) map.set(semantic, el);
    }

    const chain = ['country', 'state', 'district', 'city']
      .map(key => map.get(key))
      .filter(Boolean);

    if (chain.length < 2) return [];

    const snapshots = chain.map(el => [el, qaSnapshotFieldValue(el)]);
    const results = [];

    try {
      for (let i = 0; i < chain.length - 1; i++) {
        const parent = chain[i];
        const child = chain[i + 1];
        const options = validOptions(parent);

        if (!options.length) {
          results.push({
            el: child,
            status: 'review',
            name: 'Dependent dropdown could not be exercised',
            actual: `${qaCleanLabel(qaHumanLabel(parent), parent)} has no selectable option in the current state.`
          });
          break;
        }

        const current = String(parent.value ?? '');
        const target = options.find(option => String(option.value) !== current) || options[0];
        const before = `${String(child.value ?? '')}|${validOptions(child).length}|${!!child.disabled}`;

        parent.value = target.value;
        qaDispatchInteraction(parent);

        let reacted = false;
        const started = Date.now();
        while (Date.now() - started < 1800) {
          await sleep(120);
          const now = `${String(child.value ?? '')}|${validOptions(child).length}|${!!child.disabled}`;
          if (now !== before) {
            reacted = true;
            break;
          }
        }

        results.push({
          el: child,
          status: reacted ? 'passed' : 'review',
          name: 'Dependent dropdown response',
          actual: reacted
            ? `${qaCleanLabel(qaHumanLabel(child), child)} reacted after ${qaCleanLabel(qaHumanLabel(parent), parent)} changed.`
            : `${qaCleanLabel(qaHumanLabel(child), child)} did not visibly react after its parent changed.`
        });

        const childOptions = validOptions(child);
        if (childOptions.length && !String(child.value ?? '')) {
          child.value = childOptions[0].value;
          qaDispatchInteraction(child);
          await sleep(180);
        }
      }
    } finally {
      for (const [el, snapshot] of [...snapshots].reverse()) {
        if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
        await sleep(160);
      }
    }

    return results;
  };

  const qaRunJourneyChecks = async (fields, candidates) => {
    const rows = [];
    const buttons = qaFindJourneyButtons();

    if (buttons.protectedFinal.length) {
      rows.push({
        status: 'review',
        name: 'Final submission protection',
        actual: `${buttons.protectedFinal.length} final/transaction action(s) were detected and intentionally not clicked automatically. Confirm final-submit validation manually.`
      });
    }

    const button = buttons.safe[0];
    if (!button) {
      rows.push({
        status: 'review',
        name: 'Next / Continue validation',
        actual: 'No safe Next, Continue or Save & Next action was available on this step.'
      });
      return rows;
    }

    const required = fields.filter(el => {
      if (!el?.isConnected || normalize(el.type) === 'file' || el.readOnly) return false;
      const signals = qaRequiredSignals(el);
      return signals.visible || signals.configured || isRequired(el);
    }).slice(0, 8);

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

      const click = await qaClickJourneyButton(button);
      const messages = required
        .map(el => [el, qaVisibleFeedback(el)])
        .filter(([, feedback]) => feedback.invalid);

      if (messages.length) {
        rows.push({
          status: 'passed',
          name: 'Required fields on Next / Continue',
          actual: `Progression was blocked and validation appeared for ${messages.length} required field(s).`
        });
      } else if (click.progressed || click.submitAttempted) {
        rows.push({
          status: 'failed',
          name: 'Required fields on Next / Continue',
          actual: 'The form attempted to progress while required test fields were blank and no clear validation message was captured.'
        });
      } else {
        rows.push({
          status: 'review',
          name: 'Required fields on Next / Continue',
          actual: 'Progression did not occur, but Smart FormSense could not confirm clear field-level validation messages.'
        });
      }

      for (const [el, feedback] of messages) {
        if (qaFeedbackQuality(feedback.text) !== 'clear') {
          rows.push({
            el,
            status: 'review',
            name: 'Validation message could be clearer',
            actual: feedback.text || 'Validation was triggered, but the message was missing or too generic.'
          });
        }
      }

      for (const [el, snapshot] of snapshots) {
        if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
      }

      if (click.progressed) return rows;
    }

    for (const candidate of candidates.slice(0, 3)) {
      const el = candidate.el;
      if (!el?.isConnected || !button?.isConnected) continue;

      const snapshot = qaSnapshotFieldValue(el);
      const entry = await qaAttemptUserEntry(el, candidate.testCase.value);
      const click = await qaClickJourneyButton(button);
      const feedback = qaVisibleFeedback(el);

      if (feedback.invalid) {
        rows.push({
          el,
          status: 'passed',
          name: candidate.testCase.label,
          actual: `Next/Continue triggered validation: ${feedback.text}`,
          evidence: {
            method: 'journey-probe',
            attemptedValue: entry.attemptedValue,
            acceptedValue: entry.acceptedValue,
            feedback: feedback.text || '',
            progressed: click.progressed,
            submitAttempted: click.submitAttempted
          }
        });
      } else if (click.progressed || click.submitAttempted) {
        rows.push({
          el,
          status: 'failed',
          name: candidate.testCase.label,
          actual: `The invalid value ${JSON.stringify(entry.acceptedValue)} was allowed through the Next/Continue action without clear validation.`,
          evidence: {
            method: 'journey-probe',
            attemptedValue: entry.attemptedValue,
            acceptedValue: entry.acceptedValue,
            feedback: '',
            progressed: click.progressed,
            submitAttempted: click.submitAttempted
          }
        });
      } else {
        rows.push({
          el,
          status: 'review',
          name: candidate.testCase.label,
          actual: 'Next/Continue did not progress, but no clear validation message was captured.',
          evidence: {
            method: 'journey-probe',
            attemptedValue: entry.attemptedValue,
            acceptedValue: entry.acceptedValue,
            feedback: '',
            progressed: click.progressed,
            submitAttempted: click.submitAttempted
          }
        });
      }

      if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
      if (click.progressed) break;
    }

    return rows;
  };

'''
s = replace_span(s, semantic_start, semantic_end, semantic_helpers, 'semantic/helpers')

# Replace negative-value verdict logic with user-like entry and confidence-aware outcomes.
one_case_start = "  const qaRunOneFieldCase = async (el, testCase) => {"
one_case_end = "  const qaRunRequiredBlankCase = async el => {"
one_case_repl = r'''  const qaRunOneFieldCase = async (el, testCase) => {
    const before = qaVisibleFeedback(el);
    const snapshot = qaSnapshotFieldValue(el);
    const entry = await qaAttemptUserEntry(el, testCase.value);
    const after = qaVisibleFeedback(el);
    const exact = entry.acceptedValue === entry.attemptedValue;
    const newFeedback = after.invalid && (!before.invalid || after.signature !== before.signature);

    let status = 'passed';
    let actual = '';

    if (testCase.expectation === 'reject') {
      if (!exact) {
        status = 'passed';
        actual = `The control prevented or normalized the invalid entry. Accepted value: ${JSON.stringify(entry.acceptedValue)}.`;
      } else if (newFeedback || after.invalid) {
        status = 'passed';
        actual = `The invalid value produced validation feedback${after.text ? `: ${after.text}` : '.'}`;
      } else {
        status = 'review';
        actual = 'The invalid value could be entered without immediate feedback. Smart FormSense will confirm it against Next/Continue before calling it a defect.';
      }
    } else if (exact && !after.invalid) {
      status = 'passed';
      actual = 'The valid value was accepted without a validation error.';
    } else {
      status = 'failed';
      actual = exact
        ? `The valid value remained but validation feedback was still present${after.text ? `: ${after.text}` : '.'}`
        : `The valid value could not be entered as expected. Accepted value: ${JSON.stringify(entry.acceptedValue)}.`;
    }

    await qaRestoreFieldValue(el, snapshot);

    return {
      status,
      actual,
      attemptedValue: entry.attemptedValue,
      evidence: {
        method: entry.method,
        attemptedValue: entry.attemptedValue,
        acceptedValue: entry.acceptedValue,
        feedback: after.text || '',
        restored: true
      }
    };
  };

'''
s = replace_span(s, one_case_start, one_case_end, one_case_repl, 'qaRunOneFieldCase')

# A child dropdown with no current options is uncertain, not automatically broken.
select_start = "  const qaRunSelectInteractionCase = async el => {"
select_end = "  const qaRunToggleCase = async el => {"
select_repl = r'''  const qaRunSelectInteractionCase = async el => {
    const options = validOptions(el);
    if (!options.length) {
      return {
        status: 'review',
        actual: 'No option is currently available. A parent selection may need to load this dropdown.'
      };
    }

    const snapshot = qaSnapshotFieldValue(el);
    const current = String(el.value ?? '');
    const target = options.find(option => String(option.value) !== current) || options[0];

    el.value = target.value;
    qaDispatchInteraction(el);
    await sleep(90);

    const retained = String(el.value ?? '') === String(target.value);
    const feedback = qaVisibleFeedback(el);

    await qaRestoreFieldValue(el, snapshot);

    return {
      status: retained && !feedback.invalid ? 'passed' : 'failed',
      actual: retained
        ? (feedback.invalid ? `Selection changed but validation feedback remained: ${feedback.text}` : 'A valid dropdown option could be selected and retained.')
        : 'A valid dropdown option could not be selected or retained.'
    };
  };

'''
s = replace_span(s, select_start, select_end, select_repl, 'qaRunSelectInteractionCase')

# Replace only the QA report builder, leaving the rest of the application untouched.
build_start = "  const buildQaFunctionalReport = async () => {"
build_end = "  const runSmartQaAudit = async () => {"
build_repl = r'''  const buildQaFunctionalReport = async () => {
    const generatedAt = new Date().toISOString();
    const findings = [];
    const testCases = [];
    const journeyCandidates = [];
    const seenRadioGroups = new Set();
    let fields = [];

    try {
      fields = visibleFillableFields().filter(el =>
        el &&
        !isLikelyInternalField(el) &&
        !['hidden', 'submit', 'button', 'reset'].includes(normalize(el.type))
      );
    } catch {}

    const addCase = ({
      el = null,
      category = 'Functional Behaviour',
      name = 'Functional test',
      status = 'review',
      expected = '',
      actual = '',
      attemptedValue = '',
      evidence = null,
      guidance = ''
    }) => {
      const field = el ? qaCleanLabel(qaHumanLabel(el), el) : '';
      const fieldKeyValue = el ? fieldKey(el) : null;
      const row = {
        id: `tc_${testCases.length + 1}`,
        category,
        name,
        status,
        field,
        fieldKey: fieldKeyValue,
        expected,
        actual,
        attemptedValue,
        evidence
      };

      testCases.push(row);
      if (status === 'passed') return;

      const severity =
        status === 'blocker'
          ? 'critical'
          : status === 'failed'
            ? 'warning'
            : 'observation';

      findings.push({
        id: `qa_${findings.length + 1}`,
        severity,
        category,
        title: name,
        message: actual,
        fieldKey: fieldKeyValue,
        field,
        expected,
        actual,
        guidance: guidance || (
          status === 'failed'
            ? 'Review this user-facing field or validation setting in the form builder and rerun QA.'
            : 'Confirm this behaviour manually during the form journey.'
        ),
        testCaseId: row.id,
        attemptedValue,
        evidence
      });
    };

    if (!fields.length) {
      addCase({
        category: 'Form Detection',
        name: 'Detect active form',
        status: 'review',
        expected: 'At least one active user-facing form field',
        actual: 'No active user-facing form fields were detected.',
        guidance: 'Confirm the form is fully loaded and the correct page/frame is active.'
      });
    }

    state.panel?.setStatus?.(`Functional QA • analysing ${fields.length} field(s)...`);

    for (let index = 0; index < fields.length; index++) {
      if (state.stopRequested) break;

      const el = fields[index];
      const type = normalize(el.type);
      const label = qaCleanLabel(qaHumanLabel(el), el);

      if (type === 'radio') {
        const key = `${el.ownerDocument?.URL || ''}|${el.name || fieldKey(el)}`;
        if (seenRadioGroups.has(key)) continue;
        seenRadioGroups.add(key);
      }

      state.panel?.setStatus?.(`Functional QA • ${index + 1}/${fields.length} • ${label}`);

      const requiredSignals = qaRequiredSignals(el);
      const required = !!(
        requiredSignals.visible ||
        requiredSignals.configured ||
        isRequired(el)
      );

      if (type === 'file') {
        addCase({
          el,
          category: 'File Upload',
          name: 'File upload behaviour',
          status: 'review',
          expected: required
            ? 'Valid file uploads; invalid type/size is rejected; missing required file blocks progression.'
            : 'Valid file uploads; invalid type/size is rejected.',
          actual: 'Browser security requires a real file selection for this test.',
          guidance: 'Check one valid file, wrong type, oversized file, remove/re-upload, and required behaviour.'
        });
        continue;
      }

      const adapter = debugFieldSnapshot(el)?.adapter || '';
      const isDateWidget = /datepicker/i.test(String(adapter)) || /datepicker/i.test(String(el.className || ''));

      if (el.readOnly) {
        if (isDateWidget) {
          addCase({
            el,
            category: 'Date Picker',
            name: 'Date-picker interaction',
            status: 'review',
            expected: 'The user can open the date picker, choose an allowed date, and keep the selected value.',
            actual: 'This field is controlled by a date-picker widget.',
            guidance: 'Verify calendar opening, allowed/disabled dates, selection, close behaviour and persistence.'
          });
        } else if (fieldHasValue(el)) {
          addCase({
            el,
            category: 'Prefilled Fields',
            name: 'Prefilled locked field',
            status: 'passed',
            expected: 'The prefilled value remains present and cannot be accidentally edited.',
            actual: 'The field is prefilled, read-only, and retained its value.'
          });
        } else if (required) {
          addCase({
            el,
            category: 'Prefilled Fields',
            name: 'Required locked field is empty',
            status: 'review',
            expected: 'A required read-only field should be populated before it can block the applicant.',
            actual: 'The field is required, read-only and currently empty.',
            guidance: 'Confirm whether an earlier selection or step is expected to populate this field.'
          });
        }
        continue;
      }

      if (required) {
        const result = await qaRunRequiredBlankCase(el);
        addCase({
          el,
          category: 'Mandatory Validation',
          name: 'Required-field behaviour',
          status: result.status,
          expected: 'A mandatory field should block progression when empty and show useful validation at the appropriate time.',
          actual: result.actual,
          evidence: {
            method: 'field-blank-probe',
            feedback: result.feedback || ''
          },
          guidance: result.status === 'review'
            ? 'Smart FormSense will also check this through Next/Continue.'
            : ''
        });
      }

      if (el.tagName === 'SELECT') {
        const result = await qaRunSelectInteractionCase(el);
        addCase({
          el,
          category: 'Dropdown Behaviour',
          name: 'Option selection',
          status: result.status,
          expected: 'A selectable option can be chosen and retained without an error.',
          actual: result.actual
        });
      } else if (['checkbox', 'radio'].includes(type)) {
        const result = await qaRunToggleCase(el);
        addCase({
          el,
          category: 'Choice Controls',
          name: 'Selection behaviour',
          status: result.status,
          expected: 'The user can change the selection and the control responds correctly.',
          actual: result.actual
        });
      }

      const semantic = qaSemanticFor(el);
      if (semantic === 'marks_metric') {
        addCase({
          el,
          category: 'Input Validation',
          name: 'Marks range follows marking scheme',
          status: 'review',
          expected: 'Percentage/CGPA range should match the selected marking scheme.',
          actual: 'This field supports both Percentage and CGPA, so a single fixed range cannot be safely inferred.',
          guidance: 'Switch the Marking Scheme and confirm the accepted range/message changes appropriately.'
        });
      }

      const functionalCases = qaFunctionalCasesFor(el);
      for (const testCase of functionalCases) {
        if (state.stopRequested) break;

        const result = await qaRunOneFieldCase(el, testCase);
        addCase({
          el,
          category: 'Input Validation',
          name: testCase.label,
          status: result.status,
          expected: testCase.expectation === 'reject'
            ? 'Invalid value should be blocked, normalized, or clearly rejected during the applicant journey.'
            : 'Valid value should be accepted without a validation error.',
          actual: result.actual,
          attemptedValue: result.attemptedValue,
          evidence: result.evidence,
          guidance: result.status === 'failed'
            ? `Review this validation in the form builder. Tested value: ${JSON.stringify(result.attemptedValue)}.`
            : ''
        });

        if (result.status === 'review' && testCase.expectation === 'reject') {
          journeyCandidates.push({ el, testCase });
        }
      }

      await yieldToUI();
    }

    for (const row of await qaRunDependencyChain(fields)) {
      addCase({
        el: row.el || null,
        category: 'Dependencies',
        name: row.name,
        status: row.status,
        expected: 'Dependent dropdowns should load/reset in parent-to-child order.',
        actual: row.actual,
        guidance: row.status === 'review'
          ? 'Verify the parent-to-child dependency once manually if this chain is expected.'
          : ''
      });
    }

    for (const row of await qaRunJourneyChecks(fields, journeyCandidates)) {
      addCase({
        el: row.el || null,
        category: 'Journey Validation',
        name: row.name,
        status: row.status,
        expected: 'Next/Continue should enforce validation without executing protected final actions.',
        actual: row.actual,
        evidence: row.evidence || null,
        guidance: row.status === 'failed'
          ? 'Review the affected validation in the form builder and rerun this journey check.'
          : row.status === 'review'
            ? 'Complete this remaining journey check manually.'
            : ''
      });
    }

    const blockers = testCases.filter(item => item.status === 'blocker').length;
    const failed = testCases.filter(item => item.status === 'failed').length;
    const review = testCases.filter(item => ['review', 'manual', 'warning'].includes(item.status)).length;
    const passed = testCases.filter(item => item.status === 'passed').length;
    const counts = {
      critical: blockers,
      warning: failed,
      observation: review,
      passed
    };

    const checksRun = testCases.length;
    const completed = blockers + failed + passed;
    const score = completed
      ? Math.round(clamp((passed / completed) * 100, 0, 100))
      : 0;
    const coverage = checksRun
      ? Math.round(clamp((completed / checksRun) * 100, 0, 100))
      : 0;
    const rating = blockers > 0
      ? 'Blocked'
      : failed > 0
        ? 'Needs Attention'
        : review > 0
          ? 'Needs Review'
          : 'Strong';

    const summary = {
      riskLevel: blockers > 0
        ? 'High'
        : failed > 0
          ? 'Moderate'
          : review > 0
            ? 'Review'
            : 'Low',
      headline: blockers > 0
        ? `${blockers} blocker${blockers === 1 ? '' : 's'} need attention before go-live.`
        : failed > 0
          ? `${failed} confirmed issue${failed === 1 ? '' : 's'} should be fixed before go-live.`
          : review > 0
            ? `No confirmed failure was reproduced. ${review} check${review === 1 ? '' : 's'} still need review.`
            : 'No applicant-facing issue was reproduced in the completed automated checks.',
      recommendation: blockers > 0 || failed > 0
        ? 'Fix the confirmed applicant-facing issues, rerun QA, then complete the remaining manual checks.'
        : review > 0
          ? 'Complete only the listed manual/review checks before final sign-off.'
          : 'Complete a brief final human journey check before sign-off.',
      fieldsAudited: fields.length,
      checksRun,
      completed,
      coverage,
      score
    };

    const categoryCounts = {};
    for (const item of findings) {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    }

    return {
      reportVersion: 4,
      product: 'Smart FormSense',
      productVersion: '17.11.0',
      generatedAt,
      auditType: 'Black-box Functional Form QA',
      page: {
        url: location.href,
        hostname: location.hostname,
        pathname: location.pathname,
        title: document.title || ''
      },
      formSignature: state.currentFormSignature || null,
      fieldsAudited: fields.length,
      checksRun,
      score,
      rating,
      coverage,
      summary,
      counts,
      categoryCounts,
      findings,
      testCases,
      notes: [
        'Smart FormSense tests the finished form from the applicant/user point of view; it does not audit backend implementation choices.',
        'Field values are temporarily changed for safe black-box tests and restored after each test case.',
        'Safe Next/Continue/Save & Next actions may be tested after field checks; final submit/payment/generate-application actions are always protected.',
        'A field-level negative test is not called a defect unless stronger applicant-journey evidence confirms it.',
        'File uploads, final submission, and some widget-specific behaviours remain manual QA steps.'
      ]
    };
  };

'''
s = replace_span(s, build_start, build_end, build_repl, 'buildQaFunctionalReport')

p.write_text(s, encoding='utf-8')
print('safe marker-based core QA patch applied')
