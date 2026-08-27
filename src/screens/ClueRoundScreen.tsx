import type { Player } from '../types';

type Props = {
  players: Player[];
  turnOrder: string[];
  turnIndex: number;
  me: string;
  onNext: () => void;
};

export function ClueRoundScreen({ players, turnOrder, turnIndex, me, onNext }: Props) {
  const playerId = turnOrder[turnIndex];
  const player = players.find((p) => p.id === playerId)!;
  const isMyTurn = playerId === me;
  const isLast = turnIndex === turnOrder.length - 1;

  return (
    <div className="screen clue-screen">
      <p className="hint">
        File {turnIndex + 1} of {turnOrder.length}
      </p>
      <h2>{isMyTurn ? 'Your turn' : `${player.name}'s turn`}</h2>
      {isMyTurn ? (
        <>
          <p className="tagline">Say one word or short clue out loud, then tap Next.</p>
          <button onClick={onNext}>{isLast ? 'Everyone gave a clue — start voting' : 'Next player'}</button>
        </>
      ) : (
        <p className="tagline">Waiting for {player.name}…</p>
      )}
    </div>
  );
}
