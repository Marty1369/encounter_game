import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { joinGame } from "@/lib/gameActions";
import { MapPin } from "lucide-react";

interface Props {
  onJoined: (data: { nickname: string; teamName: string }) => void;
}

export function JoinScreen({ onJoined }: Props) {
  const [nickname, setNickname] = useState("");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim() || !teamName.trim()) return;
    setBusy(true);
    // TODO: connect to google.script.run.joinGame(...)
    await joinGame({ nickname, teamName });
    setBusy(false);
    onJoined({ nickname, teamName });
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <MapPin className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Night Quest</h1>
          <p className="text-sm text-muted-foreground">City game lobby</p>
        </div>
      </div>

      <Card className="space-y-5 p-6">
        <div>
          <h2 className="text-lg font-semibold">Join the game</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your nickname and team name to join the game.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nickname">Nickname</Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Mira"
              autoComplete="off"
              required
              className="h-12 text-base"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team">Team name</Label>
            <Input
              id="team"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Azure Foxes"
              autoComplete="off"
              required
              className="h-12 text-base"
            />
          </div>
          <Button type="submit" disabled={busy} className="h-12 w-full text-base">
            {busy ? "Joining…" : "Join Game"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
