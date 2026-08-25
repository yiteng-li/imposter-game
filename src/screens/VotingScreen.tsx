import type { Player } from '../types';

type Props = {
  players: Player[];
  voteIndex: number;
  onVote: (voterId: string, targetId: string) => void;
};

export function VotingScreen({ players, voteIndex, onVote }: Props) {
  const voter = players[voteIndex];
  const isLast = voteIndex === players.length - 1;

  return (
    <div className="screen voting-screen">
      <p className="hint">
        {voteIndex + 1} / {players.length}
      </p>
      <h2>Pass the device to {voter.name}</h2>
      <p className="tagline">Who do you think is the imposter?</p>
      <ul className="vote-list">
        {players.map((p) => (
          <li key={p.id}>
            <button onClick={() => onVote(voter.id, p.id)}>{p.name}</button>
          </li>
        ))}
      </ul>
      {isLast && <p className="hint">Last vote — results after this</p>}
    </div>
  );
}
