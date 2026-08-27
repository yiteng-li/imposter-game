import type { Player, Room } from '../types';
import { wordPacks } from '../wordPacks';

type Props = {
  room: Room;
  players: Player[];
  isHost: boolean;
  onUpdateSettings: (packId: string, imposterCount: number) => void;
  onStart: () => void;
};

export function LobbyScreen({ room, players, isHost, onUpdateSettings, onStart }: Props) {
  const maxImposters = Math.max(1, players.length - 1);
  const packId = room.packId ?? wordPacks[0].id;

  return (
    <div className="screen setup-screen">
      <h1>Room {room.code}</h1>
      <p className="tagline">Tell the others to join with this code.</p>

      <ul className="player-list">
        {players.map((p) => (
          <li key={p.id}>{p.name}</li>
        ))}
      </ul>

      {isHost ? (
        <>
          <label>
            Word pack
            <select value={packId} onChange={(e) => onUpdateSettings(e.target.value, room.imposterCount)}>
              {wordPacks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Imposters
            <input
              type="number"
              min={1}
              max={maxImposters}
              value={room.imposterCount}
              onChange={(e) => onUpdateSettings(packId, Number(e.target.value))}
            />
          </label>

          <button disabled={players.length < 3} onClick={onStart}>
            Start Game
          </button>
          {players.length < 3 && <p className="hint">Add at least 3 players to start</p>}
        </>
      ) : (
        <p className="hint">Waiting for the host to start…</p>
      )}
    </div>
  );
}
