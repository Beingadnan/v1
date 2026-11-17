"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";

type Hit = { kind: string; label: string; detail: string; href: string };

/**
 * Ctrl+K (or ⌘K) search: jobs, POs, report numbers, equipment IDs, logger
 * codes and serials, certificate numbers, clients. Arrow keys and Enter.
 */
export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const json = (await res.json().catch(() => ({ hits: [] }))) as { hits?: Hit[] };
        if (mine === seq.current) {
          setHits(json.hits ?? []);
          setActive(0);
        }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const shown = q.trim().length < 2 ? [] : hits;
  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(h.href);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        className="flex h-9 max-w-md min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-muted-foreground hover:border-primary"
        aria-label="Search"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Search jobs, reports, serials…</span>
        <kbd className="ml-auto hidden rounded border border-border bg-surface px-1.5 text-xs sm:inline">
          Ctrl K
        </kbd>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/40" />
        <DialogPrimitive.Content className="fixed top-[10vh] left-1/2 z-50 flex max-h-[75vh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Jobs, POs, report numbers, equipment, instruments, certificates and clients
          </DialogPrimitive.Description>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-muted-foreground" aria-hidden="true" />
            <input
              autoFocus
              aria-label="Search for"
              className="h-12 flex-1 bg-transparent text-base outline-none"
              placeholder="Job, PO, report No., equipment ID, serial, certificate…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, shown.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter" && shown[active]) {
                  e.preventDefault();
                  go(shown[active]!);
                }
              }}
            />
          </div>
          <ul role="listbox" aria-label="Results" className="overflow-y-auto p-1">
            {shown.map((h, i) => (
              <li key={`${h.kind}-${h.href}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(h)}
                  className={`flex w-full items-baseline gap-2 rounded-md px-3 py-2 text-left text-sm ${i === active ? "bg-surface-muted" : ""}`}
                >
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">{h.kind}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{h.label}</span>
                    {h.detail ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {h.detail}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
            {q.trim().length >= 2 && !loading && shown.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing found for “{q.trim()}”.
              </li>
            ) : null}
            {q.trim().length < 2 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Type at least two characters.
              </li>
            ) : null}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
