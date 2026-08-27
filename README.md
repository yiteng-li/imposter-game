# Blend In

A social deduction word game you play together in the same room, each on your
own phone. One player creates a room and reads out the 4-letter code; everyone
else joins with it. Everyone gets the same secret word except the imposter(s) —
each phone shows only its own card — then everyone gives a spoken clue in turn
and votes on who's faking it.

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

## Test

```bash
npm test
```

Runs the Vitest suite covering the pure game logic, the room-code generator,
the Supabase client/auth helpers, and the row mappers in `src/lib/rooms.ts`.
`src/lib/assignments.rls.test.ts` is excluded by default — it needs a running
`npx supabase start`; run it with `npm test -- src/lib/assignments.rls.test.ts`.

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
