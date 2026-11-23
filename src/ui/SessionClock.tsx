import { useEffect, useState } from 'react';
import { elapsedMilliseconds, formatDuration, formatDurationSpoken, isSessionComplete } from '../lib/timer';
import type { DailySession } from '../types';

type ClockSession = Pick<DailySession, 'cardIds' | 'completedCardIds' | 'elapsedMs' | 'timerStartedAt'>;

function useElapsed(session: ClockSession): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!session.timerStartedAt) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session.timerStartedAt]);
  return elapsedMilliseconds(session, new Date(now));
}

export function SessionClock({ session }: { session: ClockSession }) {
  const ms = useElapsed(session);
  const finished = isSessionComplete(session);
  const spoken = formatDurationSpoken(ms);
  return (
    <p className="timer" role="timer" aria-label={finished ? `Today's review took ${spoken}` : `Time spent reviewing today ${spoken}`}>
      <span className="label">{finished ? 'Finished in' : 'Time today'}</span>
      <span className="timer-value">{formatDuration(ms)}</span>
    </p>
  );
}
