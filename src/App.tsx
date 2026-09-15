import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import { api, IDENTITY_KEY, isDemo } from './api';
import { memberWeights, rankPapers } from './domain';
import type {
  GroupState,
  PaperInput,
  PaperSort,
  RankedPaper,
  SearchPaper,
} from './types';
import { PaperScene } from './PaperScene';
import { useVisit } from './useVisit';

type View = 'pool' | 'new' | 'mine' | 'archive';
type Intent = { kind: 'suggest' } | { kind: 'vote'; id: string };
const EMPTY_PAPER: PaperInput = {
  title: '',
  authors: '',
  year: '',
  venue: '',
  url: '',
  topic: '',
  notes: '',
};
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
const dateLabel = (date: string, short = false) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(
    'en-US',
    short
      ? { month: 'short', day: 'numeric' }
      : { weekday: 'long', month: 'long', day: 'numeric' },
  );

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <div>
          <h2 id="dialog-title">{title}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function SignIn({
  state,
  onClose,
  onSignedIn,
}: {
  state: GroupState;
  onClose: () => void;
  onSignedIn: (id: string, state: GroupState) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.signIn(name);
      onSignedIn(result.member.id, result.state);
    } catch (error) {
      setError(errorText(error));
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Sign in"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="form-stack">
        <label>
          Your name
          <input
            autoFocus
            autoComplete="name"
            maxLength={60}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Alex Chen"
          />
        </label>
        {state.members.length > 0 && (
          <div>
            <p className="field-hint">Members</p>
            <div className="member-options">
              {state.members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className={name === member.name ? 'selected' : ''}
                  onClick={() => setName(member.name)}
                >
                  {member.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-dark" disabled={busy}>
          {busy ? (
            <Loader2 className="spin" size={18} />
          ) : (
            <>
              Sign in <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}

function Suggest({
  memberId,
  onClose,
  onAdded,
}: {
  memberId: string;
  onClose: () => void;
  onAdded: (state: GroupState) => void;
}) {
  const [mode, setMode] = useState<'search' | 'manual'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchPaper[] | null>(null);
  const [paper, setPaper] = useState<PaperInput>(EMPTY_PAPER);
  const [selected, setSelected] = useState(false);
  const [selectedSource, setSelectedSource] = useState('DBLP');
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const field = (key: keyof PaperInput, value: string) =>
    setPaper((current) => ({ ...current, [key]: value }));
  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    const serial = ++request.current;
    setSearching(true);
    setError('');
    setResults(null);
    try {
      const items = await api.searchPapers(query.trim());
      if (serial === request.current) setResults(items);
    } catch (error) {
      if (serial === request.current) setError(errorText(error));
    } finally {
      if (serial === request.current) setSearching(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      onAdded(await api.suggestPaper(paper, memberId));
    } catch (error) {
      setError(errorText(error));
      setSaving(false);
    }
  }
  function changeMode(mode: 'search' | 'manual') {
    request.current++;
    setMode(mode);
    setSelected(false);
    setError('');
    setSearching(false);
    setPaper(EMPTY_PAPER);
  }
  return (
    <Modal
      wide
      title="Suggest a paper"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="segmented" aria-label="How to add a paper">
        <button
          className={mode === 'search' ? 'active' : ''}
          onClick={() => changeMode('search')}
          disabled={saving}
        >
          <Search size={16} /> Search papers
        </button>
        <button
          className={mode === 'manual' ? 'active' : ''}
          onClick={() => changeMode('manual')}
          disabled={saving}
        >
          <Plus size={16} /> Add manually
        </button>
      </div>
      {mode === 'search' && !selected && (
        <>
          <form onSubmit={search} className="paper-search-form">
            <label className="sr-only" htmlFor="dblp-query">
              Search paper title or author
            </label>
            <input
              autoFocus
              id="dblp-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title or author"
              minLength={2}
              maxLength={200}
              required
            />
            <button
              className="button button-dark"
              disabled={searching || query.trim().length < 2}
            >
              {searching ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <Search size={18} />
              )}
              <span>Search</span>
            </button>
          </form>
          {searching && (
            <div className="search-placeholder" role="status">
              <Loader2 className="spin" />
              <p>Searching…</p>
            </div>
          )}
          {results && (
            <div className="search-results" aria-live="polite">
              {results.length === 0 ? (
                <p className="empty-search">
                  No papers found. Try fewer words or add it manually.
                </p>
              ) : (
                results.map((item, index) => (
                  <button
                    className="search-result"
                    key={`${item.url}-${index}`}
                    onClick={() => {
                      setPaper({ ...item, topic: '', notes: '' });
                      setSelected(true);
                      setSelectedSource(item.source || 'DBLP');
                      setError('');
                    }}
                  >
                    <span>
                      <span className="result-meta">
                        {item.source || 'DBLP'} · {item.year}{' '}
                        {item.venue && `· ${item.venue}`}
                      </span>
                      <strong>{item.title}</strong>
                      <span className="result-authors">
                        {item.authors || 'Authors not listed'}
                      </span>
                    </span>
                    <Plus size={20} />
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
      {(mode === 'manual' || selected) && (
        <form onSubmit={save} className="form-stack">
          {selected && (
            <div className="selected-notice">
              <Check size={16} /> {selectedSource}
              <button
                className="text-link"
                type="button"
                onClick={() => setSelected(false)}
              >
                Back
              </button>
            </div>
          )}
          <label>
            Paper title <span className="required">*</span>
            <input
              autoFocus
              required
              maxLength={500}
              value={paper.title}
              onChange={(event) => field('title', event.target.value)}
            />
          </label>
          <label>
            Authors
            <input
              value={paper.authors}
              maxLength={1500}
              onChange={(event) => field('authors', event.target.value)}
            />
          </label>
          <div className="form-row">
            <label>
              Year
              <input
                inputMode="numeric"
                pattern="(18|19|20|21)[0-9]{2}"
                maxLength={4}
                value={paper.year}
                onChange={(event) => field('year', event.target.value)}
                placeholder="2026"
              />
            </label>
            <label>
              Venue
              <input
                value={paper.venue}
                maxLength={200}
                onChange={(event) => field('venue', event.target.value)}
                placeholder="POPL, arXiv, …"
              />
            </label>
          </div>
          <label>
            Paper link
            <input
              type="url"
              value={paper.url}
              maxLength={2000}
              onChange={(event) => field('url', event.target.value)}
              placeholder="https://…"
            />
          </label>
          <label>
            Notes
            <textarea
              rows={3}
              maxLength={2000}
              value={paper.notes}
              onChange={(event) => field('notes', event.target.value)}
              placeholder="Optional"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button button-dark" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="spin" size={18} /> Adding paper…
              </>
            ) : (
              <>
                Add to the pool <ArrowUpRight size={19} />
              </>
            )}
          </button>
        </form>
      )}
      {mode === 'search' && !selected && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

function PaperCard({
  paper,
  index,
  memberId,
  state,
  voting,
  onVote,
  onDetails,
  archived = false,
  isNew = false,
}: {
  paper: RankedPaper;
  index: number;
  memberId: string;
  state: GroupState;
  voting: boolean;
  onVote: () => void;
  onDetails: () => void;
  archived?: boolean;
  isNew?: boolean;
}) {
  const voted = paper.votes.includes(memberId);
  const suggested = state.members.find(
    (member) => member.id === paper.suggestedBy,
  )?.name;
  return (
    <article
      className={`paper-card ${voted ? 'paper-voted' : ''}`}
      aria-label={paper.title}
    >
      <div className="paper-topline">
        <span className="paper-rank">{String(index + 1).padStart(2, '0')}</span>
        <span>{[paper.year, paper.venue].filter(Boolean).join(' / ')}</span>
        {isNew && (
          <span className="paper-new" title="Added since your last visit">
            New
          </span>
        )}
      </div>
      <h3>
        <button className="paper-title" onClick={onDetails}>
          {paper.title}
        </button>
      </h3>
      {paper.authors && <p className="authors">{paper.authors}</p>}
      <div className="paper-rules" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="paper-bottom">
        <div className="paper-credit">
          <span>{archived ? dateLabel(paper.date, true) : suggested}</span>
          {archived && <span>{paper.attendance.length} attended</span>}
        </div>
        {paper.url && (
          <a
            className="paper-read"
            href={paper.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Read paper: ${paper.title}`}
          >
            Read paper <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      <div className="paper-actions">
        {archived ? (
          <span className="archived-count">{paper.voteCount} votes</span>
        ) : (
          <button
            className={`vote-button ${voted ? 'is-voted' : ''}`}
            onClick={onVote}
            disabled={voting}
            aria-pressed={voted}
            aria-label={`${voted ? 'Withdraw vote from' : 'Vote for'} ${paper.title}`}
          >
            {voted ? <Check size={16} /> : <ArrowUp size={16} />}
            <strong>{paper.voteCount}</strong>
            <span>{voted ? 'Voted' : 'Vote'}</span>
          </button>
        )}
        <button
          className="score-label"
          onClick={onDetails}
          aria-label={`Score ${paper.score.toFixed(1)} for ${paper.title}`}
        >
          <span>Score</span> <strong>{paper.score.toFixed(1)}</strong>
        </button>
      </div>
    </article>
  );
}

export default function App() {
  const [state, setState] = useState<GroupState | null>(null);
  const [memberId, setMemberId] = useState(() => {
    try {
      return localStorage.getItem(IDENTITY_KEY) || '';
    } catch {
      return '';
    }
  });
  const [view, setView] = useState<View>('pool');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PaperSort>('votes');
  const { since, returning, recordVisit } = useVisit();
  const [modal, setModal] = useState<'signin' | 'suggest' | 'account' | null>(
    null,
  );
  const [detailId, setDetailId] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const intent = useRef<Intent | null>(null);
  const mutation = useRef(false);
  const revision = useRef(0);
  const pendingRead = useRef<number | null>(null);

  const refresh = useCallback(
    async (silent = false) => {
      if (
        mutation.current ||
        (silent && pendingRead.current === revision.current)
      )
        return;
      const serial = ++revision.current;
      pendingRead.current = serial;
      const requestedAt = Date.now();
      if (!silent) setRefreshing(true);
      try {
        const data = await api.getState();
        if (serial === revision.current && !mutation.current) {
          setState(data);
          setError('');
          if (document.visibilityState === 'visible') recordVisit(requestedAt);
        }
      } catch (error) {
        if (serial === revision.current) setError(errorText(error));
      } finally {
        if (pendingRead.current === serial) pendingRead.current = null;
        if (serial === revision.current) setRefreshing(false);
      }
    },
    [recordVisit],
  );
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, 30000);
    const listener = () => {
      if (document.visibilityState === 'visible') void refresh(true);
    };
    document.addEventListener('visibilitychange', listener);
    return () => {
      revision.current++;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', listener);
    };
  }, [refresh]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (
      state &&
      memberId &&
      !state.members.some((member) => member.id === memberId)
    ) {
      setMemberId('');
      localStorage.removeItem(IDENTITY_KEY);
      setModal(null);
      setToast('Your name was removed from the sheet. Sign in to rejoin.');
    }
  }, [state, memberId]);
  const ranked = useMemo(
    () => (state ? rankPapers(state, sort) : []),
    [state, sort],
  );
  const pool = ranked.filter((paper) => !paper.date);
  const newPapers = pool.filter((paper) => Date.parse(paper.addedAt) > since);
  const mine = pool.filter((paper) => paper.votes.includes(memberId));
  const archive = ranked
    .filter((paper) => paper.date && paper.date < state!.today)
    .sort((a, b) => b.date.localeCompare(a.date) || b.voteCount - a.voteCount);
  const upcoming = ranked
    .filter((paper) => paper.date && paper.date >= state!.today)
    .sort((a, b) => a.date.localeCompare(b.date) || b.voteCount - a.voteCount);
  const member = state?.members.find((person) => person.id === memberId);
  const shown = (
    view === 'pool'
      ? pool
      : view === 'new'
        ? newPapers
        : view === 'mine'
          ? mine
          : archive
  ).filter((paper) =>
    `${paper.title} ${paper.authors} ${paper.venue} ${paper.notes}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const details = ranked.find((paper) => paper.id === detailId);
  const weights = useMemo(
    () =>
      state ? memberWeights(state.papers, state.members, state.today) : {},
    [state],
  );
  function changeView(next: View) {
    setView(next);
    if (next === 'new') setSort('newest');
    setQuery('');
    document.getElementById('paper-pool')?.scrollIntoView({
      behavior:
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      block: 'start',
    });
  }
  function requireMember(action: Intent) {
    if (!memberId) {
      intent.current = action;
      setModal('signin');
      return;
    }
    if (action.kind === 'suggest') setModal('suggest');
    else void vote(action.id, memberId);
  }
  async function vote(paperId: string, id: string) {
    if (mutation.current) return;
    const paper = ranked.find((p) => p.id === paperId);
    if (!paper) return;
    const wanted = !paper.votes.includes(id);
    mutation.current = true;
    revision.current++;
    setBusy(true);
    setRefreshing(false);
    setError('');
    try {
      setState(await api.setVote(paperId, id, wanted));
      setToast(wanted ? 'Vote added' : 'Vote withdrawn');
    } catch (error) {
      setError(errorText(error));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  function signedIn(id: string, data: GroupState) {
    revision.current++;
    setState(data);
    setMemberId(id);
    setRefreshing(false);
    try {
      localStorage.setItem(IDENTITY_KEY, id);
    } catch {
      /* Session continues without persistence. */
    }
    setModal(null);
    const next = intent.current;
    intent.current = null;
    if (next?.kind === 'suggest') setModal('suggest');
    else if (next?.kind === 'vote') void vote(next.id, id);
    else setToast('Signed in');
  }
  function closeModal() {
    setModal(null);
    intent.current = null;
  }

  return (
    <>
      <a className="skip-link" href="#paper-pool">
        Skip to papers
      </a>
      <header className="site-header">
        <a
          className="wordmark"
          href="#next-session"
          aria-label="MPLSE Reading Group home"
        >
          <strong>MPLSE</strong>
          <span>Reading group</span>
        </a>
        {state?.sheetUrl && (
          <nav aria-label="Main navigation">
            <a href={state.sheetUrl} target="_blank" rel="noreferrer">
              Sheet <ExternalLink size={12} />
            </a>
          </nav>
        )}
        <button
          className="sign-in-button"
          onClick={() => setModal(member ? 'account' : 'signin')}
          disabled={!state}
        >
          {member ? (
            <>
              {member.name} <ChevronDown size={14} />
            </>
          ) : (
            <>
              Sign in <ArrowUpRight size={15} />
            </>
          )}
        </button>
      </header>
      <main>
        {isDemo && <div className="demo-notice">Demo · local data</div>}
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="text-link" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}
        <PaperScene
          upcoming={upcoming}
          papers={pool}
          loading={!state}
          onDetails={setDetailId}
        />
        <section
          className="reading-section"
          id="paper-pool"
          aria-labelledby="pool-heading"
        >
          <div className="section-top">
            <h2 id="pool-heading">
              Papers<span className="heading-count">{pool.length}</span>
            </h2>
            <button
              className="button button-accent"
              onClick={() => requireMember({ kind: 'suggest' })}
              disabled={!state}
            >
              <Plus size={18} /> Suggest a paper
            </button>
          </div>
          <div className="pool-toolbar">
            <div className="pool-tabs" aria-label="Paper views">
              <button
                aria-pressed={view === 'pool'}
                onClick={() => changeView('pool')}
              >
                Pool <span>{pool.length}</span>
              </button>
              <button
                aria-pressed={view === 'new'}
                aria-label={`New since last visit (${newPapers.length})`}
                title="New since last visit"
                onClick={() => changeView('new')}
              >
                New <span>{newPapers.length}</span>
              </button>
              <button
                aria-pressed={view === 'mine'}
                onClick={() => changeView('mine')}
              >
                My votes <span>{mine.length}</span>
              </button>
              <button
                aria-pressed={view === 'archive'}
                onClick={() => changeView('archive')}
              >
                Archive <span>{archive.length}</span>
              </button>
            </div>
            <div className="pool-filters">
              <label className="pool-search">
                <Search size={16} />
                <span className="sr-only">Search the paper pool</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                />
              </label>
              {view !== 'archive' && (
                <label className="sort-select">
                  <span>Sort</span>
                  <select
                    aria-label="Sort papers"
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as PaperSort)
                    }
                  >
                    <option value="votes">Votes</option>
                    <option value="score">Score</option>
                    <option value="newest">Newest</option>
                  </select>
                </label>
              )}
            </div>
          </div>
          {!state && (
            <p className="empty-state" role="status">
              {error ? 'Unable to load papers.' : 'Loading…'}
            </p>
          )}
          <div className="paper-grid">
            {state &&
              shown.map((paper, index) => (
                <PaperCard
                  key={paper.id}
                  paper={paper}
                  index={index}
                  state={state}
                  memberId={memberId}
                  voting={busy}
                  onVote={() => requireMember({ kind: 'vote', id: paper.id })}
                  onDetails={() => setDetailId(paper.id)}
                  archived={view === 'archive'}
                  isNew={!paper.date && Date.parse(paper.addedAt) > since}
                />
              ))}
          </div>
          {state && shown.length === 0 && (
            <div className="empty-state">
              <p>
                {query
                  ? 'No matches.'
                  : view === 'mine'
                    ? 'No votes yet.'
                    : view === 'archive'
                      ? 'No past readings.'
                      : view === 'new'
                        ? returning
                          ? 'No new papers since your last visit.'
                          : 'No new papers yet. Check back after more are added.'
                        : 'No papers yet.'}
              </p>
              {query ? (
                <button className="text-link" onClick={() => setQuery('')}>
                  Clear search
                </button>
              ) : view === 'mine' && !memberId ? (
                <button
                  className="text-link"
                  onClick={() => setModal('signin')}
                >
                  Sign in
                </button>
              ) : null}
            </div>
          )}
          <div className="pool-footnote">
            <span>
              {shown.length} {shown.length === 1 ? 'paper' : 'papers'}
            </span>
            <button
              className="text-link"
              disabled={refreshing || busy}
              onClick={() => void refresh()}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </section>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal === 'signin' && state && (
        <SignIn state={state} onClose={closeModal} onSignedIn={signedIn} />
      )}
      {modal === 'suggest' && memberId && (
        <Suggest
          memberId={memberId}
          onClose={closeModal}
          onAdded={(data) => {
            revision.current++;
            setState(data);
            setRefreshing(false);
            setModal(null);
            setView('pool');
            setQuery('');
            setToast('Paper added');
          }}
        />
      )}
      {modal === 'account' && member && (
        <Modal title={member.name} onClose={closeModal}>
          <div className="account-stats">
            <div>
              <strong>{mine.length}</strong>
              <span>votes</span>
            </div>
            <div>
              <strong>{(weights[member.id] || 1).toFixed(2)}</strong>
              <span>vote weight</span>
            </div>
          </div>
          <button
            className="button button-dark"
            onClick={() => {
              closeModal();
              changeView('mine');
            }}
          >
            See my votes <ArrowRight size={17} />
          </button>
          <button
            className="button button-outline account-signout"
            onClick={() => {
              setMemberId('');
              localStorage.removeItem(IDENTITY_KEY);
              closeModal();
              setView('pool');
              setToast('Signed out');
            }}
          >
            Sign out
          </button>
        </Modal>
      )}
      {details && state && (
        <Modal title={details.title} onClose={() => setDetailId('')} wide>
          <p className="detail-authors">
            {details.authors || 'Authors not listed'}
          </p>
          <div className="detail-meta">
            <span>
              {details.year} {details.venue && `· ${details.venue}`}
            </span>
          </div>
          {details.date && (
            <p className="scheduled-detail">
              <Clock3 size={17} /> {dateLabel(details.date)} · Voting closed
            </p>
          )}
          {details.notes && (
            <blockquote className="paper-note">
              “{details.notes}”
              <cite>
                —{' '}
                {state.members.find((m) => m.id === details.suggestedBy)
                  ?.name || 'Suggested by the group'}
              </cite>
            </blockquote>
          )}
          <div className="detail-stats">
            <div>
              <strong>{details.voteCount}</strong>
              <span>votes</span>
            </div>
            <div>
              <strong>{details.score.toFixed(1)}</strong>
              <span>score</span>
            </div>
          </div>
          <p className="voter-list">
            <Users size={16} />
            {details.votes.length
              ? details.votes
                  .map((id) => state.members.find((m) => m.id === id)?.name)
                  .filter(Boolean)
                  .join(', ')
              : 'No votes'}
          </p>
          {details.date && details.date < state.today && (
            <p className="voter-list">
              <Check size={16} />
              Attended:{' '}
              {details.attendance
                .map((id) => state.members.find((m) => m.id === id)?.name)
                .filter(Boolean)
                .join(', ') || 'No attendance recorded'}
            </p>
          )}
          <div className="detail-buttons">
            {details.url && (
              <a
                className="button button-dark"
                href={details.url}
                target="_blank"
                rel="noreferrer"
              >
                Read paper <ArrowUpRight size={18} />
              </a>
            )}
            {!details.date && (
              <button
                className="button button-outline"
                disabled={busy}
                onClick={() => {
                  if (!memberId) setDetailId('');
                  requireMember({ kind: 'vote', id: details.id });
                }}
              >
                {details.votes.includes(memberId) ? (
                  <>
                    <Check size={17} /> Withdraw vote
                  </>
                ) : (
                  <>
                    <ArrowUp size={17} /> Vote
                  </>
                )}
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
