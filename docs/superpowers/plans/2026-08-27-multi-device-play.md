# Multi-Device Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each player join a round from their own phone via a short room code, replacing "pass one device around," while keeping the game itself unchanged (same room, spoken-aloud clues).

**Architecture:** A `rooms`/`players`/`assignments`/`votes` schema in Supabase Postgres, guarded by Row-Level Security so a phone can only ever read its own imposter/word assignment until the round ends. Every phase transition after Start is a client-issued compare-and-swap (CAS) `UPDATE ... WHERE phase = '<expected>'`, so simultaneous writes from multiple phones collapse into one. A thin data layer (`src/lib/rooms.ts`) wraps all reads/writes; a React hook (`src/hooks/useRoom.ts`) subscribes to Realtime and exposes one state object each screen renders from.

**Tech Stack:** Existing Vite + React 19 + TypeScript + Vitest app, adding `@supabase/supabase-js` and the Supabase CLI (via `npx supabase`) for local Postgres + Realtime + anonymous auth. No new UI/state libraries.

**Spec:** `docs/superpowers/specs/2026-08-27-multi-device-play-design.md`

## Global Constraints

- `gameLogic.ts` (`assignRoles`, `tallyVotes`, `scorePlayers`) is not modified — every task calls it unchanged.
- Same-room trust model: RLS only needs to hide `assignments` rows (the real secret) and confirm "you're a member of this room." It does not need to stop a room member from tampering with their own client — see the spec's Non-goals.
- **Host-only gating for Start / Play again / New game is enforced in the application layer**, not RLS: `src/lib/rooms.ts` checks `room.hostId === myId` before issuing those writes, and the UI only shows the buttons to the host. RLS's `rooms` UPDATE policy only requires "caller is a member of this room" — expressing "only for this specific transition" as a row-security policy needs OLD/NEW comparison that plain RLS doesn't have without a trigger, and the trust model doesn't call for that complexity. (This is a precision-add on top of the spec, not a contradiction of it.)
- Vote targets are visible to the whole room at all times, including mid-vote — no hiding, per spec.
- No disconnect/timeout/kick mechanism in v1 — a stalled room (someone never readies/votes) is a known, accepted limitation.
- Room codes are 4 uppercase letters (`A`–`Z`), regenerated on collision.

---

### Task 1: Supabase client + env scaffolding

**Files:**
- Create: `src/lib/supabase.ts`
- Create: `src/lib/supabase.test.ts`
- Create: `.env.local.example`
- Modify: `package.json` (add `@supabase/supabase-js`)

**Interfaces:**
- Produces: `getSupabaseClient(): SupabaseClient` — lazily creates and caches the client, throws a clear `Error` if `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing.
- Produces: `ensurePlayerId(): Promise<string>` — returns the current anonymous-auth user id, signing in anonymously if there's no session yet.

- [ ] **Step 1: Install the dependency**

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/lib/supabase.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getSupabaseClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws a clear error when env vars are missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const { getSupabaseClient } = await import('./supabase');
    expect(() => getSupabaseClient()).toThrow(/VITE_SUPABASE_URL/);
  });

  it('returns a client when env vars are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    const { getSupabaseClient } = await import('./supabase');
    expect(getSupabaseClient()).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/lib/supabase.test.ts`
Expected: FAIL — `src/lib/supabase.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// src/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.local.example to .env.local and fill them in.',
    );
  }
  client = createClient(url, anonKey);
  return client;
}

export async function ensurePlayerId(): Promise<string> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) return session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(`Anonymous sign-in failed: ${error?.message ?? 'unknown error'}`);
  }
  return data.user.id;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/lib/supabase.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Add the env example file**

```bash
# .env.local.example
# For local dev against `npx supabase start` (see Task 2), use:
#   VITE_SUPABASE_URL=http://127.0.0.1:54321
#   VITE_SUPABASE_ANON_KEY=<the "anon key" the CLI prints on start>
# For a hosted project, use the values from Project Settings > API.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/supabase.ts src/lib/supabase.test.ts .env.local.example
git commit -m "feat: add Supabase client with env-var validation"
```

---

### Task 2: Database schema, RLS policies, and local Supabase project

**Files:**
- Create: `supabase/config.toml` (generated)
- Create: `supabase/migrations/0001_multi_device_play.sql`

**Interfaces:**
- Produces: the `rooms`, `players`, `assignments`, `votes` tables and their RLS policies that every later task's queries depend on. Column names are the source of truth for the row-mapping types in Task 4.

- [ ] **Step 1: Initialize the local Supabase project**

```bash
npx supabase init
```

Expected: creates `supabase/config.toml` and a `supabase/migrations/` directory. Commit the generated `config.toml` as-is.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/0001_multi_device_play.sql

create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_id uuid not null,
  phase text not null default 'setup',
  pack_id text,
  imposter_count int not null default 1,
  round_number int not null default 0,
  round_scored boolean not null default false,
  turn_order uuid[] not null default '{}',
  turn_index int not null default 0,
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  score int not null default 0,
  joined_at timestamptz not null default now()
);

create table assignments (
  room_id uuid not null references rooms(id) on delete cascade,
  round_number int not null,
  player_id uuid not null references players(id) on delete cascade,
  is_imposter boolean not null,
  word text,
  ready boolean not null default false,
  primary key (room_id, round_number, player_id)
);

create table votes (
  room_id uuid not null references rooms(id) on delete cascade,
  round_number int not null,
  voter_id uuid not null references players(id) on delete cascade,
  target_id uuid not null references players(id),
  primary key (room_id, round_number, voter_id)
);

alter table rooms enable row level security;
alter table players enable row level security;
alter table assignments enable row level security;
alter table votes enable row level security;

-- rooms: readable by anyone (needed to look up a room by code before joining);
-- writable only by a member of that room. Host-only gating for specific
-- transitions (Start, Play again) is enforced in application code — see
-- Global Constraints in the implementation plan.
create policy "rooms are publicly readable" on rooms
  for select using (true);

create policy "authenticated users can create rooms" on rooms
  for insert with check (auth.uid() = host_id);

create policy "room members can update room" on rooms
  for update
  using (auth.uid() in (select id from players where players.room_id = rooms.id))
  with check (auth.uid() in (select id from players where players.room_id = rooms.id));

-- players: names/scores aren't secret.
create policy "players are publicly readable" on players
  for select using (true);

create policy "players insert themselves" on players
  for insert with check (auth.uid() = id);

create policy "room members can update player scores" on players
  for update
  using (auth.uid() in (select id from players p2 where p2.room_id = players.room_id))
  with check (auth.uid() in (select id from players p2 where p2.room_id = players.room_id));

-- assignments: the only real secret. Own row only, until the round is over.
create policy "own row, or room is past voting" on assignments
  for select
  using (
    player_id = auth.uid()
    or exists (
      select 1 from rooms
      where rooms.id = assignments.room_id
        and rooms.phase = 'results'
    )
  );

create policy "room members can insert assignments" on assignments
  for insert
  with check (auth.uid() in (select id from players where players.room_id = assignments.room_id));

create policy "mark only your own row ready" on assignments
  for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

-- votes: not secret, readable by anyone in the room at any time.
create policy "votes are readable by anyone" on votes
  for select using (true);

create policy "cast your own vote" on votes
  for insert with check (voter_id = auth.uid());

create policy "change your own vote" on votes
  for update
  using (voter_id = auth.uid())
  with check (voter_id = auth.uid());

-- Realtime: these are the tables every screen subscribes to.
alter publication supabase_realtime add table rooms, players, assignments, votes;
```

- [ ] **Step 3: Start the local stack and apply the migration**

```bash
npx supabase start
```

Expected: pulls/starts local Postgres + Realtime + Auth containers, then prints an API URL (`http://127.0.0.1:54321`) and an `anon key`. Copy both into `.env.local` (created from `.env.local.example`).

Migrations in `supabase/migrations/` apply automatically on `start`. If you edit the migration after the first `start`, apply it with:

```bash
npx supabase db reset
```

- [ ] **Step 4: Smoke-check the schema**

```bash
npx supabase db execute --sql "select table_name from information_schema.tables where table_schema = 'public' order by 1;"
```

Expected: lists `assignments`, `players`, `rooms`, `votes`.

- [ ] **Step 5: Commit**

```bash
git add supabase/
git commit -m "feat: add Supabase schema, RLS policies, and local project config"
```

Note: `.env.local` itself is already gitignored (`.env*` in `.gitignore`) — do not add it.

---

### Task 3: RLS integration test for `assignments`

**Files:**
- Create: `src/lib/assignments.rls.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient()` from Task 1, run against the local instance from Task 2.
- Verifies the one real security boundary the whole design rests on, per the spec's Testing section.

Requires `npx supabase start` (Task 2) running locally. This test talks to the real local Postgres — it's an integration test, not a unit test, and is not part of the default `npm test` fast loop; run it explicitly.

- [ ] **Step 1: Write the test**

```typescript
// src/lib/assignments.rls.test.ts
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

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

    const { data: room, error: roomError } = await a.client
      .from('rooms')
      .insert({ code: 'TEST', host_id: a.userId })
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
```

- [ ] **Step 2: Run it against the local stack**

Run: `npx supabase start` (if not already running), then `npm test -- src/lib/assignments.rls.test.ts`
Expected: PASS (3 tests). If the first assertion fails (player A *can* see player B's row), the RLS policy from Task 2 isn't applied — re-run `npx supabase db reset` and try again.

- [ ] **Step 3: Commit**

```bash
git add src/lib/assignments.rls.test.ts
git commit -m "test: verify assignments RLS hides other players' roles until results"
```

---

### Task 4: Room code generator

**Files:**
- Create: `src/lib/roomCode.ts`
- Create: `src/lib/roomCode.test.ts`

**Interfaces:**
- Produces: `generateRoomCode(): string` — a 4-character uppercase-letter code, used by Task 6's `createRoom`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/roomCode.test.ts
import { describe, expect, it } from 'vitest';
import { generateRoomCode } from './roomCode';

describe('generateRoomCode', () => {
  it('returns a 4-character uppercase code', () => {
    expect(generateRoomCode()).toMatch(/^[A-Z]{4}$/);
  });

  it('is not constant across calls', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/roomCode.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/roomCode.ts
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  }
  return code;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/roomCode.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/roomCode.ts src/lib/roomCode.test.ts
git commit -m "feat: add room code generator"
```

---

### Task 5: Extend shared types

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `Room`, `Assignment`, `Vote` types that Tasks 6–13 all import.
- Consumes: nothing new — `Player`, `WordPack`, `Phase` are unchanged and reused as-is.

- [ ] **Step 1: Add the types**

```typescript
// Append to src/types.ts

export type Room = {
  id: string;
  code: string;
  hostId: string;
  phase: Phase;
  packId: string | null;
  imposterCount: number;
  roundNumber: number;
  roundScored: boolean;
  turnOrder: string[];
  turnIndex: number;
};

export type Assignment = {
  roomId: string;
  roundNumber: number;
  playerId: string;
  isImposter: boolean;
  word: string | null;
  ready: boolean;
};

export type Vote = {
  roomId: string;
  roundNumber: number;
  voterId: string;
  targetId: string;
};
```

No test — this is a pure type addition with no runtime behavior; TypeScript's own compiler is the check (`npm run build` in Task 13 will fail if a later task misuses these).

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Room, Assignment, Vote types"
```

---

### Task 6: Data layer — room creation, joining, and settings

**Files:**
- Create: `src/lib/rooms.ts`

**Interfaces:**
- Consumes: `getSupabaseClient` (Task 1), `generateRoomCode` (Task 4), `Room`/`Player` types (Task 5), `wordPacks` from `src/wordPacks.ts`.
- Produces: `createRoom(name: string): Promise<{ room: Room; player: Player }>`, `joinRoom(code: string, name: string): Promise<{ room: Room; player: Player }>`, `fetchRoomState(roomId: string): Promise<{ room: Room; players: Player[] } | null>`, `updateRoomSettings(roomId: string, packId: string, imposterCount: number): Promise<void>`, plus the row-mapper `mapRoomRow` used by Task 7's realtime subscriptions.

This task's queries are exercised for real in Task 8's manual verification (no local Supabase mocking exists in this codebase — see the spec's Testing section) — but Step 1 below still gives each pure mapper its own fast unit test.

- [ ] **Step 1: Write the failing test for the row mapper**

```typescript
// src/lib/rooms.test.ts
import { describe, expect, it } from 'vitest';
import { mapRoomRow } from './rooms';

describe('mapRoomRow', () => {
  it('maps snake_case columns to the camelCase Room type', () => {
    const room = mapRoomRow({
      id: 'r1',
      code: 'ABCD',
      host_id: 'p1',
      phase: 'setup',
      pack_id: 'classic',
      imposter_count: 1,
      round_number: 0,
      round_scored: false,
      turn_order: [],
      turn_index: 0,
    });
    expect(room).toEqual({
      id: 'r1',
      code: 'ABCD',
      hostId: 'p1',
      phase: 'setup',
      packId: 'classic',
      imposterCount: 1,
      roundNumber: 0,
      roundScored: false,
      turnOrder: [],
      turnIndex: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/rooms.test.ts`
Expected: FAIL — `src/lib/rooms.ts` doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/rooms.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/rooms.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/rooms.ts src/lib/rooms.test.ts
git commit -m "feat: add room creation, joining, and settings data layer"
```

---

### Task 7: Data layer — round actions (start, ready, turns, voting, scoring)

**Files:**
- Modify: `src/lib/rooms.ts`

**Interfaces:**
- Consumes: `assignRoles`, `tallyVotes`, `scorePlayers` from `../gameLogic` (unchanged); `mapRoomRow`/`mapPlayerRow`, `Room`/`Player`/`Assignment`/`Vote` types.
- Produces: `startRound(room: Room, players: Player[]): Promise<void>`, `markReady(roomId: string, roundNumber: number, playerId: string): Promise<void>`, `maybeAdvanceFromReveal(roomId: string, allReady: boolean): Promise<void>`, `advanceTurn(room: Room): Promise<void>`, `submitVote(roomId: string, roundNumber: number, voterId: string, targetId: string): Promise<void>`, `maybeFinishVoting(room: Room, players: Player[], votes: Vote[]): Promise<void>`, `playAgain(room: Room, players: Player[]): Promise<void>`, `newGame(roomId: string): Promise<void>`.

`startRound`/`playAgain` do **not** check `room.hostId` themselves — per Global Constraints, that check lives in `useRoom` (Task 8) right where `myId` is already known, so `rooms.ts` stays a plain data layer with no notion of "who's calling."

- [ ] **Step 1: Append the implementation** (no new failing test — this task's logic is exercised by the manual two-tab verification in Task 8, consistent with the spec's Testing section, which scoped automated coverage to `gameLogic.ts` and the RLS boundary only)

```typescript
// Append to src/lib/rooms.ts
import { assignRoles, scorePlayers, tallyVotes } from '../gameLogic';
import type { Assignment, Vote } from '../types';

type AssignmentRow = {
  room_id: string;
  round_number: number;
  player_id: string;
  is_imposter: boolean;
  word: string | null;
  ready: boolean;
};

type VoteRow = { room_id: string; round_number: number; voter_id: string; target_id: string };

export function mapAssignmentRow(row: AssignmentRow): Assignment {
  return {
    roomId: row.room_id,
    roundNumber: row.round_number,
    playerId: row.player_id,
    isImposter: row.is_imposter,
    word: row.word,
    ready: row.ready,
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
    ready: false,
  }));
  const { error: assignError } = await supabase.from('assignments').insert(rows);
  if (assignError) throw assignError;
}

export const playAgain = startRound;

export async function markReady(roomId: string, roundNumber: number, playerId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('assignments')
    .update({ ready: true })
    .eq('room_id', roomId)
    .eq('round_number', roundNumber)
    .eq('player_id', playerId);
  if (error) throw error;
}

export async function maybeAdvanceFromReveal(roomId: string, allReady: boolean): Promise<void> {
  if (allReady) await casPhase(roomId, 'reveal', 'clueRound');
}

export async function advanceTurn(room: Room): Promise<void> {
  const isLast = room.turnIndex + 1 >= room.turnOrder.length;
  if (isLast) {
    await casPhase(room.id, 'clueRound', 'voting');
    return;
  }
  const supabase = getSupabaseClient();
  await supabase
    .from('rooms')
    .update({ turn_index: room.turnIndex + 1 })
    .eq('id', room.id)
    .eq('phase', 'clueRound')
    .eq('turn_index', room.turnIndex);
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
  const { error } = await supabase.from('rooms').delete().eq('id', roomId);
  if (error) throw error;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rooms.ts
git commit -m "feat: add round-action data layer (start, ready, turns, voting, scoring)"
```

---

### Task 8: `useRoom` hook

**Files:**
- Create: `src/hooks/useRoom.ts`

**Interfaces:**
- Consumes: everything from `src/lib/rooms.ts` (Tasks 6–7), `ensurePlayerId` (Task 1), `Room`/`Player`/`Assignment`/`Vote` types (Task 5).
- Produces the discriminated union every screen in Tasks 9–12 and `App.tsx` (Task 13) renders from:

```typescript
type RoomHookState =
  | { status: 'loading' }
  | { status: 'no-room'; create: (name: string) => Promise<void>; join: (code: string, name: string) => Promise<void> }
  | {
      status: 'in-room';
      me: string;
      room: Room;
      players: Player[];
      assignments: Assignment[]; // all rows for the current round — only your own are populated until phase 'results', per RLS
      myAssignment: Assignment | null;
      readyCount: number; // count of assignments.ready === true for the current round
      votes: Vote[];
      isHost: boolean;
      updateSettings: (packId: string, imposterCount: number) => Promise<void>;
      startRound: () => Promise<void>;
      markReady: () => Promise<void>;
      advanceTurn: () => Promise<void>;
      vote: (targetId: string) => Promise<void>;
      playAgain: () => Promise<void>;
      newGame: () => Promise<void>;
    };
```

Persists the current room id in `localStorage` under key `imposter-game:roomId` so a refresh resumes the same room instead of dropping back to the join screen.

- [ ] **Step 1: Write the implementation**

No unit test for this task — it's React-plus-Realtime wiring with no existing mocking pattern in this repo (see spec's Testing section, which scoped this kind of glue to manual verification). Step 2 is the verification.

```typescript
// src/hooks/useRoom.ts
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
  mapRoomRow,
  mapPlayerRow,
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
```

- [ ] **Step 2: Manual verification**

1. Ensure `npx supabase start` (Task 2) is running and `.env.local` points at it.
2. `npm run dev`, open the URL in two browser windows (or one normal + one incognito, so they get different anonymous sessions).
3. In window 1, call `create('Alice')` (temporarily wire a button in `App.tsx` if Task 13 hasn't landed yet, or test this via Task 13 directly — see that task's verification instead if sequencing this way is awkward).
4. Confirm window 1 shows `status: 'in-room'`, `isHost: true`, and a room code.
5. In window 2, `join(code, 'Bob')` — confirm window 1's `players` list updates to include Bob without a manual refresh (Realtime working).

This step is easiest to actually run once Task 13 wires the hook into real screens — treat Step 2 here as "keep in mind while building Task 13," and do the concrete pass there.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRoom.ts
git commit -m "feat: add useRoom hook wiring Realtime subscriptions and actions"
```

---

### Task 9: Lobby, create-room, and join-room screens

**Files:**
- Create: `src/screens/CreateRoomScreen.tsx`
- Create: `src/screens/JoinRoomScreen.tsx`
- Create: `src/screens/LobbyScreen.tsx`
- Delete: `src/screens/SetupScreen.tsx` (superseded — its player-list-building and pack/imposter-count UI move into `LobbyScreen`)

**Interfaces:**
- Consumes: the `no-room` and `in-room` (while `room.phase === 'setup'`) shapes from Task 8's `useRoom`.
- Produces: three components `App.tsx` (Task 13) renders directly.

- [ ] **Step 1: `CreateRoomScreen`**

```typescript
// src/screens/CreateRoomScreen.tsx
import { useState } from 'react';

type Props = { onCreate: (name: string) => void; onSwitchToJoin: () => void };

export function CreateRoomScreen({ onCreate, onSwitchToJoin }: Props) {
  const [name, setName] = useState('');

  return (
    <div className="screen setup-screen">
      <h1>Blend In</h1>
      <p className="tagline">Everyone gets a word. One of you doesn't. Find them.</p>
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <button disabled={!name.trim()} onClick={() => onCreate(name.trim())}>
        Create Room
      </button>
      <button className="link-button" onClick={onSwitchToJoin}>
        Have a code? Join a room
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `JoinRoomScreen`**

```typescript
// src/screens/JoinRoomScreen.tsx
import { useState } from 'react';

type Props = { onJoin: (code: string, name: string) => void; onSwitchToCreate: () => void };

export function JoinRoomScreen({ onJoin, onSwitchToCreate }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  return (
    <div className="screen setup-screen">
      <h1>Join a room</h1>
      <input
        placeholder="Room code"
        value={code}
        maxLength={4}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <button disabled={code.trim().length !== 4 || !name.trim()} onClick={() => onJoin(code.trim(), name.trim())}>
        Join
      </button>
      <button className="link-button" onClick={onSwitchToCreate}>
        Create a room instead
      </button>
    </div>
  );
}
```

- [ ] **Step 3: `LobbyScreen`**

```typescript
// src/screens/LobbyScreen.tsx
import type { Player, Room } from '../types';
import { wordPacks } from '../wordPacks';

type Props = {
  room: Room;
  players: Player[];
  isHost: boolean;
  onUpdateSettings: (packId: string, imposterCount: number) => void;
  onStart: () => void;
};

export function LobbyScreen({ room, players, isHost, onUpdateSettings, onStart }: Props) {
  const maxImposters = Math.max(1, players.length - 1);
  const packId = room.packId ?? wordPacks[0].id;

  return (
    <div className="screen setup-screen">
      <h1>Room {room.code}</h1>
      <p className="tagline">Tell the others to join with this code.</p>

      <ul className="player-list">
        {players.map((p) => (
          <li key={p.id}>{p.name}</li>
        ))}
      </ul>

      {isHost ? (
        <>
          <label>
            Word pack
            <select value={packId} onChange={(e) => onUpdateSettings(e.target.value, room.imposterCount)}>
              {wordPacks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Imposters
            <input
              type="number"
              min={1}
              max={maxImposters}
              value={room.imposterCount}
              onChange={(e) => onUpdateSettings(packId, Number(e.target.value))}
            />
          </label>

          <button disabled={players.length < 3} onClick={onStart}>
            Start Game
          </button>
          {players.length < 3 && <p className="hint">Add at least 3 players to start</p>}
        </>
      ) : (
        <p className="hint">Waiting for the host to start…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Delete the superseded screen**

```bash
git rm src/screens/SetupScreen.tsx
```

- [ ] **Step 5: Type-check**

Run: `npx tsc -b --noEmit`
Expected: errors in `App.tsx` referencing the deleted `SetupScreen` — expected until Task 13 rewires it. Confirm no *other* errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/CreateRoomScreen.tsx src/screens/JoinRoomScreen.tsx src/screens/LobbyScreen.tsx
git commit -m "feat: add create-room, join-room, and lobby screens"
```

---

### Task 10: Rework `RevealScreen` and `ClueRoundScreen` for per-device state

**Files:**
- Modify: `src/screens/RevealScreen.tsx`
- Modify: `src/screens/ClueRoundScreen.tsx`

**Interfaces:**
- Consumes: `Assignment` (Task 5), `Player[]`, `turnOrder`/`turnIndex` from `Room`.
- Produces the props `App.tsx` (Task 13) passes in.

- [ ] **Step 1: Rewrite `RevealScreen`**

```typescript
// src/screens/RevealScreen.tsx
import { useState } from 'react';
import type { Assignment } from '../types';

type Props = {
  myAssignment: Assignment;
  totalPlayers: number;
  readyCount: number;
  onReady: () => void;
};

export function RevealScreen({ myAssignment, totalPlayers, readyCount, onReady }: Props) {
  const [tapped, setTapped] = useState(false);

  const declassify = () => setTapped(true);
  const gotIt = () => onReady();

  if (myAssignment.ready) {
    return (
      <div className="screen reveal-screen">
        <p className="hint">
          Waiting for everyone… {readyCount}/{totalPlayers} ready
        </p>
      </div>
    );
  }

  return (
    <div className="screen reveal-screen">
      <h2>Your card</h2>
      <div className="reveal-card">
        <div className={`redaction-text ${myAssignment.isImposter ? 'is-imposter' : ''}`}>
          {myAssignment.isImposter ? "YOU'RE THE IMPOSTER" : myAssignment.word}
        </div>
        <button className={`redaction-bar ${tapped ? 'redaction-bar--lifted' : ''}`} onClick={declassify} disabled={tapped}>
          Tap to declassify
        </button>
      </div>
      {tapped && <button onClick={gotIt}>Got it</button>}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `ClueRoundScreen`**

```typescript
// src/screens/ClueRoundScreen.tsx
import type { Player } from '../types';

type Props = {
  players: Player[];
  turnOrder: string[];
  turnIndex: number;
  me: string;
  onNext: () => void;
};

export function ClueRoundScreen({ players, turnOrder, turnIndex, me, onNext }: Props) {
  const playerId = turnOrder[turnIndex];
  const player = players.find((p) => p.id === playerId)!;
  const isMyTurn = playerId === me;
  const isLast = turnIndex === turnOrder.length - 1;

  return (
    <div className="screen clue-screen">
      <p className="hint">
        File {turnIndex + 1} of {turnOrder.length}
      </p>
      <h2>{isMyTurn ? 'Your turn' : `${player.name}'s turn`}</h2>
      {isMyTurn ? (
        <>
          <p className="tagline">Say one word or short clue out loud, then tap Next.</p>
          <button onClick={onNext}>{isLast ? 'Everyone gave a clue — start voting' : 'Next player'}</button>
        </>
      ) : (
        <p className="tagline">Waiting for {player.name}…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b --noEmit`
Expected: only the still-pending `App.tsx` mismatch (Task 13).

- [ ] **Step 4: Commit**

```bash
git add src/screens/RevealScreen.tsx src/screens/ClueRoundScreen.tsx
git commit -m "feat: rework reveal and clue-round screens for per-device state"
```

---

### Task 11: Rework `VotingScreen`

**Files:**
- Modify: `src/screens/VotingScreen.tsx`

**Interfaces:**
- Consumes: `Player[]`, own player id, vote count so far.
- Produces the props `App.tsx` (Task 13) passes in.

- [ ] **Step 1: Rewrite the screen**

```typescript
// src/screens/VotingScreen.tsx
import type { Player } from '../types';

type Props = {
  players: Player[];
  me: string;
  hasVoted: boolean;
  votesCastCount: number;
  onVote: (targetId: string) => void;
};

export function VotingScreen({ players, me, hasVoted, votesCastCount, onVote }: Props) {
  if (hasVoted) {
    return (
      <div className="screen voting-screen">
        <p className="hint">
          Waiting for everyone to vote… {votesCastCount}/{players.length}
        </p>
      </div>
    );
  }

  return (
    <div className="screen voting-screen">
      <p className="tagline">Who do you think is the imposter?</p>
      <ul className="vote-list">
        {players
          .filter((p) => p.id !== me)
          .map((p) => (
            <li key={p.id}>
              <button onClick={() => onVote(p.id)}>{p.name}</button>
            </li>
          ))}
      </ul>
    </div>
  );
}
```

Note: `.filter((p) => p.id !== me)` is new — the original single-device version let a voter pick anyone including themselves (the "voter" changed each turn so this rarely came up in practice); voting for yourself doesn't make sense once each screen belongs to one fixed player, so it's excluded here.

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: only the still-pending `App.tsx` mismatch.

- [ ] **Step 3: Commit**

```bash
git add src/screens/VotingScreen.tsx
git commit -m "feat: rework voting screen for per-device voting"
```

---

### Task 12: Rework `ResultsScreen`

**Files:**
- Modify: `src/screens/ResultsScreen.tsx`

**Interfaces:**
- Consumes: `Player[]`, `imposterIds: string[]`, `word: string`, `votes: Record<string, string>` (still the shape `tallyVotes` expects — unchanged), `isHost: boolean`.
- Produces the props `App.tsx` (Task 13) passes in.

- [ ] **Step 1: Rewrite the screen**

```typescript
// src/screens/ResultsScreen.tsx
import type { Player } from '../types';
import { tallyVotes } from '../gameLogic';

type Props = {
  players: Player[];
  imposterIds: string[];
  word: string;
  votes: Record<string, string>;
  isHost: boolean;
  onPlayAgain: () => void;
  onNewGame: () => void;
};

export function ResultsScreen({ players, imposterIds, word, votes, isHost, onPlayAgain, onNewGame }: Props) {
  const nameFor = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const { winners, imposterCaught } = tallyVotes(votes, imposterIds);

  return (
    <div className="screen results-screen">
      <h2>The word was: {word}</h2>
      <p>
        Imposter{imposterIds.length > 1 ? 's' : ''}: <span className="result-bad">{imposterIds.map(nameFor).join(', ')}</span>
      </p>
      <p className={imposterCaught ? 'result-good' : 'result-bad'}>
        {imposterCaught
          ? `Caught! The group voted for ${winners.map(nameFor).join(', ')}.`
          : `The imposter got away — the group voted for ${winners.map(nameFor).join(', ') || 'no one clearly'}.`}
      </p>
      <ul className="score-list">
        {[...players]
          .sort((a, b) => b.score - a.score)
          .map((p) => (
            <li key={p.id}>
              {p.name}: {p.score}
            </li>
          ))}
      </ul>
      {isHost ? (
        <div className="results-actions">
          <button onClick={onPlayAgain}>Play Again (same players)</button>
          <button onClick={onNewGame}>New Game</button>
        </div>
      ) : (
        <p className="hint">Waiting for the host…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: only the still-pending `App.tsx` mismatch.

- [ ] **Step 3: Commit**

```bash
git add src/screens/ResultsScreen.tsx
git commit -m "feat: rework results screen to read from room assignments"
```

---

### Task 13: Rewire `App.tsx`, full manual playtest, and README

**Files:**
- Modify: `src/App.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `useRoom()` (Task 8) and every screen from Tasks 9–12.
- This is the integration point — nothing downstream depends on it.

- [ ] **Step 1: Rewrite `App.tsx`**

```typescript
// src/App.tsx
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
```

- [ ] **Step 2: Type-check and build**

Run: `npx tsc -b --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 3: Run the existing test suite**

Run: `npm test`
Expected: all `gameLogic.test.ts`, `supabase.test.ts`, `roomCode.test.ts`, `rooms.test.ts` tests still pass (the RLS test from Task 3 needs `supabase start` running — run it separately if the local stack isn't up).

- [ ] **Step 4: Full manual playtest**

With `npx supabase start` running and `.env.local` set, `npm run dev`, then open 3 browser windows/tabs (mix of normal + incognito so each gets a distinct anonymous session):

1. Window 1: create a room as "Alice" — confirm a 4-letter code appears and Alice sees herself in the lobby.
2. Windows 2 & 3: join with the code as "Bob" and "Cara" — confirm Alice's lobby updates live to show all three without reloading.
3. Alice (host): change the word pack / imposter count — confirm the change is visible in her own screen (others don't see settings controls, per `LobbyScreen`).
4. Alice taps Start — confirm all three windows move to Reveal, each showing only its own word/imposter status (open each window's Network tab and confirm no window ever receives another player's `assignments` row before results — this exercises the same RLS boundary Task 3 tests, live).
5. Each player taps "Got it" one at a time — confirm the "waiting… n/3" count updates live on the ones still waiting, and all three move to Clue round together once the third taps.
6. Confirm only the current turn's window shows the "Next" button; tapping it advances the highlighted player on all three windows.
7. After the last clue, confirm all three move to Voting.
8. Have each window vote for a different (or same) target — confirm the "n/3 voted" count updates live, and all three move to Results once the third vote lands.
9. Confirm Results shows the correct imposter(s), word, and updated scores identically on all three windows.
10. As Alice, tap "Play Again" — confirm a new round starts with fresh roles (word/imposter reassigned) and scores carried over.
11. As Alice, tap "New Game" — confirm all three windows drop back to the create/join screen (room deleted).
12. Refresh one window mid-round (after step 5, before step 7) — confirm it resumes in the same room/phase rather than restarting at create/join.

If any step fails, fix the relevant task's code before proceeding — this checklist is the acceptance test for the whole feature.

- [ ] **Step 5: Update the README**

Replace the "Multi-device play (planned)" section (added when the spec was written) and the "Run it" section:

```markdown
## Run it

```bash
npm install
npx supabase start   # local Postgres + Realtime + Auth; prints a URL and anon key
cp .env.local.example .env.local   # fill in the URL/anon key npx supabase start printed
npm run dev
```

Open the printed `http://localhost:5173` URL on the host's phone/laptop to create a
room, then open it on every other player's phone and join with the 4-letter code.
Everyone stays in the same room — clues are still said out loud — the code just
replaces "pass the phone around."
```

```markdown
## How it works

- `src/gameLogic.ts` — pure functions: assign the word/imposter(s) for a
  round, tally votes, score players.
- `src/lib/rooms.ts` — all reads/writes to Supabase (room/player/assignment/vote
  tables), plus the compare-and-swap phase transitions.
- `src/hooks/useRoom.ts` — subscribes to Supabase Realtime and exposes the
  current room's state and actions to whichever screen is showing.
- `src/screens/` — one component per phase, each driven by `useRoom`'s state
  rather than local component state.
- `supabase/migrations/` — the schema and Row-Level Security policies that keep
  each player's role/word hidden from the others until the round ends.
```

Remove the old "Multi-device play (planned)" section entirely — it's shipped now, not planned.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/hooks/useRoom.ts README.md
git commit -m "feat: wire multi-device room flow into App.tsx; update README"
```
