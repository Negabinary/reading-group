import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarFeed, sessionInstant } from '../worker/calendar';
import { decodeSheet } from '../worker/sheets';
import { fixture } from './sheet-fixture';
import { ZOOM_URL } from '../src/schedule';

const now = new Date('2026-09-15T12:00:00Z');
const site = 'https://reading.example/calendar.ics';
function state() {
  const data = decodeSheet(fixture(), 'sheet-id', now).state;
  Object.assign(data.papers[0], {
    date: '2026-09-21',
    time: '14:30',
    location: 'Beyster 3725',
  });
  return data;
}
const unfolded = (ics: string) => ics.replace(/\r\n[ \t]/g, '');
const uid = (ics: string) => unfolded(ics).match(/^UID:(.+)$/m)?.[1];

test('one 60-minute session contains all papers, room, Zoom and the site; undated papers are excluded', async () => {
  const data = state();
  data.papers.push({
    ...data.papers[0],
    id: 'paper-2',
    title: 'Second paper',
    url: 'https://example.com/second',
    time: '',
    location: '',
  });
  data.papers.push({
    ...data.papers[0],
    id: 'unscheduled',
    title: 'Not scheduled',
    date: '',
  });
  const ics = unfolded(await calendarFeed(data, site, 'sheet-id', now));
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 1);
  assert.match(ics, /DTSTART:20260921T183000Z\r\nDTEND:20260921T193000Z/);
  assert.match(ics, /DTSTAMP:20260915T120000Z/);
  assert.match(ics, /SUMMARY:MPLSE Reading Group \(2 papers\)/);
  for (const expected of [
    'Existing paper',
    'Second paper',
    'https://example.com/paper',
    'https://example.com/second',
    ZOOM_URL,
    'https://reading.example/#next-session',
    'LOCATION:Beyster 3725',
  ])
    assert.ok(ics.includes(expected), expected);
  assert.ok(!ics.includes('Not scheduled'));
});

test('blank times produce all-day events with exclusive next-day ends, including year rollover', async () => {
  const data = state();
  Object.assign(data.papers[0], { date: '2026-12-31', time: '', location: '' });
  const ics = unfolded(await calendarFeed(data, site, 'sheet-id', now));
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.ok(ics.includes(`LOCATION:${ZOOM_URL}`));
});

test('sheet time zone conversion handles winter, summer, half-hour offsets, midnight and DST boundaries', () => {
  for (const [date, time, zone, expected] of [
    ['2026-01-12', '14:30', 'America/Detroit', '2026-01-12T19:30:00.000Z'],
    ['2026-07-12', '14:30', 'America/Detroit', '2026-07-12T18:30:00.000Z'],
    ['2026-07-12', '00:00', 'Asia/Kolkata', '2026-07-11T18:30:00.000Z'],
    ['2026-11-01', '01:30', 'America/Detroit', '2026-11-01T05:30:00.000Z'],
  ])
    assert.equal(sessionInstant(date, time, zone).toISOString(), expected);
  assert.throws(
    () => sessionInstant('2026-03-08', '02:30', 'America/Detroit'),
    /does not exist/,
  );
  assert.throws(() => sessionInstant('2026-02-30', '12:00', 'UTC'), /invalid/);
  assert.throws(
    () => sessionInstant('2026-09-21', '12:00', 'Not/AZone'),
    /time zone/,
  );
});

test('calendar text is escaped, folded by UTF-8 bytes, and cannot inject another event', async () => {
  const data = state();
  data.papers[0].title = 'λ🙂'.repeat(45) + ',;\\end';
  data.papers[0].notes =
    'Read this\r\nEND:VEVENT\nBEGIN:VEVENT\rSUMMARY:Injected';
  data.papers[0].location = 'Room 1, north; second\\floor';
  const ics = await calendarFeed(data, site, 'sheet-id', now);
  for (const line of ics.split('\r\n'))
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!ics.replaceAll('\r\n', '').includes('\n'));
  const full = unfolded(ics);
  assert.equal(full.split('\r\nBEGIN:VEVENT\r\n').length - 1, 1);
  assert.ok(full.includes('\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:Injected'));
  assert.ok(full.includes('LOCATION:Room 1\\, north\\; second\\\\floor'));
  assert.ok(full.includes('λ🙂'.repeat(45) + '\\,\\;\\\\end'));
});

test('UIDs survive editing titles, times, rooms, paper order and serving hostname; dates track the sheet', async () => {
  const data = state();
  const first = await calendarFeed(data, site, 'sheet-id', now);
  Object.assign(data.papers[0], {
    title: 'Renamed',
    time: '15:00',
    location: 'Another room',
  });
  data.papers.push({ ...data.papers[0], id: 'paper-2' });
  data.papers.reverse();
  const changed = await calendarFeed(
    data,
    'https://new.example/',
    'sheet-id',
    now,
  );
  assert.equal(uid(first), uid(changed));
  assert.notEqual(
    uid(first),
    uid(await calendarFeed(data, site, 'different-sheet', now)),
  );
  data.papers.forEach((paper) => {
    paper.date = '2026-09-22';
  });
  const moved = unfolded(await calendarFeed(data, site, 'sheet-id', now));
  assert.ok(!moved.includes('DTSTART:20260921'));
  assert.ok(moved.includes('DTSTART:20260922'));
  data.papers.forEach((paper) => {
    paper.date = '';
  });
  assert.ok(
    !(await calendarFeed(data, site, 'sheet-id', now)).includes('BEGIN:VEVENT'),
  );
});

test('conflicting session details fail clearly instead of emitting a misleading calendar', async () => {
  for (const change of [{ time: '16:00' }, { location: 'Another room' }]) {
    const data = state();
    data.papers.push({ ...data.papers[0], id: 'paper-2', ...change });
    await assert.rejects(
      calendarFeed(data, site, 'sheet-id', now),
      /same Time and Location/,
    );
  }
});
