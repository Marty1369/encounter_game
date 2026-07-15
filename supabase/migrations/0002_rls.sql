-- 0002_rls.sql — Row Level Security.
-- Fixes the original spec's token leak: teams is NOT publicly readable.
-- Anon gets exactly one public read (the games row: title + expiry). Everything else
-- flows through SECURITY DEFINER RPCs. Players never see future stages or answers.

alter table games              enable row level security;
alter table questions          enable row level security;
alter table question_secrets   enable row level security;
alter table hints              enable row level security;
alter table teams              enable row level security;
alter table team_progress      enable row level security;
alter table answer_attempts    enable row level security;
alter table submit_idempotency enable row level security;

-- Only the games row is publicly readable (no secrets: title, slug, expiry, counters).
create policy read_games on games for select using (true);

-- No select policies anywhere else => anon reads nothing directly (RLS denies by default).
-- Defense in depth: hard-revoke SELECT on the most sensitive tables from client roles,
-- so even a future accidental policy can't expose them.
revoke select on question_secrets from anon, authenticated;
revoke select on hints            from anon, authenticated;
revoke select on teams            from anon, authenticated;
revoke select on answer_attempts  from anon, authenticated;
revoke select on submit_idempotency from anon, authenticated;
-- questions & team_progress keep their grants but have no policy; they are reached only
-- via RPCs (security definer bypasses RLS). Left revocable if we ever add realtime.
revoke select on questions        from anon, authenticated;
revoke select on team_progress    from anon, authenticated;
