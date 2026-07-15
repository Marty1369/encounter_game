import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import { mockTeam } from "@/lib/mockData";
import { refreshGameState } from "@/lib/gameActions";
import { RefreshCw, Users } from "lucide-react";
import { useState } from "react";

export function LobbyScreen({ teamName }: { teamName: string }) {
  const team = { ...mockTeam, teamName: teamName || mockTeam.teamName };
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    // TODO: connect to google.script.run.refreshGameState(...)
    await refreshGameState();
    setRefreshing(false);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Game Lobby</h1>
          <p className="text-sm text-muted-foreground">Waiting for game to start…</p>
        </div>
        <StatusBadge status="lobby" />
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Your team</p>
              <p className="text-lg font-semibold">{team.teamName}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Players ({team.players.length})
          </p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {team.players.map((p) => (
              <li key={p.nickname} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {p.nickname[0]}
                  </div>
                  <span className="font-medium">{p.nickname}</span>
                </div>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card className="mt-4 flex items-center justify-between p-5">
        <div>
          <p className="text-sm font-medium">Other teams joined</p>
          <p className="text-xs text-muted-foreground">
            More squads are gathering. Game starts soon.
          </p>
        </div>
        <div className="text-2xl font-semibold tabular-nums">6</div>
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        The admin will start the game when everyone is ready.
      </p>
    </div>
  );
}
