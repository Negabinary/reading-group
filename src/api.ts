import { createDemo } from './demo';
import {
  duplicatePaper,
  localDate,
  normalizeName,
  validatePaper,
} from './domain';
import { catalogs, SEARCH_ERROR } from './catalogs';
import { requestApi, type ApiAction } from './http-api';
import type { GroupState, Member, PaperInput, SearchPaper } from './types';

const endpoint = import.meta.env.VITE_APPS_SCRIPT_URL?.trim() || '';
// A configured API failure must never silently seed demo data. Production
// builds require this URL; the demo build is a separate, explicit command.
export const isDemo = !endpoint;
const DEMO_KEY = 'mplse.demo.v1';
export const IDENTITY_KEY = isDemo
  ? 'mplse.identity.demo.v1'
  : 'mplse.identity.live.v1';

function rpc<T>(method: ApiAction, ...args: unknown[]): Promise<T> {
  return requestApi<T>(endpoint, method, args);
}

function readDemo(): GroupState {
  const raw = localStorage.getItem(DEMO_KEY);
  if (!raw) {
    const data = createDemo();
    localStorage.setItem(DEMO_KEY, JSON.stringify(data));
    return data;
  }
  const data = JSON.parse(raw) as GroupState;
  data.today = localDate();
  return data;
}

function saveDemo(state: GroupState): GroupState {
  localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  return state;
}

export const api = {
  async getState(): Promise<GroupState> {
    return isDemo ? readDemo() : rpc('getState');
  },
  async signIn(name: string): Promise<{ member: Member; state: GroupState }> {
    if (!isDemo) return rpc('signIn', name);
    const clean = normalizeName(name);
    if (!clean || clean.length > 60)
      throw new Error('Enter a name between 1 and 60 characters.');
    const state = readDemo();
    const member = state.members.find(
      (m) => m.name.toLocaleLowerCase() === clean.toLocaleLowerCase(),
    ) || { id: crypto.randomUUID(), name: clean };
    if (!state.members.some((m) => m.id === member.id))
      state.members.push(member);
    return { member, state: saveDemo(state) };
  },
  async setVote(
    paperId: string,
    memberId: string,
    voted: boolean,
  ): Promise<GroupState> {
    if (!isDemo) return rpc('setVote', paperId, memberId, voted);
    const state = readDemo();
    if (!state.members.some((member) => member.id === memberId))
      throw new Error('Please sign in again.');
    const paper = state.papers.find((p) => p.id === paperId);
    if (!paper)
      throw new Error('This paper has been removed. Refresh the pool.');
    if (paper.date) throw new Error('Voting is closed for scheduled papers.');
    paper.votes = paper.votes.filter((id) => id !== memberId);
    if (voted) paper.votes.push(memberId);
    return saveDemo(state);
  },
  async suggestPaper(input: PaperInput, memberId: string): Promise<GroupState> {
    if (!isDemo) return rpc('suggestPaper', input, memberId);
    const state = readDemo();
    if (!state.members.some((m) => m.id === memberId))
      throw new Error('Please sign in again.');
    const paper = validatePaper(input);
    if (duplicatePaper(state.papers, paper))
      throw new Error(
        'This paper is already in the reading group. Find it in the pool or archive.',
      );
    state.papers.push({
      ...paper,
      id: crypto.randomUUID(),
      suggestedBy: memberId,
      addedAt: new Date().toISOString(),
      date: '',
      votes: [memberId],
      attendance: [],
    });
    return saveDemo(state);
  },
  async searchPapers(query: string): Promise<SearchPaper[]> {
    if (!isDemo) return rpc('searchPapers', query);
    let reachedCatalog = false;
    for (const catalog of catalogs(query, import.meta.env.DEV)) {
      try {
        const response = await fetch(catalog.url, {
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) continue;
        const results = catalog.parse(await response.json());
        reachedCatalog = true;
        if (results.length)
          return results.map((paper) => ({ ...paper, source: catalog.source }));
      } catch {
        /* A rate limit, bot-check HTML, or outage falls back to the next catalog. */
      }
    }
    if (reachedCatalog) return [];
    throw new Error(SEARCH_ERROR);
  },
};
