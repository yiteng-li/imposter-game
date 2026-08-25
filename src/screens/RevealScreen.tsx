import { useState } from 'react';
import type { Player, RoundSetup } from '../types';

type Props = {
  players: Player[];
  round: RoundSetup;
  revealIndex: number;
  onNext: () => void;
};

export function RevealScreen({ players, round, revealIndex, onNext }: Props) {
  const [revealed, setRevealed] = useState(false);
  const playerId = round.order[revealIndex];
  const player = players.find((p) => p.id === playerId)!;
  const isImposter = round.imposterIds.includes(playerId);
  const isLast = revealIndex === round.order.length - 1;

  const next = () => {
    setRevealed(false);
    onNext();
  };

  return (
    <div className="screen reveal-screen">
      <p className="hint">
        {revealIndex + 1} / {round.order.length}
      </p>
      <h2>Pass the device to {player.name}</h2>
      {!revealed ? (
        <button onClick={() => setRevealed(true)}>Tap to reveal your word</button>
      ) : (
        <>
          <div className="reveal-card">
            {isImposter ? <h2>You're the imposter</h2> : <h2>{round.word}</h2>}
          </div>
          <button onClick={next}>{isLast ? "Got it, let's go" : 'Got it, pass to next player'}</button>
        </>
      )}
    </div>
  );
}
