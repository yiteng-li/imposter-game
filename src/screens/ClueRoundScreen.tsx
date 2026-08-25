import type { Player, RoundSetup } from '../types';

type Props = {
  players: Player[];
  round: RoundSetup;
  turnIndex: number;
  onNext: () => void;
};

export function ClueRoundScreen({ players, round, turnIndex, onNext }: Props) {
  const playerId = round.order[turnIndex];
  const player = players.find((p) => p.id === playerId)!;
  const isLast = turnIndex === round.order.length - 1;

  return (
    <div className="screen clue-screen">
      <p className="hint">
        File {turnIndex + 1} of {round.order.length}
      </p>
      <h2>{player.name}'s turn</h2>
      <p className="tagline">Say one word or short clue out loud, then pass it on.</p>
      <button onClick={onNext}>{isLast ? 'Everyone gave a clue — start voting' : 'Next player'}</button>
    </div>
  );
}
