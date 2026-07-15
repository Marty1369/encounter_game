import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/game/StatusBadge";
import { mockAdminTeams } from "@/lib/mockData";
import {
  adminStartGame,
  adminPauseGame,
  adminFinishGame,
  adminUnlockNextTask,
  adminMarkTaskComplete,
  adminAdjustScore,
  adminBlockTeam,
} from "@/lib/gameActions";
import {
  Play,
  Pause,
  Flag,
  Unlock,
  Check,
  Ban,
  Plus,
  Minus,
  ArrowLeft,
  Shield,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

type GameStatus = "draft" | "lobby" | "active" | "paused" | "finished";

function AdminPage() {
  const [status, setStatus] = useState<GameStatus>("active");
  const teams = mockAdminTeams;

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Admin Dashboard</h1>
              <p className="text-xs text-muted-foreground">Night Quest: Riverside</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              Player view
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-5 py-6">
        {/* Control panel */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium">Game status</p>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as GameStatus)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium"
              >
                <option value="draft">Draft</option>
                <option value="lobby">Lobby</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="finished">Finished</option>
              </select>
              <StatusBadge status={status} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { adminStartGame(); setStatus("active"); }} className="gap-2">
                <Play className="h-4 w-4" /> Start
              </Button>
              <Button
                onClick={() => { adminPauseGame(); setStatus("paused"); }}
                variant="outline"
                className="gap-2"
              >
                <Pause className="h-4 w-4" /> Pause
              </Button>
              <Button
                onClick={() => { adminFinishGame(); setStatus("finished"); }}
                variant="outline"
                className="gap-2"
              >
                <Flag className="h-4 w-4" /> Finish
              </Button>
            </div>
          </div>
        </Card>

        {/* Teams grid */}
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((t) => (
            <Card key={t.teamId} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{t.teamName}</p>
                  <p className="text-xs text-muted-foreground">
                    Task {t.currentTask} · {t.players.length} players
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold tabular-nums">{t.score}</p>
                  <p className="text-xs text-muted-foreground">pts</p>
                </div>
              </div>

              <ul className="mt-4 space-y-1.5">
                {t.players.map((p) => (
                  <li
                    key={p.nickname}
                    className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{p.nickname}</span>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => adminUnlockNextTask(t.teamId)}
                >
                  <Unlock className="h-3.5 w-3.5" /> Unlock next
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => adminMarkTaskComplete(t.teamId)}
                >
                  <Check className="h-3.5 w-3.5" /> Mark complete
                </Button>
                <div className="flex items-center overflow-hidden rounded-md border border-border">
                  <button
                    onClick={() => adminAdjustScore(t.teamId, -10)}
                    className="px-2 py-1.5 text-sm hover:bg-muted"
                    aria-label="Subtract 10 points"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="border-x border-border px-3 py-1.5 text-xs font-medium">
                    Score
                  </span>
                  <button
                    onClick={() => adminAdjustScore(t.teamId, 10)}
                    className="px-2 py-1.5 text-sm hover:bg-muted"
                    aria-label="Add 10 points"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => adminBlockTeam(t.teamId)}
                >
                  <Ban className="h-3.5 w-3.5" /> Block
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
