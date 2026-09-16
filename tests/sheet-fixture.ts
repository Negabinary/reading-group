import assert from 'node:assert/strict';
import {
  HEADERS,
  memberNote,
  type Cell,
  type SheetDocument,
} from '../worker/sheets';

export const cell = (s: string): Cell => ({
  effectiveValue: { stringValue: s },
});
export function fixture(): SheetDocument {
  const headers = [...HEADERS, 'Alex', 'Sam'].map(cell);
  headers[11].note = memberNote('alex-id');
  headers[12].note = memberNote('sam-id');
  return {
    properties: { timeZone: 'America/Detroit' },
    sheets: [
      {
        properties: {
          sheetId: 42,
          title: 'Papers',
          gridProperties: { rowCount: 100, columnCount: 13 },
        },
        data: [
          {
            rowData: [
              { values: headers },
              {
                values: [
                  'paper-1',
                  'Existing paper',
                  'Authors',
                  '2026',
                  'Venue',
                  'https://example.com/paper',
                  '',
                  '',
                  'alex-id',
                  '2026-09-01T12:00:00Z',
                  '',
                  'VA',
                  'V',
                ].map(cell),
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Emulate the small Google wire format we use, not the app's operations. */
export class SheetFixture {
  document = fixture();
  reads = 0;
  writes: any[][] = [];
  failWrite = false;
  async request<T>(
    suffix: string,
    _signal: AbortSignal,
    body?: any,
  ): Promise<T> {
    if (body === undefined) {
      assert.equal(
        new URLSearchParams(suffix.slice(1)).get('ranges'),
        "'Papers'",
      );
      this.reads++;
      return structuredClone(this.document) as T;
    }
    assert.equal(suffix, ':batchUpdate');
    if (this.failWrite) throw new Error('Simulated lost response');
    const next = structuredClone(this.document);
    const tab = next.sheets[0];
    const rows = tab.data![0].rowData!;
    for (const request of body.requests) {
      if (request.appendDimension) {
        assert.equal(request.appendDimension.dimension, 'COLUMNS');
        tab.properties.gridProperties.columnCount +=
          request.appendDimension.length;
      } else if (request.updateCells) {
        const { start, fields, rows: updates } = request.updateCells;
        assert.equal(start.sheetId, 42);
        assert.ok(
          start.columnIndex < tab.properties.gridProperties.columnCount,
        );
        updates.forEach((row: any, r: number) => {
          rows[start.rowIndex + r] ||= { values: [] };
          row.values.forEach((update: any, c: number) => {
            const at = start.columnIndex + c;
            const cells = rows[start.rowIndex + r].values!;
            cells[at] ||= {};
            if (fields.includes('note')) cells[at].note = update.note;
            if (fields.includes('userEnteredValue'))
              cells[at].effectiveValue = update.userEnteredValue;
          });
        });
      } else if (request.appendCells) {
        assert.equal(request.appendCells.sheetId, 42);
        request.appendCells.rows.forEach((row: any) =>
          rows.push({
            values: row.values.map((c: any) => ({
              effectiveValue: c.userEnteredValue,
            })),
          }),
        );
      } else if (request.setDataValidation) {
        assert.equal(request.setDataValidation.range.sheetId, 42);
        assert.equal(request.setDataValidation.rule.strict, true);
      } else if (request.repeatCell) {
        assert.equal(request.repeatCell.range.sheetId, 42);
        assert.equal(
          request.repeatCell.fields,
          'userEnteredFormat.numberFormat',
        );
        assert.deepEqual(
          request.repeatCell.cell.userEnteredFormat.numberFormat,
          { type: 'TIME', pattern: 'h:mm am/pm' },
        );
      } else throw new Error('Unrecognized Sheets write in test');
    }
    this.writes.push(structuredClone(body.requests));
    this.document = next;
    return {} as T;
  }
}
