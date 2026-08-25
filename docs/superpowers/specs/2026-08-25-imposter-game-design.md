# Social Deduction Word Game — Design Spec

Date: 2026-08-25

## Summary

An original real-time multiplayer party game in the "secret word imposter"
genre (players get a shared secret word except one or more imposters, who
must bluff through a clue round while everyone else tries to find them).
This is an original implementation of the general game mechanic — its own
branding, visual design, copy, and word-pack content — built with React and
Node, not a copy of any existing product's specific design or content.

## Goals

- Real-time online rooms: players join from separate devices via a room code.
- Full game loop: lobby → role assignment → clue round → discussion/vote →
  reveal → replay.
- No database for v1 — rooms are ephemeral, in-memory state is acceptable.
- Clean, testable separation between game logic and transport (Socket.IO).

## Non-goals (v1)

- Persistence across server restarts.
- Accounts/auth, friend lists, stats history.
- Spectators, private word-pack authoring UI, mobile app wrapper.

## Architecture

Monorepo, two packages:

- `server/` — Node + Express + Socket.IO (TypeScript).
- `client/` — Vite + React + TypeScript.

Root `package.json` uses npm workspaces to run both with a single
`npm run dev` (concurrently starts server on :3001, client on :5173 with a
proxy for the socket connection).

### Server

- `RoomManager` — in-memory `Map<roomCode, Room>`. Handles create/join/leave,
  room-code generation (4-char alphanumeric, collision-checked), and idle
  room cleanup (rooms with 0 connected players for >2 min are deleted).
- `GameEngine` — pure functions operating on a `Room`'s `game` sub-state:
  `startGame`, `submitClue`, `advanceTurn`, `startVote`, `castVote`,
  `tallyVotes`, `resetForReplay`. No I/O — takes state + action, returns new
  state + events to emit. This is what gets unit tested.
- `wordPacks/*.json` — original topic packs (e.g. "Foods", "Movies",
  "Everyday Objects"), each a list of `{ word, category }`. Authored fresh
  for this project.
- Socket.IO event handlers in `server/src/socket.ts` are the only place that
  touches `RoomManager`/`GameEngine` and emits events — thin glue layer.

Socket events (client→server / server→client):

- `room:create` `{ nickname }` → `room:created { roomCode, playerId }`
- `room:join` `{ roomCode, nickname }` → `room:joined {...}` / `room:error`
- `room:state` (server→all, broadcast on every state change) — the single
  source of truth the client renders from.
- `game:start` `{ imposterCount, wordPackId }` (host only)
- `game:submitClue` `{ text }`
- `game:startVote` (host only, or auto after clue round completes)
- `game:castVote` `{ targetPlayerId }`
- `game:playAgain` (host only)

### Client

- `useRoomSocket()` hook: owns the Socket.IO client connection, exposes
  current `RoomState` (typed, mirrors server's `Room` shape) and action
  dispatchers (`createRoom`, `joinRoom`, `startGame`, `submitClue`, `vote`,
  ...). Single hook consumed by a top-level `<Game>` component that switches
  rendered screen based on `room.phase`.
- Screens: `HomeScreen` (create/join form), `LobbyScreen` (player list,
  host-only start controls), `ClueRoundScreen` (turn order, clue input/feed),
  `VotingScreen` (vote buttons, live tally of who's voted), `RevealScreen`
  (word, imposter identity, vote breakdown, score, "play again").
- Shared types live in a `shared/` package (or duplicated `types.ts` if
  workspace type-sharing proves annoying) so client and server agree on
  `RoomState`/`Player`/event payload shapes.

## Data model (sketch)

```ts
type Player = { id: string; nickname: string; connected: boolean; score: number };

type Room = {
  code: string;
  hostId: string;
  players: Player[];
  phase: 'lobby' | 'clueRound' | 'voting' | 'reveal';
  game: {
    wordPackId: string;
    word: string;
    imposterIds: string[];
    turnOrder: string[];
    clues: { playerId: string; text: string }[];
    votes: Record<string, string>; // voterId -> targetId
  } | null;
};
```

## Error handling

- Invalid/unknown room code → `room:error` with a user-facing message,
  client shows inline form error, no navigation.
- Player disconnects mid-game → marked `connected: false`, seat kept (grace
  period) so a refresh can rejoin via a client-stored `playerId`/`roomCode`;
  removed on room cleanup if they never return.
- Action received out-of-phase (e.g. clue submitted during voting) →ignored
  server-side with a logged warning; server state is authoritative, so a
  desynced client can't corrupt the room.

## Testing

- Vitest unit tests for `GameEngine` — one test per transition (start,
  submit clue in/out of turn, full clue round completion, vote tally with a
  tie, replay reset).
- One Socket.IO integration test: spin up the server, connect two test
  clients, walk through create → join → start → clue → vote → reveal.
- No client component tests in v1 (manual verification in browser per
  project conventions); can add React Testing Library later if the UI grows.

## Open questions / deferred

- Tie-breaking rule on votes (currently: no imposter eliminated, round
  continues) — flagged as a tunable in `GameEngine`, not hardcoded.
- Word-pack content is a starting set of ~3 packs, ~20 words each — easy to
  extend by adding JSON files.
