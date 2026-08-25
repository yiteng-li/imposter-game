# Social Deduction Word Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time multiplayer "secret word imposter" party game — original design, React + Node — with room codes, live clue rounds, voting, and reveal.

**Architecture:** npm-workspaces monorepo. `server/` (Express + Socket.IO + TypeScript) holds all game logic as pure, unit-tested functions (`RoomManager`, `GameEngine`, `buildRoomView`) behind a thin Socket.IO event layer. `client/` (Vite + React + TypeScript) is a single `useRoomSocket` hook plus one screen component per game phase (`lobby` / `clueRound` / `voting` / `reveal`), switched by a top-level `App` component. In-memory state only, no database.

**Tech Stack:** TypeScript, Express, Socket.IO, Vitest, React 18, Vite, socket.io-client. Node stdlib (`node:crypto`) for room codes and player IDs — no id-generation dependency.

**Spec:** `docs/superpowers/specs/2026-08-25-imposter-game-design.md`

## Global Constraints

- In-memory state only — no database in v1 (spec: Non-goals).
- No accounts/auth (spec: Non-goals).
- TypeScript on both `server/` and `client/`.
- No client component test framework in v1 — verify screens manually in the browser (spec: Testing).
- Server state is authoritative; an out-of-phase client action is ignored, never trusted (spec: Error handling).
- A disconnected player keeps their seat; reconnect is via client-stored `{roomCode, playerId}`, not a new join (spec: Error handling).
- The imposter never receives the word (and no player learns who the imposter is) before the `reveal` phase (spec: Data model / game flow).

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json` (root)
- Create: `.gitignore`
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
- Create: `server/src/app.ts`, `server/src/index.ts`
- Create: `client/` (via Vite scaffold), `client/vite.config.ts` (modified)

**Interfaces:**
- Produces: `createGameServer(): { httpServer: http.Server; io: SocketIOServer; roomManager: RoomManager }` in `server/src/app.ts` — every later server task builds on this. `roomManager` is a placeholder empty class until Task 3.

- [ ] **Step 1: Create root files**

`package.json`:
```json
{
  "name": "imposter-game",
  "private": true,
  "workspaces": ["server", "client"],
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm run dev -w server\" \"npm run dev -w client\"",
    "test": "npm run test -w server"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

`.gitignore`:
```
node_modules
dist
.DS_Store
*.local
```

- [ ] **Step 2: Scaffold the server package**

Run:
```bash
mkdir -p server/src
```

`server/package.json`:
```json
{
  "name": "server",
  "type": "module",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "socket.io-client": "^4.7.5",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

`server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
});
```

- [ ] **Step 3: Write the minimal server entry point**

`server/src/app.ts`:
```ts
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

export function createGameServer() {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  return { httpServer, io };
}
```

`server/src/index.ts`:
```ts
import { createGameServer } from './app.js';

const { httpServer } = createGameServer();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
httpServer.listen(PORT, () => console.log(`Server listening on :${PORT}`));
```

- [ ] **Step 4: Scaffold the client package**

Run (non-interactive Vite scaffold):
```bash
npm create vite@latest client -- --template react-ts
```

- [ ] **Step 5: Install workspace dependencies**

Run from repo root:
```bash
npm install
```

- [ ] **Step 6: Verify the server boots**

Run: `npm run dev -w server` (in background/separate terminal), then in another shell:
```bash
curl -s http://localhost:3001/health
```
Expected: `{"ok":true}`. Stop the dev server after confirming.

- [ ] **Step 7: Verify the client boots**

Run: `npm run dev -w client`, open the printed `http://localhost:5173` URL in a browser.
Expected: default Vite + React starter page renders with no console errors. Stop the dev server after confirming.

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore server client
git commit -m "Scaffold monorepo: Express+Socket.IO server, Vite+React client"
```

---

### Task 2: Shared server types and word packs

**Files:**
- Create: `server/src/types.ts`
- Create: `server/src/wordPacks/data.ts`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces: `Player`, `GameState`, `Room`, `RoomPhase` types; `WordPack` type; `getWordPack(id: string): WordPack`, `wordPacks: WordPack[]` from `wordPacks/data.ts` — used by Task 3 (`RoomManager`) and Task 4 (`GameEngine`).

- [ ] **Step 1: Write shared types**

`server/src/types.ts`:
```ts
export type Player = {
  id: string;
  nickname: string;
  connected: boolean;
  score: number;
};

export type GameState = {
  wordPackId: string;
  word: string;
  imposterIds: string[];
  turnOrder: string[];
  turnIndex: number;
  clues: { playerId: string; text: string }[];
  votes: Record<string, string>;
};

export type RoomPhase = 'lobby' | 'clueRound' | 'voting' | 'reveal';

export type Room = {
  code: string;
  hostId: string;
  players: Player[];
  phase: RoomPhase;
  game: GameState | null;
};
```

- [ ] **Step 2: Write original word packs**

`server/src/wordPacks/data.ts`:
```ts
export type WordPack = { id: string; name: string; words: string[] };

export const wordPacks: WordPack[] = [
  {
    id: 'foods',
    name: 'Foods',
    words: ['Pizza', 'Sushi', 'Tacos', 'Pancakes', 'Spaghetti', 'Burger', 'Ice Cream', 'Ramen', 'Salad', 'Curry', 'Waffles', 'Sandwich', 'Dumplings', 'Popcorn', 'Nachos', 'Pretzel', 'Burrito', 'Bagel', 'Omelette', 'Soup'],
  },
  {
    id: 'animals',
    name: 'Animals',
    words: ['Elephant', 'Penguin', 'Giraffe', 'Octopus', 'Kangaroo', 'Dolphin', 'Cheetah', 'Owl', 'Raccoon', 'Flamingo', 'Otter', 'Hedgehog', 'Peacock', 'Koala', 'Walrus', 'Chameleon', 'Platypus', 'Toucan', 'Sloth', 'Armadillo'],
  },
  {
    id: 'objects',
    name: 'Everyday Objects',
    words: ['Umbrella', 'Backpack', 'Toothbrush', 'Bicycle', 'Candle', 'Mirror', 'Blanket', 'Stapler', 'Sunglasses', 'Wallet', 'Keyboard', 'Headphones', 'Ladder', 'Broom', 'Suitcase', 'Lamp', 'Pillow', 'Scissors', 'Calendar', 'Thermostat'],
  },
];

export function getWordPack(id: string): WordPack {
  const pack = wordPacks.find((p) => p.id === id);
  if (!pack) throw new Error(`Unknown word pack: ${id}`);
  return pack;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build -w server`
Expected: exits 0, no type errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/types.ts server/src/wordPacks
git commit -m "Add shared server types and original word packs"
```

---

### Task 3: RoomManager

**Files:**
- Create: `server/src/roomManager.ts`
- Test: `server/src/roomManager.test.ts`

**Interfaces:**
- Consumes: `Player`, `Room` from `./types.js` (Task 2).
- Produces: `class RoomManager` with `createRoom(nickname: string): { room: Room; player: Player }`, `joinRoom(code: string, nickname: string): { room: Room; player: Player } | { error: string }`, `getRoom(code: string): Room | undefined`, `replaceRoom(room: Room): void`, `setConnected(code: string, playerId: string, connected: boolean): void` — used by Task 5 (`socket.ts`) and Task 4's tests (helper to build rooms).

- [ ] **Step 1: Write the failing tests**

`server/src/roomManager.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { RoomManager } from './roomManager.js';

describe('RoomManager', () => {
  it('creates a room with a 4-character code and the creator as host', () => {
    const rooms = new RoomManager();
    const { room, player } = rooms.createRoom('Alice');
    expect(room.code).toHaveLength(4);
    expect(room.hostId).toBe(player.id);
    expect(room.players).toEqual([player]);
    expect(room.phase).toBe('lobby');
  });

  it('lets a second player join an existing room', () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom('Alice');
    const result = rooms.joinRoom(room.code, 'Bob');
    if ('error' in result) throw new Error('unexpected error');
    expect(result.room.players).toHaveLength(2);
  });

  it('rejects joining an unknown room code', () => {
    const rooms = new RoomManager();
    const result = rooms.joinRoom('ZZZZ', 'Bob');
    expect(result).toEqual({ error: 'Room not found' });
  });

  it('rejects joining a room that already started', () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom('Alice');
    rooms.replaceRoom({ ...room, phase: 'clueRound' });
    const result = rooms.joinRoom(room.code, 'Bob');
    expect(result).toEqual({ error: 'Game already in progress' });
  });

  it('deletes a room 2 minutes after every player disconnects', () => {
    vi.useFakeTimers();
    const rooms = new RoomManager();
    const { room, player } = rooms.createRoom('Alice');
    rooms.setConnected(room.code, player.id, false);
    vi.advanceTimersByTime(2 * 60 * 1000 + 1);
    expect(rooms.getRoom(room.code)).toBeUndefined();
    vi.useRealTimers();
  });

  it('cancels the cleanup timer if a player reconnects in time', () => {
    vi.useFakeTimers();
    const rooms = new RoomManager();
    const { room, player } = rooms.createRoom('Alice');
    rooms.setConnected(room.code, player.id, false);
    vi.advanceTimersByTime(60 * 1000);
    rooms.setConnected(room.code, player.id, true);
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(rooms.getRoom(room.code)).toBeDefined();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w server -- roomManager`
Expected: FAIL — `roomManager.ts` does not exist yet.

- [ ] **Step 3: Implement RoomManager**

`server/src/roomManager.ts`:
```ts
import { randomUUID, randomInt } from 'node:crypto';
import type { Player, Room } from './types.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const IDLE_CLEANUP_MS = 2 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private generateCode(): string {
    let code: string;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(nickname: string): { room: Room; player: Player } {
    const player: Player = { id: randomUUID(), nickname, connected: true, score: 0 };
    const room: Room = {
      code: this.generateCode(),
      hostId: player.id,
      players: [player],
      phase: 'lobby',
      game: null,
    };
    this.rooms.set(room.code, room);
    return { room, player };
  }

  joinRoom(code: string, nickname: string): { room: Room; player: Player } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: 'Room not found' };
    if (room.phase !== 'lobby') return { error: 'Game already in progress' };
    const player: Player = { id: randomUUID(), nickname, connected: true, score: 0 };
    const updated: Room = { ...room, players: [...room.players, player] };
    this.rooms.set(updated.code, updated);
    this.clearIdleTimer(updated.code);
    return { room: updated, player };
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  replaceRoom(room: Room): void {
    this.rooms.set(room.code, room);
  }

  setConnected(code: string, playerId: string, connected: boolean): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const players = room.players.map((p) => (p.id === playerId ? { ...p, connected } : p));
    this.rooms.set(code, { ...room, players });
    if (players.every((p) => !p.connected)) {
      this.scheduleCleanup(code);
    } else {
      this.clearIdleTimer(code);
    }
  }

  private scheduleCleanup(code: string): void {
    this.clearIdleTimer(code);
    const timer = setTimeout(() => this.rooms.delete(code), IDLE_CLEANUP_MS);
    this.idleTimers.set(code, timer);
  }

  private clearIdleTimer(code: string): void {
    const timer = this.idleTimers.get(code);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(code);
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w server -- roomManager`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/roomManager.ts server/src/roomManager.test.ts
git commit -m "Add RoomManager: room lifecycle and idle cleanup"
```

---

### Task 4: GameEngine

**Files:**
- Create: `server/src/gameEngine.ts`
- Test: `server/src/gameEngine.test.ts`

**Interfaces:**
- Consumes: `Room`, `GameState` from `./types.js`; `getWordPack` from `./wordPacks/data.js`; `RoomManager` from `./roomManager.js` (test helper only).
- Produces: `class GameEngineError extends Error`; `startGame(room: Room, wordPackId: string, imposterCount: number): Room`; `submitClue(room: Room, playerId: string, text: string): Room`; `castVote(room: Room, voterId: string, targetPlayerId: string): Room`; `playAgain(room: Room): Room` — all used by Task 5 (`socket.ts`) and Task 6 (`roomView.ts` tests).

- [ ] **Step 1: Write the failing tests**

`server/src/gameEngine.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import * as engine from './gameEngine.js';
import { RoomManager } from './roomManager.js';
import type { Room } from './types.js';

function roomWithPlayers(names: string[]): Room {
  const rooms = new RoomManager();
  const { room: r0 } = rooms.createRoom(names[0]);
  let room = r0;
  for (const name of names.slice(1)) {
    const result = rooms.joinRoom(room.code, name);
    if ('error' in result) throw new Error(result.error);
    room = result.room;
  }
  return room;
}

describe('startGame', () => {
  it('assigns a word and the requested number of imposters, moves to clueRound', () => {
    const room = roomWithPlayers(['A', 'B', 'C']);
    const started = engine.startGame(room, 'foods', 1);
    expect(started.phase).toBe('clueRound');
    expect(started.game?.imposterIds).toHaveLength(1);
    expect(started.game?.turnOrder).toHaveLength(3);
    expect(started.game?.word.length).toBeGreaterThan(0);
  });

  it('rejects starting with fewer than 3 players', () => {
    const room = roomWithPlayers(['A', 'B']);
    expect(() => engine.startGame(room, 'foods', 1)).toThrow();
  });

  it('rejects an imposter count that leaves no non-imposters', () => {
    const room = roomWithPlayers(['A', 'B', 'C']);
    expect(() => engine.startGame(room, 'foods', 3)).toThrow();
  });
});

describe('submitClue', () => {
  it('rejects a clue from a player out of turn', () => {
    const room = roomWithPlayers(['A', 'B', 'C']);
    const started = engine.startGame(room, 'foods', 1);
    const outOfTurnId = started.game!.turnOrder[1];
    expect(() => engine.submitClue(started, outOfTurnId, 'hint')).toThrow();
  });

  it('rejects an empty clue', () => {
    const room = roomWithPlayers(['A', 'B', 'C']);
    const started = engine.startGame(room, 'foods', 1);
    const firstId = started.game!.turnOrder[0];
    expect(() => engine.submitClue(started, firstId, '   ')).toThrow();
  });

  it('advances the turn after a valid clue', () => {
    const room = roomWithPlayers(['A', 'B', 'C']);
    const started = engine.startGame(room, 'foods', 1);
    const firstId = started.game!.turnOrder[0];
    const after = engine.submitClue(started, firstId, 'crispy');
    expect(after.game?.turnIndex).toBe(1);
    expect(after.game?.clues).toEqual([{ playerId: firstId, text: 'crispy' }]);
    expect(after.phase).toBe('clueRound');
  });

  it('moves to voting once every player has given a clue', () => {
    const room = roomWithPlayers(['A', 'B', 'C']);
    let current = engine.startGame(room, 'foods', 1);
    for (const id of current.game!.turnOrder) {
      current = engine.submitClue(current, id, 'clue');
    }
    expect(current.phase).toBe('voting');
  });
});

describe('castVote', () => {
  function playedToVoting(): Room {
    const room = roomWithPlayers(['A', 'B', 'C']);
    let current = engine.startGame(room, 'foods', 1);
    for (const id of current.game!.turnOrder) {
      current = engine.submitClue(current, id, 'clue');
    }
    return current;
  }

  it('rejects a vote for a player not in the room', () => {
    const voting = playedToVoting();
    expect(() => engine.castVote(voting, voting.players[0].id, 'not-a-real-id')).toThrow();
  });

  it('does not reveal until every player has voted', () => {
    const voting = playedToVoting();
    const firstId = voting.players[0].id;
    const after = engine.castVote(voting, firstId, voting.game!.imposterIds[0]);
    expect(after.phase).toBe('voting');
  });

  it('reveals once all players have voted and awards a point to the correct side', () => {
    let voting = playedToVoting();
    const imposterId = voting.game!.imposterIds[0];
    for (const p of voting.players) {
      voting = engine.castVote(voting, p.id, imposterId);
    }
    expect(voting.phase).toBe('reveal');
    const nonImposters = voting.players.filter((p) => !voting.game!.imposterIds.includes(p.id));
    expect(nonImposters.every((p) => p.score === 1)).toBe(true);
    const imposter = voting.players.find((p) => p.id === imposterId)!;
    expect(imposter.score).toBe(0);
  });

  it('awards the imposter a point when the vote does not land on them alone', () => {
    let voting = playedToVoting();
    const imposterId = voting.game!.imposterIds[0];
    const nonImposterIds = voting.players.filter((p) => p.id !== imposterId).map((p) => p.id);
    for (const p of voting.players) {
      voting = engine.castVote(voting, p.id, nonImposterIds[0]);
    }
    expect(voting.phase).toBe('reveal');
    const imposter = voting.players.find((p) => p.id === imposterId)!;
    expect(imposter.score).toBe(1);
  });
});

describe('playAgain', () => {
  it('resets phase to lobby and clears game state, keeping players and scores', () => {
    let voting = (() => {
      const room = roomWithPlayers(['A', 'B', 'C']);
      let current = engine.startGame(room, 'foods', 1);
      for (const id of current.game!.turnOrder) current = engine.submitClue(current, id, 'clue');
      for (const p of current.players) current = engine.castVote(current, p.id, current.game!.imposterIds[0]);
      return current;
    })();
    const reset = engine.playAgain(voting);
    expect(reset.phase).toBe('lobby');
    expect(reset.game).toBeNull();
    expect(reset.players).toEqual(voting.players);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w server -- gameEngine`
Expected: FAIL — `gameEngine.ts` does not exist yet.

- [ ] **Step 3: Implement GameEngine**

`server/src/gameEngine.ts`:
```ts
import { randomInt } from 'node:crypto';
import type { Room, GameState } from './types.js';
import { getWordPack } from './wordPacks/data.js';

export class GameEngineError extends Error {}

export function startGame(room: Room, wordPackId: string, imposterCount: number): Room {
  if (room.players.length < 3) throw new GameEngineError('Need at least 3 players');
  if (imposterCount < 1 || imposterCount >= room.players.length) {
    throw new GameEngineError('Invalid imposter count');
  }
  const pack = getWordPack(wordPackId);
  const word = pack.words[randomInt(pack.words.length)];
  const shuffledForImposters = shuffle(room.players.map((p) => p.id));
  const imposterIds = shuffledForImposters.slice(0, imposterCount);
  const turnOrder = shuffle(room.players.map((p) => p.id));
  const game: GameState = { wordPackId, word, imposterIds, turnOrder, turnIndex: 0, clues: [], votes: {} };
  return { ...room, phase: 'clueRound', game };
}

export function submitClue(room: Room, playerId: string, text: string): Room {
  if (room.phase !== 'clueRound' || !room.game) throw new GameEngineError('Not in clue round');
  const game = room.game;
  const expectedPlayerId = game.turnOrder[game.turnIndex];
  if (playerId !== expectedPlayerId) throw new GameEngineError('Not your turn');
  const trimmed = text.trim();
  if (!trimmed) throw new GameEngineError('Clue cannot be empty');
  const clues = [...game.clues, { playerId, text: trimmed }];
  const turnIndex = game.turnIndex + 1;
  if (turnIndex >= game.turnOrder.length) {
    return { ...room, phase: 'voting', game: { ...game, clues, turnIndex } };
  }
  return { ...room, game: { ...game, clues, turnIndex } };
}

export function castVote(room: Room, voterId: string, targetPlayerId: string): Room {
  if (room.phase !== 'voting' || !room.game) throw new GameEngineError('Not in voting phase');
  if (!room.players.some((p) => p.id === targetPlayerId)) throw new GameEngineError('Invalid vote target');
  const votes = { ...room.game.votes, [voterId]: targetPlayerId };
  const withVote: Room = { ...room, game: { ...room.game, votes } };
  const allVoted = withVote.players.every((p) => votes[p.id]);
  return allVoted ? tallyAndScore(withVote) : withVote;
}

function tallyAndScore(room: Room): Room {
  const game = room.game!;
  const counts = new Map<string, number>();
  for (const target of Object.values(game.votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  let winners: string[] = [];
  let max = 0;
  for (const [id, count] of counts) {
    if (count > max) {
      max = count;
      winners = [id];
    } else if (count === max) {
      winners.push(id);
    }
  }
  const imposterCaught = winners.length === 1 && game.imposterIds.includes(winners[0]);
  const players = room.players.map((p) => {
    const isImposter = game.imposterIds.includes(p.id);
    const scored = imposterCaught ? !isImposter : isImposter;
    return scored ? { ...p, score: p.score + 1 } : p;
  });
  return { ...room, phase: 'reveal', players };
}

export function playAgain(room: Room): Room {
  return { ...room, phase: 'lobby', game: null };
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w server -- gameEngine`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/gameEngine.ts server/src/gameEngine.test.ts
git commit -m "Add GameEngine: clue rounds, voting, scoring, replay"
```

---

### Task 5: Per-player room view (redaction)

**Files:**
- Create: `server/src/roomView.ts`
- Test: `server/src/roomView.test.ts`

**Interfaces:**
- Consumes: `Room` from `./types.js`; `startGame` from `./gameEngine.js` and `RoomManager` (test helpers).
- Produces: `type RoomView`; `buildRoomView(room: Room, forPlayerId: string): RoomView` — used by Task 6 (`socket.ts`) and Task 7 (client `types.ts` mirrors this shape).

- [ ] **Step 1: Write the failing tests**

`server/src/roomView.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildRoomView } from './roomView.js';
import * as engine from './gameEngine.js';
import { RoomManager } from './roomManager.js';
import type { Room } from './types.js';

function startedRoom(): Room {
  const rooms = new RoomManager();
  const { room: r0 } = rooms.createRoom('A');
  let room = r0;
  for (const name of ['B', 'C']) {
    const result = rooms.joinRoom(room.code, name);
    if ('error' in result) throw new Error(result.error);
    room = result.room;
  }
  return engine.startGame(room, 'foods', 1);
}

describe('buildRoomView', () => {
  it('returns a null game view in the lobby', () => {
    const rooms = new RoomManager();
    const { room, player } = rooms.createRoom('A');
    const view = buildRoomView(room, player.id);
    expect(view.game).toBeNull();
    expect(view.phase).toBe('lobby');
  });

  it('hides the word and imposter identities from the imposter before reveal', () => {
    const room = startedRoom();
    const imposterId = room.game!.imposterIds[0];
    const view = buildRoomView(room, imposterId);
    expect(view.game?.word).toBeNull();
    expect(view.game?.isImposter).toBe(true);
    expect(view.game?.imposterIds).toBeNull();
  });

  it('shows the word but not imposter identities to a non-imposter before reveal', () => {
    const room = startedRoom();
    const nonImposterId = room.players.find((p) => !room.game!.imposterIds.includes(p.id))!.id;
    const view = buildRoomView(room, nonImposterId);
    expect(view.game?.word).toBe(room.game!.word);
    expect(view.game?.isImposter).toBe(false);
    expect(view.game?.imposterIds).toBeNull();
  });

  it('hides vote targets but shows who has voted, before reveal', () => {
    const room = startedRoom();
    const voterId = room.players[0].id;
    const withVote: Room = { ...room, phase: 'voting', game: { ...room.game!, votes: { [voterId]: room.players[1].id } } };
    const view = buildRoomView(withVote, room.players[1].id);
    expect(view.game?.votedPlayerIds).toEqual([voterId]);
    expect(view.game?.votes).toBeNull();
  });

  it('reveals the word, imposter identities, and votes once phase is reveal', () => {
    const room = { ...startedRoom(), phase: 'reveal' as const };
    const view = buildRoomView(room, room.game!.imposterIds[0]);
    expect(view.game?.word).toBe(room.game!.word);
    expect(view.game?.imposterIds).toEqual(room.game!.imposterIds);
    expect(view.game?.votes).toEqual(room.game!.votes);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w server -- roomView`
Expected: FAIL — `roomView.ts` does not exist yet.

- [ ] **Step 3: Implement buildRoomView**

`server/src/roomView.ts`:
```ts
import type { Room } from './types.js';

export type RoomView = {
  code: string;
  hostId: string;
  players: { id: string; nickname: string; connected: boolean; score: number }[];
  phase: Room['phase'];
  game: {
    wordPackId: string;
    word: string | null;
    isImposter: boolean;
    imposterIds: string[] | null;
    turnOrder: string[];
    turnIndex: number;
    clues: { playerId: string; text: string }[];
    votedPlayerIds: string[];
    votes: Record<string, string> | null;
  } | null;
};

export function buildRoomView(room: Room, forPlayerId: string): RoomView {
  if (!room.game) {
    return { code: room.code, hostId: room.hostId, players: room.players, phase: room.phase, game: null };
  }
  const g = room.game;
  const isImposter = g.imposterIds.includes(forPlayerId);
  const revealed = room.phase === 'reveal';
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players,
    phase: room.phase,
    game: {
      wordPackId: g.wordPackId,
      word: isImposter && !revealed ? null : g.word,
      isImposter,
      imposterIds: revealed ? g.imposterIds : null,
      turnOrder: g.turnOrder,
      turnIndex: g.turnIndex,
      clues: g.clues,
      votedPlayerIds: Object.keys(g.votes),
      votes: revealed ? g.votes : null,
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w server -- roomView`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/roomView.ts server/src/roomView.test.ts
git commit -m "Add per-player room view with imposter/vote redaction"
```

---

### Task 6: Socket.IO event layer

**Files:**
- Create: `server/src/socket.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/socket.test.ts`

**Interfaces:**
- Consumes: `RoomManager` (Task 3), `startGame`/`submitClue`/`castVote`/`playAgain` (Task 4), `buildRoomView` (Task 5).
- Produces: `registerSocketHandlers(io: SocketIOServer, rooms: RoomManager): void`; `createGameServer(): { httpServer, io, roomManager: RoomManager }` (now wired) — used by Task 7's `useRoomSocket` hook (client) as the wire protocol, and by this task's own integration test.

- [ ] **Step 1: Write the failing integration test**

`server/src/socket.test.ts`:
```ts
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createGameServer } from './app.js';
import type { RoomView } from './roomView.js';

type Ack = { roomCode: string; playerId: string } | { error: string };

function connectClient(port: number): Promise<ClientSocket> {
  return new Promise((resolve) => {
    const socket = ioClient(`http://localhost:${port}`);
    socket.on('connect', () => resolve(socket));
  });
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function nextState(socket: ClientSocket): Promise<RoomView> {
  return new Promise((resolve) => socket.once('room:state', resolve));
}

describe('socket game flow', () => {
  let server: ReturnType<typeof createGameServer>;
  let port: number;
  let clients: ClientSocket[] = [];

  beforeEach(async () => {
    server = createGameServer();
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    port = (server.httpServer.address() as AddressInfo).port;
  });

  afterEach(() => {
    for (const c of clients) c.disconnect();
    clients = [];
    server.io.close();
    server.httpServer.close();
  });

  it('walks three players through create, join, start, clue round, voting, and reveal', async () => {
    const host = await connectClient(port);
    const guest1 = await connectClient(port);
    const guest2 = await connectClient(port);
    clients = [host, guest1, guest2];

    const created = await emitAck<Ack>(host, 'room:create', { nickname: 'Host' });
    if ('error' in created) throw new Error(created.error);
    const hostId = created.playerId;

    const j1 = await emitAck<Ack>(guest1, 'room:join', { roomCode: created.roomCode, nickname: 'Guest1' });
    const j2 = await emitAck<Ack>(guest2, 'room:join', { roomCode: created.roomCode, nickname: 'Guest2' });
    if ('error' in j1 || 'error' in j2) throw new Error('join failed');

    const bySocket = new Map<string, ClientSocket>([
      [hostId, host],
      [j1.playerId, guest1],
      [j2.playerId, guest2],
    ]);

    const startedPromise = nextState(host);
    host.emit('game:start', { wordPackId: 'foods', imposterCount: 1 });
    const clueRoundState = await startedPromise;
    expect(clueRoundState.phase).toBe('clueRound');
    expect(clueRoundState.game?.turnOrder).toHaveLength(3);

    let latest = clueRoundState;
    for (const turnPlayerId of clueRoundState.game!.turnOrder) {
      const socket = bySocket.get(turnPlayerId)!;
      const statePromise = nextState(host);
      socket.emit('game:submitClue', { text: 'clue' });
      latest = await statePromise;
    }
    expect(latest.phase).toBe('voting');

    for (const [, socket] of bySocket) {
      const statePromise = nextState(host);
      socket.emit('game:castVote', { targetPlayerId: hostId });
      latest = await statePromise;
    }
    expect(latest.phase).toBe('reveal');
    expect(latest.game?.word).toBeTruthy();
    expect(latest.game?.imposterIds).toHaveLength(1);
  });

  it('rejects joining a room that does not exist', async () => {
    const client = await connectClient(port);
    clients = [client];
    const result = await emitAck<Ack>(client, 'room:join', { roomCode: 'ZZZZ', nickname: 'X' });
    expect(result).toEqual({ error: 'Room not found' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w server -- socket`
Expected: FAIL — `socket.ts` does not exist yet and `createGameServer` does not yet wire a `RoomManager`.

- [ ] **Step 3: Implement the socket event layer**

`server/src/socket.ts`:
```ts
import type { Server, Socket } from 'socket.io';
import { RoomManager } from './roomManager.js';
import * as engine from './gameEngine.js';
import { buildRoomView } from './roomView.js';

type JoinAck = { roomCode: string; playerId: string } | { error: string };

function playerSocketRoom(roomCode: string, playerId: string): string {
  return `${roomCode}:${playerId}`;
}

export function registerSocketHandlers(io: Server, rooms: RoomManager): void {
  const broadcastRoom = (code: string) => {
    const room = rooms.getRoom(code);
    if (!room) return;
    for (const player of room.players) {
      io.to(playerSocketRoom(code, player.id)).emit('room:state', buildRoomView(room, player.id));
    }
  };

  io.on('connection', (socket: Socket) => {
    let currentRoomCode: string | null = null;
    let currentPlayerId: string | null = null;

    socket.on('room:create', ({ nickname }: { nickname: string }, ack: (res: JoinAck) => void) => {
      const { room, player } = rooms.createRoom(nickname);
      currentRoomCode = room.code;
      currentPlayerId = player.id;
      socket.join(playerSocketRoom(room.code, player.id));
      ack({ roomCode: room.code, playerId: player.id });
      broadcastRoom(room.code);
    });

    socket.on('room:join', ({ roomCode, nickname }: { roomCode: string; nickname: string }, ack: (res: JoinAck) => void) => {
      const result = rooms.joinRoom(roomCode, nickname);
      if ('error' in result) {
        ack({ error: result.error });
        return;
      }
      currentRoomCode = result.room.code;
      currentPlayerId = result.player.id;
      socket.join(playerSocketRoom(result.room.code, result.player.id));
      ack({ roomCode: result.room.code, playerId: result.player.id });
      broadcastRoom(result.room.code);
    });

    socket.on('room:reconnect', ({ roomCode, playerId }: { roomCode: string; playerId: string }, ack: (res: JoinAck) => void) => {
      const room = rooms.getRoom(roomCode);
      const player = room?.players.find((p) => p.id === playerId);
      if (!room || !player) {
        ack({ error: 'Room not found' });
        return;
      }
      currentRoomCode = room.code;
      currentPlayerId = player.id;
      rooms.setConnected(room.code, player.id, true);
      socket.join(playerSocketRoom(room.code, player.id));
      ack({ roomCode: room.code, playerId: player.id });
      broadcastRoom(room.code);
    });

    socket.on('game:start', ({ wordPackId, imposterCount }: { wordPackId: string; imposterCount: number }) => {
      if (!currentRoomCode || !currentPlayerId) return;
      const room = rooms.getRoom(currentRoomCode);
      if (!room || room.hostId !== currentPlayerId) return;
      try {
        rooms.replaceRoom(engine.startGame(room, wordPackId, imposterCount));
        broadcastRoom(currentRoomCode);
      } catch (err) {
        socket.emit('game:error', { message: (err as Error).message });
      }
    });

    socket.on('game:submitClue', ({ text }: { text: string }) => {
      if (!currentRoomCode || !currentPlayerId) return;
      const room = rooms.getRoom(currentRoomCode);
      if (!room) return;
      try {
        rooms.replaceRoom(engine.submitClue(room, currentPlayerId, text));
        broadcastRoom(currentRoomCode);
      } catch (err) {
        socket.emit('game:error', { message: (err as Error).message });
      }
    });

    socket.on('game:castVote', ({ targetPlayerId }: { targetPlayerId: string }) => {
      if (!currentRoomCode || !currentPlayerId) return;
      const room = rooms.getRoom(currentRoomCode);
      if (!room) return;
      try {
        rooms.replaceRoom(engine.castVote(room, currentPlayerId, targetPlayerId));
        broadcastRoom(currentRoomCode);
      } catch (err) {
        socket.emit('game:error', { message: (err as Error).message });
      }
    });

    socket.on('game:playAgain', () => {
      if (!currentRoomCode || !currentPlayerId) return;
      const room = rooms.getRoom(currentRoomCode);
      if (!room || room.hostId !== currentPlayerId) return;
      rooms.replaceRoom(engine.playAgain(room));
      broadcastRoom(currentRoomCode);
    });

    socket.on('disconnect', () => {
      if (!currentRoomCode || !currentPlayerId) return;
      rooms.setConnected(currentRoomCode, currentPlayerId, false);
      broadcastRoom(currentRoomCode);
    });
  });
}
```

- [ ] **Step 4: Wire it into `createGameServer`**

Modify `server/src/app.ts`:
```ts
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { RoomManager } from './roomManager.js';
import { registerSocketHandlers } from './socket.js';

export function createGameServer() {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const roomManager = new RoomManager();
  registerSocketHandlers(io, roomManager);
  return { httpServer, io, roomManager };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w server`
Expected: PASS — all suites (roomManager, gameEngine, roomView, socket) green.

- [ ] **Step 6: Commit**

```bash
git add server/src/socket.ts server/src/app.ts server/src/socket.test.ts
git commit -m "Wire Socket.IO event layer over RoomManager and GameEngine"
```

---

### Task 7: Client socket hook + Home screen

**Files:**
- Create: `client/src/types.ts`
- Create: `client/src/useRoomSocket.ts`
- Create: `client/src/screens/HomeScreen.tsx`
- Modify: `client/src/App.tsx`
- Create: `client/src/index.css` (replace Vite default)
- Modify: `client/vite.config.ts`

**Interfaces:**
- Consumes: server socket protocol from Task 6 (`room:create`, `room:join`, `room:reconnect`, `room:state`, `game:*`).
- Produces: `useRoomSocket(): { room, playerId, error, createRoom, joinRoom, startGame, submitClue, castVote, playAgain }` — used by Tasks 8-11 (every screen) and `App.tsx`. `RoomView` type mirrored in `client/src/types.ts` — used by every screen for props.

- [ ] **Step 1: Add the socket client dependency**

Run:
```bash
npm install socket.io-client -w client
```

- [ ] **Step 2: Configure the dev proxy**

`client/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
```

- [ ] **Step 3: Mirror the server's RoomView type**

`client/src/types.ts`:
```ts
export type Player = { id: string; nickname: string; connected: boolean; score: number };
export type RoomPhase = 'lobby' | 'clueRound' | 'voting' | 'reveal';

export type RoomView = {
  code: string;
  hostId: string;
  players: Player[];
  phase: RoomPhase;
  game: {
    wordPackId: string;
    word: string | null;
    isImposter: boolean;
    imposterIds: string[] | null;
    turnOrder: string[];
    turnIndex: number;
    clues: { playerId: string; text: string }[];
    votedPlayerIds: string[];
    votes: Record<string, string> | null;
  } | null;
};
```

- [ ] **Step 4: Write the socket hook**

`client/src/useRoomSocket.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RoomView } from './types';

const STORAGE_KEY = 'imposter-game-session';

type Session = { roomCode: string; playerId: string };
type Ack = { roomCode: string; playerId: string } | { error: string };

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function useRoomSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;
    socket.on('room:state', (view: RoomView) => setRoom(view));
    socket.on('game:error', ({ message }: { message: string }) => setError(message));
    socket.on('connect', () => {
      const stored = readSession();
      if (!stored) return;
      socket.emit('room:reconnect', stored, (res: Ack) => {
        if ('error' in res) {
          clearSession();
          return;
        }
        setPlayerId(res.playerId);
      });
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  const createRoom = useCallback((nickname: string) => {
    setError(null);
    socketRef.current?.emit('room:create', { nickname }, (res: Ack) => {
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setPlayerId(res.playerId);
      saveSession(res);
    });
  }, []);

  const joinRoom = useCallback((roomCode: string, nickname: string) => {
    setError(null);
    socketRef.current?.emit('room:join', { roomCode, nickname }, (res: Ack) => {
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setPlayerId(res.playerId);
      saveSession(res);
    });
  }, []);

  const startGame = useCallback((wordPackId: string, imposterCount: number) => {
    socketRef.current?.emit('game:start', { wordPackId, imposterCount });
  }, []);

  const submitClue = useCallback((text: string) => {
    socketRef.current?.emit('game:submitClue', { text });
  }, []);

  const castVote = useCallback((targetPlayerId: string) => {
    socketRef.current?.emit('game:castVote', { targetPlayerId });
  }, []);

  const playAgain = useCallback(() => {
    socketRef.current?.emit('game:playAgain');
  }, []);

  return { room, playerId, error, createRoom, joinRoom, startGame, submitClue, castVote, playAgain };
}
```

- [ ] **Step 5: Write the Home screen**

`client/src/screens/HomeScreen.tsx`:
```tsx
import { useState } from 'react';

type Props = {
  onCreate: (nickname: string) => void;
  onJoin: (roomCode: string, nickname: string) => void;
  error: string | null;
};

export function HomeScreen({ onCreate, onJoin, error }: Props) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');

  return (
    <div className="screen home-screen">
      <h1>Blend In</h1>
      <p className="tagline">Everyone gets a word. One of you doesn't. Find them.</p>
      <input placeholder="Your name" value={nickname} onChange={(e) => setNickname(e.target.value)} />
      <div className="home-actions">
        <button disabled={!nickname} onClick={() => onCreate(nickname)}>Create Room</button>
        <div className="join-row">
          <input
            placeholder="Room code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            maxLength={4}
          />
          <button disabled={!nickname || roomCode.length !== 4} onClick={() => onJoin(roomCode, nickname)}>
            Join
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Write the app shell and shared styles**

`client/src/App.tsx`:
```tsx
import { useRoomSocket } from './useRoomSocket';
import { HomeScreen } from './screens/HomeScreen';

export default function App() {
  const session = useRoomSocket();
  const { room, playerId, error, createRoom, joinRoom } = session;

  if (!room || !playerId) {
    return <HomeScreen onCreate={createRoom} onJoin={joinRoom} error={error} />;
  }

  return <p>Room {room.code} — phase: {room.phase}</p>;
}
```

`client/src/index.css` (replaces the Vite default stylesheet):
```css
:root {
  color-scheme: dark;
  --bg: #14141c;
  --panel: #1e1e29;
  --text: #f2f2f7;
  --muted: #9494a6;
  --accent: #7c5cff;
  --error: #ff6b6b;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

#root { width: 100%; max-width: 480px; padding: 1.5rem; }

.screen {
  background: var(--panel);
  border-radius: 16px;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h1 { margin: 0; font-size: 2rem; }
h2 { margin: 0; }
.tagline { color: var(--muted); margin: 0; }
.hint { color: var(--muted); font-size: 0.9rem; }
.error { color: var(--error); font-size: 0.9rem; }

input, select {
  background: var(--bg);
  border: 1px solid #333344;
  color: var(--text);
  padding: 0.6rem 0.8rem;
  border-radius: 8px;
  font-size: 1rem;
}

button {
  background: var(--accent);
  color: white;
  border: none;
  padding: 0.6rem 1rem;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
}

button:disabled { background: #3a3a4a; cursor: not-allowed; }

.home-actions { display: flex; flex-direction: column; gap: 0.75rem; }
.join-row { display: flex; gap: 0.5rem; }
.join-row input { flex: 1; }

.player-list, .vote-list, .score-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.player-list li.disconnected { opacity: 0.5; }

.host-controls { display: flex; flex-direction: column; gap: 0.75rem; }
.host-controls label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; color: var(--muted); }

.clue-feed { padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.3rem; }
.clue-input { display: flex; gap: 0.5rem; }
.clue-input input { flex: 1; }
```

Ensure `client/src/main.tsx` imports `./index.css` (Vite's scaffold already does this by default — confirm the import points at `index.css`, not `App.css`).

- [ ] **Step 7: Manual verification**

Run `npm run dev -w server` and `npm run dev -w client` (two terminals), open `http://localhost:5173`.
Expected: "Blend In" home screen renders. Enter a name, click "Create Room" — page updates to `Room XXXX — phase: lobby`. Stop both dev servers after confirming.

- [ ] **Step 8: Commit**

```bash
git add client/src/types.ts client/src/useRoomSocket.ts client/src/screens client/src/App.tsx client/src/index.css client/vite.config.ts client/package.json client/package-lock.json
git commit -m "Add client socket hook, Home screen, and app styling"
```

---

### Task 8: Lobby screen

**Files:**
- Create: `client/src/screens/LobbyScreen.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `RoomView` (Task 7 `types.ts`), `startGame` action from `useRoomSocket` (Task 7).
- Produces: `<LobbyScreen room playerId onStart />` — rendered by `App.tsx` when `room.phase === 'lobby'`.

- [ ] **Step 1: Write the Lobby screen**

`client/src/screens/LobbyScreen.tsx`:
```tsx
import { useState } from 'react';
import type { RoomView } from '../types';

const WORD_PACKS = [
  { id: 'foods', name: 'Foods' },
  { id: 'animals', name: 'Animals' },
  { id: 'objects', name: 'Everyday Objects' },
];

type Props = {
  room: RoomView;
  playerId: string;
  onStart: (wordPackId: string, imposterCount: number) => void;
};

export function LobbyScreen({ room, playerId, onStart }: Props) {
  const [wordPackId, setWordPackId] = useState('foods');
  const [imposterCount, setImposterCount] = useState(1);
  const isHost = room.hostId === playerId;
  const maxImposters = Math.max(1, room.players.length - 1);

  return (
    <div className="screen lobby-screen">
      <h2>Room {room.code}</h2>
      <ul className="player-list">
        {room.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'disconnected'}>
            {p.nickname}
            {p.id === room.hostId ? ' (host)' : ''}
          </li>
        ))}
      </ul>
      {isHost ? (
        <div className="host-controls">
          <label>
            Word pack
            <select value={wordPackId} onChange={(e) => setWordPackId(e.target.value)}>
              {WORD_PACKS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>
            Imposters
            <input
              type="number"
              min={1}
              max={maxImposters}
              value={imposterCount}
              onChange={(e) => setImposterCount(Number(e.target.value))}
            />
          </label>
          <button disabled={room.players.length < 3} onClick={() => onStart(wordPackId, imposterCount)}>
            Start Game
          </button>
          {room.players.length < 3 && <p className="hint">Need at least 3 players</p>}
        </div>
      ) : (
        <p className="hint">Waiting for host to start...</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into App**

Modify `client/src/App.tsx`:
```tsx
import { useRoomSocket } from './useRoomSocket';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';

export default function App() {
  const session = useRoomSocket();
  const { room, playerId, error, createRoom, joinRoom } = session;

  if (!room || !playerId) {
    return <HomeScreen onCreate={createRoom} onJoin={joinRoom} error={error} />;
  }

  if (room.phase === 'lobby') {
    return <LobbyScreen room={room} playerId={playerId} onStart={session.startGame} />;
  }

  return <p>Room {room.code} — phase: {room.phase}</p>;
}
```

- [ ] **Step 3: Manual verification**

Run both dev servers. Open two browser tabs at `http://localhost:5173`. In tab 1, create a room and note the code; in tab 2, join with that code and a different name.
Expected: both tabs show the lobby with both players listed; only tab 1 (host) sees the word-pack/imposter-count controls and "Start Game" (disabled, since only 2 players).

- [ ] **Step 4: Commit**

```bash
git add client/src/screens/LobbyScreen.tsx client/src/App.tsx
git commit -m "Add Lobby screen with host game-start controls"
```

---

### Task 9: Clue round screen

**Files:**
- Create: `client/src/screens/ClueRoundScreen.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `RoomView` (Task 7), `submitClue` action from `useRoomSocket` (Task 7).
- Produces: `<ClueRoundScreen room playerId onSubmitClue />` — rendered by `App.tsx` when `room.phase === 'clueRound'`.

- [ ] **Step 1: Write the Clue Round screen**

`client/src/screens/ClueRoundScreen.tsx`:
```tsx
import { useState } from 'react';
import type { RoomView } from '../types';

type Props = {
  room: RoomView;
  playerId: string;
  onSubmitClue: (text: string) => void;
};

export function ClueRoundScreen({ room, playerId, onSubmitClue }: Props) {
  const [text, setText] = useState('');
  const game = room.game!;
  const currentTurnId = game.turnOrder[game.turnIndex];
  const isMyTurn = currentTurnId === playerId;
  const nameFor = (id: string) => room.players.find((p) => p.id === id)?.nickname ?? '?';

  const submit = () => {
    if (!text.trim()) return;
    onSubmitClue(text);
    setText('');
  };

  return (
    <div className="screen clue-screen">
      <h2>{game.isImposter ? "You're the imposter — bluff!" : `The word is: ${game.word}`}</h2>
      <ol className="clue-feed">
        {game.clues.map((c, i) => (
          <li key={i}><strong>{nameFor(c.playerId)}:</strong> {c.text}</li>
        ))}
      </ol>
      {isMyTurn ? (
        <div className="clue-input">
          <input
            placeholder="Your clue"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button onClick={submit}>Send</button>
        </div>
      ) : (
        <p className="hint">Waiting for {nameFor(currentTurnId)}...</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into App**

Modify `client/src/App.tsx`:
```tsx
import { useRoomSocket } from './useRoomSocket';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { ClueRoundScreen } from './screens/ClueRoundScreen';

export default function App() {
  const session = useRoomSocket();
  const { room, playerId, error, createRoom, joinRoom } = session;

  if (!room || !playerId) {
    return <HomeScreen onCreate={createRoom} onJoin={joinRoom} error={error} />;
  }

  switch (room.phase) {
    case 'lobby':
      return <LobbyScreen room={room} playerId={playerId} onStart={session.startGame} />;
    case 'clueRound':
      return <ClueRoundScreen room={room} playerId={playerId} onSubmitClue={session.submitClue} />;
    default:
      return <p>Room {room.code} — phase: {room.phase}</p>;
  }
}
```

- [ ] **Step 3: Manual verification**

With three browser tabs joined to one room (host + 2 guests), have the host start a game with 1 imposter.
Expected: two tabs show "The word is: X", one shows "You're the imposter — bluff!". Only the player whose turn it is has an enabled clue input; submitting a clue appends it to the feed in every tab and advances the turn indicator.

- [ ] **Step 4: Commit**

```bash
git add client/src/screens/ClueRoundScreen.tsx client/src/App.tsx
git commit -m "Add Clue Round screen with turn-based clue submission"
```

---

### Task 10: Voting screen

**Files:**
- Create: `client/src/screens/VotingScreen.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `RoomView` (Task 7), `castVote` action from `useRoomSocket` (Task 7).
- Produces: `<VotingScreen room playerId onVote />` — rendered by `App.tsx` when `room.phase === 'voting'`.

- [ ] **Step 1: Write the Voting screen**

`client/src/screens/VotingScreen.tsx`:
```tsx
import type { RoomView } from '../types';

type Props = {
  room: RoomView;
  playerId: string;
  onVote: (targetPlayerId: string) => void;
};

export function VotingScreen({ room, playerId, onVote }: Props) {
  const game = room.game!;
  const hasVoted = game.votedPlayerIds.includes(playerId);

  return (
    <div className="screen voting-screen">
      <h2>Who's the imposter?</h2>
      <p className="hint">{game.votedPlayerIds.length}/{room.players.length} voted</p>
      <ul className="vote-list">
        {room.players.map((p) => (
          <li key={p.id}>
            <button disabled={hasVoted || p.id === playerId} onClick={() => onVote(p.id)}>
              {p.nickname}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into App**

Modify `client/src/App.tsx`:
```tsx
import { useRoomSocket } from './useRoomSocket';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { ClueRoundScreen } from './screens/ClueRoundScreen';
import { VotingScreen } from './screens/VotingScreen';

export default function App() {
  const session = useRoomSocket();
  const { room, playerId, error, createRoom, joinRoom } = session;

  if (!room || !playerId) {
    return <HomeScreen onCreate={createRoom} onJoin={joinRoom} error={error} />;
  }

  switch (room.phase) {
    case 'lobby':
      return <LobbyScreen room={room} playerId={playerId} onStart={session.startGame} />;
    case 'clueRound':
      return <ClueRoundScreen room={room} playerId={playerId} onSubmitClue={session.submitClue} />;
    case 'voting':
      return <VotingScreen room={room} playerId={playerId} onVote={session.castVote} />;
    default:
      return <p>Room {room.code} — phase: {room.phase}</p>;
  }
}
```

- [ ] **Step 3: Manual verification**

Continuing from Task 9's three-tab session, let every player give a clue to reach voting.
Expected: all three tabs show the voting screen with a vote count; clicking a name casts a vote and disables further voting for that tab; once all three have voted, phase advances automatically (screen will still show "phase: reveal" placeholder text until Task 11).

- [ ] **Step 4: Commit**

```bash
git add client/src/screens/VotingScreen.tsx client/src/App.tsx
git commit -m "Add Voting screen with live vote tally"
```

---

### Task 11: Reveal screen and play again

**Files:**
- Create: `client/src/screens/RevealScreen.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `RoomView` (Task 7), `playAgain` action from `useRoomSocket` (Task 7).
- Produces: `<RevealScreen room playerId onPlayAgain />` — rendered by `App.tsx` when `room.phase === 'reveal'`. This completes the phase switch in `App.tsx` (no more placeholder default case).

- [ ] **Step 1: Write the Reveal screen**

`client/src/screens/RevealScreen.tsx`:
```tsx
import type { RoomView } from '../types';

type Props = {
  room: RoomView;
  playerId: string;
  onPlayAgain: () => void;
};

export function RevealScreen({ room, playerId, onPlayAgain }: Props) {
  const game = room.game!;
  const nameFor = (id: string) => room.players.find((p) => p.id === id)?.nickname ?? '?';
  const isHost = room.hostId === playerId;

  return (
    <div className="screen reveal-screen">
      <h2>The word was: {game.word}</h2>
      <p>Imposter{game.imposterIds!.length > 1 ? 's' : ''}: {game.imposterIds!.map(nameFor).join(', ')}</p>
      <ul className="score-list">
        {[...room.players].sort((a, b) => b.score - a.score).map((p) => (
          <li key={p.id}>{p.nickname}: {p.score}</li>
        ))}
      </ul>
      {isHost ? <button onClick={onPlayAgain}>Play Again</button> : <p className="hint">Waiting for host...</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into App**

Modify `client/src/App.tsx`:
```tsx
import { useRoomSocket } from './useRoomSocket';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { ClueRoundScreen } from './screens/ClueRoundScreen';
import { VotingScreen } from './screens/VotingScreen';
import { RevealScreen } from './screens/RevealScreen';

export default function App() {
  const session = useRoomSocket();
  const { room, playerId, error, createRoom, joinRoom } = session;

  if (!room || !playerId) {
    return <HomeScreen onCreate={createRoom} onJoin={joinRoom} error={error} />;
  }

  switch (room.phase) {
    case 'lobby':
      return <LobbyScreen room={room} playerId={playerId} onStart={session.startGame} />;
    case 'clueRound':
      return <ClueRoundScreen room={room} playerId={playerId} onSubmitClue={session.submitClue} />;
    case 'voting':
      return <VotingScreen room={room} playerId={playerId} onVote={session.castVote} />;
    case 'reveal':
      return <RevealScreen room={room} playerId={playerId} onPlayAgain={session.playAgain} />;
  }
}
```

- [ ] **Step 3: Manual verification**

Continuing from Task 10, finish voting in all three tabs.
Expected: all tabs land on the reveal screen showing the same word, the same imposter name(s), and updated scores. Clicking "Play Again" (host tab only) returns every tab to the lobby with scores preserved.

- [ ] **Step 4: Commit**

```bash
git add client/src/screens/RevealScreen.tsx client/src/App.tsx
git commit -m "Add Reveal screen with scoring and play-again flow"
```

---

### Task 12: README and full end-to-end smoke test

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nothing new — this task only documents and exercises the finished system from Tasks 1-11.
- Produces: nothing consumed by later tasks (final task).

- [ ] **Step 1: Write the README**

`README.md`:
```markdown
# Blend In

A real-time social deduction word game. Everyone in the room gets the same
secret word except the imposter(s), who have to bluff through a clue round
before the group votes on who's faking it.

## Run it

```bash
npm install
npm run dev
```

This starts the server on `http://localhost:3001` and the client on
`http://localhost:5173`. Open the client URL in multiple browser tabs (or
devices on the same network, using your machine's LAN IP instead of
`localhost`) to play with more than one player.

## Test

```bash
npm test
```

Runs the server's Vitest suite (`RoomManager`, `GameEngine`, room-view
redaction, and a full Socket.IO integration test). The client has no
automated tests in v1 — verify screens manually in the browser.

## How it works

- `server/` — Express + Socket.IO. Room and game state live in memory
  (`RoomManager`, `GameEngine`); a per-player `buildRoomView` redacts the
  secret word and imposter identity from anyone who shouldn't see them yet.
- `client/` — Vite + React. `useRoomSocket` owns the Socket.IO connection;
  `App.tsx` renders one screen per game phase (lobby, clue round, voting,
  reveal).
```

- [ ] **Step 2: Full end-to-end smoke test**

Run `npm run dev` from the repo root. Open three browser tabs to `http://localhost:5173`:
1. Tab 1: enter a name, "Create Room", note the 4-character code.
2. Tabs 2 and 3: enter different names, join with that code.
3. In Tab 1 (host), pick a word pack and 1 imposter, "Start Game".
4. Confirm exactly one tab shows "You're the imposter"; the other two show the same word.
5. Submit a clue in each tab in turn order (input only enabled on your turn).
6. Once all three clues are in, confirm every tab shows the voting screen; vote in each tab.
7. Confirm every tab reaches the reveal screen with the same word, same imposter name, and updated scores.
8. Click "Play Again" in Tab 1; confirm all three tabs return to the lobby with scores intact.
9. Refresh Tab 2 mid-lobby; confirm it reconnects into the same room (via `room:reconnect`) rather than returning to the home screen.

Expected: all nine steps behave as described, no console errors in any tab.

- [ ] **Step 3: Run the full server test suite one last time**

Run: `npm test`
Expected: PASS, all suites green.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Add README with run instructions and project overview"
```
