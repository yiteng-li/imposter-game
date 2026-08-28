-- supabase/migrations/0002_leave_room.sql
--
-- 0001 has already been applied to the hosted project, so this adds the new
-- policy as its own migration rather than editing an already-applied file
-- (the Supabase CLI tracks applied migrations by filename and silently
-- no-ops a re-push of one it's already seen, even if the content changed).

-- Leaving a room removes only your own row — narrower than the update policy
-- on players, since there's no reason for one player to remove another.
-- Without this, RLS silently makes "leave room" delete zero rows (the same
-- failure mode the rooms delete policy in 0001 exists to prevent).
create policy "players delete themselves" on players
  for delete
  using (auth.uid() = id);
