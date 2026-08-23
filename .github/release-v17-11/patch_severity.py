from pathlib import Path

p = Path('Smart_Form_Filler.user.js')
s = p.read_text(encoding='utf-8')

anchor = s.find('const buildQaFunctionalReport')
if anchor < 0:
    raise AssertionError('buildQaFunctionalReport anchor not found')

start = s.find('const severity', anchor)
end = s.find('findings.push({', start)
if start < 0 or end < 0:
    raise AssertionError('finding severity block not found')

indent = s[s.rfind('\n', 0, start) + 1:start]
replacement = (
    "const severity =\n"
    f"{indent}  status === 'blocker'\n"
    f"{indent}    ? 'critical'\n"
    f"{indent}    : status === 'failed'\n"
    f"{indent}      ? 'warning'\n"
    f"{indent}      : 'observation';\n\n"
    f"{indent}"
)

s = s[:start] + replacement + s[end:]
p.write_text(s, encoding='utf-8')
print('finding severity mapping patched')
