import { Link } from "@tanstack/react-router";
import { ClipboardList, Lightbulb, Trophy, Users, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tab = "task" | "hints" | "leaderboard" | "team";

const items: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "task", label: "Task", icon: ClipboardList },
  { id: "hints", label: "Hints", icon: Lightbulb },
  { id: "leaderboard", label: "Rank", icon: Trophy },
  { id: "team", label: "Team", icon: Users },
];

export function BottomNav({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch">
        {items.map((it) => {
          const Icon = it.icon;
          const isActive = active === it.id;
          return (
            <li key={it.id} className="flex-1">
              <button
                onClick={() => onChange(it.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex w-full flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{it.label}</span>
              </button>
            </li>
          );
        })}
        <li className="flex-1">
          <Link
            to="/admin"
            className="flex w-full flex-col items-center gap-0.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Shield className="h-5 w-5" />
            <span>Admin</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
