/** The due list's time window, read from the URL: 30, 60, 90 or 180 days. */
export const DUE_WINDOWS = [30, 60, 90, 180] as const;

export function readDueWindow(params: Record<string, string | string[] | undefined>) {
  const days = Number(params.days);
  return {
    days: (DUE_WINDOWS as readonly number[]).includes(days) ? days : 60,
    includeUnknown: params.unknown === "1",
  };
}
