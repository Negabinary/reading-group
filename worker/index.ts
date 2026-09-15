import { catalogs, SEARCH_ERROR } from '../src/catalogs';
import { parseCommand } from './commands';
import { ApiError, failure, success } from './errors';
import { GoogleSheets, type GoogleEnv } from './google';
import { ReadingSheet } from './sheets';

export interface Env extends GoogleEnv {
  ASSETS: Fetcher;
  SHEET: DurableObjectNamespace;
}

/** One object per spreadsheet replaces Apps Script's global script lock.
 * No papers, votes, or members are stored in Cloudflare storage. */
export class SheetCoordinator implements DurableObject {
  private sheet: ReadingSheet;
  constructor(
    private ctx: DurableObjectState,
    env: GoogleEnv,
  ) {
    this.sheet = new ReadingSheet(new GoogleSheets(env), env.GOOGLE_SHEET_ID);
  }
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const command = await parseCommand(request);
        if (command.action === 'health' || command.action === 'searchPapers')
          throw new ApiError('Unknown sheet action.');
        // Bound all Google calls together below the coordinator's 30s lock limit.
        return success(
          await this.sheet.execute(command, AbortSignal.timeout(24000)),
        );
      } catch (error) {
        // Catch inside the lock so ordinary validation failures do not reset the object.
        return failure(error);
      }
    });
  }
}

async function search(query: string) {
  let reachedCatalog = false;
  for (const catalog of catalogs(query)) {
    try {
      const response = await fetch(catalog.url, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const results = catalog.parse(await response.json());
      reachedCatalog = true;
      if (results.length)
        return results.map((paper) => ({ ...paper, source: catalog.source }));
    } catch {
      /* Try the second catalog; manual entry remains available. */
    }
  }
  if (reachedCatalog) return [];
  throw new ApiError(SEARCH_ERROR, 502);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/'))
      return env.ASSETS.fetch(request);
    try {
      if (path !== '/api' && path !== '/api/')
        throw new ApiError('Unknown API route.', 404);
      const command = await parseCommand(request.clone());
      if (command.action === 'health')
        return success({
          service: 'mplse-reading-group',
          backend: 'google-sheets',
        });
      if (command.action === 'searchPapers')
        return success(await search(command.query));
      if (!env.GOOGLE_SHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_JSON)
        throw new ApiError(
          'The reading group is awaiting its Google Sheets connection. Ask the organizer to finish the Cloudflare setup.',
          503,
        );
      // Stable name matters: using per-user or per-request IDs would not serialize edits.
      return await env.SHEET.get(
        env.SHEET.idFromName(env.GOOGLE_SHEET_ID),
      ).fetch(request);
    } catch (error) {
      return failure(error);
    }
  },
} satisfies ExportedHandler<Env>;
