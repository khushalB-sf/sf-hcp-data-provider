import { beforeEach, describe, expect, it } from 'vitest';
import { cpi } from './cpi.ts';
import { getRows, toNumber, type RowId } from './data.ts';
import { buildRowModel, totalsCpi, type Filters, type Sort } from './rowModel.ts';

const noFilters: Filters = { search: '', region: null };
const sourceCalls = (rowId: RowId): number => toNumber(getRows()[rowId]!.calls);

let rows: ReturnType<typeof getRows>;

beforeEach(() => {
  rows = getRows();
});

describe('grouping and totals', () => {
  it('puts every row into exactly one territory', () => {
    const model = buildRowModel(noFilters, null, new Set(), sourceCalls);
    let total = 0;
    for (const bucket of model.buckets.values()) total += bucket.length;
    expect(total).toBe(50000);
    expect(model.matchCount).toBe(50000);
  });

  it('adds up a territory total correctly', () => {
    const model = buildRowModel(noFilters, null, new Set(), sourceCalls);
    const [key, rowIds] = [...model.buckets.entries()][0]!;

    let expectedTrx = 0;
    for (const rowId of rowIds) expectedTrx += rows[rowId]!.trx;

    const territoryRow = model.visualRows.find(
      (r) => r.kind === 'territory' && r.key === `territory:${key}`,
    );
    expect(territoryRow?.kind).toBe('territory');
    if (territoryRow?.kind !== 'territory') throw new Error('not found');
    expect(territoryRow.totals.trx).toBe(expectedTrx);
    expect(territoryRow.totals.count).toBe(rowIds.length);
  });

  it('works out group CPI as total calls / total trx, not the average of each row', () => {
    // These two are very different when one row has a huge calls value.
    const totals = { count: 2, calls: 100010, trx: 110, nrx: 0, overCap: 1 };
    const ratioOfSums = totalsCpi(totals)!;
    const averageOfRatios = (cpi(100000, 10)! + cpi(10, 100)!) / 2;
    expect(Math.round(ratioOfSums)).toBe(90918);
    expect(Math.round(averageOfRatios)).toBe(500005);
    expect(ratioOfSums).not.toBeCloseTo(averageOfRatios);
  });

  it('hides a group entirely when nothing in it matches the search', () => {
    const model = buildRowModel(
      { search: 'HCP-000001', region: null },
      null,
      new Set(),
      sourceCalls,
    );
    expect(model.matchCount).toBeGreaterThan(0);
    // Only groups that actually contain a match should appear.
    for (const row of model.visualRows) {
      if (row.kind === 'territory') expect(row.totals.count).toBeGreaterThan(0);
    }
  });

  it('collapsing a group removes its rows from the list but keeps its header', () => {
    const open = buildRowModel(noFilters, null, new Set(), sourceCalls);
    const firstRegion = open.visualRows.find((r) => r.kind === 'region')!;

    const shut = buildRowModel(noFilters, null, new Set([firstRegion.key]), sourceCalls);
    expect(shut.visualRows.length).toBeLessThan(open.visualRows.length);

    const header = shut.visualRows.find((r) => r.key === firstRegion.key);
    expect(header).toBeDefined();
    // The total is still shown even though the group is shut — that's the point.
    if (header?.kind !== 'region') throw new Error('wrong kind');
    expect(header.totals.count).toBeGreaterThan(0);
  });
});

describe('sorting', () => {
  const sortedCallsOf = (sort: Sort): number[] => {
    const model = buildRowModel(noFilters, sort, new Set(), sourceCalls);
    const key = [...model.buckets.keys()][0]!;
    return model.buckets.get(key)!.map(sourceCalls);
  };

  it('sorts ascending and descending', () => {
    const asc = sortedCallsOf({ column: 'calls', dir: 'asc' });
    const desc = sortedCallsOf({ column: 'calls', dir: 'desc' });
    expect(asc[0]!).toBeLessThanOrEqual(asc[asc.length - 1]!);
    expect(desc[0]!).toBeGreaterThanOrEqual(desc[desc.length - 1]!);
  });

  it('sorts string-typed calls by their number, so "9" comes before 10', () => {
    const model = buildRowModel(noFilters, { column: 'calls', dir: 'asc' }, new Set(), sourceCalls);
    for (const rowIds of model.buckets.values()) {
      const values = rowIds.map(sourceCalls);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
      }
      break;
    }
  });

  it('puts rows with a null specialty last, whichever direction you sort', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const model = buildRowModel(
        noFilters,
        { column: 'specialty', dir },
        new Set(),
        sourceCalls,
      );
      const rowIds = [...model.buckets.values()].find((b) =>
        b.some((id) => rows[id]!.specialty === null),
      );
      if (rowIds === undefined) continue;
      const firstNull = rowIds.findIndex((id) => rows[id]!.specialty === null);
      // Once we hit a null, everything after it should also be null.
      expect(rowIds.slice(firstNull).every((id) => rows[id]!.specialty === null)).toBe(true);
    }
  });

  it('puts rows with no CPI last, whichever direction you sort', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const model = buildRowModel(noFilters, { column: 'cpi', dir }, new Set(), sourceCalls);
      const rowIds = [...model.buckets.values()].find((b) => b.some((id) => rows[id]!.trx === 0));
      if (rowIds === undefined) continue;
      const firstNone = rowIds.findIndex((id) => rows[id]!.trx === 0);
      expect(rowIds.slice(firstNone).every((id) => rows[id]!.trx === 0)).toBe(true);
    }
  });

  it('gives the same order every time (ties do not shuffle)', () => {
    const once = buildRowModel(noFilters, { column: 'trx', dir: 'asc' }, new Set(), sourceCalls);
    const twice = buildRowModel(noFilters, { column: 'trx', dir: 'asc' }, new Set(), sourceCalls);
    const key = [...once.buckets.keys()][0]!;
    expect(once.buckets.get(key)).toEqual(twice.buckets.get(key));
  });
});

describe('search and filter', () => {
  it('matches on name and on id, ignoring case', () => {
    const byName = buildRowModel({ search: 'priya', region: null }, null, new Set(), sourceCalls);
    expect(byName.matchCount).toBeGreaterThan(0);

    const byId = buildRowModel(
      { search: 'hcp-000123', region: null },
      null,
      new Set(),
      sourceCalls,
    );
    expect(byId.matchCount).toBe(1);
  });

  it('only shows the chosen region', () => {
    const region = rows[0]!.region;
    const model = buildRowModel({ search: '', region }, null, new Set(), sourceCalls);
    for (const rowIds of model.buckets.values()) {
      for (const rowId of rowIds) expect(rows[rowId]!.region).toBe(region);
    }
  });

  it('returns nothing at all when nothing matches', () => {
    const model = buildRowModel(
      { search: 'zzzz-not-a-real-name', region: null },
      null,
      new Set(),
      sourceCalls,
    );
    expect(model.matchCount).toBe(0);
    expect(model.visualRows).toHaveLength(0);
  });
});
