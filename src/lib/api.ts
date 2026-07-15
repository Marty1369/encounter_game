// Typed wrappers over the Supabase RPCs — the ONLY game API. No direct table access.
import { supabase } from "./supabase";

export type Block =
  | { type: "text"; text: string }
  | { type: "image" | "video"; src: string };

export interface HintView {
  id: string;
  ord: number;
  reveal_after_min: number;
  type: "text" | "image";
  unlocked: boolean;
  content: string | null; // null while locked — the server never sends locked content
}

export interface QuestionView {
  code: string;
  ord: number;
  title: string;
  intro: string;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  blocks: Block[];
}

export interface GameState {
  error?: string;
  finished: boolean;
  team: { name: string };
  question?: QuestionView;
  activated_at?: string;
  hints_revealed?: number;
  hints?: HintView[];
  server_now: string;
  expires_at: string | null;
  expired: boolean;
  total_questions: number;
  finished_at?: string;
  total_seconds?: number;
}

export interface SubmitResult {
  correct?: boolean;
  next_ord?: number;
  finished?: boolean;
  error?: string;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// ---- player ----
export const getState = (token: string) => rpc<GameState>("get_state", { p_session: token });

export const registerTeam = (name: string) =>
  rpc<{ session_token?: string; state?: GameState; error?: string }>("register_team", { p_name: name });

export const markHintRevealed = (token: string, hintId: string) =>
  rpc<{ ok?: boolean; error?: string }>("mark_hint_revealed", { p_session: token, p_hint_id: hintId });

// ---- offline-resilient submit ----
// Every submit gets a stable mutation_id persisted BEFORE the network call, so a retry
// (after a lost ACK on weak signal) replays the exact same server result instead of
// double-counting. The backend is idempotent on mutation_id.
interface OutboxItem { token: string; input: string; mutation_id: string }
const OUTBOX = "sg_outbox";
const loadOutbox = (): OutboxItem[] => {
  try { return JSON.parse(localStorage.getItem(OUTBOX) || "[]"); } catch { return []; }
};
const saveOutbox = (x: OutboxItem[]) => localStorage.setItem(OUTBOX, JSON.stringify(x));

async function flush(item: OutboxItem): Promise<SubmitResult> {
  const res = await rpc<SubmitResult>("submit_answer", {
    p_session: item.token, p_input: item.input, p_mutation_id: item.mutation_id,
  });
  saveOutbox(loadOutbox().filter((i) => i.mutation_id !== item.mutation_id));
  return res;
}

export async function submitAnswer(token: string, input: string): Promise<SubmitResult> {
  const item: OutboxItem = { token, input, mutation_id: crypto.randomUUID() };
  saveOutbox([...loadOutbox(), item]);
  return flush(item); // throws on network failure -> caller shows retry state
}

// Retry any queued submits (call on reconnect / interval). Safe: idempotent replay.
export async function drainOutbox(): Promise<void> {
  for (const item of loadOutbox()) {
    try { await flush(item); } catch { /* keep queued for next attempt */ }
  }
}
export const pendingSubmits = () => loadOutbox().length;

// ---- admin (passcode gated server-side) ----
export const adminBoard = (code: string) => rpc<any>("admin_board", { p_code: code });
export const adminSkip = (code: string, team: string) => rpc<any>("admin_skip", { p_code: code, p_team: team });
export const adminReset = (code: string, team: string) => rpc<any>("admin_reset", { p_code: code, p_team: team });
export const adminExtend = (code: string, minutes: number) => rpc<any>("admin_extend", { p_code: code, p_minutes: minutes });
export const adminNewGame = (code: string, minutes: number) => rpc<any>("admin_new_game", { p_code: code, p_duration_min: minutes });
