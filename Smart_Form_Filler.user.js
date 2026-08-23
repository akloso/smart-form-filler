// ==UserScript==
// @name         Smart FormSense
// @namespace    smart-form-filler
// @version      17.11.2
// @description  Intelligent form filling and QA testing for authorized web-form validation, readiness checks, embedded forms, safe repair, and synthetic test data.
// @author       Akash Singh
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const IS_TOP =
    window.top === window.self;

  const IS_FRAME =
    !IS_TOP;

  const PROFILE_KEY = 'STFF_V17_7_PROFILE';
  const LEGACY_PROFILE_KEY = 'STFF_V17_6_PROFILE';
  const PANEL_ID = '__stff_v17_7_panel_host';
  const REVIEW_ATTR = 'data-stff-review';
  const ERROR_ATTR = 'data-stff-error';
  const MANUAL_ATTR = 'data-stff-manual';
  const FILLED_ATTR = 'data-stff-filled';
  const PRESERVED_ATTR = 'data-stff-preserved';
  const FIELD_KEY_ATTR = 'data-stff-field-key';
  const TECH_CACHE_KEY = 'STFF_V17_7_TECH_CACHE';
  const RUN_SESSION_KEY = 'STFF_V17_7_RUN_SESSION';
  const MAX_FILL_BUDGET_MS = 15000;
  const VALIDATE_HARD_LIMIT_MS = 12000;
  const RECHECK_HARD_LIMIT_MS = 30000;
  const NORMAL_NO_PROGRESS_MS = 700;
  const DEEP_NO_PROGRESS_MS = 1300;
  const DEPENDENCY_LONG_WAIT_MS = 850;
  const DEPENDENCY_SHORT_WAIT_MS = 90;
  const TECH_CACHE_MAX_FORMS = 25;
  const MAX_DYNAMIC_PASSES = 3;
  const DYNAMIC_TIMEOUT_MS = 2800;
  const STABLE_QUIET_MS = 280;

  const BRIDGE_MARKER = '__STFF_V17_7_BRIDGE__';
  const FRAME_DISCOVERY_SOFT_MS = 500;
  const FRAME_DISCOVERY_HARD_MS = 2600;
  const FRAME_AGENT_STALE_MS = 12000;
  const REMOTE_COMMAND_TIMEOUT_MS = 42000;
  const QA_REMOTE_COMMAND_TIMEOUT_MS = 300000;

  const state = {
    running: false,
    stopRequested: false,
    mode: 'all',
    startTime: 0,
    timerId: null,
    snapshots: new Map(),
    lastScriptValues: new Map(),
    stats: {
      filled: new Set(),
      preserved: new Set(),
      review: new Set(),
      errors: new Set(),
      manual: new Set()
    },
    navIndex: { filled: 0, preserved: 0, review: 0, errors: 0, manual: 0 },
    formModel: new Map(),
    runtimeConstraints: new Map(),
    usedMobiles: new Set(),
    usedEmails: new Set(),
    repairAttempts: new Map(),
    generatedValues: new Map(),
    accepted: new Set(),
    rejected: new Set(),
    pending: new Set(),
    knownFieldKeys: new Set(),
    currentFormSignature: '',
    currentFormCache: null,
    techCache: null,
    academicPlan: null,
    dependencyGraph: new Map(),
    diagnostics: new Map(),
    pendingDescriptors: new Map(),
    deepRepairHistory: new Map(),
    fillDeadline: 0,
    pageUnloading: false,
    modelBuild: 0,
    liveTimer: null,
    liveWatchInstalled: false,
    liveObserver: null,
    debugEvents: [],
    lastProgressText: '',
    committedRadioGroups: new Set(),
    lastRuntimeError: null,
    panel: null,
    activeRemoteAgentId: null,
    lastRemoteAgentId: null,
    activeRemoteRequestId: null,
    activeRemoteAction: null,
    workspace: 'fill',
    qaReport: null,
    qaNavIndex: 0,
    qaProgressPercent: 0
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const yieldToUI = () =>
    new Promise(resolve => {
      const done = () =>
        setTimeout(resolve, 0);

      try {
        requestAnimationFrame(done);
      } catch {
        done();
      }
    });

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const normalize = value => String(value || '')
    .replace(/[\u00A0\t\r\n]+/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();


  const debugEvent = (
    type,
    details = {}
  ) => {
    const event = {
      at: new Date().toISOString(),
      elapsedMs:
        state.startTime
          ? Date.now() - state.startTime
          : null,
      type,
      ...details
    };

    state.debugEvents.push(event);

    if (state.debugEvents.length > 180) {
      state.debugEvents.splice(
        0,
        state.debugEvents.length - 180
      );
    }
  };


  const recordRuntimeError = (
    stage,
    error
  ) => {
    const message =
      String(
        error?.message ||
        error ||
        'Unknown runtime error'
      );

    const stack =
      String(
        error?.stack ||
        ''
      )
        .split('\n')
        .slice(0, 8)
        .join('\n');

    state.lastRuntimeError = {
      at:
        new Date().toISOString(),
      stage,
      message,
      stack
    };

    debugEvent(
      'runtime-error',
      state.lastRuntimeError
    );

    console.error(
      `Smart FormSense V17.11.2 [${stage}]`,
      error
    );

    return message;
  };

  const alphaOnly = value => String(value || '')
    .replace(/[^a-zA-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const digitsOnly = value => String(value || '').replace(/\D+/g, '');

  const hash32 = value => {
    const text = String(value || '');
    let h = 2166136261;

    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }

    return h >>> 0;
  };

  const deterministicDigits = (seedText, length) => {
    let seed = hash32(seedText) || 0x9e3779b9;
    let result = '';

    while (result.length < length) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      result += String(seed % 10);
    }

    return result.slice(0, length);
  };

  const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = arr => arr[randomInt(0, arr.length - 1)];
  const prefixTestName = value => {
    const clean = String(value || '').trim();
    if (!clean) return 'Test';
    return /^test\b/i.test(clean) ? clean : `Test ${clean}`;
  };



  const loadTechCache = () => {
    const stored = GM_getValue(TECH_CACHE_KEY, null);

    if (
      stored &&
      typeof stored === 'object' &&
      stored.forms &&
      typeof stored.forms === 'object'
    ) {
      return stored;
    }

    return {
      version: 1,
      forms: {}
    };
  };

  const saveTechCache = () => {
    if (!state.techCache) return;

    const entries = Object.entries(state.techCache.forms || {})
      .sort((a, b) => (b[1]?.lastUsed || 0) - (a[1]?.lastUsed || 0))
      .slice(0, TECH_CACHE_MAX_FORMS);

    state.techCache.forms = Object.fromEntries(entries);

    try {
      GM_setValue(TECH_CACHE_KEY, state.techCache);
    } catch {}
  };


  const getRunSession = () => {
    const session = GM_getValue(RUN_SESSION_KEY, null);

    if (!session || typeof session !== 'object') {
      return null;
    }

    return session;
  };

  const writeRunSession = patch => {
    const current = getRunSession() || {};

    const next = {
      ...current,
      ...patch,
      updatedAt: Date.now()
    };

    GM_setValue(RUN_SESSION_KEY, next);
    return next;
  };

  const startRunSession = (mode, resumed = false) => {
    if (!IS_TOP) return;

    const current = getRunSession();

    if (
      resumed &&
      current?.active
    ) {
      return writeRunSession({
        mode,
        active: true,
        hostname: location.hostname,
        pathname: location.pathname,
        profileId: profile.id
      });
    }

    return writeRunSession({
      active: true,
      mode,
      hostname: location.hostname,
      pathname: location.pathname,
      profileId: profile.id,
      startedAt: Date.now(),
      resumeCount: 0
    });
  };

  const touchRunSession = () => {
    if (!IS_TOP) return;

    const current = getRunSession();

    if (!current?.active) {
      return;
    }

    writeRunSession({
      hostname: location.hostname,
      pathname: location.pathname
    });
  };

  const clearRunSession = () => {
    if (!IS_TOP) return;

    try {
      GM_setValue(RUN_SESSION_KEY, {
        active: false,
        updatedAt: Date.now()
      });
    } catch {}
  };

  const withinFillBudget = reserveMs =>
    !state.fillDeadline ||
    Date.now() + (reserveMs || 0) < state.fillDeadline;

  const remainingFillBudget = () =>
    state.fillDeadline
      ? Math.max(0, state.fillDeadline - Date.now())
      : MAX_FILL_BUDGET_MS;

  window.addEventListener(
    'beforeunload',
    () => {
      state.pageUnloading = true;
      touchRunSession();
    },
    true
  );

  const formatTodayISO = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const makeEmail = (name, token = '', forceSuffix = false) => {
    const local = normalize(name)
      .replace(/[^a-z0-9 ]+/g, '')
      .trim()
      .replace(/\s+/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'test.user';

    let email = `${local}@gmail.com`;

    if (
      forceSuffix ||
      state.usedEmails.has(email)
    ) {
      const suffixSource =
        digitsOnly(token) ||
        deterministicDigits(
          `${profile?.seed || Date.now()}|${local}|email`,
          3
        );

      const suffix =
        suffixSource.slice(-3).padStart(2, '7');

      email = `${local}.${suffix}@gmail.com`;
    }

    let guard = 0;

    while (
      state.usedEmails.has(email) &&
      guard < 20
    ) {
      guard++;
      const suffix = deterministicDigits(
        `${token}|${local}|${guard}|${Date.now()}`,
        3
      );

      email = `${local}.${suffix}@gmail.com`;
    }

    state.usedEmails.add(email);
    return email;
  };

  const makeMobile = (prefix = '', token = '') => {
    const preferredLead = digitsOnly(prefix).charAt(0);
    const lead = /^[6-9]$/.test(preferredLead)
      ? preferredLead
      : pick(['6', '7', '8', '9']);

    let candidate = '';

    for (let attempt = 0; attempt < 40; attempt++) {
      const entropy = digitsOnly(
        `${Date.now()}${token}${Math.random().toString().slice(2)}${randomInt(100000, 999999)}`
      );

      const tail = entropy.slice(-9).padStart(9, String(randomInt(0, 9)));
      candidate = `${lead}${tail}`.slice(0, 10);

      if (!state.usedMobiles.has(candidate)) {
        state.usedMobiles.add(candidate);
        return candidate;
      }
    }

    candidate = `${lead}${String(randomInt(100000000, 999999999))}`;
    state.usedMobiles.add(candidate);
    return candidate;
  };

  const createProfile = () => {
    const token = `${Date.now().toString().slice(-7)}${randomInt(10, 99)}`;
    const first = pick(['Aarav', 'Akash', 'Arjun', 'Rohan', 'Aditya', 'Kabir', 'Vihaan', 'Kunal']);
    const last = pick(['Sharma', 'Verma', 'Singh', 'Mehta', 'Kapoor', 'Gupta']);
    const fatherFirst = pick(['Rajesh', 'Suresh', 'Manoj', 'Vijay', 'Anil', 'Rakesh']);
    const motherFirst = pick(['Sunita', 'Anita', 'Kavita', 'Pooja', 'Meena', 'Neha']);
    const guardianFirst = pick(['Vikram', 'Amit', 'Deepak', 'Sanjay', 'Nitin']);

    const applicantFirst = prefixTestName(first);
    const applicantFull = `${applicantFirst} ${last}`;
    const fatherName = `Test ${fatherFirst} ${last}`;
    const motherName = `Test ${motherFirst} ${last}`;
    const guardianName = `Test ${guardianFirst} ${last}`;

    const dobYear = 2000;
    const dobISO = `${dobYear}-11-18`;
    const year10 = dobYear + 16;
    const year12 = dobYear + 18;
    const ugStart = year12;
    const ugEnd = dobYear + 22;
    const pgStart = ugEnd;
    const pgEnd = dobYear + 24;

    const academic = {
      class10: {
        school: 'Test Greenfield Public School',
        board: 'CBSE',
        year: String(year10),
        passingDate: `${year10}-05-31`,
        maxMarks: '500',
        obtainedMarks: '410',
        percentage: '82',
        cgpa: '8.2'
      },
      class12: {
        school: 'Test Greenfield Senior Secondary School',
        board: 'CBSE',
        stream: 'Science',
        year: String(year12),
        passingDate: `${year12}-05-31`,
        maxMarks: '500',
        obtainedMarks: '420',
        percentage: '84',
        cgpa: '8.4'
      },
      ug: {
        institution: 'Test National Institute of Technology',
        qualification: 'B.Tech',
        stream: 'Computer Science',
        startYear: String(ugStart),
        endYear: String(ugEnd),
        passingDate: `${ugEnd}-05-31`,
        maxMarks: '1000',
        obtainedMarks: '780',
        percentage: '78',
        cgpa: '7.8'
      },
      pg: {
        institution: 'Test Institute of Management',
        qualification: 'MBA',
        stream: 'Finance',
        startYear: String(pgStart),
        endYear: String(pgEnd),
        passingDate: `${pgEnd}-05-31`,
        maxMarks: '1000',
        obtainedMarks: '800',
        percentage: '80',
        cgpa: '8.0'
      }
    };

    return {
      id: `QA-${token.slice(-8)}`,
      token,
      seed: hash32(token),
      title: 'Mr',
      gender: 'Male',
      firstName: applicantFirst,
      middleName: 'Test Kumar',
      lastName: prefixTestName(last),
      fullName: applicantFull,
      email: makeEmail(applicantFull),
      mobile: makeMobile('90000', token),
      alternateMobile: makeMobile('90100', token),
      dobISO,
      age: String(new Date().getFullYear() - dobYear),
      bloodGroup: 'B+',
      maritalStatus: 'Single',
      religion: 'HINDUISM',
      nationality: 'Indian',
      category: 'General',
      aadhaar: `9999${digitsOnly(token).slice(-8).padStart(8, '0')}`,
      pan: `TESTP${digitsOnly(token).slice(-4).padStart(4, '0')}T`,
      father: {
        title: 'Mr',
        name: fatherName,
        email: makeEmail(fatherName),
        mobile: makeMobile('91000', `${token}1`),
        occupation: 'Business'
      },
      mother: {
        title: 'Mrs',
        name: motherName,
        email: makeEmail(motherName),
        mobile: makeMobile('92000', `${token}2`),
        occupation: 'Homemaker'
      },
      guardian: {
        title: 'Mr',
        name: guardianName,
        email: makeEmail(guardianName),
        mobile: makeMobile('93000', `${token}3`),
        occupation: 'Business',
        relationship: 'Uncle'
      },
      address: {
        country: 'India',
        state: 'Delhi',
        district: 'Central Delhi',
        city: 'New Delhi',
        line1: `Test House ${randomInt(10, 99)}, Sector 18`,
        line2: 'Test Locality',
        pincode: '110001'
      },
      occupation: 'Student',
      organization: 'Test Organization',
      familyIncome: '5-10 Lakh',
      place: 'New Delhi',
      academic,
      paragraph: `This is synthetic test data generated for QA testing. Test reference ${token}.`,
      genericText: 'Test Data'
    };
  };

  const loadProfile = () => {
    const saved = GM_getValue(PROFILE_KEY, null);
    if (saved && typeof saved === 'object') return saved;
    const legacy = GM_getValue(LEGACY_PROFILE_KEY, null);
    if (legacy && typeof legacy === 'object') {
      GM_setValue(PROFILE_KEY, legacy);
      return legacy;
    }
    const profile = createProfile();
    GM_setValue(PROFILE_KEY, profile);
    return profile;
  };

  let profile = loadProfile();

  const normalizeProfileTestNames = p => {
    if (!p || typeof p !== 'object') return p;
    p.firstName = prefixTestName(p.firstName || 'User');
    p.middleName = prefixTestName(p.middleName || 'Kumar');
    p.lastName = prefixTestName(p.lastName || 'Sharma');

    const baseFull = String(p.fullName || '')
      .replace(/^test\s+/i, '')
      .replace(/\s+test\s+/ig, ' ')
      .trim();

    p.fullName = prefixTestName(baseFull || 'User');

    if (p.father) p.father.name = prefixTestName(p.father.name || 'Father');
    if (p.mother) p.mother.name = prefixTestName(p.mother.name || 'Mother');
    if (p.guardian) p.guardian.name = prefixTestName(p.guardian.name || 'Guardian');

    if (!p.aadhaar) {
      const token = digitsOnly(p.token || Date.now()).slice(-8).padStart(8, '0');
      p.aadhaar = `9999${token}`;
    }

    if (!p.pan) {
      const token = digitsOnly(p.token || Date.now()).slice(-4).padStart(4, '0');
      p.pan = `TESTP${token}T`;
    }

    if (!p.seed) {
      p.seed = hash32(p.token || p.id || Date.now());
    }

    const legacyQaEmail = value =>
      /(?:^|\.)qa\d+@gmail\.com$/i.test(
        String(value || '')
      );

    if (
      !p.email ||
      legacyQaEmail(p.email)
    ) {
      p.email = makeEmail(p.fullName || 'Test User');
    }

    if (p.father && (
      !p.father.email ||
      legacyQaEmail(p.father.email)
    )) {
      p.father.email = makeEmail(
        p.father.name || 'Test Father'
      );
    }

    if (p.mother && (
      !p.mother.email ||
      legacyQaEmail(p.mother.email)
    )) {
      p.mother.email = makeEmail(
        p.mother.name || 'Test Mother'
      );
    }

    if (p.guardian && (
      !p.guardian.email ||
      legacyQaEmail(p.guardian.email)
    )) {
      p.guardian.email = makeEmail(
        p.guardian.name || 'Test Guardian'
      );
    }

    return p;
  };

  profile = normalizeProfileTestNames(profile);
  GM_setValue(PROFILE_KEY, profile);

  const saveProfile = () => GM_setValue(PROFILE_KEY, normalizeProfileTestNames(profile));

  const parseFlexibleDateToISO = value => {
    const text = String(value || '').trim();

    let m = text.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return text;

    return null;
  };

  const syncProfileFromExistingApplicant = () => {
    let changed = false;
    let first = '';
    let last = '';
    let full = '';

    for (const doc of collectDocuments()) {
      allFields(doc).forEach(el => {
        if (!isVisible(el) || !fieldHasValue(el)) return;

        const key = directContext(el);

        if (/father|mother|guardian|parent/.test(key)) return;

        const value = String(el.value || el.textContent || '').trim();
        if (!value) return;

        if (/first name|firstname|given name/.test(key)) {
          first = prefixTestName(value);
        } else if (/last name|lastname|surname|family name/.test(key)) {
          last = prefixTestName(value);
        } else if (/applicant name|candidate name|student name|full name/.test(key)) {
          full = prefixTestName(value);
        } else if (/email/.test(key) || normalize(el.type) === 'email') {
          profile.email = value;
          changed = true;
        } else if (/mobile|phone|contact number|contact no/.test(key) || normalize(el.type) === 'tel') {
          profile.mobile = value;
          changed = true;
        } else if (/date of birth|birth date|\bdob\b/.test(key)) {
          const iso = parseFlexibleDateToISO(value);
          if (iso) {
            profile.dobISO = iso;
            changed = true;
          }
        }
      });
    }

    if (first) {
      profile.firstName = first;
      changed = true;
    }

    if (last) {
      profile.lastName = last;
      changed = true;
    }

    if (full) {
      profile.fullName = full;
      changed = true;
    } else if (first || last) {
      profile.fullName = `${profile.firstName} ${profile.lastName}`.trim();
      changed = true;
    }

    if (changed) {
      saveProfile();
      state.panel?.refreshProfile();
    }
  };

  const cssEscape = (doc, value) => {
    try { return doc.defaultView.CSS.escape(value); }
    catch { return String(value).replace(/["\\]/g, '\\$&'); }
  };

  const basicVisible = el => {
    if (!el || el.type === 'hidden') return false;

    try {
      const win = el.ownerDocument.defaultView;
      const style = win.getComputedStyle(el);

      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        Number(style.opacity || '1') === 0
      ) {
        return false;
      }

      return el.getClientRects().length > 0;
    } catch {
      return false;
    }
  };

  const isVisible = el => {
    if (!el || el.type === 'hidden') return false;

    // Native SELECTs hidden by Chosen/Select2 only count as visible when
    // their actual visual widget is visible. This avoids "hidden/internal"
    // template controls being treated as active merely because they carry
    // a plugin class.
    if (
      el.tagName === 'SELECT' &&
      (
        el.classList.contains('chosen-select') ||
        el.classList.contains('select2-hidden-accessible')
      )
    ) {
      let widget = null;

      try {
        const next = el.nextElementSibling;

        if (
          next?.classList?.contains('chosen-container') ||
          next?.classList?.contains('select2') ||
          next?.classList?.contains('select2-container')
        ) {
          widget = next;
        }

        if (!widget) {
          widget =
            el.parentElement?.querySelector(
              '.chosen-container,.select2-container'
            ) || null;
        }
      } catch {}

      return !!widget && basicVisible(widget);
    }

    return basicVisible(el);
  };

  const cleanStructuralText = node => {
    if (!node) return '';

    let clone = null;

    try {
      clone = node.cloneNode(true);
    } catch {
      return normalize(
        node.innerText ||
        node.textContent ||
        ''
      );
    }

    try {
      clone
        .querySelectorAll(
          'input,select,textarea,button,script,style,.chosen-container,.select2-container,.select2-dropdown,.ui-datepicker,.datepicker,.flatpickr-calendar'
        )
        .forEach(item => item.remove());
    } catch {}

    try {
      clone
        .querySelectorAll(
          '.error,.errors,.help-block,.invalid-feedback,.field-error,.error-message,.text-danger,[class*="error"],[class*="invalid"]'
        )
        .forEach(item => item.remove());
    } catch {}

    const text =
      String(
        clone.innerText ||
        clone.textContent ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();

    return text;
  };

  const tableHeaderContext = el => {
    const cell =
      el.closest('td,th');

    if (!cell) return '';

    const row =
      cell.closest('tr');

    const table =
      cell.closest('table');

    if (!row || !table) return '';

    const rowCells =
      [...row.children]
        .filter(node =>
          /^(TD|TH)$/i.test(
            node.tagName
          )
        );

    const index =
      rowCells.indexOf(cell);

    if (index < 0) return '';

    const candidates = [];

    // Highest-confidence source: THEAD.
    try {
      const headerRows =
        [
          ...table.querySelectorAll(
            ':scope > thead > tr'
          )
        ];

      for (
        let i =
          headerRows.length - 1;
        i >= 0;
        i--
      ) {
        const cells =
          [...headerRows[i].children]
            .filter(node =>
              /^(TD|TH)$/i.test(
                node.tagName
              )
            );

        const header =
          cells[index];

        if (!header) continue;

        const text =
          cleanStructuralText(
            header
          );

        if (text) {
          candidates.push(text);
          break;
        }
      }
    } catch {}

    if (candidates.length) {
      return candidates.join(' ');
    }

    // Fallback: only explicit header-like rows before the current row.
    // Never harvest ordinary data rows, selected values, or validation text.
    const rows =
      [
        ...table.querySelectorAll(
          'tr'
        )
      ];

    const currentIndex =
      rows.indexOf(row);

    for (
      let i = currentIndex - 1;
      i >= 0;
      i--
    ) {
      const candidateRow =
        rows[i];

      const cells =
        [...candidateRow.children]
          .filter(node =>
            /^(TD|TH)$/i.test(
              node.tagName
            )
          );

      if (!cells.length) {
        continue;
      }

      const hasControls =
        !!candidateRow.querySelector(
          'input,select,textarea,[contenteditable="true"]'
        );

      const explicitHeader =
        cells.some(
          item =>
            item.tagName === 'TH'
        ) ||
        !!candidateRow.querySelector(
          'strong,b,.table-header,.thead,.column-title'
        );

      if (
        hasControls &&
        !explicitHeader
      ) {
        continue;
      }

      if (!explicitHeader) {
        // Permit the first non-control row as a header-like row.
        const firstDataRow =
          rows.findIndex(r =>
            !!r.querySelector(
              'input,select,textarea,[contenteditable="true"]'
            )
          );

        if (
          firstDataRow >= 0 &&
          i >= firstDataRow
        ) {
          continue;
        }
      }

      const header =
        cells[index];

      if (!header) continue;

      const text =
        cleanStructuralText(
          header
        );

      if (text) {
        return text;
      }
    }

    return '';
  };


  const tableRowLabelContext = el => {
    const cell =
      el?.closest?.('td,th');

    const row =
      cell?.closest?.('tr');

    if (!cell || !row) {
      return '';
    }

    const cells =
      [...row.children]
        .filter(node =>
          /^(TD|TH)$/i.test(
            node.tagName
          )
        );

    const currentIndex =
      cells.indexOf(cell);

    const candidates = [];

    for (
      let i = 0;
      i < cells.length;
      i++
    ) {
      if (i === currentIndex) {
        continue;
      }

      const candidate =
        cells[i];

      // Row identity is usually in a header cell or the first short
      // non-control cell (10th / 12th / UG / PG / row number).
      const hasControls =
        !!candidate.querySelector(
          'input,select,textarea,[contenteditable="true"]'
        );

      if (
        hasControls &&
        candidate.tagName !== 'TH'
      ) {
        continue;
      }

      const text =
        cleanStructuralText(
          candidate
        );

      if (
        !text ||
        text.length > 100
      ) {
        continue;
      }

      if (
        candidate.tagName === 'TH' ||
        i === 0 ||
        /10th|12th|class\s*x\b|class\s*xii|ug\b|pg\b|under ?graduate|post ?graduate|graduation|row\s*\d+/.test(
          normalize(text)
        )
      ) {
        candidates.push(text);
      }
    }

    return [
      ...new Set(
        candidates
      )
    ].join(' ');
  };

  const repeatingRowOrdinal = el => {
    const row =
      el?.closest?.('tr');

    const table =
      row?.closest?.('table');

    if (!row || !table) {
      return 1;
    }

    const rows =
      [...table.querySelectorAll(
        'tr'
      )].filter(candidate =>
        !!candidate.querySelector(
          'input,select,textarea,[contenteditable="true"]'
        )
      );

    const index =
      rows.indexOf(row);

    return index >= 0
      ? index + 1
      : 1;
  };

  const distinctTextForRepeatedField =
    (
      el,
      base = 'Test Value',
      attempt = 0
    ) => {
      const ordinal =
        repeatingRowOrdinal(el);

      const suffixes = [
        'Alpha',
        'Beta',
        'Gamma',
        'Delta',
        'Epsilon',
        'Zeta'
      ];

      const suffix =
        suffixes[
          (
            ordinal -
            1 +
            attempt
          ) %
          suffixes.length
        ];

      const cleanBase =
        String(
          base || 'Test Value'
        )
          .replace(
            /\s+(Alpha|Beta|Gamma|Delta|Epsilon|Zeta|\d+)$/i,
            ''
          )
          .trim();

      return `${cleanBase} ${suffix}`;
    };

  const distinctNumericForRepeatedField =
    (
      el,
      base = 10,
      attempt = 0
    ) => {
      const ordinal =
        repeatingRowOrdinal(el);

      const numeric =
        Number(base);

      const start =
        Number.isFinite(numeric) &&
        numeric > 0
          ? numeric
          : 10;

      return String(
        start +
        ordinal +
        attempt
      );
    };

  const referencedText = (
    el,
    attrName
  ) => {
    const ids =
      String(
        el.getAttribute?.(
          attrName
        ) || ''
      )
        .split(/\s+/)
        .filter(Boolean);

    const doc =
      el.ownerDocument;

    const parts = [];

    for (const id of ids) {
      try {
        const node =
          doc.getElementById(id);

        if (node) {
          const text =
            cleanStructuralText(
              node
            ) ||
            String(
              node.innerText ||
              node.textContent ||
              ''
            );

          if (text) {
            parts.push(text);
          }
        }
      } catch {}
    }

    return parts.join(' ');
  };

  const autocompleteTokens = el =>
    normalize(
      el.getAttribute?.(
        'autocomplete'
      ) || ''
    )
      .split(/\s+/)
      .filter(Boolean);

  const accessibleLabelContext =
    el =>
      [
        el.getAttribute?.(
          'aria-label'
        ),
        referencedText(
          el,
          'aria-labelledby'
        )
      ]
        .filter(Boolean)
        .join(' ');

  const accessibleDescriptionContext =
    el =>
      [
        referencedText(
          el,
          'aria-describedby'
        ),
        referencedText(
          el,
          'aria-errormessage'
        )
      ]
        .filter(Boolean)
        .join(' ');

  const accessibleFieldContext =
    el =>
      [
        accessibleLabelContext(el),
        accessibleDescriptionContext(el),
        el.getAttribute?.(
          'autocomplete'
        ),
        el.getAttribute?.(
          'role'
        )
      ]
        .filter(Boolean)
        .join(' ');

  const technicalFieldContext =
    el =>
      [
        el.getAttribute?.('name'),
        el.getAttribute?.('id'),
        el.getAttribute?.(
          'data-name'
        ),
        el.getAttribute?.(
          'data-field'
        ),
        el.getAttribute?.(
          'data-key'
        )
      ]
        .filter(Boolean)
        .join(' ');

  const fieldContainerFor = el =>
    el.closest(
      '.form-group,.form-field,.field,.form-item,.control-group,.mb-3,.field-wrapper,.form-control-wrap,.form-row,.question,.question-wrapper,.input-wrapper'
    );

  const explicitLabelContext = el => {
    const doc =
      el.ownerDocument;

    const parts = [];

    if (el.id) {
      try {
        const label =
          doc.querySelector(
            `label[for="${cssEscape(doc, el.id)}"]`
          );

        if (label) {
          parts.push(
            cleanStructuralText(
              label
            )
          );
        }
      } catch {}
    }

    const ariaLabel =
      accessibleLabelContext(el);

    if (ariaLabel) {
      parts.push(
        ariaLabel
      );
    }

    const parentLabel =
      el.closest('label');

    if (parentLabel) {
      // For radio/checkbox options, this is the option label, not the group question.
      parts.push(
        cleanStructuralText(
          parentLabel
        )
      );
    }

    const cell =
      el.closest('td,th');

    if (cell) {
      try {
        cell
          .querySelectorAll(
            ':scope > label,:scope > .label,:scope > .field-label,:scope > .control-label,:scope > .form-label'
          )
          .forEach(label => {
            const text =
              cleanStructuralText(
                label
              );

            if (text) {
              parts.push(text);
            }
          });
      } catch {}
    }

    const container =
      fieldContainerFor(el);

    if (container) {
      try {
        container
          .querySelectorAll(
            ':scope > label,:scope > .label,:scope > .field-label,:scope > .control-label,:scope > .form-label'
          )
          .forEach(label => {
            const text =
              cleanStructuralText(
                label
              );

            if (text) {
              parts.push(text);
            }
          });
      } catch {}
    }

    const prev =
      el.previousElementSibling;

    if (
      prev &&
      !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/i.test(
        prev.tagName
      )
    ) {
      const text =
        cleanStructuralText(prev);

      if (
        text &&
        text.length <= 180
      ) {
        parts.push(text);
      }
    }

    return [
      ...new Set(
        parts
          .filter(Boolean)
          .map(text =>
            String(text)
              .replace(/\s+/g, ' ')
              .trim()
          )
      )
    ].join(' ');
  };

  const radioGroupMembers = el => {
    if (
      !el ||
      el.type !== 'radio'
    ) {
      return [];
    }

    const doc =
      el.ownerDocument;

    const name =
      el.name;

    if (!name) {
      return [el];
    }

    let selector = '';

    try {
      selector =
        `input[type="radio"][name="${cssEscape(doc, name)}"]`;

      return [
        ...doc.querySelectorAll(
          selector
        )
      ].filter(
        item =>
          !item.disabled &&
          isFieldOperationallyVisible(
            item
          )
      );
    } catch {
      return [el];
    }
  };

  const radioGroupRepresentative =
    el => {
      const group =
        radioGroupMembers(el);

      return group[0] || el;
    };

  const questionContext = el => {
    const parts = [];

    const fieldset =
      el.closest('fieldset');

    if (fieldset) {
      try {
        const legend =
          fieldset.querySelector(
            ':scope > legend'
          );

        const text =
          cleanStructuralText(
            legend
          );

        if (text) {
          parts.push(text);
        }
      } catch {}
    }

    const container =
      fieldContainerFor(el);

    if (container) {
      try {
        const labels =
          container.querySelectorAll(
            ':scope > label,:scope > .question-label,:scope > .question-title,:scope > .field-label,:scope > .control-label,:scope > .form-label,:scope > h3,:scope > h4,:scope > h5'
          );

        for (const label of labels) {
          // Do not use a radio option's own <label> as the question label.
          if (
            el.type === 'radio' &&
            label.contains(el)
          ) {
            continue;
          }

          const text =
            cleanStructuralText(
              label
            );

          if (
            text &&
            text.length <= 260
          ) {
            parts.push(text);
          }
        }
      } catch {}
    }

    if (
      el.type === 'radio' &&
      el.name
    ) {
      const members =
        radioGroupMembers(el);

      if (members.length) {
        let common =
          members[0]
            .parentElement;

        while (
          common &&
          !members.every(
            member =>
              common.contains(
                member
              )
          )
        ) {
          common =
            common.parentElement;
        }

        if (
          common &&
          common !==
            el.ownerDocument.body
        ) {
          try {
            const heading =
              common.querySelector(
                ':scope > legend,:scope > .question-label,:scope > .question-title,:scope > .field-label,:scope > .control-label,:scope > h3,:scope > h4,:scope > h5'
              );

            const text =
              cleanStructuralText(
                heading
              );

            if (
              text &&
              text.length <= 260
            ) {
              parts.push(text);
            }
          } catch {}
        }
      }
    }

    return [
      ...new Set(
        parts.filter(Boolean)
      )
    ].join(' ');
  };

  const sectionContext = el => {
    const parts = [];

    let node = el;

    for (
      let depth = 0;
      depth < 8 &&
      node;
      depth++,
      node =
        node.parentElement
    ) {
      if (
        !node.querySelectorAll
      ) {
        continue;
      }

      try {
        const heading =
          node.querySelector(
            ':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6,:scope > legend,:scope > .panel-heading,:scope > .panel-title,:scope > .section-title,:scope > .card-title,:scope > .accordion-title,:scope > .heading,:scope > .section-heading'
          );

        const text =
          cleanStructuralText(
            heading
          );

        if (
          text &&
          text.length <= 260
        ) {
          parts.push(text);
        }
      } catch {}

      const prev =
        node.previousElementSibling;

      if (
        prev &&
        /^(H1|H2|H3|H4|H5|H6|LEGEND)$/i.test(
          prev.tagName
        )
      ) {
        const text =
          cleanStructuralText(
            prev
          );

        if (
          text &&
          text.length <= 260
        ) {
          parts.push(text);
        }
      }
    }

    return [
      ...new Set(
        parts.filter(Boolean)
      )
    ].join(' ');
  };

  const formHeadingContext = el => {
    const doc =
      el.ownerDocument;

    const form =
      el.closest('form') ||
      doc.querySelector('form');

    const parts = [];

    const roots =
      [
        form,
        doc.querySelector(
          'main'
        ),
        doc.body
      ].filter(Boolean);

    for (const root of roots) {
      try {
        const heading =
          root.querySelector(
            'h1,h2,.page-title,.form-title,.main-title'
          );

        const text =
          cleanStructuralText(
            heading
          );

        if (
          text &&
          text.length <= 260
        ) {
          parts.push(text);
          break;
        }
      } catch {}
    }

    return parts.join(' ');
  };

  const directFieldContext =
    el =>
      [
        explicitLabelContext(el),
        questionContext(el),
        el.getAttribute?.(
          'placeholder'
        ),
        el.getAttribute?.(
          'title'
        ),
        el.getAttribute?.(
          'data-label'
        )
      ]
        .filter(Boolean)
        .join(' ');

  const rawFieldContext = el =>
    [
      explicitLabelContext(el),
      questionContext(el),
      accessibleLabelContext(el),
      el.getAttribute?.(
        'placeholder'
      ),
      tableHeaderContext(el),
      technicalFieldContext(el),
      sectionContext(el),
      formHeadingContext(el)
    ]
      .filter(Boolean)
      .join(' ');

  const fieldContext =
    el =>
      normalize(
        rawFieldContext(el)
      );

  const directContext =
    el =>
      normalize(
        explicitLabelContext(el)
      );

  const columnContext =
    el =>
      normalize(
        tableHeaderContext(el)
      );

  const questionFieldContext =
    el =>
      normalize(
        questionContext(el)
      );

  const isLikelyInternalField =
    el => {
      const human =
        normalize(
          [
            explicitLabelContext(el),
            questionContext(el),
            tableHeaderContext(el)
          ].join(' ')
        );

      return /for office use only|internal use only|system use only|hidden field|do not fill|do not enter|administrative use only|backend only/.test(
        human
      );
    };


  const isRequired = el => {
    if (!el) return false;

    if (
      el.type === 'radio'
    ) {
      const group =
        radioGroupMembers(el);

      if (
        group.some(
          item =>
            item.required ||
            item.getAttribute(
              'aria-required'
            ) === 'true'
        )
      ) {
        return true;
      }

      const question =
        questionContext(el);

      if (/\*/.test(question)) {
        return true;
      }
    }

    if (
      el.required ||
      el.getAttribute(
        'aria-required'
      ) === 'true'
    ) {
      return true;
    }

    const direct =
      explicitLabelContext(el);

    const question =
      questionContext(el);

    const column =
      tableHeaderContext(el);

    if (
      /\*/.test(
        `${direct} ${question} ${column}`
      )
    ) {
      return true;
    }

    const container =
      fieldContainerFor(el);

    if (
      container &&
      (
        container.classList.contains(
          'required'
        ) ||
        container.querySelector(
          ':scope > .required,:scope > [aria-required="true"]'
        )
      )
    ) {
      return true;
    }

    return false;
  };


  const isPersonNameField = el => {
    const key = fieldContext(el);

    if (!/\bname\b|firstname|lastname|surname|given name|family name/.test(key)) {
      return false;
    }

    if (
      /school|college|university|institute|institution|organization|organisation|company|employer|board|course|program|programme|branch name|bank name|username|user name/.test(key)
    ) {
      return false;
    }

    return true;
  };

  const isSensitive = key => /\b(passport number|passport no|ssn|social security|bank account|account number|credit card|debit card|card number|cvv|ifsc|upi|voter id|tax id|password|otp|captcha)\b/i.test(key);

  const isManualRequiredField = el => {
    const key = fieldContext(el);
    return el.type === 'file' || isSensitive(key);
  };


  const fieldTechnicalSignature = el => {
    const compact = [
      normalize(el.tagName),
      normalize(el.type),
      normalize(el.name),
      normalize(el.id),
      directContext(el),
      columnContext(el),
      normalize(sectionContext(el)).slice(0, 100),
      normalize(el.getAttribute?.('autocomplete')),
      normalize(el.getAttribute?.('role')),
      normalize(el.getAttribute?.('inputmode')),
      String(el.getAttribute?.('pattern') || ''),
      String(el.minLength || ''),
      String(el.maxLength || '')
    ].join('|');

    return `fs_${hash32(compact).toString(36)}`;
  };

  const formTechnicalSignature = () => {
    const forms = [];

    for (const doc of collectDocuments()) {
      for (const form of doc.querySelectorAll('form')) {
        forms.push(
          normalize(
            `${form.getAttribute('action') || ''}|${form.getAttribute('method') || ''}|${form.id || ''}|${form.name || ''}`
          )
        );
      }
    }

    const headings = [...document.querySelectorAll('h1,h2,h3,legend,.panel-heading,.section-title')]
      .slice(0, 25)
      .map(node => normalize(node.innerText || node.textContent))
      .filter(Boolean)
      .join('|');

    const fields = [];
    for (const doc of collectDocuments()) {
      const sample = allFields(doc).slice(0, 80);
      sample.forEach(el => {
        fields.push(
          `${normalize(el.tagName)}:${normalize(el.type)}:${normalize(el.name)}:${normalize(el.getAttribute?.('autocomplete'))}:${directContext(el).slice(0, 50)}`
        );
      });
    }

    const source = [
      location.hostname,
      location.pathname,
      forms.join('~'),
      headings,
      fields.join('~')
    ].join('||');

    return `form_${hash32(source).toString(36)}`;
  };

  const prepareFormTechnicalCache = () => {
    state.techCache ||= loadTechCache();
    state.currentFormSignature = formTechnicalSignature();

    const forms = state.techCache.forms;

    if (!forms[state.currentFormSignature]) {
      forms[state.currentFormSignature] = {
        createdAt: Date.now(),
        lastUsed: Date.now(),
        fields: {}
      };
    }

    forms[state.currentFormSignature].lastUsed = Date.now();
    state.currentFormCache = forms[state.currentFormSignature];

    return state.currentFormCache;
  };

  const cachedFieldTechnical = el => {
    const formCache = state.currentFormCache || prepareFormTechnicalCache();
    return formCache?.fields?.[fieldTechnicalSignature(el)] || null;
  };

  const writeFieldTechnicalCache = (el, analysis) => {
    const formCache = state.currentFormCache || prepareFormTechnicalCache();
    if (!formCache) return;

    const sig = fieldTechnicalSignature(el);
    const learned = runtimeConstraintFor(el);

    formCache.fields[sig] = {
      semantic: analysis.semantic,
      confidence: analysis.confidence,
      risk: analysis.risk,
      adapter: analysis.adapter,
      constraints: {
        numeric: !!analysis.constraints.numeric,
        alpha: !!analysis.constraints.alpha,
        email: !!analysis.constraints.email,
        dateLike: !!analysis.constraints.dateLike,
        minLength: analysis.constraints.minLength,
        maxLength: analysis.constraints.maxLength,
        min: analysis.constraints.min,
        max: analysis.constraints.max,
        exactLength: learned.exactLength || null,
        uniqueMobile: !!learned.uniqueMobile,
        uniqueEmail: !!learned.uniqueEmail
      },
      updatedAt: Date.now()
    };
  };

  const fieldKey = el => {
    if (el.getAttribute(FIELD_KEY_ATTR)) {
      return el.getAttribute(FIELD_KEY_ATTR);
    }

    const type = normalize(el.type);
    const stable =
      (el.id && `id:${el.id}`) ||
      (el.name && `name:${el.name}|type:${type}`) ||
      (
        columnContext(el) &&
        `column:${columnContext(el)}|section:${normalize(sectionContext(el)).slice(0,80)}`
      ) ||
      `context:${directContext(el).slice(0,120)}`;

    let hash = 2166136261;

    for (let i = 0; i < stable.length; i++) {
      hash ^= stable.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    const key = `f${(hash >>> 0).toString(36)}`;

    try {
      el.setAttribute(FIELD_KEY_ATTR, key);
    } catch {}

    return key;
  };

  const visualTarget = el => {
    if (!el) return el;

    if (
      el.tagName === 'SELECT' &&
      el.classList.contains('chosen-select')
    ) {
      const next = el.nextElementSibling;

      if (
        next?.classList?.contains(
          'chosen-container'
        )
      ) {
        return next;
      }

      const nearby =
        el.parentElement?.querySelector(
          '.chosen-container'
        );

      if (nearby) return nearby;
    }

    if (
      el.tagName === 'SELECT' &&
      el.classList.contains(
        'select2-hidden-accessible'
      )
    ) {
      const next = el.nextElementSibling;

      if (
        next?.classList?.contains(
          'select2'
        ) ||
        next?.querySelector?.(
          '.select2-selection'
        )
      ) {
        return next;
      }

      const nearby =
        el.parentElement?.querySelector(
          '.select2-container'
        );

      if (nearby) return nearby;
    }

    return el;
  };


  const isFieldOperationallyVisible = el => {
    if (!el) return false;
    if (isVisible(el)) return true;

    try {
      const target = visualTarget(el);
      if (
        target &&
        target !== el &&
        isVisible(target)
      ) {
        return true;
      }
    } catch {}

    return false;
  };

  const clearMark = (el, attr) => {
    const target = visualTarget(el);
    if (!target) return;

    target.removeAttribute(attr);

    if (
      !target.hasAttribute(REVIEW_ATTR) &&
      !target.hasAttribute(ERROR_ATTR) &&
      !target.hasAttribute(MANUAL_ATTR)
    ) {
      target.style.outline = target.dataset.stffOldOutline || '';
      target.style.outlineOffset = target.dataset.stffOldOutlineOffset || '';
      delete target.dataset.stffOldOutline;
      delete target.dataset.stffOldOutlineOffset;
    }
  };

  const mark = (el, type, reason) => {
    const target = visualTarget(el);
    if (!target) return;

    if (!target.dataset.stffOldOutline) {
      target.dataset.stffOldOutline = target.style.outline || '';
    }

    if (!target.dataset.stffOldOutlineOffset) {
      target.dataset.stffOldOutlineOffset = target.style.outlineOffset || '';
    }

    const key = fieldKey(el);

    if (type === 'review') {
      target.setAttribute(REVIEW_ATTR, reason || 'Review');
      state.stats.review.add(key);

      if (
        !target.hasAttribute(ERROR_ATTR) &&
        !target.hasAttribute(MANUAL_ATTR)
      ) {
        target.style.outline = '2px solid #f59e0b';
      }
    } else if (type === 'manual') {
      target.setAttribute(MANUAL_ATTR, reason || 'Manual action required');
      state.stats.manual.add(key);
      state.stats.errors.delete(key);
      target.removeAttribute(ERROR_ATTR);
      target.style.outline = '2px solid #8b5cf6';
    } else {
      target.setAttribute(ERROR_ATTR, reason || 'Error');
      state.stats.errors.add(key);
      state.stats.manual.delete(key);
      target.removeAttribute(MANUAL_ATTR);
      target.style.outline = '2px solid #ef4444';
    }

    target.style.outlineOffset = '2px';
  };

  const resetMarks = () => {
    collectDocuments().forEach(doc => {
      doc
        .querySelectorAll(`[${REVIEW_ATTR}],[${ERROR_ATTR}],[${MANUAL_ATTR}],[${FILLED_ATTR}],[${PRESERVED_ATTR}]`)
        .forEach(target => {
          target.style.outline = target.dataset.stffOldOutline || '';
          target.style.outlineOffset = target.dataset.stffOldOutlineOffset || '';
          target.removeAttribute(REVIEW_ATTR);
          target.removeAttribute(ERROR_ATTR);
          target.removeAttribute(MANUAL_ATTR);
          target.removeAttribute(FILLED_ATTR);
          target.removeAttribute(PRESERVED_ATTR);
          delete target.dataset.stffOldOutline;
          delete target.dataset.stffOldOutlineOffset;
        });
    });

    state.stats.review.clear();
    state.stats.errors.clear();
    state.stats.manual.clear();
  };

  const eventBurst = el => {
    ['input','change','keyup','blur'].forEach(type => {
      try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch {}
    });
  };

  const currentState = el => {
    if (el.type === 'checkbox' || el.type === 'radio') return { kind: 'checked', value: !!el.checked };
    if (el.isContentEditable) return { kind: 'text', value: el.textContent || '' };
    return { kind: 'value', value: el.value ?? '' };
  };

  const sameState = (a, b) => !!a && !!b && a.kind === b.kind && a.value === b.value;

  const snapshotBeforeChange = el => {
    const key = fieldKey(el);
    if (state.snapshots.has(key)) return;
    state.snapshots.set(key, { before: currentState(el), element: el });
  };

  const rememberAfterChange = el => {
    const key = fieldKey(el);
    state.lastScriptValues.set(key, currentState(el));
    state.stats.filled.add(key);
    state.stats.preserved.delete(key);

    const target = visualTarget(el);
    if (target) {
      target.setAttribute(FILLED_ATTR, 'true');
      target.removeAttribute(PRESERVED_ATTR);
    }
  };

  const setNativeValue = (el, value) => {
    snapshotBeforeChange(el);
    const wasReadonly = el.readOnly;
    try { el.readOnly = false; el.removeAttribute('readonly'); } catch {}
    try {
      const win = el.ownerDocument.defaultView;
      const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor?.set) descriptor.set.call(el, String(value));
      else el.value = String(value);
    } catch { el.value = String(value); }
    eventBurst(el);
    if (wasReadonly) {
      try { el.readOnly = true; el.setAttribute('readonly','readonly'); } catch {}
    }
    rememberAfterChange(el);
  };

  const setContentEditable = (el, value) => {
    snapshotBeforeChange(el);
    el.textContent = String(value);
    eventBurst(el);
    rememberAfterChange(el);
  };

  const triggerSelect = select => {
    const win = select.ownerDocument.defaultView;
    const adapter = detectControlAdapter(select);

    try {
      select.dispatchEvent(
        new Event('change', {
          bubbles: true
        })
      );
    } catch {}

    try {
      const jq = win.jQuery || win.$;

      if (typeof jq !== 'function') {
        return;
      }

      const $select = jq(select);

      if (adapter === 'chosen') {
        // Update Chosen's visual layer once, without firing unrelated plugin events.
        $select.trigger('chosen:updated');
      } else if (adapter === 'select2') {
        // Scoped Select2 UI update; native change above already notified the form.
        $select.trigger('change.select2');
      }
    } catch {}
  };

  const setSelect = (
    select,
    option,
    lowConfidence = false
  ) => {
    snapshotBeforeChange(select);
    select.disabled = false;

    if (select.multiple) {
      [...select.options].forEach(item => {
        item.selected = false;
      });

      option.selected = true;
    } else {
      select.value = option.value;
    }

    triggerSelect(select);
    rememberAfterChange(select);

    if (lowConfidence) {
      mark(
        select,
        'review',
        'Dropdown filled with low confidence'
      );
    } else {
      clearMark(select, REVIEW_ATTR);
    }
  };

  const setChecked = (el, checked, lowConfidence = false) => {
    snapshotBeforeChange(el);
    el.disabled = false;

    const desired =
      !!checked;

    let committed =
      false;

    // Prefer a real browser click. Many admission forms attach business
    // logic specifically to click handlers rather than only change/input.
    try {
      if (
        el.type === 'radio' &&
        desired
      ) {
        el.click();
        committed = true;
      } else if (
        el.type === 'checkbox' &&
        el.checked !== desired
      ) {
        el.click();
        committed = true;
      }
    } catch {}

    if (
      el.checked !== desired
    ) {
      el.checked = desired;
      eventBurst(el);
    } else if (!committed) {
      eventBurst(el);
    }

    rememberAfterChange(el);

    if (lowConfidence) {
      mark(
        el,
        'review',
        'Selection filled with low confidence'
      );
    } else {
      clearMark(
        el,
        REVIEW_ATTR
      );
    }
  };

  const radioGroupCommitKey = el =>
    `${location.hostname}|${state.currentFormSignature || ''}|${el.name || fieldKey(el)}`;

  const commitSelectedRadioGroups =
    async ({
      force = false,
      maxGroups = 24
    } = {}) => {
      let committed = 0;
      const seen =
        new Set();

      for (const doc of collectDocuments()) {
        const radios =
          [
            ...doc.querySelectorAll(
              'input[type="radio"]:checked'
            )
          ];

        for (const radio of radios) {
          if (
            committed >= maxGroups ||
            !isFieldOperationallyVisible(
              radio
            ) ||
            radio.disabled ||
            isLikelyInternalField(
              radio
            )
          ) {
            continue;
          }

          const groupKey =
            radioGroupCommitKey(
              radio
            );

          if (
            seen.has(groupKey)
          ) {
            continue;
          }

          seen.add(groupKey);

          if (
            !force &&
            state.committedRadioGroups.has(
              groupKey
            )
          ) {
            continue;
          }

          snapshotBeforeChange(
            radio
          );

          try {
            // Clicking an already-selected radio does not toggle it off,
            // but does execute site click handlers and dependent-state logic.
            radio.click();
          } catch {
            eventBurst(radio);
          }

          rememberAfterChange(
            radio
          );

          state.committedRadioGroups.add(
            groupKey
          );

          debugEvent(
            'radio-commit',
            {
              name:
                radio.name || '',
              value:
                String(
                  radio.value || ''
                ),
              forced:
                !!force
            }
          );

          committed++;

          // Small cooperative pause lets synchronous/short async handlers
          // materialize dependent controls without making the run slow.
          await sleep(25);
        }
      }

      return committed;
    };


  const dateParts = iso => {
    const [y,m,d] = iso.split('-');
    return { y, m, d };
  };

  const formattedDateForField = (el, iso) => {
    const { y, m, d } = dateParts(iso);
    const key = fieldContext(el);
    const hint = normalize([
      el.placeholder,
      el.getAttribute('data-placeholder'),
      el.getAttribute('data-format'),
      el.getAttribute('data-date-format'),
      el.getAttribute('data-datetime-format'),
      el.getAttribute('title')
    ].filter(Boolean).join(' '));
    const type = normalize(el.type);
    const yearOnly = /\byear\b/.test(key) && !/date of birth|birth date|dob/.test(key);
    if (yearOnly) return y;
    if (type === 'date') return iso;
    if (type === 'datetime-local') return `${iso}T10:00`;
    if (hint.includes('mm/dd/yyyy')) return `${m}/${d}/${y}`;
    if (hint.includes('yyyy-mm-dd')) return iso;
    if (hint.includes('dd-mm-yyyy')) return `${d}-${m}-${y}`;
    if (/date.?time|datetime|hh:mm|hh mm|time/.test(hint) && !/dd\/mm\/yyyy$/.test(hint)) return `${d}/${m}/${y} 10:00`;
    return `${d}/${m}/${y}`;
  };

  const isYearOnlyField = el => {
    const key = fieldContext(el);

    return (
      /\byear\b|year of passing|passing year|pass year/.test(key) &&
      !/date of birth|birth date|\bdob\b|date of passing|passing date/.test(key)
    );
  };

  const syncExistingDateWidget = (
    el,
    iso
  ) => {
    const win = el.ownerDocument.defaultView;
    const { y } = dateParts(iso);
    const dateObj =
      new Date(`${iso}T12:00:00`);

    try {
      if (el._flatpickr) {
        el._flatpickr.setDate(
          dateObj,
          true
        );
      }
    } catch {}

    try {
      if (el._pikaday?.setDate) {
        el._pikaday.setDate(dateObj);
      }
    } catch {}

    try {
      if (
        el.airDatepicker?.selectDate
      ) {
        el.airDatepicker.selectDate(
          dateObj
        );
      }
    } catch {}

    try {
      if (win.M?.Datepicker) {
        const instance =
          win.M.Datepicker.getInstance(el);

        if (instance) {
          instance.setDate(dateObj);
          instance.setInputValue();
        }
      }
    } catch {}

    try {
      const jq = win.jQuery || win.$;

      if (typeof jq !== 'function') {
        return;
      }

      const $el = jq(el);

      // Important:
      // only call a plugin API when the page has ALREADY initialized it.
      // Calling $.fn.datepicker() on an arbitrary field would create a new
      // picker and was the cause of phantom/bottom calendars in V10.
      const datepickerData =
        $el.data('datepicker');

      const datetimeData =
        $el.data('DateTimePicker') ||
        $el.data('datetimepicker');

      const yearpickerData =
        $el.data('yearpicker');

      try {
        if (
          datepickerData &&
          typeof datepickerData.setDate ===
            'function'
        ) {
          datepickerData.setDate(dateObj);
        } else if (
          $el.hasClass('hasDatepicker') &&
          typeof $el.datepicker ===
            'function'
        ) {
          $el.datepicker(
            'setDate',
            dateObj
          );
        }
      } catch {}

      try {
        if (datetimeData?.date) {
          const value =
            typeof win.moment ===
            'function'
              ? win.moment(dateObj)
              : dateObj;

          datetimeData.date(value);
        } else if (
          datetimeData?.setDate
        ) {
          datetimeData.setDate(
            dateObj
          );
        }
      } catch {}

      try {
        if (
          yearpickerData?.setYear
        ) {
          yearpickerData.setYear(
            Number(y)
          );
        }
      } catch {}
    } catch {}
  };

  const closeDateWidgets = el => {
    if (!el) return;

    const doc = el.ownerDocument;
    const win = doc.defaultView;

    try {
      el._flatpickr?.close?.();
    } catch {}

    try {
      el._pikaday?.hide?.();
    } catch {}

    try {
      el.airDatepicker?.hide?.();
    } catch {}

    try {
      if (win.M?.Datepicker) {
        win.M.Datepicker
          .getInstance(el)
          ?.close?.();
      }
    } catch {}

    try {
      const jq = win.jQuery || win.$;

      if (typeof jq === 'function') {
        const $el = jq(el);

        const datepickerData =
          $el.data('datepicker');

        const datetimeData =
          $el.data('DateTimePicker') ||
          $el.data('datetimepicker');

        try {
          datepickerData?.hide?.();
        } catch {}

        try {
          datetimeData?.hide?.();
        } catch {}
      }
    } catch {}

    try {
      el.blur();
    } catch {}

    try {
      doc.dispatchEvent(
        new KeyboardEvent(
          'keydown',
          {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true
          }
        )
      );
    } catch {}
  };

  const closeAllDateWidgets = () => {
    for (const doc of collectDocuments()) {
      for (const el of allFields(doc)) {
        if (
          isDateLikeField?.(el) ||
          /date|year|yyyy|dd\/mm|mm\/dd/.test(
            fieldContext(el)
          )
        ) {
          try {
            closeDateWidgets(el);
          } catch {}
        }
      }

      try {
        doc.dispatchEvent(
          new KeyboardEvent(
            'keydown',
            {
              key: 'Escape',
              code: 'Escape',
              keyCode: 27,
              which: 27,
              bubbles: true
            }
          )
        );
      } catch {}
    }
  };

  const cleanupLegacyDateWidgetDamage =
    () => {
      for (const doc of collectDocuments()) {
        let nodes = [];

        try {
          nodes = [
            ...doc.querySelectorAll(
              '.datepicker,.ui-datepicker,.bootstrap-datetimepicker-widget,.flatpickr-calendar,.daterangepicker,.xdsoft_datetimepicker,[class*="datetimepicker"]'
            )
          ];
        } catch {}

        for (const node of nodes) {
          const style = node.style;

          const looksLikeV10ForcedHide =
            style.getPropertyPriority(
              'display'
            ) === 'important' &&
            style.getPropertyPriority(
              'visibility'
            ) === 'important' &&
            style.getPropertyPriority(
              'opacity'
            ) === 'important' &&
            style.getPropertyPriority(
              'pointer-events'
            ) === 'important';

          if (
            looksLikeV10ForcedHide
          ) {
            style.removeProperty(
              'display'
            );
            style.removeProperty(
              'visibility'
            );
            style.removeProperty(
              'opacity'
            );
            style.removeProperty(
              'pointer-events'
            );

            if (
              node.getAttribute(
                'aria-hidden'
              ) === 'true'
            ) {
              node.removeAttribute(
                'aria-hidden'
              );
            }
          }
        }
      }
    };

  const setSmartDate = (
    el,
    iso
  ) => {
    if (!el || !iso) return;

    const formatted =
      isYearOnlyField(el)
        ? dateParts(iso).y
        : formattedDateForField(
            el,
            iso
          );

    // One controlled write only.
    // Do not leave delayed timers that can overwrite a user's later manual edit.
    setNativeValue(
      el,
      formatted
    );

    syncExistingDateWidget(
      el,
      iso
    );

    setTimeout(() => {
      if (!state.running) {
        return;
      }

      try {
        if (
          !String(
            el.value || ''
          ).trim()
        ) {
          setNativeValue(
            el,
            formatted
          );
        }

        closeDateWidgets(el);
      } catch {}
    }, 90);
  };


  const academicLevelFromRowLabel =
    value => {
      const raw =
        normalize(value)
          .replace(
            /[*:|()[\]{}]/g,
            ' '
          )
          .replace(
            /\s+/g,
            ' '
          )
          .trim();

      if (!raw) {
        return null;
      }

      // Common Indian-school notations used in table row headers.
      if (
        /^(?:class|std|standard)?\s*(?:xii|12|12th|12 th)$/.test(
          raw
        ) ||
        /^(?:hsc|higher secondary|senior secondary|intermediate|puc ?2|2nd puc)$/.test(
          raw
        )
      ) {
        return 'class12';
      }

      if (
        /^(?:class|std|standard)?\s*(?:x|10|10th|10 th)$/.test(
          raw
        ) ||
        /^(?:ssc|sslc|matric|matriculation)$/.test(
          raw
        )
      ) {
        return 'class10';
      }

      if (
        /^(?:ug|under ?graduate|under graduation|graduation|bachelor'?s?|degree)$/.test(
          raw
        )
      ) {
        return 'ug';
      }

      if (
        /^(?:pg|post ?graduate|post graduation|postgraduate|master'?s?|pgdm|post graduate diploma)$/.test(
          raw
        )
      ) {
        return 'pg';
      }

      return null;
    };

  const academicLevel = key => {
    const text =
      normalize(key);

    // Specific/higher levels first so "senior secondary" is not mistaken
    // for generic "secondary".
    if (
      /post graduation|postgraduate|post graduate diploma|\bpgdm\b|\bpg\b|master'?s?|mba|m\.?tech|mtech|mca|m\.?sc|m\.?a\b|m\.?com/.test(
        text
      )
    ) {
      return 'pg';
    }

    if (
      /graduation|under ?graduate|\bug\b|bachelor'?s?|b\.?tech|btech|b\.?e\b|bba|bca|b\.?sc|b\.?a\b|b\.?com|degree/.test(
        text
      )
    ) {
      return 'ug';
    }

    if (
      /class\s*xii\b|(?:^|\s)xii(?:\s|$)|12th|12 th|hsc|senior secondary|higher secondary|intermediate|puc ?2|2nd puc/.test(
        text
      )
    ) {
      return 'class12';
    }

    if (
      /class\s*x\b|(?:^|\s)x(?:\s|$)|10th|10 th|ssc|sslc|matric|matriculation|\bsecondary\b/.test(
        text
      )
    ) {
      return 'class10';
    }

    return null;
  };

  const academicHeadingPattern =
    /10th|10 th|class x\b|(?:^|\s)x(?:\s|$)|12th|12 th|class xii|(?:^|\s)xii(?:\s|$)|qualification details|academic details|under ?graduation|graduation details|post ?graduation|postgraduate|pgdm|bachelor|master|secondary|intermediate/;

  const nearestAcademicHeadingContext =
    el => {
      if (!el) return '';

      const candidates = [];

      const pushIfAcademic =
        node => {
          if (!node) return;

          const text =
            cleanStructuralText(
              node
            );

          if (
            text &&
            text.length <= 260 &&
            academicHeadingPattern.test(
              normalize(text)
            )
          ) {
            candidates.push(text);
          }
        };

      const table =
        el.closest('table');

      if (table) {
        try {
          pushIfAcademic(
            table.querySelector(
              ':scope > caption'
            )
          );
        } catch {}

        let sibling =
          table.previousElementSibling;

        for (
          let i = 0;
          sibling &&
          i < 8;
          i++,
          sibling =
            sibling.previousElementSibling
        ) {
          pushIfAcademic(sibling);

          try {
            const heading =
              sibling.querySelector?.(
                'h1,h2,h3,h4,h5,h6,legend,.section-title,.section-heading,.heading,.title,strong,b'
              );

            pushIfAcademic(
              heading
            );
          } catch {}

          if (candidates.length) {
            break;
          }
        }
      }

      let node =
        table ||
        fieldContainerFor(el) ||
        el;

      for (
        let depth = 0;
        node &&
        depth < 7;
        depth++,
        node =
          node.parentElement
      ) {
        let sibling =
          node.previousElementSibling;

        for (
          let i = 0;
          sibling &&
          i < 5;
          i++,
          sibling =
            sibling.previousElementSibling
        ) {
          if (
            /^(H1|H2|H3|H4|H5|H6|LEGEND)$/i.test(
              sibling.tagName
            )
          ) {
            pushIfAcademic(
              sibling
            );
          } else {
            try {
              pushIfAcademic(
                sibling.querySelector?.(
                  ':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6,:scope > legend,:scope > .section-title,:scope > .section-heading,:scope > .heading,:scope > .title'
                )
              );
            } catch {}
          }

          if (candidates.length) {
            break;
          }
        }

        if (candidates.length) {
          break;
        }
      }

      return (
        candidates[0] || ''
      );
    };

  const academicLevelForField =
    el => {
      if (!el) return null;

      // Table row identity is the strongest signal for academic matrices:
      // X, XII, 10th, 12th, UG, PG, SSC, HSC, etc.
      const rowLevel =
        academicLevelFromRowLabel(
          tableRowLabelContext(
            el
          )
        );

      if (rowLevel) {
        return rowLevel;
      }

      // Next use the nearest qualification/table heading.
      const heading =
        academicLevel(
          nearestAcademicHeadingContext(
            el
          )
        );

      if (heading) {
        return heading;
      }

      const localSignals = [
        explicitLabelContext(el),
        questionContext(el),
        tableHeaderContext(el),
        technicalFieldContext(el)
      ];

      for (
        const signal
        of localSignals
      ) {
        const level =
          academicLevel(
            signal
          );

        if (level) {
          return level;
        }
      }

      // Section is only a final fallback. Form heading is deliberately not
      // used here because an UG/PG application can contain school-level rows.
      return academicLevel(
        sectionContext(el)
      );
    };

  const inferApplicationYear =
    () => {
      const texts = [
        document.title || ''
      ];

      try {
        document
          .querySelectorAll(
            'h1,h2,.page-title,.form-title,.main-title'
          )
          .forEach(
            node => {
              if (
                texts.length < 12
              ) {
                texts.push(
                  cleanStructuralText(
                    node
                  )
                );
              }
            }
          );
      } catch {}

      const combined =
        texts.join(' ');

      const years =
        [
          ...combined.matchAll(
            /\b(20\d{2})\b/g
          )
        ]
          .map(
            match =>
              Number(
                match[1]
              )
          )
          .filter(
            year =>
              year >= 2000 &&
              year <=
                new Date()
                  .getFullYear() +
                  6
          );

      return (
        years[0] ||
        new Date()
          .getFullYear()
      );
    };

  const inferApplicationTargetLevel =
    () => {
      const text =
        normalize(
          [
            document.title || '',
            ...[
              ...document.querySelectorAll(
                'h1,h2,.page-title,.form-title,.main-title'
              )
            ]
              .slice(0, 10)
              .map(
                node =>
                  cleanStructuralText(
                    node
                  )
              )
          ].join(' ')
        );

      if (
        /\bph\.?d\b|doctoral|doctorate/.test(
          text
        )
      ) {
        return 'phd';
      }

      if (
        /post ?graduate|postgraduate|post graduate diploma|\bpgdm\b|\bpg\b|master'?s?/.test(
          text
        )
      ) {
        return 'pg';
      }

      if (
        /under ?graduate|undergraduate|\bug\b|bachelor'?s?/.test(
          text
        )
      ) {
        return 'ug';
      }

      return null;
    };

  const selectedUGDurationYears =
    () => {
      let qualification =
        '';

      for (const doc of collectDocuments()) {
        for (const el of allFields(doc)) {
          if (
            academicLevelForField(
              el
            ) !== 'ug'
          ) {
            continue;
          }

          const context =
            normalize(
              `${explicitLabelContext(el)} ${questionContext(el)} ${columnContext(el)}`
            );

          if (
            !/degree|qualification|course/.test(
              context
            )
          ) {
            continue;
          }

          if (
            el.tagName === 'SELECT'
          ) {
            qualification =
              normalize(
                el.selectedOptions?.[0]
                  ?.textContent ||
                el.value ||
                ''
              );
          } else {
            qualification =
              normalize(
                el.value || ''
              );
          }

          if (
            qualification &&
            !/select|choose/.test(
              qualification
            )
          ) {
            break;
          }
        }

        if (qualification) {
          break;
        }
      }

      if (
        /b\.?arch|architecture/.test(
          qualification
        )
      ) {
        return 5;
      }

      if (
        /mbbs|bds|medicine|medical degree/.test(
          qualification
        )
      ) {
        return 5;
      }

      if (
        /b\.?tech|btech|b\.?e\b|engineering|b\.?pharm|bpharm|b\.?des|bdes/.test(
          qualification
        )
      ) {
        return 4;
      }

      // Current UGC structure supports both 3-year and 4-year UG degrees.
      // Use the minimum generic degree duration when the exact degree is unknown.
      return 3;
    };

  const defaultAcademicGapYears =
    (
      earlierLevel,
      laterLevel
    ) => {
      if (
        earlierLevel === 'class10' &&
        laterLevel === 'class12'
      ) {
        return 2;
      }

      if (
        earlierLevel === 'class12' &&
        laterLevel === 'ug'
      ) {
        return selectedUGDurationYears();
      }

      if (
        earlierLevel === 'ug' &&
        laterLevel === 'pg'
      ) {
        // A 1-year PG is possible after a 4-year UG under the modern framework,
        // but a 2-year spacing remains a conservative generic chronology and
        // is accepted by ordinary minimum-gap validators.
        return 2;
      }

      return 2;
    };


  const academicOrder = [
    'class10',
    'class12',
    'ug',
    'pg'
  ];

  const profileDobYear = () => {
    const match =
      String(
        profile?.dobISO || ''
      ).match(
        /\b(19|20)\d{2}\b/
      );

    return match
      ? Number(match[0])
      : null;
  };

  const baselineAcademicYearFromProfile =
    level => {
      const dobYear =
        profileDobYear();

      const applicationYear =
        inferApplicationYear();

      if (!dobYear) {
        const fallbackOffsets = {
          class10: 6,
          class12: 4,
          ug: 1,
          pg: 0
        };

        return Math.max(
          1990,
          applicationYear -
            (
              fallbackOffsets[
                level
              ] ?? 2
            )
        );
      }

      const year10 =
        dobYear + 16;

      const year12 =
        dobYear + 18;

      const ugEnd =
        year12 +
        selectedUGDurationYears();

      const pgEnd =
        ugEnd + 2;

      const lookup = {
        class10: year10,
        class12: year12,
        ug: ugEnd,
        pg: pgEnd
      };

      return Math.min(
        Number(
          lookup[level] ||
          applicationYear - 2
        ),
        applicationYear
      );
    };

  const academicGapBetweenLevels =
    (
      earlierLevel,
      laterLevel
    ) => {
      const earlierIndex =
        academicOrder.indexOf(
          earlierLevel
        );

      const laterIndex =
        academicOrder.indexOf(
          laterLevel
        );

      if (
        earlierIndex < 0 ||
        laterIndex < 0 ||
        laterIndex <= earlierIndex
      ) {
        return 2;
      }

      let gap = 0;

      for (
        let i = earlierIndex;
        i < laterIndex;
        i++
      ) {
        gap +=
          defaultAcademicGapYears(
            academicOrder[i],
            academicOrder[
              i + 1
            ]
          );
      }

      return Math.max(
        1,
        gap
      );
    };

  const academicAnchorLevel =
    () => {
      const target =
        inferApplicationTargetLevel();

      if (target === 'ug') {
        return 'class12';
      }

      if (target === 'pg') {
        return 'ug';
      }

      if (target === 'phd') {
        return 'pg';
      }

      return null;
    };


  const entityType = key => {
    if (/father/.test(key)) return 'father';
    if (/mother/.test(key)) return 'mother';
    if (/guardian/.test(key)) return 'guardian';
    return 'applicant';
  };

  const optionTextList = el => {
    if (el?.tagName !== 'SELECT') return [];
    return [...el.options]
      .filter(option => !option.disabled)
      .map(option => String(option.text || option.value || '').trim())
      .filter(Boolean);
  };

  const htmlConstraintSignals = el => {
    const pattern = String(el.getAttribute?.('pattern') || '');
    const inputMode = normalize(el.getAttribute?.('inputmode'));
    const type = normalize(el.type);
    const placeholder = normalize(el.placeholder);
    const attrs = normalize([
      el.getAttribute?.('data-type'),
      el.getAttribute?.('data-format'),
      el.getAttribute?.('data-date-format'),
      el.getAttribute?.('data-rule'),
      el.getAttribute?.('data-validation')
    ].filter(Boolean).join(' '));

    return {
      type,
      pattern,
      inputMode,
      placeholder,
      attrs,
      numeric:
        type === 'number' ||
        inputMode === 'numeric' ||
        inputMode === 'decimal' ||
        /\\d|0-9|number|numeric|digit/.test(normalize(pattern)),
      alpha:
        /a-z|alphabet|letters/.test(normalize(pattern)) &&
        !/0-9|\\d/.test(normalize(pattern)),
      email: type === 'email' || /email/.test(attrs),
      dateLike:
        type === 'date' ||
        type === 'datetime-local' ||
        /date|yyyy|dd\/mm|mm\/dd/.test(`${placeholder} ${attrs}`),
      minLength: Number(el.minLength) > 0 ? Number(el.minLength) : null,
      maxLength: Number(el.maxLength) > 0 ? Number(el.maxLength) : null,
      min: el.min !== '' && Number.isFinite(Number(el.min)) ? Number(el.min) : null,
      max: el.max !== '' && Number.isFinite(Number(el.max)) ? Number(el.max) : null
    };
  };


  const autocompleteSemantic = el => {
    const tokens = autocompleteTokens(el);
    const last = tokens[tokens.length - 1] || '';

    const map = {
      'given-name': 'first_name',
      'additional-name': 'middle_name',
      'family-name': 'last_name',
      'name': 'full_name',
      'email': 'email',
      'tel': 'mobile',
      'tel-national': 'mobile',
      'tel-local': 'mobile',
      'tel-area-code': 'mobile',
      'tel-country-code': 'mobile',
      'bday': 'dob',
      'bday-day': 'dob',
      'bday-month': 'dob',
      'bday-year': 'dob',
      'sex': 'gender',
      'street-address': 'address1',
      'address-line1': 'address1',
      'address-line2': 'address2',
      'address-level1': 'state',
      'address-level2': 'city',
      'address-level3': 'district',
      'postal-code': 'pincode',
      'country': 'country',
      'country-name': 'country',
      'organization': 'organization'
    };

    return map[last] || null;
  };

  const detectControlAdapter = el => {
    if (el.tagName === 'SELECT') {
      if (el.classList.contains('chosen-select')) return 'chosen';
      if (el.classList.contains('select2-hidden-accessible')) return 'select2';
      return 'native-select';
    }

    if (el._flatpickr) return 'flatpickr';

    const key = normalize(
      `${el.className || ''} ${el.id || ''} ${el.getAttribute?.('role') || ''}`
    );

    if (/datepicker|date picker|datetimepicker|calendar/.test(key)) {
      return 'datepicker';
    }

    if (el.getAttribute?.('role') === 'combobox') {
      return 'aria-combobox';
    }

    if (el.getAttribute?.('role') === 'spinbutton') {
      return 'aria-spinbutton';
    }

    if (el.isContentEditable) return 'contenteditable';
    return 'native';
  };

  const inferSemantic = el => {
    const label =
      normalize(
        explicitLabelContext(el)
      );

    const question =
      normalize(
        questionContext(el)
      );

    const column =
      columnContext(el);

    const accessible =
      normalize(
        accessibleLabelContext(el)
      );

    const placeholder =
      normalize(
        el.getAttribute?.(
          'placeholder'
        ) || ''
      );

    const attrs =
      normalize(
        technicalFieldContext(el)
      );

    const section =
      normalize(
        sectionContext(el)
      );

    const formHeading =
      normalize(
        formHeadingContext(el)
      );

    const full =
      fieldContext(el);

    const options =
      optionTextList(el);

    const optionText =
      normalize(
        options.join(' | ')
      );

    const constraints =
      htmlConstraintSignals(el);

    const scores =
      new Map();

    const reasons =
      new Map();

    const add = (
      semantic,
      score,
      reason
    ) => {
      scores.set(
        semantic,
        (
          scores.get(
            semantic
          ) || 0
        ) + score
      );

      if (
        !reasons.has(
          semantic
        )
      ) {
        reasons.set(
          semantic,
          []
        );
      }

      reasons
        .get(semantic)
        .push(reason);
    };

    const explicitAutocompleteSemantic =
      autocompleteSemantic(el);

    if (
      explicitAutocompleteSemantic
    ) {
      add(
        explicitAutocompleteSemantic,
        38,
        `autocomplete:${el.getAttribute?.('autocomplete') || ''}`
      );
    }

    const scan = (
      text,
      weight,
      source
    ) => {
      if (!text) return;

      const rules = [
        ['aadhaar', /aadhaar|aadhar/],
        ['pan', /pan card|pan number|\bpan\b/],
        ['first_name', /first name|firstname|given name/],
        ['middle_name', /middle name|middlename/],
        ['last_name', /last name|lastname|surname|family name/],
        ['full_name', /applicant name|candidate name|student name|full name|parent name|father'?s name|mother'?s name|guardian'?s name/],
        ['email', /email|e mail/],
        ['mobile', /mobile|phone|contact number|contact no|telephone|tel no/],
        ['dob', /date of birth|birth date|birthdate|\bdob\b/],
        ['current_date', /declaration date|application date|registration date|current date|today'?s date|date of application/],
        ['passing_year', /year of passing|passing year|pass year|graduation year|completion year/],
        ['passing_date', /passing date|date of passing|completion date/],
        ['percentage', /percentage|percent/],
        ['cgpa', /\bcgpa\b|\bgpa\b/],
        ['max_marks', /maximum marks|max marks|total marks|marks out of/],
        ['obtained_marks', /obtained marks|marks obtained|secured marks/],
        ['school', /school name|\bschool\b/],
        ['institution', /college|university|institute|institution/],
        ['board', /\bboard\b/],
        ['stream', /stream|specialization|specialisation|branch/],
        ['qualification', /qualification|degree|course name/],
        ['marking_scheme', /marking scheme|grading scheme/],
        ['result_status', /result status|result declared|result awaited|awaited result|declared result/],
        ['exam_name', /name of examination|name of exam|exam name|entrance examination name|entrance exam name/],
        ['exam_score', /exam score|score exam|score based on selection|score$/],
        ['rank', /\brank\b/],
        ['roll_number', /entrance roll number|exam roll number|roll no\.?|roll number|registration no\.?|registration number/],
        ['address2', /address line 2|address 2|locality/],
        ['address1', /address line 1|address 1|correspondence address|permanent address|\baddress\b/],
        ['pincode', /pin code|pincode|postal code|zip code|zipcode/],
        ['district', /district/],
        ['city', /\bcity\b|\btown\b/],
        ['state', /\bstate\b|province/],
        ['country', /\bcountry\b/],
        ['place', /\bplace\b|place of/],
        ['nationality', /nationality/],
        ['occupation', /\boccupation\b|\bprofession\b/],
        ['organization', /organization|organisation|company|employer/],
        ['gender', /gender|sex of/],
        ['title', /title|salutation/],
        ['religion', /religion/],
        ['category', /category|caste/],
        ['marital', /marital/],
        ['blood', /blood group|bloodgroup/],
        ['relationship', /relationship|relation with/],
        ['income', /annual income|family income|income range|\bincome\b/],
        ['program', /program|programme|course applied|applying for/],
        ['paragraph', /remarks|comments|description|message|about yourself|statement|reason|purpose|objective/]
      ];

      for (
        const [
          semantic,
          rx
        ] of rules
      ) {
        if (
          rx.test(text)
        ) {
          add(
            semantic,
            weight,
            `${source}:${rx.source}`
          );
        }
      }
    };

    // Human-facing structure dominates.
    scan(label, 34, 'label');
    scan(question, 32, 'question');
    scan(column, 31, 'column');
    scan(accessible, 28, 'aria-label');
    scan(placeholder, 18, 'placeholder');

    // Developer naming is useful but cannot override a clear visible label.
    scan(attrs, 8, 'technical-attribute');

    // Section and form titles are context only.
    scan(section, 4, 'section');
    scan(formHeading, 1, 'form-heading');

    if (options.length) {
      const hasAll =
        values =>
          values.every(
            value =>
              optionText.includes(
                normalize(value)
              )
          );

      const hasAny =
        values =>
          values.some(
            value =>
              optionText.includes(
                normalize(value)
              )
          );

      // Option signatures are supporting evidence, not authority over a clear label.
      if (
        hasAll(
          ['male', 'female']
        )
      ) {
        add(
          'gender',
          10,
          'options:gender-signature'
        );
      }

      if (
        hasAny(
          ['single', 'married']
        ) &&
        hasAny(
          ['divorced', 'widowed', 'unmarried']
        )
      ) {
        add(
          'marital',
          9,
          'options:marital-signature'
        );
      }

      if (
        hasAny(
          ['a+', 'a-', 'b+', 'b-', 'ab+', 'o+']
        ) &&
        options.length <= 12
      ) {
        add(
          'blood',
          8,
          'options:blood-signature'
        );
      }

      if (
        hasAny(
          ['mr', 'mrs', 'ms']
        ) &&
        options.length <= 12
      ) {
        add(
          'title',
          8,
          'options:title-signature'
        );
      }

      if (
        hasAll(
          ['general', 'obc']
        ) &&
        hasAny(
          ['sc', 'st']
        )
      ) {
        add(
          'category',
          10,
          'options:category-signature'
        );
      }

      if (
        hasAny(
          ['hindu', 'hinduism']
        ) &&
        hasAny(
          ['islam', 'christianity', 'christian']
        )
      ) {
        add(
          'religion',
          10,
          'options:religion-signature'
        );
      }

      if (
        hasAny(
          ['percentage']
        ) &&
        hasAny(
          ['cgpa', 'grade']
        )
      ) {
        add(
          'marking_scheme',
          9,
          'options:marking-signature'
        );
      }

      if (
        hasAny(
          ['awaited']
        ) &&
        hasAny(
          ['declared', 'appeared']
        )
      ) {
        add(
          'result_status',
          11,
          'options:result-status-signature'
        );
      }

      if (
        hasAny(
          ['father', 'mother', 'uncle', 'guardian']
        ) &&
        options.length <= 30
      ) {
        add(
          'relationship',
          7,
          'options:relationship-signature'
        );
      }

      if (
        hasAny(
          ['business', 'homemaker', 'student', 'service', 'private']
        ) &&
        options.length <= 80
      ) {
        add(
          'occupation',
          6,
          'options:occupation-signature'
        );
      }

      if (
        hasAny(
          ['cbse', 'icse', 'state board']
        ) &&
        options.length <= 100
      ) {
        add(
          'board',
          8,
          'options:board-signature'
        );
      }

      if (
        hasAll(
          ['yes', 'no']
        ) &&
        scores.size === 0
      ) {
        add(
          'boolean',
          4,
          'options:boolean-signature'
        );
      }
    }

    if (
      constraints.email
    ) {
      add(
        'email',
        25,
        'html:type-email'
      );
    }

    if (
      constraints.dateLike &&
      scores.size === 0
    ) {
      add(
        'date',
        5,
        'html:date-like'
      );
    }

    if (
      normalize(el.type) ===
      'tel'
    ) {
      add(
        'mobile',
        20,
        'html:type-tel'
      );
    }

    if (
      el.tagName ===
        'TEXTAREA' ||
      el.isContentEditable
    ) {
      add(
        'paragraph',
        8,
        'html:long-text'
      );
    }

    const ranked =
      [...scores.entries()]
        .sort(
          (a, b) =>
            b[1] - a[1]
        );

    const [
      topSemantic,
      topScore
    ] =
      ranked[0] ||
      ['unknown', 0];

    const secondScore =
      ranked[1]?.[1] || 0;

    const confidence =
      topScore >= 25 &&
      topScore -
        secondScore >=
        5
        ? 'high'
        : topScore >= 10
          ? 'medium'
          : 'low';

    const meaningSensitive =
      /disability|differently abled|criminal|debar|disciplin|scholarship|reservation claim|special category|medical condition|health condition|convicted|blacklist/.test(
        full
      );

    return {
      key:
        fieldKey(el),
      semantic:
        topSemantic,
      score:
        topScore,
      confidence,
      reasons:
        reasons.get(
          topSemantic
        ) || [],
      direct:
        label,
      question,
      column,
      section,
      formHeading,
      full,
      attrs,
      options,
      optionText,
      constraints,
      entity:
        entityType(full),
      academicLevel:
        academicLevelForField(el),
      adapter:
        detectControlAdapter(el),
      risk:
        meaningSensitive
          ? 'meaning-sensitive'
          : 'normal'
    };
  };

  const analyzeField = (el, force = false) => {
    const key = fieldKey(el);
    const signature = `${directFieldContext(el)}|${accessibleFieldContext(el)}|${tableHeaderContext(el)}|${sectionContext(el)}|${optionTextList(el).join('~')}|${el.getAttribute?.('pattern') || ''}|${el.getAttribute?.('inputmode') || ''}|${el.getAttribute?.('autocomplete') || ''}`;
    const cached = state.formModel.get(key);

    if (!force && cached?.signature === signature) {
      return cached.analysis;
    }

    let analysis = inferSemantic(el);
    const technical = !force ? cachedFieldTechnical(el) : null;

    if (
      technical &&
      technical.semantic &&
      technical.semantic !== 'unknown' &&
      (
        analysis.semantic === 'unknown' ||
        analysis.confidence === 'low'
      )
    ) {
      analysis = {
        ...analysis,
        semantic: technical.semantic,
        confidence:
          analysis.confidence === 'high'
            ? 'high'
            : technical.confidence || analysis.confidence,
        adapter: technical.adapter || analysis.adapter,
        reasons: [
          ...(analysis.reasons || []),
          'local-cache:technical-form-signature'
        ]
      };
    }

    state.formModel.set(key, {
      signature,
      analysis,
      element: el
    });

    writeFieldTechnicalCache(el, analysis);
    return analysis;
  };

  const buildFormModel = (force = false) => {
    let analyzed = 0;
    for (const doc of collectDocuments()) {
      for (const el of allFields(doc)) {
        if (!isVisible(el) && el.type !== 'file') continue;
        analyzeField(el, force);
        state.knownFieldKeys.add(fieldKey(el));
        analyzed++;
      }
    }
    state.modelBuild++;
    return analyzed;
  };



  const buildAcademicPlan = fields => {
    const levels =
      new Set();

    const chronologyFields =
      (fields || []).filter(el => {
        if (
          !isFieldOperationallyVisible(
            el
          ) ||
          isLikelyInternalField(el)
        ) {
          return false;
        }

        const analysis =
          analyzeField(el);

        const context =
          normalize(
            `${tableRowLabelContext(el)} ${tableHeaderContext(el)} ${explicitLabelContext(el)} ${questionContext(el)}`
          );

        return (
          analysis.semantic ===
            'passing_year' ||
          analysis.semantic ===
            'passing_date' ||
          /year of passing|passing year|pass year|completion year|course completion year|passing date|date of passing/.test(
            context
          )
        );
      });

    // Academic planning is intentionally based on chronology controls only.
    // Upload labels such as "10th marksheet" must not create academic levels.
    for (const el of chronologyFields) {
      const level =
        academicLevelForField(
          el
        );

      if (level) {
        levels.add(level);
      }
    }

    if (!levels.size) {
      state.academicPlan = null;
      return null;
    }

    const applicationYear =
      inferApplicationYear();

    const target =
      inferApplicationTargetLevel();

    const activeLevels =
      academicOrder.filter(
        level =>
          levels.has(level)
      );

    const highestActive =
      activeLevels[
        activeLevels.length - 1
      ];

    const preferredAnchor =
      academicAnchorLevel();

    // Trust the explicit application target only when its prerequisite is
    // actually the highest academic level present in the active form.
    // Otherwise the form structure itself wins.
    const anchor =
      preferredAnchor &&
      levels.has(
        preferredAnchor
      ) &&
      highestActive ===
        preferredAnchor
        ? preferredAnchor
        : highestActive;

    const year = {
      class10: null,
      class12: null,
      ug: null,
      pg: null
    };

    const explicitTargetAnchor =
      !!(
        preferredAnchor &&
        anchor ===
          preferredAnchor
      );

    // If the page clearly says UG/PG/PhD and the corresponding prerequisite
    // is present, the latest prerequisite may legitimately be the current
    // application year. When target cannot be determined, use the synthetic
    // applicant's DOB-based historical chronology instead.
    year[anchor] =
      explicitTargetAnchor
        ? applicationYear
        : Math.min(
            baselineAcademicYearFromProfile(
              anchor
            ),
            applicationYear
          );

    const anchorIndex =
      activeLevels.indexOf(
        anchor
      );

    // Work backward ONLY through academic levels that physically exist
    // in the active form. Missing/higher qualifications are not invented.
    for (
      let i = anchorIndex - 1;
      i >= 0;
      i--
    ) {
      const earlier =
        activeLevels[i];

      const later =
        activeLevels[
          i + 1
        ];

      year[earlier] =
        Math.min(
          baselineAcademicYearFromProfile(
            earlier
          ),
          year[later] -
            academicGapBetweenLevels(
              earlier,
              later
            )
        );
    }

    // Safety invariant: no generated academic qualification may be later
    // than the current/application year.
    for (const level of activeLevels) {
      if (
        Number.isFinite(
          year[level]
        )
      ) {
        year[level] =
          Math.min(
            Math.round(
              year[level]
            ),
            applicationYear
          );
      }
    }

    // Final chronology safety pass from latest to earliest.
    for (
      let i =
        activeLevels.length - 2;
      i >= 0;
      i--
    ) {
      const earlier =
        activeLevels[i];

      const later =
        activeLevels[
          i + 1
        ];

      const gap =
        academicGapBetweenLevels(
          earlier,
          later
        );

      if (
        year[later] -
          year[earlier] <
        gap
      ) {
        year[earlier] =
          year[later] -
          gap;
      }
    }

    const ugDuration =
      selectedUGDurationYears();

    const pgDuration = 2;

    const makeSchoolItem =
      level => {
        const active =
          levels.has(level);

        const endYear =
          active
            ? year[level]
            : null;

        return {
          active,
          year: endYear,
          date:
            Number.isFinite(
              endYear
            )
              ? `${endYear}-05-31`
              : null
        };
      };

    const makeDegreeItem =
      (
        level,
        durationYears
      ) => {
        const active =
          levels.has(level);

        const endYear =
          active
            ? year[level]
            : null;

        return {
          active,
          startYear:
            Number.isFinite(
              endYear
            )
              ? endYear -
                durationYears
              : null,
          endYear,
          date:
            Number.isFinite(
              endYear
            )
              ? `${endYear}-05-31`
              : null,
          durationYears
        };
      };

    const plan = {
      detected:
        [...activeLevels],
      target,
      applicationYear,
      anchor,
      activeOnly: true,
      futureYearsAllowed: false,
      class10:
        makeSchoolItem(
          'class10'
        ),
      class12:
        makeSchoolItem(
          'class12'
        ),
      ug:
        makeDegreeItem(
          'ug',
          ugDuration
        ),
      pg:
        makeDegreeItem(
          'pg',
          pgDuration
        )
    };

    // Update the persistent synthetic profile only for levels currently
    // represented by active academic chronology fields.
    if (
      plan.class10.active &&
      profile.academic?.class10
    ) {
      profile.academic.class10.year =
        String(
          plan.class10.year
        );

      profile.academic.class10.passingDate =
        plan.class10.date;
    }

    if (
      plan.class12.active &&
      profile.academic?.class12
    ) {
      profile.academic.class12.year =
        String(
          plan.class12.year
        );

      profile.academic.class12.passingDate =
        plan.class12.date;
    }

    if (
      plan.ug.active &&
      profile.academic?.ug
    ) {
      profile.academic.ug.startYear =
        String(
          plan.ug.startYear
        );

      profile.academic.ug.endYear =
        String(
          plan.ug.endYear
        );

      profile.academic.ug.passingDate =
        plan.ug.date;
    }

    if (
      plan.pg.active &&
      profile.academic?.pg
    ) {
      profile.academic.pg.startYear =
        String(
          plan.pg.startYear
        );

      profile.academic.pg.endYear =
        String(
          plan.pg.endYear
        );

      profile.academic.pg.passingDate =
        plan.pg.date;
    }

    state.academicPlan =
      plan;

    saveProfile();

    debugEvent(
      'academic-plan',
      {
        target,
        anchor,
        applicationYear,
        detected:
          [...activeLevels],
        class10:
          plan.class10.active
            ? plan.class10.year
            : null,
        class12:
          plan.class12.active
            ? plan.class12.year
            : null,
        ug:
          plan.ug.active
            ? plan.ug.endYear
            : null,
        pg:
          plan.pg.active
            ? plan.pg.endYear
            : null,
        ugDuration,
        activeOnly: true
      }
    );

    return plan;
  };

  const safeAcademicPlanRecord =
    level => {
      const record =
        state.academicPlan?.[
          level
        ];

      if (
        record?.active
      ) {
        return record;
      }

      return null;
    };

  const safeAcademicYearForLevel =
    level => {
      const applicationYear =
        inferApplicationYear();

      const record =
        safeAcademicPlanRecord(
          level
        );

      const planned =
        record
          ? Number(
              level === 'class10' ||
              level === 'class12'
                ? record.year
                : record.endYear
            )
          : null;

      if (
        Number.isFinite(
          planned
        )
      ) {
        return Math.min(
          planned,
          applicationYear
        );
      }

      return Math.min(
        baselineAcademicYearFromProfile(
          level
        ),
        applicationYear
      );
    };

  const safeAcademicDateForLevel =
    level => {
      const year =
        safeAcademicYearForLevel(
          level
        );

      return Number.isFinite(
        year
      )
        ? `${year}-05-31`
        : null;
    };


  const academicValueFromColumn = (el, level) => {
    if (!level) return null;

    const col = columnContext(el);
    if (!col) return null;

    const a =
      profile.academic[level];

    const safeYear =
      safeAcademicYearForLevel(
        level
      );

    const safeDate =
      safeAcademicDateForLevel(
        level
      );

    const activePlan =
      safeAcademicPlanRecord(
        level
      );

    if (/school name|\bschool\b/.test(col) && level !== 'ug' && level !== 'pg') {
      return { value: a.school };
    }

    if (/college|university|institute|institution/.test(col)) {
      return { value: a.institution || a.school };
    }

    if (/board/.test(col)) {
      return { value: a.board || 'CBSE' };
    }

    if (/stream|specialization|specialisation|branch/.test(col)) {
      return { value: a.stream || 'Science' };
    }

    if (/qualification|degree|course/.test(col)) {
      return {
        value:
          a.qualification ||
          (level === 'class10' ? 'Class X' : level === 'class12' ? 'Class XII' : 'Graduate')
      };
    }

    if (/start year|from year|admission year/.test(col)) {
      if (
        activePlan &&
        Number.isFinite(
          activePlan.startYear
        )
      ) {
        return {
          value:
            String(
              activePlan.startYear
            )
        };
      }

      const fallbackStart =
        level === 'ug'
          ? safeYear -
            selectedUGDurationYears()
          : level === 'pg'
            ? safeYear - 2
            : safeYear;

      return {
        value:
          String(
            fallbackStart
          )
      };
    }

    if (/end year|passing year|year of passing|pass year|graduation year|completion year/.test(col)) {
      return {
        date:
          safeDate
      };
    }

    if (/passing date|date of passing|completion date/.test(col)) {
      return {
        date:
          safeDate
      };
    }

    if (/maximum marks|max marks|total marks/.test(col)) {
      return { value: a.maxMarks };
    }

    if (/obtained marks|marks obtained|secured marks/.test(col)) {
      return { value: a.obtainedMarks };
    }

    if (/percentage\s*\/\s*cgpa|percentage\/cgpa/.test(col)) {
      return { value: a.percentage };
    }

    if (/percentage|percent/.test(col)) {
      return { value: a.percentage };
    }

    if (/cgpa|gpa/.test(col)) {
      return { value: a.cgpa };
    }

    if (/\bmarks\b|score/.test(col)) {
      return { value: a.obtainedMarks };
    }

    return null;
  };


  const randomMobileForField = (el, forceNew = false) => {
    const key = fieldKey(el);
    const storageKey = `mobile:${key}`;

    if (!forceNew && state.generatedValues.has(storageKey)) {
      return state.generatedValues.get(storageKey);
    }

    const attempt = (state.repairAttempts.get(key) || 0) + (forceNew ? 1 : 0);
    const seedBase = `${profile.seed || profile.token}|${state.currentFormSignature}|${key}|mobile|${attempt}`;
    const digits = deterministicDigits(seedBase, 10);
    const lead = ['6', '7', '8', '9'][hash32(seedBase) % 4];

    let value = `${lead}${digits.slice(1, 10)}`;

    let guard = 0;
    while (state.usedMobiles.has(value) && guard < 20) {
      guard++;
      const retrySeed = `${seedBase}|${guard}`;
      const retryDigits = deterministicDigits(retrySeed, 10);
      value = `${['6', '7', '8', '9'][hash32(retrySeed) % 4]}${retryDigits.slice(1, 10)}`;
    }

    state.usedMobiles.add(value);
    state.generatedValues.set(storageKey, value);
    return value;
  };

  const desiredTextValue = el => {
    const key = fieldContext(el);
    const type = normalize(el.type);
    const intelligence = analyzeField(el);
    const semantic = intelligence.semantic;
    const entity = intelligence.entity || entityType(key);
    const level = intelligence.academicLevel || academicLevelForField(el);

    if (semantic === 'aadhaar') return { value: profile.aadhaar };
    if (semantic === 'pan') return { value: profile.pan };
    if (semantic === 'first_name') return { value: profile.firstName };
    if (semantic === 'middle_name') return { value: profile.middleName || 'Test' };
    if (semantic === 'last_name') return { value: profile.lastName };
    if (semantic === 'full_name') return { value: entity === 'father' ? profile.father.name : entity === 'mother' ? profile.mother.name : entity === 'guardian' ? profile.guardian.name : profile.fullName };
    if (semantic === 'email') return { value: entity === 'father' ? profile.father.email : entity === 'mother' ? profile.mother.email : entity === 'guardian' ? profile.guardian.email : profile.email };
    if (semantic === 'mobile') return { value: randomMobileForField(el) };
    if (semantic === 'dob') return { date: profile.dobISO };
    if (semantic === 'current_date') return { date: formatTodayISO() };
    if (semantic === 'pincode') return { value: profile.address.pincode };
    if (semantic === 'district') return { value: profile.address.district };
    if (semantic === 'city') return { value: profile.address.city };
    if (semantic === 'state') return { value: profile.address.state };
    if (semantic === 'country') return { value: profile.address.country };
    if (semantic === 'place') return { value: profile.place };
    if (semantic === 'nationality') return { value: profile.nationality };
    if (semantic === 'occupation') return { value: entity === 'father' ? profile.father.occupation : entity === 'mother' ? profile.mother.occupation : entity === 'guardian' ? profile.guardian.occupation : profile.occupation };
    if (semantic === 'income') return { value: '500000' };
    if (semantic === 'organization') return { value: profile.organization };
    if (semantic === 'paragraph') return { value: profile.paragraph };

    if (semantic === 'exam_name') {
      return {
        value:
          distinctTextForRepeatedField(
            el,
            'Test Exam'
          )
      };
    }

    if (semantic === 'exam_score') {
      return {
        value:
          distinctNumericForRepeatedField(
            el,
            70
          )
      };
    }

    if (semantic === 'rank') {
      return {
        value:
          distinctNumericForRepeatedField(
            el,
            100
          )
      };
    }

    if (semantic === 'roll_number') {
      const ordinal =
        repeatingRowOrdinal(el);

      return {
        value:
          String(
            700000 +
            ordinal * 137
          )
      };
    }

    if (/aadhaar|aadhar/.test(key)) return { value: profile.aadhaar };
    if (/pan card|pan number|\bpan\b/.test(key)) return { value: profile.pan };
    if (isSensitive(key)) return { skip: true, manual: 'Sensitive identifier requires manual test value' };

    const academicColumnValue = academicValueFromColumn(el, level);
    if (academicColumnValue) return academicColumnValue;

    if (/first name|firstname|given name/.test(key)) return { value: profile.firstName };
    if (/middle name|middlename/.test(key)) return { value: profile.middleName || 'Test' };
    if (/last name|lastname|surname|family name/.test(key)) return { value: profile.lastName };

    if (/father.*name|name.*father/.test(key)) return { value: profile.father.name };
    if (/mother.*name|name.*mother/.test(key)) return { value: profile.mother.name };
    if (/guardian.*name|name.*guardian/.test(key)) return { value: profile.guardian.name };
    if (/parent.*name|name.*parent/.test(key)) return { value: profile.father.name };
    if (/applicant name|candidate name|student name|full name/.test(key)) return { value: profile.fullName };
    if (/\bname\b/.test(key) && !/school|college|university|institute|institution|organization|organisation|company/.test(key)) {
      return { value: entity === 'father' ? profile.father.name : entity === 'mother' ? profile.mother.name : entity === 'guardian' ? profile.guardian.name : profile.fullName };
    }

    if (/email/.test(key) || type === 'email') {
      return { value: entity === 'father' ? profile.father.email : entity === 'mother' ? profile.mother.email : entity === 'guardian' ? profile.guardian.email : profile.email };
    }

    if (/alternate mobile|alternate phone|secondary mobile|secondary phone/.test(key)) {
      return { value: randomMobileForField(el) };
    }

    if (/mobile|phone|contact number|contact no/.test(key) || type === 'tel') {
      return { value: randomMobileForField(el) };
    }

    if (/date of birth|birth date|\bdob\b/.test(key)) return { date: profile.dobISO };
    if (/\bage\b/.test(key)) return { value: profile.age };

    if (level) {
      const a = profile.academic[level];
      if (/school name|school/.test(key) && level !== 'ug' && level !== 'pg') return { value: a.school };
      if (/college|university|institute|institution/.test(key)) return { value: a.institution || a.school };
      if (/board/.test(key)) return { value: a.board || 'CBSE' };
      if (/stream|specialization|specialisation|branch/.test(key)) return { value: a.stream || 'Science' };
      if (/qualification|degree|course/.test(key)) return { value: a.qualification || (level === 'class10' ? 'Class X' : level === 'class12' ? 'Class XII' : 'Graduate') };
      if (/start year|from year|admission year/.test(key)) {
        const safeYear =
          safeAcademicYearForLevel(
            level
          );

        const record =
          safeAcademicPlanRecord(
            level
          );

        const startYear =
          record &&
          Number.isFinite(
            record.startYear
          )
            ? record.startYear
            : level === 'ug'
              ? safeYear -
                selectedUGDurationYears()
              : level === 'pg'
                ? safeYear - 2
                : safeYear;

        return {
          value:
            String(
              startYear
            )
        };
      }

      if (/end year|passing year|year of passing|pass year|graduation year|completion year/.test(key)) {
        return {
          date:
            safeAcademicDateForLevel(
              level
            )
        };
      }

      if (/passing date|date of passing|completion date/.test(key)) {
        return {
          date:
            safeAcademicDateForLevel(
              level
            )
        };
      }
      if (/maximum marks|max marks|total marks/.test(key)) return { value: a.maxMarks };
      if (/obtained marks|marks obtained|secured marks/.test(key)) return { value: a.obtainedMarks };
      if (/percentage|percent/.test(key)) return { value: a.percentage };
      if (/cgpa|gpa/.test(key)) return { value: a.cgpa };
      if (/\bmarks\b|score/.test(key)) return { value: a.obtainedMarks };
    }

    if (/passing year|year of passing|pass year|completion year/.test(key)) {
      const applicationYear =
        inferApplicationYear();

      const dobYear =
        profileDobYear();

      const fallbackYear =
        Math.min(
          applicationYear,
          dobYear
            ? dobYear + 18
            : applicationYear - 2
        );

      return {
        date:
          `${fallbackYear}-05-31`
      };
    }
    if (/name of examination|name of exam|exam name/.test(key)) {
      return {
        value:
          distinctTextForRepeatedField(
            el,
            'Test Exam'
          )
      };
    }
    if (/score exam|exam score|score based on selection/.test(key)) {
      return {
        value:
          distinctNumericForRepeatedField(
            el,
            70
          )
      };
    }
    if (/\brank\b/.test(key)) {
      return {
        value:
          distinctNumericForRepeatedField(
            el,
            100
          )
      };
    }
    if (/entrance roll number|exam roll number|roll no\.?|roll number/.test(key)) {
      return {
        value:
          String(
            700000 +
            repeatingRowOrdinal(el) *
              137
          )
      };
    }

    if (/percentage|percent/.test(key)) return { value: '82' };
    if (/cgpa|gpa/.test(key)) return { value: '8.2' };
    if (/maximum marks|max marks|total marks|marks out of/.test(key)) return { value: '100' };
    if (/obtained marks|marks obtained|secured marks/.test(key)) return { value: '80' };

    if (/address line 2|address 2|locality/.test(key)) return { value: profile.address.line2 };
    if (/address/.test(key)) return { value: profile.address.line1 };
    if (/pin code|pincode|postal code|zip code|zipcode/.test(key)) return { value: profile.address.pincode };
    if (/district/.test(key)) return { value: profile.address.district };
    if (/city|town/.test(key)) return { value: profile.address.city };
    if (/\bstate\b|province/.test(key)) return { value: profile.address.state };
    if (/country/.test(key)) return { value: profile.address.country };
    if (/place/.test(key)) return { value: profile.place };
    if (/nationality/.test(key)) return { value: profile.nationality };

    if (/father.*occupation|occupation.*father/.test(key)) return { value: profile.father.occupation };
    if (/mother.*occupation|occupation.*mother/.test(key)) return { value: profile.mother.occupation };
    if (/guardian.*occupation|occupation.*guardian/.test(key)) return { value: profile.guardian.occupation };
    if (/occupation|profession/.test(key)) return { value: profile.occupation };
    if (/annual income|family income|monthly income|\bincome\b/.test(key)) return { value: '500000' };
    if (/organization|organisation|company|employer/.test(key)) return { value: profile.organization };

    if (/remarks|comments|description|message|about yourself|statement|reason|purpose|objective/.test(key)) return { value: profile.paragraph };
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return { value: profile.paragraph };

    const dateHint = normalize(`${el.placeholder || ''} ${el.getAttribute('data-placeholder') || ''}`);
    if (
      /declaration date|application date|registration date|current date|today'?s date|date of application/.test(key) ||
      (
        /\bdate\b/.test(directContext(el)) &&
        /(dd\/mm\/yyyy|dd-mm-yyyy|mm\/dd\/yyyy|yyyy-mm-dd)/.test(dateHint)
      )
    ) {
      return { date: formatTodayISO() };
    }

    if (type === 'date') return { date: formatTodayISO() };
    if (type === 'month') return { value: '2024-06' };
    if (type === 'time') return { value: '10:00' };
    if (type === 'datetime-local') return { value: `${formatTodayISO()}T10:00` };
    if (type === 'url') return { value: 'https://example.com' };
    if (type === 'number') {
      let v = 10;
      const min = Number(el.min); const max = Number(el.max);
      if (el.min !== '' && Number.isFinite(min)) v = Math.max(v, min);
      if (el.max !== '' && Number.isFinite(max)) v = Math.min(v, max);
      return { value: String(v) };
    }

    if (intelligence.constraints.numeric) {
      let v = '10';
      if (intelligence.constraints.min !== null) v = String(Math.max(Number(v), intelligence.constraints.min));
      if (intelligence.constraints.max !== null) v = String(Math.min(Number(v), intelligence.constraints.max));
      return { value: v };
    }

    if (intelligence.constraints.alpha) return { value: 'Test Value' };
    if (intelligence.constraints.email) return { value: profile.email };
    if (intelligence.constraints.dateLike) return { date: formatTodayISO() };

    return { value: profile.genericText };
  };

  const validOptions = select => [...select.options].filter(o => {
    const t = normalize(o.text);
    const v = String(o.value || '').trim();
    if (o.disabled || !v) return false;
    if (/^(select|choose|please select|select option|select one|choose option|-- select --)$/.test(t)) return false;
    if (/^-+\s*select\s*-+$/.test(t)) return false;
    return true;
  });

  const selectPreference = select => {
    const key = fieldContext(select);
    const intelligence = analyzeField(select);
    const semantic = intelligence.semantic;
    const level = intelligence.academicLevel || academicLevelForField(select);
    const entity = intelligence.entity || entityType(key);
    const rules = [];

    const add = (...values) => values.filter(Boolean).forEach(v => rules.push(String(v)));

    if (semantic === 'gender' || /gender/.test(key)) add(profile.gender);
    else if (semantic === 'title' || /title|salutation/.test(key)) add(entity === 'mother' ? profile.mother.title : entity === 'father' ? profile.father.title : entity === 'guardian' ? profile.guardian.title : profile.title, 'Mr', 'Mrs');
    else if (semantic === 'nationality' || /nationality/.test(key)) add(profile.nationality, 'India');
    else if (semantic === 'religion' || /religion/.test(key)) add(profile.religion, 'Hindu');
    else if (semantic === 'category' || /category|caste/.test(key)) add(profile.category, 'GEN');
    else if (semantic === 'marital' || /marital/.test(key)) add(profile.maritalStatus, 'Unmarried');
    else if (semantic === 'blood' || /blood/.test(key)) add(profile.bloodGroup);
    else if (semantic === 'country' || /country/.test(key)) { /* V13: handled after options are read */ }
    else if (semantic === 'state' || /state|province/.test(key)) add(profile.address.state, 'New Delhi', 'Delhi NCR');
    else if (semantic === 'district' || /district/.test(key)) add(profile.address.district, 'Central Delhi');
    else if (semantic === 'city' || /city|town/.test(key)) add(profile.address.city, 'Delhi');
    else if (semantic === 'relationship' || /relationship/.test(key)) add(profile.guardian.relationship, 'Uncle');
    else if (semantic === 'occupation' || /occupation/.test(key)) add(entity === 'father' ? profile.father.occupation : entity === 'mother' ? profile.mother.occupation : entity === 'guardian' ? profile.guardian.occupation : profile.occupation, 'Business', 'Homemaker', 'Student');
    else if (semantic === 'income' || /annual income|family income|income/.test(key)) add(profile.familyIncome, '5-10 Lakh', '5,00,000', '500000');
    else if (semantic === 'marking_scheme' || /marking scheme/.test(key)) add('Percentage');
    else if (semantic === 'board' && level) add(profile.academic[level].board || 'CBSE');
    else if (semantic === 'stream' && level) add(profile.academic[level].stream);
    else if (semantic === 'qualification' && level) add(profile.academic[level].qualification);
    else if (/same as.*address|permanent address.*correspondence/.test(key)) add('Yes');

    const options = validOptions(select);

    // V13 rule requested for Country only:
    // choose the first real option exactly as the form presents it.
    // This is deliberately NOT applied to State/District/City or other dependencies.
    if (
      semantic === 'country' ||
      /\bcountry\b/.test(key)
    ) {
      return {
        option: options[0] || null,
        low: false,
        reason: 'Country uses first valid option in displayed order'
      };
    }

    for (const candidate of rules) {
      const target = normalize(candidate);
      const exact = options.find(o => normalize(o.text) === target || normalize(o.value) === target);
      if (exact) return { option: exact, low: intelligence.risk === 'meaning-sensitive' };
    }
    for (const candidate of rules) {
      const target = normalize(candidate);
      const partial = options.find(o => normalize(o.text).includes(target) || target.includes(normalize(o.text)));
      if (partial) return { option: partial, low: intelligence.risk === 'meaning-sensitive' };
    }
    return { option: options[0] || null, low: intelligence.risk === 'meaning-sensitive', reason: 'First valid option accepted for QA completion' };
  };

  const shouldFillField = el => {
    if (isLikelyInternalField(el)) {
      return false;
    }

    return (
      state.mode === 'all' ||
      isRequired(el)
    );
  };

  const fieldHasValue = el => {
    if (
      el.type === 'radio'
    ) {
      const group =
        radioGroupMembers(el);

      return group.length
        ? group.some(
            item =>
              item.checked
          )
        : !!el.checked;
    }

    if (
      el.type === 'checkbox'
    ) {
      return !!el.checked;
    }

    if (
      el.tagName === 'SELECT'
    ) {
      return validOptions(el).includes(
        el.options[
          el.selectedIndex
        ]
      );
    }

    if (
      el.isContentEditable
    ) {
      return !!normalize(
        el.textContent
      );
    }

    return !!String(
      el.value || ''
    ).trim();
  };

  const countPreserved = el => {
    const key = fieldKey(el);

    if (!state.stats.filled.has(key)) {
      state.stats.preserved.add(key);

      const target = visualTarget(el);
      if (target) {
        target.setAttribute(PRESERVED_ATTR, 'true');
        target.removeAttribute(FILLED_ATTR);
      }
    }
  };

  const fillInput = el => {
    if (el.disabled || !isFieldOperationallyVisible(el)) return false;

    if (fieldHasValue(el)) {
      if (isPersonNameField(el) && el.type !== 'file') {
        const current = el.isContentEditable
          ? String(el.textContent || '').trim()
          : String(el.value || '').trim();

        const corrected = prefixTestName(current);

        if (corrected !== current) {
          if (el.isContentEditable) setContentEditable(el, corrected);
          else setNativeValue(el, adaptToConstraints(el, corrected));
          return true;
        }
      }

      countPreserved(el);
      return false;
    }

    if (!shouldFillField(el)) return false;

    const result = desiredTextValue(el);
    if (result.skip) {
      mark(el, 'manual', result.manual || result.error || 'Manual input required');
      return false;
    }
    if (result.date) setSmartDate(el, result.date);
    else if (el.isContentEditable) setContentEditable(el, result.value);
    else setNativeValue(el, adaptToConstraints(el, result.value));
    return true;
  };


  const patternCandidate = (pattern, seedText = '') => {
    const raw = String(pattern || '').trim();
    if (!raw) return null;

    const source = raw
      .replace(/^\^/, '')
      .replace(/\$$/, '');

    const pieces = [];
    const tokenRx = /(\[[^\]]+\]|\\d|\\w|\\s|[A-Za-z0-9])(?:\{(\d+)(?:,(\d+))?\})?/g;
    let match;

    const charFromClass = token => {
      const t = token.replace(/^\[/, '').replace(/\]$/, '');

      if (/A-Z/.test(t) && /a-z/.test(t)) {
        const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        return alpha[hash32(`${seedText}|${pieces.length}`) % alpha.length];
      }

      if (/A-Z/.test(t)) {
        const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        return alpha[hash32(`${seedText}|${pieces.length}`) % alpha.length];
      }

      if (/a-z/.test(t)) {
        const alpha = 'abcdefghijklmnopqrstuvwxyz';
        return alpha[hash32(`${seedText}|${pieces.length}`) % alpha.length];
      }

      if (/0-9/.test(t) || /\d/.test(t)) {
        return deterministicDigits(`${seedText}|${pieces.length}`, 1);
      }

      const literalChars = t.replace(/[^A-Za-z0-9]/g, '');
      if (literalChars) {
        return literalChars[hash32(`${seedText}|${pieces.length}`) % literalChars.length];
      }

      return 'X';
    };

    while ((match = tokenRx.exec(source))) {
      const token = match[1];
      const minCount = Number(match[2] || 1);
      const maxCount = Number(match[3] || minCount);
      const count = Math.min(
        Math.max(minCount, 1),
        Math.max(minCount, Math.min(maxCount, minCount + 2))
      );

      for (let i = 0; i < count; i++) {
        if (token === '\\d') {
          pieces.push(
            deterministicDigits(
              `${seedText}|digit|${pieces.length}`,
              1
            )
          );
        } else if (token === '\\w') {
          const alphaNum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
          pieces.push(
            alphaNum[
              hash32(`${seedText}|word|${pieces.length}`) %
              alphaNum.length
            ]
          );
        } else if (token === '\\s') {
          pieces.push(' ');
        } else if (token.startsWith('[')) {
          pieces.push(charFromClass(token));
        } else {
          pieces.push(token);
        }
      }
    }

    const candidate = pieces.join('');

    return candidate && candidate.length <= 100
      ? candidate
      : null;
  };

  const adaptToConstraints = (el, value) => {
    let v = String(value ?? '');
    const key = fieldContext(el);
    const intelligence = analyzeField(el);
    const c = intelligence.constraints;
    const learned = runtimeConstraintFor(el);
    const effective = {
      ...c,
      numeric: c.numeric || learned.numeric,
      alpha: c.alpha || learned.alpha,
      email: c.email || learned.email,
      minLength: learned.exactLength || learned.minLength || c.minLength,
      maxLength: learned.exactLength || learned.maxLength || c.maxLength,
      min: learned.min ?? c.min,
      max: learned.max ?? c.max
    };

    const generatedFromPattern = patternCandidate(
      c.pattern,
      `${profile.seed || profile.token}|${state.currentFormSignature}|${fieldKey(el)}`
    );

    if (
      generatedFromPattern &&
      (
        intelligence.semantic === 'unknown' ||
        !String(value || '').trim()
      )
    ) {
      v = generatedFromPattern;
    }

    if (effective.maxLength) v = v.slice(0, effective.maxLength);
    if (/aadhaar|aadhar/.test(key) || intelligence.semantic === 'aadhaar') {
      v = digitsOnly(v).padEnd(12, '9').slice(0, 12);
    } else if (effective.numeric || /number only|digits only|numeric/.test(key)) {
      const allowsDecimal = effective.inputMode === 'decimal' || /percentage|cgpa|gpa|decimal/.test(key);
      if (allowsDecimal) {
        v = String(v).replace(/[^0-9.]/g, '');
        const parts = v.split('.');
        if (parts.length > 2) v = `${parts.shift()}.${parts.join('')}`;
      } else {
        v = digitsOnly(v) || '10';
      }
    } else if (effective.alpha) {
      v = alphaOnly(v) || 'Test Value';
    }

    if (effective.minLength && v.length < effective.minLength) {
      const pad = effective.numeric ? '0' : 'x';
      v = v.padEnd(effective.minLength, pad);
    }
    if (effective.maxLength && v.length > effective.maxLength) v = v.slice(0, effective.maxLength);

    if (effective.numeric) {
      let n = Number(v);
      if (Number.isFinite(n)) {
        if (effective.min !== null && effective.min !== undefined) n = Math.max(n, effective.min);
        if (effective.max !== null && effective.max !== undefined) n = Math.min(n, effective.max);
        v = String(n);
      }
    }

    return v;
  };


  const fieldDescriptor = el => {
    const docFields =
      allFields(el.ownerDocument);

    const sameName =
      el.name
        ? docFields.filter(
            item =>
              item.name === el.name &&
              normalize(item.type) ===
                normalize(el.type)
          )
        : [];

    const sameNameIndex =
      sameName.indexOf(el);

    return {
      key: fieldKey(el),
      technical:
        fieldTechnicalSignature(el),
      tag: normalize(el.tagName),
      type: normalize(el.type),
      id: String(el.id || ''),
      name: String(el.name || ''),
      sameNameIndex,
      direct:
        normalize(
          directFieldContext(el)
        ).slice(0, 180),
      column:
        normalize(
          tableHeaderContext(el)
        ).slice(0, 120),
      section:
        normalize(
          sectionContext(el)
        ).slice(0, 160)
    };
  };

  const fieldDescriptorScore = (
    el,
    descriptor
  ) => {
    let score = 0;

    if (
      descriptor.id &&
      el.id === descriptor.id
    ) {
      score += 100;
    }

    if (
      descriptor.name &&
      el.name === descriptor.name
    ) {
      score += 55;
    }

    if (
      normalize(el.tagName) ===
      descriptor.tag
    ) {
      score += 8;
    }

    if (
      normalize(el.type) ===
      descriptor.type
    ) {
      score += 8;
    }

    const direct =
      normalize(
        directFieldContext(el)
      );

    const column =
      normalize(
        tableHeaderContext(el)
      );

    const section =
      normalize(
        sectionContext(el)
      );

    if (
      descriptor.direct &&
      direct === descriptor.direct
    ) {
      score += 35;
    } else if (
      descriptor.direct &&
      (
        direct.includes(
          descriptor.direct
        ) ||
        descriptor.direct.includes(
          direct
        )
      )
    ) {
      score += 20;
    }

    if (
      descriptor.column &&
      column === descriptor.column
    ) {
      score += 25;
    }

    if (
      descriptor.section &&
      section === descriptor.section
    ) {
      score += 18;
    }

    try {
      if (
        fieldTechnicalSignature(el) ===
        descriptor.technical
      ) {
        score += 45;
      }
    } catch {}

    return score;
  };

  const reacquireField = descriptor => {
    if (!descriptor) return null;

    const candidates = [];

    for (const doc of collectDocuments()) {
      for (const el of allFields(doc)) {
        const key = fieldKey(el);

        if (
          key === descriptor.key
        ) {
          return el;
        }

        candidates.push(el);
      }
    }

    if (descriptor.id) {
      const exactId =
        candidates.find(
          el =>
            el.id ===
            descriptor.id
        );

      if (exactId) return exactId;
    }

    if (descriptor.name) {
      const matches =
        candidates.filter(
          el =>
            el.name ===
              descriptor.name &&
            normalize(el.type) ===
              descriptor.type
        );

      if (
        matches.length &&
        descriptor.sameNameIndex >= 0 &&
        matches[
          descriptor.sameNameIndex
        ]
      ) {
        return matches[
          descriptor.sameNameIndex
        ];
      }
    }

    let best = null;
    let bestScore = 0;

    for (const el of candidates) {
      const score =
        fieldDescriptorScore(
          el,
          descriptor
        );

      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }

    return bestScore >= 30
      ? best
      : null;
  };

  const currentFieldFrom = value => {
    if (!value) return null;

    if (
      value.nodeType === 1
    ) {
      if (value.isConnected) {
        return value;
      }

      return reacquireField(
        fieldDescriptor(value)
      );
    }

    return reacquireField(value);
  };

  const fillSelect = select => {
    if (!shouldFillField(select) || select.disabled || !isFieldOperationallyVisible(select)) return false;
    if (fieldHasValue(select)) { countPreserved(select); return false; }
    const choice = selectPreference(select);
    if (!choice.option) {
      rememberPendingSelect(select);
      mark(
        select,
        'error',
        'Dropdown is waiting for usable options'
      );
      return false;
    }
    setSelect(select, choice.option, choice.low);
    return true;
  };

  const radioGroupKey = group => group[0]?.name || fieldKey(group[0]);

  const fillRadios = doc => {
    const groups =
      new Map();

    doc
      .querySelectorAll(
        'input[type="radio"]'
      )
      .forEach(
        (radio, index) => {
          if (
            !isFieldOperationallyVisible(
              radio
            ) ||
            radio.disabled
          ) {
            return;
          }

          const name =
            radio.name ||
            `radio_${index}`;

          if (
            !groups.has(name)
          ) {
            groups.set(
              name,
              []
            );
          }

          groups
            .get(name)
            .push(radio);
        }
      );

    let changed = 0;

    for (
      const group
      of groups.values()
    ) {
      const representative =
        group[0];

      if (
        isLikelyInternalField(
          representative
        )
      ) {
        continue;
      }

      const required =
        group.some(
          isRequired
        );

      if (
        state.mode !== 'all' &&
        !required
      ) {
        continue;
      }

      if (
        group.some(
          radio =>
            radio.checked
        )
      ) {
        countPreserved(
          representative
        );

        continue;
      }

      const question =
        normalize(
          questionContext(
            representative
          )
        );

      const labelContext =
        normalize(
          explicitLabelContext(
            representative
          )
        );

      const keyText =
        normalize(
          `${question} ${labelContext}`
        );

      const labels =
        group.map(
          radio => {
            const optionLabel =
              normalize(
                `${
                  radio.closest(
                    'label'
                  )?.innerText ||
                  ''
                } ${
                  radio.value ||
                  ''
                }`
              );

            return {
              radio,
              text:
                optionLabel
            };
          }
        );

      let choice =
        null;

      let low =
        false;

      if (
        /gender/.test(
          keyText
        )
      ) {
        choice =
          labels.find(
            item =>
              /\bmale\b/.test(
                item.text
              ) &&
              !/female/.test(
                item.text
              )
          );
      } else if (
        /same as.*address|permanent address.*correspondence/.test(
          keyText
        )
      ) {
        choice =
          labels.find(
            item =>
              /\byes\b/.test(
                item.text
              )
          );
      } else if (
        /marital/.test(
          keyText
        )
      ) {
        choice =
          labels.find(
            item =>
              /single|unmarried/.test(
                item.text
              )
          );
      } else if (
        /agree|declaration|undertaking|consent/.test(
          keyText
        )
      ) {
        choice =
          labels.find(
            item =>
              /agree|yes/.test(
                item.text
              )
          ) ||
          labels[0];

        low = true;
      }

      if (!choice) {
        choice =
          labels.find(
            item =>
              /\bno\b/.test(
                item.text
              )
          ) ||
          labels[0];

        low = true;
      }

      if (
        choice?.radio
      ) {
        setChecked(
          choice.radio,
          true,
          low
        );

        changed++;
      }
    }

    return changed;
  };

  const fillCheckboxes = doc => {
    let changed = 0;
    doc.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (!isVisible(cb) || cb.disabled) return;
      if (!shouldFillField(cb)) return;
      if (cb.checked) { countPreserved(cb); return; }
      const key = fieldContext(cb);
      if (/agree|declaration|undertaking|consent|terms/.test(key)) {
        setChecked(cb, true, true);
        changed++;
      } else if (isRequired(cb)) {
        setChecked(cb, true, true);
        changed++;
      }
    });
    return changed;
  };

  const collectDocuments = () => {
    const docs = [document];
    const walk = doc => {
      doc.querySelectorAll('iframe').forEach(frame => {
        try {
          const child = frame.contentDocument;
          if (child && !docs.includes(child)) { docs.push(child); walk(child); }
        } catch {}
      });
    };
    walk(document);
    return docs;
  };

  const isLogicalField = el => {
    if (!el) return false;

    if (
      el.matches?.(
        '.select2-search__field,.chosen-search input'
      )
    ) {
      return false;
    }

    if (
      el.getAttribute?.('aria-hidden') === 'true' &&
      !(el.tagName === 'SELECT' && (
        el.classList.contains('chosen-select') ||
        el.classList.contains('select2-hidden-accessible')
      ))
    ) {
      return false;
    }

    return true;
  };

  const queryFieldsDeep = root => {
    const found = [];
    const visitedRoots = new Set();

    const walk = currentRoot => {
      if (!currentRoot || visitedRoots.has(currentRoot)) return;
      visitedRoots.add(currentRoot);

      let elements = [];

      try {
        elements = [...currentRoot.querySelectorAll('*')];
      } catch {}

      for (const el of elements) {
        try {
          if (
            el.matches(
              'input:not([type="hidden"]),textarea,select,[contenteditable="true"]'
            )
          ) {
            found.push(el);
          }

          if (el.shadowRoot) {
            walk(el.shadowRoot);
          }
        } catch {}
      }
    };

    walk(root);
    return found;
  };

  const allFields = doc => {
    const map = new Map();

    queryFieldsDeep(doc).forEach(el => {
      if (!isLogicalField(el)) return;

      const key = fieldKey(el);
      const existing = map.get(key);

      if (!existing) {
        map.set(key, el);
        return;
      }

      if (!isVisible(existing) && isVisible(el)) {
        map.set(key, el);
      }
    });

    return [...map.values()];
  };



  const fillAriaCombobox = async el => {
    if (!el || el.getAttribute?.('role') !== 'combobox') {
      return false;
    }

    if (fieldHasValue(el)) {
      countPreserved(el);
      return false;
    }

    snapshot(el);

    try {
      el.focus();
      el.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: el.ownerDocument.defaultView
        })
      );
      el.click();
    } catch {}

    await sleep(30);

    const doc = el.ownerDocument;
    const controls = String(el.getAttribute('aria-controls') || '')
      .split(/\s+/)
      .filter(Boolean);

    let option = null;

    for (const id of controls) {
      const popup = doc.getElementById(id);
      if (!popup) continue;

      option = [...popup.querySelectorAll('[role="option"]')]
        .find(node =>
          isVisible(node) &&
          node.getAttribute('aria-disabled') !== 'true' &&
          normalize(node.innerText || node.textContent)
        );

      if (option) break;
    }

    if (!option) {
      option = [...doc.querySelectorAll('[role="listbox"] [role="option"],[role="option"]')]
        .find(node =>
          isVisible(node) &&
          node.getAttribute('aria-disabled') !== 'true' &&
          normalize(node.innerText || node.textContent)
        );
    }

    if (!option) {
      return false;
    }

    try {
      option.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: doc.defaultView
        })
      );
      option.click();
      rememberAfterChange(el);
      return true;
    } catch {
      return false;
    }
  };



  const shouldTrackEmptySelect = select => {
    if (
      !select ||
      select.tagName !== 'SELECT'
    ) {
      return false;
    }

    if (
      fieldHasValue(select)
    ) {
      return false;
    }

    // Ignore all currently inactive/hidden controls. If a parent interaction
    // later reveals the field, the dynamic rescan will discover it then.
    // Hidden native selects behind a genuinely visible Chosen/Select2 wrapper
    // still pass isFieldOperationallyVisible().
    if (
      !isFieldOperationallyVisible(
        select
      )
    ) {
      return false;
    }

    return (
      state.mode === 'all' ||
      isRequired(select) ||
      shouldFillField(select)
    );
  };

  const pendingSelectReason = select => {
    if (!select) return 'missing';

    if (select.disabled) {
      return 'disabled';
    }

    if (
      !isFieldOperationallyVisible(
        select
      )
    ) {
      return 'not-visible-yet';
    }

    if (
      !validOptions(select).length
    ) {
      return 'waiting-for-options';
    }

    return 'ready';
  };

  const rememberPendingSelect = select => {
    if (
      !shouldTrackEmptySelect(select)
    ) {
      return;
    }

    const descriptor =
      fieldDescriptor(select);

    state.pendingDescriptors.set(
      descriptor.key,
      descriptor
    );

    state.pending.add(
      descriptor.key
    );
  };

  const collectPendingSelects = () => {
    for (const doc of collectDocuments()) {
      for (const el of allFields(doc)) {
        if (
          el.tagName !== 'SELECT' ||
          !shouldTrackEmptySelect(el)
        ) {
          continue;
        }

        if (
          pendingSelectReason(el) !==
          'ready'
        ) {
          rememberPendingSelect(el);
        }
      }
    }

    return [
      ...state.pendingDescriptors.values()
    ];
  };

  const fillReadyPendingSelect = descriptor => {
    const select =
      reacquireField(descriptor);

    if (!select) {
      return {
        status: 'missing',
        descriptor
      };
    }

    if (
      fieldHasValue(select)
    ) {
      state.pendingDescriptors.delete(
        descriptor.key
      );
      state.pending.delete(
        descriptor.key
      );

      return {
        status: 'already-filled',
        descriptor
      };
    }

    const reason =
      pendingSelectReason(select);

    if (reason !== 'ready') {
      return {
        status: reason,
        descriptor
      };
    }

    const filled =
      fillSelect(select);

    if (filled) {
      state.pendingDescriptors.delete(
        descriptor.key
      );
      state.pending.delete(
        descriptor.key
      );

      return {
        status: 'filled',
        descriptor,
        element: select
      };
    }

    return {
      status: 'not-filled',
      descriptor,
      element: select
    };
  };


  const pendingDependencyFingerprint = descriptors => {
    const parts = [];

    for (const descriptor of descriptors || []) {
      const el =
        reacquireField(descriptor);

      if (!el) {
        parts.push(
          `${descriptor.key}:missing`
        );
        continue;
      }

      parts.push(
        [
          descriptor.key,
          el.disabled ? 'd1' : 'd0',
          isFieldOperationallyVisible(el)
            ? 'v1'
            : 'v0',
          el.tagName === 'SELECT'
            ? `o${validOptions(el).length}`
            : 'o-',
          `x${String(el.value || '').trim()}`,
          `e${validationText(el).slice(0, 90)}`
        ].join(':')
      );
    }

    return parts
      .sort()
      .join('|');
  };

  const diagnosticFingerprint = issues => {
    return [
      ...issues.values()
    ]
      .map(issue => {
        const el =
          reacquireField(
            issue.descriptor
          );

        return [
          issue.key,
          issue.kind,
          normalize(
            issue.message
          ).slice(0, 100),
          el
            ? String(
                el.value || ''
              )
            : 'missing',
          el?.tagName === 'SELECT'
            ? validOptions(el).length
            : '-'
        ].join(':');
      })
      .sort()
      .join('|');
  };

  const resolveAsyncDependencies =
    async ({
      maxMs = 2200,
      aggressive = false,
      focused = null,
      noProgressMs = null
    } = {}) => {
      const started =
        performance.now();

      const absoluteEnd =
        state.fillDeadline
          ? Math.min(
              Date.now() + maxMs,
              state.fillDeadline
            )
          : Date.now() + maxMs;

      let resolved = 0;
      let lastProgress =
        performance.now();

      const quietLimit =
        noProgressMs ??
        (
          aggressive
            ? DEEP_NO_PROGRESS_MS
            : NORMAL_NO_PROGRESS_MS
        );

      const focusKeys =
        focused?.length
          ? new Set(
              focused.map(
                item =>
                  item.key ||
                  item
              )
            )
          : null;

      collectPendingSelects();

      let descriptors =
        [
          ...state.pendingDescriptors
            .values()
        ].filter(
          descriptor =>
            !focusKeys ||
            focusKeys.has(
              descriptor.key
            )
        );

      let fingerprint =
        pendingDependencyFingerprint(
          descriptors
        );

      while (
        performance.now() -
          started <
          maxMs &&
        Date.now() <
          absoluteEnd &&
        !state.stopRequested
      ) {
        let filledThisCycle = 0;

        descriptors =
          [
            ...state.pendingDescriptors
              .values()
          ].filter(
            descriptor =>
              !focusKeys ||
              focusKeys.has(
                descriptor.key
              )
          );

        for (
          const descriptor
          of descriptors
        ) {
          const result =
            fillReadyPendingSelect(
              descriptor
            );

          if (
            result.status ===
            'filled'
          ) {
            filledThisCycle++;
            resolved++;
          }
        }

        collectPendingSelects();

        descriptors =
          [
            ...state.pendingDescriptors
              .values()
          ].filter(
            descriptor =>
              !focusKeys ||
              focusKeys.has(
                descriptor.key
              )
          );

        if (!descriptors.length) {
          break;
        }

        const nextFingerprint =
          pendingDependencyFingerprint(
            descriptors
          );

        if (
          filledThisCycle ||
          nextFingerprint !==
            fingerprint
        ) {
          fingerprint =
            nextFingerprint;
          lastProgress =
            performance.now();

          await sleep(
            aggressive ? 70 : 45
          );
          continue;
        }

        const quietFor =
          performance.now() -
          lastProgress;

        if (
          quietFor >= quietLimit
        ) {
          break;
        }

        await sleep(
          aggressive ? 80 : 55
        );
      }

      return {
        resolved,
        remaining:
          [
            ...state.pendingDescriptors
              .values()
          ]
      };
    };

  const selectOptionCount = select =>
    select?.tagName === 'SELECT'
      ? validOptions(select).length
      : 0;

  const selectDependencyState = select => ({
    disabled: !!select.disabled,
    optionCount: selectOptionCount(select),
    value: String(select.value || ''),
    hidden:
      !isFieldOperationallyVisible(select)
  });

  const selectStateSnapshot = selects => {
    const snapshot = new Map();

    for (const select of selects) {
      snapshot.set(
        fieldKey(select),
        selectDependencyState(select)
      );
    }

    return snapshot;
  };

  const changedSelectsSince = (
    before,
    selects
  ) => {
    const changed = [];

    for (const select of selects) {
      const key = fieldKey(select);
      const oldState = before.get(key);
      const nextState =
        selectDependencyState(select);

      if (!oldState) {
        changed.push(select);
        continue;
      }

      if (
        oldState.disabled !== nextState.disabled ||
        oldState.optionCount !== nextState.optionCount ||
        oldState.hidden !== nextState.hidden
      ) {
        changed.push(select);
      }
    }

    return changed;
  };

  const hasPotentialDependentSelect = (
    select,
    allSelects
  ) => {
    const index = allSelects.indexOf(select);
    if (index < 0) return false;

    const downstream =
      allSelects.slice(index + 1, index + 7);

    return downstream.some(candidate => {
      const state =
        selectDependencyState(candidate);

      return (
        state.disabled ||
        state.optionCount === 0 ||
        state.hidden
      );
    });
  };

  const waitForSelectConsequences = async (
    before,
    selects,
    likelyDependency
  ) => {
    const maxWait = Math.min(
      likelyDependency
        ? DEPENDENCY_LONG_WAIT_MS
        : DEPENDENCY_SHORT_WAIT_MS,
      Math.max(
        20,
        remainingFillBudget() - 250
      )
    );

    if (maxWait <= 20) {
      return [];
    }

    const start = performance.now();
    let lastChangeAt = 0;
    let detected = [];

    while (
      performance.now() - start < maxWait &&
      withinFillBudget(220)
    ) {
      detected =
        changedSelectsSince(
          before,
          selects
        );

      if (detected.length) {
        if (!lastChangeAt) {
          lastChangeAt = performance.now();
        }

        if (
          performance.now() -
            lastChangeAt >=
          90
        ) {
          return detected;
        }
      }

      await sleep(
        likelyDependency ? 35 : 25
      );
    }

    return detected;
  };

  const processSelectChain = async (
    initialSelect,
    allSelects,
    processed
  ) => {
    const queue = [initialSelect];

    while (
      queue.length &&
      withinFillBudget(900) &&
      !state.stopRequested
    ) {
      const select = queue.shift();
      const key = fieldKey(select);

      if (processed.has(key)) {
        continue;
      }

      processed.add(key);

      if (
        select.disabled ||
        !isVisible(select) ||
        fieldHasValue(select) ||
        !validOptions(select).length
      ) {
        continue;
      }

      const likelyDependency =
        hasPotentialDependentSelect(
          select,
          allSelects
        );

      const before =
        selectStateSnapshot(allSelects);

      touchRunSession();

      if (!fillSelect(select)) {
        continue;
      }

      const children =
        await waitForSelectConsequences(
          before,
          allSelects,
          likelyDependency
        );

      for (const child of children) {
        if (
          child !== select &&
          !processed.has(fieldKey(child)) &&
          !child.disabled &&
          isFieldOperationallyVisible(child) &&
          validOptions(child).length &&
          !fieldHasValue(child)
        ) {
          state.dependencyGraph.set(
            fieldKey(child),
            key
          );

          queue.push(child);
        }
      }
    }
  };

  const processFormChangingSelectsFirst =
    async fields => {
      const selects = fields.filter(
        el =>
          el.tagName === 'SELECT' &&
          isFieldOperationallyVisible(el) &&
          !el.disabled &&
          validOptions(el).length
      );

      if (!selects.length) {
        return 0;
      }

      const processed = new Set();

      const candidates = selects
        .filter(select =>
          hasPotentialDependentSelect(
            select,
            selects
          )
        )
        .slice(0, 12);

      // Include the first few visible dropdowns because top-of-form
      // selections frequently determine the rest of an application.
      selects
        .slice(0, 6)
        .forEach(select => {
          if (!candidates.includes(select)) {
            candidates.push(select);
          }
        });

      for (let i = 0; i < candidates.length; i++) {
        if (
          !withinFillBudget(1200) ||
          state.stopRequested
        ) {
          break;
        }

        setProgress(
          10 +
            Math.round(
              ((i + 1) /
                Math.max(
                  candidates.length,
                  1
                )) *
                15
            ),
          `Resolving form-changing dropdowns ${i + 1}/${candidates.length}...`
        );

        await processSelectChain(
          candidates[i],
          selects,
          processed
        );
      }

      return processed.size;
    };


  const fillReadySelectsQuick = fields => {
    const selects =
      fields.filter(
        el =>
          el.tagName === 'SELECT' &&
          isFieldOperationallyVisible(el)
      );

    let filled = 0;

    for (const select of selects) {
      if (
        state.stopRequested ||
        !withinFillBudget(500)
      ) {
        break;
      }

      if (
        fieldHasValue(select)
      ) {
        continue;
      }

      if (
        select.disabled ||
        !validOptions(select).length
      ) {
        rememberPendingSelect(select);
        continue;
      }

      if (fillSelect(select)) {
        filled++;
      }
    }

    return filled;
  };

  const quickMissedFieldSweep =
    async ({
      maxMs = 2300
    } = {}) => {
      const started =
        Date.now();

      let progress = 0;

      // Anything ready now gets filled immediately.
      let fields =
        visibleFillableFields();

      progress +=
        fillStaticBatch(fields);

      progress +=
        fillReadySelectsQuick(
          fields
        );

      // Give asynchronously loaded controls a short chance,
      // but stop as soon as their state stops changing.
      const dependencyResult =
        await resolveAsyncDependencies({
          maxMs: Math.min(
            maxMs,
            Math.max(
              300,
              remainingFillBudget() -
                450
            )
          ),
          aggressive: false,
          noProgressMs:
            NORMAL_NO_PROGRESS_MS
        });

      progress +=
        dependencyResult.resolved;

      // Only process newly revealed controls once.
      const fresh =
        changedOrNewFields();

      if (
        fresh.length &&
        withinFillBudget(450)
      ) {
        progress +=
          fillStaticBatch(fresh);

        progress +=
          fillReadySelectsQuick(
            fresh
          );

        const dynamic =
          fresh.filter(
            el =>
              isDynamicField(el) &&
              el.tagName !==
                'SELECT'
          );

        if (
          dynamic.length &&
          withinFillBudget(300)
        ) {
          await fillDynamicBatch(
            dynamic
          );
        }
      }

      return {
        progress,
        elapsed:
          Date.now() -
          started,
        pending:
          state.pendingDescriptors.size
      };
    };

  const processRemainingSelects =
    async fields => {
      const selects = fields.filter(
        el =>
          el.tagName === 'SELECT' &&
          isFieldOperationallyVisible(el)
      );

      let filled = 0;

      for (let i = 0; i < selects.length; i++) {
        if (
          !withinFillBudget(800) ||
          state.stopRequested
        ) {
          break;
        }

        const select = selects[i];

        if (
          fieldHasValue(select)
        ) {
          continue;
        }

        if (
          select.disabled ||
          !isFieldOperationallyVisible(select) ||
          !validOptions(select).length
        ) {
          rememberPendingSelect(select);
          continue;
        }

        const likelyDependency =
          hasPotentialDependentSelect(
            select,
            selects
          );

        const before =
          selectStateSnapshot(selects);

        if (fillSelect(select)) {
          filled++;
        }

        if (likelyDependency) {
          const changed =
            await waitForSelectConsequences(
              before,
              selects,
              true
            );

          for (const child of changed) {
            if (
              !child.disabled &&
              isFieldOperationallyVisible(child) &&
              validOptions(child).length &&
              !fieldHasValue(child)
            ) {
              if (fillSelect(child)) {
                filled++;
              }
            }
          }
        }
      }

      return filled;
    };

  const isDateLikeField = el => {
    if (!el || el.tagName === 'SELECT') return false;
    const analysis = analyzeField(el);

    return (
      analysis.constraints.dateLike ||
      ['dob', 'current_date', 'passing_year', 'passing_date', 'date'].includes(analysis.semantic) ||
      /date|year|yyyy|dd\/mm|mm\/dd/.test(fieldContext(el))
    );
  };

  const isDynamicField = el => {
    if (!el) return false;

    if (
      el.tagName === 'SELECT' ||
      el.type === 'radio' ||
      el.type === 'checkbox'
    ) {
      return true;
    }

    if (isDateLikeField(el)) return true;

    const analysis = analyzeField(el);

    return (
      analysis.adapter === 'chosen' ||
      analysis.adapter === 'select2' ||
      analysis.adapter === 'aria-combobox' ||
      analysis.adapter === 'flatpickr' ||
      analysis.adapter === 'datepicker'
    );
  };

  const visibleFillableFields = () => {
    const fields = [];

    for (const doc of collectDocuments()) {
      allFields(doc).forEach(el => {
        if (
          !isFieldOperationallyVisible(el) ||
          isLikelyInternalField(el) &&
          el.type !== 'file'
        ) {
          return;
        }

        fields.push(el);
      });
    }

    return fields;
  };

  const fillStaticBatch = fields => {
    let changed = 0;

    for (const el of fields) {
      if (state.stopRequested) break;

      if (
        el.type === 'file' ||
        el.type === 'submit' ||
        el.type === 'button' ||
        el.type === 'reset' ||
        el.type === 'password' ||
        isDynamicField(el)
      ) {
        continue;
      }

      if (fillInput(el)) changed++;
    }

    updateCounters();
    return changed;
  };

  const fillDynamicBatch = async fields => {
    let changed = 0;
    const radioDocs = new Set();
    const checkboxDocs = new Set();

    for (const el of fields) {
      if (state.stopRequested) break;

      if (el.type === 'file') {
        if (
          shouldFillField(el) &&
          isRequired(el) &&
          !el.files?.length
        ) {
          mark(
            el,
            'manual',
            'Required file upload needs manual action'
          );
        }
        continue;
      }

      if (el.type === 'radio') {
        radioDocs.add(el.ownerDocument);
        continue;
      }

      if (el.type === 'checkbox') {
        checkboxDocs.add(el.ownerDocument);
        continue;
      }

      if (el.tagName === 'SELECT') {
        if (fillSelect(el)) changed++;
        continue;
      }

      if (
        analyzeField(el).adapter === 'aria-combobox'
      ) {
        const success = await fillAriaCombobox(el);

        if (success) {
          changed++;
        } else if (!fieldHasValue(el)) {
          if (fillInput(el)) changed++;
        }

        continue;
      }

      if (isDynamicField(el)) {
        if (fillInput(el)) changed++;
      }
    }

    for (const doc of radioDocs) {
      changed += fillRadios(doc);
    }

    for (const doc of checkboxDocs) {
      changed += fillCheckboxes(doc);
    }

    updateCounters();
    return changed;
  };

  const changedOrNewFields = () => {
    const fresh = [];

    for (const el of visibleFillableFields()) {
      const key = fieldKey(el);

      if (!state.knownFieldKeys.has(key)) {
        state.knownFieldKeys.add(key);
        fresh.push(el);
        analyzeField(el, true);
      }
    }

    return fresh;
  };

  const waitForRelevantChanges = (
    maxWait = 1300,
    quiet = 180
  ) => new Promise(resolve => {
    let changed = false;
    let finished = false;
    let quietTimer = null;

    const finish = reason => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      clearTimeout(hardTimer);
      clearTimeout(quietTimer);
      resolve({ reason, changed });
    };

    const scheduleQuiet = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(
        () => finish('stable'),
        quiet
      );
    };

    const observer = new MutationObserver(mutations => {
      const relevant = mutations.some(mutation => {
        if (mutation.type === 'childList') {
          return mutation.addedNodes.length > 0 ||
            mutation.removedNodes.length > 0;
        }

        if (mutation.type === 'attributes') {
          return [
            'disabled',
            'readonly',
            'aria-expanded',
            'aria-invalid',
            'class'
          ].includes(mutation.attributeName);
        }

        return false;
      });

      if (relevant) {
        changed = true;
        scheduleQuiet();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'readonly',
        'aria-expanded',
        'aria-invalid',
        'class'
      ]
    });

    const hardTimer = setTimeout(
      () => finish('timeout'),
      maxWait
    );

    setTimeout(() => {
      if (!changed) finish('unchanged');
    }, 110);

    scheduleQuiet();
  });

  const fillPass = () => {
    let changed = 0;
    for (const doc of collectDocuments()) {
      allFields(doc).forEach(el => {
        if (state.stopRequested) return;
        if (el.type === 'file' || el.type === 'submit' || el.type === 'button' || el.type === 'reset' || el.type === 'password' || el.type === 'radio' || el.type === 'checkbox') return;
        if (el.tagName === 'SELECT') { if (fillSelect(el)) changed++; }
        else if (fillInput(el)) changed++;
      });
      changed += fillRadios(doc);
      changed += fillCheckboxes(doc);
      doc.querySelectorAll('input[type="file"]').forEach(file => {
        if (
          shouldFillField(file) &&
          isRequired(file) &&
          !file.files?.length
        ) {
          mark(file, 'manual', 'Required file upload needs manual action');
        }
      });
    }
    updateCounters();
    return changed;
  };

  const waitForStableDom = (maxWait = DYNAMIC_TIMEOUT_MS, quiet = STABLE_QUIET_MS) => new Promise(resolve => {
    let done = false;
    let quietTimer = null;
    const finish = reason => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(hardTimer);
      clearTimeout(quietTimer);
      resolve(reason);
    };
    const resetQuiet = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish('stable'), quiet);
    };
    const observer = new MutationObserver(resetQuiet);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled','readonly','class','style'] });
    const hardTimer = setTimeout(() => finish('timeout'), maxWait);
    resetQuiet();
  });

  const inferConstraintFromValidation = (el, message = '') => {
    const msg = normalize(message);
    const learned = {
      numeric: /only numbers|numbers only|numeric|digits only|only digits|must be a number|integer|whole number/.test(msg),
      alpha: /only alphabets|alphabets only|letters only|only letters|characters only|no numbers/.test(msg),
      email: /invalid email|valid email|email format/.test(msg),
      date: /invalid date|valid date|date\/time|datetime|dd\/mm|mm\/dd|yyyy/.test(msg),
      uniqueEmail: /email.*unique|email address should be unique|email.*already exists/.test(msg),
      uniqueMobile: /(mobile|phone|contact).*unique|mobile number should be unique|phone number should be unique/.test(msg),
      mobile: /invalid mobile|invalid phone|mobile number should|phone number should|contact number should/.test(msg),
      required: /required|mandatory|cannot be blank|must be filled|please enter|please select/.test(msg),
      exactLength: null,
      minLength: null,
      maxLength: null,
      min: null,
      max: null
    };

    const exact = msg.match(/(?:exactly|must be|should be|requires?)\s*(\d+)\s*(?:digits|characters|chars)/);
    const genericDigits = msg.match(/\b(\d+)\s*[- ]?digit(?:s)?\b/);
    const minLen = msg.match(/(?:minimum|min|at least)\D{0,12}(\d+)\s*(?:digits|characters|chars)/);
    const maxLen = msg.match(/(?:maximum|max|at most|up to)\D{0,12}(\d+)\s*(?:digits|characters|chars)/);
    const rangeVal =
      msg.match(
        /(?:between|from|range(?:\s+of)?)\D{0,18}(-?\d+(?:\.\d+)?)\s*(?:to|and|-)\s*(-?\d+(?:\.\d+)?)/
      );

    const minVal =
      msg.match(
        /(?:minimum|min value|greater than or equal to|at least|cannot be less than|must not be less than|not below)\D{0,14}(-?\d+(?:\.\d+)?)/
      ) ||
      msg.match(
        /(?:greater than|more than)\D{0,10}(-?\d+(?:\.\d+)?)/
      );

    const maxVal =
      msg.match(
        /(?:maximum|max value|less than or equal to|not exceed|cannot exceed|cannot be greater than|must not be greater than|no more than|at most|up to)\D{0,14}(-?\d+(?:\.\d+)?)/
      ) ||
      msg.match(
        /(?:less than|below)\D{0,10}(-?\d+(?:\.\d+)?)/
      );

    if (exact) learned.exactLength = Number(exact[1]);
    else if (genericDigits && /mobile|phone|contact|aadhaar|aadhar|pin|postal|zip|digit/.test(msg)) learned.exactLength = Number(genericDigits[1]);
    if (minLen) learned.minLength = Number(minLen[1]);
    if (maxLen) learned.maxLength = Number(maxLen[1]);

    if (rangeVal) {
      const a =
        Number(
          rangeVal[1]
        );

      const b =
        Number(
          rangeVal[2]
        );

      learned.min =
        Math.min(a, b);

      learned.max =
        Math.max(a, b);
    } else {
      if (minVal) learned.min = Number(minVal[1]);
      if (maxVal) learned.max = Number(maxVal[1]);
    }

    if (
      learned.min !== null ||
      learned.max !== null
    ) {
      learned.numeric = true;
    }

    if (el) {
      state.runtimeConstraints.set(fieldKey(el), learned);

      try {
        const analysis = analyzeField(el);
        writeFieldTechnicalCache(el, analysis);
        saveTechCache();
      } catch {}
    }

    return learned;
  };

  const runtimeConstraintFor = el => state.runtimeConstraints.get(fieldKey(el)) || {};


  const ERROR_NODE_SELECTOR = [
    '.error',
    '.errors',
    '.help-block',
    '.invalid-feedback',
    '.field-error',
    '.error-message',
    '.text-danger',
    '[class*="error"]',
    '[class*="invalid"]'
  ].join(',');

  const looksLikeValidationErrorText = text => {
    const msg =
      normalize(text);

    if (
      !msg ||
      msg.length > 360
    ) {
      return false;
    }

    // Long numbered eligibility/instruction notes are guidance, not field errors.
    if (
      (
        /(?:^|\s)1\.\s/.test(msg) &&
        /(?:^|\s)2\.\s/.test(msg)
      ) ||
      (
        msg.length > 120 &&
        /make sure that you satisfy|eligibility criteria for the programme|grades and cgpa needs to be entered/.test(
          msg
        )
      )
    ) {
      return false;
    }

    if (
      /^\(?mandatory fields?\)?$/.test(
        msg
      ) ||
      /^\(?required fields?\)?$/.test(
        msg
      ) ||
      /\b\d{1,3}\s*%\s*complete\b/.test(
        msg
      ) ||
      /\bprogress\s*:?\s*\d{1,3}\s*%/.test(
        msg
      )
    ) {
      return false;
    }

    // Strong field-validation language.
    if (
      /please (?:fill|enter|select|choose)|field is mandatory|this field is required|is required$|invalid|already exists|already registered|should be|must be|cannot|can not|not allowed|only numbers|numbers only|numeric|digits only|only digits|only alphabets|alphabets only|letters only|only letters|minimum|maximum|at least|at most|valid email|valid mobile|valid phone|valid date|not match|doesn't match|does not match|overlap|overlapped|minimum gap|year gap|chronological|between\s+-?\d+(?:\.\d+)?\s+(?:to|and)\s+-?\d+(?:\.\d+)?/.test(
        msg
      )
    ) {
      return true;
    }

    // A question/label such as "Accommodation / Hostel Required?"
    // must never be interpreted as a validation error merely because it
    // contains the word "required".
    if (
      msg.includes('?') &&
      !/please|invalid|error|cannot|must|should|only|minimum|maximum/.test(
        msg
      )
    ) {
      return false;
    }

    // Generic required/mandatory text counts only when it has the shape
    // of an actual validation message, not an ordinary field label.
    if (
      /^(required|mandatory|required field|mandatory field|field is required|field is mandatory|this field is required|this field is mandatory|please fill out this field\.?)$/.test(
        msg
      )
    ) {
      return true;
    }

    return false;
  };

  const visibleValidationNodes = doc => {
    const result =
      new Set();

    try {
      doc
        .querySelectorAll(
          ERROR_NODE_SELECTOR
        )
        .forEach(
          node =>
            result.add(node)
        );
    } catch {}

    try {
      const candidates =
        doc.querySelectorAll(
          'small,span,p,label,div'
        );

      for (
        const node
        of candidates
      ) {
        if (
          node.children.length > 3
        ) {
          continue;
        }

        const text =
          String(
            node.innerText ||
            node.textContent ||
            ''
          ).trim();

        if (
          text.length > 260 ||
          !looksLikeValidationErrorText(
            text
          )
        ) {
          continue;
        }

        result.add(node);
      }
    } catch {}

    return [
      ...result
    ].filter(
      node => {
        if (
          !basicVisible(node)
        ) {
          return false;
        }

        const text =
          String(
            node.innerText ||
            node.textContent ||
            ''
          ).trim();

        return (
          !!text &&
          looksLikeValidationErrorText(
            text
          )
        );
      }
    );
  };

  const validationNodeText =
    node =>
      normalize(
        node?.innerText ||
        node?.textContent ||
        ''
      );

  const fieldValidationOwnershipScore =
    (
      node,
      field
    ) => {
      if (
        !node ||
        !field
      ) {
        return -Infinity;
      }

      let score = 0;

      const nodeId =
        node.id;

      if (nodeId) {
        const described =
          String(
            field.getAttribute?.(
              'aria-describedby'
            ) || ''
          )
            .split(/\s+/)
            .filter(Boolean);

        const errored =
          String(
            field.getAttribute?.(
              'aria-errormessage'
            ) || ''
          )
            .split(/\s+/)
            .filter(Boolean);

        if (
          described.includes(
            nodeId
          ) ||
          errored.includes(
            nodeId
          )
        ) {
          score += 140;
        }
      }

      const cell =
        node.closest(
          'td,th'
        );

      if (
        cell &&
        cell.contains(field)
      ) {
        score += 55;
      }

      const exactContainer =
        node.closest(
          '.form-group,.form-field,.field,.form-item,.control-group,.mb-3,.field-wrapper,.form-control-wrap,.question,.question-wrapper'
        );

      if (
        exactContainer &&
        exactContainer.contains(
          field
        )
      ) {
        score += 45;
      }

      const message =
        validationNodeText(
          node
        );

      const label =
        normalize(
          explicitLabelContext(
            field
          )
        );

      const question =
        normalize(
          questionContext(
            field
          )
        );

      const column =
        columnContext(field);

      const semanticWords =
        message
          .split(/\s+/)
          .filter(
            word =>
              word.length >= 4 &&
              !/please|field|required|mandatory|invalid|value|cannot|should|must|greater|less|maximum|minimum/.test(
                word
              )
          );

      for (
        const word
        of semanticWords
      ) {
        if (
          label.includes(word)
        ) {
          score += 9;
        }

        if (
          question.includes(word)
        ) {
          score += 8;
        }

        if (
          column.includes(word)
        ) {
          score += 10;
        }
      }

      try {
        const nodeRect =
          node.getBoundingClientRect();

        const fieldRect =
          visualTarget(
            field
          ).getBoundingClientRect();

        const dx =
          Math.max(
            fieldRect.left -
              nodeRect.right,
            nodeRect.left -
              fieldRect.right,
            0
          );

        const dy =
          Math.max(
            fieldRect.top -
              nodeRect.bottom,
            nodeRect.top -
              fieldRect.bottom,
            0
          );

        const distance =
          Math.hypot(
            dx,
            dy
          );

        score +=
          Math.max(
            0,
            20 -
              Math.min(
                20,
                distance / 20
              )
          );
      } catch {}

      return score;
    };


  const looksLikeFileUploadValidation =
    text => {
      const msg =
        normalize(text);

      return (
        /upload|choose file|file size|max file|jpeg|jpg|png|pdf|docx|document.*mandatory|photo.*mandatory|signature.*mandatory/.test(
          msg
        )
      );
    };

  const candidateFieldsNearValidationNode =
    node => {
      const result =
        new Set();

      const doc =
        node.ownerDocument;

      // Explicit ARIA ownership first.
      if (node.id) {
        try {
          const escaped =
            cssEscape(
              doc,
              node.id
            );

          doc
            .querySelectorAll(
              `[aria-describedby~="${escaped}"],[aria-errormessage~="${escaped}"]`
            )
            .forEach(
              field =>
                result.add(
                  field
                )
            );
        } catch {}
      }

      const cell =
        node.closest(
          'td,th'
        );

      if (cell) {
        cell
          .querySelectorAll(
            'input:not([type="hidden"]),select,textarea,[contenteditable="true"]'
          )
          .forEach(
            field =>
              result.add(
                field
              )
          );
      }

      let parent =
        node.parentElement;

      for (
        let depth = 0;
        parent &&
        depth < 4;
        depth++,
        parent =
          parent.parentElement
      ) {
        try {
          parent
            .querySelectorAll(
              'input:not([type="hidden"]),select,textarea,[contenteditable="true"]'
            )
            .forEach(
              field =>
                result.add(
                  field
                )
            );
        } catch {}

        if (
          result.size >= 12
        ) {
          break;
        }
      }

      const active =
        [
          ...result
        ].filter(
          field =>
            isFieldOperationallyVisible(
              field
            ) &&
            !field.disabled &&
            !isLikelyInternalField(
              field
            )
        );

      if (
        looksLikeFileUploadValidation(
          validationNodeText(
            node
          )
        )
      ) {
        const files =
          active.filter(
            field =>
              field.type ===
              'file'
          );

        // If no active file input owns this upload message, do not guess
        // another control such as a checkbox as the validation owner.
        return files;
      }

      return active;
    };

  const nearestFieldForValidationNode = node => {
    if (!node) return null;

    const candidates =
      candidateFieldsNearValidationNode(
        node
      );

    if (!candidates.length) {
      return null;
    }

    // Treat a radio group as one question.
    const canonical =
      new Map();

    for (
      const field
      of candidates
    ) {
      const rep =
        field.type === 'radio'
          ? radioGroupRepresentative(
              field
            )
          : field;

      canonical.set(
        fieldKey(rep),
        rep
      );
    }

    let best =
      null;

    let bestScore =
      -Infinity;

    let secondScore =
      -Infinity;

    for (
      const field
      of canonical.values()
    ) {
      const score =
        fieldValidationOwnershipScore(
          node,
          field
        );

      if (
        score > bestScore
      ) {
        secondScore =
          bestScore;

        bestScore =
          score;

        best =
          field;
      } else if (
        score >
        secondScore
      ) {
        secondScore =
          score;
      }
    }

    // Do not guess when association is weak or ambiguous.
    if (
      !best ||
      bestScore < 28 ||
      (
        secondScore >
          -Infinity &&
        bestScore -
          secondScore <
          5 &&
        bestScore < 80
      )
    ) {
      return null;
    }

    return best;
  };

  const externalValidationText = el => {
    if (!el?.ownerDocument) return '';

    const messages = [];

    for (const node of visibleValidationNodes(el.ownerDocument)) {
      if (nearestFieldForValidationNode(node) === el) {
        messages.push(node.innerText || node.textContent || '');
      }
    }

    return normalize(messages.join(' '));
  };

  const validationText = el => {
    if (!el) return '';

    const target =
      el.type === 'radio'
        ? radioGroupRepresentative(
            el
          )
        : el;

    const parts = [];

    try {
      if (
        target.validationMessage
      ) {
        parts.push(
          target.validationMessage
        );
      }
    } catch {}

    const doc =
      target.ownerDocument;

    // Exact ARIA-linked messages.
    for (
      const attr
      of [
        'aria-describedby',
        'aria-errormessage'
      ]
    ) {
      const ids =
        String(
          target.getAttribute?.(
            attr
          ) || ''
        )
          .split(/\s+/)
          .filter(Boolean);

      for (const id of ids) {
        try {
          const node =
            doc.getElementById(id);

          const text =
            validationNodeText(
              node
            );

          if (
            node &&
            basicVisible(node) &&
            looksLikeValidationErrorText(
              text
            )
          ) {
            parts.push(text);
          }
        } catch {}
      }
    }

    // Exact wrapper errors only when ownership resolves back to this field/group.
    const wrapper =
      target.closest(
        '.form-group,.form-field,.field,.form-item,.control-group,.mb-3,.field-wrapper,.form-control-wrap,.question,.question-wrapper,td'
      );

    if (wrapper) {
      try {
        wrapper
          .querySelectorAll(
            ERROR_NODE_SELECTOR
          )
          .forEach(
            node => {
              const text =
                validationNodeText(
                  node
                );

              if (
                basicVisible(node) &&
                looksLikeValidationErrorText(
                  text
                ) &&
                !(
                  looksLikeFileUploadValidation(
                    text
                  ) &&
                  target.type !== 'file'
                ) &&
                nearestFieldForValidationNode(
                  node
                ) === target
              ) {
                parts.push(text);
              }
            }
          );
      } catch {}
    }

    return normalize(
      [
        ...new Set(
          parts.filter(Boolean)
        )
      ].join(' ')
    );
  };

  const isInvalid = el => {
    if (
      !isFieldOperationallyVisible(
        el
      ) ||
      el.disabled ||
      isLikelyInternalField(el)
    ) {
      return false;
    }

    if (
      el.type === 'radio'
    ) {
      const group =
        radioGroupMembers(el);

      const representative =
        group[0] || el;

      // Only one member represents the group in diagnostics.
      if (
        el !==
        representative
      ) {
        return false;
      }

      if (
        isRequired(
          representative
        ) &&
        !group.some(
          item =>
            item.checked
        )
      ) {
        return true;
      }

      try {
        if (
          typeof representative.checkValidity === 'function' &&
          !representative.checkValidity()
        ) {
          return true;
        }
      } catch {}

      return !!validationText(
        representative
      );
    }

    if (
      isRequired(el) &&
      !fieldHasValue(el)
    ) {
      return true;
    }

    try {
      if (
        typeof el.checkValidity === 'function' &&
        !el.checkValidity()
      ) {
        return true;
      }
    } catch {}

    return !!validationText(
      el
    );
  };

  const academicConsistencyErrors = () => {
    const a = profile.academic;
    const y10 = Number(a.class10.year), y12 = Number(a.class12.year), yug = Number(a.ug.endYear), ypg = Number(a.pg.endYear);
    const errors = [];
    if (!(y10 < y12 && y12 <= yug && yug <= ypg)) errors.push('Academic years are not chronological');
    for (const [name, item] of Object.entries(a)) {
      const p = Number(item.percentage);
      const max = Number(item.maxMarks), got = Number(item.obtainedMarks);
      if (Number.isFinite(p) && (p < 0 || p > 100)) errors.push(`${name} percentage is invalid`);
      if (max > 0 && got > max) errors.push(`${name} obtained marks exceed maximum marks`);
      if (max > 0 && got >= 0 && Math.abs((got / max) * 100 - p) > 1.5) errors.push(`${name} marks and percentage are inconsistent`);
    }
    return errors;
  };

  const validateForm = (
    {
      deepText = true
    } = {}
  ) => {
    state.stats.errors.clear();
    state.stats.manual.clear();

    // Snapshot the logical fields once for this validation cycle.
    // Previously allFields() was rebuilt repeatedly inside the same scan.
    const snapshots =
      collectDocuments().map(
        doc => ({
          doc,
          fields:
            allFields(doc)
        })
      );

    for (
      const {
        fields
      }
      of snapshots
    ) {
      for (const el of fields) {
        clearMark(
          el,
          ERROR_ATTR
        );

        clearMark(
          el,
          MANUAL_ATTR
        );

        if (
          !isFieldOperationallyVisible(
            el
          ) ||
          el.disabled ||
          isLikelyInternalField(el)
        ) {
          continue;
        }

        const key =
          fieldContext(el);

        if (
          el.type === 'file'
        ) {
          if (
            isRequired(el) &&
            !el.files?.length
          ) {
            mark(
              el,
              'manual',
              'Required file upload needs manual action'
            );
          }

          continue;
        }

        if (
          isSensitive(key) &&
          !fieldHasValue(el)
        ) {
          if (
            isRequired(el)
          ) {
            mark(
              el,
              'manual',
              'Sensitive identifier requires manual test value'
            );
          }

          continue;
        }

        if (isInvalid(el)) {
          mark(
            el,
            'error',
            validationText(el) ||
              'Required or invalid value'
          );
        }
      }
    }

    // Full plain-text / external validation association is expensive.
    // Run it only for explicit Deep Validate/Recheck/final Fill validation,
    // never for lightweight live typing checks.
    if (deepText) {
      for (
        const {
          doc
        }
        of snapshots
      ) {
        const nodes =
          visibleValidationNodes(
            doc
          );

        for (const node of nodes) {
          if (
            state.stopRequested
          ) {
            break;
          }

          const el =
            nearestFieldForValidationNode(
              node
            );

          if (
            !el ||
            el.disabled ||
            !isFieldOperationallyVisible(
              el
            ) ||
            isLikelyInternalField(el)
          ) {
            continue;
          }

          if (
            el.type === 'file'
          ) {
            if (
              isRequired(el) &&
              !el.files?.length
            ) {
              mark(
                el,
                'manual',
                'Required file upload needs manual action'
              );
            }

            continue;
          }

          const message =
            normalize(
              node.innerText ||
              node.textContent ||
              ''
            );

          if (message) {
            mark(
              el,
              'error',
              message
            );
          }
        }
      }
    }

    updateCounters();

    return state.stats.errors.size;
  };


  const diagnoseFormIssues = (
    {
      deepText = true
    } = {}
  ) => {
    validateForm({
      deepText
    });

    const issues =
      new Map();

    const snapshots =
      collectDocuments().map(
        doc => ({
          doc,
          fields:
            allFields(doc)
        })
      );

    for (
      const {
        fields
      }
      of snapshots
    ) {
      for (const el of fields) {
        if (
          !isFieldOperationallyVisible(
            el
          ) ||
          el.disabled ||
          isLikelyInternalField(
            el
          )
        ) {
          continue;
        }

        if (
          el.type === 'radio' &&
          radioGroupRepresentative(
            el
          ) !== el
        ) {
          continue;
        }

        const descriptor =
          fieldDescriptor(el);

        const key =
          descriptor.key;

        const target =
          visualTarget(el);

        const markedError =
          target?.getAttribute(
            ERROR_ATTR
          ) || '';

        const markedManual =
          target?.getAttribute(
            MANUAL_ATTR
          ) || '';

        if (
          el.type === 'file'
        ) {
          if (
            isRequired(el) &&
            !el.files?.length
          ) {
            issues.set(
              key,
              {
                key,
                descriptor,
                kind:
                  'manual-file',
                message:
                  markedManual ||
                  'Required file upload needs manual action',
                repairable: false
              }
            );
          }

          continue;
        }

        if (
          markedManual
        ) {
          issues.set(
            key,
            {
              key,
              descriptor,
              kind: 'manual',
              message:
                markedManual,
              repairable: false
            }
          );

          continue;
        }

        if (
          el.tagName ===
            'SELECT' &&
          !fieldHasValue(el) &&
          (
            state.mode ===
              'all' ||
            isRequired(el)
          )
        ) {
          const reason =
            pendingSelectReason(
              el
            );

          issues.set(
            key,
            {
              key,
              descriptor,
              kind:
                reason === 'ready'
                  ? 'empty-select'
                  : 'pending-select',
              message:
                reason === 'ready'
                  ? 'Dropdown is ready but empty'
                  : `Dropdown dependency unresolved: ${reason}`,
              repairable: true
            }
          );

          if (
            reason !== 'ready'
          ) {
            rememberPendingSelect(
              el
            );
          }

          continue;
        }

        if (
          markedError
        ) {
          issues.set(
            key,
            {
              key,
              descriptor,
              kind:
                'validation',
              message:
                markedError,
              repairable: true
            }
          );
        }
      }
    }

    state.diagnostics =
      issues;

    return issues;
  };

  const issueSummary = issues => {
    const summary = {
      total: issues.size,
      repairable: 0,
      pending: 0,
      validation: 0,
      manual: 0
    };

    for (
      const issue
      of issues.values()
    ) {
      if (issue.repairable) {
        summary.repairable++;
      }

      if (
        issue.kind ===
        'pending-select'
      ) {
        summary.pending++;
      }

      if (
        issue.kind ===
        'validation'
      ) {
        summary.validation++;
      }

      if (
        issue.kind ===
        'manual-file'
      ) {
        summary.manual++;
      }
    }

    return summary;
  };

  const uniqueEmailFor = el => {
    const key = fieldContext(el);
    const entity = entityType(key);
    const suffix = `${Date.now()}${randomInt(10, 99)}`;

    if (entity === 'father') {
      return makeEmail(
        profile.father.name,
        suffix,
        true
      );
    }

    if (entity === 'mother') {
      return makeEmail(
        profile.mother.name,
        suffix,
        true
      );
    }

    if (entity === 'guardian') {
      return makeEmail(
        profile.guardian.name,
        suffix,
        true
      );
    }

    return makeEmail(
      profile.fullName,
      suffix,
      true
    );
  };

  const uniqueMobileFor = el => {
    const key = fieldKey(el);
    state.repairAttempts.set(
      key,
      (state.repairAttempts.get(key) || 0) + 1
    );

    state.generatedValues.delete(`mobile:${key}`);
    return randomMobileForField(el, true);
  };


  const isoAddMonths = (
    iso,
    months
  ) => {
    const date =
      new Date(`${iso}T12:00:00`);

    date.setMonth(
      date.getMonth() + months
    );

    const y =
      date.getFullYear();

    const m =
      String(
        date.getMonth() + 1
      ).padStart(2, '0');

    const d =
      String(
        date.getDate()
      ).padStart(2, '0');

    return `${y}-${m}-${d}`;
  };

  const rowLogicalFields = row =>
    [
      ...row.querySelectorAll(
        'input:not([type="hidden"]),select,textarea'
      )
    ].filter(
      el =>
        isVisible(el) &&
        !el.disabled
    );

  const findRowFieldByMeaning = (
    row,
    regex
  ) => {
    const fields =
      rowLogicalFields(row);

    return (
      fields.find(
        el =>
          regex.test(
            normalize(
              columnContext(el)
            )
          )
      ) ||
      fields.find(
        el =>
          regex.test(
            normalize(
              directContext(el)
            )
          )
      ) ||
      fields.find(
        el =>
          regex.test(
            normalize(
              fieldContext(el)
            )
          )
      ) ||
      null
    );
  };

  const repairDateRangeTable =
    focusEl => {
      const table =
        focusEl?.closest?.('table');

      if (!table) return 0;

      const rows = [
        ...table.querySelectorAll(
          'tr'
        )
      ]
        .map(row => ({
          row,
          start:
            findRowFieldByMeaning(
              row,
              /\bfrom\b|start date|date from|joining date|joined on|period from/
            ),
          end:
            findRowFieldByMeaning(
              row,
              /\bto\b|end date|date to|leaving date|period to|till date|until/
            ),
          months:
            findRowFieldByMeaning(
              row,
              /total experience|experience.*months|duration.*months|total months|months of experience/
            )
        }))
        .filter(
          item =>
            item.start &&
            item.end &&
            item.start !==
              item.end
        );

      if (!rows.length) {
        return 0;
      }

      const surrounding =
        normalize(
          `${
            table.previousElementSibling
              ?.innerText || ''
          } ${
            table.parentElement
              ?.innerText || ''
          }`
        ).slice(0, 1400);

      const earliestFirst =
        /earliest.*first|oldest.*first/.test(
          surrounding
        );

      const latestFirst =
        !earliestFirst;

      const today =
        formatTodayISO();

      let changed = 0;

      rows.forEach(
        (item, index) => {
          const logicalIndex =
            latestFirst
              ? index
              : rows.length -
                1 -
                index;

          // 12-month ranges separated by one month.
          // This satisfies "no overlap" while remaining generic.
          const endIso =
            isoAddMonths(
              today,
              -(logicalIndex * 13)
            );

          const startIso =
            isoAddMonths(
              endIso,
              -12
            );

          setSmartDate(
            item.start,
            startIso
          );

          setSmartDate(
            item.end,
            endIso
          );

          if (item.months) {
            setNativeValue(
              item.months,
              '12'
            );
          }

          changed +=
            item.months ? 3 : 2;
        }
      );

      return changed;
    };


  const isAcademicYearLikeField =
    el => {
      if (
        !el ||
        !isFieldOperationallyVisible(
          el
        ) ||
        el.disabled
      ) {
        return false;
      }

      const analysis =
        analyzeField(el);

      const context =
        normalize(
          `${columnContext(el)} ${explicitLabelContext(el)} ${questionContext(el)} ${technicalFieldContext(el)}`
        );

      return (
        analysis.semantic ===
          'passing_year' ||
        /year of passing|passing year|pass year|graduation year|completion year|course completion year/.test(
          context
        )
      );
    };

  const academicYearFieldsInSameTable =
    focusEl => {
      const table =
        focusEl?.closest?.(
          'table'
        );

      if (!table) {
        return [];
      }

      return allFields(
        focusEl.ownerDocument
      )
        .filter(
          el =>
            el.closest?.(
              'table'
            ) === table &&
            isAcademicYearLikeField(
              el
            )
        )
        .sort(
          (a, b) => {
            if (a === b) return 0;

            const pos =
              a.compareDocumentPosition(
                b
              );

            if (
              pos &
              Node.DOCUMENT_POSITION_FOLLOWING
            ) {
              return -1;
            }

            if (
              pos &
              Node.DOCUMENT_POSITION_PRECEDING
            ) {
              return 1;
            }

            return 0;
          }
        );
    };

  const resolveAcademicPairFields =
    (
      focusEl,
      earlierLevel,
      laterLevel,
      fieldMap
    ) => {
      let earlier =
        fieldMap.get(
          earlierLevel
        ) || null;

      let later =
        fieldMap.get(
          laterLevel
        ) || null;

      if (
        earlier &&
        later
      ) {
        return {
          earlier,
          later
        };
      }

      const sameTable =
        academicYearFieldsInSameTable(
          focusEl
        );

      if (!sameTable.length) {
        return {
          earlier,
          later
        };
      }

      // First recover levels from row labels directly.
      for (const field of sameTable) {
        const level =
          academicLevelFromRowLabel(
            tableRowLabelContext(
              field
            )
          );

        if (
          level === earlierLevel &&
          !earlier
        ) {
          earlier = field;
        }

        if (
          level === laterLevel &&
          !later
        ) {
          later = field;
        }
      }

      if (
        earlier &&
        later
      ) {
        return {
          earlier,
          later
        };
      }

      // Final structural fallback: if the validation explicitly names a
      // pair (e.g. 10th→12th) and is attached to the later year field,
      // use the immediately preceding academic year field in the same table.
      const focusIndex =
        sameTable.indexOf(
          focusEl
        );

      if (
        !later &&
        focusIndex >= 0
      ) {
        later =
          focusEl;
      }

      if (
        later &&
        !earlier
      ) {
        const laterIndex =
          sameTable.indexOf(
            later
          );

        if (laterIndex > 0) {
          earlier =
            sameTable[
              laterIndex - 1
            ];
        }
      }

      // Symmetric fallback for an error attached to the earlier field.
      if (
        earlier &&
        !later
      ) {
        const earlierIndex =
          sameTable.indexOf(
            earlier
          );

        if (
          earlierIndex >= 0 &&
          earlierIndex <
            sameTable.length - 1
        ) {
          later =
            sameTable[
              earlierIndex + 1
            ];
        }
      }

      return {
        earlier,
        later
      };
    };

  const academicYearFieldMap =
    () => {
      const map = new Map();

      for (const doc of collectDocuments()) {
        for (const el of allFields(doc)) {
          if (
            !isFieldOperationallyVisible(
              el
            ) ||
            el.disabled
          ) {
            continue;
          }

          const context =
            normalize(
              `${columnContext(el)} ${fieldContext(el)}`
            );

          if (
            !/year of passing|passing year|pass year|graduation year|\byear\b/.test(
              context
            )
          ) {
            continue;
          }

          const level =
            analyzeField(el)
              .academicLevel ||
            academicLevelForField(el);

          if (
            level &&
            !map.has(level)
          ) {
            map.set(level, el);
          }
        }
      }

      return map;
    };

  const parseAcademicGapConstraint =
    message => {
      const msg =
        normalize(message);

      const strict =
        msg.match(
          /(?:greater than|more than)\s*(\d+)\s*year/
        );

      if (strict) {
        return (
          Number(
            strict[1]
          ) + 1
        );
      }

      const atLeast =
        msg.match(
          /(?:at least|minimum(?:\s+gap|\s+difference)?(?:\s+should be)?|minimum difference should be|minimum gap should be)\D{0,12}(\d+)\s*year/
        );

      if (atLeast) {
        return Math.max(
          1,
          Number(
            atLeast[1]
          )
        );
      }

      const generic =
        msg.match(
          /(?:gap|difference).*?(\d+)\s*year/
        ) ||
        msg.match(
          /(\d+)\s*year.*?(?:gap|difference)/
        ) ||
        msg.match(
          /should be\s*(\d+)\s*year/
        );

      return generic
        ? Math.max(
            1,
            Number(
              generic[1]
            )
          )
        : null;
    };

  const academicYearFromField =
    el => {
      if (!el) return null;

      const match =
        String(
          el.value || ''
        ).match(
          /\b(19|20)\d{2}\b/
        );

      return match
        ? Number(match[0])
        : null;
    };

  const academicPlanYear =
    level => {
      const item =
        state.academicPlan?.[
          level
        ];

      if (!item) return null;

      return Number(
        level === 'class10' ||
        level === 'class12'
          ? item.year
          : item.endYear
      ) || null;
    };

  const writeAcademicYear =
    (
      level,
      el,
      target
    ) => {
      if (
        !el ||
        !Number.isFinite(
          target
        )
      ) {
        return 0;
      }

      const applicationYear =
        inferApplicationYear();

      const year =
        Math.min(
          Math.round(target),
          applicationYear
        );

      if (
        academicYearFromField(
          el
        ) === year
      ) {
        return 0;
      }

      setSmartDate(
        el,
        `${year}-05-31`
      );

      const item =
        profile.academic?.[
          level
        ];

      if (item) {
        if (
          level === 'class10' ||
          level === 'class12'
        ) {
          item.year =
            String(year);
        } else {
          item.endYear =
            String(year);
        }

        item.passingDate =
          `${year}-05-31`;
      }

      return 1;
    };

  const repairAcademicRelationship =
    (
      focusEl,
      message
    ) => {
      const msg =
        normalize(message);

      // Rebuild the latest structure-aware chronology before repairing.
      buildAcademicPlan(
        visibleFillableFields()
      );

      const fields =
        academicYearFieldMap();

      if (!fields.size) {
        return 0;
      }

      const order = [
        'class10',
        'class12',
        'ug',
        'pg'
      ];

      const mentioned = [];

      if (
        /10th|10 th|class x\b|(?:^|\s)x(?:\s|$)|ssc|sslc|matric|secondary/.test(
          msg
        ) &&
        !/12th|class xii|senior secondary|higher secondary/.test(
          msg
        )
      ) {
        mentioned.push(
          'class10'
        );
      }

      if (
        /12th|12 th|class xii|(?:^|\s)xii(?:\s|$)|hsc|senior secondary|higher secondary|intermediate|puc ?2/.test(
          msg
        )
      ) {
        mentioned.push(
          'class12'
        );
      }

      if (
        /graduation|under ?graduate|\bug\b|bachelor/.test(
          msg
        )
      ) {
        mentioned.push(
          'ug'
        );
      }

      if (
        /post ?graduation|postgraduate|\bpg\b|master/.test(
          msg
        )
      ) {
        mentioned.push(
          'pg'
        );
      }

      let pair =
        [
          ...new Set(
            mentioned
          )
        ].sort(
          (a, b) =>
            order.indexOf(a) -
            order.indexOf(b)
        );

      const focusLevel =
        academicLevelForField(
          focusEl
        );

      // Messages like "minimum difference should be 3 years" often name
      // no qualifications. Infer the relationship from the field's actual
      // academic level and its immediately preceding qualification.
      if (
        pair.length < 2 &&
        focusLevel
      ) {
        const index =
          order.indexOf(
            focusLevel
          );

        if (index > 0) {
          pair = [
            order[index - 1],
            focusLevel
          ];
        }
      }

      if (
        pair.length < 2
      ) {
        return 0;
      }

      const earlierLevel =
        pair[0];

      const laterLevel =
        pair[pair.length - 1];

      const resolvedPair =
        resolveAcademicPairFields(
          focusEl,
          earlierLevel,
          laterLevel,
          fields
        );

      const earlier =
        resolvedPair.earlier;

      const later =
        resolvedPair.later;

      if (
        !earlier ||
        !later ||
        earlier === later
      ) {
        debugEvent(
          'academic-repair-unresolved-pair',
          {
            message:
              msg.slice(
                0,
                180
              ),
            earlierLevel,
            laterLevel,
            focusRow:
              tableRowLabelContext(
                focusEl
              )
          }
        );

        return 0;
      }

      const requiredGap =
        Math.max(
          parseAcademicGapConstraint(
            msg
          ) || 0,
          defaultAcademicGapYears(
            earlierLevel,
            laterLevel
          )
        );

      const appYear =
        inferApplicationYear();

      const anchor =
        academicAnchorLevel();

      let earlierTarget =
        academicPlanYear(
          earlierLevel
        );

      let laterTarget =
        academicPlanYear(
          laterLevel
        );

      const currentEarlier =
        academicYearFromField(
          earlier
        );

      const currentLater =
        academicYearFromField(
          later
        );

      // If this relationship ends at the admission prerequisite anchor
      // (e.g. 10th→12th for UG, 12th→UG for PG), preserve the latest
      // qualification at the application year and work backward.
      if (
        laterLevel === anchor
      ) {
        laterTarget =
          Math.min(
            appYear,
            laterTarget ||
              appYear
          );

        earlierTarget =
          laterTarget -
          requiredGap;
      } else if (
        Number.isFinite(
          laterTarget
        )
      ) {
        earlierTarget =
          Math.min(
            earlierTarget ??
              (
                laterTarget -
                requiredGap
              ),
            laterTarget -
              requiredGap
          );
      } else if (
        Number.isFinite(
          currentLater
        ) &&
        currentLater <=
          appYear
      ) {
        laterTarget =
          currentLater;

        earlierTarget =
          currentLater -
          requiredGap;
      } else if (
        Number.isFinite(
          currentEarlier
        )
      ) {
        earlierTarget =
          currentEarlier;

        laterTarget =
          Math.min(
            appYear,
            currentEarlier +
              requiredGap
          );

        if (
          laterTarget -
            earlierTarget <
          requiredGap
        ) {
          earlierTarget =
            laterTarget -
            requiredGap;
        }
      }

      if (
        !Number.isFinite(
          earlierTarget
        ) ||
        !Number.isFinite(
          laterTarget
        )
      ) {
        return 0;
      }

      if (
        laterTarget -
          earlierTarget <
        requiredGap
      ) {
        earlierTarget =
          laterTarget -
          requiredGap;
      }

      let changed = 0;

      changed +=
        writeAcademicYear(
          earlierLevel,
          earlier,
          earlierTarget
        );

      changed +=
        writeAcademicYear(
          laterLevel,
          later,
          laterTarget
        );

      if (changed) {
        saveProfile();

        debugEvent(
          'academic-repair',
          {
            message: msg.slice(
              0,
              180
            ),
            earlierLevel,
            laterLevel,
            requiredGap,
            earlierYear:
              earlierTarget,
            laterYear:
              laterTarget
          }
        );
      }

      return changed;
    };

  const repairRelationalValidation =
    (
      el,
      message
    ) => {
      const msg =
        normalize(message);

      if (
        /overlap|overlapped|date.*overlap|period.*overlap/.test(
          msg
        )
      ) {
        return (
          repairDateRangeTable(
            el
          ) > 0
        );
      }

      if (
        /minimum gap|minimum difference|year gap|gap between|difference should|greater than\s+\d+\s*year|at least\s+\d+\s*year|chronological|should be after|must be after|should be before|must be before/.test(
          msg
        )
      ) {
        return (
          repairAcademicRelationship(
            el,
            msg
          ) > 0
        );
      }

      return false;
    };

  const correctFieldFromError = (el, messageOverride = '') => {
    if (!isVisible(el) || el.disabled || el.type === 'file') return false;
    const key = fieldContext(el);
    const nativeMessage =
      validationText(el);

    const msg =
      normalize(
        messageOverride ||
        nativeMessage
      );

    const combined =
      `${key} ${msg} ${nativeMessage}`;
    const learned = inferConstraintFromValidation(el, msg);
    const intelligence = analyzeField(el, true);
    const constraints = { ...intelligence.constraints, ...learned };

    if (
      repairRelationalValidation(
        el,
        msg
      )
    ) {
      return true;
    }

    if (learned.uniqueEmail) {
      setNativeValue(el, uniqueEmailFor(el));
      return true;
    }

    if (learned.uniqueMobile) {
      setNativeValue(el, uniqueMobileFor(el));
      return true;
    }

    if (
      /cannot have same|cannot be same|must be unique|duplicate|already used|already selected|same .* not allowed/.test(
        combined
      )
    ) {
      const current =
        String(
          el.value || ''
        );

      if (
        constraints.numeric ||
        /score|rank|roll|number|marks|count/.test(
          key
        )
      ) {
        setNativeValue(
          el,
          distinctNumericForRepeatedField(
            el,
            Number(
              digitsOnly(current)
            ) || 10,
            (
              state.repairAttempts.get(
                fieldKey(el)
              ) || 0
            )
          )
        );
      } else {
        setNativeValue(
          el,
          distinctTextForRepeatedField(
            el,
            current ||
            desiredTextValue(el)
              .value ||
            'Test Value',
            (
              state.repairAttempts.get(
                fieldKey(el)
              ) || 0
            )
          )
        );
      }

      return true;
    }

    if (learned.date) {
      const desired = desiredTextValue(el);
      setSmartDate(el, desired.date || formatTodayISO());
      return true;
    }

    if (learned.email) {
      setNativeValue(el, uniqueEmailFor(el));
      return true;
    }

    if (learned.mobile || /mobile|phone|contact/.test(key)) {
      let value = uniqueMobileFor(el);
      const len = learned.exactLength || learned.minLength || learned.maxLength;
      if (len) value = digitsOnly(value).padEnd(len, '0').slice(0, len);
      setNativeValue(el, value);
      return true;
    }

    if (learned.numeric) {
      const current =
        digitsOnly(
          String(
            el.value || ''
          )
        );

      const desired =
        digitsOnly(
          desiredTextValue(el)
            .value || ''
        );

      let value =
        desired ||
        current ||
        '10';

      // If the server/client validator is actively rejecting zero, choose a
      // different positive numeric candidate rather than replaying the same 0.
      if (
        Number(value) === 0 ||
        (
          current &&
          value === current &&
          /only numbers|numeric|digits|please fill out this field/.test(
            combined
          )
        )
      ) {
        value =
          distinctNumericForRepeatedField(
            el,
            10,
            (
              state.repairAttempts.get(
                fieldKey(el)
              ) || 0
            )
          );
      }

      const len =
        learned.exactLength ||
        learned.minLength ||
        learned.maxLength;

      if (len) {
        value =
          value
            .padEnd(
              len,
              '0'
            )
            .slice(
              0,
              len
            );
      }

      if (
        learned.min !== null &&
        learned.min !== undefined
      ) {
        value =
          String(
            Math.max(
              Number(value) || 1,
              learned.min
            )
          );
      }

      if (
        learned.max !== null &&
        learned.max !== undefined
      ) {
        value =
          String(
            Math.min(
              Number(value) || 1,
              learned.max
            )
          );
      }

      setNativeValue(
        el,
        value
      );

      return true;
    }

    if (learned.alpha) {
      setNativeValue(el, alphaOnly(desiredTextValue(el).value || profile.fullName) || 'Test User');
      return true;
    }

    if (/aadhaar|aadhar/.test(key)) {
      setNativeValue(el, profile.aadhaar);
      return true;
    }

    if (/pan card|pan number|\bpan\b/.test(key)) {
      setNativeValue(el, profile.pan);
      return true;
    }

    if (isSensitive(key)) {
      mark(el, 'manual', 'Sensitive identifier requires manual test value');
      return false;
    }

    if (el.tagName === 'SELECT') {
      const choice = selectPreference(el);
      if (choice.option) { setSelect(el, choice.option, choice.low); return true; }
      return false;
    }

    if (el.type === 'radio' || el.type === 'checkbox') return false;

    if (constraints.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(el.value || ''))) {
      setNativeValue(el, uniqueEmailFor(el));
      return true;
    }

    if (constraints.numeric && !/^[-+]?\d*(?:\.\d+)?$/.test(String(el.value || '').trim())) {
      const desired = desiredTextValue(el);
      setNativeValue(el, adaptToConstraints(el, desired.value || '10'));
      return true;
    }

    if (constraints.alpha && /\d/.test(String(el.value || ''))) {
      const desired = desiredTextValue(el);
      setNativeValue(el, adaptToConstraints(el, alphaOnly(desired.value || profile.fullName)));
      return true;
    }

    if (/email.*unique|email address should be unique|already exists/.test(combined)) {
      setNativeValue(el, uniqueEmailFor(el));
      return true;
    }
    if (/(mobile|phone|contact).*unique|mobile number should be unique/.test(combined)) {
      setNativeValue(el, uniqueMobileFor(el));
      return true;
    }
    if (/only numbers|numbers only|numeric|digits only|only digits|must be a number|integer|whole number/.test(combined)) {
      let value = '10';
      if (/aadhaar|aadhar/.test(key)) value = profile.aadhaar;
      else if (/mobile|phone|contact/.test(key)) value = uniqueMobileFor(el);
      else if (/pin|postal|zip/.test(key)) value = profile.address.pincode;
      else if (/percentage|percent/.test(key)) value = '82';
      else if (/cgpa|gpa/.test(key)) value = '8';
      else if (/year/.test(key)) value = profile.academic.class10.year;
      else {
        const desired =
          desiredTextValue(el);

        value =
          digitsOnly(
            desired.value || ''
          ) ||
          distinctNumericForRepeatedField(
            el,
            10
          );
      }

      if (
        Number(value) === 0
      ) {
        value =
          distinctNumericForRepeatedField(
            el,
            10
          );
      }

      setNativeValue(el, value);
      return true;
    }
    if (/only alphabets|alphabets only|letters only|only letters|characters only|no numbers/.test(combined)) {
      const desired = desiredTextValue(el);
      const value = alphaOnly(desired.value || ( /place|city|district|state/.test(key) ? profile.place : profile.fullName )) || 'Test User';
      setNativeValue(el, value);
      return true;
    }
    if (/invalid email|valid email|email format/.test(combined)) {
      setNativeValue(el, uniqueEmailFor(el));
      return true;
    }
    if (/invalid mobile|invalid phone|10 digit|10-digit|mobile number should|phone number should/.test(combined)) {
      setNativeValue(el, uniqueMobileFor(el));
      return true;
    }
    if (/date|year|yyyy|dd\/mm\/yyyy|mm\/dd\/yyyy/.test(combined)) {
      const desired = desiredTextValue(el);
      if (desired.date) setSmartDate(el, desired.date);
      else if (/year/.test(key)) setNativeValue(el, profile.academic.class10.year);
      else setSmartDate(el, profile.dobISO);
      return true;
    }
    if (/required|cannot be blank|must be filled|field is mandatory/.test(combined) || !fieldHasValue(el)) {
      if (el.tagName === 'SELECT') return fillSelect(el);
      const desired = desiredTextValue(el);
      if (desired.skip) return false;
      if (desired.date) setSmartDate(el, desired.date);
      else if (el.isContentEditable) setContentEditable(el, desired.value);
      else setNativeValue(el, adaptToConstraints(el, desired.value));
      return true;
    }

    const minLenMatch = combined.match(/(?:minimum|min).*?(\d+)\s*(?:characters|digits)/);
    if (minLenMatch) {
      const len = Number(minLenMatch[1]);
      let desired = desiredTextValue(el).value || profile.genericText;
      if (/digit|number|mobile|phone/.test(combined)) desired = digitsOnly(desired).padEnd(len, '0').slice(0, len);
      else desired = String(desired).padEnd(len, 'x');
      setNativeValue(el, desired);
      return true;
    }

    const maxLenMatch = combined.match(/(?:maximum|max).*?(\d+)\s*(?:characters|digits)/);
    if (maxLenMatch) {
      const len = Number(maxLenMatch[1]);
      const current = String(el.value || desiredTextValue(el).value || '');
      setNativeValue(el, current.slice(0, len));
      return true;
    }

    const desired = desiredTextValue(el);
    if (!desired.skip && !fieldHasValue(el)) {
      if (desired.date) setSmartDate(el, desired.date);
      else setNativeValue(el, adaptToConstraints(el, desired.value));
      return true;
    }
    return false;
  };

  const autoRepairValidation = async (maxPasses = 2) => {
    let totalCorrected = 0;

    for (let pass = 0; pass < maxPasses; pass++) {
      validateForm();

      const invalids = [];
      const seen = new Set();

      for (const doc of collectDocuments()) {
        for (const el of allFields(doc)) {
          if (
            isInvalid(el) &&
            el.type !== 'file' &&
            !el.disabled &&
            isVisible(el)
          ) {
            const key = fieldKey(el);

            if (!seen.has(key)) {
              seen.add(key);
              invalids.push(el);
            }
          }
        }

        for (const node of visibleValidationNodes(doc)) {
          const el = nearestFieldForValidationNode(node);

          if (
            el &&
            el.type !== 'file' &&
            !el.disabled &&
            isVisible(el)
          ) {
            const key = fieldKey(el);

            if (!seen.has(key)) {
              seen.add(key);
              invalids.push(el);
            }
          }
        }
      }

      if (!invalids.length) {
        break;
      }

      let correctedThisPass = 0;

      for (const el of invalids) {
        if (state.stopRequested) break;

        const beforeMessage = validationText(el);
        const key = fieldKey(el);
        const attempt = (state.repairAttempts.get(key) || 0) + 1;
        state.repairAttempts.set(key, attempt);

        if (correctFieldFromError(el)) {
          correctedThisPass++;
          totalCorrected++;

          const learned = inferConstraintFromValidation(
            el,
            beforeMessage
          );

          const asyncLikely =
            learned.uniqueMobile ||
            learned.uniqueEmail ||
            /already exists|already registered|unique/.test(beforeMessage);

          await sleep(asyncLikely ? 260 : 35);
        }
      }

      await waitForRelevantChanges(900, 160);
      await sleep(180);
      validateForm();

      if (!correctedThisPass) {
        break;
      }
    }

    validateForm();
    return totalCorrected;
  };


  const fastValidationText = el => {
    try {
      if (el.validationMessage) {
        return normalize(
          el.validationMessage
        );
      }
    } catch {}

    const container =
      el.closest(
        '.form-group,.form-field,.field,.form-item,.control-group,.mb-3,.field-wrapper,.form-control-wrap,td'
      ) ||
      el.parentElement;

    if (!container) {
      return '';
    }

    try {
      const node =
        container.querySelector(
          '.error,.help-block,.invalid-feedback,.field-error,.error-message,.text-danger'
        );

      if (
        node &&
        isVisible(node) &&
        looksLikeValidationErrorText(
          node.innerText ||
            node.textContent
        )
      ) {
        return normalize(
          node.innerText ||
            node.textContent
        );
      }
    } catch {}

    return '';
  };

  const fastValidateForm = () => {
    state.stats.errors.clear();
    state.stats.manual.clear();

    const invalid = [];

    for (const doc of collectDocuments()) {
      for (const el of allFields(doc)) {
        if (
          el.disabled ||
          (
            !isVisible(el) &&
            el.type !== 'file'
          )
        ) {
          continue;
        }

        const key = fieldKey(el);

        if (el.type === 'file') {
          if (
            isRequired(el) &&
            !el.files?.length
          ) {
            mark(
              el,
              'manual',
              'Required file upload needs manual action'
            );
          }
          continue;
        }

        let rejected = false;
        let message = '';

        if (
          isRequired(el) &&
          !fieldHasValue(el)
        ) {
          rejected = true;
          message = 'Required field is empty';
        }

        if (!rejected) {
          try {
            if (
              typeof el.checkValidity ===
                'function' &&
              !el.checkValidity()
            ) {
              rejected = true;
              message =
                el.validationMessage ||
                'Field validation failed';
            }
          } catch {}
        }

        if (
          !rejected &&
          el.getAttribute?.(
            'aria-invalid'
          ) === 'true'
        ) {
          rejected = true;
          message =
            fastValidationText(el) ||
            'Field is marked invalid';
        }

        if (!rejected) {
          const immediate =
            fastValidationText(el);

          if (immediate) {
            rejected = true;
            message = immediate;
          }
        }

        if (rejected) {
          mark(el, 'error', message);
          invalid.push(el);
        } else {
          state.rejected.delete(key);
        }
      }
    }

    updateCounters();
    return invalid;
  };

  const fastBatchCorrection =
    async invalidFields => {
      let corrected = 0;
      const unique = new Map();

      for (const el of invalidFields || []) {
        unique.set(fieldKey(el), el);
      }

      for (const el of unique.values()) {
        if (
          !withinFillBudget(700) ||
          state.stopRequested
        ) {
          break;
        }

        if (correctFieldFromError(el)) {
          corrected++;
        }
      }

      if (corrected) {
        await waitForRelevantChanges(
          Math.min(
            700,
            Math.max(
              100,
              remainingFillBudget() -
                250
            )
          ),
          120
        );
      }

      return corrected;
    };


  const chooseAlternativeSelectOption = (
    select,
    attempt = 0
  ) => {
    const options =
      validOptions(select);

    if (!options.length) {
      rememberPendingSelect(select);
      return false;
    }

    const current =
      String(select.value || '');

    const alternatives =
      options.filter(
        option =>
          String(option.value) !==
          current
      );

    const pool =
      alternatives.length
        ? alternatives
        : options;

    const index =
      Math.min(
        Math.max(attempt, 0),
        pool.length - 1
      );

    const option =
      pool[index] ||
      pool[0];

    if (!option) return false;

    setSelect(
      select,
      option,
      false
    );

    return true;
  };

  const nearbyPrecedingSelects = el => {
    if (!el) return [];

    const docFields =
      allFields(el.ownerDocument);

    const index =
      docFields.indexOf(el);

    if (index < 0) {
      return [];
    }

    const targetSection =
      normalize(
        sectionContext(el)
      );

    return docFields
      .slice(
        Math.max(0, index - 10),
        index
      )
      .filter(
        candidate =>
          candidate.tagName ===
            'SELECT' &&
          isFieldOperationallyVisible(
            candidate
          ) &&
          normalize(
            sectionContext(candidate)
          ) === targetSection
      )
      .reverse();
  };

  const activatePossibleUpstream =
    async target => {
      const upstream =
        nearbyPrecedingSelects(target);

      for (const candidate of upstream) {
        if (
          candidate.disabled
        ) {
          continue;
        }

        if (
          !fieldHasValue(candidate) &&
          validOptions(candidate).length
        ) {
          fillSelect(candidate);

          await resolveAsyncDependencies({
            maxMs: 1800,
            aggressive: true
          });

          return true;
        }
      }

      return false;
    };

  const deepRepairSelectIssue =
    async (
      issue,
      attempt
    ) => {
      let select =
        reacquireField(
          issue.descriptor
        );

      if (!select) {
        return false;
      }

      if (
        fieldHasValue(select) &&
        !isInvalid(select)
      ) {
        return true;
      }

      if (
        select.disabled ||
        !isFieldOperationallyVisible(
          select
        ) ||
        !validOptions(select).length
      ) {
        rememberPendingSelect(select);

        await resolveAsyncDependencies({
          maxMs:
            attempt === 0
              ? 1200
              : 1800,
          aggressive: true,
          noProgressMs: 900,
          focused: [
            issue.descriptor
          ]
        });

        select =
          reacquireField(
            issue.descriptor
          );

        if (
          select &&
          (
            select.disabled ||
            !isFieldOperationallyVisible(
              select
            ) ||
            !validOptions(select).length
          ) &&
          attempt >= 1
        ) {
          await activatePossibleUpstream(
            select
          );

          await resolveAsyncDependencies({
            maxMs: 1200,
            aggressive: true,
            noProgressMs: 800,
            focused: [
              issue.descriptor
            ]
          });

          select =
            reacquireField(
              issue.descriptor
            );
        }
      }

      if (
        !select ||
        select.disabled ||
        !isFieldOperationallyVisible(
          select
        ) ||
        !validOptions(select).length
      ) {
        return false;
      }

      if (
        !fieldHasValue(select)
      ) {
        const choice =
          selectPreference(select);

        if (choice.option) {
          setSelect(
            select,
            choice.option,
            false
          );

          return true;
        }
      }

      if (
        isInvalid(select) ||
        attempt > 0
      ) {
        return (
          chooseAlternativeSelectOption(
            select,
            attempt
          )
        );
      }

      return fieldHasValue(select);
    };

  const alternativeCandidateForField =
    (
      el,
      attempt
    ) => {
      const analysis =
        analyzeField(el, true);

      const constraints = {
        ...analysis.constraints,
        ...runtimeConstraintFor(el)
      };

      const key =
        fieldContext(el);

      if (
        analysis.semantic ===
          'mobile' ||
        /mobile|phone|contact number|contact no/.test(
          key
        )
      ) {
        return uniqueMobileFor(el);
      }

      if (
        analysis.semantic ===
          'email' ||
        /email/.test(key)
      ) {
        return uniqueEmailFor(el);
      }

      if (
        constraints.numeric ||
        /income|marks|score|rank|number|count|months|experience/.test(
          key
        )
      ) {
        const hasMin =
          constraints.min !== null &&
          constraints.min !== undefined &&
          constraints.min !== '' &&
          Number.isFinite(
            Number(
              constraints.min
            )
          );

        const hasMax =
          constraints.max !== null &&
          constraints.max !== undefined &&
          constraints.max !== '' &&
          Number.isFinite(
            Number(
              constraints.max
            )
          );

        const min =
          hasMin
            ? Number(
                constraints.min
              )
            : 1;

        const max =
          hasMax
            ? Number(
                constraints.max
              )
            : 999999;

        const low =
          Math.min(min, max);

        const high =
          Math.max(min, max);

        return String(
          randomInt(
            Math.ceil(low),
            Math.max(
              Math.ceil(low),
              Math.floor(high)
            )
          )
        );
      }

      if (
        constraints.alpha
      ) {
        return [
          'Test Value',
          'Test Sample',
          'Test Applicant'
        ][attempt % 3];
      }

      const generated =
        patternCandidate(
          constraints.pattern,
          `${profile.seed}|${fieldKey(el)}|deep|${attempt}`
        );

      if (generated) {
        return generated;
      }

      return [
        'Test Data',
        'Test Value',
        'Test Sample'
      ][attempt % 3];
    };

  const repairIssueOnce =
    async (
      issue,
      attempt
    ) => {
      let el =
        reacquireField(
          issue.descriptor
        );

      if (
        issue.kind ===
          'manual-file'
      ) {
        return false;
      }

      if (
        issue.kind ===
          'pending-select' ||
        issue.kind ===
          'empty-select' ||
        el?.tagName ===
          'SELECT'
      ) {
        return await deepRepairSelectIssue(
          issue,
          attempt
        );
      }

      if (!el) {
        return false;
      }

      if (
        correctFieldFromError(
          el,
          issue.message || ''
        )
      ) {
        return true;
      }

      el =
        reacquireField(
          issue.descriptor
        );

      if (!el) {
        return false;
      }

      const candidate =
        alternativeCandidateForField(
          el,
          attempt
        );

      if (
        candidate !==
          undefined &&
        candidate !== null
      ) {
        if (
          el.isContentEditable
        ) {
          setContentEditable(
            el,
            String(candidate)
          );
        } else {
          setNativeValue(
            el,
            adaptToConstraints(
              el,
              String(candidate)
            )
          );
        }

        return true;
      }

      return false;
    };

  const deepRepairIssues =
    async ({
      maxAttempts = 3,
      deadlineMs = 22000,
      validateOnly = false
    } = {}) => {
      const started =
        Date.now();

      const absoluteDeadline =
        state.fillDeadline
          ? Math.min(
              started + deadlineMs,
              state.fillDeadline
            )
          : started + deadlineMs;

      let totalCorrected = 0;

      await yieldToUI();

      let issues =
        diagnoseFormIssues({
          deepText: true
        });

      await yieldToUI();

      let previousCount =
        issues.size;

      let previousFingerprint =
        diagnosticFingerprint(
          issues
        );

      for (
        let attempt = 0;
        attempt < maxAttempts;
        attempt++
      ) {
        if (
          state.stopRequested ||
          Date.now() >=
            absoluteDeadline
        ) {
          break;
        }

        const repairable =
          [
            ...issues.values()
          ].filter(
            issue =>
              issue.repairable
          );

        if (!repairable.length) {
          break;
        }

        setProgress(
          28 +
            Math.round(
              (
                attempt /
                Math.max(
                  maxAttempts,
                  1
                )
              ) *
                52
            ),
          validateOnly
            ? `Deep validation: ${repairable.length} unresolved field(s), pass ${attempt + 1}...`
            : `Deep repair: ${repairable.length} unresolved field(s), pass ${attempt + 1}...`
        );

        // Let Stop clicks, progress paint, scrolling, and browser input run
        // before entering the next repair pass.
        await yieldToUI();

        if (
          state.stopRequested
        ) {
          break;
        }

        let changedThisPass = 0;

        for (
          const issue
          of repairable
        ) {
          if (
            state.stopRequested ||
            Date.now() >=
              absoluteDeadline
          ) {
            break;
          }

          const issueStarted =
            Date.now();

          const repaired =
            await repairIssueOnce(
              issue,
              attempt
            );

          if (repaired) {
            changedThisPass++;
            totalCorrected++;
          }

          // Yield between issue repairs. On large forms this makes the Stop
          // button and the rest of the page remain responsive.
          await yieldToUI();

          if (
            state.stopRequested
          ) {
            break;
          }

          // No single field is allowed to monopolize the run.
          if (
            Date.now() -
              issueStarted >
              3500
          ) {
            continue;
          }
        }

        if (
          Date.now() <
            absoluteDeadline
        ) {
          await resolveAsyncDependencies({
            maxMs:
              attempt === 0
                ? 1200
                : 1700,
            aggressive: true,
            noProgressMs:
              DEEP_NO_PROGRESS_MS
          });
        }

        const fresh =
          changedOrNewFields();

        if (
          fresh.length &&
          Date.now() <
            absoluteDeadline
        ) {
          fillStaticBatch(fresh);
          fillReadySelectsQuick(
            fresh
          );

          const otherDynamic =
            fresh.filter(
              el =>
                isDynamicField(el) &&
                el.tagName !==
                  'SELECT'
            );

          if (otherDynamic.length) {
            await fillDynamicBatch(
              otherDynamic
            );
          }
        }

        await sleep(
          attempt === 0
            ? 120
            : 220
        );

        await yieldToUI();

        issues =
          diagnoseFormIssues({
            deepText:
              attempt === 0 ||
              changedThisPass > 0
          });

        await yieldToUI();

        const currentCount =
          issues.size;

        const currentFingerprint =
          diagnosticFingerprint(
            issues
          );

        if (
          currentCount === 0
        ) {
          break;
        }

        // If neither the issue count nor the actual field/error state changed,
        // deeper waiting is unlikely to help.
        if (
          !changedThisPass &&
          currentCount >=
            previousCount &&
          currentFingerprint ===
            previousFingerprint
        ) {
          break;
        }

        previousCount =
          currentCount;
        previousFingerprint =
          currentFingerprint;
      }

      return {
        corrected:
          totalCorrected,
        issues:
          diagnoseFormIssues({
            deepText:
              !state.stopRequested
          })
      };
    };

  const deepValidateAndAssist =
    async () => {
      if (state.running) return;

      state.running = true;
      state.stopRequested = false;
      state.startTime =
        Date.now();
      state.fillDeadline =
        Date.now() +
        VALIDATE_HARD_LIMIT_MS;

      state.panel?.setBusy(
        true,
        'correct'
      );

      startElapsedTimer();

      clearTimeout(
        state.liveTimer
      );

      try {
        setProgress(
          5,
          'Validate: quickly checking missed fields...'
        );

        await yieldToUI();

        if (
          state.stopRequested
        ) {
          return;
        }

        buildFormModel(true);

        await yieldToUI();

        const quick =
          await quickMissedFieldSweep({
            maxMs: 2200
          });

        setProgress(
          35,
          `Validate: quick recovery complete${quick.progress ? ` • ${quick.progress} action(s)` : ''}. Checking errors...`
        );

        let issues =
          diagnoseFormIssues({
            deepText: true
          });

        const firstSummary =
          issueSummary(issues);

        if (
          firstSummary.repairable &&
          Date.now() <
            state.fillDeadline -
              900
        ) {
          setProgress(
            50,
            `Validate: ${firstSummary.repairable} issue(s) still repairable. Trying one targeted pass...`
          );

          const remainingMs =
            Math.max(
              1200,
              state.fillDeadline -
                Date.now() -
                350
            );

          const result =
            await deepRepairIssues({
              maxAttempts: 1,
              deadlineMs:
                Math.min(
                  6500,
                  remainingMs
                ),
              validateOnly: true
            });

          issues =
            result.issues;
        }

        const summary =
          issueSummary(issues);

        const elapsed =
          (
            (
              Date.now() -
              state.startTime
            ) /
            1000
          ).toFixed(1);

        setProgress(
          100,
          summary.total
            ? `Validate finished in ${elapsed}s. ${summary.total} issue(s) remain.`
            : `Validate finished in ${elapsed}s. No unresolved automated issues found.`
        );

        state.panel?.setStatus(
          summary.total
            ? `Validate • ${summary.repairable} repairable • ${summary.pending} dependency • ${summary.validation} validation • ${summary.manual} manual`
            : 'Validate passed. Current automated fields are accepted.'
        );
      } catch (error) {
        const message =
          recordRuntimeError(
            'Validate',
            error
          );

        setProgress(
          100,
          `Validate stopped safely: ${message}`
        );

        state.panel?.setStatus(
          `Validate runtime error: ${message}`
        );
      } finally {
        state.running = false;
        state.panel?.setBusy(
          false
        );
        stopElapsedTimer();
      }
    };

  const recheckAndCorrect = async () => {
    if (state.running) return;

    state.running = true;
    state.stopRequested = false;
    state.startTime =
      Date.now();
    state.fillDeadline =
      Date.now() +
      RECHECK_HARD_LIMIT_MS;

    state.panel?.setBusy(
      true,
      'correct'
    );

    startElapsedTimer();

    clearTimeout(
      state.liveTimer
    );

    try {
      setProgress(
        4,
        'Recheck: quickly retrying missed fields...'
      );

      // Paint the Stop control before any form-wide analysis starts.
      await yieldToUI();

      if (
        state.stopRequested
      ) {
        return;
      }

      buildFormModel(true);

      await yieldToUI();

      const quick =
        await quickMissedFieldSweep({
          maxMs: 3000
        });

      setProgress(
        25,
        `Recheck: quick retry complete${quick.progress ? ` • ${quick.progress} action(s)` : ''}. Diagnosing leftovers...`
      );

      await yieldToUI();

      if (
        state.stopRequested
      ) {
        return;
      }

      let before =
        diagnoseFormIssues({
          deepText: true
        });

      await yieldToUI();

      const beforeSummary =
        issueSummary(before);

      if (!before.size) {
        const elapsed =
          (
            (
              Date.now() -
              state.startTime
            ) /
            1000
          ).toFixed(1);

        setProgress(
          100,
          `Recheck finished in ${elapsed}s. No unresolved issues found.`
        );

        state.panel?.setStatus(
          'Recheck completed. All automated fields currently look accepted.'
        );

        return;
      }

      setProgress(
        35,
        `Recheck: ${beforeSummary.repairable} repairable issue(s) remain. Escalating only those fields...`
      );

      const remainingMs =
        Math.max(
          2500,
          state.fillDeadline -
            Date.now() -
            400
        );

      const result =
        await deepRepairIssues({
          maxAttempts: 3,
          deadlineMs:
            Math.min(
              25000,
              remainingMs
            ),
          validateOnly: false
        });

      closeAllDateWidgets();

      const remaining =
        result.issues;

      const summary =
        issueSummary(remaining);

      const solved =
        Math.max(
          0,
          beforeSummary.total -
            summary.total
        );

      const elapsed =
        (
          (
            Date.now() -
            state.startTime
          ) /
          1000
        ).toFixed(1);

      const hitLimit =
        Date.now() >=
        state.fillDeadline -
          200;

      setProgress(
        100,
        summary.total
          ? hitLimit
            ? `Recheck stopped at the time limit (${elapsed}s). ${summary.total} issue(s) remain.`
            : `Recheck finished in ${elapsed}s. ${summary.total} issue(s) remain.`
          : `Recheck finished in ${elapsed}s. All automated issues cleared.`
      );

      state.panel?.setStatus(
        `Recheck • Solved: ${solved} • Actions: ${result.corrected} • Remaining: ${summary.total} • Manual: ${summary.manual}`
      );
    } catch (error) {
      const message =
        recordRuntimeError(
          'Recheck & Correct',
          error
        );

      setProgress(
        100,
        `Recheck stopped safely: ${message}`
      );

      state.panel?.setStatus(
        `Recheck runtime error: ${message}`
      );
    } finally {
      state.running = false;
      state.panel?.setBusy(false);
      stopElapsedTimer();
    }
  };

  const fillForm = async (
    mode,
    options = {}
  ) => {
    if (state.running) return;

    const resumed = !!options.resumed;

    state.running = true;
    state.stopRequested = false;
    state.pageUnloading = false;
    state.mode = mode;
    state.startTime =
      Date.now();
    state.fillDeadline =
      Date.now() +
      MAX_FILL_BUDGET_MS;

    if (!resumed) {
      state.debugEvents = [];
      state.lastProgressText = '';
      state.lastRuntimeError = null;
      state.committedRadioGroups.clear();
      debugEvent('fill-start', { mode });

      state.snapshots.clear();
      state.lastScriptValues.clear();

      state.stats.filled.clear();
      state.stats.preserved.clear();
      state.stats.review.clear();
      state.stats.errors.clear();
      state.stats.manual.clear();

      state.accepted.clear();
      state.rejected.clear();
      state.pending.clear();
      state.generatedValues.clear();
      state.usedMobiles.clear();
      state.usedEmails.clear();
      state.dependencyGraph.clear();
      state.pendingDescriptors.clear();
      state.diagnostics.clear();
      state.deepRepairHistory.clear();
    }

    state.knownFieldKeys.clear();
    state.formModel.clear();
    state.runtimeConstraints.clear();
    state.repairAttempts.clear();

    resetMarks();

    startRunSession(
      mode,
      resumed
    );

    state.panel?.setBusy(
      true,
      'fill'
    );
    state.panel?.setMode(mode);
    startElapsedTimer();

    try {
      setProgress(
        3,
        resumed
          ? 'Resuming Turbo Fill after page reload...'
          : 'Starting fast fill...'
      );

      state.techCache =
        loadTechCache();

      prepareFormTechnicalCache();

      let fields =
        visibleFillableFields();

      setProgress(
        7,
        `Analyzing ${fields.length} field(s)...`
      );

      const analyzed =
        buildFormModel(false);

      fields.forEach(el =>
        state.knownFieldKeys.add(
          fieldKey(el)
        )
      );

      syncProfileFromExistingApplicant();
      buildAcademicPlan(fields);

      fields.forEach(el => {
        if (
          isFieldOperationallyVisible(
            el
          ) &&
          fieldHasValue(el)
        ) {
          countPreserved(el);
        }
      });

      updateCounters();

      if (
        !withinFillBudget(1600) ||
        state.stopRequested
      ) {
        throw new Error(
          'Turbo time budget reached during analysis'
        );
      }

      // FAST PASS: do not wait for dependencies yet.
      setProgress(
        15,
        'Fast pass: filling easy fields...'
      );

      const staticChanged =
        fillStaticBatch(fields);

      setProgress(
        38,
        `Fast pass: filling ready dropdowns...`
      );

      const readySelects =
        fillReadySelectsQuick(
          fields
        );

      // Rebuild the academic plan after dropdown choices such as Degree /
      // Qualification have been selected. This keeps the V17 academic
      // chronology logic, but does not block the fast initial pass.
      try {
        buildAcademicPlan(
          visibleFillableFields()
        );
      } catch (error) {
        debugEvent(
          'academic-plan-refresh-error',
          {
            message:
              String(
                error?.message ||
                error
              )
          }
        );
      }

      // Country uses the first valid option by selectPreference.
      // Every other dropdown keeps the normal semantic strategy.

      const nonSelectDynamic =
        fields.filter(
          el =>
            isDynamicField(el) &&
            el.tagName !==
              'SELECT'
        );

      setProgress(
        52,
        `Fast pass: processing ${nonSelectDynamic.length} date/radio/custom control(s)...`
      );

      await fillDynamicBatch(
        nonSelectDynamic
      );

      if (
        state.pageUnloading
      ) {
        return;
      }

      if (
        !withinFillBudget(2500) ||
        state.stopRequested
      ) {
        setProgress(
          100,
          'Fast fill completed. Time limit reached before missed-field sweep.'
        );
        return;
      }

      // MISSED-FIELD SWEEP:
      // briefly revisit async dropdowns/new fields, but stop on no progress.
      setProgress(
        64,
        'Checking fields that were missed or loaded late...'
      );

      const sweep =
        await quickMissedFieldSweep({
          maxMs: 2600
        });

      if (
        !withinFillBudget(1500) ||
        state.stopRequested
      ) {
        const elapsed =
          (
            (
              Date.now() -
              state.startTime
            ) /
            1000
          ).toFixed(1);

        setProgress(
          100,
          `Fast fill stopped safely in ${elapsed}s. Use Recheck & Correct for leftovers.`
        );

        validateForm();
        return;
      }

      setProgress(
        82,
        'Running quick validation...'
      );

      let invalid =
        fastValidateForm();

      let autoCorrected = 0;

      if (
        invalid.length &&
        withinFillBudget(800)
      ) {
        setProgress(
          89,
          `Quickly correcting ${invalid.length} rejected field(s)...`
        );

        autoCorrected =
          await fastBatchCorrection(
            invalid
          );

        invalid =
          fastValidateForm();
      }

      // One lightweight deep scan catches plain-text/relational messages,
      // but it is not allowed to hold the initial fill hostage.
      if (
        withinFillBudget(700) &&
        !state.stopRequested
      ) {
        validateForm();
      }

      closeAllDateWidgets();
      setTimeout(
        closeAllDateWidgets,
        220
      );

      for (const doc of collectDocuments()) {
        for (const el of allFields(doc)) {
          const key =
            fieldKey(el);

          if (
            state.stats.errors.has(
              key
            )
          ) {
            state.rejected.add(
              key
            );
            state.accepted.delete(
              key
            );
            continue;
          }

          if (
            state.stats.manual.has(
              key
            )
          ) {
            continue;
          }

          if (
            fieldHasValue(el) ||
            el.type ===
              'checkbox' ||
            el.type ===
              'radio'
          ) {
            state.accepted.add(
              key
            );
          }
        }
      }

      saveTechCache();

      const errors =
        state.stats.errors.size;

      const manual =
        state.stats.manual.size;

      const pending =
        state.pendingDescriptors.size;

      const elapsed =
        (
          (
            Date.now() -
            state.startTime
          ) /
          1000
        ).toFixed(1);

      setProgress(
        100,
        errors || pending
          ? `Fast fill finished in ${elapsed}s • ${errors} error(s) • ${pending} pending • ${manual} manual`
          : manual
            ? `Fast fill finished in ${elapsed}s • ${manual} manual action(s)`
            : `Fast fill finished in ${elapsed}s • form fill completed`
      );

      state.panel?.setStatus(
        `Fast Fill • Static: ${staticChanged} • Dropdowns: ${readySelects} • Missed-field actions: ${sweep.progress} • Auto-corrected: ${autoCorrected} • Errors: ${errors} • Pending: ${pending}`
      );
    } catch (error) {
      const message =
        recordRuntimeError(
          'Fill Form',
          error
        );

      state.panel?.setStatus(
        `Fast Fill stopped: ${message}`
      );

      setProgress(
        100,
        `Stopped safely: ${message}`
      );
    } finally {
      saveTechCache();

      state.running = false;
      state.panel?.setBusy(false);
      stopElapsedTimer();

      if (!state.pageUnloading) {
        clearRunSession();
      }
    }
  };

  const undo = () => {
    let restored = 0;
    for (const [key, snap] of state.snapshots.entries()) {
      let el = snap.element;
      if (!el?.isConnected) {
        el = collectDocuments().flatMap(allFields).find(x => fieldKey(x) === key);
      }
      if (!el) continue;
      const expected = state.lastScriptValues.get(key);
      if (expected && !sameState(currentState(el), expected)) continue;
      const before = snap.before;
      if (before.kind === 'checked') {
        el.checked = before.value;
        eventBurst(el);
      } else if (before.kind === 'text') {
        el.textContent = before.value;
        eventBurst(el);
      } else {
        el.value = before.value;
        eventBurst(el);
        if (el.tagName === 'SELECT') triggerSelect(el);
      }
      clearMark(el, REVIEW_ATTR);
      clearMark(el, ERROR_ATTR);
      clearMark(el, MANUAL_ATTR);
      const target = visualTarget(el);
      target?.removeAttribute(FILLED_ATTR);
      target?.removeAttribute(PRESERVED_ATTR);
      restored++;
    }
    state.snapshots.clear();
    state.lastScriptValues.clear();
    state.stats.filled.clear();
    state.stats.review.clear();
    state.stats.errors.clear();
    state.stats.manual.clear();
    state.panel?.setStatus(`Undo complete. Restored ${restored} field(s).`);
    updateCounters();
    setProgress(0, 'Ready');
  };

  const newApplicant = () => {
    profile = normalizeProfileTestNames(createProfile());
    saveProfile();
    state.snapshots.clear();
    state.lastScriptValues.clear();
    state.stats.filled.clear();
    state.stats.preserved.clear();
    state.stats.review.clear();
    state.stats.errors.clear();
    state.stats.manual.clear();
    state.formModel.clear();
    resetMarks();
    state.panel?.refreshProfile();
    state.panel?.setStatus(`New applicant created: ${profile.fullName}`);
    updateCounters();
    setProgress(0, 'Ready');
  };

  const setProgress = (percent, text) => {
    state.panel?.setProgress(percent, text);

    if (
      text &&
      text !== state.lastProgressText
    ) {
      state.lastProgressText = text;
      debugEvent('phase', {
        percent,
        text
      });
    }
  };

  const updateCounters = () => {
    state.panel?.setCounters({
      filled: state.stats.filled.size,
      preserved: state.stats.preserved.size,
      review: state.stats.review.size,
      errors: state.stats.errors.size,
      manual: state.stats.manual.size
    });
  };


  const statSet = type => {
    if (type === 'filled') return state.stats.filled;
    if (type === 'preserved') return state.stats.preserved;
    if (type === 'review') return state.stats.review;
    if (type === 'errors') return state.stats.errors;
    if (type === 'manual') return state.stats.manual;
    return new Set();
  };

  const statTargets = type => {
    const keys =
      statSet(type);

    const seen =
      new Set();

    const items = [];

    const unresolved =
      [];

    for (const key of keys) {
      let el =
        state.formModel.get(
          key
        )?.element ||
        state.snapshots.get(
          key
        )?.element ||
        null;

      if (
        !el ||
        !el.isConnected
      ) {
        unresolved.push(key);
        continue;
      }

      if (
        !isFieldOperationallyVisible(
          el
        )
      ) {
        continue;
      }

      const target =
        visualTarget(el);

      if (
        !target ||
        seen.has(target)
      ) {
        continue;
      }

      seen.add(target);

      items.push({
        el,
        target,
        key
      });
    }

    // Rare stale-DOM fallback: one scan only when a cached element was
    // actually replaced by the site.
    if (unresolved.length) {
      const needed =
        new Set(
          unresolved
        );

      for (const doc of collectDocuments()) {
        for (const el of allFields(doc)) {
          const key =
            fieldKey(el);

          if (
            !needed.has(key) ||
            !isFieldOperationallyVisible(
              el
            )
          ) {
            continue;
          }

          const target =
            visualTarget(el);

          if (
            !target ||
            seen.has(target)
          ) {
            continue;
          }

          state.formModel.set(
            key,
            {
              ...(
                state.formModel.get(
                  key
                ) || {}
              ),
              element: el
            }
          );

          seen.add(target);

          items.push({
            el,
            target,
            key
          });
        }
      }
    }

    return items;
  };

  const flashTarget = target => {
    if (!target) return;

    const oldTransition = target.style.transition;
    const oldBoxShadow = target.style.boxShadow;

    target.style.transition = 'box-shadow .18s ease';
    target.style.boxShadow = '0 0 0 6px rgba(124,58,237,.20)';

    setTimeout(() => {
      target.style.boxShadow = oldBoxShadow;
      target.style.transition = oldTransition;
    }, 1200);
  };

  const navigateStat = type => {
    const items = statTargets(type);

    if (!items.length) {
      state.panel?.setStatus(`No ${type === 'preserved' ? 'already-filled' : type} fields currently need navigation.`);
      updateCounters();
      return;
    }

    const current = state.navIndex[type] || 0;
    const index = current % items.length;
    state.navIndex[type] = (index + 1) % items.length;

    const { el, target } = items[index];

    try {
      target.scrollIntoView({
        behavior: 'auto',
        block: 'center',
        inline: 'nearest'
      });
    } catch {
      target.scrollIntoView();
    }

    setTimeout(() => {
      try { el.focus({ preventScroll: true }); } catch {}
      flashTarget(target);
    }, 80);

    const label = directFieldContext(el).replace(/\s+/g, ' ').trim();
    const reason =
      target.getAttribute(ERROR_ATTR) ||
      target.getAttribute(MANUAL_ATTR) ||
      target.getAttribute(REVIEW_ATTR) ||
      '';

    state.panel?.setStatus(
      `${type === 'preserved' ? 'Already Filled' : type.charAt(0).toUpperCase() + type.slice(1)} ${index + 1} of ${items.length}${label ? ` • ${label.slice(0, 70)}` : ''}${reason ? ` • ${reason.slice(0, 90)}` : ''}`
    );
  };

  const scheduleLiveValidation = () => {
    if (state.running) return;

    clearTimeout(state.liveTimer);

    state.liveTimer = setTimeout(() => {
      if (state.running) return;
      validateForm({
        deepText: false
      });
      updateCounters();
    }, 700);
  };

  const installLiveValidation = () => {
    if (state.liveWatchInstalled) return;
    state.liveWatchInstalled = true;

    const getEditedField = event =>
      event.target?.closest?.(
        'input,select,textarea,[contenteditable="true"]'
      ) || null;

    const lightweightUserEdit = event => {
      if (
        state.running ||
        !event.isTrusted
      ) {
        return;
      }

      const el =
        getEditedField(event);

      if (!el) return;

      const key =
        fieldKey(el);

      // Local-only update while typing. Do not rescan the whole form.
      if (fieldHasValue(el)) {
        clearMark(
          el,
          REVIEW_ATTR
        );

        state.stats.review.delete(
          key
        );

        try {
          if (
            typeof el.checkValidity === 'function' &&
            el.checkValidity() &&
            el.getAttribute('aria-invalid') !== 'true'
          ) {
            clearMark(
              el,
              ERROR_ATTR
            );

            state.stats.errors.delete(
              key
            );
          }
        } catch {}

        updateCounters();
      }
    };

    const committedUserEdit = event => {
      if (
        state.running ||
        !event.isTrusted
      ) {
        return;
      }

      const el =
        getEditedField(event);

      if (el) {
        lightweightUserEdit(event);

        if (
          isPersonNameField(el) &&
          fieldHasValue(el)
        ) {
          const current =
            el.isContentEditable
              ? String(el.textContent || '').trim()
              : String(el.value || '').trim();

          const corrected =
            prefixTestName(current);

          if (corrected !== current) {
            if (el.isContentEditable) {
              setContentEditable(
                el,
                corrected
              );
            } else {
              setNativeValue(
                el,
                adaptToConstraints(
                  el,
                  corrected
                )
              );
            }
          }
        }
      }

      // One debounced full check only after change/blur.
      scheduleLiveValidation();
    };

    document.addEventListener(
      'input',
      lightweightUserEdit,
      true
    );

    document.addEventListener(
      'change',
      committedUserEdit,
      true
    );

    document.addEventListener(
      'blur',
      committedUserEdit,
      true
    );

    // No always-running MutationObserver.
    state.liveObserver = null;
  };

  const startElapsedTimer = () => {
    stopElapsedTimer();
    state.timerId = setInterval(() => {
      const seconds = ((Date.now() - state.startTime) / 1000).toFixed(1);
      state.panel?.setElapsed(`${seconds}s`);
    }, 400);
  };

  const stopElapsedTimer = () => {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  };

  const showModeDialog = () => state.panel?.showModeDialog();


  const safeDebugValue = el => {
    if (!el) return null;

    const key =
      fieldKey(el);

    const scriptState =
      state.lastScriptValues.get(
        key
      );

    if (
      scriptState !== undefined &&
      scriptState !== null
    ) {
      let value = '';

      if (
        typeof scriptState === 'object' &&
        scriptState &&
        'value' in scriptState
      ) {
        value =
          String(
            scriptState.value ??
            ''
          );
      } else {
        value =
          String(
            scriptState
          );
      }

      if (
        el.tagName === 'SELECT'
      ) {
        value =
          String(
            el.selectedOptions?.[0]
              ?.textContent ||
            el.value ||
            value
          ).trim();
      }

      return {
        source: 'script',
        value:
          value.slice(
            0,
            160
          )
      };
    }

    const current =
      el.tagName === 'SELECT'
        ? String(
            el.selectedOptions?.[0]
              ?.textContent ||
            el.value ||
            ''
          ).trim()
        : el.type === 'radio'
          ? (
              radioGroupMembers(
                el
              ).find(
                item =>
                  item.checked
              )?.value ||
              ''
            )
          : String(
              el.isContentEditable
                ? el.textContent || ''
                : el.value || ''
            );

    return {
      source:
        current
          ? 'preserved-or-user'
          : 'empty',
      length:
        current.length,
      value:
        current &&
        current.length <= 2
          ? current
          : current
            ? '[redacted]'
            : ''
    };
  };

  const debugFieldSnapshot = el => {
    if (!el) return null;

    let analysis = null;

    try {
      analysis = analyzeField(
        el,
        true
      );
    } catch {}

    let descriptor = null;

    try {
      descriptor =
        fieldDescriptor(el);
    } catch {}

    const optionCount =
      el.tagName === 'SELECT'
        ? validOptions(el).length
        : null;

    let selectedText = null;

    if (el.tagName === 'SELECT') {
      try {
        selectedText =
          el.selectedOptions?.[0]
            ?.textContent?.trim() ||
          null;
      } catch {}
    }

    return {
      descriptor,
      label:
        normalize(
          directFieldContext(el)
        ).slice(0, 220),
      question:
        normalize(
          questionContext(el)
        ).slice(0, 180),
      rowContext:
        normalize(
          tableRowLabelContext(
            el
          )
        ).slice(0, 140),
      rowOrdinal:
        repeatingRowOrdinal(
          el
        ),
      academicRowLevel:
        academicLevelFromRowLabel(
          tableRowLabelContext(
            el
          )
        ),
      academicHeading:
        normalize(
          nearestAcademicHeadingContext(
            el
          )
        ).slice(0, 180),
      academicLevel:
        academicLevelForField(
          el
        ),
      academicSafeYear:
        academicLevelForField(
          el
        )
          ? safeAcademicYearForLevel(
              academicLevelForField(
                el
              )
            )
          : null,
      section:
        normalize(
          sectionContext(el)
        ).slice(0, 180),
      formHeading:
        normalize(
          formHeadingContext(el)
        ).slice(0, 180),
      column:
        normalize(
          tableHeaderContext(el)
        ).slice(0, 140),
      tag:
        normalize(el.tagName),
      type:
        normalize(el.type),
      required:
        isRequired(el),
      disabled:
        !!el.disabled,
      visible:
        isFieldOperationallyVisible(
          el
        ),
      semantic:
        analysis?.semantic ||
        'unknown',
      confidence:
        analysis?.confidence ||
        'unknown',
      adapter:
        analysis?.adapter ||
        detectControlAdapter(el),
      risk:
        analysis?.risk ||
        'unknown',
      reasons:
        (analysis?.reasons || [])
          .slice(0, 8),
      optionCount,
      selectedText,
      value:
        safeDebugValue(el),
      validation:
        validationText(el),
      htmlConstraints: {
        pattern:
          el.getAttribute?.(
            'pattern'
          ) || '',
        inputmode:
          el.getAttribute?.(
            'inputmode'
          ) || '',
        autocomplete:
          el.getAttribute?.(
            'autocomplete'
          ) || '',
        min:
          el.getAttribute?.('min') ||
          '',
        max:
          el.getAttribute?.('max') ||
          '',
        minlength:
          el.getAttribute?.(
            'minlength'
          ) || '',
        maxlength:
          el.getAttribute?.(
            'maxlength'
          ) || ''
      },
      learnedConstraints:
        runtimeConstraintFor(el)
    };
  };


  const debugDomSummary = () => {
    let detected = 0;
    let operational = 0;
    let withValue = 0;
    let rawEmptyRequired = 0;
    let activeEmptyRequired = 0;
    let activeRequiredFilesMissing = 0;
    let selects = 0;
    let files = 0;

    const seenRadioGroups =
      new Set();

    for (const doc of collectDocuments()) {
      for (const el of allFields(doc)) {
        detected++;

        const operationalNow =
          isFieldOperationallyVisible(
            el
          ) &&
          !el.disabled &&
          !isLikelyInternalField(
            el
          );

        if (operationalNow) {
          operational++;
        }

        if (fieldHasValue(el)) {
          withValue++;
        }

        if (
          isRequired(el) &&
          !fieldHasValue(el)
        ) {
          rawEmptyRequired++;

          let representative =
            true;

          if (
            el.type === 'radio'
          ) {
            const groupKey =
              `${el.ownerDocument.URL}|${el.name || fieldKey(el)}`;

            if (
              seenRadioGroups.has(
                groupKey
              )
            ) {
              representative =
                false;
            } else {
              seenRadioGroups.add(
                groupKey
              );
            }
          }

          if (
            operationalNow &&
            representative
          ) {
            if (
              el.type === 'file'
            ) {
              activeRequiredFilesMissing++;
            } else {
              activeEmptyRequired++;
            }
          }
        }

        if (el.tagName === 'SELECT') {
          selects++;
        }

        if (el.type === 'file') {
          files++;
        }
      }
    }

    return {
      detected,
      operational,
      withValue,

      // Kept for compatibility; now reflects genuinely active, non-file
      // required controls rather than hidden/template DOM fields.
      emptyRequired:
        activeEmptyRequired,

      rawEmptyRequired,
      activeEmptyRequired,
      activeRequiredFilesMissing,
      selects,
      files
    };
  };

  const buildDebugReport = () => {
    let issues =
      new Map();

    try {
      issues =
        diagnoseFormIssues();
    } catch {}

    const issueRows = [];

    for (const issue of issues.values()) {
      const el =
        reacquireField(
          issue.descriptor
        );

      issueRows.push({
        kind: issue.kind,
        message:
          issue.message || '',
        repairable:
          !!issue.repairable,
        field:
          debugFieldSnapshot(el) || {
            descriptor:
              issue.descriptor
          }
      });
    }

    const pendingRows = [];

    for (
      const descriptor
      of state.pendingDescriptors.values()
    ) {
      const el =
        reacquireField(descriptor);

      pendingRows.push({
        reason:
          el
            ? pendingSelectReason(el)
            : 'field-not-found',
        field:
          debugFieldSnapshot(el) || {
            descriptor
          }
      });
    }

    const stats = {
      filled:
        state.stats.filled.size,
      preserved:
        state.stats.preserved.size,
      review:
        state.stats.review.size,
      errors:
        state.stats.errors.size,
      manual:
        state.stats.manual.size,
      accepted:
        state.accepted.size,
      rejected:
        state.rejected.size,
      pending:
        state.pendingDescriptors.size
    };

    const page = {
      title:
        document.title || '',
      hostname:
        location.hostname,
      pathname:
        location.pathname
    };

    const report = {
      reportVersion: 1,
      generatedBy:
        'Smart FormSense V17.11',
      generatedAt:
        new Date().toISOString(),
      mode:
        state.mode || 'unknown',
      elapsedSeconds:
        state.startTime
          ? Number(
              (
                (
                  Date.now() -
                  state.startTime
                ) /
                1000
              ).toFixed(2)
            )
          : null,
      page,
      formSignature:
        state.currentFormSignature ||
        null,
      profile: {
        id:
          profile?.id || null,
        seed:
          profile?.seed || null
      },
      stats,
      domSummary:
        debugDomSummary(),
      academicPlan:
        state.academicPlan,
      lastRuntimeError:
        state.lastRuntimeError,
      recentEvents:
        state.debugEvents.slice(-180),
      dependencyGraph:
        [
          ...state.dependencyGraph
            .entries()
        ].map(
          ([child, parent]) => ({
            parent,
            child
          })
        ),
      issues: issueRows,
      pendingFields:
        pendingRows,
      notes: [
        'Preserved/user-entered values are redacted by default.',
        'Values written by the script may be included because they are synthetic test data.',
        'This report is intended for troubleshooting form detection, validation, dependency and control-adapter behavior.'
      ]
    };

    return report;
  };

  const downloadTextFile = (
    filename,
    text,
    mime =
      'application/json;charset=utf-8'
  ) => {
    const blob =
      new Blob(
        [text],
        {
          type: mime
        }
      );

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement('a');

    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(
      () =>
        URL.revokeObjectURL(url),
      1500
    );
  };

  const exportDebugReport = () => {
    try {
      const report =
        buildDebugReport();

      const stamp =
        new Date()
          .toISOString()
          .replace(
            /[:.]/g,
            '-'
          )
          .slice(0, 19);

      const host =
        String(
          location.hostname ||
          'form'
        )
          .replace(
            /[^a-z0-9.-]+/gi,
            '_'
          )
          .slice(0, 60);

      const filename =
        `Smart_FormSense_V17_11_1_Debug_${host}_${stamp}.json`;

      downloadTextFile(
        filename,
        JSON.stringify(
          report,
          null,
          2
        )
      );

      state.panel?.setStatus(
        `Debug report exported: ${report.issues.length} issue(s), ${report.pendingFields.length} pending field(s).`
      );

      return report;
    } catch (error) {
      console.error(
        'Smart FormSense V17.11.2 debug export:',
        error
      );

      state.panel?.setStatus(
        `Debug export failed: ${error?.message || 'unknown error'}`
      );

      return null;
    }
  };


  // ==========================================================
  // Smart FormSense QA audit
  // ==========================================================
  const qaRequiredSignals = el => {
    if (!el) {
      return {
        native: false,
        aria: false,
        customAttribute: false,
        customClass: false,
        configured: false,
        visible: false,
        sources: []
      };
    }

    const inspectOne = item => {
      const sources = [];
      const native = !!item.required;
      const aria = item.getAttribute?.('aria-required') === 'true';

      if (native) sources.push('native required');
      if (aria) sources.push('aria-required');

      const customAttributes = [
        'data-rule-required',
        'data-val-required',
        'data-parsley-required',
        'data-required',
        'data-validation-required',
        'ng-required',
        'x-required'
      ];

      let customAttribute = false;

      for (const name of customAttributes) {
        const raw = item.getAttribute?.(name);

        if (
          raw !== null &&
          !/^(?:false|0|no|off)$/i.test(String(raw).trim())
        ) {
          customAttribute = true;
          sources.push(name);
        }
      }

      const validateRaw =
        item.getAttribute?.('data-validate') ||
        item.getAttribute?.('v-validate') ||
        '';

      if (
        validateRaw &&
        /\brequired\b/i.test(String(validateRaw))
      ) {
        customAttribute = true;
        sources.push(
          item.hasAttribute?.('v-validate')
            ? 'v-validate'
            : 'data-validate'
        );
      }

      const customClass = !!(
        item.classList?.contains('required') ||
        item.classList?.contains('mandatory') ||
        item.classList?.contains('validate-required')
      );

      if (customClass) {
        sources.push('required class');
      }

      return {
        native,
        aria,
        customAttribute,
        customClass,
        configured:
          native ||
          aria ||
          customAttribute ||
          customClass,
        sources
      };
    };

    let combined = inspectOne(el);

    if (el.type === 'radio') {
      const members = radioGroupMembers(el);

      for (const item of members) {
        const next = inspectOne(item);

        combined = {
          native:
            combined.native ||
            next.native,
          aria:
            combined.aria ||
            next.aria,
          customAttribute:
            combined.customAttribute ||
            next.customAttribute,
          customClass:
            combined.customClass ||
            next.customClass,
          configured:
            combined.configured ||
            next.configured,
          sources: [
            ...combined.sources,
            ...next.sources
          ]
        };
      }
    }

    const human = [
      explicitLabelContext(el),
      questionContext(el),
      tableHeaderContext(el)
    ]
      .filter(Boolean)
      .join(' ');

    const container =
      fieldContainerFor(el);

    const visible = !!(
      /\*|\brequired\b|\bmandatory\b/i.test(human) ||
      (
        container &&
        (
          container.classList.contains('required') ||
          container.classList.contains('mandatory') ||
          container.querySelector?.(
            ':scope > .required,:scope > .mandatory,:scope > [data-required="true"]'
          )
        )
      )
    );

    return {
      ...combined,
      visible,
      sources: [...new Set(combined.sources)]
    };
  };

  const qaTechnicalRequired = el =>
    !!qaRequiredSignals(el).configured;

  const qaVisibleRequiredMarker = el =>
    !!qaRequiredSignals(el).visible;

  const qaHumanLabel = el => {
    if (!el) return 'Unnamed field';

    const row =
      String(
        tableRowLabelContext(el) ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();

    const column =
      String(
        tableHeaderContext(el) ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();

    if (
      row &&
      column &&
      normalize(row) !==
        normalize(column) &&
      !/^(?:text field|select option|input|field)$/i.test(column)
    ) {
      return `${row} — ${column}`
        .slice(0, 120);
    }

    const candidates = [
      explicitLabelContext(el),
      questionContext(el),
      column,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('placeholder')
    ]
      .filter(Boolean)
      .map(item =>
        String(item)
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(
        item =>
          item &&
          !/^(?:text field|select option|input|field)$/i.test(item)
      );

    if (candidates.length) {
      return candidates[0].slice(0, 120);
    }

    if (row) {
      return row.slice(0, 120);
    }

    const technical = [
      el.getAttribute?.('name'),
      el.getAttribute?.('id'),
      el.getAttribute?.('type')
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/[_-]+/g, ' ')
      .trim();

    return technical.slice(0, 120) || 'Unnamed field';
  };

  const qaNativeValiditySummary = el => {
    try {
      const validity = el?.validity;
      if (!validity || validity.valid) return '';

      const labels = [
        ['valueMissing', 'required value missing'],
        ['typeMismatch', 'type mismatch'],
        ['patternMismatch', 'pattern mismatch'],
        ['tooLong', 'value too long'],
        ['tooShort', 'value too short'],
        ['rangeUnderflow', 'below minimum'],
        ['rangeOverflow', 'above maximum'],
        ['stepMismatch', 'step mismatch'],
        ['badInput', 'bad input'],
        ['customError', 'custom validation error']
      ];

      return labels
        .filter(([key]) => !!validity[key])
        .map(([, label]) => label)
        .join(', ');
    } catch {
      return '';
    }
  };

  const qaBuildSummary = (
    score,
    counts,
    fieldsAudited,
    checksRun
  ) => {
    let riskLevel = 'Low';
    let headline =
      'No major readiness problems were detected.';
    let recommendation =
      'Review the observations, then continue with normal functional testing.';

    if (counts.critical > 0) {
      riskLevel = 'High';
      headline =
        `${counts.critical} critical blocker${counts.critical === 1 ? '' : 's'} should be resolved before go-live.`;
      recommendation =
        'Fix the critical findings first, rerun the audit, and then review warnings.';
    } else if (counts.warning > 0) {
      riskLevel = 'Moderate';
      headline =
        `No critical blockers found. ${counts.warning} warning${counts.warning === 1 ? '' : 's'} need review.`;
      recommendation =
        'Review the warnings and confirm the affected fields behave correctly before go-live.';
    } else if (counts.observation > 0) {
      riskLevel = 'Low';
      headline =
        `No critical blockers or warnings found. ${counts.observation} observation${counts.observation === 1 ? '' : 's'} remain for manual confirmation.`;
      recommendation =
        'The form looks structurally healthy. Confirm the observations during normal functional QA.';
    }

    return {
      riskLevel,
      headline,
      recommendation,
      fieldsAudited,
      checksRun,
      score
    };
  };

  const buildQaAuditReport = () => {
    const generatedAt =
      new Date().toISOString();

    const findings = [];
    const seen = new Set();
    const auditedRadioGroups =
      new Set();

    let passed = 0;
    let fields = [];

    try {
      fields =
        visibleFillableFields();
    } catch {}

    const addFinding = ({
      severity = 'observation',
      category = 'General',
      title = 'QA observation',
      message = '',
      el = null,
      expected = '',
      actual = '',
      guidance = ''
    }) => {
      const fieldKeyValue =
        el ? fieldKey(el) : null;

      const label =
        el ? qaHumanLabel(el) : '';

      const signature = [
        severity,
        category,
        title,
        fieldKeyValue || '',
        message
      ].join('|');

      if (seen.has(signature)) {
        return;
      }

      seen.add(signature);

      findings.push({
        id:
          `qa_${findings.length + 1}`,
        severity,
        category,
        title,
        message,
        fieldKey:
          fieldKeyValue,
        field:
          label,
        expected,
        actual,
        guidance
      });
    };

    const meaningful =
      fields.length >= 2 ||
      (
        fields.length >= 1 &&
        fields.some(
          el =>
            isRequired(el)
        )
      );

    if (!meaningful) {
      addFinding({
        severity: 'critical',
        category: 'Form Detection',
        title:
          'No meaningful active form detected',
        message:
          'Smart FormSense could not find a meaningful visible form in this execution context.',
        expected:
          'A meaningful operational form with fillable controls',
        actual:
          `${fields.length} operational field(s) detected`,
        guidance:
          'Confirm the form has loaded completely and that the correct page or embedded frame is active.'
      });
    }

    const activeIds =
      new Map();

    for (const el of fields) {
      if (
        !el ||
        isLikelyInternalField(el)
      ) {
        continue;
      }

      if (el.type === 'radio') {
        const groupKey =
          `${el.ownerDocument?.URL || ''}|${el.name || fieldKey(el)}`;

        if (
          auditedRadioGroups.has(
            groupKey
          )
        ) {
          continue;
        }

        auditedRadioGroups.add(
          groupKey
        );
      }

      const requiredSignals =
        qaRequiredSignals(el);

      const configuredRequired =
        requiredSignals.configured;

      const visibleRequired =
        requiredSignals.visible;

      const businessRequired =
        !!(
          configuredRequired ||
          visibleRequired ||
          isRequired(el)
        );

      const hasValue =
        fieldHasValue(el);

      const label =
        qaHumanLabel(el);

      const type =
        normalize(el.type);

      const context =
        fieldContext(el);

      // Field clarity / accessibility.
      const humanLabel =
        normalize(
          [
            explicitLabelContext(el),
            questionContext(el),
            tableHeaderContext(el),
            tableRowLabelContext(el),
            el.getAttribute?.(
              'aria-label'
            ),
            el.getAttribute?.(
              'placeholder'
            )
          ]
            .filter(Boolean)
            .join(' ')
        );

      if (
        !humanLabel &&
        ![
          'hidden',
          'submit',
          'button',
          'reset'
        ].includes(type)
      ) {
        addFinding({
          severity:
            'observation',
          category:
            'Field Clarity',
          title:
            'Field has no clear user-facing label',
          message:
            `${label} may be difficult to identify consistently during QA or accessibility review.`,
          el,
          expected:
            'Visible label, question, ARIA label, table heading, row context, or placeholder',
          actual:
            'No clear user-facing label detected',
          guidance:
            'Add or verify a clear field label or accessible name.'
        });
      } else {
        passed++;
      }

      // Required-rule consistency.
      // A visible asterisk without native "required" is common in JS-driven
      // forms, so it is an observation unless stronger evidence shows a
      // broken rule. This avoids treating framework choice as a defect.
      if (
        visibleRequired &&
        !configuredRequired
      ) {
        addFinding({
          severity:
            'observation',
          category:
            'Required Fields',
          title:
            'Required rule should be functionally confirmed',
          message:
            `${label} is visibly marked as required, but Smart FormSense could not confirm the rule from native, ARIA, or common validator attributes. The form may still enforce it through JavaScript.`,
          el,
          expected:
            'A visible required indicator with an enforceable required rule',
          actual:
            'Required indicator detected; declarative/common validator rule not detected',
          guidance:
            'Leave this field empty once during functional QA and confirm the form blocks progression with a clear message.'
        });
      } else if (
        configuredRequired &&
        !visibleRequired
      ) {
        addFinding({
          severity:
            'warning',
          category:
            'Required Fields',
          title:
            'Required field is not visibly marked',
          message:
            `${label} appears to be technically required but Smart FormSense could not find a visible required/mandatory indicator.`,
          el,
          expected:
            'Required field clearly indicated to the user',
          actual:
            `Required rule detected via ${requiredSignals.sources.join(', ') || 'configuration'} without a clear visual marker`,
          guidance:
            'Make the required state visible and understandable to the user.'
        });
      } else {
        passed++;
      }

      if (
        businessRequired &&
        (
          el.disabled ||
          el.readOnly
        ) &&
        !hasValue
      ) {
        const dependencyLike =
          /state|province|district|city|town|course|program|programme|speciali[sz]ation|branch|campus/.test(
            context
          );

        addFinding({
          severity:
            dependencyLike
              ? 'observation'
              : 'critical',
          category:
            'Field Behaviour',
          title:
            dependencyLike
              ? 'Required dependent field is waiting for a parent selection'
              : 'Required field cannot currently be completed',
          message:
            dependencyLike
              ? `${label} is currently ${el.disabled ? 'disabled' : 'read-only'} and empty. This may be expected until a parent field is selected.`
              : `${label} is required but is ${el.disabled ? 'disabled' : 'read-only'} and currently empty.`,
          el,
          expected:
            dependencyLike
              ? 'Field becomes available after the relevant parent selection'
              : 'Required field should be completable or pre-populated',
          actual:
            `${el.disabled ? 'Disabled' : 'Read-only'} and empty`,
          guidance:
            dependencyLike
              ? 'Verify the dependency chain by selecting the parent field and confirming this field loads correctly.'
              : 'Fix the field state or ensure it is populated automatically before the user reaches it.'
        });
      } else {
        passed++;
      }

      // Constraint contradictions.
      const minLengthRaw =
        el.getAttribute?.(
          'minlength'
        );

      const maxLengthRaw =
        el.getAttribute?.(
          'maxlength'
        );

      const minLength =
        minLengthRaw !== null &&
        minLengthRaw !== ''
          ? Number(minLengthRaw)
          : null;

      const maxLength =
        maxLengthRaw !== null &&
        maxLengthRaw !== ''
          ? Number(maxLengthRaw)
          : null;

      if (
        Number.isFinite(
          minLength
        ) &&
        Number.isFinite(
          maxLength
        ) &&
        minLength > maxLength
      ) {
        addFinding({
          severity: 'critical',
          category:
            'Validation Rules',
          title:
            'Contradictory length validation',
          message:
            `${label} has minlength ${minLength} but maxlength ${maxLength}.`,
          el,
          expected:
            'Minimum length should not exceed maximum length',
          actual:
            `minlength=${minLength}, maxlength=${maxLength}`,
          guidance:
            'Correct the minimum/maximum length rule before testing submissions.'
        });
      } else {
        passed++;
      }

      const minRaw =
        el.getAttribute?.('min');

      const maxRaw =
        el.getAttribute?.('max');

      if (
        ['number', 'range'].includes(
          type
        ) &&
        minRaw !== null &&
        minRaw !== '' &&
        maxRaw !== null &&
        maxRaw !== '' &&
        Number.isFinite(
          Number(minRaw)
        ) &&
        Number.isFinite(
          Number(maxRaw)
        ) &&
        Number(minRaw) >
          Number(maxRaw)
      ) {
        addFinding({
          severity: 'critical',
          category:
            'Validation Rules',
          title:
            'Contradictory numeric range',
          message:
            `${label} has minimum ${minRaw} greater than maximum ${maxRaw}.`,
          el,
          expected:
            'Minimum value should not exceed maximum value',
          actual:
            `min=${minRaw}, max=${maxRaw}`,
          guidance:
            'Correct the numeric validation range.'
        });
      } else if (
        [
          'date',
          'month',
          'time',
          'datetime-local'
        ].includes(type) &&
        minRaw &&
        maxRaw &&
        String(minRaw) >
          String(maxRaw)
      ) {
        addFinding({
          severity: 'critical',
          category:
            'Validation Rules',
          title:
            'Contradictory date/time range',
          message:
            `${label} has minimum ${minRaw} after maximum ${maxRaw}.`,
          el,
          expected:
            'Minimum date/time should not be after maximum date/time',
          actual:
            `min=${minRaw}, max=${maxRaw}`,
          guidance:
            'Correct the date/time validation range.'
        });
      } else {
        passed++;
      }

      // Dropdown and dependency readiness.
      if (
        el.tagName ===
        'SELECT'
      ) {
        const options =
          validOptions(el);

        if (
          businessRequired &&
          !el.disabled &&
          !options.length
        ) {
          addFinding({
            severity: 'critical',
            category:
              'Dropdown & Dependencies',
            title:
              'Required dropdown has no selectable options',
            message:
              `${label} is required but currently has no valid selectable option.`,
            el,
            expected:
              'At least one valid selectable option',
            actual:
              '0 valid options',
            guidance:
              'Check the dropdown data source, dependency, and loading state.'
          });
        } else if (
          el.disabled &&
          !hasValue &&
          /state|province|district|city|town|course|program|programme|speciali[sz]ation|branch|campus/.test(
            context
          )
        ) {
          addFinding({
            severity:
              businessRequired
                ? 'observation'
                : 'observation',
            category:
              'Dropdown & Dependencies',
            title:
              'Dependent dropdown is not ready yet',
            message:
              `${label} is disabled and empty at audit time. This may be correct until its parent selection is made.`,
            el,
            expected:
              'Dependent field becomes available after its parent condition is satisfied',
            actual:
              'Disabled and empty at audit time',
            guidance:
              'Verify the parent-child selection flow during functional QA.'
          });
        } else {
          passed++;
        }
      }

      // Manual browser actions are surfaced instead of being faked.
      if (
        type === 'file' &&
        businessRequired &&
        !el.files?.length
      ) {
        addFinding({
          severity:
            'observation',
          category:
            'Manual QA',
          title:
            'Required file upload needs manual QA',
          message:
            `${label} requires a real browser file selection and remains a manual test step.`,
          el,
          expected:
            'QA tester manually verifies allowed files, size/type validation, upload and removal behaviour',
          actual:
            'Manual browser action required',
          guidance:
            'Upload a valid and invalid sample file manually and verify type, size, removal, and error handling.'
        });
      }

      // Existing populated invalid states can be surfaced without changing the
      // field or triggering a final submission.
      const validity =
        qaNativeValiditySummary(
          el
        );

      const ariaInvalid =
        el.getAttribute?.(
          'aria-invalid'
        ) === 'true';

      if (
        hasValue &&
        (
          validity ||
          ariaInvalid
        )
      ) {
        addFinding({
          severity:
            'warning',
          category:
            'Current Validation State',
          title:
            'Current field value is invalid',
          message:
            `${label} is currently reporting an invalid state${validity ? ` (${validity})` : ''}.`,
          el,
          expected:
            'Current populated value should satisfy configured validation',
          actual:
            validity ||
            'aria-invalid=true',
          guidance:
            'Correct the current value and confirm the validation message clears.'
        });
      } else {
        passed++;
      }
    }

    // Duplicate IDs can break labels, validation targeting, and scripting.
    try {
      for (
        const doc
        of collectDocuments()
      ) {
        for (
          const el
          of queryFieldsDeep(doc)
        ) {
          if (
            !isLogicalField(el) ||
            !isFieldOperationallyVisible(
              el
            ) ||
            !el.id
          ) {
            continue;
          }

          const id =
            String(el.id);

          const items =
            activeIds.get(id) ||
            [];

          items.push(el);
          activeIds.set(
            id,
            items
          );
        }
      }
    } catch {}

    for (
      const [id, items]
      of activeIds.entries()
    ) {
      if (
        items.length <= 1
      ) {
        continue;
      }

      for (const el of items) {
        addFinding({
          severity: 'warning',
          category:
            'Form Structure',
          title:
            'Duplicate active field ID',
          message:
            `${qaHumanLabel(el)} shares the DOM id "${id}" with another active field. This can cause label, validation, or scripting ambiguity.`,
          el,
          expected:
            'Unique DOM id for active controls',
          actual:
            `${items.length} active controls use id="${id}"`,
          guidance:
            'Assign a unique id to each active form control and update its associated label/validation target.'
        });
      }
    }

    // Hidden/inactive technically required controls are observations because
    // dynamic forms legitimately keep required templates hidden until needed.
    try {
      for (
        const doc
        of collectDocuments()
      ) {
        for (
          const el
          of allFields(doc)
        ) {
          if (
            isFieldOperationallyVisible(
              el
            ) ||
            el.disabled ||
            isLikelyInternalField(
              el
            ) ||
            !qaTechnicalRequired(
              el
            )
          ) {
            continue;
          }

          addFinding({
            severity:
              'observation',
            category:
              'Dynamic Fields',
            title:
              'Inactive required field detected',
            message:
              `${qaHumanLabel(el)} is required in markup/configuration but is not currently active or visible. This may be valid for a conditional field.`,
            el,
            expected:
              'Inactive conditional fields should not block the current journey',
            actual:
              'Required rule exists while field is inactive',
            guidance:
              'Verify this field only becomes required when its condition is active.'
          });
        }
      }
    } catch {}

    const rank = {
      critical: 0,
      warning: 1,
      observation: 2
    };

    findings.sort(
      (a, b) =>
        (
          rank[a.severity] ??
          9
        ) -
        (
          rank[b.severity] ??
          9
        )
    );

    const counts = {
      critical:
        findings.filter(
          item =>
            item.severity ===
            'critical'
        ).length,
      warning:
        findings.filter(
          item =>
            item.severity ===
            'warning'
        ).length,
      observation:
        findings.filter(
          item =>
            item.severity ===
            'observation'
        ).length,
      passed
    };

    const checksRun =
      passed +
      counts.critical +
      counts.warning +
      counts.observation;

    const weightedIssues =
      counts.critical * 10 +
      counts.warning * 3 +
      counts.observation * 0.75;

    let score =
      meaningful
        ? Math.round(
            clamp(
              (
                passed /
                Math.max(
                  1,
                  passed +
                    weightedIssues
                )
              ) *
                100,
              0,
              100
            )
          )
        : 0;

    // A critical blocker should prevent an otherwise large form from looking
    // "green" just because it has hundreds of passing checks.
    if (
      counts.critical > 0
    ) {
      score =
        Math.min(
          score,
          counts.critical >= 3
            ? 59
            : 79
        );
    }

    const rating =
      score >= 92
        ? 'Strong'
        : score >= 82
          ? 'Good'
          : score >= 70
            ? 'Needs Review'
            : 'Needs Attention';

    const categoryCounts = {};

    for (
      const item
      of findings
    ) {
      const key =
        item.category ||
        'General';

      categoryCounts[key] =
        (
          categoryCounts[key] ||
          0
        ) + 1;
    }

    const summary =
      qaBuildSummary(
        score,
        counts,
        fields.length,
        checksRun
      );

    return {
      reportVersion: 3,
      product:
        'Smart FormSense',
      productVersion:
        '17.11.2',
      generatedAt,
      auditType:
        'Non-destructive Form Readiness Audit',
      page: {
        url:
          location.href,
        hostname:
          location.hostname,
        pathname:
          location.pathname,
        title:
          document.title ||
          ''
      },
      formSignature:
        formTechnicalSignature(),
      fieldsAudited:
        fields.length,
      checksRun,
      score,
      rating,
      summary,
      counts,
      categoryCounts,
      findings,
      notes: [
        'This audit does not submit the form.',
        'The readiness score is weighted against all checks performed; repeated low-severity observations no longer reduce a large form to 0/100.',
        'A visible required marker without a standard/common validator attribute is treated as an observation because many JavaScript form frameworks enforce rules outside native HTML attributes.',
        'This release performs non-destructive readiness checks; it does not deliberately inject invalid boundary values.',
        'Observations are review prompts and may be valid for conditional or dynamic form designs.',
        'Final go-live approval remains with the QA tester.'
      ]
    };
  };

  const qaFindingElement = key => {
    if (!key) return null;

    for (
      const doc
      of collectDocuments()
    ) {
      for (
        const el
        of allFields(doc)
      ) {
        if (
          fieldKey(el) === key
        ) {
          return el;
        }
      }
    }

    return null;
  };

  const navigateQaFinding = key => {
    const el =
      qaFindingElement(key);

    if (!el) {
      state.panel?.setStatus(
        'The QA field is no longer available. The form may have changed since the audit.'
      );

      return false;
    }

    const target =
      visualTarget(el) ||
      el;

    try {
      target.scrollIntoView({
        behavior: 'auto',
        block: 'center',
        inline: 'nearest'
      });
    } catch {
      try {
        target.scrollIntoView();
      } catch {}
    }

    setTimeout(
      () => {
        try {
          el.focus({
            preventScroll: true
          });
        } catch {}

        flashTarget(
          target
        );
      },
      60
    );

    state.panel?.setStatus(
      `QA issue • ${qaHumanLabel(el)}`
    );

    return true;
  };

  const qaEscapeHtml = value =>
    String(
      value ??
      ''
    )
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&#039;'
      );

  const qaGroupedFindings = report => {
    const groups = new Map();

    for (const item of report?.findings || []) {
      const rawTitle = String(item.title || 'QA finding');
      const title = rawTitle.includes(' — ')
        ? rawTitle.split(' — ').slice(-1)[0].trim()
        : rawTitle;
      const key = [
        item.severity || 'observation',
        item.category || 'General',
        title
      ].join('|');

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

    return [...groups.values()].map(item => ({
      ...item,
      fields: [...new Set(item.fields)]
    }));
  };

  const buildQaFriendlyHtml = report => {
    const qa = report || state.qaReport;
    if (!qa) return '';

    const counts = qa.counts || {};
    const grouped = qaGroupedFindings(qa);
    const blockers = grouped.filter(item => item.severity === 'critical');
    const failed = grouped.filter(item => item.severity === 'warning');
    const review = grouped.filter(item => item.severity === 'observation');
    const esc = qaEscapeHtml;

    const generated = (() => {
      try { return new Date(qa.generatedAt).toLocaleString(); }
      catch { return qa.generatedAt || ''; }
    })();

    const status = qa.incomplete
      ? (qa.runState === 'stopped' ? 'Partial Report • Stopped' : 'Partial Report • Interrupted')
      : blockers.length
      ? 'Blockers Found'
      : failed.length
        ? 'Needs Attention'
        : review.length
          ? 'Needs Review'
          : 'Looks Good';

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

    const section = (title, items, kind) => !items.length
      ? ''
      : `<section><h2>${esc(title)} <span>${items.length}</span></h2>${items.map(item => itemHtml(item, kind)).join('')}</section>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart FormSense QA Report</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f7fa;color:#242633;font-family:Inter,Segoe UI,Arial,sans-serif}.wrap{max-width:850px;margin:auto;padding:28px 18px 44px}.top{background:#fff;border:1px solid #e7e7ee;border-radius:16px;padding:20px}.brand{font-size:13px;font-weight:850;color:#5b4bff}.top h1{font-size:22px;margin:5px 0}.meta{font-size:12px;color:#747887;line-height:1.5}.status{display:inline-block;margin-top:13px;padding:6px 10px;border-radius:999px;background:#f2efff;color:#5b4bff;font-size:12px;font-weight:850}.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-top:15px}.metric{border:1px solid #e8e8ef;border-radius:10px;padding:10px 7px;text-align:center}.metric b{display:block;font-size:19px}.metric span{font-size:9px;color:#777b88;font-weight:750}.blockerText{color:#b91c1c}.failedText{color:#c2410c}.reviewText{color:#a16207}section{margin-top:24px}h2{font-size:16px;margin:0 0 9px}h2 span{font-size:10px;background:#ececf2;border-radius:999px;padding:3px 6px;color:#666}.item{background:#fff;border:1px solid #e7e7ee;border-left:4px solid #cbd5e1;border-radius:11px;padding:13px;margin:8px 0}.item.blocker{border-left-color:#b91c1c}.item.failed{border-left-color:#ea580c}.item.review{border-left-color:#d97706}.itemTitle{font-size:14px;font-weight:850}.fields,.what,.action{margin-top:6px;font-size:11px;line-height:1.5;color:#606473}.action{background:#f7f7fb;border-radius:8px;padding:8px 9px}.partial{margin-top:14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:11px;padding:10px 12px;font-size:11px;line-height:1.45;color:#9a3412}.passed{margin-top:24px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:11px;padding:12px;font-size:12px;color:#166534}.note{margin-top:18px;font-size:10px;line-height:1.55;color:#858895}.footer{text-align:center;margin-top:24px;font-size:10px;color:#9295a1}@media(max-width:650px){.summary{grid-template-columns:repeat(2,1fr)}}@media print{body{background:#fff}.wrap{padding:0}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="brand">✦ Smart FormSense QA</div>
    <h1>${esc(qa.page?.title || 'Form')}</h1>
    <div class="meta">${esc(qa.page?.hostname || location.hostname || '')}<br>${esc(generated)} • v${esc(qa.productVersion || '17.11.2')}</div>
    <div class="status">${esc(status)}</div>
    <div class="summary">
      <div class="metric"><b>${Number(qa.incomplete ? (qa.fieldsChecked || 0) : (qa.fieldsAudited || 0))}</b><span>FIELDS CHECKED</span></div>
      <div class="metric"><b class="blockerText">${blockers.length}</b><span>BLOCKER TYPES</span></div>
      <div class="metric"><b class="failedText">${failed.length}</b><span>ISSUE TYPES</span></div>
      <div class="metric"><b class="reviewText">${review.length}</b><span>REVIEW AREAS</span></div>
      <div class="metric"><b>${Number(qa.coverage ?? qa.summary?.coverage ?? 0)}%</b><span>AUTO COVERAGE</span></div>
    </div>
  </div>

  ${qa.incomplete ? `<div class="partial"><b>Partial report.</b> ${esc(qa.summary?.headline || 'QA did not complete.')} ${qa.stopReason ? `<br>${esc(qa.stopReason)}` : ''}</div>` : ''}

  ${section('Blockers', blockers, 'blocker')}
  ${section('Issues to Fix', failed, 'failed')}
  ${section('Needs Review', review, 'review')}

  <div class="passed">✓ ${Number(counts.passed || 0)} automated checks passed.</div>
  <div class="note">Smart FormSense tests the finished form from the applicant's point of view. Similar findings are grouped into one issue with affected fields listed. Safe Next/Continue/Save & Next actions may be tested; final submit, payment and application-generation actions are never executed automatically. Manual sign-off remains with the form QC team.</div>
  <div class="footer">Created with love ❤️ Akash Singh • Smart FormSense</div>
</div>
</body>
</html>`;
  };

  const exportQaReport = report => {
    const qa =
      report ||
      state.qaReport;

    if (!qa) {
      state.panel?.setStatus(
        'Run Functional QA before exporting a report.'
      );

      return null;
    }

    const stamp =
      new Date()
        .toISOString()
        .replace(
          /[:.]/g,
          '-'
        )
        .slice(0, 19);

    const host =
      String(
        qa.page?.hostname ||
        location.hostname ||
        'form'
      )
        .replace(
          /[^a-z0-9.-]+/gi,
          '_'
        )
        .slice(0, 60);

    const html =
      buildQaFriendlyHtml(
        qa
      );

    downloadTextFile(
      `Smart_FormSense_QA_Report_${host}_${stamp}.html`,
      html,
      'text/html;charset=utf-8'
    );

    state.panel?.setStatus(
      `QA report exported • ${qaGroupedFindings(qa).length} grouped item(s)`
    );

    return qa;
  };

  const buildQaDebugReport = () => {
    let fields = [];

    try {
      fields =
        visibleFillableFields();
    } catch {}

    const qa =
      state.qaReport ||
      buildQaAuditReport();

    const qaFields =
      fields.map(el => {
        const signals =
          qaRequiredSignals(el);

        return {
          fieldKey:
            fieldKey(el),
          label:
            qaHumanLabel(el),
          tag:
            normalize(
              el.tagName
            ),
          type:
            normalize(
              el.type
            ),
          name:
            el.getAttribute?.(
              'name'
            ) || '',
          id:
            el.id || '',
          className:
            String(
              el.className ||
              ''
            ).slice(
              0,
              300
            ),
          visible:
            isFieldOperationallyVisible(
              el
            ),
          disabled:
            !!el.disabled,
          readOnly:
            !!el.readOnly,
          hasValue:
            fieldHasValue(el),
          requiredSignals:
            signals,
          nativeValidity:
            qaNativeValiditySummary(
              el
            ),
          ariaInvalid:
            el.getAttribute?.(
              'aria-invalid'
            ) || '',
          validationText:
            (() => {
              try {
                return String(
                  validationText(el) ||
                  ''
                ).slice(
                  0,
                  500
                );
              } catch {
                return '';
              }
            })(),
          optionCount:
            el.tagName ===
            'SELECT'
              ? validOptions(el).length
              : null,
          constraints: {
            pattern:
              el.getAttribute?.(
                'pattern'
              ) || '',
            min:
              el.getAttribute?.(
                'min'
              ) || '',
            max:
              el.getAttribute?.(
                'max'
              ) || '',
            minlength:
              el.getAttribute?.(
                'minlength'
              ) || '',
            maxlength:
              el.getAttribute?.(
                'maxlength'
              ) || '',
            step:
              el.getAttribute?.(
                'step'
              ) || '',
            inputmode:
              el.getAttribute?.(
                'inputmode'
              ) || '',
            autocomplete:
              el.getAttribute?.(
                'autocomplete'
              ) || ''
          },
          debugSnapshot:
            debugFieldSnapshot(
              el
            )
        };
      });

    return {
      reportVersion: 2,
      product:
        'Smart FormSense',
      productVersion:
        '17.9.0',
      generatedAt:
        new Date().toISOString(),
      purpose:
        'Technical QA troubleshooting export',
      page: {
        title:
          document.title ||
          '',
        hostname:
          location.hostname,
        pathname:
          location.pathname,
        url:
          location.href
      },
      qaAudit:
        qa,
      qaFieldDiagnostics:
        qaFields,
      technicalDiagnostics:
        buildDebugReport(),
      runtime: {
        isTop:
          IS_TOP,
        isFrame:
          IS_FRAME,
        lastRemoteAgentId:
          state.lastRemoteAgentId ||
          null,
        lastRuntimeError:
          state.lastRuntimeError ||
          null,
        qaRunState:
          state.qaReport?.runState ||
          null,
        qaIncomplete:
          !!state.qaReport?.incomplete,
        qaProgressPercent:
          Number(state.qaProgressPercent || 0)
      },
      notes: [
        'This file is intentionally technical and is meant to be shared for troubleshooting Smart FormSense QA detection.',
        'It can contain page/form metadata and synthetic test values. Review it before sharing outside the QA/development team.',
        'Preserved user-entered values remain subject to the redaction rules used by the standard debug exporter.'
      ]
    };
  };

  const exportQaDebugReport = () => {
    try {
      const report =
        buildQaDebugReport();

      const stamp =
        new Date()
          .toISOString()
          .replace(
            /[:.]/g,
            '-'
          )
          .slice(0, 19);

      const host =
        String(
          location.hostname ||
          'form'
        )
          .replace(
            /[^a-z0-9.-]+/gi,
            '_'
          )
          .slice(0, 60);

      downloadTextFile(
        `Smart_FormSense_QA_Debug_${host}_${stamp}.json`,
        JSON.stringify(
          report,
          null,
          2
        )
      );

      state.panel?.setStatus(
        `QA debug exported • ${report.qaFieldDiagnostics.length} field diagnostic(s) • ${report.qaAudit?.findings?.length || 0} QA finding(s)`
      );

      return report;
    } catch (error) {
      console.error(
        'Smart FormSense V17.11.2 QA debug export:',
        error
      );

      state.panel?.setStatus(
        `QA debug export failed: ${error?.message || 'unknown error'}`
      );

      return null;
    }
  };


  // ==========================================================
  // Embedded / cross-origin form bridge
  // ==========================================================
  const bridge = {
    sessionId:
      `top_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    agents: new Map(),
    pending: new Map()
  };

  const makeBridgeId =
    prefix =>
      `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  const bridgePayload =
    (type, extra = {}) => ({
      [BRIDGE_MARKER]: true,
      type,
      ...extra
    });

  const postBridgeToTop =
    payload => {
      if (!IS_FRAME) {
        return;
      }

      try {
        window.top.postMessage(
          bridgePayload(
            payload.type,
            payload
          ),
          '*'
        );
      } catch {}
    };

  const localFormMetrics = () => {
    let fields = [];

    try {
      fields =
        visibleFillableFields();
    } catch {}

    let required = 0;
    let textLike = 0;
    let selects = 0;
    let checks = 0;
    let files = 0;

    for (const el of fields) {
      try {
        if (isRequired(el)) {
          required++;
        }

        if (
          el.tagName === 'SELECT'
        ) {
          selects++;
        } else if (
          el.type === 'radio' ||
          el.type === 'checkbox'
        ) {
          checks++;
        } else if (
          el.type === 'file'
        ) {
          files++;
        } else {
          textLike++;
        }
      } catch {}
    }

    let formCount = 0;

    try {
      formCount =
        document.querySelectorAll(
          'form'
        ).length;
    } catch {}

    const operational =
      fields.length;

    const meaningful =
      operational >= 2 ||
      (
        operational >= 1 &&
        required >= 1
      );

    // Keep the scoring deliberately simple and generic.
    // A real embedded application form naturally beats a marketing/search
    // control because it has more operational fields and form structure.
    const score =
      operational * 10 +
      required * 4 +
      textLike * 2 +
      selects * 3 +
      checks +
      Math.min(
        formCount,
        3
      ) * 3 -
      files;

    return {
      operational,
      required,
      textLike,
      selects,
      checks,
      files,
      formCount,
      meaningful,
      score
    };
  };

  const hasEmbeddedFormHints = () => {
    if (!IS_TOP) {
      return false;
    }

    try {
      if (
        document.querySelector(
          'iframe,object,embed'
        )
      ) {
        return true;
      }

      if (
        document.querySelector(
          '[class*="widget" i],[id*="widget" i],[class*="embed" i],[id*="embed" i]'
        )
      ) {
        return true;
      }

      return [
        ...document.scripts
      ].some(
        script =>
          /widget|embed|form/i.test(
            String(
              script.src || ''
            )
          )
      );
    } catch {
      return false;
    }
  };

  const frameWindowsForDiscovery = () => {
    if (!IS_TOP) {
      return [];
    }

    const windows =
      [];

    try {
      document
        .querySelectorAll(
          'iframe'
        )
        .forEach(frame => {
          try {
            if (
              frame.contentWindow
            ) {
              windows.push(
                frame.contentWindow
              );
            }
          } catch {}
        });
    } catch {}

    return windows;
  };

  const pingFrameAgents = () => {
    if (!IS_TOP) {
      return;
    }

    const payload =
      bridgePayload(
        'DISCOVER',
        {
          sessionId:
            bridge.sessionId,
          at: Date.now()
        }
      );

    for (
      const frameWindow
      of frameWindowsForDiscovery()
    ) {
      try {
        frameWindow.postMessage(
          payload,
          '*'
        );
      } catch {}
    }

    // Known agents can include nested cross-origin frames that are not
    // directly queryable from the top document. Ping their WindowProxy too.
    for (
      const agent
      of bridge.agents.values()
    ) {
      try {
        agent.source?.postMessage(
          payload,
          '*'
        );
      } catch {}
    }
  };

  const pruneFrameAgents = () => {
    const now =
      Date.now();

    for (
      const [
        id,
        agent
      ]
      of bridge.agents
    ) {
      if (
        now -
          Number(
            agent.lastSeen || 0
          ) >
        FRAME_AGENT_STALE_MS
      ) {
        bridge.agents.delete(
          id
        );
      }
    }
  };

  const embeddedAgentCandidates = () => {
    pruneFrameAgents();

    return [
      ...bridge.agents.values()
    ]
      .filter(
        agent =>
          agent.metrics?.meaningful &&
          agent.source
      )
      .sort(
        (a, b) =>
          Number(
            b.metrics?.score || 0
          ) -
          Number(
            a.metrics?.score || 0
          )
      );
  };

  const discoverEmbeddedAgents =
    async (
      {
        localMetrics =
          localFormMetrics()
      } = {}
    ) => {
      if (!IS_TOP) {
        return [];
      }

      const hints =
        hasEmbeddedFormHints();

      if (
        !hints &&
        localMetrics.meaningful &&
        !bridge.agents.size
      ) {
        return [];
      }

      const started =
        Date.now();

      const limit =
        localMetrics.meaningful
          ? FRAME_DISCOVERY_SOFT_MS
          : hints
            ? FRAME_DISCOVERY_HARD_MS
            : 900;

      let previousFingerprint =
        '';

      let stableSince =
        Date.now();

      while (
        Date.now() -
          started <
        limit
      ) {
        pingFrameAgents();

        await sleep(
          120
        );

        pruneFrameAgents();

        const candidates =
          embeddedAgentCandidates();

        let iframeCount = 0;

        try {
          iframeCount =
            document.querySelectorAll(
              'iframe'
            ).length;
        } catch {}

        const fingerprint =
          [
            iframeCount,
            bridge.agents.size,
            candidates
              .map(
                agent =>
                  `${agent.id}:${agent.metrics?.operational || 0}:${agent.metrics?.score || 0}`
              )
              .join('|')
          ].join('::');

        if (
          fingerprint !==
          previousFingerprint
        ) {
          previousFingerprint =
            fingerprint;

          stableSince =
            Date.now();

          state.panel?.setStatus(
            candidates.length
              ? `Embedded form detected • ${candidates[0].metrics.operational} field(s) available`
              : iframeCount
                ? `Checking ${iframeCount} embedded frame(s) for forms...`
                : 'Waiting for embedded form widget to initialize...'
          );
        }

        if (
          candidates.length &&
          Date.now() -
            stableSince >=
            180
        ) {
          return candidates;
        }

        if (
          localMetrics.meaningful &&
          Date.now() -
            started >=
            FRAME_DISCOVERY_SOFT_MS
        ) {
          return candidates;
        }

        if (
          !hints &&
          !candidates.length &&
          Date.now() -
            stableSince >=
            700
        ) {
          return [];
        }
      }

      return embeddedAgentCandidates();
    };

  const chooseExecutionContext =
    async () => {
      const local =
        localFormMetrics();

      const agents =
        await discoverEmbeddedAgents({
          localMetrics:
            local
        });

      const bestAgent =
        agents[0] ||
        null;

      if (
        bestAgent &&
        (
          !local.meaningful ||
          Number(
            bestAgent.metrics?.score || 0
          ) >
            local.score + 5
        )
      ) {
        return {
          kind: 'remote',
          local,
          agent:
            bestAgent
        };
      }

      if (local.meaningful) {
        return {
          kind: 'local',
          local,
          agent: null
        };
      }

      if (bestAgent) {
        return {
          kind: 'remote',
          local,
          agent:
            bestAgent
        };
      }

      return {
        kind: 'none',
        local,
        agent: null
      };
    };

  const remoteAgentById =
    id =>
      id
        ? bridge.agents.get(
            id
          ) || null
        : null;

  const sendRemoteCommand =
    (
      agent,
      action,
      extra = {}
    ) => {
      if (
        !agent?.source
      ) {
        return Promise.reject(
          new Error(
            'Embedded form frame is no longer available'
          )
        );
      }

      const requestId =
        makeBridgeId(
          'request'
        );

      state.activeRemoteAgentId =
        agent.id;

      state.lastRemoteAgentId =
        agent.id;

      state.activeRemoteRequestId =
        requestId;

      state.activeRemoteAction =
        action;

      state.running =
        true;

      state.stopRequested =
        false;

      state.panel?.setBusy(
        true
      );

      state.panel?.setStatus(
        `Running ${action} inside embedded form${agent.hostname ? ` • ${agent.hostname}` : ''}...`
      );

      return new Promise(
        (
          resolve,
          reject
        ) => {
          const timer =
            setTimeout(
              () => {
                bridge.pending.delete(
                  requestId
                );

                if (
                  state.activeRemoteRequestId ===
                  requestId
                ) {
                  state.running =
                    false;

                  state.activeRemoteAgentId =
                    null;

                  state.activeRemoteRequestId =
                    null;

                  state.activeRemoteAction =
                    null;

                  state.panel?.setBusy(
                    false
                  );
                }

                reject(
                  new Error(
                    'Embedded form stopped responding before the command completed'
                  )
                );
              },
              action === 'qa-audit'
                ? QA_REMOTE_COMMAND_TIMEOUT_MS
                : REMOTE_COMMAND_TIMEOUT_MS
            );

          bridge.pending.set(
            requestId,
            {
              resolve,
              reject,
              timer,
              agentId:
                agent.id,
              action
            }
          );

          try {
            agent.source.postMessage(
              bridgePayload(
                'COMMAND',
                {
                  sessionId:
                    bridge.sessionId,
                  agentId:
                    agent.id,
                  requestId,
                  action,
                  ...extra
                }
              ),
              '*'
            );
          } catch (error) {
            clearTimeout(
              timer
            );

            bridge.pending.delete(
              requestId
            );

            reject(
              error
            );
          }
        }
      );
    };

  const runSmartAction =
    async (
      action,
      extra = {}
    ) => {
      if (
        !IS_TOP ||
        state.running
      ) {
        return;
      }

      state.panel?.setStatus(
        'Locating the active form...'
      );

      try {
        const context =
          await chooseExecutionContext();

        if (
          context.kind ===
          'remote'
        ) {
          await sendRemoteCommand(
            context.agent,
            action,
            extra
          );

          return;
        }

        if (
          context.kind ===
          'none'
        ) {
          state.panel?.setProgress(
            0,
            'No fillable form detected'
          );

          state.panel?.setStatus(
            hasEmbeddedFormHints()
              ? 'An embedded widget/frame exists, but no active form fields became accessible. Reload once and try again if the widget is still loading.'
              : 'No meaningful fillable form was found on this page.'
          );

          return;
        }

        // Local/direct form path preserves the established V17 engine.
        state.lastRemoteAgentId =
          null;

        if (
          action === 'fill'
        ) {
          await fillForm(
            extra.mode ||
            'all'
          );
        } else if (
          action === 'validate'
        ) {
          await deepValidateAndAssist();
        } else if (
          action === 'recheck'
        ) {
          await recheckAndCorrect();
        }
      } catch (error) {
        state.running =
          false;

        state.activeRemoteAgentId =
          null;

        state.activeRemoteRequestId =
          null;

        state.activeRemoteAction =
          null;

        state.panel?.setBusy(
          false
        );

        state.panel?.setStatus(
          `Embedded-form action failed safely: ${error?.message || 'unknown error'}`
        );

        setProgress(
          100,
          `Embedded-form action stopped: ${error?.message || 'unknown error'}`
        );
      }
    };



  // ==========================================================
  // Smart FormSense Functional QA engine (black-box, reversible)
  // ==========================================================
  const qaDispatchInteraction = (el, includeBlur = true) => {
    if (!el) return;

    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {}

    try {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {}

    if (includeBlur) {
      try {
        el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      } catch {
        try {
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        } catch {}
      }
    }
  };

  const qaSnapshotFieldValue = el => {
    if (!el) return null;

    const type = normalize(el.type);

    if (type === 'radio') {
      return {
        kind: 'radio-group',
        values: radioGroupMembers(el).map(item => ({
          key: fieldKey(item),
          checked: !!item.checked
        }))
      };
    }

    if (type === 'checkbox') {
      return {
        kind: 'checkbox',
        checked: !!el.checked,
        value: String(el.value ?? '')
      };
    }

    if (el.tagName === 'SELECT') {
      return {
        kind: 'select',
        value: String(el.value ?? ''),
        selectedIndex: Number(el.selectedIndex)
      };
    }

    return {
      kind: 'value',
      value: String(el.value ?? '')
    };
  };

  const qaSetNativeLikeValue = (el, value) => {
    if (!el) return false;

    const type = normalize(el.type);

    try {
      if (type === 'checkbox') {
        el.checked = !!value;
        qaDispatchInteraction(el);
        return true;
      }

      if (type === 'radio') {
        const members = radioGroupMembers(el);
        const target = members.find(item => String(item.value) === String(value)) || members[0];
        if (!target) return false;
        target.checked = true;
        qaDispatchInteraction(target);
        return true;
      }

      if (el.tagName === 'SELECT') {
        el.value = String(value ?? '');
        qaDispatchInteraction(el);
        return true;
      }

      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;

      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

      if (descriptor?.set) {
        descriptor.set.call(el, String(value ?? ''));
      } else {
        el.value = String(value ?? '');
      }

      qaDispatchInteraction(el);
      return true;
    } catch {
      try {
        el.value = String(value ?? '');
        qaDispatchInteraction(el);
        return true;
      } catch {
        return false;
      }
    }
  };

  const qaRestoreFieldValue = async (el, snapshot) => {
    if (!el || !snapshot) return;

    try {
      if (snapshot.kind === 'radio-group') {
        const members = radioGroupMembers(el);
        for (const item of members) {
          const saved = snapshot.values.find(row => row.key === fieldKey(item));
          if (saved) item.checked = !!saved.checked;
        }
        if (members[0]) qaDispatchInteraction(members[0], false);
      } else if (snapshot.kind === 'checkbox') {
        el.checked = !!snapshot.checked;
        qaDispatchInteraction(el, false);
      } else if (snapshot.kind === 'select') {
        el.value = snapshot.value;
        if (String(el.value) !== String(snapshot.value) && Number.isFinite(snapshot.selectedIndex)) {
          el.selectedIndex = snapshot.selectedIndex;
        }
        qaDispatchInteraction(el, false);
      } else {
        qaSetNativeLikeValue(el, snapshot.value);
      }
    } catch {}

    await sleep(45);
  };

  const qaVisibleFeedback = el => {
    if (!el) {
      return {
        invalid: false,
        signature: '',
        text: ''
      };
    }

    const parts = [];

    const validity = qaNativeValiditySummary(el);
    if (validity) parts.push(validity);

    if (el.getAttribute?.('aria-invalid') === 'true') {
      parts.push('aria-invalid');
    }

    try {
      const direct = validationText(el);
      if (direct) parts.push(String(direct));
    } catch {}

    try {
      const container = fieldContainerFor(el) || el.parentElement;
      const selectors = [
        '.error',
        '.errors',
        '.invalid-feedback',
        '.field-error',
        '.help-block',
        '.text-danger',
        '.validation-error',
        '[role="alert"]',
        '[aria-live="assertive"]'
      ].join(',');

      for (const node of container?.querySelectorAll?.(selectors) || []) {
        if (!isVisible(node)) continue;
        const text = String(node.innerText || node.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240);
        if (text && /required|mandatory|invalid|enter|select|choose|valid|must|minimum|maximum|digit|character|format|error/i.test(text)) {
          parts.push(text);
        }
      }
    } catch {}

    const unique = [...new Set(parts.filter(Boolean))];
    const text = unique.join(' | ').slice(0, 600);

    return {
      invalid: !!text,
      signature: normalize(text),
      text
    };
  };

  const qaValueLooksRetained = (el, attempted) => {
    if (!el) return false;
    const type = normalize(el.type);

    if (type === 'checkbox') {
      return !!el.checked === !!attempted;
    }

    if (type === 'radio') {
      return radioGroupMembers(el).some(item => item.checked && String(item.value) === String(attempted));
    }

    return String(el.value ?? '') === String(attempted ?? '');
  };

  const qaSemanticFor = el => {
    const type = normalize(el?.type);
    const ownContext = normalize([
      qaHumanLabel(el),
      el?.name,
      el?.id,
      el?.getAttribute?.('placeholder'),
      tableHeaderContext(el),
      tableRowLabelContext(el)
    ].filter(Boolean).join(' '));

    if (type === 'file') return 'file';
    if (/percentage.*cgpa|cgpa.*percentage/.test(ownContext)) return 'marks_metric';
    if (/email|e mail/.test(ownContext)) return 'email';
    if (/mobile|phone|contact number|telephone/.test(ownContext)) return 'mobile';
    if (/pin code|pincode|postal|zip/.test(ownContext)) return 'pincode';
    if (/percentage|percent/.test(ownContext)) return 'percentage';
    if (/cgpa/.test(ownContext)) return 'cgpa';
    if (/date of birth|birth date|\bdob\b/.test(ownContext)) return 'dob';
    if (/year of passing|passing year|pass year|completion year/.test(ownContext)) return 'passing_year';
    if (/first name|last name|father.*name|mother.*name|guardian.*name|applicant name|parent name/.test(ownContext)) return 'name';
    if (/country/.test(ownContext)) return 'country';
    if (/state|province/.test(ownContext)) return 'state';
    if (/district/.test(ownContext)) return 'district';
    if (/city|town/.test(ownContext)) return 'city';

    if (['radio', 'checkbox'].includes(type)) return '';

    const snapshot = debugFieldSnapshot(el);
    if (snapshot?.semantic && snapshot.confidence !== 'low') {
      return normalize(snapshot.semantic);
    }

    return snapshot?.semantic ? normalize(snapshot.semantic) : '';
  };

  const qaCleanLabel = (label, el = null) => {
    let text = String(label || 'Unnamed field').replace(/\s+/g, ' ').trim();
    if (normalize(el?.type) === 'radio') text = text.replace(/^(?:yes|no)\s+/i, '');
    text = text.replace(/\s*\*+\s*$/, '').trim();
    if (/i hereby declare|declaration|i agree/i.test(text) && text.length > 70) return 'Declaration Agreement';
    if (/permanent address same as address for correspondence/i.test(text)) return 'Permanent Address Same as Correspondence?';
    return text.length > 92 ? `${text.slice(0, 89).trim()}…` : text;
  };

  const qaAttemptUserEntry = async (el, value) => {
    const attemptedValue = String(value ?? '');
    const type = normalize(el?.type);

    if (!el || ['radio', 'checkbox'].includes(type) || el.tagName === 'SELECT') {
      qaSetNativeLikeValue(el, value);
      await sleep(70);
      return {
        method: 'control-interaction',
        attemptedValue,
        acceptedValue: String(el?.value ?? '')
      };
    }

    try { el.focus({ preventScroll: true }); } catch {}
    qaSetNativeLikeValue(el, '');

    const win = el.ownerDocument?.defaultView || window;
    const maxLength = Number(el.maxLength);
    const enforceMax = Number.isFinite(maxLength) && maxLength >= 0;

    for (const char of attemptedValue) {
      let allowed = true;
      try {
        const keydown = new win.KeyboardEvent('keydown', {
          key: char,
          bubbles: true,
          cancelable: true
        });
        allowed = el.dispatchEvent(keydown);
      } catch {}
      if (!allowed) continue;

      try {
        const beforeInput = new win.InputEvent('beforeinput', {
          data: char,
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        });
        allowed = el.dispatchEvent(beforeInput);
      } catch {}
      if (!allowed) continue;

      if (enforceMax && String(el.value ?? '').length >= maxLength) continue;
      qaSetNativeLikeValue(el, `${String(el.value ?? '')}${char}`);

      try {
        el.dispatchEvent(new win.KeyboardEvent('keyup', { key: char, bubbles: true }));
      } catch {}
    }

    try { el.dispatchEvent(new win.Event('blur', { bubbles: true })); } catch {}
    await sleep(90);

    return {
      method: 'user-like-entry',
      attemptedValue,
      acceptedValue: String(el.value ?? ''),
      normalizedOrBlocked: String(el.value ?? '') !== attemptedValue
    };
  };

  const qaButtonText = el => normalize(
    el?.innerText ||
    el?.textContent ||
    el?.value ||
    el?.getAttribute?.('aria-label') ||
    el?.title ||
    ''
  );

  const qaFindJourneyButtons = () => {
    const safe = [];
    const protectedFinal = [];
    const nodes = [...document.querySelectorAll(
      'button,input[type="button"],input[type="submit"],a,[role="button"]'
    )];

    for (const el of nodes) {
      if (!isVisible(el) || el.disabled) continue;
      const text = qaButtonText(el);
      if (!text) continue;

      if (/\bsubmit\b|pay|payment|generate application|confirm admission|finali[sz]e|place order/.test(text)) {
        protectedFinal.push(el);
        continue;
      }

      if (/^(?:next|continue|proceed)$|save\s*(?:&|and)\s*next|continue to|proceed to|next step/.test(text)) {
        safe.push(el);
      }
    }

    return { safe, protectedFinal };
  };

  const qaJourneyState = () => ({
    url: location.href,
    keys: visibleFillableFields()
      .filter(el => !isLikelyInternalField(el))
      .map(fieldKey)
      .sort()
      .join('|')
  });

  const qaClickJourneyButton = async button => {
    const before = qaJourneyState();
    const form = button?.form || button?.closest?.('form') || null;
    let submitAttempted = false;

    const guard = event => {
      submitAttempted = true;
      try { event.preventDefault(); } catch {}
    };

    try { form?.addEventListener('submit', guard, true); } catch {}
    try { button.click(); } catch {}
    await sleep(500);
    try { form?.removeEventListener('submit', guard, true); } catch {}

    const after = qaJourneyState();
    return {
      before,
      after,
      submitAttempted,
      progressed: before.url !== after.url || before.keys !== after.keys
    };
  };

  const qaFeedbackQuality = text => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'missing';
    if (clean.length < 8 || /^(?:required|invalid|error|mandatory|please enter)$/i.test(clean)) return 'generic';
    return 'clear';
  };

  const qaRunDependencyChain = async fields => {
    const map = new Map();
    for (const el of fields) {
      if (el.tagName !== 'SELECT') continue;
      const semantic = qaSemanticFor(el);
      if (semantic && !map.has(semantic)) map.set(semantic, el);
    }

    const chain = ['country', 'state', 'district', 'city']
      .map(key => map.get(key))
      .filter(Boolean);

    if (chain.length < 2) return [];

    const snapshots = chain.map(el => [el, qaSnapshotFieldValue(el)]);
    const results = [];

    try {
      for (let i = 0; i < chain.length - 1; i++) {
        if (state.stopRequested) break;
        const parent = chain[i];
        const child = chain[i + 1];
        const options = validOptions(parent);

        if (!options.length) {
          results.push({
            el: child,
            status: 'review',
            name: 'Dependent dropdown could not be exercised',
            actual: `${qaCleanLabel(qaHumanLabel(parent), parent)} has no selectable option in the current state.`
          });
          break;
        }

        const current = String(parent.value ?? '');
        const target = options.find(option => String(option.value) !== current) || options[0];
        const before = `${String(child.value ?? '')}|${validOptions(child).length}|${!!child.disabled}`;

        parent.value = target.value;
        qaDispatchInteraction(parent);

        let reacted = false;
        const started = Date.now();
        while (Date.now() - started < 1800) {
          await sleep(120);
          const now = `${String(child.value ?? '')}|${validOptions(child).length}|${!!child.disabled}`;
          if (now !== before) {
            reacted = true;
            break;
          }
        }

        results.push({
          el: child,
          status: reacted ? 'passed' : 'review',
          name: 'Dependent dropdown response',
          actual: reacted
            ? `${qaCleanLabel(qaHumanLabel(child), child)} reacted after ${qaCleanLabel(qaHumanLabel(parent), parent)} changed.`
            : `${qaCleanLabel(qaHumanLabel(child), child)} did not visibly react after its parent changed.`
        });

        const childOptions = validOptions(child);
        if (childOptions.length && !String(child.value ?? '')) {
          child.value = childOptions[0].value;
          qaDispatchInteraction(child);
          await sleep(180);
        }
      }
    } finally {
      for (const [el, snapshot] of [...snapshots].reverse()) {
        if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
        await sleep(160);
      }
    }

    return results;
  };

  const qaRunJourneyChecks = async (fields, candidates) => {
    const rows = [];
    if (state.stopRequested) return rows;
    const buttons = qaFindJourneyButtons();

    if (buttons.protectedFinal.length) {
      rows.push({
        status: 'review',
        name: 'Final submission protection',
        actual: `${buttons.protectedFinal.length} final/transaction action(s) were detected and intentionally not clicked automatically. Confirm final-submit validation manually.`
      });
    }

    const button = buttons.safe[0];
    if (!button) {
      rows.push({
        status: 'review',
        name: 'Next / Continue validation',
        actual: 'No safe Next, Continue or Save & Next action was available on this step.'
      });
      return rows;
    }

    const required = fields.filter(el => {
      if (!el?.isConnected || normalize(el.type) === 'file' || el.readOnly) return false;
      const signals = qaRequiredSignals(el);
      return signals.visible || signals.configured || isRequired(el);
    }).slice(0, 8);

    if (required.length) {
      const snapshots = required.map(el => [el, qaSnapshotFieldValue(el)]);

      for (const el of required) {
        if (el.tagName === 'SELECT') {
          const placeholder = [...el.options].find(option =>
            !option.disabled &&
            (!String(option.value || '').trim() || /^(?:select|choose|please select|--)/i.test(String(option.textContent || '').trim()))
          );
          if (placeholder) el.value = placeholder.value;
          else el.selectedIndex = -1;
        } else if (normalize(el.type) === 'checkbox') {
          el.checked = false;
        } else if (normalize(el.type) === 'radio') {
          radioGroupMembers(el).forEach(item => { item.checked = false; });
        } else {
          qaSetNativeLikeValue(el, '');
        }
        qaDispatchInteraction(el);
      }

      const click = await qaClickJourneyButton(button);
      const messages = required
        .map(el => [el, qaVisibleFeedback(el)])
        .filter(([, feedback]) => feedback.invalid);

      if (messages.length) {
        rows.push({
          status: 'passed',
          name: 'Required fields on Next / Continue',
          actual: `Progression was blocked and validation appeared for ${messages.length} required field(s).`
        });
      } else if (click.progressed || click.submitAttempted) {
        rows.push({
          status: 'failed',
          name: 'Required fields on Next / Continue',
          actual: 'The form attempted to progress while required test fields were blank and no clear validation message was captured.'
        });
      } else {
        rows.push({
          status: 'review',
          name: 'Required fields on Next / Continue',
          actual: 'Progression did not occur, but Smart FormSense could not confirm clear field-level validation messages.'
        });
      }

      for (const [el, feedback] of messages) {
        if (qaFeedbackQuality(feedback.text) !== 'clear') {
          rows.push({
            el,
            status: 'review',
            name: 'Validation message could be clearer',
            actual: feedback.text || 'Validation was triggered, but the message was missing or too generic.'
          });
        }
      }

      for (const [el, snapshot] of snapshots) {
        if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
      }

      if (click.progressed) return rows;
    }

    for (const candidate of candidates.slice(0, 3)) {
      if (state.stopRequested) break;
      const el = candidate.el;
      if (!el?.isConnected || !button?.isConnected) continue;

      const snapshot = qaSnapshotFieldValue(el);
      const entry = await qaAttemptUserEntry(el, candidate.testCase.value);
      const click = await qaClickJourneyButton(button);
      const feedback = qaVisibleFeedback(el);

      if (feedback.invalid) {
        rows.push({
          el,
          status: 'passed',
          name: candidate.testCase.label,
          actual: `Next/Continue triggered validation: ${feedback.text}`,
          evidence: {
            method: 'journey-probe',
            attemptedValue: entry.attemptedValue,
            acceptedValue: entry.acceptedValue,
            feedback: feedback.text || '',
            progressed: click.progressed,
            submitAttempted: click.submitAttempted
          }
        });
      } else if (click.progressed || click.submitAttempted) {
        rows.push({
          el,
          status: 'failed',
          name: candidate.testCase.label,
          actual: `The invalid value ${JSON.stringify(entry.acceptedValue)} was allowed through the Next/Continue action without clear validation.`,
          evidence: {
            method: 'journey-probe',
            attemptedValue: entry.attemptedValue,
            acceptedValue: entry.acceptedValue,
            feedback: '',
            progressed: click.progressed,
            submitAttempted: click.submitAttempted
          }
        });
      } else {
        rows.push({
          el,
          status: 'review',
          name: candidate.testCase.label,
          actual: 'Next/Continue did not progress, but no clear validation message was captured.',
          evidence: {
            method: 'journey-probe',
            attemptedValue: entry.attemptedValue,
            acceptedValue: entry.acceptedValue,
            feedback: '',
            progressed: click.progressed,
            submitAttempted: click.submitAttempted
          }
        });
      }

      if (el?.isConnected) await qaRestoreFieldValue(el, snapshot);
      if (click.progressed) break;
    }

    return rows;
  };

  const qaFunctionalCasesFor = el => {
    const type = normalize(el.type);
    const semantic = qaSemanticFor(el);
    const currentYear = new Date().getFullYear();
    const cases = [];

    const add = (id, label, value, expectation, severity = 'warning') => {
      cases.push({ id, label, value, expectation, severity });
    };

    if (semantic === 'email') {
      add('email-invalid', 'Reject malformed email', 'qa.invalid@', 'reject');
      add('email-valid', 'Accept valid email', 'qa.test.user@gmail.com', 'accept');
    } else if (semantic === 'mobile') {
      add('mobile-alpha', 'Reject alphabetic mobile number', '98ABCD1234', 'reject');
      add('mobile-short', 'Reject short mobile number', '98765', 'reject');
      add('mobile-valid', 'Accept valid 10-digit mobile number', '9876543210', 'accept');
    } else if (semantic === 'pincode') {
      add('pincode-alpha', 'Reject alphabetic pincode', '11AB01', 'reject');
      add('pincode-short', 'Reject short pincode', '11001', 'reject');
      add('pincode-valid', 'Accept valid 6-digit pincode', '110001', 'accept');
    } else if (semantic === 'percentage') {
      add('percentage-over', 'Reject percentage above 100', '101', 'reject');
      add('percentage-valid', 'Accept valid percentage', '75', 'accept');
    } else if (semantic === 'cgpa') {
      add('cgpa-over', 'Reject CGPA above expected range', '11', 'reject');
      add('cgpa-valid', 'Accept valid CGPA', '8.5', 'accept');
    } else if (semantic === 'passing_year') {
      add('year-future', 'Reject future passing year', String(currentYear + 5), 'reject');
      add('year-valid', 'Accept realistic passing year', String(currentYear - 3), 'accept');
    } else if (semantic === 'dob') {
      if (!el.readOnly) {
        if (type === 'date') {
          add('dob-future', 'Reject future date of birth', `${currentYear + 1}-01-15`, 'reject');
          add('dob-valid', 'Accept realistic date of birth', '2000-01-15', 'accept');
        } else {
          add('dob-invalid', 'Reject impossible date of birth', '31/02/2020', 'reject');
          add('dob-valid', 'Accept realistic date of birth', '15/01/2000', 'accept');
        }
      }
    } else if (semantic === 'name') {
      add('name-numeric', 'Reject numeric-only name', '123456', 'reject');
      add('name-valid', 'Accept normal name', 'Test User', 'accept');
    }

    const maxLength = Number(el.getAttribute?.('maxlength'));
    if (
      Number.isFinite(maxLength) &&
      maxLength > 0 &&
      maxLength <= 120 &&
      !['file', 'radio', 'checkbox'].includes(type)
    ) {
      add(
        'maxlength-boundary',
        `Enforce maximum length of ${maxLength}`,
        'A'.repeat(maxLength + 1),
        'reject',
        'warning'
      );
    }

    if (
      type === 'number' &&
      el.getAttribute?.('max') !== null &&
      el.getAttribute?.('max') !== ''
    ) {
      const max = Number(el.getAttribute('max'));
      if (Number.isFinite(max)) {
        add('number-over-max', `Reject value above maximum ${max}`, String(max + 1), 'reject');
      }
    }

    if (
      type === 'number' &&
      el.getAttribute?.('min') !== null &&
      el.getAttribute?.('min') !== ''
    ) {
      const min = Number(el.getAttribute('min'));
      if (Number.isFinite(min)) {
        add('number-under-min', `Reject value below minimum ${min}`, String(min - 1), 'reject');
      }
    }

    return cases.slice(0, 4);
  };

  const qaRunOneFieldCase = async (el, testCase) => {
    const before = qaVisibleFeedback(el);
    const snapshot = qaSnapshotFieldValue(el);
    const entry = await qaAttemptUserEntry(el, testCase.value);
    const after = qaVisibleFeedback(el);
    const exact = entry.acceptedValue === entry.attemptedValue;
    const newFeedback = after.invalid && (!before.invalid || after.signature !== before.signature);

    let status = 'passed';
    let actual = '';

    if (testCase.expectation === 'reject') {
      if (!exact) {
        status = 'passed';
        actual = `The control prevented or normalized the invalid entry. Accepted value: ${JSON.stringify(entry.acceptedValue)}.`;
      } else if (newFeedback || after.invalid) {
        status = 'passed';
        actual = `The invalid value produced validation feedback${after.text ? `: ${after.text}` : '.'}`;
      } else {
        status = 'review';
        actual = 'The invalid value could be entered without immediate feedback. Smart FormSense will confirm it against Next/Continue before calling it a defect.';
      }
    } else if (exact && !after.invalid) {
      status = 'passed';
      actual = 'The valid value was accepted without a validation error.';
    } else {
      status = 'failed';
      actual = exact
        ? `The valid value remained but validation feedback was still present${after.text ? `: ${after.text}` : '.'}`
        : `The valid value could not be entered as expected. Accepted value: ${JSON.stringify(entry.acceptedValue)}.`;
    }

    await qaRestoreFieldValue(el, snapshot);

    return {
      status,
      actual,
      attemptedValue: entry.attemptedValue,
      evidence: {
        method: entry.method,
        attemptedValue: entry.attemptedValue,
        acceptedValue: entry.acceptedValue,
        feedback: after.text || '',
        restored: true
      }
    };
  };

  const qaRunRequiredBlankCase = async el => {
    const snapshot = qaSnapshotFieldValue(el);
    const before = qaVisibleFeedback(el);
    const type = normalize(el.type);

    if (type === 'radio') {
      for (const member of radioGroupMembers(el)) {
        member.checked = false;
      }
      if (radioGroupMembers(el)[0]) qaDispatchInteraction(radioGroupMembers(el)[0]);
    } else if (type === 'checkbox') {
      el.checked = false;
      qaDispatchInteraction(el);
    } else if (el.tagName === 'SELECT') {
      const placeholder = [...el.options].find(option =>
        !option.disabled &&
        (!String(option.value || '').trim() || /^(?:select|choose|please select|--)/i.test(String(option.textContent || '').trim()))
      );
      if (placeholder) {
        el.value = placeholder.value;
      } else {
        el.selectedIndex = -1;
      }
      qaDispatchInteraction(el);
    } else if (!el.readOnly) {
      qaSetNativeLikeValue(el, '');
    } else {
      await qaRestoreFieldValue(el, snapshot);
      return {
        status: 'review',
        actual: /datepicker/i.test(String(el.className || ''))
          ? 'Field is controlled by a date picker and cannot be meaningfully blank-tested through direct typing.'
          : 'Field is read-only, so blank validation needs journey-level confirmation.',
        feedback: ''
      };
    }

    await sleep(110);
    const after = qaVisibleFeedback(el);
    const nativeMissing = !!el.validity?.valueMissing;
    const feedbackAppeared = after.invalid && (!before.invalid || after.signature !== before.signature);

    const status = nativeMissing || feedbackAppeared ? 'passed' : 'review';
    const actual = status === 'passed'
      ? `Empty required value produced validation feedback${after.text ? `: ${after.text}` : '.'}`
      : 'No field-level validation appeared after leaving the required field empty. It may validate only when the user continues or submits.';

    await qaRestoreFieldValue(el, snapshot);

    return {
      status,
      actual,
      feedback: after.text || ''
    };
  };

  const qaRunSelectInteractionCase = async el => {
    const options = validOptions(el);
    if (!options.length) {
      return {
        status: 'review',
        actual: 'No option is currently available. A parent selection may need to load this dropdown.'
      };
    }

    const snapshot = qaSnapshotFieldValue(el);
    const current = String(el.value ?? '');
    const target = options.find(option => String(option.value) !== current) || options[0];

    el.value = target.value;
    qaDispatchInteraction(el);
    await sleep(90);

    const retained = String(el.value ?? '') === String(target.value);
    const feedback = qaVisibleFeedback(el);

    await qaRestoreFieldValue(el, snapshot);

    return {
      status: retained && !feedback.invalid ? 'passed' : 'failed',
      actual: retained
        ? (feedback.invalid ? `Selection changed but validation feedback remained: ${feedback.text}` : 'A valid dropdown option could be selected and retained.')
        : 'A valid dropdown option could not be selected or retained.'
    };
  };

  const qaRunToggleCase = async el => {
    const snapshot = qaSnapshotFieldValue(el);
    const type = normalize(el.type);

    let changed = false;

    if (type === 'checkbox') {
      const target = !el.checked;
      qaSetNativeLikeValue(el, target);
      await sleep(70);
      changed = !!el.checked === target;
    } else if (type === 'radio') {
      const members = radioGroupMembers(el);
      const current = members.find(item => item.checked);
      const target = members.find(item => item !== current && !item.disabled) || members.find(item => !item.disabled);
      if (target) {
        target.checked = true;
        qaDispatchInteraction(target);
        await sleep(70);
        changed = !!target.checked;
      }
    }

    await qaRestoreFieldValue(el, snapshot);

    return {
      status: changed ? 'passed' : 'failed',
      actual: changed
        ? 'Control changed state successfully and the original state was restored.'
        : 'Control did not change state as expected.'
    };
  };

  const qaDependencyCandidates = fields => {
    const bySemantic = new Map();

    for (const el of fields) {
      if (el.tagName !== 'SELECT') continue;
      const semantic = qaSemanticFor(el);
      if (semantic && !bySemantic.has(semantic)) bySemantic.set(semantic, el);
    }

    return [
      ['country', 'state'],
      ['state', 'district'],
      ['district', 'city']
    ]
      .map(([parent, child]) => ({
        parent: bySemantic.get(parent),
        child: bySemantic.get(child),
        parentSemantic: parent,
        childSemantic: child
      }))
      .filter(pair => pair.parent && pair.child);
  };

  const qaRunDependencyCase = async pair => {
    const parent = pair.parent;
    const child = pair.child;
    const parentOptions = validOptions(parent);

    if (parentOptions.length < 2) {
      return {
        status: 'review',
        actual: 'Not enough parent options were available to safely exercise the dependency.'
      };
    }

    const parentSnapshot = qaSnapshotFieldValue(parent);
    const childSnapshot = qaSnapshotFieldValue(child);
    const before = {
      value: String(child.value ?? ''),
      optionCount: validOptions(child).length,
      disabled: !!child.disabled
    };

    const current = String(parent.value ?? '');
    const target = parentOptions.find(option => String(option.value) !== current) || parentOptions[0];

    parent.value = target.value;
    qaDispatchInteraction(parent);

    let reacted = false;
    const started = Date.now();

    while (Date.now() - started < 1500) {
      await sleep(120);
      const now = {
        value: String(child.value ?? ''),
        optionCount: validOptions(child).length,
        disabled: !!child.disabled
      };

      if (
        now.value !== before.value ||
        now.optionCount !== before.optionCount ||
        now.disabled !== before.disabled
      ) {
        reacted = true;
        break;
      }
    }

    await qaRestoreFieldValue(parent, parentSnapshot);
    await sleep(500);
    await qaRestoreFieldValue(child, childSnapshot);

    return {
      status: reacted ? 'passed' : 'review',
      actual: reacted
        ? `${qaHumanLabel(child)} reacted when ${qaHumanLabel(parent)} changed, and the original values were restored.`
        : `${qaHumanLabel(child)} did not visibly change during the safe dependency probe. Confirm the dependency manually if it is expected to change.`
    };
  };

  const qaMarkReportIncomplete = (report, runState = 'stopped', reason = '') => {
    const base = report && typeof report === 'object'
      ? report
      : {
          reportVersion: 5,
          product: 'Smart FormSense',
          productVersion: '17.11.2',
          generatedAt: new Date().toISOString(),
          auditType: 'Black-box Functional Form QA',
          page: {
            url: location.href,
            hostname: location.hostname,
            pathname: location.pathname,
            title: document.title || ''
          },
          formSignature: state.currentFormSignature || null,
          fieldsAudited: 0,
          fieldsChecked: 0,
          checksRun: 0,
          score: 0,
          rating: 'Partial',
          coverage: 0,
          summary: {
            riskLevel: 'Review',
            headline: 'QA did not complete. Review the partial results below.',
            recommendation: 'Use the completed checks below, then rerun QA for the remaining fields.',
            fieldsAudited: 0,
            fieldsChecked: 0,
            checksRun: 0,
            completed: 0,
            coverage: 0,
            score: 0
          },
          counts: { critical: 0, warning: 0, observation: 0, passed: 0 },
          categoryCounts: {},
          findings: [],
          testCases: [],
          notes: []
        };

    const cleanReason = String(reason || '').slice(0, 500);
    return {
      ...base,
      productVersion: '17.11.2',
      reportVersion: Math.max(5, Number(base.reportVersion || 0)),
      runState,
      incomplete: runState !== 'completed',
      stopReason: cleanReason,
      completedAt: new Date().toISOString(),
      notes: [
        ...(Array.isArray(base.notes) ? base.notes : []),
        runState === 'stopped'
          ? 'This is a partial report because the QA run was stopped by the user. All completed checks are retained.'
          : runState === 'failed'
            ? 'This is a partial report because the QA run was interrupted. All completed checks are retained.'
            : ''
      ].filter(Boolean)
    };
  };

  const qaFallbackPartialReport = (runState, reason) =>
    qaMarkReportIncomplete(null, runState, reason);

  const buildQaFunctionalReport = async () => {
    const generatedAt = new Date().toISOString();
    const findings = [];
    const testCases = [];
    const journeyCandidates = [];
    const seenRadioGroups = new Set();
    let fields = [];

    try {
      fields = visibleFillableFields().filter(el =>
        el &&
        !isLikelyInternalField(el) &&
        !['hidden', 'submit', 'button', 'reset'].includes(normalize(el.type))
      );
    } catch {}

    const assembleReport = (runState = 'running', stopReason = '') => {
      const blockers = testCases.filter(item => item.status === 'blocker').length;
      const failed = testCases.filter(item => item.status === 'failed').length;
      const review = testCases.filter(item => ['review', 'manual', 'warning'].includes(item.status)).length;
      const passed = testCases.filter(item => item.status === 'passed').length;
      const counts = { critical: blockers, warning: failed, observation: review, passed };
      const checksRun = testCases.length;
      const completed = blockers + failed + passed;
      const score = completed
        ? Math.round(clamp((passed / completed) * 100, 0, 100))
        : 0;
      const coverage = checksRun
        ? Math.round(clamp((completed / checksRun) * 100, 0, 100))
        : 0;
      const checkedKeys = new Set(
        testCases.map(item => item.fieldKey).filter(Boolean)
      );
      const fieldsChecked = Math.min(fields.length, checkedKeys.size);
      const incomplete = runState !== 'completed';
      const rating = incomplete
        ? (runState === 'failed' ? 'Interrupted' : runState === 'stopped' ? 'Stopped' : 'Running')
        : blockers > 0
          ? 'Blocked'
          : failed > 0
            ? 'Needs Attention'
            : review > 0
              ? 'Needs Review'
              : 'Strong';

      const summary = {
        riskLevel: blockers > 0
          ? 'High'
          : failed > 0
            ? 'Moderate'
            : review > 0 || incomplete
              ? 'Review'
              : 'Low',
        headline: incomplete
          ? `${fieldsChecked} of ${fields.length} field${fields.length === 1 ? '' : 's'} have usable QA results so far.`
          : blockers > 0
            ? `${blockers} blocker${blockers === 1 ? '' : 's'} need attention before go-live.`
            : failed > 0
              ? `${failed} confirmed issue${failed === 1 ? '' : 's'} should be fixed before go-live.`
              : review > 0
                ? `No confirmed failure was reproduced. ${review} check${review === 1 ? '' : 's'} still need review.`
                : 'No applicant-facing issue was reproduced in the completed automated checks.',
        recommendation: incomplete
          ? 'Use this partial report for completed checks, then rerun QA to cover the remaining fields.'
          : blockers > 0 || failed > 0
            ? 'Fix the confirmed applicant-facing issues, rerun QA, then complete the remaining manual checks.'
            : review > 0
              ? 'Complete only the listed manual/review checks before final sign-off.'
              : 'Complete a brief final human journey check before sign-off.',
        fieldsAudited: fields.length,
        fieldsChecked,
        checksRun,
        completed,
        coverage,
        score
      };

      const categoryCounts = {};
      for (const item of findings) {
        categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
      }

      return {
        reportVersion: 5,
        product: 'Smart FormSense',
        productVersion: '17.11.2',
        generatedAt,
        completedAt: runState === 'completed' || runState === 'stopped' || runState === 'failed'
          ? new Date().toISOString()
          : null,
        auditType: 'Black-box Functional Form QA',
        runState,
        incomplete,
        stopReason: String(stopReason || '').slice(0, 500),
        page: {
          url: location.href,
          hostname: location.hostname,
          pathname: location.pathname,
          title: document.title || ''
        },
        formSignature: state.currentFormSignature || null,
        fieldsAudited: fields.length,
        fieldsChecked,
        checksRun,
        score,
        rating,
        coverage,
        summary,
        counts,
        categoryCounts,
        findings: [...findings],
        testCases: [...testCases],
        notes: [
          'Smart FormSense tests the finished form from the applicant/user point of view; it does not audit backend implementation choices.',
          'Field values are temporarily changed for safe black-box tests and restored after each test case.',
          'Safe Next/Continue/Save & Next actions may be tested after field checks; final submit/payment/generate-application actions are always protected.',
          'A field-level negative test is not called a defect unless stronger applicant-journey evidence confirms it.',
          'File uploads, final submission, and some widget-specific behaviours remain manual QA steps.',
          incomplete ? 'This report is partial. Completed checks are preserved even when QA is stopped or interrupted.' : ''
        ].filter(Boolean)
      };
    };

    const publishPartial = (runState = 'running', stopReason = '', forceUi = false) => {
      const report = assembleReport(runState, stopReason);
      state.qaReport = report;
      if (
        forceUi ||
        testCases.length <= 1 ||
        testCases.length % 3 === 0 ||
        runState !== 'running'
      ) {
        state.panel?.setQaReport?.(report);
      }
      return report;
    };

    // Export is useful from the first moment of a QA run, even if the run is
    // later stopped or interrupted.
    publishPartial('running', '', true);
    state.panel?.setQaProgress?.(2, `Preparing ${fields.length} field(s)`);

    const addCase = ({
      el = null,
      category = 'Functional Behaviour',
      name = 'Functional test',
      status = 'review',
      expected = '',
      actual = '',
      attemptedValue = '',
      evidence = null,
      guidance = ''
    }) => {
      const field = el ? qaCleanLabel(qaHumanLabel(el), el) : '';
      const fieldKeyValue = el ? fieldKey(el) : null;
      const row = {
        id: `tc_${testCases.length + 1}`,
        category,
        name,
        status,
        field,
        fieldKey: fieldKeyValue,
        expected,
        actual,
        attemptedValue,
        evidence
      };

      testCases.push(row);
      if (status === 'passed') {
        publishPartial('running');
        return;
      }

      const severity =
        status === 'blocker'
          ? 'critical'
          : status === 'failed'
            ? 'warning'
            : 'observation';

      findings.push({
        id: `qa_${findings.length + 1}`,
        severity,
        category,
        title: name,
        message: actual,
        fieldKey: fieldKeyValue,
        field,
        expected,
        actual,
        guidance: guidance || (
          status === 'failed'
            ? 'Review this user-facing field or validation setting in the form builder and rerun QA.'
            : 'Confirm this behaviour manually during the form journey.'
        ),
        testCaseId: row.id,
        attemptedValue,
        evidence
      });

      publishPartial('running');
    };

    if (!fields.length) {
      addCase({
        category: 'Form Detection',
        name: 'Detect active form',
        status: 'review',
        expected: 'At least one active user-facing form field',
        actual: 'No active user-facing form fields were detected.',
        guidance: 'Confirm the form is fully loaded and the correct page/frame is active.'
      });
    }

    state.panel?.setStatus?.(`Functional QA • analysing ${fields.length} field(s)...`);

    for (let index = 0; index < fields.length; index++) {
      if (state.stopRequested) break;

      const el = fields[index];
      const type = normalize(el.type);
      const label = qaCleanLabel(qaHumanLabel(el), el);

      if (type === 'radio') {
        const key = `${el.ownerDocument?.URL || ''}|${el.name || fieldKey(el)}`;
        if (seenRadioGroups.has(key)) continue;
        seenRadioGroups.add(key);
      }

      const fieldPercent = fields.length
        ? Math.round(5 + ((index + 1) / fields.length) * 75)
        : 80;
      state.panel?.setQaProgress?.(fieldPercent, `Checking ${index + 1}/${fields.length} • ${label}`);
      state.panel?.setStatus?.(`Functional QA • ${index + 1}/${fields.length} • ${label}`);

      const requiredSignals = qaRequiredSignals(el);
      const required = !!(
        requiredSignals.visible ||
        requiredSignals.configured ||
        isRequired(el)
      );

      if (type === 'file') {
        addCase({
          el,
          category: 'File Upload',
          name: 'File upload behaviour',
          status: 'review',
          expected: required
            ? 'Valid file uploads; invalid type/size is rejected; missing required file blocks progression.'
            : 'Valid file uploads; invalid type/size is rejected.',
          actual: 'Browser security requires a real file selection for this test.',
          guidance: 'Check one valid file, wrong type, oversized file, remove/re-upload, and required behaviour.'
        });
        continue;
      }

      const adapter = debugFieldSnapshot(el)?.adapter || '';
      const isDateWidget = /datepicker/i.test(String(adapter)) || /datepicker/i.test(String(el.className || ''));

      if (el.readOnly) {
        if (isDateWidget) {
          addCase({
            el,
            category: 'Date Picker',
            name: 'Date-picker interaction',
            status: 'review',
            expected: 'The user can open the date picker, choose an allowed date, and keep the selected value.',
            actual: 'This field is controlled by a date-picker widget.',
            guidance: 'Verify calendar opening, allowed/disabled dates, selection, close behaviour and persistence.'
          });
        } else if (fieldHasValue(el)) {
          addCase({
            el,
            category: 'Prefilled Fields',
            name: 'Prefilled locked field',
            status: 'passed',
            expected: 'The prefilled value remains present and cannot be accidentally edited.',
            actual: 'The field is prefilled, read-only, and retained its value.'
          });
        } else if (required) {
          addCase({
            el,
            category: 'Prefilled Fields',
            name: 'Required locked field is empty',
            status: 'review',
            expected: 'A required read-only field should be populated before it can block the applicant.',
            actual: 'The field is required, read-only and currently empty.',
            guidance: 'Confirm whether an earlier selection or step is expected to populate this field.'
          });
        }
        continue;
      }

      if (required) {
        const result = await qaRunRequiredBlankCase(el);
        addCase({
          el,
          category: 'Mandatory Validation',
          name: 'Required-field behaviour',
          status: result.status,
          expected: 'A mandatory field should block progression when empty and show useful validation at the appropriate time.',
          actual: result.actual,
          evidence: {
            method: 'field-blank-probe',
            feedback: result.feedback || ''
          },
          guidance: result.status === 'review'
            ? 'Smart FormSense will also check this through Next/Continue.'
            : ''
        });
      }

      if (el.tagName === 'SELECT') {
        const result = await qaRunSelectInteractionCase(el);
        addCase({
          el,
          category: 'Dropdown Behaviour',
          name: 'Option selection',
          status: result.status,
          expected: 'A selectable option can be chosen and retained without an error.',
          actual: result.actual
        });
      } else if (['checkbox', 'radio'].includes(type)) {
        const result = await qaRunToggleCase(el);
        addCase({
          el,
          category: 'Choice Controls',
          name: 'Selection behaviour',
          status: result.status,
          expected: 'The user can change the selection and the control responds correctly.',
          actual: result.actual
        });
      }

      const semantic = qaSemanticFor(el);
      if (semantic === 'marks_metric') {
        addCase({
          el,
          category: 'Input Validation',
          name: 'Marks range follows marking scheme',
          status: 'review',
          expected: 'Percentage/CGPA range should match the selected marking scheme.',
          actual: 'This field supports both Percentage and CGPA, so a single fixed range cannot be safely inferred.',
          guidance: 'Switch the Marking Scheme and confirm the accepted range/message changes appropriately.'
        });
      }

      const functionalCases = qaFunctionalCasesFor(el);
      for (const testCase of functionalCases) {
        if (state.stopRequested) break;

        const result = await qaRunOneFieldCase(el, testCase);
        addCase({
          el,
          category: 'Input Validation',
          name: testCase.label,
          status: result.status,
          expected: testCase.expectation === 'reject'
            ? 'Invalid value should be blocked, normalized, or clearly rejected during the applicant journey.'
            : 'Valid value should be accepted without a validation error.',
          actual: result.actual,
          attemptedValue: result.attemptedValue,
          evidence: result.evidence,
          guidance: result.status === 'failed'
            ? `Review this validation in the form builder. Tested value: ${JSON.stringify(result.attemptedValue)}.`
            : ''
        });

        if (result.status === 'review' && testCase.expectation === 'reject') {
          journeyCandidates.push({ el, testCase });
        }
      }

      await yieldToUI();
    }

    if (!state.stopRequested) {
      state.panel?.setQaProgress?.(84, 'Checking field dependencies');
    }

    for (const row of state.stopRequested ? [] : await qaRunDependencyChain(fields)) {
      addCase({
        el: row.el || null,
        category: 'Dependencies',
        name: row.name,
        status: row.status,
        expected: 'Dependent dropdowns should load/reset in parent-to-child order.',
        actual: row.actual,
        guidance: row.status === 'review'
          ? 'Verify the parent-to-child dependency once manually if this chain is expected.'
          : ''
      });
    }

    if (!state.stopRequested) {
      state.panel?.setQaProgress?.(92, 'Checking Next / Continue journey validation');
    }

    for (const row of state.stopRequested ? [] : await qaRunJourneyChecks(fields, journeyCandidates)) {
      addCase({
        el: row.el || null,
        category: 'Journey Validation',
        name: row.name,
        status: row.status,
        expected: 'Next/Continue should enforce validation without executing protected final actions.',
        actual: row.actual,
        evidence: row.evidence || null,
        guidance: row.status === 'failed'
          ? 'Review the affected validation in the form builder and rerun this journey check.'
          : row.status === 'review'
            ? 'Complete this remaining journey check manually.'
            : ''
      });
    }

    const finalState = state.stopRequested ? 'stopped' : 'completed';
    const finalReason = state.stopRequested ? 'Stopped by user' : '';
    const report = publishPartial(finalState, finalReason, true);
    state.panel?.setQaProgress?.(
      finalState === 'completed' ? 100 : Math.max(1, Number(state.qaProgressPercent || 0)),
      finalState === 'completed'
        ? 'QA completed'
        : `Stopped • ${report.fieldsChecked} of ${report.fieldsAudited} fields have results`
    );
    return report;
  };

  const runSmartQaAudit = async () => {
    if (!IS_TOP || state.running) return;

    state.workspace = 'qa';
    state.running = true;
    state.stopRequested = false;
    state.panel?.setBusy(true);
    state.panel?.setQaProgress?.(1, 'Locating the active form');
    state.panel?.setStatus('Locating the active form for QA Audit...');
    state.panel?.setMode('qa');

    try {
      const context = await chooseExecutionContext();

      if (context.kind === 'remote') {
        const result = await sendRemoteCommand(
          context.agent,
          'qa-audit'
        );

        if (result?.qaReport) {
          state.qaReport = result.qaReport;
          state.panel?.setQaReport?.(result.qaReport);
        }

        return state.qaReport;
      }

      if (context.kind === 'none') {
        const report = await buildQaFunctionalReport();
        state.qaReport = report;
        state.panel?.setQaReport?.(report);
        state.panel?.setStatus(
          'QA Audit completed, but no meaningful active form was detected.'
        );
        return report;
      }

      state.lastRemoteAgentId = null;

      const report = await buildQaFunctionalReport();
      state.qaReport = report;
      state.panel?.setQaReport?.(report);
      state.panel?.setStatus(
        report.incomplete
          ? `Functional QA stopped • Partial report • ${report.fieldsChecked}/${report.fieldsAudited} fields with results`
          : `Functional QA completed • Score ${report.score}/100 • ${report.counts.critical} blocker(s) • ${report.counts.warning} failed`
      );

      return report;
    } catch (error) {
      const reason = error?.message || 'unknown error';
      const partial = qaMarkReportIncomplete(
        state.qaReport || qaFallbackPartialReport('failed', reason),
        'failed',
        reason
      );
      state.qaReport = partial;
      state.panel?.setQaReport?.(partial);
      state.panel?.setQaProgress?.(
        Number(partial.summary?.fieldsAudited || partial.fieldsAudited || 0)
          ? Math.max(1, Math.round((Number(partial.fieldsChecked || 0) / Math.max(1, Number(partial.fieldsAudited || 0))) * 80))
          : 1,
        `Interrupted • partial report available`
      );
      state.panel?.setStatus(
        `QA interrupted safely: ${reason} • Partial report is available.`
      );
      return partial;
    } finally {
      state.running = false;
      state.activeRemoteAgentId = null;
      state.activeRemoteRequestId = null;
      state.activeRemoteAction = null;
      state.panel?.setBusy(false);
    }
  };

  const navigateSmartQaFinding = key => {
    const agent = remoteAgentById(
      state.lastRemoteAgentId
    );

    if (agent?.source) {
      try {
        agent.source.postMessage(
          bridgePayload(
            'NAVIGATE_QA',
            {
              sessionId: bridge.sessionId,
              agentId: agent.id,
              fieldKey: key
            }
          ),
          '*'
        );

        return true;
      } catch {}
    }

    return navigateQaFinding(key);
  };

  const requestSmartStop = () => {
    state.stopRequested =
      true;

    const agent =
      remoteAgentById(
        state.activeRemoteAgentId
      );

    if (
      agent?.source &&
      state.activeRemoteRequestId
    ) {
      try {
        agent.source.postMessage(
          bridgePayload(
            'STOP',
            {
              sessionId:
                bridge.sessionId,
              agentId:
                agent.id,
              requestId:
                state.activeRemoteRequestId
            }
          ),
          '*'
        );
      } catch {}
    }
  };

  const navigateSmartStat =
    type => {
      const agent =
        remoteAgentById(
          state.lastRemoteAgentId
        );

      if (
        agent?.source
      ) {
        try {
          agent.source.postMessage(
            bridgePayload(
              'NAVIGATE_STAT',
              {
                sessionId:
                  bridge.sessionId,
                agentId:
                  agent.id,
                statType:
                  type
              }
            ),
            '*'
          );

          return;
        } catch {}
      }

      navigateStat(
        type
      );
    };

  const smartUndo = () => {
    const agent =
      remoteAgentById(
        state.lastRemoteAgentId
      );

    if (
      agent?.source
    ) {
      try {
        agent.source.postMessage(
          bridgePayload(
            'UNDO',
            {
              sessionId:
                bridge.sessionId,
              agentId:
                  agent.id
            }
          ),
          '*'
        );

        state.panel?.setStatus(
          'Undo requested inside embedded form.'
        );

        return;
      } catch {}
    }

    undo();
  };

  const smartDebugExport = () => {
    const agent =
      remoteAgentById(
        state.lastRemoteAgentId
      );

    if (
      agent?.source
    ) {
      try {
        agent.source.postMessage(
          bridgePayload(
            'DEBUG',
            {
              sessionId:
                bridge.sessionId,
              agentId:
                agent.id
            }
          ),
          '*'
        );

        state.panel?.setStatus(
          'Debug export requested from embedded form.'
        );

        return;
      } catch {}
    }

    exportDebugReport();
  };

  const smartQaDebugExport = () => {
    const agent =
      remoteAgentById(
        state.lastRemoteAgentId
      );

    if (
      agent?.source
    ) {
      try {
        agent.source.postMessage(
          bridgePayload(
            'QA_DEBUG',
            {
              sessionId:
                bridge.sessionId,
              agentId:
                agent.id
            }
          ),
          '*'
        );

        state.panel?.setStatus(
          'QA debug export requested from embedded form.'
        );

        return;
      } catch {}
    }

    exportQaDebugReport();
  };

  const installTopBridge = () => {
    if (!IS_TOP) {
      return;
    }

    window.addEventListener(
      'message',
      event => {
        const data =
          event.data;

        if (
          !data ||
          data[
            BRIDGE_MARKER
          ] !== true
        ) {
          return;
        }

        if (
          data.type ===
            'FRAME_HELLO' ||
          data.type ===
            'FRAME_STATE'
        ) {
          if (
            !data.agentId ||
            !event.source
          ) {
            return;
          }

          const existing =
            bridge.agents.get(
              data.agentId
            ) || {};

          bridge.agents.set(
            data.agentId,
            {
              ...existing,
              id:
                data.agentId,
              source:
                event.source,
              lastSeen:
                Date.now(),
              hostname:
                data.hostname ||
                existing.hostname ||
                '',
              title:
                data.title ||
                existing.title ||
                '',
              pathname:
                data.pathname ||
                existing.pathname ||
                '',
              metrics:
                data.metrics ||
                existing.metrics ||
                {
                  operational: 0,
                  meaningful: false,
                  score: 0
                }
            }
          );

          return;
        }

        const requestId =
          data.requestId;

        if (
          requestId &&
          requestId !==
            state.activeRemoteRequestId
        ) {
          return;
        }

        if (
          data.agentId &&
          data.agentId !==
            state.activeRemoteAgentId &&
          [
            'REMOTE_PROGRESS',
            'REMOTE_QA_PROGRESS',
            'REMOTE_STATUS',
            'REMOTE_COUNTERS',
            'REMOTE_ELAPSED',
            'REMOTE_MODE',
            'REMOTE_RESULT'
          ].includes(
            data.type
          )
        ) {
          return;
        }

        if (
          data.type ===
          'REMOTE_PROGRESS'
        ) {
          state.panel?.setProgress(
            Number(
              data.percent || 0
            ),
            data.text || ''
          );

          return;
        }

        if (
          data.type ===
          'REMOTE_QA_PROGRESS'
        ) {
          state.panel?.setQaProgress?.(
            Number(data.percent || 0),
            data.text || ''
          );

          return;
        }

        if (
          data.type ===
          'REMOTE_STATUS'
        ) {
          state.panel?.setStatus(
            data.text || ''
          );

          return;
        }

        if (
          data.type ===
          'REMOTE_COUNTERS'
        ) {
          state.panel?.setCounters(
            data.counters || {
              filled: 0,
              preserved: 0,
              review: 0,
              errors: 0,
              manual: 0
            }
          );

          return;
        }

        if (
          data.type ===
          'REMOTE_ELAPSED'
        ) {
          state.panel?.setElapsed(
            data.text || ''
          );

          return;
        }

        if (
          data.type ===
          'REMOTE_MODE'
        ) {
          state.panel?.setMode(
            data.mode || ''
          );

          return;
        }

        if (
          data.type ===
          'REMOTE_RESULT'
        ) {
          const pending =
            bridge.pending.get(
              requestId
            );

          if (pending) {
            clearTimeout(
              pending.timer
            );

            bridge.pending.delete(
              requestId
            );

            if (
              data.counters
            ) {
              state.panel?.setCounters(
                data.counters
              );
            }

            if (
              data.status
            ) {
              state.panel?.setStatus(
                data.status
              );
            }

            if (data.qaReport) {
              state.qaReport = data.qaReport;
              state.panel?.setQaReport?.(
                data.qaReport
              );
            }

            state.running =
              false;

            state.activeRemoteAgentId =
              null;

            state.activeRemoteRequestId =
              null;

            state.activeRemoteAction =
              null;

            state.panel?.setBusy(
              false
            );

            pending.resolve(
              data
            );
          }
        }
      },
      true
    );

    // Discover already-loaded frames immediately; routeAction also repeats
    // discovery just before a command.
    setTimeout(
      pingFrameAgents,
      50
    );

    setTimeout(
      pingFrameAgents,
      650
    );
  };

  const installFrameAgent = () => {
    if (!IS_FRAME) {
      return;
    }

    const agent = {
      id:
        makeBridgeId(
          'frame'
        ),
      sessionId: null,
      requestId: null,
      action: null
    };

    const send =
      (
        type,
        extra = {}
      ) => {
        postBridgeToTop({
          type,
          agentId:
            agent.id,
          requestId:
            agent.requestId,
          ...extra
        });
      };

    const announce = () => {
      send(
        'FRAME_HELLO',
        {
          hostname:
            location.hostname,
          pathname:
            location.pathname,
          title:
            document.title || '',
          metrics:
            localFormMetrics()
        }
      );
    };

    // Panel proxy: the child runs the existing engine unchanged, while all
    // user-visible state is mirrored to the single panel in the top page.
    state.panel = {
      refreshProfile() {
        profile =
          loadProfile();
      },

      setProgress(
        percent,
        text
      ) {
        send(
          'REMOTE_PROGRESS',
          {
            percent,
            text
          }
        );
      },

      setQaProgress(percent, text) {
        state.qaProgressPercent = clamp(Number(percent || 0), 0, 100);
        send(
          'REMOTE_QA_PROGRESS',
          {
            percent,
            text
          }
        );
      },


      setQaReport(report) {
        if (!report) return;
        state.qaReport = report;
      },

      setElapsed(text) {
        send(
          'REMOTE_ELAPSED',
          {
            text
          }
        );
      },

      setStatus(text) {
        send(
          'REMOTE_STATUS',
          {
            text
          }
        );
      },

      setMode(mode) {
        send(
          'REMOTE_MODE',
          {
            mode
          }
        );
      },

      setCounters(counters) {
        send(
          'REMOTE_COUNTERS',
          {
            counters
          }
        );
      },

      setBusy() {},

      showModeDialog() {},
      minimize() {},
      restore() {}
    };

    const counters =
      () => ({
        filled:
          state.stats.filled.size,
        preserved:
          state.stats.preserved.size,
        review:
          state.stats.review.size,
        errors:
          state.stats.errors.size,
        manual:
          state.stats.manual.size
      });

    window.addEventListener(
      'message',
      async event => {
        const data =
          event.data;

        if (
          !data ||
          data[
            BRIDGE_MARKER
          ] !== true ||
          event.source !==
            window.top
        ) {
          return;
        }

        if (
          data.type ===
          'DISCOVER'
        ) {
          agent.sessionId =
            data.sessionId ||
            agent.sessionId;

          send(
            'FRAME_STATE',
            {
              hostname:
                location.hostname,
              pathname:
                location.pathname,
              title:
                document.title || '',
              metrics:
                localFormMetrics()
            }
          );

          return;
        }

        if (
          !agent.sessionId ||
          data.sessionId !==
            agent.sessionId
        ) {
          return;
        }

        if (
          data.agentId &&
          data.agentId !==
            agent.id
        ) {
          return;
        }

        if (
          data.type ===
          'STOP'
        ) {
          state.stopRequested =
            true;

          send(
            'REMOTE_STATUS',
            {
              text:
                'Stopping safely inside embedded form...'
            }
          );

          return;
        }

        if (
          data.type ===
          'NAVIGATE_STAT'
        ) {
          navigateStat(
            data.statType
          );

          return;
        }

        if (
          data.type ===
          'NAVIGATE_QA'
        ) {
          navigateQaFinding(
            data.fieldKey
          );

          return;
        }

        if (
          data.type ===
          'UNDO'
        ) {
          undo();

          send(
            'REMOTE_STATUS',
            {
              text:
                'Embedded form changes undone.'
            }
          );

          send(
            'REMOTE_COUNTERS',
            {
              counters:
                counters()
            }
          );

          return;
        }

        if (
          data.type ===
          'DEBUG'
        ) {
          exportDebugReport();

          return;
        }

        if (
          data.type ===
          'QA_DEBUG'
        ) {
          exportQaDebugReport();

          return;
        }

        if (
          data.type !==
          'COMMAND' ||
          state.running
        ) {
          return;
        }

        agent.requestId =
          data.requestId ||
          makeBridgeId(
            'frame_request'
          );

        agent.action =
          data.action ||
          '';

        profile =
          loadProfile();

        try {
          let qaReport = null;

          if (
            agent.action ===
            'fill'
          ) {
            await fillForm(
              data.mode ||
              'all'
            );
          } else if (
            agent.action ===
            'validate'
          ) {
            await deepValidateAndAssist();
          } else if (
            agent.action ===
            'recheck'
          ) {
            await recheckAndCorrect();
          } else if (
            agent.action ===
            'qa-audit'
          ) {
            qaReport = await buildQaFunctionalReport();
            state.qaReport = qaReport;
          }

          send(
            'REMOTE_RESULT',
            {
              ok: true,
              action:
                agent.action,
              counters:
                counters(),
              qaReport,
              status:
                agent.action === 'qa-audit' && qaReport
                  ? `Embedded Functional QA completed • Score ${qaReport.score}/100 • ${qaReport.counts.critical} critical • ${qaReport.counts.warning} warning(s)`
                  : `Embedded ${agent.action} completed • Filled ${state.stats.filled.size} • Errors ${state.stats.errors.size} • Manual ${state.stats.manual.size}`
            }
          );
        } catch (error) {
          const reason = error?.message || 'unknown error';
          const partialQa = agent.action === 'qa-audit'
            ? qaMarkReportIncomplete(
                state.qaReport || qaFallbackPartialReport('failed', reason),
                'failed',
                reason
              )
            : null;
          if (partialQa) state.qaReport = partialQa;

          send(
            'REMOTE_RESULT',
            {
              ok: false,
              action:
                agent.action,
              counters:
                counters(),
              qaReport: partialQa,
              status:
                partialQa
                  ? `Embedded Functional QA interrupted safely • Partial report available`
                  : `Embedded ${agent.action} stopped safely: ${reason}`
            }
          );
        } finally {
          agent.requestId =
            null;

          agent.action =
            null;

          announce();
        }
      },
      true
    );

    // Lightweight listeners are useful after a remote fill because the user
    // can manually correct a field inside the iframe and keep counters fresh.
    try {
      cleanupLegacyDateWidgetDamage();
      installLiveValidation();
    } catch {}

    // Retry the hello because parent and child document-idle injection order
    // is not deterministic, and nested widget frames may appear later.
    announce();

    [
      350,
      1000,
      2400,
      5000
    ].forEach(
      delay => {
        setTimeout(
          announce,
          delay
        );
      }
    );
  };

  const mountPanel = () => {
    if (!IS_TOP) {
      return;
    }

    const existing = document.getElementById(PANEL_ID);

    if (existing) {
      existing.style.display = 'block';
      return;
    }

    const host = document.createElement('div');
    host.id = PANEL_ID;

    Object.assign(host.style, {
      position: 'fixed',
      right: '8px',
      bottom: '8px',
      zIndex: '2147483647'
    });

    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box}
        button{font:inherit}
        .panel{
          width:min(320px,calc(100vw - 12px));
          max-height:calc(100vh - 12px);
          border-radius:16px;
          overflow:auto;
          background:#fff;
          color:#172033;
          font-family:Inter,Arial,sans-serif;
          box-shadow:0 26px 72px rgba(72,38,150,.28),0 5px 20px rgba(0,0,0,.12);
          border:1px solid rgba(121,82,255,.16)
        }
        .hero{
          padding:10px 12px 9px;
          background:
            radial-gradient(circle at 86% 14%,rgba(255,255,255,.22),transparent 26%),
            linear-gradient(135deg,#5b4bff 0%,#8254ff 43%,#d946ef 72%,#ff5f91 100%);
          color:#fff;
          position:relative
        }
        .hero:after{
          content:"";
          position:absolute;
          width:130px;
          height:130px;
          border-radius:50%;
          background:rgba(255,255,255,.08);
          right:-58px;
          top:-68px
        }
        .top{
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
          position:relative;
          z-index:1
        }
        .title{font-weight:850;font-size:13px;letter-spacing:.05px}
        .windowBtns{display:flex;gap:6px}
        .windowBtn{
          border:0;
          background:rgba(255,255,255,.17);
          color:#fff;
          width:24px;
          height:24px;
          border-radius:8px;
          cursor:pointer;
          font-size:17px;
          line-height:1;
          display:grid;
          place-items:center;
          transition:.16s ease
        }
        .windowBtn:hover{background:rgba(255,255,255,.28)}
        .profile{
          margin-top:6px;
          position:relative;
          z-index:1;
          display:grid;
          grid-template-columns:1fr;
          gap:1px
        }
        .profile strong{display:block;font-size:11px}
        .profile span{
          display:block;
          font-size:9px;
          opacity:.9;
          margin-top:0;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .body{
          padding:9px;
          background:linear-gradient(180deg,#fff 0%,#faf9ff 100%)
        }
        .tagline{font-size:8px;opacity:.88;margin-top:2px;font-weight:650}
        .modeTabs{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:5px;
          margin-bottom:8px;
          padding:3px;
          border-radius:11px;
          background:#f0edfb
        }
        .modeTab{
          border:0;
          border-radius:8px;
          padding:7px 5px;
          background:transparent;
          color:#69627d;
          font-size:9px;
          font-weight:850;
          cursor:pointer
        }
        .modeTab.active{
          background:#fff;
          color:#5b4bff;
          box-shadow:0 3px 10px rgba(70,50,140,.12)
        }
        .workspace{display:none}
        .workspace.active{display:block}
        .qaScoreCard{
          border:1px solid #e4defb;
          border-radius:12px;
          padding:10px;
          text-align:center;
          background:linear-gradient(135deg,#f8f7ff,#fff7fb);
          margin-bottom:7px
        }
        .qaScoreLabel{font-size:9px;color:#777084;font-weight:750}
        .qaScore{font-size:26px;line-height:1.05;font-weight:900;color:#4f46e5;margin-top:3px}
        .qaRating{font-size:9px;color:#6b7280;margin-top:3px}
        .qaProgressBox{margin:7px 0 3px;padding:7px 8px;border:1px solid #e7e3f5;border-radius:10px;background:#fff}
        .qaProgressMeta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:8px;color:#706a7f;margin-bottom:5px}
        .qaProgressMeta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .qaProgressMeta b{font-size:9px;color:#5b4bff;flex:0 0 auto}
        .qaProgressTrack{height:8px;background:#eeeafe;border-radius:999px;overflow:hidden}
        .qaProgressBar{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#5b4bff,#a855f7,#ec4899);transition:width .2s ease}
        .qaStats{
          display:grid;
          grid-template-columns:repeat(4,1fr);
          gap:4px;
          margin:7px 0
        }
        .qaStat{
          border:1px solid #e7e3f5;
          border-radius:9px;
          padding:6px 2px;
          text-align:center;
          background:#fff
        }
        .qaStat b{display:block;font-size:13px;line-height:1}
        .qaStat span{display:block;font-size:7px;margin-top:3px;color:#777084;font-weight:750}
        .qaCritical b{color:#dc2626}
        .qaWarning b{color:#d97706}
        .qaObservation b{color:#2563eb}
        .qaPassed b{color:#15803d}
        .qaIssues{
          max-height:190px;
          overflow:auto;
          display:grid;
          gap:5px;
          margin-top:7px
        }
        .qaIssue{
          width:100%;
          border:1px solid #e7e3f5;
          border-radius:9px;
          background:#fff;
          padding:7px 8px;
          text-align:left;
          cursor:pointer
        }
        .qaIssue:disabled{cursor:default;opacity:1}
        .qaIssueTop{display:flex;align-items:center;gap:5px}
        .qaPill{font-size:7px;font-weight:900;text-transform:uppercase;padding:2px 5px;border-radius:999px}
        .qaPill.critical{background:#fff1f2;color:#dc2626}
        .qaPill.warning{background:#fff7ed;color:#d97706}
        .qaPill.observation{background:#eff6ff;color:#2563eb}
        .qaIssueTitle{font-size:9px;font-weight:850;color:#312e46;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
        .qaIssueCount{font-size:7px;font-weight:900;color:#6d4aff;background:#f3f0ff;border-radius:999px;padding:2px 5px;flex:0 0 auto}
        .qaIssueField{font-size:8px;color:#665e78;margin-top:4px;font-weight:750}
        .qaIssueMessage{font-size:8px;color:#7b7488;margin-top:2px;line-height:1.35}
        .qaEmpty{font-size:9px;color:#777084;text-align:center;padding:12px 8px;border:1px dashed #ddd6fe;border-radius:9px;background:#fff}
        .qaHint{font-size:8px;color:#8a8fa0;line-height:1.35;margin-top:5px}
        .modeRow{
          display:flex;
          justify-content:space-between;
          align-items:center;
          margin-bottom:6px
        }
        .badge{
          font-size:10px;
          font-weight:850;
          padding:3px 7px;
          border-radius:999px;
          background:#efeaff;
          color:#6d4aff
        }
        .elapsed{font-size:10px;color:#6b7280}
        .progress{
          height:7px;
          background:#ede9fe;
          border-radius:999px;
          overflow:hidden
        }
        .bar{
          height:100%;
          width:0%;
          background:linear-gradient(90deg,#5b4bff,#a855f7,#ec4899,#fb923c);
          transition:width .25s ease;
          border-radius:999px;
          box-shadow:0 0 14px rgba(168,85,247,.35)
        }
        .stage{
          font-size:9px;
          color:#596273;
          margin-top:5px;
          min-height:13px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .stats{
          display:grid;
          grid-template-columns:repeat(5,1fr);
          gap:4px;
          margin:7px 0
        }
        .stat{
          border-radius:10px;
          padding:6px 3px;
          text-align:center;
          border:1px solid;
          cursor:pointer;
          transition:transform .16s ease,box-shadow .16s ease,filter .16s ease;
          user-select:none
        }
        .stat:hover{
          transform:translateY(-1px);
          box-shadow:0 7px 18px rgba(49,46,129,.10);
          filter:saturate(1.08)
        }
        .stat:active{transform:translateY(0) scale(.985)}
        .stat b{font-size:14px;display:block;line-height:1}
        .stat span{
          font-size:8px;
          font-weight:750;
          margin-top:3px;
          display:block;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .green{background:#ecfdf3;border-color:#bbf7d0;color:#15803d}
        .blue{background:#eff6ff;border-color:#bfdbfe;color:#2563eb}
        .amber{background:#fff7ed;border-color:#fed7aa;color:#d97706}
        .red{background:#fff1f2;border-color:#fecdd3;color:#dc2626}
        .purple{
          background:#f5f3ff;
          border-color:#ddd6fe;
          color:#7c3aed
        }
        .primary{
          width:100%;
          border:0;
          border-radius:10px;
          padding:8px 10px;
          background:linear-gradient(135deg,#5b4bff,#8b5cf6,#d946ef);
          color:#fff;
          font-weight:850;
          cursor:pointer;
          box-shadow:0 9px 22px rgba(109,74,255,.24)
        }
        .grid{
          display:grid;
          grid-template-columns:repeat(2,1fr);
          gap:5px;
          margin-top:5px
        }
        .utilityGrid{
          display:grid;
          grid-template-columns:repeat(3,1fr);
          gap:5px;
          margin-top:5px
        }
        .secondary{
          border:1px solid #e3def8;
          background:#fff;
          color:#4b4663;
          border-radius:9px;
          padding:7px 5px;
          font-weight:750;
          font-size:9px;
          cursor:pointer
        }
        .secondary:hover{background:#f7f4ff}
        .danger{
          background:#fff1f2!important;
          border-color:#fecdd3!important;
          color:#dc2626!important
        }
        .status{
          font-size:9px;
          color:#636b7c;
          line-height:1.35;
          margin-top:6px;
          padding:6px 7px;
          border-radius:8px;
          background:linear-gradient(135deg,#f5f3ff,#fff7fb);
          min-height:25px;
          max-height:44px;
          overflow:auto
        }
        .legend{
          font-size:8px;
          color:#8a8fa0;
          margin-top:5px;
          line-height:1.35
        }
        details.help{
          margin-top:4px;
          font-size:8px;
          color:#8a8fa0
        }
        details.help summary{
          cursor:pointer;
          color:#6b7280;
          user-select:none
        }
        .creator{
          margin-top:7px;
          padding-top:7px;
          border-top:1px solid #eeeaf8;
          text-align:center;
          font-size:8px;
          line-height:1.45;
          color:#8a8fa0;
          word-break:break-word
        }
        .creator strong{
          color:#5e5870;
          font-weight:800
        }
        .dot{
          display:inline-block;
          width:7px;
          height:7px;
          border-radius:50%;
          margin:0 3px 0 7px
        }
        .dot:first-child{margin-left:0}
        .y{background:#f59e0b}
        .r{background:#ef4444}
        .p{background:#8b5cf6}
        .modalBack{
          display:none;
          position:fixed;
          inset:0;
          background:rgba(22,17,50,.28);
          backdrop-filter:blur(3px);
          align-items:center;
          justify-content:center
        }
        .modal{
          width:min(280px,calc(100vw - 24px));
          background:#fff;
          border-radius:17px;
          padding:12px;
          box-shadow:0 24px 70px rgba(0,0,0,.24)
        }
        .modal h3{margin:0 0 6px;font-size:14px}
        .modal p{
          margin:0 0 12px;
          color:#6b7280;
          font-size:11px;
          line-height:1.4
        }
        .choice{
          width:100%;
          text-align:left;
          border:1px solid #e5e7eb;
          background:#fff;
          border-radius:12px;
          padding:8px;
          margin-top:6px;
          cursor:pointer
        }
        .choice strong{display:block;font-size:12px;color:#1f2937}
        .choice span{
          display:block;
          font-size:10px;
          color:#6b7280;
          margin-top:3px
        }
        .choice:hover{
          border-color:#8a4dff;
          background:#faf8ff
        }
        .cancel{
          margin-top:10px;
          width:100%;
          border:0;
          background:transparent;
          color:#6b7280;
          font-size:11px;
          cursor:pointer
        }
        .mini{
          display:none;
          min-width:180px;
          max-width:240px;
          align-items:center;
          gap:9px;
          padding:10px 13px;
          border-radius:999px;
          color:#fff;
          font-family:Inter,Arial,sans-serif;
          cursor:pointer;
          user-select:none;
          box-shadow:0 14px 34px rgba(83,52,188,.34);
          background:linear-gradient(135deg,#5b4bff,#9b5cff,#ec4899);
          border:1px solid rgba(255,255,255,.28)
        }
        .miniIcon{
          width:27px;
          height:27px;
          border-radius:50%;
          display:grid;
          place-items:center;
          background:rgba(255,255,255,.18);
          font-size:13px;
          flex:0 0 auto
        }
        .miniText{min-width:0;flex:1}
        .miniText strong{
          display:block;
          font-size:11px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .miniText span{
          display:block;
          font-size:9px;
          margin-top:2px;
          opacity:.9
        }
        .miniCount{
          min-width:24px;
          height:24px;
          border-radius:999px;
          padding:0 7px;
          display:grid;
          place-items:center;
          background:rgba(255,255,255,.2);
          font-size:10px;
          font-weight:850
        }
        button:disabled{opacity:.55;cursor:wait}
      </style>

      <div class="panel" id="panel">
        <div class="hero">
          <div class="top">
            <div><div class="title">✦ Smart FormSense</div><div class="tagline">Intelligent Form Filling & QA Testing</div></div>
            <div class="windowBtns">
              <button class="windowBtn" id="minimize" title="Minimize">−</button>
              <button class="windowBtn" id="close" title="Close">×</button>
            </div>
          </div>

          <div class="profile">
            <strong id="pName"></strong>
            <span id="pId"></span>
            <span id="pEmail"></span>
          </div>
        </div>

        <div class="body">
          <div class="modeTabs">
            <button class="modeTab active" id="fillTab">⚡ Form Filling</button>
            <button class="modeTab" id="qaTab">🧪 QA Testing</button>
          </div>

          <div class="workspace active" id="fillWorkspace">
            <div class="modeRow">
              <span class="badge" id="mode">READY</span>
              <span class="elapsed" id="elapsed">0.0s</span>
            </div>

            <div class="progress">
              <div class="bar" id="bar"></div>
            </div>

            <div class="stage" id="stage">Ready</div>

            <div class="stats">
              <div class="stat green" id="filledCard" title="Click to jump through filled fields">
                <b id="filled">0</b>
                <span>Filled</span>
              </div>

              <div class="stat blue" id="preservedCard" title="Click to jump through already-filled/preserved fields">
                <b id="preserved">0</b>
                <span>Existing</span>
              </div>

              <div class="stat amber" id="reviewCard" title="Click to jump through review fields">
                <b id="review">0</b>
                <span>Review</span>
              </div>

              <div class="stat red" id="errorsCard" title="Click to jump through error fields">
                <b id="errors">0</b>
                <span>Errors</span>
              </div>

              <div class="stat purple" id="manualCard" title="Click to jump through manual-required fields">
                <b id="manual">0</b>
                <span>Manual</span>
              </div>
            </div>

            <button class="primary" id="fillBtn">Fill Form</button>

            <div class="grid">
              <button class="secondary" id="correctBtn">Recheck & Correct</button>
              <button class="secondary" id="validateBtn">Validate</button>
            </div>

            <div class="utilityGrid">
              <button class="secondary" id="undoBtn">Undo</button>
              <button class="secondary" id="newBtn">New Applicant</button>
              <button class="secondary" id="debugBtn" title="Download a troubleshooting report">Export Debug</button>
            </div>
          </div>

          <div class="workspace" id="qaWorkspace">
            <div class="qaScoreCard">
              <div class="qaScoreLabel">FUNCTIONAL QA SCORE</div>
              <div class="qaScore" id="qaScore">--</div>
              <div class="qaRating" id="qaRating">Run functional QA to test this form</div>
            </div>

            <button class="primary" id="qaRunBtn">Run Functional QA</button>

            <div class="qaProgressBox">
              <div class="qaProgressMeta">
                <span id="qaProgressText">Ready</span>
                <b id="qaProgressPct">0%</b>
              </div>
              <div class="qaProgressTrack">
                <div class="qaProgressBar" id="qaProgressBar"></div>
              </div>
            </div>

            <div class="qaStats">
              <div class="qaStat qaCritical"><b id="qaCritical">0</b><span>Blockers</span></div>
              <div class="qaStat qaWarning"><b id="qaWarning">0</b><span>Failed</span></div>
              <div class="qaStat qaObservation"><b id="qaObservation">0</b><span>Review</span></div>
              <div class="qaStat qaPassed"><b id="qaPassed">0</b><span>Checks Passed</span></div>
            </div>

            <div class="qaIssues" id="qaIssues">
              <div class="qaEmpty">Run Functional QA to inspect required fields, validations, dropdown dependencies and form readiness.</div>
            </div>

            <div class="utilityGrid">
              <button class="secondary" id="qaExportBtn" disabled title="Download a readable HTML report">Export Report</button>
              <button class="secondary" id="qaDebugBtn" title="Download technical QA diagnostics for troubleshooting">Export Debug</button>
              <button class="secondary" id="qaRefreshBtn">Run Again</button>
            </div>

            <div class="qaHint">Applicant-side QA: safe field + Next/Continue tests; final submit/payment stays protected.</div>
          </div>

          <div class="status" id="status">
            Ready. Existing values will never be overwritten.
          </div>

          <details class="help">
            <summary>Legend & navigation</summary>
            <div class="legend">
              <span class="dot y"></span>Yellow = low-confidence autofill
              <span class="dot r"></span>Red = unresolved validation error
              <span class="dot p"></span>Purple = manual action required<br>
              Click any counter card to jump through its fields.
            </div>
          </details>

          <div class="creator">
            Created with love ❤️ <strong>Akash Singh</strong><br>
            <span id="creatorEmail"></span>
          </div>
        </div>
      </div>

      <div class="mini" id="mini" title="Click to restore">
        <div class="miniIcon">✦</div>
        <div class="miniText">
          <strong>Smart FormSense</strong>
          <span id="miniStatus">Ready</span>
        </div>
        <div class="miniCount" id="miniCount">0</div>
      </div>

      <div class="modalBack" id="modalBack">
        <div class="modal">
          <h3>How should this form be filled?</h3>
          <p>Existing values are always preserved.</p>

          <button class="choice" id="minChoice">
            <strong>Minimum Required Fields</strong>
            <span>Fill only fields needed to proceed.</span>
          </button>

          <button class="choice" id="allChoice">
            <strong>Fill All Fields</strong>
            <span>Fill required and optional fields wherever possible.</span>
          </button>

          <button class="cancel" id="cancelChoice">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(host);

    const $ = id => shadow.getElementById(id);

    const refs = {
      host,
      shadow,
      panel: $('panel'),
      mini: $('mini'),
      miniCount: $('miniCount'),
      miniStatus: $('miniStatus'),
      fillBtn: $('fillBtn'),
      correctBtn: $('correctBtn'),
      validateBtn: $('validateBtn'),
      undoBtn: $('undoBtn'),
      newBtn: $('newBtn'),
      debugBtn: $('debugBtn'),
      fillTab: $('fillTab'),
      qaTab: $('qaTab'),
      fillWorkspace: $('fillWorkspace'),
      qaWorkspace: $('qaWorkspace'),
      qaRunBtn: $('qaRunBtn'),
      qaExportBtn: $('qaExportBtn'),
      qaDebugBtn: $('qaDebugBtn'),
      qaRefreshBtn: $('qaRefreshBtn'),
      qaIssues: $('qaIssues'),
      qaScore: $('qaScore'),
      qaRating: $('qaRating'),
      qaProgressText: $('qaProgressText'),
      qaProgressPct: $('qaProgressPct'),
      qaProgressBar: $('qaProgressBar'),
      qaCritical: $('qaCritical'),
      qaWarning: $('qaWarning'),
      qaObservation: $('qaObservation'),
      qaPassed: $('qaPassed'),
      creatorEmail: $('creatorEmail'),
      mode: $('mode'),
      elapsed: $('elapsed'),
      bar: $('bar'),
      stage: $('stage'),
      status: $('status'),
      modal: $('modalBack')
    };

    if (
      refs.creatorEmail
    ) {
      refs.creatorEmail.textContent =
        'akash.singh@meritto.com';
    }

    const fitPanelToViewport = () => {
      if (
        !refs.panel ||
        refs.panel.style.display ===
          'none'
      ) {
        return;
      }

      refs.panel.style.zoom = '1';
      refs.panel.style.maxHeight =
        'calc(100vh - 16px)';
      refs.panel.style.overflowY =
        'auto';

      requestAnimationFrame(() => {
        const availableH =
          Math.max(
            260,
            window.innerHeight - 12
          );

        const availableW =
          Math.max(
            240,
            window.innerWidth - 12
          );

        const naturalH =
          refs.panel.scrollHeight;

        const naturalW =
          refs.panel.scrollWidth;

        const scale =
          Math.min(
            1,
            availableH /
              Math.max(
                naturalH,
                1
              ),
            availableW /
              Math.max(
                naturalW,
                1
              )
          );

        if (
          scale < 0.98 &&
          typeof CSS !==
            'undefined' &&
          CSS.supports?.(
            'zoom',
            '0.9'
          )
        ) {
          refs.panel.style.zoom =
            String(
              Math.max(
                0.72,
                scale
              )
            );

          refs.panel.style.maxHeight =
            'none';

          refs.panel.style.overflow =
            'visible';
        }
      });
    };

    const showWorkspace = workspace => {
      const next = workspace === 'qa' ? 'qa' : 'fill';
      state.workspace = next;

      refs.fillTab?.classList.toggle('active', next === 'fill');
      refs.qaTab?.classList.toggle('active', next === 'qa');
      refs.fillWorkspace?.classList.toggle('active', next === 'fill');
      refs.qaWorkspace?.classList.toggle('active', next === 'qa');

      if (next === 'qa' && state.qaReport) {
        state.panel?.setQaReport?.(state.qaReport);
      }

      setTimeout(fitPanelToViewport, 0);
    };

    const minimize = () => {
      refs.panel.style.display = 'none';
      refs.mini.style.display = 'flex';
    };

    const restore = () => {
      refs.mini.style.display = 'none';
      refs.panel.style.display = 'block';
      fitPanelToViewport();
    };

    state.panel = {
      refreshProfile() {
        profile = loadProfile();
        $('pName').textContent = profile.fullName;
        $('pId').textContent = `${profile.id} • ${profile.mobile}`;
        $('pEmail').textContent = profile.email;
      },

      setProgress(percent, text) {
        refs.bar.style.width = `${clamp(percent,0,100)}%`;
        refs.stage.textContent = text || '';
        refs.miniStatus.textContent = text || 'Ready';
      },

      setElapsed(text) {
        refs.elapsed.textContent = text;
      },

      setStatus(text) {
        refs.status.textContent = text;
      },

      setMode(mode) {
        refs.mode.textContent =
          mode === 'minimum'
            ? 'MINIMUM FILL'
            : mode === 'all'
              ? 'FULL FILL'
              : mode === 'qa'
                ? 'QA AUDIT'
                : 'READY';
      },

      setQaProgress(percent, text) {
        const value = clamp(Number(percent || 0), 0, 100);
        state.qaProgressPercent = value;
        if (refs.qaProgressBar) refs.qaProgressBar.style.width = `${value}%`;
        if (refs.qaProgressPct) refs.qaProgressPct.textContent = `${Math.round(value)}%`;
        if (refs.qaProgressText) refs.qaProgressText.textContent = text || 'Working…';
      },

      setQaReport(report) {
        if (!report) return;

        state.qaReport = report;

        if (refs.qaScore) {
          refs.qaScore.textContent = `${Number(report.score || 0)}/100`;
        }

        if (refs.qaRating) {
          const fieldText = report.incomplete
            ? `${Number(report.fieldsChecked || 0)}/${Number(report.fieldsAudited || 0)} fields checked`
            : `${Number(report.fieldsAudited || 0)} fields`;
          refs.qaRating.textContent = `${report.incomplete ? 'Partial • ' : ''}${report.rating || 'Review'} • ${fieldText} • ${Number(report.coverage ?? report.summary?.coverage ?? 0)}% auto coverage`;
        }

        const counts = report.counts || {};

        if (refs.qaCritical) refs.qaCritical.textContent = Number(counts.critical || 0);
        if (refs.qaWarning) refs.qaWarning.textContent = Number(counts.warning || 0);
        if (refs.qaObservation) refs.qaObservation.textContent = Number(counts.observation || 0);
        if (refs.qaPassed) refs.qaPassed.textContent = Number(counts.passed || 0);
        if (refs.qaExportBtn) refs.qaExportBtn.disabled = false;
        if (refs.qaDebugBtn) refs.qaDebugBtn.disabled = false;

        const findings = Array.isArray(report.findings)
          ? report.findings
          : [];

        if (!refs.qaIssues) return;

        if (!findings.length) {
          refs.qaIssues.innerHTML = '<div class="qaEmpty">No QA findings were surfaced by this audit.</div>';
          return;
        }

        const escape = value => String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');

        const displayGroups = new Map();

        for (const item of findings) {
          const severity = ['critical', 'warning', 'observation'].includes(item.severity)
            ? item.severity
            : 'observation';

          const rawTitle = String(item.title || 'QA finding');
          const cleanTitle = rawTitle.includes(' — ')
            ? rawTitle.split(' — ').slice(-1)[0].trim()
            : rawTitle;
          const key = [severity, item.category || 'General', cleanTitle].join('|');

          const group = displayGroups.get(key) || {
            severity,
            title: cleanTitle,
            message: item.message || '',
            guidance: item.guidance || '',
            firstFieldKey: item.fieldKey || '',
            fields: []
          };

          if (item.field) group.fields.push(item.field);
          if (!group.firstFieldKey && item.fieldKey) group.firstFieldKey = item.fieldKey;

          displayGroups.set(key, group);
        }

        refs.qaIssues.innerHTML = [...displayGroups.values()]
          .map(group => {
            const fields = [...new Set(group.fields)];
            const clickable = !!group.firstFieldKey;
            const fieldPreview = fields.length
              ? `${fields[0]}${fields.length > 1 ? ` + ${fields.length - 1} more` : ''}`
              : '';

            return `
              <button class="qaIssue" ${clickable ? `data-qa-field="${escape(group.firstFieldKey)}"` : 'disabled'}>
                <div class="qaIssueTop">
                  <span class="qaPill ${group.severity}">${escape(group.severity === 'critical' ? 'blocker' : group.severity === 'warning' ? 'failed' : 'review')}</span>
                  <span class="qaIssueTitle">${escape(group.title)}</span>
                  ${fields.length > 1 ? `<span class="qaIssueCount">×${fields.length}</span>` : ''}
                </div>
                ${fieldPreview ? `<div class="qaIssueField">${escape(fieldPreview)}</div>` : ''}
                ${group.message ? `<div class="qaIssueMessage">${escape(group.message)}</div>` : ''}
                ${group.guidance ? `<div class="qaIssueMessage"><b>Check:</b> ${escape(group.guidance)}</div>` : ''}
              </button>
            `;
          })
          .join('');
      },

      setCounters(c) {
        $('filled').textContent = c.filled;
        $('preserved').textContent = c.preserved;
        $('review').textContent = c.review;
        $('errors').textContent = c.errors;
        $('manual').textContent = c.manual;

        const attention =
          Number(c.errors || 0) +
          Number(c.manual || 0) +
          Number(c.review || 0);

        refs.miniCount.textContent = attention;
      },

      setBusy(busy) {
        refs.fillBtn.disabled = busy;
        refs.correctBtn.disabled = busy;
        refs.validateBtn.disabled = busy;
        refs.undoBtn.disabled = busy;
        refs.newBtn.disabled = busy;
        refs.debugBtn.disabled = busy;
        if (refs.qaRunBtn) refs.qaRunBtn.disabled = busy;
        if (refs.qaRefreshBtn) refs.qaRefreshBtn.disabled = busy;
        if (refs.qaExportBtn) refs.qaExportBtn.disabled = busy || !state.qaReport;
        if (refs.qaDebugBtn) refs.qaDebugBtn.disabled = false;
        if (refs.fillTab) refs.fillTab.disabled = busy;
        if (refs.qaTab) refs.qaTab.disabled = busy;

        if (busy) {
          if (refs.qaRunBtn && state.workspace === 'qa') {
            refs.qaRunBtn.disabled = false;
            refs.qaRunBtn.textContent = '■ Stop QA';
            refs.qaRunBtn.classList.add('danger');
            refs.qaRunBtn.onclick = () => {
              requestSmartStop();
              refs.qaRunBtn.textContent = '■ Stopping…';
              state.panel?.setQaProgress?.(
                Number(state.qaProgressPercent || 1),
                'Stopping after the current check…'
              );
              refs.status.textContent = 'Stopping QA safely. Completed checks will remain exportable.';
            };
          }

          refs.fillBtn.disabled = false;
          refs.fillBtn.textContent = '■ Stop';
          refs.fillBtn.classList.add('danger');
          refs.fillBtn.onclick = () => {
            requestSmartStop();

            refs.fillBtn.textContent = '■ Stopping…';
            refs.status.textContent = 'Stopping safely...';
            refs.stage.textContent = 'Stopping after the current small operation...';
            refs.miniStatus.textContent = 'Stopping safely...';
          };
        } else {
          refs.fillBtn.textContent = 'Fill Form';
          refs.fillBtn.classList.remove('danger');
          refs.fillBtn.onclick = showModeDialog;
          if (refs.qaRunBtn) {
            refs.qaRunBtn.textContent = 'Run Functional QA';
            refs.qaRunBtn.classList.remove('danger');
            refs.qaRunBtn.onclick = runSmartQaAudit;
          }
          if (refs.qaRefreshBtn) {
            refs.qaRefreshBtn.onclick = runSmartQaAudit;
          }
          if (refs.qaExportBtn) {
            refs.qaExportBtn.disabled = !state.qaReport;
          }
          if (refs.qaDebugBtn) {
            refs.qaDebugBtn.disabled = false;
          }
        }
      },

      showModeDialog() {
        refs.modal.style.display = 'flex';
      },

      showWorkspace,
      minimize,
      restore
    };

    refs.fillBtn.onclick = showModeDialog;
    refs.correctBtn.onclick = () =>
      runSmartAction(
        'recheck'
      );

    refs.validateBtn.onclick = () =>
      runSmartAction(
        'validate'
      );

    refs.undoBtn.onclick =
      smartUndo;

    refs.newBtn.onclick = () => {
      // A fresh synthetic applicant is global to this userscript; child
      // agents reload it at the next command.
      state.lastRemoteAgentId =
        null;

      newApplicant();
    };

    refs.debugBtn.onclick =
      smartDebugExport;

    refs.fillTab.onclick = () =>
      showWorkspace('fill');

    refs.qaTab.onclick = () =>
      showWorkspace('qa');

    refs.qaRunBtn.onclick =
      runSmartQaAudit;

    refs.qaRefreshBtn.onclick =
      runSmartQaAudit;

    refs.qaExportBtn.onclick = () =>
      exportQaReport(state.qaReport);

    refs.qaDebugBtn.onclick =
      smartQaDebugExport;

    refs.qaIssues.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-qa-field]');
      if (!button) return;
      navigateSmartQaFinding(
        button.getAttribute('data-qa-field')
      );
    });

    $('filledCard').onclick = () => navigateSmartStat('filled');
    $('preservedCard').onclick = () => navigateSmartStat('preserved');
    $('reviewCard').onclick = () => navigateSmartStat('review');
    $('errorsCard').onclick = () => navigateSmartStat('errors');
    $('manualCard').onclick = () => navigateSmartStat('manual');

    cleanupLegacyDateWidgetDamage();
    installLiveValidation();

    fitPanelToViewport();

    window.addEventListener(
      'resize',
      fitPanelToViewport,
      {
        passive: true
      }
    );

    $('minimize').onclick = minimize;
    refs.mini.onclick = restore;

    $('close').onclick = () => {
      host.style.display = 'none';
    };

    $('minChoice').onclick = () => {
      refs.modal.style.display = 'none';

      runSmartAction(
        'fill',
        {
          mode: 'minimum'
        }
      );
    };

    $('allChoice').onclick = () => {
      refs.modal.style.display = 'none';

      runSmartAction(
        'fill',
        {
          mode: 'all'
        }
      );
    };

    $('cancelChoice').onclick = () => {
      refs.modal.style.display = 'none';
    };

    refs.modal.addEventListener('click', e => {
      if (e.target === refs.modal) {
        refs.modal.style.display = 'none';
      }
    });

    let drag = null;

    refs.mini.addEventListener('pointerdown', e => {
      drag = {
        x: e.clientX,
        y: e.clientY,
        left: host.getBoundingClientRect().left,
        top: host.getBoundingClientRect().top,
        moved: false
      };

      refs.mini.setPointerCapture?.(e.pointerId);
    });

    refs.mini.addEventListener('pointermove', e => {
      if (!drag) return;

      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;

      if (Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
      }

      if (!drag.moved) return;

      host.style.right = 'auto';
      host.style.bottom = 'auto';
      host.style.left = `${clamp(drag.left + dx, 6, window.innerWidth - 190)}px`;
      host.style.top = `${clamp(drag.top + dy, 6, window.innerHeight - 50)}px`;
    });

    refs.mini.addEventListener('pointerup', e => {
      const moved = drag?.moved;
      drag = null;

      try {
        refs.mini.releasePointerCapture?.(e.pointerId);
      } catch {}

      if (!moved) {
        restore();
      }
    });

    state.panel.refreshProfile();
    showWorkspace(state.workspace || 'fill');
    if (state.qaReport) {
      state.panel.setQaReport(state.qaReport);
    }
    updateCounters();
  };

  const maybeResumeAfterReload = () => {
    const session = getRunSession();

    if (
      !session?.active ||
      session.hostname !== location.hostname
    ) {
      return;
    }

    const age =
      Date.now() -
      Number(
        session.updatedAt ||
        session.startedAt ||
        0
      );

    if (
      age > 60000
    ) {
      clearRunSession();
      return;
    }

    if (
      Number(session.resumeCount || 0) >= 1
    ) {
      clearRunSession();

      setTimeout(() => {
        mountPanel();
        state.panel?.setStatus(
          'The form reloaded more than once. Automatic resume stopped to prevent a loop.'
        );
      }, 700);

      return;
    }

    writeRunSession({
      resumeCount:
        Number(
          session.resumeCount || 0
        ) + 1
    });

    setTimeout(() => {
      mountPanel();

      state.panel?.setStatus(
        'Page reload detected. Resuming Turbo Fill once...'
      );

      fillForm(
        session.mode || 'all',
        {
          resumed: true
        }
      );
    }, 850);
  };

  if (IS_TOP) {
    installTopBridge();

    GM_registerMenuCommand(
      'Activate Smart FormSense',
      mountPanel
    );

    maybeResumeAfterReload();
  } else {
    installFrameAgent();
  }
})();
