from pathlib import Path
import re

p = Path('Smart_Form_Filler.user.js')
s = p.read_text(encoding='utf-8')

# Version/source-of-truth cleanup.
s = s.replace('// @version      17.10.0', '// @version      17.11.0')
s = s.replace('Smart FormSense V17.10', 'Smart FormSense V17.11')
s = s.replace('Smart_FormSense_V17_10_Debug_', 'Smart_FormSense_V17_11_Debug_')
s = s.replace("productVersion: '17.10.0'", "productVersion: '17.11.0'")
s = s.replace("qa.productVersion || '17.10.0'", "qa.productVersion || '17.11.0'")

# Prefer obvious control type/context over weak inherited semantics.
s = s.replace(
"  const qaSemanticFor = el => {\n    const snapshot = debugFieldSnapshot(el);",
"  const qaSemanticFor = el => {\n    const type = normalize(el?.type);\n    if (type === 'file') return 'file';\n    if (['radio', 'checkbox'].includes(type)) {\n      const own = normalize([qaHumanLabel(el), el?.name, el?.id].filter(Boolean).join(' '));\n      if (!/country|state|district|city|pincode|email|mobile|percentage|cgpa|passing year|date of birth/.test(own)) return '';\n    }\n    const snapshot = debugFieldSnapshot(el);",
1)

marker = "  const qaFunctionalCasesFor = el => {"
assert marker in s
helpers = r'''  const qaCleanLabel = (label, el = null) => {
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
      return { method: 'control-interaction', attemptedValue, acceptedValue: String(el?.value ?? '') };
    }

    try { el.focus({ preventScroll: true }); } catch {}
    qaSetNativeLikeValue(el, '');
    const win = el.ownerDocument?.defaultView || window;
    const maxLength = Number(el.maxLength);
    const enforceMax = Number.isFinite(maxLength) && maxLength >= 0;

    for (const char of attemptedValue) {
      let allowed = true;
      try {
        const keydown = new win.KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true });
        allowed = el.dispatchEvent(keydown);
      } catch {}
      if (!allowed) continue;
      try {
        const before = new win.InputEvent('beforeinput', { data: char, inputType: 'insertText', bubbles: true, cancelable: true });
        allowed = el.dispatchEvent(before);
      } catch {}
      if (!allowed) continue;
      if (enforceMax && String(el.value ?? '').length >= maxLength) continue;
      qaSetNativeLikeValue(el, `${String(el.value ?? '')}${char}`);
      try { el.dispatchEvent(new win.KeyboardEvent('keyup', { key: char, bubbles: true })); } catch {}
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

  const qaButtonText = el => normalize(el?.innerText || el?.textContent || el?.value || el?.getAttribute?.('aria-label') || el?.title || '');
  const qaFindJourneyButtons = () => {
    const safe = [];
    const protectedFinal = [];
    const nodes = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],a,[role="button"]')];
    for (const el of nodes) {
      if (!isVisible(el) || el.disabled) continue;
      const text = qaButtonText(el);
      if (!text) continue;
      if (/pay|payment|final submit|submit application|generate application|confirm admission|finali[sz]e|place order/.test(text)) {
        protectedFinal.push(el);
        continue;
      }
      if (/^(?:next|continue|proceed)$|save\s*(?:&|and)\s*next|continue to|proceed to|next step/.test(text)) safe.push(el);
    }
    return { safe, protectedFinal };
  };

  const qaJourneyState = () => ({
    url: location.href,
    keys: visibleFillableFields().filter(el => !isLikelyInternalField(el)).map(fieldKey).sort().join('|')
  });

  const qaClickJourneyButton = async button => {
    const before = qaJourneyState();
    const form = button?.form || button?.closest?.('form') || null;
    const guard = event => { try { event.preventDefault(); } catch {} };
    try { form?.addEventListener('submit', guard, true); } catch {}
    try { button.click(); } catch {}
    await sleep(420);
    try { form?.removeEventListener('submit', guard, true); } catch {}
    const after = qaJourneyState();
    return { before, after, progressed: before.url !== after.url || before.keys !== after.keys };
  };

  const qaFeedbackQuality = text => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'missing';
    if (clean.length < 8 || /^(?:required|invalid|error|mandatory|please enter)$/i.test(clean)) return 'generic';
    return 'clear';
  };

'''
s = s.replace(marker, helpers + marker, 1)

# Replace direct DOM assignment verdicts with applicant-like interaction + confidence-aware verdicts.
pattern = re.compile(r"  const qaRunOneFieldCase = async \(el, testCase\) => \{.*?\n  \};\n\n  const qaRunRequiredBlankCase", re.S)
replacement = r'''  const qaRunOneFieldCase = async (el, testCase) => {
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

  const qaRunRequiredBlankCase'''
s, n = pattern.subn(replacement, s, count=1)
assert n == 1

s = s.replace(
"        status: 'failed',\n        actual: 'No selectable option was available.'",
"        status: 'review',\n        actual: 'No option is currently available. A parent selection may need to load this dropdown.'",
1)

journey_marker = "  const buildQaFunctionalReport = async () => {"
assert journey_marker in s
journey_helpers = r'''  const qaRunDependencyChain = async fields => {
    const map = new Map();
    for (const el of fields) {
      if (el.tagName !== 'SELECT') continue;
      const semantic = qaSemanticFor(el);
      if (semantic && !map.has(semantic)) map.set(semantic, el);
    }
    const chain = ['country', 'state', 'district', 'city'].map(key => map.get(key)).filter(Boolean);
    if (chain.length < 2) return [];
    const snapshots = chain.map(el => [el, qaSnapshotFieldValue(el)]);
    const results = [];
    try {
      for (let i = 0; i < chain.length - 1; i++) {
        const parent = chain[i];
        const child = chain[i + 1];
        const options = validOptions(parent);
        if (!options.length) {
          results.push({ el: child, status: 'review', name: 'Dependent dropdown could not be exercised', actual: `${qaCleanLabel(qaHumanLabel(parent), parent)} has no selectable option in the current state.` });
          break;
        }
        const current = String(parent.value ?? '');
        const target = options.find(o => String(o.value) !== current) || options[0];
        const before = `${String(child.value ?? '')}|${validOptions(child).length}|${!!child.disabled}`;
        parent.value = target.value;
        qaDispatchInteraction(parent);
        let reacted = false;
        const started = Date.now();
        while (Date.now() - started < 1800) {
          await sleep(120);
          const now = `${String(child.value ?? '')}|${validOptions(child).length}|${!!child.disabled}`;
          if (now !== before) { reacted = true; break; }
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
      rows.push({ status: 'passed', name: 'Final submission protection', actual: `${buttons.protectedFinal.length} final/transaction action(s) detected and intentionally not clicked.` });
    }
    const button = buttons.safe[0];
    if (!button) {
      rows.push({ status: 'review', name: 'Next / Continue validation', actual: 'No safe Next, Continue or Save & Next action was available on this step.' });
      return rows;
    }

    const required = fields.filter(el => {
      if (!el?.isConnected || normalize(el.type) === 'file' || el.readOnly) return false;
      const r = qaRequiredSignals(el);
      return r.visible || r.configured || isRequired(el);
    }).slice(0, 8);

    if (required.length) {
      const snapshots = required.map(el => [el, qaSnapshotFieldValue(el)]);
      for (const el of required) {
        if (el.tagName === 'SELECT') el.selectedIndex = -1;
        else if (normalize(el.type) === 'checkbox') el.checked = false;
        else if (normalize(el.type) === 'radio') radioGroupMembers(el).forEach(x => x.checked = false);
        else qaSetNativeLikeValue(el, '');
        qaDispatchInteraction(el);
      }
      const click = await qaClickJourneyButton(button);
      const messages = required.map(el => [el, qaVisibleFeedback(el)]).filter(([, f]) => f.invalid);
      rows.push({
        status: click.progressed ? 'failed' : messages.length ? 'passed' : 'review',
        name: 'Required fields on Next / Continue',
        actual: click.progressed
          ? 'The form progressed while required test fields were blank.'
          : messages.length
            ? `Progression was blocked and validation appeared for ${messages.length} required field(s).`
            : 'Progression did not occur, but Smart FormSense could not confirm clear field-level validation messages.'
      });
      for (const [el, feedback] of messages) {
        if (qaFeedbackQuality(feedback.text) !== 'clear') {
          rows.push({ el, status: 'review', name: 'Validation message could be clearer', actual: feedback.text || 'Validation was triggered, but the message was missing or too generic.' });
        }
      }
      for (const [el, snapshot] of snapshots) if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
      if (click.progressed) return rows;
    }

    for (const candidate of candidates.slice(0, 3)) {
      const el = candidate.el;
      if (!el?.isConnected || !button?.isConnected) continue;
      const snapshot = qaSnapshotFieldValue(el);
      const entry = await qaAttemptUserEntry(el, candidate.testCase.value);
      const click = await qaClickJourneyButton(button);
      const feedback = qaVisibleFeedback(el);
      rows.push({
        el,
        status: click.progressed && !feedback.invalid ? 'failed' : feedback.invalid ? 'passed' : 'review',
        name: candidate.testCase.label,
        actual: click.progressed && !feedback.invalid
          ? `The invalid value ${JSON.stringify(entry.acceptedValue)} was allowed through Next/Continue.`
          : feedback.invalid
            ? `Next/Continue triggered validation: ${feedback.text}`
            : 'Next/Continue did not progress, but no clear validation message was captured.',
        evidence: { method: 'journey-probe', attemptedValue: entry.attemptedValue, acceptedValue: entry.acceptedValue, feedback: feedback.text || '', progressed: click.progressed }
      });
      if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
      if (click.progressed) break;
    }
    return rows;
  };

'''
s = s.replace(journey_marker, journey_helpers + journey_marker, 1)

# Add evidence + journey candidate collection.
s = s.replace("    const testCases = [];\n    const seenRadioGroups", "    const testCases = [];\n    const journeyCandidates = [];\n    const seenRadioGroups", 1)
s = s.replace("      attemptedValue = '',\n      guidance = ''", "      attemptedValue = '',\n      evidence = null,\n      guidance = ''", 1)
s = s.replace("        actual,\n        attemptedValue\n      };", "        actual,\n        attemptedValue,\n        evidence\n      };", 1)
s = s.replace("      const label = qaHumanLabel(el);", "      const label = qaCleanLabel(qaHumanLabel(el), el);", 1)

# Read-only/prefilled fields get state-aware QA instead of blank-test noise.
readonly_pattern = re.compile(r"      if \(required\) \{.*?\n      if \(el\.readOnly\) \{.*?\n        continue;\n      \}\n", re.S)
readonly_repl = r'''      const adapter = debugFieldSnapshot(el)?.adapter || '';
      const isDateWidget = /datepicker/i.test(String(adapter)) || /datepicker/i.test(String(el.className || ''));
      if (el.readOnly && fieldHasValue(el) && !isDateWidget) {
        addCase({
          el,
          category: 'Prefilled Fields',
          name: 'Prefilled locked field',
          status: 'passed',
          expected: 'The prefilled value remains present and cannot be accidentally edited.',
          actual: 'The field is prefilled, read-only, and retained its value.'
        });
      } else if (required) {
        const result = await qaRunRequiredBlankCase(el);
        addCase({
          el,
          category: 'Mandatory Validation',
          name: 'Required-field behaviour',
          status: result.status,
          expected: 'A mandatory field should block progression when empty and show useful validation at the appropriate time.',
          actual: result.actual,
          evidence: { method: 'field-blank-probe', feedback: result.feedback || '' },
          guidance: result.status === 'review' ? 'Smart FormSense will also check this through Next/Continue.' : ''
        });
      }

      if (el.readOnly) {
        if (isDateWidget) {
          addCase({
            el,
            category: 'Date Picker',
            name: 'Date-picker interaction',
            status: 'review',
            expected: 'The user can open the calendar, choose an allowed date, and keep the selected value.',
            actual: 'This field is intentionally read-only and controlled by a date-picker widget.',
            guidance: 'Verify calendar opening, allowed/disabled dates, selection, close behaviour and persistence.'
          });
        }
        continue;
      }
'''
s, n = readonly_pattern.subn(readonly_repl, s, count=1)
assert n == 1

# Preserve richer input evidence and queue uncertain negative cases for journey confirmation.
s = s.replace("          attemptedValue: result.attemptedValue,\n          guidance:", "          attemptedValue: result.attemptedValue,\n          evidence: result.evidence,\n          guidance:", 1)
s = s.replace("        });\n      }\n\n      await yieldToUI();", "        });\n        if (result.status === 'review' && testCase.expectation === 'reject') journeyCandidates.push({ el, testCase });\n      }\n\n      await yieldToUI();", 1)

# Replace independent dependency probes with one parent-aware chain, then run journey validation.
dep_pattern = re.compile(r"    for \(const pair of qaDependencyCandidates\(fields\)\) \{.*?\n    \}\n\n    const counts = \{", re.S)
dep_repl = r'''    for (const row of await qaRunDependencyChain(fields)) {
      addCase({
        el: row.el || null,
        category: 'Dependencies',
        name: row.name,
        status: row.status,
        expected: 'Dependent dropdowns should load/reset in parent-to-child order.',
        actual: row.actual
      });
    }

    for (const row of await qaRunJourneyChecks(fields, journeyCandidates)) {
      addCase({
        el: row.el || null,
        category: 'Journey Validation',
        name: row.name,
        status: row.status,
        expected: 'Next/Continue should enforce validation without triggering protected final actions.',
        actual: row.actual,
        evidence: row.evidence || null
      });
    }

    const counts = {'''
s, n = dep_pattern.subn(dep_repl, s, count=1)
assert n == 1

# Counts: Blocker / Failed / Review / Passed. Reviews do not depress quality score; coverage is shown separately.
counts_pattern = re.compile(r"    const counts = \{.*?\n    const summary = \{", re.S)
counts_repl = r'''    const blockers = testCases.filter(item => item.status === 'blocker').length;
    const failed = testCases.filter(item => item.status === 'failed').length;
    const review = testCases.filter(item => ['review', 'manual', 'warning'].includes(item.status)).length;
    const passed = testCases.filter(item => item.status === 'passed').length;
    const counts = { critical: blockers, warning: failed, observation: review, passed };
    const checksRun = testCases.length;
    const completed = blockers + failed + passed;
    const score = completed ? Math.round(clamp((passed / completed) * 100, 0, 100)) : 0;
    const coverage = checksRun ? Math.round(clamp((completed / checksRun) * 100, 0, 100)) : 0;
    const rating = blockers > 0 ? 'Blocked' : failed > 0 ? 'Needs Attention' : review > 0 ? 'Needs Review' : 'Strong';

    const summary = {'''
s, n = counts_pattern.subn(counts_repl, s, count=1)
assert n == 1

summary_pattern = re.compile(r"    const summary = \{.*?\n    \};\n\n    const categoryCounts", re.S)
summary_repl = r'''    const summary = {
      riskLevel: blockers > 0 ? 'High' : failed > 0 ? 'Moderate' : review > 0 ? 'Review' : 'Low',
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

    const categoryCounts'''
s, n = summary_pattern.subn(summary_repl, s, count=1)
assert n == 1

s = s.replace('      reportVersion: 3,', '      reportVersion: 4,', 1)
s = s.replace('      rating,\n      summary,', '      rating,\n      coverage,\n      summary,', 1)
s = s.replace("        'The final form is never submitted automatically.',", "        'Safe Next/Continue/Save & Next actions may be tested after field checks; final submit/payment/generate-application actions are always protected.',", 1)
s = s.replace('`${report.counts.critical} critical • ${report.counts.warning} warning(s)`', '`${report.counts.critical} blocker(s) • ${report.counts.warning} failed`')
s = s.replace('`${qaReport.counts.critical} critical • ${qaReport.counts.warning} warning(s)`', '`${qaReport.counts.critical} blocker(s) • ${qaReport.counts.warning} failed`')

p.write_text(s, encoding='utf-8')
print('core QA patch applied')
