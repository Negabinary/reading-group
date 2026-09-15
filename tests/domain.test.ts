import test from 'node:test';
import assert from 'node:assert/strict';
import {
  duplicatePaper,
  formatMark,
  memberWeights,
  normalizeName,
  parseDblp,
  parseMark,
  rankPapers,
  safeUrl,
  validDate,
  validatePaper,
} from '../src/domain';
import type { Member, Paper, PaperInput } from '../src/types';
import { catalogs, parseCrossref } from '../src/catalogs';

const members: Member[] = [
  { id: 'a', name: 'Alex' },
  { id: 'b', name: 'Blair' },
  { id: 'c', name: 'Casey' },
];
const input: PaperInput = {
  title: 'A paper',
  authors: 'An Author',
  year: '2025',
  venue: 'POPL',
  url: 'https://example.org/paper',
  topic: 'Theory',
  notes: '',
};
const paper = (overrides: Partial<Paper> = {}): Paper => ({
  ...input,
  id: 'p',
  suggestedBy: 'a',
  addedAt: '2026-08-01',
  date: '',
  votes: [],
  attendance: [],
  ...overrides,
});

test('no history gives every member a weight of one', () => {
  assert.deepEqual(memberWeights([], members, '2026-09-14'), {
    a: 1,
    b: 1,
    c: 1,
  });
});

test('attendance raises weights and recently selected votes lower them', () => {
  const history = [
    paper({ date: '2026-09-01', votes: ['a'], attendance: ['a', 'b'] }),
  ];
  const weights = memberWeights(history, members, '2026-09-14');
  assert.equal(weights.a, 4 / 3);
  assert.equal(weights.b, 4);
  assert.equal(weights.c, 1);
});

test('recency matters; future and same-day meetings do not affect weights', () => {
  const history = [
    paper({ date: '2026-09-10', attendance: ['a'] }),
    paper({ id: 'p2', date: '2026-09-01', attendance: ['b'] }),
  ];
  const weights = memberWeights(history, members, '2026-09-14');
  assert.ok(weights.a > weights.b);
  assert.deepEqual(
    memberWeights(
      [
        ...history,
        paper({ date: '2026-09-14', votes: ['a'], attendance: ['c'] }),
        paper({ date: '2026-10-01', votes: ['b'] }),
      ],
      members,
      '2026-09-14',
    ),
    weights,
  );
});

test('multiple papers discussed on a date count as one meeting', () => {
  const a = paper({ date: '2026-09-01', votes: ['a'], attendance: ['b'] });
  assert.deepEqual(
    memberWeights([a, { ...a, id: 'duplicate-date' }], members, '2026-09-14'),
    memberWeights([a], members, '2026-09-14'),
  );
});

test('only the last six meeting dates affect scores', () => {
  const recent = Array.from({ length: 6 }, (_, i) =>
    paper({ id: `p${i}`, date: `2026-09-0${i + 1}`, attendance: ['b'] }),
  );
  const old = paper({ date: '2026-08-01', attendance: ['a'], votes: ['b'] });
  assert.deepEqual(
    memberWeights([...recent, old], members, '2026-09-14'),
    memberWeights(recent, members, '2026-09-14'),
  );
});

test('pool ranking follows vote count even when another paper has a higher score', () => {
  const papers = [
    paper({
      id: 'history',
      date: '2026-09-01',
      attendance: ['b'],
      votes: ['a', 'c'],
    }),
    paper({ id: 'more-votes', votes: ['a', 'c'] }),
    paper({ id: 'higher-score', votes: ['b'] }),
  ];
  const ranked = rankPapers({
    papers,
    members,
    today: '2026-09-14',
    sheetUrl: '',
  }).filter((p) => !p.date);
  assert.equal(ranked[0].id, 'more-votes');
  assert.ok(ranked[0].score < ranked[1].score);
});

test('score sort prioritizes weighted votes, breaks ties by age, and leaves input order unchanged', () => {
  const state = {
    papers: [
      paper({
        id: 'history',
        date: '2026-09-01',
        attendance: ['b'],
        votes: ['a', 'c'],
      }),
      paper({ id: 'popular', votes: ['a', 'c'] }),
      paper({ id: 'newer', votes: ['b'], addedAt: '2026-09-02' }),
      paper({ id: 'older', votes: ['b'], addedAt: '2026-08-01' }),
    ],
    members,
    today: '2026-09-14',
    sheetUrl: '',
  };
  const original = state.papers.map((p) => p.id);
  assert.deepEqual(
    rankPapers(state, 'score')
      .filter((p) => !p.date)
      .map((p) => p.id),
    ['older', 'newer', 'popular'],
  );
  assert.deepEqual(
    state.papers.map((p) => p.id),
    original,
  );
});

test('removed users and duplicate vote IDs do not inflate totals', () => {
  const ranked = rankPapers({
    papers: [paper({ votes: ['a', 'a', 'deleted'] })],
    members,
    today: '2026-09-14',
    sheetUrl: '',
  });
  assert.equal(ranked[0].voteCount, 1);
  assert.equal(ranked[0].score, 1);
});

test('newest sorts by suggestion time, normalizes timezones, and puts unknown dates last', () => {
  const state = {
    papers: [
      paper({ id: 'unknown-z', addedAt: '' }),
      paper({
        id: 'old',
        addedAt: '2026-08-01',
        votes: ['a', 'b', 'c'],
        year: '2026',
      }),
      paper({ id: 'recent-b', addedAt: '2026-09-14T12:00:00Z', year: '1966' }),
      paper({ id: 'latest', addedAt: '2026-09-14T09:00:00-04:00' }),
      paper({ id: 'unknown-a', addedAt: 'invalid' }),
      paper({ id: 'recent-a', addedAt: '2026-09-14T12:00:00Z' }),
    ],
    members,
    today: '2026-09-14',
    sheetUrl: '',
  };
  const original = structuredClone(state);
  assert.deepEqual(
    rankPapers(state, 'newest').map((p) => p.id),
    ['latest', 'recent-a', 'recent-b', 'old', 'unknown-a', 'unknown-z'],
  );
  assert.deepEqual(state, original);
});

test('equal votes are ordered by suggestion time, independent of score', () => {
  const ranked = rankPapers({
    papers: [
      paper({ id: 'new', addedAt: '2026-09-02', votes: ['a'] }),
      paper({ id: 'old', addedAt: '2026-09-01', votes: ['b'] }),
    ],
    members,
    today: '2026-09-14',
    sheetUrl: '',
  });
  assert.equal(ranked[0].id, 'old');
});

test('sheet cell encoding preserves attendance while withdrawing a vote', () => {
  assert.deepEqual(parseMark('VA'), { voted: true, attended: true });
  assert.deepEqual(parseMark('FALSE'), { voted: false, attended: false });
  assert.equal(formatMark(false, parseMark('VA').attended), 'A');
  assert.deepEqual(parseMark(true), { voted: true, attended: false });
  assert.throws(() => parseMark('present'), /Use blank/);
});

test('manual entries validate years and reject executable and credential-bearing URLs', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://user:secret@example.com'), '');
  assert.equal(safeUrl('https://example.com\\@evil.test'), '');
  assert.equal(
    safeUrl('https://doi.org/10.1145/123'),
    'https://doi.org/10.1145/123',
  );
  assert.throws(() => validatePaper({ ...input, title: ' ' }), /title/);
  assert.throws(() => validatePaper({ ...input, year: '20ab' }), /year/);
  assert.throws(
    () => validatePaper({ ...input, url: 'data:text/html,hello' }),
    /https/,
  );
  assert.equal(
    validatePaper({ ...input, title: '  Hello world  ' }).title,
    'Hello world',
  );
});

test('duplicate detection normalizes punctuation, case, and Unicode', () => {
  assert.ok(
    duplicatePaper([paper()], { ...input, title: 'A PAPER.', url: '' }),
  );
  assert.ok(
    duplicatePaper([paper()], {
      ...input,
      title: 'A different title',
      url: input.url + '/',
    }),
  );
  assert.equal(
    duplicatePaper([paper()], { ...input, title: 'Unique paper', url: '' }),
    undefined,
  );
  assert.equal(normalizeName('  Ａlex   Chen '), 'Alex Chen');
});

test('invalid calendar dates are rejected', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('09/14/2026'), false);
});

test('DBLP handles single hits, author objects, and alternate publication links', () => {
  const results = parseDblp({
    result: {
      hits: {
        hit: {
          info: {
            title: 'Paper.',
            year: '2026',
            authors: { author: { text: 'Alex Chen' } },
            ee: ['javascript:alert(1)', 'https://example.org/paper'],
            venue: 'POPL',
          },
        },
      },
    },
  });
  assert.deepEqual(results, [
    {
      title: 'Paper',
      year: '2026',
      authors: 'Alex Chen',
      url: 'https://example.org/paper',
      venue: 'POPL',
    },
  ]);
  assert.deepEqual(parseDblp({ result: { hits: { '@total': '0' } } }), []);
  assert.throws(
    () => parseDblp({ error: 'rate-limited' }),
    /unexpected response/,
  );
});

test('Crossref normalizes publisher metadata and preserves paper links', () => {
  const papers = parseCrossref({
    message: {
      items: [
        {
          title: ['A <i>theory</i> of types &amp; programs'],
          author: [{ given: 'Robin', family: 'Milner' }],
          published: { 'date-parts': [[1978, 8]] },
          'container-title': ['JCSS'],
          DOI: '10.1016/0022-0000(78)90014-4',
        },
      ],
    },
  });
  assert.deepEqual(papers, [
    {
      title: 'A theory of types & programs',
      authors: 'Robin Milner',
      year: '1978',
      venue: 'JCSS',
      url: 'https://doi.org/10.1016/0022-0000(78)90014-4',
    },
  ]);
  assert.throws(() => parseCrossref({ status: 'failed' }), /unavailable/);
});

test('catalog queries are escaped and use DBLP before Crossref', () => {
  const sources = catalogs('a & b', true);
  assert.deepEqual(
    sources.map((s) => s.source),
    ['DBLP', 'Crossref'],
  );
  assert.ok(sources[0].url.includes('q=a%20%26%20b'));
  assert.ok(sources[1].url.startsWith('/crossref-api?query.bibliographic='));
});
