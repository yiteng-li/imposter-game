# Multi-device play (room codes)

## Goal

Replace "pass one device around the table" with each player joining from
their own phone via a short room code, while keeping the game itself
unchanged: everyone is still physically together, clues are still spoken
out loud, nothing becomes remote play.

## Non-goals

- Remote/async play (players in different locations, typed clues) — out of
  scope; if wanted later, only the clue round needs to change.
- Accounts, saved history across sessions, or rooms that outlive the game.
- Anti-cheat against an actively hostile player. The trust model is "same
  room, friends" — the design hides secrets from casual glance (Row-Level
  Security on the imposter/word assignment) but does not defend against
  someone reading their own browser's network tab out of spite.

## Identity & room lifecycle

Each phone authenticates via **Supabase anonymous auth** on first load,
giving it a stable `auth.uid()` persisted in `localStorage` — a page reload
keeps the same seat.

- **Create**: the creator picks a word pack + imposter count, taps "Create
  room". The app generates a 4-character uppercase code (regenerating on
  the rare unique-constraint collision), inserts a `rooms` row, and the
  creator becomes `host_id`.
- **Join**: everyone else enters the code + their name, inserted as a
  `players` row linked to that room.
- **Start**: only the host can tap "Start", and only once `players.length
  >= 3` (the existing `assignRoles` floor). This is the one asymmetric
  action in an otherwise host-less flow — see "Distributed vs. host"
  below. "Play again" and "New game" are also host-only, since they're the
  same action.
- Rooms are ephemeral by convention: nothing actively expires them, but
  nothing depends on them surviving past everyone closing the tab either.

## Distributed vs. host

Every transition *after* Start is distributed — no single device drives
it. Reveal readiness, clue turns, and voting all advance based on what
players themselves do, detected via Realtime subscriptions. Start (and
its equivalents, Play again / New game) are the sole exception: they need
exactly one initiator, and "whoever created the room" is simpler than
inventing a new distributed-consensus rule for a 3-6 player party game.

## Data model

Four tables, all scoped by `room_id`:

```sql
create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_id uuid not null,
  phase text not null default 'setup',   -- setup | reveal | clueRound | voting | results
  pack_id text,
  imposter_count int not null default 1,
  round_number int not null default 0,
  round_scored boolean not null default false,
  turn_order uuid[] not null default '{}',
  turn_index int not null default 0,
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key,                    -- = auth.uid() of the owning device
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  score int not null default 0,
  ready boolean not null default false,   -- "I've seen my card" for the current round
  joined_at timestamptz not null default now()
);

create table assignments (
  room_id uuid not null references rooms(id) on delete cascade,
  round_number int not null,
  player_id uuid not null references players(id) on delete cascade,
  is_imposter boolean not null,
  word text,                              -- null for the imposter
  primary key (room_id, round_number, player_id)
);

create table votes (
  room_id uuid not null references rooms(id) on delete cascade,
  round_number int not null,
  voter_id uuid not null references players(id) on delete cascade,
  target_id uuid not null references players(id) on delete cascade,
  primary key (room_id, round_number, voter_id)
);
```

**Readiness lives on `players`, not on `assignments`.** It is a
publicly-countable signal — "3/5 have seen their card" — and `assignments`
is exactly the table RLS makes *un*-countable before `results`: a client
querying it during `reveal` gets back only its own row, so a `ready` column
there could never be summed to `N of N`. `players` has no such restriction
(`select using (true)`), so every phone can count it. The tradeoff is that
`players.ready` persists across rounds instead of being implicitly reset by a
fresh `assignments` row, so `startRound`/`playAgain` must explicitly clear it
for every player in the room before flipping the phase to `reveal`.

Nothing in `rooms`, `players`, or `votes` is secret — code, phase, turn
order, names, scores, readiness, and vote targets are all readable by anyone
in the room, including mid-vote (matching the original pass-and-play version,
which never hid vote targets either).

`assignments` is the one table with real secrets, enforced by RLS:

```sql
alter table assignments enable row level security;

create policy "own row, or room is past voting"
  on assignments for select
  using (
    player_id = auth.uid()
    or exists (
      select 1 from rooms
      where rooms.id = assignments.room_id
        and rooms.phase = 'results'
    )
  );
```

Before `results`, a phone can only ever `SELECT` its own assignment row —
the same guarantee "pass the phone" gave physically, now enforced by
Postgres instead of trust. Once the round reaches `results`, every row
becomes visible so the results screen can say who the imposter was.

`rooms` UPDATE — and DELETE, which "New game" needs; with RLS on and no
DELETE policy Postgres silently deletes nothing — is restricted to players
who belong to that room (`auth.uid() in (select id from players where room_id
= rooms.id)`), except the `setup -> reveal` transition (Start) and any
`round_number` bump (Play again), which additionally require `host_id =
auth.uid()`. `players` UPDATE is likewise room-member-scoped, covering both
score writes at scoring time and each player's own `ready` flag.

## Phase-by-phase flow

Every transition after Start follows the same pattern: a client notices a
completion condition through its live subscription and fires a **guarded
update** — `WHERE phase = '<expected-current>'` — so if two phones notice
simultaneously, only the first write lands; the rest are harmless no-ops.
Referred to below as CAS (compare-and-swap).

1. **Reveal**: each phone reads only its own `assignments` row for the
   current round — "You're Bob, word is *lighthouse*" or "You're the
   IMPOSTER". Tapping "Got it" sets its own `players.ready = true` (see the
   note in Data model on why readiness lives there and not on
   `assignments`). The screen shows a live "waiting… 3/5 ready" count from
   the Realtime subscription. Whichever tap brings the count to 100% fires
   the CAS into `clueRound`.
2. **Clue round**: `turn_order` / `turn_index` live on `rooms` (not
   secret, so no RLS concern). Every phone shows "It's X's turn"; X's own
   phone gets a highlighted "your turn — say it, then Next" button, other
   phones see it read-only. The last player's "Next" CAS-transitions into
   `voting`.
3. **Voting**: each phone shows only its own vote UI (no shared
   voter-index anymore) — pick who you think the imposter is, which
   upserts a row into `votes`, with a live "3/5 voted" count. Once the
   count reaches the player total, the CAS does two things: flips
   `phase -> results`, and flips `round_scored -> true` guarded by `WHERE
   round_scored = false` — so exactly one client's write applies
   `scorePlayers`'s score increments, even though every client
   independently computes the same tally locally (via the existing,
   unchanged `tallyVotes`/`scorePlayers`) to display.
4. **Results**: same data every phone; assignments are now fully visible
   per the RLS rule above, so the imposter's identity and word are shown
   to everyone.
5. **Play again / New game** (host-only): Play again bumps
   `round_number`, resets `round_scored`, re-runs `assignRoles`, inserts a
   fresh `assignments` batch and `turn_order`, and flips back to
   `reveal`, and clears every player's `ready`. New game deletes the room
   row; the `on delete cascade`s clear
   players/assignments/votes, and every phone's subscription sees the room
   vanish and drops back to the join/create screen.

## Reuse vs. rework

- **Untouched**: `gameLogic.ts` (`assignRoles`, `tallyVotes`,
  `scorePlayers`) and its Vitest suite. Still pure, still called the same
  way — just fed by synced data instead of local state.
- **Rewritten**: `App.tsx`'s local state machine becomes a `useRoom(code)`
  hook subscribing to the four tables via Supabase Realtime, exposing
  `phase` + typed data + action functions (`join`, `startRound`,
  `markReady`, `advanceTurn`, `vote`). Each screen keeps its current
  visual shape but reads from the hook instead of props/local state.
- **New**: `SetupScreen` splits into `CreateRoomScreen` (pack + imposter
  count -> code) and `JoinRoomScreen` (code + name); `src/lib/supabase.ts`
  (client + anonymous sign-in); the SQL schema + RLS policies above as a
  Supabase migration.

## Error handling / edge cases

- Room-code collision on create: regenerate and retry.
- Unknown/mistyped code on join: "room not found," no special handling.
- Joining a room whose phase is past `setup`: rejected. A late joiner would
  raise the "everyone ready / everyone voted" target beyond what the
  in-flight round can reach, wedging the room, and would have no assignment
  row of their own to show.
- Any failed action (bad code, started room, duplicate join, blocked write):
  the message surfaces on-screen rather than leaving a dead-looking button.
- Fewer than 3 players: reuse `assignRoles`'s existing guard — grey out
  "Start" until met.
- Refresh mid-game: anonymous auth session persists, Realtime
  auto-reconnects, reload resumes in place.
- A player who disconnects and never readies/votes: the room stalls
  waiting for them (the completion count never reaches 100%). No
  timeout/kick mechanism in v1 — same-room friends can just say "tap it" —
  flagged here as a known limitation. Upgrade path: host-forced-skip.

## Testing

`gameLogic.ts` keeps its existing Vitest coverage, unchanged. The one new
piece worth an actual check is the `assignments` RLS policy, since it's
the security boundary the whole "no more peeking" guarantee rests on: an
integration test (via `supabase start`'s local Postgres) asserting player
A's client cannot `SELECT` player B's assignment row before `results`,
and can after. The Realtime/glue code is wiring, not logic — covered by
manual two-tab testing rather than mocked unit tests.
