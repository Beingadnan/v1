/**
 * Kinds of equipment QA Tech maps or validates. Plain TypeScript so the
 * database CHECK constraint, forms, Excel import and (later) study defaults
 * share one list.
 *
 * `study` decides the default study and whether post-calibration is always
 * required: thermal validation (autoclave, oven) always needs post-cal;
 * temperature mapping only when the client's SOP asks for it.
 */
export const EQUIPMENT_TYPES = [
  "refrigerator",
  "freezer",
  "deep_freezer",
  "walk_in_freezer",
  "cold_room",
  "warehouse",
  "room",
  "stability_chamber",
  "incubator",
  "vehicle",
  "autoclave",
  "dry_heat_oven",
  "other",
] as const;

export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export type StudyKind = "mapping" | "thermal_validation";

export const EQUIPMENT_TYPE_INFO: Record<
  EquipmentType,
  { label: string; study: StudyKind; hasRh: boolean; area?: boolean }
> = {
  refrigerator: { label: "Refrigerator", study: "mapping", hasRh: false },
  freezer: { label: "Freezer", study: "mapping", hasRh: false },
  deep_freezer: { label: "Deep freezer", study: "mapping", hasRh: false },
  walk_in_freezer: { label: "Walk-in freezer", study: "mapping", hasRh: false },
  cold_room: { label: "Cold room", study: "mapping", hasRh: true },
  warehouse: { label: "Warehouse / store", study: "mapping", hasRh: true, area: true },
  room: {
    label: "Room (dispensing, sampling, clean room)",
    study: "mapping",
    hasRh: true,
    area: true,
  },
  stability_chamber: { label: "Stability chamber", study: "mapping", hasRh: true },
  incubator: { label: "Incubator", study: "mapping", hasRh: false },
  vehicle: { label: "Vehicle / reefer", study: "mapping", hasRh: false },
  autoclave: { label: "Autoclave", study: "thermal_validation", hasRh: false },
  dry_heat_oven: { label: "Dry heat oven / DHS", study: "thermal_validation", hasRh: false },
  other: { label: "Other", study: "mapping", hasRh: false },
};

/**
 * Rooms and stores are mapped as areas (QA Tech, Nov 2026): their report says
 * "Room" instead of "Equipment", the drawing is a floor plan, and the loggers
 * sit at working height along the walls (QA Tech's WH013, Dispensing-2).
 */
export function isArea(type: string | null | undefined): boolean {
  return isEquipmentType(type) && EQUIPMENT_TYPE_INFO[type].area === true;
}

/** What a report or sheet calls it: "Room" (WH013), "Area" for a store, else "Equipment". */
export function mappedNoun(type: string | null | undefined): "Room" | "Area" | "Equipment" {
  return type === "room" ? "Room" : isArea(type) ? "Area" : "Equipment";
}

export function isEquipmentType(value: unknown): value is EquipmentType {
  return typeof value === "string" && (EQUIPMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Finds a type from what people write in Excel ("Walk In Freezer", "Fridge",
 * "DHS"...). Returns null when nothing matches, so the import can ask.
 */
export function equipmentTypeFromText(text: string): EquipmentType | null {
  const key = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  if (!key) return null;
  const direct = key.replace(/ /g, "_");
  if (isEquipmentType(direct)) return direct;
  for (const type of EQUIPMENT_TYPES) {
    if (
      EQUIPMENT_TYPE_INFO[type].label
        .toLowerCase()
        .replace(/[^a-z]+/g, " ")
        .trim() === key
    ) {
      return type;
    }
  }
  const aliases: Record<string, EquipmentType> = {
    fridge: "refrigerator",
    refrigerators: "refrigerator",
    "walk in cold room": "cold_room",
    "walk in freezer": "walk_in_freezer",
    "cold storage": "cold_room",
    store: "warehouse",
    area: "room",
    "dispensing area": "room",
    dispensing: "room",
    "sampling area": "room",
    "sampling booth": "room",
    "clean room": "room",
    cleanroom: "room",
    "dry heat oven": "dry_heat_oven",
    dhs: "dry_heat_oven",
    oven: "dry_heat_oven",
    "dry heat sterilizer": "dry_heat_oven",
    reefer: "vehicle",
    "reefer vehicle": "vehicle",
    "deep freezer": "deep_freezer",
    "ultra low freezer": "deep_freezer",
    ulf: "deep_freezer",
    stability: "stability_chamber",
    "bod incubator": "incubator",
  };
  return aliases[key] ?? null;
}
