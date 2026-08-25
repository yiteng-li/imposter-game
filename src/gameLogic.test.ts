import { describe, expect, it } from 'vitest';
import { assignRoles, scorePlayers, tallyVotes } from './gameLogic';
import type { Player, WordPack } from './types';

const pack: WordPack = { id: 'test', name: 'Test', words: ['Apple', 'Banana'] };

function players(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, score: 0 }));
}

describe('assignRoles', () => {
  it('rejects fewer than 3 players', () => {
    expect(() => assignRoles(players(2), pack, 1)).toThrow();
  });

  it('rejects an imposter count that leaves no non-imposters', () => {
    expect(() => assignRoles(players(3), pack, 3)).toThrow();
  });

  it('picks a word from the pack and the requested number of imposters', () => {
    const round = assignRoles(players(4), pack, 2);
    expect(pack.words).toContain(round.word);
    expect(round.imposterIds).toHaveLength(2);
    expect(round.order).toHaveLength(4);
    expect(new Set(round.imposterIds).size).toBe(2);
  });
});

describe('tallyVotes', () => {
  it('reports the imposter caught when every vote lands on them alone', () => {
    const result = tallyVotes({ p0: 'p1', p1: 'p1', p2: 'p1' }, ['p1']);
    expect(result.winners).toEqual(['p1']);
    expect(result.imposterCaught).toBe(true);
  });

  it('reports the imposter not caught on a tie', () => {
    const result = tallyVotes({ p0: 'p1', p1: 'p0' }, ['p1']);
    expect(result.imposterCaught).toBe(false);
  });

  it('reports the imposter not caught when votes land on a non-imposter', () => {
    const result = tallyVotes({ p0: 'p0', p1: 'p0', p2: 'p0' }, ['p1']);
    expect(result.winners).toEqual(['p0']);
    expect(result.imposterCaught).toBe(false);
  });
});

describe('scorePlayers', () => {
  it('awards every non-imposter a point when the imposter is caught', () => {
    const scored = scorePlayers(players(3), ['p1'], true);
    expect(scored.find((p) => p.id === 'p0')?.score).toBe(1);
    expect(scored.find((p) => p.id === 'p1')?.score).toBe(0);
    expect(scored.find((p) => p.id === 'p2')?.score).toBe(1);
  });

  it('awards only the imposter a point when they are not caught', () => {
    const scored = scorePlayers(players(3), ['p1'], false);
    expect(scored.find((p) => p.id === 'p0')?.score).toBe(0);
    expect(scored.find((p) => p.id === 'p1')?.score).toBe(1);
    expect(scored.find((p) => p.id === 'p2')?.score).toBe(0);
  });
});
