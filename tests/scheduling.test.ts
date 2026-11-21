import { describe, expect, it } from 'vitest';
import { addDays, diffDays, isLocalDate, toLocalDate } from '../src/lib/dates';
import { applyRating, easyInterval, emptyState } from '../src/lib/scheduling';

describe('dates', () => {
  it('adds calendar days across month/year and DST boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 2)).toBe('2026-11-03');
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
  });
  it('diffs and validates', () => {
    expect(diffDays('2026-03-01', '2026-03-11')).toBe(10);
    expect(diffDays('2026-03-11', '2026-03-01')).toBe(-10);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-02-28')).toBe(true);
  });
  it('formats local date from parts', () => {
    expect(toLocalDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('applyRating', () => {
  const at = '2026-11-20T10:00:00.000Z';
  it('again is due tomorrow and resets streak', () => {
    const r = applyRating({ ...emptyState('x'), easyStreak: 3 }, 'again', '2026-11-20', at);
    expect(r.dueDate).toBe('2026-11-21');
    expect(r.state).toMatchObject({ easyStreak: 0, lastRating: 'again', reviewCount: 1 });
  });
  it('hard is due in 2 days and resets streak', () => {
    const r = applyRating({ ...emptyState('x'), easyStreak: 2 }, 'hard', '2026-11-20', at);
    expect(r.dueDate).toBe('2026-11-22');
    expect(r.state.easyStreak).toBe(0);
  });
  it('easy intervals increase on repeated easy and cap at 180', () => {
    let state = emptyState('x');
    const due: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = applyRating(state, 'easy', '2026-01-01', at);
      state = r.state;
      due.push(r.dueDate);
    }
    const days = due.map((d) => diffDays('2026-01-01', d));
    expect(days).toEqual([7, 14, 30, 60, 120, 180, 180, 180]);
    expect(easyInterval(1)).toBe(7);
    expect(state.easyStreak).toBe(8);
  });
});
