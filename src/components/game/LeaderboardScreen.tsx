import { Card } from "@/components/ui/card";
import { mockLeaderboard } from "@/lib/mockData";
import { Trophy } from "lucide-react";

export function LeaderboardScreen() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          <Trophy className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="text-sm text-muted-foreground">Live team rankings</p>
        </div>
      </div>

      <div className="space-y-2">
        {mockLeaderboard.map((row) => (
          <Card key={row.rank} className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted font-semibold tabular-nums">
              {row.rank}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{row.teamName}</p>
              <p className="text-xs text-muted-foreground">
                {row.completedTasks} tasks · {row.lastTaskTime}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold tabular-nums">{row.score}</p>
              <p className="text-xs text-muted-foreground">pts</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
