import type { Db } from '../data/db';
import { getSheetUrl, updateSyncStatus } from '../data/settings';
import { parseSheetCsv, type ParseResult } from '../lib/csv';

/** Same-origin CSV shipped in public/. Used when no real sheet URL is configured. */
export const SAMPLE_FEED_PATH = '/sample-sheet.csv';

const PLACEHOLDER_FEED = 'https://example.com/published-sheet.csv';

/**
 * A configured sheet URL wins. An empty value or the example placeholder
 * falls back to the bundled sample sheet so the app still runs.
 */
export function resolveFeedUrl(configured: string | undefined): { url: string; sample: boolean } {
  const url = configured?.trim() ?? '';
  if (!url || url === PLACEHOLDER_FEED) return { url: SAMPLE_FEED_PATH, sample: true };
  return { url, sample: false };
}

export class SheetUrlError extends Error {}

/**
 * Empty clears the saved feed. An edit link to a Google Sheet is rewritten to
 * the Sheet1 CSV export. Only https, and http on localhost, are accepted.
 */
export function validateSheetUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === PLACEHOLDER_FEED) return '';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SheetUrlError('Enter a full URL, including https://.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new SheetUrlError('The sheet URL must start with https://.');
  }
  if (url.username || url.password) {
    throw new SheetUrlError('Remove any username or password from the sheet URL.');
  }
  const edit = url.hostname === 'docs.google.com'
    ? url.pathname.match(/^\/spreadsheets(?:\/u\/\d+)?\/d\/([a-zA-Z0-9-_]+)\/(?:edit|view)\/?$/)
    : null;
  if (edit) {
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const gid = url.searchParams.get('gid') ?? hash.get('gid') ?? '0';
    return `https://docs.google.com/spreadsheets/d/${edit[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  }
  return url.toString();
}

/** Saved setting wins. The build-time variable is the fallback, then the sample sheet. */
export async function resolveActiveFeed(db: Db): Promise<{ url: string; sample: boolean }> {
  const saved = await getSheetUrl(db);
  if (saved) return resolveFeedUrl(saved);
  return resolveFeedUrl(import.meta.env.VITE_GOOGLE_SHEET_URL as string | undefined);
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
  url?: string,
): Promise<SyncSummary> {
  const target = url ?? (await resolveActiveFeed(db)).url;
  const attemptedAt = new Date().toISOString();
  try {
    const response = await fetchImpl(target, { cache: 'no-store' });
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
