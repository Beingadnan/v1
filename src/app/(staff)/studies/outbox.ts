"use client";

import { newId } from "@/lib/uuid";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { ActionResult } from "@/lib/action-result";

import { eventAction, placeAction, precalAction } from "./actions";

/**
 * The phone's outbox: field actions that couldn't reach the server (no
 * signal in a cold room, a signed-out session) are kept in the browser and
 * sent again when the connection is back. Times keep the moment they were
 * tapped, and each entry has its own id, so sending twice records once.
 */

export type OutboxEntry =
  | {
      id: string;
      studyId: string;
      kind: "event";
      label: string;
      payload: Parameters<typeof eventAction>[1];
    }
  | {
      id: string;
      studyId: string;
      kind: "place";
      label: string;
      payload: Parameters<typeof placeAction>[1];
    }
  | {
      id: string;
      studyId: string;
      kind: "precal";
      label: string;
      payload: Parameters<typeof precalAction>[1];
    };
export type NewEntry = OutboxEntry extends infer E
  ? E extends OutboxEntry
    ? Omit<E, "id">
    : never
  : never;

const KEY = "qtech-outbox-v1";
const SIGNED_OUT = "You were signed out";

const CHANGED = "qtech-outbox-changed";

function raw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function read(): OutboxEntry[] {
  try {
    return JSON.parse(raw()) as OutboxEntry[];
  } catch {
    return [];
  }
}

function write(entries: OutboxEntry[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked: nothing more can be kept.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

async function send(e: OutboxEntry): Promise<ActionResult<unknown>> {
  switch (e.kind) {
    case "event":
      return eventAction(e.studyId, e.payload);
    case "place":
      return placeAction(e.studyId, e.payload);
    case "precal":
      return precalAction(e.studyId, e.payload);
  }
}

export type Outcome = { entry: OutboxEntry; result: ActionResult<unknown> };

/**
 * Runs an action now; if the network is down it is queued instead. Returns
 * the server's answer, or "queued".
 */
export function useOutbox(studyId: string, onDone?: (o: Outcome) => void) {
  const stored = useSyncExternalStore(subscribe, raw, () => "[]");
  const pending = useMemo(() => {
    try {
      return (JSON.parse(stored) as OutboxEntry[]).filter((e) => e.studyId === studyId);
    } catch {
      return [];
    }
  }, [stored, studyId]);
  const [signedOut, setSignedOut] = useState(false);
  const flushing = useRef(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const entry of read()) {
        let result: ActionResult<unknown>;
        try {
          result = await send(entry);
        } catch {
          break; // still offline: try again later
        }
        if (!result.ok && result.error.startsWith(SIGNED_OUT)) {
          setSignedOut(true);
          break;
        }
        setSignedOut(false);
        write(read().filter((x) => x.id !== entry.id));
        doneRef.current?.({ entry, result });
      }
    } finally {
      flushing.current = false;
    }
  }, []);

  useEffect(() => {
    void flush();
    const online = () => void flush();
    window.addEventListener("online", online);
    const timer = window.setInterval(() => {
      if (read().length > 0) void flush();
    }, 15_000);
    return () => {
      window.removeEventListener("online", online);
      window.clearInterval(timer);
    };
  }, [flush]);

  const run = useCallback(
    async (entry: NewEntry): Promise<ActionResult<unknown> | "queued" | "signed_out"> => {
      const full = { ...entry, id: newId() } as OutboxEntry;
      const queue = () => {
        write([...read(), full]);
        return "queued" as const;
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) return queue();
      try {
        const result = await send(full);
        if (!result.ok && result.error.startsWith(SIGNED_OUT)) {
          setSignedOut(true);
          return queue();
        }
        return result;
      } catch {
        return queue();
      }
    },
    [],
  );

  return { pending, signedOut, run, flush };
}
