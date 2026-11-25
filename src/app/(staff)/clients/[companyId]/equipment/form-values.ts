import { isEquipmentType } from "@/domain/clients/equipment-types";
import type { getCompany, getEquipment } from "@/domain/clients/queries";

import type { EquipmentFormValues } from "./equipment-form";

type Company = NonNullable<Awaited<ReturnType<typeof getCompany>>>;
type Item = NonNullable<Awaited<ReturnType<typeof getEquipment>>>["equipment"];

/** numeric "-30.00" → "-30" for an editable input; null → "". */
export const plain = (value: string | number | null) =>
  value === null ? "" : String(Number(value));

/**
 * The sites and departments an item can be filed under: the active ones, plus
 * the item's own even if switched off since.
 */
export function equipmentPlaces(
  data: Company,
  item?: { siteId: string; departmentId: string | null },
) {
  return {
    sites: data.sites
      .filter((s) => s.active || s.id === item?.siteId)
      .map((s) => ({ id: s.id, name: s.name })),
    departments: data.departments
      .filter((d) => d.active || d.id === item?.departmentId)
      .map((d) => ({ id: d.id, name: d.name, siteId: d.siteId })),
  };
}

/** An item as the equipment form edits it. */
export function equipmentFormValues(item: Item): EquipmentFormValues {
  if (!isEquipmentType(item.type)) throw new Error(`Unknown equipment type ${item.type}`);
  return {
    id: item.id,
    siteId: item.siteId,
    departmentId: item.departmentId ?? "",
    code: item.code,
    name: item.name,
    type: item.type,
    location: item.location,
    make: item.make,
    model: item.model,
    serialNo: item.serialNo,
    lengthM: plain(item.lengthM),
    widthM: plain(item.widthM),
    heightM: plain(item.heightM),
    setPointC: plain(item.setPointC),
    tempMinC: plain(item.tempMinC),
    tempMaxC: plain(item.tempMaxC),
    rhMinPct: plain(item.rhMinPct),
    rhMaxPct: plain(item.rhMaxPct),
    defaultChannels: plain(item.defaultChannels),
    readingIntervalMinutes: plain(item.readingIntervalMinutes),
    studyDurationHours: plain(item.studyDurationHours),
    requalificationMonths: plain(item.requalificationMonths),
    lastStudyOn: item.lastStudyOn ?? "",
    cycles: item.cycles,
    seasonalMapping: item.seasonalMapping,
    notes: item.notes,
  };
}
