import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { build } from 'esbuild';
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as RuntimeResponse,
  type Request as RuntimeRequest,
} from 'miniflare';
import { cell, SheetFixture } from '../sheet-fixture';

test(
  'real Workers runtime serves assets, serializes concurrent sheet edits, and recovers after errors',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mplse-worker-'));
    const google = new SheetFixture();
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const credentials = JSON.stringify({
      client_email: 'reading-group@test-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    });
    const bundle = await build({
      entryPoints: ['worker/index.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><title>Reading group</title>',
    );
    let activeGoogleReads = 0,
      maxActiveGoogleReads = 0,
      tokenRequests = 0;
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        name: 'reading-group-test',
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: '2026-09-15',
        cf: false,
        durableObjects: {
          SHEET: { className: 'SheetCoordinator', useSQLite: true },
        },
        bindings: {
          GOOGLE_SHEET_ID: 'sheet-id',
          GOOGLE_SERVICE_ACCOUNT_JSON: credentials,
        },
        assets: {
          directory,
          binding: 'ASSETS',
          routerConfig: { has_user_worker: true },
          run_worker_first: ['/api', '/api/*', '/calendar.ics'],
        },
        outboundService: async (request: RuntimeRequest) => {
          const url = new URL(request.url);
          if (url.hostname === 'oauth2.googleapis.com') {
            tokenRequests++;
            return RuntimeResponse.json({
              access_token: 'fake-token',
              expires_in: 3600,
            });
          }
          assert.equal(url.hostname, 'sheets.googleapis.com');
          assert.equal(
            request.headers.get('Authorization'),
            'Bearer fake-token',
          );
          if (request.method === 'GET') {
            activeGoogleReads++;
            maxActiveGoogleReads = Math.max(
              maxActiveGoogleReads,
              activeGoogleReads,
            );
            const result = await google.request(
              url.search,
              AbortSignal.timeout(5000),
            );
            // Hold a snapshot long enough that unprotected concurrent requests collide.
            await setTimeout(40);
            activeGoogleReads--;
            return RuntimeResponse.json(result);
          }
          const result = await google.request(
            ':batchUpdate',
            AbortSignal.timeout(5000),
            await request.json(),
          );
          return RuntimeResponse.json(result);
        },
      }),
    );
    const post = (action: string, args: unknown[], headers = {}) =>
      mf.dispatchFetch('https://reading.example/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://reading.example',
          ...headers,
        },
        body: JSON.stringify({ action, args }),
      });
    try {
      const asset = await mf.dispatchFetch('https://reading.example/');
      assert.equal(asset.status, 200);
      assert.match(await asset.text(), /Reading group/);
      const health = await mf.dispatchFetch(
        'https://reading.example/api?action=health',
      );
      assert.equal(health.status, 200, await health.clone().text());
      assert.equal(health.headers.get('Cache-Control'), 'no-store');
      assert.equal(
        ((await health.json()) as any).data.backend,
        'google-sheets',
      );
      assert.equal(google.reads, 0);
      assert.equal(
        (await mf.dispatchFetch('https://reading.example/api/unknown')).status,
        404,
      );
      assert.equal(
        (
          await post('signIn', ['Bad origin'], {
            Origin: 'https://elsewhere.example',
          })
        ).status,
        403,
      );
      assert.equal((await post('setup', [])).status, 400);
      assert.equal(google.reads, 0);

      const joins = await Promise.all(
        ['New one', 'New two', 'NEW ONE'].map(async (name) => {
          const response = await post('signIn', [name]);
          assert.equal(response.status, 200, await response.clone().text());
          return ((await response.json()) as any).data;
        }),
      );
      assert.equal(joins[0].member.id, joins[2].member.id);
      assert.notEqual(joins[0].member.id, joins[1].member.id);
      assert.equal(maxActiveGoogleReads, 1);
      assert.equal(tokenRequests, 1);

      const paper = {
        title: 'Concurrent paper',
        authors: '',
        year: '',
        venue: '',
        url: '',
        topic: '',
        notes: '',
      };
      const suggestions = await Promise.all([
        post('suggestPaper', [paper, 'alex-id']),
        post('suggestPaper', [paper, 'sam-id']),
      ]);
      assert.deepEqual(suggestions.map((r) => r.status).sort(), [200, 409]);
      const votes = await Promise.all([
        post('setVote', ['paper-1', 'alex-id', false]),
        post('setVote', ['paper-1', 'sam-id', false]),
      ]);
      assert.ok(votes.every((r) => r.status === 200));
      assert.equal(
        (await post('setVote', ['missing-paper', 'alex-id', true])).status,
        409,
      );
      const stateResponse = await mf.dispatchFetch(
        'https://reading.example/api?action=getState',
      );
      const state = ((await stateResponse.json()) as any).data;
      assert.equal(state.members.length, 4);
      assert.equal(state.papers.length, 2);
      assert.deepEqual(state.papers[0].attendance, ['alex-id']);
      assert.deepEqual(state.papers[0].votes, []);
      assert.ok(!JSON.stringify(state).includes('private_key'));

      const calendarUrl = 'https://reading.example/calendar.ics';
      const readsBefore = google.reads;
      const rejected = await mf.dispatchFetch(calendarUrl, { method: 'POST' });
      assert.equal(rejected.status, 405);
      assert.equal(rejected.headers.get('Allow'), 'GET, HEAD');
      assert.equal(google.reads, readsBefore);
      const rows = google.document.sheets[0].data![0].rowData!;
      const timeColumn = rows[0].values!.findIndex(
        (c) => c.effectiveValue?.stringValue === 'Time',
      );
      const locationColumn = rows[0].values!.findIndex(
        (c) => c.effectiveValue?.stringValue === 'Location',
      );
      rows[1].values![10] = cell('2026-09-21');
      rows[1].values![timeColumn] = cell('2:30 PM');
      rows[1].values![locationColumn] = cell('Beyster 3725');
      const calendar = await mf.dispatchFetch(calendarUrl);
      assert.equal(calendar.status, 200, await calendar.clone().text());
      assert.equal(
        calendar.headers.get('Content-Type'),
        'text/calendar; charset=utf-8',
      );
      assert.equal(calendar.headers.get('Cache-Control'), 'no-cache');
      const ics = (await calendar.text()).replace(/\r\n /g, '');
      assert.match(ics, /DTSTART:20260921T183000Z\r\nDTEND:20260921T193000Z/);
      assert.match(ics, /LOCATION:Beyster 3725/);
      assert.ok(ics.includes('https://umich.zoom.us/j/93467587435'));
      assert.ok(ics.includes('https://reading.example/#next-session'));
      assert.ok(!ics.includes('Concurrent paper')); // Still in the pool.
      assert.ok(!ics.includes('alex-id'));
      const head = await mf.dispatchFetch(calendarUrl, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
      rows[1].values![timeColumn] = cell('bad time');
      const invalid = await mf.dispatchFetch(calendarUrl);
      assert.equal(invalid.status, 409);
      assert.match(await invalid.text(), /Time in row 2/);
      assert.ok(
        !invalid.headers.get('Content-Type')?.includes('text/calendar'),
      );
      rows[1].values![timeColumn] = cell('');
      rows[1].values![10] = cell('');
      const cleared = await mf.dispatchFetch(calendarUrl);
      assert.equal(cleared.status, 200);
      assert.ok(!(await cleared.text()).includes('BEGIN:VEVENT'));
    } finally {
      await mf.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
