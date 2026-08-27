import type { Player } from '../types';

type Props = {
  players: Player[];
  me: string;
  hasVoted: boolean;
  votesCastCount: number;
  onVote: (targetId: string) => void;
};

export function VotingScreen({ players, me, hasVoted, votesCastCount, onVote }: Props) {
  if (hasVoted) {
    return (
      <div className="screen voting-screen">
        <p className="hint">
          Waiting for everyone to vote… {votesCastCount}/{players.length}
        </p>
      </div>
    );
  }

  return (
    <div className="screen voting-screen">
      <p className="tagline">Who do you think is the imposter?</p>
      <ul className="vote-list">
        {players
          .filter((p) => p.id !== me)
          .map((p) => (
            <li key={p.id}>
              <button onClick={() => onVote(p.id)}>{p.name}</button>
            </li>
          ))}
      </ul>
    </div>
  );
}
