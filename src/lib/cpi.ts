/**
 * FR-7: CPI = Calls / TRx * 100.
 *
 * TRx is 0 on 112 rows, so this has to handle divide-by-zero. I return
 * `undefined` rather than 0 or Infinity: 0 would say "this HCP costs nothing
 * per prescription", which is a different claim from "we can't work it out".
 */
export function cpi(calls: number, trx: number): number | undefined {
  if (!Number.isFinite(calls) || !Number.isFinite(trx) || trx === 0) return undefined;
  return (calls / trx) * 100;
}

/**
 * A few rows have calls = 99999 (looks like a "missing data" placeholder), and
 * one of them works out to 161,289%. That is a real number, so `Number.isFinite`
 * doesn't catch it, but it stretches the column and looks like a bug. I cap the
 * DISPLAY at 999% and put the real number in the tooltip. Sorting still uses
 * the uncapped value.
 */
export const CPI_MAX_DISPLAY = 1000;

export function formatCpi(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value >= CPI_MAX_DISPLAY) return '>999%';
  return `${value.toFixed(1)}%`;
}

export function isCpiClamped(value: number | undefined): boolean {
  return value !== undefined && value >= CPI_MAX_DISPLAY;
}

export function formatCpiExact(value: number | undefined): string {
  if (value === undefined) return 'not computable (TRx is 0)';
  return `${value.toFixed(2)}%`;
}
