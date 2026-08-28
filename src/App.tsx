import { useState } from 'react';
import { useRoom } from './hooks/useRoom';
import { CreateRoomScreen } from './screens/CreateRoomScreen';
import { JoinRoomScreen } from './screens/JoinRoomScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { RevealScreen } from './screens/RevealScreen';
import { ClueRoundScreen } from './screens/ClueRoundScreen';
import { VotingScreen } from './screens/VotingScreen';
import { ResultsScreen } from './screens/ResultsScreen';

export default function App() {
  const room = useRoom();
  const [view, setView] = useState<'create' | 'join'>('create');
  const [error, setError] = useState<string | null>(null);

  // Every action is fire-and-forget from an onClick; without this its rejection
  // goes nowhere and the button just looks broken.
  function guard<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
    return (...args: A) => {
      setError(null);
      fn(...args).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    };
  }

  if (room.status === 'loading') return null;

  if (room.status === 'error') {
    return (
      <div className="screen setup-screen">
        <h1>Blend In</h1>
        <p className="error-message">{room.message}</p>
      </div>
    );
  }

  if (room.status === 'no-room') {
    const switchTo = (next: 'create' | 'join') => () => {
      setError(null);
      setView(next);
    };
    return view === 'create' ? (
      <CreateRoomScreen onCreate={guard(room.create)} onSwitchToJoin={switchTo('join')} error={error} />
    ) : (
      <JoinRoomScreen onJoin={guard(room.join)} onSwitchToCreate={switchTo('create')} error={error} />
    );
  }

  const { room: r, players, assignments, myAssignment, myReady, readyCount, votes, me, isHost } = room;

  const screen = (() => {
    switch (r.phase) {
      case 'setup':
        return (
          <LobbyScreen
            room={r}
            players={players}
            isHost={isHost}
            onUpdateSettings={guard(room.updateSettings)}
            onStart={guard(room.startRound)}
          />
        );
      case 'reveal':
        if (!myAssignment) return null; // assignment row still loading in from Realtime
        return (
          <RevealScreen
            myAssignment={myAssignment}
            myReady={myReady}
            totalPlayers={players.length}
            readyCount={readyCount}
            onReady={guard(room.markReady)}
          />
        );
      case 'clueRound':
        return (
          <ClueRoundScreen
            players={players}
            turnOrder={r.turnOrder}
            turnIndex={r.turnIndex}
            me={me}
            onNext={guard(room.advanceTurn)}
          />
        );
      case 'voting': {
        const myVote = votes.find((v) => v.voterId === me);
        return (
          <VotingScreen
            players={players}
            me={me}
            hasVoted={!!myVote}
            votesCastCount={votes.length}
            onVote={guard(room.vote)}
          />
        );
      }
      case 'results': {
        const imposterIds = assignments.filter((a) => a.isImposter).map((a) => a.playerId);
        const word = assignments.find((a) => !a.isImposter)?.word ?? '';
        const votesRecord = Object.fromEntries(votes.map((v) => [v.voterId, v.targetId]));
        return (
          <ResultsScreen
            players={players}
            imposterIds={imposterIds}
            word={word}
            votes={votesRecord}
            isHost={isHost}
            onPlayAgain={guard(room.playAgain)}
            onNewGame={guard(room.newGame)}
          />
        );
      }
    }
  })();

  // Every phase can be left; hosts can also end the room outright. Results
  // already has its own equivalent "New Game" button (the same room.newGame
  // action), so skip the duplicate control there.
  return (
    <>
      {error && <p className="error-message">{error}</p>}
      {screen}
      <div className="room-bar">
        <button onClick={guard(room.leaveRoom)}>Leave</button>
        {isHost && r.phase !== 'results' && <button onClick={guard(room.newGame)}>End Game</button>}
      </div>
    </>
  );
}
