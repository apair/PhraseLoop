import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../data/db';
import { isSessionComplete } from '../lib/timer';
import { getOrCreateSession, openSessionTimer, pauseSessionTimer, rateCard } from '../services/session';
import type { Correction, DailySession, Group, Rating } from '../types';
import { SessionClock } from './SessionClock';

const GROUP_LABEL: Record<Group, string> = { newest: 'Newest', difficult: 'Difficult', older: 'Older' };

const RATINGS: { rating: Rating; label: string; hint: string; key: string }[] = [
  { rating: 'again', label: 'Again', hint: 'tomorrow', key: '1' },
  { rating: 'hard', label: 'Hard', hint: 'in 2 days', key: '2' },
  { rating: 'easy', label: 'Easy', hint: 'later', key: '3' },
];

export function Review({ onExit }: { onExit: () => void }) {
  const [session, setSession] = useState<DailySession>();
  const [cards, setCards] = useState<Map<string, Correction>>(new Map());
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const created = await getOrCreateSession(db);
      if (cancelled) return;
      const s = created ? await openSessionTimer(db, created.date) : undefined;
      if (cancelled) {
        if (s && !isSessionComplete(s)) await pauseSessionTimer(db, s.date);
        return;
      }
      if (s) {
        const list = await db.corrections.bulkGet(s.cardIds);
        if (cancelled) return;
        setCards(new Map(list.filter((c): c is Correction => !!c).map((c) => [c.id, c])));
      }
      setSession(s);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session || isSessionComplete(session)) return;
    const date = session.date;
    const onVisibility = () => {
      const next = document.visibilityState === 'hidden' ? pauseSessionTimer(db, date) : openSessionTimer(db, date);
      void next.then((updated) => {
        if (updated) setSession(updated);
      });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void pauseSessionTimer(db, date);
    };
  }, [session?.date, session && isSessionComplete(session)]);

  const leave = async () => {
    if (session && !isSessionComplete(session)) await pauseSessionTimer(db, session.date);
    onExit();
  };

  const total = session?.cardIds.length ?? 0;
  const index = session?.currentIndex ?? 0;
  const currentId = session?.cardIds[index];
  const card = currentId ? cards.get(currentId) : undefined;

  const rate = useCallback(
    async (rating: Rating) => {
      if (!session || !currentId || busy) return;
      setBusy(true);
      setError(undefined);
      try {
        const result = await rateCard(db, session.date, currentId, rating);
        setSession(result.session);
        setRevealed(false);
      } catch (err) {
        setError(`Could not save your rating: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [session, currentId, busy],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter') && target?.tagName !== 'BUTTON') {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const match = RATINGS.find((r) => r.key === e.key);
        if (match) {
          e.preventDefault();
          void rate(match.rating);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, rate]);

  const groupCounts = useMemo(() => {
    const counts: Record<Group, number> = { newest: 0, difficult: 0, older: 0 };
    if (session) for (const id of session.cardIds) counts[session.groups[id]]++;
    return counts;
  }, [session]);

  if (loading) return <p className="muted">Loading...</p>;
  if (!session) {
    return (
      <div className="card">
        <p>No cards available yet. Sync once while online.</p>
        <button onClick={() => void leave()}>Back</button>
      </div>
    );
  }

  if (index >= total) {
    return (
      <div className="card stack center">
        <h2>Session complete</h2>
        <p>
          You reviewed {session.completedCardIds.length} cards today ({groupCounts.newest} newest,{' '}
          {groupCounts.difficult} difficult, {groupCounts.older} older).
        </p>
        <SessionClock session={session} />
        <button className="primary" onClick={() => void leave()}>Back to home</button>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="card stack">
        <p className="error" role="alert">This card is missing from local storage.</p>
        <button onClick={() => void rate('again')}>Skip</button>
      </div>
    );
  }

  return (
    <section className="stack">
      <div className="review-head">
        <button className="link" onClick={() => void leave()}>Exit</button>
        <span aria-live="polite">
          Card {index + 1} of {total}
        </span>
        <span className={`badge badge-${session.groups[card.id]}`}>{GROUP_LABEL[session.groups[card.id]]}</span>
      </div>
      <SessionClock session={session} />
      <progress value={session.completedCardIds.length} max={total} aria-label="Session progress" />

      <article className="card flash" aria-label="Flashcard">
        <p className="label">How would you say this naturally?</p>
        <p className="original" lang="en">{card.original}</p>

        {!revealed ? (
          <button className="primary" onClick={() => setRevealed(true)} autoFocus>
            Show answer <kbd>Space</kbd>
          </button>
        ) : (
          <div className="answer stack">
            <div>
              <p className="label">Native alternatives</p>
              <p className="alts">{card.alternatives || <span className="muted">(none listed)</span>}</p>
            </div>
            <details>
              <summary>Corrected sentence &amp; explanation</summary>
              <p className="label">Corrected</p>
              <p className="corrected">{card.corrected}</p>
              {card.explanation && (
                <>
                  <p className="label">Explanation</p>
                  <p className="explanation">{card.explanation}</p>
                </>
              )}
            </details>
          </div>
        )}
      </article>

      {revealed && (
        <div className="ratings" role="group" aria-label="Rate your recall">
          {RATINGS.map((r) => (
            <button key={r.rating} className={`rate rate-${r.rating}`} disabled={busy} onClick={() => void rate(r.rating)}>
              <strong>{r.label}</strong>
              <small>{r.hint}</small>
              <kbd>{r.key}</kbd>
            </button>
          ))}
        </div>
      )}
      {revealed && (
        <p className="muted small center">
          A natural alternative of your own that is correct counts as Easy.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
