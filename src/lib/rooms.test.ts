import { describe, expect, it } from 'vitest';
import { mapRoomRow } from './rooms';

describe('mapRoomRow', () => {
  it('maps snake_case columns to the camelCase Room type', () => {
    const room = mapRoomRow({
      id: 'r1',
      code: 'ABCD',
      host_id: 'p1',
      phase: 'setup',
      pack_id: 'classic',
      imposter_count: 1,
      round_number: 0,
      round_scored: false,
      turn_order: [],
      turn_index: 0,
    });
    expect(room).toEqual({
      id: 'r1',
      code: 'ABCD',
      hostId: 'p1',
      phase: 'setup',
      packId: 'classic',
      imposterCount: 1,
      roundNumber: 0,
      roundScored: false,
      turnOrder: [],
      turnIndex: 0,
    });
  });
});
