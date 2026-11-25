/**
 * Reads a logger export by its content, not by a fixed layout.
 *
 * QA Tech's files differ (see docs/research/phase-06-data-import.md):
 * header lines above the table, serials over a units row, split or combined
 * date and time, Excel dates or "13.09.2026" text, readings as numbers or
 * text, a "Sr. No." column, and Minimum/Maximum/MKT rows under the data.
 * This finds the readings and says what it couldn't read; it never invents
 * a reading or guesses which logger a column belongs to.
 *
 * Pure: the caller turns the file into a grid of cells (grid.ts).
 */

export type Cell = string | number | Date | null;
export type Sheet = { name: string; rows: Cell[][] };

export type Quantity = "temp" | "rh";

export type ParsedChannel = {
  /** 1-based column in the sheet. */
  column: number;
  /** The header text above the column, joined ("83561878 °C"). */
  header: string;
  /** Digits that look like a logger serial, or a logger/position code (DL-01). */
  serial: string | null;
  quantity: Quantity;
  ambient: boolean;
  /** One value per time; null where the cell is empty or unreadable. */
  values: (number | null)[];
};

export type ParsedSheet = {
  sheet: string;
  /** 1-based rows used as header lines. */
  headerRows: number[];
  /** 1-based row of the first reading. */
  firstDataRow: number;
  lastDataRow: number;
  /** Epoch ms of each reading row (Indian time on the logger, as an instant). */
  times: number[];
  /** 1-based source row of each time. */
  sourceRows: number[];
  channels: ParsedChannel[];
  /** Cells inside the table that hold something that isn't a number. */
  unreadable: { row: number; column: number; text: string }[];
  /** Rows between readings whose date or time couldn't be read. */
  badTimeRows: { row: number; text: string }[];
  /** What the reader decided, in words (shown to the person uploading). */
  notes: string[];
};

export type ParseResult =
  | { ok: true; best: ParsedSheet; others: { sheet: string; why: string }[] }
  | { ok: false; error: string };

const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Not a reading: a row number or index column. */
const INDEX_HEADER = /^(sr|s|sl|serial|row)?\.?\s*no\.?$|^(index|#|sr\.?\s*no\.?)$/i;
/** Rows under the data that summarise it. */
const SUMMARY_ROW =
  /^(min|max|avg|average|mean|mkt|std|total|temp in k|-?\s*∆|e-|-ln|range|count)/i;

// ------------------------------------------------------------------ cells

function text(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? "" : c.toISOString();
  return String(c).trim();
}

function isBlank(c: Cell): boolean {
  return text(c) === "";
}

/** A reading: 22.4, "22.4", "22,4", "-21.6 °C", "35 %RH". Null when empty or not a number. */
export function readingOf(c: Cell): { value: number | null; unreadable: boolean } {
  if (c === null || c === undefined) return { value: null, unreadable: false };
  if (typeof c === "number") return { value: Number.isFinite(c) ? c : null, unreadable: false };
  if (c instanceof Date) return { value: null, unreadable: true };
  const t = c.trim();
  if (t === "" || /^[-–—]+$/.test(t) || /^n\/?a$/i.test(t)) {
    return { value: null, unreadable: false };
  }
  const cleaned = t
    .replace(/\s*(°\s*[cf]|deg\.?\s*c|%\s*rh|%|rh)\s*$/i, "")
    .replace(/^\+/, "")
    .replace(/[−–]/g, "-")
    .trim();
  const normal = /^-?\d+,\d+$/.test(cleaned) ? cleaned.replace(",", ".") : cleaned;
  if (/^-?\d+(\.\d+)?$/.test(normal)) return { value: Number(normal), unreadable: false };
  return { value: null, unreadable: true };
}

type Wall = { y: number; m: number; d: number };
type Clock = { h: number; mi: number; s: number };

const wallToMs = (d: Wall, t: Clock) => Date.UTC(d.y, d.m - 1, d.d, t.h, t.mi, t.s) - IST_OFFSET_MS;

/** Excel stores a time of day as a date on 30/31 Dec 1899 or 1 Jan 1900. */
const isTimeOnlyDate = (v: Date) => v.getUTCFullYear() < 1901;

function clockOfDate(v: Date): Clock {
  return { h: v.getUTCHours(), mi: v.getUTCMinutes(), s: v.getUTCSeconds() };
}

function parseClock(t: string): Clock | null {
  const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  const ap = m[4]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || mi > 59 || s > 59) return null;
  return { h, mi, s };
}

function validWall(d: Wall): Wall | null {
  if (d.y < 1990 || d.y > 2100 || d.m < 1 || d.m > 12 || d.d < 1 || d.d > 31) return null;
  const check = new Date(Date.UTC(d.y, d.m - 1, d.d));
  return check.getUTCDate() === d.d ? d : null;
}

/** "13.09.2026", "13/09/2026", "20-Sep-2026", "2026-09-13" (day first, as in India). */
function parseWall(t: string): Wall | null {
  const s = t.trim();
  let m = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(s);
  if (m) return validWall({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    if (b > 12 && a <= 12) [a, b] = [b, a]; // 09/13/2026 written month first
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validWall({ y, m: b, d: a });
  }
  m = /^(\d{1,2})[\s./-]([a-z]{3})[a-z]*[\s./,-]*(\d{2}|\d{4})$/i.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    if (!month) return null;
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validWall({ y, m: month, d: Number(m[1]) });
  }
  return null;
}

/** What a cell says about time: a date, a time of day, or both. */
type TimeBit = { date?: Wall; clock?: Clock };

function excelSerial(n: number): TimeBit | null {
  // Excel day numbers for 1990–2100; a fraction alone is a time of day.
  if (n >= 0 && n < 1) {
    const secs = Math.round(n * 86400);
    return {
      clock: { h: Math.floor(secs / 3600) % 24, mi: Math.floor(secs / 60) % 60, s: secs % 60 },
    };
  }
  if (n < 32874 || n > 73051) return null;
  const ms = Math.round((n - 25569) * 86400_000);
  const v = new Date(ms);
  const date = { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() };
  const frac = n - Math.floor(n);
  return frac > 1e-9 ? { date, clock: clockOfDate(v) } : { date };
}

function timeBit(c: Cell, numbersAreSerials: boolean): TimeBit | null {
  if (c === null || c === undefined) return null;
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return null;
    if (isTimeOnlyDate(c)) return { clock: clockOfDate(c) };
    const date = { y: c.getUTCFullYear(), m: c.getUTCMonth() + 1, d: c.getUTCDate() };
    const clock = clockOfDate(c);
    return clock.h || clock.mi || clock.s ? { date, clock } : { date };
  }
  if (typeof c === "number") return numbersAreSerials ? excelSerial(c) : null;
  const t = c.trim();
  if (!t) return null;
  const clock = parseClock(t);
  if (clock) return { clock };
  const date = parseWall(t);
  if (date) return { date };
  // "13.09.2026 18:00:00", "2026-09-13T18:00", "20-Sep-2026 10:00 AM"
  const m = /^(.+?)[\sT]+(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?)?)$/i.exec(t);
  if (m) {
    const d = parseWall(m[1]!);
    const k = parseClock(m[2]!);
    if (d && k) return { date: d, clock: k };
  }
  return null;
}

// ------------------------------------------------------------------ layout

type Layout = { dateCol: number; timeCol: number | null };

/** The time of one row under a layout, or null. */
function rowTime(row: Cell[], layout: Layout): number | null {
  const a = timeBit(row[layout.dateCol] ?? null, true);
  if (!a) return null;
  if (layout.timeCol === null) {
    return a.date && a.clock
      ? wallToMs(a.date, a.clock)
      : a.date
        ? wallToMs(a.date, { h: 0, mi: 0, s: 0 })
        : null;
  }
  const b = timeBit(row[layout.timeCol] ?? null, true);
  if (!a.date || !b?.clock) return null;
  return wallToMs(a.date, b.clock);
}

/** Finds the date/time columns and the first reading row. */
function findLayout(rows: Cell[][]): { layout: Layout; start: number } | null {
  const limit = Math.min(rows.length, 80);
  for (let r = 0; r < limit; r += 1) {
    const row = rows[r] ?? [];
    for (let c = 0; c < Math.min(row.length, 6); c += 1) {
      const bit = timeBit(row[c] ?? null, true);
      if (!bit?.date) continue;
      const candidates: Layout[] = [];
      if (bit.clock) candidates.push({ dateCol: c, timeCol: null });
      for (let k = c + 1; k <= c + 2 && k < row.length; k += 1) {
        if (timeBit(row[k] ?? null, true)?.clock) candidates.push({ dateCol: c, timeCol: k });
      }
      candidates.push({ dateCol: c, timeCol: null });
      for (const layout of candidates) {
        // Three rows in a row, each later than the last, and with numbers beside them.
        const t = [0, 1, 2].map((i) => rowTime(rows[r + i] ?? [], layout));
        if (t.every((x): x is number => x !== null) && t[0]! < t[1]! && t[1]! < t[2]!) {
          const numbers = (rows[r] ?? []).filter(
            (v, i) =>
              i !== layout.dateCol && i !== layout.timeCol && readingOf(v ?? null).value !== null,
          ).length;
          if (numbers > 0) return { layout, start: r };
        }
      }
    }
  }
  return null;
}

/** Digits that look like a serial, else a code like DL-01, TRH-3601, SN-100234. */
export function serialIn(header: string): string | null {
  const digits = header.match(/\d{5,}/g);
  if (digits) return digits.sort((a, b) => b.length - a.length)[0]!;
  const code = /\b([A-Z]{1,6}-?\s?\d{1,5}[A-Z]?)\b/i.exec(header);
  return code ? code[1]!.toUpperCase().replace(/\s/g, "") : null;
}

function quantityOf(header: string): Quantity {
  return /%\s*rh|\brh\b|humid|%/i.test(header) ? "rh" : "temp";
}

/**
 * Some exports keep the day's date for a few rows after midnight while the
 * time has moved on (the Testo export behind PR-04, Nov 2026: "12.11.2026"
 * beside 00:00 to 00:25). A reading that falls almost a day behind the one
 * before it is that: it moves forward a day. Changes `times` in place;
 * returns how many rows moved and the first one's new time.
 */
export function rollPastMidnight(times: number[]): { rows: number; first: number } | null {
  const DAY = 86_400_000;
  let rows = 0;
  let first = 0;
  for (let i = 1; i < times.length; i += 1) {
    const step = times[i]! - times[i - 1]!;
    // Back by a day less one plausible reading interval (up to 6 h).
    if (step < 0 && step + DAY > 0 && step + DAY <= 6 * 3_600_000) {
      times[i] = times[i]! + DAY;
      if (rows === 0) first = times[i]!;
      rows += 1;
    }
  }
  return rows > 0 ? { rows, first } : null;
}

/**
 * Dates typed day first ("01-08-2026" for 1 Aug) that Excel stored month
 * first (8 Jan) make the readings jump a month at midnight (QA Tech's PR-02,
 * Nov 2026: 8 Jan to 8 Feb in one day of 5-minute readings). When every date
 * can be swapped and only the swapped dates run on without a jump, they are
 * swapped in place. Returns the first date as read and as swapped.
 */
export function swapDayMonth(times: number[]): { from: number; to: number } | null {
  const DAY = 86_400_000;
  const jumps = (xs: number[]) =>
    xs.some((x, i) => i > 0 && (x - xs[i - 1]! > 2 * DAY || x - xs[i - 1]! < -DAY));
  if (!jumps(times)) return null;
  const swapped: number[] = [];
  for (const t of times) {
    const w = new Date(t + IST_OFFSET_MS);
    const day = w.getUTCDate();
    if (day > 12) return null;
    swapped.push(
      Date.UTC(
        w.getUTCFullYear(),
        day - 1,
        w.getUTCMonth() + 1,
        w.getUTCHours(),
        w.getUTCMinutes(),
        w.getUTCSeconds(),
      ) - IST_OFFSET_MS,
    );
  }
  if (jumps(swapped)) return null;
  const out = { from: times[0]!, to: swapped[0]! };
  swapped.forEach((t, i) => (times[i] = t));
  return out;
}

// ------------------------------------------------------------------ sheet

function parseSheet(sheet: Sheet): ParsedSheet | null {
  const rows = sheet.rows;
  const found = findLayout(rows);
  if (!found) return null;
  const { layout, start } = found;
  const notes: string[] = [];

  // Header lines: the non-blank rows directly above the first reading (up to 3).
  const headerRows: number[] = [];
  for (let r = start - 1; r >= 0 && headerRows.length < 3; r -= 1) {
    const row = rows[r] ?? [];
    if (row.every(isBlank)) break;
    headerRows.unshift(r);
  }

  // Readings run until the summary rows, or three rows that aren't readings.
  const times: number[] = [];
  const sourceRows: number[] = [];
  const badTimeRows: { row: number; text: string }[] = [];
  let misses = 0;
  let r = start;
  for (; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const t = rowTime(row, layout);
    if (t !== null) {
      times.push(t);
      sourceRows.push(r);
      misses = 0;
      continue;
    }
    const first = text(row.find((v) => !isBlank(v ?? null)) ?? null);
    if (SUMMARY_ROW.test(first)) break;
    if (row.every((v) => isBlank(v ?? null))) {
      misses += 1;
      if (misses >= 2) break;
      continue;
    }
    // A row with readings but no readable time is reported, not dropped silently.
    const hasNumbers = row.some(
      (v, i) => i !== layout.dateCol && i !== layout.timeCol && readingOf(v ?? null).value !== null,
    );
    if (!hasNumbers) {
      misses += 1;
      if (misses >= 3) break;
      continue;
    }
    badTimeRows.push({
      row: r + 1,
      text: [row[layout.dateCol], layout.timeCol !== null ? row[layout.timeCol] : null]
        .map((v) => text(v ?? null))
        .filter(Boolean)
        .join(" "),
    });
  }
  if (times.length < 2) return null;
  const swap = swapDayMonth(times);
  if (swap) {
    const day = (t: number) =>
      new Date(t + IST_OFFSET_MS).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    notes.push(
      `The dates were stored month first (the first as ${day(swap.from)}), so the readings jumped a month: read day first, from ${day(swap.to)}. Check this is the study's date.`,
    );
  }
  const rolled = rollPastMidnight(times);
  if (rolled) {
    const day = new Date(rolled.first + IST_OFFSET_MS).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    notes.push(
      `${rolled.rows} row${rolled.rows === 1 ? "" : "s"} after midnight still carried the day before's date: read as ${day}.`,
    );
  }
  const lastDataRow = sourceRows[sourceRows.length - 1]! + 1;

  // Channel columns: mostly numbers in the readings, not an index column.
  const width = Math.max(...sourceRows.slice(0, 50).map((i) => (rows[i] ?? []).length));
  const sample = sourceRows.slice(0, Math.min(sourceRows.length, 40));
  const headerOf = (c: number) =>
    headerRows.map((hr) => text(rows[hr]?.[c] ?? null).replace(/\s+/g, " "));

  const columns: number[] = [];
  for (let c = 0; c < width; c += 1) {
    if (c === layout.dateCol || c === layout.timeCol) continue;
    const numeric = sample.filter((i) => readingOf(rows[i]?.[c] ?? null).value !== null).length;
    if (numeric < sample.length * 0.5) continue;
    const head = headerOf(c).join(" ").trim();
    if (INDEX_HEADER.test(head)) {
      notes.push(`Column ${c + 1} (“${head}”) is a row number, not a reading: left out.`);
      continue;
    }
    // A column counting 1, 2, 3… with no header is a row number too.
    const firsts = sample.slice(0, 5).map((i) => readingOf(rows[i]?.[c] ?? null).value);
    if (!head && firsts.every((v, k) => v === (firsts[0] ?? 0) + k) && firsts.length >= 3) {
      notes.push(`Column ${c + 1} counts 1, 2, 3…: a row number, left out.`);
      continue;
    }
    columns.push(c);
  }

  // A title line right above the table ("Equipment ID. … BE-WF-02") isn't a column
  // header: with three or more reading columns, a line naming at most one of them is left out.
  let lines = headerRows.map((_, li) => columns.map((c) => headerOf(c)[li] ?? ""));
  if (columns.length >= 3) {
    const kept = lines.filter((line) => line.filter(Boolean).length > 1);
    if (kept.length > 0 && kept.length < lines.length) {
      notes.push(
        `${lines.length - kept.length} title line${lines.length - kept.length === 1 ? "" : "s"} above the table left out of the column names.`,
      );
      lines = kept;
    }
  }
  // A serial written once over its °C and %RH columns applies to both.
  for (let li = 0; li < lines.length - 1; li += 1) {
    const line = lines[li]!;
    const below = lines[li + 1]!;
    for (let k = 1; k < line.length; k += 1) {
      if (!line[k] && line[k - 1] && below[k] && columns[k]! - columns[k - 1]! === 1) {
        line[k] = line[k - 1]!;
      }
    }
  }

  const unreadable: { row: number; column: number; text: string }[] = [];
  const channels: ParsedChannel[] = columns.map((c, k) => {
    const header = lines
      .map((line) => line[k] ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
    const values = sourceRows.map((i) => {
      const cell = rows[i]?.[c] ?? null;
      const { value, unreadable: bad } = readingOf(cell);
      if (bad) unreadable.push({ row: i + 1, column: c + 1, text: text(cell) });
      return value;
    });
    return {
      column: c + 1,
      header: header || `Column ${c + 1}`,
      serial: header ? serialIn(header) : null,
      quantity: quantityOf(header),
      ambient: /ambient|amb\b|outside/i.test(header),
      values,
    };
  });
  if (channels.length === 0) return null;

  const layoutNote =
    layout.timeCol === null
      ? `Date and time read from column ${layout.dateCol + 1}.`
      : `Date from column ${layout.dateCol + 1}, time from column ${layout.timeCol + 1}.`;
  notes.unshift(`${times.length} readings from row ${start + 1} to ${lastDataRow}. ${layoutNote}`);
  if (
    r < rows.length &&
    SUMMARY_ROW.test(text((rows[r] ?? []).find((v) => !isBlank(v ?? null)) ?? null))
  ) {
    notes.push(
      `Stopped at row ${r + 1} (“${text((rows[r] ?? []).find((v) => !isBlank(v ?? null)) ?? null)}”): a summary, not readings.`,
    );
  }

  return {
    sheet: sheet.name,
    headerRows: headerRows.map((h) => h + 1),
    firstDataRow: start + 1,
    lastDataRow,
    times,
    sourceRows: sourceRows.map((i) => i + 1),
    channels,
    unreadable,
    badTimeRows,
    notes,
  };
}

/**
 * Reads every sheet and keeps the one with the most readings; a sheet whose
 * columns have serials in their headers wins a tie (a copy pasted without
 * headers can't be matched to loggers).
 */
export function parseWorkbook(sheets: Sheet[]): ParseResult {
  const parsed = sheets
    .map((s) => ({ s, p: parseSheet(s) }))
    .filter((x): x is { s: Sheet; p: ParsedSheet } => x.p !== null);
  if (parsed.length === 0) {
    return {
      ok: false,
      error:
        "No readings found: no sheet has a date and time column with numbers beside it. Check the file is the logger data, not the report.",
    };
  }
  const score = (p: ParsedSheet) => {
    const readings = p.times.length * p.channels.length;
    const named = p.channels.filter((c) => c.serial).length / p.channels.length;
    return readings * (0.5 + named);
  };
  parsed.sort((a, b) => score(b.p) - score(a.p));
  const best = parsed[0]!.p;
  const others = parsed.slice(1).map(({ p }) => ({
    sheet: p.sheet,
    why:
      p.times.length === best.times.length && p.channels.length === best.channels.length
        ? "same readings, fewer logger names"
        : `${p.channels.length} columns × ${p.times.length} readings`,
  }));
  if (others.length > 0) {
    best.notes.push(
      `Read sheet “${best.sheet}”. Also found: ${others.map((o) => `“${o.sheet}” (${o.why})`).join(", ")}.`,
    );
  }
  return { ok: true, best, others };
}
