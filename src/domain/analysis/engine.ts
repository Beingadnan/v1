/**
 * The analysis engine: from confirmed logger data to the report's numbers.
 * Pure (no database), versioned, with golden tests on QA Tech's own reports
 * (docs/research/phase-07-analysis.md).
 *
 * Bump ENGINE_VERSION whenever a result for the same input can change.
 */
export const ENGINE_VERSION = "7.0.0";

export type Quantity = "temp" | "rh";

export type Series = {
  positionId: string;
  label: string;
  ambient: boolean;
  quantity: Quantity;
  logger: { code: string; serialNo: string } | null;
  times: number[];
  values: (number | null)[];
};

export type Marker = { kind: string; at: number };

export type Window = {
  cycle: string;
  label: string;
  start: number;
  end: number;
  markers: Marker[];
};

export type Limits = {
  tempMin: number | null;
  tempMax: number | null;
  rhMin: number | null;
  rhMax: number | null;
};

export type Constants = {
  /** ΔH/R in kelvin: 83.144 kJ/mol ÷ 8.3144 J/(mol·K). */
  deltaHOverR: number;
  /** F0 reference temperature, °C. */
  tref: number;
  /** F0 z-value, °C. */
  z: number;
};

export const DEFAULT_CONSTANTS: Constants = { deltaHOverR: 10_000, tref: 121.1, z: 10 };

export type EngineInput = {
  series: Series[];
  windows: Window[];
  limits: Limits;
  constants: Constants;
  thermal: boolean;
  /** Positions left out by a decision ("Exclude probe"), with the reason. */
  excluded: { positionId: string; reason: string }[];
  /** Impact recalculation: an offset subtracted from a position's readings (its post-cal error). */
  corrections?: { positionId: string; quantity: Quantity; offset: number }[];
};

export type Stats = {
  count: number;
  min: number;
  max: number;
  avg: number;
  minAt: number;
  maxAt: number;
  /** Mean kinetic temperature from each reading (temperature only). */
  mkt: number | null;
};

export type Excursion = {
  positionId: string;
  label: string;
  quantity: Quantity;
  side: "high" | "low";
  limit: number;
  start: number;
  end: number;
  minutes: number;
  readings: number;
  peak: number;
};

export type PositionResult = {
  positionId: string;
  label: string;
  ambient: boolean;
  excluded: string | null;
  logger: { code: string; serialNo: string } | null;
  temp: Stats | null;
  rh: Stats | null;
  /** null when no limits apply (ambient, excluded, no limits set). */
  pass: boolean | null;
  f0: number | null;
};

export type CycleResult = {
  cycle: string;
  label: string;
  start: number;
  end: number;
  positions: PositionResult[];
  hot: { positionId: string; label: string; avg: number } | null;
  cold: { positionId: string; label: string; avg: number } | null;
  /** Highest and lowest single readings (they can be at other positions than hot/cold). */
  highest: { label: string; value: number; at: number } | null;
  lowest: { label: string; value: number; at: number } | null;
  excursions: Excursion[];
  pass: boolean | null;
  door: {
    openedAt: number;
    closedAt: number;
    peak: number | null;
    recoveryMinutes: number | null;
  }[];
  power: {
    offAt: number;
    onAt: number | null;
    holdoverMinutes: number | null;
    heldThroughout: boolean;
    recoveryMinutes: number | null;
  }[];
  hold: {
    start: number;
    end: number;
    minF0: { label: string; value: number } | null;
    tempRange: { min: number; max: number } | null;
  } | null;
};

export type EngineResult = { version: string; cycles: CycleResult[]; notes: string[] };

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Mean kinetic temperature (USP 〈1079.2〉) from readings in °C. */
export function mkt(valuesC: number[], deltaHOverR = DEFAULT_CONSTANTS.deltaHOverR): number | null {
  if (valuesC.length === 0) return null;
  const mean =
    valuesC.reduce((s, t) => s + Math.exp(-deltaHOverR / (t + 273.15)), 0) / valuesC.length;
  return deltaHOverR / -Math.log(mean) - 273.15;
}

/** F0 over time-stamped readings (trapezoid, minutes). */
export function f0(
  points: { at: number; value: number }[],
  tref = DEFAULT_CONSTANTS.tref,
  z = DEFAULT_CONSTANTS.z,
): number | null {
  if (points.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dt = (points[i]!.at - points[i - 1]!.at) / 60_000;
    if (dt <= 0) continue;
    const a = 10 ** ((points[i - 1]!.value - tref) / z);
    const b = 10 ** ((points[i]!.value - tref) / z);
    sum += ((a + b) / 2) * dt;
  }
  return sum;
}

function intervalMs(times: number[]): number {
  const d = times
    .slice(1)
    .map((t, i) => t - times[i]!)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)]! : 60_000;
}

/** Readings of a series inside a window (inclusive, with half an interval of slack). */
function within(s: Series, start: number, end: number) {
  const slack = intervalMs(s.times) / 2;
  const out: { at: number; value: number }[] = [];
  for (let i = 0; i < s.times.length; i += 1) {
    const t = s.times[i]!;
    const v = s.values[i];
    if (v === null || v === undefined) continue;
    if (t >= start - slack && t <= end + slack) out.push({ at: t, value: v });
  }
  return out;
}

export function statsOf(
  points: { at: number; value: number }[],
  withMkt: boolean,
  dHR: number,
): Stats | null {
  if (points.length === 0) return null;
  let min = points[0]!;
  let max = points[0]!;
  let sum = 0;
  for (const p of points) {
    if (p.value < min.value) min = p;
    if (p.value > max.value) max = p;
    sum += p.value;
  }
  return {
    count: points.length,
    min: min.value,
    max: max.value,
    avg: sum / points.length,
    minAt: min.at,
    maxAt: max.at,
    mkt: withMkt
      ? mkt(
          points.map((p) => p.value),
          dHR,
        )
      : null,
  };
}

function limitsFor(q: Quantity, l: Limits) {
  return q === "temp" ? { lo: l.tempMin, hi: l.tempMax } : { lo: l.rhMin, hi: l.rhMax };
}

const outside = (v: number, lo: number | null, hi: number | null) =>
  (lo !== null && v < lo) || (hi !== null && v > hi);

/** Consecutive readings beyond one limit, grouped into events. */
export function excursionsOf(
  s: Pick<Series, "positionId" | "label" | "quantity">,
  points: { at: number; value: number }[],
  lo: number | null,
  hi: number | null,
  step: number,
): Excursion[] {
  const out: Excursion[] = [];
  let cur: Excursion | null = null;
  for (const p of points) {
    const side = hi !== null && p.value > hi ? "high" : lo !== null && p.value < lo ? "low" : null;
    if (side && cur && cur.side === side && p.at - cur.end <= step * 1.5) {
      cur.end = p.at;
      cur.readings += 1;
      cur.peak = side === "high" ? Math.max(cur.peak, p.value) : Math.min(cur.peak, p.value);
      continue;
    }
    if (cur) out.push(cur);
    cur = side
      ? {
          positionId: s.positionId,
          label: s.label,
          quantity: s.quantity,
          side,
          limit: (side === "high" ? hi : lo)!,
          start: p.at,
          end: p.at,
          minutes: 0,
          readings: 1,
          peak: p.value,
        }
      : null;
  }
  if (cur) out.push(cur);
  // Duration counts each reading as one interval (a single reading = one interval).
  for (const e of out) e.minutes = Math.round((e.end - e.start + step) / 60_000);
  return out;
}

/**
 * Hot and cold spots by average (QA Tech's rule, BE-WF-02 page 5). A tie at
 * one decimal goes to the unrounded average, then the higher maximum (hot) or
 * lower minimum (cold), then the position order.
 */
export function hotCold(rows: { positionId: string; label: string; temp: Stats }[]) {
  if (rows.length === 0) return { hot: null, cold: null };
  const hot = [...rows].sort(
    (a, b) =>
      r1(b.temp.avg) - r1(a.temp.avg) ||
      b.temp.avg - a.temp.avg ||
      b.temp.max - a.temp.max ||
      rows.indexOf(a) - rows.indexOf(b),
  )[0]!;
  const cold = [...rows].sort(
    (a, b) =>
      r1(a.temp.avg) - r1(b.temp.avg) ||
      a.temp.avg - b.temp.avg ||
      a.temp.min - b.temp.min ||
      rows.indexOf(a) - rows.indexOf(b),
  )[0]!;
  return {
    hot: { positionId: hot.positionId, label: hot.label, avg: hot.temp.avg },
    cold: { positionId: cold.positionId, label: cold.label, avg: cold.temp.avg },
  };
}

/** Minutes from `from` until every series is back within limits (null: never in the window). */
function recovery(
  judged: { points: { at: number; value: number }[] }[],
  from: number,
  end: number,
  lo: number | null,
  hi: number | null,
): number | null {
  let worst = 0;
  for (const s of judged) {
    const after = s.points.filter((p) => p.at >= from && p.at <= end);
    if (after.length === 0) continue;
    // The first reading from which the series stays within limits to the end of the window.
    let back: number | null = null;
    for (let i = after.length - 1; i >= 0; i -= 1) {
      if (outside(after[i]!.value, lo, hi)) break;
      back = after[i]!.at;
    }
    if (back === null) return null;
    worst = Math.max(worst, back - from);
  }
  return Math.round(worst / 60_000);
}

export function analyse(input: EngineInput): EngineResult {
  const { constants: k, limits } = input;
  const excluded = new Map(input.excluded.map((e) => [e.positionId, e.reason]));
  const notes: string[] = [];
  const corr = new Map(
    (input.corrections ?? []).map((c) => [`${c.positionId}|${c.quantity}`, c.offset]),
  );
  const series = input.series.map((s) => {
    const offset = corr.get(`${s.positionId}|${s.quantity}`);
    return offset === undefined
      ? s
      : { ...s, values: s.values.map((v) => (v === null ? null : v - offset)) };
  });
  if (corr.size > 0) {
    notes.push(
      `Impact recalculation: ${[...corr.entries()].map(([key, o]) => `${key.split("|")[0]} corrected by ${o > 0 ? "−" : "+"}${Math.abs(o)}`).join(", ")}.`,
    );
  }
  const positions = [...new Map(series.map((s) => [s.positionId, s])).values()];

  const cycles = input.windows.map((w): CycleResult => {
    const per = positions.map((p): PositionResult & { _t: { at: number; value: number }[] } => {
      const t = series.find((s) => s.positionId === p.positionId && s.quantity === "temp");
      const h = series.find((s) => s.positionId === p.positionId && s.quantity === "rh");
      const tp = t ? within(t, w.start, w.end) : [];
      const hp = h ? within(h, w.start, w.end) : [];
      const temp = statsOf(tp, true, k.deltaHOverR);
      const rh = statsOf(hp, false, k.deltaHOverR);
      const ex = excluded.get(p.positionId) ?? null;
      const judgeable = !p.ambient && !ex;
      const tl = limitsFor("temp", limits);
      const hl = limitsFor("rh", limits);
      const hasLimits = tl.lo !== null || tl.hi !== null || hl.lo !== null || hl.hi !== null;
      const pass =
        judgeable && hasLimits && (temp || rh)
          ? !(
              (temp && (outside(temp.min, tl.lo, tl.hi) || outside(temp.max, tl.lo, tl.hi))) ||
              (rh && (outside(rh.min, hl.lo, hl.hi) || outside(rh.max, hl.lo, hl.hi)))
            )
          : null;
      return {
        positionId: p.positionId,
        label: p.label,
        ambient: p.ambient,
        excluded: ex,
        logger: p.logger,
        temp,
        rh,
        pass,
        f0: null,
        _t: tp,
      };
    });

    const judged = per.filter((p) => !p.ambient && !p.excluded);
    const { hot, cold } = hotCold(
      judged
        .filter((p) => p.temp)
        .map((p) => ({ positionId: p.positionId, label: p.label, temp: p.temp! })),
    );
    let highest: CycleResult["highest"] = null;
    let lowest: CycleResult["lowest"] = null;
    for (const p of judged) {
      if (!p.temp) continue;
      if (!highest || p.temp.max > highest.value)
        highest = { label: p.label, value: p.temp.max, at: p.temp.maxAt };
      if (!lowest || p.temp.min < lowest.value)
        lowest = { label: p.label, value: p.temp.min, at: p.temp.minAt };
    }

    // Excursions, per position and quantity.
    const excursions: Excursion[] = [];
    for (const s of series) {
      if (s.ambient || excluded.has(s.positionId)) continue;
      const { lo, hi } = limitsFor(s.quantity, limits);
      if (lo === null && hi === null) continue;
      excursions.push(...excursionsOf(s, within(s, w.start, w.end), lo, hi, intervalMs(s.times)));
    }
    excursions.sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));

    // Door and power markers.
    const tl = limitsFor("temp", limits);
    const markers = [...w.markers].sort((a, b) => a.at - b.at);
    const door: CycleResult["door"] = [];
    const power: CycleResult["power"] = [];
    const tempJudged = judged.map((p) => ({ points: p._t }));
    for (let i = 0; i < markers.length; i += 1) {
      const m = markers[i]!;
      if (m.kind === "door_opened") {
        const closed = markers.slice(i + 1).find((x) => x.kind === "door_closed");
        if (!closed) continue;
        const during = tempJudged.flatMap((s) =>
          s.points.filter((p) => p.at >= m.at && p.at <= closed.at),
        );
        door.push({
          openedAt: m.at,
          closedAt: closed.at,
          peak: during.length ? Math.max(...during.map((p) => p.value)) : null,
          recoveryMinutes: recovery(tempJudged, closed.at, w.end, tl.lo, tl.hi),
        });
      }
      if (m.kind === "power_off") {
        const on = markers.slice(i + 1).find((x) => x.kind === "power_on") ?? null;
        const until = on?.at ?? w.end;
        let firstOut: number | null = null;
        for (const s of tempJudged) {
          const out = s.points.find(
            (p) => p.at >= m.at && p.at <= until && outside(p.value, tl.lo, tl.hi),
          );
          if (out && (firstOut === null || out.at < firstOut)) firstOut = out.at;
        }
        power.push({
          offAt: m.at,
          onAt: on?.at ?? null,
          holdoverMinutes: firstOut === null ? null : Math.round((firstOut - m.at) / 60_000),
          heldThroughout: firstOut === null,
          recoveryMinutes: on ? recovery(tempJudged, on.at, w.end, tl.lo, tl.hi) : null,
        });
      }
    }

    // Thermal: F0 over the hold.
    let hold: CycleResult["hold"] = null;
    const hs = markers.find((m) => m.kind === "hold_start");
    const he = markers.find((m) => m.kind === "hold_end");
    if (input.thermal && hs && he && he.at > hs.at) {
      let minF0: { label: string; value: number } | null = null;
      const inHold: number[] = [];
      for (const p of per) {
        if (p.ambient || p.excluded) continue;
        const pts = p._t.filter((x) => x.at >= hs.at && x.at <= he.at);
        inHold.push(...pts.map((x) => x.value));
        const v = f0(pts, k.tref, k.z);
        p.f0 = v;
        if (v !== null && (!minF0 || v < minF0.value)) minF0 = { label: p.label, value: v };
      }
      hold = {
        start: hs.at,
        end: he.at,
        minF0,
        tempRange: inHold.length ? { min: Math.min(...inHold), max: Math.max(...inHold) } : null,
      };
    } else if (input.thermal) {
      notes.push(`${w.label}: no hold start and end recorded, so F0 isn't worked out.`);
    }

    const verdicts = per.map((p) => p.pass).filter((v): v is boolean => v !== null);
    return {
      cycle: w.cycle,
      label: w.label,
      start: w.start,
      end: w.end,
      positions: per.map((p) => {
        const { _t: readings, ...rest } = p;
        void readings;
        return rest;
      }),
      hot,
      cold,
      highest,
      lowest,
      excursions,
      pass: verdicts.length ? verdicts.every(Boolean) : null,
      door,
      power,
      hold,
    };
  });

  for (const [id, reason] of excluded) {
    const p = positions.find((x) => x.positionId === id);
    if (p) notes.push(`${p.label} left out: ${reason}`);
  }
  return { version: ENGINE_VERSION, cycles, notes };
}
