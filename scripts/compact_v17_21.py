from pathlib import Path

path = Path('Smart_Form_Filler.user.js')
text = path.read_text(encoding='utf-8')

if '/* Compact panel density v17.21 */' in text:
    print('Compact panel patch already applied.')
    raise SystemExit(0)

if '// @version      17.20.0' not in text or "const SCRIPT_VERSION = '17.20.0';" not in text:
    raise SystemExit('Expected Smart FormSense v17.20.0 before applying compact panel patch.')

# Keep all visible/report version references aligned with the release.
text = text.replace('17.20.0', '17.21.0')

needle = "        button:disabled{opacity:.55;cursor:wait}\n      </style>"
if text.count(needle) != 1:
    raise SystemExit(f'Expected one panel style insertion point, found {text.count(needle)}.')

compact_css = r'''        /* Compact panel density v17.21 */
        .hero{padding:7px 10px 6px}
        .windowBtn{width:22px;height:22px;border-radius:7px}
        .title{font-size:12px}
        .tagline{font-size:8px;margin-top:1px}
        .profile{margin-top:3px;gap:0}
        .profile strong{font-size:10px}
        .profile span{font-size:8.5px;line-height:1.25}
        .profileBottom{gap:6px}
        .zoomControls{gap:2px}
        .zoomBtn{height:18px;min-width:18px;padding:0 4px}
        .zoomReset{min-width:31px;font-size:8px}
        .body{padding:7px}
        .modeTabs{gap:4px;margin-bottom:5px;padding:2px;border-radius:9px}
        .modeTab{padding:5px 4px;border-radius:7px}
        .modeRow{margin-bottom:4px}
        .progress{height:6px}
        .stage{margin-top:3px;min-height:11px;font-size:8.5px}
        .stats{gap:3px;margin:5px 0}
        .stat{border-radius:8px;padding:4px 2px}
        .stat b{font-size:13px}
        .stat span{font-size:8px;margin-top:2px}
        .primary{padding:6px 9px;border-radius:9px}
        .grid,.utilityGrid{gap:4px;margin-top:4px}
        .secondary{padding:5px 4px;border-radius:8px}
        .status{margin-top:5px;padding:5px 7px;min-height:24px;max-height:42px;line-height:1.3}
        .legend{margin-top:3px;line-height:1.25}
        details.help{margin-top:2px}
        .creator{margin-top:4px;padding-top:4px;line-height:1.35}
        .creatorThought{min-height:18px;margin-bottom:2px;font-size:8.5px;line-height:1.25}
        .creatorSpark{font-size:8.5px}
        .thoughtShuffle{width:18px;height:18px;font-size:11px}
        .panel.qaMode .body{padding:7px}
        .panel.qaMode .hero{padding-bottom:6px}
        .qaCompactHead{padding:6px 8px;margin-bottom:5px}
        .compactStats{margin:4px 0}
        .compactStats .qaStat{padding:4px 2px}
        .qaProgressBox{margin:5px 0 2px;padding:5px 7px}
        .qaProgressMeta{margin-bottom:4px}
        .qaStats{margin:5px 0}
        .qaIssues{margin-top:5px;gap:4px}
        .qaActions{margin-top:5px;gap:4px}
'''

text = text.replace(needle, compact_css + needle)

required = [
    '// @version      17.21.0',
    "const SCRIPT_VERSION = '17.21.0';",
    '/* Compact panel density v17.21 */',
    'NO ACTIVE COMMAND = NO FIELD WRITES',
    'const SMART_THOUGHTS = Object.freeze([',
    'const THOUGHT_ROTATE_MS = 4 * 60 * 60 * 1000;',
    'GM_openInTab',
    'eu.i.posthog.com',
]
for marker in required:
    if marker not in text:
        raise SystemExit(f'Missing required invariant after patch: {marker}')

path.write_text(text, encoding='utf-8')
print('Applied Smart FormSense v17.21.0 compact panel density patch.')
