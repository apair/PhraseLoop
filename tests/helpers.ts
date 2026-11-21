import 'fake-indexeddb/auto';
import { PhraseLoopDb } from '../src/data/db';
import { correctionId } from '../src/lib/identity';
import type { Correction, ReviewState } from '../src/types';

let counter = 0;
export function freshDb(): PhraseLoopDb {
  return new PhraseLoopDb(`test-${Date.now()}-${counter++}`);
}

export async function makeCorrections(n: number, startOrder = 0): Promise<Correction[]> {
  const out: Correction[] = [];
  for (let i = 0; i < n; i++) {
    const corrected = `Corrected sentence ${startOrder + i}`;
    out.push({
      id: await correctionId(corrected),
      sourceOrder: startOrder + i,
      original: `Original ${startOrder + i}`,
      alternatives: `Alt ${startOrder + i}`,
      corrected,
      explanation: `Why ${startOrder + i}`,
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
  }
  return out;
}

export function stateMap(states: ReviewState[]): Map<string, ReviewState> {
  return new Map(states.map((s) => [s.correctionId, s]));
}
