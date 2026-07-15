import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { mockTeam } from "@/lib/mockData";
import { Users } from "lucide-react";

export function TeamScreen({ teamName }: { teamName: string }) {
  const team = { ...mockTeam, teamName: teamName || mockTeam.teamName };
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Your Team</h1>
        <p className="text-sm text-muted-foreground">Roster and current status</p>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Users className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-lg font-semibold">{team.teamName}</p>
            <p className="text-xs text-muted-foreground">
              Task {team.currentTask} · {team.score} pts
            </p>
          </div>
          <StatusBadge status="active" />
        </div>

        <ul className="mt-5 divide-y divide-border rounded-xl border border-border">
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
      </Card>

      <Button variant="outline" className="mt-5 w-full">
        Leave team
      </Button>
    </div>
  );
}
