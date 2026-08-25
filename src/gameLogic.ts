import type { Player, RoundSetup, WordPack } from './types';

export function assignRoles(players: Player[], pack: WordPack, imposterCount: number): RoundSetup {
  if (players.length < 3) throw new Error('Need at least 3 players');
  if (imposterCount < 1 || imposterCount >= players.length) throw new Error('Invalid imposter count');
  const word = pack.words[Math.floor(Math.random() * pack.words.length)];
  const imposterIds = shuffle(players.map((p) => p.id)).slice(0, imposterCount);
  const order = shuffle(players.map((p) => p.id));
  return { word, imposterIds, order };
}

export function tallyVotes(
  votes: Record<string, string>,
  imposterIds: string[],
): { winners: string[]; imposterCaught: boolean } {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  let winners: string[] = [];
  let max = 0;
  for (const [id, count] of counts) {
    if (count > max) {
      max = count;
      winners = [id];
    } else if (count === max) {
      winners.push(id);
    }
  }
  const imposterCaught = winners.length === 1 && imposterIds.includes(winners[0]);
  return { winners, imposterCaught };
}

export function scorePlayers(players: Player[], imposterIds: string[], imposterCaught: boolean): Player[] {
  return players.map((p) => {
    const isImposter = imposterIds.includes(p.id);
    const scored = imposterCaught ? !isImposter : isImposter;
    return scored ? { ...p, score: p.score + 1 } : p;
  });
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
