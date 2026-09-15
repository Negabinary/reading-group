import { parseDblp, safeUrl } from './domain';
import type { SearchPaper } from './types';

export const SEARCH_ERROR =
  'Paper search is unavailable right now. Please try again or add a paper manually.';

export function parseCrossref(data: unknown): SearchPaper[] {
  type Item = {
    title?: string[];
    author?: { given?: string; family?: string; name?: string }[];
    published?: { 'date-parts'?: number[][] };
    'container-title'?: string[];
    DOI?: string;
    URL?: string;
  };
  const items = (data as { message?: { items?: Item[] } })?.message?.items;
  if (!Array.isArray(items)) throw new Error(SEARCH_ERROR);
  const plain = (text: string) =>
    text
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  return items
    .map((item) => ({
      title: plain(item.title?.[0] || ''),
      authors: (item.author || [])
        .map(
          (author) =>
            author.name ||
            [author.given, author.family].filter(Boolean).join(' '),
        )
        .filter(Boolean)
        .join(', '),
      year: String(item.published?.['date-parts']?.[0]?.[0] || ''),
      venue: plain(item['container-title']?.[0] || ''),
      url: item.DOI
        ? safeUrl(`https://doi.org/${item.DOI}`)
        : safeUrl(item.URL || ''),
    }))
    .filter((paper) => paper.title);
}

/** DBLP first; Crossref also covers papers outside computer science. */
export function catalogs(query: string, localProxy = false) {
  const encoded = encodeURIComponent(query.trim());
  return [
    {
      source: 'DBLP' as const,
      url: `${localProxy ? '/dblp-api' : 'https://dblp.org/search/publ/api'}?q=${encoded}&format=json&h=12`,
      parse: parseDblp,
    },
    {
      source: 'Crossref' as const,
      url: `${localProxy ? '/crossref-api' : 'https://api.crossref.org/works'}?query.bibliographic=${encoded}&rows=12&select=DOI,title,author,published,container-title,URL`,
      parse: parseCrossref,
    },
  ];
}
