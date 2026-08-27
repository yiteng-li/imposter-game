# Blend In

A single-page, pass-and-play social deduction word game. Everyone at the
table gets the same secret word except the imposter(s) — pass one phone or
laptop around, everyone gives a spoken clue in turn, then vote on who's
faking it.

## Run it

```bash
npm install
npm run dev
```

Open the printed `http://localhost:5173` URL. Everything runs client-side —
add players, then pass the device around for the reveal, clue round, and
vote.

## Test

```bash
npm test
```

Runs the Vitest suite for the game logic (`assignRoles`, `tallyVotes`,
`scorePlayers`).

## How it works

- `src/gameLogic.ts` — pure functions: assign the word/imposter(s) for a
  round, tally votes, score players.
- `src/App.tsx` — a small state machine (`setup` → `reveal` → `clueRound` →
  `voting` → `results`) that drives which screen renders.
- `src/screens/` — one component per phase. `RevealScreen` and
  `VotingScreen` are built around passing the device: each shows "pass to
  <player>" and only reveals that player's information after they tap.

## Multi-device play (planned)

Design in progress for playing with everyone on their own phone (still
same room, still spoken-aloud clues) via a room code instead of passing
one device around. See
[`docs/superpowers/specs/2026-08-27-multi-device-play-design.md`](docs/superpowers/specs/2026-08-27-multi-device-play-design.md)
for the full design — Supabase for realtime sync + Postgres Row-Level
Security to keep each player's role/word hidden from the others, no
server-authoritative game logic beyond that.
