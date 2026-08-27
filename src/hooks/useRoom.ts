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
  | { status: 'error'; message: string }
  | { status: 'in-room'; me: string; room: Room; players: Player[]; assignments: Assignment[]; votes: Vote[] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useRoom() {
  const [me, setMe] = useState<string | null>(null);
  const [state, setState] = useState<State>({ status: 'loading' });

  // Bootstrap: sign in, then resume a saved room if one exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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
      } catch (e) {
        // Missing env vars / failed anonymous sign-in — show it rather than
        // sitting on a blank screen forever.
        if (!cancelled) setState({ status: 'error', message: message(e) });
      }
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

    // These run as Realtime event handlers, where a throw is an unhandled
    // rejection nobody sees — log instead.
    const logged = (name: string, fn: () => Promise<void>) => () =>
      fn().catch((e) => console.error(`useRoom: ${name} failed`, e));

    const refreshRoomAndPlayers = logged('refreshRoomAndPlayers', async () => {
      const next = await fetchRoomState(roomId);
      if (!next) {
        localStorage.removeItem(STORAGE_KEY);
        setState({ status: 'no-room' });
        return;
      }
      setState((prev) => (prev.status === 'in-room' ? { ...prev, room: next.room, players: next.players } : prev));
    });

    const refreshAssignments = logged('refreshAssignments', async () => {
      const { data, error } = await supabase
        .from('assignments')
        .select()
        .eq('room_id', roomId);
      if (error) throw error;
      setState((prev) =>
        prev.status === 'in-room' ? { ...prev, assignments: (data ?? []).map(mapAssignmentRow) } : prev,
      );
    });

    const refreshVotes = logged('refreshVotes', async () => {
      const { data, error } = await supabase.from('votes').select().eq('room_id', roomId);
      if (error) throw error;
      setState((prev) => (prev.status === 'in-room' ? { ...prev, votes: (data ?? []).map(mapVoteRow) } : prev));
    });

    // A phase change touches only the rooms row, but flipping to 'results' is
    // exactly when assignments' RLS unlocks every other player's row — so a
    // rooms change has to refetch assignments too, or results renders stale.
    const onRoomChange = () => {
      refreshRoomAndPlayers();
      refreshAssignments();
    };

    // Refetch everything on entry — the synchronous state set by create()/join()
    // only knows about the acting player, not the room's full roster.
    refreshRoomAndPlayers();
    refreshAssignments();
    refreshVotes();

    const channel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, onRoomChange)
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
    const { room, players, votes } = state;

    if (room.phase === 'reveal') {
      // Readiness is counted off players, not assignments: RLS only ever shows
      // this client its own assignment row before 'results'.
      const allReady = players.length > 0 && players.every((p) => p.ready);
      if (allReady) maybeAdvanceFromReveal(room.id, true).catch((e) => console.error('useRoom: advance failed', e));
    }

    if (room.phase === 'voting') {
      const currentVotes = votes.filter((v) => v.roundNumber === room.roundNumber);
      maybeFinishVoting(room, players, currentVotes).catch((e) => console.error('useRoom: finish voting failed', e));
    }
  }, [state]);

  if (state.status === 'error') return { status: 'error' as const, message: state.message };

  if (state.status === 'loading' || me === null) return { status: 'loading' as const };

  if (state.status === 'no-room') {
    return {
      status: 'no-room' as const,
      create: async (name: string) => {
        const { room, player } = await createRoom(name);
        localStorage.setItem(STORAGE_KEY, room.id);
        setState({ status: 'in-room', me, room, players: [player], assignments: [], votes: [] });
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
    myReady: players.find((p) => p.id === me)?.ready ?? false,
    readyCount: players.filter((p) => p.ready).length,
    votes: votes.filter((v) => v.roundNumber === room.roundNumber),
    isHost: room.hostId === me,
    updateSettings: (packId: string, imposterCount: number) => updateRoomSettings(room.id, packId, imposterCount),
    startRound: () => {
      if (room.hostId !== me) return Promise.resolve();
      return startRound(room, players);
    },
    markReady: () => markReadyRow(me),
    advanceTurn: () => advanceTurnRow(room),
    vote: (targetId: string) => submitVote(room.id, room.roundNumber, me, targetId),
    playAgain: () => {
      if (room.hostId !== me) return Promise.resolve();
      return playAgainRow(room, players);
    },
    newGame: async () => {
      if (room.hostId !== me) return;
      await newGameRow(room.id); // throws if the delete matched nothing
      localStorage.removeItem(STORAGE_KEY);
      setState({ status: 'no-room' });
    },
  };
}
