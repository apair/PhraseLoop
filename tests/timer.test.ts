import { describe, expect, it } from 'vitest';
import {
  discardOpenInterval,
  elapsedMilliseconds,
  formatDuration,
  pauseTimer,
  resumeTimer,
} from '../src/lib/timer';

const base = { cardIds: ['a', 'b'], completedCardIds: [] as string[], elapsedMs: 1000 };

describe('review timer', () => {
  it('adds only the open interval and pauses without losing closed time', () => {
    const running = { ...base, timerStartedAt: '2026-11-20T17:00:00.000Z' };
    const now = new Date('2026-11-20T17:00:05.000Z');
    expect(elapsedMilliseconds(running, now)).toBe(6000);
    const paused = pauseTimer(running, now);
    expect(paused.elapsedMs).toBe(6000);
    expect(paused.timerStartedAt).toBeUndefined();
    expect(elapsedMilliseconds(paused, new Date('2026-11-20T18:00:00.000Z'))).toBe(6000);
  });

  it('drops an abandoned open interval instead of counting time away from the review', () => {
    const abandoned = discardOpenInterval({ ...base, timerStartedAt: '2026-11-20T17:00:00.000Z' });
    expect(abandoned.elapsedMs).toBe(1000);
    expect(abandoned.timerStartedAt).toBeUndefined();
  });

  it('does not run after the session is complete', () => {
    const done = { ...base, completedCardIds: ['a', 'b'], elapsedMs: 4000, timerStartedAt: '2026-11-20T17:00:00.000Z' };
    const paused = resumeTimer(done, new Date('2026-11-20T17:10:00.000Z'));
    expect(paused.timerStartedAt).toBeUndefined();
    expect(paused.elapsedMs).toBe(4000);
  });

  it('formats durations for the clock', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_661_000)).toBe('1:01:01');
  });
});
