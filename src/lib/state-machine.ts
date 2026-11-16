/**
 * A status field's allowed moves, declared once (ADR 0022). Every write of
 * the status goes through `move()`, so a move nobody declared fails loudly
 * instead of leaving a record in a state the rest of the app doesn't expect.
 * Unit tests read the same table: which states are reachable, which are final.
 */
export type Machine<S extends string> = {
  /** What the status belongs to, for messages: "job", "report"… */
  name: string;
  states: readonly S[];
  /** For each state, where it may go. A state with no moves is final. */
  moves: Readonly<Record<S, readonly S[]>>;
};

export class IllegalMove extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`A ${machine} can't go from ${from} to ${to}.`);
    this.name = "IllegalMove";
  }
}

export function machine<S extends string>(
  name: string,
  states: readonly S[],
  moves: Readonly<Record<S, readonly S[]>>,
): Machine<S> {
  for (const [from, tos] of Object.entries(moves) as [S, readonly S[]][]) {
    for (const to of tos) {
      if (!states.includes(to)) throw new Error(`${name}: ${from} → unknown state ${to}`);
      if (to === from) throw new Error(`${name}: ${from} → itself is not a move`);
    }
  }
  return { name, states, moves };
}

export function canMove<S extends string>(m: Machine<S>, from: S, to: S): boolean {
  return m.moves[from]?.includes(to) ?? false;
}

/** Checks a move before it is written; returns `to` for `.set({ status: move(...) })`. */
export function move<S extends string>(m: Machine<S>, from: S, to: S): S {
  if (!canMove(m, from, to)) throw new IllegalMove(m.name, from, to);
  return to;
}

/** The states reachable from `start`, to find states nothing leads to. */
export function reachable<S extends string>(m: Machine<S>, start: S): Set<S> {
  const seen = new Set<S>([start]);
  const queue: S[] = [start];
  while (queue.length) {
    for (const to of m.moves[queue.shift()!] ?? []) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

export const isFinal = <S extends string>(m: Machine<S>, s: S) => (m.moves[s] ?? []).length === 0;
