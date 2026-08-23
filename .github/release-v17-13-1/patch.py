from pathlib import Path
import re

path = Path('Smart_Form_Filler.user.js')
s = path.read_text(encoding='utf-8')

s = s.replace('// @version      17.13.0', '// @version      17.13.1', 1)
if '// @grant        GM_openInTab' not in s:
    s = s.replace('// @grant        GM_registerMenuCommand', '// @grant        GM_registerMenuCommand\n// @grant        GM_openInTab', 1)

s = s.replace('Smart FormSense V17.12.0', 'Smart FormSense V17.13.1')
s = s.replace("productVersion: '17.13.0'", "productVersion: '17.13.1'")
s = s.replace("qa.productVersion || '17.13.0'", "qa.productVersion || '17.13.1'")

# Replace Open Report implementation with a blob URL opened through Tampermonkey's
# GM_openInTab first. This avoids Chrome popup blocking / isolated-world issues.
pattern = re.compile(r"  const exportQaReport = report => \{.*?\n  \};\n\n  const buildQaDebugReport = \(\) => \{", re.S)
replacement = r'''  const exportQaReport = report => {
    const qa = report || state.qaReport;

    if (!qa) {
      state.panel?.setStatus('Run Functional QA before opening a report.');
      return null;
    }

    const html = buildQaFriendlyHtml(qa);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    let opened = false;

    try {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, {
          active: true,
          insert: true,
          setParent: true
        });
        opened = true;
      }
    } catch {}

    if (!opened) {
      try {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        opened = true;
      } catch {}
    }

    if (opened) {
      setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch {}
      }, 120000);
      state.panel?.setStatus('QA report opened in a new tab. Use Download PDF at the top.');
      return qa;
    }

    try { URL.revokeObjectURL(url); } catch {}

    // Last-resort fallback: save the readable HTML locally rather than doing nothing.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const host = String(qa.page?.hostname || location.hostname || 'form')
      .replace(/[^a-z0-9.-]+/gi, '_')
      .slice(0, 60);
    downloadTextFile(
      `Smart_FormSense_QA_Report_${host}_${stamp}.html`,
      html,
      'text/html;charset=utf-8'
    );
    state.panel?.setStatus('Browser blocked the report tab, so the HTML report was downloaded instead.');
    return qa;
  };

  const buildQaDebugReport = () => {'''
s, n = pattern.subn(replacement, s, count=1)
assert n == 1, f'exportQaReport patch matched {n} times'

# Ask embedded forms for debug DATA, not for a child-frame download. Downloads
# from embedded/cross-origin frames are commonly suppressed by Chrome.
smart_pat = re.compile(r"  const smartQaDebugExport = \(\) => \{.*?\n  \};\n\n  const installTopBridge = \(\) => \{", re.S)
smart_repl = r'''  const smartQaDebugExport = () => {
    const agent = remoteAgentById(state.lastRemoteAgentId);

    if (agent?.source) {
      try {
        agent.source.postMessage(
          bridgePayload(
            'QA_DEBUG_DATA',
            {
              sessionId: bridge.sessionId,
              agentId: agent.id
            }
          ),
          '*'
        );
        state.panel?.setStatus('Preparing QA debug export from the active form...');
        return;
      } catch {}
    }

    exportQaDebugReport();
  };

  const installTopBridge = () => {'''
s, n = smart_pat.subn(smart_repl, s, count=1)
assert n == 1, f'smartQaDebugExport patch matched {n} times'

# Top window receives debug JSON from the embedded form and performs the actual
# download, where Chrome allows the user-initiated download reliably.
needle = "        const requestId =\n          data.requestId;"
insert = r'''        if (data.type === 'REMOTE_QA_DEBUG_DATA') {
          const report = data.debugReport;
          if (!report || typeof report !== 'object') {
            state.panel?.setStatus('QA debug export could not be prepared.');
            return;
          }

          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const host = String(report.page?.hostname || location.hostname || 'form')
            .replace(/[^a-z0-9.-]+/gi, '_')
            .slice(0, 60);

          downloadTextFile(
            `Smart_FormSense_QA_Debug_${host}_${stamp}.json`,
            JSON.stringify(report, null, 2),
            'application/json;charset=utf-8'
          );

          state.panel?.setStatus(
            `QA debug exported • ${report.qaFieldDiagnostics?.length || 0} field diagnostic(s) • ${report.qaAudit?.findings?.length || 0} QA finding(s)`
          );
          return;
        }

        const requestId =
          data.requestId;'''
assert needle in s, 'top bridge requestId marker not found'
s = s.replace(needle, insert, 1)

# Embedded frame returns the debug object to the top window instead of trying
# to download inside the frame.
child_needle = """        if (\n          data.type ===\n          'QA_DEBUG'\n        ) {\n          exportQaDebugReport();\n\n          return;\n        }"""
child_insert = r'''        if (
          data.type ===
          'QA_DEBUG_DATA'
        ) {
          const debugReport = buildQaDebugReport();
          try {
            event.source?.postMessage(
              bridgePayload(
                'REMOTE_QA_DEBUG_DATA',
                {
                  sessionId: data.sessionId,
                  agentId: agent.id,
                  debugReport
                }
              ),
              '*'
            );
          } catch {}
          return;
        }

        if (
          data.type ===
          'QA_DEBUG'
        ) {
          exportQaDebugReport();

          return;
        }'''
assert child_needle in s, 'child QA_DEBUG marker not found'
s = s.replace(child_needle, child_insert, 1)

path.write_text(s, encoding='utf-8')
print('patched Smart FormSense to v17.13.1')
