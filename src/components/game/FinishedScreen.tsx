import { Card } from "@/components/ui/card";
import { mockLeaderboard } from "@/lib/mockData";
import { Trophy } from "lucide-react";

export function FinishedScreen({ teamName }: { teamName: string }) {
  const myRow =
    mockLeaderboard.find((r) => r.teamName === teamName) ?? mockLeaderboard[1];
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8">
      <Card className="space-y-4 p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          <Trophy className="h-7 w-7" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Game finished!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Thanks for playing. Hope you had a great adventure.
          </p>
        </div>
        <div className="mx-auto inline-flex items-center gap-6 rounded-2xl bg-muted px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Rank</p>
            <p className="text-2xl font-semibold tabular-nums">#{myRow.rank}</p>
          </div>
          <div className="h-10 w-px bg-border" />
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Score</p>
            <p className="text-2xl font-semibold tabular-nums">{myRow.score}</p>
          </div>
        </div>
      </Card>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Final leaderboard
        </h2>
        <div className="space-y-2">
          {mockLeaderboard.map((row) => (
            <Card
              key={row.rank}
              className={`flex items-center gap-4 p-4 ${
                row.teamName === myRow.teamName ? "ring-2 ring-primary" : ""
              }`}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted font-semibold tabular-nums">
                {row.rank}
              </div>
              <div className="flex-1">
                <p className="font-medium">{row.teamName}</p>
                <p className="text-xs text-muted-foreground">
                  {row.completedTasks} tasks
                </p>
              </div>
              <p className="text-lg font-semibold tabular-nums">{row.score}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
