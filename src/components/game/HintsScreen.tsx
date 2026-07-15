import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ContentBlocks } from "./ContentBlocks";
import type { Hint } from "@/lib/mockData";
import { mockTask } from "@/lib/mockData";
import { useHint } from "@/lib/gameActions";
import { Lock, Check, Lightbulb, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function HintsScreen() {
  const [hints, setHints] = useState<Hint[]>(mockTask.hints);
  const [open, setOpen] = useState<Record<string, boolean>>({ h1: true });

  async function handleUse(h: Hint) {
    // TODO: connect to google.script.run.useHint(...)
    await useHint({ hintId: h.hintId });
    setHints((prev) =>
      prev.map((x) => (x.hintId === h.hintId ? { ...x, status: "used" } : x)),
    );
    setOpen((o) => ({ ...o, [h.hintId]: true }));
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Hints</h1>
        <p className="text-sm text-muted-foreground">
          Hints cost points. Used hints remain visible.
        </p>
      </div>

      <div className="space-y-3">
        {hints.map((h) => (
          <Card
            key={h.hintId}
            className={cn(
              "p-4 transition-opacity",
              h.status === "locked" && "opacity-60",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    h.status === "used" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                    h.status === "available" && "bg-accent text-accent-foreground",
                    h.status === "locked" && "bg-muted text-muted-foreground",
                  )}
                >
                  {h.status === "locked" ? (
                    <Lock className="h-4 w-4" />
                  ) : h.status === "used" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Lightbulb className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <p className="font-medium">{h.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Penalty: −{h.penalty} pts
                    {h.status === "locked" && h.unlockText ? ` · ${h.unlockText}` : ""}
                    {h.status === "used" ? " · Used" : ""}
                  </p>
                </div>
              </div>

              {h.status === "available" && (
                <Button size="sm" onClick={() => handleUse(h)}>
                  Use hint
                </Button>
              )}
              {h.status === "used" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOpen((o) => ({ ...o, [h.hintId]: !o[h.hintId] }))}
                  className="gap-1"
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      open[h.hintId] && "rotate-180",
                    )}
                  />
                </Button>
              )}
            </div>

            {h.status === "used" && open[h.hintId] && (
              <div className="mt-4 border-t border-border pt-4">
                <ContentBlocks blocks={h.blocks} />
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
