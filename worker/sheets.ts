import {
  duplicatePaper,
  formatMark,
  normalizeName,
  parseMark,
  safeUrl,
  validDate,
} from '../src/domain';
import type { GroupState, Paper } from '../src/types';
import { SESSION_MINUTES } from '../src/schedule';
import type { SheetCommand } from './commands';
import { ApiError } from './errors';
import type { GoogleSheets } from './google';

export const HEADERS = [
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
export const USER_PREFIX = 'mplse-user:';
const SCHEDULE_FIELDS = ['Time', 'Location'] as const;
export interface Cell {
  effectiveValue?: {
    stringValue?: string;
    numberValue?: number;
    boolValue?: boolean;
    errorValue?: { message?: string };
  };
  effectiveFormat?: { numberFormat?: { type?: string } };
  note?: string;
}
export interface SheetDocument {
  properties: { timeZone: string };
  sheets: {
    properties: {
      sheetId: number;
      title: string;
      gridProperties: { rowCount: number; columnCount: number };
    };
    data?: {
      startRow?: number;
      startColumn?: number;
      rowData?: { values?: Cell[] }[];
    }[];
  }[];
}
// Deliberately small Sheets API write surface: no arbitrary user-supplied requests.
export type SheetWrite = Record<string, unknown>;
export function memberNote(id: string): string {
  return `${USER_PREFIX}${id}\nKeep this note when renaming a person. Cell values: V = vote, A = attended, VA = both.`;
}
export function textCell(value: string) {
  return { userEnteredValue: { stringValue: value } };
}
function updateCell(
  sheetId: number,
  rowIndex: number,
  columnIndex: number,
  cell: unknown,
  fields = 'userEnteredValue',
): SheetWrite {
  return {
    updateCells: {
      start: { sheetId, rowIndex, columnIndex },
      rows: [{ values: [cell] }],
      fields,
    },
  };
}
function value(cell?: Cell): string {
  const v = cell?.effectiveValue;
  if (v?.errorValue)
    throw new ApiError(
      'The Papers tab contains a cell formula error. Fix it in Google Sheets and refresh.',
      409,
    );
  return String(v?.stringValue ?? v?.numberValue ?? v?.boolValue ?? '');
}
function serialDate(cell?: Cell): Date | undefined {
  const n = cell?.effectiveValue?.numberValue;
  const type = cell?.effectiveFormat?.numberFormat?.type;
  if (n === undefined || (type !== 'DATE' && type !== 'DATE_TIME')) return;
  // Sheets serials are civil dates/times in the spreadsheet timezone, not UTC instants.
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
  if (!Number.isFinite(date.getTime()))
    throw new ApiError('The Papers tab contains an invalid date.', 409);
  return date;
}
function discussionDate(cell: Cell | undefined, row: number): string {
  const date =
    serialDate(cell)?.toISOString().slice(0, 10) ?? value(cell).trim();
  if (date && !validDate(date))
    throw new ApiError(`Date in row ${row} must be a date or YYYY-MM-DD.`, 409);
  return date;
}
function discussionTime(cell: Cell | undefined, row: number): string {
  const raw = value(cell).trim();
  if (!raw) return '';
  const number = cell?.effectiveValue?.numberValue;
  if (
    number !== undefined &&
    Number.isFinite(number) &&
    number >= 0 &&
    number < 1
  ) {
    const minutes = Math.round(number * 1440);
    if (minutes < 1440)
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  } else if (number === undefined) {
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::00)?\s*(am|pm)?$/i);
    if (match) {
      let hour = Number(match[1]);
      const minute = Number(match[2]);
      const period = match[3]?.toLowerCase();
      if (minute < 60 && (period ? hour >= 1 && hour <= 12 : hour < 24)) {
        if (period) hour = (hour % 12) + (period === 'pm' ? 12 : 0);
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      }
    }
  }
  throw new ApiError(
    `Time in row ${row} must be a time such as 14:30 or 2:30 PM.`,
    409,
  );
}
function parts(date: Date, timeZone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
}
function addedAt(cell: Cell | undefined, timeZone: string): string {
  const civil = serialDate(cell);
  if (!civil) return value(cell);
  let instant = civil.getTime();
  // Convert the sheet's local wall time to UTC. Normal ISO strings pass through untouched.
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(instant), timeZone);
    const local = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    instant += civil.getTime() - (local + (((instant % 1000) + 1000) % 1000));
  }
  return new Date(instant).toISOString();
}

export function decodeSheet(
  document: SheetDocument,
  spreadsheetId: string,
  now = new Date(),
) {
  const tab = document.sheets?.find((s) => s.properties.title === 'Papers');
  if (!tab)
    throw new ApiError(
      'The Papers tab is missing. Restore it in Google Sheets.',
      409,
    );
  const sheetId = tab.properties.sheetId;
  const rows: Cell[][] = [];
  for (const grid of tab.data || []) {
    for (const [index, row] of (grid.rowData || []).entries()) {
      const at = (grid.startRow || 0) + index;
      rows[at] ||= [];
      for (const [column, cell] of (row.values || []).entries())
        rows[at][(grid.startColumn || 0) + column] = cell;
    }
  }
  const headers = rows[0] || [];
  if (!HEADERS.every((header, index) => value(headers[index]) === header))
    throw new ApiError(
      'Keep the fixed columns ID through Date in their original order. People’s columns belong after Date.',
      409,
    );
  const repairs: SheetWrite[] = [];
  const members: GroupState['members'] = [];
  const columns = new Map<string, number>();
  const scheduleColumns = new Map<string, number>();
  let width = HEADERS.length;
  // Ignore formatting-only cells, but never overwrite data below a blank header.
  rows.forEach((row) =>
    row.forEach((cell, column) => {
      if (value(cell) || cell?.note) width = Math.max(width, column + 1);
    }),
  );
  for (let column = HEADERS.length; column < width; column++) {
    const name = normalizeName(value(headers[column]));
    if (!name) continue;
    const note = headers[column]?.note || '';
    // Existing members called Time/Location retain their identities and votes.
    const scheduleField = SCHEDULE_FIELDS.find(
      (field) => field.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (scheduleField && !note.startsWith(USER_PREFIX)) {
      if (scheduleColumns.has(scheduleField))
        throw new ApiError(
          `Keep only one ${name} column in the Papers tab.`,
          409,
        );
      scheduleColumns.set(scheduleField, column);
      continue;
    }
    if (note.startsWith('mplse-field:'))
      throw new ApiError(
        'Keep the scheduling column headers named Time and Location.',
        409,
      );
    if (
      members.some(
        (m) => m.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new ApiError(
        `Two member columns are named “${name}”. Give each person a distinct name.`,
        409,
      );
    const stored = note.match(/^mplse-user:([^\s]+)/)?.[1];
    const id = stored || crypto.randomUUID();
    if (columns.has(id))
      throw new ApiError(
        `The column for ${name} has a copied identity note. Clear its header note to create a new identity.`,
        409,
      );
    if (!stored)
      repairs.push(
        updateCell(
          sheetId,
          0,
          column,
          { note: memberNote(id) + (note ? `\n${note}` : '') },
          'note',
        ),
      );
    members.push({ id, name });
    columns.set(id, column);
  }
  const paperRows = new Map<string, number>();
  const papers: Paper[] = [];
  const timezone = document.properties.timeZone;
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index] || [];
    if (!value(row[1]).trim()) continue;
    const stored = value(row[0]);
    const id = stored || crypto.randomUUID();
    if (paperRows.has(id))
      throw new ApiError(
        `Duplicate paper ID in row ${index + 1}. Clear that row’s ID to generate a new one.`,
        409,
      );
    if (!stored) repairs.push(updateCell(sheetId, index, 0, textCell(id)));
    paperRows.set(id, index);
    const paper: Paper = {
      id,
      title: value(row[1]),
      authors: value(row[2]),
      year: value(row[3]),
      venue: value(row[4]),
      url: safeUrl(value(row[5])),
      topic: value(row[6]),
      notes: value(row[7]),
      suggestedBy: value(row[8]),
      addedAt: addedAt(row[9], timezone),
      date: discussionDate(row[10], index + 1),
      time: discussionTime(row[scheduleColumns.get('Time') ?? -1], index + 1),
      location: value(row[scheduleColumns.get('Location') ?? -1]).trim(),
      votes: [],
      attendance: [],
    };
    for (const member of members) {
      let mark;
      try {
        mark = parseMark(value(row[columns.get(member.id)!]));
      } catch (error) {
        throw new ApiError(
          `Row ${index + 1}, ${member.name}: ${(error as Error).message}`,
          409,
        );
      }
      if (mark.voted) paper.votes.push(member.id);
      if (mark.attended) paper.attendance.push(member.id);
    }
    papers.push(paper);
  }
  const p = parts(now, timezone);
  const state: GroupState = {
    members,
    papers,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
    today: `${p.year}-${p.month}-${p.day}`,
    timeZone: timezone,
  };
  return {
    state,
    repairs,
    columns,
    scheduleColumns,
    paperRows,
    sheetId,
    width,
    grid: tab.properties.gridProperties,
  };
}

const fields =
  'properties(timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(effectiveValue,effectiveFormat(numberFormat(type)),note))))';
export class ReadingSheet {
  constructor(
    private google: Pick<GoogleSheets, 'request'>,
    private spreadsheetId: string,
  ) {}

  /** Caller must serialize the entire read/validate/write through one Durable Object. */
  async execute(command: SheetCommand, signal: AbortSignal): Promise<unknown> {
    const query = new URLSearchParams({ ranges: "'Papers'", fields });
    const document = await this.google.request<SheetDocument>(
      `?${query}`,
      signal,
    );
    const model = decodeSheet(document, this.spreadsheetId);
    const { state, columns, paperRows, sheetId, grid, scheduleColumns } = model;
    let width = model.width;
    let gridWidth = grid.columnCount;
    const writes = [...model.repairs];
    // Extend at the right edge: no existing cell or member column moves.
    // This is committed with repairs/mutations only after all validation succeeds.
    for (const field of SCHEDULE_FIELDS) {
      if (scheduleColumns.has(field)) continue;
      const column = width++;
      if (width > gridWidth) {
        writes.push({
          appendDimension: {
            sheetId,
            dimension: 'COLUMNS',
            length: width - gridWidth,
          },
        });
        gridWidth = width;
      }
      writes.push(
        updateCell(
          sheetId,
          0,
          column,
          {
            ...textCell(field),
            note:
              field === 'Time'
                ? `mplse-field:time\nStart time in the spreadsheet time zone (File → Settings). Calendar sessions last ${SESSION_MINUTES} minutes. Blank means all-day; papers on the same date share a session.`
                : 'mplse-field:location\nRoom or meeting location. Papers on the same date share a session. The calendar also includes the group Zoom link.',
            userEnteredFormat: {
              backgroundColor: {
                red: 23 / 255,
                green: 45 / 255,
                blue: 41 / 255,
              },
              textFormat: {
                foregroundColor: { red: 1, green: 1, blue: 1 },
                bold: true,
              },
            },
          },
          'userEnteredValue,note,userEnteredFormat',
        ),
      );
      if (field === 'Time')
        writes.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: column,
              endColumnIndex: column + 1,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'TIME', pattern: 'h:mm am/pm' },
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
    }
    let result: unknown = state;
    if (command.action === 'signIn') {
      let member = state.members.find(
        (m) => m.name.toLocaleLowerCase() === command.name.toLocaleLowerCase(),
      );
      if (!member) {
        member = { id: crypto.randomUUID(), name: command.name };
        if (width >= gridWidth)
          writes.push({
            appendDimension: {
              sheetId,
              dimension: 'COLUMNS',
              length: width - gridWidth + 1,
            },
          });
        writes.push(
          updateCell(
            sheetId,
            0,
            width,
            {
              ...textCell(member.name),
              note: memberNote(member.id),
              userEnteredFormat: {
                backgroundColor: {
                  red: 23 / 255,
                  green: 45 / 255,
                  blue: 41 / 255,
                },
                textFormat: {
                  foregroundColor: { red: 1, green: 1, blue: 1 },
                  bold: true,
                },
              },
            },
            'userEnteredValue,note,userEnteredFormat',
          ),
        );
        // Open-ended row range also covers rows added later.
        writes.push({
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: width,
              endColumnIndex: width + 1,
            },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: ['V', 'A', 'VA'].map((userEnteredValue) => ({
                  userEnteredValue,
                })),
              },
              strict: true,
              showCustomUi: true,
            },
          },
        });
        state.members.push(member);
      }
      result = { member, state };
    } else if (command.action === 'setVote') {
      const column = columns.get(command.memberId);
      if (column === undefined)
        throw new ApiError(
          'Your member column has been removed. Please sign in again.',
          409,
        );
      const paper = state.papers.find((p) => p.id === command.paperId);
      if (!paper)
        throw new ApiError(
          'This paper has been removed. Refresh the pool.',
          409,
        );
      if (paper.date)
        throw new ApiError('Voting is closed for scheduled papers.', 409);
      writes.push(
        updateCell(
          sheetId,
          paperRows.get(paper.id)!,
          column,
          textCell(
            formatMark(
              command.voted,
              paper.attendance.includes(command.memberId),
            ),
          ),
        ),
      );
      paper.votes = paper.votes.filter((id) => id !== command.memberId);
      if (command.voted) paper.votes.push(command.memberId);
    } else if (command.action === 'suggestPaper') {
      if (!columns.has(command.memberId))
        throw new ApiError('Please sign in again.', 409);
      if (duplicatePaper(state.papers, command.paper))
        throw new ApiError(
          'This paper is already in the reading group. Find it in the pool or archive.',
          409,
        );
      const paper: Paper = {
        ...command.paper,
        id: crypto.randomUUID(),
        addedAt: new Date().toISOString(),
        suggestedBy: command.memberId,
        date: '',
        time: '',
        location: '',
        votes: [command.memberId],
        attendance: [],
      };
      const cells = [
        paper.id,
        paper.title,
        paper.authors,
        paper.year,
        paper.venue,
        paper.url,
        paper.topic,
        paper.notes,
        paper.suggestedBy,
        paper.addedAt,
        '',
      ];
      for (let column = HEADERS.length; column < width; column++)
        cells.push(column === columns.get(command.memberId) ? 'V' : '');
      writes.push({
        appendCells: {
          sheetId,
          rows: [{ values: cells.map(textCell) }],
          fields: 'userEnteredValue',
        },
      });
      state.papers.push(paper);
    }
    // Repairs and the intended mutation are atomic in a single Sheets batch.
    // Failed validation above performs no writes, including ID repairs.
    if (writes.length)
      await this.google.request(':batchUpdate', signal, { requests: writes });
    return result;
  }
}
