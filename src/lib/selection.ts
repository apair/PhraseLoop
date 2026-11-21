import type { Correction, DailySession, Group, ReviewState } from '../types';
import { diffDays, toLocalDate } from './dates';
import { createRng, hashSeed } from './prng';

export const NEWEST_LIMIT = 30;
export const DIFFICULT_LIMIT = 30;
export const OLDER_LIMIT = 30;
export const SESSION_LIMIT = NEWEST_LIMIT + DIFFICULT_LIMIT + OLDER_LIMIT;

/** Staleness assigned to never-reviewed cards so they rank as the stalest. */
export const NEVER_REVIEWED_STALENESS = 100_000;
/** +/- fraction of jitter applied to staleness for the "older" group. */
export const OLDER_JITTER = 0.2;

/**
 * Selection weight for a difficult candidate. Quadratic in overdue days so
 * long-overdue cards are strongly favoured while similarly overdue cards
 * still get varied selection.
 */
export function overdueWeight(overdueDays: number): number {
  const n = 1 + Math.max(0, overdueDays);
  return n * n;
}

/** Efraimidis-Spirakis weighted sampling without replacement. */
export function weightedSample<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  count: number,
  rng: () => number,
): T[] {
  return items
    .map((item) => ({ item, key: Math.pow(rng(), 1 / Math.max(weightOf(item), Number.EPSILON)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((entry) => entry.item);
}

export function stalenessDays(state: ReviewState | undefined, today: string): number {
  if (!state?.lastReviewedAt) return NEVER_REVIEWED_STALENESS;
  return Math.max(0, diffDays(toLocalDate(new Date(state.lastReviewedAt)), today));
}

function isDue(state: ReviewState | undefined, today: string): boolean {
  return !state?.nextDueDate || state.nextDueDate <= today;
}

export interface SelectionInput {
  corrections: readonly Correction[];
  states: ReadonlyMap<string, ReviewState>;
  today: string;
  installationId: string;
  now?: Date;
}

export interface SelectionResult {
  cardIds: string[];
  groups: Record<string, Group>;
}

export function selectDailyCards(input: SelectionInput): SelectionResult {
  const { states, today } = input;
  const rng = createRng(hashSeed(`${today}|${input.installationId}`));
  const pool = input.corrections
    .filter((c) => !c.removedFromSource)
    .slice()
    .sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id));

  const chosen = new Set<string>();
  const cardIds: string[] = [];
  const groups: Record<string, Group> = {};
  const take = (list: readonly Correction[], group: Group) => {
    for (const c of list) {
      if (chosen.has(c.id)) continue;
      chosen.add(c.id);
      cardIds.push(c.id);
      groups[c.id] = group;
    }
  };

  const newest = pool.slice(0, NEWEST_LIMIT);
  take(newest, 'newest');
  const remaining = pool.slice(NEWEST_LIMIT);

  const difficultCandidates = remaining.filter((c) => {
    const s = states.get(c.id);
    return (
      (s?.lastRating === 'again' || s?.lastRating === 'hard') &&
      !!s.nextDueDate &&
      s.nextDueDate <= today
    );
  });
  const difficult = weightedSample(
    difficultCandidates,
    (c) => overdueWeight(diffDays(states.get(c.id)!.nextDueDate!, today)),
    DIFFICULT_LIMIT,
    rng,
  );
  take(difficult, 'difficult');

  // Unused difficult slots are handed to the older group.
  const olderLimit = OLDER_LIMIT + (DIFFICULT_LIMIT - difficult.length);
  const olderCandidates = remaining.filter((c) => !chosen.has(c.id) && isDue(states.get(c.id), today));
  const older = olderCandidates
    .map((c) => ({
      c,
      score: stalenessDays(states.get(c.id), today) * (1 - OLDER_JITTER + 2 * OLDER_JITTER * rng()),
    }))
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id))
    .slice(0, olderLimit)
    .map((x) => x.c);
  take(older, 'older');

  return { cardIds, groups };
}

export function buildDailySession(input: SelectionInput): DailySession {
  const { cardIds, groups } = selectDailyCards(input);
  return {
    date: input.today,
    cardIds,
    groups,
    completedCardIds: [],
    currentIndex: 0,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Index of the first card not yet completed (== cardIds.length when finished). */
export function firstUnansweredIndex(session: Pick<DailySession, 'cardIds' | 'completedCardIds'>): number {
  const done = new Set(session.completedCardIds);
  const idx = session.cardIds.findIndex((id) => !done.has(id));
  return idx === -1 ? session.cardIds.length : idx;
}
