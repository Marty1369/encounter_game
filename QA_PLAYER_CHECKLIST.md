# QA — Player flows

Real-browser QA of the **player** side (Chromium via Playwright) against `site/index.html`
served locally, talking to the **live Supabase backend**. Method: `qa-release-check`
(adversarial, evidence-based; PASS / FAIL / BLOCKER / NEEDS-MANUAL at P0/P1/P2).

- Pass 1 — Codex QA agent (browser-driven, produced the first 16 verdicts).
- Pass 2 — `scripts/qa_dropoff.mjs`: the drop-off/connection/end cases pass 1 never reached,
  plus a re-test of pass 1's disputed verdicts on a clean game.
- Reproduce: `node scripts/qa_ctl.mjs setup` (rig), then `node scripts/qa_dropoff.mjs`.

## JOIN / QR

| ID | Test case | Pri | Status | Evidence |
|---|---|---|---|---|
| JOIN-01 | PIN lookup shows game card + "Registration open" before entering | P0 | PASS | Fresh game, `#pin` filled: card renders name + `● Registration open`. (Pass 1 called this FAIL — it read the card *after* clicking Enter, when the card is gone. False positive.) |
| JOIN-02 | Create team lands in countdown and sets `q_token` | P0 | PASS | `localStorage.q_token` length 36; countdown "Get ready, Alpha". |
| JOIN-03 | QR deep link `?pin=..&team=..` pre-fills PIN+team and joins the **same** team | P0 | PASS | Second session joined as Mate → `qa_ctl teams` = `[{name:"Alpha",players:2}]` — one team, not a duplicate. |
| JOIN-04 | Invite QR renders an SVG and the shown code matches the PIN | P0 | PASS | `#pQR svg` present; visible code === `q_pin`. |
| JOIN-05 | Typing the PIN never loses focus (rebuild regression) | P0 | PASS | Typed char-by-char with >1s gaps; `document.activeElement.id` stayed `pin` throughout. |
| JOIN-06 | Bad PIN → no game, Enter stays disabled | P0 | PASS | PIN `000000` → "Enter a game PIN to begin", `#pEnterBtn.disabled === true`. |

## COUNTDOWN / START

| ID | Test case | Pri | Status | Evidence |
|---|---|---|---|---|
| COUNT-01 | Countdown shows invite card + game code + QR | P0 | PASS | countdown=true invite=true codeShown=true qrSvg=true. (Pass 1 FAIL was truncated evidence — false positive.) |
| COUNT-02 | Host "Start game" (early) takes waiting players **into the challenge automatically** | P0 | **FIXED → PASS** | Was a real defect: player parked on the Lobby indefinitely needing a manual tap (probe: LOBBY t+8s…t+30s+), contradicting "unlocks automatically". Cause: the poll set `started=true` before the countdown ticker's auto-advance, so `pState.screen` stayed `"lobby"`. Fixed in `applyState` (pre-start→started transition). Now `#answer` appears after **6.3s, no tap**. |
| COUNT-03 | Natural countdown reaching 0 auto-starts without a reload | P0 | PASS | Waited past the scheduled start → "Challenge 1 of 4". |

## PLAY

| ID | Test case | Pri | Status | Evidence |
|---|---|---|---|---|
| PLAY-01 | Q1 renders intro, info callout, video, image; hint 1 unlocked, hint 2 locked | P0 | PASS | `{intro:true, info:true, video:true, image:true, hint1:true, locked:true}`. |
| PLAY-02 | Wrong answer rejected; correct answer advances | P0 | PASS | "Not quite — try again" → `alpha` → "Challenge 2 of 4". |
| PLAY-03 | Case-sensitive question enforces exact case | P0 | PASS | `charlie` rejected, `ChArLie` accepted. |
| PLAY-04 | Shared team progress — teammate advances when one player solves | P0 | PASS | Mate session moved to "Challenge 2 of 4" after Captain solved. |
| PLAY-05 | Elapsed clock never shows `00:00` and does not reset on advance | P0 | PASS | `#pElapsed` 01:17 → 01:20 across a correct answer (earlier regression: it counted from per-question `activated_at`). |
| PLAY-06 | A playing video is **not** restarted/stopped by the 10s poll | P0 | PASS | `currentTime` 3.00 → 15.09 across a 15s wait — kept playing, no rebuild. |
| PLAY-07 | Answer field keeps focus + draft text across polls | P0 | PASS | After 15s: `{active:"answer", value:"draft text"}`. |
| PLAY-08 | Hint 2 unlocks ~1 min after the challenge activates | P1 | PASS | `HINT-TWO-LATER` visible after ~65s. |

## PAUSE / NOTICES

| ID | Test case | Pri | Status | Evidence |
|---|---|---|---|---|
| NOTICE-01 | Pause reaches a player **whose answer box is focused** | P0 | PASS | Focused `#answer`, host paused → "⏸ Game paused / Back shortly". (This exact case regressed once — the poll used to be skipped while typing.) |
| NOTICE-02 | Resume returns to the same challenge | P0 | PASS | Back to "Challenge 2 of 4". |
| NOTICE-03 | Cancelled-question popup: number + name + reason + time-deduction, must be acknowledged | P0 | PASS | Popup: `Question 2 "Q2 Plain" was cancelled by the host. / Reason: bad clue / The time you spent on this task will be deducted from your total.` + "Got it"; board renumbered to "Challenge 2 of 3". |

## DROP-OFF / CONNECTION  (pass 1 never reached these)

| ID | Test case | Pri | Status | Evidence |
|---|---|---|---|---|
| DROP-01 | Answer submitted **offline** is queued, not lost | P0 | PASS | Feedback "No connection — saved, retrying…"; `q_outbox` = 1 item `{input:"alpha", mid:…}`. |
| DROP-02 | Offline player is **not** advanced optimistically (no lying UI) | P0 | PASS | Stayed on "Challenge 1 of 4" while offline. |
| DROP-03 | Reconnect flushes the queued answer and it is accepted | P0 | PASS | Back online → "Challenge 2 of 4", `q_outbox` drained to 0. |
| DROP-04 | Queued answer advances the team **exactly once** (idempotency) | P0 | PASS | Server-side team `stage=2` (not 3); splits `[{ord:1, seconds:16}]`. |
| DROP-05 | Reload mid-game restores session + same challenge | P0 | PASS | After `reload()`: "Challenge 2 of 4". |
| DROP-06 | Idling past the poll keeps the player in the game | P1 | PASS | Still "Challenge 2 of 4" after 12s idle. |
| DROP-07 | Lost/invalid session falls back to the PIN screen without crashing | P0 | PASS | Token wiped → `#pin` screen restored. |

## END / LEADERBOARD

| ID | Test case | Pri | Status | Evidence |
|---|---|---|---|---|
| END-01 | Finishing all challenges reaches the done screen | P0 | PASS | "QUEST COMPLETE — All challenges solved. Well played, Alpha. FINAL RANK 1". |
| END-02 | Done screen offers Overall + Per question tabs | P0 | PASS | Both tabs render. |
| END-03 | Per-question tab lists per-challenge splits | P0 | PASS | Split chips shown. |
| END-04 | Game auto-ends once every team has finished | P0 | PASS | Server `status=ended`. |

## Summary

| Status | Count |
|---|---|
| **PASS** | 28 |
| **FAIL** | 0 |
| **BLOCKER** | 0 |
| **NEEDS-MANUAL** | 2 |

Priority spread: P0 25 · P1 3.

### Defects found and fixed this pass
1. **COUNT-02 (P0)** — early "Start game" left waiting players parked on the Lobby indefinitely,
   despite the countdown promising automatic entry. Fixed in `applyState`: a pre-start → started
   transition moves the player into the challenge. Verified: enters in 6.3s, no tap.
2. **Lobby dead clock (P2)** — the lobby showed "Game in progress / **—** / time remaining";
   games have no duration, so it was permanently `—`. Now shows elapsed + "the game runs until
   every team finishes".

### Corrected from pass 1 (verified false positives — do not re-file)
- `JOIN-01` FAIL — evidence read after leaving the join card.
- `COUNT-01` FAIL — evidence string truncated at 200 chars, cutting off the code.
- `TOOL-02` "BLOCKER" — the QA driver's own bug: it discarded Q2 (which renumbers the game to
  "Challenge 2 of 3") then waited for "Challenge 3 of 4". Not a product defect.
- A probe once showed a player kicked to the PIN screen mid-game. **Not reproducible** — a test
  collision: a concurrent `qa_ctl.mjs setup` deleted the game under the running player
  (`bad_session` → token cleared, which is correct behaviour for a deleted game).

### NEEDS-MANUAL
- **TOOL-01** — the `playwright_cli.sh` wrapper's persistent session dropped on this machine
  (`Target page/context/browser closed`); both passes used playwright-core directly instead.
  Does not affect the app under test.
- **Real-device mobile** — on-device keyboard, iOS `webkitEnterFullscreen` for the "PLAY VIDEO"
  button, and a real network flap on a phone are not covered by desktop headless Chromium.
  Check on an actual phone before a public run.

### Recommended automation mix
- **Backend E2E** — `scripts/e2e.mjs` (47 assertions: lifecycle, idempotency, auto-stop, notices).
- **Round-trip** — `scripts/roundtrip.mjs` (24: XLSX export→import is lossless).
- **Player E2E** — `scripts/qa_dropoff.mjs` (JOIN/COUNT/DROP/END above) with `qa_ctl.mjs` as the
  admin rig. Run before a public game.
- **Manual** — one real phone: QR scan, keyboard, fullscreen video.
