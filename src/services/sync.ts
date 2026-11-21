import type { Db } from '../data/db';
import { updateSyncStatus } from '../data/settings';
import { parseSheetCsv, type ParseResult } from '../lib/csv';

export class ConfigError extends Error {}

export function getFeedUrl(): string {
  const url = (import.meta.env.VITE_GOOGLE_SHEET_URL as string | undefined)?.trim();
  if (!url || url === 'https://example.com/published-sheet.csv') {
    throw new ConfigError(
      'No sheet feed is configured. Set VITE_GOOGLE_SHEET_URL (see .env.example) and rebuild the app.',
    );
  }
  return url;
}

export interface SyncSummary {
  total: number;
  added: number;
  removed: number;
  duplicates: number;
}

/**
 * Merge a parsed snapshot into the local cache. Existing review state/events
 * are never touched, and corrections missing from the snapshot are flagged
 * (not deleted) so their history survives.
 */
export async function applySnapshot(db: Db, result: ParseResult): Promise<SyncSummary> {
  const incomingIds = new Set(result.corrections.map((c) => c.id));
  return db.transaction('rw', db.corrections, async () => {
    const existing = await db.corrections.toArray();
    const existingIds = new Set(existing.map((c) => c.id));
    const removed = existing.filter((c) => !incomingIds.has(c.id) && !c.removedFromSource);
    await db.corrections.bulkPut(result.corrections);
    if (removed.length > 0) {
      await db.corrections.bulkPut(removed.map((c) => ({ ...c, removedFromSource: true })));
    }
    return {
      total: result.corrections.length,
      added: result.corrections.filter((c) => !existingIds.has(c.id)).length,
      removed: removed.length,
      duplicates: result.duplicates.length,
    };
  });
}

export async function syncCorrections(
  db: Db,
  fetchImpl: typeof fetch = fetch,
  url: string = getFeedUrl(),
): Promise<SyncSummary> {
  const attemptedAt = new Date().toISOString();
  try {
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(
        `The feed responded with HTTP ${response.status}. If this is 401/403 the sheet is not published for public read.`,
      );
    }
    const text = await response.text();
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw new Error('The feed returned a web page instead of CSV. Is the sheet published as CSV?');
    }
    const result = await parseSheetCsv(text, attemptedAt);
    if (result.corrections.length === 0) {
      throw new Error('The feed contained no corrections; keeping the cached data.');
    }
    if (result.duplicates.length > 0) {
      console.info(`[sync] ${result.duplicates.length} duplicate corrected sentence(s) ignored`, result.duplicates);
    }
    const summary = await applySnapshot(db, result);
    await updateSyncStatus(db, {
      lastAttemptAt: attemptedAt,
      lastSuccessAt: attemptedAt,
      lastError: undefined,
      cardCount: summary.total,
    });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncStatus(db, { lastAttemptAt: attemptedAt, lastError: message });
    throw err;
  }
}
