from pathlib import Path

path = Path("Smart_Form_Filler.user.js")
text = path.read_text(encoding="utf-8")


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 anchor, found {count}")
    text = text.replace(old, new, 1)


# Make the share menu more colorful and lively while keeping it compact.
replace_once(
    ".shareHead{display:flex;align-items:center;justify-content:space-between;padding:14px 15px;border-bottom:1px solid #eeeaf7;background:linear-gradient(135deg,#faf9ff,#fff)}\n"
    "        .shareHead h3{margin:0;font-size:14px}.shareHead p{margin:3px 0 0;font-size:9px;color:#817a91}\n"
    "        .shareClose{border:0;background:#f3f0fb;color:#655d78;width:30px;height:30px;border-radius:9px;cursor:pointer;font-size:17px}\n"
    "        .shareBody{padding:15px}\n"
    "        .shareGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}\n"
    "        .shareChannel{border:1px solid #e7e2f6;background:#fff;border-radius:11px;padding:11px 9px;cursor:pointer;text-align:left;color:#342e48;transition:.15s}\n"
    "        .shareChannel:hover,.shareChannel:focus-visible{border-color:#8b5cf6;background:#faf8ff}\n"
    "        .shareChannel b{display:block;font-size:10px}.shareChannel span{display:block;font-size:8.5px;color:#817a91;margin-top:2px}",
    ".shareHead{display:flex;align-items:center;justify-content:space-between;padding:14px 15px;border-bottom:1px solid #e9e3fb;background:linear-gradient(135deg,#f4f1ff 0%,#fff 48%,#fdf2ff 100%)}\n"
    "        .shareHead h3{margin:0;font-size:14px;color:#2f2350}.shareHead p{margin:3px 0 0;font-size:9px;color:#817a91}\n"
    "        .shareClose{border:0;background:#eee9ff;color:#655d78;width:30px;height:30px;border-radius:9px;cursor:pointer;font-size:17px;transition:.15s}\n"
    "        .shareClose:hover{background:#e4dcff;color:#4c3e78}\n"
    "        .shareBody{padding:15px;background:linear-gradient(180deg,#fff 0%,#fcfbff 100%)}\n"
    "        .shareGrid{display:grid;grid-template-columns:1fr 1fr;gap:9px}\n"
    "        .shareChannel{position:relative;overflow:hidden;border:1px solid #e7e2f6;background:#fff;border-radius:12px;padding:12px 10px;cursor:pointer;text-align:left;color:#342e48;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}\n"
    "        .shareChannel::after{content:'';position:absolute;width:54px;height:54px;border-radius:999px;right:-17px;top:-18px;opacity:.22;background:currentColor}\n"
    "        .shareChannel[data-share-channel='email']{background:linear-gradient(135deg,#eff6ff,#eef2ff);border-color:#bfdbfe;color:#1d4ed8}\n"
    "        .shareChannel[data-share-channel='copy']{background:linear-gradient(135deg,#faf5ff,#f5f3ff);border-color:#ddd6fe;color:#6d28d9}\n"
    "        .shareChannel[data-share-channel='whatsapp']{background:linear-gradient(135deg,#ecfdf5,#f0fdf4);border-color:#bbf7d0;color:#15803d}\n"
    "        .shareChannel[data-share-channel='teams']{background:linear-gradient(135deg,#f5f3ff,#eef2ff);border-color:#c7d2fe;color:#4f46e5}\n"
    "        .shareChannel:hover,.shareChannel:focus-visible{transform:translateY(-1px);box-shadow:0 8px 20px rgba(42,32,76,.10);filter:saturate(1.08)}\n"
    "        .shareChannel b{display:block;position:relative;z-index:1;font-size:10.5px;color:inherit}.shareChannel span{display:block;position:relative;z-index:1;font-size:8.5px;color:#6f6880;margin-top:3px}",
    "share card styling",
)

# Use a real clickable mailto anchor so browser mail handlers can receive it,
# then fall back to a prefilled browser mail draft when no handler takes focus.
replace_once(
    """        if (channel === 'email') {\n          const to = parsed.list.join(',');\n          const url = `mailto:${to}?subject=${encodeURIComponent(SHARE_SUBJECT)}&body=${encodeURIComponent(body)}`;\n          trackAnalytics('share_clicked', { channel: 'email', result: 'prepared' });\n          location.href = url;\n          return;\n        }""",
    """        if (channel === 'email') {\n          const to = parsed.list.join(',');\n          const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(SHARE_SUBJECT)}&body=${encodeURIComponent(body)}`;\n          const webMailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(SHARE_SUBJECT)}&body=${encodeURIComponent(body)}`;\n\n          trackAnalytics('share_clicked', { channel: 'email', result: 'prepared' });\n\n          let browserLostFocus = false;\n          const markBlurred = () => { browserLostFocus = true; };\n          window.addEventListener('blur', markBlurred, { once: true });\n          document.addEventListener('visibilitychange', () => {\n            if (document.hidden) browserLostFocus = true;\n          }, { once: true });\n\n          const mailLink = document.createElement('a');\n          mailLink.href = mailtoUrl;\n          mailLink.style.display = 'none';\n          (document.body || document.documentElement).appendChild(mailLink);\n          mailLink.click();\n          mailLink.remove();\n\n          setTimeout(() => {\n            if (browserLostFocus || document.hidden || !document.hasFocus()) return;\n            try {\n              GM_openInTab(webMailUrl, { active: true, insert: true, setParent: true });\n              trackAnalytics('share_clicked', { channel: 'email', result: 'web_fallback' });\n            } catch {\n              window.open(webMailUrl, '_blank', 'noopener,noreferrer');\n            }\n          }, 900);\n          return;\n        }""",
    "email compose fallback",
)

# Release and privacy invariants.
required = [
    "// @version      17.19.0",
    "const SCRIPT_VERSION = '17.19.0';",
    "Share Smart FormSense",
    "Developer Mode disabled",
    "data-share-channel='email'",
    "webMailUrl = `https://mail.google.com/mail/",
    "GM_openInTab(webMailUrl",
    "$process_person_profile: false",
    "hostname: location.hostname || ''",
]
for marker in required:
    if marker not in text:
        raise SystemExit(f"Required marker missing: {marker}")

if "commitSelectedRadioGroups" in text:
    raise SystemExit("Forbidden legacy function reintroduced")
if "// @match        *://*/*" not in text:
    raise SystemExit("Global match invariant missing")
if "// @noframes" in text:
    raise SystemExit("noframes must not be introduced")

path.write_text(text, encoding="utf-8")
print("Refined v17.19.0 share UX", path, "bytes", len(text.encode("utf-8")))
