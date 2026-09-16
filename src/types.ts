export interface Member {
  id: string;
  name: string;
}

export interface PaperInput {
  title: string;
  authors: string;
  year: string;
  venue: string;
  url: string;
  topic: string;
  notes: string;
}

export interface Paper extends PaperInput {
  id: string;
  suggestedBy: string;
  addedAt: string;
  date: string;
  time?: string;
  location?: string;
  votes: string[];
  attendance: string[];
}

export interface GroupState {
  members: Member[];
  papers: Paper[];
  sheetUrl: string;
  today: string;
  timeZone?: string;
}

export interface RankedPaper extends Paper {
  voteCount: number;
  score: number;
}
export type PaperSort = 'votes' | 'score' | 'newest';
export type SearchPaper = Omit<PaperInput, 'topic' | 'notes'> & {
  source?: 'DBLP' | 'Crossref';
};
