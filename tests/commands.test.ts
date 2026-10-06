import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommand } from '../worker/commands';

const post = (body: unknown, headers = {}) =>
  new Request('https://reading.example/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
test('API permits only explicit actions and validates payloads before sheet access', async () => {
  assert.deepEqual(
    await parseCommand(new Request('https://reading.example/api')),
    { action: 'health' },
  );
  assert.deepEqual(
    await parseCommand(post({ action: 'signIn', args: ['  Alex   Smith  '] })),
    { action: 'signIn', name: 'Alex Smith' },
  );
  for (const action of [
    'setup',
    'clear',
    'deleteSheet',
    'constructor',
    'getState',
  ])
    await assert.rejects(parseCommand(post({ action, args: [] })));
  for (const args of [
    ['paper', 'member', 'true'],
    ['paper', 'member'],
    ['', 'member', true],
  ])
    await assert.rejects(parseCommand(post({ action: 'setVote', args })));
  await assert.rejects(
    parseCommand(new Request('https://reading.example/api?action=setVote')),
  );
  await assert.rejects(
    parseCommand(
      new Request('https://reading.example/api?action=searchPapers&query=a'),
    ),
  );
});
test('browser cross-origin and form posts are refused; request limits use UTF-8 bytes', async () => {
  const body = { action: 'signIn', args: ['Alex'] };
  await assert.rejects(
    parseCommand(post(body, { Origin: 'https://unrelated.example' })),
    /reading group website/,
  );
  await assert.rejects(
    parseCommand(post(body, { 'Content-Type': 'text/plain' })),
    /Content-Type/,
  );
  await assert.rejects(
    parseCommand(post({ action: 'signIn', args: ['λ'.repeat(11000)] })),
    /too large/,
  );
  assert.equal(
    (await parseCommand(post(body, { Origin: 'https://reading.example' })))
      .action,
    'signIn',
  );
});

test('privacy-hidden origins are accepted only when the browser confirms same-origin', async () => {
  const body = { action: 'signIn', args: ['New reader'] };
  assert.deepEqual(
    await parseCommand(
      post(body, { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' }),
    ),
    { action: 'signIn', name: 'New reader' },
  );
  // A sandboxed or unrelated page can also send Origin: null. It must not
  // receive the privacy fallback without the browser's same-origin signal.
  for (const headers of [
    { Origin: 'null' },
    { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'null', 'Sec-Fetch-Site': 'same-site' },
    { Origin: 'null', 'Sec-Fetch-Site': 'none' },
    { Origin: 'https://unrelated.example', 'Sec-Fetch-Site': 'same-origin' },
  ]) {
    await assert.rejects(parseCommand(post(body, headers)), { status: 403 });
  }
  await assert.rejects(
    parseCommand(
      post(body, {
        Origin: 'null',
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'text/plain',
      }),
    ),
    { status: 415 },
  );
});

test('cross-origin fetch metadata is refused even if Origin is missing or matches', async () => {
  const body = { action: 'signIn', args: ['New reader'] };
  for (const site of ['cross-site', 'same-site', 'none']) {
    await assert.rejects(parseCommand(post(body, { 'Sec-Fetch-Site': site })), {
      status: 403,
    });
    await assert.rejects(
      parseCommand(
        post(body, {
          Origin: 'https://reading.example',
          'Sec-Fetch-Site': site,
        }),
      ),
      { status: 403 },
    );
  }
});

test('scheduling names cannot create member identities, including normalized variants', async () => {
  for (const name of ['Time', 'location', ' TIME ', 'Ｌｏｃａｔｉｏｎ'])
    await assert.rejects(
      parseCommand(post({ action: 'signIn', args: [name] })),
      /scheduling fields/,
    );
});
