import * as server from './server';
import type { PaperInput } from '../src/types';

// Only these handlers are public. Setup and internal helpers cannot be invoked
// by supplying arbitrary function names in a request.
export { setup } from './server';

type GetRequest = { parameter?: Record<string, string> };
type PostRequest = { postData?: { contents?: string } };

function json(work: () => unknown): GoogleAppsScript.Content.TextOutput {
  let response;
  try {
    response = { apiVersion: 1, ok: true, data: work() };
  } catch (error) {
    response = {
      apiVersion: 1,
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'The request failed. Please try again.',
    };
  }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

export function handleGet(event?: GetRequest) {
  return json(() => {
    const params = event?.parameter || {};
    switch (params.action || 'health') {
      case 'health':
        return { service: 'mplse-reading-group' };
      case 'getState':
        return server.getState();
      case 'searchPapers':
        return server.searchPapers(params.query);
      default:
        throw new Error('Unknown GET action. Use POST for changes.');
    }
  });
}

export function handlePost(event?: PostRequest) {
  return json(() => {
    const contents = event?.postData?.contents;
    if (!contents || contents.length > 20000)
      throw new Error('Invalid request body.');
    let request;
    try {
      request = JSON.parse(contents);
    } catch {
      throw new Error('The request body must be JSON.');
    }
    if (
      !request ||
      typeof request !== 'object' ||
      !Array.isArray(request.args)
    ) {
      throw new Error('Provide an action and an args array.');
    }
    const args: unknown[] = request.args;
    switch (request.action) {
      case 'signIn':
        if (args.length !== 1 || typeof args[0] !== 'string')
          throw new Error('Enter your name.');
        return server.signIn(args[0]);
      case 'setVote':
        if (
          args.length !== 3 ||
          typeof args[0] !== 'string' ||
          typeof args[1] !== 'string' ||
          typeof args[2] !== 'boolean'
        ) {
          throw new Error(
            'Provide a paper ID, member ID, and true or false vote.',
          );
        }
        return server.setVote(args[0], args[1], args[2]);
      case 'suggestPaper':
        if (
          args.length !== 2 ||
          !args[0] ||
          typeof args[0] !== 'object' ||
          Array.isArray(args[0]) ||
          typeof args[1] !== 'string'
        ) {
          throw new Error('Provide a paper and member ID.');
        }
        return server.suggestPaper(args[0] as PaperInput, args[1]);
      default:
        throw new Error('Unknown POST action.');
    }
  });
}
