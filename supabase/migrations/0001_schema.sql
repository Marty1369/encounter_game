-- 0001_schema.sql — content + runtime tables (hardened per Codex/red-team review)
-- Švytintys ganytojai — Supabase schema.
-- Security model: anon has NO direct writes and only narrow reads; answers & hint
-- contents never sit on a publicly-readable table. RLS + policies in 0003.

-- Content owner = master template AND the single active session.
create table games (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null default 'svytintys-ganytojai',
  title text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,                       -- session TTL; null = not started
  session_generation int not null default 1,    -- bump invalidates all team tokens (new game / reset)
  max_teams int not null default 12             -- spam cap (5-8 expected)
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  code text not null,                -- 'U1'..'U13'
  ord int not null,                  -- 1..13, play order
  title text not null,
  intro text not null,
  location_name text,
  lat double precision,
  lng double precision,
  blocks jsonb not null default '[]',-- [{type:'video'|'image'|'text', src?, text?}]
  unique (game_id, code),
  unique (game_id, ord)
);

-- Answers isolated here: NEVER gets a select policy, never exposed via PostgREST.
create table question_secrets (
  question_id uuid primary key references questions(id) on delete cascade,
  answer text not null,                       -- with FA_ prefix, e.g. 'FA_KAZIMIERAS'
  alt_answers text[] not null default '{}'    -- U11: {'FA_FABIANAS'}
);

-- Hint contents also never get a public select policy; they flow only via get_state,
-- and only after their time gate opens.
create table hints (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  ord int not null,                  -- 1..6
  reveal_after_min int not null,     -- per-question values from xlsx
  type text not null check (type in ('text','image')),
  content text not null,             -- text, or 'file.png' or 'file.png — caption'
  unique (question_id, ord)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  name text not null,
  session_token uuid not null default gen_random_uuid(),
  session_generation int not null,   -- stamped from games at register; stale => rejected
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on teams (game_id);

create table team_progress (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  question_id uuid not null references questions(id),
  activated_at timestamptz not null default now(),   -- server-authoritative stage start
  solved_at timestamptz,
  skipped boolean not null default false,
  hints_revealed int not null default 0,
  unique (team_id, question_id)
);
create index on team_progress (team_id);

create table answer_attempts (
  id bigint generated always as identity primary key,
  team_id uuid not null references teams(id) on delete cascade,
  question_id uuid not null references questions(id),
  raw_input text not null,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);
create index on answer_attempts (team_id, created_at);

-- Idempotency for weak-signal retries: same client mutation_id replays the stored result
-- instead of creating a duplicate attempt or advancing twice.
create table submit_idempotency (
  mutation_id uuid primary key,
  team_id uuid not null references teams(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);
