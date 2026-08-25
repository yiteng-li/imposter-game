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
        File {revealIndex + 1} of {round.order.length}
      </p>
      <h2>Pass the device to {player.name}</h2>

      <div className="reveal-card">
        <div className={`redaction-text ${isImposter ? 'is-imposter' : ''}`}>
          {isImposter ? "YOU'RE THE IMPOSTER" : round.word}
        </div>
        <button
          className={`redaction-bar ${revealed ? 'redaction-bar--lifted' : ''}`}
          onClick={() => setRevealed(true)}
          disabled={revealed}
        >
          Tap to declassify
        </button>
      </div>

      {revealed && (
        <button onClick={next}>{isLast ? "Got it, let's go" : 'Got it, pass to next player'}</button>
      )}
    </div>
  );
}
