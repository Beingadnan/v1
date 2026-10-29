/**
 * Pasting readings copied from Excel or logger software into the readings
 * grid (points × instruments). Pure, so the rules are unit-tested:
 *
 * - values keep only the number: "-20.2 °C" → -20.2, "15,2" → 15.2;
 * - a copied header row of serials or IDs places each column under the
 *   right instrument, whatever the order — a serial never becomes a reading;
 * - "Deviation" rows copied from an FT-05 sheet are skipped;
 * - pasted into the master column, the first value of each row is the master
 *   reading and the rest go to the instruments;
 * - whatever does not fit is counted, so the screen can say so.
 */
import { cleanDecimal } from "./calibration-math";

export type PasteTarget = { point: number; /** -1 = the master column */ column: number };
export type PasteInput = {
  text: string;
  at: PasteTarget;
  instruments: { code: string; serialNo: string }[];
  /** grid[point][instrument] */
  grid: string[][];
  references: string[];
};
export type PasteResult = {
  grid: string[][];
  references: string[];
  placed: number;
  /** Values that had no cell to go to. */
  overflow: number;
  /** True when a header row of serials/IDs decided the columns. */
  byHeader: boolean;
  skippedRows: number;
};

/** Tab-separated text as Excel puts it on the clipboard, with quoted multi-line cells. */
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === "\t") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

const tokens = (cell: string) =>
  cell
    .toLowerCase()
    .split(/[\s/]+/)
    .filter(Boolean);

/** Which instrument a header cell names ("84028189", "TRH-3601", "TRH-3601\n84028189"), or -1. */
function instrumentIndex(cell: string, instruments: PasteInput["instruments"]): number {
  const parts = tokens(cell);
  if (parts.length === 0) return -1;
  return instruments.findIndex(
    (i) =>
      (i.serialNo !== "" && parts.includes(i.serialNo.toLowerCase())) ||
      (i.code !== "" && parts.includes(i.code.toLowerCase())),
  );
}

export function applyPaste(input: PasteInput): PasteResult {
  const grid = input.grid.map((r) => [...r]);
  const references = [...input.references];
  let rows = parseClipboard(input.text);
  const before = rows.length;
  rows = rows.filter((r) => !r.some((c) => /^deviation/i.test(c)));
  const skippedRows = before - rows.length;
  let placed = 0;
  let overflow = 0;
  const value = (raw: string) => cleanDecimal(raw) ?? raw;

  // A header row naming the instruments decides where each column goes.
  const first = rows[0] ?? [];
  const map = first.map((c) => instrumentIndex(c, input.instruments));
  const named = map.filter((i) => i >= 0).length;
  // Two cells naming this certificate's instruments can't be readings (one for a single instrument).
  const byHeader = named >= Math.min(2, input.instruments.length);
  if (byHeader) {
    rows.slice(1).forEach((row, r) => {
      const point = input.at.point + r;
      row.forEach((raw, c) => {
        if (raw === "" || cleanDecimal(raw) === null) return; // labels such as "Actual Output in °C"
        const target = map[c] ?? -1;
        if (target < 0 || !grid[point]) {
          overflow++;
          return;
        }
        grid[point]![target] = value(raw);
        placed++;
      });
    });
    return { grid, references, placed, overflow, byHeader, skippedRows };
  }

  rows.forEach((row, r) => {
    const point = input.at.point + r;
    if (!grid[point]) {
      overflow += row.filter((c) => c !== "").length;
      return;
    }
    let cells = row;
    if (input.at.column < 0) {
      // Master column first.
      const [master = "", ...rest] = cells;
      if (master !== "") {
        references[point] = value(master);
        placed++;
      }
      cells = rest;
    }
    const start = Math.max(0, input.at.column);
    cells.forEach((raw, c) => {
      if (raw === "") return;
      const target = start + c;
      if (target >= input.instruments.length) {
        overflow++;
        return;
      }
      grid[point]![target] = value(raw);
      placed++;
    });
  });
  return { grid, references, placed, overflow, byHeader, skippedRows };
}
