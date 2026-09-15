from pathlib import Path

path = Path("Smart_Form_Filler.user.js")
text = path.read_text(encoding="utf-8")

PROJECT_KEY = "phc_tvkpunebfKwWRdUttkbJ4ZdphYmpeJaqj3MnZ7mP67c8"
POSTHOG_HOST = "https://eu.i.posthog.com"
POSTHOG_CONNECT = "eu.i.posthog.com"


def replace_config(name, value):
    global text
    prefix = f"  const {name} = "
    lines = text.splitlines()
    matches = [i for i, line in enumerate(lines) if line.startswith(prefix)]
    if len(matches) != 1:
        raise SystemExit(f"{name}: expected exactly 1 config line, found {len(matches)}")
    lines[matches[0]] = f"  const {name} = '{value}';"
    text = "\n".join(lines) + ("\n" if text.endswith("\n") else "")


replace_config("POSTHOG_PROJECT_KEY", PROJECT_KEY)
replace_config("POSTHOG_HOST", POSTHOG_HOST)

connect_line = f"// @connect      {POSTHOG_CONNECT}"
if connect_line not in text:
    anchor = "// @connect      raw.githubusercontent.com"
    if anchor not in text:
        raise SystemExit("Userscript metadata connect anchor missing")
    text = text.replace(anchor, f"{anchor}\n{connect_line}", 1)

# Safety and release invariants.
required = [
    "// @version      17.19.0",
    "const SCRIPT_VERSION = '17.19.0';",
    "Share Smart FormSense",
    "Developer Mode disabled",
    f"const POSTHOG_PROJECT_KEY = '{PROJECT_KEY}';",
    f"const POSTHOG_HOST = '{POSTHOG_HOST}';",
    connect_line,
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
print("Configured v17.19.0 analytics", path, "bytes", len(text.encode("utf-8")))
