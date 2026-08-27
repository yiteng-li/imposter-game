import type { Player } from '../types';
import { tallyVotes } from '../gameLogic';

type Props = {
  players: Player[];
  imposterIds: string[];
  word: string;
  votes: Record<string, string>;
  isHost: boolean;
  onPlayAgain: () => void;
  onNewGame: () => void;
};

export function ResultsScreen({ players, imposterIds, word, votes, isHost, onPlayAgain, onNewGame }: Props) {
  const nameFor = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const { winners, imposterCaught } = tallyVotes(votes, imposterIds);

  return (
    <div className="screen results-screen">
      <h2>The word was: {word}</h2>
      <p>
        Imposter{imposterIds.length > 1 ? 's' : ''}: <span className="result-bad">{imposterIds.map(nameFor).join(', ')}</span>
      </p>
      <p className={imposterCaught ? 'result-good' : 'result-bad'}>
        {imposterCaught
          ? `Caught! The group voted for ${winners.map(nameFor).join(', ')}.`
          : `The imposter got away — the group voted for ${winners.map(nameFor).join(', ') || 'no one clearly'}.`}
      </p>
      <ul className="score-list">
        {[...players]
          .sort((a, b) => b.score - a.score)
          .map((p) => (
            <li key={p.id}>
              {p.name}: {p.score}
            </li>
          ))}
      </ul>
      {isHost ? (
        <div className="results-actions">
          <button onClick={onPlayAgain}>Play Again (same players)</button>
          <button onClick={onNewGame}>New Game</button>
        </div>
      ) : (
        <p className="hint">Waiting for the host…</p>
      )}
    </div>
  );
}
