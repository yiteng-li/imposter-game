import { describe, expect, it } from 'vitest';
import { generateRoomCode } from './roomCode';

describe('generateRoomCode', () => {
  it('returns a 4-character uppercase code', () => {
    expect(generateRoomCode()).toMatch(/^[A-Z]{4}$/);
  });

  it('is not constant across calls', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
