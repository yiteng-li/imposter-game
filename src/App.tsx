import { useState } from 'react';
import type { Phase, Player, RoundSetup, WordPack } from './types';
import { assignRoles, scorePlayers, tallyVotes } from './gameLogic';
import { SetupScreen } from './screens/SetupScreen';
import { RevealScreen } from './screens/RevealScreen';
import { ClueRoundScreen } from './screens/ClueRoundScreen';
import { VotingScreen } from './screens/VotingScreen';
import { ResultsScreen } from './screens/ResultsScreen';

let nextId = 0;

export default function App() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [players, setPlayers] = useState<Player[]>([]);
  const [pack, setPack] = useState<WordPack | null>(null);
  const [imposterCount, setImposterCount] = useState(1);
  const [round, setRound] = useState<RoundSetup | null>(null);
  const [revealIndex, setRevealIndex] = useState(0);
  const [turnIndex, setTurnIndex] = useState(0);
  const [voteIndex, setVoteIndex] = useState(0);
  const [votes, setVotes] = useState<Record<string, string>>({});

  const addPlayer = (name: string) => {
    setPlayers((prev) => [...prev, { id: `p${nextId++}`, name, score: 0 }]);
  };

  const removePlayer = (id: string) => {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  };

  const startRound = (activePack: WordPack, activeImposterCount: number, activePlayers: Player[]) => {
    setPack(activePack);
    setImposterCount(activeImposterCount);
    setRound(assignRoles(activePlayers, activePack, activeImposterCount));
    setRevealIndex(0);
    setTurnIndex(0);
    setVoteIndex(0);
    setVotes({});
    setPhase('reveal');
  };

  const handleStart = (selectedPack: WordPack, selectedImposterCount: number) => {
    startRound(selectedPack, selectedImposterCount, players);
  };

  const handleRevealNext = () => {
    if (!round) return;
    if (revealIndex + 1 < round.order.length) {
      setRevealIndex(revealIndex + 1);
    } else {
      setPhase('clueRound');
    }
  };

  const handleClueNext = () => {
    if (!round) return;
    if (turnIndex + 1 < round.order.length) {
      setTurnIndex(turnIndex + 1);
    } else {
      setPhase('voting');
    }
  };

  const handleVote = (voterId: string, targetId: string) => {
    const updatedVotes = { ...votes, [voterId]: targetId };
    setVotes(updatedVotes);
    if (voteIndex + 1 < players.length) {
      setVoteIndex(voteIndex + 1);
    } else if (round) {
      const { imposterCaught } = tallyVotes(updatedVotes, round.imposterIds);
      setPlayers(scorePlayers(players, round.imposterIds, imposterCaught));
      setPhase('results');
    }
  };

  const handlePlayAgain = () => {
    if (!pack) return;
    startRound(pack, imposterCount, players);
  };

  const handleNewGame = () => {
    setPlayers([]);
    setPack(null);
    setRound(null);
    setPhase('setup');
  };

  switch (phase) {
    case 'setup':
      return (
        <SetupScreen
          players={players}
          onAddPlayer={addPlayer}
          onRemovePlayer={removePlayer}
          onStart={handleStart}
        />
      );
    case 'reveal':
      return (
        <RevealScreen players={players} round={round!} revealIndex={revealIndex} onNext={handleRevealNext} />
      );
    case 'clueRound':
      return <ClueRoundScreen players={players} round={round!} turnIndex={turnIndex} onNext={handleClueNext} />;
    case 'voting':
      return <VotingScreen players={players} voteIndex={voteIndex} onVote={handleVote} />;
    case 'results':
      return (
        <ResultsScreen
          players={players}
          round={round!}
          votes={votes}
          onPlayAgain={handlePlayAgain}
          onNewGame={handleNewGame}
        />
      );
  }
}
