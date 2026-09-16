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

test('scheduling names cannot create member identities, including normalized variants', async () => {
  for (const name of ['Time', 'location', ' TIME ', 'Ｌｏｃａｔｉｏｎ'])
    await assert.rejects(
      parseCommand(post({ action: 'signIn', args: [name] })),
      /scheduling fields/,
    );
});
