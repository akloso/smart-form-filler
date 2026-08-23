from pathlib import Path
import re

path = Path('Smart_Form_Filler.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    assert count == 1, f'{label}: expected 1 exact match, found {count}'
    text = text.replace(old, new, 1)


def regex_once(pattern, repl, label, flags=re.S):
    global text
    text, count = re.subn(pattern, repl, text, count=1, flags=flags)
    assert count == 1, f'{label}: expected 1 regex match, found {count}'


assert '// @version      17.13.3' in text
text = text.replace('// @version      17.13.3', '// @version      17.13.4', 1)
text = text.replace('Smart FormSense V17.13.3', 'Smart FormSense V17.13.4')
text = text.replace("'17.13.3'", "'17.13.4'")
text = text.replace("qa.productVersion || '17.13.2'", "qa.productVersion || '17.13.4'")

# Validation evidence: the form-filling engine already marks validated controls
# with ERROR_ATTR. Reuse that proven signal in Functional QA so delayed custom
# validators can resolve Review checks after Next/Continue.
replace_once(
"""    try {
      const direct = validationText(el);
      if (direct) parts.push(String(direct));
    } catch {}

    try {
      const container = fieldContainerFor(el) || el.parentElement;
""",
"""    try {
      const direct = validationText(el);
      if (direct) parts.push(String(direct));
    } catch {}

    try {
      const marked = visualTarget(el)?.getAttribute?.(ERROR_ATTR) || '';
      if (marked) parts.push(String(marked));
    } catch {}

    try {
      const container = fieldContainerFor(el) || el.parentElement;
""",
'qaVisibleFeedback ERROR_ATTR bridge'
)

replace_once(
"""    for (const el of list) {
      const feedback = qaVisibleFeedback(el);
      if (feedback.invalid) add(el, feedback.text || 'Validation error', 'field');
    }
""",
"""    for (const el of list) {
      const feedback = qaVisibleFeedback(el);
      if (feedback.invalid) add(el, feedback.text || 'Validation error', 'field');

      try {
        const marked = visualTarget(el)?.getAttribute?.(ERROR_ATTR) || '';
        if (marked) add(el, marked, 'formsense-marker');
      } catch {}
    }
""",
'qaValidationDigest ERROR_ATTR bridge'
)

text = text.replace('while (Date.now() - started < 2600) {', 'while (Date.now() - started < 4200) {', 1)
text = text.replace('await sleep(260);', 'await sleep(350);', 1)

# Replace geography-only dependency QA with geography + generic parent/child
# discovery. Values are restored at the end; successful temporary child choices
# are kept only during the dependency probe so downstream fields can load.
new_dependency = r'''  const qaRunDependencyChain = async fields => {
    const selects = (fields || []).filter(
      el => el?.isConnected && el.tagName === 'SELECT' && !isLikelyInternalField(el)
    );
    if (selects.length < 2) return [];

    const snapshots = selects.map(el => [el, qaSnapshotFieldValue(el)]);
    const results = [];
    const testedChildren = new Set();

    const ownText = el => normalize([
      qaCleanLabel(qaHumanLabel(el), el),
      el?.name,
      el?.id,
      el?.getAttribute?.('placeholder')
    ].filter(Boolean).join(' '));

    const parentScore = (parent, child, parentIndex, childIndex) => {
      const p = ownText(parent);
      const c = ownText(child);
      let score = Math.max(0, 5 - Math.max(0, childIndex - parentIndex));

      const pairs = [
        [/country/, /state|province/, 30],
        [/state|province/, /district/, 30],
        [/district/, /city|town/, 30],
        [/entry|type|program|programme|course|degree|level/, /course|program|programme|preference|speciali[sz]ation|branch|campus|stream/, 24],
        [/course|program|programme|degree|qualification/, /speciali[sz]ation|branch|preference|major|minor|stream/, 22],
        [/category|faculty|school|department/, /course|program|programme|speciali[sz]ation|branch|preference/, 18],
        [/course preference 1|preference 1/, /course preference 2|preference 2/, 28],
        [/course preference 2|preference 2/, /course preference 3|preference 3/, 28]
      ];

      for (const [parentPattern, childPattern, weight] of pairs) {
        if (parentPattern.test(p) && childPattern.test(c)) score += weight;
      }

      if (/title|gender|religion|blood|marital|nationality/.test(p)) score -= 18;
      return score;
    };

    const exercisePair = async (parent, child, evidenceType = 'generic') => {
      const parentOptions = qaRealSelectOptions(parent);
      if (!parentOptions.length || parent.disabled) return null;

      const current = String(parent.value ?? '');
      const selected = parentOptions.find(option => String(option.value) === current && current.trim());
      const india = /country/.test(ownText(parent))
        ? parentOptions.find(option => /\bindia\b/i.test(String(option.textContent || '')))
        : null;
      const attempts = [];
      if (selected) attempts.push(selected);
      if (india && !attempts.includes(india)) attempts.push(india);
      for (const option of parentOptions.slice(0, 3)) {
        if (!attempts.includes(option)) attempts.push(option);
      }

      let result = null;
      let chosen = null;
      for (const target of attempts.slice(0, 3)) {
        if (state.stopRequested) break;
        const before = qaSelectStateSignature(child);
        parent.value = target.value;
        qaDispatchInteraction(parent);
        result = await qaWaitForDependentSelect(child, before, evidenceType === 'geography' ? 8000 : 6000);
        chosen = target;
        if (result.ready && result.optionCount > 0) break;
      }

      if (!result?.ready || Number(result.optionCount || 0) <= 0) return null;

      state.dependencyGraph.set(fieldKey(child), fieldKey(parent));
      const childOptions = qaRealSelectOptions(child);
      const childCurrent = String(child.value ?? '');
      const childSelected = childOptions.find(option => String(option.value) === childCurrent && childCurrent.trim());
      const childTarget = childSelected || childOptions[0];
      if (childTarget) {
        child.value = childTarget.value;
        qaDispatchInteraction(child);
        await sleep(300);
      }

      return {
        result,
        chosen,
        parentLabel: qaCleanLabel(qaHumanLabel(parent), parent),
        childLabel: qaCleanLabel(qaHumanLabel(child), child)
      };
    };

    try {
      // Keep the explicit geographic path because it is common and deterministic.
      const bySemantic = new Map();
      for (const el of selects) {
        const semantic = qaSemanticFor(el);
        if (semantic && !bySemantic.has(semantic)) bySemantic.set(semantic, el);
      }
      const geo = ['country', 'state', 'district', 'city']
        .map(key => ({ semantic: key, el: bySemantic.get(key) }))
        .filter(item => item.el);

      for (let index = 0; index < geo.length - 1; index++) {
        if (state.stopRequested) break;
        const parentInfo = geo[index];
        const childInfo = geo[index + 1];
        const exercised = await exercisePair(parentInfo.el, childInfo.el, 'geography');
        testedChildren.add(fieldKey(childInfo.el));

        results.push({
          el: childInfo.el,
          status: exercised ? 'passed' : 'review',
          name: exercised ? 'Dependent dropdown loaded' : 'Dependent dropdown needs confirmation',
          actual: exercised
            ? `${exercised.childLabel} became available with ${exercised.result.optionCount} option(s) after ${exercised.parentLabel} was selected.`
            : `${qaCleanLabel(qaHumanLabel(childInfo.el), childInfo.el)} did not become ready after its parent selection was exercised.`,
          evidence: exercised
            ? {
                parent: parentInfo.semantic,
                child: childInfo.semantic,
                waitMs: exercised.result.waitedMs || 0,
                optionCount: exercised.result.optionCount || 0,
                reacted: !!exercised.result.reacted
              }
            : { parent: parentInfo.semantic, child: childInfo.semantic }
        });

        if (!exercised) break;
      }

      // Generic dependency discovery borrows the form-filling engine's principle:
      // change a likely parent, wait for downstream controls to stabilize, then
      // keep the temporary valid child choice only long enough to reveal the next link.
      const dependencyLike = /state|province|district|city|town|course|program|programme|speciali[sz]ation|branch|campus|preference|stream|qualification|degree|subject|major|minor/;

      for (let pass = 0; pass < 4 && !state.stopRequested; pass++) {
        let progressed = false;

        for (let childIndex = 0; childIndex < selects.length; childIndex++) {
          const child = selects[childIndex];
          const childKey = fieldKey(child);
          if (testedChildren.has(childKey) || !dependencyLike.test(ownText(child))) continue;
          if (!child?.isConnected) continue;

          const hasOptions = qaRealSelectOptions(child).length > 0 && !child.disabled;
          if (hasOptions) continue;

          const parents = selects
            .map((parent, parentIndex) => ({ parent, parentIndex, score: parentScore(parent, child, parentIndex, childIndex) }))
            .filter(row => row.parentIndex < childIndex && row.parent !== child && row.score > 0 && !row.parent.disabled && qaRealSelectOptions(row.parent).length > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 4);

          let exercised = null;
          let matchedParent = null;
          for (const row of parents) {
            exercised = await exercisePair(row.parent, child, 'generic');
            if (exercised) {
              matchedParent = row.parent;
              break;
            }
          }

          if (exercised && matchedParent) {
            testedChildren.add(childKey);
            progressed = true;
            results.push({
              el: child,
              status: 'passed',
              name: 'Dependent dropdown loaded',
              actual: `${exercised.childLabel} loaded after ${exercised.parentLabel} was selected.`,
              evidence: {
                parentFieldKey: fieldKey(matchedParent),
                childFieldKey: childKey,
                parentLabel: exercised.parentLabel,
                childLabel: exercised.childLabel,
                waitMs: exercised.result.waitedMs || 0,
                optionCount: exercised.result.optionCount || 0,
                reacted: !!exercised.result.reacted,
                discovered: true
              }
            });
          }
        }

        if (!progressed) break;
      }

      for (const child of selects) {
        const key = fieldKey(child);
        if (testedChildren.has(key) || !dependencyLike.test(ownText(child))) continue;
        if (qaRealSelectOptions(child).length > 0 && !child.disabled) continue;

        testedChildren.add(key);
        results.push({
          el: child,
          status: 'review',
          name: 'Dependent dropdown needs confirmation',
          actual: `${qaCleanLabel(qaHumanLabel(child), child)} still had no selectable option after likely parent controls were exercised.`,
          evidence: { childFieldKey: key, discovered: false }
        });
      }
    } finally {
      for (const [el, snapshot] of [...snapshots].reverse()) {
        if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
        await sleep(120);
      }
    }

    return results;
  };
'''
regex_once(
    r"  const qaRunDependencyChain = async fields => \{.*?\n  \};\n\n  const qaRunJourneyChecks = async",
    new_dependency + "\n  const qaRunJourneyChecks = async",
    'qaRunDependencyChain replacement'
)

# Report wording: field names are shown only for genuine misses or confirmed
# issues. Review/pending checks remain a count, not a 19-field dump.
replace_once(
"""    const validationCoverage = Number(qa.validationCoverage ?? qa.summary?.validationCoverage ?? 0);

    const generated = (() => {
""",
"""    const validationCoverage = Number(qa.validationCoverage ?? qa.summary?.validationCoverage ?? 0);
    const pendingChecks = Number(qa.counts?.observation || 0);

    const generated = (() => {
""",
'pending check count'
)

text = text.replace(
"""        : manualFields.length || uncovered.length || qa.journeyStatus === 'Needs manual check'
          ? 'Needs Manual Confirmation'
""",
"""        : pendingChecks || uncovered.length || qa.journeyStatus === 'Needs manual check'
          ? 'Needs Manual Confirmation'
""",
2
)

replace_once(
"""      : uncovered.length
        ? `${uncovered.length} field${uncovered.length === 1 ? '' : 's'} were not fully checked.`
        : manualFields.length
          ? `${manualFields.length} field${manualFields.length === 1 ? '' : 's'} still need a quick manual check.`
          : 'The automated checks completed without a confirmed applicant-facing issue.';
""",
"""      : uncovered.length
        ? `${uncovered.length} field${uncovered.length === 1 ? '' : 's'} were not checked.`
        : pendingChecks
          ? `${pendingChecks} check${pendingChecks === 1 ? '' : 's'} still need confirmation. No field was missed.`
          : 'The automated checks completed without a confirmed applicant-facing issue.';
""",
'overview wording'
)

replace_once(
"""      <div class=\"metric reviewMetric\"><b>${manualFields.length + uncovered.length}</b><span>FIELDS TO CHECK</span></div>
""",
"""      <div class=\"metric reviewMetric\"><b>${uncovered.length}</b><span>FIELDS MISSED</span></div>
""",
'fields missed metric'
)

regex_once(
    r"    const manualHtml = manualFields\.length\n      \? `.*?\n      : '';",
    "    const manualHtml = '';",
    'remove manual field-name dump'
)

text = text.replace('<span class="checkDot">✓</span>', '<span class="checkDot">•</span>')
text = text.replace('background:#dcfce7;color:#15803d;font-size:10px;font-weight:950;', 'background:#dbeafe;color:#1d4ed8;font-size:13px;font-weight:950;')

replace_once(
"""  <div class=\"note\">Only confirmed issues are explained in detail. Fields that were not fully confirmed or missed are listed by name only. Exact test values and technical evidence remain in <b>Export Debug</b>.</div>
""",
"""  <div class=\"note\">Field names are shown only when Smart FormSense genuinely missed them or when a confirmed issue needs attention. Pending checks stay summarized. Exact test values and technical evidence remain in <b>Export Debug</b>.</div>
""",
'report note wording'
)

# One PDF click must invoke one print dialog. The report already owns the
# qaDownloadPdf handler, so do not attach a second handler from the opener.
regex_once(
    r"\n        try \{\n          const pdfButton = tab\.document\.getElementById\('qaDownloadPdf'\);\n          if \(pdfButton\) \{\n            pdfButton\.addEventListener\('click', event => \{\n              event\.preventDefault\(\);\n              tab\.print\(\);\n            \}\);\n          \}\n        \} catch \{\}\n",
    "\n",
    'remove duplicate PDF click binding'
)

# Compact print layout so short reports do not spill a footer/note onto page 2.
replace_once(
"""@media print{body{background:#fff}.wrap{padding:0}.reportActions{display:none!important}.hero,.item{box-shadow:none}.sectionBlock{break-inside:avoid}}
""",
"""@media print{body{background:#fff;font-size:10px}.wrap{padding:0 3mm;max-width:none}.reportActions{display:none!important}.hero,.item{box-shadow:none}.hero{padding:14px;border-radius:14px}.hero h1{font-size:20px}.summary,.journeyGrid{gap:6px}.metric,.journeyCard{padding:8px}.sectionBlock{margin-top:16px;break-inside:avoid}.sectionHead{margin-bottom:6px}.checkedGrid{gap:5px}.checkedCard{padding:7px 9px}.passed{margin-top:14px;padding:10px}.note{margin-top:10px;padding:9px}.footer{margin-top:10px}}
""",
'compact print CSS'
)

# Technical diagnostics should not claim a select has no options merely because
# it currently has no selected value.
text = text.replace('Dropdown is ready but empty', 'Dropdown has no current selection')

path.write_text(text, encoding='utf-8')
print('Smart FormSense v17.13.4 patch applied')
