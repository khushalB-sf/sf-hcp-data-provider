import { beforeAll, describe, expect, it } from 'vitest';
import { cpi, formatCpi } from './cpi.ts';
import { getRows, toNumber } from './data.ts';
import { generateRows } from '../vendor/data-generator.ts';

let rows: ReturnType<typeof getRows>;

beforeAll(() => {
  rows = getRows();
});

/**
 * These tests are about the DATA, not my code. I wrote them after being
 * surprised a few times, so that if I ever change the seed I find out
 * immediately which of my assumptions no longer hold.
 */
describe('the generated dataset', () => {
  it('has 50,000 rows and is the same every time', () => {
    expect(rows).toHaveLength(50000);
    const again = generateRows(42, 50000);
    expect(again[0]).toEqual(rows[0]);
    expect(again[49999]).toEqual(rows[49999]);
  });

  it('has duplicate ids — this is why I do not use id as a key', () => {
    const seen = new Set(rows.map((r) => r.id));
    expect(seen.size).toBeLessThan(rows.length);

    // The specific pair I found, which is in two different regions.
    expect(rows[9972]!.id).toBe(rows[9973]!.id);
    expect(rows[9972]!.region).not.toBe(rows[9973]!.region);
  });

  it('has some rows where calls is a string, not a number', () => {
    const strings = rows.filter((r) => typeof r.calls === 'string');
    expect(strings.length).toBeGreaterThan(0);
    // They all look like numbers, so converting them is safe.
    for (const row of strings) expect(Number.isFinite(toNumber(row.calls))).toBe(true);
  });

  it('has rows with a null specialty', () => {
    expect(rows.some((r) => r.specialty === null)).toBe(true);
  });

  it('has rows where trx is 0, which would divide by zero in CPI', () => {
    const zeros = rows.filter((r) => r.trx === 0);
    expect(zeros.length).toBeGreaterThan(0);
    for (const row of zeros.slice(0, 5)) {
      expect(cpi(toNumber(row.calls), row.trx)).toBeUndefined();
    }
  });

  it('has a few rows with calls = 99999, which look like placeholders', () => {
    const sentinels = rows.filter((r) => toNumber(r.calls) === 99999);
    expect(sentinels.length).toBeGreaterThan(0);
  });
});

describe('converting calls', () => {
  it('turns a numeric string into a number', () => {
    expect(toNumber('42')).toBe(42);
    expect(toNumber(' 7 ')).toBe(7);
    expect(toNumber(9)).toBe(9);
  });

  it('gives NaN for something that is not a number at all', () => {
    expect(Number.isNaN(toNumber('n/a'))).toBe(true);
  });
});

describe('CPI', () => {
  it('is undefined when trx is 0, not Infinity or 0', () => {
    expect(cpi(10, 0)).toBeUndefined();
    expect(cpi(0, 0)).toBeUndefined();
    expect(formatCpi(cpi(10, 0))).toBe('—');
  });

  it('works out a normal value', () => {
    expect(cpi(20, 100)).toBe(20);
    expect(formatCpi(cpi(20, 100))).toBe('20.0%');
  });

  it('caps a silly-looking value for display but keeps the real one', () => {
    const value = cpi(99999, 62)!;
    expect(value).toBeGreaterThan(1000);
    expect(Number.isFinite(value)).toBe(true); // isFinite alone would not catch this
    expect(formatCpi(value)).toBe('>999%');
  });
});
