// End-to-end integration test for the multi-device round lifecycle, run
// against a real local Supabase instance (needs `npx supabase start`).
// Excluded from the default `npm test` run — see vite.config.ts.
//
// This exercises the exact schema/RLS/Realtime contract src/lib/rooms.ts
// relies on, using three independent authenticated clients to simulate
// three separate phones (the app's own module-singleton client can't hold
// three concurrent sessions, so this test performs the same queries
// rooms.ts performs directly, and calls the real, unmodified gameLogic.ts
// functions for the actual game-logic computation). It walks the full
// round lifecycle once: create → join x2 → start → reveal (own-row-only,
// ready) → clue round (turn advance) → voting (votes, CAS to results,
// scoring) → results (full visibility) → play again (fresh round) → new
// game (delete, verified to reach a non-host client's Realtime subscription).
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignRoles, scorePlayers, tallyVotes } from '../gameLogic';
import type { Player } from '../types';

const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function signedInClient(name: string) {
  const client = createClient(LOCAL_URL, LOCAL_ANON_KEY);
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`sign-in failed for ${name}: ${error?.message}`);
  return { client, userId: data.user.id, name };
}

describe('full round lifecycle (live Supabase)', () => {
  let a: Awaited<ReturnType<typeof signedInClient>>;
  let b: Awaited<ReturnType<typeof signedInClient>>;
  let c: Awaited<ReturnType<typeof signedInClient>>;
  let roomId: string;
  const code = `T${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

  beforeAll(async () => {
    a = await signedInClient('Alice');
    b = await signedInClient('Bob');
    c = await signedInClient('Cara');
  });

  afterAll(async () => {
    // Best-effort cleanup in case a test fails before the New Game step deletes it.
    await a.client.from('rooms').delete().eq('id', roomId);
  });

  it('Alice creates a room and becomes host', async () => {
    const { data, error } = await a.client
      .from('rooms')
      .insert({ code, host_id: a.userId, pack_id: 'classic', imposter_count: 1 })
      .select()
      .single();
    expect(error).toBeNull();
    roomId = data.id;
    await a.client.from('players').insert({ id: a.userId, room_id: roomId, name: a.name });
  });

  it('Bob and Cara join by code', async () => {
    const { data: room } = await b.client.from('rooms').select().eq('code', code).single();
    expect(room.id).toBe(roomId);
    await b.client.from('players').insert({ id: b.userId, room_id: roomId, name: b.name });
    await c.client.from('players').insert({ id: c.userId, room_id: roomId, name: c.name });

    const { data: players } = await a.client.from('players').select().eq('room_id', roomId);
    expect(players).toHaveLength(3);
  });

  it('Alice starts the round: assignRoles runs, assignments are inserted, phase flips to reveal', async () => {
    const players: Player[] = [
      { id: a.userId, name: a.name, score: 0, ready: false },
      { id: b.userId, name: b.name, score: 0, ready: false },
      { id: c.userId, name: c.name, score: 0, ready: false },
    ];
    const round = assignRoles(players, { id: 'classic', name: 'Classic', words: ['lighthouse'] }, 1);

    await a.client
      .from('rooms')
      .update({ phase: 'reveal', round_number: 1, turn_order: round.order, turn_index: 0 })
      .eq('id', roomId);
    await a.client.from('assignments').insert(
      players.map((p) => ({
        room_id: roomId,
        round_number: 1,
        player_id: p.id,
        is_imposter: round.imposterIds.includes(p.id),
        word: round.imposterIds.includes(p.id) ? null : round.word,
      })),
    );

    const { data: room } = await a.client.from('rooms').select().eq('id', roomId).single();
    expect(room.phase).toBe('reveal');
  });

  it('reveal: each client sees only their own assignment (RLS), not the others', async () => {
    const { data: aOwn } = await a.client.from('assignments').select().eq('room_id', roomId).eq('player_id', a.userId);
    const { data: aOfB } = await a.client.from('assignments').select().eq('room_id', roomId).eq('player_id', b.userId);
    expect(aOwn).toHaveLength(1);
    expect(aOfB).toHaveLength(0); // the RLS boundary this whole design rests on
  });

  it('ready flow: readiness lives on players (visible to all), advances phase once everyone is ready', async () => {
    await a.client.from('players').update({ ready: true }).eq('id', a.userId);
    await b.client.from('players').update({ ready: true }).eq('id', b.userId);

    let { data: players } = await a.client.from('players').select().eq('room_id', roomId);
    expect(players!.filter((p) => p.ready)).toHaveLength(2); // countable pre-results — this is exactly what C1 fixed

    await c.client.from('players').update({ ready: true }).eq('id', c.userId);
    ({ data: players } = await a.client.from('players').select().eq('room_id', roomId));
    const allReady = players!.every((p) => p.ready);
    expect(allReady).toBe(true);

    // CAS the phase forward, as maybeAdvanceFromReveal would.
    const { data: casResult } = await c.client
      .from('rooms')
      .update({ phase: 'clueRound' })
      .eq('id', roomId)
      .eq('phase', 'reveal')
      .select('id');
    expect(casResult).toHaveLength(1); // exactly one CAS winner
  });

  it('clue round: turn advances, last turn CASes to voting', async () => {
    const { data: room } = await a.client.from('rooms').select().eq('id', roomId).single();
    expect(room.turn_order).toHaveLength(3);

    // Advance through all 3 turns.
    for (let i = 0; i < 2; i++) {
      await a.client.from('rooms').update({ turn_index: i + 1 }).eq('id', roomId).eq('phase', 'clueRound').eq('turn_index', i);
    }
    const { data: casResult } = await a.client
      .from('rooms')
      .update({ phase: 'voting' })
      .eq('id', roomId)
      .eq('phase', 'clueRound')
      .select('id');
    expect(casResult).toHaveLength(1);
  });

  it('voting: votes are visible to everyone mid-vote (not hidden), CAS-and-score on completion', async () => {
    await a.client.from('votes').upsert({ room_id: roomId, round_number: 1, voter_id: a.userId, target_id: b.userId });
    await b.client.from('votes').upsert({ room_id: roomId, round_number: 1, voter_id: b.userId, target_id: c.userId });

    // Cara can see Alice's and Bob's votes before casting her own — no hiding, per spec.
    const { data: votesSoFar } = await c.client.from('votes').select().eq('room_id', roomId).eq('round_number', 1);
    expect(votesSoFar).toHaveLength(2);

    await c.client.from('votes').upsert({ room_id: roomId, round_number: 1, voter_id: c.userId, target_id: b.userId });

    const { data: won } = await b.client
      .from('rooms')
      .update({ phase: 'results', round_scored: true })
      .eq('id', roomId)
      .eq('phase', 'voting')
      .eq('round_scored', false)
      .select('id');
    expect(won).toHaveLength(1);

    // A second, losing CAS attempt from another client must be a no-op.
    const { data: lost } = await a.client
      .from('rooms')
      .update({ phase: 'results', round_scored: true })
      .eq('id', roomId)
      .eq('phase', 'voting')
      .eq('round_scored', false)
      .select('id');
    expect(lost).toHaveLength(0);

    // Compute and apply the real scoring, via the real gameLogic functions.
    const { data: assignmentRows } = await a.client.from('assignments').select().eq('room_id', roomId).eq('round_number', 1);
    const imposterIds = assignmentRows!.filter((r) => r.is_imposter).map((r) => r.player_id);
    const { data: voteRows } = await a.client.from('votes').select().eq('room_id', roomId).eq('round_number', 1);
    const votesRecord = Object.fromEntries(voteRows!.map((v) => [v.voter_id, v.target_id]));
    const { imposterCaught, winners } = tallyVotes(votesRecord, imposterIds);
    expect(winners).toEqual([b.userId]); // 2 votes for Bob beats 1 for Cara
    expect(imposterCaught).toBe(imposterIds[0] === b.userId);

    const players: Player[] = [
      { id: a.userId, name: a.name, score: 0, ready: false },
      { id: b.userId, name: b.name, score: 0, ready: false },
      { id: c.userId, name: c.name, score: 0, ready: false },
    ];
    const scored = scorePlayers(players, imposterIds, imposterCaught);
    for (const p of scored) await a.client.from('players').update({ score: p.score }).eq('id', p.id);

    const { data: scoredPlayers } = await a.client.from('players').select().eq('room_id', roomId);
    const totalPoints = scoredPlayers!.reduce((sum, p) => sum + p.score, 0);
    expect(totalPoints).toBeGreaterThan(0); // someone scored
  });

  it('results: assignments become fully visible to everyone (the C2 refetch scenario)', async () => {
    // This is the exact read C2 fixed the refetch for — assignments only
    // become visible once phase flips to 'results', which just happened.
    // assignRoles picks the imposter randomly, so don't assume who it is —
    // assert the shape (exactly one imposter with no word, others share the word).
    const { data: rows } = await b.client.from('assignments').select().eq('room_id', roomId).eq('round_number', 1);
    expect(rows).toHaveLength(3);
    const imposters = rows!.filter((r) => r.is_imposter);
    const nonImposters = rows!.filter((r) => !r.is_imposter);
    expect(imposters).toHaveLength(1);
    expect(imposters[0].word).toBeNull();
    expect(nonImposters).toHaveLength(2);
    expect(nonImposters.every((r) => r.word === 'lighthouse')).toBe(true);
  });

  it('play again: ready is reset and next round starts clean', async () => {
    // Reset every player's ready flag, matching what startRound does per-player.
    await a.client.from('players').update({ ready: false }).eq('id', a.userId);
    await a.client.from('players').update({ ready: false }).eq('id', b.userId);
    await a.client.from('players').update({ ready: false }).eq('id', c.userId);

    const { data: playersBeforeFlip } = await a.client.from('players').select().eq('room_id', roomId);
    expect(playersBeforeFlip!.every((p) => !p.ready)).toBe(true);

    await a.client.from('rooms').update({ phase: 'reveal', round_number: 2, round_scored: false }).eq('id', roomId);

    await a.client.from('assignments').insert([
      { room_id: roomId, round_number: 2, player_id: a.userId, is_imposter: false, word: 'lighthouse' },
      { room_id: roomId, round_number: 2, player_id: b.userId, is_imposter: true, word: null },
      { room_id: roomId, round_number: 2, player_id: c.userId, is_imposter: false, word: 'lighthouse' },
    ]);

    // Round-2 assignments must NOT be visible to another player while phase is 'reveal' —
    // this is the exact leak the e81fd3e ordering fix prevents.
    const { data: bOfARound2 } = await b.client.from('assignments').select().eq('room_id', roomId).eq('player_id', a.userId).eq('round_number', 2);
    expect(bOfARound2).toHaveLength(0);
  });

  it('new game: deletion succeeds (C3) and the room DELETE event reaches a non-host client via Realtime', async () => {
    const channel = c.client.channel(`room:${roomId}:teardown`);
    const deleteEventSeen = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 12000);
      channel
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms' }, (payload) => {
          if ((payload.old as { id?: string }).id === roomId) {
            clearTimeout(timeout);
            resolve(true);
          }
        })
        .subscribe();
    });

    // Wait for the channel to actually reach SUBSCRIBED before deleting — a
    // fixed sleep can race the WebSocket handshake and produce a false negative.
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('channel never reached SUBSCRIBED')), 8000);
      const check = setInterval(() => {
        if (channel.state === 'joined') {
          clearInterval(check);
          clearTimeout(deadline);
          resolve();
        }
      }, 100);
    });

    const { data, error } = await a.client.from('rooms').delete().eq('id', roomId).select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(1); // the C3 fix: a real row was actually deleted

    const sawDelete = await deleteEventSeen;
    expect(sawDelete).toBe(true); // the exact "does DELETE propagate to other clients" risk the final review flagged as unverified

    const { data: gone } = await a.client.from('rooms').select().eq('id', roomId).maybeSingle();
    expect(gone).toBeNull();
  }, 25000);
});
