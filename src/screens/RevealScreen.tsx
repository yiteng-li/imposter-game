import { useState } from 'react';
import type { Assignment } from '../types';

type Props = {
  myAssignment: Assignment;
  myReady: boolean;
  totalPlayers: number;
  readyCount: number;
  onReady: () => void;
};

export function RevealScreen({ myAssignment, myReady, totalPlayers, readyCount, onReady }: Props) {
  const [tapped, setTapped] = useState(false);

  const declassify = () => setTapped(true);
  const gotIt = () => onReady();

  if (myReady) {
    return (
      <div className="screen reveal-screen">
        <p className="hint">
          Waiting for everyone… {readyCount}/{totalPlayers} ready
        </p>
      </div>
    );
  }

  return (
    <div className="screen reveal-screen">
      <h2>Your card</h2>
      <div className="reveal-card">
        <div className={`redaction-text ${myAssignment.isImposter ? 'is-imposter' : ''}`}>
          {myAssignment.isImposter ? "YOU'RE THE IMPOSTER" : myAssignment.word}
        </div>
        <button className={`redaction-bar ${tapped ? 'redaction-bar--lifted' : ''}`} onClick={declassify} disabled={tapped}>
          Tap to declassify
        </button>
      </div>
      {tapped && <button onClick={gotIt}>Got it</button>}
    </div>
  );
}
