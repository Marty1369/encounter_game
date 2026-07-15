import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { JoinScreen } from "@/components/game/JoinScreen";
import { LobbyScreen } from "@/components/game/LobbyScreen";
import { TaskScreen } from "@/components/game/TaskScreen";
import { HintsScreen } from "@/components/game/HintsScreen";
import { LeaderboardScreen } from "@/components/game/LeaderboardScreen";
import { TeamScreen } from "@/components/game/TeamScreen";
import { PausedScreen } from "@/components/game/PausedScreen";
import { FinishedScreen } from "@/components/game/FinishedScreen";
import { BottomNav, type Tab } from "@/components/game/BottomNav";
import { StatusBadge } from "@/components/game/StatusBadge";
import { Button } from "@/components/ui/button";
import { refreshGameState } from "@/lib/gameActions";
import { MapPin, Shield } from "lucide-react";

export const Route = createFileRoute("/")({
  component: PlayerApp,
});

type Phase = "join" | "lobby" | "playing" | "paused" | "finished";

function PlayerApp() {
  const [phase, setPhase] = useState<Phase>("join");
  const [tab, setTab] = useState<Tab>("task");
  const [identity, setIdentity] = useState({ nickname: "", teamName: "" });

  // Quick screen switcher for the prototype preview (top of page).
  const phaseLabel: Record<Phase, string> = {
    join: "Join",
    lobby: "Lobby",
    playing: "Playing",
    paused: "Paused",
    finished: "Finished",
  };

  return (
    <div className="min-h-screen bg-background pb-16 text-foreground">
      {/* Prototype preview switcher */}
      <div className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MapPin className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">Night Quest</span>
            <StatusBadge
              status={
                phase === "playing"
                  ? "active"
                  : phase === "join"
                    ? "lobby"
                    : (phase as "lobby" | "paused" | "finished")
              }
              className="ml-1"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="sr-only" htmlFor="phase">
              Preview screen
            </label>
            <select
              id="phase"
              value={phase}
              onChange={(e) => setPhase(e.target.value as Phase)}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium"
            >
              {Object.entries(phaseLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <Button asChild variant="ghost" size="sm" className="gap-1.5 px-2">
              <Link to="/admin">
                <Shield className="h-4 w-4" />
                <span className="hidden sm:inline">Admin</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {phase === "join" && (
        <JoinScreen
          onJoined={(data) => {
            setIdentity(data);
            setPhase("lobby");
          }}
        />
      )}

      {phase === "lobby" && (
        <>
          <LobbyScreen teamName={identity.teamName} />
          <div className="mx-auto max-w-2xl px-5 pb-6">
            <Button onClick={() => setPhase("playing")} className="w-full">
              [Preview] Simulate game start
            </Button>
          </div>
        </>
      )}

      {phase === "playing" && (
        <>
          {tab === "task" && <TaskScreen onNext={() => setTab("task")} />}
          {tab === "hints" && <HintsScreen />}
          {tab === "leaderboard" && <LeaderboardScreen />}
          {tab === "team" && <TeamScreen teamName={identity.teamName} />}
          <BottomNav active={tab} onChange={setTab} />
        </>
      )}

      {phase === "paused" && (
        <PausedScreen onRefresh={() => refreshGameState()} />
      )}

      {phase === "finished" && <FinishedScreen teamName={identity.teamName} />}
    </div>
  );
}
