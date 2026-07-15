import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle } from "lucide-react";

export function AnswerFeedback({
  result,
  onRetry,
  onContinue,
}: {
  result: "correct" | "wrong";
  onRetry: () => void;
  onContinue: () => void;
}) {
  if (result === "correct") {
    return (
      <div className="rounded-2xl bg-emerald-50 p-5 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6" />
          <div className="flex-1">
            <p className="font-semibold">Correct!</p>
            <p className="text-sm opacity-80">Great work. Ready for the next task?</p>
          </div>
        </div>
        <Button onClick={onContinue} className="mt-4 w-full sm:w-auto">
          Continue to next task
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-orange-50 p-5 text-orange-900 dark:bg-orange-900/20 dark:text-orange-200">
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 h-6 w-6" />
        <div className="flex-1">
          <p className="font-semibold">Not quite.</p>
          <p className="text-sm opacity-80">Take another look at the clues.</p>
        </div>
      </div>
      <Button onClick={onRetry} variant="outline" className="mt-4 w-full sm:w-auto">
        Try again
      </Button>
    </div>
  );
}
