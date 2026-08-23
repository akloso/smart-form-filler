from pathlib import Path
import re

path = Path('Smart_Form_Filler.user.js')
src = path.read_text(encoding='utf-8')

# Version and grants.
src = src.replace('17.13.1', '17.13.2').replace('17.13.0', '17.13.2')
if '// @grant        GM_download' not in src:
    src = src.replace('// @grant        GM_openInTab\n', '// @grant        GM_openInTab\n// @grant        GM_download\n', 1)

# Track which execution context produced the QA report so debug export does not
# accidentally target an unrelated/stale iframe agent.
old_state = "    qaReport: null,\n    qaNavIndex: 0,"
new_state = "    qaReport: null,\n    qaReportAgentId: null,\n    qaDebugAwaiting: false,\n    qaNavIndex: 0,"
assert old_state in src, 'QA state marker not found'
src = src.replace(old_state, new_state, 1)

# Make downloads extension-assisted first, with a normal browser-anchor fallback.
pattern = re.compile(r"  const downloadTextFile = \(\n.*?\n  \};\n\n  const exportDebugReport =", re.S)
replacement = r'''  const downloadTextFile = (
    filename,
    text,
    mime = 'application/json;charset=utf-8'
  ) => {
    const content = String(text ?? '');
    const blob = new Blob([content], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    let settled = false;

    const cleanup = () => {
      setTimeout(() => {
        try { URL.revokeObjectURL(blobUrl); } catch {}
      }, 1800);
    };

    const anchorFallback = () => {
      try {
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        cleanup();
        return true;
      } catch {
        cleanup();
        return false;
      }
    };

    try {
      if (typeof GM_download === 'function') {
        GM_download({
          url: blobUrl,
          name: filename,
          saveAs: false,
          onload: () => {
            settled = true;
            cleanup();
          },
          onerror: () => {
            if (settled) return;
            settled = true;
            anchorFallback();
          },
          ontimeout: () => {
            if (settled) return;
            settled = true;
            anchorFallback();
          }
        });
        return true;
      }
    } catch {}

    settled = true;
    return anchorFallback();
  };

  const exportDebugReport ='''
src, n = pattern.subn(replacement, src, count=1)
assert n == 1, f'downloadTextFile patch matched {n} times'

# Give the PDF action a stable target instead of depending only on an inline
# handler that can be blocked by the host site's CSP.
src = src.replace(
    '<button class="pdfBtn" onclick="window.print()">Download PDF</button>',
    '<button class="pdfBtn" id="qaDownloadPdf" type="button">Download PDF</button>',
    1
)

# Open the report through a real about:blank tab created directly from the user
# click. Do not mark GM_openInTab(blob:) as successful merely because it did not
# throw; Chrome can silently ignore that combination.
pattern = re.compile(r"  const exportQaReport = report => \{\n.*?\n  \};\n\n  const buildQaDebugReport =", re.S)
replacement = r'''  const exportQaReport = report => {
    const qa = report || state.qaReport;

    if (!qa) {
      state.panel?.setStatus('Run Functional QA before opening a report.');
      return null;
    }

    state.panel?.setStatus('Opening QA report...');
    const html = buildQaFriendlyHtml(qa);

    try {
      const tab = window.open('about:blank', '_blank');
      if (tab && !tab.closed && tab.document) {
        tab.document.open();
        tab.document.write(html);
        tab.document.close();

        try {
          const pdfButton = tab.document.getElementById('qaDownloadPdf');
          if (pdfButton) {
            pdfButton.addEventListener('click', event => {
              event.preventDefault();
              tab.print();
            });
          }
        } catch {}

        try { tab.focus(); } catch {}
        state.panel?.setStatus('QA report opened in a new tab. Use Download PDF at the top.');
        return qa;
      }
    } catch {}

    // Popup fallback: use a data URL only when it is reasonably small. This is
    // independent of page-created blob URL permissions.
    try {
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      if (dataUrl.length < 1800000 && typeof GM_openInTab === 'function') {
        const handle = GM_openInTab(dataUrl, {
          active: true,
          insert: true,
          setParent: true
        });
        if (handle) {
          state.panel?.setStatus('QA report opened in a new tab. Use Download PDF at the top.');
          return qa;
        }
      }
    } catch {}

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const host = String(qa.page?.hostname || location.hostname || 'form')
      .replace(/[^a-z0-9.-]+/gi, '_')
      .slice(0, 60);

    downloadTextFile(
      `Smart_FormSense_QA_Report_${host}_${stamp}.html`,
      html,
      'text/html;charset=utf-8'
    );
    state.panel?.setStatus('The browser blocked a new tab, so the QA report was downloaded instead.');
    return qa;
  };

  const buildQaDebugReport ='''
src, n = pattern.subn(replacement, src, count=1)
assert n == 1, f'exportQaReport patch matched {n} times'

# Record QA report source.
old = """        if (result?.qaReport) {
          state.qaReport = result.qaReport;
          state.panel?.setQaReport?.(result.qaReport);
        }

        return state.qaReport;"""
new = """        if (result?.qaReport) {
          state.qaReport = result.qaReport;
          state.qaReportAgentId = context.agent?.id || null;
          state.panel?.setQaReport?.(result.qaReport);
        }

        return state.qaReport;"""
assert old in src, 'remote QA result block not found'
src = src.replace(old, new, 1)

old = """      if (context.kind === 'none') {
        const report = await buildQaFunctionalReport();
        state.qaReport = report;"""
new = """      if (context.kind === 'none') {
        const report = await buildQaFunctionalReport();
        state.qaReport = report;
        state.qaReportAgentId = null;"""
assert old in src, 'none QA context block not found'
src = src.replace(old, new, 1)

old = """      state.lastRemoteAgentId = null;

      const report = await buildQaFunctionalReport();
      state.qaReport = report;"""
new = """      state.lastRemoteAgentId = null;
      state.qaReportAgentId = null;

      const report = await buildQaFunctionalReport();
      state.qaReport = report;"""
assert old in src, 'local QA context block not found'
src = src.replace(old, new, 1)

# Also capture source when the bridge itself receives a remote QA result.
old = """            if (data.qaReport) {
              state.qaReport = data.qaReport;
              state.panel?.setQaReport?.(
                data.qaReport
              );
            }"""
new = """            if (data.qaReport) {
              state.qaReport = data.qaReport;
              state.qaReportAgentId = data.agentId || null;
              state.panel?.setQaReport?.(
                data.qaReport
              );
            }"""
assert old in src, 'bridge QA result block not found'
src = src.replace(old, new, 1)

# Make QA debug export target only the form/frame that actually produced the QA
# report, and always fall back to a local downloadable debug file.
pattern = re.compile(r"  const smartQaDebugExport = \(\) => \{\n.*?\n  \};\n\n  const installTopBridge =", re.S)
replacement = r'''  const smartQaDebugExport = () => {
    state.panel?.setStatus('Preparing QA debug download...');

    const agent = remoteAgentById(state.qaReportAgentId);

    if (agent?.source) {
      try {
        state.qaDebugAwaiting = true;
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

        setTimeout(() => {
          if (!state.qaDebugAwaiting) return;
          state.qaDebugAwaiting = false;
          state.panel?.setStatus('Embedded debug response was unavailable. Downloading the saved QA data instead...');
          exportQaDebugReport();
        }, 1800);
        return;
      } catch {}
    }

    state.qaDebugAwaiting = false;
    exportQaDebugReport();
  };

  const installTopBridge ='''
src, n = pattern.subn(replacement, src, count=1)
assert n == 1, f'smartQaDebugExport patch matched {n} times'

old = """        if (data.type === 'REMOTE_QA_DEBUG_DATA') {
          const report = data.debugReport;"""
new = """        if (data.type === 'REMOTE_QA_DEBUG_DATA') {
          state.qaDebugAwaiting = false;
          const report = data.debugReport;"""
assert old in src, 'remote QA debug response marker not found'
src = src.replace(old, new, 1)

# Explicit button types and a pointer-up fallback make the two bottom QA actions
# resilient to host form default-submit behavior and over-eager page click code.
src = src.replace(
    '<button class="primary" id="qaRunBtn">Run Functional QA</button>',
    '<button type="button" class="primary" id="qaRunBtn">Run Functional QA</button>',
    1
)
src = src.replace(
    '<button class="secondary qaOpenReport" id="qaExportBtn" disabled title="Open the readable QA report in a new tab">Open Report</button>',
    '<button type="button" class="secondary qaOpenReport" id="qaExportBtn" disabled title="Open the readable QA report in a new tab">Open Report</button>',
    1
)
src = src.replace(
    '<button class="secondary" id="qaDebugBtn" title="Download technical QA diagnostics">Export Debug</button>',
    '<button type="button" class="secondary" id="qaDebugBtn" title="Download technical QA diagnostics">Export Debug</button>',
    1
)

old = """    refs.qaExportBtn.onclick = () =>
      exportQaReport(state.qaReport);

    refs.qaDebugBtn.onclick =
      smartQaDebugExport;"""
new = """    const bindQaAction = (button, handler) => {
      if (!button) return;
      let lastRunAt = 0;
      const invoke = event => {
        try { event?.preventDefault?.(); } catch {}
        try { event?.stopPropagation?.(); } catch {}
        const now = Date.now();
        if (now - lastRunAt < 450) return;
        lastRunAt = now;
        handler();
      };
      button.addEventListener('click', invoke, true);
      button.addEventListener('pointerup', event => {
        if (event?.button !== undefined && event.button !== 0) return;
        invoke(event);
      }, true);
    };

    bindQaAction(refs.qaExportBtn, () =>
      exportQaReport(state.qaReport)
    );

    bindQaAction(refs.qaDebugBtn,
      smartQaDebugExport
    );"""
assert old in src, 'QA action binding block not found'
src = src.replace(old, new, 1)

# Add a script fallback for report tabs opened through a data URL.
src = src.replace(
    '  <div class="footer">Created with love ❤️ Akash Singh • Smart FormSense</div>\n</div>\n</body>',
    '  <div class="footer">Created with love ❤️ Akash Singh • Smart FormSense</div>\n</div>\n<script>try{document.getElementById("qaDownloadPdf")?.addEventListener("click",function(e){e.preventDefault();window.print();});}catch(e){}</script>\n</body>',
    1
)

path.write_text(src, encoding='utf-8')
print('patched Smart FormSense v17.13.2')
