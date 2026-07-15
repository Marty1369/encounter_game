import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { checkLocation } from "@/lib/gameActions";
import { MapPin, Loader2, CheckCircle2, XCircle } from "lucide-react";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; distance: number }
  | { kind: "fail"; distance: number };

export function LocationCheck({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleCheck() {
    setState({ kind: "loading" });
    // TODO: connect to google.script.run.checkLocation(...)
    const res = await checkLocation();
    setState(
      res.confirmed
        ? { kind: "success", distance: res.distanceMeters }
        : { kind: "fail", distance: res.distanceMeters },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setState({ kind: "idle" });
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" /> Location check
          </DialogTitle>
          <DialogDescription>
            Location is used only to confirm that your team reached the game location.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {state.kind === "idle" && (
            <Button onClick={handleCheck} className="h-11 w-full">
              Check my location
            </Button>
          )}
          {state.kind === "loading" && (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Checking location…
            </div>
          )}
          {state.kind === "success" && (
            <div className="rounded-xl bg-emerald-50 p-4 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5" />
                <div>
                  <p className="font-medium">Location confirmed.</p>
                  <p className="text-sm opacity-80">
                    You may continue. (≈ {state.distance} m)
                  </p>
                </div>
              </div>
            </div>
          )}
          {state.kind === "fail" && (
            <div className="rounded-xl bg-orange-50 p-4 text-orange-900 dark:bg-orange-900/20 dark:text-orange-200">
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 h-5 w-5" />
                <div>
                  <p className="font-medium">You are not close enough yet.</p>
                  <p className="text-sm opacity-80">
                    Approximate distance: {state.distance} m. Keep moving!
                  </p>
                </div>
              </div>
              <Button
                onClick={handleCheck}
                variant="outline"
                className="mt-3 w-full"
              >
                Try again
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
