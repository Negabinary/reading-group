import test from 'node:test';
import assert from 'node:assert/strict';
import { handleGet, handlePost } from '../apps-script/http';
import {
  getState,
  setVote,
  signIn,
  suggestPaper,
  searchPapers,
  setup,
} from '../apps-script/server';

// An in-memory Google Sheets service double exercises the actual production handlers.
// This does not replace the final deployment check against a real Google Sheet.
function fixture() {
  const rows: unknown[][] = [
    [
      'ID',
      'Title',
      'Authors',
      'Year',
      'Venue',
      'URL',
      'Topic',
      'Notes',
      'Suggested by',
      'Added',
      'Date',
      'Alex',
    ],
    [
      'paper-1',
      'A paper',
      'Author',
      '2025',
      'POPL',
      'https://example.org',
      '',
      '',
      'member-a',
      '2026-01-01',
      '',
      'V',
    ],
  ];
  const notes: string[] = Array(11)
    .fill('')
    .concat('mplse-user:member-a\nKeep note.');
  let locked = false;
  let uuid = 0;
  const range = (row: number, column: number, count = 1, width = 1) => ({
    getValues: () =>
      Array.from({ length: count }, (_, i) =>
        Array.from(
          { length: width },
          (_, j) => rows[row - 1 + i]?.[column - 1 + j] ?? '',
        ),
      ),
    getNotes: () => [
      Array.from({ length: width }, (_, j) => notes[column - 1 + j] ?? ''),
    ],
    setValue(value: unknown) {
      assert.ok(locked, 'writes must acquire a script lock');
      rows[row - 1][column - 1] =
        typeof value === 'string' ? value.replace(/^'/, '') : value;
      return this;
    },
    setNote(value: string) {
      assert.ok(locked);
      notes[column - 1] = value;
      return this;
    },
    setBackground() {
      return this;
    },
    setFontColor() {
      return this;
    },
    setFontWeight() {
      return this;
    },
    setDataValidation() {
      return this;
    },
  });
  const tab = {
    getDataRange: () => ({ getValues: () => rows.map((row) => [...row]) }),
    getRange: range,
    getLastColumn: () => rows[0].length,
    getMaxColumns: () => 50,
    getMaxRows: () => 1000,
    getParent: () => ({
      getSpreadsheetTimeZone: () => 'UTC',
      getUrl: () => 'https://docs.google.com/spreadsheets/d/test',
    }),
    appendRow: (row: unknown[]) => {
      assert.ok(locked);
      rows.push(
        row.map((cell) =>
          typeof cell === 'string' ? cell.replace(/^'/, '') : cell,
        ),
      );
    },
  };
  const validation = {
    requireValueInList() {
      return this;
    },
    setAllowInvalid() {
      return this;
    },
    build() {
      return {};
    },
  };
  Object.assign(globalThis, {
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content: string) => ({
        setMimeType(mime: string) {
          assert.equal(mime, 'application/json');
          return this;
        },
        getContent: () => content,
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          assert.equal(locked, false);
          locked = true;
        },
        releaseLock: () => {
          locked = false;
        },
      }),
    },
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: () => tab }),
      flush: () => {},
      newDataValidation: () => validation,
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => 'test' }),
    },
    Utilities: {
      getUuid: () => `generated-${++uuid}`,
      formatDate: (date: Date) => date.toISOString().slice(0, 10),
    },
  });
  return { rows, notes, tab, isLocked: () => locked };
}

function post(action: string, args: unknown[]) {
  return JSON.parse(
    handlePost({
      postData: { contents: JSON.stringify({ action, args }) },
    }).getContent(),
  );
}

test('HTTP health and GET state return versioned JSON, and GET never dispatches writes or setup', () => {
  const { rows } = fixture();
  assert.deepEqual(JSON.parse(handleGet().getContent()), {
    apiVersion: 1,
    ok: true,
    data: { service: 'mplse-reading-group' },
  });
  const state = JSON.parse(
    handleGet({ parameter: { action: 'getState' } }).getContent(),
  );
  assert.equal(state.ok, true);
  assert.equal(state.data.papers[0].id, 'paper-1');
  const before = structuredClone(rows);
  for (const action of [
    'signIn',
    'setVote',
    'suggestPaper',
    'setup',
    'setupMplse',
    'constructor',
    '__proto__',
  ]) {
    const result = JSON.parse(
      handleGet({ parameter: { action } }).getContent(),
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown GET action/);
  }
  assert.deepEqual(rows, before);
});

test('HTTP mutations reuse sheet validation, stable identities, and idempotent vote writes', () => {
  const { rows } = fixture();
  const signedIn = post('signIn', ['  alex  ']);
  assert.equal(signedIn.ok, true);
  assert.equal(signedIn.data.member.id, 'member-a');
  assert.equal(rows[0].length, 12);
  rows[1][11] = 'VA';
  assert.equal(post('setVote', ['paper-1', 'member-a', false]).ok, true);
  assert.equal(post('setVote', ['paper-1', 'member-a', false]).ok, true);
  assert.equal(rows[1][11], 'A');
  rows[1][10] = '2026-10-01';
  assert.match(
    post('setVote', ['paper-1', 'member-a', true]).error,
    /Voting is closed/,
  );
  assert.equal(rows[1][11], 'A');
  const paper = {
    title: '=New paper',
    authors: 'Alex',
    year: '2026',
    venue: '',
    url: 'https://example.org/new',
    topic: '',
    notes: '',
  };
  assert.equal(post('suggestPaper', [paper, 'member-a']).ok, true);
  assert.equal(rows.length, 3);
  assert.equal(rows[2][11], 'V');
  assert.match(
    post('suggestPaper', [paper, 'member-a']).error,
    /already in the reading group/,
  );
});

test('HTTP rejects malformed, oversized, unknown and wrongly typed mutations without changing the sheet', () => {
  const { rows } = fixture();
  const before = structuredClone(rows);
  for (const contents of [
    '',
    '{bad json',
    'null',
    '{}',
    '[]',
    ' '.repeat(20001),
  ]) {
    const result = JSON.parse(
      handlePost({ postData: { contents } }).getContent(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.apiVersion, 1);
    assert.equal(typeof result.error, 'string');
  }
  const badCalls: [string, unknown[]][] = [
    ['setup', []],
    ['setupMplse', []],
    ['constructor', []],
    ['__proto__', []],
    ['getState', []],
    ['signIn', []],
    ['signIn', [123]],
    ['signIn', ['Alex', 'extra']],
    ['setVote', ['paper-1', 'member-a', 'false']],
    ['setVote', ['paper-1', {}, true]],
    ['suggestPaper', [null, 'member-a']],
    ['suggestPaper', [[], 'member-a']],
    ['suggestPaper', [{}, 'member-a']],
  ];
  for (const [action, args] of badCalls)
    assert.equal(post(action, args).ok, false);
  assert.deepEqual(rows, before);
});

test('HTTP search returns catalog results through Apps Script', () => {
  fixture();
  Object.assign(globalThis, {
    CacheService: {
      getScriptCache: () => ({ get: () => null, put: () => {} }),
    },
    UrlFetchApp: {
      fetch: () => ({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            result: {
              hits: {
                hit: [
                  {
                    info: {
                      title: 'Types',
                      authors: { author: 'Alex' },
                      year: '2026',
                      venue: 'POPL',
                      ee: 'https://example.org/types',
                    },
                  },
                ],
              },
            },
          }),
      }),
    },
  });
  const result = JSON.parse(
    handleGet({
      parameter: { action: 'searchPapers', query: 'types' },
    }).getContent(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data[0].title, 'Types');
  assert.equal(result.data[0].source, 'DBLP');
});

test('setup rejects a missing bound spreadsheet before acquiring a lock or making changes', () => {
  const { rows, isLocked } = fixture();
  const before = structuredClone(rows);
  Object.assign(SpreadsheetApp, {
    getActiveSpreadsheet: () => null,
    flush: () =>
      assert.fail('Rejected setup must not flush spreadsheet writes.'),
  });
  Object.assign(LockService, {
    getScriptLock: () => assert.fail('Rejected setup must not acquire a lock.'),
  });
  assert.throws(() => setup(), /Open the sheet → Extensions → Apps Script/);
  assert.deepEqual(rows, before);
  assert.equal(isLocked(), false);
});

test('setup succeeds without UI access and can be rerun without changing existing data', () => {
  const { rows, tab } = fixture();
  const before = structuredClone(rows);
  const properties = new Map<string, string>();
  Object.assign(tab, { getLastRow: () => rows.length });
  Object.assign(SpreadsheetApp, {
    getUi: () => {
      throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
    },
    getActiveSpreadsheet: () => ({
      getSheetByName: () => tab,
      getId: () => 'bound-sheet-id',
    }),
  });
  Object.assign(PropertiesService, {
    getScriptProperties: () => ({
      setProperty: (key: string, value: string) => properties.set(key, value),
    }),
  });
  setup();
  setup();
  assert.equal(properties.get('SPREADSHEET_ID'), 'bound-sheet-id');
  assert.deepEqual(rows, before);
});

test('votes are idempotent, and attendance survives adding or withdrawing a vote', () => {
  const { rows } = fixture();
  rows[1][11] = 'VA';
  assert.equal(setVote('paper-1', 'member-a', false).papers[0].votes.length, 0);
  assert.equal(rows[1][11], 'A');
  setVote('paper-1', 'member-a', true);
  setVote('paper-1', 'member-a', true);
  assert.equal(rows[1][11], 'VA');
  assert.deepEqual(getState().papers[0].votes, ['member-a']);
});

test('scheduled votes are frozen and the lock is released after errors', () => {
  const f = fixture();
  f.rows[1][10] = '2026-10-01';
  assert.throws(() => setVote('paper-1', 'member-a', false), /closed/);
  assert.equal(f.isLocked(), false);
  assert.equal(f.rows[1][11], 'V');
});

test('renaming a column preserves the member identity and votes', () => {
  const { rows } = fixture();
  rows[0][11] = 'Alex Chen';
  const state = getState();
  assert.equal(state.members[0].name, 'Alex Chen');
  assert.equal(state.members[0].id, 'member-a');
  assert.deepEqual(state.papers[0].votes, ['member-a']);
  assert.equal(signIn('  alex CHEN  ').member.id, 'member-a');
});

test('removing or moving a member column is reflected without relying on column position', () => {
  const { rows, notes } = fixture();
  rows[0].push('Blair');
  rows[1].push('A');
  notes.push('mplse-user:member-b\nKeep note.');
  for (const row of rows) [row[11], row[12]] = [row[12], row[11]];
  [notes[11], notes[12]] = [notes[12], notes[11]];
  setVote('paper-1', 'member-a', false);
  assert.equal(rows[1][12], '');
  assert.equal(rows[1][11], 'A');
  for (const row of rows) row.splice(12, 1);
  notes.splice(12, 1);
  assert.throws(() => setVote('paper-1', 'member-a', true), /removed/);
});

test('sign-in creates a user once and suggestions start with one vote', () => {
  const { rows } = fixture();
  const member = signIn('Maya').member;
  assert.equal(signIn(' maya ').member.id, member.id);
  assert.equal(getState().members.length, 2);
  const input = {
    title: '=1+1',
    authors: 'Maya',
    year: '2026',
    venue: '',
    url: '',
    topic: '',
    notes: '',
  };
  const result = suggestPaper(input, member.id);
  assert.equal(rows[2][1], '=1+1'); // Spreadsheet literal escaping is removed by the sheet, not executed.
  assert.deepEqual(result.papers[1].votes, [member.id]);
  assert.equal(rows[2][12], 'V');
  assert.throws(() => suggestPaper(input, member.id), /already/);
  assert.equal(rows.length, 3);
});

test('manual sheet additions receive stable IDs and missing users cannot write', () => {
  const { rows } = fixture();
  rows[1][0] = '';
  const first = getState();
  const second = getState();
  assert.equal(first.papers[0].id, second.papers[0].id);
  assert.ok(first.papers[0].id);
  assert.throws(() => setVote(first.papers[0].id, 'intruder', true), /removed/);
});

test('invalid dates and duplicate identity notes give actionable errors', () => {
  const { rows, notes } = fixture();
  rows[1][10] = '2026-02-30';
  assert.throws(() => getState(), /row 2/);
  rows[1][10] = '';
  rows[0].push('Copied Alex');
  rows[1].push('');
  notes.push(notes[11]);
  assert.throws(() => getState(), /copied identity note/);
});

test('live search falls back from DBLP bot-check HTML to Crossref and caches results', () => {
  fixture();
  const cached = new Map<string, string>();
  const urls: string[] = [];
  Object.assign(globalThis, {
    CacheService: {
      getScriptCache: () => ({
        get: (key: string) => cached.get(key),
        put: (key: string, value: string) => cached.set(key, value),
      }),
    },
    UrlFetchApp: {
      fetch: (url: string) => {
        urls.push(url);
        return {
          getResponseCode: () => 200,
          getContentText: () =>
            url.startsWith('https://dblp.org')
              ? '<html>Bot check</html>'
              : JSON.stringify({
                  message: {
                    items: [
                      { title: ['A verified result'], DOI: '10.1234/test' },
                    ],
                  },
                }),
        };
      },
    },
  });
  assert.equal(searchPapers('a paper')[0].source, 'Crossref');
  assert.equal(urls.length, 2);
  assert.equal(searchPapers('a paper')[0].title, 'A verified result');
  assert.equal(urls.length, 2);
});
