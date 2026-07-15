import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { assetUrl } from "@/lib/supabase";
import type { HintView } from "@/lib/api";
import { Lock, Lightbulb } from "lucide-react";

function fmt(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// Time-gated hints. Unlocked hints render with content; among locked hints only the
// NEXT one shows (with a live countdown), later ones stay hidden (spec §5).
export function GameHints({
  hints, activatedAt, serverNow, onReveal, onNeedRefresh,
}: {
  hints: HintView[];
  activatedAt: string;
  serverNow: () => number;
  onReveal: (hintId: string) => void;
  onNeedRefresh: () => void;
}) {
  const activated = Date.parse(activatedAt);
  const revealed = useRef<Set<string>>(new Set());

  // Mark newly-unlocked hints revealed (for the leaderboard tiebreak); idempotent.
  useEffect(() => {
    for (const h of hints) {
      if (h.unlocked && !revealed.current.has(h.id)) {
        revealed.current.add(h.id);
        onReveal(h.id);
      }
    }
  }, [hints, onReveal]);

  if (!hints.length) {
    return (
      <div className="mx-auto w-full max-w-2xl px-5 py-10 text-center text-muted-foreground">
        <Lightbulb className="mx-auto mb-3 h-8 w-8 opacity-50" />
        <p>Šiai užduočiai užuominų nėra.</p>
      </div>
    );
  }

  const sorted = [...hints].sort((a, b) => a.ord - b.ord);
  const firstLocked = sorted.find((h) => !h.unlocked);
  // If the next locked hint's gate has passed but content hasn't arrived yet, refresh.
  if (firstLocked) {
    const remaining = (activated + firstLocked.reveal_after_min * 60000 - serverNow()) / 1000;
    if (remaining <= 0) onNeedRefresh();
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Užuominos</h1>
        <p className="text-sm text-muted-foreground">Užuominos atsirakina laikui bėgant.</p>
      </div>

      <div className="space-y-3">
        {sorted.map((h) => {
          if (!h.unlocked) {
            if (h.id !== firstLocked?.id) return null; // hide later locked hints
            const remaining = (activated + h.reveal_after_min * 60000 - serverNow()) / 1000;
            return (
              <Card key={h.id} className="flex items-center gap-3 p-4 opacity-70">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Lock className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium">Užuomina {h.ord}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {remaining > 0 ? `po ${fmt(remaining)}` : "atrakinama…"}
                  </p>
                </div>
              </Card>
            );
          }
          return (
            <Card key={h.id} className="p-4">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Lightbulb className="h-4 w-4" />
                </div>
                <p className="font-medium">Užuomina {h.ord}</p>
              </div>
              <HintContent type={h.type} content={h.content ?? ""} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function HintContent({ type, content }: { type: "text" | "image"; content: string }) {
  if (type === "image") {
    const [file, ...rest] = content.split(" — ");
    const caption = rest.join(" — ");
    return (
      <figure className="overflow-hidden rounded-xl border border-border bg-muted">
        <img src={assetUrl(file.trim())} alt="" className="h-auto w-full object-cover" loading="lazy" />
        {caption ? <figcaption className="px-3 py-2 text-xs text-muted-foreground">{caption}</figcaption> : null}
      </figure>
    );
  }
  return <p className="whitespace-pre-line text-base leading-relaxed text-foreground">{content}</p>;
}
