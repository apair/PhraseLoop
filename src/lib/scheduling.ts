import type { Rating, ReviewState } from '../types';
import { addDays } from './dates';

export const EASY_INTERVALS_DAYS = [7, 14, 30, 60, 120, 180] as const;
export const AGAIN_INTERVAL_DAYS = 1;
export const HARD_INTERVAL_DAYS = 2;

export function easyInterval(streak: number): number {
  const idx = Math.min(Math.max(streak, 1) - 1, EASY_INTERVALS_DAYS.length - 1);
  return EASY_INTERVALS_DAYS[idx];
}

export function emptyState(correctionId: string): ReviewState {
  return { correctionId, reviewCount: 0, easyStreak: 0 };
}

export interface RatingResult {
  state: ReviewState;
  dueDate: string;
}

/** Pure scheduling step. `today` is the local calendar date of the rating. */
export function applyRating(
  previous: ReviewState,
  rating: Rating,
  today: string,
  ratedAtIso: string,
): RatingResult {
  let easyStreak = 0;
  let interval: number;
  if (rating === 'again') {
    interval = AGAIN_INTERVAL_DAYS;
  } else if (rating === 'hard') {
    interval = HARD_INTERVAL_DAYS;
  } else {
    easyStreak = previous.easyStreak + 1;
    interval = easyInterval(easyStreak);
  }
  const dueDate = addDays(today, interval);
  return {
    dueDate,
    state: {
      correctionId: previous.correctionId,
      reviewCount: previous.reviewCount + 1,
      lastReviewedAt: ratedAtIso,
      lastRating: rating,
      nextDueDate: dueDate,
      easyStreak,
    },
  };
}
