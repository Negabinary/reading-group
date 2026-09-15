import { afterEach, expect, test, vi } from 'vitest';

const endpoint = new URL('/api', window.location.origin).toString();
const state = { members: [], papers: [], today: '2026-09-14', sheetUrl: '' };

async function liveApi() {
  vi.stubEnv('VITE_DEMO', 'false');
  vi.resetModules();
  return import('../src/api');
}

function json(data: unknown) {
  return { ok: true, json: async () => data };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('a failed API shows an error instead of switching a live site to demo data', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
  );
  const { api, isDemo } = await liveApi();
  expect(isDemo).toBe(false);
  await expect(api.getState()).rejects.toThrow(
    'Could not reach the reading group',
  );
  expect(localStorage.getItem('mplse.demo.v1')).toBeNull();
});

test('reads use the same origin without caching and encode search queries', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(json({ apiVersion: 1, ok: true, data: state }));
  vi.stubGlobal('fetch', fetcher);
  const { api } = await liveApi();
  expect(await api.getState()).toEqual(state);
  await api.getState();
  const [first, options] = fetcher.mock.calls[0];
  const [second] = fetcher.mock.calls[1];
  expect(new URL(first).origin + new URL(first).pathname).toBe(endpoint);
  expect(new URL(first).searchParams.get('action')).toBe('getState');
  expect(first).toBe(second);
  expect(options).toMatchObject({
    method: 'GET',
    mode: 'same-origin',
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
  expect(options.headers).toBeUndefined();
  expect(options.body).toBeUndefined();
  fetcher.mockResolvedValue(json({ apiVersion: 1, ok: true, data: [] }));
  await api.searchPapers('types & effects + λ');
  expect(new URL(fetcher.mock.calls[2][0]).searchParams.get('query')).toBe(
    'types & effects + λ',
  );
});

test('writes use same-origin JSON POST and surface API errors', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(json({ apiVersion: 1, ok: true, data: state }));
  vi.stubGlobal('fetch', fetcher);
  const { api } = await liveApi();
  expect(await api.setVote('paper-1', 'member-1', false)).toEqual(state);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe(endpoint);
  expect(options).toMatchObject({
    method: 'POST',
    mode: 'same-origin',
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(JSON.parse(options.body)).toEqual({
    action: 'setVote',
    args: ['paper-1', 'member-1', false],
  });
  fetcher.mockResolvedValue(
    json({
      apiVersion: 1,
      ok: false,
      error: 'Voting is closed for scheduled papers.',
    }),
  );
  await expect(api.setVote('paper-1', 'member-1', true)).rejects.toThrow(
    'Voting is closed',
  );
});

test('name and suggestion requests use the same API and never retry uncertain writes', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    json({
      apiVersion: 1,
      ok: true,
      data: { member: { id: 'a', name: 'Alex' }, state },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { api } = await liveApi();
  expect((await api.signIn('Alex')).member.name).toBe('Alex');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    action: 'signIn',
    args: ['Alex'],
  });
  const paper = {
    title: 'Types',
    authors: '',
    year: '',
    venue: '',
    url: '',
    topic: '',
    notes: '',
  };
  fetcher.mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
  await expect(api.suggestPaper(paper, 'a')).rejects.toThrow(
    'Refresh to check whether it was saved',
  );
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    action: 'suggestPaper',
    args: [paper, 'a'],
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('HTML, HTTP failures, and incompatible API responses are reported clearly', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { api } = await liveApi();
  fetcher.mockResolvedValue({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected <');
    },
  });
  await expect(api.getState()).rejects.toThrow('Cloudflare deployment');
  fetcher.mockResolvedValue({ ok: false, status: 503 });
  await expect(api.getState()).rejects.toThrow('Could not reach');
  for (const payload of [
    null,
    state,
    { apiVersion: 2, ok: true, data: state },
  ]) {
    fetcher.mockResolvedValue(json(payload));
    await expect(api.getState()).rejects.toThrow(
      'Deploy the latest Cloudflare Worker',
    );
  }
  fetcher.mockResolvedValue(json({ apiVersion: 1, ok: true }));
  await expect(api.getState()).rejects.toThrow('invalid response');
  expect(localStorage.getItem('mplse.demo.v1')).toBeNull();
});

test('old Apps Script environment variables cannot redirect the live client', async () => {
  vi.stubEnv(
    'VITE_APPS_SCRIPT_URL',
    'https://script.google.com/macros/s/old/exec',
  );
  const fetcher = vi
    .fn()
    .mockResolvedValue(json({ apiVersion: 1, ok: true, data: state }));
  vi.stubGlobal('fetch', fetcher);
  const { api, isDemo } = await liveApi();
  expect(isDemo).toBe(false);
  await api.getState();
  expect(new URL(fetcher.mock.calls[0][0]).origin).toBe(window.location.origin);
  expect(localStorage.getItem('mplse.demo.v1')).toBeNull();
});

test('HTTP error envelopes retain actionable sheet/quota messages', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        apiVersion: 1,
        ok: false,
        error: 'Please wait a minute before refreshing.',
      }),
    }),
  );
  const { api } = await liveApi();
  await expect(api.getState()).rejects.toThrow('Please wait a minute');
});
