import { useState } from 'react';

type Props = { onCreate: (name: string) => void; onSwitchToJoin: () => void; error?: string | null };

export function CreateRoomScreen({ onCreate, onSwitchToJoin, error }: Props) {
  const [name, setName] = useState('');

  return (
    <div className="screen setup-screen">
      <h1>Blend In</h1>
      <p className="tagline">Everyone gets a word. One of you doesn't. Find them.</p>
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <button disabled={!name.trim()} onClick={() => onCreate(name.trim())}>
        Create Room
      </button>
      {error && <p className="error-message">{error}</p>}
      <button className="link-button" onClick={onSwitchToJoin}>
        Have a code? Join a room
      </button>
    </div>
  );
}
