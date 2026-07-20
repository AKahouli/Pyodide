import type { PlaybookIntentConstructionEvent } from '../types';

export function parsePlaybookConstructionSseBlock(block: string): PlaybookIntentConstructionEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  const event = JSON.parse(data) as PlaybookIntentConstructionEvent;
  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    throw new Error('Construction event has an invalid sequence');
  }
  return event;
}
