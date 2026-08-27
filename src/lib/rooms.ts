import { getSupabaseClient } from './supabase';
import { generateRoomCode } from './roomCode';
import { wordPacks } from '../wordPacks';
import type { Player, Room } from '../types';

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

type PlayerRow = { id: string; room_id: string; name: string; score: number };

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
  return { id: row.id, name: row.name, score: row.score };
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
