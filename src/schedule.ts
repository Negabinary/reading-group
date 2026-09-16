import type { Paper } from './types';

export const ZOOM_URL = 'https://umich.zoom.us/j/93467587435';
export const SESSION_MINUTES = 60;
export const CALENDAR_PATH = '/calendar.ics';

/** A date is one reading-group session; blank cells inherit that day's details. */
export function sessionDetails(papers: Paper[], date: string) {
  const session = papers.filter((paper) => paper.date === date);
  const values = (field: 'time' | 'location') =>
    [
      ...new Set(session.map((paper) => paper[field]?.trim()).filter(Boolean)),
    ] as string[];
  return { times: values('time'), locations: values('location') };
}

export function timeLabel(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
