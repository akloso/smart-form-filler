from pathlib import Path

PATH = Path('Smart_Form_Filler.user.js')
text = PATH.read_text(encoding='utf-8')

if '// @version      17.12.1' not in text:
    raise SystemExit('Expected Smart FormSense v17.12.1 source')


def replace_block(src: str, start: str, end: str, replacement: str) -> str:
    a = src.find(start)
    if a < 0:
        raise AssertionError(f'start marker not found: {start}')
    b = src.find(end, a)
    if b < 0:
        raise AssertionError(f'end marker not found: {end}')
    return src[:a] + replacement.rstrip() + '\n\n' + src[b:]


# Version bump first so every generated/debug surface is consistent.
text = text.replace('17.12.1', '17.13.0')

# Compact QA workspace: keep the live run state, progress and issue counters,
# but move detail to the report instead of crowding the floating panel.
QA_WORKSPACE = r'''          <div class="workspace" id="qaWorkspace">
            <div class="qaCompactHead">
              <div>
                <div class="qaScoreLabel">FIELD COVERAGE</div>
                <div class="qaScore" id="qaScore">--</div>
              </div>
              <div class="qaRating" id="qaRating">Run QA to inspect this form</div>
            </div>

            <button class="primary" id="qaRunBtn">Run Functional QA</button>

            <div class="qaProgressBox">
              <div class="qaProgressMeta">
                <span id="qaProgressText">Ready</span>
                <b id="qaProgressPct">0%</b>
              </div>
              <div class="qaProgressTrack">
                <div class="qaProgressBar" id="qaProgressBar"></div>
              </div>
            </div>

            <div class="qaStats compactStats">
              <div class="qaStat qaCritical"><b id="qaCritical">0</b><span>Blockers</span></div>
              <div class="qaStat qaWarning"><b id="qaWarning">0</b><span>Issues</span></div>
              <div class="qaStat qaObservation"><b id="qaObservation">0</b><span>Review</span></div>
              <div class="qaStat qaPassed"><b id="qaPassed">0</b><span>Passed</span></div>
            </div>

            <div class="qaIssues compactIssues" id="qaIssues">
              <div class="qaEmpty">Confirmed issues will appear here. Full details are kept in the report.</div>
            </div>

            <div class="qaActions">
              <button class="secondary qaOpenReport" id="qaExportBtn" disabled title="Open the readable QA report in a new tab">Open Report</button>
              <button class="secondary" id="qaDebugBtn" title="Download technical QA diagnostics">Export Debug</button>
            </div>
          </div>'''
text = replace_block(
    text,
    '          <div class="workspace" id="qaWorkspace">',
    '          <div class="status" id="status">',
    QA_WORKSPACE
)

# QA-mode-only compact styling. Existing fill-mode styles stay untouched.
css_marker = '        .qaHint{font-size:8px;color:#8a8fa0;line-height:1.35;margin-top:5px}'
if css_marker not in text:
    raise AssertionError('QA CSS marker missing')
css_extra = r'''
        .panel.qaMode .profile,.panel.qaMode .help,.panel.qaMode .creator{display:none}
        .panel.qaMode .body{padding:8px}
        .panel.qaMode .hero{padding-bottom:8px}
        .qaCompactHead{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #e4defb;border-radius:11px;padding:8px 9px;background:linear-gradient(135deg,#f8f7ff,#fff);margin-bottom:7px}
        .qaCompactHead .qaScoreLabel{text-align:left;font-size:8px}
        .qaCompactHead .qaScore{font-size:21px;text-align:left;margin-top:1px}
        .qaCompactHead .qaRating{margin:0;text-align:right;max-width:165px;font-size:8px;line-height:1.35}
        .compactStats{margin:6px 0;gap:4px}
        .compactStats .qaStat{padding:5px 2px}
        .compactStats .qaStat b{font-size:12px}
        .compactStats .qaStat span{font-size:7px}
        .compactIssues{max-height:118px;margin-top:5px}
        .compactIssues .qaIssue{padding:6px 7px}
        .compactIssues .qaIssueMessage{font-size:7.5px;line-height:1.3}
        .qaActions{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:7px}
        .qaOpenReport{background:#f5f3ff;border-color:#ddd6fe;color:#5b4bff;font-weight:850}
'''
text = text.replace(css_marker, css_marker + css_extra, 1)

# Toggle a compact QA-only panel mode when switching tabs.
show_marker = "      refs.qaWorkspace?.classList.toggle('active', next === 'qa');"
if show_marker not in text:
    raise AssertionError('showWorkspace marker missing')
text = text.replace(
    show_marker,
    show_marker + "\n      refs.panel?.classList.toggle('qaMode', next === 'qa');",
    1
)

# The floating panel should show confirmed issues only. Review/manual details belong
# in the organized report so the QA workspace stays easy to scan.
panel_group_marker = "        const displayGroups = new Map();\n\n        for (const item of findings) {"
if panel_group_marker not in text:
    raise AssertionError('QA panel grouping marker missing')
text = text.replace(
    panel_group_marker,
    "        const displayGroups = new Map();\n\n        for (const item of findings.filter(item => ['critical', 'warning'].includes(item.severity))) {",
    1
)

panel_render_marker = '        refs.qaIssues.innerHTML = [...displayGroups.values()]'
if panel_render_marker not in text:
    raise AssertionError('QA panel render marker missing')
text = text.replace(
    panel_render_marker,
    "        if (!displayGroups.size) {\n          refs.qaIssues.innerHTML = '<div class=\"qaEmpty\">No confirmed issue found. Open Report for coverage and any fields that still need checking.</div>';\n          return;\n        }\n\n" + panel_render_marker,
    1
)

FRIENDLY_REPORT = r'''  const buildQaFriendlyHtml = report => {
    const qa = report || state.qaReport;
    if (!qa) return '';

    const esc = qaEscapeHtml;
    const grouped = qaGroupedFindings(qa);
    const confirmed = grouped.filter(item => ['critical', 'warning'].includes(item.severity));
    const reviewRaw = grouped.filter(item => item.severity === 'observation');
    const passed = Number(qa.counts?.passed || 0);
    const checksRun = Number(qa.checksRun || qa.testCases?.length || 0);
    const detectedCount = Number(qa.fieldsAudited || 0);
    const checkedCount = Number(qa.fieldsChecked || 0);
    const fieldCoverage = Number(
      qa.fieldCoverage ?? qa.summary?.fieldCoverage ??
      (detectedCount ? Math.round((checkedCount / detectedCount) * 100) : 0)
    );
    const validationCoverage = Number(qa.validationCoverage ?? qa.summary?.validationCoverage ?? 0);

    const generated = (() => {
      try { return new Date(qa.generatedAt).toLocaleString(); }
      catch { return qa.generatedAt || ''; }
    })();

    // Only show field names when they were not fully confirmed/missed, or when
    // a real confirmed issue needs the user's attention.
    const manualFields = [...new Set(
      reviewRaw.flatMap(item => item.fields || []).filter(Boolean).map(value => qaCleanLabel(value))
    )];
    const uncovered = [...new Set(
      (Array.isArray(qa.uncoveredFields) ? qa.uncoveredFields : []).filter(Boolean).map(value => qaCleanLabel(value))
    )];

    const allCaseText = (qa.testCases || [])
      .map(item => `${item.category || ''} ${item.name || ''}`.toLowerCase())
      .join(' | ');
    const categories = new Set((qa.testCases || []).map(item => String(item.category || '')));
    const checkedThings = [];
    const addChecked = (label, condition) => {
      if (condition && !checkedThings.includes(label)) checkedThings.push(label);
    };

    addChecked('Required-field blocking', categories.has('Mandatory Validation') || /required-field|required field/.test(allCaseText));
    addChecked('Normal text entry and value restoration', categories.has('Basic Field Behaviour'));
    addChecked('Name validation', /name/.test(allCaseText));
    addChecked('Mobile number validation', /mobile/.test(allCaseText));
    addChecked('Email validation', /email/.test(allCaseText));
    addChecked('Aadhaar validation', /aadhaar|aadhar/.test(allCaseText));
    addChecked('Pincode / postal-code validation', /pincode|postal|zip/.test(allCaseText));
    addChecked('Maximum / minimum length or range', /maximum length|minimum|above maximum|below minimum|range/.test(allCaseText));
    addChecked('Dropdown option selection and retention', categories.has('Dropdown Behaviour'));
    addChecked('Radio / checkbox selection behaviour', categories.has('Choice Controls'));
    addChecked('Prefilled / locked fields', categories.has('Prefilled Fields'));
    addChecked('Date-picker behaviour', categories.has('Date Picker'));
    addChecked('File-upload behaviour', categories.has('File Upload'));
    addChecked('Dependent / slow-loading fields', categories.has('Dependencies'));
    addChecked('Continue / Next / Save & Next validation', categories.has('Journey Validation'));
    addChecked('Dynamic and late-loaded field rescans', Number(qa.discoveryPasses || 0) > 1);

    const status = qa.incomplete
      ? (qa.runState === 'stopped' ? 'Partial QA • Stopped' : 'Partial QA • Interrupted')
      : confirmed.length
        ? 'Needs Attention'
        : manualFields.length || uncovered.length || qa.journeyStatus === 'Needs manual check'
          ? 'Needs Manual Confirmation'
          : 'Ready for Final Sign-off';

    const statusClass = qa.incomplete
      ? 'partialStatus'
      : confirmed.length
        ? 'issueStatus'
        : manualFields.length || uncovered.length || qa.journeyStatus === 'Needs manual check'
          ? 'reviewStatus'
          : 'goodStatus';

    const overview = confirmed.length
      ? `${confirmed.length} confirmed issue type${confirmed.length === 1 ? '' : 's'} need attention.`
      : uncovered.length
        ? `${uncovered.length} field${uncovered.length === 1 ? '' : 's'} were not fully checked.`
        : manualFields.length
          ? `${manualFields.length} field${manualFields.length === 1 ? '' : 's'} still need a quick manual check.`
          : 'The automated checks completed without a confirmed applicant-facing issue.';

    const statusTone = value => {
      const text = String(value || '').toLowerCase();
      if (/issue|failed|block/.test(text)) return 'bad';
      if (/checked|not applicable/.test(text)) return 'good';
      return 'reviewTone';
    };

    const confirmedHtml = confirmed.length
      ? `<section class="sectionBlock"><div class="sectionHead"><div><span class="eyebrow redEye">REAL ISSUES FOUND</span><h2>What needs fixing</h2></div><span class="countBadge redBadge">${confirmed.length}</span></div>${confirmed.map(item => `
          <article class="item issue">
            <div class="iconBox issueIcon">!</div>
            <div class="itemBody">
              <div class="itemTitle">${esc(item.title)}</div>
              ${item.fields?.length ? `<div class="fields"><b>Fields:</b> ${[...new Set(item.fields)].map(esc).join(', ')}</div>` : ''}
              <div class="what">${esc(item.message || 'This behaviour did not work as expected for an applicant.')}</div>
              <div class="action"><b>What to do:</b> ${esc(item.guidance || 'Review this form setting and rerun QA.')}</div>
            </div>
          </article>`).join('')}</section>`
      : '';

    const checkedHtml = checkedThings.length
      ? `<section class="sectionBlock"><div class="sectionHead"><div><span class="eyebrow blueEye">QA COVERAGE</span><h2>What Smart FormSense checked</h2></div><span class="countBadge blueBadge">${checkedThings.length}</span></div><div class="checkedGrid">${checkedThings.map(item => `<div class="checkedCard"><span class="checkDot">✓</span><span>${esc(item)}</span></div>`).join('')}</div></section>`
      : '';

    const manualHtml = manualFields.length
      ? `<section class="sectionBlock"><div class="sectionHead"><div><span class="eyebrow amberEye">MANUAL CHECK</span><h2>Fields not fully confirmed</h2></div><span class="countBadge amberBadge">${manualFields.length}</span></div><div class="fieldChips">${manualFields.map(item => `<span>${esc(item)}</span>`).join('')}</div></section>`
      : '';

    const uncoveredHtml = uncovered.length
      ? `<section class="sectionBlock"><div class="sectionHead"><div><span class="eyebrow amberEye">MISSED</span><h2>Fields not checked</h2></div><span class="countBadge amberBadge">${uncovered.length}</span></div><div class="fieldChips missedChips">${uncovered.map(item => `<span>${esc(item)}</span>`).join('')}</div></section>`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart FormSense QA Report</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#202435;font-family:Inter,Segoe UI,Arial,sans-serif}.wrap{max-width:900px;margin:auto;padding:22px 18px 48px}.reportActions{position:sticky;top:10px;z-index:20;display:flex;justify-content:flex-end;margin-bottom:10px}.pdfBtn{border:0;border-radius:11px;padding:10px 15px;background:#4f46e5;color:#fff;font-size:11px;font-weight:900;cursor:pointer;box-shadow:0 8px 22px rgba(79,70,229,.22)}.pdfBtn:hover{background:#4338ca}.hero{background:linear-gradient(135deg,#ffffff 0%,#f7f5ff 58%,#eef7ff 100%);border:1px solid #e5e7f2;border-radius:22px;padding:24px;box-shadow:0 14px 36px rgba(61,50,123,.07)}.brand{font-size:12px;font-weight:900;letter-spacing:.08em;color:#6657e8}.hero h1{font-size:24px;margin:6px 0 4px}.meta{font-size:11px;color:#777d8e;line-height:1.55}.status{display:inline-flex;align-items:center;margin-top:14px;padding:7px 11px;border-radius:999px;font-size:11px;font-weight:900}.goodStatus{background:#dcfce7;color:#166534}.reviewStatus{background:#fef3c7;color:#92400e}.issueStatus{background:#fee2e2;color:#991b1b}.partialStatus{background:#e0e7ff;color:#3730a3}.overview{margin-top:12px;font-size:13px;line-height:1.6;color:#4d5568}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}.metric{border-radius:14px;padding:13px 10px;border:1px solid}.metric b{display:block;font-size:20px;line-height:1.1}.metric span{display:block;font-size:9px;font-weight:850;letter-spacing:.04em;margin-top:5px}.coverageMetric{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}.issueMetric{background:#fff1f2;border-color:#fecdd3;color:#be123c}.reviewMetric{background:#fffbeb;border-color:#fde68a;color:#a16207}.passMetric{background:#f0fdf4;border-color:#bbf7d0;color:#15803d}.coverageBar{height:7px;background:#dbeafe;border-radius:999px;overflow:hidden;margin-top:8px}.coverageFill{height:100%;background:linear-gradient(90deg,#4f46e5,#06b6d4);border-radius:999px}.journeyGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}.journeyCard{background:#fff;border:1px solid #e6e8ef;border-radius:13px;padding:11px 12px}.journeyCard span{font-size:9px;color:#7b8190;font-weight:800}.journeyCard b{display:block;margin-top:4px;font-size:11px}.good{color:#15803d}.bad{color:#b91c1c}.reviewTone{color:#a16207}.partial{margin-top:14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:13px;padding:11px 13px;font-size:11px;color:#9a3412}.sectionBlock{margin-top:28px}.sectionHead{display:flex;align-items:end;justify-content:space-between;margin-bottom:10px}.sectionHead h2{font-size:17px;margin:3px 0 0}.eyebrow{font-size:9px;font-weight:900;letter-spacing:.12em}.redEye{color:#dc2626}.amberEye{color:#d97706}.blueEye{color:#2563eb}.countBadge{min-width:28px;height:28px;border-radius:999px;display:grid;place-items:center;font-size:11px;font-weight:900}.redBadge{background:#fee2e2;color:#b91c1c}.amberBadge{background:#fef3c7;color:#92400e}.blueBadge{background:#dbeafe;color:#1d4ed8}.item{display:flex;gap:12px;background:#fff;border:1px solid #e5e7ed;border-radius:15px;padding:14px;margin:9px 0;box-shadow:0 5px 16px rgba(30,41,59,.035)}.item.issue{border-color:#fecaca;background:linear-gradient(135deg,#fff,#fff7f7)}.iconBox{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-weight:950;flex:0 0 auto}.issueIcon{background:#fee2e2;color:#b91c1c}.itemBody{min-width:0;flex:1}.itemTitle{font-size:14px;font-weight:900}.fields,.what,.action{margin-top:6px;font-size:11px;line-height:1.58;color:#606778}.fields b,.action b{color:#343949}.action{background:#fff;border:1px solid #fee2e2;border-radius:9px;padding:9px 10px}.checkedGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.checkedCard{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #dbeafe;border-radius:12px;padding:10px 11px;color:#334155;font-size:11px;font-weight:700}.checkDot{width:20px;height:20px;border-radius:7px;display:grid;place-items:center;background:#dcfce7;color:#15803d;font-size:10px;font-weight:950;flex:0 0 auto}.fieldChips{display:flex;flex-wrap:wrap;gap:7px;background:#fff;border:1px solid #fde68a;border-radius:14px;padding:12px}.fieldChips span{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:999px;padding:6px 9px;font-size:10px;font-weight:750}.missedChips{border-color:#fecaca}.missedChips span{background:#fff1f2;border-color:#fecaca;color:#991b1b}.passed{margin-top:26px;background:linear-gradient(135deg,#ecfdf5,#f0fdf4);border:1px solid #bbf7d0;border-radius:15px;padding:14px;color:#166534;font-size:12px;font-weight:750}.note{margin-top:18px;background:#fff;border:1px solid #e7e9ef;border-radius:13px;padding:12px;font-size:10px;line-height:1.6;color:#858b99}.footer{text-align:center;margin-top:24px;font-size:10px;color:#979baa}@media(max-width:680px){.summary{grid-template-columns:repeat(2,1fr)}.journeyGrid,.checkedGrid{grid-template-columns:1fr}.hero{padding:18px}}@media print{body{background:#fff}.wrap{padding:0}.reportActions{display:none!important}.hero,.item{box-shadow:none}.sectionBlock{break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <div class="reportActions"><button class="pdfBtn" onclick="window.print()">Download PDF</button></div>
  <div class="hero">
    <div class="brand">✦ SMART FORMSENSE QA</div>
    <h1>${esc(qa.page?.title || 'Form')}</h1>
    <div class="meta">${esc(qa.page?.hostname || location.hostname || '')}<br>${esc(generated)} • v${esc(qa.productVersion || '17.13.0')}</div>
    <div class="status ${statusClass}">${esc(status)}</div>
    <div class="overview">${esc(overview)}</div>

    <div class="summary">
      <div class="metric coverageMetric"><b>${checkedCount}/${detectedCount}</b><span>FIELDS COVERED</span><div class="coverageBar"><div class="coverageFill" style="width:${Math.max(0,Math.min(100,fieldCoverage))}%"></div></div></div>
      <div class="metric issueMetric"><b>${confirmed.length}</b><span>REAL ISSUE TYPES</span></div>
      <div class="metric reviewMetric"><b>${manualFields.length + uncovered.length}</b><span>FIELDS TO CHECK</span></div>
      <div class="metric passMetric"><b>${passed}/${checksRun}</b><span>CHECKS CONFIRMED</span></div>
    </div>

    <div class="journeyGrid">
      <div class="journeyCard"><span>FIELD DISCOVERY</span><b class="${fieldCoverage === 100 ? 'good' : 'reviewTone'}">${fieldCoverage}% covered</b></div>
      <div class="journeyCard"><span>DEPENDENT FIELDS</span><b class="${statusTone(qa.dependencyStatus)}">${esc(qa.dependencyStatus || 'Not reached')}</b></div>
      <div class="journeyCard"><span>FORM PROGRESSION</span><b class="${statusTone(qa.journeyStatus)}">${esc(qa.journeyStatus || 'Not reached')}</b></div>
    </div>
  </div>

  ${qa.incomplete ? `<div class="partial"><b>Partial report.</b> ${esc(qa.summary?.headline || 'QA did not complete.')}</div>` : ''}
  ${confirmedHtml}
  ${checkedHtml}
  ${manualHtml}
  ${uncoveredHtml}

  <div class="passed">✓ ${passed} automated checks were confirmed OK. Field coverage: ${fieldCoverage}%. Validation coverage: ${validationCoverage}%.</div>
  <div class="note">Only confirmed issues are explained in detail. Fields that were not fully confirmed or missed are listed by name only. Exact test values and technical evidence remain in <b>Export Debug</b>.</div>
  <div class="footer">Created with love ❤️ Akash Singh • Smart FormSense</div>
</div>
</body>
</html>`;
  };'''
text = replace_block(
    text,
    '  const buildQaFriendlyHtml = report => {',
    '  const exportQaReport = report => {',
    FRIENDLY_REPORT
)

OPEN_REPORT = r'''  const exportQaReport = report => {
    const qa = report || state.qaReport;

    if (!qa) {
      state.panel?.setStatus('Run Functional QA before opening a report.');
      return null;
    }

    const html = buildQaFriendlyHtml(qa);
    let opened = null;

    try {
      opened = window.open('', '_blank');
      if (opened?.document) {
        opened.document.open();
        opened.document.write(html);
        opened.document.close();
        try { opened.focus(); } catch {}
        state.panel?.setStatus('QA report opened in a new tab. Use Download PDF at the top of the report.');
        return qa;
      }
    } catch {}

    // Browser popup protection can occasionally block a new tab. Keep a
    // download fallback so the user never loses access to the report.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const host = String(qa.page?.hostname || location.hostname || 'form')
      .replace(/[^a-z0-9.-]+/gi, '_')
      .slice(0, 60);
    downloadTextFile(
      `Smart_FormSense_QA_Report_${host}_${stamp}.html`,
      html,
      'text/html;charset=utf-8'
    );
    state.panel?.setStatus('The browser blocked the report tab, so the HTML report was downloaded instead.');
    return qa;
  };'''
text = replace_block(
    text,
    '  const exportQaReport = report => {',
    '  const buildQaDebugReport = () => {',
    OPEN_REPORT
)

PATH.write_text(text, encoding='utf-8')
print('Patched Smart FormSense to v17.13.0')
