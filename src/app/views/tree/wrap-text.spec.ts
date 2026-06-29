import { describe, it, expect } from 'vitest';
import { wrapToLines } from './wrap-text';

// Deterministic measurer: 10px per character. Avoids canvas in unit tests.
const measure = (s: string) => s.length * 10;

describe('wrapToLines', () => {
  it('keeps a short name on one line', () => {
    expect(wrapToLines('Jose Reyes', measure, 200, 2)).toEqual(['Jose Reyes']);
  });

  it('wraps a long multi-word name onto two lines', () => {
    // 120px budget = 12 chars/line at 10px/char.
    const lines = wrapToLines('Khrista Marie Alexandra Asibal Castuera', measure, 120, 2);
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('Khrista'); // "Khrista Marie" = 13 chars > 12
    expect(lines.every((l) => measure(l) <= 120)).toBe(true);
  });

  it('ellipsizes the last line when content overflows maxLines', () => {
    const lines = wrapToLines('Khrista Marie Alexandra Asibal Castuera', measure, 80, 2);
    expect(lines.length).toBe(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(measure(lines[1])).toBeLessThanOrEqual(80);
  });

  it('hard-truncates a single word longer than the line', () => {
    const lines = wrapToLines('Supercalifragilistic', measure, 80, 2);
    expect(lines.length).toBe(1);
    expect(lines[0].endsWith('…')).toBe(true);
    expect(measure(lines[0])).toBeLessThanOrEqual(80);
  });

  it('returns empty array for blank input', () => {
    expect(wrapToLines('   ', measure, 100, 2)).toEqual([]);
  });
});
