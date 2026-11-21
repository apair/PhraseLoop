import Dexie, { type EntityTable } from 'dexie';
import type { Correction, DailySession, ReviewEvent, ReviewState, SettingRecord } from '../types';

export class PhraseLoopDb extends Dexie {
  corrections!: EntityTable<Correction, 'id'>;
  reviewStates!: EntityTable<ReviewState, 'correctionId'>;
  reviewEvents!: EntityTable<ReviewEvent, 'id'>;
  sessions!: EntityTable<DailySession, 'date'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor(name = 'phraseloop') {
    super(name);
    this.version(1).stores({
      corrections: 'id, sourceOrder',
      reviewStates: 'correctionId, nextDueDate',
      reviewEvents: 'id, correctionId, ratedAt',
      sessions: 'date',
      settings: 'key',
    });
  }
}

export const db = new PhraseLoopDb();

export type Db = PhraseLoopDb;
