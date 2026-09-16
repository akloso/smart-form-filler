from pathlib import Path
import json

path = Path('Smart_Form_Filler.user.js')
source = path.read_text(encoding='utf-8')

if '// @version      17.19.0' not in source:
    raise SystemExit('Expected production version 17.19.0 was not found')

source = source.replace('17.19.0', '17.20.0')

thoughts = [
    'Less form-filling. More chilling. 😎',
    'Ctrl+C. Ctrl+V. Retired.',
    'Forms fear this little tool.',
    'Click less. Live more.',
    'Powered by clicks, chaos & coffee ☕',
    'Doing the boring stuff so you don’t have to.',
    'Your forms called. They want automation.',
    'Built to bully boring forms.',
    'Saving your fingers, one field at a time.',
    'Form filling, but make it smart.',
    'Tiny tool. Big time saver.',
    'Fill fast. Test faster.',
    'Making boring forms slightly less boring.',
    'No magic. Just suspiciously smart automation.',
    'Built with logic, caffeine & mild chaos.',
    'Because typing the same thing twice is unnecessary.',
    'Your keyboard deserves a break.',
    'Automation entered the chat.',
    'Work smarter. Click fewer buttons.',
    'Forms are temporary. Automation is forever.',
    'One click closer to freedom.',
    'Why type when Smart FormSense exists?',
    'Repetitive work detected. Eliminating…',
    'Your productivity just got an upgrade.',
    'Let the machine do the boring part.',
    'Humans were not designed for repetitive forms.',
    'Making forms behave since 2026.',
    'A little automation never hurt anybody.',
    'More thinking. Less typing.',
    'You click. We handle the chaos.',
    'Forms filled. Sanity preserved.',
    'QA without the “ugh.”',
    'Testing forms so you don’t have to suffer.',
    'Another form? Cute.',
    'Challenge accepted, form.',
    'Boring task successfully automated.',
    'Manual typing has left the building.',
    'The form never saw it coming.',
    'Fields beware.',
    'Your shortcut to fewer shortcuts.',
    'Turning tedious into one-click-ish.',
    'Somewhere, a keyboard is thanking you.',
    'Less repetition. More actual work.',
    'Consider the boring part handled.',
    'Automation: because life is too short for duplicate entry.',
    'This could have been manual. Thankfully, it isn’t.',
    'Making “again?” feel like “done.”',
    'Smart forms deserve Smart FormSense.',
    'You bring the form. We bring the shortcuts.',
    'One tool. Fewer headaches.',
    'Keep calm and let Smart FormSense fill it.',
    'The unofficial enemy of repetitive typing.',
    'Your mouse can relax now.',
    'Making every click work harder.',
    'Built for people who have better things to do.',
    'Manual work? We don’t know her.',
    'Productivity, with a little personality.',
    'Fast fingers are optional now.',
    'Goodbye repetition. Hello Smart FormSense.',
    'One less boring thing on your screen.'
]

if len(thoughts) != 60:
    raise SystemExit(f'Expected 60 thoughts, found {len(thoughts)}')

constants_anchor = "  const DEVELOPER_MODE_MS = 60 * 60 * 1000;\n"
if source.count(constants_anchor) != 1:
    raise SystemExit('Thought constants anchor was not unique')

thoughts_json = json.dumps(thoughts, ensure_ascii=False, indent=4)
constants_block = (
    "\n  const THOUGHT_STATE_KEY = 'STFF_CREATOR_THOUGHT_V1';\n"
    "  const THOUGHT_ROTATE_MS = 4 * 60 * 60 * 1000;\n"
    f"  const SMART_THOUGHTS = Object.freeze({thoughts_json});\n"
)
source = source.replace(constants_anchor, constants_anchor + constants_block, 1)

pick_anchor = "  const pick = arr => arr[randomInt(0, arr.length - 1)];\n"
if source.count(pick_anchor) != 1:
    raise SystemExit('Thought helper anchor was not unique')

helper_block = r'''

  const readThoughtState = () => {
    try {
      const stored = GM_getValue(THOUGHT_STATE_KEY, null);
      return stored && typeof stored === 'object' ? stored : null;
    } catch {
      return null;
    }
  };

  const saveThoughtState = value => {
    try { GM_setValue(THOUGHT_STATE_KEY, value); } catch {}
  };

  const chooseThoughtIndex = avoidIndex => {
    if (!SMART_THOUGHTS.length) return -1;
    if (SMART_THOUGHTS.length === 1) return 0;

    let index = randomInt(0, SMART_THOUGHTS.length - 1);
    while (index === avoidIndex) {
      index = randomInt(0, SMART_THOUGHTS.length - 1);
    }
    return index;
  };

  const resolveCreatorThought = (forceNew = false) => {
    const now = Date.now();
    const stored = readThoughtState();
    const parsedIndex = Number(stored?.index);
    const currentIndex =
      Number.isInteger(parsedIndex) &&
      parsedIndex >= 0 &&
      parsedIndex < SMART_THOUGHTS.length
        ? parsedIndex
        : -1;
    const changedAt = Number(stored?.changedAt || 0);
    const expired = !changedAt || now - changedAt >= THOUGHT_ROTATE_MS;

    let index = currentIndex;
    if (forceNew || currentIndex < 0 || expired) {
      index = chooseThoughtIndex(currentIndex);
      saveThoughtState({ index, changedAt: now });
    }

    return SMART_THOUGHTS[index] || 'Smarter forms. Less effort.';
  };
'''
source = source.replace(pick_anchor, pick_anchor + helper_block, 1)

css_old = '''        .creator{
          margin-top:7px;
          padding-top:7px;
          border-top:1px solid #eeeaf8;
          text-align:center;
          font-size:8.5px;
          line-height:1.45;
          color:#8a8fa0;
          word-break:break-word
        }
        .creator strong{
          color:#5e5870;
          font-weight:800
        }
'''
css_new = '''        .creator{
          margin-top:7px;
          padding-top:7px;
          border-top:1px solid #eeeaf8;
          text-align:center;
          font-size:8.5px;
          line-height:1.45;
          color:#8a8fa0;
          word-break:break-word
        }
        .creatorThought{
          display:flex;
          align-items:center;
          justify-content:center;
          gap:5px;
          min-height:20px;
          margin-bottom:3px;
          color:#625a78;
          font-size:9px;
          font-weight:760;
          line-height:1.35
        }
        .creatorSpark{color:#8b5cf6;font-size:9px;flex:0 0 auto}
        .creatorThoughtText{
          display:inline-block;
          max-width:242px;
          transition:opacity .16s ease,transform .16s ease
        }
        .creatorThoughtText.changing{opacity:0;transform:translateY(2px)}
        .thoughtShuffle{
          width:20px;
          height:20px;
          display:inline-grid;
          place-items:center;
          flex:0 0 auto;
          padding:0;
          border:1px solid #e3dcfa;
          border-radius:999px;
          background:linear-gradient(135deg,#faf8ff,#f4f0ff);
          color:#7c3aed;
          font-size:12px;
          line-height:1;
          font-weight:900;
          cursor:pointer;
          transition:transform .16s ease,background .16s ease,border-color .16s ease,box-shadow .16s ease
        }
        .thoughtShuffle:hover,.thoughtShuffle:focus-visible{
          transform:rotate(18deg) scale(1.04);
          background:#f2edff;
          border-color:#c4b5fd;
          box-shadow:0 4px 12px rgba(124,58,237,.12);
          outline:none
        }
        .creatorIdentity{color:#8a8fa0}
        .creator strong{
          color:#5e5870;
          font-weight:800
        }
'''
if source.count(css_old) != 1:
    raise SystemExit('Creator CSS anchor was not unique')
source = source.replace(css_old, css_new, 1)

markup_old = '''          <div class="creator">
            Created with love ❤️ <strong>Akash Singh</strong> · <span id="creatorEmail"></span> · <button class="versionTap" id="versionTap" type="button">v17.20.0</button>
          </div>
'''
markup_new = '''          <div class="creator">
            <div class="creatorThought">
              <span class="creatorSpark" aria-hidden="true">✦</span>
              <span class="creatorThoughtText" id="creatorThought"></span>
              <button class="thoughtShuffle" id="thoughtShuffle" type="button" title="Show another thought" aria-label="Show another thought">↻</button>
            </div>
            <div class="creatorIdentity">❤️ <strong>Akash Singh</strong> · <span id="creatorEmail"></span> · <button class="versionTap" id="versionTap" type="button">v17.20.0</button></div>
          </div>
'''
if source.count(markup_old) != 1:
    raise SystemExit('Creator markup anchor was not unique')
source = source.replace(markup_old, markup_new, 1)

refs_anchor = "      creatorEmail: $('creatorEmail'),\n"
if source.count(refs_anchor) != 1:
    raise SystemExit('Creator refs anchor was not unique')
refs_new = (
    "      creatorThought: $('creatorThought'),\n"
    "      thoughtShuffle: $('thoughtShuffle'),\n"
    "      creatorEmail: $('creatorEmail'),\n"
)
source = source.replace(refs_anchor, refs_new, 1)

email_block = '''    if (
      refs.creatorEmail
    ) {
      refs.creatorEmail.textContent =
        'akash.singh@meritto.com';
    }
'''
thought_ui = r'''

    const renderCreatorThought = ({ forceNew = false, animate = false } = {}) => {
      if (!refs.creatorThought) return;

      const apply = () => {
        refs.creatorThought.textContent = resolveCreatorThought(forceNew);
        refs.creatorThought.classList.remove('changing');
      };

      if (animate && refs.creatorThought.textContent) {
        refs.creatorThought.classList.add('changing');
        setTimeout(apply, 160);
      } else {
        apply();
      }
    };

    renderCreatorThought();

    refs.thoughtShuffle?.addEventListener('click', event => {
      event.stopPropagation();
      renderCreatorThought({ forceNew: true, animate: true });
    });
'''
if source.count(email_block) != 1:
    raise SystemExit('Creator email anchor was not unique')
source = source.replace(email_block, email_block + thought_ui, 1)

restore_anchor = '''    const restore = () => {
      refs.mini.style.display = 'none';
      refs.panel.style.display = 'block';
      fitPanelToViewport();
'''
restore_new = '''    const restore = () => {
      refs.mini.style.display = 'none';
      refs.panel.style.display = 'block';
      renderCreatorThought();
      fitPanelToViewport();
'''
if source.count(restore_anchor) != 1:
    raise SystemExit('Restore anchor was not unique')
source = source.replace(restore_anchor, restore_new, 1)

reset_anchor = '''      resetToDefaultOpen() {
        resetHostPosition();
        refs.mini.style.display = 'none';
        refs.panel.style.display = 'block';
        fitPanelToViewport();
'''
reset_new = '''      resetToDefaultOpen() {
        resetHostPosition();
        refs.mini.style.display = 'none';
        refs.panel.style.display = 'block';
        renderCreatorThought();
        fitPanelToViewport();
'''
if source.count(reset_anchor) != 1:
    raise SystemExit('Reset/open anchor was not unique')
source = source.replace(reset_anchor, reset_new, 1)

path.write_text(source, encoding='utf-8')
