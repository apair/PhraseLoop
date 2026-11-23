import type { Db } from '../data/db';
import { isLocalDate } from '../lib/dates';
import { correctionId, ID_PATTERN } from '../lib/identity';
import type { Correction, DailySession, ReviewEvent, ReviewState } from '../types';

export const SCHEMA_VERSION = 1;

export interface BackupFile {
  schemaVersion: number;
  exportedAt: string;
  corrections: Correction[];
  reviewStates: ReviewState[];
  reviewEvents: ReviewEvent[];
  sessions: DailySession[];
}

export async function buildExport(db: Db): Promise<BackupFile> {
  const [corrections, reviewStates, reviewEvents, sessions] = await Promise.all([
    db.corrections.toArray(),
    db.reviewStates.toArray(),
    db.reviewEvents.toArray(),
    db.sessions.toArray(),
  ]);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    corrections,
    reviewStates,
    reviewEvents,
    sessions,
  };
}

export class ImportValidationError extends Error {}

const RATINGS = new Set(['again', 'hard', 'easy']);
const GROUPS = new Set(['newest', 'difficult', 'older']);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isIso = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
const optStr = (v: unknown) => v === undefined || isStr(v);

function fail(path: string, msg: string): never {
  throw new ImportValidationError(`${path}: ${msg}`);
}

function arrayOf(file: Record<string, unknown>, key: string): unknown[] {
  const v = file[key];
  if (!Array.isArray(v)) fail(key, 'must be an array');
  return v;
}

/** Validate untrusted JSON text; never touches the database. */
export async function validateBackup(text: string): Promise<BackupFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportValidationError('The file is not valid JSON.');
  }
  if (!isObj(raw)) fail('file', 'must be a JSON object');
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    fail('schemaVersion', `unsupported (expected ${SCHEMA_VERSION}, got ${String(raw.schemaVersion)})`);
  }
  if (!isIso(raw.exportedAt)) fail('exportedAt', 'must be an ISO timestamp');

  const corrections = arrayOf(raw, 'corrections').map((c, i): Correction => {
    const p = `corrections[${i}]`;
    if (!isObj(c)) fail(p, 'must be an object');
    if (!isStr(c.id) || !ID_PATTERN.test(c.id)) fail(`${p}.id`, 'must be a SHA-256 hex string');
    if (!isStr(c.corrected) || !c.corrected.trim()) fail(`${p}.corrected`, 'must be a non-empty string');
    if (!isInt(c.sourceOrder)) fail(`${p}.sourceOrder`, 'must be a non-negative integer');
    if (!isStr(c.original) || !isStr(c.alternatives) || !isStr(c.explanation)) {
      fail(p, 'original, alternatives and explanation must be strings');
    }
    if (!optStr(c.journalDate)) fail(`${p}.journalDate`, 'must be a string');
    if (!isIso(c.fetchedAt)) fail(`${p}.fetchedAt`, 'must be an ISO timestamp');
    if (c.removedFromSource !== undefined && typeof c.removedFromSource !== 'boolean') {
      fail(`${p}.removedFromSource`, 'must be a boolean');
    }
    return c as unknown as Correction;
  });

  const ids = new Set<string>();
  for (const [i, c] of corrections.entries()) {
    if (ids.has(c.id)) fail(`corrections[${i}].id`, 'duplicate id');
    ids.add(c.id);
    if ((await correctionId(c.corrected)) !== c.id) {
      fail(`corrections[${i}].id`, 'does not match the SHA-256 of the corrected sentence');
    }
  }

  const stateIds = new Set<string>();
  const reviewStates = arrayOf(raw, 'reviewStates').map((s, i): ReviewState => {
    const p = `reviewStates[${i}]`;
    if (!isObj(s)) fail(p, 'must be an object');
    if (!isStr(s.correctionId) || !ID_PATTERN.test(s.correctionId)) fail(`${p}.correctionId`, 'invalid id');
    if (stateIds.has(s.correctionId)) fail(`${p}.correctionId`, 'duplicate state');
    stateIds.add(s.correctionId);
    if (!isInt(s.reviewCount) || !isInt(s.easyStreak)) fail(p, 'reviewCount and easyStreak must be non-negative integers');
    if (s.lastReviewedAt !== undefined && !isIso(s.lastReviewedAt)) fail(`${p}.lastReviewedAt`, 'invalid timestamp');
    if (s.lastRating !== undefined && !(isStr(s.lastRating) && RATINGS.has(s.lastRating))) fail(`${p}.lastRating`, 'invalid rating');
    if (s.nextDueDate !== undefined && !isLocalDate(s.nextDueDate)) fail(`${p}.nextDueDate`, 'must be YYYY-MM-DD');
    return s as unknown as ReviewState;
  });

  const eventIds = new Set<string>();
  const reviewEvents = arrayOf(raw, 'reviewEvents').map((e, i): ReviewEvent => {
    const p = `reviewEvents[${i}]`;
    if (!isObj(e)) fail(p, 'must be an object');
    if (!isStr(e.id) || !e.id) fail(`${p}.id`, 'must be a non-empty string');
    if (eventIds.has(e.id)) fail(`${p}.id`, 'duplicate event id');
    eventIds.add(e.id);
    if (!isStr(e.correctionId) || !ID_PATTERN.test(e.correctionId)) fail(`${p}.correctionId`, 'invalid id');
    if (!isIso(e.ratedAt)) fail(`${p}.ratedAt`, 'invalid timestamp');
    if (!(isStr(e.rating) && RATINGS.has(e.rating))) fail(`${p}.rating`, 'invalid rating');
    if (!isLocalDate(e.scheduledDueDate)) fail(`${p}.scheduledDueDate`, 'must be YYYY-MM-DD');
    return e as unknown as ReviewEvent;
  });

  const sessions = (raw.sessions === undefined ? [] : arrayOf(raw, 'sessions')).map((s, i): DailySession => {
    const p = `sessions[${i}]`;
    if (!isObj(s)) fail(p, 'must be an object');
    if (!isLocalDate(s.date)) fail(`${p}.date`, 'must be YYYY-MM-DD');
    const cardIds = s.cardIds;
    const completed = s.completedCardIds;
    if (!Array.isArray(cardIds) || !cardIds.every((id) => isStr(id) && ID_PATTERN.test(id))) fail(`${p}.cardIds`, 'must be an array of ids');
    if (new Set(cardIds).size !== cardIds.length) fail(`${p}.cardIds`, 'contains duplicates');
    if (!Array.isArray(completed) || !completed.every((id) => isStr(id) && cardIds.includes(id))) fail(`${p}.completedCardIds`, 'must be a subset of cardIds');
    const groups = s.groups;
    if (!isObj(groups) || !cardIds.every((id) => GROUPS.has(groups[id] as string))) fail(`${p}.groups`, 'must map every card to a valid group');
    if (!isInt(s.currentIndex) || s.currentIndex > cardIds.length) fail(`${p}.currentIndex`, 'out of range');
    if (!isIso(s.createdAt)) fail(`${p}.createdAt`, 'invalid timestamp');
    if (s.elapsedMs !== undefined && !isInt(s.elapsedMs)) fail(`${p}.elapsedMs`, 'must be a non-negative integer');
    if (s.timerStartedAt !== undefined && !isIso(s.timerStartedAt)) fail(`${p}.timerStartedAt`, 'invalid timestamp');
    return s as unknown as DailySession;
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: raw.exportedAt,
    corrections,
    reviewStates,
    reviewEvents,
    sessions,
  };
}

export interface ImportPreview {
  corrections: number;
  reviewStates: number;
  reviewEvents: number;
  sessions: number;
  exportedAt: string;
}

export function previewBackup(file: BackupFile): ImportPreview {
  return {
    corrections: file.corrections.length,
    reviewStates: file.reviewStates.length,
    reviewEvents: file.reviewEvents.length,
    sessions: file.sessions.length,
    exportedAt: file.exportedAt,
  };
}

/** Replace all local records atomically (single transaction; rolls back on error). */
export async function replaceAllData(db: Db, file: BackupFile): Promise<void> {
  await db.transaction('rw', db.corrections, db.reviewStates, db.reviewEvents, db.sessions, async () => {
    await Promise.all([
      db.corrections.clear(),
      db.reviewStates.clear(),
      db.reviewEvents.clear(),
      db.sessions.clear(),
    ]);
    await db.corrections.bulkAdd(file.corrections);
    await db.reviewStates.bulkAdd(file.reviewStates);
    await db.reviewEvents.bulkAdd(file.reviewEvents);
    await db.sessions.bulkAdd(file.sessions);
  });
}
