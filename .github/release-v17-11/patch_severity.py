from pathlib import Path

p = Path('Smart_Form_Filler.user.js')
s = p.read_text(encoding='utf-8')

anchor = s.find('    const addCase = ({')
if anchor < 0:
    raise AssertionError('addCase anchor not found')

start = s.find('      const severity =', anchor)
end = s.find('      findings.push({', start)
if start < 0 or end < 0:
    raise AssertionError('finding severity block not found')

replacement = """      const severity =
        status === 'blocker'
          ? 'critical'
          : status === 'failed'
            ? 'warning'
            : 'observation';

"""

s = s[:start] + replacement + s[end:]
p.write_text(s, encoding='utf-8')
print('finding severity mapping patched')
