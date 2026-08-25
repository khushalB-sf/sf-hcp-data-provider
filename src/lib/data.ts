import { generateRows, type HcpRecord } from '../vendor/data-generator.ts';

/**
 * The dataset is generated once and never changed after that.
 *
 * I keep it in a module variable instead of in the store because the store
 * would then hold 50,000 objects that never change, and every state update
 * would make React re-check them for no reason.
 */
let rows: HcpRecord[] | null = null;

export function getRows(): HcpRecord[] {
  if (rows === null) rows = generateRows(42, 50000);
  return rows;
}

/**
 * `calls` is typed `number | string`, and 236 rows really do arrive as strings.
 *
 * I convert it once here rather than in every place that needs a number,
 * because I got bitten by this early: `"9" > "10"` is true for strings but
 * `9 > 10` is false, so a sort mixing the two types is just wrong. Adding them
 * up is worse — `+` on a string concatenates instead of summing.
 */
export function toNumber(value: number | string): number {
  if (typeof value === 'number') return value;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : NaN;
}

/** True if this row's `calls` came in as a string. Used to show it in italics. */
export function wasString(row: HcpRecord): boolean {
  return typeof row.calls === 'string';
}

/**
 * Row identity.
 *
 * IMPORTANT: `record.id` is NOT unique — see ASSUMPTIONS.md. Five ids appear
 * twice, and some of those pairs are in different regions. So I use the row's
 * index in the array as its id everywhere in this app: for edits, selection
 * and undo. The index is safe because I never sort or filter the array itself,
 * I only build lists of indexes.
 */
export type RowId = number;

export interface GroupKey {
  region: string;
  territory: string;
}

/** Pre-built list of row indexes per "Region / Territory", in source order. */
export interface GroupIndex {
  /** "West||T1" -> row indexes */
  byTerritory: Map<string, RowId[]>;
  /** region -> its territory keys, in the order they should appear */
  regions: string[];
  territoriesByRegion: Map<string, string[]>;
}

export const territoryKey = (region: string, territory: string): string =>
  `${region}||${territory}`;

export function splitKey(key: string): GroupKey {
  const [region = '', territory = ''] = key.split('||');
  return { region, territory };
}

let groupIndex: GroupIndex | null = null;

export function getGroupIndex(): GroupIndex {
  if (groupIndex !== null) return groupIndex;

  const all = getRows();
  const byTerritory = new Map<string, RowId[]>();
  const territoriesByRegion = new Map<string, string[]>();

  for (let i = 0; i < all.length; i++) {
    const row = all[i]!;
    const key = territoryKey(row.region, row.territory);
    let bucket = byTerritory.get(key);
    if (bucket === undefined) {
      bucket = [];
      byTerritory.set(key, bucket);

      let list = territoriesByRegion.get(row.region);
      if (list === undefined) {
        list = [];
        territoriesByRegion.set(row.region, list);
      }
      list.push(key);
    }
    bucket.push(i);
  }

  const regions = [...territoriesByRegion.keys()].sort();
  for (const list of territoriesByRegion.values()) {
    list.sort((a, b) => splitKey(a).territory.localeCompare(splitKey(b).territory));
  }

  groupIndex = { byTerritory, regions, territoriesByRegion };
  return groupIndex;
}

/** Only used by tests, so each test starts from a clean cache. */
export function __resetData(): void {
  rows = null;
  groupIndex = null;
}
