/**
 * Matches channels to positions and checks the data is complete, per
 * channel and per cycle window (docs/research/phase-06-data-import.md).
 * Pure: the service loads the study, the files and the times.
 */
import type { Quantity } from "./parse";

export type Severity = "blocker" | "warning" | "info";

export type DataIssue = {
  /** Same problem, same fingerprint: an acceptance with a reason sticks to it. */
  fingerprint: string;
  kind: IssueKind;
  severity: Severity;
  message: string;
  cycle: string | null;
  positionId: string | null;
};

export const ISSUE_KINDS = [
  "missing_logger",
  "missing_rh",
  "duplicate_channel",
  "unmatched_channel",
  "interval",
  "not_covered",
  "gap",
  "single_missing",
  "duplicate_time",
  "impossible",
  "unreadable",
  "bad_time",
  "stuck",
  "no_times",
  "outside_window",
] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

export type PositionInfo = {
  id: string;
  label: string;
  ambient: boolean;
  logger: { code: string; serialNo: string } | null;
};

export type ChannelInfo = {
  id: string;
  fileId: string;
  fileName: string;
  header: string;
  serial: string | null;
  quantity: Quantity;
  /** Set by a person (overrides the automatic match), or "ignored". */
  manual: { positionId: string | null; ignored: boolean } | null;
  values: (number | null)[];
  /** Indexes into values whose cell couldn't be read. */
  unreadable: number[];
};

export type FileInfo = {
  id: string;
  name: string;
  times: number[];
  badTimeRows: { row: number; text: string }[];
};

export type Window = { cycle: string; label: string; start: number | null; end: number | null };

export type Match = {
  positionId: string | null;
  how: "serial" | "code" | "label" | "manual" | "ignored" | "none";
};

const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
const loose = (s: string) => s.toUpperCase().replace(/[\s_]/g, "");

/** Which position each channel belongs to: by serial, then logger ID, then position label. */
export function matchChannels(
  channels: Pick<ChannelInfo, "id" | "serial" | "manual">[],
  positions: PositionInfo[],
): Map<string, Match> {
  const out = new Map<string, Match>();
  for (const ch of channels) {
    if (ch.manual) {
      out.set(
        ch.id,
        ch.manual.ignored
          ? { positionId: null, how: "ignored" }
          : { positionId: ch.manual.positionId, how: "manual" },
      );
      continue;
    }
    const s = ch.serial;
    let m: Match = { positionId: null, how: "none" };
    if (s) {
      const d = digits(s);
      const bySerial =
        d.length >= 5
          ? positions.find((p) => p.logger && digits(p.logger.serialNo) === d)
          : undefined;
      const byCode = positions.find((p) => p.logger && loose(p.logger.code) === loose(s));
      const byLabel = positions.find((p) => loose(p.label) === loose(s));
      if (bySerial) m = { positionId: bySerial.id, how: "serial" };
      else if (byCode) m = { positionId: byCode.id, how: "code" };
      else if (byLabel) m = { positionId: byLabel.id, how: "label" };
    }
    out.set(ch.id, m);
  }
  return out;
}

/** The usual gap between readings, in minutes (the median). */
export function intervalOf(times: number[]): number | null {
  if (times.length < 2) return null;
  const diffs = times
    .slice(1)
    .map((t, i) => t - times[i]!)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (diffs.length === 0) return null;
  return Math.round(diffs[Math.floor(diffs.length / 2)]! / 60_000);
}

const hhmm = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ms);

const qLabel = (q: Quantity) => (q === "rh" ? "%RH" : "°C");

export type CheckInput = {
  positions: PositionInfo[];
  files: FileInfo[];
  channels: ChannelInfo[];
  windows: Window[];
  intervalMinutes: number | null;
  needsRh: boolean;
};

export type CheckResult = {
  matches: Map<string, Match>;
  issues: DataIssue[];
  /** The windows used (a cycle without times uses the data's own span). */
  windows: Window[];
};

export function checkData(input: CheckInput): CheckResult {
  const { positions, files, channels, intervalMinutes, needsRh } = input;
  const issues: DataIssue[] = [];
  const add = (i: Omit<DataIssue, "fingerprint"> & { key?: string }) => {
    const { key, ...rest } = i;
    issues.push({
      ...rest,
      fingerprint: [i.kind, i.positionId ?? "", i.cycle ?? "", key ?? ""].join("|"),
    });
  };
  const matches = matchChannels(channels, positions);
  const fileById = new Map(files.map((f) => [f.id, f]));
  const byId = new Map(positions.map((p) => [p.id, p]));
  const name = (p: PositionInfo) =>
    p.logger ? `${p.label} (${p.logger.code}, ${p.logger.serialNo})` : p.label;

  // ---- files: unreadable times, interval
  for (const f of files) {
    for (const b of f.badTimeRows) {
      add({
        kind: "bad_time",
        severity: "blocker",
        message: `${f.name}: row ${b.row}'s time “${b.text}” can't be read. Correct it in the file and upload again.`,
        cycle: null,
        positionId: null,
        key: `${f.name}:${b.row}`,
      });
    }
    const iv = intervalOf(f.times);
    if (iv !== null && intervalMinutes && iv !== intervalMinutes) {
      add({
        kind: "interval",
        severity: "blocker",
        message: `${f.name} has readings every ${iv} min; the study is set to ${intervalMinutes} min.`,
        cycle: null,
        positionId: null,
        key: `${f.name}:${iv}`,
      });
    }
  }

  // ---- channels per position
  const used = channels.filter((c) => matches.get(c.id)?.positionId);
  const unmatched = channels.filter((c) => matches.get(c.id)?.how === "none");
  for (const c of unmatched) {
    add({
      kind: "unmatched_channel",
      severity: "warning",
      message: `${c.fileName}: “${c.header}” isn't a logger placed on this study. Pick its position, or ignore it.`,
      cycle: null,
      positionId: null,
      key: `${c.fileName}:${c.header}`,
    });
  }

  const placed = positions.filter((p) => p.logger);
  for (const p of placed) {
    const mine = used.filter((c) => matches.get(c.id)!.positionId === p.id);
    for (const q of ["temp", "rh"] as const) {
      const of = mine.filter((c) => c.quantity === q);
      if (of.length > 1) {
        add({
          kind: "duplicate_channel",
          severity: "blocker",
          message: `${name(p)} ${qLabel(q)} is in ${of.length} places: ${of.map((c) => `${c.fileName} “${c.header}”`).join(" and ")}. Ignore the one that's wrong.`,
          cycle: null,
          positionId: p.id,
          key: q,
        });
      }
    }
    if (!mine.some((c) => c.quantity === "temp")) {
      add({
        kind: "missing_logger",
        severity: "blocker",
        message: mine.length
          ? `${name(p)} has no °C readings in the data.`
          : `${name(p)} is not in the data. Upload its file, or match its column by hand.`,
        cycle: null,
        positionId: p.id,
        key: "temp",
      });
    }
    if (needsRh && !mine.some((c) => c.quantity === "rh")) {
      add({
        kind: "missing_rh",
        severity: "blocker",
        message: `${name(p)} has no %RH readings; this is an RH study.`,
        cycle: null,
        positionId: p.id,
        key: "rh",
      });
    }
  }

  // ---- windows
  const allTimes = files.flatMap((f) => f.times);
  const span =
    allTimes.length > 0
      ? { start: Math.min(...allTimes), end: Math.max(...allTimes) }
      : { start: null, end: null };
  const windows = input.windows.map((w) => {
    if (w.start !== null && w.end !== null) return w;
    add({
      kind: "no_times",
      severity: "warning",
      message: `${w.label}: no ${w.start === null ? "start" : "end"} was recorded on site, so the file's own ${w.start === null ? "first" : "last"} reading is used.`,
      cycle: w.cycle,
      positionId: null,
    });
    return { ...w, start: w.start ?? span.start, end: w.end ?? span.end };
  });

  // ---- per channel, per window
  const step = (intervalMinutes ?? 0) * 60_000;
  let outside = 0;
  for (const c of used) {
    const p = byId.get(matches.get(c.id)!.positionId!);
    if (!p) continue;
    const f = fileById.get(c.fileId)!;
    // Gaps are judged on the file's own interval; a wrong interval is its own blocker.
    const fileStep = (intervalOf(f.times) ?? 0) * 60_000 || step;
    const who = `${name(p)} ${qLabel(c.quantity)}`;
    const inAny = new Array<boolean>(f.times.length).fill(false);

    for (const w of windows) {
      if (w.start === null || w.end === null) continue;
      const tol = fileStep || 60_000;
      const idx = f.times
        .map((t, i) => i)
        .filter((i) => f.times[i]! >= w.start! - tol / 2 && f.times[i]! <= w.end! + tol / 2);
      for (const i of idx) inAny[i] = true;
      const readings = idx.filter((i) => c.values[i] !== null && c.values[i] !== undefined);

      if (readings.length === 0) {
        add({
          kind: "not_covered",
          severity: "blocker",
          message: `${who} has no readings in ${w.label.toLowerCase()} (${hhmm(w.start)} to ${hhmm(w.end)}).`,
          cycle: w.cycle,
          positionId: p.id,
          key: c.quantity,
        });
        continue;
      }
      const first = f.times[readings[0]!]!;
      const last = f.times[readings[readings.length - 1]!]!;
      if (first > w.start + tol || last < w.end - tol) {
        add({
          kind: "not_covered",
          severity: "blocker",
          message: `${who}: readings run ${hhmm(first)} to ${hhmm(last)}, but ${w.label.toLowerCase()} ran ${hhmm(w.start)} to ${hhmm(w.end)}.`,
          cycle: w.cycle,
          positionId: p.id,
          key: c.quantity,
        });
      }

      // Gaps: missing time rows or empty cells between readings.
      if (fileStep > 0) {
        for (let k = 1; k < readings.length; k += 1) {
          const a = f.times[readings[k - 1]!]!;
          const b = f.times[readings[k]!]!;
          const missing = Math.round((b - a) / fileStep) - 1;
          if (missing <= 0) continue;
          const blocker = missing >= 2;
          add({
            kind: blocker ? "gap" : "single_missing",
            severity: blocker ? "blocker" : "warning",
            message: blocker
              ? `${who}: ${missing} readings missing between ${hhmm(a)} and ${hhmm(b)} (a ${Math.round((b - a) / 60_000)}-min gap).`
              : `${who}: one reading missing at ${hhmm(a + fileStep)}.`,
            cycle: w.cycle,
            positionId: p.id,
            key: `${c.quantity}:${a}`,
          });
        }
      }

      // Duplicate times inside the window.
      for (let k = 1; k < idx.length; k += 1) {
        const i = idx[k]!;
        const j = idx[k - 1]!;
        if (f.times[i] !== f.times[j]) continue;
        const same = c.values[i] === c.values[j];
        add({
          kind: "duplicate_time",
          severity: same ? "warning" : "blocker",
          message: same
            ? `${who}: ${hhmm(f.times[i]!)} appears twice with the same reading; one is used.`
            : `${who}: ${hhmm(f.times[i]!)} appears twice with different readings (${c.values[j]} and ${c.values[i]}).`,
          cycle: w.cycle,
          positionId: p.id,
          key: `${c.quantity}:${f.times[i]}`,
        });
      }

      // Unreadable cells, impossible values, a stuck sensor.
      const bad = c.unreadable.filter((i) => idx.includes(i));
      if (bad.length > 0) {
        add({
          kind: "unreadable",
          severity: "blocker",
          message: `${who}: ${bad.length} cell${bad.length === 1 ? "" : "s"} can't be read as numbers, first at ${hhmm(f.times[bad[0]!]!)}.`,
          cycle: w.cycle,
          positionId: p.id,
          key: c.quantity,
        });
      }
      const values = readings.map((i) => c.values[i]!);
      const impossible = readings.filter((i) => {
        const v = c.values[i]!;
        return c.quantity === "rh" ? v < 0 || v > 100 : v < -100 || v > 400;
      });
      if (impossible.length > 0) {
        const v = c.values[impossible[0]!]!;
        add({
          kind: "impossible",
          severity: "blocker",
          message:
            c.quantity === "rh" && values.every((x) => x < 0)
              ? `${who}: every reading is below 0 %RH. These look like temperatures: are the °C and %RH columns swapped?`
              : `${who}: ${impossible.length} impossible reading${impossible.length === 1 ? "" : "s"}, first ${v}${qLabel(c.quantity)} at ${hhmm(f.times[impossible[0]!]!)}.`,
          cycle: w.cycle,
          positionId: p.id,
          key: c.quantity,
        });
      }
      if (values.length >= 12 && values.every((v) => v === values[0])) {
        add({
          kind: "stuck",
          severity: "warning",
          message: `${who} reads ${values[0]}${qLabel(c.quantity)} the whole of ${w.label.toLowerCase()}. Check the logger was working.`,
          cycle: w.cycle,
          positionId: p.id,
          key: c.quantity,
        });
      }
    }
    outside = Math.max(outside, inAny.filter((x) => !x).length);
  }
  if (outside > 0 && windows.some((w) => w.start !== null)) {
    add({
      kind: "outside_window",
      severity: "info",
      message: `${outside} reading${outside === 1 ? "" : "s"} per logger fall outside the recorded times (before the start or after the end) and are left out.`,
      cycle: null,
      positionId: null,
    });
  }

  const order: Record<Severity, number> = { blocker: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { matches, issues, windows };
}
