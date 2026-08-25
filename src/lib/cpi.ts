export function cpi(calls: number, trx: number): number | undefined {
  if (!Number.isFinite(calls) || !Number.isFinite(trx) || trx === 0) return undefined;
  return (calls / trx) * 100;
}

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
