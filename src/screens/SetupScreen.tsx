import { useState } from 'react';
import type { Player, WordPack } from '../types';
import { wordPacks } from '../wordPacks';

type Props = {
  players: Player[];
  onAddPlayer: (name: string) => void;
  onRemovePlayer: (id: string) => void;
  onStart: (pack: WordPack, imposterCount: number) => void;
};

export function SetupScreen({ players, onAddPlayer, onRemovePlayer, onStart }: Props) {
  const [name, setName] = useState('');
  const [wordPackId, setWordPackId] = useState(wordPacks[0].id);
  const [imposterCount, setImposterCount] = useState(1);
  const maxImposters = Math.max(1, players.length - 1);

  const addPlayer = () => {
    if (!name.trim()) return;
    onAddPlayer(name.trim());
    setName('');
  };

  const pack = wordPacks.find((p) => p.id === wordPackId)!;

  return (
    <div className="screen setup-screen">
      <h1>Blend In</h1>
      <p className="tagline">Everyone gets a word. One of you doesn't. Find them.</p>

      <div className="add-player-row">
        <input
          placeholder="Player name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
        />
        <button onClick={addPlayer} disabled={!name.trim()}>Add</button>
      </div>

      <ul className="player-list">
        {players.map((p) => (
          <li key={p.id}>
            {p.name}
            <button className="remove-btn" onClick={() => onRemovePlayer(p.id)} aria-label={`Remove ${p.name}`}>
              ×
            </button>
          </li>
        ))}
      </ul>

      <label>
        Word pack
        <select value={wordPackId} onChange={(e) => setWordPackId(e.target.value)}>
          {wordPacks.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <label>
        Imposters
        <input
          type="number"
          min={1}
          max={maxImposters}
          value={imposterCount}
          onChange={(e) => setImposterCount(Number(e.target.value))}
        />
      </label>

      <button disabled={players.length < 3} onClick={() => onStart(pack, imposterCount)}>
        Start Game
      </button>
      {players.length < 3 && <p className="hint">Add at least 3 players to start</p>}
    </div>
  );
}
