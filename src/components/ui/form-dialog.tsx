"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Dialog, DialogContent } from "./dialog";

/** A dialog opened by a trigger button; the form inside remounts fresh each time. */
export function FormDialog({
  trigger,
  wide,
  children,
}: {
  trigger: (open: () => void) => ReactNode;
  wide?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRound((r) => r + 1);
      }}
    >
      {trigger(() => setOpen(true))}
      <DialogContent
        className={
          wide ? "max-h-[90dvh] max-w-2xl overflow-y-auto" : "max-h-[90dvh] overflow-y-auto"
        }
      >
        <div key={round} className="contents">
          {children(() => {
            setOpen(false);
            setRound((r) => r + 1);
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Closes the dialog a moment after a successful save, so the message is seen. */
export function useCloseOnSuccess(ok: boolean | undefined, close: () => void) {
  useEffect(() => {
    if (!ok) return;
    const timer = setTimeout(close, 900);
    return () => clearTimeout(timer);
  }, [ok, close]);
}
