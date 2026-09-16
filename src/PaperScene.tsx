import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  CalendarDays,
  Pause,
  Play,
} from 'lucide-react';
import type { RankedPaper } from './types';
import { sessionDetails, timeLabel, ZOOM_URL } from './schedule';

const fullDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

export function PaperScene({
  upcoming,
  papers,
  loading,
  onDetails,
  timeZone,
  onCalendar,
}: {
  upcoming: RankedPaper[];
  papers: RankedPaper[];
  loading: boolean;
  onDetails: (id: string) => void;
  timeZone?: string;
  onCalendar?: () => void;
}) {
  const scene = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const moving = !paused && !reduced;
  const date = upcoming[0]?.date;
  const session = upcoming.filter((paper) => paper.date === date);
  const later = upcoming.filter((paper) => paper.date !== date);
  const schedule = date ? sessionDetails(session, date) : null;

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const element = scene.current;
    if (!element || !moving) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const paint = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const depth = Math.max(-1, Math.min(1, -rect.top / rect.height));
      element.style.setProperty('--look-x', `${x * 18}px`);
      element.style.setProperty('--look-y', `${y * 12}px`);
      element.style.setProperty('--turn-x', `${-y * 3}deg`);
      element.style.setProperty('--turn-y', `${x * 5}deg`);
      element.style.setProperty('--depth', `${depth * 70}px`);
    };
    const request = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const rect = element.getBoundingClientRect();
      x = (event.clientX - rect.left) / rect.width - 0.5;
      y = (event.clientY - rect.top) / rect.height - 0.5;
      request();
    };
    const reset = () => {
      x = 0;
      y = 0;
      request();
    };
    element.addEventListener('pointermove', pointer);
    element.addEventListener('pointerleave', reset);
    window.addEventListener('scroll', request, { passive: true });
    request();
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', pointer);
      element.removeEventListener('pointerleave', reset);
      window.removeEventListener('scroll', request);
      ['--look-x', '--look-y', '--turn-x', '--turn-y', '--depth'].forEach(
        (key) => element.style.removeProperty(key),
      );
    };
  }, [moving]);

  return (
    <section
      className="session-scene"
      id="next-session"
      ref={scene}
      aria-labelledby="session-label"
      data-motion={moving ? 'on' : 'off'}
    >
      <div className="scene-topline">
        <h2 id="session-label">Next session</h2>
        <div className="scene-actions">
          {onCalendar && (
            <button className="calendar-button" onClick={onCalendar}>
              <CalendarDays size={14} />
              Subscribe
            </button>
          )}
          {!reduced && (
            <button
              className="motion-button"
              onClick={() => setPaused((value) => !value)}
              aria-label={paused ? 'Resume paper motion' : 'Pause paper motion'}
              aria-pressed={paused}
            >
              {paused ? <Play size={12} /> : <Pause size={12} />} Motion{' '}
              {paused ? 'off' : 'on'}
            </button>
          )}
        </div>
      </div>
      <div className="scene-space">
        <div className="room" aria-hidden="true">
          <div className="room-aperture" />
          <div className="room-floor" />
          <div className="room-orbit orbit-one" />
          <div className="room-orbit orbit-two" />
          <div className="paper-cloud">
            {Array.from({ length: 10 }, (_, index) => {
              const paper = papers.length
                ? papers[index % papers.length]
                : null;
              return (
                <div
                  className={`loose-paper loose-paper-${index}`}
                  key={index}
                  style={
                    {
                      '--delay': `${index * -1.7}s`,
                      '--drift': `${12 + (index % 3) * 9}px`,
                    } as CSSProperties
                  }
                >
                  <div className="loose-face">
                    <span>{paper?.year || ''}</span>
                    <strong>{paper?.title || ''}</strong>
                    <div className="ghost-columns" />
                    <div className="ghost-diagram">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="session-date">
          {date ? (
            <time dateTime={date} aria-label={fullDate(date)}>
              <span className="date-month">
                {new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
                  month: 'short',
                })}
              </span>
              <span className="date-day">{date.slice(8)}</span>
              <span className="date-weekday">
                {new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
                  weekday: 'long',
                })}{' '}
                / {date.slice(0, 4)}
              </span>
            </time>
          ) : (
            <span className="date-day date-unset" aria-hidden="true">
              —
            </span>
          )}
          {schedule && (
            <div className="session-logistics">
              {!!schedule.times.length && (
                <p>
                  {schedule.times.map(timeLabel).join(' / ')}
                  {timeZone && (
                    <span className="session-timezone">
                      {timeZone.replace(/_/g, ' ')}
                    </span>
                  )}
                </p>
              )}
              {!!schedule.locations.length && (
                <p>{schedule.locations.join(' / ')}</p>
              )}
              <a href={ZOOM_URL} target="_blank" rel="noreferrer">
                Join on Zoom <ArrowUpRight size={13} />
              </a>
            </div>
          )}
        </div>
        <div
          className={`session-stack ${session.length > 1 ? 'session-multiple' : ''}`}
        >
          {session.length ? (
            session.map((paper, index) => (
              <div className="session-paper" key={paper.id}>
                <div className="session-paper-meta">
                  <span>
                    {[paper.year, paper.venue].filter(Boolean).join(' / ')}
                  </span>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </div>
                {index === 0 ? (
                  <h1>
                    <button onClick={() => onDetails(paper.id)}>
                      {paper.title}
                    </button>
                  </h1>
                ) : (
                  <h3>
                    <button onClick={() => onDetails(paper.id)}>
                      {paper.title}
                    </button>
                  </h3>
                )}
                {paper.authors && (
                  <p className="session-authors">{paper.authors}</p>
                )}
                {paper.notes.trim() && (
                  <p className="paper-description">{paper.notes}</p>
                )}
                <div className="session-paper-bottom">
                  <button
                    className="text-link"
                    onClick={() => onDetails(paper.id)}
                  >
                    Details
                  </button>
                  {paper.url && (
                    <a
                      className="read-link"
                      href={paper.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Read paper: ${paper.title}`}
                    >
                      Read paper <ArrowUpRight size={19} />
                    </a>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="session-paper session-empty">
              <span className="session-paper-meta">MPLSE</span>
              <h1>{loading ? 'Loading…' : 'No session scheduled.'}</h1>
              <a className="text-link" href="#paper-pool">
                Paper pool <ArrowDown size={15} />
              </a>
            </div>
          )}
        </div>
      </div>
      {later.length > 0 && (
        <div className="later-sessions" aria-label="Later sessions">
          {later.map((paper) => (
            <div className="later-paper" key={paper.id}>
              <button onClick={() => onDetails(paper.id)}>
                <time dateTime={paper.date}>
                  {new Date(`${paper.date}T12:00:00`).toLocaleDateString(
                    'en-US',
                    { month: 'short', day: 'numeric' },
                  )}
                </time>
                <span>{paper.title}</span>
              </button>
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
          ))}
        </div>
      )}
      <a className="scene-index" href="#paper-pool">
        <span>{String(papers.length).padStart(2, '0')} in the pool</span>
        <ArrowDown size={16} />
      </a>
    </section>
  );
}
