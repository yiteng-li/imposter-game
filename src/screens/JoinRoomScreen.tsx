import { useState } from 'react';

type Props = { onJoin: (code: string, name: string) => void; onSwitchToCreate: () => void; error?: string | null };

export function JoinRoomScreen({ onJoin, onSwitchToCreate, error }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  return (
    <div className="screen setup-screen">
      <h1>Join a room</h1>
      <input
        placeholder="Room code"
        value={code}
        maxLength={4}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <button disabled={code.trim().length !== 4 || !name.trim()} onClick={() => onJoin(code.trim(), name.trim())}>
        Join
      </button>
      {error && <p className="error-message">{error}</p>}
      <button className="link-button" onClick={onSwitchToCreate}>
        Create a room instead
      </button>
    </div>
  );
}
