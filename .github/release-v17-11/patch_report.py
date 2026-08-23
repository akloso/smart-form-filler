from pathlib import Path
import re

p = Path('Smart_Form_Filler.user.js')
s = p.read_text(encoding='utf-8')

# Group one issue once, then list every affected field.
group_pattern = re.compile(r"  const qaGroupedFindings = report => \{.*?\n  \};\s*\n\s*const buildQaFriendlyHtml", re.S)
group_repl = r'''  const qaGroupedFindings = report => {
    const groups = new Map();
    for (const item of report?.findings || []) {
      const rawTitle = String(item.title || 'QA finding');
      const title = rawTitle.includes(' — ')
        ? rawTitle.split(' — ').slice(-1)[0].trim()
        : rawTitle;
      const key = [item.severity || 'observation', item.category || 'General', title].join('|');
      const existing = groups.get(key) || {
        severity: item.severity || 'observation',
        category: item.category || 'General',
        title,
        message: item.message || item.actual || '',
        guidance: item.guidance || '',
        fields: []
      };
      if (item.field) existing.fields.push(qaCleanLabel(item.field));
      groups.set(key, existing);
    }
    return [...groups.values()].map(item => ({ ...item, fields: [...new Set(item.fields)] }));
  };

  const buildQaFriendlyHtml'''
s, n = group_pattern.subn(group_repl, s, count=1)
assert n == 1, f'qaGroupedFindings patch matched {n} times'

# Minimal report: summary, confirmed issues, review areas, passed count.
html_pattern = re.compile(r"  const buildQaFriendlyHtml = report => \{.*?\n  \};\s*\n\s*const exportQaReport", re.S)
html_repl = r'''  const buildQaFriendlyHtml = report => {
    const qa = report || state.qaReport;
    if (!qa) return '';
    const counts = qa.counts || {};
    const grouped = qaGroupedFindings(qa);
    const blockers = grouped.filter(x => x.severity === 'critical');
    const failed = grouped.filter(x => x.severity === 'warning');
    const review = grouped.filter(x => x.severity === 'observation');
    const esc = qaEscapeHtml;
    const generated = (() => { try { return new Date(qa.generatedAt).toLocaleString(); } catch { return qa.generatedAt || ''; } })();
    const status = blockers.length ? 'Blockers Found' : failed.length ? 'Needs Attention' : review.length ? 'Needs Review' : 'Looks Good';

    const fieldsLine = fields => {
      const list = [...new Set(fields || [])];
      if (!list.length) return '';
      const shown = list.slice(0, 12);
      const more = list.length - shown.length;
      return `<div class="fields"><b>Fields:</b> ${shown.map(esc).join(', ')}${more > 0 ? ` +${more} more` : ''}</div>`;
    };

    const itemHtml = (item, kind) => `
      <article class="item ${kind}">
        <div class="itemTitle">${kind === 'blocker' ? '🛑' : kind === 'failed' ? '❌' : '⚠'} ${esc(item.title)}</div>
        ${fieldsLine(item.fields)}
        ${item.message ? `<div class="what">${esc(item.message)}</div>` : ''}
        ${item.guidance ? `<div class="action"><b>Action:</b> ${esc(item.guidance)}</div>` : ''}
      </article>`;

    const section = (title, items, kind) => !items.length ? '' : `
      <section><h2>${esc(title)} <span>${items.length}</span></h2>${items.map(x => itemHtml(x, kind)).join('')}</section>`;

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart FormSense QA Report</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f7fa;color:#242633;font-family:Inter,Segoe UI,Arial,sans-serif}.wrap{max-width:850px;margin:auto;padding:28px 18px 44px}.top{background:#fff;border:1px solid #e7e7ee;border-radius:16px;padding:20px}.brand{font-size:13px;font-weight:850;color:#5b4bff}.top h1{font-size:22px;margin:5px 0}.meta{font-size:12px;color:#747887;line-height:1.5}.status{display:inline-block;margin-top:13px;padding:6px 10px;border-radius:999px;background:#f2efff;color:#5b4bff;font-size:12px;font-weight:850}.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-top:15px}.metric{border:1px solid #e8e8ef;border-radius:10px;padding:10px 7px;text-align:center}.metric b{display:block;font-size:19px}.metric span{font-size:9px;color:#777b88;font-weight:750}.blockerText{color:#b91c1c}.failedText{color:#c2410c}.reviewText{color:#a16207}.passText{color:#15803d}section{margin-top:24px}h2{font-size:16px;margin:0 0 9px}h2 span{font-size:10px;background:#ececf2;border-radius:999px;padding:3px 6px;color:#666}.item{background:#fff;border:1px solid #e7e7ee;border-left:4px solid #cbd5e1;border-radius:11px;padding:13px;margin:8px 0}.item.blocker{border-left-color:#b91c1c}.item.failed{border-left-color:#ea580c}.item.review{border-left-color:#d97706}.itemTitle{font-size:14px;font-weight:850}.fields,.what,.action{margin-top:6px;font-size:11px;line-height:1.5;color:#606473}.action{background:#f7f7fb;border-radius:8px;padding:8px 9px}.passed{margin-top:24px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:11px;padding:12px;font-size:12px;color:#166534}.note{margin-top:18px;font-size:10px;line-height:1.55;color:#858895}.footer{text-align:center;margin-top:24px;font-size:10px;color:#9295a1}@media(max-width:650px){.summary{grid-template-columns:repeat(2,1fr)}}@media print{body{background:#fff}.wrap{padding:0}}
</style></head><body><div class="wrap">
<div class="top"><div class="brand">✦ Smart FormSense QA</div><h1>${esc(qa.page?.title || 'Form')}</h1><div class="meta">${esc(qa.page?.hostname || location.hostname || '')}<br>${esc(generated)} • v${esc(qa.productVersion || '17.11.0')}</div><div class="status">${esc(status)}</div>
<div class="summary">
<div class="metric"><b>${Number(qa.fieldsAudited || 0)}</b><span>FIELDS CHECKED</span></div>
<div class="metric"><b class="blockerText">${blockers.length}</b><span>BLOCKER TYPES</span></div>
<div class="metric"><b class="failedText">${failed.length}</b><span>ISSUE TYPES</span></div>
<div class="metric"><b class="reviewText">${review.length}</b><span>REVIEW AREAS</span></div>
<div class="metric"><b>${Number(qa.coverage ?? qa.summary?.coverage ?? 0)}%</b><span>AUTO COVERAGE</span></div>
</div></div>
${section('Blockers', blockers, 'blocker')}
${section('Issues to Fix', failed, 'failed')}
${section('Needs Review', review, 'review')}
<div class="passed">✓ ${Number(counts.passed || 0)} automated checks passed.</div>
<div class="note">Smart FormSense tests the finished form from the applicant's point of view. Similar findings are grouped into one issue with affected fields listed. Safe Next/Continue/Save & Next actions may be tested; final submit, payment and application-generation actions are never executed automatically. Manual sign-off remains with the form QC team.</div>
<div class="footer">Created with love ❤️ Akash Singh • Smart FormSense</div>
</div></body></html>`;
  };

  const exportQaReport'''
s, n = html_pattern.subn(html_repl, s, count=1)
assert n == 1, f'buildQaFriendlyHtml patch matched {n} times'

# Keep the panel equally compact: grouped titles, corrected status names and coverage.
s = s.replace('<div class="qaStat qaCritical"><b id="qaCritical">0</b><span>Failed</span></div>', '<div class="qaStat qaCritical"><b id="qaCritical">0</b><span>Blockers</span></div>', 1)
s = s.replace('<div class="qaStat qaWarning"><b id="qaWarning">0</b><span>Warnings</span></div>', '<div class="qaStat qaWarning"><b id="qaWarning">0</b><span>Failed</span></div>', 1)
s = s.replace('Safe audit mode: no final submission and no deliberate invalid-value injection.', 'Applicant-side QA: safe field + Next/Continue tests; final submit/payment stays protected.', 1)
s = s.replace(
"          refs.qaRating.textContent = `${report.rating || 'Review'} • ${Number(report.fieldsAudited || 0)} field(s) • ${Number(report.checksRun || 0)} check(s)`;",
"          refs.qaRating.textContent = `${report.rating || 'Review'} • ${Number(report.fieldsAudited || 0)} fields • ${Number(report.coverage ?? report.summary?.coverage ?? 0)}% auto coverage`;",
1)

old = """          const key = [
            severity,
            item.category || 'General',
            item.title || 'QA finding'
          ].join('|');

          const group = displayGroups.get(key) || {
            severity,
            title: item.title || 'QA finding',"""
new = """          const rawTitle = String(item.title || 'QA finding');
          const cleanTitle = rawTitle.includes(' — ')
            ? rawTitle.split(' — ').slice(-1)[0].trim()
            : rawTitle;
          const key = [severity, item.category || 'General', cleanTitle].join('|');

          const group = displayGroups.get(key) || {
            severity,
            title: cleanTitle,"""
assert old in s
s = s.replace(old, new, 1)
s = s.replace('${escape(group.severity)}</span>', "${escape(group.severity === 'critical' ? 'blocker' : group.severity === 'warning' ? 'failed' : 'review')}</span>", 1)

s = s.replace('`Functional QA report exported • Score ${qa.score}/100 • ${qa.findings.length} finding(s)`', '`QA report exported • ${qaGroupedFindings(qa).length} grouped item(s)`', 1)
s = s.replace("'Smart FormSense V17.10 QA debug export:'", "'Smart FormSense V17.11 QA debug export:'", 1)

p.write_text(s, encoding='utf-8')
print('minimal grouped report patch applied')
