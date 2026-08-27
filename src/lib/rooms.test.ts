import { describe, expect, it } from 'vitest';
import { mapAssignmentRow, mapPlayerRow, mapRoomRow } from './rooms';

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

describe('mapPlayerRow', () => {
  // ready is the reveal-phase readiness signal; it lives on players (not
  // assignments, which RLS hides) so every client can count it.
  it('carries the ready flag through', () => {
    expect(mapPlayerRow({ id: 'p1', room_id: 'r1', name: 'Ada', score: 2, ready: true })).toEqual({
      id: 'p1',
      name: 'Ada',
      score: 2,
      ready: true,
    });
  });
});

describe('mapAssignmentRow', () => {
  it('maps the round card without any readiness field', () => {
    expect(
      mapAssignmentRow({ room_id: 'r1', round_number: 3, player_id: 'p1', is_imposter: false, word: 'lighthouse' }),
    ).toEqual({ roomId: 'r1', roundNumber: 3, playerId: 'p1', isImposter: false, word: 'lighthouse' });
  });
});
