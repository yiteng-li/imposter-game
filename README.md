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
