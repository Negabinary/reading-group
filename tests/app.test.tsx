import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { api, IDENTITY_KEY } from '../src/api';
import { createDemo } from '../src/demo';
import type { GroupState } from '../src/types';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test('a visitor can sign in, vote, withdraw, and retain their name after remounting', async () => {
  const user = userEvent.setup();
  const first = render(<App />);
  await screen.findByRole('button', {
    name: 'Vote for The Next 700 Programming Languages',
  });
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Your name' }),
    'Test Reader',
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in' }),
  );
  await screen.findByRole('button', { name: /Test Reader/ });
  await user.click(
    screen.getByRole('button', {
      name: 'Vote for The Next 700 Programming Languages',
    }),
  );
  const voted = await screen.findByRole('button', {
    name: 'Withdraw vote from The Next 700 Programming Languages',
  });
  expect(voted.getAttribute('aria-pressed')).toBe('true');
  expect(within(voted).getByText('8')).toBeTruthy();
  await user.click(voted);
  const withdrawn = await screen.findByRole('button', {
    name: 'Vote for The Next 700 Programming Languages',
  });
  expect(within(withdrawn).getByText('7')).toBeTruthy();
  first.unmount();
  render(<App />);
  await screen.findByRole('button', { name: /Test Reader/ });
});

test('a pending vote resumes after sign-in without an extra click', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole('button', {
      name: 'Vote for A Theory of Type Polymorphism in Programming',
    }),
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Your name' }),
    'New Reader',
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in' }),
  );
  await screen.findByRole('button', {
    name: 'Withdraw vote from A Theory of Type Polymorphism in Programming',
  });
});

test('manual suggestions persist, include the first vote, and prevent duplicates', async () => {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() =>
    expect(
      screen
        .getAllByRole('button', { name: 'Suggest a paper' })[0]
        .hasAttribute('disabled'),
    ).toBe(false),
  );
  await user.click(
    screen.getAllByRole('button', { name: 'Suggest a paper' })[0],
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Your name' }),
    'Paper Suggester',
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in' }),
  );
  await user.click(await screen.findByRole('button', { name: 'Add manually' }));
  await user.type(
    screen.getByRole('textbox', { name: /Paper title/ }),
    'A Brand New Paper',
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Authors' }),
    'A. Reader',
  );
  await user.click(screen.getByRole('button', { name: 'Add to the pool' }));
  const vote = await screen.findByRole('button', {
    name: 'Withdraw vote from A Brand New Paper',
  });
  expect(within(vote).getByText('1')).toBeTruthy();
  await user.click(
    screen.getAllByRole('button', { name: 'Suggest a paper' })[0],
  );
  await user.click(screen.getByRole('button', { name: 'Add manually' }));
  await user.type(
    screen.getByRole('textbox', { name: /Paper title/ }),
    'A Brand New Paper',
  );
  await user.click(screen.getByRole('button', { name: 'Add to the pool' }));
  expect((await screen.findByRole('alert')).textContent).toContain('already');
});

test('DBLP results can be selected and submitted; failures offer manual entry', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole('button', {
      name: 'Vote for The Next 700 Programming Languages',
    }),
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Your name' }),
    'Searcher',
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in' }),
  );
  await screen.findByRole('button', {
    name: 'Withdraw vote from The Next 700 Programming Languages',
  });
  await user.click(
    screen.getAllByRole('button', { name: 'Suggest a paper' })[0],
  );
  const search = vi.spyOn(api, 'searchPapers').mockResolvedValue([
    {
      title: 'Search Result Paper',
      authors: 'Test Author',
      year: '2025',
      venue: 'POPL',
      url: 'https://example.org/paper',
    },
  ]);
  await user.type(
    screen.getByRole('textbox', { name: 'Search paper title or author' }),
    'Search Result',
  );
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await user.click(
    await screen.findByRole('button', { name: /Search Result Paper/ }),
  );
  expect(
    (screen.getByRole('textbox', { name: /Paper title/ }) as HTMLInputElement)
      .value,
  ).toBe('Search Result Paper');
  await user.click(screen.getByRole('button', { name: 'Add to the pool' }));
  await screen.findByRole('button', {
    name: 'Withdraw vote from Search Result Paper',
  });
  search.mockRejectedValue(
    new Error('DBLP is unavailable. Add a paper manually.'),
  );
  await user.click(
    screen.getAllByRole('button', { name: 'Suggest a paper' })[0],
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Search paper title or author' }),
    'unavailable',
  );
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'DBLP is unavailable',
  );
  await user.click(screen.getByRole('button', { name: 'Add manually' }));
  expect(screen.getByRole('textbox', { name: /Paper title/ })).toBeTruthy();
});

test('paper search and the archive remain usable without categories', async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('button', {
    name: 'Vote for The Next 700 Programming Languages',
  });
  const search = screen.getByRole('textbox', { name: 'Search the paper pool' });
  await user.type(search, 'Milner');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  await user.type(search, 'no match');
  expect(screen.getByText('No matches.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getAllByRole('article')).toHaveLength(5);
  await user.click(screen.getByRole('button', { name: /^Archive/ }));
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /^Vote for/ })).toBeNull();
  expect(
    screen.queryByRole('combobox', { name: 'Filter by topic' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: /How it works/i })).toBeNull();
});

test('a failed vote leaves the displayed count unchanged and can be retried', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole('button', {
      name: 'Vote for The Next 700 Programming Languages',
    }),
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Your name' }),
    'Failure Tester',
  );
  vi.spyOn(api, 'setVote').mockRejectedValueOnce(
    new Error('Connection interrupted.'),
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in' }),
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Connection interrupted',
  );
  expect(
    within(
      screen.getByRole('button', {
        name: 'Vote for The Next 700 Programming Languages',
      }),
    ).getByText('7'),
  ).toBeTruthy();
  await user.click(
    screen.getByRole('button', {
      name: 'Vote for The Next 700 Programming Languages',
    }),
  );
  expect(
    within(
      await screen.findByRole('button', {
        name: 'Withdraw vote from The Next 700 Programming Languages',
      }),
    ).getByText('8'),
  ).toBeTruthy();
});

test('browser search falls back from DBLP to clearly attributed Crossref results', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('HTML bot challenge');
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [{ title: ['Crossref paper'], DOI: '10.1234/test' }],
        },
      }),
    });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const papers = await api.searchPapers('types');
    expect(papers[0].source).toBe('Crossref');
    expect(papers[0].title).toBe('Crossref paper');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('score sorting changes paper order and also applies to My votes', async () => {
  const data = createDemo();
  data.members = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ];
  const base = data.papers[0];
  data.papers = [
    {
      ...base,
      id: 'history',
      title: 'Past reading',
      date: '2020-01-01',
      votes: ['a', 'c'],
      attendance: ['b'],
    },
    {
      ...base,
      id: 'popular',
      title: 'More votes',
      date: '',
      votes: ['a', 'c'],
      attendance: [],
    },
    {
      ...base,
      id: 'weighted',
      title: 'Higher score',
      date: '',
      votes: ['b'],
      attendance: [],
    },
  ];
  vi.spyOn(api, 'getState').mockResolvedValue(data);
  localStorage.setItem(IDENTITY_KEY, 'b');
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('article', { name: 'More votes' });
  const order = () =>
    screen
      .getAllByRole('article')
      .map((node) => node.getAttribute('aria-label'));
  expect(order()).toEqual(['More votes', 'Higher score']);
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Sort papers' }),
    'score',
  );
  expect(order()).toEqual(['Higher score', 'More votes']);
  await user.click(screen.getByRole('button', { name: /^My votes/ }));
  expect(order()).toEqual(['Higher score']);
  await user.click(screen.getByRole('button', { name: /^Pool/ }));
  expect(order()).toEqual(['Higher score', 'More votes']);
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Sort papers' }),
    'votes',
  );
  expect(order()).toEqual(['More votes', 'Higher score']);
});

test('the next session appears first, includes every paper that day, and keeps later dates separate', async () => {
  const data = createDemo();
  data.today = '2026-09-14';
  const base = data.papers[0];
  data.papers = [
    { ...base, id: 'later', title: 'Later paper', date: '2026-09-21' },
    {
      ...base,
      id: 'today-1',
      title: 'First paper today',
      date: '2026-09-14',
      votes: ['demo-0'],
    },
    { ...base, id: 'yesterday', title: 'Previous paper', date: '2026-09-13' },
    {
      ...base,
      id: 'today-2',
      title: 'Second paper today',
      date: '2026-09-14',
      votes: [],
    },
  ];
  vi.spyOn(api, 'getState').mockResolvedValue(data);
  render(<App />);
  const next = await screen.findByRole('region', { name: 'Next session' });
  await within(next).findByRole('heading', {
    name: 'First paper today',
    level: 1,
  });
  expect(
    within(next).getByRole('heading', { name: 'Second paper today' }),
  ).toBeTruthy();
  expect(
    within(next).getByRole('button', { name: /Later paper/ }),
  ).toBeTruthy();
  expect(within(next).queryByText('Previous paper')).toBeNull();
  expect(within(next).queryByRole('button', { name: /^Vote/ })).toBeNull();
  expect(
    next.compareDocumentPosition(
      screen.getByRole('region', { name: /^Papers/ }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test('an unscheduled group has a direct empty state and can pause paper motion', async () => {
  const data: GroupState = {
    papers: [],
    members: [],
    today: '2026-09-14',
    sheetUrl: '',
  };
  vi.spyOn(api, 'getState').mockResolvedValue(data);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: 'No session scheduled.' });
  expect(screen.getByText('No papers yet.')).toBeTruthy();
  const next = screen.getByRole('region', { name: 'Next session' });
  await user.click(screen.getByRole('button', { name: 'Pause paper motion' }));
  expect(next.getAttribute('data-motion')).toBe('off');
  await user.click(screen.getByRole('button', { name: 'Resume paper motion' }));
  expect(next.getAttribute('data-motion')).toBe('on');
});

test('reduced-motion preference disables animation and parallax', async () => {
  const media = {
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  try {
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'The Bitter Lesson', level: 1 });
    expect(
      screen
        .getByRole('region', { name: 'Next session' })
        .getAttribute('data-motion'),
    ).toBe('off');
    expect(
      screen.queryByRole('button', { name: 'Pause paper motion' }),
    ).toBeNull();
    unmount();
    expect(media.removeEventListener).toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
