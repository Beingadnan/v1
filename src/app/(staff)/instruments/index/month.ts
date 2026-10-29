/** ?year=2026&month=3, defaulting to the current month in India. */
export function readIndexMonth(
  params: Record<string, string | string[] | undefined>,
  today: string,
): { year: number; month: number } {
  const [ty, tm] = today.split("-").map(Number) as [number, number];
  const year = Number(params.year);
  const month = Number(params.month);
  return {
    year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : ty,
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : tm,
  };
}
