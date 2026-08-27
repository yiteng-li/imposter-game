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
  -- "I've seen my card" for the current round. Lives here, not on assignments,
  -- because assignments' RLS hides other players' rows until 'results' — a ready
  -- flag there would be uncountable, so reveal could never detect "everyone's in".
  -- Reset to false at every round start (see startRound in src/lib/rooms.ts).
  ready boolean not null default false,
  joined_at timestamptz not null default now()
);

create table assignments (
  room_id uuid not null references rooms(id) on delete cascade,
  round_number int not null,
  player_id uuid not null references players(id) on delete cascade,
  is_imposter boolean not null,
  word text,
  primary key (room_id, round_number, player_id)
);

create table votes (
  room_id uuid not null references rooms(id) on delete cascade,
  round_number int not null,
  voter_id uuid not null references players(id) on delete cascade,
  -- cascade like every other FK here: deleting a room removes players and votes
  -- in an unspecified order, so target_id must not block the delete either.
  target_id uuid not null references players(id) on delete cascade,
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

-- Without this, RLS silently makes "New game" delete zero rows.
create policy "room members can delete room" on rooms
  for delete
  using (auth.uid() in (select id from players where players.room_id = rooms.id));

-- players: names/scores/ready aren't secret.
create policy "players are publicly readable" on players
  for select using (true);

create policy "players insert themselves" on players
  for insert with check (auth.uid() = id);

-- Covers both score writes at scoring time and each player's own ready flag.
create policy "room members can update players" on players
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

-- No UPDATE policy on assignments: rows are written once at round start and
-- never modified (readiness lives on players.ready).

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
