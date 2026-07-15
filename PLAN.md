# Švytintys ganytojai — Build Plan

**Backend:** Supabase project `Encounter game` (`shgbvoxbwmhhridiihxn`), eu-central-1, dedicated/isolated.
**Repo:** `encounter_game/`.
**Frontend:** existing React/Vite (TanStack Start) prototype "Urban Quest UI" — must include all features of `Stand alone HTML/Riddle Platform v2.html`.
**Hosting:** Vercel. **Session duration:** 8 hours. **Admin:** passcode-gated.
**Event:** real outdoor riddle game near Merkinė, LT on 2026-07-18/19 (3 days out). 5–8 teams, families, phones, weak mobile signal, ~6.5 km route.

Sources of truth: `MD files/01_SPEC.md`, `02_SUPABASE.md`, `03_CONTENT_ASSETS.md`, `CLAUDE.md`; content `Game setup.xlsx`; media `Illustrations and videos/`.

## Phase 0 — Repo scaffold & content reconciliation
- Scaffold `supabase/migrations/`, `scripts/`, `src/`, `assets/`, `.gitignore` (ignore `.env`, service-role key).
- Copy media → `assets/` with exact filenames (no renaming).
- Parse `Game setup.xlsx`, diff against 03_CONTENT_ASSETS §1 (13 questions; hints 5,5,5,5,4,5,5,5,5,5,5,6,0; reveal times). List assets present vs referenced; render-or-skip missing per spec.

## Phase 1 — Supabase backend (migrations, applied via MCP + saved as files)
- `0001_schema`: games, questions, question_secrets (answers isolated), hints, teams, team_progress, answer_attempts + indexes.
- `0002_session_ttl`: `games.expires_at`; every RPC rejects when `now() >= expires_at` → token dies server-side.
- `0003_rls`: public read of static content minus answers & hint contents.
- `0004_rpc`: normalize_answer, register_team, get_state (never returns locked hints), submit_answer, mark_hint_revealed, admin_skip, admin_reset.
- `0005_realtime`: Realtime on team_progress + teams.
- Then get_advisors (security).

## Phase 2 — Content pipeline
- `scripts/seed.ts` (SheetJS) parses `Game setup.xlsx` (Questions/Hints/Marsrutas), upserts game→questions→hints→route, builds blocks JSON.
- Upload `assets/` → Storage bucket `game-assets` (public read); verify every referenced file resolves, fail loudly if missing.
- Service-role key entered locally only (untracked `.env`), never committed.

## Phase 3 — Player frontend
- React prototype wired to Supabase anon key + RPCs only (no direct table writes).
- Screens: registration→register_team (activates U1); stage screen (tappable geo location, intro, media blocks, fixed `FA_` prefix input, hints panel w/ live countdowns); correct→next; U13→finish w/ total time.
- State restore via get_state (timing from server activated_at). 1:1 design tokens.

## Phase 4 — Admin dashboard
- `/admin`, passcode-gated server-side. Live board (realtime), stuck alert (>25 min past last hint), force-skip/reset, attempts log, leaderboard (duration; tiebreak fewer hints).

## Phase 5 — Game lifecycle: session TTL + master template + re-run
- Organizer sets duration (default 8h); expires_at enforced everywhere; on expiry players see expired screen, tokens invalid.
- Content = reusable master template. "New game" admin action creates fresh games row + clears teams/progress/attempts, keeps content.

## Phase 6 — Offline resilience & mobile hardening
- Answer submit: queue + retry with visible "nėra ryšio…" state; never lose/duplicate (idempotency). localStorage = cache only. Portrait, 360px. JS < 300 KB gz; Lighthouse mobile ≥ 80.

## Phase 7 — Acceptance + deploy
- Run full SPEC §9 checklist. Deploy frontend to Vercel. Real-phone dry run. Commit locally (user pushes).
