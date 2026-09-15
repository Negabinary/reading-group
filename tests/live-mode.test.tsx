import { afterEach, expect, test, vi } from 'vitest';
import { validateApiUrl } from '../src/api-config';

const endpoint = 'https://script.google.com/macros/s/test-deployment/exec';
const state = { members: [], papers: [], today: '2026-09-14', sheetUrl: '' };

async function liveApi(url = endpoint) {
  vi.stubEnv('VITE_APPS_SCRIPT_URL', url);
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

test('reads follow redirects without cookies or preflight headers and encode search queries', async () => {
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
  expect(first).not.toBe(second);
  expect(options).toMatchObject({
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    redirect: 'follow',
  });
  expect(options.headers).toBeUndefined();
  expect(options.body).toBeUndefined();
  fetcher.mockResolvedValue(json({ apiVersion: 1, ok: true, data: [] }));
  await api.searchPapers('types & effects + λ');
  expect(new URL(fetcher.mock.calls[2][0]).searchParams.get('query')).toBe(
    'types & effects + λ',
  );
});

test('writes use POST with JSON in a simple text/plain request and surface API errors', async () => {
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
    mode: 'cors',
    credentials: 'omit',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
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

test('Google login HTML, HTTP failures, and incompatible API responses are reported clearly', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { api } = await liveApi();
  fetcher.mockResolvedValue({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected <');
    },
  });
  await expect(api.getState()).rejects.toThrow('anonymous access settings');
  fetcher.mockResolvedValue({ ok: false, status: 503 });
  await expect(api.getState()).rejects.toThrow('Could not reach');
  for (const payload of [
    null,
    state,
    { apiVersion: 2, ok: true, data: state },
  ]) {
    fetcher.mockResolvedValue(json(payload));
    await expect(api.getState()).rejects.toThrow('Deploy the latest Code.gs');
  }
  fetcher.mockResolvedValue(json({ apiVersion: 1, ok: true }));
  await expect(api.getState()).rejects.toThrow('invalid response');
  expect(localStorage.getItem('mplse.demo.v1')).toBeNull();
});

test('invalid live configuration remains live and is rejected before sending data', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const url of [
    'https://example.com/exec',
    endpoint.replace('/macros/s/', '/macros/u/1/s/'),
    endpoint.replace('/exec', '/dev'),
    `${endpoint}?x=1`,
    `${endpoint}#fragment`,
  ]) {
    expect(() => validateApiUrl(url)).toThrow('Set VITE_APPS_SCRIPT_URL');
  }
  expect(validateApiUrl(` ${endpoint} `)).toBe(endpoint);
  const { api, isDemo } = await liveApi('https://example.com/exec');
  expect(isDemo).toBe(false);
  await expect(api.signIn('Alex')).rejects.toThrow('Set VITE_APPS_SCRIPT_URL');
  expect(fetcher).not.toHaveBeenCalled();
  expect(localStorage.getItem('mplse.demo.v1')).toBeNull();
});
