import type { Player, RoundSetup } from '../types';
import { tallyVotes } from '../gameLogic';

type Props = {
  players: Player[];
  round: RoundSetup;
  votes: Record<string, string>;
  onPlayAgain: () => void;
  onNewGame: () => void;
};

export function ResultsScreen({ players, round, votes, onPlayAgain, onNewGame }: Props) {
  const nameFor = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const { winners, imposterCaught } = tallyVotes(votes, round.imposterIds);

  return (
    <div className="screen results-screen">
      <h2>The word was: {round.word}</h2>
      <p>
        Imposter{round.imposterIds.length > 1 ? 's' : ''}:{' '}
        <span className="result-bad">{round.imposterIds.map(nameFor).join(', ')}</span>
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
      <div className="results-actions">
        <button onClick={onPlayAgain}>Play Again (same players)</button>
        <button onClick={onNewGame}>New Game</button>
      </div>
    </div>
  );
}
