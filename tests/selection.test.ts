import { describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/dates';
import { applyRating, emptyState } from '../src/lib/scheduling';
import {
  buildDailySession,
  firstUnansweredIndex,
  overdueWeight,
  selectDailyCards,
} from '../src/lib/selection';
import type { Correction, Rating, ReviewState } from '../src/types';
import { makeCorrections, stateMap } from './helpers';

const TODAY = '2026-11-20';

function reviewed(c: Correction, rating: Rating, due: string, lastReviewed = '2026-10-01T12:00:00'): ReviewState {
  return {
    ...applyRating(emptyState(c.id), rating, TODAY, new Date(lastReviewed).toISOString()).state,
    lastRating: rating,
    nextDueDate: due,
  };
}

const run = (corrections: Correction[], states: ReviewState[], installationId = 'inst') =>
  selectDailyCards({ corrections, states: stateMap(states), today: TODAY, installationId });

describe('daily selection', () => {
  it('picks the 30 newest by sourceOrder regardless of rating or due date', async () => {
    const cs = await makeCorrections(200);
    const states = cs.slice(0, 30).map((c) => reviewed(c, 'easy', addDays(TODAY, 100)));
    const { cardIds, groups } = run(cs, states);
    const newest = cardIds.filter((id) => groups[id] === 'newest');
    expect(newest).toEqual(cs.slice(0, 30).map((c) => c.id));
  });

  it('never duplicates and caps at 90', async () => {
    const cs = await makeCorrections(500);
    const states = cs.slice(30, 200).map((c) => reviewed(c, 'hard', addDays(TODAY, -3)));
    const { cardIds } = run(cs, states);
    expect(cardIds.length).toBe(90);
    expect(new Set(cardIds).size).toBe(90);
  });

  it('limits 45 difficult candidates to 30 with overdue bias and variety', async () => {
    const cs = await makeCorrections(100);
    const candidates = cs.slice(30, 75);
    const overdue = (i: number) => addDays(TODAY, -(i + 1));
    const states = candidates.map((c, i) => reviewed(c, i % 2 ? 'hard' : 'again', overdue(i)));
    const picks = new Map<string, number>();
    const first = new Set<string>();
    const RUNS = 200;
    for (let s = 0; s < RUNS; s++) {
      const { cardIds, groups } = run(cs, states, `inst-${s}`);
      const diff = cardIds.filter((id) => groups[id] === 'difficult');
      expect(diff.length).toBe(30);
      first.add(diff.join());
      for (const id of diff) picks.set(id, (picks.get(id) ?? 0) + 1);
    }
    expect(first.size).toBeGreaterThan(50);
    const mostOverdue = picks.get(candidates[44].id) ?? 0;
    const leastOverdue = picks.get(candidates[0].id) ?? 0;
    expect(mostOverdue).toBeGreaterThan(leastOverdue);
    expect(mostOverdue).toBeGreaterThan(RUNS * 0.9);
  });

  it('excludes difficult cards that are not yet due and hands vacant slots to older', async () => {
    const cs = await makeCorrections(200);
    const states = cs.slice(30, 40).map((c) => reviewed(c, 'hard', addDays(TODAY, 3)));
    const { cardIds, groups } = run(cs, states);
    const ids = new Set(cardIds);
    for (const c of cs.slice(30, 40)) expect(ids.has(c.id)).toBe(false);
    expect(cardIds.filter((id) => groups[id] === 'difficult').length).toBe(0);
    expect(cardIds.filter((id) => groups[id] === 'older').length).toBe(60);
  });

  it('only 5 difficult candidates leaves 55 older slots', async () => {
    const cs = await makeCorrections(300);
    const states = cs.slice(100, 105).map((c) => reviewed(c, 'again', addDays(TODAY, -1)));
    const { cardIds, groups } = run(cs, states);
    expect(cardIds.filter((id) => groups[id] === 'difficult').length).toBe(5);
    expect(cardIds.filter((id) => groups[id] === 'older').length).toBe(55);
    expect(cardIds.length).toBe(90);
  });

  it('does not force future-due cards into older and returns fewer than 90', async () => {
    const cs = await makeCorrections(80);
    const states = cs.slice(30).map((c) => reviewed(c, 'easy', addDays(TODAY, 20)));
    const { cardIds } = run(cs, states);
    expect(cardIds.length).toBe(30);
  });

  it('prefers the stalest due cards for older', async () => {
    const cs = await makeCorrections(100);
    const states = cs.slice(30).map((c, i) =>
      reviewed(c, 'easy', addDays(TODAY, -1), new Date(2026, 0, 1 + i).toISOString()),
    );
    const { cardIds, groups } = run(cs, states);
    const older = cardIds.filter((id) => groups[id] === 'older');
    expect(older.length).toBe(60);
    const stalest = new Set(cs.slice(30, 60).map((c) => c.id));
    const hits = older.filter((id) => stalest.has(id)).length;
    expect(hits).toBeGreaterThanOrEqual(25);
  });

  it('is reproducible for the same date and installation, and varies with installation', async () => {
    const cs = await makeCorrections(300);
    const states = cs.slice(30, 120).map((c) => reviewed(c, 'hard', addDays(TODAY, -2)));
    expect(run(cs, states, 'a')).toEqual(run(cs, states, 'a'));
    expect(run(cs, states, 'a').cardIds).not.toEqual(run(cs, states, 'b').cardIds);
  });

  it('skips corrections removed from source', async () => {
    const cs = await makeCorrections(40);
    cs[0] = { ...cs[0], removedFromSource: true };
    const { cardIds } = run(cs, []);
    expect(cardIds).not.toContain(cs[0].id);
  });

  it('builds a session and finds the first unanswered card', async () => {
    const cs = await makeCorrections(100);
    const s = buildDailySession({ corrections: cs, states: new Map(), today: TODAY, installationId: 'i' });
    expect(s.currentIndex).toBe(0);
    s.completedCardIds = s.cardIds.slice(0, 40);
    expect(firstUnansweredIndex(s)).toBe(40);
  });

  it('overdue weight grows with days overdue', () => {
    expect(overdueWeight(0)).toBe(1);
    expect(overdueWeight(5)).toBeGreaterThan(overdueWeight(2));
    expect(overdueWeight(-3)).toBe(1);
  });
});
