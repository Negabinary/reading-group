import type { GroupState, RankedPaper } from './types';
import { sessionDetails, timeLabel, ZOOM_URL } from './schedule';

export function AltPaper({
  paper,
  index,
  state,
  memberId,
  voting,
  onVote,
  onDetails,
}: {
  paper: RankedPaper;
  index: number;
  state: GroupState;
  memberId: string;
  voting: boolean;
  onVote: () => void;
  onDetails: () => void;
}) {
  const voted = paper.votes.includes(memberId);
  const name = state.members.find((m) => m.id === paper.suggestedBy)?.name;
  return (
    <article className="alt-row" aria-label={paper.title}>
      <span className="alt-rank">{index + 1}.</span>
      <div>
        {!paper.date && (
          <button
            className="alt-vote"
            disabled={voting}
            aria-pressed={voted}
            aria-label={`${voted ? 'Withdraw vote from' : 'Vote for'} ${paper.title}`}
            onClick={onVote}
          >
            ▲
          </button>
        )}
      </div>
      <div className="alt-story">
        <h3>
          {paper.url ? (
            <a href={paper.url} target="_blank" rel="noopener noreferrer">
              {paper.title}
            </a>
          ) : (
            <button onClick={onDetails}>{paper.title}</button>
          )}
        </h3>
        <p className="alt-meta">
          {[paper.authors, paper.year, paper.venue].filter(Boolean).join(' · ')}
        </p>
        {paper.notes && <p className="alt-description">{paper.notes}</p>}
        <p className="alt-meta">
          {paper.voteCount} {paper.voteCount === 1 ? 'vote' : 'votes'} · score{' '}
          {paper.score.toFixed(1)}
          {name && ` · suggested by ${name}`}
          {paper.date && ` · read ${paper.date}`} ·{' '}
          <button onClick={onDetails}>details</button>
        </p>
      </div>
    </article>
  );
}

export function AltSchedule({
  upcoming,
  state,
  onDetails,
  onCalendar,
}: {
  upcoming: RankedPaper[];
  state: GroupState | null;
  onDetails: (id: string) => void;
  onCalendar?: () => void;
}) {
  const date = upcoming[0]?.date;
  const session = date && state ? sessionDetails(state.papers, date) : null;
  return (
    <section
      className="alt-schedule"
      id="next-session"
      aria-label="Next session"
    >
      <div>
        <strong>Next session</strong>
        {date
          ? ` · ${new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
          : state
            ? ' · Not scheduled yet'
            : ' · Loading…'}
        {session && (
          <>
            {' '}
            · {session.times.map(timeLabel).join(' / ') || 'Time TBD'}{' '}
            {state?.timeZone}
            {session.locations.length > 0 &&
              ` · ${session.locations.join(' / ')}`}
          </>
        )}
      </div>
      {upcoming
        .filter((p) => p.date === date)
        .map((p) => (
          <p key={p.id}>
            <button onClick={() => onDetails(p.id)}>{p.title}</button>
          </p>
        ))}
      <div className="alt-session-links">
        {date && (
          <a href={ZOOM_URL} target="_blank" rel="noreferrer">
            Join on Zoom
          </a>
        )}
        {onCalendar && (
          <button onClick={onCalendar}>Subscribe to calendar</button>
        )}
      </div>
      {upcoming.some((p) => p.date !== date) && (
        <details>
          <summary>Later readings</summary>
          {upcoming
            .filter((p) => p.date !== date)
            .map((p) => (
              <p key={p.id}>
                {p.date} ·{' '}
                <button onClick={() => onDetails(p.id)}>{p.title}</button>
              </p>
            ))}
        </details>
      )}
    </section>
  );
}
