-- 0005_platform_schema.sql — pivot from single game to a multi-game PLATFORM.
-- Drops the single-game objects and rebuilds a game-hosting model:
-- themes (reusable) · games (pin/status/theme/TTL) · questions/hints (per game) ·
-- teams + players (join by PIN, pick/create a team, enter a name) · progress/attempts.
-- Keeps app_config (admin passcode) and the hardening patterns (secrets isolated,
-- idempotent submit, SQL-gated hints, session_generation), now keyed per game.

-- ---- drop old single-game objects ----
drop function if exists register_team(text) cascade;
drop function if exists get_state(uuid) cascade;
drop function if exists submit_answer(uuid, text, uuid) cascade;
drop function if exists mark_hint_revealed(uuid, uuid) cascade;
drop function if exists admin_board(text) cascade;
drop function if exists admin_skip(text, uuid) cascade;
drop function if exists admin_reset(text, uuid) cascade;
drop function if exists admin_extend(text, int) cascade;
drop function if exists admin_new_game(text, int) cascade;
drop function if exists _resolve_session(uuid) cascade;
drop function if exists _state_json(teams, games) cascade;
drop table if exists submit_idempotency, answer_attempts, team_progress, teams,
  hints, question_secrets, questions, games cascade;

-- ---- reusable themes (Themes tab) ----
create table themes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tokens jsonb not null default '{}',   -- {bg,card,ink,inkSoft,primary,onPrimary,muted,line,field,fontDisplay,fontBody,displayWeight,displayTracking,rBtn,rCard,rFrame,rInput}
  created_at timestamptz not null default now()
);

-- ---- games ----
create table games (
  id uuid primary key default gen_random_uuid(),
  pin text unique not null,                       -- short join code
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','ready','live','ended')),
  theme_id uuid references themes(id) on delete set null,
  theme jsonb not null default '{}',              -- snapshot applied at go-live
  duration_min int not null default 240,          -- session length when it goes live
  expires_at timestamptz,                         -- set on go-live
  session_generation int not null default 1,      -- bump = new run, invalidates tokens
  max_teams int not null default 20,
  created_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  ord int not null,
  title text not null,
  intro text,
  location_name text, lat double precision, lng double precision,
  blocks jsonb not null default '[]',             -- [{type:text|image|video|audio|link, text?, url?, caption?}]
  unique (game_id, ord)
);

-- answers isolated: never a public read
create table question_secrets (
  question_id uuid primary key references questions(id) on delete cascade,
  answer text not null,
  alt_answers text[] not null default '{}'
);

create table hints (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  ord int not null,
  reveal_after_min int not null default 0,
  text text,                                      -- hint copy
  media_type text check (media_type in ('image','video','audio','link')),
  media_url text,
  unique (question_id, ord)
);

-- teams are game-scoped; players join a team by name
create table teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  name text not null,
  session_generation int not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (game_id, name)
);
create index on teams (game_id);

create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  session_token uuid not null default gen_random_uuid(),  -- per player; shares team progress
  created_at timestamptz not null default now()
);
create index on players (team_id);

create table team_progress (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  activated_at timestamptz not null default now(),
  solved_at timestamptz,
  skipped boolean not null default false,
  hints_revealed int not null default 0,
  unique (team_id, question_id)
);
create index on team_progress (team_id);

create table answer_attempts (
  id bigint generated always as identity primary key,
  team_id uuid not null references teams(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  player_id uuid references players(id) on delete set null,
  raw_input text not null,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);
create index on answer_attempts (team_id, created_at);

create table submit_idempotency (
  mutation_id uuid primary key,
  team_id uuid not null references teams(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);

-- ---- RLS: deny-all to clients; everything flows through RPCs / admin edge function ----
alter table themes enable row level security;
alter table games enable row level security;
alter table questions enable row level security;
alter table question_secrets enable row level security;
alter table hints enable row level security;
alter table teams enable row level security;
alter table players enable row level security;
alter table team_progress enable row level security;
alter table answer_attempts enable row level security;
alter table submit_idempotency enable row level security;

revoke select on themes, games, questions, question_secrets, hints, teams, players,
  team_progress, answer_attempts, submit_idempotency from anon, authenticated;

-- unique short PIN generator (avoids ambiguous chars)
create or replace function gen_pin() returns text
language plpgsql as $$
declare p text; chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    p := '';
    for i in 1..6 loop p := p || substr(chars, 1 + floor(random()*length(chars))::int, 1); end loop;
    exit when not exists (select 1 from games where pin = p);
  end loop;
  return p;
end $$;
