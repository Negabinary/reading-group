import type {
  GroupState,
  Member,
  Paper,
  PaperInput,
  PaperSort,
  RankedPaper,
  SearchPaper,
} from './types';

export const HISTORY_WINDOW = 6;
export const RECENCY_DECAY = 0.75;

export function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function safeUrl(value: string): string {
  const url = value.trim();
  // Apps Script has no browser URL constructor. Validate the scheme and authority directly.
  return /^https?:\/\/(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::\d{1,5})?(?:[/?#][^\s\\]*)?$/i.test(
    url,
  )
    ? url
    : '';
}

export function validatePaper(input: PaperInput): PaperInput {
  const limits: Record<keyof PaperInput, number> = {
    title: 500,
    authors: 1500,
    year: 4,
    venue: 200,
    url: 2000,
    topic: 100,
    notes: 2000,
  };
  const paper = {} as PaperInput;
  for (const key of Object.keys(limits) as (keyof PaperInput)[]) {
    if (typeof input?.[key] !== 'string')
      throw new Error(`Please provide a valid ${key}.`);
    paper[key] = input[key].trim();
    if (paper[key].length > limits[key])
      throw new Error(
        `${key} is too long (maximum ${limits[key]} characters).`,
      );
  }
  if (!paper.title) throw new Error('Give your paper a title.');
  if (paper.year && !/^(18|19|20|21)\d{2}$/.test(paper.year))
    throw new Error('Enter a four-digit publication year.');
  if (paper.url && !safeUrl(paper.url))
    throw new Error('Use a complete http:// or https:// paper link.');
  paper.url = safeUrl(paper.url);
  return paper;
}

function titleKey(title: string): string {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function duplicatePaper(
  papers: Paper[],
  input: PaperInput,
): Paper | undefined {
  return papers.find(
    (paper) =>
      titleKey(paper.title) === titleKey(input.title) ||
      Boolean(
        input.url &&
        paper.url &&
        paper.url.replace(/\/$/, '') === input.url.replace(/\/$/, ''),
      ),
  );
}

/** One meeting per date. Multiple papers on a date do not multiply attendance or wins. */
export function memberWeights(
  papers: Paper[],
  members: Member[],
  today: string,
): Record<string, number> {
  const dates = [
    ...new Set(
      papers.filter((p) => p.date && p.date < today).map((p) => p.date),
    ),
  ]
    .sort()
    .reverse()
    .slice(0, HISTORY_WINDOW);
  const total = dates.reduce(
    (sum, _, index) => sum + RECENCY_DECAY ** index,
    0,
  );
  return Object.fromEntries(
    members.map((member) => {
      let attended = 0;
      let selected = 0;
      dates.forEach((date, index) => {
        const meeting = papers.filter((paper) => paper.date === date);
        const recency = RECENCY_DECAY ** index;
        if (meeting.some((p) => p.attendance.includes(member.id)))
          attended += recency;
        if (meeting.some((p) => p.votes.includes(member.id)))
          selected += recency;
      });
      return [
        member.id,
        total ? (1 + (3 * attended) / total) / (1 + (2 * selected) / total) : 1,
      ];
    }),
  );
}

function suggestionTime(paper: Paper): number {
  const time = Date.parse(paper.addedAt);
  return Number.isFinite(time) ? time : -Infinity;
}

export function rankPapers(
  state: GroupState,
  sort: PaperSort = 'votes',
): RankedPaper[] {
  const weights = memberWeights(state.papers, state.members, state.today);
  return state.papers
    .map((paper) => {
      const voters = [...new Set(paper.votes)].filter((id) => id in weights);
      return {
        ...paper,
        voteCount: voters.length,
        score: voters.reduce((sum, id) => sum + weights[id], 0),
      };
    })
    .sort((a, b) =>
      sort === 'newest'
        ? suggestionTime(b) - suggestionTime(a) || a.id.localeCompare(b.id)
        : (sort === 'score' ? b.score - a.score : b.voteCount - a.voteCount) ||
          a.addedAt.localeCompare(b.addedAt) ||
          a.id.localeCompare(b.id),
    );
}

export function parseMark(value: unknown): {
  voted: boolean;
  attended: boolean;
} {
  const mark = String(value ?? '')
    .trim()
    .toUpperCase();
  // 1 / TRUE are accepted for convenient spreadsheet voting.
  if (
    !['', 'V', 'A', 'VA', 'AV', 'V+A', '1', '0', 'TRUE', 'FALSE'].includes(mark)
  ) {
    throw new Error(
      `Unknown member-cell value “${mark}”. Use blank, V, A, or VA.`,
    );
  }
  return {
    voted: ['V', 'VA', 'AV', 'V+A', '1', 'TRUE'].includes(mark),
    attended: mark.includes('A') && mark !== 'FALSE',
  };
}

export function formatMark(voted: boolean, attended: boolean): string {
  return `${voted ? 'V' : ''}${attended ? 'A' : ''}`;
}

export function parseDblp(data: unknown): SearchPaper[] {
  const raw = (
    data as {
      result?: {
        hits?: {
          hit?:
            | { info: Record<string, unknown> }[]
            | { info: Record<string, unknown> };
        };
      };
    }
  )?.result?.hits;
  if (!raw)
    throw new Error(
      'DBLP returned an unexpected response. Try again or add a paper manually.',
    );
  const hits = raw.hit ? (Array.isArray(raw.hit) ? raw.hit : [raw.hit]) : [];
  return hits
    .map(({ info }) => {
      const authorData = (info.authors as { author?: unknown } | undefined)
        ?.author;
      const authors = authorData
        ? Array.isArray(authorData)
          ? authorData
          : [authorData]
        : [];
      const links = Array.isArray(info.ee) ? info.ee : [info.ee];
      return {
        title: String(info.title ?? '').replace(/\.$/, ''),
        authors: authors
          .map((a) =>
            typeof a === 'string'
              ? a
              : String((a as { text?: string }).text ?? ''),
          )
          .filter(Boolean)
          .join(', '),
        year: String(info.year ?? ''),
        venue: String(info.venue ?? ''),
        url:
          links.map((link) => safeUrl(String(link ?? ''))).find(Boolean) ||
          safeUrl(String(info.url ?? '')),
      };
    })
    .filter((paper) => paper.title);
}
