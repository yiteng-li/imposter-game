import { useEffect, useState } from 'react';
import { getSupabaseClient, ensurePlayerId } from '../lib/supabase';
import {
  createRoom,
  joinRoom,
  fetchRoomState,
  updateRoomSettings,
  startRound,
  markReady as markReadyRow,
  maybeAdvanceFromReveal,
  advanceTurn as advanceTurnRow,
  submitVote,
  maybeFinishVoting,
  playAgain as playAgainRow,
  newGame as newGameRow,
  mapAssignmentRow,
  mapVoteRow,
} from '../lib/rooms';
import type { Assignment, Player, Room, Vote } from '../types';

const STORAGE_KEY = 'imposter-game:roomId';

type State =
  | { status: 'loading' }
  | { status: 'no-room' }
  | { status: 'in-room'; me: string; room: Room; players: Player[]; assignments: Assignment[]; votes: Vote[] };

export function useRoom() {
  const [me, setMe] = useState<string | null>(null);
  const [state, setState] = useState<State>({ status: 'loading' });

  // Bootstrap: sign in, then resume a saved room if one exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await ensurePlayerId();
      if (cancelled) return;
      setMe(id);

      const savedRoomId = localStorage.getItem(STORAGE_KEY);
      if (!savedRoomId) {
        setState({ status: 'no-room' });
        return;
      }
      const resumed = await fetchRoomState(savedRoomId);
      if (cancelled) return;
      if (!resumed) {
        localStorage.removeItem(STORAGE_KEY);
        setState({ status: 'no-room' });
        return;
      }
      setState({ status: 'in-room', me: id, room: resumed.room, players: resumed.players, assignments: [], votes: [] });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Realtime subscription, active only once we're in a room.
  useEffect(() => {
    if (state.status !== 'in-room') return;
    const roomId = state.room.id;
    const supabase = getSupabaseClient();

    const refreshRoomAndPlayers = async () => {
      const next = await fetchRoomState(roomId);
      if (!next) {
        localStorage.removeItem(STORAGE_KEY);
        setState({ status: 'no-room' });
        return;
      }
      setState((prev) => (prev.status === 'in-room' ? { ...prev, room: next.room, players: next.players } : prev));
    };

    const refreshAssignments = async () => {
      const { data, error } = await supabase
        .from('assignments')
        .select()
        .eq('room_id', roomId);
      if (error) throw error;
      setState((prev) =>
        prev.status === 'in-room' ? { ...prev, assignments: (data ?? []).map(mapAssignmentRow) } : prev,
      );
    };

    const refreshVotes = async () => {
      const { data, error } = await supabase.from('votes').select().eq('room_id', roomId);
      if (error) throw error;
      setState((prev) => (prev.status === 'in-room' ? { ...prev, votes: (data ?? []).map(mapVoteRow) } : prev));
    };

    // Refetch everything on entry — the synchronous state set by create()/join()
    // only knows about the acting player, not the room's full roster.
    refreshRoomAndPlayers();
    refreshAssignments();
    refreshVotes();

    const channel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, refreshRoomAndPlayers)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, refreshRoomAndPlayers)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments', filter: `room_id=eq.${roomId}` }, refreshAssignments)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: `room_id=eq.${roomId}` }, refreshVotes)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [state.status === 'in-room' ? state.room.id : null]);

  // Distributed auto-advance: watch for reveal/voting completion.
  useEffect(() => {
    if (state.status !== 'in-room') return;
    const { room, players, assignments, votes } = state;

    if (room.phase === 'reveal') {
      const currentRound = assignments.filter((a) => a.roundNumber === room.roundNumber);
      const allReady = currentRound.length === players.length && currentRound.every((a) => a.ready);
      if (allReady) maybeAdvanceFromReveal(room.id, true);
    }

    if (room.phase === 'voting') {
      const currentVotes = votes.filter((v) => v.roundNumber === room.roundNumber);
      maybeFinishVoting(room, players, currentVotes);
    }
  }, [state]);

  if (state.status === 'loading' || me === null) return { status: 'loading' as const };

  if (state.status === 'no-room') {
    return {
      status: 'no-room' as const,
      create: async (name: string) => {
        const { room } = await createRoom(name);
        localStorage.setItem(STORAGE_KEY, room.id);
        setState({ status: 'in-room', me, room, players: [{ id: me, name, score: 0 }], assignments: [], votes: [] });
      },
      join: async (code: string, name: string) => {
        const { room, player } = await joinRoom(code, name);
        localStorage.setItem(STORAGE_KEY, room.id);
        setState({ status: 'in-room', me, room, players: [player], assignments: [], votes: [] });
      },
    };
  }

  const { room, players, assignments, votes } = state;
  const currentAssignments = assignments.filter((a) => a.roundNumber === room.roundNumber);
  const myAssignment = currentAssignments.find((a) => a.playerId === me) ?? null;

  return {
    status: 'in-room' as const,
    me,
    room,
    players,
    assignments: currentAssignments,
    myAssignment,
    readyCount: currentAssignments.filter((a) => a.ready).length,
    votes: votes.filter((v) => v.roundNumber === room.roundNumber),
    isHost: room.hostId === me,
    updateSettings: (packId: string, imposterCount: number) => updateRoomSettings(room.id, packId, imposterCount),
    startRound: () => {
      if (room.hostId !== me) return Promise.resolve();
      return startRound(room, players);
    },
    markReady: () => markReadyRow(room.id, room.roundNumber, me),
    advanceTurn: () => advanceTurnRow(room),
    vote: (targetId: string) => submitVote(room.id, room.roundNumber, me, targetId),
    playAgain: () => {
      if (room.hostId !== me) return Promise.resolve();
      return playAgainRow(room, players);
    },
    newGame: () => {
      if (room.hostId !== me) return Promise.resolve();
      localStorage.removeItem(STORAGE_KEY);
      return newGameRow(room.id);
    },
  };
}
