/**
 * Instruments QA Tech owns: the working fleet (data loggers, sensors) used on
 * client sites, and the master standards used to calibrate them.
 *
 * `certificateKind` is the series in QA Tech's certificate numbers
 * (QATECH/BHIWANDI/03/26/PDL-17) and the section of the Calibration Index.
 */
export const INSTRUMENT_TYPES = [
  "portable_logger",
  "rtd",
  "thermocouple",
  "pressure_transmitter",
  "temperature_indicator",
  "humidity_indicator",
  "reference_thermometer",
  "data_acquisition",
  "calibration_bath",
  "other",
] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const QUANTITIES = ["temperature", "humidity", "pressure"] as const;
export type Quantity = (typeof QUANTITIES)[number];

export const QUANTITY_UNITS: Record<Quantity, string> = {
  temperature: "°C",
  humidity: "%RH",
  pressure: "bar",
};

export const INSTRUMENT_TYPE_INFO: Record<
  InstrumentType,
  { label: string; certificateKind: string; indexSection: string }
> = {
  portable_logger: {
    label: "Portable data logger",
    certificateKind: "PDL",
    indexSection: "Portable Datalogger",
  },
  rtd: { label: "RTD sensor", certificateKind: "RTD", indexSection: "RTD Sensor" },
  thermocouple: { label: "Thermocouple (TC)", certificateKind: "TC", indexSection: "TC Sensor" },
  pressure_transmitter: {
    label: "Pressure transmitter",
    certificateKind: "PT",
    indexSection: "Pressure Transmitter",
  },
  temperature_indicator: {
    label: "Temperature indicator",
    certificateKind: "TI",
    indexSection: "Temperature Indicator",
  },
  humidity_indicator: {
    label: "Temperature & humidity indicator",
    certificateKind: "TH",
    indexSection: "Temperature & Humidity Indicator",
  },
  reference_thermometer: {
    label: "Reference thermometer (SPRT/SSPRT)",
    certificateKind: "RT",
    indexSection: "Reference Thermometer",
  },
  data_acquisition: {
    label: "Data acquisition / recorder",
    certificateKind: "DL",
    indexSection: "Data Acquisition",
  },
  calibration_bath: {
    label: "Calibration bath / dry block / chamber",
    certificateKind: "CB",
    indexSection: "Calibration Source",
  },
  other: { label: "Other", certificateKind: "CAL", indexSection: "Other" },
};

export const INSTRUMENT_TIERS = ["working", "master"] as const;
export type InstrumentTier = (typeof INSTRUMENT_TIERS)[number];

export const INSTRUMENT_STATUSES = ["active", "out_of_service", "retired", "lost"] as const;
export type InstrumentStatus = (typeof INSTRUMENT_STATUSES)[number];

export const STATUS_LABELS: Record<InstrumentStatus, string> = {
  active: "In use",
  out_of_service: "Out of service",
  retired: "Retired",
  lost: "Lost",
};

export function isInstrumentType(value: unknown): value is InstrumentType {
  return typeof value === "string" && (INSTRUMENT_TYPES as readonly string[]).includes(value);
}

/** "Portable Datalogger", "PDL", "data logger" → portable_logger; null when unsure. */
export function instrumentTypeFromText(text: string): InstrumentType | null {
  const key = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!key) return null;
  if (isInstrumentType(key.replace(/ /g, "_"))) return key.replace(/ /g, "_") as InstrumentType;
  for (const type of INSTRUMENT_TYPES) {
    const info = INSTRUMENT_TYPE_INFO[type];
    if (info.certificateKind.toLowerCase() === key || info.label.toLowerCase() === key) return type;
  }
  const aliases: [RegExp, InstrumentType][] = [
    [/data ?logger|portable/, "portable_logger"],
    [/\brtd\b|pt ?100/, "rtd"],
    [/thermo ?couple|\btc\b/, "thermocouple"],
    [/pressure/, "pressure_transmitter"],
    [/humidity|\brh\b|rotronic/, "humidity_indicator"],
    [/sprt|reference|drt/, "reference_thermometer"],
    [/indicator/, "temperature_indicator"],
    [/yokogawa|recorder|acquisition|\bgp ?20\b/, "data_acquisition"],
    [/bath|dry ?block|chamber/, "calibration_bath"],
  ];
  return aliases.find(([pattern]) => pattern.test(key))?.[1] ?? null;
}

/**
 * What each type of master can serve as a reference for. A certificate's
 * %RH points need a humidity reference, its °C points a temperature one.
 */
export const TYPE_MEASURES: Record<InstrumentType, readonly Quantity[]> = {
  portable_logger: ["temperature", "humidity"],
  rtd: ["temperature"],
  thermocouple: ["temperature"],
  pressure_transmitter: ["pressure"],
  temperature_indicator: ["temperature"],
  humidity_indicator: ["temperature", "humidity"],
  reference_thermometer: ["temperature"],
  data_acquisition: ["temperature"],
  calibration_bath: ["temperature"],
  other: ["temperature", "humidity", "pressure"],
};
