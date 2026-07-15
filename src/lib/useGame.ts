import { useCallback, useEffect, useRef, useState } from "react";
import {
  getState, registerTeam, submitAnswer, markHintRevealed,
  drainOutbox, pendingSubmits, type GameState, type SubmitResult,
} from "./api";

const TOKEN_KEY = "sg_token";

// Central game state: token cache, server-time offset (untrusted client clock),
// polling refresh (unlocks hints / updates expiry), and offline outbox draining.
export function useGame() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [state, setState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const offsetRef = useRef(0); // serverNow - clientNow (ms)
  const [, tick] = useState(0); // 1s re-render for live countdowns

  const apply = (s: GameState | null) => {
    if (s?.server_now) offsetRef.current = Date.parse(s.server_now) - Date.now();
    setState(s);
  };

  const load = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setLoading(false); return; }
    try {
      const s = await getState(t);
      setOffline(false);
      if (s.error === "bad_session") { localStorage.removeItem(TOKEN_KEY); setToken(null); apply(null); }
      else apply(s);
    } catch { setOffline(true); }
    finally { setLoading(false); }
  }, []);

  const register = useCallback(async (name: string): Promise<string | null> => {
    const res = await registerTeam(name);
    if (res.error) return res.error;
    if (res.session_token) {
      localStorage.setItem(TOKEN_KEY, res.session_token);
      setToken(res.session_token);
      if (res.state) apply(res.state);
    }
    return null;
  }, []);

  const submit = useCallback(async (input: string): Promise<SubmitResult> => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return { error: "bad_session" };
    const res = await submitAnswer(t, input); // throws on network failure
    if (res.correct || res.finished) await load();
    return res;
  }, [load]);

  const reveal = useCallback(async (hintId: string) => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return;
    try { await markHintRevealed(t, hintId); } catch { /* non-critical */ }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY); setToken(null); apply(null);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!token) return;
    const poll = setInterval(() => { load(); drainOutbox(); }, 10000);
    const ticker = setInterval(() => tick((n) => n + 1), 1000);
    const onOnline = () => { load(); drainOutbox(); };
    window.addEventListener("online", onOnline);
    return () => { clearInterval(poll); clearInterval(ticker); window.removeEventListener("online", onOnline); };
  }, [token, load]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
  return { state, loading, offline, token, register, submit, reveal, logout, refresh: load, serverNow, pending: pendingSubmits() };
}
