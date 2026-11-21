import { describe, expect, it } from 'vitest';
import { parseSheetCsv } from '../src/lib/csv';
import { correctionId, normalizeForId } from '../src/lib/identity';
import { addDays, toLocalDate } from '../src/lib/dates';
import {
  buildExport,
  ImportValidationError,
  previewBackup,
  replaceAllData,
  validateBackup,
} from '../src/services/backup';
import { getOrCreateSession, rateCard } from '../src/services/session';
import { applySnapshot, syncCorrections } from '../src/services/sync';
import { freshDb, makeCorrections } from './helpers';

const HEADER = 'Date,Original,Alternatives,Corrected,Explanation';
const csv = (rows: string[][]) =>
  [HEADER, ...rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(','))].join('\n');
const okFetch = (body: string, status = 200) =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

describe('csv ingestion', () => {
  it('parses rows, keeps blank dates blank, dedupes and skips empty corrections', async () => {
    const text = csv([
      ['2026-11-20', 'o1', 'a1', 'Corrected one.', 'e1'],
      ['', 'o2', 'a2', '  corrected   TWO. ', 'e2'],
      ['', 'o3', 'a3', '', 'e3'],
      ['', 'o4', 'a4', 'Corrected two.', 'e4'],
    ]);
    const r = await parseSheetCsv(text, 'now');
    expect(r.corrections.map((c) => c.corrected)).toEqual(['Corrected one.', 'corrected   TWO.']);
    expect(r.corrections[1].journalDate).toBeUndefined();
    expect(r.corrections.map((c) => c.sourceOrder)).toEqual([0, 1]);
    expect(r.duplicates).toHaveLength(1);
    expect(r.skippedRows).toBe(1);
  });

  it('handles multiline quoted fields and rejects non-csv', async () => {
    const r = await parseSheetCsv(csv([['', 'o', 'a\nb', 'C.', 'e']]), 'now');
    expect(r.corrections[0].alternatives).toBe('a\nb');
    await expect(parseSheetCsv('just one column\nx', 'now')).rejects.toThrow(/did not look like/);
  });

  it('normalizes IDs (NFC, whitespace, case)', async () => {
    expect(normalizeForId('  Caf\u0065\u0301  Au  Lait ')).toBe('caf\u00e9 au lait');
    expect(await correctionId('Hello  World')).toBe(await correctionId(' hello world '));
    expect(await correctionId('Hello World.')).not.toBe(await correctionId('Hello World'));
  });
});

describe('sync', () => {
  it('keeps review state when rows move, treats edits as new cards, flags removals', async () => {
    const db = freshDb();
    await syncCorrections(db, okFetch(csv([['', 'o1', 'a', 'Sentence A.', 'e'], ['', 'o2', 'a', 'Sentence B.', 'e']])), 'http://x');
    const idA = await correctionId('Sentence A.');
    await db.reviewStates.put({ correctionId: idA, reviewCount: 2, easyStreak: 1, nextDueDate: '2026-12-01', lastRating: 'easy' });

    const s = await syncCorrections(
      db,
      okFetch(csv([['', 'new', 'a', 'Sentence N.', 'e'], ['', 'o1', 'a', 'Sentence A.', 'e'], ['', 'o2', 'a', 'Sentence B edited.', 'e']])),
      'http://x',
    );
    expect(s).toMatchObject({ total: 3, added: 2, removed: 1 });
    expect((await db.corrections.get(idA))?.sourceOrder).toBe(1);
    expect(await db.reviewStates.get(idA)).toMatchObject({ reviewCount: 2, nextDueDate: '2026-12-01' });
    const idB = await correctionId('Sentence B.');
    expect((await db.corrections.get(idB))?.removedFromSource).toBe(true);
    expect(await db.corrections.get(await correctionId('Sentence B edited.'))).toBeTruthy();
  });

  it('never erases cache on failures', async () => {
    const db = freshDb();
    await syncCorrections(db, okFetch(csv([['', 'o', 'a', 'Keep me.', 'e']])), 'http://x');
    await expect(syncCorrections(db, okFetch('<!DOCTYPE html><html></html>'), 'http://x')).rejects.toThrow(/web page/);
    await expect(syncCorrections(db, okFetch('', 401), 'http://x')).rejects.toThrow(/401/);
    await expect(syncCorrections(db, okFetch(HEADER), 'http://x')).rejects.toThrow(/no corrections/);
    await expect(syncCorrections(db, (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch, 'http://x')).rejects.toThrow();
    expect(await db.corrections.count()).toBe(1);
    expect((await db.corrections.toArray())[0].removedFromSource).toBeUndefined();
    expect((await db.settings.get('syncStatus'))?.value).toMatchObject({ lastError: 'offline' });
  });
});

describe('session persistence', () => {
  it('freezes the session for the day, resumes at card 41, and applies ratings atomically', async () => {
    const db = freshDb();
    await applySnapshot(db, { corrections: await makeCorrections(200), duplicates: [], skippedRows: 0 });
    const now = new Date(2026, 10, 20, 9, 0);
    const session = (await getOrCreateSession(db, now))!;
    expect(session.cardIds).toHaveLength(90);

    for (const id of session.cardIds.slice(0, 40)) {
      await rateCard(db, session.date, id, 'easy', now);
    }
    await applySnapshot(db, { corrections: await makeCorrections(20, 1000), duplicates: [], skippedRows: 0 });
    const resumed = (await getOrCreateSession(db, new Date(2026, 10, 20, 18, 0)))!;
    expect(resumed.cardIds).toEqual(session.cardIds);
    expect(resumed.currentIndex).toBe(40);
    expect(resumed.completedCardIds).toHaveLength(40);

    const firstId = session.cardIds[0];
    expect(await db.reviewStates.get(firstId)).toMatchObject({ lastRating: 'easy', nextDueDate: addDays('2026-11-20', 7) });
    expect(await db.reviewEvents.count()).toBe(40);

    // double-rating is idempotent
    await rateCard(db, session.date, firstId, 'again', now);
    expect(await db.reviewEvents.count()).toBe(40);
  });

  it('creates a new session on a new day without carrying progress forward', async () => {
    const db = freshDb();
    await applySnapshot(db, { corrections: await makeCorrections(100), duplicates: [], skippedRows: 0 });
    const day1 = (await getOrCreateSession(db, new Date(2026, 10, 20, 9)))!;
    await rateCard(db, day1.date, day1.cardIds[0], 'easy', new Date(2026, 10, 20, 9));
    const day2 = (await getOrCreateSession(db, new Date(2026, 10, 21, 9)))!;
    expect(day2.date).toBe(toLocalDate(new Date(2026, 10, 21)));
    expect(day2.completedCardIds).toEqual([]);
    expect(day2.groups[day1.cardIds[0]]).toBe('newest');
  });

  it('does not persist an empty session', async () => {
    const db = freshDb();
    expect(await getOrCreateSession(db)).toBeUndefined();
    expect(await db.sessions.count()).toBe(0);
  });
});

describe('export / import', () => {
  async function populated() {
    const db = freshDb();
    await applySnapshot(db, { corrections: await makeCorrections(60), duplicates: [], skippedRows: 0 });
    const now = new Date(2026, 10, 20, 9);
    const s = (await getOrCreateSession(db, now))!;
    for (const id of s.cardIds.slice(0, 5)) await rateCard(db, s.date, id, 'hard', now);
    return db;
  }

  it('round-trips reviews, due dates and sessions into another database', async () => {
    const a = await populated();
    const exported = JSON.parse(JSON.stringify(await buildExport(a)));
    const b = freshDb();
    await b.reviewStates.put({ correctionId: 'f'.repeat(64), reviewCount: 9, easyStreak: 0 });
    const validated = await validateBackup(JSON.stringify(exported));
    expect(previewBackup(validated)).toMatchObject({ corrections: 60, reviewStates: 5, reviewEvents: 5, sessions: 1 });
    await replaceAllData(b, validated);
    expect(await b.reviewStates.toArray()).toEqual(await a.reviewStates.toArray());
    expect(await b.reviewEvents.count()).toBe(5);
    expect(await b.corrections.count()).toBe(60);
    expect((await b.sessions.toArray())[0].currentIndex).toBe(5);
  });

  it('rejects invalid JSON, wrong schema, tampered ids and bad dates safely', async () => {
    const a = await populated();
    const good = JSON.parse(JSON.stringify(await buildExport(a)));
    await expect(validateBackup('{nope')).rejects.toThrow(ImportValidationError);
    await expect(validateBackup('[]')).rejects.toThrow(ImportValidationError);
    await expect(validateBackup(JSON.stringify({ ...good, schemaVersion: 99 }))).rejects.toThrow(/schemaVersion/);

    const tampered = structuredClone(good);
    tampered.corrections[0].corrected = 'Something else';
    await expect(validateBackup(JSON.stringify(tampered))).rejects.toThrow(/SHA-256/);

    const badDate = structuredClone(good);
    badDate.reviewStates[0].nextDueDate = '2026-13-45';
    await expect(validateBackup(JSON.stringify(badDate))).rejects.toThrow(/YYYY-MM-DD/);

    const badSession = structuredClone(good);
    badSession.sessions[0].completedCardIds = ['a'.repeat(64)];
    await expect(validateBackup(JSON.stringify(badSession))).rejects.toThrow(/subset/);
  });

  it('rolls back on failure so local data is untouched', async () => {
    const a = await populated();
    const file = await validateBackup(JSON.stringify(await buildExport(a)));
    const b = freshDb();
    await applySnapshot(b, { corrections: await makeCorrections(3), duplicates: [], skippedRows: 0 });
    const broken = { ...file, reviewEvents: [file.reviewEvents[0], file.reviewEvents[0]] };
    await expect(replaceAllData(b, broken)).rejects.toThrow();
    expect(await b.corrections.count()).toBe(3);
  });
});
