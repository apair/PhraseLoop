export type Rating = 'again' | 'hard' | 'easy';
export type Group = 'newest' | 'difficult' | 'older';

export interface Correction {
  /** SHA-256 hex of the normalized corrected sentence. */
  id: string;
  /** Index in the latest sheet snapshot; ascending = newer. */
  sourceOrder: number;
  journalDate?: string;
  original: string;
  alternatives: string;
  corrected: string;
  explanation: string;
  fetchedAt: string;
  /** True when the row no longer exists in the latest sync. History is kept, card is not scheduled. */
  removedFromSource?: boolean;
}

export interface ReviewState {
  correctionId: string;
  reviewCount: number;
  lastReviewedAt?: string;
  lastRating?: Rating;
  /** Local calendar date YYYY-MM-DD. */
  nextDueDate?: string;
  easyStreak: number;
}

export interface ReviewEvent {
  id: string;
  correctionId: string;
  ratedAt: string;
  rating: Rating;
  scheduledDueDate: string;
}

export interface DailySession {
  /** Local calendar day YYYY-MM-DD. */
  date: string;
  cardIds: string[];
  groups: Record<string, Group>;
  completedCardIds: string[];
  currentIndex: number;
  createdAt: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface SyncStatus {
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  cardCount?: number;
}
