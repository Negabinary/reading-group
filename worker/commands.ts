import { normalizeName, validatePaper } from '../src/domain';
import type { PaperInput } from '../src/types';
import { ApiError } from './errors';

export type SheetCommand =
  | { action: 'getState' }
  | { action: 'signIn'; name: string }
  | { action: 'setVote'; paperId: string; memberId: string; voted: boolean }
  | { action: 'suggestPaper'; paper: PaperInput; memberId: string };
export type Command =
  | SheetCommand
  | { action: 'health' }
  | { action: 'searchPapers'; query: string };

async function smallBody(request: Request): Promise<string> {
  if (Number(request.headers.get('Content-Length')) > 20000)
    throw new ApiError('Request body is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('Provide a JSON request body.');
  const decoder = new TextDecoder();
  let size = 0,
    text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.length;
    if (size > 20000) {
      await reader.cancel();
      throw new ApiError('Request body is too large.', 413);
    }
    text += decoder.decode(value, { stream: true });
  }
}

export async function parseCommand(request: Request): Promise<Command> {
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    switch (params.get('action') || 'health') {
      case 'health':
        return { action: 'health' };
      case 'getState':
        return { action: 'getState' };
      case 'searchPapers': {
        const query = params.get('query') || '';
        if (query.trim().length < 2 || query.length > 200)
          throw new ApiError('Search with 2–200 characters.');
        return { action: 'searchPapers', query: query.trim() };
      }
      default:
        throw new ApiError('Unknown GET action. Use POST for changes.');
    }
  }
  if (request.method !== 'POST') throw new ApiError('Use GET or POST.', 405);
  // Same-origin JSON prevents unrelated websites from submitting browser forms.
  // This is not authentication; registration is still intentionally name-only.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin)
    throw new ApiError('Send changes from the reading group website.', 403);
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw new ApiError('Send JSON with Content-Type application/json.', 415);
  const text = await smallBody(request);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError('The request body must be JSON.');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.args))
    throw new ApiError('Provide an action and an args array.');
  const args: unknown[] = data.args;
  const id = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 200;
  switch (data.action) {
    case 'signIn': {
      if (args.length !== 1 || typeof args[0] !== 'string')
        throw new ApiError('Enter your name.');
      const name = normalizeName(args[0]);
      if (!name || name.length > 60)
        throw new ApiError('Enter a name between 1 and 60 characters.');
      if (['time', 'location'].includes(name.toLocaleLowerCase()))
        throw new ApiError(
          'Time and Location are scheduling fields. Enter your name to sign in.',
        );
      return { action: 'signIn', name };
    }
    case 'setVote':
      if (
        args.length !== 3 ||
        !id(args[0]) ||
        !id(args[1]) ||
        typeof args[2] !== 'boolean'
      )
        throw new ApiError(
          'Provide a paper ID, member ID, and true or false vote.',
        );
      return {
        action: 'setVote',
        paperId: args[0],
        memberId: args[1],
        voted: args[2],
      };
    case 'suggestPaper': {
      if (
        args.length !== 2 ||
        !args[0] ||
        typeof args[0] !== 'object' ||
        Array.isArray(args[0]) ||
        !id(args[1])
      )
        throw new ApiError('Provide a paper and member ID.');
      let paper: PaperInput;
      try {
        paper = validatePaper(args[0] as PaperInput);
      } catch (error) {
        throw new ApiError((error as Error).message);
      }
      return { action: 'suggestPaper', paper, memberId: args[1] };
    }
    default:
      throw new ApiError('Unknown POST action.');
  }
}
