import { StrictMode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { api, IDENTITY_KEY } from '../src/api';
import { LAST_VISIT_KEY } from '../src/useVisit';
import type { GroupState, Paper } from '../src/types';

const visitTime = Date.parse('2026-09-14T12:00:00Z');
const paper = (
  id: string,
  addedAt: string,
  overrides: Partial<Paper> = {},
): Paper => ({
  id,
  title: id,
  addedAt,
  authors: '',
  year: '2026',
  venue: '',
  url: `https://example.org/${id}`,
  topic: '',
  notes: '',
  suggestedBy: 'reader',
  date: '',
  votes: [],
  attendance: [],
  ...overrides,
});
const state = (papers: Paper[]): GroupState => ({
  papers,
  members: [{ id: 'reader', name: 'Reader' }],
  today: '2026-09-14',
  sheetUrl: 'https://docs.google.com/spreadsheets/d/example',
});
const order = () =>
  screen.getAllByRole('article').map((node) => node.getAttribute('aria-label'));

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(visitTime);
});

test('automatic refresh waits for a slow API response instead of repeatedly discarding it', async () => {
  vi.useFakeTimers();
  let resolve!: (data: GroupState) => void;
  const pending = new Promise<GroupState>((done) => {
    resolve = done;
  });
  const getState = vi.spyOn(api, 'getState').mockReturnValue(pending);
  const app = render(<App />);
  try {
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(getState).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(state([paper('Loaded paper', '2026-08-01')]));
    });
    expect(screen.getByRole('article', { name: 'Loaded paper' })).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(getState).toHaveBeenCalledTimes(2);
  } finally {
    app.unmount();
    vi.useRealTimers();
  }
});

test('first visits establish a baseline and returning visitors see only additions since that visit', async () => {
  const data = state([paper('Backlog', '2026-08-01T00:00:00Z')]);
  vi.spyOn(api, 'getState').mockResolvedValue(data);
  const first = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole('article', { name: 'Backlog' });
  expect(
    screen.getByRole('button', { name: 'New since last visit (0)' }),
  ).toBeTruthy();
  expect(screen.queryByTitle('Added since your last visit')).toBeNull();
  expect(localStorage.getItem(LAST_VISIT_KEY)).toBe('2026-09-14T12:00:00.000Z');
  first.unmount();

  data.papers.push(paper('Added while away', '2026-09-15T00:00:00Z'));
  vi.mocked(Date.now).mockReturnValue(Date.parse('2026-09-16T12:00:00Z'));
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  const newTab = await screen.findByRole('button', {
    name: 'New since last visit (1)',
  });
  const user = userEvent.setup();
  await user.click(newTab);
  expect(order()).toEqual(['Added while away']);
  expect(screen.getByRole('combobox', { name: 'Sort papers' })).toHaveProperty(
    'value',
    'newest',
  );
});

test('the New view preserves badges through votes, search, and refresh, then advances on the next visit', async () => {
  localStorage.setItem(LAST_VISIT_KEY, '2026-09-01T00:00:00Z');
  localStorage.setItem(IDENTITY_KEY, 'reader');
  let data = state([
    paper('Old popular', '2026-08-01T00:00:00Z', { votes: ['reader'] }),
    paper('Earlier addition', '2026-09-02T00:00:00Z'),
    paper('Latest addition', '2026-09-13T00:00:00Z'),
    paper('At cutoff', '2026-09-01T00:00:00Z'),
    paper('No timestamp', ''),
    paper('Invalid timestamp', 'invalid'),
    paper('Scheduled', '2026-09-13T00:00:00Z', { date: '2026-09-21' }),
  ]);
  vi.spyOn(api, 'getState').mockImplementation(async () => data);
  vi.spyOn(api, 'setVote').mockImplementation(async (id, memberId, voted) => {
    data = {
      ...data,
      papers: data.papers.map((p) =>
        p.id === id ? { ...p, votes: voted ? [memberId] : [] } : p,
      ),
    };
    return data;
  });
  const user = userEvent.setup();
  const first = render(<App />);
  await user.click(
    await screen.findByRole('button', { name: 'New since last visit (2)' }),
  );
  expect(order()).toEqual(['Latest addition', 'Earlier addition']);
  await user.click(
    screen.getByRole('button', { name: 'Vote for Latest addition' }),
  );
  await screen.findByRole('button', {
    name: 'Withdraw vote from Latest addition',
  });
  expect(screen.getAllByTitle('Added since your last visit')).toHaveLength(2);
  await user.type(
    screen.getByRole('textbox', { name: 'Search the paper pool' }),
    'Earlier',
  );
  expect(order()).toEqual(['Earlier addition']);
  // The count reflects all new papers, independently of search.
  expect(
    screen.getByRole('button', { name: 'New since last visit (2)' }),
  ).toBeTruthy();
  await user.clear(
    screen.getByRole('textbox', { name: 'Search the paper pool' }),
  );
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(order()).toEqual(['Latest addition', 'Earlier addition']);
  await user.click(screen.getByRole('button', { name: /^My votes/ }));
  expect(order()).toEqual(['Latest addition', 'Old popular']);
  first.unmount();
  render(<App />);
  await screen.findByRole('article', { name: 'Latest addition' });
  await user.click(
    screen.getByRole('button', { name: 'New since last visit (0)' }),
  );
  expect(screen.getByText('No new papers since your last visit.')).toBeTruthy();
});

test('a failed load preserves the previous visit and a successful retry retains its New cutoff', async () => {
  const previous = '2026-09-01T00:00:00Z';
  localStorage.setItem(LAST_VISIT_KEY, previous);
  vi.spyOn(api, 'getState')
    .mockRejectedValueOnce(new Error('Temporarily unavailable'))
    .mockResolvedValue(state([paper('New paper', '2026-09-10T00:00:00Z')]));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('alert');
  expect(localStorage.getItem(LAST_VISIT_KEY)).toBe(previous);
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: 'New since last visit (1)' });
  expect(localStorage.getItem(LAST_VISIT_KEY)).toBe('2026-09-14T12:00:00.000Z');
});

test('background loads do not advance the visit and unavailable storage does not prevent browsing', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  vi.spyOn(api, 'getState').mockResolvedValue(
    state([paper('Paper', '2026-08-01')]),
  );
  const first = render(<App />);
  await screen.findByRole('article', { name: 'Paper' });
  expect(localStorage.getItem(LAST_VISIT_KEY)).toBeNull();
  first.unmount();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  render(<App />);
  await screen.findByRole('article', { name: 'Paper' });
  expect(
    screen.getByRole('button', { name: 'New since last visit (0)' }),
  ).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('paper links open directly from pool, archive, next, and later readings; header navigation is simplified', async () => {
  vi.spyOn(api, 'getState').mockResolvedValue(
    state([
      paper('Pool paper', '2026-08-01'),
      paper('Without URL', '2026-08-01', { url: '' }),
      paper('Next paper', '2026-08-01', { date: '2026-09-14' }),
      paper('Later paper', '2026-08-01', { date: '2026-09-21' }),
      paper('Past paper', '2026-08-01', { date: '2026-09-01' }),
    ]),
  );
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('article', { name: 'Pool paper' });
  for (const title of ['Pool paper', 'Next paper', 'Later paper']) {
    const link = screen.getByRole('link', { name: `Read paper: ${title}` });
    expect(link.getAttribute('href')).toBe(`https://example.org/${title}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  }
  expect(
    within(screen.getByRole('article', { name: 'Without URL' })).queryByRole(
      'link',
    ),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Pool paper' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Close dialog' }));
  await user.click(screen.getByRole('button', { name: /^Archive/ }));
  expect(
    within(screen.getByRole('article', { name: 'Past paper' })).getByRole(
      'link',
      { name: 'Read paper: Past paper' },
    ),
  ).toBeTruthy();
  const header = within(screen.getByRole('banner'));
  expect(header.queryByRole('link', { name: 'Next' })).toBeNull();
  expect(header.queryByRole('button', { name: 'Papers' })).toBeNull();
  expect(header.getByRole('link', { name: /Sheet/ })).toBeTruthy();
  expect(header.getByRole('button', { name: 'Sign in' })).toBeTruthy();
});
