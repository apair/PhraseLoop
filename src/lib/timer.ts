import type { DailySession } from '../types';

export type TimedSession = Pick<DailySession, 'cardIds' | 'completedCardIds' | 'elapsedMs' | 'timerStartedAt'>;

export function isSessionComplete(session: Pick<DailySession, 'cardIds' | 'completedCardIds'>): boolean {
  return session.cardIds.length > 0 && session.completedCardIds.length >= session.cardIds.length;
}

/** Active time so far, including an interval that is still open. */
export function elapsedMilliseconds(session: Pick<DailySession, 'elapsedMs' | 'timerStartedAt'>, now: Date): number {
  const closed = session.elapsedMs ?? 0;
  if (!session.timerStartedAt) return closed;
  const started = Date.parse(session.timerStartedAt);
  if (!Number.isFinite(started)) return closed;
  return closed + Math.max(0, now.getTime() - started);
}

/** Fold an open interval into elapsedMs. A session that is not running is unchanged. */
export function pauseTimer<T extends TimedSession>(session: T, now: Date): T {
  if (!session.timerStartedAt) {
    return session.elapsedMs === undefined ? { ...session, elapsedMs: 0 } : session;
  }
  const next = { ...session, elapsedMs: elapsedMilliseconds(session, now) };
  delete next.timerStartedAt;
  return next;
}

/**
 * Drop an interval left open by a closed page. The time since that timestamp
 * includes time the app was not on screen, so it is not counted.
 */
export function discardOpenInterval<T extends TimedSession>(session: T): T {
  if (!session.timerStartedAt) return session;
  const next = { ...session, elapsedMs: session.elapsedMs ?? 0 };
  delete next.timerStartedAt;
  return next;
}

/** Start a new open interval. A finished session stays stopped. */
export function resumeTimer<T extends TimedSession>(session: T, now: Date): T {
  if (isSessionComplete(session)) return discardOpenInterval(session);
  if (session.timerStartedAt) return session;
  return { ...session, elapsedMs: session.elapsedMs ?? 0, timerStartedAt: now.toISOString() };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

export function formatDurationSpoken(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (hours > 0 || minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}
