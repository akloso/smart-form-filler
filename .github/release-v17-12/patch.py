from pathlib import Path

PATH = Path('Smart_Form_Filler.user.js')
text = PATH.read_text(encoding='utf-8')

if '// @version      17.11.2' not in text:
    raise SystemExit('Expected Smart FormSense v17.11.2 source')


def replace_block(src: str, start: str, end: str, replacement: str) -> str:
    a = src.find(start)
    if a < 0:
        raise AssertionError(f'start marker not found: {start}')
    b = src.find(end, a)
    if b < 0:
        raise AssertionError(f'end marker not found: {end}')
    return src[:a] + replacement.rstrip() + '\n\n' + src[b:]


JOURNEY_BLOCK = r'''  const qaButtonText = el => normalize(
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
    const other = [];
    const nodes = [...document.querySelectorAll(
      'button,input[type="button"],input[type="submit"],a,[role="button"]'
    )];

    for (const el of nodes) {
      if (!isVisible(el) || el.disabled) continue;
      const text = qaButtonText(el);
      if (!text) continue;

      if (/\bsubmit\b|\bpay\b|payment|generate application|confirm admission|finali[sz]e|place order|complete application|finish application/.test(text)) {
        protectedFinal.push(el);
        continue;
      }

      if (/^(?:next|continue|proceed)$|save\s*(?:&|and)\s*(?:next|continue|proceed)|continue to|proceed to|next step|go next/.test(text)) {
        safe.push(el);
        continue;
      }

      other.push(el);
    }

    return { safe, protectedFinal, other };
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

    const observeSubmit = () => {
      submitAttempted = true;
    };

    try { form?.addEventListener('submit', observeSubmit, true); } catch {}
    try { button.click(); } catch {}
    await sleep(900);
    try { form?.removeEventListener('submit', observeSubmit, true); } catch {}

    const after = qaJourneyState();
    return {
      before,
      after,
      submitAttempted,
      progressed: before.url !== after.url || before.keys !== after.keys,
      buttonText: qaButtonText(button)
    };
  };

  const qaFeedbackQuality = text => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'missing';
    if (clean.length < 8 || /^(?:required|invalid|error|mandatory|please enter)$/i.test(clean)) return 'generic';
    return 'clear';
  };

  const qaValidationDigest = fields => {
    const entries = [];
    for (const el of fields || []) {
      if (!el?.isConnected) continue;
      const feedback = qaVisibleFeedback(el);
      if (!feedback.invalid) continue;
      entries.push({
        field: qaCleanLabel(qaHumanLabel(el), el),
        fieldKey: fieldKey(el),
        text: feedback.text || ''
      });
    }
    return {
      count: entries.length,
      signature: entries.map(item => `${item.fieldKey}:${item.text}`).sort().join('|'),
      entries
    };
  };

  const qaWaitForManualProgress = async (fields, timeoutMs = 15000) => {
    const before = qaJourneyState();
    const beforeValidation = qaValidationDigest(fields);
    let clickedText = '';
    let clickedAt = 0;

    const onClick = event => {
      const target = event.target?.closest?.('button,input[type="button"],input[type="submit"],a,[role="button"]');
      if (!target || !isVisible(target)) return;
      clickedText = qaButtonText(target) || 'form action';
      clickedAt = Date.now();
    };

    try { document.addEventListener('click', onClick, true); } catch {}
    state.panel?.setStatus?.('Manual step needed: click the form Continue / Save & Next / Submit button. Smart FormSense will watch the result.');
    state.panel?.setQaProgress?.(94, 'Manual step: click Continue / Submit on the form');

    const started = Date.now();
    try {
      while (Date.now() - started < timeoutMs) {
        if (state.stopRequested) break;
        await sleep(250);

        const after = qaJourneyState();
        const currentFields = visibleFillableFields().filter(el => !isLikelyInternalField(el));
        const afterValidation = qaValidationDigest(currentFields);
        const progressed = before.url !== after.url || before.keys !== after.keys;
        const validationChanged = beforeValidation.signature !== afterValidation.signature;

        if (progressed || validationChanged || (clickedAt && Date.now() - clickedAt >= 900)) {
          return {
            observed: true,
            clickedText,
            progressed,
            beforeValidation,
            afterValidation,
            waitedMs: Date.now() - started
          };
        }
      }
    } finally {
      try { document.removeEventListener('click', onClick, true); } catch {}
    }

    return {
      observed: false,
      clickedText,
      progressed: false,
      beforeValidation,
      afterValidation: qaValidationDigest(visibleFillableFields().filter(el => !isLikelyInternalField(el))),
      waitedMs: Date.now() - started
    };
  };

  const qaSelectStateSignature = el => [
    String(el?.value ?? ''),
    validOptions(el).length,
    !!el?.disabled,
    String(el?.className || '')
  ].join('|');

  const qaWaitForDependentSelect = async (el, beforeSignature, timeoutMs = 8000) => {
    const started = Date.now();
    let last = qaSelectStateSignature(el);
    let stableSince = Date.now();
    let reacted = last !== beforeSignature;

    while (Date.now() - started < timeoutMs) {
      if (state.stopRequested) break;
      await sleep(150);
      const now = qaSelectStateSignature(el);
      if (now !== last) {
        if (now !== beforeSignature) reacted = true;
        last = now;
        stableSince = Date.now();
      }

      const optionCount = validOptions(el).length;
      if (!el.disabled && optionCount > 0 && Date.now() - stableSince >= 500) {
        return {
          ready: true,
          reacted,
          optionCount,
          waitedMs: Date.now() - started
        };
      }
    }

    return {
      ready: !el.disabled && validOptions(el).length > 0,
      reacted,
      optionCount: validOptions(el).length,
      waitedMs: Date.now() - started
    };
  };

  const qaRunDependencyChain = async fields => {
    const map = new Map();
    for (const el of fields || []) {
      if (el.tagName !== 'SELECT') continue;
      const semantic = qaSemanticFor(el);
      if (semantic && !map.has(semantic)) map.set(semantic, el);
    }

    const semantics = ['country', 'state', 'district', 'city'];
    const chain = semantics
      .map(key => ({ semantic: key, el: map.get(key) }))
      .filter(item => item.el);

    if (chain.length < 2) return [];

    const snapshots = chain.map(item => [item.el, qaSnapshotFieldValue(item.el)]);
    const results = [];

    try {
      for (let i = 0; i < chain.length - 1; i++) {
        if (state.stopRequested) break;
        const parentInfo = chain[i];
        const childInfo = chain[i + 1];
        const parent = parentInfo.el;
        const child = childInfo.el;
        let parentOptions = validOptions(parent);

        if (!parentOptions.length) {
          results.push({
            el: child,
            status: 'review',
            name: 'Dependent dropdown could not be exercised',
            actual: `${qaCleanLabel(qaHumanLabel(parent), parent)} did not have a selectable value available.`,
            evidence: { parent: parentInfo.semantic, child: childInfo.semantic, waitMs: 0, optionCount: 0 }
          });
          break;
        }

        const current = String(parent.value ?? '');
        const selected = parentOptions.find(option => String(option.value) === current && current.trim());
        const india = parentInfo.semantic === 'country'
          ? parentOptions.find(option => /\bindia\b/i.test(String(option.textContent || '')))
          : null;
        const attempts = [];
        if (selected) attempts.push(selected);
        if (india && !attempts.includes(india)) attempts.push(india);
        for (const option of parentOptions.slice(0, 3)) {
          if (!attempts.includes(option)) attempts.push(option);
        }

        let result = null;
        for (const target of attempts.slice(0, 3)) {
          if (state.stopRequested) break;
          const before = qaSelectStateSignature(child);
          parent.value = target.value;
          qaDispatchInteraction(parent);
          result = await qaWaitForDependentSelect(child, before, 8000);
          if (result.ready && result.optionCount > 0) break;
        }

        const ready = !!result?.ready && Number(result?.optionCount || 0) > 0;
        results.push({
          el: child,
          status: ready ? 'passed' : 'review',
          name: ready ? 'Dependent dropdown loaded' : 'Dependent dropdown needs confirmation',
          actual: ready
            ? `${qaCleanLabel(qaHumanLabel(child), child)} became available with ${result.optionCount} option(s) after ${qaCleanLabel(qaHumanLabel(parent), parent)} was selected.`
            : `${qaCleanLabel(qaHumanLabel(child), child)} did not become ready within ${Math.round((result?.waitedMs || 0) / 100) / 10}s.`,
          evidence: {
            parent: parentInfo.semantic,
            child: childInfo.semantic,
            waitMs: result?.waitedMs || 0,
            optionCount: result?.optionCount || 0,
            reacted: !!result?.reacted
          }
        });

        if (!ready) break;

        const childOptions = validOptions(child);
        const currentChild = String(child.value ?? '');
        const childSelected = childOptions.find(option => String(option.value) === currentChild && currentChild.trim());
        const childTarget = childSelected || childOptions[0];
        if (childTarget) {
          child.value = childTarget.value;
          qaDispatchInteraction(child);
          await sleep(250);
        }
      }
    } finally {
      for (const [el, snapshot] of [...snapshots].reverse()) {
        if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
        await sleep(250);
      }
    }

    return results;
  };

  const qaRunJourneyChecks = async (fields, candidates) => {
    const rows = [];
    if (state.stopRequested) return rows;

    const liveFields = (fields || []).filter(el => el?.isConnected && !isLikelyInternalField(el));
    const buttons = qaFindJourneyButtons();
    const button = buttons.safe[0];

    if (!button) {
      if (buttons.protectedFinal.length || buttons.other.length) {
        const manual = await qaWaitForManualProgress(liveFields, 15000);
        if (manual.observed) {
          const newErrors = Math.max(0, manual.afterValidation.count - manual.beforeValidation.count);
          rows.push({
            status: manual.progressed || newErrors > 0 ? 'passed' : 'review',
            name: 'Manual Continue / Submit check',
            actual: manual.progressed
              ? `Your ${manual.clickedText || 'form action'} click moved the form forward and Smart FormSense detected the new step.`
              : newErrors > 0
                ? `Your ${manual.clickedText || 'form action'} click triggered validation on ${newErrors} additional field(s).`
                : `A form action was clicked, but Smart FormSense could not clearly confirm progression or new validation.`,
            evidence: {
              method: 'manual-assisted-journey',
              clickedText: manual.clickedText,
              progressed: manual.progressed,
              validationBefore: manual.beforeValidation.count,
              validationAfter: manual.afterValidation.count,
              waitedMs: manual.waitedMs
            }
          });
        } else {
          rows.push({
            status: 'review',
            name: 'Continue / Submit needs a manual click',
            actual: buttons.protectedFinal.length
              ? 'The only available progression action looks like a final Submit/transaction action, so Smart FormSense did not click it automatically.'
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

      const click = await qaClickJourneyButton(button);
      const messages = required
        .map(el => [el, qaVisibleFeedback(el)])
        .filter(([, feedback]) => feedback.invalid);

      if (messages.length) {
        rows.push({
          status: 'passed',
          name: 'Required fields block progression',
          actual: `The form stopped progression and showed validation on ${messages.length} required field(s).`,
          evidence: {
            method: 'safe-journey-click',
            buttonText: click.buttonText,
            progressed: click.progressed,
            validationFields: messages.map(([el]) => qaCleanLabel(qaHumanLabel(el), el))
          }
        });
      } else if (click.progressed || click.submitAttempted) {
        rows.push({
          status: 'failed',
          name: 'Required fields allowed progression',
          actual: 'The form attempted to continue while required test fields were blank and no clear validation was captured.',
          evidence: { method: 'safe-journey-click', buttonText: click.buttonText, progressed: click.progressed, submitAttempted: click.submitAttempted }
        });
      } else {
        rows.push({
          status: 'review',
          name: 'Required field messages need confirmation',
          actual: 'The form did not move forward, but Smart FormSense could not identify clear validation messages for the required fields.',
          evidence: { method: 'safe-journey-click', buttonText: click.buttonText, progressed: false }
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

    for (const candidate of (candidates || []).slice(0, 5)) {
      if (state.stopRequested) break;
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
          actual: `The form rejected the invalid value when ${click.buttonText || 'Continue'} was used.`,
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
          actual: `The invalid value ${JSON.stringify(entry.acceptedValue)} was allowed when ${click.buttonText || 'Continue'} was used.`,
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
          actual: 'The form did not continue, but no clear validation message was captured for this value.',
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
  };'''


BUILD_BLOCK = r'''  const buildQaFunctionalReport = async () => {
    const generatedAt = new Date().toISOString();
    const findings = [];
    const testCases = [];
    const journeyCandidates = [];
    const detected = new Map();
    const tested = new Set();
    let discoveryPasses = 0;

    const logicalKey = el => {
      const type = normalize(el?.type);
      if (type === 'radio') {
        return `radio:${el?.ownerDocument?.URL || ''}:${el?.name || fieldKey(el)}`;
      }
      return fieldKey(el);
    };

    const visibleQaFields = () => {
      try {
        return visibleFillableFields().filter(el =>
          el &&
          !isLikelyInternalField(el) &&
          !['hidden', 'submit', 'button', 'reset'].includes(normalize(el.type))
        );
      } catch {
        return [];
      }
    };

    const refreshDetected = () => {
      let added = 0;
      for (const el of visibleQaFields()) {
        const key = logicalKey(el);
        if (!key) continue;
        if (!detected.has(key)) added++;
        detected.set(key, el);
      }
      return added;
    };

    const currentFields = () => [...detected.values()]
      .filter(el => el?.isConnected && isFieldOperationallyVisible(el));

    refreshDetected();

    const assembleReport = (runState = 'running', stopReason = '') => {
      const blockers = testCases.filter(item => item.status === 'blocker').length;
      const failed = testCases.filter(item => item.status === 'failed').length;
      const review = testCases.filter(item => ['review', 'manual', 'warning'].includes(item.status)).length;
      const passed = testCases.filter(item => item.status === 'passed').length;
      const counts = { critical: blockers, warning: failed, observation: review, passed };
      const checksRun = testCases.length;
      const completed = blockers + failed + passed;
      const score = completed ? Math.round(clamp((passed / completed) * 100, 0, 100)) : 0;
      const fieldsAudited = detected.size;
      const fieldsChecked = Math.min(fieldsAudited, tested.size);
      const fieldCoverage = fieldsAudited ? Math.round((fieldsChecked / fieldsAudited) * 100) : 0;
      const coverage = checksRun ? Math.round(clamp((completed / checksRun) * 100, 0, 100)) : 0;
      const incomplete = runState !== 'completed';
      const uncoveredFields = [...detected.entries()]
        .filter(([key]) => !tested.has(key))
        .map(([, el]) => qaCleanLabel(qaHumanLabel(el), el));

      const journeyRows = testCases.filter(item => item.category === 'Journey Validation');
      const dependencyRows = testCases.filter(item => item.category === 'Dependencies');
      const journeyStatus = journeyRows.some(item => ['blocker', 'failed'].includes(item.status))
        ? 'Issue found'
        : journeyRows.some(item => item.status === 'passed')
          ? 'Checked'
          : journeyRows.length
            ? 'Needs manual check'
            : 'Not reached';
      const dependencyStatus = dependencyRows.some(item => ['blocker', 'failed'].includes(item.status))
        ? 'Issue found'
        : dependencyRows.length && dependencyRows.every(item => item.status === 'passed')
          ? 'Checked'
          : dependencyRows.some(item => item.status === 'passed')
            ? 'Partially checked'
            : dependencyRows.length
              ? 'Needs manual check'
              : 'Not applicable';

      const rating = incomplete
        ? (runState === 'failed' ? 'Interrupted' : runState === 'stopped' ? 'Stopped' : 'Running')
        : blockers > 0
          ? 'Blocked'
          : failed > 0
            ? 'Needs Attention'
            : review > 0 || fieldsChecked < fieldsAudited
              ? 'Needs Review'
              : 'Looks Good';

      const summary = {
        riskLevel: blockers > 0 ? 'High' : failed > 0 ? 'Moderate' : review > 0 || incomplete ? 'Review' : 'Low',
        headline: incomplete
          ? `${fieldsChecked} of ${fieldsAudited} detected field(s) have usable QA results so far.`
          : blockers > 0 || failed > 0
            ? `${blockers + failed} confirmed applicant-facing problem(s) were reproduced.`
            : review > 0
              ? `No confirmed problem was reproduced. ${review} check(s) still need confirmation.`
              : 'No applicant-facing problem was reproduced in the completed checks.',
        recommendation: incomplete
          ? 'Use this partial report, then rerun QA for the remaining fields.'
          : blockers > 0 || failed > 0
            ? 'Fix the confirmed issues, rerun QA, then complete the listed manual checks.'
            : review > 0 || fieldsChecked < fieldsAudited
              ? 'Complete only the listed manual checks before sign-off.'
              : 'Complete a brief final human check before sign-off.',
        fieldsAudited,
        fieldsChecked,
        fieldCoverage,
        checksRun,
        completed,
        coverage,
        score,
        journeyStatus,
        dependencyStatus
      };

      const categoryCounts = {};
      for (const item of findings) {
        categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
      }

      return {
        reportVersion: 6,
        product: 'Smart FormSense',
        productVersion: '17.12.0',
        generatedAt,
        completedAt: ['completed', 'stopped', 'failed'].includes(runState) ? new Date().toISOString() : null,
        auditType: 'Black-box Functional Form QA',
        runState,
        incomplete,
        stopReason: String(stopReason || '').slice(0, 500),
        page: {
          url: location.href,
          hostname: location.hostname,
          pathname: location.pathname,
          title: document.title || ''
        },
        formSignature: state.currentFormSignature || null,
        fieldsAudited,
        fieldsChecked,
        fieldCoverage,
        uncoveredFields,
        discoveryPasses,
        checksRun,
        score,
        rating,
        coverage,
        journeyStatus,
        dependencyStatus,
        summary,
        counts,
        categoryCounts,
        findings: [...findings],
        testCases: [...testCases],
        notes: [
          'Field totals represent logical user-facing fields discovered during this QA run; radio options in the same group count as one field.',
          'Smart FormSense rescans the full active form after field checks, dependencies and journey actions so newly loaded controls can be tested.',
          'Dependent dropdowns are allowed up to 8 seconds to load and stabilize before they are marked for review.',
          'Safe Continue/Next/Save & Next actions may be clicked automatically. Final Submit/payment/application-generation actions remain user-controlled.',
          'When Smart FormSense cannot safely continue automatically, it asks the user to click the form action and watches for progression or validation.',
          'File uploads, some date widgets and conditional paths that never become active can still require manual QA.',
          incomplete ? 'This report is partial. Completed checks are preserved even when QA is stopped or interrupted.' : ''
        ].filter(Boolean)
      };
    };

    const publishPartial = (runState = 'running', stopReason = '', forceUi = false) => {
      const report = assembleReport(runState, stopReason);
      state.qaReport = report;
      if (forceUi || testCases.length <= 1 || testCases.length % 3 === 0 || runState !== 'running') {
        state.panel?.setQaReport?.(report);
      }
      return report;
    };

    publishPartial('running', '', true);
    state.panel?.setQaProgress?.(2, `Preparing ${detected.size} field(s)`);

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
      if (status !== 'passed') {
        const severity = status === 'blocker' ? 'critical' : status === 'failed' ? 'warning' : 'observation';
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
              ? 'Review this form setting and rerun QA.'
              : 'Confirm this behaviour during the remaining manual check.'
          ),
          testCaseId: row.id,
          attemptedValue,
          evidence
        });
      }

      publishPartial('running');
      return row;
    };

    const testField = async (key, el) => {
      if (state.stopRequested || tested.has(key)) return;
      const beforeCount = testCases.length;
      const type = normalize(el?.type);
      const label = qaCleanLabel(qaHumanLabel(el), el);

      try {
        if (!el?.isConnected) return;
        const requiredSignals = qaRequiredSignals(el);
        const required = !!(requiredSignals.visible || requiredSignals.configured || isRequired(el));

        if (type === 'file') {
          addCase({
            el,
            category: 'File Upload',
            name: 'File upload behaviour',
            status: 'review',
            expected: required
              ? 'A valid file can be uploaded; invalid type/size is rejected; a missing required file blocks progression.'
              : 'A valid file can be uploaded and invalid type/size is rejected.',
            actual: 'A real file must be selected manually for this check.',
            guidance: 'Try one valid file, one wrong file type, one oversized file, then remove and upload again.'
          });
          tested.add(key);
          return;
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
              expected: 'The calendar opens, valid dates can be selected and the chosen value remains.',
              actual: 'This field uses a calendar control that needs a quick manual check.',
              guidance: 'Open the calendar, check allowed/blocked dates, select a date, close it and confirm the value remains.'
            });
          } else if (fieldHasValue(el)) {
            addCase({
              el,
              category: 'Prefilled Fields',
              name: 'Prefilled locked field',
              status: 'passed',
              expected: 'The prefilled value remains present and cannot be accidentally edited.',
              actual: 'The prefilled value stayed present and the field remained locked.'
            });
          } else {
            addCase({
              el,
              category: 'Prefilled Fields',
              name: 'Locked field needs confirmation',
              status: required ? 'review' : 'passed',
              expected: required ? 'A required locked field should be populated before it can block the applicant.' : 'An optional locked field may remain empty.',
              actual: required ? 'The field is required, locked and currently empty.' : 'The optional locked field is empty.',
              guidance: required ? 'Confirm an earlier answer or step fills this field before the applicant needs it.' : ''
            });
          }
          tested.add(key);
          return;
        }

        if (required) {
          const result = await qaRunRequiredBlankCase(el);
          addCase({
            el,
            category: 'Mandatory Validation',
            name: 'Required-field behaviour',
            status: result.status,
            expected: 'A required field should stop the applicant when left empty and show a useful message at the right time.',
            actual: result.actual,
            evidence: { method: 'field-blank-probe', feedback: result.feedback || '' },
            guidance: result.status === 'review'
              ? 'Use the form Continue/Submit action once and confirm this field is caught before the applicant can proceed.'
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
            expected: 'The applicant can choose an available option and the selection stays selected.',
            actual: result.actual
          });
        } else if (['checkbox', 'radio'].includes(type)) {
          const result = await qaRunToggleCase(el);
          addCase({
            el,
            category: 'Choice Controls',
            name: 'Selection behaviour',
            status: result.status,
            expected: 'The applicant can change the selection and the control responds correctly.',
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
            expected: 'Percentage/CGPA limits should match the selected marking scheme.',
            actual: 'This field supports more than one marking scheme, so the correct range depends on the selected option.',
            guidance: 'Switch between Percentage and CGPA and confirm the accepted range and error message change correctly.'
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
              ? 'The invalid value should be rejected before the applicant can continue.'
              : 'The valid value should be accepted without an error.',
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

        if (testCases.length === beforeCount) {
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
        }
      } catch (error) {
        addCase({
          el: el?.isConnected ? el : null,
          category: 'Field Coverage',
          name: 'Field changed while being checked',
          status: 'review',
          expected: 'The field remains available long enough to complete its check.',
          actual: `${label || 'A field'} changed or reloaded while Smart FormSense was checking it.`,
          guidance: 'Check this field once manually after the form finishes loading.',
          evidence: { error: String(error?.message || error || 'unknown error').slice(0, 200) }
        });
      } finally {
        tested.add(key);
      }
    };

    const qaRunDiscoverySweep = async (label, maxPasses = 3) => {
      let stableRounds = 0;
      for (let pass = 0; pass < maxPasses && !state.stopRequested; pass++) {
        discoveryPasses++;
        const beforeDetected = detected.size;
        refreshDetected();
        const pending = [...detected.entries()].filter(([key, el]) => !tested.has(key) && el?.isConnected);
        if (!pending.length) {
          await sleep(500);
          const added = refreshDetected();
          if (!added && detected.size === beforeDetected) {
            stableRounds++;
            if (stableRounds >= 1) break;
          }
          continue;
        }

        stableRounds = 0;
        let index = 0;
        for (const [key, el] of pending) {
          if (state.stopRequested) break;
          index++;
          const base = Math.min(78, 5 + Math.round((tested.size / Math.max(1, detected.size)) * 70));
          state.panel?.setQaProgress?.(base, `${label} • ${index}/${pending.length} • ${qaCleanLabel(qaHumanLabel(el), el)}`);
          await testField(key, el);
          await yieldToUI();
          refreshDetected();
        }
      }
    };

    if (!detected.size) {
      addCase({
        category: 'Form Detection',
        name: 'Detect active form',
        status: 'review',
        expected: 'At least one active user-facing form field',
        actual: 'No active user-facing form fields were detected.',
        guidance: 'Confirm the form is fully loaded and the correct page/frame is active.'
      });
    }

    state.panel?.setStatus?.(`Functional QA • checking ${detected.size} detected field(s)...`);
    await qaRunDiscoverySweep('Checking fields', 4);

    if (!state.stopRequested) {
      state.panel?.setQaProgress?.(82, 'Checking dependent fields and slow-loading dropdowns');
      for (const row of await qaRunDependencyChain(currentFields())) {
        addCase({
          el: row.el || null,
          category: 'Dependencies',
          name: row.name,
          status: row.status,
          expected: 'Dependent fields should become available in the correct parent-to-child order.',
          actual: row.actual,
          evidence: row.evidence || null,
          guidance: row.status === 'review'
            ? 'Change the parent selection once and confirm the dependent field loads before the applicant continues.'
            : ''
        });
      }
      await qaRunDiscoverySweep('Rescanning after dependencies', 3);
    }

    if (!state.stopRequested) {
      state.panel?.setQaProgress?.(91, 'Checking form progression and deferred validation');
      for (let round = 0; round < 3 && !state.stopRequested; round++) {
        const beforeKeys = detected.size;
        const rows = await qaRunJourneyChecks(currentFields(), journeyCandidates);
        for (const row of rows) {
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
        }

        await qaRunDiscoverySweep('Scanning the form again after progression', 3);
        if (detected.size <= beforeKeys || !rows.some(row => row.evidence?.progressed)) break;
      }
    }

    if (!state.stopRequested) {
      state.panel?.setQaProgress?.(97, 'Final full-form missed-field sweep');
      await qaRunDiscoverySweep('Final missed-field sweep', 4);
      refreshDetected();
    }

    const finalState = state.stopRequested ? 'stopped' : 'completed';
    const finalReason = state.stopRequested ? 'Stopped by user' : '';
    const report = publishPartial(finalState, finalReason, true);
    state.panel?.setQaProgress?.(
      finalState === 'completed' ? 100 : Math.max(1, Number(state.qaProgressPercent || 0)),
      finalState === 'completed'
        ? `QA completed • ${report.fieldsChecked}/${report.fieldsAudited} detected fields covered`
        : `Stopped • ${report.fieldsChecked}/${report.fieldsAudited} detected fields covered`
    );
    return report;
  };'''


REPORT_BLOCK = r'''  const buildQaFriendlyHtml = report => {
    const qa = report || state.qaReport;
    if (!qa) return '';

    const esc = qaEscapeHtml;
    const grouped = qaGroupedFindings(qa);
    const confirmed = grouped.filter(item => ['critical', 'warning'].includes(item.severity));
    const reviewRaw = grouped.filter(item => item.severity === 'observation');
    const passed = Number(qa.counts?.passed || 0);
    const detectedCount = Number(qa.fieldsAudited || 0);
    const checkedCount = Number(qa.fieldsChecked || 0);
    const fieldCoverage = Number(qa.fieldCoverage ?? qa.summary?.fieldCoverage ?? (detectedCount ? Math.round((checkedCount / detectedCount) * 100) : 0));

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
      if (/mandatory validation|required-field|required field/.test(text)) {
        putReview('required', 'Required fields need confirmation', 'Some required fields did not show an error immediately when left empty.', 'Use Continue/Submit once with these fields empty. Make sure the form stops the applicant and shows a clear message.', item.fields);
      } else if (/mobile/.test(text)) {
        putReview('mobile', 'Mobile number validation needs confirmation', 'Invalid or short mobile numbers could be typed without an immediate error.', 'Make sure invalid and short mobile numbers are rejected before the applicant can continue.', item.fields);
      } else if (/pincode|postal|zip/.test(text)) {
        putReview('pincode', 'Pincode validation needs confirmation', 'An invalid or short pincode could be typed without an immediate error.', 'Make sure the pincode is rejected before the applicant can continue.', item.fields);
      } else if (/name/.test(text) && /numeric|reject|validation/.test(text)) {
        putReview('name', 'Name validation needs confirmation', 'Numbers could be entered in one or more name fields without an immediate error.', 'Make sure numeric-only names are rejected before the applicant can continue.', item.fields);
      } else if (/date picker|date-picker/.test(text)) {
        putReview('date', 'Date fields need a quick manual check', 'These fields use a calendar control that cannot be fully verified through typing alone.', 'Open each calendar, check allowed/blocked dates, select a date and confirm it remains saved.', item.fields);
      } else if (/file upload/.test(text)) {
        putReview('file', 'File uploads need a quick manual check', 'Real files are required to verify upload behaviour.', 'Try a valid file, wrong file type, oversized file, remove it and upload again.', item.fields);
      } else if (/dependenc|dropdown behaviour|option selection/.test(text)) {
        putReview('dependency', 'Dependent dropdowns need confirmation', 'One or more dependent dropdowns were not fully confirmed during the automated run.', 'Change the parent selection and confirm each child dropdown loads the correct options before continuing.', item.fields);
      } else if (/marks range|marking scheme|percentage|cgpa/.test(text)) {
        putReview('marks', 'Percentage / CGPA rules need confirmation', 'The allowed range depends on the selected marking scheme.', 'Switch the marking scheme and confirm the allowed values and error message change correctly.', item.fields);
      } else if (/journey validation|continue|submit|progression/.test(text)) {
        putReview('journey', 'Form progression needs confirmation', 'Smart FormSense could not fully complete this progression step automatically.', 'Click the form Continue/Save & Next/Submit action once and confirm validation appears before incorrect data can proceed.', item.fields);
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
          ? 'Needs Manual Confirmation'
          : 'Ready for Final Sign-off';

    const overview = confirmed.length
      ? `${confirmed.length} confirmed issue type${confirmed.length === 1 ? '' : 's'} need attention.`
      : review.length
        ? 'No confirmed problem was reproduced, but a few areas still need a quick manual check before sign-off.'
        : 'No applicant-facing problem was reproduced in the completed checks.';

    const fieldsLine = fields => {
      const list = [...new Set(fields || [])];
      if (!list.length) return '';
      return `<div class="fields"><b>Fields:</b> ${list.map(esc).join(', ')}</div>`;
    };

    const confirmedHtml = confirmed.length
      ? `<section><h2>What needs fixing <span>${confirmed.length}</span></h2>${confirmed.map(item => `
          <article class="item issue">
            <div class="itemTitle">❌ ${esc(item.title)}</div>
            ${fieldsLine(item.fields)}
            <div class="what">${esc(item.message || 'This behaviour did not work as expected for an applicant.')}</div>
            <div class="action"><b>What to do:</b> ${esc(item.guidance || 'Review this form setting and rerun QA.')}</div>
          </article>`).join('')}</section>`
      : '';

    const reviewHtml = review.length
      ? `<section><h2>What you still need to check <span>${review.length}</span></h2>${review.map(item => `
          <article class="item review">
            <div class="itemTitle">⚠ ${esc(item.title)}</div>
            ${fieldsLine(item.fields)}
            <div class="what">${esc(item.what)}</div>
            <div class="action"><b>Check:</b> ${esc(item.action)}</div>
          </article>`).join('')}</section>`
      : '';

    const uncovered = Array.isArray(qa.uncoveredFields) ? qa.uncoveredFields : [];

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart FormSense QA Report</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f7fa;color:#242633;font-family:Inter,Segoe UI,Arial,sans-serif}.wrap{max-width:860px;margin:auto;padding:28px 18px 44px}.top,.item,.passed,.coverage{background:#fff;border:1px solid #e7e7ee;border-radius:14px}.top{padding:20px}.brand{font-size:13px;font-weight:850;color:#5b4bff}.top h1{font-size:22px;margin:5px 0}.meta{font-size:12px;color:#747887;line-height:1.5}.status{display:inline-block;margin-top:12px;padding:6px 10px;border-radius:999px;background:#f2efff;color:#5b4bff;font-size:12px;font-weight:850}.overview{margin-top:12px;font-size:13px;line-height:1.55;color:#4b5563}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:15px}.metric{border:1px solid #e8e8ef;border-radius:10px;padding:10px 7px;text-align:center}.metric b{display:block;font-size:18px}.metric span{font-size:9px;color:#777b88;font-weight:750}.coverage{margin-top:12px;padding:11px 12px;font-size:11px;line-height:1.6;color:#555b68}.coverage b{color:#272a35}section{margin-top:24px}h2{font-size:16px;margin:0 0 9px}h2 span{font-size:10px;background:#ececf2;border-radius:999px;padding:3px 6px;color:#666}.item{border-left:4px solid #d97706;padding:13px;margin:8px 0}.item.issue{border-left-color:#dc2626}.itemTitle{font-size:14px;font-weight:850}.fields,.what,.action{margin-top:6px;font-size:11px;line-height:1.55;color:#606473}.action{background:#f7f7fb;border-radius:8px;padding:8px 9px}.partial{margin-top:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:11px;padding:10px 12px;font-size:11px;color:#9a3412}.passed{margin-top:24px;padding:12px;font-size:12px;color:#166534;background:#f0fdf4;border-color:#bbf7d0}.note{margin-top:16px;font-size:10px;line-height:1.55;color:#858895}.footer{text-align:center;margin-top:24px;font-size:10px;color:#9295a1}@media(max-width:650px){.summary{grid-template-columns:repeat(2,1fr)}}@media print{body{background:#fff}.wrap{padding:0}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="brand">✦ Smart FormSense QA</div>
    <h1>${esc(qa.page?.title || 'Form')}</h1>
    <div class="meta">${esc(qa.page?.hostname || location.hostname || '')}<br>${esc(generated)} • v${esc(qa.productVersion || '17.12.0')}</div>
    <div class="status">${esc(status)}</div>
    <div class="overview">${esc(overview)}</div>
    <div class="summary">
      <div class="metric"><b>${checkedCount}/${detectedCount}</b><span>FIELDS COVERED</span></div>
      <div class="metric"><b>${confirmed.length}</b><span>ISSUE TYPES</span></div>
      <div class="metric"><b>${review.length}</b><span>MANUAL CHECK AREAS</span></div>
      <div class="metric"><b>${passed}</b><span>CHECKS PASSED</span></div>
    </div>
    <div class="coverage">
      <b>Field coverage:</b> ${fieldCoverage}% &nbsp;•&nbsp;
      <b>Dependent fields:</b> ${esc(qa.dependencyStatus || qa.summary?.dependencyStatus || 'Not checked')} &nbsp;•&nbsp;
      <b>Form progression:</b> ${esc(qa.journeyStatus || qa.summary?.journeyStatus || 'Not checked')}
      ${uncovered.length ? `<br><b>Not fully covered:</b> ${uncovered.map(esc).join(', ')}` : ''}
    </div>
  </div>

  ${qa.incomplete ? `<div class="partial"><b>Partial report.</b> Completed checks are still usable. ${qa.stopReason ? esc(qa.stopReason) : ''}</div>` : ''}
  ${confirmedHtml}
  ${reviewHtml}
  <div class="passed">✓ ${passed} checks were confirmed OK.</div>
  <div class="note">This report only shows what the form QC user needs to act on. Technical evidence, test values and diagnostic details remain in Export Debug. Smart FormSense can click safe Continue/Next/Save & Next actions; final Submit/payment/application-generation stays under the user's control.</div>
  <div class="footer">Created with love ❤️ Akash Singh • Smart FormSense</div>
</div>
</body>
</html>`;
  };'''


text = replace_block(
    text,
    '  const qaButtonText = el => normalize(',
    '  const qaFunctionalCasesFor = el => {',
    JOURNEY_BLOCK
)

text = replace_block(
    text,
    '  const buildQaFunctionalReport = async () => {',
    '  const runSmartQaAudit = async () => {',
    BUILD_BLOCK
)

text = replace_block(
    text,
    '  const buildQaFriendlyHtml = report => {',
    '  const exportQaReport = report => {',
    REPORT_BLOCK
)

# Version and wording cleanup.
text = text.replace('// @version      17.11.2', '// @version      17.12.0')
text = text.replace('Smart FormSense V17.11.2', 'Smart FormSense V17.12.0')
text = text.replace("productVersion:\n        '17.11.2'", "productVersion:\n        '17.12.0'")
text = text.replace("productVersion: '17.11.2'", "productVersion: '17.12.0'")
text = text.replace("productVersion:\n        '17.9.0'", "productVersion:\n        '17.12.0'")
text = text.replace("productVersion: '17.9.0'", "productVersion: '17.12.0'")
text = text.replace('FUNCTIONAL QA SCORE', 'FIELD COVERAGE')
text = text.replace("refs.qaScore.textContent = `${Number(report.score || 0)}/100`;", "refs.qaScore.textContent = `${Number(report.fieldsChecked || 0)}/${Number(report.fieldsAudited || 0)}`;")
text = text.replace(
    "refs.qaRating.textContent = `${report.incomplete ? 'Partial • ' : ''}${report.rating || 'Review'} • ${fieldText} • ${Number(report.coverage ?? report.summary?.coverage ?? 0)}% auto coverage`;",
    "refs.qaRating.textContent = `${report.incomplete ? 'Partial • ' : ''}${report.rating || 'Review'} • ${Number(report.fieldCoverage ?? report.summary?.fieldCoverage ?? 0)}% field coverage • ${Number(report.counts?.passed || 0)} checks passed`;"
)
text = text.replace(
    "`Functional QA completed • Score ${report.score}/100 • ${report.counts.critical} blocker(s) • ${report.counts.warning} failed`",
    "`Functional QA completed • ${report.fieldsChecked}/${report.fieldsAudited} fields covered • ${report.counts.critical} blocker(s) • ${report.counts.warning} failed`"
)
text = text.replace(
    "`Embedded Functional QA completed • Score ${qaReport.score}/100 • ${qaReport.counts.critical} critical • ${qaReport.counts.warning} warning(s)`",
    "`Embedded Functional QA completed • ${qaReport.fieldsChecked}/${qaReport.fieldsAudited} fields covered • ${qaReport.counts.critical} blocker(s) • ${qaReport.counts.warning} failed`"
)
text = text.replace(
    'Applicant-side QA: safe field + Next/Continue tests; final submit/payment stays protected.',
    'Applicant-side QA: rescans dynamic fields, waits for dependencies and checks progression. Final submit/payment stays user-controlled.'
)

PATH.write_text(text, encoding='utf-8')
print('Patched Smart FormSense to v17.12.0')
