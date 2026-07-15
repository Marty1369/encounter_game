import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContentBlocks } from "./ContentBlocks";
import { LocationCheck } from "./LocationCheck";
import { AnswerFeedback } from "./AnswerFeedback";
import { mockTask } from "@/lib/mockData";
import { submitAnswer } from "@/lib/gameActions";
import { MapPin } from "lucide-react";

export function TaskScreen({ onNext }: { onNext: () => void }) {
  const task = mockTask;
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [showLocation, setShowLocation] = useState(false);
  const progress = (task.taskNumber / task.totalTasks) * 100;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    setBusy(true);
    // TODO: connect to google.script.run.submitAnswer(...)
    const res = await submitAnswer({ taskId: task.taskId, answer });
    setBusy(false);
    setFeedback(res.correct ? "correct" : "wrong");
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-32 pt-6">
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>
            Task {task.taskNumber} of {task.totalTasks}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <Card className="space-y-5 p-5 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read carefully — every clue matters.
          </p>
        </div>
        <ContentBlocks blocks={task.blocks} />

        {task.requiresLocation && (
          <div>
            <Button
              variant="outline"
              className="w-full gap-2 sm:w-auto"
              onClick={() => setShowLocation(true)}
            >
              <MapPin className="h-4 w-4" />
              Check my location
            </Button>
          </div>
        )}
      </Card>

      {feedback && (
        <div className="mt-4">
          <AnswerFeedback
            result={feedback}
            onRetry={() => {
              setFeedback(null);
              setAnswer("");
            }}
            onContinue={onNext}
          />
        </div>
      )}

      {/* Sticky answer bar */}
      <form
        onSubmit={handleSubmit}
        className="fixed inset-x-0 bottom-16 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:bottom-0"
      >
        <div className="mx-auto flex w-full max-w-2xl items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="answer" className="text-xs">
              Your answer
            </Label>
            <Input
              id="answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer…"
              className="h-11 text-base"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={busy} className="h-11 px-5">
            {busy ? "…" : "Submit"}
          </Button>
        </div>
      </form>

      <LocationCheck open={showLocation} onOpenChange={setShowLocation} />
    </div>
  );
}
