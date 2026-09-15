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
  assert.equal(google.writes[0].length, 2);
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
  assert.equal(google.writes.length, 0);
  const joined = (await sheet.execute(
    { action: 'signIn', name: '=New member' },
    signal(),
  )) as any;
  const doc = google.document.sheets[0];
  assert.equal(doc.properties.gridProperties.columnCount, 14);
  assert.equal(
    doc.data![0].rowData![0].values![13].effectiveValue!.stringValue,
    '=New member',
  );
  assert.match(
    doc.data![0].rowData![0].values![13].note!,
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
