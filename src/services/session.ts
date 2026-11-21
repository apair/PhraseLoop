import type { Db } from '../data/db';
import { getInstallationId } from '../data/settings';
import { toLocalDate } from '../lib/dates';
import { applyRating, emptyState } from '../lib/scheduling';
import { buildDailySession, firstUnansweredIndex } from '../lib/selection';
import type { DailySession, Rating, ReviewEvent, ReviewState } from '../types';

/**
 * Return today's frozen session, creating it on first call of the local day.
 * Returns undefined (and persists nothing) when there are no cards yet, so a
 * later sync can still produce a session for the day.
 */
export async function getOrCreateSession(
  db: Db,
  now: Date = new Date(),
): Promise<DailySession | undefined> {
  const today = toLocalDate(now);
  const installationId = await getInstallationId(db);
  return db.transaction('rw', db.sessions, db.corrections, db.reviewStates, async () => {
    const existing = await db.sessions.get(today);
    if (existing) return existing;
    const [corrections, stateList] = await Promise.all([
      db.corrections.toArray(),
      db.reviewStates.toArray(),
    ]);
    const states = new Map(stateList.map((s) => [s.correctionId, s]));
    const session = buildDailySession({ corrections, states, today, installationId, now });
    if (session.cardIds.length === 0) return undefined;
    await db.sessions.put(session);
    return session;
  });
}

export async function peekSession(db: Db, now: Date = new Date()): Promise<DailySession | undefined> {
  return db.sessions.get(toLocalDate(now));
}

/** Persist a rating: state, event and session progress in one transaction. */
export async function rateCard(
  db: Db,
  sessionDate: string,
  correctionId: string,
  rating: Rating,
  now: Date = new Date(),
): Promise<{ session: DailySession; state: ReviewState }> {
  return db.transaction('rw', db.sessions, db.reviewStates, db.reviewEvents, async () => {
    const session = await db.sessions.get(sessionDate);
    if (!session) throw new Error(`No session for ${sessionDate}`);
    if (!session.cardIds.includes(correctionId)) {
      throw new Error('Card is not part of this session');
    }
    const previous = (await db.reviewStates.get(correctionId)) ?? emptyState(correctionId);
    if (session.completedCardIds.includes(correctionId)) {
      return { session, state: previous };
    }

    const { state, dueDate } = applyRating(previous, rating, toLocalDate(now), now.toISOString());
    const event: ReviewEvent = {
      id: crypto.randomUUID(),
      correctionId,
      ratedAt: now.toISOString(),
      rating,
      scheduledDueDate: dueDate,
    };
    const next: DailySession = {
      ...session,
      completedCardIds: [...session.completedCardIds, correctionId],
    };
    next.currentIndex = firstUnansweredIndex(next);
    await db.reviewStates.put(state);
    await db.reviewEvents.add(event);
    await db.sessions.put(next);
    return { session: next, state };
  });
}
