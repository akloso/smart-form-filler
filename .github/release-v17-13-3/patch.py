from pathlib import Path

path = Path('Smart_Form_Filler.user.js')
text = path.read_text(encoding='utf-8')

# Version bump for this public userscript change.
old = '// @version      17.13.2'
new = '// @version      17.13.3'
assert text.count(old) == 1, f'version marker matched {text.count(old)} times'
text = text.replace(old, new, 1)

# Remove the obsolete direct dereference of qaRefreshBtn. The UI intentionally
# no longer renders that button, so this line throws before Open Report and
# Export Debug handlers can be attached.
obsolete = "    refs.qaRefreshBtn.onclick =\n      runSmartQaAudit;\n\n"
assert text.count(obsolete) == 1, f'obsolete qaRefreshBtn binding matched {text.count(obsolete)} times'
text = text.replace(obsolete, '', 1)

# Keep current release branding/report metadata aligned where present.
text = text.replace('Smart FormSense V17.13.2', 'Smart FormSense V17.13.3')
text = text.replace("productVersion: '17.13.2'", "productVersion: '17.13.3'")
text = text.replace("productVersion:\n        '17.13.2'", "productVersion:\n        '17.13.3'")

path.write_text(text, encoding='utf-8')
print('Patched Smart FormSense v17.13.3')
