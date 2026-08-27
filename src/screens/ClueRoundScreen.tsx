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
  // Roster and turn_order can diverge for a beat while Realtime catches up —
  // don't crash the whole screen over a missing name.
  const name = players.find((p) => p.id === playerId)?.name ?? 'the next player';
  const isMyTurn = playerId === me;
  const isLast = turnIndex === turnOrder.length - 1;

  return (
    <div className="screen clue-screen">
      <p className="hint">
        File {turnIndex + 1} of {turnOrder.length}
      </p>
      <h2>{isMyTurn ? 'Your turn' : `${name}'s turn`}</h2>
      {isMyTurn ? (
        <>
          <p className="tagline">Say one word or short clue out loud, then tap Next.</p>
          <button onClick={onNext}>{isLast ? 'Everyone gave a clue — start voting' : 'Next player'}</button>
        </>
      ) : (
        <p className="tagline">Waiting for {name}…</p>
      )}
    </div>
  );
}
