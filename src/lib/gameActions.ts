// Placeholder action functions.
// TODO: Replace each implementation with a google.script.run call when wiring
// this UI into Google Apps Script HTMLService.
//
//   Example:
//   export function joinGame(payload) {
//     return new Promise((resolve, reject) => {
//       google.script.run
//         .withSuccessHandler(resolve)
//         .withFailureHandler(reject)
//         .joinGame(payload);
//     });
//   }

export async function joinGame(payload: { nickname: string; teamName: string }) {
  console.log("[joinGame]", payload);
  await delay(400);
  return { ok: true };
}

export async function submitAnswer(payload: { taskId: string; answer: string }) {
  console.log("[submitAnswer]", payload);
  await delay(500);
  // Mock: any answer that includes "1888" is correct.
  const correct = payload.answer.trim().toLowerCase().includes("1888");
  return { ok: true, correct };
}

export async function useHint(payload: { hintId: string }) {
  console.log("[useHint]", payload);
  await delay(300);
  return { ok: true };
}

export async function checkLocation() {
  console.log("[checkLocation]");
  await delay(900);
  // Mock: 70% chance the player is close enough.
  const close = Math.random() > 0.3;
  return {
    ok: true,
    confirmed: close,
    distanceMeters: close ? Math.floor(Math.random() * 15) : 60 + Math.floor(Math.random() * 200),
  };
}

export async function refreshGameState() {
  console.log("[refreshGameState]");
  await delay(300);
  return { ok: true };
}

export async function adminStartGame() {
  console.log("[adminStartGame]");
  await delay(200);
}

export async function adminPauseGame() {
  console.log("[adminPauseGame]");
  await delay(200);
}

export async function adminFinishGame() {
  console.log("[adminFinishGame]");
  await delay(200);
}

export async function adminUnlockNextTask(teamId: string) {
  console.log("[adminUnlockNextTask]", teamId);
  await delay(200);
}

export async function adminMarkTaskComplete(teamId: string) {
  console.log("[adminMarkTaskComplete]", teamId);
  await delay(200);
}

export async function adminAdjustScore(teamId: string, delta: number) {
  console.log("[adminAdjustScore]", teamId, delta);
  await delay(200);
}

export async function adminBlockTeam(teamId: string) {
  console.log("[adminBlockTeam]", teamId);
  await delay(200);
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
