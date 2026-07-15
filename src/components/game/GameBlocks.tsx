import { assetUrl } from "@/lib/supabase";
import type { Block } from "@/lib/api";

// Renders question/hint media blocks. Media src is a bare filename resolved to the
// public Storage URL (handles spaces/diacritics via assetUrl).
export function GameBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => {
        if (b.type === "text")
          return (
            <p key={i} className="whitespace-pre-line text-base leading-relaxed text-foreground">
              {b.text}
            </p>
          );
        if (b.type === "image")
          return (
            <figure key={i} className="overflow-hidden rounded-xl border border-border bg-muted">
              <img src={assetUrl(b.src)} alt="" className="h-auto w-full object-cover" loading="lazy" />
            </figure>
          );
        if (b.type === "video")
          return (
            <video
              key={i}
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-xl border border-border"
              src={assetUrl(b.src)}
            />
          );
        return null;
      })}
    </div>
  );
}
