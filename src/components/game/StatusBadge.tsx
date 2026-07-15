import { cn } from "@/lib/utils";

type Status = "draft" | "lobby" | "active" | "paused" | "finished" | "online" | "offline";

const map: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground",
  lobby: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  active: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  paused: "bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200",
  finished: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-200",
  online: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  offline: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize",
        map[status],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}
