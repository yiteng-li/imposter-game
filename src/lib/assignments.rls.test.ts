// src/lib/assignments.rls.test.ts
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Supabase CLI's well-known local-only demo anon key (printed by `supabase start`;
// only valid against 127.0.0.1, not a secret).
const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function signedInClient() {
  const client = createClient(LOCAL_URL, LOCAL_ANON_KEY);
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`sign-in failed: ${error?.message}`);
  return { client, userId: data.user.id };
}

describe('assignments RLS', () => {
  let roomId: string;
  let a: Awaited<ReturnType<typeof signedInClient>>;
  let b: Awaited<ReturnType<typeof signedInClient>>;

  beforeAll(async () => {
    a = await signedInClient();
    b = await signedInClient();

    // A fixed code collides with itself on a second run against a persistent
    // local DB (rooms.code is unique, and nothing here used to clean up after
    // itself) — random per run, like full-round.integration.test.ts.
    const code = `R${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const { data: room, error: roomError } = await a.client
      .from('rooms')
      .insert({ code, host_id: a.userId })
      .select()
      .single();
    if (roomError) throw roomError;
    roomId = room.id;

    await a.client.from('players').insert({ id: a.userId, room_id: roomId, name: 'A' });
    await b.client.from('players').insert({ id: b.userId, room_id: roomId, name: 'B' });

    await a.client.from('assignments').insert([
      { room_id: roomId, round_number: 1, player_id: a.userId, is_imposter: false, word: 'lighthouse' },
      { room_id: roomId, round_number: 1, player_id: b.userId, is_imposter: true, word: null },
    ]);
  });

  afterAll(async () => {
    await a.client.from('rooms').delete().eq('id', roomId);
  });

  it('cannot read another player\'s assignment before results', async () => {
    const { data } = await a.client
      .from('assignments')
      .select('*')
      .eq('room_id', roomId)
      .eq('player_id', b.userId);
    expect(data).toEqual([]);
  });

  it('can read its own assignment', async () => {
    const { data } = await a.client
      .from('assignments')
      .select('*')
      .eq('room_id', roomId)
      .eq('player_id', a.userId);
    expect(data).toHaveLength(1);
    expect(data![0].word).toBe('lighthouse');
  });

  it('can read every assignment once the room reaches results', async () => {
    await a.client.from('rooms').update({ phase: 'results' }).eq('id', roomId);

    const { data } = await a.client
      .from('assignments')
      .select('*')
      .eq('room_id', roomId)
      .eq('player_id', b.userId);
    expect(data).toHaveLength(1);
    expect(data![0].is_imposter).toBe(true);
  });
});

describe('players DELETE RLS (leave room)', () => {
  let roomId: string;
  let a: Awaited<ReturnType<typeof signedInClient>>;
  let b: Awaited<ReturnType<typeof signedInClient>>;

  beforeAll(async () => {
    a = await signedInClient();
    b = await signedInClient();

    const code = `L${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const { data: room, error: roomError } = await a.client
      .from('rooms')
      .insert({ code, host_id: a.userId })
      .select()
      .single();
    if (roomError) throw roomError;
    roomId = room.id;

    await a.client.from('players').insert({ id: a.userId, room_id: roomId, name: 'A' });
    await b.client.from('players').insert({ id: b.userId, room_id: roomId, name: 'B' });
  });

  afterAll(async () => {
    await a.client.from('rooms').delete().eq('id', roomId);
  });

  it('cannot delete another player\'s row', async () => {
    const { data } = await a.client.from('players').delete().eq('id', b.userId).select('id');
    expect(data).toEqual([]); // RLS silently matches zero rows, not an error
  });

  it('can delete its own row', async () => {
    const { data } = await b.client.from('players').delete().eq('id', b.userId).select('id');
    expect(data).toHaveLength(1);

    const { data: remaining } = await a.client.from('players').select().eq('room_id', roomId);
    expect(remaining).toHaveLength(1);
    expect(remaining![0].id).toBe(a.userId);
  });
});
