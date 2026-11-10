/**
 * What a new piece of equipment starts with, by type, so people confirm
 * values instead of typing them. Admins can change these in Settings to match
 * QA Tech's SOPs; these built-in values are the starting point.
 *
 * Sources:
 * - WHO TRS 961 Annex 9, Supplement 8 (Temperature mapping of storage areas, 2015):
 *   warehouses ≥ 7 days incl. a weekend; cold and freezer rooms 24–72 h;
 *   1–15 min sampling; grid every 5–10 m, 3 levels up to 3.6 m ceiling;
 *   seasonal (summer and winter) mapping for areas affected by outside temperature,
 *   usually not needed for cold rooms and freezer rooms.
 * - Industry practice for chambers: 9 loggers (8 corners + centre) for small units,
 *   15 for larger ones; cold rooms 15–30.
 * - QA Tech's own BE-WF-02 walk-in freezer report: 9 channels, 10 min, 24 h,
 *   with door-open and power-failure cycles for freezers (client decision).
 */
import type { EquipmentType } from "./equipment-types";

export const STUDY_CYCLES = [
  "empty",
  "loaded",
  "door_open",
  "power_failure",
  "min_load",
  "max_load",
] as const;
export type StudyCycle = (typeof STUDY_CYCLES)[number];

export const STUDY_CYCLE_LABELS: Record<StudyCycle, string> = {
  empty: "Empty",
  loaded: "Loaded",
  door_open: "Door open",
  power_failure: "Power failure",
  min_load: "Minimum load",
  max_load: "Maximum load",
};

export type TypeDefaults = {
  setPointC: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  rhMinPct: number | null;
  rhMaxPct: number | null;
  defaultChannels: number | null;
  readingIntervalMinutes: number | null;
  studyDurationHours: number | null;
  requalificationMonths: number | null;
  cycles: StudyCycle[];
  seasonalMapping: boolean;
};

const none = {
  setPointC: null,
  tempMinC: null,
  tempMaxC: null,
  rhMinPct: null,
  rhMaxPct: null,
};

export const BUILT_IN_TYPE_DEFAULTS: Record<EquipmentType, TypeDefaults> = {
  refrigerator: {
    ...none,
    setPointC: 5,
    tempMinC: 2,
    tempMaxC: 8,
    defaultChannels: 9,
    readingIntervalMinutes: 5,
    studyDurationHours: 24,
    requalificationMonths: 12,
    cycles: ["empty", "loaded", "door_open", "power_failure"],
    seasonalMapping: false,
  },
  freezer: {
    ...none,
    setPointC: -20,
    tempMinC: -25,
    tempMaxC: -15,
    defaultChannels: 9,
    readingIntervalMinutes: 5,
    studyDurationHours: 24,
    requalificationMonths: 12,
    cycles: ["empty", "loaded", "door_open", "power_failure"],
    seasonalMapping: false,
  },
  deep_freezer: {
    ...none,
    setPointC: -80,
    tempMinC: -90,
    tempMaxC: -70,
    defaultChannels: 9,
    readingIntervalMinutes: 5,
    studyDurationHours: 24,
    requalificationMonths: 12,
    cycles: ["empty", "loaded", "door_open", "power_failure"],
    seasonalMapping: false,
  },
  walk_in_freezer: {
    ...none,
    setPointC: -20,
    tempMinC: -25,
    tempMaxC: -15,
    defaultChannels: 15,
    readingIntervalMinutes: 10,
    studyDurationHours: 24,
    requalificationMonths: 12,
    cycles: ["empty", "loaded", "door_open", "power_failure"],
    seasonalMapping: false,
  },
  cold_room: {
    ...none,
    setPointC: 5,
    tempMinC: 2,
    tempMaxC: 8,
    defaultChannels: 15,
    readingIntervalMinutes: 10,
    studyDurationHours: 72,
    requalificationMonths: 12,
    cycles: ["empty", "loaded", "door_open", "power_failure"],
    seasonalMapping: false,
  },
  warehouse: {
    ...none,
    tempMaxC: 25,
    defaultChannels: null, // from the floor area: see suggestLoggerCount
    readingIntervalMinutes: 15,
    studyDurationHours: 168,
    requalificationMonths: 36,
    cycles: ["loaded"],
    seasonalMapping: true,
  },
  // A room such as dispensing or sampling (QA Tech's WH013: NMT 25 °C, every
  // 10 minutes for 24 hours, a logger on each wall plus one, and the ambient).
  room: {
    ...none,
    tempMaxC: 25,
    defaultChannels: null, // from the walls: see suggestLoggerCount
    readingIntervalMinutes: 10,
    studyDurationHours: 24,
    requalificationMonths: 12,
    cycles: ["empty"],
    seasonalMapping: false,
  },
  stability_chamber: {
    ...none,
    setPointC: 25,
    tempMinC: 23,
    tempMaxC: 27,
    rhMinPct: 55,
    rhMaxPct: 65,
    defaultChannels: 9,
    readingIntervalMinutes: 5,
    studyDurationHours: 24,
    requalificationMonths: 12,
    cycles: ["empty", "loaded", "door_open", "power_failure"],
    seasonalMapping: false,
  },
  incubator: {
    ...none,
    defaultChannels: 9,
    readingIntervalMinutes: 5,
    studyDurationHours: 24,
    requalificationMonths: 12,
    cycles: ["empty", "loaded", "door_open"],
    seasonalMapping: false,
  },
  vehicle: {
    ...none,
    setPointC: 5,
    tempMinC: 2,
    tempMaxC: 8,
    defaultChannels: 9,
    readingIntervalMinutes: 5,
    studyDurationHours: 24,
    requalificationMonths: 12,
    cycles: ["empty", "loaded", "door_open"],
    seasonalMapping: true,
  },
  autoclave: {
    ...none,
    defaultChannels: 12,
    readingIntervalMinutes: 1,
    studyDurationHours: 2,
    requalificationMonths: 12,
    cycles: ["empty", "loaded"],
    seasonalMapping: false,
  },
  dry_heat_oven: {
    ...none,
    defaultChannels: 10,
    readingIntervalMinutes: 1,
    studyDurationHours: 6,
    requalificationMonths: 12,
    cycles: ["empty", "loaded"],
    seasonalMapping: false,
  },
  other: {
    ...none,
    defaultChannels: null,
    readingIntervalMinutes: null,
    studyDurationHours: null,
    requalificationMonths: null,
    cycles: [],
    seasonalMapping: false,
  },
};

export type LoggerSuggestion = { count: number; reason: string };

/**
 * A starting logger count from the inside size. People can always change it;
 * the protocol (phase 5) records the final positions.
 *
 * - Up to 2 m³: 9 (eight corners and the centre).
 * - Up to 20 m³: 15 (two corner planes, centre and mid-points).
 * - Larger rooms and warehouses: WHO grid. A point every ~5 m along length
 *   and width on floors up to 200 m², every ~10 m up to 5,000 m², and every
 *   ~20 m beyond ("up to 20–30 m" in very large stores); levels about every
 *   1.8 m from 0.3 m up, at least 3 (WHO example: a 6 m store → 0.3, 1.8,
 *   3.6 and 5.4 m = 4 levels).
 */
export function suggestLoggerCount(
  size: {
    lengthM: number | null;
    widthM: number | null;
    heightM: number | null;
  },
  /** "room": loggers along the walls at working height (see roomWalls). */
  kind: "room" | "box" = "box",
): LoggerSuggestion | null {
  const { lengthM: l, widthM: w, heightM: h } = size;
  if (kind === "room") {
    if (!l || !w || l <= 0 || w <= 0) return null;
    const walls = roomWalls(l, w);
    const count = walls.reduce((n, k) => n + k, 0) + 1;
    return {
      count,
      reason: `${count} at working height: ${walls.join(" + ")} along walls 1 to 4 (one every ~${ROOM_WALL_SPACING_M} m) and the centre`,
    };
  }
  if (!l || !w || !h || l <= 0 || w <= 0 || h <= 0) return null;
  const volume = l * w * h;
  if (volume <= 2) return { count: 9, reason: "9 for up to 2 m³: eight corners and the centre" };
  if (volume <= 20) {
    return {
      count: 15,
      reason: `15 for ${round(volume)} m³: corners at two heights, centre and mid-points`,
    };
  }
  const floor = l * w;
  const spacing = floor <= 200 ? 5 : floor <= 5000 ? 10 : 20;
  const along = (d: number) => Math.max(2, Math.ceil(d / spacing) + 1);
  const levels = Math.max(3, 1 + Math.ceil((h - 0.6) / 1.8));
  const count = along(l) * along(w) * levels;
  return {
    count,
    reason: `${along(l)} × ${along(w)} grid every ~${spacing} m at ${levels} heights (WHO TRS 961 Supp. 8)`,
  };
}

/** Rooms: one logger every ~5 m along each wall, at least one per wall. */
export const ROOM_WALL_SPACING_M = 5;

/**
 * Loggers per wall of a room, walls numbered clockwise from the entrance
 * side: 1 front (along the length), 2 right, 3 back, 4 left. As in QA Tech's
 * WH013 report ("Working height on wall-1 near pass box & near door").
 */
export function roomWalls(lengthM: number, widthM: number): [number, number, number, number] {
  const k = (d: number) => Math.max(1, Math.round(d / ROOM_WALL_SPACING_M));
  return [k(lengthM), k(widthM), k(lengthM), k(widthM)];
}

function round(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}
