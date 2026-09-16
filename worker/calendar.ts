import { safeUrl, validDate } from '../src/domain';
import { SESSION_MINUTES, sessionDetails, ZOOM_URL } from '../src/schedule';
import type { GroupState, Paper } from '../src/types';
import { ApiError } from './errors';

const encoder = new TextEncoder();
const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const text = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    // TEXT cannot carry control characters (other than horizontal tab).
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

/** RFC 5545: fold at 75 UTF-8 octets without splitting a code point. */
function fold(line: string) {
  let output = '',
    length = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (length + bytes > 75) {
      output += '\r\n ';
      length = 1;
    }
    output += char;
    length += bytes;
  }
  return output;
}

/** Convert a sheet wall time into UTC, including DST and fractional-hour offsets. */
export function sessionInstant(
  date: string,
  time: string,
  timeZone: string,
): Date {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new ApiError('A calendar session has an invalid date or time.', 409);
  const civil = Date.parse(`${date}T${time}:00Z`);
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new ApiError(
      'Check the spreadsheet time zone in File → Settings.',
      409,
    );
  }
  const wallTime = (instant: number) => {
    const p = Object.fromEntries(
      formatter.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    return Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    );
  };
  // Sample both sides of a possible offset change. During a repeated hour use
  // the first occurrence, as RFC 5545 prescribes for local ambiguous times.
  const candidates = new Set<number>();
  for (const delta of [-2, -1, 0, 1, 2]) {
    const sample = civil + delta * 86400000;
    const instant = civil - (wallTime(sample) - sample);
    if (wallTime(instant) === civil) candidates.add(instant);
  }
  if (!candidates.size)
    throw new ApiError(
      `The time ${time} on ${date} does not exist in ${timeZone} because the clocks change. Choose another start time.`,
      409,
    );
  return new Date(Math.min(...candidates));
}

export async function calendarFeed(
  state: GroupState,
  siteUrl: string,
  spreadsheetId: string,
  now = new Date(),
): Promise<string> {
  const sessions = new Map<string, Paper[]>();
  for (const paper of state.papers) {
    if (!paper.date) continue;
    if (!validDate(paper.date))
      throw new ApiError('A calendar session has an invalid date.', 409);
    const session = sessions.get(paper.date) || [];
    session.push(paper);
    sessions.set(paper.date, session);
  }
  // Independent of the serving hostname, paper order, title, time or location.
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(spreadsheetId),
  );
  const namespace = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const home = new URL('/#next-session', siteUrl).href;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MPLSE//Reading Group//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:MPLSE Reading Group',
  ];
  for (const [date, papers] of [...sessions.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    papers.sort((a, b) => a.id.localeCompare(b.id));
    const { times, locations } = sessionDetails(papers, date);
    if (times.length > 1 || locations.length > 1)
      throw new ApiError(
        `Papers on ${date} share one calendar event. Use the same Time and Location for them, or fill those details on just one of that day's rows.`,
        409,
      );
    const time = times[0],
      location = locations[0];
    lines.push(
      'BEGIN:VEVENT',
      `UID:${namespace}-${date}@mplse-reading-group`,
      `DTSTAMP:${stamp(now)}`,
    );
    if (time) {
      if (!state.timeZone)
        throw new ApiError(
          'The calendar needs the spreadsheet time zone.',
          409,
        );
      const start = sessionInstant(date, time, state.timeZone);
      lines.push(
        `DTSTART:${stamp(start)}`,
        `DTEND:${stamp(new Date(start.getTime() + SESSION_MINUTES * 60000))}`,
      );
    } else {
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      lines.push(
        `DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
      );
    }
    const description = [
      'MPLSE Reading Group',
      ...(location ? [`Location: ${location}`] : []),
      `Zoom: ${ZOOM_URL}`,
      `Reading group: ${home}`,
      '',
      ...papers.map((paper) =>
        [paper.title, paper.authors, safeUrl(paper.url), paper.notes]
          .filter(Boolean)
          .join('\n'),
      ),
    ].join('\n\n');
    lines.push(
      `SUMMARY:${text(papers.length === 1 ? `MPLSE Reading Group: ${papers[0].title}` : `MPLSE Reading Group (${papers.length} papers)`)}`,
      `DESCRIPTION:${text(description)}`,
      `URL:${home}`,
      `LOCATION:${text(location || ZOOM_URL)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
