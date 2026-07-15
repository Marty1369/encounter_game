import type { ContentBlock } from "@/lib/mockData";
import { ExternalLink } from "lucide-react";

// renderContentBlocks — renders rich content blocks (text/image/audio/video/link).
export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "text":
      return <p className="text-base leading-relaxed text-foreground">{block.text}</p>;
    case "image":
      return (
        <figure className="overflow-hidden rounded-xl border border-border bg-muted">
          <img
            src={block.url}
            alt={block.caption ?? ""}
            className="h-auto w-full object-cover"
            loading="lazy"
          />
          {block.caption ? (
            <figcaption className="px-3 py-2 text-xs text-muted-foreground">
              {block.caption}
            </figcaption>
          ) : null}
        </figure>
      );
    case "audio":
      return (
        <audio controls className="w-full" src={block.url}>
          Your browser does not support audio.
        </audio>
      );
    case "video":
      return (
        <video controls className="w-full rounded-xl border border-border" src={block.url}>
          Your browser does not support video.
        </video>
      );
    case "link":
      return (
        <a
          href={block.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-accent-foreground hover:bg-accent"
        >
          <ExternalLink className="h-4 w-4" />
          {block.text ?? block.url}
        </a>
      );
  }
}
