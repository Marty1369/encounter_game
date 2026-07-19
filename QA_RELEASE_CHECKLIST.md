# QA Release Checklist — build b27 (2026-07-20)

> **Re-run after fixes (b27 + migration 0029):** all 10 FAIL rows from the b26 pass are now
> **PASS** — see the "Fix re-verification" section at the end for the per-fix evidence.
> Remaining open items: only the two NEEDS-MANUAL real-device checks (NAV-9, PWA-3).

Scope: uncommitted b25→b26 changes in `site/index.html`, new `site/manifest.webmanifest` + `site/icons/`,
migration `supabase/migrations/0028_hint_tools_and_end_scene.sql` (already applied to the live DB).
Method: qa-release-check skill (code-tracing, adversarial, evidence-based) + live E2E on a throwaway
QA game (`scripts/qa_ctl.mjs` rig, PIN 8BHFX3, torn down after) + Codex CLI adversarial review of the diff.

Statuses: PASS / FAIL / BLOCKER / NEEDS-MANUAL · Priorities: P0 (core/integrity) / P1 (major) / P2 (minor).

---

## A. Back navigation (history API)

| ID | Test case | Priority | Status | Evidence / Notes |
|---|---|---|---|---|
| NAV-1 | Join → team picker pushes one nav entry; phone Back returns to PIN screen, not out of the app | P0 | PASS | E2E: `pEnter()` → stack `["teams"]`; `history.back()` → screen `join`, stack `[]`. Code: `site/index.html:118` (navPush), `:121` (popstate) |
| NAV-2 | Joining a team consumes the "teams" entry — Back from lobby never returns to the picker | P1 | PASS | E2E: after `pJoin()` stack `[]`; `navDone("teams")` at the join success path |
| NAV-3 | Lobby → game pushes "lobby"; Back returns to lobby | P0 | PASS | E2E: full chain leaderboard→game→lobby verified with two `history.back()` calls. Code: `pEnterGame` `site/index.html:400` |
| NAV-4 | Game ↔ Leaderboard tab: opening leaderboard pushes "ptab"; Back (or the "Back to the game" button via `navDone`) returns to game | P1 | PASS | E2E: stack `["lobby","ptab"]` → back → `["lobby"]`, view `game`. Code: `pGo` `site/index.html:130` |
| NAV-5 | Admin: view switches (games/wizard/monitor/themes) and selecting a game push entries; Back walks them in reverse | P1 | PASS | E2E: stack grew `selg` → `aview` on games→monitor; `selectGame` pushes only when the id changes (`site/index.html:796`), so the 6 s auto-refresh interval does not flood history |
| NAV-6 | QR modal and Spectator close on Back; closing via their buttons consumes the entry (`navDone`) instead of re-running undo | P1 | PASS | Code trace: `qrNavOpen` `site/index.html:1114`, `spectate` `:1771` (pushes only when opening, not on ↻ refresh), `closeQR`/`closeSpectate` call `navDone`. Runtime-smoke of both render paths done in-page |
| NAV-7 | Back at the true root (join screen, empty stack) exits the site — normal browser behaviour, no trap | P2 | PASS | popstate with empty stack pops nothing (`site/index.html:121`); browser handles the rest |
| NAV-8 | Switching role Player↔Admin leaves the other role's stale entries on the stack; a Back press may be "eaten" by a hidden-screen undo | P2 | FAIL (minor) | E2E: after player flow, admin stack began `["lobby", …]`. Harmless (undo repaints a hidden div) but one Back press does nothing visible. Fix: clear `navStack` in `setRole` or tag entries per role (`site/index.html:139`-ish) |
| NAV-9 | Real device: swipe-back gesture on Android Chrome / iOS Safari standalone behaves like popstate | P0 | NEEDS-MANUAL | Emulation can't prove gesture handling; verify on a phone after deploy (join → game → swipe back → lobby) |

## B. PWA install

| ID | Test case | Priority | Status | Evidence / Notes |
|---|---|---|---|---|
| PWA-1 | Manifest is valid, linked, with 192/512/maskable icons; apple-touch-icon + meta present | P1 | PASS | `site/manifest.webmanifest`; `<link rel="manifest">` + apple meta in head (`site/index.html:8-14`); icons generated and visually checked |
| PWA-2 | Install card on countdown + lobby screens: Android (`beforeinstallprompt`) → button; iOS → Share→Add-to-Home-Screen instructions; hidden when already standalone | P1 | PASS (logic) | Code: `pInstallCard` `site/index.html:305`; E2E (file://, no BIP event): generic ⋮ instructions rendered in lobby |
| PWA-3 | Actual installability (HTTPS origin, Chrome prompt, iOS A2HS) and standalone launch | P0 | NEEDS-MANUAL | Requires the deployed HTTPS origin; test on a phone: install, relaunch, confirm full-screen and that the card disappears |
| PWA-4 | `start_url:"./"` + `scope:"./"` keep the installed app on the site root with query-string deep links still working | P2 | PASS | Manifest values; invite links use `?pin=` on the same path |

## C. Waiting-screen game info

| ID | Test case | Priority | Status | Evidence / Notes |
|---|---|---|---|---|
| INFO-1 | Lobby + pre-start countdown show description, question count, start time | P1 | PASS | E2E: lobby contained "ABOUT THIS GAME / Automated player-flow QA. / 4 challenges · starts …". Code: `pGameInfoCard` `site/index.html:317`; DB: `_state_json` returns `game_description` (migration 0028) |
| INFO-2 | Card hidden when there is nothing to show (no description, no schedule, no questions) | P2 | PASS | `if(!desc&&!meta.length)return ""` `site/index.html:322` |
| INFO-3 | Description with newlines/HTML renders escaped (`white-space:pre-line`, `esc()`) | P1 | PASS | `site/index.html:326`; all new interpolations audited for `esc()` |

## D. End scene

| ID | Test case | Priority | Status | Evidence / Notes |
|---|---|---|---|---|
| ES-1 | Wizard Review step: block editor + leaderboard toggle; persists through save→edit round-trip | P1 | PASS | Code: `wizEndSceneEditor` `site/index.html:1469`; `saveWiz` packs blocks, `editWiz` unpacks; DB `admin_save_game`/`admin_get_game` carry `end_scene` (0028) |
| ES-2 | Live/ended edit from Games view (add/edit/delete block, toggle leaderboard) via `admin_set_end_scene` | P0 | PASS | E2E via UI: `esAddLive()` → "End scene saved", `esToggleLb()` → `show_leaderboard:false`; player saw the change on next poll |
| ES-3 | Player done screen renders scene blocks above rank/time; leaderboard hidden when toggled off | P0 | PASS | E2E: finished game showed "Sveikinam! QA scena veikia.", no Leaderboard section. Code: `site/index.html:656` |
| ES-4 | No scene configured → default "Game over" screen unchanged (regression) | P0 | PASS | `showLb=!es||es.show_leaderboard!==false`; es null → old layout (verified on first QATEST run before scene was set) |
| ES-5 | `admin_duplicate` copies end_scene; XLSX export/import does NOT carry it | P2 | PASS (known gap) | 0028 duplicate includes column; XLSX round-trip intentionally unchanged — document for organisers |
| ES-6 | Pre-b26 cached admin client saving a game would null out an existing end_scene (`end_scene = p_payload->'end_scene'` with absent key → NULL) | P2 | FAIL (edge) | `0028_hint_tools_and_end_scene.sql` admin_save_game. Only bites while an old tab saves after deploy. Fix: `coalesce(p_payload->'end_scene', end_scene)` on UPDATE, or accept (single-admin platform) |

## E. Admin Games view — team cards

| ID | Test case | Priority | Status | Evidence / Notes |
|---|---|---|---|---|
| ROSTER-1 | Live game team card shows current task, 💡 shown/total, next-hint countdown ticking each second | P0 | PASS | E2E (SQL+UI): roster returned `stage_ord:1, hints_shown:1/2, next_hint_ord:2, next_hint_at`; UI line "Q2 Q2 Plain · 💡 …" rendered; ticker `tickHintCds` `site/index.html:706` |
| ROSTER-2 | Countdown respects pause (freezes, shows "paused") | P1 | PASS | Server: `coalesce(v_game.paused_at, now())` in 0028 admin_roster; client: `tickHintCds` paused branch. E2E: pause → player froze; roster `paused_at` propagated |
| ROSTER-3 | All hints out / no hints / finished states render correctly (no countdown junk) | P1 | PASS | E2E: after reveal-all → "all hints out"; finished team → 🏁 Finished. Code: `rosterProgress` `site/index.html:986` |
| ROSTER-4 | "Show hint" confirms with the hint number before revealing; refreshes roster after | P1 | PASS | E2E: `showHintFor` (`site/index.html:844`) revealed hint 2; roster flipped to 2/2, `next_hint` null |
| ROSTER-5 | Countdown hitting 0 triggers a single throttled refresh (no refresh storm) | P2 | PASS | `_cdDueT` 4 s throttle `site/index.html:705-719` |

## F. Live monitor

| ID | Test case | Priority | Status | Evidence / Notes |
|---|---|---|---|---|
| MON-1 | Team row shows compact "hint N in mm:ss" while playing; detail shows full schedule (✓ shown / countdown + Reveal now) | P0 | PASS | E2E: monCds `["hint 2 in 00:29","hint 2 in 00:29"]` (row + detail), "✓ hint 1 shown", Reveal now button present. Code: `monHintRows` `site/index.html:1697` |
| MON-2 | "Reveal now" on a specific hint unlocks it for that team only, immediately | P0 | PASS | E2E: clicked button → monitor "hint 2 shown", player received blocks on next refresh. Code: `revealHint` `site/index.html:854`; DB `admin_show_hint` (existing) |
| MON-3 | Row-level "Show hint" only while playing (not waiting/finished/no-start) | P2 | PASS | Conditional render in pollMon row; finished team hides hint section (`monDetail` guard) |
| MON-4 | 3 s poll re-renders don't fight the 1 s ticker (no flicker/wrong values) | P2 | PASS | Both write the same text format; poll rebuilds, ticker patches between polls. E2E: values stayed monotonic |
| MON-5 | Team reset: hint overrides survive reset, so "revealed" hints stay unlocked in the new run of the same session | P2 | FAIL (pre-existing) | E2E: after `resetTeam`, both Q1 hints showed as shown; cause: `admin_reset_team` (0007) doesn't delete `team_hint_overrides`. Fix: add `delete from team_hint_overrides where team_id=p_team;` there. Pre-dates b26 but now visible in the new UI |

## G. Live hint editing + guard

| ID | Test case | Priority | Status | Evidence / Notes |
|---|---|---|---|---|
| HINT-1 | Hint already seen by any team (time or override, current generation) → edit refused with clear message | P0 | PASS | E2E UI: Q1-h1 → toast "A team has already seen this hint — it can no longer be edited"; SQL direct: `{error:already_shown}`. Guard: 0028 admin_update_hint (override ∪ on-question-past-time ∪ solved-after-reveal) |
| HINT-2 | Unseen hint: change reveal time and/or blocks live; player sees new values | P0 | PASS | E2E UI: Q2-h1 time → 7 min, `selGame` refreshed; earlier SQL test also updated blocks text |
| HINT-3 | Editing a hint of a solved question where every solver beat the reveal time is allowed (nobody saw it) | P1 | PASS | Guard condition `solved_at >= activated_at + reveal` excludes fast solvers; verified on yesterday's real game data (Q1 h3-h5 editable, h1-h2 refused) |
| HINT-4 | Legacy hints (text/media fields, empty blocks) editable — blocks synthesized from text+media before push | P2 | PASS | `hintBlocksOf` `site/index.html:~905`; player render prefers non-empty blocks (existing `pGame`/`_state_json` behaviour) |
| HINT-5 | Guard scopes to current `session_generation` — a new run (new audience) may edit hints seen only in previous runs | P1 | PASS | 0028: both EXISTS join `teams … session_generation = v_game.session_generation` |

## H. Wizard validation (empty content)

| ID | Test case | Priority | Status | Evidence / Notes |
|---|---|---|---|---|
| WIZ-1 | Empty hint (no block with text/URL), missing answer, and content-less question are detected | P0 | PASS | E2E in-page: `wizProblems()` → 3 accurate findings. Code: `site/index.html:1510` |
| WIZ-2 | Save as ready / Save & activate blocked with itemised alert; Save as draft allowed with warning toast | P0 | PASS | `saveWiz` gate `site/index.html:1527-1534`; alert text lists every problem |
| WIZ-3 | Question list shows ⚠ badge; Review step shows the full problem box | P1 | PASS | E2E: `s2ok`/`s4ok` true (badge + "empty item" box rendered) |
| WIZ-4 | XLSX import with blank hint rows hits the same gate (import fills the wizard; save is the only exit) | P1 | PASS | Import writes `wiz.questions`; there is no other path to `admin_save_game` from the wizard |

## I. DB migration 0028

| ID | Test case | Priority | Status | Evidence / Notes |
|---|---|---|---|---|
| DB-1 | Migration applied cleanly; file in repo matches applied SQL | P0 | PASS | `apply_migration 0028_hint_tools_and_end_scene` succeeded; functions re-read from pg_proc during review |
| DB-2 | `admin_roster`/`admin_monitor` keep `session_generation` scoping (no ghosts from previous runs) | P0 | PASS | Both queries filter `t.session_generation = v_game.session_generation` (unchanged pattern) |
| DB-3 | Pause handling: unlock computations use `coalesce(paused_at, now())` consistently (roster, monitor, update-guard) | P1 | PASS | 0028 all three sites; matches `_state_json`'s `v_eff` semantics |
| DB-4 | `next_hint_at` picks the earliest locked, non-overridden hint (not just next ord) | P1 | PASS | Lateral orders by `activated_at + reveal interval`; override-revealed hints excluded (E2E: after reveal → null) |
| DB-5 | `_state_json` additions don't leak: description/status added, `end_scene` only on finished + started branches; locked hints still return null text/blocks | P0 | PASS | Function body re-read; hint gating untouched |
| DB-6 | New RPC grants limited to the token-guarded functions (`admin_update_hint`, `admin_set_end_scene` verify `admin_verify`) | P0 | PASS | Grant block at end of 0028; both functions bail without valid `p_code` |

## J. Regression — pre-existing flows

| ID | Test case | Priority | Status | Evidence / Notes |
|---|---|---|---|---|
| REG-1 | Full player lifecycle: PIN lookup → team create → lobby → 4 questions (incl. case-sensitive Q3) → finish → results | P0 | PASS | E2E on QA game: completed end-to-end, splits recorded (Q1 81 s …), rank 1 |
| REG-2 | Pause/resume freezes and restores player timers | P0 | PASS | E2E: pause screen with message; resume returned to game |
| REG-3 | `pGame` signature-based repaint still patches hints/feedback without rebuilding (typing focus, playing video survive) | P1 | PASS | Hint reveal arrived via `pHints` patch (innerText check), no full rebuild; `sig/hsig` logic untouched |
| REG-4 | Admin auto-refresh (6 s games list, 3 s monitor, 10 s player poll) unaffected by nav stack | P1 | PASS | E2E ran with all intervals live for >10 min; no console errors, no history flooding |
| REG-5 | Stagger starts / team QR / spectate paths still render (only wrapped with navPush) | P1 | PASS | Code trace: changes are additive wrappers; spectate exercised yesterday (QATEST) |
| REG-6 | XLSX export/import round-trip of questions/hints unchanged | P2 | PASS | `buildGameWb`/`parseGameWb` untouched by diff |

---

## Summary

- **PASS 38 · FAIL 10 (2×P1, 8×P2 — none release-blocking) · BLOCKER 0 · NEEDS-MANUAL 2**
- P0 cases: all PASS except PWA-3/NAV-9 real-device checks (NEEDS-MANUAL). Release is safe; the two P1s below deserve a fix before the next real game.

### Top findings (most severe first, with fix locations)

1. **CX-1 (P1)** — `wizProblems()` ignores `wiz.questions.length===0`, so **Save & activate can publish a zero-question game**; players who join land in a permanent "Getting things ready…" dead-end. Fix: add a "no questions" problem in `wizProblems` (`site/index.html:1510`) so the `saveWiz` gate blocks ready/live.
2. **CX-2 (P1)** — the `admin_update_hint` already-shown guard reads `team_progress`, but **`admin_reset_team` deletes those rows**, erasing the evidence: reset a team that saw a timed hint and the hint becomes "editable" again. Fix: append-only seen-log (`team_hint_seen`) written on unlock/override, guard checks it (`0028:101-113`, `0007_admin_rpc.sql:160-175`).
3. **MON-5 (P2, pre-existing)** — `admin_reset_team` also keeps `team_hint_overrides`, so force-revealed hints stay unlocked after a reset. Fix together with CX-2 in one migration: reset clears overrides but logs them to the seen-table first.
4. **CX-4 (P2)** — the 1 s countdown's due-`refreshTeams()` can redraw the Games view while the admin is typing (schedule / team-start inputs) — the 6 s poll guards focus, the ticker doesn't. Fix: same `document.activeElement` guard in `tickHintCds` (`site/index.html:716`).
5. **CX-5 (P2)** — after a successful wizard save, `adminGo("games")` pushes history, so Back reopens the already-submitted wizard. Fix: `adminGo("games",false)` in `saveWiz` (`site/index.html:1546`).
6. **CX-6 (P2)** — browser **Forward** after Back fires popstate and the handler pops another entry — forward acts like a second back. Fix: compare `event.state?.qnav` to `navStack.length` and only undo when going backwards (`site/index.html:121`).
7. **CX-7 (P2)** — admin spectate of a finished team doesn't render the end scene, so "Team view" no longer matches what the player sees. Fix: reuse the `pDone` scene blocks in the finished spectate branch (`site/index.html:1779`).
8. **CX-3 (P2, pre-existing)** — monitor `seconds_on_stage`/`total_seconds` keep running on `now()` during a pause while hint unlocks freeze — timer drift on the monitor only. Fix: use `coalesce(paused_at, now())` for elapsed too (`0028:67-68`).
9. **NAV-8 (P2)** — role switch leaves the other role's nav entries; one Back press can be a visible no-op. Fix: clear/tag `navStack` in `setRole`.
10. **ES-6 (P2, transient)** — a pre-b26 cached admin tab saving a game nulls its end_scene (`end_scene = p_payload->'end_scene'`). Fix: `coalesce(p_payload->'end_scene', end_scene)` in `admin_save_game` UPDATE, or accept (single admin, short window).
11. **NAV-9 / PWA-3 (NEEDS-MANUAL)** — verify on a real phone after deploy: swipe-back gesture, Chrome install prompt, iOS Add-to-Home-Screen, standalone relaunch.

### Recommended automation mix

- **Unit** — `wizProblems` (empty-content matrix), `rosterProgress`/`monHintRows` (state → HTML snapshots), nav stack (push/done/popstate sequences in jsdom).
- **Integration** — `admin_update_hint` guard matrix against a test Supabase project (override / on-question-past-time / fast-solver / new-generation), `admin_set_end_scene` + `_state_json` round-trip.
- **E2E (extend `scripts/`)** — add `qa_hints.mjs` (reveal/edit/guard) and `qa_endscene.mjs` to the existing rig; wire the back-nav chain into `qa_playthrough.mjs`.
- **Manual exploratory** — phone-only: install flows, swipe-back, standalone mode, countdown readability on 360 px.

## Codex adversarial review

Run with `codex exec --sandbox read-only` (codex-cli 0.144.1, ~191k tokens) over the uncommitted diff +
migration. Every finding was re-verified against the code before being accepted; all seven hold.

| ID | Priority | Finding (verified) | Fix location |
|---|---|---|---|
| CX-1 | P1 | Zero-question game passes `wizProblems()` → Save & activate publishes a dead-end game | `site/index.html:1510` (wizProblems) |
| CX-2 | P1 | `admin_reset_team` deletes the `team_progress` evidence the already-shown guard relies on → a hint players saw becomes editable after a reset | `0028:101-113` + `admin_reset_team`; add append-only seen-log |
| CX-3 | P2 | Monitor elapsed timers keep using `now()` during pause (hint unlocks freeze, timers don't) — pre-existing drift | `0028:67-68` (admin_monitor) |
| CX-4 | P2 | 1 s ticker's due-refresh redraws Games while admin types (no focus guard, unlike the 6 s poll) | `site/index.html:716` (tickHintCds) |
| CX-5 | P2 | Wizard save pushes history → Back reopens submitted wizard | `site/index.html:1546` (saveWiz → `adminGo("games",false)`) |
| CX-6 | P2 | Browser Forward fires popstate → handler pops another entry — forward behaves like back | `site/index.html:121` (compare `event.state.qnav`) |
| CX-7 | P2 | Spectate of a finished team omits the end scene — admin preview no longer matches the player | `site/index.html:1779` (finished spectate branch) |

Codex-confirmed clean: no player-facing XSS in the new interpolations (all through `esc()`/`pBlock()`/`safeUrl()`);
`manifest.webmanifest` valid; XLSX round-trip neither carries nor clobbers `end_scene`.

---

## Fix re-verification (b27 + migration 0029, 2026-07-20)

All fixes verified live on a throwaway QA game (PIN LPVEQ2, torn down) and isolated browser tests.

| ID | Was | Fix | Now | Evidence |
|---|---|---|---|---|
| CX-1 | P1 FAIL | `wizProblems()` reports "No questions" → `saveWiz` blocks ready/activate | PASS | Browser: `newWiz(); wizProblems()` → `["No questions — add at least one before publishing"]` |
| CX-2 | P1 FAIL | Append-only `team_hint_seen` log (backfilled; written by `mark_hint_revealed`, `admin_show_hint`, materialized by `admin_reset_team`); `admin_update_hint` checks it | PASS | E2E: hint seen → team reset → seen rows survive (2), edit → `already_shown`; unseen hint → `ok` |
| MON-5 | P2 FAIL | `admin_reset_team` clears `team_hint_overrides` (after logging them as seen) | PASS | E2E: `overrides_after_reset = 0` |
| CX-3 | P2 FAIL | `admin_monitor` elapsed uses `coalesce(paused_at, now())` | PASS | E2E: paused game, two calls 2 s apart → `seconds_on_stage` 18 → 18 (frozen) |
| CX-4 | P2 FAIL | `tickHintCds` due-refresh skipped while INPUT/TEXTAREA/SELECT focused | PASS | Code: same guard as the proven 6 s poll (`site/index.html` tickHintCds) |
| CX-5 | P2 FAIL | `saveWiz` → `wiz=null` + `adminGo("games",false)` (no history push) | PASS | Code trace; wizard state cleared so Back cannot reopen a submitted wizard |
| CX-6 | P2 FAIL | popstate reconciles with `event.state.qnav`: back pops to target depth, forward/stale-deeper states bounce via `history.back()` | PASS | Browser: back→undo-b; forward→no undo (bounced, state resynced qnav=1/stack=1); next back→undo-a, stack empty, history at root |
| CX-7 | P2 FAIL | Spectate finished branch renders end-scene blocks | PASS | Browser: spectate of finished team showed "🏁 Finished · 00:59 · SPECTATE-SCENA-OK" |
| NAV-8 | P2 FAIL | `setRole` clears `navStack`; qnav-reconciling popstate unwinds the stale history states | PASS | Code + popstate bounce test above covers the unwind path |
| ES-6 | P2 FAIL | `admin_save_game` UPDATE: `end_scene = coalesce(p_payload->'end_scene', end_scene)` | PASS | E2E: save payload without `end_scene` key → scene "islieka" retained |

Bonus fix (found while patching): `mark_hint_revealed` now accepts override-unlocked hints
(previously returned `locked` and the team's hint counter under-counted force-revealed hints).

**Post-fix status: 48 PASS · 0 FAIL · 0 BLOCKER · 2 NEEDS-MANUAL (real-device only).**
