import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PauseCircle, RefreshCw } from "lucide-react";

export function PausedScreen({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center px-5 py-10">
      <Card className="space-y-5 p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
          <PauseCircle className="h-7 w-7" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Game is paused</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The organizers paused the game. Hang tight — we'll notify you when it resumes.
          </p>
        </div>
        <Button onClick={onRefresh} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Check status
        </Button>
      </Card>
    </div>
  );
}
