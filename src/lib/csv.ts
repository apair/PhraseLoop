import Papa from 'papaparse';
import type { Correction } from '../types';
import { correctionId } from './identity';

export interface ParseResult {
  corrections: Correction[];
  duplicates: { id: string; corrected: string; row: number }[];
  skippedRows: number;
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Parse the published Sheet1 CSV. Columns: A journal date, B original,
 * C alternatives, D corrected, E explanation. Row 1 is the header.
 * Row order is the recency signal (first row = newest).
 */
export async function parseSheetCsv(text: string, fetchedAt: string): Promise<ParseResult> {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  const rows = parsed.data;
  if (rows.length === 0 || (rows[0]?.length ?? 0) < 4) {
    throw new Error(
      'The feed did not look like the corrections sheet (expected CSV with at least columns A-D). ' +
        'Check that the sheet is published as CSV.',
    );
  }

  const byId = new Map<string, Correction>();
  const duplicates: ParseResult['duplicates'] = [];
  let skippedRows = 0;
  let order = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const corrected = clean(row[3]);
    if (!corrected) {
      skippedRows++;
      continue;
    }
    const id = await correctionId(corrected);
    if (byId.has(id)) {
      duplicates.push({ id, corrected, row: i + 1 });
      continue;
    }
    const journalDate = clean(row[0]);
    byId.set(id, {
      id,
      sourceOrder: order++,
      ...(journalDate ? { journalDate } : {}),
      original: clean(row[1]),
      alternatives: clean(row[2]),
      corrected,
      explanation: clean(row[4]),
      fetchedAt,
    });
  }

  return { corrections: [...byId.values()], duplicates, skippedRows };
}
