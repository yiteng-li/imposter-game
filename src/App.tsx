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

  if (room.status === 'loading') return null;

  if (room.status === 'no-room') {
    return view === 'create' ? (
      <CreateRoomScreen onCreate={room.create} onSwitchToJoin={() => setView('join')} />
    ) : (
      <JoinRoomScreen onJoin={room.join} onSwitchToCreate={() => setView('create')} />
    );
  }

  const { room: r, players, assignments, myAssignment, readyCount, votes, me, isHost } = room;

  switch (r.phase) {
    case 'setup':
      return (
        <LobbyScreen
          room={r}
          players={players}
          isHost={isHost}
          onUpdateSettings={room.updateSettings}
          onStart={room.startRound}
        />
      );
    case 'reveal':
      if (!myAssignment) return null; // assignment row still loading in from Realtime
      return (
        <RevealScreen myAssignment={myAssignment} totalPlayers={players.length} readyCount={readyCount} onReady={room.markReady} />
      );
    case 'clueRound':
      return (
        <ClueRoundScreen players={players} turnOrder={r.turnOrder} turnIndex={r.turnIndex} me={me} onNext={room.advanceTurn} />
      );
    case 'voting': {
      const myVote = votes.find((v) => v.voterId === me);
      return (
        <VotingScreen players={players} me={me} hasVoted={!!myVote} votesCastCount={votes.length} onVote={room.vote} />
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
          onPlayAgain={room.playAgain}
          onNewGame={room.newGame}
        />
      );
    }
  }
}
