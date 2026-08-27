import { getSupabaseClient } from './supabase';
import { generateRoomCode } from './roomCode';
import { wordPacks } from '../wordPacks';
import type { Player, Room } from '../types';
import { assignRoles, scorePlayers, tallyVotes } from '../gameLogic';
import type { Assignment, Vote } from '../types';

type RoomRow = {
  id: string;
  code: string;
  host_id: string;
  phase: string;
  pack_id: string | null;
  imposter_count: number;
  round_number: number;
  round_scored: boolean;
  turn_order: string[];
  turn_index: number;
};

type PlayerRow = { id: string; room_id: string; name: string; score: number; ready: boolean };

export function mapRoomRow(row: RoomRow): Room {
  return {
    id: row.id,
    code: row.code,
    hostId: row.host_id,
    phase: row.phase as Room['phase'],
    packId: row.pack_id,
    imposterCount: row.imposter_count,
    roundNumber: row.round_number,
    roundScored: row.round_scored,
    turnOrder: row.turn_order,
    turnIndex: row.turn_index,
  };
}

export function mapPlayerRow(row: PlayerRow): Player {
  return { id: row.id, name: row.name, score: row.score, ready: row.ready };
}

async function myId(): Promise<string> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not signed in — call ensurePlayerId() first');
  return session.user.id;
}

export async function createRoom(name: string): Promise<{ room: Room; player: Player }> {
  const supabase = getSupabaseClient();
  const hostId = await myId();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const { data, error } = await supabase
      .from('rooms')
      .insert({ code, host_id: hostId, pack_id: wordPacks[0].id, imposter_count: 1 })
      .select()
      .single();
    if (!error) {
      const room = mapRoomRow(data as RoomRow);
      const player = await insertSelfAsPlayer(room.id, hostId, name);
      return { room, player };
    }
    if (error.code !== '23505') throw error; // not a unique-code collision — rethrow
  }
  throw new Error('Could not generate a unique room code after 5 attempts');
}

export async function joinRoom(code: string, name: string): Promise<{ room: Room; player: Player }> {
  const supabase = getSupabaseClient();
  const id = await myId();

  const { data: roomRow, error: roomError } = await supabase
    .from('rooms')
    .select()
    .eq('code', code.toUpperCase())
    .maybeSingle();
  if (roomError) throw roomError;
  if (!roomRow) throw new Error(`No room found for code ${code.toUpperCase()}`);

  const room = mapRoomRow(roomRow as RoomRow);
  // Joining mid-round would raise the "everyone's ready/voted" target past what
  // the round can ever reach, wedging the room — and the joiner has no assignment.
  if (room.phase !== 'setup') throw new Error('That game has already started — ask them to start a new one.');

  const player = await insertSelfAsPlayer(room.id, id, name);
  return { room, player };
}

async function insertSelfAsPlayer(roomId: string, id: string, name: string): Promise<Player> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('players')
    .insert({ id, room_id: roomId, name })
    .select()
    .single();
  if (error) throw error;
  return mapPlayerRow(data as PlayerRow);
}

export async function fetchRoomState(roomId: string): Promise<{ room: Room; players: Player[] } | null> {
  const supabase = getSupabaseClient();
  const { data: roomRow, error: roomError } = await supabase.from('rooms').select().eq('id', roomId).maybeSingle();
  if (roomError) throw roomError;
  if (!roomRow) return null;

  const { data: playerRows, error: playersError } = await supabase.from('players').select().eq('room_id', roomId);
  if (playersError) throw playersError;

  return { room: mapRoomRow(roomRow as RoomRow), players: (playerRows as PlayerRow[]).map(mapPlayerRow) };
}

export async function updateRoomSettings(roomId: string, packId: string, imposterCount: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('rooms')
    .update({ pack_id: packId, imposter_count: imposterCount })
    .eq('id', roomId);
  if (error) throw error;
}

type AssignmentRow = {
  room_id: string;
  round_number: number;
  player_id: string;
  is_imposter: boolean;
  word: string | null;
};

type VoteRow = { room_id: string; round_number: number; voter_id: string; target_id: string };

export function mapAssignmentRow(row: AssignmentRow): Assignment {
  return {
    roomId: row.room_id,
    roundNumber: row.round_number,
    playerId: row.player_id,
    isImposter: row.is_imposter,
    word: row.word,
  };
}

export function mapVoteRow(row: VoteRow): Vote {
  return { roomId: row.room_id, roundNumber: row.round_number, voterId: row.voter_id, targetId: row.target_id };
}

async function casPhase(roomId: string, from: string, to: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('rooms')
    .update({ phase: to, ...extra })
    .eq('id', roomId)
    .eq('phase', from)
    .select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function startRound(room: Room, players: Player[]): Promise<void> {
  const pack = wordPacks.find((p) => p.id === room.packId) ?? wordPacks[0];
  const round = assignRoles(players, pack, room.imposterCount);
  const roundNumber = room.roundNumber + 1;

  const supabase = getSupabaseClient();

  // players.ready persists across rounds (unlike assignments, which get a fresh
  // row per round), so it must be cleared before the phase flips to 'reveal' —
  // otherwise every client sees leftover "everyone ready" and skips the reveal.
  const { error: readyError } = await supabase.from('players').update({ ready: false }).eq('room_id', room.id);
  if (readyError) throw readyError;

  // Phase before assignments, and never the other way round: assignments' RLS
  // opens up completely while phase is 'results', so inserting the new round's
  // rows first would let every client fetch everyone's card for the round that
  // hasn't started yet. Clients briefly render nothing until their row lands.
  const { error: roomError } = await supabase
    .from('rooms')
    .update({
      phase: 'reveal',
      round_number: roundNumber,
      round_scored: false,
      turn_order: round.order,
      turn_index: 0,
    })
    .eq('id', room.id);
  if (roomError) throw roomError;

  const rows = players.map((p) => ({
    room_id: room.id,
    round_number: roundNumber,
    player_id: p.id,
    is_imposter: round.imposterIds.includes(p.id),
    word: round.imposterIds.includes(p.id) ? null : round.word,
  }));
  const { error: assignError } = await supabase.from('assignments').insert(rows);
  if (assignError) throw assignError;
}

export const playAgain = startRound;

export async function markReady(playerId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('players').update({ ready: true }).eq('id', playerId);
  if (error) throw error;
}

export async function maybeAdvanceFromReveal(roomId: string, allReady: boolean): Promise<void> {
  if (allReady) await casPhase(roomId, 'reveal', 'clueRound');
}

/** Returns false when the update matched nothing — i.e. this client's view of the turn was stale. */
export async function advanceTurn(room: Room): Promise<boolean> {
  const isLast = room.turnIndex + 1 >= room.turnOrder.length;
  if (isLast) return casPhase(room.id, 'clueRound', 'voting');

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('rooms')
    .update({ turn_index: room.turnIndex + 1 })
    .eq('id', room.id)
    .eq('phase', 'clueRound')
    .eq('turn_index', room.turnIndex)
    .select('id');
  if (error) throw error;
  const advanced = (data?.length ?? 0) > 0;
  if (!advanced) console.warn(`advanceTurn: no-op, turn ${room.turnIndex} was already advanced elsewhere`);
  return advanced;
}

export async function submitVote(roomId: string, roundNumber: number, voterId: string, targetId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('votes')
    .upsert({ room_id: roomId, round_number: roundNumber, voter_id: voterId, target_id: targetId });
  if (error) throw error;
}

export async function maybeFinishVoting(room: Room, players: Player[], votes: Vote[]): Promise<void> {
  if (votes.length < players.length) return;

  const won = await casPhase(room.id, 'voting', 'results', { round_scored: true });
  if (!won) return; // another client already finished this round

  const supabase = getSupabaseClient();
  const { data: assignmentRows, error } = await supabase
    .from('assignments')
    .select()
    .eq('room_id', room.id)
    .eq('round_number', room.roundNumber);
  if (error) throw error;
  const imposterIds = (assignmentRows as AssignmentRow[]).filter((a) => a.is_imposter).map((a) => a.player_id);

  const votesRecord = Object.fromEntries(votes.map((v) => [v.voterId, v.targetId]));
  const { imposterCaught } = tallyVotes(votesRecord, imposterIds);
  const scored = scorePlayers(players, imposterIds, imposterCaught);

  for (const p of scored) {
    const { error: scoreError } = await supabase.from('players').update({ score: p.score }).eq('id', p.id);
    if (scoreError) throw scoreError;
  }
}

export async function newGame(roomId: string): Promise<void> {
  const supabase = getSupabaseClient();
  // .select() so an RLS policy that blocks the delete fails loudly instead of
  // returning success with zero rows affected.
  const { data, error } = await supabase.from('rooms').delete().eq('id', roomId).select('id');
  if (error) throw error;
  if ((data?.length ?? 0) === 0) throw new Error('Could not delete the room — you may no longer be a member of it.');
}
