import {
  duplicatePaper,
  formatMark,
  normalizeName,
  parseMark,
  safeUrl,
  validDate,
  validatePaper,
} from '../src/domain';
import { catalogs, SEARCH_ERROR } from '../src/catalogs';
import type { GroupState, Paper, PaperInput } from '../src/types';

const TAB = 'Papers';
const HEADERS = [
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
];
const USER_PREFIX = 'mplse-user:';

function locked<T>(work: () => T): T {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return work();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  const id =
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setupMplse in the Apps Script editor first.');
  const tab = SpreadsheetApp.openById(id).getSheetByName(TAB);
  if (!tab)
    throw new Error('The Papers tab is missing. Restore it or run setupMplse.');
  return tab;
}

function literal(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cellDate(value: unknown, timezone: string, row: number): string {
  if (!value) return '';
  const date =
    value instanceof Date
      ? Utilities.formatDate(value, timezone, 'yyyy-MM-dd')
      : String(value).trim();
  if (!validDate(date))
    throw new Error(`Date in row ${row} must be a date or YYYY-MM-DD.`);
  return date;
}

function read(tab: GoogleAppsScript.Spreadsheet.Sheet): GroupState {
  const values = tab.getDataRange().getValues();
  if (!HEADERS.every((header, index) => values[0]?.[index] === header)) {
    throw new Error(
      'Keep the fixed columns ID through Date in their original order. People’s columns belong after Date.',
    );
  }
  const headerNotes = tab.getRange(1, 1, 1, values[0].length).getNotes()[0];
  const members: GroupState['members'] = [];
  const columns: { id: string; column: number }[] = [];
  for (let column = HEADERS.length; column < values[0].length; column++) {
    const name = normalizeName(String(values[0][column]));
    if (!name) continue;
    if (
      members.some(
        (member) =>
          member.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new Error(
        `Two member columns are named “${name}”. Give each person a distinct name.`,
      );
    const stored = headerNotes[column]?.match(/^mplse-user:([^\s]+)/)?.[1];
    const id = stored || Utilities.getUuid();
    if (members.some((member) => member.id === id))
      throw new Error(
        `The column for ${name} has a copied identity note. Clear its header note to create a new identity.`,
      );
    if (!stored)
      tab
        .getRange(1, column + 1)
        .setNote(
          `${USER_PREFIX}${id}\nKeep this note when renaming a person. Cell values: V = vote, A = attended, VA = both.`,
        );
    members.push({ id, name });
    columns.push({ id, column });
  }
  const timezone = tab.getParent().getSpreadsheetTimeZone();
  const papers: Paper[] = [];
  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    if (!String(row[1] ?? '').trim()) continue;
    const id = String(row[0] || Utilities.getUuid());
    if (!row[0]) tab.getRange(index + 1, 1).setValue(id);
    if (papers.some((p) => p.id === id))
      throw new Error(
        `Duplicate paper ID in row ${index + 1}. Clear that row’s ID to generate a new one.`,
      );
    const paper: Paper = {
      id,
      title: String(row[1]),
      authors: String(row[2] || ''),
      year: String(row[3] || ''),
      venue: String(row[4] || ''),
      url: safeUrl(String(row[5] || '')),
      topic: String(row[6] || ''),
      notes: String(row[7] || ''),
      suggestedBy: String(row[8] || ''),
      addedAt:
        row[9] instanceof Date ? row[9].toISOString() : String(row[9] || ''),
      date: cellDate(row[10], timezone, index + 1),
      votes: [],
      attendance: [],
    };
    for (const { id: memberId, column } of columns) {
      try {
        const mark = parseMark(row[column]);
        if (mark.voted) paper.votes.push(memberId);
        if (mark.attended) paper.attendance.push(memberId);
      } catch (error) {
        throw new Error(
          `Row ${index + 1}, ${values[0][column]}: ${(error as Error).message}`,
        );
      }
    }
    papers.push(paper);
  }
  return {
    members,
    papers,
    sheetUrl: tab.getParent().getUrl(),
    today: Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd'),
  };
}

export function setup(): void {
  console.log('[MPLSE setup] Started; reading the bound spreadsheet.');
  // A bound spreadsheet is available to editor runs, but not to web-app calls.
  // Do not fall back to a supplied/stored ID here: this also guards public setup calls.
  // Setup never needs SpreadsheetApp.getUi(), which may be unavailable in editor contexts.
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet)
    throw new Error(
      'Setup needs a script bound to your Google Sheet. Open the sheet → Extensions → Apps Script, paste Code.gs there, and run setupMplse from that editor.',
    );
  console.log(
    '[MPLSE setup] Bound spreadsheet available; acquiring setup lock.',
  );
  locked(() => {
    console.log('[MPLSE setup] Finding the Papers tab.');
    let tab = spreadsheet.getSheetByName(TAB);
    if (!tab) {
      console.log('[MPLSE setup] Creating the Papers tab.');
      tab = spreadsheet.insertSheet(TAB);
    }
    if (tab.getLastRow() > 0) {
      console.log('[MPLSE setup] Checking existing headers; preserving data.');
      const existing = tab.getRange(1, 1, 1, HEADERS.length).getValues()[0];
      if (!HEADERS.every((header, index) => existing[index] === header))
        throw new Error(
          'Papers already contains a different layout. Rename that tab before setup; no data was changed.',
        );
    } else {
      console.log('[MPLSE setup] Writing the initial headers.');
      tab.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      console.log('[MPLSE setup] Formatting the new Papers tab.');
      tab.setFrozenRows(1);
      tab.setFrozenColumns(2);
      tab
        .getRange(1, 1, 1, tab.getMaxColumns())
        .setBackground('#172d29')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
      tab.setColumnWidth(2, 420);
      tab.setColumnWidth(3, 250);
      tab.setColumnWidth(8, 340);
      tab.getRange('K2:K').setNumberFormat('yyyy-mm-dd');
      tab
        .getRange('K1')
        .setNote(
          'Set a discussion date to schedule the paper. Voting closes when a date is set. Clear the date to return it to the pool.',
        );
      tab
        .getRange('I1')
        .setNote(
          'Stable identity of the suggester. Display names are stored in member column headers.',
        );
      tab
        .getRange('A1')
        .setNote(
          'Stable paper ID, assigned automatically. Leave blank when adding a new paper manually.',
        );
    }
    console.log('[MPLSE setup] Saving the spreadsheet connection.');
    PropertiesService.getScriptProperties().setProperty(
      'SPREADSHEET_ID',
      spreadsheet.getId(),
    );
  });
  console.log('[MPLSE setup] Complete. The Papers tab is ready.');
}

export function getState(): GroupState {
  return locked(() => read(sheet()));
}

export function signIn(name: string) {
  if (typeof name !== 'string') throw new Error('Enter your name.');
  const clean = normalizeName(name);
  if (!clean || clean.length > 60)
    throw new Error('Enter a name between 1 and 60 characters.');
  return locked(() => {
    const tab = sheet();
    const state = read(tab);
    const existing = state.members.find(
      (m) => m.name.toLocaleLowerCase() === clean.toLocaleLowerCase(),
    );
    if (existing) return { member: existing, state };
    const column = tab.getLastColumn() + 1;
    if (column > tab.getMaxColumns())
      tab.insertColumnAfter(tab.getMaxColumns());
    const member = { id: Utilities.getUuid(), name: clean };
    tab
      .getRange(1, column)
      .setValue(literal(clean))
      .setNote(
        `${USER_PREFIX}${member.id}\nKeep this note when renaming a person. Cell values: V = vote, A = attended, VA = both.`,
      )
      .setBackground('#172d29')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['V', 'A', 'VA'], true)
      .setAllowInvalid(false)
      .build();
    tab
      .getRange(2, column, tab.getMaxRows() - 1, 1)
      .setDataValidation(validation);
    state.members.push(member);
    return { member, state };
  });
}

export function setVote(
  paperId: string,
  memberId: string,
  voted: boolean,
): GroupState {
  if (typeof voted !== 'boolean')
    throw new Error('A vote must be true or false.');
  return locked(() => {
    const tab = sheet();
    const state = read(tab);
    if (!state.members.some((member) => member.id === memberId))
      throw new Error(
        'Your member column has been removed. Please sign in again.',
      );
    const paper = state.papers.find((p) => p.id === paperId);
    if (!paper)
      throw new Error('This paper has been removed. Refresh the pool.');
    if (paper.date) throw new Error('Voting is closed for scheduled papers.');
    const values = tab.getDataRange().getValues();
    const row =
      values.findIndex((cells, i) => i > 0 && String(cells[0]) === paperId) + 1;
    const notes = tab.getRange(1, 1, 1, values[0].length).getNotes()[0];
    const column =
      notes.findIndex(
        (note) => note.split('\n')[0] === `${USER_PREFIX}${memberId}`,
      ) + 1;
    if (!row || !column)
      throw new Error('The sheet layout changed. Refresh and try again.');
    tab
      .getRange(row, column)
      .setValue(formatMark(voted, paper.attendance.includes(memberId)));
    paper.votes = paper.votes.filter((id) => id !== memberId);
    if (voted) paper.votes.push(memberId);
    return state;
  });
}

export function suggestPaper(input: PaperInput, memberId: string): GroupState {
  const paper = validatePaper(input);
  return locked(() => {
    const tab = sheet();
    const state = read(tab);
    if (!state.members.some((m) => m.id === memberId))
      throw new Error('Please sign in again.');
    if (duplicatePaper(state.papers, paper))
      throw new Error(
        'This paper is already in the reading group. Find it in the pool or archive.',
      );
    const id = Utilities.getUuid();
    const addedAt = new Date().toISOString();
    const notes = tab.getRange(1, 1, 1, tab.getLastColumn()).getNotes()[0];
    const row = [
      id,
      paper.title,
      paper.authors,
      paper.year,
      paper.venue,
      paper.url,
      paper.topic,
      paper.notes,
      memberId,
      addedAt,
      '',
    ].map(literal);
    for (let column = HEADERS.length; column < notes.length; column++)
      row.push(
        notes[column].split('\n')[0] === `${USER_PREFIX}${memberId}` ? 'V' : '',
      );
    tab.appendRow(row);
    state.papers.push({
      ...paper,
      id,
      suggestedBy: memberId,
      addedAt,
      date: '',
      votes: [memberId],
      attendance: [],
    });
    return state;
  });
}

export function searchPapers(query: string) {
  if (
    typeof query !== 'string' ||
    query.trim().length < 2 ||
    query.length > 200
  )
    throw new Error('Search with 2–200 characters.');
  const key = `papers:v2:${query.trim().toLowerCase()}`;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  let reachedCatalog = false;
  for (const catalog of catalogs(query)) {
    try {
      const response = UrlFetchApp.fetch(catalog.url, {
        muteHttpExceptions: true,
      });
      if (response.getResponseCode() !== 200) continue;
      const results = catalog.parse(JSON.parse(response.getContentText()));
      reachedCatalog = true;
      if (results.length) {
        const sourced = results.map((paper) => ({
          ...paper,
          source: catalog.source,
        }));
        cache.put(key, JSON.stringify(sourced), 600);
        return sourced;
      }
    } catch {
      /* Unavailable providers, including HTTP 200 bot checks, fall back. */
    }
  }
  if (reachedCatalog) return [];
  throw new Error(SEARCH_ERROR);
}
