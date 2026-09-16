import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSheet, ReadingSheet } from '../worker/sheets';
import { cell, fixture, SheetFixture } from './sheet-fixture';
import type { GroupState } from '../src/types';

const signal = () => AbortSignal.timeout(5000);
const input = {
  title: 'New paper',
  authors: '',
  year: '',
  venue: '',
  url: '',
  topic: '',
  notes: '',
};

test('legacy IDs, notes, dates, votes and attendance survive reordered member columns', () => {
  const document = fixture();
  const rows = document.sheets[0].data![0].rowData!;
  rows.forEach((row) => {
    [row.values![11], row.values![12]] = [row.values![12], row.values![11]];
  });
  rows[0].values![12].effectiveValue!.stringValue = 'Alex renamed';
  const { state, repairs } = decodeSheet(
    document,
    'sheet-id',
    new Date('2026-09-15T02:00:00Z'),
  );
  assert.equal(state.today, '2026-09-14');
  assert.deepEqual(state.members, [
    { id: 'sam-id', name: 'Sam' },
    { id: 'alex-id', name: 'Alex renamed' },
  ]);
  assert.deepEqual(state.papers[0].attendance, ['alex-id']);
  assert.deepEqual(state.papers[0].votes, ['sam-id', 'alex-id']);
  assert.equal(repairs.length, 0);
});

test('native Sheets date serials use civil dates and Added uses sheet timezone', () => {
  for (const [timeZone, today, added] of [
    ['America/Detroit', '2026-09-14', '2026-09-15T04:00:00.000Z'],
    ['Pacific/Auckland', '2026-09-15', '2026-09-14T12:00:00.000Z'],
  ]) {
    const document = fixture();
    document.properties.timeZone = timeZone;
    const row = document.sheets[0].data![0].rowData![1].values!;
    const date = {
      effectiveValue: {
        numberValue:
          (Date.UTC(2026, 8, 15) - Date.UTC(1899, 11, 30)) / 86400000,
      },
      effectiveFormat: { numberFormat: { type: 'DATE' } },
    };
    row[10] = date;
    row[9] = date;
    const { state } = decodeSheet(
      document,
      'sheet',
      new Date('2026-09-15T02:00:00Z'),
    );
    assert.equal(state.today, today);
    assert.equal(state.papers[0].date, '2026-09-15');
    assert.equal(state.papers[0].addedAt, added);
  }
});

test('missing manual IDs are repaired once, after validating the entire sheet', async () => {
  const google = new SheetFixture();
  const rows = google.document.sheets[0].data![0].rowData!;
  rows[0].values![11].note = 'An organizer note';
  rows[1].values![0] = cell('');
  const sheet = new ReadingSheet(google, 'sheet');
  const first = (await sheet.execute(
    { action: 'getState' },
    signal(),
  )) as GroupState;
  const second = (await sheet.execute(
    { action: 'getState' },
    signal(),
  )) as GroupState;
  assert.equal(first.members[0].id, second.members[0].id);
  assert.equal(first.papers[0].id, second.papers[0].id);
  assert.equal(google.writes.length, 1);
  assert.equal(second.timeZone, 'America/Detroit');
  assert.match(
    google.document.sheets[0].data![0].rowData![0].values![11].note!,
    /An organizer note/,
  );
  assert.equal(google.reads, 2); // no stale sheet cache
});

test('corrupt layout, duplicate identities, invalid dates and marks perform no writes', async () => {
  const changes = [
    (rows: any[]) => {
      rows[0].values[0] = cell('Moved');
    },
    (rows: any[]) => {
      rows[0].values[12].note = rows[0].values[11].note;
    },
    (rows: any[]) => {
      rows[0].values[12].effectiveValue.stringValue = 'alex';
    },
    (rows: any[]) => {
      rows[1].values[10] = cell('2026-02-30');
    },
    (rows: any[]) => {
      rows[1].values[12] = cell('Wrong');
    },
    (rows: any[]) => {
      rows.push(structuredClone(rows[1]));
    },
  ];
  for (const change of changes) {
    const google = new SheetFixture();
    change(google.document.sheets[0].data![0].rowData!);
    await assert.rejects(
      new ReadingSheet(google, 'sheet').execute(
        { action: 'getState' },
        signal(),
      ),
    );
    assert.equal(google.writes.length, 0);
  }
});

test('votes are idempotent, preserve attendance, and locate current row and column by ID', async () => {
  const google = new SheetFixture();
  const sheet = new ReadingSheet(google, 'sheet');
  const command = {
    action: 'setVote' as const,
    paperId: 'paper-1',
    memberId: 'alex-id',
    voted: false,
  };
  await sheet.execute(command, signal());
  let state = (await sheet.execute(command, signal())) as GroupState;
  assert.deepEqual(state.papers[0].attendance, ['alex-id']);
  assert.deepEqual(state.papers[0].votes, ['sam-id']);
  const rows = google.document.sheets[0].data![0].rowData!;
  rows.splice(1, 0, { values: [] });
  rows.forEach((row) => {
    [row.values![11], row.values![12]] = [row.values![12], row.values![11]];
  });
  state = (await sheet.execute(
    { ...command, voted: true },
    signal(),
  )) as GroupState;
  assert.equal(
    state.papers[0].votes.filter((id) => id === 'alex-id').length,
    1,
  );
  assert.equal(
    google.document.sheets[0].data![0].rowData![2].values![12].effectiveValue!
      .stringValue,
    'VA',
  );
});

test('scheduled papers and removed identities reject changes before writing', async () => {
  for (const scheduled of [true, false]) {
    const google = new SheetFixture();
    if (scheduled)
      google.document.sheets[0].data![0].rowData![1].values![10] =
        cell('2026-09-20');
    const sheet = new ReadingSheet(google, 'sheet');
    await assert.rejects(
      sheet.execute(
        {
          action: 'setVote',
          paperId: 'paper-1',
          memberId: scheduled ? 'alex-id' : 'removed',
          voted: true,
        },
        signal(),
      ),
      scheduled ? /Voting is closed/ : /sign in again/,
    );
    assert.equal(google.writes.length, 0);
  }
});

test('sign-in reuses identities and grows the grid without overwriting a header', async () => {
  const google = new SheetFixture();
  const sheet = new ReadingSheet(google, 'sheet');
  const existing = (await sheet.execute(
    { action: 'signIn', name: 'ALEX' },
    signal(),
  )) as any;
  assert.equal(existing.member.id, 'alex-id');
  assert.equal(google.writes.length, 1); // First request adds scheduling columns.
  const joined = (await sheet.execute(
    { action: 'signIn', name: '=New member' },
    signal(),
  )) as any;
  const doc = google.document.sheets[0];
  assert.equal(doc.properties.gridProperties.columnCount, 16);
  assert.equal(
    doc.data![0].rowData![0].values![15].effectiveValue!.stringValue,
    '=New member',
  );
  assert.match(
    doc.data![0].rowData![0].values![15].note!,
    new RegExp(joined.member.id),
  );
  assert.ok(!JSON.stringify(google.writes).includes('formulaValue'));
});

test('suggestions append literal text, initially vote, deduplicate, and never retry a failed write', async () => {
  const google = new SheetFixture();
  const sheet = new ReadingSheet(google, 'sheet');
  const command = {
    action: 'suggestPaper' as const,
    paper: { ...input, title: '=IMPORTXML("bad")' },
    memberId: 'alex-id',
  };
  const state = (await sheet.execute(command, signal())) as GroupState;
  assert.equal(state.papers[1].title, command.paper.title);
  assert.deepEqual(state.papers[1].votes, ['alex-id']);
  assert.ok(!JSON.stringify(google.writes).includes('formulaValue'));
  await assert.rejects(
    sheet.execute(command, signal()),
    /already in the reading group/,
  );
  assert.equal(google.writes.length, 1);
  google.failWrite = true;
  await assert.rejects(
    sheet.execute({ ...command, paper: input }, signal()),
    /lost response/,
  );
  assert.equal(google.reads, 3);
  assert.equal(google.writes.length, 1);
});

test('scheduling columns are added once without moving or changing any existing cells', async () => {
  const google = new SheetFixture();
  const before = structuredClone(google.document.sheets[0].data![0].rowData!);
  const sheet = new ReadingSheet(google, 'sheet');
  const state = (await sheet.execute(
    { action: 'getState' },
    signal(),
  )) as GroupState;
  const rows = google.document.sheets[0].data![0].rowData!;
  assert.deepEqual(rows[0].values!.slice(0, 13), before[0].values);
  assert.deepEqual(rows[1], before[1]);
  assert.deepEqual(
    rows[0].values!.slice(13).map((c) => c.effectiveValue?.stringValue),
    ['Time', 'Location'],
  );
  assert.equal(state.members.length, 2);
  assert.equal(state.papers[0].time, '');
  assert.equal(state.papers[0].location, '');
  await sheet.execute({ action: 'getState' }, signal());
  assert.equal(google.writes.length, 1);
  assert.equal(
    google.document.sheets[0].properties.gridProperties.columnCount,
    15,
  );
});

test('scheduling header casing cannot turn fields into sign-in choices', async () => {
  const google = new SheetFixture();
  const rows = google.document.sheets[0].data![0].rowData!;
  rows[0].values!.push(cell(' time '), cell('LOCATION'));
  rows[1].values!.push(cell('2:30 PM'), cell('Room 101'));
  google.document.sheets[0].properties.gridProperties.columnCount = 15;
  const state = (await new ReadingSheet(google, 'sheet').execute(
    { action: 'getState' },
    signal(),
  )) as GroupState;
  assert.deepEqual(
    state.members.map((m) => m.name),
    ['Alex', 'Sam'],
  );
  assert.equal(state.papers[0].time, '14:30');
  assert.equal(state.papers[0].location, 'Room 101');
  assert.deepEqual(state.papers[0].votes, ['alex-id', 'sam-id']);
  assert.equal(google.writes.length, 0);
});

test('time and location follow their headers, including beside Date; votes and new suggestions still work', async () => {
  const google = new SheetFixture();
  const rows = google.document.sheets[0].data![0].rowData!;
  rows[0].values!.splice(11, 0, cell('Time'), cell('Location'));
  rows[1].values!.splice(
    11,
    0,
    {
      effectiveValue: { numberValue: 14.5 / 24 },
      effectiveFormat: { numberFormat: { type: 'TIME' } },
    },
    cell('Beyster 3725'),
  );
  google.document.sheets[0].properties.gridProperties.columnCount = 15;
  const sheet = new ReadingSheet(google, 'sheet');
  const state = (await sheet.execute(
    {
      action: 'setVote',
      paperId: 'paper-1',
      memberId: 'alex-id',
      voted: false,
    },
    signal(),
  )) as GroupState;
  assert.equal(state.papers[0].time, '14:30');
  assert.equal(state.papers[0].location, 'Beyster 3725');
  assert.deepEqual(state.papers[0].attendance, ['alex-id']);
  assert.deepEqual(state.papers[0].votes, ['sam-id']);
  const added = (await sheet.execute(
    { action: 'suggestPaper', paper: input, memberId: 'alex-id' },
    signal(),
  )) as GroupState;
  assert.equal(added.members.length, 2);
  assert.deepEqual(added.papers[1].votes, ['alex-id']);
  const stored = google.document.sheets[0].data![0].rowData![2].values!;
  assert.equal(stored[11].effectiveValue?.stringValue, '');
  assert.equal(stored[12].effectiveValue?.stringValue, '');
  assert.equal(stored[13].effectiveValue?.stringValue, 'V');
});

test('native midnight, text 24-hour and AM/PM times are normalized; invalid times fail without writes', async () => {
  for (const [input, expected] of [
    [0, '00:00'],
    [1 / 24, '01:00'],
    ['9:05', '09:05'],
    ['2:30 PM', '14:30'],
    ['12:00 am', '00:00'],
    ['12:00 pm', '12:00'],
    ['23:59:00', '23:59'],
    ['', ''],
    ['24:00', null],
    ['2:60', null],
    ['13:00 PM', null],
    [-0.5, null],
    [1.5, null],
    ['tomorrow', null],
  ] as const) {
    const google = new SheetFixture();
    const rows = google.document.sheets[0].data![0].rowData!;
    rows[0].values![13] = cell('Time');
    rows[1].values![13] =
      typeof input === 'number'
        ? { effectiveValue: { numberValue: input } }
        : cell(input);
    google.document.sheets[0].properties.gridProperties.columnCount = 14;
    const read = new ReadingSheet(google, 'sheet').execute(
      { action: 'getState' },
      signal(),
    );
    if (expected === null) {
      await assert.rejects(read, /Time in row 2/);
      assert.equal(google.writes.length, 0);
    } else assert.equal(((await read) as GroupState).papers[0].time, expected);
  }
});

test('existing member named Time keeps its identity; duplicate schedule headers are rejected', async () => {
  const google = new SheetFixture();
  const rows = google.document.sheets[0].data![0].rowData!;
  rows[0].values![11].effectiveValue!.stringValue = 'Time';
  const sheet = new ReadingSheet(google, 'sheet');
  const first = (await sheet.execute(
    { action: 'getState' },
    signal(),
  )) as GroupState;
  const second = (await sheet.execute(
    { action: 'getState' },
    signal(),
  )) as GroupState;
  assert.equal(first.members[0].id, 'alex-id');
  assert.deepEqual(first, second);
  const after = google.document.sheets[0].data![0].rowData!;
  after[0].values!.push(cell('Location'));
  await assert.rejects(
    sheet.execute({ action: 'getState' }, signal()),
    /only one Location/,
  );
  assert.equal(google.writes.length, 1);
});
