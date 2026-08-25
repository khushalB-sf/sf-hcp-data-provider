import { cpi } from './cpi.ts';
import {
  getGroupIndex,
  getRows,
  splitKey,
  territoryKey,
  toNumber,
  type RowId,
} from './data.ts';

export type ColumnId = 'id' | 'name' | 'specialty' | 'calls' | 'trx' | 'nrx' | 'cpi';
export type SortDir = 'asc' | 'desc';
export interface Sort {
  column: ColumnId;
  dir: SortDir;
}

export interface Column {
  id: ColumnId;
  label: string;
  width: number;
  numeric: boolean;
}

export const COLUMNS: Column[] = [
  { id: 'id', label: 'ID', width: 110, numeric: false },
  { id: 'name', label: 'Name', width: 150, numeric: false },
  { id: 'specialty', label: 'Specialty', width: 130, numeric: false },
  { id: 'calls', label: 'Calls', width: 110, numeric: true },
  { id: 'trx', label: 'TRx', width: 90, numeric: true },
  { id: 'nrx', label: 'NRx', width: 90, numeric: true },
  { id: 'cpi', label: 'CPI', width: 90, numeric: true },
];

export const GUTTER_WIDTH = 250;
export const ROW_HEIGHT = 32;
export const TOTAL_WIDTH = GUTTER_WIDTH + COLUMNS.reduce((sum, c) => sum + c.width, 0);

/** Running totals for a group. `count` is a row count, not distinct ids. */
export interface Totals {
  count: number;
  calls: number;
  trx: number;
  nrx: number;
  /** How many rows in this group have calls above the validator's cap of 60. */
  overCap: number;
}

export const emptyTotals = (): Totals => ({ count: 0, calls: 0, trx: 0, nrx: 0, overCap: 0 });

/** Group CPI is total calls / total trx, NOT the average of each row's CPI. */
export const totalsCpi = (t: Totals): number | undefined => cpi(t.calls, t.trx);

export interface Filters {
  search: string;
  region: string | null;
}

/** One row in the flat list that the virtualizer renders. */
export type VisualRow =
  | { kind: 'region'; key: string; label: string; totals: Totals }
  | { kind: 'territory'; key: string; label: string; totals: Totals; rowIds: RowId[] }
  | { kind: 'data'; key: string; rowId: RowId };

export interface RowModel {
  visualRows: VisualRow[];
  /** territory key -> the matching row ids, after filtering and sorting */
  buckets: Map<string, RowId[]>;
  grandTotals: Totals;
  matchCount: number;
}

/** `calls` after any accepted edit, otherwise the source value. */
export type GetCalls = (rowId: RowId) => number;

function matchesSearch(rowId: RowId, needle: string): boolean {
  if (needle === '') return true;
  const row = getRows()[rowId]!;
  return (
    row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle)
  );
}

/**
 * The value a column sorts by. `undefined` means "this row has nothing to
 * compare" — a null specialty, or a CPI we couldn't compute. Those always go
 * to the bottom, in both directions (see ASSUMPTIONS.md).
 */
function sortValue(rowId: RowId, column: ColumnId, getCalls: GetCalls): string | number | undefined {
  const row = getRows()[rowId]!;
  switch (column) {
    case 'id':
      return row.id; // zero-padded, so string order === numeric order
    case 'name':
      return row.name;
    case 'specialty':
      return row.specialty ?? undefined;
    case 'calls':
      return getCalls(rowId);
    case 'trx':
      return row.trx;
    case 'nrx':
      return row.nrx;
    case 'cpi':
      return cpi(getCalls(rowId), row.trx);
  }
}

function compare(
  a: RowId,
  b: RowId,
  sort: Sort,
  getCalls: GetCalls,
  collator: Intl.Collator,
): number {
  const va = sortValue(a, sort.column, getCalls);
  const vb = sortValue(b, sort.column, getCalls);

  // Rows with no comparable value sort last whichever direction we're going.
  const aEmpty = va === undefined || (typeof va === 'number' && !Number.isFinite(va));
  const bEmpty = vb === undefined || (typeof vb === 'number' && !Number.isFinite(vb));
  if (aEmpty && bEmpty) return a - b;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const sign = sort.dir === 'asc' ? 1 : -1;
  let result: number;
  if (typeof va === 'string' && typeof vb === 'string') {
    result = collator.compare(va, vb);
  } else {
    result = (va as number) - (vb as number);
  }
  // Ties always break the same way so the order doesn't jump around.
  return result !== 0 ? result * sign : a - b;
}

/**
 * Builds everything the grid needs: filter, sort inside each territory, add up
 * the totals, then flatten into one list of visual rows.
 *
 * I sort within each territory rather than sorting all 50,000 at once, because
 * rows never move between territories anyway. It also means "stable inside a
 * group" is automatic.
 */
export function buildRowModel(
  filters: Filters,
  sort: Sort | null,
  collapsed: Set<string>,
  getCalls: GetCalls,
): RowModel {
  const rows = getRows();
  const index = getGroupIndex();
  const needle = filters.search.trim().toLowerCase();
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

  const buckets = new Map<string, RowId[]>();
  const territoryTotals = new Map<string, Totals>();
  const regionTotals = new Map<string, Totals>();
  const grandTotals = emptyTotals();
  let matchCount = 0;

  for (const region of index.regions) {
    if (filters.region !== null && region !== filters.region) continue;

    const rTotals = emptyTotals();

    for (const key of index.territoriesByRegion.get(region)!) {
      const matching: RowId[] = [];
      const tTotals = emptyTotals();

      for (const rowId of index.byTerritory.get(key)!) {
        if (!matchesSearch(rowId, needle)) continue;
        matching.push(rowId);

        const row = rows[rowId]!;
        const calls = getCalls(rowId);
        tTotals.count++;
        if (Number.isFinite(calls)) {
          tTotals.calls += calls;
          if (calls > 60) tTotals.overCap++;
        }
        tTotals.trx += row.trx;
        tTotals.nrx += row.nrx;
      }

      if (matching.length === 0) continue; // don't show empty groups

      if (sort !== null) matching.sort((a, b) => compare(a, b, sort, getCalls, collator));

      buckets.set(key, matching);
      territoryTotals.set(key, tTotals);
      matchCount += matching.length;

      rTotals.count += tTotals.count;
      rTotals.calls += tTotals.calls;
      rTotals.trx += tTotals.trx;
      rTotals.nrx += tTotals.nrx;
      rTotals.overCap += tTotals.overCap;
    }

    if (rTotals.count === 0) continue;
    regionTotals.set(region, rTotals);

    grandTotals.count += rTotals.count;
    grandTotals.calls += rTotals.calls;
    grandTotals.trx += rTotals.trx;
    grandTotals.nrx += rTotals.nrx;
    grandTotals.overCap += rTotals.overCap;
  }

  // Sorting a numeric column also reorders the groups by their total.
  const sortedRegions = [...regionTotals.keys()];
  if (sort !== null && sort.column !== 'id' && sort.column !== 'name' && sort.column !== 'specialty') {
    sortedRegions.sort((a, b) =>
      compareTotals(regionTotals.get(a)!, regionTotals.get(b)!, sort) || a.localeCompare(b),
    );
  } else {
    sortedRegions.sort();
  }

  const visualRows: VisualRow[] = [];

  for (const region of sortedRegions) {
    visualRows.push({
      kind: 'region',
      key: `region:${region}`,
      label: region,
      totals: regionTotals.get(region)!,
    });
    if (collapsed.has(`region:${region}`)) continue;

    const keys = index.territoriesByRegion
      .get(region)!
      .filter((k) => buckets.has(k));

    if (sort !== null && sort.column !== 'id' && sort.column !== 'name' && sort.column !== 'specialty') {
      keys.sort((a, b) =>
        compareTotals(territoryTotals.get(a)!, territoryTotals.get(b)!, sort) ||
        a.localeCompare(b),
      );
    }

    for (const key of keys) {
      const groupKey = `territory:${key}`;
      visualRows.push({
        kind: 'territory',
        key: groupKey,
        label: splitKey(key).territory,
        totals: territoryTotals.get(key)!,
        rowIds: buckets.get(key)!,
      });
      if (collapsed.has(groupKey)) continue;

      for (const rowId of buckets.get(key)!) {
        visualRows.push({ kind: 'data', key: `row:${rowId}`, rowId });
      }
    }
  }

  return { visualRows, buckets, grandTotals, matchCount };
}

function compareTotals(a: Totals, b: Totals, sort: Sort): number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  if (sort.column === 'cpi') {
    const ca = totalsCpi(a);
    const cb = totalsCpi(b);
    // Same rule as rows: a group with no CPI goes last either way.
    if (ca === undefined && cb === undefined) return 0;
    if (ca === undefined) return 1;
    if (cb === undefined) return -1;
    return (ca - cb) * sign;
  }
  const key = sort.column as 'calls' | 'trx' | 'nrx';
  return (a[key] - b[key]) * sign;
}

/** Where a row sits in the visual list, so undo can scroll to it. -1 if hidden. */
export function findVisualIndex(visualRows: VisualRow[], rowId: RowId): number {
  return visualRows.findIndex((r) => r.kind === 'data' && r.rowId === rowId);
}

/** The two group rows a row sits under, so we can expand them. */
export function ancestorKeys(rowId: RowId): string[] {
  const row = getRows()[rowId]!;
  return [`region:${row.region}`, `territory:${territoryKey(row.region, row.territory)}`];
}

export { toNumber };
